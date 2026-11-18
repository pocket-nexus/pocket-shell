#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "quickjs.h"

#ifdef __cplusplus
extern "C" {
#endif

/** The Tab5's own controls for `globalThis.device` (system.device,
 * contracts/spec/device.ts). */
typedef struct {
  size_t struct_size;
  /** The panel controller, "" when unknown (pocket_device_detect_panel). */
  const char *panel;
  /** Header pins an app may drive, in header order. */
  const uint8_t *pins;
  size_t pin_count;
  /** Where the removable card is mounted, NULL without one. */
  const char *card_root;
  /** The speaker level, 0 to 100, kept by the audio owner. */
  void (*set_volume)(void *context, uint32_t percent);
  uint32_t (*volume)(void *context);
  void *context;
} pocket_device_config_t;

/** Probe the touch controller on the system I2C bus for the panel it comes
 * with: "ST7121", "ST7123" or "ILI9881C"; "" when none answers. Call before
 * the touch driver polls. */
const char *pocket_device_detect_panel(void);

/** Set the power rails to the board's defaults (charging and QC on, USB-A
 * and EXT 5V on, the internal antenna), start the temperature sensor and the
 * USB host that detects USB-A devices. */
esp_err_t pocket_device_setup(const pocket_device_config_t *config);

/** Install `globalThis.device` into `realm` before the runtime boots. */
esp_err_t pocket_device_install(JSContext *realm);

/** Guest teardown: release the pins the guest drove and restore the
 * backlight it dimmed. */
void pocket_device_teardown(void);

#ifdef __cplusplus
}
#endif
