//! What the shell does when the window closes, the tray quits, or Windows ends the session.
//!
//! `WM_QUERYENDSESSION` (0x0011) and `WM_ENDSESSION` (0x0016) are the Win32 messages.
//! The numbers live here so the dispatch test runs on Linux. The Windows subclass
//! passes the real message through `classify_window_message`.

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
    fn windows_session_end_sends_logout_white() {
        assert_eq!(
            classify_window_message(WM_QUERYENDSESSION, 0),
            Some(ExitReason::SessionEnd)
        );
        assert_eq!(
            classify_window_message(WM_ENDSESSION, 1),
            Some(ExitReason::SessionEnd)
        );
        assert_eq!(dispatch(ExitReason::SessionEnd), ExitDispatch::LogoutWhite);
        assert_eq!(
            resolve(ExitReason::SessionEnd, false),
            ExitDispatch::LogoutWhite
        );
    }

    #[test]
    fn cancelled_endsession_and_ordinary_close_do_not_send_white() {
        assert_eq!(classify_window_message(WM_ENDSESSION, 0), None);
        assert_eq!(classify_window_message(0x0010, 0), None);
        assert_eq!(dispatch(ExitReason::WindowClose), ExitDispatch::Hide);
    }

    #[test]
    fn tray_quit_does_not_send_logout_white() {
        assert_eq!(dispatch(ExitReason::TrayQuit), ExitDispatch::StopEffects);
        assert_eq!(
            resolve(ExitReason::SessionEnd, true),
            ExitDispatch::StopEffects
        );
        assert_ne!(
            resolve(ExitReason::TrayQuit, true),
            ExitDispatch::LogoutWhite
        );
    }
}
