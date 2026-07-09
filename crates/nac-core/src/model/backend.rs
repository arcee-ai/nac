use super::*;

pub(super) fn default_model_for_backend(backend: BackendKind) -> String {
    match backend {
        BackendKind::DeepSeekChat => "deepseek-v4-pro".to_string(),
        BackendKind::OpenAiResponses => "gpt-5.5".to_string(),
        BackendKind::ChatGptCodexResponses => "gpt-5.5".to_string(),
        BackendKind::FireworksChat => "gpt-5.5".to_string(),
        BackendKind::TogetherChat => "meta-llama/Llama-3.3-70B-Instruct-Turbo".to_string(),
        BackendKind::AnthropicMessages => "claude-opus-4-6".to_string(),
        BackendKind::Arcee => "trinity-large-thinking".to_string(),
        BackendKind::Auto => unreachable!("auto backend does not have a default model"),
    }
}

pub(super) fn default_reasoning_effort(backend: BackendKind) -> Option<ReasoningEffort> {
    match backend {
        BackendKind::OpenAiResponses | BackendKind::ChatGptCodexResponses => {
            Some(ReasoningEffort::Xhigh)
        }
        BackendKind::DeepSeekChat => None,
        BackendKind::FireworksChat => None,
        BackendKind::TogetherChat => None,
        BackendKind::AnthropicMessages => None,
        BackendKind::Arcee => None,
        BackendKind::Auto => None,
    }
}

pub(super) fn default_base_url_for_backend_hint(backend: BackendKind) -> &'static str {
    match backend {
        BackendKind::DeepSeekChat => "https://api.deepseek.com",
        BackendKind::ChatGptCodexResponses => "https://chatgpt.com/backend-api",
        BackendKind::AnthropicMessages => "https://api.anthropic.com",
        BackendKind::TogetherChat => "https://api.together.ai/v1",
        BackendKind::Arcee => "https://api.arcee.ai",
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
        BackendKind::ChatGptCodexResponses | BackendKind::Arcee => Ok(String::new()),
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

    if host.contains("arcee.ai") {
        return Ok(BackendKind::Arcee);
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
        "could not infer backend from '{}'; pass --backend deepseek-chat, --backend fireworks-chat, --backend together-chat, --backend openai-responses, --backend chatgpt-codex-responses, --backend anthropic-messages, or --backend arcee",
        base_url
    ))
}
