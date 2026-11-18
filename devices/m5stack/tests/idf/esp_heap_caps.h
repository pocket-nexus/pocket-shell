/* heap_caps for tests/flash-store.c: the build machine has one heap. */
#pragma once

#include <stdlib.h>

#define MALLOC_CAP_8BIT (1u << 2)
#define MALLOC_CAP_INTERNAL (1u << 11)

static inline void *heap_caps_malloc(size_t size, unsigned caps) {
  (void)caps;
  return malloc(size);
}

static inline void heap_caps_free(void *block) { free(block); }
