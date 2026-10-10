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
import { lifx, sidecarAvailable } from "@/lib/lifx";
import { loadWindow, saveWindow } from "@/lib/remember";

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
export type Page = { kind: "room" } | { kind: "group"; groupId: string };
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

type OfficeState = {
  lights: Light[];
  rooms: Room[];
  groups: Group[];
  looks: Look[];
  roomId: string;
  page: Page;
  lookByRoom: Record<string, string | null>;
  selectedLookId: string | null;
  selectedLightId: string | null;
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
  setLightPaint: (
    lightId: string,
    patch: { mode?: "color" | "white"; hue?: number; saturation?: number; kelvin?: number; brightness?: number },
  ) => void;
  setPower: (lightId: string, on: boolean) => void;
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
    page: state.page,
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

function opened() {
  const saved = loadWindow();
  const { rooms, groups: laidOut, reseed } = layout(saved);
  const room = rooms.find((item) => item.id === saved?.roomId) ?? rooms.find((item) => item.id === "office") ?? rooms[0];
  if (!room) throw new Error("Office is missing");
  let page: Page = saved?.page ?? { kind: "room" };
  if (page.kind === "group" && !room.groupIds.includes(page.groupId)) page = { kind: "room" };
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
  return {
    roomId: room.id,
    page,
    lookByRoom,
    selectedLookId: lookByRoom[room.id] ?? null,
    theme: saved?.theme ?? "system",
    lights,
    rooms,
    groups,
  };
}

const paintTimer = new Map<string, ReturnType<typeof setTimeout>>();
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

function paintLight(
  light: Light,
  patch: { mode?: "color" | "white"; hue?: number; saturation?: number; kelvin?: number; brightness?: number },
): Light {
  const mode = light.ability === "white" ? "white" : (patch.mode ?? light.mode);
  const hue = patch.hue ?? light.hue ?? 0;
  const saturation = patch.saturation ?? light.saturation ?? 0;
  const kelvin = Math.min(9000, Math.max(2500, patch.kelvin ?? light.kelvin ?? 3800));
  const brightness = patch.brightness ?? light.brightness;
  return {
    ...light,
    mode,
    hue,
    saturation,
    kelvin,
    brightness,
    color: lightSwatch({ mode, hue, saturation, kelvin }, light.color),
  };
}

async function sendLive(live: boolean, run: () => Promise<unknown>) {
  if (!live || !sidecarAvailable()) return;
  await run();
}

export const useOffice = create<OfficeState>((set, get) => ({
  ...opened(),
  looks,
  selectedLightId: null,
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
      page: { kind: "room" },
      selectedLookId: get().lookByRoom[roomId] ?? null,
      selectedLightId: null,
    });
  },
  openGroup: (groupId) => set({ page: { kind: "group", groupId }, selectedLightId: null }),
  openRoom: () => set({ page: { kind: "room" }, selectedLightId: null }),
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
  selectLight: (lightId) => set({ selectedLightId: lightId }),
  setBrightness: (lightId, brightness) => get().setLightPaint(lightId, { brightness }),
  setLightPaint: (lightId, patch) => {
    const current = get().lights.find((light) => light.id === lightId);
    if (!current || current.offline) return;
    const starting = !pendingEdits.get(lightId)?.paint;
    const generation = beginPaint(lightId, fieldsOf(current));
    const next = paintLight(current, patch);
    stagePaint(lightId, fieldsOf(next));
    if (starting) haltEffect(current.roomId);
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
  setGroupPower: (groupId, on) => {
    const group = get().groups.find((item) => item.id === groupId);
    if (!group) return;
    const targets = get().lights.filter((light) => group.lightIds.includes(light.id) && !light.offline);
    const room = get().rooms.find((item) => item.groupIds.includes(groupId));
    if (room) haltEffect(room.id);
    set({
      lights: patch(get().lights, group.lightIds, on),
      notice: get().notice?.scope === groupId ? null : get().notice,
    });
    void settlePower(
      targets.map((light) => ({ id: light.id, on, live: light.live, generation: beginPower(light.id, light.on) })),
      groupId,
    );
  },
  roomOff: () => {
    const room = get().rooms.find((item) => item.id === get().roomId);
    if (!room) return;
    const targets = get().lights.filter((light) => light.roomId === room.id && !light.offline);
    haltEffect(room.id);
    set({
      lights: patch(
        get().lights,
        targets.map((light) => light.id),
        false,
      ),
      notice: null,
    });
    void settlePower(
      targets.map((light) => ({ id: light.id, on: false, live: light.live, generation: beginPower(light.id, light.on) })),
      room.id,
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
      accent: "#e39a45",
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
    const strip = get().lights.find((light) => light.roomId === roomId && light.ability === "multizone" && light.live && !light.offline);
    if (!strip) return;
    releasePaint();
    const effect: Effect = {
      name: "Moving gradient",
      target: strip.name,
      accent: "#e7b57a",
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

function settlePower(
  jobs: { id: string; on: boolean; live: boolean; generation: number }[],
  scope: string,
) {
  void Promise.all(
    jobs.map(async (job) => {
      try {
        await sendLive(job.live, () => lifx("setPower", { deviceId: job.id, on: job.on }));
        finishPower(job.id, job.generation);
        return null;
      } catch (err) {
        const before = failPower(job.id, job.generation);
        if (before === null) return null;
        return { id: job.id, before, err };
      }
    }),
  ).then((results) => {
    const failed = results.flatMap((item) => (item ? [item] : []));
    if (failed.length === 0) {
      saveWindow(snapshot(useOffice.getState()));
      syncEffect();
      return;
    }
    const first = failed[0];
    if (!first) return;
    useOffice.setState({
      lights: useOffice.getState().lights.map((light) => {
        const miss = failed.find((item) => item.id === light.id);
        return miss ? { ...light, on: miss.before } : light;
      }),
      notice: { scope, message: messageOf(first.err) },
    });
  });
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

export function cycleSelection(state: {
  lights: Light[];
  rooms: Room[];
  groups: Group[];
  roomId: string;
  page: Page;
  selectedLightId: string | null;
}) {
  const room = state.rooms.find((item) => item.id === state.roomId);
  const inRoom = (id: string) => state.lights.find((light) => light.id === id && light.roomId === state.roomId && light.live && !light.offline);
  if (state.selectedLightId) {
    const selected = state.lights.find((light) => light.id === state.selectedLightId && light.roomId === state.roomId);
    if (!selected || !selected.live || selected.offline) return { target: selected?.name ?? "Light", lightIds: [] as string[] };
    return { target: selected.name, lightIds: [selected.id] };
  }
  const page = state.page;
  if (page.kind === "group") {
    const group = state.groups.find((item) => item.id === page.groupId);
    const lightIds = (group?.lightIds ?? []).filter((id) => inRoom(id));
    return { target: group?.name ?? "Group", lightIds };
  }
  const lightIds = state.lights.filter((light) => light.roomId === state.roomId && light.live && !light.offline).map((light) => light.id);
  return { target: room?.name ?? "Office", lightIds };
}

function effectFromStatus(status: { running?: boolean; kind?: string; deviceId?: string | null; deviceIds?: string[] | null }, roomId: string): Effect {
  if (!status.running || !status.kind) return null;
  if (status.kind === "moving-gradient") {
    return {
      name: "Moving gradient",
      target: "Lightstrip",
      accent: "#e7b57a",
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
    accent: "#e39a45",
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
  if (lead.color === effect.accent && target === effect.target) return effect;
  return { ...effect, accent: lead.color, target };
}

function releasePaint() {
  for (const timer of paintTimer.values()) clearTimeout(timer);
  paintTimer.clear();
  for (const edit of pendingEdits.values()) {
    if (edit.paint) delete edit.paint;
  }
}

function showDiscovered(devices: DeviceSnap[]) {
  const current = useOffice.getState();
  const lights = mergeDevices(current.lights, devices);
  const selectedLightId = lights.some((light) => light.id === current.selectedLightId) ? current.selectedLightId : null;
  const effect = liveEffect(current.effect, lights);
  const known = new Set(current.lights.map((light) => light.id));
  const fresh = new Set(lights.filter((light) => !known.has(light.id)).map((light) => light.id));
  if (fresh.size === 0) {
    quietly(() => useOffice.setState({ lights, selectedLightId, effect }));
    return;
  }
  useOffice.setState({ lights, selectedLightId, effect, groups: placeLights(lights, current.rooms, current.groups, fresh) });
}

let discoveryWatch: ReturnType<typeof setInterval> | undefined;

export function openWindow() {
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
