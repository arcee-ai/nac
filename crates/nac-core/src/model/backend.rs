use super::*;

pub(super) fn is_valid_env_name(name: &str) -> bool {
    let mut bytes = name.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z' | b'a'..=b'z' | b'_'))
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

pub(super) fn api_key_backend(backend: BackendKind) -> bool {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AnthropicReasoningCapabilities {
    /// Model family supports adaptive thinking and low/medium/high effort.
    Adaptive,
    /// Model family additionally supports Anthropic's wire-level `max` effort.
    AdaptiveWithMax,
    /// The configured model is not known to support this request schema.
    NoneOnly,
}

/// Match a documented Anthropic family name or one of its dated snapshots.
///
/// Deliberately do not treat arbitrary suffixes (including `-latest`) as known:
/// new aliases and older models must be reviewed before NAC emits thinking
/// controls for them.
fn anthropic_model_family(model: &str, family: &str) -> bool {
    model == family
        || model
            .strip_prefix(family)
            .and_then(|suffix| suffix.strip_prefix('-'))
            .is_some_and(|snapshot| {
                snapshot.len() == 8 && snapshot.bytes().all(|byte| byte.is_ascii_digit())
            })
}

fn anthropic_reasoning_capabilities(model: &str) -> AnthropicReasoningCapabilities {
    if anthropic_model_family(model, "claude-opus-4-6") {
        AnthropicReasoningCapabilities::AdaptiveWithMax
    } else if anthropic_model_family(model, "claude-sonnet-4-6") {
        AnthropicReasoningCapabilities::Adaptive
    } else {
        // Older and unknown models may use a different thinking schema (for
        // example, manual budget_tokens) or may keep thinking always on.
        AnthropicReasoningCapabilities::NoneOnly
    }
}

/// Validate effort values against the selected backend and model request schema.
///
/// No backend receives an application-selected default. Anthropic is checked at
/// model-family granularity because adaptive thinking and effort tiers are not
/// portable across Claude generations.
pub fn validate_model_reasoning_effort(
    backend: BackendKind,
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
) -> Result<()> {
    let Some(effort) = reasoning_effort else {
        return Ok(());
    };

    let supported = match backend {
        BackendKind::DeepSeekChat => matches!(
            effort,
            ReasoningEffort::None | ReasoningEffort::High | ReasoningEffort::Xhigh
        ),
        BackendKind::FireworksChat | BackendKind::TogetherChat => matches!(
            effort,
            ReasoningEffort::None
                | ReasoningEffort::Low
                | ReasoningEffort::Medium
                | ReasoningEffort::High
        ),
        BackendKind::OpenAiResponses | BackendKind::ChatGptCodexResponses => true,
        BackendKind::AnthropicMessages => match anthropic_reasoning_capabilities(model) {
            // `none` means omission on Anthropic. It is safe for every family,
            // including models whose adaptive thinking is always on.
            _ if effort == ReasoningEffort::None => true,
            AnthropicReasoningCapabilities::AdaptiveWithMax => matches!(
                effort,
                ReasoningEffort::Low
                    | ReasoningEffort::Medium
                    | ReasoningEffort::High
                    | ReasoningEffort::Xhigh
            ),
            AnthropicReasoningCapabilities::Adaptive => matches!(
                effort,
                ReasoningEffort::Low | ReasoningEffort::Medium | ReasoningEffort::High
            ),
            AnthropicReasoningCapabilities::NoneOnly => false,
        },
        BackendKind::ArceeAuth | BackendKind::ArceeApi => false,
    };
    if supported {
        return Ok(());
    }

    if backend == BackendKind::AnthropicMessages {
        let allowed = match anthropic_reasoning_capabilities(model) {
            AnthropicReasoningCapabilities::AdaptiveWithMax => "none, low, medium, high, or xhigh",
            AnthropicReasoningCapabilities::Adaptive => "none, low, medium, or high",
            AnthropicReasoningCapabilities::NoneOnly => "none only",
        };
        return Err(model_configuration_error(format!(
            "invalid model configuration: reasoning effort '{}' is not supported by backend '{}' for Anthropic model '{}'; supported values: {}",
            effort.as_str(), backend, model, allowed
        )));
    }

    let allowed = match backend {
        BackendKind::DeepSeekChat => "none, high, or xhigh",
        BackendKind::FireworksChat | BackendKind::TogetherChat => "none, low, medium, or high",
        BackendKind::ArceeAuth | BackendKind::ArceeApi => "no explicit effort levels",
        BackendKind::OpenAiResponses
        | BackendKind::ChatGptCodexResponses
        | BackendKind::AnthropicMessages => unreachable!(),
    };
    Err(model_configuration_error(format!(
        "invalid model configuration: reasoning effort '{}' is not supported by backend '{}'; supported values: {}",
        effort.as_str(), backend, allowed
    )))
}

/// Provider origins NAC will send an API key to without an operator opt-in.
///
/// Arcee and Codex are absent because they enforce their own origin policies
/// before a credential is attached.
fn builtin_provider_hosts(backend: BackendKind) -> &'static [&'static str] {
    match backend {
        BackendKind::OpenAiResponses => &["api.openai.com"],
        BackendKind::AnthropicMessages => &["api.anthropic.com"],
        BackendKind::DeepSeekChat => &["api.deepseek.com"],
        BackendKind::TogetherChat => &["api.together.xyz"],
        BackendKind::FireworksChat => &["api.fireworks.ai"],
        BackendKind::ArceeApi | BackendKind::ArceeAuth | BackendKind::ChatGptCodexResponses => &[],
    }
}

fn normalized_host(host: &str) -> String {
    host.trim_end_matches('.').to_ascii_lowercase()
}

/// Reject a base URL that would send an API key to an origin the operator
/// never approved.
///
/// This is the trust boundary for values arriving over the unauthenticated
/// loopback HTTP API: `config.toml` is edited by hand and is therefore
/// authoritative, while a request body is not. Loopback and private-network
/// hosts stay usable without an opt-in so local proxies keep working.
pub fn validate_caller_supplied_base_url(
    backend: BackendKind,
    base_url: &str,
    trusted_hosts: &[String],
) -> Result<()> {
    let approved_hosts = builtin_provider_hosts(backend);
    if approved_hosts.is_empty() {
        return Ok(());
    }

    let parsed = Url::parse(base_url).map_err(|error| {
        model_configuration_error(format!(
            "invalid model configuration: base_url '{}' is not a valid absolute URL: {}",
            base_url, error
        ))
    })?;
    let host = parsed.host().ok_or_else(|| {
        model_configuration_error(format!(
            "invalid model configuration: base_url '{}' must include a host",
            base_url
        ))
    })?;
    if types::allows_plaintext_transport(&host) {
        return Ok(());
    }

    let host = normalized_host(parsed.host_str().unwrap_or_default());
    if approved_hosts.contains(&host.as_str())
        || trusted_hosts
            .iter()
            .any(|trusted| normalized_host(trusted.trim()) == host)
    {
        return Ok(());
    }

    Err(model_configuration_error(format!(
        "invalid model configuration: base_url host '{}' is not approved for backend '{}'; approved hosts are {}, and any other host must be listed under [security] trusted_base_url_hosts in config.toml before NAC sends credentials to it",
        host,
        backend,
        approved_hosts.join(", ")
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
    // The environment wins so that servers, CI, and managed workers keep the
    // credential they were started with; storage is the desktop fallback.
    let value = match std::env::var_os(env_name) {
        Some(value) => value.into_string().map_err(|_| {
            model_configuration_error(format!(
                "invalid model configuration: configured api_key_env '{}' contains a non-Unicode value for backend '{}'",
                env_name, backend
            ))
        })?,
        None => api_key_store::read_stored_api_key(env_name)
            .map_err(|error| model_configuration_error(error.to_string()))?
            .ok_or_else(|| {
                model_configuration_error(format!(
                    "invalid model configuration: configured api_key_env '{}' is not set for backend '{}' and no key is stored under that name",
                    env_name, backend
                ))
            })?,
    };
    if value.trim().is_empty() {
        return Err(model_configuration_error(format!(
            "invalid model configuration: configured api_key_env '{}' is empty or whitespace-only for backend '{}'",
            env_name, backend
        )));
    }
    Ok(value)
}
