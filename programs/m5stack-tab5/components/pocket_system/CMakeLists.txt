# engine/host-services holds the Pocket Link 2 client, the launcher and the
# data.fs state machines every native program compiles; this component adds
# the store, the radio, the SNTP clock, installs from an address over
# esp_http_client and the QuickJS bindings.
set(shared "${CMAKE_CURRENT_LIST_DIR}/../../../../third_party/pocketjs/engine/host-services")

idf_component_register(
    SRCS
        "src/services_host.c"
        "src/flash_stage.c"
        "src/flash_store.c"
        "src/wifi.c"
        "src/clock.c"
        "src/companion.c"
        "src/fetch.c"
        "src/install.c"
        "src/install_uri.c"
        "src/link2_host.c"
        "src/qjs.c"
        "${shared}/fs.c"
        "${shared}/jscan.c"
        "${shared}/launcher.c"
        "${shared}/link2.c"
        "${shared}/link2_bsd.c"
        "${shared}/link2_guest.c"
        "${shared}/link2_http.c"
        "${shared}/link2_proto.c"
        "${shared}/sha256.c"
    INCLUDE_DIRS "include"
    PRIV_INCLUDE_DIRS "src" "${shared}"
    REQUIRES pocket_runtime pocket_guest_quickjs
    PRIV_REQUIRES esp-tls esp_event esp_http_client esp_http_server esp_netif esp_partition esp_timer esp_wifi fatfs log lwip mbedtls nvs_flash pocket_http_esp spi_flash vfs wear_levelling
    REQUIRED_IDF_TARGETS esp32p4
    LDFRAGMENTS "linker.lf"
)

target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
# The link client allocates once, at start: its record, its request tables
# and a 16 KiB receive buffer, each at most
# CONFIG_SPIRAM_MALLOC_ALWAYSINTERNAL bytes, which malloc places in internal
# RAM. The program starts the system services after its strips have left
# 64 KiB of internal RAM to the JPEG codec and the coprocessor link
# (TAB5_INTERNAL_RESERVE), so the client's memory comes from PSRAM
# (services_host.c).
set_source_files_properties("${shared}/link2.c" PROPERTIES COMPILE_DEFINITIONS
    "malloc=pocket_system_link_malloc;calloc=pocket_system_link_calloc")
