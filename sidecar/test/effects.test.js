'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EffectRuntime, createEffect, normalizeEffectSpec } = require('../src/effects');
const { createHost } = require('../src/host');
const { WorkflowStore } = require('../src/store');
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

test('color cycle uses the given lights and skips the rest of the list', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer({ devices: [{ id: 'first' }, { id: 'sink' }, { id: 'corner' }] });
  const runtime = new EffectRuntime(clock.sleep);
  const effect = createEffect({
    kind: 'color-cycle',
    deviceIds: ['sink', 'corner'],
    step: 15,
    hue: 0,
    intervalMs: 1000
  });
  await runtime.start(effect, player);
  assert.deepEqual(player.calls.map((call) => call.deviceId), ['sink', 'corner']);
  runtime.stopAll();
  await clock.release();
});

test('color cycle hands each frame it sent to the window, and none after stop', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const frames = [];
  const runtime = new EffectRuntime(clock.sleep, (frame) => frames.push(frame));
  const effect = createEffect({
    kind: 'color-cycle',
    deviceIds: ['corner', 'sink'],
    step: 15,
    hue: 200,
    intervalMs: 1000,
    durationMs: 800
  });
  await runtime.start(effect, player);
  await clock.release();
  assert.equal(frames.length, 2);
  assert.equal(frames[0].kind, 'color-cycle');
  assert.equal(frames[0].durationMs, 800);
  assert.equal(frames[0].intervalMs, 1000);
  assert.deepEqual(frames[0].lights.map((light) => [light.deviceId, light.hue]), [['corner', 200], ['sink', 200]]);
  assert.equal(frames[1].lights[0].hue, 215);
  assert.equal(frames[1].lights[0].hue, player.calls[2].hue);
  runtime.stopAll();
  await clock.release();
  assert.equal(frames.length, 2);
});

test('moving gradient frames carry the zones it wrote', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const frames = [];
  const runtime = new EffectRuntime(clock.sleep, (frame) => frames.push(frame));
  const effect = createEffect({
    kind: 'moving-gradient',
    deviceId: 'strip',
    zoneCount: 4,
    from: { hue: 0, saturation: 100, brightness: 50, kelvin: 3500 },
    to: { hue: 120, saturation: 100, brightness: 50, kelvin: 3500 },
    durationMs: 400
  });
  await runtime.start(effect, player);
  const [light] = frames[0].lights;
  assert.equal(frames[0].durationMs, 400);
  assert.equal(light.deviceId, 'strip');
  assert.equal(light.zones.length, 4);
  assert.equal(light.zones[0].hue, player.calls[0].writes[0].hue);
  await clock.release();
  assert.notEqual(frames[1].lights[0].zones[0].hue, light.zones[0].hue);
  runtime.stopAll();
});

test('the host passes effect frames to its frame hook, and a write stops them', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const frames = [];
  const host = createHost({ player, store: new WorkflowStore(null), sleep: clock.sleep, onFrame: (frame) => frames.push(frame) });
  await host.dispatch('effects.start', { kind: 'color-cycle', deviceIds: ['desk'], hue: 90, step: 15 });
  assert.deepEqual(frames.map((frame) => frame.lights[0].hue), [90]);
  await host.dispatch('setColor', { deviceId: 'desk', hue: 10, saturation: 50, brightness: 40, kelvin: 3500 });
  await clock.release();
  assert.equal(frames.length, 1);
  assert.equal(host.runtime.status().running, false);
});

test('a frame hook that throws does not stop the effect', async () => {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const runtime = new EffectRuntime(clock.sleep, () => {
    throw new Error('stdout closed');
  });
  await runtime.start(createEffect({ kind: 'color-cycle', deviceId: 'bulb', step: 15, hue: 0 }), player);
  await clock.release();
  assert.equal(player.calls.length, 2);
  assert.equal(runtime.status().lastError, null);
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
