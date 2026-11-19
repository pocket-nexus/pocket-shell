// SPDX-License-Identifier: GPL-3.0-or-later
// Pocket Shell Touch on PocketJS's stock iPod touch 4 and Nokia E7 programs:
// the hosts it builds for and its application section. A fixed 320x480
// viewport on the iPod; a live viewport between 320x320 and 640x640 on the
// E7, which starts at 360x640. The version is the package's (package.json),
// which the release raises with the repository's.
import { defineHostConfig } from "@pocketjs/framework/host-config";
import { version } from "./package.json" with { type: "json" };

export default defineHostConfig({
  hosts: ["ipodtouch4-dev", "symbian-e7-dev"],
  app: {
    id: "dev.pocket-nexus.fluid",
    title: "Pocket Shell Touch",
    version,
    entry: "src/main.tsx",
    output: "pocketshell-touch",
    framework: "solid",
    viewport: {
      fixed: { logical: [320, 480], presentation: "native" },
      dynamic: { default: [360, 640], min: [320, 320], max: [640, 640] },
    },
    features: ["input.touch", "text.glyphs.baked", "display.viewport.live"],
  },
});
