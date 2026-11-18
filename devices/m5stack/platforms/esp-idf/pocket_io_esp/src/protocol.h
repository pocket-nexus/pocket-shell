#pragma once
#include <stddef.h>
#include <stdint.h>
#define POCKET_I2C_ESP_STEPS 8
/* Internal checked view. Script bytes stay owned by the request until done.
 * op 1 is a register read, op 2 a register write, op 3 a read with no
 * register phase. */
typedef struct {
  uint8_t op, reg;
  uint16_t length;
  const uint8_t *data;
} pocket_i2c_esp_step;
typedef struct {
  uint16_t timeout_ms;
  uint8_t count;
  size_t read_length;
  pocket_i2c_esp_step steps[POCKET_I2C_ESP_STEPS];
} pocket_i2c_esp_script;
int pocket_i2c_esp_decode(const uint8_t *data, size_t size,
                          size_t result_capacity, uint32_t max_bytes,
                          uint32_t max_timeout_ms, pocket_i2c_esp_script *out);
/* Opcode 2: an address-only probe whose payload is the timeout in
 * milliseconds as two little-endian bytes. Returns the timeout, 0 when the
 * payload is invalid. */
uint16_t pocket_i2c_esp_probe_timeout(const uint8_t *data, size_t size,
                                      uint32_t max_timeout_ms);
