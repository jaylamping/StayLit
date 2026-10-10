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
};

function channel(value: number) {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, "0");
}

function kelvinHex(kelvin: number) {
  const t = Math.min(1, Math.max(0, (kelvin - 2500) / 4500));
  return `#${channel(255)}${channel(214 + t * 28)}${channel(170 + t * 70)}`;
}

export function lightSwatch(color: DeviceColor | null | undefined, fallback = "#d9d3cb") {
  return colorHex(color, fallback);
}

function colorHex(color: DeviceColor | null | undefined, fallback: string) {
  if (!color) return fallback;
  const saturation = color.saturation ?? 0;
  if (saturation < 2) return kelvinHex(color.kelvin ?? 3800);
  const hue = ((color.hue ?? 0) % 360) / 60;
  const chroma = 1;
  const x = 1 - Math.abs((hue % 2) - 1);
  const sector = Math.floor(hue);
  const map = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][sector] ?? [chroma, 0, 0];
  const mix = (value: number) => channel(255 * (1 - saturation / 100) + value * 255 * (saturation / 100) * 0.85);
  return `#${mix(map[0])}${mix(map[1])}${mix(map[2])}`;
}

function applyDevice(light: Light, device: DeviceSnap): Light {
  const offline = device.online === false;
  const on = device.power === true;
  const color = colorHex(device.color, light.color);
  const brightness = device.color?.brightness ?? light.brightness;
  const kelvin = device.color?.kelvin ?? light.kelvin;
  const zones = device.zones?.map((zone) => colorHex(zone, color));
  const sameZones = (zones ?? light.zones)?.join() === light.zones?.join();
  if (
    light.live &&
    light.name === (device.label || light.name) &&
    light.offline === offline &&
    light.on === on &&
    light.color === color &&
    light.brightness === brightness &&
    light.kelvin === kelvin &&
    light.hue === (device.color?.hue ?? light.hue) &&
    light.saturation === (device.color?.saturation ?? light.saturation) &&
    sameZones
  ) {
    return light;
  }
  return {
    ...light,
    name: device.label || light.name,
    live: true,
    offline,
    on,
    color,
    brightness,
    kelvin,
    hue: device.color?.hue ?? light.hue,
    saturation: device.color?.saturation ?? light.saturation,
    zones: zones ?? light.zones,
    kind: device.multizone ? "strip" : light.kind,
  };
}

export function lightsFromDevices(devices: DeviceSnap[], roomId: string): Light[] {
  return devices
    .map((device) => {
      const saturation = device.color?.saturation ?? 0;
      const kind = device.multizone ? "strip" : saturation < 2 ? "white" : "color";
      const color = colorHex(device.color, "#d9d3cb");
      const zones = device.zones?.map((zone) => colorHex(zone, color));
      const light: Light = {
        id: device.id,
        name: device.label?.trim() || device.id,
        color,
        on: device.power === true,
        offline: device.online === false,
        live: true,
        kind,
        brightness: device.color?.brightness ?? 100,
        kelvin: device.color?.kelvin ?? 3800,
        hue: device.color?.hue ?? 0,
        saturation,
        roomId,
      };
      if (kind === "strip" && zones?.length) light.zones = zones;
      return light;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeDevices(lights: Light[], devices: DeviceSnap[]) {
  if (devices.length === 0) return lights;
  const seen = new Set<string>();
  const next = lights.map((light) => {
    const device = devices.find((item) => item.id === light.id);
    if (!device) return light.offline ? light : { ...light, offline: true };
    seen.add(light.id);
    return applyDevice(light, device);
  });
  for (const light of lightsFromDevices(devices, "office")) {
    if (!seen.has(light.id)) next.push(light);
  }
  return next.sort((a, b) => a.name.localeCompare(b.name));
}
