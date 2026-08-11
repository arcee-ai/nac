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
//! the providers' own documentation (the codex entries reference the
//! overlapping models.dev openai baseline values). Every entry's thinking
//! map still matches the provider's matrix behavior exactly — codex
//! all-levels verbatim, arcee rejects every explicit effort.

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

/// deepseek-chat: none/low/high/xhigh; xhigh is the wire-level tier `max`.
fn deepseek_levels() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Xhigh, "max"),
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
/// deliberately omitted). Limits and pricing reference the overlapping
/// models.dev openai baseline entries; ChatGPT-sign-in usage is
/// subscription-billed, so the rates are the API-equivalent prices. Effort
/// maps stay all-levels verbatim per the matrix.
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
            1_050_000,
            128_000,
            rates(5.0, 30.0, 0.5, 6.25),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.6-terra",
            "GPT-5.6 Terra",
            1_050_000,
            128_000,
            rates(2.0, 12.0, 0.2, 2.5),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.6-luna",
            "GPT-5.6 Luna",
            1_050_000,
            128_000,
            rates(0.2, 1.2, 0.02, 0.25),
            all_levels_with_max(),
        ),
        model(
            "gpt-5.6",
            "GPT-5.6",
            1_050_000,
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
/// Effort maps stay empty per the matrix: Arcee accepts no explicit effort
/// levels. `reasoning` marks the thinking variant's reasoning_content
/// output; it accepts no effort knob.
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
                completions_compat(None, "reasoning_content", Some(0.0)),
            )
        };
    vec![
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
    ]
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
            // Arcee accepts no explicit effort levels; its completions
            // responses still carry reasoning text in `reasoning_content`.
            entry(
                backend,
                PROVIDER_DEFAULT_MODEL_ID,
                false,
                ThinkingLevelMap::default(),
                completions_compat(None, "reasoning_content", Some(0.0)),
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
