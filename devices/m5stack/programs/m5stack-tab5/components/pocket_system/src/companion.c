#include "companion.h"

#include <stdio.h>
#include <string.h>

#include "jscan.h"
#include "link2_guest.h"
#include "link2_host.h"
#include "link_http.h"

/* net.http is in use: the link is up, both ends list the group, and the
 * connection's payload limit holds a request and its head (§6.5). */
static bool available(void) {
  const Link2 *link = link2_host_client();
  return link != NULL && link2_in_use(link, "net.http") &&
         link2_limit(link) >= LINK2_HTTP_MIN_PAYLOAD;
}

/* Why the link takes no request now, from the link's state. */
static void unavailable(char *error, size_t capacity) {
  const char *status = link2_guest_status_json();
  char state[16] = "";
  json_find_string(json_span(status, strlen(status)), "state", state,
                   sizeof state);
  if (strcmp(state, "unpaired") == 0)
    snprintf(error, capacity, "unavailable: no Mac is paired");
  else if (strcmp(state, "linked") == 0)
    snprintf(error, capacity,
             "unavailable: the paired Mac offers no companion services");
  else
    snprintf(error, capacity, "unavailable: the paired Mac is not connected");
}

uint32_t companion_start(const uint8_t *descriptor, size_t length, char *error,
                         size_t capacity) {
  if (!link_http_validate(descriptor, length)) {
    snprintf(error, capacity,
             "invalid_request: the Pocket Link cannot carry this request");
    return 0;
  }
  if (!available()) {
    unavailable(error, capacity);
    return 0;
  }
  const int32_t id = link_http_start(descriptor, length);
  if (id <= 0) {
    snprintf(error, capacity,
             "unavailable: the Pocket Link took no more requests");
    return 0;
  }
  return (uint32_t)id;
}

bool companion_take(uint32_t id, pocket_http_esp_fact *fact) {
  LinkHttpFact next;
  if (!link_http_peek(id, &next))
    return false;
  fact->kind = next.kind;
  fact->status = next.status;
  fact->offset = next.offset;
  fact->length =
      next.length < sizeof fact->bytes ? next.length : sizeof fact->bytes;
  if (fact->length)
    memcpy(fact->bytes, next.bytes, fact->length);
  if (next.kind == POCKET_WORKER_END && next.status != POCKET_WORKER_OK) {
    /* The link client keeps no reason: a closed link fails every open
     * request, and an error reply or a malformed answer ends one. */
    const char *reason = !available() ? "unavailable: the Pocket Link closed"
                         : next.status == POCKET_WORKER_FAILED
                             ? "protocol: the Mac's answer was malformed"
                             : "other: the Mac could not complete the request";
    const int n =
        snprintf((char *)fact->bytes, sizeof fact->bytes, "%s", reason);
    fact->length = n > 0 ? (size_t)n : 0;
  }
  link_http_consume(id);
  return true;
}

void companion_close(uint32_t id) { link_http_close(id); }
