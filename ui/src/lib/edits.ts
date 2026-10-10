export type Mode = "color" | "white";

export type PaintFields = {
  mode: Mode;
  hue: number;
  saturation: number;
  kelvin: number;
  brightness: number;
  color: string;
};

export type PendingEdit = {
  paintGeneration: number;
  powerGeneration: number;
  paint?: { generation: number; before: PaintFields; sent: PaintFields };
  power?: { generation: number; before: boolean };
};

export const pendingEdits = new Map<string, PendingEdit>();

function editFor(id: string) {
  const existing = pendingEdits.get(id);
  if (existing) return existing;
  const created: PendingEdit = { paintGeneration: 0, powerGeneration: 0 };
  pendingEdits.set(id, created);
  return created;
}

export function paintFields(light: PaintFields): PaintFields {
  return {
    mode: light.mode,
    hue: light.hue,
    saturation: light.saturation,
    kelvin: light.kelvin,
    brightness: light.brightness,
    color: light.color,
  };
}

export function beginPaint(id: string, before: PaintFields) {
  const edit = editFor(id);
  if (edit.paint) return edit.paint.generation;
  edit.paintGeneration += 1;
  edit.paint = { generation: edit.paintGeneration, before, sent: before };
  return edit.paint.generation;
}

export function stagePaint(id: string, sent: PaintFields) {
  const paint = pendingEdits.get(id)?.paint;
  if (paint) paint.sent = sent;
}

export function sentPaint(id: string, generation: number) {
  const paint = pendingEdits.get(id)?.paint;
  if (!paint || paint.generation !== generation) return null;
  return paint.sent;
}

export function finishPaint(id: string, generation: number) {
  const edit = pendingEdits.get(id);
  if (!edit?.paint || edit.paint.generation !== generation) return false;
  delete edit.paint;
  return true;
}

export function restorePaint<T extends { mode: Mode; color: string; brightness: number }>(current: T, before: PaintFields): T {
  return {
    ...current,
    mode: before.mode,
    hue: before.hue,
    saturation: before.saturation,
    kelvin: before.kelvin,
    brightness: before.brightness,
    color: before.color,
  };
}

export function failPaint<T extends { mode: Mode; color: string; brightness: number }>(current: T, id: string, generation: number): T {
  const edit = pendingEdits.get(id);
  if (!edit?.paint || edit.paint.generation !== generation) return current;
  const before = edit.paint.before;
  delete edit.paint;
  return restorePaint(current, before);
}

export function beginPower(id: string, before: boolean) {
  const edit = editFor(id);
  edit.powerGeneration += 1;
  edit.power = { generation: edit.powerGeneration, before };
  return edit.power.generation;
}

export function finishPower(id: string, generation: number) {
  const edit = pendingEdits.get(id);
  if (!edit?.power || edit.power.generation !== generation) return false;
  delete edit.power;
  return true;
}

export function failPower(id: string, generation: number) {
  const edit = pendingEdits.get(id);
  if (!edit?.power || edit.power.generation !== generation) return null;
  const before = edit.power.before;
  delete edit.power;
  return before;
}

export function heldPower(currentOn: boolean, devicePower: boolean | null | undefined, edit: PendingEdit | undefined) {
  if (edit?.power) return currentOn;
  if (devicePower == null) return currentOn;
  return devicePower;
}

export function mergeHeld<
  T extends { on: boolean; mode: Mode; color: string; brightness: number; hue?: number; saturation?: number; kelvin?: number },
>(
  light: T,
  incoming: T,
  edit: PendingEdit | undefined,
  holdPaint: boolean,
): T {
  const next = { ...incoming };
  if (edit?.paint || holdPaint) {
    next.mode = light.mode;
    next.hue = light.hue;
    next.saturation = light.saturation;
    next.kelvin = light.kelvin;
    next.brightness = light.brightness;
    next.color = light.color;
  }
  next.on = heldPower(light.on, incoming.on, edit);
  return next;
}
