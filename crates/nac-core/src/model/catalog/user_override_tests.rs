//! S2 tests: `$NAC_HOME/models.json` user overrides — schema, merge
//! mechanics, per-entry resilience, and the full precedence chain. All
//! tests drive `ModelCatalog::load_from_home` against temp homes, so they
//! never touch the environment or the process-global catalog.

use super::test_support::{write_overlay, TempHome};
use super::*;
use crate::model::ReasoningEffort;

fn write_models_json(home: &TempHome, doc: serde_json::Value) {
    std::fs::write(
        home.path().join("models.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

#[test]
fn user_override_patches_an_exact_model() {
    let home = TempHome::new("exact-patch");
    write_models_json(
        &home,
        serde_json::json!({
            // Unknown top-level keys are tolerated (forward compatibility).
            "version": 1,
            "overrides": [
                {
                    "provider": "deepseek-chat",
                    "model": "deepseek-chat",
                    "set": { "max_tokens": 65_536, "display_name": "DeepSeek Chat (patched)" }
                }
            ]
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    let metadata = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(metadata.source, ModelSource::UserOverride);
    assert_eq!(metadata.max_tokens, 65_536);
    assert_eq!(
        metadata.display_name.as_deref(),
        Some("DeepSeek Chat (patched)")
    );
    // Untouched fields keep the baseline values.
    assert_eq!(metadata.context_window, 1_000_000);
    assert_eq!(metadata.cost.input, 0.14);
    assert_eq!(
        metadata
            .thinking_level_map
            .wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );
}

#[test]
fn precedence_user_beats_overlay_beats_baseline_beats_provider_default() {
    let home = TempHome::new("precedence");
    write_overlay(
        home.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": {
                "models": {
                    "deepseek-chat": { "context_window": 111_111, "max_tokens": 11_111 },
                    "deepseek-v4-flash": { "context_window": 222_222, "max_tokens": 22_222 }
                }
            }
        }),
    );
    write_models_json(
        &home,
        serde_json::json!({
            "overrides": [
                { "provider": "deepseek-chat", "model": "deepseek-chat", "set": { "max_tokens": 33_333 } }
            ]
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    // user > overlay > baseline
    let user = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(user.source, ModelSource::UserOverride);
    assert_eq!(user.max_tokens, 33_333);
    assert_eq!(
        user.context_window, 111_111,
        "overlay value survives under the user patch"
    );
    // overlay > baseline
    let overlay = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-v4-flash");
    assert_eq!(overlay.source, ModelSource::Overlay);
    assert_eq!(overlay.context_window, 222_222);
    // Missing baseline ids are retired by the provider snapshot.
    let baseline = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-v4-pro");
    assert_eq!(baseline.source, ModelSource::ProviderDefault);
    // provider default for unknown ids
    let unknown = catalog.resolve(BackendKind::DeepSeekChat, "never-seen-model");
    assert_eq!(unknown.source, ModelSource::ProviderDefault);
    assert_eq!(unknown.context_window, FALLBACK_CONTEXT_WINDOW);
}

#[test]
fn user_override_for_unknown_model_derives_from_provider_default() {
    let home = TempHome::new("unknown-model");
    write_models_json(
        &home,
        serde_json::json!({
            "overrides": [
                { "provider": "together-chat", "model": "brand-new-model", "set": { "max_tokens": 8_192 } }
            ]
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    let metadata = catalog.resolve(BackendKind::TogetherChat, "brand-new-model");
    assert_eq!(metadata.source, ModelSource::UserOverride);
    assert_eq!(metadata.max_tokens, 8_192);
    // Everything else derives from the provider default.
    assert_eq!(metadata.context_window, FALLBACK_CONTEXT_WINDOW);
    assert!(metadata
        .thinking_level_map
        .is_supported(ReasoningEffort::High));
    assert!(!metadata
        .thinking_level_map
        .is_supported(ReasoningEffort::Xhigh));
    assert_eq!(
        metadata.compat.completions_reasoning_field.as_deref(),
        Some("reasoning")
    );
}

#[test]
fn user_override_dated_snapshot_derives_from_the_family_entry() {
    let home = TempHome::new("family-derive");
    write_models_json(
        &home,
        serde_json::json!({
            "overrides": [
                {
                    "provider": "anthropic-messages",
                    "model": "claude-opus-4-6-20261225",
                    "set": { "max_tokens": 9_999 }
                }
            ]
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    let metadata = catalog.resolve(BackendKind::AnthropicMessages, "claude-opus-4-6-20261225");
    assert_eq!(metadata.source, ModelSource::UserOverride);
    assert_eq!(metadata.max_tokens, 9_999);
    // The family map (adaptive with the "max" tier) carries over.
    assert_eq!(
        metadata
            .thinking_level_map
            .wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );
}

#[test]
fn user_override_patches_the_provider_default() {
    let home = TempHome::new("patch-default");
    write_models_json(
        &home,
        serde_json::json!({
            "overrides": [
                {
                    "provider": "deepseek-chat",
                    "model": "_default",
                    "set": { "context_window": 64_000, "max_tokens": 8_000 }
                }
            ]
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    // Unknown models clone the patched default (the clone keeps the
    // ProviderDefault source: the id-swap synthesis is the provider-default
    // mechanism).
    let unknown = catalog.resolve(BackendKind::DeepSeekChat, "never-seen-model");
    assert_eq!(unknown.source, ModelSource::ProviderDefault);
    assert_eq!(unknown.context_window, 64_000);
    assert_eq!(unknown.max_tokens, 8_000);
    // Concrete baseline entries are untouched by the default patch.
    let known = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(known.source, ModelSource::Baseline);
    assert_eq!(known.context_window, 1_000_000);
}

#[test]
fn malformed_models_json_keeps_the_baseline_with_a_warning() {
    let home = TempHome::new("malformed-file");
    std::fs::write(home.path().join("models.json"), "not json {").unwrap();

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(
        matches!(warnings[0], CatalogWarning::UserOverridesMalformed { .. }),
        "{warnings:?}"
    );
    let metadata = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert_eq!(metadata.context_window, 1_000_000);
}

#[test]
fn invalid_override_entries_are_skipped_individually() {
    let home = TempHome::new("skip-invalid");
    write_models_json(
        &home,
        serde_json::json!({
            "overrides": [
                { "provider": "not-a-provider", "model": "x", "set": {} },
                { "provider": "deepseek-chat", "model": "deepseek-chat", "set": { "context_window": 100 } },
                { "provider": "deepseek-chat", "model": "deepseek-chat", "set": { "cost": { "input": -1.0 } } },
                { "provider": "deepseek-chat", "model": "deepseek-chat", "set": { "max_tokens": 12_345 } },
                { "provider": "deepseek-chat", "set": {} }
            ]
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    // Entries 0 (unknown provider), 1 (max_tokens 384000 > context_window
    // 100), 2 (negative rate) and 4 (missing model) are skipped; entry 3
    // applies.
    assert_eq!(warnings.len(), 4, "{warnings:?}");
    assert!(
        warnings
            .iter()
            .all(|w| matches!(w, CatalogWarning::UserOverrideSkipped { .. })),
        "{warnings:?}"
    );
    assert!(
        matches!(&warnings[0], CatalogWarning::UserOverrideSkipped { index, .. } if *index == 0),
        "{warnings:?}"
    );
    assert!(
        matches!(&warnings[3], CatalogWarning::UserOverrideSkipped { index, .. } if *index == 4),
        "{warnings:?}"
    );
    let metadata = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(metadata.source, ModelSource::UserOverride);
    assert_eq!(metadata.max_tokens, 12_345);
    assert_eq!(metadata.context_window, 1_000_000);
}
