'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EffectRuntime, createEffect } = require('../src/effects');

function fakeClock() {
  const timers = [];
  return {
    timers,
    schedule(fn, ms) {
      const timer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clear(timer) {
      timer.cleared = true;
    },
    fire(index) {
      const timer = timers[index];
      if (timer.cleared) {
        return Promise.resolve();
      }
      return timer.fn();
    }
  };
}

function fakePlayer() {
  const calls = [];
  return {
    calls,
    async deviceIds() {
      return ['bulb', 'strip'];
    },
    async setColor(args) {
      calls.push({ op: 'color', ...args });
    },
    async applyZoneWrites(args) {
      calls.push({ op: 'zones', ...args });
    },
    async getZones() {
      return [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }];
    }
  };
}

test('color cycle keeps sending new hues until stopped', async () => {
  const clock = fakeClock();
  const player = fakePlayer();
  const runtime = new EffectRuntime(clock.schedule, clock.clear);
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
  await clock.fire(0);
  assert.equal(player.calls[1].hue, 15);
  assert.equal(runtime.status().running, true);
  runtime.stopAll();
  await clock.fire(0);
  assert.equal(player.calls.length, 2);
  assert.equal(runtime.status().running, false);
  assert.equal(clock.timers[0].cleared, true);
});

test('moving gradient shifts zone colors and applies the last write', async () => {
  const clock = fakeClock();
  const player = fakePlayer();
  const runtime = new EffectRuntime(clock.schedule, clock.clear);
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
  await clock.fire(0);
  const secondHue = player.calls[1].writes[0].hue;
  assert.notEqual(secondHue, firstHue);
  assert.equal(player.calls[1].wait, false);
});
