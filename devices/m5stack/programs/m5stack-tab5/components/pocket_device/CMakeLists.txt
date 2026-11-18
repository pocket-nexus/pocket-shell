idf_component_register(
    SRCS "src/device.c"
    INCLUDE_DIRS "include"
    REQUIRES pocket_guest_quickjs
    PRIV_REQUIRES esp_driver_gpio esp_driver_i2c esp_driver_tsens esp_lcd
                  fatfs log espressif__m5stack_tab5_noglib
                  espressif__esp_io_expander espressif__usb
    REQUIRED_IDF_TARGETS esp32p4
)

target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
