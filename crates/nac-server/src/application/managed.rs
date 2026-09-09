use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{bail, Context, Result};
use nac_contracts::{NewProject, ProjectRecord};
use nac_core::{
    model::{provider_uses_api_key, BackendKind},
    runtime::ResumeModelOptions,
    sessions::SessionSnapshot,
};
use nac_managed::{
    HostSecretStore, HostSecretSummary, ManagedHostConfig, ManagedModelCredentialSource,
    ProjectRegistrar, ReadinessCheck,
};

use crate::SessionManager;

const MANAGED_RUNTIME_UID: u32 = 10_001;
const MANAGED_RUNTIME_GID: u32 = 10_001;
pub(crate) const REQUIRED_RUNTIME_TOOLS: &[&str] = &[
    "bash",
    "git",
    "git-lfs",
    "gh",
    "ssh",
    "curl",
    "jq",
    "rg",
    "fd",
    "rsync",
    "make",
    "pkg-config",
    "cmake",
    "cc",
    "python3",
    "uv",
    "node",
    "npm",
    "corepack",
    "rustc",
    "cargo",
    "rustfmt",
    "cargo-clippy",
    "go",
    "tar",
    "gzip",
    "xz",
    "zip",
    "unzip",
    "tini",
];

#[derive(Clone, Copy)]
pub(crate) struct ManagedReadinessPolicy {
    expected_uid: u32,
    expected_gid: u32,
    required_tools: &'static [&'static str],
    #[cfg(test)]
    forced_failure: Option<&'static str>,
}

impl ManagedReadinessPolicy {
    pub(crate) const fn production() -> Self {
        Self {
            expected_uid: MANAGED_RUNTIME_UID,
            expected_gid: MANAGED_RUNTIME_GID,
            required_tools: REQUIRED_RUNTIME_TOOLS,
            #[cfg(test)]
            forced_failure: None,
        }
    }

    #[cfg(test)]
    pub(crate) const fn for_test(
        expected_uid: u32,
        expected_gid: u32,
        required_tools: &'static [&'static str],
        forced_failure: Option<&'static str>,
    ) -> Self {
        Self {
            expected_uid,
            expected_gid,
            required_tools,
            forced_failure,
        }
    }
}

/// Application-owned managed runtime readiness contract shared by status and
/// accepted-replacement startup. Maintenance admission is reported separately:
/// a replacement proves these checks while the host remains in maintenance,
/// before it is allowed to clear that durable state.
pub(crate) fn runtime_readiness_checks(
    manager: &SessionManager,
    policy: ManagedReadinessPolicy,
) -> Vec<ReadinessCheck> {
    let mut checks = vec![
        match nac_core::store::check_readiness(&manager.inner.store_path) {
            Ok(()) => ReadinessCheck::pass("store", "SQLite store is open and migrated"),
            Err(_) => {
                let migration = nac_core::store::migration_status(&manager.inner.store_path);
                let reason = migration
                    .failure
                    .map_or(migration.state.as_str(), |failure| failure.as_str());
                ReadinessCheck::fail("store", format!("SQLite store is unavailable ({reason})"))
            }
        },
    ];

    if let Some(managed) = manager.managed_host() {
        checks.extend(nac_managed::host_checks(
            managed,
            policy.expected_uid,
            policy.expected_gid,
            policy.required_tools,
        ));
        if let Some(model) = manager.managed_model() {
            if model.credential_source == ManagedModelCredentialSource::ManagedBootstrap {
                checks.push(match model.credential_ready(managed) {
                    Ok(()) => ReadinessCheck::pass(
                        "model-credential",
                        "durable managed model authorization is present",
                    ),
                    Err(error) => ReadinessCheck::fail(
                        "model-credential",
                        format!("durable managed model authorization is unavailable: {error}"),
                    ),
                });
            }
        }
    }

    #[cfg(test)]
    if let Some(name) = policy.forced_failure {
        if let Some(check) = checks.iter_mut().find(|check| check.name == name) {
            *check = ReadinessCheck::fail(name, "injected deterministic readiness failure");
        } else {
            checks.push(ReadinessCheck::fail(
                name,
                "injected deterministic readiness failure",
            ));
        }
    }

    checks
}

pub(crate) fn require_replacement_readiness(
    manager: &SessionManager,
    policy: ManagedReadinessPolicy,
) -> Result<()> {
    let failed = runtime_readiness_checks(manager, policy)
        .into_iter()
        .filter(|check| !check.ready)
        .map(|check| check.name)
        .collect::<Vec<_>>();
    if failed.is_empty() {
        Ok(())
    } else {
        bail!(
            "managed replacement readiness failed: {}",
            failed.join(", ")
        )
    }
}

pub(crate) struct ManagedStartupPlan {
    pub(crate) preflight: nac_core::store::ManagedStartupPreflight,
    pub(crate) recovery_only: bool,
    pub(crate) configured_identity: Option<(String, String)>,
}

/// Resolve the trusted controller-authored startup CAS before model/bootstrap
/// or clone initialization. The expectation is nonsecret Deployment metadata:
/// it authorizes only an exact durable A-to-embedded-B transition and carries
/// no Kubernetes or controller credential into NAC.
pub(crate) fn managed_startup_plan(
    store_path: &Path,
    managed: Option<&ManagedHostConfig>,
    running: &nac_core::store::ManagedUpgradeTarget,
) -> Result<ManagedStartupPlan> {
    let Some(managed) =
        managed.filter(|managed| managed.version == nac_managed::MANAGED_CONFIG_VERSION)
    else {
        return Ok(ManagedStartupPlan {
            preflight: nac_core::store::ManagedStartupPreflight {
                accepted_identity: None,
                requires_accept: false,
            },
            recovery_only: false,
            configured_identity: None,
        });
    };
    let control = managed
        .managed_control()?
        .ok_or_else(|| anyhow::anyhow!("managed v2 control configuration is unavailable"))?;
    let configured_identity = (
        managed.logical_host_id.clone(),
        control.host_incarnation_id.clone(),
    );
    let supersession = managed
        .managed_upgrade_expectation
        .as_ref()
        .map(|expectation| {
            let target = upgrade_target(&expectation.target);
            if target != *running {
                bail!("managed startup expectation does not match the embedded release");
            }
            Ok(nac_core::store::ManagedUpgradeSupersession {
                previous_operation_id: expectation.previous_operation_id.clone(),
                previous_target: upgrade_target(&expectation.previous_target),
                operation: nac_core::store::ManagedOperationBinding {
                    managed_host_id: configured_identity.0.clone(),
                    host_incarnation_id: configured_identity.1.clone(),
                    issuer: control.issuer.clone(),
                    audience: format!(
                        "urn:nac:managed-control:{}:{}",
                        configured_identity.0, configured_identity.1
                    ),
                    authority_origin: control.issuer.clone(),
                    operation_id: expectation.operation_id.clone(),
                    target,
                    actor: expectation.actor.clone(),
                    beneficiary: expectation.beneficiary.clone(),
                },
                adopt_unbound_previous: expectation.adopt_unbound_previous,
            })
        })
        .transpose()?;
    let configured = Some((
        configured_identity.0.as_str(),
        configured_identity.1.as_str(),
    ));
    match nac_core::store::preflight_managed_forward_start(
        store_path,
        running,
        configured,
        supersession.as_ref(),
    ) {
        Ok(preflight) => Ok(ManagedStartupPlan {
            preflight,
            recovery_only: false,
            configured_identity: Some(configured_identity),
        }),
        Err(error) => {
            if supersession.is_some() {
                return Err(error.into());
            }
            let migration = nac_core::store::migration_status(store_path);
            if migration.state == nac_core::store::StoreMigrationState::Current {
                return Err(error.into());
            }
            Ok(ManagedStartupPlan {
                preflight: nac_core::store::ManagedStartupPreflight {
                    accepted_identity: None,
                    requires_accept: false,
                },
                recovery_only: true,
                configured_identity: Some(configured_identity),
            })
        }
    }
}

fn upgrade_target(
    target: &nac_managed::ManagedControlTarget,
) -> nac_core::store::ManagedUpgradeTarget {
    nac_core::store::ManagedUpgradeTarget {
        release_id: target.release_id.clone(),
        source_sha: target.source_sha.clone(),
        product_version: target.product_version.clone(),
        schema_version: target.schema_version,
        minimum_schema_version: target.minimum_schema_version,
    }
}

/// Core-facing interpretation of the nonsecret managed model contract.
///
/// `nac-managed` deliberately owns only provider-neutral configuration. The
/// composition layer resolves that identifier into the harness model taxonomy
/// and binds mounted keys or the provider-owned bootstrap importer.
#[derive(Clone, Debug)]
pub(crate) struct ManagedModelProfile {
    pub(crate) backend: BackendKind,
    pub(crate) model_id: String,
    pub(crate) endpoint: String,
    pub(crate) credential_file: PathBuf,
    pub(crate) credential_source: ManagedModelCredentialSource,
}

impl ManagedModelProfile {
    pub(crate) fn from_config(config: &ManagedHostConfig) -> Result<Self> {
        let backend = config
            .model_backend
            .parse::<BackendKind>()
            .map_err(anyhow::Error::msg)
            .with_context(|| {
                format!(
                    "managed model_backend '{}' is not supported by this NAC build",
                    config.model_backend
                )
            })?;
        match config.model_credential_source {
            ManagedModelCredentialSource::MountedApiKey if !provider_uses_api_key(backend) => {
                bail!("managed model_backend '{backend}' must use an API-key credential")
            }
            ManagedModelCredentialSource::ManagedBootstrap if backend != BackendKind::ArceeAuth => {
                bail!("managed bootstrap credentials require model_backend 'arcee-auth'")
            }
            ManagedModelCredentialSource::ManagedBootstrap
                if config.model_credential_file
                    != Path::new(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH) =>
            {
                bail!(
                    "managed bootstrap credential file must be {}",
                    nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH
                )
            }
            _ => {}
        }
        Ok(Self {
            backend,
            model_id: config.model_id.clone(),
            endpoint: config.model_endpoint.clone(),
            credential_file: config.model_credential_file.clone(),
            credential_source: config.model_credential_source,
        })
    }

    pub(crate) fn initialize(&self, config: &ManagedHostConfig) -> Result<()> {
        if self.credential_source != ManagedModelCredentialSource::ManagedBootstrap {
            return Ok(());
        }
        let credential_root = nac_core::model::managed_arcee_auth_storage_root()?;
        if credential_root != config.state_root {
            bail!(
                "managed bootstrap requires NAC_HOME to equal managed state_root so rotated credentials remain on durable storage"
            );
        }
        nac_core::model::import_managed_arcee_bootstrap(&config.logical_host_id)
            .context("failed to import managed Arcee bootstrap")?;
        Ok(())
    }

    pub(crate) fn credential_ready(&self, config: &ManagedHostConfig) -> Result<()> {
        match self.credential_source {
            ManagedModelCredentialSource::MountedApiKey => config.model_credential().map(|_| ()),
            ManagedModelCredentialSource::ManagedBootstrap => {
                nac_core::model::validate_managed_arcee_authorization(
                    &config.logical_host_id,
                    &self.endpoint,
                )
            }
        }
    }

    /// Fail closed before a session uses the durable managed authorization.
    /// Mounted API-key sessions retain their existing launch-time file check.
    pub(crate) fn require_durable_authorization(&self, config: &ManagedHostConfig) -> Result<()> {
        if self.credential_source == ManagedModelCredentialSource::ManagedBootstrap {
            self.credential_ready(config)
                .context("durable managed model authorization is unavailable")?;
        }
        Ok(())
    }

    pub(crate) fn trusted_api_key_file(&self) -> Option<PathBuf> {
        (self.credential_source == ManagedModelCredentialSource::MountedApiKey)
            .then(|| self.credential_file.clone())
    }

    pub(crate) fn matches_session(&self, snapshot: &SessionSnapshot) -> bool {
        snapshot.backend == self.backend
            && snapshot.base_url == self.endpoint
            && snapshot.api_key_env.is_none()
    }

    /// Whether an application-owned session settings row may reuse this
    /// profile's credential. The model id is deliberately absent: entitlement
    /// comes from the provider's authenticated model index, not from the one
    /// deployment default in the read-only host configuration.
    pub(crate) fn matches_settings_override(
        &self,
        backend: BackendKind,
        base_url: &str,
        api_key_env: Option<&str>,
    ) -> bool {
        self.credential_source == ManagedModelCredentialSource::MountedApiKey
            && backend == self.backend
            && base_url == self.endpoint
            && api_key_env.is_none()
    }

    pub(crate) fn resume_options(&self) -> ResumeModelOptions {
        ResumeModelOptions {
            trusted_api_key_file: self.trusted_api_key_file(),
        }
    }
}

/// SQLite-backed adapter for the managed clone workflow's project port.
#[derive(Clone)]
pub(crate) struct StoreProjectRegistrar {
    store_path: PathBuf,
}

impl StoreProjectRegistrar {
    pub(crate) fn new(store_path: impl AsRef<Path>) -> Self {
        Self {
            store_path: store_path.as_ref().to_path_buf(),
        }
    }
}

impl ProjectRegistrar for StoreProjectRegistrar {
    fn list_projects(&self) -> Result<Vec<ProjectRecord>> {
        nac_core::projects::list_projects(&self.store_path).map_err(anyhow::Error::new)
    }

    fn register_project(&self, project: NewProject) -> Result<ProjectRecord> {
        nac_core::projects::insert_project(&self.store_path, project).map_err(anyhow::Error::new)
    }
}

pub(crate) fn clone_service(
    config: &ManagedHostConfig,
    store_path: &Path,
) -> Result<nac_managed::ManagedCloneService> {
    nac_managed::ManagedCloneService::new(
        &config.repository_root,
        &config.state_root,
        &config.home_root,
        Arc::new(StoreProjectRegistrar::new(store_path)),
        Some(config.github_auth()?),
    )
}

/// Managed secret administration use cases. Values remain write-only and the
/// application surface exposes only safe metadata.
#[derive(Clone)]
pub(crate) struct ManagedSecretsApplication {
    store: HostSecretStore,
}

impl ManagedSecretsApplication {
    pub(crate) fn from_config(config: &ManagedHostConfig) -> Self {
        Self {
            store: config.secret_store(),
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<HostSecretSummary>> {
        self.store.list()
    }

    pub(crate) fn put(&self, name: &str, value: &str) -> Result<HostSecretSummary> {
        self.store.put(name, value)
    }

    pub(crate) fn delete(&self, name: &str) -> Result<bool> {
        self.store.delete(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(source: ManagedModelCredentialSource, backend: &str) -> ManagedHostConfig {
        ManagedHostConfig {
            version: nac_managed::LEGACY_MANAGED_CONFIG_VERSION,
            logical_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".to_string(),
            host_incarnation_id: None,
            owner: None,
            public_hostname: "nac.example.test".to_string(),
            repository_root: PathBuf::from("/var/lib/nac/repositories"),
            state_root: PathBuf::from("/var/lib/nac"),
            home_root: PathBuf::from("/home/nac"),
            github_client_id: "Iv1.example".to_string(),
            model_backend: backend.to_string(),
            model_id: "trinity-large-thinking".to_string(),
            model_endpoint: "https://api.arcee.ai".to_string(),
            model_credential_file: match source {
                ManagedModelCredentialSource::MountedApiKey => {
                    PathBuf::from("/run/secrets/model/credential")
                }
                ManagedModelCredentialSource::ManagedBootstrap => {
                    PathBuf::from(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH)
                }
            },
            model_credential_source: source,
            model_credential_environment_names: Vec::new(),
            managed_control_bind: None,
            managed_control_issuer: None,
            managed_control_jwks_file: None,
            managed_upgrade_expectation: None,
        }
    }

    #[test]
    fn mounted_api_key_profile_remains_the_compatible_default_shape() {
        let profile = ManagedModelProfile::from_config(&config(
            ManagedModelCredentialSource::MountedApiKey,
            "arcee-api",
        ))
        .unwrap();
        assert!(profile.trusted_api_key_file().is_some());
        assert!(profile.resume_options().trusted_api_key_file.is_some());
    }

    #[test]
    fn managed_bootstrap_is_arcee_auth_only_and_never_attaches_a_key_file() {
        let profile = ManagedModelProfile::from_config(&config(
            ManagedModelCredentialSource::ManagedBootstrap,
            "arcee-auth",
        ))
        .unwrap();
        assert_eq!(profile.backend, BackendKind::ArceeAuth);
        assert!(profile.trusted_api_key_file().is_none());
        assert!(profile.resume_options().trusted_api_key_file.is_none());

        let error = ManagedModelProfile::from_config(&config(
            ManagedModelCredentialSource::ManagedBootstrap,
            "arcee-api",
        ))
        .unwrap_err();
        assert!(error
            .to_string()
            .contains("require model_backend 'arcee-auth'"));
    }

    #[test]
    fn managed_bootstrap_requires_the_fixed_regular_file_contract_path() {
        let mut managed = config(ManagedModelCredentialSource::ManagedBootstrap, "arcee-auth");
        managed.model_credential_file = PathBuf::from("/tmp/bootstrap.json");
        let error = ManagedModelProfile::from_config(&managed).unwrap_err();
        assert!(error
            .to_string()
            .contains(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH));
    }
}
