'use strict';

const { CommandError } = require('./protocol');
const { buildGradient, normalizeColor, numberIn, planZoneWrites } = require('./zones');

const EFFECT_KINDS = ['color-cycle', 'moving-gradient'];

function effectNumber(value, min, max, label) {
  return numberIn(value, min, max, label, 'bad_effect');
}

function normalizeEffectSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new CommandError('bad_effect', 'Effect spec is required');
  }
  if (spec.kind === 'color-cycle') {
    return {
      kind: 'color-cycle',
      deviceId: spec.deviceId === undefined || spec.deviceId === null ? null : String(spec.deviceId),
      intervalMs: Math.max(50, spec.intervalMs === undefined ? 1000 : effectNumber(spec.intervalMs, 0, 60000, 'intervalMs')),
      durationMs: spec.durationMs === undefined ? 800 : effectNumber(spec.durationMs, 0, 60000, 'durationMs'),
      step: spec.step === undefined ? 15 : effectNumber(spec.step, 1, 360, 'step'),
      hue: spec.hue === undefined ? 0 : effectNumber(spec.hue, 0, 360, 'hue'),
      saturation: spec.saturation === undefined ? 100 : effectNumber(spec.saturation, 0, 100, 'saturation'),
      brightness: spec.brightness === undefined ? 80 : effectNumber(spec.brightness, 0, 100, 'brightness'),
      kelvin: spec.kelvin === undefined ? 3500 : effectNumber(spec.kelvin, 1500, 9000, 'kelvin')
    };
  }
  if (spec.kind === 'moving-gradient') {
    if (!spec.deviceId) {
      throw new CommandError('bad_effect', 'Moving gradient needs a deviceId');
    }
    const zoneCount = spec.zoneCount === undefined || spec.zoneCount === null ? null : spec.zoneCount;
    if (zoneCount !== null && (!Number.isInteger(zoneCount) || zoneCount < 1 || zoneCount > 256)) {
      throw new CommandError('bad_effect', 'zoneCount must be an integer from 1 to 256');
    }
    return {
      kind: 'moving-gradient',
      deviceId: String(spec.deviceId),
      from: requireColor(spec.from),
      to: requireColor(spec.to),
      zoneCount,
      intervalMs: Math.max(50, spec.intervalMs === undefined ? 1000 : effectNumber(spec.intervalMs, 0, 60000, 'intervalMs')),
      durationMs: spec.durationMs === undefined ? 400 : effectNumber(spec.durationMs, 0, 60000, 'durationMs')
    };
  }
  throw new CommandError('bad_effect', `Unknown effect kind: ${spec.kind}`);
}

function requireColor(input) {
  return normalizeColor(input);
}

function createEffect(spec) {
  const data = normalizeEffectSpec(spec);
  if (data.kind === 'color-cycle') {
    return createColorCycle(data);
  }
  if (data.kind === 'moving-gradient') {
    return createMovingGradient(data);
  }
  throw new CommandError('bad_effect', `Unknown effect kind: ${data.kind}`);
}

function createColorCycle(spec) {
  return {
    kind: spec.kind,
    deviceId: spec.deviceId,
    intervalMs: spec.intervalMs,
    durationMs: spec.durationMs,
    step: spec.step,
    hue: spec.hue,
    saturation: spec.saturation,
    brightness: spec.brightness,
    kelvin: spec.kelvin,
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
  return {
    kind: spec.kind,
    deviceId: spec.deviceId,
    from: spec.from,
    to: spec.to,
    zoneCount: spec.zoneCount,
    offset: 0,
    intervalMs: spec.intervalMs,
    durationMs: spec.durationMs,
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

function delay(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(true), ms);
    if (!signal) {
      return;
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve(false);
    }, { once: true });
  });
}

class EffectRuntime {
  constructor(sleep = delay) {
    this.sleep = sleep;
    this.controller = null;
    this.state = null;
  }

  start(effect, player) {
    this.stopAll();
    const controller = new AbortController();
    this.controller = controller;
    this.state = {
      effect,
      player,
      lastError: null
    };
    let releaseReady;
    const ready = new Promise((resolve) => {
      releaseReady = resolve;
    });
    this.task = this.loop(controller.signal, releaseReady);
    return ready.then(() => this.status());
  }

  async loop(signal, releaseReady) {
    const state = this.state;
    try {
      while (!signal.aborted && state) {
        try {
          await state.effect.tick(state.player);
          if (!signal.aborted) {
            state.lastError = null;
          }
        } catch (err) {
          if (!signal.aborted) {
            state.lastError = err.message;
          }
        }
        if (releaseReady) {
          releaseReady();
          releaseReady = null;
        }
        if (signal.aborted) {
          return;
        }
        const keepGoing = await this.sleep(state.effect.intervalMs, signal);
        if (!keepGoing || signal.aborted) {
          return;
        }
      }
    } finally {
      if (releaseReady) {
        releaseReady();
      }
    }
  }

  stopAll() {
    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }
    this.state = null;
  }

  status() {
    if (!this.state) {
      return { running: false };
    }
    return {
      running: true,
      kind: this.state.effect.kind,
      deviceId: this.state.effect.deviceId,
      lastError: this.state.lastError
    };
  }
}

module.exports = {
  EFFECT_KINDS,
  normalizeEffectSpec,
  createEffect,
  EffectRuntime
};
