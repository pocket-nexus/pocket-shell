#include "driver/gpio.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pocket/io_esp.h"
#include <stdlib.h>
#include <string.h>

#define TX_CAPACITY 1024u
#define RX_CAPACITY 2048u
#define CHUNK_SIZE 256u

struct pocket_uart_esp {
  pocket_worker_driver vtable;
  pocket_uart_esp_config config;
  SemaphoreHandle_t mutex, stopped;
  QueueHandle_t events;
  pocket_worker *worker;
  uint32_t handle;
  bool closing, installed, flow_control, ended;
  uint8_t tx[TX_CAPACITY];
  size_t tx_read, tx_write, tx_used;
};

static void notify(pocket_uart_esp *driver) {
  const uart_event_t event = {.type = UART_EVENT_MAX};
  xQueueSend(driver->events, &event, 0);
}

static void uart_task(void *opaque) {
  pocket_uart_esp *driver = opaque;
  uint64_t offset = 0;
  uint8_t bytes[CHUNK_SIZE];
  size_t pending = 0, event_remaining = 0;
  bool retry = false, credit_dirty = false;
  for (;;) {
    xSemaphoreTake(driver->mutex, portMAX_DELAY);
    const bool closing = driver->closing;
    size_t count = driver->tx_used;
    if (count > CHUNK_SIZE)
      count = CHUNK_SIZE;
    if (count > TX_CAPACITY - driver->tx_read)
      count = TX_CAPACITY - driver->tx_read;
    if (!closing && count) {
      /* No IDF TX ring: this copies only the available FIFO prefix and never
       * blocks the JS owner. The application ring retains the remainder. */
      const int sent =
          uart_tx_chars(driver->config.port,
                        (const char *)driver->tx + driver->tx_read, count);
      if (sent > 0) {
        driver->tx_read = (driver->tx_read + (size_t)sent) % TX_CAPACITY;
        driver->tx_used -= (size_t)sent;
        credit_dirty = true;
      }
    }
    const bool tx_pending = driver->tx_used != 0;
    const size_t credit = TX_CAPACITY - driver->tx_used;
    xSemaphoreGive(driver->mutex);
    if (closing)
      break;
    if (credit_dirty &&
        pocket_worker_emit(driver->worker, driver->handle, POCKET_WORKER_CREDIT,
                           POCKET_WORKER_OK, credit, NULL,
                           0) == POCKET_WORKER_OK)
      credit_dirty = false;

    uart_event_t event = {.type = UART_EVENT_MAX};
    bool have_event = false;
    if (!event_remaining && !pending) {
      size_t buffered = 0;
      uart_get_buffered_data_len(driver->config.port, &buffered);
      const TickType_t wait =
          tx_pending || retry || credit_dirty || buffered ? 1 : portMAX_DELAY;
      have_event = xQueueReceive(driver->events, &event, wait) == pdTRUE;
      if (have_event && event.type == UART_DATA)
        event_remaining = event.size;
      if (!have_event) {
        uart_get_buffered_data_len(driver->config.port, &buffered);
        if (buffered) {
          /* IDF's bounded event queue can drop an event while native bytes
           * remain. Wait one tick for concurrent publication, then terminate
           * the unknowable boundary rather than reading unaccounted bytes. */
          event.type = UART_BUFFER_FULL;
          have_event = true;
        }
      }
    } else if (retry) {
      vTaskDelay(1);
    }
    if (have_event &&
        (event.type == UART_FIFO_OVF || event.type == UART_BUFFER_FULL ||
         event.type == UART_FRAME_ERR || event.type == UART_PARITY_ERR ||
         event.type == UART_BREAK)) {
      /* Hardware does not supply a reliable lost-byte count. End at the known
       * prefix; a parser must reopen instead of joining bytes across the gap.
       */
      pocket_worker_gap(driver->worker, driver->handle, offset, UINT64_MAX);
      pocket_worker_end(driver->worker, driver->handle, POCKET_WORKER_UNKNOWN,
                        offset);
      xSemaphoreTake(driver->mutex, portMAX_DELAY);
      driver->ended = true;
      xSemaphoreGive(driver->mutex);
      break;
    }
    retry = false;
    for (unsigned batch = 0; batch < 4; ++batch) {
      if (!pending) {
        if (!event_remaining)
          break;
        const size_t requested =
            event_remaining < sizeof(bytes) ? event_remaining : sizeof(bytes);
        const int got =
            uart_read_bytes(driver->config.port, bytes, requested, 0);
        if (got <= 0) {
          /* An event promised bytes that are no longer in the native ring.
           * The boundary is unknowable; stop instead of consuming a later
           * event. */
          pocket_worker_gap(driver->worker, driver->handle, offset, UINT64_MAX);
          pocket_worker_end(driver->worker, driver->handle,
                            POCKET_WORKER_UNKNOWN, offset);
          xSemaphoreTake(driver->mutex, portMAX_DELAY);
          driver->ended = true;
          xSemaphoreGive(driver->mutex);
          goto stopped;
        }
        pending = (size_t)got;
        event_remaining -= pending;
      }
      const int32_t accepted =
          pocket_worker_emit(driver->worker, driver->handle, POCKET_WORKER_DATA,
                             POCKET_WORKER_OK, offset, bytes, pending);
      if (accepted == POCKET_WORKER_BUSY && driver->flow_control) {
        retry = true;
        break;
      }
      if (accepted != POCKET_WORKER_OK) {
        if (accepted != POCKET_WORKER_BUSY)
          goto stopped;
        pocket_worker_gap(driver->worker, driver->handle, offset, pending);
      }
      offset += pending;
      pending = 0;
      /* Never read past UART_DATA.size: the next queue entry may be an error
       * marking a discontinuity before the subsequent native bytes. */
      retry = event_remaining != 0;
    }
  }
stopped:
  if (!driver->ended)
    pocket_worker_end(driver->worker, driver->handle, POCKET_WORKER_CANCELLED,
                      offset);
  xSemaphoreGive(driver->stopped);
  vTaskDelete(NULL);
}

static int32_t driver_open(void *opaque, pocket_worker *worker, uint32_t handle,
                           const uint8_t *bytes, size_t length) {
  pocket_uart_esp *driver = opaque;
  if (!bytes || length != 9 || bytes[0] != 1 || bytes[1] < 5 || bytes[1] > 8 ||
      (bytes[2] != 1 && bytes[2] != 2) || bytes[3] > 2 || bytes[8] > 1)
    return POCKET_WORKER_INVALID;
  const uint32_t baud = (uint32_t)bytes[4] | (uint32_t)bytes[5] << 8 |
                        (uint32_t)bytes[6] << 16 | (uint32_t)bytes[7] << 24;
  if (!baud || baud > driver->config.max_baud ||
      (bytes[8] && (driver->config.rs485 || driver->config.rts_pin < 0 ||
                    driver->config.cts_pin < 0)))
    return POCKET_WORKER_INVALID;
  if (driver->installed)
    return POCKET_WORKER_BUSY;
  const uart_config_t config = {
      .baud_rate = (int)baud,
      .data_bits = (uart_word_length_t)(bytes[1] - 5),
      .parity = bytes[3] == 0   ? UART_PARITY_DISABLE
                : bytes[3] == 1 ? UART_PARITY_ODD
                                : UART_PARITY_EVEN,
      .stop_bits = bytes[2] == 1 ? UART_STOP_BITS_1 : UART_STOP_BITS_2,
      .flow_ctrl =
          bytes[8] ? UART_HW_FLOWCTRL_CTS_RTS : UART_HW_FLOWCTRL_DISABLE,
      .rx_flow_ctrl_thresh = 64,
      .source_clk = UART_SCLK_DEFAULT,
  };
  if (uart_driver_install(driver->config.port, RX_CAPACITY, 0, 16,
                          &driver->events, 0) != ESP_OK)
    return POCKET_WORKER_FAILED;
  driver->installed = true;
  if (uart_param_config(driver->config.port, &config) != ESP_OK ||
      uart_set_pin(driver->config.port, driver->config.tx_pin,
                   driver->config.rx_pin, driver->config.rts_pin,
                   driver->config.cts_pin) != ESP_OK ||
      uart_set_loop_back(driver->config.port, driver->config.loopback) !=
          ESP_OK)
    goto failed;
  /* The driver raises RTS (the transceiver's driver enable) while bytes
   * leave the FIFO and drops it at TX done; a read times out after three
   * idle symbols. */
  if (driver->config.rs485 &&
      (uart_set_mode(driver->config.port, UART_MODE_RS485_HALF_DUPLEX) !=
           ESP_OK ||
       uart_set_rx_timeout(driver->config.port, 3) != ESP_OK))
    goto failed;
  /* Pin routing/loopback changes can leave a partial frame in the FIFO.
   * No application data exists until open completes; discard this startup
   * interval before granting the resource and publishing READY. */
  vTaskDelay(pdMS_TO_TICKS(2));
  uart_flush_input(driver->config.port);
  xQueueReset(driver->events);
  driver->worker = worker;
  driver->handle = handle;
  driver->closing = driver->ended = false;
  driver->flow_control = bytes[8] != 0;
  driver->tx_read = driver->tx_write = driver->tx_used = 0;
  if (xTaskCreatePinnedToCore(uart_task, "pocket_uart", 4096, driver, 4, NULL,
                              driver->config.task_core) != pdPASS)
    goto failed;
  return POCKET_WORKER_OK;
failed:
  uart_driver_delete(driver->config.port);
  driver->installed = false;
  driver->worker = NULL;
  driver->handle = 0;
  return POCKET_WORKER_FAILED;
}

static int32_t driver_write(void *opaque, pocket_worker *worker,
                            uint32_t handle, const uint8_t *bytes,
                            size_t length) {
  (void)worker;
  pocket_uart_esp *driver = opaque;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  if (!driver->installed || driver->closing || driver->ended ||
      handle != driver->handle) {
    xSemaphoreGive(driver->mutex);
    return POCKET_WORKER_INVALID;
  }
  size_t accepted = TX_CAPACITY - driver->tx_used;
  if (accepted > length)
    accepted = length;
  size_t first = TX_CAPACITY - driver->tx_write;
  if (first > accepted)
    first = accepted;
  memcpy(driver->tx + driver->tx_write, bytes, first);
  memcpy(driver->tx, bytes + first, accepted - first);
  driver->tx_write = (driver->tx_write + accepted) % TX_CAPACITY;
  driver->tx_used += accepted;
  xSemaphoreGive(driver->mutex);
  notify(driver);
  return (int32_t)accepted;
}

static int32_t driver_close(void *opaque, pocket_worker *worker,
                            uint32_t handle) {
  (void)worker;
  pocket_uart_esp *driver = opaque;
  if (!driver->installed || driver->handle != handle)
    return POCKET_WORKER_OK;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  driver->closing = true;
  xSemaphoreGive(driver->mutex);
  notify(driver);
  if (xSemaphoreTake(driver->stopped, 0) != pdTRUE)
    return POCKET_WORKER_BUSY;
  /* The task has stopped calling the core before native buffers are freed. */
  const esp_err_t status = uart_driver_delete(driver->config.port);
  if (status != ESP_OK) {
    xSemaphoreGive(driver->stopped);
    return POCKET_WORKER_BUSY;
  }
  gpio_reset_pin(driver->config.tx_pin);
  gpio_reset_pin(driver->config.rx_pin);
  if (driver->config.rts_pin >= 0)
    gpio_reset_pin(driver->config.rts_pin);
  if (driver->config.cts_pin >= 0)
    gpio_reset_pin(driver->config.cts_pin);
  driver->installed = false;
  driver->worker = NULL;
  driver->handle = 0;
  return POCKET_WORKER_OK;
}

pocket_uart_esp *pocket_uart_esp_create(const pocket_uart_esp_config *config) {
  if (!config || config->struct_size < sizeof(*config) || config->port < 0 ||
      config->port >= UART_NUM_MAX || !config->max_baud ||
      config->max_baud > 3000000 || config->tx_pin < 0 || config->rx_pin < 0 ||
      (config->rs485 && config->rts_pin < 0))
    return NULL;
  pocket_uart_esp *driver = calloc(1, sizeof(*driver));
  if (!driver)
    return NULL;
  driver->config = *config;
  driver->mutex = xSemaphoreCreateMutex();
  driver->stopped = xSemaphoreCreateBinary();
  if (!driver->mutex || !driver->stopped) {
    if (driver->mutex)
      vSemaphoreDelete(driver->mutex);
    if (driver->stopped)
      vSemaphoreDelete(driver->stopped);
    free(driver);
    return NULL;
  }
  driver->vtable = (pocket_worker_driver){.struct_size = sizeof(driver->vtable),
                                          .context = driver,
                                          .open = driver_open,
                                          .write = driver_write,
                                          .close = driver_close};
  return driver;
}

const pocket_worker_driver *pocket_uart_esp_driver(pocket_uart_esp *driver) {
  return driver ? &driver->vtable : NULL;
}

int32_t pocket_uart_esp_destroy(pocket_uart_esp *driver) {
  if (!driver)
    return POCKET_WORKER_OK;
  if (driver->installed)
    return POCKET_WORKER_BUSY;
  vSemaphoreDelete(driver->stopped);
  vSemaphoreDelete(driver->mutex);
  free(driver);
  return POCKET_WORKER_OK;
}
