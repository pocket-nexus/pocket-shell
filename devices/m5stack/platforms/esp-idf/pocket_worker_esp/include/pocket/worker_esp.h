#pragma once
#include "esp_err.h"
#include "pocket/worker_quickjs.h"
#include <stdbool.h>

typedef struct pocket_worker_esp pocket_worker_esp;
typedef struct {
  uint32_t struct_size, generation;
  const pocket_worker_node *nodes;
  size_t node_count;
  /* The NUL-terminated bundle; NULL when the bundle is bytecode alone. */
  const char *source;
  size_t source_size;
  /* Optional: the bundle as a package bytecode section (section 9) and the
   * engine ABI of this QuickJS build (pocket_quickjs_abi.h). The runner
   * evaluates it instead of source when its digest matches, else source. */
  const uint8_t *bytecode;
  size_t bytecode_size;
  const uint8_t *engine_abi;
  uint32_t heap_limit, stack_limit, task_stack_size;
  /* Optional CPU share: at most quota_micros of JS per window_micros. Zero
   * quota disables it. Set it only when the worker task shares a core with
   * the UI task at a higher priority; FreeRTOS gives a lower-priority UI no
   * time against a busy worker. There is no execution time limit. */
  uint32_t window_micros, quota_micros;
  int task_core;
  unsigned task_priority;
  /* Bootstrap channels/resources, then wait for resume before executing turns.
   */
  bool defer_turns;
  /* heap_caps capabilities of the QuickJS allocations and of the task stack;
   * zero selects internal RAM. A PSRAM stack suits a worker whose nodes make
   * no flash or NVS calls. */
  uint32_t heap_caps, task_stack_caps;
} pocket_worker_esp_config;

/* Source, bytecode, node table and driver objects must outlive the runner. */
esp_err_t pocket_worker_esp_start(const pocket_worker_esp_config *config,
                                  pocket_worker_esp **out);
/* Stops JS dispatch, interrupting a turn in progress, joins all native users,
 * then destroys the realm. A timeout preserves the runner and its buffers;
 * call stop again to join. */
esp_err_t pocket_worker_esp_stop(pocket_worker_esp *worker,
                                 uint32_t timeout_ms);
/* Release a bootstrap-only runner after its UI owner finishes booting. */
void pocket_worker_esp_resume(pocket_worker_esp *worker);
bool pocket_worker_esp_failed(pocket_worker_esp *worker);

/* Channel bridges may borrow this core until stop. Detach every bridge before
 * stop, including when failed() is true. The core stays alive after a fault. */
pocket_worker *pocket_worker_esp_core(pocket_worker_esp *worker);
