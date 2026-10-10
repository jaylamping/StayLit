'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EffectRuntime } = require('../src/effects');
const { Host } = require('../src/host');
const { WorkflowStore } = require('../src/store');
const { DEFAULT_LOGOUT_STATE, PC_EVENTS } = require('../src/workflows');

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
      if (!timer || timer.cleared) {
        return Promise.resolve();
      }
      return timer.fn();
    }
  };
}

function fakePlayer() {
  const calls = [];
  const devices = [
    { id: 'desk' },
    { id: 'strip' }
  ];
  return {
    calls,
    async listDevices() {
      return devices;
    },
    async deviceIds() {
      return devices.map((device) => device.id);
    },
    async setPower(args) {
      calls.push({ op: 'power', ...args });
    },
    async setColor(args) {
      calls.push({ op: 'color', ...args });
    },
    async applyZoneWrites(args) {
      calls.push({ op: 'zones', ...args });
    },
    async getZones() {
      return [{ index: 0 }, { index: 1 }];
    },
    async allOff() {
      calls.push({ op: 'allOff' });
    }
  };
}

function setup() {
  const clock = fakeClock();
  const player = fakePlayer();
  const store = new WorkflowStore(null);
  const host = new Host(player, store, new EffectRuntime(clock.schedule, clock.clear));
  return { clock, player, store, host };
}

test('known PC events are login and logout only', () => {
  assert.deepEqual(PC_EVENTS, ['session-login', 'session-logout']);
  assert.equal(DEFAULT_LOGOUT_STATE.color.kelvin, 3800);
  assert.equal(DEFAULT_LOGOUT_STATE.color.brightness, 100);
  assert.equal(DEFAULT_LOGOUT_STATE.color.saturation, 0);
  assert.equal(DEFAULT_LOGOUT_STATE.durationMs, 0);
  assert.equal(DEFAULT_LOGOUT_STATE.power, true);
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
  const login = await host.dispatch('session.event', { event: 'session-login' });
  assert.equal(login.effect.running, true);
  assert.equal(player.calls[0].hue, 30);
  assert.equal(player.calls[0].wait, false);

  const logout = await host.dispatch('session.event', { event: 'session-logout' });
  assert.equal(logout.effects, 'stopped');
  assert.equal(logout.applied, 'logout-white');
  assert.equal(host.runtime.status().running, false);
  assert.equal(clock.timers[0].cleared, true);
  const whites = player.calls.filter((call) => call.op === 'color' && call.kelvin === 3800);
  assert.equal(whites.length, 2);
  whites.forEach((call) => {
    assert.equal(call.saturation, 0);
    assert.equal(call.brightness, 100);
    assert.equal(call.durationMs, 0);
    assert.equal(call.wait, false);
  });
  await clock.fire(0);
  assert.equal(player.calls.filter((call) => call.op === 'color' && call.hue === 40).length, 0);
});

test('logout does not keep a hosted effect when the white state is what was saved', async () => {
  const { store, host } = setup();
  store.setLogout({ kelvin: 4000, brightness: 90 });
  const logout = await host.dispatch('session.event', { event: 'session-logout' });
  assert.equal(logout.applied, 'logout-white');
  assert.equal(host.runtime.status().running, false);
  const response = JSON.parse(await host.handleLine(JSON.stringify({
    id: 'w',
    method: 'workflows.get'
  })));
  assert.equal(response.result.logout.state.color.kelvin, 4000);
  assert.equal(response.result.logout.state.color.saturation, 0);
});

test('logout white rejects a colored kelvin outside a normal white', async () => {
  const { store } = setup();
  assert.throws(() => store.setLogout({ kelvin: 2500 }), /3500 to 4000/);
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
