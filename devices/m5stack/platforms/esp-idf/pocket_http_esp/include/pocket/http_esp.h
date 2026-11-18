#pragma once
#include "pocket/worker.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct pocket_http_esp pocket_http_esp;

/* One fact of a request the companion transport performs: the worker
 * protocol's kind (POCKET_WORKER_HEADERS, _DATA or _END), status, offset and
 * bytes. An END whose status is not POCKET_WORKER_OK may carry
 * "code: message", which the driver emits as the request's error fact. */
typedef struct {
  uint32_t kind;
  int32_t status;
  uint64_t offset;
  size_t length;
  uint8_t bytes[POCKET_WORKER_MAX_PAYLOAD];
} pocket_http_esp_fact;

/* The transport of the requests whose host is companion.pocket
 * (contracts/spec/link.ts LINK_SERVICES_HOST): the paired companion answers
 * them, over the Pocket Link on a console. The request tasks call it. */
typedef struct pocket_http_esp_companion {
  /* Send the request the descriptor (as opened) describes; its id, or 0
   * with "code: message" in `error`. */
  uint32_t (*start)(void *context, const uint8_t *descriptor, size_t length,
                    char *error, size_t capacity);
  /* Move the request's next fact into `fact`; false while none waits. After
   * the END fact the id is released. */
  bool (*take)(void *context, uint32_t id, pocket_http_esp_fact *fact);
  /* Cancel a request that has not ended and release its id. */
  void (*close)(void *context, uint32_t id);
  void *context;
} pocket_http_esp_companion;

typedef struct {
  uint32_t struct_size;
  /* True while the network has an address, or NULL. A request started while
   * it is false fails before it resolves its host. */
  bool (*online)(void *context);
  /* Waits at most `ms` for the wall clock and returns true once it is set,
   * or NULL when TLS does not check certificate dates. An https:// hop waits
   * through it within its request's timeout. */
  bool (*clock_wait)(void *context, uint32_t ms);
  void *context;
  /* User-Agent of a request that names none; NULL selects "PocketJS/1". */
  const char *user_agent;
  /* heap_caps capabilities of the request storage and of the request task
   * stacks; zero selects internal RAM. */
  uint32_t memory_caps, task_stack_caps;
  int task_core;
  unsigned task_priority;
  /* The transport of the requests to companion.pocket, or NULL to resolve
   * that host by DNS like any other. */
  const pocket_http_esp_companion *companion;
} pocket_http_esp_config;

pocket_http_esp *pocket_http_esp_create(const pocket_http_esp_config *config);
const pocket_worker_driver *pocket_http_esp_driver(pocket_http_esp *driver);
/* Call after the worker core has closed all handles. */
int32_t pocket_http_esp_destroy(pocket_http_esp *driver);

#ifdef __cplusplus
}
#endif
