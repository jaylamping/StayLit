import { ChevronDown } from "lucide-react";
import { memo, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { sampleZones, wellFill, wellStyle } from "@/lib/well";
import { groupCount, groupPower, isCandle, useOffice, type Light } from "@/store";

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
  const selected = useOffice((state) => state.selectedLightId === id);
  const notice = useOffice((state) => (state.notice?.scope === id ? state.notice.message : null));
  const driven = useOffice((state) =>
    state.effect && state.effect.roomId === state.roomId && state.effect.lightIds.includes(id) ? state.effect.name : null,
  );
  const drivenColor = useOffice((state) => (state.effect?.lightIds.includes(id) ? state.effect.accent : null));
  const setPower = useOffice((state) => state.setPower);
  const selectLight = useOffice((state) => state.selectLight);
  if (!light) return null;
  const fill = wellFill(light, drivenColor);
  const lit = Boolean(driven && light.on);
  const moving = driven === "Moving gradient" && light.ability === "multizone";
  const line = meta(light, driven);
  return (
    <li>
      <div
        className={sub ? "flex items-center gap-2.5 rounded-[10px] py-0.5 pr-2 pl-[50px]" : "flex items-center gap-2.5 rounded-[10px] px-2 py-1.5"}
        style={rowStyle(lit ? fill : null, selected)}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => selectLight(light.id)}>
          <span
            className={sub ? "size-5 shrink-0 rounded-[6px]" : "size-8 shrink-0 rounded-[9px]"}
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
                {sampleZones(light.zones, 10).map((zone, index) => (
                  <i key={`${light.id}-${index}`} style={{ background: zone, opacity: light.on ? 1 : 0.35 }} />
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
  const selected = useOffice((state) => ids.includes(state.selectedLightId ?? ""));
  const driven = useOffice((state) =>
    state.effect && state.effect.roomId === state.roomId && ids.some((id) => state.effect?.lightIds.includes(id)) ? state.effect.name : null,
  );
  const drivenColor = useOffice((state) => (state.effect && ids.some((id) => state.effect?.lightIds.includes(id)) ? state.effect.accent : null));
  const setPower = useOffice((state) => state.setPower);
  const reachable = lights.filter((light) => !light.offline);
  const onCount = reachable.filter((light) => light.on).length;
  const lit = Boolean(driven && onCount > 0);
  const first = reachable[0] ?? lights[0];
  const fill = first ? wellFill(first, drivenColor) : "#ffbe7a";
  return (
    <>
      <li>
        <div className="flex items-center gap-2.5 rounded-[10px] px-2 py-1.5" style={rowStyle(lit ? fill : null, selected && !open)}>
          <button
            type="button"
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={() => setOpen((value) => !value)}
          >
            <span className="flex w-8 shrink-0 gap-[3px]">
              {lights.slice(0, 3).map((light) => (
                <i key={light.id} className="h-8 flex-1 rounded-[5px]" style={wellStyle(light, wellFill(light, drivenColor), { driven: lit })} />
              ))}
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
      <div className="flex items-center gap-2 px-2 pt-2.5 pb-1">
        <button type="button" className="text-[10.5px] font-semibold tracking-[0.1em] text-muted uppercase" onClick={() => openGroup(groupId)}>
          {name}
        </button>
        <span className="text-[11px] text-dim tabular-nums">
          {lightIds.length === 0 ? "Empty" : reachable <= 1 ? (on > 0 ? "On" : "Off") : `${on} of ${reachable}`}
        </span>
        <div className="flex-1" />
        {notice ? <span className="max-w-28 truncate text-[11px] text-foreground">{notice}</span> : null}
        {lightIds.length ? (
          <Switch label={`${name} power`} checked={power === "on"} mixed={power === "mixed"} group onCheckedChange={(next) => setGroupPower(groupId, next)} />
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
  const groupLabel = useOffice((state) => {
    const page = state.page;
    if (page.kind !== "group") return null;
    return state.groups.find((group) => group.id === page.groupId)?.name ?? null;
  });
  const setRoom = useOffice((state) => state.setRoom);
  const hasLiving = useOffice((state) => state.rooms.some((room) => room.id === "living"));
  const addLivingRoom = useOffice((state) => state.addLivingRoom);
  const pick = (run: () => void) => {
    run();
    setOpen(false);
  };
  return (
    <div className="relative flex items-center justify-between px-1.5 pb-2.5">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-[-0.01em]"
        onClick={() => setOpen((value) => !value)}
      >
        {roomName}
        {groupLabel ? <span className="font-medium text-muted">· {groupLabel}</span> : null}
        <ChevronDown className="size-3 text-muted" strokeWidth={1.8} />
      </button>
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
  const pageKind = useOffice((state) => state.page.kind);
  const groupIds = useOffice(
    useShallow((state) => {
      const room = state.rooms.find((item) => item.id === state.roomId);
      if (!room) return [];
      const page = state.page;
      if (page.kind === "group" && room.groupIds.includes(page.groupId)) return [page.groupId];
      return room.groupIds;
    }),
  );
  const notice = useOffice((state) => (state.notice?.scope === roomId ? state.notice.message : null));
  const roomCount = useOffice((state) => state.lights.filter((light) => light.roomId === state.roomId).length);
  const anyLights = useOffice((state) => state.lights.length > 0);
  const looseIds = useOffice(
    useShallow((state) => {
      if (state.page.kind === "group") return [];
      const room = state.rooms.find((item) => item.id === state.roomId);
      const taken = new Set(
        state.groups.filter((group) => room?.groupIds.includes(group.id)).flatMap((group) => group.lightIds),
      );
      return state.lights.filter((light) => light.roomId === state.roomId && !taken.has(light.id)).map((light) => light.id);
    }),
  );
  const openRoom = useOffice((state) => state.openRoom);
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
        {pageKind === "group" ? (
          <Button variant="quiet" className="mt-3 px-2" onClick={() => openRoom()}>
            All of {roomName}
          </Button>
        ) : null}
      </div>
      <Loose ids={looseIds} />
    </aside>
  );
});
