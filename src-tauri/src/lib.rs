mod session;
mod session_end;
mod sidecar;

#[cfg(windows)]
mod session_win;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

use crate::session::{event_names, logout_hook_note, PcEvent};
use crate::session_end::{ExitDispatch, ExitReason, GATE};
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
        .manage(AutostartNote(std::sync::Mutex::new(None)))
        .setup(|app| {
            let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
            std::fs::create_dir_all(&data_dir).map_err(|err| err.to_string())?;
            let sidecar = Sidecar::spawn(&data_dir)?;
            sidecar.set_app(app.handle().clone());
            app.manage(sidecar);
            setup_tray(app.handle())?;
            #[cfg(windows)]
            {
                let _ = APP_HANDLE.set(app.handle().clone());
                if let Err(err) = session_win::install(app.handle()) {
                    eprintln!("staylit: Windows session-end hook was not installed: {err}");
                } else {
                    GATE.mark_hook_installed();
                }
            }
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
                perform(window.app_handle(), ExitReason::WindowClose);
            }
        })
        .invoke_handler(tauri::generate_handler![
            lifx_request,
            autostart_status,
            set_autostart,
            host_info
        ])
        .build(tauri::generate_context!())
        .expect("error while building StayLit")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if GATE.process_exit_is_session_end() {
                    perform(app, ExitReason::SessionEnd);
                }
            }
        });
}

fn perform(app: &AppHandle, reason: ExitReason) {
    let Some(action) = GATE.take(reason) else {
        return;
    };
    match action {
        ExitDispatch::Hide => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        ExitDispatch::StopEffects => {
            let _ = send(app, "shutdown", json!({}));
        }
        ExitDispatch::LogoutWhite => {
            let _ = send(
                app,
                "session.event",
                json!({ "event": PcEvent::SessionLogout.as_str() }),
            );
        }
    }
}

#[cfg(windows)]
fn handle_windows_session_message(msg: u32, wparam: isize) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    if session_end::classify_window_message(msg, wparam).is_some() {
        perform(app, ExitReason::SessionEnd);
    }
}

#[cfg(windows)]
static APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

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
        perform(&handle, ExitReason::TrayQuit);
        if let Some(sidecar) = handle.try_state::<Sidecar>() {
            sidecar.stop();
        }
        handle.exit(0);
    });
}

fn autostart_choice_path(data_dir: &Path) -> PathBuf {
    data_dir.join("autostart-user-choice")
}

fn autostart_choice_recorded(data_dir: &Path) -> bool {
    autostart_choice_path(data_dir).is_file()
}

fn record_autostart_choice(data_dir: &Path) -> Result<(), String> {
    if let Some(parent) = autostart_choice_path(data_dir).parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    std::fs::write(autostart_choice_path(data_dir), b"1").map_err(|err| err.to_string())
}

/// Turn autostart on only before the user has picked Start with Windows.
fn should_apply_autostart_default(currently_enabled: bool, user_has_chosen: bool) -> bool {
    !user_has_chosen && !currently_enabled
}

fn ensure_autostart_default(app: &AppHandle) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let auto = app.autolaunch();
    let enabled = auto.is_enabled().map_err(|err| err.to_string())?;
    if !should_apply_autostart_default(enabled, autostart_choice_recorded(&data_dir)) {
        return Ok(());
    }
    auto.enable().map_err(|err| err.to_string())
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
        auto.enable().map_err(|err| err.to_string())?;
    } else {
        auto.disable().map_err(|err| err.to_string())?;
    }
    let data_dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    record_autostart_choice(&data_dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn autostart_default_runs_only_before_the_user_chooses() {
        assert!(should_apply_autostart_default(false, false));
        assert!(!should_apply_autostart_default(true, false));
        assert!(!should_apply_autostart_default(false, true));
        assert!(!should_apply_autostart_default(true, true));
    }

    #[test]
    fn a_recorded_autostart_choice_blocks_the_default() {
        let dir = std::env::temp_dir().join(format!("staylit-autostart-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert!(!autostart_choice_recorded(&dir));
        assert!(should_apply_autostart_default(false, autostart_choice_recorded(&dir)));
        record_autostart_choice(&dir).expect("record choice");
        assert!(autostart_choice_recorded(&dir));
        assert!(!should_apply_autostart_default(false, autostart_choice_recorded(&dir)));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
