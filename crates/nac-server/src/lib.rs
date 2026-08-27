mod application;
mod compaction;
mod delegation_runtime;
mod delivery;
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
pub use delivery::contracts::{
    ApiErrorBody, CancelInboxItemRequest, ClearGoalRequest, CreateGoalRequest,
    CreateInboxItemRequest, CreateSessionRequest, EventsQuery, HeadersRequest, HealthResponse,
    InboxItemResponse, LaggedEvent, LaunchModelDefaults, LaunchModelDefaultsRequest,
    ManagedSessionSummary, MessageCycleMetadata, MessagePageMetadata, MessagesPageResponse,
    MessagesQuery, OrchestratorSteeringRequest, OrchestratorSteeringResponse,
    PermissionStateResponse, ProviderModelList, ProviderModelsRequest, RecentEventsResponse,
    ReplayBoundaryEvent, ReplayGapEvent, ReplyPermissionRequest, RequestField, SandboxRequest,
    SessionLineageKind, SessionLineageSnapshot, SessionSnapshotQuery, SessionSnapshotResponse,
    SshBrowseRequest, StoreInfo, SubmitPromptRequest, SubmitPromptResponse, ThreadEventsQuery,
    ThreadSteeringRequest, ThreadSteeringResponse, UpdateConfigRequest, UpdateGoalRequest,
    UpdateInboxItemRequest,
};
pub use delivery::credentials::{
    GeneratedCredential, StoreCredentialRequest, StoredCredentialList, StoredCredentialSummary,
};
pub use delivery::delegation::{StartManagedOrchestratorRequest, StartTraditionalChildRequest};
pub use delivery::error::ApiError;
pub use delivery::managed_secrets::{
    ManagedSecretList, ManagedSecretSummary, PutManagedSecretRequest,
};
pub use delivery::model_configurations::{
    CreateModelConfigurationRequest, ModelConfigFromFileRequest, ModelConfigurationList,
    ResolvedModelConfiguration, UpdateModelConfigurationRequest,
};
pub use delivery::projects::{
    AssignSessionRequest, CreateProjectRequest, DeleteProjectQuery, DeleteProjectResponse,
    DeleteProjectSessions, ProjectList, ReorderProjectsRequest, ReorderProjectsResponse,
    UpdateProjectRequest,
};
pub use delivery::server::{
    openapi_document, router, serve, serve_with, serve_with_policy, BindPolicy,
};
pub use delivery::sessions::{
    ListSessionsQuery, ReorderSessionsRequest, ReorderSessionsResponse,
    UpdateSessionPresentationRequest,
};
pub use delivery::ssh_configurations::{
    CreateSshConfigurationRequest, SshConfigurationList, UpdateSshConfigurationRequest,
};
pub use delivery::workspace::{
    CommitWorkspaceRequest, OpenWorkspacePathRequest, SwitchBranchRequest, WorkspaceDiffQuery,
    WorkspaceFileQuery, WorkspaceRevisionQuery,
};
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
    collections::HashMap,
    future::{Future, IntoFuture},
    net::SocketAddr,
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex, Weak},
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context, Result};
#[cfg(test)]
use axum::response::sse::{Event, Sse};
use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use delivery::contracts::request_field_patch;
use include_dir::{include_dir, Dir};
#[cfg(test)]
use nac_core::projects;
#[cfg(test)]
use nac_core::store::{TraditionalChildExecutionMode, TraditionalChildRecord};
#[cfg(test)]
use nac_core::test_support::store::TranscriptLogWriter;
use nac_core::{
    commands::{slash_command_definitions, SlashCommand, SlashCommandDefinition},
    events::{
        AssistantStreamDelta, AssistantStreamDeltaReceiver, SessionEvent, SessionEventBoundary,
        SessionEventEnvelope, SessionReplayGap,
    },
    model::{
        list_managed_provider_models, list_provider_models, provider_default_base_url,
        resolve_backend_api_key, ManagedAuthProvider, ModelListing,
    },
    permissions::PermissionReply,
    runtime::{self, NacConfig, StoreOptions},
    session_service::{
        FrontendSnapshotLoadOptions, MessagePageRequest, MessagesPageSnapshot,
        SessionEventReceiver, SessionFrontendSnapshot, SessionFrontendSnapshotLoad,
        SessionRunHandle, SessionService, ThreadEventPage,
    },
    sessions,
    store::{
        ManagedOrchestratorExecutionMode, ManagedOrchestratorRecord, ManagedOrchestratorStatus,
        SessionGoalRecord, SessionInboxRecord,
    },
    types::Message,
    view::{self, SessionSummarySnapshot},
    workspace::GitTarget,
};
use serde::Deserialize;
#[cfg(test)]
use std::convert::Infallible;
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

use application::request_validation::{
    create_compaction_threshold_override, enforce_trusted_base_url, model_options,
    nonblank_request_string, parse_prospective_model_config, request_configuration_error,
    request_configuration_error_from, sandbox_options, sandbox_requested,
    validate_steering_instruction, validated_compaction_threshold,
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
    pub managed_host: Option<nac_managed::ManagedHostConfig>,
}

#[derive(Clone)]
pub struct SessionManager {
    inner: Arc<SessionManagerInner>,
}

struct SessionManagerInner {
    root_cwd: PathBuf,
    store_path: PathBuf,
    worker_executable: PathBuf,
    managed_host: Option<nac_managed::ManagedHostConfig>,
    managed_clones: Option<nac_managed::ManagedCloneService>,
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

/// deleting one never removes a key the operator manages themselves.
const GENERATED_CREDENTIAL_PREFIX: &str = "NAC_CONFIG_";

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
                nac_managed::ManagedCloneService::new(
                    &managed.repository_root,
                    &managed.state_root,
                    &managed.home_root,
                    Arc::new(application::managed::StoreProjectRegistrar::new(
                        &store_path,
                    )),
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

    pub fn managed_host(&self) -> Option<&nac_managed::ManagedHostConfig> {
        self.inner.managed_host.as_ref()
    }

    fn attach_managed_command_environment(&self, run_config: &mut runtime::OrchestratorRunConfig) {
        let Some(managed) = self.inner.managed_host.as_ref() else {
            run_config.set_command_environment_provider(None);
            return;
        };
        run_config.set_command_environment_provider(Some(Arc::new(
            nac_managed::ManagedCommandEnvironmentProvider::new(
                Some(managed.secret_store()),
                Some(
                    managed
                        .github_auth()
                        .expect("validated managed GitHub configuration"),
                ),
                Some(managed.home_root.clone()),
            ),
        )));
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

    pub(crate) fn model_configurations(
        &self,
    ) -> application::model_configurations::ModelConfigurationApplication<'_> {
        application::model_configurations::ModelConfigurationApplication::new(self)
    }

    pub(crate) fn ssh_configurations(
        &self,
    ) -> application::ssh_configurations::SshConfigurationApplication<'_> {
        application::ssh_configurations::SshConfigurationApplication::new(&self.inner.store_path)
    }

    pub(crate) fn workspace(&self) -> application::workspace::WorkspaceApplication<'_> {
        application::workspace::WorkspaceApplication::new(self)
    }

    pub(crate) fn delegation(&self) -> application::delegation::DelegationApplication<'_> {
        application::delegation::DelegationApplication::new(self)
    }

    pub(crate) fn session_catalog(&self) -> application::sessions::SessionCatalogApplication<'_> {
        application::sessions::SessionCatalogApplication::new(self)
    }

    pub(crate) fn session_state(&self) -> application::sessions::SessionStateApplication<'_> {
        application::sessions::SessionStateApplication::new(self)
    }

    pub(crate) fn session_intents(&self) -> application::sessions::SessionIntentApplication<'_> {
        application::sessions::SessionIntentApplication::new(self)
    }

    pub(crate) fn session_runs(&self) -> application::session_runs::SessionRunApplication<'_> {
        application::session_runs::SessionRunApplication::new(self)
    }

    pub(crate) fn session_lifecycle(
        &self,
    ) -> application::session_lifecycle::SessionLifecycleApplication<'_> {
        application::session_lifecycle::SessionLifecycleApplication::new(self)
    }

    pub(crate) fn session_configuration(
        &self,
    ) -> application::session_configuration::SessionConfigurationApplication<'_> {
        application::session_configuration::SessionConfigurationApplication::new(self)
    }

    pub(crate) fn session_attachment(
        &self,
    ) -> application::session_attachment::SessionAttachmentApplication<'_> {
        application::session_attachment::SessionAttachmentApplication::new(self)
    }

    pub(crate) fn session_creation(
        &self,
    ) -> application::session_creation::SessionCreationApplication<'_> {
        application::session_creation::SessionCreationApplication::new(self)
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
        request: CreateSessionRequest,
    ) -> Result<SessionFrontendSnapshot> {
        self.session_creation()
            .create_session(request.into_application())
            .await
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

    pub(crate) async fn attach_session(&self, session_id: &str) -> Result<Arc<SessionService>> {
        self.session_attachment().attach_session(session_id).await
    }

    async fn wake_direct_inbox(&self, service: &SessionService) -> Result<()> {
        self.session_attachment().wake_direct_inbox(service).await
    }

    fn repair_orphaned_completion_suppressions(&self, parent_session_id: &str) -> Result<()> {
        self.session_attachment()
            .repair_orphaned_completion_suppressions(parent_session_id)
    }

    async fn attach_session_locked(
        &self,
        session_id: &str,
        operation_lease: Option<&sessions::SessionOperationLease>,
    ) -> Result<Arc<SessionService>> {
        self.session_attachment()
            .attach_session_locked(session_id, operation_lease)
            .await
    }

    async fn attach_current_operation_service_locked(
        &self,
        session_id: &str,
        operation_lease: &sessions::SessionOperationLease,
    ) -> Result<Arc<SessionService>> {
        self.session_attachment()
            .attach_current_operation_service_locked(session_id, operation_lease)
            .await
    }

    async fn resume_session(
        &self,
        session_id: &str,
        operation_lease: Option<&sessions::SessionOperationLease>,
    ) -> Result<SessionService> {
        self.session_attachment()
            .resume_session(session_id, operation_lease)
            .await
    }

    async fn resume_session_attachment(
        &self,
        session_id: &str,
    ) -> Result<(
        SessionService,
        bool,
        Option<sessions::SessionOperationLease>,
    )> {
        self.session_attachment()
            .resume_session_attachment(session_id)
            .await
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
        self.session_state().config(session_id)
    }

    pub async fn snapshot(&self, session_id: &str) -> Result<SessionFrontendSnapshot> {
        self.session_state().snapshot(session_id).await
    }

    pub async fn snapshot_with_options(
        &self,
        session_id: &str,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<SessionFrontendSnapshotLoad> {
        self.session_state()
            .snapshot_with_options(session_id, options)
            .await
    }

    pub fn session_lineage(&self, session_id: &str) -> Result<Option<SessionLineageSnapshot>> {
        self.session_state().lineage(session_id)
    }

    pub async fn messages_page(
        &self,
        session_id: &str,
        request: MessagePageRequest,
    ) -> Result<MessagesPageSnapshot> {
        self.session_state()
            .messages_page(session_id, request)
            .await
    }

    pub async fn list_direct_inbox(&self, session_id: &str) -> Result<Vec<SessionInboxRecord>> {
        self.session_state().direct_inbox(session_id).await
    }

    pub async fn create_direct_inbox_item(
        &self,
        session_id: &str,
        request: CreateInboxItemRequest,
    ) -> Result<SessionInboxRecord> {
        self.session_intents()
            .create_inbox_item(
                session_id,
                application::sessions::CreateInboxItem {
                    delivery: request.delivery,
                    prompt: request.prompt,
                },
            )
            .await
    }

    pub async fn update_direct_inbox_item(
        &self,
        session_id: &str,
        item_id: i64,
        request: UpdateInboxItemRequest,
    ) -> Result<SessionInboxRecord> {
        self.session_intents()
            .update_inbox_item(
                session_id,
                item_id,
                application::sessions::UpdateInboxItem {
                    expected_version: request.expected_version,
                    delivery: request.delivery,
                },
            )
            .await
    }

    pub async fn cancel_direct_inbox_item(
        &self,
        session_id: &str,
        item_id: i64,
        request: CancelInboxItemRequest,
    ) -> Result<SessionInboxRecord> {
        self.session_intents()
            .cancel_inbox_item(session_id, item_id, request.expected_version)
            .await
    }

    pub async fn permission_state(&self, session_id: &str) -> Result<PermissionStateResponse> {
        let state = self.session_state().permission_state(session_id).await?;
        Ok(PermissionStateResponse {
            requests: state.requests,
            grants: state.grants,
        })
    }

    pub async fn direct_goal(&self, session_id: &str) -> Result<Option<SessionGoalRecord>> {
        self.session_state().direct_goal(session_id).await
    }

    pub async fn create_direct_goal(
        &self,
        session_id: &str,
        request: CreateGoalRequest,
    ) -> Result<SessionGoalRecord> {
        self.session_intents()
            .create_goal(
                session_id,
                application::sessions::CreateGoal {
                    objective: request.objective,
                    token_budget: request.token_budget,
                },
            )
            .await
    }

    pub async fn update_direct_goal(
        &self,
        session_id: &str,
        goal_id: &str,
        request: UpdateGoalRequest,
    ) -> Result<SessionGoalRecord> {
        self.session_intents()
            .update_goal(
                session_id,
                goal_id,
                application::sessions::UpdateGoal {
                    expected_version: request.expected_version,
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
        self.session_intents()
            .clear_goal(session_id, goal_id, expected_version)
            .await
    }

    pub async fn reply_permission_request(
        &self,
        session_id: &str,
        request_id: &str,
        reply: PermissionReply,
    ) -> Result<()> {
        self.session_intents()
            .reply_permission_request(session_id, request_id, reply)
            .await
    }

    pub async fn delete_permission_grant(&self, session_id: &str, grant_id: &str) -> Result<()> {
        self.session_intents()
            .delete_permission_grant(session_id, grant_id)
            .await
    }

    pub async fn thread_events(
        &self,
        session_id: &str,
        thread_name: &str,
        before_id: Option<i64>,
        limit: usize,
    ) -> Result<ThreadEventPage> {
        self.session_state()
            .thread_events(session_id, thread_name, before_id, limit)
            .await
    }

    pub async fn session_skills(
        &self,
        session_id: &str,
    ) -> Result<Vec<nac_core::skill_catalog::SkillCatalogEntry>> {
        self.session_state().skills(session_id).await
    }

    pub async fn submit_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
    ) -> Result<SubmitPromptResponse> {
        let submitted = self
            .session_runs()
            .submit(session_id, request.prompt)
            .await?;
        Ok(SubmitPromptResponse {
            run_id: submitted.run_id,
            client_id: submitted.client_id,
            display_prompt: submitted.display_prompt,
        })
    }

    async fn submit_managed_orchestrator_prompt(
        &self,
        session_id: &str,
        request: SubmitPromptRequest,
        execution_mode: ManagedOrchestratorExecutionMode,
    ) -> Result<SubmitPromptResponse> {
        let submitted = self
            .session_runs()
            .submit_managed_orchestrator(session_id, request.prompt, execution_mode)
            .await?;
        Ok(SubmitPromptResponse {
            run_id: submitted.run_id,
            client_id: submitted.client_id,
            display_prompt: submitted.display_prompt,
        })
    }

    pub async fn queue_thread_steering(
        &self,
        session_id: &str,
        thread_name: &str,
        request: ThreadSteeringRequest,
    ) -> Result<ThreadSteeringResponse> {
        let steering = self
            .session_runs()
            .queue_thread_steering(session_id, thread_name, request.instruction)
            .await?;
        Ok(ThreadSteeringResponse {
            steering_id: steering.steering_id,
            thread_name: steering.thread_name,
            status: steering.status,
            instruction_preview: steering.instruction_preview,
        })
    }

    async fn queue_thread_steering_unchecked(
        &self,
        session_id: &str,
        thread_name: &str,
        request: ThreadSteeringRequest,
        expected_run_id: Option<&str>,
    ) -> Result<ThreadSteeringResponse> {
        let steering = self
            .session_runs()
            .queue_thread_steering_for_run(
                session_id,
                thread_name,
                request.instruction,
                expected_run_id,
            )
            .await?;
        Ok(ThreadSteeringResponse {
            steering_id: steering.steering_id,
            thread_name: steering.thread_name,
            status: steering.status,
            instruction_preview: steering.instruction_preview,
        })
    }

    pub async fn queue_orchestrator_steering(
        &self,
        session_id: &str,
        request: OrchestratorSteeringRequest,
    ) -> Result<OrchestratorSteeringResponse> {
        let steering = self
            .session_runs()
            .queue_orchestrator_steering(session_id, request.instruction)
            .await?;
        Ok(OrchestratorSteeringResponse {
            steering_id: steering.steering_id,
            status: steering.status,
            instruction_preview: steering.instruction_preview,
        })
    }

    fn queue_managed_orchestrator_steering(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
        instruction: &str,
    ) -> Result<OrchestratorSteeringResponse> {
        let steering = self.session_runs().queue_managed_orchestrator_steering(
            parent_session_id,
            orchestrator_session_id,
            instruction,
        )?;
        Ok(OrchestratorSteeringResponse {
            steering_id: steering.steering_id,
            status: steering.status,
            instruction_preview: steering.instruction_preview,
        })
    }

    pub async fn recent_events(
        &self,
        session_id: &str,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<(SessionEventBoundary, Vec<SessionEventEnvelope>)> {
        self.session_runs()
            .recent_events(session_id, cursor, limit)
            .await
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
        self.session_runs()
            .subscribe_events(session_id, cursor, limit)
            .await
    }

    pub async fn cancel_active_run(&self, session_id: &str) -> Result<()> {
        self.session_runs().cancel(session_id).await
    }

    async fn cancel_active_run_unchecked(&self, session_id: &str) -> Result<()> {
        self.session_runs().cancel_unchecked(session_id).await
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
        self.session_lifecycle().delete(session_id).await
    }

    pub async fn update_session_config(
        &self,
        session_id: &str,
        request: UpdateConfigRequest,
    ) -> Result<()> {
        self.session_configuration()
            .update_session_config(session_id, request.into_application())
            .await
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

#[cfg(test)]
#[path = "lib_tests.rs"]
mod tests;
