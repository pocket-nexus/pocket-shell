#include "driver/gpio.h"
#include "esp_heap_caps.h"
#include "esp_rom_sys.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/idf_additions.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "pocket/io_esp.h"
#include "protocol.h"
#include <stdlib.h>
#include <string.h>

#define DEVICE_COUNT 8
#define REQUEST_COUNT 8
#define EXECUTOR_STACK 6144

typedef struct {
  uint8_t address;
  uint32_t handle;
  unsigned active;
  bool closing;
} device_slot;
typedef struct {
  bool used, cancelled, started;
  uint32_t request, opcode;
  pocket_worker *worker;
  device_slot *device;
  size_t length, capacity;
  uint8_t data[POCKET_WORKER_MAX_PAYLOAD];
} request_slot;
struct pocket_i2c_esp {
  pocket_worker_driver vtable;
  pocket_i2c_esp_config config;
  SemaphoreHandle_t mutex, stopped;
  QueueHandle_t queue;
  /* The hardware bus's one device: each transfer carries its own address
   * byte, so every open handle shares it. */
  i2c_master_dev_handle_t device;
  /* The software bus's pins are set up while a handle is open. */
  bool pins_ready;
  uint32_t half_period_us;
  device_slot devices[DEVICE_COUNT];
  request_slot requests[REQUEST_COUNT];
  bool stopping;
};

static device_slot *lookup(pocket_i2c_esp *driver, uint32_t handle) {
  for (size_t i = 0; i < DEVICE_COUNT; ++i)
    if (driver->devices[i].handle == handle)
      return &driver->devices[i];
  return NULL;
}

static size_t open_handles(const pocket_i2c_esp *driver) {
  size_t count = 0;
  for (size_t i = 0; i < DEVICE_COUNT; ++i)
    count += driver->devices[i].handle != 0;
  return count;
}

/* ---- software bus -------------------------------------------------------- */

/* Open-drain lines with the internal pull-ups; a line is released by
 * writing 1 and driven low by writing 0. */
static void soft_pins_setup(pocket_i2c_esp *driver) {
  const gpio_config_t config = {
      .pin_bit_mask =
          (1ULL << driver->config.sda_pin) | (1ULL << driver->config.scl_pin),
      .mode = GPIO_MODE_INPUT_OUTPUT_OD,
      .pull_up_en = GPIO_PULLUP_ENABLE,
  };
  gpio_set_level(driver->config.sda_pin, 1);
  gpio_set_level(driver->config.scl_pin, 1);
  gpio_config(&config);
  driver->pins_ready = true;
}

static void soft_pins_reset(pocket_i2c_esp *driver) {
  gpio_reset_pin(driver->config.sda_pin);
  gpio_reset_pin(driver->config.scl_pin);
  driver->pins_ready = false;
}

typedef struct {
  pocket_i2c_esp *driver;
  int64_t deadline;
  bool failed;
} soft_bus;

static void soft_delay(soft_bus *bus) {
  esp_rom_delay_us(bus->driver->half_period_us);
}

/* Release SCL and wait while a device stretches the clock. */
static void soft_scl_high(soft_bus *bus) {
  gpio_set_level(bus->driver->config.scl_pin, 1);
  while (!gpio_get_level(bus->driver->config.scl_pin)) {
    if (esp_timer_get_time() > bus->deadline) {
      bus->failed = true;
      return;
    }
    esp_rom_delay_us(1);
  }
  soft_delay(bus);
}

static void soft_scl_low(soft_bus *bus) {
  gpio_set_level(bus->driver->config.scl_pin, 0);
  soft_delay(bus);
}

static void soft_start(soft_bus *bus) {
  const int sda = bus->driver->config.sda_pin;
  gpio_set_level(sda, 1);
  soft_scl_high(bus);
  gpio_set_level(sda, 0);
  soft_delay(bus);
  soft_scl_low(bus);
}

static void soft_stop(soft_bus *bus) {
  const int sda = bus->driver->config.sda_pin;
  gpio_set_level(sda, 0);
  soft_delay(bus);
  soft_scl_high(bus);
  gpio_set_level(sda, 1);
  soft_delay(bus);
}

/* One byte out, MSB first; false when the device did not acknowledge. */
static bool soft_write(soft_bus *bus, uint8_t byte) {
  const int sda = bus->driver->config.sda_pin;
  for (int bit = 7; bit >= 0 && !bus->failed; --bit) {
    gpio_set_level(sda, (byte >> bit) & 1);
    soft_delay(bus);
    soft_scl_high(bus);
    soft_scl_low(bus);
  }
  gpio_set_level(sda, 1);
  soft_delay(bus);
  soft_scl_high(bus);
  const bool ack = !gpio_get_level(sda);
  soft_scl_low(bus);
  return ack && !bus->failed;
}

static uint8_t soft_read(soft_bus *bus, bool ack) {
  const int sda = bus->driver->config.sda_pin;
  uint8_t byte = 0;
  gpio_set_level(sda, 1);
  for (int bit = 7; bit >= 0 && !bus->failed; --bit) {
    soft_scl_high(bus);
    byte |= (uint8_t)(gpio_get_level(sda) << bit);
    soft_scl_low(bus);
  }
  gpio_set_level(sda, ack ? 0 : 1);
  soft_delay(bus);
  soft_scl_high(bus);
  soft_scl_low(bus);
  gpio_set_level(sda, 1);
  return byte;
}

static esp_err_t soft_execute(pocket_i2c_esp *driver, const device_slot *device,
                              const pocket_i2c_esp_script *script,
                              uint8_t *result) {
  soft_bus bus = {.driver = driver,
                  .deadline = esp_timer_get_time() +
                              (int64_t)script->timeout_ms * 1000};
  size_t read_offset = 0;
  bool acked = true;
  for (size_t i = 0; i < script->count && acked && !bus.failed; ++i) {
    const pocket_i2c_esp_step *step = &script->steps[i];
    soft_start(&bus);
    if (step->op != 3)
      acked = soft_write(&bus, (uint8_t)(device->address << 1)) &&
              soft_write(&bus, step->reg);
    if (step->op == 2) {
      for (size_t j = 0; j < step->length && acked; ++j)
        acked = soft_write(&bus, step->data[j]);
    } else if (acked) {
      /* A register read repeats START; a receive starts here. */
      if (step->op == 1)
        soft_start(&bus);
      acked = soft_write(&bus, (uint8_t)(device->address << 1) | 1);
      for (size_t j = 0; j < step->length && acked && !bus.failed; ++j)
        result[read_offset + j] = soft_read(&bus, j + 1 < step->length);
      read_offset += step->length;
    }
  }
  soft_stop(&bus);
  if (bus.failed)
    return ESP_ERR_TIMEOUT;
  return acked ? ESP_OK : ESP_ERR_NOT_FOUND;
}

static esp_err_t soft_probe(pocket_i2c_esp *driver, const device_slot *device,
                            uint16_t timeout_ms) {
  soft_bus bus = {.driver = driver,
                  .deadline =
                      esp_timer_get_time() + (int64_t)timeout_ms * 1000};
  soft_start(&bus);
  const bool acked = soft_write(&bus, (uint8_t)(device->address << 1));
  soft_stop(&bus);
  if (bus.failed)
    return ESP_ERR_TIMEOUT;
  return acked ? ESP_OK : ESP_ERR_NOT_FOUND;
}

/* ---- hardware bus -------------------------------------------------------- */

/* Each descriptor becomes one IDF operation list, so the IDF bus semaphore
 * covers every repeated START through the final STOP, including board-native
 * transfers submitted through the same bus handle. */
static esp_err_t hard_execute(pocket_i2c_esp *driver, const device_slot *device,
                              const pocket_i2c_esp_script *script,
                              uint8_t *result) {
  i2c_operation_job_t ops[8];
  uint8_t address_read[POCKET_I2C_ESP_STEPS];
  uint8_t transmit[512 + POCKET_I2C_ESP_STEPS * 2];
  size_t count = 0, read_offset = 0, tx_offset = 0;
  for (size_t i = 0; i < script->count; ++i) {
    const pocket_i2c_esp_step *step = &script->steps[i];
    if (step->op != 3) {
      const size_t tx_start = tx_offset;
      transmit[tx_offset++] = device->address << 1;
      transmit[tx_offset++] = step->reg;
      if (step->op == 2) {
        memcpy(transmit + tx_offset, step->data, step->length);
        tx_offset += step->length;
      }
      ops[count++] = (i2c_operation_job_t){.command = I2C_MASTER_CMD_START};
      ops[count++] =
          (i2c_operation_job_t){.command = I2C_MASTER_CMD_WRITE,
                                .write = {.ack_check = true,
                                          .data = transmit + tx_start,
                                          .total_bytes = tx_offset - tx_start}};
    }
    if (step->op != 2) {
      /* A register read repeats START after the register byte; a receive
       * has only this START. */
      address_read[i] = (device->address << 1) | 1;
      ops[count++] = (i2c_operation_job_t){.command = I2C_MASTER_CMD_START};
      ops[count++] = (i2c_operation_job_t){.command = I2C_MASTER_CMD_WRITE,
                                           .write = {.ack_check = true,
                                                     .data = &address_read[i],
                                                     .total_bytes = 1}};
      if (step->length > 1)
        ops[count++] =
            (i2c_operation_job_t){.command = I2C_MASTER_CMD_READ,
                                  .read = {.ack_value = I2C_ACK_VAL,
                                           .data = result + read_offset,
                                           .total_bytes = step->length - 1}};
      ops[count++] = (i2c_operation_job_t){
          .command = I2C_MASTER_CMD_READ,
          .read = {.ack_value = I2C_NACK_VAL,
                   .data = result + read_offset + step->length - 1,
                   .total_bytes = 1}};
      read_offset += step->length;
    }
  }
  ops[count++] = (i2c_operation_job_t){.command = I2C_MASTER_CMD_STOP};
  return i2c_master_execute_defined_operations(driver->device, ops, count,
                                               script->timeout_ms);
}

/* START, the address byte and STOP through the same defined-operation path
 * as the scripts. i2c_master_probe is not used: it leaves the ISR's read
 * position from an earlier aborted read in place, and the next completion
 * then writes through it. */
static esp_err_t hard_probe(pocket_i2c_esp *driver, const device_slot *device,
                            uint16_t timeout_ms) {
  const uint8_t address = device->address << 1;
  i2c_operation_job_t ops[] = {
      {.command = I2C_MASTER_CMD_START},
      {.command = I2C_MASTER_CMD_WRITE,
       .write = {.ack_check = true, .data = &address, .total_bytes = 1}},
      {.command = I2C_MASTER_CMD_STOP},
  };
  return i2c_master_execute_defined_operations(driver->device, ops, 3,
                                               timeout_ms);
}

/* ---- driver -------------------------------------------------------------- */

static int32_t driver_open(void *opaque, pocket_worker *worker, uint32_t handle,
                           const uint8_t *bytes, size_t length) {
  (void)worker;
  pocket_i2c_esp *driver = opaque;
  if (!bytes || length != 2 || bytes[0] != 1 || bytes[1] < 0x08 ||
      bytes[1] > 0x77)
    return POCKET_WORKER_INVALID;
  int32_t status = POCKET_WORKER_BUSY;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  for (size_t i = 0; i < DEVICE_COUNT && !driver->stopping; ++i) {
    device_slot *device = &driver->devices[i];
    if (device->handle != 0 || device->active)
      continue;
    if (!driver->config.bus && !driver->pins_ready)
      soft_pins_setup(driver);
    *device = (device_slot){.address = bytes[1], .handle = handle};
    status = POCKET_WORKER_OK;
    break;
  }
  xSemaphoreGive(driver->mutex);
  return status;
}

static int32_t driver_validate(void *opaque, pocket_worker *worker,
                               uint32_t handle, uint32_t opcode,
                               const uint8_t *bytes, size_t length,
                               size_t capacity) {
  (void)worker;
  (void)handle;
  pocket_i2c_esp *driver = opaque;
  pocket_i2c_esp_script script;
  if (opcode == 2)
    return pocket_i2c_esp_probe_timeout(bytes, length,
                                        driver->config.max_timeout_ms)
               ? POCKET_WORKER_OK
               : POCKET_WORKER_INVALID;
  return opcode == 1 && length <= POCKET_WORKER_MAX_PAYLOAD &&
                 pocket_i2c_esp_decode(bytes, length, capacity,
                                       driver->config.max_transaction_bytes,
                                       driver->config.max_timeout_ms, &script)
             ? POCKET_WORKER_OK
             : POCKET_WORKER_INVALID;
}

static int32_t driver_start(void *opaque, pocket_worker *worker,
                            uint32_t handle, uint32_t request, uint32_t opcode,
                            const uint8_t *bytes, size_t length,
                            size_t result_capacity) {
  pocket_i2c_esp *driver = opaque;
  pocket_i2c_esp_script script;
  const bool valid =
      opcode == 2 ? pocket_i2c_esp_probe_timeout(
                        bytes, length, driver->config.max_timeout_ms) != 0
      : opcode == 1
          ? length <= POCKET_WORKER_MAX_PAYLOAD &&
                pocket_i2c_esp_decode(bytes, length, result_capacity,
                                      driver->config.max_transaction_bytes,
                                      driver->config.max_timeout_ms, &script)
          : false;
  if (!valid)
    return POCKET_WORKER_INVALID;
  int32_t status = POCKET_WORKER_BUSY;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  device_slot *device = lookup(driver, handle);
  if (device && !device->closing && !driver->stopping) {
    for (size_t i = 0; i < REQUEST_COUNT; ++i) {
      request_slot *slot = &driver->requests[i];
      if (slot->used)
        continue;
      *slot = (request_slot){.used = true,
                             .request = request,
                             .opcode = opcode,
                             .worker = worker,
                             .device = device,
                             .length = length,
                             .capacity = result_capacity};
      memcpy(slot->data, bytes, length);
      ++device->active;
      if (xQueueSend(driver->queue, &slot, 0) == pdTRUE) {
        status = POCKET_WORKER_OK;
      } else {
        slot->used = false;
        --device->active;
      }
      break;
    }
  }
  xSemaphoreGive(driver->mutex);
  return status;
}

static void executor(void *opaque) {
  pocket_i2c_esp *driver = opaque;
  request_slot *slot;
  while (xQueueReceive(driver->queue, &slot, portMAX_DELAY) == pdTRUE && slot) {
    xSemaphoreTake(driver->mutex, portMAX_DELAY);
    const bool cancelled = slot->cancelled || slot->device->closing;
    slot->started = !cancelled;
    const device_slot device = *slot->device;
    xSemaphoreGive(driver->mutex);
    int32_t status = POCKET_WORKER_CANCELLED;
    uint8_t result[POCKET_WORKER_MAX_PAYLOAD];
    size_t length = 0;
    if (!cancelled && slot->opcode == 2) {
      const uint16_t timeout = pocket_i2c_esp_probe_timeout(
          slot->data, slot->length, driver->config.max_timeout_ms);
      const esp_err_t err = driver->config.bus
                                ? hard_probe(driver, &device, timeout)
                                : soft_probe(driver, &device, timeout);
      /* A probe writes nothing: an unanswered address is a plain failure. */
      status = err == ESP_OK ? POCKET_WORKER_OK : POCKET_WORKER_FAILED;
    } else if (!cancelled) {
      pocket_i2c_esp_script script;
      if (pocket_i2c_esp_decode(slot->data, slot->length, slot->capacity,
                                driver->config.max_transaction_bytes,
                                driver->config.max_timeout_ms, &script)) {
        const esp_err_t err =
            driver->config.bus ? hard_execute(driver, &device, &script, result)
                               : soft_execute(driver, &device, &script, result);
        /* Neither bus can report which writes took effect before a NACK or
         * timeout. */
        status = err == ESP_OK ? POCKET_WORKER_OK : POCKET_WORKER_UNKNOWN;
        if (status == POCKET_WORKER_OK)
          length = script.read_length;
      } else {
        status = POCKET_WORKER_INVALID;
      }
    }
    xSemaphoreTake(driver->mutex, portMAX_DELAY);
    if (slot->started && slot->cancelled) {
      status = POCKET_WORKER_UNKNOWN;
      length = 0;
    }
    const uint32_t request = slot->request;
    pocket_worker *worker = slot->worker;
    /* Keep active set until complete has returned: close cannot reclaim the
     * worker while the executor is still publishing its completion. */
    xSemaphoreGive(driver->mutex);
    pocket_worker_complete(worker, request, status, result, length);
    xSemaphoreTake(driver->mutex, portMAX_DELAY);
    --slot->device->active;
    slot->used = false;
    xSemaphoreGive(driver->mutex);
  }
  xSemaphoreGive(driver->stopped);
  vTaskDelete(NULL);
}

static void driver_cancel(void *opaque, pocket_worker *worker, uint32_t handle,
                          uint32_t request) {
  (void)worker;
  (void)handle;
  pocket_i2c_esp *driver = opaque;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  for (size_t i = 0; i < REQUEST_COUNT; ++i)
    if (driver->requests[i].used && driver->requests[i].request == request)
      driver->requests[i].cancelled = true;
  xSemaphoreGive(driver->mutex);
}

static int32_t driver_close(void *opaque, pocket_worker *worker,
                            uint32_t handle) {
  (void)worker;
  pocket_i2c_esp *driver = opaque;
  int32_t status = POCKET_WORKER_OK;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  device_slot *device = lookup(driver, handle);
  if (device) {
    device->closing = true;
    if (device->active) {
      status = POCKET_WORKER_BUSY;
    } else {
      device->handle = 0;
      if (!driver->config.bus && driver->pins_ready && !open_handles(driver))
        soft_pins_reset(driver);
    }
  }
  xSemaphoreGive(driver->mutex);
  return status;
}

static bool valid_pin(int pin) {
  return pin >= 0 && GPIO_IS_VALID_OUTPUT_GPIO(pin);
}

pocket_i2c_esp *pocket_i2c_esp_create(const pocket_i2c_esp_config *config) {
  if (!config || config->struct_size < sizeof(*config) ||
      config->speed_hz < 10000 || config->speed_hz > 400000 ||
      !config->max_transaction_bytes || config->max_transaction_bytes > 512 ||
      !config->max_timeout_ms || config->max_timeout_ms > 100)
    return NULL;
  if (!config->bus &&
      (!valid_pin(config->sda_pin) || !valid_pin(config->scl_pin) ||
       config->sda_pin == config->scl_pin))
    return NULL;
  pocket_i2c_esp *driver = calloc(1, sizeof(*driver));
  if (!driver)
    return NULL;
  driver->config = *config;
  driver->half_period_us = (500000U + config->speed_hz - 1U) / config->speed_hz;
  driver->mutex = xSemaphoreCreateMutex();
  driver->stopped = xSemaphoreCreateBinary();
  driver->queue = xQueueCreate(REQUEST_COUNT, sizeof(request_slot *));
  if (!driver->mutex || !driver->stopped || !driver->queue)
    goto failed;
  if (config->bus) {
    const i2c_device_config_t device = {.dev_addr_length = I2C_ADDR_BIT_LEN_7,
                                        .device_address =
                                            I2C_DEVICE_ADDRESS_NOT_USED,
                                        .scl_speed_hz = config->speed_hz};
    if (i2c_master_bus_add_device(config->bus, &device, &driver->device) !=
        ESP_OK)
      goto failed;
  }
  driver->vtable = (pocket_worker_driver){.struct_size = sizeof(driver->vtable),
                                          .context = driver,
                                          .open = driver_open,
                                          .start = driver_start,
                                          .validate = driver_validate,
                                          .cancel = driver_cancel,
                                          .close = driver_close};
  const BaseType_t created =
      config->task_stack_caps
          ? xTaskCreatePinnedToCoreWithCaps(
                executor, "pocket_i2c", EXECUTOR_STACK, driver, 4, NULL,
                config->task_core, config->task_stack_caps)
          : xTaskCreatePinnedToCore(executor, "pocket_i2c", EXECUTOR_STACK,
                                    driver, 4, NULL, config->task_core);
  if (created != pdPASS)
    goto failed;
  return driver;
failed:
  if (driver->device)
    i2c_master_bus_rm_device(driver->device);
  if (driver->queue)
    vQueueDelete(driver->queue);
  if (driver->stopped)
    vSemaphoreDelete(driver->stopped);
  if (driver->mutex)
    vSemaphoreDelete(driver->mutex);
  free(driver);
  return NULL;
}

const pocket_worker_driver *pocket_i2c_esp_driver(pocket_i2c_esp *driver) {
  return driver ? &driver->vtable : NULL;
}

int32_t pocket_i2c_esp_destroy(pocket_i2c_esp *driver) {
  if (!driver)
    return POCKET_WORKER_OK;
  xSemaphoreTake(driver->mutex, portMAX_DELAY);
  for (size_t i = 0; i < DEVICE_COUNT; ++i) {
    if (driver->devices[i].handle || driver->devices[i].active) {
      xSemaphoreGive(driver->mutex);
      return POCKET_WORKER_BUSY;
    }
  }
  driver->stopping = true;
  xSemaphoreGive(driver->mutex);
  request_slot *stop = NULL;
  xQueueSend(driver->queue, &stop, portMAX_DELAY);
  xSemaphoreTake(driver->stopped, portMAX_DELAY);
  if (driver->device)
    i2c_master_bus_rm_device(driver->device);
  vQueueDelete(driver->queue);
  vSemaphoreDelete(driver->stopped);
  vSemaphoreDelete(driver->mutex);
  free(driver);
  return POCKET_WORKER_OK;
}
