#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* The HTTP descriptor and headers record of the worker's io.http resource
 * (contracts/spec/worker.ts), with the limits of the 3DS provider
 * (engine/host-services/link_http.c). Pure C: no IDF dependency. */
#define POCKET_HTTP_ESP_RECORD 1024u
#define POCKET_HTTP_ESP_URL 2048u
#define POCKET_HTTP_ESP_TIMEOUT_MS 30000u
#define POCKET_HTTP_ESP_MAX_TIMEOUT_MS 120000u
#define POCKET_HTTP_ESP_MAX_BYTES (256u * 1024u)
#define POCKET_HTTP_ESP_REDIRECTS 3u

enum {
  POCKET_HTTP_ESP_GET,
  POCKET_HTTP_ESP_HEAD,
  POCKET_HTTP_ESP_POST,
  POCKET_HTTP_ESP_PUT,
  POCKET_HTTP_ESP_PATCH,
  POCKET_HTTP_ESP_DELETE,
  POCKET_HTTP_ESP_OPTIONS
};

/* A checked descriptor. headers holds name NUL value NUL pairs, names in
 * lower case, the last of a repeated name kept; body may hold NUL bytes. */
typedef struct {
  char url[POCKET_HTTP_ESP_RECORD + 1];
  char headers[POCKET_HTTP_ESP_RECORD + 1];
  char body[POCKET_HTTP_ESP_RECORD + 1];
  size_t headers_length, body_length;
  uint32_t timeout_ms, max_bytes;
  uint8_t method;
} pocket_http_esp_request;

/* JSON {url, method?, headers?, body?, timeoutMs?, maxBytes?}: an http:// or
 * https:// URL, a method of the closed set, string header fields with token
 * names and no CR, LF or NUL in a value, a UTF-8 body (none for GET and
 * HEAD), timeoutMs 1..120000 (30000) and maxBytes 0..262144 (262144). */
bool pocket_http_esp_parse(const uint8_t *descriptor, size_t length,
                           pocket_http_esp_request *out);
const char *pocket_http_esp_method_name(uint8_t method);
/* Hop-by-hop fields, host, content-length and expect: the transport writes
 * them or they end at one hop. */
bool pocket_http_esp_request_dropped(const char *name);

typedef struct {
  bool https;
  uint16_t port;
  /* Where the path, query or fragment starts, and where the path ends. */
  size_t authority_end, path_end;
  char host[256];
} pocket_http_esp_url;
bool pocket_http_esp_url_parse(const char *url, pocket_http_esp_url *out);
bool pocket_http_esp_same_origin(const pocket_http_esp_url *a,
                                 const pocket_http_esp_url *b);
/* The host whose requests the companion answers (contracts/spec/link.ts
 * LINK_SERVICES_HOST). True when `url` parses and names it, under either
 * scheme and on any port, as the companion matches it. */
#define POCKET_HTTP_ESP_COMPANION_HOST "companion.pocket"
bool pocket_http_esp_companion_url(const char *url);
/* `location` against `base` as an absolute URL in `out`. Dot segments stay
 * for the server. False when the result does not fit. */
bool pocket_http_esp_resolve(const char *base, const char *location, char *out,
                             size_t capacity);

/* The headers record {"status":S,"url":U,"headers":{...}} in at most
 * `capacity` bytes. `fields` is name NUL value NUL with lower-case names.
 * Repeated fields join with ", " (set-cookie with a newline); hop-by-hop
 * fields are dropped; the priority names come first and a field that does
 * not fit is skipped. Returns the length, or 0 when status and url alone do
 * not fit. */
size_t pocket_http_esp_head(int status, const char *url, const char *fields,
                            size_t fields_length, char *out, size_t capacity);
