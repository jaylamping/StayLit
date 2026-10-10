import { Settings, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hideWindow } from "@/lib/lifx";
import { Roster } from "@/roster";
import { Stage } from "@/stage";
import { useOffice, type ThemeMode } from "@/store";

function Wash() {
  const accent = useOffice((state) => {
    if (state.effect?.roomId === state.roomId) return state.effect.accent;
    const look = state.looks.find((item) => item.id === state.selectedLookId && item.roomId === state.roomId);
    if (!look) return null;
    const page = state.page;
    if (page.kind === "group" && !look.groupIds.includes(page.groupId)) return null;
    return look.accent;
  });
  return (
    <div
      className="flex min-h-0 flex-1"
      style={accent ? { background: `radial-gradient(90% 80% at 18% 0%, color-mix(in srgb, ${accent} 28%, transparent), transparent 55%)` } : undefined}
    >
      <Roster />
      <Stage />
    </div>
  );
}

function TitleBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = useOffice((state) => state.theme);
  const notice = useOffice((state) => (state.notice?.scope === "settings" ? state.notice.message : null));
  const setTheme = useOffice((state) => state.setTheme);
  const modes: ThemeMode[] = ["system", "light", "dark"];
  return (
    <header className="relative z-10 flex h-[42px] shrink-0 items-center gap-2 border-b border-border bg-background px-3.5">
      <div data-tauri-drag-region className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
        <span className="size-2 rounded-full bg-[#e39a45]" />
        StayLit
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted">
        <span className="size-1.5 rounded-full bg-[#7d9a62]" />
        LAN
      </div>
      <Button variant="icon" aria-label="Settings" onClick={() => setSettingsOpen((open) => !open)}>
        <Settings />
      </Button>
      <Button variant="icon" aria-label="Hide" onClick={() => void hideWindow()}>
        <X />
      </Button>
      {settingsOpen ? (
        <div className="absolute top-10 right-3 grid gap-1 rounded-[10px] border border-border bg-card p-2">
          {modes.map((mode) => (
            <Button key={mode} variant={theme === mode ? "solid" : "quiet"} onClick={() => setTheme(mode)}>
              {mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
            </Button>
          ))}
          {notice ? <p className="px-1 text-[11px] text-foreground">{notice}</p> : null}
        </div>
      ) : null}
    </header>
  );
}

export function Home() {
  return (
    <div className="flex h-full min-h-[600px] flex-col bg-background text-foreground">
      <TitleBar />
      <Wash />
    </div>
  );
}
