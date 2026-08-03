use super::*;

fn is_valid_env_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z' | b'a'..=b'z' | b'_'))
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn api_key_backend(backend: BackendKind) -> bool {
    matches!(
        backend,
        BackendKind::DeepSeekChat
            | BackendKind::FireworksChat
            | BackendKind::TogetherChat
            | BackendKind::OpenAiResponses
            | BackendKind::AnthropicMessages
            | BackendKind::ArceeApi
    )
}

/// Human-readable supported-effort list for validation errors, derived from
/// the model's catalog thinking map ("none, high, or xhigh"; "none only";
/// "no explicit effort levels" for an empty map).
fn supported_effort_values(map: &ThinkingLevelMap) -> String {
    let supported = map
        .0
        .iter()
        .filter(|(_, wire)| wire.is_some())
        .map(|(effort, _)| effort.as_str())
        .collect::<Vec<_>>();
    match supported.as_slice() {
        [] => "no explicit effort levels".to_string(),
        [only] => format!("{only} only"),
        [rest @ .., last] => format!("{}, or {last}", rest.join(", ")),
    }
}

/// Validate effort values against the model's catalog thinking map (S4).
///
/// Known models resolve to their catalog entry (dated snapshots resolve
/// through their family entry); unknown models resolve to the provider's
/// `_default` entry, which encodes the conservative pre-S4 validation
/// matrix, so unknown models keep the historical conservative rejection.
/// No backend receives an application-selected default, and an explicitly
/// configured effort is rejected — never clamped — when the map does not
/// support it.
pub fn validate_model_reasoning_effort(
    backend: BackendKind,
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
) -> Result<()> {
    let Some(effort) = reasoning_effort else {
        return Ok(());
    };

    let map = &catalog::resolve(backend, model).thinking_level_map;
    if map.is_supported(effort) {
        return Ok(());
    }

    let allowed = supported_effort_values(map);
    if backend == BackendKind::AnthropicMessages {
        return Err(model_configuration_error(format!(
            "invalid model configuration: reasoning effort '{}' is not supported by backend '{}' for Anthropic model '{}'; supported values: {}",
            effort.as_str(), backend, model, allowed
        )));
    }
    Err(model_configuration_error(format!(
        "invalid model configuration: reasoning effort '{}' is not supported by backend '{}'; supported values: {}",
        effort.as_str(), backend, allowed
    )))
}

pub fn validate_backend_api_key_env(
    backend: BackendKind,
    _base_url: Option<&str>,
    api_key_env: Option<&str>,
) -> Result<()> {
    if api_key_backend(backend) {
        let Some(name) = api_key_env else {
            return Err(model_configuration_error(format!(
                "invalid model configuration: backend '{}' requires a nonblank api_key_env naming the environment variable containing its API key",
                backend
            )));
        };
        if name.trim().is_empty() {
            return Err(model_configuration_error(format!(
                "invalid model configuration: backend '{}' requires a nonblank api_key_env naming the environment variable containing its API key",
                backend
            )));
        }
        if !is_valid_env_name(name) {
            return Err(model_configuration_error(format!(
                "invalid model configuration: api_key_env '{}' is not a valid environment variable name for backend '{}'; expected [A-Za-z_][A-Za-z0-9_]*",
                name, backend
            )));
        }
        return Ok(());
    }

    if let Some(name) = api_key_env {
        let credential_source = match backend {
            BackendKind::ArceeAuth => "managed Arcee auth uses arcee_auth.json",
            BackendKind::ChatGptCodexResponses => "Codex uses stored OAuth from auth.json",
            _ => unreachable!("all API-key backends handled above"),
        };
        return Err(model_configuration_error(format!(
            "invalid model configuration: api_key_env '{}' is not supported for backend '{}'; {}",
            name, backend, credential_source
        )));
    }

    Ok(())
}

pub(super) fn api_key_for_backend(
    backend: BackendKind,
    configured_env: Option<&str>,
) -> Result<String> {
    validate_backend_api_key_env(backend, None, configured_env)?;
    if !api_key_backend(backend) {
        return Ok(String::new());
    }

    let env_name = configured_env.expect("validated API-key backend selector");
    let Some(value) = std::env::var_os(env_name) else {
        return Err(model_configuration_error(format!(
            "invalid model configuration: configured api_key_env '{}' is not set for backend '{}'",
            env_name, backend
        )));
    };
    let value = value.into_string().map_err(|_| {
        model_configuration_error(format!(
            "invalid model configuration: configured api_key_env '{}' contains a non-Unicode value for backend '{}'",
            env_name, backend
        ))
    })?;
    if value.trim().is_empty() {
        return Err(model_configuration_error(format!(
            "invalid model configuration: configured api_key_env '{}' is empty or whitespace-only for backend '{}'",
            env_name, backend
        )));
    }
    Ok(value)
}
