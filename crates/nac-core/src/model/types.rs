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

#[derive(Debug, Clone, Default)]
pub struct ClientOverrides {
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub backend: Option<BackendKind>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub api_key_env: Option<String>,
    pub extra_headers: std::collections::BTreeMap<String, String>,
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
