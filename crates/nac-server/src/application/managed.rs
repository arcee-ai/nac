use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use nac_contracts::{NewProject, ProjectRecord};
use nac_core::{
    model::{provider_uses_api_key, BackendKind},
    runtime::ResumeModelOptions,
    sessions::SessionSnapshot,
};
use nac_managed::{HostSecretStore, HostSecretSummary, ManagedHostConfig, ProjectRegistrar};

/// Core-facing interpretation of the nonsecret managed model contract.
///
/// `nac-managed` deliberately owns only provider-neutral configuration. The
/// composition layer resolves that identifier into the harness model taxonomy
/// and rejects profiles that cannot consume an API-key credential.
#[derive(Clone, Debug)]
pub(crate) struct ManagedModelProfile {
    pub(crate) backend: BackendKind,
    pub(crate) model_id: String,
    pub(crate) endpoint: String,
    pub(crate) credential_file: PathBuf,
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
        if !provider_uses_api_key(backend) {
            bail!("managed model_backend '{backend}' must use an API-key credential");
        }
        Ok(Self {
            backend,
            model_id: config.model_id.clone(),
            endpoint: config.model_endpoint.clone(),
            credential_file: config.model_credential_file.clone(),
        })
    }

    pub(crate) fn matches_session(&self, snapshot: &SessionSnapshot) -> bool {
        snapshot.backend == self.backend
            && snapshot.base_url == self.endpoint
            && snapshot.api_key_env.is_none()
    }

    pub(crate) fn resume_options(&self) -> ResumeModelOptions {
        ResumeModelOptions {
            trusted_api_key_file: Some(self.credential_file.clone()),
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
