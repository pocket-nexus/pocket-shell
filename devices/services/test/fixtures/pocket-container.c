/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Probe of devices/services/pocket_container.c for
 * test/pocket-container-c.test.ts, one command per run:
 *
 *   pocket-container open <file>
 *     one JSON line: the open code and, when it is 0, the package hash, the
 *     manifest span and every variant's facts and section spans
 *   pocket-container select <file> <profile-hash-hex|-> <admitted-target>...
 *     one JSON line: the variants offered in order, the code and the chosen
 *     index; a variant is admitted when its target is listed, and refused
 *     with POCKET_PACKAGE_OPEN_VIEWPORT otherwise
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "pocket_container.h"

static unsigned char *slurp(const char *path, size_t *length) {
  FILE *file = fopen(path, "rb");
  if (file == NULL) return NULL;
  fseek(file, 0, SEEK_END);
  long size = ftell(file);
  fseek(file, 0, SEEK_SET);
  /* An exact allocation, so ASan sees a read past the end. */
  unsigned char *bytes = malloc(size > 0 ? (size_t)size : 1u);
  if (bytes == NULL || fread(bytes, 1, (size_t)size, file) != (size_t)size) exit(3);
  fclose(file);
  *length = (size_t)size;
  return bytes;
}

static void span(const char *name, size_t offset, size_t length, int comma) {
  printf("\"%s\":[%zu,%zu]%s", name, offset, length, comma ? "," : "");
}

typedef struct {
  int argc;
  char **argv;
  int offered;
} Admit;

static int32_t admit(void *context, const PocketContainerVariant *variant, uint32_t index) {
  Admit *state = context;
  printf("%s%u", state->offered++ ? "," : "", index);
  for (int i = 0; i < state->argc; ++i) {
    if (strlen(state->argv[i]) == variant->target_length &&
        memcmp(state->argv[i], variant->target, variant->target_length) == 0)
      return POCKET_PACKAGE_OPEN_OK;
  }
  return POCKET_PACKAGE_OPEN_VIEWPORT;
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  size_t length = 0;
  unsigned char *bytes = slurp(argv[2], &length);
  if (bytes == NULL) return 2;
  PocketContainer container;
  const int32_t code = pocket_container_open(bytes, length, &container);
  if (strcmp(argv[1], "open") == 0) {
    printf("{\"code\":%d", (int)code);
    if (code == POCKET_PACKAGE_OPEN_OK) {
      printf(",\"hash\":\"%016llx\",", (unsigned long long)container.package_hash);
      span("manifest", (size_t)(container.manifest - bytes), container.manifest_length, 1);
      printf("\"variants\":[");
      for (uint32_t i = 0; i < container.variant_count; ++i) {
        PocketContainerVariant v;
        if (!pocket_container_variant(&container, i, &v)) return 4;
        printf("%s{\"target\":\"%.*s\",\"hostAbi\":%u,\"hash\":\"%016llx\",\"profile\":\"", i ? "," : "",
               (int)v.target_length, (const char *)v.target, v.host_abi, (unsigned long long)v.variant_hash);
        for (int k = 0; k < 32; ++k) printf("%02x", v.profile_hash[k]);
        printf("\",\"sectionsAbi\":%u,\"structSize\":%s,", v.sections.host_abi,
               v.sections.struct_size == sizeof v.sections ? "true" : "false");
        span("1", v.identity_offset, v.identity_length, 1);
        span("2", v.sections.plan_offset, v.sections.plan_length, 1);
        span("3", v.sections.js_offset, v.sections.js_length, 1);
        span("4", v.sections.pak_offset, v.sections.pak_length, 1);
        span("5", v.cover_offset, v.cover_length, 1);
        span("6", v.sections.bytecode_offset, v.sections.bytecode_length, 1);
        span("7", v.host_inputs_offset, v.host_inputs_length, 1);
        span("8", v.sections.worker_js_offset, v.sections.worker_js_length, 1);
        span("9", v.sections.worker_bytecode_offset, v.sections.worker_bytecode_length, 0);
        printf("}");
      }
      printf("]");
    }
    printf("}\n");
  } else if (strcmp(argv[1], "select") == 0 && argc >= 4) {
    if (code != POCKET_PACKAGE_OPEN_OK) {
      printf("{\"open\":%d}\n", (int)code);
      free(bytes);
      return 0;
    }
    uint8_t hash[32];
    const uint8_t *profile = NULL;
    if (strcmp(argv[3], "-") != 0) {
      for (int k = 0; k < 32; ++k) {
        unsigned value;
        if (sscanf(argv[3] + 2 * k, "%2x", &value) != 1) return 2;
        hash[k] = (uint8_t)value;
      }
      profile = hash;
    }
    Admit state = {argc - 4, argv + 4, 0};
    uint32_t chosen = 0xffffffffu;
    printf("{\"offered\":[");
    const int32_t selected = pocket_container_select(&container, profile, admit, &state, &chosen);
    printf("],\"code\":%d,\"chosen\":%d}\n", (int)selected, chosen == 0xffffffffu ? -1 : (int)chosen);
  } else {
    return 2;
  }
  free(bytes);
  return 0;
}
