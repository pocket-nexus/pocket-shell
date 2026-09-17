// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/main.tsx — Pocket Shell Desktop entry point (SolidJS, JSX).
import { getOps, mount } from "@pocketjs/framework";
import App from "./app.tsx";

// Each target keeps the same desktop and window manager. macOS ships a
// small application catalog and starts in Aqua.
mount(() => <App macDesktop={getOps().__host === "macos-app"} />);
