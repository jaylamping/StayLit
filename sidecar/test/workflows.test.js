'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EffectRuntime } = require('../src/effects');
const { Host } = require('../src/host');
const { WorkflowStore } = require('../src/store');
const { DEFAULT_LOGOUT, PC_EVENTS } = require('../src/workflows');
const { fakePlayer, scriptedSleep } = require('./support');

function setup() {
  const clock = scriptedSleep();
  const player = fakePlayer();
  const store = new WorkflowStore(null);
  const host = new Host(player, store, new EffectRuntime(clock.sleep));
  return { clock, player, store, host };
}

test('known PC events are login and logout only', () => {
  assert.deepEqual(PC_EVENTS, ['session-login', 'session-logout']);
  assert.equal(DEFAULT_LOGOUT.kelvin, 3800);
  assert.equal(DEFAULT_LOGOUT.brightness, 100);
});

test('login stores an effect spec and starts a runner only when the session starts', async () => {
  const { player, store, host } = setup();
  const saved = store.setLogin({
    enabled: true,
    action: {
      type: 'effect',
      effect: { kind: 'color-cycle', deviceId: 'desk', hue: 30, step: 10 }
    }
  });
  assert.equal(saved.login.action.effect.kind, 'color-cycle');
  assert.equal(saved.login.action.effect.hue, 30);
  assert.equal(saved.login.action.effect.from, undefined);
  assert.equal(saved.login.action.effect.tick, undefined);
  const login = await host.dispatch('session.event', { event: 'session-login' });
  assert.equal(login.effect.running, true);
  assert.equal(player.calls[0].hue, 30);
  assert.equal(player.calls[0].wait, false);
});

test('login can start a hosted effect and logout stops it with one-shot white', async () => {
  const { clock, player, store, host } = setup();
  store.setLogin({
    enabled: true,
    action: {
      type: 'effect',
      effect: { kind: 'color-cycle', deviceId: 'desk', hue: 30, step: 10 }
    }
  });
  await host.dispatch('session.event', { event: 'session-login' });
  const logout = await host.dispatch('session.event', { event: 'session-logout' });
  assert.equal(logout.effects, 'stopped');
  assert.equal(logout.applied.kelvin, 3800);
  assert.equal(logout.applied.brightness, 100);
  assert.equal(host.runtime.status().running, false);
  const whites = player.calls.filter((call) => call.op === 'color' && call.kelvin === 3800);
  assert.equal(whites.length, 2);
  whites.forEach((call) => {
    assert.equal(call.saturation, 0);
    assert.equal(call.brightness, 100);
    assert.equal(call.durationMs, 0);
    assert.equal(call.wait, false);
  });
  const powers = player.calls.filter((call) => call.op === 'power' && call.on === true);
  assert.equal(powers.length, 2);
  await clock.release();
  assert.equal(player.calls.filter((call) => call.op === 'color' && call.hue === 40).length, 0);
});

test('logout white is a kelvin and brightness preset', async () => {
  const { player, store, host } = setup();
  store.setLogout({ kelvin: 4000, brightness: 90 });
  const logout = await host.dispatch('session.event', { event: 'session-logout' });
  assert.equal(logout.applied.kelvin, 4000);
  assert.equal(logout.applied.brightness, 90);
  assert.equal(host.runtime.status().running, false);
  const response = JSON.parse(await host.handleLine(JSON.stringify({
    id: 'w',
    method: 'workflows.get'
  })));
  assert.equal(response.result.logout.kelvin, 4000);
  assert.equal(response.result.logout.brightness, 90);
  assert.equal(response.result.logout.color, undefined);
  const white = player.calls.find((call) => call.op === 'color');
  assert.equal(white.kelvin, 4000);
  assert.equal(white.saturation, 0);
});

test('logout white rejects a colored kelvin outside a normal white', () => {
  const { store } = setup();
  assert.throws(() => store.setLogout({ kelvin: 2500 }), /3500 to 4000/);
});

test('a direct bulb write cancels the hosted effect once', async () => {
  const { player, store, host } = setup();
  store.setLogin({
    enabled: true,
    action: {
      type: 'effect',
      effect: { kind: 'color-cycle', deviceId: 'desk', hue: 0, step: 10 }
    }
  });
  await host.dispatch('session.event', { event: 'session-login' });
  assert.equal(host.runtime.status().running, true);
  await host.dispatch('setColor', {
    deviceId: 'desk',
    hue: 10,
    saturation: 20,
    brightness: 30,
    kelvin: 3500
  });
  assert.equal(host.runtime.status().running, false);
  assert.equal(player.calls.filter((call) => call.op === 'color' && call.wait === true).length, 1);
});

test('shutdown stops the loop and does not send logout white', async () => {
  const { player, store, host } = setup();
  store.setLogin({
    enabled: true,
    action: {
      type: 'effect',
      effect: { kind: 'color-cycle', deviceId: null, hue: 0, step: 10 }
    }
  });
  await host.dispatch('session.event', { event: 'session-login' });
  const before = player.calls.length;
  const stopped = await host.dispatch('shutdown', {});
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.effects.running, false);
  assert.equal(player.calls.length, before);
});

test('unknown session events are rejected', async () => {
  const { host } = setup();
  const response = JSON.parse(await host.handleLine(JSON.stringify({
    id: 'e',
    method: 'session.event',
    params: { event: 'session-lock' }
  })));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'unknown_event');
});

test('login can apply a saved scene with strip zones', async () => {
  const { player, store, host } = setup();
  store.saveState({
    id: 'evening',
    name: 'Evening',
    targets: [{
      deviceId: 'strip',
      power: true,
      color: { hue: 30, saturation: 40, brightness: 20, kelvin: 2700 },
      zones: [
        { index: 0, hue: 30, saturation: 80, brightness: 40, kelvin: 2700 },
        { index: 1, hue: 40, saturation: 80, brightness: 40, kelvin: 2700 }
      ]
    }]
  });
  store.setLogin({
    enabled: true,
    action: { type: 'savedState', stateId: 'evening' }
  });
  const login = await host.dispatch('session.event', { event: 'session-login' });
  assert.equal(login.applied, 'evening');
  assert.equal(host.runtime.status().running, false);
  const zoneCall = player.calls.find((call) => call.op === 'zones');
  assert.ok(zoneCall);
  assert.equal(zoneCall.deviceId, 'strip');
  assert.equal(zoneCall.writes[zoneCall.writes.length - 1].apply, true);
});
