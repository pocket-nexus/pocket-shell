// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/notes/views.tsx — the pages of Notes, all on the touch
// screen: the list, a grouped table of every note (its first line, the
// next line that holds text and when it was last saved) under a New Note
// row, with an Edit mode that puts a Delete button on each row; and the
// editor, the note's text wrapped under the bar with a blinking caret.
// The editor comes as two pages over one document: "edit" fills the
// surface and is typed on by a keyboard (onTextEvent); "type" stacks on it
// with the on-screen keyboard docked at the bottom, for a finger, whose hide
// key goes back. Tapping the text places the caret on either.

import { createEffect, createSignal, onCleanup, onMount, type Accessor } from "solid-js";
import { createCaretBlink } from "@pocketjs/framework/animation";
import { Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { onTextEvent, type TextEvent } from "@pocketjs/framework/input";
import { createOsk, Osk, oskHeight } from "@pocketjs/framework/osk";
import { NAV_H, type NavButton } from "../ui/bar.tsx";
import { viewHeight, type LayerContext, type NavStack, type PageContent, type PageSpec } from "../ui/nav.tsx";
import { COMPACT, SCREEN_H, SCREEN_W } from "../ui/screen.ts";
import { tableContent, type Cell, type Section } from "../ui/table.tsx";
import { FONT, measure, toAscii } from "../ui/text.ts";
import type { Press } from "../ui/touch.ts";
import { caretXY } from "./doc.ts";
import type { NotesModel } from "./model.ts";

export interface NotesEnv {
  model: NotesModel;
  press: Press;
  keys: Accessor<boolean>;
  /** Confirm a destructive action in an alert. */
  confirm(title: string, message: string, action: string, run: () => void): void;
}

const UNTITLED = "New Note";

// ---- the list ---------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** When a note was saved: its time today, its day otherwise. */
export function savedText(modified: number, now: number): string {
  if (modified <= 0) return "";
  const date = new Date(modified);
  const today = new Date(now);
  if (date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate()) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes < 10 ? "0" : ""}${minutes} ${hours < 12 ? "AM" : "PM"}`;
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function listPage(env: NotesEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model } = env;
  const [editing, setEditing] = createSignal(false);
  const openNote = (id: string) => {
    model.open(id);
    stack.push("edit");
  };
  const create = () => {
    const id = model.create();
    model.open(id);
    // Without a keyboard the on-screen one is the way in.
    stack.push(COMPACT ? "type" : "edit");
  };
  const sections = (): Section[] => {
    const now = Date.now();
    const notes = model.notes();
    const rows: Cell[] = notes.map((note) => ({
      id: `note.${note.id}`,
      label: toAscii(note.title) || UNTITLED,
      detail: [savedText(note.modified, now), toAscii(note.preview)].filter((part) => part !== "").join("  "),
      accessory: editing() ? undefined : "chevron",
      button: editing()
        ? {
            id: `note.${note.id}.delete`,
            label: "Delete",
            tone: "red",
            run: () => env.confirm("Delete Note", `"${toAscii(note.title) || UNTITLED}" will be deleted from this console.`, "Delete", () => model.remove(note.id)),
          }
        : undefined,
      run: editing() ? undefined : () => openNote(note.id),
    }));
    return [
      { cells: [{ id: "notes.new", label: UNTITLED, tone: "action", run: create }] },
      rows.length
        ? { cells: rows }
        : { cells: [{ id: "notes.none", label: "No Notes", tone: "muted" }], footer: "Notes you write stay on this console's card." },
    ];
  };
  const right = (): NavButton | null =>
    model.notes().length === 0 && !editing()
      ? null
      : editing()
        ? { id: "notes.done", label: "Done", kind: "done", run: () => setEditing(false) }
        : { id: "notes.edit", label: "Edit", kind: "plain", run: () => setEditing(true) };
  return {
    title: () => "Notes",
    right,
    content: tableContent({ sections, width: SCREEN_W, press: env.press, focus: layer.focus, keys: env.keys }),
  };
}

// ---- the editor -------------------------------------------------------------------

const PAD_X = 10;
const PAD_Y = 8;
/** text-sm with leading-[18]: the row pitch of the wrapped text. */
const LINE_H = 18;
const FACE = FONT.sm;

function width(text: string): number {
  return measure(text, FACE);
}

/** The note's wrapped text and caret as a page's scrolling content, with a
 *  tap on it placing the caret. `bottom` is the surface y the content ends
 *  at (above the docked keyboard). */
function editorContent(env: NotesEnv, layer: LayerContext, bottom: number): PageContent {
  const { model } = env;
  const wrapW = SCREEN_W - PAD_X * 2;
  model.setWrap(wrapW, width);
  const viewH = bottom - NAV_H;
  const rows = () => model.segs().length;
  const height = () => Math.max(viewH, PAD_Y * 2 + rows() * LINE_H);
  const joined = () => {
    const doc = model.doc();
    return model.segs().map((seg) => doc.lines[seg.row]!.slice(seg.from, seg.to)).join("\n");
  };
  const caret = () => {
    const doc = model.doc();
    return caretXY(model.segs(), doc.lines, doc.caret, width);
  };
  const [visible, setVisible] = createSignal(false);
  const blink = createCaretBlink({ onChange: setVisible });
  onMount(() => blink.setActive(true));
  onCleanup(() => blink.dispose());
  // Every edit and move restarts the caret's visible phase and brings its
  // row into view.
  createEffect(() => {
    model.revision();
    blink.reset();
    const top = PAD_Y + caret().vrow * LINE_H;
    layer.reveal(top, top + LINE_H);
  });
  // The recognizer owns the taps that land on the text area (its node, or
  // the area's rectangle where nothing paints); the bar's stay the touch
  // router's.
  let root: NodeMirror | undefined;
  createGesture({
    surface: "auxiliary",
    region: { node: () => root, rect: () => ({ x: 0, y: NAV_H, w: SCREEN_W, h: bottom - NAV_H }) },
    // The open on-screen keyboard blocks the surface's other recognizers;
    // a tap on the text above it still places the caret.
    allowWhenBlocked: true,
    onTap(contact) {
      if (contact.y < NAV_H || contact.y >= bottom) return;
      const y = contact.y - NAV_H + layer.offset() - PAD_Y;
      const vrow = Math.max(0, Math.min(rows() - 1, Math.floor(y / LINE_H)));
      model.placeCaret(vrow, contact.x - PAD_X);
    },
  });
  return {
    view: () => (
      <View ref={(el) => (root = el)} class="absolute left-0 top-0" style={{ width: SCREEN_W, height: height() }}>
        <Text class="absolute text-sm text-[#1a1a1a] leading-[18]" style={{ insetL: PAD_X, insetT: PAD_Y, width: wrapW, height: rows() * LINE_H }}>
          {joined()}
        </Text>
        <View
          class={visible() ? "absolute w-[2] bg-[#2a6ddc]" : "hidden"}
          style={{ insetL: PAD_X + Math.round(caret().x), insetT: PAD_Y + caret().vrow * LINE_H, height: LINE_H }}
        />
      </View>
    ),
    height,
    focusOrder: () => [],
    targets: () => [],
    span: () => null,
    activate: () => undefined,
  };
}

/** The keyboard's events on the open note; true for the ones it edits
 *  with, so nothing below the editor sees them. */
function keyboardEditing(env: NotesEnv, stack: NavStack): (event: TextEvent) => boolean {
  const { model } = env;
  return (event) => {
    if (event.kind === "commit") {
      model.insert(event.text);
      return true;
    }
    if (event.kind !== "key") return false;
    switch (event.key) {
      case "Backspace":
      case "Delete":
      case "Enter":
      case "Tab":
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
      case "Home":
      case "End":
      case "Control+z":
      case "Control+y":
      case "Control+s":
      case "Escape":
        break;
      default:
        return false;
    }
    if (!event.pressed) return true;
    switch (event.key) {
      case "Backspace": model.backspace(); break;
      case "Delete": model.del(); break;
      case "Enter": model.insert("\n"); break;
      case "Tab": model.insert("    "); break;
      case "ArrowLeft": model.move("Left"); break;
      case "ArrowRight": model.move("Right"); break;
      case "ArrowUp": model.move("Up"); break;
      case "ArrowDown": model.move("Down"); break;
      case "Home": model.move("Home"); break;
      case "End": model.move("End"); break;
      case "Control+z": model.undo(); break;
      case "Control+y": model.redo(); break;
      case "Control+s": model.save(); break;
      case "Escape": stack.pop(); break;
    }
    return true;
  };
}

const editorTitle = (model: NotesModel) => () => toAscii(model.title()) || UNTITLED;

/** The note filling the surface: a keyboard types into it; Type docks the
 *  on-screen one. */
export function editPage(env: NotesEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model } = env;
  const release = onTextEvent(keyboardEditing(env, stack));
  onCleanup(() => {
    release();
    model.save();
  });
  return {
    title: editorTitle(model),
    backLabel: "Note",
    bare: "white",
    right: () => ({ id: "note.type", label: "Type", kind: "plain", run: () => stack.push("type") }),
    content: editorContent(env, layer, NAV_H + viewHeight()),
  };
}

/** The note over the on-screen keyboard: its keys edit the caret's line,
 *  its return key breaks the line, its hide key goes back (the open panel
 *  takes the surface, so the bar's buttons wait for it). A keyboard still
 *  types ahead of the session. */
export function typePage(env: NotesEnv, stack: NavStack, layer: LayerContext): PageSpec {
  const { model } = env;
  const keyboardTop = SCREEN_H - oskHeight("auxiliary", "light");
  const line = () => {
    const doc = model.doc();
    return doc.lines[doc.caret.row] ?? "";
  };
  const osk = createOsk({
    value: line,
    setValue(next) {
      const old = line();
      let prefix = 0;
      while (prefix < old.length && prefix < next.length && old[prefix] === next[prefix]) prefix++;
      let suffix = 0;
      while (suffix < old.length - prefix && suffix < next.length - prefix && old[old.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix++;
      model.replaceInLine(prefix, old.length - prefix - suffix, next.slice(prefix, next.length - suffix));
    },
    onCommit: () => model.insert("\n"),
    onClose: () => stack.pop(),
    closeOnCommit: false,
  });
  let release = () => {};
  onMount(() => {
    osk.open();
    // The session subscribed to the keyboard as it opened; the editor's
    // handler goes in after it, so the keyboard reaches the editor first.
    release = onTextEvent(keyboardEditing(env, stack));
  });
  // The session's caret follows the document's along its line.
  createEffect(() => {
    model.revision();
    if (!osk.isOpen()) return;
    const delta = model.doc().caret.col - osk.caret();
    if (delta !== 0) osk.moveCaret(delta);
  });
  onCleanup(() => {
    release();
    osk.close();
    model.save();
  });
  return {
    title: editorTitle(model),
    bare: "white",
    inset: SCREEN_H - keyboardTop,
    content: editorContent(env, layer, keyboardTop),
    fixed: () => (
      <View class="absolute left-0" style={{ insetT: keyboardTop, width: SCREEN_W, height: SCREEN_H - keyboardTop }}>
        <Osk osk={osk} surface="auxiliary" theme="light" />
      </View>
    ),
  };
}
