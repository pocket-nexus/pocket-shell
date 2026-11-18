#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pocket/worker_esp.h"
#include "pocket/worker_runner.h"
#include <stdlib.h>
#include <string.h>

struct pocket_worker_esp {
  pocket_worker_esp_config config;
  SemaphoreHandle_t mutex, done, ready;
  /* Held to ask the runner to stop and to take it out of the host. */
  SemaphoreHandle_t handover;
  TaskHandle_t task;
  pocket_worker_runner *runner;
  esp_timer_handle_t timer;
  esp_err_t startup;
  /* The worker task is destroying its runner. */
  bool draining;
  size_t guest_used, guest_peak;
  char console[4][1024];
  unsigned console_count, console_dropped;
};

typedef union {
  size_t size;
  max_align_t alignment;
} alloc_header;
static uint32_t heap_caps(const pocket_worker_esp *host) {
  return host && host->config.heap_caps ? host->config.heap_caps
                                        : MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
}
static void *guest_malloc(void *opaque, size_t size) {
  pocket_worker_esp *host = opaque;
  if (!size || size > SIZE_MAX - sizeof(alloc_header))
    return NULL;
  const uint32_t caps = heap_caps(host);
  alloc_header *block = heap_caps_malloc(sizeof(*block) + size, caps);
  if (!block) {
    ESP_LOGE("pocket_worker", "allocation failed bytes=%u free=%u largest=%u",
             (unsigned)size, (unsigned)heap_caps_get_free_size(caps),
             (unsigned)heap_caps_get_largest_free_block(caps));
    return NULL;
  }
  block->size = size;
  if (host) {
    host->guest_used += size;
    if (host->guest_used > host->guest_peak)
      host->guest_peak = host->guest_used;
  }
  return block + 1;
}
static void *guest_calloc(void *opaque, size_t count, size_t size) {
  if (count && size > SIZE_MAX / count)
    return NULL;
  void *result = guest_malloc(opaque, count * size);
  if (result)
    memset(result, 0, count * size);
  return result;
}
static void guest_free(void *opaque, void *pointer) {
  pocket_worker_esp *host = opaque;
  if (pointer) {
    if (host)
      host->guest_used -= ((alloc_header *)pointer - 1)->size;
    heap_caps_free((alloc_header *)pointer - 1);
  }
}
static size_t guest_size(const void *pointer) {
  return pointer ? ((const alloc_header *)pointer - 1)->size : 0;
}
static void *guest_realloc(void *opaque, void *pointer, size_t size) {
  if (!pointer)
    return guest_malloc(opaque, size);
  if (!size) {
    guest_free(opaque, pointer);
    return NULL;
  }
  if (size > SIZE_MAX - sizeof(alloc_header))
    return NULL;
  pocket_worker_esp *host = opaque;
  alloc_header *block = (alloc_header *)pointer - 1;
  const size_t previous = block->size;
  alloc_header *next =
      heap_caps_realloc(block, sizeof(*block) + size, heap_caps(host));
  if (!next)
    return NULL;
  next->size = size;
  if (host) {
    host->guest_used = host->guest_used - previous + size;
    if (host->guest_used > host->guest_peak)
      host->guest_peak = host->guest_used;
  }
  return next + 1;
}
static const JSMallocFunctions allocator = {.js_malloc = guest_malloc,
                                            .js_calloc = guest_calloc,
                                            .js_free = guest_free,
                                            .js_realloc = guest_realloc,
                                            .js_malloc_usable_size =
                                                guest_size};

static void core_lock(void *context) {
  pocket_worker_esp *worker = context;
  xSemaphoreTake(worker->mutex, portMAX_DELAY);
}
static void core_unlock(void *context) {
  pocket_worker_esp *worker = context;
  xSemaphoreGive(worker->mutex);
}
static void wake(void *context) {
  pocket_worker_esp *worker = context;
  xTaskNotifyGive(worker->task);
}
static uint64_t now(void *context) {
  (void)context;
  return (uint64_t)esp_timer_get_time();
}
/* The runner's idle wait. Notification counts survive the check-to-wait
 * race; an esp_timer one-shot wakes exact deadlines, so there is no global
 * worker tick. The one-shot is stopped when the wait ends: left armed after
 * another wake ended the wait, it fires during the next turn and ends the
 * wait after that one at once. With a close retried every millisecond and
 * turns longer than that, no wait blocked, and the driver task that must run
 * to release the resource, below this priority on this core, got no time.
 *
 * While the runner is destroyed the wait is one tick whatever wakes arrive:
 * each retry of pocket_worker_destroy closes the open resources again and
 * each close wakes this task. */
static void wait_until(void *context, uint64_t deadline) {
  pocket_worker_esp *host = context;
  if (host->draining) {
    vTaskDelay(1);
    return;
  }
  if (deadline != UINT64_MAX) {
    const uint64_t current = now(host);
    if (deadline <= current)
      return;
    esp_timer_start_once(host->timer, deadline - current);
  }
  ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
  esp_timer_stop(host->timer);
}
static JSValue console_log(JSContext *context, JSValueConst self, int argc,
                           JSValueConst *argv, int magic, JSValue *data) {
  (void)self;
  (void)magic;
  size_t size = 0;
  uint8_t *stored = JS_GetArrayBuffer(context, &size, data[0]);
  if (!stored || size != sizeof(pocket_worker_esp *))
    return JS_ThrowInternalError(context, "console owner unavailable");
  pocket_worker_esp *host;
  memcpy(&host, stored, sizeof(host));
  for (int i = 0; i < argc; ++i) {
    if (host->console_count == 4) {
      ++host->console_dropped;
      continue;
    }
    const char *text = JS_ToCString(context, argv[i]);
    if (!text)
      return JS_EXCEPTION;
    const size_t length = strnlen(text, 1023);
    memcpy(host->console[host->console_count], text, length);
    host->console[host->console_count++][length] = 0;
    JS_FreeCString(context, text);
  }
  return JS_UNDEFINED;
}
/* Console transmission can block on UART/USB consumers. The runner calls
 * this after every turn, outside guest code, so a blocked console delays the
 * next turn and never a running one. */
static void drain_console(void *context) {
  pocket_worker_esp *host = context;
  for (unsigned i = 0; i < host->console_count; ++i)
    ESP_LOGI("worker", "%s", host->console[i]);
  if (host->console_dropped)
    ESP_LOGW("worker", "console dropped %u records", host->console_dropped);
  host->console_count = host->console_dropped = 0;
}
static int32_t mount(void *opaque, JSContext *context) {
  pocket_worker_esp *host = opaque;
  JSValue global = JS_GetGlobalObject(context);
  JSValue console = JS_NewObject(context);
  if (JS_IsException(console)) {
    JS_FreeValue(context, global);
    return POCKET_WORKER_FAILED;
  }
  JSValue owner =
      JS_NewArrayBufferCopy(context, (const uint8_t *)&host, sizeof(host));
  if (JS_IsException(owner)) {
    JS_FreeValue(context, console);
    JS_FreeValue(context, global);
    return POCKET_WORKER_FAILED;
  }
  const char *names[] = {"log", "error"};
  for (size_t i = 0; i < 2; ++i) {
    JSValue function =
        JS_NewCFunctionData(context, console_log, 1, 0, 1, &owner);
    if (JS_IsException(function) ||
        JS_SetPropertyStr(context, console, names[i], function) < 0) {
      JS_FreeValue(context, owner);
      JS_FreeValue(context, console);
      JS_FreeValue(context, global);
      return POCKET_WORKER_FAILED;
    }
  }
  JS_FreeValue(context, owner);
  const int result = JS_SetPropertyStr(context, global, "console", console);
  JS_FreeValue(context, global);
  return result < 0 ? POCKET_WORKER_FAILED : POCKET_WORKER_OK;
}

static void run(void *opaque) {
  pocket_worker_esp *host = opaque;
  host->task = xTaskGetCurrentTaskHandle();
  const esp_timer_create_args_t timer = {.callback = wake,
                                         .arg = host,
                                         .dispatch_method = ESP_TIMER_TASK,
                                         .name = "worker_deadline"};
  host->startup = esp_timer_create(&timer, &host->timer);
  if (host->startup == ESP_OK) {
    const pocket_worker_runner_config config = {
        .struct_size = sizeof(config),
        .core = {.struct_size = sizeof(config.core),
                 .generation = host->config.generation,
                 .nodes = host->config.nodes,
                 .node_count = host->config.node_count,
                 .context = host,
                 .lock = core_lock,
                 .unlock = core_unlock,
                 .wake = wake,
                 .now_micros = now},
        .realm = {.struct_size = sizeof(config.realm),
                  .heap_limit = host->config.heap_limit,
                  .stack_limit = host->config.stack_limit,
                  /* Each await resumes as one job; drivers resolved by the
                   * same turn share this count before the next step. */
                  .max_jobs = 64,
                  .max_facts = 16,
                  .max_bytes = 8192,
                  .window_micros = host->config.window_micros,
                  .quota_micros = host->config.quota_micros,
                  .context = host,
                  .now_micros = now,
                  .mount = mount,
                  .allocator = &allocator,
                  .allocator_context = host},
        .source = host->config.source,
        .source_size = host->config.source_size,
        .context = host,
        .bytecode = host->config.bytecode,
        .bytecode_size = host->config.bytecode_size,
        .engine_abi = host->config.engine_abi,
        .wait = wait_until,
        .after_turn = drain_console,
        .start_paused = host->config.defer_turns};
    ESP_LOGI("pocket_worker", "before load free=%u largest=%u heap_limit=%u",
             (unsigned)heap_caps_get_free_size(heap_caps(host)),
             (unsigned)heap_caps_get_largest_free_block(heap_caps(host)),
             (unsigned)host->config.heap_limit);
    host->runner = pocket_worker_runner_create(&config);
    drain_console(host);
    if (!host->runner) {
      host->startup = ESP_ERR_NO_MEM;
    } else if (pocket_worker_runner_failed(host->runner)) {
      ESP_LOGE("pocket_worker", "load: %s",
               pocket_worker_runner_error(host->runner));
      host->startup = ESP_FAIL;
    } else {
      ESP_LOGI("pocket_worker", "loaded guest_used=%u guest_peak=%u free=%u",
               (unsigned)host->guest_used, (unsigned)host->guest_peak,
               (unsigned)heap_caps_get_free_size(heap_caps(host)));
    }
  }
  xSemaphoreGive(host->ready);
  if (host->startup == ESP_OK) {
    /* Returns once stop was requested. After a fault the runner keeps the
     * core until then, so the UI owner detaches its channel mirrors first;
     * pocket_worker_esp_failed reports the fault meanwhile. */
    pocket_worker_runner_run(host->runner);
    if (pocket_worker_runner_failed(host->runner))
      ESP_LOGE("pocket_worker", "fault: %s",
               pocket_worker_runner_error(host->runner));
  }
  if (host->runner) {
    ESP_LOGI("pocket_worker",
             "stopped guest_used=%u guest_peak=%u stack_min_free=%u",
             (unsigned)host->guest_used, (unsigned)host->guest_peak,
             (unsigned)uxTaskGetStackHighWaterMark(NULL));
    /* Destroy retries through wait_until while native IO still holds the
     * core, so the deadline timer must outlive it. A stop that timed out
     * asks again meanwhile, so the runner leaves the host first. */
    xSemaphoreTake(host->handover, portMAX_DELAY);
    pocket_worker_runner *runner = host->runner;
    host->runner = NULL;
    xSemaphoreGive(host->handover);
    host->draining = true;
    pocket_worker_runner_destroy(runner);
  }
  if (host->timer) {
    /* TASK-dispatch callbacks can still be in flight. Join them before
     * stop() can release the host and task storage. */
    ESP_ERROR_CHECK(esp_timer_stop_blocking(host->timer, portMAX_DELAY));
    esp_timer_delete(host->timer);
    host->timer = NULL;
  }
  xSemaphoreGive(host->ready);
  xSemaphoreGive(host->done);
  for (;;)
    vTaskSuspend(NULL);
}

esp_err_t pocket_worker_esp_start(const pocket_worker_esp_config *config,
                                  pocket_worker_esp **out) {
  if (!config || config->struct_size < sizeof(*config) || !out ||
      ((!config->source || !config->source_size) &&
       (!config->bytecode || !config->bytecode_size)) ||
      !config->heap_limit || !config->stack_limit ||
      config->task_stack_size < 8192 || !config->generation ||
      (config->quota_micros && config->quota_micros > config->window_micros))
    return ESP_ERR_INVALID_ARG;
  *out = NULL;
  pocket_worker_esp *host = calloc(1, sizeof(*host));
  if (!host)
    return ESP_ERR_NO_MEM;
  host->config = *config;
  host->mutex = xSemaphoreCreateMutex();
  host->handover = xSemaphoreCreateMutex();
  host->ready = xSemaphoreCreateBinary();
  host->done = xSemaphoreCreateBinary();
  const BaseType_t created =
      host->mutex && host->handover && host->ready && host->done
          ? config->task_stack_caps
                ? xTaskCreatePinnedToCoreWithCaps(
                      run, "pocket_worker", config->task_stack_size, host,
                      config->task_priority, &host->task, config->task_core,
                      config->task_stack_caps)
                : xTaskCreatePinnedToCore(
                      run, "pocket_worker", config->task_stack_size, host,
                      config->task_priority, &host->task, config->task_core)
          : pdFAIL;
  if (created != pdPASS) {
    if (host->mutex)
      vSemaphoreDelete(host->mutex);
    if (host->handover)
      vSemaphoreDelete(host->handover);
    if (host->ready)
      vSemaphoreDelete(host->ready);
    if (host->done)
      vSemaphoreDelete(host->done);
    free(host);
    return ESP_ERR_NO_MEM;
  }
  xSemaphoreTake(host->ready, portMAX_DELAY);
  if (host->startup != ESP_OK) {
    const esp_err_t result = host->startup;
    pocket_worker_esp_stop(host, UINT32_MAX);
    return result;
  }
  *out = host;
  return ESP_OK;
}
esp_err_t pocket_worker_esp_stop(pocket_worker_esp *host, uint32_t timeout_ms) {
  if (!host)
    return ESP_ERR_INVALID_ARG;
  /* Do not notify a task which has already deleted itself. */
  if (xSemaphoreTake(host->done, 0) != pdTRUE) {
    xSemaphoreTake(host->handover, portMAX_DELAY);
    pocket_worker_runner_stop(host->runner);
    xSemaphoreGive(host->handover);
    wake(host);
    const TickType_t wait =
        timeout_ms == UINT32_MAX ? portMAX_DELAY : pdMS_TO_TICKS(timeout_ms);
    if (xSemaphoreTake(host->done, wait) != pdTRUE)
      return ESP_ERR_TIMEOUT;
  }
  if (host->config.task_stack_caps)
    vTaskDeleteWithCaps(host->task);
  else
    vTaskDelete(host->task);
  vSemaphoreDelete(host->done);
  vSemaphoreDelete(host->ready);
  vSemaphoreDelete(host->handover);
  vSemaphoreDelete(host->mutex);
  free(host);
  return ESP_OK;
}
bool pocket_worker_esp_failed(pocket_worker_esp *host) {
  if (!host)
    return false;
  return host->startup != ESP_OK ||
         (host->runner && pocket_worker_runner_failed(host->runner));
}

pocket_worker *pocket_worker_esp_core(pocket_worker_esp *host) {
  return host ? pocket_worker_runner_core(host->runner) : NULL;
}

void pocket_worker_esp_resume(pocket_worker_esp *host) {
  if (!host)
    return;
  pocket_worker_runner_resume(host->runner);
}
