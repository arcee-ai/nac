use super::*;

pub(super) fn default_model_for_backend(backend: BackendKind) -> String {
    match backend {
        BackendKind::DeepSeekChat => "deepseek-v4-pro".to_string(),
        BackendKind::OpenAiResponses => "gpt-5.5".to_string(),
        BackendKind::ChatGptCodexResponses => "gpt-5.5".to_string(),
        BackendKind::FireworksChat => "gpt-5.5".to_string(),
        BackendKind::TogetherChat => "meta-llama/Llama-3.3-70B-Instruct-Turbo".to_string(),
        BackendKind::AnthropicMessages => "claude-opus-4-6".to_string(),
        BackendKind::ArceeAuth | BackendKind::ArceeApi => "trinity-large-thinking".to_string(),
    }
}

pub(super) fn default_reasoning_effort(backend: BackendKind) -> Option<ReasoningEffort> {
    match backend {
        BackendKind::OpenAiResponses | BackendKind::ChatGptCodexResponses => {
            Some(ReasoningEffort::Xhigh)
        }
        BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::TogetherChat
        | BackendKind::AnthropicMessages
        | BackendKind::ArceeAuth
        | BackendKind::ArceeApi => None,
    }
}

pub(super) fn default_base_url_for_backend_hint(backend: BackendKind) -> &'static str {
    match backend {
        BackendKind::DeepSeekChat => "https://api.deepseek.com",
        BackendKind::ChatGptCodexResponses => "https://chatgpt.com/backend-api",
        BackendKind::AnthropicMessages => "https://api.anthropic.com",
        BackendKind::TogetherChat => "https://api.together.ai/v1",
        BackendKind::ArceeAuth | BackendKind::ArceeApi => "https://api.arcee.ai",
        BackendKind::FireworksChat | BackendKind::OpenAiResponses => "https://api.openai.com/v1",
    }
}

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

pub fn detect_backend(base_url: &str) -> Result<BackendKind> {
    let parsed = Url::parse(base_url)
        .map_err(|error| anyhow!("failed to parse OPENAI_BASE_URL '{}': {}", base_url, error))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("OPENAI_BASE_URL '{}' does not include a host", base_url))?;

    if host == "arcee.ai" || host.ends_with(".arcee.ai") {
        return Ok(BackendKind::ArceeAuth);
    }
    if host.contains("together.ai") {
        return Ok(BackendKind::TogetherChat);
    }
    if host.contains("fireworks.ai") {
        return Ok(BackendKind::FireworksChat);
    }
    if host == "api.deepseek.com" {
        return Ok(BackendKind::DeepSeekChat);
    }
    if host == "api.openai.com" {
        return Ok(BackendKind::OpenAiResponses);
    }
    if host == "api.anthropic.com" {
        return Ok(BackendKind::AnthropicMessages);
    }
    if host == "chatgpt.com" && parsed.path().contains("/backend-api") {
        return Ok(BackendKind::ChatGptCodexResponses);
    }

    Err(anyhow!(
        "could not infer backend from '{}'; select an explicit backend ({})",
        base_url,
        BackendKind::SUPPORTED
    ))
}
