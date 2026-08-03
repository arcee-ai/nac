use super::*;
use crate::model::{validate_model_reasoning_effort, EffectiveModelSettings, ReasoningEffort};
use crate::TEST_ENV_LOCK;
use sha2::Digest;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

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

const ALL_EFFORTS: [ReasoningEffort; 6] = [
    ReasoningEffort::None,
    ReasoningEffort::Minimal,
    ReasoningEffort::Low,
    ReasoningEffort::Medium,
    ReasoningEffort::High,
    ReasoningEffort::Xhigh,
];

/// Restore mutated environment variables and the reloaded catalog on drop.
struct EnvGuard {
    original: Vec<(&'static str, Option<OsString>)>,
    home: PathBuf,
}

impl EnvGuard {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let home = std::env::temp_dir().join(format!(
            "nac-catalog-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let original = ["NAC_HOME", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect::<Vec<_>>();
        unsafe { std::env::set_var("NAC_HOME", &home) };
        unsafe { std::env::remove_var("OPENAI_API_KEY") };
        unsafe { std::env::remove_var("ANTHROPIC_API_KEY") };
        Self { original, home }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (name, value) in self.original.drain(..) {
            match value {
                Some(value) => unsafe { std::env::set_var(name, value) },
                None => unsafe { std::env::remove_var(name) },
            }
        }
        let _ = std::fs::remove_dir_all(&self.home);
        // No-op for tests that never opted in; panic-safe reset for the
        // ones that enabled the machine-state layers.
        set_env_layers_for_test(false);
        reset_for_test();
    }
}

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
            metadata.context_window,
            FALLBACK_CONTEXT_WINDOW,
            "{provider}"
        );
        assert_eq!(metadata.max_tokens, FALLBACK_MAX_TOKENS, "{provider}");
        assert_eq!(metadata.cost, ModelCostRates::default(), "{provider}");
        assert_eq!(metadata.cache_write_1h, None, "{provider}");
        assert_eq!(metadata.display_name, None, "{provider}");
    }
}

/// Independent transcription of the pre-S4 `backend.rs` validation matrix.
/// Since S4, `validate_model_reasoning_effort` itself reads the catalog
/// maps; the matrix guards compare against this hand-written reference so
/// they keep proving the data reproduces the historical behavior instead of
/// vacuously comparing the map against itself.
fn pre_s4_matrix_accepts(provider: BackendKind, model: &str, effort: ReasoningEffort) -> bool {
    match provider {
        BackendKind::DeepSeekChat => matches!(
            effort,
            ReasoningEffort::None | ReasoningEffort::High | ReasoningEffort::Xhigh
        ),
        BackendKind::FireworksChat | BackendKind::TogetherChat => matches!(
            effort,
            ReasoningEffort::None
                | ReasoningEffort::Low
                | ReasoningEffort::Medium
                | ReasoningEffort::High
        ),
        BackendKind::OpenAiResponses | BackendKind::ChatGptCodexResponses => true,
        BackendKind::AnthropicMessages => {
            // `none` (omission) was safe for every family, including models
            // whose adaptive thinking is always on.
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
                // Older and unknown models stayed conservative.
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
    let models = [
        "test-model",
        "claude-opus-4-6",
        "claude-opus-4-6-20260301",
        "claude-sonnet-4-6",
        "claude-sonnet-4-6-20251001",
        "claude-opus-4-6-latest",
        "claude-opus-4-5",
        "claude-3-5-sonnet",
    ];
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
fn dated_snapshots_resolve_through_their_family_entry() {
    let metadata = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6-20260301");
    assert_eq!(metadata.id, "claude-opus-4-6-20260301");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert_eq!(
        metadata.thinking_level_map.wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );

    let sonnet = resolve(BackendKind::AnthropicMessages, "claude-sonnet-4-6-20251001");
    assert_eq!(sonnet.id, "claude-sonnet-4-6-20251001");
    assert_eq!(sonnet.source, ModelSource::Baseline);
    assert!(sonnet.thinking_level_map.is_supported(ReasoningEffort::High));
    assert!(!sonnet.thinking_level_map.is_supported(ReasoningEffort::Xhigh));

    // Non-dated suffixes are not family matches and stay conservative.
    let latest = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6-latest");
    assert_eq!(latest.source, ModelSource::ProviderDefault);
    assert!(!latest.thinking_level_map.is_supported(ReasoningEffort::High));
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
        deepseek.thinking_level_map.wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );
    assert_eq!(
        deepseek.thinking_level_map.wire_value(ReasoningEffort::High),
        Some("high")
    );
    assert!(!deepseek.thinking_level_map.is_supported(ReasoningEffort::Low));
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

    // Arcee accepts no explicit effort levels, not even `none`.
    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        let arcee = resolve(backend, "arcee-model");
        assert!(arcee.thinking_level_map.0.is_empty(), "{backend}");
        assert!(!arcee.reasoning, "{backend}");
        assert_eq!(
            arcee.compat.completions_thinking_format, None,
            "{backend}"
        );
    }
}

#[test]
fn effective_settings_resolve_catalog_metadata_at_construction() {
    let settings = EffectiveModelSettings::from_optional(
        Some(BackendKind::DeepSeekChat),
        Some("deepseek-chat".to_string()),
        Some("https://api.deepseek.com".to_string()),
        Some(ReasoningEffort::High),
        None,
        std::collections::BTreeMap::new(),
    )
    .expect("valid deepseek settings");
    assert_eq!(settings.resolved.id, "deepseek-chat");
    assert_eq!(settings.resolved.provider, BackendKind::DeepSeekChat);
    assert_eq!(settings.resolved.api, ApiKind::OpenAiCompletions);
    // S1: `deepseek-chat` is a models.dev catalog entry, so resolution finds
    // the generated baseline (real limits) instead of the provider default.
    assert_eq!(settings.resolved.source, ModelSource::Baseline);
    assert_eq!(settings.resolved.context_window, 1_000_000);
    assert!(
        settings
            .resolved
            .thinking_level_map
            .is_supported(ReasoningEffort::High)
    );
}

#[test]
fn resolution_is_sync_local_and_credential_free() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    // The picker and resume paths resolve metadata without credentials or
    // network; pin that contract with an empty NAC_HOME and no provider keys.
    let _env = EnvGuard::new("credential-free");
    reset_for_test();
    for provider in ALL_PROVIDERS {
        let metadata = resolve(provider, "picker-model");
        assert_eq!(metadata.source, ModelSource::ProviderDefault, "{provider}");
        assert_eq!(metadata.context_window, FALLBACK_CONTEXT_WINDOW, "{provider}");
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
fn generated_baseline_merges_real_models_dev_data_over_the_seeds() {
    // A generated entry per models.dev provider: real limits, display name,
    // baseline source, and the provider default's compat inherited.
    let cases = [
        (BackendKind::DeepSeekChat, "deepseek-v4-flash", 1_000_000, 384_000),
        (
            BackendKind::FireworksChat,
            "accounts/fireworks/models/kimi-k2p6",
            262_000,
            262_000,
        ),
        (BackendKind::TogetherChat, "moonshotai/Kimi-K2.6", 262_144, 131_000),
        (BackendKind::OpenAiResponses, "gpt-5.2", 400_000, 128_000),
        (BackendKind::AnthropicMessages, "claude-opus-4-6", 1_000_000, 128_000),
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
fn manifest_sha256_pins_the_embedded_catalog() {
    let manifest = data::parse_manifest().expect("embedded manifest parses");
    assert!(!manifest.sha256.is_empty());
    let digest = sha2::Sha256::digest(data::GENERATED_CATALOG_JSON.as_bytes());
    let hex = digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    assert_eq!(hex, manifest.sha256, "catalog.json and manifest drifted apart");
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
                    assert!(!wire.is_empty(), "{provider}/{id}: empty wire for {}", effort.as_str());
                }
            }
        }
    }
    // Snapshot pin: the checked-in models.dev baseline's model count. Drift
    // fails loudly here at regen time, forcing a deliberate review.
    assert_eq!(entry_count, 117, "models.dev snapshot model count drifted");
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
fn validation_resolves_dated_snapshot_families_from_catalog_data() {
    // No code names this snapshot: it resolves through the family entry's
    // data map (the generic `-YYYYMMDD` rule over catalog entries).
    validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-opus-4-6-20260301",
        Some(ReasoningEffort::Xhigh),
    )
    .expect("dated snapshot inherits the family map from catalog data");
    let metadata = resolve(BackendKind::AnthropicMessages, "claude-opus-4-6-20260301");
    assert_eq!(
        metadata.thinking_level_map.wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );

    // The sonnet family caps at high, through the same data path.
    validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-sonnet-4-6-20260217",
        Some(ReasoningEffort::High),
    )
    .expect("sonnet dated snapshot accepts high");
    let error = validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-sonnet-4-6-20260217",
        Some(ReasoningEffort::Xhigh),
    )
    .expect_err("the sonnet family map has no xhigh tier");
    assert!(
        error.to_string().contains("claude-sonnet-4-6-20260217"),
        "{error:#}"
    );
}

#[test]
fn unknown_models_keep_the_conservative_provider_default_rejection() {
    // Unknown Anthropic models: only `none` (omission) is accepted.
    validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-never-seen-2099",
        Some(ReasoningEffort::None),
    )
    .expect("none stays safe for unknown Anthropic models");
    for effort in [
        ReasoningEffort::Minimal,
        ReasoningEffort::Low,
        ReasoningEffort::Medium,
        ReasoningEffort::High,
        ReasoningEffort::Xhigh,
    ] {
        validate_model_reasoning_effort(
            BackendKind::AnthropicMessages,
            "claude-never-seen-2099",
            Some(effort),
        )
        .expect_err("unknown Anthropic models stay conservative");
    }

    // Unknown deepseek models keep the provider default map.
    validate_model_reasoning_effort(
        BackendKind::DeepSeekChat,
        "deepseek-never-seen",
        Some(ReasoningEffort::Xhigh),
    )
    .expect("the provider default allows xhigh");
    validate_model_reasoning_effort(
        BackendKind::DeepSeekChat,
        "deepseek-never-seen",
        Some(ReasoningEffort::Low),
    )
    .expect_err("the provider default rejects low");

    // Arcee rejects every explicit effort, including none.
    validate_model_reasoning_effort(
        BackendKind::ArceeApi,
        "arcee-never-seen",
        Some(ReasoningEffort::None),
    )
    .expect_err("arcee accepts no explicit effort levels");
}

#[test]
fn user_override_thinking_map_relaxes_validation_and_wire_end_to_end() {
    // The S4 unlock, end to end: a `$NAC_HOME/models.json` override relaxes
    // a model's effort levels; validation and the adapter wire value both
    // follow the overridden data. Pre-S4, the hardcoded matrix rejected
    // every non-none effort for claude-haiku-4-5.
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new("s4-unlock");
    std::fs::write(
        env.home.join("models.json"),
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
    set_env_layers_for_test(true);
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

    // The adapter emits the override's wire value.
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
    )
    .unwrap();
    assert_eq!(request["thinking"], serde_json::json!({"type": "adaptive"}));
    assert_eq!(request["output_config"], serde_json::json!({"effort": "high"}));
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
