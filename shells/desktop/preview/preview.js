/* SPDX-License-Identifier: GPL-3.0-only */
import { mountPocketSystem } from "./runtime/programs/web/system-engine.js";

const status = document.querySelector("#status");
const log = document.querySelector("#log");

function append(message) {
  log.textContent = `${log.textContent}${message}\n`.slice(-5000);
  log.scrollTop = log.scrollHeight;
}

try {
  await mountPocketSystem(document.querySelector("#desktop"), {
    planUrl: "./pocket-desktop.system.plan.json",
    distBase: "./dist/",
    wasmUrl: "./runtime/platforms/web/pocketjs.wasm",
    instanceUrl: "./runtime/programs/web/app-instance.html",
    liveResize: false,
    onLog: append,
  });
  status.textContent = "Ready · click the desktop to focus";
} catch (error) {
  status.textContent = "Preview failed";
  append(error?.stack ?? String(error));
}
