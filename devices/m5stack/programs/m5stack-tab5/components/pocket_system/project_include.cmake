# SPDX-License-Identifier: GPL-3.0-or-later
#
# Pocket Shell's CMake functions for the .pocket packages a firmware image
# carries, read by this component (pocket/system.h). ESP-IDF includes this file
# for every project that builds pocket_system.
#
#   pocket_shell_compile_app(TARGET <target> NAME <name> MANIFEST <pocket.app.json>
#       [HOST_CONFIG <pocket.host.config.ts>] [PROJECT_ROOT <dir>]
#       [PROFILE_EXPORT_DIR <dir>] [COMPILER_RECEIPT <file>] [DEPENDS <file>...])
#     compiles the app at build time with Pocket Shell's CLI (POCKETJS_CLI,
#     `compile --manifest --host-config --depfile`) into
#     <binary dir>/pocket-shell/<name>/<name>.pocket and embeds it. The depfile
#     lists the app's sources, the host config and the compiler's modules, so
#     an edit to any of them compiles the app again.
#   pocket_shell_embed_package(TARGET <target> NAME <name> PACKAGE <file.pocket>
#       [HOST_CONFIG <pocket.host.config.ts>] [PROFILE_EXPORT_DIR <dir>])
#     embeds a prebuilt .pocket.
#
# Both export the host config's contract through PocketJS's
# pocketjs_profile_header (pocket_profile.h and pocket.host.json in
# PROFILE_EXPORT_DIR, default <binary dir>/pocket-shell/profile, on the
# target's include path), check the package against it with
# devices/m5stack/tools/embed-package.ts, and add
# <binary dir>/pocket-shell/<name>/pocketjs_package_<name>.{c,S} to TARGET:
# `const pocketjs_system_package_t pocketjs_package_<name>`, declared in
# pocketjs_package_<name>.h, holds the package's bytes in .rodata, read from
# flash in place. HOST_CONFIG defaults to ${CMAKE_SOURCE_DIR}/pocket.host.config.ts;
# PROJECT_ROOT defaults to the manifest's directory. NAME matches
# [a-z][a-z0-9_]*.
include_guard(GLOBAL)

function(_pocket_shell_paths name host_config export_dir config_out directory_out)
    if(NOT "${name}" MATCHES "^[a-z][a-z0-9_]*$")
        message(FATAL_ERROR "Pocket Shell package NAME must match [a-z][a-z0-9_]*: ${name}")
    endif()
    if(NOT host_config)
        set(host_config "${CMAKE_SOURCE_DIR}/pocket.host.config.ts")
    endif()
    get_filename_component(config "${host_config}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    if(NOT export_dir)
        set(export_dir "${CMAKE_CURRENT_BINARY_DIR}/pocket-shell/profile")
    endif()
    get_filename_component(directory "${export_dir}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    set(${config_out} "${config}" PARENT_SCOPE)
    set(${directory_out} "${directory}" PARENT_SCOPE)
endfunction()

# Generate pocketjs_package_<name>.{h,c,S} for `package` and add them to
# `target`. This file's directory is devices/m5stack/programs/m5stack-tab5/
# components/pocket_system.
function(_pocket_shell_attach target name package profile_directory)
    if(NOT TARGET "${target}")
        message(FATAL_ERROR "Pocket Shell package target '${target}' does not exist")
    endif()
    find_program(POCKET_SHELL_BUN NAMES bun REQUIRED)
    get_filename_component(tool
        "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/../../../../tools/embed-package.ts" ABSOLUTE)
    set(generated "${CMAKE_CURRENT_BINARY_DIR}/pocket-shell/${name}")
    set(stem "pocketjs_package_${name}")
    add_custom_command(
        OUTPUT "${generated}/${stem}.h" "${generated}/${stem}.c" "${generated}/${stem}.S"
        COMMAND "${POCKET_SHELL_BUN}" "${tool}"
            "--package=${package}" "--profile=${profile_directory}/pocket.host.json"
            "--name=${name}" "--output-dir=${generated}" "--depfile=${generated}/${stem}.d"
        DEPFILE "${generated}/${stem}.d"
        DEPENDS "${package}" "${profile_directory}/pocket.host.json" "${tool}"
        VERBATIM)
    string(MAKE_C_IDENTIFIER "${target}_${name}" suffix)
    add_custom_target("pocket_shell_${suffix}_package"
        DEPENDS "${generated}/${stem}.h" "${generated}/${stem}.c" "${generated}/${stem}.S")
    add_dependencies("${target}" "pocket_shell_${suffix}_package")
    target_sources("${target}" PRIVATE "${generated}/${stem}.c" "${generated}/${stem}.S")
    target_include_directories("${target}" PRIVATE "${generated}")
endfunction()

function(pocket_shell_compile_app)
    cmake_parse_arguments(APP ""
        "TARGET;NAME;MANIFEST;HOST_CONFIG;PROJECT_ROOT;PROFILE_EXPORT_DIR;COMPILER_RECEIPT" "DEPENDS" ${ARGN})
    if(APP_UNPARSED_ARGUMENTS)
        message(FATAL_ERROR "Unknown pocket_shell_compile_app arguments: ${APP_UNPARSED_ARGUMENTS}")
    endif()
    foreach(required TARGET NAME MANIFEST)
        if(NOT APP_${required})
            message(FATAL_ERROR "pocket_shell_compile_app requires ${required}")
        endif()
    endforeach()
    _pocket_shell_paths("${APP_NAME}" "${APP_HOST_CONFIG}" "${APP_PROFILE_EXPORT_DIR}" config directory)
    pocketjs_profile_header(TARGET "${APP_TARGET}" NAME "${APP_NAME}"
        HOST_CONFIG "${config}" PROFILE_EXPORT_DIR "${directory}" DEPENDS ${APP_DEPENDS})
    find_program(POCKETJS_CLI NAMES pocket REQUIRED)
    get_filename_component(manifest "${APP_MANIFEST}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    if(NOT EXISTS "${manifest}")
        message(FATAL_ERROR "Pocket Shell app manifest does not exist: ${manifest}")
    endif()
    if(APP_PROJECT_ROOT)
        get_filename_component(project_root "${APP_PROJECT_ROOT}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    else()
        get_filename_component(project_root "${manifest}" DIRECTORY)
    endif()
    set(generated "${CMAKE_CURRENT_BINARY_DIR}/pocket-shell/${APP_NAME}")
    set(package "${generated}/${APP_NAME}.pocket")
    set(dependencies "${generated}/${APP_NAME}.d")
    set(compiler_args)
    set(compiler_receipt)
    if(APP_COMPILER_RECEIPT)
        get_filename_component(compiler_receipt "${APP_COMPILER_RECEIPT}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
        list(APPEND compiler_args --compiler-receipt "${compiler_receipt}")
    endif()
    # A host contract that names the QuickJS engine ABI of this program gets
    # bytecode sections compiled from the engine source the component manager
    # fetched, the same files the firmware links.
    if(NOT POCKETJS_QUICKJS_SOURCE)
        set(POCKETJS_QUICKJS_SOURCE "${CMAKE_SOURCE_DIR}/managed_components/espressif__quickjs-ng/quickjs-ng"
            CACHE PATH "QuickJS source the bytecode compiler builds from")
    endif()
    add_custom_command(
        OUTPUT "${package}"
        COMMAND "${CMAKE_COMMAND}" -E make_directory "${generated}"
        COMMAND "${CMAKE_COMMAND}" -E env "POCKETJS_QUICKJS_SOURCE=${POCKETJS_QUICKJS_SOURCE}"
            "${POCKETJS_CLI}" compile
            --manifest "${manifest}" --host-config "${config}"
            --project-root "${project_root}" --outdir "${generated}"
            --plan-dir "${generated}/plans" --output "${package}" --depfile "${dependencies}"
            ${compiler_args}
        DEPFILE "${dependencies}"
        DEPENDS "${manifest}" "${config}" "${POCKETJS_CLI}" ${compiler_receipt} ${APP_DEPENDS}
        VERBATIM)
    _pocket_shell_attach("${APP_TARGET}" "${APP_NAME}" "${package}" "${directory}")
endfunction()

function(pocket_shell_embed_package)
    cmake_parse_arguments(APP "" "TARGET;NAME;PACKAGE;HOST_CONFIG;PROFILE_EXPORT_DIR" "" ${ARGN})
    if(APP_UNPARSED_ARGUMENTS)
        message(FATAL_ERROR "Unknown pocket_shell_embed_package arguments: ${APP_UNPARSED_ARGUMENTS}")
    endif()
    foreach(required TARGET NAME PACKAGE)
        if(NOT APP_${required})
            message(FATAL_ERROR "pocket_shell_embed_package requires ${required}")
        endif()
    endforeach()
    get_filename_component(package "${APP_PACKAGE}" ABSOLUTE BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
    if(NOT EXISTS "${package}")
        message(FATAL_ERROR "Pocket Shell package does not exist: ${package}")
    endif()
    _pocket_shell_paths("${APP_NAME}" "${APP_HOST_CONFIG}" "${APP_PROFILE_EXPORT_DIR}" config directory)
    pocketjs_profile_header(TARGET "${APP_TARGET}" NAME "${APP_NAME}"
        HOST_CONFIG "${config}" PROFILE_EXPORT_DIR "${directory}")
    _pocket_shell_attach("${APP_TARGET}" "${APP_NAME}" "${package}" "${directory}")
endfunction()
