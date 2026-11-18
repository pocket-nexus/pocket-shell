#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "quickjs.h"

#ifdef __cplusplus
extern "C" {
#endif

/** The Tab5's codecs: the ES8388 speaker and the ES7210 four-channel ADC
 * (left microphone, speaker loopback, right microphone, headset microphone)
 * on one I2S port at 44.1 kHz. */
typedef struct {
  size_t struct_size;
  /** Core of the mixer and capture tasks. */
  int task_core;
  /** Speaker level at start, 0 to 100. */
  uint32_t volume;
} pocket_audio_config_t;

/** Open the codecs and start the mixer. */
esp_err_t pocket_audio_setup(const pocket_audio_config_t *config);

/** Install `globalThis.audio` into `realm`: the streams of audio.pcm
 * (contracts/spec/audio.ts) and, with `capture`, its inputs. */
esp_err_t pocket_audio_install(JSContext *realm, bool capture);

/** The owner task between ticks: queue the tick's credit, underrun, ended
 * and overrun events. */
void pocket_audio_tick(void);

/** Guest teardown: destroy its streams and inputs. */
void pocket_audio_teardown(void);

/** Speaker level, 0 to 100, for system.device. */
void pocket_audio_set_volume(uint32_t percent);
uint32_t pocket_audio_volume(void);

/** The `media` module's speaker: interleaved stereo at `rate` (11025, 22050
 * or 44100 Hz) mixed with the streams; `write` blocks while the media ring
 * is full, `gain` is the stream's own volume, 0 to 100. */
esp_err_t pocket_audio_media_open(uint32_t rate);
esp_err_t pocket_audio_media_write(const int16_t *pcm, size_t frames);
void pocket_audio_media_gain(uint32_t percent);

#ifdef __cplusplus
}
#endif
