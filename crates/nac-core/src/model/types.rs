use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq)]
pub struct EffectiveModelSettings {
    pub(crate) backend: BackendKind,
    pub(crate) model: String,
    pub(crate) base_url: String,
    pub(crate) reasoning_effort: Option<ReasoningEffort>,
    pub(crate) api_key_env: Option<String>,
    pub(crate) extra_headers: std::collections::BTreeMap<String, String>,
    /// Catalog metadata resolved at construction. Adapters ignore it until
    /// later stages (S3 cost, S4 effort maps, S6 dispatch).
    pub(crate) resolved: catalog::ModelMetadata,
}

pub const ARCEE_AUTH_CANONICAL_BASE_URL: &str = "https://api.arcee.ai/api/v1";
pub const CHATGPT_CODEX_CANONICAL_BASE_URL: &str = "https://chatgpt.com/backend-api";

/// Return the fixed inference URL supplied when a managed backend has no
/// explicit or configured base URL. API-key backends intentionally have no
/// corresponding default.
pub fn managed_backend_base_url(backend: BackendKind) -> Option<&'static str> {
    match backend {
        BackendKind::ArceeAuth => Some(ARCEE_AUTH_CANONICAL_BASE_URL),
        BackendKind::ChatGptCodexResponses => Some(CHATGPT_CODEX_CANONICAL_BASE_URL),
        _ => None,
    }
}

/// Materialize and validate the base URL after the effective backend has been
/// selected. A caller-supplied value is always authoritative (and is never
/// replaced when invalid); only genuine absence receives a managed default.
pub fn resolve_model_base_url(backend: BackendKind, base_url: Option<String>) -> Result<String> {
    let base_url = base_url.or_else(|| managed_backend_base_url(backend).map(str::to_string));
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
    Ok(base_url)
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
        let base_url = resolve_model_base_url(backend, base_url)?;
        validate_model_reasoning_effort(backend, &model, reasoning_effort)?;
        let resolved = catalog::resolve(backend, &model);

        Ok(Self {
            backend,
            model,
            base_url,
            reasoning_effort,
            api_key_env,
            extra_headers,
            resolved,
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

/// Per-response cost in micro-USD (1e-6 USD), stored as u64 so `TokenUsage`
/// stays `Eq`. All-zero = unknown pricing (pi's zero-cost fallback). `total`
/// is the saturating sum of the four buckets, stored so consumers read it
/// directly. Missing fields deserialize as zero so partial records stay
/// loadable.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenCostMicros {
    #[serde(default)]
    pub input: u64,
    #[serde(default)]
    pub output: u64,
    #[serde(default)]
    pub cache_read: u64,
    #[serde(default)]
    pub cache_write: u64,
    #[serde(default)]
    pub total: u64,
}

impl TokenCostMicros {
    pub(crate) fn add_saturating(&mut self, other: &Self) {
        self.input = self.input.saturating_add(other.input);
        self.output = self.output.saturating_add(other.output);
        self.cache_read = self.cache_read.saturating_add(other.cache_read);
        self.cache_write = self.cache_write.saturating_add(other.cache_write);
        self.total = self.total.saturating_add(other.total);
    }
}

/// Pure per-response cost: `cost_micros = tokens × rate_per_mtok` exactly
/// (rates are $/1M tokens, and $ × 1e6 = tokens × rate). Rounding happens
/// once, at the f64→u64 conversion, half away from zero (== half-up for
/// these non-negative values); results saturate at u64::MAX. Non-finite or
/// negative rates bill as zero: unknown pricing never errors.
///
/// `cache_write_1h_rate` replaces the standard cache-write rate for
/// Anthropic 1-hour-TTL writes; `None` bills writes at `rates.cache_write`.
pub(crate) fn calculate_cost(
    rates: &catalog::ModelCostRates,
    cache_write_1h_rate: Option<f64>,
    usage: &TokenUsage,
) -> TokenCostMicros {
    fn micros(tokens: u64, rate_per_mtok: f64) -> u64 {
        if tokens == 0 || !rate_per_mtok.is_finite() || rate_per_mtok <= 0.0 {
            return 0;
        }
        // f64→u64 `as` saturates at u64::MAX and maps NaN to 0.
        (tokens as f64 * rate_per_mtok).round() as u64
    }
    let input = micros(usage.input_tokens, rates.input);
    let output = micros(usage.output_tokens, rates.output);
    let cache_read = micros(usage.cache_read_tokens, rates.cache_read);
    let cache_write = micros(
        usage.cache_write_tokens,
        cache_write_1h_rate.unwrap_or(rates.cache_write),
    );
    let total = input
        .saturating_add(output)
        .saturating_add(cache_read)
        .saturating_add(cache_write);
    TokenCostMicros {
        input,
        output,
        cache_read,
        cache_write,
        total,
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    #[serde(default)]
    pub reasoning_tokens: u64,
    /// Current context window size from the last ordinary orchestrator call.
    #[serde(rename = "total_tokens")]
    pub orchestrator_context_tokens: u64,
    /// Per-response cost computed from catalog rates when the response was
    /// parsed; zero when pricing is unknown. Serde-additive: rows persisted
    /// before S3 deserialize with zero cost.
    #[serde(default)]
    pub cost: TokenCostMicros,
}

impl TokenUsage {
    /// Add billable/cumulative fields without changing the current-context gauge.
    pub(crate) fn add_cost_saturating(&mut self, other: &Self) {
        self.input_tokens = self.input_tokens.saturating_add(other.input_tokens);
        self.output_tokens = self.output_tokens.saturating_add(other.output_tokens);
        self.cache_read_tokens = self
            .cache_read_tokens
            .saturating_add(other.cache_read_tokens);
        self.cache_write_tokens = self
            .cache_write_tokens
            .saturating_add(other.cache_write_tokens);
        self.reasoning_tokens = self.reasoning_tokens.saturating_add(other.reasoning_tokens);
        self.cost.add_saturating(&other.cost);
    }

    pub(crate) fn replace_context(&mut self, context_tokens: u64) {
        self.orchestrator_context_tokens = context_tokens;
    }

    /// Accept a provider context total only when all represented usage fields
    /// fit in the supported range and the total covers their full sum. Zero
    /// means unavailable.
    pub(crate) fn valid_provider_context(&self) -> Option<u64> {
        if self.orchestrator_context_tokens == 0
            || self.orchestrator_context_tokens > crate::MAX_SUPPORTED_TOKEN_COUNT
        {
            return None;
        }
        let represented = self
            .input_tokens
            .checked_add(self.cache_read_tokens)?
            .checked_add(self.cache_write_tokens)?
            .checked_add(self.output_tokens)?;
        (self.orchestrator_context_tokens >= represented)
            .then_some(self.orchestrator_context_tokens)
    }
}

impl std::ops::AddAssign for TokenUsage {
    fn add_assign(&mut self, other: Self) {
        self.add_cost_saturating(&other);
        self.orchestrator_context_tokens = self
            .orchestrator_context_tokens
            .saturating_add(other.orchestrator_context_tokens);
    }
}

#[derive(Debug, Clone)]
pub struct ModelTurnResponse {
    pub assistant: AssistantTurn,
    pub finish_reason: Option<String>,
    pub usage: Option<TokenUsage>,
}
