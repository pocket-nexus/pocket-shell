#pragma once

/*
 * The system services of the Tab5 as a launcher console: installed apps and
 * switching between them, the Pocket Link 2 client to a paired Hub, a
 * guest's data.fs tree, the Wi-Fi radio and the SNTP clock. The state machines
 * are engine/host-services; this component keeps the store, the radio, the
 * clock and the QuickJS bindings.
 *
 * The store lives under one mounted directory (`root`) and on one data
 * partition (`packages_partition`):
 *
 *   <root>/link/                        device id, and the key file of
 *                                       each paired Hub, which Hub writes
 *   <root>/apps/<slot>/app.txt          the launcher's cached facts
 *   <root>/apps/<slot>/data/            the guest's data.fs tree
 *   <root>/apps/<slot>/package.pocket   an installed package, when the
 *                                       firmware had no partition for it
 *   the partition                       the installed packages, read in
 *                                       place through one mapping
 *
 * where <slot> is the first 16 hex digits of SHA-256 of the app id. The
 * launcher and the bundled packages are embedded in the firmware and read
 * from flash in place; each gets a slot for its cached facts and its data
 * like any app. A bundled package is an installed app the companion can
 * neither replace nor remove.
 *
 * Threads: everything except pocketjs_system_start, pocketjs_system_online
 * and pocketjs_system_clock_wait runs on the task that runs the runtime.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "pocket/package_facts.h"
#include "quickjs.h"

#ifdef __cplusplus
extern "C" {
#endif

/** A package the firmware embeds as an installed app. */
typedef struct {
  const void *bytes;
  size_t size;
} pocketjs_system_bundled_t;

typedef struct {
  size_t struct_size;
  /** The host id the Pocket Link reports to a Hub. */
  const char *target;
  /** The host facts packages are admitted against (pocket_profile.facts):
   * a package boots its first variant the facts satisfy. */
  const pocket_profile_facts *facts;
  uint32_t host_abi;
  /** 32 bytes or NULL: orders the variants admission tries. */
  const uint8_t *profile_hash;
  /** The launcher package the firmware embeds. */
  const void *launcher;
  size_t launcher_size;
  /** Packages served from flash as installed apps: start admits each once
   * and refreshes its slot's cached facts. */
  const pocketjs_system_bundled_t *bundled;
  size_t bundled_count;
  /** A mounted directory holding the store. */
  const char *root;
  /** The data partition installed packages are written to and read from in
   * place, or NULL to keep them as files under `root`. */
  const char *packages_partition;
  /** The console's name and model in the link handshake. */
  const char *device_name;
  const char *device_model;
  /** Bring the Wi-Fi radio and the SNTP clock up (esp_wifi through
   * esp_wifi_remote on chips without a radio of their own). */
  bool wifi;
  /** Runs on the radio's task before esp_wifi_init, or NULL: power and
   * connect a radio coprocessor. */
  esp_err_t (*wifi_prepare)(void);
} pocketjs_system_config_t;

/** Open the store and the launcher package, install the bundled packages,
 * start the link and the radio. */
esp_err_t pocketjs_system_start(const pocketjs_system_config_t *config);

/** Mount the FAT partition `label` (wear levelled) at `root`. */
esp_err_t pocketjs_system_mount_flash(const char *label, const char *root);

/** One package ready to boot. Its bytes stay valid until it is freed. */
typedef struct pocketjs_system_app pocketjs_system_app_t;

/** The launcher, or the next app the launcher asked for. */
esp_err_t pocketjs_system_load_launcher(pocketjs_system_app_t **out_app);
/** The app a switch request names; false when none is pending. */
bool pocketjs_system_take_switch(char slot[17], bool *launcher);
esp_err_t pocketjs_system_load_slot(const char *slot,
                                    pocketjs_system_app_t **out_app);
void pocketjs_system_app_free(pocketjs_system_app_t *app);
/** The whole .pocket, for the runtime's package source. */
const uint8_t *pocketjs_system_app_bytes(const pocketjs_system_app_t *app,
                                         size_t *size);
const pocket_idf_package_facts *
pocketjs_system_app_facts(const pocketjs_system_app_t *app);
bool pocketjs_system_app_is_launcher(const pocketjs_system_app_t *app);

/** Before the runtime boots `app` in `realm`: record it as the running app,
 * bind its data.fs tree when its plan declares one, and install
 * `globalThis.link`, `net`, `wifi` and `fs`. */
esp_err_t pocketjs_system_bind(JSContext *realm,
                               const pocketjs_system_app_t *app);
/** After the runtime is destroyed: drop its link requests and its tree. */
void pocketjs_system_unbind(void);

/** The launcher operations, for the program's runtime operation provider:
 * the app table JSON (appTable) and a launch request by output name
 * (appLaunch). */
const char *pocketjs_system_app_table(void);
bool pocketjs_system_launch(const char *output);

/** Once per frame, before the guest's turn. */
void pocketjs_system_pump(void);
/** A switch is requested and not yet taken. */
bool pocketjs_system_switch_pending(void);
/** SELECT in an app other than the launcher: switch to the launcher. */
void pocketjs_system_summon(void);
bool pocketjs_system_launcher_running(void);
/** The running app failed: the launcher shows `message` once. */
void pocketjs_system_report_failure(const char *message);

/** The worker source of an app (package section 8 of its admitted
 * variant), or false when it declares no worker domain. The bytes live as
 * long as the app. */
bool pocketjs_system_app_worker(const pocketjs_system_app_t *app,
                                const char **source, size_t *size);
/** The worker bundle as a package bytecode section (section 9 of the
 * admitted variant), or false without one. The bytes live as long as the
 * app; the worker evaluates them when the envelope names its engine. */
bool pocketjs_system_app_worker_bytecode(const pocketjs_system_app_t *app,
                                         const uint8_t **envelope,
                                         size_t *size);

/** Callable from any task: the radio has an address. */
bool pocketjs_system_online(void);
/** Callable from any task: wait at most `ms` for the SNTP clock; true once
 * it has been set. */
bool pocketjs_system_clock_wait(uint32_t ms);

/** The pocket_http_esp transport of the worker's requests to
 * companion.pocket: the paired Hub answers them over the Pocket Link's
 * net.http (README, "Companion services"). Its callbacks are callable from any
 * task. */
struct pocket_http_esp_companion;
const struct pocket_http_esp_companion *pocketjs_system_companion(void);

#ifdef __cplusplus
}
#endif
