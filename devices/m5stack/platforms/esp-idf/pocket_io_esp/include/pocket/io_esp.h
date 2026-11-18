#pragma once
#include "driver/i2c_master.h"
#include "driver/uart.h"
#include "pocket/worker.h"
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct pocket_i2c_esp pocket_i2c_esp;
typedef struct pocket_uart_esp pocket_uart_esp;

typedef struct {
  uint32_t struct_size;
  /* A hardware bus the node shares with board-native users. NULL selects a
   * software bus on sda_pin and scl_pin, configured while a handle is open
   * and reset when the last one closes. */
  i2c_master_bus_handle_t bus;
  int sda_pin, scl_pin;
  uint32_t speed_hz, max_transaction_bytes, max_timeout_ms;
  int task_core;
  /* Heap capabilities of the executor's stack; 0 for internal RAM. */
  uint32_t task_stack_caps;
} pocket_i2c_esp_config;

/* A worker may open any 7-bit address 0x08..0x77; open handles share the
 * bus and the IDF bus lock serializes them with board-native transfers. */
pocket_i2c_esp *pocket_i2c_esp_create(const pocket_i2c_esp_config *config);
const pocket_worker_driver *pocket_i2c_esp_driver(pocket_i2c_esp *driver);
/* Call after the worker core has closed all handles and stopped producers. */
int32_t pocket_i2c_esp_destroy(pocket_i2c_esp *driver);

typedef struct {
  uint32_t struct_size;
  uart_port_t port;
  int tx_pin, rx_pin, rts_pin, cts_pin;
  uint32_t max_baud;
  bool loopback;
  /* RS485 half duplex: rts_pin drives the transceiver's driver enable while
   * the UART transmits. Excludes RTS/CTS flow control. */
  bool rs485;
  int task_core;
} pocket_uart_esp_config;

pocket_uart_esp *pocket_uart_esp_create(const pocket_uart_esp_config *config);
const pocket_worker_driver *pocket_uart_esp_driver(pocket_uart_esp *driver);
int32_t pocket_uart_esp_destroy(pocket_uart_esp *driver);

#ifdef __cplusplus
}
#endif
