use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use nac_core::{
    light_model::LightModelSettings,
    model::{
        list_managed_provider_models, list_provider_models_with_http_policy,
        provider_default_base_url, provider_for_model, provider_uses_api_key, remove_api_key,
        resolve_backend_api_key, resolve_model_base_url_with_policy, store_api_key, BackendKind,
        EffectiveModelSettings, ManagedAuthProvider, ProviderModel, ReasoningEffort, ServiceTier,
    },
    model_configurations::{
        self, ModelConfigurationRecord, ModelConfigurationStoreError, NewModelConfiguration,
    },
    runtime::NacConfig,
};

use super::Field;
use crate::{light_model, SessionManager, GENERATED_CREDENTIAL_PREFIX};

pub(crate) struct CreateModelConfiguration {
    pub(crate) name: String,
    pub(crate) backend: BackendKind,
    pub(crate) model: String,
    pub(crate) base_url: Option<String>,
    pub(crate) allow_insecure_http: bool,
    pub(crate) api_key: Option<String>,
    pub(crate) reasoning_effort: Option<ReasoningEffort>,
    pub(crate) service_tier: Option<ServiceTier>,
    pub(crate) extra_headers: Option<BTreeMap<String, String>>,
    pub(crate) orchestrator_compaction_threshold: Option<u64>,
    pub(crate) initial_prompt: Option<String>,
    pub(crate) light_model: Option<LightModelSettings>,
}

pub(crate) struct UpdateModelConfiguration {
    pub(crate) name: Field<String>,
    pub(crate) backend: Field<BackendKind>,
    pub(crate) model: Field<String>,
    pub(crate) base_url: Field<String>,
    pub(crate) allow_insecure_http: Field<bool>,
    pub(crate) api_key: Field<String>,
    pub(crate) reasoning_effort: Field<ReasoningEffort>,
    pub(crate) service_tier: Field<ServiceTier>,
    pub(crate) extra_headers: Field<BTreeMap<String, String>>,
    pub(crate) orchestrator_compaction_threshold: Field<u64>,
    pub(crate) initial_prompt: Field<String>,
    pub(crate) light_model: Field<LightModelSettings>,
}

pub(crate) struct ResolvedModelConfiguration {
    pub(crate) backend: BackendKind,
    pub(crate) model: Option<String>,
    pub(crate) base_url: String,
    pub(crate) allow_insecure_http: bool,
    pub(crate) api_key_env: Option<String>,
    pub(crate) reasoning_effort: Option<ReasoningEffort>,
    pub(crate) service_tier: Option<ServiceTier>,
    pub(crate) models: Vec<ProviderModel>,
    pub(crate) models_error: Option<String>,
}

#[derive(Debug)]
pub(crate) enum ModelConfigurationApplicationError {
    InvalidInput(String),
    Provider(String),
    Store(ModelConfigurationStoreError),
    Internal(anyhow::Error),
}

impl std::fmt::Display for ModelConfigurationApplicationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidInput(message) | Self::Provider(message) => formatter.write_str(message),
            Self::Store(error) => error.fmt(formatter),
            Self::Internal(error) => error.fmt(formatter),
        }
    }
}

impl std::error::Error for ModelConfigurationApplicationError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::InvalidInput(_) | Self::Provider(_) => None,
            Self::Store(error) => Some(error),
            Self::Internal(error) => Some(error.as_ref()),
        }
    }
}

impl From<ModelConfigurationStoreError> for ModelConfigurationApplicationError {
    fn from(error: ModelConfigurationStoreError) -> Self {
        Self::Store(error)
    }
}

/// Saved model-configuration use cases that coordinate durable rows with the
/// separate write-only credential store.
pub(crate) struct ModelConfigurationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> ModelConfigurationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    fn store_path(&self) -> &Path {
        &self.manager.inner.store_path
    }

    pub(crate) fn list(
        &self,
    ) -> Result<Vec<ModelConfigurationRecord>, ModelConfigurationStoreError> {
        model_configurations::list_model_configurations(self.store_path())
    }

    pub(crate) fn create(
        &self,
        command: CreateModelConfiguration,
    ) -> Result<ModelConfigurationRecord, ModelConfigurationApplicationError> {
        let backend = command.backend;
        let allow_insecure_http = command.allow_insecure_http;
        let base_url =
            self.settle_base_url(backend, command.base_url.as_deref(), allow_insecure_http)?;
        let api_key = command
            .api_key
            .as_deref()
            .map(str::trim)
            .unwrap_or_default();
        let expects_key = provider_uses_api_key(backend);
        if expects_key && api_key.is_empty() {
            return Err(invalid(format!("backend '{backend}' requires an API key")));
        }
        if !expects_key && !api_key.is_empty() {
            return Err(invalid(format!(
                "backend '{backend}' authenticates with a stored login and accepts no API key"
            )));
        }

        let id = uuid::Uuid::new_v4();
        let credential_name =
            expects_key.then(|| format!("{GENERATED_CREDENTIAL_PREFIX}{}", id.simple()));
        let light_model = command
            .light_model
            .map(|light| {
                light_model::normalize_with_http_policy(
                    light,
                    credential_name
                        .as_deref()
                        .map(|name| light_model::InheritedCredential {
                            backend,
                            name: Some(name),
                            previous: None,
                        }),
                    allow_insecure_http,
                )
            })
            .transpose()
            .map_err(|error| invalid(error.to_string()))?;
        let configuration = NewModelConfiguration {
            name: command.name,
            backend: backend.to_string(),
            model: command.model,
            base_url,
            allow_insecure_http,
            api_key_env: credential_name.clone(),
            reasoning_effort: command
                .reasoning_effort
                .map(|effort| effort.as_str().to_string()),
            service_tier: command.service_tier.map(|tier| tier.as_str().to_owned()),
            extra_headers: command.extra_headers.unwrap_or_default(),
            orchestrator_compaction_threshold: command.orchestrator_compaction_threshold,
            initial_prompt: command.initial_prompt,
            light_model,
        };
        validate_tier(&configuration)?;

        if let Some(name) = credential_name.as_deref() {
            store_api_key(name, api_key).map_err(ModelConfigurationApplicationError::Internal)?;
        }
        if let Some(light) = configuration.light_model.as_ref() {
            if let Err(error) = nac_core::light_model::validate_with_http_policy(
                light,
                &configuration.extra_headers,
                configuration.allow_insecure_http,
            ) {
                if let Some(name) = credential_name.as_deref() {
                    let _ = remove_api_key(name);
                }
                return Err(invalid(format!("{error:#}")));
            }
        }
        match model_configurations::insert_model_configuration(
            self.store_path(),
            &id.to_string(),
            configuration,
        ) {
            Ok(record) => Ok(record),
            Err(error) => {
                if let Some(name) = credential_name.as_deref() {
                    let _ = remove_api_key(name);
                }
                Err(error.into())
            }
        }
    }

    pub(crate) fn update(
        &self,
        config_id: &str,
        command: UpdateModelConfiguration,
    ) -> Result<ModelConfigurationRecord, ModelConfigurationApplicationError> {
        let existing =
            model_configurations::load_model_configuration(self.store_path(), config_id)?;
        let stored_backend: BackendKind = existing
            .backend
            .parse()
            .map_err(|message: String| invalid(message))?;
        let backend = match command.backend {
            Field::Set(kind) => kind,
            Field::Unchanged | Field::Clear => stored_backend,
        };
        let requested_base_url = match command.base_url {
            Field::Set(url) => Some(url),
            Field::Clear => None,
            Field::Unchanged => (backend == stored_backend).then(|| existing.base_url.clone()),
        };
        let allow_insecure_http = match command.allow_insecure_http {
            Field::Set(value) => value,
            Field::Clear => false,
            Field::Unchanged => existing.allow_insecure_http,
        };
        let base_url =
            self.settle_base_url(backend, requested_base_url.as_deref(), allow_insecure_http)?;

        let expects_key = provider_uses_api_key(backend);
        let supplied_key = match &command.api_key {
            Field::Set(key) => Some(key.trim().to_string()),
            _ => None,
        };
        if !expects_key && supplied_key.as_deref().is_some_and(|key| !key.is_empty()) {
            return Err(invalid(format!(
                "backend '{backend}' authenticates with a stored login and accepts no API key"
            )));
        }
        let replacement_credential = supplied_key.filter(|key| !key.is_empty()).map(|key| {
            (
                format!(
                    "{GENERATED_CREDENTIAL_PREFIX}{}",
                    uuid::Uuid::new_v4().simple()
                ),
                key,
            )
        });
        let (api_key_env, superseded) = if !expects_key {
            (None, existing.api_key_env.clone())
        } else if let Some((name, _)) = replacement_credential.as_ref() {
            (Some(name.clone()), existing.api_key_env.clone())
        } else if matches!(command.api_key, Field::Clear) || existing.api_key_env.is_none() {
            return Err(invalid(format!("backend '{backend}' requires an API key")));
        } else {
            (existing.api_key_env.clone(), None)
        };

        let inherited = light_model::InheritedCredential {
            backend,
            name: api_key_env.as_deref(),
            previous: existing.api_key_env.as_deref(),
        };
        let tier_unchanged = matches!(&command.service_tier, Field::Unchanged);
        let mut configuration = NewModelConfiguration {
            name: required_text(command.name, &existing.name),
            backend: backend.to_string(),
            model: required_text(command.model, &existing.model),
            base_url,
            allow_insecure_http,
            api_key_env: api_key_env.clone(),
            reasoning_effort: match command.reasoning_effort {
                Field::Set(effort) => Some(effort.as_str().to_string()),
                Field::Clear => None,
                Field::Unchanged => existing.reasoning_effort.clone(),
            },
            service_tier: match command.service_tier {
                Field::Set(tier) => Some(tier.as_str().to_owned()),
                Field::Clear => None,
                Field::Unchanged => existing.service_tier.clone(),
            },
            extra_headers: match command.extra_headers {
                Field::Set(headers) => headers,
                Field::Clear => BTreeMap::new(),
                Field::Unchanged => existing.extra_headers.clone(),
            },
            orchestrator_compaction_threshold: match command.orchestrator_compaction_threshold {
                Field::Set(threshold) => (threshold != 0).then_some(threshold),
                Field::Clear => None,
                Field::Unchanged => existing.orchestrator_compaction_threshold,
            },
            initial_prompt: optional_value(command.initial_prompt, existing.initial_prompt.clone()),
            light_model: match command.light_model {
                Field::Set(light) => Some(
                    light_model::normalize_with_http_policy(
                        light,
                        Some(inherited),
                        allow_insecure_http,
                    )
                    .map_err(|error| invalid(error.to_string()))?,
                ),
                Field::Clear => None,
                Field::Unchanged => existing.light_model.clone().map(|mut light| {
                    light_model::rotate_inherited_credential(&mut light, inherited);
                    light
                }),
            },
        };

        let route_changed = existing.backend != configuration.backend
            || existing.model != configuration.model
            || existing.base_url != configuration.base_url;
        if route_changed || !tier_unchanged {
            if let Err(error) = validate_tier(&configuration) {
                if route_changed
                    && tier_unchanged
                    && configuration.service_tier.is_some()
                    && backend == BackendKind::ChatGptCodexResponses
                {
                    configuration.service_tier = Some(ServiceTier::Standard.as_str().to_owned());
                } else {
                    return Err(error);
                }
            }
        }

        if let Some((name, key)) = replacement_credential.as_ref() {
            store_api_key(name, key).map_err(ModelConfigurationApplicationError::Internal)?;
        }
        if let Some(light) = configuration.light_model.as_ref() {
            if let Err(error) = nac_core::light_model::validate_with_http_policy(
                light,
                &configuration.extra_headers,
                configuration.allow_insecure_http,
            ) {
                if let Some((name, _)) = replacement_credential.as_ref() {
                    let _ = remove_api_key(name);
                }
                return Err(invalid(format!("{error:#}")));
            }
        }
        match model_configurations::update_model_configuration(
            self.store_path(),
            config_id,
            configuration,
        ) {
            Ok(record) => {
                let mut retired: BTreeSet<&str> = existing
                    .light_model
                    .as_ref()
                    .and_then(|light| light.api_key_env.as_deref())
                    .into_iter()
                    .chain(superseded.as_deref())
                    .filter(|name| name.starts_with(GENERATED_CREDENTIAL_PREFIX))
                    .collect();
                for kept in record.api_key_env.iter().map(String::as_str).chain(
                    record
                        .light_model
                        .as_ref()
                        .and_then(|light| light.api_key_env.as_deref()),
                ) {
                    retired.remove(kept);
                }
                for name in retired {
                    let _ = remove_api_key(name);
                }
                Ok(record)
            }
            Err(error) => {
                if api_key_env != existing.api_key_env {
                    if let Some(name) = api_key_env.as_deref() {
                        let _ = remove_api_key(name);
                    }
                }
                Err(error.into())
            }
        }
    }

    pub(crate) async fn resolve_from_file(
        &self,
        raw_path: &str,
    ) -> Result<ResolvedModelConfiguration, ModelConfigurationApplicationError> {
        let path = PathBuf::from(raw_path.trim());
        if path.as_os_str().is_empty() {
            return Err(invalid("a configuration file path is required".to_string()));
        }
        let config =
            NacConfig::load_from_file(&path).map_err(|error| invalid(error.to_string()))?;
        let identity = NacConfig::load_model_identity_from_file(&path)
            .map_err(|error| invalid(error.to_string()))?;
        let backend = identity
            .backend
            .or_else(|| config.model.model.as_deref().and_then(provider_for_model))
            .ok_or_else(|| {
                invalid(format!(
                    "{} names no model the catalog recognizes, so it cannot describe a provider",
                    path.display()
                ))
            })?;
        self.resolve(
            backend,
            config.model.model,
            identity.base_url,
            identity.api_key_env,
            config.model.reasoning_effort,
            config.model.service_tier,
            false,
        )
        .await
    }

    pub(crate) async fn resolve_saved(
        &self,
        config_id: &str,
    ) -> Result<ResolvedModelConfiguration, ModelConfigurationApplicationError> {
        let record = model_configurations::load_model_configuration(self.store_path(), config_id)?;
        let backend: BackendKind = record
            .backend
            .parse()
            .map_err(|message: String| invalid(message))?;
        let reasoning_effort = record
            .reasoning_effort
            .as_deref()
            .map(parse_reasoning_effort)
            .transpose()?;
        let service_tier = record
            .service_tier
            .as_deref()
            .map(|value| {
                value
                    .parse()
                    .map_err(|error| invalid(format!("invalid service_tier: {error}")))
            })
            .transpose()?;
        self.resolve(
            backend,
            Some(record.model),
            Some(record.base_url),
            record.api_key_env,
            reasoning_effort,
            service_tier,
            record.allow_insecure_http,
        )
        .await
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "the complete prospective model tuple is resolved together"
    )]
    async fn resolve(
        &self,
        backend: BackendKind,
        model: Option<String>,
        base_url: Option<String>,
        api_key_env: Option<String>,
        reasoning_effort: Option<ReasoningEffort>,
        service_tier: Option<ServiceTier>,
        allow_insecure_http: bool,
    ) -> Result<ResolvedModelConfiguration, ModelConfigurationApplicationError> {
        let base_url = self.settle_base_url(backend, base_url.as_deref(), allow_insecure_http)?;
        let mut models_error = None;
        let models = match ManagedAuthProvider::for_backend(backend) {
            Some(provider) => match list_managed_provider_models(provider).await {
                Ok(models) => models,
                Err(error) => {
                    models_error = Some(error.to_string());
                    Vec::new()
                }
            },
            None => {
                let api_key = resolve_backend_api_key(backend, api_key_env.as_deref())
                    .map_err(|error| invalid(error.to_string()))?;
                match list_provider_models_with_http_policy(
                    backend,
                    &base_url,
                    &api_key,
                    allow_insecure_http,
                )
                .await
                {
                    Ok(models) => models,
                    Err(error) if backend == BackendKind::OpenAiChatCompletions => {
                        // Saved/manual model ids are authoritative. Discovery
                        // only supplies suggestions and key diagnostics; an
                        // unavailable or incomplete /models endpoint must not
                        // make an otherwise runnable configuration uneditable.
                        models_error = Some(error.to_string());
                        Vec::new()
                    }
                    Err(error) => {
                        return Err(ModelConfigurationApplicationError::Provider(
                            error.to_string(),
                        ))
                    }
                }
            }
        };
        Ok(ResolvedModelConfiguration {
            backend,
            model,
            base_url,
            allow_insecure_http,
            api_key_env,
            reasoning_effort,
            service_tier,
            models,
            models_error,
        })
    }

    /// Deletes the durable row before retiring only server-generated secrets.
    /// A failed or rejected row deletion therefore cannot invalidate a live
    /// configuration, and operator-owned environment selectors are untouched.
    pub(crate) fn delete(&self, config_id: &str) -> Result<(), ModelConfigurationStoreError> {
        let record = model_configurations::load_model_configuration(self.store_path(), config_id)?;
        model_configurations::delete_model_configuration(self.store_path(), config_id)?;

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

    fn settle_base_url(
        &self,
        backend: BackendKind,
        requested: Option<&str>,
        allow_insecure_http: bool,
    ) -> Result<String, ModelConfigurationApplicationError> {
        let base_url = requested
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| provider_default_base_url(backend).map(str::to_string))
            .ok_or_else(|| {
                invalid(format!(
                    "backend '{backend}' has no default base URL; supply one"
                ))
            })?;
        resolve_model_base_url_with_policy(backend, Some(base_url), allow_insecure_http)
            .map_err(|error| invalid(error.to_string()))
    }
}

fn invalid(message: String) -> ModelConfigurationApplicationError {
    ModelConfigurationApplicationError::InvalidInput(message)
}

fn required_text(field: Field<String>, current: &str) -> String {
    match field {
        Field::Set(value) => value,
        Field::Clear => String::new(),
        Field::Unchanged => current.to_string(),
    }
}

fn optional_value<T>(field: Field<T>, current: Option<T>) -> Option<T> {
    match field {
        Field::Set(value) => Some(value),
        Field::Clear => None,
        Field::Unchanged => current,
    }
}

fn parse_reasoning_effort(
    value: &str,
) -> Result<ReasoningEffort, ModelConfigurationApplicationError> {
    serde_json::from_value(serde_json::Value::String(value.to_string())).map_err(|error| {
        invalid(format!(
            "invalid model configuration: invalid 'reasoning_effort' value '{value}': {error}"
        ))
    })
}

fn validate_tier(
    configuration: &NewModelConfiguration,
) -> Result<(), ModelConfigurationApplicationError> {
    let Some(tier) = configuration.service_tier.as_deref() else {
        return Ok(());
    };
    let tier: ServiceTier = tier.parse().map_err(|error: String| invalid(error))?;
    let backend: BackendKind = configuration
        .backend
        .parse()
        .map_err(|error: String| invalid(error))?;
    let reasoning = configuration
        .reasoning_effort
        .as_deref()
        .map(parse_reasoning_effort)
        .transpose()?;
    EffectiveModelSettings::new_with_http_policy(
        backend,
        configuration.model.clone(),
        configuration.base_url.clone(),
        reasoning,
        configuration.api_key_env.clone(),
        configuration.extra_headers.clone(),
        configuration.allow_insecure_http,
    )
    .and_then(|settings| settings.with_service_tier(Some(tier)))
    .map(|_| ())
    .map_err(|error| invalid(format!("{error:#}")))
}
