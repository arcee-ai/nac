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

pub fn validate_backend_api_key_env(
    backend: BackendKind,
    _base_url: Option<&str>,
    api_key_env: Option<&str>,
) -> Result<()> {
    let Some(_) = api_key_env.filter(|name| !name.trim().is_empty()) else {
        return Ok(());
    };

    if backend == BackendKind::ArceeAuth {
        return Err(model_configuration_error(
            "invalid model configuration: api_key_env is not supported for backend 'arcee-auth'; managed Arcee auth uses arcee_auth.json",
        ));
    }

    Ok(())
}

pub(super) fn api_key_for_backend(
    backend: BackendKind,
    configured_env: Option<&str>,
) -> Result<String> {
    match backend {
        BackendKind::ChatGptCodexResponses | BackendKind::ArceeAuth => Ok(String::new()),
        BackendKind::TogetherChat => {
            if let Ok(api_key) = std::env::var("TOGETHER_API_KEY") {
                return Ok(api_key);
            }
            if let Some(env_name) = configured_env.filter(|name| *name != "TOGETHER_API_KEY") {
                return std::env::var(env_name).map_err(|_| {
                    anyhow!(
                        "TOGETHER_API_KEY environment variable is not set and configured api_key_env '{}' is not set",
                        env_name
                    )
                });
            }
            Err(anyhow!("TOGETHER_API_KEY environment variable is not set"))
        }
        BackendKind::AnthropicMessages => {
            if let Ok(api_key) = std::env::var("ANTHROPIC_API_KEY") {
                return Ok(api_key);
            }
            if let Some(env_name) = configured_env.filter(|name| *name != "ANTHROPIC_API_KEY") {
                return std::env::var(env_name).map_err(|_| {
                    anyhow!(
                        "ANTHROPIC_API_KEY environment variable is not set and configured api_key_env '{}' is not set",
                        env_name
                    )
                });
            }
            Err(anyhow!("ANTHROPIC_API_KEY environment variable is not set"))
        }
        BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::OpenAiResponses
        | BackendKind::ArceeApi => {
            // Temporary compatibility: the strict resolver commit will make the
            // configured selector authoritative and remove OPENAI_API_KEY fallback.
            if let Ok(api_key) = std::env::var("OPENAI_API_KEY") {
                return Ok(api_key);
            }
            if let Some(env_name) = configured_env.filter(|name| *name != "OPENAI_API_KEY") {
                return std::env::var(env_name).map_err(|_| {
                    anyhow!(
                        "OPENAI_API_KEY environment variable is not set and configured api_key_env '{}' is not set",
                        env_name
                    )
                });
            }
            Err(anyhow!("OPENAI_API_KEY environment variable is not set"))
        }
    }
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
