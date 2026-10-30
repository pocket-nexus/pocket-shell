// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/home/system.ts — Home's view of the console: installed apps (the
// launcher's app table), the Pocket Link, the Wi-Fi radio, the linked Mac's
// catalog, installs in flight (from the Mac or from a scanned install code),
// and the clock.
//
// Host state is polled, never pushed: link and Wi-Fi status are re-read every
// POLL_FRAMES frames and on every link event, and each signal only changes
// when the JSON it was read from changed, so an idle console re-renders
// nothing.

import { createSignal, type Accessor } from "solid-js";
import { getOps } from "@pocketjs/framework/host";
import { launchApp } from "@pocketjs/framework/launcher";
import { onFrame } from "@pocketjs/framework/lifecycle";
import {
  forgetCompanion,
  installApp,
  LINK_PAIRING,
  LINK_STATE,
  linkHost,
  linkStatus,
  onLinkEvent,
  pairCompanion,
  removeApp,
  requestCatalog,
  type LinkCatalogApp,
  type LinkStatus,
} from "@pocketjs/framework/link";
import {
  connectSavedNetwork,
  forgetNetwork,
  joinNetwork,
  scanNetworks,
  setWifiEnabled,
  wifiCanJoin,
  wifiHost,
  wifiStatus,
  type WifiStatus,
} from "@pocketjs/framework/wifi";
import { DEFAULT_OFFSET } from "./clock.ts";
import { toAscii } from "../ui/text.ts";

const POLL_FRAMES = 30;
/** While something is changing (a connection, a pairing), poll faster. */
const BUSY_POLL_FRAMES = 6;

export interface HomeApp {
  output: string;
  id: string;
  title: string;
  version: string;
  bytes: number;
}

export interface HomeTable {
  apps: HomeApp[];
  current: string;
  resume: string | null;
  launcher: string;
  lastError: { output: string; message: string } | null;
}

export interface Install {
  received: number;
  /** 0 while the size is unknown (a code's server has not sent a length). */
  bytes: number;
  error: string;
  done: boolean;
  /** The installed app's output name, once done. */
  output?: string;
}

// ---- installs from a code ------------------------------------------------------
//
// A web page that offers one package shows an install URI as a QR code. On a
// console that downloads apps by itself (the M5Stack Tab5), the firmware
// binds `globalThis.installer` into the launcher only: installUri(uri) starts
// a download and returns a request id (-1 when the URI does not parse, there
// is no Wi-Fi client, or a download is already running), and poll() returns
// the install.progress, install.done and error events since the last call.
// Home polls it every frame while an install runs. The URI format and the
// parser below follow pocket-m5's
// programs/m5stack-tab5/components/pocket_system/README.md, "Installs from a
// code".

export const INSTALL_SCHEME = "pocketlink://install";
const INSTALL_URI_MAX = 400;
const INSTALL_URL_MAX = 200;
const INSTALL_APP_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/;
const INSTALL_SHA_RE = /^[0-9a-f]{64}$/;
const INSTALL_URL_RE = /^https?:\/\/[^\s#]+$/;

export interface InstallCode {
  app: string;
  /** SHA-256 of the package file, 64 lowercase hex digits. */
  sha256: string;
  /** Title to show before the package is read; may be empty. */
  title: string;
  url: string;
}

/** UTF-8 length without TextEncoder, which a guest realm may lack. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0)!;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

/** Whether a scanned code is an install URI (it may still be malformed). */
export function isInstallCode(text: string): boolean {
  return text.startsWith(`${INSTALL_SCHEME}?`);
}

/** Read an install URI: pocketlink://install?v=1&a=<app>&s=<sha256>[&n=<title>]&u=<url>,
 *  `u` last and verbatim. Null when it is not one. */
export function parseInstallCode(text: string): InstallCode | null {
  if (typeof text !== "string") return null;
  const uri = text.replace(/[\r\n ]+$/, "");
  const prefix = `${INSTALL_SCHEME}?`;
  if (utf8Bytes(uri) > INSTALL_URI_MAX || !uri.startsWith(prefix)) return null;
  const at = uri.indexOf("&u=");
  if (at < 0) return null;
  const url = uri.slice(at + 3);
  if (!INSTALL_URL_RE.test(url) || utf8Bytes(url) > INSTALL_URL_MAX) return null;
  let version = "", app = "", sha256 = "", title = "";
  for (const part of uri.slice(prefix.length, at).split("&")) {
    const eq = part.indexOf("=");
    if (eq !== 1) continue;
    const value = part.slice(2);
    if (part[0] === "v") version = value;
    else if (part[0] === "a") app = value;
    else if (part[0] === "s") sha256 = value;
    else if (part[0] === "n") {
      try {
        title = decodeURIComponent(value.replace(/\+/g, " "));
      } catch {
        title = ""; // the title is only shown; a malformed one is dropped
      }
    }
  }
  if (version !== "1" || !INSTALL_APP_RE.test(app) || !INSTALL_SHA_RE.test(sha256)) return null;
  return { app, sha256, title, url };
}

/** The server an install code downloads from: the address's host (and port). */
export function codeHost(url: string): string {
  const rest = url.slice(url.indexOf("://") + 3);
  const authority = rest.split(/[/?]/)[0] ?? "";
  return toAscii(authority.slice(authority.lastIndexOf("@") + 1));
}

/** The launcher's installer namespace (pocket-m5, Tab5 launcher only). */
interface InstallerOps {
  installUri(uri: string): number;
  poll(): string | undefined;
}

type InstallerEvent =
  | { t: "install.progress"; id: number; app: string; received: number; bytes: number }
  | { t: "install.done"; id: number; app: string; output: string }
  | { t: "error"; id: number; message: string };

/** globalThis.installer, when this console downloads apps by itself. */
function installerHost(): InstallerOps | null {
  const ns = (globalThis as { installer?: Partial<InstallerOps> }).installer;
  if (!ns || typeof ns !== "object") return null;
  return typeof ns.installUri === "function" && typeof ns.poll === "function" ? (ns as InstallerOps) : null;
}

interface PendingInstall {
  progress(received: number, bytes: number): void;
  done(output: string): void;
  fail(message: string): void;
}

/** Installs started through the installer, by request id. */
const pendingInstalls = new Map<number, PendingInstall>();

/** Read the installer's events and hand them to their installs. Called every
 *  frame; reads nothing while no install runs. */
function pumpInstaller(): void {
  if (pendingInstalls.size === 0) return;
  const raw = installerHost()?.poll();
  if (!raw) return;
  let events: InstallerEvent[];
  try {
    events = JSON.parse(raw) as InstallerEvent[];
  } catch {
    return;
  }
  if (!Array.isArray(events)) return;
  for (const event of events) {
    const pending = pendingInstalls.get(event?.id);
    if (!pending) continue;
    if (event.t === "install.progress") pending.progress(event.received ?? 0, event.bytes ?? 0);
    else if (event.t === "install.done") {
      pendingInstalls.delete(event.id);
      pending.done(event.output);
    } else if (event.t === "error") {
      pendingInstalls.delete(event.id);
      pending.fail(event.message);
    }
  }
}

/** Download and install the package an install URI names. Resolves with the
 *  app's output name. */
function installFromCode(uri: string, onProgress: (received: number, bytes: number) => void): Promise<string> {
  const installer = installerHost();
  if (!installer) return Promise.reject(new Error("This console cannot download apps"));
  if (!parseInstallCode(uri)) return Promise.reject(new Error("That is not an install code"));
  const id = installer.installUri(uri);
  if (id < 0) return Promise.reject(new Error("The download could not start"));
  return new Promise((resolve, reject) => {
    pendingInstalls.set(id, {
      progress: onProgress,
      done: resolve,
      fail: (message) => reject(new Error(message)),
    });
  });
}

/** A scanned install code waiting for Install, or installing. */
export interface CodeOffer extends InstallCode {
  uri: string;
  /** The server's host name, for the confirmation page. */
  host: string;
}

/** "120 KB of 1.2 MB", or "120 KB" while the size is unknown. */
export function progressText(install: Install): string {
  return install.bytes > 0 ? `${sizeText(install.received)} of ${sizeText(install.bytes)}` : sizeText(install.received);
}

export type CatalogState = "idle" | "loading" | "ready" | "error";

const sameJson = <T,>(a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);

/** The 3DS app table as the host writes it, every field kept (the framework's
 *  appTable() keeps only apps/current/resume). Runtime strings fold to ASCII. */
export function readAppTable(): HomeTable {
  const empty: HomeTable = { apps: [], current: "", resume: null, launcher: "", lastError: null };
  const raw = getOps().appTable?.();
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<HomeTable> & { apps?: Partial<HomeApp>[] };
    return {
      apps: (parsed.apps ?? [])
        .filter((app) => typeof app.output === "string" && app.output !== parsed.launcher)
        .map((app) => ({
          output: app.output!,
          id: app.id ?? app.output!,
          title: toAscii(app.title ?? app.output!),
          version: toAscii(app.version ?? ""),
          bytes: app.bytes ?? 0,
        })),
      current: parsed.current ?? "",
      resume: parsed.resume ?? null,
      launcher: parsed.launcher ?? "",
      lastError: parsed.lastError ? { output: parsed.lastError.output, message: toAscii(parsed.lastError.message) } : null,
    };
  } catch {
    return empty;
  }
}

function readLink(): LinkStatus {
  const status = linkStatus();
  return {
    ...status,
    companion: status.companion ? { ...status.companion, name: toAscii(status.companion.name) } : null,
    paired: status.paired.map((entry) => ({ ...entry, name: toAscii(entry.name) })),
    device: { ...status.device, name: toAscii(status.device.name), model: toAscii(status.device.model) },
    error: toAscii(status.error),
    // The clock moves on every read; Home keeps it apart as a skew (below) so
    // an unchanged link stays equal and nothing redraws for it.
    clock: null,
  };
}

/** The Mac's clock as a whole-second skew from Date.now(), and its offset. */
function readClock(): { skew: number; offset: number } | null {
  const clock = linkStatus().clock;
  if (!clock) return null;
  return { skew: Math.round((clock.utc - Date.now()) / 1000) * 1000, offset: clock.offsetMinutes };
}

function readWifi(): WifiStatus | null {
  const status = wifiStatus();
  if (!status) return null;
  return {
    ...status,
    ssid: toAscii(status.ssid),
    saved: status.saved.map((entry) => ({ ...entry, ssid: toAscii(entry.ssid) })),
    error: toAscii(status.error),
    ...(status.networks ? { networks: status.networks.map((network) => ({ ...network, ssid: toAscii(network.ssid) })) } : {}),
  };
}

export interface HomeSystem {
  now: Accessor<number>;
  offset: Accessor<number>;
  /** True while the time comes from the paired Mac's clock. */
  macClock: Accessor<boolean>;
  setOffset(minutes: number): void;
  table: Accessor<HomeTable>;
  link: Accessor<LinkStatus>;
  hasLink: boolean;
  wifi: Accessor<WifiStatus | null>;
  hasWifi: boolean;
  /** The host lets Home scan for, join and forget networks (a console whose
   *  launcher is its settings); otherwise Home uses the saved slots only. */
  canJoin: boolean;
  catalog: Accessor<LinkCatalogApp[]>;
  catalogState: Accessor<CatalogState>;
  catalogError: Accessor<string>;
  installs: Accessor<Record<string, Install>>;
  /** The console installs from an install code by itself (the launcher's
   *  globalThis.installer); read when drawn. */
  canInstallCode(): boolean;
  /** The install code last scanned, shown by the confirmation page. */
  code: Accessor<CodeOffer | null>;
  /** Take a scanned install code; false when it does not parse. */
  offerCode(uri: string): boolean;
  /** Install the offered code's package; progress goes to installs()[app]. */
  installCode(): void;
  refresh(): void;
  loadCatalog(): void;
  install(app: LinkCatalogApp): void;
  remove(app: HomeApp): boolean;
  launch(output: string): boolean;
  pair(uri: string): boolean;
  forget(id: string): boolean;
  setWifi(on: boolean): void;
  connect(slot: number): void;
  scan(): void;
  join(ssid: string, passphrase: string): void;
  forgetNetwork(slot: number): void;
  /** True once since the link last became "linked". */
  linked: Accessor<boolean>;
}

export function createHomeSystem(): HomeSystem {
  // Wall time: the paired Mac's clock once one has linked (the 3DS clock is
  // often unset), otherwise the console's own clock, which reads local time
  // as if it were UTC; the Time Zone page shifts only that fallback.
  const [tick, setTick] = createSignal(Date.now());
  const [manualOffset, setOffset] = createSignal(DEFAULT_OFFSET);
  const [table, setTable] = createSignal(readAppTable(), { equals: sameJson });
  const [link, setLink] = createSignal(readLink(), { equals: sameJson });
  const [clock, setClock] = createSignal(readClock(), { equals: sameJson });
  const [wifi, setWifiStatus] = createSignal(readWifi(), { equals: sameJson });
  const [catalog, setCatalog] = createSignal<LinkCatalogApp[]>([], { equals: sameJson });
  const [catalogState, setCatalogState] = createSignal<CatalogState>("idle");
  const [catalogError, setCatalogError] = createSignal("");
  const [installs, setInstalls] = createSignal<Record<string, Install>>({});
  const [code, setCode] = createSignal<CodeOffer | null>(null);
  const hasLink = linkHost() !== null;
  const hasWifi = wifiHost() !== null;
  const canJoin = wifiCanJoin();

  const refresh = () => {
    setLink(readLink());
    setClock(readClock());
    setWifiStatus(readWifi());
  };

  let catalogRequest = 0;
  const loadCatalog = () => {
    if (link().state !== LINK_STATE.linked) {
      setCatalogState("idle");
      return;
    }
    const request = ++catalogRequest;
    setCatalogState("loading");
    setCatalogError("");
    requestCatalog().then(
      (apps) => {
        if (request !== catalogRequest) return;
        // Home never offers itself: the launcher is the .3dsx, not a catalog app.
        const launcher = table().launcher;
        setCatalog(apps
          .filter((app) => app.output !== launcher)
          .map((app) => ({ ...app, title: toAscii(app.title), version: toAscii(app.version), summary: toAscii(app.summary) })));
        setCatalogState("ready");
      },
      (error: Error) => {
        if (request !== catalogRequest) return;
        setCatalogError(toAscii(error.message));
        setCatalogState("error");
      },
    );
  };

  // The catalog follows the link: fetched when it comes up, refetched when
  // the companion says its offer changed.
  let wasLinked = link().state === LINK_STATE.linked;
  const [linked, setLinked] = createSignal(wasLinked);
  if (hasLink) {
    onLinkEvent((event) => {
      if (event.t === "catalog.changed") loadCatalog();
      refresh();
    });
  }

  let frames = 0;
  const busy = () =>
    wifi()?.state === "connecting" || wifi()?.scanning === true || link().state === LINK_STATE.connecting || link().pairing === LINK_PAIRING.connecting;
  onFrame(() => {
    pumpInstaller();
    frames++;
    if (frames % POLL_FRAMES === 0) {
      setTick(Date.now());
      refresh();
      if (frames % (POLL_FRAMES * 4) === 0) setTable(readAppTable());
    } else if (frames % BUSY_POLL_FRAMES === 0 && busy()) {
      refresh();
    }
    const isLinked = link().state === LINK_STATE.linked;
    if (isLinked !== wasLinked) {
      wasLinked = isLinked;
      setLinked(isLinked);
      if (isLinked) loadCatalog();
      else setCatalogState("idle");
    }
  });
  if (wasLinked) loadCatalog();

  const setInstall = (id: string, value: Install | null) => {
    const next = { ...installs() };
    if (value) next[id] = value;
    else delete next[id];
    setInstalls(next);
  };

  const now = () => {
    tick();
    return Date.now() + (clock()?.skew ?? 0);
  };
  const offset = () => clock()?.offset ?? manualOffset();

  return {
    now,
    offset,
    macClock: () => clock() !== null,
    setOffset,
    table,
    link,
    hasLink,
    wifi,
    hasWifi,
    canJoin,
    catalog,
    catalogState,
    catalogError,
    installs,
    canInstallCode: () => installerHost() !== null,
    code,
    offerCode(uri) {
      const parsed = parseInstallCode(uri);
      if (!parsed) return false;
      // A finished or failed install of the same app is history; one in
      // flight keeps showing its progress.
      const current = installs()[parsed.app];
      if (current && (current.done || current.error)) setInstall(parsed.app, null);
      setCode({ ...parsed, title: toAscii(parsed.title), uri: uri.replace(/[\r\n ]+$/, ""), host: codeHost(parsed.url) });
      return true;
    },
    installCode() {
      const offer = code();
      if (!offer) return;
      const app = offer.app;
      const current = installs()[app];
      if (current && !current.done && !current.error) return;
      setInstall(app, { received: 0, bytes: 0, error: "", done: false });
      installFromCode(offer.uri, (received, bytes) => setInstall(app, { received, bytes, error: "", done: false })).then(
        (output) => {
          const last = installs()[app];
          setInstall(app, { received: last?.received ?? 0, bytes: last?.bytes ?? 0, error: "", done: true, output });
          setTable(readAppTable());
        },
        (error: Error) => setInstall(app, { received: 0, bytes: 0, error: toAscii(error.message) || "The install failed", done: false }),
      );
    },
    refresh() {
      refresh();
      setTable(readAppTable());
    },
    loadCatalog,
    install(app) {
      const current = installs()[app.id];
      if (current && !current.done && !current.error) return;
      setInstall(app.id, { received: 0, bytes: app.bytes, error: "", done: false });
      installApp(app.id, (progress) => setInstall(app.id, { received: progress.received, bytes: progress.bytes, error: "", done: false })).then(
        (output) => {
          setInstall(app.id, { received: app.bytes, bytes: app.bytes, error: "", done: true, output });
          setTable(readAppTable());
        },
        (error: Error) => setInstall(app.id, { received: 0, bytes: app.bytes, error: toAscii(error.message), done: false }),
      );
    },
    remove(app) {
      const ok = removeApp(app.id);
      setTable(readAppTable());
      setInstall(app.id, null);
      return ok;
    },
    launch: (output) => launchApp(output),
    pair(uri) {
      const ok = pairCompanion(uri);
      refresh();
      return ok;
    },
    forget(id) {
      const ok = forgetCompanion(id);
      refresh();
      return ok;
    },
    setWifi(on) {
      setWifiEnabled(on);
      refresh();
    },
    connect(slot) {
      connectSavedNetwork(slot);
      refresh();
    },
    scan() {
      scanNetworks();
      refresh();
    },
    join(ssid, passphrase) {
      joinNetwork(ssid, passphrase);
      refresh();
    },
    forgetNetwork(slot) {
      forgetNetwork(slot);
      refresh();
    },
    linked,
  };
}

export { LINK_PAIRING, LINK_STATE };

/** "48 KB", "1.2 MB" */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
