#include "tab5_camera_media.h"

#include <stdbool.h>
#include <stdio.h>

#include "bsp/m5stack_tab5.h"
#include "esp_log.h"
#include "esp_video_device.h"
#include "pocket/audio.h"
#include "pocket/camera.h"
#include "pocket/media.h"
#include "pocket/package_facts.h"

static const char *TAG = "tab5_camera_media";

/* The sensor's picture is upright with the Tab5 held as the landscape
 * firmware draws: the panel's left edge on top. */
#define TAB5_CAMERA_ROTATION 0U
/* The second core: the first runs the guest. */
#define TAB5_WORKER_CORE 1

static bool camera_ready;
static bool media_ready;
static bool store_in_flash;

void tab5_camera_media_store(bool in_flash) { store_in_flash = in_flash; }

static esp_err_t start_sensor(void *context) {
  (void)context;
  return bsp_camera_start(NULL);
}

/* The media stream plays through pocket_audio's mixer: the speaker level
 * is the device's, the stream's own volume a gain on its ring. */
static esp_err_t audio_open(void *context, uint32_t rate) {
  (void)context;
  return pocket_audio_media_open(rate);
}

static esp_err_t audio_write(void *context, const int16_t *pcm, size_t frames) {
  (void)context;
  return pocket_audio_media_write(pcm, frames);
}

static void audio_volume(void *context, uint32_t percent) {
  (void)context;
  pocket_audio_media_gain(percent);
}

void tab5_camera_media_install(JSContext *realm, pocket_runtime *runtime,
                               uint32_t features) {
  const bool qr = (features & POCKET_IDF_FEATURE_CAMERA_QR) != 0U;
  const bool photo = (features & POCKET_IDF_FEATURE_CAMERA_PHOTO) != 0U;
  if ((qr || photo) && !camera_ready) {
    pocketjs_camera_config_t config;
    pocketjs_camera_config_defaults(&config);
    config.device = ESP_VIDEO_MIPI_CSI_DEVICE_NAME;
    config.start_sensor = start_sensor;
    config.rotation = TAB5_CAMERA_ROTATION;
    config.storage_root = "/pocket";
    config.storage_in_flash = store_in_flash;
    config.worker_core = TAB5_WORKER_CORE;
    camera_ready = pocketjs_camera_setup(&config) == ESP_OK;
  }
  if (camera_ready)
    ESP_ERROR_CHECK(pocketjs_camera_install(realm, runtime, qr, photo));
  if ((features & POCKET_IDF_FEATURE_MEDIA) != 0U) {
    if (!media_ready) {
      pocketjs_media_config_t config;
      pocketjs_media_config_defaults(&config);
      config.audio_open = audio_open;
      config.audio_write = audio_write;
      config.audio_volume = audio_volume;
      config.worker_core = TAB5_WORKER_CORE;
      media_ready = pocketjs_media_setup(&config) == ESP_OK;
      if (!media_ready)
        ESP_LOGE(TAG, "media did not start");
    }
    if (media_ready)
      ESP_ERROR_CHECK(pocketjs_media_install(realm, runtime));
  }
}

void tab5_camera_media_present(void) {
  if (camera_ready)
    pocketjs_camera_present();
  if (media_ready)
    pocketjs_media_present();
}

void tab5_camera_media_teardown(void) {
  if (camera_ready)
    pocketjs_camera_teardown();
  if (media_ready)
    pocketjs_media_teardown();
}
