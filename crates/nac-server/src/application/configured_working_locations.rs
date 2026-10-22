//! Explicit configured opaque IDs -> actual Native repository resources.
//! This owner never authorizes a user or issues a Core/AFM admission. There is
//! no browser constructor, path input, inferred billing ID or installed issuer.
use super::{
    prepared_location_custody::PreparedLocationCustody,
    public_session_creation::{
        PublicCreationContext, PublicCreationError, PublicSessionCreationCommand,
        ResolvedPublicCreateData,
    },
    session_creation::{apply_project_model_defaults, SessionCreationCommand},
    Field,
};
use crate::{ManagedLocationResolution, ManagedLocationSelector, SessionManager};
use anyhow::{ensure, Result};
use nac_core::model_configurations::{self, ModelConfigurationRecord};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Weak,
    },
};

/// Trusted composition supplies these DATA values explicitly. Only the already
/// configured Native repository root is supported; no supplied filesystem path
/// or public ID can select a different location/backend.
pub(crate) struct ConfiguredWorkingLocation {
    pub(crate) public_id: String,
    pub(crate) default_model_config_id: Option<String>,
}

pub(crate) struct ConfiguredWorkingLocations {
    entries: BTreeMap<String, Arc<Entry>>,
}
struct Entry {
    original_manager: Weak<crate::SessionManagerInner>,
    location: ManagedLocationResolution,
    default_model: Option<ModelConfigurationRecord>,
    revision: [u8; 32],
    denied: AtomicBool,
}
/// Same original configured entry/descriptor retained through preparation and
/// unknown ownership. Registry revocation/drop is a veto, never settlement.
pub(super) struct ConfiguredLocationCustody {
    entry: Arc<Entry>,
    // Exact precedence-resolved row, including explicit overrides. This belongs
    // to one operation; observing its replacement must not revoke the registry.
    selected_model: ModelConfigurationRecord,
    denied: AtomicBool,
}

impl ConfiguredWorkingLocations {
    pub(crate) async fn capture(
        manager: &SessionManager,
        configured: Vec<ConfiguredWorkingLocation>,
    ) -> Result<Self> {
        let mut registry = Self {
            entries: BTreeMap::new(),
        };
        for setting in configured {
            ensure!(
                !setting.public_id.is_empty()
                    && setting.public_id.len() <= 256
                    && !setting.public_id.contains('\0')
                    && !registry.entries.contains_key(&setting.public_id),
                "configured working location ID is invalid or duplicated"
            );
            let default_model = setting
                .default_model_config_id
                .as_ref()
                .map(|id| {
                    model_configurations::load_model_configuration(&manager.inner.store_path, id)
                })
                .transpose()?;
            let fact = manager
                .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
                .await?;
            let location = manager.resolve_managed_location_fact(fact).await?;
            let revision = Sha256::digest(serde_json::to_vec(&(
                "native-configured-working-location-v1",
                &setting.public_id,
                location.fact(),
                &default_model,
            ))?)
            .into();
            registry.entries.insert(
                setting.public_id,
                Arc::new(Entry {
                    original_manager: Arc::downgrade(&manager.inner),
                    location,
                    default_model,
                    revision,
                    denied: AtomicBool::new(false),
                }),
            );
        }
        Ok(registry)
    }

    /// Source fingerprint DATA for a future authenticated context producer.
    /// Equality cannot stand in for its original primary/actor/operation guard.
    pub(crate) fn revision(&self, id: &str) -> Option<[u8; 32]> {
        self.entries.get(id).map(|entry| entry.revision)
    }

    /// Called only beneath the genuine same-operation factory admission. This
    /// function returns resolved DATA/resources, never a runtime or grant.
    pub(crate) async fn resolve(
        &self,
        manager: &SessionManager,
        command: PublicSessionCreationCommand,
        expected_revision: [u8; 32],
    ) -> Result<ResolvedPublicCreateData, PublicCreationError> {
        command.validate()?;
        let PublicCreationContext::WorkingLocation(id) = &command.context else {
            return Err(PublicCreationError::InvalidContext);
        };
        let entry = self
            .entries
            .get(id)
            .ok_or(PublicCreationError::WorkingLocationUnavailable)?;
        if entry.revision != expected_revision {
            return Err(PublicCreationError::SourceChanged);
        }
        entry
            .check_current(manager)
            .map_err(|_| PublicCreationError::SourceChanged)?;
        let selected = command
            .model_config_id
            .as_deref()
            .or(entry
                .default_model
                .as_ref()
                .map(|model| model.config_id.as_str()))
            .ok_or(PublicCreationError::ModelUnavailable)?;
        let model =
            model_configurations::load_model_configuration(&manager.inner.store_path, selected)
                .map_err(|_| PublicCreationError::ModelUnavailable)?;
        let configured = ConfiguredLocationCustody {
            entry: Arc::clone(entry),
            selected_model: model.clone(),
            denied: AtomicBool::new(false),
        };
        let resolution = manager
            .resolve_managed_location_fact(entry.location.fact().clone())
            .await
            .map_err(|_| PublicCreationError::SourceChanged)?;
        let location = PreparedLocationCustody::retain(manager, resolution)
            .await
            .map_err(|_| PublicCreationError::SourceChanged)?
            .with_configured_location(configured);
        // Async host/resource capture does not freeze ordinary model writes.
        // Core's actual source reservation remains necessary before effects.
        if location.check_outside_store(manager).is_err() {
            location.deny();
            return Err(PublicCreationError::SourceChanged);
        }
        let mut private = SessionCreationCommand {
            cwd: Some(entry.location.fact().canonical_cwd.clone()),
            project_id: None,
            behavior: command.behavior,
            first_chat: command.first_chat,
            first_chat_same_behavior: command.first_chat_same_behavior,
            ..Default::default()
        };
        apply_project_model_defaults(&mut private, model);
        if !matches!(command.reasoning_effort, Field::Unchanged) {
            private.reasoning_effort = command.reasoning_effort;
        }
        Ok(ResolvedPublicCreateData {
            command: private,
            location,
        })
    }

    pub(crate) fn revoke(&mut self, id: &str) {
        if let Some(entry) = self.entries.get(id) {
            entry.denied.store(true, Ordering::Release);
        }
    }
}
impl Drop for ConfiguredWorkingLocations {
    fn drop(&mut self) {
        for entry in self.entries.values() {
            entry.denied.store(true, Ordering::Release);
        }
    }
}
impl Entry {
    fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire) && self.original_manager.strong_count() != 0,
            "configured location original owner denied"
        );
        Ok(())
    }
    fn check_current(&self, manager: &SessionManager) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            let original = self
                .original_manager
                .upgrade()
                .ok_or_else(|| anyhow::anyhow!("configured location owner ended"))?;
            ensure!(
                Arc::ptr_eq(&original, &manager.inner),
                "configured location manager changed"
            );
            ensure!(
                manager.managed_location_binding()? == self.location.fact().binding,
                "configured location host changed"
            );
            self.location.check_directories_current()?;
            if let Some(default) = &self.default_model {
                ensure!(
                    model_configurations::load_model_configuration(
                        &manager.inner.store_path,
                        &default.config_id
                    )? == *default,
                    "configured location default model changed"
                );
            }
            self.check_denial()
        })();
        if checked.is_err() {
            self.denied.store(true, Ordering::Release);
        }
        checked
    }
}

impl ConfiguredLocationCustody {
    /// Bounded in-memory veto only; never read SQLite under a publication lock.
    pub(super) fn check_denial(&self) -> Result<()> {
        ensure!(
            !self.denied.load(Ordering::Acquire),
            "configured location selected model denied"
        );
        self.entry.check_denial()
    }
    pub(super) fn check_current(&self, manager: &SessionManager) -> Result<()> {
        let checked = (|| {
            self.check_denial()?;
            self.entry.check_current(manager)?;
            ensure!(
                model_configurations::load_model_configuration(
                    &manager.inner.store_path,
                    &self.selected_model.config_id,
                )? == self.selected_model,
                "configured location selected model changed"
            );
            self.check_denial()
        })();
        if checked.is_err() {
            self.denied.store(true, Ordering::Release);
        }
        checked
    }
}

#[cfg(all(test, unix))]
mod tests;
