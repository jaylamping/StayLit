# StayLit

Desktop hub for Joey’s LIFX lights. The office PC runs the effects so a phone does not have to.

StayLit is a Tauri 2 tray app. Rust owns the tray, the window, and start-with-Windows. A Node sidecar speaks the LIFX LAN protocol on UDP 56700. The window is only the UI: closing it hides to the tray and leaves hosted effects running. Quitting from the tray stops those effects.

There is no LIFX account, cloud API, or Windows service. He is logged in while effects run. Login means the app started with the session. Logout is a one-shot white (default 3800K, full brightness) on the session-end path, then the effect loop stops.

## Run

```sh
npm install
cargo run --manifest-path src-tauri/Cargo.toml
```

Node has to be on `PATH`. Bulbs have to be on the same LAN. This machine cannot see his lights, so discovery will stay empty here.

## Tests

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --manifest-path src-tauri/Cargo.toml
```
