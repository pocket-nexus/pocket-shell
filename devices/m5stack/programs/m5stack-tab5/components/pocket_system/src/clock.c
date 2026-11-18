/*
 * The wall clock from SNTP (CONFIG_POCKET_SYSTEM_SNTP_SERVER). Every address
 * the radio is assigned restarts the client, so a new network synchronizes
 * the clock within one exchange instead of after lwIP's retry backoff; lwIP
 * then synchronizes again every CONFIG_LWIP_SNTP_UPDATE_DELAY ms. The clock
 * is UTC: gettimeofday, the guest's Date and the certificate dates mbedTLS
 * checks (CONFIG_MBEDTLS_HAVE_TIME_DATE) all read it.
 */

#include <sys/time.h>
#include <time.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "system_internal.h"

#define CLOCK_SET BIT0

static const char *TAG = "pocketjs_clock";

static EventGroupHandle_t events;

/* On the TCP/IP task, after each synchronization. */
static void on_sync(struct timeval *now) {
  if ((xEventGroupGetBits(events) & CLOCK_SET) == 0) {
    struct tm utc;
    char text[32];
    time_t seconds = now->tv_sec;
    gmtime_r(&seconds, &utc);
    strftime(text, sizeof text, "%Y-%m-%dT%H:%M:%SZ", &utc);
    ESP_LOGI(TAG, "clock set from %s: %s", CONFIG_POCKET_SYSTEM_SNTP_SERVER,
             text);
  }
  xEventGroupSetBits(events, CLOCK_SET);
}

static void on_address(void *argument, esp_event_base_t base, int32_t id,
                       void *data) {
  (void)argument;
  (void)base;
  (void)id;
  (void)data;
  esp_netif_sntp_start();
}

void clock_start(void) {
  if (events != NULL)
    return;
  events = xEventGroupCreate();
  if (events == NULL)
    return;
  esp_sntp_config_t config =
      ESP_NETIF_SNTP_DEFAULT_CONFIG(CONFIG_POCKET_SYSTEM_SNTP_SERVER);
  config.start = false;
  config.wait_for_sync = false;
  config.sync_cb = on_sync;
  esp_err_t result = esp_netif_sntp_init(&config);
  if (result == ESP_OK)
    result = esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                        on_address, NULL);
  if (result != ESP_OK)
    ESP_LOGE(TAG, "SNTP did not start (%s)", esp_err_to_name(result));
}

bool clock_wait(uint32_t ms) {
  if (events == NULL)
    return false;
  EventBits_t bits = xEventGroupWaitBits(events, CLOCK_SET, pdFALSE, pdTRUE,
                                         pdMS_TO_TICKS(ms));
  return (bits & CLOCK_SET) != 0;
}
