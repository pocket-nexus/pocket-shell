/* The MQTT layouts of pocket_mqtt_esp (src/record.c) against the bytes the
 * PocketJS SDK encodes (mqtt-vectors.h, from tests/mqtt-vectors.ts). */
#include "mqtt-vectors.h"
#include "record.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define TEXT(t, s)                                                             \
  ((t).length == strlen(s) && !memcmp((t).data, (s), strlen(s)))

/* A copy of a vector with one byte changed. */
static uint8_t *mutated(const uint8_t *bytes, size_t length, size_t at,
                        uint8_t value) {
  uint8_t *copy = malloc(length);
  memcpy(copy, bytes, length);
  copy[at] = value;
  return copy;
}

static void open_vectors(void) {
  static pocket_mqtt_esp_open o;
  assert(pocket_mqtt_esp_parse_open(open_v311, sizeof open_v311, &o));
  assert(o.protocol == POCKET_MQTT_ESP_V311 && o.secure);
  assert(o.flags == (POCKET_MQTT_ESP_WILL | POCKET_MQTT_ESP_WILL_RETAIN |
                     1 << 3 | POCKET_MQTT_ESP_REQUEST_PROBLEM));
  assert(o.will_qos == 1 && o.keepalive == 30 && o.reconnect_ms == 2000 &&
         o.timeout_ms == 8000 && o.max_message == 4096);
  assert(o.ca_bytes == 2 && o.certificate_bytes == 4 && o.key_bytes == 3);
  assert(TEXT(o.url, "mqtts://broker.local:8883") && TEXT(o.client_id, "tab5"));
  assert(TEXT(o.username, "user") && TEXT(o.password, "secret"));
  assert(TEXT(o.key_password, "pw") && TEXT(o.common_name, "broker"));
  assert(!strcmp(o.alpn[0], "mqtt") && !strcmp(o.alpn[1], "x-amzn-mqtt-ca") &&
         !o.alpn[2]);
  assert(TEXT(o.will_topic, "tab5/status") && TEXT(o.will_payload, "offline"));
  assert(!o.will.present && !o.connect.user_count);
  /* Strings are NUL-terminated for esp-mqtt. */
  assert(o.url.data[o.url.length] == '\0');

  assert(pocket_mqtt_esp_parse_open(open_v5, sizeof open_v5, &o));
  assert(o.protocol == POCKET_MQTT_ESP_V5 && !o.secure);
  assert(o.flags & POCKET_MQTT_ESP_NULL_CLIENT_ID);
  assert(o.flags & POCKET_MQTT_ESP_CLEAN_START);
  assert(o.flags & POCKET_MQTT_ESP_REQUEST_RESPONSE);
  assert(o.session_expiry == 3600 && o.receive_maximum == 16 &&
         o.maximum_packet == 65536 && o.topic_alias_maximum == 8);
  assert(!o.client_id.length && TEXT(o.will_topic, "w"));
  assert(o.will_payload.length == 3 && o.will_payload.data[2] == 2);
  assert(
      o.will.present ==
      (POCKET_MQTT_ESP_HAS_PAYLOAD_FORMAT | POCKET_MQTT_ESP_HAS_MESSAGE_EXPIRY |
       POCKET_MQTT_ESP_HAS_CONTENT_TYPE | POCKET_MQTT_ESP_HAS_RESPONSE_TOPIC |
       POCKET_MQTT_ESP_HAS_CORRELATION_DATA | POCKET_MQTT_ESP_HAS_WILL_DELAY));
  assert(o.will.payload_format == 0 && o.will.will_delay == 5 &&
         o.will.message_expiry == 60);
  assert(TEXT(o.will.content_type, "application/octet-stream"));
  assert(TEXT(o.will.response_topic, "r/1"));
  assert(o.will.correlation_data.length == 2 &&
         o.will.correlation_data.data[0] == 9);
  assert(o.will.user_count == 1 && TEXT(o.will.user_key[0], "k") &&
         TEXT(o.will.user_value[0], "v"));
  assert(o.connect.user_count == 2 && TEXT(o.connect.user_value[1], "2"));

  assert(pocket_mqtt_esp_parse_open(open_plain, sizeof open_plain, &o));
  assert(!o.secure && o.keepalive == 60 && o.reconnect_ms == 5000 &&
         o.timeout_ms == 10000 && o.max_message == 65536);
  assert(o.flags ==
         (POCKET_MQTT_ESP_CLEAN_START | POCKET_MQTT_ESP_REQUEST_PROBLEM));
  assert(pocket_mqtt_esp_parse_open(open_plain, sizeof open_plain, NULL));

  /* Truncated, trailing or out-of-range descriptors. */
  assert(!pocket_mqtt_esp_parse_open(open_plain, sizeof open_plain - 1, &o));
  uint8_t longer[sizeof open_plain + 1];
  memcpy(longer, open_plain, sizeof open_plain);
  longer[sizeof open_plain] = 0;
  assert(!pocket_mqtt_esp_parse_open(longer, sizeof longer, &o));
  uint8_t *bad = mutated(open_plain, sizeof open_plain, 0, 2); /* version */
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
  bad = mutated(open_plain, sizeof open_plain, 1, 3); /* protocol */
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
  bad = mutated(open_plain, sizeof open_plain, 12, 0); /* timeoutMs 0 */
  bad[13] = 0;
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
  bad = mutated(open_plain, sizeof open_plain, 30, 1); /* CA without TLS */
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
  bad = mutated(open_plain, sizeof open_plain, 20, 1); /* 3.1.1 expiry */
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
  bad = mutated(open_plain, sizeof open_plain, 2,
                POCKET_MQTT_ESP_WILL_RETAIN); /* retain without a will */
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
  /* "mqtt://192.168.1.10" -> "http://..." */
  bad = mutated(open_plain, sizeof open_plain, 38, 'h');
  assert(!pocket_mqtt_esp_parse_open(bad, sizeof open_plain, &o));
  free(bad);
}

static void request_vectors(void) {
  static pocket_mqtt_esp_publish p;
  assert(pocket_mqtt_esp_parse_publish(publish_inline, sizeof publish_inline,
                                       POCKET_MQTT_ESP_V311, &p));
  assert(p.qos == 2 && p.retain && !p.staged && p.payload_bytes == 2);
  assert(TEXT(p.topic, "t/1") && !memcmp(p.payload, "hi", 2));
  assert(pocket_mqtt_esp_parse_publish(publish_staged, sizeof publish_staged,
                                       POCKET_MQTT_ESP_V311, &p));
  assert(p.staged && p.qos == 1 && p.payload_bytes == 5000 && !p.payload);
  assert(pocket_mqtt_esp_parse_publish(publish_empty, sizeof publish_empty,
                                       POCKET_MQTT_ESP_V311, &p));
  assert(!p.payload_bytes && !p.payload && TEXT(p.topic, "t/e"));
  assert(pocket_mqtt_esp_parse_publish(publish_v5, sizeof publish_v5,
                                       POCKET_MQTT_ESP_V5, &p));
  assert(p.properties.payload_format == 1 &&
         p.properties.message_expiry == 10 && p.properties.topic_alias == 3);
  assert(TEXT(p.properties.content_type, "text/plain"));
  assert(TEXT(p.properties.response_topic, "reply/1"));
  assert(TEXT(p.properties.correlation_data, "id-7"));
  assert(p.properties.user_count == 2 && TEXT(p.properties.user_value[1], "w"));
  /* MQTT 3.1.1 carries no properties. */
  assert(!pocket_mqtt_esp_parse_publish(publish_v5, sizeof publish_v5,
                                        POCKET_MQTT_ESP_V311, &p));
  assert(pocket_mqtt_esp_parse_publish(publish_v5, sizeof publish_v5,
                                       POCKET_MQTT_ESP_V5, NULL));
  /* A wildcard in a topic name, QoS 3, a short payload. */
  uint8_t *bad = mutated(publish_inline, sizeof publish_inline, 9, '+');
  assert(!pocket_mqtt_esp_parse_publish(bad, sizeof publish_inline,
                                        POCKET_MQTT_ESP_V311, &p));
  free(bad);
  bad = mutated(publish_inline, sizeof publish_inline, 1, 3);
  assert(!pocket_mqtt_esp_parse_publish(bad, sizeof publish_inline,
                                        POCKET_MQTT_ESP_V311, &p));
  free(bad);
  assert(!pocket_mqtt_esp_parse_publish(
      publish_inline, sizeof publish_inline - 1, POCKET_MQTT_ESP_V311, &p));

  static pocket_mqtt_esp_subscribe s;
  assert(pocket_mqtt_esp_parse_subscribe(subscribe_v5, sizeof subscribe_v5,
                                         POCKET_MQTT_ESP_V5, &s));
  assert(s.count == 3 && s.options == (1 | 2 | 2 << 2) &&
         s.subscription_id == 7);
  assert(TEXT(s.filter[0], "a/+/c") && s.qos[0] == 0);
  assert(TEXT(s.filter[1], "d/#") && s.qos[1] == 1);
  assert(TEXT(s.filter[2], "$share/g/e") && s.qos[2] == 2);
  assert(s.properties.user_count == 1 && TEXT(s.properties.user_key[0], "u"));
  assert(!pocket_mqtt_esp_parse_subscribe(subscribe_v5, sizeof subscribe_v5,
                                          POCKET_MQTT_ESP_V311, &s));
  assert(pocket_mqtt_esp_parse_subscribe(subscribe_v311, sizeof subscribe_v311,
                                         POCKET_MQTT_ESP_V311, &s));
  assert(s.count == 1 && TEXT(s.filter[0], "#"));
  /* "#" -> "a#" is not a filter. */
  uint8_t filter[sizeof subscribe_v311 + 1];
  memcpy(filter, subscribe_v311, sizeof subscribe_v311 - 1);
  filter[sizeof subscribe_v311 - 3] = 2; /* filter length 2 */
  filter[sizeof subscribe_v311 - 1] = 'a';
  filter[sizeof subscribe_v311] = '#';
  assert(!pocket_mqtt_esp_parse_subscribe(filter, sizeof filter,
                                          POCKET_MQTT_ESP_V311, &s));
  filter[sizeof subscribe_v311 - 1] = '/';
  assert(pocket_mqtt_esp_parse_subscribe(filter, sizeof filter,
                                         POCKET_MQTT_ESP_V311, &s));

  assert(pocket_mqtt_esp_parse_unsubscribe(unsubscribe, sizeof unsubscribe,
                                           POCKET_MQTT_ESP_V311, &s));
  assert(s.count == 2 && TEXT(s.filter[0], "a") && TEXT(s.filter[1], "b/#"));

  static pocket_mqtt_esp_disconnect d;
  assert(pocket_mqtt_esp_parse_disconnect(disconnect_v5, sizeof disconnect_v5,
                                          POCKET_MQTT_ESP_V5, &d));
  assert(d.reason == 4 && d.has_session_expiry && d.session_expiry == 120);
  assert(d.properties.user_count == 1 &&
         TEXT(d.properties.user_value[0], "bye"));
  assert(!pocket_mqtt_esp_parse_disconnect(disconnect_v5, sizeof disconnect_v5,
                                           POCKET_MQTT_ESP_V311, &d));
  assert(pocket_mqtt_esp_parse_disconnect(
      disconnect_zero, sizeof disconnect_zero, POCKET_MQTT_ESP_V5, &d));
  assert(d.has_session_expiry && !d.session_expiry);
}

static void record_layouts(void) {
  uint8_t out[POCKET_MQTT_ESP_RECORD];
  const char *keys[] = {"k"}, *values[] = {"v"};
  const pocket_mqtt_esp_received props = {
      .has_payload_format = true,
      .payload_format = 1,
      .content_type = "text/plain",
      .content_type_length = 10,
      .subscription_id = 7,
      .user_count = 1,
      .user_key = keys,
      .user_value = values,
  };
  const size_t head =
      pocket_mqtt_esp_message_head(1 | 4, 3, "a/b", 3, &props, out, sizeof out);
  const uint8_t expected[] = {
      5,   3,    0,  0, 0,   3,   0,    27,  0,   'a', '/', 'b', 0x01,
      1,   0x03, 10, 0, 't', 'e', 'x',  't', '/', 'p', 'l', 'a', 'i',
      'n', 0x0b, 7,  0, 0,   0,   0x26, 1,   0,   'k', 1,   0,   'v'};
  if (head != sizeof expected || memcmp(out, expected, head)) {
    for (size_t i = 0; i < head; ++i)
      fprintf(stderr, "%u,", out[i]);
    fprintf(stderr, "\n");
    assert(0);
  }
  assert(pocket_mqtt_esp_message_head(0, 0, "a/b", 3, NULL, out, 11) == 0);
  assert(pocket_mqtt_esp_message_head(0, 0, "a/b", 3, NULL, out, 12) == 12);

  const pocket_mqtt_esp_connack ack = {.session_present = true,
                                       .protocol = POCKET_MQTT_ESP_V5,
                                       .maximum_qos = 1,
                                       .maximum_packet = 4096,
                                       .receive_maximum = 20,
                                       .topic_alias_maximum = 5,
                                       .retain = true,
                                       .shared = true};
  const pocket_mqtt_esp_received info = {.response_information = "r/"};
  const size_t length =
      pocket_mqtt_esp_connack_record(&ack, &info, out, sizeof out);
  const uint8_t connack[] = {1, 1, 5, 1, 0, 16,   0, 0, 20,  0,  5,
                             0, 9, 0, 5, 0, 0x1a, 2, 0, 'r', '/'};
  assert(length == sizeof connack && !memcmp(out, connack, length));
  /* Properties that do not fit are left out. */
  assert(pocket_mqtt_esp_connack_record(&ack, &info, out, 16) == 16);
}

static void reasons(void) {
  assert(pocket_mqtt_esp_refusal_transient(POCKET_MQTT_ESP_V311, 3));
  assert(!pocket_mqtt_esp_refusal_transient(POCKET_MQTT_ESP_V311, 4));
  assert(pocket_mqtt_esp_refusal_transient(POCKET_MQTT_ESP_V5, 0x89));
  assert(!pocket_mqtt_esp_refusal_transient(POCKET_MQTT_ESP_V5, 0x86));
  assert(!strcmp(pocket_mqtt_esp_reason_name(POCKET_MQTT_ESP_V311, 5),
                 "not authorized"));
  assert(!strcmp(pocket_mqtt_esp_reason_name(POCKET_MQTT_ESP_V5, 0x8e),
                 "session taken over"));
}

int main(void) {
  open_vectors();
  request_vectors();
  record_layouts();
  reasons();
  puts("mqtt-record: ok");
  return 0;
}
