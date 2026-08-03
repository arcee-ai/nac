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
/// `ModelClient::send_turn` dispatches on this axis.
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

/// Per-api quirk data; drives the consolidated completions builder/parser in
/// place of per-backend code branches.
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
    /// `None`), as opposed to merely absent. Currently consumed by tests;
    /// it documents the user-override `null` wire-value case, which neither
    /// the seed catalog nor the generator ever produces.
    #[allow(dead_code)] // test-consumed; the /models listing reads supported_efforts
    pub fn is_explicitly_unsupported(&self, effort: ReasoningEffort) -> bool {
        matches!(self.0.get(&effort), Some(None))
    }

    /// The supported effort levels (keys with a wire value), in canonical
    /// effort order. The `/models` listing derives its per-model effort
    /// options from this; the wire values stay internal.
    pub fn supported_efforts(&self) -> Vec<ReasoningEffort> {
        self.0
            .iter()
            .filter(|(_, wire)| wire.is_some())
            .map(|(effort, _)| *effort)
            .collect()
    }
}

/// Cost rates in USD per 1M tokens. All-zero = unknown (pi's zero-cost
/// fallback); `calculate_cost` bills unknown pricing as zero. Missing fields
/// deserialize as zero so partial catalog records stay loadable.
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

/// Where the metadata for a resolved model came from. Served by the
/// `/models` listing (snake_case wire names) — the frontend badges
/// user-overridden and unrecognized (provider-default) models from it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
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
    /// Human-facing name from models.dev. Served by the `/models` listing
    /// (`api_listing`); the frontend picker renders it in place of the id.
    pub display_name: Option<String>,
    pub context_window: u64,
    pub max_tokens: u64,
    pub cost: ModelCostRates,
    /// Anthropic 1-hour-TTL cache-write rate; defaults to 2x input at cost
    /// computation time (S3).
    pub cache_write_1h: Option<f64>,
    /// Whether the model reasons at all (models.dev `reasoning` flag).
    /// Served by the `/models` listing (`api_listing`); the frontend hides
    /// the effort picker for non-reasoning models. Effort validation reads
    /// `thinking_level_map` instead.
    pub reasoning: bool,
    pub thinking_level_map: ThinkingLevelMap,
    pub compat: Compat,
    /// Which catalog layer produced this metadata. Served by the `/models`
    /// listing (`api_listing`); the frontend badges non-baseline sources.
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
/// How a provider authenticates, as served by `GET /models`: auth
/// *requirements* (drives picker field visibility and hints), not status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderAuth {
    /// API key read from the environment variable named by `api_key_env`.
    ApiKeyEnv,
    /// Managed Arcee device-flow auth (`arcee_auth.json`).
    ManagedArcee,
    /// Stored ChatGPT/Codex OAuth (`auth.json`).
    CodexOauth,
}

/// A provider `_default` entry's limits and effort support, as served by
/// `GET /models`: powers the frontend's unrecognized-model badge, estimated
/// context gauge and custom-model effort list without a second resolve call.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DefaultLimits {
    pub context_window: u64,
    pub max_tokens: u64,
    pub supported_efforts: Vec<ReasoningEffort>,
}

/// One real catalog entry as served by `GET /models` (never a
/// ProviderDefault/Fallback synthesis product).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelEntry {
    pub id: String,
    pub display_name: Option<String>,
    pub context_window: u64,
    pub max_tokens: u64,
    pub cost: ModelCostRates,
    pub reasoning: bool,
    pub supported_efforts: Vec<ReasoningEffort>,
    pub source: ModelSource,
}

/// One provider group in the `GET /models` listing.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProviderListing {
    pub id: BackendKind,
    pub auth: ProviderAuth,
    pub managed_base_url: Option<String>,
    pub default_limits: DefaultLimits,
    pub models: Vec<ModelEntry>,
}

/// The full catalog listing served by `GET /models`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelListing {
    /// Monotonic version of the process-global catalog, bumped on every
    /// reload (the initial load is version 1). Debugging/future-staleness
    /// surface only; v1 attaches no cache semantics.
    pub catalog_version: u64,
    pub providers: Vec<ProviderListing>,
}
