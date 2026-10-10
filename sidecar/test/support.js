'use strict';

function fakePlayer(options = {}) {
  const calls = [];
  const devices = options.devices || [
    { id: 'desk' },
    { id: 'strip' }
  ];
  const zones = options.zones || [
    { index: 0 },
    { index: 1 },
    { index: 2 },
    { index: 3 }
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
      return zones;
    },
    async allOff(args) {
      calls.push({ op: 'allOff', ...args });
    }
  };
}

function scriptedSleep() {
  let waiting = null;
  let wake = null;

  function notify() {
    if (!wake) {
      return;
    }
    const current = wake;
    wake = null;
    current();
  }

  function sleep(ms, signal) {
    return new Promise((resolve) => {
      if (signal && signal.aborted) {
        resolve(false);
        notify();
        return;
      }
      let settled = false;
      const finish = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        waiting = null;
        resolve(value);
      };
      waiting = { finish };
      if (signal) {
        signal.addEventListener('abort', () => {
          finish(false);
          notify();
        }, { once: true });
      }
      notify();
    });
  }

  return {
    sleep,
    release() {
      return new Promise((resolve, reject) => {
        const fail = setTimeout(() => {
          reject(new Error('effect loop did not settle'));
        }, 1000);
        const done = () => {
          clearTimeout(fail);
          resolve();
        };
        wake = done;
        if (!waiting) {
          done();
          return;
        }
        const current = waiting;
        waiting = null;
        wake = done;
        current.finish(true);
      });
    }
  };
}

module.exports = {
  fakePlayer,
  scriptedSleep
};
