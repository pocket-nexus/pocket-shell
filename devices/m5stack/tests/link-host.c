/* programs/m5stack-tab5/components/pocket_system/src/link2_host.c and
 * companion.c with the Pocket Link 2 client they drive (engine/host-services
 * link2.c, link2_guest.c, link2_http.c, link2_bsd.c), on a POSIX
 * host_services.h, against the reference Hub of tests/link-host.test.ts:
 *
 *   link-host setup <store> <beacon-port> <slow-url>
 *   link-host pair <store> <beacon-port> <hub id>
 *
 * `setup` links from the pairing files Hub's setup writes; `pair` pairs by a
 * code the device shows (pocketjs docs/POCKET-LINK.md §3.11). Each step
 * prints one line. A `wait <name>` line asks the test to act; the harness
 * pumps the link until it reads one line from stdin:
 *
 *   start <url> error <message>          the transport refused the request
 *   status linked | not linked           the link's state after a wait
 *   fetch <url> <status> <end> <body>    headers status, end status, body
 *   switch <output>                      a launch the launcher took
 *   end <url> <status> <message>         a request the link ended
 *   ask <when> taken | refused           link.pairAsk's answer
 *   hub listed | not listed              the Hub among those to choose from
 *   code <digits>                        the code the device shows
 *   pair <state>                         the pairing's state */

#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include "companion.h"
#include "host_services.h"
#include "jscan.h"
#include "launcher.h"
#include "link2_guest.h"
#include "link2_host.h"
#include "link2_proto.h"
#include "sha256.h"

#define HN_ID "dev.pocket-nexus.hn"
#define HN_HASH 0x1122334455667788ull
#define SHELL_ID "dev.pocket-nexus.shell"
#define SHELL_HASH 0x8877665544332211ull

static char apps[512];
static char link_directory[512];
static char home_slot[17];
static char hn_slot[17];
static bool hn_installed;

uint64_t services_host_us(void) {
  struct timespec now;
  clock_gettime(CLOCK_MONOTONIC, &now);
  return (uint64_t)now.tv_sec * 1000000u + (uint64_t)now.tv_nsec / 1000u;
}

uint64_t services_host_ms(void) { return services_host_us() / 1000u; }

uint64_t services_host_epoch_ms(void) {
  struct timeval now;
  gettimeofday(&now, NULL);
  return (uint64_t)now.tv_sec * 1000u + (uint64_t)now.tv_usec / 1000u;
}

void services_host_random(uint8_t *out, size_t length) {
  for (size_t i = 0; i < length; i += 1)
    out[i] = (uint8_t)rand();
}

const char *launcher_host_apps_directory(void) { return apps; }

bool launcher_host_slot_path(const char *slot, const char *name, char *out,
                             size_t capacity) {
  int written = name == NULL
                    ? snprintf(out, capacity, "%s/%s", apps, slot)
                    : snprintf(out, capacity, "%s/%s/%s", apps, slot, name);
  return written > 0 && (size_t)written < capacity;
}

/* One installed app: its slot holds the launcher's cached facts and no
 * package file. */
bool launcher_host_active_hash(const char *slot, uint64_t *hash) {
  if (!hn_installed || strcmp(slot, hn_slot) != 0)
    return false;
  *hash = HN_HASH;
  return true;
}

bool launcher_host_load(const char *slot, uint64_t hash, LauncherPackage *out,
                        void **held) {
  (void)slot;
  (void)hash;
  (void)out;
  (void)held;
  return false;
}

void services_host_release(void *held) { (void)held; }

const char *link_host_target(void) { return "tab5-home"; }

void link_host_identity(char *name, size_t name_capacity, char *model,
                        size_t model_capacity) {
  snprintf(name, name_capacity, "Harness");
  snprintf(model, model_capacity, "M5Stack Tab5");
}

const char *link_host_directory(void) { return link_directory; }

bool link_host_net_ready(void) { return true; }

void link_host_address(char *out, size_t capacity) {
  snprintf(out, capacity, "127.0.0.1");
}

bool link_host_staging_path(const char *slot, char *out, size_t capacity) {
  (void)slot;
  (void)out;
  (void)capacity;
  return false;
}

bool link_host_slot_ready(const char *slot) {
  (void)slot;
  return true;
}

bool link_host_install(const char *slot, const char *path, uint64_t hash,
                       LauncherPackage *out, void **held, char *error,
                       size_t error_capacity) {
  (void)slot;
  (void)path;
  (void)hash;
  (void)out;
  (void)held;
  snprintf(error, error_capacity, "no installs here");
  return false;
}

bool link_host_remove(const char *slot) {
  char path[600];
  if (!hn_installed || strcmp(slot, hn_slot) != 0)
    return false;
  if (launcher_host_slot_path(slot, "app.txt", path, sizeof path))
    remove(path);
  if (launcher_host_slot_path(slot, NULL, path, sizeof path))
    rmdir(path);
  hn_installed = false;
  return true;
}

void link_host_linked(bool up) { (void)up; }

bool link_host_ctrl(const char *json, size_t length) {
  (void)json;
  (void)length;
  return false;
}

bool link_host_data(uint32_t stream, const uint8_t *bytes, size_t length) {
  (void)stream;
  (void)bytes;
  (void)length;
  return false;
}

/* One frame of the firmware's loop: the pump, then a launch the launcher
 * took at Hub's request. */
static void frame(void) {
  link2_host_pump();
  LauncherTarget target;
  if (launcher_pending() && launcher_take_request(&target))
    printf("switch %s\n", target.output);
}

/* Ask the test to act, and pump until it answers with a line. */
static void await_test(const char *name) {
  char line[64];
  printf("wait %s\n", name);
  fflush(stdout);
  for (;;) {
    frame();
    struct pollfd input = {.fd = STDIN_FILENO, .events = POLLIN};
    if (poll(&input, 1, 2) > 0)
      break;
  }
  if (fgets(line, sizeof line, stdin) == NULL)
    exit(20);
}

/* Pump until the link's state is (or, with `is` false, is not) `state`. */
static bool await_state(const char *state, bool is) {
  for (int i = 0; i < 5000; i += 1) {
    frame();
    const char *status = link2_guest_status_json();
    char now[16] = "";
    json_find_string(json_span(status, strlen(status)), "state", now,
                     sizeof now);
    if ((strcmp(now, state) == 0) == is)
      return true;
    usleep(2000);
  }
  return false;
}

static uint32_t start(const char *url) {
  char descriptor[512], error[160] = "";
  snprintf(descriptor, sizeof descriptor, "{\"url\":\"%s\",\"timeoutMs\":5000}",
           url);
  const uint32_t id = companion_start((const uint8_t *)descriptor,
                                      strlen(descriptor), error, sizeof error);
  if (!id)
    printf("start %s error %s\n", url, error);
  return id;
}

/* Pump until the request ends; print its facts in one line. */
static void fetch(const char *url) {
  const uint32_t id = start(url);
  if (!id)
    return;
  static pocket_http_esp_fact fact;
  char head[1100] = "", body[2048] = "";
  size_t body_length = 0;
  for (int i = 0; i < 5000; i += 1) {
    frame();
    while (companion_take(id, &fact)) {
      if (fact.kind == POCKET_WORKER_HEADERS) {
        memcpy(head, fact.bytes, fact.length);
        head[fact.length] = 0;
      } else if (fact.kind == POCKET_WORKER_DATA) {
        const size_t take = fact.length < sizeof body - 1 - body_length
                                ? fact.length
                                : sizeof body - 1 - body_length;
        memcpy(body + body_length, fact.bytes, take);
        body_length += take;
      } else {
        uint64_t status = 0;
        json_find_u64(json_span(head, strlen(head)), "status", &status);
        body[body_length] = 0;
        printf("fetch %s %u %d %s\n", url, (unsigned)status, (int)fact.status,
               body);
        return;
      }
    }
    usleep(1000);
  }
  printf("fetch %s no end\n", url);
}

/* The status's `pair` member. */
static JsonSpan pair_status(void) {
  const char *status = link2_guest_status_json();
  JsonSpan pair = {0};
  json_find(json_span(status, strlen(status)), "pair", &pair);
  return pair;
}

static void pair_text(const char *key, char *out, size_t capacity) {
  out[0] = '\0';
  json_find_string(pair_status(), key, out, capacity);
}

/* Whether the Hubs to choose from include `hub`. */
static bool pair_lists(const char *hub) {
  JsonSpan hubs, element;
  size_t at = 0;
  bool malformed = false;
  if (!json_find(pair_status(), "hubs", &hubs) || !json_is_array(hubs))
    return false;
  while (link2_array_next(hubs, &at, &element, &malformed)) {
    char id[32] = "";
    if (json_find_string(element, "id", id, sizeof id) && strcmp(id, hub) == 0)
      return true;
  }
  return false;
}

/* A store no Hub has set up and a Hub on the network: the owner opens a
 * pairing, chooses that Hub and reads the code out to its owner. */
static int pair_by_code(const Link2HostConfig *config,
                        const LauncherPackage *launcher, const char *hub) {
  char text[64];
  link2_host_init(config);
  launcher_set_current(home_slot, launcher);
  link2_host_guest_begin(launcher);
  printf("ask closed %s\n", link2_guest_pair_ask(hub) ? "taken" : "refused");
  if (!link2_guest_pair_open())
    return 5;
  bool listed = false;
  for (int i = 0; i < 5000 && !listed; i += 1) {
    frame();
    listed = pair_lists(hub);
    usleep(2000);
  }
  printf("hub %s\n", listed ? "listed" : "not listed");
  pair_text("code", text, sizeof text);
  printf("code %s\n", text);
  printf("ask open %s\n", link2_guest_pair_ask(hub) ? "taken" : "refused");

  /* Hub's owner enters the code; the client writes the key file and links. */
  await_test("code");
  printf("status %s\n", await_state("linked", true) ? "linked" : "not linked");
  pair_text("state", text, sizeof text);
  printf("pair %s\n", text);
  fetch("https://companion.pocket/x/status");
  link2_host_shutdown();

  /* The next start links from the key file, with no pairing open. */
  link2_host_init(config);
  link2_host_guest_begin(launcher);
  printf("status %s\n", await_state("linked", true) ? "linked" : "not linked");
  pair_text("state", text, sizeof text);
  printf("pair %s\n", text);
  link2_host_shutdown();
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 5)
    return 2;
  const bool pairing = strcmp(argv[1], "pair") == 0;
  if (!pairing && strcmp(argv[1], "setup") != 0)
    return 2;
  argv += 1;
  setvbuf(stdout, NULL, _IOLBF, 0);
  mkdir(argv[1], 0777);
  snprintf(apps, sizeof apps, "%s/apps", argv[1]);
  snprintf(link_directory, sizeof link_directory, "%s/link", argv[1]);
  mkdir(apps, 0777);
  static const char launcher_plan[] =
      "{\"app\":{\"output\":\"pocket-shell\",\"id\":\"" SHELL_ID "\","
      "\"title\":\"Pocket Shell\",\"version\":\"0.1.1\"}}";
  static const char hn_plan[] =
      "{\"app\":{\"output\":\"hn\",\"id\":\"" HN_ID "\","
      "\"title\":\"Hacker News\",\"version\":\"1.2.0\"}}";
  const LauncherPackage launcher = {.plan = launcher_plan,
                                    .plan_length = sizeof launcher_plan - 1,
                                    .hash = SHELL_HASH};
  const LauncherPackage hn = {
      .plan = hn_plan, .plan_length = sizeof hn_plan - 1, .hash = HN_HASH};
  sha256_slot(SHELL_ID, strlen(SHELL_ID), home_slot);
  sha256_slot(HN_ID, strlen(HN_ID), hn_slot);
  launcher_init(home_slot, &launcher);
  /* Hacker News is installed: its slot holds the launcher's cached facts. */
  char directory[600];
  launcher_host_slot_path(hn_slot, NULL, directory, sizeof directory);
  mkdir(directory, 0777);
  hn_installed = true;
  launcher_note_installed(hn_slot, &hn);

  const Link2HostConfig config = {
      .home = &launcher,
      .host_abi = 7,
      .beacon_port = (uint16_t)atoi(argv[2]),
  };
  if (pairing)
    return pair_by_code(&config, &launcher, argv[3]);

  /* A store Hub has not set up: no pairing file, and none can be made on
   * the link. The first start writes device.txt. */
  link2_host_init(&config);
  launcher_set_current(hn_slot, &hn);
  link2_host_guest_begin(&hn);
  for (int i = 0; i < 20; i += 1)
    frame();
  start("https://companion.pocket/x/status");
  link2_host_shutdown();

  /* Hub's setup writes the pairing into the store; the firmware reads it
   * when it starts. */
  await_test("setup");
  link2_host_init(&config);
  link2_host_guest_begin(&hn);
  printf("status %s\n", await_state("linked", true) ? "linked" : "not linked");

  /* Hub performs each request, for the app that runs. */
  fetch("https://companion.pocket/nothing/here");
  fetch("https://companion.pocket/x/status");
  link2_host_guest_end();
  launcher_set_current(home_slot, &launcher);
  link2_host_guest_begin(&launcher);
  fetch("https://companion.pocket/x/status");

  /* Hub reads the status and the installed set, launches and removes. */
  await_test("runtime");

  /* A request the link closes under it, then no link at all. */
  const uint32_t slow = start(argv[3]);
  if (!slow)
    return 4;
  for (int i = 0; i < 50; i += 1) {
    frame();
    usleep(2000);
  }
  await_test("stop");
  static pocket_http_esp_fact fact;
  bool ended = false;
  for (int i = 0; i < 5000 && !ended; i += 1) {
    frame();
    while (!ended && companion_take(slow, &fact))
      if (fact.kind == POCKET_WORKER_END) {
        printf("end %s %d %.*s\n", argv[3], (int)fact.status, (int)fact.length,
               (const char *)fact.bytes);
        ended = true;
      }
    usleep(1000);
  }
  if (!ended)
    printf("end %s none\n", argv[3]);
  printf("status %s\n",
         await_state("linked", false) ? "not linked" : "still linked");
  start("https://companion.pocket/x/status");
  link2_host_shutdown();
  return 0;
}
