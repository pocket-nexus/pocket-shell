#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "quickjs.h"

/* wifi.c: `globalThis.wifi` (contracts/spec/wifi.ts) over esp_wifi. The radio
 * comes up on its own task, after `prepare`; every call below is safe before
 * it has. */
void wifi_start(esp_err_t (*prepare)(void));
const char *wifi_status_json(void);
bool wifi_set_enabled(bool on);
bool wifi_connect(int slot);
bool wifi_scan(void);
bool wifi_join(const char *ssid, size_t ssid_length, const char *passphrase,
               size_t passphrase_length);
bool wifi_forget(int slot);
/* An open access point beside the station, with an HTTP page. */
bool wifi_start_access_point(const char *ssid, size_t ssid_length);
bool wifi_stop_access_point(void);
/* An address is assigned: sockets reach the LAN. */
bool wifi_online(void);
void wifi_address(char *out, size_t capacity);

/* clock.c: the wall clock from SNTP, started with the radio. clock_wait
 * returns true once the clock has been set, false after `ms` without. */
void clock_start(void);
bool clock_wait(uint32_t ms);

/* services_host.c: run `job` on the system task, whose stack is internal
 * (flash access), and return when it has finished. */
void system_run(void (*job)(void *), void *context);

/* services_host.c: the malloc and calloc of the Pocket Link client
 * (CMakeLists.txt), from PSRAM, and from the default heap when PSRAM has no
 * room. free() releases either. */
void *pocket_system_link_malloc(size_t size);
void *pocket_system_link_calloc(size_t count, size_t size);

/* fetch.c: one download at a time into `path`, hashed with SHA-256 as it
 * is written. fetch_poll answers FETCH_RUNNING, FETCH_DONE (`sha256` holds
 * the file's hash) or FETCH_FAILED (`error` says why); `total` is the
 * declared length, 0 while unknown. fetch_end stops a running download or
 * releases a finished one, and returns once the file is closed. */
#define FETCH_RUNNING 0
#define FETCH_DONE 1
#define FETCH_FAILED (-1)
bool fetch_start(const char *url, const char *path, uint32_t max_bytes);
int32_t fetch_poll(uint32_t *received, uint32_t *total, uint8_t sha256[32],
                   char *error, size_t error_capacity);
void fetch_end(void);

/* install.c: `globalThis.installer`, on the system task. install_uri
 * answers a request id or -1; install_poll the events since the last call
 * as one JSON array, or NULL. */
int32_t install_uri(const char *uri, size_t length);
const char *install_poll(void);
void install_pump(void);
void install_reset_guest(void);

/* flash_store.c: installed packages on a raw flash partition of 64 KiB
 * pages, mapped read-only as a whole. Every call runs on the system task.
 * Bytes a find or an install returns stay valid until the slot's package is
 * removed or replaced. */
#define FLASH_STORE_MAX_ENTRIES 32
esp_err_t flash_store_open(const char *label);
bool flash_store_ready(void);
const uint8_t *flash_store_find(const char *slot, size_t *size, uint64_t *hash);
size_t flash_store_count(void);
const uint8_t *flash_store_at(size_t index, char slot[17], size_t *size,
                              uint64_t *hash);
/* Program `bytes`, whose footer is `hash`, as `slot`'s package and replace
 * the one it had. ESP_ERR_NO_MEM when no run of pages is free. */
esp_err_t flash_store_install(const char *slot, const uint8_t *bytes,
                              size_t size, uint64_t hash,
                              const uint8_t **stored);
bool flash_store_remove(const char *slot);
size_t flash_store_free_bytes(void);
/* The stage: one install that streams into the partition. Begin sets a run
 * of free pages aside for a package of `size` bytes, false when no run is
 * free or another install is streaming. A write returns once its bytes are
 * programmed. The staged bytes are read through the mapping. Commit makes
 * them `slot`'s package and replaces the one it had; abort, and a firmware
 * that starts in the middle, leave the pages free. */
bool flash_store_stage_begin(size_t size);
bool flash_store_staging(void);
esp_err_t flash_store_stage_write(const uint8_t *bytes, size_t length);
const uint8_t *flash_store_staged(size_t *size);
esp_err_t flash_store_stage_commit(const char *slot, const uint8_t **stored);
void flash_store_stage_abort(void);

/* flash_stage.c: the stage as the staging file of an install, for the
 * engine's stdio. flash_stage_path begins the stage for `slot` and writes the
 * path to open; false when the install has to be staged in a file of the
 * store instead. */
bool flash_stage_path(const char *slot, size_t size, char *out,
                      size_t capacity);
bool flash_stage_is(const char *path);

/* qjs.c: install the system namespaces into the guest's realm; the
 * launcher also gets `installer`. */
esp_err_t system_qjs_install(JSContext *ctx, bool launcher);
