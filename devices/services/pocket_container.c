/* SPDX-License-Identifier: GPL-3.0-or-later */
/* The `.pocket` container reader (pocket_container.h). The checks are those
 * of decodePocketPackage in runtime/spec/pocket-package.ts, in its order. */

#include "pocket_container.h"

#include <string.h>

#define ALIGN 16u
#define FNV_PRIME 0x100000001b3ull
#define TARGET_MAX_BYTES 65535u

static uint32_t le32(const uint8_t *p) {
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}

static uint64_t le64(const uint8_t *p) { return (uint64_t)le32(p) | (uint64_t)le32(p + 4) << 32; }

/* Round up to 16 in 64 bits: every offset below fits a u32, so no sum
 * overflows. */
static uint64_t align16(uint64_t n) { return (n + (ALIGN - 1u)) / ALIGN * ALIGN; }

uint64_t pocket_container_fnv1a64(uint64_t hash, const uint8_t *bytes, size_t length) {
  for (size_t i = 0; i < length; ++i) {
    hash ^= bytes[i];
    hash *= FNV_PRIME;
  }
  return hash;
}

/* Strict UTF-8 (no overlongs, surrogates or code points above U+10FFFF),
 * as TextDecoder's fatal mode reads it. */
static bool utf8(const uint8_t *s, size_t n) {
  size_t i = 0;
  while (i < n) {
    const uint8_t c = s[i];
    size_t extra;
    uint32_t point;
    if (c < 0x80) {
      i += 1;
      continue;
    } else if (c >= 0xc2 && c <= 0xdf) {
      extra = 1;
      point = c & 0x1fu;
    } else if (c >= 0xe0 && c <= 0xef) {
      extra = 2;
      point = c & 0x0fu;
    } else if (c >= 0xf0 && c <= 0xf4) {
      extra = 3;
      point = c & 0x07u;
    } else {
      return false;
    }
    if (n - i <= extra) return false;
    for (size_t k = 1; k <= extra; ++k) {
      if ((s[i + k] & 0xc0u) != 0x80u) return false;
      point = point << 6 | (s[i + k] & 0x3fu);
    }
    if ((extra == 2 && (point < 0x800u || (point >= 0xd800u && point <= 0xdfffu))) ||
        (extra == 3 && (point < 0x10000u || point > 0x10ffffu)))
      return false;
    i += extra + 1;
  }
  return true;
}

/* -1, 0 or 1 as memcmp of the common prefix, then the shorter first. */
static int compare(const uint8_t *a, size_t an, const uint8_t *b, size_t bn) {
  const int c = memcmp(a, b, an < bn ? an : bn);
  if (c != 0) return c;
  return an < bn ? -1 : an > bn ? 1 : 0;
}

int32_t pocket_container_open(const uint8_t *bytes, size_t length, PocketContainer *out) {
  if (bytes == NULL || out == NULL) return POCKET_PACKAGE_OPEN_BAD_ARGUMENT;
  if (length < 8) return POCKET_PACKAGE_OPEN_TRUNCATED;
  if (le32(bytes) != POCKET_CONTAINER_MAGIC) return POCKET_PACKAGE_OPEN_BAD_MAGIC;
  if (le32(bytes + 4) != POCKET_CONTAINER_VERSION) return POCKET_PACKAGE_OPEN_BAD_VERSION;
  if (length < POCKET_CONTAINER_HEADER_BYTES + POCKET_CONTAINER_FOOTER_BYTES || length > 0xffffffffu)
    return POCKET_PACKAGE_OPEN_TRUNCATED;
  const uint64_t end = length - POCKET_CONTAINER_FOOTER_BYTES;
  const uint64_t footer = le64(bytes + end);
  if (footer != pocket_container_fnv1a64(POCKET_CONTAINER_FNV_OFFSET, bytes, (size_t)end))
    return POCKET_PACKAGE_OPEN_HASH_MISMATCH;
  if (le32(bytes + 24) != 0 || le32(bytes + 28) != 0) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;

  const uint64_t manifest_length = le32(bytes + 8);
  const uint64_t variants = le32(bytes + 12);
  if (POCKET_CONTAINER_HEADER_BYTES + manifest_length > end) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
  const uint64_t table = align16(POCKET_CONTAINER_HEADER_BYTES + manifest_length);
  const uint64_t strings = le32(bytes + 16), strings_size = le32(bytes + 20);
  if (strings != table + variants * POCKET_CONTAINER_VARIANT_BYTES || strings + strings_size > end)
    return POCKET_PACKAGE_OPEN_BAD_LAYOUT;

  /* The directory: target ids in order, section tables back to back. */
  uint64_t string_cursor = strings;
  uint64_t table_cursor = align16(strings + strings_size);
  const uint8_t *previous = NULL;
  size_t previous_length = 0;
  for (uint64_t v = 0; v < variants; ++v) {
    const uint8_t *entry = bytes + table + v * POCKET_CONTAINER_VARIANT_BYTES;
    if (le32(entry + 20) != 0) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
    const uint64_t offset = le32(entry), size = le32(entry + 4);
    if (offset != string_cursor || size == 0 || size > TARGET_MAX_BYTES ||
        size > strings + strings_size - offset)
      return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
    const uint8_t *name = bytes + offset;
    if (memchr(name, 0, (size_t)size) != NULL ||
        (previous != NULL && compare(previous, previous_length, name, (size_t)size) >= 0))
      return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
    if (!utf8(name, (size_t)size)) return POCKET_PACKAGE_OPEN_BAD_UTF8;
    previous = name;
    previous_length = (size_t)size;
    string_cursor += size;
    const uint64_t count = le32(entry + 12), sections = le32(entry + 16);
    if (sections != table_cursor || table_cursor > end ||
        count * POCKET_CONTAINER_SECTION_BYTES > end - table_cursor)
      return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
    table_cursor += count * POCKET_CONTAINER_SECTION_BYTES;
  }
  if (string_cursor != strings + strings_size) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;

  /* The payloads: contiguous in variant and section order, each padded to
   * 16, and each variant's hash over its payloads. */
  uint64_t payload_cursor = align16(table_cursor);
  for (uint64_t v = 0; v < variants; ++v) {
    const uint8_t *entry = bytes + table + v * POCKET_CONTAINER_VARIANT_BYTES;
    const uint64_t count = le32(entry + 12), sections = le32(entry + 16);
    uint64_t hash = POCKET_CONTAINER_FNV_OFFSET;
    int64_t previous_kind = -1;
    for (uint64_t s = 0; s < count; ++s) {
      const uint8_t *section = bytes + sections + s * POCKET_CONTAINER_SECTION_BYTES;
      const uint32_t kind = le32(section);
      if ((int64_t)kind <= previous_kind || le32(section + 4) != 0) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
      previous_kind = kind;
      const uint64_t offset = le32(section + 8), size = le32(section + 12);
      if (offset != payload_cursor || offset > end || size > end - offset)
        return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
      hash = pocket_container_fnv1a64(hash, bytes + offset, (size_t)size);
      payload_cursor = align16(offset + size);
    }
    if (hash != le64(entry + 24)) return POCKET_PACKAGE_OPEN_HASH_MISMATCH;
  }
  if (payload_cursor != end) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;

  out->bytes = bytes;
  out->length = length;
  out->package_hash = footer;
  out->manifest = bytes + POCKET_CONTAINER_HEADER_BYTES;
  out->manifest_length = (size_t)manifest_length;
  out->variant_count = (uint32_t)variants;
  out->variant_table = (size_t)table;
  return POCKET_PACKAGE_OPEN_OK;
}

bool pocket_container_variant(const PocketContainer *container, uint32_t index,
                              PocketContainerVariant *out) {
  if (container == NULL || out == NULL || index >= container->variant_count) return false;
  const uint8_t *bytes = container->bytes;
  const uint8_t *entry = bytes + container->variant_table + (size_t)index * POCKET_CONTAINER_VARIANT_BYTES;
  memset(out, 0, sizeof *out);
  out->target = bytes + le32(entry);
  out->target_length = le32(entry + 4);
  out->host_abi = le32(entry + 8);
  out->variant_hash = le64(entry + 24);
  out->profile_hash = entry + 32;
  out->sections.struct_size = sizeof out->sections;
  out->sections.host_abi = out->host_abi;
  const uint32_t count = le32(entry + 12), table = le32(entry + 16);
  for (uint32_t s = 0; s < count; ++s) {
    const uint8_t *section = bytes + table + (size_t)s * POCKET_CONTAINER_SECTION_BYTES;
    const size_t offset = le32(section + 8), size = le32(section + 12);
    switch (le32(section)) {
    case POCKET_CONTAINER_IDENTITY: out->identity_offset = offset, out->identity_length = size; break;
    case POCKET_CONTAINER_PLAN: out->sections.plan_offset = offset, out->sections.plan_length = size; break;
    case POCKET_CONTAINER_JS: out->sections.js_offset = offset, out->sections.js_length = size; break;
    case POCKET_CONTAINER_PAK: out->sections.pak_offset = offset, out->sections.pak_length = size; break;
    case POCKET_CONTAINER_COVER: out->cover_offset = offset, out->cover_length = size; break;
    case POCKET_CONTAINER_BYTECODE:
      out->sections.bytecode_offset = offset, out->sections.bytecode_length = size;
      break;
    case POCKET_CONTAINER_HOST_INPUTS: out->host_inputs_offset = offset, out->host_inputs_length = size; break;
    case POCKET_CONTAINER_WORKER_JS:
      out->sections.worker_js_offset = offset, out->sections.worker_js_length = size;
      break;
    case POCKET_CONTAINER_WORKER_BYTECODE:
      out->sections.worker_bytecode_offset = offset, out->sections.worker_bytecode_length = size;
      break;
    default: break; /* unknown kinds are data */
    }
  }
  return true;
}

int32_t pocket_container_select(const PocketContainer *container, const uint8_t *profile_hash,
                                pocket_container_admit_fn admit, void *context, uint32_t *chosen) {
  if (container == NULL || admit == NULL) return POCKET_PACKAGE_OPEN_BAD_ARGUMENT;
  int32_t first = POCKET_PACKAGE_OPEN_SOURCE;
  bool offered = false;
  /* Pass 0 offers the variants compiled against this host's profile hash,
   * pass 1 the rest. */
  for (int pass = 0; pass < 2; ++pass) {
    for (uint32_t i = 0; i < container->variant_count; ++i) {
      PocketContainerVariant variant;
      if (!pocket_container_variant(container, i, &variant)) return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
      const bool own = profile_hash != NULL && memcmp(variant.profile_hash, profile_hash, 32) == 0;
      if (own != (pass == 0)) continue;
      const int32_t code = admit(context, &variant, i);
      if (code == POCKET_PACKAGE_OPEN_OK) {
        if (chosen != NULL) *chosen = i;
        return code;
      }
      if (!offered) first = code;
      offered = true;
    }
  }
  return first;
}
