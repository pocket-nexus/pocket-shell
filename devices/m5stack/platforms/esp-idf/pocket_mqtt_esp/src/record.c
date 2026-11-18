#include "record.h"
#include <stddef.h>
#include <string.h>

typedef struct {
  const uint8_t *at, *end;
  bool ok;
} cursor;

static uint8_t take_u8(cursor *c) {
  if (!c->ok || c->end - c->at < 1) {
    c->ok = false;
    return 0;
  }
  return *c->at++;
}

static uint16_t take_u16(cursor *c) {
  if (!c->ok || c->end - c->at < 2) {
    c->ok = false;
    return 0;
  }
  const uint16_t value = (uint16_t)(c->at[0] | c->at[1] << 8);
  c->at += 2;
  return value;
}

static uint32_t take_u32(cursor *c) {
  if (!c->ok || c->end - c->at < 4) {
    c->ok = false;
    return 0;
  }
  const uint32_t value = (uint32_t)c->at[0] | (uint32_t)c->at[1] << 8 |
                         (uint32_t)c->at[2] << 16 | (uint32_t)c->at[3] << 24;
  c->at += 4;
  return value;
}

static const uint8_t *take(cursor *c, size_t length) {
  if (!c->ok || (size_t)(c->end - c->at) < length) {
    c->ok = false;
    return NULL;
  }
  const uint8_t *at = c->at;
  c->at += length;
  return at;
}

/* Well-formed UTF-8 without U+0000 or surrogates (MQTT 1.5.4). */
static bool utf8_valid(const uint8_t *s, size_t length) {
  static const uint32_t MINIMUM[] = {0, 0x80, 0x800, 0x10000};
  for (size_t i = 0; i < length;) {
    const uint8_t lead = s[i];
    size_t extra;
    uint32_t cp;
    if (lead == 0)
      return false;
    if (lead < 0x80) {
      ++i;
      continue;
    }
    if (lead >= 0xc2 && lead < 0xe0) {
      extra = 1;
      cp = lead & 0x1f;
    } else if (lead >= 0xe0 && lead < 0xf0) {
      extra = 2;
      cp = lead & 0x0f;
    } else if (lead >= 0xf0 && lead < 0xf5) {
      extra = 3;
      cp = lead & 0x07;
    } else {
      return false;
    }
    if (i + extra >= length)
      return false;
    for (size_t k = 1; k <= extra; ++k) {
      if ((s[i + k] & 0xc0) != 0x80)
        return false;
      cp = cp << 6 | (s[i + k] & 0x3f);
    }
    if (cp < MINIMUM[extra] || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff))
      return false;
    i += extra + 1;
  }
  return true;
}

/* Copies `length` bytes NUL-terminated into the arena when `out` is set.
 * `string` bytes must be an MQTT UTF-8 string. */
static bool keep(pocket_mqtt_esp_arena *arena, const uint8_t *bytes,
                 size_t length, bool string, pocket_mqtt_esp_text *out) {
  if (string && !utf8_valid(bytes, length))
    return false;
  if (!out)
    return true;
  if (POCKET_MQTT_ESP_ARENA - arena->used < length + 1)
    return false;
  char *copy = arena->bytes + arena->used;
  if (length)
    memcpy(copy, bytes, length);
  copy[length] = '\0';
  arena->used += length + 1;
  *out = (pocket_mqtt_esp_text){.data = copy, .length = (uint16_t)length};
  return true;
}

/* A u16 length and the bytes. */
static bool field(cursor *c, pocket_mqtt_esp_arena *arena, bool string,
                  pocket_mqtt_esp_text *out) {
  const uint16_t length = take_u16(c);
  const uint8_t *bytes = take(c, length);
  return c->ok && keep(arena, bytes, length, string, out);
}

static bool topic_name(const uint8_t *s, size_t length) {
  if (!length)
    return false;
  for (size_t i = 0; i < length; ++i)
    if (s[i] == '+' || s[i] == '#')
      return false;
  return true;
}

/* '#' only as the whole last level, '+' only as a whole level. */
static bool topic_filter(const uint8_t *s, size_t length) {
  if (!length)
    return false;
  size_t start = 0;
  for (size_t i = 0; i <= length; ++i) {
    if (i < length && s[i] != '/')
      continue;
    const size_t span = i - start;
    for (size_t k = start; k < i; ++k) {
      if (s[k] == '#' && (span != 1 || i != length))
        return false;
      if (s[k] == '+' && span != 1)
        return false;
    }
    start = i + 1;
  }
  return true;
}

/* A u16-length field that is also a topic name or a topic filter. */
static bool topic_field(cursor *c, pocket_mqtt_esp_arena *arena, bool filter,
                        pocket_mqtt_esp_text *out) {
  const uint16_t length = take_u16(c);
  const uint8_t *bytes = take(c, length);
  if (!c->ok ||
      !(filter ? topic_filter(bytes, length) : topic_name(bytes, length)))
    return false;
  return keep(arena, bytes, length, true, out);
}

enum {
  ALLOW_FORMAT = 1 << 0,
  ALLOW_EXPIRY = 1 << 1,
  ALLOW_CONTENT_TYPE = 1 << 2,
  ALLOW_RESPONSE_TOPIC = 1 << 3,
  ALLOW_CORRELATION = 1 << 4,
  ALLOW_DELAY = 1 << 5,
  ALLOW_ALIAS = 1 << 6,
  ALLOW_USER = 1 << 7,
  ALLOW_MESSAGE = ALLOW_FORMAT | ALLOW_EXPIRY | ALLOW_CONTENT_TYPE |
      ALLOW_RESPONSE_TOPIC | ALLOW_CORRELATION | ALLOW_USER,
};

/* A property block: u16 byte length, then entries. A block under MQTT 3.1.1
 * is empty; a property other than a user property appears at most once. */
static bool properties(cursor *c, uint8_t protocol, unsigned allowed,
                       pocket_mqtt_esp_arena *arena,
                       pocket_mqtt_esp_properties *out) {
  const uint16_t length = take_u16(c);
  const uint8_t *bytes = take(c, length);
  if (!c->ok || (protocol != POCKET_MQTT_ESP_V5 && length))
    return false;
  pocket_mqtt_esp_properties scratch;
  pocket_mqtt_esp_properties *p = out ? out : &scratch;
  memset(p, 0, sizeof *p);
  cursor b = {.at = bytes, .end = bytes + length, .ok = true};
  while (b.ok && b.at < b.end) {
    const uint8_t id = take_u8(&b);
    unsigned allow;
    uint32_t bit = 0;
    pocket_mqtt_esp_text *text = NULL;
    switch (id) {
    case POCKET_MQTT_ESP_PAYLOAD_FORMAT:
      allow = ALLOW_FORMAT;
      bit = POCKET_MQTT_ESP_HAS_PAYLOAD_FORMAT;
      p->payload_format = take_u8(&b);
      if (p->payload_format > 1)
        return false;
      break;
    case POCKET_MQTT_ESP_MESSAGE_EXPIRY:
      allow = ALLOW_EXPIRY;
      bit = POCKET_MQTT_ESP_HAS_MESSAGE_EXPIRY;
      p->message_expiry = take_u32(&b);
      break;
    case POCKET_MQTT_ESP_CONTENT_TYPE:
      allow = ALLOW_CONTENT_TYPE;
      bit = POCKET_MQTT_ESP_HAS_CONTENT_TYPE;
      if (!field(&b, arena, true, out ? &p->content_type : text))
        return false;
      break;
    case POCKET_MQTT_ESP_RESPONSE_TOPIC:
      allow = ALLOW_RESPONSE_TOPIC;
      bit = POCKET_MQTT_ESP_HAS_RESPONSE_TOPIC;
      if (!topic_field(&b, arena, false, out ? &p->response_topic : text))
        return false;
      break;
    case POCKET_MQTT_ESP_CORRELATION_DATA:
      allow = ALLOW_CORRELATION;
      bit = POCKET_MQTT_ESP_HAS_CORRELATION_DATA;
      if (!field(&b, arena, false, out ? &p->correlation_data : text))
        return false;
      break;
    case POCKET_MQTT_ESP_WILL_DELAY:
      allow = ALLOW_DELAY;
      bit = POCKET_MQTT_ESP_HAS_WILL_DELAY;
      p->will_delay = take_u32(&b);
      break;
    case POCKET_MQTT_ESP_TOPIC_ALIAS:
      allow = ALLOW_ALIAS;
      bit = POCKET_MQTT_ESP_HAS_TOPIC_ALIAS;
      p->topic_alias = take_u16(&b);
      if (!p->topic_alias)
        return false;
      break;
    case POCKET_MQTT_ESP_USER_PROPERTY:
      allow = ALLOW_USER;
      if (p->user_count == POCKET_MQTT_ESP_USER_PROPERTIES ||
          !field(&b, arena, true, out ? &p->user_key[p->user_count] : text) ||
          !field(&b, arena, true, out ? &p->user_value[p->user_count] : text))
        return false;
      ++p->user_count;
      break;
    default:
      return false;
    }
    if (!(allowed & allow) || (p->present & bit))
      return false;
    p->present |= bit;
  }
  return b.ok;
}

/* mqtt://, mqtts://, ws:// or wss:// (any case), a host, and no control
 * characters or spaces. */
static bool url_scheme(const char *url, size_t length, bool *secure) {
  static const struct {
    const char *name;
    bool secure;
  } SCHEMES[] = {{"mqtt://", false},
                 {"mqtts://", true},
                 {"ws://", false},
                 {"wss://", true}};
  for (size_t k = 0; k < length; ++k)
    if ((unsigned char)url[k] <= ' ' || url[k] == 0x7f)
      return false;
  for (size_t i = 0; i < sizeof SCHEMES / sizeof SCHEMES[0]; ++i) {
    const size_t n = strlen(SCHEMES[i].name);
    if (length <= n)
      continue;
    bool same = true;
    for (size_t k = 0; k < n && same; ++k) {
      char ch = url[k];
      if (ch >= 'A' && ch <= 'Z')
        ch = (char)(ch + 32);
      same = ch == SCHEMES[i].name[k];
    }
    if (!same)
      continue;
    if (url[n] == '/' || url[n] == '?' || url[n] == '#')
      return false;
    *secure = SCHEMES[i].secure;
    return true;
  }
  return false;
}

bool pocket_mqtt_esp_parse_open(const uint8_t *bytes, size_t length,
                                pocket_mqtt_esp_open *out) {
  if (!bytes || length > POCKET_MQTT_ESP_RECORD)
    return false;
  /* The ALPN list is split in place, so checking needs real storage too. */
  static pocket_mqtt_esp_open *const NONE = NULL;
  pocket_mqtt_esp_open local;
  pocket_mqtt_esp_open *o = out != NONE ? out : &local;
  memset(o, 0, offsetof(pocket_mqtt_esp_open, arena));
  o->arena.used = 0;
  pocket_mqtt_esp_arena *arena = &o->arena;
  cursor c = {.at = bytes, .end = bytes + length, .ok = true};
  const uint8_t version = take_u8(&c);
  o->protocol = take_u8(&c);
  o->flags = take_u8(&c);
  const uint8_t reserved = take_u8(&c);
  o->keepalive = take_u16(&c);
  o->receive_maximum = take_u16(&c);
  o->reconnect_ms = take_u32(&c);
  o->timeout_ms = take_u32(&c);
  o->max_message = take_u32(&c);
  o->session_expiry = take_u32(&c);
  o->maximum_packet = take_u32(&c);
  o->topic_alias_maximum = take_u16(&c);
  o->ca_bytes = take_u16(&c);
  o->certificate_bytes = take_u16(&c);
  o->key_bytes = take_u16(&c);
  if (!c.ok || version != 1 || reserved ||
      (o->protocol != POCKET_MQTT_ESP_V311 &&
       o->protocol != POCKET_MQTT_ESP_V5))
    return false;
  const bool v5 = o->protocol == POCKET_MQTT_ESP_V5;
  const bool will = o->flags & POCKET_MQTT_ESP_WILL;
  o->will_qos = (uint8_t)(o->flags >> 3 & 3);
  if (o->will_qos > 2 ||
      (!will && (o->will_qos || (o->flags & POCKET_MQTT_ESP_WILL_RETAIN))))
    return false;
  if (!v5 && (o->session_expiry || o->receive_maximum || o->maximum_packet ||
              o->topic_alias_maximum))
    return false;
  if (!v5 && (o->flags & POCKET_MQTT_ESP_NULL_CLIENT_ID) &&
      !(o->flags & POCKET_MQTT_ESP_CLEAN_START))
    return false;
  if (!o->timeout_ms || o->timeout_ms > POCKET_MQTT_ESP_MAX_TIMEOUT_MS ||
      !o->max_message || o->max_message > POCKET_MQTT_ESP_MAX_MESSAGE ||
      o->reconnect_ms > 0x7fffffffu)
    return false;
  if (o->ca_bytes > POCKET_MQTT_ESP_MAX_CREDENTIAL ||
      o->certificate_bytes > POCKET_MQTT_ESP_MAX_CREDENTIAL ||
      o->key_bytes > POCKET_MQTT_ESP_MAX_CREDENTIAL ||
      !o->certificate_bytes != !o->key_bytes)
    return false;
  pocket_mqtt_esp_text alpn = {0};
  if (!field(&c, arena, true, &o->url) ||
      !field(&c, arena, true, &o->client_id) ||
      !field(&c, arena, true, &o->username) ||
      !field(&c, arena, false, &o->password) ||
      !field(&c, arena, false, &o->key_password) ||
      !field(&c, arena, true, &o->common_name) ||
      !field(&c, arena, true, &alpn))
    return false;
  if (!url_scheme(o->url.data, o->url.length, &o->secure))
    return false;
  if ((o->flags & POCKET_MQTT_ESP_NULL_CLIENT_ID) && o->client_id.length)
    return false;
  /* esp-mqtt keeps the password as a C string. */
  if (memchr(o->password.data, '\0', o->password.length))
    return false;
  if (!o->secure && (o->ca_bytes || o->certificate_bytes ||
                     o->common_name.length || alpn.length))
    return false;
  if (o->key_password.length && !o->key_bytes)
    return false;
  if (alpn.length) {
    char *name = (char *)alpn.data;
    size_t count = 0;
    for (char *at = name;; ++at) {
      if (*at != ',' && *at != '\0')
        continue;
      if (at == name || count == POCKET_MQTT_ESP_ALPN)
        return false;
      const bool last = *at == '\0';
      *at = '\0';
      o->alpn[count++] = name;
      if (last)
        break;
      name = at + 1;
    }
  }
  if (will) {
    if (!topic_field(&c, arena, false, &o->will_topic))
      return false;
  } else if (!field(&c, arena, true, &o->will_topic) || o->will_topic.length) {
    return false;
  }
  if (!properties(&c, o->protocol, ALLOW_MESSAGE | ALLOW_DELAY, arena,
                  &o->will) ||
      !field(&c, arena, false, &o->will_payload) ||
      !properties(&c, o->protocol, ALLOW_USER, arena, &o->connect))
    return false;
  if (!will &&
      (o->will.present || o->will.user_count || o->will_payload.length))
    return false;
  return c.ok && c.at == c.end;
}

bool pocket_mqtt_esp_parse_publish(const uint8_t *bytes, size_t length,
                                   uint8_t protocol,
                                   pocket_mqtt_esp_publish *out) {
  if (!bytes || length > POCKET_MQTT_ESP_RECORD)
    return false;
  pocket_mqtt_esp_publish local;
  pocket_mqtt_esp_publish *p = out ? out : &local;
  memset(p, 0, offsetof(pocket_mqtt_esp_publish, arena));
  p->arena.used = 0;
  cursor c = {.at = bytes, .end = bytes + length, .ok = true};
  const uint8_t version = take_u8(&c), flags = take_u8(&c);
  const uint16_t topic_length = take_u16(&c);
  p->payload_bytes = take_u32(&c);
  const uint8_t *topic = take(&c, topic_length);
  if (!c.ok || version != 1 || (flags & 0xf0) || (flags & 3) > 2 ||
      !topic_name(topic, topic_length) ||
      !keep(&p->arena, topic, topic_length, true, out ? &p->topic : NULL))
    return false;
  p->qos = flags & 3;
  p->retain = (flags & 4) != 0;
  p->staged = (flags & 8) != 0;
  if (!properties(&c, protocol, ALLOW_MESSAGE | ALLOW_ALIAS, &p->arena,
                  out ? &p->properties : NULL))
    return false;
  const size_t rest = (size_t)(c.end - c.at);
  if (p->staged)
    return rest == 0 && p->payload_bytes > 0 &&
           p->payload_bytes <= POCKET_MQTT_ESP_MAX_STAGED;
  if (rest != p->payload_bytes)
    return false;
  p->payload = rest ? c.at : NULL;
  return true;
}

static bool filters(cursor *c, pocket_mqtt_esp_subscribe *s, bool subscribe,
                    bool keep_copies) {
  for (uint8_t i = 0; i < s->count; ++i) {
    if (subscribe) {
      s->qos[i] = take_u8(c);
      if (s->qos[i] > 2)
        return false;
    }
    if (!topic_field(c, &s->arena, true, keep_copies ? &s->filter[i] : NULL))
      return false;
  }
  return c->ok && c->at == c->end;
}

bool pocket_mqtt_esp_parse_subscribe(const uint8_t *bytes, size_t length,
                                     uint8_t protocol,
                                     pocket_mqtt_esp_subscribe *out) {
  if (!bytes || length > POCKET_MQTT_ESP_RECORD)
    return false;
  pocket_mqtt_esp_subscribe local;
  pocket_mqtt_esp_subscribe *s = out ? out : &local;
  memset(s, 0, offsetof(pocket_mqtt_esp_subscribe, arena));
  s->arena.used = 0;
  cursor c = {.at = bytes, .end = bytes + length, .ok = true};
  const uint8_t version = take_u8(&c);
  s->count = take_u8(&c);
  s->options = take_u8(&c);
  const uint8_t reserved = take_u8(&c);
  s->subscription_id = take_u32(&c);
  if (!c.ok || version != 1 || reserved || !s->count ||
      s->count > POCKET_MQTT_ESP_FILTERS || (s->options & 0xf0) ||
      (s->options >> 2 & 3) > 2 ||
      s->subscription_id > POCKET_MQTT_ESP_MAX_SUBSCRIPTION_ID)
    return false;
  if (protocol != POCKET_MQTT_ESP_V5 && (s->options || s->subscription_id))
    return false;
  return properties(&c, protocol, ALLOW_USER, &s->arena,
                    out ? &s->properties : NULL) &&
         filters(&c, s, true, out != NULL);
}

bool pocket_mqtt_esp_parse_unsubscribe(const uint8_t *bytes, size_t length,
                                       uint8_t protocol,
                                       pocket_mqtt_esp_subscribe *out) {
  if (!bytes || length > POCKET_MQTT_ESP_RECORD)
    return false;
  pocket_mqtt_esp_subscribe local;
  pocket_mqtt_esp_subscribe *s = out ? out : &local;
  memset(s, 0, offsetof(pocket_mqtt_esp_subscribe, arena));
  s->arena.used = 0;
  cursor c = {.at = bytes, .end = bytes + length, .ok = true};
  const uint8_t version = take_u8(&c);
  s->count = take_u8(&c);
  if (!c.ok || version != 1 || !s->count || s->count > POCKET_MQTT_ESP_FILTERS)
    return false;
  return properties(&c, protocol, ALLOW_USER, &s->arena,
                    out ? &s->properties : NULL) &&
         filters(&c, s, false, out != NULL);
}

bool pocket_mqtt_esp_parse_disconnect(const uint8_t *bytes, size_t length,
                                      uint8_t protocol,
                                      pocket_mqtt_esp_disconnect *out) {
  if (!bytes || length > POCKET_MQTT_ESP_RECORD)
    return false;
  pocket_mqtt_esp_disconnect local;
  pocket_mqtt_esp_disconnect *d = out ? out : &local;
  memset(d, 0, offsetof(pocket_mqtt_esp_disconnect, arena));
  d->arena.used = 0;
  cursor c = {.at = bytes, .end = bytes + length, .ok = true};
  const uint8_t version = take_u8(&c);
  d->reason = take_u8(&c);
  const uint8_t flags = take_u8(&c), reserved = take_u8(&c);
  d->session_expiry = take_u32(&c);
  d->has_session_expiry = flags & 1;
  if (!c.ok || version != 1 || reserved || (flags & 0xfe) ||
      (!d->has_session_expiry && d->session_expiry))
    return false;
  if (protocol != POCKET_MQTT_ESP_V5 && (d->reason || flags))
    return false;
  return properties(&c, protocol, ALLOW_USER, &d->arena,
                    out ? &d->properties : NULL) &&
         c.at == c.end;
}

void pocket_mqtt_esp_put_bytes(pocket_mqtt_esp_writer *w, const void *data,
                               size_t length) {
  if (w->overflow || w->capacity - w->length < length) {
    w->overflow = true;
    return;
  }
  if (length)
    memcpy(w->data + w->length, data, length);
  w->length += length;
}

void pocket_mqtt_esp_put_u8(pocket_mqtt_esp_writer *w, uint8_t value) {
  pocket_mqtt_esp_put_bytes(w, &value, 1);
}

void pocket_mqtt_esp_put_u16(pocket_mqtt_esp_writer *w, uint16_t value) {
  const uint8_t bytes[2] = {(uint8_t)value, (uint8_t)(value >> 8)};
  pocket_mqtt_esp_put_bytes(w, bytes, 2);
}

void pocket_mqtt_esp_put_u32(pocket_mqtt_esp_writer *w, uint32_t value) {
  const uint8_t bytes[4] = {(uint8_t)value, (uint8_t)(value >> 8),
                            (uint8_t)(value >> 16), (uint8_t)(value >> 24)};
  pocket_mqtt_esp_put_bytes(w, bytes, 4);
}

void pocket_mqtt_esp_put_field(pocket_mqtt_esp_writer *w, const void *data,
                               size_t length) {
  if (length > 0xffff) {
    w->overflow = true;
    return;
  }
  pocket_mqtt_esp_put_u16(w, (uint16_t)length);
  pocket_mqtt_esp_put_bytes(w, data, length);
}

void pocket_mqtt_esp_patch_u16(pocket_mqtt_esp_writer *w, size_t at,
                               uint16_t value) {
  if (!w->overflow && at + 2 <= w->length) {
    w->data[at] = (uint8_t)value;
    w->data[at + 1] = (uint8_t)(value >> 8);
  }
}

/* Received properties as entries; `connack` writes the response information
 * instead of the message properties. */
static void put_received(pocket_mqtt_esp_writer *w,
                         const pocket_mqtt_esp_received *p, bool connack) {
  if (!p)
    return;
  if (connack) {
    if (p->response_information) {
      pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_RESPONSE_INFORMATION);
      pocket_mqtt_esp_put_field(w, p->response_information,
                                strlen(p->response_information));
    }
  } else {
    if (p->has_payload_format) {
      pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_PAYLOAD_FORMAT);
      pocket_mqtt_esp_put_u8(w, p->payload_format);
    }
    if (p->content_type) {
      pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_CONTENT_TYPE);
      pocket_mqtt_esp_put_field(w, p->content_type, p->content_type_length);
    }
    if (p->response_topic) {
      pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_RESPONSE_TOPIC);
      pocket_mqtt_esp_put_field(w, p->response_topic, p->response_topic_length);
    }
    if (p->correlation_data) {
      pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_CORRELATION_DATA);
      pocket_mqtt_esp_put_field(w, p->correlation_data,
                                p->correlation_data_length);
    }
    if (p->subscription_id) {
      pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_SUBSCRIPTION_ID);
      pocket_mqtt_esp_put_u32(w, p->subscription_id);
    }
  }
  for (size_t i = 0; i < p->user_count; ++i) {
    pocket_mqtt_esp_put_u8(w, POCKET_MQTT_ESP_USER_PROPERTY);
    pocket_mqtt_esp_put_field(w, p->user_key[i], strlen(p->user_key[i]));
    pocket_mqtt_esp_put_field(w, p->user_value[i], strlen(p->user_value[i]));
  }
}

size_t pocket_mqtt_esp_connack_record(const pocket_mqtt_esp_connack *ack,
                                      const pocket_mqtt_esp_received *props,
                                      uint8_t *out, size_t capacity) {
  pocket_mqtt_esp_writer w = {.data = out, .capacity = capacity};
  pocket_mqtt_esp_put_u8(&w, 1);
  pocket_mqtt_esp_put_u8(&w, ack->session_present ? 1 : 0);
  pocket_mqtt_esp_put_u8(&w, ack->protocol);
  pocket_mqtt_esp_put_u8(&w, ack->maximum_qos);
  pocket_mqtt_esp_put_u32(&w, ack->maximum_packet);
  pocket_mqtt_esp_put_u16(&w, ack->receive_maximum);
  pocket_mqtt_esp_put_u16(&w, ack->topic_alias_maximum);
  pocket_mqtt_esp_put_u8(
      &w, (uint8_t)((ack->retain ? 1 : 0) | (ack->wildcard ? 2 : 0) |
                    (ack->subscription_ids ? 4 : 0) | (ack->shared ? 8 : 0)));
  pocket_mqtt_esp_put_u8(&w, 0);
  const size_t at = w.length;
  pocket_mqtt_esp_put_u16(&w, 0);
  put_received(&w, props, true);
  if (w.overflow) {
    /* Without the properties the record always fits. */
    w = (pocket_mqtt_esp_writer){
        .data = out, .capacity = capacity, .length = at};
    pocket_mqtt_esp_put_u16(&w, 0);
    return w.overflow ? 0 : w.length;
  }
  pocket_mqtt_esp_patch_u16(&w, at, (uint16_t)(w.length - at - 2));
  return w.length;
}

size_t pocket_mqtt_esp_message_head(uint8_t flags, uint32_t payload_bytes,
                                    const char *topic, size_t topic_length,
                                    const pocket_mqtt_esp_received *props,
                                    uint8_t *out, size_t capacity) {
  if (topic_length > 0xffff)
    return 0;
  pocket_mqtt_esp_writer w = {.data = out, .capacity = capacity};
  pocket_mqtt_esp_put_u8(&w, flags);
  pocket_mqtt_esp_put_u32(&w, payload_bytes);
  pocket_mqtt_esp_put_u16(&w, (uint16_t)topic_length);
  const size_t at = w.length;
  pocket_mqtt_esp_put_u16(&w, 0);
  pocket_mqtt_esp_put_bytes(&w, topic, topic_length);
  const size_t start = w.length;
  put_received(&w, props, false);
  const size_t size = w.length - start;
  if (w.overflow || size > 0xffff)
    return 0;
  pocket_mqtt_esp_patch_u16(&w, at, (uint16_t)size);
  return w.length;
}

bool pocket_mqtt_esp_refusal_transient(uint8_t protocol, int code) {
  if (protocol != POCKET_MQTT_ESP_V5)
    return code == 3;
  return code == 0x88 || code == 0x89 || code == 0x97 || code == 0x9f;
}

const char *pocket_mqtt_esp_reason_name(uint8_t protocol, int code) {
  if (protocol != POCKET_MQTT_ESP_V5) {
    static const char *const NAMES[] = {"accepted",
                                        "unacceptable protocol version",
                                        "identifier rejected",
                                        "server unavailable",
                                        "bad user name or password",
                                        "not authorized"};
    return code >= 0 && code < 6 ? NAMES[code] : "unknown return code";
  }
  switch (code) {
  case 0x00:
    return "success";
  case 0x04:
    return "disconnect with will message";
  case 0x10:
    return "no matching subscribers";
  case 0x11:
    return "no subscription existed";
  case 0x80:
    return "unspecified error";
  case 0x81:
    return "malformed packet";
  case 0x82:
    return "protocol error";
  case 0x83:
    return "implementation specific error";
  case 0x84:
    return "unsupported protocol version";
  case 0x85:
    return "client identifier not valid";
  case 0x86:
    return "bad user name or password";
  case 0x87:
    return "not authorized";
  case 0x88:
    return "server unavailable";
  case 0x89:
    return "server busy";
  case 0x8a:
    return "banned";
  case 0x8b:
    return "server shutting down";
  case 0x8c:
    return "bad authentication method";
  case 0x8d:
    return "keep alive timeout";
  case 0x8e:
    return "session taken over";
  case 0x8f:
    return "topic filter invalid";
  case 0x90:
    return "topic name invalid";
  case 0x91:
    return "packet identifier in use";
  case 0x93:
    return "receive maximum exceeded";
  case 0x94:
    return "topic alias invalid";
  case 0x95:
    return "packet too large";
  case 0x96:
    return "message rate too high";
  case 0x97:
    return "quota exceeded";
  case 0x98:
    return "administrative action";
  case 0x99:
    return "payload format invalid";
  case 0x9a:
    return "retain not supported";
  case 0x9b:
    return "QoS not supported";
  case 0x9c:
    return "use another server";
  case 0x9d:
    return "server moved";
  case 0x9e:
    return "shared subscriptions not supported";
  case 0x9f:
    return "connection rate exceeded";
  case 0xa0:
    return "maximum connect time";
  case 0xa1:
    return "subscription identifiers not supported";
  case 0xa2:
    return "wildcard subscriptions not supported";
  default:
    return "unknown reason code";
  }
}
