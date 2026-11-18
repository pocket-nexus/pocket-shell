// SPDX-License-Identifier: GPL-3.0-or-later
// ui/setup-state.ts — a companion service's owner setup, as `/_setup`
// answers it for every service (Pocket Hub's tools/companion/setup.ts): the
// values the owner types once (fields), the vendor's own programs the
// service fetches on the owner's consent (tools), and something the owner
// does elsewhere (the prompt). These are the shapes and the words of the
// setup page (ui/setup.tsx), apart from any view. The wire types copy
// PocketJS's contracts/spec/owner-setup.ts (pocketjs #673); they become an
// `import type` from vendor/pocketjs once this repository's pin moves past
// pocketjs #672, which moved tools/companion/glyphs.ts (test/net.test.ts
// imports it) to Pocket Hub.

export interface SetupFieldState {
  id: string;
  label: string;
  /** a key or a token: the service never answers it, the page draws dots */
  secret: boolean;
  help?: string;
  /** where the owner gets the value */
  link?: { label: string; url: string };
  maxLength?: number;
  optional?: boolean;
  set: boolean;
  /** a field that is not secret, as it is set */
  value?: string;
}

export type ToolState = "unavailable" | "absent" | "fetching" | "ready" | "failed";

export interface SetupToolState {
  id: string;
  title: string;
  vendor: string;
  /** the vendor's terms the owner accepts by fetching it */
  terms: string;
  note?: string;
  state: ToolState;
  consented: boolean;
  received: number;
  total: number;
  fetchedAt: number | null;
  message: string;
}

export interface SetupPrompt {
  /** code: confirm `code` at a vendor's page (`url`); pick: pick this device
   *  in a vendor's app; wait: something is on its way */
  kind: "code" | "pick" | "wait";
  title: string;
  detail?: string;
  code?: string;
  url?: string;
  expiresAt?: number;
}

export interface SetupState {
  service: string;
  title: string;
  fields: SetupFieldState[];
  tools: SetupToolState[];
  prompt: SetupPrompt | null;
  /** every field that is not optional is set, and every tool is ready */
  ready: boolean;
}

/** A change the page asks for (POST /_setup). */
export type SetupChange =
  | { field: string; value: string }
  | { field: string; clear: true }
  | { tool: string; consent: true }
  | { tool: string; update: true }
  | { tool: string; remove: true };

const TOOL_STATES: readonly ToolState[] = ["unavailable", "absent", "fetching", "ready", "failed"];
const PROMPTS: readonly SetupPrompt["kind"][] = ["code", "pick", "wait"];
const text = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

/** An answer of `/_setup` with every field in shape, or null when it is not one. */
export function readSetup(value: unknown): SetupState | null {
  const raw = value as Partial<SetupState> | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.fields) || !Array.isArray(raw.tools)) return null;
  const fields = raw.fields
    .filter((field) => field && typeof field.id === "string")
    .map((field): SetupFieldState => ({
      id: field.id,
      label: text(field.label) || field.id,
      secret: field.secret === true,
      ...(field.help ? { help: text(field.help) } : {}),
      ...(field.link && typeof field.link.url === "string" ? { link: { label: text(field.link.label) || field.link.url, url: field.link.url } } : {}),
      ...(typeof field.maxLength === "number" ? { maxLength: field.maxLength } : {}),
      ...(field.optional === true ? { optional: true } : {}),
      set: field.set === true,
      ...(field.secret !== true && typeof field.value === "string" ? { value: field.value } : {}),
    }));
  const tools = raw.tools
    .filter((tool) => tool && typeof tool.id === "string")
    .map((tool): SetupToolState => ({
      id: tool.id,
      title: text(tool.title) || tool.id,
      vendor: text(tool.vendor),
      terms: text(tool.terms),
      ...(tool.note ? { note: text(tool.note) } : {}),
      state: TOOL_STATES.includes(tool.state) ? tool.state : "absent",
      consented: tool.consented === true,
      received: count(tool.received),
      total: count(tool.total),
      fetchedAt: typeof tool.fetchedAt === "number" ? tool.fetchedAt : null,
      message: text(tool.message),
    }));
  const prompt = raw.prompt && PROMPTS.includes(raw.prompt.kind) && typeof raw.prompt.title === "string" ? raw.prompt : null;
  return { service: text(raw.service), title: text(raw.title), fields, tools, prompt, ready: raw.ready === true };
}

/** Bytes as the page says them: "860 KB", "12.3 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A fetch's progress: "12.3 of 40.0 MB", or what came in while the size is not known. */
export function progressText(received: number, total: number): string {
  if (total > 0) return `${(received / 1_000_000).toFixed(1)} of ${sizeText(total)}`;
  return received > 0 ? sizeText(received) : "Starting";
}

/** A fetch's progress from 0 to 1; 0 while the size is not known. */
export const progressFraction = (received: number, total: number) => (total > 0 ? Math.max(0, Math.min(1, received / total)) : 0);

/** The button that fetches a tool says that it accepts the vendor's terms. */
export const consentLabel = (tool: Pick<SetupToolState, "vendor">) => `Accept ${tool.vendor || "the vendor"}'s terms and download`;

/** What a tool's row offers: its button and the change it sends, or null
 *  when there is nothing to press (fetching, ready, no build). */
export function toolAction(tool: SetupToolState): { label: string; change: SetupChange } | null {
  if (tool.state === "absent") return { label: consentLabel(tool), change: { tool: tool.id, consent: true } };
  if (tool.state === "failed") return { label: "Retry", change: tool.consented ? { tool: tool.id, update: true } : { tool: tool.id, consent: true } };
  return null;
}

/** The line a tool's row says about where it is. */
export function toolStatus(tool: SetupToolState): string {
  switch (tool.state) {
    case "unavailable":
      return tool.message || `${tool.vendor || "The vendor"} publishes no build for this device.`;
    case "fetching":
      return `Downloading from ${tool.vendor || "the vendor"}: ${progressText(tool.received, tool.total)}`;
    case "ready":
      return "Ready";
    case "failed":
      return tool.message || "The download failed.";
    default:
      return tool.consented ? "Not downloaded yet" : "Not downloaded";
  }
}

/** What a field's entry shows: the text being typed (dots for a secret, the
 *  caret kept), the value once set (dots for a secret), or "". */
export function entryText(field: SetupFieldState, draft: string | null, caret = "|"): string {
  if (draft !== null) {
    if (!field.secret) return draft;
    return [...draft].map((ch) => (ch === caret ? caret : "•")).join("");
  }
  if (!field.set) return "";
  return field.secret ? "••••••••••••" : field.value ?? "";
}

/** The terms URL without its scheme, as a page shows it. */
export const shownUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");

/** How many steps are left: the fields that are not optional and not set, and the tools not ready. */
export function stepsLeft(state: SetupState): number {
  return state.fields.filter((field) => !field.optional && !field.set).length + state.tools.filter((tool) => tool.state !== "ready").length;
}
