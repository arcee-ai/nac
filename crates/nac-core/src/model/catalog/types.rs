//! Catalog record types: the central `ModelMetadata` and its parts.

use crate::model::{BackendKind, ReasoningEffort};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Context-window fallback for models with no catalog data (pi's 128k default).
pub const FALLBACK_CONTEXT_WINDOW: u64 = 128_000;
/// Max-output fallback for models with no catalog data (pi's 16k default).
pub const FALLBACK_MAX_TOKENS: u64 = 16_384;

/// Wire protocol spoken by a model endpoint.
///
/// `BackendKind` remains the config-facing provider id (auth, catalog and
/// base-url policy); `ApiKind` names the request/response adapter family.
/// Stage S6 switches `ModelClient::send_turn` dispatch from backend to this
/// axis; in S0 it is data only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ApiKind {
    OpenAiCompletions,
    OpenAiResponses,
    ChatGptCodexResponses,
    AnthropicMessages,
}

/// Thinking/reasoning control dialect for OpenAI-completions-family providers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompletionsThinkingFormat {
    /// `thinking: {"type": "enabled"|"disabled"}` plus `reasoning_effort`.
    Deepseek,
    /// `reasoning_effort` plus `reasoning_history`.
    Fireworks,
    /// `reasoning: {"enabled": bool}` plus `reasoning_effort` and
    /// `chat_template_kwargs.clear_thinking`.
    Together,
}

/// Per-api quirk data; replaces per-backend code branches as the adapters are
/// consolidated (S6).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Compat {
    /// Completions-family thinking control dialect, when the provider accepts
    /// explicit effort levels.
    pub completions_thinking_format: Option<CompletionsThinkingFormat>,
    /// Response field carrying reasoning text (`reasoning_content` |
    /// `reasoning`); used for both parse and replay.
    pub completions_reasoning_field: Option<String>,
    /// Explicit `temperature` to send on completions-family requests; `None`
    /// omits the field (DeepSeek).
    pub completions_temperature: Option<f64>,
}

/// Effort levels a model accepts, mapped to provider wire values.
///
/// Key present + `Some(wire)` = supported, send `wire`; present + `None` =
/// explicitly unsupported (documents always-thinking models); absent =
/// unsupported. The wire emission shape for `ReasoningEffort::None` stays
/// per-adapter (omission vs explicit disable); its map entry is a support
/// marker only.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThinkingLevelMap(pub BTreeMap<ReasoningEffort, Option<String>>);

impl ThinkingLevelMap {
    /// Wire value for a supported effort; `None` when unsupported or absent.
    pub fn wire_value(&self, effort: ReasoningEffort) -> Option<&str> {
        self.0.get(&effort).and_then(Option::as_deref)
    }

    /// Whether the model accepts the effort level.
    pub fn is_supported(&self, effort: ReasoningEffort) -> bool {
        self.wire_value(effort).is_some()
    }

    /// Whether the map explicitly marks the effort unsupported (present +
    /// `None`), as opposed to merely absent.
    pub fn is_explicitly_unsupported(&self, effort: ReasoningEffort) -> bool {
        matches!(self.0.get(&effort), Some(None))
    }
}

/// Cost rates in USD per 1M tokens. All-zero = unknown (pi's zero-cost
/// fallback); cost computation arrives in S3. Missing fields deserialize as
/// zero so partial catalog records stay loadable.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct ModelCostRates {
    #[serde(default)]
    pub input: f64,
    #[serde(default)]
    pub output: f64,
    #[serde(default)]
    pub cache_read: f64,
    #[serde(default)]
    pub cache_write: f64,
}

/// Where the metadata for a resolved model came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModelSource {
    /// Checked-in baseline catalog (S0 seed; generated models.dev data in S1).
    Baseline,
    /// Refreshed remote overlay under `$NAC_HOME/model-catalog/` (S2).
    Overlay,
    /// User overrides from `$NAC_HOME/models.json` (S2).
    UserOverride,
    /// Provider `_default` entry cloned for an unknown model id (pi's
    /// buildFallbackModel pattern).
    ProviderDefault,
    /// Last-resort synthesized metadata; carries the 128k/16k/zero-cost
    /// defaults. Unreachable while every provider ships a `_default` entry.
    Fallback,
}

/// Central model metadata record resolved from the catalog.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelMetadata {
    pub id: String,
    pub provider: BackendKind,
    pub api: ApiKind,
    pub display_name: Option<String>,
    pub context_window: u64,
    pub max_tokens: u64,
    pub cost: ModelCostRates,
    /// Anthropic 1-hour-TTL cache-write rate; defaults to 2x input at cost
    /// computation time (S3).
    pub cache_write_1h: Option<f64>,
    pub reasoning: bool,
    pub thinking_level_map: ThinkingLevelMap,
    pub compat: Compat,
    pub source: ModelSource,
}

impl ModelMetadata {
    /// 1-hour-TTL cache-write rate ($/1M tokens); defaults to 2x the input
    /// rate (pi's rule) when the catalog carries no explicit value.
    pub fn cache_write_1h_rate(&self) -> f64 {
        self.cache_write_1h.unwrap_or(2.0 * self.cost.input)
    }

    /// Conservative metadata with the fallback limits (128k context, 16k max
    /// output), zero (unknown) cost and no reasoning controls.
    pub(crate) fn sparse(
        provider: BackendKind,
        api: ApiKind,
        id: &str,
        source: ModelSource,
    ) -> Self {
        Self {
            id: id.to_string(),
            provider,
            api,
            display_name: None,
            context_window: FALLBACK_CONTEXT_WINDOW,
            max_tokens: FALLBACK_MAX_TOKENS,
            cost: ModelCostRates::default(),
            cache_write_1h: None,
            reasoning: false,
            thinking_level_map: ThinkingLevelMap::default(),
            compat: Compat::default(),
            source,
        }
    }
}
