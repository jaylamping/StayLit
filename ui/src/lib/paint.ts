import { clampKelvin, kelvinRangeOf } from "./whites.ts";

export type PaintPatch = { mode?: "color" | "white"; hue?: number; saturation?: number; kelvin?: number; brightness?: number };

type Paintable = {
  ability: "color" | "white" | "multizone";
  mode: "color" | "white";
  hue?: number;
  saturation?: number;
  kelvin?: number;
  brightness: number;
  kelvinRange?: [number, number];
};

export function nextPaint(light: Paintable, patch: PaintPatch) {
  const mode = light.ability === "white" ? "white" : (patch.mode ?? light.mode);
  const hue = patch.hue ?? light.hue ?? 0;
  const held = patch.saturation ?? light.saturation ?? 0;
  const saturation = mode === "color" && patch.hue !== undefined && patch.saturation === undefined && held < 2 ? 100 : held;
  const kelvin = clampKelvin(patch.kelvin ?? light.kelvin ?? 3800, kelvinRangeOf(light.kelvinRange));
  const brightness = patch.brightness ?? light.brightness;
  return { mode, hue, saturation, kelvin, brightness };
}

function channels(hex: string) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return [match[1], match[2], match[3]].map((part) => parseInt(part ?? "0", 16));
}

export function blendHex(colors: string[]) {
  const parsed = colors.flatMap((color) => {
    const rgb = channels(color);
    return rgb ? [rgb] : [];
  });
  if (parsed.length === 0) return null;
  const mean = [0, 1, 2].map((index) => Math.round(parsed.reduce((sum, rgb) => sum + (rgb[index] ?? 0), 0) / parsed.length));
  return `#${mean.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function lampFor(members: { id: string; fill: string; lit: boolean; owned: boolean }[]) {
  const lit = members.filter((member) => member.lit);
  const blend = blendHex(lit.map((member) => member.fill));
  if (!blend) return null;
  const owned = lit.filter((member) => member.owned);
  const rest = blendHex(lit.filter((member) => !member.owned).map((member) => member.fill));
  return {
    blend,
    ownedId: owned[0]?.id ?? null,
    ownedShare: Math.round((owned.length / lit.length) * 100),
    rest,
  };
}

export function switchFill({ checked, mixed = false, bulb, vivid = false }: { checked: boolean; mixed?: boolean; bulb?: string | null; vivid?: boolean }) {
  if (!checked && !mixed) return undefined;
  const tint = bulb || "#e39a45";
  const strength = mixed ? 18 : vivid ? 100 : 52;
  return `color-mix(in srgb, ${tint} ${strength}%, var(--track))`;
}
