# pocket_audio

`globalThis.audio` on the M5Stack Tab5: the streams of `audio.pcm` and the
inputs of `audio.capture` (`contracts/spec/audio.ts` in the pinned
pocketjs), and the speaker of the `media` module. The program installs the
namespace into a guest whose plan enables `audio.pcm` or `audio.capture`; the
capture ops are present with `audio.capture` only.

## Codecs

One I2S port (`CONFIG_BSP_I2S_NUM`) runs both codecs at 44.1 kHz, the BSP's
pins (MCLK G30, BCLK G27, WS G29, DOUT G26, DIN G28):

- TX: the ES8388 DAC, standard Philips stereo, 16-bit samples. The ADC's
  four-slot frame widens its slots to 32 bits so both directions share one
  bit clock.
- RX: the ES7210 ADC in TDM, four 16-bit slots. The ADC sends its inputs in
  the order MIC1, MIC3, MIC2, MIC4: on the Tab5 the left microphone, the
  speaker loopback, the right microphone and the headset microphone. The
  microphones take 37.5 dB of gain and the loopback 0 dB.

`pocket_audio_setup` creates the channels (TX standard, RX TDM, as M5Stack's
M5Tab5-UserDemo does), opens the ADC first and the DAC second, and enables the
speaker amplifier through the BSP. The program calls it from a task on
core 1, so the I2S DMA interrupts are core 1's.

## Mixer and capture

The mixer task (core 1, priority 6) owns the speaker. Each 256-frame block
it upsamples every playing stream by its integer ratio (44100, 22050 or
11025 Hz), applies the stream's volume, adds the media ring and writes the
block; with nothing to play it waits 5 ms and the DMA sends zeros. Four
streams of 16384 frames and three inputs of 8192 frames, rings in PSRAM. A
stream ring is written by the guest and read by the mixer, an input ring
written by the capture task and read by the guest, each without a lock.

The capture task (core 1, priority 5) reads the ADC only while an input is
open, averages each input's source down to its rate and drops what does not
fit its ring. `pocket_audio_tick`, called before each frame, turns the
mixer's and capture task's flags into the `credit`, `underrun`, `ended` and
`overrun` events `poll()` returns.

The speaker level (0 to 100, from `device.setVolume`) maps to the ES8388's
0 to 80. The `media` module's stream (22050 Hz) plays through the mixer at
its own gain.
