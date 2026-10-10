'use strict';

const fs = require('fs');
const path = require('path');
const { CommandError } = require('./protocol');
const {
  DEFAULT_LOGOUT,
  normalizeLogin,
  normalizeLogout,
  normalizeSavedState
} = require('./workflows');

class WorkflowStore {
  constructor(dataDir) {
    this.dataDir = dataDir || null;
    this.loadError = null;
    this.data = {
      version: 1,
      states: {},
      login: { enabled: false, action: null },
      logout: { enabled: true, ...DEFAULT_LOGOUT },
      addresses: {}
    };
    this.load();
  }

  filePath() {
    if (!this.dataDir) {
      return null;
    }
    return path.join(this.dataDir, 'workflows.json');
  }

  load() {
    const file = this.filePath();
    if (!file || !fs.existsSync(file)) {
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.data.addresses = parsed.addresses && typeof parsed.addresses === 'object'
        ? parsed.addresses
        : {};
      this.data.login = normalizeLogin(parsed.login);
      this.data.states = {};
      const states = parsed.states || {};
      const legacyLogout = states['logout-white'];
      Object.keys(states).forEach((id) => {
        if (id === 'logout-white') {
          return;
        }
        this.data.states[id] = normalizeSavedState(states[id]);
      });
      const legacySource = legacyLogout && (legacyLogout.color || legacyLogout);
      const logoutSource = parsed.logout && parsed.logout.kelvin !== undefined
        ? parsed.logout
        : legacySource;
      this.data.logout = {
        enabled: !(parsed.logout && parsed.logout.enabled === false),
        ...normalizeLogout(logoutSource || {})
      };
    } catch (err) {
      this.loadError = err.message;
    }
  }

  save() {
    const file = this.filePath();
    if (!file) {
      return;
    }
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.data, null, 2));
  }

  logoutPreset() {
    return {
      kelvin: this.data.logout.kelvin,
      brightness: this.data.logout.brightness
    };
  }

  logoutTrigger() {
    return this.data.logout;
  }

  loginTrigger() {
    return this.data.login;
  }

  getState(id) {
    const state = this.data.states[id];
    if (!state) {
      throw new CommandError('bad_state', `Unknown saved state: ${id}`);
    }
    return state;
  }

  rememberAddress(id, address) {
    if (!id || !address || this.data.addresses[id] === address) {
      return;
    }
    this.data.addresses[id] = address;
    this.save();
  }

  knownAddresses() {
    return Object.values(this.data.addresses);
  }

  setLogout(patch) {
    const source = patch || {};
    this.data.logout = {
      enabled: source.enabled !== false,
      ...normalizeLogout(source)
    };
    this.save();
    return this.snapshot();
  }

  setLogin(input) {
    if (input && input.action && input.action.type === 'savedState') {
      this.getState(input.action.stateId);
    }
    this.data.login = normalizeLogin(input);
    this.save();
    return this.snapshot();
  }

  saveState(input) {
    const state = normalizeSavedState(input);
    this.data.states[state.id] = state;
    this.save();
    return state;
  }

  snapshot() {
    return {
      login: this.data.login,
      logout: { ...this.data.logout },
      states: this.data.states,
      addresses: this.data.addresses,
      loadError: this.loadError
    };
  }
}

module.exports = {
  WorkflowStore
};
