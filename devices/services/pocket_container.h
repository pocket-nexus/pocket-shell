/* SPDX-License-Identifier: GPL-3.0-or-later */
/*
 * The `.pocket` container, format 2 (runtime/spec/pocket-package.ts,
 * docs/POCKET-PACKAGE.md), for the device programs: a reader that verifies
 * a whole file in memory and states where a variant's sections lie, so a
 * program hands PocketJS a package source with a `sections` callback
 * (pocket_package_source_v1) and PocketJS admits and boots that variant.
 * PocketJS checks no container hash for stated sections; this reader checks
 * the footer and every variant's payload hash before it states any.
 *
 * Portable C with no allocation: the 3DS program (devices/3ds) and the Tab5
 * firmware (devices/m5stack) compile it, and test/pocket-container-c.test.ts
 * compiles it on the build machine against the TypeScript codec and the
 * admission corpus (runtime/test/fixtures/admission).
 */

#ifndef POCKETJS_POCKET_CONTAINER_H
#define POCKETJS_POCKET_CONTAINER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include <pocket_runtime.h>

#define POCKET_CONTAINER_MAGIC 0x544b4350u /* "PCKT" as LE u32 */
#define POCKET_CONTAINER_VERSION 2u
#define POCKET_CONTAINER_HEADER_BYTES 32u
#define POCKET_CONTAINER_VARIANT_BYTES 64u
#define POCKET_CONTAINER_SECTION_BYTES 16u
#define POCKET_CONTAINER_FOOTER_BYTES 8u

/* Section kinds (runtime/spec/pocket-package.ts POCKET_SECTION). */
enum {
  POCKET_CONTAINER_IDENTITY = 1,
  POCKET_CONTAINER_PLAN = 2,
  POCKET_CONTAINER_JS = 3,
  POCKET_CONTAINER_PAK = 4,
  POCKET_CONTAINER_COVER = 5,
  POCKET_CONTAINER_BYTECODE = 6,
  POCKET_CONTAINER_HOST_INPUTS = 7,
  POCKET_CONTAINER_WORKER_JS = 8,
  POCKET_CONTAINER_WORKER_BYTECODE = 9,
};

/* A verified container. Pointers borrow the caller's bytes. */
typedef struct {
  const uint8_t *bytes;
  size_t length;
  /* The footer: FNV-1a64 over every byte before it. A program that names
   * stored packages by it and reserves 0 checks that itself. */
  uint64_t package_hash;
  const uint8_t *manifest;
  size_t manifest_length;
  uint32_t variant_count;
  /* Offset of variant 0's directory entry. */
  size_t variant_table;
} PocketContainer;

/* One variant of a verified container. Offsets count from the container's
 * first byte; a length of zero means the section is absent. `sections`
 * is what a package source's `sections` callback states for this variant
 * (struct_size and host_abi filled in). */
typedef struct {
  const uint8_t *target; /* UTF-8, not NUL-terminated */
  size_t target_length;
  uint32_t host_abi;
  uint64_t variant_hash; /* FNV-1a64 over the variant's section payloads */
  const uint8_t *profile_hash; /* 32 bytes */
  pocket_package_sections sections;
  size_t identity_offset, identity_length;
  size_t cover_offset, cover_length;
  size_t host_inputs_offset, host_inputs_length;
} PocketContainerVariant;

/* FNV-1a64 of `length` bytes, continuing from `hash` (start with
 * POCKET_CONTAINER_FNV_OFFSET). */
#define POCKET_CONTAINER_FNV_OFFSET 0xcbf29ce484222325ull
uint64_t pocket_container_fnv1a64(uint64_t hash, const uint8_t *bytes, size_t length);

/* Verify a whole container: header, layout (the exact ordering the encoder
 * writes), target ids, footer hash and every variant's payload hash.
 * Returns POCKET_PACKAGE_OPEN_OK, or TRUNCATED, BAD_MAGIC, BAD_VERSION,
 * HASH_MISMATCH, BAD_UTF8, BAD_LAYOUT, BAD_ARGUMENT for a null argument.
 * `out` is written only on success. */
int32_t pocket_container_open(const uint8_t *bytes, size_t length, PocketContainer *out);

/* Variant `index` (< variant_count) of a container pocket_container_open
 * accepted. */
bool pocket_container_variant(const PocketContainer *container, uint32_t index,
                              PocketContainerVariant *out);

/* Admit one variant: the program offers `variant` to PocketJS (a package
 * source stating `variant->sections`) and returns its POCKET_PACKAGE_OPEN_*
 * code. */
typedef int32_t (*pocket_container_admit_fn)(void *context, const PocketContainerVariant *variant,
                                              uint32_t index);

/* Offer the variants to `admit` in the order runtime/spec/admission.ts
 * selects them: the variants whose profile hash equals `profile_hash` (32
 * bytes, or NULL for none) first, then the others, each group in file
 * order; the first OK wins and its index goes to `chosen`. Otherwise the
 * code of the first variant offered, or POCKET_PACKAGE_OPEN_SOURCE for a
 * container without variants. */
int32_t pocket_container_select(const PocketContainer *container, const uint8_t *profile_hash,
                                pocket_container_admit_fn admit, void *context, uint32_t *chosen);

#endif
