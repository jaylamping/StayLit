import { create } from "zustand";
import { lightSwatch, mergeDevices, type DeviceSnap } from "@/lib/devices";
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

const officeRoom: Room = { id: "office", name: "Office", groupIds: ["desk", "overhead"] };
const deskGroup: Group = { id: "desk", name: "Desk", lightIds: [] };
const overheadGroup: Group = { id: "overhead", name: "Overhead", lightIds: [] };
const sampleIds = new Set(["desk", "monitor", "shelf", "ceiling", "rear", "strip", "floor", "table"]);

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
  const rooms = kept?.rooms ?? [officeRoom];
  const groups = kept?.groups ?? [deskGroup, overheadGroup];
  const withDesk = groups.some((group) => group.id === "desk") ? groups : [deskGroup, ...groups];
  const withOverhead = withDesk.some((group) => group.id === "overhead") ? withDesk : [...withDesk, overheadGroup];
  return { rooms, groups: withOverhead };
}

function opened() {
  const saved = loadWindow();
  const { rooms, groups } = layout(saved);
  const room = rooms.find((item) => item.id === saved?.roomId) ?? rooms.find((item) => item.id === "office") ?? rooms[0];
  if (!room) throw new Error("Office is missing");
  let page: Page = saved?.page ?? { kind: "room" };
  if (page.kind === "group" && !room.groupIds.includes(page.groupId)) page = { kind: "room" };
  const lookByRoom: Record<string, string | null> = { office: null, ...saved?.lookByRoom };
  const lights = (saved?.lights ?? [])
    .filter((light) => !sampleIds.has(light.id))
    .map((light) => ({
      ...light,
      live: light.live === true,
      roomId: rooms.some((item) => item.id === light.roomId) ? light.roomId : "office",
    }));
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

const powerGen = new Map<string, number>();
const paintHold = new Map<string, Light>();
const paintGen = new Map<string, number>();
const paintTimer = new Map<string, ReturnType<typeof setTimeout>>();

function paintLight(
  light: Light,
  patch: { mode?: "color" | "white"; hue?: number; saturation?: number; kelvin?: number; brightness?: number },
): Light {
  let kind = light.kind;
  let hue = patch.hue ?? light.hue;
  let saturation = patch.saturation ?? light.saturation;
  let kelvin = patch.kelvin ?? light.kelvin;
  const brightness = patch.brightness ?? light.brightness;
  if (patch.mode === "white") {
    kind = light.kind === "strip" ? "strip" : "white";
    saturation = 0;
    kelvin = Math.min(9000, Math.max(2500, kelvin ?? 3800));
  } else if (patch.mode === "color") {
    kind = light.kind === "strip" ? "strip" : "color";
    hue = hue ?? 30;
    saturation = (saturation ?? 0) < 2 ? 100 : saturation;
  } else if (patch.kelvin !== undefined) {
    kelvin = Math.min(9000, Math.max(2500, patch.kelvin));
  }
  return {
    ...light,
    kind,
    hue,
    saturation,
    kelvin,
    brightness,
    color: lightSwatch({ hue, saturation, kelvin }, light.color),
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
    if (!paintHold.has(lightId)) paintHold.set(lightId, current);
    const generation = (paintGen.get(lightId) ?? 0) + 1;
    paintGen.set(lightId, generation);
    const next = paintLight(current, patch);
    set({
      lights: get().lights.map((light) => (light.id === lightId ? next : light)),
      effect: get().effect?.lightIds.includes(lightId) ? null : get().effect,
      notice: get().notice?.scope === lightId ? null : get().notice,
    });
    const pending = paintTimer.get(lightId);
    if (pending) clearTimeout(pending);
    paintTimer.set(
      lightId,
      setTimeout(() => {
        const light = get().lights.find((item) => item.id === lightId);
        if (!light) return;
        const white = (light.saturation ?? 0) < 2 || light.kind === "white";
        void sendLive(light.live, () =>
          lifx("setColor", {
            deviceId: lightId,
            brightness: light.brightness,
            kelvin: light.kelvin ?? 3800,
            hue: white ? 0 : (light.hue ?? 0),
            saturation: white ? 0 : (light.saturation ?? 0),
          }),
        )
          .then(() => {
            if (paintGen.get(lightId) === generation) paintHold.delete(lightId);
          })
          .catch((err: unknown) => {
            if (paintGen.get(lightId) !== generation) return;
            const held = paintHold.get(lightId);
            paintHold.delete(lightId);
            set({
              lights: get().lights.map((item) => (item.id === lightId && held ? held : item)),
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
    const ids = get().lights.filter((light) => light.roomId === room.id).map((light) => light.id);
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
    const selection = cycleSelection(get());
    if (selection.lightIds.length === 0) return;
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
    void lifx("effects.start", { kind: "color-cycle", deviceIds: selection.lightIds }).catch((err: unknown) => {
      set({ effect: previous, notice: { scope: "effect", message: messageOf(err) } });
    });
  },
  startGradient: () => {
    const roomId = get().roomId;
    const previous = get().effect;
    const strip = get().lights.find((light) => light.roomId === roomId && light.kind === "strip" && light.live && !light.offline);
    if (!strip) return;
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

function showDiscovered(devices: DeviceSnap[]) {
  const current = useOffice.getState();
  const lights = mergeDevices(current.lights, devices);
  const selectedLightId = lights.some((light) => light.id === current.selectedLightId) ? current.selectedLightId : null;
  useOffice.setState({ lights, selectedLightId });
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
  discoveryWatch = setInterval(pull, 1500);
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
