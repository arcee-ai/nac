use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use nac_contracts::{NewProject, ProjectRecord};
use nac_core::{
    model::{provider_uses_api_key, BackendKind},
    runtime::ResumeModelOptions,
    sessions::SessionSnapshot,
};
use nac_managed::{
    HostSecretStore, HostSecretSummary, ManagedHostConfig, ManagedModelCredentialSource,
    ProjectRegistrar,
};

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
            version: nac_managed::MANAGED_CONFIG_VERSION,
            logical_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".to_string(),
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
