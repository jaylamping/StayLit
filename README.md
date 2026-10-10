# StayLit

Windows tray app for LIFX lights on the local network. LIFX no longer ships a Windows app. Effects that used to run on a phone keep that screen awake and drain the battery. StayLit runs them on the PC. No LIFX account, no cloud.

Tauri 2 owns the tray, the window, and start-with-Windows. A Node sidecar speaks the LIFX LAN protocol on UDP 56700. Closing the window hides it and leaves hosted effects running. Quitting from the tray stops those effects.

The tray can open the window, turn all lights off, or quit. You can set power, color, kelvin, brightness, and fade on a bulb. A multizone strip can be read per zone, painted per zone, or given a one-shot gradient.

Two effects run on timers in the sidecar until you stop them or quit:

- Color cycle steps hue on one bulb, or on every discovered bulb.
- Moving gradient shifts a gradient along a strip.

A manual color or power change stops the effect that is running.

Login means the process started with the Windows session. That start can apply a saved state or start a hosted effect. Logout sends one white, default 3800K at full brightness, and stops effects. On Windows that white goes out from `WM_QUERYENDSESSION` and `WM_ENDSESSION`. Quitting the tray stops effects and skips that white. Linux has no logoff hook. The window can send the same white, and that path is unit-tested.

Bulbs have to be on the same LAN. Guest Wi-Fi or AP isolation blocks discovery. The first launch can show a Windows Firewall prompt for private networks. A bulb's address is remembered after it is seen once.

Out of this version: a Windows service, an installer, schedules, music sync, an effects catalog, macOS, and a phone app. Linux is for development and tests.

## Run

Node has to be on `PATH`. You also need Rust and Cargo.

```sh
npm install
npm run dev
cargo run --manifest-path src-tauri/Cargo.toml
```

`npm run dev` opens the window in a browser so the layout can be tried without a bulb on the network. The Cargo command is the tray app.

## Tests

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```
