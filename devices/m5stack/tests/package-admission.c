/* SPDX-License-Identifier: GPL-3.0-or-later */
/* A stand-in for PocketJS's pocket_idf_package_open_source
 * (pocket/package_facts.h) that tests/package.c links on the build machine.
 * It reads the package source as the runtime's admission reads a source
 * with stated sections: the table, length, then sections, then all; a source
 * that does not supply them is POCKET_PACKAGE_OPEN_SOURCE, a section outside
 * the bytes POCKET_PACKAGE_OPEN_BAD_LAYOUT and a binding generation other
 * than the host's POCKET_PACKAGE_OPEN_BINDING_GENERATION. It records the plan
 * offset of every variant offered (test_offered).
 *
 * The plans of tests/package.test.ts decide the rest:
 * {"app":{"id":"<id>"},"admit":<code>} is admitted when <code> is 0, with
 * the slot of <id>, and refused with <code> otherwise. */

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

#include "pocket/package_facts.h"
#include "sha256.h"

extern size_t test_offered[64];
extern size_t test_offered_count;

static bool within(size_t offset, size_t length, size_t size) {
  return offset <= size && length <= size - offset;
}

/* The text after `key` in `plan`, or NULL. */
static const char *after(const char *plan, const char *key) {
  const char *at = strstr(plan, key);
  return at != NULL ? at + strlen(key) : NULL;
}

int32_t pocket_idf_package_open_source(const pocket_package_source_v1 *source,
                                       void *context,
                                       const pocket_profile_facts *facts,
                                       uint32_t host_abi,
                                       const uint8_t *profile_hash,
                                       pocket_idf_package_facts *out) {
  (void)profile_hash;
  if (source == NULL || source->struct_size < sizeof *source ||
      source->length == NULL || source->range == NULL || facts == NULL ||
      out == NULL || out->struct_size < sizeof *out)
    return POCKET_PACKAGE_OPEN_BAD_ARGUMENT;
  size_t length = 0;
  pocket_package_sections sections;
  memset(&sections, 0, sizeof sections);
  sections.struct_size = sizeof sections;
  const uint8_t *bytes = NULL;
  size_t all = 0;
  if (source->length(context, &length) != POCKET_STATUS_OK ||
      source->sections == NULL ||
      source->sections(context, &sections) != POCKET_STATUS_OK ||
      source->all == NULL ||
      source->all(context, &bytes, &all) != POCKET_STATUS_OK || all != length ||
      sections.plan_length == 0)
    return POCKET_PACKAGE_OPEN_SOURCE;
  if (test_offered_count < 64)
    test_offered[test_offered_count++] = sections.plan_offset;
  if (!within(sections.plan_offset, sections.plan_length, length) ||
      !within(sections.js_offset, sections.js_length, length) ||
      !within(sections.pak_offset, sections.pak_length, length) ||
      !within(sections.bytecode_offset, sections.bytecode_length, length) ||
      !within(sections.worker_js_offset, sections.worker_js_length, length) ||
      !within(sections.worker_bytecode_offset, sections.worker_bytecode_length,
              length))
    return POCKET_PACKAGE_OPEN_BAD_LAYOUT;
  if (sections.host_abi != host_abi)
    return POCKET_PACKAGE_OPEN_BINDING_GENERATION;
  char plan[1024];
  if (sections.plan_length >= sizeof plan)
    return POCKET_PACKAGE_OPEN_PLAN_JSON;
  memcpy(plan, bytes + sections.plan_offset, sections.plan_length);
  plan[sections.plan_length] = '\0';
  const char *admit = after(plan, "\"admit\":");
  const char *id = after(plan, "\"app\":{\"id\":\"");
  const char *end = id != NULL ? strchr(id, '"') : NULL;
  if (admit == NULL)
    return POCKET_PACKAGE_OPEN_PLAN_JSON;
  const int32_t code = (int32_t)strtol(admit, NULL, 10);
  if (code != POCKET_PACKAGE_OPEN_OK)
    return code;
  if (end == NULL || end == id)
    return POCKET_PACKAGE_OPEN_NO_IDENTITY;
  memset(out, 0, sizeof *out);
  out->struct_size = sizeof *out;
  out->plan = bytes + sections.plan_offset;
  out->plan_length = sections.plan_length;
  if (sections.js_length != 0) {
    out->javascript = bytes + sections.js_offset;
    out->javascript_length = sections.js_length;
  }
  if (sections.pak_length != 0) {
    out->pak = bytes + sections.pak_offset;
    out->pak_length = sections.pak_length;
  }
  sha256_slot(id, (size_t)(end - id), out->slot);
  return POCKET_PACKAGE_OPEN_OK;
}
