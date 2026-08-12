use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
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
use crate::runtime::OrchestratorRunConfig;
#[cfg(test)]
use crate::runtime::OrchestratorSession;
use crate::sessions::{self, SessionSnapshot};
use crate::types::Message;
use crate::view::{
    self, EpisodeSnapshot, SessionSummarySnapshot, ThreadSnapshot, WorksetSnapshot,
    WorksetSummarySnapshot, WorksetsSnapshot, WorkspaceSnapshot,
};
use crate::workspace::GitTarget;

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
    /// Cumulative usage from runs that produced no visible response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unattributed_token_usage: Option<crate::model::TokenUsage>,
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

        let mut cumulative_token_usage =
            crate::model::TokenUsage::aggregate(&snapshot.token_usages);
        if let Some(unattributed) = &snapshot.unattributed_token_usage {
            let cumulative = cumulative_token_usage.get_or_insert_default();
            cumulative.add_cost_saturating(unattributed);
            if unattributed.orchestrator_context_tokens != 0 {
                cumulative.replace_context(unattributed.orchestrator_context_tokens);
            }
        }

        Self {
            last_response_duration_ms: snapshot.last_response_duration_ms,
            previous_response_duration_ms: snapshot.previous_response_duration_ms,
            response_durations_ms: snapshot.response_durations_ms.clone(),
            token_usages: Some(snapshot.token_usages.clone()),
            last_token_usage,
            unattributed_token_usage: snapshot.unattributed_token_usage.clone(),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_recovery_warning: Option<String>,
    /// When each message was written to the transcript log, aligned with
    /// `messages`. `None` for messages carried by the snapshot blob, which
    /// predates the log and stores no per-message time.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub message_created_at: Vec<Option<String>>,
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
    /// Transcript-log row times, one per message. `None` where the message
    /// predates the log (the snapshot blob carries no per-message time).
    #[serde(default)]
    pub created_at: Vec<Option<String>>,
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

#[cfg(test)]
#[derive(Default)]
struct FrontendSnapshotAfterWorkspaceGate {
    reached: std::sync::atomic::AtomicBool,
    resume: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
impl FrontendSnapshotAfterWorkspaceGate {
    fn pause(&self) {
        self.reached
            .store(true, std::sync::atomic::Ordering::SeqCst);
        while !self.resume.load(std::sync::atomic::Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(1));
        }
    }
}

#[derive(Clone)]
pub struct SessionService {
    agent: Arc<Mutex<Agent>>,
    metadata: Arc<SessionMetadata>,
    /// Where git runs for this session's checkout — locally, or on the ssh host
    /// the session is working on. `None` for a sandbox with no mounted working
    /// directory, which is why such a session gets no revisions: its files do
    /// not outlive the container.
    workspace_git: Option<GitTarget>,
    config_version: Option<i64>,
    session_snapshot: Arc<Mutex<Option<SessionSnapshot>>>,
    transcript_recovery_warning: Arc<Option<String>>,
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
    #[cfg(test)]
    frontend_snapshot_after_workspace_gate: Option<Arc<FrontendSnapshotAfterWorkspaceGate>>,
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
        let session_id = Some(run_config.session.session_id().to_string());
        let restored_messages = run_config.agent.messages.clone();
        let transcript_recovery_warning = run_config
            .agent
            .transcript_recovery_warning()
            .map(str::to_owned);
        let response_timing =
            ResponseTimingSnapshot::from_session_snapshot(Some(&run_config.session.snapshot));
        let config_version = Some(run_config.session.snapshot.config_version);

        let event_bus =
            SessionEventBus::with_thread_event_store(session_id.clone(), store_path.clone());
        let events = event_bus.subscribe();
        run_config
            .agent
            .set_event_sink(EventSink::bus(event_bus.clone()));

        let workspace_git = run_config.workspace_git;
        let metadata = SessionMetadata {
            cwd: run_config.workspace_display,
            workspace_host_path: workspace_git
                .as_ref()
                .and_then(|target| target.local_path())
                .map(Path::to_path_buf),
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
        let session_snapshot = Some(run_config.session.into_snapshot());
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
            workspace_git,
            config_version,
            session_snapshot: Arc::new(Mutex::new(session_snapshot)),
            transcript_recovery_warning: Arc::new(transcript_recovery_warning),
            transcript_log,
            transcript_scan: Arc::new(StdMutex::new(transcript_scan)),
            event_bus,
            active_operation: Arc::new(StdMutex::new(None)),
            active_threads,
            #[cfg(test)]
            frontend_snapshot_after_workspace_gate: None,
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
        let workspace = self.workspace_snapshot();
        #[cfg(test)]
        if let Some(gate) = &self.frontend_snapshot_after_workspace_gate {
            gate.pause();
        }

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
            let sessions = if options.include_sessions {
                view::list_sessions_with_connection(&conn)?
            } else {
                Vec::new()
            };
            let threads = view::list_threads_with_connection(&conn, session_id)?;
            let thread_episodes =
                view::load_all_thread_episodes_with_connection(&conn, session_id)?;
            let (thread_event_boundary, thread_events) =
                self.event_bus.thread_event_boundary(|| {
                    self.load_all_thread_events_with_connection(&conn, options.thread_event_limit)
                })?;
            let worksets = view::worksets_snapshot_with_connection(&conn, session_id);
            // Keep this final storage read adjacent to the transcript scan so
            // a delivery committed during slower workspace inspection has the
            // current status needed to cover its canonical message.
            let thread_steering = session_id
                .map(|session_id| {
                    crate::store::list_thread_steering_with_connection(&conn, session_id)
                })
                .transpose()?
                .unwrap_or_default();
            (
                sessions,
                threads,
                thread_episodes,
                thread_events,
                thread_event_boundary,
                thread_steering,
                worksets,
            )
        };
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
        view::workspace_snapshot(&self.metadata.cwd, self.workspace_git.as_ref())
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
            FrontendSnapshotMessages::All => {
                let messages = self.store_backed_transcript().await?;
                let created_at = self.store_backed_transcript_times(messages.len()).await?;
                LoadedFrontendMessages {
                    messages,
                    created_at,
                    page: None,
                    cycle: None,
                }
            }
            FrontendSnapshotMessages::Page(request) => {
                let page = self.page_store_transcript(request).await?;
                let cycle = self.message_cycle_from_store().await?;
                LoadedFrontendMessages {
                    messages: page.messages,
                    created_at: page.created_at,
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
            message_created_at: loaded_messages.created_at,
            transcript_recovery_warning: (*self.transcript_recovery_warning).clone(),
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

    /// Row creation times for the window [`Self::read_log_tail_window`]
    /// returns. Empty for services without a transcript log (pickers).
    async fn read_log_tail_window_times(
        &self,
        blob_len: usize,
        tail_start: usize,
        limit: usize,
    ) -> Result<Vec<String>> {
        let (Some(writer), Some(session_id)) = (
            self.transcript_log.as_ref().map(Arc::clone),
            self.metadata.session_id.clone(),
        ) else {
            return Ok(Vec::new());
        };
        tokio::task::spawn_blocking(move || {
            writer.read_tail_window_times(&session_id, blob_len as u64, tail_start as u64, limit)
        })
        .await
        .map_err(|error| anyhow::anyhow!("transcript log tail time read task failed: {error}"))?
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
        let (log_part, log_times): (Vec<Message>, Vec<String>) = if end > blob_visible {
            let tail_start = start.saturating_sub(blob_visible);
            let count = end - blob_visible - tail_start;
            let (_, rows) = self
                .read_log_tail_window(blob_len, tail_start, count)
                .await?;
            let times = self
                .read_log_tail_window_times(blob_len, tail_start, count)
                .await?;
            (
                rows.into_iter().map(|(_, message)| message).collect(),
                times,
            )
        } else {
            (Vec::new(), Vec::new())
        };
        let mut created_at: Vec<Option<String>> = vec![None; blob_part.len()];
        created_at.extend(log_times.into_iter().map(Some));
        let mut messages = blob_part;
        messages.extend(log_part);
        created_at.resize(messages.len(), None);
        Ok(MessagesPageSnapshot {
            messages,
            created_at,
            page: MessagePageMetadata {
                start,
                end,
                total,
                has_older: start > 0,
            },
        })
    }

    /// Length of the merged store transcript without decoding any of it.
    async fn transcript_len(&self) -> Result<u64> {
        let blob_len = {
            let snapshot = self.session_snapshot.lock().await;
            snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.len())
                .unwrap_or_default()
        };
        let (tail_len, _) = self.read_log_tail_window(blob_len, 0, 0).await?;
        Ok((blob_len + tail_len) as u64)
    }

    /// What the user typed to produce the message at `message_idx`, rather
    /// than the expanded prompt the agent was handed: sending it again has to
    /// go back through the same expansion, or a `/plan` would reach the model
    /// as its own instruction sheet.
    pub async fn user_input_at(&self, message_idx: usize) -> Result<String> {
        let messages = self.store_backed_transcript().await?;
        match messages.get(message_idx) {
            Some(Message::User { content }) => Ok(commands::display_prompt_from_message(content)),
            Some(_) => Err(anyhow::anyhow!(
                "message {message_idx} is not a user message, and only a user message can be sent again"
            )),
            None => Err(anyhow::anyhow!(
                "message {message_idx} is not in this session's transcript"
            )),
        }
    }

    /// Take the session back to just before the user message at `message_idx`:
    /// that message and everything after it leave the transcript, and the
    /// checkout returns to the revision that was current when it was sent.
    ///
    /// Order matters. The checkout is restored first, because a git failure
    /// there is recoverable — nothing has been forgotten yet — whereas a
    /// transcript truncated against a checkout that then refuses to move would
    /// leave the two describing different moments with no way back. Everything
    /// after the truncation is bookkeeping that follows from it.
    ///
    /// This is destructive by design and has no undo: the callers above it are
    /// responsible for holding the session's operation lease, so that no run is
    /// writing to the transcript or the checkout while it happens.
    pub async fn revert_to_message(&self, message_idx: usize) -> Result<RevertOutcome> {
        let session_id =
            self.metadata.session_id.clone().ok_or_else(|| {
                anyhow::anyhow!("this session is not persisted, so it cannot revert")
            })?;
        let writer = self
            .transcript_log
            .as_ref()
            .map(Arc::clone)
            .ok_or_else(|| anyhow::anyhow!("this session has no transcript log to revert"))?;

        let messages = self.store_backed_transcript().await?;
        let target = messages.get(message_idx).ok_or_else(|| {
            anyhow::anyhow!("message {message_idx} is not in this session's transcript")
        })?;
        if !matches!(target, Message::User { .. }) {
            return Err(anyhow::anyhow!(
                "message {message_idx} is not a user message, and only a user message marks a point to revert to"
            ));
        }
        let blob_len = {
            let snapshot = self.session_snapshot.lock().await;
            snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.len())
                .unwrap_or_default()
        };
        if message_idx < blob_len {
            return Err(anyhow::anyhow!(
                "message {message_idx} predates this session's transcript log and cannot be reverted to"
            ));
        }

        let store_path = self.metadata.store_path.clone();
        let workspace_git = self.workspace_git.clone();
        let revision = {
            let store_path = store_path.clone();
            let session_id = session_id.clone();
            tokio::task::spawn_blocking(move || {
                crate::store::workspace_revision_at_transcript_len(
                    &store_path,
                    &session_id,
                    message_idx as u64,
                )
            })
            .await
            .map_err(|error| anyhow::anyhow!("workspace revision lookup task failed: {error}"))??
        };

        let workspace_restored = match (&workspace_git, &revision) {
            (Some(target), Some(revision)) => {
                let target = target.clone();
                let session_id = session_id.clone();
                let commit = revision.commit_sha.clone();
                tokio::task::spawn_blocking(move || {
                    crate::workspace::restore(&target, &session_id, &commit)?;
                    crate::workspace::rewind_ref(&target, &session_id, &commit)
                })
                .await
                .map_err(|error| anyhow::anyhow!("workspace restore task failed: {error}"))??;
                true
            }
            _ => false,
        };

        {
            let writer = Arc::clone(&writer);
            let session_id = session_id.clone();
            tokio::task::spawn_blocking(move || {
                writer.delete_from(&session_id, message_idx as u64)
            })
            .await
            .map_err(|error| anyhow::anyhow!("transcript truncation task failed: {error}"))??;
        }

        let kept = &messages[..message_idx];
        {
            let mut agent = self.agent.lock().await;
            agent.messages.truncate(message_idx);
        }
        {
            let mut scan = self
                .transcript_scan
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *scan = TranscriptScanCache::from_transcript(kept);
        }

        // The timing history is indexed by visible response, so it has to lose
        // exactly the responses the transcript just lost, or every later run
        // would attribute its duration to the wrong message.
        let kept_responses = kept
            .iter()
            .filter(|message| is_visible_response(message))
            .count();
        let run_state_update = {
            let mut snapshot = self.session_snapshot.lock().await;
            snapshot.as_mut().map(|snapshot| {
                let mut durations =
                    response_duration_history_from_snapshot(snapshot, kept_responses);
                durations.truncate(kept_responses);
                let mut token_usages = snapshot.token_usages.clone();
                token_usages.truncate(kept_responses);
                // Not response-indexed, so a truncation has nothing to drop
                // from it: the failed runs it accounts for stay accounted for.
                let unattributed_token_usage = snapshot.unattributed_token_usage.clone();
                let last = durations.last().copied().flatten();
                let previous = durations
                    .len()
                    .checked_sub(2)
                    .and_then(|idx| durations.get(idx).copied().flatten());
                snapshot.apply_run_state(sessions::SessionRunState {
                    last_response_duration_ms: last,
                    previous_response_duration_ms: previous,
                    response_durations_ms: Some(durations),
                    token_usages,
                    unattributed_token_usage,
                })
            })
        };
        if let Some(update) = run_state_update {
            let store_path = store_path.clone();
            tokio::task::spawn_blocking(move || {
                sessions::save_session_run_state(&store_path, &update)
            })
            .await
            .map_err(|error| anyhow::anyhow!("session run state task failed: {error}"))??;
        }

        let revisions_removed = {
            let store_path = store_path.clone();
            let session_id = session_id.clone();
            let keep_through_id = revision.as_ref().map(|revision| revision.id);
            tokio::task::spawn_blocking(move || {
                crate::store::delete_workspace_revisions_after(
                    &store_path,
                    &session_id,
                    keep_through_id,
                )
            })
            .await
            .map_err(|error| anyhow::anyhow!("workspace revision prune task failed: {error}"))??
        };

        // Threads the discarded messages dispatched are work nothing can reach
        // any more: the tool calls that named them are gone. A name the kept
        // messages also dispatched stays whole, because the same rows carry the
        // episodes of those earlier dispatches, which the transcript still
        // refers to.
        let orphaned_threads: Vec<String> = {
            let kept_names = thread_tool_call_names(kept);
            thread_tool_call_names(&messages[message_idx..])
                .into_iter()
                .filter(|name| {
                    name != crate::store::ORCHESTRATOR_STEERING_TARGET && !kept_names.contains(name)
                })
                .collect()
        };
        let threads_removed = {
            let store_path = store_path.clone();
            let session_id = session_id.clone();
            tokio::task::spawn_blocking(move || {
                let mut removed = 0usize;
                for name in orphaned_threads {
                    if crate::store::delete_thread(&store_path, &session_id, &name)? {
                        removed += 1;
                    }
                }
                anyhow::Ok(removed)
            })
            .await
            .map_err(|error| anyhow::anyhow!("thread prune task failed: {error}"))??
        };

        self.event_bus.emit(SessionEvent::TranscriptReverted {
            transcript_len: message_idx as u64,
        });

        Ok(RevertOutcome {
            transcript_len: message_idx,
            messages_removed: messages.len() - message_idx,
            workspace_restored,
            revisions_removed,
            threads_removed,
        })
    }

    /// Per-message creation times aligned with [`Self::store_backed_transcript`],
    /// which is why the caller passes the transcript length it already read:
    /// an append landing between the two reads must not shift the alignment.
    /// Blob messages predate the log and report `None`.
    async fn store_backed_transcript_times(&self, total: usize) -> Result<Vec<Option<String>>> {
        let blob_len = {
            let snapshot = self.session_snapshot.lock().await;
            snapshot
                .as_ref()
                .map(|snapshot| snapshot.messages.len())
                .unwrap_or_default()
        }
        .min(total);
        let mut times: Vec<Option<String>> = vec![None; blob_len];
        if total > blob_len {
            let tail = self
                .read_log_tail_window_times(blob_len, 0, total - blob_len)
                .await?;
            times.extend(tail.into_iter().map(Some));
        }
        times.resize(total, None);
        Ok(times)
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
        for (position, message) in (scanned_len..).zip(
            blob_delta
                .iter()
                .chain(rows.iter().map(|(_, message)| message)),
        ) {
            if position >= cache.scanned_len {
                cache.scan_message(position, message);
                cache.scanned_len = position + 1;
            }
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
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .expect("orchestrator services always have a persisted session");
        let operation_lease = match supplied_lease {
            Some(lease) => {
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
            None => Some(
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

        let steering_store = self
            .metadata
            .session_id
            .as_deref()
            .map(|session_id| (self.metadata.store_path.as_path(), session_id));
        match self.active_threads.cancel_and_drain(steering_store).await {
            Ok(records) => self.emit_steering_expired(records),
            Err(error) => eprintln!("nac: failed to expire cancelled worker steering: {error:#}"),
        }

        if let Some(task) = cancelling_run.task {
            task.abort();
            let _ = task.await;
        }

        self.expire_orchestrator_steering(&cancelling_run.snapshot.run_id);

        // A cancellation marker is itself a visible response. If the run task
        // was cancelled before capturing its baseline, record the count before
        // appending that marker so partial cancellation usage still lands on it.
        let transcript_baseline = match cancelling_run.transcript_baseline {
            Some(baseline) => Some(baseline),
            None => {
                if let Err(error) = self.update_transcript_scan().await {
                    eprintln!(
                        "nac: failed to capture transcript baseline for cancellation: {error:#}"
                    );
                }
                Some(self.lock_transcript_scan().visible_response_count)
            }
        };

        // Capture partial token usage from the cancelled run, including a
        // committed compaction projection when cancellation happened before
        // the following ordinary call completed.
        let cancel_usage = self.append_cancellation_message().await;

        let persistence_error = match self
            .persist_run_snapshot(
                &cancelling_run.snapshot,
                transcript_baseline,
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

        // Persistence is bookkeeping after the cancellation boundary. A store
        // fault is still diagnosed above, but it cannot rewrite the user's
        // requested outcome into a run failure.
        if let Some(error) = persistence_error {
            eprintln!(
                "nac: run {} remains cancelled despite snapshot persistence failure: {error}",
                cancelling_run.snapshot.run_id
            );
        }
        self.event_bus.emit_with_context(
            SessionEvent::RunCancelled,
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
                    // The published event is deliberately reduced to "run
                    // failed", so the operator's log is the only place the real
                    // reason can be read.
                    eprintln!("nac: run failed: {message}");
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

        if !self.active_threads.begin_run() {
            return Err(SessionSubmitError::Coordination {
                message: SessionCoordinationError::local_agent_busy(),
            });
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

        if let Some(session_id) = self.metadata.session_id.as_deref() {
            if let Err(error) = sessions::increment_run_count(&self.metadata.store_path, session_id)
            {
                eprintln!("nac: failed to record run count: {error:#}");
            }
        }

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

        self.capture_workspace_revision(&finishing_run.snapshot)
            .await;

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

    /// Freeze the checkout as it stands now, so the run can be revisited later.
    ///
    /// A revision is a convenience, never a precondition for anything, so every
    /// failure here is reported and swallowed: a repository nac cannot capture
    /// still gets its run finished normally.
    async fn capture_workspace_revision(&self, run: &ActiveRunSnapshot) {
        let (Some(session_id), Some(target)) =
            (self.metadata.session_id.clone(), self.workspace_git.clone())
        else {
            return;
        };
        let store_path = self.metadata.store_path.clone();
        let run_id = run.run_id.to_string();
        let label = run.prompt_preview.clone();
        // Recorded now rather than derived later: this is the only moment we
        // can say for certain which transcript prefix the captured files go
        // with, and a revert has nothing else to key off.
        let transcript_len = self.transcript_len().await.ok();

        let outcome = tokio::task::spawn_blocking(move || -> Result<()> {
            let previous = crate::store::latest_workspace_revision(&store_path, &session_id)?
                .map(|revision| revision.commit_sha);
            let captured = crate::workspace::capture(&target, &session_id, previous.as_deref())?;
            crate::store::append_workspace_revision(
                &store_path,
                &session_id,
                crate::store::NewWorkspaceRevision {
                    run_id,
                    commit_sha: captured.commit,
                    base_sha: captured.base,
                    branch: captured.branch,
                    label,
                    additions: captured.additions,
                    deletions: captured.deletions,
                    changed_files: captured.changed_files,
                    transcript_len,
                },
            )?;
            Ok(())
        })
        .await;

        match outcome {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                eprintln!("nac: failed to capture workspace revision: {error:#}");
            }
            Err(error) => {
                eprintln!("nac: workspace revision task failed: {error}");
            }
        }
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
                completed_usage.clone(),
            );
            let unattributed_token_usage = unattributed_usage_after_run(
                snapshot.unattributed_token_usage.clone(),
                current_response_count > previous_response_count,
                completed_usage,
            );
            snapshot.apply_run_state(sessions::SessionRunState {
                last_response_duration_ms: response_timing.last_response_duration_ms,
                previous_response_duration_ms: response_timing.previous_response_duration_ms,
                response_durations_ms: response_timing.response_durations_ms,
                token_usages,
                unattributed_token_usage,
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

    /// Persist the projected context size after a manual compaction so the
    /// frontend context gauge reflects the new (reduced) context. Updates
    /// `unattributed_token_usage` in the in-memory snapshot and SQLite,
    /// preserving all other run-state fields. Called before the compaction
    /// completion SSE event so the debounced snapshot refetch sees the update.
    async fn persist_compaction_context(&self, projected_context: u64) -> Result<()> {
        let update = {
            let mut snapshot = self.session_snapshot.lock().await;
            let Some(snapshot) = snapshot.as_mut() else {
                return Ok(());
            };
            let mut unattributed = snapshot
                .unattributed_token_usage
                .clone()
                .unwrap_or_default();
            unattributed.replace_context(projected_context);
            snapshot.apply_run_state(sessions::SessionRunState {
                last_response_duration_ms: snapshot.last_response_duration_ms,
                previous_response_duration_ms: snapshot.previous_response_duration_ms,
                response_durations_ms: snapshot.response_durations_ms.clone(),
                token_usages: snapshot.token_usages.clone(),
                unattributed_token_usage: Some(unattributed),
            })
        };
        let store_path = self.metadata.store_path.clone();
        tokio::task::spawn_blocking(move || sessions::save_session_run_state(&store_path, &update))
            .await??;
        Ok(())
    }

    async fn append_cancellation_message(&self) -> Option<crate::model::TokenUsage> {
        let mut agent = self.agent.lock().await;
        // Close unfinished tool calls with cancellation results so their
        // thread cards remain in the transcript, then append the marker. A log
        // failure must not fail the cancel; the next restore normalizes any
        // stale tail.
        if let Err(error) = agent.append_cancellation_marker_preserving_tools().await {
            eprintln!("nac: failed to normalize transcript log for cancellation: {error:#}");
        }
        agent.invalidate_context_sample();
        // Return partial usage so the caller can persist it. Because `send()`
        // updates `last_usage` mid-loop, this captures all token usage from
        // model calls made before the cancel.
        agent.last_usage.clone()
    }
}

/// What a revert left behind, so the caller can report it without re-reading
/// everything the revert just changed.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RevertOutcome {
    pub transcript_len: usize,
    pub messages_removed: usize,
    pub workspace_restored: bool,
    pub revisions_removed: usize,
    pub threads_removed: usize,
}

struct LoadedFrontendMessages {
    messages: Vec<Message>,
    created_at: Vec<Option<String>>,
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
        created_at: Vec::new(),
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
        unattributed_token_usage: None,
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
/// most recent response's usage is set from `completed_usage` only when the
/// run appended a new visible response. A failed tool loop can accumulate
/// usage without producing a visible response, and must not overwrite the
/// usage/cost attributed to the preceding response.
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
    if current_response_count > previous_response_count {
        if let (Some(usage), Some(last_index)) =
            (completed_usage, current_response_count.checked_sub(1))
        {
            usages[last_index] = Some(usage);
        }
    }

    usages
}

/// Accumulate billable usage for runs with no visible response without
/// disturbing the response-indexed history. Context tokens remain a latest
/// value gauge while token and cost fields accumulate across failed runs.
fn unattributed_usage_after_run(
    existing: Option<crate::model::TokenUsage>,
    appended_visible_response: bool,
    completed_usage: Option<crate::model::TokenUsage>,
) -> Option<crate::model::TokenUsage> {
    if appended_visible_response {
        return existing.map(|mut cumulative| {
            if completed_usage.is_some() {
                // This response has usage and is now the latest context gauge.
                // Retain failed-run cumulative accounting, but prevent its
                // older gauge from overriding the response in frontend totals.
                cumulative.replace_context(0);
            }
            cumulative
        });
    }
    let Some(completed_usage) = completed_usage else {
        return existing;
    };
    let mut cumulative = existing.unwrap_or_default();
    cumulative.add_cost_saturating(&completed_usage);
    if completed_usage.orchestrator_context_tokens != 0 {
        cumulative.replace_context(completed_usage.orchestrator_context_tokens);
    }
    Some(cumulative)
}

#[cfg(test)]
pub(super) mod tests;
