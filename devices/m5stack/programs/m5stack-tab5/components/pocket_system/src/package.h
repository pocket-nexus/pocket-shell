/* SPDX-License-Identifier: GPL-3.0-or-later */
#pragma once

/*
 * A `.pocket` the firmware admits and boots. package_open verifies the
 * whole container with the shared reader (devices/services
 * pocket_container.h), offers its variants to PocketJS's admission in the
 * order runtime/spec/admission.ts selects them, each through package_source
 * stating that variant's sections (pocket_idf_package_open_source), and
 * keeps the variant admission took. The runtime boots the same source: it
 * reads the stated sections in place and checks no container hash, so the
 * reader's hash pass is the only one.
 *
 * No ESP-IDF API: tests/package.c builds this file on the build machine.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "pocket/package_facts.h"
#include "pocket_container.h"

/* The host facts packages are admitted against. */
typedef struct {
  /* The host id, for messages. */
  const char *target;
  const pocket_profile_facts *facts;
  uint32_t host_abi;
  /* 32 bytes or NULL: the variants compiled against it are offered first. */
  const uint8_t *profile_hash;
} PackageHost;

/* An admitted package: the whole container, read in place, and the variant
 * admission took. The context of package_source. */
typedef struct {
  const uint8_t *bytes;
  size_t size;
  /* The container's footer (FNV-1a64 of the bytes before it): the store,
   * app.txt and the link name the package by it. Never 0. */
  uint64_t hash;
  /* The admitted variant's payload hash and sections. */
  uint64_t variant_hash;
  pocket_package_sections sections;
} AdmittedPackage;

/* Verify `bytes` and admit its first variant `host` provides. On success
 * `out` and `facts` describe it; `facts` borrows `bytes`. Otherwise `error`
 * says why. */
bool package_open(const uint8_t *bytes, size_t size, const PackageHost *host,
                  AdmittedPackage *out, pocket_idf_package_facts *facts,
                  char *error, size_t capacity);

/* The store slot of an admitted package: the first 16 hex digits of
 * SHA-256 of its app id (`facts->app_id`), NUL-terminated. */
void package_slot(const pocket_idf_package_facts *facts, char slot[17]);

/* Whether the admitted variant's plan turns the capability `name` on, a
 * PocketJS id or one of Pocket Shell's (runtime/spec/capabilities.ts):
 * pocket_idf_package_feature, false when it gives no answer. */
bool package_feature(const pocket_idf_package_facts *facts, const char *name);

/* The package source of an AdmittedPackage (the context): length, the whole
 * container through all, range and take, and the admitted variant's
 * sections. take hands the runtime the bytes in place with no release, so
 * they outlive the runtime. */
const pocket_package_source_v1 *package_source(void);

/* Section 8 of the admitted variant, the worker source without its NUL
 * terminator; false when the variant has none. */
bool package_worker(const AdmittedPackage *package, const char **source,
                    size_t *length);
/* Section 9 of the admitted variant, the worker bytecode envelope; false
 * when the variant has none. */
bool package_worker_bytecode(const AdmittedPackage *package,
                             const uint8_t **envelope, size_t *length);
