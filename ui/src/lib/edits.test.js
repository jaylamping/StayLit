import assert from "node:assert/strict";
import test from "node:test";
import { beginPaint, failPaint, heldPower, mergeHeld, pendingEdits, restorePaint } from "./edits.ts";

const painted = {
  mode: "color",
  hue: 20,
  saturation: 80,
  kelvin: 3500,
  brightness: 40,
  color: "#c45a28",
};

test("a list with nobody dragging keeps the effect color", () => {
  pendingEdits.clear();
  const light = { id: "bulb", ...painted, on: true, name: "Desk", roomId: "office" };
  const listed = { ...light, hue: 200, saturation: 90, color: "#2244aa", brightness: 80 };
  const merged = mergeHeld(light, listed, undefined, false);
  assert.equal(merged.color, "#2244aa");
  assert.equal(merged.hue, 200);
  assert.equal(merged.mode, "color");
});

test("a list during a drag keeps the painted color", () => {
  pendingEdits.clear();
  const light = { id: "bulb", ...painted, on: true, name: "Desk", roomId: "office" };
  beginPaint(light.id, painted);
  const listed = {
    ...light,
    hue: 200,
    saturation: 1,
    brightness: 90,
    color: "#2244aa",
    on: false,
    name: "Other",
    roomId: "living",
  };
  const merged = mergeHeld(light, listed, pendingEdits.get(light.id), false);
  assert.equal(merged.color, painted.color);
  assert.equal(merged.hue, painted.hue);
  assert.equal(merged.saturation, painted.saturation);
  assert.equal(merged.brightness, painted.brightness);
  assert.equal(merged.mode, "color");
  assert.equal(merged.on, false);
  assert.equal(merged.name, "Other");
  assert.equal(merged.roomId, "living");
});

test("a failed setColor restores the pre-gesture paint fields", () => {
  const before = painted;
  const current = {
    mode: "white",
    hue: 200,
    saturation: 0,
    kelvin: 9000,
    brightness: 10,
    color: "#2244aa",
    on: false,
    name: "Desk",
    roomId: "living",
  };
  const restored = restorePaint(current, before);
  assert.equal(restored.color, before.color);
  assert.equal(restored.mode, before.mode);
  assert.equal(restored.hue, before.hue);
  assert.equal(restored.saturation, before.saturation);
  assert.equal(restored.kelvin, before.kelvin);
  assert.equal(restored.brightness, before.brightness);
  assert.equal(restored.on, false);
  assert.equal(restored.name, "Desk");
  assert.equal(restored.roomId, "living");
});

test("power null stays at the current power", () => {
  assert.equal(heldPower(true, null, undefined), true);
  assert.equal(heldPower(false, null, undefined), false);
  assert.equal(heldPower(true, false, undefined), false);
});

test("a late paint failure does not clobber a newer gesture", () => {
  pendingEdits.clear();
  const light = { id: "bulb", ...painted, on: true };
  const first = beginPaint(light.id, painted);
  pendingEdits.get(light.id).paint = undefined;
  beginPaint(light.id, { ...painted, color: "#111111", hue: 4 });
  const kept = failPaint({ ...light, color: "#111111", hue: 4, on: false, name: "Desk", roomId: "office" }, light.id, first);
  assert.equal(kept.color, "#111111");
  assert.equal(kept.on, false);
});
