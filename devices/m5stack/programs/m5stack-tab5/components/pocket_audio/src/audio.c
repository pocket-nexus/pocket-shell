/*
 * `globalThis.audio` on the M5Stack Tab5 (contracts/spec/audio.ts): the
 * streams of audio.pcm and the inputs of audio.capture, and the speaker the
 * `media` module plays its stream on.
 *
 * One I2S port carries both codecs at 44.1 kHz. TX is the ES8388 DAC in
 * standard Philips stereo; RX is the ES7210 ADC in four-slot TDM. The ADC
 * sends its inputs in the order MIC1, MIC3, MIC2, MIC4, which on the Tab5 are
 * the left microphone, the speaker loopback, the right microphone and the
 * headset microphone. The TX slots are widened to 32 bits so both directions
 * share one bit clock.
 *
 * The mixer task owns the speaker. Each block it upsamples every playing
 * stream by its integer ratio to 44.1 kHz, applies the stream's volume, adds
 * the media ring and writes the block; with nothing to play it waits and the
 * DMA sends zeros. Stream and input rings are single producer, single
 * consumer: the guest writes a stream ring and reads an input ring, the
 * mixer and capture tasks the other ends. The owner's tick turns what the
 * tasks flagged into the JSON events poll() returns.
 */

#include "pocket/audio.h"

#include <stdatomic.h>
#include <stdio.h>
#include <string.h>

#include "bsp/m5stack_tab5.h"
#include "driver/i2s_std.h"
#include "driver/i2s_tdm.h"
#include "es7210_adc.h"
#include "es8388_codec.h"
#include "esp_check.h"
#include "esp_codec_dev.h"
#include "esp_codec_dev_defaults.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

static const char *TAG = "pocket_audio";

/* contracts/spec/audio.ts */
#define RING_FRAMES 16384U
#define MAX_STREAMS 4
#define INPUT_RING_FRAMES 8192U
#define MAX_INPUTS 3
enum { SOURCE_MICROPHONES, SOURCE_HEADSET, SOURCE_LOOPBACK };

#define OUTPUT_RATE 44100U
#define BLOCK_FRAMES 256U
#define ADC_CHANNELS 4U
#define MEDIA_RING_FRAMES 8192U
#define EVENT_SLOTS 32U
#define EVENT_BYTES 56U
#define MIXER_STACK 4096U
#define CAPTURE_STACK 4096U
/* The ES8388's level at full speaker volume, and the ADC's gain. */
#define SPEAKER_MAX 80U
#define MIC_GAIN_DB 37.5f

typedef struct {
  bool used;
  uint32_t channels;
  uint32_t step;
  int16_t *ring;
  atomic_uint read, write;
  atomic_bool playing, ending, ended, starved;
  atomic_uint volume; /* Q16: 65536 is unity. */
  /* Mixer-side: the frame repeated `step` times and its repeat count. */
  int16_t frame[2];
  uint32_t phase;
  /* Owner-side: what the last events reported. */
  uint32_t reported_free;
  bool reported_starved;
} stream_t;

typedef struct {
  bool used;
  uint32_t channels, step, source;
  int16_t *ring;
  atomic_uint read, write;
  atomic_bool overrun;
  bool reported_overrun;
  /* Capture-side: sums of the frames averaged into the next one. */
  int32_t sum[2];
  uint32_t summed;
} input_t;

static struct {
  bool ready;
  esp_codec_dev_handle_t speaker, mic;
  SemaphoreHandle_t lock;
  stream_t streams[MAX_STREAMS];
  input_t inputs[MAX_INPUTS];
  atomic_uint input_count;
  atomic_uint volume;
  /* The media module's ring at its own rate. */
  int16_t *media_ring;
  uint32_t media_step;
  atomic_uint media_read, media_write;
  atomic_uint media_gain;
  int16_t media_frame[2];
  uint32_t media_phase;
  TaskHandle_t mixer, capture;
  /* Events the owner queued for poll(). */
  char events[EVENT_SLOTS][EVENT_BYTES];
  uint32_t event_head, event_count;
} audio;

/* ---- codecs ----------------------------------------------------------------
 */

static esp_err_t open_codecs(void) {
  i2s_chan_config_t channel =
      I2S_CHANNEL_DEFAULT_CONFIG(CONFIG_BSP_I2S_NUM, I2S_ROLE_MASTER);
  channel.auto_clear = true;
  i2s_chan_handle_t tx = NULL;
  i2s_chan_handle_t rx = NULL;
  ESP_RETURN_ON_ERROR(i2s_new_channel(&channel, &tx, &rx), TAG, "I2S channels");
  const i2s_std_config_t std = {
      .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(OUTPUT_RATE),
      .slot_cfg = I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_16BIT,
                                                      I2S_SLOT_MODE_STEREO),
      .gpio_cfg = {.mclk = BSP_I2S_MCLK,
                   .bclk = BSP_I2S_SCLK,
                   .ws = BSP_I2S_LCLK,
                   .dout = BSP_I2S_DOUT,
                   .din = BSP_I2S_DSIN},
  };
  ESP_RETURN_ON_ERROR(i2s_channel_init_std_mode(tx, &std), TAG, "I2S TX");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(tx), TAG, "I2S TX enable");
  const i2s_tdm_config_t tdm = {
      .clk_cfg = {.sample_rate_hz = OUTPUT_RATE,
                  .clk_src = I2S_CLK_SRC_DEFAULT,
                  .mclk_multiple = I2S_MCLK_MULTIPLE_256,
                  .bclk_div = 8},
      .slot_cfg = {.data_bit_width = I2S_DATA_BIT_WIDTH_16BIT,
                   .slot_bit_width = I2S_SLOT_BIT_WIDTH_AUTO,
                   .slot_mode = I2S_SLOT_MODE_STEREO,
                   .slot_mask = I2S_TDM_SLOT0 | I2S_TDM_SLOT1 | I2S_TDM_SLOT2 |
                                I2S_TDM_SLOT3,
                   .ws_width = I2S_TDM_AUTO_WS_WIDTH,
                   .bit_shift = true,
                   .total_slot = I2S_TDM_AUTO_SLOT_NUM},
      .gpio_cfg = {.mclk = BSP_I2S_MCLK,
                   .bclk = BSP_I2S_SCLK,
                   .ws = BSP_I2S_LCLK,
                   .dout = BSP_I2S_DOUT,
                   .din = BSP_I2S_DSIN},
  };
  ESP_RETURN_ON_ERROR(i2s_channel_init_tdm_mode(rx, &tdm), TAG, "I2S RX");
  ESP_RETURN_ON_ERROR(i2s_channel_enable(rx), TAG, "I2S RX enable");
  audio_codec_i2s_cfg_t i2s = {
      .port = CONFIG_BSP_I2S_NUM, .rx_handle = rx, .tx_handle = tx};
  const audio_codec_data_if_t *data = audio_codec_new_i2s_data(&i2s);
  audio_codec_i2c_cfg_t speaker_i2c = {.port = BSP_I2C_NUM,
                                       .addr = ES8388_CODEC_DEFAULT_ADDR,
                                       .bus_handle = bsp_i2c_get_handle()};
  audio_codec_i2c_cfg_t mic_i2c = {.port = BSP_I2C_NUM,
                                   .addr = ES7210_CODEC_DEFAULT_ADDR,
                                   .bus_handle = bsp_i2c_get_handle()};
  const audio_codec_ctrl_if_t *speaker_ctrl =
      audio_codec_new_i2c_ctrl(&speaker_i2c);
  const audio_codec_ctrl_if_t *mic_ctrl = audio_codec_new_i2c_ctrl(&mic_i2c);
  if (data == NULL || speaker_ctrl == NULL || mic_ctrl == NULL)
    return ESP_ERR_NO_MEM;
  es8388_codec_cfg_t speaker_cfg = {
      .ctrl_if = speaker_ctrl,
      .gpio_if = audio_codec_new_gpio(),
      .codec_mode = ESP_CODEC_DEV_WORK_MODE_DAC,
      .pa_pin = -1,
      .hw_gain = {.pa_voltage = 5.0, .codec_dac_voltage = 3.3},
  };
  es7210_codec_cfg_t mic_cfg = {
      .ctrl_if = mic_ctrl,
      .mic_selected =
          ES7210_SEL_MIC1 | ES7210_SEL_MIC2 | ES7210_SEL_MIC3 | ES7210_SEL_MIC4,
  };
  const audio_codec_if_t *speaker_if = es8388_codec_new(&speaker_cfg);
  const audio_codec_if_t *mic_if = es7210_codec_new(&mic_cfg);
  if (speaker_if == NULL || mic_if == NULL)
    return ESP_ERR_NO_MEM;
  esp_codec_dev_cfg_t speaker_dev = {.dev_type = ESP_CODEC_DEV_TYPE_OUT,
                                     .codec_if = speaker_if,
                                     .data_if = data};
  esp_codec_dev_cfg_t mic_dev = {
      .dev_type = ESP_CODEC_DEV_TYPE_IN, .codec_if = mic_if, .data_if = data};
  audio.speaker = esp_codec_dev_new(&speaker_dev);
  audio.mic = esp_codec_dev_new(&mic_dev);
  if (audio.speaker == NULL || audio.mic == NULL)
    return ESP_ERR_NO_MEM;
  /* The four-slot ADC opens first; the DAC then widens its slots to the
   * same frame. */
  esp_codec_dev_sample_info_t adc = {.bits_per_sample = 16,
                                     .channel = ADC_CHANNELS,
                                     .channel_mask = 0x0F,
                                     .sample_rate = OUTPUT_RATE};
  esp_codec_dev_sample_info_t dac = {
      .bits_per_sample = 16, .channel = 2, .sample_rate = OUTPUT_RATE};
  if (esp_codec_dev_open(audio.mic, &adc) != ESP_CODEC_DEV_OK ||
      esp_codec_dev_open(audio.speaker, &dac) != ESP_CODEC_DEV_OK)
    return ESP_FAIL;
  /* The microphones (MIC1, MIC2, MIC4) take the ADC's gain; the loopback
   * (MIC3) carries the DAC's line level and stays at 0 dB. */
  esp_codec_dev_set_in_channel_gain(audio.mic,
                                    ESP_CODEC_DEV_MAKE_CHANNEL_MASK(0) |
                                        ESP_CODEC_DEV_MAKE_CHANNEL_MASK(1) |
                                        ESP_CODEC_DEV_MAKE_CHANNEL_MASK(3),
                                    MIC_GAIN_DB);
  esp_codec_dev_set_in_channel_gain(audio.mic,
                                    ESP_CODEC_DEV_MAKE_CHANNEL_MASK(2), 0.0f);
  bsp_feature_enable(BSP_FEATURE_SPEAKER, true);
  return ESP_OK;
}

static void apply_volume(void) {
  const uint32_t percent = atomic_load(&audio.volume);
  esp_codec_dev_set_out_mute(audio.speaker, percent == 0);
  esp_codec_dev_set_out_vol(audio.speaker, (int)(percent * SPEAKER_MAX / 100U));
}

/* ---- the mixer -------------------------------------------------------------
 */

static int16_t clip(int32_t value) {
  return value > 32767 ? 32767 : value < -32768 ? -32768 : (int16_t)value;
}

/* The next output frame of one stream; false once it has nothing to say. */
static bool stream_frame(stream_t *stream, int32_t out[2]) {
  if (stream->phase == 0) {
    const uint32_t read = atomic_load(&stream->read);
    if (atomic_load(&stream->write) == read) {
      if (atomic_load(&stream->ending)) {
        atomic_store(&stream->playing, false);
        atomic_store(&stream->ending, false);
        atomic_store(&stream->ended, true);
      } else {
        atomic_store(&stream->starved, true);
      }
      return false;
    }
    const int16_t *frame =
        stream->ring + (size_t)(read % RING_FRAMES) * stream->channels;
    stream->frame[0] = frame[0];
    stream->frame[1] = stream->channels == 2 ? frame[1] : frame[0];
    atomic_store(&stream->read, read + 1);
    atomic_store(&stream->starved, false);
  }
  stream->phase = (stream->phase + 1) % stream->step;
  const int32_t volume = (int32_t)atomic_load(&stream->volume);
  out[0] += (stream->frame[0] * volume) >> 16;
  out[1] += (stream->frame[1] * volume) >> 16;
  return true;
}

static bool media_frame(int32_t out[2]) {
  if (audio.media_ring == NULL)
    return false;
  if (audio.media_phase == 0) {
    const uint32_t read = atomic_load(&audio.media_read);
    if (atomic_load(&audio.media_write) == read)
      return false;
    const int16_t *frame =
        audio.media_ring + (size_t)(read % MEDIA_RING_FRAMES) * 2;
    audio.media_frame[0] = frame[0];
    audio.media_frame[1] = frame[1];
    atomic_store(&audio.media_read, read + 1);
  }
  audio.media_phase = (audio.media_phase + 1) % audio.media_step;
  const int32_t gain =
      (int32_t)(atomic_load(&audio.media_gain) * 65536U / 100U);
  out[0] += (audio.media_frame[0] * gain) >> 16;
  out[1] += (audio.media_frame[1] * gain) >> 16;
  return true;
}

static void mixer_run(void *unused) {
  (void)unused;
  int16_t *block = heap_caps_malloc(BLOCK_FRAMES * 2 * sizeof(int16_t),
                                    MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  assert(block != NULL);
  uint32_t applied_volume = UINT32_MAX;
  for (;;) {
    if (atomic_load(&audio.volume) != applied_volume) {
      applied_volume = atomic_load(&audio.volume);
      apply_volume();
    }
    bool sound = false;
    xSemaphoreTake(audio.lock, portMAX_DELAY);
    for (uint32_t i = 0; i < BLOCK_FRAMES; ++i) {
      int32_t out[2] = {0, 0};
      for (int s = 0; s < MAX_STREAMS; ++s) {
        stream_t *stream = &audio.streams[s];
        if (stream->used && atomic_load(&stream->playing) &&
            stream_frame(stream, out))
          sound = true;
      }
      if (media_frame(out))
        sound = true;
      block[i * 2] = clip(out[0]);
      block[i * 2 + 1] = clip(out[1]);
    }
    xSemaphoreGive(audio.lock);
    if (sound)
      esp_codec_dev_write(audio.speaker, block,
                          (int)(BLOCK_FRAMES * 2 * sizeof(int16_t)));
    else
      vTaskDelay(pdMS_TO_TICKS(5));
  }
}

/* ---- capture ---------------------------------------------------------------
 */

static void capture_frame(input_t *input, const int16_t *adc) {
  switch (input->source) {
  case SOURCE_MICROPHONES:
    input->sum[0] += adc[0];
    input->sum[1] += adc[2];
    break;
  case SOURCE_HEADSET:
    input->sum[0] += adc[3];
    input->sum[1] += adc[3];
    break;
  default:
    input->sum[0] += adc[1];
    input->sum[1] += adc[1];
    break;
  }
  if (++input->summed < input->step)
    return;
  const int32_t left = input->sum[0] / (int32_t)input->step;
  const int32_t right = input->sum[1] / (int32_t)input->step;
  input->sum[0] = input->sum[1] = 0;
  input->summed = 0;
  const uint32_t write = atomic_load(&input->write);
  if (write - atomic_load(&input->read) >= INPUT_RING_FRAMES) {
    atomic_store(&input->overrun, true);
    return;
  }
  int16_t *slot =
      input->ring + (size_t)(write % INPUT_RING_FRAMES) * input->channels;
  if (input->channels == 2) {
    slot[0] = (int16_t)left;
    slot[1] = (int16_t)right;
  } else {
    slot[0] = (int16_t)((left + right) / 2);
  }
  atomic_store(&input->write, write + 1);
}

static void capture_run(void *unused) {
  (void)unused;
  int16_t *block =
      heap_caps_malloc(BLOCK_FRAMES * ADC_CHANNELS * sizeof(int16_t),
                       MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  assert(block != NULL);
  for (;;) {
    if (atomic_load(&audio.input_count) == 0) {
      ulTaskNotifyTake(pdTRUE, portMAX_DELAY);
      continue;
    }
    if (esp_codec_dev_read(audio.mic, block,
                           (int)(BLOCK_FRAMES * ADC_CHANNELS *
                                 sizeof(int16_t))) != ESP_CODEC_DEV_OK) {
      vTaskDelay(pdMS_TO_TICKS(10));
      continue;
    }
    xSemaphoreTake(audio.lock, portMAX_DELAY);
    for (int n = 0; n < MAX_INPUTS; ++n) {
      input_t *input = &audio.inputs[n];
      if (!input->used)
        continue;
      for (uint32_t i = 0; i < BLOCK_FRAMES; ++i)
        capture_frame(input, block + i * ADC_CHANNELS);
    }
    xSemaphoreGive(audio.lock);
  }
}

/* ---- streams and inputs ----------------------------------------------------
 */

static uint32_t rate_step(int32_t rate) {
  return rate == 44100 ? 1U : rate == 22050 ? 2U : rate == 11025 ? 4U : 0U;
}

static stream_t *stream_of(int32_t handle) {
  if (handle < 1 || handle > MAX_STREAMS || !audio.streams[handle - 1].used)
    return NULL;
  return &audio.streams[handle - 1];
}

static input_t *input_of(int32_t handle) {
  if (handle < 1 || handle > MAX_INPUTS || !audio.inputs[handle - 1].used)
    return NULL;
  return &audio.inputs[handle - 1];
}

static int32_t create_stream(int32_t rate, int32_t channels) {
  const uint32_t step = rate_step(rate);
  if (!audio.ready || step == 0 || channels < 1 || channels > 2)
    return -1;
  for (int i = 0; i < MAX_STREAMS; ++i) {
    stream_t *stream = &audio.streams[i];
    if (stream->used)
      continue;
    int16_t *ring = heap_caps_malloc((size_t)RING_FRAMES * (size_t)channels *
                                         sizeof(int16_t),
                                     MALLOC_CAP_SPIRAM);
    if (ring == NULL)
      return -1;
    xSemaphoreTake(audio.lock, portMAX_DELAY);
    memset(stream, 0, sizeof *stream);
    stream->ring = ring;
    stream->channels = (uint32_t)channels;
    stream->step = step;
    atomic_store(&stream->volume, 65536U);
    stream->reported_free = RING_FRAMES;
    stream->used = true;
    xSemaphoreGive(audio.lock);
    return i + 1;
  }
  return -1;
}

static void destroy_stream(int32_t handle) {
  stream_t *stream = stream_of(handle);
  if (stream == NULL)
    return;
  xSemaphoreTake(audio.lock, portMAX_DELAY);
  int16_t *ring = stream->ring;
  stream->used = false;
  stream->ring = NULL;
  xSemaphoreGive(audio.lock);
  heap_caps_free(ring);
}

static int32_t write_pcm(int32_t handle, const uint8_t *bytes, size_t length) {
  stream_t *stream = stream_of(handle);
  if (stream == NULL)
    return -1;
  const size_t frame_bytes = stream->channels * sizeof(int16_t);
  const uint32_t frames = (uint32_t)(length / frame_bytes);
  const uint32_t write = atomic_load(&stream->write);
  const uint32_t free_frames =
      RING_FRAMES - (write - atomic_load(&stream->read));
  const uint32_t accepted = frames < free_frames ? frames : free_frames;
  for (uint32_t i = 0; i < accepted; ++i)
    memcpy(stream->ring +
               (size_t)((write + i) % RING_FRAMES) * stream->channels,
           bytes + (size_t)i * frame_bytes, frame_bytes);
  atomic_store(&stream->write, write + accepted);
  if (accepted > 0)
    atomic_store(&stream->ended, false);
  return (int32_t)accepted;
}

static void flush_stream(stream_t *stream) {
  xSemaphoreTake(audio.lock, portMAX_DELAY);
  atomic_store(&stream->playing, false);
  atomic_store(&stream->ending, false);
  atomic_store(&stream->read, atomic_load(&stream->write));
  stream->phase = 0;
  xSemaphoreGive(audio.lock);
}

static int32_t open_input(int32_t rate, int32_t channels, int32_t source) {
  const uint32_t step = rate_step(rate);
  if (!audio.ready || step == 0 || channels < 1 || channels > 2 ||
      source < SOURCE_MICROPHONES || source > SOURCE_LOOPBACK)
    return -1;
  for (int i = 0; i < MAX_INPUTS; ++i) {
    input_t *input = &audio.inputs[i];
    if (input->used)
      continue;
    int16_t *ring = heap_caps_malloc((size_t)INPUT_RING_FRAMES *
                                         (size_t)channels * sizeof(int16_t),
                                     MALLOC_CAP_SPIRAM);
    if (ring == NULL)
      return -1;
    xSemaphoreTake(audio.lock, portMAX_DELAY);
    memset(input, 0, sizeof *input);
    input->ring = ring;
    input->channels = (uint32_t)channels;
    input->step = step;
    input->source = (uint32_t)source;
    input->used = true;
    xSemaphoreGive(audio.lock);
    atomic_fetch_add(&audio.input_count, 1);
    xTaskNotifyGive(audio.capture);
    return i + 1;
  }
  return -1;
}

static void close_input(int32_t handle) {
  input_t *input = input_of(handle);
  if (input == NULL)
    return;
  xSemaphoreTake(audio.lock, portMAX_DELAY);
  int16_t *ring = input->ring;
  input->used = false;
  input->ring = NULL;
  xSemaphoreGive(audio.lock);
  heap_caps_free(ring);
  atomic_fetch_sub(&audio.input_count, 1);
}

static int32_t read_input(int32_t handle, uint8_t *bytes, size_t length) {
  input_t *input = input_of(handle);
  if (input == NULL)
    return -1;
  const size_t frame_bytes = input->channels * sizeof(int16_t);
  const uint32_t read = atomic_load(&input->read);
  const uint32_t ready = atomic_load(&input->write) - read;
  const uint32_t room = (uint32_t)(length / frame_bytes);
  const uint32_t count = ready < room ? ready : room;
  for (uint32_t i = 0; i < count; ++i)
    memcpy(bytes + (size_t)i * frame_bytes,
           input->ring +
               (size_t)((read + i) % INPUT_RING_FRAMES) * input->channels,
           frame_bytes);
  atomic_store(&input->read, read + count);
  return (int32_t)count;
}

/* ---- events ----------------------------------------------------------------
 */

static void queue_event(const char *type, int handle, int32_t free_frames) {
  if (audio.event_count == EVENT_SLOTS)
    return;
  char *slot =
      audio.events[(audio.event_head + audio.event_count) % EVENT_SLOTS];
  if (free_frames >= 0)
    snprintf(slot, EVENT_BYTES, "{\"t\":\"%s\",\"h\":%d,\"free\":%ld}", type,
             handle, (long)free_frames);
  else
    snprintf(slot, EVENT_BYTES, "{\"t\":\"%s\",\"h\":%d}", type, handle);
  ++audio.event_count;
}

void pocket_audio_tick(void) {
  if (!audio.ready)
    return;
  for (int i = 0; i < MAX_STREAMS; ++i) {
    stream_t *stream = &audio.streams[i];
    if (!stream->used)
      continue;
    const uint32_t free_frames = RING_FRAMES - (atomic_load(&stream->write) -
                                                atomic_load(&stream->read));
    if (free_frames != stream->reported_free) {
      stream->reported_free = free_frames;
      queue_event("credit", i + 1, (int32_t)free_frames);
    }
    const bool starved =
        atomic_load(&stream->starved) && atomic_load(&stream->playing);
    if (starved && !stream->reported_starved)
      queue_event("underrun", i + 1, -1);
    stream->reported_starved = starved;
    if (atomic_exchange(&stream->ended, false))
      queue_event("ended", i + 1, -1);
  }
  for (int i = 0; i < MAX_INPUTS; ++i) {
    input_t *input = &audio.inputs[i];
    if (!input->used)
      continue;
    const bool overrun = atomic_exchange(&input->overrun, false);
    if (overrun && !input->reported_overrun)
      queue_event("overrun", i + 1, -1);
    input->reported_overrun = overrun;
  }
}

/* ---- QuickJS ---------------------------------------------------------------
 */

enum {
  OP_CREATE_STREAM = 1,
  OP_DESTROY_STREAM,
  OP_WRITE_PCM,
  OP_PLAY,
  OP_PAUSE,
  OP_STOP,
  OP_SET_VOLUME,
  OP_END_STREAM,
  OP_POLL,
  OP_OPEN_INPUT,
  OP_READ_INPUT,
  OP_CLOSE_INPUT,
};

static int32_t argument_int(JSContext *ctx, int argc, JSValueConst *argv,
                            int index) {
  int32_t value = 0;
  if (index < argc)
    JS_ToInt32(ctx, &value, argv[index]);
  return value;
}

/* The bytes of an ArrayBuffer or a typed array; `lease` keeps them alive
 * for the call. */
static uint8_t *argument_bytes(JSContext *ctx, int argc, JSValueConst *argv,
                               int index, size_t *length, JSValue *lease) {
  *lease = JS_UNDEFINED;
  if (index >= argc)
    return NULL;
  size_t size = 0;
  uint8_t *data = JS_GetArrayBuffer(ctx, &size, argv[index]);
  if (data != NULL) {
    *lease = JS_DupValue(ctx, argv[index]);
    *length = size;
    return data;
  }
  JS_FreeValue(ctx, JS_GetException(ctx));
  size_t offset = 0, view_length = 0, element = 0;
  JSValue buffer =
      JS_GetTypedArrayBuffer(ctx, argv[index], &offset, &view_length, &element);
  if (JS_IsException(buffer)) {
    JS_FreeValue(ctx, JS_GetException(ctx));
    return NULL;
  }
  data = JS_GetArrayBuffer(ctx, &size, buffer);
  if (data == NULL || offset > size || view_length > size - offset) {
    JS_FreeValue(ctx, buffer);
    return NULL;
  }
  *lease = buffer;
  *length = view_length;
  return data + offset;
}

static JSValue operation(JSContext *ctx, JSValueConst this_value, int argc,
                         JSValueConst *argv, int magic) {
  (void)this_value;
  const int32_t first = argument_int(ctx, argc, argv, 0);
  stream_t *stream = NULL;
  switch (magic) {
  case OP_CREATE_STREAM:
    return JS_NewInt32(ctx,
                       create_stream(first, argument_int(ctx, argc, argv, 1)));
  case OP_DESTROY_STREAM:
    destroy_stream(first);
    return JS_UNDEFINED;
  case OP_WRITE_PCM:
  case OP_READ_INPUT: {
    size_t length = 0;
    JSValue lease;
    uint8_t *bytes = argument_bytes(ctx, argc, argv, 1, &length, &lease);
    int32_t result = -1;
    if (bytes != NULL)
      result = magic == OP_WRITE_PCM ? write_pcm(first, bytes, length)
                                     : read_input(first, bytes, length);
    JS_FreeValue(ctx, lease);
    return JS_NewInt32(ctx, result);
  }
  case OP_PLAY:
    if ((stream = stream_of(first)) != NULL)
      atomic_store(&stream->playing, true);
    return JS_UNDEFINED;
  case OP_PAUSE:
    if ((stream = stream_of(first)) != NULL)
      atomic_store(&stream->playing, false);
    return JS_UNDEFINED;
  case OP_STOP:
    if ((stream = stream_of(first)) != NULL)
      flush_stream(stream);
    return JS_UNDEFINED;
  case OP_SET_VOLUME:
    if ((stream = stream_of(first)) != NULL) {
      double volume = 1.0;
      if (argc > 1)
        JS_ToFloat64(ctx, &volume, argv[1]);
      volume = volume < 0 ? 0 : volume > 1 ? 1 : volume;
      atomic_store(&stream->volume, (uint32_t)(volume * 65536.0));
    }
    return JS_UNDEFINED;
  case OP_END_STREAM:
    if ((stream = stream_of(first)) != NULL)
      atomic_store(&stream->ending, true);
    return JS_UNDEFINED;
  case OP_POLL: {
    if (audio.event_count == 0)
      return JS_UNDEFINED;
    JSValue event = JS_NewString(ctx, audio.events[audio.event_head]);
    audio.event_head = (audio.event_head + 1) % EVENT_SLOTS;
    --audio.event_count;
    return event;
  }
  case OP_OPEN_INPUT:
    return JS_NewInt32(ctx, open_input(first, argument_int(ctx, argc, argv, 1),
                                       argument_int(ctx, argc, argv, 2)));
  case OP_CLOSE_INPUT:
    close_input(first);
    return JS_UNDEFINED;
  default:
    return JS_UNDEFINED;
  }
}

static void add(JSContext *ctx, JSValue object, const char *name, int arity,
                int magic) {
  JS_SetPropertyStr(ctx, object, name,
                    JS_NewCFunctionMagic(ctx, operation, name, arity,
                                         JS_CFUNC_generic_magic, magic));
}

esp_err_t pocket_audio_install(JSContext *realm, bool capture) {
  if (!audio.ready)
    return ESP_ERR_INVALID_STATE;
  JSValue global = JS_GetGlobalObject(realm);
  JSValue object = JS_NewObject(realm);
  add(realm, object, "createStream", 2, OP_CREATE_STREAM);
  add(realm, object, "destroyStream", 1, OP_DESTROY_STREAM);
  add(realm, object, "writePcm", 2, OP_WRITE_PCM);
  add(realm, object, "play", 1, OP_PLAY);
  add(realm, object, "pause", 1, OP_PAUSE);
  add(realm, object, "stop", 1, OP_STOP);
  add(realm, object, "setVolume", 2, OP_SET_VOLUME);
  add(realm, object, "endStream", 1, OP_END_STREAM);
  add(realm, object, "poll", 0, OP_POLL);
  if (capture) {
    add(realm, object, "openInput", 3, OP_OPEN_INPUT);
    add(realm, object, "readInput", 2, OP_READ_INPUT);
    add(realm, object, "closeInput", 1, OP_CLOSE_INPUT);
  }
  JS_SetPropertyStr(realm, global, "audio", object);
  const bool failed = JS_HasException(realm);
  JS_FreeValue(realm, global);
  return failed ? ESP_ERR_NO_MEM : ESP_OK;
}

void pocket_audio_teardown(void) {
  if (!audio.ready)
    return;
  for (int i = 1; i <= MAX_STREAMS; ++i)
    destroy_stream(i);
  for (int i = 1; i <= MAX_INPUTS; ++i)
    close_input(i);
  audio.event_head = audio.event_count = 0;
}

/* ---- volume and media ------------------------------------------------------
 */

void pocket_audio_set_volume(uint32_t percent) {
  atomic_store(&audio.volume, percent > 100 ? 100 : percent);
}

uint32_t pocket_audio_volume(void) { return atomic_load(&audio.volume); }

esp_err_t pocket_audio_media_open(uint32_t rate) {
  const uint32_t step = rate_step((int32_t)rate);
  if (!audio.ready || step == 0)
    return ESP_ERR_INVALID_ARG;
  if (audio.media_ring == NULL) {
    int16_t *ring = heap_caps_malloc(MEDIA_RING_FRAMES * 2 * sizeof(int16_t),
                                     MALLOC_CAP_SPIRAM);
    if (ring == NULL)
      return ESP_ERR_NO_MEM;
    xSemaphoreTake(audio.lock, portMAX_DELAY);
    audio.media_ring = ring;
    xSemaphoreGive(audio.lock);
  }
  audio.media_step = step;
  return ESP_OK;
}

esp_err_t pocket_audio_media_write(const int16_t *pcm, size_t frames) {
  if (audio.media_ring == NULL)
    return ESP_ERR_INVALID_STATE;
  for (size_t done = 0; done < frames;) {
    const uint32_t write = atomic_load(&audio.media_write);
    const uint32_t room =
        MEDIA_RING_FRAMES - (write - atomic_load(&audio.media_read));
    if (room == 0) {
      vTaskDelay(pdMS_TO_TICKS(2));
      continue;
    }
    const size_t count = frames - done < room ? frames - done : room;
    for (size_t i = 0; i < count; ++i)
      memcpy(audio.media_ring + (size_t)((write + i) % MEDIA_RING_FRAMES) * 2,
             pcm + (done + i) * 2, 2 * sizeof(int16_t));
    atomic_store(&audio.media_write, write + (uint32_t)count);
    done += count;
  }
  return ESP_OK;
}

void pocket_audio_media_gain(uint32_t percent) {
  atomic_store(&audio.media_gain, percent > 100 ? 100 : percent);
}

/* ---- setup -----------------------------------------------------------------
 */

esp_err_t pocket_audio_setup(const pocket_audio_config_t *config) {
  if (config == NULL || config->struct_size < sizeof(*config))
    return ESP_ERR_INVALID_ARG;
  if (audio.ready)
    return ESP_OK;
  audio.lock = xSemaphoreCreateMutex();
  if (audio.lock == NULL)
    return ESP_ERR_NO_MEM;
  atomic_store(&audio.volume, config->volume > 100 ? 100 : config->volume);
  atomic_store(&audio.media_gain, 100);
  audio.media_step = 1;
  const esp_err_t opened = open_codecs();
  if (opened != ESP_OK) {
    ESP_LOGE(TAG, "codecs: %s", esp_err_to_name(opened));
    return opened;
  }
  if (xTaskCreatePinnedToCore(mixer_run, "pocket_mixer", MIXER_STACK, NULL, 6,
                              &audio.mixer, config->task_core) != pdPASS ||
      xTaskCreatePinnedToCore(capture_run, "pocket_capture", CAPTURE_STACK,
                              NULL, 5, &audio.capture,
                              config->task_core) != pdPASS)
    return ESP_ERR_NO_MEM;
  audio.ready = true;
  ESP_LOGI(TAG, "ES8388 and ES7210 at %u Hz, volume %u", OUTPUT_RATE,
           (unsigned)atomic_load(&audio.volume));
  return ESP_OK;
}
