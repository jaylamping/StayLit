import { X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hideWindow } from "@/lib/lifx";
import { Roster } from "@/roster";
import { Stage } from "@/stage";
import { useOffice, type ThemeMode } from "@/store";

const modes: ThemeMode[] = ["system", "light", "dark"];

function TitleBar() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const theme = useOffice((state) => state.theme);
  const notice = useOffice((state) => (state.notice?.scope === "settings" ? state.notice.message : null));
  const setTheme = useOffice((state) => state.setTheme);
  return (
    <header data-tauri-drag-region className="relative z-10 flex h-10 shrink-0 items-center gap-2.5 border-b border-border pr-2 pl-3.5">
      <div data-tauri-drag-region className="flex items-center gap-[7px] text-[13px] font-semibold tracking-[-0.02em]">
        <span
          className="size-[9px] rounded-full"
          style={{ background: "radial-gradient(circle at 35% 35%, #ffd9a0, #e39a45)", boxShadow: "0 0 8px rgba(227,154,69,.6)" }}
        />
        StayLit
      </div>
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-muted">
        <span className="size-1.5 rounded-full bg-[#b7c49a]" />
        LAN
      </div>
      <Button variant="icon" aria-label="Settings" onClick={() => setSettingsOpen((open) => !open)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round">
          <path d="M2 4h7M12 4h2M2 12h3M8 12h6" />
          <circle cx="10.5" cy="4" r="1.6" />
          <circle cx="6.5" cy="12" r="1.6" />
        </svg>
      </Button>
      <Button variant="icon" aria-label="Hide" onClick={() => void hideWindow()}>
        <X />
      </Button>
      {settingsOpen ? (
        <div className="absolute top-[42px] right-2 w-52 rounded-[12px] border border-border bg-card p-3 shadow-[0_12px_32px_rgba(0,0,0,.35)]">
          <div className="mb-2 text-[10.5px] font-semibold tracking-[0.1em] text-muted uppercase">Theme</div>
          <div className="flex rounded-[9px] border border-border bg-seg p-0.5">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                className={
                  theme === mode
                    ? "flex-1 rounded-[7px] bg-seg-on py-[5px] text-xs font-medium"
                    : "flex-1 rounded-[7px] py-[5px] text-xs font-medium text-muted"
                }
                onClick={() => setTheme(mode)}
              >
                {mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
          {notice ? <p className="mt-2 text-[11px] text-foreground">{notice}</p> : null}
        </div>
      ) : null}
    </header>
  );
}

export function Home() {
  return (
    <div className="flex h-full flex-col overflow-hidden border border-border bg-background text-foreground">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Roster />
        <Stage />
      </div>
    </div>
  );
}
