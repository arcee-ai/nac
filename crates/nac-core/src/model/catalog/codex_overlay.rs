//! Parsing of authenticated Codex model-index capabilities.
//!
//! Missing or malformed fields are left absent so that they cannot erase
//! metadata supplied by lower layers. In particular, an omitted modality
//! list does not mean that images are unsupported (or supported).

use super::{ModelCatalog, ModelSource};
use crate::model::BackendKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

const MAX_INDEX_BYTES: usize = 8 * 1024 * 1024;
static LOOP_STARTED: AtomicBool = AtomicBool::new(false);
static REFRESH_TRIGGER: std::sync::OnceLock<RefreshTrigger> = std::sync::OnceLock::new();

#[derive(Default)]
struct RefreshTrigger {
    force: AtomicBool,
    wake: tokio::sync::Notify,
}

impl RefreshTrigger {
    fn request(&self, force: bool) {
        if force {
            self.force.store(true, Ordering::SeqCst);
        }
        self.wake.notify_one();
    }

    fn take_force(&self) -> bool {
        self.force.swap(false, Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct CodexCapabilities {
    pub id: String,
    pub display_name: Option<String>,
    pub context_window: Option<u64>,
    /// Ceiling for an explicit context-window override, not the default.
    pub max_context_window: Option<u64>,
    pub auto_compact_token_limit: Option<u64>,
    pub image_input: Option<bool>,
    #[serde(default)]
    pub service_tiers: Option<Vec<super::ModelServiceTier>>,
    #[serde(default)]
    pub default_service_tier: Option<String>,
    #[serde(default)]
    pub default_service_tier_known: bool,
}

/// A cache is tied to the account that supplied its capabilities. Do not
/// merge it when logged out or when the account no longer matches.
#[derive(Debug, Serialize, Deserialize)]
struct CodexCache {
    account_fingerprint: String,
    fetched_at_unix: u64,
    models: Vec<CodexCapabilities>,
}

pub(super) fn current_account_fingerprint() -> Option<String> {
    account_fingerprint_for_home(&crate::paths::nac_home_dir()?)
}

pub(super) fn account_fingerprint_for_home(home: &Path) -> Option<String> {
    let account = crate::model::chatgpt_codex::stored_account_for_home(home)?;
    Some(crate::model::chatgpt_codex::account_fingerprint(&account))
}

fn credential_revision() -> Option<[u8; 32]> {
    let values = crate::model::chatgpt_codex::stored_credential_values().ok()?;
    if values.is_empty() {
        return None;
    }
    let mut digest = Sha256::new();
    for value in values {
        digest.update((value.len() as u64).to_be_bytes());
        digest.update(value.as_bytes());
    }
    Some(digest.finalize().into())
}

pub(super) fn merge_cache(catalog: &mut ModelCatalog, home: &Path) {
    let Some(account) = catalog.codex_account_fingerprint.as_deref() else {
        return;
    };
    let path = cache_path(home, account);
    if let Some(cache) = read_cache(&path, account) {
        merge_entries(catalog, &cache.models);
    } else if path.exists() {
        eprintln!(
            "nac: model catalog: ignoring invalid Codex cache {}",
            path.display()
        );
    }
}

fn cache_path(home: &Path, fingerprint: &str) -> std::path::PathBuf {
    super::overlay::overlay_dir(home).join(format!("codex-{fingerprint}.json"))
}

async fn refresh_once(force: bool) -> Result<(), String> {
    // Fixture credentials and discovery metadata are strictly local. Never
    // send them to the public model index in a fixture-enabled browser run.
    #[cfg(feature = "codex-e2e-fixture")]
    if std::env::var_os("NAC_CODEX_E2E_FIXTURE_URL").is_some() {
        return Ok(());
    }
    let Some(home) = crate::paths::nac_home_dir() else {
        return Ok(());
    };
    let Some(fingerprint) = current_account_fingerprint() else {
        return Ok(());
    };
    let path = cache_path(&home, &fingerprint);
    let previous = read_cache(&path, &fingerprint);
    let now = super::overlay::unix_now();
    if previous
        .as_ref()
        .is_some_and(|cache| cache_is_fresh(cache, now, force))
    {
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .timeout(super::overlay::REFRESH_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "building Codex model-index client".to_string())?;
    let (token, account) = crate::model::chatgpt_codex::stored_auth_for_request(&client)
        .await
        .map_err(|_| "loading Codex credentials".to_string())?;
    if crate::model::chatgpt_codex::account_fingerprint(&account) != fingerprint {
        return Ok(());
    }
    let url = crate::model::providers::models_url(
        BackendKind::ChatGptCodexResponses,
        crate::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
    )
    .ok_or_else(|| "missing Codex model-index URL".to_string())?;
    let body = fetch_index(&client, &url, &token, &account).await?;
    store_observation(&home, &fingerprint, &body)?;
    Ok(())
}

fn cache_is_fresh(cache: &CodexCache, now: u64, force: bool) -> bool {
    !force
        && cache.fetched_at_unix <= now
        && now - cache.fetched_at_unix < super::overlay::REFRESH_CADENCE_SECS
}

async fn fetch_index(
    client: &reqwest::Client,
    url: &str,
    token: &str,
    account: &str,
) -> Result<String, String> {
    let mut response = client
        .get(url)
        .bearer_auth(token)
        .header("ChatGPT-Account-Id", account)
        .send()
        .await
        .map_err(|_| "requesting Codex model index".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Codex model index returned HTTP {}",
            response.status()
        ));
    }
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "reading Codex model index".to_string())?
    {
        if body.len().saturating_add(chunk.len()) > MAX_INDEX_BYTES {
            return Err("Codex model index exceeded size limit".into());
        }
        body.extend_from_slice(&chunk);
    }
    String::from_utf8(body).map_err(|_| "Codex model index is not UTF-8".to_string())
}

fn store_observation(home: &Path, fingerprint: &str, body: &str) -> Result<(), String> {
    if body.len() > MAX_INDEX_BYTES {
        return Err("Codex model index exceeded size limit".into());
    }
    let mut models = parse_index(body).map_err(str::to_string)?;
    let path = cache_path(home, fingerprint);
    let lock_path = path.with_extension("lock");
    let written = nac_credential_store::with_credential_lock(&lock_path, || {
        if current_account_fingerprint().as_deref() != Some(fingerprint) {
            return Ok(false);
        }
        let previous = read_cache(&path, fingerprint);
        if let Some(previous) = &previous {
            for model in &mut models {
                if let Some(old) = previous.models.iter().find(|old| old.id == model.id) {
                    model.display_name = model
                        .display_name
                        .take()
                        .or_else(|| old.display_name.clone());
                    model.context_window = model.context_window.or(old.context_window);
                    model.max_context_window = model.max_context_window.or(old.max_context_window);
                    model.auto_compact_token_limit = model
                        .auto_compact_token_limit
                        .or(old.auto_compact_token_limit);
                    model.image_input = model.image_input.or(old.image_input);
                    model.service_tiers = model
                        .service_tiers
                        .take()
                        .or_else(|| old.service_tiers.clone());
                    if !model.default_service_tier_known {
                        model.default_service_tier = old.default_service_tier.clone();
                        model.default_service_tier_known = old.default_service_tier_known;
                    }
                }
                if model
                    .context_window
                    .zip(model.max_context_window)
                    .is_some_and(|(context, max)| context > max)
                {
                    model.context_window = None;
                }
            }
        }
        let changed = previous
            .as_ref()
            .is_none_or(|previous| previous.models != models);
        let cache = CodexCache {
            account_fingerprint: fingerprint.to_owned(),
            fetched_at_unix: super::overlay::unix_now(),
            models,
        };
        let json = serde_json::to_string(&cache)?;
        nac_credential_store::write_auth_string_to_path(&path, &json)?;
        Ok(changed)
    })
    .map_err(|error| format!("writing Codex model cache: {error}"))?;
    if written {
        super::reload();
    }
    Ok(())
}

pub(super) fn record_discovery(account: &str, body: &str) {
    let Some(home) = crate::paths::nac_home_dir() else {
        return;
    };
    let fingerprint = crate::model::chatgpt_codex::account_fingerprint(account);
    if let Err(error) = store_observation(&home, &fingerprint, body) {
        eprintln!("nac: model catalog: Codex discovery metadata was not cached: {error}");
    }
}

#[cfg(not(test))]
pub(super) fn request_refresh(force: bool) {
    spawn_codex_model_refresh();
    REFRESH_TRIGGER
        .get_or_init(RefreshTrigger::default)
        .request(force);
}

pub fn spawn_codex_model_refresh() {
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    if LOOP_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    handle.spawn(async {
        let trigger = REFRESH_TRIGGER.get_or_init(RefreshTrigger::default);
        refresh_loop(
            trigger,
            Duration::from_secs(60),
            Duration::from_secs(15 * 60),
            credential_revision,
            refresh_once,
        )
        .await;
    });
}

async fn refresh_loop<R, F, Fut>(
    trigger: &RefreshTrigger,
    interval: Duration,
    cooldown: Duration,
    mut revision: R,
    mut refresh: F,
) where
    R: FnMut() -> Option<[u8; 32]>,
    F: FnMut(bool) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut previous = revision();
    let mut retry_after = None;
    loop {
        let current = revision();
        let changed = current != previous;
        previous = current;
        let force = trigger.take_force() || changed;
        if force || retry_after.is_none_or(|deadline| tokio::time::Instant::now() >= deadline) {
            match refresh(force).await {
                Ok(()) => retry_after = None,
                Err(error) => {
                    eprintln!("nac: model catalog: Codex refresh failed: {error}");
                    retry_after = Some(tokio::time::Instant::now() + cooldown);
                }
            }
        }
        tokio::select! {
            _ = tokio::time::sleep(interval) => {},
            _ = trigger.wake.notified() => {},
        }
    }
}

fn read_cache(path: &Path, account_fingerprint: &str) -> Option<CodexCache> {
    use std::io::Read;
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_INDEX_BYTES as u64
    {
        return None;
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let file = options.open(path).ok()?;
    nac_credential_store::ensure_open_credential_file_is_safe(&file, path).ok()?;
    let mut bytes = Vec::new();
    file.take(MAX_INDEX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > MAX_INDEX_BYTES {
        return None;
    }
    let cache: CodexCache = serde_json::from_slice(&bytes).ok()?;
    if cache.account_fingerprint != account_fingerprint
        || cache.models.is_empty()
        || cache.models.iter().any(|model| {
            model.id.trim().is_empty()
                || model
                    .context_window
                    .zip(model.max_context_window)
                    .is_some_and(|(context, max)| context > max)
                || [
                    model.context_window,
                    model.max_context_window,
                    model.auto_compact_token_limit,
                ]
                .into_iter()
                .flatten()
                .any(|value| value == 0 || value > crate::MAX_SUPPORTED_TOKEN_COUNT)
        })
    {
        return None;
    }
    Some(cache)
}

pub(super) fn parse_index(body: &str) -> Result<Vec<CodexCapabilities>, &'static str> {
    let value: Value = serde_json::from_str(body).map_err(|_| "invalid JSON")?;
    let models = value
        .get("models")
        .and_then(Value::as_array)
        .ok_or("missing models array")?;
    let mut result = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut invalid_fields = 0usize;
    for model in models {
        if model.get("visibility").and_then(Value::as_str) == Some("hide") {
            continue;
        }
        let Some(id) = model.get("slug").and_then(Value::as_str).filter(|id| {
            !id.is_empty()
                && id.len() <= 512
                && *id == id.trim()
                && !id.chars().any(char::is_control)
        }) else {
            continue;
        };
        if !seen.insert(id) {
            return Err("duplicate model identity");
        }
        let image_input = model
            .get("input_modalities")
            .and_then(Value::as_array)
            .and_then(|items| {
                let modalities: Option<Vec<&str>> = items.iter().map(Value::as_str).collect();
                modalities.and_then(|items| {
                    if items.contains(&"image") {
                        Some(true)
                    } else if items.contains(&"text") {
                        Some(false)
                    } else {
                        None
                    }
                })
            });
        let max_context_window = model
            .get("max_context_window")
            .and_then(Value::as_u64)
            .filter(|value| *value > 0 && *value <= crate::MAX_SUPPORTED_TOKEN_COUNT);
        let context_window = model
            .get("context_window")
            .and_then(Value::as_u64)
            .filter(|value| {
                *value > 0
                    && *value <= crate::MAX_SUPPORTED_TOKEN_COUNT
                    && max_context_window.is_none_or(|max| *value <= max)
            });
        if model
            .get("context_window")
            .is_some_and(|value| !value.is_null())
            && context_window.is_none()
        {
            invalid_fields += 1;
        }
        if model
            .get("max_context_window")
            .is_some_and(|value| !value.is_null())
            && max_context_window.is_none()
        {
            invalid_fields += 1;
        }
        if model
            .get("input_modalities")
            .is_some_and(|value| !value.is_null())
            && image_input.is_none()
        {
            invalid_fields += 1;
        }
        result.push(CodexCapabilities {
            id: id.to_owned(),
            display_name: model
                .get("display_name")
                .and_then(Value::as_str)
                .filter(|name| !name.trim().is_empty())
                .map(str::to_owned),
            context_window,
            max_context_window,
            auto_compact_token_limit: model
                .get("auto_compact_token_limit")
                .and_then(Value::as_u64)
                .filter(|value| *value > 0 && *value <= crate::MAX_SUPPORTED_TOKEN_COUNT),
            image_input,
            service_tiers: model
                .get("service_tiers")
                .and_then(Value::as_array)
                .and_then(|items| {
                    items
                        .iter()
                        .map(|item| {
                            let field = |key: &str| {
                                item.get(key)
                                    .and_then(Value::as_str)
                                    .filter(|value| {
                                        !value.trim().is_empty()
                                            && value.len() <= 512
                                            && !value.chars().any(char::is_control)
                                    })
                                    .map(str::to_owned)
                            };
                            Some(super::ModelServiceTier {
                                id: field("id")?,
                                name: field("name")?,
                                description: field("description")?,
                            })
                        })
                        .collect()
                }),
            default_service_tier_known: model.get("default_service_tier").is_some_and(|value| {
                value.is_null()
                    || value.as_str().is_some_and(|text| {
                        !text.trim().is_empty()
                            && text.len() <= 512
                            && !text.chars().any(char::is_control)
                    })
            }),
            default_service_tier: model
                .get("default_service_tier")
                .and_then(Value::as_str)
                .filter(|value| {
                    !value.trim().is_empty()
                        && value.len() <= 512
                        && !value.chars().any(char::is_control)
                })
                .map(str::to_owned),
        });
    }
    if result.is_empty() {
        return Err("empty model list");
    }
    if invalid_fields > 0 {
        eprintln!("nac: model catalog: ignored {invalid_fields} invalid Codex capability fields; lower-layer values remain active");
    }
    Ok(result)
}

/// Apply only observed fields to a Codex entry. Shared OpenAI pricing and
/// modality metadata can supplement a newly discovered identity, but its API
/// limits and transport-specific settings do not cross the backend boundary.
pub(super) fn merge_entries(catalog: &mut ModelCatalog, entries: &[CodexCapabilities]) {
    for observed in entries {
        let shared = catalog.resolve(BackendKind::OpenAiResponses, &observed.id);
        let Some(codex) = catalog
            .providers
            .get_mut(&BackendKind::ChatGptCodexResponses)
        else {
            return;
        };
        let mut metadata = codex.resolve_entry(&observed.id);
        if metadata.source == ModelSource::ProviderDefault && shared.source.is_authoritative() {
            metadata.display_name = shared.display_name;
            metadata.cost = shared.cost;
            metadata.image_input = shared.image_input;
            metadata.reasoning = shared.reasoning;
        }
        if let Some(name) = &observed.display_name {
            metadata.display_name = Some(name.clone());
        }
        if let Some(context) = observed.context_window {
            metadata.context_window = context;
            metadata.context_origin = super::LimitOrigin::Observed;
            if metadata.max_tokens > context {
                metadata.max_tokens = context;
                metadata.output_origin = super::LimitOrigin::Estimated;
            }
        } else if let Some(max) = observed.max_context_window {
            if metadata.context_window > max {
                metadata.context_window = max;
                metadata.context_origin = super::LimitOrigin::Estimated;
                if metadata.max_tokens > max {
                    metadata.max_tokens = max;
                    metadata.output_origin = super::LimitOrigin::Estimated;
                }
            }
        }
        if let Some(tiers) = &observed.service_tiers {
            metadata.service_tiers = Some(tiers.clone());
        }
        if observed.default_service_tier_known {
            metadata.default_service_tier = observed.default_service_tier.clone();
        }
        if let Some(image_input) = observed.image_input {
            metadata.image_input = image_input;
        }
        if let Some(limit) = observed.auto_compact_token_limit {
            metadata.auto_compact_token_limit = Some(limit);
        }
        metadata.source = ModelSource::Overlay;
        codex.models.insert(observed.id.clone(), metadata);
    }
}

#[cfg(test)]
#[path = "codex_overlay_tests.rs"]
mod tests;
