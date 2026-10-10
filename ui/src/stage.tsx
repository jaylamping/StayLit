import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cycleSelection, useOffice, type Light } from "@/store";

function lightMeta(light: Light) {
  if (light.offline) return "Offline";
  if (!light.on) return light.mode === "white" ? `${light.kelvin}K · off` : "Off";
  if (light.mode === "white") return `${light.kelvin}K · ${light.brightness}%`;
  if (light.ability === "multizone") return "On";
  return `Color · ${light.brightness}%`;
}

function HueMeter({ accent }: { accent: string }) {
  return (
    <div className="mt-3 max-w-[520px]">
      <div className="hue-meter" style={{ "--meter": accent } as CSSProperties}>
        <span className="hue-bead" />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>Violet</span>
        <span>Blue</span>
        <span>Teal</span>
      </div>
    </div>
  );
}

const PaintSliders = memo(function PaintSliders({ light }: { light: Light }) {
  const setLightPaint = useOffice((state) => state.setLightPaint);
  const frame = useRef(0);
  const queued = useRef<{ hue?: number; saturation?: number; kelvin?: number; brightness?: number } | null>(null);
  const [draft, setDraft] = useState<{ hue?: number; saturation?: number; kelvin?: number; brightness?: number }>({});
  useEffect(() => {
    setDraft((current) => {
      const next = { ...current };
      if (next.hue === light.hue) delete next.hue;
      if (next.saturation === light.saturation) delete next.saturation;
      if (next.kelvin === light.kelvin) delete next.kelvin;
      if (next.brightness === light.brightness) delete next.brightness;
      return next;
    });
  }, [light.hue, light.saturation, light.kelvin, light.brightness]);
  function queue(patch: { hue?: number; saturation?: number; kelvin?: number; brightness?: number }) {
    queued.current = { ...queued.current, ...patch };
    setDraft((current) => ({ ...current, ...patch }));
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = queued.current;
      queued.current = null;
      if (next) setLightPaint(light.id, next);
    });
  }
  const white = light.mode === "white";
  const hue = draft.hue ?? light.hue ?? 0;
  const saturation = draft.saturation ?? light.saturation ?? 0;
  const kelvin = draft.kelvin ?? light.kelvin ?? 3800;
  const brightness = draft.brightness ?? light.brightness;
  return (
    <div className="mt-3 grid gap-3">
      {white ? (
        <Slider
          label="Kelvin"
          value={kelvin}
          min={2500}
          max={9000}
          color="linear-gradient(90deg, #e7a15a, #f7f4ef)"
          display={`${Math.round(kelvin)}K`}
          onValueChange={(value) => queue({ kelvin: value })}
        />
      ) : (
        <>
          <Slider
            label="Hue"
            value={hue}
            min={0}
            max={360}
            color={light.color}
            display={`${Math.round(hue)}`}
            onValueChange={(value) => queue({ hue: value })}
          />
          <Slider
            label="Saturation"
            value={saturation}
            color={light.color}
            display={`${Math.round(saturation)}%`}
            onValueChange={(value) => queue({ saturation: value })}
          />
        </>
      )}
      <Slider
        label="Brightness"
        value={brightness}
        color={light.color}
        display={`${Math.round(brightness)}%`}
        onValueChange={(value) => queue({ brightness: value })}
      />
    </div>
  );
});

const LightCard = memo(function LightCard({ id }: { id: string }) {
  const light = useOffice((state) => state.lights.find((item) => item.id === id) ?? null);
  const notice = useOffice((state) => (state.notice?.scope === id ? state.notice.message : null));
  const setLightPaint = useOffice((state) => state.setLightPaint);
  const roomIds = useOffice(useShallow((state) => state.rooms.map((room) => room.id)));
  const roomNames = useOffice(useShallow((state) => state.rooms.map((room) => room.name)));
  const groupIds = useOffice(useShallow((state) => state.rooms.find((room) => room.id === light?.roomId)?.groupIds ?? []));
  const groupNames = useOffice(useShallow((state) => {
    const ids = state.rooms.find((room) => room.id === light?.roomId)?.groupIds ?? [];
    return ids.map((id) => state.groups.find((group) => group.id === id)?.name ?? id);
  }));
  const groupId = useOffice((state) => state.groups.find((group) => group.lightIds.includes(id))?.id ?? null);
  const assignRoom = useOffice((state) => state.assignRoom);
  const assignGroup = useOffice((state) => state.assignGroup);
  const [moving, setMoving] = useState(false);
  if (!light) return null;
  const white = light.mode === "white";
  const groupName = groupNames[groupIds.indexOf(groupId ?? "")] ?? "No group";
  return (
    <div className="max-w-[560px]">
      <div className="flex items-start gap-3">
        <span
          className="size-11 shrink-0 rounded-[12px]"
          style={
            light.on
              ? { background: light.color, boxShadow: `0 0 16px color-mix(in srgb, ${light.color} 40%, transparent)` }
              : { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${light.color} 75%, transparent)` }
          }
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight">{light.name}</div>
          <p className="text-xs text-muted">{lightMeta(light)}</p>
          {notice ? <p className="mt-1 text-xs text-foreground">{notice}</p> : null}
        </div>
        <div className="flex rounded-full border border-border p-0.5 text-[12px]">
          {light.ability === "white" ? null : (
            <button
              type="button"
              className={white ? "rounded-full px-3 py-1 text-muted" : "rounded-full bg-foreground/10 px-3 py-1"}
              onClick={() => setLightPaint(light.id, { mode: "color" })}
            >
              Color
            </button>
          )}
          <button
            type="button"
            className={white ? "rounded-full bg-foreground/10 px-3 py-1" : "rounded-full px-3 py-1 text-muted"}
            onClick={() => setLightPaint(light.id, { mode: "white" })}
          >
            White
          </button>
        </div>
      </div>
      <PaintSliders light={light} />
      <div className="mt-4 flex items-center gap-2 text-xs text-muted">
        <span>Group</span>
        <span className="rounded-full border border-border px-2.5 py-1 text-foreground">{groupName}</span>
        <button type="button" className="text-muted" onClick={() => setMoving((open) => !open)}>
          Move…
        </button>
      </div>
      {moving ? (
        <div className="mt-2 grid gap-2">
          {groupIds.length ? (
            <div className="flex flex-wrap gap-1">
              <Button variant={groupId === null ? "ghost" : "quiet"} onClick={() => assignGroup(light.id, null)}>
                No group
              </Button>
              {groupIds.map((item, index) => (
                <Button key={item} variant={groupId === item ? "ghost" : "quiet"} onClick={() => assignGroup(light.id, item)}>
                  {groupNames[index]}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {roomIds.map((roomId, index) => (
              <Button key={roomId} variant={roomId === light.roomId ? "ghost" : "quiet"} onClick={() => assignRoom(light.id, roomId)}>
                {roomNames[index]}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});

const LookRow = memo(function LookRow({ id }: { id: string }) {
  const look = useOffice((state) => state.looks.find((item) => item.id === id));
  const active = useOffice((state) => {
    const item = state.looks.find((entry) => entry.id === id);
    if (state.selectedLookId !== id || !item) return false;
    const page = state.page;
    if (page.kind === "group" && !item.groupIds.includes(page.groupId)) return false;
    return true;
  });
  const accent = useOffice((state) => {
    const item = state.looks.find((entry) => entry.id === id);
    if (state.selectedLookId !== id || !item) return null;
    const page = state.page;
    if (page.kind === "group" && !item.groupIds.includes(page.groupId)) return null;
    return state.effect?.roomId === state.roomId ? state.effect.accent : item.accent;
  });
  const notice = useOffice((state) => (state.notice?.scope === `look:${id}` ? state.notice.message : null));
  const label = useOffice((state) => {
    const page = state.page;
    if (page.kind === "group") return state.groups.find((group) => group.id === page.groupId)?.name ?? "";
    return "Desk, Overhead, Strip";
  });
  const selectLook = useOffice((state) => state.selectLook);
  if (!look) return null;
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left"
      style={active && accent ? { background: `color-mix(in srgb, ${accent} 16%, transparent)` } : undefined}
      onClick={() => selectLook(look.id)}
    >
      <span className="flex gap-1">
        {look.chips.map((chip, index) => (
          <span
            key={`${look.id}-${index}`}
            className="size-4 rounded-[5px]"
            style={chip.off ? { boxShadow: "inset 0 0 0 1.5px var(--border)" } : { background: chip.color }}
          />
        ))}
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight">{look.name}</span>
        <span className="block text-xs text-muted">{label}</span>
        {notice ? <span className="block text-xs text-foreground">{notice}</span> : null}
      </span>
    </button>
  );
});

export const Stage = memo(function Stage() {
  const roomId = useOffice((state) => state.roomId);
  const effect = useOffice((state) => state.effect);
  const selectedId = useOffice((state) => state.selectedLightId);
  const notice = useOffice((state) => (state.notice?.scope === "effect" ? state.notice.message : null));
  const lookIds = useOffice(useShallow((state) => state.looks.filter((look) => look.roomId === state.roomId).map((look) => look.id)));
  const otherRoom = useOffice((state) => (state.effect && state.effect.roomId !== state.roomId ? state.rooms.find((room) => room.id === state.effect?.roomId)?.name ?? null : null));
  const setRoom = useOffice((state) => state.setRoom);
  const cycleTarget = useOffice((state) => cycleSelection(state).target);
  const showGradient = useOffice((state) => state.lights.some((light) => light.roomId === state.roomId && light.ability === "multizone"));
  const startCycle = useOffice((state) => state.startCycle);
  const startGradient = useOffice((state) => state.startGradient);
  const stopEffect = useOffice((state) => state.stopEffect);
  const here = effect?.roomId === roomId ? effect : null;
  const band = here?.accent;
  return (
    <section className="flex min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="shrink-0 border-b border-border px-6 py-4"
          style={
            band
              ? { background: `linear-gradient(180deg, color-mix(in srgb, ${band} 32%, transparent), transparent 85%)` }
              : undefined
          }
        >
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              {here ? (
                <>
                  <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Running</p>
                  <h1 className="text-[26px] font-medium tracking-tight">{here.name}</h1>
                  <p className="text-sm text-muted">on {here.target}</p>
                  {here.kind === "color-cycle" ? <HueMeter accent={here.accent} /> : (
                    <div className="mt-3 max-w-[520px] overflow-hidden rounded-full">
                      <div className="effect-zones" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h1 className="text-[26px] font-medium tracking-tight">Nothing running</h1>
                  <p className="mt-1 text-sm text-muted">Lights stay as you set them.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className="rounded-xl border border-border px-3.5 py-2 text-left" onClick={() => startCycle()}>
                      <span className="block text-sm font-semibold">Color cycle</span>
                      <span className="block text-xs text-muted">{cycleTarget}</span>
                    </button>
                    {showGradient ? (
                      <button type="button" className="rounded-xl border border-border px-3.5 py-2 text-left" onClick={() => startGradient()}>
                        <span className="block text-sm font-semibold">Moving gradient</span>
                        <span className="block text-xs text-muted">Lightstrip</span>
                      </button>
                    ) : null}
                  </div>
                </>
              )}
              {notice ? <p className="mt-2 text-sm text-foreground">{notice}</p> : null}
              {otherRoom && effect && !here ? (
                <Button variant="quiet" className="mt-2" onClick={() => setRoom(effect.roomId)}>
                  Show {otherRoom}
                </Button>
              ) : null}
            </div>
            {here ? (
              <Button onClick={() => stopEffect()}>Stop</Button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {selectedId ? <LightCard id={selectedId} /> : null}
        </div>
      </div>
      <aside className="flex w-[210px] shrink-0 flex-col border-l border-border px-3 py-4">
        <h2 className="mb-2 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Looks</h2>
        {lookIds.map((id) => (
          <LookRow key={id} id={id} />
        ))}
        <Button variant="quiet" className="mt-1 px-2">
          Save this look
        </Button>
        <p className="mt-3 text-[11px] text-muted">Applying a look stops the cycle.</p>
      </aside>
    </section>
  );
});
