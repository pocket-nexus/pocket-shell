// Shared pieces of the Tab5 demo's interface, after the M5Tab5-UserDemo
// factory firmware: its screen is 1280x720 and places everything by offsets
// from the centre; this surface is 640x360, so every position and size here
// is half of the factory value.
import { For, Show, type JSX } from "solid-js";
import { animate, jump } from "@pocketjs/framework/animation";
import { Image, Text, View } from "@pocketjs/framework/components";
import type { NodeMirror } from "@pocketjs/framework/renderer";

/** Every printable ASCII character, so the baked glyphs cover any SSID,
 *  file name or serial text the demo shows. */
export const ASCII = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";

/** A factory centre offset (1280x720) to a point on this surface. */
export const X = (cx: number) => 320 + cx / 2;
export const Y = (cy: number) => 180 + cy / 2;

/** A factory rectangle: centre offset and size, all at 1280x720. */
export interface Frame { x: number; y: number; w: number; h: number }

export type Size = "2xs" | "xs" | "sm" | "base" | "lg" | "xl" | "2xl";
/** Line boxes of the baked slots (framework/compiler/tailwind.ts). */
const LINE: Record<Size, number> = { "2xs": 13, xs: 15, sm: 18, base: 20, lg: 22, xl: 24, "2xl": 29 };

/** Text classes are looked up verbatim, so each size is a whole literal. */
function textClass(size: Size, bold: boolean): string {
  switch (size) {
    case "2xs": return bold ? "absolute text-2xs font-bold" : "absolute text-2xs";
    case "xs": return bold ? "absolute text-xs font-bold" : "absolute text-xs";
    case "sm": return bold ? "absolute text-sm font-bold" : "absolute text-sm";
    case "lg": return bold ? "absolute text-lg font-bold" : "absolute text-lg";
    case "xl": return bold ? "absolute text-xl font-bold" : "absolute text-xl";
    case "2xl": return bold ? "absolute text-2xl font-bold" : "absolute text-2xl";
    default: return bold ? "absolute text-base font-bold" : "absolute text-base";
  }
}

/** One line of text anchored as LVGL aligns a label: `x` is its left edge,
 *  centre or right edge, `y` its vertical centre. A string with newlines
 *  draws one line per row. */
export function Txt(props: {
  x: number; y: number; text: string; size?: Size; color?: string; bold?: boolean;
  align?: "left" | "center" | "right"; w?: number;
}) {
  const size = () => props.size ?? "xs";
  const width = () => props.w ?? 240;
  const left = () => props.align === "center" ? props.x - width() / 2 : props.align === "right" ? props.x - width() : props.x;
  const line = (text: string, top: number) =>
    <Text class={textClass(size(), props.bold ?? false)} style={{
      insetL: left(), insetT: top, width: width(),
      textColor: props.color ?? "#ffffff", textAlign: props.align === "center" ? 1 : props.align === "right" ? 2 : 0,
    }}>{text}</Text>;
  // Most labels are one line: one Text node, no list to reconcile.
  const multiline = () => props.text.includes("\n");
  return <Show when={multiline()} fallback={line(props.text, props.y - LINE[size()] / 2)}>
    <For each={props.text.split("\n")}>{(text, index) =>
      line(text, props.y - (LINE[size()] * props.text.split("\n").length) / 2 + index() * LINE[size()])}
    </For>
  </Show>;
}

function pow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** A static image at its top-left corner, `w` x `h` on this surface. A pak
 *  image has power-of-two sides (at most 512), so each picture in art/ sits
 *  at the top left of a padded texture and a clip shows its own size. */
export function Img(props: { src: string; x: number; y: number; w: number; h: number; show?: boolean }) {
  return <Show when={props.show ?? true}>
    <View class="absolute overflow-hidden" style={{ insetL: props.x, insetT: props.y, width: props.w, height: props.h }}>
      <Image class="absolute left-0 top-0" src={props.src} style={{ width: pow2(Math.ceil(props.w)), height: pow2(Math.ceil(props.h)) }} />
    </View>
  </Show>;
}

/** The factory launcher picture, 640x360 in four tiles. */
export function Background() {
  return <>
    <Img src="art/bg_00.png" x={0} y={0} w={512} h={256} />
    <Img src="art/bg_10.png" x={512} y={0} w={128} h={256} />
    <Img src="art/bg_01.png" x={0} y={256} w={512} h={104} />
    <Img src="art/bg_11.png" x={512} y={256} w={128} h={104} />
  </>;
}

/** A transparent press area centred at (x, y): the factory demo's buttons
 *  are drawn in its background picture. Pressing darkens it. */
export function Hit(props: { x: number; y: number; w: number; h: number; radius?: number; onPress: () => void }) {
  return <View focusable onPress={props.onPress} class="absolute active:bg-[#00000040]"
    style={{ insetL: props.x - props.w / 2, insetT: props.y - props.h / 2, width: props.w, height: props.h, radius: props.radius ?? 8 }} />;
}

/** A filled button centred at (x, y) with a centred label. */
export function Btn(props: {
  x: number; y: number; w: number; h: number; label: string; onPress: () => void;
  color?: string; textColor?: string; size?: Size; radius?: number; disabled?: boolean;
}) {
  return <View focusable onPress={() => { if (!props.disabled) props.onPress(); }} class="absolute active:opacity-60"
    style={{ insetL: props.x - props.w / 2, insetT: props.y - props.h / 2, width: props.w, height: props.h,
      radius: props.radius ?? 8, bgColor: props.color ?? "#616161", opacity: props.disabled ? 0.45 : 1 }}>
    <Txt x={props.w / 2} y={props.h / 2} w={props.w} align="center" text={props.label} size={props.size ?? "xs"}
      color={props.textColor ?? "#ffffff"} />
  </View>;
}

/** A filled rectangle at its top-left corner. */
export function Box(props: { x: number; y: number; w: number; h: number; color: string; radius?: number; border?: string; children?: JSX.Element }) {
  return <View class="absolute" style={{
    insetL: props.x, insetT: props.y, width: props.w, height: props.h, bgColor: props.color,
    radius: props.radius ?? 0, borderColor: props.border, borderWidth: props.border ? 1 : 0,
  }}>{props.children}</View>;
}

export interface WindowStyle {
  title?: string;
  bg?: string;
  border?: string;
  titleColor?: string;
  /** The red dot at the top right that closes the window. */
  closeDot?: boolean;
  /** A press outside the window closes it (the factory default). */
  bgClose?: boolean;
}

/** Where a window's children go: a factory centre offset inside the window
 *  to a top-left corner on this surface, relative to the window. */
export function inside(frame: Frame, cx: number, cy: number, w = 0, h = 0): { x: number; y: number } {
  return { x: frame.w / 4 + cx / 2 - w / 4, y: frame.h / 4 + cy / 2 - h / 4 };
}

/** The factory window: a rounded panel (radius 24, 1 px border, #232323)
 *  with a centred title and an optional red close dot, grown from the
 *  button that opened it. Children are placed relative to the window. */
export function Window(props: WindowStyle & { frame: Frame; from?: Frame; onClose: () => void; children?: JSX.Element }) {
  const w = props.frame.w / 2, h = props.frame.h / 2;
  const left = X(props.frame.x) - w / 2, top = Y(props.frame.y) - h / 2;
  const grow = (node: NodeMirror) => {
    const from = props.from;
    if (!from) return;
    jump(node, "translateX", Math.round(X(from.x) - X(props.frame.x)));
    jump(node, "translateY", Math.round(Y(from.y) - Y(props.frame.y)));
    jump(node, "scale", Math.max(0.1, Math.min(from.w / props.frame.w, from.h / props.frame.h)));
    jump(node, "opacity", 0);
    animate(node, "translateX", 0, { dur: 280, easing: "out" });
    animate(node, "translateY", 0, { dur: 280, easing: "out" });
    animate(node, "scale", 1, { dur: 280, easing: "out" });
    animate(node, "opacity", 1, { dur: 200, easing: "out" });
  };
  return <>
    <View focusable class="absolute" onPress={() => { if (props.bgClose ?? true) props.onClose(); }}
      style={{ insetL: 0, insetT: 0, width: 640, height: 360 }} />
    <View ref={grow} focusable onPress={() => {}} class="absolute overflow-hidden" style={{
      insetL: left, insetT: top, width: w, height: h, radius: 12, bgColor: props.bg ?? "#232323",
      borderColor: props.border ?? "#000000", borderWidth: 1,
    }}>
      <Show when={props.title}>
        <Txt x={w / 2} y={16} w={w} align="center" text={props.title ?? ""} size="xs" color={props.titleColor ?? "#d8d8d8"} />
      </Show>
      {props.children}
      <Show when={props.closeDot}>
        <View class="absolute" style={{ insetL: w - 20, insetT: 8, width: 10, height: 10, radius: 5, bgColor: "#ff5f57" }} />
        <View focusable onPress={props.onClose} class="absolute" style={{ insetL: w - 40, insetT: 0, width: 40, height: 32 }} />
      </Show>
    </View>
  </>;
}

/** The factory toast: dark, rounded, at the top left of centre; a press
 *  dismisses it. */
export function Toast(props: { text: string | undefined; onDismiss: () => void }) {
  const drop = (node: NodeMirror) => {
    jump(node, "translateY", -60);
    animate(node, "translateY", 0, { dur: 320, easing: "out" });
  };
  return <Show when={props.text} keyed>{text =>
    <View ref={drop} focusable onPress={props.onDismiss} class="absolute"
      style={{ insetL: 22, insetT: 8, width: 320, height: 40, radius: 12, bgColor: "#383838", borderColor: "#222222", borderWidth: 1 }}>
      <Txt x={160} y={20} w={300} align="center" text={text} size="xs" color="#f4f3f3" />
    </View>}
  </Show>;
}

export function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function hex2(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}
