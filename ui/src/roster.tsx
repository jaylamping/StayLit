import { ChevronDown } from "lucide-react";
import { memo, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { zoneVar } from "@/lib/frames";
import { cn } from "@/lib/utils";
import { lampStyle, sampleIndexes, setLamp, wellFill, wellStyle } from "@/lib/well";
import { groupCount, groupPower, isCandle, memberIds, openLightId, useOffice, type Light, type OfficeState, type SetTarget } from "@/store";

function meta(light: Light, driven: string | null) {
  if (light.offline) return "Offline";
  if (driven && light.on) return light.ability === "multizone" && light.mode !== "white" ? driven : `${driven} · ${light.brightness}%`;
  if (!light.on) return light.mode === "white" ? `${light.kelvin}K · off` : "Off";
  if (light.mode === "white") return `${light.kelvin}K · ${light.brightness}%`;
  if (light.ability === "multizone") return light.zones?.length ? null : "On";
  return `Color · ${light.brightness}%`;
}

function foldMeta(lights: Light[], driven: string | null) {
  const reachable = lights.filter((light) => !light.offline);
  if (reachable.length === 0) return "Offline";
  const lit = reachable.filter((light) => light.on);
  if (lit.length === 0) return "Off";
  const levels = lit.map((light) => light.brightness);
  const low = Math.min(...levels);
  const high = Math.max(...levels);
  const level = low === high ? `${low}%` : `${low}–${high}%`;
  if (driven) return `${driven} · ${level}`;
  const kelvins = new Set(lit.map((light) => (light.mode === "white" ? light.kelvin : null)));
  const [kelvin] = kelvins;
  const mode = kelvins.size === 1 ? (kelvin ? `${kelvin}K` : "Color") : "Mixed";
  return `${mode} · ${level}`;
}

function headerStyle(open: boolean, lamp: string | null): CSSProperties | undefined {
  const tone = lamp ? ({ "--lamp": lamp } as CSSProperties) : undefined;
  if (!open) return tone;
  if (!lamp) return { background: "color-mix(in srgb, var(--foreground) 7%, transparent)", boxShadow: "inset 2px 0 0 var(--foreground)" };
  return {
    ...tone,
    background: "linear-gradient(90deg, color-mix(in srgb, var(--lamp) 18%, transparent), color-mix(in srgb, var(--lamp) 6%, transparent))",
    boxShadow: "inset 2px 0 0 var(--lamp)",
  };
}

function openLamp(state: OfficeState, target: SetTarget) {
  const lights = memberIds(state, target).flatMap((id) => state.lights.find((light) => light.id === id) ?? []);
  return setLamp(lights, state.effect && state.effect.roomId === state.roomId ? state.effect.lightIds : null);
}

function rowStyle(highlight: string | null, open: boolean): CSSProperties | undefined {
  if (highlight) {
    return {
      background: `linear-gradient(90deg, color-mix(in srgb, ${highlight} 18%, transparent), color-mix(in srgb, ${highlight} 6%, transparent))`,
      boxShadow: `inset 2px 0 0 ${highlight}`,
    };
  }
  return open ? { background: "color-mix(in srgb, var(--foreground) 4%, transparent)" } : undefined;
}

const LightRow = memo(function LightRow({ id, sub = false }: { id: string; sub?: boolean }) {
  const light = useOffice((state) => state.lights.find((item) => item.id === id));
  const selected = useOffice((state) => openLightId(state) === id);
  const notice = useOffice((state) => (state.notice?.scope === id ? state.notice.message : null));
  const driven = useOffice((state) =>
    state.effect && state.effect.roomId === state.roomId && state.effect.lightIds.includes(id) ? state.effect.name : null,
  );
  const accent = useOffice((state) => (state.effect?.lightIds.includes(id) ? state.effect.accent : ""));
  const setPower = useOffice((state) => state.setPower);
  const selectLight = useOffice((state) => state.selectLight);
  if (!light) return null;
  const lit = Boolean(driven && light.on);
  const fill = lit ? "var(--lamp)" : wellFill(light);
  const moving = driven === "Moving gradient" && light.ability === "multizone";
  const line = meta(light, driven);
  const rowClass = sub ? "flex items-center gap-2.5 rounded-[10px] py-0.5 pr-2 pl-[50px]" : "flex items-center gap-2.5 rounded-[10px] px-2 py-1.5";
  return (
    <li>
      <div
        className={lit ? `${rowClass} fx-lamp` : rowClass}
        style={lit ? { ...lampStyle(light.id, accent || wellFill(light)), ...rowStyle(fill, false) } : rowStyle(null, selected)}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => selectLight(light.id)}>
          <span
            className={cn(sub ? "size-5 shrink-0 rounded-[6px]" : "size-8 shrink-0 rounded-[9px]", lit && "fx-zones")}
            style={wellStyle(light, fill, { driven: lit })}
          />
          <span className="min-w-0 flex-1">
            <span
              className={
                light.offline
                  ? "block truncate text-[13px] text-muted"
                  : sub
                    ? "block truncate text-xs font-medium"
                    : "block truncate text-[13px] font-medium"
              }
            >
              {light.name}
            </span>
            {line ? <span className="mt-px block text-[11.5px] text-muted tabular-nums">{line}</span> : null}
            {notice ? <span className="block text-[11px] text-foreground">{notice}</span> : null}
            {light.zones && light.ability === "multizone" && !sub ? (
              <span className={moving ? "zone-bar moving" : "zone-bar"}>
                {sampleIndexes(light.zones.length, 10).map((zone) => (
                  <i
                    key={`${light.id}-${zone}`}
                    className={lit ? "fx-zones" : undefined}
                    style={{
                      backgroundColor: lit ? `var(${zoneVar(light.id, zone)}, ${light.zones?.[zone]})` : light.zones?.[zone],
                      opacity: light.on ? 1 : 0.35,
                    }}
                  />
                ))}
              </span>
            ) : null}
          </span>
        </button>
        {light.offline ? (
          <span className="w-[34px]" />
        ) : (
          <Switch label={`${light.name} power`} checked={light.on} bulb={fill} vivid={lit} onCheckedChange={(on) => setPower(light.id, on)} />
        )}
      </div>
    </li>
  );
});

const CandleFold = memo(function CandleFold({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const lights = useOffice(useShallow((state) => ids.flatMap((id) => state.lights.find((light) => light.id === id) ?? [])));
  const selected = useOffice((state) => ids.includes(openLightId(state) ?? ""));
  const driven = useOffice((state) =>
    state.effect && state.effect.roomId === state.roomId && ids.some((id) => state.effect?.lightIds.includes(id)) ? state.effect.name : null,
  );
  const owned = useOffice(useShallow((state) => ids.filter((id) => state.effect?.lightIds.includes(id))));
  const accent = useOffice((state) => state.effect?.accent ?? "");
  const setPower = useOffice((state) => state.setPower);
  const reachable = lights.filter((light) => !light.offline);
  const onCount = reachable.filter((light) => light.on).length;
  const first = reachable.find((light) => owned.includes(light.id)) ?? reachable[0] ?? lights[0];
  const lit = Boolean(driven && first && owned.includes(first.id) && onCount > 0);
  const fill = lit ? "var(--lamp)" : first ? wellFill(first) : "#ffbe7a";
  const rowClass = "flex items-center gap-2.5 rounded-[10px] px-2 py-1.5";
  return (
    <>
      <li>
        <div
          className={lit ? `${rowClass} fx-lamp` : rowClass}
          style={lit && first ? { ...lampStyle(first.id, accent || wellFill(first)), ...rowStyle(fill, false) } : rowStyle(null, selected && !open)}
        >
          <button
            type="button"
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="flex w-8 shrink-0 gap-[3px]">
              {lights.slice(0, 3).map((light) => {
                const live = Boolean(driven && light.on && owned.includes(light.id));
                return (
                  <i
                    key={light.id}
                    className={cn("h-8 flex-1 rounded-[5px]", live && "fx-lamp")}
                    style={
                      live
                        ? { ...lampStyle(light.id, accent || wellFill(light)), ...wellStyle(light, "var(--lamp)", { driven: true }) }
                        : wellStyle(light, wellFill(light))
                    }
                  />
                );
              })}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">
                Candles <span className="font-normal text-dim">×{lights.length}</span>
              </span>
              <span className="mt-px block text-[11.5px] text-muted tabular-nums">{foldMeta(lights, driven)}</span>
            </span>
          </button>
          {reachable.length ? (
            <Switch
              label="Candles power"
              checked={onCount === reachable.length}
              mixed={onCount > 0 && onCount < reachable.length}
              bulb={fill}
              vivid={lit}
              onCheckedChange={(on) => {
                for (const light of reachable) if (light.on !== on) setPower(light.id, on);
              }}
            />
          ) : (
            <span className="w-[34px]" />
          )}
        </div>
      </li>
      {open ? ids.map((id) => <LightRow key={id} id={id} sub />) : null}
    </>
  );
});

const GroupBlock = memo(function GroupBlock({ groupId }: { groupId: string }) {
  const name = useOffice((state) => state.groups.find((group) => group.id === groupId)?.name ?? groupId);
  const lightIds = useOffice(useShallow((state) => state.groups.find((group) => group.id === groupId)?.lightIds ?? []));
  const candleIds = useOffice(
    useShallow((state) => {
      const ids = state.groups.find((group) => group.id === groupId)?.lightIds ?? [];
      return ids.filter((id) => {
        const light = state.lights.find((item) => item.id === id);
        return light ? isCandle(light) : false;
      });
    }),
  );
  const summary = useOffice((state) => {
    const ids = state.groups.find((group) => group.id === groupId)?.lightIds ?? [];
    return `${groupPower(state.lights, ids)}:${groupCount(state.lights, ids)}`;
  });
  const notice = useOffice((state) => (state.notice?.scope === groupId ? state.notice.message : null));
  const isOpen = useOffice((state) => state.open.kind === "group" && state.open.groupId === groupId);
  const lamp = useOffice((state) => openLamp(state, { kind: "group", groupId }));
  const openGroup = useOffice((state) => state.openGroup);
  const setGroupPower = useOffice((state) => state.setGroupPower);
  const [power, count] = summary.split(":");
  const [onCount, total] = (count ?? "0/0").split("/");
  const on = Number(onCount);
  const reachable = Number(total);
  const fold = candleIds.length >= 2;
  const rows = lightIds.flatMap((id) => {
    if (!fold || !candleIds.includes(id)) return [<LightRow key={id} id={id} />];
    return id === candleIds[0] ? [<CandleFold key="candles" ids={candleIds} />] : [];
  });
  return (
    <section>
      <div className={lamp ? "fx-lamp mt-1.5 flex items-center gap-2 rounded-[8px] px-2 py-1" : "mt-1.5 flex items-center gap-2 rounded-[8px] px-2 py-1"} style={headerStyle(isOpen, lamp)}>
        <button
          type="button"
          aria-pressed={isOpen}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left"
          onClick={() => openGroup(groupId)}
        >
          <span className={isOpen ? "text-[10.5px] font-semibold tracking-[0.1em] text-foreground uppercase" : "text-[10.5px] font-semibold tracking-[0.1em] text-muted uppercase"}>
            {name}
          </span>
          <span className="text-[11px] text-dim tabular-nums">
            {lightIds.length === 0 ? "Empty" : reachable <= 1 ? (on > 0 ? "On" : "Off") : `${on} of ${reachable}`}
          </span>
          {notice ? <span className="ml-auto max-w-28 truncate text-[11px] text-foreground">{notice}</span> : null}
        </button>
        {lightIds.length ? (
          <Switch
            label={`${name} power`}
            checked={power === "on"}
            mixed={power === "mixed"}
            bulb={lamp ? "var(--lamp)" : null}
            onCheckedChange={(next) => setGroupPower(groupId, next)}
          />
        ) : null}
      </div>
      <ul>{rows}</ul>
    </section>
  );
});

function RoomMenu({ roomName, onOff }: { roomName: string; onOff: () => void }) {
  const [open, setOpen] = useState(false);
  const roomIds = useOffice(useShallow((state) => state.rooms.map((room) => room.id)));
  const names = useOffice(useShallow((state) => state.rooms.map((room) => room.name)));
  const roomId = useOffice((state) => state.roomId);
  const roomOpen = useOffice((state) => state.open.kind === "room");
  const lamp = useOffice((state) => (state.open.kind === "room" ? openLamp(state, { kind: "room" }) : null));
  const openRoom = useOffice((state) => state.openRoom);
  const setRoom = useOffice((state) => state.setRoom);
  const hasLiving = useOffice((state) => state.rooms.some((room) => room.id === "living"));
  const addLivingRoom = useOffice((state) => state.addLivingRoom);
  const pick = (run: () => void) => {
    run();
    setOpen(false);
  };
  return (
    <div className="relative flex items-center justify-between px-1.5 pb-2.5">
      <div className="-ml-1.5 flex items-center">
        <button
          type="button"
          aria-pressed={roomOpen}
          className={lamp ? "fx-lamp rounded-[8px] px-1.5 py-0.5 text-sm font-semibold tracking-[-0.01em]" : "rounded-[8px] px-1.5 py-0.5 text-sm font-semibold tracking-[-0.01em]"}
          style={headerStyle(roomOpen, lamp)}
          onClick={() => openRoom()}
        >
          {roomName}
        </button>
        <button
          type="button"
          aria-label="Rooms"
          aria-haspopup="menu"
          aria-expanded={open}
          className="grid size-6 place-items-center rounded-[6px] text-muted"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown className="size-3" strokeWidth={1.8} />
        </button>
      </div>
      <Button variant="ghost" onClick={onOff}>
        {roomName} off
      </Button>
      {open ? (
        <div role="menu" className="absolute top-8 left-0 z-20 grid min-w-44 gap-0.5 rounded-[12px] border border-border bg-card p-1.5 shadow-[0_12px_32px_rgba(0,0,0,.35)]">
          {roomIds.map((id, index) => (
            <button
              key={id}
              type="button"
              role="menuitem"
              className={id === roomId ? "rounded-[8px] bg-seg-on px-2.5 py-1.5 text-left text-[13px] font-medium" : "rounded-[8px] px-2.5 py-1.5 text-left text-[13px] font-medium text-muted"}
              onClick={() => pick(() => setRoom(id))}
            >
              {names[index]}
            </button>
          ))}
          {hasLiving ? null : (
            <button type="button" role="menuitem" className="rounded-[8px] px-2.5 py-1.5 text-left text-[13px] font-medium text-muted" onClick={() => pick(addLivingRoom)}>
              Add Living room
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Loose({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  const names = useOffice(useShallow((state) => ids.map((id) => state.lights.find((light) => light.id === id)?.name ?? id)));
  if (ids.length === 0) return null;
  return (
    <div className="shrink-0 pt-2">
      {open ? (
        <ul className="mb-1 max-h-48 overflow-auto">
          {ids.map((id) => (
            <LightRow key={id} id={id} />
          ))}
        </ul>
      ) : null}
      <button type="button" aria-expanded={open} className="px-2 text-left text-[11px] text-dim" onClick={() => setOpen((value) => !value)}>
        {names.join(", ")} · not grouped
      </button>
    </div>
  );
}

export const Roster = memo(function Roster() {
  const roomId = useOffice((state) => state.roomId);
  const roomName = useOffice((state) => state.rooms.find((room) => room.id === roomId)?.name ?? "Office");
  const groupIds = useOffice(useShallow((state) => state.rooms.find((item) => item.id === state.roomId)?.groupIds ?? []));
  const notice = useOffice((state) => (state.notice?.scope === roomId ? state.notice.message : null));
  const roomCount = useOffice((state) => state.lights.filter((light) => light.roomId === state.roomId).length);
  const anyLights = useOffice((state) => state.lights.length > 0);
  const looseIds = useOffice(
    useShallow((state) => {
      const room = state.rooms.find((item) => item.id === state.roomId);
      const taken = new Set(
        state.groups.filter((group) => room?.groupIds.includes(group.id)).flatMap((group) => group.lightIds),
      );
      return state.lights.filter((light) => light.roomId === state.roomId && !taken.has(light.id)).map((light) => light.id);
    }),
  );
  const roomOff = useOffice((state) => state.roomOff);
  return (
    <aside className="flex w-[min(318px,34vw)] shrink-0 flex-col border-r border-border bg-panel px-2.5 py-3">
      <RoomMenu roomName={roomName} onOff={roomOff} />
      {notice ? <p className="px-2 text-[11px] text-foreground">{notice}</p> : null}
      <div className="min-h-0 flex-1 overflow-auto">
        {roomCount === 0 ? (
          <p className="px-2 text-[13px] text-muted">{anyLights ? "No lights in this room." : "Looking for lights."}</p>
        ) : null}
        {groupIds.map((id) => (
          <GroupBlock key={id} groupId={id} />
        ))}
      </div>
      <Loose ids={looseIds} />
    </aside>
  );
});
