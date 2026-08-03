//! Hand-written seed catalog.
//!
//! The per-provider `_default` entries transcribe the pre-S4 validation
//! matrix into data; since S4, `backend.rs::validate_model_reasoning_effort`
//! resolves these maps (unknown models keep the conservative matrix
//! behavior). Context windows, max tokens and cost rates deliberately keep
//! the conservative fallbacks — real values arrive with the generated
//! models.dev baseline in S1.

use super::{
    api_kind_for, Compat, CompletionsThinkingFormat, ModelCatalog, ModelMetadata, ModelSource,
    ProviderCatalog, ThinkingLevelMap, PROVIDER_DEFAULT_MODEL_ID,
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

/// deepseek-chat: none/high/xhigh; xhigh is the wire-level tier `max`.
fn deepseek_levels() -> ThinkingLevelMap {
    levels(&[
        (ReasoningEffort::None, "none"),
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
    let mut entry = ModelMetadata::sparse(
        provider,
        api_kind_for(provider),
        id,
        ModelSource::Baseline,
    );
    entry.reasoning = reasoning;
    entry.thinking_level_map = thinking_level_map;
    entry.compat = compat;
    entry
}

pub(super) fn seed_catalog() -> ModelCatalog {
    let mut providers: BTreeMap<BackendKind, ProviderCatalog> = BTreeMap::new();
    let mut register = |default: ModelMetadata, known: &[ModelMetadata]| {
        let models = known
            .iter()
            .map(|metadata| (metadata.id.clone(), metadata.clone()))
            .collect();
        providers.insert(default.provider, ProviderCatalog { default, models });
    };

    register(
        entry(
            BackendKind::DeepSeekChat,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            deepseek_levels(),
            // DeepSeek rejects an explicit temperature on reasoning models.
            completions_compat(
                Some(CompletionsThinkingFormat::Deepseek),
                "reasoning_content",
                None,
            ),
        ),
        &[],
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
    );
    register(
        entry(
            BackendKind::ChatGptCodexResponses,
            PROVIDER_DEFAULT_MODEL_ID,
            true,
            all_levels(),
            Compat::default(),
        ),
        &[],
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
            &[],
        );
    }

    ModelCatalog { providers }
}
