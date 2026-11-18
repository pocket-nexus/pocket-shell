#include "protocol.h"
#include <assert.h>
#include <stdio.h>

int main(void) {
  pocket_i2c_esp_script decoded;
  const uint8_t read_write[] = {1, 2, 20, 0, 2, 0x7c, 1, 0, 0, 1, 0x0c, 1, 0};
  assert(pocket_i2c_esp_decode(read_write, sizeof(read_write), 1, 256, 20,
                               &decoded));
  assert(decoded.count == 2 && decoded.read_length == 1);
  assert(decoded.steps[0].data[0] == 0 && decoded.steps[1].reg == 0x0c);
  assert(!pocket_i2c_esp_decode(read_write, sizeof(read_write), 0, 256, 20,
                                &decoded));
  assert(!pocket_i2c_esp_decode(read_write, sizeof(read_write), 1, 6, 20,
                                &decoded));
  assert(!pocket_i2c_esp_decode(read_write, sizeof(read_write), 1, 256, 19,
                                &decoded));
  for (size_t n = 0; n < sizeof(read_write); ++n)
    assert(!pocket_i2c_esp_decode(read_write, n, 1024, 256, 20, &decoded));
  const uint8_t trailing[] = {1, 1, 20, 0, 1, 0x10, 1, 0, 0xff};
  assert(
      !pocket_i2c_esp_decode(trailing, sizeof(trailing), 1, 256, 20, &decoded));
  const uint8_t empty[] = {1, 1, 20, 0, 1, 0x10, 0, 0};
  assert(!pocket_i2c_esp_decode(empty, sizeof(empty), 1, 256, 20, &decoded));
  const uint8_t command[] = {1, 1, 20, 0, 2, 0x7e, 0, 0};
  assert(pocket_i2c_esp_decode(command, sizeof(command), 0, 2, 20, &decoded));
  assert(decoded.read_length == 0 && decoded.steps[0].length == 0);
  /* RTC STOP -> seven BCD fields -> restart fits seven command slots. */
  const uint8_t rtc_set[] = {1,    3,    20, 0,    2,    0x1e, 1,    0,    0x7f,
                             2,    0x10, 7,  0,    0x56, 0x34, 0x12, 0x10, 0x29,
                             0x02, 0x24, 2,  0x1e, 1,    0,    0x3f};
  assert(pocket_i2c_esp_decode(rtc_set, sizeof(rtc_set), 0, 256, 20, &decoded));
  /* Restart plus one-byte CTRL0 readback uses exactly eight slots. */
  const uint8_t rtc_recover[] = {1, 2,    20, 0,    2, 0x1e, 1,
                                 0, 0x3f, 1,  0x1e, 1, 0};
  assert(pocket_i2c_esp_decode(rtc_recover, sizeof(rtc_recover), 1, 256, 20,
                               &decoded));
  const uint8_t four_writes[] = {1,    4, 20,   0, 2,    0x1e, 1, 0,
                                 0x40, 2, 0x10, 1, 0,    0,    2, 0x1d,
                                 1,    0, 0xbd, 2, 0x1e, 1,    0, 0};
  assert(!pocket_i2c_esp_decode(four_writes, sizeof(four_writes), 0, 256, 20,
                                &decoded));
  const uint8_t bad_op[] = {1, 1, 20, 0, 4, 0x10, 1, 0};
  assert(!pocket_i2c_esp_decode(bad_op, sizeof(bad_op), 1, 256, 20, &decoded));
  /* SHT3x clock-stretched single shot: the 0x2C06 command, then six bytes on
   * a bare read; 1 + 2 + 4 command slots and 2 + 1 + 1 + 6 bytes. */
  const uint8_t sht_single[] = {1, 2, 20, 0, 2, 0x2c, 1, 0, 0x06, 3, 0, 6, 0};
  assert(pocket_i2c_esp_decode(sht_single, sizeof(sht_single), 6, 256, 20,
                               &decoded));
  assert(decoded.read_length == 6 && decoded.steps[1].op == 3 &&
         decoded.steps[1].data == NULL);
  assert(!pocket_i2c_esp_decode(sht_single, sizeof(sht_single), 5, 256, 20,
                                &decoded));
  assert(!pocket_i2c_esp_decode(sht_single, sizeof(sht_single), 6, 9, 20,
                                &decoded));
  /* One-byte receives take three slots each: two fit with the STOP. */
  const uint8_t receives[] = {1, 2, 20, 0, 3, 0, 1, 0, 3, 0, 1, 0};
  assert(
      pocket_i2c_esp_decode(receives, sizeof(receives), 2, 256, 20, &decoded));
  /* A register read and a multibyte receive take 6 + 4 slots. */
  const uint8_t read_receive[] = {1, 2, 20, 0, 1, 0x37, 1, 0, 3, 0, 2, 0};
  assert(!pocket_i2c_esp_decode(read_receive, sizeof(read_receive), 3, 256, 20,
                                &decoded));
  const uint8_t receive_register[] = {1, 1, 20, 0, 3, 0x10, 1, 0};
  assert(!pocket_i2c_esp_decode(receive_register, sizeof(receive_register), 1,
                                256, 20, &decoded));
  const uint8_t receive_empty[] = {1, 1, 20, 0, 3, 0, 0, 0};
  assert(!pocket_i2c_esp_decode(receive_empty, sizeof(receive_empty), 1, 256,
                                20, &decoded));
  const uint8_t overflow[] = {1, 1, 20, 0, 1, 0x10, 0xff, 0xff};
  assert(!pocket_i2c_esp_decode(overflow, sizeof(overflow), 1024, 256, 20,
                                &decoded));
  const uint8_t probe[] = {20, 0};
  assert(pocket_i2c_esp_probe_timeout(probe, sizeof(probe), 100) == 20);
  assert(!pocket_i2c_esp_probe_timeout(probe, 1, 100));
  assert(!pocket_i2c_esp_probe_timeout(probe, sizeof(probe), 19));
  const uint8_t zero[] = {0, 0};
  assert(!pocket_i2c_esp_probe_timeout(zero, sizeof(zero), 100));
  puts("I2C descriptor admission: passed");
}
