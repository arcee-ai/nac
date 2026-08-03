//! Provider/model catalog: metadata resolution with never-fail fallback.
//!
//! The baseline merges two checked-in sources: the hand-written seed
//! catalog (every provider's `_default` entry, transcribing the
//! `backend.rs` effort-validation matrix into data) and the generated
//! models.dev baseline (S1; per-model limits, cost rates and
//! matrix-conformant thinking maps for the five models.dev providers).
//! Later stages add a refreshed remote overlay plus user overrides (S2),
//! and rewire validation (S4) and adapter dispatch (S6) onto this
//! metadata. Resolution is synchronous and local-only — no network, no
//! credentials — so the session picker and resume paths stay
//! credential-free.

use crate::model::BackendKind;
use std::collections::BTreeMap;
use std::sync::{OnceLock, RwLock, RwLockReadGuard};

mod data;
mod seed;
#[cfg(test)]
mod tests;
mod types;

pub use types::{
    ApiKind, Compat, CompletionsThinkingFormat, ModelCostRates, ModelMetadata, ModelSource,
    ThinkingLevelMap, FALLBACK_CONTEXT_WINDOW, FALLBACK_MAX_TOKENS,
};

/// Well-known id of each provider's fallback entry.
pub(crate) const PROVIDER_DEFAULT_MODEL_ID: &str = "_default";

/// Wire protocol for a provider; the seed catalog's `api` assignments.
pub(crate) fn api_kind_for(provider: BackendKind) -> ApiKind {
    match provider {
        BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::TogetherChat
        | BackendKind::ArceeAuth
        | BackendKind::ArceeApi => ApiKind::OpenAiCompletions,
        BackendKind::OpenAiResponses => ApiKind::OpenAiResponses,
        BackendKind::ChatGptCodexResponses => ApiKind::ChatGptCodexResponses,
        BackendKind::AnthropicMessages => ApiKind::AnthropicMessages,
    }
}

#[derive(Debug)]
struct ProviderCatalog {
    default: ModelMetadata,
    models: BTreeMap<String, ModelMetadata>,
}

/// Local model metadata catalog. Resolution never fails for unknown models;
/// see [`ModelCatalog::resolve`].
#[derive(Debug)]
pub struct ModelCatalog {
    providers: BTreeMap<BackendKind, ProviderCatalog>,
}

impl ModelCatalog {
    /// Load from local sources only — never network, never credentials.
    /// The hand-written seed provides every provider's `_default` entry;
    /// the embedded generated baseline (S1) merges per-model entries on
    /// top. S2 layers the `$NAC_HOME` overlay and user overrides on top
    /// here.
    fn load() -> Self {
        let mut catalog = seed::seed_catalog();
        data::merge_generated_baseline(&mut catalog);
        catalog
    }

    /// Resolve metadata for `model` on `provider`: exact entry, then a
    /// dated-snapshot family match (`name-YYYYMMDD` → `name`, mirroring
    /// `backend.rs::anthropic_model_family`), then a clone of the provider's
    /// `_default` entry with the id swapped in (pi's buildFallbackModel
    /// pattern).
    pub fn resolve(&self, provider: BackendKind, model: &str) -> ModelMetadata {
        let Some(catalog) = self.providers.get(&provider) else {
            // Unreachable while every provider ships a seed `_default` entry;
            // resolution must still never fail.
            return ModelMetadata::sparse(
                provider,
                api_kind_for(provider),
                model,
                ModelSource::Fallback,
            );
        };
        if let Some(metadata) = catalog.models.get(model) {
            return metadata.clone();
        }
        if let Some(family) = dated_snapshot_family(model) {
            if let Some(metadata) = catalog.models.get(family) {
                let mut resolved = metadata.clone();
                resolved.id = model.to_string();
                return resolved;
            }
        }
        let mut resolved = catalog.default.clone();
        resolved.id = model.to_string();
        resolved.source = ModelSource::ProviderDefault;
        resolved
    }
}

/// Strip a `-YYYYMMDD` dated-snapshot suffix, the family-matching rule in
/// `backend.rs::anthropic_model_family`.
fn dated_snapshot_family(model: &str) -> Option<&str> {
    let (base, snapshot) = model.rsplit_once('-')?;
    (snapshot.len() == 8 && snapshot.bytes().all(|byte| byte.is_ascii_digit())).then_some(base)
}

static CATALOG: OnceLock<RwLock<ModelCatalog>> = OnceLock::new();

/// Read access to the process-global catalog. Initializes from local sources
/// on first use; recovers from lock poisoning (catalog data is immutable
/// between loads, so a poisoned lock still holds valid data).
pub(crate) fn current() -> RwLockReadGuard<'static, ModelCatalog> {
    CATALOG
        .get_or_init(|| RwLock::new(ModelCatalog::load()))
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Resolve via the process-global catalog. Never fails for unknown models.
pub(crate) fn resolve(provider: BackendKind, model: &str) -> ModelMetadata {
    current().resolve(provider, model)
}

/// Reload the process-global catalog from local sources. Test-isolation hook
/// (pair with `TEST_ENV_LOCK`); S2's overlay refresh will reuse this path.
#[cfg(test)]
pub(crate) fn reset_for_test() {
    let mut catalog = CATALOG
        .get_or_init(|| RwLock::new(ModelCatalog::load()))
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *catalog = ModelCatalog::load();
}
