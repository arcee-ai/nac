//! Effective-settings and effort-validation tests: selector rules, typed
//! configuration errors, and the catalog-driven validation contract.

use super::*;
use crate::TEST_ENV_LOCK;

#[test]
fn api_key_backends_validate_selectors_and_auto_select_the_conventional_var() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let names = [
        "OPENAI_API_KEY",
        "TOGETHER_API_KEY",
        "ANTHROPIC_API_KEY",
        "DEEPSEEK_API_KEY",
        "FIREWORKS_API_KEY",
        "ARCEE_API_KEY",
        "NAC_EXPLICIT_TEST_KEY",
    ];
    let original = names.map(|name| (name, std::env::var_os(name)));
    set_env("DEEPSEEK_API_KEY", None);
    set_env("FIREWORKS_API_KEY", None);
    set_env("ARCEE_API_KEY", None);
    set_env("OPENAI_API_KEY", Some("openai-selected"));
    set_env("TOGETHER_API_KEY", Some("together-selected"));
    set_env("ANTHROPIC_API_KEY", Some("anthropic-selected"));
    set_env("NAC_EXPLICIT_TEST_KEY", Some("selected-secret"));

    let backends = [
        (BackendKind::OpenAiResponses, "OPENAI_API_KEY"),
        (BackendKind::TogetherChat, "TOGETHER_API_KEY"),
        (BackendKind::AnthropicMessages, "ANTHROPIC_API_KEY"),
        (BackendKind::DeepSeekChat, "DEEPSEEK_API_KEY"),
        (BackendKind::FireworksChat, "FIREWORKS_API_KEY"),
        (BackendKind::ArceeApi, "ARCEE_API_KEY"),
    ];
    for (backend, conventional) in backends {
        // The guided missing-credential error names the provider's
        // conventional variable (auto-selection would have adopted it had
        // it been set).
        let missing = api_key_for_backend(backend, None)
            .expect_err("a missing selector must fail with the guided error");
        assert!(missing.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(
            missing.to_string().contains(&format!(
                "set the {conventional} environment variable or provide an API key variable in overrides"
            )),
            "{missing:#}"
        );

        let selected = api_key_for_backend(backend, Some("NAC_EXPLICIT_TEST_KEY"))
            .expect("explicit selector should be authoritative");
        assert_eq!(selected, "selected-secret");
    }

    // Auto-selection adopts the conventional variable when it is set;
    // managed backends never auto-select.
    assert_eq!(
        backend::auto_select_api_key_env(BackendKind::OpenAiResponses).as_deref(),
        Some("OPENAI_API_KEY")
    );
    assert_eq!(
        backend::auto_select_api_key_env(BackendKind::TogetherChat).as_deref(),
        Some("TOGETHER_API_KEY")
    );
    assert_eq!(
        backend::auto_select_api_key_env(BackendKind::DeepSeekChat),
        None,
        "DEEPSEEK_API_KEY is not set in this test's environment"
    );
    assert_eq!(
        backend::auto_select_api_key_env(BackendKind::ArceeAuth),
        None
    );
    assert_eq!(
        backend::auto_select_api_key_env(BackendKind::ChatGptCodexResponses),
        None
    );

    for (selector, expected) in [
        ("OPENAI_API_KEY", "openai-selected"),
        ("TOGETHER_API_KEY", "together-selected"),
        ("ANTHROPIC_API_KEY", "anthropic-selected"),
    ] {
        let selected = api_key_for_backend(BackendKind::OpenAiResponses, Some(selector))
            .expect("canonical variable names remain valid explicit selectors");
        assert_eq!(selected, expected);
    }

    for (name, value) in original {
        restore_env(name, value);
    }
}

#[test]
fn api_key_selector_validation_and_values_are_typed_configuration_errors() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let names = [
        "NAC_MISSING_TEST_KEY",
        "NAC_EMPTY_TEST_KEY",
        "NAC_SPACE_TEST_KEY",
    ];
    let original = names.map(|name| (name, std::env::var_os(name)));
    set_env("NAC_MISSING_TEST_KEY", None);
    set_env("NAC_EMPTY_TEST_KEY", Some(""));
    set_env("NAC_SPACE_TEST_KEY", Some("  \t "));

    let missing = api_key_for_backend(BackendKind::OpenAiResponses, None).unwrap_err();
    assert!(missing.downcast_ref::<ModelConfigurationError>().is_some());
    assert!(
        missing
            .to_string()
            .contains("set the OPENAI_API_KEY environment variable"),
        "{missing:#}"
    );
    for selector in [Some(""), Some("   ")] {
        let error = api_key_for_backend(BackendKind::OpenAiResponses, selector).unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("nonblank api_key_env"));
    }
    for selector in ["9INVALID", "HAS-DASH", " HAS_SPACE"] {
        let error =
            api_key_for_backend(BackendKind::OpenAiResponses, Some(selector)).unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains(selector));
        assert!(error.to_string().contains("[A-Za-z_][A-Za-z0-9_]*"));
    }
    for selector in names {
        let error =
            api_key_for_backend(BackendKind::OpenAiResponses, Some(selector)).unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains(selector));
        assert!(!error.to_string().contains("ambient-must-not-win"));
    }

    for (name, value) in original {
        restore_env(name, value);
    }
}

#[cfg(unix)]
#[test]
fn non_unicode_selected_api_key_is_a_typed_configuration_error() {
    use std::os::unix::ffi::OsStringExt;

    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let name = "NAC_NON_UNICODE_TEST_KEY";
    let original = std::env::var_os(name);
    unsafe { std::env::set_var(name, OsString::from_vec(vec![0xff, 0xfe])) };

    let error = api_key_for_backend(BackendKind::OpenAiResponses, Some(name)).unwrap_err();
    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
    assert!(error.to_string().contains(name));
    assert!(error.to_string().contains("non-Unicode"));

    restore_env(name, original);
}

#[test]
fn backend_kind_parses_and_serializes_explicit_arcee_modes() {
    for (raw, expected) in [
        ("arcee-auth", BackendKind::ArceeAuth),
        ("arcee-api", BackendKind::ArceeApi),
    ] {
        let parsed: BackendKind = serde_json::from_str(&format!("\"{raw}\"")).unwrap();
        assert_eq!(parsed, expected);
        assert_eq!(parsed.to_string(), raw);
        assert_eq!(
            serde_json::to_string(&parsed).unwrap(),
            format!("\"{raw}\"")
        );
    }
}

#[test]
fn removed_backend_names_require_settings_repair() {
    for raw in ["arcee", "auto"] {
        let error = serde_json::from_str::<BackendKind>(&format!("\"{raw}\""))
            .unwrap_err()
            .to_string();
        assert!(error.contains("unsupported backend"), "{error}");
        assert!(error.contains("settings repair required"), "{error}");
    }
}

#[test]
fn managed_backends_reject_any_present_api_key_selector() {
    for (backend, source) in [
        (BackendKind::ArceeAuth, "arcee_auth.json"),
        (
            BackendKind::ChatGptCodexResponses,
            "stored OAuth from auth.json",
        ),
    ] {
        for selector in ["MANAGED_KEY", "", "   ", " SURROUNDED_KEY "] {
            let error =
                validate_backend_api_key_env(backend, Some(selector))
            .expect_err("managed credentials must reject every present api_key_env");
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(source));
            assert!(error.to_string().contains("is not supported"));
        }
    }
}

#[test]
fn effective_settings_require_explicit_valid_model_tuple() {
    for (backend, model, base_url, expected) in [
        (
            None,
            Some("model".to_string()),
            Some("https://example.com".to_string()),
            "backend",
        ),
        (
            Some(BackendKind::OpenAiResponses),
            None,
            Some("https://example.com".to_string()),
            "model",
        ),
        (
            // A present invalid base URL is never replaced by a default.
            Some(BackendKind::OpenAiResponses),
            Some("model".to_string()),
            Some("not a url".to_string()),
            "base_url",
        ),
    ] {
        let error = EffectiveModelSettings::from_optional(
            backend,
            model,
            base_url,
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains(expected), "{error:#}");
    }
}

#[test]
fn managed_backends_materialize_only_absent_base_urls() {
    for (backend, expected) in [
        (
            BackendKind::ChatGptCodexResponses,
            CHATGPT_CODEX_CANONICAL_BASE_URL,
        ),
        (BackendKind::ArceeAuth, ARCEE_AUTH_CANONICAL_BASE_URL),
    ] {
        let materialized = EffectiveModelSettings::from_optional(
            Some(backend),
            Some("model".to_string()),
            None,
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect("managed backend should materialize its absent base URL");
        assert_eq!(materialized.base_url, expected);

        let configured = EffectiveModelSettings::from_optional(
            Some(backend),
            Some("model".to_string()),
            Some(expected.to_string()),
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect("matching configured managed base URL should remain accepted");
        assert_eq!(configured.base_url, expected);

        let error = EffectiveModelSettings::from_optional(
            Some(backend),
            Some("model".to_string()),
            Some("   ".to_string()),
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect_err("a present invalid base URL must not be replaced by the default");
        assert!(error.to_string().contains("must not be blank"), "{error:#}");
    }

    // Every API-key backend materializes its catalog endpoint default:
    // the five models.dev providers from models.dev `api`/curated
    // overrides (the anthropic default is the API ROOT — the adapter
    // appends "/v1/messages" itself), arcee-api from the hand-seed.
    for (backend, expected) in [
        (BackendKind::DeepSeekChat, "https://api.deepseek.com"),
        (
            BackendKind::FireworksChat,
            "https://api.fireworks.ai/inference/v1",
        ),
        (BackendKind::TogetherChat, "https://api.together.xyz/v1"),
        (BackendKind::OpenAiResponses, "https://api.openai.com/v1"),
        (BackendKind::AnthropicMessages, "https://api.anthropic.com"),
        (BackendKind::ArceeApi, "https://api.arcee.ai/api/v1"),
    ] {
        let materialized = EffectiveModelSettings::from_optional(
            Some(backend),
            Some("model".to_string()),
            None,
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect("the catalog default fills an absent base URL");
        assert_eq!(materialized.base_url, expected, "{backend}");

        // A caller-supplied value stays authoritative over the default.
        let explicit = EffectiveModelSettings::from_optional(
            Some(backend),
            Some("model".to_string()),
            Some("https://explicit.example/v1".to_string()),
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect("an explicit base URL remains accepted");
        assert_eq!(explicit.base_url, "https://explicit.example/v1", "{backend}");
    }
}

#[test]
fn effective_settings_reject_unsupported_reasoning_before_client_or_persistence() {
    let all = [
        ReasoningEffort::None,
        ReasoningEffort::Minimal,
        ReasoningEffort::Low,
        ReasoningEffort::Medium,
        ReasoningEffort::High,
        ReasoningEffort::Xhigh,
    ];
    let cases: &[(BackendKind, &str, &[ReasoningEffort])] = &[
        (
            BackendKind::DeepSeekChat,
            "model",
            &[
                ReasoningEffort::None,
                ReasoningEffort::High,
                ReasoningEffort::Xhigh,
            ],
        ),
        (
            BackendKind::FireworksChat,
            "model",
            &[
                ReasoningEffort::None,
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
            ],
        ),
        (
            BackendKind::TogetherChat,
            "model",
            &[
                ReasoningEffort::None,
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
            ],
        ),
        (BackendKind::OpenAiResponses, "model", &all),
        (BackendKind::ChatGptCodexResponses, "model", &all),
        (
            BackendKind::AnthropicMessages,
            "claude-opus-4-6",
            &[
                ReasoningEffort::None,
                ReasoningEffort::Low,
                ReasoningEffort::Medium,
                ReasoningEffort::High,
                ReasoningEffort::Xhigh,
            ],
        ),
        (BackendKind::ArceeAuth, "model", &[]),
        (BackendKind::ArceeApi, "model", &[]),
    ];

    for (backend, model, supported) in cases {
        EffectiveModelSettings::new(
            *backend,
            (*model).into(),
            "https://example.com/v1".into(),
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect("absent effort must be valid for every backend");
        for effort in all {
            let result = EffectiveModelSettings::new(
                *backend,
                (*model).into(),
                "https://example.com/v1".into(),
                Some(effort),
                None,
                std::collections::BTreeMap::new(),
            );
            if supported.contains(&effort) {
                result.unwrap_or_else(|error| {
                    panic!("{backend} rejected {}: {error:#}", effort.as_str())
                });
            } else {
                let error = result
                    .expect_err("unsupported effort must fail effective settings validation");
                assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
                assert!(error.to_string().contains(effort.as_str()), "{error:#}");
                assert!(error.to_string().contains(backend.as_str()), "{error:#}");
            }
        }
    }
}

#[test]
fn anthropic_reasoning_rejection_is_a_typed_configuration_error() {
    // Residue of the pre-S4 capability-matrix test: the per-family
    // accept/reject behavior it pinned is now guarded exhaustively against
    // the independent matrix transcription by the catalog guards
    // (catalog/tests.rs); what remains unique here is the typed-error
    // contract of a rejected Anthropic model/effort pair.
    let error = validate_model_reasoning_effort(
        BackendKind::AnthropicMessages,
        "claude-sonnet-4-6",
        Some(ReasoningEffort::Xhigh),
    )
    .expect_err("unsupported model/effort pair must fail");
    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
    assert!(error.to_string().contains("claude-sonnet-4-6"), "{error:#}");
    assert!(error.to_string().contains("xhigh"), "{error:#}");
}

#[test]
fn validation_error_messages_are_preserved_verbatim() {
    // S4 derives the "supported values" list from the model's catalog
    // map; the user-facing error strings are byte-identical to the
    // pre-S4 matrix errors.
    let cases: &[(BackendKind, &str, ReasoningEffort, &str)] = &[
        (
            BackendKind::DeepSeekChat,
            "model",
            ReasoningEffort::Low,
            "invalid model configuration: reasoning effort 'low' is not supported by backend 'deepseek-chat'; supported values: none, high, or xhigh",
        ),
        (
            BackendKind::FireworksChat,
            "model",
            ReasoningEffort::Xhigh,
            "invalid model configuration: reasoning effort 'xhigh' is not supported by backend 'fireworks-chat'; supported values: none, low, medium, or high",
        ),
        (
            BackendKind::TogetherChat,
            "model",
            ReasoningEffort::Minimal,
            "invalid model configuration: reasoning effort 'minimal' is not supported by backend 'together-chat'; supported values: none, low, medium, or high",
        ),
        (
            BackendKind::AnthropicMessages,
            "claude-opus-4-6",
            ReasoningEffort::Minimal,
            "invalid model configuration: reasoning effort 'minimal' is not supported by backend 'anthropic-messages' for Anthropic model 'claude-opus-4-6'; supported values: none, low, medium, high, or xhigh",
        ),
        (
            BackendKind::AnthropicMessages,
            "claude-sonnet-4-6",
            ReasoningEffort::Xhigh,
            "invalid model configuration: reasoning effort 'xhigh' is not supported by backend 'anthropic-messages' for Anthropic model 'claude-sonnet-4-6'; supported values: none, low, medium, or high",
        ),
        (
            BackendKind::AnthropicMessages,
            "claude-opus-4-5",
            ReasoningEffort::High,
            "invalid model configuration: reasoning effort 'high' is not supported by backend 'anthropic-messages' for Anthropic model 'claude-opus-4-5'; supported values: none only",
        ),
        (
            BackendKind::AnthropicMessages,
            "claude-opus-4-6-latest",
            ReasoningEffort::High,
            "invalid model configuration: reasoning effort 'high' is not supported by backend 'anthropic-messages' for Anthropic model 'claude-opus-4-6-latest'; supported values: none only",
        ),
        (
            BackendKind::ArceeAuth,
            "model",
            ReasoningEffort::None,
            "invalid model configuration: reasoning effort 'none' is not supported by backend 'arcee-auth'; supported values: no explicit effort levels",
        ),
    ];
    for (backend, model, effort, expected) in cases {
        let error = validate_model_reasoning_effort(*backend, model, Some(*effort))
            .expect_err("case must be rejected");
        assert_eq!(error.to_string(), *expected, "{backend} {model}");
    }
}

#[test]
fn adapters_translate_effort_through_the_catalog_map() {
    // The wire value comes from the passed catalog map, not from adapter
    // code: a custom map with non-standard wire tiers flows through
    // every completions/responses/anthropic builder. (requests.rs and
    // anthropic.rs carry no "max" literal; DeepSeek's and Anthropic's
    // top tiers are data.)
    let custom = ThinkingLevelMap(std::collections::BTreeMap::from([
        (ReasoningEffort::None, Some("none".to_string())),
        (ReasoningEffort::High, Some("tier-three".to_string())),
        (ReasoningEffort::Xhigh, Some("tier-four".to_string())),
    ]));
    let messages = [Message::User {
        content: "hi".to_string(),
    }];

    let deepseek = completions_chat_request(
        "m",
        Some(ReasoningEffort::Xhigh),
        &messages,
        &[],
        &custom,
        &test_resolved(BackendKind::DeepSeekChat, "m").compat,
    );
    assert_eq!(deepseek["thinking"], json!({"type": "enabled"}));
    assert_eq!(deepseek["reasoning_effort"], "tier-four");

    let fireworks = completions_chat_request(
        "m",
        Some(ReasoningEffort::High),
        &messages,
        &[],
        &custom,
        &test_resolved(BackendKind::FireworksChat, "m").compat,
    );
    assert_eq!(fireworks["reasoning_effort"], "tier-three");
    assert_eq!(fireworks["reasoning_history"], "preserved");

    let together = completions_chat_request(
        "m",
        Some(ReasoningEffort::High),
        &messages,
        &[],
        &custom,
        &test_resolved(BackendKind::TogetherChat, "m").compat,
    );
    assert_eq!(together["reasoning"], json!({"enabled": true}));
    assert_eq!(together["reasoning_effort"], "tier-three");

    let openai =
        openai_responses_request("m", Some(ReasoningEffort::Xhigh), &messages, &[], &custom);
    assert_eq!(openai["reasoning"]["effort"], "tier-four");

    // claude-opus-4-6 supports xhigh in the baseline catalog, so the
    // builder's defense-in-depth validation passes; the custom map then
    // drives the emitted wire tier.
    let anthropic = anthropic_messages_request(
        "claude-opus-4-6",
        Some(ReasoningEffort::Xhigh),
        &messages,
        &[],
        None,
        &custom,
        test_resolved(BackendKind::AnthropicMessages, "claude-opus-4-6").max_tokens,
    )
    .unwrap();
    assert_eq!(anthropic["thinking"], json!({"type": "adaptive"}));
    assert_eq!(anthropic["output_config"]["effort"], "tier-four");
}
