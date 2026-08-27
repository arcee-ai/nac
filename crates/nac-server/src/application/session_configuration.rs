use anyhow::{anyhow, Result};
use nac_core::{
    model::{validate_model_configuration, EffectiveModelSettings},
    runtime::NacConfig,
    sessions,
};

use crate::{
    apply_raw_config_patch, config_replacement_conflict, enforce_trusted_base_url, light_model,
    parse_prospective_model_config, request_configuration_error, request_configuration_error_from,
    RequestField, SessionManager, UpdateConfigRequest,
};

/// Transactional session configuration updates.
///
/// The lifecycle gate and durable operation/resource leases remain held across
/// validation, revision-CAS persistence, and local service eviction.
pub(crate) struct SessionConfigurationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionConfigurationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    /// Transactionally updates persisted model settings for an inactive session.
    /// The prospective snapshot and credentials are fully validated before the
    /// database or in-memory service map is changed.
    pub async fn update_session_config(
        &self,
        session_id: &str,
        mut request: UpdateConfigRequest,
    ) -> Result<()> {
        let request_empty = request.is_empty();
        if request_empty {
            // An empty PATCH carries no caller intent. It must be a universal,
            // store-free no-op: no cache-dependent busy result, legacy config
            // repair, revision increment, credential lookup, or ownership read.
            return Ok(());
        }
        self.manager.require_primary_operation_session(session_id)?;

        let backend_selected = matches!(&request.backend, RequestField::Value(_));
        let base_url_omitted = matches!(&request.base_url, RequestField::Omitted);
        let api_key_env_omitted = matches!(&request.api_key_env, RequestField::Omitted);

        // Submission and update both hold this per-session gate. A submission
        // that wins establishes active-run state synchronously before releasing
        // it; an update that wins commits and evicts before a submit can attach.
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;

        // Hold the write lock through validation and persistence so other
        // attachment paths cannot observe or insert a stale service.
        let mut active = self.manager.inner.active_sessions.write().await;
        if let Some(service) = active.get(session_id) {
            if let Some(conflict) =
                config_replacement_conflict(service.has_active_operation(), service.has_sandbox())
            {
                return Err(anyhow!(conflict));
            }
        }

        // Independent server processes coordinate through the same
        // crash-safe lease. Keep it through validation, CAS persistence, and
        // local eviction, but never hold a SQLite transaction over model I/O.
        let _operation_lease = sessions::SessionOperationLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        )?;
        let _resource_lease = sessions::SessionResourceMutationLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        )?;
        self.manager.require_primary_operation_session(session_id)?;

        let current = sessions::load_session_config(&self.manager.inner.store_path, session_id)?;
        let mut prospective = current.clone();
        // The light model needs the credential destination policy, which the
        // plain field patch does not, so it is settled here instead.
        let light_field = std::mem::take(&mut request.light_model);
        apply_raw_config_patch(&mut prospective, request)?;
        if matches!(&light_field, RequestField::Omitted)
            && current.diagnostics.iter().any(|diagnostic| {
                diagnostic.starts_with(sessions::MALFORMED_LIGHT_MODEL_DIAGNOSTIC)
            })
        {
            return Err(request_configuration_error(
                "stored light-model settings are malformed; include light_model in the update to repair them, or null to return to single-model mode",
            ));
        }
        let (backend, reasoning_effort, extra_headers) = parse_prospective_model_config(
            &mut prospective,
            backend_selected,
            base_url_omitted,
            api_key_env_omitted,
        )?;
        match light_field {
            RequestField::Omitted => {
                // A key-only patch still moves an inherited light selector
                // along to the normalized primary selector, including a clear
                // when the primary switches to managed auth.
                let inherited = light_model::InheritedCredential {
                    backend,
                    name: prospective.api_key_env.as_deref(),
                    previous: current.api_key_env.as_deref(),
                };
                if let Some(light) = prospective.light_model.as_mut() {
                    light_model::rotate_inherited_credential(light, inherited);
                }
            }
            RequestField::Null => prospective.light_model = None,
            RequestField::Value(light) => {
                // A same-backend light model with no explicit selector
                // inherits the session's primary one, following it when the
                // primary selector changes.
                let inherited = Some(light_model::InheritedCredential {
                    backend,
                    name: prospective.api_key_env.as_deref(),
                    previous: current.api_key_env.as_deref(),
                });
                prospective.light_model = Some(light_model::normalize(
                    light,
                    &NacConfig::load_credential_destination_policy(&self.manager.inner.root_cwd)?,
                    inherited,
                )?);
            }
        }

        // An untouched destination carries no new risk, so only a patch that
        // moves the endpoint or switches the credential type is authorized.
        if !base_url_omitted || backend_selected {
            enforce_trusted_base_url(
                Some(backend),
                Some(prospective.base_url.as_str()),
                &NacConfig::load_credential_destination_policy(&self.manager.inner.root_cwd)?,
            )?;
        }

        let _settings = EffectiveModelSettings::new(
            backend,
            prospective.model.clone(),
            prospective.base_url.clone(),
            reasoning_effort,
            prospective.api_key_env.clone(),
            extra_headers.clone(),
        )?;
        // Fail a broken light model here, not at the session's next launch.
        if let Some(light) = prospective.light_model.as_ref() {
            nac_core::light_model::validate(light, &extra_headers)
                .map_err(request_configuration_error_from)?;
        }
        validate_model_configuration(
            backend,
            &prospective.model,
            Some(&prospective.base_url),
            reasoning_effort,
            prospective.api_key_env.as_deref(),
            &extra_headers,
        )?;
        // Persist only revisioned session-configuration columns after all
        // caller-controlled model configuration and credential checks succeed.
        // The revision CAS rejects a concurrent PATCH, while run/history writes remain independent of these columns.
        // A store failure or conflict leaves the active map untouched.
        sessions::update_raw_session_config(&self.manager.inner.store_path, &prospective)?;
        active.remove(session_id);
        Ok(())
    }
}
