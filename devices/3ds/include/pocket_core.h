/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef POCKETJS_3DS_CORE_H
#define POCKETJS_3DS_CORE_H
#include <stddef.h>
#include <stdint.h>
#include <pocket_runtime.h>

/* The admitted program, borrowed from the `.pocket` buffer the package
 * source returns. */
typedef struct {
  const uint8_t *javascript;
  size_t javascript_length;
  const uint8_t *worker_javascript;
  size_t worker_javascript_length;
  const uint8_t *pak;
  size_t pak_length;
  const uint8_t *plan;
  size_t plan_length;
  /* The `.pocket` footer and the admitted variant's payload hash, filled by
   * the caller from its container reader (pocket_container.h);
   * pocket_package_open_source leaves them 0. */
  uint64_t package_hash;
  uint64_t variant_hash;
  /* Read from the variant's plan when the package is opened: one runtime
   * serves every game, so none of these is compiled in. aux_width and
   * aux_height are 0 when the plan has no auxiliary surface. */
  uint32_t view_width;
  uint32_t view_height;
  uint32_t raster_density;
  uint32_t aux_width;
  uint32_t aux_height;
  uint32_t aux_raster_density;
  uint32_t features; /* POCKET_GUEST_FEATURE_* */
  /* First 16 hex digits of SHA-256(app id), NUL-terminated: the
   * application's state directory below sdmc:/pocketjs/runtime/apps. */
  char slot[17];
} PocketGuestPackage;

#define POCKET_GUEST_FEATURE_OFFLOAD 1u /* features["io.offload"] */
#define POCKET_GUEST_FEATURE_MEDIA 2u   /* features["media.playback"] */
#define POCKET_GUEST_FEATURE_AGENT 4u   /* features["system.agent"] */
#define POCKET_GUEST_FEATURE_FS 8u      /* features["data.fs"] */
#define POCKET_GUEST_FEATURE_CAMERA_QR 16u    /* features["camera.qr"] */
#define POCKET_GUEST_FEATURE_EXTENSION 64u  /* features["system.extension"] */
#define POCKET_GUEST_FEATURE_CHANNEL 128u   /* features["link.channel"] */
#define POCKET_GUEST_FEATURE_CAMERA_PHOTO 32u /* features["camera.photo"] */

/* Returns the POCKET_PACKAGE_OPEN_* codes of pocket_runtime.h.
 * POCKET_PACKAGE_OPEN_OK = admitted: PocketJS reads the program at the
 * sections the source states (pocket_package_source_v1.sections), admits its
 * plan against the exported profile facts and checks its identity and the
 * NUL-terminated JS section, by the path boot takes; the same source then
 * boots it. BINDING_GENERATION, PLAN and RASTER_DENSITY to AUXILIARY name the
 * first failed admission item; PLAN_JSON, PLAN_VIEWPORT and PLAN_AUXILIARY a
 * plan whose JSON, viewport or auxiliary surface cannot be read; BAD_LAYOUT
 * a section outside the source's bytes; WORKER_SECTION a worker declaration
 * and section that disagree; SOURCE a source that supplies no length,
 * sections or bytes; BAD_ARGUMENT a null argument or a source without the
 * all callback, whose bytes `out` borrows. No container hash is checked:
 * the caller's reader verified the `.pocket`. The facts and profile hash are
 * compiled into the program, never read from the package. */
int32_t pocket_package_open_source(
  const pocket_package_source_v1 *source,
  void *context,
  const pocket_profile_facts *facts,
  uint32_t host_abi,
  const uint8_t *profile_hash,
  PocketGuestPackage *out
);

/* Native camera/media/agent convenience calls into the active canonical
 * runtime. These functions own no retained UI, resources or package state. */
int32_t ui_upload_texture(const uint8_t *, size_t, uint32_t, uint32_t, uint32_t);
void ui_free_texture(int32_t handle);
int32_t ui_load_font_atlas(const uint8_t *, size_t);
#endif
