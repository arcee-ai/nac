//! Checked-in generated baseline (S1).
//!
//! `catalog.json` is emitted by `cargo run -p nac-catalog-gen` from a
//! models.dev snapshot plus the curated `overrides.toml` matrix
//! transcription, and is loaded here via `include_str!` — no build-time or
//! runtime network, so `--locked`/offline builds stay hermetic. The
//! hand-written seed catalog remains the source of every provider's
//! `_default` entry (and the never-fail fallback if the embedded JSON ever
//! failed to parse); generated data only adds per-model entries for the
//! five models.dev providers.
//!
//! Record shape per model (the generator's `ModelDoc` contract):
//! `display_name`, `context_window`, `max_tokens`, `cost` rates,
//! `reasoning`, `thinking_level_map`. `provider`/`api` are hydrated from
//! the provider key and `compat` is inherited from the provider's seed
//! default, so known and unknown models of a provider stay identical at
//! adapter-consolidation time (S6). `cache_write_1h` is not models.dev
//! data; S3's cost computation applies the 2x-input default when `None`.

use super::{api_kind_for, ModelCatalog, ModelMetadata, ModelSource};
use crate::model::BackendKind;
use serde::Deserialize;
use std::collections::BTreeMap;

/// The embedded generated baseline.
pub(crate) const GENERATED_CATALOG_JSON: &str = include_str!("data/catalog.json");
/// The sidecar manifest. Test-only until S2's overlay refresh reads the
/// models.dev ETag for revalidation.
#[cfg(test)]
pub(crate) const GENERATED_MANIFEST_JSON: &str = include_str!("data/catalog.manifest.json");

#[derive(Debug, Deserialize)]
struct GeneratedCatalog {
    providers: BTreeMap<BackendKind, GeneratedProvider>,
}

#[derive(Debug, Deserialize)]
struct GeneratedProvider {
    models: BTreeMap<String, GeneratedModel>,
}

#[derive(Debug, Deserialize)]
struct GeneratedModel {
    #[serde(default)]
    display_name: Option<String>,
    context_window: u64,
    max_tokens: u64,
    #[serde(default)]
    cost: super::ModelCostRates,
    #[serde(default)]
    reasoning: bool,
    #[serde(default)]
    thinking_level_map: super::ThinkingLevelMap,
}

/// Sidecar manifest fields the catalog tests pin to the embedded JSON.
#[cfg(test)]
#[derive(Debug, Deserialize)]
pub(crate) struct GeneratedManifest {
    pub(crate) sha256: String,
    #[allow(dead_code)] // documented provenance; asserted in later stages
    pub(crate) generated_at: String,
    #[allow(dead_code)] // S2's overlay refresh revalidates with this ETag
    pub(crate) models_dev_etag: Option<String>,
}

#[cfg(test)]
pub(crate) fn parse_manifest() -> Result<GeneratedManifest, serde_json::Error> {
    serde_json::from_str(GENERATED_MANIFEST_JSON)
}

/// Merge the embedded generated baseline over the seed catalog. Never
/// fails: a corrupt checked-in file degrades to seed-only resolution
/// (caught loudly by the catalog tests, never at runtime).
pub(super) fn merge_generated_baseline(catalog: &mut ModelCatalog) {
    let generated: GeneratedCatalog = match serde_json::from_str(GENERATED_CATALOG_JSON) {
        Ok(parsed) => parsed,
        Err(_) => {
            debug_assert!(false, "checked-in generated catalog must parse");
            return;
        }
    };
    for (provider, generated_provider) in generated.providers {
        let Some(provider_catalog) = catalog.providers.get_mut(&provider) else {
            debug_assert!(false, "generated provider {provider} must have a seed default");
            continue;
        };
        for (id, entry) in generated_provider.models {
            let metadata = ModelMetadata {
                id,
                provider,
                api: api_kind_for(provider),
                display_name: entry.display_name,
                context_window: entry.context_window,
                max_tokens: entry.max_tokens,
                cost: entry.cost,
                cache_write_1h: None,
                reasoning: entry.reasoning,
                thinking_level_map: entry.thinking_level_map,
                compat: provider_catalog.default.compat.clone(),
                source: ModelSource::Baseline,
            };
            provider_catalog.models.insert(metadata.id.clone(), metadata);
        }
    }
}
