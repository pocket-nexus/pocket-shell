// SPDX-License-Identifier: GPL-3.0-or-later
// applets/kit/app.tsx — an applet in the design system. `createApp` gives you the
// page stack, touch and keys, alerts, a compose sheet, faces for any script,
// avatars and cached queries; `listPage` and `linesPage` are the two kinds of
// page. An app is a table of page builders:
//
//   export default createApp({
//     name: "notes",
//     root: "home",
//     page(id, app, layer) { return listPage(app, layer, { title: "Notes", rows: () => [...] }); },
//   });
import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js";
import { ClassicSpinner } from "@pocketjs/framework/classic";
import { after } from "@pocketjs/framework/clock";
import { Image, Text, View } from "@pocketjs/framework/components";
import { BTN } from "@pocketjs/framework/input";
import { onButtonPress } from "@pocketjs/framework/lifecycle";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { barButtonWidth, NAV_H, setFlatBackIcon, type NavButton } from "../ui/bar.tsx";
import { keep } from "../ui/keep.ts";
import { Legend, legendWhileTyping } from "../ui/legend.tsx";
import { createNavStack, viewHeight, type LayerContext, type NavStack, type PageSpec } from "../ui/nav.tsx";
import { SCREEN_H, SCREEN_W, appletSurfaceId, appletTouch } from "../ui/screen.ts";
import { FONT, wrap } from "../ui/text.ts";
import { createPress, createTouchRouter, type Press, type Target } from "../ui/touch.ts";
import { createImages, type Images } from "./images.ts";
import { ICONS, type IconSrc } from "./icons.ts";
import { keyboardElsewhere, QUERIES_KEPT, Surface } from "./platform.tsx";
import { linesContent, type SourceLine } from "./lines.tsx";
import { listContent } from "./list.tsx";
import { createQueries, type Queries } from "./query.ts";
import { createRows, type Row, type Rows } from "./rows.ts";
import { createFaces, type Faces } from "./text.ts";
import { S, T } from "./theme.ts";

export interface Confirm {
  title: string;
  message: string;
  /** The button that does it: name what it does ("Merge"). */
  action: string;
  danger?: boolean;
  run: () => void;
}

export interface Compose {
  title: string;
  placeholder: string;
  /** What the button says: "Comment", "Save". */
  action: string;
  initial?: string;
  /** Enter ends the text and sends it, rather than starting a line. */
  singleLine?: boolean;
  /** Show dots instead of the text: a token. */
  secret?: boolean;
  /** Resolves when it is done; a rejection shows on the sheet, with the text kept. */
  send(text: string): Promise<void>;
}

/** What a page builder works with. */
export interface App {
  stack: NavStack;
  press: Press;
  keys: Accessor<boolean>;
  faces: Faces;
  images: Images;
  queries: Queries;
  rows: Rows;
  confirm(alert: Confirm): void;
  compose(sheet: Compose): void;
  /** A short message over the page: "Starred". */
  say(message: string, failed?: boolean): void;
}

export interface AppOptions {
  /** Its pages and scroll positions outlive a resize under this name. */
  name: string;
  root: string;
  page(id: string, app: App, layer: LayerContext): PageSpec;
}

interface Kept {
  images: Images;
  queries: Queries;
}

export function createApp(options: AppOptions): () => JSX.Element {
  return function KitApp() {
    setFlatBackIcon(ICONS.back.accent);
    const press = createPress();
    const [keys, setKeys] = createSignal(!appletTouch());
    const kept = keep<Kept>("kit", () => ({ images: createImages(), queries: createQueries(QUERIES_KEPT) }));
    const faces = createFaces();
    const [confirmation, setConfirmation] = createSignal<Confirm | null>(null);
    const [sheet, setSheet] = createSignal<Compose | null>(null);
    const [draft, setDraft] = createSignal("");
    const [sending, setSending] = createSignal(false);
    const [sheetError, setSheetError] = createSignal("");
    const [notice, setNotice] = createSignal<{ text: string; failed: boolean } | null>(null);
    let noticeRun = 0;

    const closeSheet = () => {
      if (osk.isOpen()) osk.close();
      setSheet(null);
      setSheetError("");
    };
    const send = () => {
      const open = sheet();
      const text = draft().trim();
      if (!open || sending() || !text) return;
      if (osk.isOpen()) osk.close();
      setSending(true);
      setSheetError("");
      open.send(text).then(
        () => {
          setSending(false);
          closeSheet();
        },
        (failure: unknown) => {
          setSending(false);
          setSheetError(failure instanceof Error ? failure.message : String(failure));
        },
      );
    };
    const osk = createOsk({
      value: draft,
      setValue: setDraft,
      maxLength: 8000,
      onCommit: (text) => {
        if (sheet()?.singleLine) return send();
        // Enter starts a new line; the sheet's button sends.
        setDraft(`${text}\n`);
        osk.open();
      },
    });
    legendWhileTyping(osk.isOpen, "Text");

    const app: App = {
      stack: null as unknown as NavStack,
      press,
      keys,
      faces,
      images: kept.images,
      queries: kept.queries,
      rows: createRows(faces, SCREEN_W),
      confirm: (alert) => setConfirmation(alert),
      compose(next) {
        setDraft(next.initial ?? "");
        setSheetError("");
        setSheet(next);
        osk.open();
      },
      say(text, failed = false) {
        const run = ++noticeRun;
        setNotice({ text, failed });
        after(failed ? 5 : 2.5, () => run === noticeRun && setNotice(null));
      },
    };
    const stack = createNavStack({
      restore: options.name,
      press,
      keys,
      setKeys,
      onExit: () => undefined,
      rootBack: null,
      background: () => <View class="absolute left-0 top-0" style={{ width: SCREEN_W, height: SCREEN_H, bgColor: T.bg }} />,
      page: (id, _nav, layer) => options.page(id, app, layer),
    });
    app.stack = stack;
    if (stack.entries().length === 0) stack.reset(options.root);

    const ALERT_W = Math.min(300, SCREEN_W - 32);
    const alertX = (SCREEN_W - ALERT_W) / 2;
    const alertLines = () => wrap(confirmation()?.message ?? "", FONT.xs, ALERT_W - 32, 6);
    const alertH = () => 54 + alertLines().length * 16 + 50;
    const alertY = () => Math.round((SCREEN_H - alertH()) / 2);
    const buttonW = (ALERT_W - 16 * 2 - 8) / 2;
    const cancelAlert = () => setConfirmation(null);
    const confirmAlert = () => {
      const alert = confirmation();
      setConfirmation(null);
      alert?.run();
    };

    const sheetTargets = (): Target[] => {
      const open = sheet();
      if (!open) return [];
      const action = { id: "sheet.send", label: open.action, kind: "plain", run: send } satisfies NavButton;
      return [
        { id: "sheet.text", x: 0, y: NAV_H, w: SCREEN_W, h: SCREEN_H - NAV_H, run: () => !osk.isOpen() && osk.open() },
        { id: "sheet.cancel", x: 0, y: 0, w: 70, h: NAV_H, run: closeSheet },
        { id: "sheet.send", x: SCREEN_W - barButtonWidth(action) - 14, y: 0, w: barButtonWidth(action) + 14, h: NAV_H, run: send },
      ];
    };

    createTouchRouter({
      surface: appletSurfaceId(),
      press,
      page: () => {
        if (confirmation()) {
          const targets: Target[] = [
            { id: "alert.cancel", x: alertX + 16, y: alertY() + alertH() - 44, w: buttonW, h: S.buttonH, run: cancelAlert },
            { id: "alert.action", x: alertX + 16 + buttonW + 8, y: alertY() + alertH() - 44, w: buttonW, h: S.buttonH, run: confirmAlert },
          ];
          return { targets: () => targets };
        }
        if (sheet()) return { targets: sheetTargets };
        return stack.touch();
      },
      active: () => !stack.busy() && (keyboardElsewhere() || !osk.isOpen()),
      onTouch: () => setKeys(false),
    });

    onButtonPress(0xffff, (pressed) => {
      if (confirmation()) {
        if (pressed & BTN.CIRCLE) confirmAlert();
        else if (pressed & BTN.CROSS) cancelAlert();
        return;
      }
      if (sheet()) {
        if (pressed & BTN.CROSS && !osk.isOpen()) closeSheet();
        else if (pressed & BTN.CIRCLE && !osk.isOpen()) send();
        return;
      }
      if (osk.isOpen()) return;
      stack.key(pressed);
    });

    const sheetText = createMemo(() => {
      const open = sheet();
      if (!open) return [] as string[];
      const value = osk.isOpen() ? osk.display("|") : draft();
      if (!value) return [];
      return wrap(open.secret ? "*".repeat(Math.min(value.length, 64)) : value, FONT.sm, SCREEN_W - S.pad * 2, 20);
    });
    const keyboardTop = SCREEN_H - oskHeight(appletSurfaceId(), "light");

    return (
      <Surface>
        <View class="relative w-full h-full overflow-hidden" style={{ bgColor: T.bg }}>
          {stack.view()}
          <Show when={notice()}>
            {(shown) => (
              <View class="absolute rounded-[8]" style={{ insetL: 16, insetT: NAV_H + 8, width: SCREEN_W - 32, height: 34, bgColor: shown().failed ? T.redFill : T.raised }}>
                <Text class="absolute left-[12] top-[9] text-xs font-bold" style={{ textColor: "#ffffff" }}>{wrap(shown().text, FONT.xsBold, SCREEN_W - 56, 1)[0] ?? ""}</Text>
              </View>
            )}
          </Show>
          <Show when={sheet()}>
            {(open) => (
              <View class="absolute left-0 top-0" style={{ width: SCREEN_W, height: SCREEN_H, bgColor: T.bg }}>
                <View class="absolute left-0 top-0 h-[36]" style={{ width: SCREEN_W, bgColor: T.surface }} />
                <View class="absolute left-0 top-[35] h-[1]" style={{ width: SCREEN_W, bgColor: T.line }} />
                <Text class="absolute left-[12] top-[10] text-sm font-bold" style={{ textColor: press.is("sheet.cancel") ? T.muted : T.accent }}>Cancel</Text>
                <Text class="absolute top-[10] text-sm font-bold text-center" style={{ insetL: 70, width: SCREEN_W - 140, textColor: T.text }}>{open().title}</Text>
                <Show when={!sending()} fallback={<View class="absolute top-[7]" style={{ insetL: SCREEN_W - 34 }}><ClassicSpinner size={22} color={T.muted} /></View>}>
                  <Text class="absolute top-[10] text-sm font-bold text-right" style={{ insetL: SCREEN_W - 112, width: 100, textColor: draft().trim() ? (press.is("sheet.send") ? T.muted : T.accent) : T.faint }}>{open().action}</Text>
                </Show>
                <Show when={sheetText().length} fallback={<Text class="absolute left-[12] text-sm" style={{ insetT: NAV_H + 12, textColor: T.faint }}>{open().placeholder}</Text>}>
                  <Text class="absolute left-[12] text-sm leading-[20]" style={{ insetT: NAV_H + 12, textColor: T.text }}>{sheetText().join("\n")}</Text>
                </Show>
                <Show when={sheetError()}>
                  <Text class="absolute left-[12] text-xs" style={{ insetT: SCREEN_H - 26, textColor: T.red }}>{wrap(sheetError(), FONT.xs, SCREEN_W - 24, 1)[0] ?? ""}</Text>
                </Show>
              </View>
            )}
          </Show>
          <Show when={confirmation()}>
            {(alert) => (
              <View class="absolute left-0 top-0" style={{ width: SCREEN_W, height: SCREEN_H, bgColor: T.shade }}>
                <View class="absolute rounded-[12] border" style={{ insetL: alertX, insetT: alertY(), width: ALERT_W, height: alertH(), bgColor: T.surface, borderColor: T.line }} />
                <Text class="absolute text-sm font-bold text-center" style={{ insetL: alertX + 16, insetT: alertY() + 16, width: ALERT_W - 32, textColor: T.text }}>{wrap(alert().title, FONT.smBold, ALERT_W - 32, 1)[0] ?? ""}</Text>
                <For each={alertLines()}>
                  {(line, index) => <Text class="absolute text-xs text-center" style={{ insetL: alertX + 16, insetT: alertY() + 42 + index() * 16, width: ALERT_W - 32, textColor: T.muted }}>{line}</Text>}
                </For>
                <View class="absolute rounded-[6]" style={{ insetL: alertX + 16, insetT: alertY() + alertH() - 44, width: buttonW, height: S.buttonH, bgColor: press.is("alert.cancel") ? T.line : T.raised }} />
                <Text class="absolute text-xs font-bold text-center" style={{ insetL: alertX + 16, insetT: alertY() + alertH() - 36, width: buttonW, textColor: T.text }}>Cancel</Text>
                <View class="absolute rounded-[6]" style={{ insetL: alertX + 24 + buttonW, insetT: alertY() + alertH() - 44, width: buttonW, height: S.buttonH, bgColor: alert().danger ? T.redFill : T.greenFill }} />
                <Text class="absolute text-xs font-bold text-center" style={{ insetL: alertX + 24 + buttonW, insetT: alertY() + alertH() - 36, width: buttonW, textColor: "#ffffff" }}>{alert().action}</Text>
              </View>
            )}
          </Show>
          <View class="absolute left-0" style={{ insetT: keyboardTop, width: SCREEN_W, height: SCREEN_H - keyboardTop }}>
            <Osk osk={osk} surface={appletSurfaceId()} theme="dark" />
          </View>
        </View>
        <Legend home />
      </Surface>
    );
  };
}

// ---- pages ---------------------------------------------------------------------------

export interface Tab {
  id: string;
  label: string;
  /** Its icon, then the same in the accent colour when selected. */
  icon: IconSrc;
  on: IconSrc;
}

export interface ListPageOptions {
  title: Accessor<string> | string;
  /** The back button's text on the page above this one. */
  backLabel?: string;
  rows: (rows: Rows) => Row[];
  loading?: Accessor<boolean>;
  onEnd?: () => void;
  right?: Accessor<NavButton | null>;
  /** A bottom tab bar. */
  tabs?: { items: Tab[]; current: Accessor<string>; select(id: string): void };
  key?: (pressed: number) => boolean;
}

const asTitle = (title: Accessor<string> | string): Accessor<string> => (typeof title === "string" ? () => title : title);

/** A page that is one scrolling list of rows, under the kit's bar and over its tabs. */
export function listPage(app: App, layer: LayerContext, options: ListPageOptions): PageSpec {
  const inset = options.tabs ? S.tabH : 0;
  const rows = createMemo(() => {
    app.faces.revision();
    return options.rows(app.rows);
  });
  const tabs = options.tabs;
  const tabW = tabs ? SCREEN_W / tabs.items.length : 0;
  return {
    title: asTitle(options.title),
    backLabel: options.backLabel,
    tint: "flat",
    right: options.right,
    inset,
    key: options.key,
    activateLabel: () => "Open",
    content: listContent({ rows, layer, press: app.press, images: app.images, keys: app.keys, width: SCREEN_W, view: viewHeight(inset), loading: options.loading, onEnd: options.onEnd }),
    fixed: tabs
      ? () => (
          <View class="absolute left-0" style={{ insetT: SCREEN_H - S.tabH, width: SCREEN_W, height: S.tabH, bgColor: T.surface }}>
            <View class="absolute left-0 top-0 h-[1]" style={{ width: SCREEN_W, bgColor: T.line }} />
            <For each={tabs.items}>
              {(tab, index) => (
                <>
                  <Image class="absolute w-[16] h-[16]" src={tabs.current() === tab.id ? tab.on : tab.icon} style={{ insetL: index() * tabW + (tabW - 16) / 2, insetT: 7 }} />
                  <Text class="absolute text-2xs text-center" style={{ insetL: index() * tabW, insetT: 26, width: tabW, textColor: tabs.current() === tab.id ? T.accent : T.muted }}>{tab.label}</Text>
                </>
              )}
            </For>
          </View>
        )
      : undefined,
    fixedTargets: tabs
      ? () => tabs.items.map((tab, index) => ({ id: `tab.${tab.id}`, x: index * tabW, y: SCREEN_H - S.tabH, w: tabW, h: S.tabH, run: () => tabs.select(tab.id) }))
      : undefined,
  };
}

/** A page of code or a diff in monospace. */
export function linesPage(app: App, layer: LayerContext, options: { title: Accessor<string> | string; backLabel?: string; lines: Accessor<SourceLine[]>; right?: Accessor<NavButton | null> }): PageSpec {
  return {
    title: asTitle(options.title),
    backLabel: options.backLabel,
    tint: "flat",
    right: options.right,
    activateLabel: () => "",
    content: linesContent({ lines: options.lines, layer, faces: app.faces, width: SCREEN_W, view: viewHeight() }),
  };
}

export type { SourceLine };
export type { LayerContext } from "../ui/nav.tsx";
export { markdownRows } from "./markdown.ts";
export { ICONS };
