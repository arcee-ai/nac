pub(crate) use nac_process::{signal_descendants, ProcessTreeGuard};

#[cfg(target_os = "linux")]
pub(crate) use nac_process::process_start_time;

#[cfg(all(test, target_os = "linux"))]
pub(crate) use nac_process::{set_pidfd_open_failure_for_test, PIDFD_OPEN_FAILURE_LOCK};
