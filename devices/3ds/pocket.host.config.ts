// SPDX-License-Identifier: GPL-3.0-or-later
import { defineHostConfig } from "../../vendor/pocketjs/framework/src/host-config.ts";
import { build } from "./recipe.ts";
export default defineHostConfig({ host: "./pocket.host.json", build });
