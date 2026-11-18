#pragma once
/* The Tab5's camera and speaker behind globalThis.camera and media
 * (pocket_camera, pocket_media), for the launcher firmware. */
#include <stdbool.h>
#include <stdint.h>

#include "pocket_runtime.h"
#include "quickjs.h"

/* Once, before the first guest: the store at /pocket is the flash partition
 * (no card), whose reads and writes disable the cache. */
void tab5_camera_media_store(bool in_flash);
/* Before the runtime boots a guest whose plan `features` (the
 * POCKET_IDF_FEATURE_* bits) hold camera.qr, camera.photo or media.playback:
 * start the board's camera or speaker once and install the namespaces into
 * `realm`. */
void tab5_camera_media_install(JSContext *realm, pocket_runtime *runtime,
                               uint32_t features);
/* Before each tick: copy the newest frames into their textures. */
void tab5_camera_media_present(void);
/* Before the runtime is destroyed. */
void tab5_camera_media_teardown(void);
