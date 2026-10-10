'use strict';

const { CommandError, errorLine, okLine, parseRequest } = require('./protocol');
const { EffectRuntime, createEffect } = require('./effects');
const { buildGradient, normalizeColor, normalizeDuration, planZoneWrites } = require('./zones');
const { handleSessionEvent } = require('./workflows');
const { WorkflowStore } = require('./store');
const { createLifxPlayer } = require('./lifx-player');

class Host {
  constructor(player, store, runtime) {
    this.player = player;
    this.store = store;
    this.runtime = runtime;
    this.lastSession = null;
  }

  async handleLine(line) {
    const parsed = parseRequest(line);
    if (!parsed.ok) {
      return errorLine(parsed.id, parsed.code, parsed.message);
    }
    try {
      const result = await this.dispatch(parsed.request.method, parsed.request.params);
      return okLine(parsed.request.id, result);
    } catch (err) {
      const code = err.code || 'command_failed';
      return errorLine(parsed.request.id, code, err.message);
    }
  }

  async dispatch(method, params) {
    if (writesBulbs(method)) {
      this.runtime.stopAll();
    }
    switch (method) {
      case 'ping':
        return { pong: true };
      case 'list':
        return { devices: await this.player.listDevices() };
      case 'refresh':
        return { devices: await this.player.refresh() };
      case 'setPower':
        await this.player.setPower({
          deviceId: requireDevice(params.deviceId),
          on: requireBool(params.on),
          durationMs: normalizeDuration(params.durationMs, 400),
          wait: true
        });
        return { ok: true };
      case 'setColor':
        await this.player.setColor({
          deviceId: requireDevice(params.deviceId),
          ...normalizeColor(params),
          durationMs: normalizeDuration(params.durationMs, 400),
          wait: true
        });
        return { ok: true };
      case 'setColors':
        return this.setColors(params);
      case 'setPowers':
        return this.setPowers(params);
      case 'getZones':
        return { zones: await this.player.getZones(requireDevice(params.deviceId)) };
      case 'setZones':
        return this.writeZones(requireDevice(params.deviceId), params.zones, params.durationMs);
      case 'setGradient':
        return this.writeGradient(params);
      case 'allOff':
        await this.player.allOff({
          durationMs: normalizeDuration(params.durationMs, 0),
          wait: true
        });
        return { ok: true, effects: this.runtime.status() };
      case 'effects.list':
        return this.runtime.status();
      case 'effects.start':
        return this.runtime.start(createEffect(params), this.player);
      case 'effects.stop':
        this.runtime.stopAll();
        return this.runtime.status();
      case 'workflows.get':
        return {
          ...this.store.snapshot(),
          effects: this.runtime.status(),
          lastSession: this.lastSession
        };
      case 'workflows.saveState':
        return this.store.saveState(params);
      case 'workflows.setLogin':
        return this.store.setLogin(params);
      case 'workflows.setLogout':
        return this.store.setLogout(params);
      case 'session.event':
        this.lastSession = await handleSessionEvent(this, params.event);
        return this.lastSession;
      case 'shutdown':
        return this.shutdown();
      default:
        throw new CommandError('unknown_method', `Unknown method: ${method}`);
    }
  }

  async setColors(params) {
    const lights = requireList(params.lights, 'lights');
    const durationMs = normalizeDuration(params.durationMs, 400);
    const results = await Promise.all(lights.map((item) => settle(item && item.deviceId, async () => {
      await this.player.setColor({
        deviceId: requireDevice(item.deviceId),
        ...normalizeColor(item),
        durationMs,
        wait: true
      });
    })));
    return { results };
  }

  async setPowers(params) {
    const deviceIds = requireList(params.deviceIds, 'deviceIds');
    const on = requireBool(params.on);
    const durationMs = normalizeDuration(params.durationMs, 400);
    const results = await Promise.all(deviceIds.map((deviceId) => settle(deviceId, async () => {
      await this.player.setPower({ deviceId: requireDevice(deviceId), on, durationMs, wait: true });
    })));
    return { results };
  }

  async writeZones(deviceId, zones, durationMs) {
    const writes = planZoneWrites(zones, normalizeDuration(durationMs, 400));
    await this.player.applyZoneWrites({ deviceId, writes, wait: true });
    return { writes };
  }

  async writeGradient(params) {
    const deviceId = requireDevice(params.deviceId);
    let zoneCount = params.zoneCount;
    if (!zoneCount) {
      const zones = await this.player.getZones(deviceId);
      zoneCount = zones.length;
    }
    const zones = buildGradient(zoneCount, params.from, params.to);
    const writes = planZoneWrites(zones, normalizeDuration(params.durationMs, 400));
    await this.player.applyZoneWrites({ deviceId, writes, wait: true });
    return { zones, writes };
  }

  shutdown() {
    this.runtime.stopAll();
    return { stopped: true, effects: this.runtime.status() };
  }
}

function writesBulbs(method) {
  switch (method) {
    case 'setPower':
    case 'setColor':
    case 'setColors':
    case 'setPowers':
    case 'setZones':
    case 'setGradient':
    case 'allOff':
      return true;
    default:
      return false;
  }
}

function requireDevice(deviceId) {
  if (typeof deviceId !== 'string' || deviceId.length === 0) {
    throw new CommandError('bad_device', 'deviceId is required');
  }
  return deviceId;
}

function requireList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new CommandError('bad_request', `${label} must be a non-empty list`);
  }
  return value;
}

async function settle(deviceId, run) {
  try {
    await run();
    return { deviceId, ok: true };
  } catch (err) {
    return { deviceId, ok: false, error: err.message };
  }
}

function requireBool(value) {
  if (typeof value !== 'boolean') {
    throw new CommandError('bad_request', 'on must be a boolean');
  }
  return value;
}

function createHost(options = {}) {
  const store = options.store || new WorkflowStore(options.dataDir || null);
  const runtime = options.runtime || new EffectRuntime(options.sleep, options.onFrame || null);
  let player = options.player;
  if (!player) {
    player = createLifxPlayer(store);
  }
  if (typeof player.start === 'function' && options.player === undefined) {
    player.start();
  }
  return new Host(player, store, runtime);
}

async function runStartupLogin(host) {
  const trigger = host.store.loginTrigger();
  if (!trigger.enabled || !trigger.action) {
    host.lastSession = { event: 'session-login', skipped: true };
    return host.lastSession;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const devices = await host.player.listDevices();
    if (devices.length > 0) {
      break;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 400);
    });
  }
  return host.dispatch('session.event', { event: 'session-login' });
}

module.exports = {
  Host,
  createHost,
  runStartupLogin
};
