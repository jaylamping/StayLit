import assert from "node:assert/strict";
import test from "node:test";
import { blendHex, lampFor, nextPaint, switchFill } from "./paint.ts";

const whiteBulb = { ability: "color", mode: "white", hue: 0, saturation: 0, kelvin: 6500, brightness: 80, kelvinRange: [2500, 9000] };

test("a hue edit on a bulb that came from white gives it color instead of staying white", () => {
  const color = nextPaint(whiteBulb, { mode: "color" });
  assert.equal(color.mode, "color");
  assert.equal(color.saturation, 0);
  const hued = nextPaint({ ...whiteBulb, mode: "color" }, { hue: 120 });
  assert.equal(hued.hue, 120);
  assert.equal(hued.saturation, 100);
});

test("a hue edit keeps a saturation the user already set", () => {
  assert.equal(nextPaint({ ...whiteBulb, mode: "color", saturation: 40 }, { hue: 200 }).saturation, 40);
  assert.equal(nextPaint({ ...whiteBulb, mode: "color" }, { hue: 200, saturation: 0 }).saturation, 0);
  assert.equal(nextPaint(whiteBulb, { hue: 200 }).saturation, 0);
});

test("a white pick is clamped to the bulb", () => {
  assert.equal(nextPaint(whiteBulb, { mode: "white", kelvin: 1500 }).kelvin, 2500);
  assert.equal(nextPaint({ ...whiteBulb, ability: "white" }, { mode: "color", hue: 30 }).mode, "white");
});

test("a group's color is the blend of its lit members", () => {
  assert.equal(blendHex(["#ff0000", "#0000ff"]), "#800080");
  assert.equal(blendHex([]), null);
  const lamp = lampFor([
    { id: "office-1", fill: "#ffc68c", lit: true, owned: false },
    { id: "office-2", fill: "#ffe0c0", lit: true, owned: false },
    { id: "sink", fill: "#000000", lit: false, owned: false },
  ]);
  assert.deepEqual(lamp, { blend: "#ffd3a6", ownedId: null, ownedShare: 0, rest: "#ffd3a6" });
});

test("a group follows the effect's frames once the effect owns a lit member", () => {
  const lamp = lampFor([
    { id: "corner", fill: "#4763ff", lit: true, owned: true },
    { id: "candle", fill: "#ffcd9a", lit: true, owned: false },
  ]);
  assert.equal(lamp?.ownedId, "corner");
  assert.equal(lamp?.ownedShare, 50);
  assert.equal(lamp?.rest, "#ffcd9a");
  const all = lampFor([{ id: "office-1", fill: "#ffffff", lit: true, owned: true }]);
  assert.equal(all?.ownedShare, 100);
  assert.equal(all?.rest, null);
  assert.equal(lampFor([{ id: "corner", fill: "#4763ff", lit: false, owned: true }]), null);
});

test("a group switch is tinted like a light's, from its live member color", () => {
  assert.equal(switchFill({ checked: true, bulb: "var(--lamp)" }), "color-mix(in srgb, var(--lamp) 52%, var(--track))");
  assert.equal(switchFill({ checked: true, bulb: "#ffce9a" }), switchFill({ checked: true, bulb: "#ffce9a", vivid: false }));
  assert.equal(switchFill({ checked: false, mixed: true, bulb: "var(--lamp)" }), "color-mix(in srgb, var(--lamp) 18%, var(--track))");
  assert.equal(switchFill({ checked: true, bulb: "var(--lamp)", vivid: true }), "color-mix(in srgb, var(--lamp) 100%, var(--track))");
});

test("a switch with every member off falls back to the plain off track", () => {
  assert.equal(switchFill({ checked: false, bulb: null }), undefined);
  assert.equal(switchFill({ checked: false, bulb: "var(--lamp)" }), undefined);
});
