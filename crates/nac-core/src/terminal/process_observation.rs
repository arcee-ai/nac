//! Launch-owned cached process facts; no observer performs OS inspection.

use std::collections::HashMap;
use std::sync::Weak;
use std::time::Duration;
use tokio::sync::Mutex;

use super::session::TerminalSession;

pub(super) fn start(
    sessions: Weak<Mutex<HashMap<String, TerminalSession>>>,
    name: String,
    incarnation: String,
) {
    tokio::spawn(async move {
        loop {
            let keep_sampling = {
                let Some(owner) = sessions.upgrade() else {
                    return;
                };
                let result = match owner.try_lock() {
                    Ok(mut sessions) => {
                        let Some(session) = sessions.get_mut(&name) else {
                            return;
                        };
                        if session.output_id() != incarnation {
                            return;
                        }
                        session.cache_process_exit_observation()
                    }
                    Err(_) => true,
                };
                result
            }; // Release the map/owner before sleeping; retain no terminal lease.
            if !keep_sampling {
                return;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    });
}

/// Reads an exclusively owned child without consuming status or releasing PID
/// identity. Callers serialize this probe with the owner's signal/reap gate.
#[cfg(unix)]
pub(super) fn root_exited(pid: libc::pid_t) -> Option<bool> {
    if pid <= 0 {
        return None;
    }
    // SAFETY: the zeroed C output record is valid before waitid fills it.
    let mut info = unsafe { std::mem::zeroed::<libc::siginfo_t>() };
    // SAFETY: info is writable; WNOWAIT deliberately retains child ownership.
    let result = unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            &mut info,
            libc::WEXITED | libc::WNOHANG | libc::WNOWAIT,
        )
    };
    if result != 0 {
        return None;
    }
    // SAFETY: waitid succeeded and info is an initialized status record.
    match unsafe { info.si_pid() } {
        0 => Some(false),
        observed if observed == pid => Some(true),
        _ => None,
    }
}
