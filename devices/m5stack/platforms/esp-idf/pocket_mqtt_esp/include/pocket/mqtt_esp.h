#pragma once
#include "pocket/worker.h"
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct pocket_mqtt_esp pocket_mqtt_esp;

typedef struct {
  uint32_t struct_size;
  /* True while the network has an address, or NULL. A connect failure while
   * it is false reports `unavailable`. */
  bool (*online)(void *context);
  /* Waits at most `ms` for the wall clock and returns true once it is set,
   * or NULL when TLS does not check certificate dates. A secure session
   * waits through it before its first connect. */
  bool (*clock_wait)(void *context, uint32_t ms);
  void *context;
  /* heap_caps capabilities of session storage (descriptor, staging buffer,
   * TLS material, record buffers) and of the control task stacks; zero
   * selects internal RAM. */
  uint32_t memory_caps, task_stack_caps;
  int task_core;
  /* Priority of the control tasks and of the esp-mqtt client tasks. */
  unsigned task_priority, client_priority;
  /* Stack of each esp-mqtt client task; zero selects 8192 bytes. */
  uint32_t client_stack;
} pocket_mqtt_esp_config;

pocket_mqtt_esp *pocket_mqtt_esp_create(const pocket_mqtt_esp_config *config);
const pocket_worker_driver *pocket_mqtt_esp_driver(pocket_mqtt_esp *driver);
/* Call after the worker core has closed all handles. */
int32_t pocket_mqtt_esp_destroy(pocket_mqtt_esp *driver);

#ifdef __cplusplus
}
#endif
