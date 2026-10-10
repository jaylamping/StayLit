import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { hueHex, lightSwatch } from "@/lib/devices";
import { lastFrame, meterBead, meterShift, meterSpan, watchLeadHue, watchLight } from "@/lib/frames";
import { lampStyle, liveZones, memberSwatch, setLamp, wellFill, wellStyle } from "@/lib/well";
import { kelvinHex, kelvinRangeOf, whiteAt, whitesIn, type KelvinRange, type White } from "@/lib/whites";
import {
  cycleIntervalMs,
  cycleSelection,
  gradientStrip,
  groupPower,
  memberIds,
  useOffice,
  type Light,
  type PaintPatch,
  type SetTarget,
} from "@/store";

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
    const open = state.open;
    if (open.kind === "group" && !look.groupIds.includes(open.groupId)) return null;
    return look.accent;
  });
  const cycleTarget = useOffice((state) => cycleSelection(state).target);
  const strip = useOffice((state) => gradientStrip(state)?.name ?? null);
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

function WhiteTiles({ whites, kelvin, onPick }: { whites: White[]; kelvin: number | undefined; onPick: (kelvin: number) => void }) {
  const current = whiteAt(kelvin, whites);
  if (whites.length === 0) return <p className="mt-1 text-xs text-dim">These lights share no white.</p>;
  return (
    <div className="mt-1">
      <div role="radiogroup" aria-label="White" className="grid grid-cols-[repeat(auto-fill,minmax(80px,1fr))] gap-[5px]">
        {whites.map((white) => {
          const on = current?.kelvin === white.kelvin;
          return (
            <button
              key={white.kelvin}
              type="button"
              role="radio"
              aria-checked={on}
              aria-label={`${white.name} ${white.kelvin}K`}
              className="flex h-10 flex-col items-start justify-between rounded-[8px] px-2 pt-1 pb-[3px] text-left text-[#2a1f16]"
              style={{
                background: kelvinHex(white.kelvin),
                boxShadow: on ? "0 0 0 2px var(--background), 0 0 0 3.5px var(--foreground)" : undefined,
              }}
              onClick={() => onPick(white.kelvin)}
            >
              <span className="text-[10.5px] leading-[1.1] font-medium tracking-[-0.01em]">{white.name}</span>
              <span className="self-end text-[10px] leading-none tabular-nums opacity-65">{white.kelvin}K</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ModeSwitch({ mode, canColor, onPick }: { mode: "color" | "white" | "mixed"; canColor: boolean; onPick: (mode: "color" | "white") => void }) {
  const segment = (value: "color" | "white", label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode === value}
      className={mode === value ? "rounded-[7px] bg-seg-on px-3 py-[5px] text-xs font-medium" : "rounded-[7px] px-3 py-[5px] text-xs font-medium text-muted"}
      onClick={() => onPick(value)}
    >
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Mode" className="flex shrink-0 rounded-[9px] border border-border bg-seg p-0.5">
      {canColor ? segment("color", "Color") : null}
      {segment("white", "White")}
    </div>
  );
}

type Framed = { hue: number; saturation: number; brightness: number; jump: boolean };
type PaintValues = { hue: number; saturation: number; brightness: number; kelvin: number | undefined };
type Mixed = Partial<Record<"hue" | "saturation" | "brightness", boolean>>;

function PaintControls({
  frameId,
  live,
  mode,
  values,
  mixed = {},
  color,
  whites,
  onPaint,
}: {
  frameId: string;
  live: boolean;
  mode: "color" | "white" | "mixed";
  values: PaintValues;
  mixed?: Mixed;
  color: string;
  whites: White[];
  onPaint: (patch: PaintPatch) => void;
}) {
  const frame = useRef(0);
  const queued = useRef<PaintPatch | null>(null);
  const paint = useRef(onPaint);
  useEffect(() => {
    paint.current = onPaint;
  });
  const [draft, setDraft] = useState<{ hue?: number; saturation?: number; brightness?: number }>({});
  const [framed, setFramed] = useState<Framed | null>(null);
  useEffect(() => {
    setDraft((current) => {
      const next = { ...current };
      if (next.hue === values.hue && !mixed.hue) delete next.hue;
      if (next.saturation === values.saturation && !mixed.saturation) delete next.saturation;
      if (next.brightness === values.brightness && !mixed.brightness) delete next.brightness;
      return next;
    });
  }, [values.hue, values.saturation, values.brightness, mixed.hue, mixed.saturation, mixed.brightness]);
  useEffect(() => {
    if (!live) {
      setFramed(null);
      return;
    }
    const seed = lastFrame(frameId);
    setFramed(seed ? { hue: seed.hue, saturation: seed.saturation, brightness: seed.brightness, jump: true } : null);
    return watchLight(frameId, (next) =>
      setFramed((current) => ({
        hue: next.hue,
        saturation: next.saturation,
        brightness: next.brightness,
        jump: !current || Math.abs(next.hue - current.hue) > 180,
      })),
    );
  }, [live, frameId]);
  function queue(patch: { hue?: number; saturation?: number; brightness?: number }) {
    queued.current = { ...queued.current, ...patch };
    setDraft((current) => ({ ...current, ...patch }));
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = queued.current;
      queued.current = null;
      if (next) paint.current(next);
    });
  }
  const shown = live ? framed : null;
  const easing = Boolean(shown && !shown.jump);
  const thumb = live ? "var(--lamp)" : color;
  const hue = shown?.hue ?? draft.hue ?? values.hue;
  const saturation = shown?.saturation ?? draft.saturation ?? values.saturation;
  const brightness = shown?.brightness ?? draft.brightness ?? values.brightness;
  const label = (key: "hue" | "saturation" | "brightness", text: string) => (!shown && draft[key] === undefined && mixed[key] ? "Mixed" : text);
  return (
    <div>
      {mode === "white" ? <WhiteTiles whites={whites} kelvin={values.kelvin} onPick={(kelvin) => onPaint({ mode: "white", kelvin })} /> : null}
      {mode === "mixed" ? <p className="mt-1 text-xs text-dim">Some are in color and some in white. Pick Color or White to set them together.</p> : null}
      {mode === "color" ? (
        <>
          <Slider
            label="Hue"
            value={hue}
            min={0}
            max={360}
            color={thumb}
            track={hueTrack}
            live={easing}
            display={label("hue", `${Math.round(hue)}`)}
            onValueChange={(value) => queue({ hue: value })}
          />
          <Slider
            label="Saturation"
            value={saturation}
            color={thumb}
            live={easing}
            display={label("saturation", `${Math.round(saturation)}%`)}
            onValueChange={(value) => queue({ saturation: value })}
          />
        </>
      ) : null}
      <Slider
        label="Brightness"
        value={brightness}
        color={thumb}
        live={easing}
        display={label("brightness", `${Math.round(brightness)}%`)}
        onValueChange={(value) => queue({ brightness: value })}
      />
    </div>
  );
}

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
  const groupName = groupNames[groupIds.indexOf(groupId ?? "")] ?? null;
  const lit = Boolean(driven && light.on);
  const fill = lit ? "var(--lamp)" : wellFill(light);
  return (
    <div className={lit ? "fx-lamp" : undefined} style={lit ? lampStyle(light.id, accent || wellFill(light)) : undefined}>
      <div className="mb-3.5 flex items-center gap-3">
        <span
          className={lit ? "fx-zones size-11 shrink-0 rounded-[12px]" : "size-11 shrink-0 rounded-[12px]"}
          style={wellStyle(light, fill, { driven: lit, size: 44 })}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold tracking-[-0.01em]">{light.name}</div>
          <p className="truncate text-xs text-muted tabular-nums">{[groupName, lightMeta(light, driven)].filter(Boolean).join(" · ")}</p>
          {notice ? <p className="mt-1 text-xs text-foreground">{notice}</p> : null}
        </div>
        <ModeSwitch mode={light.mode} canColor={light.ability !== "white"} onPick={(mode) => setLightPaint(light.id, { mode })} />
      </div>
      <PaintControls
        frameId={light.id}
        live={lit}
        mode={light.mode}
        values={{ hue: light.hue ?? 0, saturation: light.saturation ?? 0, brightness: light.brightness, kelvin: light.kelvin }}
        color={light.color}
        whites={whitesIn(kelvinRangeOf(light.kelvinRange))}
        onPaint={(patch) => setLightPaint(light.id, patch)}
      />
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

function sharedRange(lights: Light[]): KelvinRange | null {
  if (lights.length === 0) return null;
  let low = 0;
  let high = Number.POSITIVE_INFINITY;
  for (const light of lights) {
    const [min, max] = kelvinRangeOf(light.kelvinRange);
    low = Math.max(low, min);
    high = Math.min(high, max);
  }
  return low <= high ? [low, high] : null;
}

function differs(values: number[]) {
  const [first] = values;
  return first !== undefined && values.some((value) => Math.round(value) !== Math.round(first));
}

function MemberDot({ light, owned, accent }: { light: Light; owned: boolean; accent: string }) {
  if (light.offline || !light.on) return <i className="size-2.5 shrink-0 rounded-[3px]" style={{ boxShadow: "inset 0 0 0 1px var(--border-strong)" }} />;
  const swatch = memberSwatch(light, owned, accent);
  return <i className={swatch.className ? `${swatch.className} size-2.5 shrink-0 rounded-[3px]` : "size-2.5 shrink-0 rounded-[3px]"} style={swatch.style} />;
}

const SetPanel = memo(function SetPanel({ target }: { target: SetTarget }) {
  const members = useOffice(useShallow((state) => memberIds(state, target).flatMap((id) => state.lights.find((light) => light.id === id) ?? [])));
  const roomId = useOffice((state) => state.roomId);
  const name = useOffice((state) =>
    target.kind === "room"
      ? (state.rooms.find((room) => room.id === state.roomId)?.name ?? "Room")
      : (state.groups.find((group) => group.id === target.groupId)?.name ?? "Group"),
  );
  const scope = target.kind === "room" ? roomId : target.groupId;
  const notice = useOffice((state) => (state.notice?.scope === scope ? state.notice.message : null));
  const owned = useOffice((state) => (state.effect && state.effect.roomId === state.roomId ? state.effect.lightIds : null));
  const effectName = useOffice((state) => state.effect?.name ?? null);
  const accent = useOffice((state) => state.effect?.accent ?? "");
  const setSetPaint = useOffice((state) => state.setSetPaint);
  const setSetPower = useOffice((state) => state.setSetPower);
  const selectLight = useOffice((state) => state.selectLight);
  const reachable = members.filter((light) => !light.offline);
  const lead = reachable[0];
  if (!lead) {
    return <p className="text-xs text-dim">{members.length ? `${name} is offline.` : `${name} has no lights yet.`}</p>;
  }
  const onCount = reachable.filter((light) => light.on).length;
  const lit = Boolean(owned && onCount > 0 && reachable.every((light) => owned.includes(light.id)));
  const canColor = reachable.every((light) => light.ability !== "white");
  const mode = reachable.every((light) => light.mode === "white") ? "white" : reachable.every((light) => light.mode === "color") ? "color" : "mixed";
  const colored = reachable.filter((light) => light.mode === "color");
  const base = colored[0] ?? lead;
  const levels = reachable.map((light) => light.brightness);
  const brightness = Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length);
  const kelvins = reachable.map((light) => light.kelvin ?? 3800);
  const kelvin = mode === "white" && !kelvins.some((value) => Math.abs(value - (kelvins[0] ?? 0)) > 50) ? kelvins[0] : undefined;
  const range = sharedRange(reachable);
  const values = { hue: base.hue ?? 0, saturation: base.saturation ?? 0, brightness, kelvin };
  const mixed = {
    hue: differs(colored.map((light) => light.hue ?? 0)),
    saturation: differs(colored.map((light) => light.saturation ?? 0)),
    brightness: differs(levels),
  };
  const color =
    mode === "color" ? lightSwatch({ mode: "color", hue: values.hue, saturation: values.saturation }) : mode === "white" ? kelvinHex(kelvin ?? lead.kelvin ?? 3800) : kelvinHex(4000);
  const power = groupPower(reachable, reachable.map((light) => light.id));
  const summary = lit
    ? `${effectName} · ${brightness}%`
    : onCount === 0
      ? "Off"
      : mode === "mixed" || mixed.brightness || (mode === "white" && kelvin === undefined) || (mode === "color" && (mixed.hue || mixed.saturation))
        ? "Mixed"
        : mode === "white"
          ? `${kelvin}K · ${brightness}%`
          : `Color · ${brightness}%`;
  const lamp = setLamp(reachable, owned);
  const ownedBy = (light: Light) => Boolean(owned?.includes(light.id) && light.on);
  return (
    <div className="set-wash fx-lamp" style={{ "--lamp": lamp ?? "var(--track)", "--wash": lamp ? "14%" : "0%" } as CSSProperties}>
      <div className="mb-3 flex items-center gap-3">
        <span
          className="flex size-11 shrink-0 gap-[2px] overflow-hidden rounded-[12px]"
          style={lamp ? { boxShadow: "0 0 18px color-mix(in srgb, var(--lamp) 28%, transparent)" } : undefined}
          aria-hidden
        >
          {members.slice(0, 8).map((light) => {
            const swatch = memberSwatch(light, ownedBy(light), accent);
            return <i key={light.id} className={swatch.className ? `${swatch.className} flex-1` : "flex-1"} style={swatch.style} />;
          })}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold tracking-[-0.01em]">{name}</div>
          <p className="truncate text-xs text-muted tabular-nums">
            {reachable.length === 1 ? "1 light" : `${reachable.length} lights`} · {summary}
          </p>
        </div>
        <ModeSwitch mode={mode} canColor={canColor} onPick={(next) => setSetPaint(target, { mode: next })} />
        <Switch
          label={`${name} power`}
          checked={power === "on"}
          mixed={power === "mixed"}
          bulb={lamp ? "var(--lamp)" : null}
          onCheckedChange={(on) => setSetPower(target, on)}
        />
      </div>
      {notice ? <p className="-mt-1.5 mb-2 text-xs text-foreground">{notice}</p> : null}
      <div className="mb-2.5 flex flex-wrap gap-1">
        {members.map((light) => (
          <button
            key={light.id}
            type="button"
            className="inline-flex h-6 max-w-40 items-center gap-1.5 rounded-full border border-border px-2 text-[11.5px] font-medium text-muted"
            onClick={() => selectLight(light.id)}
          >
            <MemberDot light={light} owned={ownedBy(light)} accent={accent} />
            <span className="truncate">{light.name}</span>
          </button>
        ))}
      </div>
      <PaintControls
        frameId={lead.id}
        live={lit}
        mode={mode}
        values={values}
        mixed={mixed}
        color={color}
        whites={range ? whitesIn(range) : []}
        onPaint={(patch) => setSetPaint(target, patch)}
      />
    </div>
  );
});

const LookRow = memo(function LookRow({ id }: { id: string }) {
  const look = useOffice((state) => state.looks.find((item) => item.id === id));
  const active = useOffice((state) => {
    const item = state.looks.find((entry) => entry.id === id);
    if (state.selectedLookId !== id || !item) return false;
    const open = state.open;
    if (open.kind === "group" && !item.groupIds.includes(open.groupId)) return false;
    return true;
  });
  const notice = useOffice((state) => (state.notice?.scope === `look:${id}` ? state.notice.message : null));
  const label = useOffice((state) => {
    const item = state.looks.find((entry) => entry.id === id);
    const open = state.open;
    if (open.kind === "group") return state.groups.find((group) => group.id === open.groupId)?.name ?? "";
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
  const open = useOffice((state) => state.open);
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <EffectBand />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_clamp(180px,24vw,230px)]">
        <div className="min-h-0 overflow-auto px-[26px] py-[18px]">
          {open.kind === "light" ? <LightPanel key={open.lightId} id={open.lightId} /> : null}
          {open.kind === "room" ? <SetPanel key="room" target={{ kind: "room" }} /> : null}
          {open.kind === "group" ? <SetPanel key={open.groupId} target={{ kind: "group", groupId: open.groupId }} /> : null}
          {open.kind === "none" ? <p className="text-xs text-dim">Pick a light, a group, or the room to set its color and brightness.</p> : null}
        </div>
        <Looks />
      </div>
    </section>
  );
});
