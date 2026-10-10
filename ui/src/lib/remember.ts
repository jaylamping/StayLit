import type { Group, Light, Open, Room, ThemeMode } from "@/store";

const KEY = "staylit-window";

export type SavedWindow = {
  roomId: string;
  open?: Open;
  lookByRoom: Record<string, string | null>;
  theme: ThemeMode;
  lights: Light[];
  rooms?: Room[];
  groups?: Group[];
};

function roomsOf(value: unknown): Room[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rooms: Room[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const room = item as Partial<Room>;
    if (typeof room.id !== "string" || typeof room.name !== "string" || !Array.isArray(room.groupIds)) continue;
    if (!room.groupIds.every((id) => typeof id === "string")) continue;
    rooms.push({ id: room.id, name: room.name, groupIds: room.groupIds });
  }
  return rooms.length ? rooms : undefined;
}

function groupsOf(value: unknown): Group[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const groups: Group[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const group = item as Partial<Group>;
    if (typeof group.id !== "string" || typeof group.name !== "string" || !Array.isArray(group.lightIds)) continue;
    if (!group.lightIds.every((id) => typeof id === "string")) continue;
    groups.push({ id: group.id, name: group.name, lightIds: group.lightIds });
  }
  return groups.length ? groups : undefined;
}

function openOf(value: unknown, legacyPage: unknown): Open | undefined {
  const open = value as Partial<{ kind: string; groupId: unknown; lightId: unknown }> | undefined;
  if (open?.kind === "room" || open?.kind === "none") return { kind: open.kind };
  if (open?.kind === "group" && typeof open.groupId === "string") return { kind: "group", groupId: open.groupId };
  if (open?.kind === "light" && typeof open.lightId === "string") return { kind: "light", lightId: open.lightId };
  const page = legacyPage as Partial<{ kind: string; groupId: unknown }> | undefined;
  if (page?.kind === "group" && typeof page.groupId === "string") return { kind: "group", groupId: page.groupId };
  return undefined;
}

export function loadWindow(): SavedWindow | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedWindow>;
    if (!parsed || typeof parsed.roomId !== "string" || !Array.isArray(parsed.lights)) return null;
    return {
      roomId: parsed.roomId,
      open: openOf(parsed.open, (parsed as { page?: unknown }).page),
      lookByRoom: parsed.lookByRoom && typeof parsed.lookByRoom === "object" ? parsed.lookByRoom : {},
      theme: parsed.theme === "light" || parsed.theme === "dark" ? parsed.theme : "system",
      lights: parsed.lights.filter((light) => light && typeof light.id === "string" && typeof light.name === "string"),
      rooms: roomsOf(parsed.rooms),
      groups: groupsOf(parsed.groups),
    };
  } catch {
    return null;
  }
}

export function saveWindow(value: SavedWindow) {
  localStorage.setItem(KEY, JSON.stringify(value));
}
