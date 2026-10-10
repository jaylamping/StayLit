import { lightSwatch, type DeviceColor } from "@/lib/devices";

export type FrameLight = Required<DeviceColor> & { deviceId: string; zones?: Required<DeviceColor>[] };
export type EffectFrame = { kind: string; durationMs: number; intervalMs?: number; lights: FrameLight[] };

export const meterSpan = 90;
export const meterBead = 0.38;

const written = new Set<string>();
const latest = new Map<string, FrameLight>();
const hueWatchers = new Set<(hue: number) => void>();
const lightWatchers = new Map<string, Set<(light: FrameLight) => void>>();
let leadHue: number | null = null;

export const lampVar = (id: string) => `--fx-${id}`;
export const zoneVar = (id: string, index: number) => `--fx-${id}-z${index}`;

export function meterShift(hue: number) {
  return meterBead * 100 - ((360 - hue) * 100) / meterSpan;
}

function put(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
  written.add(name);
}

function unwrap(previous: number | null, hue: number) {
  if (previous === null) return hue;
  const step = ((((hue - previous) % 360) + 540) % 360) - 180;
  return previous + step;
}

export function paintFrame(frame: EffectFrame, leadId: string | undefined, leadStartHue: number | undefined) {
  put("--fx-ms", `${Math.max(0, frame.durationMs)}ms`);
  for (const light of frame.lights) {
    latest.set(light.deviceId, light);
    put(lampVar(light.deviceId), lightSwatch({ ...light, mode: "color" }));
    light.zones?.forEach((zone, index) => put(zoneVar(light.deviceId, index), lightSwatch(zone)));
    lightWatchers.get(light.deviceId)?.forEach((watch) => watch(light));
  }
  const lead = frame.lights.find((light) => light.deviceId === leadId);
  if (!lead || lead.zones) return;
  leadHue = unwrap(leadHue ?? leadStartHue ?? null, lead.hue);
  put("--fx-shift", String(meterShift(leadHue)));
  for (const watch of hueWatchers) watch(lead.hue);
}

export function watchLeadHue(watch: (hue: number) => void) {
  hueWatchers.add(watch);
  return () => {
    hueWatchers.delete(watch);
  };
}

export function watchLight(id: string, watch: (light: FrameLight) => void) {
  const watchers = lightWatchers.get(id) ?? new Set();
  watchers.add(watch);
  lightWatchers.set(id, watchers);
  return () => {
    watchers.delete(watch);
    if (watchers.size === 0) lightWatchers.delete(id);
  };
}

export function lastFrame(id: string) {
  return latest.get(id) ?? null;
}

export function lastFrames() {
  return new Map(latest);
}

export function clearFrames() {
  const style = document.documentElement.style;
  for (const name of written) style.removeProperty(name);
  written.clear();
  latest.clear();
  leadHue = null;
}
