#include "esp_crt_bundle.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_tls_errors.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "mqtt_client.h"
#include "pocket/mqtt_esp.h"
#include "record.h"
#include "sdkconfig.h"
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#if !CONFIG_MQTT_PROTOCOL_5
#error "pocket_mqtt_esp needs CONFIG_MQTT_PROTOCOL_5"
#endif
#if !CONFIG_MQTT_REPORT_DELETED_MESSAGES
#error "pocket_mqtt_esp needs CONFIG_MQTT_REPORT_DELETED_MESSAGES"
#endif

/* Sessions at once. A closed session releases the worker at once and keeps
 * its slot until its esp-mqtt client stopped. */
#define SLOTS 3u
#define REQUESTS POCKET_WORKER_MAX_REQUESTS
#define EARLY 8u
#define CONTROL_STACK 8192u
#define CLIENT_STACK 8192
/* esp-mqtt's input and output buffers; the topic and properties of an
 * incoming PUBLISH must fit the input buffer. */
#define CLIENT_BUFFER 4096
#define HEAD_BYTES 4096u
/* How long the handler holds a message for a worker whose event slots are
 * full, and how long once a message was dropped and the gap is unseen. */
#define DELIVERY_WAIT_US 2000000
#define BEHIND_WAIT_US 100000
/* With esp-mqtt's own reconnect off, how often its task looks for a stop
 * while it waits; the control task schedules reconnects. */
#define IDLE_POLL_MS 200
/* The outbox holds QoS 1 and 2 messages until acknowledged. */
#define OUTBOX_LIMIT (512u * 1024u)
/* CONFIG_MQTT_OUTBOX_EXPIRED_TIMEOUT_MS without the custom configuration. */
#ifndef CONFIG_MQTT_OUTBOX_EXPIRED_TIMEOUT_MS
#define CONFIG_MQTT_OUTBOX_EXPIRED_TIMEOUT_MS 30000
#endif

static const char *TAG = "pocket_mqtt";

typedef enum {
  SLOT_FREE,
  /* Waiting for the TLS material the descriptor announced. */
  SLOT_CREDENTIALS,
  SLOT_STARTING,
  SLOT_RUNNING,
} slot_phase;

typedef enum {
  REQUEST_QUEUED = 1,
  REQUEST_EXECUTING,
  REQUEST_SENT
} request_state;

typedef struct {
  uint32_t id;
  request_state state;
  uint32_t opcode;
  bool cancelled;
  /* A copy: a closed resource releases the core's request storage while the
   * control task may still execute it. */
  uint8_t payload[POCKET_WORKER_MAX_PAYLOAD];
  size_t length, capacity;
  /* Packets sent, and the result bytes of a success: 1 for a publish, a
   * code per filter otherwise. */
  uint8_t count, filters;
  int msg_id[POCKET_MQTT_ESP_FILTERS];
  bool acked[POCKET_MQTT_ESP_FILTERS], lost[POCKET_MQTT_ESP_FILTERS];
  uint8_t codes[POCKET_MQTT_ESP_FILTERS];
} request;

typedef enum {
  ACK_PUBLISHED,
  ACK_SUBSCRIBED,
  ACK_UNSUBSCRIBED,
  ACK_DELETED
} ack_kind;

/* An acknowledgement that arrived before the control task recorded the
 * packet identifier it belongs to. */
typedef struct {
  bool used;
  int msg_id;
  ack_kind kind;
  uint8_t count;
  uint8_t codes[POCKET_MQTT_ESP_FILTERS];
} early_ack;

/* The control task's parsed request; one at a time. */
typedef union {
  pocket_mqtt_esp_publish publish;
  pocket_mqtt_esp_subscribe subscribe;
  pocket_mqtt_esp_disconnect disconnect;
} parsed;

typedef struct slot {
  struct pocket_mqtt_esp *driver;
  TaskHandle_t task;
  /* Shared under the driver mutex. */
  slot_phase phase;
  pocket_worker *worker;
  uint32_t handle;
  /* Between open and close the session may call into the worker core;
   * every such call checks this under the driver mutex. */
  bool attached;
  bool stopping, end_pending, ended, started;
  int64_t reconnect_at;
  request requests[REQUESTS];
  early_ack early[EARLY];
  unsigned early_next;
  uint8_t *stage;
  size_t stage_used, stage_capacity;
  bool stage_locked;
  uint8_t *credentials;
  size_t credentials_used, credentials_total;
  /* Set by the event handler, read by the control task. */
  bool connected;
  uint8_t maximum_qos;
  bool retain_available;
  /* Owned by the control task. */
  pocket_mqtt_esp_open *open;
  parsed *scratch;
  esp_mqtt_client_handle_t client;
  esp_mqtt5_publish_property_config_t publish_property;
  esp_mqtt5_subscribe_property_config_t subscribe_property;
  esp_mqtt5_unsubscribe_property_config_t unsubscribe_property;
  /* Owned by the event handler on the esp-mqtt task. */
  bool attempting, fatal, behind;
  char error[200];
  uint64_t delivered;
  struct {
    bool active;
    uint64_t total, offset;
  } message;
  uint8_t *head;
  uint8_t *fact;
  size_t fact_length;
  uint8_t *record;
} slot;

struct pocket_mqtt_esp {
  pocket_worker_driver vtable;
  pocket_mqtt_esp_config config;
  SemaphoreHandle_t mutex, stopped;
  bool quit;
  /* The owner task's validation scratch. */
  parsed *check;
  slot slots[SLOTS];
};

static void lock(pocket_mqtt_esp *d) {
  xSemaphoreTake(d->mutex, portMAX_DELAY);
}
static void unlock(pocket_mqtt_esp *d) { xSemaphoreGive(d->mutex); }

static void *allocate(pocket_mqtt_esp *d, size_t size) {
  return heap_caps_calloc(1, size,
                          d->config.memory_caps
                              ? d->config.memory_caps
                              : MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
}

static slot *find(pocket_mqtt_esp *d, uint32_t handle) {
  for (size_t i = 0; i < SLOTS; ++i)
    if (d->slots[i].phase != SLOT_FREE && d->slots[i].handle == handle)
      return &d->slots[i];
  return NULL;
}

static bool v5(const slot *s) {
  return s->open->protocol == POCKET_MQTT_ESP_V5;
}

/* ---- completions; the driver mutex is held ---- */

static void finish(slot *s, request *q, int32_t status, const uint8_t *result,
                   size_t length) {
  if (length > q->capacity)
    length = q->capacity;
  if (s->attached)
    pocket_worker_complete(s->worker, q->id, status, result, length);
  memset(q, 0, sizeof *q);
}

__attribute__((format(printf, 4, 5))) static void
fail(slot *s, request *q, int32_t status, const char *format, ...) {
  char text[160];
  va_list arguments;
  va_start(arguments, format);
  const int n = vsnprintf(text, sizeof text, format, arguments);
  va_end(arguments);
  const size_t length = n < 0                     ? 0
                        : (size_t)n < sizeof text ? (size_t)n
                                                  : sizeof text - 1;
  ESP_LOGW(TAG, "request %u: %s", (unsigned)q->id, text);
  finish(s, q, status, (const uint8_t *)text, length);
}

static void record_ack(request *q, uint8_t k, ack_kind kind,
                       const uint8_t *codes, uint8_t count) {
  q->acked[k] = true;
  if (kind == ACK_DELETED)
    q->lost[k] = true;
  else if (q->opcode == POCKET_MQTT_ESP_SUBSCRIBE)
    /* One SUBACK carries a code per filter of the request. */
    for (uint8_t f = 0; f < POCKET_MQTT_ESP_FILTERS; ++f)
      q->codes[f] = f < count ? codes[f] : 0x80;
  else
    q->codes[k] = count ? codes[0] : 0;
}

/* Completes a sent request once every packet it sent was acknowledged or
 * expired in the outbox. */
static void try_finish(slot *s, request *q) {
  bool lost = false;
  for (uint8_t k = 0; k < q->count; ++k) {
    if (!q->acked[k])
      return;
    lost = lost || q->lost[k];
  }
  if (lost)
    fail(s, q, POCKET_WORKER_UNKNOWN,
         "timeout: the broker did not acknowledge within %u ms",
         (unsigned)CONFIG_MQTT_OUTBOX_EXPIRED_TIMEOUT_MS);
  else if (q->opcode == POCKET_MQTT_ESP_PUBLISH && q->codes[0] >= 0x80)
    fail(s, q, POCKET_WORKER_FAILED, "refused: %s (0x%02x)",
         pocket_mqtt_esp_reason_name(s->open->protocol, q->codes[0]),
         q->codes[0]);
  else
    finish(s, q, POCKET_WORKER_OK, q->codes, q->filters);
}

/* Applies an acknowledgement to the sent request that owns its packet
 * identifier; false when none does yet. */
static bool apply(slot *s, int msg_id, ack_kind kind, const uint8_t *codes,
                  uint8_t count) {
  for (size_t i = 0; i < REQUESTS; ++i) {
    request *q = &s->requests[i];
    if (!q->id || q->state != REQUEST_SENT)
      continue;
    for (uint8_t k = 0; k < q->count; ++k)
      if (q->msg_id[k] == msg_id && !q->acked[k]) {
        record_ack(q, k, kind, codes, count);
        try_finish(s, q);
        return true;
      }
  }
  return false;
}

/* The control task recorded the packet identifiers of an executed request:
 * acknowledgements that arrived meanwhile apply now. */
static void settle_sent(slot *s, request *q) {
  q->state = REQUEST_SENT;
  for (uint8_t k = 0; k < q->count; ++k)
    for (size_t e = 0; e < EARLY && !q->acked[k]; ++e) {
      early_ack *a = &s->early[e];
      if (a->used && q->msg_id[k] > 0 && a->msg_id == q->msg_id[k]) {
        a->used = false;
        record_ack(q, k, a->kind, a->codes, a->count);
      }
    }
  try_finish(s, q);
}

/* ---- the esp-mqtt event handler, on the client's task ---- */

static bool stopping(slot *s) {
  lock(s->driver);
  const bool stop = s->stopping;
  unlock(s->driver);
  return stop;
}

/* One fact. While the worker's event slots are full the handler waits,
 * which stops the client's socket reads; it gives up on a stop, when the
 * worker closed the resource, or after `budget_us` (negative: no limit). */
static bool emit(slot *s, uint32_t kind, int32_t status, uint64_t offset,
                 const void *bytes, size_t length, int64_t budget_us) {
  const int64_t started = esp_timer_get_time();
  for (;;) {
    lock(s->driver);
    const int32_t result =
        s->attached ? pocket_worker_emit(s->worker, s->handle, kind, status,
                                         offset, bytes, length)
                    : POCKET_WORKER_INVALID;
    unlock(s->driver);
    if (result != POCKET_WORKER_BUSY)
      return result == POCKET_WORKER_OK;
    if (stopping(s) ||
        (budget_us >= 0 && esp_timer_get_time() - started >= budget_us))
      return false;
    vTaskDelay(1);
  }
}

static void received_properties(const esp_mqtt_event_t *e,
                                pocket_mqtt_esp_received *out,
                                esp_mqtt5_user_property_item_t *items,
                                const char **keys, const char **values,
                                uint8_t *count) {
  memset(out, 0, sizeof *out);
  *count = 0;
  if (e->protocol_ver != MQTT_PROTOCOL_V_5 || !e->property)
    return;
  const esp_mqtt5_event_property_t *p = e->property;
  if (e->event_id == MQTT_EVENT_DATA) {
    out->has_payload_format = p->payload_format_indicator;
    out->payload_format = p->payload_format_indicator ? 1 : 0;
    if (p->content_type && p->content_type_len > 0) {
      out->content_type = p->content_type;
      out->content_type_length = (size_t)p->content_type_len;
    }
    if (p->response_topic && p->response_topic_len > 0) {
      out->response_topic = p->response_topic;
      out->response_topic_length = (size_t)p->response_topic_len;
    }
    if (p->correlation_data && p->correlation_data_len) {
      out->correlation_data = p->correlation_data;
      out->correlation_data_length = p->correlation_data_len;
    }
    out->subscription_id = p->subscribe_id;
  } else if (p->server.response_info) {
    out->response_information = p->server.response_info;
  }
  uint8_t n = esp_mqtt5_client_get_user_property_count(p->user_property);
  if (n > POCKET_MQTT_ESP_USER_PROPERTIES)
    n = POCKET_MQTT_ESP_USER_PROPERTIES;
  if (n && esp_mqtt5_client_get_user_property(p->user_property, items, &n) ==
               ESP_OK) {
    for (uint8_t i = 0; i < n; ++i) {
      keys[i] = items[i].key;
      values[i] = items[i].value;
    }
    *count = n;
    out->user_count = n;
    out->user_key = keys;
    out->user_value = values;
  }
}

static void free_items(esp_mqtt5_user_property_item_t *items, uint8_t count) {
  for (uint8_t i = 0; i < count; ++i) {
    free((char *)items[i].key);
    free((char *)items[i].value);
  }
}

static void on_connected(slot *s, const esp_mqtt_event_t *e) {
  s->attempting = false;
  s->fatal = false;
  s->error[0] = '\0';
  pocket_mqtt_esp_connack ack = {
      .session_present = e->session_present != 0,
      .protocol = s->open->protocol,
      .maximum_qos = 2,
      .receive_maximum = 65535,
      .retain = true,
      .wildcard = true,
  };
  if (e->protocol_ver == MQTT_PROTOCOL_V_5 && e->property) {
    const esp_mqtt5_server_resp_property_t *server = &e->property->server;
    ack.maximum_qos = server->max_qos;
    ack.maximum_packet = server->maximum_packet_size;
    ack.receive_maximum = server->receive_maximum;
    ack.topic_alias_maximum = server->topic_alias_maximum;
    ack.retain = server->retain_available;
    ack.wildcard = server->wildcard_subscribe_available;
    ack.subscription_ids = server->subscribe_identifiers_available;
    ack.shared = server->shared_subscribe_available;
  }
  lock(s->driver);
  s->connected = true;
  s->maximum_qos = ack.maximum_qos;
  s->retain_available = ack.retain;
  unlock(s->driver);
  esp_mqtt5_user_property_item_t items[POCKET_MQTT_ESP_USER_PROPERTIES];
  const char *keys[POCKET_MQTT_ESP_USER_PROPERTIES];
  const char *values[POCKET_MQTT_ESP_USER_PROPERTIES];
  uint8_t count;
  pocket_mqtt_esp_received props;
  received_properties(e, &props, items, keys, values, &count);
  const size_t length = pocket_mqtt_esp_connack_record(&ack, &props, s->record,
                                                       POCKET_MQTT_ESP_RECORD);
  free_items(items, count);
  ESP_LOGI(TAG, "%s connected (MQTT %s, session %s)", s->open->url.data,
           v5(s) ? "5" : "3.1.1", ack.session_present ? "present" : "new");
  emit(s, POCKET_WORKER_HEADERS, POCKET_WORKER_OK, 0, s->record, length, -1);
}

__attribute__((format(printf, 2, 3))) static void
note(slot *s, const char *format, ...) {
  va_list arguments;
  va_start(arguments, format);
  vsnprintf(s->error, sizeof s->error, format, arguments);
  va_end(arguments);
}

static void on_error(slot *s, const esp_mqtt_event_t *e) {
  const esp_mqtt_error_codes_t *error = e->error_handle;
  const pocket_mqtt_esp_config *config = &s->driver->config;
  if (!error)
    return;
  if (error->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) {
    const int code = (int)error->connect_return_code;
    s->fatal = !pocket_mqtt_esp_refusal_transient(s->open->protocol, code);
    note(s, "refused: %s (%s 0x%02x)",
         pocket_mqtt_esp_reason_name(s->open->protocol, code),
         v5(s) ? "reason" : "return code", code);
    return;
  }
  if (error->error_type != MQTT_ERROR_TYPE_TCP_TRANSPORT)
    return;
  const esp_err_t last = error->esp_tls_last_esp_err;
  if (config->online && !config->online(config->context))
    note(s, "unavailable: the network has no address");
  else if (last == ESP_ERR_ESP_TLS_CANNOT_RESOLVE_HOSTNAME)
    note(s, "dns: cannot resolve the host of %s", s->open->url.data);
  else if (last == ESP_ERR_ESP_TLS_CONNECTION_TIMEOUT)
    note(s, "timeout: no connection to %s within %u ms", s->open->url.data,
         (unsigned)s->open->timeout_ms);
  else if (error->esp_tls_stack_err || error->esp_tls_cert_verify_flags ||
           (last >= ESP_ERR_MBEDTLS_CERT_PARTLY_OK &&
            last < ESP_ERR_ESP_TLS_BASE + 0x100 &&
            last != ESP_ERR_ESP_TLS_FAILED_CONNECT_TO_HOST &&
            last != ESP_ERR_ESP_TLS_CANNOT_CREATE_SOCKET))
    note(s, "tls: %s with %s (mbedTLS -0x%04x, verify flags 0x%x)",
         esp_err_to_name(last), s->open->url.data,
         (unsigned)-error->esp_tls_stack_err,
         (unsigned)error->esp_tls_cert_verify_flags);
  else
    note(s, "connect: %s to %s (errno %d)",
         last ? esp_err_to_name(last) : "transport error", s->open->url.data,
         error->esp_transport_sock_errno);
}

/* A record cut short by a drop or a disconnection is never completed; the
 * gap tells the worker to discard it. */
static void drop_message(slot *s) {
  s->message.active = false;
  s->fact_length = 0;
  s->behind = true;
  lock(s->driver);
  if (s->attached)
    pocket_worker_gap(s->worker, s->handle, s->delivered, 1);
  unlock(s->driver);
}

static void on_disconnected(slot *s, const esp_mqtt_event_t *e) {
  const pocket_mqtt_esp_config *config = &s->driver->config;
  lock(s->driver);
  const bool was_connected = s->connected;
  s->connected = false;
  unlock(s->driver);
  if (!was_connected && !s->attempting)
    return; /* the transport abort after a broker DISCONNECT */
  s->attempting = false;
  if (s->message.active)
    drop_message(s);
  /* A DISCONNECT from the broker arrives while the transport is open. */
  if (was_connected && e->protocol_ver == MQTT_PROTOCOL_V_5 &&
      esp_mqtt_client_get_state(s->client) == MQTT_CLIENT_STATE_CONNECTED)
    note(s, "closed: the broker sent DISCONNECT: %s (0x%02x)",
         pocket_mqtt_esp_reason_name(POCKET_MQTT_ESP_V5, (int)e->reason_code),
         (unsigned)e->reason_code);
  else if (!s->error[0] && was_connected)
    note(s, "closed: the connection to %s closed", s->open->url.data);
  else if (!s->error[0] && config->online && !config->online(config->context))
    note(s, "unavailable: the network has no address");
  else if (!s->error[0])
    note(s, "connect: no CONNACK from %s", s->open->url.data);
  ESP_LOGW(TAG, "%s", s->error);
  emit(s, POCKET_WORKER_ERROR, POCKET_WORKER_FAILED, s->delivered, s->error,
       strlen(s->error), -1);
  s->error[0] = '\0';
  lock(s->driver);
  if (s->fatal || !s->open->reconnect_ms)
    s->end_pending = true;
  else
    s->reconnect_at =
        esp_timer_get_time() + (int64_t)s->open->reconnect_ms * 1000;
  unlock(s->driver);
  xTaskNotifyGive(s->task);
}

/* Appends record bytes to the pending data fact and emits each full one. */
static bool put(slot *s, const uint8_t *bytes, size_t length) {
  while (length && s->message.active) {
    const size_t room = POCKET_MQTT_ESP_RECORD - s->fact_length;
    const size_t n = length < room ? length : room;
    memcpy(s->fact + s->fact_length, bytes, n);
    s->fact_length += n;
    bytes += n;
    length -= n;
    const bool last = s->message.offset + s->fact_length == s->message.total;
    if (s->fact_length < POCKET_MQTT_ESP_RECORD && !last)
      break;
    const int64_t budget =
        s->message.offset == 0 && s->behind ? BEHIND_WAIT_US : DELIVERY_WAIT_US;
    if (!emit(s, POCKET_WORKER_DATA, POCKET_WORKER_OK, s->message.offset,
              s->fact, s->fact_length, budget)) {
      if (!stopping(s))
        drop_message(s);
      return false;
    }
    s->behind = false;
    s->message.offset += s->fact_length;
    s->fact_length = 0;
    if (last) {
      s->message.active = false;
      ++s->delivered;
    }
  }
  return true;
}

static void on_data(slot *s, const esp_mqtt_event_t *e) {
  if (e->current_data_offset == 0) {
    if (s->message.active)
      drop_message(s);
    const uint32_t payload =
        e->total_data_len > 0 ? (uint32_t)e->total_data_len : 0;
    if (payload > s->open->max_message || e->topic_len <= 0) {
      ESP_LOGW(TAG, "dropped a %u-byte message (limit %u)", (unsigned)payload,
               (unsigned)s->open->max_message);
      drop_message(s);
      return;
    }
    esp_mqtt5_user_property_item_t items[POCKET_MQTT_ESP_USER_PROPERTIES];
    const char *keys[POCKET_MQTT_ESP_USER_PROPERTIES];
    const char *values[POCKET_MQTT_ESP_USER_PROPERTIES];
    uint8_t count;
    pocket_mqtt_esp_received props;
    received_properties(e, &props, items, keys, values, &count);
    const uint8_t flags =
        (uint8_t)((e->qos & 3) | (e->retain ? 4 : 0) | (e->dup ? 8 : 0));
    const size_t head = pocket_mqtt_esp_message_head(
        flags, payload, e->topic, (size_t)e->topic_len, &props, s->head,
        HEAD_BYTES);
    free_items(items, count);
    if (!head) {
      ESP_LOGW(TAG,
               "dropped a message whose topic and properties exceed %u "
               "bytes",
               (unsigned)HEAD_BYTES);
      drop_message(s);
      return;
    }
    s->message.active = true;
    s->message.total = head + payload;
    s->message.offset = 0;
    s->fact_length = 0;
    if (!put(s, s->head, head))
      return;
  }
  if (s->message.active && e->data_len > 0)
    put(s, (const uint8_t *)e->data, (size_t)e->data_len);
}

static void acknowledge(slot *s, int msg_id, ack_kind kind,
                        const uint8_t *codes, size_t count) {
  if (msg_id <= 0)
    return;
  if (count > POCKET_MQTT_ESP_FILTERS)
    count = POCKET_MQTT_ESP_FILTERS;
  lock(s->driver);
  if (!apply(s, msg_id, kind, codes, (uint8_t)count)) {
    early_ack *a = &s->early[s->early_next++ % EARLY];
    *a = (early_ack){
        .used = true, .msg_id = msg_id, .kind = kind, .count = (uint8_t)count};
    if (count)
      memcpy(a->codes, codes, count);
  }
  unlock(s->driver);
}

static void on_event(void *argument, esp_event_base_t base, int32_t id,
                     void *data) {
  (void)base;
  slot *s = argument;
  const esp_mqtt_event_t *e = data;
  uint8_t code;
  switch ((esp_mqtt_event_id_t)id) {
  case MQTT_EVENT_BEFORE_CONNECT:
    s->attempting = true;
    s->error[0] = '\0';
    break;
  case MQTT_EVENT_CONNECTED:
    on_connected(s, e);
    break;
  case MQTT_EVENT_ERROR:
    on_error(s, e);
    break;
  case MQTT_EVENT_DISCONNECTED:
    on_disconnected(s, e);
    break;
  case MQTT_EVENT_DATA:
    on_data(s, e);
    break;
  case MQTT_EVENT_PUBLISHED:
    code = e->protocol_ver == MQTT_PROTOCOL_V_5 ? (uint8_t)e->reason_code : 0;
    acknowledge(s, e->msg_id, ACK_PUBLISHED, &code, 1);
    break;
  case MQTT_EVENT_SUBSCRIBED:
    acknowledge(s, e->msg_id, ACK_SUBSCRIBED, (const uint8_t *)e->data,
                e->data && e->data_len > 0 ? (size_t)e->data_len : 0);
    break;
  case MQTT_EVENT_UNSUBSCRIBED:
    acknowledge(s, e->msg_id, ACK_UNSUBSCRIBED, (const uint8_t *)e->data,
                e->protocol_ver == MQTT_PROTOCOL_V_5 && e->data &&
                        e->data_len > 0
                    ? (size_t)e->data_len
                    : 0);
    break;
  case MQTT_EVENT_DELETED:
    acknowledge(s, e->msg_id, ACK_DELETED, NULL, 0);
    break;
  default:
    break;
  }
}

/* ---- the control task ---- */

static void delete_user_properties(mqtt5_user_property_handle_t *list) {
  if (*list) {
    esp_mqtt5_client_delete_user_property(*list);
    *list = NULL;
  }
}

static bool user_properties(const pocket_mqtt_esp_properties *p,
                            mqtt5_user_property_handle_t *list) {
  *list = NULL;
  if (!p->user_count)
    return true;
  esp_mqtt5_user_property_item_t items[POCKET_MQTT_ESP_USER_PROPERTIES];
  for (uint8_t i = 0; i < p->user_count; ++i)
    items[i] = (esp_mqtt5_user_property_item_t){.key = p->user_key[i].data,
                                                .value = p->user_value[i].data};
  return esp_mqtt5_client_set_user_property(list, items, p->user_count) ==
         ESP_OK;
}

/* PEM is passed NUL-terminated with length 0, DER with its length. */
static const char *credential(slot *s, size_t offset, size_t length,
                              size_t *pass) {
  if (!length)
    return NULL;
  const char *data = (const char *)s->credentials + offset;
  *pass = length >= 10 && !memcmp(data, "-----BEGIN", 10) ? 0 : length;
  return data;
}

/* Ends a session that will not reconnect: the error fact came first. */
static void end_session(slot *s) {
  if (s->client) {
    esp_mqtt_client_stop(s->client);
    esp_mqtt_client_destroy(s->client);
    s->client = NULL;
  }
  lock(s->driver);
  s->ended = true;
  s->end_pending = false;
  s->reconnect_at = 0;
  s->connected = false;
  for (size_t i = 0; i < REQUESTS; ++i) {
    request *q = &s->requests[i];
    if (q->id && q->state == REQUEST_QUEUED)
      fail(s, q, POCKET_WORKER_FAILED, "unavailable: the session ended");
    else if (q->id)
      fail(s, q, POCKET_WORKER_UNKNOWN,
           "unavailable: the session ended before the acknowledgement");
  }
  s->stage_used = 0;
  s->stage_locked = false;
  if (s->attached)
    pocket_worker_end(s->worker, s->handle, POCKET_WORKER_FAILED, s->delivered);
  unlock(s->driver);
}

__attribute__((format(printf, 2, 3))) static void
start_failed(slot *s, const char *format, ...) {
  char text[160];
  va_list arguments;
  va_start(arguments, format);
  const int n = vsnprintf(text, sizeof text, format, arguments);
  va_end(arguments);
  ESP_LOGW(TAG, "%s", text);
  emit(s, POCKET_WORKER_ERROR, POCKET_WORKER_FAILED, 0, text,
       n < 0                     ? 0
       : (size_t)n < sizeof text ? (size_t)n
                                 : sizeof text - 1,
       -1);
  end_session(s);
}

static void start_session(slot *s) {
  pocket_mqtt_esp *d = s->driver;
  const pocket_mqtt_esp_open *o = s->open;
  if (o->secure && d->config.clock_wait)
    while (!d->config.clock_wait(d->config.context, 500))
      if (stopping(s))
        return;
  size_t ca_pass = 0, certificate_pass = 0, key_pass = 0;
  const char *ca = credential(s, 0, o->ca_bytes, &ca_pass);
  const char *certificate = credential(s, (size_t)o->ca_bytes + 1,
                                       o->certificate_bytes, &certificate_pass);
  const char *key =
      credential(s, (size_t)o->ca_bytes + 1 + o->certificate_bytes + 1,
                 o->key_bytes, &key_pass);
  const bool will = o->flags & POCKET_MQTT_ESP_WILL;
  const esp_mqtt_client_config_t config = {
      .broker =
          {
              .address.uri = o->url.data,
              .verification =
                  {
                      .crt_bundle_attach =
                          o->secure && !ca ? esp_crt_bundle_attach : NULL,
                      .certificate = ca,
                      .certificate_len = ca_pass,
                      .common_name =
                          o->common_name.length ? o->common_name.data : NULL,
                      .alpn_protos = o->alpn[0] ? (const char **)o->alpn : NULL,
                  },
          },
      .credentials =
          {
              .username = o->username.length ? o->username.data : NULL,
              .client_id = o->client_id.length ? o->client_id.data : NULL,
              .set_null_client_id =
                  (o->flags & POCKET_MQTT_ESP_NULL_CLIENT_ID) != 0,
              .authentication =
                  {
                      .password = o->password.length ? o->password.data : NULL,
                      .certificate = certificate,
                      .certificate_len = certificate_pass,
                      .key = key,
                      .key_len = key_pass,
                      .key_password =
                          o->key_password.length ? o->key_password.data : NULL,
                      .key_password_len = o->key_password.length,
                  },
          },
      .session =
          {
              .last_will =
                  {
                      .topic = will ? o->will_topic.data : NULL,
                      .msg = will ? o->will_payload.data : NULL,
                      .msg_len = will ? o->will_payload.length : 0,
                      .qos = o->will_qos,
                      .retain = (o->flags & POCKET_MQTT_ESP_WILL_RETAIN) != 0,
                  },
              .disable_clean_session =
                  !(o->flags & POCKET_MQTT_ESP_CLEAN_START),
              .keepalive = o->keepalive,
              .disable_keepalive = o->keepalive == 0,
              .protocol_ver = o->protocol == POCKET_MQTT_ESP_V5
                                  ? MQTT_PROTOCOL_V_5
                                  : MQTT_PROTOCOL_V_3_1_1,
          },
      .network =
          {
              .reconnect_timeout_ms = IDLE_POLL_MS,
              .timeout_ms = (int)o->timeout_ms,
              .disable_auto_reconnect = true,
          },
      .task =
          {
              .priority = (int)d->config.client_priority,
              .stack_size = d->config.client_stack ? (int)d->config.client_stack
                                                   : CLIENT_STACK,
          },
      .buffer = {.size = CLIENT_BUFFER, .out_size = CLIENT_BUFFER},
      .outbox = {.limit = OUTBOX_LIMIT},
  };
  esp_mqtt_client_handle_t client = esp_mqtt_client_init(&config);
  if (!client) {
    start_failed(s, "invalid_request: the client does not accept %s",
                 o->url.data);
    return;
  }
  s->client = client;
  if (v5(s)) {
    const pocket_mqtt_esp_properties *w = &o->will;
    esp_mqtt5_connection_property_config_t property = {
        .session_expiry_interval = o->session_expiry,
        /* esp-mqtt announces its input buffer when this is 0, and a broker
         * then discards every larger message. */
        .maximum_packet_size = o->maximum_packet
                                   ? o->maximum_packet
                                   : o->max_message + HEAD_BYTES + 16,
        .receive_maximum = o->receive_maximum,
        .topic_alias_maximum = o->topic_alias_maximum,
        .request_resp_info = (o->flags & POCKET_MQTT_ESP_REQUEST_RESPONSE) != 0,
        .request_problem_info =
            (o->flags & POCKET_MQTT_ESP_REQUEST_PROBLEM) != 0,
        .will_delay_interval = w->will_delay,
        .message_expiry_interval = w->message_expiry,
        .payload_format_indicator = w->payload_format != 0,
        .content_type = w->content_type.length ? w->content_type.data : NULL,
        .response_topic =
            w->response_topic.length ? w->response_topic.data : NULL,
        .correlation_data =
            w->correlation_data.length ? w->correlation_data.data : NULL,
        .correlation_data_len = w->correlation_data.length,
    };
    const bool listed = user_properties(&o->connect, &property.user_property) &&
                        user_properties(w, &property.will_user_property);
    const esp_err_t set =
        listed ? esp_mqtt5_client_set_connect_property(client, &property)
               : ESP_ERR_NO_MEM;
    delete_user_properties(&property.user_property);
    delete_user_properties(&property.will_user_property);
    if (set != ESP_OK) {
      start_failed(s,
                   "invalid_request: the client refused the connect "
                   "properties (%s)",
                   esp_err_to_name(set));
      return;
    }
  }
  esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, on_event, s);
  if (esp_mqtt_client_start(client) != ESP_OK) {
    start_failed(s, "other: the client task did not start");
    return;
  }
  lock(d);
  s->phase = SLOT_RUNNING;
  unlock(d);
}

/* The DISCONNECT the client sends when the session stops. */
static void run_disconnect(slot *s, request *q) {
  pocket_mqtt_esp_disconnect *p = &s->scratch->disconnect;
  if (!pocket_mqtt_esp_parse_disconnect(q->payload, q->length,
                                        s->open->protocol, p)) {
    lock(s->driver);
    fail(s, q, POCKET_WORKER_INVALID, "invalid_request: bad disconnect");
    unlock(s->driver);
    return;
  }
  esp_err_t set = ESP_OK;
  if (v5(s) && s->client) {
    esp_mqtt5_disconnect_property_config_t property = {
        .session_expiry_interval = p->session_expiry,
        .disconnect_reason = p->reason,
    };
    set = user_properties(&p->properties, &property.user_property)
              ? esp_mqtt5_client_set_disconnect_property(s->client, &property)
              : ESP_ERR_NO_MEM;
    delete_user_properties(&property.user_property);
  }
  lock(s->driver);
  if (set != ESP_OK)
    fail(s, q, POCKET_WORKER_FAILED, "other: %s", esp_err_to_name(set));
  else
    finish(s, q, POCKET_WORKER_OK, NULL, 0);
  unlock(s->driver);
}

static void run_publish(slot *s, request *q) {
  pocket_mqtt_esp_publish *p = &s->scratch->publish;
  const bool parsed_ok = pocket_mqtt_esp_parse_publish(q->payload, q->length,
                                                       s->open->protocol, p);
  esp_err_t property_set = ESP_OK;
  if (parsed_ok && v5(s)) {
    const pocket_mqtt_esp_properties *r = &p->properties;
    s->publish_property = (esp_mqtt5_publish_property_config_t){
        .payload_format_indicator = r->payload_format != 0,
        .message_expiry_interval = r->message_expiry,
        .topic_alias = r->topic_alias,
        .response_topic =
            r->response_topic.length ? r->response_topic.data : NULL,
        .correlation_data =
            r->correlation_data.length ? r->correlation_data.data : NULL,
        .correlation_data_len = r->correlation_data.length,
        .content_type = r->content_type.length ? r->content_type.data : NULL,
    };
    property_set = user_properties(r, &s->publish_property.user_property)
                       ? esp_mqtt5_client_set_publish_property(
                             s->client, &s->publish_property)
                       : ESP_ERR_NO_MEM;
  }
  int id = -3;
  if (parsed_ok && property_set == ESP_OK) {
    const uint8_t *data = p->staged ? s->stage : p->payload;
    id = esp_mqtt_client_publish(s->client, p->topic.data,
                                 p->payload_bytes ? (const char *)data : NULL,
                                 (int)p->payload_bytes, p->qos, p->retain);
  }
  if (v5(s)) {
    delete_user_properties(&s->publish_property.user_property);
    memset(&s->publish_property, 0, sizeof s->publish_property);
  }
  lock(s->driver);
  if (parsed_ok && p->staged) {
    s->stage_used = 0;
    s->stage_locked = false;
  }
  if (!parsed_ok)
    fail(s, q, POCKET_WORKER_INVALID, "invalid_request: bad publish");
  else if (property_set != ESP_OK)
    fail(s, q, POCKET_WORKER_FAILED,
         "invalid_request: the client refused the publish properties "
         "(topic alias above the broker's maximum?)");
  else if (id == -2)
    fail(s, q, POCKET_WORKER_FAILED, "busy: the outbox is full");
  else if (id < 0 && !s->connected)
    fail(s, q, POCKET_WORKER_FAILED,
         "unavailable: the session is not "
         "connected");
  else if (id < 0 && v5(s) && p->qos > s->maximum_qos)
    fail(s, q, POCKET_WORKER_FAILED,
         "invalid_request: the broker accepts QoS %u at most",
         (unsigned)s->maximum_qos);
  else if (id < 0 && v5(s) && p->retain && !s->retain_available)
    fail(s, q, POCKET_WORKER_FAILED,
         "invalid_request: the broker does not keep retained messages");
  else if (id < 0)
    fail(s, q, POCKET_WORKER_FAILED, "connect: the publish was not written");
  else if (p->qos == 0)
    finish(s, q, POCKET_WORKER_OK, q->codes, 1);
  else {
    q->count = 1;
    q->msg_id[0] = id;
    settle_sent(s, q);
  }
  unlock(s->driver);
}

static void run_subscribe(slot *s, request *q) {
  pocket_mqtt_esp_subscribe *p = &s->scratch->subscribe;
  const bool parsed_ok = pocket_mqtt_esp_parse_subscribe(q->payload, q->length,
                                                         s->open->protocol, p);
  esp_err_t property_set = ESP_OK;
  esp_mqtt_topic_t topics[POCKET_MQTT_ESP_FILTERS];
  if (parsed_ok) {
    for (uint8_t i = 0; i < p->count; ++i)
      topics[i] =
          (esp_mqtt_topic_t){.filter = p->filter[i].data, .qos = p->qos[i]};
  }
  if (parsed_ok && v5(s)) {
    s->subscribe_property = (esp_mqtt5_subscribe_property_config_t){
        .subscribe_id = (uint16_t)p->subscription_id,
        .no_local_flag = (p->options & 1) != 0,
        .retain_as_published_flag = (p->options & 2) != 0,
        .retain_handle = (uint8_t)(p->options >> 2 & 3),
    };
    property_set =
        user_properties(&p->properties, &s->subscribe_property.user_property)
            ? esp_mqtt5_client_set_subscribe_property(s->client,
                                                      &s->subscribe_property)
            : ESP_ERR_NO_MEM;
  }
  int id = -3;
  if (parsed_ok && property_set == ESP_OK)
    id = esp_mqtt_client_subscribe_multiple(s->client, topics, p->count);
  if (v5(s)) {
    delete_user_properties(&s->subscribe_property.user_property);
    memset(&s->subscribe_property, 0, sizeof s->subscribe_property);
  }
  lock(s->driver);
  if (!parsed_ok)
    fail(s, q, POCKET_WORKER_INVALID, "invalid_request: bad subscribe");
  else if (property_set != ESP_OK)
    fail(s, q, POCKET_WORKER_FAILED,
         "invalid_request: the client refused the subscription options");
  else if (id == -2)
    fail(s, q, POCKET_WORKER_FAILED, "busy: the outbox is full");
  else if (id < 0 && !s->connected)
    fail(s, q, POCKET_WORKER_FAILED,
         "unavailable: the session is not connected");
  else if (id < 0)
    fail(s, q, POCKET_WORKER_FAILED,
         "invalid_request: the client refused the subscription (QoS above the "
         "broker's maximum?)");
  else {
    q->count = 1;
    q->msg_id[0] = id;
    settle_sent(s, q);
  }
  unlock(s->driver);
}

static void run_unsubscribe(slot *s, request *q) {
  pocket_mqtt_esp_subscribe *p = &s->scratch->subscribe;
  if (!pocket_mqtt_esp_parse_unsubscribe(q->payload, q->length,
                                         s->open->protocol, p)) {
    lock(s->driver);
    fail(s, q, POCKET_WORKER_INVALID, "invalid_request: bad unsubscribe");
    unlock(s->driver);
    return;
  }
  /* esp-mqtt sends one filter per UNSUBSCRIBE. */
  int ids[POCKET_MQTT_ESP_FILTERS];
  for (uint8_t i = 0; i < p->count; ++i) {
    esp_err_t set = ESP_OK;
    if (v5(s)) {
      memset(&s->unsubscribe_property, 0, sizeof s->unsubscribe_property);
      set = user_properties(&p->properties,
                            &s->unsubscribe_property.user_property)
                ? esp_mqtt5_client_set_unsubscribe_property(
                      s->client, &s->unsubscribe_property)
                : ESP_ERR_NO_MEM;
    }
    ids[i] = set == ESP_OK
                 ? esp_mqtt_client_unsubscribe(s->client, p->filter[i].data)
                 : -3;
    if (v5(s)) {
      delete_user_properties(&s->unsubscribe_property.user_property);
      memset(&s->unsubscribe_property, 0, sizeof s->unsubscribe_property);
    }
  }
  lock(s->driver);
  if (ids[0] < 0) {
    fail(s, q, POCKET_WORKER_FAILED, "%s",
         !s->connected  ? "unavailable: the session is not connected"
         : ids[0] == -2 ? "busy: the outbox is full"
                        : "other: the unsubscribe was not written");
  } else {
    q->count = p->count;
    for (uint8_t i = 0; i < p->count; ++i) {
      q->msg_id[i] = ids[i];
      /* A filter that was not sent settles as refused. */
      if (ids[i] < 0) {
        q->msg_id[i] = 0;
        q->acked[i] = true;
        q->codes[i] = 0x80;
      }
    }
    settle_sent(s, q);
  }
  unlock(s->driver);
}

/* Runs queued requests in the order the worker submitted them. */
static void run_requests(slot *s) {
  for (;;) {
    lock(s->driver);
    request *next = NULL;
    for (size_t i = 0; i < REQUESTS; ++i) {
      request *q = &s->requests[i];
      if (q->id && q->state == REQUEST_QUEUED && (!next || q->id < next->id))
        next = q;
    }
    if (next && next->cancelled) {
      finish(s, next, POCKET_WORKER_CANCELLED, NULL, 0);
      unlock(s->driver);
      continue;
    }
    if (next && (s->ended || !s->client)) {
      fail(s, next, POCKET_WORKER_FAILED, "unavailable: the session %s",
           s->ended ? "ended" : "has not started");
      unlock(s->driver);
      continue;
    }
    if (next)
      next->state = REQUEST_EXECUTING;
    unlock(s->driver);
    if (!next)
      return;
    switch (next->opcode) {
    case POCKET_MQTT_ESP_PUBLISH:
      run_publish(s, next);
      break;
    case POCKET_MQTT_ESP_SUBSCRIBE:
      run_subscribe(s, next);
      break;
    case POCKET_MQTT_ESP_UNSUBSCRIBE:
      run_unsubscribe(s, next);
      break;
    default:
      run_disconnect(s, next);
      break;
    }
  }
}

/* After close: the client sends DISCONNECT and stops, then the slot is
 * free. The worker core let go of the resource already. */
static void stop_session(slot *s) {
  if (s->client) {
    esp_mqtt_client_stop(s->client);
    esp_mqtt_client_destroy(s->client);
    s->client = NULL;
  }
  pocket_mqtt_esp *d = s->driver;
  lock(d);
  memset(s->requests, 0, sizeof s->requests);
  heap_caps_free(s->stage);
  heap_caps_free(s->credentials);
  s->stage = s->credentials = NULL;
  s->reconnect_at = 0;
  s->stage_used = s->stage_capacity = s->credentials_used =
      s->credentials_total = 0;
  s->stage_locked = false;
  s->phase = SLOT_FREE;
  unlock(d);
}

static void control_task(void *argument) {
  slot *s = argument;
  pocket_mqtt_esp *d = s->driver;
  for (;;) {
    /* A reconnect is due only while the session runs. */
    lock(d);
    if (s->reconnect_at &&
        (s->phase != SLOT_RUNNING || s->stopping || s->ended))
      s->reconnect_at = 0;
    const int64_t at = s->reconnect_at;
    unlock(d);
    TickType_t wait = portMAX_DELAY;
    if (at) {
      const int64_t left = at - esp_timer_get_time();
      wait = left <= 0 ? 0 : pdMS_TO_TICKS((left + 999) / 1000) + 1;
    }
    ulTaskNotifyTake(pdTRUE, wait);
    lock(d);
    const bool quit = d->quit, stop = s->stopping;
    const bool start = s->phase == SLOT_STARTING && !s->started;
    const bool end = s->end_pending;
    if (start)
      s->started = true;
    const bool active = s->phase == SLOT_STARTING || s->phase == SLOT_RUNNING;
    const bool reconnect =
        s->reconnect_at && !stop && esp_timer_get_time() >= s->reconnect_at;
    if (reconnect)
      s->reconnect_at = 0;
    unlock(d);
    if (quit)
      break;
    if (stop) {
      if (s->phase != SLOT_FREE)
        stop_session(s);
      continue;
    }
    if (!active)
      continue;
    if (start)
      start_session(s);
    if (end)
      end_session(s);
    if (reconnect && s->client &&
        esp_mqtt_client_reconnect(s->client) != ESP_OK) {
      /* The client was not waiting yet; try again after the delay. */
      lock(d);
      if (!s->ended && !s->stopping)
        s->reconnect_at =
            esp_timer_get_time() + (int64_t)s->open->reconnect_ms * 1000;
      unlock(d);
    }
    run_requests(s);
  }
  xSemaphoreGive(d->stopped);
  if (d->config.task_stack_caps)
    vTaskDeleteWithCaps(NULL);
  else
    vTaskDelete(NULL);
}

/* ---- driver callbacks, on the worker's owner task ---- */

static int32_t driver_open(void *opaque, pocket_worker *worker, uint32_t handle,
                           const uint8_t *bytes, size_t length) {
  pocket_mqtt_esp *d = opaque;
  lock(d);
  slot *s = NULL;
  for (size_t i = 0; i < SLOTS && !s; ++i)
    if (d->slots[i].phase == SLOT_FREE)
      s = &d->slots[i];
  if (s) {
    /* A slot that is not free belongs to its session; this one is claimed
     * until open returns. */
    s->phase = SLOT_CREDENTIALS;
    s->handle = handle;
    s->worker = worker;
  }
  unlock(d);
  if (!s)
    return POCKET_WORKER_BUSY;
  if (!pocket_mqtt_esp_parse_open(bytes, length, s->open)) {
    lock(d);
    s->phase = SLOT_FREE;
    s->handle = 0;
    unlock(d);
    return POCKET_WORKER_INVALID;
  }
  const pocket_mqtt_esp_open *o = s->open;
  const size_t total =
      (size_t)o->ca_bytes + o->certificate_bytes + o->key_bytes;
  uint8_t *credentials = total ? allocate(d, total + 3) : NULL;
  if (total && !credentials) {
    lock(d);
    s->phase = SLOT_FREE;
    s->handle = 0;
    unlock(d);
    return POCKET_WORKER_BUSY;
  }
  lock(d);
  memset(s->requests, 0, sizeof s->requests);
  memset(s->early, 0, sizeof s->early);
  s->stopping = s->end_pending = s->ended = s->started = false;
  s->connected = s->attempting = s->fatal = s->behind = false;
  s->reconnect_at = 0;
  s->maximum_qos = 2;
  s->retain_available = true;
  s->delivered = 0;
  s->message.active = false;
  s->error[0] = '\0';
  s->credentials = credentials;
  s->credentials_used = 0;
  s->credentials_total = total;
  s->attached = true;
  s->phase = total ? SLOT_CREDENTIALS : SLOT_STARTING;
  unlock(d);
  if (!total)
    xTaskNotifyGive(s->task);
  return POCKET_WORKER_OK;
}

/* TLS material after open; afterwards the payload of the next staged
 * publish. An empty write clears the staging buffer. */
static int32_t driver_write(void *opaque, pocket_worker *worker,
                            uint32_t handle, const uint8_t *bytes,
                            size_t length) {
  (void)worker;
  pocket_mqtt_esp *d = opaque;
  lock(d);
  slot *s = find(d, handle);
  int32_t result = POCKET_WORKER_INVALID;
  bool start = false;
  if (s && s->phase == SLOT_CREDENTIALS) {
    const pocket_mqtt_esp_open *o = s->open;
    const size_t left = s->credentials_total - s->credentials_used;
    const size_t n = length < left ? length : left;
    for (size_t i = 0; i < n; ++i) {
      /* ca NUL certificate NUL key NUL */
      const size_t at = s->credentials_used + i;
      const size_t gap = at < o->ca_bytes                                  ? 0
                         : at < (size_t)o->ca_bytes + o->certificate_bytes ? 1
                                                                           : 2;
      s->credentials[at + gap] = bytes[i];
    }
    s->credentials_used += n;
    if (s->credentials_used == s->credentials_total) {
      s->phase = SLOT_STARTING;
      start = true;
    }
    result = (int32_t)n;
  } else if (s && !s->ended &&
             (s->phase == SLOT_STARTING || s->phase == SLOT_RUNNING)) {
    if (s->stage_locked) {
      result = POCKET_WORKER_BUSY;
    } else if (!length) {
      s->stage_used = 0;
      result = 0;
    } else {
      size_t n = POCKET_MQTT_ESP_MAX_STAGED - s->stage_used;
      if (n > length)
        n = length;
      if (s->stage_used + n > s->stage_capacity) {
        size_t capacity = s->stage_capacity ? s->stage_capacity : 4096;
        while (capacity < s->stage_used + n)
          capacity *= 2;
        if (capacity > POCKET_MQTT_ESP_MAX_STAGED)
          capacity = POCKET_MQTT_ESP_MAX_STAGED;
        uint8_t *grown = heap_caps_realloc(
            s->stage, capacity,
            d->config.memory_caps ? d->config.memory_caps
                                  : MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
        if (grown) {
          s->stage = grown;
          s->stage_capacity = capacity;
        } else {
          n = s->stage_capacity - s->stage_used;
        }
      }
      if (n)
        memcpy(s->stage + s->stage_used, bytes, n);
      s->stage_used += n;
      result = (int32_t)n;
    }
  }
  unlock(d);
  if (start)
    xTaskNotifyGive(s->task);
  return result;
}

static int32_t driver_validate(void *opaque, pocket_worker *worker,
                               uint32_t handle, uint32_t opcode,
                               const uint8_t *payload, size_t length,
                               size_t capacity) {
  (void)worker;
  pocket_mqtt_esp *d = opaque;
  lock(d);
  const slot *s = find(d, handle);
  const bool open =
      s && !s->ended && (s->phase == SLOT_STARTING || s->phase == SLOT_RUNNING);
  const uint8_t protocol = open ? s->open->protocol : 0;
  unlock(d);
  if (!open)
    return POCKET_WORKER_INVALID;
  /* The completion carries the codes or the failure text. */
  if (capacity < POCKET_MQTT_ESP_FILTERS)
    return POCKET_WORKER_INVALID;
  switch (opcode) {
  case POCKET_MQTT_ESP_PUBLISH:
    return pocket_mqtt_esp_parse_publish(payload, length, protocol,
                                         &d->check->publish)
               ? POCKET_WORKER_OK
               : POCKET_WORKER_INVALID;
  case POCKET_MQTT_ESP_SUBSCRIBE:
    return pocket_mqtt_esp_parse_subscribe(payload, length, protocol,
                                           &d->check->subscribe)
               ? POCKET_WORKER_OK
               : POCKET_WORKER_INVALID;
  case POCKET_MQTT_ESP_UNSUBSCRIBE:
    return pocket_mqtt_esp_parse_unsubscribe(payload, length, protocol,
                                             &d->check->subscribe)
               ? POCKET_WORKER_OK
               : POCKET_WORKER_INVALID;
  case POCKET_MQTT_ESP_DISCONNECT:
    /* esp-mqtt leaves a session expiry of 0 out of DISCONNECT. */
    return pocket_mqtt_esp_parse_disconnect(payload, length, protocol,
                                            &d->check->disconnect) &&
                   !(d->check->disconnect.has_session_expiry &&
                     !d->check->disconnect.session_expiry)
               ? POCKET_WORKER_OK
               : POCKET_WORKER_INVALID;
  default:
    return POCKET_WORKER_INVALID;
  }
}

static int32_t driver_start(void *opaque, pocket_worker *worker,
                            uint32_t handle, uint32_t id, uint32_t opcode,
                            const uint8_t *payload, size_t length,
                            size_t capacity) {
  (void)worker;
  pocket_mqtt_esp *d = opaque;
  lock(d);
  slot *s = find(d, handle);
  request *q = NULL;
  int32_t status = POCKET_WORKER_INVALID;
  if (s && !s->ended &&
      (s->phase == SLOT_STARTING || s->phase == SLOT_RUNNING)) {
    for (size_t i = 0; i < REQUESTS && !q; ++i)
      if (!s->requests[i].id)
        q = &s->requests[i];
    status = q ? POCKET_WORKER_OK : POCKET_WORKER_BUSY;
  }
  /* A staged publish takes the staging buffer it names, whole. */
  if (q && opcode == POCKET_MQTT_ESP_PUBLISH && length >= 8 &&
      (payload[1] & 8)) {
    const uint32_t staged = (uint32_t)payload[4] | (uint32_t)payload[5] << 8 |
                            (uint32_t)payload[6] << 16 |
                            (uint32_t)payload[7] << 24;
    if (s->stage_locked || s->stage_used != staged)
      status = POCKET_WORKER_INVALID;
    else
      s->stage_locked = true;
  }
  if (status == POCKET_WORKER_OK) {
    *q = (request){.id = id,
                   .state = REQUEST_QUEUED,
                   .opcode = opcode,
                   .length = length,
                   .capacity = capacity,
                   .filters = opcode == POCKET_MQTT_ESP_PUBLISH ? 1
                              : length >= 2                     ? payload[1]
                                                                : 0};
    if (length)
      memcpy(q->payload, payload, length);
  }
  unlock(d);
  if (status == POCKET_WORKER_OK)
    xTaskNotifyGive(s->task);
  return status;
}

static void driver_cancel(void *opaque, pocket_worker *worker, uint32_t handle,
                          uint32_t id) {
  (void)worker;
  pocket_mqtt_esp *d = opaque;
  lock(d);
  slot *s = find(d, handle);
  bool queued = false;
  for (size_t i = 0; s && i < REQUESTS; ++i)
    if (s->requests[i].id == id) {
      /* A sent packet cannot be recalled; its acknowledgement releases it. */
      s->requests[i].cancelled = true;
      queued = s->requests[i].state == REQUEST_QUEUED;
    }
  unlock(d);
  if (queued)
    xTaskNotifyGive(s->task);
}

static int32_t driver_close(void *opaque, pocket_worker *worker,
                            uint32_t handle) {
  (void)worker;
  pocket_mqtt_esp *d = opaque;
  lock(d);
  slot *s = find(d, handle);
  if (s) {
    /* Detach: no call reaches the core after this, and the requests the
     * core is about to release are forgotten; one the control task is
     * executing settles into nothing. The client stops on the control
     * task, which frees the slot. */
    s->attached = false;
    s->handle = 0;
    s->stopping = true;
    for (size_t i = 0; i < REQUESTS; ++i)
      if (s->requests[i].state != REQUEST_EXECUTING)
        memset(&s->requests[i], 0, sizeof s->requests[i]);
  }
  unlock(d);
  if (s)
    xTaskNotifyGive(s->task);
  return POCKET_WORKER_OK;
}

pocket_mqtt_esp *pocket_mqtt_esp_create(const pocket_mqtt_esp_config *config) {
  if (!config || config->struct_size < sizeof(*config))
    return NULL;
  const uint32_t caps = config->memory_caps
                            ? config->memory_caps
                            : MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
  pocket_mqtt_esp *d = heap_caps_calloc(1, sizeof(*d), caps);
  if (!d)
    return NULL;
  d->config = *config;
  d->mutex = xSemaphoreCreateMutex();
  d->stopped = xSemaphoreCreateCounting(SLOTS, 0);
  d->check = allocate(d, sizeof(parsed));
  bool ready = d->mutex && d->stopped && d->check;
  for (size_t i = 0; i < SLOTS && ready; ++i) {
    slot *s = &d->slots[i];
    s->driver = d;
    s->open = allocate(d, sizeof(pocket_mqtt_esp_open));
    s->scratch = allocate(d, sizeof(parsed));
    s->head = allocate(d, HEAD_BYTES);
    s->fact = allocate(d, POCKET_MQTT_ESP_RECORD);
    s->record = allocate(d, POCKET_MQTT_ESP_RECORD);
    ready = s->open && s->scratch && s->head && s->fact && s->record;
  }
  size_t started = 0;
  for (; ready && started < SLOTS; ++started) {
    slot *s = &d->slots[started];
    const BaseType_t created =
        config->task_stack_caps
            ? xTaskCreatePinnedToCoreWithCaps(
                  control_task, "pocket_mqtt", CONTROL_STACK, s,
                  config->task_priority, &s->task, config->task_core,
                  config->task_stack_caps)
            : xTaskCreatePinnedToCore(control_task, "pocket_mqtt",
                                      CONTROL_STACK, s, config->task_priority,
                                      &s->task, config->task_core);
    if (created != pdPASS)
      break;
  }
  if (!ready || started < SLOTS) {
    if (d->mutex) {
      lock(d);
      d->quit = true;
      unlock(d);
    }
    for (size_t i = 0; i < started; ++i) {
      xTaskNotifyGive(d->slots[i].task);
      xSemaphoreTake(d->stopped, portMAX_DELAY);
    }
    for (size_t i = 0; i < SLOTS; ++i) {
      slot *s = &d->slots[i];
      heap_caps_free(s->open);
      heap_caps_free(s->scratch);
      heap_caps_free(s->head);
      heap_caps_free(s->fact);
      heap_caps_free(s->record);
    }
    heap_caps_free(d->check);
    if (d->mutex)
      vSemaphoreDelete(d->mutex);
    if (d->stopped)
      vSemaphoreDelete(d->stopped);
    heap_caps_free(d);
    return NULL;
  }
  d->vtable = (pocket_worker_driver){.struct_size = sizeof(d->vtable),
                                     .context = d,
                                     .open = driver_open,
                                     .start = driver_start,
                                     .write = driver_write,
                                     .cancel = driver_cancel,
                                     .close = driver_close,
                                     .validate = driver_validate};
  return d;
}

const pocket_worker_driver *pocket_mqtt_esp_driver(pocket_mqtt_esp *driver) {
  return driver ? &driver->vtable : NULL;
}

int32_t pocket_mqtt_esp_destroy(pocket_mqtt_esp *d) {
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
  for (size_t i = 0; i < SLOTS; ++i) {
    slot *s = &d->slots[i];
    heap_caps_free(s->open);
    heap_caps_free(s->scratch);
    heap_caps_free(s->head);
    heap_caps_free(s->fact);
    heap_caps_free(s->record);
  }
  heap_caps_free(d->check);
  vSemaphoreDelete(d->stopped);
  vSemaphoreDelete(d->mutex);
  heap_caps_free(d);
  return POCKET_WORKER_OK;
}
