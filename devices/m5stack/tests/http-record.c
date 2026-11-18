#include "record.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static bool parse(const char *json, pocket_http_esp_request *out) {
  return pocket_http_esp_parse((const uint8_t *)json, strlen(json), out);
}

static void resolves(const char *base, const char *location,
                     const char *expected) {
  char out[POCKET_HTTP_ESP_URL];
  assert(pocket_http_esp_resolve(base, location, out, sizeof out));
  if (strcmp(out, expected)) {
    fprintf(stderr, "%s + %s -> %s, expected %s\n", base, location, out,
            expected);
    assert(0);
  }
}

int main(void) {
  static pocket_http_esp_request r;
  /* The SDK's JSON.stringify(options), with defaults. */
  assert(parse("{\"url\":\"https://example.com/\"}", &r));
  assert(!strcmp(r.url, "https://example.com/") && r.method == 0);
  assert(r.timeout_ms == 30000 && r.max_bytes == 262144);
  assert(
      parse("{\"url\":\"http://a.b/x?y=1\",\"method\":\"POST\","
            "\"headers\":{\"Content-Type\":\"text/plain\",\"X-A\":\"1\","
            "\"x-a\":\"2\"},\"body\":\"h\\u00e9\\ud83d\\ude00\\u0000z\","
            "\"timeoutMs\":5000,\"maxBytes\":0,\"extra\":[1.5,{\"k\":null}]}",
            &r));
  assert(r.method == POCKET_HTTP_ESP_POST && r.timeout_ms == 5000 &&
         r.max_bytes == 0);
  /* The last of a repeated name holds; names are lower case. */
  assert(r.headers_length == strlen("content-type") + strlen("text/plain") +
                                 strlen("x-a") + strlen("2") + 4);
  assert(!strcmp(r.headers, "content-type") &&
         !strcmp(r.headers + strlen("content-type") + 1, "text/plain"));
  assert(r.body_length == 9 &&
         !memcmp(r.body, "h\xc3\xa9\xf0\x9f\x98\x80\0z", 9));
  const char *refused[] = {
      "{}",
      "{\"url\":\"ftp://a.b/\"}",
      "{\"url\":\"HTTPS://a.b/\"}",
      "{\"url\":\"https://a.b/ x\"}",
      "{\"url\":\"https://a.b/\",\"method\":\"TRACE\"}",
      "{\"url\":\"https://a.b/\",\"method\":\"get\"}",
      "{\"url\":\"https://a.b/\",\"headers\":{\"a b\":\"1\"}}",
      "{\"url\":\"https://a.b/\",\"headers\":{\"a\":\"1\\r\\nb: 2\"}}",
      "{\"url\":\"https://a.b/\",\"headers\":{\"a\":\"\\u0000\"}}",
      "{\"url\":\"https://a.b/\",\"headers\":{\"a\":1}}",
      "{\"url\":\"https://a.b/\",\"body\":\"x\"}",
      "{\"url\":\"https://a.b/\",\"method\":\"HEAD\",\"body\":\"x\"}",
      "{\"url\":\"https://a.b/\",\"timeoutMs\":0}",
      "{\"url\":\"https://a.b/\",\"timeoutMs\":120001}",
      "{\"url\":\"https://a.b/\",\"timeoutMs\":1.5}",
      "{\"url\":\"https://a.b/\",\"maxBytes\":262145}",
      "{\"url\":\"https://a.b/\",\"maxBytes\":-1}",
      "{\"url\":\"https://a.b/\",\"body\":\"\\ud800\"}",
      "{\"url\":\"https://a.b/\"} x",
      "{\"url\":\"https://a.b/\",}",
  };
  for (size_t i = 0; i < sizeof refused / sizeof *refused; ++i) {
    if (parse(refused[i], &r)) {
      fprintf(stderr, "admitted %s\n", refused[i]);
      assert(0);
    }
  }
  const char *good = "{\"url\":\"https://a.b/\",\"method\":\"PUT\","
                     "\"body\":\"payload\"}";
  for (size_t n = 0; n < strlen(good); ++n)
    assert(!pocket_http_esp_parse((const uint8_t *)good, n, &r));
  char large[1100] =
      "{\"url\":\"https://a.b/\",\"method\":\"POST\",\"body\":\"";
  memset(large + strlen(large), 'x', 1000);
  strcpy(large + strlen(large), "\"}");
  assert(!parse(large, &r));
  assert(pocket_http_esp_request_dropped("transfer-encoding") &&
         pocket_http_esp_request_dropped("host") &&
         !pocket_http_esp_request_dropped("authorization"));

  pocket_http_esp_url u, v;
  assert(
      pocket_http_esp_url_parse("https://User:pw@Example.COM:8443/p?q#f", &u));
  assert(u.https && u.port == 8443 && !strcmp(u.host, "example.com"));
  assert(pocket_http_esp_url_parse("http://[::1]:8080", &v) &&
         !strcmp(v.host, "::1") && v.port == 8080);
  assert(pocket_http_esp_url_parse("HTTP://example.com", &v) && v.port == 80);
  assert(!pocket_http_esp_same_origin(&u, &v));
  assert(pocket_http_esp_url_parse("https://example.com:8443/other", &v) &&
         pocket_http_esp_same_origin(&u, &v));
  assert(!pocket_http_esp_url_parse("https://:80/", &v));
  assert(!pocket_http_esp_url_parse("https://a.b:70000/", &v));
  assert(!pocket_http_esp_url_parse("https://[::1/", &v));
  assert(!pocket_http_esp_url_parse("mailto:a@b", &v));

  /* companion.pocket goes to the companion under either scheme, on any port,
   * as the companion matches the host; nothing else does. */
  assert(pocket_http_esp_companion_url("https://companion.pocket/glyphs/a"));
  assert(pocket_http_esp_companion_url("http://companion.pocket"));
  assert(pocket_http_esp_companion_url("HTTPS://Companion.Pocket:8443/x?y"));
  assert(pocket_http_esp_companion_url("https://u@companion.pocket/x"));
  assert(!pocket_http_esp_companion_url("https://companion.pocket.example/x"));
  assert(
      !pocket_http_esp_companion_url("https://example.com/companion.pocket"));
  assert(
      !pocket_http_esp_companion_url("https://companion.pocket@example.com/"));
  assert(!pocket_http_esp_companion_url("https://xcompanion.pocket/"));
  assert(!pocket_http_esp_companion_url("ftp://companion.pocket/"));
  assert(!pocket_http_esp_companion_url(NULL));

  resolves("https://a.b/x/y?q#f", "https://c.d/e", "https://c.d/e");
  resolves("https://a.b/x/y", "//c.d/e", "https://c.d/e");
  resolves("http://a.b/x/y?q", "/z", "http://a.b/z");
  resolves("http://a.b/x/y?q", "z?w", "http://a.b/x/z?w");
  resolves("http://a.b", "z", "http://a.b/z");
  resolves("http://a.b/x/y?q#f", "?n", "http://a.b/x/y?n");
  resolves("http://a.b/x/y?q#f", "#g", "http://a.b/x/y?q#g");
  char small[16];
  assert(!pocket_http_esp_resolve("http://a.b/", "/a-much-longer-path", small,
                                  sizeof small));

  static const char fields[] = "server\0nginx\0"
                               "set-cookie\0a=1\0"
                               "connection\0close\0"
                               "content-type\0text/html; charset=\"utf-8\"\0"
                               "set-cookie\0b=2\0"
                               "date\0Tue\0";
  char head[POCKET_HTTP_ESP_RECORD];
  size_t n = pocket_http_esp_head(200, "https://a.b/", fields,
                                  sizeof fields - 1, head, sizeof head);
  const char expected[] =
      "{\"status\":200,\"url\":\"https://a.b/\",\"headers\":{"
      "\"content-type\":\"text/html; charset=\\\"utf-8\\\"\",\"date\":\"Tue\","
      "\"server\":\"nginx\",\"set-cookie\":\"a=1\\nb=2\"}}";
  if (n != strlen(expected) || memcmp(head, expected, n)) {
    fprintf(stderr, "%.*s\n", (int)n, head);
    assert(0);
  }
  /* A field that does not fit is skipped; the record stays valid. */
  n = pocket_http_esp_head(200, "https://a.b/", fields, sizeof fields - 1, head,
                           80);
  const char fitted[] = "{\"status\":200,\"url\":\"https://a.b/\",\"headers\":{"
                        "\"date\":\"Tue\",\"server\":\"nginx\"}}";
  assert(n == strlen(fitted) && !memcmp(head, fitted, n));
  assert(!pocket_http_esp_head(200, "https://a.b/a-long-path", fields,
                               sizeof fields - 1, head, 32));
  puts("HTTP descriptor, URL and headers record: passed");
}
