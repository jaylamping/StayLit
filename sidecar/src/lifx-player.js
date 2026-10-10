'use strict';

const { Client } = require('lifx-lan-client');
const { CommandError } = require('./protocol');
const { normalizeColor } = require('./zones');

function callNode(fn) {
  return new Promise((resolve, reject) => {
    fn((err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

async function callRetry(fn) {
  try {
    return await callNode(fn);
  } catch (err) {
    return callNode(fn);
  }
}

function normalizeLibraryColor(color) {
  if (!color) {
    return null;
  }
  return normalizeColor({
    hue: color.hue,
    saturation: color.saturation,
    brightness: color.brightness,
    kelvin: color.kelvin
  });
}

function zoneColors(color) {
  if (Array.isArray(color)) {
    return color;
  }
  if (!color) {
    return [];
  }
  return [color];
}

async function readZones(light) {
  const probe = await callRetry((cb) => light.getColorZones(0, 0, cb));
  const count = probe && probe.count ? probe.count : 0;
  if (count <= 0) {
    return [];
  }
  const zones = [];
  for (let start = 0; start < count; start += 8) {
    const end = Math.min(count - 1, start + 7);
    const chunk = await callRetry((cb) => light.getColorZones(start, end, cb));
    const colors = zoneColors(chunk && chunk.color);
    const span = end - start + 1;
    for (let offset = 0; offset < span; offset += 1) {
      if (!colors[offset]) {
        break;
      }
      zones.push({ index: start + offset, ...normalizeLibraryColor(colors[offset]) });
    }
  }
  return zones;
}

function sendZoneWrite(light, write, wait) {
  const send = (cb) => light.colorZones(
    write.startIndex,
    write.endIndex,
    write.hue,
    write.saturation,
    write.brightness,
    write.kelvin,
    write.durationMs,
    write.apply,
    cb
  );
  if (wait) {
    return callRetry(send);
  }
  send();
  return Promise.resolve();
}

class LifxPlayer {
  constructor(client, store) {
    this.client = client;
    this.store = store;
    this.lights = new Map();
    this.snapshots = new Map();
    this.startError = null;
  }

  start() {
    this.client.on('light-new', (light) => {
      this.track(light, true);
    });
    this.client.on('light-online', (light) => {
      this.track(light, true);
    });
    this.client.on('light-offline', (light) => {
      const snap = this.snapshots.get(light.id);
      if (snap) {
        snap.online = false;
      }
    });
    try {
      this.client.init({
        lights: this.store.knownAddresses(),
        startDiscovery: true,
        messageHandlerTimeout: 2500,
        discoveryInterval: 5000,
        lightOfflineTolerance: 3
      });
    } catch (err) {
      this.startError = err.message;
    }
  }

  track(light, online) {
    this.lights.set(light.id, light);
    const snap = this.snapshots.get(light.id) || {
      id: light.id,
      address: light.address,
      label: light.label || light.id,
      online,
      power: null,
      color: null,
      multizone: null,
      productName: null,
      zones: null,
      error: null
    };
    snap.address = light.address;
    snap.online = online;
    if (light.label) {
      snap.label = light.label;
    }
    this.snapshots.set(light.id, snap);
    this.store.rememberAddress(light.id, light.address);
    this.refreshOne(light.id).catch((err) => {
      snap.error = err.message;
    });
  }

  requireLight(deviceId) {
    const light = this.lights.get(deviceId);
    if (!light) {
      throw new CommandError('unknown_device', `Unknown device: ${deviceId}`);
    }
    return light;
  }

  async listDevices() {
    return [...this.snapshots.values()].map((snap) => ({ ...snap, zones: snap.zones ? snap.zones.map((zone) => ({ ...zone })) : null }));
  }

  async deviceIds() {
    return [...this.snapshots.keys()];
  }

  async refresh() {
    const ids = await this.deviceIds();
    for (let i = 0; i < ids.length; i += 1) {
      try {
        await this.refreshOne(ids[i]);
      } catch (err) {
        const snap = this.snapshots.get(ids[i]);
        if (snap) {
          snap.error = err.message;
        }
      }
    }
    return this.listDevices();
  }

  async refreshOne(deviceId) {
    const light = this.requireLight(deviceId);
    const state = await callRetry((cb) => light.getState(cb));
    const snap = this.snapshots.get(deviceId);
    snap.power = state.power === 1;
    snap.color = normalizeLibraryColor(state.color);
    if (state.label) {
      snap.label = state.label;
    }
    snap.online = light.status !== 'off';
    snap.address = light.address;
    snap.error = null;
    this.store.rememberAddress(deviceId, light.address);
    if (snap.multizone === null) {
      try {
        const hardware = await callRetry((cb) => light.getHardwareVersion(cb));
        const features = hardware && hardware.productFeatures;
        snap.productName = hardware && hardware.productName ? hardware.productName : null;
        snap.multizone = Boolean(features && features.multizone);
        if (features && features.color === false) snap.hasColor = false;
        else if (features && features.color === true) snap.hasColor = true;
      } catch (err) {
        snap.multizone = false;
        snap.error = err.message;
      }
    }
    if (snap.multizone) {
      snap.zones = await readZones(light);
    }
    return snap;
  }

  async setPower({ deviceId, on, durationMs, wait }) {
    const light = this.requireLight(deviceId);
    const duration = durationMs || 0;
    if (wait) {
      await callRetry((cb) => (on ? light.on(duration, cb) : light.off(duration, cb)));
    } else if (on) {
      light.on(duration);
    } else {
      light.off(duration);
    }
    const snap = this.snapshots.get(deviceId);
    if (snap) {
      snap.power = on;
    }
  }

  async setColor({ deviceId, hue, saturation, brightness, kelvin, durationMs, wait }) {
    const light = this.requireLight(deviceId);
    const color = normalizeColor({ hue, saturation, brightness, kelvin });
    const duration = durationMs || 0;
    if (wait) {
      await callRetry((cb) => light.color(color.hue, color.saturation, color.brightness, color.kelvin, duration, cb));
    } else {
      light.color(color.hue, color.saturation, color.brightness, color.kelvin, duration);
    }
    const snap = this.snapshots.get(deviceId);
    if (snap) {
      snap.color = color;
    }
  }

  async applyZoneWrites({ deviceId, writes, wait }) {
    const light = this.requireLight(deviceId);
    for (let i = 0; i < writes.length; i += 1) {
      await sendZoneWrite(light, writes[i], wait);
    }
    const snap = this.snapshots.get(deviceId);
    if (snap) {
      snap.multizone = true;
    }
  }

  async getZones(deviceId) {
    const light = this.requireLight(deviceId);
    const zones = await readZones(light);
    const snap = this.snapshots.get(deviceId);
    if (snap) {
      snap.zones = zones;
      if (zones.length > 1) {
        snap.multizone = true;
      }
    }
    return zones;
  }

  async allOff({ durationMs, wait }) {
    const ids = await this.deviceIds();
    for (let i = 0; i < ids.length; i += 1) {
      await this.setPower({
        deviceId: ids[i],
        on: false,
        durationMs,
        wait
      });
    }
  }

  flush() {
    return new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }

  destroy() {
    try {
      this.client.destroy();
    } catch (err) {
      this.startError = err.message;
    }
  }
}

function createLifxPlayer(store) {
  return new LifxPlayer(new Client(), store);
}

module.exports = {
  LifxPlayer,
  createLifxPlayer,
  readZones
};
