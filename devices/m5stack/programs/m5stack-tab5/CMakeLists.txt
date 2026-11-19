cmake_minimum_required(VERSION 3.22)

get_filename_component(m5_root "${CMAKE_CURRENT_LIST_DIR}/../.." ABSOLUTE)
set(pocketjs_components "${m5_root}/../../vendor/pocketjs/platforms/esp-idf")
list(APPEND EXTRA_COMPONENT_DIRS
    "${pocketjs_components}/pocket_runtime"
    "${pocketjs_components}/pocket_guest_quickjs"
    "${pocketjs_components}/pocket_runner"
    "${pocketjs_components}/pocket_render_esp_ppa"
    "${pocketjs_components}/pocket_display_esp_dpi"
    "${m5_root}/platforms/esp-idf/pocket_worker_esp"
    "${m5_root}/platforms/esp-idf/pocket_http_esp"
    "${m5_root}/platforms/esp-idf/pocket_mqtt_esp"
    "${m5_root}/platforms/esp-idf/pocket_io_esp")
if(NOT DEFINED POCKETJS_RUST_FROM_SOURCE)
    set(POCKETJS_RUST_FROM_SOURCE ON CACHE BOOL "")
endif()

# Pocket Shell's CLI: pocket_shell_compile_app (pocket_system) runs its
# `compile`, and PocketJS's pocketjs_profile_header its `host export`, which
# it passes to the pinned PocketJS CLI.
set(POCKETJS_CLI "${m5_root}/tools/pocket" CACHE FILEPATH "Pocket Shell CLI (tools/pocket)")

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
idf_build_set_property(MINIMAL_BUILD ON)
project(pocketjs_m5stack_tab5)
