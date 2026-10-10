import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { hueHex } from "@/lib/devices";
import { meterBead, meterShift, meterSpan, watchLeadHue } from "@/lib/frames";
import { lampStyle, liveZones, wellFill, wellStyle } from "@/lib/well";
import { cycleIntervalMs, cycleSelection, useOffice, type Light } from "@/store";

const hueNames: [number, string][] = [
  [0, "Red"],
  [25, "Orange"],
  [45, "Amber"],
  [58, "Yellow"],
  [85, "Lime"],
  [120, "Green"],
  [150, "Mint"],
  [175, "Teal"],
  [195, "Cyan"],
  [212, "Sky"],
  [232, "Blue"],
  [262, "Violet"],
  [285, "Purple"],
  [310, "Magenta"],
  [335, "Pink"],
];

function hueName(hue: number) {
  const h = ((hue % 360) + 360) % 360;
  let best = hueNames[0] ?? [0, "Red"];
  let gap = 360;
  for (const entry of hueNames) {
    const distance = Math.min(Math.abs(entry[0] - h), 360 - Math.abs(entry[0] - h));
    if (distance < gap) {
      gap = distance;
      best = entry;
    }
  }
  return best[1];
}

const hueAt = (hue: number, position: number) => hue + meterSpan * (meterBead - position);
const hueTrack = `linear-gradient(90deg, ${[0, 60, 120, 180, 240, 300, 360].map((hue) => hueHex(hue)).join(", ")})`;
const hueWheel = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, index) => `${hueHex(360 - index * 30)} ${(index * 100) / 12}%`).join(", ")})`;
const kelvinTrack = "linear-gradient(90deg, #ffb46b, #ffe4c8 50%, #e6eeff)";
const idleGlow = "#e39a45";

function lightMeta(light: Light, driven: string | null) {
  if (light.offline) return "Offline";
  if (driven && light.on) return `${driven} · ${light.brightness}%`;
  if (!light.on) return light.mode === "white" ? `${light.kelvin}K · off` : "Off";
  if (light.mode === "white") return `${light.kelvin}K · ${light.brightness}%`;
  if (light.ability === "multizone") return `${light.zones?.length ?? 0} zones · ${light.brightness}%`;
  return `Color · ${light.brightness}%`;
}

function hueLabels(hue: number) {
  return [hueName(hueAt(hue, 0)), hueName(hue), hueName(hueAt(hue, 1))];
}

function MeterScale({ labels, refs }: { labels: string[]; refs?: { current: (HTMLSpanElement | null)[] } }) {
  return (
    <div className="mt-[7px] flex justify-between text-[10.5px] text-dim">
      {labels.map((label, index) => (
        <span
          key={index}
          ref={(node) => {
            if (refs) refs.current[index] = node;
          }}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function CycleMeter({ hue }: { hue: number }) {
  const labels = useRef<(HTMLSpanElement | null)[]>([]);
  useEffect(
    () =>
      watchLeadHue((next) => {
        hueLabels(next).forEach((label, index) => {
          const node = labels.current[index];
          if (node && node.textContent !== label) node.textContent = label;
        });
      }),
    [],
  );
  return (
    <div className="hue-wheel mt-[18px]">
      <div className="hue-meter fx-zones" style={{ backgroundImage: hueWheel, "--shift-from": meterShift(hue) } as CSSProperties}>
        <span className="hue-bead" />
      </div>
      <MeterScale labels={hueLabels(hue)} refs={labels} />
    </div>
  );
}

function GradientMeter({ lead }: { lead: Light | null }) {
  const zones = lead?.zones?.length ? lead.zones : null;
  const live = lead && zones ? liveZones(lead.id, zones, 6) : null;
  return (
    <div className="mt-[18px]">
      <div
        className="hue-meter fx-zones"
        style={{
          ...live?.style,
          background: live ? `linear-gradient(90deg, ${live.stops.join(", ")})` : "linear-gradient(90deg, #3a2418, #b8743c, #f3d7b4, #6e3d2a, #3a2418)",
        }}
      />
      <MeterScale labels={["Zone 1", "", `Zone ${zones?.length ?? ""}`.trim()]} />
    </div>
  );
}

const EffectBand = memo(function EffectBand() {
  const roomId = useOffice((state) => state.roomId);
  const effect = useOffice((state) => state.effect);
  const notice = useOffice((state) => (state.notice?.scope === "effect" ? state.notice.message : null));
  const otherRoom = useOffice((state) =>
    state.effect && state.effect.roomId !== state.roomId ? (state.rooms.find((room) => room.id === state.effect?.roomId)?.name ?? null) : null,
  );
  const lead = useOffice((state) => {
    const id = state.effect?.roomId === state.roomId ? state.effect.lightIds[0] : undefined;
    return id ? (state.lights.find((light) => light.id === id) ?? null) : null;
  });
  const lookAccent = useOffice((state) => {
    const look = state.looks.find((item) => item.id === state.selectedLookId && item.roomId === state.roomId);
    if (!look) return null;
    const page = state.page;
    if (page.kind === "group" && !look.groupIds.includes(page.groupId)) return null;
    return look.accent;
  });
  const cycleTarget = useOffice((state) => cycleSelection(state).target);
  const strip = useOffice((state) =>
    state.lights.find((light) => light.roomId === state.roomId && light.ability === "multizone" && light.live && !light.offline)?.name ?? null,
  );
  const setRoom = useOffice((state) => state.setRoom);
  const startCycle = useOffice((state) => state.startCycle);
  const startGradient = useOffice((state) => state.startGradient);
  const stopEffect = useOffice((state) => state.stopEffect);
  const here = effect?.roomId === roomId ? effect : null;
  const resting = here?.accent || (lead ? wellFill(lead) : null) || lookAccent || idleGlow;
  const lamp = here && lead ? lampStyle(lead.id, resting) : ({ "--lamp": lookAccent ?? idleGlow } as CSSProperties);
  return (
    <div
      className={here ? "fx-band fx-lamp min-h-[158px] shrink-0 border-b border-border px-[26px] pt-[22px] pb-5" : "fx-band min-h-[158px] shrink-0 border-b border-border px-[26px] pt-[22px] pb-5"}
      style={{ ...lamp, "--glow-strength": here ? "30%" : "16%" } as CSSProperties}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          {here ? (
            <>
              <div className="text-[10.5px] font-semibold tracking-[0.1em] uppercase" style={{ color: "color-mix(in srgb, var(--lamp) 45%, #ffffff)" }}>
                Running
              </div>
              <h1 className="mt-1.5 mb-0.5 text-[26px] leading-tight font-semibold tracking-[-0.03em]">{here.name}</h1>
              <p className="text-[13px] text-muted">
                on <b className="font-medium text-foreground">{here.target}</b>
                {here.kind === "color-cycle" ? ` · every ${cycleIntervalMs / 1000} s` : ""}
              </p>
            </>
          ) : (
            <>
              <div className="text-[10.5px] font-semibold tracking-[0.1em] text-muted uppercase">Effects</div>
              <h1 className="mt-1.5 mb-0.5 text-[26px] leading-tight font-semibold tracking-[-0.03em]">Nothing running</h1>
              <p className="text-[13px] text-muted">Lights stay as you set them.</p>
            </>
          )}
          {notice ? <p className="mt-1 text-xs text-foreground">{notice}</p> : null}
        </div>
        {here ? <Button onClick={() => stopEffect()}>Stop</Button> : null}
        {otherRoom && effect && !here ? (
          <Button variant="ghost" onClick={() => setRoom(effect.roomId)}>
            Show {otherRoom}
          </Button>
        ) : null}
      </div>
      {here?.kind === "color-cycle" ? <CycleMeter hue={lead?.hue ?? 30} /> : null}
      {here?.kind === "moving-gradient" ? <GradientMeter lead={lead} /> : null}
      {here ? null : (
        <div className="mt-[18px] flex flex-wrap gap-2">
          <Button variant="ghost" className="h-7 px-3" onClick={() => startCycle()}>
            Color cycle <span className="font-normal text-muted">{cycleTarget}</span>
          </Button>
          {strip ? (
            <Button variant="ghost" className="h-7 px-3" onClick={() => startGradient()}>
              Moving gradient <span className="font-normal text-muted">{strip}</span>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
});

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
    <div>
      {white ? (
        <Slider
          label="Kelvin"
          value={kelvin}
          min={2500}
          max={9000}
          color={light.color}
          track={kelvinTrack}
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
            track={hueTrack}
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

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      className={
        on
          ? "h-6 rounded-full border border-border-strong px-2.5 text-xs font-medium"
          : "h-6 rounded-full px-2.5 text-xs font-medium text-muted"
      }
      onClick={onClick}
    >
      {children}
    </button>
  );
}

const LightPanel = memo(function LightPanel({ id }: { id: string }) {
  const light = useOffice((state) => state.lights.find((item) => item.id === id) ?? null);
  const notice = useOffice((state) => (state.notice?.scope === id ? state.notice.message : null));
  const driven = useOffice((state) =>
    state.effect && state.effect.roomId === state.roomId && state.effect.lightIds.includes(id) ? state.effect.name : null,
  );
  const accent = useOffice((state) => (state.effect?.lightIds.includes(id) ? state.effect.accent : ""));
  const setLightPaint = useOffice((state) => state.setLightPaint);
  const roomIds = useOffice(useShallow((state) => state.rooms.map((room) => room.id)));
  const roomNames = useOffice(useShallow((state) => state.rooms.map((room) => room.name)));
  const groupIds = useOffice(useShallow((state) => state.rooms.find((room) => room.id === light?.roomId)?.groupIds ?? []));
  const groupNames = useOffice(
    useShallow((state) => {
      const ids = state.rooms.find((room) => room.id === light?.roomId)?.groupIds ?? [];
      return ids.map((item) => state.groups.find((group) => group.id === item)?.name ?? item);
    }),
  );
  const groupId = useOffice((state) => state.groups.find((group) => group.lightIds.includes(id))?.id ?? null);
  const assignRoom = useOffice((state) => state.assignRoom);
  const assignGroup = useOffice((state) => state.assignGroup);
  const [moving, setMoving] = useState(false);
  if (!light) return null;
  const white = light.mode === "white";
  const groupName = groupNames[groupIds.indexOf(groupId ?? "")] ?? null;
  const lit = Boolean(driven && light.on);
  const fill = lit ? "var(--lamp)" : wellFill(light);
  return (
    <div>
      <div className="mb-3.5 flex items-center gap-3">
        <span
          className={lit ? "fx-lamp fx-zones size-11 shrink-0 rounded-[12px]" : "size-11 shrink-0 rounded-[12px]"}
          style={lit ? { ...lampStyle(light.id, accent || wellFill(light)), ...wellStyle(light, fill, { driven: true, size: 44 }) } : wellStyle(light, fill, { size: 44 })}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold tracking-[-0.01em]">{light.name}</div>
          <p className="truncate text-xs text-muted tabular-nums">{[groupName, lightMeta(light, driven)].filter(Boolean).join(" · ")}</p>
          {notice ? <p className="mt-1 text-xs text-foreground">{notice}</p> : null}
        </div>
        <div role="radiogroup" aria-label="Mode" className="flex shrink-0 rounded-[9px] border border-border bg-seg p-0.5">
          {light.ability === "white" ? null : (
            <button
              type="button"
              role="radio"
              aria-checked={!white}
              className={white ? "rounded-[7px] px-3 py-[5px] text-xs font-medium text-muted" : "rounded-[7px] bg-seg-on px-3 py-[5px] text-xs font-medium"}
              onClick={() => setLightPaint(light.id, { mode: "color" })}
            >
              Color
            </button>
          )}
          <button
            type="button"
            role="radio"
            aria-checked={white}
            className={white ? "rounded-[7px] bg-seg-on px-3 py-[5px] text-xs font-medium" : "rounded-[7px] px-3 py-[5px] text-xs font-medium text-muted"}
            onClick={() => setLightPaint(light.id, { mode: "white" })}
          >
            White
          </button>
        </div>
      </div>
      <PaintSliders light={light} />
      <div className="mt-[18px] flex items-center gap-3.5">
        <span className="text-xs font-medium text-muted">Group</span>
        <span className="inline-flex h-6 items-center rounded-full border border-border-strong px-[11px] text-xs font-medium">{groupName ?? "None"}</span>
        <button type="button" aria-expanded={moving} className="text-xs font-medium text-muted" onClick={() => setMoving((open) => !open)}>
          Move…
        </button>
      </div>
      {moving ? (
        <div className="mt-2.5 grid gap-1.5">
          {groupIds.length ? (
            <div className="flex flex-wrap gap-1">
              {groupIds.map((item, index) => (
                <Chip key={item} on={groupId === item} onClick={() => assignGroup(light.id, item)}>
                  {groupNames[index] ?? item}
                </Chip>
              ))}
              <Chip on={groupId === null} onClick={() => assignGroup(light.id, null)}>
                No group
              </Chip>
            </div>
          ) : null}
          {roomIds.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {roomIds.map((roomId, index) => (
                <Chip key={roomId} on={roomId === light.roomId} onClick={() => assignRoom(light.id, roomId)}>
                  {roomNames[index] ?? roomId}
                </Chip>
              ))}
            </div>
          ) : null}
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
  const notice = useOffice((state) => (state.notice?.scope === `look:${id}` ? state.notice.message : null));
  const label = useOffice((state) => {
    const item = state.looks.find((entry) => entry.id === id);
    const page = state.page;
    if (page.kind === "group") return state.groups.find((group) => group.id === page.groupId)?.name ?? "";
    return (item?.groupIds ?? []).map((groupId) => state.groups.find((group) => group.id === groupId)?.name ?? groupId).join(", ");
  });
  const selectLook = useOffice((state) => state.selectLook);
  if (!look) return null;
  return (
    <button
      type="button"
      className={active ? "mt-1 flex w-full items-center gap-2.5 rounded-[9px] bg-raise p-2 text-left" : "mt-1 flex w-full items-center gap-2.5 rounded-[9px] p-2 text-left"}
      onClick={() => selectLook(look.id)}
    >
      <span className="flex shrink-0 gap-[3px]">
        {look.chips.map((chip, index) => (
          <i
            key={`${look.id}-${index}`}
            className="h-[18px] w-[9px] rounded-[3px]"
            style={chip.off ? { background: "var(--track)" } : { background: chip.color }}
          />
        ))}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{look.name}</span>
        <span className="block truncate text-[11px] text-dim">{label}</span>
        {notice ? <span className="block text-[11px] text-foreground">{notice}</span> : null}
      </span>
    </button>
  );
});

const Looks = memo(function Looks() {
  const lookIds = useOffice(useShallow((state) => state.looks.filter((look) => look.roomId === state.roomId).map((look) => look.id)));
  const running = useOffice((state) => (state.effect?.roomId === state.roomId ? state.effect : null));
  const stops = running ? `${running.kind === "color-cycle" ? "the cycle" : "the gradient"} on ${running.target}` : "a running effect";
  return (
    <aside className="min-h-0 overflow-auto border-l border-border px-4 py-[18px]">
      <h2 className="text-[10.5px] font-semibold tracking-[0.1em] text-muted uppercase">Looks</h2>
      {lookIds.map((id) => (
        <LookRow key={id} id={id} />
      ))}
      <Button variant="quiet" className="mx-2 my-2.5">
        Save this look
      </Button>
      <p className="mt-3.5 text-[11px] leading-[1.45] text-dim">Applying a look stops {stops}.</p>
    </aside>
  );
});

export const Stage = memo(function Stage() {
  const selectedId = useOffice((state) => state.selectedLightId);
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <EffectBand />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(180px,24vw,230px)]">
        <div className="min-h-0 overflow-auto px-[26px] py-[18px]">
          {selectedId ? <LightPanel id={selectedId} /> : <p className="text-xs text-dim">Pick a light to set its color and brightness.</p>}
        </div>
        <Looks />
      </div>
    </section>
  );
});
