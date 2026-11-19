/* SPDX-License-Identifier: GPL-3.0-or-later */
/* programs/m5stack-tab5/components/pocket_system/src/package.c on the build
 * machine (tests/package.test.ts), one package per run:
 *
 *   package <file.pocket> <profile-hash>
 *
 * prints one JSON line: whether package_open admitted the file against the
 * exported host contract (pocket_profile.h), its message otherwise, the
 * variants offered to admission in order (by plan offset), and for an
 * admitted package its hashes, slot, stated sections, worker sections and
 * what each callback of its package source returns. <profile-hash> is `-`
 * for none, `profile` for pocket_profile's, or 64 hex digits.
 *
 * Linked with tests/package-admission.c, admission is that file's stand-in
 * for PocketJS's pocket_idf_package_open_source; linked with a host build of
 * the IDF archive (programs/esp-idf/archive in vendor/pocketjs), it is
 * PocketJS's own. */

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "package.h"
#include "pocket_profile.h"

/* The plan offsets of the variants offered, which package-admission.c
 * records; empty with PocketJS's admission. */
size_t test_offered[64];
size_t test_offered_count;

static uint8_t *slurp(const char *path, size_t *length) {
  FILE *file = fopen(path, "rb");
  if (file == NULL)
    return NULL;
  fseek(file, 0, SEEK_END);
  const long size = ftell(file);
  fseek(file, 0, SEEK_SET);
  /* An exact allocation, so ASan sees a read past the end. */
  uint8_t *bytes = malloc(size > 0 ? (size_t)size : 1u);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size)
    exit(3);
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

static void span(const char *name, size_t offset, size_t length,
                 const char *after) {
  printf("\"%s\":[%zu,%zu]%s", name, offset, length, after);
}

/* The first callback of the package source that does not behave as the
 * runtime reads it, or NULL. */
static const char *check_source(const AdmittedPackage *package) {
  const pocket_package_source_v1 *source = package_source();
  void *context = (void *)package;
  if (source->struct_size != sizeof *source || source->length == NULL ||
      source->all == NULL || source->range == NULL || source->take == NULL ||
      source->sections == NULL)
    return "table";
  size_t length = 0;
  if (source->length(context, &length) != POCKET_STATUS_OK ||
      length != package->size)
    return "length";
  const uint8_t *all = NULL;
  size_t all_length = 0;
  if (source->all(context, &all, &all_length) != POCKET_STATUS_OK ||
      all != package->bytes || all_length != package->size)
    return "all";
  uint8_t buffer[8];
  size_t read = 0;
  if (source->range(context, 3, buffer, 5, &read) != POCKET_STATUS_OK ||
      read != 5 || memcmp(buffer, package->bytes + 3, 5) != 0)
    return "range";
  if (source->range(context, package->size - 2, buffer, sizeof buffer, &read) !=
          POCKET_STATUS_OK ||
      read != 2 ||
      source->range(context, package->size, buffer, sizeof buffer, &read) !=
          POCKET_STATUS_OK ||
      read != 0 ||
      source->range(context, package->size + 1, buffer, sizeof buffer, &read) !=
          POCKET_STATUS_INVALID)
    return "range end";
  pocket_package_sections sections;
  memset(&sections, 0, sizeof sections);
  sections.struct_size = sizeof sections - 1;
  if (source->sections(context, &sections) != POCKET_STATUS_INVALID)
    return "sections struct_size";
  sections.struct_size = sizeof sections;
  if (source->sections(context, &sections) != POCKET_STATUS_OK ||
      memcmp(&sections, &package->sections, sizeof sections) != 0)
    return "sections";
  pocket_package_storage storage;
  memset(&storage, 0xa5, sizeof storage);
  storage.struct_size = offsetof(pocket_package_storage, flags);
  if (source->take(context, &storage) != POCKET_STATUS_INVALID)
    return "take struct_size";
  storage.struct_size = sizeof storage;
  if (source->take(context, &storage) != POCKET_STATUS_OK ||
      storage.bytes != package->bytes || storage.length != package->size ||
      storage.release != NULL || storage.release_context != NULL ||
      storage.flags != 0)
    return "take";
  return NULL;
}

int main(int argc, char **argv) {
  if (argc != 3)
    return 2;
  size_t size = 0;
  uint8_t *bytes = slurp(argv[1], &size);
  if (bytes == NULL)
    return 2;
  uint8_t hash[32];
  const uint8_t *profile_hash = NULL;
  if (strcmp(argv[2], "profile") == 0) {
    profile_hash = pocket_profile.profile_hash;
  } else if (strcmp(argv[2], "-") != 0) {
    for (int k = 0; k < 32; ++k) {
      unsigned value;
      if (sscanf(argv[2] + 2 * k, "%2x", &value) != 1)
        return 2;
      hash[k] = (uint8_t)value;
    }
    profile_hash = hash;
  }
  const PackageHost host = {
      .target = pocket_profile.id,
      .facts = pocket_profile.facts,
      .host_abi = pocket_profile.host_abi,
      .profile_hash = profile_hash,
  };
  AdmittedPackage package;
  pocket_idf_package_facts facts;
  char error[160] = {0};
  const bool ok =
      package_open(bytes, size, &host, &package, &facts, error, sizeof error);
  printf("{\"ok\":%s,\"offered\":[", ok ? "true" : "false");
  for (size_t i = 0; i < test_offered_count; ++i)
    printf("%s%zu", i ? "," : "", test_offered[i]);
  printf("]");
  if (!ok) {
    printf(",\"error\":\"%s\"}\n", error);
    free(bytes);
    return 0;
  }
  const pocket_package_sections *s = &package.sections;
  char slot[17];
  package_slot(&facts, slot);
  printf(",\"hash\":\"%016" PRIx64 "\",\"variantHash\":\"%016" PRIx64
         "\",\"slot\":\"%s\",\"hostAbi\":%" PRIu32 ",",
         package.hash, package.variant_hash, slot, s->host_abi);
  printf("\"features\":{\"camera.photo\":%s,\"data.fs\":%s},",
         package_feature(&facts, "camera.photo") ? "true" : "false",
         package_feature(&facts, "data.fs") ? "true" : "false");
  printf("\"inPlace\":%s,",
         package.bytes == bytes && package.size == size ? "true" : "false");
  printf("\"sections\":{");
  span("plan", s->plan_offset, s->plan_length, ",");
  span("js", s->js_offset, s->js_length, ",");
  span("pak", s->pak_offset, s->pak_length, ",");
  span("bytecode", s->bytecode_offset, s->bytecode_length, ",");
  span("workerJs", s->worker_js_offset, s->worker_js_length, ",");
  span("workerBytecode", s->worker_bytecode_offset, s->worker_bytecode_length,
       "},");
  printf("\"factsPlan\":[%zu,%zu],",
         facts.plan != NULL ? (size_t)(facts.plan - bytes) : SIZE_MAX,
         facts.plan_length);
  const char *worker = NULL;
  size_t worker_length = 0;
  if (package_worker(&package, &worker, &worker_length))
    printf("\"worker\":[%zu,%zu],", (size_t)((const uint8_t *)worker - bytes),
           worker_length);
  else
    printf("\"worker\":null,");
  const uint8_t *envelope = NULL;
  size_t envelope_length = 0;
  if (package_worker_bytecode(&package, &envelope, &envelope_length))
    printf("\"workerBytecode\":[%zu,%zu],", (size_t)(envelope - bytes),
           envelope_length);
  else
    printf("\"workerBytecode\":null,");
  const char *source = check_source(&package);
  printf("\"source\":\"%s\"}\n", source != NULL ? source : "ok");
  free(bytes);
  return 0;
}
