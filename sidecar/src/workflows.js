'use strict';

const { CommandError } = require('./protocol');
const { createEffect } = require('./effects');
const { normalizeColor, planZoneWrites } = require('./zones');

const PC_EVENTS = ['session-login', 'session-logout'];

const DEFAULT_LOGOUT_STATE = {
  id: 'logout-white',
  name: 'Logout white',
  applyTo: 'all',
  power: true,
  durationMs: 0,
  color: {
    hue: 0,
    saturation: 0,
    brightness: 100,
    kelvin: 3800
  },
  zones: null
};

function assertEvent(event) {
  if (!PC_EVENTS.includes(event)) {
    throw new CommandError('unknown_event', `Unknown PC event: ${event}`);
  }
  return event;
}

function cloneLogoutState() {
  return {
    ...DEFAULT_LOGOUT_STATE,
    color: { ...DEFAULT_LOGOUT_STATE.color }
  };
}

function normalizeLogoutState(input) {
  const base = cloneLogoutState();
  if (!input || typeof input !== 'object') {
    return base;
  }
  const kelvin = input.kelvin === undefined ? base.color.kelvin : input.kelvin;
  const brightness = input.brightness === undefined ? base.color.brightness : input.brightness;
  if (typeof kelvin !== 'number' || kelvin < 3500 || kelvin > 4000) {
    throw new CommandError('bad_logout', 'Logout white kelvin must be from 3500 to 4000');
  }
  if (typeof brightness !== 'number' || brightness < 1 || brightness > 100) {
    throw new CommandError('bad_logout', 'Logout white brightness must be from 1 to 100');
  }
  base.color.kelvin = Math.round(kelvin);
  base.color.brightness = Math.round(brightness);
  base.color.hue = 0;
  base.color.saturation = 0;
  base.power = true;
  base.durationMs = 0;
  base.applyTo = 'all';
  base.zones = null;
  return base;
}

function normalizeSavedState(input) {
  if (!input || typeof input !== 'object') {
    throw new CommandError('bad_state', 'Saved state is required');
  }
  if (input.id === 'logout-white') {
    return normalizeLogoutState(input.color || input);
  }
  if (typeof input.id !== 'string' || input.id.length === 0) {
    throw new CommandError('bad_state', 'Saved state id is required');
  }
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new CommandError('bad_state', 'Saved state name is required');
  }
  const durationMs = input.durationMs === undefined ? 400 : input.durationMs;
  if (input.applyTo === 'all') {
    return {
      id: input.id,
      name: input.name,
      applyTo: 'all',
      power: typeof input.power === 'boolean' ? input.power : true,
      durationMs,
      color: input.color ? normalizeColor(input.color) : null,
      zones: null
    };
  }
  if (!Array.isArray(input.targets) || input.targets.length === 0) {
    throw new CommandError('bad_state', 'Saved state needs targets or applyTo all');
  }
  return {
    id: input.id,
    name: input.name,
    applyTo: 'devices',
    durationMs,
    targets: input.targets.map((target) => ({
      deviceId: String(target.deviceId),
      power: typeof target.power === 'boolean' ? target.power : null,
      color: target.color ? normalizeColor(target.color) : null,
      zones: Array.isArray(target.zones) ? target.zones.map((zone) => ({
        index: zone.index,
        ...normalizeColor(zone)
      })) : null
    }))
  };
}

function normalizeLogin(input) {
  if (!input || input.enabled === false || !input.action) {
    return { enabled: false, action: null };
  }
  if (input.action.type === 'savedState') {
    if (typeof input.action.stateId !== 'string' || input.action.stateId.length === 0) {
      throw new CommandError('bad_login', 'Login saved state id is required');
    }
    return {
      enabled: true,
      action: { type: 'savedState', stateId: input.action.stateId }
    };
  }
  if (input.action.type === 'effect') {
    const effect = createEffect(input.action.effect);
    return {
      enabled: true,
      action: {
        type: 'effect',
        effect: {
          kind: effect.kind,
          deviceId: effect.deviceId,
          intervalMs: effect.intervalMs,
          durationMs: effect.durationMs,
          step: effect.step,
          hue: effect.hue,
          saturation: effect.saturation,
          brightness: effect.brightness,
          kelvin: effect.kelvin,
          from: effect.from,
          to: effect.to,
          zoneCount: effect.zoneCount
        }
      }
    };
  }
  throw new CommandError('bad_login', 'Login action must be a saved state or a hosted effect');
}

function resolveTargets(state, devices) {
  if (state.applyTo === 'all') {
    return devices.map((device) => ({
      deviceId: device.id,
      power: state.power,
      color: state.color,
      zones: null
    }));
  }
  return state.targets;
}

async function applySavedState(player, state, options = {}) {
  const wait = options.wait !== false;
  const devices = await player.listDevices();
  const targets = resolveTargets(state, devices);
  const errors = [];
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    try {
      if (typeof target.power === 'boolean') {
        await player.setPower({
          deviceId: target.deviceId,
          on: target.power,
          durationMs: state.durationMs || 0,
          wait
        });
      }
      if (target.color) {
        await player.setColor({
          deviceId: target.deviceId,
          hue: target.color.hue,
          saturation: target.color.saturation,
          brightness: target.color.brightness,
          kelvin: target.color.kelvin,
          durationMs: state.durationMs || 0,
          wait
        });
      }
      if (target.zones && target.zones.length) {
        const writes = planZoneWrites(target.zones, state.durationMs || 0);
        await player.applyZoneWrites({
          deviceId: target.deviceId,
          writes,
          wait
        });
      }
    } catch (err) {
      errors.push({ deviceId: target.deviceId, message: err.message });
    }
  }
  return { targets: targets.length, errors };
}

async function handleSessionEvent(ctx, eventName) {
  const event = assertEvent(eventName);
  if (event === 'session-logout') {
    ctx.runtime.stopAll();
    const trigger = ctx.store.logoutTrigger();
    if (!trigger.enabled) {
      return { event, effects: 'stopped', applied: null };
    }
    const state = ctx.store.logoutState();
    const applied = await applySavedState(ctx.player, state, { wait: false });
    return { event, effects: 'stopped', applied: state.id, result: applied };
  }
  if (event === 'session-login') {
    const trigger = ctx.store.loginTrigger();
    if (!trigger.enabled || !trigger.action) {
      return { event, skipped: true };
    }
    if (trigger.action.type === 'savedState') {
      ctx.runtime.stopAll();
      const state = ctx.store.getState(trigger.action.stateId);
      const applied = await applySavedState(ctx.player, state, { wait: true });
      return { event, applied: state.id, result: applied };
    }
    if (trigger.action.type === 'effect') {
      const effect = createEffect(trigger.action.effect);
      const status = await ctx.runtime.start(effect, ctx.player);
      return { event, effect: status };
    }
    throw new CommandError('bad_login', `Unknown login action: ${trigger.action.type}`);
  }
  throw new CommandError('unknown_event', `Unhandled PC event: ${event}`);
}

module.exports = {
  PC_EVENTS,
  DEFAULT_LOGOUT_STATE,
  assertEvent,
  cloneLogoutState,
  normalizeLogoutState,
  normalizeSavedState,
  normalizeLogin,
  applySavedState,
  handleSessionEvent
};
