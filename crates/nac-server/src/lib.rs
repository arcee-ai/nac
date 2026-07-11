use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex, Weak},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use async_stream::stream;
use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::{header, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Response,
    },
    routing::{get, post, put},
    Json, Router,
};
use nac_core::{
    commands::{FrontendCommand, PreparedUserInput},
    events::{SessionEventEnvelope, SessionReplayGap},
    model::{
        validate_model_configuration, BackendKind, EffectiveModelSettings, ModelConfigurationError,
        ReasoningEffort,
    },
    runtime::{
        self, ModelOptions, NacConfig, OptionalModelOption, RunOptions, SandboxOptions,
        StoreOptions,
    },
    session_service::{
        ActiveRunSnapshot, SessionEventReceiver, SessionFrontendSnapshot, SessionRunHandle,
        SessionService, SessionSubmitError,
    },
    sessions,
    view::{self, SessionSummarySnapshot},
};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    sync::{Mutex, RwLock},
};
use tower_http::cors::CorsLayer;

const DEFAULT_REPLAY_LIMIT: usize = 256;
const WORKSPACE_DIFF_CACHE_TTL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub root_cwd: PathBuf,
    pub store_path: Option<PathBuf>,
    pub worker_executable: Option<PathBuf>,
}

#[derive(Clone)]
pub struct SessionManager {
    inner: Arc<SessionManagerInner>,
}

struct SessionManagerInner {
    root_cwd: PathBuf,
    store_path: PathBuf,
    worker_executable: PathBuf,
    active_sessions: RwLock<HashMap<String, Arc<SessionService>>>,
    lifecycle_gates: StdMutex<HashMap<String, Weak<Mutex<()>>>>,
    #[cfg(test)]
    config_update_after_load: StdMutex<Option<Arc<tokio::sync::Barrier>>>,
    workspace_diff_cache: RwLock<HashMap<PathBuf, WorkspaceDiffCacheEntry>>,
}

#[derive(Debug, Clone)]
struct WorkspaceDiffCacheEntry {
    updated_at: Instant,
    totals: view::WorkspaceDiffTotals,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoreInfo {
    pub root_cwd: PathBuf,
    pub store_path: PathBuf,
    pub worker_executable: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedSessionSummary {
    pub summary: SessionSummarySnapshot,
    pub active: bool,
    pub active_run: Option<ActiveRunSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_diff: Option<view::WorkspaceDiffTotals>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ListSessionsQuery {
    #[serde(default)]
    pub workspace_stats: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RequestField<T> {
    Omitted,
    Null,
    Value(T),
}

impl<T> Default for RequestField<T> {
    fn default() -> Self {
        Self::Omitted
    }
}

impl<'de, T> Deserialize<'de> for RequestField<T>
where
    T: Deserialize<'de>,
{
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(|value| match value {
            Some(value) => Self::Value(value),
            None => Self::Null,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HeadersRequest(pub BTreeMap<String, String>);

impl<'de> Deserialize<'de> for HeadersRequest {
    fn deserialize<D>(deserializer: D) -> std::result::Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Representation {
            Object(BTreeMap<String, String>),
            LegacyJson(String),
        }

        match Representation::deserialize(deserializer)? {
            Representation::Object(headers) => Ok(Self(headers)),
            Representation::LegacyJson(json) => {
                if json.trim().is_empty() {
                    return Err(serde::de::Error::custom(
                        "extra_headers compatibility string must not be blank",
                    ));
                }
                serde_json::from_str::<BTreeMap<String, String>>(&json)
                    .map(Self)
                    .map_err(|error| {
                        serde::de::Error::custom(format!(
                            "extra_headers compatibility string must contain a JSON object with string values: {error}"
                        ))
                    })
            }
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CreateSessionRequest {
    pub cwd: Option<PathBuf>,
    #[serde(default)]
    pub model: RequestField<String>,
    #[serde(default)]
    pub base_url: RequestField<String>,
    #[serde(default)]
    pub backend: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<String>,
    #[serde(default)]
    pub api_key_env: RequestField<String>,
    /// Prefer a JSON object. A JSON-encoded object string remains accepted for compatibility.
    #[serde(default)]
    pub extra_headers: RequestField<HeadersRequest>,
    /// OpenSSH target for remote sessions; `cwd` is remote and defaults to `~`.
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub sandbox: SandboxRequest,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SandboxRequest {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub no_mount_cwd: bool,
    #[serde(default)]
    pub mounts: Vec<String>,
    #[serde(default)]
    pub mounts_ro: Vec<String>,
    pub image: Option<String>,
    #[serde(default)]
    pub gpus: Vec<String>,
    pub shm_size: Option<String>,
    pub session_key: Option<String>,
    pub workdir: Option<String>,
    pub backend: Option<String>,
    pub cpus: Option<u8>,
    pub memory_mib: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdateConfigRequest {
    #[serde(default)]
    pub model: RequestField<String>,
    #[serde(default)]
    pub base_url: RequestField<String>,
    #[serde(default)]
    pub backend: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<String>,
    #[serde(default)]
    pub api_key_env: RequestField<String>,
    /// Prefer a JSON object. Null or an empty object clears the persisted map.
    #[serde(default)]
    pub extra_headers: RequestField<HeadersRequest>,
}

impl UpdateConfigRequest {
    fn is_empty(&self) -> bool {
        matches!(self.model, RequestField::Omitted)
            && matches!(self.base_url, RequestField::Omitted)
            && matches!(self.backend, RequestField::Omitted)
            && matches!(self.reasoning_effort, RequestField::Omitted)
            && matches!(self.api_key_env, RequestField::Omitted)
            && matches!(self.extra_headers, RequestField::Omitted)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateSessionPresentationRequest {
    pub title: String,
    pub pinned: bool,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ReorderSessionsRequest {
    pub pinned: bool,
    pub session_ids: Vec<String>,
    pub expected_versions: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReorderSessionsResponse {
    pub pinned: bool,
    pub sessions: Vec<SessionSummarySnapshot>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SubmitPromptRequest {
    pub prompt: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubmitPromptResponse {
    pub run_id: String,
    pub client_id: Option<String>,
    pub display_prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventsQuery {
    pub after_sequence_id: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentEventsResponse {
    pub events: Vec<SessionEventEnvelope>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceDiffQuery {
    pub path: String,
    pub stage: Option<String>,
    pub context: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayBoundaryEvent {
    pub replay_boundary_sequence_id: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayGapEvent {
    pub replay_gap: SessionReplayGap,
}

impl SessionManager {
    pub fn new(options: ServerOptions) -> Result<Self> {
        let root_cwd = canonicalize_dir(options.root_cwd)?;
        let config = NacConfig::load_without_model_from_cwd(&root_cwd)?;
        let store_path = runtime::resolve_store_path(
            &root_cwd,
            StoreOptions {
                store_path: options.store_path,
            },
            &config,
        );
        let worker_executable = options
            .worker_executable
            .map(canonicalize_file)
            .transpose()?
            .unwrap_or(std::env::current_exe().context("failed to resolve current executable")?);

        Ok(Self {
            inner: Arc::new(SessionManagerInner {
                root_cwd,
                store_path,
                worker_executable,
                active_sessions: RwLock::new(HashMap::new()),
                lifecycle_gates: StdMutex::new(HashMap::new()),
                #[cfg(test)]
                config_update_after_load: StdMutex::new(None),
                workspace_diff_cache: RwLock::new(HashMap::new()),
            }),
        })
    }

    pub fn store_info(&self) -> StoreInfo {
        StoreInfo {
            root_cwd: self.inner.root_cwd.clone(),
            store_path: self.inner.store_path.clone(),
            worker_executable: self.inner.worker_executable.clone(),
        }
    }

    pub async fn list_sessions(
        &self,
        include_workspace_stats: bool,
    ) -> Result<Vec<ManagedSessionSummary>> {
        if !self.inner.store_path.exists() {
            return Ok(Vec::new());
        }

        let summaries = view::list_sessions(&self.inner.store_path)?;
        let mut sessions = {
            let active = self.inner.active_sessions.read().await;
            summaries
                .into_iter()
                .map(|summary| {
                    let active_service = active.get(&summary.session_id);
                    ManagedSessionSummary {
                        active: active_service.is_some(),
                        active_run: active_service.and_then(|service| service.active_run()),
                        summary,
                        workspace_diff: None,
                    }
                })
                .collect::<Vec<_>>()
        };

        if include_workspace_stats {
            self.populate_workspace_diff(&mut sessions).await?;
        }

        Ok(sessions)
    }

    pub async fn update_session_presentation(
        &self,
        session_id: &str,
        title: &str,
        pinned: bool,
        expected_version: i64,
    ) -> std::result::Result<SessionSummarySnapshot, sessions::SessionPresentationError> {
        let store_path = self.inner.store_path.clone();
        let session_id = session_id.to_string();
        let title = title.to_string();
        tokio::task::spawn_blocking(move || {
            sessions::update_session_presentation(
                &store_path,
                &session_id,
                &title,
                pinned,
                expected_version,
            )
            .map(Into::into)
        })
        .await
        .map_err(|error| {
            sessions::SessionPresentationError::Store(anyhow!(
                "session presentation update task failed: {error}"
            ))
        })?
    }

    pub async fn reorder_sessions(
        &self,
        pinned: bool,
        session_ids: &[String],
        expected_versions: &BTreeMap<String, i64>,
    ) -> std::result::Result<Vec<SessionSummarySnapshot>, sessions::SessionPresentationError> {
        let store_path = self.inner.store_path.clone();
        let session_ids = session_ids.to_vec();
        let expected_versions = expected_versions.clone();
        tokio::task::spawn_blocking(move || {
            sessions::reorder_sessions(&store_path, pinned, &session_ids, &expected_versions)
                .map(|summaries| summaries.into_iter().map(Into::into).collect())
        })
        .await
        .map_err(|error| {
            sessions::SessionPresentationError::Store(anyhow!(
                "session reorder task failed: {error}"
            ))
        })?
    }

    async fn populate_workspace_diff(&self, sessions: &mut [ManagedSessionSummary]) -> Result<()> {
        let mut workspace_displays = HashMap::new();
        for entry in sessions.iter() {
            if let Some(path) = entry.summary.workspace_host_path.clone() {
                workspace_displays
                    .entry(path)
                    .or_insert_with(|| entry.summary.cwd.display().to_string());
            }
        }

        let now = Instant::now();
        let mut totals_by_path = HashMap::new();
        let mut missing_paths = Vec::new();
        {
            let cache = self.inner.workspace_diff_cache.read().await;
            for path in workspace_displays.keys() {
                if let Some(entry) = cache.get(path) {
                    if now.duration_since(entry.updated_at) < WORKSPACE_DIFF_CACHE_TTL {
                        totals_by_path.insert(path.clone(), entry.totals.clone());
                        continue;
                    }
                }
                missing_paths.push(path.clone());
            }
        }

        let mut tasks = Vec::new();
        for path in missing_paths {
            let display = workspace_displays
                .get(&path)
                .cloned()
                .unwrap_or_else(|| path.display().to_string());
            let task_path = path.clone();
            tasks.push((
                path,
                tokio::task::spawn_blocking(move || {
                    view::workspace_diff_totals(&display, Some(&task_path))
                }),
            ));
        }

        let mut cache_updates = Vec::new();
        for (path, task) in tasks {
            let totals = task.await.context("workspace diff task failed")?;
            totals_by_path.insert(path.clone(), totals.clone());
            cache_updates.push((path, totals));
        }

        if !cache_updates.is_empty() {
            let updated_at = Instant::now();
            let mut cache = self.inner.workspace_diff_cache.write().await;
            for (path, totals) in cache_updates {
                cache.insert(path, WorkspaceDiffCacheEntry { updated_at, totals });
            }
        }

        for entry in sessions.iter_mut() {
            entry.workspace_diff = match entry.summary.workspace_host_path.as_ref() {
                Some(path) => totals_by_path.get(path).cloned(),
                None => Some(view::workspace_diff_totals(
                    &entry.summary.cwd.display().to_string(),
                    None,
                )),
            };
        }

        Ok(())
    }

    pub async fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> Result<SessionFrontendSnapshot> {
        let ssh_host = request
            .ssh_host
            .as_deref()
            .map(str::trim)
            .filter(|ssh_host| !ssh_host.is_empty())
            .map(str::to_string);
        if ssh_host.is_some() && sandbox_requested(&request.sandbox) {
            return Err(anyhow!(
                "invalid request: ssh_host and sandbox options cannot both be set"
            ));
        }
        let (workspace_cwd, config_cwd) = if ssh_host.is_some() {
            let remote_cwd = request
                .cwd
                .and_then(|cwd| {
                    let trimmed = cwd.as_os_str().to_string_lossy().trim().to_string();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(PathBuf::from(trimmed))
                    }
                })
                .unwrap_or_else(|| PathBuf::from("~"));
            (remote_cwd, self.inner.root_cwd.clone())
        } else {
            let local_cwd = match request.cwd {
                Some(cwd) => canonicalize_dir(cwd)?,
                None => self.inner.root_cwd.clone(),
            };
            (local_cwd.clone(), local_cwd)
        };
        let config = NacConfig::load_from_cwd(&config_cwd)?;
        let model = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
        )?;
        let run_config = runtime::build_run_config(
            RunOptions {
                workspace_cwd,
                config_cwd: Some(config_cwd.clone()),
                worker_executable: Some(self.inner.worker_executable.clone()),
                store: StoreOptions {
                    store_path: Some(self.inner.store_path.clone()),
                },
                model,
                sandbox: sandbox_options(request.sandbox),
                ssh_host,
            },
            &config,
        )
        .await?;
        let parts = SessionService::from_orchestrator_run_config(run_config);
        let service = parts.service;
        let snapshot = service.frontend_snapshot().await?;
        let session_id = snapshot
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow!("new session did not include a session id"))?;
        self.inner
            .active_sessions
            .write()
            .await
            .insert(session_id, Arc::new(service));
        Ok(snapshot)
    }

    fn lifecycle_gate(&self, session_id: &str) -> Arc<Mutex<()>> {
        let mut gates = self
            .inner
            .lifecycle_gates
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(gate) = gates.get(session_id).and_then(Weak::upgrade) {
            return gate;
        }

        let gate = Arc::new(Mutex::new(()));
        gates.insert(session_id.to_string(), Arc::downgrade(&gate));
        gate
    }

    async fn attach_session(&self, session_id: &str) -> Result<Arc<SessionService>> {
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.attach_session_locked(session_id).await
    }

    /// Attaches while the caller holds this session's lifecycle gate. Keeping
    /// resume and insertion behind the same gate prevents an old service from
    /// being inserted after a settings update has committed.
    async fn attach_session_locked(&self, session_id: &str) -> Result<Arc<SessionService>> {
        if let Some(service) = self.inner.active_sessions.read().await.get(session_id) {
            return Ok(Arc::clone(service));
        }

        let service = Arc::new(self.resume_session(session_id).await?);
        let mut active = self.inner.active_sessions.write().await;
        if let Some(existing) = active.get(session_id) {
            return Ok(Arc::clone(existing));
        }
        active.insert(session_id.to_string(), Arc::clone(&service));
        Ok(service)
    }

    pub fn session_config(&self, session_id: &str) -> Result<sessions::SessionModelConfig> {
        sessions::load_session_model_config(&self.inner.store_path, session_id)
    }

    pub async fn snapshot(&self, session_id: &str) -> Result<SessionFrontendSnapshot> {
        self.attach_session(session_id)
            .await?
            .frontend_snapshot()
            .await
    }

    pub async fn workspace_file_diff(
        &self,
        session_id: &str,
        query: WorkspaceDiffQuery,
    ) -> Result<view::WorkspaceFileDiff> {
        let stage = view::WorkspaceDiffStage::parse(query.stage.as_deref().unwrap_or("all"))?;
        let context = query.context.unwrap_or(3).min(100);
        let path = query.path;
        let summary = self
            .list_sessions(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let host_root = summary.workspace_host_path.ok_or_else(|| {
            anyhow!("workspace diff is not supported for remote/sandbox-only sessions")
        })?;

        tokio::task::spawn_blocking(move || {
            view::workspace_file_diff(&host_root, &path, stage, context)
        })
        .await
        .context("workspace diff task failed")?
    }

    pub async fn submit_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
    ) -> Result<SubmitPromptResponse> {
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let service = self.attach_session_locked(session_id).await?;
        let client = service.connect_client();
        match client.prepare_user_input(&request.prompt) {
            PreparedUserInput::Empty => Err(anyhow!("prompt is empty")),
            PreparedUserInput::InvalidSlashCommand { message } => Err(anyhow!(message)),
            PreparedUserInput::FrontendCommand(command) => Err(anyhow!(
                "frontend command '{}' is not supported by the server API",
                frontend_command_name(command)
            )),
            PreparedUserInput::SubmitPrompt(prompt) => {
                let display_prompt = prompt.display_prompt.clone();
                let handle = client
                    .try_submit_prepared_prompt(prompt)
                    .map_err(submit_error_to_anyhow)?;
                Ok(submit_response(handle, display_prompt))
            }
        }
    }

    pub async fn recent_events(
        &self,
        session_id: &str,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> Result<Vec<SessionEventEnvelope>> {
        Ok(self
            .attach_session(session_id)
            .await?
            .recent_events(after_sequence_id, limit))
    }

    pub async fn subscribe_events(
        &self,
        session_id: &str,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> Result<(
        u64,
        Option<SessionReplayGap>,
        Vec<SessionEventEnvelope>,
        SessionEventReceiver,
    )> {
        let service = self.attach_session(session_id).await?;
        let subscription = service
            .connect_client()
            .subscribe_events_with_replay(after_sequence_id, limit);
        Ok((
            subscription.replay_boundary_sequence_id,
            subscription.replay_gap,
            subscription.replayed_events,
            subscription.receiver,
        ))
    }

    pub async fn cancel_active_run(&self, session_id: &str) -> Result<()> {
        let service = self.attach_session(session_id).await?;
        let active = service
            .active_run()
            .ok_or_else(|| anyhow!("session has no active run"))?;
        service
            .connect_client()
            .request_cancel(&active.run_id)
            .await
            .map_err(|error| anyhow!(error.to_string()))
    }

    /// Deletes a session and all related data (threads, episodes, worksets,
    /// workset_items) from the store. If the session is currently active in
    /// memory, any running task is gracefully cancelled before removal.
    pub async fn delete_session(&self, session_id: &str) -> Result<()> {
        // Cancel any active run, destroy the sandbox, and remove from the
        // in-memory map.
        {
            let active = self.inner.active_sessions.read().await;
            if let Some(service) = active.get(session_id) {
                if let Some(active_run) = service.active_run() {
                    let _ = service
                        .connect_client()
                        .request_cancel(&active_run.run_id)
                        .await;
                }
                // Explicitly destroy the sandbox so it is torn down even
                // if SSE handlers or other clones keep the Arc alive.
                service.destroy_sandbox().await;
            }
        }
        self.inner.active_sessions.write().await.remove(session_id);

        // Cascade-delete all DB rows for this session.
        let deleted = view::delete_session(&self.inner.store_path, session_id)?;
        if !deleted {
            return Err(anyhow!("session '{}' was not found", session_id));
        }
        Ok(())
    }

    /// Transactionally updates persisted model settings for an inactive session.
    /// The prospective snapshot and credentials are fully validated before the
    /// database or in-memory service map is changed.
    pub async fn update_session_config(
        &self,
        session_id: &str,
        request: UpdateConfigRequest,
    ) -> Result<()> {
        // An omitted patch is intentionally independent of persisted settings
        // and credentials. In particular, it must not evict an attached service.
        if request.is_empty() {
            return Ok(());
        }

        // Submission and update both hold this per-session gate. A submission
        // that wins establishes active-run state synchronously before releasing
        // it; an update that wins commits and evicts before a submit can attach.
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;

        // Hold the write lock through validation and persistence so other
        // attachment paths cannot observe or insert a stale service.
        let mut active = self.inner.active_sessions.write().await;
        if let Some(service) = active.get(session_id) {
            if service.active_run().is_some() {
                return Err(anyhow!(
                    "session is busy with an active run; cancel it before updating config"
                ));
            }
        }

        let current = sessions::load_session(&self.inner.store_path, session_id)?;
        #[cfg(test)]
        let update_barrier = {
            self.inner
                .config_update_after_load
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        };
        #[cfg(test)]
        if let Some(barrier) = update_barrier {
            barrier.wait().await;
        }
        let mut prospective = current.clone();
        apply_config_patch(&mut prospective, request)?;

        let _settings = EffectiveModelSettings::new(
            prospective.backend,
            prospective.model.clone(),
            prospective.base_url.clone(),
            prospective.reasoning_effort,
            prospective.api_key_env.clone(),
            prospective.extra_headers.clone(),
        )?;
        validate_model_configuration(
            prospective.backend,
            Some(&prospective.base_url),
            prospective.reasoning_effort,
            prospective.api_key_env.as_deref(),
            &prospective.extra_headers,
        )?;

        // Persist only model columns after all caller-controlled configuration
        // and credential checks succeed. The revision CAS rejects a concurrent
        // PATCH, while run/history writes remain independent of these columns.
        // A store failure or conflict leaves the active map untouched.
        sessions::update_session_model_config(&self.inner.store_path, &prospective)?;
        active.remove(session_id);
        Ok(())
    }

    async fn resume_session(&self, session_id: &str) -> Result<SessionService> {
        let summary = self
            .list_sessions(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let config_cwd = if summary.ssh_host.is_some() {
            &self.inner.root_cwd
        } else {
            &summary.cwd
        };
        let config = NacConfig::load_without_model_from_cwd(config_cwd)?;
        let run_config = runtime::build_resume_config_for_session(
            self.inner.store_path.clone(),
            session_id,
            &config,
            self.inner.root_cwd.clone(),
            Some(self.inner.worker_executable.clone()),
        )
        .await?;
        Ok(SessionService::from_orchestrator_run_config(run_config).service)
    }
}

pub fn router(manager: SessionManager) -> Router {
    Router::new()
        .route("/", get(index_html))
        .route("/app", get(index_html))
        .route("/assets/app.css", get(app_css))
        .route("/assets/app.js", get(app_js))
        .route(
            "/assets/fonts/doto/Doto-RoundedExtraBold-latin.woff2",
            get(doto_rounded_extra_bold_font),
        )
        .route("/assets/fonts/doto/OFL.txt", get(doto_font_license))
        .route("/assets/vendor/purify.min.js", get(vendor_purify_js))
        .route(
            "/assets/vendor/markdown-it.min.js",
            get(vendor_markdown_it_js),
        )
        .route("/health", get(health))
        .route("/store", get(store_info))
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/order", put(reorder_sessions_handler))
        .route(
            "/sessions/{session_id}/presentation",
            put(update_session_presentation_handler),
        )
        .route("/sessions/{session_id}/workspace/diff", get(workspace_diff))
        .route(
            "/sessions/{session_id}",
            get(session_snapshot).delete(delete_session_handler),
        )
        .route(
            "/sessions/{session_id}/config",
            get(session_config_handler).patch(update_config_handler),
        )
        .route("/sessions/{session_id}/runs", post(submit_prompt))
        .route("/sessions/{session_id}/events", get(recent_events))
        .route("/sessions/{session_id}/events/stream", get(stream_events))
        .route(
            "/sessions/{session_id}/cancel-active-run",
            post(cancel_active_run),
        )
        .layer(CorsLayer::permissive())
        .with_state(manager)
}

pub async fn serve(addr: SocketAddr, manager: SessionManager) -> Result<()> {
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {}", addr))?;
    axum::serve(listener, router(manager))
        .await
        .context("server stopped unexpectedly")
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn index_html() -> Html<&'static str> {
    Html(include_str!("../assets/index.html"))
}

async fn app_css() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../assets/app.css"),
    )
}

async fn app_js() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        include_str!("../assets/app.js"),
    )
}

async fn doto_rounded_extra_bold_font() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "font/woff2")],
        include_bytes!("../assets/fonts/doto/Doto-RoundedExtraBold-latin.woff2").as_slice(),
    )
}

async fn doto_font_license() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        include_str!("../assets/fonts/doto/OFL.txt"),
    )
}

async fn vendor_purify_js() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        include_str!("../assets/vendor/purify.min.js"),
    )
}

async fn vendor_markdown_it_js() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        include_str!("../assets/vendor/markdown-it.min.js"),
    )
}

async fn store_info(State(manager): State<SessionManager>) -> Json<StoreInfo> {
    Json(manager.store_info())
}

async fn list_sessions(
    State(manager): State<SessionManager>,
    Query(query): Query<ListSessionsQuery>,
) -> std::result::Result<Json<Vec<ManagedSessionSummary>>, ApiError> {
    Ok(Json(manager.list_sessions(query.workspace_stats).await?))
}

async fn update_session_presentation_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<UpdateSessionPresentationRequest>, JsonRejection>,
) -> std::result::Result<Json<SessionSummarySnapshot>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let summary = manager
        .update_session_presentation(
            &session_id,
            &request.title,
            request.pinned,
            request.expected_version,
        )
        .await?;
    Ok(Json(summary))
}

async fn reorder_sessions_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<ReorderSessionsRequest>, JsonRejection>,
) -> std::result::Result<Json<ReorderSessionsResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let sessions = manager
        .reorder_sessions(
            request.pinned,
            &request.session_ids,
            &request.expected_versions,
        )
        .await?;
    Ok(Json(ReorderSessionsResponse {
        pinned: request.pinned,
        sessions,
    }))
}

async fn create_session(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<CreateSessionRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<SessionFrontendSnapshot>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(manager.create_session(request).await?),
    ))
}

async fn session_snapshot(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<SessionFrontendSnapshot>, ApiError> {
    Ok(Json(manager.snapshot(&session_id).await?))
}

async fn workspace_diff(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceDiffQuery>,
) -> std::result::Result<Json<view::WorkspaceFileDiff>, ApiError> {
    Ok(Json(manager.workspace_file_diff(&session_id, query).await?))
}

async fn submit_prompt(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SubmitPromptRequest>,
) -> std::result::Result<(StatusCode, Json<SubmitPromptResponse>), ApiError> {
    Ok((
        StatusCode::ACCEPTED,
        Json(manager.submit_prompt(&session_id, request).await?),
    ))
}

async fn recent_events(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<EventsQuery>,
) -> std::result::Result<Json<RecentEventsResponse>, ApiError> {
    let events = manager
        .recent_events(
            &session_id,
            query.after_sequence_id,
            query.limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
        )
        .await?;
    Ok(Json(RecentEventsResponse { events }))
}

async fn stream_events(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<EventsQuery>,
) -> std::result::Result<
    Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>>,
    ApiError,
> {
    let (replay_boundary_sequence_id, replay_gap, replayed_events, receiver) = manager
        .subscribe_events(
            &session_id,
            query.after_sequence_id,
            query.limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
        )
        .await?;
    let event_stream = session_event_stream(
        replay_boundary_sequence_id,
        replay_gap,
        replayed_events,
        receiver,
    );

    Ok(Sse::new(event_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

async fn cancel_active_run(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.cancel_active_run(&session_id).await?;
    Ok(StatusCode::ACCEPTED)
}

async fn delete_session_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.delete_session(&session_id).await?;
    Ok(StatusCode::OK)
}

async fn session_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<sessions::SessionModelConfig>, ApiError> {
    Ok(Json(manager.session_config(&session_id)?))
}

async fn update_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<UpdateConfigRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    manager.update_session_config(&session_id, request).await?;
    Ok(StatusCode::OK)
}

#[derive(Debug)]
struct RequestConfigurationError(String);

impl std::fmt::Display for RequestConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for RequestConfigurationError {}

fn request_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(RequestConfigurationError(message.into()))
}

fn nonblank_request_string(value: String, field: &str) -> Result<String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(request_configuration_error(format!(
            "invalid model configuration: field '{field}' must not be empty or whitespace-only"
        )));
    }
    Ok(normalized.to_string())
}

fn required_create_string(field: RequestField<String>, name: &str) -> Result<Option<String>> {
    match field {
        RequestField::Omitted => Ok(None),
        RequestField::Null => Err(request_configuration_error(format!(
            "invalid model configuration: required field '{name}' cannot be null"
        ))),
        RequestField::Value(value) => nonblank_request_string(value, name).map(Some),
    }
}

fn model_options(
    model: RequestField<String>,
    base_url: RequestField<String>,
    backend: RequestField<String>,
    reasoning_effort: RequestField<String>,
    api_key_env: RequestField<String>,
    extra_headers: RequestField<HeadersRequest>,
) -> Result<ModelOptions> {
    let backend = required_create_string(backend, "backend")?
        .map(|value| parse_request_enum::<BackendKind>(&value, "backend"))
        .transpose()?;
    let reasoning_effort = match reasoning_effort {
        RequestField::Omitted => OptionalModelOption::Inherit,
        RequestField::Null => OptionalModelOption::Clear,
        RequestField::Value(value) => {
            let value = nonblank_request_string(value, "reasoning_effort")?;
            OptionalModelOption::Value(parse_request_enum::<ReasoningEffort>(
                &value,
                "reasoning_effort",
            )?)
        }
    };
    let api_key_env = match api_key_env {
        RequestField::Omitted => OptionalModelOption::Inherit,
        RequestField::Null => OptionalModelOption::Clear,
        RequestField::Value(value) => OptionalModelOption::Value(value),
    };
    let extra_headers = match extra_headers {
        RequestField::Omitted => None,
        RequestField::Null => Some(BTreeMap::new()),
        RequestField::Value(HeadersRequest(headers)) => Some(headers),
    };

    Ok(ModelOptions {
        backend,
        reasoning_effort,
        api_base_url: required_create_string(base_url, "base_url")?,
        api_model: required_create_string(model, "model")?,
        api_key_env,
        extra_headers,
    })
}

fn apply_config_patch(
    snapshot: &mut sessions::SessionSnapshot,
    request: UpdateConfigRequest,
) -> Result<()> {
    match request.model {
        RequestField::Omitted => {}
        RequestField::Null => {
            return Err(request_configuration_error(
                "invalid model configuration: required field 'model' cannot be null",
            ));
        }
        RequestField::Value(value) => snapshot.model = nonblank_request_string(value, "model")?,
    }
    match request.base_url {
        RequestField::Omitted => {}
        RequestField::Null => {
            return Err(request_configuration_error(
                "invalid model configuration: required field 'base_url' cannot be null",
            ));
        }
        RequestField::Value(value) => {
            snapshot.base_url = nonblank_request_string(value, "base_url")?;
        }
    }
    match request.backend {
        RequestField::Omitted => {}
        RequestField::Null => {
            return Err(request_configuration_error(
                "invalid model configuration: required field 'backend' cannot be null",
            ));
        }
        RequestField::Value(value) => {
            let value = nonblank_request_string(value, "backend")?;
            snapshot.backend = parse_request_enum::<BackendKind>(&value, "backend")?;
        }
    }
    match request.reasoning_effort {
        RequestField::Omitted => {}
        RequestField::Null => snapshot.reasoning_effort = None,
        RequestField::Value(value) => {
            let value = nonblank_request_string(value, "reasoning_effort")?;
            snapshot.reasoning_effort = Some(parse_request_enum::<ReasoningEffort>(
                &value,
                "reasoning_effort",
            )?);
        }
    }
    match request.api_key_env {
        RequestField::Omitted => {}
        RequestField::Null => snapshot.api_key_env = None,
        RequestField::Value(value) => {
            snapshot.api_key_env = Some(value);
        }
    }
    match request.extra_headers {
        RequestField::Omitted => {}
        RequestField::Null => snapshot.extra_headers.clear(),
        RequestField::Value(HeadersRequest(headers)) => snapshot.extra_headers = headers,
    }
    Ok(())
}

fn parse_request_enum<T>(value: &str, field: &str) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(serde_json::Value::String(value.to_string())).map_err(|error| {
        request_configuration_error(format!(
            "invalid model configuration: invalid '{field}' value '{value}': {error}"
        ))
    })
}

fn sandbox_options(request: SandboxRequest) -> SandboxOptions {
    SandboxOptions {
        sandbox: request.enabled,
        no_mount_cwd: request.no_mount_cwd,
        mounts: request.mounts,
        mounts_ro: request.mounts_ro,
        sandbox_image: request.image,
        sandbox_gpus: request.gpus,
        sandbox_shm_size: request.shm_size,
        sandbox_session_key: request.session_key,
        sandbox_workdir: request.workdir,
        sandbox_backend: request.backend,
        sandbox_cpus: request.cpus,
        sandbox_mem: request.memory_mib,
    }
}

fn sandbox_requested(request: &SandboxRequest) -> bool {
    request.enabled
        || request.no_mount_cwd
        || !request.mounts.is_empty()
        || !request.mounts_ro.is_empty()
        || request.image.is_some()
        || !request.gpus.is_empty()
        || request.shm_size.is_some()
        || request.session_key.is_some()
        || request.workdir.is_some()
}

fn submit_error_to_anyhow(error: SessionSubmitError) -> anyhow::Error {
    match error {
        SessionSubmitError::Busy { active_run } => anyhow!(
            "session is busy with run {} ({})",
            active_run.run_id,
            active_run.prompt_preview
        ),
    }
}

fn submit_response(handle: SessionRunHandle, display_prompt: String) -> SubmitPromptResponse {
    SubmitPromptResponse {
        run_id: handle.run_id.to_string(),
        client_id: handle
            .client_id
            .as_ref()
            .map(|client_id| client_id.to_string()),
        display_prompt,
    }
}

fn frontend_command_name(command: FrontendCommand) -> &'static str {
    match command {
        FrontendCommand::Exit => "exit",
        FrontendCommand::Sessions => "sessions",
        FrontendCommand::Help => "help",
    }
}

fn session_event_stream(
    replay_boundary_sequence_id: u64,
    replay_gap: Option<SessionReplayGap>,
    replayed_events: Vec<SessionEventEnvelope>,
    mut receiver: SessionEventReceiver,
) -> impl futures_core::Stream<Item = std::result::Result<Event, Infallible>> {
    let mut replayed_events = VecDeque::from(replayed_events);
    stream! {
        yield Ok(sse_json_event(
            "replay_boundary",
            None,
            &ReplayBoundaryEvent {
                replay_boundary_sequence_id,
            },
        ));

        if let Some(replay_gap) = replay_gap {
            yield Ok(sse_json_event("replay_gap", None, &ReplayGapEvent { replay_gap }));
        }

        while let Some(envelope) = replayed_events.pop_front() {
            yield Ok(sse_envelope_event(&envelope));
        }

        loop {
            match receiver.recv().await {
                Ok(envelope) => yield Ok(sse_envelope_event(&envelope)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                    let payload = serde_json::json!({ "missed": count });
                    yield Ok(sse_json_event("lagged", None, &payload));
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    }
}

fn sse_envelope_event(envelope: &SessionEventEnvelope) -> Event {
    sse_json_event(
        "session_event",
        Some(envelope.sequence_id.to_string()),
        envelope,
    )
}

fn sse_json_event<T: Serialize>(event: &str, id: Option<String>, payload: &T) -> Event {
    let data = serde_json::to_string(payload).unwrap_or_else(|error| {
        serde_json::json!({ "error": format!("failed to serialize SSE payload: {error}") })
            .to_string()
    });
    let event = Event::default().event(event).data(data);
    match id {
        Some(id) => event.id(id),
        None => event,
    }
}

fn canonicalize_dir(path: PathBuf) -> Result<PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to resolve directory {}", path.display()))
}

fn canonicalize_file(path: PathBuf) -> Result<PathBuf> {
    let resolved = path
        .canonicalize()
        .with_context(|| format!("failed to resolve executable {}", path.display()))?;
    if !resolved.is_file() {
        anyhow::bail!("{} is not a file", resolved.display());
    }
    Ok(resolved)
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    message: String,
}

impl From<JsonRejection> for ApiError {
    fn from(error: JsonRejection) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: format!("invalid JSON request body: {error}"),
        }
    }
}

impl From<sessions::SessionPresentationError> for ApiError {
    fn from(error: sessions::SessionPresentationError) -> Self {
        let status = match &error {
            sessions::SessionPresentationError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            sessions::SessionPresentationError::NotFound(_) => StatusCode::NOT_FOUND,
            sessions::SessionPresentationError::Conflict(_)
            | sessions::SessionPresentationError::Busy(_) => StatusCode::CONFLICT,
            sessions::SessionPresentationError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<sessions::SessionConfigUpdateError> for ApiError {
    fn from(error: sessions::SessionConfigUpdateError) -> Self {
        let status = match &error {
            sessions::SessionConfigUpdateError::NotFound(_) => StatusCode::NOT_FOUND,
            sessions::SessionConfigUpdateError::Conflict(_) => StatusCode::CONFLICT,
            sessions::SessionConfigUpdateError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        let message = error.to_string();
        let status = if let Some(error) = error.downcast_ref::<sessions::SessionConfigUpdateError>()
        {
            match error {
                sessions::SessionConfigUpdateError::NotFound(_) => StatusCode::NOT_FOUND,
                sessions::SessionConfigUpdateError::Conflict(_) => StatusCode::CONFLICT,
                sessions::SessionConfigUpdateError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
            }
        } else if error.downcast_ref::<ModelConfigurationError>().is_some()
            || error.downcast_ref::<RequestConfigurationError>().is_some()
            || message.contains("invalid model configuration")
        {
            StatusCode::BAD_REQUEST
        } else if message.contains("was not found")
            || message.contains("not found")
            || message.contains("unknown host")
        {
            StatusCode::NOT_FOUND
        } else if message.contains("busy") || message.contains("no active run") {
            StatusCode::CONFLICT
        } else if message.contains("not supported")
            || message.contains("cancellation is not supported")
        {
            StatusCode::NOT_IMPLEMENTED
        } else if message.contains("invalid")
            || message.contains("prompt is empty")
            || message.contains("frontend command")
        {
            StatusCode::BAD_REQUEST
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        Self { status, message }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(serde_json::json!({
                "error": self.message,
            })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_request_fields_distinguish_omitted_null_and_values() {
        let request: CreateSessionRequest = serde_json::from_str(
            r#"{
                "model":" model-a ",
                "base_url":null,
                "backend":"openai-responses",
                "reasoning_effort":"xhigh",
                "api_key_env":null,
                "extra_headers":{"X-Trace":"launch"}
            }"#,
        )
        .unwrap();

        assert_eq!(request.model, RequestField::Value(" model-a ".to_string()));
        assert_eq!(request.base_url, RequestField::Null);
        assert_eq!(
            request.backend,
            RequestField::Value("openai-responses".to_string())
        );
        assert_eq!(
            request.reasoning_effort,
            RequestField::Value("xhigh".to_string())
        );
        assert_eq!(request.api_key_env, RequestField::Null);
        assert_eq!(
            request.extra_headers,
            RequestField::Value(HeadersRequest(BTreeMap::from([(
                "X-Trace".to_string(),
                "launch".to_string()
            )])))
        );
        assert_eq!(request.cwd, None);
    }

    #[test]
    fn create_resolution_inherits_overrides_and_explicitly_clears_optional_config() {
        let mut config = NacConfig::default();
        config.model.reasoning_effort = Some(ReasoningEffort::Medium);
        config.model.api_key_env = Some("CONFIG_KEY".to_string());
        config
            .model
            .extra_headers
            .insert("X-Config".to_string(), "yes".to_string());

        let inherited = model_options(
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Omitted,
        )
        .unwrap();
        assert_eq!(inherited.reasoning_effort, OptionalModelOption::Inherit);
        assert_eq!(inherited.api_key_env, OptionalModelOption::Inherit);
        assert_eq!(inherited.extra_headers, None);
        assert_eq!(config.model.api_key_env.as_deref(), Some("CONFIG_KEY"));

        let explicit = model_options(
            RequestField::Value(" model-a ".to_string()),
            RequestField::Value(" https://example.com/v1 ".to_string()),
            RequestField::Value("openai-responses".to_string()),
            RequestField::Value("xhigh".to_string()),
            RequestField::Null,
            RequestField::Null,
        )
        .unwrap();
        assert_eq!(explicit.api_model.as_deref(), Some("model-a"));
        assert_eq!(
            explicit.api_base_url.as_deref(),
            Some("https://example.com/v1")
        );
        assert_eq!(explicit.backend, Some(BackendKind::OpenAiResponses));
        assert_eq!(
            explicit.reasoning_effort,
            OptionalModelOption::Value(ReasoningEffort::Xhigh)
        );
        assert_eq!(explicit.api_key_env, OptionalModelOption::Clear);
        assert_eq!(explicit.extra_headers, Some(BTreeMap::new()));
        assert_eq!(config.model.api_key_env.as_deref(), Some("CONFIG_KEY"));

        let raw_selector = " SELECTED_KEY ";
        let selected = model_options(
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Omitted,
            RequestField::Value(raw_selector.to_string()),
            RequestField::Omitted,
        )
        .unwrap();
        assert_eq!(
            selected.api_key_env,
            OptionalModelOption::Value(raw_selector.to_string())
        );
    }

    #[test]
    fn null_required_and_blank_concrete_create_fields_are_bad_requests() {
        for field in ["model", "base_url", "backend"] {
            let json = format!(r#"{{"{field}":null}}"#);
            let request: CreateSessionRequest = serde_json::from_str(&json).unwrap();
            let error = model_options(
                request.model,
                request.base_url,
                request.backend,
                request.reasoning_effort,
                request.api_key_env,
                request.extra_headers,
            )
            .unwrap_err();
            assert!(error.downcast_ref::<RequestConfigurationError>().is_some());
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        }
    }

    #[test]
    fn headers_prefer_objects_and_accept_only_valid_legacy_object_strings() {
        let object: CreateSessionRequest =
            serde_json::from_str(r#"{"extra_headers":{"X-Test":"yes"}}"#).unwrap();
        let legacy: CreateSessionRequest =
            serde_json::from_str(r#"{"extra_headers":"{\"X-Test\":\"yes\"}"}"#).unwrap();
        assert_eq!(object.extra_headers, legacy.extra_headers);

        for invalid in [
            r#"{"extra_headers":"   "}"#,
            r#"{"extra_headers":"[1]"}"#,
            r#"{"extra_headers":{"X-Count":3}}"#,
        ] {
            assert!(serde_json::from_str::<CreateSessionRequest>(invalid).is_err());
        }
    }

    #[test]
    fn web_configuration_controls_include_together_and_launch_parity_fields() {
        let html = include_str!("../assets/index.html");
        for select_id in ["launchBackend", "settingsBackend"] {
            let select = html
                .split(&format!("id=\"{select_id}\""))
                .nth(1)
                .and_then(|tail| tail.split("</select>").next())
                .expect("backend select");
            assert!(select.contains("<option value=\"together-chat\">together-chat</option>"));
        }
        assert!(html.contains("id=\"launchApiKeyEnv\""));
        assert!(html.contains("id=\"launchExtraHeaders\""));

        let app = include_str!("../assets/app.js");
        assert!(app.contains("buildLaunchModelPayload"));
        assert!(app.contains("payload.api_key_env = apiKeyEnv"));
        assert!(app.contains("payload.extra_headers = headers"));
        assert!(app.contains("body = buildSettingsPatch"));
    }

    #[test]
    fn grouped_events_and_tiled_threads_assets_expose_their_contracts() {
        let html = include_str!("../assets/index.html");
        for id in ["eventStreamStatus", "eventLog", "threadsView"] {
            assert!(html.contains(&format!("id=\"{id}\"")), "missing {id}");
        }
        assert!(!html.contains("eventViewThreads"));
        assert!(!html.contains("eventViewChronology"));
        assert!(!html.contains("events-view-switch"));
        assert!(html.contains("role=\"status\" aria-live=\"polite\""));
        assert!(html.contains("class=\"event-log event-streams\""));
        assert!(html.contains("class=\"threads-view\" aria-label=\"Thread lifecycle\""));

        let app = include_str!("../assets/app.js");
        let event_lifecycle_order = ["Orchestrator", "Running", "Queued", "Finished"];
        let event_positions: Vec<_> = event_lifecycle_order
            .iter()
            .map(|area| {
                app.find(&format!("renderEventStreamArea(\"{area}\""))
                    .unwrap_or_else(|| panic!("missing dense Events {area} area"))
            })
            .collect();
        assert!(event_positions.windows(2).all(|pair| pair[0] < pair[1]));
        let thread_lifecycle_order = ["Running", "Queued", "Finished"];
        let thread_positions: Vec<_> = thread_lifecycle_order
            .iter()
            .map(|area| {
                app.find(&format!("renderThreadTileArea(\"{area}\""))
                    .unwrap_or_else(|| panic!("missing Threads tile {area} area"))
            })
            .collect();
        assert!(thread_positions.windows(2).all(|pair| pair[0] < pair[1]));

        assert!(app.contains(
            "const orderedStreams = area === \"orchestrator\" ? [...streams] : orderedThreadsByName(streams);"
        ));
        assert!(app.contains("orderedStreams.map((stream) => area === \"orchestrator\""));
        assert!(app.contains("const orderedTiles = orderedThreadTiles(tiles);"));

        assert!(!app.contains("renderThreadTileArea(\"Orchestrator\""));
        assert!(!app.contains("renderOrchestratorThreadTile"));
        assert_eq!(
            app.matches("const orchestrator = deriveOrchestratorPresentation(snapshot, evidence);")
                .count(),
            1,
            "Events must remain the sole Orchestrator presentation consumer"
        );
        assert!(app.contains("class=\"event-stream-tile-grid\""));
        assert!(app.contains("class=\"event-thread-stream event-tone-${tone}\""));
        assert!(app.contains("items.map(renderDenseEventRow)"));
        assert!(app.contains("stream.activity"));
        assert!(!app.contains("stream.allActivity"));
        assert!(!app.contains("[...items].reverse()"));
        assert!(!app.contains("renderEventChronology"));
        assert!(!app.contains("eventsViewBySession"));
        assert!(app.contains("data-thread-key=\"${escapeAttr(key)}\""));
        assert!(app.contains("aria-expanded=\"${expanded ? \"true\" : \"false\"}\""));
        assert!(app.contains("aria-controls=\"${escapeAttr(controlsId)}\""));
        assert!(app.contains("label: \"Timed out\""));
        assert!(app.contains("label: \"Dispatch error\""));
        assert!(app.contains(
            "const terminalError = threadError\n      && evidenceIsNewer(threadError, dispatch.start);"
        ));
        assert!(!app.contains("&& !snapshotActive"));
        assert!(app.contains("label: \"Retained history\""));
        assert!(app.contains("tile.episodes.map(renderThreadEpisode)"));
        assert!(app.contains("const episodes = snapshot?.thread_episodes?.[name] || [];"));
        assert!(app.contains("episodes,\n      retained,"));

        let css = include_str!("../assets/app.css");
        assert!(css.contains("container-name: events"));
        for threshold in [600, 900, 1200] {
            assert!(css.contains(&format!("@container events (min-width: {threshold}px)")));
            assert!(css.contains(&format!("@container threads (min-width: {threshold}px)")));
        }
        assert!(css.contains(".event-stream-area-orchestrator .event-thread-stream"));
        assert!(css.contains(".event-stream-tile-grid"));
        for removed_thread_selector in [
            ".thread-orchestrator-cell",
            ".thread-orchestrator-summary",
            ".thread-orchestrator-card",
        ] {
            assert!(!css.contains(removed_thread_selector));
        }
        for accent_selector in [
            ".event-tone-running",
            ".event-tone-queued",
            ".thread-pulse-card.thread-tone-running",
            ".thread-pulse-card.thread-tone-queued",
            ".thread-tone-running .thread-card-status",
            ".thread-tone-queued .thread-card-status",
        ] {
            assert!(
                !css.contains(accent_selector),
                "lifecycle tile must remain neutral: {accent_selector}"
            );
        }
        assert!(css.contains(".event-thread-stream.event-tone-danger"));
        assert!(css.contains(".thread-pulse-card.thread-tone-danger"));
        assert!(!css.contains("box-shadow: 0 0 12px var(--danger-ring)"));
        assert!(css.contains(".thread-tile-cell.is-expanded"));
        assert!(css.contains("grid-column: 1 / -1"));
        assert!(css.contains(".event-stream-row"));
    }

    #[test]
    fn session_event_envelope_serializes_for_sse_payloads() {
        let envelope = SessionEventEnvelope {
            session_id: Some("session-1".to_string()),
            sequence_id: 42,
            client_id: None,
            run_id: None,
            event: nac_core::events::SessionEvent::RunFailed {
                message: "boom".to_string(),
            },
        };

        let payload = serde_json::to_string(&envelope).unwrap();

        assert!(payload.contains("\"sequence_id\":42"));
        assert!(payload.contains("\"message\":\"boom\""));
    }

    #[test]
    fn invalid_workspace_diff_stage_maps_to_bad_request() {
        let error = view::WorkspaceDiffStage::parse("sideways").unwrap_err();
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
    }

    static SERVER_MODEL_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct ScopedModelEnv {
        original: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl ScopedModelEnv {
        fn isolated(nac_home: &std::path::Path, openai_api_key: Option<&str>) -> Self {
            let names = ["NAC_HOME", "OPENAI_API_KEY", "OPENAI_BASE_URL"];
            let original = names
                .into_iter()
                .map(|name| (name, std::env::var_os(name)))
                .collect();
            unsafe {
                std::env::set_var("NAC_HOME", nac_home);
                match openai_api_key {
                    Some(value) => std::env::set_var("OPENAI_API_KEY", value),
                    None => std::env::remove_var("OPENAI_API_KEY"),
                }
                std::env::remove_var("OPENAI_BASE_URL");
            }
            Self { original }
        }
    }

    impl Drop for ScopedModelEnv {
        fn drop(&mut self) {
            for (name, value) in self.original.drain(..) {
                unsafe {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
            }
        }
    }

    fn write_managed_credential(path: &std::path::Path, contents: impl AsRef<[u8]>) {
        std::fs::write(path, contents).expect("write managed credential");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .expect("set managed credential permissions");
        }
    }

    fn write_codex_auth(nac_home: &std::path::Path) {
        std::fs::create_dir_all(nac_home).expect("create NAC home");
        write_managed_credential(
            &nac_home.join("auth.json"),
            serde_json::json!({
                "type": "chatgpt-codex",
                "access": "codex-server-access",
                "refresh": "codex-server-refresh",
                "expires_at_ms": u64::MAX,
                "account_id": "codex-server-account"
            })
            .to_string(),
        );
    }

    fn write_arcee_auth(nac_home: &std::path::Path, base_url: &str) {
        std::fs::create_dir_all(nac_home).expect("create NAC home");
        write_managed_credential(
            &nac_home.join("arcee_auth.json"),
            serde_json::json!({
                "type": "arcee_api_key",
                "api_key": "rcai-server-test",
                "base_url": base_url,
                "organization_id": "org-server-test",
                "workspace_name": "server-test"
            })
            .to_string(),
        );
    }

    fn temp_root(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("nac_server_test_{}_{}", label, unique));
        std::fs::create_dir_all(&root).expect("create temp root");
        root
    }

    fn test_manager(root: &std::path::Path) -> SessionManager {
        SessionManager::new(ServerOptions {
            root_cwd: root.to_path_buf(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
        })
        .expect("session manager")
    }

    #[test]
    fn create_session_request_deserializes_optional_ssh_host() {
        let with_host: CreateSessionRequest = serde_json::from_str(
            r#"{"ssh_host":"build-box","backend":"together-chat","api_key_env":"TOGETHER_CUSTOM_KEY","extra_headers":"{\"X-Launch\":\"yes\"}"}"#,
        )
        .unwrap();
        assert_eq!(with_host.ssh_host.as_deref(), Some("build-box"));
        assert_eq!(
            with_host.backend,
            RequestField::Value("together-chat".to_string())
        );
        assert_eq!(
            with_host.api_key_env,
            RequestField::Value("TOGETHER_CUSTOM_KEY".to_string())
        );
        assert_eq!(
            with_host.extra_headers,
            RequestField::Value(HeadersRequest(BTreeMap::from([(
                "X-Launch".to_string(),
                "yes".to_string()
            )])))
        );

        let alias_host: CreateSessionRequest =
            serde_json::from_str(r#"{"host_id":"legacy-box"}"#).unwrap();
        assert_eq!(alias_host.ssh_host.as_deref(), Some("legacy-box"));
        assert_eq!(with_host.cwd, None);
        assert!(!with_host.sandbox.enabled);

        let without_host: CreateSessionRequest =
            serde_json::from_str(r#"{"cwd":"/tmp/project"}"#).unwrap();
        assert_eq!(without_host.ssh_host, None);
        assert_eq!(without_host.cwd, Some(PathBuf::from("/tmp/project")));
    }

    #[tokio::test]
    async fn create_session_rejects_ssh_host_combined_with_sandbox() {
        let root = temp_root("host_sandbox_conflict");
        let manager = test_manager(&root);

        let request = CreateSessionRequest {
            cwd: None,
            model: RequestField::Omitted,
            base_url: RequestField::Omitted,
            backend: RequestField::Omitted,
            reasoning_effort: RequestField::Omitted,
            api_key_env: RequestField::Omitted,
            extra_headers: RequestField::Omitted,
            ssh_host: Some("build-box".to_string()),
            sandbox: SandboxRequest {
                enabled: true,
                ..SandboxRequest::default()
            },
        };
        let error = manager.create_session(request).await.unwrap_err();
        assert!(error.to_string().contains("ssh_host and sandbox"));
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn server_create_rejects_removed_backend_names_as_bad_requests() {
        let root = temp_root("removed_backend_create");
        let manager = test_manager(&root);

        for backend in ["arcee", "auto"] {
            let error = manager
                .create_session(CreateSessionRequest {
                    cwd: None,
                    model: RequestField::Omitted,
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value(backend.to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    ssh_host: None,
                    sandbox: SandboxRequest::default(),
                })
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("unsupported backend"),
                "{error:#}"
            );
            assert!(
                error.to_string().contains("settings repair required"),
                "{error:#}"
            );
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        }
        assert!(!root.join("store.db").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn stored_arcee_auth_config_errors_are_400_and_store_failures_are_500() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

        {
            let root = temp_root("arcee_malformed_auth_status");
            let nac_home = root.join("nac-home");
            std::fs::create_dir_all(&nac_home).unwrap();
            write_managed_credential(&nac_home.join("arcee_auth.json"), "{not-json}");
            let _env = ScopedModelEnv::isolated(&nac_home, None);
            seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
            let manager = test_manager(&root);

            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Omitted,
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                    },
                )
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            let response = ApiError::from(error);
            assert_eq!(response.status, StatusCode::BAD_REQUEST);
            assert!(response
                .message
                .contains("failed to parse stored Arcee auth"));
            let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(stored.backend, BackendKind::OpenAiResponses);
            assert_eq!(stored.base_url, "https://api.openai.com/v1");
            let _ = std::fs::remove_dir_all(&root);
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let root = temp_root("arcee_unsafe_auth_permissions");
            let nac_home = root.join("nac-home");
            write_arcee_auth(&nac_home, "https://api.arcee.ai");
            std::fs::set_permissions(
                nac_home.join("arcee_auth.json"),
                std::fs::Permissions::from_mode(0o644),
            )
            .unwrap();
            let _env = ScopedModelEnv::isolated(&nac_home, None);
            seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
            let manager = test_manager(&root);

            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Omitted,
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                    },
                )
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("unsafe permissions 0644"));
            assert!(!format!("{error:#}").contains("rcai-server-test"));
            let response = ApiError::from(error);
            assert_eq!(response.status, StatusCode::BAD_REQUEST);
            assert!(response.message.contains("mode to 0600"));
            let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(stored.backend, BackendKind::OpenAiResponses);
            assert_eq!(stored.base_url, "https://api.openai.com/v1");
            let _ = std::fs::remove_dir_all(&root);
        }

        {
            let root = temp_root("arcee_auth_store_failure_status");
            let nac_home = root.join("nac-home");
            std::fs::create_dir_all(nac_home.join("arcee_auth.json")).unwrap();
            let _env = ScopedModelEnv::isolated(&nac_home, None);
            seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
            let manager = test_manager(&root);

            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Omitted,
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                    },
                )
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert!(format!("{error:#}").contains("non-regular credential path"));
            let response = ApiError::from(error);
            assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
            assert_eq!(response.message, "failed to load stored Arcee credentials");
            let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(stored.backend, BackendKind::OpenAiResponses);
            assert_eq!(stored.base_url, "https://api.openai.com/v1");
            let _ = std::fs::remove_dir_all(&root);
        }
    }

    fn seed_session(root: &std::path::Path, session_id: &str, created_at: &str) {
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
            root.to_path_buf(),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            None,
            BTreeMap::new(),
        );
        snapshot.created_at = created_at.to_string();
        snapshot.updated_at = created_at.to_string();
        sessions::create_session(&root.join("store.db"), &snapshot).expect("seed session");
    }

    fn seed_editable_session(root: &std::path::Path, session_id: &str) {
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
            root.to_path_buf(),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Medium),
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::from([("X-Original".to_string(), "yes".to_string())]),
        );
        snapshot.created_at = "2026-01-01 00:00:00.000000000".to_string();
        snapshot.updated_at = snapshot.created_at.clone();
        sessions::create_session(&root.join("store.db"), &snapshot).expect("seed editable session");
    }

    #[tokio::test]
    async fn server_attach_ignores_invalid_ambient_model_but_create_remains_strict() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("persisted_attach_invalid_ambient_model");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        std::fs::write(
            nac_home.join("config.toml"),
            r#"
[model]
backend = "auto"
api_key_env = ["invalid-selector-shape"]
extra_headers = "invalid-header-shape"

[worker]
thread_timeout_secs = 7200
"#,
        )
        .unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-resume-key"));
        seed_editable_session(&root, "persisted");

        // Server startup, listing, and attachment use only non-model ambient
        // settings; the model tuple and selector come from the stored snapshot.
        let manager = test_manager(&root);
        assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);
        let resumed = manager.snapshot("persisted").await.unwrap();
        assert_eq!(resumed.metadata.session_id.as_deref(), Some("persisted"));

        // A new session still parses the complete model table before doing any
        // persistence, so the same obsolete config remains an actionable error.
        let error = manager
            .create_session(CreateSessionRequest {
                cwd: Some(root.clone()),
                ..CreateSessionRequest::default()
            })
            .await
            .unwrap_err();
        assert!(
            error.to_string().contains("failed to parse config"),
            "{error:#}"
        );
        assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn incomplete_persisted_settings_are_listed_retrievable_and_transactionally_repairable() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("repair_incomplete_settings");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-repair-key"));
        let store_path = root.join("store.db");

        seed_editable_session(&root, "complete");
        seed_session(&root, "missing-selector", "2026-01-02 00:00:00.000000000");
        seed_session(
            &root,
            "missing-environment-value",
            "2026-01-03 00:00:00.000000000",
        );
        let mut missing_value =
            sessions::load_session(&store_path, "missing-environment-value").unwrap();
        missing_value.api_key_env = Some("MISSING_SERVER_REPAIR_KEY".to_string());
        sessions::update_session_model_config(&store_path, &missing_value).unwrap();

        seed_session(
            &root,
            "unavailable-managed-auth",
            "2026-01-04 00:00:00.000000000",
        );
        let mut unavailable_auth =
            sessions::load_session(&store_path, "unavailable-managed-auth").unwrap();
        unavailable_auth.backend = BackendKind::ArceeAuth;
        unavailable_auth.base_url = "https://api.arcee.ai".to_string();
        unavailable_auth.api_key_env = None;
        sessions::update_session_model_config(&store_path, &unavailable_auth).unwrap();

        let manager = test_manager(&root);
        let Json(endpoint_config) = session_config_handler(
            State(manager.clone()),
            AxumPath("missing-selector".to_string()),
        )
        .await
        .unwrap();
        assert_eq!(endpoint_config.session_id, "missing-selector");
        assert!(!serde_json::to_string(&endpoint_config)
            .unwrap()
            .contains("server-repair-key"));

        let listed = manager.list_sessions(false).await.unwrap();
        let listed_ids = listed
            .iter()
            .map(|entry| entry.summary.session_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(listed_ids.len(), 4);
        for expected in [
            "complete",
            "missing-selector",
            "missing-environment-value",
            "unavailable-managed-auth",
        ] {
            assert!(
                listed_ids.contains(expected),
                "missing listed session {expected}"
            );
        }

        let missing_selector = manager.session_config("missing-selector").unwrap();
        assert_eq!(missing_selector.backend, BackendKind::OpenAiResponses);
        assert_eq!(missing_selector.api_key_env, None);
        let missing_environment = manager.session_config("missing-environment-value").unwrap();
        assert_eq!(
            missing_environment.api_key_env.as_deref(),
            Some("MISSING_SERVER_REPAIR_KEY")
        );
        let unavailable_managed = manager.session_config("unavailable-managed-auth").unwrap();
        assert_eq!(unavailable_managed.backend, BackendKind::ArceeAuth);
        assert_eq!(unavailable_managed.api_key_env, None);
        assert!(
            manager.inner.active_sessions.read().await.is_empty(),
            "reading persisted settings must not attach any session"
        );

        for session_id in [
            "missing-selector",
            "missing-environment-value",
            "unavailable-managed-auth",
        ] {
            let error = manager.snapshot(session_id).await.unwrap_err();
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        }
        assert!(manager.inner.active_sessions.read().await.is_empty());

        for session_id in ["missing-selector", "missing-environment-value"] {
            manager
                .update_session_config(
                    session_id,
                    UpdateConfigRequest {
                        api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
                .expect("API-key session should be repairable with an available selector");
            assert_eq!(
                manager
                    .session_config(session_id)
                    .unwrap()
                    .api_key_env
                    .as_deref(),
                Some("OPENAI_API_KEY")
            );
        }

        manager
            .update_session_config(
                "unavailable-managed-auth",
                UpdateConfigRequest {
                    base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                    backend: RequestField::Value("arcee-api".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("unavailable managed auth should be repairable by switching credential mode");
        let repaired_auth = manager.session_config("unavailable-managed-auth").unwrap();
        assert_eq!(repaired_auth.backend, BackendKind::ArceeApi);
        assert_eq!(repaired_auth.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

        let before_failed_repair = manager.session_config("missing-selector").unwrap();
        let error = manager
            .update_session_config(
                "missing-selector",
                UpdateConfigRequest {
                    api_key_env: RequestField::Value("MISSING_SERVER_REPAIR_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert_eq!(
            manager.session_config("missing-selector").unwrap(),
            before_failed_repair,
            "failed repair must leave persisted settings unchanged"
        );

        let listed_after_repairs = manager.list_sessions(false).await.unwrap();
        assert_eq!(listed_after_repairs.len(), 4);
        let _ = std::fs::remove_dir_all(&root);
    }

    async fn point_session_at_hanging_endpoint(
        root: &std::path::Path,
        session_id: &str,
    ) -> tokio::task::JoinHandle<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut snapshot = sessions::load_session(&root.join("store.db"), session_id).unwrap();
        snapshot.base_url = format!("http://{address}/v1");
        sessions::update_session_model_config(&root.join("store.db"), &snapshot).unwrap();

        tokio::spawn(async move {
            if let Ok((socket, _)) = listener.accept().await {
                let _socket = socket;
                std::future::pending::<()>().await;
            }
        })
    }

    #[tokio::test]
    async fn submission_winning_lifecycle_gate_makes_concurrent_patch_reject_busy() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("submit_before_patch");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
        let manager = test_manager(&root);
        let original_service = manager.attach_session("session").await.unwrap();

        let gate = manager.lifecycle_gate("session");
        let blocker = gate.lock().await;
        let (submit_started_tx, submit_started_rx) = tokio::sync::oneshot::channel();
        let submit_manager = manager.clone();
        let submit = tokio::spawn(async move {
            submit_started_tx.send(()).unwrap();
            submit_manager
                .submit_prompt(
                    "session",
                    SubmitPromptRequest {
                        prompt: "hold this run open".to_string(),
                    },
                )
                .await
        });
        submit_started_rx.await.unwrap();
        tokio::task::yield_now().await;

        let (patch_started_tx, patch_started_rx) = tokio::sync::oneshot::channel();
        let patch_manager = manager.clone();
        let patch = tokio::spawn(async move {
            patch_started_tx.send(()).unwrap();
            patch_manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Value("model-after-update".to_string()),
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
        });
        patch_started_rx.await.unwrap();
        tokio::task::yield_now().await;
        assert!(!submit.is_finished());
        assert!(!patch.is_finished());

        drop(blocker);
        let submitted = tokio::time::timeout(Duration::from_secs(2), submit)
            .await
            .expect("submission should acquire the gate")
            .unwrap()
            .unwrap();
        let patch_error = tokio::time::timeout(Duration::from_secs(2), patch)
            .await
            .expect("patch should run after submission")
            .unwrap()
            .unwrap_err();
        assert!(patch_error.to_string().contains("busy with an active run"));
        assert_eq!(ApiError::from(patch_error).status, StatusCode::CONFLICT);
        assert_eq!(
            sessions::load_session(&root.join("store.db"), "session")
                .unwrap()
                .model,
            "model-a"
        );
        let mapped = manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .cloned()
            .unwrap();
        assert!(Arc::ptr_eq(&mapped, &original_service));
        assert_eq!(
            mapped.active_run().unwrap().run_id.as_str(),
            submitted.run_id
        );

        manager.cancel_active_run("session").await.unwrap();
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn patch_winning_lifecycle_gate_evicts_before_concurrent_submission_attaches() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("patch_before_submit");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
        let manager = test_manager(&root);
        let stale_service = manager.attach_session("session").await.unwrap();

        let gate = manager.lifecycle_gate("session");
        let blocker = gate.lock().await;
        let (patch_started_tx, patch_started_rx) = tokio::sync::oneshot::channel();
        let patch_manager = manager.clone();
        let patch = tokio::spawn(async move {
            patch_started_tx.send(()).unwrap();
            patch_manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Value("model-after-update".to_string()),
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
        });
        patch_started_rx.await.unwrap();
        tokio::task::yield_now().await;

        let (submit_started_tx, submit_started_rx) = tokio::sync::oneshot::channel();
        let submit_manager = manager.clone();
        let submit = tokio::spawn(async move {
            submit_started_tx.send(()).unwrap();
            submit_manager
                .submit_prompt(
                    "session",
                    SubmitPromptRequest {
                        prompt: "use committed settings".to_string(),
                    },
                )
                .await
        });
        submit_started_rx.await.unwrap();
        tokio::task::yield_now().await;
        assert!(!patch.is_finished());
        assert!(!submit.is_finished());

        drop(blocker);
        tokio::time::timeout(Duration::from_secs(2), patch)
            .await
            .expect("patch should acquire the gate")
            .unwrap()
            .unwrap();
        let submitted = tokio::time::timeout(Duration::from_secs(2), submit)
            .await
            .expect("submission should run after patch")
            .unwrap()
            .unwrap();
        let mapped = manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .cloned()
            .unwrap();
        assert!(!Arc::ptr_eq(&mapped, &stale_service));
        assert_eq!(mapped.metadata().model, "model-after-update");
        assert!(stale_service.active_run().is_none());
        assert_eq!(
            mapped.active_run().unwrap().run_id.as_str(),
            submitted.run_id
        );
        assert_eq!(
            sessions::load_session(&root.join("store.db"), "session")
                .unwrap()
                .model,
            "model-after-update"
        );

        manager.cancel_active_run("session").await.unwrap();
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn independent_managers_reject_concurrent_config_conflict() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cross_manager_config_conflict");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let first_manager = test_manager(&root);
        let second_manager = test_manager(&root);
        let both_loaded = Arc::new(tokio::sync::Barrier::new(2));
        *first_manager.inner.config_update_after_load.lock().unwrap() = Some(both_loaded.clone());
        *second_manager
            .inner
            .config_update_after_load
            .lock()
            .unwrap() = Some(both_loaded);

        let first = tokio::spawn(async move {
            first_manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Value("first-model".to_string()),
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
        });
        let second = tokio::spawn(async move {
            second_manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Value("second-model".to_string()),
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
        });
        let results = [first.await.unwrap(), second.await.unwrap()];
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let conflict = results
            .into_iter()
            .find_map(Result::err)
            .expect("one manager must lose the configuration CAS");
        assert!(matches!(
            conflict.downcast_ref::<sessions::SessionConfigUpdateError>(),
            Some(sessions::SessionConfigUpdateError::Conflict(_))
        ));
        assert!(conflict
            .to_string()
            .contains("configuration changed concurrently"));
        assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);

        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert!(matches!(
            stored.model.as_str(),
            "first-model" | "second-model"
        ));
        assert_eq!(stored.config_version, 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn empty_patch_does_not_touch_store_credentials_or_attached_service() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("empty_patch_noop");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let manager = test_manager(&root);
        let before = manager.attach_session("session").await.unwrap();
        let before_metadata = before.metadata();
        let store_path = root.join("store.db");
        let hidden_store = root.join("store.db.hidden");
        std::fs::rename(&store_path, &hidden_store).unwrap();
        std::fs::create_dir(&store_path).unwrap();
        unsafe { std::env::remove_var("OPENAI_API_KEY") };

        manager
            .update_session_config("session", UpdateConfigRequest::default())
            .await
            .expect("an empty patch must not read the store or credentials");

        let after = manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .cloned()
            .expect("empty patch must preserve attached service");
        assert!(Arc::ptr_eq(&before, &after));
        assert_eq!(after.metadata().model, before_metadata.model);
        assert_eq!(after.metadata().base_url, before_metadata.base_url);
        assert_eq!(after.active_run(), None);

        std::fs::remove_dir(&store_path).unwrap();
        std::fs::rename(hidden_store, store_path).unwrap();
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.model, "model-a");
        assert_eq!(stored.updated_at, "2026-01-01 00:00:00.000000000");
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_inherits_overrides_and_null_clears_optional_config() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("create_tristate");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        std::fs::write(
            nac_home.join("config.toml"),
            r#"[model]
backend = "openai-responses"
model = "config-model"
base_url = "https://api.openai.com/v1"
reasoning_effort = "medium"
api_key_env = "OPENAI_API_KEY"
extra_headers = { X-Config = "yes" }
"#,
        )
        .unwrap();
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        let manager = test_manager(&root);

        let inherited = manager
            .create_session(CreateSessionRequest::default())
            .await
            .expect("omitted fields should inherit config");
        let inherited_id = inherited.metadata.session_id.unwrap();
        let stored = sessions::load_session(&root.join("store.db"), &inherited_id).unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.model, "config-model");
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(
            stored.extra_headers,
            BTreeMap::from([("X-Config".to_string(), "yes".to_string())])
        );

        let cleared = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("explicit-model".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Null,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .expect("explicit values and null optional fields should override config");
        let cleared_id = cleared.metadata.session_id.unwrap();
        let stored = sessions::load_session(&root.join("store.db"), &cleared_id).unwrap();
        assert_eq!(stored.backend, BackendKind::ArceeAuth);
        assert_eq!(stored.model, "explicit-model");
        assert_eq!(stored.reasoning_effort, None);
        assert_eq!(stored.api_key_env, None);
        assert!(stored.extra_headers.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn codex_create_preflights_endpoint_and_managed_credentials_before_persistence() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

        for (label, base_url, auth, expected_status, expected) in [
            (
                "codex-create-missing",
                "https://chatgpt.com/backend-api",
                None,
                StatusCode::BAD_REQUEST,
                "not configured",
            ),
            (
                "codex-create-malformed",
                "https://chatgpt.com/backend-api",
                Some("{not-json}"),
                StatusCode::BAD_REQUEST,
                "failed to parse",
            ),
            (
                "codex-create-blank",
                "https://chatgpt.com/backend-api",
                Some(
                    r#"{"type":"chatgpt-codex","access":"secret-must-not-leak","refresh":"","expires_at_ms":1,"account_id":"account"}"#,
                ),
                StatusCode::BAD_REQUEST,
                "nonblank field 'refresh'",
            ),
            (
                "codex-create-endpoint",
                "http://chatgpt.com/backend-api",
                Some(
                    r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":"account"}"#,
                ),
                StatusCode::BAD_REQUEST,
                "requires HTTPS",
            ),
        ] {
            let root = temp_root(label);
            let nac_home = root.join("nac-home");
            std::fs::create_dir_all(&nac_home).unwrap();
            if let Some(auth) = auth {
                write_managed_credential(&nac_home.join("auth.json"), auth);
            }
            let _env = ScopedModelEnv::isolated(&nac_home, None);
            let manager = test_manager(&root);
            let error = manager
                .create_session(CreateSessionRequest {
                    model: RequestField::Value("gpt-test".to_string()),
                    base_url: RequestField::Value(base_url.to_string()),
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    api_key_env: RequestField::Null,
                    ..CreateSessionRequest::default()
                })
                .await
                .expect_err("invalid Codex setup must fail creation");
            assert!(error.to_string().contains(expected), "{error:#}");
            assert!(!format!("{error:#}").contains("secret-must-not-leak"));
            assert_eq!(ApiError::from(error).status, expected_status);
            assert!(!root.join("store.db").exists());
            drop(_env);
            let _ = std::fs::remove_dir_all(root);
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let root = temp_root("codex-create-symlink");
            let nac_home = root.join("nac-home");
            std::fs::create_dir_all(&nac_home).unwrap();
            let target = nac_home.join("target.json");
            std::fs::write(&target, "secret-target").unwrap();
            symlink(&target, nac_home.join("auth.json")).unwrap();
            let _env = ScopedModelEnv::isolated(&nac_home, None);
            let manager = test_manager(&root);
            let error = manager
                .create_session(CreateSessionRequest {
                    model: RequestField::Value("gpt-test".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    api_key_env: RequestField::Null,
                    ..CreateSessionRequest::default()
                })
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert_eq!(
                ApiError::from(error).status,
                StatusCode::INTERNAL_SERVER_ERROR
            );
            assert!(!root.join("store.db").exists());
            assert_eq!(std::fs::read_to_string(target).unwrap(), "secret-target");
            drop(_env);
            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[tokio::test]
    async fn codex_resume_preflights_missing_credentials() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("codex-resume-missing");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let mut stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        stored.backend = BackendKind::ChatGptCodexResponses;
        stored.base_url = "https://chatgpt.com/backend-api".to_string();
        stored.api_key_env = None;
        sessions::update_session_model_config(&root.join("store.db"), &stored).unwrap();
        let manager = test_manager(&root);

        let error = manager
            .attach_session("session")
            .await
            .err()
            .expect("resume without Codex auth must fail");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("not configured"));
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert!(!manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn codex_patch_failures_roll_back_database_and_active_service() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("codex-patch-rollback");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let manager = test_manager(&root);
        manager.attach_session("session").await.unwrap();
        let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

        for (auth, base_url, expected_status) in [
            (
                "{not-json}",
                "https://chatgpt.com/backend-api",
                StatusCode::BAD_REQUEST,
            ),
            (
                r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
                "https://attacker.example/backend-api",
                StatusCode::BAD_REQUEST,
            ),
        ] {
            write_managed_credential(&nac_home.join("auth.json"), auth);
            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                        base_url: RequestField::Value(base_url.to_string()),
                        api_key_env: RequestField::Null,
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
                .unwrap_err();
            assert_eq!(ApiError::from(error).status, expected_status);
            let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(after.backend, before.backend);
            assert_eq!(after.base_url, before.base_url);
            assert_eq!(after.api_key_env, before.api_key_env);
            assert!(manager
                .inner
                .active_sessions
                .read()
                .await
                .contains_key("session"));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            write_codex_auth(&nac_home);
            std::fs::set_permissions(
                nac_home.join("auth.json"),
                std::fs::Permissions::from_mode(0o660),
            )
            .unwrap();
            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                        base_url: RequestField::Value(
                            "https://chatgpt.com/backend-api".to_string(),
                        ),
                        api_key_env: RequestField::Null,
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("unsafe permissions 0660"));
            assert!(!format!("{error:#}").contains("codex-server-access"));
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
            let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(after.backend, before.backend);
            assert_eq!(after.base_url, before.base_url);
            assert_eq!(after.api_key_env, before.api_key_env);
            assert!(manager
                .inner
                .active_sessions
                .read()
                .await
                .contains_key("session"));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            std::fs::remove_file(nac_home.join("auth.json")).unwrap();
            let target = nac_home.join("patch-target.json");
            std::fs::write(&target, "secret-target").unwrap();
            symlink(&target, nac_home.join("auth.json")).unwrap();
            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                        base_url: RequestField::Value(
                            "https://chatgpt.com/backend-api".to_string(),
                        ),
                        api_key_env: RequestField::Null,
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert_eq!(
                ApiError::from(error).status,
                StatusCode::INTERNAL_SERVER_ERROR
            );
            let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(after.backend, before.backend);
            assert_eq!(after.base_url, before.base_url);
            assert!(manager
                .inner
                .active_sessions
                .read()
                .await
                .contains_key("session"));
            assert_eq!(std::fs::read_to_string(target).unwrap(), "secret-target");
        }

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_rejects_raw_invalid_selectors_without_persisting() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("create_invalid_selectors");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let store_path = root.join("store.db");

        for (backend, base_url, selector) in [
            ("openai-responses", "https://api.openai.com/v1", ""),
            ("openai-responses", "https://api.openai.com/v1", "   "),
            (
                "openai-responses",
                "https://api.openai.com/v1",
                " SURROUNDED_KEY ",
            ),
            ("arcee-auth", "https://api.arcee.ai", ""),
            ("arcee-auth", "https://api.arcee.ai", "   "),
        ] {
            let error = manager
                .create_session(CreateSessionRequest {
                    model: RequestField::Value("test-model".to_string()),
                    base_url: RequestField::Value(base_url.to_string()),
                    backend: RequestField::Value(backend.to_string()),
                    api_key_env: RequestField::Value(selector.to_string()),
                    ..CreateSessionRequest::default()
                })
                .await
                .expect_err("invalid selector must fail creation");
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
            assert!(
                !store_path.exists(),
                "invalid selector {selector:?} must fail before persistence"
            );
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn create_rejects_unsupported_reasoning_before_persisting() {
        let root = temp_root("create_invalid_reasoning");
        let manager = test_manager(&root);
        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("test-model".to_string()),
                base_url: RequestField::Value("https://api.together.xyz/v1".to_string()),
                backend: RequestField::Value("together-chat".to_string()),
                reasoning_effort: RequestField::Value("minimal".to_string()),
                api_key_env: RequestField::Value("UNREAD_REASONING_TEST_KEY".to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("unsupported effort must fail creation");
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("minimal"), "{error:#}");
        assert!(error.to_string().contains("together-chat"), "{error:#}");
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert!(!root.join("store.db").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn patch_round_trips_every_state_and_rebuilds_from_persisted_settings() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("patch_tristate");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        write_codex_auth(&nac_home);
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let manager = test_manager(&root);

        manager.attach_session("session").await.unwrap();
        assert!(manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value(" replacement-model ".to_string()),
                    base_url: RequestField::Value(" https://api.openai.com/v1 ".to_string()),
                    backend: RequestField::Value("openai-responses".to_string()),
                    reasoning_effort: RequestField::Value("high".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                        "X-Replaced".to_string(),
                        "true".to_string(),
                    )]))),
                },
            )
            .await
            .unwrap();
        assert!(!manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));
        let replaced = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(replaced.model, "replacement-model");
        assert_eq!(replaced.reasoning_effort, Some(ReasoningEffort::High));
        assert_eq!(replaced.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(replaced.extra_headers.get("X-Replaced").unwrap(), "true");

        manager.attach_session("session").await.unwrap();
        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-auth".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    reasoning_effort: RequestField::Null,
                    api_key_env: RequestField::Null,
                    extra_headers: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("switch to stored Arcee auth");
        let arcee_auth = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(arcee_auth.backend, BackendKind::ArceeAuth);
        assert_eq!(arcee_auth.reasoning_effort, None);
        assert_eq!(arcee_auth.api_key_env, None);
        assert!(arcee_auth.extra_headers.is_empty());

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-api".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("switch to Arcee API key mode");
        assert_eq!(
            sessions::load_session(&root.join("store.db"), "session")
                .unwrap()
                .backend,
            BackendKind::ArceeApi
        );

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    api_key_env: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("switch to Codex stored OAuth mode");
        let codex = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(codex.backend, BackendKind::ChatGptCodexResponses);
        assert_eq!(codex.api_key_env, None);

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("openai-responses".to_string()),
                    base_url: RequestField::Value("https://api.openai.com/v1".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    extra_headers: RequestField::Value(HeadersRequest(BTreeMap::new())),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("switch back to API-key mode");
        let api_key = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(api_key.backend, BackendKind::OpenAiResponses);
        assert_eq!(api_key.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert!(api_key.extra_headers.is_empty());

        let before_omitted = api_key;
        manager
            .update_session_config("session", UpdateConfigRequest::default())
            .await
            .expect("omitted fields preserve snapshot");
        let after_omitted = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after_omitted.model, before_omitted.model);
        assert_eq!(after_omitted.base_url, before_omitted.base_url);
        assert_eq!(after_omitted.backend, before_omitted.backend);
        assert_eq!(after_omitted.api_key_env, before_omitted.api_key_env);
        assert_eq!(after_omitted.extra_headers, before_omitted.extra_headers);

        manager.attach_session("session").await.unwrap();
        let rebuilt = manager.snapshot("session").await.unwrap();
        assert_eq!(rebuilt.metadata.model, "replacement-model");
        assert_eq!(rebuilt.metadata.backend, "openai-responses");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn invalid_patches_preserve_database_and_active_service() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("patch_rollback");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let manager = test_manager(&root);
        manager.attach_session("session").await.unwrap();

        let invalid = [
            UpdateConfigRequest {
                model: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                base_url: RequestField::Value("   ".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                backend: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                api_key_env: RequestField::Null,
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                api_key_env: RequestField::Value("   ".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                api_key_env: RequestField::Value(" SURROUNDED_KEY ".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                backend: RequestField::Value("arcee-auth".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                api_key_env: RequestField::Value("   ".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                api_key_env: RequestField::Value("MISSING_SERVER_KEY".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "bad header".to_string(),
                    "value".to_string(),
                )]))),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "Authorization".to_string(),
                    "must-not-append".to_string(),
                )]))),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                    "X-API-KEY".to_string(),
                    "must-not-append".to_string(),
                )]))),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                backend: RequestField::Value("together-chat".to_string()),
                reasoning_effort: RequestField::Value("xhigh".to_string()),
                ..UpdateConfigRequest::default()
            },
        ];

        for request in invalid {
            let error = manager
                .update_session_config("session", request)
                .await
                .unwrap_err();
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
            let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(stored.model, "model-a");
            assert_eq!(stored.base_url, "https://api.openai.com/v1");
            assert_eq!(stored.backend, BackendKind::OpenAiResponses);
            assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
            assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
            assert_eq!(stored.extra_headers.get("X-Original").unwrap(), "yes");
            assert!(manager
                .inner
                .active_sessions
                .read()
                .await
                .contains_key("session"));
        }

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn removed_backend_updates_are_bad_requests_and_are_not_persisted() {
        let root = temp_root("removed_backend_update");
        seed_session(&root, "session", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        for backend in ["arcee", "auto"] {
            let error = manager
                .update_session_config(
                    "session",
                    UpdateConfigRequest {
                        model: RequestField::Omitted,
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value(backend.to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                    },
                )
                .await
                .unwrap_err();
            assert!(
                error.to_string().contains("unsupported backend"),
                "{error:#}"
            );
            assert!(
                error.to_string().contains("settings repair required"),
                "{error:#}"
            );
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);

            let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
            assert_eq!(stored.backend, BackendKind::OpenAiResponses);
            assert_eq!(stored.base_url, "https://api.openai.com/v1");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn server_arcee_configuration_status_and_persistence_are_consistent() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("arcee_config_status");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://tenant.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let store_path = root.join("store.db");

        let create_error = manager
            .create_session(CreateSessionRequest {
                cwd: None,
                model: RequestField::Omitted,
                base_url: RequestField::Value("http://api.arcee.ai/insecure".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                ssh_host: None,
                sandbox: SandboxRequest::default(),
            })
            .await
            .unwrap_err();
        assert!(create_error
            .downcast_ref::<ModelConfigurationError>()
            .is_some());
        assert_eq!(ApiError::from(create_error).status, StatusCode::BAD_REQUEST);
        assert!(
            !store_path.exists(),
            "invalid create must fail before initializing session storage"
        );

        seed_session(&root, "attach-invalid", "2026-01-01 00:00:00.000000000");
        let mut attach_snapshot = sessions::load_session(&store_path, "attach-invalid").unwrap();
        attach_snapshot.backend = BackendKind::ArceeApi;
        attach_snapshot.base_url = "https://api.arcee.ai/api/v1".to_string();
        sessions::update_session_model_config(&store_path, &attach_snapshot).unwrap();
        let attach_error = match manager.attach_session("attach-invalid").await {
            Ok(_) => panic!("arcee-api attach without api_key_env must fail"),
            Err(error) => error,
        };
        assert!(attach_error
            .to_string()
            .contains("requires a nonblank api_key_env"));
        assert!(attach_error
            .downcast_ref::<ModelConfigurationError>()
            .is_some());
        assert_eq!(ApiError::from(attach_error).status, StatusCode::BAD_REQUEST);

        seed_session(&root, "update", "2026-01-02 00:00:00.000000000");
        for invalid_base_url in ["https://api.arcee.ai/v1", "not a URL"] {
            let update_error = manager
                .update_session_config(
                    "update",
                    UpdateConfigRequest {
                        model: RequestField::Omitted,
                        base_url: RequestField::Value(invalid_base_url.to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                    },
                )
                .await
                .unwrap_err();
            assert!(
                update_error
                    .downcast_ref::<ModelConfigurationError>()
                    .is_some(),
                "unclassified configuration error: {update_error:#}"
            );
            assert_eq!(ApiError::from(update_error).status, StatusCode::BAD_REQUEST);

            let stored = sessions::load_session(&store_path, "update").unwrap();
            assert_eq!(stored.backend, BackendKind::OpenAiResponses);
            assert_eq!(stored.base_url, "https://api.openai.com/v1");
        }

        manager
            .update_session_config(
                "update",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                },
            )
            .await
            .expect("same-origin approved Arcee configuration should persist");
        let approved = sessions::load_session(&store_path, "update").unwrap();
        assert_eq!(approved.backend, BackendKind::ArceeAuth);
        assert_eq!(approved.base_url, "https://tenant.arcee.ai/api/v1");

        unsafe { std::env::set_var("OPENAI_API_KEY", "custom-server-key") };
        manager
            .update_session_config(
                "update",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                    backend: RequestField::Value("arcee-api".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    extra_headers: RequestField::Omitted,
                },
            )
            .await
            .expect("approved arcee-api configuration with an explicit selector should persist");
        let api_mode = sessions::load_session(&store_path, "update").unwrap();
        assert_eq!(api_mode.base_url, "https://api.arcee.ai/api");
        assert_eq!(api_mode.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

        let created = manager
            .create_session(CreateSessionRequest {
                cwd: None,
                model: RequestField::Value("test-model".to_string()),
                base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
                backend: RequestField::Value("arcee-api".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Omitted,
                ssh_host: None,
                sandbox: SandboxRequest::default(),
            })
            .await
            .expect("valid approved arcee-api create should succeed");
        assert!(created.metadata.session_id.is_some());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn null_update_clears_legacy_arcee_api_key_env() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("clear_arcee_api_key_env");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let snapshot = sessions::new_snapshot(
            "legacy-arcee".to_string(),
            root.clone(),
            "model".to_string(),
            "https://api.arcee.ai".to_string(),
            BackendKind::ArceeAuth,
            None,
            None,
            None,
            Vec::new(),
            Some("LEGACY_ARCEE_KEY_ENV".to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
        let manager = test_manager(&root);

        manager
            .update_session_config(
                "legacy-arcee",
                UpdateConfigRequest {
                    model: RequestField::Omitted,
                    base_url: RequestField::Omitted,
                    backend: RequestField::Omitted,
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Null,
                    extra_headers: RequestField::Omitted,
                },
            )
            .await
            .expect("null api_key_env should clear the invalid legacy value");

        let stored = sessions::load_session(&root.join("store.db"), "legacy-arcee").unwrap();
        assert_eq!(stored.backend, BackendKind::ArceeAuth);
        assert_eq!(stored.api_key_env, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    fn test_event(sequence_id: u64, message: &str) -> SessionEventEnvelope {
        SessionEventEnvelope {
            session_id: Some("session-1".to_string()),
            sequence_id,
            client_id: None,
            run_id: None,
            event: nac_core::events::SessionEvent::RunFailed {
                message: message.to_string(),
            },
        }
    }

    #[test]
    fn presentation_requests_require_the_complete_contract() {
        let update: UpdateSessionPresentationRequest = serde_json::from_str(
            r#"{"title":"  Build release  ","pinned":true,"expected_version":3}"#,
        )
        .unwrap();
        assert_eq!(update.title, "  Build release  ");
        assert!(update.pinned);
        assert_eq!(update.expected_version, 3);
        assert!(serde_json::from_str::<UpdateSessionPresentationRequest>(
            r#"{"pinned":true,"expected_version":3}"#
        )
        .is_err());

        let reorder: ReorderSessionsRequest = serde_json::from_str(
            r#"{"pinned":false,"session_ids":["b","a"],"expected_versions":{"a":2,"b":4}}"#,
        )
        .unwrap();
        assert_eq!(reorder.session_ids, ["b", "a"]);
        assert_eq!(reorder.expected_versions["a"], 2);
    }

    #[test]
    fn presentation_errors_map_to_exact_statuses() {
        use sessions::SessionPresentationError;

        let cases = [
            (
                SessionPresentationError::InvalidInput("invalid".to_string()),
                StatusCode::BAD_REQUEST,
            ),
            (
                SessionPresentationError::NotFound("missing".to_string()),
                StatusCode::NOT_FOUND,
            ),
            (
                SessionPresentationError::Conflict("stale".to_string()),
                StatusCode::CONFLICT,
            ),
            (
                SessionPresentationError::Busy("locked".to_string()),
                StatusCode::CONFLICT,
            ),
            (
                SessionPresentationError::Store(anyhow::anyhow!("disk failed")),
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ];

        for (error, expected_status) in cases {
            let error = ApiError::from(error);
            assert_eq!(error.status, expected_status);
        }
    }

    #[tokio::test]
    async fn presentation_handlers_preserve_error_shape_and_status() {
        let root = temp_root("presentation_status");
        seed_session(&root, "known", "2026-01-01 00:00:00.000000000");
        let manager = test_manager(&root);

        let invalid = update_session_presentation_handler(
            State(manager.clone()),
            AxumPath("known".to_string()),
            Ok(Json(UpdateSessionPresentationRequest {
                title: "bad\ttitle".to_string(),
                pinned: false,
                expected_version: 0,
            })),
        )
        .await
        .unwrap_err();
        assert_eq!(invalid.status, StatusCode::BAD_REQUEST);

        let missing = update_session_presentation_handler(
            State(manager.clone()),
            AxumPath("missing".to_string()),
            Ok(Json(UpdateSessionPresentationRequest {
                title: "title".to_string(),
                pinned: false,
                expected_version: 0,
            })),
        )
        .await
        .unwrap_err();
        assert_eq!(missing.status, StatusCode::NOT_FOUND);

        let _ = update_session_presentation_handler(
            State(manager.clone()),
            AxumPath("known".to_string()),
            Ok(Json(UpdateSessionPresentationRequest {
                title: "title".to_string(),
                pinned: false,
                expected_version: 0,
            })),
        )
        .await
        .unwrap();
        let stale = update_session_presentation_handler(
            State(manager.clone()),
            AxumPath("known".to_string()),
            Ok(Json(UpdateSessionPresentationRequest {
                title: "new title".to_string(),
                pinned: false,
                expected_version: 0,
            })),
        )
        .await
        .unwrap_err();
        let response = stale.into_response();
        assert_eq!(response.status(), StatusCode::CONFLICT);
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(body.as_object().unwrap().len(), 1);
        assert!(body["error"].as_str().unwrap().contains("version changed"));

        let malformed_reorder = reorder_sessions_handler(
            State(manager.clone()),
            Ok(Json(ReorderSessionsRequest {
                pinned: false,
                session_ids: vec!["known".to_string()],
                expected_versions: BTreeMap::new(),
            })),
        )
        .await
        .unwrap_err();
        assert_eq!(malformed_reorder.status, StatusCode::BAD_REQUEST);

        let membership_conflict = reorder_sessions_handler(
            State(manager),
            Ok(Json(ReorderSessionsRequest {
                pinned: false,
                session_ids: Vec::new(),
                expected_versions: BTreeMap::new(),
            })),
        )
        .await
        .unwrap_err();
        assert_eq!(membership_conflict.status, StatusCode::CONFLICT);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn presentation_routes_serialize_summaries_and_drive_list_order() {
        let root = temp_root("presentation_order");
        seed_session(&root, "a", "2026-01-01 00:00:00.000000000");
        seed_session(&root, "b", "2026-01-02 00:00:00.000000000");
        seed_session(&root, "c", "2026-01-03 00:00:00.000000000");
        let manager = test_manager(&root);

        let Json(a) = update_session_presentation_handler(
            State(manager.clone()),
            AxumPath("a".to_string()),
            Ok(Json(UpdateSessionPresentationRequest {
                title: "  Alpha  ".to_string(),
                pinned: true,
                expected_version: 0,
            })),
        )
        .await
        .unwrap();
        assert_eq!(a.title.as_deref(), Some("Alpha"));
        assert!(a.pinned);
        assert_eq!(a.presentation_version, 1);
        let serialized = serde_json::to_value(&a).unwrap();
        assert_eq!(serialized["title"], "Alpha");
        assert_eq!(serialized["pinned"], true);
        assert_eq!(serialized["sort_order"], 0);
        assert_eq!(serialized["presentation_version"], 1);

        let _ = update_session_presentation_handler(
            State(manager.clone()),
            AxumPath("b".to_string()),
            Ok(Json(UpdateSessionPresentationRequest {
                title: String::new(),
                pinned: true,
                expected_version: 0,
            })),
        )
        .await
        .unwrap();

        let Json(reordered) = reorder_sessions_handler(
            State(manager.clone()),
            Ok(Json(ReorderSessionsRequest {
                pinned: true,
                session_ids: vec!["b".to_string(), "a".to_string()],
                expected_versions: BTreeMap::from([("a".to_string(), 1), ("b".to_string(), 1)]),
            })),
        )
        .await
        .unwrap();
        assert!(reordered.pinned);
        assert_eq!(
            reordered
                .sessions
                .iter()
                .map(|summary| summary.session_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert_eq!(reordered.sessions[0].sort_order, 0);
        assert_eq!(reordered.sessions[1].sort_order, 1);
        assert!(reordered
            .sessions
            .iter()
            .all(|summary| summary.presentation_version == 2));

        let listed = manager.list_sessions(false).await.unwrap();
        assert_eq!(
            listed
                .iter()
                .map(|entry| entry.summary.session_id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a", "c"]
        );
        assert!(listed.iter().all(|entry| !entry.active));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn sse_orders_boundary_then_gap_replay_and_live_events() {
        let replayed = vec![test_event(4, "replayed-4"), test_event(5, "replayed-5")];
        let live = test_event(6, "live-6");
        let (sender, receiver) = tokio::sync::broadcast::channel(4);
        sender.send(live).unwrap();
        drop(sender);

        let stream = session_event_stream(
            5,
            Some(SessionReplayGap {
                missing_from_sequence_id: 2,
                missing_to_sequence_id: 3,
            }),
            replayed,
            receiver,
        );
        let response = Sse::new(stream).into_response();
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();

        let boundary = body.find("event: replay_boundary").unwrap();
        let gap = body.find("event: replay_gap").unwrap();
        let replay_4 = body.find("\"sequence_id\":4").unwrap();
        let replay_5 = body.find("\"sequence_id\":5").unwrap();
        let live_6 = body.find("\"sequence_id\":6").unwrap();
        assert!(boundary < gap && gap < replay_4 && replay_4 < replay_5 && replay_5 < live_6);
        assert!(body.contains("\"replay_boundary_sequence_id\":5"));

        let boundary_frame = body.split("\n\n").next().unwrap();
        assert!(!boundary_frame.lines().any(|line| line.starts_with("id:")));
    }
}
