use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

/// Restores a process environment variable when dropped, including during unwinding.
/// Callers that can run concurrently must hold `TEST_ENV_LOCK` for the guard's lifetime.
pub(crate) struct EnvVarGuard {
    name: OsString,
    original: Option<OsString>,
}

impl EnvVarGuard {
    pub(crate) fn set(name: impl AsRef<OsStr>, value: impl AsRef<OsStr>) -> Self {
        let name = name.as_ref().to_os_string();
        let original = std::env::var_os(&name);
        unsafe { std::env::set_var(&name, value) };
        Self { name, original }
    }

    pub(crate) fn remove(name: impl AsRef<OsStr>) -> Self {
        let name = name.as_ref().to_os_string();
        let original = std::env::var_os(&name);
        unsafe { std::env::remove_var(&name) };
        Self { name, original }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.original.take() {
            Some(value) => unsafe { std::env::set_var(&self.name, value) },
            None => unsafe { std::env::remove_var(&self.name) },
        }
    }
}

static NEXT_TEMP_PATH: AtomicU64 = AtomicU64::new(0);

/// Returns a unique, nonexistent path; callers retain creation and cleanup ownership.
pub(crate) fn temp_store_path(label: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let sequence = NEXT_TEMP_PATH.fetch_add(1, Ordering::Relaxed);

    std::env::temp_dir()
        .join(format!(
            "nac_core_test_{label}_{}_{timestamp}_{sequence}",
            std::process::id()
        ))
        .join("store.db")
}

#[cfg(test)]
mod tests {
    use super::EnvVarGuard;
    use crate::TEST_ENV_LOCK;

    #[test]
    fn env_var_guard_restores_absence_after_panic() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let name = "NAC_ENV_VAR_GUARD_PANIC_TEST";
        unsafe { std::env::remove_var(name) };
        let result = std::panic::catch_unwind(|| {
            let _env = EnvVarGuard::set(name, "temporary");
            panic!("exercise unwind");
        });
        assert!(result.is_err());
        assert_eq!(std::env::var_os(name), None);
    }

    #[cfg(unix)]
    #[test]
    fn env_var_guard_preserves_non_utf8_os_string() {
        use std::os::unix::ffi::OsStringExt;
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let name = "NAC_ENV_VAR_GUARD_OS_STRING_TEST";
        let original = std::ffi::OsString::from_vec(vec![0xff, 0xfe]);
        unsafe { std::env::set_var(name, &original) };
        {
            let _env = EnvVarGuard::set(name, "temporary");
        }
        assert_eq!(std::env::var_os(name), Some(original));
        unsafe { std::env::remove_var(name) };
    }
}
