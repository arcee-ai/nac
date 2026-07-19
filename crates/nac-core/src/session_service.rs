use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, Mutex},
    task::JoinHandle,
};

use crate::agent::Agent;
use crate::commands::{self, PreparedPrompt, PreparedUserInput};
use crate::events::{AgentEvent, EventSink, SessionEvent, SessionEventBus};
pub use crate::events::{
    SessionClientId, SessionEventEnvelope, SessionEventReceiver, SessionEventReplaySubscription,
    SessionEventSubscription, SessionRunId, SessionSubscriptionId, SubmittedUserMessageSnapshot,
};
pub use crate::store::SessionOverviewRecord;
use crate::runtime::{OrchestratorRunConfig, OrchestratorSession};
use crate::sessions::{self, SessionSnapshot};
use crate::types::Message;
use crate::view::{
    self, EpisodeSnapshot, SessionSummarySnapshot, ThreadSnapshot, WorksetSnapshot,
    WorksetSummarySnapshot, WorksetsSnapshot, WorkspaceSnapshot,
};

pub type AgentEventReceiver = mpsc::UnboundedReceiver<AgentEvent>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionMetadata {
    pub cwd: String,
    pub workspace_host_path: Option<PathBuf>,
    pub store_path: PathBuf,
    pub model: String,
    pub backend: String,
    pub session_id: Option<String>,
    pub sandbox_status: String,
    pub agents_md_status: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extra_headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResponseTimingSnapshot {
    pub last_response_duration_ms: Option<u64>,
    pub previous_response_duration_ms: Option<u64>,
    pub response_durations_ms: Option<Vec<Option<u64>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_usages: Option<Vec<Option<crate::model::TokenUsage>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_token_usage: Option<crate::model::TokenUsage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cumulative_token_usage: Option<crate::model::TokenUsage>,
}

impl ResponseTimingSnapshot {
    pub fn from_session_snapshot(snapshot: Option<&SessionSnapshot>) -> Self {
        snapshot.map(Self::from).unwrap_or_default()
    }
}

impl From<&SessionSnapshot> for ResponseTimingSnapshot {
    fn from(snapshot: &SessionSnapshot) -> Self {
        let last_token_usage = snapshot.token_usages.last().cloned().flatten();

        // Sum input/output/cache tokens across all non-None per-response
        // entries.  `orchestrator_context_tokens` is a context-window size,
        // not a cumulative metric, so it is set to the last non-None entry's
        // value rather than summed.
        let cumulative_token_usage = {
            let non_none: Vec<&crate::model::TokenUsage> = snapshot
                .token_usages
                .iter()
                .filter_map(|tu| tu.as_ref())
                .collect();
            if non_none.is_empty() {
                None
            } else {
                let mut cumulative = crate::model::TokenUsage::default();
                for u in &non_none {
                    cumulative += (*u).clone();
                }
                cumulative.orchestrator_context_tokens = non_none
                    .last()
                    .map(|u| u.orchestrator_context_tokens)
                    .unwrap_or(0);
                Some(cumulative)
            }
        };

        Self {
            last_response_duration_ms: snapshot.last_response_duration_ms,
            previous_response_duration_ms: snapshot.previous_response_duration_ms,
            response_durations_ms: snapshot.response_durations_ms.clone(),
            token_usages: Some(snapshot.token_usages.clone()),
            last_token_usage,
            cumulative_token_usage,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveRunSnapshot {
    pub run_id: SessionRunId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    pub prompt_preview: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_user_message: Option<SubmittedUserMessageSnapshot>,
    pub started_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionServiceInit {
    pub metadata: SessionMetadata,
    pub restored_messages: Vec<Message>,
    pub response_timing: ResponseTimingSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFrontendSnapshot {
    pub metadata: SessionMetadata,
    pub messages: Vec<Message>,
    pub response_timing: ResponseTimingSnapshot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_run: Option<ActiveRunSnapshot>,
    pub sessions: Vec<SessionSummarySnapshot>,
    #[serde(default)]
    pub active_threads: Vec<String>,
    pub threads: Vec<ThreadSnapshot>,
    pub thread_episodes: HashMap<String, Vec<EpisodeSnapshot>>,
    #[serde(default)]
    pub thread_events: HashMap<String, Vec<AgentEvent>>,
    #[serde(default)]
    pub thread_steering: Vec<crate::store::ThreadSteeringRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overview: Option<SessionOverviewRecord>,
    pub worksets: WorksetsSnapshot,
    pub workspace: WorkspaceSnapshot,
}

/// A visible-message cursor request. `before` is an index in the filtered
/// (rather than raw) transcript, matching the web API's existing cursor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MessagePageRequest {
    pub before: Option<usize>,
    pub limit: usize,
    pub include_system: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrontendSnapshotMessages {
    All,
    Page(MessagePageRequest),
}

/// Controls expensive, independently projectable portions of a frontend
/// snapshot. The default exactly preserves the historical snapshot contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrontendSnapshotLoadOptions {
    pub thread_event_limit: usize,
    pub include_sessions: bool,
    pub messages: FrontendSnapshotMessages,
}

impl Default for FrontendSnapshotLoadOptions {
    fn default() -> Self {
        Self {
            thread_event_limit: 512,
            include_sessions: true,
            messages: FrontendSnapshotMessages::All,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessagePageMetadata {
    pub start: usize,
    pub end: usize,
    pub total: usize,
    pub has_older: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MessageCycleMetadata {
    pub marker: String,
    pub thread_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessagesPageSnapshot {
    pub messages: Vec<Message>,
    pub page: MessagePageMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFrontendSnapshotLoad {
    #[serde(flatten)]
    pub snapshot: SessionFrontendSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_page: Option<MessagePageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_cycle: Option<MessageCycleMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThreadEventPageItem {
    pub id: i64,
    pub created_at: String,
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThreadEventPage {
    pub events: Vec<ThreadEventPageItem>,
    pub has_older: bool,
    pub next_before_id: Option<i64>,
}

pub struct SessionServiceParts {
    pub service: SessionService,
    pub init: SessionServiceInit,
    pub events: SessionEventReceiver,
}

pub struct SessionClientAttachment {
    pub client: SessionClientHandle,
    pub events: SessionEventSubscription,
    pub snapshot: SessionFrontendSnapshot,
}

pub struct SessionRunHandle {
    pub run_id: SessionRunId,
    pub client_id: Option<SessionClientId>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionSubmitError {
    Busy { active_run: ActiveRunSnapshot },
    ExternalBusy { session_id: String },
    Coordination { message: String },
}

impl std::fmt::Display for SessionSubmitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { active_run } => write!(
                formatter,
                "session is busy with run {} ({})",
                active_run.run_id, active_run.prompt_preview
            ),
            Self::ExternalBusy { session_id } => write!(
                formatter,
                "session '{session_id}' is busy with an active run in another process"
            ),
            Self::Coordination { message } => formatter.write_str(message),
        }
    }
}

impl std::error::Error for SessionSubmitError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionCancelError {
    NotActive { run_id: SessionRunId },
}

impl std::fmt::Display for SessionCancelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotActive { run_id } => write!(formatter, "run {run_id} is not active"),
        }
    }
}

impl std::error::Error for SessionCancelError {}

#[derive(Clone)]
pub struct SessionClientHandle {
    service: SessionService,
    client_id: SessionClientId,
}

impl SessionClientHandle {
    pub fn client_id(&self) -> &SessionClientId {
        &self.client_id
    }

    pub fn prepare_user_input(&self, input: &str) -> PreparedUserInput {
        self.service.prepare_user_input(input)
    }

    pub fn subscribe_events(&self) -> SessionEventSubscription {
        self.service
            .subscribe_events_for_client(self.client_id.clone())
    }

    pub fn subscribe_events_with_replay(
        &self,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.service.subscribe_events_for_client_with_replay(
            self.client_id.clone(),
            after_sequence_id,
            limit,
        )
    }

    pub async fn attach(&self) -> Result<SessionClientAttachment> {
        let events = self.subscribe_events();
        let snapshot = self.service.frontend_snapshot().await?;
        Ok(SessionClientAttachment {
            client: self.clone(),
            events,
            snapshot,
        })
    }

    pub async fn frontend_snapshot(&self) -> Result<SessionFrontendSnapshot> {
        self.service.frontend_snapshot().await
    }

    pub fn try_submit_prepared_prompt(
        &self,
        prompt: PreparedPrompt,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt(prompt.agent_prompt)
    }

    pub fn try_submit_prepared_prompt_with_lease(
        &self,
        prompt: PreparedPrompt,
        lease: sessions::SessionRunLease,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.service.try_submit_prompt_for_client_with_lease(
            self.client_id.clone(),
            prompt.agent_prompt,
            lease,
        )
    }

    pub fn try_submit_prompt(
        &self,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.service
            .try_submit_prompt_for_client(self.client_id.clone(), expanded_prompt)
    }

    pub async fn request_cancel(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        self.service.request_cancel(run_id).await
    }
}

#[derive(Clone)]
pub struct SessionService {
    agent: Arc<Mutex<Agent>>,
    overview_client: crate::model::ModelClient,
    overview_generation: Arc<Mutex<()>>,
    metadata: Arc<SessionMetadata>,
    config_version: Option<i64>,
    session_snapshot: Arc<Mutex<Option<SessionSnapshot>>>,
    event_bus: SessionEventBus,
    active_run: Arc<StdMutex<Option<ActiveRunState>>>,
    active_threads: Arc<Mutex<HashSet<String>>>,
}

struct ActiveRunState {
    snapshot: ActiveRunSnapshot,
    started_at: Instant,
    finishing: bool,
    task: Option<JoinHandle<()>>,
    _run_lease: Option<sessions::SessionRunLease>,
}

struct FinishingRun {
    snapshot: ActiveRunSnapshot,
    duration_ms: u64,
}

struct CancellingRun {
    snapshot: ActiveRunSnapshot,
    task: Option<JoinHandle<()>>,
}

enum RunOutcome {
    Completed(String, Option<crate::model::TokenUsage>),
    Failed(String, Option<crate::model::TokenUsage>),
}

impl SessionService {
    pub fn from_orchestrator_run_config(
        mut run_config: OrchestratorRunConfig,
    ) -> SessionServiceParts {
        let store_path = run_config.session.store_path();
        let session_id = run_config.session.session_id().map(str::to_string);
        let restored_messages = run_config.agent.messages.clone();
        let response_timing =
            ResponseTimingSnapshot::from_session_snapshot(match &run_config.session {
                OrchestratorSession::Active { snapshot, .. } => Some(snapshot),
                OrchestratorSession::Picker { .. } => None,
            });
        let config_version = match &run_config.session {
            OrchestratorSession::Active { snapshot, .. } => Some(snapshot.config_version),
            OrchestratorSession::Picker { .. } => None,
        };

        let event_bus = SessionEventBus::with_thread_event_store(
            session_id.clone(),
            store_path.clone(),
        );
        let events = event_bus.subscribe();
        run_config
            .agent
            .set_event_sink(EventSink::bus(event_bus.clone()));

        let metadata = SessionMetadata {
            cwd: run_config.workspace_display,
            workspace_host_path: run_config.workspace_host_path,
            store_path,
            model: run_config.client.model.clone(),
            backend: run_config.client.backend().as_str().to_string(),
            session_id,
            sandbox_status: run_config.sandbox_status,
            agents_md_status: run_config.agents_md_status,
            base_url: run_config.client.base_url().to_string(),
            reasoning_effort: run_config
                .client
                .reasoning_effort()
                .map(|effort| effort.as_str().to_string()),
            api_key_env: run_config.client.api_key_env().map(str::to_string),
            extra_headers: run_config.client.extra_headers().clone(),
        };
        let session_snapshot = run_config.session.into_snapshot();
        let active_threads = run_config.agent.active_threads_handle();
        let service = Self {
            agent: Arc::new(Mutex::new(run_config.agent)),
            overview_client: run_config.client,
            overview_generation: Arc::new(Mutex::new(())),
            metadata: Arc::new(metadata.clone()),
            config_version,
            session_snapshot: Arc::new(Mutex::new(session_snapshot)),
            event_bus,
            active_run: Arc::new(StdMutex::new(None)),
            active_threads,
        };
        let init = SessionServiceInit {
            metadata,
            restored_messages,
            response_timing,
        };

        SessionServiceParts {
            service,
            init,
            events,
        }
    }

    pub fn connect_client(&self) -> SessionClientHandle {
        SessionClientHandle {
            service: self.clone(),
            client_id: SessionClientId::new(),
        }
    }

    pub async fn attach_client(&self) -> Result<SessionClientAttachment> {
        self.connect_client().attach().await
    }

    pub fn subscribe_events(&self) -> SessionEventReceiver {
        self.event_bus.subscribe()
    }

    pub fn recent_events(
        &self,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> Vec<SessionEventEnvelope> {
        self.event_bus.recent_events(after_sequence_id, limit)
    }

    pub fn subscribe_events_for_client(
        &self,
        client_id: SessionClientId,
    ) -> SessionEventSubscription {
        self.event_bus.subscribe_for_client(client_id)
    }

    pub fn subscribe_events_for_client_with_replay(
        &self,
        client_id: SessionClientId,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.event_bus
            .subscribe_for_client_with_replay(client_id, after_sequence_id, limit)
    }

    pub fn subscribe_agent_events(&self) -> AgentEventReceiver {
        let mut events = self.subscribe_events();
        let (tx, rx) = mpsc::unbounded_channel();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                loop {
                    match events.recv().await {
                        Ok(envelope) => {
                            if let SessionEvent::Agent { event } = envelope.event {
                                if tx.send(event).is_err() {
                                    break;
                                }
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }
        rx
    }

    pub fn metadata(&self) -> SessionMetadata {
        (*self.metadata).clone()
    }

    pub fn active_run(&self) -> Option<ActiveRunSnapshot> {
        self.lock_active_run()
            .as_ref()
            .map(|active_run| active_run.snapshot.clone())
    }

    pub fn config_version(&self) -> Option<i64> {
        self.config_version
    }

    /// Explicitly destroy the sandbox (if any) associated with this session.
    /// Best-effort: errors are logged but not propagated.  This is used
    /// during session deletion to ensure the container/VM is torn down
    /// even if other `Arc` references (e.g. from SSE handlers) keep the
    /// `SessionService` alive.
    pub async fn destroy_sandbox(&self) {
        let sandbox = {
            let agent = self.agent.lock().await;
            agent.sandbox_session()
        };
        if let Some(sandbox) = sandbox {
            if let Err(error) = sandbox.destroy().await {
                eprintln!("nac: failed to destroy sandbox during deletion: {error:#}");
            }
        }
    }

    pub async fn active_thread_names(&self) -> Vec<String> {
        let mut names = self
            .active_threads
            .lock()
            .await
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    pub async fn queue_thread_steering(
        &self,
        thread_name: &str,
        instruction: &str,
    ) -> Result<crate::store::ThreadSteeringRecord> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        if self.active_run().is_none() {
            return Err(anyhow::anyhow!("session has no active run"));
        }
        if !self.active_threads.lock().await.contains(thread_name) {
            return Err(anyhow::anyhow!(
                "thread '{thread_name}' is not active in this session"
            ));
        }
        let record = crate::store::queue_thread_steering(
            &self.metadata.store_path,
            session_id,
            thread_name,
            instruction,
        )?;
        self.event_bus.emit_agent(AgentEvent::ThreadSteeringQueued {
            name: thread_name.to_string(),
            steering_id: record.id,
            instruction_preview: record.instruction.chars().take(160).collect(),
        });
        Ok(record)
    }

    pub fn queue_orchestrator_steering(
        &self,
        instruction: &str,
    ) -> Result<crate::store::ThreadSteeringRecord> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let active_run = self.lock_active_run();
        match active_run.as_ref() {
            Some(run) if !run.finishing => {}
            Some(_) => return Err(anyhow::anyhow!("session active run is finishing")),
            None => return Err(anyhow::anyhow!("session has no active run")),
        }
        let record = crate::store::queue_thread_steering(
            &self.metadata.store_path,
            session_id,
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            instruction,
        )?;
        drop(active_run);
        self.event_bus
            .emit_agent(AgentEvent::OrchestratorSteeringQueued {
                steering_id: record.id,
                instruction_preview: record.instruction.chars().take(160).collect(),
            });
        Ok(record)
    }

    pub fn prepare_user_input(&self, input: &str) -> PreparedUserInput {
        commands::prepare_user_input(input)
    }

    pub fn try_submit_prepared_prompt(
        &self,
        prompt: PreparedPrompt,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt(prompt.agent_prompt)
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionSummarySnapshot>> {
        view::list_sessions(&self.metadata.store_path)
    }

    pub fn list_threads(&self) -> Result<Vec<ThreadSnapshot>> {
        view::list_threads(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn thread_episodes(&self, thread_name: &str) -> Result<Vec<EpisodeSnapshot>> {
        view::load_thread_episodes(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
            thread_name,
        )
    }

    pub fn all_thread_episodes(&self) -> Result<HashMap<String, Vec<EpisodeSnapshot>>> {
        view::load_all_thread_episodes(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn all_thread_events(&self) -> Result<HashMap<String, Vec<AgentEvent>>> {
        self.all_thread_events_with_limit(512)
    }

    pub fn all_thread_events_with_limit(
        &self,
        per_thread_limit: usize,
    ) -> Result<HashMap<String, Vec<AgentEvent>>> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(HashMap::new());
        };
        crate::store::load_all_thread_events(
            &self.metadata.store_path,
            session_id,
            per_thread_limit,
        )?
            .into_iter()
            .map(|(thread_name, records)| {
                let events = records
                    .into_iter()
                    .map(|record| {
                        serde_json::from_str(&record.event_json).map_err(|error| {
                            anyhow::anyhow!(
                                "invalid persisted event {} for thread '{}': {error}",
                                record.id,
                                thread_name
                            )
                        })
                    })
                    .collect::<Result<Vec<_>>>()?;
                Ok((thread_name, events))
            })
            .collect()
    }

    pub fn thread_events_page(
        &self,
        thread_name: &str,
        before_id: Option<i64>,
        limit: usize,
    ) -> Result<ThreadEventPage> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let (records, has_older) = crate::store::load_thread_events_page(
            &self.metadata.store_path,
            session_id,
            thread_name,
            before_id,
            limit,
        )?;
        let events = records
            .into_iter()
            .map(|record| {
                let event = serde_json::from_str(&record.event_json).map_err(|error| {
                    anyhow::anyhow!(
                        "invalid persisted event {} for thread '{}': {error}",
                        record.id,
                        thread_name
                    )
                })?;
                Ok(ThreadEventPageItem {
                    id: record.id,
                    created_at: record.created_at,
                    event,
                })
            })
            .collect::<Result<Vec<_>>>()?;
        Ok(ThreadEventPage {
            next_before_id: events.last().map(|event| event.id),
            events,
            has_older,
        })
    }

    pub fn list_worksets(&self) -> Result<Vec<WorksetSummarySnapshot>> {
        view::list_worksets(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn read_workset(&self, workset_id: &str) -> Result<Option<WorksetSnapshot>> {
        view::read_workset(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
            workset_id,
        )
    }

    pub fn worksets_snapshot(&self) -> WorksetsSnapshot {
        view::worksets_snapshot(
            &self.metadata.store_path,
            self.metadata.session_id.as_deref(),
        )
    }

    pub fn workspace_snapshot(&self) -> WorkspaceSnapshot {
        view::workspace_snapshot(
            &self.metadata.cwd,
            self.metadata.workspace_host_path.as_deref(),
        )
    }

    pub async fn frontend_snapshot(&self) -> Result<SessionFrontendSnapshot> {
        Ok(self
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions::default())
            .await?
            .snapshot)
    }

    pub async fn frontend_snapshot_with_thread_event_limit(
        &self,
        thread_event_limit: usize,
    ) -> Result<SessionFrontendSnapshot> {
        Ok(self
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                thread_event_limit,
                ..FrontendSnapshotLoadOptions::default()
            })
            .await?
            .snapshot)
    }

    pub async fn frontend_snapshot_with_options(
        &self,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<SessionFrontendSnapshotLoad> {
        let (response_timing, loaded_messages) = {
            let snapshot = self.session_snapshot.lock().await;
            let response_timing = ResponseTimingSnapshot::from_session_snapshot(snapshot.as_ref());
            let persisted_messages = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            let loaded_messages = match self.agent.try_lock() {
                Ok(agent) => load_frontend_messages(&agent.messages, options.messages),
                Err(_) => load_frontend_messages(persisted_messages, options.messages),
            };
            (response_timing, loaded_messages)
        };

        let snapshot = SessionFrontendSnapshot {
            metadata: self.metadata(),
            messages: loaded_messages.messages,
            response_timing,
            active_run: self.active_run(),
            sessions: if options.include_sessions {
                self.list_sessions()?
            } else {
                Vec::new()
            },
            active_threads: self.active_thread_names().await,
            threads: self.list_threads()?,
            thread_episodes: self.all_thread_episodes()?,
            thread_events: self.all_thread_events_with_limit(options.thread_event_limit)?,
            thread_steering: self
                .metadata
                .session_id
                .as_deref()
                .map(|session_id| {
                    crate::store::list_thread_steering(&self.metadata.store_path, session_id)
                })
                .transpose()?
                .unwrap_or_default(),
            overview: self
                .metadata
                .session_id
                .as_deref()
                .map(|session_id| {
                    crate::store::read_session_overview(&self.metadata.store_path, session_id)
                })
                .transpose()?
                .flatten(),
            worksets: self.worksets_snapshot(),
            workspace: self.workspace_snapshot(),
        };
        Ok(SessionFrontendSnapshotLoad {
            snapshot,
            message_page: loaded_messages.page,
            message_cycle: loaded_messages.cycle,
        })
    }

    /// Returns the freshest orchestrator messages available without building
    /// the considerably larger frontend snapshot. The persisted copy remains
    /// a safe fallback while an active model turn owns the agent lock.
    pub async fn messages_snapshot(&self) -> Vec<Message> {
        let snapshot = self.session_snapshot.lock().await;
        let persisted_messages = snapshot
            .as_ref()
            .map(|snapshot| snapshot.messages.as_slice())
            .unwrap_or_default();
        match self.agent.try_lock() {
            Ok(agent) => agent.messages.clone(),
            Err(_) => persisted_messages.to_vec(),
        }
    }

    /// Pages the freshest available transcript without cloning messages outside
    /// the requested visible window. Callers remain responsible for any
    /// transport-specific maximum; a zero limit retains the web API's minimum
    /// page size of one.
    pub async fn messages_page(&self, request: MessagePageRequest) -> MessagesPageSnapshot {
        let snapshot = self.session_snapshot.lock().await;
        let persisted_messages = snapshot
            .as_ref()
            .map(|snapshot| snapshot.messages.as_slice())
            .unwrap_or_default();
        match self.agent.try_lock() {
            Ok(agent) => page_messages(&agent.messages, request),
            Err(_) => page_messages(persisted_messages, request),
        }
    }

    async fn overview_snapshot(&self) -> Result<SessionFrontendSnapshot> {
        Ok(self
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                thread_event_limit: 0,
                ..FrontendSnapshotLoadOptions::default()
            })
            .await?
            .snapshot)
    }

    pub async fn generate_overview(&self) -> Result<SessionOverviewRecord> {
        let _generation = self.overview_generation.lock().await;
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("session id is unavailable"))?;
        let snapshot = self.overview_snapshot().await?;
        let source_updated_at = snapshot
            .sessions
            .iter()
            .find(|session| session.session_id == session_id)
            .map(|session| session.updated_at.clone())
            .unwrap_or_default();
        let live_events = self.event_bus.recent_events(None, 1_024);
        let source = overview_source(&snapshot, &live_events);
        let response = self
            .overview_client
            .send_turn(
                vec![
                    Message::System {
                        content: OVERVIEW_SYSTEM_PROMPT.to_string(),
                    },
                    Message::User {
                        content: format!(
                            "Generate the session overview from this state snapshot:\n{}",
                            serde_json::to_string(&source)?
                        ),
                    },
                ],
                Vec::new(),
            )
            .await?;
        let content = response
            .assistant
            .content
            .ok_or_else(|| anyhow::anyhow!("overview model returned no content"))?;
        let payload = parse_generated_overview(&content)?;
        crate::store::write_session_overview(
            &self.metadata.store_path,
            session_id,
            &payload.summary,
            &self.overview_client.model,
            &source_updated_at,
        )
    }

    pub fn try_submit_prompt(
        &self,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(None, expanded_prompt, None)
    }

    pub fn try_submit_prompt_for_client(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(Some(client_id), expanded_prompt, None)
    }

    pub fn try_submit_prompt_for_client_with_lease(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
        lease: sessions::SessionRunLease,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(Some(client_id), expanded_prompt, Some(lease))
    }

    pub async fn request_cancel(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        let Some(cancelling_run) = self.mark_run_cancelling(run_id) else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };

        if let Some(task) = cancelling_run.task {
            task.abort();
            let _ = task.await;
        }

        self.expire_orchestrator_steering();

        // Clear stale active_threads — the aborted task could not run
        // unmark cleanup.  All child processes have been killed by
        // kill_on_drop, so no threads are actually running anymore.
        self.active_threads.lock().await.clear();

        // Capture partial token usage from the cancelled run.  Because
        // `send()` now updates `last_usage` mid-loop, this includes all
        // model-call usage accumulated before the cancel.
        let mut cancel_usage = self.append_cancellation_message().await;

        // Preserve the previous orchestrator_context_tokens — the cancel
        // path should not overwrite the context window size from the last
        // completed response.  Only input/output/cache token counts are
        // captured from the partial run.
        if let Some(ref mut u) = cancel_usage {
            let prev_ctx = {
                let snapshot = self.session_snapshot.lock().await;
                snapshot
                    .as_ref()
                    .and_then(|s| {
                        s.token_usages
                            .iter()
                            .rev()
                            .find_map(|tu| tu.as_ref().map(|tu| tu.orchestrator_context_tokens))
                    })
                    .unwrap_or(0)
            };
            u.orchestrator_context_tokens = prev_ctx;
        }

        let message = "run cancelled by user".to_string();
        let persistence_error = match self
            .persist_run_snapshot(&cancelling_run.snapshot, None, cancel_usage)
            .await
        {
            Ok(()) => None,
            Err(error) => {
                eprintln!(
                    "nac: failed to persist cancellation snapshot for run {}: {error:#}",
                    cancelling_run.snapshot.run_id
                );
                Some(format!("{error:#}"))
            }
        };

        let terminal_message = match persistence_error {
            Some(error) => {
                format!("{message}\nAdditionally, failed to persist session snapshot: {error}")
            }
            None => message,
        };
        self.event_bus.emit_with_context(
            SessionEvent::RunFailed {
                message: terminal_message,
            },
            Some(cancelling_run.snapshot.run_id.clone()),
            cancelling_run.snapshot.client_id.clone(),
        );
        self.clear_finished_run(&cancelling_run.snapshot.run_id);
        Ok(())
    }

    fn try_submit_prompt_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: String,
        run_lease: Option<sessions::SessionRunLease>,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        let active_run = self.try_begin_run_with_lease(client_id, &expanded_prompt, run_lease)?;
        let run_id = active_run.run_id.clone();
        let task_run_id = run_id.clone();
        let run_client_id = active_run.client_id.clone();
        let event_bus = self.event_bus.clone();
        let service = self.clone();
        let task = tokio::spawn(async move {
            let (result, usage) = {
                let mut agent = service.agent.lock().await;
                agent.set_event_sink(EventSink::bus_with_context(
                    event_bus.clone(),
                    Some(task_run_id.clone()),
                    run_client_id.clone(),
                ));
                let result = agent
                    .send(&expanded_prompt)
                    .await
                    .map_err(|error| error.to_string());
                agent.set_event_sink(EventSink::bus(event_bus));
                // Capture usage regardless of success or failure. On error
                // paths, `last_usage` is now set in `send()` before returning
                // Err, so worker thread tokens from prior tool rounds survive.
                let usage = agent.last_usage.clone();
                (result, usage)
            };
            match result {
                Ok(response) => {
                    service
                        .finish_run_once(&task_run_id, RunOutcome::Completed(response, usage))
                        .await;
                }
                Err(message) => {
                    service
                        .finish_run_once(&task_run_id, RunOutcome::Failed(message, usage))
                        .await;
                }
            }
        });
        self.set_run_task(&run_id, task);

        Ok(SessionRunHandle {
            run_id: active_run.run_id,
            client_id: active_run.client_id,
        })
    }

    #[cfg(test)]
    fn try_begin_run(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        self.try_begin_run_inner(client_id, expanded_prompt, None, false)
    }

    fn try_begin_run_with_lease(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionRunLease>,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        self.try_begin_run_inner(client_id, expanded_prompt, supplied_lease, true)
    }

    fn try_begin_run_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionRunLease>,
        enforce_coordination: bool,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        let mut guard = self.lock_active_run();
        if let Some(active_run) = guard.as_ref() {
            return Err(SessionSubmitError::Busy {
                active_run: active_run.snapshot.clone(),
            });
        }

        let run_lease = if enforce_coordination {
            match (supplied_lease, self.metadata.session_id.as_deref()) {
                (Some(lease), _) => Some(lease),
                (None, Some(session_id)) => Some(
                    sessions::SessionRunLease::try_acquire(&self.metadata.store_path, session_id)
                        .map_err(|error| match error {
                        sessions::SessionRunLeaseError::Busy(session_id) => {
                            SessionSubmitError::ExternalBusy { session_id }
                        }
                        sessions::SessionRunLeaseError::Store(error) => {
                            SessionSubmitError::Coordination {
                                message: format!("session run coordination failed: {error:#}"),
                            }
                        }
                    })?,
                ),
                // Picker services have no runnable persisted session. Keeping this
                // path lease-free supports read-only picker construction.
                (None, None) => None,
            }
        } else {
            None
        };

        if enforce_coordination {
            if let (Some(session_id), Some(service_version)) =
                (self.metadata.session_id.as_deref(), self.config_version)
            {
                let persisted_version =
                    sessions::load_session_model_config(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: format!(
                                "failed to verify session configuration revision: {error:#}"
                            ),
                        })?
                        .config_version;
                if persisted_version != service_version {
                    return Err(SessionSubmitError::Coordination {
                        message: format!(
                            "session '{session_id}' configuration changed externally; reload it before submitting"
                        ),
                    });
                }
            }
        }

        if enforce_coordination {
            if let Some(session_id) = self.metadata.session_id.as_deref() {
                crate::store::expire_thread_steering(
                    &self.metadata.store_path,
                    session_id,
                    crate::store::ORCHESTRATOR_STEERING_TARGET,
                )
                .map_err(|error| SessionSubmitError::Coordination {
                    message: format!("failed to clear stale orchestrator steering: {error:#}"),
                })?;
            }
        }

        let run_id = SessionRunId::new();
        let submitted_at_epoch_ms = now_epoch_ms();
        let submitted_user_message = SubmittedUserMessageSnapshot {
            run_id: run_id.clone(),
            client_id: client_id.clone(),
            content: expanded_prompt.to_string(),
            baseline_user_message_count: self.current_user_message_count(),
            submitted_at_epoch_ms,
        };
        let active_run = ActiveRunSnapshot {
            run_id,
            client_id,
            prompt_preview: prompt_preview(expanded_prompt, 160),
            submitted_user_message: Some(submitted_user_message),
            started_at_epoch_ms: submitted_at_epoch_ms,
        };
        *guard = Some(ActiveRunState {
            snapshot: active_run.clone(),
            started_at: Instant::now(),
            finishing: false,
            task: None,
            _run_lease: run_lease,
        });
        drop(guard);

        self.event_bus.emit_with_context(
            SessionEvent::RunStarted {
                prompt_preview: active_run.prompt_preview.clone(),
                submitted_user_message: active_run.submitted_user_message.clone(),
                started_at_epoch_ms: active_run.started_at_epoch_ms,
            },
            Some(active_run.run_id.clone()),
            active_run.client_id.clone(),
        );

        Ok(active_run)
    }

    async fn finish_run_once(&self, run_id: &SessionRunId, outcome: RunOutcome) -> bool {
        let Some(finishing_run) = self.mark_run_finishing(run_id) else {
            return false;
        };
        self.expire_orchestrator_steering();
        let (completed_duration_ms, completed_usage) = match &outcome {
            RunOutcome::Completed(_, usage) => (Some(finishing_run.duration_ms), usage.clone()),
            RunOutcome::Failed(_, usage) => (None, usage.clone()),
        };
        let persistence_error = match self
            .persist_run_snapshot(
                &finishing_run.snapshot,
                completed_duration_ms,
                completed_usage,
            )
            .await
        {
            Ok(()) => None,
            Err(error) => {
                eprintln!(
                    "nac: failed to persist session snapshot for run {}: {error:#}",
                    finishing_run.snapshot.run_id
                );
                Some(format!("{error:#}"))
            }
        };

        let run_id = finishing_run.snapshot.run_id.clone();
        let client_id = finishing_run.snapshot.client_id.clone();
        let terminal_event = match (outcome, persistence_error) {
            (RunOutcome::Completed(_, _), Some(error)) => SessionEvent::RunFailed {
                message: format!("run completed, but failed to persist session snapshot: {error}"),
            },
            (RunOutcome::Completed(response, _), None) => SessionEvent::RunCompleted {
                response,
                duration_ms: completed_duration_ms,
            },
            (RunOutcome::Failed(message, _), Some(error)) => SessionEvent::RunFailed {
                message: format!(
                    "{message}\nAdditionally, failed to persist session snapshot: {error}"
                ),
            },
            (RunOutcome::Failed(message, _), None) => SessionEvent::RunFailed { message },
        };
        self.event_bus
            .emit_with_context(terminal_event, Some(run_id.clone()), client_id);
        self.clear_finished_run(&run_id);
        true
    }

    fn expire_orchestrator_steering(&self) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        match crate::store::expire_thread_steering(
            &self.metadata.store_path,
            session_id,
            crate::store::ORCHESTRATOR_STEERING_TARGET,
        ) {
            Ok(records) => {
                for record in records {
                    self.event_bus
                        .emit_agent(AgentEvent::OrchestratorSteeringExpired {
                            steering_id: record.id,
                            instruction_preview: record.instruction.chars().take(160).collect(),
                        });
                }
            }
            Err(error) => {
                eprintln!("nac: failed to expire orchestrator steering: {error:#}");
            }
        }
    }

    fn mark_run_finishing(&self, run_id: &SessionRunId) -> Option<FinishingRun> {
        let mut guard = self.lock_active_run();
        let active_run = guard.as_mut()?;
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(FinishingRun {
            snapshot: active_run.snapshot.clone(),
            duration_ms: duration_ms(active_run.started_at.elapsed()),
        })
    }

    fn mark_run_cancelling(&self, run_id: &SessionRunId) -> Option<CancellingRun> {
        let mut guard = self.lock_active_run();
        let active_run = guard.as_mut()?;
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(CancellingRun {
            snapshot: active_run.snapshot.clone(),
            task: active_run.task.take(),
        })
    }

    fn set_run_task(&self, run_id: &SessionRunId, task: JoinHandle<()>) {
        let mut guard = self.lock_active_run();
        let Some(active_run) = guard.as_mut() else {
            task.abort();
            return;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            task.abort();
            return;
        }
        active_run.task = Some(task);
    }

    fn clear_finished_run(&self, run_id: &SessionRunId) {
        let mut guard = self.lock_active_run();
        if guard
            .as_ref()
            .is_some_and(|active_run| &active_run.snapshot.run_id == run_id && active_run.finishing)
        {
            *guard = None;
        }
    }

    fn current_user_message_count(&self) -> Option<usize> {
        if let Ok(agent) = self.agent.try_lock() {
            return Some(count_user_messages(&agent.messages));
        }
        if let Ok(snapshot) = self.session_snapshot.try_lock() {
            return Some(
                snapshot
                    .as_ref()
                    .map(|snapshot| count_user_messages(&snapshot.messages))
                    .unwrap_or_default(),
            );
        }
        None
    }

    fn lock_active_run(&self) -> std::sync::MutexGuard<'_, Option<ActiveRunState>> {
        self.active_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    async fn persist_run_snapshot(
        &self,
        active_run: &ActiveRunSnapshot,
        completed_duration_ms: Option<u64>,
        completed_usage: Option<crate::model::TokenUsage>,
    ) -> Result<()> {
        let messages = {
            let agent = self.agent.lock().await;
            agent.messages.clone()
        };

        let refreshed = {
            let snapshot = self.session_snapshot.lock().await;
            let Some(snapshot) = snapshot.as_ref() else {
                return Ok(());
            };
            let response_timing =
                response_timing_after_run(snapshot, &messages, completed_duration_ms);
            let token_usages = token_usages_after_run(
                &snapshot.token_usages,
                &snapshot.messages,
                &messages,
                completed_usage,
            );
            sessions::refresh_snapshot(
                snapshot,
                messages,
                response_timing.last_response_duration_ms,
                response_timing.previous_response_duration_ms,
                response_timing.response_durations_ms,
                token_usages,
            )
        };

        let saved_snapshot = refreshed.clone();
        let store_path = self.metadata.store_path.clone();
        tokio::task::spawn_blocking(move || sessions::save_session(&store_path, &saved_snapshot))
            .await??;

        let saved_session_id = refreshed.session_id.clone();
        {
            let mut snapshot = self.session_snapshot.lock().await;
            *snapshot = Some(refreshed);
        }
        self.event_bus.emit_with_context(
            SessionEvent::SnapshotSaved {
                session_id: saved_session_id,
            },
            Some(active_run.run_id.clone()),
            active_run.client_id.clone(),
        );

        Ok(())
    }

    async fn append_cancellation_message(&self) -> Option<crate::model::TokenUsage> {
        let mut agent = self.agent.lock().await;
        truncate_incomplete_tool_turn(&mut agent.messages);
        agent.messages.push(Message::Assistant {
            content: Some("[run cancelled by user]".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        });
        // Return partial usage so the caller can persist it.  Because
        // `send()` now updates `last_usage` mid-loop, this captures all
        // token usage from model calls made before the cancel.
        agent.last_usage.clone()
    }
}

struct LoadedFrontendMessages {
    messages: Vec<Message>,
    page: Option<MessagePageMetadata>,
    cycle: Option<MessageCycleMetadata>,
}

fn load_frontend_messages(
    messages: &[Message],
    selection: FrontendSnapshotMessages,
) -> LoadedFrontendMessages {
    match selection {
        FrontendSnapshotMessages::All => LoadedFrontendMessages {
            messages: messages.to_vec(),
            page: None,
            cycle: None,
        },
        FrontendSnapshotMessages::Page(request) => {
            let cycle = current_message_cycle(messages);
            let page = page_messages(messages, request);
            LoadedFrontendMessages {
                messages: page.messages,
                page: Some(page.page),
                cycle: Some(cycle),
            }
        }
    }
}

fn page_messages(messages: &[Message], request: MessagePageRequest) -> MessagesPageSnapshot {
    let is_visible =
        |message: &&Message| request.include_system || !matches!(message, Message::System { .. });
    let total = messages.iter().filter(is_visible).count();
    let end = request.before.unwrap_or(total).min(total);
    let limit = request.limit.max(1);
    let start = end.saturating_sub(limit);
    let messages = messages
        .iter()
        .filter(|message| request.include_system || !matches!(message, Message::System { .. }))
        .skip(start)
        .take(end - start)
        .cloned()
        .collect();
    MessagesPageSnapshot {
        messages,
        page: MessagePageMetadata {
            start,
            end,
            total,
            has_older: start > 0,
        },
    }
}

fn current_message_cycle(messages: &[Message]) -> MessageCycleMetadata {
    let mut latest_user_index = None;
    let mut user_count = 0usize;
    for (index, message) in messages.iter().enumerate() {
        if matches!(message, Message::User { .. }) {
            latest_user_index = Some(index);
            user_count += 1;
        }
    }

    let Some(latest_user_index) = latest_user_index else {
        return MessageCycleMetadata {
            marker: "none".to_string(),
            thread_names: Vec::new(),
        };
    };
    let mut thread_names = BTreeMap::<String, ()>::new();
    for message in &messages[latest_user_index + 1..] {
        let Message::Assistant {
            tool_calls: Some(tool_calls),
            ..
        } = message
        else {
            continue;
        };
        for tool_call in tool_calls {
            if tool_call.function.name != "thread" {
                continue;
            }
            let Ok(arguments) =
                serde_json::from_str::<serde_json::Value>(&tool_call.function.arguments)
            else {
                continue;
            };
            let Some(name) = arguments
                .get("name")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty())
            else {
                continue;
            };
            thread_names.insert(name.to_string(), ());
        }
    }
    MessageCycleMetadata {
        marker: format!("history:{user_count}:{latest_user_index}"),
        thread_names: thread_names.into_keys().collect(),
    }
}

const OVERVIEW_SYSTEM_PROMPT: &str = "You synthesize the current state of a coding orchestration session for an operator dashboard. Use only the supplied snapshot. Give priority to the latest user message, every thread dispatched after that message and its current outcome, and what each active thread is currently assigned to do. Use durable thread records to recover completed work when live dispatch history is unavailable; use worksets and workspace changes only when they clarify the current state. Do not address the user, quote the transcript, narrate your process, invent progress, or use headings or lists. Return exactly one JSON object with this schema: {\"summary\":\"one dense paragraph of two to four sentences\"}. The paragraph must state the current objective, distinguish active work from completed work, and mention a blocker or immediate next step only when supported. Keep it under 700 characters. Output JSON only.";

#[derive(Debug, Deserialize)]
struct GeneratedOverviewPayload {
    summary: String,
}

fn overview_source(
    snapshot: &SessionFrontendSnapshot,
    live_events: &[SessionEventEnvelope],
) -> serde_json::Value {
    let transcript_user_index = snapshot
        .messages
        .iter()
        .rposition(|message| matches!(message, Message::User { .. }));
    let submitted_user_message = snapshot
        .active_run
        .as_ref()
        .and_then(|run| run.submitted_user_message.as_ref());
    let latest_user_message = submitted_user_message
        .map(|message| compact_overview_text(&message.content, 1_200))
        .or_else(|| {
            transcript_user_index.and_then(|index| match &snapshot.messages[index] {
                Message::User { content } => Some(compact_overview_text(content, 1_200)),
                _ => None,
            })
        });
    let transcript_dispatch_start = if let Some(submitted) = submitted_user_message {
        snapshot
            .messages
            .iter()
            .rposition(|message| {
                matches!(message, Message::User { content } if content == &submitted.content)
            })
            .map_or(snapshot.messages.len(), |index| index + 1)
    } else {
        transcript_user_index.map_or(0, |index| index + 1)
    };
    let latest_run_sequence = live_events
        .iter()
        .rev()
        .find(|envelope| {
            matches!(
                &envelope.event,
                SessionEvent::RunStarted {
                    submitted_user_message: Some(message),
                    ..
                } if latest_user_message.as_deref() == Some(compact_overview_text(&message.content, 1_200).as_str())
            )
        })
        .map(|envelope| envelope.sequence_id);
    let active_threads = snapshot
        .active_threads
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    let recent_dispatches = thread_dispatches_since_latest_user_message(
        snapshot,
        transcript_dispatch_start,
        &active_threads,
        live_events,
        latest_run_sequence,
    );
    let active_thread_state = snapshot
        .active_threads
        .iter()
        .map(|name| {
            let recent_assignment = recent_dispatches
                .iter()
                .rev()
                .find(|dispatch| dispatch.get("name").and_then(serde_json::Value::as_str) == Some(name.as_str()))
                .and_then(|dispatch| dispatch.get("action"))
                .cloned();
            let durable_assignment = snapshot
                .threads
                .iter()
                .find(|thread| thread.name == *name)
                .and_then(|thread| thread.latest_action.as_deref())
                .map(|action| serde_json::Value::String(compact_overview_text(action, 700)));
            let latest_steering = snapshot
                .thread_steering
                .iter()
                .rev()
                .find(|record| record.thread_name == *name)
                .map(|record| serde_json::json!({
                    "status": record.status,
                    "instruction": compact_overview_text(&record.instruction, 400),
                }));
            serde_json::json!({
                "name": name,
                "current_assignment": recent_assignment.or(durable_assignment),
                "latest_steering": latest_steering,
            })
        })
        .collect::<Vec<_>>();
    let durable_threads = snapshot
        .threads
        .iter()
        .map(|thread| {
            let latest_episode = snapshot
                .thread_episodes
                .get(&thread.name)
                .and_then(|episodes| episodes.last());
            serde_json::json!({
                "name": thread.name,
                "state": if active_threads.contains(thread.name.as_str()) { "active" } else if latest_episode.is_some() { "finished" } else { "known" },
                "latest_action": thread.latest_action,
                "latest_result": latest_episode.map(|episode| compact_overview_text(&episode.content, 1_000)),
            })
        })
        .collect::<Vec<_>>();

    let worksets = snapshot
        .worksets
        .items
        .iter()
        .take(4)
        .map(|workset| {
            serde_json::json!({
                "id": workset.id,
                "goal": compact_overview_text(&workset.goal, 500),
                "status": workset.status,
                "summary": compact_overview_text(&workset.summary, 600),
                "items": workset.items.iter().take(12).map(|item| serde_json::json!({
                    "title": item.title,
                    "role": item.role,
                    "acceptance": compact_overview_text(&item.acceptance, 300),
                    "notes": item.notes.as_deref().map(|notes| compact_overview_text(notes, 300)),
                })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>();

    let steering = snapshot
        .thread_steering
        .iter()
        .rev()
        .take(20)
        .map(|record| {
            serde_json::json!({
                "thread": if record.thread_name == crate::store::ORCHESTRATOR_STEERING_TARGET {
                    "orchestrator"
                } else {
                    record.thread_name.as_str()
                },
                "status": record.status,
                "instruction": compact_overview_text(&record.instruction, 400),
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "session": {
            "id": snapshot.metadata.session_id,
            "model": snapshot.metadata.model,
            "workspace": snapshot.metadata.cwd,
            "run_active": snapshot.active_run.is_some(),
        },
        "latest_user_message": latest_user_message,
        "thread_dispatches_since_latest_user_message": recent_dispatches,
        "active_threads": active_thread_state,
        "durable_threads": durable_threads,
        "steering": steering,
        "worksets": worksets,
        "workspace": {
            "branch": snapshot.workspace.branch,
            "changed_files": snapshot.workspace.changed_files.iter().take(40).map(|file| serde_json::json!({
                "status": file.status,
                "path": file.path,
                "additions": file.additions,
                "deletions": file.deletions,
            })).collect::<Vec<_>>(),
            "total_additions": snapshot.workspace.total_additions,
            "total_deletions": snapshot.workspace.total_deletions,
        },
    })
}

fn thread_dispatches_since_latest_user_message(
    snapshot: &SessionFrontendSnapshot,
    start_index: usize,
    active_threads: &HashSet<&str>,
    live_events: &[SessionEventEnvelope],
    latest_run_sequence: Option<u64>,
) -> Vec<serde_json::Value> {
    let messages = snapshot.messages.get(start_index..).unwrap_or_default();
    let tool_results = messages
        .iter()
        .filter_map(|message| match message {
            Message::Tool {
                tool_call_id,
                content,
            } => Some((tool_call_id.as_str(), content.as_str())),
            _ => None,
        })
        .collect::<HashMap<_, _>>();
    let mut dispatches = Vec::new();
    let mut seen = HashSet::new();
    for message in messages {
        let Message::Assistant {
            tool_calls: Some(tool_calls),
            ..
        } = message
        else {
            continue;
        };
        for call in tool_calls {
            if call.function.name != "thread" {
                continue;
            }
            let Ok(arguments) = serde_json::from_str::<serde_json::Value>(&call.function.arguments)
            else {
                continue;
            };
            let Some(name) = arguments.get("name").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let action = arguments
                .get("action")
                .and_then(serde_json::Value::as_str)
                .map(|value| compact_overview_text(value, 900));
            seen.insert((name.to_string(), action.clone().unwrap_or_default()));
            let latest_episode = snapshot
                .thread_episodes
                .get(name)
                .and_then(|episodes| episodes.last());
            let is_active = active_threads.contains(name);
            dispatches.push(serde_json::json!({
                "name": name,
                "action": action,
                "source_threads": arguments.get("threads").cloned().unwrap_or_else(|| serde_json::json!([])),
                "state": if is_active { "active" } else if latest_episode.is_some() { "finished" } else { "dispatched" },
                "result": if is_active { None } else { latest_episode.map(|episode| compact_overview_text(&episode.content, 1_000)) },
                "dispatch_response": tool_results.get(call.id.as_str()).map(|content| compact_overview_text(content, 500)),
            }));
        }
    }
    if let Some(run_sequence) = latest_run_sequence {
        for envelope in live_events
            .iter()
            .filter(|envelope| envelope.sequence_id > run_sequence)
        {
            let SessionEvent::Agent {
                event:
                    AgentEvent::ThreadStarted {
                        name,
                        action,
                        source_threads,
                    },
            } = &envelope.event
            else {
                continue;
            };
            let action = compact_overview_text(action, 900);
            if !seen.insert((name.clone(), action.clone())) {
                continue;
            }
            let latest_episode = snapshot
                .thread_episodes
                .get(name)
                .and_then(|episodes| episodes.last());
            let is_active = active_threads.contains(name.as_str());
            dispatches.push(serde_json::json!({
                "name": name,
                "action": action,
                "source_threads": source_threads,
                "state": if is_active { "active" } else if latest_episode.is_some() { "finished" } else { "dispatched" },
                "result": if is_active { None } else { latest_episode.map(|episode| compact_overview_text(&episode.content, 1_000)) },
            }));
        }
    }
    dispatches
}

fn parse_generated_overview(content: &str) -> Result<GeneratedOverviewPayload> {
    let start = content.find('{').ok_or_else(|| {
        anyhow::anyhow!("overview model returned invalid JSON: object start is missing")
    })?;
    let end = content.rfind('}').ok_or_else(|| {
        anyhow::anyhow!("overview model returned invalid JSON: object end is missing")
    })?;
    if end < start {
        return Err(anyhow::anyhow!(
            "overview model returned invalid JSON: malformed object"
        ));
    }
    let mut payload: GeneratedOverviewPayload = serde_json::from_str(&content[start..=end])
        .map_err(|error| anyhow::anyhow!("overview model returned invalid JSON: {error}"))?;
    payload.summary = compact_overview_text(&payload.summary, 700);
    if payload.summary.is_empty() {
        return Err(anyhow::anyhow!("overview model returned an empty summary"));
    }
    Ok(payload)
}

fn compact_overview_text(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_chars {
        return compact;
    }
    let mut truncated = compact
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    truncated.push('…');
    truncated
}

fn count_user_messages(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| matches!(message, Message::User { .. }))
        .count()
}

fn truncate_incomplete_tool_turn(messages: &mut Vec<Message>) {
    let Some(index) = messages.iter().rposition(|message| {
        matches!(
            message,
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } if !tool_calls.is_empty()
        )
    }) else {
        return;
    };
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return;
    };
    let expected = tool_calls
        .iter()
        .map(|tool_call| tool_call.id.as_str())
        .collect::<HashSet<_>>();
    let observed = messages[index + 1..]
        .iter()
        .filter_map(|message| match message {
            Message::Tool { tool_call_id, .. } => Some(tool_call_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    if !expected.is_subset(&observed) {
        messages.truncate(index);
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn prompt_preview(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= max_chars {
        return compact;
    }

    let mut preview = String::new();
    for ch in compact.chars().take(max_chars.saturating_sub(3)) {
        preview.push(ch);
    }
    preview.push_str("...");
    preview
}

fn duration_ms(duration: Duration) -> u64 {
    duration.as_millis().min(u64::MAX as u128) as u64
}

fn response_timing_after_run(
    snapshot: &SessionSnapshot,
    messages: &[Message],
    completed_duration_ms: Option<u64>,
) -> ResponseTimingSnapshot {
    let mut durations = response_duration_history_from_snapshot(snapshot);
    let previous_response_count = visible_response_count(&snapshot.messages);
    if durations.len() < previous_response_count {
        durations.resize(previous_response_count, None);
    }

    let current_response_count = visible_response_count(messages);
    if durations.len() < current_response_count {
        durations.resize(current_response_count, None);
    }
    if let (Some(duration_ms), Some(last_index)) =
        (completed_duration_ms, current_response_count.checked_sub(1))
    {
        durations[last_index] = Some(duration_ms);
    }

    let last_response_duration_ms = durations.last().copied().flatten();
    let previous_response_duration_ms = durations
        .len()
        .checked_sub(2)
        .and_then(|index| durations.get(index))
        .copied()
        .flatten();

    ResponseTimingSnapshot {
        last_response_duration_ms,
        previous_response_duration_ms,
        response_durations_ms: Some(durations),
        token_usages: None,
        last_token_usage: None,
        cumulative_token_usage: None,
    }
}

fn response_duration_history_from_snapshot(snapshot: &SessionSnapshot) -> Vec<Option<u64>> {
    if let Some(durations) = &snapshot.response_durations_ms {
        return durations.clone();
    }

    let response_count = visible_response_count(&snapshot.messages);
    let mut durations = vec![None; response_count];
    if let Some(last_index) = response_count.checked_sub(1) {
        durations[last_index] = snapshot.last_response_duration_ms;
    }
    if response_count >= 2 {
        durations[response_count - 2] = snapshot.previous_response_duration_ms;
    }
    durations
}

fn visible_response_count(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| {
            matches!(
                message,
                Message::Assistant { tool_calls, .. }
                    if tool_calls.as_ref().is_none_or(|tool_calls| tool_calls.is_empty())
            )
        })
        .count()
}

/// Build the per-response token-usage vector after a run, mirroring the
/// logic in `response_timing_after_run` for durations.  The existing
/// vector is preserved and padded to match the new response count; the
/// most recent response's usage is set from `completed_usage` when the
/// run completed successfully.
fn token_usages_after_run(
    existing: &[Option<crate::model::TokenUsage>],
    old_messages: &[Message],
    new_messages: &[Message],
    completed_usage: Option<crate::model::TokenUsage>,
) -> Vec<Option<crate::model::TokenUsage>> {
    let mut usages = existing.to_vec();
    let previous_response_count = visible_response_count(old_messages);
    if usages.len() < previous_response_count {
        usages.resize(previous_response_count, None);
    }

    let current_response_count = visible_response_count(new_messages);
    if usages.len() < current_response_count {
        usages.resize(current_response_count, None);
    }
    if let (Some(usage), Some(last_index)) =
        (completed_usage, current_response_count.checked_sub(1))
    {
        usages[last_index] = Some(usage);
    }

    usages
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::{AgentConfig, AgentMode};
    use crate::model::ModelClient;
    use crate::types::{FunctionCall, ToolCall};
    use std::collections::BTreeMap;

    #[test]
    fn generated_overview_parser_accepts_fenced_json_and_enforces_limit() {
        let payload = parse_generated_overview(
            "```json\n{\"summary\":\"  UI   implementation is active. \"}\n```",
        )
        .unwrap();

        assert_eq!(payload.summary, "UI implementation is active.");
    }

    fn thread_call(id: &str, arguments: &str) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: "thread".to_string(),
                arguments: arguments.to_string(),
            },
        }
    }

    fn mixed_message_history() -> Vec<Message> {
        vec![
            Message::System {
                content: "system-one".to_string(),
            },
            Message::User {
                content: "older request".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("reasoning without visible content".to_string()),
                reasoning_details: Some(serde_json::json!({"type": "reasoning"})),
                tool_calls: None,
            },
            Message::Tool {
                tool_call_id: "older-tool".to_string(),
                content: "older result".to_string(),
            },
            Message::System {
                content: "system-two".to_string(),
            },
            Message::User {
                content: "latest request".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![
                    thread_call(
                        "thread-zeta",
                        r#"{"name":" zeta ","action":"outside the returned tail"}"#,
                    ),
                    thread_call("thread-malformed", r#"{"name":"broken"#),
                    thread_call("thread-empty", r#"{"name":"   "}"#),
                ]),
            },
            Message::Tool {
                tool_call_id: "thread-zeta".to_string(),
                content: "zeta started".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: Some("new reasoning".to_string()),
                reasoning_details: None,
                tool_calls: None,
            },
            Message::System {
                content: "system-three".to_string(),
            },
            Message::Assistant {
                content: None,
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: Some(vec![thread_call(
                    "thread-alpha",
                    r#"{"name":"alpha","action":"inside the cycle"}"#,
                )]),
            },
            Message::Tool {
                tool_call_id: "thread-alpha".to_string(),
                content: "alpha started".to_string(),
            },
            Message::Assistant {
                content: Some("latest answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
        ]
    }

    fn legacy_page_messages(
        messages: &[Message],
        request: MessagePageRequest,
    ) -> MessagesPageSnapshot {
        let visible = messages
            .iter()
            .filter(|message| request.include_system || !matches!(message, Message::System { .. }))
            .cloned()
            .collect::<Vec<_>>();
        let total = visible.len();
        let end = request.before.unwrap_or(total).min(total);
        let start = end.saturating_sub(request.limit.max(1));
        MessagesPageSnapshot {
            messages: visible[start..end].to_vec(),
            page: MessagePageMetadata {
                start,
                end,
                total,
                has_older: start > 0,
            },
        }
    }

    #[test]
    fn paged_messages_match_legacy_windows_for_mixed_history_and_cursor_bounds() {
        let messages = mixed_message_history();
        for include_system in [false, true] {
            for before in [None, Some(0), Some(1), Some(3), Some(usize::MAX)] {
                for limit in [0, 1, 4, 100] {
                    let request = MessagePageRequest {
                        before,
                        limit,
                        include_system,
                    };
                    let expected = legacy_page_messages(&messages, request);
                    let actual = page_messages(&messages, request);
                    assert_eq!(actual.page, expected.page, "request: {request:?}");
                    assert_eq!(
                        serde_json::to_value(&actual.messages).unwrap(),
                        serde_json::to_value(&expected.messages).unwrap(),
                        "request: {request:?}"
                    );
                }
            }
        }

        let beyond_end = page_messages(
            &messages,
            MessagePageRequest {
                before: Some(usize::MAX),
                limit: 4,
                include_system: false,
            },
        );
        assert_eq!(beyond_end.page.end, beyond_end.page.total);
        assert_eq!(beyond_end.page.total, 10);
        assert_eq!(beyond_end.messages.len(), 4);
    }

    #[test]
    fn message_cycle_uses_complete_raw_history_and_ignores_malformed_thread_calls() {
        let messages = mixed_message_history();
        let loaded = load_frontend_messages(
            &messages,
            FrontendSnapshotMessages::Page(MessagePageRequest {
                before: None,
                limit: 2,
                include_system: false,
            }),
        );

        assert_eq!(loaded.messages.len(), 2);
        assert_eq!(
            loaded.cycle,
            Some(MessageCycleMetadata {
                marker: "history:2:5".to_string(),
                thread_names: vec!["alpha".to_string(), "zeta".to_string()],
            })
        );
        assert!(!serde_json::to_string(&loaded.messages)
            .unwrap()
            .contains("zeta"));
        assert_eq!(
            current_message_cycle(&[Message::System {
                content: "only system".to_string(),
            }]),
            MessageCycleMetadata {
                marker: "none".to_string(),
                thread_names: Vec::new(),
            }
        );
    }

    #[test]
    fn overview_source_prioritizes_latest_user_dispatches_and_active_assignments() {
        let mut snapshot = SessionFrontendSnapshot {
            metadata: SessionMetadata {
                cwd: "/repo".to_string(),
                workspace_host_path: Some(PathBuf::from("/repo")),
                store_path: PathBuf::from("/tmp/store.db"),
                model: "test-model".to_string(),
                backend: "test".to_string(),
                session_id: Some("session-a".to_string()),
                sandbox_status: "off".to_string(),
                agents_md_status: "off".to_string(),
                base_url: String::new(),
                reasoning_effort: None,
                api_key_env: None,
                extra_headers: BTreeMap::new(),
            },
            messages: vec![
                Message::User {
                    content: "older request".to_string(),
                },
                Message::User {
                    content: "revamp the thread board".to_string(),
                },
                Message::Assistant {
                    content: None,
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: Some(vec![ToolCall {
                        id: "call-ui".to_string(),
                        call_type: "function".to_string(),
                        function: FunctionCall {
                            name: "thread".to_string(),
                            arguments: r#"{"name":"ui","action":"Build the two-column board","threads":[]}"#.to_string(),
                        },
                    }]),
                },
                Message::Tool {
                    tool_call_id: "call-ui".to_string(),
                    content: "worker is still running".to_string(),
                },
            ],
            response_timing: ResponseTimingSnapshot::default(),
            active_run: None,
            sessions: Vec::new(),
            active_threads: vec!["ui".to_string()],
            threads: vec![ThreadSnapshot {
                name: "ui".to_string(),
                session_id: "session-a".to_string(),
                created_at: String::new(),
                updated_at: String::new(),
                episode_count: 0,
                latest_action: None,
            }],
            thread_episodes: HashMap::new(),
            thread_events: HashMap::new(),
            thread_steering: Vec::new(),
            overview: None,
            worksets: WorksetsSnapshot::default(),
            workspace: WorkspaceSnapshot {
                host_root: Some(PathBuf::from("/repo")),
                workspace_display: "/repo".to_string(),
                repo_label: None,
                branch: Some("ui".to_string()),
                changed_files: Vec::new(),
                total_additions: 0,
                total_deletions: 0,
                error: None,
            },
        };

        let source = overview_source(&snapshot, &[]);
        assert_eq!(source["latest_user_message"], "revamp the thread board");
        assert_eq!(
            source["thread_dispatches_since_latest_user_message"][0]["action"],
            "Build the two-column board"
        );
        assert_eq!(
            source["thread_dispatches_since_latest_user_message"][0]["state"],
            "active"
        );
        assert_eq!(
            source["active_threads"][0]["current_assignment"],
            "Build the two-column board"
        );

        snapshot.thread_events.insert(
            "ui".to_string(),
            vec![AgentEvent::ThreadLog {
                name: "ui".to_string(),
                line: "event payload deliberately ignored by overview".to_string(),
            }],
        );
        assert_eq!(
            serde_json::to_vec(&overview_source(&snapshot, &[])).unwrap(),
            serde_json::to_vec(&source).unwrap()
        );

        let run_id = SessionRunId::new();
        let submitted = SubmittedUserMessageSnapshot {
            run_id: run_id.clone(),
            client_id: None,
            content: "show live thread work".to_string(),
            baseline_user_message_count: Some(2),
            submitted_at_epoch_ms: 1,
        };
        snapshot.messages.truncate(1);
        snapshot.active_run = Some(ActiveRunSnapshot {
            run_id: run_id.clone(),
            client_id: None,
            prompt_preview: "show live thread work".to_string(),
            submitted_user_message: Some(submitted.clone()),
            started_at_epoch_ms: 1,
        });
        let live_events = vec![
            SessionEventEnvelope {
                session_id: Some("session-a".to_string()),
                sequence_id: 1,
                client_id: None,
                run_id: Some(run_id.clone()),
                event: SessionEvent::RunStarted {
                    prompt_preview: "show live thread work".to_string(),
                    submitted_user_message: Some(submitted),
                    started_at_epoch_ms: 1,
                },
            },
            SessionEventEnvelope {
                session_id: Some("session-a".to_string()),
                sequence_id: 2,
                client_id: None,
                run_id: Some(run_id),
                event: SessionEvent::Agent {
                    event: AgentEvent::ThreadStarted {
                        name: "ui".to_string(),
                        action: "Inspect the live board".to_string(),
                        source_threads: Vec::new(),
                    },
                },
            },
        ];
        let live_source = overview_source(&snapshot, &live_events);
        assert_eq!(live_source["latest_user_message"], "show live thread work");
        assert_eq!(
            live_source["thread_dispatches_since_latest_user_message"][0]["action"],
            "Inspect the live board"
        );
        assert_eq!(
            live_source["active_threads"][0]["current_assignment"],
            "Inspect the live board"
        );
    }

    fn test_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_session_service_{label}_{unique}"))
            .join("store.db")
    }

    fn test_agent(client: ModelClient, store_path: PathBuf, session_id: Option<String>) -> Agent {
        Agent::with_config(
            client,
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path,
                session_id,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("/repo"),
                config_cwd: PathBuf::from("/repo"),
                working_directory: "/repo".to_string(),
                worker_executable: None,
                sandbox: None,
                ssh_host: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
            },
        )
        .expect("agent config must be valid")
    }

    fn test_picker_service(label: &str) -> SessionServiceParts {
        let store_path = test_store_path(label);
        let client = ModelClient::new_for_test();
        let agent = test_agent(client.clone(), store_path.clone(), None);
        SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Picker { store_path },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        })
    }

    fn test_active_service(label: &str, session_id: &str) -> (SessionServiceParts, PathBuf) {
        let store_path = test_store_path(label);
        let client = ModelClient::new_for_test();
        let agent = test_agent(
            client.clone(),
            store_path.clone(),
            Some(session_id.to_string()),
        );
        let snapshot = sessions::new_snapshot(
            session_id.to_string(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
            None,
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.to_string(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        (parts, store_path)
    }

    #[tokio::test]
    async fn focused_snapshot_options_page_messages_and_preserve_default_wrapper_contract() {
        let (parts, store_path) = test_active_service("paged_snapshot", "paged-session");
        let messages = mixed_message_history();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages = messages.clone();
        }
        let request = MessagePageRequest {
            before: None,
            limit: 2,
            include_system: false,
        };
        let expected_page = page_messages(&messages, request);

        let loaded = parts
            .service
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                thread_event_limit: 0,
                include_sessions: false,
                messages: FrontendSnapshotMessages::Page(request),
            })
            .await
            .unwrap();
        assert!(loaded.snapshot.sessions.is_empty());
        assert!(loaded.snapshot.thread_events.is_empty());
        assert_eq!(loaded.message_page, Some(expected_page.page));
        assert_eq!(
            loaded.message_cycle,
            Some(MessageCycleMetadata {
                marker: "history:2:5".to_string(),
                thread_names: vec!["alpha".to_string(), "zeta".to_string()],
            })
        );
        assert_eq!(
            serde_json::to_value(&loaded.snapshot.messages).unwrap(),
            serde_json::to_value(&expected_page.messages).unwrap()
        );

        let full = parts
            .service
            .frontend_snapshot_with_thread_event_limit(0)
            .await
            .unwrap();
        assert_eq!(full.sessions.len(), 1);
        assert_eq!(
            serde_json::to_value(&full.messages).unwrap(),
            serde_json::to_value(&messages).unwrap()
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn paged_snapshot_and_message_method_use_persisted_history_when_agent_is_busy() {
        let (parts, store_path) = test_active_service("paged_fallback", "fallback-session");
        let persisted_messages = mixed_message_history();
        parts
            .service
            .session_snapshot
            .lock()
            .await
            .as_mut()
            .unwrap()
            .messages = persisted_messages.clone();
        let request = MessagePageRequest {
            before: Some(usize::MAX),
            limit: 3,
            include_system: false,
        };
        let expected = page_messages(&persisted_messages, request);
        let agent_guard = parts.service.agent.lock().await;

        let direct = tokio::time::timeout(
            Duration::from_millis(500),
            parts.service.messages_page(request),
        )
        .await
        .expect("paged messages should not wait for the held agent mutex");
        assert_eq!(direct.page, expected.page);
        assert_eq!(
            serde_json::to_value(&direct.messages).unwrap(),
            serde_json::to_value(&expected.messages).unwrap()
        );

        let loaded = tokio::time::timeout(
            Duration::from_secs(2),
            parts
                .service
                .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                    thread_event_limit: 0,
                    include_sessions: false,
                    messages: FrontendSnapshotMessages::Page(request),
                }),
        )
        .await
        .expect("paged snapshot should not wait for the held agent mutex")
        .unwrap();
        assert_eq!(loaded.message_page, Some(expected.page));
        assert_eq!(
            serde_json::to_value(&loaded.snapshot.messages).unwrap(),
            serde_json::to_value(&expected.messages).unwrap()
        );

        drop(agent_guard);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn overview_snapshot_skips_unused_malformed_persisted_thread_events() {
        let (parts, store_path) = test_active_service("overview_events", "overview-session");
        crate::store::append_thread_event(
            &store_path,
            "overview-session",
            "worker-a",
            "{malformed event json",
        )
        .unwrap();
        assert!(parts
            .service
            .all_thread_events_with_limit(1)
            .unwrap_err()
            .to_string()
            .contains("invalid persisted event"));

        let snapshot = parts.service.overview_snapshot().await.unwrap();
        assert!(snapshot.thread_events.is_empty());
        assert_eq!(snapshot.sessions.len(), 1);
        let source = overview_source(&snapshot, &[]);
        let mut with_events = snapshot.clone();
        with_events.thread_events.insert(
            "worker-a".to_string(),
            vec![AgentEvent::ThreadLog {
                name: "worker-a".to_string(),
                line: "ignored".to_string(),
            }],
        );
        assert_eq!(overview_source(&with_events, &[]), source);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn frontend_snapshot_restores_persisted_thread_activity() {
        let (parts, store_path) = test_active_service("thread_activity", "activity-session");
        parts.service.event_bus.emit_agent(AgentEvent::ThreadStarted {
            name: "impl/ui".to_string(),
            action: "Build the interface".to_string(),
            source_threads: Vec::new(),
        });
        parts.service.event_bus.emit_agent(AgentEvent::ToolCallStarted {
            thread_name: Some("impl/ui".to_string()),
            call_id: "call-1".to_string(),
            name: "read".to_string(),
            args_preview: r#"{"path":"index.html"}"#.to_string(),
            args_detail: None,
        });
        parts.service.event_bus.emit_agent(AgentEvent::ToolCallFinished {
            thread_name: Some("impl/ui".to_string()),
            call_id: "call-1".to_string(),
            name: "read".to_string(),
            content_preview: "done".to_string(),
            is_error: false,
        });

        let snapshot = parts.service.frontend_snapshot().await.unwrap();
        let events = &snapshot.thread_events["impl/ui"];
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], AgentEvent::ThreadStarted { .. }));
        assert!(matches!(events[2], AgentEvent::ToolCallFinished { .. }));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn public_submission_rejects_external_process_lease() {
        let (parts, store_path) = test_active_service("external_lease", "leased-session");
        let _lease = sessions::SessionRunLease::try_acquire(&store_path, "leased-session").unwrap();
        assert!(matches!(
            parts.service.try_submit_prompt("must not run".to_string()),
            Err(SessionSubmitError::ExternalBusy { session_id }) if session_id == "leased-session"
        ));
        assert!(parts.service.active_run().is_none());
        drop(_lease);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn steering_requires_an_active_run_and_active_target_thread() {
        let (parts, store_path) = test_active_service("steering", "session-steering");
        let service = parts.service;
        let no_run = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap_err();
        assert!(no_run.to_string().contains("no active run"));

        *service
            .active_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(ActiveRunState {
            snapshot: ActiveRunSnapshot {
                run_id: SessionRunId::new(),
                client_id: None,
                prompt_preview: "revamp the UI".to_string(),
                submitted_user_message: None,
                started_at_epoch_ms: 0,
            },
            started_at: Instant::now(),
            finishing: false,
            task: None,
            _run_lease: None,
        });
        let inactive = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap_err();
        assert!(inactive.to_string().contains("not active"));

        service
            .active_threads
            .lock()
            .await
            .insert("impl/ui".to_string());
        let queued = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap();
        assert_eq!(queued.status, "queued");
        assert_eq!(
            crate::store::list_thread_steering(&store_path, "session-steering").unwrap(),
            vec![queued]
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn orchestrator_steering_requires_an_active_run_and_expires_at_run_end() {
        let (parts, store_path) =
            test_active_service("orchestrator_steering", "session-orchestrator-steering");
        let service = parts.service;
        let no_run = service
            .queue_orchestrator_steering("change direction")
            .unwrap_err();
        assert!(no_run.to_string().contains("no active run"));

        let active = service.try_begin_run(None, "initial direction").unwrap();
        let queued = service
            .queue_orchestrator_steering("change direction")
            .unwrap();
        assert_eq!(
            queued.thread_name,
            crate::store::ORCHESTRATOR_STEERING_TARGET
        );
        assert_eq!(queued.status, "queued");

        assert!(
            service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );
        let steering =
            crate::store::list_thread_steering(&store_path, "session-orchestrator-steering")
                .unwrap();
        assert_eq!(steering.len(), 1);
        assert_eq!(steering[0].status, "expired");

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn public_submission_rejects_stale_config_revision() {
        let (parts, store_path) = test_active_service("stale_revision", "stale-session");
        let mut stored = sessions::load_session(&store_path, "stale-session").unwrap();
        stored.model = "externally-updated-model".to_string();
        sessions::update_session_model_config(&store_path, &stored).unwrap();

        let error = match parts
            .service
            .try_submit_prompt("must not use stale config".to_string())
        {
            Ok(_) => panic!("stale service unexpectedly started a run"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            SessionSubmitError::Coordination { ref message }
                if message.contains("configuration changed externally")
        ));
        assert!(parts.service.active_run().is_none());
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    fn assert_run_started_event(
        envelope: SessionEventEnvelope,
        active_run: &ActiveRunSnapshot,
        prompt_preview: &str,
    ) {
        assert_eq!(envelope.client_id.as_ref(), active_run.client_id.as_ref());
        assert_eq!(envelope.run_id.as_ref(), Some(&active_run.run_id));
        match envelope.event {
            SessionEvent::RunStarted {
                prompt_preview: emitted_preview,
                submitted_user_message,
                started_at_epoch_ms,
            } => {
                assert_eq!(emitted_preview, prompt_preview);
                assert_eq!(submitted_user_message, active_run.submitted_user_message);
                assert_eq!(started_at_epoch_ms, active_run.started_at_epoch_ms);
            }
            other => panic!("expected run started, got {other:?}"),
        }
    }

    #[test]
    fn from_orchestrator_run_config_exposes_metadata_and_init_snapshot() {
        let store_path = test_store_path("active_init");
        let client = ModelClient::new_for_test();
        let session_id = "session-1".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let mut snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        snapshot.last_response_duration_ms = Some(200);
        snapshot.previous_response_duration_ms = Some(100);
        snapshot.response_durations_ms = Some(vec![Some(100), Some(200)]);

        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "loaded".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        assert_eq!(parts.init.metadata.store_path, store_path);
        assert_eq!(parts.init.metadata.session_id.as_deref(), Some("session-1"));
        assert_eq!(parts.init.metadata.model, "gpt-5.5");
        assert_eq!(parts.init.metadata.backend, "openai-responses");
        assert_eq!(parts.init.restored_messages.len(), 1);
        assert_eq!(
            parts.init.response_timing.last_response_duration_ms,
            Some(200)
        );
        assert_eq!(
            parts.init.response_timing.response_durations_ms,
            Some(vec![Some(100), Some(200)])
        );
    }

    #[tokio::test]
    async fn finish_run_persists_snapshot_before_completion_event() {
        let store_path = test_store_path("active_finish_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-finish-persist".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let mut events = parts.service.subscribe_events();
        let client = parts.service.connect_client();
        let active = parts
            .service
            .try_begin_run(Some(client.client_id().clone()), "prompt")
            .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );

        let started = events.recv().await.unwrap();
        assert_eq!(started.sequence_id, 1);
        assert_run_started_event(started, &active, "prompt");

        let saved_event = events.recv().await.unwrap();
        assert_eq!(saved_event.session_id.as_deref(), Some(session_id.as_str()));
        assert_eq!(saved_event.sequence_id, 2);
        assert_eq!(saved_event.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(saved_event.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            saved_event.event,
            SessionEvent::SnapshotSaved {
                session_id: session_id.clone()
            }
        );

        let completion = events.recv().await.unwrap();
        assert_eq!(completion.sequence_id, 3);
        assert_eq!(completion.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
        let duration_ms = match completion.event {
            SessionEvent::RunCompleted {
                response,
                duration_ms,
            } => {
                assert_eq!(response, "done");
                duration_ms.expect("completed run should include duration")
            }
            other => panic!("expected run completion, got {other:?}"),
        };

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(duration_ms));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(duration_ms)]));
        assert_eq!(
            loaded.messages.len(),
            parts.init.restored_messages.len() + 2
        );
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn finish_run_persists_token_usage() {
        let store_path = test_store_path("active_finish_token_usage");
        let client = ModelClient::new_for_test();
        let session_id = "session-finish-token-usage".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
            None,
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let active = parts
            .service
            .try_begin_run(None, "prompt")
            .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        let test_usage = crate::model::TokenUsage {
            input_tokens: 500,
            output_tokens: 120,
            cache_read_tokens: 80,
            cache_write_tokens: 15,
            reasoning_tokens: 0,
            orchestrator_context_tokens: 715,
        };
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), Some(test_usage.clone())),
                )
                .await
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.token_usages.len(), 1);
        let persisted = loaded.token_usages[0]
            .as_ref()
            .expect("token usage should be persisted");
        assert_eq!(persisted.input_tokens, 500);
        assert_eq!(persisted.output_tokens, 120);
        assert_eq!(persisted.cache_read_tokens, 80);
        assert_eq!(persisted.cache_write_tokens, 15);
        assert_eq!(persisted.orchestrator_context_tokens, 715);

        // Frontend snapshot should expose the usage
        let frontend = parts.service.frontend_snapshot().await.unwrap();
        assert_eq!(
            frontend
                .response_timing
                .last_token_usage
                .as_ref()
                .unwrap()
                .orchestrator_context_tokens,
            715
        );
        assert_eq!(
            frontend
                .response_timing
                .token_usages
                .as_ref()
                .unwrap()
                .len(),
            1
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn failed_run_persists_token_usage() {
        // Regression test: when a run fails (e.g. model API error after a tool
        // round that dispatched workers), the accumulated token usage —
        // including worker thread tokens — must still be persisted so it is
        // not permanently lost.
        let store_path = test_store_path("active_failed_token_usage");
        let client = ModelClient::new_for_test();
        let session_id = "session-failed-token-usage".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
            None,
            BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let active = parts
            .service
            .try_begin_run(None, "prompt")
            .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("partial response".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        // Simulate usage that was accumulated during the run (including
        // worker thread tokens from a prior tool round) before the run failed.
        let test_usage = crate::model::TokenUsage {
            input_tokens: 500,
            output_tokens: 120,
            cache_read_tokens: 80,
            cache_write_tokens: 15,
            reasoning_tokens: 0,
            orchestrator_context_tokens: 715,
        };
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Failed("model API error".to_string(), Some(test_usage.clone())),
                )
                .await
        );

        // The failed run should still persist the token usage.
        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.token_usages.len(), 1);
        let persisted = loaded.token_usages[0]
            .as_ref()
            .expect("token usage should be persisted even on failed run");
        assert_eq!(persisted.input_tokens, 500);
        assert_eq!(persisted.output_tokens, 120);
        assert_eq!(persisted.cache_read_tokens, 80);
        assert_eq!(persisted.cache_write_tokens, 15);
        assert_eq!(persisted.orchestrator_context_tokens, 715);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn completed_run_reports_failure_when_snapshot_persistence_fails() {
        let store_path = test_store_path("active_persist_failure");
        let store_parent = store_path.parent().unwrap().to_path_buf();
        std::fs::write(&store_parent, "not a directory").unwrap();
        let client = ModelClient::new_for_test();
        let session_id = "session-persist-failure".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id,
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: snapshot.session_id.clone(),
                store_path,
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });

        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "prompt".to_string(),
            });
            agent.messages.push(Message::Assistant {
                content: Some("done".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "prompt");

        let terminal = events.recv().await.unwrap();
        assert_eq!(terminal.sequence_id, 2);
        assert_eq!(terminal.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(terminal.client_id.as_ref(), active.client_id.as_ref());
        match terminal.event {
            SessionEvent::RunFailed { message } => {
                assert!(message.contains("run completed, but failed to persist session snapshot"));
                assert!(message.contains("failed to create store dir"));
            }
            other => panic!("expected run failure after persistence error, got {other:?}"),
        }
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_file(store_parent);
    }

    #[tokio::test]
    async fn subscribe_agent_events_filters_agent_envelopes() {
        let store_path = test_store_path("agent_event_adapter");
        let client = ModelClient::new_for_test();
        let session_id = "session-agent-events".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut agent_events = parts.service.subscribe_agent_events();
        let agent_event = AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "hello".to_string(),
        };

        parts.service.event_bus.emit(SessionEvent::SnapshotSaved {
            session_id: session_id.clone(),
        });
        parts.service.event_bus.emit_agent(agent_event.clone());

        assert_eq!(agent_events.recv().await, Some(agent_event));
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn client_subscribers_receive_same_events_with_unique_identity() {
        let parts = test_picker_service("client_subscribers");
        let first_client = parts.service.connect_client();
        let second_client = parts.service.connect_client();
        let mut first_events = first_client.subscribe_events();
        let mut second_events = second_client.subscribe_events();

        assert_ne!(first_client.client_id(), second_client.client_id());
        assert_eq!(&first_events.client_id, first_client.client_id());
        assert_eq!(&second_events.client_id, second_client.client_id());
        assert_ne!(first_events.subscription_id, second_events.subscription_id);

        let agent_event = AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "hello clients".to_string(),
        };
        parts.service.event_bus.emit_agent(agent_event.clone());

        let first = first_events.receiver.recv().await.unwrap();
        let second = second_events.receiver.recv().await.unwrap();
        assert_eq!(first, second);
        assert_eq!(first.sequence_id, 1);
        assert_eq!(first.event, SessionEvent::Agent { event: agent_event });
    }

    #[tokio::test]
    async fn frontend_snapshot_does_not_wait_for_agent_lock_while_active_run() {
        let parts = test_picker_service("snapshot_nonblocking");
        let agent_guard = parts.service.agent.lock().await;
        let active = parts.service.try_begin_run(None, "blocked prompt").unwrap();

        let snapshot = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            parts.service.frontend_snapshot(),
        )
        .await
        .expect("frontend snapshot should not wait for the held agent mutex")
        .unwrap();

        assert_eq!(snapshot.active_run, Some(active.clone()));
        let submitted = snapshot
            .active_run
            .as_ref()
            .and_then(|active_run| active_run.submitted_user_message.as_ref())
            .expect("active run should expose server-submitted user message");
        assert_eq!(submitted.run_id, active.run_id);
        assert_eq!(submitted.content, "blocked prompt");
        assert_eq!(submitted.baseline_user_message_count, Some(0));
        assert!(snapshot.messages.is_empty());

        drop(agent_guard);
        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Failed("cleanup".to_string(), None))
                .await
        );
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn mark_run_finishing_clears_submitted_user_message_before_persistence() {
        let store_path = test_store_path("active_pending_cleared_on_finish");
        let client = ModelClient::new_for_test();
        let session_id = "session-pending-clear".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts
            .service
            .try_begin_run(None, "persisted prompt")
            .unwrap();
        assert!(active.submitted_user_message.is_some());
        assert_eq!(parts.service.active_run(), Some(active.clone()));
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "persisted prompt".to_string(),
            });
        }

        let finishing = parts
            .service
            .mark_run_finishing(&active.run_id)
            .expect("run should transition to finishing");
        assert_eq!(finishing.snapshot.run_id, active.run_id);
        assert!(finishing.snapshot.submitted_user_message.is_none());
        let active_after_finishing = parts.service.active_run().unwrap();
        assert_eq!(active_after_finishing.run_id, active.run_id);
        assert!(active_after_finishing.submitted_user_message.is_none());

        let frontend_before_persist = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend_before_persist
            .active_run
            .as_ref()
            .unwrap()
            .submitted_user_message
            .is_none());
        assert!(matches!(
            frontend_before_persist.messages.last(),
            Some(Message::User { content }) if content == "persisted prompt"
        ));

        parts
            .service
            .persist_run_snapshot(&finishing.snapshot, Some(42), None)
            .await
            .unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "persisted prompt");
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let active_after_save = parts.service.active_run().unwrap();
        assert_eq!(active_after_save.run_id, active.run_id);
        assert!(active_after_save.submitted_user_message.is_none());

        let frontend_after_persist = parts.service.frontend_snapshot().await.unwrap();
        assert!(frontend_after_persist
            .active_run
            .as_ref()
            .unwrap()
            .submitted_user_message
            .is_none());
        assert!(matches!(
            frontend_after_persist.messages.last(),
            Some(Message::User { content }) if content == "persisted prompt"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn mark_run_cancelling_clears_submitted_user_message() {
        let parts = test_picker_service("active_pending_cleared_on_cancel");
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        assert!(active.submitted_user_message.is_some());

        let cancelling = parts
            .service
            .mark_run_cancelling(&active.run_id)
            .expect("run should transition to cancelling");

        assert_eq!(cancelling.snapshot.run_id, active.run_id);
        assert!(cancelling.snapshot.submitted_user_message.is_none());
        let active_after_cancelling = parts.service.active_run().unwrap();
        assert_eq!(active_after_cancelling.run_id, active.run_id);
        assert!(active_after_cancelling.submitted_user_message.is_none());
        let _ = std::fs::remove_dir_all(parts.init.metadata.store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn busy_run_rejects_concurrent_submission_and_clears_once() {
        let parts = test_picker_service("busy_rejection");
        let client = parts.service.connect_client();
        let mut events = parts.service.subscribe_events();
        let first = parts
            .service
            .try_begin_run(Some(client.client_id().clone()), "first prompt")
            .unwrap();

        assert_eq!(parts.service.active_run(), Some(first.clone()));
        let first_started = events.recv().await.unwrap();
        assert_eq!(first_started.sequence_id, 1);
        assert_run_started_event(first_started, &first, "first prompt");
        assert!(matches!(
            parts.service.try_begin_run(None, "second prompt"),
            Err(SessionSubmitError::Busy { active_run }) if active_run == first
        ));

        assert!(
            parts
                .service
                .finish_run_once(&first.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );
        let completion = events.recv().await.unwrap();
        assert_eq!(completion.sequence_id, 2);
        assert_eq!(completion.run_id.as_ref(), Some(&first.run_id));
        assert_eq!(completion.client_id.as_ref(), first.client_id.as_ref());
        assert!(matches!(
            completion.event,
            SessionEvent::RunCompleted {
                response,
                duration_ms: Some(_),
            } if response == "done"
        ));
        assert!(parts.service.active_run().is_none());

        assert!(
            !parts
                .service
                .finish_run_once(
                    &first.run_id,
                    RunOutcome::Completed("duplicate".to_string(), None)
                )
                .await
        );
        assert!(matches!(
            events.try_recv(),
            Err(tokio::sync::broadcast::error::TryRecvError::Empty)
        ));

        let second = parts.service.try_begin_run(None, "second prompt").unwrap();
        let second_started = events.recv().await.unwrap();
        assert_run_started_event(second_started, &second, "second prompt");
        assert!(
            parts
                .service
                .finish_run_once(&second.run_id, RunOutcome::Failed("boom".to_string(), None))
                .await
        );
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&second.run_id));
        assert!(failed.client_id.is_none());
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "boom".to_string()
            }
        );
        assert!(parts.service.active_run().is_none());
    }

    #[tokio::test]
    async fn failed_run_persists_messages_without_recording_new_duration() {
        let store_path = test_store_path("active_failed_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-failed-persist".to_string();
        let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        agent.messages.push(Message::User {
            content: "old prompt".to_string(),
        });
        agent.messages.push(Message::Assistant {
            content: Some("old response".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        });
        let mut snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        snapshot.last_response_duration_ms = Some(123);
        snapshot.response_durations_ms = Some(vec![Some(123)]);
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "failed prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "failed prompt".to_string(),
            });
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Failed("boom".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "failed prompt");
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "boom".to_string()
            }
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(123));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(123)]));
        assert_eq!(
            loaded.messages.len(),
            parts.init.restored_messages.len() + 1
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn request_cancel_persists_marker_and_emits_terminal_event() {
        let store_path = test_store_path("active_cancel_persist");
        let client = ModelClient::new_for_test();
        let session_id = "session-cancel-persist".to_string();
        let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        let snapshot = sessions::new_snapshot(
            session_id.clone(),
            PathBuf::from("/repo"),
            client.model.clone(),
            client.base_url().to_string(),
            client.backend(),
            client.reasoning_effort(),
            None,
            None,
            agent.messages.clone(),
        None,
        BTreeMap::new(),
        );
        sessions::create_session(&store_path, &snapshot).unwrap();
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Active {
                session_id: session_id.clone(),
                store_path: store_path.clone(),
                snapshot,
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "cancel prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent.messages.push(Message::User {
                content: "cancel prompt".to_string(),
            });
        }

        parts.service.request_cancel(&active.run_id).await.unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "cancel prompt");
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "run cancelled by user".to_string()
            }
        );
        assert!(parts.service.active_run().is_none());

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert!(matches!(
            loaded.messages.last(),
            Some(Message::Assistant {
                content: Some(content),
                ..
            }) if content == "[run cancelled by user]"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn finish_run_without_active_session_snapshot_emits_completion_without_saving() {
        let store_path = test_store_path("picker_noop");
        let client = ModelClient::new_for_test();
        let agent = test_agent(client.clone(), store_path.clone(), None);
        let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
            agent,
            client,
            session: OrchestratorSession::Picker {
                store_path: store_path.clone(),
            },
            sandbox_status: "off".to_string(),
            agents_md_status: "off".to_string(),
            workspace_display: "/repo".to_string(),
            workspace_host_path: Some(PathBuf::from("/repo")),
            resume_base_cwd: PathBuf::from("/repo"),
        });
        let mut events = parts.service.subscribe_events();
        let active = parts.service.try_begin_run(None, "prompt").unwrap();

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Completed("done".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "prompt");
        let completion = events.recv().await.unwrap();
        assert_eq!(completion.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(
            completion.event,
            SessionEvent::RunCompleted {
                response,
                duration_ms: Some(_),
            } if response == "done"
        ));
        assert!(events.try_recv().is_err());
        assert!(!store_path.exists());
    }
}
