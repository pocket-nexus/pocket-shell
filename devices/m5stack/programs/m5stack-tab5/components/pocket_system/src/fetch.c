/*
 * One download for install.c: an address fetched with esp_http_client into
 * a staging file, hashed with SHA-256 as it is written.
 *
 * The download runs on a task of its own so the system task, which pumps
 * installs and serves every guest call, never waits on DNS, a handshake or
 * a read. The task writes the store, and a write to the flash partition
 * disables the cache, so its stack is internal RAM (FETCH_STACK, held only
 * while a download runs); mbedTLS keeps its buffers in PSRAM
 * (CONFIG_MBEDTLS_EXTERNAL_MEM_ALLOC). An https:// address waits for the
 * SNTP clock, which certificate dates are checked against.
 */

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_tls_errors.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "install_uri.h"
#include "sha256.h"
#include "system_internal.h"

#define FETCH_STACK (12U * 1024U)
#define FETCH_CHUNK (16U * 1024U)
#define FETCH_REDIRECTS 3
/* One connect or read waits at most this long; a stop lands within it. */
#define FETCH_TIMEOUT_MS 10000
/* A download fails after this long without a byte. A read that times out
 * is tried again until then: a slow path (a Tab5 in mainland China to
 * Cloudflare ran at a few KB/s) has pauses longer than one read. */
#define FETCH_STALL_US (30LL * 1000 * 1000)
/* Bytes between two progress lines in the log. */
#define FETCH_LOG_BYTES (128U * 1024U)
#define FETCH_CLOCK_MS 15000U

static const char *TAG = "pocket_fetch";

/* The one download. `lock` guards the fields both tasks read. */
static struct {
  SemaphoreHandle_t lock;
  SemaphoreHandle_t finished;
  TaskHandle_t task;
  bool open;
  volatile bool stop;
  int32_t state;
  uint32_t received;
  uint32_t total;
  uint32_t max_bytes;
  uint8_t sha256[SHA256_BYTES];
  char error[160];
  char url[INSTALL_URL_MAX + 1];
  char path[160];
} fetch;

static void publish(uint32_t received, uint32_t total) {
  xSemaphoreTake(fetch.lock, portMAX_DELAY);
  fetch.received = received;
  fetch.total = total;
  xSemaphoreGive(fetch.lock);
}

static bool fail(const char *format, ...) {
  char text[sizeof fetch.error];
  va_list arguments;
  va_start(arguments, format);
  vsnprintf(text, sizeof text, format, arguments);
  va_end(arguments);
  xSemaphoreTake(fetch.lock, portMAX_DELAY);
  snprintf(fetch.error, sizeof fetch.error, "%s", text);
  xSemaphoreGive(fetch.lock);
  ESP_LOGW(TAG, "%.120s: %s", fetch.url, text);
  return false;
}

/* esp_http_client_open failed: name the failure from esp-tls's last error. */
static bool connect_failed(esp_http_client_handle_t client, esp_err_t result) {
  int code = 0, flags = 0;
  const esp_err_t last =
      esp_http_client_get_and_clear_last_tls_error(client, &code, &flags);
  if (last == ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME)
    return fail("install: the server's name does not resolve");
  if (last == ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT)
    return fail("install: the server does not answer");
  if (last >= ESP_ERR_MBEDTLS_CERT_PARTLY_OK &&
      last < ESP_ERR_ESP_TLS_BASE + 0x100)
    return fail("install: the secure connection failed (%s, verify 0x%x)",
                esp_err_to_name(last), (unsigned)flags);
  return fail("install: no connection (%s)",
              esp_err_to_name(last != ESP_OK ? last : result));
}

/* Open the address, following redirects, until a final response head. */
static bool open_response(esp_http_client_handle_t client, int *status) {
  for (int hop = 0;; hop += 1) {
    const esp_err_t opened = esp_http_client_open(client, 0);
    if (opened != ESP_OK)
      return connect_failed(client, opened);
    if (esp_http_client_fetch_headers(client) < 0)
      return fail("install: the connection closed before the response");
    *status = esp_http_client_get_status_code(client);
    const bool redirect = *status == 301 || *status == 302 || *status == 303 ||
                          *status == 307 || *status == 308;
    if (!redirect)
      return true;
    if (hop == FETCH_REDIRECTS)
      return fail("install: more than %d redirects", FETCH_REDIRECTS);
    if (esp_http_client_set_redirection(client) != ESP_OK)
      return fail("install: a redirect without a location");
    esp_http_client_flush_response(client, NULL);
    esp_http_client_close(client);
  }
}

/* With no SNTP answer (pool.ntp.org did not answer one boot of a Tab5 in
 * mainland China), set the clock to the firmware's build time if it is
 * earlier, so a certificate issued before the build passes its date check.
 * SNTP corrects the clock when it answers. The package's SHA-256 from the
 * install code, not the certificate's dates, is what the install trusts. */
static void clock_floor(void) {
  static const char *const MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";
  const char *date = __DATE__, *time_of_day = __TIME__;
  char month[4] = {date[0], date[1], date[2], '\0'};
  const char *found = strstr(MONTHS, month);
  struct tm built = {
      .tm_year = atoi(date + 7) - 1900,
      .tm_mon = found != NULL ? (int)(found - MONTHS) / 3 : 0,
      .tm_mday = atoi(date + 4),
      .tm_hour = atoi(time_of_day),
      .tm_min = atoi(time_of_day + 3),
      .tm_sec = atoi(time_of_day + 6),
  };
  const time_t floor = mktime(&built);
  struct timeval now;
  gettimeofday(&now, NULL);
  if (floor > 0 && now.tv_sec < floor) {
    const struct timeval set = {.tv_sec = floor};
    settimeofday(&set, NULL);
    ESP_LOGW(TAG, "no SNTP answer: the clock starts at the build time, %s %s",
             __DATE__, __TIME__);
  }
}

static bool download(FILE *file, uint8_t *chunk) {
  if (!wifi_online())
    return fail("install: Wi-Fi is not connected");
  if (strncmp(fetch.url, "https://", 8) == 0 && !clock_wait(FETCH_CLOCK_MS))
    clock_floor();
  const esp_http_client_config_t config = {
      .url = fetch.url,
      .method = HTTP_METHOD_GET,
      .timeout_ms = FETCH_TIMEOUT_MS,
      .buffer_size = 4096,
      /* The request line holds a redirect's whole target. */
      .buffer_size_tx = 1024,
      .user_agent = "PocketJS/1 (M5Stack Tab5)",
      .crt_bundle_attach = esp_crt_bundle_attach,
  };
  esp_http_client_handle_t client = esp_http_client_init(&config);
  if (client == NULL)
    return fail("install: out of memory for the HTTP client");
  bool ok = false;
  int status = 0;
  if (!open_response(client, &status))
    goto done;
  if (status != 200) {
    fail("install: the server answered %d", status);
    goto done;
  }
  const int64_t declared = esp_http_client_get_content_length(client);
  if (declared > (int64_t)fetch.max_bytes) {
    fail("install: the package is larger than %u bytes",
         (unsigned)fetch.max_bytes);
    goto done;
  }
  const uint32_t total = declared > 0 ? (uint32_t)declared : 0;
  publish(0, total);
  Sha256 hash;
  sha256_init(&hash);
  uint32_t received = 0, logged = 0;
  const int64_t started = esp_timer_get_time();
  int64_t heard = started;
  for (;;) {
    if (fetch.stop) {
      fail("install: stopped");
      goto done;
    }
    const int n = esp_http_client_read(client, (char *)chunk, FETCH_CHUNK);
    if (n == -ESP_ERR_HTTP_EAGAIN) {
      if (esp_timer_get_time() - heard > FETCH_STALL_US) {
        fail("install: the server stopped sending after %u bytes",
             (unsigned)received);
        goto done;
      }
      continue;
    }
    if (n < 0) {
      fail("install: the connection closed during the download (%d after "
           "%u bytes)",
           n, (unsigned)received);
      goto done;
    }
    heard = esp_timer_get_time();
    if (n == 0) {
      if (!esp_http_client_is_complete_data_received(client)) {
        fail("install: the download ended early");
        goto done;
      }
      break;
    }
    if ((uint64_t)received + (uint64_t)n > fetch.max_bytes) {
      fail("install: the package is larger than %u bytes",
           (unsigned)fetch.max_bytes);
      goto done;
    }
    if (fwrite(chunk, 1, (size_t)n, file) != (size_t)n) {
      fail("install: the store is full or cannot be written");
      goto done;
    }
    sha256_update(&hash, chunk, (size_t)n);
    received += (uint32_t)n;
    publish(received, total);
    if (received - logged >= FETCH_LOG_BYTES) {
      logged = received;
      const int64_t ms = (heard - started) / 1000;
      ESP_LOGI(TAG, "%u of %u bytes, %lld ms, %lld KB/s", (unsigned)received,
               (unsigned)total, (long long)ms,
               ms > 0 ? (long long)received / ms : 0LL);
    }
  }
  if (received == 0) {
    fail("install: the server sent an empty file");
    goto done;
  }
  xSemaphoreTake(fetch.lock, portMAX_DELAY);
  sha256_final(&hash, fetch.sha256);
  xSemaphoreGive(fetch.lock);
  ESP_LOGI(TAG, "%.120s: %u bytes in %lld ms", fetch.url, (unsigned)received,
           (long long)((esp_timer_get_time() - started) / 1000));
  ok = true;
done:
  esp_http_client_cleanup(client);
  return ok;
}

static void fetch_main(void *unused) {
  (void)unused;
  bool ok = false;
  uint8_t *chunk = heap_caps_malloc(FETCH_CHUNK, MALLOC_CAP_SPIRAM);
  FILE *file = fopen(fetch.path, "wb");
  if (chunk == NULL)
    fail("install: out of memory");
  else if (file == NULL)
    fail("install: the store cannot be written");
  else
    ok = download(file, chunk);
  if (file != NULL && fclose(file) != 0 && ok)
    ok = fail("install: the store cannot be written");
  heap_caps_free(chunk);
  xSemaphoreTake(fetch.lock, portMAX_DELAY);
  fetch.state = ok ? FETCH_DONE : FETCH_FAILED;
  xSemaphoreGive(fetch.lock);
  xSemaphoreGive(fetch.finished);
  vTaskDelete(NULL);
}

bool fetch_start(const char *url, const char *path, uint32_t max_bytes) {
  if (fetch.lock == NULL) {
    fetch.lock = xSemaphoreCreateMutex();
    fetch.finished = xSemaphoreCreateBinary();
    if (fetch.lock == NULL || fetch.finished == NULL)
      return false;
  }
  if (fetch.open || url == NULL || path == NULL ||
      strlen(url) >= sizeof fetch.url || strlen(path) >= sizeof fetch.path)
    return false;
  fetch.stop = false;
  fetch.state = FETCH_RUNNING;
  fetch.received = 0;
  fetch.total = 0;
  fetch.max_bytes = max_bytes;
  fetch.error[0] = '\0';
  snprintf(fetch.url, sizeof fetch.url, "%s", url);
  snprintf(fetch.path, sizeof fetch.path, "%s", path);
  /* xTaskCreate takes the stack from internal RAM: the task writes flash. */
  if (xTaskCreate(fetch_main, "pocket_fetch", FETCH_STACK, NULL, 4,
                  &fetch.task) != pdPASS) {
    ESP_LOGW(TAG, "no internal RAM for the download task");
    return false;
  }
  fetch.open = true;
  return true;
}

int32_t fetch_poll(uint32_t *received, uint32_t *total, uint8_t sha256[32],
                   char *error, size_t error_capacity) {
  if (!fetch.open) {
    snprintf(error, error_capacity, "install: no such download");
    return FETCH_FAILED;
  }
  xSemaphoreTake(fetch.lock, portMAX_DELAY);
  const int32_t state = fetch.state;
  *received = fetch.received;
  *total = fetch.total;
  if (state == FETCH_DONE)
    memcpy(sha256, fetch.sha256, SHA256_BYTES);
  else if (state == FETCH_FAILED)
    snprintf(error, error_capacity, "%s", fetch.error);
  xSemaphoreGive(fetch.lock);
  return state;
}

void fetch_end(void) {
  if (!fetch.open)
    return;
  fetch.stop = true;
  /* The task gives `finished` once, after it closed the file. */
  xSemaphoreTake(fetch.finished, portMAX_DELAY);
  fetch.task = NULL;
  fetch.open = false;
}
