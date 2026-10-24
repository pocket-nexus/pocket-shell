// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/app.tsx — Pocket Home, the 3DS system launcher.
//
// The touch screen holds the Home screen; Settings and the Mac store open
// over it with a zoom, each as a navigation stack. The top screen belongs to
// the system (capability "system.agent"), so Home draws nothing there.
//
// Input: the stylus goes through one router that asks the visible layer for
// its targets; the buttons go to the alert, then the open stack, then the
// Home screen. SELECT returns to the Home screen, or from it to the app the
// host interrupted; while Settings or the Mac is open the top screen shows the
// SELECT Home hint, as it does in an applet.

import { createEffect, createSignal, onMount, Show, type JSX } from "solid-js";
import { setHomeHint } from "@pocketjs/framework/agent";
import { AppletSurface } from "@pocketjs/framework/applet";
import { View, type NodeMirror } from "@pocketjs/framework/components";
import { animate, jump } from "@pocketjs/framework/animation";
import { after } from "@pocketjs/framework/clock";
import { BTN } from "@pocketjs/framework/input";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { SETTINGS_PAGES, wifiJoinPage, type PageEnv } from "./pages.tsx";
import { scannerPage, type ScanState } from "./scanner.tsx";
import { createSpringboard } from "./springboard.tsx";
import { storeAppPage, storePage } from "./store.tsx";
import { createHomeSystem } from "./system.ts";
import { createAlerts } from "../ui/alert.tsx";
import { Pinstripes } from "../ui/chrome.tsx";
import { Legend } from "../ui/legend.tsx";
import { createNavStack } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletTouch, appletSurfaceId } from "../ui/screen.ts";
import { createPress, createTouchRouter } from "../ui/touch.ts";

const ALL_BUTTONS = 0xffff;
const ZOOM_MS = 280;

function AppFrame(props: { onReady(node: NodeMirror): void; children: JSX.Element }) {
  let node: NodeMirror | undefined;
  onMount(() => node && props.onReady(node));
  return (
    <View ref={(el) => (node = el)} class="absolute left-0 top-0 overflow-hidden" style={{ width: SCREEN_W, height: SCREEN_H }}>
      {props.children}
    </View>
  );
}

export default function Home() {
  const sys = createHomeSystem();
  const press = createPress();
  // Without touch (a PSP) the d-pad focus shows from the start.
  const [keys, setKeys] = createSignal(!appletTouch());
  const alerts = createAlerts(press);
  const [scan, setScan] = createSignal<ScanState>({ t: "scanning", hint: "" });
  const [app, setApp] = createSignal<"settings" | "store" | null>(null);
  const [zooming, setZooming] = createSignal(false);
  let appNode: NodeMirror | undefined;

  const confirm = (title: string, message: string, action: string, run: () => void) => alerts.show({ title, message, action, run });
  const env: PageEnv = { sys, press, keys, confirm };

  const closeApp = () => {
    if (!app() || zooming()) return;
    setZooming(true);
    if (appNode) {
      animate(appNode, "scale", 0.3, { dur: ZOOM_MS, easing: "in" });
      animate(appNode, "opacity", 0, { dur: ZOOM_MS, easing: "in" });
    }
    after(ZOOM_MS / 1000, () => {
      setApp(null);
      stack.reset(null);
      setZooming(false);
    });
  };

  const stack = createNavStack({
    press,
    keys,
    setKeys,
    onExit: closeApp,
    rootBack: null,
    exitLabel: "Home",
    background: () => <Pinstripes width={SCREEN_W} height={SCREEN_H} />,
    page(id, nav, layer) {
      if (id === "scan") return scannerPage(sys, nav, setScan, scan);
      if (id === "store") return storePage({ sys, press, keys }, nav, layer);
      if (id.startsWith("store.app:")) return storeAppPage({ sys, press, keys }, id.slice("store.app:".length), nav, layer);
      if (id.startsWith("wifi.join:")) return wifiJoinPage(env, id.slice("wifi.join:".length), nav, layer);
      return SETTINGS_PAGES[id]!(env, nav, layer);
    },
  });

  const openApp = (which: "settings" | "store") => {
    if (app() || zooming()) return;
    stack.reset(which);
    setApp(which);
    setZooming(true);
    after(ZOOM_MS / 1000, () => setZooming(false));
  };

  createEffect(() => setHomeHint(app() !== null));

  const board = createSpringboard({
    sys,
    press,
    keys,
    setKeys,
    openApp,
    confirm,
    active: () => app() === null && !alerts.current(),
  });

  createTouchRouter({
    surface: appletSurfaceId(),
    press,
    page: () => alerts.touch() ?? (app() ? stack.touch() : board.touch()),
    active: () => !zooming() && !stack.busy() && board.launching() === "",
    onTouch: () => setKeys(false),
  });

  onButtonPress(ALL_BUTTONS, (pressed) => {
    if (zooming() || board.launching()) return;
    if (alerts.key(pressed)) return;
    if (pressed & BTN.SELECT) {
      if (app()) closeApp();
      else {
        const resume = sys.table().resume;
        if (resume && sys.table().apps.some((entry) => entry.output === resume)) sys.launch(resume);
      }
      return;
    }
    if (app()) {
      if (pressed & BTN.START) closeApp();
      else stack.key(pressed);
      return;
    }
    board.key(pressed);
  });

  return (
    <AppletSurface>
      <View class="relative w-full h-full bg-black overflow-hidden">
        {board.view()}
        <Show when={app()}>
          <AppFrame
            onReady={(node) => {
              appNode = node;
              jump(node, "scale", 0.3);
              jump(node, "opacity", 0);
              animate(node, "scale", 1, { dur: ZOOM_MS, easing: "out" });
              animate(node, "opacity", 1, { dur: ZOOM_MS, easing: "out" });
            }}
          >
            {stack.view()}
          </AppFrame>
        </Show>
        {alerts.view()}
      </View>
      <Legend />
    </AppletSurface>
  );
}
