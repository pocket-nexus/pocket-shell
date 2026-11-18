#pragma once

/*
 * The install URI an install QR code holds (README, "Installs from a code"):
 *
 *   pocketlink://install?v=1&a=<app id>&s=<sha256 hex64>[&n=<title>]&u=<url>
 *
 * `u` comes last and runs to the end of the URI, taken as written. No
 * ESP-IDF dependency: tests/install-uri.c compiles this on the build machine.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define INSTALL_URI_MAX 400u
#define INSTALL_URL_MAX 200u
#define INSTALL_APP_BYTES 128u
#define INSTALL_TITLE_BYTES 64u

typedef struct {
  char app[INSTALL_APP_BYTES];
  uint8_t sha256[32];
  /* Shown before the package is read; empty when absent or malformed. */
  char title[INSTALL_TITLE_BYTES];
  char url[INSTALL_URL_MAX + 1];
} InstallUri;

/* False when `uri` is not an install URI; trailing whitespace is ignored. */
bool install_uri_parse(const char *uri, size_t length, InstallUri *out);
