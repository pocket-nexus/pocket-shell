/*
 * `globalThis.device` on the M5Stack Tab5 (contracts/spec/device.ts).
 *
 * The two PI4IOE5V6408 IO expanders on the system I2C bus carry the power
 * rails and the plug detection; the BSP owns their handles and this file
 * sets and reads pins through the same esp_io_expander driver:
 *
 *   0x43 P0 RF switch (1: external antenna)   0x44 P3 USB-A 5V output
 *        P2 EXT 5V output                          P4 power-off pulse
 *        P7 headphone detect (input)               P5 QC charging (0: on)
 *                                                  P6 USB-C detect (input)
 *                                                  P7 battery charging
 *
 * The backlight is the BSP's LEDC channel on GPIO 22, the temperature the
 * SoC's sensor, USB-A presence the USB host library's device events. Every
 * op runs on this component's task, whose stack is internal RAM: the guest's
 * stack is PSRAM, and the card's FAT reads go through the SPI driver.
 */

#include "pocket/device.h"

#include <dirent.h>
#include <inttypes.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>

#include "bsp/display.h"
#include "bsp/m5stack_tab5.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "driver/temperature_sensor.h"
#include "esp_io_expander.h"
#include "esp_log.h"
#include "esp_vfs_fat.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "usb/usb_host.h"

static const char *TAG = "pocket_device";

#define DEVICE_TASK_STACK 6144
#define USB_TASK_STACK 3072
#define STATUS_BYTES 1536
#define DIRECTORY_BYTES 6144
#define DIRECTORY_MAX_ENTRIES 64
#define PATH_MAX_BYTES 128
#define MAX_PINS 32
/* The ST712x touch controller reports its firmware at register 0x0000:
 * 1 on the ST7121 panel, 3 on the ST7123. */
#define TOUCH_ST712X_ADDRESS 0x55
#define TOUCH_GT911_ADDRESS 0x14
#define TOUCH_GT911_ADDRESS_BACKUP 0x5D

enum { EXP0, EXP1 };

typedef struct {
  const char *id;
  const char *label;
  uint8_t expander;
  uint8_t pin;
  /* The pin level that turns the switch on. */
  uint8_t on_level;
  /* The board's default. */
  bool on_default;
} switch_t;

static const switch_t SWITCHES[] = {
    {"charge", "Battery charging", EXP1, 7, 1, true},
    {"quick-charge", "QC charging", EXP1, 5, 0, true},
    {"usb-5v", "USB-A 5V output", EXP1, 3, 1, true},
    {"ext-5v", "EXT 5V output", EXP0, 2, 1, true},
    {"antenna", "External antenna", EXP0, 0, 1, false},
};
#define SWITCH_COUNT (sizeof SWITCHES / sizeof SWITCHES[0])

#define POWER_OFF_PIN 4
/* SWITCHES[0], on at boot only with a battery (battery_present). */
#define CHARGE_SWITCH 0
/* The battery monitor (INA226) and the least bus voltage of a 2S pack. */
#define INA226_ADDRESS 0x41
#define INA226_BUS_VOLTAGE 0x02
#define BATTERY_MIN_MV 5000U
#define USB_C_DETECT_PIN 6
#define HEADPHONE_DETECT_PIN 7

static struct {
  pocket_device_config_t config;
  uint8_t pins[MAX_PINS];
  esp_io_expander_handle_t expanders[2];
  temperature_sensor_handle_t temperature;
  bool switch_on[SWITCH_COUNT];
  uint32_t brightness;
  uint32_t system_brightness;
  uint64_t driven_pins;
  char error[96];
  /* USB-A: devices the host library reports attached. */
  volatile int usb_devices;
  usb_host_client_handle_t usb_client;
  bool usb_ready;
  /* The card's figures: FAT counts free clusters by reading the whole
   * table (about 400 ms on a 32 GB card), so they are read at setup and
   * with each listing, not with each status. */
  bool card_mounted;
  uint64_t card_total, card_free;
  /* The task every op runs on. */
  TaskHandle_t task;
  SemaphoreHandle_t busy, ready, done;
  void (*job)(void *);
  void *job_context;
  char status[STATUS_BYTES];
  char directory[DIRECTORY_BYTES];
} device;

/* ---- the op task ----------------------------------------------------------
 */

static void device_main(void *unused) {
  (void)unused;
  for (;;) {
    xSemaphoreTake(device.ready, portMAX_DELAY);
    device.job(device.job_context);
    xSemaphoreGive(device.done);
  }
}

static void run(void (*job)(void *), void *context) {
  xSemaphoreTake(device.busy, portMAX_DELAY);
  device.job = job;
  device.job_context = context;
  xSemaphoreGive(device.ready);
  xSemaphoreTake(device.done, portMAX_DELAY);
  xSemaphoreGive(device.busy);
}

static void set_error(const char *text) {
  snprintf(device.error, sizeof device.error, "%s", text);
}

/* ---- panel ----------------------------------------------------------------
 */

const char *pocket_device_detect_panel(void) {
  i2c_master_bus_handle_t bus = bsp_i2c_get_handle();
  if (bus == NULL)
    return "";
  if (i2c_master_probe(bus, TOUCH_ST712X_ADDRESS, 100) == ESP_OK) {
    const i2c_device_config_t config = {.dev_addr_length = I2C_ADDR_BIT_LEN_7,
                                        .device_address = TOUCH_ST712X_ADDRESS,
                                        .scl_speed_hz = 400000};
    i2c_master_dev_handle_t touch = NULL;
    if (i2c_master_bus_add_device(bus, &config, &touch) != ESP_OK)
      return "";
    const uint8_t reg[2] = {0, 0};
    uint8_t version = 0;
    const esp_err_t read =
        i2c_master_transmit_receive(touch, reg, sizeof reg, &version, 1, 100);
    i2c_master_bus_rm_device(touch);
    if (read != ESP_OK)
      return "";
    return version == 1 ? "ST7121" : version == 3 ? "ST7123" : "";
  }
  if (i2c_master_probe(bus, TOUCH_GT911_ADDRESS, 100) == ESP_OK ||
      i2c_master_probe(bus, TOUCH_GT911_ADDRESS_BACKUP, 100) == ESP_OK)
    return "ILI9881C";
  return "";
}

/* ---- IO expanders ---------------------------------------------------------
 */

/* A PI4IOE5V6408 pin drives only with its direction bit set and its bit in
 * the Output High-Impedance register (0x07) clear. The driver's reset leaves
 * 0x07 at 0xFF, and set_dir does not touch it: a pin left there floats and
 * the expander's pull-down holds the rail's enable low. The level is latched
 * first, so the pin starts driving at it. */
static esp_err_t drive_pin(esp_io_expander_handle_t expander, uint32_t mask,
                           uint8_t level) {
  esp_err_t err = esp_io_expander_set_level(expander, mask, level);
  if (err == ESP_OK)
    err = esp_io_expander_set_output_mode(expander, mask,
                                          IO_EXPANDER_OUTPUT_MODE_PUSH_PULL);
  if (err == ESP_OK)
    err = esp_io_expander_set_dir(expander, mask, IO_EXPANDER_OUTPUT);
  return err;
}

static esp_err_t drive_switch(size_t index, bool on) {
  const switch_t *item = &SWITCHES[index];
  esp_io_expander_handle_t expander = device.expanders[item->expander];
  if (expander == NULL)
    return ESP_ERR_INVALID_STATE;
  const esp_err_t err = drive_pin(expander, 1U << item->pin,
                                  on ? item->on_level : !item->on_level);
  if (err == ESP_OK)
    device.switch_on[index] = on;
  return err;
}

/* Whether a battery holds up the INA226's bus, read before charging is
 * enabled. Without a battery an enabled charger cycles its output between
 * about 8.4 V and 4.0 V (it probes for a pack every few seconds); with
 * charging off the node falls to about 1.9 V within 0.5 s. The expander
 * reset at BSP init turned charging off about 2 s before this runs. An
 * unreadable monitor counts as a battery, the vendor's default. */
static bool battery_present(void) {
  const i2c_device_config_t config = {
      .dev_addr_length = I2C_ADDR_BIT_LEN_7,
      .device_address = INA226_ADDRESS,
      .scl_speed_hz = 400000,
  };
  i2c_master_dev_handle_t monitor = NULL;
  if (i2c_master_bus_add_device(bsp_i2c_get_handle(), &config, &monitor) !=
      ESP_OK)
    return true;
  const uint8_t reg = INA226_BUS_VOLTAGE;
  uint8_t value[2];
  const esp_err_t err =
      i2c_master_transmit_receive(monitor, &reg, 1, value, sizeof value, 100);
  i2c_master_bus_rm_device(monitor);
  if (err != ESP_OK)
    return true;
  /* 1.25 mV per bit, big endian. */
  const uint32_t millivolts = ((uint32_t)value[0] << 8 | value[1]) * 5U / 4U;
  ESP_LOGI(TAG, "battery node %" PRIu32 " mV: %s", millivolts,
           millivolts >= BATTERY_MIN_MV ? "battery" : "no battery");
  return millivolts >= BATTERY_MIN_MV;
}

/* The detect inputs of both expanders: bit 8 + n is expander 1's pin n. */
static uint32_t detect_levels(void) {
  uint32_t levels = 0;
  uint32_t value = 0;
  if (device.expanders[EXP0] != NULL &&
      esp_io_expander_get_level(device.expanders[EXP0],
                                1U << HEADPHONE_DETECT_PIN, &value) == ESP_OK)
    levels |= value & 0xFFU;
  value = 0;
  if (device.expanders[EXP1] != NULL &&
      esp_io_expander_get_level(device.expanders[EXP1], 1U << USB_C_DETECT_PIN,
                                &value) == ESP_OK)
    levels |= (value & 0xFFU) << 8;
  return levels;
}

/* ---- USB host ---------------------------------------------------------------
 */

static void usb_event(const usb_host_client_event_msg_t *message,
                      void *context) {
  (void)context;
  if (message->event == USB_HOST_CLIENT_EVENT_NEW_DEV)
    ++device.usb_devices;
  else if (message->event == USB_HOST_CLIENT_EVENT_DEV_GONE &&
           device.usb_devices > 0)
    --device.usb_devices;
}

static void usb_client_task(void *unused) {
  (void)unused;
  for (;;)
    usb_host_client_handle_events(device.usb_client, portMAX_DELAY);
}

static void start_usb(void) {
  if (bsp_usb_host_start(BSP_USB_HOST_POWER_MODE_USB_DEV, true) != ESP_OK) {
    ESP_LOGW(TAG, "USB host did not start");
    return;
  }
  const usb_host_client_config_t config = {
      .is_synchronous = false,
      .max_num_event_msg = 4,
      .async = {.client_event_callback = usb_event, .callback_arg = NULL},
  };
  if (usb_host_client_register(&config, &device.usb_client) != ESP_OK ||
      xTaskCreate(usb_client_task, "pocket_usb", USB_TASK_STACK, NULL, 5,
                  NULL) != pdPASS) {
    ESP_LOGW(TAG, "USB host client did not start");
    return;
  }
  device.usb_ready = true;
}

/* ---- card -----------------------------------------------------------------
 */

static void refresh_card(void) {
  if (device.config.card_root == NULL)
    return;
  uint64_t total = 0;
  uint64_t free_bytes = 0;
  device.card_mounted =
      esp_vfs_fat_info(device.config.card_root, &total, &free_bytes) == ESP_OK;
  device.card_total = device.card_mounted ? total : 0;
  device.card_free = device.card_mounted ? free_bytes : 0;
}

/* ---- JSON -----------------------------------------------------------------
 */

typedef struct {
  char *bytes;
  size_t capacity;
  size_t length;
  bool overflow;
} out_t;

static void put(out_t *out, const char *format, ...) {
  if (out->overflow)
    return;
  va_list args;
  va_start(args, format);
  const int written = vsnprintf(out->bytes + out->length,
                                out->capacity - out->length, format, args);
  va_end(args);
  if (written < 0 || (size_t)written >= out->capacity - out->length)
    out->overflow = true;
  else
    out->length += (size_t)written;
}

/* The length of the UTF-8 sequence at `p`, 0 when it is not one. */
static size_t utf8_length(const unsigned char *p) {
  const size_t length = p[0] >= 0xF0 && p[0] <= 0xF4   ? 4
                        : p[0] >= 0xE0                 ? 3
                        : p[0] >= 0xC2 && p[0] <= 0xDF ? 2
                                                       : 0;
  for (size_t i = 1; i < length; ++i)
    if ((p[i] & 0xC0) != 0x80)
      return 0;
  return length;
}

/* A JSON string. FAT short names come in the card's OEM code page, so a
 * byte that does not start a UTF-8 sequence becomes '?'. */
static void put_string(out_t *out, const char *text) {
  put(out, "\"");
  for (const unsigned char *p = (const unsigned char *)text; *p; ++p) {
    if (*p == '"' || *p == '\\') {
      put(out, "\\%c", *p);
    } else if (*p < 0x20) {
      put(out, "\\u%04x", *p);
    } else if (*p < 0x80) {
      put(out, "%c", *p);
    } else {
      const size_t length = utf8_length(p);
      if (length == 0) {
        put(out, "?");
      } else {
        put(out, "%.*s", (int)length, (const char *)p);
        p += length - 1;
      }
    }
  }
  put(out, "\"");
}

/* ---- ops ------------------------------------------------------------------
 */

static void build_status(void *unused) {
  (void)unused;
  out_t out = {device.status, sizeof device.status, 0, false};
  float celsius = 0;
  const bool temperature =
      device.temperature != NULL &&
      temperature_sensor_get_celsius(device.temperature, &celsius) == ESP_OK;
  const uint32_t detect = detect_levels();
  const uint32_t volume =
      device.config.volume ? device.config.volume(device.config.context) : 0;
  put(&out, "{\"display\":{\"brightness\":%u,\"panel\":",
      (unsigned)device.brightness);
  put_string(&out, device.config.panel ? device.config.panel : "");
  put(&out, "},\"volume\":%u,\"temperature\":", (unsigned)volume);
  if (temperature)
    put(&out, "%.1f", (double)celsius);
  else
    put(&out, "null");
  put(&out, ",\"switches\":[");
  for (size_t i = 0; i < SWITCH_COUNT; ++i)
    put(&out, "%s{\"id\":\"%s\",\"label\":\"%s\",\"on\":%s}", i ? "," : "",
        SWITCHES[i].id, SWITCHES[i].label,
        device.switch_on[i] ? "true" : "false");
  put(&out,
      "],\"ports\":[{\"id\":\"usb-c\",\"label\":\"USB-C\",\"connected\":%s},"
      "{\"id\":\"usb-a\",\"label\":\"USB-A device\",\"connected\":%s},"
      "{\"id\":\"headphone\",\"label\":\"Headphone\",\"connected\":%s}],"
      "\"pins\":[",
      (detect >> (8 + USB_C_DETECT_PIN)) & 1U ? "true" : "false",
      device.usb_devices > 0 ? "true" : "false",
      (detect >> HEADPHONE_DETECT_PIN) & 1U ? "true" : "false");
  for (size_t i = 0; i < device.config.pin_count; ++i)
    put(&out, "%s%u", i ? "," : "", (unsigned)device.pins[i]);
  put(&out,
      "],\"card\":{\"mounted\":%s,\"totalBytes\":%llu,\"freeBytes\":%llu},"
      "\"error\":",
      device.card_mounted ? "true" : "false",
      (unsigned long long)device.card_total,
      (unsigned long long)device.card_free);
  put_string(&out, device.error);
  put(&out, "}");
  if (out.overflow)
    snprintf(device.status, sizeof device.status,
             "{\"error\":\"status overflow\"}");
}

typedef struct {
  const char *text;
  int32_t number;
  int32_t second;
  bool ok;
} call_t;

static void set_brightness(void *context) {
  call_t *call = context;
  const uint32_t percent = call->number < 0     ? 0
                           : call->number > 100 ? 100
                                                : (uint32_t)call->number;
  call->ok = bsp_display_brightness_set((int)percent) == ESP_OK;
  if (call->ok)
    device.brightness = percent;
  set_error(call->ok ? "" : "the backlight did not change");
}

static void set_volume(void *context) {
  call_t *call = context;
  if (device.config.set_volume == NULL) {
    call->ok = false;
    set_error("this board has no speaker");
    return;
  }
  const uint32_t percent = call->number < 0     ? 0
                           : call->number > 100 ? 100
                                                : (uint32_t)call->number;
  device.config.set_volume(device.config.context, percent);
  call->ok = true;
  set_error("");
}

static void set_switch(void *context) {
  call_t *call = context;
  call->ok = false;
  for (size_t i = 0; i < SWITCH_COUNT; ++i) {
    if (strcmp(SWITCHES[i].id, call->text) != 0)
      continue;
    call->ok = drive_switch(i, call->number != 0) == ESP_OK;
    set_error(call->ok ? "" : "the IO expander did not answer");
    ESP_LOGI(TAG, "%s %s%s", SWITCHES[i].id, call->number ? "on" : "off",
             call->ok ? "" : " failed");
    return;
  }
  set_error("no such switch");
}

static int pin_index(int32_t pin) {
  for (size_t i = 0; i < device.config.pin_count; ++i)
    if (device.pins[i] == pin)
      return (int)i;
  return -1;
}

static void set_pin(void *context) {
  call_t *call = context;
  call->ok = false;
  if (pin_index(call->number) < 0) {
    set_error("the pin is not free on this board");
    return;
  }
  const gpio_num_t pin = (gpio_num_t)call->number;
  if (!(device.driven_pins & (1ULL << pin))) {
    gpio_reset_pin(pin);
    if (gpio_set_direction(pin, GPIO_MODE_OUTPUT) != ESP_OK) {
      set_error("the pin cannot drive");
      return;
    }
    device.driven_pins |= 1ULL << pin;
  }
  call->ok = gpio_set_level(pin, call->second ? 1 : 0) == ESP_OK;
  set_error(call->ok ? "" : "the pin cannot drive");
}

static void release_pin(void *context) {
  call_t *call = context;
  call->ok = false;
  if (pin_index(call->number) < 0) {
    set_error("the pin is not free on this board");
    return;
  }
  gpio_reset_pin((gpio_num_t)call->number);
  device.driven_pins &= ~(1ULL << call->number);
  call->ok = true;
  set_error("");
}

/* A path below the card's root: absolute, without "." or ".." segments. */
static bool safe_path(const char *path) {
  if (path == NULL || path[0] != '/' || strlen(path) > PATH_MAX_BYTES)
    return false;
  for (const char *p = path; *p; ++p) {
    if (*p == '\\')
      return false;
    if (p[0] == '/' && p[1] == '.' &&
        (p[2] == '/' || p[2] == 0 || (p[2] == '.' && (p[3] == '/' || !p[3]))))
      return false;
  }
  return true;
}

static void list_directory(void *context) {
  call_t *call = context;
  device.directory[0] = 0;
  call->ok = false;
  if (device.config.card_root == NULL || !safe_path(call->text)) {
    set_error(device.config.card_root == NULL ? "no card" : "invalid path");
    return;
  }
  refresh_card();
  if (!device.card_mounted) {
    set_error("no card");
    return;
  }
  char full[PATH_MAX_BYTES + 64];
  snprintf(full, sizeof full, "%s%s", device.config.card_root,
           strcmp(call->text, "/") == 0 ? "" : call->text);
  DIR *dir = opendir(full);
  if (dir == NULL) {
    set_error("not a directory");
    return;
  }
  out_t out = {device.directory, sizeof device.directory, 0, false};
  put(&out, "{\"path\":");
  put_string(&out, call->text);
  put(&out, ",\"entries\":[");
  size_t count = 0;
  bool truncated = false;
  struct dirent *entry;
  while ((entry = readdir(dir)) != NULL) {
    if (entry->d_name[0] == '.' &&
        (entry->d_name[1] == 0 ||
         (entry->d_name[1] == '.' && entry->d_name[2] == 0)))
      continue;
    if (count == DIRECTORY_MAX_ENTRIES) {
      truncated = true;
      break;
    }
    char child[sizeof full + 260];
    snprintf(child, sizeof child, "%s/%s", full, entry->d_name);
    struct stat info;
    const bool directory = entry->d_type == DT_DIR;
    const long long size =
        !directory && stat(child, &info) == 0 ? (long long)info.st_size : 0;
    put(&out, "%s{\"name\":", count ? "," : "");
    put_string(&out, entry->d_name);
    put(&out, ",\"directory\":%s,\"size\":%lld}", directory ? "true" : "false",
        size);
    ++count;
  }
  closedir(dir);
  put(&out, "],\"truncated\":%s}", truncated ? "true" : "false");
  if (out.overflow) {
    device.directory[0] = 0;
    set_error("the listing does not fit");
    return;
  }
  call->ok = true;
  set_error("");
}

static void power_off(void *context) {
  call_t *call = context;
  esp_io_expander_handle_t expander = device.expanders[EXP1];
  call->ok = false;
  if (expander == NULL) {
    set_error("the IO expander did not answer");
    return;
  }
  ESP_LOGW(TAG, "power off");
  bsp_display_brightness_set(0);
  const uint32_t mask = 1U << POWER_OFF_PIN;
  drive_pin(expander, mask, 0);
  /* The power controller latches off on a pulse; three of them, as the
   * vendor firmware sends. */
  for (int i = 0; i < 3; ++i) {
    esp_io_expander_set_level(expander, mask, 1);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_io_expander_set_level(expander, mask, 0);
    vTaskDelay(pdMS_TO_TICKS(100));
  }
  /* Still running: the power controller did not latch off. */
  bsp_display_brightness_set((int)device.brightness);
  set_error("the board did not power off");
}

static void release_guest(void *unused) {
  (void)unused;
  for (int pin = 0; pin < 64; ++pin)
    if (device.driven_pins & (1ULL << pin))
      gpio_reset_pin((gpio_num_t)pin);
  device.driven_pins = 0;
  if (device.brightness != device.system_brightness &&
      bsp_display_brightness_set((int)device.system_brightness) == ESP_OK)
    device.brightness = device.system_brightness;
  set_error("");
}

/* ---- QuickJS --------------------------------------------------------------
 */

enum {
  OP_STATUS,
  OP_SET_BRIGHTNESS,
  OP_SET_VOLUME,
  OP_SET_SWITCH,
  OP_SET_PIN,
  OP_RELEASE_PIN,
  OP_LIST_DIRECTORY,
  OP_POWER_OFF,
};

static int32_t argument_int(JSContext *ctx, int argc, JSValueConst *argv,
                            int index) {
  int32_t value = 0;
  if (index < argc) {
    if (JS_IsBool(argv[index]))
      value = JS_ToBool(ctx, argv[index]);
    else
      JS_ToInt32(ctx, &value, argv[index]);
  }
  return value;
}

static JSValue operation(JSContext *ctx, JSValueConst this_value, int argc,
                         JSValueConst *argv, int magic) {
  (void)this_value;
  call_t call = {0};
  switch (magic) {
  case OP_STATUS:
    run(build_status, NULL);
    return JS_NewString(ctx, device.status);
  case OP_SET_BRIGHTNESS:
    call.number = argument_int(ctx, argc, argv, 0);
    run(set_brightness, &call);
    break;
  case OP_SET_VOLUME:
    call.number = argument_int(ctx, argc, argv, 0);
    run(set_volume, &call);
    break;
  case OP_SET_PIN:
    call.number = argument_int(ctx, argc, argv, 0);
    call.second = argument_int(ctx, argc, argv, 1);
    run(set_pin, &call);
    break;
  case OP_RELEASE_PIN:
    call.number = argument_int(ctx, argc, argv, 0);
    run(release_pin, &call);
    break;
  case OP_POWER_OFF:
    run(power_off, &call);
    break;
  case OP_SET_SWITCH:
  case OP_LIST_DIRECTORY: {
    if (argc < 1 || !JS_IsString(argv[0]))
      return magic == OP_SET_SWITCH ? JS_FALSE : JS_NewString(ctx, "");
    const char *text = JS_ToCString(ctx, argv[0]);
    if (text == NULL)
      return JS_EXCEPTION;
    call.text = text;
    call.number = argument_int(ctx, argc, argv, 1);
    run(magic == OP_SET_SWITCH ? set_switch : list_directory, &call);
    JS_FreeCString(ctx, text);
    if (magic == OP_LIST_DIRECTORY)
      return JS_NewString(ctx, call.ok ? device.directory : "");
    break;
  }
  default:
    return JS_UNDEFINED;
  }
  return JS_NewBool(ctx, call.ok);
}

static void add(JSContext *ctx, JSValue object, const char *name, int arity,
                int magic) {
  JS_SetPropertyStr(ctx, object, name,
                    JS_NewCFunctionMagic(ctx, operation, name, arity,
                                         JS_CFUNC_generic_magic, magic));
}

esp_err_t pocket_device_install(JSContext *realm) {
  if (device.task == NULL)
    return ESP_ERR_INVALID_STATE;
  JSValue global = JS_GetGlobalObject(realm);
  JSValue object = JS_NewObject(realm);
  add(realm, object, "status", 0, OP_STATUS);
  add(realm, object, "setBrightness", 1, OP_SET_BRIGHTNESS);
  add(realm, object, "setVolume", 1, OP_SET_VOLUME);
  add(realm, object, "setSwitch", 2, OP_SET_SWITCH);
  add(realm, object, "setPin", 2, OP_SET_PIN);
  add(realm, object, "releasePin", 1, OP_RELEASE_PIN);
  add(realm, object, "listDirectory", 1, OP_LIST_DIRECTORY);
  add(realm, object, "powerOff", 0, OP_POWER_OFF);
  JS_SetPropertyStr(realm, global, "device", object);
  const bool failed = JS_HasException(realm);
  JS_FreeValue(realm, global);
  return failed ? ESP_ERR_NO_MEM : ESP_OK;
}

void pocket_device_teardown(void) {
  if (device.task != NULL)
    run(release_guest, NULL);
}

/* ---- setup ----------------------------------------------------------------
 */

esp_err_t pocket_device_setup(const pocket_device_config_t *config) {
  if (config == NULL || config->struct_size < sizeof(*config) ||
      config->pin_count > MAX_PINS)
    return ESP_ERR_INVALID_ARG;
  if (device.task != NULL)
    return ESP_OK;
  device.config = *config;
  memcpy(device.pins, config->pins, config->pin_count);
  device.config.pins = device.pins;
  /* bsp_display_backlight_on left the backlight at full. */
  device.brightness = device.system_brightness = 100;
  device.expanders[EXP0] = bsp_io_expander_init();
  device.expanders[EXP1] = bsp_io_expander1_init();
  const bool battery = battery_present();
  for (size_t i = 0; i < SWITCH_COUNT; ++i)
    if (drive_switch(i, i == CHARGE_SWITCH ? battery
                                           : SWITCHES[i].on_default) != ESP_OK)
      ESP_LOGW(TAG, "switch %s did not set", SWITCHES[i].id);
  if (device.expanders[EXP1] != NULL) {
    esp_io_expander_set_dir(device.expanders[EXP1], 1U << USB_C_DETECT_PIN,
                            IO_EXPANDER_INPUT);
    drive_pin(device.expanders[EXP1], 1U << POWER_OFF_PIN, 0);
  }
  if (device.expanders[EXP0] != NULL)
    esp_io_expander_set_dir(device.expanders[EXP0], 1U << HEADPHONE_DETECT_PIN,
                            IO_EXPANDER_INPUT);
  const temperature_sensor_config_t temperature =
      TEMPERATURE_SENSOR_CONFIG_DEFAULT(-10, 80);
  if (temperature_sensor_install(&temperature, &device.temperature) != ESP_OK ||
      temperature_sensor_enable(device.temperature) != ESP_OK) {
    ESP_LOGW(TAG, "no temperature sensor");
    device.temperature = NULL;
  }
  start_usb();
  refresh_card();
  device.busy = xSemaphoreCreateMutex();
  device.ready = xSemaphoreCreateBinary();
  device.done = xSemaphoreCreateBinary();
  if (device.busy == NULL || device.ready == NULL || device.done == NULL ||
      xTaskCreate(device_main, "pocket_device", DEVICE_TASK_STACK, NULL, 5,
                  &device.task) != pdPASS)
    return ESP_ERR_NO_MEM;
  ESP_LOGI(TAG, "panel %s, %u free pins, USB host %s",
           device.config.panel && device.config.panel[0] ? device.config.panel
                                                         : "unknown",
           (unsigned)config->pin_count, device.usb_ready ? "on" : "off");
  return ESP_OK;
}
