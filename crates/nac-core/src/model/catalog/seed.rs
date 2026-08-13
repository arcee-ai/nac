//! Hand-written seed catalog.
//!
//! The per-provider `_default` entries transcribe the pre-S4 validation
//! matrix into data; since S4, `backend.rs::validate_model_reasoning_effort`
//! resolves these maps (unknown models keep the conservative matrix
//! behavior). The five models.dev-backed providers keep conservative
//! fallback limits/cost on their seeds — real values arrive with the
//! generated models.dev baseline.
//!
//! arcee-auth/arcee-api and chatgpt-codex-responses are absent from
//! models.dev, so their known-model entries are maintained by hand here
//! (`codex_seed_models`/`arcee_seed_models`): limits and pricing come from
//! the providers' own documentation. The codex entries' context windows
//! reflect the Codex subscription endpoint's server-side cap of 272K
//! (confirmed via the live Codex models API at
//! chatgpt.com/backend-api/codex/models), which is ~3.9× smaller than the
//! standard OpenAI API's 1.05M for the same GPT-5.6 models; max output
//! tokens and pricing match the models.dev openai baseline. Every entry's
//! thinking map still matches the provider's matrix behavior exactly —
//! codex all-levels verbatim, arcee rejects every explicit effort except on
//! the seeded third-party models (whose maps come from
//! [`ARCEE_THIRD_PARTY_SEED_MODELS`]).

use super::{
    api_kind_for, Compat, CompletionsThinkingFormat, ModelCatalog, ModelCostRates, ModelMetadata,
    ModelSource, ProviderCatalog, ThinkingLevelMap, FALLBACK_MAX_TOKENS, PROVIDER_DEFAULT_MODEL_ID,
};
use crate::model::{BackendKind, ReasoningEffort};
use std::collections::BTreeMap;

fn levels(entries: &[(ReasoningEffort, &str)]) -> ThinkingLevelMap {
    ThinkingLevelMap(
        entries
            .iter()
            .map(|(effort, wire)| (*effort, Some((*wire).to_string())))
            .collect(),
    )
}

/// deepseek-chat: none/low/high/max — the V4 API's real effort levels
/// (official docs: medium→high and xhigh→high are compatibility aliases,
/// not offered as distinct tiers).
fn deepseek_levels() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Max, "max"),
    ])
}

/// fireworks-chat / together-chat: none through high, sent verbatim.
fn none_through_high_levels() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::Medium, "medium"),
        (ReasoningEffort::High, "high"),
    ])
}

/// openai-responses / chatgpt-codex-responses: every level, sent verbatim.
fn all_levels() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
        (ReasoningEffort::Minimal, "minimal"),
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::Medium, "medium"),
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Xhigh, "xhigh"),
    ])
}

/// GPT-5.6 models: all six levels plus `max` (GPT-5.6-only tier above
/// xhigh; models.dev confirms and OpenAI docs reserve it for the hardest
/// quality-first workloads).
fn all_levels_with_max() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
        (ReasoningEffort::Minimal, "minimal"),
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::Medium, "medium"),
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Xhigh, "xhigh"),
        (ReasoningEffort::Max, "max"),
    ])
}

/// Anthropic adaptive-with-max family (claude-opus-4-6): none through xhigh,
/// with xhigh at the wire-level tier `max`.
fn anthropic_adaptive_with_max_levels() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::Medium, "medium"),
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Xhigh, "max"),
    ])
}

/// Conservative Anthropic default: `none` (omission) is safe for every
/// family, including models whose adaptive thinking is always on.
fn anthropic_none_only_levels() -> ThinkingLevelMap {
    levels(&[(ReasoningEffort::None, "none")])
}

fn completions_compat(
    thinking_format: Option<CompletionsThinkingFormat>,
    reasoning_field: &str,
    temperature: Option<f64>,
) -> Compat {
    Compat {
        completions_thinking_format: thinking_format,
        completions_reasoning_field: Some(reasoning_field.to_string()),
        completions_temperature: temperature,
    }
}

fn entry(
    provider: BackendKind,
    id: &str,
    reasoning: bool,
    thinking_level_map: ThinkingLevelMap,
    compat: Compat,
) -> ModelMetadata {
    let mut entry =
        ModelMetadata::sparse(provider, api_kind_for(provider), id, ModelSource::Baseline);
    entry.reasoning = reasoning;
    entry.thinking_level_map = thinking_level_map;
    entry.compat = compat;
    entry
}

fn rates(input: f64, output: f64, cache_read: f64, cache_write: f64) -> ModelCostRates {
    ModelCostRates {
        input,
        output,
        cache_read,
        cache_write,
    }
}

/// A hand-maintained known-model entry for the providers models.dev does
/// not cover: documented display name, limits, and pricing over the shared
/// `entry` base.
fn seeded_model(
    provider: BackendKind,
    id: &str,
    display_name: &str,
    context_window: u64,
    max_tokens: u64,
    cost: ModelCostRates,
    reasoning: bool,
    thinking_level_map: ThinkingLevelMap,
    compat: Compat,
) -> ModelMetadata {
    let mut model = entry(provider, id, reasoning, thinking_level_map, compat);
    model.display_name = Some(display_name.to_string());
    model.context_window = context_window;
    model.max_tokens = max_tokens;
    model.cost = cost;
    model
}

/// chatgpt-codex-responses known models: OpenAI's documented Codex lineup
/// for ChatGPT sign-in (developers.openai.com/codex/models — Sol/Terra/Luna,
/// gpt-5.6, and the Pro-tier Spark preview; deprecated codex models are
/// deliberately omitted). Context windows reflect the Codex subscription
/// endpoint's server-side cap of 272K (confirmed via the live Codex models
/// API at chatgpt.com/backend-api/codex/models), not the standard OpenAI
/// API's 1.05M — the same GPT-5.6 models accept 1.05M through
/// api.openai.com but only 272K through the ChatGPT-sign-in transport.
/// Max output tokens and pricing reference the overlapping models.dev
/// openai baseline entries; ChatGPT-sign-in usage is subscription-billed,
/// so the rates are the API-equivalent prices. Effort maps stay all-levels
/// verbatim per the matrix.
fn codex_seed_models() -> Vec<ModelMetadata> {
    let provider = BackendKind::ChatGptCodexResponses;
    let model = |id: &str,
                 display_name: &str,
                 context_window: u64,
                 max_tokens: u64,
                 cost: ModelCostRates,
                 thinking_level_map: ThinkingLevelMap| {
        seeded_model(
            provider,
            id,
            display_name,
            context_window,
            max_tokens,
            cost,
            true,
            thinking_level_map,
            Compat::default(),
        )
    };
    vec![
        model(
            "gpt-5.6-sol",
            "GPT-5.6 Sol",
            272_000,
            128_000,
            rates(5.0, 30.0, 0.5, 6.25),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.6-terra",
            "GPT-5.6 Terra",
            272_000,
            128_000,
            rates(2.0, 12.0, 0.2, 2.5),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.6-luna",
            "GPT-5.6 Luna",
            272_000,
            128_000,
            rates(0.2, 1.2, 0.02, 0.25),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.6",
            "GPT-5.6",
            272_000,
            128_000,
            rates(5.0, 30.0, 0.5, 6.25),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.3-codex-spark",
            "GPT-5.3 Codex Spark",
            128_000,
            32_000,
            rates(1.75, 14.0, 0.175, 0.0),
            all_levels(),
        ),
    ]
}

/// Effort tiers for the seeded arcee third-party models. The arcee API's
/// `supported_reasoning_efforts` is always null, so the API-derived map is
/// always empty; these tiers are what the arcee API actually honors for each
/// model family (confirmed via API testing, PR #128): deepseek/glm take
/// none/high/max, kimi low/high/max (thinking is always enabled), minimax
/// none/max (a thinking toggle, not graduated efforts).
const THIRD_PARTY_NONE_HIGH_MAX_LEVELS: &[(ReasoningEffort, &str)] = &[
    (ReasoningEffort::None, "none"),
    (ReasoningEffort::High, "high"),
    (ReasoningEffort::Max, "max"),
];
const THIRD_PARTY_LOW_HIGH_MAX_LEVELS: &[(ReasoningEffort, &str)] = &[
    (ReasoningEffort::Low, "low"),
    (ReasoningEffort::High, "high"),
    (ReasoningEffort::Max, "max"),
];
const THIRD_PARTY_NONE_MAX_LEVELS: &[(ReasoningEffort, &str)] = &[
    (ReasoningEffort::None, "none"),
    (ReasoningEffort::Max, "max"),
];

/// One seeded arcee third-party model.
pub(super) struct ThirdPartySeedModel {
    /// Model id exactly as the arcee API lists it.
    pub id: &'static str,
    pub display_name: &'static str,
    pub context_window: u64,
    pub max_tokens: u64,
    /// Effort levels the arcee API honors for this model (see the tier
    /// consts above).
    pub efforts: &'static [(ReasoningEffort, &'static str)],
}

/// The seeded arcee third-party lineup. This table is the single source of
/// truth for the class: the seed catalog registers these entries, the arcee
/// overlay derives effort maps and fallback limits from it, and the catalog
/// tests read it (including the pre-S4 validation-matrix exemption).
///
/// To release a new model or drop an old one, add or remove a row here —
/// that one edit is complete. Context windows are the arcee API's advertised
/// values (`/v1/models` `context_length`, verified 2026-08-13); the API
/// leaves `max_output_length` null for these models, so max output follows
/// the underlying models' published values, capped at 256k. Pricing is
/// unpublished in the seed (zero = unknown) and arrives with the live
/// overlay.
pub(super) const ARCEE_THIRD_PARTY_SEED_MODELS: &[ThirdPartySeedModel] = &[
    ThirdPartySeedModel {
        id: "deepseek/deepseek-v4-flash-latest",
        display_name: "DeepSeek-V4-Flash",
        context_window: 1_048_576,
        max_tokens: 262_144,
        efforts: THIRD_PARTY_NONE_HIGH_MAX_LEVELS,
    },
    ThirdPartySeedModel {
        id: "deepseek-ai/deepseek-v4-pro",
        display_name: "DeepSeek-V4-Pro",
        context_window: 512_000,
        max_tokens: 262_144,
        efforts: THIRD_PARTY_NONE_HIGH_MAX_LEVELS,
    },
    ThirdPartySeedModel {
        id: "zai-org/glm-5.2",
        display_name: "GLM-5.2",
        context_window: 262_144,
        max_tokens: 164_000,
        efforts: THIRD_PARTY_NONE_HIGH_MAX_LEVELS,
    },
    ThirdPartySeedModel {
        id: "moonshotai/kimi-k3",
        display_name: "Kimi-K3",
        context_window: 1_048_576,
        max_tokens: 131_072,
        efforts: THIRD_PARTY_LOW_HIGH_MAX_LEVELS,
    },
    ThirdPartySeedModel {
        id: "minimaxai/minimax-m3",
        display_name: "MiniMax-M3",
        context_window: 512_000,
        max_tokens: 250_000,
        efforts: THIRD_PARTY_NONE_MAX_LEVELS,
    },
];

/// Effort map for a known arcee third-party model, looked up from
/// [`ARCEE_THIRD_PARTY_SEED_MODELS`]. Returns `None` for unknown models and
/// trinity-large-thinking (arcee's own model, which rejects all
/// `reasoning_effort` values).
pub(super) fn third_party_effort_map(model_id: &str) -> Option<ThinkingLevelMap> {
    ARCEE_THIRD_PARTY_SEED_MODELS
        .iter()
        .find(|model| model.id == model_id)
        .map(|model| levels(model.efforts))
}

/// Seeded (context window, max output) for a known arcee third-party model.
/// The arcee overlay falls back to these when the API record omits the
/// fields, so pre- and post-overlay limits agree for the same model.
pub(super) fn third_party_seed_limits(model_id: &str) -> Option<(u64, u64)> {
    ARCEE_THIRD_PARTY_SEED_MODELS
        .iter()
        .find(|model| model.id == model_id)
        .map(|model| (model.context_window, model.max_tokens))
}

/// Arcee known models (shared by arcee-auth and arcee-api): the Trinity
/// lineup from Arcee's own docs (docs.arcee.ai/get-started/models-overview
/// and /pricing). `trinity-large-thinking` is the documented hosted API id
/// (also the README's example); the other two ids follow the same
/// lowercase-hyphen convention from the pricing page's model names. Context
/// windows use Arcee's stated hosted value (128k; the Large models support
/// more when self-hosted — patch via models.json where a deployment allows
/// it). Max output is undocumented except trinity-large-thinking's 80k
/// (Vercel AI Gateway's arcee-ai integration); the others keep the
/// conservative fallback. Cache pricing is undocumented (zero = unknown).
/// Effort maps stay empty for the Trinity models: trinity-large-thinking
/// always reasons (no effort knob), and the non-thinking variants accept no
/// reasoning control. The Arcee third-party models (deepseek-v4-pro, glm-5.2,
/// etc.) are seeded too — from [`ARCEE_THIRD_PARTY_SEED_MODELS`], which the
/// arcee overlay also reads — so the frontend's default pick resolves real
/// limits even before the live overlay loads; without a seed entry they fall
/// through to the provider `_default` clone and requests go out with the 16k
/// fallback max_tokens (issue #124). Their limits follow the underlying
/// models' published values (max output capped at 256k); third-party pricing
/// is unpublished (zero = unknown). The overlay still upgrades every field
/// once live data arrives. `reasoning` marks the thinking variant's
/// reasoning_content output.
fn arcee_seed_models(provider: BackendKind) -> Vec<ModelMetadata> {
    let model =
        |id: &str, display_name: &str, max_tokens: u64, cost: ModelCostRates, reasoning: bool| {
            seeded_model(
                provider,
                id,
                display_name,
                128_000,
                max_tokens,
                cost,
                reasoning,
                ThinkingLevelMap::default(),
                completions_compat(
                    Some(CompletionsThinkingFormat::Arcee),
                    "reasoning_content",
                    Some(0.0),
                ),
            )
        };
    let third_party = |seed: &ThirdPartySeedModel| {
        seeded_model(
            provider,
            seed.id,
            seed.display_name,
            seed.context_window,
            seed.max_tokens,
            rates(0.0, 0.0, 0.0, 0.0),
            true,
            levels(seed.efforts),
            completions_compat(
                Some(CompletionsThinkingFormat::Arcee),
                "reasoning_content",
                Some(0.0),
            ),
        )
    };
    let mut models = vec![
        model(
            "trinity-large-thinking",
            "Trinity-Large-Thinking",
            80_000,
            rates(0.25, 0.80, 0.0, 0.0),
            true,
        ),
        model(
            "trinity-mini",
            "Trinity-Mini",
            FALLBACK_MAX_TOKENS,
            rates(0.045, 0.15, 0.0, 0.0),
            false,
        ),
        model(
            "trinity-large-preview",
            "Trinity-Large-Preview",
            FALLBACK_MAX_TOKENS,
            rates(0.45, 0.15, 0.0, 0.0),
            false,
        ),
    ];
    models.extend(ARCEE_THIRD_PARTY_SEED_MODELS.iter().map(third_party));
    models
}

pub(super) fn seed_catalog() -> ModelCatalog {
    let mut providers: BTreeMap<BackendKind, ProviderCatalog> = BTreeMap::new();
    let mut register = |default: ModelMetadata,
                        known: &[ModelMetadata],
                        credential_env_var: Option<&str>,
                        default_base_url: Option<&str>| {
        let models = known
            .iter()
            .map(|metadata| (metadata.id.clone(), metadata.clone()))
            .collect();
        providers.insert(
            default.provider,
            ProviderCatalog {
                default,
                models,
                credential_env_var: credential_env_var.map(str::to_string),
                default_base_url: default_base_url.map(str::to_string),
            },
        );
    };

    register(
        entry(
            BackendKind::DeepSeekChat,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            deepseek_levels(),
            // DeepSeek V4 accepts temperature (confirmed via API testing;
            // the old "rejects temperature on reasoning models" note was
            // specific to the deprecated R1 reasoner model).
            completions_compat(
                Some(CompletionsThinkingFormat::Deepseek),
                "reasoning_content",
                Some(0.0),
            ),
        ),
        &[],
        // Conventional credential var owned by the generated baseline.
        None,
        // Endpoint default owned by the generated baseline.
        None,
    );
    register(
        entry(
            BackendKind::FireworksChat,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            none_through_high_levels(),
            completions_compat(
                Some(CompletionsThinkingFormat::Fireworks),
                "reasoning_content",
                Some(0.0),
            ),
        ),
        &[],
        None,
        // Endpoint default owned by the generated baseline.
        None,
    );
    register(
        entry(
            BackendKind::TogetherChat,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            none_through_high_levels(),
            // Together returns reasoning text in the `reasoning` field.
            completions_compat(
                Some(CompletionsThinkingFormat::Together),
                "reasoning",
                Some(0.0),
            ),
        ),
        &[],
        None,
        // Endpoint default owned by the generated baseline.
        None,
    );
    register(
        entry(
            BackendKind::OpenAiResponses,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            all_levels(),
            Compat::default(),
        ),
        &[],
        None,
        // Endpoint default owned by the generated baseline.
        None,
    );
    register(
        entry(
            BackendKind::ChatGptCodexResponses,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            all_levels(),
            Compat::default(),
        ),
        &codex_seed_models(),
        // Managed provider: no conventional env var; the auth hint is the
        // login command.
        None,
        // Managed provider: the canonical URL stays code-side.
        None,
    );
    register(
        // Unknown Anthropic models stay conservative (none-only), matching
        // the pre-S4 validation matrix.
        entry(
            BackendKind::AnthropicMessages,
            PROVIDER_DEFAULT_MODEL_ID,
            false,
            anthropic_none_only_levels(),
            Compat::default(),
        ),
        &[
            entry(
                BackendKind::AnthropicMessages,
                "claude-opus-4-6",
                true,
                anthropic_adaptive_with_max_levels(),
                Compat::default(),
            ),
            entry(
                BackendKind::AnthropicMessages,
                "claude-sonnet-4-6",
                true,
                none_through_high_levels(),
                Compat::default(),
            ),
        ],
        None,
        // Endpoint default owned by the generated baseline.
        None,
    );
    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        register(
            // Arcee third-party models accept bare `reasoning_effort`; the
            // Arcee thinking format sends it without wrapper objects. The
            // seed models (trinity-*) keep an empty thinking_level_map, so
            // validation rejects every explicit effort and the format is
            // never reached for them. Responses carry reasoning text in
            // `reasoning_content`.
            entry(
                backend,
                PROVIDER_DEFAULT_MODEL_ID,
                false,
                ThinkingLevelMap::default(),
                completions_compat(
                    Some(CompletionsThinkingFormat::Arcee),
                    "reasoning_content",
                    Some(0.0),
                ),
            ),
            &arcee_seed_models(backend),
            // arcee-api's conventional variable (the README's provider-named
            // list); arcee-auth is managed and carries no name.
            (backend == BackendKind::ArceeApi).then_some("ARCEE_API_KEY"),
            // arcee-api's documented endpoint (docs.arcee.ai; not a
            // models.dev provider, so the seed hand-maintains it). arcee-auth
            // keeps its code-side canonical URL.
            (backend == BackendKind::ArceeApi).then_some("https://api.arcee.ai/api/v1"),
        );
    }

    ModelCatalog { providers }
}
