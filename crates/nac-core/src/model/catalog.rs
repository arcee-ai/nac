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
//! as a fire-and-forget task spawned from server/CLI startup. Validation
//! (S4) and adapter effort translation read these maps; adapter dispatch
//! consolidation (S6) follows.

use crate::model::{managed_backend_base_url, BackendKind};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{OnceLock, RwLock, RwLockReadGuard};

mod auth_status;
#[cfg(test)]
mod auth_status_tests;
mod data;
mod overlay;
#[cfg(test)]
mod overlay_tests;
mod seed;
#[cfg(test)]
mod test_support;
#[cfg(test)]
mod tests;
mod types;
#[cfg(test)]
mod user_override_tests;
mod user_overrides;

pub use overlay::spawn_overlay_refresh;
pub use types::{
    ApiKind, AuthStatus, Compat, CompletionsThinkingFormat, DefaultLimits, ModelCostRates,
    ModelEntry, ModelListing, ModelMetadata, ModelSource, ProviderAuth, ProviderListing,
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
    OverlayUnreadable {
        path: PathBuf,
        error: String,
    },
    OverlayCorrupt {
        path: PathBuf,
        error: String,
    },
    OverlayStale {
        path: PathBuf,
        overlay_generated_at: String,
        baseline_generated_at: String,
    },
    OverlayEntrySkipped {
        provider: String,
        reason: String,
    },
    UserOverridesMalformed {
        path: PathBuf,
        error: String,
    },
    UserOverrideSkipped {
        index: usize,
        reason: String,
    },
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
                write!(
                    formatter,
                    "skipping catalog overlay provider '{provider}': {reason}"
                )
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
    /// The provider's conventional credential env var name: the generated
    /// baseline owns the five models.dev providers' names, the seed
    /// hand-maintains arcee-api's, and a present overlay value upgrades.
    /// Managed providers carry `None` (their hint is the login command).
    /// Powers the `/models` auth-status hint and the conventional-var
    /// auto-selection in `EffectiveModelSettings`.
    credential_env_var: Option<String>,
    /// The provider's endpoint default: the generated baseline/overlay
    /// layers carry the five models.dev providers' URLs (models.dev `api`
    /// or the curated SDK-default URL) and the seed hand-maintains
    /// arcee-api's. Managed providers carry `None` (their canonical URLs
    /// stay code-side, `managed_backend_base_url`). Fills a genuinely
    /// absent request `base_url` in `resolve_model_base_url`.
    default_base_url: Option<String>,
}

impl ProviderCatalog {
    /// The single implementation of the resolution chain: exact entry, then
    /// a dated-snapshot family match (`name-YYYYMMDD` → `name`, the pre-S4
    /// `backend.rs` Anthropic family rule, now generic), then a clone of the
    /// provider's `_default` entry with the id swapped in and `source`
    /// re-marked `ProviderDefault` (pi's buildFallbackModel pattern).
    /// `ModelCatalog::resolve`, user overrides and the overlay's seed-map
    /// lookup all share it.
    fn resolve_entry(&self, model: &str) -> ModelMetadata {
        if let Some(metadata) = self.models.get(model) {
            return metadata.clone();
        }
        if let Some(family) = dated_snapshot_family(model) {
            if let Some(metadata) = self.models.get(family) {
                let mut resolved = metadata.clone();
                resolved.id = model.to_string();
                return resolved;
            }
        }
        let mut resolved = self.default.clone();
        resolved.id = model.to_string();
        resolved.source = ModelSource::ProviderDefault;
        resolved
    }
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

    /// The provider's catalog endpoint default, when any applied layer
    /// carries one (the five models.dev providers and arcee-api; managed
    /// providers have none).
    pub fn default_base_url(&self, provider: BackendKind) -> Option<String> {
        self.providers.get(&provider)?.default_base_url.clone()
    }

    /// The provider's conventional credential env var name, when any
    /// applied layer carries one (the six API-key providers; managed
    /// providers have none).
    pub fn credential_env_var(&self, provider: BackendKind) -> Option<String> {
        self.providers.get(&provider)?.credential_env_var.clone()
    }

    /// Resolve a model id to its provider by exact catalog entry match:
    /// the unique provider carrying a real entry (Baseline/Overlay/
    /// UserOverride) with that id wins. A collision (the same id on
    /// several providers — the hand-seeded arcee pair shares the Trinity
    /// ids, and the codex seed overlaps the openai baseline) prefers the
    /// first non-managed provider with a warning. Unknown ids resolve to
    /// `None` (the caller renders them unrecognized).
    pub fn provider_for_model(&self, model: &str) -> Option<BackendKind> {
        let matches: Vec<BackendKind> = self
            .providers
            .iter()
            .filter(|(_, provider)| provider.models.contains_key(model))
            .map(|(provider, _)| *provider)
            .collect();
        match matches.as_slice() {
            [] => None,
            [only] => Some(*only),
            [first, ..] => {
                let chosen = matches
                    .iter()
                    .find(|provider| managed_backend_base_url(**provider).is_none())
                    .unwrap_or(first);
                eprintln!(
                    "nac: model catalog: model id '{model}' exists on multiple providers ({}); resolving to '{chosen}'",
                    matches
                        .iter()
                        .map(|provider| provider.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
                Some(*chosen)
            }
        }
    }

    /// Resolve metadata for `model` on `provider` through
    /// [`ProviderCatalog::resolve_entry`]; never fails for unknown models.
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
        catalog.resolve_entry(model)
    }
}

/// Strip a `-YYYYMMDD` dated-snapshot suffix — the family-matching rule
/// `backend.rs` used for Anthropic families before S4, now generic over
/// every provider's catalog entries.
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

/// The provider's catalog endpoint default via the process-global catalog.
/// Read by `resolve_model_base_url` after the request merge, so an
/// explicit `base_url` always beats the generated default.
pub(crate) fn default_base_url(provider: BackendKind) -> Option<String> {
    current().default_base_url(provider)
}

/// The provider's conventional credential env var name via the
/// process-global catalog. Read by the conventional-var auto-selection
/// and the guided missing-credential error.
pub(crate) fn credential_env_var(provider: BackendKind) -> Option<String> {
    current().credential_env_var(provider)
}

/// Resolve a model id to its provider via the process-global catalog
/// (exact match; collisions prefer the non-managed provider with a
/// warning; unknown ids resolve to `None`).
pub fn provider_for_model(model: &str) -> Option<BackendKind> {
    current().provider_for_model(model)
}

/// The seed + generated-baseline catalog without any machine-state layer:
/// the overlay refresh's mapping reference (thinking maps and provider
/// endpoint defaults derive from it, reproducing the generator's
/// `overrides.toml` application).
pub(super) fn baseline_catalog() -> ModelCatalog {
    let mut catalog = seed::seed_catalog();
    data::merge_generated_baseline(&mut catalog);
    catalog
}

/// Monotonic version of the process-global catalog; `reload` bumps it after
/// every swap, so an overlay-refresh reload is observable to `/models`
/// clients. The initial load is version 1.
static CATALOG_VERSION: AtomicU64 = AtomicU64::new(1);

fn catalog_version() -> u64 {
    CATALOG_VERSION.load(Ordering::SeqCst)
}

/// Auth requirements for a provider, derived from the same split
/// `validate_backend_api_key_env` enforces.
fn provider_auth(provider: BackendKind) -> ProviderAuth {
    if crate::model::backend::api_key_backend(provider) {
        return ProviderAuth::ApiKeyEnv;
    }
    match provider {
        BackendKind::ArceeAuth => ProviderAuth::ManagedArcee,
        BackendKind::ChatGptCodexResponses => ProviderAuth::CodexOauth,
        other => unreachable!("non-API-key backend '{other}' has managed auth"),
    }
}

/// Build the `GET /models` listing from the process-global catalog: every
/// provider with its auth requirements, managed base URL, catalog endpoint
/// default, `_default` limits and real entries. Synthesis products
/// (ProviderDefault/Fallback) never enter the `models` map by construction;
/// the source filter pins that contract at the boundary. Synchronous and
/// local-only, like resolution.
///
/// `auth_status`/`auth_hint` are computed per call from the process
/// environment and the managed credential files (never baked into the
/// catalog): an API-key provider reads ready when its conventional
/// credential variable is set — the same variable session resolution
/// auto-selects.
pub fn api_listing() -> ModelListing {
    let catalog = current();
    let providers = catalog
        .providers
        .iter()
        .map(|(provider, provider_catalog)| {
            let (auth_status, auth_hint) = auth_status::provider_auth_status(
                *provider,
                provider_catalog.credential_env_var.as_deref(),
            );
            ProviderListing {
                id: *provider,
                auth: provider_auth(*provider),
                auth_status,
                auth_hint,
                managed_base_url: managed_backend_base_url(*provider).map(str::to_string),
                default_base_url: provider_catalog.default_base_url.clone(),
                default_limits: DefaultLimits {
                    context_window: provider_catalog.default.context_window,
                    max_tokens: provider_catalog.default.max_tokens,
                    supported_efforts: provider_catalog
                        .default
                        .thinking_level_map
                        .supported_efforts(),
                },
                models: provider_catalog
                    .models
                    .values()
                    .filter(|metadata| {
                        matches!(
                            metadata.source,
                            ModelSource::Baseline
                                | ModelSource::Overlay
                                | ModelSource::UserOverride
                        )
                    })
                    .map(|metadata| ModelEntry {
                        id: metadata.id.clone(),
                        display_name: metadata.display_name.clone(),
                        context_window: metadata.context_window,
                        max_tokens: metadata.max_tokens,
                        cost: metadata.cost,
                        reasoning: metadata.reasoning,
                        supported_efforts: metadata.thinking_level_map.supported_efforts(),
                        source: metadata.source,
                    })
                    .collect(),
            }
        })
        .collect();
    ModelListing {
        catalog_version: catalog_version(),
        providers,
    }
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
    CATALOG_VERSION.fetch_add(1, Ordering::SeqCst);
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
