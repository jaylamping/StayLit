mod session;
mod sidecar;

use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

use crate::session::{event_names, logout_hook_note, plan_named, PcEvent, SessionPlan};
use crate::sidecar::Sidecar;

struct AutostartNote(Mutex<Option<String>>);

#[derive(Serialize)]
struct HostInfo {
    login: &'static str,
    events: [&'static str; 2],
    #[serde(rename = "logoutHook")]
    logout_hook: &'static str,
    note: String,
    #[serde(rename = "autostartNote")]
    autostart_note: Option<String>,
}

#[derive(Serialize)]
struct AutostartStatus {
    enabled: bool,
    supported: bool,
    note: Option<String>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(AutostartNote(Mutex::new(None)))
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
            std::fs::create_dir_all(&data_dir).map_err(|err| err.to_string())?;
            let sidecar = Sidecar::spawn(&data_dir)?;
            sidecar.set_app(app.handle().clone());
            app.manage(sidecar);
            setup_tray(app.handle())?;
            if let Err(err) = ensure_autostart_default(app.handle()) {
                if let Some(note) = app.try_state::<AutostartNote>() {
                    *note.0.lock().expect("autostart note") = Some(err);
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            lifx_request,
            autostart_status,
            set_autostart,
            session_end,
            host_info
        ])
        .build(tauri::generate_context!())
        .expect("error while building StayLit")
        .run(|_app, _event| {});
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "Open StayLit", true, None::<&str>)?;
    let all_off = MenuItem::with_id(app, "all-off", "All off", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &all_off, &quit])?;
    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"))?;
    TrayIconBuilder::with_id("staylit-tray")
        .icon(icon)
        .tooltip("StayLit")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "all-off" => {
                let handle = app.clone();
                std::thread::spawn(move || {
                    let _ = send(&handle, "allOff", json!({ "durationMs": 0 }));
                });
            }
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn send(app: &AppHandle, method: &str, params: Value) -> Result<Value, String> {
    let sidecar = app.try_state::<Sidecar>().ok_or("sidecar is not running")?;
    sidecar.request(method, params)
}

fn quit_app(app: &AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        if let Some(sidecar) = handle.try_state::<Sidecar>() {
            let _ = sidecar.request("shutdown", json!({}));
            sidecar.stop();
        }
        handle.exit(0);
    });
}

fn ensure_autostart_default(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let auto = app.autolaunch();
    match auto.is_enabled() {
        Ok(true) => Ok(()),
        Ok(false) => auto.enable().map_err(|err| err.to_string()),
        Err(err) => Err(err.to_string()),
    }
}

#[tauri::command]
fn lifx_request(app: AppHandle, method: String, params: Option<Value>) -> Result<Value, String> {
    send(&app, &method, params.unwrap_or_else(|| json!({})))
}

#[tauri::command]
fn host_info(app: AppHandle) -> HostInfo {
    let hooks = session::hooks();
    let autostart_note = app
        .try_state::<AutostartNote>()
        .and_then(|note| note.0.lock().expect("autostart note").clone());
    HostInfo {
        login: hooks.login,
        events: event_names(),
        logout_hook: hooks.logout_hook,
        note: logout_hook_note().to_string(),
        autostart_note,
    }
}

#[tauri::command]
fn autostart_status(app: AppHandle) -> AutostartStatus {
    use tauri_plugin_autostart::ManagerExt;
    match app.autolaunch().is_enabled() {
        Ok(enabled) => AutostartStatus {
            enabled,
            supported: true,
            note: None,
        },
        Err(err) => AutostartStatus {
            enabled: false,
            supported: false,
            note: Some(err.to_string()),
        },
    }
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let auto = app.autolaunch();
    if enabled {
        auto.enable().map_err(|err| err.to_string())
    } else {
        auto.disable().map_err(|err| err.to_string())
    }
}

#[tauri::command]
fn session_end(app: AppHandle) -> Result<Value, String> {
    let event = PcEvent::SessionLogout;
    match plan_named(event.as_str()).map_err(|_| "unknown session event".to_string())? {
        SessionPlan::EndOneShot => send(
            &app,
            "session.event",
            json!({ "event": event.as_str() }),
        ),
        SessionPlan::Startup => Err("session end is not a startup action".to_string()),
    }
}
