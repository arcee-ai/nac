//! User model overrides (S2): `$NAC_HOME/models.json`, applied last at
//! catalog load (precedence: user > overlay > baseline > provider-default
//! > fallback).
//!
//! Schema:
//! ```json
//! {
//!   "overrides": [
//!     {
//!       "provider": "anthropic-messages",
//!       "model": "claude-opus-4-6",
//!       "set": { "max_tokens": 65536, "thinking_level_map": { "high": "high" } }
//!     }
//!   ]
//! }
//! ```
//!
//! Exact-match v1: `model` is a literal id (or `_default` to patch a
//! provider's fallback entry). An unknown id derives its base metadata from
//! the dated-snapshot family entry or the provider default (pi's
//! buildFallbackModel pattern) before patching, so overriding a model the
//! catalog does not know yet is the supported self-unblock path. A
//! malformed file never breaks the catalog (typed warning + baseline), and
//! invalid entries are skipped individually with warnings.

use super::{
    CatalogWarning, ModelCatalog, ModelMetadata, ModelSource, ThinkingLevelMap,
    PROVIDER_DEFAULT_MODEL_ID,
};
use crate::model::BackendKind;
use serde::Deserialize;
use std::path::Path;

const USER_OVERRIDES_FILE_NAME: &str = "models.json";

/// Top level tolerates unknown keys (forward compatibility); each override
/// entry decodes individually so one bad entry cannot sink the rest.
#[derive(Debug, Deserialize)]
struct UserOverridesFile {
    #[serde(default)]
    overrides: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct UserOverrideEntry {
    provider: String,
    model: String,
    set: UserOverrideSet,
}

/// Partial metadata patch; every field is optional. `thinking_level_map`
/// replaces the whole map (the S4 unlock path: relaxing a model's effort
/// levels is a deliberate per-model edit).
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct UserOverrideSet {
    display_name: Option<String>,
    context_window: Option<u64>,
    max_tokens: Option<u64>,
    cost: Option<CostPatch>,
    cache_write_1h: Option<f64>,
    reasoning: Option<bool>,
    thinking_level_map: Option<ThinkingLevelMap>,
}

/// Patch-side cost rates. Base and tier buckets are optional: omitted base
/// buckets keep the resolved rates, and omitted tier buckets fill from that
/// merged base so user tiers stay complete rate sets.
#[derive(Debug, Deserialize)]
struct CostPatch {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
    tiers: Option<Vec<CostTierPatch>>,
}

#[derive(Debug, Deserialize)]
struct CostTierPatch {
    #[serde(default)]
    input_tokens_above: u64,
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
}

/// Apply `$NAC_HOME/models.json` over the catalog. Never fails: a missing
/// file is a no-op, a malformed file degrades to a typed warning, and
/// invalid entries are skipped individually.
pub(super) fn apply_user_overrides(
    catalog: &mut ModelCatalog,
    home: &Path,
    warnings: &mut Vec<CatalogWarning>,
) {
    let path = home.join(USER_OVERRIDES_FILE_NAME);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(CatalogWarning::UserOverridesMalformed {
                path,
                error: error.to_string(),
            });
            return;
        }
    };
    let file: UserOverridesFile = match serde_json::from_str(&raw) {
        Ok(file) => file,
        Err(error) => {
            warnings.push(CatalogWarning::UserOverridesMalformed {
                path,
                error: error.to_string(),
            });
            return;
        }
    };
    for (index, entry) in file.overrides.into_iter().enumerate() {
        if let Err(reason) = apply_one(catalog, entry) {
            warnings.push(CatalogWarning::UserOverrideSkipped { index, reason });
        }
    }
}

fn apply_one(catalog: &mut ModelCatalog, value: serde_json::Value) -> Result<(), String> {
    let entry: UserOverrideEntry = serde_json::from_value(value)
        .map_err(|error| format!("invalid override entry: {error}"))?;
    let provider: BackendKind = entry.provider.parse().map_err(|error: String| error)?;
    if entry.model.trim().is_empty() {
        return Err("empty model id".to_string());
    }
    let Some(provider_catalog) = catalog.providers.get_mut(&provider) else {
        return Err(format!("unknown provider '{}'", entry.provider));
    };

    // Base metadata: the exact entry, its dated-snapshot family, or the
    // provider default (unknown models get fallback-derived metadata) — the
    // shared resolution chain. `_default` resolves to the default entry
    // itself; the intermediate `source` is overwritten below either way.
    let mut metadata = provider_catalog.resolve_entry(&entry.model);

    let set = entry.set;
    if let Some(display_name) = set.display_name {
        metadata.display_name = Some(display_name);
    }
    if let Some(context_window) = set.context_window {
        metadata.context_window = context_window;
    }
    if let Some(max_tokens) = set.max_tokens {
        metadata.max_tokens = max_tokens;
    }
    if let Some(patch) = set.cost {
        let base = super::ModelCostRates {
            input: patch.input.unwrap_or(metadata.cost.input),
            output: patch.output.unwrap_or(metadata.cost.output),
            cache_read: patch.cache_read.unwrap_or(metadata.cost.cache_read),
            cache_write: patch.cache_write.unwrap_or(metadata.cost.cache_write),
            tiers: None,
        };
        // Three-state tiers: a patch without `tiers` keeps the entry's
        // existing tiers; an explicit `"tiers": []` clears them.
        let tiers = match patch.tiers {
            None => metadata.cost.tiers.take(),
            Some(tiers) => Some(
                tiers
                    .into_iter()
                    .map(|tier| super::CostTier {
                        input_tokens_above: tier.input_tokens_above,
                        input: tier.input.unwrap_or(base.input),
                        output: tier.output.unwrap_or(base.output),
                        cache_read: tier.cache_read.unwrap_or(base.cache_read),
                        cache_write: tier.cache_write.unwrap_or(base.cache_write),
                    })
                    .collect(),
            ),
        };
        metadata.cost = super::ModelCostRates { tiers, ..base };
    }
    if let Some(cache_write_1h) = set.cache_write_1h {
        metadata.cache_write_1h = Some(cache_write_1h);
    }
    if let Some(reasoning) = set.reasoning {
        metadata.reasoning = reasoning;
    }
    if let Some(thinking_level_map) = set.thinking_level_map {
        metadata.thinking_level_map = thinking_level_map;
    }

    validate(&metadata)?;
    metadata.source = ModelSource::UserOverride;
    if entry.model == PROVIDER_DEFAULT_MODEL_ID {
        provider_catalog.default = metadata;
    } else {
        provider_catalog.models.insert(entry.model, metadata);
    }
    Ok(())
}

/// The patched entry must keep the catalog invariants; violations skip the
/// override rather than poisoning resolution.
fn validate(metadata: &ModelMetadata) -> Result<(), String> {
    if metadata.context_window == 0 {
        return Err("context_window must be greater than zero".to_string());
    }
    if metadata.max_tokens == 0 {
        return Err("max_tokens must be greater than zero".to_string());
    }
    if metadata.max_tokens > metadata.context_window {
        return Err(format!(
            "max_tokens {} exceeds context_window {}",
            metadata.max_tokens, metadata.context_window
        ));
    }
    for (field, rate) in [
        ("input", metadata.cost.input),
        ("output", metadata.cost.output),
        ("cache_read", metadata.cost.cache_read),
        ("cache_write", metadata.cost.cache_write),
    ] {
        if !rate.is_finite() || rate < 0.0 {
            return Err(format!("invalid {field} rate {rate}"));
        }
    }
    for tier in metadata.cost.tiers.as_deref().unwrap_or(&[]) {
        for (field, rate) in [
            ("input", tier.input),
            ("output", tier.output),
            ("cache_read", tier.cache_read),
            ("cache_write", tier.cache_write),
        ] {
            if !rate.is_finite() || rate < 0.0 {
                return Err(format!(
                    "invalid tier {field} rate {rate} (above {} prompt tokens)",
                    tier.input_tokens_above
                ));
            }
        }
    }
    if let Some(rate) = metadata.cache_write_1h {
        if !rate.is_finite() || rate < 0.0 {
            return Err(format!("invalid cache_write_1h rate {rate}"));
        }
    }
    Ok(())
}
