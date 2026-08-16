//! Dynamic Anthropic model capability overlay.
//!
//! Follows the arcee_overlay pattern: a fire-and-forget background task
//! ([`spawn_anthropic_model_refresh`]) fetches the Anthropic `/v1/models`
//! endpoint at startup, maps the API response to capability metadata
//! (effort tiers, context window, max tokens, thinking types, context
//! management), writes a cache file to
//! `$NAC_HOME/model-catalog/anthropic-overlay.json`, and reloads the
//! process-global catalog. The `anthropic-overlay.sidecar` persists the
//! last successful fetch time, which gates the 4h refresh cadence (shared
//! with the models.dev and arcee overlays).
//!
//! Unlike the arcee and models.dev overlays (which replace entries
//! wholesale via `merge_entries`), the Anthropic overlay UPDATES existing
//! catalog entries in place: it keeps pricing, `cache_write_1h`, `compat`
//! and `source` from the baseline, and only overwrites the fields the API
//! actually exposes — `thinking_level_map`, `context_window`, `max_tokens`,
//! `reasoning`, `display_name`, and the new capability flags
//! (`adaptive_thinking`, `enabled_thinking`, `context_management`,
//! `clear_thinking`). This is necessary because the Anthropic API does not
//! expose pricing, so a full replace would zero out cost rates.
//!
//! Failure is always contained: offline, timeout, HTTP errors and missing
//! credentials leave any cached overlay and the baseline untouched (and do
//! not advance the sidecar clock, so the next process start retries). A
//! corrupt cache file is ignored at load with a typed warning.

use super::data::{hydrate_entry, GeneratedModel};
use super::overlay::{
    atomic_replace, overlay_dir, unix_now, REFRESH_CADENCE_SECS, REFRESH_TIMEOUT,
};
use super::{
    CatalogWarning, ModelCatalog, ModelSource, ThinkingLevelMap, FALLBACK_CONTEXT_WINDOW,
    FALLBACK_MAX_TOKENS,
};
use crate::model::anthropic::ANTHROPIC_VERSION;
use crate::model::{BackendKind, ReasoningEffort};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const OVERLAY_FILE_NAME: &str = "anthropic-overlay.json";
const SIDECAR_FILE_NAME: &str = "anthropic-overlay.sidecar";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

fn anthropic_overlay_json_path(home: &Path) -> PathBuf {
    overlay_dir(home).join(OVERLAY_FILE_NAME)
}

fn anthropic_sidecar_path(home: &Path) -> PathBuf {
    overlay_dir(home).join(SIDECAR_FILE_NAME)
}

// ---------------------------------------------------------------------------
// Sidecar (cadence gate)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicOverlaySidecar {
    fetched_at_unix: u64,
}

fn read_sidecar(path: &Path) -> Option<AnthropicOverlaySidecar> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_sidecar(path: &Path, sidecar: &AnthropicOverlaySidecar) {
    match serde_json::to_string_pretty(sidecar).map(|json| json + "\n") {
        Ok(json) => {
            if let Err(error) = atomic_replace(path, &json) {
                eprintln!(
                    "nac: model catalog: failed to persist anthropic overlay sidecar {}: {error}",
                    path.display()
                );
            }
        }
        Err(error) => {
            eprintln!("nac: model catalog: failed to serialize anthropic overlay sidecar: {error}")
        }
    }
}

// ---------------------------------------------------------------------------
// Cache file format
// ---------------------------------------------------------------------------

/// One entry in the anthropic overlay cache: a model id plus the
/// capability fields the Anthropic API exposes.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AnthropicOverlayEntry {
    id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    context_window: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    max_tokens: Option<u64>,
    #[serde(default)]
    reasoning: bool,
    #[serde(default)]
    thinking_level_map: ThinkingLevelMap,
    #[serde(default)]
    adaptive_thinking: bool,
    #[serde(default)]
    enabled_thinking: bool,
    #[serde(default)]
    context_management: bool,
    #[serde(default)]
    clear_thinking: bool,
}

// ---------------------------------------------------------------------------
// Refresh outcome
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
enum AnthropicRefreshOutcome {
    /// NAC_HOME is unresolvable; nowhere to persist the overlay.
    SkippedNoHome,
    /// The last successful fetch is younger than the cadence; no request
    /// was made.
    SkippedCadence,
    /// No `ANTHROPIC_API_KEY` is set. The user may configure credentials
    /// after the server starts.
    SkippedNoCredential,
    /// A new overlay was written and the process-global catalog reloaded.
    Updated { models: usize },
    /// Contained failure: any cached overlay and the baseline stay active.
    Failed { error: String },
}

// ---------------------------------------------------------------------------
// Refresh side: fetch from the Anthropic API and rewrite the overlay
// ---------------------------------------------------------------------------

/// One refresh attempt; the testable core of [`spawn_anthropic_model_refresh`].
/// Reads and writes `$NAC_HOME/model-catalog/`.
async fn refresh_anthropic_once() -> AnthropicRefreshOutcome {
    let Some(home) = crate::paths::nac_home_dir() else {
        return AnthropicRefreshOutcome::SkippedNoHome;
    };
    let now = unix_now();
    let sidecar_path = anthropic_sidecar_path(&home);
    let sidecar = read_sidecar(&sidecar_path);
    if let Some(sidecar) = &sidecar {
        if now.saturating_sub(sidecar.fetched_at_unix) < REFRESH_CADENCE_SECS {
            return AnthropicRefreshOutcome::SkippedCadence;
        }
    }

    // No credentials → skip (not a failure; the user may set the key later).
    let api_key = match std::env::var("ANTHROPIC_API_KEY") {
        Ok(key) if !key.trim().is_empty() => key,
        _ => return AnthropicRefreshOutcome::SkippedNoCredential,
    };

    let client = match reqwest::Client::builder()
        .timeout(REFRESH_TIMEOUT)
        .connect_timeout(REFRESH_TIMEOUT.min(Duration::from_secs(10)))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return AnthropicRefreshOutcome::Failed {
                error: format!("building HTTP client: {error}"),
            };
        }
    };

    let body = match fetch_anthropic_models(&client, &api_key).await {
        Ok(body) => body,
        Err(error) => return AnthropicRefreshOutcome::Failed { error },
    };

    let entries = match map_anthropic_api_response(&body) {
        Ok(entries) => entries,
        Err(error) => return AnthropicRefreshOutcome::Failed { error },
    };

    let model_count = entries.len();
    let json = match serde_json::to_string_pretty(&entries) {
        Ok(json) => json + "\n",
        Err(error) => {
            return AnthropicRefreshOutcome::Failed {
                error: format!("serializing anthropic overlay: {error}"),
            };
        }
    };
    if let Err(error) = atomic_replace(&anthropic_overlay_json_path(&home), &json) {
        return AnthropicRefreshOutcome::Failed {
            error: format!("writing anthropic overlay: {error}"),
        };
    }
    write_sidecar(
        &sidecar_path,
        &AnthropicOverlaySidecar {
            fetched_at_unix: now,
        },
    );
    super::reload();
    AnthropicRefreshOutcome::Updated {
        models: model_count,
    }
}

async fn fetch_anthropic_models(client: &reqwest::Client, api_key: &str) -> Result<String, String> {
    let response = client
        .get(ANTHROPIC_MODELS_URL)
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .send()
        .await
        .map_err(|error| format!("fetching anthropic models: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("fetching anthropic models: HTTP {status}"));
    }
    response
        .text()
        .await
        .map_err(|error| format!("reading anthropic models response body: {error}"))
}

// ---------------------------------------------------------------------------
// API response → overlay entry mapping
// ---------------------------------------------------------------------------

/// The subset of the Anthropic `/v1/models` response that the overlay maps.
/// Tolerant: every field except `id` is optional so schema drift cannot
/// break a running nac.
#[derive(Debug, Deserialize)]
struct AnthropicApiModel {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    max_input_tokens: Option<u64>,
    #[serde(default)]
    max_tokens: Option<u64>,
    #[serde(default)]
    capabilities: Option<AnthropicApiCapabilities>,
}

#[derive(Debug, Default, Deserialize)]
struct AnthropicApiCapabilities {
    #[serde(default)]
    thinking: Option<AnthropicApiThinking>,
    #[serde(default)]
    effort: Option<AnthropicApiEffort>,
    #[serde(default)]
    context_management: Option<AnthropicApiContextManagement>,
}

#[derive(Debug, Deserialize)]
struct AnthropicApiThinking {
    #[serde(default)]
    supported: Option<bool>,
    #[serde(default)]
    types: Option<AnthropicApiThinkingTypes>,
}

#[derive(Debug, Default, Deserialize)]
struct AnthropicApiThinkingTypes {
    #[serde(default)]
    adaptive: Option<AnthropicApiCapabilityFlag>,
    #[serde(default)]
    enabled: Option<AnthropicApiCapabilityFlag>,
}

#[derive(Debug, Deserialize)]
struct AnthropicApiEffort {
    #[serde(default)]
    supported: Option<bool>,
    #[serde(default)]
    low: Option<AnthropicApiCapabilityFlag>,
    #[serde(default)]
    medium: Option<AnthropicApiCapabilityFlag>,
    #[serde(default)]
    high: Option<AnthropicApiCapabilityFlag>,
    #[serde(default)]
    xhigh: Option<AnthropicApiCapabilityFlag>,
    #[serde(default)]
    max: Option<AnthropicApiCapabilityFlag>,
}

#[derive(Debug, Deserialize)]
struct AnthropicApiCapabilityFlag {
    #[serde(default)]
    supported: Option<bool>,
}

/// Context management sub-capabilities (clear_thinking_20251015 etc.).
#[derive(Debug, Default, Deserialize)]
struct AnthropicApiContextManagement {
    #[serde(default)]
    supported: Option<bool>,
    #[serde(default)]
    clear_thinking_20251015: Option<AnthropicApiCapabilityFlag>,
}

fn flag_supported(flag: Option<&AnthropicApiCapabilityFlag>) -> bool {
    flag.and_then(|f| f.supported).unwrap_or(false)
}

/// Map the Anthropic API `/v1/models` response body into overlay entries.
/// Tolerant at every level: the top level parses as generic JSON, the model
/// array is found under `data`, and per-model failures are skipped with a
/// stderr warning. An empty result is a hard error (nothing is written then).
fn map_anthropic_api_response(body: &str) -> Result<Vec<AnthropicOverlayEntry>, String> {
    let parsed: serde_json::Value = serde_json::from_str(body)
        .map_err(|error| format!("parsing anthropic API response: {error}"))?;
    let items = parsed
        .get("data")
        .or_else(|| parsed.get("models"))
        .unwrap_or(&parsed)
        .as_array()
        .ok_or_else(|| "anthropic API response has no model array".to_string())?;

    let mut entries = Vec::new();
    for item in items {
        match serde_json::from_value::<AnthropicApiModel>(item.clone()) {
            Ok(model) => {
                if let Some(entry) = map_anthropic_model(&model) {
                    entries.push(entry);
                }
            }
            Err(error) => {
                eprintln!("nac: model catalog: skipping anthropic model entry: {error}");
            }
        }
    }

    if entries.is_empty() {
        return Err("anthropic API returned no usable models".to_string());
    }
    Ok(entries)
}

/// Map a single Anthropic API model to an overlay entry. Returns `None` when
/// the model has no capabilities worth overlaying (e.g. a model with no
/// effort support and no thinking — the baseline already has the right data).
fn map_anthropic_model(model: &AnthropicApiModel) -> Option<AnthropicOverlayEntry> {
    let caps = model.capabilities.as_ref();

    // Thinking support.
    let thinking_supported = caps
        .and_then(|c| c.thinking.as_ref())
        .and_then(|t| t.supported)
        .unwrap_or(false);
    let thinking_types = caps
        .and_then(|c| c.thinking.as_ref())
        .and_then(|t| t.types.as_ref());
    let adaptive_thinking = flag_supported(thinking_types.and_then(|t| t.adaptive.as_ref()));
    let enabled_thinking = flag_supported(thinking_types.and_then(|t| t.enabled.as_ref()));

    // Effort support → thinking level map.
    let effort = caps.and_then(|c| c.effort.as_ref());
    let effort_supported = effort.and_then(|e| e.supported).unwrap_or(false);
    let thinking_level_map = if effort_supported {
        let mut map = BTreeMap::new();
        // `none` is always safe (omission on the wire).
        map.insert(ReasoningEffort::None, Some("none".to_string()));
        if flag_supported(effort.and_then(|e| e.low.as_ref())) {
            map.insert(ReasoningEffort::Low, Some("low".to_string()));
        }
        if flag_supported(effort.and_then(|e| e.medium.as_ref())) {
            map.insert(ReasoningEffort::Medium, Some("medium".to_string()));
        }
        if flag_supported(effort.and_then(|e| e.high.as_ref())) {
            map.insert(ReasoningEffort::High, Some("high".to_string()));
        }
        if flag_supported(effort.and_then(|e| e.xhigh.as_ref())) {
            map.insert(ReasoningEffort::Xhigh, Some("xhigh".to_string()));
        }
        if flag_supported(effort.and_then(|e| e.max.as_ref())) {
            map.insert(ReasoningEffort::Max, Some("max".to_string()));
        }
        ThinkingLevelMap(map)
    } else {
        // No effort support: keep none-only (safe omission).
        ThinkingLevelMap(BTreeMap::from([(
            ReasoningEffort::None,
            Some("none".to_string()),
        )]))
    };

    // Context management.
    let context_management = caps
        .and_then(|c| c.context_management.as_ref())
        .and_then(|cm| cm.supported)
        .unwrap_or(false);
    let clear_thinking = caps
        .and_then(|c| c.context_management.as_ref())
        .and_then(|cm| cm.clear_thinking_20251015.as_ref())
        .and_then(|ct| ct.supported)
        .unwrap_or(false);

    let context_window = model.max_input_tokens.filter(|&c| c > 0);
    let max_tokens = model
        .max_tokens
        .filter(|&m| m > 0)
        .map(|m| m.min(context_window.unwrap_or(u64::MAX)));

    Some(AnthropicOverlayEntry {
        id: model.id.clone(),
        display_name: model.display_name.clone(),
        context_window,
        max_tokens,
        reasoning: thinking_supported,
        thinking_level_map,
        adaptive_thinking,
        enabled_thinking,
        context_management,
        clear_thinking,
    })
}

// ---------------------------------------------------------------------------
// Load side: merge the cached overlay over the baseline
// ---------------------------------------------------------------------------

/// Merge the cached anthropic overlay over the baseline. Never fails: missing
/// file → no-op; unreadable/corrupt → typed warning + baseline stays active.
///
/// Unlike the arcee/models.dev overlays (which replace entries wholesale),
/// this merge UPDATES existing catalog entries in place: it keeps pricing,
/// `cache_write_1h`, `compat` and `source` from the existing entry, and only
/// overwrites the fields the Anthropic API actually exposes. New models
/// (not in the baseline) are inserted with zero cost (pricing unknown until
/// the next catalog.json regen).
pub(super) fn merge_anthropic_overlay(
    catalog: &mut ModelCatalog,
    home: &Path,
    warnings: &mut Vec<CatalogWarning>,
) {
    let path = anthropic_overlay_json_path(home);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(CatalogWarning::AnthropicOverlayUnreadable {
                path,
                error: error.to_string(),
            });
            return;
        }
    };
    let entries: Vec<AnthropicOverlayEntry> = match serde_json::from_str(&raw) {
        Ok(entries) => entries,
        Err(error) => {
            warnings.push(CatalogWarning::AnthropicOverlayCorrupt {
                path,
                error: error.to_string(),
            });
            return;
        }
    };

    let Some(provider_catalog) = catalog.providers.get_mut(&BackendKind::AnthropicMessages) else {
        return;
    };
    let compat = provider_catalog.default.compat.clone();

    for entry in entries {
        // Always include `none` in the map (safe omission marker).
        let mut map = entry.thinking_level_map.0.clone();
        map.entry(ReasoningEffort::None)
            .or_insert_with(|| Some("none".to_string()));
        let thinking_level_map = ThinkingLevelMap(map);

        if let Some(existing) = provider_catalog.models.get_mut(&entry.id) {
            // Update in place: keep cost, cache_write_1h, compat, source.
            if let Some(display_name) = &entry.display_name {
                existing.display_name = Some(display_name.clone());
            }
            if let Some(context_window) = entry.context_window {
                existing.context_window = context_window;
            }
            if let Some(max_tokens) = entry.max_tokens {
                existing.max_tokens = max_tokens;
            }
            existing.reasoning = entry.reasoning;
            existing.thinking_level_map = thinking_level_map.clone();
            existing.adaptive_thinking = entry.adaptive_thinking;
            existing.enabled_thinking = entry.enabled_thinking;
            existing.context_management = entry.context_management;
            existing.clear_thinking = entry.clear_thinking;
            // Mark as overlay-augmented so the frontend badges it.
            if existing.source == ModelSource::Baseline {
                existing.source = ModelSource::Overlay;
            }
        } else {
            // New model not in the baseline: insert with zero cost.
            let generated = GeneratedModel {
                display_name: entry.display_name.clone(),
                context_window: entry.context_window.unwrap_or(FALLBACK_CONTEXT_WINDOW),
                max_tokens: entry.max_tokens.unwrap_or(FALLBACK_MAX_TOKENS),
                cost: super::ModelCostRates::default(),
                reasoning: entry.reasoning,
                image_input: false,
                thinking_level_map: thinking_level_map.clone(),
                adaptive_thinking: entry.adaptive_thinking,
                enabled_thinking: entry.enabled_thinking,
                context_management: entry.context_management,
                clear_thinking: entry.clear_thinking,
            };
            let metadata = hydrate_entry(
                BackendKind::AnthropicMessages,
                entry.id.clone(),
                generated,
                &compat,
                ModelSource::Overlay,
            );
            provider_catalog.models.insert(entry.id.clone(), metadata);
        }

        // Also update dated-snapshot family entries (e.g.
        // `claude-opus-4-5-20251101` inherits from `claude-opus-4-5`).
        if super::dated_snapshot_family(&entry.id).is_none() {
            // The entry.id is a base model (e.g. `claude-opus-4-5`).
            // Update any dated snapshots that resolve through it.
            let prefix = format!("{}-", entry.id);
            for (snapshot_id, snapshot) in provider_catalog.models.iter_mut() {
                if snapshot_id.starts_with(&prefix)
                    && super::dated_snapshot_family(snapshot_id) == Some(entry.id.as_str())
                {
                    if let Some(display_name) = &entry.display_name {
                        snapshot.display_name = Some(display_name.clone());
                    }
                    if let Some(context_window) = entry.context_window {
                        snapshot.context_window = context_window;
                    }
                    if let Some(max_tokens) = entry.max_tokens {
                        snapshot.max_tokens = max_tokens;
                    }
                    snapshot.reasoning = entry.reasoning;
                    snapshot.thinking_level_map = thinking_level_map.clone();
                    snapshot.adaptive_thinking = entry.adaptive_thinking;
                    snapshot.enabled_thinking = entry.enabled_thinking;
                    snapshot.context_management = entry.context_management;
                    snapshot.clear_thinking = entry.clear_thinking;
                    if snapshot.source == ModelSource::Baseline {
                        snapshot.source = ModelSource::Overlay;
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Spawn
// ---------------------------------------------------------------------------

static REFRESH_SPAWNED: AtomicBool = AtomicBool::new(false);

/// Spawn the fire-and-forget anthropic model refresh. Call once from
/// server/CLI startup inside a tokio runtime; repeat calls are no-ops and
/// calls without a runtime are ignored. NEVER call from resolution, picker,
/// resume or validation paths — those only read the catalog.
pub fn spawn_anthropic_model_refresh() {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    if REFRESH_SPAWNED.swap(true, Ordering::SeqCst) {
        return;
    }
    handle.spawn(async move {
        match refresh_anthropic_once().await {
            AnthropicRefreshOutcome::Updated { models } => {
                eprintln!(
                    "nac: anthropic model catalog updated from Anthropic API ({models} models)"
                );
            }
            AnthropicRefreshOutcome::Failed { error } => {
                eprintln!("nac: anthropic model catalog refresh failed: {error}");
            }
            AnthropicRefreshOutcome::SkippedNoHome
            | AnthropicRefreshOutcome::SkippedCadence
            | AnthropicRefreshOutcome::SkippedNoCredential => {}
        }
    });
}
