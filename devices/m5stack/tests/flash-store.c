/* programs/m5stack-tab5/components/pocket_system/src/flash_store.c under
 * AddressSanitizer and UndefinedBehaviorSanitizer (tools/test-worker-io.sh),
 * over a flash image in memory that behaves as NOR does: an erase sets a
 * whole 4 KiB sector, and a write can only clear bits, so a write onto bytes
 * that were not erased is counted as a fault.
 *
 *   flash-store write <image>    installs, streams and aborts, then leaves
 *                                the image with an install cut in its middle
 *   flash-store reopen <image>   a firmware that starts on that image
 *
 * The headers of tests/idf stand in for ESP-IDF's. */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_partition.h"
#include "system_internal.h"

#define PAGE 0x10000u
#define PAGES 16u
#define SECTOR 4096u
#define HEADER 64u

static uint8_t flash[PAGES * PAGE];
static const esp_partition_t apps = {.address = 0x810000, .size = sizeof flash};
static unsigned erases;
static unsigned bad_writes;
static int failures;

const esp_partition_t *esp_partition_find_first(int type, int subtype,
                                                const char *label) {
  (void)type;
  (void)subtype;
  return strcmp(label, "apps") == 0 ? &apps : NULL;
}

esp_err_t esp_partition_mmap(const esp_partition_t *partition, size_t offset,
                             size_t size, int memory, const void **out,
                             esp_partition_mmap_handle_t *handle) {
  (void)memory;
  if (partition != &apps || offset + size > sizeof flash)
    return ESP_ERR_INVALID_ARG;
  *out = flash + offset;
  *handle = 1;
  return ESP_OK;
}

esp_err_t esp_partition_erase_range(const esp_partition_t *partition,
                                    size_t offset, size_t size) {
  if (partition != &apps || offset % SECTOR != 0 || size % SECTOR != 0 ||
      offset + size > sizeof flash)
    return ESP_ERR_INVALID_ARG;
  memset(flash + offset, 0xff, size);
  erases += 1;
  return ESP_OK;
}

esp_err_t esp_partition_write(const esp_partition_t *partition, size_t offset,
                              const void *source, size_t size) {
  if (partition != &apps || offset + size > sizeof flash)
    return ESP_ERR_INVALID_ARG;
  const uint8_t *bytes = source;
  for (size_t i = 0; i < size; i += 1) {
    if ((flash[offset + i] & bytes[i]) != bytes[i])
      bad_writes += 1;
    flash[offset + i] &= bytes[i];
  }
  return ESP_OK;
}

static void expect(int ok, const char *what) {
  if (!ok) {
    fprintf(stderr, "flash-store: %s\n", what);
    failures += 1;
  }
}

/* A package of `size` bytes: a pattern from `seed`, and a footer that names
 * it. The store reads the footer as the package's hash. */
static uint8_t *package(size_t size, uint8_t seed) {
  uint8_t *bytes = malloc(size);
  for (size_t i = 0; i < size; i += 1)
    bytes[i] = (uint8_t)(i * 31u + seed);
  for (size_t i = 0; i < 8; i += 1)
    bytes[size - 8 + i] = (uint8_t)(seed + i);
  return bytes;
}

static uint64_t footer(const uint8_t *bytes, size_t size) {
  uint64_t hash = 0;
  for (int i = 7; i >= 0; i -= 1)
    hash = (hash << 8) | bytes[size - 8 + (size_t)i];
  return hash;
}

/* Stream `bytes` into the stage in pieces of uneven sizes. */
static esp_err_t stream(const uint8_t *bytes, size_t size) {
  static const size_t PIECES[] = {1, 63, 4095, 4096, 4097, 16384, 7, 65536};
  size_t at = 0;
  for (size_t piece = 0; at < size; piece += 1) {
    size_t count = PIECES[piece % (sizeof PIECES / sizeof PIECES[0])];
    if (count > size - at)
      count = size - at;
    const esp_err_t result = flash_store_stage_write(bytes + at, count);
    if (result != ESP_OK)
      return result;
    at += count;
  }
  return ESP_OK;
}

static bool holds(const char *slot, const uint8_t *bytes, size_t size) {
  size_t stored_size = 0;
  uint64_t hash = 0;
  const uint8_t *stored = flash_store_find(slot, &stored_size, &hash);
  return stored != NULL && stored_size == size && hash == footer(bytes, size) &&
         memcmp(stored, bytes, size) == 0;
}

#define SLOT_A "aaaaaaaaaaaaaaaa"
#define SLOT_B "bbbbbbbbbbbbbbbb"
#define SLOT_C "cccccccccccccccc"
#define SLOT_D "dddddddddddddddd"
#define SIZE_A 150000u
#define SIZE_A2 70000u
#define SIZE_B 40000u
/* Three pages: the run the replaced A leaves free. */
#define SIZE_C 180000u
#define SIZE_D 500000u

static int write_image(const char *path) {
  memset(flash, 0xff, sizeof flash);
  expect(flash_store_open("apps") == ESP_OK, "an erased partition opens");
  expect(flash_store_count() == 0, "an erased partition holds no package");
  expect(flash_store_free_bytes() == sizeof flash, "every page is free");

  /* A streams in: a page is erased when the bytes reach it, not before. */
  uint8_t *a = package(SIZE_A, 1);
  expect(flash_store_stage_begin(SIZE_A), "a stage begins");
  expect(erases == 0, "beginning a stage erases nothing");
  expect(flash_store_stage_write(a, 1) == ESP_OK, "the first byte");
  expect(erases == 1, "the first byte erases one page");
  expect(stream(a + 1, PAGE - HEADER - 1) == ESP_OK, "the rest of the page");
  expect(erases == 1, "a page that fills erases no other");
  expect(!flash_store_stage_begin(SIZE_B), "one install streams at a time");

  /* B is installed whole beside it, outside the run A streams into. */
  uint8_t *b = package(SIZE_B, 2);
  const uint8_t *stored_b = NULL;
  expect(flash_store_install(SLOT_B, b, SIZE_B, footer(b, SIZE_B), &stored_b) ==
             ESP_OK,
         "an install beside a stage");
  size_t staged = 0;
  const uint8_t *stage_bytes = flash_store_staged(&staged);
  expect(staged == PAGE - HEADER, "the stage holds what was written");
  expect(stored_b != NULL && (stored_b < stage_bytes - HEADER ||
                              stored_b >= stage_bytes - HEADER + 3 * PAGE),
         "the install lies outside the stage's run");

  expect(stream(a + (PAGE - HEADER), SIZE_A - (PAGE - HEADER)) == ESP_OK,
         "the rest of A");
  expect(erases == 3 + 1, "A reached three pages; B erased its run once");
  stage_bytes = flash_store_staged(&staged);
  expect(staged == SIZE_A && memcmp(stage_bytes, a, SIZE_A) == 0,
         "the staged bytes are A");
  expect(flash_store_count() == 1, "a stage is no package before its commit");
  uint8_t past = 0;
  expect(stream(a, 3 * PAGE) == ESP_ERR_INVALID_SIZE &&
             flash_store_stage_write(&past, 1) == ESP_ERR_INVALID_SIZE,
         "bytes past the declared size are refused");
  flash_store_stage_abort();

  /* The stage again, this time to its commit. */
  const uint8_t *stored_a = NULL;
  expect(flash_store_stage_begin(SIZE_A) && stream(a, SIZE_A) == ESP_OK,
         "A streams again over the pages of the abort");
  expect(flash_store_stage_commit(SLOT_A, &stored_a) == ESP_OK, "A commits");
  expect(!flash_store_staging(), "a commit ends the stage");
  expect(flash_store_count() == 2 && holds(SLOT_A, a, SIZE_A) &&
             holds(SLOT_B, b, SIZE_B),
         "A and B are the packages");
  expect(flash_store_find(SLOT_A, NULL, NULL) == stored_a,
         "A is read where it was streamed");
  expect(flash_store_free_bytes() == sizeof flash - 4 * PAGE,
         "A holds three pages and B one");

  /* A stage that is cut off leaves the packages and the free pages alone. */
  uint8_t *c = package(SIZE_C, 3);
  expect(flash_store_stage_begin(SIZE_C) && stream(c, SIZE_C / 2) == ESP_OK,
         "half of C streams");
  flash_store_stage_abort();
  expect(flash_store_count() == 2 &&
             flash_store_free_bytes() == sizeof flash - 4 * PAGE,
         "an aborted stage holds no page");
  expect(flash_store_stage_commit(SLOT_C, NULL) == ESP_ERR_INVALID_STATE,
         "an aborted stage commits nothing");

  /* A replacement streams beside the package it replaces. */
  uint8_t *a2 = package(SIZE_A2, 4);
  expect(flash_store_stage_begin(SIZE_A2) && stream(a2, SIZE_A2) == ESP_OK,
         "a replacement of A streams");
  expect(holds(SLOT_A, a, SIZE_A), "A stays until the replacement commits");
  expect(flash_store_stage_commit(SLOT_A, NULL) == ESP_OK,
         "the replacement commits");
  expect(flash_store_count() == 2 && holds(SLOT_A, a2, SIZE_A2),
         "the slot holds the replacement");
  expect(flash_store_free_bytes() == sizeof flash - 3 * PAGE,
         "the replaced package's pages are free");

  /* A package no run of free pages holds, and an install over pages that
   * earlier stages left written. */
  expect(!flash_store_stage_begin(sizeof flash),
         "no run of free pages for the whole partition");
  uint8_t *d = package(SIZE_D, 5);
  expect(flash_store_install(SLOT_D, d, SIZE_D, footer(d, SIZE_D), NULL) ==
                 ESP_OK &&
             holds(SLOT_D, d, SIZE_D),
         "an install over pages a stage left written");

  /* The image a restart finds: C cut in its middle, no commit. */
  expect(flash_store_stage_begin(SIZE_C) && stream(c, SIZE_C / 2) == ESP_OK,
         "half of C streams before the cut");
  expect(bad_writes == 0, "no write landed on bytes that were not erased");
  FILE *image = fopen(path, "wb");
  expect(image != NULL && fwrite(flash, 1, sizeof flash, image) == sizeof flash,
         "the image is written");
  if (image != NULL)
    fclose(image);
  free(a);
  free(a2);
  free(b);
  free(c);
  free(d);
  return failures;
}

static int reopen_image(const char *path) {
  FILE *image = fopen(path, "rb");
  expect(image != NULL && fread(flash, 1, sizeof flash, image) == sizeof flash,
         "the image is read");
  if (image != NULL)
    fclose(image);
  uint8_t *a2 = package(SIZE_A2, 4);
  uint8_t *b = package(SIZE_B, 2);
  uint8_t *c = package(SIZE_C, 3);
  uint8_t *d = package(SIZE_D, 5);
  expect(flash_store_open("apps") == ESP_OK, "the image opens");
  expect(flash_store_count() == 3 && holds(SLOT_A, a2, SIZE_A2) &&
             holds(SLOT_B, b, SIZE_B) && holds(SLOT_D, d, SIZE_D),
         "a start finds the three committed packages");
  expect(!flash_store_staging() && flash_store_find(SLOT_C, NULL, NULL) == NULL,
         "the install that was cut is no package and no stage");
  expect(flash_store_stage_begin(SIZE_C) && stream(c, SIZE_C) == ESP_OK &&
             flash_store_stage_commit(SLOT_C, NULL) == ESP_OK &&
             holds(SLOT_C, c, SIZE_C),
         "C streams whole over the pages of the cut");
  expect(flash_store_remove(SLOT_B) && flash_store_count() == 3 &&
             flash_store_find(SLOT_B, NULL, NULL) == NULL,
         "a removal frees a package");
  expect(bad_writes == 0, "no write landed on bytes that were not erased");
  free(a2);
  free(b);
  free(c);
  free(d);
  return failures;
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "write") == 0)
    return write_image(argv[2]) == 0 ? 0 : 1;
  if (argc == 3 && strcmp(argv[1], "reopen") == 0) {
    const int result = reopen_image(argv[2]);
    if (result == 0)
      puts("flash-store: ok");
    return result == 0 ? 0 : 1;
  }
  return 2;
}
