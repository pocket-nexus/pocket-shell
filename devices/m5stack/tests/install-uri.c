/* programs/m5stack-tab5/components/pocket_system/src/install_uri.c under
 * AddressSanitizer and UndefinedBehaviorSanitizer (tools/test-worker-io.sh):
 * the install URI an install QR code holds, and the ones it refuses. */

#include <stdio.h>
#include <string.h>

#include "install_uri.h"

#define HASH "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
#define URL "https://tab5.example.dev/p/0123456789abcdef/game.pocket?x=1&y=%41"
#define GOOD                                                                   \
  "pocketlink://install?v=1&a=dev.pocket-nexus.studio.snake&s=" HASH           \
  "&n=Snake%20%26%20Co&u=" URL

static int failures;

static void expect(int ok, const char *what) {
  if (!ok) {
    fprintf(stderr, "install-uri: %s\n", what);
    failures += 1;
  }
}

static int parses(const char *uri) {
  InstallUri out;
  return install_uri_parse(uri, strlen(uri), &out);
}

int main(void) {
  InstallUri out;
  expect(install_uri_parse(GOOD, strlen(GOOD), &out), "a good URI parses");
  expect(strcmp(out.app, "dev.pocket-nexus.studio.snake") == 0, "app id");
  expect(strcmp(out.title, "Snake & Co") == 0, "title is percent-decoded");
  expect(strcmp(out.url, URL) == 0, "u is verbatim to the end");
  expect(out.sha256[0] == 0x01 && out.sha256[31] == 0xef, "hash bytes");
  expect(parses(GOOD "\n"), "a trailing newline is ignored");
  expect(parses("pocketlink://install?v=1&a=x&s=" HASH "&u=http://a.dev/p"),
         "no title, http");
  expect(!parses("pocketlink://install?v=2&a=x&s=" HASH "&u=http://a.dev/p"),
         "version 2");
  expect(!parses("pocketlink://install?v=1&a=x&s=0123&u=http://a.dev/p"),
         "short hash");
  expect(!parses("pocketlink://install?v=1&a=x&s=" HASH "&u=ftp://a.dev/p"),
         "ftp");
  expect(!parses("pocketlink://install?v=1&a=x&s=" HASH "&u=http://a.dev/#f"),
         "fragment");
  expect(!parses("pocketlink://install?v=1&a=.x&s=" HASH "&u=http://a.dev/p"),
         "app id starting with a dot");
  expect(!parses("pocketlink://install?v=1&a=x&s=" HASH), "no address");
  expect(!parses("pocketlink://pair?v=1&a=x&s=" HASH "&u=http://a.dev/p"),
         "pairing scheme");
  char upper[] = "pocketlink://install?v=1&a=x&s=" HASH "&u=http://a.dev/p";
  for (char *c = strstr(upper, "s=") + 2; *c != '&'; c += 1)
    if (*c >= 'a' && *c <= 'f')
      *c = (char)(*c - 'a' + 'A');
  expect(!parses(upper), "uppercase hash");
  expect(parses("pocketlink://install?v=1&a=x&s=" HASH
                "&n=%E&u=http://a.dev/p") == 1,
         "a malformed title is dropped, not fatal");
  char long_url[600];
  snprintf(long_url, sizeof long_url,
           "pocketlink://install?v=1&a=x&s=" HASH "&u=https://a.dev/%0*d", 200,
           0);
  expect(!parses(long_url), "an address over 200 bytes");
  if (failures == 0)
    puts("install-uri: ok");
  return failures == 0 ? 0 : 1;
}
