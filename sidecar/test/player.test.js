'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LifxPlayer, kelvinRangeOf } = require('../src/lifx-player');

function fakeLight(features) {
  return {
    id: 'candle',
    address: '10.0.0.9',
    label: 'LIFX Candle Color D399AB',
    status: 'on',
    getState(cb) {
      cb(null, { power: 1, label: 'LIFX Candle Color D399AB', color: { hue: 30, saturation: 50, brightness: 40, kelvin: 2700 } });
    },
    getHardwareVersion(cb) {
      cb(null, { productName: 'LIFX Candle Color US', productFeatures: features });
    }
  };
}

const store = { rememberAddress() {}, knownAddresses: () => [] };

test('a refreshed bulb reports the white range its product supports', async () => {
  const player = new LifxPlayer({ on() {}, init() {} }, store);
  const light = fakeLight({ color: true, multizone: false, temperature_range: [1500, 9000] });
  player.lights.set(light.id, light);
  player.snapshots.set(light.id, { id: light.id, multizone: null, kelvinRange: null });
  const snap = await player.refreshOne(light.id);
  assert.deepEqual(snap.kelvinRange, [1500, 9000]);
  assert.equal(snap.hasColor, true);
});

test('a product without a usable white range reports none', () => {
  assert.equal(kelvinRangeOf(undefined), null);
  assert.equal(kelvinRangeOf({ temperature_range: null }), null);
  assert.equal(kelvinRangeOf({ temperature_range: [6500, 2700] }), null);
  assert.deepEqual(kelvinRangeOf({ temperature_range: [2700, 2700] }), [2700, 2700]);
});
