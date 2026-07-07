use std::{
    fmt, fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, bail, Context, Result};
use nac_core::runtime;
use toml_edit::{value, Item, Table};

use super::config::{atomic_write, read_toml_document, required_clean_value, NgrokConfig};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthtokenSource {
    Explicit,
    Env(String),
    Secrets(PathBuf),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedAuthtoken {
    pub token: String,
    pub source: AuthtokenSource,
}

impl fmt::Display for AuthtokenSource {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AuthtokenSource::Explicit => write!(formatter, "provided for this run"),
            AuthtokenSource::Env(name) => write!(formatter, "env {name}"),
            AuthtokenSource::Secrets(path) => write!(formatter, "{}", path.display()),
        }
    }
}

pub fn secrets_path_from_cwd(cwd: &Path) -> Result<PathBuf> {
    let config_path = runtime::nac_config_path_from_cwd(cwd)
        .ok_or_else(|| anyhow!("could not resolve NAC config path"))?;
    let parent = config_path
        .parent()
        .ok_or_else(|| anyhow!("NAC config path has no parent: {}", config_path.display()))?;
    Ok(parent.join("secrets.toml"))
}

pub fn missing_authtoken_message(root_cwd: &Path, config: &NgrokConfig) -> Result<String> {
    let secrets_path = secrets_path_from_cwd(root_cwd)?;
    Ok(format!(
        "missing ngrok authtoken; set {} or run `nac-web share configure -C {}` to save it in {}",
        config.authtoken_env,
        root_cwd.display(),
        secrets_path.display()
    ))
}

pub fn try_resolve_authtoken(
    root_cwd: &Path,
    config: &NgrokConfig,
    explicit: Option<&str>,
) -> Result<Option<ResolvedAuthtoken>> {
    if let Some(token) = explicit.map(str::trim).filter(|token| !token.is_empty()) {
        return Ok(Some(ResolvedAuthtoken {
            token: token.to_string(),
            source: AuthtokenSource::Explicit,
        }));
    }

    let env_name = required_clean_value(&config.authtoken_env, "ngrok.authtoken_env")?;
    match std::env::var(&env_name) {
        Ok(token) if token.trim().is_empty() => {
            bail!("ngrok authtoken env var {env_name} is set but empty");
        }
        Ok(token) => {
            return Ok(Some(ResolvedAuthtoken {
                token,
                source: AuthtokenSource::Env(env_name),
            }));
        }
        Err(std::env::VarError::NotPresent) => {}
        Err(error) => return Err(error).with_context(|| format!("failed to read {env_name}")),
    }

    let secrets_path = secrets_path_from_cwd(root_cwd)?;
    match read_saved_authtoken_at(&secrets_path)? {
        Some(token) => Ok(Some(ResolvedAuthtoken {
            token,
            source: AuthtokenSource::Secrets(secrets_path),
        })),
        None => Ok(None),
    }
}

pub fn resolve_authtoken(
    root_cwd: &Path,
    config: &NgrokConfig,
    explicit: Option<&str>,
) -> Result<ResolvedAuthtoken> {
    try_resolve_authtoken(root_cwd, config, explicit)?.ok_or_else(|| {
        anyhow!(
            missing_authtoken_message(root_cwd, config).unwrap_or_else(|_| {
                format!(
                    "missing ngrok authtoken; set {} or run `nac-web share configure`",
                    config.authtoken_env
                )
            })
        )
    })
}

pub fn save_authtoken_secret(cwd: &Path, authtoken: &str) -> Result<PathBuf> {
    let authtoken = authtoken.trim();
    if authtoken.is_empty() {
        bail!("ngrok authtoken cannot be empty");
    }
    let path = secrets_path_from_cwd(cwd)?;
    let mut document = read_toml_document(&path)?;
    if !matches!(document.get("ngrok"), Some(Item::Table(_))) {
        document.insert("ngrok", Item::Table(Table::new()));
    }
    document["ngrok"]["authtoken"] = value(authtoken);
    atomic_write(&path, &document.to_string(), true)?;
    Ok(path)
}

fn validate_secret_file_permissions(path: &Path) -> Result<()> {
    validate_secret_file_permissions_impl(path)
}

#[cfg(unix)]
fn validate_secret_file_permissions_impl(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to stat {}", path.display()))
        }
    };
    if metadata.file_type().is_symlink() {
        bail!(
            "refusing to read ngrok secrets from symlink {}; use a regular 0600 file",
            path.display()
        );
    }
    if !metadata.file_type().is_file() {
        bail!(
            "refusing to read ngrok secrets from non-file {}; use a regular 0600 file",
            path.display()
        );
    }
    let mode = metadata.permissions().mode() & 0o777;
    if mode & 0o077 != 0 {
        bail!(
            "insecure permissions on {}; expected user-only access (0600 or stricter)",
            path.display()
        );
    }
    Ok(())
}

#[cfg(not(unix))]
fn validate_secret_file_permissions_impl(_path: &Path) -> Result<()> {
    Ok(())
}

fn read_saved_authtoken_at(path: &Path) -> Result<Option<String>> {
    validate_secret_file_permissions(path)?;
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", path.display()))
        }
    };
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let root: toml::Value =
        toml::from_str(&raw).with_context(|| format!("failed to parse TOML {}", path.display()))?;
    Ok(root
        .get("ngrok")
        .and_then(toml::Value::as_table)
        .and_then(|section| section.get("authtoken"))
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_share_secret_{label}_{unique}"));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn restore_env(name: &str, value: Option<std::ffi::OsString>) {
        unsafe {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }

    fn sample_config() -> NgrokConfig {
        NgrokConfig {
            authtoken_env: "NAC_TEST_NGROK_TOKEN".to_string(),
            ..NgrokConfig::default()
        }
    }

    #[test]
    fn authtoken_resolution_prefers_env_over_secrets() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_token = std::env::var_os("NAC_TEST_NGROK_TOKEN");
        let root = temp_root("token_precedence");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::set_var("NAC_TEST_NGROK_TOKEN", "env-token");
        }
        save_authtoken_secret(&root, "secret-token").unwrap();

        let token = resolve_authtoken(&root, &sample_config(), None).unwrap();

        assert_eq!(token.token, "env-token");
        assert_eq!(
            token.source,
            AuthtokenSource::Env("NAC_TEST_NGROK_TOKEN".to_string())
        );

        restore_env("NAC_TEST_NGROK_TOKEN", original_token);
        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn authtoken_resolution_reads_secrets_when_env_is_missing() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_token = std::env::var_os("NAC_TEST_NGROK_TOKEN");
        let root = temp_root("token_secret");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::remove_var("NAC_TEST_NGROK_TOKEN");
        }
        let secret_path = save_authtoken_secret(&root, "secret-token").unwrap();

        let token = resolve_authtoken(&root, &sample_config(), None).unwrap();

        assert_eq!(token.token, "secret-token");
        assert_eq!(token.source, AuthtokenSource::Secrets(secret_path));

        restore_env("NAC_TEST_NGROK_TOKEN", original_token);
        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_token_message_points_to_configure_not_run() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = temp_root("missing_message");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let message = missing_authtoken_message(&root, &sample_config()).unwrap();

        assert!(message.contains("nac-web share configure"));
        assert!(!message.contains("nac-web share -C"));

        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn saved_secret_file_is_user_read_write_only() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = temp_root("secret_permissions");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let path = save_authtoken_secret(&root, "secret-token").unwrap();
        let mode = fs::metadata(path).unwrap().permissions().mode() & 0o777;

        assert_eq!(mode, 0o600);

        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn group_readable_secret_file_is_rejected_when_reading() {
        use std::os::unix::fs::PermissionsExt;

        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let original_token = std::env::var_os("NAC_TEST_NGROK_TOKEN");
        let root = temp_root("secret_insecure_permissions");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
            std::env::remove_var("NAC_TEST_NGROK_TOKEN");
        }
        let path = secrets_path_from_cwd(&root).unwrap();
        fs::write(&path, "[ngrok]\nauthtoken = \"secret-token\"\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();

        let error = resolve_authtoken(&root, &sample_config(), None).unwrap_err();

        assert!(error.to_string().contains("insecure permissions"));

        restore_env("NAC_TEST_NGROK_TOKEN", original_token);
        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }
}
