use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendKind {
    #[serde(rename = "deepseek-chat")]
    DeepSeekChat,
    FireworksChat,
    TogetherChat,
    #[serde(rename = "openai-responses")]
    OpenAiResponses,
    #[serde(rename = "chatgpt-codex-responses")]
    ChatGptCodexResponses,
    #[serde(rename = "anthropic-messages")]
    AnthropicMessages,
    ArceeAuth,
    ArceeApi,
}

impl BackendKind {
    pub const SUPPORTED: &'static str = "deepseek-chat, fireworks-chat, together-chat, openai-responses, chatgpt-codex-responses, anthropic-messages, arcee-auth, arcee-api";

    pub fn as_str(self) -> &'static str {
        match self {
            Self::DeepSeekChat => "deepseek-chat",
            Self::FireworksChat => "fireworks-chat",
            Self::TogetherChat => "together-chat",
            Self::OpenAiResponses => "openai-responses",
            Self::ChatGptCodexResponses => "chatgpt-codex-responses",
            Self::AnthropicMessages => "anthropic-messages",
            Self::ArceeAuth => "arcee-auth",
            Self::ArceeApi => "arcee-api",
        }
    }

    pub fn is_arcee(self) -> bool {
        matches!(self, Self::ArceeAuth | Self::ArceeApi)
    }
}

impl std::fmt::Display for BackendKind {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for BackendKind {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "deepseek-chat" => Ok(Self::DeepSeekChat),
            "fireworks-chat" => Ok(Self::FireworksChat),
            "together-chat" => Ok(Self::TogetherChat),
            "openai-responses" => Ok(Self::OpenAiResponses),
            "chatgpt-codex-responses" => Ok(Self::ChatGptCodexResponses),
            "anthropic-messages" => Ok(Self::AnthropicMessages),
            "arcee-auth" => Ok(Self::ArceeAuth),
            "arcee-api" => Ok(Self::ArceeApi),
            "arcee" => Err(format!(
                "unsupported backend 'arcee'; settings repair required: select 'arcee-auth' for managed arcee_auth.json credentials or 'arcee-api' for API-key credentials"
            )),
            "auto" => Err(format!(
                "unsupported backend 'auto'; settings repair required: select an explicit backend ({})",
                Self::SUPPORTED
            )),
            other => Err(format!(
                "unsupported backend '{other}'; select one of: {}",
                Self::SUPPORTED
            )),
        }
    }
}

impl<'de> Deserialize<'de> for BackendKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl ReasoningEffort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EffectiveModelSettings {
    pub(crate) backend: BackendKind,
    pub(crate) model: String,
    pub(crate) base_url: String,
    pub(crate) reasoning_effort: Option<ReasoningEffort>,
    pub(crate) api_key_env: Option<String>,
    pub(crate) extra_headers: std::collections::BTreeMap<String, String>,
}

impl EffectiveModelSettings {
    pub fn from_optional(
        backend: Option<BackendKind>,
        model: Option<String>,
        base_url: Option<String>,
        reasoning_effort: Option<ReasoningEffort>,
        api_key_env: Option<String>,
        extra_headers: std::collections::BTreeMap<String, String>,
    ) -> Result<Self> {
        let backend = backend.ok_or_else(|| {
            model_configuration_error(
                "invalid model configuration: required setting 'backend' is missing; set it in config.toml or the session settings",
            )
        })?;
        let model = required_nonblank_setting(model, "model")?;
        let base_url = required_nonblank_setting(base_url, "base_url")?;
        let parsed = Url::parse(&base_url).map_err(|error| {
            model_configuration_error(format!(
                "invalid model configuration: base_url '{}' is not a valid absolute URL: {}",
                base_url, error
            ))
        })?;
        if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
            return Err(model_configuration_error(format!(
                "invalid model configuration: base_url '{}' must be an absolute http(s) URL with a host",
                base_url
            )));
        }
        validate_model_reasoning_effort(backend, &model, reasoning_effort)?;

        Ok(Self {
            backend,
            model,
            base_url,
            reasoning_effort,
            api_key_env,
            extra_headers,
        })
    }

    pub fn new(
        backend: BackendKind,
        model: String,
        base_url: String,
        reasoning_effort: Option<ReasoningEffort>,
        api_key_env: Option<String>,
        extra_headers: std::collections::BTreeMap<String, String>,
    ) -> Result<Self> {
        Self::from_optional(
            Some(backend),
            Some(model),
            Some(base_url),
            reasoning_effort,
            api_key_env,
            extra_headers,
        )
    }
}

fn required_nonblank_setting(value: Option<String>, name: &str) -> Result<String> {
    let value = value.ok_or_else(|| {
        model_configuration_error(format!(
            "invalid model configuration: required setting '{}' is missing; set it in config.toml or the session settings",
            name
        ))
    })?;
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(model_configuration_error(format!(
            "invalid model configuration: required setting '{}' must not be blank",
            name
        )));
    }
    Ok(normalized.to_string())
}

#[derive(Debug, Clone)]
pub struct AssistantTurn {
    pub content: Option<String>,
    pub reasoning_text: Option<String>,
    pub reasoning_details: Option<Value>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub reasoning_tokens: u64,
    /// Current context window size (last model call's total token count).
    /// Despite the `AddAssign` impl summing this field, the agent loop
    /// overwrites it with the most recent call's value so it reflects the
    /// live context length rather than a cumulative total.
    #[serde(rename = "total_tokens")]
    pub orchestrator_context_tokens: u64,
}

impl std::ops::AddAssign for TokenUsage {
    fn add_assign(&mut self, other: Self) {
        self.input_tokens += other.input_tokens;
        self.output_tokens += other.output_tokens;
        self.cache_read_tokens += other.cache_read_tokens;
        self.cache_write_tokens += other.cache_write_tokens;
        self.reasoning_tokens += other.reasoning_tokens;
        self.orchestrator_context_tokens += other.orchestrator_context_tokens;
    }
}

#[derive(Debug, Clone)]
pub struct ModelTurnResponse {
    pub assistant: AssistantTurn,
    pub finish_reason: Option<String>,
    pub usage: Option<TokenUsage>,
}
