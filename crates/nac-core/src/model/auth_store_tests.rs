use super::*;
use crate::TEST_ENV_LOCK;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_dir(label: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("nac_auth_store_{label}_{unique}"));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// Points NAC_HOME at a test directory and restores the previous value on drop,
/// including when an assertion panics. Callers hold `TEST_ENV_LOCK`.
struct NacHomeGuard {
    previous: Option<std::ffi::OsString>,
}

impl NacHomeGuard {
    fn set(nac_home: &Path) -> Self {
        let previous = std::env::var_os("NAC_HOME");
        std::env::set_var("NAC_HOME", nac_home);
        Self { previous }
    }
}

impl Drop for NacHomeGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("NAC_HOME", value),
            None => std::env::remove_var("NAC_HOME"),
        }
    }
}

fn resolve() -> Result<Duration> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(credential_lock_timeout())
}

fn from_config(raw: &str) -> Result<Duration> {
    credential_lock_timeout_from_config(raw, Path::new("/nac-home/config.toml"))
}

#[test]
fn lock_timeout_defaults_to_fifteen_seconds_without_an_auth_setting() {
    assert_eq!(from_config("").unwrap(), Duration::from_secs(15));
    for raw in [
        "[model]\nmodel = \"gpt-5.5\"\n",
        "[auth]\n",
        // A non-table `auth` carries no lock_timeout_ms.
        "auth = 5\n",
    ] {
        assert_eq!(
            from_config(raw).unwrap(),
            DEFAULT_CREDENTIAL_LOCK_TIMEOUT,
            "{raw:?}"
        );
    }
}

#[test]
fn lock_timeout_reads_auth_section_alongside_other_sections() {
    let raw = "[model]\nmodel = \"gpt-5.5\"\n\n[auth]\nlock_timeout_ms = 30000\n\n[mcp_servers.docs]\nurl = \"https://example.com/mcp\"\n";
    assert_eq!(from_config(raw).unwrap(), Duration::from_secs(30));
    assert_eq!(
        from_config("[auth]\nlock_timeout_ms = 100\n").unwrap(),
        Duration::from_millis(100)
    );
    assert_eq!(
        from_config("[auth]\nlock_timeout_ms = 600000\n").unwrap(),
        Duration::from_secs(600)
    );
}

#[test]
fn unparseable_config_keeps_the_default_instead_of_failing() {
    // A syntax error anywhere in config.toml must not block sign-in or refresh.
    for raw in [
        "=\n",
        "[mcp_servers.recorded\n",
        "[auth]\nlock_timeout_ms = 30000\n[model\n",
    ] {
        assert_eq!(
            from_config(raw).unwrap(),
            DEFAULT_CREDENTIAL_LOCK_TIMEOUT,
            "{raw:?}"
        );
    }
}

#[test]
fn invalid_lock_timeout_is_an_error_naming_the_key_and_file() {
    for value in ["0", "99", "600001", "-5", "1.5", "\"30s\"", "true"] {
        let error = from_config(&format!("[auth]\nlock_timeout_ms = {value}\n")).unwrap_err();
        // The outermost message is what the dashboard shows, so it must name the key.
        assert_eq!(
            error.to_string(),
            "auth.lock_timeout_ms in /nac-home/config.toml must be an integer between 100 and 600000 milliseconds",
            "{value}"
        );
    }
}

#[test]
fn lock_timeout_resolves_from_the_nac_home_config_file() {
    let _lock = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let nac_home = temp_dir("config");
    let _home = NacHomeGuard::set(&nac_home);
    let config = nac_home.join("config.toml");

    // No config.toml at all keeps the default.
    assert_eq!(resolve().unwrap(), DEFAULT_CREDENTIAL_LOCK_TIMEOUT);

    std::fs::write(&config, "[auth]\nlock_timeout_ms = 2500\n").unwrap();
    assert_eq!(resolve().unwrap(), Duration::from_millis(2500));

    std::fs::write(&config, "[auth\nlock_timeout_ms = 2500\n").unwrap();
    assert_eq!(resolve().unwrap(), DEFAULT_CREDENTIAL_LOCK_TIMEOUT);

    std::fs::write(&config, "[auth]\nlock_timeout_ms = 1\n").unwrap();
    let error = resolve().unwrap_err();
    assert!(
        error.to_string().starts_with("auth.lock_timeout_ms in "),
        "{error:#}"
    );

    // An unreadable config.toml (here a directory) also keeps the default.
    std::fs::remove_file(&config).unwrap();
    std::fs::create_dir(&config).unwrap();
    assert_eq!(resolve().unwrap(), DEFAULT_CREDENTIAL_LOCK_TIMEOUT);

    let _ = std::fs::remove_dir_all(nac_home);
}
