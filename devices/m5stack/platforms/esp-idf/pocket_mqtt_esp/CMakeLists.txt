idf_component_register(
    SRCS "src/record.c" "src/mqtt.c"
    INCLUDE_DIRS "include"
    REQUIRES pocket_worker_esp
    PRIV_REQUIRES esp-tls esp_timer log mbedtls mqtt
    REQUIRED_IDF_TARGETS esp32p4 esp32s3 esp32c3 esp32c6
)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
