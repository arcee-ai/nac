use super::test_support::EnvGuard;
use super::*;
use crate::model::{
    validate_model_reasoning_effort, EffectiveModelSettings, ReasoningEffort,
    ARCEE_AUTH_CANONICAL_BASE_URL, CHATGPT_CODEX_CANONICAL_BASE_URL,
};
use crate::TEST_ENV_LOCK;
use sha2::Digest;
use std::collections::BTreeMap;

const ALL_PROVIDERS: [BackendKind; 8] = [
    BackendKind::DeepSeekChat,
    BackendKind::FireworksChat,
    BackendKind::TogetherChat,
    BackendKind::OpenAiResponses,
    BackendKind::ChatGptCodexResponses,
    BackendKind::AnthropicMessages,
    BackendKind::ArceeAuth,
    BackendKind::ArceeApi,
];

const ALL_EFFORTS: [ReasoningEffort; 7] = [
    ReasoningEffort::None,
    ReasoningEffort::Minimal,
    ReasoningEffort::Low,
    ReasoningEffort::Medium,
    ReasoningEffort::High,
    ReasoningEffort::Xhigh,
    ReasoningEffort::Max,
];

#[test]
fn every_provider_ships_a_default_entry_with_its_wire_api() {
    let cases = [
        (BackendKind::DeepSeekChat, ApiKind::OpenAiCompletions),
        (BackendKind::FireworksChat, ApiKind::OpenAiCompletions),
        (BackendKind::TogetherChat, ApiKind::OpenAiCompletions),
        (BackendKind::OpenAiResponses, ApiKind::OpenAiResponses),
        (
            BackendKind::ChatGptCodexResponses,
            ApiKind::ChatGptCodexResponses,
        ),
        (BackendKind::AnthropicMessages, ApiKind::AnthropicMessages),
        (BackendKind::ArceeAuth, ApiKind::OpenAiCompletions),
        (BackendKind::ArceeApi, ApiKind::OpenAiCompletions),
    ];
    for (provider, api) in cases {
        let metadata = current().resolve(provider, "model-with-no-catalog-entry");
        assert_eq!(metadata.provider, provider, "{provider}");
        assert_eq!(metadata.api, api, "{provider}");
        assert_eq!(metadata.source, ModelSource::ProviderDefault, "{provider}");
    }
}

#[test]
fn unknown_models_clone_provider_defaults_with_fallback_limits() {
    for provider in ALL_PROVIDERS {
        let metadata = resolve(provider, "never-seen-model");
        assert_eq!(metadata.id, "never-seen-model", "{provider}");
        assert_eq!(metadata.source, ModelSource::ProviderDefault, "{provider}");
        assert_eq!(
            metadata.context_window, FALLBACK_CONTEXT_WINDOW,
            "{provider}"
        );
        assert_eq!(metadata.max_tokens, FALLBACK_MAX_TOKENS, "{provider}");
        assert_eq!(metadata.cost, ModelCostRates::default(), "{provider}");
        assert_eq!(metadata.cache_write_1h, None, "{provider}");
        assert_eq!(metadata.display_name, None, "{provider}");
    }
}

/// Independent transcription of the stable validation matrix. Provider-specific
/// corrections are covered separately by `corrected_provider_effort_maps`.
fn pre_s4_matrix_accepts(provider: BackendKind, model: &str, effort: ReasoningEffort) -> bool {
    match provider {
        BackendKind::DeepSeekChat => matches!(
            effort,
            ReasoningEffort::None
                | ReasoningEffort::Low
                | ReasoningEffort::High
                | ReasoningEffort::Max
        ),
        BackendKind::FireworksChat | BackendKind::TogetherChat => matches!(
            effort,
            ReasoningEffort::None
                | ReasoningEffort::Low
                | ReasoningEffort::Medium
                | ReasoningEffort::High
        ),
        BackendKind::OpenAiResponses | BackendKind::ChatGptCodexResponses => {
            effort != ReasoningEffort::Max || model.starts_with("gpt-5.6")
        }
        BackendKind::AnthropicMessages => {
            if effort == ReasoningEffort::None {
                return true;
            }
            if pre_s4_anthropic_family(model, "claude-opus-4-6") {
                matches!(
                    effort,
                    ReasoningEffort::Low
                        | ReasoningEffort::Medium
                        | ReasoningEffort::High
                        | ReasoningEffort::Xhigh
                )
            } else if pre_s4_anthropic_family(model, "claude-sonnet-4-6") {
                matches!(
                    effort,
                    ReasoningEffort::Low | ReasoningEffort::Medium | ReasoningEffort::High
                )
            } else {
                false
            }
        }
        BackendKind::ArceeAuth | BackendKind::ArceeApi => false,
    }
}

/// The pre-S4 `backend.rs::anthropic_model_family` rule: exact family name
/// or a `-YYYYMMDD` dated snapshot only (never `-latest` or other suffixes).
fn pre_s4_anthropic_family(model: &str, family: &str) -> bool {
    model == family
        || model
            .strip_prefix(family)
            .and_then(|suffix| suffix.strip_prefix('-'))
            .is_some_and(|snapshot| {
                snapshot.len() == 8 && snapshot.bytes().all(|byte| byte.is_ascii_digit())
            })
}

#[test]
fn seed_maps_transcribe_the_validation_matrix_exactly() {
    // Unknown-model rows only (every provider resolves these through its
    // `_default` entry): known models — and their dated snapshots, which
    // resolve through the same guarded family entries — are covered
    // exhaustively by `every_generated_entry_preserves_the_validation_matrix`.
    let models = ["test-model", "claude-opus-4-6-latest", "claude-3-5-sonnet"];
    for provider in ALL_PROVIDERS {
        for model in models {
            let metadata = resolve(provider, model);
            for effort in ALL_EFFORTS {
                let matrix = pre_s4_matrix_accepts(provider, model, effort);
                let catalog = metadata.thinking_level_map.is_supported(effort);
                assert_eq!(catalog, matrix, "{provider} {model} {}", effort.as_str());
                // S4: validation itself is map-driven; it must agree with
                // the independent matrix transcription.
                assert_eq!(
                    validate_model_reasoning_effort(provider, model, Some(effort)).is_ok(),
                    matrix,
                    "{provider} {model} {}",
                    effort.as_str()
                );
            }
        }
    }
}

#[test]
fn corrected_provider_effort_maps() {
    use ReasoningEffort::{High, Low, Max, None};

    let cases: &[(BackendKind, &str, &[ReasoningEffort])] = &[
        (
            BackendKind::DeepSeekChat,
            "deepseek-chat",
            &[None, Low, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/minimax-m3",
            &[None, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/deepseek-v4-flash",
            &[None, Low, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/deepseek-v4-flash-0731",
            &[None, Low, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/deepseek-v4-pro",
            &[None, Low, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/glm-5p2",
            &[None, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/routers/glm-5p2-fast",
            &[None, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/kimi-k3",
            &[Low, High, Max],
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/routers/kimi-k3-fast",
            &[Low, High, Max],
        ),
        (
            BackendKind::TogetherChat,
            "zai-org/GLM-5.2",
            &[None, High, Max],
        ),
        (
            BackendKind::TogetherChat,
            "deepseek-ai/DeepSeek-V4-Pro",
            &[None, Low, High, Max],
        ),
        (
            BackendKind::TogetherChat,
            "deepseek-ai/DeepSeek-V4-Flash-0731",
            &[None, Low, High, Max],
        ),
        (
            BackendKind::TogetherChat,
            "MiniMaxAI/MiniMax-M3",
            &[None, Max],
        ),
        (
            BackendKind::TogetherChat,
            "moonshotai/Kimi-K3",
            &[Low, High, Max],
        ),
    ];

    for (provider, model, expected) in cases {
        assert_eq!(
            resolve(*provider, model)
                .thinking_level_map
                .supported_efforts(),
            *expected,
            "{provider}/{model}"
        );
    }
}

#[test]
fn dated_snapshots_resolve_through_their_family_entry() {
    let metadata = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6-20260301");
    assert_eq!(metadata.id, "claude-opus-4-6-20260301");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert_eq!(
        metadata
            .thinking_level_map
            .wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );

    let sonnet = resolve(BackendKind::AnthropicMessages, "claude-sonnet-4-6-20251001");
    assert_eq!(sonnet.id, "claude-sonnet-4-6-20251001");
    assert_eq!(sonnet.source, ModelSource::Baseline);
    assert!(sonnet
        .thinking_level_map
        .is_supported(ReasoningEffort::High));
    assert!(!sonnet
        .thinking_level_map
        .is_supported(ReasoningEffort::Xhigh));

    // Non-dated suffixes are not family matches and stay conservative.
    let latest = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6-latest");
    assert_eq!(latest.source, ModelSource::ProviderDefault);
    assert!(!latest
        .thinking_level_map
        .is_supported(ReasoningEffort::High));
}

#[test]
fn exact_seed_entries_keep_their_own_id_and_source() {
    let metadata = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
    assert_eq!(metadata.id, "claude-opus-4-6");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert!(metadata.reasoning);
}

#[test]
fn wire_level_special_cases_are_encoded_in_data() {
    let deepseek = resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(
        deepseek.thinking_level_map.wire_value(ReasoningEffort::Max),
        Some("max")
    );
    assert_eq!(
        deepseek
            .thinking_level_map
            .wire_value(ReasoningEffort::High),
        Some("high")
    );
    assert!(deepseek
        .thinking_level_map
        .is_supported(ReasoningEffort::Low));
    assert!(!deepseek
        .thinking_level_map
        .is_supported(ReasoningEffort::Xhigh));
    assert_eq!(
        deepseek.compat.completions_thinking_format,
        Some(CompletionsThinkingFormat::Deepseek)
    );
    assert_eq!(
        deepseek.compat.completions_reasoning_field.as_deref(),
        Some("reasoning_content")
    );

    // Together parses reasoning from `reasoning`, not `reasoning_content`.
    let together = resolve(BackendKind::TogetherChat, "together-model");
    assert_eq!(
        together.compat.completions_reasoning_field.as_deref(),
        Some("reasoning")
    );

    // Arcee's _default entry has the Arcee thinking format (bare
    // reasoning_effort) but an empty thinking_level_map, so unknown models
    // accept no explicit effort levels. The passthrough models get their
    // effort maps from the arcee overlay at runtime.
    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        let arcee = resolve(backend, "arcee-model");
        assert!(arcee.thinking_level_map.0.is_empty(), "{backend}");
        assert!(!arcee.reasoning, "{backend}");
        assert_eq!(
            arcee.compat.completions_thinking_format,
            Some(CompletionsThinkingFormat::Arcee),
            "{backend}"
        );
    }
}

#[test]
fn effective_settings_resolve_catalog_metadata_at_construction() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let settings = EffectiveModelSettings::from_optional(
        Some(BackendKind::DeepSeekChat),
        Some("deepseek-v4-flash".to_string()),
        Some("https://api.deepseek.com".to_string()),
        Some(ReasoningEffort::High),
        None,
        std::collections::BTreeMap::new(),
    )
    .expect("valid deepseek settings");
    assert_eq!(settings.resolved.id, "deepseek-v4-flash");
    assert_eq!(settings.resolved.provider, BackendKind::DeepSeekChat);
    assert_eq!(settings.resolved.api, ApiKind::OpenAiCompletions);
    // S1: `deepseek-v4-flash` is a models.dev catalog entry, so resolution
    // finds the generated baseline (real limits) instead of the provider
    // default.
    assert_eq!(settings.resolved.source, ModelSource::Baseline);
    assert_eq!(settings.resolved.context_window, 1_000_000);
    assert!(settings
        .resolved
        .thinking_level_map
        .is_supported(ReasoningEffort::High));
}

#[test]
fn resolution_is_sync_local_and_credential_free() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    // The picker and resume paths resolve metadata without credentials or
    // network; pin that contract with an empty NAC_HOME and no provider keys.
    let _env = EnvGuard::new(
        "credential-free",
        &["NAC_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
        &["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    );
    reset_for_test();
    for provider in ALL_PROVIDERS {
        let metadata = resolve(provider, "picker-model");
        assert_eq!(metadata.source, ModelSource::ProviderDefault, "{provider}");
        assert_eq!(
            metadata.context_window, FALLBACK_CONTEXT_WINDOW,
            "{provider}"
        );
    }
}

#[test]
fn reset_for_test_reloads_the_seed_catalog() {
    // Serializes with the S2 refresh tests: this reloads the process-global
    // catalog, which must not race a refresh test's overlay reload.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let before = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
    reset_for_test();
    let after = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
    assert_eq!(before, after);
}

#[test]
fn hand_seeded_arcee_and_codex_entries_carry_documented_values() {
    // The models.dev-absent providers serve hand-maintained entries (seed.rs
    // documents the provenance of every value). These pins make seed edits
    // deliberate.
    let codex_cases = [
        ("gpt-5.6-sol", "GPT-5.6 Sol", 272_000, 128_000, 5.0, 30.0),
        (
            "gpt-5.6-terra",
            "GPT-5.6 Terra",
            272_000,
            128_000,
            2.0,
            12.0,
        ),
        ("gpt-5.6-luna", "GPT-5.6 Luna", 272_000, 128_000, 0.2, 1.2),
        ("gpt-5.6", "GPT-5.6", 272_000, 128_000, 5.0, 30.0),
        (
            "gpt-5.3-codex-spark",
            "GPT-5.3 Codex Spark",
            128_000,
            32_000,
            1.75,
            14.0,
        ),
    ];
    for (id, display_name, context_window, max_tokens, input, output) in codex_cases {
        let metadata = resolve(BackendKind::ChatGptCodexResponses, id);
        assert_eq!(metadata.id, id, "{id}");
        assert_eq!(metadata.source, ModelSource::Baseline, "{id}");
        assert_eq!(metadata.display_name.as_deref(), Some(display_name), "{id}");
        assert_eq!(metadata.context_window, context_window, "{id}");
        assert_eq!(metadata.max_tokens, max_tokens, "{id}");
        assert_eq!(metadata.cost.input, input, "{id}");
        assert_eq!(metadata.cost.output, output, "{id}");
        assert!(metadata.reasoning, "{id}");
        // Codex matrix behavior: every effort level, sent verbatim.
        // GPT-5.6 models additionally support `max` (post-S4 addition);
        // gpt-5.3-codex-spark does not.
        let supports_max = id.starts_with("gpt-5.6");
        for effort in ALL_EFFORTS {
            if effort == ReasoningEffort::Max && !supports_max {
                assert_eq!(
                    metadata.thinking_level_map.wire_value(effort),
                    None,
                    "{id} {} should not be supported",
                    effort.as_str()
                );
            } else {
                assert_eq!(
                    metadata.thinking_level_map.wire_value(effort),
                    Some(effort.as_str()),
                    "{id} {}",
                    effort.as_str()
                );
            }
        }
    }

    let arcee_cases = [
        (
            "trinity-large-thinking",
            "Trinity-Large-Thinking",
            80_000,
            0.25,
            0.80,
            true,
        ),
        ("trinity-mini", "Trinity-Mini", 16_384, 0.045, 0.15, false),
        (
            "trinity-large-preview",
            "Trinity-Large-Preview",
            16_384,
            0.45,
            0.15,
            false,
        ),
    ];
    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        for (id, display_name, max_tokens, input, output, reasoning) in &arcee_cases {
            let metadata = resolve(backend, id);
            assert_eq!(metadata.id, *id, "{backend}/{id}");
            assert_eq!(metadata.source, ModelSource::Baseline, "{backend}/{id}");
            assert_eq!(
                metadata.display_name.as_deref(),
                Some(*display_name),
                "{backend}/{id}"
            );
            // Arcee's stated hosted context window.
            assert_eq!(metadata.context_window, 128_000, "{backend}/{id}");
            assert_eq!(metadata.max_tokens, *max_tokens, "{backend}/{id}");
            assert_eq!(metadata.cost.input, *input, "{backend}/{id}");
            assert_eq!(metadata.cost.output, *output, "{backend}/{id}");
            // Cache pricing is undocumented (zero = unknown).
            assert_eq!(metadata.cost.cache_read, 0.0, "{backend}/{id}");
            assert_eq!(metadata.cost.cache_write, 0.0, "{backend}/{id}");
            assert_eq!(metadata.reasoning, *reasoning, "{backend}/{id}");
            // Trinity models accept no explicit effort levels (empty map).
            // The passthrough models get their maps from the arcee overlay.
            assert!(metadata.thinking_level_map.0.is_empty(), "{backend}/{id}");
            // The completions compat matches the provider default.
            let default = resolve(backend, "model-with-no-catalog-entry");
            assert_eq!(metadata.compat, default.compat, "{backend}/{id}");
        }
    }
}

#[test]
fn generated_baseline_merges_real_models_dev_data_over_the_seeds() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    // A generated entry per models.dev provider: real limits, display name,
    // baseline source, and the provider default's compat inherited.
    let cases = [
        (
            BackendKind::DeepSeekChat,
            "deepseek-v4-flash",
            1_000_000,
            384_000,
        ),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/kimi-k2p6",
            262_000,
            262_000,
        ),
        (
            BackendKind::TogetherChat,
            "moonshotai/Kimi-K2.6",
            262_144,
            131_000,
        ),
        (BackendKind::OpenAiResponses, "gpt-5.2", 400_000, 128_000),
        (
            BackendKind::AnthropicMessages,
            "claude-opus-4-6",
            1_000_000,
            128_000,
        ),
    ];
    for (provider, model, context_window, max_tokens) in cases {
        let metadata = resolve(provider, model);
        assert_eq!(metadata.id, model, "{provider}");
        assert_eq!(metadata.source, ModelSource::Baseline, "{provider}");
        assert_eq!(metadata.context_window, context_window, "{provider}");
        assert_eq!(metadata.max_tokens, max_tokens, "{provider}");
        assert!(metadata.display_name.is_some(), "{provider}");
        let default = resolve(provider, "model-with-no-catalog-entry");
        assert_eq!(metadata.compat, default.compat, "{provider}");
    }

    // Cost rates are models.dev data: claude-opus-4-6 is $5/$25 per 1M with
    // 0.5/6.25 cache rates (anthropic's 5-minute write premium).
    let opus = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
    assert_eq!(opus.cost.input, 5.0);
    assert_eq!(opus.cost.output, 25.0);
    assert_eq!(opus.cost.cache_read, 0.5);
    assert_eq!(opus.cost.cache_write, 6.25);
    assert_eq!(opus.cache_write_1h, None);
}

#[test]
fn arcee_passthrough_without_output_limit_gets_a_large_safe_default() {
    let entries = arcee_overlay::map_arcee_api_response(
        r#"{"data":[{"id":"deepseek-ai/deepseek-v4-pro","context_length":512000},{"id":"trinity-large-thinking","context_length":128000}]}"#,
    )
    .unwrap();
    let entry = serde_json::to_value(&entries[0]).unwrap();
    assert_eq!(entry["max_tokens"], 256_000);
    assert_eq!(
        serde_json::to_value(&entries[1]).unwrap()["max_tokens"],
        80_000
    );
}

#[test]
fn manifest_sha256_pins_the_embedded_catalog() {
    #[derive(serde::Deserialize)]
    struct ManifestHash {
        sha256: String,
    }

    let manifest: ManifestHash = serde_json::from_str(data::GENERATED_MANIFEST_JSON)
        .expect("embedded manifest parses");
    assert!(!manifest.sha256.is_empty());
    let digest = sha2::Sha256::digest(data::GENERATED_CATALOG_JSON.as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    assert_eq!(
        hex, manifest.sha256,
        "catalog.json and manifest drifted apart"
    );
}

#[test]
fn generated_entries_satisfy_catalog_invariants() {
    // Serializes with the S2 refresh tests: they transiently reload the
    // process-global catalog with Overlay-sourced entries, which would break
    // the `source == Baseline` assertion below.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let catalog = current();
    let mut entry_count = 0;
    for (provider, provider_catalog) in &catalog.providers {
        for (id, metadata) in &provider_catalog.models {
            entry_count += 1;
            assert!(!id.is_empty(), "{provider}");
            assert_eq!(metadata.source, ModelSource::Baseline, "{provider}/{id}");
            assert!(metadata.context_window > 0, "{provider}/{id}");
            assert!(metadata.max_tokens > 0, "{provider}/{id}");
            assert!(
                metadata.max_tokens <= metadata.context_window,
                "{provider}/{id}: max_tokens {} exceeds context_window {}",
                metadata.max_tokens,
                metadata.context_window
            );
            for rate in [
                metadata.cost.input,
                metadata.cost.output,
                metadata.cost.cache_read,
                metadata.cost.cache_write,
            ] {
                assert!(rate >= 0.0, "{provider}/{id}: negative rate {rate}");
            }
            for (effort, wire) in &metadata.thinking_level_map.0 {
                if let Some(wire) = wire {
                    assert!(
                        !wire.is_empty(),
                        "{provider}/{id}: empty wire for {}",
                        effort.as_str()
                    );
                }
            }
        }
    }
    // Snapshot pin: 78 agent-compatible generated models plus 11 hand-seeded
    // entries (2 deprecated deepseek models removed). Drift fails loudly here
    // at regen/seed-edit time, forcing a deliberate review.
    assert_eq!(entry_count, 90, "catalog model count drifted");
}

/// The S4 guard: every generated catalog entry — not just the S0 spot-check
/// models — must preserve the pre-S4 validation matrix exactly, proving that
/// rewiring validation onto catalog maps was behavior-neutral for every
/// matrix-covered model. Compared against the independent
/// `pre_s4_matrix_accepts` transcription: since S4, validation reads the
/// same maps, so validating against itself would prove nothing.
#[test]
fn every_generated_entry_preserves_the_validation_matrix() {
    // Holds TEST_ENV_LOCK for the same reason as
    // `generated_entries_satisfy_catalog_invariants`.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    // Iterate the guard's entries directly: calling `resolve()` while
    // holding the read guard would re-acquire the RwLock and can deadlock
    // against a concurrent `reset_for_test` writer. (`validate_model_...`
    // re-resolves through the global catalog; that nested read is safe here
    // because every writer is serialized by TEST_ENV_LOCK, which this test
    // holds.)
    let catalog = current();
    for (provider, provider_catalog) in &catalog.providers {
        if matches!(
            provider,
            BackendKind::FireworksChat | BackendKind::TogetherChat
        ) {
            continue;
        }
        for (id, metadata) in &provider_catalog.models {
            assert_eq!(metadata.id, *id, "{provider}/{id}");
            assert_eq!(metadata.source, ModelSource::Baseline, "{provider}/{id}");
            for effort in ALL_EFFORTS {
                let matrix = pre_s4_matrix_accepts(*provider, id, effort);
                let supported = metadata.thinking_level_map.is_supported(effort);
                assert_eq!(supported, matrix, "{provider}/{id} {}", effort.as_str());
                assert_eq!(
                    validate_model_reasoning_effort(*provider, id, Some(effort)).is_ok(),
                    matrix,
                    "{provider}/{id} {}",
                    effort.as_str()
                );
            }
        }
    }
}

#[test]
fn thinking_level_map_lookup_semantics() {
    let map = ThinkingLevelMap(BTreeMap::from([
        (ReasoningEffort::None, Some("none".to_string())),
        (ReasoningEffort::High, Some("max".to_string())),
        (ReasoningEffort::Low, None),
    ]));
    // present + Some = supported, with the wire value.
    assert_eq!(map.wire_value(ReasoningEffort::High), Some("max"));
    assert!(map.is_supported(ReasoningEffort::High));
    assert!(!map.is_explicitly_unsupported(ReasoningEffort::High));
    // present + None = explicitly unsupported (documents always-thinking
    // models); distinct from absent.
    assert_eq!(map.wire_value(ReasoningEffort::Low), None);
    assert!(!map.is_supported(ReasoningEffort::Low));
    assert!(map.is_explicitly_unsupported(ReasoningEffort::Low));
    // absent = unsupported, but not explicitly.
    assert_eq!(map.wire_value(ReasoningEffort::Xhigh), None);
    assert!(!map.is_supported(ReasoningEffort::Xhigh));
    assert!(!map.is_explicitly_unsupported(ReasoningEffort::Xhigh));
}

#[test]
fn user_override_thinking_map_relaxes_validation_and_wire_end_to_end() {
    // The S4 unlock, end to end: a `$NAC_HOME/models.json` override relaxes
    // a model's effort levels; validation and the adapter wire value both
    // follow the overridden data. Pre-S4, the hardcoded matrix rejected
    // every non-none effort for claude-haiku-4-5.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "s4-unlock",
        &["NAC_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
        &["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
    )
    .with_env_layers();
    std::fs::write(
        env.path().join("models.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "overrides": [
                {
                    "provider": "anthropic-messages",
                    "model": "claude-haiku-4-5",
                    "set": { "thinking_level_map": { "none": "none", "high": "high" } }
                }
            ]
        }))
        .unwrap(),
    )
    .unwrap();
    reset_for_test();

    validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-haiku-4-5",
        Some(ReasoningEffort::High),
    )
    .expect("the user override relaxes validation");
    let error = validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-haiku-4-5",
        Some(ReasoningEffort::Xhigh),
    )
    .expect_err("levels outside the override map stay rejected");
    assert!(error.to_string().contains("claude-haiku-4-5"), "{error:#}");
    assert!(error.to_string().contains("none, or high"), "{error:#}");

    // EffectiveModelSettings construction accepts the relaxed level and
    // carries the overridden map into the client-facing metadata.
    let settings = EffectiveModelSettings::new(
        BackendKind::AnthropicMessages,
        "claude-haiku-4-5".to_string(),
        "https://api.anthropic.com".to_string(),
        Some(ReasoningEffort::High),
        None,
        std::collections::BTreeMap::new(),
    )
    .expect("the relaxed effort constructs effective settings");
    assert_eq!(settings.resolved.source, ModelSource::UserOverride);

    // A concurrent reload can change the global map, but request validation
    // and wire translation must stay on the settings snapshot.
    std::fs::write(
        env.path().join("models.json"),
        serde_json::to_string_pretty(&serde_json::json!({
            "overrides": [{
                "provider": "anthropic-messages",
                "model": "claude-haiku-4-5",
                "set": { "thinking_level_map": { "none": "none" } }
            }]
        }))
        .unwrap(),
    )
    .unwrap();
    reset_for_test();
    assert!(validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-haiku-4-5",
        Some(ReasoningEffort::High),
    )
    .is_err());

    // The adapter emits the snapshotted override's wire value.
    let request = crate::model::anthropic::anthropic_messages_request(
        "claude-haiku-4-5",
        Some(ReasoningEffort::High),
        &[crate::types::Message::User {
            content: "hi".to_string(),
        }],
        &[],
        None,
        &settings.resolved.thinking_level_map,
        settings.resolved.max_tokens,
        false,
        false,
        false,
    )
    .unwrap();
    assert_eq!(request["thinking"], serde_json::json!({"type": "adaptive"}));
    assert_eq!(
        request["output_config"],
        serde_json::json!({"effort": "high"})
    );
}

#[test]
fn sparse_metadata_carries_the_documented_fallbacks() {
    let metadata = ModelMetadata::sparse(
        BackendKind::ArceeApi,
        ApiKind::OpenAiCompletions,
        "sparse-model",
        ModelSource::Fallback,
    );
    assert_eq!(metadata.context_window, 128_000);
    assert_eq!(metadata.max_tokens, 16_384);
    assert_eq!(metadata.cost, ModelCostRates::default());
    assert!(!metadata.reasoning);
    assert!(metadata.thinking_level_map.0.is_empty());
    assert_eq!(metadata.source, ModelSource::Fallback);
}

#[test]
fn api_listing_serves_every_provider_with_auth_and_managed_urls() {
    // Provider set, auth requirements and managed base URLs derive from the
    // backend kind, not from catalog data — this test needs no env lock.
    let listing = api_listing();
    let providers = listing
        .providers
        .iter()
        .map(|provider| {
            (
                provider.id,
                provider.auth,
                provider.managed_base_url.as_deref(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        providers,
        vec![
            (BackendKind::DeepSeekChat, ProviderAuth::ApiKeyEnv, None),
            (BackendKind::FireworksChat, ProviderAuth::ApiKeyEnv, None),
            (BackendKind::TogetherChat, ProviderAuth::ApiKeyEnv, None),
            (BackendKind::OpenAiResponses, ProviderAuth::ApiKeyEnv, None),
            (
                BackendKind::ChatGptCodexResponses,
                ProviderAuth::CodexOauth,
                Some(CHATGPT_CODEX_CANONICAL_BASE_URL)
            ),
            (
                BackendKind::AnthropicMessages,
                ProviderAuth::ApiKeyEnv,
                None
            ),
            (
                BackendKind::ArceeAuth,
                ProviderAuth::ManagedArcee,
                Some(ARCEE_AUTH_CANONICAL_BASE_URL)
            ),
            (BackendKind::ArceeApi, ProviderAuth::ApiKeyEnv, None),
        ]
    );
}

#[test]
fn api_listing_serves_catalog_default_base_urls() {
    // Holds TEST_ENV_LOCK like the other global-catalog assertions: the S2
    // refresh tests transiently reload the global with Overlay entries.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let listing = api_listing();
    let default_base_url = |provider: BackendKind| {
        listing
            .providers
            .iter()
            .find(|entry| entry.id == provider)
            .unwrap()
            .default_base_url
            .as_deref()
    };
    // The five models.dev providers come from models.dev `api` or the
    // curated overrides; the anthropic default is the API ROOT (the adapter
    // appends "/v1/messages" itself); arcee-api is hand-seeded (not a
    // models.dev provider); managed providers keep code-side canonicals.
    assert_eq!(
        default_base_url(BackendKind::DeepSeekChat),
        Some("https://api.deepseek.com")
    );
    assert_eq!(
        default_base_url(BackendKind::FireworksChat),
        Some("https://api.fireworks.ai/inference/v1")
    );
    assert_eq!(
        default_base_url(BackendKind::TogetherChat),
        Some("https://api.together.xyz/v1")
    );
    assert_eq!(
        default_base_url(BackendKind::OpenAiResponses),
        Some("https://api.openai.com/v1")
    );
    assert_eq!(
        default_base_url(BackendKind::AnthropicMessages),
        Some("https://api.anthropic.com")
    );
    assert_eq!(
        default_base_url(BackendKind::ArceeApi),
        Some("https://api.arcee.ai/api/v1")
    );
    assert_eq!(default_base_url(BackendKind::ArceeAuth), None);
    assert_eq!(default_base_url(BackendKind::ChatGptCodexResponses), None);
}

#[test]
fn provider_for_model_resolves_unique_collision_and_unknown_ids() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    // Unique exact matches win (one entry per provider class).
    assert_eq!(
        provider_for_model("claude-opus-4-6"),
        Some(BackendKind::AnthropicMessages)
    );
    assert_eq!(
        provider_for_model("deepseek-v4-pro"),
        Some(BackendKind::DeepSeekChat)
    );

    // Collisions prefer the non-managed provider: the Trinity ids exist on
    // both arcee backends, and every codex seed id overlaps an openai
    // baseline entry — so managed providers are only reachable through an
    // explicit backend selection, never through model-id resolution.
    assert_eq!(
        provider_for_model("trinity-large-thinking"),
        Some(BackendKind::ArceeApi)
    );
    assert_eq!(
        provider_for_model("gpt-5.6-sol"),
        Some(BackendKind::OpenAiResponses)
    );
    assert_eq!(
        provider_for_model("gpt-5.3-codex-spark"),
        Some(BackendKind::OpenAiResponses)
    );

    // Unknown ids (including dated-snapshot shapes — the lookup is exact
    // only) stay unresolved.
    assert_eq!(provider_for_model("never-seen-model"), None);
    assert_eq!(provider_for_model("claude-opus-4-6-20260301"), None);
}

#[test]
fn api_listing_serializes_the_designed_field_names() {
    // Holds TEST_ENV_LOCK like the other global-catalog assertions: the S2
    // refresh tests transiently reload the global with Overlay entries.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let listing = serde_json::to_value(api_listing()).expect("listing serializes");
    let keys = |value: &serde_json::Value| {
        value
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<Vec<String>>()
    };
    // serde_json objects are BTreeMap-backed: keys serialize sorted.
    assert_eq!(keys(&listing), ["catalog_version", "providers"]);
    assert!(listing["catalog_version"].as_u64().unwrap() >= 1);

    let anthropic = listing["providers"]
        .as_array()
        .unwrap()
        .iter()
        .find(|provider| provider["id"] == "anthropic-messages")
        .unwrap();
    assert_eq!(
        keys(anthropic),
        [
            "auth",
            "auth_hint",
            "auth_status",
            "default_base_url",
            "default_limits",
            "id",
            "managed_base_url",
            "models"
        ]
    );
    assert_eq!(anthropic["auth"], "api_key_env");
    // Status is machine-dependent (process env + credential files); the
    // deterministic semantics are pinned by auth_status_tests. Here: the
    // value domain only.
    assert!(
        ["ready", "no_credential"].contains(&anthropic["auth_status"].as_str().unwrap()),
        "{}",
        anthropic["auth_status"]
    );
    assert!(
        anthropic["auth_hint"].is_string() || anthropic["auth_hint"].is_null(),
        "{}",
        anthropic["auth_hint"]
    );
    assert!(anthropic["managed_base_url"].is_null());
    assert_eq!(
        keys(&anthropic["default_limits"]),
        ["context_window", "max_tokens", "supported_efforts"]
    );

    let opus = anthropic["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|model| model["id"] == "claude-opus-4-6")
        .unwrap();
    assert_eq!(
        keys(opus),
        [
            "context_window",
            "cost",
            "display_name",
            "id",
            "max_tokens",
            "reasoning",
            "source",
            "supported_efforts"
        ]
    );
    assert_eq!(
        keys(&opus["cost"]),
        ["cache_read", "cache_write", "input", "output"]
    );
    assert_eq!(opus["display_name"], "Claude Opus 4.6");
    assert_eq!(opus["context_window"], 1_000_000);
    assert_eq!(opus["max_tokens"], 128_000);
    assert_eq!(opus["cost"]["input"], 5.0);
    assert_eq!(opus["cost"]["output"], 25.0);
    assert_eq!(opus["reasoning"], true);
    assert_eq!(opus["source"], "baseline");
    assert_eq!(
        opus["supported_efforts"],
        serde_json::json!(["none", "low", "medium", "high", "xhigh"])
    );
}

#[test]
fn api_listing_supported_efforts_come_from_some_wired_map_keys() {
    // Derivation and canonical ordering; present+None keys are excluded.
    let map = ThinkingLevelMap(BTreeMap::from([
        (ReasoningEffort::Xhigh, Some("max".to_string())),
        (ReasoningEffort::None, Some("none".to_string())),
        (ReasoningEffort::Low, None),
        (ReasoningEffort::High, Some("high".to_string())),
    ]));
    assert_eq!(
        map.supported_efforts(),
        vec![
            ReasoningEffort::None,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh
        ]
    );

    // Wire values stay internal: claude-opus-4-6's xhigh maps to the wire
    // tier "max", but the listing reports the effort level.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let listing = api_listing();
    let anthropic = listing
        .providers
        .iter()
        .find(|provider| provider.id == BackendKind::AnthropicMessages)
        .unwrap();
    let opus = anthropic
        .models
        .iter()
        .find(|model| model.id == "claude-opus-4-6")
        .unwrap();
    assert_eq!(
        opus.supported_efforts,
        vec![
            ReasoningEffort::None,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ]
    );
}

#[test]
fn api_listing_lists_only_real_entries_with_defaults_in_default_limits() {
    // Holds TEST_ENV_LOCK for the same reason as the other global-catalog
    // assertions (transient Overlay entries from the refresh tests).
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let listing = api_listing();
    assert_eq!(listing.providers.len(), 8);
    let mut total = 0;
    for provider in &listing.providers {
        // `_default` is served as default_limits, never as a model entry;
        // ProviderDefault/Fallback synthesis products never appear.
        assert!(
            provider
                .models
                .iter()
                .all(|model| model.id != PROVIDER_DEFAULT_MODEL_ID),
            "{}",
            provider.id
        );
        assert!(
            provider.default_limits.context_window > 0,
            "{}",
            provider.id
        );
        assert!(provider.default_limits.max_tokens > 0, "{}", provider.id);
        for model in &provider.models {
            // The test-build global catalog is seed + embedded baseline.
            assert_eq!(model.source, ModelSource::Baseline, "{}", model.id);
        }
        total += provider.models.len();
    }
    // Same snapshot pin as `generated_entries_satisfy_catalog_invariants`.
    assert_eq!(total, 90, "catalog model count drifted");

    // The hand-seeded providers serve their maintained entries (the picker's
    // model lists) while their `_default` limits stay conservative fallbacks
    // (the frontend's custom-model path reads those).
    for backend in [
        BackendKind::ArceeAuth,
        BackendKind::ArceeApi,
        BackendKind::ChatGptCodexResponses,
    ] {
        let provider = listing
            .providers
            .iter()
            .find(|provider| provider.id == backend)
            .unwrap();
        assert!(!provider.models.is_empty(), "{backend}");
        assert_eq!(
            provider.default_limits.context_window, FALLBACK_CONTEXT_WINDOW,
            "{backend}"
        );
    }
    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        let provider = listing
            .providers
            .iter()
            .find(|provider| provider.id == backend)
            .unwrap();
        assert_eq!(provider.models.len(), 3, "{backend}");
        assert!(
            provider
                .models
                .iter()
                .any(|model| model.id == "trinity-large-thinking"),
            "{backend}"
        );
    }
    let codex = listing
        .providers
        .iter()
        .find(|provider| provider.id == BackendKind::ChatGptCodexResponses)
        .unwrap();
    assert_eq!(codex.models.len(), 5);
    assert!(codex.models.iter().any(|model| model.id == "gpt-5.6-sol"));
}

#[test]
fn catalog_version_bumps_on_reload() {
    // Serializes with the S2 refresh tests: they reload the process-global
    // catalog (bumping the version) via EnvGuard::drop.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let before = api_listing().catalog_version;
    reset_for_test();
    let after = api_listing().catalog_version;
    assert_eq!(after, before + 1);
}
