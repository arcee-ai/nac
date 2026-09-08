use std::collections::BTreeMap;

use anyhow::{anyhow, Result};
use nac_core::{
    model::{
        managed_backend_base_url, resolve_model_base_url, validate_caller_supplied_base_url,
        BackendKind, ReasoningEffort,
    },
    runtime::{CredentialDestinationPolicy, ModelOptions, OptionalModelOption, SandboxOptions},
    sessions,
};
use serde::Deserialize;

use super::{session_creation::SessionSandboxCommand, Field};

#[derive(Debug)]
pub(crate) struct RequestConfigurationError(String);

impl std::fmt::Display for RequestConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for RequestConfigurationError {}

pub(crate) fn validate_steering_instruction(
    instruction: &str,
) -> std::result::Result<(), RequestConfigurationError> {
    if instruction.trim().is_empty() {
        return Err(RequestConfigurationError(
            "steering instruction must not be empty or whitespace-only".to_string(),
        ));
    }
    Ok(())
}

pub(crate) fn request_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(RequestConfigurationError(message.into()))
}

/// Render a failing configuration error at the HTTP boundary. This is the
/// single place the full `{:#}` cause chain is rendered; inner layers keep
/// their chains intact under plain `.context(...)` messages, so the cause
/// appears exactly once.
pub(crate) fn request_configuration_error_from(error: anyhow::Error) -> anyhow::Error {
    request_configuration_error(format!("{error:#}"))
}

pub(crate) fn nonblank_request_string(value: String, field: &str) -> Result<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(request_configuration_error(format!(
            "invalid model configuration: field '{field}' must not be empty or whitespace-only"
        )));
    }
    Ok(normalized.to_string())
}

fn required_create_string(field: Field<String>, name: &str) -> Result<Option<String>> {
    match field {
        Field::Unchanged => Ok(None),
        Field::Clear => Err(request_configuration_error(format!(
            "invalid model configuration: required field '{name}' cannot be null"
        ))),
        Field::Set(value) => nonblank_request_string(value, name).map(Some),
    }
}

pub(crate) fn validated_compaction_threshold(threshold: u64) -> Result<u64> {
    if threshold > nac_core::MAX_SUPPORTED_TOKEN_COUNT {
        return Err(request_configuration_error(format!(
            "invalid orchestrator compaction threshold: must not exceed {} tokens",
            nac_core::MAX_SUPPORTED_TOKEN_COUNT
        )));
    }
    Ok(threshold)
}

pub(crate) fn create_compaction_threshold_override(field: Field<u64>) -> Result<Option<u64>> {
    match field {
        Field::Unchanged => Ok(None),
        Field::Clear => Ok(Some(0)),
        Field::Set(threshold) => validated_compaction_threshold(threshold).map(Some),
    }
}

pub(crate) fn model_options(
    model: Field<String>,
    base_url: Field<String>,
    backend: Field<String>,
    reasoning_effort: Field<String>,
    api_key_env: Field<String>,
    extra_headers: Field<BTreeMap<String, String>>,
) -> Result<ModelOptions> {
    let backend = required_create_string(backend, "backend")?
        .map(|value| parse_request_enum::<BackendKind>(&value, "backend"))
        .transpose()?;
    let reasoning_effort = match reasoning_effort {
        Field::Unchanged => OptionalModelOption::Inherit,
        Field::Clear => OptionalModelOption::Clear,
        Field::Set(value) => {
            let value = nonblank_request_string(value, "reasoning_effort")?;
            OptionalModelOption::Value(parse_request_enum::<ReasoningEffort>(
                &value,
                "reasoning_effort",
            )?)
        }
    };
    let api_key_env = match api_key_env {
        Field::Unchanged => OptionalModelOption::Inherit,
        Field::Clear => OptionalModelOption::Clear,
        Field::Set(value) => OptionalModelOption::Value(value),
    };
    let extra_headers = match extra_headers {
        Field::Unchanged => None,
        Field::Clear => Some(BTreeMap::new()),
        Field::Set(headers) => Some(headers),
    };

    Ok(ModelOptions {
        backend,
        reasoning_effort,
        api_base_url: required_create_string(base_url, "base_url")?,
        api_model: required_create_string(model, "model")?,
        api_key_env,
        trusted_api_key_file: None,
        extra_headers,
        light_model: None,
    })
}

/// Reject a credential destination that only the HTTP request asked for.
///
/// `config.toml` is hand-edited and therefore authoritative; a request body
/// reaching the unauthenticated loopback API is not, so it may only name a
/// known provider origin, a local address, or a pre-approved host.
pub(crate) fn enforce_trusted_base_url(
    backend: Option<BackendKind>,
    base_url: Option<&str>,
    policy: &CredentialDestinationPolicy,
) -> Result<()> {
    let (Some(backend), Some(base_url)) = (backend, base_url) else {
        return Ok(());
    };
    if policy.configured_base_url.as_deref() == Some(base_url) {
        return Ok(());
    }
    validate_caller_supplied_base_url(backend, base_url, &policy.trusted_hosts)
}

pub(crate) fn parse_prospective_model_config(
    config: &mut sessions::RawSessionConfig,
    backend_selected: bool,
    base_url_omitted: bool,
    api_key_env_omitted: bool,
) -> Result<(
    BackendKind,
    Option<ReasoningEffort>,
    BTreeMap<String, String>,
)> {
    nonblank_request_string(config.model.clone(), "model")?;
    let backend_raw = config.backend.as_deref().ok_or_else(|| {
        request_configuration_error(
            "invalid model configuration: required field 'backend' is missing; explicitly select a backend",
        )
    })?;
    let backend_raw = nonblank_request_string(backend_raw.to_string(), "backend")?;
    let backend = parse_request_enum::<BackendKind>(&backend_raw, "backend")?;
    let managed_base_url = managed_backend_base_url(backend);
    // Selecting a managed backend is a tuple-level operation: omitted fields
    // select its canonical endpoint and stored credential mode rather than
    // inheriting an unrelated API-key backend's values. Concrete request values
    // remain authoritative and proceed to normal validation.
    let use_managed_base_url = managed_base_url.is_some()
        && ((backend_selected && base_url_omitted) || config.base_url.trim().is_empty());
    let stored_base_url = if use_managed_base_url {
        None
    } else {
        Some(config.base_url.clone())
    };
    config.base_url = resolve_model_base_url(backend, stored_base_url)?;
    if managed_base_url.is_some() && api_key_env_omitted {
        config.api_key_env = None;
    }
    let reasoning_effort = config
        .reasoning_effort
        .as_deref()
        .map(|raw| {
            let raw = nonblank_request_string(raw.to_string(), "reasoning_effort")?;
            parse_request_enum::<ReasoningEffort>(&raw, "reasoning_effort")
        })
        .transpose()?;
    let extra_headers = config
        .extra_headers_json
        .as_deref()
        .filter(|raw| !raw.is_empty())
        .map(|raw| {
            serde_json::from_str::<BTreeMap<String, String>>(raw).map_err(|error| {
                request_configuration_error(format!(
                    "invalid model configuration: stored extra_headers must be replaced or cleared: {error}"
                ))
            })
        })
        .transpose()?
        .unwrap_or_default();
    Ok((backend, reasoning_effort, extra_headers))
}

fn parse_request_enum<T>(value: &str, field: &str) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(serde_json::Value::String(value.to_string())).map_err(|error| {
        request_configuration_error(format!(
            "invalid model configuration: invalid '{field}' value '{value}': {error}"
        ))
    })
}

pub(crate) fn sandbox_options(request: SessionSandboxCommand) -> SandboxOptions {
    SandboxOptions {
        sandbox: request.enabled,
        no_mount_cwd: request.no_mount_cwd,
        mounts: request.mounts,
        mounts_ro: request.mounts_ro,
        internal_mounts: Vec::new(),
        sandbox_image: request.image,
        sandbox_gpus: request.gpus,
        sandbox_shm_size: request.shm_size,
        sandbox_session_key: request.session_key,
        sandbox_workdir: request.workdir,
        sandbox_backend: request.backend,
        sandbox_cpus: request.cpus,
        sandbox_mem: request.memory_mib,
        sandbox_activity_key: request.activity_key,
    }
}

pub(crate) fn sandbox_requested(request: &SessionSandboxCommand) -> bool {
    request.enabled
        || request.no_mount_cwd
        || !request.mounts.is_empty()
        || !request.mounts_ro.is_empty()
        || request.image.is_some()
        || !request.gpus.is_empty()
        || request.shm_size.is_some()
        || request.session_key.is_some()
        || request.workdir.is_some()
}
