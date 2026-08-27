mod application;
mod compaction;
mod filesystem;
mod light_model;
mod managed_auth;
mod managed_github;
mod managed_status;
mod mcp;
mod mcp_api;
mod orchestration;
mod revert;

pub use compaction::{CompactSessionError, CompactSessionResponse};
pub use filesystem::{BrowseEntry, BrowseKind, BrowseListing, BrowseQuery};
pub use managed_auth::{
    DeviceLoginStartedResponse, DeviceLoginStateResponse, ManagedAuthListResponse,
    ManagedAuthStatusResponse,
};
pub use mcp_api::{
    CreateMcpServerRequest, McpLibraryResponse, McpServerList, McpServerView, TestMcpServerRequest,
    TestMcpServerResponse, UpdateMcpServerRequest,
};
pub use revert::{
    RegenerateSessionError, RegenerateSessionRequest, RevertSessionError, RevertSessionRequest,
    RevertSessionResponse,
};

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    convert::Infallible,
    future::{Future, IntoFuture},
    net::SocketAddr,
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex, Weak},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
use async_stream::stream;
use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::get,
    Json, Router,
};
use include_dir::{include_dir, Dir};
#[cfg(test)]
use nac_core::test_support::store::TranscriptLogWriter;
use nac_core::{
    commands::{
        slash_command_definitions, PreparedUserInput, SlashCommand, SlashCommandDefinition,
    },
    events::{
        AssistantStreamDelta, AssistantStreamDeltaReceiver, SessionEvent, SessionEventBoundary,
        SessionEventEnvelope, SessionReplayGap,
    },
    light_model::{LightModelError, LightModelSettings},
    model::{
        list_managed_provider_models, list_provider_models, list_stored_api_keys,
        managed_backend_base_url, provider_default_base_url, provider_for_model,
        provider_uses_api_key, remove_api_key, resolve_backend_api_key, resolve_model_base_url,
        store_api_key, validate_caller_supplied_base_url, validate_model_configuration,
        BackendKind, EffectiveModelSettings, ManagedAuthProvider, ModelConfigurationError,
        ModelListing, ProviderModel, ReasoningEffort,
    },
    model_configurations::{self, ModelConfigurationRecord, ModelConfigurationStoreError},
    permissions::{PermissionReply, PermissionRequest},
    projects::{self, ProjectRecord, ProjectStoreError},
    runtime::{
        self, CredentialDestinationPolicy, ModelOptions, NacConfig, OptionalModelOption,
        RunOptions, SandboxOptions, StoreOptions,
    },
    session_service::{
        ActiveRunSnapshot, FrontendSnapshotLoadOptions, FrontendSnapshotMessages,
        MessagePageRequest, MessagesPageSnapshot, SessionCancelError, SessionCoordinationError,
        SessionEventReceiver, SessionFrontendSnapshot, SessionFrontendSnapshotLoad,
        SessionRunHandle, SessionService, SessionSubmitError, ThreadEventPage,
    },
    sessions,
    ssh_configurations::{self, SshConfigurationRecord, SshConfigurationStoreError},
    store::{
        GoalStatus, InboxDelivery, ManagedOrchestratorExecutionMode, ManagedOrchestratorRecord,
        ManagedOrchestratorStatus, PermissionGrantRecord, SessionGoalRecord, SessionInboxRecord,
        TraditionalChildExecutionMode, TraditionalChildRecord, UserGoalUpdate,
    },
    types::Message,
    view::{self, SessionSummarySnapshot},
    workspace::{self, GitTarget},
};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    sync::{Mutex, RwLock},
};
use tower_http::compression::{
    predicate::{DefaultPredicate, NotForContentType, Predicate},
    CompressionLayer,
};
use utoipa::OpenApi;
use utoipa_axum::{router::OpenApiRouter, routes};
use utoipa_swagger_ui::{Config as SwaggerConfig, SwaggerUi};

const DEFAULT_REPLAY_LIMIT: usize = 256;
const DEFAULT_MESSAGE_PAGE_LIMIT: usize = 24;
const MAX_MESSAGE_PAGE_LIMIT: usize = 100;
const DEFAULT_THREAD_EVENT_PAGE_LIMIT: usize = 24;
const MAX_THREAD_EVENT_PAGE_LIMIT: usize = 100;
const WORKSPACE_DIFF_CACHE_TTL: Duration = Duration::from_secs(3);
/// A failed measurement is cached too, and for less time: an unreachable host
/// must not be dialled once per session on every refresh of the list, but it
/// must also start working again shortly after it comes back.
const WORKSPACE_DIFF_ERROR_CACHE_TTL: Duration = Duration::from_secs(30);
/// How long the session list is willing to wait for measurements it does not
/// have cached. A remote checkout can be slow, and the list is worth more on
/// time and incomplete than late and exact — the answer lands in the cache and
/// shows up on the next refresh.
const WORKSPACE_DIFF_MEASURE_BUDGET: Duration = Duration::from_secs(4);
/// How long a working git target is taken on trust before it is checked again.
const GIT_PROBE_CACHE_TTL: Duration = Duration::from_secs(60);
const COMPLETE_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(20);

enum SuppressedCompletion {
    Traditional { session_id: String, generation: u64 },
    Managed { session_id: String, generation: u64 },
}

struct CompletionSuppressionRollback {
    store_path: PathBuf,
    suppressed: Vec<SuppressedCompletion>,
    armed: bool,
}

struct SandboxResourceLeaseRollback {
    service: Option<Arc<SessionService>>,
}

impl SandboxResourceLeaseRollback {
    fn new(service: Option<Arc<SessionService>>) -> Self {
        Self { service }
    }

    fn disarm(&mut self) {
        self.service = None;
    }
}

impl Drop for SandboxResourceLeaseRollback {
    fn drop(&mut self) {
        let Some(service) = self.service.take() else {
            return;
        };
        if let Err(error) = service.acquire_sandbox_resource_lease() {
            eprintln!("nac: failed to restore sandbox resource ownership: {error:#}");
        }
    }
}

impl CompletionSuppressionRollback {
    fn new(store_path: PathBuf) -> Self {
        Self {
            store_path,
            suppressed: Vec::new(),
            armed: true,
        }
    }

    fn suppress_running(&mut self, session_id: &str) -> Result<()> {
        let managed_already = self.suppressed.iter().any(|entry| {
            matches!(entry, SuppressedCompletion::Managed { session_id: existing, .. } if existing == session_id)
        });
        if !managed_already
            && nac_core::store::load_managed_orchestrator(&self.store_path, session_id)?
                .is_some_and(|record| record.status == ManagedOrchestratorStatus::Running)
        {
            let record = nac_core::store::suppress_managed_orchestrator_completion(
                &self.store_path,
                session_id,
            )?;
            self.suppressed.push(SuppressedCompletion::Managed {
                session_id: session_id.to_string(),
                generation: record.generation,
            });
        }

        let child_already = self.suppressed.iter().any(|entry| {
            matches!(entry, SuppressedCompletion::Traditional { session_id: existing, .. } if existing == session_id)
        });
        if !child_already
            && nac_core::store::load_traditional_child(&self.store_path, session_id)?.is_some_and(
                |record| record.status == nac_core::store::TraditionalChildStatus::Running,
            )
        {
            let record = nac_core::store::suppress_traditional_child_completion(
                &self.store_path,
                session_id,
            )?;
            self.suppressed.push(SuppressedCompletion::Traditional {
                session_id: session_id.to_string(),
                generation: record.generation,
            });
        }
        Ok(())
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for CompletionSuppressionRollback {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        for entry in self.suppressed.drain(..).rev() {
            let result = match entry {
                SuppressedCompletion::Traditional {
                    session_id,
                    generation,
                } => nac_core::store::restore_traditional_child_completion(
                    &self.store_path,
                    &session_id,
                    generation,
                ),
                SuppressedCompletion::Managed {
                    session_id,
                    generation,
                } => nac_core::store::restore_managed_orchestrator_completion(
                    &self.store_path,
                    &session_id,
                    generation,
                ),
            };
            if let Err(error) = result {
                eprintln!("nac: failed to roll back completion suppression: {error:#}");
            }
        }
    }
}
/// A target that failed is rechecked sooner, so bringing a host back does not
/// mean waiting out a long cache.
const GIT_PROBE_ERROR_CACHE_TTL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone)]
pub struct ServerOptions {
    pub root_cwd: PathBuf,
    pub store_path: Option<PathBuf>,
    pub worker_executable: Option<PathBuf>,
    pub managed_host: Option<nac_core::managed::ManagedHostConfig>,
}

#[derive(Clone)]
pub struct SessionManager {
    inner: Arc<SessionManagerInner>,
}

struct SessionManagerInner {
    root_cwd: PathBuf,
    store_path: PathBuf,
    worker_executable: PathBuf,
    managed_host: Option<nac_core::managed::ManagedHostConfig>,
    managed_clones: Option<nac_core::managed_clone::ManagedCloneService>,
    active_sessions: RwLock<HashMap<String, Arc<SessionService>>>,
    lifecycle_gates: StdMutex<HashMap<String, Weak<Mutex<()>>>>,
    workspace_diff_cache: RwLock<HashMap<GitTargetKey, WorkspaceDiffCacheEntry>>,
    git_probe_cache: RwLock<HashMap<GitTargetKey, GitProbeCacheEntry>>,
    managed_logins: managed_auth::ManagedLoginRegistry,
    managed_github_logins: managed_github::ManagedGitHubLoginRegistry,
    #[cfg(test)]
    managed_monitor_peer_observed: tokio::sync::Notify,
}

struct ServerTraditionalChildController {
    manager: Weak<SessionManagerInner>,
}

struct ServerOrchestrationController {
    manager: Weak<SessionManagerInner>,
}

impl ServerOrchestrationController {
    fn manager(&self) -> Result<SessionManager> {
        self.manager
            .upgrade()
            .map(|inner| SessionManager { inner })
            .ok_or_else(|| anyhow!("session manager is no longer available"))
    }
}

impl ServerTraditionalChildController {
    fn manager(&self) -> Result<SessionManager> {
        self.manager
            .upgrade()
            .map(|inner| SessionManager { inner })
            .ok_or_else(|| anyhow!("session manager is no longer available"))
    }
}

/// Identifies a checkout across sessions using the same canonical Local/SSH
/// identity as the cross-process mutation lease. This keeps caches, peer
/// session admission, active runs, and retained terminals from splitting when
/// two OpenSSH aliases reach the same effective host and canonical directory.
type GitTargetKey = Vec<u8>;

struct WorkspaceMutationAdmission {
    target: GitTarget,
    _workspace_gate: tokio::sync::OwnedRwLockWriteGuard<()>,
    _workspace_lease: sessions::WorkspaceMutationLease,
    _session_leases: Vec<sessions::SessionOperationLease>,
}

fn git_target_key(target: &GitTarget) -> GitTargetKey {
    target.lease_identity()
}

fn config_replacement_conflict(
    has_active_operation: bool,
    has_sandbox: bool,
) -> Option<&'static str> {
    if has_active_operation {
        Some("session is busy with an active operation; wait for it before updating config")
    } else if has_sandbox {
        Some(
            "session owns an active sandbox; config replacement is unavailable while container-local state must be preserved",
        )
    } else {
        None
    }
}

struct ResolvedLaunchLocation {
    workspace_cwd: PathBuf,
    config_cwd: PathBuf,
    ssh: runtime::SshOptions,
}

/// The ssh fields of a launch request as they arrive over HTTP, where a cleared
/// form field is an empty string rather than an absent one.
struct SshRequest {
    host: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
}

impl SshRequest {
    fn into_options(self) -> runtime::SshOptions {
        runtime::SshOptions {
            host: self.host,
            port: self.port,
            identity_file: nonblank(self.identity_file).map(PathBuf::from),
        }
    }
}

fn nonblank(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

#[derive(Debug, Clone)]
struct WorkspaceDiffCacheEntry {
    updated_at: Instant,
    totals: view::WorkspaceDiffTotals,
}

impl WorkspaceDiffCacheEntry {
    fn is_fresh(&self, now: Instant) -> bool {
        let ttl = if self.totals.error.is_some() {
            WORKSPACE_DIFF_ERROR_CACHE_TTL
        } else {
            WORKSPACE_DIFF_CACHE_TTL
        };
        now.duration_since(self.updated_at) < ttl
    }
}

#[derive(Debug, Clone)]
struct GitProbeCacheEntry {
    checked_at: Instant,
    /// The message to report, or `None` when the target answered.
    failure: Option<String>,
}

impl GitProbeCacheEntry {
    fn is_fresh(&self, now: Instant) -> bool {
        let ttl = if self.failure.is_some() {
            GIT_PROBE_ERROR_CACHE_TTL
        } else {
            GIT_PROBE_CACHE_TTL
        };
        now.duration_since(self.checked_at) < ttl
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct HealthResponse {
    pub status: &'static str,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ApiErrorBody {
    pub error: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct StoreInfo {
    #[schema(value_type = String)]
    pub root_cwd: PathBuf,
    #[schema(value_type = String)]
    pub store_path: PathBuf,
    #[schema(value_type = String)]
    pub worker_executable: PathBuf,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct LaunchModelDefaultsRequest {
    #[schema(value_type = Option<String>)]
    pub cwd: Option<PathBuf>,
    /// OpenSSH target for remote sessions; remote paths never select local config.
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
}

/// Where to look on an SSH host, for the remote half of the path picker.
///
/// The connection is described in the request rather than taken from a session,
/// because this is what the launch form asks *before* there is a session.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct SshBrowseRequest {
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    /// Absent or empty opens on the login home, which is where a fresh remote
    /// session would start anyway.
    #[serde(default)]
    pub path: Option<String>,
    /// Dot-prefixed names are hidden unless explicitly requested, as locally.
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct LaunchModelDefaults {
    /// Configured model id; lets the launch dialog render the inherited
    /// "from config" selection resolved against the model catalog (the
    /// frontend resolves the provider from the model id, exactly like
    /// session creation does).
    pub configured_model: Option<String>,
    /// Configured reasoning effort, if any.
    pub configured_reasoning_effort: Option<ReasoningEffort>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ManagedSessionSummary {
    pub summary: SessionSummarySnapshot,
    /// Delegated sessions remain addressable by id, but clients use lineage
    /// to keep them out of primary chat navigation and enforce ownership UI.
    pub lineage: Option<SessionLineageSnapshot>,
    pub active: bool,
    pub active_run: Option<ActiveRunSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_diff: Option<view::WorkspaceDiffTotals>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ListSessionsQuery {
    pub project_id: Option<String>,
    #[serde(default)]
    pub workspace_stats: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum RequestField<T> {
    #[default]
    Omitted,
    Null,
    Value(T),
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

fn request_field_patch<T>(field: RequestField<T>) -> Option<Option<T>> {
    match field {
        RequestField::Omitted => None,
        RequestField::Null => Some(None),
        RequestField::Value(value) => Some(Some(value)),
    }
}

fn project_field<T>(field: RequestField<T>) -> application::projects::ProjectField<T> {
    match field {
        RequestField::Omitted => application::projects::ProjectField::Unchanged,
        RequestField::Null => application::projects::ProjectField::Clear,
        RequestField::Value(value) => application::projects::ProjectField::Set(value),
    }
}

impl<T> utoipa::__dev::ComposeSchema for RequestField<T>
where
    T: utoipa::__dev::ComposeSchema,
{
    fn compose(
        schemas: Vec<utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>>,
    ) -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        let value = schemas
            .into_iter()
            .next()
            .unwrap_or_else(|| T::compose(Vec::new()));
        utoipa::openapi::schema::OneOfBuilder::new()
            .item(
                utoipa::openapi::schema::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::Null),
            )
            .item(value)
            .into()
    }
}

impl<T> utoipa::ToSchema for RequestField<T>
where
    T: utoipa::ToSchema + utoipa::__dev::ComposeSchema,
{
    fn name() -> std::borrow::Cow<'static, str> {
        format!("RequestField_{}", T::name()).into()
    }

    fn schemas(
        schemas: &mut Vec<(
            String,
            utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>,
        )>,
    ) {
        T::schemas(schemas);
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

impl utoipa::__dev::ComposeSchema for HeadersRequest {
    fn compose(
        _: Vec<utoipa::openapi::RefOr<utoipa::openapi::schema::Schema>>,
    ) -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{ObjectBuilder, OneOfBuilder};

        OneOfBuilder::new()
            .item(
                ObjectBuilder::new()
                    .additional_properties(Some(<String as utoipa::PartialSchema>::schema())),
            )
            .item(
                ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::String)
                    .pattern(Some(r".*\S.*"))
                    .description(Some(
                        "Compatibility form: a nonblank string containing a JSON object with string values.",
                    )),
            )
            .description(Some(
                "Prefer an object of header names to values. The JSON-encoded string form is accepted for compatibility.",
            ))
            .into()
    }
}

impl utoipa::ToSchema for HeadersRequest {
    fn name() -> std::borrow::Cow<'static, str> {
        "HeadersRequest".into()
    }
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct CreateSessionRequest {
    /// Immutable execution behavior. Omission preserves the established
    /// orchestrator default.
    #[serde(default)]
    pub behavior: sessions::SessionBehavior,
    /// Marks the required first chat for an empty project. The server
    /// serializes this admission and returns the already-created primary chat
    /// to concurrent callers instead of creating a duplicate. Ordinary New
    /// Chat requests leave this false.
    #[serde(default)]
    pub first_chat: bool,
    /// Explicit project selection. Projects are never inferred from `cwd`.
    pub project_id: Option<String>,
    #[schema(value_type = Option<String>)]
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
    /// Omitted defaults to 70% of the model's context window; null or zero disables.
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    /// Light worker model; omitted or null launches single-model.
    #[serde(default)]
    pub light_model: RequestField<LightModelSettings>,
    /// OpenSSH target for remote sessions; `cwd` is remote and defaults to `~`.
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    /// Port and private key for the ssh target. Both are optional: omitted
    /// leaves the choice to ssh, which is what a host configured in
    /// `~/.ssh/config` wants. Supplying them is what lets a session reach a box
    /// nac has no config for at all.
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    #[serde(default)]
    pub sandbox: SandboxRequest,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ProjectList {
    pub projects: Vec<ProjectRecord>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateProjectRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    #[schema(value_type = String)]
    pub cwd: PathBuf,
    #[serde(default, alias = "host_id")]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_identity_file: Option<String>,
    pub default_model_config_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateProjectRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub description: RequestField<String>,
    #[serde(default)]
    pub default_model_config_id: RequestField<String>,
    /// Toggling this moves the project to the end of the target pin group and
    /// bumps `presentation_version`.
    #[serde(default)]
    pub pinned: RequestField<bool>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct AssignSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ReorderProjectsRequest {
    pub pinned: bool,
    pub project_ids: Vec<String>,
    pub expected_versions: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReorderProjectsResponse {
    pub pinned: bool,
    pub projects: Vec<ProjectRecord>,
}

/// What a project delete does with the chats inside it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DeleteProjectSessions {
    /// Hand them back as unassigned, so nothing said in them is lost.
    #[default]
    Keep,
    /// Delete them along with the project.
    Delete,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DeleteProjectQuery {
    #[serde(default)]
    pub sessions: DeleteProjectSessions,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct DeleteProjectResponse {
    /// Sessions that stayed behind and are now unassigned.
    pub released_session_ids: Vec<String>,
    /// Sessions deleted along with the project.
    pub deleted_session_ids: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
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
    /// Client-generated launch id used to key sandbox setup activity, so the
    /// launching UI polls its own launch's progress. Deliberately not part of
    /// `sandbox_requested`: it correlates progress reporting, nothing else.
    #[serde(default)]
    pub activity_key: Option<String>,
}

fn project_location_conflicts(request: &CreateSessionRequest) -> bool {
    request
        .cwd
        .as_ref()
        .is_some_and(|cwd| !cwd.as_os_str().to_string_lossy().trim().is_empty())
        || nonblank(request.ssh_host.clone()).is_some()
        || request.ssh_port.is_some()
        || nonblank(request.ssh_identity_file.clone()).is_some()
}

fn inherit_project_field<T>(field: &mut RequestField<T>, inherited: RequestField<T>) {
    if matches!(field, RequestField::Omitted) {
        *field = inherited;
    }
}

fn apply_project_model_defaults(
    request: &mut CreateSessionRequest,
    defaults: ModelConfigurationRecord,
) {
    inherit_project_field(&mut request.model, RequestField::Value(defaults.model));
    inherit_project_field(
        &mut request.base_url,
        RequestField::Value(defaults.base_url),
    );
    inherit_project_field(&mut request.backend, RequestField::Value(defaults.backend));
    inherit_project_field(
        &mut request.reasoning_effort,
        defaults
            .reasoning_effort
            .map(RequestField::Value)
            .unwrap_or(RequestField::Null),
    );
    inherit_project_field(
        &mut request.api_key_env,
        defaults
            .api_key_env
            .map(RequestField::Value)
            .unwrap_or(RequestField::Null),
    );
    inherit_project_field(
        &mut request.extra_headers,
        RequestField::Value(HeadersRequest(defaults.extra_headers)),
    );
    if let Some(threshold) = defaults.orchestrator_compaction_threshold {
        inherit_project_field(
            &mut request.orchestrator_compaction_threshold,
            RequestField::Value(threshold),
        );
    }
    inherit_project_field(
        &mut request.light_model,
        defaults
            .light_model
            .map(RequestField::Value)
            .unwrap_or(RequestField::Null),
    );
}

/// The chat a project's model settings are read off when the project names no
/// default configuration of its own.
///
/// A project set up from a one-off model pick has no saved configuration to
/// point at, which used to leave its every later chat unlaunchable: nothing said
/// what to run it on. Its existing chats do say, so the newest one stands in —
/// and being the newest, it also tracks the project as its chats are retuned,
/// rather than pinning it to whatever was chosen the day it was created.
///
/// A chat whose own stored configuration no longer parses has nothing to lend,
/// and is passed over so one broken row cannot make the project unusable.
fn newest_project_session(
    store_path: &Path,
    project_id: &str,
) -> Option<sessions::SessionSnapshot> {
    let mut candidates: Vec<_> = sessions::list_sessions(store_path)
        .ok()?
        .into_iter()
        .filter(|summary| summary.project_id.as_deref() == Some(project_id))
        .collect();
    candidates.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    candidates
        .into_iter()
        .find_map(|summary| sessions::load_session(store_path, &summary.session_id).ok())
}

/// Same inheritance as `apply_project_model_defaults`, sourced from a sibling
/// chat instead of a saved configuration.
fn apply_sibling_model_defaults(
    request: &mut CreateSessionRequest,
    sibling: sessions::SessionSnapshot,
) {
    inherit_project_field(&mut request.model, RequestField::Value(sibling.model));
    inherit_project_field(&mut request.base_url, RequestField::Value(sibling.base_url));
    inherit_project_field(
        &mut request.backend,
        RequestField::Value(sibling.backend.as_str().to_string()),
    );
    inherit_project_field(
        &mut request.reasoning_effort,
        sibling
            .reasoning_effort
            .map(|effort| RequestField::Value(effort.as_str().to_string()))
            .unwrap_or(RequestField::Null),
    );
    inherit_project_field(
        &mut request.api_key_env,
        sibling
            .api_key_env
            .map(RequestField::Value)
            .unwrap_or(RequestField::Null),
    );
    inherit_project_field(
        &mut request.extra_headers,
        RequestField::Value(HeadersRequest(sibling.extra_headers)),
    );
    if let Some(threshold) = sibling.orchestrator_compaction_threshold {
        inherit_project_field(
            &mut request.orchestrator_compaction_threshold,
            RequestField::Value(threshold),
        );
    }
    inherit_project_field(
        &mut request.light_model,
        sibling
            .light_model
            .map(RequestField::Value)
            .unwrap_or(RequestField::Null),
    );
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct StoredCredentialSummary {
    pub name: String,
    /// Empty when the secret is too short for a suffix to be safe to show.
    pub last_four: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct StoredCredentialList {
    pub credentials: Vec<StoredCredentialSummary>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ManagedSecretSummary {
    pub name: String,
    pub updated_at_unix_ms: u64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ManagedSecretList {
    pub secrets: Vec<ManagedSecretSummary>,
    pub healthy: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct PutManagedSecretRequest {
    #[schema(write_only, example = "fake-managed-secret-value")]
    pub value: String,
}

/// Marks credential names this server generated for a saved configuration, so
/// deleting one never removes a key the operator manages themselves.
const GENERATED_CREDENTIAL_PREFIX: &str = "NAC_CONFIG_";

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateModelConfigurationRequest {
    pub name: String,
    pub backend: BackendKind,
    pub model: String,
    /// Defaults to the provider's canonical URL.
    pub base_url: Option<String>,
    #[schema(write_only, example = "fake-api-key")]
    pub api_key: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub extra_headers: Option<BTreeMap<String, String>>,
    /// Compaction budget sessions started from this setup inherit; absent or
    /// zero leaves them on the 70%-of-context default.
    pub orchestrator_compaction_threshold: Option<u64>,
    /// Message the launch modal pre-fills when this setup is chosen.
    pub initial_prompt: Option<String>,
    /// Light worker model saved with this setup.
    #[serde(default)]
    pub light_model: Option<LightModelSettings>,
}

/// Edits a saved setup in place. Every field is tri-state: omit it to keep what
/// is stored, send null to clear it, send a value to replace it.
///
/// `api_key` is the exception that cannot be read back — the secret lives in
/// the credential store — so omitting it keeps the credential the row already
/// points at, and sending one files a fresh credential in its place.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateModelConfigurationRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub backend: RequestField<BackendKind>,
    #[serde(default)]
    pub model: RequestField<String>,
    #[serde(default)]
    pub base_url: RequestField<String>,
    #[serde(default)]
    #[schema(write_only, example = "fake-replacement-key")]
    pub api_key: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<ReasoningEffort>,
    #[serde(default)]
    pub extra_headers: RequestField<BTreeMap<String, String>>,
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    #[serde(default)]
    pub initial_prompt: RequestField<String>,
    #[serde(default)]
    pub light_model: RequestField<LightModelSettings>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ModelConfigurationList {
    pub configurations: Vec<ModelConfigurationRecord>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateSshConfigurationRequest {
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
}

/// Edits a saved SSH setup in place. Every field is tri-state: omit it to keep
/// what is stored, send null to clear it, send a value to replace it.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
pub struct UpdateSshConfigurationRequest {
    #[serde(default)]
    pub name: RequestField<String>,
    #[serde(default)]
    pub ssh_host: RequestField<String>,
    #[serde(default)]
    pub ssh_port: RequestField<u16>,
    #[serde(default)]
    pub ssh_identity_file: RequestField<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SshConfigurationList {
    pub configurations: Vec<SshConfigurationRecord>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ModelConfigFromFileRequest {
    pub path: String,
}

/// A configuration that has been checked end to end: the destination is
/// approved, the credential resolves, and the provider answered with the
/// models it allows.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ResolvedModelConfiguration {
    pub backend: BackendKind,
    pub model: Option<String>,
    pub base_url: String,
    pub api_key_env: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub models: Vec<ProviderModel>,
    /// Why the list is empty, when a stored login could not be asked. An empty
    /// list without this is a provider that simply offers no index.
    pub models_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ProviderModelsRequest {
    pub backend: BackendKind,
    #[schema(write_only, example = "fake-provider-key")]
    pub api_key: Option<String>,
    /// Names a key already held in the environment or in NAC home, for a caller
    /// that has one on file and no copy of the secret to send.
    pub api_key_env: Option<String>,
    /// Overrides the provider's canonical URL, for a proxy or a custom gateway.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ProviderModelList {
    /// The URL the models were actually read from, so the caller can persist
    /// the same destination it validated against.
    pub base_url: String,
    pub models: Vec<ProviderModel>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct StoreCredentialRequest {
    #[schema(write_only, example = "fake-credential-value")]
    pub value: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct GeneratedCredential {
    pub name: String,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
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
    /// Omitted preserves; null or zero disables.
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    /// Omitted preserves; null returns the session to single-model mode.
    #[serde(default)]
    pub light_model: RequestField<LightModelSettings>,
}

impl UpdateConfigRequest {
    fn is_empty(&self) -> bool {
        matches!(self.model, RequestField::Omitted)
            && matches!(self.base_url, RequestField::Omitted)
            && matches!(self.backend, RequestField::Omitted)
            && matches!(self.reasoning_effort, RequestField::Omitted)
            && matches!(self.api_key_env, RequestField::Omitted)
            && matches!(self.extra_headers, RequestField::Omitted)
            && matches!(
                self.orchestrator_compaction_threshold,
                RequestField::Omitted
            )
            && matches!(self.light_model, RequestField::Omitted)
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateSessionPresentationRequest {
    pub title: String,
    pub pinned: bool,
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ReorderSessionsRequest {
    pub pinned: bool,
    pub session_ids: Vec<String>,
    pub expected_versions: BTreeMap<String, i64>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReorderSessionsResponse {
    pub pinned: bool,
    pub sessions: Vec<SessionSummarySnapshot>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct SubmitPromptRequest {
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateInboxItemRequest {
    pub delivery: InboxDelivery,
    pub prompt: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateInboxItemRequest {
    pub expected_version: i64,
    pub delivery: InboxDelivery,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CancelInboxItemRequest {
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CreateGoalRequest {
    pub objective: String,
    pub token_budget: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct UpdateGoalRequest {
    pub expected_version: i64,
    pub objective: Option<String>,
    #[serde(default)]
    pub token_budget: RequestField<u64>,
    pub status: Option<GoalStatus>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ClearGoalRequest {
    pub expected_version: i64,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct StartTraditionalChildRequest {
    pub profile: String,
    pub description: String,
    pub prompt: String,
    pub child_session_id: Option<String>,
    #[serde(default)]
    pub background: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct StartManagedOrchestratorRequest {
    pub description: String,
    pub prompt: String,
    pub orchestrator_session_id: Option<String>,
    #[serde(default)]
    pub background: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ReplyPermissionRequest {
    pub reply: PermissionReply,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PermissionStateResponse {
    pub requests: Vec<PermissionRequest>,
    pub grants: Vec<PermissionGrantRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct InboxItemResponse {
    pub id: i64,
    pub session_id: String,
    pub delivery: InboxDelivery,
    pub status: nac_core::store::InboxStatus,
    pub prompt: String,
    pub target_run_id: Option<String>,
    pub client_id: Option<String>,
    pub delivered_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub delivered_at: Option<String>,
    pub cancelled_at: Option<String>,
    pub version: i64,
}

impl From<SessionInboxRecord> for InboxItemResponse {
    fn from(record: SessionInboxRecord) -> Self {
        Self {
            id: record.id,
            session_id: record.session_id,
            delivery: record.delivery,
            status: record.status,
            prompt: nac_core::commands::display_prompt_from_message(&record.content),
            target_run_id: record.target_run_id,
            client_id: record.client_id,
            delivered_run_id: record.delivered_run_id,
            created_at: record.created_at,
            updated_at: record.updated_at,
            delivered_at: record.delivered_at,
            cancelled_at: record.cancelled_at,
            version: record.version,
        }
    }
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct SwitchBranchRequest {
    pub name: String,
    /// Make the branch first, off the current HEAD.
    #[serde(default)]
    pub create: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct CommitWorkspaceRequest {
    pub message: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SubmitPromptResponse {
    pub run_id: String,
    pub client_id: Option<String>,
    pub display_prompt: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct OrchestratorSteeringRequest {
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct OrchestratorSteeringResponse {
    pub steering_id: i64,
    pub status: String,
    pub instruction_preview: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct ThreadSteeringRequest {
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ThreadSteeringResponse {
    pub steering_id: i64,
    pub thread_name: String,
    pub status: String,
    pub instruction_preview: String,
}

#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct EventsQuery {
    pub after_epoch_id: Option<String>,
    pub after_sequence_id: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SessionSnapshotQuery {
    pub message_limit: Option<usize>,
    pub thread_event_limit: Option<usize>,
    pub include_sessions: Option<bool>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct MessagesQuery {
    pub before: Option<usize>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ThreadEventsQuery {
    pub before_id: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct MessagePageMetadata {
    pub start: usize,
    pub end: usize,
    pub total: usize,
    pub has_older: bool,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct MessagesPageResponse {
    pub messages: Vec<Message>,
    pub created_at: Vec<Option<String>>,
    pub page: MessagePageMetadata,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct MessageCycleMetadata {
    pub marker: String,
    pub thread_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct SessionSnapshotResponse {
    #[serde(flatten)]
    pub snapshot: SessionFrontendSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lineage: Option<SessionLineageSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_page: Option<MessagePageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_cycle: Option<MessageCycleMetadata>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum SessionLineageKind {
    TraditionalChild,
    ManagedOrchestrator,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct SessionLineageSnapshot {
    pub kind: SessionLineageKind,
    pub parent_session_id: String,
    pub root_session_id: String,
    pub description: String,
}

impl From<nac_core::session_service::MessagePageMetadata> for MessagePageMetadata {
    fn from(page: nac_core::session_service::MessagePageMetadata) -> Self {
        Self {
            start: page.start,
            end: page.end,
            total: page.total,
            has_older: page.has_older,
        }
    }
}

impl From<nac_core::session_service::MessageCycleMetadata> for MessageCycleMetadata {
    fn from(cycle: nac_core::session_service::MessageCycleMetadata) -> Self {
        Self {
            marker: cycle.marker,
            thread_names: cycle.thread_names,
        }
    }
}

impl From<MessagesPageSnapshot> for MessagesPageResponse {
    fn from(page: MessagesPageSnapshot) -> Self {
        Self {
            messages: page.messages,
            created_at: page.created_at,
            page: page.page.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct RecentEventsResponse {
    pub boundary: SessionEventBoundary,
    pub events: Vec<SessionEventEnvelope>,
}

#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WorkspaceDiffQuery {
    pub path: String,
    pub stage: Option<String>,
    pub context: Option<usize>,
    /// Look at a captured revision instead of the working tree.
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WorkspaceFileQuery {
    pub path: String,
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct OpenWorkspacePathRequest {
    pub path: String,
}

#[derive(Debug, Clone, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct WorkspaceRevisionQuery {
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReplayBoundaryEvent {
    pub epoch_id: String,
    pub replay_boundary_sequence_id: u64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct ReplayGapEvent {
    pub replay_gap: SessionReplayGap,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct LaggedEvent {
    pub missed: u64,
}

impl SessionManager {
    pub(crate) fn root_cwd(&self) -> &std::path::Path {
        &self.inner.root_cwd
    }

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

        let managed_clones = options
            .managed_host
            .as_ref()
            .map(|managed| {
                nac_core::managed_clone::ManagedCloneService::new(
                    &managed.repository_root,
                    &managed.state_root,
                    &managed.home_root,
                    &store_path,
                    Some(
                        managed
                            .github_auth()
                            .expect("validated managed GitHub configuration"),
                    ),
                )
            })
            .transpose()?;
        let manager = Self {
            inner: Arc::new(SessionManagerInner {
                root_cwd,
                store_path: store_path.clone(),
                worker_executable,
                managed_host: options.managed_host,
                managed_clones,
                active_sessions: RwLock::new(HashMap::new()),

                lifecycle_gates: StdMutex::new(HashMap::new()),
                workspace_diff_cache: RwLock::new(HashMap::new()),
                git_probe_cache: RwLock::new(HashMap::new()),
                managed_logins: managed_auth::ManagedLoginRegistry::default(),
                managed_github_logins: managed_github::ManagedGitHubLoginRegistry::default(),
                #[cfg(test)]
                managed_monitor_peer_observed: tokio::sync::Notify::new(),
            }),
        };
        nac_core::traditional_children::register_controller(
            store_path.clone(),
            Arc::new(ServerTraditionalChildController {
                manager: Arc::downgrade(&manager.inner),
            }),
        );
        nac_core::orchestration_control::register_controller(
            store_path,
            Arc::new(ServerOrchestrationController {
                manager: Arc::downgrade(&manager.inner),
            }),
        );
        Ok(manager)
    }

    pub fn store_info(&self) -> StoreInfo {
        StoreInfo {
            root_cwd: self.inner.root_cwd.clone(),
            store_path: self.inner.store_path.clone(),
            worker_executable: self.inner.worker_executable.clone(),
        }
    }

    pub fn managed_host(&self) -> Option<&nac_core::managed::ManagedHostConfig> {
        self.inner.managed_host.as_ref()
    }

    fn attach_managed_command_environment(&self, run_config: &mut runtime::OrchestratorRunConfig) {
        let Some(managed) = self.inner.managed_host.as_ref() else {
            run_config.set_managed_host_context(None, None, None);
            return;
        };
        run_config.set_managed_host_context(
            Some(managed.secret_store()),
            Some(
                managed
                    .github_auth()
                    .expect("validated managed GitHub configuration"),
            ),
            Some(managed.home_root.clone()),
        );
    }

    fn resolve_launch_location(
        &self,
        cwd: Option<PathBuf>,
        ssh: SshRequest,
    ) -> Result<ResolvedLaunchLocation> {
        let ssh = ssh.into_options();
        let ssh_host = ssh.host();
        let (workspace_cwd, config_cwd) = if ssh_host.is_some() {
            let remote_cwd = cwd
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
            let local_cwd = match cwd {
                Some(cwd) => canonicalize_dir(cwd)?,
                None => self.inner.root_cwd.clone(),
            };
            (local_cwd.clone(), local_cwd)
        };
        Ok(ResolvedLaunchLocation {
            workspace_cwd,
            config_cwd,
            ssh,
        })
    }

    pub(crate) fn projects(&self) -> application::projects::ProjectApplication<'_> {
        application::projects::ProjectApplication::new(self)
    }
    async fn browse_ssh(
        &self,
        request: SshBrowseRequest,
    ) -> std::result::Result<filesystem::BrowseListing, runtime::RemoteBrowseError> {
        let options = SshRequest {
            host: request.ssh_host,
            port: request.ssh_port,
            identity_file: request.ssh_identity_file,
        }
        .into_options();
        let listing = runtime::browse_ssh_directory(
            &options,
            request.path.as_deref(),
            request.hidden,
            &self.inner.root_cwd,
        )
        .await?;
        Ok(filesystem::BrowseListing {
            path: listing.path,
            parent: listing.parent,
            home: listing.home,
            entries: listing
                .entries
                .into_iter()
                .map(|entry| filesystem::BrowseEntry {
                    name: entry.name,
                    path: entry.path,
                    is_directory: entry.is_directory,
                })
                .collect(),
            truncated: listing.truncated,
        })
    }

    pub fn launch_model_defaults(
        &self,
        request: LaunchModelDefaultsRequest,
    ) -> Result<LaunchModelDefaults> {
        let location = self.resolve_launch_location(
            request.cwd,
            SshRequest {
                host: request.ssh_host,
                port: request.ssh_port,
                identity_file: request.ssh_identity_file,
            },
        )?;
        let config = NacConfig::load_from_cwd(&location.config_cwd)?;
        Ok(LaunchModelDefaults {
            configured_model: config.model.model.clone(),
            configured_reasoning_effort: config.model.reasoning_effort,
        })
    }

    pub async fn list_sessions(
        &self,
        include_workspace_stats: bool,
    ) -> Result<Vec<ManagedSessionSummary>> {
        self.list_sessions_for_project(include_workspace_stats, None)
            .await
    }

    pub async fn list_sessions_for_project(
        &self,
        include_workspace_stats: bool,
        project_id: Option<&str>,
    ) -> Result<Vec<ManagedSessionSummary>> {
        if !self.inner.store_path.exists() {
            return Ok(Vec::new());
        }

        let store_path = self.inner.store_path.clone();
        let summaries = tokio::task::spawn_blocking(move || view::list_sessions(&store_path))
            .await
            .context("session list task failed")??;
        let mut sessions = {
            let active = self.inner.active_sessions.read().await;
            summaries
                .into_iter()
                .filter(|summary| {
                    project_id
                        .is_none_or(|project_id| summary.project_id.as_deref() == Some(project_id))
                })
                .map(|summary| {
                    let active_service = active.get(&summary.session_id);
                    Ok(ManagedSessionSummary {
                        lineage: self.session_lineage(&summary.session_id)?,
                        active: active_service.is_some(),
                        active_run: active_service.and_then(|service| service.active_run()),
                        summary,
                        workspace_diff: None,
                    })
                })
                .collect::<Result<Vec<_>>>()?
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

    /// Attach "+n −m" to every row of the session list.
    ///
    /// Sessions sharing a checkout are measured once, and the answer is cached,
    /// because this runs on every refresh of the list. Remote checkouts are the
    /// reason for the rest of the care here: measuring one means talking to
    /// another machine, so a host that is slow or gone must cost the list a
    /// bounded wait once rather than a connect timeout per row.
    async fn populate_workspace_diff(&self, sessions: &mut [ManagedSessionSummary]) -> Result<()> {
        let mut targets: HashMap<GitTargetKey, (GitTarget, String)> = HashMap::new();
        let mut key_by_session: HashMap<String, GitTargetKey> = HashMap::new();
        for entry in sessions.iter() {
            let Ok(target) = self.git_target(&entry.summary) else {
                continue;
            };
            let key = git_target_key(&target);
            key_by_session.insert(entry.summary.session_id.clone(), key.clone());
            targets
                .entry(key)
                .or_insert_with(|| (target, entry.summary.cwd.display().to_string()));
        }

        let now = Instant::now();
        let mut totals_by_key: HashMap<GitTargetKey, view::WorkspaceDiffTotals> = HashMap::new();
        let mut pending = Vec::new();
        {
            let cache = self.inner.workspace_diff_cache.read().await;
            for key in targets.keys() {
                match cache.get(key) {
                    Some(entry) if entry.is_fresh(now) => {
                        totals_by_key.insert(key.clone(), entry.totals.clone());
                    }
                    _ => pending.push(key.clone()),
                }
            }
        }

        let mut tasks = Vec::new();
        for key in pending {
            let Some((target, display)) = targets.get(&key).cloned() else {
                continue;
            };
            // A host already known to be unreachable is not dialled again just
            // to fill in a column.
            if let Some(failure) = self.cached_git_failure(&key).await {
                totals_by_key.insert(
                    key.clone(),
                    view::WorkspaceDiffTotals {
                        total_additions: 0,
                        total_deletions: 0,
                        error: Some(failure),
                    },
                );
                continue;
            }
            tasks.push((
                key,
                tokio::task::spawn_blocking(move || {
                    view::workspace_diff_totals(&display, Some(&target))
                }),
            ));
        }

        let mut cache_updates = Vec::new();
        let deadline = tokio::time::Instant::now() + WORKSPACE_DIFF_MEASURE_BUDGET;
        for (key, task) in tasks {
            match tokio::time::timeout_at(deadline, task).await {
                Ok(joined) => {
                    let totals = joined.context("workspace diff task failed")?;
                    totals_by_key.insert(key.clone(), totals.clone());
                    cache_updates.push((key, totals));
                }
                Err(_) => {
                    totals_by_key.insert(
                        key,
                        view::WorkspaceDiffTotals {
                            total_additions: 0,
                            total_deletions: 0,
                            error: Some("workspace diff is still being measured".to_string()),
                        },
                    );
                }
            }
        }

        if !cache_updates.is_empty() {
            let updated_at = Instant::now();
            let mut cache = self.inner.workspace_diff_cache.write().await;
            for (key, totals) in cache_updates {
                cache.insert(key, WorkspaceDiffCacheEntry { updated_at, totals });
            }
        }

        for entry in sessions.iter_mut() {
            entry.workspace_diff = match key_by_session.get(&entry.summary.session_id) {
                Some(key) => totals_by_key.get(key).cloned(),
                None => Some(view::workspace_diff_totals(
                    &entry.summary.cwd.display().to_string(),
                    None,
                )),
            };
        }

        Ok(())
    }

    /// Where git runs for a session's checkout.
    ///
    /// An ssh session's files are on the machine it works on, so git runs there
    /// too, over the connection the session already keeps open. What is left
    /// without a target is a sandbox with no mounted working directory: those
    /// files exist only inside a container that is removed with the session, so
    /// there is nothing durable to inspect, commit or restore.
    fn git_target(&self, summary: &SessionSummarySnapshot) -> Result<GitTarget> {
        if let Some(host) = summary.ssh_host.as_deref() {
            // The stored connection is used as recorded: the key path was
            // resolved when the session was created, so it needs no second pass.
            return Ok(GitTarget::ssh(
                runtime::SshConnection {
                    host: host.to_string(),
                    port: summary.ssh_port,
                    identity_file: summary.ssh_identity_file.as_deref().map(PathBuf::from),
                },
                summary.cwd.clone(),
                &self.inner.root_cwd,
            ));
        }
        summary
            .workspace_host_path
            .clone()
            .map(GitTarget::local)
            .ok_or_else(|| {
                anyhow!(
                    "workspace '{}' lives only inside the sandbox; mount a working directory to inspect it",
                    summary.cwd.display()
                )
            })
    }

    /// The recorded reason a target could not be used, while it is still recent
    /// enough to trust.
    async fn cached_git_failure(&self, key: &GitTargetKey) -> Option<String> {
        let now = Instant::now();
        let cache = self.inner.git_probe_cache.read().await;
        cache
            .get(key)
            .filter(|entry| entry.is_fresh(now))
            .and_then(|entry| entry.failure.clone())
    }

    /// Establish that git can actually be run against this checkout, so the
    /// caller gets one clear reason — host unreachable, no git over there, not a
    /// repository — instead of the same failure repeated by every git command
    /// the request would have made.
    async fn ensure_git_ready(&self, target: &GitTarget) -> Result<()> {
        let key = git_target_key(target);
        let now = Instant::now();
        {
            let cache = self.inner.git_probe_cache.read().await;
            if let Some(entry) = cache.get(&key).filter(|entry| entry.is_fresh(now)) {
                return match &entry.failure {
                    Some(failure) => Err(anyhow!("{failure}")),
                    None => Ok(()),
                };
            }
        }

        let probed = {
            let target = target.clone();
            tokio::task::spawn_blocking(move || target.probe())
                .await
                .context("workspace probe task failed")?
        };
        let failure = probed.as_ref().err().map(|error| format!("{error:#}"));
        self.inner.git_probe_cache.write().await.insert(
            key,
            GitProbeCacheEntry {
                checked_at: Instant::now(),
                failure,
            },
        );
        probed
    }

    /// Releases session services that are not currently in use.
    ///
    /// SQLite connections are operation-scoped, so this cache is no longer a
    /// storage-handle bound. Idle eviction still avoids retaining reconstructible
    /// agent state indefinitely; the next attach rebuilds the service from the
    /// durable store via `resume_session`.
    ///
    /// A session is evicted only when all of these hold:
    /// - it has no active run or compaction,
    /// - nothing outside the map holds a strong reference to it (no in-flight
    ///   request is using it),
    /// - no client holds a live event-stream subscription (an open SSE
    ///   connection, which the eviction would close), and
    /// - it owns no explicitly retained process-local terminal, and
    /// - it does not execute inside a sandbox container: a durably persisted
    ///   container survives service Drop, but reconstructing its agent would
    ///   still discard process-local attachment state while the durable
    ///   container remains live.
    ///
    /// `except` names the session the caller is attaching or creating, which
    /// is skipped so the caller does not evict the very service it is about to
    /// use.
    async fn sweep_idle_sessions(&self, except: Option<&str>) {
        let mut active = self.inner.active_sessions.write().await;
        let idle: Vec<String> = active
            .iter()
            .filter(|(session_id, service)| {
                Some(session_id.as_str()) != except
                    && !service.has_active_operation()
                    && Arc::strong_count(service) == 1
                    && !service.has_event_subscribers()
                    && !service.has_retained_terminals()
                    && !service.has_sandbox()
            })
            .map(|(session_id, _)| session_id.clone())
            .collect();
        for session_id in idle {
            active.remove(&session_id);
            eprintln!("nac: evicted idle session {session_id}");
        }
    }

    pub async fn create_session(
        &self,
        mut request: CreateSessionRequest,
    ) -> Result<SessionFrontendSnapshot> {
        let first_chat_project_id = if request.first_chat {
            Some(
                request
                    .project_id
                    .clone()
                    .filter(|project_id| !project_id.trim().is_empty())
                    .ok_or_else(|| anyhow!("invalid request: first_chat requires project_id"))?,
            )
        } else {
            None
        };
        let first_chat_gate = first_chat_project_id
            .as_ref()
            .map(|project_id| self.lifecycle_gate(&format!("project-first-chat:{project_id}")));
        let _first_chat_admission = match first_chat_gate.as_ref() {
            Some(gate) => Some(gate.lock().await),
            None => None,
        };
        if let Some(project_id) = first_chat_project_id.as_deref() {
            if let Some(session_id) = self.newest_primary_project_session_id(project_id)? {
                return self.snapshot(&session_id).await;
            }
        }
        self.sweep_idle_sessions(None).await;
        let behavior = request.behavior;
        let project_context = request
            .project_id
            .as_deref()
            .map(|project_id| {
                projects::load_project_launch_context(&self.inner.store_path, project_id)
            })
            .transpose()?;
        let (project_id, location) = if let Some(context) = project_context {
            if project_location_conflicts(&request) {
                return Err(anyhow!(
                    "invalid request: project_id cannot be combined with cwd or ssh location fields"
                ));
            }
            if let Some(defaults) = context.default_model_config {
                apply_project_model_defaults(&mut request, defaults);
            } else if let Some(sibling) =
                newest_project_session(&self.inner.store_path, &context.project.project_id)
            {
                apply_sibling_model_defaults(&mut request, sibling);
            }
            let project = context.project;
            let ssh = runtime::SshOptions {
                host: project.ssh_host,
                port: project.ssh_port,
                identity_file: project.ssh_identity_file.map(PathBuf::from),
            };
            let config_cwd = if ssh.host().is_some() {
                self.inner.root_cwd.clone()
            } else {
                project.cwd.clone()
            };
            (
                Some(project.project_id),
                ResolvedLaunchLocation {
                    workspace_cwd: project.cwd,
                    config_cwd,
                    ssh,
                },
            )
        } else {
            (
                None,
                self.resolve_launch_location(
                    request.cwd.take(),
                    SshRequest {
                        host: request.ssh_host.take(),
                        port: request.ssh_port.take(),
                        identity_file: request.ssh_identity_file.take(),
                    },
                )?,
            )
        };
        if location.ssh.host().is_some() && sandbox_requested(&request.sandbox) {
            return Err(anyhow!(
                "invalid request: ssh_host and sandbox options cannot both be set"
            ));
        }
        let config = NacConfig::load_from_cwd(&location.config_cwd)?;
        let orchestrator_compaction_threshold =
            create_compaction_threshold_override(request.orchestrator_compaction_threshold)?;
        let mut model = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
        )?;
        model.light_model = match request.light_model {
            RequestField::Omitted | RequestField::Null => None,
            RequestField::Value(light) => {
                // A same-backend light model with no explicit selector
                // inherits the session's primary one.
                let primary_key = match &model.api_key_env {
                    OptionalModelOption::Value(name) => Some(name.clone()),
                    OptionalModelOption::Inherit | OptionalModelOption::Clear => None,
                };
                let inherited = primary_key.as_deref().and_then(|name| {
                    let backend = model
                        .backend
                        .or_else(|| model.api_model.as_deref().and_then(provider_for_model))?;
                    Some(light_model::InheritedCredential {
                        backend,
                        name: Some(name),
                        previous: None,
                    })
                });
                Some(light_model::normalize(
                    light,
                    &NacConfig::load_credential_destination_policy(&location.config_cwd)?,
                    inherited,
                )?)
            }
        };
        // Mirror the launch-time resolution so the destination is checked
        // against the backend the session will actually use.
        let launch_backend = model.backend.or_else(|| {
            model
                .api_model
                .as_deref()
                .or(config.model.model.as_deref())
                .and_then(provider_for_model)
        });
        enforce_trusted_base_url(
            launch_backend,
            model.api_base_url.as_deref(),
            &NacConfig::load_credential_destination_policy(&location.config_cwd)?,
        )?;
        let mut run_config = runtime::build_run_config_for_project_with_behavior(
            RunOptions {
                workspace_cwd: location.workspace_cwd,
                config_cwd: Some(location.config_cwd.clone()),
                worker_executable: Some(self.inner.worker_executable.clone()),
                store: StoreOptions {
                    store_path: Some(self.inner.store_path.clone()),
                },
                model,
                orchestrator_compaction_threshold,
                sandbox: sandbox_options(request.sandbox),
                ssh: location.ssh,
            },
            &config,
            project_id,
            behavior,
        )
        .await
        .map_err(|error| {
            // A broken light model fails here, at launch resolution. Route it
            // through the configuration-error boundary so the response names
            // the actionable cause.
            match error.downcast_ref::<LightModelError>() {
                Some(light_error) if light_error.is_invalid_settings() => {
                    request_configuration_error_from(error)
                }
                _ => error,
            }
        })?;
        self.attach_managed_command_environment(&mut run_config);
        let parts = SessionService::from_orchestrator_run_config(run_config);
        let service = parts.service;
        service.acquire_sandbox_resource_lease()?;
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

    fn newest_primary_project_session_id(&self, project_id: &str) -> Result<Option<String>> {
        let mut candidates = sessions::list_sessions(&self.inner.store_path)?
            .into_iter()
            .filter(|summary| summary.project_id.as_deref() == Some(project_id))
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        for candidate in candidates {
            if self.session_lineage(&candidate.session_id)?.is_none() {
                return Ok(Some(candidate.session_id));
            }
        }
        Ok(None)
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
        const MAX_ATTEMPTS: usize = 2;

        self.sweep_idle_sessions(Some(session_id)).await;
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        for _ in 0..MAX_ATTEMPTS {
            if let Some(service) = self
                .inner
                .active_sessions
                .read()
                .await
                .get(session_id)
                .cloned()
            {
                let version = self.session_config(session_id)?.config_version;
                if service.config_version() == Some(version) {
                    let has_recovery = service.has_unreconciled_durable_run_recovery()?;
                    if !has_recovery || service.has_active_operation() {
                        self.wake_direct_inbox(&service).await?;
                        return Ok(service);
                    }
                    match sessions::SessionOperationLease::try_acquire(
                        &self.inner.store_path,
                        session_id,
                    ) {
                        Ok(lease) => {
                            service.reconcile_durable_run_recovery(&lease).await?;
                            drop(lease);
                            self.wake_direct_inbox(&service).await?;
                            return Ok(service);
                        }
                        Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                            return Ok(service);
                        }
                        Err(error) => return Err(anyhow::Error::new(error)),
                    }
                }
                let mut active = self.inner.active_sessions.write().await;
                if active
                    .get(session_id)
                    .is_some_and(|cached| Arc::ptr_eq(cached, &service))
                {
                    active.remove(session_id);
                }
            }

            let (service, cacheable, operation_lease) =
                self.resume_session_attachment(session_id).await?;
            drop(operation_lease);
            let service = Arc::new(service);
            if !cacheable {
                return Ok(service);
            }
            let version = self.session_config(session_id)?.config_version;
            if service.config_version() != Some(version) {
                continue;
            }
            self.inner
                .active_sessions
                .write()
                .await
                .insert(session_id.to_string(), Arc::clone(&service));
            self.wake_direct_inbox(&service).await?;
            return Ok(service);
        }
        Err(anyhow!(
            "session '{}' configuration kept changing during attachment",
            session_id
        ))
    }

    async fn wake_direct_inbox(&self, service: &SessionService) -> Result<()> {
        if let Some(parent_session_id) = service.metadata().session_id.as_deref() {
            self.repair_orphaned_completion_suppressions(parent_session_id)?;
        }
        let child = service.reconcile_traditional_child_terminal().await?;
        if child.is_none() {
            let metadata = service.metadata();
            let Some(parent_session_id) = metadata.session_id.as_deref() else {
                return Ok(());
            };
            let running_children = nac_core::store::list_traditional_children(
                &self.inner.store_path,
                parent_session_id,
            )?
            .into_iter()
            .filter(|child| child.status == nac_core::store::TraditionalChildStatus::Running)
            .map(|child| child.child_session_id)
            .collect::<Vec<_>>();
            for child_session_id in running_children {
                // Attaching a child reconciles an abandoned generation from its
                // durable run-recovery row. The parent is already cached before
                // this method runs, so the resulting completion wake does not
                // need to re-enter the parent's lifecycle gate.
                Box::pin(self.attach_session(&child_session_id)).await?;
            }
            if metadata.behavior == sessions::SessionBehavior::DirectWithOrchestrator {
                for orchestrator in nac_core::store::list_managed_orchestrators(
                    &self.inner.store_path,
                    parent_session_id,
                )?
                .into_iter()
                .filter(|orchestrator| orchestrator.status == ManagedOrchestratorStatus::Running)
                {
                    self.spawn_managed_orchestrator_monitor(
                        orchestrator.orchestrator_session_id,
                        orchestrator.generation,
                    );
                }
            }
        }
        if service.metadata().behavior != sessions::SessionBehavior::Orchestrator {
            service.start_next_direct_inbox_item().await?;
        }
        Ok(())
    }

    /// `completion_suppressed=1` is itself the durable rollback obligation for
    /// a deletion that did not commit. An active deletion owns the child's
    /// relationship lease and wins; after process death or a failed in-memory
    /// rollback the lease is free, so parent attachment restores delivery and
    /// synthesizes any terminal completion that settlement omitted.
    fn repair_orphaned_completion_suppressions(&self, parent_session_id: &str) -> Result<()> {
        let store_path = &self.inner.store_path;
        for (child_session_id, generation) in
            nac_core::store::list_suppressed_traditional_child_generations(
                store_path,
                parent_session_id,
            )?
        {
            let lease = match sessions::SessionRelationshipLease::try_acquire(
                store_path,
                &child_session_id,
            ) {
                Ok(lease) => lease,
                Err(sessions::SessionOperationLeaseError::Busy(_)) => continue,
                Err(sessions::SessionOperationLeaseError::Store(error)) => return Err(error),
            };
            if sessions::load_session(store_path, &child_session_id).is_ok() {
                nac_core::store::restore_traditional_child_completion(
                    store_path,
                    &child_session_id,
                    generation,
                )?;
            }
            drop(lease);
        }
        for (orchestrator_session_id, generation) in
            nac_core::store::list_suppressed_managed_orchestrator_generations(
                store_path,
                parent_session_id,
            )?
        {
            let lease = match sessions::SessionRelationshipLease::try_acquire(
                store_path,
                &orchestrator_session_id,
            ) {
                Ok(lease) => lease,
                Err(sessions::SessionOperationLeaseError::Busy(_)) => continue,
                Err(sessions::SessionOperationLeaseError::Store(error)) => return Err(error),
            };
            if sessions::load_session(store_path, &orchestrator_session_id).is_ok() {
                nac_core::store::restore_managed_orchestrator_completion(
                    store_path,
                    &orchestrator_session_id,
                    generation,
                )?;
            }
            drop(lease);
        }
        Ok(())
    }

    /// Attaches while the caller holds this session's lifecycle gate. Keeping
    /// resume and insertion behind the same gate prevents an old service from
    /// being inserted after a settings update has committed.
    async fn attach_session_locked(
        &self,
        session_id: &str,
        operation_lease: Option<&sessions::SessionOperationLease>,
    ) -> Result<Arc<SessionService>> {
        self.sweep_idle_sessions(Some(session_id)).await;
        if let Some(service) = self.inner.active_sessions.read().await.get(session_id) {
            return Ok(Arc::clone(service));
        }

        let service = Arc::new(self.resume_session(session_id, operation_lease).await?);
        let mut active = self.inner.active_sessions.write().await;
        if let Some(existing) = active.get(session_id) {
            return Ok(Arc::clone(existing));
        }
        active.insert(session_id.to_string(), Arc::clone(&service));
        Ok(service)
    }

    /// Returns a service whose model configuration matches the store. The
    /// caller must hold both the local lifecycle gate and the supplied
    /// operation lease. Durable compaction checkpoints are refreshed by the
    /// core admission path after this returns.
    async fn attach_current_operation_service_locked(
        &self,
        session_id: &str,
        operation_lease: &sessions::SessionOperationLease,
    ) -> Result<Arc<SessionService>> {
        operation_lease
            .validate(&self.inner.store_path, session_id)
            .map_err(anyhow::Error::new)?;
        let persisted_version =
            sessions::load_session_config(&self.inner.store_path, session_id)?.config_version;
        let cached = self
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        let service = if let Some(service) = cached {
            if service.config_version() == Some(persisted_version) {
                service
            } else {
                if service.has_active_operation() {
                    return Err(anyhow!(
                        "session is busy with an active operation while its persisted configuration changed"
                    ));
                }
                self.inner.active_sessions.write().await.remove(session_id);
                self.attach_session_locked(session_id, Some(operation_lease))
                    .await?
            }
        } else {
            self.attach_session_locked(session_id, Some(operation_lease))
                .await?
        };
        if service.has_unreconciled_durable_run_recovery()? && !service.has_active_operation() {
            service
                .reconcile_durable_run_recovery(operation_lease)
                .await?;
        }
        Ok(service)
    }

    fn persisted_operation_session_exists(&self, session_id: &str) -> Result<bool> {
        // Lease filenames hex-encode IDs; 120 bytes plus the suffix fits within
        // the common 255-byte component limit.
        const MAX_SESSION_ID_BYTES: usize = 120;

        if session_id.is_empty() || session_id.len() > MAX_SESSION_ID_BYTES {
            return Ok(false);
        }
        sessions::session_exists(&self.inner.store_path, session_id)
    }

    fn require_persisted_operation_session(&self, session_id: &str) -> Result<()> {
        if self.persisted_operation_session_exists(session_id)? {
            Ok(())
        } else {
            Err(anyhow!("session '{}' was not found", session_id))
        }
    }

    fn require_primary_operation_session(&self, session_id: &str) -> Result<()> {
        self.require_persisted_operation_session(session_id)?;
        if self.session_lineage(session_id)?.is_some() {
            return Err(anyhow!(
                "delegated sessions accept work only through their parent"
            ));
        }
        Ok(())
    }

    fn require_primary_direct_session(&self, session_id: &str) -> Result<()> {
        self.require_persisted_operation_session(session_id)?;
        if self.session_lineage(session_id)?.is_some() {
            return Err(anyhow!(
                "delegated sessions accept input only through their parent"
            ));
        }
        Ok(())
    }

    pub fn session_config(&self, session_id: &str) -> Result<sessions::RawSessionConfig> {
        sessions::load_session_config(&self.inner.store_path, session_id)
    }

    pub async fn snapshot(&self, session_id: &str) -> Result<SessionFrontendSnapshot> {
        self.attach_session(session_id)
            .await?
            .frontend_snapshot()
            .await
    }

    pub async fn snapshot_with_options(
        &self,
        session_id: &str,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<SessionFrontendSnapshotLoad> {
        self.attach_session(session_id)
            .await?
            .frontend_snapshot_with_options(options)
            .await
    }

    pub fn session_lineage(&self, session_id: &str) -> Result<Option<SessionLineageSnapshot>> {
        if let Some(child) =
            nac_core::store::load_traditional_child(&self.inner.store_path, session_id)?
        {
            return Ok(Some(SessionLineageSnapshot {
                kind: SessionLineageKind::TraditionalChild,
                parent_session_id: child.parent_session_id,
                root_session_id: child.root_session_id,
                description: child.description,
            }));
        }
        if let Some(orchestrator) =
            nac_core::store::load_managed_orchestrator(&self.inner.store_path, session_id)?
        {
            return Ok(Some(SessionLineageSnapshot {
                kind: SessionLineageKind::ManagedOrchestrator,
                parent_session_id: orchestrator.parent_session_id,
                root_session_id: orchestrator.root_session_id,
                description: orchestrator.description,
            }));
        }
        Ok(None)
    }

    pub async fn messages_page(
        &self,
        session_id: &str,
        request: MessagePageRequest,
    ) -> Result<MessagesPageSnapshot> {
        self.attach_session(session_id)
            .await?
            .messages_page(request)
            .await
    }

    pub async fn list_direct_inbox(&self, session_id: &str) -> Result<Vec<SessionInboxRecord>> {
        self.require_primary_direct_session(session_id)?;
        self.attach_session(session_id).await?.list_direct_inbox()
    }

    pub async fn create_direct_inbox_item(
        &self,
        session_id: &str,
        request: CreateInboxItemRequest,
    ) -> Result<SessionInboxRecord> {
        self.require_primary_direct_session(session_id)?;
        let service = self.attach_session(session_id).await?;
        let prompt = match service.prepare_user_input(&request.prompt) {
            PreparedUserInput::Empty => return Err(anyhow!("prompt is empty")),
            PreparedUserInput::InvalidSlashCommand { message } => return Err(anyhow!(message)),
            PreparedUserInput::FrontendCommand(command) => {
                return Err(anyhow!(
                    "frontend command '{}' is not supported by the server API",
                    frontend_command_name(command)
                ));
            }
            PreparedUserInput::SubmitPrompt(prompt) => prompt,
        };
        service
            .enqueue_direct_input(request.delivery, &prompt.agent_prompt, None)
            .await
    }

    pub async fn update_direct_inbox_item(
        &self,
        session_id: &str,
        item_id: i64,
        request: UpdateInboxItemRequest,
    ) -> Result<SessionInboxRecord> {
        self.require_primary_direct_session(session_id)?;
        self.attach_session(session_id)
            .await?
            .update_direct_inbox_item(item_id, request.expected_version, request.delivery)
            .await
    }

    pub async fn cancel_direct_inbox_item(
        &self,
        session_id: &str,
        item_id: i64,
        request: CancelInboxItemRequest,
    ) -> Result<SessionInboxRecord> {
        self.require_primary_direct_session(session_id)?;
        self.attach_session(session_id)
            .await?
            .cancel_direct_inbox_item(item_id, request.expected_version)
    }

    pub async fn permission_state(&self, session_id: &str) -> Result<PermissionStateResponse> {
        let service = self.attach_session(session_id).await?;
        Ok(PermissionStateResponse {
            requests: service.list_permission_requests()?,
            grants: service.list_permission_grants()?,
        })
    }

    pub async fn direct_goal(&self, session_id: &str) -> Result<Option<SessionGoalRecord>> {
        self.attach_session(session_id).await?.direct_goal()
    }

    pub async fn create_direct_goal(
        &self,
        session_id: &str,
        request: CreateGoalRequest,
    ) -> Result<SessionGoalRecord> {
        self.attach_session(session_id)
            .await?
            .create_direct_goal(&request.objective, request.token_budget)
            .await
    }

    pub async fn update_direct_goal(
        &self,
        session_id: &str,
        goal_id: &str,
        request: UpdateGoalRequest,
    ) -> Result<SessionGoalRecord> {
        self.attach_session(session_id)
            .await?
            .update_direct_goal(
                goal_id,
                request.expected_version,
                UserGoalUpdate {
                    objective: request.objective,
                    token_budget: request_field_patch(request.token_budget),
                    status: request.status,
                },
            )
            .await
    }

    pub async fn clear_direct_goal(
        &self,
        session_id: &str,
        goal_id: &str,
        expected_version: i64,
    ) -> Result<()> {
        self.attach_session(session_id)
            .await?
            .clear_direct_goal(goal_id, expected_version)
    }

    pub async fn list_traditional_children(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<TraditionalChildRecord>> {
        let service = self.attach_session(parent_session_id).await?;
        if service.metadata().behavior == sessions::SessionBehavior::Orchestrator {
            return Err(anyhow!(
                "traditional children are available only for direct behaviors"
            ));
        }
        if nac_core::store::load_traditional_child(&self.inner.store_path, parent_session_id)?
            .is_some()
        {
            return Err(anyhow!(
                "traditional child nesting limit reached (1): child sessions cannot launch children"
            ));
        }
        nac_core::store::list_traditional_children(&self.inner.store_path, parent_session_id)
    }

    pub async fn start_traditional_child(
        &self,
        parent_session_id: &str,
        request: StartTraditionalChildRequest,
    ) -> Result<TraditionalChildRecord> {
        self.attach_session(parent_session_id).await?;
        let controller = nac_core::traditional_children::controller_for(&self.inner.store_path)?;
        let background = request.background;
        let child = controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: parent_session_id.to_string(),
                    child_session_id: request.child_session_id,
                    profile: request.profile,
                    description: request.description,
                    prompt: request.prompt,
                    execution_mode: if background {
                        TraditionalChildExecutionMode::Background
                    } else {
                        TraditionalChildExecutionMode::Foreground
                    },
                },
            )
            .await?;
        if background {
            Ok(child)
        } else {
            controller
                .wait(&child.child_session_id, child.generation)
                .await
        }
    }

    pub fn traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        nac_core::store::load_traditional_child_for_parent(
            &self.inner.store_path,
            parent_session_id,
            child_session_id,
        )?
        .ok_or_else(|| anyhow!("traditional child was not found"))
    }

    pub async fn cancel_traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        self.traditional_child(parent_session_id, child_session_id)?;
        let controller = nac_core::traditional_children::controller_for(&self.inner.store_path)?;
        controller.cancel(parent_session_id, child_session_id).await
    }

    pub async fn list_managed_orchestrators(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<ManagedOrchestratorRecord>> {
        let service = self.attach_session(parent_session_id).await?;
        if service.metadata().behavior != sessions::SessionBehavior::DirectWithOrchestrator {
            return Err(anyhow!(
                "managed orchestrators require direct-with-orchestrator behavior"
            ));
        }
        nac_core::store::list_managed_orchestrators(&self.inner.store_path, parent_session_id)
    }

    pub fn managed_orchestrator(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        nac_core::store::load_managed_orchestrator_for_parent(
            &self.inner.store_path,
            parent_session_id,
            orchestrator_session_id,
        )?
        .ok_or_else(|| anyhow!("managed orchestrator was not found"))
    }

    pub async fn start_managed_orchestrator(
        &self,
        parent_session_id: &str,
        request: StartManagedOrchestratorRequest,
    ) -> Result<ManagedOrchestratorRecord> {
        self.attach_session(parent_session_id).await?;
        let controller = nac_core::orchestration_control::controller_for(&self.inner.store_path)?;
        let background = request.background;
        let orchestrator = controller
            .start(
                nac_core::orchestration_control::ManagedOrchestratorStartRequest {
                    parent_session_id: parent_session_id.to_string(),
                    orchestrator_session_id: request.orchestrator_session_id,
                    description: request.description,
                    prompt: request.prompt,
                    execution_mode: if background {
                        ManagedOrchestratorExecutionMode::Background
                    } else {
                        ManagedOrchestratorExecutionMode::Foreground
                    },
                },
            )
            .await?;
        if background {
            Ok(orchestrator)
        } else {
            controller
                .wait(
                    &orchestrator.orchestrator_session_id,
                    orchestrator.generation,
                )
                .await
        }
    }

    pub async fn cancel_managed_orchestrator(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        self.managed_orchestrator(parent_session_id, orchestrator_session_id)?;
        nac_core::orchestration_control::controller_for(&self.inner.store_path)?
            .cancel(parent_session_id, orchestrator_session_id)
            .await
    }

    pub async fn reply_permission_request(
        &self,
        session_id: &str,
        request_id: &str,
        reply: PermissionReply,
    ) -> Result<()> {
        self.attach_session(session_id)
            .await?
            .reply_permission_request(request_id, reply)
    }

    pub async fn delete_permission_grant(&self, session_id: &str, grant_id: &str) -> Result<()> {
        self.attach_session(session_id)
            .await?
            .delete_permission_grant(grant_id)
    }

    pub async fn thread_events(
        &self,
        session_id: &str,
        thread_name: &str,
        before_id: Option<i64>,
        limit: usize,
    ) -> Result<ThreadEventPage> {
        self.attach_session(session_id)
            .await?
            .thread_events_page(thread_name, before_id, limit)
    }

    pub async fn workspace_file_diff(
        &self,
        session_id: &str,
        query: WorkspaceDiffQuery,
    ) -> Result<view::WorkspaceFileDiff> {
        let stage = view::WorkspaceDiffStage::parse(query.stage.as_deref().unwrap_or("all"))?;
        let context = query.context.unwrap_or(3).min(100);
        let path = query.path;
        let target = self.workspace_root(session_id).await?;

        let revision = self.resolve_revision(session_id, query.revision)?;
        tokio::task::spawn_blocking(move || match revision {
            Some(revision) => view::revision_file_diff(
                &target,
                revision.base_sha.as_deref(),
                &revision.commit_sha,
                &path,
                context,
            ),
            None => view::workspace_file_diff(&target, &path, stage, context),
        })
        .await
        .context("workspace diff task failed")?
    }

    /// The checkout of a session, refusing when an agent could be working in
    /// it. Several sessions may share one checkout, so every one of them has to
    /// be quiet, not just this one — and "the same checkout" means the same
    /// directory *on the same machine*, which is what keeps two sessions on one
    /// remote path from moving each other's branch.
    async fn idle_workspace_root(&self, session_id: &str) -> Result<WorkspaceMutationAdmission> {
        let initial_sessions = self.list_sessions(false).await?;
        let summary = initial_sessions
            .iter()
            .find(|entry| entry.summary.session_id == session_id)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let target = self.git_target(&summary.summary)?;
        let workspace_gate =
            nac_core::shared_workspace_gate_for(&self.inner.store_path, target.root())
                .write_owned()
                .await;
        let workspace_lease = match sessions::WorkspaceMutationLease::try_acquire(
            &self.inner.store_path,
            &target.lease_identity(),
        ) {
            Ok(lease) => lease,
            Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                return Err(anyhow!(
                    "workspace is busy: a retained terminal may still mutate the checkout"
                ));
            }
            Err(error) => return Err(anyhow::Error::new(error)),
        };

        // Re-read after taking the same process-wide gate used by native file,
        // shell, and terminal-input tools. Then acquire every same-checkout
        // session operation lease in stable order and retain them through Git.
        // This turns the idle observation into an admission boundary: an
        // already-running peer makes acquisition fail, and a new run cannot
        // establish ownership until the branch/commit operation is finished.
        let sessions = self.list_sessions(false).await?;
        let current = sessions
            .iter()
            .find(|entry| entry.summary.session_id == session_id)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let current_target = self.git_target(&current.summary)?;
        if git_target_key(&current_target) != git_target_key(&target) {
            return Err(anyhow!("workspace changed during mutation admission"));
        }
        let key = git_target_key(&target);
        let mut session_ids = sessions
            .iter()
            .filter(|entry| {
                self.git_target(&entry.summary)
                    .is_ok_and(|other| git_target_key(&other) == key)
            })
            .map(|entry| entry.summary.session_id.clone())
            .collect::<Vec<_>>();
        session_ids.sort();

        let cached = self.inner.active_sessions.read().await;
        if let Some(retained) = session_ids.iter().find(|candidate| {
            cached
                .get(candidate.as_str())
                .is_some_and(|service| service.has_retained_terminals())
        }) {
            return Err(anyhow!(
                "workspace is busy: session '{retained}' owns a retained terminal"
            ));
        }
        drop(cached);

        let mut session_leases = Vec::with_capacity(session_ids.len());
        for candidate in session_ids {
            match sessions::SessionOperationLease::try_acquire(&self.inner.store_path, &candidate) {
                Ok(lease) => session_leases.push(lease),
                Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                    return Err(anyhow!(
                        "workspace is busy: session '{candidate}' has an operation in flight"
                    ));
                }
                Err(error) => return Err(anyhow::Error::new(error)),
            }
        }

        self.ensure_git_ready(&target).await?;
        Ok(WorkspaceMutationAdmission {
            target,
            _workspace_gate: workspace_gate,
            _workspace_lease: workspace_lease,
            _session_leases: session_leases,
        })
    }

    async fn execute_workspace_mutation<T, F>(
        admission: WorkspaceMutationAdmission,
        task_context: &'static str,
        operation: F,
    ) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&GitTarget) -> Result<T> + Send + 'static,
    {
        tokio::task::spawn_blocking(move || {
            // The admission owns every process-local and cross-process lease.
            // Moving it into this uncancellable closure keeps authority alive
            // even if the request future awaiting the JoinHandle is aborted.
            let result = operation(&admission.target);
            drop(admission);
            result
        })
        .await
        .with_context(|| task_context)?
    }

    /// The checkout of a session, for read-only inspection.
    async fn workspace_root(&self, session_id: &str) -> Result<GitTarget> {
        let summary = self
            .list_sessions(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let target = self.git_target(&summary)?;
        self.ensure_git_ready(&target).await?;
        Ok(target)
    }

    pub async fn workspace_files(
        &self,
        session_id: &str,
        revision: Option<i64>,
    ) -> Result<view::WorkspaceFileList> {
        let target = self.workspace_root(session_id).await?;
        let revision = self.resolve_revision(session_id, revision)?;
        tokio::task::spawn_blocking(move || match revision {
            Some(revision) => view::list_revision_files(&target, &revision.commit_sha),
            None => view::list_files(&target),
        })
        .await
        .context("workspace file listing task failed")?
    }

    pub async fn workspace_file(
        &self,
        session_id: &str,
        path: String,
        revision: Option<i64>,
    ) -> Result<view::WorkspaceFileContent> {
        let target = self.workspace_root(session_id).await?;
        let revision = self.resolve_revision(session_id, revision)?;
        tokio::task::spawn_blocking(move || match revision {
            Some(revision) => view::read_revision_file(&target, &revision.commit_sha, &path),
            None => view::read_file(&target, &path),
        })
        .await
        .context("workspace file read task failed")?
    }

    /// Open a workspace path in the OS file manager / default app. Local
    /// sessions only — an ssh checkout is not a path this machine can open.
    pub async fn open_workspace_path(
        &self,
        session_id: &str,
        path: String,
    ) -> Result<view::OpenLocalPathResult> {
        let summary = self
            .list_sessions(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        if summary.ssh_host.is_some() {
            anyhow::bail!("opening paths is only available for local sessions");
        }
        let target = self.git_target(&summary)?;
        let root = target
            .local_path()
            .ok_or_else(|| {
                anyhow!(
                    "workspace '{}' lives only inside the sandbox; mount a working directory to open it",
                    summary.cwd.display()
                )
            })?
            .to_path_buf();
        tokio::task::spawn_blocking(move || view::open_local_path(&root, &path))
            .await
            .context("workspace open task failed")?
    }

    pub fn workspace_revisions(
        &self,
        session_id: &str,
    ) -> Result<Vec<view::WorkspaceRevisionRecord>> {
        view::list_workspace_revisions(&self.inner.store_path, session_id)
    }

    /// What the run behind a revision changed, in the shape the live workspace
    /// reports, so the files panel can render either one the same way.
    pub async fn workspace_revision_changes(
        &self,
        session_id: &str,
        revision_id: i64,
    ) -> Result<view::WorkspaceRevisionChanges> {
        let target = self.workspace_root(session_id).await?;
        let revision = self
            .resolve_revision(session_id, Some(revision_id))?
            .ok_or_else(|| anyhow!("revision '{}' was not found", revision_id))?;

        tokio::task::spawn_blocking(move || {
            view::revision_changes(&target, revision.base_sha.as_deref(), &revision.commit_sha)
        })
        .await
        .context("workspace revision task failed")
    }

    /// Revisions are addressed by their store id rather than by commit, so a
    /// request can only ever reach an object this session actually recorded.
    fn resolve_revision(
        &self,
        session_id: &str,
        revision: Option<i64>,
    ) -> Result<Option<view::WorkspaceRevisionRecord>> {
        let Some(revision) = revision else {
            return Ok(None);
        };
        view::read_workspace_revision(&self.inner.store_path, session_id, revision)?
            .ok_or_else(|| anyhow!("revision '{}' was not found", revision))
            .map(Some)
    }

    pub async fn workspace_branches(&self, session_id: &str) -> Result<workspace::BranchList> {
        let target = self.workspace_root(session_id).await?;
        tokio::task::spawn_blocking(move || workspace::list_branches(&target))
            .await
            .context("branch listing task failed")?
    }

    pub async fn switch_workspace_branch(
        &self,
        session_id: &str,
        request: SwitchBranchRequest,
    ) -> Result<workspace::BranchList> {
        self.require_primary_operation_session(session_id)?;
        let admission = self.idle_workspace_root(session_id).await?;

        Self::execute_workspace_mutation(admission, "branch switch task failed", move |target| {
            if request.create {
                // A new branch takes the uncommitted work with it, which is
                // usually the point of making one, so a dirty tree is fine.
                return workspace::create_branch(target, &request.name);
            }
            if workspace::list_branches(target)?.dirty {
                return Err(anyhow!(
                    "workspace has uncommitted changes; commit or stash them before switching"
                ));
            }
            workspace::switch_branch(target, &request.name)
        })
        .await
    }

    /// Commit the whole checkout on the user's behalf. Guarded like a branch
    /// switch: an agent writing files underneath a `git add` would commit a
    /// half-finished tree.
    pub async fn commit_workspace(
        &self,
        session_id: &str,
        request: CommitWorkspaceRequest,
    ) -> Result<workspace::CommitOutcome> {
        self.require_primary_operation_session(session_id)?;
        let admission = self.idle_workspace_root(session_id).await?;

        Self::execute_workspace_mutation(admission, "commit task failed", move |target| {
            workspace::commit_all(target, &request.message)
        })
        .await
    }

    pub async fn session_skills(
        &self,
        session_id: &str,
    ) -> Result<Vec<nac_core::skill_catalog::SkillCatalogEntry>> {
        Ok(self
            .attach_session(session_id)
            .await?
            .skill_catalog_entries())
    }

    pub async fn submit_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
    ) -> Result<SubmitPromptResponse> {
        self.require_primary_operation_session(session_id)?;
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        // The OS lease closes the cross-process gap between checking durable
        // state and synchronously establishing active-run state.
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)?;
        self.require_primary_operation_session(session_id)?;
        let service = self
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await?;
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
                    .try_submit_prepared_prompt_with_lease(prompt, operation_lease)
                    .map_err(anyhow::Error::new)?;
                Ok(submit_response(handle, display_prompt))
            }
        }
    }

    async fn submit_managed_orchestrator_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
        execution_mode: ManagedOrchestratorExecutionMode,
    ) -> Result<SubmitPromptResponse> {
        self.require_persisted_operation_session(session_id)?;
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)?;
        self.require_persisted_operation_session(session_id)?;
        let service = self
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await?;
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
                    .try_submit_prepared_managed_orchestrator_prompt_with_lease(
                        prompt,
                        operation_lease,
                        execution_mode,
                    )
                    .map_err(anyhow::Error::new)?;
                Ok(submit_response(handle, display_prompt))
            }
        }
    }

    pub async fn queue_thread_steering(
        &self,
        session_id: &str,
        thread_name: &str,
        request: ThreadSteeringRequest,
    ) -> Result<ThreadSteeringResponse> {
        self.require_primary_operation_session(session_id)?;
        self.queue_thread_steering_unchecked(session_id, thread_name, request, None)
            .await
    }

    async fn queue_thread_steering_unchecked(
        &self,
        session_id: &str,
        thread_name: &str,
        request: ThreadSteeringRequest,
        expected_run_id: Option<&str>,
    ) -> Result<ThreadSteeringResponse> {
        let service = self.attach_session(session_id).await?;
        let record = service
            .queue_thread_steering_for_run(thread_name, &request.instruction, expected_run_id)
            .await?;
        Ok(ThreadSteeringResponse {
            steering_id: record.id,
            thread_name: record.thread_name,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
    }

    pub async fn queue_orchestrator_steering(
        &self,
        session_id: &str,
        request: OrchestratorSteeringRequest,
    ) -> Result<OrchestratorSteeringResponse> {
        self.require_primary_operation_session(session_id)?;
        self.queue_orchestrator_steering_unchecked(session_id, request)
            .await
    }

    async fn queue_orchestrator_steering_unchecked(
        &self,
        session_id: &str,
        request: OrchestratorSteeringRequest,
    ) -> Result<OrchestratorSteeringResponse> {
        let service = self.attach_session(session_id).await?;
        let record = service.queue_orchestrator_steering(&request.instruction)?;
        Ok(OrchestratorSteeringResponse {
            steering_id: record.id,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
    }

    fn queue_managed_orchestrator_steering(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
        instruction: &str,
    ) -> Result<OrchestratorSteeringResponse> {
        let record = nac_core::store::queue_managed_orchestrator_steering(
            &self.inner.store_path,
            parent_session_id,
            orchestrator_session_id,
            instruction,
        )?;
        Ok(OrchestratorSteeringResponse {
            steering_id: record.id,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
    }

    pub async fn recent_events(
        &self,
        session_id: &str,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<(SessionEventBoundary, Vec<SessionEventEnvelope>)> {
        Ok(self
            .attach_session(session_id)
            .await?
            .recent_events(cursor, limit))
    }
    pub async fn subscribe_events(
        &self,
        session_id: &str,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<(
        String,
        u64,
        Option<SessionReplayGap>,
        Vec<SessionEventEnvelope>,
        SessionEventReceiver,
        AssistantStreamDeltaReceiver,
    )> {
        let service = self.attach_session(session_id).await?;
        let subscription = service
            .connect_client()
            .subscribe_events_with_replay(cursor, limit);
        Ok((
            subscription.epoch_id,
            subscription.replay_boundary_sequence_id,
            subscription.replay_gap,
            subscription.replayed_events,
            subscription.receiver,
            subscription.assistant_deltas,
        ))
    }

    pub async fn cancel_active_run(&self, session_id: &str) -> Result<()> {
        self.require_primary_operation_session(session_id)?;
        self.cancel_active_run_unchecked(session_id).await
    }

    async fn cancel_active_run_unchecked(&self, session_id: &str) -> Result<()> {
        let service = self.attach_session(session_id).await?;
        let Some(active) = service.active_run() else {
            // An uncached service is also returned when another NAC process
            // owns the durable operation lease. Never report cancellation as
            // successful merely because this process has no task handle.
            return match sessions::SessionOperationLease::try_acquire(
                &self.inner.store_path,
                session_id,
            ) {
                Ok(_idle) => Ok(()),
                Err(sessions::SessionOperationLeaseError::Busy(_)) => Err(anyhow!(
                    "session '{session_id}' is running in another process and cannot be cancelled from this process"
                )),
                Err(error) => Err(anyhow::Error::new(error)),
            };
        };
        match service
            .connect_client()
            .request_cancel(&active.run_id)
            .await
        {
            Ok(()) | Err(SessionCancelError::NotActive { .. }) => Ok(()),
            Err(SessionCancelError::Cleanup { message, .. }) => Err(anyhow!(message)),
        }
    }

    /// Cancel every run owned by this process before a graceful server stop.
    ///
    /// Peer NAC processes keep ownership of their own durable leases. Runs
    /// that do not settle before process shutdown are reconciled by the
    /// existing store-recovery path on the next start.
    async fn cancel_local_active_runs_for_shutdown(&self) {
        let services = self
            .inner
            .active_sessions
            .read()
            .await
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for service in services {
            let Some(active) = service.active_run() else {
                continue;
            };
            if let Err(error) = service
                .connect_client()
                .request_cancel(&active.run_id)
                .await
            {
                eprintln!(
                    "nac: failed to cancel run {} during shutdown: {error}",
                    active.run_id
                );
            }
        }
    }

    /// Deletes a session and all related data (threads, episodes, worksets,
    /// workset_items) from the store. If the session is currently active in
    /// memory, any running task is gracefully cancelled before removal.
    pub async fn delete_session(&self, session_id: &str) -> Result<()> {
        self.require_primary_operation_session(session_id)?;
        // Own the deletion in an independent task. Dropping an HTTP/request
        // future must not drop lifecycle leases while an already-launched
        // Podman removal or another destructive cleanup continues.
        let manager = self.clone();
        let session_id = session_id.to_string();
        tokio::spawn(async move { manager.delete_session_cascade(&session_id).await })
            .await
            .context("session deletion task failed")?
    }

    /// Parent-owned deletion path. Once a primary session has passed the
    /// public ownership check, its delegated descendants must be removed as
    /// part of the same lifecycle operation without pretending that they are
    /// independently user-controllable sessions.
    async fn delete_session_cascade(&self, session_id: &str) -> Result<()> {
        self.require_persisted_operation_session(session_id)?;
        // Submission, config changes, and deletion share this gate. The
        // operation lease extends the exclusion to independent processes and
        // remains held through descendant enumeration and deletion. Child
        // creation uses the same parent boundary, so no relationship can be
        // committed after the enumeration snapshot.
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let _relationship_lease =
            sessions::SessionRelationshipLease::try_acquire(&self.inner.store_path, session_id)?;
        let service = self
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        let mut suppression_rollback =
            CompletionSuppressionRollback::new(self.inner.store_path.clone());
        if let Some(service) = service.as_ref() {
            if service.active_compaction().is_some() {
                return Err(anyhow!("session is busy with an active manual compaction"));
            }
            if let Some(active_run) = service.active_run() {
                // Persist suppression before cancellation can settle the
                // generation. This does not rewrite its admitted mode.
                suppression_rollback.suppress_running(session_id)?;
                if let Err(error) = service
                    .connect_client()
                    .request_cancel(&active_run.run_id)
                    .await
                {
                    if service.active_run().is_some() {
                        return Err(anyhow!(error.to_string()));
                    }
                }
            }
            if service.has_active_operation() {
                return Err(anyhow!("session is busy with an active operation"));
            }
        }
        // Acquire the operation lease before converting resource ownership.
        // Every lifecycle mutation uses this order, so no peer can win the
        // shared/exclusive transition and mutate the session before rollback.
        // This lease is declared before the rollback guard and therefore drops
        // after shared ownership has been restored on every failed exit.
        let _operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)?;
        if let Some(service) = service.as_ref() {
            service.release_sandbox_resource_lease();
        }
        let mut sandbox_lease_rollback = SandboxResourceLeaseRollback::new(service.clone());
        let _resource_lease = sessions::SessionResourceMutationLease::try_acquire(
            &self.inner.store_path,
            session_id,
        )?;
        self.require_persisted_operation_session(session_id)?;
        suppression_rollback.suppress_running(session_id)?;

        let orchestrators =
            nac_core::store::list_managed_orchestrators(&self.inner.store_path, session_id)?;
        for orchestrator in orchestrators {
            Box::pin(self.delete_session_cascade(&orchestrator.orchestrator_session_id)).await?;
        }
        let children =
            nac_core::store::list_traditional_children(&self.inner.store_path, session_id)?;
        for child in children {
            Box::pin(self.delete_session_cascade(&child.child_session_id)).await?;
        }
        // Deletion must fail closed if the durable snapshot cannot be decoded.
        // Treating a parse/store failure as an unsandboxed session would let an
        // uncached delete commit while skipping its only container/worktree
        // cleanup metadata and erase all retry authority.
        let persisted_sandbox =
            sessions::load_session(&self.inner.store_path, session_id)?.sandbox_spec;
        let persisted_worktree = persisted_sandbox
            .as_ref()
            .and_then(|spec| spec.worktree.clone());
        // The revision rows cascade with the session, but the git objects they
        // pinned only become collectable once the ref is gone. A missing
        // sandbox checkout must not hide the repository recorded in durable
        // worktree metadata.
        let revision_target = persisted_worktree
            .as_ref()
            .map(|worktree| GitTarget::Local {
                root: worktree.repo_root.clone(),
            });
        let revision_target = match revision_target {
            Some(target) => Some(target),
            None => self.workspace_root(session_id).await.ok(),
        };
        if let Some(service) = service.as_ref() {
            service.destroy_terminals().await?;
        }

        // Preserve the durable session row until owned container cleanup is
        // confirmed. If Podman is unavailable or refuses removal, a later
        // deletion retry still has the exact stable container identity.
        if let Some(service) = service.as_ref() {
            service.destroy_sandbox().await?;
        } else if persisted_sandbox.is_some() {
            nac_core::destroy_persisted_container(session_id).await?;
        }

        // Session-owned auxiliary rows cascade; legacy child rows are removed by core.
        let deleted = view::delete_session(&self.inner.store_path, session_id)?;
        if !deleted {
            return Err(anyhow!("session '{}' was not found", session_id));
        }
        // Only unpin Git objects after every fallible cleanup has succeeded
        // and the durable rows that referenced them are gone. A forget failure
        // can leak a ref, but can no longer make a retained revision unreadable.
        if let Some(target) = revision_target {
            if let Err(error) = workspace::forget(&target, session_id) {
                eprintln!("nac: failed to drop workspace revisions: {error:#}");
            }
        }
        suppression_rollback.disarm();
        self.inner.active_sessions.write().await.remove(session_id);
        sandbox_lease_rollback.disarm();
        // Workspace removal is deliberately after the durable row commit for
        // both attached and uncached sessions. If SQLite deletion fails, the
        // registered checkout and all uncommitted/untracked work remain
        // available for a retry or resumed sandbox.
        if let Some(worktree) = persisted_worktree {
            runtime::cleanup_session_worktree(&worktree);
        }
        Ok(())
    }

    /// Transactionally updates persisted model settings for an inactive session.
    /// The prospective snapshot and credentials are fully validated before the
    /// database or in-memory service map is changed.
    pub async fn update_session_config(
        &self,
        session_id: &str,
        mut request: UpdateConfigRequest,
    ) -> Result<()> {
        let request_empty = request.is_empty();
        if request_empty {
            // An empty PATCH carries no caller intent. It must be a universal,
            // store-free no-op: no cache-dependent busy result, legacy config
            // repair, revision increment, credential lookup, or ownership read.
            return Ok(());
        }
        self.require_primary_operation_session(session_id)?;

        let backend_selected = matches!(&request.backend, RequestField::Value(_));
        let base_url_omitted = matches!(&request.base_url, RequestField::Omitted);
        let api_key_env_omitted = matches!(&request.api_key_env, RequestField::Omitted);

        // Submission and update both hold this per-session gate. A submission
        // that wins establishes active-run state synchronously before releasing
        // it; an update that wins commits and evicts before a submit can attach.
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;

        // Hold the write lock through validation and persistence so other
        // attachment paths cannot observe or insert a stale service.
        let mut active = self.inner.active_sessions.write().await;
        if let Some(service) = active.get(session_id) {
            if let Some(conflict) =
                config_replacement_conflict(service.has_active_operation(), service.has_sandbox())
            {
                return Err(anyhow!(conflict));
            }
        }

        // Independent server processes coordinate through the same
        // crash-safe lease. Keep it through validation, CAS persistence, and
        // local eviction, but never hold a SQLite transaction over model I/O.
        let _operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)?;
        let _resource_lease = sessions::SessionResourceMutationLease::try_acquire(
            &self.inner.store_path,
            session_id,
        )?;
        self.require_primary_operation_session(session_id)?;

        let current = sessions::load_session_config(&self.inner.store_path, session_id)?;
        let mut prospective = current.clone();
        // The light model needs the credential destination policy, which the
        // plain field patch does not, so it is settled here instead.
        let light_field = std::mem::take(&mut request.light_model);
        apply_raw_config_patch(&mut prospective, request)?;
        if matches!(&light_field, RequestField::Omitted)
            && current.diagnostics.iter().any(|diagnostic| {
                diagnostic.starts_with(sessions::MALFORMED_LIGHT_MODEL_DIAGNOSTIC)
            })
        {
            return Err(request_configuration_error(
                "stored light-model settings are malformed; include light_model in the update to repair them, or null to return to single-model mode",
            ));
        }
        let (backend, reasoning_effort, extra_headers) = parse_prospective_model_config(
            &mut prospective,
            backend_selected,
            base_url_omitted,
            api_key_env_omitted,
        )?;
        match light_field {
            RequestField::Omitted => {
                // A key-only patch still moves an inherited light selector
                // along to the normalized primary selector, including a clear
                // when the primary switches to managed auth.
                let inherited = light_model::InheritedCredential {
                    backend,
                    name: prospective.api_key_env.as_deref(),
                    previous: current.api_key_env.as_deref(),
                };
                if let Some(light) = prospective.light_model.as_mut() {
                    light_model::rotate_inherited_credential(light, inherited);
                }
            }
            RequestField::Null => prospective.light_model = None,
            RequestField::Value(light) => {
                // A same-backend light model with no explicit selector
                // inherits the session's primary one, following it when the
                // primary selector changes.
                let inherited = Some(light_model::InheritedCredential {
                    backend,
                    name: prospective.api_key_env.as_deref(),
                    previous: current.api_key_env.as_deref(),
                });
                prospective.light_model = Some(light_model::normalize(
                    light,
                    &NacConfig::load_credential_destination_policy(&self.inner.root_cwd)?,
                    inherited,
                )?);
            }
        }

        // An untouched destination carries no new risk, so only a patch that
        // moves the endpoint or switches the credential type is authorized.
        if !base_url_omitted || backend_selected {
            enforce_trusted_base_url(
                Some(backend),
                Some(prospective.base_url.as_str()),
                &NacConfig::load_credential_destination_policy(&self.inner.root_cwd)?,
            )?;
        }

        let _settings = EffectiveModelSettings::new(
            backend,
            prospective.model.clone(),
            prospective.base_url.clone(),
            reasoning_effort,
            prospective.api_key_env.clone(),
            extra_headers.clone(),
        )?;
        // Fail a broken light model here, not at the session's next launch.
        if let Some(light) = prospective.light_model.as_ref() {
            nac_core::light_model::validate(light, &extra_headers)
                .map_err(request_configuration_error_from)?;
        }
        validate_model_configuration(
            backend,
            &prospective.model,
            Some(&prospective.base_url),
            reasoning_effort,
            prospective.api_key_env.as_deref(),
            &extra_headers,
        )?;
        // Persist only revisioned session-configuration columns after all
        // caller-controlled model configuration and credential checks succeed.
        // The revision CAS rejects a concurrent PATCH, while run/history writes remain independent of these columns.
        // A store failure or conflict leaves the active map untouched.
        sessions::update_raw_session_config(&self.inner.store_path, &prospective)?;
        active.remove(session_id);
        Ok(())
    }

    async fn resume_session(
        &self,
        session_id: &str,
        operation_lease: Option<&sessions::SessionOperationLease>,
    ) -> Result<SessionService> {
        let summary = self
            .list_sessions(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let resource_lease = summary
            .sandboxed
            .then(|| {
                sessions::SessionResourceLease::try_acquire(&self.inner.store_path, session_id)
                    .map_err(anyhow::Error::new)
            })
            .transpose()?;
        let config_cwd = if summary.ssh_host.is_some() {
            &self.inner.root_cwd
        } else {
            &summary.cwd
        };
        let config = NacConfig::load_without_model_from_cwd(config_cwd)?;
        let mut run_config = if let Some(operation_lease) = operation_lease {
            runtime::build_resume_config_for_session_with_lease(
                self.inner.store_path.clone(),
                session_id,
                &config,
                self.inner.root_cwd.clone(),
                Some(self.inner.worker_executable.clone()),
                operation_lease,
            )
            .await?
        } else {
            runtime::build_resume_config_for_session(
                self.inner.store_path.clone(),
                session_id,
                &config,
                self.inner.root_cwd.clone(),
                Some(self.inner.worker_executable.clone()),
            )
            .await?
        };
        self.attach_managed_command_environment(&mut run_config);
        let service = SessionService::from_orchestrator_run_config(run_config).service;
        if let Some(resource_lease) = resource_lease {
            service.adopt_sandbox_resource_lease(resource_lease);
        }
        Ok(service)
    }

    async fn resume_session_attachment(
        &self,
        session_id: &str,
    ) -> Result<(
        SessionService,
        bool,
        Option<sessions::SessionOperationLease>,
    )> {
        let summary = self
            .list_sessions(false)
            .await?
            .into_iter()
            .find(|entry| entry.summary.session_id == session_id)
            .map(|entry| entry.summary)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        // For a sandbox row, shared resource authority must precede snapshot
        // loading and any observer-side Podman inspection/materialization. A
        // concurrent deletion either wins before this acquisition (so the
        // subsequent row load fails) or remains excluded through service
        // publication. Ordinary sessions create no resource lock sidecar.
        let resource_lease = summary
            .sandboxed
            .then(|| {
                sessions::SessionResourceLease::try_acquire(&self.inner.store_path, session_id)
                    .map_err(anyhow::Error::new)
            })
            .transpose()?;
        let config_cwd = if summary.ssh_host.is_some() {
            &self.inner.root_cwd
        } else {
            &summary.cwd
        };
        let config = NacConfig::load_without_model_from_cwd(config_cwd)?;
        let (mut run_config, cacheable, operation_lease) =
            runtime::build_resume_config_for_session_attachment(
                self.inner.store_path.clone(),
                session_id,
                &config,
                self.inner.root_cwd.clone(),
                Some(self.inner.worker_executable.clone()),
            )
            .await?;
        self.attach_managed_command_environment(&mut run_config);
        let service = SessionService::from_orchestrator_run_config(run_config).service;
        if let Some(resource_lease) = resource_lease {
            service.adopt_sandbox_resource_lease(resource_lease);
        }
        Ok((service, cacheable, operation_lease))
    }

    async fn create_managed_orchestrator_session(
        &self,
        parent_session_id: &str,
        description: &str,
    ) -> Result<String> {
        let gate = self.lifecycle_gate(parent_session_id);
        let _lifecycle = gate.lock().await;
        let _relationship_lease = sessions::SessionRelationshipLease::try_acquire(
            &self.inner.store_path,
            parent_session_id,
        )?;
        let parent = sessions::load_session(&self.inner.store_path, parent_session_id)?;
        if parent.behavior != sessions::SessionBehavior::DirectWithOrchestrator {
            return Err(anyhow!(
                "managed orchestrators require direct-with-orchestrator behavior"
            ));
        }
        if nac_core::store::load_managed_orchestrator(&self.inner.store_path, parent_session_id)?
            .is_some()
        {
            return Err(anyhow!(
                "managed orchestrator sessions cannot launch orchestrators"
            ));
        }
        let orchestrator_session_id = uuid::Uuid::new_v4().to_string();
        let mut orchestrator = sessions::new_snapshot(
            orchestrator_session_id.clone(),
            parent.cwd,
            parent.model,
            parent.base_url,
            parent.backend,
            parent.reasoning_effort,
            parent.sandbox_spec,
            parent.ssh,
            Vec::new(),
            parent.api_key_env,
            parent.extra_headers,
        );
        orchestrator.behavior = sessions::SessionBehavior::Orchestrator;
        orchestrator.project_id = parent.project_id;
        orchestrator.light_model = parent.light_model;
        orchestrator.orchestrator_compaction_threshold = parent.orchestrator_compaction_threshold;
        nac_core::store::create_managed_orchestrator_session(
            &self.inner.store_path,
            &orchestrator,
            parent_session_id,
            description,
        )?;
        Ok(orchestrator_session_id)
    }

    async fn monitor_managed_orchestrator(
        &self,
        orchestrator_session_id: &str,
        generation: u64,
    ) -> Result<ManagedOrchestratorRecord> {
        self.monitor_managed_orchestrator_with_lease(orchestrator_session_id, generation, None)
            .await
    }

    async fn monitor_managed_orchestrator_with_lease(
        &self,
        orchestrator_session_id: &str,
        generation: u64,
        mut initial_lease: Option<sessions::SessionOperationLease>,
    ) -> Result<ManagedOrchestratorRecord> {
        loop {
            let record = nac_core::store::load_managed_orchestrator(
                &self.inner.store_path,
                orchestrator_session_id,
            )?
            .ok_or_else(|| {
                anyhow!("managed orchestrator session '{orchestrator_session_id}' was not found")
            })?;
            if record.generation != generation {
                return Err(anyhow!(
                    "managed orchestrator generation {generation} was superseded by {}",
                    record.generation
                ));
            }
            if record.status.is_terminal() {
                return Ok(record);
            }
            let run_id = record
                .run_id
                .as_deref()
                .ok_or_else(|| anyhow!("running managed orchestrator has no run id"))?;
            let cached = self
                .inner
                .active_sessions
                .read()
                .await
                .get(orchestrator_session_id)
                .cloned();
            if cached.as_ref().is_some_and(|service| {
                service
                    .active_run()
                    .is_some_and(|active| active.run_id.to_string() == run_id)
            }) {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }

            // A busy operation lease is positive evidence that another
            // process still owns the generation. Never synthesize an
            // interruption merely because this process has no active task.
            let operation_lease = match initial_lease.take() {
                Some(lease) => lease,
                None => match sessions::SessionOperationLease::try_acquire(
                    &self.inner.store_path,
                    orchestrator_session_id,
                ) {
                    Ok(lease) => lease,
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        #[cfg(test)]
                        self.inner.managed_monitor_peer_observed.notify_one();
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                    Err(error) => return Err(anyhow::Error::new(error)),
                },
            };
            let gate = self.lifecycle_gate(orchestrator_session_id);
            let _lifecycle = gate.lock().await;
            let service = self
                .attach_current_operation_service_locked(orchestrator_session_id, &operation_lease)
                .await?;

            let (_, events) = service.recent_events(None, DEFAULT_REPLAY_LIMIT);
            let terminal = nac_core::store::load_run_recovery(
                &self.inner.store_path,
                orchestrator_session_id,
            )?
            .filter(|recovery| recovery.run_id == run_id)
            .and_then(|recovery| {
                if let Some(disposition) = recovery.terminal_disposition {
                    return Some(match disposition {
                        nac_core::store::RunTerminalDisposition::Completed => {
                            nac_core::store::ManagedOrchestratorTerminal {
                                status: ManagedOrchestratorStatus::Completed,
                                report: None,
                                failure: None,
                            }
                        }
                        nac_core::store::RunTerminalDisposition::Cancelled => {
                            nac_core::store::ManagedOrchestratorTerminal {
                                status: ManagedOrchestratorStatus::Cancelled,
                                report: None,
                                failure: None,
                            }
                        }
                    });
                }
                match recovery.status {
                    nac_core::store::RunRecoveryStatus::Interrupted => {
                        Some(nac_core::store::ManagedOrchestratorTerminal {
                            status: ManagedOrchestratorStatus::Interrupted,
                            report: None,
                            failure: Some("run interrupted by process restart".to_string()),
                        })
                    }
                    nac_core::store::RunRecoveryStatus::Failed => {
                        Some(nac_core::store::ManagedOrchestratorTerminal {
                            status: ManagedOrchestratorStatus::Failed,
                            report: None,
                            failure: Some("managed orchestrator run failed".to_string()),
                        })
                    }
                    nac_core::store::RunRecoveryStatus::Active => None,
                }
            })
            .or_else(|| {
                events.iter().rev().find_map(|envelope| {
                    (envelope.run_id.as_ref().map(ToString::to_string).as_deref() == Some(run_id))
                        .then_some(&envelope.event)
                        .and_then(|event| match event {
                            SessionEvent::RunCompleted { response, .. } => {
                                Some(nac_core::store::ManagedOrchestratorTerminal {
                                    status: ManagedOrchestratorStatus::Completed,
                                    report: Some(response.clone()),
                                    failure: None,
                                })
                            }
                            SessionEvent::RunFailed { message } => {
                                Some(nac_core::store::ManagedOrchestratorTerminal {
                                    status: if message.contains("interrupted") {
                                        ManagedOrchestratorStatus::Interrupted
                                    } else {
                                        ManagedOrchestratorStatus::Failed
                                    },
                                    report: None,
                                    failure: Some(message.clone()),
                                })
                            }
                            SessionEvent::RunCancelled => {
                                Some(nac_core::store::ManagedOrchestratorTerminal {
                                    status: ManagedOrchestratorStatus::Cancelled,
                                    report: None,
                                    failure: None,
                                })
                            }
                            _ => None,
                        })
                })
            });
            let terminal = match terminal {
                Some(mut terminal) => {
                    if terminal.status == ManagedOrchestratorStatus::Completed
                        && terminal.report.is_none()
                    {
                        terminal.report = events.iter().rev().find_map(|envelope| {
                            (envelope.run_id.as_ref().map(ToString::to_string).as_deref()
                                == Some(run_id))
                            .then_some(&envelope.event)
                            .and_then(|event| match event {
                                SessionEvent::RunCompleted { response, .. } => {
                                    Some(response.clone())
                                }
                                _ => None,
                            })
                        });
                        if terminal.report.is_none() {
                            terminal.report = service
                                .messages_page(MessagePageRequest {
                                    before: None,
                                    limit: 24,
                                    include_system: false,
                                })
                                .await
                                .ok()
                                .and_then(|page| {
                                    page.messages.into_iter().rev().find_map(
                                        |message| match message {
                                            Message::Assistant { content, .. } => content,
                                            _ => None,
                                        },
                                    )
                                });
                        }
                    }
                    terminal
                }
                None => {
                    let report = service
                        .messages_page(MessagePageRequest {
                            before: None,
                            limit: 24,
                            include_system: false,
                        })
                        .await
                        .ok()
                        .and_then(|page| {
                            page.messages
                                .into_iter()
                                .rev()
                                .find_map(|message| match message {
                                    Message::Assistant { content, .. } => content,
                                    _ => None,
                                })
                        });
                    nac_core::store::ManagedOrchestratorTerminal {
                        status: ManagedOrchestratorStatus::Interrupted,
                        report,
                        failure: Some(
                            "managed orchestrator stopped without a retained terminal event"
                                .to_string(),
                        ),
                    }
                }
            };
            let settlement = nac_core::store::settle_managed_orchestrator_run(
                &self.inner.store_path,
                orchestrator_session_id,
                run_id,
                terminal,
            )?;
            nac_core::store::clear_settled_run_recovery(
                &self.inner.store_path,
                orchestrator_session_id,
                run_id,
            )?;
            if settlement.newly_settled && settlement.orchestrator.completion_inbox_id.is_some() {
                let parent_session_id = settlement.orchestrator.parent_session_id.clone();
                let cached = {
                    let active = self.inner.active_sessions.read().await;
                    active.get(&parent_session_id).cloned()
                };
                let parent = match cached {
                    Some(service) => service,
                    None => self.attach_session(&parent_session_id).await?,
                };
                parent.start_next_direct_inbox_item().await?;
            }
            return Ok(settlement.orchestrator);
        }
    }

    fn spawn_managed_orchestrator_monitor(&self, orchestrator_session_id: String, generation: u64) {
        let manager = self.clone();
        tokio::spawn(async move {
            if let Err(error) = manager
                .monitor_managed_orchestrator(&orchestrator_session_id, generation)
                .await
            {
                eprintln!(
                    "nac: managed orchestrator monitor failed for {orchestrator_session_id}: {error:#}"
                );
            }
        });
    }

    async fn create_traditional_child_session(
        &self,
        parent_session_id: &str,
        profile: &str,
        description: &str,
    ) -> Result<String> {
        nac_core::traditional_children::validate_general_profile(profile)?;
        let gate = self.lifecycle_gate(parent_session_id);
        let _lifecycle = gate.lock().await;
        let _relationship_lease = sessions::SessionRelationshipLease::try_acquire(
            &self.inner.store_path,
            parent_session_id,
        )?;
        let parent = sessions::load_session(&self.inner.store_path, parent_session_id)?;
        if parent.behavior == sessions::SessionBehavior::Orchestrator {
            return Err(anyhow!(
                "traditional children are available only to direct parent sessions"
            ));
        }
        if parent.sandbox_spec.is_some() {
            let parent_service = self.attach_session_locked(parent_session_id, None).await?;
            if parent_service.metadata().workspace_host_path.is_none() {
                return Err(anyhow!(
                    "traditional children require a host-backed shared workspace for sandboxed sessions"
                ));
            }
        }
        if nac_core::store::load_traditional_child(&self.inner.store_path, parent_session_id)?
            .is_some()
        {
            return Err(anyhow!(
                "traditional child nesting limit reached (1): child sessions cannot launch children"
            ));
        }
        let parent_prompt_cwd = nac_core::traditional_children::parent_prompt_working_directory(
            &parent.cwd,
            parent.sandbox_spec.as_ref(),
        );
        let messages = nac_core::traditional_children::fresh_general_child_messages(
            &parent.messages,
            &parent_prompt_cwd,
            description,
        )?;
        let child_session_id = uuid::Uuid::new_v4().to_string();
        let mut child = sessions::new_snapshot(
            child_session_id.clone(),
            parent.cwd,
            parent.model,
            parent.base_url,
            parent.backend,
            parent.reasoning_effort,
            parent.sandbox_spec,
            parent.ssh,
            messages,
            parent.api_key_env,
            parent.extra_headers,
        );
        child.behavior = sessions::SessionBehavior::Direct;
        child.project_id = parent.project_id;
        child.orchestrator_compaction_threshold = parent.orchestrator_compaction_threshold;
        nac_core::store::create_traditional_child_session(
            &self.inner.store_path,
            &child,
            parent_session_id,
            profile,
            description,
        )?;
        Ok(child_session_id)
    }
}

impl nac_core::traditional_children::TraditionalChildController
    for ServerTraditionalChildController
{
    fn start<'a>(
        &'a self,
        request: nac_core::traditional_children::TraditionalChildStartRequest,
    ) -> nac_core::traditional_children::ChildFuture<'a, nac_core::store::TraditionalChildRecord>
    {
        Box::pin(async move {
            let manager = self.manager()?;
            nac_core::traditional_children::validate_general_profile(&request.profile)?;
            if request.prompt.trim().is_empty() {
                return Err(anyhow!("traditional child prompt is empty"));
            }
            manager.repair_orphaned_completion_suppressions(&request.parent_session_id)?;
            let child_session_id = match request.child_session_id {
                Some(child_session_id) => child_session_id,
                None => {
                    manager
                        .create_traditional_child_session(
                            &request.parent_session_id,
                            &request.profile,
                            &request.description,
                        )
                        .await?
                }
            };
            let relation = nac_core::store::load_traditional_child_for_parent(
                &manager.inner.store_path,
                &request.parent_session_id,
                &child_session_id,
            )?
            .ok_or_else(|| anyhow!("traditional child was not found"))?;
            if relation.profile != request.profile {
                return Err(anyhow!(
                    "traditional child profile is immutable (expected '{}')",
                    relation.profile
                ));
            }
            if relation.description != request.description.trim() {
                return Err(anyhow!(
                    "traditional child description is immutable (expected '{}')",
                    relation.description
                ));
            }
            let service = manager.attach_session(&child_session_id).await?;
            let relation = service
                .reconcile_traditional_child_terminal()
                .await?
                .unwrap_or(relation);
            if relation.status == nac_core::store::TraditionalChildStatus::Running {
                if service.active_run().is_some() {
                    service
                        .enqueue_traditional_child_input(
                            nac_core::store::InboxDelivery::Steer,
                            &request.prompt,
                        )
                        .await?;
                } else {
                    nac_core::store::create_session_inbox_item(
                        &manager.inner.store_path,
                        &child_session_id,
                        nac_core::store::InboxDelivery::Steer,
                        &request.prompt,
                        relation.run_id.as_deref(),
                        None,
                    )?;
                }
                return Ok(relation);
            }
            service
                .try_submit_traditional_child_prompt(request.prompt, request.execution_mode)
                .map_err(anyhow::Error::new)?;
            nac_core::store::load_traditional_child(&manager.inner.store_path, &child_session_id)?
                .ok_or_else(|| anyhow!("traditional child disappeared after run admission"))
        })
    }

    fn wait<'a>(
        &'a self,
        child_session_id: &'a str,
        generation: u64,
    ) -> nac_core::traditional_children::ChildFuture<'a, nac_core::store::TraditionalChildRecord>
    {
        Box::pin(async move {
            let manager = self.manager()?;
            loop {
                let child = nac_core::store::load_traditional_child(
                    &manager.inner.store_path,
                    child_session_id,
                )?
                .ok_or_else(|| {
                    anyhow!("traditional child session '{child_session_id}' was not found")
                })?;
                if child.generation != generation {
                    return Err(anyhow!(
                        "traditional child generation {generation} was superseded by {}",
                        child.generation
                    ));
                }
                if child.status.is_terminal() {
                    return Ok(child);
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
    }

    fn cancel<'a>(
        &'a self,
        parent_session_id: &'a str,
        child_session_id: &'a str,
    ) -> nac_core::traditional_children::ChildFuture<'a, nac_core::store::TraditionalChildRecord>
    {
        Box::pin(async move {
            let manager = self.manager()?;
            let child = nac_core::store::load_traditional_child(
                &manager.inner.store_path,
                child_session_id,
            )?
            .ok_or_else(|| {
                anyhow!("traditional child session '{child_session_id}' was not found")
            })?;
            if child.parent_session_id != parent_session_id {
                return Err(anyhow!(
                    "session '{child_session_id}' is not a child of parent '{parent_session_id}'"
                ));
            }
            let service = manager.attach_session(child_session_id).await?;
            let child = service
                .reconcile_traditional_child_terminal()
                .await?
                .unwrap_or(child);
            if child.status != nac_core::store::TraditionalChildStatus::Running {
                return Ok(child);
            }
            let active = service.active_run().ok_or_else(|| {
                anyhow!("traditional child '{child_session_id}' is running in another process")
            })?;
            service
                .request_cancel(&active.run_id)
                .await
                .map_err(anyhow::Error::new)?;
            nac_core::store::load_traditional_child(&manager.inner.store_path, child_session_id)?
                .ok_or_else(|| anyhow!("traditional child disappeared after cancellation"))
        })
    }

    fn wake<'a>(
        &'a self,
        session_id: &'a str,
    ) -> nac_core::traditional_children::ChildFuture<'a, ()> {
        Box::pin(async move {
            let manager = self.manager()?;
            let cached = {
                let active = manager.inner.active_sessions.read().await;
                active.get(session_id).cloned()
            };
            let service = if let Some(service) = cached {
                service
            } else {
                manager.attach_session(session_id).await?
            };
            if service.metadata().behavior != sessions::SessionBehavior::Orchestrator {
                service.start_next_direct_inbox_item().await?;
            }
            Ok(())
        })
    }
}

impl nac_core::orchestration_control::OrchestrationController for ServerOrchestrationController {
    fn start<'a>(
        &'a self,
        request: nac_core::orchestration_control::ManagedOrchestratorStartRequest,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            if request.prompt.trim().is_empty() {
                return Err(anyhow!("managed orchestrator prompt is empty"));
            }
            manager.repair_orphaned_completion_suppressions(&request.parent_session_id)?;
            let orchestrator_session_id = match request.orchestrator_session_id {
                Some(session_id) => session_id,
                None => {
                    manager
                        .create_managed_orchestrator_session(
                            &request.parent_session_id,
                            &request.description,
                        )
                        .await?
                }
            };
            let mut relation = manager
                .managed_orchestrator(&request.parent_session_id, &orchestrator_session_id)?;
            if relation.description != request.description.trim() {
                return Err(anyhow!(
                    "managed orchestrator description is immutable (expected '{}')",
                    relation.description
                ));
            }
            if relation.status == ManagedOrchestratorStatus::Running {
                let service = manager.attach_session(&orchestrator_session_id).await?;
                if service.active_run().is_some() {
                    manager.queue_managed_orchestrator_steering(
                        &request.parent_session_id,
                        &orchestrator_session_id,
                        &request.prompt,
                    )?;
                    return Ok(relation);
                }
                match sessions::SessionOperationLease::try_acquire(
                    &manager.inner.store_path,
                    &orchestrator_session_id,
                ) {
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        manager.queue_managed_orchestrator_steering(
                            &request.parent_session_id,
                            &orchestrator_session_id,
                            &request.prompt,
                        )?;
                        return Ok(relation);
                    }
                    Err(error) => return Err(anyhow::Error::new(error)),
                    Ok(lease) => {
                        relation = manager
                            .monitor_managed_orchestrator_with_lease(
                                &orchestrator_session_id,
                                relation.generation,
                                Some(lease),
                            )
                            .await?;
                    }
                }
            }
            if relation.status == ManagedOrchestratorStatus::Running {
                return Err(anyhow!("managed orchestrator is still running"));
            }
            let submitted = manager
                .submit_managed_orchestrator_prompt(
                    &orchestrator_session_id,
                    SubmitPromptRequest {
                        prompt: request.prompt,
                    },
                    request.execution_mode,
                )
                .await?;
            let relation = nac_core::store::load_managed_orchestrator(
                &manager.inner.store_path,
                &orchestrator_session_id,
            )?
            .ok_or_else(|| anyhow!("managed orchestrator disappeared after run admission"))?;
            debug_assert_eq!(relation.run_id.as_deref(), Some(submitted.run_id.as_str()));
            manager
                .spawn_managed_orchestrator_monitor(orchestrator_session_id, relation.generation);
            Ok(relation)
        })
    }

    fn wait<'a>(
        &'a self,
        orchestrator_session_id: &'a str,
        generation: u64,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            self.manager()?
                .monitor_managed_orchestrator(orchestrator_session_id, generation)
                .await
        })
    }

    fn steer<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        instruction: &'a str,
        thread_name: Option<&'a str>,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            let relation =
                manager.managed_orchestrator(parent_session_id, orchestrator_session_id)?;
            if relation.status != ManagedOrchestratorStatus::Running {
                return Err(anyhow!("managed orchestrator is not running"));
            }
            if let Some(thread_name) = thread_name {
                let expected_run_id = relation.run_id.as_deref().ok_or_else(|| {
                    anyhow!("running managed orchestrator is missing its run identity")
                })?;
                manager
                    .queue_thread_steering_unchecked(
                        orchestrator_session_id,
                        thread_name,
                        ThreadSteeringRequest {
                            instruction: instruction.to_string(),
                        },
                        Some(expected_run_id),
                    )
                    .await?;
            } else {
                manager.queue_managed_orchestrator_steering(
                    parent_session_id,
                    orchestrator_session_id,
                    instruction,
                )?;
            }
            manager.managed_orchestrator(parent_session_id, orchestrator_session_id)
        })
    }

    fn read<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
        kind: nac_core::orchestration_control::ManagedOrchestratorReadKind,
        limit: usize,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, serde_json::Value> {
        Box::pin(async move {
            let manager = self.manager()?;
            let operations = orchestration::OrchestrationOperations::new(manager.clone());
            manager.managed_orchestrator(parent_session_id, orchestrator_session_id)?;
            match kind {
                nac_core::orchestration_control::ManagedOrchestratorReadKind::Messages => {
                    let page = operations
                        .messages_page(
                            orchestrator_session_id,
                            MessagePageRequest {
                                before: None,
                                limit,
                                include_system: false,
                            },
                        )
                        .await?;
                    Ok(serde_json::to_value(page)?)
                }
                nac_core::orchestration_control::ManagedOrchestratorReadKind::Episodes => {
                    operations
                        .thread_episodes(orchestrator_session_id, None)
                        .await
                }
                nac_core::orchestration_control::ManagedOrchestratorReadKind::Events => {
                    operations
                        .thread_events(orchestrator_session_id, None, None, limit)
                        .await
                }
            }
        })
    }

    fn cancel<'a>(
        &'a self,
        parent_session_id: &'a str,
        orchestrator_session_id: &'a str,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ManagedOrchestratorRecord> {
        Box::pin(async move {
            let manager = self.manager()?;
            let relation =
                manager.managed_orchestrator(parent_session_id, orchestrator_session_id)?;
            if relation.status != ManagedOrchestratorStatus::Running {
                return Ok(relation);
            }
            manager
                .cancel_active_run_unchecked(orchestrator_session_id)
                .await?;
            manager
                .monitor_managed_orchestrator(orchestrator_session_id, relation.generation)
                .await
        })
    }

    fn wake<'a>(
        &'a self,
        session_id: &'a str,
    ) -> nac_core::orchestration_control::OrchestrationFuture<'a, ()> {
        Box::pin(async move {
            let manager = self.manager()?;
            let cached = {
                let active = manager.inner.active_sessions.read().await;
                active.get(session_id).cloned()
            };
            let service = match cached {
                Some(service) => service,
                None => manager.attach_session(session_id).await?,
            };
            service.start_next_direct_inbox_item().await?;
            Ok(())
        })
    }
}

fn response_compression_layer() -> CompressionLayer<impl Predicate> {
    CompressionLayer::new()
        .gzip(true)
        .compress_when(DefaultPredicate::new().and(NotForContentType::SSE))
}

/// Whether a server listener may be reachable beyond this machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BindPolicy {
    /// Preserve the default trust boundary: only this machine can connect.
    LoopbackOnly,
    /// The operator has arranged an authenticated, encrypted network boundary
    /// and accepts every reachable client as equivalent to the local user.
    AllowRemote,
}

impl BindPolicy {
    /// Validate an address before starting any server setup work.
    pub fn validate(self, addr: SocketAddr) -> Result<()> {
        if !addr.ip().is_loopback() && self != Self::AllowRemote {
            anyhow::bail!(
                "refusing non-loopback bind address {addr}; every reachable client would receive \
                 full control of nac-web. Configure an authenticated, encrypted network boundary \
                 and explicitly allow remote access (CLI: --allow-remote)"
            );
        }
        Ok(())
    }
}

/// Extra names this server answers to, as a comma-separated list.
///
/// A tunnel, reverse proxy, or direct client may use a DNS name in `Host`, which
/// the rebinding guard below would otherwise refuse. Naming it here is the
/// operator's statement that the name is expected to reach this server. `*`
/// disables the guard entirely.
const ALLOWED_HOSTS_ENV: &str = "NAC_ALLOWED_HOSTS";

fn configured_allowed_hosts() -> Vec<String> {
    std::env::var(ALLOWED_HOSTS_ENV)
        .unwrap_or_default()
        .split(',')
        .map(|entry| entry.trim().to_ascii_lowercase())
        .filter(|entry| !entry.is_empty())
        .collect()
}

/// The host name inside a `Host` header, without its port.
fn bare_host(host: &str) -> Option<&str> {
    let host = host.trim();
    match host.strip_prefix('[') {
        // IPv6 literals are bracketed, so the port separator is the colon that
        // follows the closing bracket rather than the last colon in the string.
        Some(rest) => rest.split_once(']').map(|(address, _port)| address),
        None => host.split(':').next().filter(|bare| !bare.is_empty()),
    }
}

/// Whether a `Host` header cannot itself be changed through DNS rebinding.
///
/// An attacker can point their own domain at an address on the machine running
/// nac-web and drive the API from a victim's browser. A browser always sends the
/// name it dialled and cannot forge an IP-literal `Host`, so localhost and IP
/// literals do not need the DNS-name allowlist. This is not client
/// authentication and does not make a reachable address trusted.
fn is_non_rebindable_host(host: &str) -> bool {
    let Some(bare) = bare_host(host) else {
        return false;
    };
    bare.eq_ignore_ascii_case("localhost") || bare.parse::<std::net::IpAddr>().is_ok()
}

fn host_is_allowed(host: &str, allowed: &[String]) -> bool {
    if is_non_rebindable_host(host) {
        return true;
    }
    let host = host.trim().to_ascii_lowercase();
    let bare = bare_host(&host).unwrap_or_default().to_string();
    allowed
        .iter()
        .any(|entry| entry == "*" || *entry == host || *entry == bare)
}

async fn reject_foreign_host(
    State(allowed): State<Arc<Vec<String>>>,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(header::HOST)
        .map(|value| value.to_str().unwrap_or_default())
        // HTTP/2 carries the authority in the pseudo-header instead.
        .or_else(|| request.uri().host());
    match host {
        // An absent header is accepted because HTTP/1.1 clients that omit it
        // are never browsers.
        Some(host) if !host_is_allowed(host, &allowed) => (
            StatusCode::FORBIDDEN,
            format!(
                "refusing request for host '{host}'; add it to {ALLOWED_HOSTS_ENV} if this name \
                 is expected to reach nac-web"
            ),
        )
            .into_response(),
        _ => next.run(request).await,
    }
}

fn is_safe_method(method: &axum::http::Method) -> bool {
    method == axum::http::Method::GET
        || method == axum::http::Method::HEAD
        || method == axum::http::Method::OPTIONS
}

fn origin_matches_host(origin: &str, host: &str) -> bool {
    origin
        .parse::<axum::http::Uri>()
        .ok()
        .and_then(|uri| {
            uri.authority()
                .map(|authority| authority.as_str().to_string())
        })
        .is_some_and(|authority| authority.eq_ignore_ascii_case(host.trim()))
}

/// Reject browser-forged mutations independently of the DNS-rebinding guard.
///
/// Fetch Metadata is browser-controlled. Origin is the fallback for browsers
/// that omit it; requests carrying neither remain available to non-browser API
/// clients. Host validation still runs separately for every request.
async fn reject_cross_origin_mutation(request: axum::extract::Request, next: Next) -> Response {
    if is_safe_method(request.method()) {
        return next.run(request).await;
    }

    let headers = request.headers();
    let fetch_site = headers
        .get(header::HeaderName::from_static("sec-fetch-site"))
        .and_then(|value| value.to_str().ok());
    if matches!(fetch_site, Some("cross-site" | "same-site")) {
        return (
            StatusCode::FORBIDDEN,
            "refusing a cross-origin state-changing browser request",
        )
            .into_response();
    }

    if !matches!(fetch_site, Some("same-origin" | "none")) {
        if let Some(origin) = headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            let host = headers
                .get(header::HOST)
                .and_then(|value| value.to_str().ok())
                .or_else(|| {
                    request
                        .uri()
                        .authority()
                        .map(|authority| authority.as_str())
                });
            if !host.is_some_and(|host| origin_matches_host(origin, host)) {
                return (
                    StatusCode::FORBIDDEN,
                    "refusing a cross-origin state-changing browser request",
                )
                    .into_response();
            }
        }
    }

    next.run(request).await
}
async fn secure_docs(request: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response.headers_mut().insert(
        header::HeaderName::from_static("content-security-policy"),
        header::HeaderValue::from_static("frame-ancestors 'none'"),
    );
    response.headers_mut().insert(
        header::HeaderName::from_static("x-frame-options"),
        header::HeaderValue::from_static("DENY"),
    );
    response
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "nac-web HTTP API",
        version = env!("CARGO_PKG_VERSION"),
        description = "Live OpenAPI 3.1 contract for nac-web's REST and SSE surface. nac-web binds to loopback by default. Non-loopback binds require --allow-remote and an authenticated, encrypted network boundary; every reachable client receives control equivalent to the local user because the API has no client authentication. IP-literal Host values bypass only the DNS-name allowlist, not authentication. DNS names must be listed in NAC_ALLOWED_HOSTS. Cross-origin browser mutations are rejected independently. Finite JSON responses may be gzip-compressed. The SSE stream is text/event-stream and is never gzip-compressed. Credential values are write-only. /mcp is streamable-HTTP MCP (JSON-RPC), not REST, and is intentionally out of band."
    ),
    components(schemas(
        filesystem::BrowseKind,
        // Only ever referenced from a query parameter, which utoipa does not
        // walk for schemas the way it walks bodies and responses.
        DeleteProjectSessions,
        ReplayBoundaryEvent,
        ReplayGapEvent,
        SessionEventEnvelope,
        AssistantStreamDelta,
        LaggedEvent
    ))
)]
struct ApiDoc;

pub fn router(manager: SessionManager) -> Router {
    // The registry answer takes a few seconds, so it is warmed in the
    // background rather than on the first picker open.
    tokio::spawn(mcp_api::warm_library_cache());
    let (api, openapi) = api_router(manager);
    let docs = Router::new()
        .merge(
            SwaggerUi::new("/docs")
                .url("/openapi.json", openapi)
                .config(SwaggerConfig::default().validator_url("none")),
        )
        .layer(middleware::from_fn(secure_docs));
    api.merge(docs)
        .merge(embedded_frontend_router())
        .layer(response_compression_layer())
        .layer(middleware::from_fn(reject_cross_origin_mutation))
        .layer(middleware::from_fn_with_state(
            Arc::new(configured_allowed_hosts()),
            reject_foreign_host,
        ))
}

fn embedded_frontend_router() -> Router {
    Router::new()
        .route("/", get(index_html))
        .route("/app", get(index_html))
        .route("/assets/{*path}", get(serve_asset))
}

fn api_router(manager: SessionManager) -> (Router, utoipa::openapi::OpenApi) {
    let documented = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .routes(routes!(health))
        .routes(routes!(managed_status::healthz_handler))
        .routes(routes!(managed_status::readyz_handler))
        .routes(routes!(managed_status::managed_status_handler))
        .routes(routes!(store_info))
        .routes(routes!(sandbox_availability_handler))
        .routes(routes!(sandbox_activity_handler))
        .routes(routes!(browse_filesystem_handler))
        .routes(routes!(browse_ssh_handler))
        .routes(routes!(provider_models_handler))
        .routes(routes!(
            list_model_configs_handler,
            create_model_config_handler
        ))
        .routes(routes!(list_projects_handler, create_project_handler))
        .routes(routes!(reorder_projects_handler))
        .routes(routes!(update_project_handler, delete_project_handler))
        .routes(routes!(assign_session_handler))
        .routes(routes!(model_config_from_file_handler))
        .routes(routes!(
            update_model_config_handler,
            delete_model_config_handler
        ))
        .routes(routes!(saved_model_config_models_handler))
        .routes(routes!(list_ssh_configs_handler, create_ssh_config_handler))
        .routes(routes!(
            update_ssh_config_handler,
            delete_ssh_config_handler
        ))
        .routes(routes!(mcp_api::library_handler))
        .routes(routes!(
            mcp_api::list_servers_handler,
            mcp_api::create_server_handler
        ))
        .routes(routes!(mcp_api::test_server_handler))
        .routes(routes!(
            mcp_api::update_server_handler,
            mcp_api::delete_server_handler
        ))
        .routes(routes!(managed_auth::list_handler))
        .routes(routes!(managed_auth::logout_handler))
        .routes(routes!(managed_auth::start_login_handler))
        .routes(routes!(
            managed_auth::poll_login_handler,
            managed_auth::cancel_login_handler
        ))
        .routes(routes!(
            managed_github::status_handler,
            managed_github::disconnect_handler
        ))
        .routes(routes!(managed_github::start_login_handler))
        .routes(routes!(
            managed_github::poll_login_handler,
            managed_github::cancel_login_handler
        ))
        .routes(routes!(managed_github::repositories_handler))
        .routes(routes!(managed_github::branches_handler))
        .routes(routes!(managed_github::start_clone_handler))
        .routes(routes!(
            managed_github::clone_operation_handler,
            managed_github::cancel_clone_handler
        ))
        .routes(routes!(
            managed_github::git_identity_handler,
            managed_github::update_git_identity_handler
        ))
        .routes(routes!(list_managed_secrets_handler))
        .routes(routes!(
            put_managed_secret_handler,
            delete_managed_secret_handler
        ))
        .routes(routes!(
            list_credentials_handler,
            store_generated_credential_handler
        ))
        .routes(routes!(store_credential_handler, delete_credential_handler))
        .routes(routes!(launch_model_defaults_handler))
        .routes(routes!(models_handler))
        .routes(routes!(commands_handler))
        .routes(routes!(list_sessions, create_session))
        .routes(routes!(reorder_sessions_handler))
        .routes(routes!(update_session_presentation_handler))
        .routes(routes!(session_messages))
        .routes(routes!(list_direct_inbox, create_direct_inbox_item))
        .routes(routes!(update_direct_inbox_item, cancel_direct_inbox_item))
        .routes(routes!(get_direct_goal, create_direct_goal))
        .routes(routes!(update_direct_goal, clear_direct_goal))
        .routes(routes!(list_traditional_children, start_traditional_child))
        .routes(routes!(get_traditional_child))
        .routes(routes!(cancel_traditional_child))
        .routes(routes!(
            list_managed_orchestrators,
            start_managed_orchestrator
        ))
        .routes(routes!(get_managed_orchestrator))
        .routes(routes!(cancel_managed_orchestrator))
        .routes(routes!(permission_state))
        .routes(routes!(reply_permission_request))
        .routes(routes!(delete_permission_grant))
        .routes(routes!(thread_events))
        .routes(routes!(workspace_diff))
        .routes(routes!(workspace_files))
        .routes(routes!(workspace_file))
        .routes(routes!(open_workspace_path))
        .routes(routes!(workspace_branches, switch_workspace_branch))
        .routes(routes!(commit_workspace))
        .routes(routes!(workspace_revisions))
        .routes(routes!(workspace_revision_changes))
        .routes(routes!(session_snapshot, delete_session_handler))
        .routes(routes!(session_config_handler, update_config_handler))
        .routes(routes!(session_skills_handler))
        .routes(routes!(submit_prompt))
        .routes(routes!(compaction::handler))
        .routes(routes!(revert::handler))
        .routes(routes!(revert::regenerate_handler))
        .routes(routes!(queue_orchestrator_steering_handler))
        .routes(routes!(queue_thread_steering_handler))
        .routes(routes!(recent_events))
        .routes(routes!(stream_events))
        .routes(routes!(cancel_active_run))
        .with_state(manager.clone());
    let (router, openapi) = documented.split_for_parts();
    (
        router.nest_service("/mcp", mcp::streamable_http_service(manager)),
        openapi,
    )
}

pub async fn serve(addr: SocketAddr, manager: SessionManager) -> Result<()> {
    serve_with(addr, manager, |_| {}).await
}

/// Bind, invoke `on_listening` with the actual local address, then serve.
///
/// Callers that open a browser must do so from `on_listening` so the socket is
/// already accepting connections (printing "listening" before `bind` races the
/// first page load against a still-closed port).
pub async fn serve_with(
    addr: SocketAddr,
    manager: SessionManager,
    on_listening: impl FnOnce(SocketAddr),
) -> Result<()> {
    serve_with_policy(addr, BindPolicy::LoopbackOnly, manager, on_listening).await
}

/// Serve under an explicit network exposure policy.
pub async fn serve_with_policy(
    addr: SocketAddr,
    policy: BindPolicy,
    manager: SessionManager,
    on_listening: impl FnOnce(SocketAddr),
) -> Result<()> {
    policy.validate(addr)?;
    // Establish the durable store before serving requests. Readiness probes
    // then verify this store in place and never create a blank replacement
    // if it disappears while the process is running.
    nac_core::store::initialize(&manager.inner.store_path)?;
    nac_core::reconcile_podman_creation_records(&manager.inner.store_path).await?;
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("failed to bind {}", addr))?;
    let bound = listener
        .local_addr()
        .with_context(|| format!("failed to read bound address for {}", addr))?;
    on_listening(bound);
    serve_listener_with_shutdown(
        listener,
        manager,
        shutdown_signal(),
        COMPLETE_SHUTDOWN_TIMEOUT,
        || std::process::exit(0),
    )
    .await
}

async fn serve_listener_with_shutdown<F, X>(
    listener: TcpListener,
    manager: SessionManager,
    shutdown: F,
    complete_shutdown_timeout: Duration,
    force_shutdown: X,
) -> Result<()>
where
    F: Future<Output = ()> + Send + 'static,
    X: FnOnce() + Send + 'static,
{
    let mut force_shutdown = Some(force_shutdown);
    let shutdown_manager = manager.clone();
    let (graceful_tx, graceful_rx) = tokio::sync::oneshot::channel();
    let mut server = tokio::spawn(
        axum::serve(listener, router(manager))
            .with_graceful_shutdown(async move {
                let _ = graceful_rx.await;
            })
            .into_future(),
    );
    tokio::pin!(shutdown);

    let result = tokio::select! {
        result = &mut server => result
            .context("server task stopped unexpectedly")?
            .context("server stopped unexpectedly"),
        () = &mut shutdown => {
            // Stop accepting new work before cancellation. The single outer
            // deadline covers both run cleanup and graceful HTTP/SSE drain.
            // Its watchdog is independent of the async runtime so a wedged
            // connection task cannot starve the forced process exit.
            let _ = graceful_tx.send(());
            let (shutdown_complete_tx, shutdown_complete_rx) = std::sync::mpsc::channel();
            let force_shutdown = force_shutdown.take().expect("force shutdown callback");
            let watchdog = std::thread::Builder::new()
                .name("nac-shutdown-watchdog".to_string())
                .spawn(move || {
                    if shutdown_complete_rx
                        .recv_timeout(complete_shutdown_timeout)
                        .is_err()
                    {
                        forced_shutdown_after_timeout(complete_shutdown_timeout, force_shutdown);
                    }
                })
                .context("failed to start shutdown watchdog")?;

            shutdown_manager.cancel_local_active_runs_for_shutdown().await;
            let result = (&mut server)
                .await
                .context("server task stopped unexpectedly")?
                .context("server stopped unexpectedly");
            let _ = shutdown_complete_tx.send(());
            watchdog
                .join()
                .map_err(|_| anyhow!("shutdown watchdog panicked"))?;
            result
        }
    };
    result
}

fn forced_shutdown_after_timeout(timeout: Duration, force_shutdown: impl FnOnce()) {
    eprintln!(
        "nac: complete graceful shutdown exceeded {} ms; forcing runtime exit",
        timeout.as_millis()
    );
    force_shutdown();
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            eprintln!("nac: failed to install Ctrl-C handler: {error}");
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};

        let terminate = async {
            match signal(SignalKind::terminate()) {
                Ok(mut stream) => {
                    stream.recv().await;
                }
                Err(error) => {
                    eprintln!("nac: failed to install SIGTERM handler: {error}");
                    std::future::pending::<()>().await;
                }
            }
        };
        tokio::select! {
            () = ctrl_c => {}
            () = terminate => {}
        }
    }

    #[cfg(not(unix))]
    ctrl_c.await;
}

#[utoipa::path(
    get,
    path = "/health",
    operation_id = "get_health",
    tag = "system",
    responses(
        (status = 200, description = "Session store ready", body = HealthResponse, content_type = "application/json"),
        (status = 503, description = "Session store unavailable", body = HealthResponse, content_type = "application/json")
    )
)]
async fn health(State(manager): State<SessionManager>) -> (StatusCode, Json<HealthResponse>) {
    let store_path = manager.inner.store_path.clone();
    let ready =
        tokio::task::spawn_blocking(move || nac_core::store::check_readiness(&store_path)).await;
    match ready {
        Ok(Ok(())) => (StatusCode::OK, Json(HealthResponse { status: "ok" })),
        Ok(Err(error)) => {
            eprintln!("nac: session store readiness check failed: {error:#}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "unavailable",
                }),
            )
        }
        Err(error) => {
            eprintln!("nac: session store readiness task failed: {error}");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(HealthResponse {
                    status: "unavailable",
                }),
            )
        }
    }
}

// The frontend is a Vite/React app built from `web/` into `assets/dist/`. That
// output is committed, so building this crate never needs Node, and the whole
// `assets/` tree is embedded at compile time to keep `nac-web` a single
// self-contained executable with no runtime filesystem dependency.
static ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/assets");

async fn index_html() -> impl IntoResponse {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            // The entry document names the hashed bundles, so it must never be
            // cached or a client would keep loading a stale build forever.
            (header::CACHE_CONTROL, "no-cache"),
        ],
        include_str!("../assets/dist/index.html"),
    )
}

pub(crate) fn asset_content_type(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("json") | Some("map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("woff2") => "font/woff2",
        Some("woff") => "font/woff",
        Some("ttf") => "font/ttf",
        Some("png") => "image/png",
        Some("txt") => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

// Everything Vite emits under `dist/assets/` carries a content hash in its
// filename, so those responses can be cached indefinitely.
pub(crate) fn asset_cache_control(path: &str) -> &'static str {
    if path.starts_with("dist/assets/") {
        "public, max-age=31536000, immutable"
    } else {
        "no-cache"
    }
}

// Serve any embedded asset by its path relative to the `assets/` root (the
// `/assets/` prefix is stripped by the route). Returns 404 for unknown paths.
async fn serve_asset(AxumPath(path): AxumPath<String>) -> Response {
    match ASSETS.get_file(&path) {
        Some(file) => (
            [
                (header::CONTENT_TYPE, asset_content_type(&path)),
                (header::CACHE_CONTROL, asset_cache_control(&path)),
            ],
            file.contents(),
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "asset not found").into_response(),
    }
}

#[utoipa::path(
    get,
    path = "/store",
    operation_id = "get_store",
    tag = "system",
    responses((status = 200, description = "Success", body = StoreInfo, content_type = "application/json"))
)]
async fn store_info(State(manager): State<SessionManager>) -> Json<StoreInfo> {
    Json(manager.store_info())
}

/// Whether this host can run sandboxed sessions right now. The launch UI
/// queries this only when the user picks sandbox mode, so the probe's
/// subprocess cost is paid on demand rather than on every page load.
#[utoipa::path(
    get,
    path = "/sandbox/availability",
    operation_id = "get_sandbox_availability",
    tag = "system",
    responses((status = 200, description = "Success", body = runtime::SandboxAvailability, content_type = "application/json"))
)]
async fn sandbox_availability_handler() -> Json<runtime::SandboxAvailability> {
    Json(runtime::probe_availability().await)
}

/// Sandbox setup currently in progress for one launch (image pull, container
/// start), or `null` when that launch is idle. The launch UI generates a key
/// per attempt, sends it with the create request, and polls here with it —
/// keyed so concurrent launches never show each other's phase. A first image
/// pull can take minutes with no other visible signal.
#[derive(Debug, Clone, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SandboxActivityQuery {
    /// The activity key the create request carried (`sandbox.activity_key`).
    pub key: String,
}

#[utoipa::path(
    get,
    path = "/sandbox/activity",
    operation_id = "get_sandbox_activity",
    tag = "system",
    params(SandboxActivityQuery),
    responses((status = 200, description = "Success", body = Option<runtime::SandboxActivity>, content_type = "application/json"))
)]
async fn sandbox_activity_handler(
    Query(query): Query<SandboxActivityQuery>,
) -> Json<Option<runtime::SandboxActivity>> {
    Json(runtime::current_activity(&query.key))
}

/// The picker starts wherever the caller last was; with no path yet it opens on
/// the server root the session would default to anyway.
#[utoipa::path(
    get,
    path = "/fs/browse",
    operation_id = "get_fs_browse",
    tag = "filesystem",
    params(filesystem::BrowseQuery),
    responses((status = 200, description = "Success", body = filesystem::BrowseListing, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 403, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn browse_filesystem_handler(
    State(manager): State<SessionManager>,
    Query(query): Query<filesystem::BrowseQuery>,
) -> std::result::Result<Json<filesystem::BrowseListing>, ApiError> {
    let listing = filesystem::browse(&query, &manager.inner.root_cwd)?;
    Ok(Json(listing))
}

/// The same listing for a directory on an SSH host, which is also how the launch
/// form tests the connection before it offers the rest of the form.
#[utoipa::path(
    post,
    path = "/ssh/browse",
    operation_id = "post_ssh_browse",
    tag = "filesystem",
    request_body(content = SshBrowseRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = filesystem::BrowseListing, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 403, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn browse_ssh_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<SshBrowseRequest>, JsonRejection>,
) -> std::result::Result<Json<filesystem::BrowseListing>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let listing = manager.browse_ssh(request).await?;
    Ok(Json(listing))
}

/// Validate a credential by asking its provider which models it may use.
///
/// A key arrives in the request body and is forwarded once; it is never stored
/// by this route, and the destination goes through the same credential trust
/// check as a session launch. A provider signed in through the browser has no
/// key to send, so the stored login answers instead — and its answer is the
/// same evidence the launch UI needs that the login still works.
#[utoipa::path(
    post,
    path = "/providers/models",
    operation_id = "post_providers_models",
    tag = "models",
    request_body(content = ProviderModelsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ProviderModelList, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn provider_models_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<ProviderModelsRequest>, JsonRejection>,
) -> std::result::Result<Json<ProviderModelList>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let backend = request.backend;

    let api_key = request.api_key.unwrap_or_default();
    let api_key_env = request
        .api_key_env
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(provider) = ManagedAuthProvider::for_backend(backend) {
        if !api_key.trim().is_empty() || api_key_env.is_some() {
            return Err(ApiError {
                status: StatusCode::BAD_REQUEST,
                message: format!(
                    "backend '{backend}' authenticates with a stored login and accepts no API key"
                ),
            });
        }
        let models = list_managed_provider_models(provider)
            .await
            .map_err(|error| ApiError {
                status: StatusCode::BAD_GATEWAY,
                message: error.to_string(),
            })?;
        // The endpoint belongs to the login rather than to the caller, so it is
        // reported back the same way a validated key's is.
        let base_url = provider_default_base_url(backend)
            .map(str::to_string)
            .unwrap_or_default();
        return Ok(Json(ProviderModelList { base_url, models }));
    }
    // A key already filed away is named rather than sent, so a setup that is
    // only being reviewed never has to hand its secret back to the page first.
    let api_key = match api_key_env {
        Some(name) if api_key.trim().is_empty() => resolve_backend_api_key(backend, Some(name))
            .map_err(|error| ApiError {
                status: StatusCode::BAD_REQUEST,
                message: error.to_string(),
            })?,
        _ => api_key,
    };
    if api_key.trim().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' requires a nonblank API key"),
        });
    }

    let base_url = request
        .base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| provider_default_base_url(backend).map(str::to_string))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' has no default base URL; supply one"),
        })?;
    enforce_trusted_base_url(
        Some(backend),
        Some(base_url.as_str()),
        &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
    )?;

    let models = list_provider_models(backend, &base_url, &api_key)
        .await
        .map_err(|error| ApiError {
            // A rejected key is the caller's problem, not a server fault.
            status: StatusCode::BAD_GATEWAY,
            message: error.to_string(),
        })?;
    Ok(Json(ProviderModelList { base_url, models }))
}

#[utoipa::path(
    get,
    path = "/projects",
    operation_id = "get_projects",
    tag = "projects",
    responses((status = 200, description = "Success", body = ProjectList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_projects_handler(
    State(manager): State<SessionManager>,
) -> std::result::Result<Json<ProjectList>, ApiError> {
    Ok(Json(ProjectList {
        projects: manager.projects().list()?,
    }))
}

#[utoipa::path(
    post,
    path = "/projects",
    operation_id = "post_projects",
    tag = "projects",
    request_body(content = CreateProjectRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = ProjectRecord, content_type = "application/json"), (status = 400, description = "Invalid project metadata or location", body = ApiErrorBody, content_type = "application/json"), (status = 403, description = "Remote directory is unreadable", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Directory or default model configuration was not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "A project already uses this canonical location", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Remote host or command failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn create_project_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<CreateProjectRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<ProjectRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let command = application::projects::CreateProject {
        name: request.name,
        description: request.description,
        cwd: request.cwd,
        ssh_host: request.ssh_host,
        ssh_port: request.ssh_port,
        ssh_identity_file: request.ssh_identity_file,
        default_model_config_id: request.default_model_config_id,
    };
    Ok((
        StatusCode::CREATED,
        Json(manager.projects().create(command).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/projects/{project_id}",
    operation_id = "patch_projects_project_id",
    tag = "projects",
    params(("project_id" = String, Path)),
    request_body(content = UpdateProjectRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ProjectRecord, content_type = "application/json"), (status = 400, description = "Invalid project metadata", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Project or default model configuration was not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn update_project_handler(
    State(manager): State<SessionManager>,
    AxumPath(project_id): AxumPath<String>,
    payload: std::result::Result<Json<UpdateProjectRequest>, JsonRejection>,
) -> std::result::Result<Json<ProjectRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.projects().update(
        &project_id,
        application::projects::UpdateProject {
            name: project_field(request.name),
            description: project_field(request.description),
            default_model_config_id: project_field(request.default_model_config_id),
            pinned: project_field(request.pinned),
        },
    )?))
}

/// Remove a project, by default without touching the work done inside it.
///
/// Its sessions are released rather than deleted, so they reappear in the
/// listing as unassigned and can be assigned somewhere else. Pass
/// `?sessions=delete` to take them down with the project instead.
#[utoipa::path(
    delete,
    path = "/projects/{project_id}",
    operation_id = "delete_projects_project_id",
    tag = "projects",
    params(DeleteProjectQuery, ("project_id" = String, Path)),
    responses((status = 200, description = "Success", body = DeleteProjectResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Project was not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_project_handler(
    State(manager): State<SessionManager>,
    AxumPath(project_id): AxumPath<String>,
    Query(query): Query<DeleteProjectQuery>,
) -> std::result::Result<Json<DeleteProjectResponse>, ApiError> {
    let sessions = match query.sessions {
        DeleteProjectSessions::Keep => application::projects::ProjectSessionDisposition::Keep,
        DeleteProjectSessions::Delete => application::projects::ProjectSessionDisposition::Delete,
    };
    let outcome = manager.projects().delete(&project_id, sessions).await?;
    Ok(Json(DeleteProjectResponse {
        released_session_ids: outcome.released_session_ids,
        deleted_session_ids: outcome.deleted_session_ids,
    }))
}

/// Attach an existing session to a project.
///
/// Membership is set once: an already-assigned session conflicts, and so does a
/// session whose working directory is not the project's location.
#[utoipa::path(
    post,
    path = "/projects/{project_id}/sessions",
    operation_id = "post_projects_project_id_sessions",
    tag = "projects",
    params(("project_id" = String, Path)),
    request_body(content = AssignSessionRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ProjectRecord, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Project or session was not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Session is already assigned or runs elsewhere", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn assign_session_handler(
    State(manager): State<SessionManager>,
    AxumPath(project_id): AxumPath<String>,
    payload: std::result::Result<Json<AssignSessionRequest>, JsonRejection>,
) -> std::result::Result<Json<ProjectRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .projects()
            .assign_session(&project_id, &request.session_id)?,
    ))
}

/// Rewrite the order of one pin group.
#[utoipa::path(
    put,
    path = "/projects/order",
    operation_id = "put_projects_order",
    tag = "projects",
    request_body(content = ReorderProjectsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ReorderProjectsResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn reorder_projects_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<ReorderProjectsRequest>, JsonRejection>,
) -> std::result::Result<Json<ReorderProjectsResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let projects = manager.projects().reorder(
        request.pinned,
        &request.project_ids,
        &request.expected_versions,
    )?;
    Ok(Json(ReorderProjectsResponse {
        pinned: request.pinned,
        projects,
    }))
}

#[utoipa::path(
    get,
    path = "/model-configs",
    operation_id = "get_model_configs",
    tag = "model-configs",
    responses((status = 200, description = "Success", body = ModelConfigurationList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_model_configs_handler(
    State(manager): State<SessionManager>,
) -> std::result::Result<Json<ModelConfigurationList>, ApiError> {
    let configurations =
        model_configurations::list_model_configurations(&manager.inner.store_path)?;
    Ok(Json(ModelConfigurationList { configurations }))
}

/// Save a validated provider setup under a name.
///
/// The key is filed in the credential store under a generated name that the
/// row then points at, so the secret stays out of the database and a launched
/// session resolves it through the ordinary `api_key_env` path.
#[utoipa::path(
    post,
    path = "/model-configs",
    operation_id = "post_model_configs",
    tag = "model-configs",
    request_body(content = CreateModelConfigurationRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = ModelConfigurationRecord, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn create_model_config_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<CreateModelConfigurationRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<ModelConfigurationRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let backend = request.backend;

    let base_url = settle_configuration_base_url(&manager, backend, request.base_url.as_deref())?;

    let api_key = request
        .api_key
        .as_deref()
        .map(str::trim)
        .unwrap_or_default();
    let expects_key = provider_uses_api_key(backend);
    if expects_key && api_key.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' requires an API key"),
        });
    }
    if !expects_key && !api_key.is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!(
                "backend '{backend}' authenticates with a stored login and accepts no API key"
            ),
        });
    }

    let id = uuid::Uuid::new_v4();
    let credential_name =
        expects_key.then(|| format!("{GENERATED_CREDENTIAL_PREFIX}{}", id.simple()));
    let policy = NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?;
    let light = request
        .light_model
        .map(|light| {
            light_model::normalize(
                light,
                &policy,
                credential_name
                    .as_deref()
                    .map(|name| light_model::InheritedCredential {
                        backend,
                        name: Some(name),
                        previous: None,
                    }),
            )
        })
        .transpose()?;

    let configuration = model_configurations::NewModelConfiguration {
        name: request.name,
        backend: backend.to_string(),
        model: request.model,
        base_url,
        api_key_env: credential_name.clone(),
        reasoning_effort: request
            .reasoning_effort
            .map(|effort| effort.as_str().to_string()),
        extra_headers: request.extra_headers.unwrap_or_default(),
        orchestrator_compaction_threshold: request.orchestrator_compaction_threshold,
        initial_prompt: request.initial_prompt,
        light_model: light,
    };
    if let Some(name) = credential_name.as_deref() {
        store_api_key(name, api_key)?;
    }
    // The light model must resolve to a working client now, not at the first
    // launch that picks this setup. Validation needs the credential above
    // already stored, so a failure retires it again.
    if let Some(light) = configuration.light_model.as_ref() {
        if let Err(error) = nac_core::light_model::validate(light, &configuration.extra_headers) {
            if let Some(name) = credential_name.as_deref() {
                let _ = remove_api_key(name);
            }
            return Err(request_configuration_error_from(error).into());
        }
    }
    let record = model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        &id.to_string(),
        configuration,
    );

    match record {
        Ok(record) => Ok((StatusCode::CREATED, Json(record))),
        Err(error) => {
            // The row is what makes the credential reachable, so a failed
            // insert must not leave the secret behind.
            if let Some(name) = credential_name.as_deref() {
                let _ = remove_api_key(name);
            }
            Err(error.into())
        }
    }
}

/// Settles where a configuration sends its requests: the caller's URL when
/// there is one, the provider's canonical URL otherwise, checked against the
/// credential destination policy either way.
fn settle_configuration_base_url(
    manager: &SessionManager,
    backend: BackendKind,
    requested: Option<&str>,
) -> std::result::Result<String, ApiError> {
    let base_url = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| provider_default_base_url(backend).map(str::to_string))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' has no default base URL; supply one"),
        })?;
    let base_url = resolve_model_base_url(backend, Some(base_url))?;
    enforce_trusted_base_url(
        Some(backend),
        Some(base_url.as_str()),
        &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
    )?;
    Ok(base_url)
}

/// Edit a saved provider setup, keeping whatever the request leaves out.
///
/// A new key is filed under a fresh generated name and the row is pointed at
/// it; the credential it replaces is dropped only once the row has actually
/// moved, so a failed edit never leaves the configuration pointing at a secret
/// that is gone.
#[utoipa::path(
    patch,
    path = "/model-configs/{config_id}",
    operation_id = "patch_model_configs_config_id",
    tag = "model-configs",
    params(("config_id" = String, Path)),
    request_body(content = UpdateModelConfigurationRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ModelConfigurationRecord, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn update_model_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
    payload: std::result::Result<Json<UpdateModelConfigurationRequest>, JsonRejection>,
) -> std::result::Result<Json<ModelConfigurationRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let existing =
        model_configurations::load_model_configuration(&manager.inner.store_path, &config_id)?;
    let stored_backend: BackendKind =
        existing
            .backend
            .parse()
            .map_err(|message: String| ApiError {
                status: StatusCode::BAD_REQUEST,
                message,
            })?;

    let backend = match request.backend {
        RequestField::Value(kind) => kind,
        RequestField::Omitted | RequestField::Null => stored_backend,
    };
    // Switching provider retires a URL that was only the old provider's
    // default, so an unmentioned URL follows the new backend instead.
    let requested_base_url = match request.base_url {
        RequestField::Value(url) => Some(url),
        RequestField::Null => None,
        RequestField::Omitted => (backend == stored_backend).then(|| existing.base_url.clone()),
    };
    let base_url = settle_configuration_base_url(&manager, backend, requested_base_url.as_deref())?;

    let expects_key = provider_uses_api_key(backend);
    let supplied_key = match &request.api_key {
        RequestField::Value(key) => Some(key.trim().to_string()),
        _ => None,
    };
    if !expects_key && supplied_key.as_deref().is_some_and(|key| !key.is_empty()) {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!(
                "backend '{backend}' authenticates with a stored login and accepts no API key"
            ),
        });
    }

    // The credential the row ends up pointing at, and the one it is leaving
    // behind — exactly one of the two survives this request.
    let replacement_credential = supplied_key.filter(|key| !key.is_empty()).map(|key| {
        (
            format!(
                "{GENERATED_CREDENTIAL_PREFIX}{}",
                uuid::Uuid::new_v4().simple()
            ),
            key,
        )
    });
    let (api_key_env, superseded) = if !expects_key {
        (None, existing.api_key_env.clone())
    } else if let Some((name, _)) = replacement_credential.as_ref() {
        (Some(name.clone()), existing.api_key_env.clone())
    } else if matches!(request.api_key, RequestField::Null) || existing.api_key_env.is_none() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' requires an API key"),
        });
    } else {
        (existing.api_key_env.clone(), None)
    };

    let inherited = light_model::InheritedCredential {
        backend,
        name: api_key_env.as_deref(),
        previous: existing.api_key_env.as_deref(),
    };
    let configuration = model_configurations::NewModelConfiguration {
        name: replaceable_text(request.name, &existing.name),
        backend: backend.to_string(),
        model: replaceable_text(request.model, &existing.model),
        base_url,
        api_key_env: api_key_env.clone(),
        reasoning_effort: match request.reasoning_effort {
            RequestField::Value(effort) => Some(effort.as_str().to_string()),
            RequestField::Null => None,
            RequestField::Omitted => existing.reasoning_effort.clone(),
        },
        extra_headers: match request.extra_headers {
            RequestField::Value(headers) => headers,
            RequestField::Null => BTreeMap::new(),
            RequestField::Omitted => existing.extra_headers.clone(),
        },
        orchestrator_compaction_threshold: match request.orchestrator_compaction_threshold {
            RequestField::Value(threshold) => (threshold != 0).then_some(threshold),
            RequestField::Null => None,
            RequestField::Omitted => existing.orchestrator_compaction_threshold,
        },
        initial_prompt: match request.initial_prompt {
            RequestField::Value(prompt) => Some(prompt),
            RequestField::Null => None,
            RequestField::Omitted => existing.initial_prompt.clone(),
        },
        light_model: match request.light_model {
            RequestField::Value(light) => Some(light_model::normalize(
                light,
                &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
                Some(inherited),
            )?),
            RequestField::Null => None,
            RequestField::Omitted => existing.light_model.clone().map(|mut light| {
                light_model::rotate_inherited_credential(&mut light, inherited);
                light
            }),
        },
    };

    if let Some((name, key)) = replacement_credential.as_ref() {
        store_api_key(name, key)?;
    }
    // As on create, the light model must resolve to a working client before
    // the row is updated; a failure retires the just-stored key.
    if let Some(light) = configuration.light_model.as_ref() {
        if let Err(error) = nac_core::light_model::validate(light, &configuration.extra_headers) {
            if let Some((name, _)) = replacement_credential.as_ref() {
                let _ = remove_api_key(name);
            }
            return Err(request_configuration_error_from(error).into());
        }
    }
    match model_configurations::update_model_configuration(
        &manager.inner.store_path,
        &config_id,
        configuration,
    ) {
        Ok(record) => {
            // A generated key survives exactly as long as something in the
            // updated record — top-level or the light model — still names it;
            // every other generated key this update walked away from is
            // retired.
            let mut retired: std::collections::BTreeSet<&str> = existing
                .light_model
                .as_ref()
                .and_then(|light| light.api_key_env.as_deref())
                .into_iter()
                .chain(superseded.as_deref())
                .filter(|name| name.starts_with(GENERATED_CREDENTIAL_PREFIX))
                .collect();
            for kept in record.api_key_env.iter().map(String::as_str).chain(
                record
                    .light_model
                    .as_ref()
                    .and_then(|light| light.api_key_env.as_deref()),
            ) {
                retired.remove(kept);
            }
            for name in retired {
                let _ = remove_api_key(name);
            }
            Ok(Json(record))
        }
        Err(error) => {
            if api_key_env != existing.api_key_env {
                if let Some(name) = api_key_env.as_deref() {
                    let _ = remove_api_key(name);
                }
            }
            Err(error.into())
        }
    }
}

/// A tri-state text field applied to what is stored: null blanks the value so
/// the store rejects it by name, rather than silently keeping the old one.
fn replaceable_text(field: RequestField<String>, current: &str) -> String {
    match field {
        RequestField::Value(value) => value,
        RequestField::Null => String::new(),
        RequestField::Omitted => current.to_string(),
    }
}

/// Read a configuration the user picked from disk and check it can actually run.
///
/// The key is never sent by the client here: the file names an environment
/// variable or stored credential, and the server resolves it the same way a
/// session would.
#[utoipa::path(
    post,
    path = "/model-configs/from-file",
    operation_id = "post_model_configs_from_file",
    tag = "model-configs",
    request_body(content = ModelConfigFromFileRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ResolvedModelConfiguration, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn model_config_from_file_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<ModelConfigFromFileRequest>, JsonRejection>,
) -> std::result::Result<Json<ResolvedModelConfiguration>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let path = PathBuf::from(request.path.trim());
    if path.as_os_str().is_empty() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "a configuration file path is required".to_string(),
        });
    }

    let config = NacConfig::load_from_file(&path).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: error.to_string(),
    })?;
    // A file written against the current schema names only a model, whose
    // provider the catalog resolves; an older one states the provider
    // outright and is taken at its word.
    let identity = NacConfig::load_model_identity_from_file(&path).map_err(|error| ApiError {
        status: StatusCode::BAD_REQUEST,
        message: error.to_string(),
    })?;
    let backend = identity
        .backend
        .or_else(|| config.model.model.as_deref().and_then(provider_for_model))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!(
                "{} names no model the catalog recognizes, so it cannot describe a provider",
                path.display()
            ),
        })?;

    resolve_configuration(
        &manager,
        backend,
        config.model.model,
        identity.base_url,
        identity.api_key_env,
        config.model.reasoning_effort,
    )
    .await
}

#[utoipa::path(
    post,
    path = "/model-configs/{config_id}/models",
    operation_id = "post_model_configs_config_id_models",
    tag = "model-configs",
    params(("config_id" = String, Path)),
    responses((status = 200, description = "Success", body = ResolvedModelConfiguration, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 502, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn saved_model_config_models_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> std::result::Result<Json<ResolvedModelConfiguration>, ApiError> {
    let record =
        model_configurations::load_model_configuration(&manager.inner.store_path, &config_id)?;
    let backend: BackendKind = record.backend.parse().map_err(|message: String| ApiError {
        status: StatusCode::BAD_REQUEST,
        message,
    })?;
    let reasoning_effort = record
        .reasoning_effort
        .as_deref()
        .map(|raw| parse_request_enum::<ReasoningEffort>(raw, "reasoning_effort"))
        .transpose()?;

    resolve_configuration(
        &manager,
        backend,
        Some(record.model),
        Some(record.base_url),
        record.api_key_env,
        reasoning_effort,
    )
    .await
}

/// Shared tail of the saved-configuration and config-file paths: settle the
/// destination, resolve the credential, and confirm both by listing models.
async fn resolve_configuration(
    manager: &SessionManager,
    backend: BackendKind,
    model: Option<String>,
    base_url: Option<String>,
    api_key_env: Option<String>,
    reasoning_effort: Option<ReasoningEffort>,
) -> std::result::Result<Json<ResolvedModelConfiguration>, ApiError> {
    let base_url = base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| provider_default_base_url(backend).map(str::to_string))
        .ok_or_else(|| ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' has no default base URL; supply one"),
        })?;
    let base_url = resolve_model_base_url(backend, Some(base_url))?;
    enforce_trusted_base_url(
        Some(backend),
        Some(base_url.as_str()),
        &NacConfig::load_credential_destination_policy(&manager.inner.root_cwd)?,
    )?;

    let mut models_error = None;
    let models = match ManagedAuthProvider::for_backend(backend) {
        // A stored login has no key to check, but it does reach a model index,
        // so a saved setup offers the same choice a fresh one does. Being
        // signed out is not fatal here: the configuration still names a model.
        // The reason for an empty list travels with it, so the caller can tell a
        // provider with nothing to offer from a login that stopped working.
        Some(provider) => match list_managed_provider_models(provider).await {
            Ok(models) => models,
            Err(error) => {
                models_error = Some(error.to_string());
                Vec::new()
            }
        },
        None => {
            let api_key =
                resolve_backend_api_key(backend, api_key_env.as_deref()).map_err(|error| {
                    ApiError {
                        status: StatusCode::BAD_REQUEST,
                        message: error.to_string(),
                    }
                })?;
            list_provider_models(backend, &base_url, &api_key)
                .await
                .map_err(|error| ApiError {
                    status: StatusCode::BAD_GATEWAY,
                    message: error.to_string(),
                })?
        }
    };

    Ok(Json(ResolvedModelConfiguration {
        backend,
        model,
        base_url,
        api_key_env,
        reasoning_effort,
        models,
        models_error,
    }))
}

#[utoipa::path(
    delete,
    path = "/model-configs/{config_id}",
    operation_id = "delete_model_configs_config_id",
    tag = "model-configs",
    params(("config_id" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Configuration is a project default", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_model_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    let record =
        model_configurations::load_model_configuration(&manager.inner.store_path, &config_id)?;
    model_configurations::delete_model_configuration(&manager.inner.store_path, &config_id)?;

    // Only a key this server filed away is ours to drop; a hand-configured
    // environment variable name belongs to the operator. The light model can
    // hold a generated key the top level already rotated off, so both are
    // swept.
    let generated: std::collections::BTreeSet<&str> = record
        .api_key_env
        .as_deref()
        .into_iter()
        .chain(
            record
                .light_model
                .as_ref()
                .and_then(|light| light.api_key_env.as_deref()),
        )
        .filter(|name| name.starts_with(GENERATED_CREDENTIAL_PREFIX))
        .collect();
    for name in generated {
        let _ = remove_api_key(name);
    }
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/ssh-configs",
    operation_id = "get_ssh_configs",
    tag = "ssh-configs",
    responses((status = 200, description = "Success", body = SshConfigurationList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_ssh_configs_handler(
    State(manager): State<SessionManager>,
) -> std::result::Result<Json<SshConfigurationList>, ApiError> {
    let configurations = ssh_configurations::list_ssh_configurations(&manager.inner.store_path)?;
    Ok(Json(SshConfigurationList { configurations }))
}

/// Save a named SSH connection under a reusable setup.
#[utoipa::path(
    post,
    path = "/ssh-configs",
    operation_id = "post_ssh_configs",
    tag = "ssh-configs",
    request_body(content = CreateSshConfigurationRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = SshConfigurationRecord, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn create_ssh_config_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<CreateSshConfigurationRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<SshConfigurationRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let id = uuid::Uuid::new_v4();
    let configuration = ssh_configurations::NewSshConfiguration {
        name: request.name,
        ssh_host: request.ssh_host,
        ssh_port: request.ssh_port,
        ssh_identity_file: request.ssh_identity_file,
    };
    let record = ssh_configurations::insert_ssh_configuration(
        &manager.inner.store_path,
        &id.to_string(),
        configuration,
    )?;
    Ok((StatusCode::CREATED, Json(record)))
}

/// Edit a saved SSH setup, keeping whatever the request leaves out.
#[utoipa::path(
    patch,
    path = "/ssh-configs/{config_id}",
    operation_id = "patch_ssh_configs_config_id",
    tag = "ssh-configs",
    params(("config_id" = String, Path)),
    request_body(content = UpdateSshConfigurationRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = SshConfigurationRecord, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn update_ssh_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
    payload: std::result::Result<Json<UpdateSshConfigurationRequest>, JsonRejection>,
) -> std::result::Result<Json<SshConfigurationRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let existing =
        ssh_configurations::load_ssh_configuration(&manager.inner.store_path, &config_id)?;

    let configuration = ssh_configurations::NewSshConfiguration {
        name: replaceable_text(request.name, &existing.name),
        ssh_host: replaceable_text(request.ssh_host, &existing.ssh_host),
        ssh_port: match request.ssh_port {
            RequestField::Value(port) => Some(port),
            RequestField::Null => None,
            RequestField::Omitted => existing.ssh_port,
        },
        ssh_identity_file: match request.ssh_identity_file {
            RequestField::Value(path) => Some(path),
            RequestField::Null => None,
            RequestField::Omitted => existing.ssh_identity_file.clone(),
        },
    };

    let record = ssh_configurations::update_ssh_configuration(
        &manager.inner.store_path,
        &config_id,
        configuration,
    )?;
    Ok(Json(record))
}

#[utoipa::path(
    delete,
    path = "/ssh-configs/{config_id}",
    operation_id = "delete_ssh_configs_config_id",
    tag = "ssh-configs",
    params(("config_id" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_ssh_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    ssh_configurations::load_ssh_configuration(&manager.inner.store_path, &config_id)?;
    ssh_configurations::delete_ssh_configuration(&manager.inner.store_path, &config_id)?;
    Ok(StatusCode::NO_CONTENT)
}

fn managed_secret_store(
    manager: &SessionManager,
) -> std::result::Result<nac_core::managed::HostSecretStore, ApiError> {
    manager
        .managed_host()
        .map(nac_core::managed::ManagedHostConfig::secret_store)
        .ok_or_else(|| ApiError {
            status: StatusCode::NOT_FOUND,
            message: "Managed NAC is not configured".to_string(),
        })
}

#[utoipa::path(
    get,
    path = "/managed/secrets",
    operation_id = "get_managed_secrets",
    tag = "managed",
    responses((status = 200, description = "Write-only managed host secret metadata", body = ManagedSecretList, content_type = "application/json"), (status = 404, description = "Managed NAC is not configured", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Secret store unavailable", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_managed_secrets_handler(
    State(manager): State<SessionManager>,
) -> std::result::Result<Json<ManagedSecretList>, ApiError> {
    let secrets = managed_secret_store(&manager)?
        .list()?
        .into_iter()
        .map(|secret| ManagedSecretSummary {
            name: secret.name,
            updated_at_unix_ms: secret.updated_at_unix_ms,
        })
        .collect();
    Ok(Json(ManagedSecretList {
        secrets,
        healthy: true,
    }))
}

#[utoipa::path(
    put,
    path = "/managed/secrets/{name}",
    operation_id = "put_managed_secrets_name",
    tag = "managed",
    params(("name" = String, Path)),
    request_body(content = PutManagedSecretRequest, content_type = "application/json"),
    responses((status = 200, description = "Secret created or replaced without returning its value", body = ManagedSecretSummary, content_type = "application/json"), (status = 400, description = "Invalid or reserved secret", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Managed NAC is not configured", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Secret store unavailable", body = ApiErrorBody, content_type = "application/json"))
)]
async fn put_managed_secret_handler(
    State(manager): State<SessionManager>,
    AxumPath(name): AxumPath<String>,
    payload: std::result::Result<Json<PutManagedSecretRequest>, JsonRejection>,
) -> std::result::Result<Json<ManagedSecretSummary>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let summary = managed_secret_store(&manager)?
        .put(&name, &request.value)
        .map_err(|error| ApiError::bad_request(error.to_string()))?;
    Ok(Json(ManagedSecretSummary {
        name: summary.name,
        updated_at_unix_ms: summary.updated_at_unix_ms,
    }))
}

#[utoipa::path(
    delete,
    path = "/managed/secrets/{name}",
    operation_id = "delete_managed_secrets_name",
    tag = "managed",
    params(("name" = String, Path)),
    responses((status = 204, description = "Secret removed from future command environments"), (status = 404, description = "Managed NAC or secret not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Secret store unavailable", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_managed_secret_handler(
    State(manager): State<SessionManager>,
    AxumPath(name): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    if managed_secret_store(&manager)?.delete(&name)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("managed secret '{name}' was not found"),
        })
    }
}

/// Stored credentials are write-only over HTTP: a caller may add, replace or
/// drop a key, but the value is never echoed back. Only enough of a suffix to
/// tell two keys apart leaves the process.
#[utoipa::path(
    get,
    path = "/credentials",
    operation_id = "get_credentials",
    tag = "credentials",
    responses((status = 200, description = "Success", body = StoredCredentialList, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_credentials_handler() -> std::result::Result<Json<StoredCredentialList>, ApiError> {
    let credentials = list_stored_api_keys()?
        .into_iter()
        .map(|entry| StoredCredentialSummary {
            name: entry.name,
            last_four: entry.last_four,
        })
        .collect();
    Ok(Json(StoredCredentialList { credentials }))
}

#[utoipa::path(
    put,
    path = "/credentials/{name}",
    operation_id = "put_credentials_name",
    tag = "credentials",
    params(("name" = String, Path)),
    request_body(content = StoreCredentialRequest, content_type = "application/json"),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn store_credential_handler(
    AxumPath(name): AxumPath<String>,
    payload: std::result::Result<Json<StoreCredentialRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    store_api_key(&name, &request.value)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Files a key away without the caller having to name it. The generated name is
/// what a session stores in place of the secret, and its prefix marks the key as
/// this server's to clean up rather than one the operator manages by hand.
#[utoipa::path(
    post,
    path = "/credentials",
    operation_id = "post_credentials",
    tag = "credentials",
    request_body(content = StoreCredentialRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = GeneratedCredential, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn store_generated_credential_handler(
    payload: std::result::Result<Json<StoreCredentialRequest>, JsonRejection>,
) -> std::result::Result<Json<GeneratedCredential>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let name = format!(
        "{GENERATED_CREDENTIAL_PREFIX}{}",
        uuid::Uuid::new_v4().simple()
    );
    store_api_key(&name, &request.value)?;
    Ok(Json(GeneratedCredential { name }))
}

#[utoipa::path(
    delete,
    path = "/credentials/{name}",
    operation_id = "delete_credentials_name",
    tag = "credentials",
    params(("name" = String, Path)),
    responses((status = 204, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_credential_handler(
    AxumPath(name): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    if remove_api_key(&name)? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("no stored credential named '{name}' was found"),
        })
    }
}

#[utoipa::path(
    post,
    path = "/sessions/launch-defaults",
    operation_id = "post_sessions_launch_defaults",
    tag = "sessions",
    request_body(content = LaunchModelDefaultsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = LaunchModelDefaults, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn launch_model_defaults_handler(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<LaunchModelDefaultsRequest>, JsonRejection>,
) -> std::result::Result<Json<LaunchModelDefaults>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.launch_model_defaults(request)?))
}

/// The model catalog listing for the frontend picker: every provider with
/// auth requirements, managed base URL, catalog endpoint default,
/// `_default` limits and real entries. Reads the process-global catalog;
/// synchronous, local-only, never fails. `auth_status`/`auth_hint` are
/// computed per request from the process environment and the managed
/// credential files.
#[utoipa::path(
    get,
    path = "/models",
    operation_id = "get_models",
    tag = "models",
    responses((status = 200, description = "Success", body = ModelListing, content_type = "application/json"))
)]
async fn models_handler() -> Json<ModelListing> {
    Json(nac_core::model::api_listing())
}

#[utoipa::path(
    get,
    path = "/commands",
    operation_id = "get_commands",
    tag = "system",
    responses((status = 200, description = "Success", body = Vec<SlashCommandDefinition>, content_type = "application/json"))
)]
async fn commands_handler() -> Json<&'static [SlashCommandDefinition]> {
    Json(slash_command_definitions())
}

#[utoipa::path(
    get,
    path = "/sessions",
    operation_id = "get_sessions",
    tag = "sessions",
    params(ListSessionsQuery),
    responses((status = 200, description = "Success", body = Vec<ManagedSessionSummary>, content_type = "application/json"), (status = 400, description = "Query extraction failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_sessions(
    State(manager): State<SessionManager>,
    Query(query): Query<ListSessionsQuery>,
) -> std::result::Result<Json<Vec<ManagedSessionSummary>>, ApiError> {
    Ok(Json(
        manager
            .list_sessions_for_project(query.workspace_stats, query.project_id.as_deref())
            .await?,
    ))
}

#[utoipa::path(
    put,
    path = "/sessions/{session_id}/presentation",
    operation_id = "put_sessions_session_id_presentation",
    tag = "sessions",
    params(("session_id" = String, Path)),
    request_body(content = UpdateSessionPresentationRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = SessionSummarySnapshot, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
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

#[utoipa::path(
    put,
    path = "/sessions/order",
    operation_id = "put_sessions_order",
    tag = "sessions",
    request_body(content = ReorderSessionsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = ReorderSessionsResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
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

#[utoipa::path(
    post,
    path = "/sessions",
    operation_id = "post_sessions",
    tag = "sessions",
    request_body(content = CreateSessionRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = SessionFrontendSnapshot, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
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

#[utoipa::path(
    get,
    path = "/sessions/{session_id}",
    operation_id = "get_sessions_session_id",
    tag = "sessions",
    params(SessionSnapshotQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = SessionSnapshotResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn session_snapshot(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<SessionSnapshotQuery>,
) -> std::result::Result<Json<SessionSnapshotResponse>, ApiError> {
    let mut options = FrontendSnapshotLoadOptions::default();
    if let Some(limit) = query.thread_event_limit {
        options.thread_event_limit = limit.clamp(1, MAX_THREAD_EVENT_PAGE_LIMIT);
    }
    options.include_sessions = query.include_sessions.unwrap_or(true);
    if let Some(limit) = query.message_limit {
        options.messages = FrontendSnapshotMessages::Page(MessagePageRequest {
            before: None,
            limit: limit.clamp(1, MAX_MESSAGE_PAGE_LIMIT),
            include_system: query.include_system,
        });
    }

    let loaded = manager.snapshot_with_options(&session_id, options).await?;
    let lineage = manager.session_lineage(&session_id)?;
    Ok(Json(SessionSnapshotResponse {
        snapshot: loaded.snapshot,
        lineage,
        message_page: loaded.message_page.map(Into::into),
        message_cycle: loaded.message_cycle.map(Into::into),
    }))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/messages",
    operation_id = "get_sessions_session_id_messages",
    tag = "conversation",
    params(MessagesQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = MessagesPageResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn session_messages(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<MessagesQuery>,
) -> std::result::Result<Json<MessagesPageResponse>, ApiError> {
    let page = manager
        .messages_page(
            &session_id,
            MessagePageRequest {
                before: query.before,
                limit: query
                    .limit
                    .unwrap_or(DEFAULT_MESSAGE_PAGE_LIMIT)
                    .clamp(1, MAX_MESSAGE_PAGE_LIMIT),
                include_system: query.include_system,
            },
        )
        .await?;
    Ok(Json(page.into()))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/inbox",
    operation_id = "get_sessions_session_id_inbox",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<InboxItemResponse>, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_direct_inbox(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<InboxItemResponse>>, ApiError> {
    Ok(Json(
        manager
            .list_direct_inbox(&session_id)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/inbox",
    operation_id = "post_sessions_session_id_inbox",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = CreateInboxItemRequest, content_type = "application/json"),
    responses((status = 202, description = "Accepted", body = InboxItemResponse, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn create_direct_inbox_item(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CreateInboxItemRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<InboxItemResponse>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            manager
                .create_direct_inbox_item(&session_id, request)
                .await?
                .into(),
        ),
    ))
}

#[utoipa::path(
    patch,
    path = "/sessions/{session_id}/inbox/{item_id}",
    operation_id = "patch_sessions_session_id_inbox_item_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("item_id" = i64, Path)),
    request_body(content = UpdateInboxItemRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = InboxItemResponse, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn update_direct_inbox_item(
    State(manager): State<SessionManager>,
    AxumPath((session_id, item_id)): AxumPath<(String, i64)>,
    payload: std::result::Result<Json<UpdateInboxItemRequest>, JsonRejection>,
) -> std::result::Result<Json<InboxItemResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .update_direct_inbox_item(&session_id, item_id, request)
            .await?
            .into(),
    ))
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/inbox/{item_id}",
    operation_id = "delete_sessions_session_id_inbox_item_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("item_id" = i64, Path)),
    request_body(content = CancelInboxItemRequest, content_type = "application/json"),
    responses((status = 200, description = "Cancelled", body = InboxItemResponse, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn cancel_direct_inbox_item(
    State(manager): State<SessionManager>,
    AxumPath((session_id, item_id)): AxumPath<(String, i64)>,
    payload: std::result::Result<Json<CancelInboxItemRequest>, JsonRejection>,
) -> std::result::Result<Json<InboxItemResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .cancel_direct_inbox_item(&session_id, item_id, request)
            .await?
            .into(),
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/goal",
    operation_id = "get_sessions_session_id_goal",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Current goal or null", body = Option<SessionGoalRecord>, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn get_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Option<SessionGoalRecord>>, ApiError> {
    Ok(Json(manager.direct_goal(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/goal",
    operation_id = "post_sessions_session_id_goal",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = CreateGoalRequest, content_type = "application/json"),
    responses((status = 201, description = "Goal created", body = SessionGoalRecord, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn create_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CreateGoalRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<SessionGoalRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(manager.create_direct_goal(&session_id, request).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/sessions/{session_id}/goal/{goal_id}",
    operation_id = "patch_sessions_session_id_goal_goal_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("goal_id" = String, Path)),
    request_body(content = UpdateGoalRequest, content_type = "application/json"),
    responses((status = 200, description = "Goal updated", body = SessionGoalRecord, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn update_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath((session_id, goal_id)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<UpdateGoalRequest>, JsonRejection>,
) -> std::result::Result<Json<SessionGoalRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .update_direct_goal(&session_id, &goal_id, request)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/goal/{goal_id}",
    operation_id = "delete_sessions_session_id_goal_goal_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("goal_id" = String, Path)),
    request_body(content = ClearGoalRequest, content_type = "application/json"),
    responses((status = 204, description = "Goal cleared"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn clear_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath((session_id, goal_id)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<ClearGoalRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    manager
        .clear_direct_goal(&session_id, &goal_id, request.expected_version)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/children",
    operation_id = "get_sessions_session_id_children",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Traditional children", body = Vec<TraditionalChildRecord>, content_type = "application/json"), (status = 400, description = "Direct behavior required", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_traditional_children(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<TraditionalChildRecord>>, ApiError> {
    Ok(Json(manager.list_traditional_children(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/children",
    operation_id = "post_sessions_session_id_children",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = StartTraditionalChildRequest, content_type = "application/json"),
    responses((status = 201, description = "Child created, continued, or steered", body = TraditionalChildRecord, content_type = "application/json"), (status = 400, description = "Invalid child request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Child concurrency or run conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn start_traditional_child(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<StartTraditionalChildRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<TraditionalChildRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(
            manager
                .start_traditional_child(&session_id, request)
                .await?,
        ),
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/children/{child_session_id}",
    operation_id = "get_sessions_session_id_children_child_session_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("child_session_id" = String, Path)),
    responses((status = 200, description = "Traditional child status", body = TraditionalChildRecord, content_type = "application/json"), (status = 404, description = "Child not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn get_traditional_child(
    State(manager): State<SessionManager>,
    AxumPath((session_id, child_session_id)): AxumPath<(String, String)>,
) -> std::result::Result<Json<TraditionalChildRecord>, ApiError> {
    Ok(Json(
        manager.traditional_child(&session_id, &child_session_id)?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/children/{child_session_id}/cancel",
    operation_id = "post_sessions_session_id_children_child_session_id_cancel",
    tag = "conversation",
    params(("session_id" = String, Path), ("child_session_id" = String, Path)),
    responses((status = 200, description = "Traditional child cancelled", body = TraditionalChildRecord, content_type = "application/json"), (status = 404, description = "Child not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Child run is remote or unavailable", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn cancel_traditional_child(
    State(manager): State<SessionManager>,
    AxumPath((session_id, child_session_id)): AxumPath<(String, String)>,
) -> std::result::Result<Json<TraditionalChildRecord>, ApiError> {
    Ok(Json(
        manager
            .cancel_traditional_child(&session_id, &child_session_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/orchestrators",
    operation_id = "get_sessions_session_id_orchestrators",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Managed orchestrators", body = Vec<ManagedOrchestratorRecord>, content_type = "application/json"), (status = 400, description = "Direct-with-orchestrator behavior required", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn list_managed_orchestrators(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<ManagedOrchestratorRecord>>, ApiError> {
    Ok(Json(manager.list_managed_orchestrators(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/orchestrators",
    operation_id = "post_sessions_session_id_orchestrators",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = StartManagedOrchestratorRequest, content_type = "application/json"),
    responses((status = 201, description = "Orchestrator created, continued, or steered", body = ManagedOrchestratorRecord, content_type = "application/json"), (status = 400, description = "Invalid orchestrator request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Orchestrator concurrency or run conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn start_managed_orchestrator(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<StartManagedOrchestratorRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<ManagedOrchestratorRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(
            manager
                .start_managed_orchestrator(&session_id, request)
                .await?,
        ),
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/orchestrators/{orchestrator_session_id}",
    operation_id = "get_sessions_session_id_orchestrators_orchestrator_session_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("orchestrator_session_id" = String, Path)),
    responses((status = 200, description = "Managed orchestrator status", body = ManagedOrchestratorRecord, content_type = "application/json"), (status = 404, description = "Orchestrator not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn get_managed_orchestrator(
    State(manager): State<SessionManager>,
    AxumPath((session_id, orchestrator_session_id)): AxumPath<(String, String)>,
) -> std::result::Result<Json<ManagedOrchestratorRecord>, ApiError> {
    Ok(Json(manager.managed_orchestrator(
        &session_id,
        &orchestrator_session_id,
    )?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/orchestrators/{orchestrator_session_id}/cancel",
    operation_id = "post_sessions_session_id_orchestrators_orchestrator_session_id_cancel",
    tag = "conversation",
    params(("session_id" = String, Path), ("orchestrator_session_id" = String, Path)),
    responses((status = 200, description = "Managed orchestrator cancelled", body = ManagedOrchestratorRecord, content_type = "application/json"), (status = 404, description = "Orchestrator not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Orchestrator run unavailable", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn cancel_managed_orchestrator(
    State(manager): State<SessionManager>,
    AxumPath((session_id, orchestrator_session_id)): AxumPath<(String, String)>,
) -> std::result::Result<Json<ManagedOrchestratorRecord>, ApiError> {
    Ok(Json(
        manager
            .cancel_managed_orchestrator(&session_id, &orchestrator_session_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/permissions",
    operation_id = "get_sessions_session_id_permissions",
    tag = "permissions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = PermissionStateResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn permission_state(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<PermissionStateResponse>, ApiError> {
    Ok(Json(manager.permission_state(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/permissions/{request_id}",
    operation_id = "post_sessions_session_id_permissions_request_id",
    tag = "permissions",
    params(("session_id" = String, Path), ("request_id" = String, Path)),
    request_body(content = ReplyPermissionRequest, content_type = "application/json"),
    responses((status = 204, description = "Permission request answered"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn reply_permission_request(
    State(manager): State<SessionManager>,
    AxumPath((session_id, request_id)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<ReplyPermissionRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    manager
        .reply_permission_request(&session_id, &request_id, request.reply)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/permissions/grants/{grant_id}",
    operation_id = "delete_sessions_session_id_permissions_grants_grant_id",
    tag = "permissions",
    params(("session_id" = String, Path), ("grant_id" = String, Path)),
    responses((status = 204, description = "Remembered grant removed"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_permission_grant(
    State(manager): State<SessionManager>,
    AxumPath((session_id, grant_id)): AxumPath<(String, String)>,
) -> std::result::Result<StatusCode, ApiError> {
    manager
        .delete_permission_grant(&session_id, &grant_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/threads/{thread_name}/events",
    operation_id = "get_sessions_session_id_threads_thread_name_events",
    tag = "conversation",
    params(ThreadEventsQuery, ("session_id" = String, Path), ("thread_name" = String, Path)),
    responses((status = 200, description = "Success", body = ThreadEventPage, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn thread_events(
    State(manager): State<SessionManager>,
    AxumPath((session_id, thread_name)): AxumPath<(String, String)>,
    Query(query): Query<ThreadEventsQuery>,
) -> std::result::Result<Json<ThreadEventPage>, ApiError> {
    Ok(Json(
        manager
            .thread_events(
                &session_id,
                &thread_name,
                query.before_id,
                query
                    .limit
                    .unwrap_or(DEFAULT_THREAD_EVENT_PAGE_LIMIT)
                    .clamp(1, MAX_THREAD_EVENT_PAGE_LIMIT),
            )
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/diff",
    operation_id = "get_sessions_session_id_workspace_diff",
    tag = "workspace",
    params(WorkspaceDiffQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceFileDiff, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn workspace_diff(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceDiffQuery>,
) -> std::result::Result<Json<view::WorkspaceFileDiff>, ApiError> {
    Ok(Json(manager.workspace_file_diff(&session_id, query).await?))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/files",
    operation_id = "get_sessions_session_id_workspace_files",
    tag = "workspace",
    params(WorkspaceRevisionQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceFileList, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn workspace_files(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceRevisionQuery>,
) -> std::result::Result<Json<view::WorkspaceFileList>, ApiError> {
    Ok(Json(
        manager.workspace_files(&session_id, query.revision).await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/file",
    operation_id = "get_sessions_session_id_workspace_file",
    tag = "workspace",
    params(WorkspaceFileQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceFileContent, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn workspace_file(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceFileQuery>,
) -> std::result::Result<Json<view::WorkspaceFileContent>, ApiError> {
    Ok(Json(
        manager
            .workspace_file(&session_id, query.path, query.revision)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/workspace/open",
    operation_id = "post_sessions_session_id_workspace_open",
    tag = "workspace",
    params(("session_id" = String, Path)),
    request_body(content = OpenWorkspacePathRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = view::OpenLocalPathResult, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 501, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn open_workspace_path(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<OpenWorkspacePathRequest>, JsonRejection>,
) -> std::result::Result<Json<view::OpenLocalPathResult>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .open_workspace_path(&session_id, request.path)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/revisions",
    operation_id = "get_sessions_session_id_workspace_revisions",
    tag = "workspace",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<view::WorkspaceRevisionRecord>, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn workspace_revisions(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<view::WorkspaceRevisionRecord>>, ApiError> {
    Ok(Json(manager.workspace_revisions(&session_id)?))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/revisions/{revision_id}/changes",
    operation_id = "get_sessions_session_id_workspace_revisions_revision_id_changes",
    tag = "workspace",
    params(("session_id" = String, Path), ("revision_id" = i64, Path)),
    responses((status = 200, description = "Success", body = view::WorkspaceRevisionChanges, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn workspace_revision_changes(
    State(manager): State<SessionManager>,
    AxumPath((session_id, revision_id)): AxumPath<(String, i64)>,
) -> std::result::Result<Json<view::WorkspaceRevisionChanges>, ApiError> {
    Ok(Json(
        manager
            .workspace_revision_changes(&session_id, revision_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/workspace/branches",
    operation_id = "get_sessions_session_id_workspace_branches",
    tag = "workspace",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = workspace::BranchList, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn workspace_branches(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<workspace::BranchList>, ApiError> {
    Ok(Json(manager.workspace_branches(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/workspace/branches",
    operation_id = "post_sessions_session_id_workspace_branches",
    tag = "workspace",
    params(("session_id" = String, Path)),
    request_body(content = SwitchBranchRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = workspace::BranchList, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn switch_workspace_branch(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<SwitchBranchRequest>, JsonRejection>,
) -> std::result::Result<Json<workspace::BranchList>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .switch_workspace_branch(&session_id, request)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/workspace/commit",
    operation_id = "post_sessions_session_id_workspace_commit",
    tag = "workspace",
    params(("session_id" = String, Path)),
    request_body(content = CommitWorkspaceRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = workspace::CommitOutcome, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn commit_workspace(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CommitWorkspaceRequest>, JsonRejection>,
) -> std::result::Result<Json<workspace::CommitOutcome>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.commit_workspace(&session_id, request).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/runs",
    operation_id = "post_sessions_session_id_runs",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = SubmitPromptRequest, content_type = "application/json"),
    responses((status = 202, description = "Success", body = SubmitPromptResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 413, description = "Request body too large", body = String, content_type = "text/plain"), (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"), (status = 422, description = "JSON body validation failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 501, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
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

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/steering",
    operation_id = "post_sessions_session_id_steering",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = OrchestratorSteeringRequest, content_type = "application/json"),
    responses((status = 202, description = "Success", body = OrchestratorSteeringResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn queue_orchestrator_steering_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<OrchestratorSteeringRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<OrchestratorSteeringResponse>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    validate_steering_instruction(&request.instruction)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            manager
                .queue_orchestrator_steering(&session_id, request)
                .await?,
        ),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/threads/{thread_name}/steering",
    operation_id = "post_sessions_session_id_threads_thread_name_steering",
    tag = "conversation",
    params(("session_id" = String, Path), ("thread_name" = String, Path)),
    request_body(content = ThreadSteeringRequest, content_type = "application/json"),
    responses((status = 202, description = "Success", body = ThreadSteeringResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn queue_thread_steering_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, thread_name)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<ThreadSteeringRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<ThreadSteeringResponse>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    validate_steering_instruction(&request.instruction)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            manager
                .queue_thread_steering(&session_id, &thread_name, request)
                .await?,
        ),
    ))
}

fn event_cursor(
    query: &EventsQuery,
) -> std::result::Result<Option<SessionEventBoundary>, ApiError> {
    match (&query.after_epoch_id, query.after_sequence_id) {
        (None, None) => Ok(None),
        (Some(epoch_id), Some(sequence_id)) => Ok(Some(SessionEventBoundary {
            epoch_id: epoch_id.clone(),
            sequence_id,
        })),
        _ => Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "after_epoch_id and after_sequence_id must be supplied together".to_string(),
        }),
    }
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/events",
    operation_id = "get_sessions_session_id_events",
    tag = "events",
    params(EventsQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = RecentEventsResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn recent_events(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<EventsQuery>,
) -> std::result::Result<Json<RecentEventsResponse>, ApiError> {
    let cursor = event_cursor(&query)?;
    let (boundary, events) = manager
        .recent_events(
            &session_id,
            cursor.as_ref(),
            query.limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
        )
        .await?;
    Ok(Json(RecentEventsResponse { boundary, events }))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/events/stream",
    operation_id = "get_sessions_session_id_events_stream",
    tag = "events",
    params(EventsQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Server-sent events. Event names and JSON data schemas: replay_boundary (ReplayBoundaryEvent), replay_gap (ReplayGapEvent), session_event (SessionEventEnvelope), assistant_delta (AssistantStreamDelta), and lagged (LaggedEvent). Only session_event carries an SSE id. This response is never gzip-compressed.", body = String, content_type = "text/event-stream"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn stream_events(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<EventsQuery>,
) -> std::result::Result<
    Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>>,
    ApiError,
> {
    let cursor = event_cursor(&query)?;
    let (
        epoch_id,
        replay_boundary_sequence_id,
        replay_gap,
        replayed_events,
        receiver,
        assistant_deltas,
    ) = manager
        .subscribe_events(
            &session_id,
            cursor.as_ref(),
            query.limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
        )
        .await?;
    let event_stream = session_event_stream(
        epoch_id,
        replay_boundary_sequence_id,
        replay_gap,
        replayed_events,
        receiver,
        assistant_deltas,
    );

    Ok(Sse::new(event_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/cancel-active-run",
    operation_id = "post_sessions_session_id_cancel_active_run",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 202, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 501, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn cancel_active_run(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.cancel_active_run(&session_id).await?;
    Ok(StatusCode::ACCEPTED)
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}",
    operation_id = "delete_sessions_session_id",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn delete_session_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.delete_session(&session_id).await?;
    Ok(StatusCode::OK)
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/skills",
    operation_id = "get_sessions_session_id_skills",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<nac_core::skill_catalog::SkillCatalogEntry>, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn session_skills_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<nac_core::skill_catalog::SkillCatalogEntry>>, ApiError> {
    Ok(Json(manager.session_skills(&session_id).await?))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/config",
    operation_id = "get_sessions_session_id_config",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = sessions::RawSessionConfig, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
async fn session_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<sessions::RawSessionConfig>, ApiError> {
    Ok(Json(manager.session_config(&session_id)?))
}

#[utoipa::path(
    patch,
    path = "/sessions/{session_id}/config",
    operation_id = "patch_sessions_session_id_config",
    tag = "sessions",
    params(("session_id" = String, Path)),
    request_body(content = UpdateConfigRequest, content_type = "application/json"),
    responses((status = 200, description = "Success with no response body"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
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

fn validate_steering_instruction(
    instruction: &str,
) -> std::result::Result<(), RequestConfigurationError> {
    if instruction.trim().is_empty() {
        return Err(RequestConfigurationError(
            "steering instruction must not be empty or whitespace-only".to_string(),
        ));
    }
    Ok(())
}

fn request_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(RequestConfigurationError(message.into()))
}

/// Render a failing configuration error at the HTTP boundary. This is the
/// single place the full `{:#}` cause chain is rendered; inner layers keep
/// their chains intact under plain `.context(...)` messages, so the cause
/// appears exactly once.
fn request_configuration_error_from(error: anyhow::Error) -> anyhow::Error {
    request_configuration_error(format!("{error:#}"))
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

fn validated_compaction_threshold(threshold: u64) -> Result<u64> {
    if threshold > nac_core::MAX_SUPPORTED_TOKEN_COUNT {
        return Err(request_configuration_error(format!(
            "invalid orchestrator compaction threshold: must not exceed {} tokens",
            nac_core::MAX_SUPPORTED_TOKEN_COUNT
        )));
    }
    Ok(threshold)
}

fn create_compaction_threshold_override(field: RequestField<u64>) -> Result<Option<u64>> {
    match field {
        RequestField::Omitted => Ok(None),
        RequestField::Null => Ok(Some(0)),
        RequestField::Value(threshold) => validated_compaction_threshold(threshold).map(Some),
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
        light_model: None,
    })
}

/// Reject a credential destination that only the HTTP request asked for.
///
/// `config.toml` is hand-edited and therefore authoritative; a request body
/// reaching the unauthenticated loopback API is not, so it may only name a
/// known provider origin, a local address, or a pre-approved host.
fn enforce_trusted_base_url(
    backend: Option<BackendKind>,
    base_url: Option<&str>,
    policy: &CredentialDestinationPolicy,
) -> Result<()> {
    let (Some(backend), Some(base_url)) = (backend, base_url) else {
        return Ok(());
    };
    if policy.configured_base_url.as_deref() == Some(base_url) {
        return Ok(());
    }
    validate_caller_supplied_base_url(backend, base_url, &policy.trusted_hosts)
}

fn apply_raw_config_patch(
    config: &mut sessions::RawSessionConfig,
    request: UpdateConfigRequest,
) -> Result<()> {
    match request.model {
        RequestField::Omitted => {}
        RequestField::Null => {
            return Err(request_configuration_error(
                "invalid model configuration: required field 'model' cannot be null",
            ));
        }
        RequestField::Value(value) => config.model = nonblank_request_string(value, "model")?,
    }
    match request.base_url {
        RequestField::Omitted => {}
        RequestField::Null => {
            return Err(request_configuration_error(
                "invalid model configuration: required field 'base_url' cannot be null",
            ));
        }
        RequestField::Value(value) => {
            config.base_url = nonblank_request_string(value, "base_url")?;
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
            config.backend = Some(nonblank_request_string(value, "backend")?);
        }
    }
    match request.reasoning_effort {
        RequestField::Omitted => {}
        RequestField::Null => config.reasoning_effort = None,
        RequestField::Value(value) => {
            config.reasoning_effort = Some(nonblank_request_string(value, "reasoning_effort")?);
        }
    }
    match request.api_key_env {
        RequestField::Omitted => {}
        RequestField::Null => config.api_key_env = None,
        RequestField::Value(value) => config.api_key_env = Some(value),
    }
    match request.extra_headers {
        RequestField::Omitted => {}
        RequestField::Null => config.extra_headers_json = None,
        RequestField::Value(HeadersRequest(headers)) => {
            config.extra_headers_json = if headers.is_empty() {
                None
            } else {
                Some(serde_json::to_string(&headers).map_err(|error| {
                    request_configuration_error(format!(
                        "invalid model configuration: failed to serialize extra_headers: {error}"
                    ))
                })?)
            };
        }
    }
    match request.orchestrator_compaction_threshold {
        RequestField::Omitted => {}
        RequestField::Null => config.orchestrator_compaction_threshold = None,
        RequestField::Value(threshold) => {
            let threshold = validated_compaction_threshold(threshold)?;
            config.orchestrator_compaction_threshold = (threshold != 0).then_some(threshold);
        }
    }
    config.diagnostics.clear();
    Ok(())
}

fn parse_prospective_model_config(
    config: &mut sessions::RawSessionConfig,
    backend_selected: bool,
    base_url_omitted: bool,
    api_key_env_omitted: bool,
) -> Result<(
    BackendKind,
    Option<ReasoningEffort>,
    BTreeMap<String, String>,
)> {
    nonblank_request_string(config.model.clone(), "model")?;
    let backend_raw = config.backend.as_deref().ok_or_else(|| {
        request_configuration_error(
            "invalid model configuration: required field 'backend' is missing; explicitly select a backend",
        )
    })?;
    let backend_raw = nonblank_request_string(backend_raw.to_string(), "backend")?;
    let backend = parse_request_enum::<BackendKind>(&backend_raw, "backend")?;
    let managed_base_url = managed_backend_base_url(backend);
    // Selecting a managed backend is a tuple-level operation: omitted fields
    // select its canonical endpoint and stored credential mode rather than
    // inheriting an unrelated API-key backend's values. Concrete request values
    // remain authoritative and proceed to normal validation.
    let use_managed_base_url = managed_base_url.is_some()
        && ((backend_selected && base_url_omitted) || config.base_url.trim().is_empty());
    let stored_base_url = if use_managed_base_url {
        None
    } else {
        Some(config.base_url.clone())
    };
    config.base_url = resolve_model_base_url(backend, stored_base_url)?;
    if managed_base_url.is_some() && api_key_env_omitted {
        config.api_key_env = None;
    }
    let reasoning_effort = config
        .reasoning_effort
        .as_deref()
        .map(|raw| {
            let raw = nonblank_request_string(raw.to_string(), "reasoning_effort")?;
            parse_request_enum::<ReasoningEffort>(&raw, "reasoning_effort")
        })
        .transpose()?;
    let extra_headers = config
        .extra_headers_json
        .as_deref()
        .filter(|raw| !raw.is_empty())
        .map(|raw| {
            serde_json::from_str::<BTreeMap<String, String>>(raw).map_err(|error| {
                request_configuration_error(format!(
                    "invalid model configuration: stored extra_headers must be replaced or cleared: {error}"
                ))
            })
        })
        .transpose()?
        .unwrap_or_default();
    Ok((backend, reasoning_effort, extra_headers))
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
        internal_mounts: Vec::new(),
        sandbox_image: request.image,
        sandbox_gpus: request.gpus,
        sandbox_shm_size: request.shm_size,
        sandbox_session_key: request.session_key,
        sandbox_workdir: request.workdir,
        sandbox_backend: request.backend,
        sandbox_cpus: request.cpus,
        sandbox_mem: request.memory_mib,
        sandbox_activity_key: request.activity_key,
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

fn frontend_command_name(command: SlashCommand) -> &'static str {
    command.definition().name
}

fn session_event_stream(
    epoch_id: String,
    replay_boundary_sequence_id: u64,
    replay_gap: Option<SessionReplayGap>,
    replayed_events: Vec<SessionEventEnvelope>,
    mut receiver: SessionEventReceiver,
    mut assistant_deltas: AssistantStreamDeltaReceiver,
) -> impl futures_core::Stream<Item = std::result::Result<Event, Infallible>> {
    let mut replayed_events = VecDeque::from(replayed_events);
    stream! {
        yield Ok(sse_json_event(
            "replay_boundary",
            None,
            &ReplayBoundaryEvent {
                epoch_id,
                replay_boundary_sequence_id,
            },
        ));

        if let Some(replay_gap) = replay_gap {
            yield Ok(sse_json_event("replay_gap", None, &ReplayGapEvent { replay_gap }));
        }

        while let Some(envelope) = replayed_events.pop_front() {
            yield Ok(sse_envelope_event(&envelope));
        }

        // Deltas share the connection but not the sequence: they carry no SSE
        // id, so a reconnect still resumes from the last session event.
        let mut deltas_open = true;
        loop {
            let next = tokio::select! {
                envelope = receiver.recv() => StreamItem::Session(envelope),
                delta = assistant_deltas.recv(), if deltas_open => StreamItem::Delta(delta),
            };
            match next {
                StreamItem::Session(Ok(envelope)) => yield Ok(sse_envelope_event(&envelope)),
                StreamItem::Session(Err(tokio::sync::broadcast::error::RecvError::Lagged(missed))) => {
                    yield Ok(sse_json_event("lagged", None, &LaggedEvent { missed }));
                }
                StreamItem::Session(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                StreamItem::Delta(Ok(delta)) => {
                    yield Ok(sse_json_event("assistant_delta", None, &delta));
                }
                // Falling behind on deltas costs the client nothing it will not
                // get again from the assistant message.
                StreamItem::Delta(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {}
                StreamItem::Delta(Err(tokio::sync::broadcast::error::RecvError::Closed)) => {
                    deltas_open = false;
                }
            }
        }
    }
}

/// Whichever of the two channels behind the event stream woke up first.
enum StreamItem {
    Session(std::result::Result<SessionEventEnvelope, tokio::sync::broadcast::error::RecvError>),
    Delta(std::result::Result<AssistantStreamDelta, tokio::sync::broadcast::error::RecvError>),
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
        let _ = error;
        serde_json::json!({ "error": "failed to serialize SSE payload" }).to_string()
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

impl ApiError {
    pub(crate) fn new(status: StatusCode, message: String) -> Self {
        Self { status, message }
    }

    pub(crate) fn bad_request(message: String) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
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

impl From<ModelConfigurationStoreError> for ApiError {
    fn from(error: ModelConfigurationStoreError) -> Self {
        let status = match &error {
            ModelConfigurationStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            ModelConfigurationStoreError::DuplicateName(_)
            | ModelConfigurationStoreError::InUse(_) => StatusCode::CONFLICT,
            ModelConfigurationStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            ModelConfigurationStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<ProjectStoreError> for ApiError {
    fn from(error: ProjectStoreError) -> Self {
        let status = match &error {
            ProjectStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            ProjectStoreError::DuplicateLocation | ProjectStoreError::Conflict(_) => {
                StatusCode::CONFLICT
            }
            ProjectStoreError::NotFound(_) | ProjectStoreError::ModelConfigurationNotFound(_) => {
                StatusCode::NOT_FOUND
            }
            ProjectStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<application::projects::ProjectApplicationError> for ApiError {
    fn from(error: application::projects::ProjectApplicationError) -> Self {
        match error {
            application::projects::ProjectApplicationError::InvalidInput(message) => {
                Self::bad_request(message)
            }
            application::projects::ProjectApplicationError::Project(error) => error.into(),
            application::projects::ProjectApplicationError::LocalBrowse(error) => error.into(),
            application::projects::ProjectApplicationError::RemoteBrowse(error) => error.into(),
            application::projects::ProjectApplicationError::Session(error) => error.into(),
        }
    }
}

impl From<SshConfigurationStoreError> for ApiError {
    fn from(error: SshConfigurationStoreError) -> Self {
        let status = match &error {
            SshConfigurationStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            SshConfigurationStoreError::DuplicateName(_) => StatusCode::CONFLICT,
            SshConfigurationStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            SshConfigurationStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<filesystem::BrowseError> for ApiError {
    fn from(error: filesystem::BrowseError) -> Self {
        let status = match &error {
            filesystem::BrowseError::NotFound(_) => StatusCode::NOT_FOUND,
            filesystem::BrowseError::NotADirectory(_) => StatusCode::BAD_REQUEST,
            filesystem::BrowseError::Unreadable { .. } => StatusCode::FORBIDDEN,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<runtime::RemoteBrowseError> for ApiError {
    fn from(error: runtime::RemoteBrowseError) -> Self {
        let status = match &error {
            runtime::RemoteBrowseError::Invalid(_) => StatusCode::BAD_REQUEST,
            runtime::RemoteBrowseError::NotFound(_) => StatusCode::NOT_FOUND,
            runtime::RemoteBrowseError::NotADirectory(_) => StatusCode::BAD_REQUEST,
            runtime::RemoteBrowseError::Unreadable { .. } => StatusCode::FORBIDDEN,
            // The host, not this server, is what failed, and the caller can
            // retry once it is fixed.
            runtime::RemoteBrowseError::Unreachable { .. }
            | runtime::RemoteBrowseError::Remote(_) => StatusCode::BAD_GATEWAY,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<RequestConfigurationError> for ApiError {
    fn from(error: RequestConfigurationError) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
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
        } else if let Some(error) = error.downcast_ref::<SessionSubmitError>() {
            match error {
                SessionSubmitError::Busy { .. } | SessionSubmitError::ExternalBusy { .. } => {
                    StatusCode::CONFLICT
                }
                SessionSubmitError::Coordination {
                    message:
                        SessionCoordinationError::StaleConfiguration { .. }
                        | SessionCoordinationError::LocalAgentBusy,
                } => StatusCode::CONFLICT,
                SessionSubmitError::Coordination { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            }
        } else if let Some(error) = error.downcast_ref::<sessions::SessionOperationLeaseError>() {
            match error {
                sessions::SessionOperationLeaseError::Busy(_) => StatusCode::CONFLICT,
                sessions::SessionOperationLeaseError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
            }
        } else if error.downcast_ref::<ModelConfigurationError>().is_some()
            || error.downcast_ref::<RequestConfigurationError>().is_some()
            || message.contains("invalid model configuration")
        {
            StatusCode::BAD_REQUEST
        } else if message.contains("was not found")
            || message.contains("not found")
            || message.contains("has no goal")
            || message.contains("unknown host")
        {
            StatusCode::NOT_FOUND
        } else if message.contains("busy")
            || message.contains("uncommitted changes")
            || message.contains("no active run")
            || message.contains("not active")
            || message.contains("active run is finishing")
            || message.contains("version conflict")
            || message.contains("no longer pending")
            || message.contains("no longer current")
            || message.contains("unfinished goal")
            || message.contains("goal clear conflict")
            || message.contains("child concurrency limit")
            || message.contains("managed orchestrator concurrency limit")
            || message.contains("delegated sessions accept")
            || message.contains("already has running generation")
            || message.contains("already has a running generation")
            || message.contains("running in another process")
        {
            StatusCode::CONFLICT
        } else if message.contains("not supported")
            || message.contains("cancellation is not supported")
        {
            StatusCode::NOT_IMPLEMENTED
        } else if message.contains("invalid")
            || message.contains("prompt is empty")
            || message.contains("goal objective is empty")
            || message.contains("goal token budget")
            || message.contains("traditional child prompt is empty")
            || message.contains("traditional child profile")
            || message.contains("traditional child nesting limit")
            || message.contains("managed orchestrator prompt is empty")
            || message.contains("managed orchestrators require direct-with-orchestrator")
            || message.contains("managed orchestrator description")
            || message.contains("managed orchestrator sessions cannot launch")
            || message.contains("host-backed shared workspace")
            || message.contains("frontend command")
            || message.contains("traditional child sessions cannot own autonomous goals")
            || message.contains("only for direct behaviors")
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
            Json(ApiErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
