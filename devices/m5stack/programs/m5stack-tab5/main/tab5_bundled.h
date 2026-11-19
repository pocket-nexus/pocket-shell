#pragma once
/* The packages the firmware embeds to install at boot, from
 * POCKETJS_TAB5_BUNDLED_APPS and POCKETJS_TAB5_BUNDLED_PACKAGES
 * (main/CMakeLists.txt generates the definition in tab5_bundled.c). */
#include <stddef.h>

#include "pocket/system.h"

/* The bundled packages and their count; NULL and 0 for none. */
const pocketjs_system_package_t *tab5_bundled(size_t *count);
