mod compaction;
mod filesystem;
mod managed_auth;
mod revert;

pub use compaction::{CompactSessionError, CompactSessionResponse};
pub use filesystem::{BrowseEntry, BrowseKind, BrowseListing, BrowseQuery};
pub use managed_auth::{
    DeviceLoginStartedResponse, DeviceLoginStateResponse, ManagedAuthListResponse,
    ManagedAuthStatusResponse,
};
pub use revert::{
    RegenerateSessionError, RegenerateSessionRequest, RevertSessionError, RevertSessionRequest,
    RevertSessionResponse,
};

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
    middleware::{self, Next},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use include_dir::{include_dir, Dir};
use nac_core::{
    commands::{FrontendCommand, PreparedUserInput},
    events::{
        AssistantStreamDelta, AssistantStreamDeltaReceiver, SessionEventEnvelope, SessionReplayGap,
    },
    model::{
        list_managed_provider_models, list_provider_models, list_stored_api_keys,
        managed_backend_base_url, provider_default_base_url, provider_for_model,
        provider_uses_api_key, remove_api_key, resolve_backend_api_key, resolve_model_base_url,
        store_api_key, validate_caller_supplied_base_url, validate_model_configuration,
        BackendKind, EffectiveModelSettings, ManagedAuthProvider, ModelConfigurationError,
        ModelListing, ProviderModel, ReasoningEffort,
    },
    model_configurations::{self, ModelConfigurationRecord, ModelConfigurationStoreError},
    ssh_configurations::{self, SshConfigurationRecord, SshConfigurationStoreError},
    runtime::{
        self, CredentialDestinationPolicy, ModelOptions, NacConfig, OptionalModelOption,
        RunOptions, SandboxOptions, StoreOptions,
    },
    session_service::{
        ActiveRunSnapshot, FrontendSnapshotLoadOptions, FrontendSnapshotMessages,
        MessagePageRequest, MessagesPageSnapshot, SessionCoordinationError, SessionEventReceiver,
        SessionFrontendSnapshot, SessionFrontendSnapshotLoad, SessionRunHandle, SessionService,
        SessionSubmitError, ThreadEventPage,
    },
    sessions,
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
}

/// Identifies a checkout across sessions. The connection has to be part of it:
/// two sessions on the same path of different machines are different checkouts,
/// and — the reason this is a pair rather than a path — two sessions on the same
/// path of the *same* remote machine are the same one. The whole connection is
/// what counts, not just the host name: the same name reached on another port or
/// as another user is another machine as far as a checkout is concerned.
type GitTargetKey = (Option<String>, PathBuf);

fn git_target_key(target: &GitTarget) -> GitTargetKey {
    (
        target
            .ssh_connection()
            .map(|connection| connection.identity()),
        target.root().to_path_buf(),
    )
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

#[derive(Debug, Clone, Serialize)]
pub struct StoreInfo {
    pub root_cwd: PathBuf,
    pub store_path: PathBuf,
    pub worker_executable: PathBuf,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct LaunchModelDefaultsRequest {
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
#[derive(Debug, Clone, Default, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
pub struct LaunchModelDefaults {
    /// Configured model id; lets the launch dialog render the inherited
    /// "from config" selection resolved against the model catalog (the
    /// frontend resolves the provider from the model id, exactly like
    /// session creation does).
    pub configured_model: Option<String>,
    /// Configured reasoning effort, if any.
    pub configured_reasoning_effort: Option<ReasoningEffort>,
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
    /// Omitted inherits `[compaction].threshold_tokens`; null or zero disables.
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
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

#[derive(Debug, Clone, Serialize)]
pub struct StoredCredentialSummary {
    pub name: String,
    /// Empty when the secret is too short for a suffix to be safe to show.
    pub last_four: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoredCredentialList {
    pub credentials: Vec<StoredCredentialSummary>,
}

/// Marks credential names this server generated for a saved configuration, so
/// deleting one never removes a key the operator manages themselves.
const GENERATED_CREDENTIAL_PREFIX: &str = "NAC_CONFIG_";

#[derive(Debug, Clone, Deserialize)]
pub struct CreateModelConfigurationRequest {
    pub name: String,
    pub backend: BackendKind,
    pub model: String,
    /// Defaults to the provider's canonical URL.
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub reasoning_effort: Option<ReasoningEffort>,
    pub extra_headers: Option<BTreeMap<String, String>>,
    /// Compaction budget sessions started from this setup inherit; absent or
    /// zero leaves them on `[compaction].threshold_tokens`.
    pub orchestrator_compaction_threshold: Option<u64>,
    /// Message the launch modal pre-fills when this setup is chosen.
    pub initial_prompt: Option<String>,
}

/// Edits a saved setup in place. Every field is tri-state: omit it to keep what
/// is stored, send null to clear it, send a value to replace it.
///
/// `api_key` is the exception that cannot be read back — the secret lives in
/// the credential store — so omitting it keeps the credential the row already
/// points at, and sending one files a fresh credential in its place.
#[derive(Debug, Clone, Default, Deserialize)]
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
    pub api_key: RequestField<String>,
    #[serde(default)]
    pub reasoning_effort: RequestField<ReasoningEffort>,
    #[serde(default)]
    pub extra_headers: RequestField<BTreeMap<String, String>>,
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
    #[serde(default)]
    pub initial_prompt: RequestField<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelConfigurationList {
    pub configurations: Vec<ModelConfigurationRecord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSshConfigurationRequest {
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: Option<u16>,
    pub ssh_identity_file: Option<String>,
}

/// Edits a saved SSH setup in place. Every field is tri-state: omit it to keep
/// what is stored, send null to clear it, send a value to replace it.
#[derive(Debug, Clone, Default, Deserialize)]
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

#[derive(Debug, Clone, Serialize)]
pub struct SshConfigurationList {
    pub configurations: Vec<SshConfigurationRecord>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModelConfigFromFileRequest {
    pub path: String,
}

/// A configuration that has been checked end to end: the destination is
/// approved, the credential resolves, and the provider answered with the
/// models it allows.
#[derive(Debug, Clone, Serialize)]
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

#[derive(Debug, Clone, Deserialize)]
pub struct ProviderModelsRequest {
    pub backend: BackendKind,
    pub api_key: Option<String>,
    /// Names a key already held in the environment or in NAC home, for a caller
    /// that has one on file and no copy of the secret to send.
    pub api_key_env: Option<String>,
    /// Overrides the provider's canonical URL, for a proxy or a custom gateway.
    pub base_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderModelList {
    /// The URL the models were actually read from, so the caller can persist
    /// the same destination it validated against.
    pub base_url: String,
    pub models: Vec<ProviderModel>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StoreCredentialRequest {
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeneratedCredential {
    pub name: String,
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
    /// Omitted preserves; null or zero disables.
    #[serde(default)]
    pub orchestrator_compaction_threshold: RequestField<u64>,
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

#[derive(Debug, Clone, Deserialize)]
pub struct SwitchBranchRequest {
    pub name: String,
    /// Make the branch first, off the current HEAD.
    #[serde(default)]
    pub create: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CommitWorkspaceRequest {
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubmitPromptResponse {
    pub run_id: String,
    pub client_id: Option<String>,
    pub display_prompt: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OrchestratorSteeringRequest {
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OrchestratorSteeringResponse {
    pub steering_id: i64,
    pub status: String,
    pub instruction_preview: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ThreadSteeringRequest {
    pub instruction: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ThreadSteeringResponse {
    pub steering_id: i64,
    pub thread_name: String,
    pub status: String,
    pub instruction_preview: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EventsQuery {
    pub after_sequence_id: Option<u64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct SessionSnapshotQuery {
    pub message_limit: Option<usize>,
    pub thread_event_limit: Option<usize>,
    pub include_sessions: Option<bool>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MessagesQuery {
    pub before: Option<usize>,
    pub limit: Option<usize>,
    #[serde(default)]
    pub include_system: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ThreadEventsQuery {
    pub before_id: Option<i64>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MessagePageMetadata {
    pub start: usize,
    pub end: usize,
    pub total: usize,
    pub has_older: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MessagesPageResponse {
    pub messages: Vec<Message>,
    pub page: MessagePageMetadata,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MessageCycleMetadata {
    pub marker: String,
    pub thread_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionSnapshotResponse {
    #[serde(flatten)]
    pub snapshot: SessionFrontendSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_page: Option<MessagePageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_cycle: Option<MessageCycleMetadata>,
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
            page: page.page.into(),
        }
    }
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
    /// Look at a captured revision instead of the working tree.
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceFileQuery {
    pub path: String,
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct WorkspaceRevisionQuery {
    pub revision: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplayBoundaryEvent {
    pub epoch_id: String,
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
                workspace_diff_cache: RwLock::new(HashMap::new()),
                git_probe_cache: RwLock::new(HashMap::new()),
                managed_logins: managed_auth::ManagedLoginRegistry::default(),
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

    pub async fn create_session(
        &self,
        request: CreateSessionRequest,
    ) -> Result<SessionFrontendSnapshot> {
        let location = self.resolve_launch_location(
            request.cwd,
            SshRequest {
                host: request.ssh_host,
                port: request.ssh_port,
                identity_file: request.ssh_identity_file,
            },
        )?;
        if location.ssh.host().is_some() && sandbox_requested(&request.sandbox) {
            return Err(anyhow!(
                "invalid request: ssh_host and sandbox options cannot both be set"
            ));
        }
        let config = NacConfig::load_from_cwd(&location.config_cwd)?;
        let orchestrator_compaction_threshold =
            create_compaction_threshold_override(request.orchestrator_compaction_threshold)?;
        let model = model_options(
            request.model,
            request.base_url,
            request.backend,
            request.reasoning_effort,
            request.api_key_env,
            request.extra_headers,
        )?;
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
        let run_config = runtime::build_run_config(
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
                self.attach_session_locked(session_id).await?
            }
        } else {
            self.attach_session_locked(session_id).await?
        };
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
    async fn idle_workspace_root(&self, session_id: &str) -> Result<GitTarget> {
        let sessions = self.list_sessions(false).await?;
        let summary = sessions
            .iter()
            .find(|entry| entry.summary.session_id == session_id)
            .ok_or_else(|| anyhow!("session '{}' was not found", session_id))?;
        let target = self.git_target(&summary.summary)?;
        let key = git_target_key(&target);

        if let Some(busy) = sessions.iter().find(|entry| {
            entry.active_run.is_some()
                && self
                    .git_target(&entry.summary)
                    .is_ok_and(|other| git_target_key(&other) == key)
        }) {
            return Err(anyhow!(
                "workspace is busy: session '{}' has a run in flight",
                busy.summary.session_id
            ));
        }

        self.ensure_git_ready(&target).await?;
        Ok(target)
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
        let target = self.idle_workspace_root(session_id).await?;

        tokio::task::spawn_blocking(move || {
            if request.create {
                // A new branch takes the uncommitted work with it, which is
                // usually the point of making one, so a dirty tree is fine.
                return workspace::create_branch(&target, &request.name);
            }
            if workspace::list_branches(&target)?.dirty {
                return Err(anyhow!(
                    "workspace has uncommitted changes; commit or stash them before switching"
                ));
            }
            workspace::switch_branch(&target, &request.name)
        })
        .await
        .context("branch switch task failed")?
    }

    /// Commit the whole checkout on the user's behalf. Guarded like a branch
    /// switch: an agent writing files underneath a `git add` would commit a
    /// half-finished tree.
    pub async fn commit_workspace(
        &self,
        session_id: &str,
        request: CommitWorkspaceRequest,
    ) -> Result<workspace::CommitOutcome> {
        let target = self.idle_workspace_root(session_id).await?;

        tokio::task::spawn_blocking(move || workspace::commit_all(&target, &request.message))
            .await
            .context("commit task failed")?
    }

    pub async fn submit_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
    ) -> Result<SubmitPromptResponse> {
        self.require_persisted_operation_session(session_id)?;
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        // The OS lease closes the cross-process gap between checking durable
        // state and synchronously establishing active-run state.
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
                    .try_submit_prepared_prompt_with_lease(prompt, operation_lease)
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
        let service = self.attach_session(session_id).await?;
        let record = service
            .queue_thread_steering(thread_name, &request.instruction)
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
        let service = self.attach_session(session_id).await?;
        let record = service.queue_orchestrator_steering(&request.instruction)?;
        Ok(OrchestratorSteeringResponse {
            steering_id: record.id,
            status: record.status,
            instruction_preview: record.instruction.chars().take(160).collect(),
        })
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
            .subscribe_events_with_replay(after_sequence_id, limit);
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
        self.require_persisted_operation_session(session_id)?;
        // Submission, config changes, and deletion share this gate. The
        // operation lease extends the exclusion to independent processes and
        // remains held through deletion so an old run cannot save the row back.
        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let service = self
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        if let Some(service) = service.as_ref() {
            if service.active_compaction().is_some() {
                return Err(anyhow!("session is busy with an active manual compaction"));
            }
            if let Some(active_run) = service.active_run() {
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
        let _operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)?;
        self.require_persisted_operation_session(session_id)?;
        if let Some(service) = service {
            // Explicitly destroy the sandbox even if SSE handlers retain the service.
            service.destroy_sandbox().await;
        }

        // The revision rows cascade with the session, but the git objects they
        // pinned only become collectable once the ref is gone.
        if let Ok(target) = self.workspace_root(session_id).await {
            if let Err(error) = workspace::forget(&target, session_id) {
                eprintln!("nac: failed to drop workspace revisions: {error:#}");
            }
        }

        // Session-owned auxiliary rows cascade; legacy child rows are removed by core.
        let deleted = view::delete_session(&self.inner.store_path, session_id)?;
        if !deleted {
            return Err(anyhow!("session '{}' was not found", session_id));
        }
        self.inner.active_sessions.write().await.remove(session_id);
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
        let request_empty = request.is_empty();
        if request_empty {
            if let Some(service) = self
                .inner
                .active_sessions
                .read()
                .await
                .get(session_id)
                .cloned()
            {
                if service.has_active_operation() {
                    return Err(anyhow!(
                        "session is busy with an active operation; wait for it before updating config"
                    ));
                }
                return Ok(());
            }
        }
        self.require_persisted_operation_session(session_id)?;

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
            if service.has_active_operation() {
                return Err(anyhow!(
                    "session is busy with an active operation; wait for it before updating config"
                ));
            }
        }

        // Independent server processes coordinate through the same
        // crash-safe lease. Keep it through validation, CAS persistence, and
        // local eviction, but never hold a SQLite transaction over model I/O.
        let _operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)?;
        self.require_persisted_operation_session(session_id)?;

        let current = sessions::load_session_config(&self.inner.store_path, session_id)?;
        if request_empty && !managed_config_needs_repair(&current) {
            return Ok(());
        }
        let mut prospective = current.clone();
        apply_raw_config_patch(&mut prospective, request)?;
        let (backend, reasoning_effort, extra_headers) = parse_prospective_model_config(
            &mut prospective,
            backend_selected,
            base_url_omitted,
            api_key_env_omitted,
        )?;

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

fn response_compression_layer() -> CompressionLayer<impl Predicate> {
    CompressionLayer::new()
        .gzip(true)
        .compress_when(DefaultPredicate::new().and(NotForContentType::SSE))
}

fn validate_bind_address(addr: SocketAddr) -> Result<()> {
    if !addr.ip().is_loopback() {
        anyhow::bail!(
            "refusing non-loopback bind address {addr}; nac-web has no remote authentication"
        );
    }
    Ok(())
}

/// Extra names this server answers to, as a comma-separated list.
///
/// A tunnel or reverse proxy forwards its own public name in `Host`, which the
/// rebinding guard below would otherwise refuse. Naming it here is the
/// operator's statement that whatever fronts the server authenticates callers
/// before traffic reaches it. `*` disables the guard entirely.
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

/// Whether a `Host` header names this loopback server.
///
/// Binding to loopback does not keep a hostile page out: an attacker can point
/// their own domain at 127.0.0.1 (DNS rebinding) and drive this unauthenticated
/// API from the victim's browser. A browser always sends the name it dialled,
/// and it cannot forge that name, so refusing every host but the loopback ones
/// closes the hole.
fn is_loopback_host(host: &str) -> bool {
    let Some(bare) = bare_host(host) else {
        return false;
    };
    bare.eq_ignore_ascii_case("localhost")
        || bare
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback())
}

fn host_is_allowed(host: &str, allowed: &[String]) -> bool {
    if is_loopback_host(host) {
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
                "refusing request for host '{host}'; set {ALLOWED_HOSTS_ENV} to serve it through \
                 an authenticating proxy"
            ),
        )
            .into_response(),
        _ => next.run(request).await,
    }
}

pub fn router(manager: SessionManager) -> Router {
    api_router(manager)
        .merge(embedded_frontend_router())
        .layer(response_compression_layer())
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

fn api_router(manager: SessionManager) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/store", get(store_info))
        .route("/fs/browse", get(browse_filesystem_handler))
        .route("/ssh/browse", post(browse_ssh_handler))
        .route("/providers/models", post(provider_models_handler))
        .route(
            "/model-configs",
            get(list_model_configs_handler).post(create_model_config_handler),
        )
        .route(
            "/model-configs/from-file",
            post(model_config_from_file_handler),
        )
        .route(
            "/model-configs/{config_id}",
            patch(update_model_config_handler).delete(delete_model_config_handler),
        )
        .route(
            "/model-configs/{config_id}/models",
            post(saved_model_config_models_handler),
        )
        .route(
            "/ssh-configs",
            get(list_ssh_configs_handler).post(create_ssh_config_handler),
        )
        .route(
            "/ssh-configs/{config_id}",
            patch(update_ssh_config_handler).delete(delete_ssh_config_handler),
        )
        .route("/auth", get(managed_auth::list_handler))
        .route("/auth/{provider}", delete(managed_auth::logout_handler))
        .route(
            "/auth/{provider}/login",
            post(managed_auth::start_login_handler),
        )
        .route(
            "/auth/{provider}/login/{login_id}",
            get(managed_auth::poll_login_handler).delete(managed_auth::cancel_login_handler),
        )
        .route(
            "/credentials",
            get(list_credentials_handler).post(store_generated_credential_handler),
        )
        .route(
            "/credentials/{name}",
            put(store_credential_handler).delete(delete_credential_handler),
        )
        .route(
            "/sessions/launch-defaults",
            post(launch_model_defaults_handler),
        )
        .route("/models", get(models_handler))
        .route("/sessions", get(list_sessions).post(create_session))
        .route("/sessions/order", put(reorder_sessions_handler))
        .route(
            "/sessions/{session_id}/presentation",
            put(update_session_presentation_handler),
        )
        .route("/sessions/{session_id}/messages", get(session_messages))
        .route(
            "/sessions/{session_id}/threads/{thread_name}/events",
            get(thread_events),
        )
        .route("/sessions/{session_id}/workspace/diff", get(workspace_diff))
        .route(
            "/sessions/{session_id}/workspace/files",
            get(workspace_files),
        )
        .route("/sessions/{session_id}/workspace/file", get(workspace_file))
        .route(
            "/sessions/{session_id}/workspace/branches",
            get(workspace_branches).post(switch_workspace_branch),
        )
        .route(
            "/sessions/{session_id}/workspace/commit",
            post(commit_workspace),
        )
        .route(
            "/sessions/{session_id}/workspace/revisions",
            get(workspace_revisions),
        )
        .route(
            "/sessions/{session_id}/workspace/revisions/{revision_id}/changes",
            get(workspace_revision_changes),
        )
        .route(
            "/sessions/{session_id}",
            get(session_snapshot).delete(delete_session_handler),
        )
        .route(
            "/sessions/{session_id}/config",
            get(session_config_handler).patch(update_config_handler),
        )
        .route("/sessions/{session_id}/runs", post(submit_prompt))
        .route("/sessions/{session_id}/compact", post(compaction::handler))
        .route("/sessions/{session_id}/revert", post(revert::handler))
        .route(
            "/sessions/{session_id}/regenerate",
            post(revert::regenerate_handler),
        )
        .route(
            "/sessions/{session_id}/steering",
            post(queue_orchestrator_steering_handler),
        )
        .route(
            "/sessions/{session_id}/threads/{thread_name}/steering",
            post(queue_thread_steering_handler),
        )
        .route("/sessions/{session_id}/events", get(recent_events))
        .route("/sessions/{session_id}/events/stream", get(stream_events))
        .route(
            "/sessions/{session_id}/cancel-active-run",
            post(cancel_active_run),
        )
        .with_state(manager)
}

pub async fn serve(addr: SocketAddr, manager: SessionManager) -> Result<()> {
    validate_bind_address(addr)?;
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

async fn store_info(State(manager): State<SessionManager>) -> Json<StoreInfo> {
    Json(manager.store_info())
}

/// The picker starts wherever the caller last was; with no path yet it opens on
/// the server root the session would default to anyway.
async fn browse_filesystem_handler(
    State(manager): State<SessionManager>,
    Query(query): Query<filesystem::BrowseQuery>,
) -> std::result::Result<Json<filesystem::BrowseListing>, ApiError> {
    let listing = filesystem::browse(&query, &manager.inner.root_cwd)?;
    Ok(Json(listing))
}

/// The same listing for a directory on an SSH host, which is also how the launch
/// form tests the connection before it offers the rest of the form.
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
    if let Some(name) = credential_name.as_deref() {
        store_api_key(name, api_key)?;
    }

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
    };
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
    let (api_key_env, superseded) = if !expects_key {
        (None, existing.api_key_env.clone())
    } else if let Some(key) = supplied_key.filter(|key| !key.is_empty()) {
        let name = format!(
            "{GENERATED_CREDENTIAL_PREFIX}{}",
            uuid::Uuid::new_v4().simple()
        );
        store_api_key(&name, &key)?;
        (Some(name), existing.api_key_env.clone())
    } else if matches!(request.api_key, RequestField::Null) || existing.api_key_env.is_none() {
        return Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: format!("backend '{backend}' requires an API key"),
        });
    } else {
        (existing.api_key_env.clone(), None)
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
    };

    match model_configurations::update_model_configuration(
        &manager.inner.store_path,
        &config_id,
        configuration,
    ) {
        Ok(record) => {
            if let Some(name) = superseded
                .as_deref()
                .filter(|name| name.starts_with(GENERATED_CREDENTIAL_PREFIX))
            {
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

async fn delete_model_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(config_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    let record =
        model_configurations::load_model_configuration(&manager.inner.store_path, &config_id)?;
    model_configurations::delete_model_configuration(&manager.inner.store_path, &config_id)?;

    // Only a key this server filed away is ours to drop; a hand-configured
    // environment variable name belongs to the operator.
    if let Some(name) = record
        .api_key_env
        .as_deref()
        .filter(|name| name.starts_with(GENERATED_CREDENTIAL_PREFIX))
    {
        let _ = remove_api_key(name);
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn list_ssh_configs_handler(
    State(manager): State<SessionManager>,
) -> std::result::Result<Json<SshConfigurationList>, ApiError> {
    let configurations = ssh_configurations::list_ssh_configurations(&manager.inner.store_path)?;
    Ok(Json(SshConfigurationList { configurations }))
}

/// Save a named SSH connection under a reusable setup.
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
async fn models_handler() -> Json<ModelListing> {
    Json(nac_core::model::api_listing())
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
    Ok(Json(SessionSnapshotResponse {
        snapshot: loaded.snapshot,
        message_page: loaded.message_page.map(Into::into),
        message_cycle: loaded.message_cycle.map(Into::into),
    }))
}

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

async fn workspace_diff(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceDiffQuery>,
) -> std::result::Result<Json<view::WorkspaceFileDiff>, ApiError> {
    Ok(Json(manager.workspace_file_diff(&session_id, query).await?))
}

async fn workspace_files(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<WorkspaceRevisionQuery>,
) -> std::result::Result<Json<view::WorkspaceFileList>, ApiError> {
    Ok(Json(
        manager.workspace_files(&session_id, query.revision).await?,
    ))
}

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

async fn workspace_revisions(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<view::WorkspaceRevisionRecord>>, ApiError> {
    Ok(Json(manager.workspace_revisions(&session_id)?))
}

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

async fn workspace_branches(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<workspace::BranchList>, ApiError> {
    Ok(Json(manager.workspace_branches(&session_id).await?))
}

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

async fn commit_workspace(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CommitWorkspaceRequest>, JsonRejection>,
) -> std::result::Result<Json<workspace::CommitOutcome>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(manager.commit_workspace(&session_id, request).await?))
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
            query.after_sequence_id,
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
) -> std::result::Result<Json<sessions::RawSessionConfig>, ApiError> {
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

fn managed_config_needs_repair(config: &sessions::RawSessionConfig) -> bool {
    let Some(backend) = config
        .backend
        .as_deref()
        .and_then(|raw| raw.trim().parse::<BackendKind>().ok())
    else {
        return false;
    };
    managed_backend_base_url(backend).is_some()
        && (config.base_url.trim().is_empty() || config.api_key_env.is_some())
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
        FrontendCommand::Compact => "compact",
    }
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
                StreamItem::Session(Err(tokio::sync::broadcast::error::RecvError::Lagged(count))) => {
                    let payload = serde_json::json!({ "missed": count });
                    yield Ok(sse_json_event("lagged", None, &payload));
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
            ModelConfigurationStoreError::DuplicateName(_) => StatusCode::CONFLICT,
            ModelConfigurationStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            ModelConfigurationStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
            || message.contains("unknown host")
        {
            StatusCode::NOT_FOUND
        } else if message.contains("busy")
            || message.contains("uncommitted changes")
            || message.contains("no active run")
            || message.contains("not active")
            || message.contains("active run is finishing")
        {
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
    use std::io::Read;

    use axum::{
        body::{to_bytes, Body, Bytes},
        http::Request,
    };
    use flate2::read::GzDecoder;
    use tower::ServiceExt;

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
            assert!(is_loopback_host(host), "{host} should be loopback");
        }
        for host in [
            "example.com",
            "127.0.0.1.example.com",
            "[::1",
            "",
            "10.0.0.1",
        ] {
            assert!(!is_loopback_host(host), "{host} should not be loopback");
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

    #[test]
    fn bind_address_must_be_ipv4_or_ipv6_loopback() {
        for address in ["127.0.0.1:0", "[::1]:0"] {
            validate_bind_address(address.parse().unwrap()).unwrap();
        }
        for address in ["0.0.0.0:3210", "[::]:3210", "192.168.1.10:3210"] {
            assert!(validate_bind_address(address.parse().unwrap()).is_err());
        }
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
            orchestrator_compaction_threshold: RequestField::Omitted,
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
        let _env = ScopedModelEnv::isolated(&nac_home, None);
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
                    orchestrator_compaction_threshold: RequestField::Omitted,
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
        assert_eq!(stored.backend, BackendKind::OpenAiResponses);
        assert_eq!(stored.model, "gpt-5.2");
        assert_eq!(stored.base_url, "https://api.openai.com/v1");
        assert_eq!(stored.reasoning_effort, Some(ReasoningEffort::Medium));
        assert_eq!(stored.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(stored.orchestrator_compaction_threshold, Some(64_000));
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
        assert_eq!(config.orchestrator_compaction_threshold, Some(64_000));
        assert!(manager
            .snapshot(&inherited_id)
            .await
            .unwrap()
            .metadata
            .extra_headers
            .is_empty());

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
    async fn arcee_auth_rejects_non_thinking_model_on_create_and_update() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("arcee_auth_model_contract");
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        std::fs::write(
            nac_home.join("config.toml"),
            "[model]\nmodel = \"gpt-5.2\"\n",
        )
        .unwrap();
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, Some("server-test-key"));
        let manager = test_manager(&root);
        let store_path = root.join("store.db");

        let create_error = manager
            .create_session(CreateSessionRequest {
                backend: RequestField::Value("arcee-auth".to_string()),
                model: RequestField::Value("trinity-mini".to_string()),
                ..CreateSessionRequest::default()
            })
            .await
            .expect_err("create must enforce the managed Arcee model contract");
        assert!(
            create_error.to_string().contains("trinity-large-thinking"),
            "{create_error:#}"
        );
        assert!(!store_path.exists(), "invalid create must not persist");

        let created = manager
            .create_session(CreateSessionRequest::default())
            .await
            .expect("configured API-key provider should create");
        let session_id = created.metadata.session_id.unwrap();
        let before = sessions::load_session(&store_path, &session_id).unwrap();
        let update_error = manager
            .update_session_config(
                &session_id,
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-auth".to_string()),
                    model: RequestField::Value("trinity-mini".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
            .expect_err("update must enforce the managed Arcee model contract");
        assert!(
            update_error.to_string().contains("trinity-large-thinking"),
            "{update_error:#}"
        );
        let after = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(after.backend, before.backend);
        assert_eq!(after.model, before.model);
        let _ = std::fs::remove_dir_all(root);
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
    async fn patch_repairs_absent_managed_bases_with_the_same_materialized_urls() {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = temp_root("managed_base_patch_repair");
        let nac_home = root.join("nac-home");
        write_codex_auth(&nac_home);
        write_arcee_auth(&nac_home, "https://api.arcee.ai");
        let _env = ScopedModelEnv::isolated(&nac_home, None);
        let store_path = root.join("store.db");
        let manager = test_manager(&root);

        for (session_id, backend, expected_base) in [
            (
                "repair-codex",
                BackendKind::ChatGptCodexResponses,
                nac_core::model::CHATGPT_CODEX_CANONICAL_BASE_URL,
            ),
            (
                "repair-arcee",
                BackendKind::ArceeAuth,
                nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL,
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
            sessions::update_session_config(&store_path, &incomplete).unwrap();

            manager
                .update_session_config(session_id, UpdateConfigRequest::default())
                .await
                .expect("empty repair PATCH should materialize the managed tuple");
            let repaired = sessions::load_session(&store_path, session_id).unwrap();
            assert_eq!(repaired.base_url, expected_base);
            assert_eq!(repaired.api_key_env, None);
            let rehydrated = manager.session_config(session_id).unwrap();
            assert_eq!(rehydrated.base_url, expected_base);
            assert_eq!(rehydrated.api_key_env, None);
            let resumed = manager.snapshot(session_id).await.unwrap();
            assert_eq!(resumed.metadata.base_url, expected_base);
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
        sessions::update_session_config(&store_path, &api_key_session).unwrap();
        let manager = test_manager(&root);

        manager
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    backend: RequestField::Value("arcee-auth".to_string()),
                    model: RequestField::Value("trinity-large-thinking".to_string()),
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
        let rehydrated = manager.session_config("session").unwrap();
        assert_eq!(rehydrated.backend.as_deref(), Some("arcee-auth"));
        assert_eq!(
            rehydrated.base_url,
            nac_core::model::ARCEE_AUTH_CANONICAL_BASE_URL
        );
        assert_eq!(rehydrated.api_key_env, None);

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
                orchestrator_compaction_threshold: RequestField::Omitted,
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
                orchestrator_compaction_threshold: RequestField::Omitted,
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
