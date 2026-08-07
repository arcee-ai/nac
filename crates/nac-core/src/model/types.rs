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

impl std::fmt::Display for ReasoningEffort {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for ReasoningEffort {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "none" => Ok(Self::None),
            "minimal" => Ok(Self::Minimal),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            "xhigh" => Ok(Self::Xhigh),
            other => Err(format!(
                "unsupported reasoning effort '{other}'; select one of: none, minimal, low, medium, high, xhigh"
            )),
        }
    }
}

/// Difficulty tier the orchestrator assigns to a thread dispatch in mixed
/// mode. Each tier routes to its own user-configured worker model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ThreadComplexity {
    Easy,
    Medium,
    Hard,
}

impl ThreadComplexity {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Easy => "easy",
            Self::Medium => "medium",
            Self::Hard => "hard",
        }
    }
}

impl std::fmt::Display for ThreadComplexity {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

impl std::str::FromStr for ThreadComplexity {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "easy" => Ok(Self::Easy),
            "medium" => Ok(Self::Medium),
            "hard" => Ok(Self::Hard),
            other => Err(format!(
                "unsupported complexity '{other}'; select one of: easy, medium, hard"
            )),
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
    /// Catalog metadata resolved at construction. Drives per-response cost,
    /// effort validation/translation, and api-axis dispatch.
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

/// Whether a host may carry model traffic over plaintext HTTP.
///
/// Loopback and private-network addresses keep local proxies and LAN gateways
/// usable. Every public host must use TLS, because the request carries the
/// resolved API key in an `Authorization` or `x-api-key` header.
pub(super) fn allows_plaintext_transport(host: &url::Host<&str>) -> bool {
    match host {
        url::Host::Domain(domain) => {
            let domain = domain.trim_end_matches('.').to_ascii_lowercase();
            domain == "localhost" || domain.ends_with(".localhost")
        }
        url::Host::Ipv4(address) => {
            address.is_loopback() || address.is_private() || address.is_link_local()
        }
        url::Host::Ipv6(address) => {
            let leading = address.segments()[0];
            // Unique local (fc00::/7) and link-local unicast (fe80::/10) have
            // no stable std predicates yet.
            address.is_loopback() || leading & 0xfe00 == 0xfc00 || leading & 0xffc0 == 0xfe80
        }
    }
}

/// Materialize and validate the base URL after the effective backend has been
/// selected. A caller-supplied value is always authoritative (and is never
/// replaced when invalid); genuine absence falls to the provider's catalog
/// endpoint default (the five models.dev providers and arcee-api), then the
/// managed canonical URL. Every current backend carries a default, so the
/// missing-setting error is unreachable in practice (kept for future
/// providers).
pub fn resolve_model_base_url(backend: BackendKind, base_url: Option<String>) -> Result<String> {
    let base_url = base_url
        .or_else(|| catalog::default_base_url(backend))
        .or_else(|| managed_backend_base_url(backend).map(str::to_string));
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
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(model_configuration_error(format!(
            "invalid model configuration: base_url '{}' must not embed userinfo",
            base_url
        )));
    }
    let host = parsed.host().expect("host presence checked above");
    if parsed.scheme() == "http" && !allows_plaintext_transport(&host) {
        return Err(model_configuration_error(format!(
            "invalid model configuration: base_url '{}' requires HTTPS; plaintext HTTP is accepted only for loopback and private-network hosts",
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
                "invalid model configuration: required setting 'backend' is missing; select a backend in the session settings or configure a model id the catalog knows",
            )
        })?;
        let model = required_nonblank_setting(model, "model")?;
        let base_url = resolve_model_base_url(backend, base_url)?;
        // Conventional-var auto-selection: an API-key backend with no
        // explicit selector adopts the provider's conventional credential
        // variable when it exists in the environment (the value is read at
        // client construction; the selected NAME is persisted into the
        // session). Managed backends never auto-select.
        let api_key_env = api_key_env.or_else(|| backend::auto_select_api_key_env(backend));
        let resolved = catalog::resolve(backend, &model);
        super::backend::validate_model_reasoning_effort_with_map(
            backend,
            &model,
            reasoning_effort,
            &resolved.thinking_level_map,
        )?;

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
    /// The wire field that carried `reasoning_text` on completions endpoints
    /// ("reasoning_content" for deepseek/fireworks/arcee, "reasoning" for
    /// together). Stamped onto the transcript message (S5) so replay uses
    /// the provider's own field name. `None` for details-based reasoning
    /// (Anthropic thinking blocks, OpenAI reasoning items).
    pub reasoning_field: Option<String>,
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

    /// Roll up per-response usage entries. Input/output/cache fields are summed
    /// across all recorded entries, while `orchestrator_context_tokens` is a
    /// context-window gauge and therefore takes the last recorded value instead.
    /// Returns `None` when nothing was ever recorded.
    pub fn aggregate(entries: &[Option<Self>]) -> Option<Self> {
        let recorded: Vec<&Self> = entries.iter().flatten().collect();
        let last = recorded.last()?;
        let mut cumulative = Self::default();
        for usage in &recorded {
            cumulative.add_cost_saturating(usage);
        }
        cumulative.orchestrator_context_tokens = last.orchestrator_context_tokens;
        Some(cumulative)
    }

    /// Tokens actually billed for the session: everything that was sent to and
    /// returned by the model, excluding the context-window gauge.
    pub fn billable_tokens(&self) -> u64 {
        self.input_tokens
            .saturating_add(self.output_tokens)
            .saturating_add(self.cache_read_tokens)
            .saturating_add(self.cache_write_tokens)
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
