//! Runtime models.dev overlay (S2).
//!
//! The overlay keeps the checked-in baseline fresh between releases:
//! [`spawn_overlay_refresh`] runs a fire-and-forget background task (once
//! per process, from server/CLI startup — NEVER from resolution, picker,
//! resume or validation paths, which only read the catalog) that
//! revalidates `models.dev/api.json` with the recorded ETag and, on a 200,
//! maps the payload into `$NAC_HOME/model-catalog/overlay.json`
//! (write-tmp + rename) and reloads the process-global catalog. The
//! `overlay.etag` sidecar persists the last-seen ETag and the last
//! successful fetch time, which gates the 4h refresh cadence.
//!
//! Failure is always contained: offline, timeout and HTTP errors leave any
//! cached overlay and the embedded baseline untouched (and do not advance
//! the sidecar clock, so the next process start retries); a corrupt or
//! baseline-older overlay is ignored at load with a typed warning.
//!
//! The runtime mapper deliberately does NOT read models.dev
//! `reasoning_options`: thinking-level maps are derived from the baseline
//! catalog (exact entry → dated-snapshot family → provider default), which
//! reproduces the generator's `overrides.toml` application exactly.
//! Provider endpoint defaults come from models.dev `api` with a fallback
//! to the baseline's value (the curated SDK-default URLs), mirroring the
//! generator's override precedence. The parity test
//! (`overlay_tests::runtime_mapper_matches_the_checked_in_baseline`) pins
//! the two pipelines together over the recorded models.dev fixture, so
//! relaxing `overrides.toml` without updating the seed fails loudly.

use super::data::{GeneratedModel, GeneratedProvider};
use super::{CatalogWarning, ModelCatalog, ModelSource, ThinkingLevelMap};
use crate::model::BackendKind;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// models.dev snapshot endpoint; mirrors nac-catalog-gen's `MODELS_DEV_URL`.
/// Overridable with the `MODELS_DEV_URL` env var (tests point it at a
/// scripted server; deployments can point it at a mirror).
pub(crate) const DEFAULT_MODELS_DEV_URL: &str = "https://models.dev/api.json";
/// Revalidation cadence: a successful fetch or 304 suppresses further
/// refreshes for this long (persisted as the sidecar's fetch time).
pub(crate) const REFRESH_CADENCE_SECS: u64 = 4 * 60 * 60;
/// Hard timeout for the refresh fetch. Failure only delays the overlay to
/// the next process start; model calls never wait on it.
pub(crate) const REFRESH_TIMEOUT: Duration = Duration::from_secs(30);

const OVERLAY_DIR_NAME: &str = "model-catalog";
const OVERLAY_FILE_NAME: &str = "overlay.json";
const ETAG_FILE_NAME: &str = "overlay.etag";

/// models.dev provider id → nac provider; mirrors nac-catalog-gen's
/// `PROVIDER_MAP` (arcee and chatgpt-codex-responses are not models.dev
/// providers; their catalog data stays hand-written in the seed).
const MODELS_DEV_PROVIDERS: [(&str, BackendKind); 5] = [
    ("deepseek", BackendKind::DeepSeekChat),
    ("fireworks-ai", BackendKind::FireworksChat),
    ("togetherai", BackendKind::TogetherChat),
    ("openai", BackendKind::OpenAiResponses),
    ("anthropic", BackendKind::AnthropicMessages),
];

pub(crate) fn overlay_dir(home: &Path) -> PathBuf {
    home.join(OVERLAY_DIR_NAME)
}

fn overlay_json_path(home: &Path) -> PathBuf {
    overlay_dir(home).join(OVERLAY_FILE_NAME)
}

fn overlay_etag_path(home: &Path) -> PathBuf {
    overlay_dir(home).join(ETAG_FILE_NAME)
}

// ---------------------------------------------------------------------------
// Load side: merge the cached overlay over the baseline
// ---------------------------------------------------------------------------

/// The overlay document. `providers` decodes tolerantly (per-provider) so
/// one unknown provider or malformed entry cannot sink the whole overlay.
/// `models_dev_etag` is carried in the file for provenance but read from
/// the sidecar at refresh time.
#[derive(Debug, Deserialize)]
struct OverlayDoc {
    generated_at: String,
    providers: BTreeMap<String, serde_json::Value>,
}

/// The overlay as written by the refresh: typed providers with the same
/// record shape as the checked-in baseline.
#[derive(Debug, Serialize)]
struct OverlayDocWrite {
    generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    models_dev_etag: Option<String>,
    providers: BTreeMap<BackendKind, GeneratedProvider>,
}

/// Merge the cached overlay over the baseline. Never fails: missing file →
/// no-op; unreadable/corrupt → typed warning + baseline; older than the
/// embedded baseline → typed warning + baseline (pi's stale-overlay guard,
/// so a nac upgrade with fresher data is never regressed by a stale cache).
pub(super) fn merge_overlay(
    catalog: &mut ModelCatalog,
    home: &Path,
    warnings: &mut Vec<CatalogWarning>,
) {
    let path = overlay_json_path(home);
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(CatalogWarning::OverlayUnreadable {
                path,
                error: error.to_string(),
            });
            return;
        }
    };
    let doc: OverlayDoc = match serde_json::from_str(&raw) {
        Ok(doc) => doc,
        Err(error) => {
            warnings.push(CatalogWarning::OverlayCorrupt {
                path,
                error: error.to_string(),
            });
            return;
        }
    };
    if !is_utc_iso8601(&doc.generated_at) {
        warnings.push(CatalogWarning::OverlayCorrupt {
            path,
            error: format!("malformed generated_at {:?}", doc.generated_at),
        });
        return;
    }
    if let Some(baseline_generated_at) = baseline_generated_at() {
        if doc.generated_at < baseline_generated_at {
            warnings.push(CatalogWarning::OverlayStale {
                path,
                overlay_generated_at: doc.generated_at,
                baseline_generated_at,
            });
            return;
        }
    }
    let mut providers: BTreeMap<BackendKind, GeneratedProvider> = BTreeMap::new();
    for (provider_id, raw_provider) in doc.providers {
        let provider: BackendKind = match provider_id.parse() {
            Ok(provider) => provider,
            Err(_) => {
                warnings.push(CatalogWarning::OverlayEntrySkipped {
                    provider: provider_id,
                    reason: "unknown provider id".to_string(),
                });
                continue;
            }
        };
        let generated: GeneratedProvider = match serde_json::from_value(raw_provider) {
            Ok(generated) => generated,
            Err(error) => {
                warnings.push(CatalogWarning::OverlayEntrySkipped {
                    provider: provider_id,
                    reason: format!("malformed provider entry: {error}"),
                });
                continue;
            }
        };
        providers.insert(provider, generated);
    }
    for (provider, generated) in providers {
        super::data::merge_entries(catalog, provider, generated, ModelSource::Overlay);
    }
}

/// Embedded baseline generation time for the stale guard. The manifest is
/// checked in and pinned by tests; a parse failure is a build-time bug, so
/// degrade to "no guard" rather than dropping a valid overlay.
fn baseline_generated_at() -> Option<String> {
    match super::data::parse_manifest() {
        Ok(manifest) => Some(manifest.generated_at),
        Err(_) => {
            debug_assert!(false, "checked-in catalog manifest must parse");
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Refresh side: revalidate models.dev and rewrite the overlay
// ---------------------------------------------------------------------------

/// Revalidation state persisted across processes: the last-seen ETag and
/// the last SUCCESSFUL fetch/304 time (the cadence gate). Failures do not
/// advance the clock, so the next process start retries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct OverlaySidecar {
    #[serde(default)]
    pub(super) etag: Option<String>,
    pub(super) fetched_at_unix: u64,
    #[serde(default)]
    pub(super) url: String,
}

pub(super) fn read_sidecar(path: &Path) -> Option<OverlaySidecar> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Best-effort sidecar write; losing it only means the next start
/// revalidates unconditionally.
pub(super) fn write_sidecar(path: &Path, sidecar: &OverlaySidecar) {
    match serde_json::to_string_pretty(sidecar).map(|json| json + "\n") {
        Ok(json) => {
            if let Err(error) = atomic_replace(path, &json) {
                eprintln!(
                    "nac: model catalog: failed to persist overlay etag sidecar {}: {error}",
                    path.display()
                );
            }
        }
        Err(error) => {
            eprintln!("nac: model catalog: failed to serialize overlay etag sidecar: {error}")
        }
    }
}

/// Result of one overlay refresh attempt; the spawn wrapper logs from it
/// and tests assert on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum RefreshOutcome {
    /// NAC_HOME is unresolvable; nowhere to persist the overlay.
    SkippedNoHome,
    /// The last successful fetch is younger than the cadence; no request
    /// was made.
    SkippedCadence,
    /// models.dev reported the snapshot unchanged (304); the sidecar clock
    /// advanced, the overlay (if any) is untouched.
    NotModified,
    /// A new overlay was written and the process-global catalog reloaded.
    Updated { models: usize, warnings: Vec<String> },
    /// Contained failure: any cached overlay and the baseline stay active.
    Failed { error: String },
}

/// One refresh attempt against `url`; the testable core of
/// [`spawn_overlay_refresh`]. Reads and writes `$NAC_HOME/model-catalog/`.
pub(crate) async fn refresh_overlay_once(url: &str, timeout: Duration) -> RefreshOutcome {
    let Some(home) = crate::paths::nac_home_dir() else {
        return RefreshOutcome::SkippedNoHome;
    };
    let now = unix_now();
    let sidecar_path = overlay_etag_path(&home);
    let sidecar = read_sidecar(&sidecar_path);
    if let Some(sidecar) = &sidecar {
        if now.saturating_sub(sidecar.fetched_at_unix) < REFRESH_CADENCE_SECS {
            return RefreshOutcome::SkippedCadence;
        }
    }
    // Revalidate with the sidecar ETag when present, otherwise with the
    // embedded baseline's ETag: an unchanged models.dev answers 304 and no
    // overlay is ever written.
    let etag = sidecar
        .and_then(|sidecar| sidecar.etag)
        .or_else(|| super::data::parse_manifest().ok().and_then(|m| m.models_dev_etag));

    let client = match reqwest::Client::builder()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(10)))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            return RefreshOutcome::Failed {
                error: format!("building HTTP client: {error}"),
            };
        }
    };
    let mut request = client.get(url);
    if let Some(etag) = &etag {
        request = request.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(error) => {
            return RefreshOutcome::Failed {
                error: format!("fetching {url}: {error}"),
            };
        }
    };
    let status = response.status();
    if status == reqwest::StatusCode::NOT_MODIFIED {
        write_sidecar(
            &sidecar_path,
            &OverlaySidecar {
                etag,
                fetched_at_unix: now,
                url: url.to_string(),
            },
        );
        return RefreshOutcome::NotModified;
    }
    if !status.is_success() {
        return RefreshOutcome::Failed {
            error: format!("fetching {url}: HTTP {status}"),
        };
    }
    let response_etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string());
    let body = match response.text().await {
        Ok(body) => body,
        Err(error) => {
            return RefreshOutcome::Failed {
                error: format!("reading {url} response body: {error}"),
            };
        }
    };
    let baseline = super::baseline_catalog();
    let (providers, warnings, models) = match map_models_dev(&body, &baseline) {
        Ok(mapped) => mapped,
        Err(error) => return RefreshOutcome::Failed { error },
    };
    let doc = OverlayDocWrite {
        generated_at: format_unix_utc(now),
        models_dev_etag: response_etag.clone(),
        providers,
    };
    let json = match serde_json::to_string_pretty(&doc) {
        Ok(json) => json + "\n",
        Err(error) => {
            return RefreshOutcome::Failed {
                error: format!("serializing overlay: {error}"),
            };
        }
    };
    if let Err(error) = atomic_replace(&overlay_json_path(&home), &json) {
        return RefreshOutcome::Failed {
            error: format!("writing overlay: {error}"),
        };
    }
    write_sidecar(
        &sidecar_path,
        &OverlaySidecar {
            etag: response_etag,
            fetched_at_unix: now,
            url: url.to_string(),
        },
    );
    super::reload();
    RefreshOutcome::Updated { models, warnings }
}

static REFRESH_SPAWNED: AtomicBool = AtomicBool::new(false);

/// Spawn the fire-and-forget overlay refresh. Call once from server/CLI
/// startup inside a tokio runtime; repeat calls are no-ops and calls
/// without a runtime are ignored. NEVER call from resolution, picker,
/// resume or validation paths — those only read the catalog.
pub fn spawn_overlay_refresh() {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    if REFRESH_SPAWNED.swap(true, Ordering::SeqCst) {
        return;
    }
    let url = std::env::var("MODELS_DEV_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_MODELS_DEV_URL.to_string());
    handle.spawn(async move {
        match refresh_overlay_once(&url, REFRESH_TIMEOUT).await {
            RefreshOutcome::Updated { models, warnings } => {
                eprintln!("nac: model catalog overlay updated from models.dev ({models} models)");
                for warning in warnings {
                    eprintln!("nac: model catalog: {warning}");
                }
            }
            RefreshOutcome::Failed { error } => {
                eprintln!("nac: model catalog overlay refresh failed: {error}");
            }
            RefreshOutcome::SkippedNoHome
            | RefreshOutcome::SkippedCadence
            | RefreshOutcome::NotModified => {}
        }
    });
}

/// Reset the spawn-once guard; pair with `TEST_ENV_LOCK`.
#[cfg(test)]
pub(crate) fn reset_refresh_for_test() {
    REFRESH_SPAWNED.store(false, Ordering::SeqCst);
}

// ---------------------------------------------------------------------------
// models.dev → overlay mapping (runtime counterpart of nac-catalog-gen)
// ---------------------------------------------------------------------------

/// Runtime models.dev model schema: only the fields the overlay maps.
/// Unlike the generator (which hard-errors on `reasoning_options` drift at
/// regen time), the runtime mapper ignores thinking-control data entirely —
/// maps come from the seed catalog — so models.dev schema drift cannot
/// break a running nac.
#[derive(Debug, Deserialize)]
struct ModelsDevModel {
    name: Option<String>,
    reasoning: Option<bool>,
    limit: Option<ModelsDevLimit>,
    cost: Option<ModelsDevCost>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevLimit {
    context: Option<u64>,
    output: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevCost {
    input: Option<f64>,
    output: Option<f64>,
    cache_read: Option<f64>,
    cache_write: Option<f64>,
}

/// Map a models.dev `api.json` payload into overlay provider records.
/// Tolerant at every level: the top level parses as generic values, only
/// nac's five providers are consumed, and per-model failures skip the model
/// with a warning — a partial overlay beats none, and the embedded baseline
/// covers anything skipped. Total payload parse failure is the only hard
/// error (nothing is written then). `baseline` is the seed + generated
/// catalog: thinking maps and the endpoint-default fallback derive from it.
pub(super) fn map_models_dev(
    api_json: &str,
    baseline: &ModelCatalog,
) -> Result<(BTreeMap<BackendKind, GeneratedProvider>, Vec<String>, usize), String> {
    let raw: BTreeMap<String, serde_json::Value> = serde_json::from_str(api_json)
        .map_err(|error| format!("parsing models.dev payload: {error}"))?;
    let mut providers = BTreeMap::new();
    let mut warnings = Vec::new();
    let mut model_count = 0usize;
    for (models_dev_id, provider) in MODELS_DEV_PROVIDERS {
        let Some(raw_provider) = raw.get(models_dev_id) else {
            warnings.push(format!(
                "models.dev provider '{models_dev_id}' is missing from the payload; skipped"
            ));
            continue;
        };
        let raw_models: BTreeMap<String, serde_json::Value> = match raw_provider
            .get("models")
            .cloned()
            .map(serde_json::from_value)
        {
            Some(Ok(models)) => models,
            Some(Err(error)) => {
                warnings.push(format!(
                    "models.dev provider '{models_dev_id}': malformed models ({error}); skipped"
                ));
                continue;
            }
            None => {
                warnings.push(format!(
                    "models.dev provider '{models_dev_id}' has no models object; skipped"
                ));
                continue;
            }
        };
        let default_base_url =
            map_default_base_url(raw_provider, baseline, provider, models_dev_id, &mut warnings);
        let mut models = BTreeMap::new();
        for (id, raw_model) in raw_models {
            let model: ModelsDevModel = match serde_json::from_value(raw_model) {
                Ok(model) => model,
                Err(error) => {
                    warnings.push(format!(
                        "{provider}/{id}: malformed model entry ({error}); skipped"
                    ));
                    continue;
                }
            };
            match map_model(baseline, provider, &id, &model) {
                Ok(entry) => {
                    models.insert(id.clone(), entry);
                    model_count += 1;
                }
                Err(reason) => warnings.push(format!("{provider}/{id}: {reason}; skipped")),
            }
        }
        providers.insert(
            provider,
            GeneratedProvider {
                default_base_url,
                models,
            },
        );
    }
    Ok((providers, warnings, model_count))
}

/// models.dev `api` → the provider's default base URL, falling back to the
/// baseline's value (the curated SDK-default endpoints) when models.dev
/// omits it — mirroring the generator's `overrides.toml` precedence.
/// Malformed values degrade to the baseline with a warning: a running nac
/// never hard-fails on models.dev drift.
fn map_default_base_url(
    raw_provider: &serde_json::Value,
    baseline: &ModelCatalog,
    provider: BackendKind,
    models_dev_id: &str,
    warnings: &mut Vec<String>,
) -> Option<String> {
    let baseline_value = baseline.default_base_url(provider);
    let Some(raw_api) = raw_provider.get("api") else {
        return baseline_value;
    };
    let Some(api) = raw_api.as_str() else {
        warnings.push(format!(
            "models.dev provider '{models_dev_id}': malformed api field; using the baseline              default base URL"
        ));
        return baseline_value;
    };
    match normalize_base_url(api) {
        Ok(url) => Some(url),
        Err(reason) => {
            warnings.push(format!(
                "models.dev provider '{models_dev_id}': invalid api base URL '{api}' ({reason});                  using the baseline default base URL"
            ));
            baseline_value
        }
    }
}

/// Trim, strip trailing slashes, and require an absolute http(s) URL with a
/// host; mirrors the generator's normalization so overlay and baseline
/// values stay byte-identical.
fn normalize_base_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim().trim_end_matches('/');
    let parsed = url::Url::parse(trimmed).map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("must be an absolute http(s) URL with a host".to_string());
    }
    Ok(trimmed.to_string())
}

fn map_model(
    baseline: &ModelCatalog,
    provider: BackendKind,
    id: &str,
    model: &ModelsDevModel,
) -> Result<GeneratedModel, String> {
    let (context_window, max_tokens) = map_limits(model.limit.as_ref());
    Ok(GeneratedModel {
        display_name: model.name.clone(),
        context_window,
        max_tokens,
        cost: map_cost(model.cost.as_ref())?,
        reasoning: model.reasoning.unwrap_or(false),
        thinking_level_map: seed_thinking_map(baseline, provider, id),
    })
}

/// `limit.context`/`limit.output` → (context_window, max_tokens) with the
/// 128k/16k fallbacks and the max ≤ window clamp; mirrors the generator's
/// `seed_limits`.
fn map_limits(limit: Option<&ModelsDevLimit>) -> (u64, u64) {
    let context = limit
        .and_then(|limit| limit.context)
        .filter(|&context| context > 0)
        .unwrap_or(super::FALLBACK_CONTEXT_WINDOW);
    let output = limit
        .and_then(|limit| limit.output)
        .filter(|&output| output > 0)
        .unwrap_or(super::FALLBACK_MAX_TOKENS);
    (context, output.min(context))
}

/// Cost rates with the generator's `seed_cost` rules, except a bad rate
/// skips the model (the generator hard-errors at regen time; the runtime
/// overlay degrades instead).
fn map_cost(cost: Option<&ModelsDevCost>) -> Result<super::ModelCostRates, String> {
    let rate = |rate: Option<f64>, field: &str| -> Result<f64, String> {
        let rate = rate.unwrap_or(0.0);
        if !rate.is_finite() || rate < 0.0 {
            return Err(format!("invalid {field} rate {rate}"));
        }
        Ok(rate)
    };
    Ok(super::ModelCostRates {
        input: rate(cost.and_then(|cost| cost.input), "input")?,
        output: rate(cost.and_then(|cost| cost.output), "output")?,
        cache_read: rate(cost.and_then(|cost| cost.cache_read), "cache_read")?,
        cache_write: rate(cost.and_then(|cost| cost.cache_write), "cache_write")?,
    })
}

/// Thinking maps come from the baseline catalog — exact entry, then the
/// dated-snapshot family entry, then the provider default — reproducing the
/// generator's `overrides.toml` application (provider defaults replace
/// every models.dev-derived seed map; the two anthropic family entries keep
/// theirs). The baseline's generated entries carry the same maps as the
/// seed for every resolution path, so this is seed-identical.
fn seed_thinking_map(baseline: &ModelCatalog, provider: BackendKind, id: &str) -> ThinkingLevelMap {
    baseline
        .providers
        .get(&provider)
        .map(|catalog| catalog.resolve_entry(id).thinking_level_map)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Time, shape checks and atomic writes
// ---------------------------------------------------------------------------

pub(super) fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// UTC ISO-8601 (`YYYY-MM-DDTHH:MM:SSZ`) without a datetime dependency
/// (civil-from-days, Howard Hinnant's algorithm); mirrors nac-catalog-gen's
/// formatter so overlay and baseline timestamps compare lexicographically.
pub(super) fn format_unix_utc(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hour, minute, second) = (rem / 3_600, (rem % 3_600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

/// Shape check for the stale guard's lexicographic comparison.
pub(super) fn is_utc_iso8601(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20 {
        return false;
    }
    let digit = |index: usize| bytes[index].is_ascii_digit();
    digit(0)
        && digit(1)
        && digit(2)
        && digit(3)
        && bytes[4] == b'-'
        && digit(5)
        && digit(6)
        && bytes[7] == b'-'
        && digit(8)
        && digit(9)
        && bytes[10] == b'T'
        && digit(11)
        && digit(12)
        && bytes[13] == b':'
        && digit(14)
        && digit(15)
        && bytes[16] == b':'
        && digit(17)
        && digit(18)
        && bytes[19] == b'Z'
}

/// Write-tmp + rename (the `chatgpt_codex.rs` auth-file pattern, minus the
/// credential-grade permission hardening — the overlay is a cache, not a
/// secret). A crash or cancellation mid-write can leave a dotfile tmp but
/// never a truncated overlay; readers only ever see complete files.
fn atomic_replace(path: &Path, contents: &str) -> io::Result<()> {
    use std::io::Write;
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("{} has no parent directory", path.display()),
        )
    })?;
    std::fs::create_dir_all(parent)?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{} has no file name", path.display()),
            )
        })?;
    let temp_path = parent.join(format!(
        ".{file_name}.tmp-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| -> io::Result<()> {
        let mut temp = std::fs::File::create(&temp_path)?;
        temp.write_all(contents.as_bytes())?;
        temp.sync_all()?;
        drop(temp);
        std::fs::rename(&temp_path, path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}
