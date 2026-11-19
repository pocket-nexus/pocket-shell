// SPDX-License-Identifier: GPL-3.0-or-later
// Pocket Shell's PSP program (program/): its host contract,
// pocket-shell-psp.host.json, which `pocket-shell compile --host-config`
// resolves an app contract against. shells/3ds/scripts/psp.ts builds the
// program; this config names no native recipe.
import { defineHostConfig } from "../../vendor/pocketjs/framework/src/host-config.ts";
export default defineHostConfig({ host: "./pocket-shell-psp.host.json" });
