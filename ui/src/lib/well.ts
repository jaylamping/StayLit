import type { CSSProperties } from "react";
import { lightSwatch } from "@/lib/devices";
import { lampVar, zoneVar } from "@/lib/frames";
import type { Light } from "@/store";

export function wellFill(light: Light) {
  if (light.mode === "white") return lightSwatch({ mode: "white", kelvin: light.kelvin }, light.color);
  return light.color;
}

export function sampleIndexes(length: number, count: number) {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  return Array.from({ length: count }, (_, index) => Math.round((index * (length - 1)) / (count - 1)));
}

export function sampleZones(zones: string[], count: number) {
  return sampleIndexes(zones.length, count).map((index) => zones[index] ?? "");
}

export function lampStyle(id: string, fallback: string) {
  return { "--lamp": `var(${lampVar(id)}, ${fallback})` } as CSSProperties;
}

export function liveZones(id: string, zones: string[], count: number) {
  const style: Record<string, string> = {};
  const stops = sampleIndexes(zones.length, count).map((index, slot) => {
    style[`--z${slot + 1}`] = `var(${zoneVar(id, index)}, ${zones[index] ?? "transparent"})`;
    return `var(--z${slot + 1})`;
  });
  return { style: style as CSSProperties, stops };
}

export function wellStyle(light: Light, fill: string, options: { driven?: boolean; size?: number } = {}): CSSProperties {
  if (light.offline) return { boxShadow: "inset 0 0 0 1px var(--border-strong)" };
  if (!light.on) return { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${fill} 60%, transparent)` };
  const zones = light.ability === "multizone" && light.mode !== "white" ? light.zones : undefined;
  const live = options.driven && zones?.length ? liveZones(light.id, zones, 3) : null;
  const background = live
    ? `linear-gradient(135deg, ${live.stops.join(", ")})`
    : zones?.length
      ? `linear-gradient(135deg, ${sampleZones(zones, 3).join(", ")})`
      : fill;
  const spread = options.size && options.size > 32 ? 18 : options.driven ? 14 : 10;
  const glow = options.driven ? 55 : light.brightness >= 70 ? (options.size && options.size > 32 ? 30 : 25) : 0;
  return {
    ...live?.style,
    background,
    opacity: Math.min(1, 0.3 + light.brightness * 0.0125),
    boxShadow: glow ? `0 0 ${spread}px color-mix(in srgb, ${fill} ${glow}%, transparent)` : undefined,
  };
}
