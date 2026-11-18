/*
 * `globalThis.installer`, bound into the launcher only (README, "Installs
 * from a code"): Pocket Shell reads an install URI from a QR code and calls
 * installer.installUri(uri); fetch.c downloads the package into the slot's
 * staging file; install_pump, on the system task once per frame, checks the
 * SHA-256 the URI declared and commits the package as a companion install
 * does: link_host_install admits it by the firmware's host facts
 * (pocket_idf_package_open) and its slot, and launcher_note_installed lists
 * it. Events wait for installer.poll() in one JSON array, shaped as the
 * link's install events.
 *
 * One install runs at a time. A guest switch keeps it running and drops
 * only its events.
 */

#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "esp_log.h"
#include "host_services.h"
#include "install_uri.h"
#include "jscan.h"
#include "launcher.h"
#include "link2_host.h"
#include "sha256.h"
#include "system_internal.h"

#define STAGING_NAME "url-upload.pocket"
#define INSTALL_MAX_BYTES (24U * 1024U * 1024U)
#define PROGRESS_MS 200U

static const char *TAG = "pocket_install";

static struct {
  bool running;
  /* Events reach the guest that asked; a guest switch clears this. */
  bool guest;
  int32_t id;
  char app[INSTALL_APP_BYTES];
  char slot[17];
  char path[160];
  uint8_t sha256[SHA256_BYTES];
  uint32_t received;
  uint32_t bytes;
  uint64_t progress_ms;
} install;

static int32_t next_id = 1;
static JsonBuffer events = {.limit = 16U * 1024U};
static JsonBuffer poll_out = {.limit = 17U * 1024U};

static void begin_event(size_t *mark) {
  *mark = events.length;
  if (events.length > 0)
    jbuf_text(&events, ",");
}

/* An event that did not fit is dropped whole, never torn. */
static void end_event(size_t mark) {
  if (events.failed) {
    events.failed = false;
    events.length = mark;
    if (events.data != NULL)
      events.data[mark] = '\0';
  }
}

static void progress_event(bool force) {
  const uint64_t now = services_host_ms();
  if (!install.guest || (!force && now - install.progress_ms < PROGRESS_MS))
    return;
  install.progress_ms = now;
  size_t mark;
  begin_event(&mark);
  jbuf_text(&events, "{\"t\":\"install.progress\",\"id\":");
  jbuf_u64(&events, (uint64_t)install.id);
  jbuf_text(&events, ",\"app\":");
  jbuf_cstring(&events, install.app);
  jbuf_text(&events, ",\"received\":");
  jbuf_u64(&events, install.received);
  jbuf_text(&events, ",\"bytes\":");
  jbuf_u64(&events, install.bytes);
  jbuf_text(&events, "}");
  end_event(mark);
}

static void finish(const char *error, const char *output) {
  if (error != NULL)
    ESP_LOGW(TAG, "%s: %s", install.app, error);
  if (install.guest) {
    size_t mark;
    begin_event(&mark);
    if (error != NULL) {
      jbuf_text(&events, "{\"t\":\"error\",\"id\":");
      jbuf_u64(&events, (uint64_t)install.id);
      jbuf_text(&events, ",\"message\":");
      jbuf_cstring(&events, error);
    } else {
      jbuf_text(&events, "{\"t\":\"install.done\",\"id\":");
      jbuf_u64(&events, (uint64_t)install.id);
      jbuf_text(&events, ",\"app\":");
      jbuf_cstring(&events, install.app);
      jbuf_text(&events, ",\"output\":");
      jbuf_cstring(&events, output);
    }
    jbuf_text(&events, "}");
    end_event(mark);
  }
  if (error != NULL)
    remove(install.path);
  install.running = false;
}

/* Admit and commit the staging file as the slot's package. */
static void commit(void) {
  char error[256] = {0};
  LauncherPackage package;
  void *held = NULL;
  if (!link_host_install(install.slot, install.path, 0, &package, &held, error,
                         sizeof error)) {
    finish(error[0] != '\0' ? error : "install: the package was refused", NULL);
    return;
  }
  launcher_note_installed(install.slot, &package);
  /* Hub learns of the app in the next runtime.apps report. */
  link2_host_apps_changed();
  char output[LAUNCHER_OUTPUT_BYTES] = {0};
  launcher_package_output(&package, output, sizeof output);
  services_host_release(held);
  ESP_LOGI(TAG, "%s installed as %s", install.app, output);
  finish(NULL, output);
}

int32_t install_uri(const char *uri, size_t length) {
  InstallUri parsed;
  if (install.running || !install_uri_parse(uri, length, &parsed))
    return -1;
  char directory[160];
  sha256_slot(parsed.app, strlen(parsed.app), install.slot);
  if (!launcher_host_slot_path(install.slot, NULL, directory,
                               sizeof directory) ||
      !launcher_host_slot_path(install.slot, STAGING_NAME, install.path,
                               sizeof install.path))
    return -1;
  mkdir(launcher_host_apps_directory(), 0777);
  mkdir(directory, 0777);
  if (!fetch_start(parsed.url, install.path, INSTALL_MAX_BYTES))
    return -1;
  snprintf(install.app, sizeof install.app, "%s", parsed.app);
  memcpy(install.sha256, parsed.sha256, sizeof install.sha256);
  install.id = next_id;
  next_id = next_id >= 0x7fffffff ? 1 : next_id + 1;
  install.running = true;
  install.guest = true;
  install.received = 0;
  install.bytes = 0;
  install.progress_ms = 0;
  ESP_LOGI(TAG, "%s from %.120s", install.app, parsed.url);
  return install.id;
}

void install_pump(void) {
  if (!install.running)
    return;
  uint8_t sha256[SHA256_BYTES];
  char error[160] = {0};
  const int32_t state = fetch_poll(&install.received, &install.bytes, sha256,
                                   error, sizeof error);
  if (state == FETCH_RUNNING) {
    progress_event(false);
    return;
  }
  fetch_end();
  if (state != FETCH_DONE) {
    finish(error[0] != '\0' ? error : "install: the download failed", NULL);
    return;
  }
  if (!constant_time_equal(sha256, install.sha256, sizeof sha256)) {
    finish("install: the package does not match its code", NULL);
    return;
  }
  install.bytes = install.received;
  progress_event(true);
  commit();
}

const char *install_poll(void) {
  if (events.length == 0)
    return NULL;
  jbuf_reset(&poll_out);
  jbuf_text(&poll_out, "[");
  jbuf_raw(&poll_out, events.data, events.length);
  jbuf_text(&poll_out, "]");
  jbuf_reset(&events);
  return jbuf_cstr(&poll_out);
}

void install_reset_guest(void) {
  install.guest = false;
  jbuf_reset(&events);
}
