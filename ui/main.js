const statusEl = document.querySelector("#status");
const devicesEl = document.querySelector("#devices");
const controlsEl = document.querySelector("#controls");
const stripEl = document.querySelector("#strip");
const zonesEl = document.querySelector("#zones");

const ui = {
  devices: [],
  selectedId: null,
  loadedId: null,
  loadedColor: false,
  selectedZone: 0,
  workflows: null,
  host: null,
};

function setStatus(text) {
  statusEl.textContent = text;
}

function tauri() {
  return window.__TAURI__;
}

async function invoke(command, args) {
  const bridge = tauri();
  if (!bridge || !bridge.core) {
    throw new Error("Open StayLit from the desktop app.");
  }
  return bridge.core.invoke(command, args);
}

async function lifx(method, params) {
  return invoke("lifx_request", { method, params: params || {} });
}

function colorCss(color) {
  if (!color) {
    return "#444";
  }
  if (color.saturation < 8) {
    const t = (color.kelvin - 1500) / (9000 - 1500);
    const g = Math.round(170 + 70 * t);
    const b = Math.round(70 + 160 * t);
    return `rgb(255, ${g}, ${b})`;
  }
  const lightness = Math.max(8, Math.round(color.brightness / 2));
  return `hsl(${color.hue} ${color.saturation}% ${lightness}%)`;
}

function controls() {
  return {
    hue: Number(document.querySelector("#hue").value),
    saturation: Number(document.querySelector("#saturation").value),
    brightness: Number(document.querySelector("#brightness").value),
    kelvin: Number(document.querySelector("#kelvin").value),
    durationMs: Number(document.querySelector("#fade").value),
  };
}

function selectedDevice() {
  return ui.devices.find((device) => device.id === ui.selectedId) || null;
}

function renderSwatch() {
  document.querySelector("#swatch").style.background = colorCss(controls());
}

function renderDevices() {
  devicesEl.replaceChildren();
  if (ui.devices.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = "No lights yet. Discovery uses LAN UDP 56700.";
    devicesEl.append(empty);
    controlsEl.hidden = true;
    return;
  }
  ui.devices.forEach((device) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", device.id === ui.selectedId ? "true" : "false");
    const name = document.createElement("span");
    name.textContent = device.label || device.id;
    const meta = document.createElement("span");
    const power = device.power === true ? "on" : device.power === false ? "off" : "—";
    meta.textContent = device.online === false ? "offline" : power;
    button.append(name, meta);
    button.addEventListener("click", () => {
      ui.selectedId = device.id;
      renderDevices();
      renderControls();
    });
    item.append(button);
    devicesEl.append(item);
  });
  controlsEl.hidden = !selectedDevice();
}

function renderZones(device) {
  zonesEl.replaceChildren();
  const zones = device.zones || [];
  stripEl.hidden = false;
  zones.forEach((zone) => {
    const button = document.createElement("button");
    button.type = "button";
    button.style.background = colorCss(zone);
    button.setAttribute("aria-pressed", zone.index === ui.selectedZone ? "true" : "false");
    button.title = `Zone ${zone.index}`;
    button.addEventListener("click", () => {
      ui.selectedZone = zone.index;
      renderZones(device);
    });
    zonesEl.append(button);
  });
}

function renderControls() {
  const device = selectedDevice();
  if (!device) {
    controlsEl.hidden = true;
    return;
  }
  controlsEl.hidden = false;
  document.querySelector("#controls-title").textContent = device.label || device.id;
  if (ui.loadedId !== device.id) {
    ui.loadedId = device.id;
    ui.loadedColor = false;
    document.querySelector("#power").checked = device.power === true;
  }
  if (!ui.loadedColor && device.color) {
    ui.loadedColor = true;
    document.querySelector("#hue").value = device.color.hue;
    document.querySelector("#saturation").value = device.color.saturation;
    document.querySelector("#brightness").value = device.color.brightness;
    document.querySelector("#kelvin").value = device.color.kelvin;
    renderSwatch();
  }
  const showStrip = device.multizone === true || (device.zones && device.zones.length > 0);
  stripEl.hidden = !showStrip && device.multizone === false;
  if (device.multizone !== false) {
    stripEl.hidden = false;
    renderZones(device);
  }
  const effects = ui.workflows && ui.workflows.effects;
  const effectStatus = document.querySelector("#effect-status");
  if (effects && effects.running) {
    effectStatus.textContent = `Running ${effects.kind}${effects.lastError ? ` (${effects.lastError})` : ""}`;
  } else {
    effectStatus.textContent = "No hosted effect.";
  }
}

function loginActionValue(login) {
  if (!login || login.enabled === false || !login.action) {
    return "off";
  }
  if (login.action.type === "savedState") {
    return "look";
  }
  if (login.action.type === "effect" && login.action.effect && login.action.effect.kind) {
    return login.action.effect.kind;
  }
  return "off";
}

function renderWorkflows() {
  const data = ui.workflows;
  if (!data) {
    return;
  }
  const kelvin = document.querySelector("#logout-kelvin");
  const brightness = document.querySelector("#logout-brightness");
  const loginAction = document.querySelector("#login-action");
  if (document.activeElement !== kelvin) {
    kelvin.value = data.logout.kelvin;
  }
  if (document.activeElement !== brightness) {
    brightness.value = data.logout.brightness;
  }
  if (document.activeElement !== loginAction) {
    loginAction.value = loginActionValue(data.login);
  }
  renderControls();
}

async function refresh() {
  try {
    const listed = await lifx("list");
    ui.devices = listed.devices || [];
    if (!ui.selectedId && ui.devices[0]) {
      ui.selectedId = ui.devices[0].id;
    }
    ui.workflows = await lifx("workflows.get");
    renderDevices();
    renderWorkflows();
    setStatus(ui.devices.length ? `${ui.devices.length} light(s)` : "Looking for lights on the LAN");
  } catch (err) {
    setStatus(err.message || String(err));
  }
}

async function withDevice(fn) {
  const device = selectedDevice();
  if (!device) {
    setStatus("Select a light first.");
    return;
  }
  try {
    await fn(device);
    await refresh();
  } catch (err) {
    setStatus(err.message || String(err));
  }
}

document.querySelector("#hue").addEventListener("input", renderSwatch);
document.querySelector("#saturation").addEventListener("input", renderSwatch);
document.querySelector("#brightness").addEventListener("input", renderSwatch);
document.querySelector("#kelvin").addEventListener("input", renderSwatch);

document.querySelector("#refresh").addEventListener("click", async () => {
  try {
    const listed = await lifx("refresh");
    ui.devices = listed.devices || [];
    renderDevices();
    renderControls();
  } catch (err) {
    setStatus(err.message || String(err));
  }
});

document.querySelector("#all-off").addEventListener("click", async () => {
  try {
    await lifx("allOff", { durationMs: 0 });
    await refresh();
  } catch (err) {
    setStatus(err.message || String(err));
  }
});

document.querySelector("#apply-color").addEventListener("click", () => {
  withDevice((device) => lifx("setColor", { deviceId: device.id, ...controls() }));
});

document.querySelector("#power").addEventListener("change", (event) => {
  withDevice((device) => lifx("setPower", {
    deviceId: device.id,
    on: event.target.checked,
    durationMs: controls().durationMs,
  }));
});

document.querySelector("#save-look").addEventListener("click", () => {
  withDevice(async (device) => {
    const look = controls();
    await lifx("workflows.saveState", {
      id: "saved-look",
      name: "Saved look",
      durationMs: look.durationMs,
      targets: [{
        deviceId: device.id,
        power: document.querySelector("#power").checked,
        color: look,
        zones: device.zones,
      }],
    });
    setStatus("Saved look.");
  });
});

document.querySelector("#load-zones").addEventListener("click", () => {
  withDevice(async (device) => {
    await lifx("getZones", { deviceId: device.id });
  });
});

document.querySelector("#paint-zone").addEventListener("click", () => {
  withDevice((device) => {
    const color = controls();
    return lifx("setZones", {
      deviceId: device.id,
      durationMs: color.durationMs,
      zones: [{ index: ui.selectedZone, ...color }],
    });
  });
});

document.querySelector("#apply-gradient").addEventListener("click", () => {
  withDevice((device) => {
    const color = controls();
    const fromHue = Number(document.querySelector("#from-hue").value);
    const toHue = Number(document.querySelector("#to-hue").value);
    return lifx("setGradient", {
      deviceId: device.id,
      zoneCount: device.zones && device.zones.length ? device.zones.length : undefined,
      durationMs: color.durationMs,
      from: { hue: fromHue, saturation: color.saturation, brightness: color.brightness, kelvin: color.kelvin },
      to: { hue: toHue, saturation: color.saturation, brightness: color.brightness, kelvin: color.kelvin },
    });
  });
});

function effectSpec(kind, device) {
  const color = controls();
  if (kind === "color-cycle") {
    return {
      kind: "color-cycle",
      deviceId: device.id,
      hue: color.hue,
      saturation: color.saturation,
      brightness: color.brightness,
      kelvin: color.kelvin,
    };
  }
  if (kind === "moving-gradient") {
    const fromHue = Number(document.querySelector("#from-hue").value);
    const toHue = Number(document.querySelector("#to-hue").value);
    return {
      kind: "moving-gradient",
      deviceId: device.id,
      zoneCount: device.zones && device.zones.length ? device.zones.length : undefined,
      from: {
        hue: fromHue,
        saturation: color.saturation,
        brightness: color.brightness,
        kelvin: color.kelvin,
      },
      to: {
        hue: toHue,
        saturation: color.saturation,
        brightness: color.brightness,
        kelvin: color.kelvin,
      },
    };
  }
  throw new Error(`Unknown effect: ${kind}`);
}

document.querySelector("#start-cycle").addEventListener("click", () => {
  withDevice((device) => lifx("effects.start", effectSpec("color-cycle", device)));
});

document.querySelector("#start-gradient").addEventListener("click", () => {
  withDevice((device) => lifx("effects.start", effectSpec("moving-gradient", device)));
});

document.querySelector("#stop-effect").addEventListener("click", async () => {
  try {
    await lifx("effects.stop");
    await refresh();
  } catch (err) {
    setStatus(err.message || String(err));
  }
});

document.querySelector("#save-login").addEventListener("click", async () => {
  const choice = document.querySelector("#login-action").value;
  const device = selectedDevice();
  try {
    if (choice === "off") {
      await lifx("workflows.setLogin", { enabled: false });
    } else if (choice === "look") {
      await lifx("workflows.setLogin", {
        enabled: true,
        action: { type: "savedState", stateId: "saved-look" },
      });
    } else if (!device) {
      setStatus("Select a light for the login effect.");
      return;
    } else {
      const effect = effectSpec(choice, device);
      await lifx("workflows.setLogin", { enabled: true, action: { type: "effect", effect } });
    }
    setStatus("Login action saved. It runs when StayLit starts with the session.");
    await refresh();
  } catch (err) {
    setStatus(err.message || String(err));
  }
});

document.querySelector("#save-logout").addEventListener("click", async () => {
  try {
    await lifx("workflows.setLogout", {
      kelvin: Number(document.querySelector("#logout-kelvin").value),
      brightness: Number(document.querySelector("#logout-brightness").value),
      enabled: true,
    });
    setStatus("Logout white saved.");
    await refresh();
  } catch (err) {
    setStatus(err.message || String(err));
  }
});

document.querySelector("#run-logout").addEventListener("click", async () => {
  try {
    await lifx("session.event", { event: "session-logout" });
    setStatus("Logout white queued. Hosted effects are stopped.");
    await refresh();
  } catch (err) {
    setStatus(err.message || String(err));
  }
});

document.querySelector("#autostart").addEventListener("change", async (event) => {
  try {
    await invoke("set_autostart", { enabled: event.target.checked });
  } catch (err) {
    event.target.checked = !event.target.checked;
    setStatus(err.message || String(err));
  }
});

async function loadShell() {
  try {
    ui.host = await invoke("host_info");
    document.querySelector("#hook-note").textContent = ui.host.note;
    if (ui.host.autostartNote) {
      setStatus(ui.host.autostartNote);
    }
    const autostart = await invoke("autostart_status");
    document.querySelector("#autostart").checked = Boolean(autostart.enabled);
    document.querySelector("#autostart").disabled = autostart.supported === false;
    if (autostart.note) {
      setStatus(autostart.note);
    }
  } catch (err) {
    setStatus(err.message || String(err));
  }
}

loadShell();
refresh();
setInterval(refresh, 3000);
renderSwatch();
