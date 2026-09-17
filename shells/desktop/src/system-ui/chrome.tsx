// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/chrome.tsx — presentational theme-neutral chrome, SolidJS JSX
// (SolidJS universal renderer). Every component here only paints; the compositor (app.tsx) owns hit
// testing and routes all pointer/keyboard input itself off the svc mouse
// stream, so nothing in this file registers a handler. Geometry mirrors
// wm.ts through the active theme's ChromeMetrics.
//
// Each component renders one SEMANTIC part of the shell — a control cluster,
// a task strip, a launcher panel — and asks the theme for its classes, its
// layers and its icon artwork. Nothing here branches on a theme id: where a
// part can sit in different places (controls left or right, menus in the
// window or in a screen bar, task buttons in a strip or a Dock) the choice
// rides a ChromeMetrics field the window manager reads too.
//
// Class strings are FULL literals throughout — the style table compiles at
// build time and template-interpolated fragments are a compile error, so the
// complete theme-selected classes stay visible to the compiler.

import { createEffect } from "solid-js";
import { Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { animate, jump } from "@pocketjs/framework/animation";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { virtualNow } from "@pocketjs/framework/clock";
import { createState } from "./reactivity.ts";
import { type CaptionState, type DesktopTheme } from "./theme.ts";
import type { DeskIcon, MenuDef, Popup, TaskEntry, WinCtl } from "./state.ts";
import { captionSlots, desktopIconPosition } from "./wm.ts";

/** Desktop text. The baked slot rides the style prop — the class table never
 *  sees it (baked per-app via pak.json, docs in gen-assets.ts) — and the
 *  active theme owns which face each role maps to, so a theme switch reflows
 *  every string. Text rides the `t` prop; `cls` replaces the class attr so
 *  nothing falls through to a user component's attrs. */
export function UiText(props: {
  t: string;
  theme: DesktopTheme;
  cls?: string;
  bold?: boolean;
  xl?: boolean;
}) {
  return (
    <Text
      class={props.cls ?? "text-[#000000]"}
      style={{
        fontSlot: props.theme.fontSlot(
          props.xl ? "xl" : props.bold ? "bold" : "ui",
        ),
      }}
    >
      {props.t}
    </Text>
  );
}

/** Caption controls in the theme's visual order. wm.ts captionSlots mirrors
 *  the theme-selected cell size, side, inset and gap; app.tsx drives pressed
 *  and hover feedback off the raw pointer stream. Ghost cells (controls the
 *  window lacks) only appear for themes that ask for them. */
export function CaptionButtons(props: {
  win: WinCtl;
  active: boolean;
  theme: DesktopTheme;
}) {
  const w = props.win;
  const state = (btn: WinCtl["buttons"][number], present: boolean): CaptionState => ({
    pressed: w.pressedBtn() === btn,
    hover: w.captionHover(),
    active: props.active,
    present,
  });
  return (
    <View class={props.theme.captionControls}>
      {captionSlots(w.geo().w, w.buttons, props.theme.metrics).map(
        (slot) => (
          <View
            class={props.theme.captionButton(
              slot.button,
              state(slot.button, slot.present),
            )}
          >
            {props.theme.captionFace(slot.button, state(slot.button, slot.present)) !== "" ? (
              <Image
                class={props.theme.captionFaceClass}
                src={props.theme.captionFace(slot.button, state(slot.button, slot.present))}
              />
            ) : null}
            {props.theme
              .captionButtonLayers(slot.button, state(slot.button, slot.present))
              .map((cls) => (
                <View class={cls} />
              ))}
            {props.theme.captionGlyphSource(
              slot.button,
              slot.button === "max" && w.maximized(),
              state(slot.button, slot.present),
            ) !== "" ? (
              <Image
                class={props.theme.captionGlyphClass(
                  state(slot.button, slot.present),
                )}
                src={props.theme.captionGlyphSource(
                  slot.button,
                  slot.button === "max" && w.maximized(),
                  state(slot.button, slot.present),
                )}
              />
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}

/** The screen-top bar (only mounted while `metrics.screenBarH > 0`): the
 *  launcher logo at the left end, the focused program's name and its menu
 *  titles, the clock at the right end. Hit widths come from app.tsx, which
 *  measures the same labels in the same face. */
export function ScreenBar(props: {
  startOpen: boolean;
  appName: string;
  menus: MenuDef[] | null;
  openMenu: number;
  clock: string;
  theme: DesktopTheme;
}) {
  return (
    <View class={props.theme.screenBar} style={{ zIndex: 10000 }}>
      {props.theme.screenBarLayers.map((cls) => (
        <View class={cls} />
      ))}
      <View class={props.theme.screenBarLogo(props.startOpen)}>
        <Image class="w-[16] h-[16]" src={props.theme.icon("start", 16)} />
      </View>
      {props.appName !== "" ? (
        <View class={props.theme.screenBarApp}>
          <UiText
            theme={props.theme}
            bold
            cls={props.theme.screenBarAppText}
            t={props.appName}
          />
        </View>
      ) : null}
      {(props.menus ?? []).map((menu, i) => (
        <View class={props.theme.menuItem(props.openMenu === i)}>
          <UiText
            theme={props.theme}
            cls={props.theme.menuText(props.openMenu === i)}
            t={menu.label}
          />
        </View>
      ))}
      <View class="flex-1" />
      <View class={props.theme.tray}>
        {props.theme.trayLayers.map((cls) => (
          <View class={cls} />
        ))}
        <UiText theme={props.theme} cls={props.theme.trayText} t={props.clock} />
      </View>
    </View>
  );
}

/** The task strip: the launcher button, one button per window, the clock
 *  tray. With a screen bar the launcher and the clock live up there and the
 *  strip is a Dock — a centered shelf of icon tiles with running marks. */
export function Taskbar(props: {
  entries: TaskEntry[];
  activeId: number;
  startOpen: boolean;
  clock: string;
  buttonW: number;
  theme: DesktopTheme;
  onTransition?: (until: number) => void;
}) {
  // Read through props on every evaluation: a bare const here would capture
  // the boot theme's answer for the life of the component.
  const dock = () => props.theme.metrics.screenBarH > 0;
  const retained = createState<TaskEntry[]>([]);
  const entries = () => dock() ? retained() : props.entries;
  let shelf: NodeMirror | undefined;
  let lastDock = false;
  let shown = false;
  let clearAt = 0;
  createEffect(() => {
    const next = props.entries;
    const isDock = dock();
    const visible = next.length > 0;
    if (!shelf) return;
    if (!isDock) {
      jump(shelf, "translateY", 0);
      jump(shelf, "opacity", 1);
      clearAt = 0;
      retained.set([]);
      props.onTransition?.(0);
    } else {
      if (visible) { retained.set(next); clearAt = 0; }
      if (!lastDock) {
        jump(shelf, "translateY", props.theme.metrics.taskH + 8);
        jump(shelf, "opacity", 0);
      }
      if (!lastDock || visible !== shown) {
        // The native animator starts from the current value when reversed.
        // Keep the last tiles mounted until the downward motion completes.
        const until = virtualNow() + 0.24;
        animate(shelf, "translateY", visible ? 0 : props.theme.metrics.taskH + 8, { dur: 240, easing: "in-out" });
        animate(shelf, "opacity", visible ? 1 : 0, { dur: 240, easing: "in-out" });
        if (!visible) clearAt = until;
        props.onTransition?.(until);
      }
    }
    lastDock = isDock;
    shown = visible;
  });
  onFrame(() => {
    if (clearAt > 0 && virtualNow() >= clearAt) {
      clearAt = 0;
      if (dock() && props.entries.length === 0) retained.set([]);
    }
  });
  return (
    <View
      ref={node => { shelf = node; }}
      debugName="TaskShelf"
      class={props.theme.taskbar}
      style={{ zIndex: 10000 }}
    >
      {props.theme.taskbarLayers.map((cls) => (
        <View class={cls} />
      ))}
      {!dock() ? (
        <View class={props.theme.startButton(props.startOpen)}>
          {props.theme.startFace(props.startOpen) !== "" ? (
            <Image
              class={props.theme.startFaceClass}
              src={props.theme.startFace(props.startOpen)}
            />
          ) : null}
          {props.theme.startLayers(props.startOpen).map((cls) => (
            <View class={cls} />
          ))}
          {props.theme.startLogo !== "" ? (
            <Image class="w-[16] h-[16]" src={props.theme.startLogo} />
          ) : null}
          <UiText
            theme={props.theme}
            bold
            cls={props.theme.startText}
            t="Start"
          />
        </View>
      ) : null}
      {!dock() ? <View class={props.theme.taskDivider} /> : null}
      {!dock() || entries().length > 0 ? (
        <View class={props.theme.taskList}>
          {entries().map((entry) => (
            <View
              class={props.theme.taskButton(entry.id === props.activeId)}
              style={{ width: props.buttonW }}
            >
              {props.theme
                .taskButtonLayers(entry.id === props.activeId)
                .map((cls) => (
                  <View class={cls} />
                ))}
              <Image
                class={props.theme.taskIcon}
                src={props.theme.icon(entry.icon, dock() ? 32 : 16)}
              />
              {props.theme.taskShowLabel ? (
                <View class="flex-1 flex-row overflow-hidden">
                  <UiText
                    theme={props.theme}
                    bold={entry.id === props.activeId}
                    cls={props.theme.taskText(entry.id === props.activeId)}
                    t={entry.title}
                  />
                </View>
              ) : null}
              {props.theme.taskMark(entry.id === props.activeId) !== "" ? (
                <Image
                  class={props.theme.taskMarkClass}
                  src={props.theme.taskMark(entry.id === props.activeId)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {!dock() ? (
        <View class={props.theme.tray}>
          {props.theme.trayLayers.map((cls) => (
            <View class={cls} />
          ))}
          <UiText theme={props.theme} cls={props.theme.trayText} t={props.clock} />
        </View>
      ) : null}
    </View>
  );
}

/** Generic popup menu panel (context menus, dropdowns, start flyouts). Row
 *  and separator heights are the theme's popupRowH / popupSepH metrics,
 *  which wm.ts popupRowAt hit-tests against. */
export function PopupPanel(props: {
  popup: Popup;
  hover: number;
  theme: DesktopTheme;
}) {
  return (
    <View
      class={props.theme.popup}
      style={{
        insetL: 0,
        insetT: 0,
        translateX: props.popup.x,
        translateY: props.popup.y,
        width: props.popup.w,
        zIndex: 20000,
      }}
    >
      {props.theme.popupLayers.map((cls) => (
        <View class={cls} />
      ))}
      {props.popup.items.map((item, i) =>
        item.sep ? (
          <View class={props.theme.popupSeparator}>
            <View class={props.theme.popupSeparatorDark} />
            <View class={props.theme.popupSeparatorLight} />
          </View>
        ) : (
          <View
            class={props.theme.popupItem(
              props.hover === i && !item.disabled,
            )}
          >
            {item.checked ? (
              <Image class="w-[16] h-[16]" src={props.theme.icon("check", 16)} />
            ) : item.icon ? (
              <Image class="w-[16] h-[16]" src={props.theme.icon(item.icon, 16)} />
            ) : (
              <View class="w-[16] h-[16]" />
            )}
            <View class="flex-1 flex-row">
              <UiText
                theme={props.theme}
                cls={props.theme.popupText(
                  item.disabled
                    ? "disabled"
                    : props.hover === i
                      ? "hover"
                      : "normal",
                )}
                t={item.label}
              />
            </View>
            {item.shortcut ? (
              <UiText
                theme={props.theme}
                cls={props.theme.popupText(
                  item.disabled
                    ? "disabled"
                    : props.hover === i
                      ? "hover"
                      : "normal",
                )}
                t={item.shortcut}
              />
            ) : null}
            {item.sub ? (
              <Image
                class="w-[8] h-[8] ml-[2]"
                src={props.theme.icon("menuArrow", 16)}
              />
            ) : null}
          </View>
        ),
      )}
    </View>
  );
}

/** One Start row: icon slot, label, submenu arrow. Shared by both panels. */
function StartRow(props: {
  item: Popup["items"][number];
  hover: boolean;
  theme: DesktopTheme;
}) {
  return (
    <View class={props.theme.startItem(props.hover && !props.item.disabled)}>
      {props.item.icon ? (
        <Image class="w-[16] h-[16]" src={props.theme.icon(props.item.icon, 16)} />
      ) : (
        <View class="w-[16] h-[16]" />
      )}
      <View class="flex-1 flex-row">
        <UiText
          theme={props.theme}
          bold={props.item.bottom}
          cls={props.theme.popupText(
            props.item.disabled
              ? "disabled"
              : props.hover
                ? "hover"
                : "normal",
          )}
          t={props.item.label}
        />
      </View>
      {props.item.sub ? (
        <Image class="w-[8] h-[8]" src={props.theme.icon("menuArrow", 16)} />
      ) : null}
    </View>
  );
}

function StartSep(props: { theme: DesktopTheme }) {
  return (
    <View class={props.theme.startSeparator}>
      <View class={props.theme.popupSeparatorDark} />
    </View>
  );
}

/** The XP Start panel: user header, a programs column with its pinned rows
 *  at the foot, a places column, and the Log-off strip. Geometry mirrors
 *  wm.ts startLayout — that is what app.tsx hit-tests against. */
export function StartPanel(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  items: Popup["items"];
  hover: number;
  user: string;
  theme: DesktopTheme;
}) {
  const at = (which: (it: Popup["items"][number]) => boolean) =>
    props.items
      .map((item, i) => ({ item, i }))
      .filter((e) => which(e.item));
  return (
    <View
      class={props.theme.startMenu}
      style={{
        insetL: 0,
        insetT: 0,
        translateX: props.x,
        translateY: props.y,
        width: props.w,
        height: props.h,
        zIndex: 19000,
      }}
    >
      {props.theme.startMenuLayers.map((cls) => (
        <View class={cls} />
      ))}
      <View class={props.theme.startHeader}>
        {props.theme.startHeaderLayers.map((cls) => (
          <View class={cls} />
        ))}
        <Image class={props.theme.startHeaderIcon} src={props.theme.icon("user", 32)} />
        <UiText
          theme={props.theme}
          bold
          cls={props.theme.startHeaderName}
          t={props.user}
        />
      </View>
      <View class="flex-1 flex-row">
        <View class={props.theme.startColumn("left")}>
          {at((it) => !it.foot && it.col !== "right" && !it.bottom).map((e) =>
            e.item.sep ? (
              <StartSep theme={props.theme} />
            ) : (
              <StartRow
                item={e.item}
                hover={props.hover === e.i}
                theme={props.theme}
              />
            ),
          )}
          <View class="flex-1" />
          {at((it) => !it.foot && !!it.bottom).map((e) =>
            e.item.sep ? (
              <StartSep theme={props.theme} />
            ) : (
              <StartRow
                item={e.item}
                hover={props.hover === e.i}
                theme={props.theme}
              />
            ),
          )}
        </View>
        <View class={props.theme.startColumn("right")}>
          <View class={props.theme.startColumnDivider} />
          {at((it) => !it.foot && it.col === "right").map((e) =>
            e.item.sep ? (
              <StartSep theme={props.theme} />
            ) : (
              <StartRow
                item={e.item}
                hover={props.hover === e.i}
                theme={props.theme}
              />
            ),
          )}
        </View>
      </View>
      <View class={props.theme.startFooter}>
        {props.theme.startFooterLayers.map((cls) => (
          <View class={cls} />
        ))}
        {at((it) => !!it.foot).map((e) => (
          <View class={props.theme.startFooterItem(props.hover === e.i)}>
            {e.item.icon ? (
              <Image class="w-[16] h-[16]" src={props.theme.icon(e.item.icon, 16)} />
            ) : null}
            <UiText
              theme={props.theme}
              cls={props.theme.startFooterText}
              t={e.item.label}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

/** The single-column Start menu: an optional rail plus one row per item.
 *  Classic paints it rising from the taskbar beside its blue rail; Aqua
 *  hangs the same panel, rail-less, from the screen bar. Flyouts render as
 *  PopupPanels. */
export function StartMenu(props: {
  x: number;
  y: number;
  w: number;
  h: number;
  items: Popup["items"];
  hover: number;
  theme: DesktopTheme;
}) {
  return (
    <View
      class={props.theme.startMenu}
      style={{
        insetL: 0,
        insetT: 0,
        translateX: props.x,
        translateY: props.y,
        width: props.w,
        height: props.h,
        zIndex: 19000,
      }}
    >
      {props.theme.startMenuLayers.map((cls) => (
        <View class={cls} />
      ))}
      <View class={props.theme.startRail} />
      <View class="flex-1 flex-col">
        {props.items.map((item, i) =>
          item.sep ? (
            <View class={props.theme.popupSeparator}>
              <View class={props.theme.popupSeparatorDark} />
              <View class={props.theme.popupSeparatorLight} />
            </View>
          ) : (
            <View
              class={props.theme.startItem(
                props.hover === i && !item.disabled,
              )}
            >
              {!props.theme.launcherIcons ? null : item.icon ? (
                <Image class="w-[16] h-[16]" src={props.theme.icon(item.icon, 16)} />
              ) : (
                <View class="w-[16] h-[16]" />
              )}
              <View class="flex-1 flex-row">
                <UiText
                  theme={props.theme}
                  cls={props.theme.popupText(
                    item.disabled
                      ? "disabled"
                      : props.hover === i
                        ? "hover"
                        : "normal",
                  )}
                  t={item.label}
                />
              </View>
              {item.sub ? (
                <Image class="w-[8] h-[8]" src={props.theme.icon("menuArrow", 16)} />
              ) : null}
            </View>
          ),
        )}
      </View>
    </View>
  );
}

/** Desktop icons: column-major 32px art + theme-selected labels, anchored
 *  to the theme's screen edge. */
export function DesktopIcons(props: {
  icons: DeskIcon[];
  selected: number;
  rows: number;
  viewportW: number;
  theme: DesktopTheme;
}) {
  return (
    <View class="absolute inset-0">
      {props.icons.map((icon, i) => (
        <View
          class="absolute left-0 top-0 w-[74] h-[48] flex-col items-center gap-[3]"
          style={{
            translateX: desktopIconPosition(
              i,
              props.rows,
              props.theme.metrics,
              props.viewportW,
            ).x,
            translateY: desktopIconPosition(
              i,
              props.rows,
              props.theme.metrics,
              props.viewportW,
            ).y,
          }}
        >
          <Image class="w-[32] h-[32]" src={props.theme.icon(icon.icon, 32)} />
          <View
            class={
              props.selected === i
                ? props.theme.desktopSelection
                : props.theme.desktopLabelPlain
            }
          >
            <UiText theme={props.theme} cls={props.theme.desktopLabel} t={icon.label} />
          </View>
        </View>
      ))}
    </View>
  );
}
