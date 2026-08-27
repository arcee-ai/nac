use std::{collections::BTreeSet, path::Path};

use nac_core::{
    model::remove_api_key,
    model_configurations::{self, ModelConfigurationRecord, ModelConfigurationStoreError},
};

use crate::GENERATED_CREDENTIAL_PREFIX;

/// Saved model-configuration use cases that coordinate durable rows with the
/// separate write-only credential store.
pub(crate) struct ModelConfigurationApplication<'a> {
    store_path: &'a Path,
}

impl<'a> ModelConfigurationApplication<'a> {
    pub(crate) fn new(store_path: &'a Path) -> Self {
        Self { store_path }
    }

    pub(crate) fn list(
        &self,
    ) -> Result<Vec<ModelConfigurationRecord>, ModelConfigurationStoreError> {
        model_configurations::list_model_configurations(self.store_path)
    }

    /// Deletes the durable row before retiring only server-generated secrets.
    /// A failed or rejected row deletion therefore cannot invalidate a live
    /// configuration, and operator-owned environment selectors are untouched.
    pub(crate) fn delete(&self, config_id: &str) -> Result<(), ModelConfigurationStoreError> {
        let record = model_configurations::load_model_configuration(self.store_path, config_id)?;
        model_configurations::delete_model_configuration(self.store_path, config_id)?;

        let generated: BTreeSet<&str> = record
            .api_key_env
            .as_deref()
            .into_iter()
            .chain(
                record
                    .light_model
                    .as_ref()
                    .and_then(|light| light.api_key_env.as_deref()),
            )
            .filter(|name| name.starts_with(GENERATED_CREDENTIAL_PREFIX))
            .collect();
        for name in generated {
            let _ = remove_api_key(name);
        }
        Ok(())
    }
}
