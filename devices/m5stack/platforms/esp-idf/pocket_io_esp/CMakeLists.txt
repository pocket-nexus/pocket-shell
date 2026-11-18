idf_component_register(
    SRCS "src/protocol.c" "src/i2c.c" "src/uart.c"
    INCLUDE_DIRS "include"
    REQUIRES pocket_worker_esp esp_driver_i2c esp_driver_uart
    PRIV_REQUIRES esp_timer esp_driver_gpio
    REQUIRED_IDF_TARGETS esp32p4 esp32s3 esp32c3 esp32c6
)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
