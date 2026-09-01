use nac_core::model::{AuthStatus, ModelListing};

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
        let (Some(config), Some(profile)) =
            (self.manager.managed_host(), self.manager.managed_model())
        else {
            return listing;
        };
        if let Some(provider) = listing
            .providers
            .iter_mut()
            .find(|provider| provider.id == profile.backend)
        {
            if profile.credential_ready(config).is_ok() {
                provider.auth_status = AuthStatus::Ready;
                provider.auth_hint = None;
                provider.default_base_url = Some(profile.endpoint.clone());
            } else {
                // Generic catalog probing treats any parseable Arcee login as
                // ready. Managed bootstrap requires a receipt-bound managed-nac
                // generation, so explicitly mask legacy or mismatched state.
                provider.auth_status = AuthStatus::NoCredential;
                provider.auth_hint = None;
            }
        }
        listing
    }
}
