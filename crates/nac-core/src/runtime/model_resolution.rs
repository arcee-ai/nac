use super::*;

/// Resolve the model options selected for this session.
///
/// This resolution never consults `OPENAI_MODEL`, `OPENAI_BASE_URL`, or any
/// ambient backend/model/base selector. Credential values are read only from
/// the configured `api_key_env` later when constructing the model client.
pub fn effective_model_settings(
    model: &ModelOptions,
    _config: &NacConfig,
) -> Result<EffectiveModelSettings> {
    let model_id = model.api_model.clone();
    // The backend is explicit (request/CLI) or resolved from the model id
    // through the catalog (unique exact match; collisions prefer the
    // non-managed provider with a warning; unknown ids stay unresolved and
    // surface as the missing-backend error).
    let backend = model.backend.or_else(|| {
        model_id
            .as_deref()
            .and_then(crate::model::provider_for_model)
    });
    let selected_managed_base_url = model
        .backend
        .and_then(managed_backend_base_url)
        .map(str::to_string);
    // base_url chain: request/override → managed-if-request-names-backend →
    // (catalog provider default → managed second-stage → error, inside
    // `resolve_model_base_url`). No config tier.
    let base_url = model.api_base_url.clone().or(selected_managed_base_url);
    // api_key_env chain: request/override → (conventional-var
    // auto-selection inside `from_optional`) → managed = None → guided
    // error. No config tier.
    let api_key_env = model.api_key_env.snapshot_value();

    EffectiveModelSettings::from_optional_with_http_policy(
        backend,
        model_id,
        base_url,
        model.reasoning_effort.resolve(None),
        api_key_env,
        model.extra_headers.clone().unwrap_or_default(),
        model.allow_insecure_http,
    )?
    .with_trusted_api_key_file(model.trusted_api_key_file.clone())?
    .with_service_tier(model.service_tier.resolve(None))
}

/// Compare an explicit new-session model request with the durable existing route.
/// Uses the same resolver as session construction, including conventional
/// credential selection. This check does not mutate or attach the session.
pub fn session_model_matches(
    model: &ModelOptions,
    snapshot: &crate::sessions::SessionSnapshot,
) -> Result<bool> {
    let selected = effective_model_settings(model, &NacConfig::default())?;
    Ok(selected.backend == snapshot.backend
        && selected.model == snapshot.model
        && selected.base_url == snapshot.base_url
        && selected.allow_insecure_http == snapshot.allow_insecure_http
        && selected.api_key_env == snapshot.api_key_env
        && selected.reasoning_effort == snapshot.reasoning_effort
        && selected.service_tier == snapshot.service_tier
        && selected.extra_headers == snapshot.extra_headers)
}

/// Resolve and normalize the persisted session compaction threshold for a
/// new session. Resume never calls this function: its value comes from the
/// session snapshot instead.
///
/// When no threshold is requested, the default is 70% of the resolved model's
/// input budget (rounded to the nearest whole token). The caller can supply a
/// lower provider-derived automatic threshold. `Some(0)` explicitly
/// disables compaction. Config.toml `[compaction].threshold_tokens` is no
/// longer consulted — the section is silently ignored if present.
pub fn effective_compaction_threshold(
    requested: Option<u64>,
    context_window: u64,
) -> Result<Option<u64>> {
    let threshold = requested
        .or(Some((context_window as f64 * 0.7).round() as u64))
        .filter(|threshold| *threshold != 0);
    if threshold.is_some_and(|threshold| threshold > crate::MAX_SUPPORTED_TOKEN_COUNT) {
        anyhow::bail!(
            "session compaction threshold must not exceed {} tokens",
            crate::MAX_SUPPORTED_TOKEN_COUNT
        );
    }
    Ok(threshold)
}

pub(super) fn default_config_cwd(workspace_cwd: &Path, ssh_host: Option<&str>) -> PathBuf {
    let is_ssh = ssh_host
        .map(str::trim)
        .is_some_and(|value| !value.is_empty());
    if is_ssh {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        workspace_cwd.to_path_buf()
    }
}

/// Resolve the SQLite store path against the caller's local base cwd.
pub fn resolve_store_path(cwd: &Path, options: StoreOptions, config: &NacConfig) -> PathBuf {
    resolve_store_path_for_track(cwd, options, config, store::StoreTrack::Dev)
}

/// Resolve the SQLite store path with a track-specific default. Explicit CLI
/// and config paths remain authoritative and are never rewritten by track.
pub fn resolve_store_path_for_track(
    cwd: &Path,
    options: StoreOptions,
    config: &NacConfig,
    track: store::StoreTrack,
) -> PathBuf {
    absolute_store_path(
        cwd,
        options
            .store_path
            .or_else(|| config.storage.store_path.clone())
            .unwrap_or_else(|| store::default_store_path_for_track(track)),
    )
}
