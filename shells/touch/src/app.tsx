// SPDX-License-Identifier: GPL-3.0-or-later
import { createSignal, onMount, onCleanup } from "solid-js";
import { View, Text, Image, type NodeMirror } from "@pocketjs/framework/components";
import { createJumpBatch, jump as applyJump, type JumpBatch } from "@pocketjs/framework/animation";
import { createGesture, type GestureContact } from "@pocketjs/framework/gesture";
import { createScroller } from "@pocketjs/framework/kinetics";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { simulationHz } from "@pocketjs/framework/clock";
import { reportAppAction, getOps, hostViewport } from "@pocketjs/framework/host";
import { Navigation, smooth } from "./navigation.ts";
import { APPS, HOME_PAGES } from "./catalog.ts";
import { registerTexture } from "@pocketjs/framework/renderer";
import { nativeApps, launchApp, closeApp, onNativeAppReturn } from "./native-apps.ts";
import { Icon, AppMockup } from "./mockups.tsx";

const COLORS = APPS.map(app => app.color);
const CHROME_LAYER = APPS.length * 2 + 8;

export default function TouchShell() {
  const viewport = hostViewport(getOps());
  const installed = nativeApps();
  const nativeAt = (index: number) => installed.find(app => app.index === index);
  const names = APPS.map((app, i) => nativeAt(i)?.name ?? app.name);
  const [shots, setShots] = createSignal<Record<number, string>>({});
  const [notice, setNotice] = createSignal("");
  let noticeFrames = 0;
  let launchedAction = -1;
  const shotVersions = APPS.map(() => 0);
  const nav = new Navigation(viewport?.w ?? 320, viewport?.h ?? 480);
  if (installed.length) {
    for (const app of installed) nav.opened.splice(nav.opened.indexOf(app.index), 1);
    nav.showHome();
    for (let i = 0; i < 120; i++) nav.step(1 / 60);
  }
  onCleanup(onNativeAppReturn(event => {
    const app = installed.find(app => app.output === event.output);
    if (!app) return;
    if (event.shot >= 0) {
      const key = `native-app-${app.index}-${++shotVersions[app.index] % 2}`;
      registerTexture(key, event.shot);
      setShots(previous => ({ ...previous, [app.index]: key }));
    }
    if (event.error) {
      setNotice(`Could not open ${app.title}. Tap to try again.`); noticeFrames = 240;
      nav.rejectNativeLaunch(app.index);
    } else nav.returnFromApp(app.index, event.destination, event.pose);
    launchedAction = nav.actions;
  }));
  const [layout, setLayout] = createSignal(nav.layout);
  const [stack, setStack] = createSignal("");
  const layer = (index: number) => { stack(); return nav.layer(index); };
  const windows: NodeMirror[] = [], contents: NodeMirror[] = [], labels: NodeMirror[] = [];
  const pages: NodeMirror[] = [], dots: NodeMirror[] = [];
  let wallpaper!: NodeMirror, home!: NodeMirror, overview!: NodeMirror, empty!: NodeMirror;
  let detail!: NodeMirror, detailUnder!: NodeMirror, pill!: NodeMirror;
  let batch: JumpBatch | undefined;
  // These properties are owned by this painter, with no native animations.
  // Keep mounted content, but avoid JS/native calls for identical poses.
  const painted = new WeakMap<NodeMirror, Record<string, number>>();
  const windowPose = new Float64Array(APPS.length * 6).fill(NaN);
  function jump(node: NodeMirror, prop: Parameters<typeof applyJump>[1], value: number) {
    let previous = painted.get(node);
    if (!previous) { previous = {}; painted.set(node, previous); }
    if (previous[prop] === value) return;
    previous[prop] = value;
    applyJump(node, prop, value);
  }
  let actionCount = 0;
  const scrollers = APPS.map(({ height }) => createScroller({ max: () => Math.max(0, height - (layout().contentHeight - 6)), extent: () => layout().contentHeight - 6, overscroll: 65 }));

  function syncViewport(): boolean {
    const viewport = hostViewport(getOps());
    if (viewport && (viewport.w !== nav.layout.width || viewport.h !== nav.layout.height)) {
      scrollers.forEach(s => s.endDrag(0));
      nav.resize(viewport.w, viewport.h);
      setLayout(nav.layout);
      // Clamp retained offsets to the new visible extent after rotation.
      scrollers.forEach((s, i) => s.scrollTo(Math.max(0, Math.min(s.offset(), APPS[i].height - (layout().contentHeight - 6))), { immediate: true }));
      return true;
    }
    return false;
  }

  function finish(c: GestureContact, cancelled = false) {
    if (syncViewport()) return;
    if (nav.drag?.id !== c.id) return;
    if (nav.drag.kind === "content") scrollers[nav.selected].endDrag(cancelled ? 0 : -c.vy);
    const openedBefore = [...nav.opened];
    nav.up(c, cancelled);
    for (const app of installed) {
      if (openedBefore.includes(app.index) && !nav.opened.includes(app.index)) {
        if (!closeApp(app.output)) {
          nav.restoreNativeCard(app.index, openedBefore.indexOf(app.index));
          setNotice(`Could not close ${app.title}. Try again.`); noticeFrames = 240;
          continue;
        }
        setShots(previous => { const next = { ...previous }; delete next[app.index]; return next; });
      }
    }
  }
  createGesture({
    panSlop: 0,
    onDown(c) {
      syncViewport();
      const kind = nav.down(c);
      if (kind === "content") scrollers[nav.selected].beginDrag();
    },
    onPanMove(c) {
      if (syncViewport()) return;
      if (nav.drag?.id !== c.id) return;
      if (nav.drag.kind === "content") scrollers[nav.selected].drag(-c.fdy / nav.cards[nav.selected].scale.value);
      nav.move(c, 1 / simulationHz());
    },
    onUp: c => finish(c),
    onCancel: c => finish(c, true),
  });

  onMount(() => {
    batch = createJumpBatch(windows.flatMap(node => [
      [node, "translateX"], [node, "translateY"], [node, "scaleX"], [node, "scaleY"], [node, "radius"], [node, "opacity"],
    ] as const));
    paint();
  });

  function paint() {
    if (!batch) return;
    setStack(`${nav.foreground}/${nav.opened.join(",")}`);
    const active = nav.cards[nav.selected];
    const scene = nav.scene.value;
    const expansion = smooth(0.175, 1, scene);
    jump(home, "opacity", 1 - smooth(0.2, 0.52, scene));
    for (let i = 0; i < HOME_PAGES; i++) {
      const x = (i - nav.homePage.value) * layout().width;
      jump(pages[i], "translateX", x);
      jump(pages[i], "opacity", x <= -layout().width || x >= layout().width ? 0 : 1);
      jump(dots[i], "opacity", 0.28 + 0.72 * Math.max(0, 1 - Math.abs(i - nav.homePage.value)));
    }
    jump(wallpaper, "translateX", -8 * nav.homePage.value * (1 - expansion));
    // Occluded wallpaper and detail-underlay subtrees contribute no draw work.
    jump(wallpaper, "opacity", 1 - smooth(0.96, 1, scene) *
      (1 - smooth(0, 16, Math.abs(active.x.value) + Math.abs(active.y.value))));
    jump(wallpaper, "scaleX", 1.06 - expansion * 0.06);
    jump(wallpaper, "scaleY", 1.06 - expansion * 0.06);
    const overviewOpacity = Math.max(0, Math.min(1, nav.overview.value));
    jump(overview, "opacity", nav.opened.length ? overviewOpacity : 0);
    jump(empty, "opacity", nav.opened.length ? 0 : overviewOpacity);
    const ink = smooth(0.75, 1, scene);
    jump(pill, "bgColor", (0xff000000 | (Math.round(255 - 184 * ink) << 16) |
      (Math.round(255 - 206 * ink) << 8) | Math.round(255 - 217 * ink)) >>> 0);
    jump(pill, "scaleX", 1 - (nav.drag?.kind === "navigation" ? 0.12 * (1 - expansion) : 0));
    let windowsChanged = false;
    for (let i = 0; i < windows.length; i++) {
      const c = nav.cards[i], b = i * 6;
      const visibility = nav.paintVisibility(i), offset = scrollers[i].offset();
      if (windowPose[b] === c.x.value && windowPose[b + 1] === c.y.value &&
          windowPose[b + 2] === c.scale.value && windowPose[b + 3] === visibility &&
          windowPose[b + 4] === c.visibility.value && windowPose[b + 5] === offset) continue;
      windowPose[b] = c.x.value; windowPose[b + 1] = c.y.value;
      windowPose[b + 2] = c.scale.value; windowPose[b + 3] = visibility;
      windowPose[b + 4] = c.visibility.value; windowPose[b + 5] = offset;
      windowsChanged = true;
      batch.set(b, c.x.value); batch.set(b + 1, c.y.value);
      batch.set(b + 2, c.scale.value); batch.set(b + 3, c.scale.value);
      batch.set(b + 4, 28 * (1 - smooth(0.72, 1, c.scale.value)));
      batch.set(b + 5, visibility);
      jump(contents[i], "translateY", -offset);
      jump(labels[i], "translateX", c.x.value);
      jump(labels[i], "translateY", c.y.value - 29);
      jump(labels[i], "opacity", Math.max(0, Math.min(1, c.visibility.value)) * (1 - smooth(0.72, 0.96, c.scale.value)));
    }
    if (windowsChanged) batch.commit();
    jump(detail, "translateX", layout().width * (1 - nav.detail.value));
    jump(detail, "opacity", smooth(0, 0.01, nav.detail.value));
    jump(detailUnder, "translateX", -78 * nav.detail.value);
    jump(detailUnder, "opacity", 1 - smooth(0.95, 1, nav.detail.value));
  }

  onFrame(() => {
    syncViewport();
    nav.step(1 / simulationHz());
    scrollers.forEach(s => s.step());
    const native = nativeAt(nav.selected);
    const card = nav.cards[nav.selected];
    if (native && nav.destination === "app" && !nav.drag && launchedAction !== nav.actions &&
        Math.abs(card.scale.value - 1) < 0.005 && Math.abs(card.x.value) < 1) {
      launchedAction = nav.actions;
      if (!launchApp(native.output)) {
        setNotice(`${native.title} is not installed.`); noticeFrames = 240;
        nav.rejectNativeLaunch(nav.selected);
        launchedAction = nav.actions;
      }
    }
    if (noticeFrames > 0 && --noticeFrames === 0) setNotice("");
    paint();
    if (nav.actions !== actionCount) {
      actionCount = nav.actions;
      reportAppAction("shell_touch_gesture", actionCount);
    }
  });

  return <View debugName="TouchShell" class="relative overflow-hidden" style={{ width: layout().width, height: layout().height }}>
    <Image nodeRef={n => wallpaper = n!} class="absolute" style={layout().wallpaper} src="wallpaper.svg" />
    <View nodeRef={n => home = n!} class="absolute inset-0">
      {Array.from({ length: HOME_PAGES }, (_, page) => <View nodeRef={n => pages[page] = n!} debugName={`TouchHomePage${page}`} class="absolute inset-0">
        <Text class="absolute left-[22] text-2xl font-bold text-white" style={{ insetT: layout().headerY }}>{page === 0 ? 'Pocket Shell' : 'A little more.'}</Text>
        <Text class="absolute left-[24] text-xs text-[#eee0df]" style={{ insetT: layout().subtitleY }}>{page === 0 ? 'A little room to move.' : 'Everyday things, a swipe away.'}</Text>
        {APPS.map((app, i) => app.page === page ? <View debugName={`TouchHomeIcon${i}`} class="absolute w-[56] h-[82]" style={{ insetL: layout().icon(i).x, insetT: layout().icon(i).y }}>
          {nativeAt(i) ? <View class="absolute w-[56] h-[56] rounded-[16]" style={{ bgColor: nativeAt(i)!.color }}>
            <Text class="absolute inset-0 top-[12] text-center text-2xl font-bold text-white">{i === 4 ? "✓" : "V"}</Text>
          </View> : <Icon index={i} />}
          <Text class="absolute top-[64] left-[-9] w-[74] text-center text-xs text-white">{names[i]}</Text>
        </View> : null)}
        {page === 1 ? <>
          <View class="absolute w-[132] h-[71] rounded-[18] bg-[#d7c6d5]" style={{ insetL: layout().homeLeft + 20, insetT: layout().widgetY }}>
            <Text class="absolute left-[14] top-[12] text-xs font-bold text-[#79627d]">A LITTLE PAUSE</Text>
            <Text class="absolute left-[14] top-[36] text-base font-bold text-[#65536c]">Take a breath.</Text>
          </View>
          <View class="absolute w-[130] h-[71] rounded-[18] bg-[#d4e2dc]" style={{ insetL: layout().homeLeft + 168, insetT: layout().widgetY }}>
            <Text class="absolute left-[14] top-[12] text-xs font-bold text-[#6f9082]">OUTSIDE</Text>
            <Text class="absolute left-[14] top-[36] text-lg font-bold text-[#567b69]">21° · Sunny</Text>
          </View>
        </> : null}
      </View>)}
      {Array.from({ length: HOME_PAGES }, (_, page) => <View nodeRef={n => dots[page] = n!} debugName={`TouchHomeDot${page}`} class="absolute w-[6] h-[6] rounded-full bg-white" style={{ insetL: layout().width / 2 - 11 + page * 16, insetT: layout().dotsY }} />)}
      <View debugName="TouchHomeDock" class="absolute w-[300] h-[94] rounded-[24] bg-white opacity-10" style={{ insetL: (layout().width - 300) / 2, insetT: layout().dockY - 12 }} />
      {APPS.map((app, i) => app.page < 0 ? <View debugName={`TouchHomeIcon${i}`} class="absolute w-[56] h-[82]" style={{ insetL: layout().icon(i).x, insetT: layout().icon(i).y }}>
        {nativeAt(i) ? <View class="absolute w-[56] h-[56] rounded-[16]" style={{ bgColor: nativeAt(i)!.color }}>
            <Text class="absolute inset-0 top-[12] text-center text-2xl font-bold text-white">{i === 4 ? "✓" : "V"}</Text>
          </View> : <Icon index={i} />}
        <Text class="absolute top-[64] left-[-9] w-[74] text-center text-xs text-white">{names[i]}</Text>
      </View> : null)}
    </View>
    <View nodeRef={n => overview = n!} class="absolute left-0 right-0 bottom-[42] h-[21]">
      <Text class="w-full text-center text-xs text-[#f8e7e8]">Slide between your spaces</Text>
    </View>
    <View nodeRef={n => empty = n!} class="absolute left-0 right-0 h-[75]" style={{ insetT: layout().height / 2 - 40 }}>
      <Text class="w-full text-center text-xl font-bold text-white">All clear.</Text>
      <Text class="absolute top-[37] w-full text-center text-xs text-[#f8e7e8]">Tap to return home and open an app.</Text>
    </View>
    {names.map((name, i) => <>
      <Text nodeRef={n => labels[i] = n!} class="absolute left-0 top-0 text-sm font-bold text-white" style={{ zIndex: layer(i) + 1 }}>{name}</Text>
      <View nodeRef={n => windows[i] = n!} debugName={`TouchWindow${i}`} class="absolute left-0 top-0 overflow-hidden"
        style={{ width: layout().width, height: layout().height, originX: -0.5, originY: -0.5, zIndex: layer(i), bgColor: APPS[i].background }}>
        <View nodeRef={n => { if (i === 0) detailUnder = n!; }} debugName={`TouchWindowContent${i}`} class="absolute inset-0"
          style={{ opacity: shots()[i] ? 0 : 1 }}>
          <Text class="absolute left-[24] top-[47] text-xs font-bold tracking-wide" style={{ textColor: COLORS[i] }}>{APPS[i].subtitle}</Text>
          <Text class="absolute left-[22] top-[73] text-4xl font-bold text-[#27334b]">{name}</Text>
          <View class="absolute w-[320] overflow-hidden" style={{ insetL: layout().contentLeft, insetT: layout().contentTop, height: layout().contentHeight }}>
            <View nodeRef={n => contents[i] = n!} class="absolute left-0 top-0 w-[320] h-[620]">
              {nativeAt(i) ? <>
                <Text class="absolute left-[24] top-[32] text-lg font-bold text-[#27334b]">{nativeAt(i)!.title}</Text>
                <Text class="absolute left-[24] top-[78] text-sm text-[#7b8496]">Swipe the bottom bar to return.</Text>
                <Text class="absolute left-[24] top-[106] text-sm text-[#7b8496]">Your app stays where you left it.</Text>
              </> : <AppMockup index={i} />}
            </View>
          </View>
          <Text class="absolute left-0 right-0 bottom-[26] text-center text-xs text-[#8b90a3]">Swipe for home · hold for apps</Text>
        </View>
        {shots()[i] ? <Image debugName={`NativeAppShot${i}`} class="absolute inset-0" src={shots()[i]} /> : null}
        {i === 0 ? <View nodeRef={n => detail = n!} class="absolute inset-0 bg-[#f7f8fc]" style={{ translateX: layout().width }}>
          <Text class="absolute left-[23] top-[48] text-sm font-bold text-[#537bf4]">‹  Today</Text>
          <Text class="absolute left-[23] top-[99] text-4xl font-bold text-[#27334b]">Slow afternoon</Text>
          <Text class="absolute left-[25] top-[148] text-sm text-[#7b8496]">Leave a little space in your day.</Text>
          <View class="absolute w-[274] h-[156] rounded-[16] bg-[#e5ecff]" style={{ insetL: layout().landscape ? layout().width - 297 : (layout().width - 274) / 2, insetT: layout().landscape ? 80 : 194 }}>
            <Text class="absolute left-[21] top-[24] text-xl font-bold text-[#38559b]">Take the scenic route.</Text>
            <Text class="absolute left-[21] top-[66] text-base text-[#5c75aa]">A walk. A record. A good coffee.</Text>
            <Text class="absolute left-[21] top-[110] text-sm text-[#5c75aa]">The rest can wait.</Text>
          </View>
          <Text class="absolute text-sm text-[#7b8496]" style={{ insetL: layout().landscape ? layout().width - 295 : 25, insetT: layout().landscape ? 270 : 382 }}>Drag from the left edge to go back.</Text>
        </View> : null}
      </View>
    </>)}
    <Text class="absolute left-[23] top-[13] text-xs font-bold text-[#80879a]" style={{ zIndex: CHROME_LAYER }}>9:41</Text>
    <View class="absolute right-[25] top-[14] w-[21] h-[9] rounded border border-[#80879a]" style={{ zIndex: CHROME_LAYER }}>
      <View class="absolute left-[2] top-[2] w-[15] h-[3] rounded bg-[#80879a]" />
    </View>
    {notice() ? <View class="absolute left-[18] right-[18] bottom-[38] h-[64] rounded-[12] bg-[#263147]" style={{ zIndex: CHROME_LAYER + 1 }}>
      <Text class="absolute left-[12] right-[12] top-[12] text-sm text-white">{notice()}</Text>
    </View> : null}
    <View nodeRef={n => pill = n!} class="absolute bottom-[9] w-[96] h-[4] rounded-full bg-[#263147]" style={{ insetL: (layout().width - 96) / 2, zIndex: CHROME_LAYER }} />
  </View>;
}
