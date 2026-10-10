import { memo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { groupCount, groupPower, useOffice, type Light } from "@/store";

function meta(light: Light, driven: string | null) {
  if (light.offline) return "Offline";
  if (driven && light.on) return light.kind === "strip" ? driven : `${driven} · ${light.brightness}%`;
  if (!light.on) return light.kind === "white" ? `${light.kelvin}K · off` : "Off";
  if (light.kind === "white") return `${light.kelvin}K · ${light.brightness}%`;
  if (light.kind === "strip") return "On";
  return `Color · ${light.brightness}%`;
}

const LightRow = memo(function LightRow({ id }: { id: string }) {
  const light = useOffice((state) => state.lights.find((item) => item.id === id));
  const selected = useOffice((state) => state.selectedLightId === id);
  const notice = useOffice((state) => (state.notice?.scope === id ? state.notice.message : null));
  const driven = useOffice((state) =>
    state.effect && state.effect.roomId === state.roomId && state.effect.lightIds.includes(id) ? state.effect.name : null,
  );
  const accent = useOffice((state) =>
    state.selectedLightId === id ? (state.effect?.roomId === state.roomId ? state.effect.accent : (state.looks.find((look) => look.id === state.selectedLookId)?.accent ?? null)) : null,
  );
  const setPower = useOffice((state) => state.setPower);
  const selectLight = useOffice((state) => state.selectLight);
  if (!light) return null;
  const moving = driven === "Moving gradient" && light.kind === "strip";
  return (
    <li>
      <div
        className="mt-0.5 ml-2 flex items-center gap-2.5 rounded-[10px] px-2 py-1.5"
        style={selected && accent ? { background: `color-mix(in srgb, ${accent} 16%, transparent)` } : undefined}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => selectLight(light.id)}>
          <span
            className="size-8 shrink-0 rounded-[9px]"
            style={
              light.offline
                ? { boxShadow: "inset 0 0 0 1px var(--border)" }
                : light.on
                  ? { background: light.color, boxShadow: `0 0 14px color-mix(in srgb, ${light.color} 45%, transparent)` }
                  : { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${light.color} 75%, transparent)` }
            }
          />
          <span className="min-w-0">
            <span className={light.offline ? "block text-[13px] text-muted" : "block text-[13px] font-medium tracking-tight"}>{light.name}</span>
            <span className="block text-[11px] text-muted tabular-nums">{meta(light, driven)}</span>
            {notice ? <span className="block text-[11px] text-foreground">{notice}</span> : null}
            {light.zones ? (
              <span className={moving ? "zone-bar moving" : "zone-bar"}>
                {light.zones.map((zone, index) => (
                  <i key={`${light.id}-${index}`} style={{ background: zone }} />
                ))}
              </span>
            ) : null}
          </span>
        </button>
        {light.offline ? (
          <span className="w-[34px]" />
        ) : (
          <Switch label={`${light.name} power`} checked={light.on} bulb={light.color} onCheckedChange={(on) => setPower(light.id, on)} />
        )}
      </div>
    </li>
  );
});

const GroupBlock = memo(function GroupBlock({ groupId }: { groupId: string }) {
  const name = useOffice((state) => state.groups.find((group) => group.id === groupId)?.name ?? groupId);
  const lightIds = useOffice((state) => state.groups.find((group) => group.id === groupId)?.lightIds);
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
  return (
    <section>
      <div className="flex items-center gap-2 px-2 pt-3 pb-0.5">
        <button type="button" className="text-[11px] font-semibold tracking-[0.08em] text-muted uppercase" onClick={() => openGroup(groupId)}>
          {name}
        </button>
        <span className="text-[11px] text-muted tabular-nums">{on === reachable ? (on > 0 ? "On" : "Off") : `${on} of ${reachable}`}</span>
        <div className="flex-1" />
        {notice ? <span className="max-w-28 truncate text-[11px] text-foreground">{notice}</span> : null}
        <Switch
          label={`${name} power`}
          checked={power === "on"}
          mixed={power === "mixed"}
          group
          onCheckedChange={(next) => setGroupPower(groupId, next)}
        />
      </div>
      <ul>
        {(lightIds ?? []).map((id) => (
          <LightRow key={id} id={id} />
        ))}
      </ul>
    </section>
  );
});

function RoomMenu({ roomName, onOff }: { roomName: string; onOff: () => void }) {
  const [open, setOpen] = useState(false);
  const roomIds = useOffice(useShallow((state) => state.rooms.map((room) => room.id)));
  const names = useOffice(useShallow((state) => state.rooms.map((room) => room.name)));
  const groupLabel = useOffice((state) => {
    const page = state.page;
    if (page.kind !== "group") return null;
    return state.groups.find((group) => group.id === page.groupId)?.name ?? null;
  });
  const setRoom = useOffice((state) => state.setRoom);
  return (
    <>
      <div className="flex items-center gap-2 px-1.5 pb-2">
        <Button variant="ghost" onClick={() => setOpen((value) => !value)}>
          {roomName}
        </Button>
        {groupLabel ? <span className="text-xs text-muted">{groupLabel}</span> : null}
        <Button variant="ghost" className="ml-auto" onClick={onOff}>
          {roomName} off
        </Button>
      </div>
      {open ? (
        <div className="mb-2 grid gap-1 px-1.5">
          {roomIds.map((id, index) => (
            <Button
              key={id}
              variant="quiet"
              onClick={() => {
                setRoom(id);
                setOpen(false);
              }}
            >
              {names[index]}
            </Button>
          ))}
        </div>
      ) : null}
    </>
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
  const looking = useOffice((state) => state.lights.length === 0);
  const openRoom = useOffice((state) => state.openRoom);
  const roomOff = useOffice((state) => state.roomOff);
  return (
    <aside className="w-[360px] shrink-0 overflow-auto border-r border-border px-2.5 py-3">
      <RoomMenu roomName={roomName} onOff={roomOff} />
      {notice ? <p className="px-2 text-[11px] text-foreground">{notice}</p> : null}
      {looking ? <p className="px-2 text-sm text-muted">Looking for lights.</p> : null}
      {looking
        ? null
        : groupIds.map((id) => (
            <GroupBlock key={id} groupId={id} />
          ))}
      {pageKind === "group" ? (
        <Button variant="quiet" className="mt-3 px-2" onClick={() => openRoom()}>
          All of {roomName}
        </Button>
      ) : null}
    </aside>
  );
});
