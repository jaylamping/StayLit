'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EffectRuntime, createEffect, normalizeEffectSpec } = require('../src/effects');
const { fakePlayer, scriptedSleep } = require('./support');

test('color cycle keeps sending new hues until stopped', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const runtime = new EffectRuntime(clock.sleep);
  const effect = createEffect({
    kind: 'color-cycle',
    deviceId: 'bulb',
    step: 15,
    hue: 0,
    intervalMs: 1000
  });
  await runtime.start(effect, player);
  assert.equal(player.calls[0].hue, 0);
  assert.equal(player.calls[0].wait, false);
  await clock.release();
  assert.equal(player.calls[1].hue, 15);
  assert.equal(runtime.status().running, true);
  runtime.stopAll();
  await clock.release();
  assert.equal(player.calls.length, 2);
  assert.equal(runtime.status().running, false);
});

test('moving gradient shifts zone colors and applies the last write', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const runtime = new EffectRuntime(clock.sleep);
  const from = { hue: 0, saturation: 100, brightness: 50, kelvin: 3500 };
  const to = { hue: 120, saturation: 100, brightness: 50, kelvin: 3500 };
  const effect = createEffect({
    kind: 'moving-gradient',
    deviceId: 'strip',
    zoneCount: 4,
    from,
    to,
    durationMs: 200
  });
  await runtime.start(effect, player);
  const first = player.calls[0].writes;
  assert.equal(first[first.length - 1].apply, true);
  const covered = new Set();
  first.forEach((write) => {
    for (let index = write.startIndex; index <= write.endIndex; index += 1) {
      covered.add(index);
    }
  });
  assert.deepEqual([...covered], [0, 1, 2, 3]);
  const firstHue = first[0].hue;
  await clock.release();
  const secondHue = player.calls[1].writes[0].hue;
  assert.notEqual(secondHue, firstHue);
  assert.equal(player.calls[1].wait, false);
  runtime.stopAll();
});

test('a saved effect spec is data, and a hue step is not a duration', () => {
  const cycle = normalizeEffectSpec({
    kind: 'color-cycle',
    deviceId: 'bulb',
    hue: 10,
    step: 20
  });
  assert.equal(cycle.step, 20);
  assert.equal(cycle.from, undefined);
  assert.equal(cycle.tick, undefined);
  const gradient = normalizeEffectSpec({
    kind: 'moving-gradient',
    deviceId: 'strip',
    from: { hue: 0, saturation: 100, brightness: 50, kelvin: 3500 },
    to: { hue: 90, saturation: 100, brightness: 50, kelvin: 3500 }
  });
  assert.equal(gradient.step, undefined);
  assert.equal(gradient.hue, undefined);
  assert.throws(() => normalizeEffectSpec({
    kind: 'color-cycle',
    step: 0
  }), /step must be between 1 and 360/);
});
