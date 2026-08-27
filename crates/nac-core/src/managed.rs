//! Optional managed-host configuration and owner-only credential foundations.
//!
//! Ordinary NAC does not consult a default managed configuration path. The
//! server must opt in with an explicit document, which keeps local and SSH
//! Projects unchanged when Managed NAC is not configured.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use url::Url;

use crate::model::auth_store::{
    read_auth_string_from_path, with_credential_lock, write_auth_string_to_path,
};

pub use nac_contracts::CommandEnvironmentSnapshot;
use nac_contracts::{CommandEnvironmentFuture, CommandEnvironmentProvider, WorkerEnvironment};

pub const MANAGED_CONFIG_VERSION: u32 = 1;
const SECRET_STORE_VERSION: u32 = 1;
pub const MAX_HOST_SECRETS: usize = 128;
pub const MAX_HOST_SECRET_VALUE_BYTES: usize = 32 * 1024;
pub const MAX_HOST_SECRET_TOTAL_BYTES: usize = 128 * 1024;

/// Structurally validated, nonsecret controller-to-NAC host configuration.
#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ManagedHostConfig {
    pub version: u32,
    pub logical_host_id: String,
    pub owner: Option<String>,
    pub public_hostname: String,
    pub repository_root: PathBuf,
    pub state_root: PathBuf,
    pub home_root: PathBuf,
    pub github_client_id: String,
    pub model_endpoint: String,
    pub model_credential_file: PathBuf,
    #[serde(default)]
    pub model_credential_environment_names: Vec<String>,
}

impl ManagedHostConfig {
    /// Load a managed document only when the caller explicitly supplies it.
    pub fn load_optional(path: Option<&Path>) -> Result<Option<Self>> {
        path.map(Self::load).transpose()
    }

    pub fn load(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("failed to read managed configuration {}", path.display()))?;
        let config: Self = toml::from_str(&raw)
            .with_context(|| format!("failed to parse managed configuration {}", path.display()))?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<()> {
        if self.version != MANAGED_CONFIG_VERSION {
            bail!(
                "unsupported managed configuration version {}; expected {}",
                self.version,
                MANAGED_CONFIG_VERSION
            );
        }
        validate_nonblank("logical_host_id", &self.logical_host_id)?;
        validate_nonblank("public_hostname", &self.public_hostname)?;
        validate_nonblank("github_client_id", &self.github_client_id)?;
        validate_absolute_path("repository_root", &self.repository_root)?;
        validate_absolute_path("state_root", &self.state_root)?;
        validate_absolute_path("home_root", &self.home_root)?;
        validate_absolute_path("model_credential_file", &self.model_credential_file)?;
        if self.repository_root == self.state_root
            || self.repository_root == self.home_root
            || self.state_root == self.home_root
        {
            bail!("managed repository, state, and home roots must be distinct");
        }
        validate_public_hostname(&self.public_hostname)?;
        let endpoint = Url::parse(&self.model_endpoint)
            .map_err(|_| anyhow!("managed model_endpoint must be a valid HTTPS URL"))?;
        if endpoint.scheme() != "https" || endpoint.host_str().is_none() {
            bail!("managed model_endpoint must be a valid HTTPS URL");
        }
        for name in &self.model_credential_environment_names {
            if !is_valid_environment_name(name) {
                bail!(
                    "invalid managed model credential environment name '{}'; expected [A-Za-z_][A-Za-z0-9_]*",
                    name
                );
            }
        }
        Ok(())
    }

    pub fn secret_store(&self) -> HostSecretStore {
        HostSecretStore::new(&self.state_root)
            .with_reserved_names(self.model_credential_environment_names.iter().cloned())
    }

    pub fn github_auth(&self) -> Result<crate::managed_github::ManagedGitHubAuth> {
        crate::managed_github::ManagedGitHubAuth::new(
            &self.state_root,
            self.github_client_id.clone(),
        )
    }
}

fn validate_nonblank(field: &str, value: &str) -> Result<()> {
    if value.trim().is_empty() {
        bail!("managed {field} must not be blank");
    }
    Ok(())
}

fn validate_absolute_path(field: &str, value: &Path) -> Result<()> {
    if !value.is_absolute() {
        bail!("managed {field} must be an absolute path");
    }
    Ok(())
}

fn validate_public_hostname(hostname: &str) -> Result<()> {
    if hostname.contains('/') || hostname.contains('@') || hostname.contains(char::is_whitespace) {
        bail!("managed public_hostname must be a DNS hostname without a scheme or path");
    }
    let parsed = Url::parse(&format!("https://{hostname}/"))
        .map_err(|_| anyhow!("managed public_hostname must be a valid DNS hostname"))?;
    if parsed.host_str() != Some(hostname) {
        bail!("managed public_hostname must be a valid DNS hostname");
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct HostSecretSummary {
    pub name: String,
    pub updated_at_unix_ms: u64,
}

#[derive(Clone, Debug)]
pub struct HostSecretStore {
    state_root: PathBuf,
    path: PathBuf,
    lock_path: PathBuf,
    reserved_names: BTreeSet<String>,
}

impl HostSecretStore {
    pub fn new(state_root: impl AsRef<Path>) -> Self {
        let state_root = state_root.as_ref();
        Self {
            state_root: state_root.to_path_buf(),
            path: state_root.join("managed_host_secrets.json"),
            lock_path: state_root.join("managed_host_secrets.json.lock"),
            reserved_names: BTreeSet::new(),
        }
    }

    pub fn from_nac_home() -> Result<Self> {
        crate::paths::nac_home_dir()
            .map(Self::new)
            .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for managed secrets"))
    }

    pub fn with_reserved_names(mut self, names: impl IntoIterator<Item = String>) -> Self {
        self.reserved_names.extend(names);
        self
    }

    pub fn state_root(&self) -> &Path {
        &self.state_root
    }

    pub fn list(&self) -> Result<Vec<HostSecretSummary>> {
        let stored = self.load()?;
        Ok(stored
            .secrets
            .into_iter()
            .map(|(name, secret)| HostSecretSummary {
                name,
                updated_at_unix_ms: secret.updated_at_unix_ms,
            })
            .collect())
    }

    pub fn snapshot(&self) -> Result<CommandEnvironmentSnapshot> {
        let values = self
            .load()?
            .secrets
            .into_iter()
            .map(|(name, secret)| (name, secret.value))
            .collect::<BTreeMap<_, _>>();
        let redactions = values.values().cloned().collect();
        Ok(CommandEnvironmentSnapshot::from_parts(values, redactions))
    }

    pub fn put(&self, name: &str, value: &str) -> Result<HostSecretSummary> {
        self.validate_name(name)?;
        validate_secret_value(value)?;
        with_credential_lock(&self.lock_path, || {
            let mut stored = self.load()?;
            let updated_at_unix_ms = now_unix_ms()?;
            stored.secrets.insert(
                name.to_string(),
                StoredSecret {
                    value: value.to_string(),
                    updated_at_unix_ms,
                },
            );
            validate_store_limits(&stored)?;
            self.save(&stored)?;
            Ok(HostSecretSummary {
                name: name.to_string(),
                updated_at_unix_ms,
            })
        })
    }

    pub fn delete(&self, name: &str) -> Result<bool> {
        self.validate_name(name)?;
        with_credential_lock(&self.lock_path, || {
            let mut stored = self.load()?;
            let removed = stored.secrets.remove(name).is_some();
            if removed {
                self.save(&stored)?;
            }
            Ok(removed)
        })
    }

    fn validate_name(&self, name: &str) -> Result<()> {
        if !is_valid_environment_name(name) {
            bail!(
                "invalid secret name '{}'; expected [A-Za-z_][A-Za-z0-9_]*",
                name
            );
        }
        if is_reserved_environment_name(name) || self.reserved_names.contains(name) {
            bail!("secret name '{name}' is reserved by NAC or the managed runtime");
        }
        Ok(())
    }

    fn load(&self) -> Result<StoredHostSecrets> {
        let Some(raw) = read_auth_string_from_path(&self.path)? else {
            return Ok(StoredHostSecrets::default());
        };
        if raw.trim().is_empty() {
            return Ok(StoredHostSecrets::default());
        }
        let stored: StoredHostSecrets = serde_json::from_str(&raw).map_err(|_| {
            anyhow!(
                "managed secret file {} is not valid JSON",
                self.path.display()
            )
        })?;
        if stored.version != SECRET_STORE_VERSION {
            bail!(
                "unsupported managed secret store version {} in {}",
                stored.version,
                self.path.display()
            );
        }
        validate_store_limits(&stored)?;
        Ok(stored)
    }

    fn save(&self, stored: &StoredHostSecrets) -> Result<()> {
        let raw = serde_json::to_string_pretty(stored)
            .context("failed to encode managed host secrets")?;
        write_auth_string_to_path(&self.path, &raw)
    }
}

/// Transitional managed-product adapter for the provider-neutral command
/// environment port. It moves with the managed bounded context; tool/runtime
/// consumers depend only on `CommandEnvironmentProvider`.
#[derive(Clone)]
pub struct ManagedCommandEnvironmentProvider {
    store: Option<HostSecretStore>,
    github: Option<crate::managed_github::ManagedGitHubAuth>,
    home_root: Option<PathBuf>,
}

impl ManagedCommandEnvironmentProvider {
    pub fn new(
        store: Option<HostSecretStore>,
        github: Option<crate::managed_github::ManagedGitHubAuth>,
        home_root: Option<PathBuf>,
    ) -> Self {
        Self {
            store,
            github,
            home_root,
        }
    }
}

impl CommandEnvironmentProvider for ManagedCommandEnvironmentProvider {
    fn snapshot(&self) -> CommandEnvironmentFuture<'_> {
        Box::pin(async move {
            let mut snapshot = self
                .store
                .as_ref()
                .map(HostSecretStore::snapshot)
                .transpose()?
                .unwrap_or_else(CommandEnvironmentSnapshot::empty);
            if let Some(home_root) = self.home_root.as_ref() {
                snapshot.insert_dedicated("HOME", home_root.to_string_lossy(), false);
            }
            if let Some(auth) = self.github.as_ref() {
                if let Some(token) = auth.current_token().await? {
                    snapshot.insert_dedicated("GH_TOKEN", token.secret(), true);
                }
            }
            Ok(snapshot)
        })
    }

    fn redaction_snapshot(&self) -> Result<CommandEnvironmentSnapshot> {
        let mut snapshot = self
            .store
            .as_ref()
            .map(HostSecretStore::snapshot)
            .transpose()?
            .unwrap_or_else(CommandEnvironmentSnapshot::empty);
        if let Some(token) = self
            .github
            .as_ref()
            .map(crate::managed_github::ManagedGitHubAuth::stored_token_for_redaction)
            .transpose()?
            .flatten()
        {
            snapshot.insert_dedicated("GH_TOKEN", token.secret(), true);
        }
        Ok(snapshot)
    }

    fn worker_environment(&self) -> WorkerEnvironment {
        WorkerEnvironment {
            secret_root: self
                .store
                .as_ref()
                .map(|store| store.state_root().to_path_buf()),
            github_client_id: self
                .github
                .as_ref()
                .map(|github| github.client_id().to_string()),
            home_root: self.home_root.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredSecret {
    value: String,
    updated_at_unix_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct StoredHostSecrets {
    version: u32,
    #[serde(default)]
    secrets: BTreeMap<String, StoredSecret>,
}

impl Default for StoredHostSecrets {
    fn default() -> Self {
        Self {
            version: SECRET_STORE_VERSION,
            secrets: BTreeMap::new(),
        }
    }
}

fn validate_secret_value(value: &str) -> Result<()> {
    if value.is_empty() {
        bail!("secret value must not be empty");
    }
    if value.len() > MAX_HOST_SECRET_VALUE_BYTES {
        bail!(
            "secret value must be at most {} bytes",
            MAX_HOST_SECRET_VALUE_BYTES
        );
    }
    Ok(())
}

fn validate_store_limits(stored: &StoredHostSecrets) -> Result<()> {
    if stored.secrets.len() > MAX_HOST_SECRETS {
        bail!("managed host supports at most {MAX_HOST_SECRETS} secrets");
    }
    let mut total = 0usize;
    for (name, secret) in &stored.secrets {
        if !is_valid_environment_name(name) {
            bail!("managed secret store contains an invalid secret name");
        }
        validate_secret_value(&secret.value)?;
        total = total
            .checked_add(name.len())
            .and_then(|value| value.checked_add(secret.value.len()))
            .ok_or_else(|| anyhow!("managed secret store size overflow"))?;
    }
    if total > MAX_HOST_SECRET_TOTAL_BYTES {
        bail!(
            "managed host secret data must be at most {} bytes",
            MAX_HOST_SECRET_TOTAL_BYTES
        );
    }
    Ok(())
}

fn now_unix_ms() -> Result<u64> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before the Unix epoch")?;
    u64::try_from(duration.as_millis()).context("system clock value does not fit in u64")
}

pub fn is_valid_environment_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

pub fn is_reserved_environment_name(name: &str) -> bool {
    const EXACT: &[&str] = &[
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "PWD",
        "OLDPWD",
        "TMPDIR",
        "SHLVL",
        "BASH_ENV",
        "ENV",
        "GIT_ASKPASS",
        "SSH_ASKPASS",
        "EXA_API_KEY",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "ARCEE_API_KEY",
        "TOGETHER_API_KEY",
        "FIREWORKS_API_KEY",
        "DEEPSEEK_API_KEY",
    ];
    EXACT.contains(&name)
        || name.starts_with("NAC_")
        || name.starts_with("GH_")
        || name.starts_with("GITHUB_")
        || name.starts_with("GIT_CONFIG_")
        || name.starts_with("LD_")
        || name.starts_with("DYLD_")
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "nac-managed-{label}-{}",
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn valid_config(root: &Path) -> ManagedHostConfig {
        ManagedHostConfig {
            version: MANAGED_CONFIG_VERSION,
            logical_host_id: "host-123".to_string(),
            owner: Some("owner@example.test".to_string()),
            public_hostname: "nac.example.test".to_string(),
            repository_root: root.join("repositories"),
            state_root: root.join("state"),
            home_root: root.join("home"),
            github_client_id: "Iv1.example".to_string(),
            model_endpoint: "https://models.example.test/v1".to_string(),
            model_credential_file: root.join("model-token"),
            model_credential_environment_names: vec!["ARCEE_API_KEY".to_string()],
        }
    }

    #[test]
    fn optional_managed_configuration_is_absent_without_an_explicit_path() {
        assert_eq!(ManagedHostConfig::load_optional(None).unwrap(), None);
    }

    #[test]
    fn managed_configuration_is_strict_and_structurally_validated() {
        let root = TestDir::new("config");
        let path = root.0.join("managed.toml");
        std::fs::write(
            &path,
            format!(
                "version = 1\nlogical_host_id = \"host-123\"\nowner = \"owner@example.test\"\npublic_hostname = \"nac.example.test\"\nrepository_root = \"{0}/repositories\"\nstate_root = \"{0}/state\"\nhome_root = \"{0}/home\"\ngithub_client_id = \"Iv1.example\"\nmodel_endpoint = \"https://models.example.test/v1\"\nmodel_credential_file = \"{0}/model-token\"\nmodel_credential_environment_names = [\"ARCEE_API_KEY\"]\n",
                root.0.display()
            ),
        )
        .unwrap();
        let config = ManagedHostConfig::load(&path).unwrap();
        assert_eq!(config.logical_host_id, "host-123");

        std::fs::write(
            &path,
            std::fs::read_to_string(&path).unwrap() + "unknown = true\n",
        )
        .unwrap();
        assert!(ManagedHostConfig::load(&path)
            .unwrap_err()
            .to_string()
            .contains("failed to parse"));
    }

    #[test]
    fn managed_configuration_rejects_relative_or_insecure_transport_fields() {
        let root = TestDir::new("config-invalid");
        let mut config = valid_config(&root.0);
        config.repository_root = PathBuf::from("repositories");
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("absolute"));
        config.repository_root = root.0.join("repositories");
        config.model_endpoint = "http://models.example.test".to_string();
        assert!(config.validate().unwrap_err().to_string().contains("HTTPS"));
        config.model_endpoint = "https://models.example.test".to_string();
        config.public_hostname = "https://nac.example.test".to_string();
        assert!(config
            .validate()
            .unwrap_err()
            .to_string()
            .contains("hostname"));
    }

    #[test]
    fn host_secret_store_is_write_only_atomic_and_restart_safe() {
        let root = TestDir::new("secrets");
        let store = HostSecretStore::new(&root.0);
        let created = store.put("DEMO_TOKEN", "first\nline").unwrap();
        assert_eq!(created.name, "DEMO_TOKEN");
        assert_eq!(store.list().unwrap(), vec![created.clone()]);
        assert_eq!(
            store.snapshot().unwrap().get("DEMO_TOKEN"),
            Some("first\nline")
        );

        let reopened = HostSecretStore::new(&root.0);
        let replaced = reopened.put("DEMO_TOKEN", "rotated").unwrap();
        assert!(replaced.updated_at_unix_ms >= created.updated_at_unix_ms);
        assert_eq!(store.snapshot().unwrap().get("DEMO_TOKEN"), Some("rotated"));
        assert!(store.delete("DEMO_TOKEN").unwrap());
        assert!(!store.delete("DEMO_TOKEN").unwrap());
        assert!(reopened.snapshot().unwrap().is_empty());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(root.0.join("managed_host_secrets.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn host_secret_store_serializes_concurrent_updates() {
        let root = TestDir::new("secrets-concurrent");
        let store = Arc::new(HostSecretStore::new(&root.0));
        let first = Arc::clone(&store);
        let second = Arc::clone(&store);
        let a = std::thread::spawn(move || first.put("FIRST_TOKEN", "alpha").unwrap());
        let b = std::thread::spawn(move || second.put("SECOND_TOKEN", "beta").unwrap());
        a.join().unwrap();
        b.join().unwrap();
        let snapshot = store.snapshot().unwrap();
        assert_eq!(snapshot.get("FIRST_TOKEN"), Some("alpha"));
        assert_eq!(snapshot.get("SECOND_TOKEN"), Some("beta"));
    }

    #[test]
    fn host_secret_store_rejects_reserved_names_values_and_symlinks() {
        let root = TestDir::new("secrets-invalid");
        let store = HostSecretStore::new(&root.0).with_reserved_names(["MODEL_TOKEN".to_string()]);
        for name in [
            "PATH",
            "NAC_HOME",
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GIT_CONFIG_COUNT",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
            "MODEL_TOKEN",
        ] {
            assert!(store
                .put(name, "secret")
                .unwrap_err()
                .to_string()
                .contains("reserved"));
        }
        assert!(store.put("not-valid", "secret").is_err());
        assert!(store.put("EMPTY", "").is_err());
        assert!(store
            .put("TOO_LARGE", &"x".repeat(MAX_HOST_SECRET_VALUE_BYTES + 1))
            .is_err());

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let target = root.0.join("target");
            std::fs::write(&target, "unchanged").unwrap();
            symlink(&target, root.0.join("managed_host_secrets.json")).unwrap();
            let error = store.put("SAFE_NAME", "secret").unwrap_err();
            assert!(error.to_string().contains("symlink credential"));
            assert_eq!(std::fs::read_to_string(target).unwrap(), "unchanged");
        }
    }

    #[test]
    fn immutable_snapshot_redacts_exact_values_without_revealing_names() {
        let root = TestDir::new("secrets-redact");
        let store = HostSecretStore::new(&root.0);
        store.put("DEMO_TOKEN", "canary-secret-value").unwrap();
        let snapshot = store.snapshot().unwrap();
        store.put("DEMO_TOKEN", "rotated-value").unwrap();
        assert_eq!(snapshot.get("DEMO_TOKEN"), Some("canary-secret-value"));
        assert_eq!(
            snapshot.redact("failed with canary-secret-value twice canary-secret-value"),
            "failed with [REDACTED] twice [REDACTED]"
        );
    }
}
