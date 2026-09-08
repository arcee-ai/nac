use nac_core::model::{list_stored_api_keys, remove_api_key, store_api_key, StoredApiKeySummary};

use crate::GENERATED_CREDENTIAL_PREFIX;

/// Application facade for the ordinary NAC credential store. Values are
/// accepted for mutation but never returned from this boundary.
pub(crate) struct CredentialApplication;

impl CredentialApplication {
    pub(crate) fn list() -> anyhow::Result<Vec<StoredApiKeySummary>> {
        list_stored_api_keys()
    }

    pub(crate) fn put(name: &str, value: &str) -> anyhow::Result<()> {
        store_api_key(name, value)
    }

    pub(crate) fn generate(value: &str) -> anyhow::Result<String> {
        let name = format!(
            "{GENERATED_CREDENTIAL_PREFIX}{}",
            uuid::Uuid::new_v4().simple()
        );
        store_api_key(&name, value)?;
        Ok(name)
    }

    pub(crate) fn delete(name: &str) -> anyhow::Result<bool> {
        remove_api_key(name)
    }
}
