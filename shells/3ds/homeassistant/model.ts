// SPDX-License-Identifier: GPL-3.0-or-later
// shells/3ds/homeassistant/model.ts — what the Home app shows: whether this
// device holds a Home Assistant setup, the entities by tab, and the light
// that is open; the service calls behind every control.
//
// The entity list is one signal over the whole states answer; an entity whose
// fields did not change keeps its object, so a row built from it is reused
// across polls. A control changes the entity's state here first (the row
// draws the expected state), sends the call, and asks for the states again
// when it lands; a states answer that arrives while the call is in flight
// keeps the expected state for that entity. A failed call shows its message
// for NOTICE_FRAMES and the next states answer draws the real state.

import { createSignal, type Accessor } from "solid-js";
import { errorText, type Entity, type HaClient, type TabId } from "./api.ts";

/** The home page asks for the states again every this many frames (60 a second). */
export const POLL_FRAMES = 5 * 60;
/** A failed call's message stays this many frames. */
export const NOTICE_FRAMES = 4 * 60;

export interface ListState {
  status: "idle" | "loading" | "ready" | "error";
  error: { title: string; detail: string } | null;
}

export interface HaModel {
  /** null until this device answered whether a setup is kept. */
  ready: Accessor<boolean | null>;
  /** The URL this device keeps, "" without one. */
  setupUrl: Accessor<string>;
  /** Ask this device whether a setup is kept (once; again after `force`). */
  checkSetup(force?: boolean): void;
  connecting: Accessor<boolean>;
  /** Try the pair; resolves with "" or the message to show. */
  connect(url: string, token: string): Promise<string>;
  /** Delete the pair from this device; resolves with "" or the message to show. */
  forget(): Promise<string>;
  tab: Accessor<TabId>;
  setTab(tab: TabId): void;
  entities: Accessor<readonly Entity[]>;
  list: Accessor<ListState>;
  /** Ask for the states: the first time with the loading state, after that in place. */
  refresh(): void;
  entity(id: string): Entity | undefined;
  /** A call for the entity is in flight. */
  busy(id: string): boolean;
  /** Call `domain.service` on the entity, drawing `expect` until the states come back. */
  act(entity: Entity, service: string, data?: Record<string, unknown>, expect?: Partial<Entity>): void;
  toggle(entity: Entity): void;
  /** Light brightness 1..100 %, which turns the light on. */
  setBrightness(entity: Entity, percent: number): void;
  /** The last failed call's message, "" when none. */
  notice: Accessor<string>;
  /** Count one frame of the notice; the page calls it from its onFrame. */
  tickNotice(): void;
  /** The light open on the light page. */
  current: Accessor<Entity | null>;
  open(entity: Entity): void;
}

/** The entity's fields as one string: equal strings keep the old object. */
const signature = (entity: Entity) => JSON.stringify([entity.name, entity.state, entity.unit, entity.icon ?? "", entity.attributes]);

/** The state a toggle expects: "on" becomes "off", anything else "on". */
export function toggled(entity: Entity): string {
  return entity.state === "on" ? "off" : "on";
}

export function createHaModel(client: HaClient): HaModel {
  const [ready, setReady] = createSignal<boolean | null>(null);
  const [setupUrl, setSetupUrl] = createSignal("");
  const [connecting, setConnecting] = createSignal(false);
  const [tab, setTab] = createSignal<TabId>("lights");
  const [entities, setEntities] = createSignal<readonly Entity[]>([]);
  const [list, setList] = createSignal<ListState>({ status: "idle", error: null });
  const [notice, setNotice] = createSignal("");
  const [current, setCurrent] = createSignal<Entity | null>(null);
  let noticeLeft = 0;
  let checked = false;
  let loading = false;
  let wanted = false;
  let generation = 0;
  /** Entities with a call in flight, each the number of calls. */
  const pending = new Map<string, number>();
  /** Entities as their states came, by id, for the entity() lookup. */
  let byId = new Map<string, Entity>();

  const show = (message: string) => {
    setNotice(message);
    noticeLeft = NOTICE_FRAMES;
  };

  const put = (incoming: readonly Entity[]) => {
    const next = incoming.map((entity) => {
      const known = byId.get(entity.id);
      if (!known) return entity;
      // A call in flight: the expected state stays until the call lands.
      if (pending.has(entity.id)) return known;
      return signature(known) === signature(entity) ? known : entity;
    });
    byId = new Map(next.map((entity) => [entity.id, entity]));
    setEntities(next);
    const open = current();
    if (open) setCurrent(byId.get(open.id) ?? null);
  };

  /** Replace one entity by a copy with `patch`, so its row draws it now. */
  const patch = (id: string, patched: Partial<Entity>) => {
    const known = byId.get(id);
    if (!known) return;
    const next: Entity = { ...known, ...patched, attributes: { ...known.attributes, ...(patched.attributes ?? {}) } };
    byId.set(id, next);
    setEntities(entities().map((entity) => (entity.id === id ? next : entity)));
    if (current()?.id === id) setCurrent(next);
  };

  const refresh = () => {
    if (ready() !== true) return;
    if (loading) {
      // The states are asked for again as soon as this answer lands.
      wanted = true;
      return;
    }
    loading = true;
    const run = ++generation;
    if (list().status !== "ready") setList({ status: "loading", error: null });
    client.states().then(
      (incoming) => {
        loading = false;
        if (run !== generation) return;
        put(incoming);
        setList({ status: "ready", error: null });
        if (wanted) {
          wanted = false;
          refresh();
        }
      },
      (error: unknown) => {
        loading = false;
        if (run !== generation) return;
        wanted = false;
        const text = errorText(error);
        // A refused token: the setup is gone on this device, or stale.
        if (error instanceof Error && (error as { code?: string }).code === "setup") checkSetup(true);
        if (list().status === "ready") show(text.detail);
        else setList({ status: "error", error: text });
      },
    );
  };

  const checkSetup = (force = false) => {
    if (checked && !force) return;
    checked = true;
    client.setup().then(
      (state) => {
        setSetupUrl(state.url);
        setReady(state.ready);
        if (state.ready) refresh();
      },
      (error: unknown) => {
        // Without an answer the home page shows why; a reload asks again.
        checked = false;
        setReady(null);
        setList({ status: "error", error: errorText(error) });
      },
    );
  };

  const act: HaModel["act"] = (entity, service, data, expect) => {
    const id = entity.id;
    if (expect) patch(id, expect);
    pending.set(id, (pending.get(id) ?? 0) + 1);
    client.call(entity.domain, service, id, data).then(
      () => {
        const left = (pending.get(id) ?? 1) - 1;
        if (left > 0) pending.set(id, left);
        else pending.delete(id);
        refresh();
      },
      (error: unknown) => {
        const left = (pending.get(id) ?? 1) - 1;
        if (left > 0) pending.set(id, left);
        else pending.delete(id);
        show(errorText(error).detail);
        refresh();
      },
    );
  };

  return {
    ready,
    setupUrl,
    checkSetup,
    connecting,
    async connect(url, token) {
      if (connecting()) return "";
      setConnecting(true);
      try {
        await client.connect(url, token);
        setSetupUrl(url);
        setReady(true);
        generation++;
        byId = new Map();
        setEntities([]);
        setList({ status: "idle", error: null });
        refresh();
        return "";
      } catch (error) {
        return errorText(error).detail;
      } finally {
        setConnecting(false);
      }
    },
    async forget() {
      try {
        await client.forget();
        generation++;
        byId = new Map();
        pending.clear();
        setEntities([]);
        setCurrent(null);
        setList({ status: "idle", error: null });
        setReady(false);
        return "";
      } catch (error) {
        return errorText(error).detail;
      }
    },
    tab,
    setTab,
    entities,
    list,
    refresh,
    entity: (id) => byId.get(id),
    busy: (id) => pending.has(id),
    act,
    toggle(entity) {
      const next = toggled(entity);
      act(entity, next === "on" ? "turn_on" : "turn_off", undefined, { state: next });
    },
    setBrightness(entity, percent) {
      const clamped = Math.max(1, Math.min(100, Math.round(percent)));
      act(entity, "turn_on", { brightness_pct: clamped }, { state: "on", attributes: { brightness: Math.round((clamped * 255) / 100) } });
    },
    notice,
    tickNotice() {
      if (noticeLeft > 0 && --noticeLeft === 0) setNotice("");
    },
    current,
    open: (entity) => setCurrent(entity),
  };
}
