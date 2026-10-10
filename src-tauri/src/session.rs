//! PC events the shell can deliver to the Node host.
//!
//! Login is not an OS notification. The tray process starts with the user
//! session, and that start is the login trigger.
//! Logout is a one-shot on the session-end path. It is best-effort: this
//! build does not install a Windows service, and on Linux there is no
//! session hook. Add lock, unlock, or idle as new variants here and in the
//! sidecar `PC_EVENTS` list.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PcEvent {
    SessionLogin,
    SessionLogout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionPlan {
    /// Process start. The host may apply a saved state or start a hosted effect.
    Startup,
    /// Stop hosted effects, send the saved logout state, and return.
    EndOneShot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SessionHooks {
    pub login: &'static str,
    pub logout_hook: &'static str,
}

impl PcEvent {
    pub fn as_str(self) -> &'static str {
        match self {
            PcEvent::SessionLogin => "session-login",
            PcEvent::SessionLogout => "session-logout",
        }
    }

    pub fn parse(value: &str) -> Result<Self, ()> {
        match value {
            "session-login" => Ok(PcEvent::SessionLogin),
            "session-logout" => Ok(PcEvent::SessionLogout),
            _ => Err(()),
        }
    }
}

pub fn plan(event: PcEvent) -> SessionPlan {
    match event {
        PcEvent::SessionLogin => SessionPlan::Startup,
        PcEvent::SessionLogout => SessionPlan::EndOneShot,
    }
}

pub fn plan_named(name: &str) -> Result<SessionPlan, ()> {
    PcEvent::parse(name).map(plan)
}

pub fn event_names() -> [&'static str; 2] {
    [PcEvent::SessionLogin.as_str(), PcEvent::SessionLogout.as_str()]
}

pub fn hooks() -> SessionHooks {
    SessionHooks {
        login: "process-start",
        #[cfg(windows)]
        logout_hook: "windows-stub",
        #[cfg(not(windows))]
        logout_hook: "skipped",
    }
}

pub fn logout_hook_note() -> &'static str {
    match hooks().logout_hook {
        "windows-stub" => {
            "Logout white is a one-shot on the session-end path. This build does not register WM_ENDSESSION, and it is not a Windows service. Closing the window leaves effects running. Quitting the tray stops them without sending the logout white."
        }
        _ => {
            "Linux does not hook the desktop session. Login runs when StayLit starts. Logout white is not sent automatically here; the session-end command still stops effects and queues that one-shot."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_starts_work_and_logout_is_one_shot() {
        assert_eq!(plan(PcEvent::SessionLogin), SessionPlan::Startup);
        assert_eq!(plan(PcEvent::SessionLogout), SessionPlan::EndOneShot);
        assert_eq!(PcEvent::SessionLogout.as_str(), "session-logout");
    }

    #[test]
    fn future_events_are_rejected_until_added_as_variants() {
        assert!(PcEvent::parse("session-lock").is_err());
        assert!(PcEvent::parse("session-unlock").is_err());
        assert!(PcEvent::parse("idle").is_err());
        assert_eq!(PcEvent::parse("session-login").unwrap(), PcEvent::SessionLogin);
    }

    #[test]
    fn this_platform_does_not_install_a_service_hook() {
        let hooks = hooks();
        assert_eq!(hooks.login, "process-start");
        #[cfg(windows)]
        assert_eq!(hooks.logout_hook, "windows-stub");
        #[cfg(not(windows))]
        assert_eq!(hooks.logout_hook, "skipped");
    }
}
