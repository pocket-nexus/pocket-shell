// SPDX-License-Identifier: GPL-3.0-or-later
// bun run pair --host <ip> | --card <dir> — set a console up for this
// computer once, while ftpd runs on it (or with its SD card mounted). The
// tool is the reference Pocket Link 2 Hub's setup (link/3ds-dev.ts setup):
// it writes this computer's pairing files into sdmc:/pocketjs/link/ and
// keeps its record in $POCKETJS_LINK_HOME, else ~/.pocketjs/link/, outside
// the repository. The console links to this
// computer by itself the next time Pocket Shell starts.

import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { LINK_TOOL, ROOT } from "./paths.ts";

await passThrough($`bun ${LINK_TOOL} setup ${process.argv.slice(2)}`.cwd(ROOT));
