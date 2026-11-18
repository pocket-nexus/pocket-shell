#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* The byte layouts of the worker's io.mqtt resource (pocketjs
 * contracts/spec/mqtt.ts): the open descriptor, the four requests, and the
 * CONNACK and message records the host writes. Pure C: no IDF dependency.
 * Every string the parsers return is a NUL-terminated copy in the parsed
 * struct's arena; binary fields keep their length. */
#define POCKET_MQTT_ESP_RECORD 1024u
#define POCKET_MQTT_ESP_ARENA 2048u
#define POCKET_MQTT_ESP_FILTERS 8u
#define POCKET_MQTT_ESP_USER_PROPERTIES 16u
#define POCKET_MQTT_ESP_ALPN 4u
#define POCKET_MQTT_ESP_MAX_MESSAGE (256u * 1024u)
#define POCKET_MQTT_ESP_MAX_STAGED (256u * 1024u)
#define POCKET_MQTT_ESP_MAX_CREDENTIAL (16u * 1024u)
#define POCKET_MQTT_ESP_MAX_TIMEOUT_MS 120000u
#define POCKET_MQTT_ESP_MAX_SUBSCRIPTION_ID 0xffffu
#define POCKET_MQTT_ESP_RECORD_FIXED 9u

enum {
  POCKET_MQTT_ESP_V311 = 4,
  POCKET_MQTT_ESP_V5 = 5,
};
enum {
  POCKET_MQTT_ESP_PUBLISH = 1,
  POCKET_MQTT_ESP_SUBSCRIBE = 2,
  POCKET_MQTT_ESP_UNSUBSCRIBE = 3,
  POCKET_MQTT_ESP_DISCONNECT = 4,
};
/* Open descriptor flags. */
enum {
  POCKET_MQTT_ESP_CLEAN_START = 1 << 0,
  POCKET_MQTT_ESP_WILL = 1 << 1,
  POCKET_MQTT_ESP_WILL_RETAIN = 1 << 2,
  POCKET_MQTT_ESP_REQUEST_RESPONSE = 1 << 5,
  POCKET_MQTT_ESP_REQUEST_PROBLEM = 1 << 6,
  POCKET_MQTT_ESP_NULL_CLIENT_ID = 1 << 7,
};
/* MQTT 5 property identifiers. */
enum {
  POCKET_MQTT_ESP_PAYLOAD_FORMAT = 0x01,
  POCKET_MQTT_ESP_MESSAGE_EXPIRY = 0x02,
  POCKET_MQTT_ESP_CONTENT_TYPE = 0x03,
  POCKET_MQTT_ESP_RESPONSE_TOPIC = 0x08,
  POCKET_MQTT_ESP_CORRELATION_DATA = 0x09,
  POCKET_MQTT_ESP_SUBSCRIPTION_ID = 0x0b,
  POCKET_MQTT_ESP_WILL_DELAY = 0x18,
  POCKET_MQTT_ESP_RESPONSE_INFORMATION = 0x1a,
  POCKET_MQTT_ESP_TOPIC_ALIAS = 0x23,
  POCKET_MQTT_ESP_USER_PROPERTY = 0x26,
};
/* Which optional properties a block carried. */
enum {
  POCKET_MQTT_ESP_HAS_PAYLOAD_FORMAT = 1 << 0,
  POCKET_MQTT_ESP_HAS_MESSAGE_EXPIRY = 1 << 1,
  POCKET_MQTT_ESP_HAS_CONTENT_TYPE = 1 << 2,
  POCKET_MQTT_ESP_HAS_RESPONSE_TOPIC = 1 << 3,
  POCKET_MQTT_ESP_HAS_CORRELATION_DATA = 1 << 4,
  POCKET_MQTT_ESP_HAS_WILL_DELAY = 1 << 5,
  POCKET_MQTT_ESP_HAS_TOPIC_ALIAS = 1 << 6,
};

typedef struct {
  const char *data;
  uint16_t length;
} pocket_mqtt_esp_text;

typedef struct {
  char bytes[POCKET_MQTT_ESP_ARENA];
  size_t used;
} pocket_mqtt_esp_arena;

typedef struct {
  uint32_t present;
  uint8_t payload_format;
  uint32_t message_expiry, will_delay;
  uint16_t topic_alias;
  pocket_mqtt_esp_text content_type, response_topic, correlation_data;
  uint8_t user_count;
  pocket_mqtt_esp_text user_key[POCKET_MQTT_ESP_USER_PROPERTIES];
  pocket_mqtt_esp_text user_value[POCKET_MQTT_ESP_USER_PROPERTIES];
} pocket_mqtt_esp_properties;

typedef struct {
  uint8_t protocol, flags, will_qos;
  bool secure;
  uint16_t keepalive, receive_maximum, topic_alias_maximum;
  uint32_t reconnect_ms, timeout_ms, max_message, session_expiry;
  uint32_t maximum_packet;
  uint16_t ca_bytes, certificate_bytes, key_bytes;
  pocket_mqtt_esp_text url, client_id, username, password, key_password;
  pocket_mqtt_esp_text common_name, will_topic, will_payload;
  /* NULL-terminated, as esp-tls takes it. */
  const char *alpn[POCKET_MQTT_ESP_ALPN + 1];
  pocket_mqtt_esp_properties will, connect;
  pocket_mqtt_esp_arena arena;
} pocket_mqtt_esp_open;

typedef struct {
  uint8_t qos;
  bool retain, staged;
  uint32_t payload_bytes;
  /* Into the request bytes; NULL when staged or empty. */
  const uint8_t *payload;
  pocket_mqtt_esp_text topic;
  pocket_mqtt_esp_properties properties;
  pocket_mqtt_esp_arena arena;
} pocket_mqtt_esp_publish;

/* SUBSCRIBE and UNSUBSCRIBE; an unsubscribe has no options, identifier or
 * QoS. */
typedef struct {
  uint8_t count, options;
  uint32_t subscription_id;
  uint8_t qos[POCKET_MQTT_ESP_FILTERS];
  pocket_mqtt_esp_text filter[POCKET_MQTT_ESP_FILTERS];
  pocket_mqtt_esp_properties properties;
  pocket_mqtt_esp_arena arena;
} pocket_mqtt_esp_subscribe;

typedef struct {
  uint8_t reason;
  bool has_session_expiry;
  uint32_t session_expiry;
  pocket_mqtt_esp_properties properties;
  pocket_mqtt_esp_arena arena;
} pocket_mqtt_esp_disconnect;

/* Each parser checks the whole layout; with `out` NULL it only checks.
 * MQTT 3.1.1 requests must carry empty property blocks. */
bool pocket_mqtt_esp_parse_open(const uint8_t *bytes, size_t length,
                                pocket_mqtt_esp_open *out);
bool pocket_mqtt_esp_parse_publish(const uint8_t *bytes, size_t length,
                                   uint8_t protocol,
                                   pocket_mqtt_esp_publish *out);
bool pocket_mqtt_esp_parse_subscribe(const uint8_t *bytes, size_t length,
                                     uint8_t protocol,
                                     pocket_mqtt_esp_subscribe *out);
bool pocket_mqtt_esp_parse_unsubscribe(const uint8_t *bytes, size_t length,
                                       uint8_t protocol,
                                       pocket_mqtt_esp_subscribe *out);
bool pocket_mqtt_esp_parse_disconnect(const uint8_t *bytes, size_t length,
                                      uint8_t protocol,
                                      pocket_mqtt_esp_disconnect *out);

/* A bounded little-endian writer; `overflow` latches when a write does not
 * fit. */
typedef struct {
  uint8_t *data;
  size_t capacity, length;
  bool overflow;
} pocket_mqtt_esp_writer;
void pocket_mqtt_esp_put_u8(pocket_mqtt_esp_writer *w, uint8_t value);
void pocket_mqtt_esp_put_u16(pocket_mqtt_esp_writer *w, uint16_t value);
void pocket_mqtt_esp_put_u32(pocket_mqtt_esp_writer *w, uint32_t value);
void pocket_mqtt_esp_put_bytes(pocket_mqtt_esp_writer *w, const void *data,
                               size_t length);
/* A u16 length and the bytes; overflows past 65535 bytes. */
void pocket_mqtt_esp_put_field(pocket_mqtt_esp_writer *w, const void *data,
                               size_t length);
void pocket_mqtt_esp_patch_u16(pocket_mqtt_esp_writer *w, size_t at,
                               uint16_t value);

/* Properties of a received PUBLISH or CONNACK, as esp-mqtt reports them. */
typedef struct {
  bool has_payload_format;
  uint8_t payload_format;
  const char *content_type, *response_topic, *correlation_data;
  const char *response_information;
  size_t content_type_length, response_topic_length, correlation_data_length;
  uint32_t subscription_id;
  size_t user_count;
  const char *const *user_key;
  const char *const *user_value;
} pocket_mqtt_esp_received;

/* The CONNACK record of a HEADERS fact. */
typedef struct {
  bool session_present;
  uint8_t protocol, maximum_qos;
  uint32_t maximum_packet;
  uint16_t receive_maximum, topic_alias_maximum;
  bool retain, wildcard, subscription_ids, shared;
} pocket_mqtt_esp_connack;
size_t pocket_mqtt_esp_connack_record(const pocket_mqtt_esp_connack *ack,
                                      const pocket_mqtt_esp_received *props,
                                      uint8_t *out, size_t capacity);

/* The head of a message record: fixed header, topic and properties.
 * Returns its length, 0 when it does not fit `capacity` or a field exceeds
 * its 16-bit length. */
size_t pocket_mqtt_esp_message_head(uint8_t flags, uint32_t payload_bytes,
                                    const char *topic, size_t topic_length,
                                    const pocket_mqtt_esp_received *props,
                                    uint8_t *out, size_t capacity);

/* True for a CONNACK refusal a reconnect may clear: 3.1.1 code 3 (server
 * unavailable); MQTT 5 0x88 server unavailable, 0x89 server busy, 0x97
 * quota exceeded, 0x9f connection rate exceeded. */
bool pocket_mqtt_esp_refusal_transient(uint8_t protocol, int code);
/* A readable name of a 3.1.1 return code or an MQTT 5 reason code. */
const char *pocket_mqtt_esp_reason_name(uint8_t protocol, int code);
