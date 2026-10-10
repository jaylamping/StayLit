'use strict';

const { CommandError } = require('./protocol');
const { buildGradient, normalizeColor, normalizeDuration, planZoneWrites } = require('./zones');

const EFFECT_KINDS = ['color-cycle', 'moving-gradient'];

function createEffect(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new CommandError('bad_effect', 'Effect spec is required');
  }
  if (spec.kind === 'color-cycle') {
    return createColorCycle(spec);
  }
  if (spec.kind === 'moving-gradient') {
    return createMovingGradient(spec);
  }
  throw new CommandError('bad_effect', `Unknown effect kind: ${spec.kind}`);
}

function createColorCycle(spec) {
  const deviceId = spec.deviceId === undefined || spec.deviceId === null
    ? null
    : String(spec.deviceId);
  return {
    kind: 'color-cycle',
    deviceId,
    intervalMs: Math.max(50, spec.intervalMs === undefined ? 1000 : normalizeDuration(spec.intervalMs, 1000)),
    durationMs: normalizeDuration(spec.durationMs, 800),
    step: spec.step === undefined ? 15 : normalizeDuration(spec.step, 15) || 15,
    hue: spec.hue === undefined ? 0 : normalizeColor({
      hue: spec.hue,
      saturation: 0,
      brightness: 0,
      kelvin: 3500
    }).hue,
    saturation: spec.saturation === undefined ? 100 : normalizeColor({
      hue: 0,
      saturation: spec.saturation,
      brightness: 0,
      kelvin: 3500
    }).saturation,
    brightness: spec.brightness === undefined ? 80 : normalizeColor({
      hue: 0,
      saturation: 0,
      brightness: spec.brightness,
      kelvin: 3500
    }).brightness,
    kelvin: spec.kelvin === undefined ? 3500 : normalizeColor({
      hue: 0,
      saturation: 0,
      brightness: 0,
      kelvin: spec.kelvin
    }).kelvin,
    async tick(player) {
      const hue = this.hue;
      this.hue = (this.hue + this.step) % 360;
      const ids = this.deviceId ? [this.deviceId] : await player.deviceIds();
      for (let i = 0; i < ids.length; i += 1) {
        await player.setColor({
          deviceId: ids[i],
          hue,
          saturation: this.saturation,
          brightness: this.brightness,
          kelvin: this.kelvin,
          durationMs: this.durationMs,
          wait: false
        });
      }
    }
  };
}

function createMovingGradient(spec) {
  if (!spec.deviceId) {
    throw new CommandError('bad_effect', 'Moving gradient needs a deviceId');
  }
  const from = normalizeColor(spec.from);
  const to = normalizeColor(spec.to);
  const zoneCount = spec.zoneCount === undefined ? null : spec.zoneCount;
  if (zoneCount !== null && (!Number.isInteger(zoneCount) || zoneCount < 1 || zoneCount > 256)) {
    throw new CommandError('bad_effect', 'zoneCount must be an integer from 1 to 256');
  }
  return {
    kind: 'moving-gradient',
    deviceId: String(spec.deviceId),
    from,
    to,
    zoneCount,
    offset: 0,
    intervalMs: Math.max(50, spec.intervalMs === undefined ? 1000 : normalizeDuration(spec.intervalMs, 1000)),
    durationMs: normalizeDuration(spec.durationMs, 400),
    async tick(player) {
      if (!this.zoneCount) {
        const zones = await player.getZones(this.deviceId);
        this.zoneCount = zones.length;
        if (!this.zoneCount) {
          throw new CommandError('bad_effect', 'Strip has no zones yet');
        }
      }
      const base = buildGradient(this.zoneCount, this.from, this.to);
      const shifted = base.map((unused, index) => {
        const source = base[(index + this.offset) % this.zoneCount];
        return {
          index,
          hue: source.hue,
          saturation: source.saturation,
          brightness: source.brightness,
          kelvin: source.kelvin
        };
      });
      this.offset = (this.offset + 1) % this.zoneCount;
      const writes = planZoneWrites(shifted, this.durationMs);
      await player.applyZoneWrites({
        deviceId: this.deviceId,
        writes,
        wait: false
      });
    }
  };
}

class EffectRuntime {
  constructor(schedule = setInterval, clear = clearInterval) {
    this.schedule = schedule;
    this.clear = clear;
    this.job = null;
  }

  async start(effect, player) {
    this.stopAll();
    const timer = this.schedule(() => this.pump(), effect.intervalMs);
    this.job = {
      effect,
      timer,
      player,
      lastError: null
    };
    await this.pump();
    return this.status();
  }

  pump() {
    if (!this.job) {
      return Promise.resolve();
    }
    const job = this.job;
    return Promise.resolve(job.effect.tick(job.player)).then(() => {
      if (this.job === job) {
        job.lastError = null;
      }
    }).catch((err) => {
      if (this.job === job) {
        job.lastError = err.message;
      }
    });
  }

  stopAll() {
    if (!this.job) {
      return;
    }
    this.clear(this.job.timer);
    this.job = null;
  }

  status() {
    if (!this.job) {
      return { running: false };
    }
    return {
      running: true,
      kind: this.job.effect.kind,
      deviceId: this.job.effect.deviceId,
      lastError: this.job.lastError
    };
  }
}

module.exports = {
  EFFECT_KINDS,
  createEffect,
  EffectRuntime
};
