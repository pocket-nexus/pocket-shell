#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_tls_errors.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pocket/http_esp.h"
#include "record.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>
#include <sys/select.h>

#define SLOTS 2u
#define FIELD_BYTES 4096u
#define MAX_FIELDS 64u
/* The longest a request task waits before it looks for a cancel or the
 * deadline. */
#define SLICE_MS 500u
#define TASK_STACK 12288u
/* How often a request to the companion looks for its next fact. */
#define COMPANION_POLL_MS 10u
/* How long a request task keeps the connection of its last request for the
 * next request to the same origin. */
#define KEEP_MS 10000u

static const char *TAG = "pocket_http";

/* Indexed by POCKET_HTTP_ESP_GET..POCKET_HTTP_ESP_OPTIONS. */
static const esp_http_client_method_t METHODS[] = {
    HTTP_METHOD_GET,   HTTP_METHOD_HEAD,   HTTP_METHOD_POST,   HTTP_METHOD_PUT,
    HTTP_METHOD_PATCH, HTTP_METHOD_DELETE, HTTP_METHOD_OPTIONS};

typedef enum { SLOT_FREE, SLOT_OPEN, SLOT_RUNNING, SLOT_DONE } slot_phase;

typedef struct {
  struct pocket_http_esp *driver;
  TaskHandle_t task;
  /* phase and cancel are shared with the worker task under the mutex. */
  slot_phase phase;
  bool cancel;
  pocket_worker *worker;
  uint32_t handle, request;
  int64_t deadline;
  /* The descriptor as opened, for the companion transport. */
  uint8_t opened[POCKET_HTTP_ESP_RECORD];
  size_t opened_length;
  /* Owned by the request task while the slot runs. */
  pocket_http_esp_request descriptor;
  char url[POCKET_HTTP_ESP_URL];
  bool sent;
  uint64_t delivered;
  char fields[FIELD_BYTES];
  size_t fields_length, field_count;
  char record[POCKET_HTTP_ESP_RECORD];
  pocket_http_esp_fact fact;
  /* The client of the last request, when its connection is kept for the
   * next one. The request task owns it; `kept` and `origin`, the origin it
   * is connected to, are shared with the worker task under the mutex. */
  esp_http_client_handle_t client;
  pocket_http_esp_url origin;
  bool kept;
} slot;

struct pocket_http_esp {
  pocket_worker_driver vtable;
  pocket_http_esp_config config;
  SemaphoreHandle_t mutex, stopped;
  bool quit;
  slot slots[SLOTS];
};

static void lock(pocket_http_esp *d) {
  xSemaphoreTake(d->mutex, portMAX_DELAY);
}
static void unlock(pocket_http_esp *d) { xSemaphoreGive(d->mutex); }

static slot *find(pocket_http_esp *d, uint32_t handle) {
  for (size_t i = 0; i < SLOTS; ++i)
    if (d->slots[i].phase != SLOT_FREE && d->slots[i].handle == handle)
      return &d->slots[i];
  return NULL;
}

static bool cancelled(slot *s) {
  lock(s->driver);
  const bool cancel = s->cancel;
  unlock(s->driver);
  return cancel;
}

static uint32_t remaining_ms(const slot *s) {
  const int64_t left = s->deadline - esp_timer_get_time();
  return left <= 0 ? 0 : (uint32_t)((left + 999) / 1000);
}

static int slice_ms(const slot *s) {
  const uint32_t left = remaining_ms(s);
  return left > SLICE_MS ? (int)SLICE_MS : left ? (int)left : 1;
}

/* One fact; while the worker's event slots are full the task waits, which
 * stops socket reads and lets TCP hold the sender. Gives up on a cancel, or
 * a second after the deadline. */
static bool emit(slot *s, uint32_t kind, int32_t status, uint64_t offset,
                 const void *bytes, size_t length) {
  const int64_t started = esp_timer_get_time();
  for (;;) {
    const int32_t result = pocket_worker_emit(s->worker, s->handle, kind,
                                              status, offset, bytes, length);
    if (result != POCKET_WORKER_BUSY)
      return result == POCKET_WORKER_OK;
    if (cancelled(s) ||
        (!remaining_ms(s) && esp_timer_get_time() - started > 1000000))
      return false;
    vTaskDelay(1);
  }
}

/* Report a failure as an error fact, "code: message" in the portable codes of
 * the companion's transport, and return the request's terminal status. */
__attribute__((format(printf, 3, 4))) static int32_t
failure(slot *s, int32_t status, const char *format, ...) {
  char text[192];
  va_list arguments;
  va_start(arguments, format);
  const int n = vsnprintf(text, sizeof text, format, arguments);
  va_end(arguments);
  const size_t length = n < 0                     ? 0
                        : (size_t)n < sizeof text ? (size_t)n
                                                  : sizeof text - 1;
  ESP_LOGW(TAG, "%.200s: %s", s->url, text);
  emit(s, POCKET_WORKER_ERROR, status, s->delivered, text, length);
  return status;
}

/* A cancel or the deadline ends the wait; `phase` names what timed out. */
static bool stopped(slot *s, const char *phase, int32_t *status) {
  if (cancelled(s)) {
    *status = s->sent ? POCKET_WORKER_UNKNOWN : POCKET_WORKER_CANCELLED;
    return true;
  }
  if (remaining_ms(s))
    return false;
  *status = failure(
      s,
      s->sent && !s->field_count ? POCKET_WORKER_UNKNOWN : POCKET_WORKER_FAILED,
      "timeout: %s within %u ms", phase, (unsigned)s->descriptor.timeout_ms);
  return true;
}

/* A method that may be sent twice (RFC 9110, 9.2.2). */
static bool repeatable(uint8_t method) {
  return method != POCKET_HTTP_ESP_POST && method != POCKET_HTTP_ESP_PATCH;
}

/* Userinfo becomes credentials that esp_http_client holds with the client. */
static bool has_userinfo(const char *url, const pocket_http_esp_url *parsed) {
  return memchr(url, '@', parsed->authority_end) != NULL;
}

static void drop_connection(slot *s) {
  lock(s->driver);
  s->kept = false;
  unlock(s->driver);
  if (s->client)
    esp_http_client_cleanup(s->client);
  s->client = NULL;
}

/* Whether the kept connection serves the request to `url`: it goes to that
 * origin, the method may be sent twice, and the peer has neither closed the
 * connection nor sent on it. Any other kept connection is closed. */
static bool take_connection(slot *s, const pocket_http_esp_url *url) {
  lock(s->driver);
  const bool kept = s->kept;
  s->kept = false;
  unlock(s->driver);
  if (kept && repeatable(s->descriptor.method) && !has_userinfo(s->url, url) &&
      pocket_http_esp_same_origin(&s->origin, url)) {
    const int fd = esp_http_client_get_socket(s->client);
    if (fd >= 0) {
      fd_set readable;
      FD_ZERO(&readable);
      FD_SET(fd, &readable);
      struct timeval now = {0};
      if (select(fd + 1, &readable, NULL, NULL, &now) == 0)
        return true;
    }
  }
  drop_connection(s);
  return false;
}

/* A kept connection that fails before the response head was closed by its
 * peer: the request goes out again on a new connection. */
static bool resend(slot *s, bool *kept) {
  if (!*kept || cancelled(s) || !remaining_ms(s))
    return false;
  drop_connection(s);
  *kept = false;
  s->sent = false;
  return true;
}

static esp_err_t on_client_event(esp_http_client_event_t *event) {
  slot *s = event->user_data;
  if (event->event_id != HTTP_EVENT_ON_HEADER || !event->header_key ||
      !event->header_value || s->field_count >= MAX_FIELDS)
    return ESP_OK;
  const size_t n = strlen(event->header_key) + 1,
               v = strlen(event->header_value) + 1;
  if (s->fields_length + n + v > sizeof s->fields)
    return ESP_OK;
  /* Lower-case names; printable ASCII keeps the record valid JSON text. */
  char *name = s->fields + s->fields_length;
  for (size_t i = 0; i < n; ++i) {
    const unsigned char c = (unsigned char)event->header_key[i];
    name[i] = (char)(c >= 'A' && c <= 'Z'           ? c + 32
                     : !c || (c > 0x20 && c < 0x7f) ? c
                                                    : '?');
  }
  char *value = name + n;
  for (size_t i = 0; i < v; ++i) {
    const unsigned char c = (unsigned char)event->header_value[i];
    value[i] = (char)(!c || c == '\t' || (c >= 0x20 && c < 0x7f) ? c : '?');
  }
  s->fields_length += n + v;
  ++s->field_count;
  return ESP_OK;
}

static const char *field(const slot *s, const char *name) {
  for (size_t at = 0; at < s->fields_length;) {
    const char *key = s->fields + at, *value = key + strlen(key) + 1;
    if (!strcmp(key, name))
      return value;
    at = (size_t)(value + strlen(value) + 1 - s->fields);
  }
  return NULL;
}

/* esp_http_client_open failed: name the failure from esp-tls's last error. */
static int32_t connect_failed(slot *s, esp_http_client_handle_t client,
                              const char *host, esp_err_t result) {
  int code = 0, flags = 0;
  const esp_err_t last =
      esp_http_client_get_and_clear_last_tls_error(client, &code, &flags);
  if (cancelled(s))
    return POCKET_WORKER_CANCELLED;
  if (result == ESP_ERR_HTTP_WRITE_DATA)
    return failure(s, POCKET_WORKER_UNKNOWN,
                   "connect: the connection to %s closed while sending the "
                   "request",
                   host);
  if (!remaining_ms(s) || last == ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT)
    return failure(s, POCKET_WORKER_FAILED, "timeout: no connection to %s",
                   host);
  if (last == ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME)
    return failure(s, POCKET_WORKER_FAILED, "dns: cannot resolve %s", host);
  if (last >= ESP_ERR_MBEDTLS_CERT_PARTLY_OK &&
      last < ESP_ERR_ESP_TLS_BASE + 0x100)
    return failure(s, POCKET_WORKER_FAILED,
                   "tls: %s with %s (mbedTLS -0x%04x, verify flags 0x%x)",
                   esp_err_to_name(last), host, (unsigned)-code,
                   (unsigned)flags);
  return failure(s, POCKET_WORKER_FAILED, "connect: %s to %s",
                 esp_err_to_name(last != ESP_OK ? last : result), host);
}

/* Stream the body as data facts of at most one record each. */
static int32_t read_body(slot *s, esp_http_client_handle_t client) {
  int32_t status;
  for (;;) {
    esp_http_client_set_timeout_ms(client, slice_ms(s));
    const int n = esp_http_client_read(client, s->record, sizeof s->record);
    if (n > 0) {
      if (s->delivered + (uint64_t)n > s->descriptor.max_bytes)
        return failure(s, POCKET_WORKER_FAILED,
                       "response_too_large: the response exceeds %u bytes",
                       (unsigned)s->descriptor.max_bytes);
      if (!emit(s, POCKET_WORKER_DATA, POCKET_WORKER_OK, s->delivered,
                s->record, (size_t)n))
        return stopped(s, "the worker did not take the response", &status)
                   ? status
                   : POCKET_WORKER_FAILED;
      s->delivered += (uint64_t)n;
    } else if (n == 0) {
      if (esp_http_client_is_complete_data_received(client))
        return POCKET_WORKER_OK;
      return failure(s, POCKET_WORKER_FAILED,
                     "protocol: the response ended before its declared "
                     "length");
    } else if (n == -ESP_ERR_HTTP_EAGAIN) {
      if (stopped(s, "the response body did not finish", &status))
        return status;
    } else {
      return failure(s, POCKET_WORKER_FAILED,
                     "connect: the connection closed while reading the "
                     "response");
    }
  }
}

/* One hop: the terminal status, or for a 3xx with a Location its code with
 * *redirect set and the target in `location`. The hop goes out on the
 * connection the task kept when that serves it, and its own connection is
 * kept when the whole response arrived and the server holds it open. */
static int32_t run_hop(slot *s, char *location, size_t capacity,
                       bool *redirect) {
  pocket_http_esp *d = s->driver;
  pocket_http_esp_url url;
  int32_t status = POCKET_WORKER_FAILED;
  if (!pocket_http_esp_url_parse(s->url, &url))
    return failure(s, POCKET_WORKER_FAILED,
                   "invalid_request: the url does not parse");
  if (url.https && d->config.clock_wait)
    while (!d->config.clock_wait(d->config.context, (uint32_t)slice_ms(s)))
      if (stopped(s, "the wall clock was not set", &status))
        return status;
  if (!remaining_ms(s))
    return failure(s, POCKET_WORKER_FAILED, "timeout: no connection to %s",
                   url.host);
  const pocket_http_esp_request *r = &s->descriptor;
  const char *agent =
      d->config.user_agent ? d->config.user_agent : "PocketJS/1";
  bool kept = take_connection(s, &url);
  bool keep = false;
  esp_http_client_handle_t client;
  for (;;) {
    s->fields_length = s->field_count = 0;
    if (kept) {
      if (esp_http_client_set_url(s->client, s->url) != ESP_OK) {
        drop_connection(s);
        kept = false;
        continue;
      }
      esp_http_client_set_method(s->client, METHODS[r->method]);
      esp_http_client_set_timeout_ms(s->client, (int)remaining_ms(s));
    } else {
      const esp_http_client_config_t config = {
          .url = s->url,
          .method = METHODS[r->method],
          .timeout_ms = (int)remaining_ms(s),
          .disable_auto_redirect = true,
          .event_handler = on_client_event,
          .user_data = s,
          .buffer_size = POCKET_HTTP_ESP_RECORD,
          /* The request line carries the whole path and query. */
          .buffer_size_tx = POCKET_HTTP_ESP_URL + 64,
          .user_agent = agent,
          .crt_bundle_attach = esp_crt_bundle_attach,
      };
      s->client = esp_http_client_init(&config);
      if (!s->client)
        return failure(s, POCKET_WORKER_FAILED,
                       "other: HTTP client allocation failed");
    }
    client = s->client;
    for (size_t at = 0; at < r->headers_length;) {
      const char *name = r->headers + at, *value = name + strlen(name) + 1;
      if (!pocket_http_esp_request_dropped(name))
        esp_http_client_set_header(client, name, value);
      at = (size_t)(value + strlen(value) + 1 - r->headers);
    }
    const esp_err_t opened = esp_http_client_open(client, (int)r->body_length);
    /* The request line and the headers are out, or the connection failed:
     * the client holds none of this request's fields for the next one. */
    for (size_t at = 0; at < r->headers_length;) {
      const char *name = r->headers + at, *value = name + strlen(name) + 1;
      if (!pocket_http_esp_request_dropped(name))
        esp_http_client_delete_header(client, name);
      at = (size_t)(value + strlen(value) + 1 - r->headers);
    }
    esp_http_client_set_header(client, "User-Agent", agent);
    if (opened != ESP_OK) {
      if (resend(s, &kept))
        continue;
      status = connect_failed(s, client, url.host, opened);
      goto done;
    }
    s->sent = true;
    bool lost = false;
    for (size_t written = 0; !lost && written < r->body_length;) {
      const int n = esp_http_client_write(client, r->body + written,
                                          (int)(r->body_length - written));
      if (n <= 0)
        lost = true;
      else
        written += (size_t)n;
    }
    if (lost) {
      if (resend(s, &kept))
        continue;
      status = failure(s, POCKET_WORKER_UNKNOWN,
                       "connect: the connection closed while sending the "
                       "request");
      goto done;
    }
    for (;;) {
      esp_http_client_set_timeout_ms(client, slice_ms(s));
      const int64_t fetched = esp_http_client_fetch_headers(client);
      if (fetched >= 0)
        break;
      if (fetched != -ESP_ERR_HTTP_EAGAIN) {
        lost = true;
        break;
      }
      if (stopped(s, "no response head arrived", &status))
        goto done;
    }
    if (!lost)
      break;
    if (resend(s, &kept))
      continue;
    status = failure(s, POCKET_WORKER_UNKNOWN,
                     "connect: the connection closed before the response "
                     "head");
    goto done;
  }
  const int code = esp_http_client_get_status_code(client);
  if (code < 100 || code > 599) {
    status =
        failure(s, POCKET_WORKER_FAILED, "protocol: malformed status %d", code);
    goto done;
  }
  const char *target = field(s, "location");
  if (code >= 300 && code < 400 && code != 304 && target) {
    if (strlen(target) >= capacity) {
      status = failure(s, POCKET_WORKER_FAILED,
                       "redirect: the location exceeds %u bytes",
                       (unsigned)capacity - 1);
      goto done;
    }
    strcpy(location, target);
    *redirect = true;
    status = code;
    goto done;
  }
  const int64_t declared = esp_http_client_get_content_length(client);
  const bool bodiless = r->method == POCKET_HTTP_ESP_HEAD || code < 200 ||
                        code == 204 || code == 304;
  if (!bodiless && declared > (int64_t)r->max_bytes) {
    status = failure(s, POCKET_WORKER_FAILED,
                     "response_too_large: the response is %lld bytes, limit %u",
                     (long long)declared, (unsigned)r->max_bytes);
    goto done;
  }
  const size_t head = pocket_http_esp_head(
      code, s->url, s->fields, s->fields_length, s->record, sizeof s->record);
  if (!head) {
    status = failure(s, POCKET_WORKER_FAILED,
                     "protocol: the response url does not fit the headers "
                     "record");
    goto done;
  }
  if (!emit(s, POCKET_WORKER_HEADERS, POCKET_WORKER_OK, 0, s->record, head)) {
    if (!stopped(s, "the worker did not take the response head", &status))
      status = POCKET_WORKER_FAILED;
    goto done;
  }
  status = bodiless ? POCKET_WORKER_OK : read_body(s, client);
  if (status == POCKET_WORKER_OK) {
    ESP_LOGI(TAG, "%.200s %d %lluB%s", s->url, code,
             (unsigned long long)s->delivered,
             kept ? " on the kept connection" : "");
    keep = !has_userinfo(s->url, &url) &&
           esp_http_client_is_complete_data_received(client) &&
           esp_http_client_is_persistent_connection(client);
  }
done:
  if (keep) {
    lock(d);
    s->origin = url;
    s->kept = true;
    unlock(d);
  } else {
    drop_connection(s);
  }
  return status;
}

/* Point the slot at a redirect target, rewriting the method and dropping
 * credentials as the companion's transport does. */
static bool follow(slot *s, int code, const char *location) {
  char next[POCKET_HTTP_ESP_URL];
  pocket_http_esp_url from, to;
  if (!pocket_http_esp_resolve(s->url, location, next, sizeof next) ||
      !pocket_http_esp_url_parse(s->url, &from) ||
      !pocket_http_esp_url_parse(next, &to))
    return false;
  pocket_http_esp_request *r = &s->descriptor;
  const bool rewritten = code == 303 || ((code == 301 || code == 302) &&
                                         r->method == POCKET_HTTP_ESP_POST);
  if (rewritten) {
    if (r->method != POCKET_HTTP_ESP_HEAD)
      r->method = POCKET_HTTP_ESP_GET;
    r->body_length = 0;
  }
  const bool crossed = !pocket_http_esp_same_origin(&from, &to);
  for (size_t at = 0; at < r->headers_length;) {
    char *name = r->headers + at;
    size_t span = strlen(name) + 1;
    span += strlen(name + span) + 1;
    const bool drop = (rewritten && !strcmp(name, "content-type")) ||
                      (crossed && (!strcmp(name, "authorization") ||
                                   !strcmp(name, "cookie")));
    if (drop) {
      memmove(name, name + span, r->headers_length - at - span);
      r->headers_length -= span;
    } else {
      at += span;
    }
  }
  strcpy(s->url, next);
  return true;
}

/* A request to companion.pocket: the companion transport performs it and
 * the task forwards its headers, data and end facts as they arrive. */
static int32_t perform_companion(slot *s) {
  const pocket_http_esp_companion *c = s->driver->config.companion;
  char error[160] = "";
  const uint32_t id =
      c->start(c->context, s->opened, s->opened_length, error, sizeof error);
  if (!id)
    return failure(s, POCKET_WORKER_FAILED, "%s",
                   error[0] ? error
                            : "unavailable: the companion took no request");
  s->sent = true;
  pocket_http_esp_fact *fact = &s->fact;
  int32_t status;
  for (;;) {
    if (stopped(s, "the companion did not finish the request", &status))
      break;
    if (!c->take(c->context, id, fact)) {
      vTaskDelay(pdMS_TO_TICKS(COMPANION_POLL_MS));
      continue;
    }
    if (fact->kind == POCKET_WORKER_END) {
      if (fact->status == POCKET_WORKER_OK)
        ESP_LOGI(TAG, "%.200s through the companion %lluB", s->url,
                 (unsigned long long)s->delivered);
      if (fact->status == POCKET_WORKER_OK || !fact->length)
        return fact->status;
      return failure(s, fact->status, "%.*s", (int)fact->length,
                     (const char *)fact->bytes);
    }
    if (!emit(s, fact->kind, fact->status, fact->offset, fact->bytes,
              fact->length)) {
      if (!stopped(s, "the worker did not take the response", &status))
        status = POCKET_WORKER_FAILED;
      break;
    }
    if (fact->kind == POCKET_WORKER_HEADERS)
      s->field_count = 1;
    else if (fact->kind == POCKET_WORKER_DATA)
      s->delivered = fact->offset + fact->length;
  }
  c->close(c->context, id);
  return status;
}

static int32_t perform(slot *s) {
  pocket_http_esp *d = s->driver;
  strcpy(s->url, s->descriptor.url);
  s->sent = false;
  s->delivered = 0;
  s->fields_length = s->field_count = 0;
  if (d->config.companion && pocket_http_esp_companion_url(s->url))
    return perform_companion(s);
  if (d->config.online && !d->config.online(d->config.context)) {
    drop_connection(s);
    return failure(s, POCKET_WORKER_FAILED,
                   "unavailable: the network has no address");
  }
  for (unsigned hop = 0;; ++hop) {
    char location[POCKET_HTTP_ESP_URL];
    bool redirect = false;
    const int32_t status = run_hop(s, location, sizeof location, &redirect);
    if (!redirect)
      return status;
    if (hop == POCKET_HTTP_ESP_REDIRECTS)
      return failure(s, POCKET_WORKER_FAILED,
                     "redirect: more than %u redirects",
                     POCKET_HTTP_ESP_REDIRECTS);
    if (!follow(s, status, location))
      return failure(s, POCKET_WORKER_FAILED, "redirect: bad location %.100s",
                     location);
  }
}

static void request_task(void *opaque) {
  slot *s = opaque;
  pocket_http_esp *d = s->driver;
  for (;;) {
    /* A kept connection is closed when no request starts within KEEP_MS. */
    if (!ulTaskNotifyTake(pdTRUE,
                          s->client ? pdMS_TO_TICKS(KEEP_MS) : portMAX_DELAY)) {
      drop_connection(s);
      continue;
    }
    lock(d);
    const bool quit = d->quit;
    unlock(d);
    if (quit)
      break;
    const int32_t status = perform(s);
    /* After a cancel or close the request is terminal already; finish still
     * ends the stream and releases the native request. Finish wakes the
     * worker's task, which may outrank this one and close the resource
     * before this task runs again: the mutex is held across both, so close
     * never finds a finished request still running. */
    lock(d);
    pocket_worker_finish(s->worker, s->handle, s->request, status,
                         s->delivered);
    s->phase = SLOT_DONE;
    unlock(d);
  }
  drop_connection(s);
  xSemaphoreGive(d->stopped);
  if (d->config.task_stack_caps)
    vTaskDeleteWithCaps(NULL);
  else
    vTaskDelete(NULL);
}

/* ---- driver callbacks, on the worker's owner task ---- */

static int32_t driver_open(void *opaque, pocket_worker *worker, uint32_t handle,
                           const uint8_t *bytes, size_t length) {
  pocket_http_esp *d = opaque;
  lock(d);
  slot *s = NULL;
  for (size_t i = 0; i < SLOTS && !s; ++i)
    if (d->slots[i].phase == SLOT_FREE)
      s = &d->slots[i];
  if (s) {
    s->phase = SLOT_OPEN;
    s->handle = handle;
    s->worker = worker;
    s->request = 0;
    s->cancel = false;
  }
  unlock(d);
  if (!s)
    return POCKET_WORKER_BUSY;
  /* An open slot belongs to this callback until start. */
  if (!pocket_http_esp_parse(bytes, length, &s->descriptor)) {
    lock(d);
    s->phase = SLOT_FREE;
    unlock(d);
    return POCKET_WORKER_INVALID;
  }
  /* The request goes to the free slot that keeps a connection to its origin,
   * when this one does not. */
  pocket_http_esp_url url;
  slot *keeper = NULL;
  if (pocket_http_esp_url_parse(s->descriptor.url, &url)) {
    lock(d);
    if (!(s->kept && pocket_http_esp_same_origin(&s->origin, &url)))
      for (size_t i = 0; i < SLOTS && !keeper; ++i)
        if (d->slots[i].phase == SLOT_FREE && d->slots[i].kept &&
            pocket_http_esp_same_origin(&d->slots[i].origin, &url))
          keeper = &d->slots[i];
    if (keeper) {
      keeper->phase = SLOT_OPEN;
      keeper->handle = handle;
      keeper->worker = worker;
      keeper->request = 0;
      keeper->cancel = false;
      keeper->descriptor = s->descriptor;
      s->phase = SLOT_FREE;
      s->handle = 0;
      s = keeper;
    }
    unlock(d);
  }
  memcpy(s->opened, bytes, length);
  s->opened_length = length;
  return POCKET_WORKER_OK;
}

static int32_t driver_validate(void *opaque, pocket_worker *worker,
                               uint32_t handle, uint32_t opcode,
                               const uint8_t *payload, size_t length,
                               size_t capacity) {
  (void)worker;
  (void)payload;
  (void)capacity;
  pocket_http_esp *d = opaque;
  lock(d);
  const slot *s = find(d, handle);
  const bool open = s && s->phase == SLOT_OPEN;
  unlock(d);
  return opcode == 1 && !length && open ? POCKET_WORKER_OK
                                        : POCKET_WORKER_INVALID;
}

static int32_t driver_start(void *opaque, pocket_worker *worker,
                            uint32_t handle, uint32_t request, uint32_t opcode,
                            const uint8_t *payload, size_t length,
                            size_t capacity) {
  (void)worker;
  (void)payload;
  (void)capacity;
  pocket_http_esp *d = opaque;
  if (opcode != 1 || length)
    return POCKET_WORKER_INVALID;
  lock(d);
  slot *s = find(d, handle);
  const bool start = s && s->phase == SLOT_OPEN;
  if (start) {
    s->phase = SLOT_RUNNING;
    s->request = request;
    s->deadline =
        esp_timer_get_time() + (int64_t)s->descriptor.timeout_ms * 1000;
  }
  unlock(d);
  if (!start)
    return POCKET_WORKER_INVALID;
  xTaskNotifyGive(s->task);
  return POCKET_WORKER_OK;
}

static void driver_cancel(void *opaque, pocket_worker *worker, uint32_t handle,
                          uint32_t request) {
  (void)worker;
  (void)request;
  pocket_http_esp *d = opaque;
  lock(d);
  slot *s = find(d, handle);
  if (s)
    s->cancel = true;
  unlock(d);
}

static int32_t driver_close(void *opaque, pocket_worker *worker,
                            uint32_t handle) {
  (void)worker;
  pocket_http_esp *d = opaque;
  lock(d);
  slot *s = find(d, handle);
  int32_t status = POCKET_WORKER_OK;
  if (s && s->phase == SLOT_RUNNING) {
    /* The core retries until the request task lets go. */
    s->cancel = true;
    status = POCKET_WORKER_BUSY;
  } else if (s) {
    s->phase = SLOT_FREE;
    s->handle = 0;
  }
  unlock(d);
  return status;
}

pocket_http_esp *pocket_http_esp_create(const pocket_http_esp_config *config) {
  if (!config || config->struct_size < sizeof(*config))
    return NULL;
  pocket_http_esp *d = heap_caps_calloc(
      1, sizeof(*d),
      config->memory_caps ? config->memory_caps
                          : MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  if (!d)
    return NULL;
  d->config = *config;
  d->mutex = xSemaphoreCreateMutex();
  d->stopped = xSemaphoreCreateCounting(SLOTS, 0);
  size_t started = 0;
  for (; d->mutex && d->stopped && started < SLOTS; ++started) {
    slot *s = &d->slots[started];
    s->driver = d;
    const BaseType_t created =
        config->task_stack_caps
            ? xTaskCreatePinnedToCoreWithCaps(
                  request_task, "pocket_http", TASK_STACK, s,
                  config->task_priority, &s->task, config->task_core,
                  config->task_stack_caps)
            : xTaskCreatePinnedToCore(request_task, "pocket_http", TASK_STACK,
                                      s, config->task_priority, &s->task,
                                      config->task_core);
    if (created != pdPASS)
      break;
  }
  if (started < SLOTS) {
    lock(d);
    d->quit = true;
    unlock(d);
    for (size_t i = 0; i < started; ++i) {
      xTaskNotifyGive(d->slots[i].task);
      xSemaphoreTake(d->stopped, portMAX_DELAY);
    }
    if (d->mutex)
      vSemaphoreDelete(d->mutex);
    if (d->stopped)
      vSemaphoreDelete(d->stopped);
    heap_caps_free(d);
    return NULL;
  }
  /* A request task waits for the response in SLICE_MS reads, and
   * esp_http_client warns of each read that times out. */
  esp_log_level_set("HTTP_CLIENT", ESP_LOG_ERROR);
  d->vtable = (pocket_worker_driver){.struct_size = sizeof(d->vtable),
                                     .context = d,
                                     .open = driver_open,
                                     .start = driver_start,
                                     .cancel = driver_cancel,
                                     .close = driver_close,
                                     .validate = driver_validate};
  return d;
}

const pocket_worker_driver *pocket_http_esp_driver(pocket_http_esp *driver) {
  return driver ? &driver->vtable : NULL;
}

int32_t pocket_http_esp_destroy(pocket_http_esp *d) {
  if (!d)
    return POCKET_WORKER_OK;
  lock(d);
  for (size_t i = 0; i < SLOTS; ++i)
    if (d->slots[i].phase != SLOT_FREE) {
      unlock(d);
      return POCKET_WORKER_BUSY;
    }
  d->quit = true;
  unlock(d);
  for (size_t i = 0; i < SLOTS; ++i) {
    xTaskNotifyGive(d->slots[i].task);
    xSemaphoreTake(d->stopped, portMAX_DELAY);
  }
  vSemaphoreDelete(d->stopped);
  vSemaphoreDelete(d->mutex);
  heap_caps_free(d);
  return POCKET_WORKER_OK;
}
