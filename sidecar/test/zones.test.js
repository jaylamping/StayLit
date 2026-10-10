'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { LifxPlayer } = require('../src/lifx-player');
const { buildGradient, normalizeColor, planZoneWrites } = require('../src/zones');

test('gradient wraps hue the short way', () => {
  const zones = buildGradient(3, {
    hue: 350,
    saturation: 100,
    brightness: 50,
    kelvin: 3500
  }, {
    hue: 10,
    saturation: 100,
    brightness: 50,
    kelvin: 3500
  });
  assert.deepEqual(zones.map((zone) => zone.hue), [350, 0, 10]);
  assert.deepEqual(zones.map((zone) => zone.index), [0, 1, 2]);
});

test('zone plan groups a run and applies on the last write', () => {
  const writes = planZoneWrites([
    { index: 2, hue: 10, saturation: 0, brightness: 100, kelvin: 3800 },
    { index: 0, hue: 10, saturation: 0, brightness: 100, kelvin: 3800 },
    { index: 1, hue: 10, saturation: 0, brightness: 100, kelvin: 3800 }
  ], 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].startIndex, 0);
  assert.equal(writes[0].endIndex, 2);
  assert.equal(writes[0].apply, true);
  assert.equal(writes[0].kelvin, 3800);
});

test('one zone send lists the write once and applies on the last call', async () => {
  const calls = [];
  const light = {
    colorZones(start, end, hue, saturation, brightness, kelvin, duration, apply, cb) {
      calls.push({ start, end, hue, saturation, brightness, kelvin, duration, apply });
      if (typeof cb === 'function') {
        cb(null);
      }
    }
  };
  const player = new LifxPlayer(null, {});
  player.lights.set('strip', light);
  const writes = planZoneWrites([
    { index: 0, hue: 1, saturation: 2, brightness: 3, kelvin: 3500 },
    { index: 1, hue: 4, saturation: 5, brightness: 6, kelvin: 4000 }
  ], 120);
  await player.applyZoneWrites({ deviceId: 'strip', writes, wait: false });
  await player.applyZoneWrites({ deviceId: 'strip', writes, wait: true });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].apply, false);
  assert.equal(calls[0].start, 0);
  assert.equal(calls[1].apply, true);
  assert.equal(calls[1].hue, 4);
  assert.equal(calls[1].duration, 120);
  assert.deepEqual(calls[2], calls[0]);
  assert.deepEqual(calls[3], calls[1]);
});

test('a missing color is a command error', () => {
  assert.throws(() => normalizeColor(null), (err) => {
    assert.equal(err.code, 'bad_color');
    assert.equal(err.message, 'Color is required');
    return true;
  });
  assert.throws(() => normalizeColor('white'), (err) => {
    assert.equal(err.code, 'bad_color');
    assert.equal(err.message, 'Color is required');
    return true;
  });
});

test('duplicate zone indexes are rejected', () => {
  assert.throws(() => planZoneWrites([
    { index: 1, hue: 0, saturation: 0, brightness: 1, kelvin: 3500 },
    { index: 1, hue: 0, saturation: 0, brightness: 1, kelvin: 3500 }
  ], 0), /Duplicate zone index 1/);
});
