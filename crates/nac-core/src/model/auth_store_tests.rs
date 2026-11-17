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

/// Runs `credential_lock_timeout` with NAC_HOME pointed at `nac_home`,
/// restoring the previous value afterwards.
fn resolve_with_nac_home(nac_home: &std::path::Path) -> Result<Duration> {
    let previous = std::env::var_os("NAC_HOME");
    std::env::set_var("NAC_HOME", nac_home);
    let resolved = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap()
        .block_on(credential_lock_timeout());
    match previous {
        Some(value) => std::env::set_var("NAC_HOME", value),
        None => std::env::remove_var("NAC_HOME"),
    }
    resolved
}

#[test]
fn lock_timeout_defaults_to_fifteen_seconds_without_an_auth_section() {
    assert_eq!(
        credential_lock_timeout_from_config("").unwrap(),
        Duration::from_secs(15)
    );
    assert_eq!(
        credential_lock_timeout_from_config("[model]\nmodel = \"gpt-5.5\"\n").unwrap(),
        DEFAULT_CREDENTIAL_LOCK_TIMEOUT
    );
    assert_eq!(
        credential_lock_timeout_from_config("[auth]\n").unwrap(),
        DEFAULT_CREDENTIAL_LOCK_TIMEOUT
    );
}

#[test]
fn lock_timeout_reads_auth_section_alongside_other_sections() {
    let raw = "[model]\nmodel = \"gpt-5.5\"\n\n[auth]\nlock_timeout_ms = 30000\n\n[mcp_servers.docs]\nurl = \"https://example.com/mcp\"\n";
    assert_eq!(
        credential_lock_timeout_from_config(raw).unwrap(),
        Duration::from_secs(30)
    );
}

#[test]
fn lock_timeout_rejects_values_outside_the_mcp_timeout_bounds() {
    for value in [0, 99, MAX_CREDENTIAL_LOCK_TIMEOUT_MS + 1] {
        let error =
            credential_lock_timeout_from_config(&format!("[auth]\nlock_timeout_ms = {value}\n"))
                .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("auth.lock_timeout_ms must be between 100 and 600000 milliseconds"),
            "{value}: {error:#}"
        );
    }
    assert_eq!(
        credential_lock_timeout_from_config("[auth]\nlock_timeout_ms = 100\n").unwrap(),
        Duration::from_millis(100)
    );
    assert_eq!(
        credential_lock_timeout_from_config("[auth]\nlock_timeout_ms = 600000\n").unwrap(),
        Duration::from_secs(600)
    );
}

#[test]
fn lock_timeout_rejects_a_non_integer_value() {
    assert!(credential_lock_timeout_from_config("[auth]\nlock_timeout_ms = \"30s\"\n").is_err());
}

#[test]
fn lock_timeout_resolves_from_the_nac_home_config_file() {
    let _guard = TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let nac_home = temp_dir("config");

    // No config.toml at all keeps the default.
    assert_eq!(
        resolve_with_nac_home(&nac_home).unwrap(),
        DEFAULT_CREDENTIAL_LOCK_TIMEOUT
    );

    std::fs::write(
        nac_home.join("config.toml"),
        "[auth]\nlock_timeout_ms = 2500\n",
    )
    .unwrap();
    assert_eq!(
        resolve_with_nac_home(&nac_home).unwrap(),
        Duration::from_millis(2500)
    );

    std::fs::write(
        nac_home.join("config.toml"),
        "[auth]\nlock_timeout_ms = 1\n",
    )
    .unwrap();
    let error = resolve_with_nac_home(&nac_home).unwrap_err();
    assert!(
        format!("{error:#}").contains("auth.lock_timeout_ms must be between"),
        "{error:#}"
    );

    let _ = std::fs::remove_dir_all(nac_home);
}
