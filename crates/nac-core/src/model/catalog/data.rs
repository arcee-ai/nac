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
//! `reasoning`, `thinking_level_map`; provider-level `credential_env_var`
//! (the conventional credential variable name) and `default_base_url` (the
//! provider endpoint default). `provider`/`api`
//! are hydrated from the provider key and `compat` is inherited from the
//! provider's seed default, so known and unknown models of a provider stay
//! identical at adapter-consolidation time (S6). `cache_write_1h` is not
//! models.dev data; S3's cost computation applies the 2x-input default
//! when `None`.
//!
//! The same record shape backs the S2 runtime overlay (`overlay.rs`), which
//! reuses [`hydrate_entry`] with `ModelSource::Overlay`.

use super::{api_kind_for, ModelCatalog, ModelMetadata, ModelSource};
use crate::model::BackendKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The embedded generated baseline.
pub(crate) const GENERATED_CATALOG_JSON: &str = include_str!("data/catalog.json");
/// The sidecar manifest: the overlay refresh revalidates models.dev with
/// the recorded ETag and the stale-overlay guard compares overlay
/// `generated_at` against the baseline's.
pub(crate) const GENERATED_MANIFEST_JSON: &str = include_str!("data/catalog.manifest.json");

#[derive(Debug, Deserialize)]
pub(super) struct GeneratedCatalog {
    pub(super) providers: BTreeMap<BackendKind, GeneratedProvider>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct GeneratedProvider {
    /// The provider's conventional credential env var name (models.dev
    /// `env`'s first entry; status-only metadata for the `/models` auth
    /// hint). Absent in older overlays — an absent value never erases the
    /// baseline's at merge time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) credential_env_var: Option<String>,
    /// Provider endpoint default (models.dev `api`, or the curated
    /// SDK-default URLs at gen time; the overlay carries the same mapping
    /// forward). Absent in older overlays — an absent value never erases
    /// the baseline's at merge time. Managed providers never carry one
    /// (their canonical URLs stay code-side).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) default_base_url: Option<String>,
    pub(super) models: BTreeMap<String, GeneratedModel>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(super) struct GeneratedModel {
    #[serde(default)]
    pub(super) display_name: Option<String>,
    pub(super) context_window: u64,
    pub(super) max_tokens: u64,
    #[serde(default)]
    pub(super) cost: super::ModelCostRates,
    #[serde(default)]
    pub(super) reasoning: bool,
    #[serde(default)]
    pub(super) thinking_level_map: super::ThinkingLevelMap,
}

/// Sidecar manifest fields: the sha pins the embedded pair (tests), the
/// timestamp drives the stale-overlay guard, and the ETag seeds overlay
/// revalidation when no sidecar exists yet.
#[derive(Debug, Deserialize)]
pub(crate) struct GeneratedManifest {
    #[allow(dead_code)] // asserted by the manifest hash test only
    pub(crate) sha256: String,
    pub(crate) generated_at: String,
    pub(crate) models_dev_etag: Option<String>,
}

pub(crate) fn parse_manifest() -> Result<GeneratedManifest, serde_json::Error> {
    serde_json::from_str(GENERATED_MANIFEST_JSON)
}

/// Hydrate a generated/overlay record into full metadata: provider and api
/// come from the provider key, `compat` is inherited from the provider's
/// seed default (known and unknown models stay identical for S6), and
/// `cache_write_1h` stays unset (S3 applies the 2x-input default).
pub(super) fn hydrate_entry(
    provider: BackendKind,
    id: String,
    entry: GeneratedModel,
    compat: &super::Compat,
    source: ModelSource,
) -> ModelMetadata {
    ModelMetadata {
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
        compat: compat.clone(),
        source,
    }
}

/// Hydrate-and-insert one provider's generated records (baseline or
/// overlay): `compat` comes from the provider's seed default so known and
/// unknown models of a provider stay identical. A present
/// `credential_env_var` upgrades the provider's conventional-name metadata;
/// an absent one never erases it.
pub(super) fn merge_entries(
    catalog: &mut ModelCatalog,
    provider: BackendKind,
    generated: GeneratedProvider,
    source: ModelSource,
) {
    let Some(provider_catalog) = catalog.providers.get_mut(&provider) else {
        debug_assert!(
            false,
            "generated provider {provider} must have a seed default"
        );
        return;
    };
    if let Some(credential_env_var) = generated.credential_env_var {
        provider_catalog.credential_env_var = Some(credential_env_var);
    }
    if generated.default_base_url.is_some() {
        provider_catalog.default_base_url = generated.default_base_url;
    }
    let compat = provider_catalog.default.compat.clone();
    if source == ModelSource::Overlay {
        let ids = generated
            .models
            .keys()
            .cloned()
            .collect::<std::collections::BTreeSet<_>>();
        provider_catalog
            .models
            .retain(|id, metadata| metadata.source != ModelSource::Baseline || ids.contains(id));
    }
    for (id, entry) in generated.models {
        let metadata = hydrate_entry(provider, id, entry, &compat, source);
        provider_catalog
            .models
            .insert(metadata.id.clone(), metadata);
    }
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
        merge_entries(catalog, provider, generated_provider, ModelSource::Baseline);
    }
}
