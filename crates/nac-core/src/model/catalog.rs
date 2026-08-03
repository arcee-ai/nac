//! Provider/model catalog: metadata resolution with never-fail fallback.
//!
//! The catalog layers four local sources, lowest precedence first:
//!
//! 1. the hand-written seed catalog (every provider's `_default` entry,
//!    transcribing the `backend.rs` effort-validation matrix into data);
//! 2. the generated models.dev baseline (S1; per-model limits, cost rates
//!    and matrix-conformant thinking maps for the five models.dev
//!    providers), embedded via `include_str!`;
//! 3. the runtime overlay (S2): `$NAC_HOME/model-catalog/overlay.json`,
//!    refreshed in the background from models.dev — see `overlay.rs`;
//! 4. user overrides (S2): `$NAC_HOME/models.json` — see
//!    `user_overrides.rs`.
//!
//! Unknown models fall back to a clone of the provider's `_default` entry
//! (pi's buildFallbackModel pattern). Resolution is synchronous and
//! local-only — no network, no credentials — so the session picker and
//! resume paths stay credential-free; the overlay refresh only ever runs
//! as a fire-and-forget task spawned from server/CLI startup. Later stages
//! rewire validation (S4) and adapter dispatch (S6) onto this metadata.

use crate::model::BackendKind;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{OnceLock, RwLock, RwLockReadGuard};

mod data;
mod overlay;
#[cfg(test)]
mod overlay_tests;
mod seed;
#[cfg(test)]
mod tests;
mod types;
#[cfg(test)]
mod user_override_tests;
mod user_overrides;

pub use overlay::spawn_overlay_refresh;
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

/// Non-fatal catalog load diagnostics. Loading never fails on the
/// machine-state layers (overlay, user overrides); problems surface as
/// warnings printed once per load (`nac: model catalog: ...`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CatalogWarning {
    OverlayUnreadable { path: PathBuf, error: String },
    OverlayCorrupt { path: PathBuf, error: String },
    OverlayStale {
        path: PathBuf,
        overlay_generated_at: String,
        baseline_generated_at: String,
    },
    OverlayEntrySkipped { provider: String, reason: String },
    UserOverridesMalformed { path: PathBuf, error: String },
    UserOverrideSkipped { index: usize, reason: String },
}

impl std::fmt::Display for CatalogWarning {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OverlayUnreadable { path, error } => write!(
                formatter,
                "cannot read catalog overlay {}: {error} (embedded baseline stays active)",
                path.display()
            ),
            Self::OverlayCorrupt { path, error } => write!(
                formatter,
                "ignoring corrupt catalog overlay {}: {error} (embedded baseline stays active)",
                path.display()
            ),
            Self::OverlayStale {
                path,
                overlay_generated_at,
                baseline_generated_at,
            } => write!(
                formatter,
                "ignoring catalog overlay {}: generated {overlay_generated_at}, older than \
                 the embedded baseline {baseline_generated_at}",
                path.display()
            ),
            Self::OverlayEntrySkipped { provider, reason } => {
                write!(formatter, "skipping catalog overlay provider '{provider}': {reason}")
            }
            Self::UserOverridesMalformed { path, error } => write!(
                formatter,
                "ignoring malformed user model overrides {}: {error}",
                path.display()
            ),
            Self::UserOverrideSkipped { index, reason } => {
                write!(formatter, "skipping user model override #{index}: {reason}")
            }
        }
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
    /// Prints any machine-state-layer warnings (overlay, user overrides)
    /// once per load.
    fn load() -> Self {
        let home = crate::paths::nac_home_dir();
        let (catalog, warnings) = Self::load_layered(home.as_deref(), env_layers_for_global());
        for warning in &warnings {
            eprintln!("nac: model catalog: {warning}");
        }
        catalog
    }

    /// Layered load from an explicit home directory with every layer
    /// applied. The testable core of [`ModelCatalog::load`]: tests drive
    /// this directly against temp homes, so they never touch the
    /// process-global catalog or the environment.
    #[cfg(test)]
    fn load_from_home(home: Option<&Path>) -> (Self, Vec<CatalogWarning>) {
        Self::load_layered(home, true)
    }

    fn load_layered(home: Option<&Path>, env_layers: bool) -> (Self, Vec<CatalogWarning>) {
        let mut catalog = seed::seed_catalog();
        let mut warnings = Vec::new();
        data::merge_generated_baseline(&mut catalog);
        if env_layers {
            if let Some(home) = home {
                overlay::merge_overlay(&mut catalog, home, &mut warnings);
                user_overrides::apply_user_overrides(&mut catalog, home, &mut warnings);
            }
        }
        (catalog, warnings)
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
pub(super) fn dated_snapshot_family(model: &str) -> Option<&str> {
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

/// Reload the process-global catalog from local sources. S2's overlay
/// refresh calls this after writing a new overlay; tests pair it with
/// `TEST_ENV_LOCK` for isolation.
pub(crate) fn reload() {
    let mut catalog = CATALOG
        .get_or_init(|| RwLock::new(ModelCatalog::load()))
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *catalog = ModelCatalog::load();
}

/// Reload the process-global catalog from local sources. Test-isolation hook
/// (pair with `TEST_ENV_LOCK`).
#[cfg(test)]
pub(crate) fn reset_for_test() {
    reload();
}

/// Whether the process-global catalog applies the machine-state layers
/// (overlay + user overrides) from NAC_HOME. Always on in production; in
/// nac-core's own test builds it defaults off so unrelated tests stay
/// hermetic against a developer's real `~/.config/nac` files — overlay and
/// refresh tests opt in via `set_env_layers_for_test` (under
/// `TEST_ENV_LOCK`). Tests that only need the layered load itself call
/// `ModelCatalog::load_from_home` with an explicit temp home instead.
#[cfg(not(test))]
fn env_layers_for_global() -> bool {
    true
}

#[cfg(test)]
fn env_layers_for_global() -> bool {
    ENV_LAYERS_FOR_GLOBAL.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(test)]
static ENV_LAYERS_FOR_GLOBAL: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Opt the process-global catalog into the machine-state layers for the
/// duration of a test; pair with `TEST_ENV_LOCK` and restore with `false`.
#[cfg(test)]
pub(crate) fn set_env_layers_for_test(enabled: bool) {
    ENV_LAYERS_FOR_GLOBAL.store(enabled, std::sync::atomic::Ordering::SeqCst);
}
