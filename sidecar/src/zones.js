'use strict';

const { CommandError } = require('./protocol');

const LIMITS = {
  hueMin: 0,
  hueMax: 360,
  satMin: 0,
  satMax: 100,
  briMin: 0,
  briMax: 100,
  kelvinMin: 1500,
  kelvinMax: 9000,
  zoneMin: 0,
  zoneMax: 255,
  durationMin: 0,
  durationMax: 60000
};

function numberIn(value, min, max, label, code = 'bad_color') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CommandError(code, `${label} must be a number`);
  }
  if (value < min || value > max) {
    throw new CommandError(code, `${label} must be between ${min} and ${max}`);
  }
  return Math.round(value);
}

function normalizeColor(input) {
  if (!input || typeof input !== 'object') {
    fail('Color is required');
  }
  return {
    hue: numberIn(input.hue, LIMITS.hueMin, LIMITS.hueMax, 'hue'),
    saturation: numberIn(input.saturation, LIMITS.satMin, LIMITS.satMax, 'saturation'),
    brightness: numberIn(input.brightness, LIMITS.briMin, LIMITS.briMax, 'brightness'),
    kelvin: numberIn(input.kelvin, LIMITS.kelvinMin, LIMITS.kelvinMax, 'kelvin')
  };
}

function normalizeDuration(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  return numberIn(value, LIMITS.durationMin, LIMITS.durationMax, 'durationMs');
}

function colorsEqual(a, b) {
  return a.hue === b.hue
    && a.saturation === b.saturation
    && a.brightness === b.brightness
    && a.kelvin === b.kelvin;
}

function interpolateHue(from, to, t) {
  let delta = to - from;
  if (delta > 180) {
    delta -= 360;
  } else if (delta < -180) {
    delta += 360;
  }
  let hue = from + delta * t;
  hue %= 360;
  if (hue < 0) {
    hue += 360;
  }
  return Math.round(hue) % 360;
}

function mixColor(from, to, t) {
  return {
    hue: interpolateHue(from.hue, to.hue, t),
    saturation: Math.round(from.saturation + (to.saturation - from.saturation) * t),
    brightness: Math.round(from.brightness + (to.brightness - from.brightness) * t),
    kelvin: Math.round(from.kelvin + (to.kelvin - from.kelvin) * t)
  };
}

function buildGradient(zoneCount, fromInput, toInput) {
  if (!Number.isInteger(zoneCount) || zoneCount < 1 || zoneCount > 256) {
    throw new CommandError('bad_zones', 'zoneCount must be an integer from 1 to 256');
  }
  const from = normalizeColor(fromInput);
  const to = normalizeColor(toInput);
  if (zoneCount === 1) {
    return [{ index: 0, ...from }];
  }
  const zones = [];
  for (let index = 0; index < zoneCount; index += 1) {
    zones.push({
      index,
      ...mixColor(from, to, index / (zoneCount - 1))
    });
  }
  return zones;
}

function normalizeZone(zone) {
  if (!zone || typeof zone !== 'object') {
    throw new CommandError('bad_zones', 'Zone must be an object');
  }
  if (!Number.isInteger(zone.index)) {
    throw new CommandError('bad_zones', 'Zone index must be an integer');
  }
  if (zone.index < LIMITS.zoneMin || zone.index > LIMITS.zoneMax) {
    throw new CommandError('bad_zones', 'Zone index must be between 0 and 255');
  }
  return {
    index: zone.index,
    ...normalizeColor(zone)
  };
}

function planZoneWrites(zones, durationMs) {
  if (!Array.isArray(zones) || zones.length === 0) {
    throw new CommandError('bad_zones', 'zones must be a non-empty array');
  }
  const duration = normalizeDuration(durationMs, 0);
  const sorted = zones.map(normalizeZone).sort((a, b) => a.index - b.index);
  const seen = new Set();
  const groups = [];
  sorted.forEach((zone) => {
    if (seen.has(zone.index)) {
      throw new CommandError('bad_zones', `Duplicate zone index ${zone.index}`);
    }
    seen.add(zone.index);
    const previous = groups[groups.length - 1];
    if (previous && previous.endIndex === zone.index - 1 && colorsEqual(previous, zone)) {
      previous.endIndex = zone.index;
      return;
    }
    groups.push({
      startIndex: zone.index,
      endIndex: zone.index,
      hue: zone.hue,
      saturation: zone.saturation,
      brightness: zone.brightness,
      kelvin: zone.kelvin,
      durationMs: duration,
      apply: false
    });
  });
  groups[groups.length - 1].apply = true;
  return groups;
}

module.exports = {
  LIMITS,
  numberIn,
  normalizeColor,
  normalizeDuration,
  buildGradient,
  planZoneWrites
};
