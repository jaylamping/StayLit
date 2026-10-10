//! Registers a window subclass for `WM_QUERYENDSESSION` and `WM_ENDSESSION`.
//! This file is Windows-only. The decision of what those messages mean is in
//! `session_end`, which the subclass calls before the default handler returns.

use tauri::Manager;
use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};

use crate::session_end::{WM_ENDSESSION, WM_QUERYENDSESSION};

const SUBCLASS_ID: usize = 0x5354_4159;

const _: () = assert!(
    WM_QUERYENDSESSION == windows::Win32::UI::WindowsAndMessaging::WM_QUERYENDSESSION
        && WM_ENDSESSION == windows::Win32::UI::WindowsAndMessaging::WM_ENDSESSION
);

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("main window is missing")?;
    let hwnd = window.hwnd().map_err(|err| err.to_string())?;
    unsafe {
        let installed = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
        if installed == 0 {
            return Err("SetWindowSubclass failed".to_string());
        }
    }
    Ok(())
}

unsafe extern "system" fn subclass_proc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uidsubclass: usize,
    _dwrefdata: usize,
) -> LRESULT {
    if msg == WM_QUERYENDSESSION || msg == WM_ENDSESSION {
        let _ = std::panic::catch_unwind(|| {
            crate::handle_windows_session_message(msg, wparam.0 as isize);
        });
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}
