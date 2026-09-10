use anyhow::Result;
use nac_core::{
    model::{
        list_provider_models, provider_uses_api_key, resolve_backend_api_key, AuthStatus,
        BackendKind, ModelListing, ProviderConnection, ProviderModel,
    },
    model_configurations,
};
use nac_managed::ManagedModelCredentialSource;

use crate::SessionManager;

/// Local model-catalog projection with composition-owned credential facts.
pub(crate) struct ModelCatalogApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> ModelCatalogApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) fn listing(&self) -> ModelListing {
        let mut listing = nac_core::model::api_listing();
        self.overlay_saved_provider_connections(&mut listing);

        if let (Some(config), Some(profile)) =
            (self.manager.managed_host(), self.manager.managed_model())
        {
            if let Some(provider) = listing
                .providers
                .iter_mut()
                .find(|provider| provider.id == profile.backend)
            {
                if profile.credential_ready(config).is_ok() {
                    provider.auth_status = AuthStatus::Ready;
                    provider.auth_hint = None;
                    provider.default_base_url = Some(profile.endpoint.clone());
                    provider.connection = Some(ProviderConnection {
                        base_url: profile.endpoint.clone(),
                        api_key_env: None,
                    });
                } else {
                    // Generic catalog probing treats any parseable Arcee login
                    // as ready. Managed bootstrap requires a receipt-bound
                    // managed-nac generation, so explicitly mask legacy or
                    // mismatched state.
                    provider.auth_status = AuthStatus::NoCredential;
                    provider.auth_hint = None;
                    provider.connection = None;
                }
            }
        }
        listing
    }

    /// Saved API-key setup is a durable provider account as well as an optional
    /// launch preset. Publish the most recently updated usable route and its
    /// non-secret selector so every unified picker reaches the same account.
    fn overlay_saved_provider_connections(&self, listing: &mut ModelListing) {
        let Ok(configurations) =
            model_configurations::list_model_configurations(&self.manager.inner.store_path)
        else {
            return;
        };
        for provider in &mut listing.providers {
            if !provider_uses_api_key(provider.id) {
                continue;
            }
            let selected = configurations
                .iter()
                .filter(|configuration| {
                    configuration.backend.parse::<BackendKind>().ok() == Some(provider.id)
                        && configuration
                            .api_key_env
                            .as_deref()
                            .is_some_and(|selector| {
                                resolve_backend_api_key(provider.id, Some(selector)).is_ok()
                            })
                })
                .max_by(|left, right| {
                    left.updated_at
                        .cmp(&right.updated_at)
                        .then_with(|| left.config_id.cmp(&right.config_id))
                });
            if let Some(configuration) = selected {
                provider.auth_status = AuthStatus::Ready;
                provider.auth_hint = None;
                provider.connection = Some(ProviderConnection {
                    base_url: configuration.base_url.clone(),
                    api_key_env: configuration.api_key_env.clone(),
                });
            }
        }
    }

    /// Discover the complete organization-scoped index with the operator's
    /// mounted credential without returning the key or its path to the browser.
    /// Only the exact configured provider and destination may use this seam.
    pub(crate) async fn mounted_key_models(
        &self,
        backend: BackendKind,
        base_url: Option<&str>,
    ) -> Result<Option<(String, Vec<ProviderModel>)>> {
        let (Some(config), Some(profile)) =
            (self.manager.managed_host(), self.manager.managed_model())
        else {
            return Ok(None);
        };
        if profile.credential_source != ManagedModelCredentialSource::MountedApiKey
            || backend != profile.backend
            || base_url.is_some_and(|url| url != profile.endpoint)
        {
            return Ok(None);
        }
        let api_key = config.model_credential()?;
        let models = list_provider_models(backend, &profile.endpoint, &api_key).await?;
        Ok(Some((profile.endpoint.clone(), models)))
    }
}
