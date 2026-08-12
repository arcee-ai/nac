//! Dynamic arcee model loading.
//!
//! Follows the overlay.rs pattern: a fire-and-forget background task
//! ([`spawn_arcee_model_refresh`]) fetches the arcee model list from the API
//! at startup, maps it to [`GeneratedModel`] records, writes a cache file to
//! `$NAC_HOME/model-catalog/arcee-overlay.json`, and reloads the process-global
//! catalog. The `arcee-overlay.sidecar` persists the last successful fetch
//! time, which gates the 4h refresh cadence (shared with the models.dev
//! overlay).
//!
//! Failure is always contained: offline, timeout, HTTP errors and missing
//! credentials leave any cached overlay and the seed models untouched (and do
//! not advance the sidecar clock, so the next process start retries). A corrupt
//! cache file is ignored at load with a typed warning.
//!
//! Auth priority: arcee-api (the `ARCEE_API_KEY` env var) is tried first — no
//! file I/O, no token refresh — then arcee-auth (stored login). The API returns
//! the same model list regardless of auth method, so one fetch populates both
//! `ArceeAuth` and `ArceeApi` backends.

use super::data::{GeneratedModel, GeneratedProvider};
use super::overlay::{
    atomic_replace, is_within_refresh_cadence, overlay_dir, read_sidecar, unix_now,
    write_sidecar, RefreshSidecar, REFRESH_TIMEOUT,
};
use super::{CatalogWarning, ModelCatalog, ModelSource};
use crate::model::{BackendKind, ReasoningEffort, ARCEE_AUTH_CANONICAL_BASE_URL};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const OVERLAY_FILE_NAME: &str = "arcee-overlay.json";
const SIDECAR_FILE_NAME: &str = "arcee-overlay.sidecar";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn arcee_overlay_json_path(home: &Path) -> PathBuf {
    overlay_dir(home).join(OVERLAY_FILE_NAME)
}

fn arcee_sidecar_path(home: &Path) -> PathBuf {
    overlay_dir(home).join(SIDECAR_FILE_NAME)
}

// ---------------------------------------------------------------------------
// Cache file format
// ---------------------------------------------------------------------------

/// One entry in the arcee overlay cache: a model id plus the
/// [`GeneratedModel`] fields (flattened for a flat JSON array).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct ArceeOverlayEntry {
    id: String,
    #[serde(flatten)]
    model: GeneratedModel,
}

// ---------------------------------------------------------------------------
// Refresh outcome
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ArceeRefreshOutcome {
    /// NAC_HOME is unresolvable; nowhere to persist the overlay.
    SkippedNoHome,
    /// The last successful fetch is younger than the cadence; no request
    /// was made.
    SkippedCadence,
    /// No arcee credentials are available (no `ARCEE_API_KEY` and no stored
    /// login). The user may configure credentials after the server starts.
    SkippedNoCredential,
    /// A new overlay was written and the process-global catalog reloaded.
    Updated { models: usize },
    /// Contained failure: any cached overlay and the seed models stay active.
    Failed { error: String },
}

// ---------------------------------------------------------------------------
// Refresh side: fetch from the arcee API and rewrite the overlay
// ---------------------------------------------------------------------------

/// One refresh attempt; the testable core of [`spawn_arcee_model_refresh`].
/// Reads and writes `$NAC_HOME/model-catalog/`.
pub(crate) async fn refresh_arcee_once() -> ArceeRefreshOutcome {
    let Some(home) = crate::paths::nac_home_dir() else {
        return ArceeRefreshOutcome::SkippedNoHome;
    };
    let now = unix_now();
    let sidecar_path = arcee_sidecar_path(&home);
    let sidecar: Option<RefreshSidecar> = read_sidecar(&sidecar_path);
    if let Some(sidecar) = &sidecar {
        if is_within_refresh_cadence(sidecar.fetched_at_unix, now) {
            return ArceeRefreshOutcome::SkippedCadence;
        }
    }

    let client = match reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .connect_timeout(REFRESH_TIMEOUT.min(Duration::from_secs(10)))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return ArceeRefreshOutcome::Failed {
                error: format!("building HTTP client: {error}"),
            };
        }
    };

    let body = match fetch_arcee_models(&client).await {
        Ok(Some(body)) => body,
        Ok(None) => return ArceeRefreshOutcome::SkippedNoCredential,
        Err(error) => return ArceeRefreshOutcome::Failed { error },
    };

    let entries = match map_arcee_api_response(&body) {
        Ok(entries) => entries,
        Err(error) => return ArceeRefreshOutcome::Failed { error },
    };

    let model_count = entries.len();
    let json = match serde_json::to_string_pretty(&entries) {
        Ok(json) => json + "\n",
        Err(error) => {
            return ArceeRefreshOutcome::Failed {
                error: format!("serializing arcee overlay: {error}"),
            };
        }
    };
    if let Err(error) = atomic_replace(&arcee_overlay_json_path(&home), &json) {
        return ArceeRefreshOutcome::Failed {
            error: format!("writing arcee overlay: {error}"),
        };
    }
    write_sidecar(
        &sidecar_path,
        &RefreshSidecar { fetched_at_unix: now },
        "arcee overlay",
    );
    super::reload();
    ArceeRefreshOutcome::Updated { models: model_count }
}

/// Fetch the arcee model list, trying arcee-api first then arcee-auth.
/// Returns `Ok(None)` when no credentials are available (not a failure).
async fn fetch_arcee_models(client: &reqwest::Client) -> Result<Option<String>, String> {
    // arcee-api: the env var is cheaper — no file I/O, no token refresh.
    if let Ok(api_key) = std::env::var("ARCEE_API_KEY") {
        if !api_key.trim().is_empty() {
            return Ok(Some(
                fetch_arcee_models_api_key(client, &api_key).await?,
            ));
        }
    }

    // arcee-auth: stored login (device-flow credential file).
    if crate::model::arcee::stored_credential_present() {
        return Ok(Some(
            fetch_arcee_models_managed(client).await?,
        ));
    }

    // No credentials configured yet — the user may log in after the server
    // starts. This is a skip, not a failure.
    Ok(None)
}

async fn fetch_arcee_models_api_key(
    client: &reqwest::Client,
    api_key: &str,
) -> Result<String, String> {
    let url = crate::model::arcee::models_url(ARCEE_AUTH_CANONICAL_BASE_URL)
        .map_err(|error| format!("building arcee models URL: {error}"))?;
    let response = client
        .get(url.as_str())
        .bearer_auth(api_key)
        .send()
        .await
        .map_err(|error| format!("fetching arcee models: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("fetching arcee models: HTTP {status}"));
    }
    response
        .text()
        .await
        .map_err(|error| format!("reading arcee models response body: {error}"))
}

async fn fetch_arcee_models_managed(client: &reqwest::Client) -> Result<String, String> {
    let auth = crate::model::arcee::read_stored_auth()
        .map_err(|error| format!("reading stored arcee auth: {error}"))?;
    let token = crate::model::arcee::fresh_access_token(client, &auth.base_url)
        .await
        .map_err(|error| format!("getting fresh arcee access token: {error}"))?;
    let url = crate::model::arcee::models_url(&auth.base_url)
        .map_err(|error| format!("building arcee models URL: {error}"))?;
    let response = client
        .get(url.as_str())
        .bearer_auth(token)
        .send()
        .await
        .map_err(|error| format!("fetching arcee models: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("fetching arcee models: HTTP {status}"));
    }
    response
        .text()
        .await
        .map_err(|error| format!("reading arcee models response body: {error}"))
}

// ---------------------------------------------------------------------------
// API response → GeneratedModel mapping
// ---------------------------------------------------------------------------

/// The subset of the arcee API `/v1/models` response that the overlay maps.
/// Tolerant: every field except `id` is optional so schema drift cannot break
/// a running nac.
#[derive(Debug, Deserialize)]
struct ArceeApiModel {
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    max_output_length: Option<u64>,
    #[serde(default)]
    pricing: Option<ArceeApiPricing>,
    #[serde(default)]
    supported_features: Option<Vec<String>>,
    #[serde(default)]
    supported_reasoning_efforts: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct ArceeApiPricing {
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    completion: Option<String>,
    #[serde(default)]
    input_cache_reads: Option<String>,
    #[serde(default)]
    input_cache_writes: Option<String>,
}

/// Map the arcee API `/v1/models` response body into overlay entries.
/// Tolerant at every level: the top level parses as generic JSON, the model
/// array is found under `data` or `models`, and per-model failures are
/// skipped with a stderr warning. An empty result is a hard error (nothing
/// is written then).
pub(super) fn map_arcee_api_response(body: &str) -> Result<Vec<ArceeOverlayEntry>, String> {
    let parsed: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("parsing arcee API response: {error}"))?;
    let items = parsed
        .get("data")
        .or_else(|| parsed.get("models"))
        .unwrap_or(&parsed)
        .as_array()
        .ok_or_else(|| "arcee API response has no model array".to_string())?;

    let mut entries = Vec::new();
    for item in items {
        match serde_json::from_value::<ArceeApiModel>(item.clone()) {
            Ok(model) => entries.push(map_arcee_model(&model)),
            Err(error) => {
                eprintln!(
                    "nac: model catalog: skipping arcee model entry: {error}"
                );
            }
        }
    }

    if entries.is_empty() {
        return Err("arcee API returned no usable models".to_string());
    }
    Ok(entries)
}

fn map_arcee_model(model: &ArceeApiModel) -> ArceeOverlayEntry {
    let context_window = model
        .context_length
        .filter(|&c| c > 0)
        .unwrap_or(super::FALLBACK_CONTEXT_WINDOW);
    let max_tokens = model
        .max_output_length
        .filter(|&m| m > 0)
        .unwrap_or_else(|| arcee_max_tokens_fallback(&model.id, context_window));
    let max_tokens = max_tokens.min(context_window);

    let pricing = model.pricing.as_ref();
    let cost = super::ModelCostRates {
        input: parse_pricing_rate(pricing.and_then(|p| p.prompt.as_deref())),
        output: parse_pricing_rate(pricing.and_then(|p| p.completion.as_deref())),
        cache_read: parse_pricing_rate(pricing.and_then(|p| p.input_cache_reads.as_deref())),
        cache_write: parse_pricing_rate(pricing.and_then(|p| p.input_cache_writes.as_deref())),
    };

    // Known passthrough models get a hardcoded effort map matching the
    // underlying model's capabilities (the arcee API's
    // `supported_reasoning_efforts` is always null, so the API-derived map
    // is always empty). Unknown models and trinity-large-thinking fall back
    // to the API-derived map (empty), so validation rejects every explicit
    // effort for them.
    let passthrough_map = passthrough_effort_map(&model.id);
    let thinking_level_map = passthrough_map
        .clone()
        .unwrap_or_else(|| map_reasoning_efforts(model.supported_reasoning_efforts.as_deref()));

    // Passthrough models always produce reasoning_content (confirmed via API
    // testing); the `supported_features` field is null for some of them
    // (minimax-m3, kimi-k3, deepseek-v4-flash-latest), so the features check
    // alone is unreliable. Any model with a passthrough effort map reasons.
    let reasoning = passthrough_map.is_some()
        || model
            .supported_features
            .as_ref()
            .is_some_and(|features| features.iter().any(|f| f == "reasoning"));

    ArceeOverlayEntry {
        id: model.id.clone(),
        model: GeneratedModel {
            display_name: model.name.clone(),
            context_window,
            max_tokens,
            cost,
            reasoning,
            thinking_level_map,
            adaptive_thinking: false,
            enabled_thinking: false,
            context_management: false,
            clear_thinking: false,
        },
    }
}

fn arcee_max_tokens_fallback(model_id: &str, context_window: u64) -> u64 {
    match model_id {
        "trinity-large-thinking" => 80_000,
        id if passthrough_effort_map(id).is_some() => {
            262_144.min((context_window / 2).max(1))
        }
        _ => super::FALLBACK_MAX_TOKENS,
    }
}

/// Parse a pricing string ($/token) from the API into a $/1M-tokens rate
/// (the unit `ModelCostRates` uses). Missing, empty, or unparseable values
/// degrade to 0.0 (unknown/zero-cost fallback).
fn parse_pricing_rate(value: Option<&str>) -> f64 {
    let s = value.unwrap_or("0");
    let per_token = s.parse::<f64>().unwrap_or(0.0);
    let per_million = per_token * 1_000_000.0;
    if !per_million.is_finite() || per_million < 0.0 {
        0.0
    } else {
        per_million
    }
}

/// Effort map for known arcee passthrough models. The arcee API's
/// `supported_reasoning_efforts` is always null, so the API-derived map is
/// always empty. These models pass through to the same underlying models
/// served by Fireworks/Together, but the arcee API accepts only a subset of
/// the effort levels that the upstream providers accept (confirmed via API
/// testing). The maps reflect what the arcee API actually honors.
///
/// Returns `None` for unknown models and trinity-large-thinking (arcee's own
/// model, which rejects all `reasoning_effort` values).
fn passthrough_effort_map(model_id: &str) -> Option<super::ThinkingLevelMap> {
    let entries: &[(ReasoningEffort, &str)] = match model_id {
        "deepseek-ai/deepseek-v4-pro" | "deepseek/deepseek-v4-flash-latest" => &[
            (ReasoningEffort::None, "none"),
            (ReasoningEffort::High, "high"),
            (ReasoningEffort::Max, "max"),
        ],
        "zai-org/glm-5.2" => &[
            (ReasoningEffort::None, "none"),
            (ReasoningEffort::High, "high"),
            (ReasoningEffort::Max, "max"),
        ],
        "moonshotai/kimi-k3" => &[
            (ReasoningEffort::Low, "low"),
            (ReasoningEffort::High, "high"),
            (ReasoningEffort::Max, "max"),
        ],
        "minimaxai/minimax-m3" => &[
            (ReasoningEffort::None, "none"),
            (ReasoningEffort::Max, "max"),
        ],
        _ => return None,
    };
    Some(super::ThinkingLevelMap(
        entries
            .iter()
            .map(|(effort, wire)| (*effort, Some((*wire).to_string())))
            .collect(),
    ))
}

/// Map the API's `supported_reasoning_efforts` array to a
/// [`ThinkingLevelMap`]. `None` (the common case for arcee) → empty map.
fn map_reasoning_efforts(efforts: Option<&[String]>) -> super::ThinkingLevelMap {
    let Some(efforts) = efforts else {
        return super::ThinkingLevelMap::default();
    };
    let mut map = BTreeMap::new();
    for effort in efforts {
        if let Some(reasoning_effort) = parse_effort(effort) {
            map.insert(reasoning_effort, Some(effort.clone()));
        }
    }
    super::ThinkingLevelMap(map)
}

fn parse_effort(s: &str) -> Option<ReasoningEffort> {
    match s {
        "none" => Some(ReasoningEffort::None),
        "minimal" => Some(ReasoningEffort::Minimal),
        "low" => Some(ReasoningEffort::Low),
        "medium" => Some(ReasoningEffort::Medium),
        "high" => Some(ReasoningEffort::High),
        "xhigh" => Some(ReasoningEffort::Xhigh),
        "max" => Some(ReasoningEffort::Max),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Load side: merge the cached overlay over the seed catalog
// ---------------------------------------------------------------------------

/// Merge the cached arcee overlay over the baseline. Never fails: missing
/// file → no-op; unreadable/corrupt → typed warning + seed models stay
/// active. Applied to both `ArceeAuth` and `ArceeApi` backends (the API
/// returns the same model list regardless of auth method).
pub(super) fn merge_arcee_overlay(
    catalog: &mut ModelCatalog,
    home: &Path,
    warnings: &mut Vec<CatalogWarning>,
) {
    let path = arcee_overlay_json_path(home);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(CatalogWarning::ArceeOverlayUnreadable {
                path,
                error: error.to_string(),
            });
            return;
        }
    };
    let entries: Vec<ArceeOverlayEntry> = match serde_json::from_str(&raw) {
        Ok(entries) => entries,
        Err(error) => {
            warnings.push(CatalogWarning::ArceeOverlayCorrupt {
                path,
                error: error.to_string(),
            });
            return;
        }
    };

    let mut models = BTreeMap::new();
    for mut entry in entries {
        if entry.model.max_tokens == super::FALLBACK_MAX_TOKENS {
            entry.model.max_tokens =
                arcee_max_tokens_fallback(&entry.id, entry.model.context_window);
        }
        models.insert(entry.id.clone(), entry.model);
    }

    // credential_env_var and default_base_url stay from the seed (None =
    // don't change). The same model set applies to both arcee backends.
    let generated = GeneratedProvider {
        credential_env_var: None,
        default_base_url: None,
        models,
    };
    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        super::data::merge_entries(catalog, backend, generated.clone(), ModelSource::Overlay);
    }
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

static REFRESH_SPAWNED: AtomicBool = AtomicBool::new(false);

/// Spawn the fire-and-forget arcee model refresh. Call once from server/CLI
/// startup inside a tokio runtime; repeat calls are no-ops and calls without
/// a runtime are ignored. NEVER call from resolution, picker, resume or
/// validation paths — those only read the catalog.
pub fn spawn_arcee_model_refresh() {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    if REFRESH_SPAWNED.swap(true, Ordering::SeqCst) {
        return;
    }
    handle.spawn(async move {
        match refresh_arcee_once().await {
            ArceeRefreshOutcome::Updated { models } => {
                eprintln!(
                    "nac: arcee model catalog updated from arcee API ({models} models)"
                );
            }
            ArceeRefreshOutcome::Failed { error } => {
                eprintln!("nac: arcee model catalog refresh failed: {error}");
            }
            ArceeRefreshOutcome::SkippedNoHome
            | ArceeRefreshOutcome::SkippedCadence
            | ArceeRefreshOutcome::SkippedNoCredential => {}
        }
    });
}
