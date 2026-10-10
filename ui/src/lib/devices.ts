import { heldPower, mergeHeld, pendingEdits, type PendingEdit } from "@/lib/edits";
import type { Light } from "@/store";

export type DeviceColor = {
  hue?: number;
  saturation?: number;
  brightness?: number;
  kelvin?: number;
};

export type DeviceSnap = {
  id: string;
  label?: string;
  online?: boolean;
  power?: boolean | null;
  color?: DeviceColor | null;
  zones?: DeviceColor[] | null;
  multizone?: boolean | null;
  hasColor?: boolean | null;
};

function channel(value: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

function kelvinHex(kelvin: number) {
  const t = Math.min(1, Math.max(0, (kelvin - 2500) / 4500));
  return `#${channel(255)}${channel(214 + t * 28)}${channel(170 + t * 70)}`;
}

export function lightSwatch(
  color: DeviceColor & { mode?: Light["mode"] } | null | undefined,
  fallback = "#d9d3cb",
) {
  return colorHex(color, fallback, color?.mode === "color");
}

function colorHex(color: DeviceColor | null | undefined, fallback: string, forceHue = false) {
  if (!color) return fallback;
  const saturation = color.saturation ?? 0;
  if (!forceHue && saturation < 2) return kelvinHex(color.kelvin ?? 3800);
  return hueHex(color.hue ?? 0, saturation);
}

export function hueHex(hueDegrees: number, saturation = 100) {
  const hue = (((hueDegrees % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((hue % 2) - 1);
  const sector = Math.floor(hue);
  const map = [
    [1, x, 0],
    [x, 1, 0],
    [0, 1, x],
    [0, x, 1],
    [x, 0, 1],
    [1, 0, x],
  ][sector] ?? [1, 0, 0];
  const chroma = 0.72;
  const floor = 0.28;
  const mix = (value: number) => channel(255 * (1 - saturation / 100) + (value * chroma + floor) * 255 * (saturation / 100));
  return `#${mix(map[0])}${mix(map[1])}${mix(map[2])}`;
}

export function abilityOf(device: { multizone?: boolean | null; hasColor?: boolean | null }): Light["ability"] {
  if (device.multizone) return "multizone";
  if (device.hasColor === false) return "white";
  return "color";
}

function applyDevice(light: Light, device: DeviceSnap, edit: PendingEdit | undefined, holdPaint: boolean): Light {
  const ability = abilityOf(device);
  const offline = device.online === false;
  const discoveredOn = device.power === true ? true : device.power === false ? false : null;
  const mode = ability === "white" ? "white" : light.mode;
  const hue = device.color?.hue ?? light.hue ?? 0;
  const saturation = device.color?.saturation ?? light.saturation ?? 0;
  const kelvin = device.color?.kelvin ?? light.kelvin ?? 3800;
  const brightness = device.color?.brightness ?? light.brightness;
  const color = colorHex(device.color, light.color);
  const zones = device.zones?.map((zone) => colorHex(zone, color));
  const incoming: Light = {
    ...light,
    name: device.label || light.name,
    live: true,
    offline,
    ability,
    mode,
    on: discoveredOn === null ? light.on : discoveredOn,
    hue,
    saturation,
    kelvin,
    brightness,
    color,
    zones: zones ?? light.zones,
  };
  const held = mergeHeld(light, incoming, edit, holdPaint);
  if (holdPaint) held.zones = light.zones;
  return held.on === light.on &&
    held.color === light.color &&
    held.brightness === light.brightness &&
    held.mode === light.mode &&
    held.hue === light.hue &&
    held.saturation === light.saturation &&
    held.kelvin === light.kelvin &&
    held.name === light.name &&
    held.offline === light.offline &&
    held.ability === light.ability &&
    held.zones?.join() === light.zones?.join()
    ? light
    : { ...held, on: heldPower(light.on, discoveredOn, edit) };
}

export function lightsFromDevices(devices: DeviceSnap[], roomId: string): Light[] {
  return devices
    .map((device) => {
      const ability = abilityOf(device);
      const saturation = device.color?.saturation ?? 0;
      const mode = ability === "white" || (ability === "color" && saturation < 2) ? "white" : "color";
      const hue = device.color?.hue ?? 0;
      const kelvin = device.color?.kelvin ?? 3800;
      const color = lightSwatch({ mode, hue, saturation, kelvin }, "#d9d3cb");
      const zones = device.zones?.map((zone) => colorHex(zone, color));
      const light: Light = {
        id: device.id,
        name: device.label?.trim() || device.id,
        color,
        on: device.power === false ? false : true,
        offline: device.online === false,
        live: true,
        ability,
        mode,
        brightness: device.color?.brightness ?? 100,
        kelvin,
        hue,
        saturation,
        roomId,
      };
      if (ability === "multizone" && zones?.length) light.zones = zones;
      return light;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeDevices(lights: Light[], devices: DeviceSnap[], holdPaintIds?: ReadonlySet<string>) {
  if (devices.length === 0) return lights;
  const seen = new Set<string>();
  const next = lights.map((light) => {
    const device = devices.find((item) => item.id === light.id);
    if (!device) return light.offline ? light : { ...light, offline: true };
    seen.add(light.id);
    return applyDevice(light, device, pendingEdits.get(light.id), holdPaintIds?.has(light.id) ?? false);
  });
  for (const light of lightsFromDevices(devices, "office")) {
    if (!seen.has(light.id)) next.push(light);
  }
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
