use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, Mutex},
    task::JoinHandle,
};
use uuid::Uuid;

use crate::agent::Agent;
use crate::commands::{self, PreparedPrompt, PreparedUserInput};
use crate::events::{
    AgentEvent, CompactionFailure, CompactionReason, EventSink, SessionEvent, SessionEventBoundary,
    SessionEventBus,
};
pub use crate::events::{
    SessionClientId, SessionEventEnvelope, SessionEventReceiver, SessionEventReplaySubscription,
    SessionEventSubscription, SessionRunId, SessionSubscriptionId, SubmittedUserMessageSnapshot,
};
use crate::runtime::{OrchestratorRunConfig, OrchestratorSession};
use crate::sessions::{self, SessionSnapshot};
use crate::types::Message;
use crate::view::{
    self, EpisodeSnapshot, SessionSummarySnapshot, ThreadSnapshot, WorksetSnapshot,
    WorksetSummarySnapshot, WorksetsSnapshot, WorkspaceSnapshot,
};

mod manual_compaction;

use manual_compaction::ActiveCompactionState;
pub use manual_compaction::{
    SessionCompactionAdmissionError, SessionCompactionError, SessionCompactionHandle,
    SessionCompactionResult, SessionCoordinationError, SessionOperationBusy,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActiveCompactionSnapshot {
    pub compaction_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    pub started_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ActiveSessionOperationSnapshot {
    Run {
        run: ActiveRunSnapshot,
    },
    ManualCompaction {
        compaction: ActiveCompactionSnapshot,
    },
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_compaction: Option<ActiveCompactionSnapshot>,
    pub sessions: Vec<SessionSummarySnapshot>,
    #[serde(default)]
    pub active_threads: Vec<String>,
    pub threads: Vec<ThreadSnapshot>,
    pub thread_episodes: HashMap<String, Vec<EpisodeSnapshot>>,
    #[serde(default)]
    pub thread_events: HashMap<String, Vec<AgentEvent>>,
    pub thread_event_boundary: SessionEventBoundary,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub thread_event_diagnostics: Vec<ThreadEventDecodeDiagnostic>,
    #[serde(default)]
    pub thread_steering: Vec<crate::store::ThreadSteeringRecord>,
    /// Delivered orchestrator steering records whose verbatim user message is
    /// already present in the transcript source backing this snapshot. The
    /// frontend hides those records so guidance renders exactly once — as the
    /// canonical user message.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub covered_orchestrator_steering_ids: Vec<i64>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_event_boundary: Option<SessionEventBoundary>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ThreadEventDecodeDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ThreadEventDecodeDiagnostic {
    pub id: i64,
    pub thread_name: String,
    pub created_at: String,
    pub error: String,
}

const MAX_THREAD_EVENT_DIAGNOSTICS: usize = 64;

struct DecodedThreadEvents {
    events: HashMap<String, Vec<AgentEvent>>,
    diagnostics: Vec<ThreadEventDecodeDiagnostic>,
}

struct FrontendSnapshotBlockingLoad {
    sessions: Vec<SessionSummarySnapshot>,
    threads: Vec<ThreadSnapshot>,
    thread_episodes: HashMap<String, Vec<EpisodeSnapshot>>,
    thread_events: DecodedThreadEvents,
    thread_event_boundary: SessionEventBoundary,
    thread_steering: Vec<crate::store::ThreadSteeringRecord>,
    worksets: WorksetsSnapshot,
    workspace: WorkspaceSnapshot,
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
    ExternalBusy { session_id: SessionOperationBusy },
    Coordination { message: SessionCoordinationError },
}

impl std::fmt::Display for SessionSubmitError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { active_run } => write!(
                formatter,
                "session is busy with run {} ({})",
                active_run.run_id, active_run.prompt_preview
            ),
            Self::ExternalBusy {
                session_id: SessionOperationBusy::Local { .. },
            } => formatter.write_str("session is busy with a local compaction"),
            Self::ExternalBusy {
                session_id: SessionOperationBusy::External { session_id },
            } => write!(
                formatter,
                "session '{session_id}' is busy with an active operation in another process"
            ),
            Self::Coordination { message } => message.fmt(formatter),
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
        lease: sessions::SessionOperationLease,
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
    metadata: Arc<SessionMetadata>,
    config_version: Option<i64>,
    session_snapshot: Arc<Mutex<Option<SessionSnapshot>>>,
    /// Shared transcript log writer (orchestrator sessions only). Read paths
    /// go through the same connection as the agent's appends, so store-backed
    /// transcript reads serialize against commit points (step 3).
    transcript_log: Option<Arc<crate::store::TranscriptLogWriter>>,
    /// Incremental scan of the merged store transcript (snapshot blob ++ log
    /// tail), rebuilt from the restored transcript at construction and
    /// advanced over newly appended rows only. Drives steering coverage and
    /// message-cycle metadata without rescanning history per snapshot.
    transcript_scan: Arc<StdMutex<TranscriptScanCache>>,
    event_bus: SessionEventBus,
    active_operation: Arc<StdMutex<Option<ActiveSessionOperation>>>,
    active_threads: Arc<crate::tools::ActiveThreadRegistry>,
}

enum ActiveSessionOperation {
    Run(ActiveRunState),
    ManualCompaction(ActiveCompactionState),
}

impl ActiveSessionOperation {
    fn snapshot(&self) -> ActiveSessionOperationSnapshot {
        match self {
            Self::Run(run) => ActiveSessionOperationSnapshot::Run {
                run: run.snapshot.clone(),
            },
            Self::ManualCompaction(compaction) => {
                ActiveSessionOperationSnapshot::ManualCompaction {
                    compaction: compaction.snapshot.clone(),
                }
            }
        }
    }
}

struct ActiveRunState {
    snapshot: ActiveRunSnapshot,
    started_at: Instant,
    finishing: bool,
    task: Option<JoinHandle<()>>,
    /// Visible-response count of the store transcript at run start,
    /// captured by the run task before its first append (step 4,
    /// never-fold): the diff base for the run-end token/timing bookkeeping.
    /// `None` until the task captures it — an early cancel then diffs
    /// against the run-end count, which is exact when nothing was appended.
    transcript_baseline: Option<usize>,
    _operation_lease: Option<sessions::SessionOperationLease>,
}

struct FinishingRun {
    snapshot: ActiveRunSnapshot,
    duration_ms: u64,
    transcript_baseline: Option<usize>,
}

struct CancellingRun {
    snapshot: ActiveRunSnapshot,
    task: Option<JoinHandle<()>>,
    transcript_baseline: Option<usize>,
}

enum RunOutcome {
    Completed(String, Option<crate::model::TokenUsage>),
    Failed(String, Option<crate::model::TokenUsage>),
}

enum OperationAdmissionPreparationError {
    ExternalBusy { session_id: String },
    Coordination { message: SessionCoordinationError },
}

/// Incremental scan of the merged store transcript (snapshot blob ++
/// transcript log tail). Rebuilt from the restored transcript at service
/// construction, then advanced over newly appended rows only (append-only ⇒
/// a scanned position's User-message content never changes: crash/cancel
/// normalization trims only dangling Assistant/Tool tail messages, and
/// compaction rewrites the provider view, never the transcript).
///
/// The counts survive scan-cursor rewinds (a shrinking merged length) for
/// the same reason: `truncate_incomplete_tool_turn` trims only
/// assistant-with-tool-calls and tool-result tails, never User messages and
/// never visible responses (assistant messages without tool calls). A
/// straggler row from an aborted append that is scanned in the cancel
/// window before its `delete_from` would overcount — the same accepted
/// imprecision class as `user_copies` (step 3).
#[derive(Default)]
struct TranscriptScanCache {
    /// Raw merged-transcript length scanned so far.
    scanned_len: usize,
    user_count: usize,
    last_user_idx: Option<usize>,
    /// User message content → surviving copy count. Drives steering coverage
    /// with newest-first pairing (see `covered_orchestrator_steering_ids`).
    user_copies: HashMap<String, usize>,
    /// Assistant messages with no tool calls (user-visible responses).
    /// Diffed between run start and run end for the run-end token/timing
    /// bookkeeping (step 4, never-fold): the snapshot blob is never
    /// rewritten at run end, so the old-vs-new vec diff became a
    /// store-count diff.
    visible_response_count: usize,
}

impl TranscriptScanCache {
    fn from_transcript(messages: &[Message]) -> Self {
        let mut cache = Self::default();
        for (idx, message) in messages.iter().enumerate() {
            cache.scan_message(idx, message);
        }
        cache.scanned_len = messages.len();
        cache
    }

    fn scan_message(&mut self, idx: usize, message: &Message) {
        if let Message::User { content } = message {
            self.user_count += 1;
            self.last_user_idx = Some(idx);
            *self.user_copies.entry(content.clone()).or_insert(0) += 1;
        }
        if is_visible_response(message) {
            self.visible_response_count += 1;
        }
    }
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

        let event_bus =
            SessionEventBus::with_thread_event_store(session_id.clone(), store_path.clone());
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
        let transcript_log = run_config.agent.transcript_log_writer();
        // The restored transcript is exactly the store transcript (blob ++
        // log tail) at construction, so the initial scan is an in-memory
        // pass; later scans read only the newly appended tail rows.
        let transcript_scan = if transcript_log.is_some() {
            TranscriptScanCache::from_transcript(&restored_messages)
        } else {
            TranscriptScanCache::default()
        };
        let service = Self {
            agent: Arc::new(Mutex::new(run_config.agent)),
            metadata: Arc::new(metadata.clone()),
            config_version,
            session_snapshot: Arc::new(Mutex::new(session_snapshot)),
            transcript_log,
            transcript_scan: Arc::new(StdMutex::new(transcript_scan)),
            event_bus,
            active_operation: Arc::new(StdMutex::new(None)),
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

    pub fn active_operation(&self) -> Option<ActiveSessionOperationSnapshot> {
        self.lock_active_operation()
            .as_ref()
            .map(ActiveSessionOperation::snapshot)
    }

    pub fn has_active_operation(&self) -> bool {
        self.lock_active_operation().is_some()
    }

    pub fn active_run(&self) -> Option<ActiveRunSnapshot> {
        match self.lock_active_operation().as_ref() {
            Some(ActiveSessionOperation::Run(active_run)) => Some(active_run.snapshot.clone()),
            _ => None,
        }
    }

    pub fn active_compaction(&self) -> Option<ActiveCompactionSnapshot> {
        match self.lock_active_operation().as_ref() {
            Some(ActiveSessionOperation::ManualCompaction(active_compaction)) => {
                Some(active_compaction.snapshot.clone())
            }
            _ => None,
        }
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
        let mut names = self.active_threads.names();
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
        let record = self
            .active_threads
            .queue(
                &self.metadata.store_path,
                session_id,
                thread_name,
                instruction,
            )?
            .ok_or_else(|| {
                anyhow::anyhow!("thread '{thread_name}' is not active in this session")
            })?;
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
        let active_operation = self.lock_active_operation();
        let dispatch_id = match active_operation.as_ref() {
            Some(ActiveSessionOperation::Run(run)) if !run.finishing => {
                run.snapshot.run_id.as_str()
            }
            Some(ActiveSessionOperation::Run(_)) => {
                return Err(anyhow::anyhow!("session active run is finishing"));
            }
            _ => return Err(anyhow::anyhow!("session has no active run")),
        };
        let record = crate::store::queue_thread_steering(
            &self.metadata.store_path,
            session_id,
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            dispatch_id,
            instruction,
        )?;
        drop(active_operation);
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

    fn load_all_thread_events_with_connection(
        &self,
        conn: &rusqlite::Connection,
        per_thread_limit: usize,
    ) -> Result<DecodedThreadEvents> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(DecodedThreadEvents {
                events: HashMap::new(),
                diagnostics: Vec::new(),
            });
        };
        let records = crate::store::load_all_thread_events_with_connection(
            conn,
            session_id,
            per_thread_limit,
        )?;
        Ok(decode_thread_events(records))
    }

    fn load_frontend_snapshot_blocking(
        &self,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<FrontendSnapshotBlockingLoad> {
        let (
            sessions,
            threads,
            thread_episodes,
            thread_events,
            thread_event_boundary,
            thread_steering,
            worksets,
        ) = {
            let conn = crate::store::open_runtime_connection(&self.metadata.store_path)?;
            let session_id = self.metadata.session_id.as_deref();
            let thread_steering = session_id
                .map(|session_id| {
                    crate::store::list_thread_steering_with_connection(&conn, session_id)
                })
                .transpose()?
                .unwrap_or_default();
            let (thread_event_boundary, thread_events) =
                self.event_bus.thread_event_boundary(|| {
                    self.load_all_thread_events_with_connection(&conn, options.thread_event_limit)
                })?;
            (
                if options.include_sessions {
                    view::list_sessions_with_connection(&conn)?
                } else {
                    Vec::new()
                },
                view::list_threads_with_connection(&conn, session_id)?,
                view::load_all_thread_episodes_with_connection(&conn, session_id)?,
                thread_events,
                thread_event_boundary,
                thread_steering,
                view::worksets_snapshot_with_connection(&conn, session_id),
            )
        };
        let workspace = view::workspace_snapshot(
            &self.metadata.cwd,
            self.metadata.workspace_host_path.as_deref(),
        );
        Ok(FrontendSnapshotBlockingLoad {
            sessions,
            threads,
            thread_episodes,
            thread_events,
            thread_event_boundary,
            thread_steering,
            worksets,
            workspace,
        })
    }
}

fn decode_thread_events(
    records: HashMap<String, Vec<crate::store::ThreadEventRecord>>,
) -> DecodedThreadEvents {
    let mut events = HashMap::new();
    let mut diagnostics = Vec::new();
    for (thread_name, records) in records {
        let decoded = records
            .into_iter()
            .filter_map(|record| decode_thread_event(record, &mut diagnostics))
            .collect::<Vec<_>>();
        if !decoded.is_empty() {
            events.insert(thread_name, decoded);
        }
    }
    DecodedThreadEvents {
        events,
        diagnostics,
    }
}

impl SessionService {
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
        let load = || {
            crate::store::load_thread_events_page(
                &self.metadata.store_path,
                session_id,
                thread_name,
                before_id,
                limit,
            )
        };
        let (thread_event_boundary, (records, has_older)) = if before_id.is_none() {
            let (boundary, records) = self.event_bus.thread_event_boundary(load)?;
            (Some(boundary), records)
        } else {
            (None, load()?)
        };
        let next_before_id = records.last().map(|record| record.id);
        let mut diagnostics = Vec::new();
        let events = records
            .into_iter()
            .filter_map(|record| {
                let id = record.id;
                let created_at = record.created_at.clone();
                decode_thread_event(record, &mut diagnostics).map(|event| ThreadEventPageItem {
                    id,
                    created_at,
                    event,
                })
            })
            .collect();
        Ok(ThreadEventPage {
            next_before_id,
            events,
            has_older,
            thread_event_boundary,
            diagnostics,
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
        // SQLite and git are synchronous. Keep all dashboard storage reads on
        // one connection and move that connection plus git subprocesses off
        // the async runtime workers. Load steering before the transcript so a
        // concurrently delivered record is either absent here or coverable by
        // the subsequent transcript scan, never rendered twice.
        let blocking_service = self.clone();
        let blocking_task = tokio::task::spawn_blocking(move || {
            blocking_service.load_frontend_snapshot_blocking(options)
        });
        let (active_threads, blocking) = tokio::join!(self.active_thread_names(), blocking_task);
        let blocking = blocking
            .map_err(|error| anyhow::anyhow!("frontend snapshot load task failed: {error}"))??;

        // Store-backed transcript reads (step 3): the snapshot blob (legacy
        // prefix) ++ the transcript log tail, ALWAYS. The agent-or-persisted
        // duality and the stale-during-run fallback are gone — mid-run
        // appends are visible as they commit to the log.
        self.update_transcript_scan().await?;
        let response_timing = {
            let snapshot = self.session_snapshot.lock().await;
            ResponseTimingSnapshot::from_session_snapshot(snapshot.as_ref())
        };
        let loaded_messages = match options.messages {
            FrontendSnapshotMessages::All => LoadedFrontendMessages {
                messages: self.store_backed_transcript().await?,
                page: None,
                cycle: None,
            },
            FrontendSnapshotMessages::Page(request) => {
                let page = self.page_store_transcript(request).await?;
                let cycle = self.message_cycle_from_store().await?;
                LoadedFrontendMessages {
                    messages: page.messages,
                    page: Some(page.page),
                    cycle: Some(cycle),
                }
            }
        };

        let covered_orchestrator_steering_ids = {
            let scan = self.lock_transcript_scan();
            covered_ids_from_scan(&blocking.thread_steering, &scan)
        };
        let mut metadata = self.metadata();
        metadata.extra_headers.clear();
        let snapshot = SessionFrontendSnapshot {
            metadata,
            messages: loaded_messages.messages,
            response_timing,
            active_run: self.active_run(),
            active_compaction: self.active_compaction(),
            sessions: blocking.sessions,
            active_threads,
            threads: blocking.threads,
            thread_episodes: blocking.thread_episodes,
            thread_events: blocking.thread_events.events,
            thread_event_boundary: blocking.thread_event_boundary,
            thread_event_diagnostics: blocking.thread_events.diagnostics,
            thread_steering: blocking.thread_steering,
            covered_orchestrator_steering_ids,
            worksets: blocking.worksets,
            workspace: blocking.workspace,
        };
        Ok(SessionFrontendSnapshotLoad {
            snapshot,
            message_page: loaded_messages.page,
            message_cycle: loaded_messages.cycle,
        })
    }

    fn lock_transcript_scan(&self) -> std::sync::MutexGuard<'_, TranscriptScanCache> {
        self.transcript_scan
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Read a window of the transcript log tail relative to a snapshot blob
    /// of `blob_len` messages via the shared writer (atomic extent + window
    /// read, so a concurrent commit-point append cannot shift the window).
    /// `(0, [])` for services without a transcript log (pickers).
    async fn read_log_tail_window(
        &self,
        blob_len: usize,
        tail_start: usize,
        limit: usize,
    ) -> Result<(usize, Vec<(u64, Message)>)> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok((0, Vec::new()));
        };
        tokio::task::spawn_blocking(move || {
            writer.read_tail_window(&session_id, blob_len as u64, tail_start as u64, limit)
        })
        .await
        .map_err(|error| anyhow::anyhow!("transcript log tail read task failed: {error}"))?
        .map(|(tail_len, rows)| (tail_len as usize, rows))
    }

    /// Read the full transcript log tail relative to a snapshot blob of
    /// `blob_len` messages via the shared writer. `[]` for services without
    /// a transcript log (pickers).
    async fn read_log_tail(&self, blob_len: usize) -> Result<Vec<(u64, Message)>> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok(Vec::new());
        };
        tokio::task::spawn_blocking(move || writer.read_tail_from(&session_id, blob_len as u64))
            .await
            .map_err(|error| anyhow::anyhow!("transcript log tail read task failed: {error}"))?
    }

    /// The merged store transcript: the snapshot blob (authoritative legacy
    /// prefix) ++ the transcript log tail (rows with `idx >= blob_len`).
    /// This is exactly the agent's in-memory transcript, mid-run and
    /// post-run alike — never-fold (step 4): the blob is write-once and the
    /// tail only grows, run end no longer folds the log into the blob.
    async fn store_backed_transcript(&self) -> Result<Vec<Message>> {
        let (blob_len, mut messages) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            (blob.len(), blob.to_vec())
        };
        let tail = self.read_log_tail(blob_len).await?;
        messages.extend(tail.into_iter().map(|(_, message)| message));
        Ok(messages)
    }

    /// Page the merged store transcript without decoding rows outside the
    /// requested visible window. Visible↔raw mapping: the blob contributes
    /// `blob_visible` visible messages (all but the system head), and every
    /// log row is visible (no commit point ever logs a System message), so
    /// visible index `v >= blob_visible` is the tail row with
    /// `idx = blob_len + (v - blob_visible)`.
    async fn page_store_transcript(
        &self,
        request: MessagePageRequest,
    ) -> Result<MessagesPageSnapshot> {
        let include_system = request.include_system;
        let is_visible =
            |message: &&Message| include_system || !matches!(message, Message::System { .. });
        let (blob_len, blob_visible) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            (blob.len(), blob.iter().filter(is_visible).count())
        };
        let (tail_len, _) = self.read_log_tail_window(blob_len, 0, 0).await?;
        let total = blob_visible + tail_len;
        let end = request.before.unwrap_or(total).min(total);
        let limit = request.limit.max(1);
        let start = end.saturating_sub(limit);

        let blob_end = end.min(blob_visible);
        let blob_part: Vec<Message> = if start < blob_end {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            blob.iter()
                .filter(is_visible)
                .skip(start)
                .take(blob_end - start)
                .cloned()
                .collect()
        } else {
            Vec::new()
        };
        let log_part: Vec<Message> = if end > blob_visible {
            let tail_start = start.saturating_sub(blob_visible);
            let (_, rows) = self
                .read_log_tail_window(blob_len, tail_start, end - blob_visible - tail_start)
                .await?;
            rows.into_iter().map(|(_, message)| message).collect()
        } else {
            Vec::new()
        };
        let mut messages = blob_part;
        messages.extend(log_part);
        Ok(MessagesPageSnapshot {
            messages,
            page: MessagePageMetadata {
                start,
                end,
                total,
                has_older: start > 0,
            },
        })
    }

    /// Advance the incremental transcript scan over newly appended rows.
    /// The delta is read from the store: the log window past the scanned
    /// cursor, plus the blob part when the blob grew past it — dead in
    /// production since step 4 (never-fold: the blob is write-once), kept
    /// for tests that reseed the blob. Positions already consumed by a
    /// concurrent update are skipped. A shrinking merged length means
    /// crash/cancel normalization trimmed a dangling (non-User) tail: the
    /// scan cursor rewinds, counts are unaffected.
    async fn update_transcript_scan(&self) -> Result<()> {
        if self.transcript_log.is_none() {
            return Ok(());
        }
        let scanned_len = self.lock_transcript_scan().scanned_len;
        let (blob_len, blob_delta) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            let blob_len = blob.len();
            let delta = if scanned_len < blob_len {
                blob[scanned_len..blob_len].to_vec()
            } else {
                Vec::new()
            };
            (blob_len, delta)
        };
        let tail_start = scanned_len.saturating_sub(blob_len);
        let (tail_len, rows) = self
            .read_log_tail_window(blob_len, tail_start, usize::MAX)
            .await?;
        let merged_len = blob_len + tail_len;
        let mut cache = self.lock_transcript_scan();
        if merged_len < cache.scanned_len {
            cache.scanned_len = merged_len;
            return Ok(());
        }
        let mut position = scanned_len;
        for message in blob_delta
            .iter()
            .chain(rows.iter().map(|(_, message)| message))
        {
            if position >= cache.scanned_len {
                cache.scan_message(position, message);
                cache.scanned_len = position + 1;
            }
            position += 1;
        }
        Ok(())
    }

    /// Message-cycle metadata from the store transcript: counts come from
    /// the incremental scan cache; thread names come from a bounded tail
    /// scan of the messages after the latest user message (one cycle).
    async fn message_cycle_from_store(&self) -> Result<MessageCycleMetadata> {
        let (user_count, last_user_idx) = {
            let cache = self.lock_transcript_scan();
            (cache.user_count, cache.last_user_idx)
        };
        let Some(last_user_idx) = last_user_idx else {
            return Ok(MessageCycleMetadata {
                marker: "none".to_string(),
                thread_names: Vec::new(),
            });
        };
        let (blob_len, mut after) = {
            let snapshot = self.session_snapshot.lock().await;
            let blob = snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.as_slice())
                .unwrap_or_default();
            let blob_len = blob.len();
            let start = (last_user_idx + 1).min(blob_len);
            (blob_len, blob[start..blob_len].to_vec())
        };
        let (_, rows) = self
            .read_log_tail_window(
                blob_len,
                (last_user_idx + 1).saturating_sub(blob_len),
                usize::MAX,
            )
            .await?;
        after.extend(rows.into_iter().map(|(_, message)| message));
        Ok(MessageCycleMetadata {
            marker: format!("history:{user_count}:{last_user_idx}"),
            thread_names: thread_tool_call_names(&after),
        })
    }

    /// Returns the freshest orchestrator messages available without building
    /// the considerably larger frontend snapshot: the merged store
    /// transcript (snapshot blob ++ transcript log tail), live mid-run.
    pub async fn messages_snapshot(&self) -> Result<Vec<Message>> {
        self.store_backed_transcript().await
    }

    /// Pages the merged store transcript without cloning or decoding
    /// messages outside the requested visible window. Callers remain
    /// responsible for any transport-specific maximum; a zero limit retains
    /// the web API's minimum page size of one.
    pub async fn messages_page(&self, request: MessagePageRequest) -> Result<MessagesPageSnapshot> {
        self.page_store_transcript(request).await
    }

    fn prepare_operation_admission(
        &self,
        supplied_lease: Option<sessions::SessionOperationLease>,
    ) -> std::result::Result<
        Option<sessions::SessionOperationLease>,
        OperationAdmissionPreparationError,
    > {
        let operation_lease = match (supplied_lease, self.metadata.session_id.as_deref()) {
            (Some(lease), Some(session_id)) => {
                lease
                    .validate(&self.metadata.store_path, session_id)
                    .map_err(|error| match error {
                        sessions::SessionOperationLeaseValidationError::IdentityMismatch => {
                            OperationAdmissionPreparationError::Coordination {
                                message: SessionCoordinationError::invalid_lease(),
                            }
                        }
                        sessions::SessionOperationLeaseValidationError::Store(error) => {
                            OperationAdmissionPreparationError::Coordination {
                                message: SessionCoordinationError::store(format!(
                                    "failed to validate session operation lease: {error:#}"
                                )),
                            }
                        }
                    })?;
                Some(lease)
            }
            (Some(_), None) => {
                return Err(OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::invalid_lease(),
                });
            }
            (None, Some(session_id)) => Some(
                sessions::SessionOperationLease::try_acquire(&self.metadata.store_path, session_id)
                    .map_err(|error| match error {
                        sessions::SessionOperationLeaseError::Busy(session_id) => {
                            OperationAdmissionPreparationError::ExternalBusy { session_id }
                        }
                        sessions::SessionOperationLeaseError::Store(error) => {
                            OperationAdmissionPreparationError::Coordination {
                                message: SessionCoordinationError::store(format!(
                                    "session operation coordination failed: {error:#}"
                                )),
                            }
                        }
                    })?,
            ),
            // Picker services have no runnable persisted session. Keeping this
            // path lease-free supports read-only picker construction.
            (None, None) => None,
        };

        if let (Some(session_id), Some(service_version)) =
            (self.metadata.session_id.as_deref(), self.config_version)
        {
            let persisted_version =
                sessions::load_session_config(&self.metadata.store_path, session_id)
                    .map_err(|error| OperationAdmissionPreparationError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to verify session configuration revision: {error:#}"
                        )),
                    })?
                    .config_version;
            if persisted_version != service_version {
                return Err(OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::stale_configuration(session_id),
                });
            }
        }

        // The caller holds the local operation-state lock and the lease above
        // excludes other processes. Refresh before publishing active state so
        // every run and manual compaction starts from the newest valid durable
        // checkpoint, including direct callers.
        if operation_lease.is_some() {
            let mut agent = self.agent.try_lock().map_err(|_| {
                OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::local_agent_busy(),
                }
            })?;
            agent.restore_compaction_checkpoint().map_err(|error| {
                OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to reload compaction checkpoint: {error:#}"
                    )),
                }
            })?;
        }

        Ok(operation_lease)
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
        lease: sessions::SessionOperationLease,
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

        self.expire_orchestrator_steering(&cancelling_run.snapshot.run_id);
        self.close_active_thread_dispatches();

        // Capture partial token usage from the cancelled run, including a
        // committed compaction projection when cancellation happened before
        // the following ordinary call completed.
        let cancel_usage = self.append_cancellation_message().await;

        let message = "run cancelled by user".to_string();
        let persistence_error = match self
            .persist_run_snapshot(
                &cancelling_run.snapshot,
                cancelling_run.transcript_baseline,
                None,
                cancel_usage,
            )
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
        operation_lease: Option<sessions::SessionOperationLease>,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        let active_run =
            self.try_begin_run_with_lease(client_id, &expanded_prompt, operation_lease)?;
        let run_id = active_run.run_id.clone();
        let task_run_id = run_id.clone();
        let run_client_id = active_run.client_id.clone();
        let event_bus = self.event_bus.clone();
        let service = self.clone();
        let task = tokio::spawn(async move {
            // Step 4 (never-fold): capture the run-start visible-response
            // count from the store transcript BEFORE this run's first
            // append. It is the diff base for the run-end token/timing
            // bookkeeping, which no longer has an old-vs-new messages vec
            // to diff. Best-effort: the run-end persist falls back to the
            // run-end count when this fails.
            if let Err(error) = service.update_transcript_scan().await {
                eprintln!(
                    "nac: failed to capture the transcript baseline for run {task_run_id}: {error:#}"
                );
            }
            let baseline = service.lock_transcript_scan().visible_response_count;
            service.set_run_transcript_baseline(&task_run_id, baseline);
            let (result, usage) = {
                let mut agent = service.agent.lock().await;
                agent.set_event_sink(EventSink::bus_with_context(
                    event_bus.clone(),
                    Some(task_run_id.clone()),
                    run_client_id.clone(),
                ));
                agent.set_steering_dispatch_id(Some(task_run_id.to_string()));
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
        supplied_lease: Option<sessions::SessionOperationLease>,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        self.try_begin_run_inner(client_id, expanded_prompt, supplied_lease, true)
    }

    fn try_begin_run_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionOperationLease>,
        enforce_coordination: bool,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        let mut guard = self.lock_active_operation();
        match guard.as_ref() {
            Some(ActiveSessionOperation::Run(active_run)) => {
                return Err(SessionSubmitError::Busy {
                    active_run: active_run.snapshot.clone(),
                });
            }
            Some(ActiveSessionOperation::ManualCompaction(active)) => {
                return Err(SessionSubmitError::ExternalBusy {
                    session_id: SessionOperationBusy::Local {
                        session_id: self
                            .metadata
                            .session_id
                            .clone()
                            .unwrap_or_else(|| "unavailable".to_string()),
                        active_operation: ActiveSessionOperationSnapshot::ManualCompaction {
                            compaction: active.snapshot.clone(),
                        },
                    },
                });
            }
            None => {}
        }

        let operation_lease = if enforce_coordination {
            self.prepare_operation_admission(supplied_lease)
                .map_err(|error| match error {
                    OperationAdmissionPreparationError::ExternalBusy { session_id } => {
                        SessionSubmitError::ExternalBusy {
                            session_id: SessionOperationBusy::External { session_id },
                        }
                    }
                    OperationAdmissionPreparationError::Coordination { message } => {
                        SessionSubmitError::Coordination { message }
                    }
                })?
        } else {
            None
        };

        if enforce_coordination {
            if let Some(session_id) = self.metadata.session_id.as_deref() {
                let mut expired =
                    crate::store::expire_session_steering(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to recover stale steering: {error:#}"
                            )),
                        })?;
                expired.extend(
                    self.active_threads
                        .close_all(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to clear stale worker targets: {error:#}"
                            )),
                        })?,
                );
                self.emit_steering_expired(expired);
            }
        }

        let run_id = SessionRunId::new();
        let submitted_at_epoch_ms = now_epoch_ms();
        let submitted_user_message = SubmittedUserMessageSnapshot {
            run_id: run_id.clone(),
            client_id: client_id.clone(),
            content: expanded_prompt.to_string(),
            submitted_at_epoch_ms,
        };
        let active_run = ActiveRunSnapshot {
            run_id,
            client_id,
            prompt_preview: prompt_preview(expanded_prompt, 160),
            submitted_user_message: Some(submitted_user_message),
            started_at_epoch_ms: submitted_at_epoch_ms,
        };
        *guard = Some(ActiveSessionOperation::Run(ActiveRunState {
            snapshot: active_run.clone(),
            started_at: Instant::now(),
            finishing: false,
            task: None,
            transcript_baseline: None,
            _operation_lease: operation_lease,
        }));
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
        self.expire_orchestrator_steering(run_id);
        if matches!(outcome, RunOutcome::Failed(..)) {
            self.normalize_failed_run_transcript().await;
        }
        let (completed_duration_ms, completed_usage) = match &outcome {
            RunOutcome::Completed(_, usage) => (Some(finishing_run.duration_ms), usage.clone()),
            RunOutcome::Failed(_, usage) => (None, usage.clone()),
        };
        let persistence_error = match self
            .persist_run_snapshot(
                &finishing_run.snapshot,
                finishing_run.transcript_baseline,
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

    /// Run-failure transcript normalization: a run that fails at the
    /// tool-result commit point leaves a dangling assistant tool-call turn
    /// in the long-lived agent's transcript AND the transcript log (the
    /// assistant message committed to both; its tool results are in
    /// neither). The next run reuses this agent — restore-time
    /// normalization only runs at session admission — and providers reject
    /// a transcript whose assistant tool calls have no tool results, so
    /// every subsequent run would fail at the model call until re-attach.
    /// Trim the dangling turn from the vec and the log before the run-end
    /// bookkeeping reads the store. Done here rather than at the failing
    /// commit point so every commit-point failure is covered uniformly,
    /// mirroring the cancel path's terminal normalization
    /// (`append_cancellation_message`). Best-effort: a log failure here
    /// must not mask the run failure; the next restore re-normalizes the
    /// stale tail. Prompt/assistant append failures need no normalization
    /// (log-first: those messages are in neither store).
    async fn normalize_failed_run_transcript(&self) {
        let mut agent = self.agent.lock().await;
        if let Err(error) = agent.normalize_dangling_tail().await {
            eprintln!("nac: failed to normalize transcript after run failure: {error:#}");
        }
    }

    fn expire_orchestrator_steering(&self, run_id: &SessionRunId) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        match crate::store::expire_thread_steering(
            &self.metadata.store_path,
            session_id,
            run_id.as_str(),
        ) {
            Ok(records) => self.emit_steering_expired(records),
            Err(error) => {
                eprintln!("nac: failed to expire orchestrator steering: {error:#}");
            }
        }
    }

    fn close_active_thread_dispatches(&self) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        match self
            .active_threads
            .close_all(&self.metadata.store_path, session_id)
        {
            Ok(records) => self.emit_steering_expired(records),
            Err(error) => eprintln!("nac: failed to close active worker steering: {error:#}"),
        }
    }

    fn emit_steering_expired(&self, records: Vec<crate::store::ThreadSteeringRecord>) {
        for record in records {
            let instruction_preview = record.instruction.chars().take(160).collect();
            if record.thread_name == crate::store::ORCHESTRATOR_STEERING_TARGET {
                self.event_bus
                    .emit_agent(AgentEvent::OrchestratorSteeringExpired {
                        steering_id: record.id,
                        instruction_preview,
                    });
            } else {
                self.event_bus
                    .emit_agent(AgentEvent::ThreadSteeringExpired {
                        name: record.thread_name,
                        steering_id: record.id,
                        instruction_preview,
                    });
            }
        }
    }

    fn mark_run_finishing(&self, run_id: &SessionRunId) -> Option<FinishingRun> {
        let mut guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            return None;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(FinishingRun {
            snapshot: active_run.snapshot.clone(),
            duration_ms: duration_ms(active_run.started_at.elapsed()),
            transcript_baseline: active_run.transcript_baseline,
        })
    }

    fn mark_run_cancelling(&self, run_id: &SessionRunId) -> Option<CancellingRun> {
        let mut guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            return None;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            return None;
        }
        active_run.finishing = true;
        active_run.snapshot.submitted_user_message = None;
        Some(CancellingRun {
            snapshot: active_run.snapshot.clone(),
            task: active_run.task.take(),
            transcript_baseline: active_run.transcript_baseline,
        })
    }

    fn set_run_task(&self, run_id: &SessionRunId, task: JoinHandle<()>) {
        let mut guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            task.abort();
            return;
        };
        if &active_run.snapshot.run_id != run_id || active_run.finishing {
            task.abort();
            return;
        }
        active_run.task = Some(task);
    }

    /// Store the run-start visible-response count captured by the run task
    /// (step 4). Dropped when the run is already finishing/cancelling — the
    /// persist path then falls back to the run-end count (exact when the
    /// task was cancelled before its first append).
    fn set_run_transcript_baseline(&self, run_id: &SessionRunId, baseline: usize) {
        let mut guard = self.lock_active_operation();
        if let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() {
            if &active_run.snapshot.run_id == run_id && !active_run.finishing {
                active_run.transcript_baseline = Some(baseline);
            }
        }
    }

    fn clear_finished_run(&self, run_id: &SessionRunId) {
        let mut guard = self.lock_active_operation();
        if guard.as_ref().is_some_and(|operation| {
            matches!(
                operation,
                ActiveSessionOperation::Run(active_run)
                    if &active_run.snapshot.run_id == run_id && active_run.finishing
            )
        }) {
            *guard = None;
        }
    }

    fn lock_active_operation(&self) -> std::sync::MutexGuard<'_, Option<ActiveSessionOperation>> {
        self.active_operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Run-end persist (DB-direct transcript workset, step 4 — never-fold):
    /// performs NO `messages_json` rewrite. The snapshot blob is write-once
    /// (system head ++ legacy prefix); the transcript lives in the
    /// transcript log, appends-only. Token/timing bookkeeping diffs
    /// store-backed visible-response counts: `transcript_baseline` at run
    /// start (captured by the run task before its first append) vs the count
    /// at run end, advanced here over the run's appended log rows. Only
    /// run-state columns are persisted (`save_session_run_state`) and the
    /// in-memory snapshot is updated in place — no O(n) transcript clone
    /// anywhere. The in-memory update deliberately happens before the save:
    /// the duration/usage vectors are count-indexed histories, not diffs, so
    /// a failed save leaves both copies re-derivable from the counts at the
    /// next run end.
    async fn persist_run_snapshot(
        &self,
        active_run: &ActiveRunSnapshot,
        transcript_baseline: Option<usize>,
        completed_duration_ms: Option<u64>,
        completed_usage: Option<crate::model::TokenUsage>,
    ) -> Result<()> {
        {
            let snapshot = self.session_snapshot.lock().await;
            if snapshot.is_none() {
                return Ok(());
            }
        }
        self.update_transcript_scan().await?;
        let current_response_count = self.lock_transcript_scan().visible_response_count;
        let update = {
            let mut snapshot = self.session_snapshot.lock().await;
            let Some(snapshot) = snapshot.as_mut() else {
                return Ok(());
            };
            // Fallback when the run task never captured a baseline
            // (cancelled before its first append, or a capture failure):
            // diffing against the run-end count is exact in the no-append
            // case and only affects legacy history padding otherwise.
            let previous_response_count = transcript_baseline.unwrap_or(current_response_count);
            let response_timing = response_timing_after_run(
                snapshot,
                previous_response_count,
                current_response_count,
                completed_duration_ms,
            );
            let token_usages = token_usages_after_run(
                &snapshot.token_usages,
                previous_response_count,
                current_response_count,
                completed_usage,
            );
            snapshot.apply_run_state(sessions::SessionRunState {
                last_response_duration_ms: response_timing.last_response_duration_ms,
                previous_response_duration_ms: response_timing.previous_response_duration_ms,
                response_durations_ms: response_timing.response_durations_ms,
                token_usages,
            })
        };

        let saved_session_id = update.session_id.clone();
        let store_path = self.metadata.store_path.clone();
        tokio::task::spawn_blocking(move || sessions::save_session_run_state(&store_path, &update))
            .await??;

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
        // Trims any dangling tool turn from the transcript AND the transcript
        // log tail, then appends and logs the cancellation marker. A log
        // failure must not fail the cancel; the next restore re-normalizes
        // the stale tail (see Agent::append_cancellation_marker).
        if let Err(error) = agent.append_cancellation_marker().await {
            eprintln!("nac: failed to normalize transcript log for cancellation: {error:#}");
        }
        agent.invalidate_context_sample();
        // Return partial usage so the caller can persist it. Because `send()`
        // updates `last_usage` mid-loop, this captures all token usage from
        // model calls made before the cancel.
        agent.last_usage.clone()
    }
}

struct LoadedFrontendMessages {
    messages: Vec<Message>,
    page: Option<MessagePageMetadata>,
    cycle: Option<MessageCycleMetadata>,
}

/// Flags delivered orchestrator steering records whose verbatim user message
/// is present in `transcript`. Steering is injected into the agent as an exact
/// `Message::User`, so coverage is an exact-content match; only `delivered`
/// records can ever have a canonical message. Transcript copies pair with the
/// newest matching records first: messages are append-only (compaction rewrites
/// the provider view, never the transcript), so the copies present are always
/// the most recent deliveries of that instruction — relevant when a crash lost
/// an earlier delivery of a duplicate instruction.
///
/// This is the reference implementation; the snapshot path computes the same
/// result incrementally via [`covered_ids_from_scan`].
#[cfg(test)]
fn covered_orchestrator_steering_ids(
    records: &[crate::store::ThreadSteeringRecord],
    transcript: &[Message],
) -> Vec<i64> {
    let mut delivered: Vec<&crate::store::ThreadSteeringRecord> = records
        .iter()
        .filter(|record| {
            record.thread_name == crate::store::ORCHESTRATOR_STEERING_TARGET
                && record.status == "delivered"
        })
        .collect();
    delivered.sort_by_key(|record| std::cmp::Reverse(record.id));
    let mut consumed = vec![false; transcript.len()];
    let mut covered = Vec::new();
    for record in delivered {
        let Some(index) = transcript.iter().enumerate().position(|(index, message)| {
            !consumed[index]
                && matches!(message, Message::User { content } if content == &record.instruction)
        }) else {
            continue;
        };
        consumed[index] = true;
        covered.push(record.id);
    }
    covered.sort_unstable();
    covered
}

/// Coverage from the incremental scan cache: per instruction, the newest
/// `min(delivered, surviving transcript copies)` records are covered — the
/// same newest-first pairing as [`covered_orchestrator_steering_ids`],
/// computed without rescanning the transcript. The transcript is append-only
/// for User messages, so once a record is covered it stays covered; guidance
/// hides the moment its delivery is acked and appended to the log.
fn covered_ids_from_scan(
    records: &[crate::store::ThreadSteeringRecord],
    scan: &TranscriptScanCache,
) -> Vec<i64> {
    let mut delivered: Vec<&crate::store::ThreadSteeringRecord> = records
        .iter()
        .filter(|record| {
            record.thread_name == crate::store::ORCHESTRATOR_STEERING_TARGET
                && record.status == "delivered"
        })
        .collect();
    delivered.sort_by_key(|record| std::cmp::Reverse(record.id));
    let mut by_instruction: HashMap<&str, Vec<i64>> = HashMap::new();
    for record in delivered {
        by_instruction
            .entry(record.instruction.as_str())
            .or_default()
            .push(record.id);
    }
    let mut covered = Vec::new();
    for (instruction, ids) in by_instruction {
        let copies = scan.user_copies.get(instruction).copied().unwrap_or(0);
        covered.extend(ids.into_iter().take(copies));
    }
    covered.sort_unstable();
    covered
}

#[cfg(test)]
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

/// Names of threads dispatched via `thread` tool calls in `messages`
/// (malformed and empty names ignored). Used for the message-cycle metadata's
/// bounded tail scan.
fn thread_tool_call_names(messages: &[Message]) -> Vec<String> {
    let mut thread_names = BTreeMap::<String, ()>::new();
    for message in messages {
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
    thread_names.into_keys().collect()
}

fn decode_thread_event(
    record: crate::store::ThreadEventRecord,
    diagnostics: &mut Vec<ThreadEventDecodeDiagnostic>,
) -> Option<AgentEvent> {
    let decoded = serde_json::from_str::<AgentEvent>(&record.event_json)
        .ok()
        .and_then(crate::events::sanitize_external_agent_event);
    if decoded.is_none() && diagnostics.len() < MAX_THREAD_EVENT_DIAGNOSTICS {
        diagnostics.push(ThreadEventDecodeDiagnostic {
            id: record.id,
            thread_name: record.thread_name,
            created_at: record.created_at,
            error: "malformed, unsupported, or internal event omitted".to_string(),
        });
    }
    decoded
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

/// User-visible response predicate for the token/timing bookkeeping: an
/// assistant message with no tool calls. Shared by the transcript scan
/// cache and the run-end count diff.
fn is_visible_response(message: &Message) -> bool {
    matches!(
        message,
        Message::Assistant { tool_calls, .. }
            if tool_calls.as_ref().is_none_or(|tool_calls| tool_calls.is_empty())
    )
}

/// Run-end response-timing bookkeeping. The diff base is store-backed
/// visible-response counts (step 4, never-fold): `previous_response_count`
/// at run START (captured from the store transcript when the run began) and
/// `current_response_count` at run END. The persisted duration history is
/// preserved and padded to both counts; a completed run's duration lands on
/// the final visible response.
fn response_timing_after_run(
    snapshot: &SessionSnapshot,
    previous_response_count: usize,
    current_response_count: usize,
    completed_duration_ms: Option<u64>,
) -> ResponseTimingSnapshot {
    let mut durations = response_duration_history_from_snapshot(snapshot, previous_response_count);
    if durations.len() < previous_response_count {
        durations.resize(previous_response_count, None);
    }

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

fn response_duration_history_from_snapshot(
    snapshot: &SessionSnapshot,
    previous_response_count: usize,
) -> Vec<Option<u64>> {
    if let Some(durations) = &snapshot.response_durations_ms {
        return durations.clone();
    }

    // Legacy rows without a duration history: reconstruct from the scalar
    // last/previous columns at the run-START count (the pre-run transcript).
    let mut durations = vec![None; previous_response_count];
    if let Some(last_index) = previous_response_count.checked_sub(1) {
        durations[last_index] = snapshot.last_response_duration_ms;
    }
    if previous_response_count >= 2 {
        durations[previous_response_count - 2] = snapshot.previous_response_duration_ms;
    }
    durations
}

/// Build the per-response token-usage vector after a run, mirroring the
/// logic in `response_timing_after_run` for durations.  The existing
/// vector is preserved and padded to match the new response count; the
/// most recent response's usage is set from `completed_usage` when the
/// run completed successfully.
fn token_usages_after_run(
    existing: &[Option<crate::model::TokenUsage>],
    previous_response_count: usize,
    current_response_count: usize,
    completed_usage: Option<crate::model::TokenUsage>,
) -> Vec<Option<crate::model::TokenUsage>> {
    let mut usages = existing.to_vec();
    if usages.len() < previous_response_count {
        usages.resize(previous_response_count, None);
    }

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
pub(super) mod tests {
    use super::*;
    use crate::agent::{AgentConfig, AgentMode};
    use crate::model::ModelClient;
    use crate::types::{FunctionCall, ToolCall};
    use std::collections::BTreeMap;

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
    fn thread_tool_call_names_ignore_malformed_and_non_thread_calls() {
        let messages = mixed_message_history();
        // Names come from `thread` tool calls only; malformed arguments,
        // blank names, and non-thread calls are ignored, and names are
        // sorted and deduplicated.
        assert_eq!(
            thread_tool_call_names(&messages[6..]),
            vec!["alpha".to_string(), "zeta".to_string()]
        );
        assert!(thread_tool_call_names(&messages[..2]).is_empty());
        assert!(thread_tool_call_names(&[Message::System {
            content: "only system".to_string(),
        }])
        .is_empty());
    }

    pub(super) fn test_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_session_service_{label}_{unique}"))
            .join("store.db")
    }

    pub(super) fn test_agent(
        client: ModelClient,
        store_path: PathBuf,
        session_id: Option<String>,
    ) -> Agent {
        test_agent_with_compaction_threshold(client, store_path, session_id, None)
    }

    pub(super) fn test_agent_with_compaction_threshold(
        client: ModelClient,
        store_path: PathBuf,
        session_id: Option<String>,
        orchestrator_compaction_threshold: Option<u64>,
    ) -> Agent {
        Agent::with_config(
            client,
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path,
                session_id,
                orchestrator_compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
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

    pub(super) fn test_picker_service(label: &str) -> SessionServiceParts {
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

    pub(super) fn test_active_service(
        label: &str,
        session_id: &str,
    ) -> (SessionServiceParts, PathBuf) {
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

    /// Seed the store transcript's legacy prefix: the snapshot blob (what the
    /// store-backed read paths serve) plus the agent vec, so later log
    /// appends land at the right absolute idx.
    pub(super) async fn seed_store_transcript(parts: &SessionServiceParts, messages: Vec<Message>) {
        parts
            .service
            .session_snapshot
            .lock()
            .await
            .as_mut()
            .unwrap()
            .messages = messages.clone();
        parts.service.agent.lock().await.messages = messages;
    }

    /// Append to the transcript log tail exactly like a commit point (the
    /// store-backed read paths serve it immediately; the agent vec is not
    /// required for reads).
    pub(super) async fn seed_log_tail(parts: &SessionServiceParts, messages: Vec<Message>) {
        let writer = parts
            .service
            .transcript_log
            .as_ref()
            .expect("active service has a transcript log")
            .clone();
        let session_id = parts.service.metadata.session_id.clone().unwrap();
        let start_idx = parts
            .service
            .session_snapshot
            .lock()
            .await
            .as_ref()
            .map(|snapshot| snapshot.messages.len() as u64)
            .unwrap_or(0);
        tokio::task::spawn_blocking(move || writer.append_batch(&session_id, start_idx, &messages))
            .await
            .unwrap()
            .unwrap();
    }

    pub(super) fn compaction_messages() -> Vec<Message> {
        vec![
            Message::System {
                content: "system policy".to_string(),
            },
            Message::User {
                content: "old request".to_string(),
            },
            Message::Assistant {
                content: Some("old answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
            },
            Message::User {
                content: "recent request".to_string(),
            },
            Message::User {
                content: "current request".to_string(),
            },
        ]
    }

    pub(super) fn compaction_response(text: &str) -> String {
        serde_json::json!({
            "status": "completed",
            "output": [{
                "type": "message",
                "content": [{"type": "output_text", "text": text}]
            }],
            "usage": {
                "input_tokens": 30,
                "input_tokens_details": {"cached_tokens": 4},
                "output_tokens": 5,
                "total_tokens": 39
            }
        })
        .to_string()
    }

    pub(super) fn test_compaction_service(
        label: &str,
        session_id: &str,
        client: ModelClient,
    ) -> (SessionServiceParts, PathBuf) {
        let store_path = test_store_path(label);
        let mut agent = test_agent(
            client.clone(),
            store_path.clone(),
            Some(session_id.to_string()),
        );
        agent.messages = compaction_messages();
        agent.last_usage = Some(crate::model::TokenUsage {
            input_tokens: 91,
            output_tokens: 7,
            orchestrator_context_tokens: 123,
            ..crate::model::TokenUsage::default()
        });
        let mut snapshot = sessions::new_snapshot(
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
        snapshot.last_response_duration_ms = Some(123);
        snapshot.previous_response_duration_ms = Some(45);
        snapshot.response_durations_ms = Some(vec![Some(123)]);
        snapshot.token_usages = vec![Some(crate::model::TokenUsage {
            input_tokens: 11,
            output_tokens: 2,
            orchestrator_context_tokens: 13,
            ..crate::model::TokenUsage::default()
        })];
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
    async fn frontend_snapshot_reuses_one_runtime_connection() {
        let (parts, store_path) =
            test_active_service("snapshot_connection_reuse", "connection-session");
        for index in 0..3 {
            crate::store::define_workset(
                &store_path,
                "connection-session",
                &crate::store::WorksetDefinition {
                    id: format!("workset-{index}"),
                    goal: "verify connection reuse".to_string(),
                    status: "active".to_string(),
                    summary: String::new(),
                    verification_recipe: None,
                    items: Vec::new(),
                },
            )
            .unwrap();
        }
        crate::store::append_episode(
            &store_path,
            "connection-session",
            "worker",
            "implementation",
            "retained episode",
        )
        .unwrap();
        let event_json = serde_json::to_string(&AgentEvent::AssistantMessage {
            thread_name: Some("worker".to_string()),
            content: "retained event".to_string(),
            usage: None,
        })
        .unwrap();
        crate::store::append_thread_event(&store_path, "connection-session", "worker", &event_json)
            .unwrap();
        crate::store::queue_thread_steering(
            &store_path,
            "connection-session",
            "worker",
            "dispatch",
            "retained steering",
        )
        .unwrap();
        crate::store::track_connection_opens(&store_path);

        let snapshot = parts.service.frontend_snapshot().await.unwrap();

        assert_eq!(snapshot.sessions.len(), 1);
        assert_eq!(snapshot.threads.len(), 1);
        assert_eq!(snapshot.thread_episodes["worker"].len(), 1);
        assert_eq!(snapshot.thread_events["worker"].len(), 1);
        assert_eq!(snapshot.thread_steering.len(), 1);
        assert_eq!(snapshot.worksets.items.len(), 3);
        assert_eq!(crate::store::tracked_connection_opens(&store_path), 1);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    #[ignore = "manual latency benchmark; run with --ignored --nocapture"]
    async fn benchmark_frontend_snapshot_latency() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

        const ITERATIONS: usize = 100;
        let (mut parts, store_path) =
            test_active_service("snapshot_benchmark", "benchmark-session");
        let workspace = store_path.parent().unwrap().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let git = |args: &[&str]| {
            let output = std::process::Command::new("git")
                .args(args)
                .current_dir(&workspace)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "git {args:?} failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        };
        git(&["init", "--quiet"]);
        for index in 0..64 {
            std::fs::write(
                workspace.join(format!("file-{index}.txt")),
                format!("baseline {index}\n"),
            )
            .unwrap();
        }
        git(&["add", "."]);
        git(&[
            "-c",
            "user.name=nac benchmark",
            "-c",
            "user.email=nac-benchmark@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "benchmark fixture",
        ]);
        for index in 0..16 {
            std::fs::write(
                workspace.join(format!("file-{index}.txt")),
                format!("modified {index}\n"),
            )
            .unwrap();
        }
        let metadata = Arc::make_mut(&mut parts.service.metadata);
        metadata.cwd = workspace.display().to_string();
        metadata.workspace_host_path = Some(workspace);
        for thread_index in 0..16 {
            let thread_name = format!("worker-{thread_index}");
            for episode_index in 0..8 {
                crate::store::append_episode(
                    &store_path,
                    "benchmark-session",
                    &thread_name,
                    "implementation",
                    &format!("episode {episode_index}"),
                )
                .unwrap();
            }
            for event_index in 0..32 {
                let event_json = serde_json::to_string(&AgentEvent::AssistantMessage {
                    thread_name: Some(thread_name.clone()),
                    content: format!("event {event_index}"),
                    usage: None,
                })
                .unwrap();
                crate::store::append_thread_event(
                    &store_path,
                    "benchmark-session",
                    &thread_name,
                    &event_json,
                )
                .unwrap();
            }
        }
        for workset_index in 0..4 {
            crate::store::define_workset(
                &store_path,
                "benchmark-session",
                &crate::store::WorksetDefinition {
                    id: format!("workset-{workset_index}"),
                    goal: "measure dashboard reads".to_string(),
                    status: "active".to_string(),
                    summary: "benchmark fixture".to_string(),
                    verification_recipe: None,
                    items: (0..8)
                        .map(|item_index| crate::store::WorksetItemDefinition {
                            title: format!("item-{item_index}"),
                            scope: "crates/nac-core".to_string(),
                            description: "exercise workset detail reads".to_string(),
                            role: "implementation".to_string(),
                            depends_on: Vec::new(),
                            acceptance: "snapshot includes this item".to_string(),
                            notes: None,
                        })
                        .collect(),
                },
            )
            .unwrap();
        }
        seed_store_transcript(
            &parts,
            (0..128)
                .map(|index| Message::User {
                    content: format!("benchmark message {index}"),
                })
                .collect(),
        )
        .await;

        for _ in 0..10 {
            parts.service.frontend_snapshot().await.unwrap();
        }

        let stop = Arc::new(AtomicBool::new(false));
        let max_scheduler_gap_us = Arc::new(AtomicU64::new(0));
        let ticker_stop = Arc::clone(&stop);
        let ticker_gap = Arc::clone(&max_scheduler_gap_us);
        let ticker = tokio::spawn(async move {
            let mut previous = Instant::now();
            while !ticker_stop.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(1)).await;
                let now = Instant::now();
                let lateness_us =
                    (now.duration_since(previous).as_micros() as u64).saturating_sub(1_000);
                ticker_gap.fetch_max(lateness_us, Ordering::Relaxed);
                previous = now;
            }
        });

        let mut latency_us = Vec::with_capacity(ITERATIONS);
        for _ in 0..ITERATIONS {
            let started = Instant::now();
            parts.service.frontend_snapshot().await.unwrap();
            latency_us.push(started.elapsed().as_micros() as u64);
        }
        stop.store(true, Ordering::Relaxed);
        ticker.await.unwrap();
        latency_us.sort_unstable();
        let p95_index = (ITERATIONS * 95).div_ceil(100) - 1;
        eprintln!(
            "frontend_snapshot_benchmark iterations={ITERATIONS} median_us={} p95_us={} max_scheduler_lateness_us={}",
            latency_us[ITERATIONS / 2],
            latency_us[p95_index],
            max_scheduler_gap_us.load(Ordering::Relaxed)
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn focused_snapshot_options_page_messages_and_preserve_default_wrapper_contract() {
        let (parts, store_path) = test_active_service("paged_snapshot", "paged-session");
        let messages = mixed_message_history();
        seed_store_transcript(&parts, messages.clone()).await;
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
    async fn store_backed_pages_are_live_mid_run_while_the_agent_is_busy() {
        let (parts, store_path) = test_active_service("paged_live", "live-session");
        let persisted_messages = mixed_message_history();
        seed_store_transcript(&parts, persisted_messages.clone()).await;
        let request = MessagePageRequest {
            before: Some(usize::MAX),
            limit: 3,
            include_system: false,
        };
        let expected = page_messages(&persisted_messages, request);
        let agent_guard = parts.service.agent.lock().await;

        // The held agent lock is irrelevant: pages read the store (blob ++
        // log), never the agent vec, so they never wait for a run.
        let direct = tokio::time::timeout(
            Duration::from_millis(500),
            parts.service.messages_page(request),
        )
        .await
        .expect("paged messages should not wait for the held agent mutex")
        .unwrap();
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

        // Mid-run appends to the log are visible immediately — the snapshot
        // blob is unchanged and the agent lock is still held.
        seed_log_tail(
            &parts,
            vec![
                Message::User {
                    content: "mid-run prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("mid-run answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                },
            ],
        )
        .await;
        let mut expected_live = persisted_messages.clone();
        expected_live.push(Message::User {
            content: "mid-run prompt".to_string(),
        });
        expected_live.push(Message::Assistant {
            content: Some("mid-run answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        });
        let expected_live = page_messages(&expected_live, request);
        let live = parts.service.messages_page(request).await.unwrap();
        assert_eq!(live.page, expected_live.page);
        assert_eq!(
            serde_json::to_value(&live.messages).unwrap(),
            serde_json::to_value(&expected_live.messages).unwrap()
        );
        // The cycle metadata follows the store transcript too: the mid-run
        // prompt is the latest user message, at its absolute raw index.
        let loaded = parts
            .service
            .frontend_snapshot_with_options(FrontendSnapshotLoadOptions {
                thread_event_limit: 0,
                include_sessions: false,
                messages: FrontendSnapshotMessages::Page(request),
            })
            .await
            .unwrap();
        assert_eq!(
            loaded.message_cycle,
            Some(MessageCycleMetadata {
                marker: format!("history:3:{}", persisted_messages.len()),
                thread_names: Vec::new(),
            })
        );
        assert_eq!(
            serde_json::to_value(&loaded.snapshot.messages).unwrap(),
            serde_json::to_value(&expected_live.messages).unwrap()
        );

        drop(agent_guard);
        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn store_backed_snapshot_is_live_during_a_real_run() {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};

        let store_path = test_store_path("real_run_live");
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let (hit_tx, hit_rx) = std::sync::mpsc::channel::<()>();
        let server = ScriptedServer::start_observed(
            vec![
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{
                            "type": "function_call",
                            "call_id": "call-1",
                            "name": "unknown_alpha",
                            "arguments": "{}"
                        }],
                        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                    })
                    .to_string(),
                ),
                ScriptedResponse::json(
                    "200 OK",
                    serde_json::json!({
                        "status": "completed",
                        "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
                        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                    })
                    .to_string(),
                ),
            ],
            move |index, _| {
                if index == 1 {
                    hit_tx.send(()).unwrap();
                    // Hold the run mid-flight: the second model response
                    // stays unserved until the test releases it.
                    release_rx.recv().unwrap();
                }
            },
        );
        let client = ModelClient::new_for_test_server(server.base_url.clone());
        let session_id = "real-run-session".to_string();
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

        let handle = parts
            .service
            .try_submit_prompt("mid-run prompt".to_string())
            .unwrap();
        // The run is blocked on the second model call: the prompt, the
        // assistant tool call, and the tool result are already committed to
        // the transcript log, and the run task holds the agent lock. The
        // channel wait must not block the current-thread runtime.
        tokio::task::spawn_blocking(move || hit_rx.recv_timeout(Duration::from_secs(5)))
            .await
            .unwrap()
            .expect("the run should reach the second model call");

        let snapshot = parts.service.frontend_snapshot().await.unwrap();
        assert!(snapshot.active_run.is_some());
        let roles: Vec<&str> = snapshot
            .messages
            .iter()
            .map(|message| match message {
                Message::System { .. } => "system",
                Message::User { .. } => "user",
                Message::Assistant { .. } => "assistant",
                Message::Tool { .. } => "tool",
            })
            .collect();
        assert_eq!(
            roles,
            vec!["system", "user", "assistant", "tool"],
            "the mid-run snapshot reads the live store transcript"
        );
        assert!(
            matches!(&snapshot.messages[1], Message::User { content } if content == "mid-run prompt")
        );

        release_tx.send(()).unwrap();
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());
        let snapshot = parts.service.frontend_snapshot().await.unwrap();
        assert_eq!(snapshot.messages.len(), 5);
        assert!(
            matches!(&snapshot.messages[4], Message::Assistant { content: Some(text), .. } if text == "done")
        );

        // The live trigger fired once per commit point across the run.
        let mut appended_lens = Vec::new();
        while let Ok(envelope) = events.try_recv() {
            if let SessionEvent::TranscriptAppended { transcript_len } = envelope.event {
                appended_lens.push(transcript_len);
            }
        }
        assert_eq!(appended_lens, vec![2, 3, 4, 5]);
        drop(handle);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn malformed_internal_and_future_thread_events_are_nonfatal_and_advance_raw_cursor() {
        let (parts, store_path) = test_active_service("tolerant_events", "events-session");
        let valid = serde_json::to_string(&AgentEvent::AssistantMessage {
            thread_name: Some("worker-a".to_string()),
            content: "safe response".to_string(),
            usage: None,
        })
        .unwrap();
        for (thread_name, event_json) in [
            ("worker-a", valid.as_str()),
            ("worker-a", "{malformed event json"),
            (
                "worker-b",
                r#"{"type":"model_call_started","thread_name":"worker-b","iteration":1}"#,
            ),
            (
                "worker-c",
                r#"{"type":"future_event","payload":"CANARY_UNKNOWN"}"#,
            ),
            (
                "worker-d",
                r#"{"type":"tool_call_started","thread_name":"worker-d","call_id":"call-api","name":"exec_command","args_preview":"CANARY_COMMAND","args_detail":"{\"cmd\":\"echo safe_cmd\",\"workdir\":\"/safe/api\"}"}"#,
            ),
        ] {
            crate::store::append_thread_event(
                &store_path,
                "events-session",
                thread_name,
                event_json,
            )
            .unwrap();
        }

        let snapshot = parts.service.frontend_snapshot().await.unwrap();
        assert_eq!(snapshot.thread_events["worker-a"].len(), 1);
        assert_eq!(snapshot.thread_events["worker-d"].len(), 1);
        assert_eq!(snapshot.thread_event_diagnostics.len(), 3);
        assert!(!snapshot.thread_event_boundary.epoch_id.is_empty());
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(!serialized.contains("CANARY"));
        assert!(serialized.contains("/safe/api"));
        assert!(!snapshot
            .thread_event_diagnostics
            .iter()
            .any(|diagnostic| diagnostic.error.contains('{')));

        let first_page = parts
            .service
            .thread_events_page("worker-a", None, 1)
            .unwrap();
        assert!(first_page.events.is_empty());
        assert_eq!(first_page.diagnostics.len(), 1);
        assert!(first_page.has_older);
        assert!(first_page.thread_event_boundary.is_some());
        let malformed_id = first_page.next_before_id.unwrap();
        let older_page = parts
            .service
            .thread_events_page("worker-a", Some(malformed_id), 1)
            .unwrap();
        assert_eq!(older_page.events.len(), 1);
        assert!(older_page.thread_event_boundary.is_none());
        assert!(older_page.next_before_id.unwrap() < malformed_id);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn frontend_snapshot_restores_persisted_thread_activity() {
        let (mut parts, store_path) = test_active_service("thread_activity", "activity-session");
        Arc::make_mut(&mut parts.service.metadata)
            .extra_headers
            .insert("Authorization".to_string(), "CANARY_HEADER".to_string());
        parts
            .service
            .event_bus
            .emit_agent(AgentEvent::ThreadStarted {
                name: "impl/ui".to_string(),
                action: "Build the interface".to_string(),
                source_threads: Vec::new(),
            });
        parts
            .service
            .event_bus
            .emit_agent(AgentEvent::ToolCallStarted {
                thread_name: Some("impl/ui".to_string()),
                call_id: "call-1".to_string(),
                name: "read".to_string(),
                args_preview: r#"{"path":"index.html"}"#.to_string(),
                key_arg_preview: None,
                args_detail: None,
            });
        parts
            .service
            .event_bus
            .emit_agent(AgentEvent::ToolCallFinished {
                thread_name: Some("impl/ui".to_string()),
                call_id: "call-1".to_string(),
                name: "read".to_string(),
                content_preview: "done".to_string(),
                is_error: false,
            });

        let snapshot = parts.service.frontend_snapshot().await.unwrap();
        assert!(snapshot.metadata.extra_headers.is_empty());
        assert_eq!(
            parts.service.metadata().extra_headers["Authorization"],
            "CANARY_HEADER"
        );
        let events = &snapshot.thread_events["impl/ui"];
        assert_eq!(events.len(), 3);
        assert!(matches!(events[0], AgentEvent::ThreadStarted { .. }));
        assert!(matches!(events[2], AgentEvent::ToolCallFinished { .. }));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[test]
    fn public_submission_rejects_external_process_lease() {
        let (parts, store_path) = test_active_service("external_lease", "leased-session");
        let _lease =
            sessions::SessionOperationLease::try_acquire(&store_path, "leased-session").unwrap();
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
            .active_operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(ActiveSessionOperation::Run(ActiveRunState {
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
                transcript_baseline: None,
                _operation_lease: None,
            }));
        let inactive = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap_err();
        assert!(inactive.to_string().contains("not active"));

        service.active_threads.mark("impl/ui", "worker-dispatch");
        let queued = service
            .queue_thread_steering("impl/ui", "make the layout denser")
            .await
            .unwrap();
        assert_eq!(queued.status, "queued");
        assert_eq!(queued.dispatch_id, "worker-dispatch");
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
        assert_eq!(queued.dispatch_id, active.run_id.as_str());

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

    fn steering_record(
        id: i64,
        thread_name: &str,
        status: &str,
        instruction: &str,
    ) -> crate::store::ThreadSteeringRecord {
        crate::store::ThreadSteeringRecord {
            id,
            session_id: "session".to_string(),
            thread_name: thread_name.to_string(),
            dispatch_id: "run".to_string(),
            instruction: instruction.to_string(),
            status: status.to_string(),
            created_at: "2026-07-31T10:00:00Z".to_string(),
            claimed_at: None,
            delivered_at: None,
            expired_at: None,
        }
    }

    #[test]
    fn covered_orchestrator_steering_ids_require_delivery_and_a_verbatim_message() {
        let orchestrator = crate::store::ORCHESTRATOR_STEERING_TARGET;
        let user = |content: &str| Message::User {
            content: content.to_string(),
        };
        let records = vec![
            steering_record(1, orchestrator, "delivered", "covered"),
            steering_record(2, orchestrator, "delivered", "lost to a crash"),
            steering_record(3, orchestrator, "queued", "covered"),
            steering_record(4, orchestrator, "expired", "covered"),
            steering_record(5, "worker/a", "delivered", "covered"),
        ];
        let transcript = vec![user("covered")];
        assert_eq!(
            covered_orchestrator_steering_ids(&records, &transcript),
            vec![1],
            "only a delivered orchestrator record with a verbatim transcript message is covered"
        );

        // Duplicate instructions: each surviving transcript copy belongs to the
        // newest delivery, so a crash-lost earlier copy keeps its record visible.
        let duplicates = vec![
            steering_record(6, orchestrator, "delivered", "same"),
            steering_record(7, orchestrator, "delivered", "same"),
        ];
        assert_eq!(
            covered_orchestrator_steering_ids(&duplicates, &[user("same")]),
            vec![7]
        );
        assert_eq!(
            covered_orchestrator_steering_ids(&duplicates, &[user("same"), user("same")]),
            vec![6, 7]
        );
    }

    #[test]
    fn covered_ids_from_scan_matches_the_reference_pairing() {
        let orchestrator = crate::store::ORCHESTRATOR_STEERING_TARGET;
        let user = |content: &str| Message::User {
            content: content.to_string(),
        };
        let assistant = || Message::Assistant {
            content: Some("answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        };
        let cases: Vec<(Vec<crate::store::ThreadSteeringRecord>, Vec<Message>)> = vec![
            (vec![], vec![]),
            (vec![], vec![user("orphan")]),
            (
                vec![
                    steering_record(1, orchestrator, "delivered", "covered"),
                    steering_record(2, orchestrator, "delivered", "lost to a crash"),
                    steering_record(3, orchestrator, "queued", "covered"),
                    steering_record(4, orchestrator, "expired", "covered"),
                    steering_record(5, "worker/a", "delivered", "covered"),
                ],
                vec![user("covered")],
            ),
            // Duplicate instructions pair with the newest deliveries first.
            (
                vec![
                    steering_record(6, orchestrator, "delivered", "same"),
                    steering_record(7, orchestrator, "delivered", "same"),
                ],
                vec![user("same")],
            ),
            (
                vec![
                    steering_record(6, orchestrator, "delivered", "same"),
                    steering_record(7, orchestrator, "delivered", "same"),
                ],
                vec![user("same"), assistant(), user("same")],
            ),
            (
                vec![
                    steering_record(8, orchestrator, "delivered", "alpha"),
                    steering_record(9, orchestrator, "delivered", "beta"),
                    steering_record(10, orchestrator, "delivered", "alpha"),
                ],
                vec![user("beta"), assistant(), user("alpha"), user("alpha")],
            ),
        ];
        for (records, transcript) in cases {
            let scan = TranscriptScanCache::from_transcript(&transcript);
            assert_eq!(
                covered_ids_from_scan(&records, &scan),
                covered_orchestrator_steering_ids(&records, &transcript),
                "incremental coverage must match the reference pairing"
            );
        }
    }

    #[tokio::test]
    async fn frontend_snapshot_coverage_is_immediate_from_the_store_transcript() {
        let (parts, store_path) = test_active_service("steering_coverage", "session-coverage");
        let service = parts.service.clone();
        let queued = crate::store::queue_thread_steering(
            &store_path,
            "session-coverage",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-1",
            "change direction",
        )
        .unwrap();
        crate::store::claim_thread_steering(&store_path, "session-coverage", "run-1").unwrap();
        crate::store::acknowledge_thread_steering_batch(
            &store_path,
            &[queued.id],
            "session-coverage",
            "run-1",
        )
        .unwrap();

        // Crash case: the record is delivered but the store transcript never
        // gained the message, so the record keeps rendering.
        let snapshot = service.frontend_snapshot().await.unwrap();
        assert!(snapshot.covered_orchestrator_steering_ids.is_empty());

        // Immediate case: the moment the delivery lands in the transcript
        // log (ack + append at the steering commit point), coverage hides
        // the record — no run-end persist, and a held agent lock (a busy
        // run) is irrelevant because coverage reads the store.
        let agent_guard = service.agent.lock().await;
        seed_log_tail(
            &parts,
            vec![Message::User {
                content: "change direction".to_string(),
            }],
        )
        .await;
        let snapshot = service.frontend_snapshot().await.unwrap();
        assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);
        assert!(
            matches!(
                snapshot.messages.last(),
                Some(Message::User { content }) if content == "change direction"
            ),
            "the canonical message is visible in the same snapshot that covers the record"
        );
        drop(agent_guard);

        // Persisted case: a blob-carried verbatim message (a run-end persist
        // covered the log row) keeps the record covered across services.
        let (parts, blob_store_path) =
            test_active_service("steering_coverage_blob", "session-coverage-blob");
        let service = parts.service.clone();
        let queued = crate::store::queue_thread_steering(
            &blob_store_path,
            "session-coverage-blob",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-1",
            "change direction",
        )
        .unwrap();
        crate::store::claim_thread_steering(&blob_store_path, "session-coverage-blob", "run-1")
            .unwrap();
        crate::store::acknowledge_thread_steering_batch(
            &blob_store_path,
            &[queued.id],
            "session-coverage-blob",
            "run-1",
        )
        .unwrap();
        let mut blob = vec![Message::System {
            content: "system".to_string(),
        }];
        blob.push(Message::User {
            content: "change direction".to_string(),
        });
        seed_store_transcript(&parts, blob).await;
        let snapshot = service.frontend_snapshot().await.unwrap();
        assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
        let _ = std::fs::remove_dir_all(blob_store_path.parent().unwrap());
    }

    #[test]
    fn public_submission_rejects_stale_config_revision() {
        let (parts, store_path) = test_active_service("stale_revision", "stale-session");
        let mut stored = sessions::load_session(&store_path, "stale-session").unwrap();
        stored.model = "externally-updated-model".to_string();
        sessions::update_session_config(&store_path, &stored).unwrap();

        let error = match parts
            .service
            .try_submit_prompt("must not use stale config".to_string())
        {
            Ok(_) => panic!("stale service unexpectedly started a run"),
            Err(error) => error,
        };
        assert!(matches!(
            error,
            SessionSubmitError::Coordination {
                message: SessionCoordinationError::StaleConfiguration { .. },
            }
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
            agent
                .push_and_log_for_test(Message::User {
                    content: "prompt".to_string(),
                })
                .await
                .unwrap();
            agent
                .push_and_log_for_test(Message::Assistant {
                    content: Some("done".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                })
                .await
                .unwrap();
        }

        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );

        let started = events.recv().await.unwrap();
        assert_eq!(started.sequence_id, 1);
        assert_run_started_event(started, &active, "prompt");

        // The commit-point live signals (step 3) precede the run-end save.
        for (sequence_id, transcript_len) in [(2, 2), (3, 3)] {
            let appended = events.recv().await.unwrap();
            assert_eq!(appended.sequence_id, sequence_id);
            assert_eq!(
                appended.event,
                SessionEvent::TranscriptAppended { transcript_len }
            );
        }

        let saved_event = events.recv().await.unwrap();
        assert_eq!(saved_event.session_id.as_deref(), Some(session_id.as_str()));
        assert_eq!(saved_event.sequence_id, 4);
        assert_eq!(saved_event.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(saved_event.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            saved_event.event,
            SessionEvent::SnapshotSaved {
                session_id: session_id.clone()
            }
        );

        let completion = events.recv().await.unwrap();
        assert_eq!(completion.sequence_id, 5);
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
        // Never-fold (step 4): the run end did not rewrite the blob...
        assert_eq!(
            serde_json::to_value(&loaded.messages).unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        // ...the run's messages are served from the transcript log.
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert_eq!(transcript.len(), parts.init.restored_messages.len() + 2);
        assert!(matches!(
            transcript.last(),
            Some(Message::Assistant { content: Some(text), .. }) if text == "done"
        ));
        assert!(parts.service.active_run().is_none());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn run_end_persists_run_state_without_rewriting_messages_json() {
        let (parts, store_path) = test_active_service("never_fold_run_end", "session-never-fold");
        let session_id = "session-never-fold";
        let raw_messages_json = || {
            crate::store::open_connection(&store_path)
                .unwrap()
                .query_row(
                    "SELECT messages_json FROM sessions WHERE session_id = ?1",
                    rusqlite::params![session_id],
                    |row| row.get::<_, String>(0),
                )
                .unwrap()
        };
        let blob_before = raw_messages_json();

        // Two full runs: the blob stays byte-identical (never-fold) while
        // the run-state bookkeeping accumulates per visible response.
        for (prompt, response, input_tokens) in [
            ("first prompt", "first done", 10_u64),
            ("second prompt", "second done", 20_u64),
        ] {
            let active = parts.service.try_begin_run(None, prompt).unwrap();
            {
                let mut agent = parts.service.agent.lock().await;
                agent
                    .push_and_log_for_test(Message::User {
                        content: prompt.to_string(),
                    })
                    .await
                    .unwrap();
                agent
                    .push_and_log_for_test(Message::Assistant {
                        content: Some(response.to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                    })
                    .await
                    .unwrap();
            }
            let usage = crate::model::TokenUsage {
                input_tokens,
                output_tokens: 5,
                ..crate::model::TokenUsage::default()
            };
            assert!(
                parts
                    .service
                    .finish_run_once(
                        &active.run_id,
                        RunOutcome::Completed(response.to_string(), Some(usage)),
                    )
                    .await
            );
            assert_eq!(
                raw_messages_json(),
                blob_before,
                "run end must never rewrite messages_json (never-fold)"
            );
        }

        let loaded = sessions::load_session(&store_path, session_id).unwrap();
        let durations = loaded
            .response_durations_ms
            .as_ref()
            .expect("duration history should be persisted");
        assert_eq!(durations.len(), 2);
        assert!(durations.iter().all(|entry| entry.is_some()));
        assert_eq!(loaded.last_response_duration_ms, durations[1]);
        assert_eq!(loaded.previous_response_duration_ms, durations[0]);
        assert_eq!(loaded.token_usages.len(), 2);
        assert_eq!(
            loaded.token_usages[0].as_ref().unwrap().input_tokens,
            10,
            "the first run's usage stays on the first visible response"
        );
        assert_eq!(
            loaded.token_usages[1].as_ref().unwrap().input_tokens,
            20,
            "the second run's usage lands on the final visible response"
        );

        // The full transcript is served from the store: blob ++ log.
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert_eq!(transcript.len(), parts.init.restored_messages.len() + 4);
        assert!(matches!(
            transcript.last(),
            Some(Message::Assistant { content: Some(text), .. }) if text == "second done"
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn real_run_diffs_token_timing_from_the_run_start_store_count() {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};

        let store_path = test_store_path("baseline_real_run");
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "new answer"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        )]);
        let client = ModelClient::new_for_test_server(server.base_url.clone());
        let session_id = "baseline-session".to_string();
        let mut agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
        // Legacy-shaped history: the prior transcript lives in the blob and
        // the row carries scalar last/previous durations but NO duration
        // history vector (a pre-feature row resumed under this build).
        agent.messages.push(Message::User {
            content: "legacy prompt".to_string(),
        });
        agent.messages.push(Message::Assistant {
            content: Some("legacy answer".to_string()),
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
        snapshot.last_response_duration_ms = Some(999);
        snapshot.previous_response_duration_ms = Some(888);
        snapshot.response_durations_ms = None;
        sessions::create_session(&store_path, &snapshot).unwrap();
        let blob_json_before: String = crate::store::open_connection(&store_path)
            .unwrap()
            .query_row(
                "SELECT messages_json FROM sessions WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .unwrap();
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

        let handle = parts
            .service
            .try_submit_prompt("new prompt".to_string())
            .unwrap();
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());
        drop(handle);

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        let durations = loaded
            .response_durations_ms
            .as_ref()
            .expect("the run end persists a duration history");
        assert_eq!(durations.len(), 2);
        assert_eq!(
            durations[0],
            Some(999),
            "the legacy last-duration stays on the pre-run response: the \
             diff base is the visible-response count at run START (1), not \
             the run-end count"
        );
        assert!(
            durations[1].is_some(),
            "the completed run's duration lands on the final visible response"
        );
        assert_eq!(loaded.last_response_duration_ms, durations[1]);
        assert_eq!(loaded.previous_response_duration_ms, Some(999));
        assert_eq!(loaded.token_usages.len(), 2);
        assert!(loaded.token_usages[0].is_none());
        assert_eq!(
            loaded.token_usages[1].as_ref().unwrap().input_tokens,
            10
        );
        let blob_json_after: String = crate::store::open_connection(&store_path)
            .unwrap()
            .query_row(
                "SELECT messages_json FROM sessions WHERE session_id = ?1",
                rusqlite::params![session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            blob_json_after, blob_json_before,
            "a real run end never rewrites messages_json (never-fold)"
        );

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

        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "prompt".to_string(),
                })
                .await
                .unwrap();
            agent
                .push_and_log_for_test(Message::Assistant {
                    content: Some("done".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                })
                .await
                .unwrap();
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

        let active = parts.service.try_begin_run(None, "prompt").unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "prompt".to_string(),
                })
                .await
                .unwrap();
            agent
                .push_and_log_for_test(Message::Assistant {
                    content: Some("partial response".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                })
                .await
                .unwrap();
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
    async fn failed_run_normalizes_the_dangling_tool_turn_for_the_next_run() {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};

        // Regression test (transcript review): a run that fails at the
        // tool-result commit point leaves the assistant tool-call message in
        // the long-lived agent's vec AND the log with its tool results in
        // neither. The next run reuses that agent, and providers reject a
        // transcript whose assistant tool calls have no tool results — the
        // run-failure path must trim the dangling turn from both stores.
        let store_path = test_store_path("failed_run_normalizes");
        let server = ScriptedServer::start(vec![
            ScriptedResponse::json(
                "200 OK",
                serde_json::json!({
                    "status": "completed",
                    "output": [{
                        "type": "function_call",
                        "call_id": "call-1",
                        "name": "unknown_alpha",
                        "arguments": "{}"
                    }],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
            ScriptedResponse::json(
                "200 OK",
                serde_json::json!({
                    "status": "completed",
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "recovered"}]}],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
        ]);
        let client = ModelClient::new_for_test_server(server.base_url.clone());
        let session_id = "session-failed-normalizes".to_string();
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
        // Inject the log failure precisely at the tool-result commit point:
        // only tool-kind transcript rows fail to insert (the prompt and
        // assistant appends succeed).
        let connection = rusqlite::Connection::open(&store_path).unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER fail_tool_log_appends
                 BEFORE INSERT ON thread_events
                 WHEN NEW.event_json LIKE '%\"kind\":\"tool\"%'
                 BEGIN
                     SELECT RAISE(ABORT, 'injected tool batch log failure');
                 END;",
            )
            .unwrap();

        let mut events = parts.service.subscribe_events();
        parts
            .service
            .try_submit_prompt("prompt one".to_string())
            .unwrap();
        let terminal = loop {
            let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .expect("timed out waiting for the first run's terminal event")
                .unwrap();
            if matches!(
                envelope.event,
                SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
            ) {
                break envelope;
            }
        };
        assert!(
            matches!(terminal.event, SessionEvent::RunFailed { .. }),
            "the injected log failure must fail the first run: {:?}",
            terminal.event
        );
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());

        // The dangling assistant tool-call turn is trimmed from the vec AND
        // the log: both end at the failed run's prompt.
        {
            let agent = parts.service.agent.lock().await;
            assert_eq!(agent.messages.len(), 2);
            assert!(
                matches!(agent.messages[1], Message::User { ref content } if content == "prompt one")
            );
        }
        let log = crate::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .read_from(&session_id, 0)
            .unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].0, 1);
        assert!(matches!(log[0].1, Message::User { ref content } if content == "prompt one"));

        // The next run reuses the same agent: with the dangling turn gone,
        // the provider view is clean and the run completes.
        connection
            .execute_batch("DROP TRIGGER fail_tool_log_appends")
            .unwrap();
        parts
            .service
            .try_submit_prompt("prompt two".to_string())
            .unwrap();
        let terminal = loop {
            let envelope = tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .expect("timed out waiting for the second run's terminal event")
                .unwrap();
            if matches!(
                envelope.event,
                SessionEvent::RunFailed { .. } | SessionEvent::RunCompleted { .. }
            ) {
                break envelope;
            }
        };
        assert!(
            matches!(
                terminal.event,
                SessionEvent::RunCompleted { ref response, .. } if response == "recovered"
            ),
            "the second run must complete once the dangling turn is trimmed: {:?}",
            terminal.event
        );
        for _ in 0..100 {
            if parts.service.active_run().is_none() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert!(parts.service.active_run().is_none());

        let requests = server.finish();
        assert_eq!(requests.len(), 2);
        let second_request: serde_json::Value = serde_json::from_slice(&requests[1].body).unwrap();
        assert!(
            !second_request["input"]
                .to_string()
                .contains("function_call"),
            "the second run's provider view must not carry the dangling tool call"
        );
        // The log stays contiguous across the normalization: prompt one@1,
        // prompt two@2, assistant@3.
        let log = crate::store::TranscriptLogWriter::new(&store_path)
            .unwrap()
            .read_from(&session_id, 0)
            .unwrap();
        assert_eq!(log.len(), 3);
        assert_eq!(log[1].0, 2);
        assert!(matches!(log[1].1, Message::User { ref content } if content == "prompt two"));
        assert_eq!(log[2].0, 3);
        assert!(
            matches!(log[2].1, Message::Assistant { content: Some(ref text), .. } if text == "recovered")
        );

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn completed_run_reports_failure_when_snapshot_persistence_fails() {
        let store_path = test_store_path("active_persist_failure");
        let store_parent = store_path.parent().unwrap().to_path_buf();
        // The store must be usable at agent construction time (the transcript
        // log writer opens it eagerly); break the path afterwards so only the
        // snapshot save at run end fails.
        crate::store::initialize(&store_path).unwrap();
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

        // Inject the persistence failure: replace the store directory with a
        // plain file so `save_session` can no longer open the database.
        std::fs::remove_dir_all(&store_parent).unwrap();
        std::fs::write(&store_parent, "not a directory").unwrap();

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
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "prompt");

        let terminal = events.recv().await.unwrap();
        assert_eq!(terminal.sequence_id, 2);
        assert_eq!(terminal.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(terminal.client_id.as_ref(), active.client_id.as_ref());
        assert_eq!(
            terminal.event,
            SessionEvent::RunFailed {
                message: "run failed".to_string()
            }
        );
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
        crate::store::insert_test_session(&store_path, &session_id);
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
        let agent_event = AgentEvent::RunFinished {
            thread_name: Some("impl".to_string()),
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

        let agent_event = AgentEvent::RunFinished {
            thread_name: Some("impl".to_string()),
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
        assert!(snapshot.messages.is_empty());

        drop(agent_guard);
        assert!(
            parts
                .service
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Failed("cleanup".to_string(), None)
                )
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
            agent
                .push_and_log_for_test(Message::User {
                    content: "persisted prompt".to_string(),
                })
                .await
                .unwrap();
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
            .persist_run_snapshot(
                &finishing.snapshot,
                finishing.transcript_baseline,
                Some(42),
                None,
            )
            .await
            .unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "persisted prompt");
        // The commit-point log append emits the live transcript signal before
        // the run-end snapshot save. The run id travels only inside send()
        // (the run-context sink), so this direct append carries none.
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 2 }
        );
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
                .finish_run_once(
                    &first.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
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
                message: "run failed".to_string()
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
            agent
                .push_and_log_for_test(Message::User {
                    content: "failed prompt".to_string(),
                })
                .await
                .unwrap();
        }

        assert!(
            parts
                .service
                .finish_run_once(&active.run_id, RunOutcome::Failed("boom".to_string(), None))
                .await
        );
        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "failed prompt");
        // The prompt commit point's live signal precedes the run-end save.
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 4 }
        );
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "run failed".to_string()
            }
        );

        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(loaded.last_response_duration_ms, Some(123));
        assert_eq!(loaded.previous_response_duration_ms, None);
        assert_eq!(loaded.response_durations_ms, Some(vec![Some(123)]));
        // Never-fold (step 4): the failed run's prompt persists in the
        // transcript log, not the blob.
        assert_eq!(
            serde_json::to_value(&loaded.messages).unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert_eq!(transcript.len(), parts.init.restored_messages.len() + 1);
        assert!(matches!(
            transcript.last(),
            Some(Message::User { content }) if content == "failed prompt"
        ));

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
        assert!(parts
            .service
            .active_threads
            .mark("worker", "worker-dispatch"));
        crate::store::queue_thread_steering(
            &store_path,
            &session_id,
            "worker",
            "worker-dispatch",
            "worker direction",
        )
        .unwrap();
        crate::store::queue_thread_steering(
            &store_path,
            &session_id,
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            active.run_id.as_str(),
            "orchestrator direction",
        )
        .unwrap();
        {
            let mut agent = parts.service.agent.lock().await;
            agent
                .push_and_log_for_test(Message::User {
                    content: "cancel prompt".to_string(),
                })
                .await
                .unwrap();
        }

        parts.service.request_cancel(&active.run_id).await.unwrap();

        let started = events.recv().await.unwrap();
        assert_run_started_event(started, &active, "cancel prompt");
        // The prompt commit point's live signal fires before the cancel.
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 2 }
        );
        assert!(matches!(
            events.recv().await.unwrap().event,
            SessionEvent::Agent {
                event: AgentEvent::OrchestratorSteeringExpired { .. }
            }
        ));
        assert!(matches!(
            events.recv().await.unwrap().event,
            SessionEvent::Agent {
                event: AgentEvent::ThreadSteeringExpired { .. }
            }
        ));
        // The cancellation marker is a transcript commit point: the live
        // signal fires before the snapshot save (the cancel path runs outside
        // send(), so it carries no run context).
        let appended = events.recv().await.unwrap();
        assert_eq!(
            appended.event,
            SessionEvent::TranscriptAppended { transcript_len: 3 }
        );
        let saved = events.recv().await.unwrap();
        assert_eq!(saved.run_id.as_ref(), Some(&active.run_id));
        assert!(matches!(saved.event, SessionEvent::SnapshotSaved { .. }));
        let failed = events.recv().await.unwrap();
        assert_eq!(failed.run_id.as_ref(), Some(&active.run_id));
        assert_eq!(
            failed.event,
            SessionEvent::RunFailed {
                message: "run failed".to_string()
            }
        );
        assert!(parts.service.active_run().is_none());
        assert!(parts.service.active_thread_names().await.is_empty());
        assert!(crate::store::list_thread_steering(&store_path, &session_id)
            .unwrap()
            .iter()
            .all(|record| record.status == "expired"));

        // Never-fold (step 4): the cancel path persists bookkeeping only —
        // the blob keeps the system head and the cancellation marker lives
        // in the transcript log.
        let loaded = sessions::load_session(&store_path, &session_id).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded.messages).unwrap(),
            serde_json::to_value(&parts.init.restored_messages).unwrap()
        );
        let transcript = parts.service.messages_snapshot().await.unwrap();
        assert!(matches!(
            transcript.last(),
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
                .finish_run_once(
                    &active.run_id,
                    RunOutcome::Completed("done".to_string(), None)
                )
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
