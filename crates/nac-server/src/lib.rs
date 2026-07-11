use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
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
    routing::{get, patch, post, put},
    Json, Router,
};
use nac_core::{
    commands::{FrontendCommand, PreparedUserInput},
    events::{SessionEventEnvelope, SessionReplayGap},
    model::{BackendKind, ReasoningEffort},
    runtime::{self, ModelOptions, NacConfig, RunOptions, SandboxOptions, StoreOptions},
    session_service::{
        ActiveRunSnapshot, SessionEventReceiver, SessionFrontendSnapshot, SessionRunHandle,
        SessionService, SessionSubmitError,
    },
    sessions,
    view::{self, SessionSummarySnapshot},
};
use serde::{Deserialize, Serialize};
use tokio::{net::TcpListener, sync::RwLock};
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
    active_sessions: RwLock<HashMap<String, SessionService>>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSessionRequest {
    pub cwd: Option<PathBuf>,
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub backend: Option<String>,
    pub reasoning_effort: Option<String>,
    pub api_key_env: Option<String>,
    /// JSON string containing an object whose keys and values are strings.
    pub extra_headers: Option<String>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateConfigRequest {
    pub model: Option<String>,
    pub base_url: Option<String>,
    pub backend: Option<String>,
    pub reasoning_effort: Option<String>,
    pub api_key_env: Option<String>,
    /// JSON string of `BTreeMap<String, String>`. An empty string clears the map.
    pub extra_headers: Option<String>,
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
        let config = NacConfig::load_from_cwd(&root_cwd)?;
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
                        active_run: active_service.and_then(SessionService::active_run),
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
        let run_config = runtime::build_run_config(
            RunOptions {
                workspace_cwd,
                config_cwd: Some(config_cwd.clone()),
                worker_executable: Some(self.inner.worker_executable.clone()),
                store: StoreOptions {
                    store_path: Some(self.inner.store_path.clone()),
                },
                model: model_options(
                    request.model,
                    request.base_url,
                    request.backend,
                    request.reasoning_effort,
                    request.api_key_env,
                    request.extra_headers,
                )?,
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
            .insert(session_id, service);
        Ok(snapshot)
    }

    pub async fn attach_session(&self, session_id: &str) -> Result<SessionService> {
        if let Some(service) = self.inner.active_sessions.read().await.get(session_id) {
            return Ok(service.clone());
        }

        let service = self.resume_session(session_id).await?;
        let mut active = self.inner.active_sessions.write().await;
        if let Some(existing) = active.get(session_id) {
            return Ok(existing.clone());
        }
        active.insert(session_id.to_string(), service.clone());
        Ok(service)
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
        let service = self.attach_session(session_id).await?;
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

    /// Updates the model configuration of an existing session in the DB,
    /// then removes it from the in-memory `active_sessions` map so that the
    /// next `attach_session` call re-resumes it with the new config.
    /// Returns an error if a run is currently active.
    pub async fn update_session_config(
        &self,
        session_id: &str,
        request: UpdateConfigRequest,
    ) -> Result<()> {
        // 1. Check that no run is active.
        {
            let active = self.inner.active_sessions.read().await;
            if let Some(service) = active.get(session_id) {
                if service.active_run().is_some() {
                    return Err(anyhow!(
                        "session is busy with an active run; cancel it before updating config"
                    ));
                }
            }
        }

        // 2. Load the current snapshot from DB.
        let mut snapshot = sessions::load_session(&self.inner.store_path, session_id)?;

        // 3. Apply overrides.
        if let Some(model) = request.model {
            let trimmed = model.trim().to_string();
            snapshot.model = if trimmed.is_empty() {
                // Fall back to a sensible default — keep current if empty.
                snapshot.model
            } else {
                trimmed
            };
        }
        if let Some(base_url) = request.base_url {
            let trimmed = base_url.trim().to_string();
            if !trimmed.is_empty() {
                snapshot.base_url = trimmed;
            }
        }
        if let Some(backend) = request.backend {
            let trimmed = backend.trim();
            if !trimmed.is_empty() {
                snapshot.backend = parse_json_string_enum::<BackendKind>(trimmed)?;
            }
        }
        if let Some(effort) = request.reasoning_effort {
            let trimmed = effort.trim();
            if trimmed.is_empty() {
                snapshot.reasoning_effort = None;
            } else {
                snapshot.reasoning_effort =
                    Some(parse_json_string_enum::<ReasoningEffort>(trimmed)?);
            }
        }
        if let Some(api_key_env) = request.api_key_env {
            let trimmed = api_key_env.trim();
            snapshot.api_key_env = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
        }
        if let Some(extra_headers_json) = request.extra_headers {
            let trimmed = extra_headers_json.trim();
            if trimmed.is_empty() {
                snapshot.extra_headers = BTreeMap::new();
            } else {
                snapshot.extra_headers = serde_json::from_str::<BTreeMap<String, String>>(trimmed)
                    .context("failed to parse extra_headers as JSON object")?;
            }
        }

        // 4. Save the updated snapshot to DB.
        sessions::save_session(&self.inner.store_path, &snapshot)?;

        // 5. Remove from active_sessions so the next attach re-resumes.
        self.inner.active_sessions.write().await.remove(session_id);

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
        let config = NacConfig::load_from_cwd(config_cwd)?;
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
            patch(update_config_handler),
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
    Json(request): Json<CreateSessionRequest>,
) -> std::result::Result<(StatusCode, Json<SessionFrontendSnapshot>), ApiError> {
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

async fn update_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<UpdateConfigRequest>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.update_session_config(&session_id, request).await?;
    Ok(StatusCode::OK)
}

fn model_options(
    model: Option<String>,
    base_url: Option<String>,
    backend: Option<String>,
    reasoning_effort: Option<String>,
    api_key_env: Option<String>,
    extra_headers: Option<String>,
) -> Result<ModelOptions> {
    Ok(ModelOptions {
        backend: backend
            .map(|value| parse_json_string_enum::<BackendKind>(&value))
            .transpose()?,
        reasoning_effort: reasoning_effort
            .map(|value| parse_json_string_enum::<ReasoningEffort>(&value))
            .transpose()?,
        api_base_url: base_url,
        api_model: model,
        api_key_env: api_key_env.and_then(|value| {
            let trimmed = value.trim();
            (!trimmed.is_empty()).then(|| trimmed.to_string())
        }),
        extra_headers: parse_extra_headers(extra_headers)?,
    })
}

fn parse_extra_headers(extra_headers: Option<String>) -> Result<Option<BTreeMap<String, String>>> {
    let Some(extra_headers) = extra_headers else {
        return Ok(None);
    };
    let trimmed = extra_headers.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    serde_json::from_str::<BTreeMap<String, String>>(trimmed)
        .map(Some)
        .map_err(|error| {
            anyhow!(
                "invalid extra_headers: expected a JSON object with string keys and string values: {error}"
            )
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

fn parse_json_string_enum<T>(value: &str) -> Result<T>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(serde_json::Value::String(value.to_string()))
        .with_context(|| format!("invalid enum value '{}'", value))
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

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        let message = error.to_string();
        let status = if message.contains("was not found")
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
    fn parses_model_option_enums_from_api_strings() {
        let options = model_options(
            Some("model-a".to_string()),
            Some("https://example.com/v1".to_string()),
            Some("openai-responses".to_string()),
            Some("xhigh".to_string()),
            None,
            None,
        )
        .unwrap();

        assert_eq!(options.backend, Some(BackendKind::OpenAiResponses));
        assert_eq!(options.reasoning_effort, Some(ReasoningEffort::Xhigh));
        assert_eq!(options.api_model.as_deref(), Some("model-a"));
        assert_eq!(
            options.api_base_url.as_deref(),
            Some("https://example.com/v1")
        );
    }

    #[test]
    fn parses_together_launch_options_with_api_key_env_and_headers() {
        let options = model_options(
            None,
            None,
            Some("together-chat".to_string()),
            None,
            Some("  CUSTOM_TOGETHER_KEY  ".to_string()),
            Some(r#"{"X-Trace":"launch","X-Mode":"test"}"#.to_string()),
        )
        .unwrap();

        assert_eq!(options.backend, Some(BackendKind::TogetherChat));
        assert_eq!(options.api_key_env.as_deref(), Some("CUSTOM_TOGETHER_KEY"));
        assert_eq!(
            options.extra_headers,
            Some(BTreeMap::from([
                ("X-Mode".to_string(), "test".to_string()),
                ("X-Trace".to_string(), "launch".to_string()),
            ]))
        );
    }

    #[test]
    fn launch_header_options_distinguish_inherit_from_explicit_empty_map() {
        let inherited = model_options(None, None, None, None, None, None).unwrap();
        let blank = model_options(
            None,
            None,
            None,
            None,
            Some("   ".to_string()),
            Some("   ".to_string()),
        )
        .unwrap();
        let cleared = model_options(None, None, None, None, None, Some("{}".to_string())).unwrap();

        assert_eq!(inherited.api_key_env, None);
        assert_eq!(inherited.extra_headers, None);
        assert_eq!(blank.api_key_env, None);
        assert_eq!(blank.extra_headers, None);
        assert_eq!(cleared.extra_headers, Some(BTreeMap::new()));
    }

    #[test]
    fn invalid_launch_headers_map_to_bad_request() {
        for invalid in ["{not-json}", r#"["value"]"#, r#"{"X-Count":3}"#] {
            let error =
                model_options(None, None, None, None, None, Some(invalid.to_string())).unwrap_err();
            assert!(error.to_string().contains("invalid extra_headers"));
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
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
        assert!(app.contains("api_key_env: nullable(el.launchApiKeyEnv.value)"));
        assert!(app.contains("extra_headers: extraHeaders"));
        assert!(app.contains("serializeExtraHeaders(el.launchExtraHeaders.value)"));
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
        assert_eq!(with_host.backend.as_deref(), Some("together-chat"));
        assert_eq!(
            with_host.api_key_env.as_deref(),
            Some("TOGETHER_CUSTOM_KEY")
        );
        assert_eq!(
            with_host.extra_headers.as_deref(),
            Some(r#"{"X-Launch":"yes"}"#)
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
            model: None,
            base_url: None,
            backend: None,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: None,
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
