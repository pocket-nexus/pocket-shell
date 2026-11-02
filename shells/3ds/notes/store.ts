// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/notes/store.ts — the notes on the console's storage, through
// the fs module (capability data.fs; on the Tab5 the applet's data
// directory on the microSD card, on the 3DS its slot on the SD card).
//
//   notes/index.json   {"version":1,"notes":[{"id","modified","title","preview"}]}
//   notes/<id>.txt     the note's text; its first line is its title
//
// A note's text is the truth; the index keeps what the list shows without
// reading every file (stat carries no mtime, so the index holds the
// modified time). A missing or torn index is rebuilt from the files.

import { existsSync, file, mkdirSync, readdirSync, rmSync, write } from "@pocketjs/framework/fs";

export interface NoteMeta {
  id: string;
  /** Unix ms of the last save. */
  modified: number;
  title: string;
  preview: string;
}

const DIR = "notes";
const INDEX = `${DIR}/index.json`;
const VERSION = 1;

interface Index {
  version: number;
  notes: NoteMeta[];
}

export function notePath(id: string): string {
  return `${DIR}/${id}.txt`;
}

/** What the list shows of a text: its first line, and the next line that
 *  holds something. */
export function summarize(text: string): { title: string; preview: string } {
  const lines = text.split("\n");
  const title = (lines[0] ?? "").trim();
  const preview = lines.slice(1).find((line) => line.trim() !== "")?.trim() ?? "";
  return { title, preview };
}

function fileId(name: string): string | null {
  return name.endsWith(".txt") && name.length > 4 ? name.slice(0, -4) : null;
}

/** The index as stored, or rebuilt from the note files when it is missing
 *  or unreadable. */
export function readIndex(): NoteMeta[] {
  mkdirSync(DIR);
  if (existsSync(INDEX)) {
    try {
      const parsed = file(INDEX).json() as Partial<Index>;
      if (parsed.version === VERSION && Array.isArray(parsed.notes)) {
        return parsed.notes.filter((note) => typeof note.id === "string" && existsSync(notePath(note.id)));
      }
    } catch {
      // A torn or foreign index: the files below say what exists.
    }
  }
  const notes: NoteMeta[] = [];
  for (const name of readdirSync(DIR)) {
    const id = fileId(name);
    if (!id) continue;
    const text = readNote(id);
    notes.push({ id, modified: 0, ...summarize(text) });
  }
  writeIndex(notes);
  return notes;
}

export function writeIndex(notes: readonly NoteMeta[]): void {
  const index: Index = { version: VERSION, notes: [...notes] };
  write(INDEX, JSON.stringify(index));
}

export function readNote(id: string): string {
  const path = notePath(id);
  return existsSync(path) ? file(path).text() : "";
}

export function writeNote(id: string, text: string): void {
  write(notePath(id), text);
}

export function removeNote(id: string): void {
  rmSync(notePath(id), { force: true });
}

let created = 0;

/** A new id: the time in base 36 and a counter, so two notes made in one
 *  millisecond differ. */
export function newId(now: number): string {
  return `${now.toString(36)}-${(created++).toString(36)}`;
}
