use super::*;

pub(super) fn default_model_for_backend(backend: BackendKind) -> String {
    match backend {
        BackendKind::DeepSeekChat => "deepseek-v4-pro".to_string(),
        BackendKind::OpenAiResponses => "gpt-5.5".to_string(),
        BackendKind::FireworksChat => "gpt-5.5".to_string(),
        BackendKind::Auto => unreachable!("auto backend does not have a default model"),
    }
}

pub(super) fn default_reasoning_effort(backend: BackendKind) -> Option<ReasoningEffort> {
    match backend {
        BackendKind::OpenAiResponses => Some(ReasoningEffort::Xhigh),
        BackendKind::DeepSeekChat => None,
        BackendKind::FireworksChat => None,
        BackendKind::Auto => None,
    }
}

pub(super) fn default_base_url_for_backend_hint(backend: BackendKind) -> &'static str {
    match backend {
        BackendKind::DeepSeekChat => "https://api.deepseek.com",
        BackendKind::Auto | BackendKind::FireworksChat | BackendKind::OpenAiResponses => {
            "https://api.openai.com/v1"
        }
    }
}

pub(super) fn api_key_for_backend(
    backend: BackendKind,
    configured_env: Option<&str>,
) -> Result<String> {
    match backend {
        BackendKind::Auto
        | BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::OpenAiResponses => {
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

    if host.contains("fireworks.ai") {
        return Ok(BackendKind::FireworksChat);
    }
    if host == "api.deepseek.com" {
        return Ok(BackendKind::DeepSeekChat);
    }
    if host == "api.openai.com" {
        return Ok(BackendKind::OpenAiResponses);
    }

    Err(anyhow!(
        "could not infer backend from '{}'; pass --backend deepseek-chat, --backend fireworks-chat, or --backend openai-responses",
        base_url
    ))
}
