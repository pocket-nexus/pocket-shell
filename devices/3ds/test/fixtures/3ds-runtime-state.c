/* SPDX-License-Identifier: GPL-3.0-or-later */
#include "pocket_spec.h"
#include <assert.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#include "instance.h"
#include "pocket_container.h"
#include "runtime.h"

/* Host-test stand-in for the Rust inspection (pocket_package_open_source).
 * runtime.c still owns every filesystem transition and reads the `.pocket`
 * with the real container reader (pocket_container.c); this stub checks the
 * 3DS facts, the exact host ABI and that the source states a plan section
 * inside the file, and admits a plan that starts with "ok". */
int32_t pocket_package_open_source(
  const pocket_package_source_v1 *source,
  void *context,
  const pocket_profile_facts *facts,
  uint32_t host_abi, const uint8_t *profile_hash,
  PocketGuestPackage *out
) {
  (void)profile_hash;
  pocket_package_sections sections = {0};
  const uint8_t *bytes = NULL;
  size_t length = 0;
  if (source == NULL || source->sections == NULL || source->all == NULL ||
      source->sections(context, &sections) != 0 || source->all(context, &bytes, &length) != 0 ||
      host_abi != POCKET_BINDING_GENERATION || sections.host_abi != POCKET_BINDING_GENERATION ||
      facts == NULL || facts->id_length != 7 || memcmp(facts->id, "3ds-dev", 7) != 0 ||
      sections.plan_length < 2 || sections.plan_offset + sections.plan_length > length) {
    return POCKET_PACKAGE_OPEN_SOURCE;
  }
  if (memcmp(bytes + sections.plan_offset, "ok", 2) != 0) return POCKET_PACKAGE_OPEN_VIEWPORT;
  memset(out, 0, sizeof *out);
  out->javascript = bytes + sections.plan_offset;
  out->javascript_length = 1;
  return 0;
}

/* The package source instance.c supplies in the program. */
static int32_t source_length(void *context, size_t *out) {
  *out = ((const PocketRuntimePackage *)context)->length;
  return 0;
}
static int32_t source_all(void *context, const uint8_t **out, size_t *length) {
  *out = ((const PocketRuntimePackage *)context)->bytes;
  *length = ((const PocketRuntimePackage *)context)->length;
  return 0;
}
static int32_t source_sections(void *context, pocket_package_sections *out) {
  *out = ((const PocketRuntimePackage *)context)->sections;
  return 0;
}
static const pocket_package_source_v1 source_api = {sizeof source_api, source_length, source_all, NULL, NULL,
                                                    source_sections};
const pocket_package_source_v1 *instance_package_source(void) { return &source_api; }

static void le32(uint8_t *p, uint32_t value) {
  for (int i = 0; i < 4; ++i) p[i] = (uint8_t)(value >> (8 * i));
}
static void le64(uint8_t *p, uint64_t value) {
  for (int i = 0; i < 8; ++i) p[i] = (uint8_t)(value >> (8 * i));
}

/* Write a one-variant `.pocket` for 3ds-dev whose plan section is "ok" (or
 * "no" when `admitted` is 0) followed by `seed`, and return its footer
 * hash; a `valid` of 0 damages the footer. */
static uint64_t write_package(const char *path, uint64_t seed, int valid, int admitted) {
  uint8_t bytes[152] = {0};
  le32(bytes, POCKET_CONTAINER_MAGIC);
  le32(bytes + 4, POCKET_CONTAINER_VERSION);
  le32(bytes + 12, 1);   /* one variant */
  le32(bytes + 16, 96);  /* string table */
  le32(bytes + 20, 7);
  le32(bytes + 32, 96);  /* target "3ds-dev" */
  le32(bytes + 36, 7);
  le32(bytes + 40, POCKET_BINDING_GENERATION);
  le32(bytes + 44, 1);   /* one section */
  le32(bytes + 48, 112);
  memcpy(bytes + 96, "3ds-dev", 7);
  le32(bytes + 112, POCKET_CONTAINER_PLAN);
  le32(bytes + 120, 128);
  le32(bytes + 124, 16);
  memcpy(bytes + 128, admitted ? "ok" : "no", 2);
  le64(bytes + 136, seed);
  le64(bytes + 56, pocket_container_fnv1a64(POCKET_CONTAINER_FNV_OFFSET, bytes + 128, 16));
  uint64_t footer = pocket_container_fnv1a64(POCKET_CONTAINER_FNV_OFFSET, bytes, 144);
  le64(bytes + 144, valid ? footer : footer ^ 1);
  FILE *file = fopen(path, "wb");
  assert(file != NULL);
  assert(fwrite(bytes, 1, sizeof bytes, file) == sizeof bytes);
  assert(fclose(file) == 0);
  return footer;
}

static int exists(const char *path) {
  struct stat info;
  return stat(path, &info) == 0;
}

int main(int argc, char **argv) {
  assert(argc == 2);
  assert(chdir(argv[1]) == 0);
  assert(mkdir("sdmc:", 0777) == 0 || errno == EEXIST);

  /* Pre-slot state belongs to no application. A newly namespaced runtime
   * starts from its embedded guest instead of inheriting this package. */
  assert(mkdir("sdmc:/pocketjs", 0777) == 0);
  assert(mkdir("sdmc:/pocketjs/runtime", 0777) == 0);
  assert(mkdir("sdmc:/pocketjs/runtime/state", 0777) == 0);
  FILE *legacy = fopen(
    "sdmc:/pocketjs/runtime/state/state-00000007-1111222233334444-0000000000000000.commit",
    "wb"
  );
  assert(legacy != NULL);
  assert(fputs("accepted\n", legacy) >= 0);
  assert(fclose(legacy) == 0);

  char error[256] = {0};
  PocketRuntimeState state;
  /* The slot comes from the booted package at run time. Nothing is written
   * before one is chosen, and only 16 lowercase hex digits name one. */
  assert(!runtime_storage_init(&state, error, sizeof error));
  assert(strcmp(POCKET_RUNTIME_APP_ROOT, "") == 0);
  assert(!runtime_select_slot(NULL));
  assert(!runtime_select_slot("0123456789abcde"));
  assert(!runtime_select_slot("0123456789abcdef0"));
  assert(!runtime_select_slot("0123456789ABCDEF"));
  assert(!runtime_select_slot("../../../3ds/xyz"));
  assert(strcmp(POCKET_RUNTIME_APP_ROOT, "") == 0);
  assert(runtime_select_slot("0123456789abcdef"));
  assert(strcmp(runtime_slot(), "0123456789abcdef") == 0);
  assert(runtime_storage_init(&state, error, sizeof error));
  assert(state.generation == 0 && state.active_hash == 0 && state.last_good_hash == 0);
  assert(strcmp(POCKET_RUNTIME_APP_ROOT, "sdmc:/pocketjs/runtime/apps/0123456789abcdef") == 0);

  const uint64_t first_hash = write_package(POCKET_RUNTIME_PENDING, 0x1111222233334444ULL, 1, 1);
  char first_blob[160];
  snprintf(first_blob, sizeof first_blob,
           "sdmc:/pocketjs/runtime/apps/0123456789abcdef/packages/%016llx.pocket",
           (unsigned long long)first_hash);
  PocketRuntimePackage *first = NULL;
  assert(runtime_prepare_pending(&first, error, sizeof error) == RUNTIME_PENDING_READY);
  assert(first != NULL && first->guest.package_hash == first_hash);
  assert(first->guest.variant_hash != 0 && first->sections.plan_offset == 128);
  assert(!exists(POCKET_RUNTIME_PENDING));
  assert(exists(first_blob));
  runtime_package_free(first);
  assert(runtime_commit(&state, first_hash, 0, error, sizeof error));

  /* Re-uploading the active bytes verifies the immutable blob and removes only
   * the duplicate staging file; it does not create a second blob. */
  assert(write_package(POCKET_RUNTIME_PENDING, 0x1111222233334444ULL, 1, 1) == first_hash);
  PocketRuntimePackage *duplicate = NULL;
  assert(runtime_prepare_pending(&duplicate, error, sizeof error) == RUNTIME_PENDING_READY);
  assert(duplicate != NULL && duplicate->guest.package_hash == first_hash);
  assert(!exists(POCKET_RUNTIME_PENDING));
  runtime_package_free(duplicate);

  PocketRuntimeState reloaded;
  assert(runtime_storage_init(&reloaded, error, sizeof error));
  assert(reloaded.generation == 1);
  assert(reloaded.active_hash == first_hash && reloaded.last_good_hash == 0);

  const uint64_t second_hash = write_package(POCKET_RUNTIME_PENDING, 0xaaaabbbbccccddddULL, 1, 1);
  PocketRuntimePackage *second = NULL;
  assert(runtime_prepare_pending(&second, error, sizeof error) == RUNTIME_PENDING_READY);
  runtime_package_free(second);
  assert(runtime_commit(&reloaded, second_hash, first_hash, error, sizeof error));

  PocketRuntimeState accepted;
  assert(runtime_storage_init(&accepted, error, sizeof error));
  assert(accepted.generation == 2);
  assert(accepted.active_hash == second_hash && accepted.last_good_hash == first_hash);

  /* Consecutive runtime failures retain the whole episode: a staged
   * candidate falls back to active, then last-good, then ROMFS (hash 0).
   * Reset happens only after a recovered guest is accepted. */
  const uint64_t candidate_hash = 0x123456789abcdef0ULL;
  PocketRuntimeFailureLineage failures = {0};
  assert(runtime_failure_lineage_add(&failures, candidate_hash));
  assert(runtime_recovery_hash(&accepted, &failures) == second_hash);
  assert(runtime_failure_lineage_add(&failures, second_hash));
  assert(runtime_recovery_hash(&accepted, &failures) == first_hash);
  assert(runtime_failure_lineage_add(&failures, first_hash));
  assert(runtime_recovery_hash(&accepted, &failures) == 0);
  assert(runtime_failure_lineage_add(&failures, first_hash));
  assert(failures.count == 3);
  runtime_failure_lineage_reset(&failures);
  assert(failures.count == 0);
  assert(runtime_recovery_hash(&accepted, &failures) == second_hash);

  PocketRuntimePackage *last_good = runtime_package_load_hash(first_hash, error, sizeof error);
  assert(last_good != NULL && last_good->guest.package_hash == first_hash);
  runtime_package_free(last_good);

  /* A partial/bad FTP upload is never renamed or deleted. */
  write_package(POCKET_RUNTIME_PENDING, 0x9999, 0, 1);
  PocketRuntimePackage *invalid = NULL;
  assert(runtime_prepare_pending(&invalid, error, sizeof error) == RUNTIME_PENDING_ERROR);
  assert(invalid == NULL && exists(POCKET_RUNTIME_PENDING));
  assert(strstr(error, "package integrity hash mismatch") != NULL);

  /* A whole file whose only variant the host does not admit. */
  write_package(POCKET_RUNTIME_PENDING, 0x8888, 1, 0);
  assert(runtime_prepare_pending(&invalid, error, sizeof error) == RUNTIME_PENDING_ERROR);
  assert(invalid == NULL && exists(POCKET_RUNTIME_PENDING));
  assert(strstr(error, "does not provide the package's viewport") != NULL);

  /* The transport-declared footer is an independent admission check. A
   * mismatch remains inspectable at its staging path and creates no blob. */
  const char *network = POCKET_RUNTIME_UPLOAD;
  write_package(network, 0x123456789abcdef0ULL, 1, 1);
  PocketRuntimePackage *mismatch = NULL;
  assert(runtime_prepare_file(
    network,
    0xfedcba9876543210ULL,
    &mismatch,
    error,
    sizeof error
  ) == RUNTIME_PENDING_ERROR);
  assert(mismatch == NULL && exists(network));
  assert(strstr(error, "does not match declared") != NULL);

  /* After an install the embedded guest boots first; when it fails, the
   * stored packages are still tried, and only then is the failure fatal. */
  const PocketRuntimeState installed_state = { .generation = 7, .active_hash = 0xaaaa, .last_good_hash = 0xbbbb };
  PocketRuntimeFailureLineage lineage = {0};
  assert(runtime_failure_lineage_reject(&lineage, &installed_state, 0));
  assert(runtime_recovery_hash(&installed_state, &lineage) == 0xaaaa);
  assert(runtime_failure_lineage_reject(&lineage, &installed_state, 0xaaaa));
  assert(runtime_recovery_hash(&installed_state, &lineage) == 0xbbbb);
  assert(!runtime_failure_lineage_reject(&lineage, &installed_state, 0xbbbb));
  /* As the last resort the embedded guest's failure stays fatal. */
  const PocketRuntimeState bare_state = { .generation = 1, .active_hash = 0, .last_good_hash = 0 };
  runtime_failure_lineage_reset(&lineage);
  assert(!lineage.embedded_failed);
  assert(!runtime_failure_lineage_reject(&lineage, &bare_state, 0));
  runtime_failure_lineage_reset(&lineage);
  assert(runtime_failure_lineage_reject(&lineage, &installed_state, 0xaaaa));
  assert(runtime_failure_lineage_reject(&lineage, &installed_state, 0xbbbb));
  assert(!runtime_failure_lineage_reject(&lineage, &installed_state, 0));

  /* The first boot beside an embedded package, and every boot after a .3dsx
   * with a different one was installed, reports an install exactly once. */
  const char *embedded_record = "sdmc:/pocketjs/runtime/apps/0123456789abcdef/embedded.txt";
  assert(!exists(embedded_record));
  assert(runtime_note_embedded(0x1111222233334444ULL));
  assert(exists(embedded_record));
  assert(!runtime_note_embedded(0x1111222233334444ULL));
  assert(runtime_note_embedded(0x5555666677778888ULL));
  assert(!runtime_note_embedded(0x5555666677778888ULL));
  return 0;
}
