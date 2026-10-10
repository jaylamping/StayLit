import type { CSSProperties } from "react";
import { lightSwatch } from "@/lib/devices";
import type { Light } from "@/store";

export function wellFill(light: Light, drivenAccent: string | null) {
  if (drivenAccent) return drivenAccent;
  if (light.mode === "white") return lightSwatch({ mode: "white", kelvin: light.kelvin }, light.color);
  return light.color;
}

export function sampleZones(zones: string[], count: number) {
  if (zones.length <= count) return zones;
  return Array.from({ length: count }, (_, index) => zones[Math.round((index * (zones.length - 1)) / (count - 1))] ?? zones[0] ?? "");
}

export function wellStyle(light: Light, fill: string, options: { driven?: boolean; size?: number } = {}): CSSProperties {
  if (light.offline) return { boxShadow: "inset 0 0 0 1px var(--border-strong)" };
  if (!light.on) return { boxShadow: `inset 0 0 0 1.5px color-mix(in srgb, ${fill} 60%, transparent)` };
  const zones = light.ability === "multizone" && light.mode !== "white" ? light.zones : undefined;
  const background = zones?.length ? `linear-gradient(135deg, ${sampleZones(zones, 3).join(", ")})` : fill;
  const spread = options.size && options.size > 32 ? 18 : options.driven ? 14 : 10;
  const glow = options.driven ? 55 : light.brightness >= 70 ? (options.size && options.size > 32 ? 30 : 25) : 0;
  return {
    background,
    opacity: Math.min(1, 0.3 + light.brightness * 0.0125),
    boxShadow: glow ? `0 0 ${spread}px color-mix(in srgb, ${fill} ${glow}%, transparent)` : undefined,
  };
}
