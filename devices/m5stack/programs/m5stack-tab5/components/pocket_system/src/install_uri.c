#include "install_uri.h"

#include <string.h>

static int nibble(char c) {
  if (c >= '0' && c <= '9')
    return c - '0';
  if (c >= 'a' && c <= 'f')
    return c - 'a' + 10;
  return -1;
}

/* 64 lowercase hex digits. */
static bool read_hash(const char *text, size_t length, uint8_t out[32]) {
  if (length != 64)
    return false;
  for (size_t i = 0; i < 32; i += 1) {
    const int high = nibble(text[2 * i]), low = nibble(text[2 * i + 1]);
    if (high < 0 || low < 0)
      return false;
    out[i] = (uint8_t)(high << 4 | low);
  }
  return true;
}

static bool valid_app(const char *text, size_t length) {
  if (length == 0 || length >= INSTALL_APP_BYTES)
    return false;
  for (size_t i = 0; i < length; i += 1) {
    const char c = text[i];
    const bool word = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                      (c >= '0' && c <= '9');
    if (!word && (i == 0 || (c != '.' && c != '_' && c != '-')))
      return false;
  }
  return true;
}

static bool valid_url(const char *text, size_t length) {
  size_t scheme = 0;
  if (length >= 8 && memcmp(text, "https://", 8) == 0)
    scheme = 8;
  else if (length >= 7 && memcmp(text, "http://", 7) == 0)
    scheme = 7;
  if (scheme == 0 || length == scheme || length > INSTALL_URL_MAX)
    return false;
  for (size_t i = 0; i < length; i += 1) {
    const unsigned char c = (unsigned char)text[i];
    if (c <= ' ' || c == '#' || c >= 0x7f)
      return false;
  }
  return true;
}

/* Percent-decode (and '+' as space); false when malformed or too long. */
static bool decode(const char *text, size_t length, char *out,
                   size_t capacity) {
  size_t used = 0;
  for (size_t i = 0; i < length; i += 1) {
    char c = text[i];
    if (c == '%') {
      if (i + 2 >= length)
        return false;
      const char high = text[i + 1], low = text[i + 2];
      const int h = high >= 'A' && high <= 'F' ? high - 'A' + 10 : nibble(high);
      const int l = low >= 'A' && low <= 'F' ? low - 'A' + 10 : nibble(low);
      if (h < 0 || l < 0)
        return false;
      c = (char)(h << 4 | l);
      i += 2;
    } else if (c == '+') {
      c = ' ';
    }
    if (c == '\0' || used + 1 >= capacity)
      return false;
    out[used++] = c;
  }
  out[used] = '\0';
  return true;
}

bool install_uri_parse(const char *uri, size_t length, InstallUri *out) {
  static const char SCHEME[] = "pocketlink://install?";
  if (uri == NULL || out == NULL)
    return false;
  memset(out, 0, sizeof *out);
  while (length > 0 && (uri[length - 1] == '\n' || uri[length - 1] == '\r' ||
                        uri[length - 1] == ' '))
    length -= 1;
  if (length > INSTALL_URI_MAX || length < sizeof SCHEME - 1 ||
      memcmp(uri, SCHEME, sizeof SCHEME - 1) != 0)
    return false;
  /* The first "&u=" ends the parameters; the address runs to the end. */
  const size_t start = sizeof SCHEME - 1;
  size_t end = start;
  while (end + 3 <= length && memcmp(uri + end, "&u=", 3) != 0)
    end += 1;
  if (end + 3 > length)
    return false;
  const char *url = uri + end + 3;
  const size_t url_length = length - end - 3;
  if (!valid_url(url, url_length))
    return false;
  memcpy(out->url, url, url_length);
  bool version = false, hash = false;
  for (size_t at = start; at < end;) {
    size_t stop = at;
    while (stop < end && uri[stop] != '&')
      stop += 1;
    const char *pair = uri + at;
    const size_t pair_length = stop - at;
    if (pair_length >= 2 && pair[1] == '=') {
      const char *value = pair + 2;
      const size_t value_length = pair_length - 2;
      switch (pair[0]) {
      case 'v':
        if (value_length != 1 || value[0] != '1')
          return false;
        version = true;
        break;
      case 'a':
        if (!valid_app(value, value_length))
          return false;
        memcpy(out->app, value, value_length);
        out->app[value_length] = '\0';
        break;
      case 's':
        if (!read_hash(value, value_length, out->sha256))
          return false;
        hash = true;
        break;
      case 'n':
        if (!decode(value, value_length, out->title, sizeof out->title))
          out->title[0] = '\0';
        break;
      default:
        break; /* unknown parameters are ignored */
      }
    }
    at = stop + 1;
  }
  return version && hash && out->app[0] != '\0';
}
