if(CMAKE_BUILD_EARLY_EXPANSION)
    idf_component_register(REQUIRES quickjs-ng PRIV_REQUIRES esp_timer heap log REQUIRED_IDF_TARGETS esp32p4 esp32s3 esp32c3 esp32c6)
    return()
endif()
if(NOT POCKETJS_ROOT)
    get_filename_component(POCKETJS_ROOT "${CMAKE_CURRENT_LIST_DIR}/../../../third_party/pocketjs" ABSOLUTE)
endif()
set(worker_root "${POCKETJS_ROOT}/engine/worker")
if(NOT EXISTS "${worker_root}/include/pocket/worker.h")
    message(FATAL_ERROR "PocketJS worker support is required; set -DPOCKETJS_ROOT=<worker-enabled-checkout>")
endif()
idf_component_register(
    SRCS "src/worker.c" "${worker_root}/src/worker.c" "${worker_root}/src/quickjs.c" "${worker_root}/src/quickjs_ui.c" "${worker_root}/src/runner.c"
    INCLUDE_DIRS "include" "${worker_root}/include"
    REQUIRES quickjs-ng
    PRIV_REQUIRES esp_timer heap log
    REQUIRED_IDF_TARGETS esp32p4 esp32s3 esp32c3 esp32c6
)
target_compile_options(${COMPONENT_LIB} PRIVATE -Wall -Wextra -Werror)
# On ESP-IDF uint32_t is unsigned long; QuickJS's UTF-8 iterator aliases an
# int pointer. Match pocket_guest_quickjs so optimization retains the update.
if(TARGET __idf_espressif__quickjs-ng)
    target_compile_options(__idf_espressif__quickjs-ng PRIVATE -fno-strict-aliasing)
else()
    target_compile_options(__idf_quickjs-ng PRIVATE -fno-strict-aliasing)
endif()
