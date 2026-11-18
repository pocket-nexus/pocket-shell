#pragma once

/*
 * The worker's requests to companion.pocket over the Pocket Link: the
 * pocket_http_esp companion transport on engine/host-services/link2_http.c,
 * the worker's HTTP stream on Pocket Link 2's `net.http` (pocketjs
 * docs/POCKET-LINK.md §6.5). The paired Hub performs each request, and
 * answers companion.pocket itself while it serves that origin (§11).
 *
 * Every function runs on the link's owner, the system task; the request
 * tasks reach them through system_run (services_host.c). No IDF dependency:
 * tests/link-host.c builds this file with link2_host.c and the link
 * client on the build machine.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "pocket/http_esp.h"

/* Send the descriptor as a net.http request; its id, or 0 with
 * "code: message" in `error`: `unavailable` when no Hub is paired, the
 * paired one is not linked or net.http is not in use on the connection (Hub
 * does not list it, or the payload limit is under 12,288 bytes),
 * `invalid_request` when the link client refuses the descriptor. */
uint32_t companion_start(const uint8_t *descriptor, size_t length, char *error,
                         size_t capacity);
/* Copy the request's next fact and release it in the link client; false
 * while none waits. An END that is not POCKET_WORKER_OK carries
 * "code: message". */
bool companion_take(uint32_t id, pocket_http_esp_fact *fact);
/* Cancel a request that has not ended and release its id. */
void companion_close(uint32_t id);
