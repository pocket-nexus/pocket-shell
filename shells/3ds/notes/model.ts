// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/notes/model.ts — the notes and the one being edited: the list
// from the store's index, the open note as a Doc (doc.ts) with its undo
// history and wrapped layout, and the saves: one second after the last
// edit, on demand (Control+s), and when the editor closes.

import { createMemo, createSignal, type Accessor } from "solid-js";
import { after } from "@pocketjs/framework/clock";
import {
  applyMoveWrapped,
  backspace,
  caretAtPoint,
  del,
  emptyHistory,
  insertText,
  record,
  redoStep,
  undoStep,
  wrapDoc,
  type CaretMove,
  type Doc,
  type EditKind,
  type History,
  type VSeg,
} from "./doc.ts";
import { newId, readIndex, readNote, removeNote, summarize, writeIndex, writeNote, type NoteMeta } from "./store.ts";

/** Seconds from the last edit to its save. */
const AUTOSAVE_S = 1;

export interface NotesModel {
  /** Every note, the one modified last first. */
  notes: Accessor<readonly NoteMeta[]>;
  /** The open note's id, "" when none. */
  openId: Accessor<string>;
  doc: Accessor<Doc>;
  /** The open note's visual rows under the wrap width the editor set. */
  segs: Accessor<VSeg[]>;
  /** Bumps on every edit and caret move: the caret blink restarts on it. */
  revision: Accessor<number>;
  title: Accessor<string>;
  /** The editor tells the model its wrap width and text measure. */
  setWrap(maxW: number, width: (s: string) => number): void;
  create(): string;
  open(id: string): void;
  /** Save and leave the open note. */
  close(): void;
  remove(id: string): void;
  insert(text: string): void;
  /** On the caret's line, replace `removed` characters from `col` with
   *  `inserted` and leave the caret after them: what the on-screen
   *  keyboard's edit of that line amounts to. */
  replaceInLine(col: number, removed: number, inserted: string): void;
  backspace(): void;
  del(): void;
  move(key: CaretMove): void;
  placeCaret(vrow: number, x: number): void;
  undo(): void;
  redo(): void;
  save(): void;
  dirty: Accessor<boolean>;
}

function docOf(text: string): Doc {
  const lines = text.split("\n");
  const last = lines.length - 1;
  return { lines, caret: { row: last, col: lines[last]!.length } };
}

export function createNotesModel(): NotesModel {
  const [notes, setNotes] = createSignal<readonly NoteMeta[]>(sorted(readIndex()));
  const [openId, setOpenId] = createSignal("");
  const [doc, setDoc] = createSignal<Doc>(docOf(""));
  const [revision, setRevision] = createSignal(0);
  const [dirty, setDirty] = createSignal(false);
  const [wrap, setWrapState] = createSignal<{ maxW: number; width: (s: string) => number }>({ maxW: Infinity, width: (s) => s.length });
  let history: History = emptyHistory();
  let cancelAutosave: (() => void) | null = null;

  const segs = createMemo(() => {
    const { maxW, width } = wrap();
    return wrapDoc(doc().lines, maxW, width);
  });
  const title = () => summarize(doc().lines.join("\n")).title;

  function sorted(list: readonly NoteMeta[]): NoteMeta[] {
    return [...list].sort((a, b) => b.modified - a.modified);
  }

  const touch = () => setRevision((n) => n + 1);

  const save = () => {
    cancelAutosave?.();
    cancelAutosave = null;
    const id = openId();
    if (!id || !dirty()) return;
    const text = doc().lines.join("\n");
    writeNote(id, text);
    const meta: NoteMeta = { id, modified: Date.now(), ...summarize(text) };
    const rest = notes().filter((note) => note.id !== id);
    const next = sorted([meta, ...rest]);
    writeIndex(next);
    setNotes(next);
    setDirty(false);
  };

  const edited = (next: Doc, kind: EditKind) => {
    const prev = doc();
    history = record(history, prev, next, kind);
    setDoc(next);
    setDirty(true);
    touch();
    cancelAutosave?.();
    cancelAutosave = after(AUTOSAVE_S, save);
  };

  const moved = (next: Doc) => {
    setDoc(next);
    touch();
  };

  return {
    notes,
    openId,
    doc,
    segs,
    revision,
    title,
    dirty,
    setWrap(maxW, width) {
      setWrapState({ maxW, width });
    },
    create() {
      const id = newId(Date.now());
      writeNote(id, "");
      const meta: NoteMeta = { id, modified: Date.now(), title: "", preview: "" };
      const next = sorted([meta, ...notes()]);
      writeIndex(next);
      setNotes(next);
      return id;
    },
    open(id) {
      save();
      history = emptyHistory();
      setOpenId(id);
      setDoc(docOf(readNote(id)));
      setDirty(false);
      touch();
    },
    close() {
      save();
      setOpenId("");
      history = emptyHistory();
    },
    remove(id) {
      if (openId() === id) {
        cancelAutosave?.();
        cancelAutosave = null;
        setOpenId("");
        setDirty(false);
      }
      removeNote(id);
      const next = notes().filter((note) => note.id !== id);
      writeIndex(next);
      setNotes(next);
    },
    insert(text) {
      edited(insertText(doc(), text), text.includes("\n") ? "other" : "type");
    },
    replaceInLine(col, removed, inserted) {
      if (removed === 0 && inserted === "") return;
      const current = doc();
      const row = current.caret.row;
      const line = current.lines[row] ?? "";
      const at = Math.max(0, Math.min(col, line.length));
      const lines = current.lines.slice();
      lines[row] = line.slice(0, at) + inserted + line.slice(at + removed);
      edited({ lines, caret: { row, col: at + inserted.length } }, inserted !== "" ? "type" : "erase");
    },
    backspace() {
      edited(backspace(doc()), "erase");
    },
    del() {
      edited(del(doc()), "erase");
    },
    move(key) {
      const { width } = wrap();
      moved(applyMoveWrapped(doc(), key, false, segs(), width));
    },
    placeCaret(vrow, x) {
      const { width } = wrap();
      const current = doc();
      moved({ lines: current.lines, caret: caretAtPoint(segs(), current.lines, vrow, x, width) });
    },
    undo() {
      const step = undoStep(history, doc());
      if (!step) return;
      history = step.h;
      setDoc(step.doc);
      setDirty(true);
      touch();
      cancelAutosave?.();
      cancelAutosave = after(AUTOSAVE_S, save);
    },
    redo() {
      const step = redoStep(history, doc());
      if (!step) return;
      history = step.h;
      setDoc(step.doc);
      setDirty(true);
      touch();
      cancelAutosave?.();
      cancelAutosave = after(AUTOSAVE_S, save);
    },
    save,
  };
}
