export type White = { name: string; kelvin: number };
export type KelvinRange = [number, number];

export const whites: White[] = [
  { name: "Candlelight", kelvin: 1500 },
  { name: "Sunset", kelvin: 2000 },
  { name: "Amber", kelvin: 2200 },
  { name: "Ultra Warm", kelvin: 2500 },
  { name: "Incandescent", kelvin: 2700 },
  { name: "Warm", kelvin: 3000 },
  { name: "Neutral Warm", kelvin: 3200 },
  { name: "Neutral", kelvin: 3500 },
  { name: "Cool", kelvin: 4000 },
  { name: "Cool Daylight", kelvin: 4500 },
  { name: "Soft Daylight", kelvin: 5000 },
  { name: "Daylight", kelvin: 5600 },
  { name: "Noon Daylight", kelvin: 6000 },
  { name: "Bright Daylight", kelvin: 6500 },
  { name: "Cloudy Daylight", kelvin: 7000 },
  { name: "Blue Daylight", kelvin: 7500 },
  { name: "Blue Overcast", kelvin: 8000 },
  { name: "Blue Water", kelvin: 8500 },
  { name: "Blue Ice", kelvin: 9000 },
];

export const defaultKelvinRange: KelvinRange = [2500, 9000];

const ramp: [number, [number, number, number]][] = [
  [1500, [255, 128, 46]],
  [2000, [255, 148, 66]],
  [2200, [255, 160, 82]],
  [2500, [255, 176, 104]],
  [2700, [255, 186, 120]],
  [3000, [255, 198, 140]],
  [3200, [255, 206, 154]],
  [3500, [255, 215, 172]],
  [4000, [255, 224, 192]],
  [4500, [255, 231, 208]],
  [5000, [255, 238, 224]],
  [5600, [255, 244, 236]],
  [6000, [255, 248, 244]],
  [6500, [252, 251, 255]],
  [7000, [240, 243, 255]],
  [7500, [229, 235, 255]],
  [8000, [219, 228, 255]],
  [8500, [209, 221, 255]],
  [9000, [199, 214, 255]],
];

function hex(rgb: [number, number, number]) {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

export function kelvinHex(kelvin: number) {
  const first = ramp[0];
  const last = ramp[ramp.length - 1];
  if (!first || !last) return "#ffffff";
  if (kelvin <= first[0]) return hex(first[1]);
  if (kelvin >= last[0]) return hex(last[1]);
  for (let index = 1; index < ramp.length; index += 1) {
    const high = ramp[index];
    const low = ramp[index - 1];
    if (!high || !low || kelvin > high[0]) continue;
    const t = (kelvin - low[0]) / (high[0] - low[0]);
    const [r0, g0, b0] = low[1];
    const [r1, g1, b1] = high[1];
    return hex([r0 + (r1 - r0) * t, g0 + (g1 - g0) * t, b0 + (b1 - b0) * t]);
  }
  return hex(last[1]);
}

export function kelvinRangeOf(range: readonly number[] | null | undefined): KelvinRange {
  const [low, high] = range ?? [];
  if (typeof low !== "number" || typeof high !== "number" || low <= 0 || high < low) return defaultKelvinRange;
  return [low, high];
}

export function whitesIn(range: KelvinRange) {
  return whites.filter((white) => white.kelvin >= range[0] && white.kelvin <= range[1]);
}

export function clampKelvin(kelvin: number, range: KelvinRange) {
  return Math.min(range[1], Math.max(range[0], Math.round(kelvin)));
}

export function whiteAt(kelvin: number | undefined, list: White[]) {
  if (kelvin === undefined) return null;
  return list.find((white) => Math.abs(white.kelvin - kelvin) <= 50) ?? null;
}
