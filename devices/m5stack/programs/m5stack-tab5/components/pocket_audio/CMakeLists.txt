idf_component_register(
    SRCS "src/audio.c"
    INCLUDE_DIRS "include"
    REQUIRES pocket_guest_quickjs
    PRIV_REQUIRES esp_driver_i2s esp_lcd log espressif__m5stack_tab5_noglib
                  espressif__esp_codec_dev
    REQUIRED_IDF_TARGETS esp32p4
)

target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
