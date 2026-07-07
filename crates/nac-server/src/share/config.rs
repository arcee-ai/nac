use std::{
    collections::BTreeSet,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{bail, Context, Result};
use nac_core::runtime;
use serde::Deserialize;
use toml_edit::{value, Array, DocumentMut, Item, Table};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct NgrokConfig {
    #[serde(default = "default_ngrok_authtoken_env")]
    pub authtoken_env: String,
    #[serde(default = "default_ngrok_oauth_provider")]
    pub oauth_provider: String,
    #[serde(default)]
    pub allow_emails: Vec<String>,
    #[serde(default)]
    pub allow_domains: Vec<String>,
    pub domain: Option<String>,
    #[serde(default = "default_ngrok_auth_required")]
    pub auth_required: bool,
}

impl Default for NgrokConfig {
    fn default() -> Self {
        Self {
            authtoken_env: default_ngrok_authtoken_env(),
            oauth_provider: default_ngrok_oauth_provider(),
            allow_emails: Vec::new(),
            allow_domains: Vec::new(),
            domain: None,
            auth_required: default_ngrok_auth_required(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ShareConfigOverrides {
    pub authtoken_env: Option<String>,
    pub oauth_provider: Option<String>,
    pub allow_emails: Vec<String>,
    pub allow_domains: Vec<String>,
    pub domain: Option<String>,
    pub auth_required: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
struct ShareConfigFile {
    #[serde(default)]
    ngrok: NgrokConfig,
}

pub fn load_saved_share_config(root_cwd: &Path) -> Result<NgrokConfig> {
    let Some(path) = runtime::nac_config_path_from_cwd(root_cwd) else {
        return Ok(NgrokConfig::default());
    };
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(NgrokConfig::default());
        }
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read config {}", path.display()))
        }
    };
    if raw.trim().is_empty() {
        return Ok(NgrokConfig::default());
    }
    toml::from_str::<ShareConfigFile>(&raw)
        .map(|file| file.ngrok)
        .with_context(|| format!("failed to parse config {}", path.display()))
}

pub fn effective_share_config(
    saved: &NgrokConfig,
    overrides: &ShareConfigOverrides,
) -> NgrokConfig {
    let mut ngrok = saved.clone();
    if let Some(authtoken_env) = non_empty_clone(&overrides.authtoken_env) {
        ngrok.authtoken_env = authtoken_env;
    }
    if let Some(oauth_provider) = non_empty_clone(&overrides.oauth_provider) {
        ngrok.oauth_provider = oauth_provider;
    }
    if let Some(domain) = non_empty_clone(&overrides.domain) {
        ngrok.domain = Some(domain);
    }
    if !overrides.allow_emails.is_empty() {
        ngrok.allow_emails.extend(overrides.allow_emails.clone());
    }
    if !overrides.allow_domains.is_empty() {
        ngrok.allow_domains.extend(overrides.allow_domains.clone());
    }
    if let Some(auth_required) = overrides.auth_required {
        ngrok.auth_required = auth_required;
    }
    ngrok
}

pub fn normalize_share_config(config: &NgrokConfig) -> Result<NgrokConfig> {
    let allowlist = normalize_allowlist(&config.allow_emails, &config.allow_domains)?;
    let authtoken_env = required_clean_value(&config.authtoken_env, "ngrok.authtoken_env")?;
    let oauth_provider = required_clean_value(&config.oauth_provider, "ngrok.oauth_provider")?;
    let domain = match config
        .domain
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(domain) => Some(validate_custom_domain(domain)?),
        None => None,
    };
    Ok(NgrokConfig {
        authtoken_env,
        oauth_provider,
        allow_emails: allowlist.emails,
        allow_domains: allowlist.domains,
        domain,
        auth_required: config.auth_required,
    })
}

pub fn add_allowlist_entry(config: &mut NgrokConfig, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    if value.contains('@') && !value.starts_with('@') {
        config.allow_emails.push(value.to_string());
    } else {
        config
            .allow_domains
            .push(value.trim_start_matches('@').to_string());
    }
}

pub fn save_configured_share_config(cwd: &Path, config: &NgrokConfig) -> Result<PathBuf> {
    let config = normalize_share_config(config)?;
    let path = runtime::nac_config_path_from_cwd(cwd)
        .ok_or_else(|| anyhow::anyhow!("could not resolve NAC config path"))?;
    let mut document = read_toml_document(&path)?;

    let mut section = Table::new();
    section.insert("authtoken_env", value(config.authtoken_env));
    section.insert("oauth_provider", value(config.oauth_provider));
    if let Some(domain) = config.domain {
        section.insert("domain", value(domain));
    }
    section.insert(
        "allow_emails",
        Item::Value(toml_edit::Value::Array(string_array(&config.allow_emails))),
    );
    section.insert(
        "allow_domains",
        Item::Value(toml_edit::Value::Array(string_array(&config.allow_domains))),
    );
    section.insert("auth_required", value(config.auth_required));
    document["ngrok"] = Item::Table(section);

    atomic_write(&path, &document.to_string(), false)?;
    Ok(path)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedAllowlist {
    pub emails: Vec<String>,
    pub domains: Vec<String>,
}

impl NormalizedAllowlist {
    pub fn is_empty(&self) -> bool {
        self.emails.is_empty() && self.domains.is_empty()
    }

    pub fn summary(&self) -> String {
        let mut parts = Vec::new();
        if !self.emails.is_empty() {
            parts.push(format!("{} email(s)", self.emails.len()));
        }
        if !self.domains.is_empty() {
            parts.push(format!("{} domain(s)", self.domains.len()));
        }
        if parts.is_empty() {
            "empty".to_string()
        } else {
            parts.join(", ")
        }
    }
}

pub(crate) fn normalize_allowlist(
    emails: &[String],
    domains: &[String],
) -> Result<NormalizedAllowlist> {
    let mut email_set = BTreeSet::new();
    let mut domain_set = BTreeSet::new();

    for email in emails {
        email_set.insert(validate_email(email)?);
    }
    for domain in domains {
        domain_set.insert(validate_email_domain(domain)?);
    }

    Ok(NormalizedAllowlist {
        emails: email_set.into_iter().collect(),
        domains: domain_set.into_iter().collect(),
    })
}

pub(crate) fn required_clean_value(value: &str, label: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        bail!("{label} cannot be empty");
    }
    if value
        .chars()
        .any(|ch| ch.is_control() || ch.is_whitespace() || ch == '\'' || ch == '"' || ch == '\\')
    {
        bail!("{label} contains unsupported characters");
    }
    Ok(value.to_string())
}

pub(crate) fn read_toml_document(path: &Path) -> Result<DocumentMut> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(DocumentMut::new()),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", path.display()))
        }
    };
    if raw.trim().is_empty() {
        return Ok(DocumentMut::new());
    }
    raw.parse::<DocumentMut>()
        .with_context(|| format!("failed to parse TOML {}", path.display()))
}

pub(crate) fn atomic_write(path: &Path, raw: &str, secret: bool) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }
    let temp_path = temp_path_for(path);
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    if secret {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let write_result = (|| -> Result<()> {
        let mut file = options
            .open(&temp_path)
            .with_context(|| format!("failed to open temp file {}", temp_path.display()))?;
        file.write_all(raw.as_bytes())
            .with_context(|| format!("failed to write temp file {}", temp_path.display()))?;
        file.sync_all()
            .with_context(|| format!("failed to sync temp file {}", temp_path.display()))?;
        #[cfg(unix)]
        if secret {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = file
                .metadata()
                .with_context(|| format!("failed to read permissions for {}", temp_path.display()))?
                .permissions();
            permissions.set_mode(0o600);
            fs::set_permissions(&temp_path, permissions)
                .with_context(|| format!("failed to set permissions on {}", temp_path.display()))?;
        }
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    fs::rename(&temp_path, path).with_context(|| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "failed to replace {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;
    Ok(())
}

fn default_ngrok_authtoken_env() -> String {
    "NGROK_AUTHTOKEN".to_string()
}

fn default_ngrok_oauth_provider() -> String {
    "google".to_string()
}

fn default_ngrok_auth_required() -> bool {
    true
}

fn validate_email(value: &str) -> Result<String> {
    let value = required_clean_value(value, "allow email")?.to_ascii_lowercase();
    if value.starts_with('@') || value.ends_with('@') || value.matches('@').count() != 1 {
        bail!("invalid allowed email `{value}`");
    }
    Ok(value)
}

fn validate_email_domain(value: &str) -> Result<String> {
    let value =
        required_clean_value(value.trim_start_matches('@'), "allow domain")?.to_ascii_lowercase();
    if value.contains('@') {
        bail!("invalid allowed domain `{value}`");
    }
    Ok(value)
}

fn validate_custom_domain(value: &str) -> Result<String> {
    let value = required_clean_value(value, "ngrok.domain")?.to_ascii_lowercase();
    if value.contains('/') || value.contains(':') {
        bail!("ngrok.domain must be a hostname, not a URL");
    }
    Ok(value)
}

fn non_empty_clone(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn string_array(values: &[String]) -> Array {
    let mut array = Array::new();
    for value in values {
        array.push(value.as_str());
    }
    array
}

fn temp_path_for(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config");
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    path.with_file_name(format!(".{file_name}.tmp-{}-{unique}", std::process::id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_share_config_{label}_{unique}"));
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
            oauth_provider: "google".to_string(),
            allow_emails: vec!["Admin@Example.com".to_string()],
            allow_domains: vec!["@Example.org".to_string()],
            domain: Some("NAC.Example.Com".to_string()),
            auth_required: true,
        }
    }

    #[test]
    fn save_config_updates_ngrok_without_deleting_unrelated_toml() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = temp_root("save_preserve");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(
            nac_home.join("config.toml"),
            r#"# keep me
[cloudflare_tunnel]
hostname = "old.example.com"

[storage]
store_path = "custom.db"
"#,
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let path = save_configured_share_config(&root, &sample_config()).unwrap();
        let raw = fs::read_to_string(path).unwrap();

        assert!(raw.contains("[cloudflare_tunnel]"));
        assert!(raw.contains("hostname = \"old.example.com\""));
        assert!(raw.contains("[storage]"));
        assert!(raw.contains("[ngrok]"));
        assert!(raw.contains("allow_emails = [\"admin@example.com\"]"));
        assert!(!raw.contains("secret-token"));

        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_saved_config_reads_ngrok_without_core_runtime_config() {
        let _guard = crate::share::test_env_lock();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let root = temp_root("load_saved");
        let nac_home = root.join("nac-home");
        fs::create_dir_all(&nac_home).unwrap();
        fs::write(
            nac_home.join("config.toml"),
            r#"[ngrok]
authtoken_env = "NAC_TEST_TOKEN"
allow_domains = ["Example.Org"]
"#,
        )
        .unwrap();
        unsafe {
            std::env::set_var("NAC_HOME", &nac_home);
        }

        let config = load_saved_share_config(&root).unwrap();
        assert_eq!(config.authtoken_env, "NAC_TEST_TOKEN");
        assert_eq!(config.oauth_provider, "google");
        assert_eq!(config.allow_domains, vec!["Example.Org"]);

        restore_env("NAC_HOME", original_nac_home);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn effective_config_applies_ephemeral_overrides_without_mutating_saved() {
        let saved = NgrokConfig::default();
        let overrides = ShareConfigOverrides {
            allow_emails: vec!["user@example.com".to_string()],
            domain: Some("nac.example.com".to_string()),
            auth_required: Some(false),
            ..ShareConfigOverrides::default()
        };

        let effective = effective_share_config(&saved, &overrides);

        assert!(saved.allow_emails.is_empty());
        assert_eq!(effective.allow_emails, vec!["user@example.com"]);
        assert_eq!(effective.domain.as_deref(), Some("nac.example.com"));
        assert!(!effective.auth_required);
    }
}
