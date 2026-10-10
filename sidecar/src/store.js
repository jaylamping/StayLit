'use strict';

const fs = require('fs');
const path = require('path');
const { CommandError } = require('./protocol');
const {
  cloneLogoutState,
  normalizeLogin,
  normalizeLogoutState,
  normalizeSavedState
} = require('./workflows');

class WorkflowStore {
  constructor(dataDir) {
    this.dataDir = dataDir || null;
    this.loadError = null;
    this.data = {
      version: 1,
      states: { 'logout-white': cloneLogoutState() },
      login: { enabled: false, action: null },
      logout: { enabled: true, stateId: 'logout-white' },
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
      this.data.states = { 'logout-white': cloneLogoutState() };
      const states = parsed.states || {};
      Object.keys(states).forEach((id) => {
        if (id === 'logout-white') {
          const source = states[id].color || states[id];
          this.data.states[id] = normalizeLogoutState({
            kelvin: source.kelvin,
            brightness: source.brightness
          });
          return;
        }
        this.data.states[id] = normalizeSavedState(states[id]);
      });
      this.data.logout.enabled = !(parsed.logout && parsed.logout.enabled === false);
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

  logoutState() {
    return this.data.states['logout-white'];
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
    this.data.states['logout-white'] = normalizeLogoutState(patch || {});
    this.data.logout.enabled = !patch || patch.enabled !== false;
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
      logout: { ...this.data.logout, state: this.logoutState() },
      states: this.data.states,
      addresses: this.data.addresses,
      loadError: this.loadError
    };
  }
}

module.exports = {
  WorkflowStore
};
