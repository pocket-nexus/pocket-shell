#pragma once

/*
 * Pocket Link 2 on the Tab5 (devices/services/link2.h, pocketjs
 * docs/POCKET-LINK.md): the firmware's one client to a paired Hub, its
 * platform and what the firmware supplies to it.
 *
 * The groups the firmware lists (§6.1):
 *
 *   apps              the installed set, from the launcher's table
 *   runtime           runtime.status, runtime.launch of an installed app,
 *                     and runtime.push into the apps partition (below); a
 *                     screenshot answers `unsupported`
 *   runtime.remove    Hub's removal of an installed applet (link2_guest.c)
 *   catalog, install  the store of `globalThis.link` (link2_guest.c)
 *   net.http          the worker's requests to companion.pocket
 *                     (companion.c over link2_http.c)
 *
 * It opens no applet channel, runs no agent and has no DevTools stream.
 *
 * A push (§6.2 runtime.push) streams into the stage of the apps partition,
 * as a catalog install does, and is admitted for the slot its own app id
 * names: the request carries no id, so the slot is known only once the
 * package is whole. It is committed there and the launcher switches to it;
 * the reply leaves at the first frame of the app it installed. The running
 * app reads its package from flash where it lies, and a commit frees those
 * pages, so a push of the running app waits, admitted and uncommitted, until
 * that guest is torn down (link2_host_guest_end) and then boots the new
 * package in its place.
 *
 * The Tab5 pairs by a code it shows (§3.11): the client asks the Hub its
 * owner chose, and writes `companions/<hub id>.txt` under
 * link_host_directory() from that Hub's offer (link2_guest.h: pairOpen,
 * pairAsk, pairClose). A Hub can also write `device.txt` and its key file
 * there itself (§3.2), and the client reads them when it starts.
 *
 * No IDF dependency: the sockets are BSD sockets (link2_bsd.c, which lwIP
 * provides) and every other platform call goes through host_services.h, so
 * tests/link-host.c builds this file on the build machine.
 *
 * Every function runs on the link's owner, the system task.
 */

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "host_services.h"
#include "link2.h"

typedef struct {
  /* The launcher's package: the home row of runtime.apps. */
  const LauncherPackage *home;
  /* The binding generation a package must match. */
  uint32_t host_abi;
  /* The UDP port beacons arrive on; 0 reads as the link's own, 8627. */
  uint16_t beacon_port;
  /* Told each time the link comes up (`hub` is its name) or goes down
   * (`hub` is NULL and `why` the reason). May be NULL. */
  void (*report)(const char *hub, const char *why);
} Link2HostConfig;

/* After launcher_init: reads the pairing files and starts searching. */
void link2_host_init(const Link2HostConfig *config);
/* Once per frame. */
void link2_host_pump(void);
/* A guest booted from `package`: runtime.status names it from here on. */
void link2_host_guest_begin(const LauncherPackage *package);
/* A guest is torn down: its HTTP streams, its undelivered link events and
 * its catalog waiters go. The connection stays, and so does an install that
 * is streaming into storage. */
void link2_host_guest_end(void);
/* The installed set changed outside the link (an install from a code). */
void link2_host_apps_changed(void);
/* Inside link_host_staging_path: the size the Hub declared for the install
 * whose staging file the engine is about to open. 0 outside it. */
uint32_t link2_host_install_bytes(void);
/* The client, NULL when it could not be created. */
Link2 *link2_host_client(void);
/* Close the link with CLOSE `going_away` and free the client: a host that
 * stops (the build machine's harness). The firmware never stops. */
void link2_host_shutdown(void);

/* --- what the store supplies for runtime.push (services_host.c) ---------- */

/* Set the stage of the apps partition aside for a package of `bytes`.
 * False with `failure`: `busy` while an install streams into the stage,
 * `storage` without the partition or without a run of free pages that
 * holds the package. */
bool store_push_begin(uint32_t bytes, Link2Failure *failure);
/* The next bytes of the stage; false when flash refused them. */
bool store_push_write(const uint8_t *bytes, size_t length);
/* Drop the stage: its pages stay free. */
void store_push_abort(void);
/* Admit the whole stage by the firmware's host facts: its footer must be
 * `hash`. Fills the slot its app id names and its facts, which stay valid
 * after the commit (the package is committed where it lies). False with
 * `failure` `rejected` (and the stage dropped) when it is not a package
 * this firmware runs, or when its slot holds a package bundled into the
 * firmware (the launcher's among them). Nothing is committed. */
bool store_push_admit(uint64_t hash, char slot[17], LauncherPackage *facts,
                      Link2Failure *failure);
/* Commit the admitted stage as its slot's package, replacing the one it
 * had. Never while that slot's guest runs. The stage is gone afterwards
 * either way; false with `failure` `storage`. */
bool store_push_commit(Link2Failure *failure);
