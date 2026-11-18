// SPDX-License-Identifier: GPL-3.0-or-later
// bun run probe [--host <ip>] [--out shot.png] — one round trip to a running
// console over the Pocket Link: the program's runtime.status and a
// screenshot of both displays (link/3ds-dev.ts probe).

import { $ } from "bun";
import { passThrough } from "../../../scripts/run.ts";
import { LINK_TOOL, ROOT } from "./paths.ts";

await passThrough($`bun ${LINK_TOOL} probe ${process.argv.slice(2)}`.cwd(ROOT));
