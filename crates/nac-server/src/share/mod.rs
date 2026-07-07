pub mod config;
pub mod doctor;
pub mod health;
pub mod policy;
pub mod secrets;
pub mod security;
pub mod supervisor;

#[cfg(test)]
use std::sync::{Mutex, MutexGuard, OnceLock};

#[cfg(test)]
static TEST_ENV_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[cfg(test)]
pub(crate) fn test_env_lock() -> MutexGuard<'static, ()> {
    TEST_ENV_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub use config::{
    add_allowlist_entry, effective_share_config, load_saved_share_config, normalize_share_config,
    save_configured_share_config, ShareConfigOverrides,
};
pub use doctor::{format_doctor_report, run_doctor, DoctorOptions};
pub use health::local_service_url;
pub use secrets::{save_authtoken_secret, secrets_path_from_cwd, try_resolve_authtoken};
pub use security::validate_share_bind;
pub use supervisor::{run_share, ShareRunOptions};
