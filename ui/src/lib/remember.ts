import type { Group, Light, Page, Room, ThemeMode } from "@/store";

const KEY = "staylit-window";

export type SavedWindow = {
  roomId: string;
  page: Page;
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

export function loadWindow(): SavedWindow | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedWindow>;
    if (!parsed || typeof parsed.roomId !== "string" || !Array.isArray(parsed.lights)) return null;
    return {
      roomId: parsed.roomId,
      page: parsed.page?.kind === "group" && typeof parsed.page.groupId === "string" ? parsed.page : { kind: "room" },
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
