//! Golden tests: the recorded models.dev fixture must regenerate the
//! checked-in nac-core baseline byte-for-byte. Schema drift or mapping
//! changes fail loudly here at regen time — after a deliberate live regen,
//! re-record `fixtures/models-dev-api.json` from the same payload (the
//! binary's `--save-raw` option) and review the catalog diff together.

use nac_catalog_gen as gen;
use std::path::PathBuf;

const FIXTURE: &str = include_str!("../fixtures/models-dev-api.json");
const OVERRIDES: &str = include_str!("../overrides.toml");

fn checked_in_catalog() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../nac-core/src/model/catalog/data/catalog.json");
    std::fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("reading {}: {error}", path.display()))
}

#[test]
fn recorded_fixture_regenerates_the_checked_in_catalog() {
    let generation = gen::generate(FIXTURE, OVERRIDES).expect("fixture generates");
    assert_eq!(
        generation.catalog_json,
        checked_in_catalog(),
        "fixture regeneration differs from the checked-in catalog — regen \
         deliberately, review the diff, and re-record the fixture"
    );
}

#[test]
fn golden_output_covers_the_five_models_dev_providers() {
    let generation = gen::generate(FIXTURE, OVERRIDES).expect("fixture generates");
    let providers: Vec<&str> = generation.catalog.providers.keys().map(String::as_str).collect();
    assert_eq!(
        providers,
        [
            "anthropic-messages",
            "deepseek-chat",
            "fireworks-chat",
            "openai-responses",
            "together-chat"
        ]
    );
    let total: usize = generation
        .catalog
        .providers
        .values()
        .map(|provider| provider.models.len())
        .sum();
    assert_eq!(total, 117, "models.dev snapshot model count drifted");
}

#[test]
fn golden_output_satisfies_catalog_invariants() {
    let generation = gen::generate(FIXTURE, OVERRIDES).expect("fixture generates");
    for (provider, doc) in &generation.catalog.providers {
        for (id, model) in &doc.models {
            assert!(!id.is_empty(), "{provider}");
            assert!(model.context_window > 0, "{provider}/{id}");
            assert!(model.max_tokens > 0, "{provider}/{id}");
            assert!(
                model.max_tokens <= model.context_window,
                "{provider}/{id}: max_tokens {} exceeds context_window {}",
                model.max_tokens,
                model.context_window
            );
            for rate in [
                model.cost.input,
                model.cost.output,
                model.cost.cache_read,
                model.cost.cache_write,
            ] {
                assert!(rate >= 0.0, "{provider}/{id}: negative rate {rate}");
            }
            for (effort, wire) in &model.thinking_level_map {
                assert!(gen::EFFORT_NAMES.contains(&effort.as_str()), "{provider}/{id}: {effort}");
                if let Some(wire) = wire {
                    assert!(!wire.is_empty(), "{provider}/{id}: empty wire for {effort}");
                }
            }
        }
    }
}

#[test]
fn manifest_hash_matches_the_generated_bytes() {
    let generation = gen::generate(FIXTURE, OVERRIDES).expect("fixture generates");
    let manifest = gen::manifest(&generation.catalog, &generation.catalog_json, "fixture", None);
    assert_eq!(
        manifest.sha256,
        gen::hex_sha256(generation.catalog_json.as_bytes())
    );
    assert_eq!(manifest.model_counts.len(), 5);
}
