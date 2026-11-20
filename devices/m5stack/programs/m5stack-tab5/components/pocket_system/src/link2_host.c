/*
 * Pocket Link 2 on the Tab5: see link2_host.h.
 */

#include "link2_host.h"

#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "launcher.h"
#include "link2_guest.h"
#include "link_http.h"
#include "sha256.h"

static const char *const FEATURES[] = {
    "apps", "runtime", "runtime.remove", "catalog", "install", "net.http",
};
enum { FEATURE_COUNT = sizeof FEATURES / sizeof FEATURES[0] };

static Link2 *client;
static void (*report_link)(const char *hub, const char *why);
static uint32_t abi;
static char device_name[LINK2_NAME_BYTES];
static char device_model[32];

/* The launcher's own row of runtime.apps. */
static char home_id[LAUNCHER_ID_BYTES];
static char home_output[LAUNCHER_OUTPUT_BYTES];
static char home_version[40];
static char home_hash[17];
static char row_hashes[LINK2_APPS_MAX_ROWS][17];

/* The guest that runs, for runtime.status. */
static bool guest_running;
static bool guest_seen;
static uint64_t running_hash;
static char running_title[96];
/* The pumps so far: one a frame. */
static uint32_t frames;

static void hex16(uint64_t value, char out[17]) {
  snprintf(out, 17, "%016llx", (unsigned long long)value);
}

// ---------------------------------------------------------------------------
// the platform
// ---------------------------------------------------------------------------

static Link2Platform bsd;

static uint64_t platform_now(void *context) {
  (void)context;
  return services_host_ms();
}

static void platform_random(void *context, uint8_t *out, size_t length) {
  (void)context;
  services_host_random(out, length);
}

/* A socket carries nothing while the radio has no address: a handle reads
 * as gone, so the link drops when the address does instead of at the
 * keepalive's 10 s of silence, and a new socket is asked for only once the
 * radio is back. The descriptor itself stays lwIP's until it is closed, so
 * both close calls go to it whatever the radio's state. */
static int platform_tcp_connect(void *context, const char *address,
                                uint16_t port) {
  return link_host_net_ready() ? bsd.tcp_connect(context, address, port) : -1;
}

static int platform_tcp_connected(void *context, int handle) {
  return link_host_net_ready() ? bsd.tcp_connected(context, handle) : -1;
}

static long platform_tcp_send(void *context, int handle, const uint8_t *bytes,
                              size_t length) {
  return link_host_net_ready() ? bsd.tcp_send(context, handle, bytes, length)
                               : -1;
}

static long platform_tcp_recv(void *context, int handle, uint8_t *into,
                              size_t capacity) {
  return link_host_net_ready() ? bsd.tcp_recv(context, handle, into, capacity)
                               : -1;
}

static int platform_udp_open(void *context, uint16_t port) {
  return link_host_net_ready() ? bsd.udp_open(context, port) : -1;
}

static long platform_udp_recv(void *context, int handle, uint8_t *into,
                              size_t capacity, char address[16]) {
  return link_host_net_ready()
             ? bsd.udp_recv(context, handle, into, capacity, address)
             : -1;
}

// ---------------------------------------------------------------------------
// runtime.status, runtime.apps, runtime.launch
// ---------------------------------------------------------------------------

/* The Tab5 keeps one committed package a slot and no record of package
 * generations or of a last good package: `generation` is 0, `lastGood` is
 * zeros, and `active` is the package that runs. */
static void on_runtime_status(void *context, Link2Json *members) {
  (void)context;
  char address[16] = "";
  char hash[17];
  link_host_address(address, sizeof address);
  hex16(guest_running ? running_hash : 0, hash);
  link2_json_text(members, "\"phase\":");
  link2_json_cstring(members, guest_running ? "booted"
                              : guest_seen  ? "switching"
                                            : "starting");
  link2_json_text(members, ",\"target\":");
  link2_json_cstring(members, link_host_target());
  link2_json_text(members, ",\"hostAbi\":");
  link2_json_u64(members, abi);
  link2_json_text(members, ",\"slot\":");
  link2_json_cstring(members, guest_running ? launcher_current_slot() : "");
  link2_json_text(members, ",\"address\":");
  link2_json_cstring(members, address);
  link2_json_text(members, ",\"generation\":0,\"active\":");
  link2_json_cstring(members, hash);
  link2_json_text(members, ",\"lastGood\":\"0000000000000000\",\"running\":");
  link2_json_cstring(members, hash);
  link2_json_text(members, ",\"frame\":");
  link2_json_u64(members, frames);
  link2_json_text(members, ",\"app\":");
  if (guest_running && launcher_current_app_id()[0] != '\0') {
    link2_json_text(members, "{\"id\":");
    link2_json_cstring(members, launcher_current_app_id());
    link2_json_text(members, ",\"output\":");
    link2_json_cstring(members, launcher_current_output());
    link2_json_text(members, ",\"title\":");
    link2_json_cstring(members, running_title);
    link2_json_text(members, "}");
  } else {
    link2_json_text(members, "null");
  }
}

/* The launcher's row, then the table's rows in its order. The table is
 * rebuilt only after an install or a removal, so a report reads no storage
 * otherwise. */
static size_t on_runtime_apps(void *context, Link2InstalledApp *rows,
                              size_t capacity) {
  (void)context;
  size_t count = 0;
  if (capacity > 0 && home_id[0] != '\0') {
    rows[count++] = (Link2InstalledApp){
        .id = home_id,
        .output = home_output,
        .version = home_version,
        .hash = home_hash,
        .home = true,
    };
  }
  LauncherRow row;
  for (size_t index = 0; count < capacity && count < LINK2_APPS_MAX_ROWS &&
                         launcher_row(index, &row);
       index += 1) {
    hex16(row.hash, row_hashes[count]);
    rows[count] = (Link2InstalledApp){
        .id = row.id,
        .output = row.output,
        .version = row.version,
        .hash = row_hashes[count],
        .home = false,
    };
    count += 1;
  }
  return count;
}

/* The switch itself happens at the program's next frame boundary. */
static bool on_launch(void *context, const char *native, const char *app,
                      Link2Json *members, bool *launching,
                      Link2Failure *failure) {
  (void)context;
  (void)launching;
  if (native != NULL || app == NULL) {
    snprintf(failure->code, sizeof failure->code, "unsupported");
    snprintf(failure->message, sizeof failure->message,
             "this device starts installed applets only");
    return false;
  }
  if (!launcher_launch(app)) {
    snprintf(failure->code, sizeof failure->code, "not_found");
    snprintf(failure->message, sizeof failure->message,
             "no installed applet has this output");
    return false;
  }
  link2_json_text(members, "\"phase\":\"switching\",\"output\":");
  link2_json_cstring(members, app);
  return true;
}

/* The engine opens an install's staging file from its own install_begin and
 * tells the host only the slot. The host places the stage by the package's
 * size, so that call is made with the declared size on record. */
static bool (*guest_install_begin)(void *context, uint32_t request,
                                   const char *app, const char *hash,
                                   uint32_t bytes);
static uint32_t install_bytes;

static bool on_install_begin(void *context, uint32_t request, const char *app,
                             const char *hash, uint32_t bytes) {
  install_bytes = bytes;
  const bool begun = guest_install_begin(context, request, app, hash, bytes);
  install_bytes = 0;
  return begun;
}

uint32_t link2_host_install_bytes(void) { return install_bytes; }

// ---------------------------------------------------------------------------
// runtime.push (link2_host.h)
// ---------------------------------------------------------------------------

/* How long an admitted push may wait for its app's first frame before the
 * request ends with `timeout`: under Hub's 30 s without a frame (§5.5), so
 * the device's own message reaches Hub. A switch takes well under a second. */
#define PUSH_START_MS 20000u

typedef enum {
  PUSH_IDLE,
  /* The bytes go into the stage. */
  PUSH_STREAMING,
  /* Admitted for the running app's slot: committed when that guest ends. */
  PUSH_HELD,
  /* Committed; the switch to it is requested. */
  PUSH_SWITCHING,
  /* Its guest is bound: the reply leaves at the next pump, its first
   * frame. */
  PUSH_STARTED,
} PushState;

static struct {
  PushState state;
  uint64_t hash;
  uint64_t admitted_ms;
  char slot[17];
  LauncherPackage facts;
  char id[LAUNCHER_ID_BYTES];
  char output[LAUNCHER_OUTPUT_BYTES];
  char title[96];
} push;

static void fail_with(Link2Failure *failure, const char *code,
                      const char *message) {
  snprintf(failure->code, sizeof failure->code, "%s", code);
  snprintf(failure->message, sizeof failure->message, "%s", message);
}

/* The admitted push ends with `code` and `message`; `rejected` carries the
 * phase §6.2 gives it: the Tab5 keeps no last good package to go back to. */
static void push_failed(const char *code, const char *message) {
  Link2Failure failure;
  memset(&failure, 0, sizeof failure);
  fail_with(&failure, code, message);
  if (strcmp(code, "rejected") == 0)
    snprintf(failure.members, sizeof failure.members, "\"phase\":\"rejected\"");
  push.state = PUSH_IDLE;
  if (client != NULL)
    link2_push_result(client, false, NULL, 0, &failure);
}

/* The package is its slot's now: the launcher's table and Hub's report of
 * the installed set follow it. */
static void push_committed(void) {
  launcher_note_installed(push.slot, &push.facts);
  if (client != NULL)
    link2_apps_changed(client);
}

static bool on_push_begin(void *context, uint32_t bytes, const char *hash,
                          Link2Failure *failure) {
  (void)context;
  uint8_t raw[8];
  if (push.state != PUSH_IDLE) {
    fail_with(failure, "busy", "a pushed package is being installed");
    return false;
  }
  if (strlen(hash) != 16 || !hex_decode(hash, 16, raw, sizeof raw)) {
    fail_with(failure, "malformed", "the hash is not 16 hex digits");
    return false;
  }
  if (!store_push_begin(bytes, failure))
    return false;
  push.hash = 0;
  for (size_t i = 0; i < 8; i += 1)
    push.hash = (push.hash << 8) | raw[i];
  push.state = PUSH_STREAMING;
  return true;
}

static bool on_push_data(void *context, const uint8_t *bytes, size_t length) {
  (void)context;
  return push.state == PUSH_STREAMING && store_push_write(bytes, length);
}

/* The transfer stopped before its last byte: the link dropped, Hub
 * cancelled, or a write failed. */
static void on_push_abort(void *context) {
  (void)context;
  if (push.state != PUSH_STREAMING)
    return;
  store_push_abort();
  push.state = PUSH_IDLE;
}

/* The last byte is in. Admission reads the package where it lies; the
 * request then waits for link2_push_staged and link2_push_result, which
 * the guest switch below sends. */
static bool on_push_admit(void *context, Link2Failure *failure) {
  (void)context;
  if (push.state != PUSH_STREAMING) {
    fail_with(failure, "internal", "no pushed package is staged");
    return false;
  }
  if (!store_push_admit(push.hash, push.slot, &push.facts, failure)) {
    push.state = PUSH_IDLE;
    return false;
  }
  push.id[0] = '\0';
  push.title[0] = '\0';
  launcher_package_app_id(&push.facts, push.id, sizeof push.id);
  launcher_package_title(&push.facts, push.title, sizeof push.title);
  if (!launcher_package_output(&push.facts, push.output, sizeof push.output)) {
    store_push_abort();
    push.state = PUSH_IDLE;
    fail_with(failure, "rejected", "the package names no output");
    snprintf(failure->members, sizeof failure->members,
             "\"phase\":\"rejected\"");
    return false;
  }
  push.admitted_ms = services_host_ms();
  if (guest_running && strcmp(push.slot, launcher_current_slot()) == 0) {
    /* The switch is to the slot, which the launcher's table names by the
     * output of the package that runs; the new package may name another. */
    if (!launcher_launch(launcher_current_output())) {
      store_push_abort();
      push.state = PUSH_IDLE;
      fail_with(failure, "internal", "the running app is not in the table");
      return false;
    }
    push.state = PUSH_HELD;
    return true;
  }
  if (!store_push_commit(failure)) {
    push.state = PUSH_IDLE;
    return false;
  }
  push_committed();
  if (!launcher_launch(push.output)) {
    push.state = PUSH_IDLE;
    fail_with(failure, "internal",
              "the installed app is not in the launcher's table");
    return false;
  }
  push.state = PUSH_SWITCHING;
  return true;
}

/* At the first pump of the pushed app's guest: the accepted reply. */
static void push_pump(void) {
  if (push.state == PUSH_STARTED) {
    char members[512];
    Link2Json json;
    link2_json_init(&json, members, sizeof members);
    link2_json_text(&json,
                    "\"generation\":0,\"message\":\"\",\"app\":{\"id\":");
    link2_json_cstring(&json, push.id);
    link2_json_text(&json, ",\"output\":");
    link2_json_cstring(&json, push.output);
    link2_json_text(&json, ",\"title\":");
    link2_json_cstring(&json, push.title);
    link2_json_text(&json, "}");
    push.state = PUSH_IDLE;
    if (client != NULL)
      link2_push_result(client, !json.failed, members, json.length, NULL);
    return;
  }
  if ((push.state == PUSH_HELD || push.state == PUSH_SWITCHING) &&
      services_host_ms() - push.admitted_ms > PUSH_START_MS) {
    /* A held package was never committed: its pages go back. */
    if (push.state == PUSH_HELD)
      store_push_abort();
    push_failed("timeout", "the app did not start");
  }
}

static void on_linked(void *context, const char *hub, const char *why) {
  (void)context;
  /* The worker's open requests end; what it has not read yet stays. */
  if (hub == NULL)
    link_http_disconnected();
  if (report_link != NULL)
    report_link(hub, why);
}

// ---------------------------------------------------------------------------
// the client's life
// ---------------------------------------------------------------------------

void link2_host_init(const Link2HostConfig *config) {
  if (client != NULL)
    return;
  const LauncherPackage *home = config->home;
  abi = config->host_abi;
  report_link = config->report;
  if (home != NULL) {
    launcher_package_app_id(home, home_id, sizeof home_id);
    launcher_package_output(home, home_output, sizeof home_output);
    launcher_package_version(home, home_version, sizeof home_version);
    hex16(home->hash, home_hash);
  }
  link_host_identity(device_name, sizeof device_name, device_model,
                     sizeof device_model);

  memset(&bsd, 0, sizeof bsd);
  link2_bsd_sockets(&bsd);
  const Link2Platform platform = {
      .now_ms = platform_now,
      .random = platform_random,
      .tcp_connect = platform_tcp_connect,
      .tcp_connected = platform_tcp_connected,
      .tcp_send = platform_tcp_send,
      .tcp_recv = platform_tcp_recv,
      .tcp_close = bsd.tcp_close,
      .udp_open = platform_udp_open,
      .udp_recv = platform_udp_recv,
      .udp_close = bsd.udp_close,
  };

  Link2Host host;
  memset(&host, 0, sizeof host);
  host.name = device_name;
  host.model = device_model;
  host.target = link_host_target();
  host.host_abi = config->host_abi;
  host.directory = link_host_directory();
  host.beacon_port = config->beacon_port;
  host.features = FEATURES;
  host.feature_count = FEATURE_COUNT;
  host.linked = on_linked;
  host.runtime_status = on_runtime_status;
  host.runtime_apps = on_runtime_apps;
  host.launch = on_launch;
  host.push_begin = on_push_begin;
  host.push_data = on_push_data;
  host.push_admit = on_push_admit;
  host.push_abort = on_push_abort;
  /* Catalog, install and runtime.remove: the guest namespace's own paths. */
  link2_guest_host(&host);
  guest_install_begin = host.install_begin;
  host.install_begin = on_install_begin;
  link2_http_host(&host);

  /* The folders Hub's setup writes into, there before a card goes to a
   * reader. */
  char companions[160];
  mkdir(host.directory, 0777);
  snprintf(companions, sizeof companions, "%s/companions", host.directory);
  mkdir(companions, 0777);

  client = link2_create(&platform, &host);
  link2_guest_bind(client);
  link2_http_bind(client);
}

void link2_host_pump(void) {
  if (client == NULL)
    return;
  frames += 1;
  /* Without an address every attempt to connect fails at once and doubles
   * the backoff, so the search waits for the radio: measured on a Tab5, two
   * failed attempts before the address came put the link 5.3 s behind it. A
   * link that is up is pumped whatever the radio's state: its socket then
   * reads as gone, and it drops. */
  push_pump();
  if (link_host_net_ready() || link2_linked(client))
    link2_pump(client);
  link_http_pump();
  link2_guest_service();
}

void link2_host_guest_begin(const LauncherPackage *package) {
  guest_running = true;
  guest_seen = true;
  running_hash = package != NULL ? package->hash : 0;
  running_title[0] = '\0';
  if (package != NULL)
    launcher_package_title(package, running_title, sizeof running_title);
  if (client != NULL)
    link2_status_changed(client);
  if (push.state != PUSH_SWITCHING)
    return;
  /* The program sets the slot that boots before it binds the guest. Another
   * slot means the pushed app did not boot and the launcher took its place;
   * the package stays installed. */
  if (strcmp(launcher_current_slot(), push.slot) != 0) {
    push_failed("rejected", "the app did not start");
    return;
  }
  push.state = PUSH_STARTED;
  if (client != NULL)
    link2_push_staged(client, "");
}

void link2_host_guest_end(void) {
  link2_guest_reset();
  link_http_reset();
  if (push.state == PUSH_HELD) {
    /* The guest that read the old package from its pages is down: the
     * commit frees them, and the switch boots the new package. */
    Link2Failure failure;
    memset(&failure, 0, sizeof failure);
    if (store_push_commit(&failure)) {
      push_committed();
      push.state = PUSH_SWITCHING;
    } else {
      push.state = PUSH_IDLE;
      if (client != NULL)
        link2_push_result(client, false, NULL, 0, &failure);
    }
  } else if (push.state == PUSH_STARTED) {
    /* Torn down before its first frame: its boot failed. */
    push_failed("rejected", "the app did not start");
  }
  if (!guest_running)
    return;
  guest_running = false;
  if (client != NULL)
    link2_status_changed(client);
}

void link2_host_apps_changed(void) {
  if (client != NULL)
    link2_apps_changed(client);
}

Link2 *link2_host_client(void) { return client; }

void link2_host_shutdown(void) {
  link_http_reset();
  if (client != NULL) {
    link2_stop(client);
    /* One pump moves the CLOSE toward the socket before it is closed. */
    link2_pump(client);
  }
  link2_guest_shutdown();
  link2_http_bind(NULL);
  link2_guest_bind(NULL);
  if (client != NULL)
    link2_destroy(client);
  client = NULL;
  guest_running = false;
  /* A stage nobody will commit gives its pages back. */
  if (push.state == PUSH_STREAMING || push.state == PUSH_HELD)
    store_push_abort();
  push.state = PUSH_IDLE;
}
