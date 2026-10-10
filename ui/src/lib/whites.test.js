import assert from "node:assert/strict";
import test from "node:test";
import { clampKelvin, kelvinHex, kelvinRangeOf, whiteAt, whites, whitesIn } from "./whites.ts";

test("named whites run from Candlelight to Blue Ice in order", () => {
  assert.equal(whites[0].name, "Candlelight");
  assert.equal(whites[0].kelvin, 1500);
  assert.equal(whites.at(-1).kelvin, 9000);
  assert.ok(whites.every((white, index) => index === 0 || white.kelvin > whites[index - 1].kelvin));
});

test("a bulb only gets the whites inside its range", () => {
  assert.deepEqual(
    whitesIn([2200, 6500]).map((white) => white.kelvin),
    [2200, 2500, 2700, 3000, 3200, 3500, 4000, 4500, 5000, 5600, 6000, 6500],
  );
  assert.equal(whitesIn([1500, 9000]).length, whites.length);
  assert.deepEqual(whitesIn([2700, 2700]).map((white) => white.name), ["Incandescent"]);
});

test("an unknown range falls back to the common color bulb range", () => {
  assert.deepEqual(kelvinRangeOf(undefined), [2500, 9000]);
  assert.deepEqual(kelvinRangeOf([6500, 2700]), [2500, 9000]);
  assert.deepEqual(kelvinRangeOf([1500, 9000]), [1500, 9000]);
});

test("kelvin is clamped to the bulb and the current white tolerates rounding", () => {
  assert.equal(clampKelvin(1500, [2500, 9000]), 2500);
  assert.equal(clampKelvin(9500, [1500, 9000]), 9000);
  assert.equal(whiteAt(3999, whites)?.name, "Cool");
  assert.equal(whiteAt(3680, whites), null);
});

test("warm whites are warmer than cool whites", () => {
  const blue = (hex) => parseInt(hex.slice(5, 7), 16);
  assert.ok(blue(kelvinHex(1500)) < blue(kelvinHex(4000)));
  assert.ok(blue(kelvinHex(4000)) < blue(kelvinHex(9000)));
  assert.equal(kelvinHex(1000), kelvinHex(1500));
});
