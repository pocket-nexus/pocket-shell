/*
 * engine/host-services on ESP-IDF (host_services.h), and the store and app
 * lifecycle of pocket/system.h.
 *
 * A slot holds one committed package, `package.pocket`; its hash is the
 * file's footer. An install streams into `link-upload.pocket` from the
 * companion, or into `url-upload.pocket` from an address (install.c), is
 * admitted (footer, FNV-1a64, a variant the firmware's host facts satisfy, an
 * app id that hashes to the slot) and replaces `package.pocket`. FAT refuses
 * a rename onto an existing name, so the old package is removed first: an
 * interrupted install loses the app, never leaves a package the firmware
 * would refuse. The launcher and the bundled packages stay in the firmware
 * image: their slots hold cached facts and data, and their bytes are read
 * from flash in place.
 *
 * Storage on the flash partition and the radio's NVS are flash, and a flash
 * access disables the cache, which a task with its stack in PSRAM cannot
 * survive. The guest's runner and the firmware's app task have PSRAM
 * stacks, so every system operation runs on one task with an internal stack
 * while its caller waits (system_run).
 */

#include "pocket/system.h"

#include <dirent.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>

#include "companion.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "fs.h"
#include "host_services.h"
#include "jscan.h"
#include "launcher.h"
#include "link2_host.h"
#include "sha256.h"
#include "system_internal.h"

#define PACKAGE_NAME "package.pocket"
#define STAGING_NAME "link-upload.pocket"
#define SLOT_PATH_BYTES 128
#define SYSTEM_TASK_STACK (12 * 1024)

static const char *TAG = "pocket_system";

struct pocketjs_system_app {
  /* A copy in PSRAM for a package read from the card; NULL for a package
   * the firmware embeds, read from flash in place. */
  uint8_t *owned;
  const uint8_t *bytes;
  size_t size;
  pocket_idf_package_facts facts;
  char slot[17];
  bool launcher;
};

/* A package read from flash in place: the launcher, a bundled app or an app
 * installed on the apps partition. Its facts are read once, when it is
 * admitted, so booting it costs no hash pass. */
typedef struct {
  const uint8_t *bytes;
  size_t size;
  pocket_idf_package_facts facts;
  uint64_t hash;
  char slot[17];
  /* Part of the firmware image: the companion can neither replace nor
   * remove it. */
  bool bundled;
} ResidentPackage;

static bool started;
static pocketjs_system_config_t config;
static char root_dir[64];
static char apps_dir[80];
static char link_dir[80];
static char launcher_slot[17];
static ResidentPackage launcher_package;
/* The bundled apps, then the installed ones; changed on the system task. */
static ResidentPackage *residents;
static size_t resident_count;
static size_t resident_capacity;

/* The resident package kept in `slot`, or NULL. */
static ResidentPackage *resident_in_slot(const char *slot) {
  if (slot == NULL)
    return NULL;
  if (launcher_package.bytes != NULL &&
      strcmp(slot, launcher_package.slot) == 0)
    return &launcher_package;
  for (size_t i = 0; i < resident_count; ++i)
    if (strcmp(slot, residents[i].slot) == 0)
      return &residents[i];
  return NULL;
}

static void resident_drop(ResidentPackage *entry) {
  const size_t index = (size_t)(entry - residents);
  memmove(entry, entry + 1, (resident_count - index - 1) * sizeof *entry);
  resident_count -= 1;
}

/* Add the resident package of entry->slot, or replace the one it had. */
static bool resident_put(const ResidentPackage *entry) {
  ResidentPackage *existing = resident_in_slot(entry->slot);
  if (existing == &launcher_package)
    return false;
  if (existing != NULL) {
    *existing = *entry;
    return true;
  }
  if (resident_count == resident_capacity)
    return false;
  residents[resident_count++] = *entry;
  return true;
}

// ---------------------------------------------------------------------------
// the system task
// ---------------------------------------------------------------------------

static TaskHandle_t system_task;
static SemaphoreHandle_t system_busy;
static SemaphoreHandle_t system_job_ready;
static SemaphoreHandle_t system_job_done;
static void (*system_job)(void *);
static void *system_job_context;

static void system_main(void *unused) {
  (void)unused;
  for (;;) {
    xSemaphoreTake(system_job_ready, portMAX_DELAY);
    system_job(system_job_context);
    xSemaphoreGive(system_job_done);
  }
}

static bool system_task_start(void) {
  if (system_task != NULL)
    return true;
  system_busy = xSemaphoreCreateMutex();
  system_job_ready = xSemaphoreCreateBinary();
  system_job_done = xSemaphoreCreateBinary();
  /* xTaskCreate takes the stack from internal RAM. */
  return system_busy != NULL && system_job_ready != NULL &&
         system_job_done != NULL &&
         xTaskCreate(system_main, "pocket_sys", SYSTEM_TASK_STACK, NULL, 6,
                     &system_task) == pdPASS;
}

void system_run(void (*job)(void *), void *context) {
  if (system_task == NULL || xTaskGetCurrentTaskHandle() == system_task) {
    job(context);
    return;
  }
  xSemaphoreTake(system_busy, portMAX_DELAY);
  system_job = job;
  system_job_context = context;
  xSemaphoreGive(system_job_ready);
  xSemaphoreTake(system_job_done, portMAX_DELAY);
  xSemaphoreGive(system_busy);
}

// ---------------------------------------------------------------------------
// packages
// ---------------------------------------------------------------------------

static uint64_t footer_of(const uint8_t *bytes, size_t size) {
  uint64_t hash = 0;
  if (size < 8)
    return 0;
  for (int i = 7; i >= 0; i -= 1)
    hash = (hash << 8) | bytes[size - 8 + (size_t)i];
  return hash;
}

/* Admit `bytes` by the firmware's host facts and read the admitted
 * variant's facts. */
static bool open_package(const uint8_t *bytes, size_t size,
                         pocket_idf_package_facts *facts, char *error,
                         size_t capacity) {
  /* pocket_idf_package_open's codes 19..25: the first admission item the
   * closest variant fails. */
  static const char *const ITEMS[] = {
      "raster density",    // 19
      "animation class",   // 20
      "tick rate",         // 21
      "viewport",          // 22
      "presentation",      // 23
      "capabilities",      // 24
      "auxiliary surface", // 25
  };
  memset(facts, 0, sizeof *facts);
  facts->struct_size = sizeof *facts;
  const int32_t code = pocket_idf_package_open(
      bytes, size, config.facts, config.host_abi, config.profile_hash, facts);
  if (code == 0)
    return true;
  if (code == 6)
    snprintf(error, capacity, "the package has no variant");
  else if (code == 7)
    snprintf(error, capacity,
             "the package was built for another binding generation");
  else if (code >= 19 && code <= 25)
    snprintf(error, capacity, "%s does not provide the package's %s",
             config.target, ITEMS[code - 19]);
  else
    snprintf(error, capacity, "the package is damaged (%ld)", (long)code);
  return false;
}

static uint32_t le32(const uint8_t *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 |
         (uint32_t)p[3] << 24;
}

static uint64_t le64(const uint8_t *p) {
  return (uint64_t)le32(p) | (uint64_t)le32(p + 4) << 32;
}

/* A section of the admitted variant, the one whose hash (variant offset 24,
 * contracts/spec/pocket-package.ts) is facts->variant_hash: `kind` 8, the
 * NUL-terminated worker source, or 9, its bytecode envelope. */
static bool variant_section(const uint8_t *bytes, size_t size,
                            const pocket_idf_package_facts *facts,
                            uint32_t kind, const uint8_t **payload,
                            size_t *length) {
  enum { HEADER = 32, VARIANT = 64, SECTION = 16, FOOTER = 8 };
  if (size < HEADER + FOOTER)
    return false;
  const uint64_t payload_end = size - FOOTER;
#define WITHIN(offset, count)                                                  \
  ((uint64_t)(offset) <= payload_end &&                                        \
   (uint64_t)(count) <= payload_end - (offset))
  const uint64_t table = HEADER + ((uint64_t)le32(bytes + 8) + 15) / 16 * 16;
  const uint32_t variants = le32(bytes + 12);
  if (variants > 64 || !WITHIN(table, (uint64_t)variants * VARIANT))
    return false;
  for (uint32_t v = 0; v < variants; ++v) {
    const uint8_t *variant = bytes + table + (uint64_t)v * VARIANT;
    if (le32(variant + 8) != config.host_abi ||
        le64(variant + 24) != facts->variant_hash)
      continue;
    const uint32_t count = le32(variant + 12), sections = le32(variant + 16);
    if (count > 64 || !WITHIN(sections, (uint64_t)count * SECTION))
      return false;
    for (uint32_t s = 0; s < count; ++s) {
      const uint8_t *section = bytes + sections + (uint64_t)s * SECTION;
      const uint32_t start = le32(section + 8), span = le32(section + 12);
      if (le32(section) != kind)
        continue;
      if (span == 0 || !WITHIN(start, span))
        return false;
      *payload = bytes + start;
      *length = span;
      return true;
    }
    return false;
  }
#undef WITHIN
  return false;
}

/* Section 8: the worker source, NUL-terminated, without its terminator. */
static bool worker_section(const uint8_t *bytes, size_t size,
                           const pocket_idf_package_facts *facts,
                           const char **source, size_t *length) {
  const uint8_t *payload = NULL;
  size_t span = 0;
  if (!variant_section(bytes, size, facts, 8, &payload, &span) || span < 2 ||
      payload[span - 1] != 0)
    return false;
  *source = (const char *)payload;
  *length = span - 1;
  return true;
}

static LauncherPackage facts_of(const pocket_idf_package_facts *facts,
                                const uint8_t *bytes, size_t size) {
  return (LauncherPackage){
      .plan = (const char *)facts->plan,
      .plan_length = facts->plan_length,
      .hash = footer_of(bytes, size),
      .bytes = size,
  };
}

/* Admit `bytes`, read in place, as the resident package of its slot. */
static bool admit_resident(const uint8_t *bytes, size_t size, bool bundled,
                           ResidentPackage *out, char *error, size_t capacity) {
  ResidentPackage entry = {.bytes = bytes, .size = size, .bundled = bundled};
  if (!open_package(bytes, size, &entry.facts, error, capacity))
    return false;
  memcpy(entry.slot, entry.facts.slot, sizeof entry.slot);
  entry.hash = footer_of(bytes, size);
  *out = entry;
  return true;
}

/* The whole file in PSRAM, 16-byte aligned like an embedded package. */
static uint8_t *read_file(const char *path, size_t *size) {
  FILE *file = fopen(path, "rb");
  if (file == NULL)
    return NULL;
  uint8_t *bytes = NULL;
  long length = -1;
  if (fseek(file, 0, SEEK_END) == 0)
    length = ftell(file);
  if (length > 0 && fseek(file, 0, SEEK_SET) == 0) {
    bytes = heap_caps_aligned_alloc(16, (size_t)length,
                                    MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (bytes != NULL &&
        fread(bytes, 1, (size_t)length, file) != (size_t)length) {
      heap_caps_free(bytes);
      bytes = NULL;
    }
  }
  fclose(file);
  if (bytes != NULL)
    *size = (size_t)length;
  return bytes;
}

/* The bytes a LauncherPackage borrows, released by services_host_release. */
typedef struct {
  uint8_t *bytes;
} HeldPackage;

/* Read and admit the package at `path` by the firmware's host facts; its
 * footer must be `expected` (0: any) and its app id must hash to `slot`. */
static bool load_path(const char *path, const char *slot, uint64_t expected,
                      LauncherPackage *out, void **held, char *error,
                      size_t capacity) {
  size_t size = 0;
  uint8_t *bytes = read_file(path, &size);
  if (bytes == NULL) {
    snprintf(error, capacity, "the package cannot be read");
    return false;
  }
  if (expected != 0 && footer_of(bytes, size) != expected) {
    heap_caps_free(bytes);
    snprintf(error, capacity, "the package does not match its declared hash");
    return false;
  }
  pocket_idf_package_facts facts;
  HeldPackage *keep = malloc(sizeof *keep);
  if (keep == NULL || !open_package(bytes, size, &facts, error, capacity)) {
    if (keep == NULL)
      snprintf(error, capacity, "out of memory");
    free(keep);
    heap_caps_free(bytes);
    return false;
  }
  if (strcmp(facts.slot, slot) != 0) {
    snprintf(error, capacity, "the package belongs to another app");
    free(keep);
    heap_caps_free(bytes);
    return false;
  }
  keep->bytes = bytes;
  *out = facts_of(&facts, bytes, size);
  *held = keep;
  return true;
}

// ---------------------------------------------------------------------------
// host_services.h: clocks and randomness
// ---------------------------------------------------------------------------

uint64_t services_host_ms(void) {
  return (uint64_t)esp_timer_get_time() / 1000u;
}

uint64_t services_host_us(void) { return (uint64_t)esp_timer_get_time(); }

uint64_t services_host_epoch_ms(void) {
  struct timeval now;
  gettimeofday(&now, NULL);
  return (uint64_t)now.tv_sec * 1000u + (uint64_t)now.tv_usec / 1000u;
}

void services_host_random(uint8_t *out, size_t length) {
  esp_fill_random(out, length);
}

// ---------------------------------------------------------------------------
// host_services.h: packages
// ---------------------------------------------------------------------------

const char *launcher_host_apps_directory(void) { return apps_dir; }

bool launcher_host_slot_path(const char *slot, const char *name, char *out,
                             size_t capacity) {
  if (slot == NULL || strlen(slot) != 16)
    return false;
  int written = name == NULL
                    ? snprintf(out, capacity, "%s/%s", apps_dir, slot)
                    : snprintf(out, capacity, "%s/%s/%s", apps_dir, slot, name);
  return written > 0 && (size_t)written < capacity;
}

bool launcher_host_active_hash(const char *slot, uint64_t *hash) {
  const ResidentPackage *resident = resident_in_slot(slot);
  if (resident != NULL) {
    *hash = resident->hash;
    return true;
  }
  char path[SLOT_PATH_BYTES];
  if (!launcher_host_slot_path(slot, PACKAGE_NAME, path, sizeof path))
    return false;
  FILE *file = fopen(path, "rb");
  if (file == NULL)
    return false;
  uint8_t footer[8];
  bool ok = fseek(file, -8, SEEK_END) == 0 &&
            fread(footer, 1, sizeof footer, file) == sizeof footer;
  fclose(file);
  if (ok)
    *hash = footer_of(footer, sizeof footer);
  return ok;
}

bool launcher_host_load(const char *slot, uint64_t hash, LauncherPackage *out,
                        void **held) {
  const ResidentPackage *resident = resident_in_slot(slot);
  if (resident != NULL) {
    if (hash != 0 && hash != resident->hash)
      return false;
    *out = facts_of(&resident->facts, resident->bytes, resident->size);
    *held = NULL;
    return true;
  }
  char path[SLOT_PATH_BYTES];
  char error[160];
  if (!launcher_host_slot_path(slot, PACKAGE_NAME, path, sizeof path))
    return false;
  if (load_path(path, slot, hash, out, held, error, sizeof error))
    return true;
  ESP_LOGW(TAG, "slot %s: %s", slot, error);
  return false;
}

void services_host_release(void *held) {
  HeldPackage *keep = held;
  if (keep == NULL)
    return;
  heap_caps_free(keep->bytes);
  free(keep);
}

// ---------------------------------------------------------------------------
// host_services.h: the Pocket Link
// ---------------------------------------------------------------------------

const char *link_host_target(void) { return config.target; }

void link_host_identity(char *name, size_t name_capacity, char *model,
                        size_t model_capacity) {
  snprintf(name, name_capacity, "%s",
           config.device_name != NULL ? config.device_name : "ESP-IDF");
  snprintf(model, model_capacity, "%s",
           config.device_model != NULL ? config.device_model : "ESP-IDF");
}

const char *link_host_directory(void) { return link_dir; }

bool link_host_net_ready(void) { return wifi_online(); }

void link_host_address(char *out, size_t capacity) {
  wifi_address(out, capacity);
}

void *pocket_system_link_malloc(size_t size) {
  void *block = heap_caps_malloc(size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  return block != NULL ? block : malloc(size);
}

void *pocket_system_link_calloc(size_t count, size_t size) {
  void *block =
      heap_caps_calloc(count, size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  return block != NULL ? block : calloc(count, size);
}

bool link_host_staging_path(const char *slot, char *out, size_t capacity) {
  /* An install from the Hub streams into the apps partition when it has a
   * run of free pages for the declared size: no file, on a card or on the
   * storage partition, holds the package on its way. Without the partition,
   * without such a run (link_host_install then reuses the slot's own pages)
   * or beside another install that is streaming, it is staged in a file. */
  const uint32_t declared = link2_host_install_bytes();
  if (declared != 0 && flash_stage_path(slot, declared, out, capacity)) {
    ESP_LOGI(TAG, "slot %s: %u bytes stream into the apps partition", slot,
             (unsigned)declared);
    return true;
  }
  char directory[SLOT_PATH_BYTES];
  if (!launcher_host_slot_path(slot, NULL, directory, sizeof directory))
    return false;
  mkdir(apps_dir, 0777);
  mkdir(directory, 0777);
  return launcher_host_slot_path(slot, STAGING_NAME, out, capacity);
}

/* A slot's folder is made here, in milliseconds on FAT. When it cannot be
 * made the answer is still true: the commit then fails with its own
 * message instead of an install that waits for a folder for good. */
bool link_host_slot_ready(const char *slot) {
  char directory[SLOT_PATH_BYTES];
  if (launcher_host_slot_path(slot, NULL, directory, sizeof directory)) {
    mkdir(apps_dir, 0777);
    mkdir(directory, 0777);
  }
  return true;
}

/* Admit the package an install streamed into the apps partition and commit
 * it where it is: no copy is read back into PSRAM and none is programmed a
 * second time. */
static bool install_staged(const char *slot, uint64_t hash,
                           LauncherPackage *out, void **held, char *error,
                           size_t capacity) {
  size_t size = 0;
  const uint8_t *bytes = flash_store_staged(&size);
  const ResidentPackage *resident = resident_in_slot(slot);
  ResidentPackage entry;
  bool admitted = false;
  if (resident != NULL && resident->bundled)
    snprintf(error, capacity,
             "install: the slot holds a package bundled into the firmware");
  /* Its old pages become free at the commit, and an install after this one
   * may erase them under it. */
  else if (strcmp(slot, launcher_current_slot()) == 0)
    snprintf(error, capacity,
             "install: the app is running; return to the launcher first");
  else if (size < 8 || (hash != 0 && footer_of(bytes, size) != hash))
    snprintf(error, capacity, "the package does not match its declared hash");
  else if (admit_resident(bytes, size, false, &entry, error, capacity)) {
    if (strcmp(entry.slot, slot) != 0)
      snprintf(error, capacity, "the package belongs to another app");
    else
      admitted = true;
  }
  if (!admitted) {
    flash_store_stage_abort();
    return false;
  }
  const esp_err_t result = flash_store_stage_commit(slot, NULL);
  if (result != ESP_OK) {
    snprintf(error, capacity,
             "install: the apps partition could not be written (%s)",
             esp_err_to_name(result));
    return false;
  }
  if (!resident_put(&entry)) {
    flash_store_remove(slot);
    snprintf(error, capacity, "install: no room in the package table");
    return false;
  }
  char stale[SLOT_PATH_BYTES];
  if (launcher_host_slot_path(slot, PACKAGE_NAME, stale, sizeof stale))
    remove(stale);
  ESP_LOGI(TAG, "slot %s: %u bytes installed where they were streamed", slot,
           (unsigned)size);
  *out = facts_of(&entry.facts, entry.bytes, entry.size);
  *held = NULL;
  return true;
}

bool link_host_install(const char *slot, const char *path, uint64_t hash,
                       LauncherPackage *out, void **held, char *error,
                       size_t error_capacity) {
  if (flash_stage_is(path))
    return install_staged(slot, hash, out, held, error, error_capacity);
  const ResidentPackage *resident = resident_in_slot(slot);
  if (resident != NULL && resident->bundled) {
    remove(path);
    snprintf(error, error_capacity,
             "install: the slot holds a package bundled into the firmware");
    return false;
  }
  /* The running app reads its package from the pages an install erases. */
  if (flash_store_ready() && strcmp(slot, launcher_current_slot()) == 0) {
    remove(path);
    snprintf(error, error_capacity,
             "install: the app is running; return to the launcher first");
    return false;
  }
  if (!load_path(path, slot, hash, out, held, error, error_capacity)) {
    remove(path);
    return false;
  }
  if (flash_store_ready()) {
    const HeldPackage *keep = *held;
    const size_t size = (size_t)out->bytes;
    const uint8_t *stored = NULL;
    const esp_err_t result =
        flash_store_install(slot, keep->bytes, size, out->hash, &stored);
    remove(path);
    ResidentPackage entry;
    bool admitted =
        result == ESP_OK &&
        admit_resident(stored, size, false, &entry, error, error_capacity);
    if (admitted && !resident_put(&entry)) {
      snprintf(error, error_capacity, "install: no room in the package table");
      admitted = false;
    }
    if (admitted) {
      char stale[SLOT_PATH_BYTES];
      if (launcher_host_slot_path(slot, PACKAGE_NAME, stale, sizeof stale))
        remove(stale);
      return true;
    }
    if (result == ESP_OK)
      flash_store_remove(slot);
    services_host_release(*held);
    *held = NULL;
    if (result == ESP_ERR_NO_MEM)
      snprintf(error, error_capacity,
               "install: no room on the apps partition (%u KiB free)",
               (unsigned)(flash_store_free_bytes() / 1024));
    else if (result != ESP_OK)
      snprintf(error, error_capacity,
               "install: the apps partition could not be written (%s)",
               esp_err_to_name(result));
    return false;
  }
  char committed[SLOT_PATH_BYTES];
  if (!launcher_host_slot_path(slot, PACKAGE_NAME, committed,
                               sizeof committed)) {
    services_host_release(*held);
    snprintf(error, error_capacity, "install: bad slot");
    return false;
  }
  remove(committed);
  if (rename(path, committed) != 0) {
    services_host_release(*held);
    snprintf(error, error_capacity,
             "install: the package could not be committed");
    return false;
  }
  return true;
}

bool link_host_remove(const char *slot) {
  char directory[SLOT_PATH_BYTES];
  struct stat info;
  ResidentPackage *resident = resident_in_slot(slot);
  /* A bundled package is part of the firmware. */
  if (resident != NULL && resident->bundled)
    return false;
  const bool installed = resident != NULL;
  if (installed) {
    flash_store_remove(slot);
    resident_drop(resident);
  }
  if (!launcher_host_slot_path(slot, NULL, directory, sizeof directory) ||
      stat(directory, &info) != 0) {
    return installed;
  }
  return fs_remove_tree(directory, FS_MAX_DEPTH + 2) || installed;
}

/* Version 1's hooks for an agent channel: the version 2 client calls none
 * of them, and this host has no agent. */
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

// ---------------------------------------------------------------------------
// pocket/system.h
// ---------------------------------------------------------------------------

typedef struct {
  const char *label;
  const char *root;
  esp_err_t result;
} FlashMount;

static void mount_flash(void *argument) {
  FlashMount *mount = argument;
  const esp_vfs_fat_mount_config_t options = {
      .format_if_mount_failed = true,
      .max_files = 8,
      .allocation_unit_size = CONFIG_WL_SECTOR_SIZE,
  };
  wl_handle_t handle = WL_INVALID_HANDLE;
  mount->result = esp_vfs_fat_spiflash_mount_rw_wl(mount->root, mount->label,
                                                   &options, &handle);
}

esp_err_t pocketjs_system_mount_flash(const char *label, const char *root) {
  if (!system_task_start())
    return ESP_ERR_NO_MEM;
  FlashMount mount = {.label = label, .root = root, .result = ESP_FAIL};
  system_run(mount_flash, &mount);
  return mount.result;
}

/* The hash the slot's app.txt names: the launcher's cached facts. */
static bool cached_hash(const char *slot, uint64_t *hash) {
  char path[SLOT_PATH_BYTES];
  if (!launcher_host_slot_path(slot, "app.txt", path, sizeof path))
    return false;
  FILE *file = fopen(path, "rb");
  if (file == NULL)
    return false;
  char line[256];
  bool found = false;
  while (!found && fgets(line, sizeof line, file) != NULL) {
    if (strncmp(line, "hash=", 5) == 0) {
      *hash = strtoull(line + 5, NULL, 16);
      found = true;
    }
  }
  fclose(file);
  return found;
}

/* A bundled package is served from flash. Its slot directory holds the
 * launcher's cached facts and the app's data tree, never the package: one an
 * earlier firmware wrote there is removed. */
static void admit_bundled(const pocketjs_system_bundled_t *bundled) {
  ResidentPackage entry;
  char error[160];
  if (!admit_resident(bundled->bytes, bundled->size, true, &entry, error,
                      sizeof error)) {
    ESP_LOGE(TAG, "bundled package: %s", error);
    return;
  }
  if (resident_in_slot(entry.slot) != NULL) {
    ESP_LOGW(TAG, "slot %s: a bundled package repeats an embedded one",
             entry.slot);
    return;
  }
  if (!resident_put(&entry)) {
    ESP_LOGE(TAG, "slot %s: no room in the package table", entry.slot);
    return;
  }
  char path[SLOT_PATH_BYTES];
  if (launcher_host_slot_path(entry.slot, NULL, path, sizeof path))
    mkdir(path, 0777);
  if (launcher_host_slot_path(entry.slot, PACKAGE_NAME, path, sizeof path) &&
      remove(path) == 0)
    ESP_LOGI(TAG, "slot %s: removed the package an earlier firmware stored",
             entry.slot);
  if (launcher_host_slot_path(entry.slot, STAGING_NAME, path, sizeof path))
    remove(path);
  uint64_t cached = 0;
  if (!cached_hash(entry.slot, &cached) || cached != entry.hash) {
    const LauncherPackage package =
        facts_of(&entry.facts, entry.bytes, entry.size);
    launcher_note_installed(entry.slot, &package);
  }
  ESP_LOGI(TAG, "slot %s: bundled package served from flash (%u bytes)",
           entry.slot, (unsigned)entry.size);
}

/* The packages on the apps partition become resident apps. One whose slot
 * the firmware bundles is removed; one the host facts no longer admit stays
 * on the partition, unlisted, until an install replaces it. */
static void admit_flash_store(void) {
  if (config.packages_partition == NULL)
    return;
  const esp_err_t opened = flash_store_open(config.packages_partition);
  if (opened != ESP_OK) {
    ESP_LOGW(TAG, "apps partition %s: %s; packages stay files",
             config.packages_partition, esp_err_to_name(opened));
    return;
  }
  char error[160];
  for (size_t i = 0; i < flash_store_count();) {
    char slot[17];
    size_t size = 0;
    uint64_t hash = 0;
    const uint8_t *bytes = flash_store_at(i, slot, &size, &hash);
    if (resident_in_slot(slot) != NULL) {
      ESP_LOGI(TAG,
               "slot %s: the firmware bundles this app; its installed "
               "copy is removed",
               slot);
      flash_store_remove(slot);
      continue;
    }
    ResidentPackage entry;
    if (!admit_resident(bytes, size, false, &entry, error, sizeof error)) {
      ESP_LOGW(TAG, "slot %s: %s", slot, error);
      i += 1;
      continue;
    }
    if (entry.hash != hash || strcmp(entry.slot, slot) != 0) {
      ESP_LOGW(TAG, "slot %s: the stored header names another package", slot);
      flash_store_remove(slot);
      continue;
    }
    if (!resident_put(&entry))
      ESP_LOGE(TAG, "slot %s: no room in the package table", slot);
    /* The launcher lists the slot directories of the store: a package on
     * the partition whose directory is missing (another card) gets one. */
    char path[SLOT_PATH_BYTES];
    if (launcher_host_slot_path(slot, NULL, path, sizeof path))
      mkdir(path, 0777);
    i += 1;
  }
}

/* A package.pocket an earlier firmware kept under the store moves to the
 * apps partition; it stays a file when no run of pages is free. */
static void migrate_slot(const char *slot) {
  char path[SLOT_PATH_BYTES];
  struct stat info;
  if (!launcher_host_slot_path(slot, PACKAGE_NAME, path, sizeof path) ||
      stat(path, &info) != 0)
    return;
  LauncherPackage package;
  void *held = NULL;
  char error[160];
  if (!load_path(path, slot, 0, &package, &held, error, sizeof error)) {
    ESP_LOGW(TAG, "slot %s: %s", slot, error);
    return;
  }
  const HeldPackage *keep = held;
  const size_t size = (size_t)package.bytes;
  const uint8_t *stored = NULL;
  const esp_err_t result =
      flash_store_install(slot, keep->bytes, size, package.hash, &stored);
  services_host_release(held);
  if (result != ESP_OK) {
    ESP_LOGW(TAG, "slot %s: the package stays a file (%s)", slot,
             esp_err_to_name(result));
    return;
  }
  ResidentPackage entry;
  if (admit_resident(stored, size, false, &entry, error, sizeof error) &&
      resident_put(&entry)) {
    remove(path);
    ESP_LOGI(TAG, "slot %s: moved the package to the apps partition (%u bytes)",
             slot, (unsigned)size);
    return;
  }
  flash_store_remove(slot);
  ESP_LOGW(TAG, "slot %s: %s", slot, error);
}

static void migrate_files(void) {
  DIR *directory = opendir(apps_dir);
  if (directory == NULL)
    return;
  struct dirent *entry;
  while ((entry = readdir(directory)) != NULL) {
    if (strlen(entry->d_name) == 16 && resident_in_slot(entry->d_name) == NULL)
      migrate_slot(entry->d_name);
  }
  closedir(directory);
}

/* A Hub that is away fails every attempt the same way: a reason is logged
 * once, until the link comes up or the reason changes. */
static void report_link(const char *hub, const char *why) {
  static bool up;
  static char last[96];
  if (hub != NULL) {
    up = true;
    last[0] = '\0';
    ESP_LOGI(TAG, "pocket link: linked to %s", hub);
    return;
  }
  const char *reason = why != NULL ? why : "closed";
  if (up)
    ESP_LOGI(TAG, "pocket link: down (%s)", reason);
  else if (strcmp(reason, last) != 0)
    ESP_LOGI(TAG, "pocket link: no link (%s)", reason);
  up = false;
  snprintf(last, sizeof last, "%s", reason);
}

/* The store's directories, the launcher's slot, the bundled and installed
 * packages and the link's client. */
static void start_store(void *argument) {
  esp_err_t *result = argument;
  mkdir(apps_dir, 0777);
  char error[160];
  launcher_package.bytes = config.launcher;
  launcher_package.size = config.launcher_size;
  if (!open_package(launcher_package.bytes, launcher_package.size,
                    &launcher_package.facts, error, sizeof error)) {
    ESP_LOGE(TAG, "launcher: %s", error);
    launcher_package.bytes = NULL;
    *result = ESP_ERR_INVALID_ARG;
    return;
  }
  launcher_package.hash =
      footer_of(launcher_package.bytes, launcher_package.size);
  launcher_package.bundled = true;
  memcpy(launcher_package.slot, launcher_package.facts.slot,
         sizeof launcher_package.slot);
  memcpy(launcher_slot, launcher_package.facts.slot, sizeof launcher_slot);
  const LauncherPackage package = facts_of(
      &launcher_package.facts, launcher_package.bytes, launcher_package.size);
  launcher_init(launcher_slot, &package);
  resident_capacity = config.bundled_count + FLASH_STORE_MAX_ENTRIES;
  /* Pointers into flash and cached facts, read on the app task: PSRAM
   * serves them and spares the internal heap the strips compete for. */
  residents = heap_caps_calloc(resident_capacity, sizeof *residents,
                               MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (residents == NULL)
    residents = calloc(resident_capacity, sizeof *residents);
  if (residents == NULL) {
    ESP_LOGE(TAG, "packages: out of memory");
    resident_capacity = 0;
  } else {
    for (size_t i = 0; i < config.bundled_count; ++i)
      admit_bundled(&config.bundled[i]);
    admit_flash_store();
    if (flash_store_ready())
      migrate_files();
  }
  const Link2HostConfig link_config = {
      .home = &package,
      .host_abi = config.host_abi,
      .report = report_link,
  };
  link2_host_init(&link_config);
}

esp_err_t pocketjs_system_start(const pocketjs_system_config_t *settings) {
  if (started)
    return ESP_ERR_INVALID_STATE;
  if (settings == NULL || settings->struct_size < sizeof *settings ||
      settings->target == NULL || settings->facts == NULL ||
      settings->launcher == NULL || settings->root == NULL ||
      strlen(settings->root) >= sizeof root_dir - 8) {
    return ESP_ERR_INVALID_ARG;
  }
  config = *settings;
  snprintf(root_dir, sizeof root_dir, "%s", settings->root);
  snprintf(apps_dir, sizeof apps_dir, "%s/apps", root_dir);
  snprintf(link_dir, sizeof link_dir, "%s/link", root_dir);
  if (!system_task_start())
    return ESP_ERR_NO_MEM;
  esp_err_t result = ESP_OK;
  system_run(start_store, &result);
  if (result != ESP_OK)
    return result;
  if (settings->wifi)
    wifi_start(settings->wifi_prepare);
  started = true;
  return ESP_OK;
}

static esp_err_t finish_app(pocketjs_system_app_t *app, const uint8_t *bytes,
                            size_t size, pocketjs_system_app_t **out) {
  char error[160];
  app->bytes = bytes;
  app->size = size;
  if (!open_package(bytes, size, &app->facts, error, sizeof error)) {
    ESP_LOGE(TAG, "slot %s: %s", app->slot, error);
    pocketjs_system_app_free(app);
    return ESP_ERR_INVALID_RESPONSE;
  }
  *out = app;
  return ESP_OK;
}

/* An app read from flash in place, whose facts were read when it was
 * admitted. */
static esp_err_t resident_app(const ResidentPackage *resident, bool launcher,
                              pocketjs_system_app_t **out) {
  pocketjs_system_app_t *app = calloc(1, sizeof *app);
  if (app == NULL)
    return ESP_ERR_NO_MEM;
  app->bytes = resident->bytes;
  app->size = resident->size;
  app->facts = resident->facts;
  memcpy(app->slot, resident->slot, sizeof app->slot);
  app->launcher = launcher;
  *out = app;
  return ESP_OK;
}

esp_err_t pocketjs_system_load_launcher(pocketjs_system_app_t **out_app) {
  if (!started || out_app == NULL)
    return ESP_ERR_INVALID_STATE;
  return resident_app(&launcher_package, true, out_app);
}

typedef struct {
  const char *slot;
  bool found;
  ResidentPackage package;
} ResidentLookup;

/* On the system task: the table changes there. */
static void lookup_resident(void *argument) {
  ResidentLookup *lookup = argument;
  const ResidentPackage *resident = resident_in_slot(lookup->slot);
  lookup->found = resident != NULL;
  if (resident != NULL)
    lookup->package = *resident;
}

typedef struct {
  const char *slot;
  uint8_t *bytes;
  size_t size;
} SlotRead;

static void read_slot(void *argument) {
  SlotRead *read = argument;
  char path[SLOT_PATH_BYTES];
  if (launcher_host_slot_path(read->slot, PACKAGE_NAME, path, sizeof path))
    read->bytes = read_file(path, &read->size);
}

esp_err_t pocketjs_system_load_slot(const char *slot,
                                    pocketjs_system_app_t **out_app) {
  if (!started || out_app == NULL || slot == NULL || strlen(slot) != 16)
    return ESP_ERR_INVALID_ARG;
  if (strcmp(slot, launcher_slot) == 0)
    return pocketjs_system_load_launcher(out_app);
  ResidentLookup lookup = {.slot = slot};
  system_run(lookup_resident, &lookup);
  if (lookup.found)
    return resident_app(&lookup.package, false, out_app);
  SlotRead read = {.slot = slot};
  system_run(read_slot, &read);
  uint8_t *bytes = read.bytes;
  size_t size = read.size;
  if (bytes == NULL)
    return ESP_ERR_NOT_FOUND;
  pocketjs_system_app_t *app = calloc(1, sizeof *app);
  if (app == NULL) {
    heap_caps_free(bytes);
    return ESP_ERR_NO_MEM;
  }
  app->owned = bytes;
  snprintf(app->slot, sizeof app->slot, "%s", slot);
  return finish_app(app, bytes, size, out_app);
}

bool pocketjs_system_take_switch(char slot[17], bool *launcher) {
  LauncherTarget target;
  if (!launcher_take_request(&target))
    return false;
  memcpy(slot, target.slot, 17);
  *launcher = target.home;
  return true;
}

void pocketjs_system_app_free(pocketjs_system_app_t *app) {
  if (app == NULL)
    return;
  heap_caps_free(app->owned);
  free(app);
}

const uint8_t *pocketjs_system_app_bytes(const pocketjs_system_app_t *app,
                                         size_t *size) {
  if (app == NULL) {
    if (size != NULL)
      *size = 0;
    return NULL;
  }
  if (size != NULL)
    *size = app->size;
  return app->bytes;
}

const pocket_idf_package_facts *
pocketjs_system_app_facts(const pocketjs_system_app_t *app) {
  return app == NULL ? NULL : &app->facts;
}

bool pocketjs_system_app_is_launcher(const pocketjs_system_app_t *app) {
  return app != NULL && app->launcher;
}

static void bind_app(void *argument) {
  const pocketjs_system_app_t *app = argument;
  LauncherPackage package = facts_of(&app->facts, app->bytes, app->size);
  /* The link names the running app in every net.http request and in
   * runtime.status; the guest's top level may already fetch. */
  launcher_set_current(app->slot, &package);
  link2_host_guest_begin(&package);
  if ((app->facts.features & POCKET_IDF_FEATURE_FS) != 0U) {
    char data[SLOT_PATH_BYTES];
    char temp[SLOT_PATH_BYTES];
    char directory[SLOT_PATH_BYTES];
    if (launcher_host_slot_path(app->slot, NULL, directory, sizeof directory) &&
        launcher_host_slot_path(app->slot, "data", data, sizeof data) &&
        launcher_host_slot_path(app->slot, "fs-tmp", temp, sizeof temp)) {
      mkdir(apps_dir, 0777);
      mkdir(directory, 0777);
      const char *plan = (const char *)app->facts.plan;
      if (!fs_bind(data, temp, fs_plan_quota(plan, app->facts.plan_length))) {
        ESP_LOGW(TAG, "slot %s: data.fs unavailable: %s", app->slot,
                 fs_last_error());
      }
    }
  }
}

esp_err_t pocketjs_system_bind(JSContext *realm,
                               const pocketjs_system_app_t *app) {
  if (!started || realm == NULL || app == NULL)
    return ESP_ERR_INVALID_ARG;
  system_run(bind_app, (void *)app);
  return system_qjs_install(realm, app->launcher);
}

static void unbind(void *unused) {
  (void)unused;
  link2_host_guest_end();
  install_reset_guest();
  fs_unbind();
}

void pocketjs_system_unbind(void) { system_run(unbind, NULL); }

typedef struct {
  const char *output;
  const char *table;
  bool launched;
} LauncherCall;

static void app_table(void *argument) {
  LauncherCall *call = argument;
  call->table = launcher_table_json();
}

static void launch(void *argument) {
  LauncherCall *call = argument;
  call->launched = launcher_launch(call->output);
}

const char *pocketjs_system_app_table(void) {
  LauncherCall call = {0};
  system_run(app_table, &call);
  return call.table;
}

bool pocketjs_system_launch(const char *output) {
  if (output == NULL)
    return false;
  LauncherCall call = {.output = output};
  system_run(launch, &call);
  return call.launched;
}

static void pump(void *unused) {
  (void)unused;
  link2_host_pump();
  install_pump();
}

void pocketjs_system_pump(void) { system_run(pump, NULL); }

bool pocketjs_system_switch_pending(void) { return launcher_pending(); }

void pocketjs_system_summon(void) { launcher_summon(); }

bool pocketjs_system_launcher_running(void) { return launcher_home_running(); }

void pocketjs_system_report_failure(const char *message) {
  launcher_report_failure(launcher_current_output(), message);
}

bool pocketjs_system_app_worker(const pocketjs_system_app_t *app,
                                const char **source, size_t *size) {
  return app != NULL && source != NULL && size != NULL &&
         worker_section(app->bytes, app->size, &app->facts, source, size);
}

bool pocketjs_system_app_worker_bytecode(const pocketjs_system_app_t *app,
                                         const uint8_t **envelope,
                                         size_t *size) {
  return app != NULL && envelope != NULL && size != NULL &&
         variant_section(app->bytes, app->size, &app->facts, 9, envelope, size);
}

bool pocketjs_system_online(void) { return wifi_online(); }

bool pocketjs_system_clock_wait(uint32_t ms) { return clock_wait(ms); }

// ---------------------------------------------------------------------------
// the worker's requests to companion.pocket (companion.c), on the system
// task, which owns the link
// ---------------------------------------------------------------------------

typedef struct {
  const uint8_t *descriptor;
  size_t length;
  char *error;
  size_t capacity;
  uint32_t id;
  pocket_http_esp_fact *fact;
  bool taken;
} CompanionCall;

static void companion_start_job(void *argument) {
  CompanionCall *call = argument;
  call->id = companion_start(call->descriptor, call->length, call->error,
                             call->capacity);
}

static void companion_take_job(void *argument) {
  CompanionCall *call = argument;
  call->taken = companion_take(call->id, call->fact);
}

static void companion_close_job(void *argument) {
  companion_close(((CompanionCall *)argument)->id);
}

static uint32_t route_start(void *context, const uint8_t *descriptor,
                            size_t length, char *error, size_t capacity) {
  (void)context;
  CompanionCall call = {.descriptor = descriptor,
                        .length = length,
                        .error = error,
                        .capacity = capacity};
  system_run(companion_start_job, &call);
  return call.id;
}

static bool route_take(void *context, uint32_t id, pocket_http_esp_fact *fact) {
  (void)context;
  CompanionCall call = {.id = id, .fact = fact};
  system_run(companion_take_job, &call);
  return call.taken;
}

static void route_close(void *context, uint32_t id) {
  (void)context;
  CompanionCall call = {.id = id};
  system_run(companion_close_job, &call);
}

static const pocket_http_esp_companion companion_route = {
    .start = route_start, .take = route_take, .close = route_close};

const pocket_http_esp_companion *pocketjs_system_companion(void) {
  return &companion_route;
}
