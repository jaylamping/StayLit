import { create } from "zustand";
import { mergeDevices, type DeviceSnap } from "@/lib/devices";
import { lifx, sidecarAvailable } from "@/lib/lifx";
import { loadWindow, saveWindow } from "@/lib/remember";

export type Light = {
  id: string;
  name: string;
  color: string;
  on: boolean;
  offline: boolean;
  live: boolean;
  kind: "color" | "white" | "strip";
  brightness: number;
  kelvin?: number;
  hue?: number;
  saturation?: number;
  zones?: string[];
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

const zones = ["#3a2418", "#6b3a24", "#b8743c", "#e7b57a", "#f3d7b4", "#d49268", "#8d4e34", "#4a2c22", "#c48458", "#f0c9a0", "#6e3d2a", "#2e1e16"];

const seedLights: Light[] = [
  { id: "desk", name: "Desk lamp", color: "#e39a45", on: true, offline: false, live: false, kind: "color", brightness: 72 },
  { id: "monitor", name: "Monitor", color: "#6e8eaa", on: false, offline: false, live: false, kind: "color", brightness: 40 },
  { id: "shelf", name: "Shelf", color: "#c46a4a", on: false, offline: true, live: false, kind: "color", brightness: 0 },
  { id: "ceiling", name: "Ceiling", color: "#ffd7ae", on: true, offline: false, live: false, kind: "white", brightness: 100, kelvin: 3800 },
  { id: "rear", name: "Rear", color: "#ffd7ae", on: false, offline: false, live: false, kind: "white", brightness: 100, kelvin: 3800 },
  { id: "strip", name: "Lightstrip", color: "#e7b57a", on: true, offline: false, live: false, kind: "strip", brightness: 100, zones },
  { id: "floor", name: "Floor lamp", color: "#ffc48a", on: true, offline: false, live: false, kind: "white", brightness: 80, kelvin: 2700 },
  { id: "table", name: "Table", color: "#d4654a", on: true, offline: false, live: false, kind: "color", brightness: 55 },
];

const rooms: Room[] = [
  { id: "office", name: "Office", groupIds: ["desk-group", "overhead", "strip-group"] },
  { id: "living", name: "Living room", groupIds: ["lamps"] },
];

const groups: Group[] = [
  { id: "desk-group", name: "Desk", lightIds: ["desk", "monitor", "shelf"] },
  { id: "overhead", name: "Overhead", lightIds: ["ceiling", "rear"] },
  { id: "strip-group", name: "Strip", lightIds: ["strip"] },
  { id: "lamps", name: "Lamps", lightIds: ["floor", "table"] },
];

const looks: Look[] = [
  {
    id: "work",
    roomId: "office",
    name: "Work",
    groupIds: ["desk-group", "overhead", "strip-group"],
    chips: [{ color: "#e39a45" }, { color: "#ffd7ae" }, { color: "#ffd7ae" }, { color: "#e7b57a" }],
    accent: "#e39a45",
  },
  {
    id: "wind",
    roomId: "office",
    name: "Wind down",
    groupIds: ["desk-group", "overhead", "strip-group"],
    chips: [{ color: "#8a3a2a" }, { off: true }, { off: true }, { color: "#6b3a24" }],
    accent: "#8a3a2a",
  },
];

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
  setPower: (lightId: string, on: boolean) => void;
  setGroupPower: (groupId: string, on: boolean) => void;
  roomOff: () => void;
  startCycle: () => void;
  startGradient: () => void;
  stopEffect: () => void;
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
  };
}

function opened() {
  const saved = loadWindow();
  const fallback = rooms[0];
  if (!fallback) throw new Error("Office is missing");
  const room = rooms.find((item) => item.id === saved?.roomId) ?? fallback;
  let page: Page = saved?.page ?? { kind: "room" };
  if (page.kind === "group" && !room.groupIds.includes(page.groupId)) page = { kind: "room" };
  const lookByRoom: Record<string, string | null> = { office: "work", living: null, ...saved?.lookByRoom };
  const lights = saved?.lights.length ? saved.lights.map((light) => ({ ...light, live: light.live === true })) : seedLights;
  return {
    roomId: room.id,
    page,
    lookByRoom,
    selectedLookId: lookByRoom[room.id] ?? null,
    theme: saved?.theme ?? "system",
    lights,
  };
}

const powerGen = new Map<string, number>();
const brightnessHold = new Map<string, number>();
const brightnessGen = new Map<string, number>();
const brightnessTimer = new Map<string, ReturnType<typeof setTimeout>>();

async function sendLive(live: boolean, run: () => Promise<unknown>) {
  if (!live || !sidecarAvailable()) return;
  await run();
}

export const useOffice = create<OfficeState>((set, get) => ({
  ...opened(),
  rooms,
  groups,
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
  setBrightness: (lightId, brightness) => {
    const current = get().lights.find((light) => light.id === lightId);
    if (!current) return;
    if (!brightnessHold.has(lightId)) brightnessHold.set(lightId, current.brightness);
    const generation = (brightnessGen.get(lightId) ?? 0) + 1;
    brightnessGen.set(lightId, generation);
    set({
      lights: get().lights.map((light) => (light.id === lightId ? { ...light, brightness } : light)),
      notice: get().notice?.scope === lightId ? null : get().notice,
    });
    const pending = brightnessTimer.get(lightId);
    if (pending) clearTimeout(pending);
    brightnessTimer.set(
      lightId,
      setTimeout(() => {
        const light = get().lights.find((item) => item.id === lightId);
        if (!light) return;
        const hue = light.kind === "white" ? 0 : light.hue;
        const saturation = light.kind === "white" ? 0 : light.saturation;
        if (hue === undefined || saturation === undefined) {
          brightnessHold.delete(lightId);
          return;
        }
        void sendLive(light.live, () =>
          lifx("setColor", {
            deviceId: lightId,
            brightness: light.brightness,
            kelvin: light.kelvin ?? 3800,
            hue,
            saturation,
          }),
        )
          .then(() => {
            if (brightnessGen.get(lightId) === generation) brightnessHold.delete(lightId);
          })
          .catch((err: unknown) => {
            if (brightnessGen.get(lightId) !== generation) return;
            const held = brightnessHold.get(lightId);
            brightnessHold.delete(lightId);
            set({
              lights: get().lights.map((item) => (item.id === lightId && held !== undefined ? { ...item, brightness: held } : item)),
              notice: { scope: lightId, message: messageOf(err) },
            });
          });
      }, 120),
    );
  },
  setPower: (lightId, on) => {
    const current = get().lights.find((light) => light.id === lightId);
    if (!current || current.offline) return;
    const generation = (powerGen.get(lightId) ?? 0) + 1;
    powerGen.set(lightId, generation);
    const previous = current.on;
    set({
      lights: patch(get().lights, [lightId], on),
      effect: get().effect?.lightIds.includes(lightId) ? null : get().effect,
      notice: get().notice?.scope === lightId ? null : get().notice,
    });
    void sendLive(current.live, () => lifx("setPower", { deviceId: lightId, on })).catch((err: unknown) => {
      if (powerGen.get(lightId) !== generation) return;
      set({
        lights: patch(get().lights, [lightId], previous),
        notice: { scope: lightId, message: messageOf(err) },
      });
    });
  },
  setGroupPower: (groupId, on) => {
    const group = get().groups.find((item) => item.id === groupId);
    if (!group) return;
    const previous = get().lights.filter((light) => group.lightIds.includes(light.id)).map((light) => ({ id: light.id, on: light.on }));
    const generation = (powerGen.get(groupId) ?? 0) + 1;
    powerGen.set(groupId, generation);
    set({
      lights: patch(get().lights, group.lightIds, on),
      effect: get().effect && group.lightIds.some((id) => get().effect?.lightIds.includes(id)) ? null : get().effect,
      notice: get().notice?.scope === groupId ? null : get().notice,
    });
    const liveIds = get().lights.filter((light) => group.lightIds.includes(light.id) && light.live && !light.offline).map((light) => light.id);
    void Promise.all(liveIds.map((id) => lifx("setPower", { deviceId: id, on }))).catch((err: unknown) => {
      if (powerGen.get(groupId) !== generation) return;
      set({
        lights: get().lights.map((light) => {
          const held = previous.find((item) => item.id === light.id);
          return held ? { ...light, on: held.on } : light;
        }),
        notice: { scope: groupId, message: messageOf(err) },
      });
    });
  },
  roomOff: () => {
    const room = get().rooms.find((item) => item.id === get().roomId);
    if (!room) return;
    const ids = get().groups.filter((group) => room.groupIds.includes(group.id)).flatMap((group) => group.lightIds);
    const previous = get().lights.filter((light) => ids.includes(light.id)).map((light) => ({ id: light.id, on: light.on }));
    set({
      lights: patch(get().lights, ids, false),
      effect: get().effect?.roomId === room.id ? null : get().effect,
      notice: null,
    });
    const liveIds = get().lights.filter((light) => ids.includes(light.id) && light.live && !light.offline).map((light) => light.id);
    void Promise.all(liveIds.map((id) => lifx("setPower", { deviceId: id, on: false }))).catch((err: unknown) => {
      set({
        lights: get().lights.map((light) => {
          const held = previous.find((item) => item.id === light.id);
          return held ? { ...light, on: held.on } : light;
        }),
        notice: { scope: room.id, message: messageOf(err) },
      });
    });
  },
  startCycle: () => {
    const roomId = get().roomId;
    const room = get().rooms.find((item) => item.id === roomId);
    const group = get().groups.find((item) => item.id === room?.groupIds[0]);
    const lightIds = group?.lightIds ?? [];
    const previous = get().effect;
    const effect: Effect = { name: "Color cycle", target: group?.name ?? "Lights", accent: "#e39a45", roomId, lightIds, kind: "color-cycle" };
    set({ effect, selectedLightId: null, notice: null });
    const live = get().lights.find((light) => lightIds.includes(light.id) && light.live && !light.offline);
    if (!live) return;
    void lifx("effects.start", { kind: "color-cycle", deviceId: live.id }).catch((err: unknown) => {
      set({ effect: previous, notice: { scope: "effect", message: messageOf(err) } });
    });
  },
  startGradient: () => {
    const roomId = get().roomId;
    const previous = get().effect;
    const effect: Effect = {
      name: "Moving gradient",
      target: "Lightstrip",
      accent: "#e7b57a",
      roomId,
      lightIds: ["strip"],
      kind: "moving-gradient",
    };
    set({ effect, selectedLightId: null, notice: null });
    const strip = get().lights.find((light) => light.id === "strip" && light.live && !light.offline);
    if (!strip) return;
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
}));

let persistTimer: ReturnType<typeof setTimeout> | undefined;
useOffice.subscribe((state) => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      saveWindow(snapshot(state));
    } catch {
      return;
    }
  }, 200);
});

function effectFromStatus(status: { running?: boolean; kind?: string; deviceId?: string | null }, roomId: string): Effect {
  if (!status.running || !status.kind) return null;
  if (status.kind === "moving-gradient") {
    return {
      name: "Moving gradient",
      target: "Lightstrip",
      accent: "#e7b57a",
      roomId,
      lightIds: status.deviceId ? [status.deviceId] : ["strip"],
      kind: "moving-gradient",
    };
  }
  return {
    name: "Color cycle",
    target: "Desk",
    accent: "#e39a45",
    roomId,
    lightIds: status.deviceId ? [status.deviceId] : [],
    kind: "color-cycle",
  };
}

export function openWindow() {
  void lifx("effects.list").then((status) => {
    if (!status || typeof status !== "object") return;
    const effect = effectFromStatus(status as { running?: boolean; kind?: string; deviceId?: string | null }, useOffice.getState().roomId);
    if (effect) useOffice.setState({ effect });
  });
  void lifx("list").then((listed) => {
    if (!listed || typeof listed !== "object") return;
    const devices = (listed as { devices?: DeviceSnap[] }).devices ?? [];
    const next = mergeDevices(useOffice.getState().lights, devices);
    if (next) useOffice.setState({ lights: next });
  });
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
