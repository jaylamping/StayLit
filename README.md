# StayLit

StayLit is a small Windows tray app for LIFX bulbs on your local network. LIFX no longer ships a Windows desktop app, and running color effects from a phone keeps the screen on and drains the battery. StayLit runs those effects on your PC instead, over plain LAN control—no LIFX account and no cloud.

If you have LIFX lights on the same Wi‑Fi or Ethernet as a Windows machine you leave on, this is for you.

## What it does

StayLit is built with Tauri 2. Rust owns the system tray, the window, and optional start-with-Windows. A Node sidecar talks to bulbs with the LIFX LAN protocol on UDP port 56700 (via `lifx-lan-client`).

**Tray and window**

- Closing the window hides it; hosted effects keep running in the background.
- Quit from the tray stops hosted effects and exits the app.
- The tray menu can open the window, turn all discovered lights off, or quit.

**Everyday control**

- Discover lights on the LAN and refresh their state.
- Power, color, kelvin, brightness, and fade duration per bulb.
- LIFX multizone strips: read zones, paint a zone, apply a one-shot gradient along the strip.

**Hosted effects**

These run on timers inside the sidecar until you stop them or quit the tray:

- **Color cycle** — steps hue on one bulb or all discovered bulbs.
- **Moving gradient** — shifts a gradient along a multizone strip.

Manual color changes stop a running hosted effect.

**Session login and logout**

“Login” here means StayLit started with your Windows user session (including start-with-Windows). On startup it can optionally apply a saved lighting state or start a hosted effect you configured.

“Logout” is a one-shot: turn lights on and set a warm white (default 3800 K, full brightness), then stop hosted effects. On Windows this runs when the session ends (`WM_QUERYENDSESSION` / `WM_ENDSESSION`). Quitting from the tray does **not** send the logout white. On Linux the desktop session is not hooked; you can trigger the same white manually from the UI. This behavior is covered by automated tests on Linux.

**Network**

- Bulbs must be on the same LAN as the PC. Guest Wi‑Fi or AP isolation often blocks discovery.
- The first run on Windows may ask to allow StayLit on private networks (Windows Firewall).
- When a bulb is seen once, its address is remembered so rediscovery can still reach it.

## What it does not do

- No LIFX cloud API, account sign-in, or control from outside your home network.
- No Windows service, installer package, schedules, music sync, or browsable effects catalog.
- No macOS or mobile app in this repo—development targets Windows; Linux builds exist mainly for tests.

## Run

You need Node.js on your `PATH`, Rust with Cargo, and the usual Tauri 2 prerequisites for your platform.

```sh
npm install
cargo run --manifest-path src-tauri/Cargo.toml
```

## Tests

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```
