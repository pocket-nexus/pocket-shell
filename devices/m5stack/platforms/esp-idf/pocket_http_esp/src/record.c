#include "record.h"
#include <ctype.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>

#define COUNT(array) (sizeof(array) / sizeof((array)[0]))

static const char *const METHODS[] = {"GET",   "HEAD",   "POST",   "PUT",
                                      "PATCH", "DELETE", "OPTIONS"};
static const char *const HOP_BY_HOP[] = {"connection",
                                         "keep-alive",
                                         "proxy-authenticate",
                                         "proxy-authorization",
                                         "proxy-connection",
                                         "te",
                                         "trailer",
                                         "transfer-encoding",
                                         "upgrade"};
/* Response headers kept first when a response carries more than fits. */
static const char *const PRIORITY[] = {
    "content-type",  "location", "etag", "last-modified",
    "cache-control", "expires",  "date", "retry-after"};

static bool listed(const char *const *names, size_t count, const char *name) {
  for (size_t i = 0; i < count; ++i)
    if (!strcmp(names[i], name))
      return true;
  return false;
}

const char *pocket_http_esp_method_name(uint8_t method) {
  return method < COUNT(METHODS) ? METHODS[method] : NULL;
}

bool pocket_http_esp_request_dropped(const char *name) {
  return listed(HOP_BY_HOP, COUNT(HOP_BY_HOP), name) || !strcmp(name, "host") ||
         !strcmp(name, "content-length") || !strcmp(name, "expect");
}

/* ---- JSON ---- */

typedef struct {
  const char *at, *end;
} cursor;

static void space(cursor *c) {
  while (c->at < c->end &&
         (*c->at == ' ' || *c->at == '\t' || *c->at == '\n' || *c->at == '\r'))
    ++c->at;
}

static bool take(cursor *c, char expected) {
  space(c);
  if (c->at >= c->end || *c->at != expected)
    return false;
  ++c->at;
  return true;
}

static int hex4(const char *at) {
  int value = 0;
  for (int i = 0; i < 4; ++i) {
    const char h = at[i];
    value <<= 4;
    if (h >= '0' && h <= '9')
      value |= h - '0';
    else if ((h | 0x20) >= 'a' && (h | 0x20) <= 'f')
      value |= (h | 0x20) - 'a' + 10;
    else
      return -1;
  }
  return value;
}

/* Decode a string into out (NUL-terminated); its byte length, which can count
 * NUL bytes, or -1. Raw control characters and unpaired surrogates fail. */
static long string(cursor *c, char *out, size_t capacity) {
  space(c);
  if (c->at >= c->end || *c->at != '"' || !capacity)
    return -1;
  size_t used = 0;
  for (++c->at; c->at < c->end; ++c->at) {
    unsigned char ch = (unsigned char)*c->at;
    unsigned long code = ch;
    if (ch == '"') {
      ++c->at;
      out[used] = 0;
      return (long)used;
    }
    if (ch < 0x20)
      return -1;
    if (ch == '\\') {
      if (++c->at >= c->end)
        return -1;
      switch (*c->at) {
      case '"':
      case '\\':
      case '/':
        code = (unsigned char)*c->at;
        break;
      case 'b':
        code = '\b';
        break;
      case 'f':
        code = '\f';
        break;
      case 'n':
        code = '\n';
        break;
      case 'r':
        code = '\r';
        break;
      case 't':
        code = '\t';
        break;
      case 'u': {
        if (c->end - c->at < 5)
          return -1;
        const int high = hex4(c->at + 1);
        if (high < 0 || (high >= 0xdc00 && high <= 0xdfff))
          return -1;
        c->at += 4;
        code = (unsigned long)high;
        if (high >= 0xd800 && high <= 0xdbff) {
          if (c->end - c->at < 7 || c->at[1] != '\\' || c->at[2] != 'u')
            return -1;
          const int low = hex4(c->at + 3);
          if (low < 0xdc00 || low > 0xdfff)
            return -1;
          c->at += 6;
          code = 0x10000 + (((unsigned long)high - 0xd800) << 10) +
                 ((unsigned long)low - 0xdc00);
        }
        break;
      }
      default:
        return -1;
      }
    } else {
      /* Raw bytes, including UTF-8 sequences, pass through. */
      if (used + 1 >= capacity)
        return -1;
      out[used++] = (char)ch;
      continue;
    }
    const size_t width = code < 0x80      ? 1
                         : code < 0x800   ? 2
                         : code < 0x10000 ? 3
                                          : 4;
    if (used + width >= capacity)
      return -1;
    if (width == 1) {
      out[used++] = (char)code;
    } else {
      static const unsigned char lead[] = {0, 0, 0xc0, 0xe0, 0xf0};
      for (size_t i = width; i-- > 1;) {
        out[used + i] = (char)(0x80 | (code & 0x3f));
        code >>= 6;
      }
      out[used] = (char)(lead[width] | code);
      used += width;
    }
  }
  return -1;
}

static bool number(cursor *c, uint64_t *out) {
  space(c);
  uint64_t value = 0;
  const char *start = c->at;
  while (c->at < c->end && *c->at >= '0' && *c->at <= '9') {
    if (value > (UINT64_C(1) << 53))
      return false;
    value = value * 10 + (uint64_t)(*c->at++ - '0');
  }
  if (c->at == start || (c->at - start > 1 && *start == '0') ||
      (c->at < c->end &&
       (*c->at == '.' || *c->at == 'e' || *c->at == 'E' || *c->at == '-')))
    return false;
  *out = value;
  return true;
}

/* Past one string without decoding it. */
static bool skip_string(cursor *c) {
  space(c);
  if (c->at >= c->end || *c->at != '"')
    return false;
  for (++c->at; c->at < c->end; ++c->at) {
    if ((unsigned char)*c->at < 0x20)
      return false;
    if (*c->at == '\\')
      ++c->at;
    else if (*c->at == '"') {
      ++c->at;
      return true;
    }
  }
  return false;
}

/* Skip one value of a member the descriptor does not use. */
static bool skip(cursor *c, int depth) {
  space(c);
  if (c->at >= c->end || depth > 8)
    return false;
  if (*c->at == '"')
    return skip_string(c);
  if (*c->at == '{' || *c->at == '[') {
    const char close = *c->at == '{' ? '}' : ']';
    ++c->at;
    if (take(c, close))
      return true;
    for (;;) {
      if (close == '}' && (!skip_string(c) || !take(c, ':')))
        return false;
      if (!skip(c, depth + 1))
        return false;
      if (take(c, close))
        return true;
      if (!take(c, ','))
        return false;
    }
  }
  static const char *const words[] = {"true", "false", "null"};
  for (size_t i = 0; i < COUNT(words); ++i) {
    const size_t n = strlen(words[i]);
    if ((size_t)(c->end - c->at) >= n && !memcmp(c->at, words[i], n)) {
      c->at += n;
      return true;
    }
  }
  const char *start = c->at;
  while (c->at < c->end && strchr("0123456789+-.eE", *c->at))
    ++c->at;
  return c->at > start;
}

static bool token(const char *name) {
  if (!*name)
    return false;
  for (const char *ch = name; *ch; ++ch)
    if (!isalnum((unsigned char)*ch) && !strchr("!#$%&'*+-.^_`|~", *ch))
      return false;
  return true;
}

static bool add_header(pocket_http_esp_request *r, const char *name,
                       const char *value) {
  /* The last of a repeated name holds. */
  for (size_t at = 0; at < r->headers_length;) {
    char *pair = r->headers + at;
    size_t span = strlen(pair) + 1;
    span += strlen(pair + span) + 1;
    if (!strcmp(pair, name)) {
      memmove(pair, pair + span, r->headers_length - at - span);
      r->headers_length -= span;
    } else {
      at += span;
    }
  }
  const size_t n = strlen(name) + 1, v = strlen(value) + 1;
  if (r->headers_length + n + v > sizeof r->headers)
    return false;
  memcpy(r->headers + r->headers_length, name, n);
  memcpy(r->headers + r->headers_length + n, value, v);
  r->headers_length += n + v;
  return true;
}

static bool headers(cursor *c, pocket_http_esp_request *r) {
  if (!take(c, '{'))
    return false;
  if (take(c, '}'))
    return true;
  for (;;) {
    char name[128], value[POCKET_HTTP_ESP_RECORD + 1];
    const long n = string(c, name, sizeof name);
    if (n <= 0 || strlen(name) != (size_t)n || !take(c, ':'))
      return false;
    const long v = string(c, value, sizeof value);
    if (v < 0 || strlen(value) != (size_t)v || strpbrk(value, "\r\n"))
      return false;
    for (char *ch = name; *ch; ++ch)
      *ch = (char)tolower((unsigned char)*ch);
    if (!token(name) || !add_header(r, name, value))
      return false;
    if (take(c, '}'))
      return true;
    if (!take(c, ','))
      return false;
  }
}

static bool url_text(const char *url) {
  if (strncmp(url, "https://", 8) && strncmp(url, "http://", 7))
    return false;
  for (const unsigned char *ch = (const unsigned char *)url; *ch; ++ch)
    if (*ch <= 0x20 || *ch == 0x7f)
      return false;
  return true;
}

bool pocket_http_esp_parse(const uint8_t *descriptor, size_t length,
                           pocket_http_esp_request *out) {
  if (!descriptor || !length || length > POCKET_HTTP_ESP_RECORD || !out)
    return false;
  memset(out, 0, sizeof *out);
  out->timeout_ms = POCKET_HTTP_ESP_TIMEOUT_MS;
  out->max_bytes = POCKET_HTTP_ESP_MAX_BYTES;
  cursor c = {(const char *)descriptor, (const char *)descriptor + length};
  bool has_url = false;
  if (!take(&c, '{'))
    return false;
  if (!take(&c, '}')) {
    for (;;) {
      char key[16] = "";
      const cursor before = c;
      if (string(&c, key, sizeof key) < 0) {
        /* A key this long names no member the descriptor reads. */
        c = before;
        key[0] = 0;
        if (!skip_string(&c))
          return false;
      }
      if (!take(&c, ':'))
        return false;
      uint64_t value = 0;
      if (!strcmp(key, "url")) {
        const long u = string(&c, out->url, sizeof out->url);
        if (u < 1 || strlen(out->url) != (size_t)u || !url_text(out->url))
          return false;
        has_url = true;
      } else if (!strcmp(key, "method")) {
        char method[8];
        if (string(&c, method, sizeof method) < 1)
          return false;
        size_t m = 0;
        while (m < COUNT(METHODS) && strcmp(METHODS[m], method))
          ++m;
        if (m == COUNT(METHODS))
          return false;
        out->method = (uint8_t)m;
      } else if (!strcmp(key, "headers")) {
        if (!headers(&c, out))
          return false;
      } else if (!strcmp(key, "body")) {
        const long b = string(&c, out->body, sizeof out->body);
        if (b < 0)
          return false;
        out->body_length = (size_t)b;
      } else if (!strcmp(key, "timeoutMs")) {
        if (!number(&c, &value) || !value ||
            value > POCKET_HTTP_ESP_MAX_TIMEOUT_MS)
          return false;
        out->timeout_ms = (uint32_t)value;
      } else if (!strcmp(key, "maxBytes")) {
        if (!number(&c, &value) || value > POCKET_HTTP_ESP_MAX_BYTES)
          return false;
        out->max_bytes = (uint32_t)value;
      } else if (!skip(&c, 0)) {
        return false;
      }
      if (take(&c, '}'))
        break;
      if (!take(&c, ','))
        return false;
    }
  }
  space(&c);
  return has_url && c.at == c.end &&
         !(out->body_length && (out->method == POCKET_HTTP_ESP_GET ||
                                out->method == POCKET_HTTP_ESP_HEAD));
}

/* ---- URLs ---- */

bool pocket_http_esp_url_parse(const char *url, pocket_http_esp_url *out) {
  memset(out, 0, sizeof *out);
  size_t at;
  if (!strncasecmp(url, "https://", 8)) {
    out->https = true;
    at = 8;
  } else if (!strncasecmp(url, "http://", 7)) {
    at = 7;
  } else {
    return false;
  }
  for (const unsigned char *ch = (const unsigned char *)url; *ch; ++ch)
    if (*ch <= 0x20 || *ch == 0x7f)
      return false;
  size_t end = at;
  while (url[end] && !strchr("/?#", url[end]))
    ++end;
  out->authority_end = end;
  out->path_end = end;
  while (url[out->path_end] && !strchr("?#", url[out->path_end]))
    ++out->path_end;
  /* Userinfo ends at the last '@' of the authority. */
  for (size_t i = at; i < end; ++i)
    if (url[i] == '@')
      at = i + 1;
  size_t host_end = at;
  const char *port = NULL;
  if (url[at] == '[') {
    while (host_end < end && url[host_end] != ']')
      ++host_end;
    if (host_end == end)
      return false;
    ++at;
    if (host_end + 1 < end) {
      if (url[host_end + 1] != ':')
        return false;
      port = url + host_end + 2;
    }
  } else {
    while (host_end < end && url[host_end] != ':')
      ++host_end;
    if (host_end < end)
      port = url + host_end + 1;
  }
  const size_t host_length = host_end - at;
  if (!host_length || host_length >= sizeof out->host)
    return false;
  for (size_t i = 0; i < host_length; ++i)
    out->host[i] = (char)tolower((unsigned char)url[at + i]);
  out->port = out->https ? 443 : 80;
  if (port && port < url + end) {
    unsigned long value = 0;
    for (const char *p = port; p < url + end; ++p) {
      if (*p < '0' || *p > '9')
        return false;
      value = value * 10 + (unsigned long)(*p - '0');
      if (value > 65535)
        return false;
    }
    if (!value)
      return false;
    out->port = (uint16_t)value;
  }
  return true;
}

bool pocket_http_esp_same_origin(const pocket_http_esp_url *a,
                                 const pocket_http_esp_url *b) {
  return a->https == b->https && a->port == b->port &&
         !strcmp(a->host, b->host);
}

bool pocket_http_esp_companion_url(const char *url) {
  pocket_http_esp_url parsed;
  return url && pocket_http_esp_url_parse(url, &parsed) &&
         !strcmp(parsed.host, POCKET_HTTP_ESP_COMPANION_HOST);
}

static bool has_scheme(const char *text) {
  if (!isalpha((unsigned char)text[0]))
    return false;
  for (const char *ch = text + 1; *ch; ++ch) {
    if (*ch == ':')
      return true;
    if (!isalnum((unsigned char)*ch) && *ch != '+' && *ch != '-' && *ch != '.')
      return false;
  }
  return false;
}

bool pocket_http_esp_resolve(const char *base, const char *location, char *out,
                             size_t capacity) {
  pocket_http_esp_url url;
  if (!pocket_http_esp_url_parse(base, &url))
    return false;
  int written;
  if (has_scheme(location)) {
    written = snprintf(out, capacity, "%s", location);
  } else if (location[0] == '/' && location[1] == '/') {
    written = snprintf(out, capacity, "%s:%s", url.https ? "https" : "http",
                       location);
  } else if (location[0] == '/') {
    written = snprintf(out, capacity, "%.*s%s", (int)url.authority_end, base,
                       location);
  } else if (location[0] == '?' || location[0] == '#') {
    size_t keep = url.path_end;
    if (location[0] == '#')
      while (base[keep] && base[keep] != '#')
        ++keep;
    written = snprintf(out, capacity, "%.*s%s", (int)keep, base, location);
  } else {
    /* Relative to the base path's directory. */
    size_t keep = url.path_end;
    while (keep > url.authority_end && base[keep - 1] != '/')
      --keep;
    written = snprintf(out, capacity, "%.*s%s%s", (int)keep, base,
                       keep == url.authority_end ? "/" : "", location);
  }
  return written > 0 && (size_t)written < capacity;
}

/* ---- the headers record ---- */

/* Append `text` as a quoted JSON string; false when it does not fit. */
static bool quoted(char *out, size_t capacity, size_t *used, const char *text,
                   size_t length) {
  size_t at = *used;
  if (at >= capacity)
    return false;
  out[at++] = '"';
  for (size_t i = 0; i < length; ++i) {
    const unsigned char ch = (unsigned char)text[i];
    char escaped[7] = {0};
    if (ch == '"' || ch == '\\')
      escaped[0] = '\\', escaped[1] = (char)ch;
    else if (ch == '\n')
      memcpy(escaped, "\\n", 2);
    else if (ch < 0x20)
      snprintf(escaped, sizeof escaped, "\\u%04x", ch);
    else
      escaped[0] = (char)ch;
    const size_t n = strlen(escaped);
    if (at + n >= capacity)
      return false;
    memcpy(out + at, escaped, n);
    at += n;
  }
  if (at >= capacity)
    return false;
  out[at++] = '"';
  *used = at;
  return true;
}

static const char *next_field(const char *fields, size_t length,
                              const char *name, const char **value) {
  const char *at = fields;
  if (name) {
    const char *current = name + strlen(name) + 1;
    at = current + strlen(current) + 1;
  }
  if (!fields || at >= fields + length)
    return NULL;
  *value = at + strlen(at) + 1;
  return at;
}

/* Every field named `name`, joined, as one member. */
static bool member(const char *fields, size_t length, const char *name,
                   char *out, size_t capacity, size_t *used) {
  char joined[POCKET_HTTP_ESP_RECORD];
  size_t n = 0;
  const char *separator = strcmp(name, "set-cookie") ? ", " : "\n";
  const char *value;
  for (const char *field = next_field(fields, length, NULL, &value); field;
       field = next_field(fields, length, field, &value)) {
    if (strcmp(field, name))
      continue;
    const int added = snprintf(joined + n, sizeof joined - n, "%s%s",
                               n ? separator : "", value);
    if (added < 0 || (size_t)added >= sizeof joined - n)
      return false;
    n += (size_t)added;
  }
  size_t at = *used;
  if (!quoted(out, capacity, &at, name, strlen(name)) || at >= capacity)
    return false;
  out[at++] = ':';
  if (!quoted(out, capacity, &at, joined, n))
    return false;
  *used = at;
  return true;
}

static const char *first_field(const char *fields, size_t length,
                               const char *name) {
  const char *value;
  for (const char *field = next_field(fields, length, NULL, &value); field;
       field = next_field(fields, length, field, &value))
    if (!strcmp(field, name))
      return field;
  return NULL;
}

/* Append the member for `name` after a comma unless it is the first; a
 * member that does not fit is skipped. */
static void append(const char *fields, size_t length, const char *name,
                   char *out, size_t room, size_t *used, bool *first) {
  size_t at = *used + (*first ? 0 : 1);
  if (listed(HOP_BY_HOP, COUNT(HOP_BY_HOP), name) || at >= room ||
      !member(fields, length, name, out, room, &at))
    return;
  if (!*first)
    out[*used] = ',';
  *used = at;
  *first = false;
}

size_t pocket_http_esp_head(int status, const char *url, const char *fields,
                            size_t fields_length, char *out, size_t capacity) {
  static const char open[] = ",\"headers\":{";
  if (!out || capacity < 2)
    return 0;
  const int n = snprintf(out, capacity, "{\"status\":%d,\"url\":", status);
  if (n < 0 || (size_t)n >= capacity)
    return 0;
  size_t used = (size_t)n;
  /* Two bytes stay for the closing braces. */
  const size_t room = capacity - 2;
  if (!quoted(out, room, &used, url, strlen(url)) || used + strlen(open) > room)
    return 0;
  memcpy(out + used, open, strlen(open));
  used += strlen(open);
  bool first = true;
  for (size_t i = 0; i < COUNT(PRIORITY); ++i)
    if (first_field(fields, fields_length, PRIORITY[i]))
      append(fields, fields_length, PRIORITY[i], out, room, &used, &first);
  const char *value;
  for (const char *field = next_field(fields, fields_length, NULL, &value);
       field; field = next_field(fields, fields_length, field, &value))
    if (!listed(PRIORITY, COUNT(PRIORITY), field) &&
        first_field(fields, fields_length, field) == field)
      append(fields, fields_length, field, out, room, &used, &first);
  out[used++] = '}';
  out[used++] = '}';
  return used;
}
