// SPDX-License-Identifier: GPL-3.0-or-later
// runtime/test/fixtures/applets/feed — the applet runtime/test/applet.test.ts
// checks from its files, as a build does, and shells/3ds/test/psp-sim.test.ts
// resolves for the PSP. It stands for the applets of pocket-nexus/applets,
// which are not in this repository, and has what the applet rules read in
// them: the `applet` section of its app contract, a worker for its network
// (net.http, ../lib/feed.ts and ../lib/feed-worker.ts), a store (data.fs,
// ./saved.ts), a module in a directory the project root shares (../lib) and
// AppletSurface. fixtures/applets is its project root.
//
// The surface shows the headline the worker read last; the one kept in the
// store shows until a newer one arrives.

import { createSignal } from "solid-js";
import { AppletSurface, appletViewport } from "@pocketjs/framework/applet";
import { Text, View } from "@pocketjs/framework/components";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { openFeed } from "../lib/feed.ts";
import { keep, kept } from "./saved.ts";

const LATEST = "https://feed.example.com/latest.txt";

export default function Feed() {
  const { width, height } = appletViewport();
  const feed = openFeed();
  const [headline, setHeadline] = createSignal(kept());
  feed.ask(LATEST);
  onFrame(() => {
    const latest = feed.take().at(-1);
    if (latest === undefined) return;
    setHeadline(latest);
    keep(latest);
  });
  return (
    <AppletSurface>
      <View class="flex-col bg-white p-[10]" style={{ width, height }}>
        <Text class="text-sm font-bold text-slate-900">Feed</Text>
        <Text class="text-sm text-slate-600">{headline() || "Nothing read yet"}</Text>
      </View>
    </AppletSurface>
  );
}
