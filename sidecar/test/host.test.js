'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EffectRuntime, createEffect } = require('../src/effects');
const { Host } = require('../src/host');
const { WorkflowStore } = require('../src/store');
const { fakePlayer, scriptedSleep } = require('./support');

function setup(player = fakePlayer()) {
  const clock = scriptedSleep();
  const runtime = new EffectRuntime(clock.sleep);
  return { clock, player, runtime, host: new Host(player, new WorkflowStore(null), runtime) };
}

test('one setColors request paints every member and reports each bulb', async () => {
  const player = fakePlayer();
  const failing = player.setColor;
  player.setColor = async (args) => {
    if (args.deviceId === 'office-2') throw new Error('Office 2 did not answer');
    return failing(args);
  };
  const { host } = setup(player);
  const result = await host.dispatch('setColors', {
    lights: [
      { deviceId: 'office-1', hue: 0, saturation: 0, brightness: 60, kelvin: 4000 },
      { deviceId: 'office-2', hue: 0, saturation: 0, brightness: 60, kelvin: 4000 }
    ]
  });
  assert.deepEqual(result.results, [
    { deviceId: 'office-1', ok: true },
    { deviceId: 'office-2', ok: false, error: 'Office 2 did not answer' }
  ]);
  assert.equal(player.calls.length, 1);
  assert.equal(player.calls[0].kelvin, 4000);
  assert.equal(player.calls[0].wait, true);
});

test('one setPowers request switches every member', async () => {
  const { host, player } = setup();
  const result = await host.dispatch('setPowers', { deviceIds: ['office-1', 'office-2'], on: false });
  assert.deepEqual(result.results.map((item) => item.ok), [true, true]);
  assert.deepEqual(player.calls.map((call) => [call.deviceId, call.on]), [['office-1', false], ['office-2', false]]);
});

test('a group write stops a running effect first', async () => {
  const { host, runtime } = setup();
  await runtime.start(createEffect({ kind: 'color-cycle', deviceIds: ['office-1'], step: 15, hue: 0 }), host.player);
  assert.equal(runtime.status().running, true);
  await host.dispatch('setPowers', { deviceIds: ['office-1'], on: true });
  assert.equal(runtime.status().running, false);
});

test('a group write needs members', async () => {
  const { host } = setup();
  await assert.rejects(host.dispatch('setColors', { lights: [] }), /lights must be a non-empty list/);
  await assert.rejects(host.dispatch('setPowers', { deviceIds: ['a'] }), /on must be a boolean/);
});
