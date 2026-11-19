/* SPDX-License-Identifier: GPL-3.0-or-later */
/* A `.pocket` the firmware admits and boots (package.h). */

#include "package.h"

#include <stdio.h>
#include <string.h>

// ---------------------------------------------------------------------------
// the package source
// ---------------------------------------------------------------------------

static int32_t source_length(void *context, size_t *out) {
  const AdmittedPackage *package = context;
  if (package == NULL || package->bytes == NULL || out == NULL)
    return POCKET_STATUS_INVALID;
  *out = package->size;
  return POCKET_STATUS_OK;
}

static int32_t source_all(void *context, const uint8_t **out, size_t *size) {
  if (out == NULL)
    return POCKET_STATUS_INVALID;
  const int32_t status = source_length(context, size);
  if (status == POCKET_STATUS_OK)
    *out = ((const AdmittedPackage *)context)->bytes;
  return status;
}

static int32_t source_range(void *context, size_t offset, uint8_t *out,
                            size_t capacity, size_t *read) {
  const AdmittedPackage *package = context;
  size_t size = 0;
  if (read == NULL || (out == NULL && capacity != 0) ||
      source_length(context, &size) != POCKET_STATUS_OK || offset > size)
    return POCKET_STATUS_INVALID;
  *read = size - offset < capacity ? size - offset : capacity;
  if (*read != 0)
    memcpy(out, package->bytes + offset, *read);
  return POCKET_STATUS_OK;
}

/* The bytes are the launcher or a bundled package in the firmware image, an
 * installed package on the mapped `apps` partition, or a copy in PSRAM that
 * pocketjs_system_app_free releases after the runtime is destroyed: no
 * release. No flag: the bytes are no bundle. */
static int32_t source_take(void *context, pocket_package_storage *out) {
  if (out == NULL ||
      out->struct_size <
          offsetof(pocket_package_storage, flags) + sizeof out->flags)
    return POCKET_STATUS_INVALID;
  size_t size = 0;
  const int32_t status = source_length(context, &size);
  if (status != POCKET_STATUS_OK)
    return status;
  out->bytes = ((const AdmittedPackage *)context)->bytes;
  out->length = size;
  out->release = NULL;
  out->release_context = NULL;
  out->flags = 0;
  return POCKET_STATUS_OK;
}

static int32_t source_sections(void *context, pocket_package_sections *out) {
  const AdmittedPackage *package = context;
  if (package == NULL || out == NULL || out->struct_size < sizeof *out)
    return POCKET_STATUS_INVALID;
  *out = package->sections;
  out->struct_size = sizeof *out;
  return POCKET_STATUS_OK;
}

static const pocket_package_source_v1 SOURCE = {
    .struct_size = sizeof SOURCE,
    .length = source_length,
    .all = source_all,
    .range = source_range,
    .take = source_take,
    .sections = source_sections,
};

const pocket_package_source_v1 *package_source(void) { return &SOURCE; }

// ---------------------------------------------------------------------------
// admission
// ---------------------------------------------------------------------------

typedef struct {
  const PackageHost *host;
  AdmittedPackage candidate;
  pocket_idf_package_facts *facts;
} Admission;

/* Offer one variant: the source states its sections, and PocketJS admits
 * them as boot does. */
static int32_t admit(void *context, const PocketContainerVariant *variant,
                     uint32_t index) {
  (void)index;
  Admission *admission = context;
  admission->candidate.variant_hash = variant->variant_hash;
  admission->candidate.sections = variant->sections;
  memset(admission->facts, 0, sizeof *admission->facts);
  admission->facts->struct_size = sizeof *admission->facts;
  const PackageHost *host = admission->host;
  return pocket_idf_package_open_source(&SOURCE, &admission->candidate,
                                        host->facts, host->host_abi,
                                        host->profile_hash, admission->facts);
}

bool package_open(const uint8_t *bytes, size_t size, const PackageHost *host,
                  AdmittedPackage *out, pocket_idf_package_facts *facts,
                  char *error, size_t capacity) {
  /* POCKET_PACKAGE_OPEN_RASTER_DENSITY to _AUXILIARY: the first admission
   * item the first variant offered fails. */
  static const char *const ITEMS[] = {
      "raster density",    // 19
      "animation class",   // 20
      "tick rate",         // 21
      "viewport",          // 22
      "presentation",      // 23
      "capabilities",      // 24
      "auxiliary surface", // 25
  };
  PocketContainer container;
  int32_t code = pocket_container_open(bytes, size, &container);
  if (code == POCKET_PACKAGE_OPEN_BAD_MAGIC ||
      code == POCKET_PACKAGE_OPEN_BAD_VERSION) {
    snprintf(error, capacity, "the file is not a .pocket package (%ld)",
             (long)code);
    return false;
  }
  /* 0 is no hash: a load or an install that names hash 0 takes any
   * package. */
  if (code == POCKET_PACKAGE_OPEN_OK && container.package_hash == 0)
    code = POCKET_PACKAGE_OPEN_HASH_MISMATCH;
  if (code != POCKET_PACKAGE_OPEN_OK) {
    snprintf(error, capacity, "the package is damaged (%ld)", (long)code);
    return false;
  }
  if (container.variant_count == 0) {
    snprintf(error, capacity, "the package has no variant");
    return false;
  }
  Admission admission = {
      .host = host,
      .candidate = {.bytes = bytes,
                    .size = size,
                    .hash = container.package_hash},
      .facts = facts,
  };
  code = pocket_container_select(&container, host->profile_hash, admit,
                                 &admission, NULL);
  if (code == POCKET_PACKAGE_OPEN_OK) {
    *out = admission.candidate;
    return true;
  }
  if (code == POCKET_PACKAGE_OPEN_BINDING_GENERATION)
    snprintf(error, capacity,
             "the package was built for another binding generation");
  else if (code >= POCKET_PACKAGE_OPEN_RASTER_DENSITY &&
           code <= POCKET_PACKAGE_OPEN_AUXILIARY)
    snprintf(error, capacity, "%s does not provide the package's %s",
             host->target, ITEMS[code - POCKET_PACKAGE_OPEN_RASTER_DENSITY]);
  else
    snprintf(error, capacity, "the package is damaged (%ld)", (long)code);
  return false;
}

// ---------------------------------------------------------------------------
// the worker's sections
// ---------------------------------------------------------------------------

bool package_worker(const AdmittedPackage *package, const char **source,
                    size_t *length) {
  const pocket_package_sections *sections = &package->sections;
  if (sections->worker_js_length < 2 ||
      package->bytes[sections->worker_js_offset + sections->worker_js_length -
                     1] != 0)
    return false;
  *source = (const char *)package->bytes + sections->worker_js_offset;
  *length = sections->worker_js_length - 1;
  return true;
}

bool package_worker_bytecode(const AdmittedPackage *package,
                             const uint8_t **envelope, size_t *length) {
  const pocket_package_sections *sections = &package->sections;
  if (sections->worker_bytecode_length == 0)
    return false;
  *envelope = package->bytes + sections->worker_bytecode_offset;
  *length = sections->worker_bytecode_length;
  return true;
}
