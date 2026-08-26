mod compaction;
mod filesystem;
mod light_model;
mod managed_auth;
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
    workspace_diff_cache: RwLock<HashMap<GitTargetKey, WorkspaceDiffCacheEntry>>,
    git_probe_cache: RwLock<HashMap<GitTargetKey, GitProbeCacheEntry>>,
    managed_logins: managed_auth::ManagedLoginRegistry,
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

        let manager = Self {
            inner: Arc::new(SessionManagerInner {
                root_cwd,
                store_path: store_path.clone(),
                worker_executable,
                active_sessions: RwLock::new(HashMap::new()),

                lifecycle_gates: StdMutex::new(HashMap::new()),
                workspace_diff_cache: RwLock::new(HashMap::new()),
                git_probe_cache: RwLock::new(HashMap::new()),
                managed_logins: managed_auth::ManagedLoginRegistry::default(),
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

    /// Lists a directory on an SSH host, in the same shape as a local listing so
    /// the picker navigates both the same way.
    ///
    /// Succeeding is also the evidence the launch form needs that the host, the
    /// port and the key work together, and the connection it opens is reused by
    /// the session created next.
    pub async fn create_project(
        &self,
        request: CreateProjectRequest,
    ) -> std::result::Result<ProjectRecord, ApiError> {
        let requested_cwd = request.cwd.as_os_str().to_string_lossy().trim().to_string();
        if requested_cwd.is_empty() {
            return Err(ApiError::bad_request(
                "project cwd must not be empty or whitespace-only".to_string(),
            ));
        }

        let ssh = SshRequest {
            host: request.ssh_host,
            port: request.ssh_port,
            identity_file: request.ssh_identity_file,
        }
        .into_options();
        let host = ssh.host();
        let (cwd, ssh_host, ssh_port, ssh_identity_file) = if host.is_some() {
            let listing = runtime::browse_ssh_directory(
                &ssh,
                Some(&requested_cwd),
                false,
                &self.inner.root_cwd,
            )
            .await?;
            let connection = ssh
                .resolved_connection(&self.inner.root_cwd)
                .expect("normalized SSH host must produce a connection");
            (
                PathBuf::from(listing.path),
                Some(connection.host),
                connection.port,
                connection
                    .identity_file
                    .map(|path| path.to_string_lossy().into_owned()),
            )
        } else {
            if ssh.port.is_some() || ssh.identity_file.is_some() {
                return Err(ApiError::bad_request(
                    "an ssh port or private key needs an ssh host as well".to_string(),
                ));
            }
            let listing = filesystem::browse(
                &BrowseQuery {
                    path: Some(requested_cwd),
                    kind: BrowseKind::Directory,
                    hidden: false,
                },
                &self.inner.root_cwd,
            )?;
            (PathBuf::from(listing.path), None, None, None)
        };

        // A local checkout is named after its origin remote (`owner/repo`),
        // which reads better than the bare folder the store would fall back to.
        let name = request.name.or_else(|| {
            ssh_host
                .is_none()
                .then(|| view::local_repo_label(&cwd))
                .flatten()
        });

        Ok(projects::insert_project(
            &self.inner.store_path,
            projects::NewProject {
                project_id: uuid::Uuid::new_v4().to_string(),
                name,
                description: request.description,
                cwd,
                ssh_host,
                ssh_port,
                ssh_identity_file,
                default_model_config_id: request.default_model_config_id,
            },
        )?)
    }

    pub fn update_project(
        &self,
        project_id: &str,
        request: UpdateProjectRequest,
    ) -> std::result::Result<ProjectRecord, ProjectStoreError> {
        let name = match request.name {
            RequestField::Omitted => None,
            RequestField::Null => {
                return Err(ProjectStoreError::InvalidInput(
                    "project name cannot be null".to_string(),
                ))
            }
            RequestField::Value(name) => Some(name),
        };
        let pinned = match request.pinned {
            RequestField::Omitted => None,
            RequestField::Null => {
                return Err(ProjectStoreError::InvalidInput(
                    "project pinned cannot be null".to_string(),
                ))
            }
            RequestField::Value(pinned) => Some(pinned),
        };
        projects::update_project(
            &self.inner.store_path,
            project_id,
            projects::ProjectPatch {
                name,
                description: request_field_patch(request.description),
                default_model_config_id: request_field_patch(request.default_model_config_id),
                pinned,
            },
        )
    }

    /// Drops the project and hands its sessions back as unassigned.
    pub fn delete_project(
        &self,
        project_id: &str,
    ) -> std::result::Result<Vec<String>, ProjectStoreError> {
        projects::delete_project(&self.inner.store_path, project_id)
    }

    /// Drops the project along with every chat in it.
    ///
    /// The chats go first: membership is recorded against the project row, so
    /// once that is gone there is nothing left saying which sessions were its.
    /// A chat that refuses to be deleted — one mid-run that will not cancel —
    /// leaves the project standing rather than orphaning the rest.
    pub async fn delete_project_with_sessions(&self, project_id: &str) -> Result<Vec<String>> {
        let session_ids: Vec<String> = sessions::list_sessions(&self.inner.store_path)?
            .into_iter()
            .filter(|summary| summary.project_id.as_deref() == Some(project_id))
            .map(|summary| summary.session_id)
            .collect();
        for session_id in &session_ids {
            let still_exists = sessions::list_sessions(&self.inner.store_path)?
                .into_iter()
                .any(|summary| summary.session_id == *session_id);
            if !still_exists {
                // Deleting an earlier parent recursively deletes its delegated
                // sessions. The original project snapshot still contains those
                // ids, so treat their absence as successful cascade settlement.
                continue;
            }
            if let Err(error) = self.delete_session(session_id).await {
                let still_exists = sessions::list_sessions(&self.inner.store_path)?
                    .into_iter()
                    .any(|summary| summary.session_id == *session_id);
                if still_exists {
                    return Err(error);
                }
            }
        }
        self.delete_project(project_id)?;
        Ok(session_ids)
    }

    pub fn assign_session_to_project(
        &self,
        project_id: &str,
        session_id: &str,
    ) -> std::result::Result<ProjectRecord, ProjectStoreError> {
        projects::assign_session_to_project(&self.inner.store_path, project_id, session_id)
    }

    pub fn reorder_projects(
        &self,
        pinned: bool,
        project_ids: &[String],
        expected_versions: &BTreeMap<String, i64>,
    ) -> std::result::Result<Vec<ProjectRecord>, ProjectStoreError> {
        projects::reorder_projects(
            &self.inner.store_path,
            pinned,
            project_ids,
            expected_versions,
        )
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
        let run_config = runtime::build_run_config_for_project_with_behavior(
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
        let run_config = if let Some(operation_lease) = operation_lease {
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
        let (run_config, cacheable, operation_lease) =
            runtime::build_resume_config_for_session_attachment(
                self.inner.store_path.clone(),
                session_id,
                &config,
                self.inner.root_cwd.clone(),
                Some(self.inner.worker_executable.clone()),
            )
            .await?;
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
    axum::serve(listener, router(manager))
        .await
        .context("server stopped unexpectedly")
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
        projects: projects::list_projects(&manager.inner.store_path)?,
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
    Ok((
        StatusCode::CREATED,
        Json(manager.create_project(request).await?),
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
    Ok(Json(manager.update_project(&project_id, request)?))
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
    Ok(Json(match query.sessions {
        DeleteProjectSessions::Keep => DeleteProjectResponse {
            released_session_ids: manager.delete_project(&project_id)?,
            deleted_session_ids: Vec::new(),
        },
        DeleteProjectSessions::Delete => DeleteProjectResponse {
            released_session_ids: Vec::new(),
            deleted_session_ids: manager.delete_project_with_sessions(&project_id).await?,
        },
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
    Ok(Json(manager.assign_session_to_project(
        &project_id,
        &request.session_id,
    )?))
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
    let projects = manager.reorder_projects(
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
mod tests {
    use super::*;
    use std::io::Read;

    use axum::{
        body::{to_bytes, Body, Bytes},
        http::Request,
    };
    use flate2::read::GzDecoder;
    use tower::ServiceExt;

    const EXPECTED_OPENAPI_OPERATIONS: &[(&str, &str)] = &[
        ("DELETE", "/auth/{provider}"),
        ("DELETE", "/auth/{provider}/login/{login_id}"),
        ("DELETE", "/credentials/{name}"),
        ("DELETE", "/mcp_library/servers/{server_name}"),
        ("DELETE", "/model-configs/{config_id}"),
        ("DELETE", "/projects/{project_id}"),
        ("DELETE", "/sessions/{session_id}"),
        ("DELETE", "/sessions/{session_id}/goal/{goal_id}"),
        ("DELETE", "/sessions/{session_id}/inbox/{item_id}"),
        (
            "DELETE",
            "/sessions/{session_id}/permissions/grants/{grant_id}",
        ),
        ("DELETE", "/ssh-configs/{config_id}"),
        ("GET", "/auth"),
        ("GET", "/auth/{provider}/login/{login_id}"),
        ("GET", "/commands"),
        ("GET", "/credentials"),
        ("GET", "/fs/browse"),
        ("GET", "/health"),
        ("GET", "/mcp_library/library"),
        ("GET", "/mcp_library/servers"),
        ("GET", "/model-configs"),
        ("GET", "/projects"),
        ("GET", "/models"),
        ("GET", "/sandbox/activity"),
        ("GET", "/sandbox/availability"),
        ("GET", "/sessions"),
        ("GET", "/sessions/{session_id}"),
        ("GET", "/sessions/{session_id}/children"),
        ("GET", "/sessions/{session_id}/children/{child_session_id}"),
        ("GET", "/sessions/{session_id}/config"),
        ("GET", "/sessions/{session_id}/skills"),
        ("GET", "/sessions/{session_id}/events"),
        ("GET", "/sessions/{session_id}/events/stream"),
        ("GET", "/sessions/{session_id}/goal"),
        ("GET", "/sessions/{session_id}/inbox"),
        ("GET", "/sessions/{session_id}/messages"),
        ("GET", "/sessions/{session_id}/orchestrators"),
        (
            "GET",
            "/sessions/{session_id}/orchestrators/{orchestrator_session_id}",
        ),
        ("GET", "/sessions/{session_id}/permissions"),
        ("GET", "/sessions/{session_id}/threads/{thread_name}/events"),
        ("GET", "/sessions/{session_id}/workspace/branches"),
        ("GET", "/sessions/{session_id}/workspace/diff"),
        ("GET", "/sessions/{session_id}/workspace/file"),
        ("GET", "/sessions/{session_id}/workspace/files"),
        ("GET", "/sessions/{session_id}/workspace/revisions"),
        (
            "GET",
            "/sessions/{session_id}/workspace/revisions/{revision_id}/changes",
        ),
        ("GET", "/ssh-configs"),
        ("GET", "/store"),
        ("PATCH", "/mcp_library/servers/{server_name}"),
        ("PATCH", "/model-configs/{config_id}"),
        ("PATCH", "/projects/{project_id}"),
        ("PATCH", "/sessions/{session_id}/config"),
        ("PATCH", "/sessions/{session_id}/goal/{goal_id}"),
        ("PATCH", "/sessions/{session_id}/inbox/{item_id}"),
        ("PATCH", "/ssh-configs/{config_id}"),
        ("POST", "/auth/{provider}/login"),
        ("POST", "/credentials"),
        ("POST", "/mcp_library/servers"),
        ("POST", "/mcp_library/servers/test"),
        ("POST", "/model-configs"),
        ("POST", "/model-configs/from-file"),
        ("POST", "/model-configs/{config_id}/models"),
        ("POST", "/projects"),
        ("POST", "/projects/{project_id}/sessions"),
        ("POST", "/providers/models"),
        ("POST", "/sessions"),
        ("POST", "/sessions/launch-defaults"),
        ("POST", "/sessions/{session_id}/cancel-active-run"),
        ("POST", "/sessions/{session_id}/compact"),
        ("POST", "/sessions/{session_id}/children"),
        (
            "POST",
            "/sessions/{session_id}/children/{child_session_id}/cancel",
        ),
        ("POST", "/sessions/{session_id}/goal"),
        ("POST", "/sessions/{session_id}/inbox"),
        ("POST", "/sessions/{session_id}/orchestrators"),
        (
            "POST",
            "/sessions/{session_id}/orchestrators/{orchestrator_session_id}/cancel",
        ),
        ("POST", "/sessions/{session_id}/permissions/{request_id}"),
        ("POST", "/sessions/{session_id}/regenerate"),
        ("POST", "/sessions/{session_id}/revert"),
        ("POST", "/sessions/{session_id}/runs"),
        ("POST", "/sessions/{session_id}/steering"),
        (
            "POST",
            "/sessions/{session_id}/threads/{thread_name}/steering",
        ),
        ("POST", "/sessions/{session_id}/workspace/branches"),
        ("POST", "/sessions/{session_id}/workspace/commit"),
        ("POST", "/sessions/{session_id}/workspace/open"),
        ("POST", "/ssh-configs"),
        ("POST", "/ssh/browse"),
        ("PUT", "/credentials/{name}"),
        ("PUT", "/projects/order"),
        ("PUT", "/sessions/order"),
        ("PUT", "/sessions/{session_id}/presentation"),
    ];

    #[test]
    fn event_cursor_requires_both_epoch_and_sequence() {
        assert!(event_cursor(&EventsQuery {
            after_epoch_id: None,
            after_sequence_id: None,
            limit: None,
        })
        .unwrap()
        .is_none());
        assert!(event_cursor(&EventsQuery {
            after_epoch_id: Some("epoch".to_string()),
            after_sequence_id: Some(7),
            limit: None,
        })
        .unwrap()
        .is_some());
        for query in [
            EventsQuery {
                after_epoch_id: Some("epoch".to_string()),
                after_sequence_id: None,
                limit: None,
            },
            EventsQuery {
                after_epoch_id: None,
                after_sequence_id: Some(7),
                limit: None,
            },
        ] {
            let error = event_cursor(&query).unwrap_err();
            assert_eq!(error.status, StatusCode::BAD_REQUEST);
        }
    }

    fn concrete_api_path(path: &str) -> String {
        path.replace("{provider}", "arcee")
            .replace("{login_id}", "missing-login")
            .replace("{name}", "MISSING_CREDENTIAL")
            .replace("{server_name}", "missing-server")
            .replace("{config_id}", "missing-config")
            .replace("{session_id}", "missing-session")
            .replace("{goal_id}", "missing-goal")
            .replace("{request_id}", "missing-request")
            .replace("{grant_id}", "missing-grant")
            .replace("{thread_name}", "missing-thread")
            .replace("{revision_id}", "1")
    }

    fn assert_local_refs_resolve(document: &serde_json::Value, value: &serde_json::Value) {
        match value {
            serde_json::Value::Object(object) => {
                if let Some(reference) = object.get("$ref").and_then(serde_json::Value::as_str) {
                    let pointer = reference
                        .strip_prefix('#')
                        .expect("only local OpenAPI references are expected");
                    assert!(
                        document.pointer(pointer).is_some(),
                        "unresolved OpenAPI reference {reference}"
                    );
                }
                for child in object.values() {
                    assert_local_refs_resolve(document, child);
                }
            }
            serde_json::Value::Array(array) => {
                for child in array {
                    assert_local_refs_resolve(document, child);
                }
            }
            _ => {}
        }
    }

    #[tokio::test]
    async fn openapi_document_matches_the_running_api_router() {
        let root = temp_root("openapi_contract");
        let app = router(test_manager(&root));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/openapi.json")
                    .header(header::HOST, "127.0.0.1")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&header::HeaderValue::from_static("application/json"))
        );
        let document: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(document["openapi"], "3.1.0");
        assert!(
            document["components"]["schemas"]["CreateSessionRequest"]["properties"]
                .get("project_id")
                .is_some()
        );
        assert!(
            document["components"]["schemas"]["SessionSummarySnapshot"]["properties"]
                .get("project_id")
                .is_some()
        );
        assert!(
            document["components"]["schemas"]["SessionMetadata"]["properties"]
                .get("project_id")
                .is_some()
        );
        assert!(
            document["components"]["schemas"]["ProjectRecord"]["properties"]
                .get("project_id")
                .is_some()
        );
        assert!(document["paths"]["/sessions"]["get"]["parameters"]
            .as_array()
            .unwrap()
            .iter()
            .any(|parameter| parameter["name"] == "project_id"));

        let mut documented = std::collections::BTreeSet::new();
        for (path, item) in document["paths"].as_object().expect("OpenAPI paths") {
            let item = item.as_object().expect("OpenAPI path item");
            for method in ["get", "post", "put", "patch", "delete"] {
                if item.contains_key(method) {
                    documented.insert((method.to_uppercase(), path.clone()));
                }
            }
        }
        let expected: std::collections::BTreeSet<_> = EXPECTED_OPENAPI_OPERATIONS
            .iter()
            .map(|(method, path)| ((*method).to_string(), (*path).to_string()))
            .collect();
        assert_eq!(documented, expected);

        let mut operation_ids = std::collections::BTreeSet::new();
        for (method, path) in EXPECTED_OPENAPI_OPERATIONS {
            let operation = &document["paths"][path][method.to_ascii_lowercase()];
            let operation_id = operation["operationId"].as_str().expect("operation id");
            assert!(
                operation_ids.insert(operation_id),
                "duplicate operation id {operation_id}"
            );
            for parameter_name in path
                .split('{')
                .skip(1)
                .filter_map(|tail| tail.split_once('}').map(|(name, _)| name))
            {
                let matches = operation["parameters"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter(|parameter| {
                        parameter["name"] == parameter_name
                            && parameter["in"] == "path"
                            && parameter["required"] == true
                    })
                    .count();
                assert_eq!(
                    matches, 1,
                    "{method} {path} must document required path parameter {parameter_name}"
                );
            }
        }
        assert_local_refs_resolve(&document, &document);

        for path in expected
            .iter()
            .map(|(_, path)| path)
            .collect::<std::collections::BTreeSet<_>>()
        {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(axum::http::Method::OPTIONS)
                        .uri(concrete_api_path(path))
                        .header(header::HOST, "127.0.0.1")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_ne!(
                response.status(),
                StatusCode::NOT_FOUND,
                "documented runtime path {path} is not routed"
            );
            let allow = response
                .headers()
                .get(header::ALLOW)
                .expect("method router must report Allow")
                .to_str()
                .unwrap();
            for (method, expected_path) in &expected {
                if expected_path == path {
                    assert!(
                        allow.split(',').any(|allowed| allowed.trim() == method),
                        "{path} runtime Allow={allow:?} is missing {method}"
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn openapi_special_wire_schemas_and_docs_are_live() {
        let root = temp_root("openapi_special_schemas");
        let app = router(test_manager(&root));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/openapi.json")
                    .header(header::HOST, "localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let document: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();

        let create = &document["components"]["schemas"]["CreateSessionRequest"];
        assert!(!create["required"]
            .as_array()
            .is_some_and(|required| required.iter().any(|field| field == "model")));
        let model = &create["properties"]["model"];
        let model_ref = model["$ref"].as_str().expect("model schema reference");
        let variants = document
            .pointer(
                model_ref
                    .strip_prefix('#')
                    .expect("local model schema reference"),
            )
            .and_then(|schema| schema["oneOf"].as_array())
            .expect("nullable model oneOf");
        assert!(variants.iter().any(|variant| variant["type"] == "null"));
        assert!(variants.iter().any(|variant| variant["type"] == "string"));
        let headers_ref = create["properties"]["extra_headers"]["$ref"]
            .as_str()
            .expect("tri-state headers reference");
        let headers_variants = document
            .pointer(
                headers_ref
                    .strip_prefix('#')
                    .expect("local headers schema reference"),
            )
            .and_then(|schema| schema["oneOf"].as_array())
            .expect("nullable headers oneOf");
        assert!(headers_variants
            .iter()
            .any(|variant| variant["type"] == "null"));
        let headers = headers_variants
            .iter()
            .find_map(|variant| variant["oneOf"].as_array())
            .expect("HeadersRequest object/string oneOf");
        assert_eq!(headers.len(), 2);
        assert!(headers.iter().any(|schema| schema["type"] == "object"));
        assert!(headers.iter().any(|schema| schema["type"] == "string"));
        let model_headers_ref = document["components"]["schemas"]
            ["UpdateModelConfigurationRequest"]["properties"]["extra_headers"]["$ref"]
            .as_str()
            .expect("model header map schema reference");
        let mcp_env_ref = document["components"]["schemas"]["UpdateMcpServerRequest"]["properties"]
            ["env"]["$ref"]
            .as_str()
            .expect("MCP environment map schema reference");
        assert_ne!(model_headers_ref, mcp_env_ref);
        let model_headers = document
            .pointer(model_headers_ref.strip_prefix('#').unwrap())
            .and_then(|schema| schema["oneOf"].as_array())
            .and_then(|variants| variants.iter().find(|variant| variant["type"] == "object"))
            .expect("model header map variant");
        assert_eq!(model_headers["additionalProperties"]["type"], "string");
        let mcp_env = document
            .pointer(mcp_env_ref.strip_prefix('#').unwrap())
            .and_then(|schema| schema["oneOf"].as_array())
            .and_then(|variants| variants.iter().find(|variant| variant["type"] == "object"))
            .expect("MCP environment map variant");
        assert!(mcp_env["additionalProperties"]["oneOf"]
            .as_array()
            .is_some_and(|variants| variants.iter().any(|variant| variant["type"] == "null")));

        let assistant_message = document["components"]["schemas"]["Message"]["oneOf"]
            .as_array()
            .and_then(|variants| {
                variants.iter().find(|variant| {
                    variant["properties"]["role"]["enum"]
                        .as_array()
                        .is_some_and(|roles| roles.iter().any(|role| role == "assistant"))
                })
            })
            .expect("assistant message variant");
        assert!(assistant_message["required"]
            .as_array()
            .is_some_and(|required| required.iter().any(|field| field == "content")));

        for (schema, field, example) in [
            ("StoreCredentialRequest", "value", "fake-credential-value"),
            ("ProviderModelsRequest", "api_key", "fake-provider-key"),
            ("CreateModelConfigurationRequest", "api_key", "fake-api-key"),
        ] {
            let property = &document["components"]["schemas"][schema]["properties"][field];
            assert_eq!(property["writeOnly"], true, "{schema}.{field}");
            assert_eq!(property["example"], example, "{schema}.{field}");
        }

        let stream =
            &document["paths"]["/sessions/{session_id}/events/stream"]["get"]["responses"]["200"];
        assert!(stream["content"]["text/event-stream"].is_object());
        let description = stream["description"].as_str().unwrap();
        for event in [
            "replay_boundary",
            "replay_gap",
            "session_event",
            "assistant_delta",
            "lagged",
        ] {
            assert!(description.contains(event), "missing SSE event {event}");
        }
        for (method, path, status) in [
            ("get", "/sessions", "400"),
            ("post", "/providers/models", "500"),
            ("post", "/sessions/{session_id}/runs", "501"),
            ("delete", "/model-configs/{config_id}", "400"),
            ("delete", "/ssh-configs/{config_id}", "400"),
            ("delete", "/credentials/{name}", "400"),
            ("get", "/sessions/{session_id}/workspace/revisions", "400"),
            ("post", "/sessions/{session_id}/cancel-active-run", "400"),
            ("delete", "/sessions/{session_id}", "400"),
            ("get", "/sessions/{session_id}/config", "400"),
            ("post", "/sessions/{session_id}/compact", "400"),
            ("delete", "/mcp_library/servers/{server_name}", "400"),
            ("get", "/mcp_library/servers", "409"),
            ("delete", "/mcp_library/servers/{server_name}", "409"),
            ("post", "/mcp_library/servers/test", "409"),
        ] {
            assert!(
                document["paths"][path][method]["responses"][status].is_object(),
                "missing {method} {path} response {status}"
            );
        }
        for (method, path) in [
            ("post", "/model-configs"),
            ("patch", "/model-configs/{config_id}"),
            ("post", "/mcp_library/servers"),
            ("patch", "/mcp_library/servers/{server_name}"),
            ("post", "/mcp_library/servers/test"),
            ("post", "/auth/{provider}/login"),
        ] {
            assert!(
                document["paths"][path][method]["responses"]["502"].is_null(),
                "unexpected {method} {path} response 502"
            );
        }

        let invalid_query = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/sessions?workspace_stats=not-a-bool")
                    .header(header::HOST, "localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(invalid_query.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            invalid_query.headers().get(header::CONTENT_TYPE),
            Some(&header::HeaderValue::from_static(
                "text/plain; charset=utf-8"
            ))
        );

        let redirect = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/docs")
                    .header(header::HOST, "localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(redirect.status(), StatusCode::SEE_OTHER);
        assert_eq!(
            redirect.headers().get(header::LOCATION),
            Some(&header::HeaderValue::from_static("/docs/"))
        );
        let docs = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/docs/")
                    .header(header::HOST, "localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(docs.status(), StatusCode::OK);
        assert_eq!(
            docs.headers().get("content-security-policy"),
            Some(&header::HeaderValue::from_static("frame-ancestors 'none'"))
        );
        assert_eq!(
            docs.headers().get("x-frame-options"),
            Some(&header::HeaderValue::from_static("DENY"))
        );
        let html = String::from_utf8(
            to_bytes(docs.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(html.contains("swagger-initializer.js"));
        let initializer = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/docs/swagger-initializer.js")
                    .header(header::HOST, "localhost")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(initializer.status(), StatusCode::OK);
        let initializer = String::from_utf8(
            to_bytes(initializer.into_body(), usize::MAX)
                .await
                .unwrap()
                .to_vec(),
        )
        .unwrap();
        assert!(initializer.contains("/openapi.json"));
        assert!(initializer.contains("\"validatorUrl\": \"none\""));

        for uri in ["/openapi.json", "/docs"] {
            let rejected = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(uri)
                        .header(header::HOST, "example.com")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(rejected.status(), StatusCode::FORBIDDEN, "{uri}");
            assert_eq!(
                rejected.headers().get(header::CONTENT_TYPE),
                Some(&header::HeaderValue::from_static(
                    "text/plain; charset=utf-8"
                ))
            );
        }
    }

    #[path = "compaction.rs"]
    mod compaction;

    #[test]
    fn model_request_fields_distinguish_omitted_null_and_values() {
        let request: CreateSessionRequest = serde_json::from_str(
            r#"{
                "model":" model-a ",
                "base_url":null,
                "backend":"openai-responses",
                "reasoning_effort":"xhigh",
                "api_key_env":null,
                "extra_headers":{"X-Trace":"launch"},
                "orchestrator_compaction_threshold":0
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
        assert_eq!(
            request.orchestrator_compaction_threshold,
            RequestField::Value(0)
        );
        assert_eq!(request.cwd, None);
    }

    #[test]
    fn create_resolution_inherits_overrides_and_explicitly_clears_optional_config() {
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

    // The committed Vite build is what every release serves, so a stale or
    // partial `assets/dist` has to fail here rather than in a browser.
    #[test]
    fn committed_frontend_build_is_embedded_and_self_consistent() {
        const HTML: &str = include_str!("../assets/dist/index.html");

        let referenced: Vec<&str> = HTML
            .match_indices("/assets/dist/assets/")
            .map(|(start, _)| {
                let tail = &HTML[start + 1..];
                let end = tail
                    .find(['"', '\''])
                    .expect("asset reference must be quoted");
                &tail[..end]
            })
            .collect();
        assert!(
            referenced.iter().any(|path| path.ends_with(".js")),
            "the entry document must load a bundled script"
        );
        assert!(
            referenced.iter().any(|path| path.ends_with(".css")),
            "the entry document must load a bundled stylesheet"
        );

        for path in referenced {
            let embedded = path
                .strip_prefix("assets/")
                .expect("references are rooted at the asset directory");
            let file = ASSETS
                .get_file(embedded)
                .unwrap_or_else(|| panic!("{path} is referenced but not embedded"));
            assert!(!file.contents().is_empty(), "{path} is empty");
            assert_eq!(
                asset_cache_control(embedded),
                "public, max-age=31536000, immutable",
                "hashed bundles must be cacheable forever"
            );
        }

        assert!(!HTML.to_ascii_lowercase().contains("prototype"));
    }

    #[tokio::test]
    async fn public_proxy_headers_reach_get_json_and_sse_routes() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("public_proxy_headers");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        // The proxy's public name is only served once the operator names it.
        unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "preview-1234.ngrok-free.app") };
        seed_editable_session(&root, "session");
        let app = router(test_manager(&root));

        for (origin, fetch_site) in [
            (Some("https://preview-1234.ngrok-free.app"), "same-origin"),
            (None, "none"),
            (Some("https://operator.example"), "cross-site"),
        ] {
            let mut request = Request::builder()
                .uri("/health")
                .header(header::HOST, "preview-1234.ngrok-free.app")
                .header("sec-fetch-site", fetch_site);
            if let Some(origin) = origin {
                request = request.header(header::ORIGIN, origin);
            }
            let response = app
                .clone()
                .oneshot(request.body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{fetch_site}");
            assert!(response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none());
        }

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/missing/steering")
                    .header(header::HOST, "preview-1234.ngrok-free.app")
                    .header(header::ORIGIN, "https://operator.example")
                    .header("sec-fetch-site", "cross-site")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"instruction":"do nothing"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/missing/steering")
                    .header(header::HOST, "preview-1234.ngrok-free.app")
                    .header(header::ORIGIN, "https://preview-1234.ngrok-free.app")
                    .header("sec-fetch-site", "same-origin")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"instruction":"do nothing"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/sessions/session/events/stream")
                    .header(header::HOST, "preview-1234.ngrok-free.app")
                    .header(header::ORIGIN, "https://preview-1234.ngrok-free.app")
                    .header("sec-fetch-site", "same-origin")
                    .header(header::ACCEPT_ENCODING, "gzip")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&header::HeaderValue::from_static("text/event-stream"))
        );
        assert!(response.headers().get(header::CONTENT_ENCODING).is_none());

        drop(response);
        drop(app);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_foreign_host_is_refused_until_the_operator_names_it() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("foreign_host");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        nac_core::store::initialize(&root.join("store.db")).unwrap();

        let health = |app: Router, host: &'static str| async move {
            app.oneshot(
                Request::builder()
                    .uri("/health")
                    .header(header::HOST, host)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        };

        // Rebinding turns an attacker-controlled name into a request for this
        // very server, so the name is what has to be refused.
        let guarded = router(test_manager(&root));
        assert_eq!(
            health(guarded.clone(), "rebound.example").await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            health(guarded.clone(), "127.0.0.1.rebound.example").await,
            StatusCode::FORBIDDEN
        );
        for host in [
            "127.0.0.1:3210",
            "localhost:3210",
            "[::1]:3210",
            "192.168.1.10:3210",
            "[fd00::1]:3210",
            "LOCALHOST",
        ] {
            assert_eq!(
                health(guarded.clone(), host).await,
                StatusCode::OK,
                "{host} names this server"
            );
        }

        unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "nac.internal, preview.example") };
        let allowlisted = router(test_manager(&root));
        assert_eq!(
            health(allowlisted.clone(), "preview.example").await,
            StatusCode::OK
        );
        assert_eq!(
            health(allowlisted.clone(), "preview.example:8443").await,
            StatusCode::OK
        );
        assert_eq!(
            health(allowlisted.clone(), "other.example").await,
            StatusCode::FORBIDDEN
        );

        unsafe { std::env::set_var(ALLOWED_HOSTS_ENV, "*") };
        let unguarded = router(test_manager(&root));
        assert_eq!(
            health(unguarded.clone(), "anything.example").await,
            StatusCode::OK
        );

        drop((guarded, allowlisted, unguarded));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn a_request_without_a_host_header_is_served() {
        let root = temp_root("hostless_request");
        nac_core::store::initialize(&root.join("store.db")).unwrap();
        let app = router(test_manager(&root));

        // HTTP/1.0 clients and probes omit the header; browsers never do.
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        drop(app);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn cross_origin_browser_mutations_are_refused() {
        let root = temp_root("cross_origin_mutation");
        nac_core::store::initialize(&root.join("store.db")).unwrap();
        let app = router(test_manager(&root));
        let request = |fetch_site: Option<&str>, origin: Option<&str>| {
            let mut request = Request::builder()
                .method("POST")
                .uri("/sessions/missing/compact")
                .header(header::HOST, "192.168.1.20:3210");
            if let Some(fetch_site) = fetch_site {
                request = request.header("sec-fetch-site", fetch_site);
            }
            if let Some(origin) = origin {
                request = request.header(header::ORIGIN, origin);
            }
            request.body(Body::empty()).unwrap()
        };

        for fetch_site in ["cross-site", "same-site"] {
            let response = app
                .clone()
                .oneshot(request(Some(fetch_site), None))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN, "{fetch_site}");
        }

        let wrong_origin = app
            .clone()
            .oneshot(request(None, Some("http://attacker.example")))
            .await
            .unwrap();
        assert_eq!(wrong_origin.status(), StatusCode::FORBIDDEN);

        let invalid_fetch_metadata = app
            .clone()
            .oneshot(request(Some("unexpected"), Some("http://attacker.example")))
            .await
            .unwrap();
        assert_eq!(invalid_fetch_metadata.status(), StatusCode::FORBIDDEN);

        // Same-origin browsers and non-browser clients reach the handler. The
        // missing session then proves the origin middleware admitted them.
        for admitted in [
            request(Some("same-origin"), None),
            request(None, Some("http://192.168.1.20:3210")),
            request(None, None),
        ] {
            let response = app.clone().oneshot(admitted).await.unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }

        let cross_site_read = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .header(header::HOST, "192.168.1.20:3210")
                    .header("sec-fetch-site", "cross-site")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cross_site_read.status(), StatusCode::OK);

        drop(app);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn host_headers_are_split_from_their_port_before_they_are_judged() {
        assert_eq!(bare_host("example.com:8443"), Some("example.com"));
        assert_eq!(bare_host("[::1]:3210"), Some("::1"));
        assert_eq!(bare_host("  example.com  "), Some("example.com"));
        assert_eq!(bare_host(":3210"), None);
        // An unterminated IPv6 literal is malformed, not a host.
        assert_eq!(bare_host("[::1"), None);

        for host in [
            "127.0.0.1",
            "127.9.9.9:80",
            "[::1]",
            "localhost",
            "LocalHost:1",
        ] {
            assert!(
                is_non_rebindable_host(host),
                "{host} should not be rebindable"
            );
        }
        for host in ["example.com", "127.0.0.1.example.com", "[::1", ""] {
            assert!(
                !is_non_rebindable_host(host),
                "{host} should require an allowlist entry"
            );
        }

        for host in ["10.0.0.1", "192.168.1.10:3210", "[fd00::1]:3210"] {
            assert!(
                is_non_rebindable_host(host),
                "{host} is an IP literal and cannot be rebound"
            );
        }
    }

    #[test]
    fn the_allowlist_is_parsed_leniently_and_matched_exactly() {
        let allowed = vec!["nac.internal".to_string(), "preview.example".to_string()];

        assert!(host_is_allowed("NAC.Internal:8080", &allowed));
        assert!(host_is_allowed("preview.example", &allowed));
        assert!(!host_is_allowed("evil-preview.example", &allowed));
        assert!(!host_is_allowed("preview.example.evil.com", &allowed));
        // Loopback needs no entry at all.
        assert!(host_is_allowed("localhost:3210", &[]));
    }

    #[tokio::test]
    async fn an_explicit_non_loopback_bind_is_accepted() {
        let root = temp_root("non_loopback_bind");
        let manager = test_manager(&root);
        let (listening_tx, listening_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            serve_with_policy(
                "0.0.0.0:0".parse().unwrap(),
                BindPolicy::AllowRemote,
                manager,
                move |bound| {
                    let _ = listening_tx.send(bound);
                },
            )
            .await
        });

        let bound = tokio::time::timeout(Duration::from_secs(2), listening_rx)
            .await
            .expect("non-loopback bind timed out")
            .expect("server stopped before listening");
        assert!(bound.ip().is_unspecified());
        assert_ne!(bound.port(), 0);

        server.abort();
        let _ = server.await;
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn non_loopback_bind_is_refused_without_explicit_policy() {
        let error = BindPolicy::LoopbackOnly
            .validate("192.168.1.20:3210".parse().unwrap())
            .unwrap_err();
        assert!(error.to_string().contains("--allow-remote"));
    }

    /// Path of a bundled script, whose name carries a content hash that changes
    /// on every build.
    fn bundled_script_path() -> String {
        let file = ASSETS
            .get_dir("dist/assets")
            .expect("the committed build must be embedded")
            .files()
            .find(|file| file.path().extension().is_some_and(|ext| ext == "js"))
            .expect("the build must emit at least one script");
        format!("/assets/{}", file.path().to_string_lossy())
    }

    #[tokio::test]
    async fn finite_static_and_json_routes_gzip_without_changing_identity_bodies() {
        let root = temp_root("route_compression");
        let app = router(test_manager(&root));
        let script = bundled_script_path();

        let identity = get_response(app.clone(), &script, None).await;
        assert_eq!(identity.status(), StatusCode::OK);
        assert!(identity.headers().get(header::CONTENT_ENCODING).is_none());
        let identity_body = response_body(identity).await;
        assert!(!identity_body.is_empty());

        let compressed = get_response(app.clone(), &script, Some("gzip")).await;
        assert_eq!(compressed.status(), StatusCode::OK);
        assert_eq!(
            compressed.headers().get(header::CONTENT_ENCODING),
            Some(&header::HeaderValue::from_static("gzip"))
        );
        assert_eq!(gunzip(&response_body(compressed).await), identity_body);

        let json_identity = get_response(app.clone(), "/store", None).await;
        assert_eq!(json_identity.status(), StatusCode::OK);
        assert!(json_identity
            .headers()
            .get(header::CONTENT_ENCODING)
            .is_none());
        let json_identity_body = response_body(json_identity).await;
        let _: serde_json::Value = serde_json::from_slice(&json_identity_body).unwrap();

        let json_compressed = get_response(app, "/store", Some("gzip")).await;
        assert_eq!(json_compressed.status(), StatusCode::OK);
        assert_eq!(
            json_compressed.headers().get(header::CONTENT_ENCODING),
            Some(&header::HeaderValue::from_static("gzip"))
        );
        assert_eq!(
            gunzip(&response_body(json_compressed).await),
            json_identity_body
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn session_event_envelope_serializes_for_sse_payloads() {
        let envelope = SessionEventEnvelope {
            session_id: Some("session-1".to_string()),
            epoch_id: "test-epoch".to_string(),
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

    #[test]
    fn config_replacement_preserves_attached_sandbox_ownership() {
        assert_eq!(
            config_replacement_conflict(false, true),
            Some(
                "session owns an active sandbox; config replacement is unavailable while container-local state must be preserved"
            )
        );
        assert!(config_replacement_conflict(false, false).is_none());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn deletion_fails_closed_when_snapshot_decode_cannot_yield_sandbox_metadata() {
        use std::os::unix::fs::PermissionsExt;

        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("delete_invalid_snapshot_preserves_sandbox_authority");
        seed_editable_session(&root, "sandbox-session");
        let store_path = root.join("store.db");
        let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
        nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
        sessions::save_session(&store_path, &snapshot).unwrap();

        let mut raw = sessions::load_session_config(&store_path, "sandbox-session").unwrap();
        raw.backend = Some("auto".to_string());
        sessions::update_raw_session_config(&store_path, &raw).unwrap();
        assert!(sessions::load_session(&store_path, "sandbox-session").is_err());

        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let podman = bin.join("podman");
        let arguments = root.join("podman-arguments");
        std::fs::write(
            &podman,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
        let original_path = std::env::var_os("PATH");
        let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
        unsafe {
            std::env::set_var("PATH", &bin);
            std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
        }

        let manager = test_manager(&root);
        manager
            .delete_session("sandbox-session")
            .await
            .expect_err("invalid snapshot must fail closed before cleanup or row deletion");
        assert!(
            sessions::load_session_config(&store_path, "sandbox-session").is_ok(),
            "durable row and sandbox retry authority must remain"
        );
        assert!(
            !arguments.exists(),
            "container cleanup must not run without decoded ownership metadata"
        );

        unsafe {
            match original_path {
                Some(path) => std::env::set_var("PATH", path),
                None => std::env::remove_var("PATH"),
            }
            match original_arguments {
                Some(path) => std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", path),
                None => std::env::remove_var("NAC_TEST_PODMAN_ARGUMENTS"),
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn failed_restart_container_cleanup_preserves_durable_delete_authority() {
        use std::os::unix::fs::PermissionsExt;

        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("durable_sandbox_delete");
        seed_editable_session(&root, "sandbox-session");
        let git_executable = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|directory| directory.join("git"))
            .find(|candidate| candidate.is_file())
            .expect("git executable on PATH");
        let git = |args: &[&str]| {
            let output = std::process::Command::new(&git_executable)
                .arg("-C")
                .arg(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init"]);
        git(&["config", "user.name", "NAC Test"]);
        git(&["config", "user.email", "nac@example.invalid"]);
        std::fs::write(root.join("revision.txt"), b"pinned\n").unwrap();
        git(&["add", "revision.txt"]);
        git(&["commit", "-m", "pinned revision"]);
        git(&["update-ref", "refs/nac/revisions/sandbox-session", "HEAD"]);
        let fork_point = String::from_utf8(
            std::process::Command::new(&git_executable)
                .arg("-C")
                .arg(&root)
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap()
        .trim()
        .to_string();
        let store_path = root.join("store.db");
        let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
        nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
        nac_core::test_support::set_sandbox_worktree(
            &mut snapshot,
            root.clone(),
            root.join("missing-worktree"),
            fork_point,
        );
        sessions::save_session(&store_path, &snapshot).unwrap();

        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::os::unix::fs::symlink(&git_executable, bin.join("git")).unwrap();
        let podman = bin.join("podman");
        let arguments = root.join("podman-arguments");
        std::fs::write(
            &podman,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$NAC_TEST_PODMAN_ARGUMENTS\"\nexit \"$NAC_TEST_PODMAN_STATUS\"\n",
        )
        .unwrap();
        std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
        let original_path = std::env::var_os("PATH");
        let original_arguments = std::env::var_os("NAC_TEST_PODMAN_ARGUMENTS");
        let original_status = std::env::var_os("NAC_TEST_PODMAN_STATUS");
        unsafe {
            std::env::set_var("PATH", &bin);
            std::env::set_var("NAC_TEST_PODMAN_ARGUMENTS", &arguments);
            std::env::set_var("NAC_TEST_PODMAN_STATUS", "23");
        }

        let manager = test_manager(&root);
        let error = manager.delete_session("sandbox-session").await.unwrap_err();
        assert!(error
            .to_string()
            .contains("failed to remove sandbox container"));
        assert!(sessions::load_session(&store_path, "sandbox-session").is_ok());
        git(&[
            "rev-parse",
            "--verify",
            "refs/nac/revisions/sandbox-session",
        ]);
        assert_eq!(
            std::fs::read_to_string(&arguments).unwrap(),
            "rm\n--ignore\n-f\nnac-sandbox-session\n"
        );

        unsafe { std::env::set_var("NAC_TEST_PODMAN_STATUS", "0") };
        manager.delete_session("sandbox-session").await.unwrap();
        assert!(sessions::load_session(&store_path, "sandbox-session").is_err());
        let revision_ref = std::process::Command::new(&git_executable)
            .arg("-C")
            .arg(&root)
            .args([
                "rev-parse",
                "--verify",
                "--quiet",
                "refs/nac/revisions/sandbox-session",
            ])
            .status()
            .unwrap();
        assert!(!revision_ref.success());

        unsafe {
            for (name, value) in [
                ("PATH", original_path),
                ("NAC_TEST_PODMAN_ARGUMENTS", original_arguments),
                ("NAC_TEST_PODMAN_STATUS", original_status),
            ] {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn cancelled_delete_request_keeps_authority_until_podman_cleanup_settles() {
        use std::os::unix::fs::PermissionsExt;

        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cancelled_durable_sandbox_delete");
        seed_editable_session(&root, "sandbox-session");
        let store_path = root.join("store.db");
        let mut snapshot = sessions::load_session(&store_path, "sandbox-session").unwrap();
        nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
        sessions::save_session(&store_path, &snapshot).unwrap();

        let bin = root.join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let podman = bin.join("podman");
        let ready = root.join("podman-ready");
        let release = root.join("podman-release");
        std::fs::write(
            &podman,
            "#!/bin/sh\n: > \"$NAC_TEST_PODMAN_READY\"\nwhile [ ! -f \"$NAC_TEST_PODMAN_RELEASE\" ]; do /bin/sleep 0.01; done\nexit 0\n",
        )
        .unwrap();
        std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
        let original_path = std::env::var_os("PATH");
        let original_ready = std::env::var_os("NAC_TEST_PODMAN_READY");
        let original_release = std::env::var_os("NAC_TEST_PODMAN_RELEASE");
        unsafe {
            std::env::set_var("PATH", &bin);
            std::env::set_var("NAC_TEST_PODMAN_READY", &ready);
            std::env::set_var("NAC_TEST_PODMAN_RELEASE", &release);
        }

        let manager = test_manager(&root);
        let delete_manager = manager.clone();
        let request =
            tokio::spawn(async move { delete_manager.delete_session("sandbox-session").await });
        tokio::time::timeout(Duration::from_secs(2), async {
            while !ready.exists() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("Podman cleanup should start");
        request.abort();

        assert!(matches!(
            sessions::SessionResourceMutationLease::try_acquire(&store_path, "sandbox-session"),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
        assert!(matches!(
            sessions::SessionOperationLease::try_acquire(&store_path, "sandbox-session"),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));

        std::fs::write(&release, b"release").unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while sessions::load_session(&store_path, "sandbox-session").is_ok() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned deletion task should finish after cleanup");
        drop(
            sessions::SessionResourceMutationLease::try_acquire(&store_path, "sandbox-session")
                .unwrap(),
        );

        unsafe {
            for (name, value) in [
                ("PATH", original_path),
                ("NAC_TEST_PODMAN_READY", original_ready),
                ("NAC_TEST_PODMAN_RELEASE", original_release),
            ] {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
        let _ = std::fs::remove_dir_all(root);
    }

    static SERVER_MODEL_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct ScopedModelEnv {
        original: Vec<(&'static str, Option<std::ffi::OsString>)>,
    }

    impl ScopedModelEnv {
        fn isolated(nac_home: &std::path::Path, openai_api_key: Option<&str>) -> Self {
            Self::with_config_home(Some(nac_home), None, None, openai_api_key)
        }

        fn with_config_home(
            nac_home: Option<&std::path::Path>,
            xdg_config_home: Option<&std::path::Path>,
            home: Option<&std::path::Path>,
            openai_api_key: Option<&str>,
        ) -> Self {
            let names = [
                "NAC_HOME",
                "XDG_CONFIG_HOME",
                "HOME",
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
                "DEEPSEEK_API_KEY",
                "FIREWORKS_API_KEY",
                "TOGETHER_API_KEY",
                "ARCEE_API_KEY",
                "OPENAI_BASE_URL",
                "SECOND_API_KEY",
                ALLOWED_HOSTS_ENV,
            ];
            let original = names
                .into_iter()
                .map(|name| (name, std::env::var_os(name)))
                .collect();
            unsafe {
                for (name, value) in [
                    ("NAC_HOME", nac_home),
                    ("XDG_CONFIG_HOME", xdg_config_home),
                    ("HOME", home),
                ] {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
                match openai_api_key {
                    Some(value) => std::env::set_var("OPENAI_API_KEY", value),
                    None => std::env::remove_var("OPENAI_API_KEY"),
                }
                std::env::remove_var("ANTHROPIC_API_KEY");
                // The remaining conventional credential vars stay cleared so
                // conventional-var auto-selection never leaks machine state
                // into a test.
                std::env::remove_var("DEEPSEEK_API_KEY");
                std::env::remove_var("FIREWORKS_API_KEY");
                std::env::remove_var("TOGETHER_API_KEY");
                std::env::remove_var("ARCEE_API_KEY");
                std::env::remove_var("OPENAI_BASE_URL");
                std::env::remove_var("SECOND_API_KEY");
                std::env::remove_var(ALLOWED_HOSTS_ENV);
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
                "type": "arcee_device_token",
                "access_token": "arcee-access-server-test",
                "refresh_token": "arcee-refresh-server-test",
                "token_type": "bearer",
                "expires_at_ms": u64::MAX,
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

    #[test]
    fn managed_monitor_peer_lease_process_helper() {
        let Some(store_path) = std::env::var_os("NAC_TEST_MANAGED_PEER_STORE") else {
            return;
        };
        let session_id = std::env::var("NAC_TEST_MANAGED_PEER_SESSION").unwrap();
        let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_MANAGED_PEER_READY").unwrap());
        let _lease = sessions::SessionOperationLease::try_acquire(
            std::path::Path::new(&store_path),
            &session_id,
        )
        .unwrap();
        std::fs::write(ready_path, b"ready").unwrap();
        std::thread::sleep(Duration::from_secs(30));
    }

    fn test_manager(root: &std::path::Path) -> SessionManager {
        SessionManager::new(ServerOptions {
            root_cwd: root.to_path_buf(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
        })
        .expect("session manager")
    }

    fn poison_operation_lease_directory(root: &std::path::Path) -> PathBuf {
        let lock_dir = root.join("store.db.run-locks");
        std::fs::write(&lock_dir, b"not a directory").expect("poison operation lease directory");
        lock_dir
    }

    async fn get_response(app: Router, uri: &str, accept_encoding: Option<&str>) -> Response {
        let mut request = Request::builder().uri(uri);
        if let Some(accept_encoding) = accept_encoding {
            request = request.header(header::ACCEPT_ENCODING, accept_encoding);
        }
        app.oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    async fn response_body(response: Response) -> Bytes {
        to_bytes(response.into_body(), usize::MAX).await.unwrap()
    }

    #[tokio::test]
    async fn health_reports_store_readiness_and_recovers_without_path_leakage() {
        let root = temp_root("health_store_readiness");
        let store_path = root.join("store.db");
        nac_core::store::initialize(&store_path).unwrap();
        let app = router(test_manager(&root));

        let healthy = get_response(app.clone(), "/health", None).await;
        assert_eq!(healthy.status(), StatusCode::OK);
        assert_eq!(
            response_body(healthy).await,
            Bytes::from_static(br#"{"status":"ok"}"#)
        );

        std::fs::remove_file(&store_path).unwrap();
        let unavailable = get_response(app.clone(), "/health", None).await;
        assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
        let body = response_body(unavailable).await;
        assert_eq!(body, Bytes::from_static(br#"{"status":"unavailable"}"#));
        assert!(!String::from_utf8_lossy(&body).contains(&store_path.display().to_string()));
        assert!(
            !store_path.exists(),
            "readiness recreated the missing store"
        );

        nac_core::store::initialize(&store_path).unwrap();
        let recovered = get_response(app, "/health", None).await;
        assert_eq!(recovered.status(), StatusCode::OK);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn open_store_descriptor_count(store_path: &std::path::Path) -> usize {
        let canonical = std::fs::canonicalize(store_path).unwrap();
        let sidecar = |suffix: &str| {
            let mut path = canonical.as_os_str().to_os_string();
            path.push(suffix);
            PathBuf::from(path)
        };
        let targets = [canonical.clone(), sidecar("-wal"), sidecar("-shm")];
        #[cfg(target_os = "linux")]
        {
            return std::fs::read_dir("/proc/self/fd")
                .unwrap()
                .filter_map(|entry| std::fs::read_link(entry.ok()?.path()).ok())
                .filter(|path| targets.contains(path))
                .count();
        }
        #[cfg(target_os = "macos")]
        {
            let mut count = 0;
            let mut limit = std::mem::MaybeUninit::<libc::rlimit>::uninit();
            let result = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, limit.as_mut_ptr()) };
            assert_eq!(result, 0);
            let limit = unsafe { limit.assume_init() };
            for descriptor in 0..limit.rlim_cur as libc::c_int {
                let mut path = [0_i8; libc::PATH_MAX as usize];
                let result = unsafe { libc::fcntl(descriptor, libc::F_GETPATH, path.as_mut_ptr()) };
                if result == -1 {
                    continue;
                }
                use std::os::unix::ffi::OsStrExt;
                let path = unsafe { std::ffi::CStr::from_ptr(path.as_ptr()) };
                let path = PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes()));
                if targets.contains(&path) {
                    count += 1;
                }
            }
            count
        }
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    fn lower_nofile_limit(limit: libc::rlim_t) {
        let mut current = std::mem::MaybeUninit::<libc::rlimit>::uninit();
        let result = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, current.as_mut_ptr()) };
        assert_eq!(result, 0);
        let mut current = unsafe { current.assume_init() };
        assert!(current.rlim_max >= limit);
        current.rlim_cur = limit;
        let result = unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &current) };
        assert_eq!(result, 0);
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[tokio::test]
    async fn sqlite_connection_bound_low_nofile_helper() {
        let Some(root) = std::env::var_os("NAC_TEST_LOW_NOFILE_ROOT") else {
            return;
        };
        lower_nofile_limit(256);
        unsafe { std::env::set_var("OPENAI_API_KEY", "low-nofile-test-key") };
        let root = PathBuf::from(root);
        for index in 0..80 {
            seed_editable_session(&root, &format!("session-{index:03}"));
        }

        let manager = test_manager(&root);
        let mut subscriptions = Vec::new();
        for index in 0..56 {
            subscriptions.push(
                manager
                    .subscribe_events(&format!("session-{index:03}"), None, 1)
                    .await
                    .unwrap(),
            );
            assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
        }

        let mut attachments = Vec::new();
        for index in 56..72 {
            let manager = manager.clone();
            attachments.push(tokio::spawn(async move {
                manager
                    .subscribe_events(&format!("session-{index:03}"), None, 1)
                    .await
            }));
        }
        for attachment in attachments {
            subscriptions.push(attachment.await.unwrap().unwrap());
        }

        subscriptions.push(
            manager
                .subscribe_events("session-079", None, 1)
                .await
                .unwrap(),
        );
        let request = CreateSessionRequest {
            cwd: Some(root.clone()),
            model: RequestField::Value("gpt-5.2".to_string()),
            backend: RequestField::Value("openai-responses".to_string()),
            api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
            ..CreateSessionRequest::default()
        };
        let mut creations = Vec::new();
        for _ in 0..8 {
            let manager = manager.clone();
            let request = request.clone();
            creations.push(tokio::spawn(async move {
                manager.create_session(request).await
            }));
        }
        for creation in creations {
            creation.await.unwrap().unwrap();
        }
        manager.create_session(request).await.unwrap();
        assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
        nac_core::store::check_readiness(&root.join("store.db")).unwrap();
        assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
        assert_eq!(subscriptions.len(), 73);
        println!("low-nofile connection regression completed");
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn retained_subscriptions_do_not_exhaust_low_nofile_store_descriptors() {
        let root = temp_root("low_nofile_connections");
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::sqlite_connection_bound_low_nofile_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_LOW_NOFILE_ROOT", &root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "low-NOFILE child failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8_lossy(&output.stdout)
                .contains("low-nofile connection regression completed"),
            "low-NOFILE helper did not execute\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let _ = std::fs::remove_dir_all(root);
    }

    async fn response_json(response: Response) -> serde_json::Value {
        serde_json::from_slice(&response_body(response).await).unwrap()
    }

    fn gunzip(body: &[u8]) -> Vec<u8> {
        let mut decoded = Vec::new();
        GzDecoder::new(body).read_to_end(&mut decoded).unwrap();
        decoded
    }

    #[test]
    fn launch_defaults_reload_config_after_manager_boot() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("launch_defaults_reload");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let request = || LaunchModelDefaultsRequest {
            cwd: Some(root.clone()),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        };

        std::fs::write(
            nac_home.join("config.toml"),
            "[model]\nmodel = \"trinity-large-thinking\"\n",
        )
        .unwrap();
        let arcee_defaults = manager.launch_model_defaults(request()).unwrap();
        assert_eq!(
            arcee_defaults.configured_model.as_deref(),
            Some("trinity-large-thinking")
        );

        std::fs::write(
            nac_home.join("config.toml"),
            "[model]\nmodel = \"gpt-5.6-sol\"\nreasoning_effort = \"high\"\n",
        )
        .unwrap();
        let defaults = manager.launch_model_defaults(request()).unwrap();
        assert_eq!(defaults.configured_model.as_deref(), Some("gpt-5.6-sol"));
        assert_eq!(
            defaults.configured_reasoning_effort,
            Some(ReasoningEffort::High)
        );
        let serialized_defaults = serde_json::to_value(defaults).unwrap();
        assert_eq!(serialized_defaults["configured_model"], "gpt-5.6-sol");
        assert_eq!(serialized_defaults["configured_reasoning_effort"], "high");
        assert!(
            serde_json::to_value(manager.store_info())
                .unwrap()
                .get("configured_model")
                .is_none(),
            "root-only launch metadata must not remain on /store"
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn launch_defaults_use_local_cwd_but_server_root_for_ssh_with_relative_config_homes() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();

        for config_home_kind in ["NAC_HOME", "XDG_CONFIG_HOME", "HOME"] {
            let root = temp_root(&format!("launch_defaults_{config_home_kind}"));
            let workspace_a = root.join("workspace-a");
            let workspace_b = root.join("workspace-b");
            std::fs::create_dir_all(&workspace_a).unwrap();
            std::fs::create_dir_all(&workspace_b).unwrap();
            let relative_home = std::path::Path::new("relative-config-home");
            let _env = match config_home_kind {
                "NAC_HOME" => {
                    ScopedModelEnv::with_config_home(Some(relative_home), None, None, None)
                }
                "XDG_CONFIG_HOME" => {
                    ScopedModelEnv::with_config_home(None, Some(relative_home), None, None)
                }
                "HOME" => ScopedModelEnv::with_config_home(None, None, Some(relative_home), None),
                _ => unreachable!(),
            };
            let config_dir = |cwd: &std::path::Path| match config_home_kind {
                "NAC_HOME" => cwd.join(relative_home),
                "XDG_CONFIG_HOME" => cwd.join(relative_home).join("nac"),
                "HOME" => cwd.join(relative_home).join(".config").join("nac"),
                _ => unreachable!(),
            };
            for (cwd, model) in [
                (&root, "gpt-5.2"),
                (&workspace_a, "trinity-large-thinking"),
                (&workspace_b, "gpt-5.6-sol"),
            ] {
                let dir = config_dir(cwd);
                std::fs::create_dir_all(&dir).unwrap();
                std::fs::write(
                    dir.join("config.toml"),
                    format!("[model]\nmodel = \"{model}\"\n"),
                )
                .unwrap();
            }
            let manager = test_manager(&root);

            assert_eq!(
                manager
                    .launch_model_defaults(LaunchModelDefaultsRequest {
                        cwd: Some(workspace_a.clone()),
                        ssh_host: None,
                        ssh_port: None,
                        ssh_identity_file: None,
                    })
                    .unwrap()
                    .configured_model
                    .as_deref(),
                Some("trinity-large-thinking"),
                "{config_home_kind} local workspace A"
            );
            assert_eq!(
                manager
                    .launch_model_defaults(LaunchModelDefaultsRequest {
                        cwd: Some(workspace_b.clone()),
                        ssh_host: None,
                        ssh_port: None,
                        ssh_identity_file: None,
                    })
                    .unwrap()
                    .configured_model
                    .as_deref(),
                Some("gpt-5.6-sol"),
                "{config_home_kind} local workspace B"
            );
            assert_eq!(
                manager
                    .launch_model_defaults(LaunchModelDefaultsRequest {
                        cwd: Some(std::path::PathBuf::from("remote/project")),
                        ssh_host: Some(" build-box ".to_string()),
                        ssh_port: None,
                        ssh_identity_file: None,
                    })
                    .unwrap()
                    .configured_model
                    .as_deref(),
                Some("gpt-5.2"),
                "{config_home_kind} SSH must use the server root"
            );

            let _ = std::fs::remove_dir_all(root);
        }
    }

    #[test]
    fn launch_defaults_carry_the_configured_model_and_effort() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("launch_defaults_model_effort");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let request = || LaunchModelDefaultsRequest {
            cwd: Some(root.clone()),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        };

        std::fs::write(
            nac_home.join("config.toml"),
            "[model]\nmodel = \"gpt-5.2\"\nreasoning_effort = \"high\"\n",
        )
        .unwrap();
        let defaults = manager.launch_model_defaults(request()).unwrap();
        assert_eq!(defaults.configured_model.as_deref(), Some("gpt-5.2"));
        assert_eq!(
            defaults.configured_reasoning_effort,
            Some(ReasoningEffort::High)
        );
        let serialized = serde_json::to_value(defaults).unwrap();
        assert_eq!(serialized["configured_model"], "gpt-5.2");
        assert_eq!(serialized["configured_reasoning_effort"], "high");

        // Without a configured model/effort the fields serialize as null
        // (older frontends ignore them either way).
        std::fs::write(nac_home.join("config.toml"), "[model]\n").unwrap();
        let defaults = manager.launch_model_defaults(request()).unwrap();
        assert_eq!(defaults.configured_model, None);
        assert_eq!(defaults.configured_reasoning_effort, None);
        let serialized = serde_json::to_value(defaults).unwrap();
        assert!(serialized["configured_model"].is_null());
        assert!(serialized["configured_reasoning_effort"].is_null());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn commands_route_returns_registry() {
        let root = temp_root("commands_endpoint");
        let app = router(test_manager(&root));
        let response = get_response(app, "/commands", None).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await,
            serde_json::to_value(slash_command_definitions()).unwrap()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn session_skills_route_uses_the_attached_session_registry() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("session_skills");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        let skills = root.join(".nac/skills");
        for (name, description) in [
            ("zeta", "Last skill alphabetically"),
            ("demo", "Demonstrate the feature"),
        ] {
            let directory = skills.join(name);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(
                directory.join("SKILL.md"),
                format!(
                    "---\nname: {name}\ndescription: {description}\ncompatibility: nac\n---\n\n{name} body\n"
                ),
            )
            .unwrap();
        }

        let manager = test_manager(&root);
        let request = CreateSessionRequest {
            cwd: Some(root.clone()),
            model: RequestField::Value("gpt-5.2".to_string()),
            backend: RequestField::Value("openai-responses".to_string()),
            api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
            ..CreateSessionRequest::default()
        };
        let populated = manager.create_session(request.clone()).await.unwrap();
        let populated_id = populated.metadata.session_id.unwrap();

        let app = router(manager.clone());
        let response = get_response(
            app.clone(),
            &format!("/sessions/{populated_id}/skills"),
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response_json(response).await,
            serde_json::json!([
                {
                    "name": "demo",
                    "description": "Demonstrate the feature",
                    "compatibility": "nac"
                },
                {
                    "name": "zeta",
                    "description": "Last skill alphabetically",
                    "compatibility": "nac"
                }
            ])
        );
        std::fs::remove_dir_all(&skills).unwrap();
        let empty = manager.create_session(request).await.unwrap();
        let empty_id = empty.metadata.session_id.unwrap();

        let response =
            get_response(app.clone(), &format!("/sessions/{empty_id}/skills"), None).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response_json(response).await, serde_json::json!([]));

        let response = get_response(app, "/sessions/missing/skills", None).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn models_endpoint_serves_the_catalog_listing() {
        let root = temp_root("models_endpoint");
        let app = router(test_manager(&root));
        let response = get_response(app, "/models", None).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;

        assert!(body["catalog_version"].as_u64().unwrap() >= 1);
        let providers = body["providers"].as_array().unwrap();
        assert_eq!(providers.len(), 8);
        let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

        // Auth requirements and managed base URLs derive from the backend
        // kind, so they are exact regardless of the machine's catalog layers.
        assert_eq!(by_id("anthropic-messages")["auth"], "api_key_env");
        assert!(by_id("anthropic-messages")["managed_base_url"].is_null());
        assert_eq!(by_id("arcee-api")["auth"], "api_key_env");
        assert_eq!(by_id("arcee-auth")["auth"], "managed_arcee");
        assert_eq!(
            by_id("arcee-auth")["managed_base_url"],
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
        );
        assert_eq!(by_id("chatgpt-codex-responses")["auth"], "codex_oauth");

        // Catalog endpoint defaults: present for the five models.dev
        // providers and the hand-seeded arcee-api (exact values are pinned
        // hermetically in nac-core; a machine overlay could carry a
        // refreshed models.dev `api`), absent for the managed providers.
        for id in [
            "anthropic-messages",
            "deepseek-chat",
            "fireworks-chat",
            "openai-responses",
            "together-chat",
            "arcee-api",
        ] {
            assert!(
                by_id(id)["default_base_url"].is_string(),
                "{id} must serve a catalog default_base_url"
            );
        }
        for id in ["arcee-auth", "chatgpt-codex-responses"] {
            assert!(
                by_id(id)["default_base_url"].is_null(),
                "{id} must not serve a catalog default_base_url"
            );
        }
        assert_eq!(
            by_id("chatgpt-codex-responses")["managed_base_url"],
            nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL
        );
        // Managed providers without a stored credential hint their login
        // command (a code constant, independent of machine catalog layers).
        for (id, command) in [
            ("arcee-auth", "nac-web arcee-auth login"),
            ("chatgpt-codex-responses", "nac-web codex-auth login"),
        ] {
            if by_id(id)["auth_status"] == "no_credential" {
                assert_eq!(by_id(id)["auth_hint"], command, "{id}");
            }
        }

        // Every provider carries `_default` limits and real entries only
        // (never the `_default` id or a synthesis-product source). Values
        // stay unpinned here: the prod nac-core build layers the machine's
        // overlay/models.json, which may patch them — exact values are
        // pinned hermetically by the nac-core catalog tests.
        for provider in providers {
            // Auth status is computed per request from the machine's env
            // and credential files, so only the value domain and the
            // hint/status invariants are machine-independent here.
            let status = provider["auth_status"].as_str().unwrap();
            assert!(
                ["ready", "no_credential"].contains(&status),
                "unexpected auth_status: {status}"
            );
            let hint = &provider["auth_hint"];
            if status == "ready" {
                assert!(hint.is_null(), "ready providers carry no hint: {provider}");
            } else if provider["auth"] == "api_key_env" {
                assert!(
                    hint.as_str().is_some_and(|hint| !hint.is_empty()),
                    "no_credential API-key providers hint the conventional var: {provider}"
                );
            }
            let limits = &provider["default_limits"];
            assert!(limits["context_window"].as_u64().unwrap() > 0);
            assert!(limits["max_tokens"].as_u64().unwrap() > 0);
            assert!(limits["supported_efforts"].is_array());
            for model in provider["models"].as_array().unwrap() {
                assert_ne!(model["id"], "_default");
                assert!(
                    ["baseline", "overlay", "user_override"]
                        .contains(&model["source"].as_str().unwrap()),
                    "unexpected model source: {}",
                    model["source"]
                );
                assert!(model["context_window"].as_u64().unwrap() > 0);
                assert!(model["max_tokens"].as_u64().unwrap() > 0);
            }
        }

        // Baseline entries are always present: the overlay/user layers patch
        // or add, never remove.
        let anthropic_models = by_id("anthropic-messages")["models"].as_array().unwrap();
        let opus = anthropic_models
            .iter()
            .find(|m| m["id"] == "claude-opus-4-6")
            .expect("the embedded baseline's claude-opus-4-6 entry");
        assert!(opus["supported_efforts"].is_array());
        assert_eq!(opus["reasoning"], true);

        // The hand-seeded providers serve their maintained entries too.
        for (provider, model_id) in [
            ("arcee-auth", "trinity-large-thinking"),
            ("arcee-api", "trinity-large-thinking"),
            ("chatgpt-codex-responses", "gpt-5.6-sol"),
        ] {
            assert!(
                by_id(provider)["models"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|m| m["id"] == model_id),
                "the seed's {model_id} entry must reach the {provider} listing"
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn models_endpoint_computes_auth_status_from_the_environment() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("models_endpoint_status");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        // Isolated: no credential files, no config, OPENAI_API_KEY cleared.
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let app = router(test_manager(&root));

        let body = response_json(get_response(app.clone(), "/models", None).await).await;
        let providers = body["providers"].as_array().unwrap();
        let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();

        // Conventional var unset + no configured selector: no_credential
        // with the conventional name as the hint.
        assert_eq!(by_id("openai-responses")["auth_status"], "no_credential");
        assert_eq!(by_id("openai-responses")["auth_hint"], "OPENAI_API_KEY");
        // Managed providers without stored credentials hint the login
        // commands.
        assert_eq!(by_id("arcee-auth")["auth_status"], "no_credential");
        assert_eq!(by_id("arcee-auth")["auth_hint"], "nac-web arcee-auth login");
        assert_eq!(
            by_id("chatgpt-codex-responses")["auth_status"],
            "no_credential"
        );
        assert_eq!(
            by_id("chatgpt-codex-responses")["auth_hint"],
            "nac-web codex-auth login"
        );

        // The conventional variable naming a set value reads ready — the
        // same variable session resolution auto-selects. Unrelated
        // providers still report only their conventional credential hint.
        unsafe { std::env::set_var("OPENAI_API_KEY", "server-test-key") };
        let body = response_json(get_response(app.clone(), "/models", None).await).await;
        let providers = body["providers"].as_array().unwrap();
        let by_id = |id: &str| providers.iter().find(|p| p["id"] == id).unwrap();
        assert_eq!(by_id("openai-responses")["auth_status"], "ready");
        assert!(by_id("openai-responses")["auth_hint"].is_null());
        assert_eq!(by_id("anthropic-messages")["auth_status"], "no_credential");
        assert_eq!(
            by_id("anthropic-messages")["auth_hint"],
            "ANTHROPIC_API_KEY"
        );

        // A parseable stored credential flips its managed provider.
        std::fs::write(
            nac_home.join("auth.json"),
            r#"{"type":"chatgpt-codex","access":"access-test","refresh":"refresh-test","expires_at_ms":18446744073709551615,"account_id":"account-test"}"#,
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(
                nac_home.join("auth.json"),
                std::fs::Permissions::from_mode(0o600),
            )
            .unwrap();
        }
        let body = response_json(get_response(app, "/models", None).await).await;
        let providers = body["providers"].as_array().unwrap();
        let codex = providers
            .iter()
            .find(|p| p["id"] == "chatgpt-codex-responses")
            .unwrap();
        assert_eq!(codex["auth_status"], "ready");
        assert!(codex["auth_hint"].is_null());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn create_session_request_deserializes_optional_ssh_host() {
        let with_host: CreateSessionRequest = serde_json::from_str(
            r#"{"ssh_host":"build-box","backend":"together-chat","api_key_env":"TOGETHER_CUSTOM_KEY","extra_headers":"{\"X-Launch\":\"yes\"}"}"#,
        )
        .unwrap();
        assert_eq!(with_host.ssh_host.as_deref(), Some("build-box"));
        assert_eq!(with_host.behavior, sessions::SessionBehavior::Orchestrator);
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

        let direct: CreateSessionRequest =
            serde_json::from_str(r#"{"behavior":"direct"}"#).unwrap();
        assert_eq!(direct.behavior, sessions::SessionBehavior::Direct);
        assert!(
            serde_json::from_str::<CreateSessionRequest>(r#"{"behavior":"future-behavior"}"#)
                .is_err()
        );
    }

    #[tokio::test]
    async fn create_session_rejects_ssh_host_combined_with_sandbox() {
        let root = temp_root("host_sandbox_conflict");
        let manager = test_manager(&root);

        let request = CreateSessionRequest {
            behavior: sessions::SessionBehavior::Orchestrator,
            first_chat: false,
            project_id: None,
            cwd: None,
            model: RequestField::Omitted,
            base_url: RequestField::Omitted,
            backend: RequestField::Omitted,
            reasoning_effort: RequestField::Omitted,
            api_key_env: RequestField::Omitted,
            extra_headers: RequestField::Omitted,
            orchestrator_compaction_threshold: RequestField::Omitted,
            light_model: RequestField::Omitted,
            ssh_host: Some("build-box".to_string()),
            ssh_port: None,
            ssh_identity_file: None,
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
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("removed_backend_create");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);

        for backend in ["arcee", "auto"] {
            let error = manager
                .create_session(CreateSessionRequest {
                    behavior: sessions::SessionBehavior::Orchestrator,
                    first_chat: false,
                    project_id: None,
                    cwd: None,
                    model: RequestField::Omitted,
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    backend: RequestField::Value(backend.to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                    ssh_host: None,
                    ssh_port: None,
                    ssh_identity_file: None,
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
                        model: RequestField::Value("trinity-large-thinking".to_string()),
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                        orchestrator_compaction_threshold: RequestField::Omitted,
                        light_model: RequestField::Omitted,
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
                        model: RequestField::Value("trinity-large-thinking".to_string()),
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                        orchestrator_compaction_threshold: RequestField::Omitted,
                        light_model: RequestField::Omitted,
                    },
                )
                .await
                .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("unsafe permissions 0644"));
            assert!(!format!("{error:#}").contains("arcee-access-server-test"));
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
                        model: RequestField::Value("trinity-large-thinking".to_string()),
                        base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                        backend: RequestField::Value("arcee-auth".to_string()),
                        reasoning_effort: RequestField::Omitted,
                        api_key_env: RequestField::Omitted,
                        extra_headers: RequestField::Omitted,
                        orchestrator_compaction_threshold: RequestField::Omitted,
                        light_model: RequestField::Omitted,
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

    fn test_transcript() -> Vec<Message> {
        vec![
            Message::System {
                content: "hidden system preface".to_string(),
            },
            Message::User {
                content: "old cycle".to_string(),
            },
            Message::Assistant {
                content: Some("old answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::User {
                content: "current cycle".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("thinking".to_string()),
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::Assistant {
                content: None,
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![nac_core::types::ToolCall {
                    id: "call-thread".to_string(),
                    call_type: "function".to_string(),
                    function: nac_core::types::FunctionCall {
                        name: "thread".to_string(),
                        arguments: r#"{"name":"current/research"}"#.to_string(),
                    },
                }]),
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::System {
                content: "hidden tail".to_string(),
            },
            Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ]
    }

    fn seed_session_with_messages(
        root: &std::path::Path,
        session_id: &str,
        created_at: &str,
        messages: Vec<Message>,
    ) {
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
            root.to_path_buf(),
            "model-a".to_string(),
            "https://api.openai.com/v1".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            messages,
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );
        snapshot.created_at = created_at.to_string();
        snapshot.updated_at = created_at.to_string();
        sessions::create_session(&root.join("store.db"), &snapshot).expect("seed session messages");
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

    fn seed_direct_session(root: &std::path::Path, session_id: &str) {
        seed_direct_session_with_base_url(
            root,
            session_id,
            "https://api.openai.com/v1".to_string(),
        );
    }

    fn seed_direct_session_with_base_url(
        root: &std::path::Path,
        session_id: &str,
        base_url: String,
    ) {
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
            root.to_path_buf(),
            "model-a".to_string(),
            base_url,
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Medium),
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );
        snapshot.behavior = sessions::SessionBehavior::Direct;
        sessions::create_session(&root.join("store.db"), &snapshot).expect("seed direct session");
    }

    fn seed_direct_with_orchestrator_session_with_base_url(
        root: &std::path::Path,
        session_id: &str,
        base_url: String,
    ) {
        let mut snapshot = sessions::new_snapshot(
            session_id.to_string(),
            root.to_path_buf(),
            "model-a".to_string(),
            base_url,
            BackendKind::OpenAiResponses,
            Some(ReasoningEffort::Medium),
            None,
            None,
            Vec::new(),
            Some("OPENAI_API_KEY".to_string()),
            BTreeMap::new(),
        );
        snapshot.behavior = sessions::SessionBehavior::DirectWithOrchestrator;
        sessions::create_session(&root.join("store.db"), &snapshot)
            .expect("seed direct-with-orchestrator session");
    }

    fn scripted_direct_response() -> (String, std::sync::mpsc::Receiver<()>) {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind direct model");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept direct model request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "resumed"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).unwrap();
            socket.flush().unwrap();
            sender.send(()).unwrap();
        });
        (base_url, receiver)
    }

    fn scripted_direct_responses(responses: &[&str]) -> (String, std::sync::mpsc::Receiver<usize>) {
        use std::io::{Read, Write};

        let listener =
            std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind scripted direct model");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let responses = responses
            .iter()
            .map(|response| response.to_string())
            .collect::<Vec<_>>();
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for (index, text) in responses.into_iter().enumerate() {
                let (mut socket, _) = listener.accept().expect("accept direct model request");
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                    match socket.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(read) => request.extend_from_slice(&buffer[..read]),
                    }
                }
                let body = serde_json::json!({
                    "status": "completed",
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string();
                let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).unwrap();
                socket.flush().unwrap();
                sender.send(index).unwrap();
            }
        });
        (base_url, receiver)
    }

    fn stalled_then_scripted_direct_response() -> (
        String,
        std::sync::mpsc::Receiver<usize>,
        std::sync::mpsc::Sender<()>,
    ) {
        use std::io::{Read, Write};

        let listener =
            std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind stalled direct model");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (request_sender, request_receiver) = std::sync::mpsc::channel();
        let (release_sender, release_receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept direct model request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            request_sender.send(0).unwrap();
            release_receiver.recv().unwrap();
            let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "cancelled child response"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes());
            let _ = socket.flush();
        });
        (base_url, request_receiver, release_sender)
    }

    #[tokio::test]
    async fn attaching_direct_session_wakes_oldest_persisted_inbox_item() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("direct_inbox_reattach");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-reattach-test-key"));
        let (base_url, request_finished) = scripted_direct_response();
        seed_direct_session_with_base_url(&root, "direct", base_url);
        let store_path = root.join("store.db");
        let pending = nac_core::store::create_session_inbox_item(
            &store_path,
            "direct",
            InboxDelivery::Queue,
            "survive restart",
            None,
            None,
        )
        .unwrap();

        let manager = test_manager(&root);
        let service = manager.attach_session("direct").await.unwrap();
        tokio::task::spawn_blocking(move || {
            request_finished
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while service.has_active_operation() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("reattached direct run should finish");

        let delivered =
            nac_core::store::load_session_inbox_item(&store_path, "direct", pending.id).unwrap();
        assert_eq!(delivered.status, nac_core::store::InboxStatus::Delivered);
        assert!(delivered.delivered_run_id.is_some());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn attaching_direct_session_reconciles_one_stale_goal_claim_without_duplicate_start() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("direct_goal_reattach");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-goal-reattach-key"));
        let (base_url, request_finished) = scripted_direct_response();
        seed_direct_session_with_base_url(&root, "direct", base_url);
        let store_path = root.join("store.db");
        nac_core::store::create_session_goal(
            &store_path,
            "direct",
            "resume exactly once",
            Some(15),
            None,
        )
        .unwrap();
        nac_core::store::bind_session_goal_run(
            &store_path,
            "direct",
            &nac_core::store::GoalRunBaseline {
                run_id: "stale-run".to_string(),
                billable_tokens: 0,
                started_at_epoch_ms: 1,
                continuation: true,
            },
        )
        .unwrap();

        let manager = test_manager(&root);
        let service = manager.attach_session("direct").await.unwrap();
        tokio::task::spawn_blocking(move || {
            request_finished
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let goal = service.direct_goal().unwrap().unwrap();
                if !service.has_active_operation() && goal.status == GoalStatus::BudgetLimited {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("one recovered continuation should settle at its budget");
        let goal = service.direct_goal().unwrap().unwrap();
        assert_eq!(goal.tokens_used, 15);
        assert!(goal.continuation_run_id.is_none());
        assert_ne!(goal.accounting_run_id.as_deref(), Some("stale-run"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn direct_inbox_http_api_lists_edits_and_cancels_pending_input() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("direct_inbox_http");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-inbox-test-key"));
        seed_direct_session(&root, "direct");
        seed_editable_session(&root, "orchestrator");
        let store_path = root.join("store.db");
        let _lease = sessions::SessionOperationLease::try_acquire(&store_path, "direct").unwrap();
        let app = router(test_manager(&root));

        let create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/inbox")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"delivery":"queue","prompt":"do this later"}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        let create_status = create.status();
        let create_body = response_body(create).await;
        assert_eq!(
            create_status,
            StatusCode::ACCEPTED,
            "{}",
            String::from_utf8_lossy(&create_body)
        );
        let created: InboxItemResponse = serde_json::from_slice(&create_body).unwrap();
        assert_eq!(created.status, nac_core::store::InboxStatus::Pending);
        assert_eq!(created.prompt, "do this later");

        let list = get_response(app.clone(), "/sessions/direct/inbox", None).await;
        assert_eq!(list.status(), StatusCode::OK);
        let listed: Vec<InboxItemResponse> =
            serde_json::from_slice(&response_body(list).await).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let update = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/direct/inbox/{}", created.id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{},"delivery":"steer"}}"#,
                        created.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(update.status(), StatusCode::OK);
        let updated: InboxItemResponse =
            serde_json::from_slice(&response_body(update).await).unwrap();
        assert_eq!(updated.delivery, InboxDelivery::Steer);
        assert_eq!(updated.target_run_id, None);

        let stale = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/direct/inbox/{}", created.id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{},"delivery":"queue"}}"#,
                        created.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);

        let cancel = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/sessions/direct/inbox/{}", created.id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{}}}"#,
                        updated.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cancel.status(), StatusCode::OK);
        let cancelled: InboxItemResponse =
            serde_json::from_slice(&response_body(cancel).await).unwrap();
        assert_eq!(cancelled.status, nac_core::store::InboxStatus::Cancelled);

        let rejected = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/orchestrator/inbox")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"delivery":"queue","prompt":"not here"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn direct_permission_http_api_lists_replies_and_removes_revision_bound_grants() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("direct_permission_http");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-permission-test-key"));
        seed_direct_session(&root, "direct");
        seed_editable_session(&root, "orchestrator");
        let grant_id = nac_core::store::insert_permission_grants(
            &root.join("store.db"),
            "direct",
            "execute",
            &["command:[cargo][test]*".to_string()],
            "local",
            0,
        )
        .unwrap()[0]
            .id
            .clone();
        let app = router(test_manager(&root));

        let list = get_response(app.clone(), "/sessions/direct/permissions", None).await;
        assert_eq!(list.status(), StatusCode::OK);
        let state: PermissionStateResponse =
            serde_json::from_slice(&response_body(list).await).unwrap();
        assert!(state.requests.is_empty());
        assert_eq!(state.grants.len(), 1);
        assert_eq!(state.grants[0].id, grant_id);

        let missing_reply = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/permissions/missing")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"reply":"once"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_reply.status(), StatusCode::NOT_FOUND);

        let delete = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/sessions/direct/permissions/grants/{grant_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete.status(), StatusCode::NO_CONTENT);
        let list = get_response(app.clone(), "/sessions/direct/permissions", None).await;
        let state: PermissionStateResponse =
            serde_json::from_slice(&response_body(list).await).unwrap();
        assert!(state.grants.is_empty());

        let rejected = get_response(app, "/sessions/orchestrator/permissions", None).await;
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn direct_goal_http_api_creates_edits_pauses_resumes_and_clears() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("direct_goal_http");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("direct-goal-test-key"));
        seed_direct_session(&root, "direct");
        seed_editable_session(&root, "orchestrator");
        let endpoint = point_session_at_hanging_endpoint(&root, "direct").await;
        let manager = test_manager(&root);
        manager
            .submit_prompt(
                "direct",
                SubmitPromptRequest {
                    prompt: "hold the local run open".to_string(),
                },
            )
            .await
            .unwrap();
        let app = router(manager.clone());

        let empty = get_response(app.clone(), "/sessions/direct/goal", None).await;
        assert_eq!(empty.status(), StatusCode::OK);
        assert_eq!(response_body(empty).await.as_ref(), b"null");

        let create = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/goal")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"objective":"ship the feature","token_budget":500}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(create.status(), StatusCode::CREATED);
        let created: SessionGoalRecord =
            serde_json::from_slice(&response_body(create).await).unwrap();
        assert_eq!(created.status, GoalStatus::Active);
        assert_eq!(created.token_budget, Some(500));

        let pause = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/direct/goal/{}", created.goal_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{},"objective":"ship safely","token_budget":null,"status":"paused"}}"#,
                        created.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(pause.status(), StatusCode::OK);
        let paused: SessionGoalRecord =
            serde_json::from_slice(&response_body(pause).await).unwrap();
        assert_eq!(paused.objective, "ship safely");
        assert_eq!(paused.token_budget, None);
        assert_eq!(paused.status, GoalStatus::Paused);

        let resume = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/direct/goal/{}", paused.goal_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{},"status":"active"}}"#,
                        paused.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resume.status(), StatusCode::OK);
        let resumed: SessionGoalRecord =
            serde_json::from_slice(&response_body(resume).await).unwrap();
        assert_eq!(resumed.status, GoalStatus::Active);

        let clear = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/sessions/direct/goal/{}", resumed.goal_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"expected_version":{}}}"#,
                        resumed.version
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(clear.status(), StatusCode::NO_CONTENT);

        let rejected = get_response(app, "/sessions/orchestrator/goal", None).await;
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        manager.cancel_active_run("direct").await.unwrap();
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn traditional_child_goal_http_api_is_bad_request() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("traditional_child_goal_http");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("child-goal-test-key"));
        seed_direct_session(&root, "direct");
        let manager = test_manager(&root);
        let child_session_id = manager
            .create_traditional_child_session("direct", "general", "child goal ownership")
            .await
            .unwrap();
        let app = router(manager);

        let response = get_response(app, &format!("/sessions/{child_session_id}/goal"), None).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body: serde_json::Value =
            serde_json::from_slice(&response_body(response).await).unwrap();
        assert_eq!(
            body["error"],
            serde_json::Value::String(
                "traditional child sessions cannot own autonomous goals".to_string()
            )
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn managed_orchestrator_http_api_runs_foreground_then_delivers_background_completion() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_orchestrator_http");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-test-key"));
        let (base_url, requests) = scripted_direct_responses(&[
            "foreground orchestrator done",
            "background orchestrator done",
            "parent received orchestrator completion",
        ]);
        seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
        seed_direct_session(&root, "ordinary-direct");
        seed_editable_session(&root, "orchestrator");
        let manager = test_manager(&root);
        let app = router(manager.clone());

        let foreground = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"description":"implement durable control","prompt":"complete the first pass","background":false}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(foreground.status(), StatusCode::CREATED);
        let foreground: ManagedOrchestratorRecord =
            serde_json::from_slice(&response_body(foreground).await).unwrap();
        assert_eq!(foreground.status, ManagedOrchestratorStatus::Completed);
        assert_eq!(foreground.generation, 1);
        assert_eq!(
            foreground.report.as_deref(),
            Some("foreground orchestrator done")
        );
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
        let child_snapshot =
            sessions::load_session(&root.join("store.db"), &foreground.orchestrator_session_id)
                .unwrap();
        assert_eq!(
            child_snapshot.behavior,
            sessions::SessionBehavior::Orchestrator
        );
        let lineage_response = get_response(
            app.clone(),
            &format!(
                "/sessions/{}?include_sessions=false",
                foreground.orchestrator_session_id
            ),
            None,
        )
        .await;
        assert_eq!(lineage_response.status(), StatusCode::OK);
        let lineage_json = response_json(lineage_response).await;
        assert_eq!(lineage_json["lineage"]["kind"], "managed-orchestrator");
        assert_eq!(lineage_json["lineage"]["parent_session_id"], "delegating");
        assert_eq!(
            lineage_json["lineage"]["description"],
            "implement durable control"
        );

        let background = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"description":"implement durable control","prompt":"complete the second pass","orchestrator_session_id":"{}","background":true}}"#,
                        foreground.orchestrator_session_id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(background.status(), StatusCode::CREATED);
        let background: ManagedOrchestratorRecord =
            serde_json::from_slice(&response_body(background).await).unwrap();
        assert_eq!(background.status, ManagedOrchestratorStatus::Running);
        assert_eq!(background.generation, 2);
        assert_eq!(
            background.execution_mode,
            Some(ManagedOrchestratorExecutionMode::Background)
        );
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
        })
        .await
        .unwrap();

        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let orchestrator = manager
                    .managed_orchestrator("delegating", &foreground.orchestrator_session_id)
                    .unwrap();
                if orchestrator.status == ManagedOrchestratorStatus::Completed {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("background orchestrator should settle");
        let completed = manager
            .managed_orchestrator("delegating", &foreground.orchestrator_session_id)
            .unwrap();
        assert_eq!(completed.generation, 2);
        assert_eq!(
            completed.report.as_deref(),
            Some("background orchestrator done")
        );
        assert!(completed.completion_inbox_id.is_some());
        let inbox =
            nac_core::store::list_session_inbox(&root.join("store.db"), "delegating").unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
        assert!(inbox[0]
            .content
            .contains(&foreground.orchestrator_session_id));

        assert_eq!(
            get_response(app.clone(), "/sessions/ordinary-direct/orchestrators", None)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            get_response(app, "/sessions/orchestrator/orchestrators", None)
                .await
                .status(),
            StatusCode::BAD_REQUEST
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn managed_binding_failure_precedes_run_and_prompt_execution() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_binding_before_execution");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-bind-test-key"));
        seed_editable_session(&root, "orchestrator");
        let manager = test_manager(&root);
        let orchestrator = "orchestrator".to_string();
        let store_path = root.join("store.db");

        let error = manager
            .submit_managed_orchestrator_prompt(
                &orchestrator,
                SubmitPromptRequest {
                    prompt: "must never execute".to_string(),
                },
                ManagedOrchestratorExecutionMode::Background,
            )
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "session operation coordination failed");
        let service = manager
            .inner
            .active_sessions
            .read()
            .await
            .get(&orchestrator)
            .cloned()
            .unwrap();
        assert!(service.active_run().is_none());
        assert!(
            nac_core::store::load_run_recovery(&store_path, &orchestrator)
                .unwrap()
                .is_none()
        );
        assert!(sessions::load_session(&store_path, &orchestrator)
            .unwrap()
            .messages
            .is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn managed_orchestrator_cancel_propagates_and_delivers_once() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_orchestrator_cancel");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-cancel-key"));
        let (base_url, requests, release) = stalled_then_scripted_direct_response();
        seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
        let manager = test_manager(&root);
        let app = router(manager.clone());

        let started = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/delegating/orchestrators")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"description":"cancel flow","prompt":"wait until cancelled","background":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(started.status(), StatusCode::CREATED);
        let running: ManagedOrchestratorRecord =
            serde_json::from_slice(&response_body(started).await).unwrap();
        let continued = nac_core::orchestration_control::controller_for(&root.join("store.db"))
            .unwrap()
            .start(
                nac_core::orchestration_control::ManagedOrchestratorStartRequest {
                    parent_session_id: "delegating".to_string(),
                    orchestrator_session_id: Some(running.orchestrator_session_id.clone()),
                    description: "cancel flow".to_string(),
                    prompt: "additional foreground steering".to_string(),
                    execution_mode: ManagedOrchestratorExecutionMode::Foreground,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            continued.execution_mode,
            Some(ManagedOrchestratorExecutionMode::Background),
            "continuation must not rewrite the admitted generation mode"
        );
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
        })
        .await
        .unwrap();

        let cancelled = tokio::time::timeout(
            Duration::from_secs(10),
            app.oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/sessions/delegating/orchestrators/{}/cancel",
                        running.orchestrator_session_id
                    ))
                    .body(Body::empty())
                    .unwrap(),
            ),
        )
        .await
        .expect("managed orchestrator cancellation should not hang")
        .unwrap();
        assert_eq!(cancelled.status(), StatusCode::OK);
        let cancelled: ManagedOrchestratorRecord =
            serde_json::from_slice(&response_body(cancelled).await).unwrap();
        assert_eq!(cancelled.status, ManagedOrchestratorStatus::Cancelled);
        release.send(()).unwrap();

        let inbox =
            nac_core::store::list_session_inbox(&root.join("store.db"), "delegating").unwrap();
        assert_eq!(inbox.len(), 1);
        assert!(inbox[0].content.contains("cancelled"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn parent_attachment_reconciles_abandoned_managed_orchestrator_once() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_orchestrator_restart");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-orchestrator-restart-key"));
        let (base_url, requests) =
            scripted_direct_responses(&["parent acknowledged interrupted orchestrator"]);
        seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
        let store_path = root.join("store.db");

        let first = test_manager(&root);
        let child_session_id = first
            .create_managed_orchestrator_session("delegating", "survive restart")
            .await
            .unwrap();
        nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &child_session_id,
            "abandoned-orchestrator-run",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        nac_core::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .append_run_prompt(
                &child_session_id,
                0,
                &Message::User {
                    content: "work interrupted by restart".to_string(),
                },
                "abandoned-orchestrator-run",
            )
            .unwrap();
        drop(first);

        let rebuilt = test_manager(&root);
        rebuilt.snapshot("delegating").await.unwrap();
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let relation =
                    nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
                        .unwrap()
                        .unwrap();
                let inbox = nac_core::store::list_session_inbox(&store_path, "delegating").unwrap();
                if relation.status.is_terminal()
                    && inbox
                        .first()
                        .is_some_and(|item| item.status == nac_core::store::InboxStatus::Delivered)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("restart reconciliation should interrupt and deliver");
        rebuilt.snapshot("delegating").await.unwrap();
        let relation = nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
            .unwrap()
            .unwrap();
        let inbox = nac_core::store::list_session_inbox(&store_path, "delegating").unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(relation.status, ManagedOrchestratorStatus::Interrupted);
        assert_eq!(relation.completion_inbox_id, Some(inbox[0].id));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn parent_attachment_settles_canonical_managed_terminal_once_after_restart() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_orchestrator_terminal_restart");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("managed-terminal-restart-key"));
        let (base_url, requests) =
            scripted_direct_responses(&["parent acknowledged completed orchestrator"]);
        seed_direct_with_orchestrator_session_with_base_url(&root, "delegating", base_url);
        let store_path = root.join("store.db");

        let first = test_manager(&root);
        let orchestrator = first
            .create_managed_orchestrator_session("delegating", "finish before restart")
            .await
            .unwrap();
        nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &orchestrator,
            "terminal-run",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        let snapshot = sessions::load_session(&store_path, &orchestrator).unwrap();
        let start_idx = snapshot.messages.len() as u64;
        let writer = nac_core::store::TranscriptLogWriter::new(&store_path).unwrap();
        writer
            .append_run_prompt(
                &orchestrator,
                start_idx,
                &Message::User {
                    content: "complete durably".to_string(),
                },
                "terminal-run",
            )
            .unwrap();
        writer
            .append(
                &orchestrator,
                start_idx + 1,
                &Message::Assistant {
                    content: Some("durable orchestrator report".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            )
            .unwrap();
        let mut terminal_snapshot = snapshot;
        let mut update = terminal_snapshot.apply_run_state(sessions::SessionRunState::default());
        update.finished_run_id = Some("terminal-run".to_string());
        update.finished_run_disposition = Some(nac_core::store::RunTerminalDisposition::Completed);
        sessions::save_session_run_state(&store_path, &update).unwrap();
        assert!(
            nac_core::store::load_run_recovery(&store_path, &orchestrator)
                .unwrap()
                .unwrap()
                .terminal_disposition
                .is_some()
        );
        drop(first);

        let rebuilt = test_manager(&root);
        rebuilt.snapshot("delegating").await.unwrap();
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let relation =
                    nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
                        .unwrap()
                        .unwrap();
                if relation.status == ManagedOrchestratorStatus::Completed
                    && relation.completion_inbox_id.is_some()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("canonical terminal obligation should settle");
        rebuilt.snapshot("delegating").await.unwrap();
        let relation = nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
            .unwrap()
            .unwrap();
        assert_eq!(
            relation.report.as_deref(),
            Some("durable orchestrator report")
        );
        assert!(
            nac_core::store::load_run_recovery(&store_path, &orchestrator)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            nac_core::store::list_session_inbox(&store_path, "delegating")
                .unwrap()
                .len(),
            1
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deleting_parent_removes_managed_orchestrator_sessions() {
        let root = temp_root("managed_orchestrator_delete");
        seed_direct_with_orchestrator_session_with_base_url(
            &root,
            "delegating",
            "https://api.openai.com/v1".to_string(),
        );
        let manager = test_manager(&root);
        let child_session_id = manager
            .create_managed_orchestrator_session("delegating", "delete with parent")
            .await
            .unwrap();
        manager.delete_session("delegating").await.unwrap();
        let store_path = root.join("store.db");
        assert!(sessions::load_session(&store_path, "delegating").is_err());
        assert!(sessions::load_session(&store_path, &child_session_id).is_err());
        assert!(
            nac_core::store::load_managed_orchestrator(&store_path, &child_session_id)
                .unwrap()
                .is_none()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deleting_project_skips_descendants_already_removed_by_parent_cascade() {
        let root = temp_root("project_parent_cascade_delete")
            .canonicalize()
            .unwrap();
        seed_direct_with_orchestrator_session_with_base_url(
            &root,
            "delegating",
            "https://api.openai.com/v1".to_string(),
        );
        let manager = test_manager(&root);
        let project = manager
            .create_project(CreateProjectRequest {
                name: Some("Cascade delete".to_string()),
                description: None,
                cwd: root.clone(),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            })
            .await
            .unwrap();
        manager
            .assign_session_to_project(&project.project_id, "delegating")
            .unwrap();
        let child_session_id = manager
            .create_managed_orchestrator_session("delegating", "cascade with project")
            .await
            .unwrap();
        manager
            .update_session_presentation("delegating", "Pinned parent", true, 0)
            .await
            .unwrap();

        let deleted = manager
            .delete_project_with_sessions(&project.project_id)
            .await
            .unwrap();
        assert!(deleted.contains(&"delegating".to_string()));
        assert!(deleted.contains(&child_session_id));
        let store_path = root.join("store.db");
        assert!(sessions::load_session(&store_path, "delegating").is_err());
        assert!(sessions::load_session(&store_path, &child_session_id).is_err());
        assert!(projects::list_projects(&store_path).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn traditional_child_http_api_runs_foreground_then_delivers_background_completion() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("traditional_child_http");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-test-key"));
        let (base_url, requests) = scripted_direct_responses(&[
            "foreground child done\n\n## Verification\nfocused test passed",
            "background child done",
            "parent received child completion",
        ]);
        seed_direct_session_with_base_url(&root, "direct", base_url);
        seed_editable_session(&root, "orchestrator");
        let manager = test_manager(&root);
        let app = router(manager.clone());

        let foreground = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":"general","description":"inspect child flow","prompt":"inspect the flow","background":false}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(foreground.status(), StatusCode::CREATED);
        let foreground: TraditionalChildRecord =
            serde_json::from_slice(&response_body(foreground).await).unwrap();
        assert_eq!(
            foreground.status,
            nac_core::store::TraditionalChildStatus::Completed
        );
        assert_eq!(foreground.generation, 1);
        assert_eq!(
            foreground.report.as_deref(),
            Some("foreground child done\n\n## Verification\nfocused test passed")
        );
        assert_eq!(
            foreground.verification_summary.as_deref(),
            Some("focused test passed")
        );
        assert!(
            nac_core::store::list_session_inbox(&root.join("store.db"), "direct")
                .unwrap()
                .is_empty()
        );
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);

        let background = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"profile":"general","description":"inspect child flow","prompt":"continue with the second pass","child_session_id":"{}","background":true}}"#,
                        foreground.child_session_id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(background.status(), StatusCode::CREATED);
        let background: TraditionalChildRecord =
            serde_json::from_slice(&response_body(background).await).unwrap();
        assert_eq!(background.child_session_id, foreground.child_session_id);
        assert_eq!(background.generation, 2);
        assert_eq!(
            background.status,
            nac_core::store::TraditionalChildStatus::Running
        );
        assert_eq!(
            background.execution_mode,
            Some(TraditionalChildExecutionMode::Background)
        );
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
        })
        .await
        .unwrap();

        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let child = manager
                    .traditional_child("direct", &foreground.child_session_id)
                    .unwrap();
                if child.status == nac_core::store::TraditionalChildStatus::Completed {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("background child should settle");
        let status = get_response(
            app.clone(),
            &format!("/sessions/direct/children/{}", foreground.child_session_id),
            None,
        )
        .await;
        assert_eq!(status.status(), StatusCode::OK);
        let completed: TraditionalChildRecord =
            serde_json::from_slice(&response_body(status).await).unwrap();
        assert_eq!(completed.generation, 2);
        assert_eq!(completed.report.as_deref(), Some("background child done"));
        assert!(completed.completion_inbox_id.is_some());
        let parent_inbox =
            nac_core::store::list_session_inbox(&root.join("store.db"), "direct").unwrap();
        assert_eq!(parent_inbox.len(), 1);
        assert_eq!(
            parent_inbox[0].status,
            nac_core::store::InboxStatus::Delivered
        );
        assert!(parent_inbox[0]
            .content
            .contains(&foreground.child_session_id));

        let child_snapshot =
            sessions::load_session(&root.join("store.db"), &foreground.child_session_id).unwrap();
        assert_eq!(child_snapshot.behavior, sessions::SessionBehavior::Direct);
        assert!(matches!(
            child_snapshot.messages.first(),
            Some(Message::System { content }) if content.contains("traditional child coding agent")
        ));
        let lineage_response = get_response(
            app.clone(),
            &format!(
                "/sessions/{}?include_sessions=false",
                foreground.child_session_id
            ),
            None,
        )
        .await;
        assert_eq!(lineage_response.status(), StatusCode::OK);
        let lineage_json = response_json(lineage_response).await;
        assert_eq!(lineage_json["lineage"]["kind"], "traditional-child");
        assert_eq!(lineage_json["lineage"]["parent_session_id"], "direct");
        assert_eq!(lineage_json["lineage"]["description"], "inspect child flow");

        let rejected = get_response(app, "/sessions/orchestrator/children", None).await;
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn traditional_child_cancel_endpoint_propagates_to_active_generation() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("traditional_child_cancel");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-cancel-key"));
        let (base_url, requests, release) = stalled_then_scripted_direct_response();
        seed_direct_session_with_base_url(&root, "direct", base_url);
        let manager = test_manager(&root);
        let app = router(manager.clone());

        let start = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":"general","description":"cancel active child","prompt":"wait for cancellation","background":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(start.status(), StatusCode::CREATED);
        let running: TraditionalChildRecord =
            serde_json::from_slice(&response_body(start).await).unwrap();
        assert_eq!(
            running.status,
            nac_core::store::TraditionalChildStatus::Running
        );
        let continued = nac_core::traditional_children::controller_for(&root.join("store.db"))
            .unwrap()
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: "direct".to_string(),
                    child_session_id: Some(running.child_session_id.clone()),
                    profile: "general".to_string(),
                    description: "cancel active child".to_string(),
                    prompt: "additional foreground steering".to_string(),
                    execution_mode: TraditionalChildExecutionMode::Foreground,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            continued.execution_mode,
            Some(TraditionalChildExecutionMode::Background),
            "continuation must not rewrite the admitted generation mode"
        );
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
        })
        .await
        .unwrap();

        let cancel = tokio::time::timeout(
            Duration::from_secs(10),
            app.clone().oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!(
                        "/sessions/direct/children/{}/cancel",
                        running.child_session_id
                    ))
                    .body(Body::empty())
                    .unwrap(),
            ),
        )
        .await
        .expect("cancel endpoint should not hang")
        .unwrap();
        assert_eq!(cancel.status(), StatusCode::OK);
        let cancelled: TraditionalChildRecord =
            serde_json::from_slice(&response_body(cancel).await).unwrap();
        assert_eq!(
            cancelled.status,
            nac_core::store::TraditionalChildStatus::Cancelled
        );
        assert_eq!(cancelled.generation, 1);
        assert!(cancelled.completion_inbox_id.is_some());
        release.send(()).unwrap();

        let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "direct").unwrap();
        assert_eq!(inbox.len(), 1);
        assert!(inbox[0].content.contains("cancelled"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn parent_attachment_reconciles_abandoned_background_child_exactly_once() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("traditional_child_restart");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-restart-key"));
        let (base_url, requests) =
            scripted_direct_responses(&["parent acknowledged interrupted child"]);
        seed_direct_session_with_base_url(&root, "direct", base_url);
        let store_path = root.join("store.db");

        let first_manager = test_manager(&root);
        let child_session_id = first_manager
            .create_traditional_child_session("direct", "general", "survive server restart")
            .await
            .unwrap();
        nac_core::store::begin_traditional_child_run(
            &store_path,
            &child_session_id,
            "abandoned-child-run",
            TraditionalChildExecutionMode::Background,
        )
        .unwrap();
        nac_core::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .append_run_prompt(
                &child_session_id,
                1,
                &Message::User {
                    content: "work interrupted by restart".to_string(),
                },
                "abandoned-child-run",
            )
            .unwrap();
        drop(first_manager);

        let rebuilt = test_manager(&root);
        rebuilt.snapshot("direct").await.unwrap();
        tokio::task::spawn_blocking(move || {
            assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
        })
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let child = nac_core::store::load_traditional_child(&store_path, &child_session_id)
                    .unwrap()
                    .unwrap();
                let inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
                if child.status == nac_core::store::TraditionalChildStatus::Interrupted
                    && inbox
                        .first()
                        .is_some_and(|item| item.status == nac_core::store::InboxStatus::Delivered)
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("restart reconciliation should interrupt the child and wake its parent");

        rebuilt.snapshot("direct").await.unwrap();
        let child = nac_core::store::load_traditional_child(&store_path, &child_session_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            child.status,
            nac_core::store::TraditionalChildStatus::Interrupted
        );
        assert!(child.failure.as_deref().is_some_and(|failure| {
            failure.contains("interrupted when the nac process stopped")
        }));
        let inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(child.completion_inbox_id, Some(inbox[0].id));

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn parent_repair_recovers_suppression_after_deletion_owner_disappears() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("completion_suppression_restart_repair");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("suppression-repair-key"));
        seed_direct_session(&root, "direct");
        seed_direct_with_orchestrator_session_with_base_url(
            &root,
            "delegating",
            "https://api.openai.com/v1".to_string(),
        );
        let store_path = root.join("store.db");
        let manager = test_manager(&root);

        let child_session_id = manager
            .create_traditional_child_session("direct", "general", "repair child delivery")
            .await
            .unwrap();
        nac_core::store::begin_traditional_child_run(
            &store_path,
            &child_session_id,
            "child-run",
            TraditionalChildExecutionMode::Background,
        )
        .unwrap();
        let child =
            nac_core::store::suppress_traditional_child_completion(&store_path, &child_session_id)
                .unwrap();
        nac_core::store::settle_traditional_child_run(
            &store_path,
            &child_session_id,
            "child-run",
            nac_core::store::TraditionalChildTerminal {
                status: nac_core::store::TraditionalChildStatus::Cancelled,
                report: None,
                failure: Some("deletion interrupted".to_string()),
                change_summary: None,
                verification_summary: None,
            },
        )
        .unwrap();
        assert!(nac_core::store::list_session_inbox(&store_path, "direct")
            .unwrap()
            .is_empty());
        let child_lease =
            sessions::SessionRelationshipLease::try_acquire(&store_path, &child_session_id)
                .unwrap();
        manager
            .repair_orphaned_completion_suppressions("direct")
            .unwrap();
        assert!(nac_core::store::list_session_inbox(&store_path, "direct")
            .unwrap()
            .is_empty());
        let admission_error = nac_core::store::begin_traditional_child_run(
            &store_path,
            &child_session_id,
            "child-run-2",
            TraditionalChildExecutionMode::Background,
        )
        .unwrap_err();
        assert!(admission_error
            .to_string()
            .contains("completion delivery is suppressed"));
        drop(child_lease);
        manager
            .repair_orphaned_completion_suppressions("direct")
            .unwrap();
        manager
            .repair_orphaned_completion_suppressions("direct")
            .unwrap();
        let child_inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
        assert_eq!(child_inbox.len(), 1);
        assert_eq!(
            nac_core::store::load_traditional_child(&store_path, &child_session_id)
                .unwrap()
                .unwrap()
                .completion_inbox_id,
            Some(child_inbox[0].id)
        );
        assert_eq!(child.generation, 1);
        let child_generation_two = nac_core::store::begin_traditional_child_run(
            &store_path,
            &child_session_id,
            "child-run-2",
            TraditionalChildExecutionMode::Background,
        )
        .unwrap();
        assert_eq!(child_generation_two.generation, 2);

        let orchestrator_session_id = manager
            .create_managed_orchestrator_session("delegating", "repair orchestrator delivery")
            .await
            .unwrap();
        nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &orchestrator_session_id,
            "orchestrator-run",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        nac_core::store::suppress_managed_orchestrator_completion(
            &store_path,
            &orchestrator_session_id,
        )
        .unwrap();
        nac_core::store::settle_managed_orchestrator_run(
            &store_path,
            &orchestrator_session_id,
            "orchestrator-run",
            nac_core::store::ManagedOrchestratorTerminal {
                status: ManagedOrchestratorStatus::Cancelled,
                report: None,
                failure: Some("deletion interrupted".to_string()),
            },
        )
        .unwrap();
        let orchestrator_lease =
            sessions::SessionRelationshipLease::try_acquire(&store_path, &orchestrator_session_id)
                .unwrap();
        manager
            .repair_orphaned_completion_suppressions("delegating")
            .unwrap();
        assert!(
            nac_core::store::list_session_inbox(&store_path, "delegating")
                .unwrap()
                .is_empty()
        );
        let admission_error = nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &orchestrator_session_id,
            "orchestrator-run-2",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap_err();
        assert!(admission_error
            .to_string()
            .contains("completion delivery is suppressed"));
        drop(orchestrator_lease);
        manager
            .repair_orphaned_completion_suppressions("delegating")
            .unwrap();
        manager
            .repair_orphaned_completion_suppressions("delegating")
            .unwrap();
        assert_eq!(
            nac_core::store::list_session_inbox(&store_path, "delegating")
                .unwrap()
                .len(),
            1
        );
        let orchestrator_generation_two = nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &orchestrator_session_id,
            "orchestrator-run-2",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        assert_eq!(orchestrator_generation_two.generation, 2);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deleting_parent_removes_its_traditional_child_sessions() {
        let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("traditional_child_delete");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-delete-key"));
        seed_direct_session(&root, "direct");
        let manager = test_manager(&root);
        let child_session_id = manager
            .create_traditional_child_session("direct", "general", "delete with parent")
            .await
            .unwrap();

        manager.delete_session("direct").await.unwrap();

        let store_path = root.join("store.db");
        assert!(sessions::load_session(&store_path, "direct").is_err());
        assert!(sessions::load_session(&store_path, &child_session_id).is_err());
        assert!(
            nac_core::store::load_traditional_child(&store_path, &child_session_id)
                .unwrap()
                .is_none()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn wrong_parent_relationship_reads_are_opaque_not_found() {
        let root = temp_root("relationship_ownership_opaque");
        seed_direct_session(&root, "parent-a");
        seed_direct_session(&root, "parent-b");
        seed_direct_with_orchestrator_session_with_base_url(
            &root,
            "delegating-a",
            "https://api.openai.com/v1".to_string(),
        );
        seed_direct_with_orchestrator_session_with_base_url(
            &root,
            "delegating-b",
            "https://api.openai.com/v1".to_string(),
        );
        let manager = test_manager(&root);
        let store_path = root.join("store.db");
        let child = manager
            .create_traditional_child_session("parent-a", "general", "owned child")
            .await
            .unwrap();
        let orchestrator = manager
            .create_managed_orchestrator_session("delegating-a", "owned orchestrator")
            .await
            .unwrap();

        let summaries = manager.list_sessions(false).await.unwrap();
        assert!(summaries
            .iter()
            .find(|entry| entry.summary.session_id == child)
            .and_then(|entry| entry.lineage.as_ref())
            .is_some_and(|lineage| lineage.kind == SessionLineageKind::TraditionalChild));
        assert!(summaries
            .iter()
            .find(|entry| entry.summary.session_id == orchestrator)
            .and_then(|entry| entry.lineage.as_ref())
            .is_some_and(|lineage| lineage.kind == SessionLineageKind::ManagedOrchestrator));

        let inbox_error = manager.list_direct_inbox(&child).await.unwrap_err();
        assert!(inbox_error
            .to_string()
            .contains("accept input only through their parent"));
        let run_error = manager
            .submit_prompt(
                &child,
                SubmitPromptRequest {
                    prompt: "bypass parent ownership".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(run_error
            .to_string()
            .contains("accept work only through their parent"));
        let managed_run_error = manager
            .submit_prompt(
                &orchestrator,
                SubmitPromptRequest {
                    prompt: "bypass parent ownership".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(managed_run_error
            .to_string()
            .contains("accept work only through their parent"));

        for delegated in [&child, &orchestrator] {
            let branch_error = manager
                .switch_workspace_branch(
                    delegated,
                    SwitchBranchRequest {
                        name: "delegated-mutation".to_string(),
                        create: true,
                    },
                )
                .await
                .unwrap_err();
            assert!(branch_error
                .to_string()
                .contains("accept work only through their parent"));
            let commit_error = manager
                .commit_workspace(
                    delegated,
                    CommitWorkspaceRequest {
                        message: "delegated mutation".to_string(),
                    },
                )
                .await
                .unwrap_err();
            assert!(commit_error
                .to_string()
                .contains("accept work only through their parent"));
            let before = manager.session_config(delegated).unwrap();
            let config_error = manager
                .update_session_config(
                    delegated,
                    serde_json::from_value(serde_json::json!({"model":"mutated-model"})).unwrap(),
                )
                .await
                .unwrap_err();
            assert!(config_error
                .to_string()
                .contains("accept work only through their parent"));
            assert_eq!(manager.session_config(delegated).unwrap(), before);

            let steering_error = manager
                .queue_orchestrator_steering(
                    delegated,
                    OrchestratorSteeringRequest {
                        instruction: "bypass parent steering".to_string(),
                    },
                )
                .await
                .unwrap_err();
            assert!(steering_error
                .to_string()
                .contains("accept work only through their parent"));
            let cancellation_error = manager.cancel_active_run(delegated).await.unwrap_err();
            assert!(cancellation_error
                .to_string()
                .contains("accept work only through their parent"));
            assert_eq!(
                manager.revert_session(delegated, 0).await.unwrap_err(),
                RevertSessionError::NotFound
            );
            assert_eq!(
                manager
                    .regenerate_session_run(delegated, 0)
                    .await
                    .unwrap_err(),
                RegenerateSessionError::NotFound
            );
            assert_eq!(
                manager.compact_session(delegated).await.unwrap_err(),
                CompactSessionError::NotFound
            );
            let delete_error = manager.delete_session(delegated).await.unwrap_err();
            assert!(delete_error
                .to_string()
                .contains("accept work only through their parent"));
            assert!(sessions::session_exists(&store_path, delegated).unwrap());
        }

        let app = router(manager.clone());
        for delegated in [&child, &orchestrator] {
            for (path, body) in [
                (
                    "workspace/branches",
                    r#"{"name":"delegated-mutation","create":true}"#,
                ),
                ("workspace/commit", r#"{"message":"delegated mutation"}"#),
            ] {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .method("POST")
                            .uri(format!("/sessions/{delegated}/{path}"))
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(Body::from(body))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::CONFLICT, "{path}");
            }
            let config = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("PATCH")
                        .uri(format!("/sessions/{delegated}/config"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(r#"{"model":"mutated-model"}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(config.status(), StatusCode::CONFLICT);
            let steering = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/steering"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(r#"{"instruction":"bypass"}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(steering.status(), StatusCode::CONFLICT);
            let cancel = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/cancel-active-run"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(cancel.status(), StatusCode::CONFLICT);
            let delete = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("DELETE")
                        .uri(format!("/sessions/{delegated}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(delete.status(), StatusCode::CONFLICT);
            assert!(sessions::session_exists(&store_path, delegated).unwrap());
            for action in ["revert", "regenerate"] {
                let response = app
                    .clone()
                    .oneshot(
                        Request::builder()
                            .method("POST")
                            .uri(format!("/sessions/{delegated}/{action}"))
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(Body::from(r#"{"message_idx":0}"#))
                            .unwrap(),
                    )
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::NOT_FOUND, "{action}");
            }
            let compact = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/compact"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(compact.status(), StatusCode::NOT_FOUND);
        }

        let child_error =
            ApiError::from(manager.traditional_child("parent-b", &child).unwrap_err());
        assert_eq!(child_error.status, StatusCode::NOT_FOUND);
        assert_eq!(child_error.message, "traditional child was not found");
        assert!(!child_error.message.contains(&child));
        let child_cancel_error = ApiError::from(
            manager
                .cancel_traditional_child("parent-b", &child)
                .await
                .unwrap_err(),
        );
        assert_eq!(child_cancel_error.status, StatusCode::NOT_FOUND);
        assert_eq!(
            child_cancel_error.message,
            "traditional child was not found"
        );
        assert!(!child_cancel_error.message.contains(&child));
        let continuation_error =
            nac_core::traditional_children::controller_for(&root.join("store.db"))
                .unwrap()
                .start(
                    nac_core::traditional_children::TraditionalChildStartRequest {
                        parent_session_id: "parent-b".to_string(),
                        child_session_id: Some(child.clone()),
                        profile: "general".to_string(),
                        description: "owned child".to_string(),
                        prompt: "must remain opaque".to_string(),
                        execution_mode: TraditionalChildExecutionMode::Foreground,
                    },
                )
                .await
                .unwrap_err();
        assert_eq!(
            continuation_error.to_string(),
            "traditional child was not found"
        );

        let orchestrator_error = ApiError::from(
            manager
                .managed_orchestrator("delegating-b", &orchestrator)
                .unwrap_err(),
        );
        assert_eq!(orchestrator_error.status, StatusCode::NOT_FOUND);
        assert_eq!(
            orchestrator_error.message,
            "managed orchestrator was not found"
        );
        assert!(!orchestrator_error.message.contains(&orchestrator));
        let orchestrator_cancel_error = ApiError::from(
            manager
                .cancel_managed_orchestrator("delegating-b", &orchestrator)
                .await
                .unwrap_err(),
        );
        assert_eq!(orchestrator_cancel_error.status, StatusCode::NOT_FOUND);
        assert_eq!(
            orchestrator_cancel_error.message,
            "managed orchestrator was not found"
        );
        assert!(!orchestrator_cancel_error.message.contains(&orchestrator));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn managed_monitor_treats_peer_lease_as_live() {
        let root = temp_root("managed_peer_lease_live");
        seed_direct_with_orchestrator_session_with_base_url(
            &root,
            "delegating",
            "https://api.openai.com/v1".to_string(),
        );
        let manager = test_manager(&root);
        let orchestrator = manager
            .create_managed_orchestrator_session("delegating", "foreign live run")
            .await
            .unwrap();
        let store_path = root.join("store.db");
        let relation = nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &orchestrator,
            "peer-run",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        nac_core::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .append_run_prompt(
                &orchestrator,
                0,
                &Message::User {
                    content: "peer is working".to_string(),
                },
                "peer-run",
            )
            .unwrap();
        let ready_path = root.join("managed-peer-ready");
        let mut peer = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tests::managed_monitor_peer_lease_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_MANAGED_PEER_STORE", &store_path)
            .env("NAC_TEST_MANAGED_PEER_SESSION", &orchestrator)
            .env("NAC_TEST_MANAGED_PEER_READY", &ready_path)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        for _ in 0..200 {
            if ready_path.exists() {
                break;
            }
            assert!(
                peer.try_wait().unwrap().is_none(),
                "peer helper exited early"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(ready_path.exists(), "peer helper never acquired the lease");

        let steering = manager
            .queue_managed_orchestrator_steering(
                "delegating",
                &orchestrator,
                "steer the peer-owned generation",
            )
            .expect("peer ownership must not block durable steering");
        let claimed =
            nac_core::store::claim_thread_steering(&store_path, &orchestrator, "peer-run").unwrap();
        assert_eq!(claimed.len(), 1);
        assert_eq!(claimed[0].id, steering.steering_id);

        let peer_observed = manager.inner.managed_monitor_peer_observed.notified();
        let monitor_manager = manager.clone();
        let monitor_orchestrator = orchestrator.clone();
        let monitor = tokio::spawn(async move {
            monitor_manager
                .monitor_managed_orchestrator(&monitor_orchestrator, relation.generation)
                .await
        });

        tokio::time::timeout(Duration::from_secs(5), peer_observed)
            .await
            .expect("monitor must observe the peer-owned operation lease");
        assert!(!monitor.is_finished());
        assert_eq!(
            nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
                .unwrap()
                .unwrap()
                .status,
            ManagedOrchestratorStatus::Running
        );
        monitor.abort();
        let _ = monitor.await;
        peer.kill().unwrap();
        peer.wait().unwrap();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn peer_owned_direct_and_managed_cancellation_fail_fast() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let direct_root = temp_root("direct_peer_cancel_conflict");
        let _env =
            ScopedModelEnv::isolated(&direct_root.join("nac-home"), Some("peer-cancel-test-key"));
        seed_direct_session(&direct_root, "direct");
        let direct_manager = test_manager(&direct_root);
        let direct_lease =
            sessions::SessionOperationLease::try_acquire(&direct_root.join("store.db"), "direct")
                .unwrap();
        let direct_error = tokio::time::timeout(
            Duration::from_secs(1),
            direct_manager.cancel_active_run("direct"),
        )
        .await
        .expect("peer-owned direct cancellation must not hang")
        .unwrap_err();
        assert!(
            direct_error
                .to_string()
                .contains("running in another process"),
            "unexpected direct cancellation error: {direct_error:#}"
        );
        drop(direct_lease);

        let managed_root = temp_root("managed_peer_cancel_conflict");
        seed_direct_with_orchestrator_session_with_base_url(
            &managed_root,
            "delegating",
            "https://api.openai.com/v1".to_string(),
        );
        let managed_manager = test_manager(&managed_root);
        let orchestrator = managed_manager
            .create_managed_orchestrator_session("delegating", "peer work")
            .await
            .unwrap();
        let store_path = managed_root.join("store.db");
        nac_core::store::begin_managed_orchestrator_run(
            &store_path,
            &orchestrator,
            "peer-run",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        nac_core::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .append_run_prompt(
                &orchestrator,
                0,
                &Message::User {
                    content: "peer is working".to_string(),
                },
                "peer-run",
            )
            .unwrap();
        let managed_lease =
            sessions::SessionOperationLease::try_acquire(&store_path, &orchestrator).unwrap();
        let managed_error = tokio::time::timeout(
            Duration::from_secs(1),
            managed_manager.cancel_managed_orchestrator("delegating", &orchestrator),
        )
        .await
        .expect("peer-owned managed cancellation must not hang")
        .unwrap_err();
        assert!(
            managed_error
                .to_string()
                .contains("running in another process"),
            "unexpected managed cancellation error: {managed_error:#}"
        );
        drop(managed_lease);

        let _ = std::fs::remove_dir_all(direct_root);
        let _ = std::fs::remove_dir_all(managed_root);
    }

    #[tokio::test]
    async fn workspace_mutation_admission_holds_every_shared_session_lease() {
        let root = temp_root("workspace_mutation_leases");
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {} failed: {}",
                args.join(" "),
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init"]);
        git(&["config", "user.name", "NAC Test"]);
        git(&["config", "user.email", "nac@example.invalid"]);
        std::fs::write(root.join("tracked.txt"), b"base\n").unwrap();
        git(&["add", "tracked.txt"]);
        git(&["commit", "-m", "base"]);
        seed_direct_session(&root, "session-a");
        seed_direct_session(&root, "session-b");
        let manager = test_manager(&root);

        let admission = manager.idle_workspace_root("session-a").await.unwrap();
        assert_eq!(
            admission.target.root().canonicalize().unwrap(),
            root.canonicalize().unwrap()
        );
        let workspace_identity = admission.target.lease_identity();
        assert!(matches!(
            sessions::WorkspaceActivityLease::try_acquire(
                &root.join("store.db"),
                &workspace_identity
            ),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
        for session_id in ["session-a", "session-b"] {
            assert!(matches!(
                sessions::SessionOperationLease::try_acquire(&root.join("store.db"), session_id),
                Err(sessions::SessionOperationLeaseError::Busy(_))
            ));
        }
        drop(admission);
        drop(
            sessions::WorkspaceActivityLease::try_acquire(
                &root.join("store.db"),
                &workspace_identity,
            )
            .unwrap(),
        );
        for session_id in ["session-a", "session-b"] {
            drop(
                sessions::SessionOperationLease::try_acquire(&root.join("store.db"), session_id)
                    .unwrap(),
            );
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn cancelled_workspace_request_keeps_leases_until_blocking_git_settles() {
        let root = temp_root("cancelled_workspace_mutation_leases");
        let output = std::process::Command::new("git")
            .args(["-C", root.to_str().unwrap(), "init"])
            .output()
            .unwrap();
        assert!(output.status.success());
        seed_direct_session(&root, "session");
        let manager = test_manager(&root);
        let admission = manager.idle_workspace_root("session").await.unwrap();
        let workspace_identity = admission.target.lease_identity();
        let store_path = root.join("store.db");
        let (started_tx, started_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);

        let request = tokio::spawn(async move {
            SessionManager::execute_workspace_mutation(
                admission,
                "test workspace mutation failed",
                move |_| {
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(())
                },
            )
            .await
        });
        started_rx.await.unwrap();
        request.abort();
        assert!(matches!(
            sessions::WorkspaceActivityLease::try_acquire(&store_path, &workspace_identity),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
        assert!(matches!(
            sessions::SessionOperationLease::try_acquire(&store_path, "session"),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));

        release_tx.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Ok(workspace) =
                    sessions::WorkspaceActivityLease::try_acquire(&store_path, &workspace_identity)
                {
                    drop(workspace);
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("blocking mutation should eventually release its leases");
        drop(sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap());
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn parent_deletion_excludes_late_child_relationship_commit() {
        let root = temp_root("delete_excludes_child_create");
        seed_direct_session(&root, "parent");
        let manager = test_manager(&root);
        let gate = manager.lifecycle_gate("parent");
        let blocker = gate.lock().await;

        let delete_manager = manager.clone();
        let delete = tokio::spawn(async move { delete_manager.delete_session("parent").await });
        tokio::task::yield_now().await;
        let create_manager = manager.clone();
        let create = tokio::spawn(async move {
            create_manager
                .create_traditional_child_session("parent", "general", "must not be orphaned")
                .await
        });
        tokio::task::yield_now().await;
        assert!(!delete.is_finished());
        assert!(!create.is_finished());

        drop(blocker);
        delete.await.unwrap().unwrap();
        let error = create.await.unwrap().unwrap_err();
        assert!(error.to_string().contains("was not found"), "{error:#}");
        assert!(sessions::list_sessions(&root.join("store.db"))
            .unwrap()
            .into_iter()
            .all(|session| session.session_id != "parent"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn operation_lease_store_failures_are_path_safe_for_submit_patch_and_delete_apis() {
        const CANARY: &str = "operation_lease_private_path_canary";
        let root = temp_root(CANARY);
        seed_editable_session(&root, "session");
        let lock_dir = poison_operation_lease_directory(&root);
        let app = router(test_manager(&root));

        for (method, uri, body) in [
            (
                "POST",
                "/sessions/session/runs",
                Some(r#"{"prompt":"must not run"}"#),
            ),
            (
                "PATCH",
                "/sessions/session/config",
                Some(r#"{"model":"must-not-change"}"#),
            ),
            ("DELETE", "/sessions/session", None),
        ] {
            let mut request = Request::builder().method(method).uri(uri);
            if body.is_some() {
                request = request.header(header::CONTENT_TYPE, "application/json");
            }
            let response = app
                .clone()
                .oneshot(
                    request
                        .body(body.map_or_else(Body::empty, Body::from))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::INTERNAL_SERVER_ERROR,
                "{uri}"
            );
            let response = response_json(response).await;
            assert_eq!(
                response,
                serde_json::json!({"error": "session operation lease failed"}),
                "{uri}"
            );
            assert!(!response.to_string().contains(CANARY), "{uri}");
            assert!(
                !response.to_string().contains(&root.display().to_string()),
                "{uri}"
            );
        }

        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.model, "model-a");
        assert!(lock_dir.is_file());
        let _ = std::fs::remove_dir_all(root);
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
    async fn rebuilt_manager_recovers_interrupted_run_once_and_rotates_event_epoch() {
        let root = temp_root("interrupted_run_restart");
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("restart-test-key"));
        seed_editable_session(&root, "session");
        let store_path = root.join("store.db");
        let writer = nac_core::store::TranscriptLogWriter::new(&store_path).unwrap();
        writer
            .append_run_prompt(
                "session",
                0,
                &nac_core::types::Message::User {
                    content: "persisted before process death".to_string(),
                },
                "run-before-restart",
            )
            .unwrap();

        let first_manager = test_manager(&root);
        let first = first_manager.snapshot("session").await.unwrap();
        assert_eq!(
            first.transcript_recovery_warning.as_deref(),
            Some(
                "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue."
            )
        );
        assert_eq!(
            first
                .messages
                .iter()
                .filter(|message| matches!(
                    message,
                    nac_core::types::Message::User { content }
                        if content == "persisted before process death"
                ))
                .count(),
            1
        );
        let first_recovery_events = first_manager
            .recent_events("session", None, 64)
            .await
            .unwrap()
            .1;
        assert_eq!(
            first_recovery_events
                .iter()
                .filter(|envelope| {
                    envelope.run_id.as_ref().map(|run_id| run_id.as_str())
                        == Some("run-before-restart")
                        && matches!(
                            envelope.event,
                            nac_core::events::SessionEvent::RunFailed { .. }
                        )
                })
                .count(),
            1
        );
        let first_epoch = first.thread_event_boundary.epoch_id;
        drop(first_manager);

        let second_manager = test_manager(&root);
        let second = second_manager.snapshot("session").await.unwrap();
        assert_eq!(
            second.transcript_recovery_warning,
            first.transcript_recovery_warning
        );
        assert_ne!(second.thread_event_boundary.epoch_id, first_epoch);
        assert!(
            second_manager
                .recent_events("session", None, 64)
                .await
                .unwrap()
                .1
                .iter()
                .all(|envelope| !matches!(
                    envelope.event,
                    nac_core::events::SessionEvent::RunFailed { .. }
                )),
            "idempotent rebuild must not synthesize another terminal event"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn cached_manager_snapshot_reconciles_peer_interruption_once() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cached_peer_snapshot");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("cached-snapshot-key"));
        seed_editable_session(&root, "session");
        let store_path = root.join("store.db");
        let manager = test_manager(&root);
        let cached = manager.attach_session("session").await.unwrap();

        let peer_lease =
            sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
        nac_core::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .append_run_prompt(
                "session",
                0,
                &nac_core::types::Message::User {
                    content: "committed by peer".to_string(),
                },
                "peer-run",
            )
            .unwrap();
        drop(peer_lease);

        let recovered = manager.snapshot("session").await.unwrap();
        assert_eq!(
            recovered.transcript_recovery_warning.as_deref(),
            Some(
                "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue."
            )
        );
        assert!(matches!(
            recovered.messages.last(),
            Some(nac_core::types::Message::User { content }) if content == "committed by peer"
        ));
        let mapped = manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .cloned()
            .unwrap();
        assert!(Arc::ptr_eq(&mapped, &cached));
        assert!(
            !cached
                .has_unreconciled_durable_run_recovery()
                .expect("recovery lookup should succeed"),
            "the cached service must not rehydrate the same recovery row again"
        );

        let recovery_events = manager.recent_events("session", None, 64).await.unwrap().1;
        assert_eq!(
            recovery_events
                .iter()
                .filter(|envelope| {
                    envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("peer-run")
                        && matches!(
                            envelope.event,
                            nac_core::events::SessionEvent::RunFailed { .. }
                        )
                })
                .count(),
            1
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn cached_manager_reconciles_peer_interruption_before_resubmission() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cached_peer_interruption");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("cached-recovery-key"));
        seed_editable_session(&root, "session");
        let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
        let store_path = root.join("store.db");
        let manager = test_manager(&root);
        let cached = manager.attach_session("session").await.unwrap();

        let peer_lease =
            sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap();
        nac_core::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .append_run_prompt(
                "session",
                0,
                &nac_core::types::Message::User {
                    content: "committed by peer".to_string(),
                },
                "peer-run",
            )
            .unwrap();
        drop(peer_lease);

        let submitted = manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "continue after peer".to_string(),
                },
            )
            .await
            .unwrap();
        let mut continued = false;
        for _ in 0..100 {
            let messages = cached.messages_snapshot().await.unwrap();
            if messages.iter().any(|message| {
                matches!(
                    message,
                    nac_core::types::Message::User { content }
                        if content == "continue after peer"
                )
            }) {
                continued = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(continued, "replacement prompt never committed");
        assert_eq!(
            cached.active_run().unwrap().run_id.as_str(),
            submitted.run_id
        );
        let mapped = manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .cloned()
            .unwrap();
        assert!(
            Arc::ptr_eq(&mapped, &cached),
            "recovery must preserve the cached service's event bus and subscribers"
        );
        let recovery_events = manager.recent_events("session", None, 64).await.unwrap().1;
        assert_eq!(
            recovery_events
                .iter()
                .filter(|envelope| {
                    envelope.run_id.as_ref().map(|run_id| run_id.as_str()) == Some("peer-run")
                        && matches!(
                            envelope.event,
                            nac_core::events::SessionEvent::RunFailed { .. }
                        )
                })
                .count(),
            1
        );
        assert!(
            cached
                .has_unreconciled_durable_run_recovery()
                .expect("recovery lookup should succeed"),
            "the replacement run must own a new durable recovery row"
        );

        manager.cancel_active_run("session").await.unwrap();
        endpoint.abort();
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
        // A missing selector stays incomplete only when conventional-var
        // auto-selection cannot repair it: deepseek's conventional variable
        // is cleared in this environment (openai's is set and would
        // auto-select).
        let mut missing_selector = sessions::load_session(&store_path, "missing-selector").unwrap();
        missing_selector.backend = BackendKind::DeepSeekChat;
        missing_selector.base_url = "https://api.deepseek.com".to_string();
        sessions::update_session_config(&store_path, &missing_selector).unwrap();
        seed_session(
            &root,
            "missing-environment-value",
            "2026-01-03 00:00:00.000000000",
        );
        let mut missing_value =
            sessions::load_session(&store_path, "missing-environment-value").unwrap();
        missing_value.api_key_env = Some("MISSING_SERVER_REPAIR_KEY".to_string());
        sessions::update_session_config(&store_path, &missing_value).unwrap();

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
        sessions::update_session_config(&store_path, &unavailable_auth).unwrap();

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
        assert_eq!(missing_selector.backend.as_deref(), Some("deepseek-chat"));
        assert_eq!(missing_selector.api_key_env, None);
        let missing_environment = manager.session_config("missing-environment-value").unwrap();
        assert_eq!(
            missing_environment.api_key_env.as_deref(),
            Some("MISSING_SERVER_REPAIR_KEY")
        );
        let unavailable_managed = manager.session_config("unavailable-managed-auth").unwrap();
        assert_eq!(unavailable_managed.backend.as_deref(), Some("arcee-auth"));
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
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                    backend: RequestField::Value("arcee-api".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("unavailable managed auth should be repairable by switching credential mode");
        let repaired_auth = manager.session_config("unavailable-managed-auth").unwrap();
        assert_eq!(repaired_auth.backend.as_deref(), Some("arcee-api"));
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

    #[tokio::test]
    async fn structurally_invalid_raw_settings_require_explicit_transactional_repair() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("repair_structurally_invalid_settings");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-repair-key"));
        let store_path = root.join("store.db");
        for id in ["healthy", "auto", "arcee", "missing", "effort", "headers"] {
            seed_editable_session(&root, id);
        }
        for id in ["auto", "arcee", "missing", "effort", "headers"] {
            let mut raw = sessions::load_session_config(&store_path, id).unwrap();
            match id {
                "auto" => raw.backend = Some("auto".to_string()),
                "arcee" => raw.backend = Some("arcee".to_string()),
                "missing" => raw.backend = None,
                "effort" => raw.reasoning_effort = Some("ultra".to_string()),
                "headers" => raw.extra_headers_json = Some("{broken".to_string()),
                _ => unreachable!(),
            }
            sessions::update_raw_session_config(&store_path, &raw).unwrap();
        }

        let manager = test_manager(&root);
        let listed = manager.list_sessions(false).await.unwrap();
        assert_eq!(listed.len(), 6);
        assert_eq!(
            listed
                .iter()
                .find(|entry| entry.summary.session_id == "healthy")
                .unwrap()
                .summary
                .model_config_error,
            None
        );
        for id in ["auto", "arcee", "missing", "effort", "headers"] {
            assert!(
                listed
                    .iter()
                    .find(|entry| entry.summary.session_id == id)
                    .unwrap()
                    .summary
                    .model_config_error
                    .is_some(),
                "{id} should be diagnosed without breaking listing"
            );
        }

        let raw_auto = manager.session_config("auto").unwrap();
        assert_eq!(raw_auto.backend.as_deref(), Some("auto"));
        assert!(!raw_auto.diagnostics.is_empty());
        let raw_missing = manager.session_config("missing").unwrap();
        assert_eq!(raw_missing.backend, None);
        let raw_effort = manager.session_config("effort").unwrap();
        assert_eq!(raw_effort.reasoning_effort.as_deref(), Some("ultra"));
        let raw_headers = manager.session_config("headers").unwrap();
        assert_eq!(raw_headers.extra_headers_json.as_deref(), Some("{broken"));
        let Json(endpoint_headers) =
            session_config_handler(State(manager.clone()), AxumPath("headers".to_string()))
                .await
                .unwrap();
        assert_eq!(endpoint_headers, raw_headers);
        assert!(manager.inner.active_sessions.read().await.is_empty());

        let before_failed = raw_auto.clone();
        let error = manager
            .update_session_config(
                "auto",
                UpdateConfigRequest {
                    model: RequestField::Value("replacement-model".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap_err();
        assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
        assert_eq!(manager.session_config("auto").unwrap(), before_failed);

        for id in ["auto", "arcee", "missing"] {
            manager
                .update_session_config(
                    id,
                    UpdateConfigRequest {
                        backend: RequestField::Value("openai-responses".to_string()),
                        model: RequestField::Value("replacement-model".to_string()),
                        base_url: RequestField::Value("https://api.openai.com/v1".to_string()),
                        api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                        ..UpdateConfigRequest::default()
                    },
                )
                .await
                .unwrap();
        }
        manager
            .update_session_config(
                "effort",
                UpdateConfigRequest {
                    reasoning_effort: RequestField::Null,
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap();
        manager
            .update_session_config(
                "headers",
                UpdateConfigRequest {
                    extra_headers: RequestField::Value(HeadersRequest(BTreeMap::from([(
                        "X-Repaired".to_string(),
                        "yes".to_string(),
                    )]))),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap();

        for id in ["auto", "arcee", "missing", "effort", "headers"] {
            let repaired = manager.session_config(id).unwrap();
            assert!(
                repaired.diagnostics.is_empty(),
                "{id}: {:?}",
                repaired.diagnostics
            );
            assert_eq!(repaired.config_version, 2);
            sessions::load_session(&store_path, id).expect("repaired row must strictly load");
        }
        assert_eq!(
            manager
                .session_config("headers")
                .unwrap()
                .extra_headers_json
                .as_deref(),
            Some("{\"X-Repaired\":\"yes\"}")
        );
        let _ = std::fs::remove_dir_all(root);
    }

    async fn point_session_at_hanging_endpoint(
        root: &std::path::Path,
        session_id: &str,
    ) -> tokio::task::JoinHandle<()> {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let mut snapshot = sessions::load_session(&root.join("store.db"), session_id).unwrap();
        snapshot.base_url = format!("http://{address}/v1");
        sessions::update_session_config(&root.join("store.db"), &snapshot).unwrap();

        tokio::spawn(async move {
            if let Ok((socket, _)) = listener.accept().await {
                let _socket = socket;
                std::future::pending::<()>().await;
            }
        })
    }

    #[tokio::test]
    async fn steering_routes_reject_blank_before_lookup_and_keep_inactive_conflicts() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("steering_validation");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let app = router(test_manager(&root));

        for (uri, instruction, expected) in [
            (
                "/sessions/missing/steering",
                "  \n ",
                StatusCode::BAD_REQUEST,
            ),
            (
                "/sessions/missing/threads/worker/steering",
                "\t",
                StatusCode::BAD_REQUEST,
            ),
            (
                "/sessions/session/steering",
                "redirect",
                StatusCode::CONFLICT,
            ),
            (
                "/sessions/session/threads/worker/steering",
                "redirect",
                StatusCode::CONFLICT,
            ),
        ] {
            let request = Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::json!({ "instruction": instruction }).to_string(),
                ))
                .unwrap();
            let response = app.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status(), expected, "{uri}: {instruction:?}");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn active_run_accepts_orchestrator_steering() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("orchestrator_steering");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
        let manager = test_manager(&root);

        manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "begin the original task".to_string(),
                },
            )
            .await
            .unwrap();
        let steering = manager
            .queue_orchestrator_steering(
                "session",
                OrchestratorSteeringRequest {
                    instruction: "change direction".to_string(),
                },
            )
            .await
            .unwrap();
        assert_eq!(steering.status, "queued");
        let records = manager.snapshot("session").await.unwrap().thread_steering;
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].thread_name, "__orchestrator__");
        assert_eq!(records[0].instruction, "change direction");

        manager.cancel_active_run("session").await.unwrap();
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn cancel_active_run_route_is_idempotent() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cancel_idempotent");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
        let manager = test_manager(&root);
        let service = manager.attach_session("session").await.unwrap();
        manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "begin the original task".to_string(),
                },
            )
            .await
            .unwrap();
        let app = router(manager);
        let request = || {
            Request::builder()
                .method("POST")
                .uri("/sessions/session/cancel-active-run")
                .body(Body::empty())
                .unwrap()
        };

        let (first, second) = tokio::join!(
            app.clone().oneshot(request()),
            app.clone().oneshot(request())
        );
        assert_eq!(first.unwrap().status(), StatusCode::ACCEPTED);
        assert_eq!(second.unwrap().status(), StatusCode::ACCEPTED);
        assert_eq!(
            app.clone().oneshot(request()).await.unwrap().status(),
            StatusCode::ACCEPTED
        );

        let terminal_events = service
            .recent_events(None, 64)
            .1
            .into_iter()
            .filter(|envelope| {
                matches!(
                    envelope.event,
                    nac_core::events::SessionEvent::RunCompleted { .. }
                        | nac_core::events::SessionEvent::RunFailed { .. }
                        | nac_core::events::SessionEvent::RunCancelled
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(terminal_events.len(), 1);
        assert_eq!(
            terminal_events[0].event,
            nac_core::events::SessionEvent::RunCancelled
        );
        assert!(service.active_run().is_none());
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn deletion_winning_lifecycle_gate_prevents_late_submission_recreation() {
        let root = temp_root("delete_before_submit");
        seed_editable_session(&root, "session");
        let manager = test_manager(&root);
        let gate = manager.lifecycle_gate("session");
        let blocker = gate.lock().await;

        let (delete_started_tx, delete_started_rx) = tokio::sync::oneshot::channel();
        let delete_manager = manager.clone();
        let delete = tokio::spawn(async move {
            delete_started_tx.send(()).unwrap();
            delete_manager.delete_session("session").await
        });
        delete_started_rx.await.unwrap();
        tokio::task::yield_now().await;

        let submit_manager = manager.clone();
        let submit = tokio::spawn(async move {
            submit_manager
                .submit_prompt(
                    "session",
                    SubmitPromptRequest {
                        prompt: "must not revive deleted state".to_string(),
                    },
                )
                .await
        });
        tokio::task::yield_now().await;
        assert!(!delete.is_finished());
        assert!(!submit.is_finished());

        drop(blocker);
        tokio::time::timeout(Duration::from_secs(2), delete)
            .await
            .expect("delete should acquire the lifecycle gate")
            .unwrap()
            .unwrap();
        let error = tokio::time::timeout(Duration::from_secs(2), submit)
            .await
            .expect("submission should observe the deletion")
            .unwrap()
            .unwrap_err();
        assert!(error.to_string().contains("was not found"), "{error:#}");
        assert!(sessions::load_session(&root.join("store.db"), "session").is_err());
        let _ = std::fs::remove_dir_all(root);
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
        assert!(patch_error
            .to_string()
            .contains("busy with an active operation"));
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
    async fn external_active_operation_lease_rejects_patch_from_independent_manager() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("external_active_patch");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
        let running_manager = test_manager(&root);
        let patch_manager = test_manager(&root);

        running_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "hold cross-process lease".to_string(),
                },
            )
            .await
            .expect("first manager starts run");
        let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

        let error = patch_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("must-not-commit".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect_err("PATCH cannot commit beneath another process run");
        assert!(error.to_string().contains("busy with an active operation"));
        assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
        let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(after.model, before.model);
        assert_eq!(after.config_version, before.config_version);
        assert!(!patch_manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));

        running_manager.cancel_active_run("session").await.unwrap();
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn stale_manager_rebuilds_all_model_authority_after_external_patch() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("external_patch_rebuild");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        unsafe { std::env::set_var("SECOND_API_KEY", "second-server-key") };
        seed_editable_session(&root, "session");
        let stale_manager = test_manager(&root);
        let patch_manager = test_manager(&root);
        let stale_service = stale_manager.attach_session("session").await.unwrap();
        assert_eq!(stale_service.config_version(), Some(0));

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let new_base_url = format!("http://{}/v1", listener.local_addr().unwrap());
        let endpoint = tokio::spawn(async move {
            if let Ok((socket, _)) = listener.accept().await {
                let _socket = socket;
                std::future::pending::<()>().await;
            }
        });
        let new_headers = BTreeMap::from([
            ("X-Cross-Process".to_string(), "current".to_string()),
            ("X-Revision".to_string(), "1".to_string()),
        ]);
        patch_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("model-from-other-manager".to_string()),
                    base_url: RequestField::Value(new_base_url.clone()),
                    backend: RequestField::Value("openai-responses".to_string()),
                    reasoning_effort: RequestField::Value("high".to_string()),
                    api_key_env: RequestField::Value("SECOND_API_KEY".to_string()),
                    extra_headers: RequestField::Value(HeadersRequest(new_headers.clone())),
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .expect("external manager commits complete model settings");
        assert_eq!(stale_service.metadata().model, "model-a");

        let submitted = stale_manager
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "must use externally committed authority".to_string(),
                },
            )
            .await
            .expect("stale manager converges before starting the next run");
        let current_service = stale_manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .cloned()
            .unwrap();
        assert!(!Arc::ptr_eq(&current_service, &stale_service));
        assert_eq!(current_service.config_version(), Some(1));
        let metadata = current_service.metadata();
        assert_eq!(metadata.model, "model-from-other-manager");
        assert_eq!(metadata.base_url, new_base_url);
        assert_eq!(metadata.backend, "openai-responses");
        assert_eq!(metadata.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(metadata.api_key_env.as_deref(), Some("SECOND_API_KEY"));
        assert_eq!(metadata.extra_headers, new_headers);
        assert_eq!(
            current_service.active_run().unwrap().run_id.as_str(),
            submitted.run_id
        );
        assert!(stale_service.active_run().is_none());

        stale_manager.cancel_active_run("session").await.unwrap();
        endpoint.abort();
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn ordinary_attachment_does_not_open_operation_lease_sidecar() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("attachment_without_effort_migration");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
        let snapshot = sessions::new_snapshot(
            "session".to_string(),
            root.clone(),
            "claude-sonnet-4-6-20251001".to_string(),
            "https://api.anthropic.com/v1".to_string(),
            BackendKind::AnthropicMessages,
            Some(ReasoningEffort::High),
            None,
            None,
            Vec::new(),
            Some("ANTHROPIC_API_KEY".to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
        std::fs::write(root.join("store.db.run-locks"), b"unavailable").unwrap();
        let manager = test_manager(&root);

        let first = manager.attach_session("session").await.unwrap();
        let second = manager.attach_session("session").await.unwrap();
        assert!(Arc::ptr_eq(&first, &second));
        assert_eq!(first.config_version(), Some(0));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn attachment_takes_resource_lease_before_sandbox_materialization() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("attachment_resource_lease_order");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
        let mut snapshot = sessions::new_snapshot(
            "session".to_string(),
            root.clone(),
            "claude-sonnet-4-6-20251001".to_string(),
            "https://api.anthropic.com/v1".to_string(),
            BackendKind::AnthropicMessages,
            Some(ReasoningEffort::High),
            None,
            None,
            Vec::new(),
            Some("ANTHROPIC_API_KEY".to_string()),
            BTreeMap::new(),
        );
        nac_core::test_support::set_default_sandbox_spec(&mut snapshot);
        snapshot.behavior = sessions::SessionBehavior::Direct;
        let store_path = root.join("store.db");
        sessions::create_session(&store_path, &snapshot).unwrap();
        let mutation =
            sessions::SessionResourceMutationLease::try_acquire(&store_path, "session").unwrap();
        let manager = test_manager(&root);

        let error = match manager.attach_session("session").await {
            Ok(_) => panic!("exclusive deletion authority must precede Podman inspection"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("busy with an active operation"));
        assert!(!manager
            .inner
            .active_sessions
            .read()
            .await
            .contains_key("session"));

        drop(mutation);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn busy_attachment_is_transient_and_next_attach_observes_durable_config() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("busy_transient_effort_recovery");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        unsafe { std::env::set_var("ANTHROPIC_API_KEY", "server-test-key") };
        let snapshot = sessions::new_snapshot(
            "session".to_string(),
            root.clone(),
            "claude-sonnet-4-6-20251001".to_string(),
            "https://api.anthropic.com/v1".to_string(),
            BackendKind::AnthropicMessages,
            Some(ReasoningEffort::Xhigh),
            None,
            None,
            Vec::new(),
            Some("ANTHROPIC_API_KEY".to_string()),
            BTreeMap::new(),
        );
        sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
        let lease = sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session")
            .unwrap();
        let reader = test_manager(&root);
        let writer = test_manager(&root);

        let transient = reader.attach_session("session").await.unwrap();
        assert_eq!(
            transient.metadata().reasoning_effort.as_deref(),
            Some("high")
        );
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Xhigh));
        assert_eq!(stored.config_version, 0);

        drop(lease);
        writer
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("claude-opus-4-6".to_string()),
                    reasoning_effort: RequestField::Value("high".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap();

        let current = reader.attach_session("session").await.unwrap();
        assert_eq!(current.metadata().model, "claude-opus-4-6");
        assert_eq!(current.metadata().reasoning_effort.as_deref(), Some("high"));
        assert_eq!(current.config_version(), Some(1));
        let cached = reader.attach_session("session").await.unwrap();
        assert!(Arc::ptr_eq(&current, &cached));
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn independent_manager_patch_rejects_held_shared_lease() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cross_manager_config_lease");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let first_manager = test_manager(&root);
        let second_manager = test_manager(&root);
        let held = sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session")
            .expect("first process lease");

        let conflict = second_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("blocked-model".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect_err("a concurrent shared lease must reject PATCH without waiting");
        assert!(conflict
            .to_string()
            .contains("busy with an active operation"));
        assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);
        assert_eq!(
            sessions::load_session(&root.join("store.db"), "session")
                .unwrap()
                .model,
            "model-a"
        );

        drop(held);
        first_manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("committed-model".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("dropping the other process lease permits PATCH");
        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.model, "committed-model");
        assert_eq!(stored.config_version, 1);
        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn independent_manager_patch_rejects_peer_sandbox_resource_lease() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("cross_manager_sandbox_resource_lease");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let store_path = root.join("store.db");
        let held = sessions::SessionResourceLease::try_acquire(&store_path, "session")
            .expect("peer attached sandbox lease");
        let manager = test_manager(&root);

        let conflict = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("blocked-model".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect_err("peer sandbox ownership must reject config replacement");
        assert_eq!(ApiError::from(conflict).status, StatusCode::CONFLICT);
        assert_eq!(
            sessions::load_session(&store_path, "session")
                .unwrap()
                .model,
            "model-a"
        );

        drop(held);
        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("committed-model".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            sessions::load_session(&store_path, "session")
                .unwrap()
                .model,
            "committed-model"
        );
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
model = "gpt-5.2"
reasoning_effort = "medium"
extra_headers = { X-Config = "yes" }

[compaction]
threshold_tokens = 64000
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
        assert!(inherited.metadata.extra_headers.is_empty());
        let inherited_id = inherited.metadata.session_id.unwrap();
        let stored = sessions::load_session(&root.join("store.db"), &inherited_id).unwrap();
        assert_eq!(stored.behavior, sessions::SessionBehavior::Orchestrator);
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.model, "gpt-5.2");
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(stored.orchestrator_compaction_threshold, Some(280_000));
        assert_eq!(
            stored.extra_headers,
            BTreeMap::from([("X-Config".to_string(), "yes".to_string())])
        );
        let Json(config) =
            session_config_handler(State(manager.clone()), AxumPath(inherited_id.clone()))
                .await
                .unwrap();
        assert_eq!(
            config.extra_headers_json.as_deref(),
            Some("{\"X-Config\":\"yes\"}")
        );
        assert_eq!(config.orchestrator_compaction_threshold, Some(280_000));
        assert!(manager
            .snapshot(&inherited_id)
            .await
            .unwrap()
            .metadata
            .extra_headers
            .is_empty());

        for behavior in [
            sessions::SessionBehavior::Direct,
            sessions::SessionBehavior::DirectWithOrchestrator,
        ] {
            let direct = manager
                .create_session(CreateSessionRequest {
                    behavior,
                    ..CreateSessionRequest::default()
                })
                .await
                .expect("an explicitly selected direct behavior should launch");
            assert_eq!(direct.metadata.behavior, behavior);
            let direct_id = direct.metadata.session_id.unwrap();
            assert_eq!(
                sessions::load_session(&root.join("store.db"), &direct_id)
                    .unwrap()
                    .behavior,
                behavior
            );
            assert_eq!(
                manager
                    .attach_session(&direct_id)
                    .await
                    .unwrap()
                    .metadata()
                    .behavior,
                behavior
            );
        }

        let cleared = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Null,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Null,
                orchestrator_compaction_threshold: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .expect("explicit values and null optional fields should override config");
        let cleared_id = cleared.metadata.session_id.unwrap();
        let stored = sessions::load_session(&root.join("store.db"), &cleared_id).unwrap();
        assert_eq!(stored.backend, BackendKind::ArceeAuth);
        assert_eq!(stored.model, "trinity-large-thinking");
        assert_eq!(stored.reasoning_effort, None);
        assert_eq!(stored.api_key_env, None);
        assert!(stored.extra_headers.is_empty());
        assert_eq!(stored.orchestrator_compaction_threshold, None);

        let zero_disabled = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Null,
                api_key_env: RequestField::Null,
                extra_headers: RequestField::Null,
                orchestrator_compaction_threshold: RequestField::Value(0),
                ..CreateSessionRequest::default()
            })
            .await
            .expect("zero should disable an inherited compaction threshold");
        let zero_disabled_id = zero_disabled.metadata.session_id.unwrap();
        assert_eq!(
            sessions::load_session(&root.join("store.db"), &zero_disabled_id)
                .unwrap()
                .orchestrator_compaction_threshold,
            None
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn openai_config_launch_switch_to_arcee_normalizes_the_managed_tuple() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("openai_to_arcee_launch");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        std::fs::write(
            nac_home.join("config.toml"),
            r#"[model]
model = "gpt-5.2"
"#,
        )
        .unwrap();
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        let manager = test_manager(&root);

        let created = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("trinity-large-thinking".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect("an explicit managed launch materializes its canonical tuple");
        assert_eq!(
            created.metadata.base_url,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
        );
        assert_eq!(created.metadata.api_key_env, None);

        let session_id = created.metadata.session_id.unwrap();
        let stored = sessions::load_session(&root.join("store.db"), &session_id).unwrap();
        assert_eq!(stored.backend, BackendKind::ArceeAuth);
        assert_eq!(
            stored.base_url,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
        );
        assert_eq!(stored.api_key_env, None);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn inherited_managed_launches_clear_stale_selectors_and_persist_fixed_bases() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_base_materialization");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        write_codex_auth(&nac_home);
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        let manager = test_manager(&root);
        let store_path = root.join("store.db");

        // The full auto-resolution chain end-to-end: a bare configured
        // model resolves its provider through the catalog (gpt-5.2 is
        // unique to openai-responses), the base URL materializes from the
        // catalog endpoint default, and the credential auto-selects the
        // conventional env var — persisted into the session.
        std::fs::write(
            nac_home.join("config.toml"),
            "[model]\nmodel = \"gpt-5.2\"\n",
        )
        .unwrap();
        let created = manager
            .create_session(CreateSessionRequest {
                cwd: Some(root.clone()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect("a configured catalog-known model auto-resolves the full tuple");
        assert_eq!(created.metadata.backend, "openai-responses");
        assert_eq!(created.metadata.base_url, "https://api.openai.com/v1");
        assert_eq!(
            created.metadata.api_key_env.as_deref(),
            Some("OPENAI_API_KEY")
        );
        let session_id = created.metadata.session_id.unwrap();
        let stored = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

        // Force a real persisted-snapshot attach instead of returning the
        // service left in memory by create.
        manager
            .inner
            .active_sessions
            .write()
            .await
            .remove(&session_id);
        let resumed = manager.snapshot(&session_id).await.unwrap();
        assert_eq!(resumed.metadata.base_url, "https://api.openai.com/v1");

        // Managed backends are only reachable through an explicit request
        // backend: every managed model id collides with a non-managed
        // provider's entry (the Trinity ids with arcee-api, the codex seed
        // ids with the openai baseline) and the collision rule prefers the
        // non-managed provider.
        for (backend, model, expected_base) in [
            (
                "arcee-auth",
                "trinity-large-thinking",
                nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
            ),
            (
                "chatgpt-codex-responses",
                "gpt-5.3-codex-spark",
                nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            ),
        ] {
            let explicit: CreateSessionRequest = serde_json::from_value(serde_json::json!({
                "cwd": root,
                "backend": backend,
                "model": model,
                "api_key_env": null
            }))
            .unwrap();
            let created = manager
                .create_session(explicit)
                .await
                .unwrap_or_else(|error| panic!("explicit {backend} launch failed: {error:#}"));
            assert_eq!(created.metadata.base_url, expected_base);
            assert_eq!(created.metadata.api_key_env, None);
            let session_id = created.metadata.session_id.unwrap();
            let stored = sessions::load_session(&store_path, &session_id).unwrap();
            assert_eq!(stored.base_url, expected_base);
            assert_eq!(stored.api_key_env, None);

            // An explicit canonical managed base URL remains accepted.
            let canonical: CreateSessionRequest = serde_json::from_value(serde_json::json!({
                "cwd": root,
                "backend": backend,
                "model": model,
                "base_url": expected_base,
                "api_key_env": null
            }))
            .unwrap();
            let created = manager
                .create_session(canonical)
                .await
                .expect("an explicit canonical managed base URL must remain accepted");
            assert_eq!(created.metadata.base_url, expected_base);
        }

        let before_controls = sessions::list_sessions(&store_path).unwrap().len();
        for (backend, invalid_base, expected_error) in [
            (
                "chatgpt-codex-responses",
                "https://attacker.example/backend-api",
                "requires the approved ChatGPT origin",
            ),
            (
                "arcee-auth",
                "https://tenant.arcee.ai/api/v1",
                "does not match the stored credential origin",
            ),
        ] {
            let model = if backend == "arcee-auth" {
                "trinity-large-thinking"
            } else {
                "gpt-5.3-codex-spark"
            };
            let invalid: CreateSessionRequest = serde_json::from_value(serde_json::json!({
                "cwd": root,
                "backend": backend,
                "model": model,
                "base_url": invalid_base
            }))
            .unwrap();
            let error = manager
                .create_session(invalid)
                .await
                .expect_err("a present non-managed origin must not be overwritten by the default");
            assert!(error.to_string().contains(expected_error), "{error:#}");
        }

        // An unknown configured model resolves no provider: the guided
        // missing-backend error surfaces (the frontend renders the
        // from-config selection as unrecognized).
        std::fs::write(
            nac_home.join("config.toml"),
            "[model]\nmodel = \"api-model\"\n",
        )
        .unwrap();
        let error = manager
            .create_session(CreateSessionRequest {
                cwd: Some(root.clone()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("an unknown configured model must not resolve a backend");
        assert!(error.to_string().contains("backend"), "{error:#}");
        assert_eq!(
            sessions::list_sessions(&store_path).unwrap().len(),
            before_controls,
            "mismatch and unresolved failures must not persist sessions"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn empty_patch_never_repairs_or_revisions_uncached_managed_config() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_base_patch_repair");
        let nac_home = root.join("nac-home");
        write_codex_auth(&nac_home);
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let store_path = root.join("store.db");
        let manager = test_manager(&root);

        for (session_id, backend, expected_base, light_api_key_env) in [
            (
                "repair-codex",
                BackendKind::ChatGptCodexResponses,
                nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
                Some("STALE_API_KEY"),
            ),
            (
                "repair-arcee",
                BackendKind::ArceeAuth,
                nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
                Some("STALE_API_KEY"),
            ),
            (
                "repair-arcee-without-light-selector",
                BackendKind::ArceeAuth,
                nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
                None,
            ),
        ] {
            seed_session(&root, session_id, "2026-01-01 00:00:00.000000000");
            let mut incomplete = sessions::load_session(&store_path, session_id).unwrap();
            incomplete.backend = backend;
            if backend == BackendKind::ArceeAuth {
                incomplete.model = "trinity-large-thinking".to_string();
            }
            incomplete.base_url.clear();
            incomplete.api_key_env = Some("STALE_API_KEY".to_string());
            incomplete.light_model = Some(LightModelSettings {
                model: match backend {
                    BackendKind::ArceeAuth => "trinity-large-thinking",
                    BackendKind::ChatGptCodexResponses => "gpt-5.2-codex",
                    _ => unreachable!("test only covers managed backends"),
                }
                .to_string(),
                backend: Some(backend),
                base_url: Some(expected_base.to_string()),
                api_key_env: light_api_key_env.map(str::to_string),
                reasoning_effort: None,
            });
            sessions::update_session_config(&store_path, &incomplete).unwrap();
            let before = sessions::load_session(&store_path, session_id).unwrap();

            manager
                .update_session_config(session_id, UpdateConfigRequest::default())
                .await
                .expect("empty PATCH is a no-op even when legacy managed config needs repair");
            let after = sessions::load_session(&store_path, session_id).unwrap();
            assert_eq!(after.base_url, before.base_url);
            assert_eq!(after.api_key_env, before.api_key_env);
            assert_eq!(after.light_model, before.light_model);
            assert_eq!(after.config_version, before.config_version);
            assert_eq!(after.updated_at, before.updated_at);
        }

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn api_key_settings_switch_to_arcee_normalizes_omitted_managed_endpoint_and_credentials()
    {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("api_key_to_arcee_patch");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        seed_editable_session(&root, "session");
        let store_path = root.join("store.db");
        let mut api_key_session = sessions::load_session(&store_path, "session").unwrap();
        api_key_session.reasoning_effort = None;
        let inherited_selector = api_key_session
            .api_key_env
            .clone()
            .expect("seeded API-key session has a selector");
        sessions::update_session_config(&store_path, &api_key_session).unwrap();
        let manager = test_manager(&root);

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-auth".to_string()),
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    light_model: RequestField::Value(LightModelSettings {
                        model: "trinity-large-thinking".to_string(),
                        backend: Some(BackendKind::ArceeAuth),
                        base_url: None,
                        api_key_env: Some(inherited_selector),
                        reasoning_effort: None,
                    }),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("managed PATCH must normalize its omitted endpoint and credential fields");

        let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(stored.backend, BackendKind::ArceeAuth);
        assert_eq!(
            stored.base_url,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
        );
        assert_eq!(stored.api_key_env, None);
        assert_eq!(
            stored
                .light_model
                .as_ref()
                .and_then(|light| light.api_key_env.as_deref()),
            None
        );
        let rehydrated = manager.session_config("session").unwrap();
        assert_eq!(rehydrated.backend.as_deref(), Some("arcee-auth"));
        assert_eq!(
            rehydrated.base_url,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
        );
        assert_eq!(rehydrated.api_key_env, None);
        assert_eq!(
            rehydrated
                .light_model
                .as_ref()
                .and_then(|light| light.api_key_env.as_deref()),
            None
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn create_reports_the_missing_light_model_credential() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("create_missing_light_credential");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let manager = test_manager(&root);

        let error = manager
            .create_session(CreateSessionRequest {
                model: RequestField::Value("moonshotai/kimi-k3".to_string()),
                base_url: RequestField::Value("https://api.arcee.ai/api/v1".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                api_key_env: RequestField::Null,
                light_model: RequestField::Value(LightModelSettings {
                    model: "deepseek/deepseek-v4-flash-latest".to_string(),
                    backend: Some(BackendKind::ArceeApi),
                    base_url: Some("https://api.arcee.ai/api/v1".to_string()),
                    api_key_env: None,
                    reasoning_effort: None,
                }),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("an API-key light model without a key must fail creation");
        let response = ApiError::from(error);

        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        assert!(
            response.message.contains("invalid light model settings"),
            "{}",
            response.message
        );
        assert!(
            response.message.contains("api_key_env"),
            "{}",
            response.message
        );
        assert!(
            response.message.contains("ARCEE_API_KEY"),
            "{}",
            response.message
        );
        assert!(manager.list_sessions(false).await.unwrap().is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn update_reports_the_missing_light_model_credential() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("update_missing_light_credential");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        seed_editable_session(&root, "session");
        let manager = test_manager(&root);

        let error = manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    light_model: RequestField::Value(LightModelSettings {
                        model: "deepseek/deepseek-v4-flash-latest".to_string(),
                        backend: Some(BackendKind::ArceeApi),
                        base_url: Some("https://api.arcee.ai/api/v1".to_string()),
                        api_key_env: None,
                        reasoning_effort: None,
                    }),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect_err("an API-key light model without a key must fail the update");
        let response = ApiError::from(error);

        assert_eq!(response.status, StatusCode::BAD_REQUEST);
        // Assert the rendered boundary output: the resolver keeps the cause
        // chain intact and the boundary renders it once with `{:#}`, so the
        // response pairs the context with the actionable cause.
        assert!(
            response
                .message
                .starts_with("invalid light model settings: "),
            "{}",
            response.message
        );
        assert!(
            response.message.contains("api_key_env"),
            "{}",
            response.message
        );
        assert!(
            response.message.contains("ARCEE_API_KEY"),
            "{}",
            response.message
        );

        let _ = std::fs::remove_dir_all(root);
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
        sessions::update_session_config(&root.join("store.db"), &stored).unwrap();
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
    async fn create_rejects_unsupported_backend_and_anthropic_model_efforts_before_persisting() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("create_invalid_reasoning");
        let nac_home = root.join("nac-home");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        let manager = test_manager(&root);
        let cases = [
            (
                "together-chat",
                "test-model",
                "https://api.together.xyz/v1",
                "minimal",
            ),
            (
                "anthropic-messages",
                "claude-sonnet-4-6",
                "https://api.anthropic.com/v1",
                "xhigh",
            ),
            (
                "anthropic-messages",
                "claude-opus-4-5",
                "https://api.anthropic.com/v1",
                "high",
            ),
            (
                "anthropic-messages",
                "claude-always-on-future",
                "https://api.anthropic.com/v1",
                "low",
            ),
        ];

        for (backend, model, base_url, effort) in cases {
            let error = manager
                .create_session(CreateSessionRequest {
                    model: RequestField::Value(model.to_string()),
                    base_url: RequestField::Value(base_url.to_string()),
                    backend: RequestField::Value(backend.to_string()),
                    reasoning_effort: RequestField::Value(effort.to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    ..CreateSessionRequest::default()
                })
                .await
                .expect_err("unsupported effort must fail creation");
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(effort), "{error:#}");
            assert!(error.to_string().contains(backend), "{error:#}");
            if backend == "anthropic-messages" {
                assert!(error.to_string().contains(model), "{error:#}");
            }
            assert_eq!(ApiError::from(error).status, StatusCode::BAD_REQUEST);
            assert!(
                !root.join("store.db").exists(),
                "invalid {model}/{effort} must fail before persistence"
            );
        }
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
                    orchestrator_compaction_threshold: RequestField::Value(64_000),
                    light_model: RequestField::Omitted,
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
        assert_eq!(replaced.orchestrator_compaction_threshold, Some(64_000));
        assert_eq!(
            manager
                .session_config("session")
                .unwrap()
                .orchestrator_compaction_threshold,
            Some(64_000)
        );

        manager.attach_session("session").await.unwrap();
        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-auth".to_string()),
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai".to_string()),
                    reasoning_effort: RequestField::Null,
                    api_key_env: RequestField::Null,
                    extra_headers: RequestField::Null,
                    orchestrator_compaction_threshold: RequestField::Null,
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
        assert_eq!(arcee_auth.orchestrator_compaction_threshold, None);

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-api".to_string()),
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai/api/v1".to_string()),
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    orchestrator_compaction_threshold: RequestField::Value(32_000),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("switch to Arcee API key mode");
        let arcee_api = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(arcee_api.backend, BackendKind::ArceeApi);
        assert_eq!(arcee_api.orchestrator_compaction_threshold, Some(32_000));

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("chatgpt-codex-responses".to_string()),
                    model: RequestField::Value("gpt-5.2-codex".to_string()),
                    base_url: RequestField::Value("https://chatgpt.com/backend-api".to_string()),
                    api_key_env: RequestField::Null,
                    orchestrator_compaction_threshold: RequestField::Value(0),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect("switch to Codex stored OAuth mode");
        let codex = sessions::load_session(&root.join("store.db"), "session").unwrap();
        assert_eq!(codex.backend, BackendKind::ChatGptCodexResponses);
        assert_eq!(codex.api_key_env, None);
        assert_eq!(codex.orchestrator_compaction_threshold, None);

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("openai-responses".to_string()),
                    model: RequestField::Value("gpt-5.2".to_string()),
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
        assert_eq!(rebuilt.metadata.model, "gpt-5.2");
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
                orchestrator_compaction_threshold: RequestField::Value(
                    nac_core::MAX_SUPPORTED_TOKEN_COUNT + 1,
                ),
                ..UpdateConfigRequest::default()
            },
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
                // Clearing the selector fails only when conventional-var
                // auto-selection cannot repair it: deepseek's conventional
                // variable is cleared in this environment (the session's
                // own openai conventional variable is set and would
                // auto-select, so clearing stays valid there).
                backend: RequestField::Value("deepseek-chat".to_string()),
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
            UpdateConfigRequest {
                model: RequestField::Value("claude-sonnet-4-6".to_string()),
                base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
                backend: RequestField::Value("anthropic-messages".to_string()),
                reasoning_effort: RequestField::Value("xhigh".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                model: RequestField::Value("claude-opus-4-5".to_string()),
                base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
                backend: RequestField::Value("anthropic-messages".to_string()),
                reasoning_effort: RequestField::Value("high".to_string()),
                ..UpdateConfigRequest::default()
            },
            UpdateConfigRequest {
                model: RequestField::Value("claude-always-on-future".to_string()),
                base_url: RequestField::Value("https://api.anthropic.com/v1".to_string()),
                backend: RequestField::Value("anthropic-messages".to_string()),
                reasoning_effort: RequestField::Value("low".to_string()),
                ..UpdateConfigRequest::default()
            },
        ];

        for request in invalid {
            let anthropic_model = match (&request.backend, &request.model) {
                (RequestField::Value(backend), RequestField::Value(model))
                    if backend == "anthropic-messages" =>
                {
                    Some(model.clone())
                }
                _ => None,
            };
            let error = manager
                .update_session_config("session", request)
                .await
                .unwrap_err();
            if let Some(model) = anthropic_model {
                assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
                assert!(error.to_string().contains(&model), "{error:#}");
            }
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
                        orchestrator_compaction_threshold: RequestField::Omitted,
                        light_model: RequestField::Omitted,
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
                behavior: sessions::SessionBehavior::Orchestrator,
                first_chat: false,
                project_id: None,
                cwd: None,
                model: RequestField::Omitted,
                base_url: RequestField::Value("http://api.arcee.ai/insecure".to_string()),
                backend: RequestField::Value("arcee-auth".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Omitted,
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
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
        sessions::update_session_config(&store_path, &attach_snapshot).unwrap();
        let attach_error = match manager.attach_session("attach-invalid").await {
            Ok(_) => panic!("arcee-api attach without api_key_env must fail"),
            Err(error) => error,
        };
        // The guided error names the provider's conventional variable
        // (ScopedModelEnv keeps ARCEE_API_KEY cleared, so auto-selection
        // cannot adopt it).
        assert!(
            attach_error
                .to_string()
                .contains("set the ARCEE_API_KEY environment variable"),
            "{attach_error:#}"
        );
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
                        orchestrator_compaction_threshold: RequestField::Omitted,
                        light_model: RequestField::Omitted,
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
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
                    backend: RequestField::Value("arcee-auth".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Omitted,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
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
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Value("https://api.arcee.ai/api".to_string()),
                    backend: RequestField::Value("arcee-api".to_string()),
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .expect("approved arcee-api configuration with an explicit selector should persist");
        let api_mode = sessions::load_session(&store_path, "update").unwrap();
        assert_eq!(api_mode.base_url, "https://api.arcee.ai/api");
        assert_eq!(api_mode.api_key_env.as_deref(), Some("OPENAI_API_KEY"));

        let created = manager
            .create_session(CreateSessionRequest {
                behavior: sessions::SessionBehavior::Orchestrator,
                first_chat: false,
                project_id: None,
                cwd: None,
                model: RequestField::Value("test-model".to_string()),
                base_url: RequestField::Value("https://tenant.arcee.ai/api/v1".to_string()),
                backend: RequestField::Value("arcee-api".to_string()),
                reasoning_effort: RequestField::Omitted,
                api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
                extra_headers: RequestField::Omitted,
                orchestrator_compaction_threshold: RequestField::Omitted,
                light_model: RequestField::Omitted,
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
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
                    model: RequestField::Value("trinity-large-thinking".to_string()),
                    base_url: RequestField::Omitted,
                    backend: RequestField::Omitted,
                    reasoning_effort: RequestField::Omitted,
                    api_key_env: RequestField::Null,
                    extra_headers: RequestField::Omitted,
                    orchestrator_compaction_threshold: RequestField::Omitted,
                    light_model: RequestField::Omitted,
                },
            )
            .await
            .expect("null api_key_env should clear the invalid legacy value");

        let stored = sessions::load_session(&root.join("store.db"), "legacy-arcee").unwrap();
        assert_eq!(stored.backend, BackendKind::ArceeAuth);
        assert_eq!(stored.model, "trinity-large-thinking");
        assert_eq!(stored.api_key_env, None);

        let _ = std::fs::remove_dir_all(&root);
    }

    fn test_event(sequence_id: u64, message: &str) -> SessionEventEnvelope {
        SessionEventEnvelope {
            session_id: Some("session-1".to_string()),
            epoch_id: "test-epoch".to_string(),
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
    async fn session_snapshot_recovers_non_contiguous_transcript_tail() {
        let _lock = SERVER_MODEL_ENV_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let root = temp_root("transcript_gap_recovery");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
        let transcript = vec![
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "first prompt".to_string(),
            },
            Message::Assistant {
                content: Some("first answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::User {
                content: "second prompt".to_string(),
            },
            Message::Assistant {
                content: Some("second answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::User {
                content: "third prompt".to_string(),
            },
            Message::Assistant {
                content: Some("third answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ];
        seed_session_with_messages(
            &root,
            "target",
            "2026-01-02 00:00:00.000000000",
            transcript.clone(),
        );
        let orphan = Message::User {
            content: "must not be exposed".to_string(),
        };
        nac_core::test_support::store::append_thread_event(
            &root.join("store.db"),
            "target",
            nac_core::test_support::store::ORCHESTRATOR_STEERING_TARGET,
            &nac_core::test_support::store::encode_transcript_log_entry(8, &orphan).unwrap(),
        )
        .unwrap();
        let manager = test_manager(&root);
        let gate = manager.lifecycle_gate("target");
        let lifecycle = gate.lock().await;
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "target").unwrap();
        manager
            .attach_current_operation_service_locked("target", &operation_lease)
            .await
            .expect("cold prompt attach must reuse its existing operation lease");
        drop(lifecycle);
        drop(operation_lease);
        let app = router(manager);

        let response = get_response(app, "/sessions/target", None).await;
        let status = response.status();
        let body = response_body(response).await;
        assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
        let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(snapshot["messages"].as_array().unwrap().len(), 7);
        let warning = snapshot["transcript_recovery_warning"].as_str().unwrap();
        assert!(warning.contains("index 7"), "{warning}");
        assert!(
            warning.contains("1 untrusted transcript log row"),
            "{warning}"
        );
        assert!(!warning.contains("must not be exposed"), "{warning}");
        let summary = snapshot["sessions"]
            .as_array()
            .unwrap()
            .iter()
            .find(|summary| summary["session_id"] == "target")
            .unwrap();
        assert_eq!(summary["visible_message_count"], 6);
        assert_eq!(summary["last_user_prompt"], "third prompt");
        assert!(TranscriptLogWriter::new(&root.join("store.db"))
            .unwrap()
            .read_from("target", 7)
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn snapshot_projection_preserves_defaults_and_all_non_session_fields() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("snapshot_projection");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
        let transcript = test_transcript();
        seed_session_with_messages(
            &root,
            "target",
            "2026-01-02 00:00:00.000000000",
            transcript.clone(),
        );
        seed_session(&root, "other", "2026-01-01 00:00:00.000000000");
        let app = router(test_manager(&root));
        let query = "message_limit=2&thread_event_limit=24";

        let default_response =
            get_response(app.clone(), &format!("/sessions/target?{query}"), None).await;
        let default_status = default_response.status();
        let default_body = response_body(default_response).await;
        assert_eq!(
            default_status,
            StatusCode::OK,
            "{}",
            String::from_utf8_lossy(&default_body)
        );
        let default: serde_json::Value = serde_json::from_slice(&default_body).unwrap();

        let true_response = get_response(
            app.clone(),
            &format!("/sessions/target?{query}&include_sessions=true"),
            None,
        )
        .await;
        assert_eq!(true_response.status(), StatusCode::OK);
        let included: serde_json::Value =
            serde_json::from_slice(&response_body(true_response).await).unwrap();
        assert_eq!(included, default);
        assert_eq!(default["sessions"].as_array().unwrap().len(), 2);

        let false_response = get_response(
            app,
            &format!("/sessions/target?{query}&include_sessions=false"),
            None,
        )
        .await;
        assert_eq!(false_response.status(), StatusCode::OK);
        let projected: serde_json::Value =
            serde_json::from_slice(&response_body(false_response).await).unwrap();
        assert_eq!(projected["sessions"], serde_json::json!([]));
        let mut expected_projected = default.clone();
        expected_projected["sessions"] = serde_json::json!([]);
        assert_eq!(projected, expected_projected);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn paged_routes_preserve_raw_indexes_timestamps_and_projection_caps() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("paged_route_contract");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
        let mut transcript = test_transcript();
        transcript.insert(
            6,
            Message::Tool {
                tool_call_id: "call-thread".to_string(),
                content: "thread result".into(),
            },
        );
        seed_session_with_messages(&root, "target", "2026-01-02 00:00:00.000000000", transcript);
        TranscriptLogWriter::new(&root.join("store.db"))
            .unwrap()
            .append(
                "target",
                9,
                &Message::User {
                    content: "logged tail".to_string(),
                },
            )
            .unwrap();
        let app = router(test_manager(&root));

        let response = get_response(
            app.clone(),
            "/sessions/target/messages?before=10&limit=4&include_system=true",
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let page: serde_json::Value =
            serde_json::from_slice(&response_body(response).await).unwrap();
        assert_eq!(
            page["page"],
            serde_json::json!({
                "start": 6,
                "end": 10,
                "total": 10,
                "has_older": true,
            })
        );
        assert_eq!(
            page["messages"]
                .as_array()
                .unwrap()
                .iter()
                .map(|message| message["role"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["tool", "system", "assistant", "user"]
        );
        let created_at = page["created_at"].as_array().unwrap();
        assert_eq!(created_at.len(), 4);
        assert!(created_at[..3].iter().all(serde_json::Value::is_null));
        assert!(created_at[3].is_string());
        assert_eq!(page["messages"][3]["content"], "logged tail");

        let response = get_response(
            app,
            "/sessions/target?message_limit=3&thread_event_limit=1&include_sessions=false&include_system=true",
            None,
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let snapshot: serde_json::Value =
            serde_json::from_slice(&response_body(response).await).unwrap();
        assert_eq!(snapshot["messages"].as_array().unwrap().len(), 3);
        assert_eq!(snapshot["message_created_at"].as_array().unwrap().len(), 3);
        assert_eq!(
            snapshot["message_page"],
            serde_json::json!({
                "start": 7,
                "end": 10,
                "total": 10,
                "has_older": true,
            })
        );
        let message_created_at = snapshot["message_created_at"].as_array().unwrap();
        assert!(message_created_at[..2]
            .iter()
            .all(serde_json::Value::is_null));
        assert!(message_created_at[2].is_string());
        assert_eq!(snapshot["sessions"], serde_json::json!([]));
        assert!(snapshot["thread_events"]
            .as_object()
            .unwrap()
            .values()
            .all(|events| events.as_array().unwrap().len() <= 1));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn paged_message_queries_exclude_system_prompts_by_default() {
        let Query(snapshot_query) = Query::<SessionSnapshotQuery>::try_from_uri(
            &"/sessions/test?message_limit=2".parse().unwrap(),
        )
        .unwrap();
        let Query(messages_query) = Query::<MessagesQuery>::try_from_uri(
            &"/sessions/test/messages?before=3&limit=2".parse().unwrap(),
        )
        .unwrap();
        assert!(!snapshot_query.include_system);
        assert!(!messages_query.include_system);
    }

    #[test]
    fn paged_message_queries_include_system_prompts_when_requested() {
        let Query(snapshot_query) = Query::<SessionSnapshotQuery>::try_from_uri(
            &"/sessions/test?message_limit=3&include_system=true"
                .parse()
                .unwrap(),
        )
        .unwrap();
        let Query(messages_query) = Query::<MessagesQuery>::try_from_uri(
            &"/sessions/test/messages?before=3&limit=3&include_system=true"
                .parse()
                .unwrap(),
        )
        .unwrap();
        assert!(snapshot_query.include_system);
        assert!(messages_query.include_system);
    }

    #[tokio::test]
    async fn sse_route_is_never_compressed_and_preserves_boundary_ordering() {
        async fn finite_sse_route(
        ) -> Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>> {
            let replayed = vec![test_event(4, "replayed-4"), test_event(5, "replayed-5")];
            let live = test_event(6, "live-6");
            let (sender, receiver) = tokio::sync::broadcast::channel(4);
            sender.send(live).unwrap();
            drop(sender);
            let (delta_sender, assistant_deltas) = tokio::sync::broadcast::channel(4);
            drop(delta_sender);

            Sse::new(session_event_stream(
                "test-epoch".to_string(),
                5,
                Some(SessionReplayGap {
                    missing_from_sequence_id: 2,
                    missing_to_sequence_id: 3,
                }),
                replayed,
                receiver,
                assistant_deltas,
            ))
        }

        let app = Router::new()
            .route("/events", get(finite_sse_route))
            .layer(response_compression_layer());
        let response = get_response(app, "/events", Some("gzip")).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE),
            Some(&header::HeaderValue::from_static("text/event-stream"))
        );
        assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
        let body = response_body(response).await;
        let body = String::from_utf8(body.to_vec()).unwrap();

        let boundary = body.find("event: replay_boundary").unwrap();
        let gap = body.find("event: replay_gap").unwrap();
        let replay_4 = body.find("\"sequence_id\":4").unwrap();
        let replay_5 = body.find("\"sequence_id\":5").unwrap();
        let live_6 = body.find("\"sequence_id\":6").unwrap();
        assert!(boundary < gap && gap < replay_4 && replay_4 < replay_5 && replay_5 < live_6);
        assert!(body.contains("\"replay_boundary_sequence_id\":5"));
        assert!(body.contains("\"epoch_id\":\"test-epoch\""));

        let boundary_frame = body.split("\n\n").next().unwrap();
        assert!(!boundary_frame.lines().any(|line| line.starts_with("id:")));
    }

    #[tokio::test]
    async fn project_http_create_list_patch_and_location_conflict() {
        let root = temp_root("project_http");
        let workspace = root.join("workspace");
        std::fs::create_dir_all(workspace.join("nested")).unwrap();
        let manager = test_manager(&root);
        let app = router(manager);

        let created_response = post_json(
            app.clone(),
            "/projects",
            serde_json::json!({
                "cwd": workspace.join("nested").join(".."),
                "description": "Initial description"
            }),
        )
        .await;
        assert_eq!(created_response.status(), StatusCode::CREATED);
        let created: ProjectRecord =
            serde_json::from_slice(&response_body(created_response).await).unwrap();
        assert_eq!(created.cwd, workspace.canonicalize().unwrap());
        assert_eq!(created.name, "workspace");
        assert_eq!(created.description.as_deref(), Some("Initial description"));

        let listed = get_response(app.clone(), "/projects", None).await;
        assert_eq!(listed.status(), StatusCode::OK);
        let listed: serde_json::Value =
            serde_json::from_slice(&response_body(listed).await).unwrap();
        assert_eq!(listed["projects"].as_array().unwrap().len(), 1);
        assert_eq!(listed["projects"][0]["project_id"], created.project_id);

        let patched = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/projects/{}", created.project_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"name":"Renamed","description":null}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(patched.status(), StatusCode::OK);
        let patched: ProjectRecord = serde_json::from_slice(&response_body(patched).await).unwrap();
        assert_eq!(patched.name, "Renamed");
        assert_eq!(patched.description, None);

        let null_name = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/projects/{}", created.project_id))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"name":null}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(null_name.status(), StatusCode::BAD_REQUEST);

        let duplicate = post_json(
            app.clone(),
            "/projects",
            serde_json::json!({"cwd": workspace}),
        )
        .await;
        assert_eq!(duplicate.status(), StatusCode::CONFLICT);

        let missing = post_json(
            app,
            "/projects",
            serde_json::json!({"cwd": root.join("missing")}),
        )
        .await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn project_session_materializes_defaults_and_filters_membership() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("project_session");
        let workspace = root.join("workspace");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("project-test-key"));
        let manager = test_manager(&root);
        let store_path = root.join("store.db");

        model_configurations::insert_model_configuration(
            &store_path,
            "project-default",
            model_configurations::NewModelConfiguration {
                name: "Project default".to_string(),
                backend: "openai-responses".to_string(),
                model: "gpt-5.2".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                api_key_env: Some("OPENAI_API_KEY".to_string()),
                reasoning_effort: Some("high".to_string()),
                extra_headers: BTreeMap::from([("X-Project".to_string(), "selected".to_string())]),
                orchestrator_compaction_threshold: Some(64_000),
                initial_prompt: Some("ignored during creation".to_string()),
                light_model: None,
            },
        )
        .unwrap();
        let project = manager
            .create_project(CreateProjectRequest {
                name: Some("Backend".to_string()),
                description: None,
                cwd: workspace.clone(),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: Some("project-default".to_string()),
            })
            .await
            .unwrap();

        let first_chat = CreateSessionRequest {
            first_chat: true,
            project_id: Some(project.project_id.clone()),
            reasoning_effort: RequestField::Value("low".to_string()),
            ..CreateSessionRequest::default()
        };
        let (created, duplicate) = tokio::join!(
            manager.create_session(first_chat.clone()),
            manager.create_session(first_chat)
        );
        let created = created.unwrap();
        let duplicate = duplicate.unwrap();
        assert_eq!(
            created.metadata.session_id, duplicate.metadata.session_id,
            "concurrent required-first-chat requests must converge on one primary session"
        );
        let session_id = created.metadata.session_id.clone().unwrap();
        assert_eq!(
            created.metadata.project_id.as_deref(),
            Some(project.project_id.as_str())
        );
        let stored = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(stored.project_id, Some(project.project_id.clone()));
        assert_eq!(stored.cwd, workspace.canonicalize().unwrap());
        assert_eq!(stored.model, "gpt-5.2");
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Low));
        assert_eq!(
            stored.extra_headers.get("X-Project").map(String::as_str),
            Some("selected")
        );
        assert_eq!(stored.orchestrator_compaction_threshold, Some(64_000));

        let filtered = manager
            .list_sessions_for_project(false, Some(&project.project_id))
            .await
            .unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(
            filtered[0].summary.project_id.as_deref(),
            Some(project.project_id.as_str())
        );

        let conflict = manager
            .create_session(CreateSessionRequest {
                project_id: Some(project.project_id.clone()),
                cwd: Some(workspace),
                ..CreateSessionRequest::default()
            })
            .await
            .unwrap_err();
        assert!(conflict.to_string().contains("cannot be combined"));
        assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

        let missing = manager
            .create_session(CreateSessionRequest {
                project_id: Some("missing".to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .unwrap_err();
        assert!(missing.to_string().contains("was not found"));
        assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

        let required_null = manager
            .create_session(CreateSessionRequest {
                project_id: Some(project.project_id.clone()),
                model: RequestField::Null,
                ..CreateSessionRequest::default()
            })
            .await
            .unwrap_err();
        assert!(required_null.to_string().contains("model"));
        assert_eq!(manager.list_sessions(false).await.unwrap().len(), 1);

        let deletion = delete_model_config_handler(
            State(manager.clone()),
            AxumPath("project-default".to_string()),
        )
        .await
        .unwrap_err();
        assert_eq!(deletion.status, StatusCode::CONFLICT);
        assert!(
            model_configurations::load_model_configuration(&store_path, "project-default").is_ok()
        );
        manager
            .update_project(
                &project.project_id,
                UpdateProjectRequest {
                    default_model_config_id: RequestField::Null,
                    ..UpdateProjectRequest::default()
                },
            )
            .unwrap();
        assert_eq!(
            delete_model_config_handler(
                State(manager.clone()),
                AxumPath("project-default".to_string()),
            )
            .await
            .unwrap(),
            StatusCode::NO_CONTENT
        );
        let reloaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(reloaded.model, "gpt-5.2");
        assert_eq!(reloaded.project_id, Some(project.project_id));

        let _ = std::fs::remove_dir_all(root);
    }

    async fn post_json(app: Router, uri: &str, body: serde_json::Value) -> Response {
        app.oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
    }

    /// One-shot stand-in for a provider's model index, answering the first
    /// request with `body` and reporting the `Authorization` header it saw — so
    /// a test can tell which credential actually went out on the wire.
    fn scripted_model_index(body: &'static str) -> (String, std::sync::mpsc::Receiver<String>) {
        use std::io::{Read, Write};

        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind model index");
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let (sender, receiver) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept model index request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let authorization = String::from_utf8_lossy(&request)
                .lines()
                .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
                .map(|line| line[line.find(':').unwrap() + 1..].trim().to_string())
                .unwrap_or_default();
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes());
            let _ = socket.flush();
            let _ = sender.send(authorization);
        });
        (base_url, receiver)
    }

    /// A key the UI supplies is filed away under a name the server picks, and
    /// from then on that name stands in for the secret: the value never comes
    /// back out, and the caller reaches the provider by naming it instead.
    #[tokio::test]
    async fn a_supplied_key_is_filed_under_a_generated_name_and_answers_by_it() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("generated_credential");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).expect("create NAC home");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let app = router(test_manager(&root));

        let stored = post_json(
            app.clone(),
            "/credentials",
            serde_json::json!({ "value": "sk-server-test-key" }),
        )
        .await;
        assert_eq!(stored.status(), StatusCode::OK);
        let name = response_json(stored).await["name"]
            .as_str()
            .expect("generated credential name")
            .to_string();
        assert!(name.starts_with(GENERATED_CREDENTIAL_PREFIX));

        let listed = get_response(app.clone(), "/credentials", None).await;
        let listed = String::from_utf8(response_body(listed).await.to_vec()).unwrap();
        assert!(listed.contains(&name));
        assert!(
            !listed.contains("sk-server-test-key"),
            "a stored key must never be readable back: {listed}"
        );

        let (base_url, authorization) = scripted_model_index(r#"{"data":[{"id":"model-a"}]}"#);
        let models = post_json(
            app,
            "/providers/models",
            serde_json::json!({
                "backend": "openai-responses",
                "api_key_env": name,
                "base_url": base_url,
            }),
        )
        .await;
        assert_eq!(models.status(), StatusCode::OK);
        let models = response_json(models).await;
        assert_eq!(models["models"][0]["id"], "model-a");
        assert_eq!(
            authorization
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("the model index was asked"),
            "Bearer sk-server-test-key"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn saved_config_managed_updates_clear_inherited_light_selectors() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("saved_config_managed_light_clear");
        let nac_home = root.join("nac-home");
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let manager = test_manager(&root);
        let inherited_selector = "NAC_CONFIG_OLD_KEY";
        let managed_light = || LightModelSettings {
            model: "trinity-large-thinking".to_string(),
            backend: Some(BackendKind::ArceeAuth),
            base_url: None,
            api_key_env: Some(inherited_selector.to_string()),
            reasoning_effort: None,
        };

        model_configurations::insert_model_configuration(
            &manager.inner.store_path,
            "repair",
            model_configurations::NewModelConfiguration {
                name: "Managed repair".to_string(),
                backend: BackendKind::ArceeAuth.to_string(),
                model: "trinity-large-thinking".to_string(),
                base_url: nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL.to_string(),
                api_key_env: Some(inherited_selector.to_string()),
                reasoning_effort: None,
                extra_headers: BTreeMap::new(),
                orchestrator_compaction_threshold: None,
                initial_prompt: None,
                light_model: Some(managed_light()),
            },
        )
        .unwrap();
        let Json(repaired) = update_model_config_handler(
            State(manager.clone()),
            AxumPath("repair".to_string()),
            Ok(Json(UpdateModelConfigurationRequest::default())),
        )
        .await
        .expect("managed repair clears inherited selectors");
        assert_eq!(repaired.api_key_env, None);
        assert_eq!(
            repaired
                .light_model
                .as_ref()
                .and_then(|light| light.api_key_env.as_deref()),
            None
        );

        model_configurations::insert_model_configuration(
            &manager.inner.store_path,
            "switch",
            model_configurations::NewModelConfiguration {
                name: "Managed switch".to_string(),
                backend: BackendKind::ArceeApi.to_string(),
                model: "trinity-large-thinking".to_string(),
                base_url: "https://api.arcee.ai/api/v1".to_string(),
                api_key_env: Some(inherited_selector.to_string()),
                reasoning_effort: None,
                extra_headers: BTreeMap::new(),
                orchestrator_compaction_threshold: None,
                initial_prompt: None,
                light_model: None,
            },
        )
        .unwrap();
        let Json(switched) = update_model_config_handler(
            State(manager.clone()),
            AxumPath("switch".to_string()),
            Ok(Json(UpdateModelConfigurationRequest {
                backend: RequestField::Value(BackendKind::ArceeAuth),
                light_model: RequestField::Value(managed_light()),
                ..UpdateModelConfigurationRequest::default()
            })),
        )
        .await
        .expect("managed switch clears inherited selectors");
        assert_eq!(switched.api_key_env, None);
        assert_eq!(
            switched
                .light_model
                .as_ref()
                .and_then(|light| light.api_key_env.as_deref()),
            None
        );

        let _ = std::fs::remove_dir_all(root);
    }

    /// Naming a credential is not a way to probe for one: a name with nothing
    /// behind it is refused before any request goes out, and a provider that
    /// signs in through the browser takes no name at all.
    #[tokio::test]
    async fn the_model_index_refuses_an_unresolvable_name_and_a_login_backend() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("model_index_by_name");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).expect("create NAC home");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let app = router(test_manager(&root));

        let unresolvable = post_json(
            app.clone(),
            "/providers/models",
            serde_json::json!({
                "backend": "openai-responses",
                "api_key_env": "NAC_CONFIG_absent",
            }),
        )
        .await;
        assert_eq!(unresolvable.status(), StatusCode::BAD_REQUEST);
        let message = response_json(unresolvable).await["error"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(
            message.contains("NAC_CONFIG_absent"),
            "the refusal names what could not be resolved: {message}"
        );

        let managed = post_json(
            app,
            "/providers/models",
            serde_json::json!({
                "backend": "chatgpt-codex-responses",
                "api_key_env": "NAC_CONFIG_absent",
            }),
        )
        .await;
        assert_eq!(managed.status(), StatusCode::BAD_REQUEST);
        let message = response_json(managed).await["error"]
            .as_str()
            .unwrap_or_default()
            .to_string();
        assert!(
            message.contains("stored login"),
            "a login backend explains that it takes no key: {message}"
        );

        let _ = std::fs::remove_dir_all(root);
    }
}
