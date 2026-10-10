import type { Light, Page, ThemeMode } from "@/store";

const KEY = "staylit-window";

export type SavedWindow = {
  roomId: string;
  page: Page;
  lookByRoom: Record<string, string | null>;
  theme: ThemeMode;
  lights: Light[];
};

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
    };
  } catch {
    return null;
  }
}

export function saveWindow(value: SavedWindow) {
  localStorage.setItem(KEY, JSON.stringify(value));
}
