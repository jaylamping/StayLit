import { create } from "zustand";
import { lightSwatch, mergeDevices, type DeviceSnap } from "@/lib/devices";
import {
  beginPaint,
  beginPower,
  failPaint,
  failPower,
  finishPaint,
  finishPower,
  paintFields,
  pendingEdits,
  sentPaint,
  stagePaint,
} from "@/lib/edits";
import { clearFrames, lastFrames, paintFrame, type EffectFrame } from "@/lib/frames";
import { lifx, onSidecarEvent, sidecarAvailable } from "@/lib/lifx";
import { loadWindow, saveWindow } from "@/lib/remember";
import { nextPaint, type PaintPatch } from "@/lib/paint";

export type Light = {
  id: string;
  name: string;
  color: string;
  on: boolean;
  offline: boolean;
  live: boolean;
  ability: "color" | "white" | "multizone";
  mode: "color" | "white";
  brightness: number;
  kelvin?: number;
  hue?: number;
  saturation?: number;
  zones?: string[];
  kelvinRange?: [number, number];
  roomId: string;
};

export type Group = { id: string; name: string; lightIds: string[] };
export type Room = { id: string; name: string; groupIds: string[] };
export type Look = {
  id: string;
  roomId: string;
  name: string;
  groupIds: string[];
  chips: { color?: string; off?: boolean }[];
  accent: string;
};

export type ThemeMode = "system" | "light" | "dark";
export type Open = { kind: "none" } | { kind: "room" } | { kind: "group"; groupId: string } | { kind: "light"; lightId: string };
export type SetTarget = { kind: "room" } | { kind: "group"; groupId: string };
export type { PaintPatch };
export type Effect = {
  name: string;
  target: string;
  accent: string;
  roomId: string;
  lightIds: string[];
  kind: "color-cycle" | "moving-gradient";
} | null;
export type Notice = { scope: string; message: string } | null;

const officeRoom: Room = { id: "office", name: "Office", groupIds: ["desk", "overhead", "strip"] };
const deskGroup: Group = { id: "desk", name: "Desk", lightIds: [] };
const overheadGroup: Group = { id: "overhead", name: "Overhead", lightIds: [] };
const stripGroup: Group = { id: "strip", name: "Strip", lightIds: [] };
const sampleIds = new Set(["desk", "monitor", "shelf", "ceiling", "rear", "strip", "floor", "table"]);

export const cycleIntervalMs = 1000;

export function isCandle(light: { name: string }) {
  return /\bcandle\b/i.test(light.name);
}

function homeGroup(light: Light) {
  if (light.ability === "multizone") return "strip";
  if (isCandle(light) || /^corner light$/i.test(light.name.trim())) return "desk";
  if (/^office \d+$/i.test(light.name.trim())) return "overhead";
  return null;
}

function placeLights(lights: Light[], rooms: Room[], groups: Group[], ids: ReadonlySet<string>) {
  const taken = new Set(groups.flatMap((group) => group.lightIds));
  let placed = groups;
  for (const light of lights) {
    if (!ids.has(light.id) || taken.has(light.id)) continue;
    const groupId = homeGroup(light);
    if (!groupId || !rooms.find((room) => room.id === light.roomId)?.groupIds.includes(groupId)) continue;
    placed = placed.map((group) => (group.id === groupId ? { ...group, lightIds: [...group.lightIds, light.id] } : group));
    taken.add(light.id);
  }
  return placed;
}

const looks: Look[] = [];

export type OfficeState = {
  lights: Light[];
  rooms: Room[];
  groups: Group[];
  looks: Look[];
  roomId: string;
  open: Open;
  lookByRoom: Record<string, string | null>;
  selectedLookId: string | null;
  effect: Effect;
  theme: ThemeMode;
  notice: Notice;
  setTheme: (theme: ThemeMode) => void;
  setRoom: (roomId: string) => void;
  openGroup: (groupId: string) => void;
  openRoom: () => void;
  selectLook: (lookId: string) => void;
  selectLight: (lightId: string) => void;
  setBrightness: (lightId: string, brightness: number) => void;
  setLightPaint: (lightId: string, patch: PaintPatch) => void;
  setSetPaint: (target: SetTarget, patch: PaintPatch) => void;
  setPower: (lightId: string, on: boolean) => void;
  setSetPower: (target: SetTarget, on: boolean) => void;
  setGroupPower: (groupId: string, on: boolean) => void;
  roomOff: () => void;
  startCycle: () => void;
  startGradient: () => void;
  stopEffect: () => void;
  addLivingRoom: () => void;
  assignRoom: (lightId: string, roomId: string) => void;
  assignGroup: (lightId: string, groupId: string | null) => void;
};

function patch(lights: Light[], ids: string[], on: boolean) {
  return lights.map((light) => (ids.includes(light.id) && !light.offline ? { ...light, on } : light));
}

function messageOf(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "That did not reach the light";
}

function snapshot(state: OfficeState) {
  return {
    roomId: state.roomId,
    open: state.open,
    lookByRoom: state.lookByRoom,
    theme: state.theme,
    lights: state.lights,
    rooms: state.rooms,
    groups: state.groups,
  };
}

function layout(saved: ReturnType<typeof loadWindow>) {
  const savedRooms = saved?.rooms;
  const office = savedRooms?.find((room) => room.id === "office");
  const kept =
    office && office.groupIds.includes("desk") && office.groupIds.includes("overhead") && saved?.groups
      ? { rooms: savedRooms, groups: saved.groups }
      : null;
  const savedGroups = kept?.groups ?? [deskGroup, overheadGroup];
  const withDesk = savedGroups.some((group) => group.id === "desk") ? savedGroups : [deskGroup, ...savedGroups];
  const withOverhead = withDesk.some((group) => group.id === "overhead") ? withDesk : [...withDesk, overheadGroup];
  const reseed = !withOverhead.some((group) => group.id === "strip");
  const groups = reseed ? [...withOverhead, stripGroup] : withOverhead;
  const rooms = (kept?.rooms ?? [officeRoom]).map((room) =>
    room.id === "office" && !room.groupIds.includes("strip") ? { ...room, groupIds: [...room.groupIds, "strip"] } : room,
  );
  return { rooms, groups, reseed };
}

function reopened(open: Open | undefined, room: Room, lights: Light[]): Open {
  if (!open) return { kind: "none" };
  if (open.kind === "group") return room.groupIds.includes(open.groupId) ? open : { kind: "none" };
  if (open.kind === "light") return lights.some((light) => light.id === open.lightId && light.roomId === room.id) ? open : { kind: "none" };
  return open;
}

function opened() {
  const saved = loadWindow();
  const { rooms, groups: laidOut, reseed } = layout(saved);
  const room = rooms.find((item) => item.id === saved?.roomId) ?? rooms.find((item) => item.id === "office") ?? rooms[0];
  if (!room) throw new Error("Office is missing");
  const lookByRoom: Record<string, string | null> = { office: null, ...saved?.lookByRoom };
  const lights = (saved?.lights ?? [])
    .filter((light) => !sampleIds.has(light.id))
    .map((light) => {
      const savedLight = light as Light & { kind?: string };
      const ability = savedLight.ability ?? (savedLight.kind === "strip" ? "multizone" : "color");
      const mode = savedLight.mode ?? (savedLight.kind === "white" || ability === "white" ? "white" : "color");
      return {
        ...savedLight,
        live: savedLight.live === true,
        ability,
        mode,
        roomId: rooms.some((item) => item.id === savedLight.roomId) ? savedLight.roomId : "office",
      };
    });
  const groups = reseed ? placeLights(lights, rooms, laidOut, new Set(lights.map((light) => light.id))) : laidOut;
  const open = reopened(saved?.open, room, lights);
  return {
    roomId: room.id,
    open,
    lookByRoom,
    selectedLookId: lookByRoom[room.id] ?? null,
    theme: saved?.theme ?? "system",
    lights,
    rooms,
    groups,
  };
}

const paintTimer = new Map<string, ReturnType<typeof setTimeout>>();
const setTimers = new Map<string, ReturnType<typeof setTimeout>>();
const setGenerations = new Map<string, Map<string, number>>();
let quiet = false;
let effectSync = 0;

function quietly(run: () => void) {
  quiet = true;
  try {
    run();
  } finally {
    quiet = false;
  }
}

function fieldsOf(light: Light) {
  return paintFields({
    mode: light.mode,
    hue: light.hue ?? 0,
    saturation: light.saturation ?? 0,
    kelvin: light.kelvin ?? 3800,
    brightness: light.brightness,
    color: light.color,
  });
}

function paintLight(light: Light, patch: PaintPatch): Light {
  const { mode, hue, saturation, kelvin, brightness } = nextPaint(light, patch);
  const color = lightSwatch({ mode, hue, saturation, kelvin }, light.color);
  return {
    ...light,
    mode,
    hue,
    saturation,
    kelvin,
    brightness,
    color,
    zones: light.zones?.map(() => color),
  };
}

async function sendLive(live: boolean, run: () => Promise<unknown>) {
  if (!live || !sidecarAvailable()) return;
  await run();
}

export const useOffice = create<OfficeState>((set, get) => ({
  ...opened(),
  looks,
  effect: null,
  notice: null,
  setTheme: (theme) => {
    const previous = get().theme;
    set({ theme, notice: get().notice?.scope === "settings" ? null : get().notice });
    try {
      saveWindow(snapshot({ ...get(), theme }));
    } catch (err) {
      set({ theme: previous, notice: { scope: "settings", message: messageOf(err) } });
    }
  },
  setRoom: (roomId) => {
    const room = get().rooms.find((item) => item.id === roomId);
    if (!room) return;
    set({
      roomId,
      open: { kind: "none" },
      selectedLookId: get().lookByRoom[roomId] ?? null,
    });
  },
  openGroup: (groupId) => set({ open: { kind: "group", groupId } }),
  openRoom: () => set({ open: { kind: "room" } }),
  selectLook: (lookId) => {
    const previousLook = get().selectedLookId;
    const previousEffect = get().effect;
    const roomId = get().roomId;
    set({
      selectedLookId: lookId,
      lookByRoom: { ...get().lookByRoom, [roomId]: lookId },
      effect: previousEffect?.roomId === roomId ? null : previousEffect,
      notice: null,
    });
    if (previousEffect?.roomId !== roomId) return;
    void sendLive(true, () => lifx("effects.stop")).catch((err: unknown) => {
      set({
        selectedLookId: previousLook,
        lookByRoom: { ...get().lookByRoom, [roomId]: previousLook },
        effect: previousEffect,
        notice: { scope: `look:${lookId}`, message: messageOf(err) },
      });
    });
  },
  selectLight: (lightId) => set({ open: { kind: "light", lightId } }),
  setBrightness: (lightId, brightness) => get().setLightPaint(lightId, { brightness }),
  setLightPaint: (lightId, patch) => {
    const found = get().lights.find((light) => light.id === lightId);
    if (!found || found.offline) return;
    const starting = !pendingEdits.get(lightId)?.paint;
    if (starting) haltEffect(found.roomId);
    const current = get().lights.find((light) => light.id === lightId) ?? found;
    const generation = beginPaint(lightId, fieldsOf(current));
    const next = paintLight(current, patch);
    stagePaint(lightId, fieldsOf(next));
    quietly(() =>
      set({
        lights: get().lights.map((light) => (light.id === lightId ? next : light)),
        notice: get().notice?.scope === lightId ? null : get().notice,
      }),
    );
    const pending = paintTimer.get(lightId);
    if (pending) clearTimeout(pending);
    paintTimer.set(
      lightId,
      setTimeout(() => {
        const sent = sentPaint(lightId, generation);
        if (!sent) return;
        const white = sent.mode === "white";
        void sendLive(current.live, () =>
          lifx("setColor", {
            deviceId: lightId,
            brightness: sent.brightness,
            kelvin: sent.kelvin,
            hue: white ? 0 : sent.hue,
            saturation: white ? 0 : sent.saturation,
          }),
        )
          .then(() => {
            if (!finishPaint(lightId, generation)) return;
            saveWindow(snapshot(get()));
            syncEffect();
          })
          .catch((err: unknown) => {
            const latest = get().lights.find((item) => item.id === lightId);
            if (!latest) return;
            const restored = failPaint(latest, lightId, generation);
            if (restored === latest) return;
            set({
              lights: get().lights.map((item) => (item.id === lightId ? restored : item)),
              notice: { scope: lightId, message: messageOf(err) },
            });
          });
      }, 120),
    );
  },
  setPower: (lightId, on) => {
    const current = get().lights.find((light) => light.id === lightId);
    if (!current || current.offline) return;
    const generation = beginPower(lightId, current.on);
    haltEffect(current.roomId);
    set({
      lights: patch(get().lights, [lightId], on),
      notice: get().notice?.scope === lightId ? null : get().notice,
    });
    void sendPower(lightId, on, generation, current.live);
  },
  setGroupPower: (groupId, on) => get().setSetPower({ kind: "group", groupId }, on),
  roomOff: () => get().setSetPower({ kind: "room" }, false),
  setSetPower: (target, on) => {
    const state = get();
    const ids = memberIds(state, target).filter((id) => state.lights.some((light) => light.id === id && !light.offline));
    if (ids.length === 0) return;
    const scope = scopeOf(target, state.roomId);
    haltEffect(state.roomId);
    const jobs = ids.flatMap((id) => {
      const light = get().lights.find((item) => item.id === id);
      return light ? [{ id, live: light.live, generation: beginPower(id, light.on) }] : [];
    });
    set({
      lights: patch(get().lights, ids, on),
      notice: get().notice?.scope === scope ? null : get().notice,
    });
    sendPowers(jobs, on, scope);
  },
  setSetPaint: (target, paintPatch) => {
    const state = get();
    const ids = memberIds(state, target).filter((id) => state.lights.some((light) => light.id === id && !light.offline));
    if (ids.length === 0) return;
    const key = targetKey(target);
    const scope = scopeOf(target, state.roomId);
    haltEffect(state.roomId);
    const generations = setGenerations.get(key) ?? new Map<string, number>();
    const painted = new Map<string, Light>();
    for (const id of ids) {
      const current = get().lights.find((light) => light.id === id);
      if (!current) continue;
      generations.set(id, beginPaint(id, fieldsOf(current)));
      const next = paintLight(current, paintPatch);
      stagePaint(id, fieldsOf(next));
      painted.set(id, next);
    }
    setGenerations.set(key, generations);
    quietly(() =>
      set({
        lights: get().lights.map((light) => painted.get(light.id) ?? light),
        notice: get().notice?.scope === scope ? null : get().notice,
      }),
    );
    const pending = setTimers.get(key);
    if (pending) clearTimeout(pending);
    setTimers.set(
      key,
      setTimeout(() => {
        setTimers.delete(key);
        const sending = setGenerations.get(key);
        setGenerations.delete(key);
        if (sending) sendPaints(sending, scope);
      }, 120),
    );
  },
  startCycle: () => {
    const roomId = get().roomId;
    const selection = cycleSelection(get());
    if (selection.lightIds.length === 0) return;
    releasePaint();
    const previous = get().effect;
    const effect: Effect = {
      name: "Color cycle",
      target: selection.target,
      accent: get().lights.find((light) => light.id === selection.lightIds[0])?.color ?? "",
      roomId,
      lightIds: selection.lightIds,
      kind: "color-cycle",
    };
    set({ effect, notice: null });
    void lifx("effects.start", { kind: "color-cycle", deviceIds: selection.lightIds, intervalMs: cycleIntervalMs }).catch((err: unknown) => {
      set({ effect: previous, notice: { scope: "effect", message: messageOf(err) } });
    });
  },
  startGradient: () => {
    const roomId = get().roomId;
    const previous = get().effect;
    const strip = gradientStrip(get());
    if (!strip) return;
    releasePaint();
    const effect: Effect = {
      name: "Moving gradient",
      target: strip.name,
      accent: strip.color,
      roomId,
      lightIds: [strip.id],
      kind: "moving-gradient",
    };
    set({ effect, notice: null });
    void lifx("effects.start", {
      kind: "moving-gradient",
      deviceId: strip.id,
      zoneCount: strip.zones?.length ?? 8,
      from: { hue: 20, saturation: 80, brightness: 40, kelvin: 3500 },
      to: { hue: 40, saturation: 70, brightness: 90, kelvin: 3500 },
    }).catch((err: unknown) => {
      set({ effect: previous, notice: { scope: "effect", message: messageOf(err) } });
    });
  },
  stopEffect: () => {
    const previous = get().effect;
    set({ effect: null, notice: null });
    if (!previous) return;
    const live = previous.lightIds.some((id) => get().lights.some((light) => light.id === id && light.live));
    void sendLive(live, () => lifx("effects.stop")).catch((err: unknown) => {
      set({ effect: previous, notice: { scope: "effect", message: messageOf(err) } });
    });
  },
  addLivingRoom: () => {
    if (get().rooms.some((room) => room.id === "living")) return;
    set({ rooms: [...get().rooms, { id: "living", name: "Living room", groupIds: [] }] });
  },
  assignRoom: (lightId, roomId) => {
    const light = get().lights.find((item) => item.id === lightId);
    const room = get().rooms.find((item) => item.id === roomId);
    if (!light || !room || light.roomId === roomId) return;
    set({
      lights: get().lights.map((item) => (item.id === lightId ? { ...item, roomId } : item)),
      groups: get().groups.map((group) => ({ ...group, lightIds: group.lightIds.filter((id) => id !== lightId) })),
    });
  },
  assignGroup: (lightId, groupId) => {
    const light = get().lights.find((item) => item.id === lightId);
    if (!light) return;
    const room = get().rooms.find((item) => item.id === light.roomId);
    if (groupId && !room?.groupIds.includes(groupId)) return;
    set({
      groups: get().groups.map((group) => {
        const lightIds = group.lightIds.filter((id) => id !== lightId);
        return group.id === groupId ? { ...group, lightIds: [...lightIds, lightId] } : { ...group, lightIds };
      }),
    });
  },
}));

let persistTimer: ReturnType<typeof setTimeout> | undefined;
function syncEffect() {
  const ticket = ++effectSync;
  void lifx("effects.list").then((status) => {
    if (ticket !== effectSync) return;
    if (!status || typeof status !== "object") return;
    const effect = effectFromStatus(
      status as { running?: boolean; kind?: string; deviceId?: string | null; deviceIds?: string[] | null },
      useOffice.getState().roomId,
    );
    quietly(() => useOffice.setState({ effect }));
  });
}

function haltEffect(roomId: string) {
  const effect = useOffice.getState().effect;
  if (!effect || effect.roomId !== roomId) return;
  useOffice.setState({ effect: null });
  void lifx("effects.stop").finally(() => syncEffect());
}

function sendPower(id: string, on: boolean, generation: number, live: boolean) {
  void sendLive(live, () => lifx("setPower", { deviceId: id, on }))
    .then(() => {
      if (!finishPower(id, generation)) return;
      saveWindow(snapshot(useOffice.getState()));
      syncEffect();
    })
    .catch((err: unknown) => {
      const before = failPower(id, generation);
      if (before === null) return;
      useOffice.setState({
        lights: useOffice.getState().lights.map((light) => (light.id === id ? { ...light, on: before } : light)),
        notice: { scope: id, message: messageOf(err) },
      });
    });
}

type SetResult = { deviceId?: string; ok?: boolean; error?: string };

function failuresOf(result: unknown, ids: string[], err: unknown) {
  if (err !== undefined) return new Map(ids.map((id) => [id, messageOf(err)]));
  const results = (result as { results?: SetResult[] } | null)?.results ?? [];
  return new Map(results.flatMap((item) => (item.deviceId && item.ok === false ? [[item.deviceId, item.error || messageOf(null)] as const] : [])));
}

function setNotice(failures: Map<string, string>, total: number, scope: string) {
  const [first] = failures.values();
  if (!first) return null;
  const names = [...failures.keys()].map((id) => useOffice.getState().lights.find((light) => light.id === id)?.name ?? id);
  const message = failures.size === total ? first : `${names.join(", ")} did not change: ${first}`;
  return { scope, message };
}

function sendPowers(jobs: { id: string; live: boolean; generation: number }[], on: boolean, scope: string) {
  const sending = sidecarAvailable() ? jobs.filter((job) => job.live) : [];
  for (const job of jobs) if (!sending.includes(job)) finishPower(job.id, job.generation);
  if (sending.length === 0) {
    saveWindow(snapshot(useOffice.getState()));
    return;
  }
  const settle = (result: unknown, err?: unknown) => {
    const failures = failuresOf(result, sending.map((job) => job.id), err);
    const restored = new Map<string, boolean>();
    for (const job of sending) {
      if (!failures.has(job.id)) {
        finishPower(job.id, job.generation);
        continue;
      }
      const before = failPower(job.id, job.generation);
      if (before !== null) restored.set(job.id, before);
      else failures.delete(job.id);
    }
    if (restored.size === 0) {
      saveWindow(snapshot(useOffice.getState()));
      syncEffect();
      return;
    }
    useOffice.setState({
      lights: useOffice.getState().lights.map((light) => (restored.has(light.id) ? { ...light, on: restored.get(light.id) ?? light.on } : light)),
      notice: setNotice(failures, sending.length, scope),
    });
  };
  void lifx("setPowers", { deviceIds: sending.map((job) => job.id), on }).then(
    (result) => settle(result),
    (err: unknown) => settle(null, err),
  );
}

function sendPaints(generations: Map<string, number>, scope: string) {
  const state = useOffice.getState();
  const sending: { id: string; generation: number; color: Record<string, number | string> }[] = [];
  for (const [id, generation] of generations) {
    const sent = sentPaint(id, generation);
    if (!sent) continue;
    const light = state.lights.find((item) => item.id === id);
    if (!light?.live || !sidecarAvailable()) {
      finishPaint(id, generation);
      continue;
    }
    const white = sent.mode === "white";
    sending.push({
      id,
      generation,
      color: {
        deviceId: id,
        brightness: sent.brightness,
        kelvin: sent.kelvin,
        hue: white ? 0 : sent.hue,
        saturation: white ? 0 : sent.saturation,
      },
    });
  }
  if (sending.length === 0) {
    saveWindow(snapshot(useOffice.getState()));
    return;
  }
  const settle = (result: unknown, err?: unknown) => {
    const failures = failuresOf(result, sending.map((job) => job.id), err);
    const restored = new Map<string, Light>();
    for (const job of sending) {
      if (!failures.has(job.id)) {
        finishPaint(job.id, job.generation);
        continue;
      }
      const latest = useOffice.getState().lights.find((item) => item.id === job.id);
      const back = latest ? failPaint(latest, job.id, job.generation) : null;
      if (latest && back && back !== latest) restored.set(job.id, back);
      else failures.delete(job.id);
    }
    if (restored.size === 0) {
      saveWindow(snapshot(useOffice.getState()));
      syncEffect();
      return;
    }
    useOffice.setState({
      lights: useOffice.getState().lights.map((light) => restored.get(light.id) ?? light),
      notice: setNotice(failures, sending.length, scope),
    });
  };
  void lifx("setColors", { lights: sending.map((job) => job.color) }).then(
    (result) => settle(result),
    (err: unknown) => settle(null, err),
  );
}

useOffice.subscribe((state) => {
  if (quiet) return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      saveWindow(snapshot(state));
    } catch {
      return;
    }
  }, 200);
});

type Roster = { lights: Light[]; rooms: Room[]; groups: Group[]; roomId: string; open: Open };

export function openLightId(state: { open: Open }) {
  return state.open.kind === "light" ? state.open.lightId : null;
}

export function openTarget(state: { open: Open }): SetTarget | null {
  const open = state.open;
  if (open.kind === "room") return { kind: "room" };
  if (open.kind === "group") return { kind: "group", groupId: open.groupId };
  return null;
}

export function targetKey(target: SetTarget) {
  return target.kind === "room" ? "room" : `group:${target.groupId}`;
}

function scopeOf(target: SetTarget, roomId: string) {
  return target.kind === "room" ? roomId : target.groupId;
}

export function memberIds(state: { lights: Light[]; groups: Group[]; roomId: string }, target: SetTarget) {
  if (target.kind === "room") return state.lights.filter((light) => light.roomId === state.roomId).map((light) => light.id);
  const ids = state.groups.find((group) => group.id === target.groupId)?.lightIds ?? [];
  return ids.filter((id) => state.lights.some((light) => light.id === id && light.roomId === state.roomId));
}

export function gradientStrip(state: Roster) {
  const target = openTarget(state);
  const ids = target?.kind === "group" ? new Set(memberIds(state, target)) : null;
  return state.lights.find(
    (light) => light.roomId === state.roomId && light.ability === "multizone" && light.live && !light.offline && (!ids || ids.has(light.id)),
  );
}

export function cycleSelection(state: Roster) {
  const room = state.rooms.find((item) => item.id === state.roomId);
  const live = (id: string) => state.lights.some((light) => light.id === id && light.roomId === state.roomId && light.live && !light.offline);
  const open = state.open;
  if (open.kind === "light") {
    const selected = state.lights.find((light) => light.id === open.lightId && light.roomId === state.roomId);
    if (!selected || !selected.live || selected.offline) return { target: selected?.name ?? "Light", lightIds: [] as string[] };
    return { target: selected.name, lightIds: [selected.id] };
  }
  if (open.kind === "group") {
    const group = state.groups.find((item) => item.id === open.groupId);
    return { target: group?.name ?? "Group", lightIds: memberIds(state, open).filter(live) };
  }
  return { target: room?.name ?? "Office", lightIds: memberIds(state, { kind: "room" }).filter(live) };
}

function effectFromStatus(status: { running?: boolean; kind?: string; deviceId?: string | null; deviceIds?: string[] | null }, roomId: string): Effect {
  if (!status.running || !status.kind) return null;
  if (status.kind === "moving-gradient") {
    return {
      name: "Moving gradient",
      target: "Lightstrip",
      accent: "",
      roomId,
      lightIds: status.deviceId ? [status.deviceId] : [],
      kind: "moving-gradient",
    };
  }
  const lightIds = status.deviceIds?.length ? status.deviceIds : status.deviceId ? [status.deviceId] : [];
  const named = lightIds.length === 1 ? useOffice.getState().lights.find((light) => light.id === lightIds[0])?.name : null;
  return {
    name: "Color cycle",
    target: named ?? useOffice.getState().rooms.find((room) => room.id === roomId)?.name ?? "Office",
    accent: "",
    roomId,
    lightIds,
    kind: "color-cycle",
  };
}

function liveEffect(effect: Effect, lights: Light[]): Effect {
  if (!effect) return effect;
  const id = effect.lightIds[0];
  const lead = id ? lights.find((light) => light.id === id) : undefined;
  if (!lead) return effect;
  const target = effect.lightIds.length === 1 ? lead.name : effect.target;
  const accent = effect.accent || lead.color;
  if (accent === effect.accent && target === effect.target) return effect;
  return { ...effect, accent, target };
}

function effectKey(effect: Effect) {
  return effect ? `${effect.kind}:${effect.roomId}:${effect.lightIds.join(",")}` : null;
}

function settleFrames() {
  const frames = lastFrames();
  if (frames.size === 0) return;
  const lights = useOffice.getState().lights.map((light) => {
    const frame = frames.get(light.id);
    if (!frame || pendingEdits.get(light.id)?.paint) return light;
    const color = lightSwatch({ ...frame, mode: "color" }, light.color);
    return {
      ...light,
      mode: "color" as const,
      hue: frame.hue,
      saturation: frame.saturation,
      kelvin: frame.kelvin,
      brightness: frame.brightness,
      color,
      zones: frame.zones ? frame.zones.map((zone) => lightSwatch(zone, color)) : light.zones,
    };
  });
  useOffice.setState({ lights });
}

let framedKey: string | null = null;
useOffice.subscribe((state) => {
  const key = effectKey(state.effect);
  if (key === framedKey) return;
  const ended = framedKey !== null;
  framedKey = key;
  if (ended) settleFrames();
  if (key !== null) clearFrames();
});

function showFrame(frame: EffectFrame) {
  const state = useOffice.getState();
  const effect = state.effect;
  if (!effect || effect.kind !== frame.kind) return;
  if (effect.lightIds.length === 0) {
    useOffice.setState({ effect: { ...effect, lightIds: frame.lights.map((light) => light.deviceId) } });
    return;
  }
  const lights = frame.lights.filter((light) => effect.lightIds.includes(light.deviceId));
  if (lights.length === 0) return;
  const leadId = effect.lightIds[0];
  paintFrame({ ...frame, lights }, leadId, state.lights.find((light) => light.id === leadId)?.hue);
}

let framesHeard = false;
function hearFrames() {
  if (framesHeard) return;
  framesHeard = true;
  void onSidecarEvent((payload) => {
    if (!payload || typeof payload !== "object") return;
    const message = payload as { event?: string; frame?: EffectFrame };
    if (message.event === "effect.frame" && message.frame && Array.isArray(message.frame.lights)) showFrame(message.frame);
  });
}

function releasePaint() {
  for (const timer of [...paintTimer.values(), ...setTimers.values()]) clearTimeout(timer);
  paintTimer.clear();
  setTimers.clear();
  setGenerations.clear();
  for (const edit of pendingEdits.values()) {
    if (edit.paint) delete edit.paint;
  }
}

function showDiscovered(devices: DeviceSnap[]) {
  const current = useOffice.getState();
  const lights = mergeDevices(current.lights, devices, new Set(current.effect?.lightIds ?? []));
  const open = current.open.kind === "light" && !lights.some((light) => light.id === openLightId(current)) ? ({ kind: "none" } as const) : current.open;
  const effect = liveEffect(current.effect, lights);
  const known = new Set(current.lights.map((light) => light.id));
  const fresh = new Set(lights.filter((light) => !known.has(light.id)).map((light) => light.id));
  if (fresh.size === 0) {
    quietly(() => useOffice.setState({ lights, open, effect }));
    return;
  }
  useOffice.setState({ lights, open, effect, groups: placeLights(lights, current.rooms, current.groups, fresh) });
}

let discoveryWatch: ReturnType<typeof setInterval> | undefined;

export function openWindow() {
  hearFrames();
  void lifx("effects.list").then((status) => {
    if (!status || typeof status !== "object") return;
    const effect = effectFromStatus(status as { running?: boolean; kind?: string; deviceId?: string | null }, useOffice.getState().roomId);
    if (effect) useOffice.setState({ effect });
  });
  const pull = () => {
    void lifx("list")
      .then((listed) => {
        if (!listed || typeof listed !== "object") return;
        const devices = (listed as { devices?: DeviceSnap[] }).devices ?? [];
        showDiscovered(devices);
      })
      .catch(() => undefined);
  };
  pull();
  if (discoveryWatch) return;
  discoveryWatch = setInterval(pull, 500);
}

export function groupPower(lights: Light[], ids: string[]) {
  const reachable = lights.filter((light) => ids.includes(light.id) && !light.offline);
  const on = reachable.filter((light) => light.on).length;
  if (on === 0) return "off" as const;
  if (on === reachable.length) return "on" as const;
  return "mixed" as const;
}

export function groupCount(lights: Light[], ids: string[]) {
  const reachable = lights.filter((light) => ids.includes(light.id) && !light.offline);
  const on = reachable.filter((light) => light.on).length;
  return `${on}/${reachable.length}`;
}
