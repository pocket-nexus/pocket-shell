// SPDX-License-Identifier: GPL-3.0-only
// src/system-ui/words.ts — the System UI's words in English and Japanese.
//
// The host names the language on the svc "lang" line (svc.ts), with the
// titles of its installed apps in that language when it has them; the
// shell draws every label it owns from the active catalog through `lw()`, so
// the Start menu, the desktop icons, the menus and the dialogs follow a
// switch. Without a lang line the shell is English. File names (README.TXT,
// Program Files) and shortcut names (Cmd+W) are the same in every language.
//
// Japanese follows the names Japanese desktop systems of the period used
// (マイ コンピュータ, ごみ箱, 右端で折り返す), in です・ます where a sentence
// is a sentence.

import { createSignal } from "solid-js";

export type Lang = "en" | "ja";

const EN = {
  start: "Start",
  myComputer: "My Computer",
  myDocuments: "My Documents",
  recycleBin: "Recycle Bin",
  notepad: "Notepad",
  minesweeper: "Minesweeper",
  /** The program name Aqua's screen bar shows for a folder window. */
  files: "Files",
  untitled: "Untitled",
  /** A Notepad window's title: the document's name, then the program's. */
  notepadTitle: (name: string) => `${name} - Notepad`,
  about: (name: string) => `About ${name}`,
  programs: "Programs",
  allPrograms: "All Programs",
  documents: "Documents",
  settings: "Settings",
  find: "Find",
  help: "Help",
  run: "Run...",
  shutDownMenu: "Shut Down...",
  turnOff: "Turn Off Computer",
  // menus
  file: "File",
  edit: "Edit",
  game: "Game",
  new: "New",
  exit: "Exit",
  undo: "Undo",
  redo: "Redo",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select All",
  timeDate: "Time/Date",
  wordWrap: "Word Wrap",
  minimize: "Minimize",
  maximize: "Maximize",
  restore: "Restore",
  close: "Close",
  arrangeIcons: "Arrange Icons",
  refresh: "Refresh",
  newTextDocument: "New Text Document",
  properties: "Properties",
  // folders
  search: "Search",
  address: "Address",
  folders: "Folders",
  otherPlaces: "Other Places",
  name: "Name",
  size: "Size",
  type: "Type",
  empty: "(empty)",
  controlPanel: "Control Panel",
  printers: "Printers",
  localDisk: "Local Disk",
  cdromDisc: "CD-ROM Disc",
  systemFolder: "System Folder",
  fileFolder: "File Folder",
  batchFile: "Batch File",
  systemFile: "System file",
  textDocument: "Text Document",
  // dialogs
  shutDown: "Shut Down",
  shutDownAsk: "What do you want the computer to do?",
  shutDownChoice: "Shut down",
  restart: "Restart",
  ok: "OK",
  cancel: "Cancel",
  // Pocket apps and Notepad's layout
  starting: (title: string) => `Starting ${title}...`,
  controlsHint: "Arrow keys + Z/X/A/S + Q/W",
  layoutUnavailable: "Text layout unavailable",
  layoutCompanion: "Pair a companion to enable text layout.",
} as const;

type Catalog = {
  [K in keyof typeof EN]: (typeof EN)[K] extends (...args: infer A) => string ? (...args: A) => string : string;
};

/** `text` and the half-width space Japanese puts after a Latin word or a number. */
const spaced = (text: string) => (/[A-Za-z0-9.)]$/.test(text) ? `${text} ` : text);

const JA: Catalog = {
  start: "スタート",
  myComputer: "マイ コンピュータ",
  myDocuments: "マイ ドキュメント",
  recycleBin: "ごみ箱",
  notepad: "メモ帳",
  minesweeper: "マインスイーパ",
  files: "ファイル",
  untitled: "無題",
  notepadTitle: (name) => `${name} - メモ帳`,
  about: (name) => `${spaced(name)}について`,
  programs: "プログラム",
  allPrograms: "すべてのプログラム",
  documents: "書類",
  settings: "設定",
  find: "検索",
  help: "ヘルプ",
  run: "実行...",
  shutDownMenu: "シャットダウン...",
  turnOff: "電源を切る",
  file: "ファイル",
  edit: "編集",
  game: "ゲーム",
  new: "新規",
  exit: "終了",
  undo: "元に戻す",
  redo: "やり直し",
  cut: "切り取り",
  copy: "コピー",
  paste: "貼り付け",
  selectAll: "すべて選択",
  timeDate: "日付と時刻",
  wordWrap: "右端で折り返す",
  minimize: "最小化",
  maximize: "最大化",
  restore: "元のサイズに戻す",
  close: "閉じる",
  arrangeIcons: "アイコンの整列",
  refresh: "最新の情報に更新",
  newTextDocument: "新規テキスト ドキュメント",
  properties: "プロパティ",
  search: "検索",
  address: "アドレス",
  folders: "フォルダ",
  otherPlaces: "その他",
  name: "名前",
  size: "サイズ",
  type: "種類",
  empty: "(空)",
  controlPanel: "コントロール パネル",
  printers: "プリンタ",
  localDisk: "ローカル ディスク",
  cdromDisc: "CD-ROM ディスク",
  systemFolder: "システム フォルダ",
  fileFolder: "ファイル フォルダ",
  batchFile: "バッチ ファイル",
  systemFile: "システム ファイル",
  textDocument: "テキスト ドキュメント",
  shutDown: "シャットダウン",
  shutDownAsk: "コンピュータをどうしますか?",
  shutDownChoice: "シャットダウン",
  restart: "再起動",
  ok: "OK",
  cancel: "キャンセル",
  starting: (title) => `${spaced(title)}を起動しています...`,
  controlsHint: "方向キー + Z/X/A/S + Q/W",
  layoutUnavailable: "テキストのレイアウトを使えません",
  layoutCompanion: "テキストのレイアウトには、コンパニオンとの接続が必要です。",
};

const CATALOGS: Record<Lang, Catalog> = { en: EN as unknown as Catalog, ja: JA };

const [active, setActive] = createSignal<Lang>("en");
const [titles, setTitles] = createSignal<Readonly<Record<string, string>>>({});

/** The active language. */
export const lang = active;

/** The active catalog. Read it where a label is computed, so a switch redraws it. */
export const lw = (): Catalog => CATALOGS[active()];

/** The catalog of a language, for code that is not reactive (tests, one-off titles). */
export const wordsIn = (language: Lang): Catalog => CATALOGS[language];

/** A value a lang line names, or null when this shell has no catalog for it. */
export function langOf(value: unknown): Lang | null {
  return value === "en" || value === "ja" ? value : null;
}

/**
 * Follow a lang line: its language and its apps' titles by package id. A line
 * naming a language the shell has no catalog for changes nothing. Returns
 * true when anything changed.
 */
export function applyLang(id: unknown, appTitles?: unknown): boolean {
  const next = langOf(id);
  if (!next) return false;
  const named: Record<string, string> = {};
  if (appTitles && typeof appTitles === "object") {
    for (const [pkg, title] of Object.entries(appTitles as Record<string, unknown>)) {
      if (typeof title === "string" && title !== "") named[pkg] = title;
    }
  }
  const same = next === active() && JSON.stringify(named) === JSON.stringify(titles());
  if (same) return false;
  setActive(next);
  setTitles(named);
  return true;
}

/** Labels the themes carry as data (theme.ts), by their English text. */
const THEME_WORDS: Record<string, keyof Catalog> = {
  Address: "address",
  Folders: "folders",
  "Other Places": "otherPlaces",
};

/** A label a theme carries, in the active language; text this catalog does not know stays as it is. */
export function themeWord(text: string): string {
  const key = THEME_WORDS[text];
  return key ? (lw()[key] as string) : text;
}

/** An installed app's title in the active language: the host's, else the manifest's. */
export function appTitle(app: { package: string; title: string }): string {
  return titles()[app.package] ?? app.title;
}
