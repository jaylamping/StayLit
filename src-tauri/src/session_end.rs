//! What the shell does when the window closes, the tray quits, or Windows ends the session.
//!
//! `WM_QUERYENDSESSION` (0x0011) and `WM_ENDSESSION` (0x0016) are the Win32 messages.
//! The numbers live here so the dispatch test runs on Linux. The Windows subclass
//! passes the real message through `classify_window_message`.
//!
//! Both messages are the same session end. `ExitGate::take` performs that end once.
//! Process exit is a session end only when the subclass hook is not installed.

use std::sync::atomic::{AtomicBool, Ordering};

#[cfg_attr(not(windows), allow(dead_code))]
pub const WM_QUERYENDSESSION: u32 = 0x0011;
#[cfg_attr(not(windows), allow(dead_code))]
pub const WM_ENDSESSION: u32 = 0x0016;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitReason {
    /// Quit on the tray menu. Stop effects. Do not send logout white.
    TrayQuit,
    /// Windows is ending the logon session.
    SessionEnd,
    /// Title-bar close. Hide the window and leave effects running.
    WindowClose,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExitDispatch {
    Hide,
    StopEffects,
    LogoutWhite,
}

pub struct ExitGate {
    tray_quit: AtomicBool,
    logout_sent: AtomicBool,
    hook_installed: AtomicBool,
}

impl ExitGate {
    pub const fn new() -> Self {
        Self {
            tray_quit: AtomicBool::new(false),
            logout_sent: AtomicBool::new(false),
            hook_installed: AtomicBool::new(false),
        }
    }

    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn mark_hook_installed(&self) {
        self.hook_installed.store(true, Ordering::SeqCst);
    }

    /// Windows process exit sends logout white only when the session hook is absent.
    /// With the hook installed, the subclass is the one session end.
    pub fn process_exit_is_session_end(&self) -> bool {
        cfg!(windows) && !self.hook_installed.load(Ordering::SeqCst)
    }

    /// One decision for this call. `None` means the call is not a new action.
    pub fn take(&self, reason: ExitReason) -> Option<ExitDispatch> {
        if matches!(reason, ExitReason::TrayQuit) {
            self.tray_quit.store(true, Ordering::SeqCst);
        }
        let tray_quit = self.tray_quit.load(Ordering::SeqCst);
        if matches!(reason, ExitReason::SessionEnd) && tray_quit {
            return None;
        }
        let action = if matches!(reason, ExitReason::WindowClose) {
            dispatch(reason)
        } else {
            resolve(reason, tray_quit)
        };
        match action {
            ExitDispatch::LogoutWhite => {
                if self.logout_sent.swap(true, Ordering::SeqCst) {
                    None
                } else {
                    Some(ExitDispatch::LogoutWhite)
                }
            }
            other => Some(other),
        }
    }
}

pub static GATE: ExitGate = ExitGate::new();

#[cfg_attr(not(windows), allow(dead_code))]
pub fn classify_window_message(msg: u32, wparam: isize) -> Option<ExitReason> {
    match msg {
        WM_QUERYENDSESSION => Some(ExitReason::SessionEnd),
        WM_ENDSESSION if wparam != 0 => Some(ExitReason::SessionEnd),
        _ => None,
    }
}

pub fn dispatch(reason: ExitReason) -> ExitDispatch {
    match reason {
        ExitReason::TrayQuit => ExitDispatch::StopEffects,
        ExitReason::SessionEnd => ExitDispatch::LogoutWhite,
        ExitReason::WindowClose => ExitDispatch::Hide,
    }
}

/// Tray quit wins over a session message so a logoff that races Quit still skips the white.
pub fn resolve(reason: ExitReason, tray_quit: bool) -> ExitDispatch {
    if tray_quit {
        ExitDispatch::StopEffects
    } else {
        dispatch(reason)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_session_end_sends_logout_white_once() {
        assert_eq!(
            classify_window_message(WM_QUERYENDSESSION, 0),
            Some(ExitReason::SessionEnd)
        );
        assert_eq!(
            classify_window_message(WM_ENDSESSION, 1),
            Some(ExitReason::SessionEnd)
        );
        let gate = ExitGate::new();
        assert_eq!(gate.take(ExitReason::SessionEnd), Some(ExitDispatch::LogoutWhite));
        assert_eq!(gate.take(ExitReason::SessionEnd), None);
    }

    #[test]
    fn cancelled_endsession_and_ordinary_close_do_not_send_white() {
        assert_eq!(classify_window_message(WM_ENDSESSION, 0), None);
        assert_eq!(classify_window_message(0x0010, 0), None);
        let gate = ExitGate::new();
        assert_eq!(gate.take(ExitReason::WindowClose), Some(ExitDispatch::Hide));
    }

    #[test]
    fn tray_quit_does_not_send_logout_white() {
        let gate = ExitGate::new();
        assert_eq!(gate.take(ExitReason::TrayQuit), Some(ExitDispatch::StopEffects));
        assert_eq!(gate.take(ExitReason::SessionEnd), None);
        assert_eq!(
            resolve(ExitReason::SessionEnd, true),
            ExitDispatch::StopEffects
        );
    }

    #[test]
    fn process_exit_is_not_a_second_session_end_when_the_hook_is_installed() {
        let gate = ExitGate::new();
        gate.mark_hook_installed();
        assert!(!gate.process_exit_is_session_end());
    }
}
