import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <div className="hue-meter mt-6 max-w-[460px]" style={{ "--meter": accent } as CSSProperties}>
      <span className="hue-bead" />
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
          color={light.color}
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
  if (!light) return null;
  const white = light.mode === "white";
  return (
    <Card className="mt-5 max-w-[440px]">
      <div className="text-sm font-semibold tracking-tight">{light.name}</div>
      <p className="mt-0.5 text-xs text-muted">{lightMeta(light)}</p>
      {notice ? <p className="mt-1 text-xs text-foreground">{notice}</p> : null}
      <span
        className="mt-3 block size-10 rounded-[9px]"
        style={
          light.on
            ? { background: light.color, boxShadow: `0 0 14px color-mix(in srgb, ${light.color} 45%, transparent)` }
            : { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${light.color} 75%, transparent)` }
        }
      />
      <div className="mt-3 flex gap-1">
        {light.ability === "white" ? null : (
          <Button variant={white ? "quiet" : "solid"} onClick={() => setLightPaint(light.id, { mode: "color" })}>
            Color
          </Button>
        )}
        <Button variant={white ? "solid" : "quiet"} onClick={() => setLightPaint(light.id, { mode: "white" })}>
          White
        </Button>
      </div>
      <PaintSliders light={light} />
      <div className="mt-3 flex flex-wrap gap-1">
        {roomIds.map((roomId, index) => (
          <Button key={roomId} variant={roomId === light.roomId ? "solid" : "quiet"} onClick={() => assignRoom(light.id, roomId)}>
            {roomNames[index]}
          </Button>
        ))}
      </div>
      {groupIds.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          <Button variant={groupId === null ? "solid" : "quiet"} onClick={() => assignGroup(light.id, null)}>
            No group
          </Button>
          {groupIds.map((item, index) => (
            <Button key={item} variant={groupId === item ? "solid" : "quiet"} onClick={() => assignGroup(light.id, item)}>
              {groupNames[index]}
            </Button>
          ))}
        </div>
      ) : null}
    </Card>
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
  return (
    <section className="min-w-0 flex-1 px-8 py-7">
      {here ? (
        <div>
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Running</p>
          <h1 className="mt-2 text-[28px] font-medium tracking-tight">{here.name}</h1>
          <p className="mt-1 text-sm text-muted">{here.target}</p>
          {here.kind === "color-cycle" ? <HueMeter accent={here.accent} /> : (
            <div className="mt-6 max-w-[460px] overflow-hidden rounded-full">
              <div className="effect-zones" />
            </div>
          )}
          {notice ? <p className="mt-3 text-sm text-foreground">{notice}</p> : null}
          <Button className="mt-6" onClick={() => stopEffect()}>
            Stop
          </Button>
        </div>
      ) : (
        <div>
          <h1 className="text-[28px] font-medium tracking-tight">Nothing running</h1>
          <p className="mt-2 text-sm text-muted">Lights stay as you set them.</p>
          {otherRoom && effect ? (
            <Button variant="quiet" className="mt-3" onClick={() => setRoom(effect.roomId)}>
              Show {otherRoom}
            </Button>
          ) : null}
          {selectedId ? <LightCard id={selectedId} /> : null}
          <div className="mt-6 max-w-[440px]">
            <h2 className="mb-1.5 text-[11px] font-semibold tracking-[0.08em] text-muted uppercase">Looks</h2>
            {lookIds.map((id) => (
              <LookRow key={id} id={id} />
            ))}
            <Button variant="quiet" className="mt-1 px-2">
              Save this look
            </Button>
          </div>
          {notice ? <p className="mt-3 text-sm text-foreground">{notice}</p> : null}
          <div className="mt-4 grid max-w-[440px] gap-2">
            <button type="button" className="rounded-xl border border-border px-3.5 py-3 text-left" onClick={() => startCycle()}>
              <span className="block text-sm font-semibold">Color cycle</span>
              <span className="block text-xs text-muted">{cycleTarget}</span>
            </button>
            {showGradient ? (
              <button type="button" className="rounded-xl border border-border px-3.5 py-3 text-left" onClick={() => startGradient()}>
                <span className="block text-sm font-semibold">Moving gradient</span>
                <span className="block text-xs text-muted">Lightstrip</span>
              </button>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
});
