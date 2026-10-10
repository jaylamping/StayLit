'use strict';

const { CommandError } = require('./protocol');
const { createEffect, normalizeEffectSpec } = require('./effects');
const { normalizeColor, planZoneWrites } = require('./zones');

const PC_EVENTS = ['session-login', 'session-logout'];

const DEFAULT_LOGOUT = {
  kelvin: 3800,
  brightness: 100
};

function assertEvent(event) {
  if (!PC_EVENTS.includes(event)) {
    throw new CommandError('unknown_event', `Unknown PC event: ${event}`);
  }
  return event;
}

function normalizeLogout(input) {
  const source = input && typeof input === 'object' ? input : {};
  const kelvin = source.kelvin === undefined ? DEFAULT_LOGOUT.kelvin : source.kelvin;
  const brightness = source.brightness === undefined ? DEFAULT_LOGOUT.brightness : source.brightness;
  if (typeof kelvin !== 'number' || kelvin < 3500 || kelvin > 4000) {
    throw new CommandError('bad_logout', 'Logout white kelvin must be from 3500 to 4000');
  }
  if (typeof brightness !== 'number' || brightness < 1 || brightness > 100) {
    throw new CommandError('bad_logout', 'Logout white brightness must be from 1 to 100');
  }
  return {
    kelvin: Math.round(kelvin),
    brightness: Math.round(brightness)
  };
}

function normalizeSavedState(input) {
  if (!input || typeof input !== 'object') {
    throw new CommandError('bad_state', 'Saved state is required');
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
    return {
      enabled: true,
      action: {
        type: 'effect',
        effect: normalizeEffectSpec(input.action.effect)
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

async function applyLogoutWhite(player, preset, options = {}) {
  const wait = options.wait !== false;
  const devices = await player.listDevices();
  const errors = [];
  for (let i = 0; i < devices.length; i += 1) {
    const deviceId = devices[i].id;
    try {
      await player.setPower({
        deviceId,
        on: true,
        durationMs: 0,
        wait
      });
      await player.setColor({
        deviceId,
        hue: 0,
        saturation: 0,
        brightness: preset.brightness,
        kelvin: preset.kelvin,
        durationMs: 0,
        wait
      });
    } catch (err) {
      errors.push({ deviceId, message: err.message });
    }
  }
  return { targets: devices.length, errors };
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
    const preset = ctx.store.logoutPreset();
    const result = await applyLogoutWhite(ctx.player, preset, { wait: false });
    if (typeof ctx.player.flush === 'function') {
      await ctx.player.flush();
    }
    return { event, effects: 'stopped', applied: preset, result };
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
  DEFAULT_LOGOUT,
  assertEvent,
  normalizeLogout,
  normalizeSavedState,
  normalizeLogin,
  applyLogoutWhite,
  applySavedState,
  handleSessionEvent
};
