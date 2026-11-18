/*
 * The staging file of an install as a file of the apps partition.
 *
 * The engine writes an install with stdio (engine/host-services
 * link2_guest.c: fopen, fwrite, fsync, fclose, and remove when it fails) into
 * the path link_host_staging_path gives it. This file system gives it a path
 * whose bytes go to the flash store's stage (flash_store.c) as they are
 * written: a write returns when its bytes are in flash, and the link grants
 * the Hub credit for more only after it returns, so the package is never
 * held in a file, on a card or on the storage partition, on its way.
 *
 * One install streams at a time. Every call runs on the system task, the
 * link's owner.
 */

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "esp_vfs.h"
#include "system_internal.h"

#define STAGE_MOUNT "/stage"
/* The one descriptor of this file system. */
#define STAGE_FD 0

static bool registered;
static bool opened;
static char staged_slot[17];

/* `path` below the mount point names the slot that is staging. */
static bool names_stage(const char *path) {
  return flash_store_staging() && path != NULL && path[0] == '/' &&
         strcmp(path + 1, staged_slot) == 0;
}

static int stage_open(void *context, const char *path, int flags, int mode) {
  (void)context;
  (void)mode;
  if (!names_stage(path) || opened || (flags & O_ACCMODE) != O_WRONLY) {
    errno = ENOENT;
    return -1;
  }
  opened = true;
  return STAGE_FD;
}

static ssize_t stage_write(void *context, int fd, const void *data,
                           size_t size) {
  (void)context;
  if (fd != STAGE_FD || !opened) {
    errno = EBADF;
    return -1;
  }
  const esp_err_t result = flash_store_stage_write(data, size);
  if (result != ESP_OK) {
    errno = result == ESP_ERR_INVALID_SIZE ? ENOSPC : EIO;
    return -1;
  }
  return (ssize_t)size;
}

static int stage_close(void *context, int fd) {
  (void)context;
  if (fd != STAGE_FD || !opened) {
    errno = EBADF;
    return -1;
  }
  opened = false;
  return 0;
}

static int stage_fstat(void *context, int fd, struct stat *st) {
  (void)context;
  if (fd != STAGE_FD || !opened) {
    errno = EBADF;
    return -1;
  }
  size_t written = 0;
  flash_store_staged(&written);
  memset(st, 0, sizeof *st);
  st->st_mode = S_IFREG;
  st->st_size = (off_t)written;
  st->st_blksize = 4096;
  return 0;
}

/* A write has returned only once its bytes were in flash. */
static int stage_fsync(void *context, int fd) {
  (void)context;
  if (fd != STAGE_FD || !opened) {
    errno = EBADF;
    return -1;
  }
  return 0;
}

/* The engine removes the staging file of an install that failed. */
static int stage_unlink(void *context, const char *path) {
  (void)context;
  if (!names_stage(path)) {
    errno = ENOENT;
    return -1;
  }
  opened = false;
  flash_store_stage_abort();
  return 0;
}

static const esp_vfs_t stage_vfs = {
    .flags = ESP_VFS_FLAG_CONTEXT_PTR,
    .write_p = stage_write,
    .open_p = stage_open,
    .close_p = stage_close,
    .fstat_p = stage_fstat,
    .unlink_p = stage_unlink,
    .fsync_p = stage_fsync,
};

bool flash_stage_path(const char *slot, size_t size, char *out,
                      size_t capacity) {
  if (slot == NULL || strlen(slot) != 16 || capacity < sizeof STAGE_MOUNT + 17)
    return false;
  if (!registered) {
    if (esp_vfs_register(STAGE_MOUNT, &stage_vfs, NULL) != ESP_OK)
      return false;
    registered = true;
  }
  if (!flash_store_stage_begin(size))
    return false;
  opened = false;
  memcpy(staged_slot, slot, sizeof staged_slot);
  snprintf(out, capacity, STAGE_MOUNT "/%s", slot);
  return true;
}

bool flash_stage_is(const char *path) {
  return path != NULL &&
         strncmp(path, STAGE_MOUNT "/", sizeof STAGE_MOUNT) == 0 &&
         names_stage(path + sizeof STAGE_MOUNT - 1);
}
