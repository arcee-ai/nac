use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::{
    sync::{mpsc, watch, Mutex},
    task::JoinHandle,
};
use uuid::Uuid;

use crate::agent::{Agent, RunPromptCommitStatus};
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
use crate::skills::SkillRegistry;
use crate::types::Message;
use crate::view::{
    self, EpisodeSnapshot, SessionSummarySnapshot, ThreadSnapshot, WorksetSnapshot,
    WorksetSummarySnapshot, WorksetsSnapshot, WorkspaceSnapshot,
};
use crate::workspace::GitTarget;

mod admission;
mod attachment;
mod cancellation;
mod direct_interaction;
mod frontend_projection;
mod manual_compaction;
mod recovery;
mod settlement;
mod transcript_projection;

use manual_compaction::ActiveCompactionState;
pub use manual_compaction::{
    SessionCompactionAdmissionError, SessionCompactionError, SessionCompactionHandle,
    SessionCompactionResult, SessionCoordinationError, SessionOperationBusy,
};

pub type AgentEventReceiver = mpsc::UnboundedReceiver<AgentEvent>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionMetadata {
    pub cwd: String,
    #[cfg_attr(feature = "openapi", schema(value_type = Option<String>))]
    pub workspace_host_path: Option<PathBuf>,
    #[cfg_attr(feature = "openapi", schema(value_type = String))]
    pub store_path: PathBuf,
    pub model: String,
    pub backend: String,
    pub session_id: Option<String>,
    #[serde(default)]
    pub behavior: sessions::SessionBehavior,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
            if non_none.is_empty() && snapshot.unattributed_token_usage.is_none() {
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
                if let Some(unattributed) = &snapshot.unattributed_token_usage {
                    cumulative.add_cost_saturating(unattributed);
                    if unattributed.orchestrator_context_tokens != 0 {
                        cumulative.replace_context(unattributed.orchestrator_context_tokens);
                    }
                }
                Some(cumulative)
            }
        };

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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ActiveCompactionSnapshot {
    pub compaction_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    pub started_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ThreadEventPageItem {
    pub id: i64,
    pub created_at: String,
    pub event: AgentEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ThreadEventDecodeDiagnostic {
    pub id: i64,
    pub thread_name: String,
    pub created_at: String,
    pub error: String,
}

const MAX_THREAD_EVENT_DIAGNOSTICS: usize = 64;
const INTERRUPTED_RUN_WARNING: &str =
    "The previous run was interrupted when the nac process stopped. Resubmit the prompt to continue.";
const FAILED_RUN_WARNING: &str =
    "The previous run failed before producing a complete response. Resubmit the prompt to continue.";
const INTERRUPTED_RUN_EVENT_MESSAGE: &str = "run interrupted by process restart";

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
    run_recovery_warning: Option<String>,
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
    NotActive {
        run_id: SessionRunId,
    },
    Cleanup {
        run_id: SessionRunId,
        message: String,
    },
}

impl std::fmt::Display for SessionCancelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotActive { run_id } => write!(formatter, "run {run_id} is not active"),
            Self::Cleanup { run_id, message } => {
                write!(
                    formatter,
                    "run {run_id} cancelled, but terminal cleanup failed: {message}"
                )
            }
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
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.service
            .subscribe_events_for_client_with_replay(self.client_id.clone(), cursor, limit)
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

    #[allow(clippy::result_large_err)]
    pub fn try_submit_prepared_prompt(
        &self,
        prompt: PreparedPrompt,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt(prompt.agent_prompt)
    }

    #[allow(clippy::result_large_err)]
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

    #[allow(clippy::result_large_err)]
    pub fn try_submit_prepared_managed_orchestrator_prompt_with_lease(
        &self,
        prompt: PreparedPrompt,
        lease: sessions::SessionOperationLease,
        execution_mode: crate::store::ManagedOrchestratorExecutionMode,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.service.try_submit_prompt_inner(
            Some(self.client_id.clone()),
            prompt.agent_prompt,
            Some(lease),
            RunAdmissionKind {
                managed_orchestrator_execution_mode: Some(execution_mode),
                ..RunAdmissionKind::default()
            },
        )
    }

    #[allow(clippy::result_large_err)]
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
    goal_runtime: Option<Arc<crate::goals::GoalRuntime>>,
    metadata: Arc<SessionMetadata>,
    /// Where git runs for this session's checkout — locally, or on the ssh host
    /// the session is working on. `None` for a sandbox with no mounted working
    /// directory, which is why such a session gets no revisions: its files do
    /// not outlive the container.
    workspace_git: Option<GitTarget>,
    config_version: Option<i64>,
    session_snapshot: Arc<Mutex<Option<SessionSnapshot>>>,
    transcript_recovery_warning: Arc<StdMutex<Option<String>>>,
    /// Durable recovery row already merged into this cached service. The store
    /// remains authoritative; this only avoids re-reading the same transcript
    /// on every snapshot while an interrupted/failed warning remains visible.
    reconciled_recovery_run_id: Arc<StdMutex<Option<String>>>,
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
    /// The session's skill registry, captured from the agent at construction
    /// so `prepare_user_input` can expand top-level `$skillname` references
    /// without taking the agent lock.
    skills: Option<Arc<SkillRegistry>>,
    terminal_manager: crate::terminal::TerminalManager,
    permission_broker: Option<Arc<crate::permissions::PermissionBroker>>,
    /// A sandbox service owns container-local state even while it has no run
    /// or retained terminal. Keep a shared cross-process resource lease for
    /// the complete attached-service lifetime so peer config/delete mutations
    /// cannot treat a process-local cache miss as absence of ownership.
    sandbox_resource_lease: Arc<StdMutex<Option<sessions::SessionResourceLease>>>,
    /// True when this session executes inside a sandbox container. Persisted
    /// containers survive service drops, but the server still keeps attached
    /// sandbox services cached so their resource lease continuously excludes
    /// peer deletion and configuration mutation.
    has_sandbox: bool,
    /// Serializes process-local idle wake attempts. The cross-process
    /// operation lease remains the authoritative run admission boundary.
    inbox_wake: Arc<Mutex<()>>,
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
    prompt_commit: watch::Sender<RunPromptCommitStatus>,
    /// Visible-response count of the store transcript at run start,
    /// captured by the run task before its first append (step 4,
    /// never-fold): the diff base for the run-end token/timing bookkeeping.
    /// `None` until the task captures it — an early cancel then diffs
    /// against the run-end count, which is exact when nothing was appended.
    transcript_baseline: Option<usize>,
    command_cancellation: crate::tools::ThreadCancellation,
    inbox_item_id: Option<i64>,
    _operation_lease: Option<sessions::SessionOperationLease>,
    _workspace_activity_lease: Option<sessions::WorkspaceActivityLease>,
}

#[derive(Default)]
struct RunAdmissionKind {
    inbox_item_id: Option<i64>,
    goal_continuation: bool,
    child_execution_mode: Option<crate::store::TraditionalChildExecutionMode>,
    managed_orchestrator_execution_mode: Option<crate::store::ManagedOrchestratorExecutionMode>,
}

struct FinishingRun {
    snapshot: ActiveRunSnapshot,
    duration_ms: u64,
    transcript_baseline: Option<usize>,
}

struct CancellingRun {
    service: SessionService,
    snapshot: ActiveRunSnapshot,
    task: Option<JoinHandle<()>>,
    transcript_baseline: Option<usize>,
    command_cancellation: crate::tools::ThreadCancellation,
}

impl Drop for CancellingRun {
    fn drop(&mut self) {
        let mut guard = self.service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_mut() else {
            return;
        };
        if active_run.snapshot.run_id != self.snapshot.run_id {
            return;
        }
        active_run.finishing = false;
        if active_run.task.is_none() {
            active_run.task = self.task.take();
        }
    }
}

#[derive(Clone)]
enum RunOutcome {
    Completed(String, Option<crate::model::TokenUsage>),
    Failed(String, Option<crate::model::TokenUsage>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DurableRunTerminal {
    Completed,
    Cancelled,
    Failed,
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
        self.queue_thread_steering_for_run(thread_name, instruction, None)
            .await
    }

    pub async fn queue_thread_steering_for_run(
        &self,
        thread_name: &str,
        instruction: &str,
        expected_run_id: Option<&str>,
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
                expected_run_id,
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
        commands::prepare_user_input(input, self.skills.as_deref())
    }

    pub fn skill_catalog_entries(&self) -> Vec<crate::skill_catalog::SkillCatalogEntry> {
        self.skills
            .as_deref()
            .map(SkillRegistry::catalog_entries)
            .unwrap_or_default()
    }

    #[allow(clippy::result_large_err)]
    pub fn try_submit_prepared_prompt(
        &self,
        prompt: PreparedPrompt,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt(prompt.agent_prompt)
    }

    /// Pages the merged store transcript without cloning or decoding
    /// messages outside the requested visible window. Callers remain
    /// responsible for any transport-specific maximum; a zero limit retains
    /// the web API's minimum page size of one.
    pub async fn messages_page(&self, request: MessagePageRequest) -> Result<MessagesPageSnapshot> {
        self.page_store_transcript(request).await
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

fn latest_terminal_assistant_report(messages: &[Message]) -> Option<String> {
    messages.iter().rev().find_map(|message| match message {
        Message::Assistant {
            content: Some(content),
            tool_calls,
            ..
        } if content != crate::agent::RUN_CANCELLED_MARKER
            && !content.trim().is_empty()
            && tool_calls.as_ref().is_none_or(Vec::is_empty) =>
        {
            Some(content.clone())
        }
        _ => None,
    })
}

fn extract_report_section(report: &str, heading: &str) -> Option<String> {
    let heading = heading.to_ascii_lowercase();
    let mut collecting = false;
    let mut lines = Vec::new();
    for line in report.lines() {
        let trimmed = line.trim();
        let normalized = trimmed
            .trim_start_matches('#')
            .trim()
            .trim_end_matches(':')
            .to_ascii_lowercase();
        if collecting && trimmed.starts_with('#') {
            break;
        }
        if normalized == heading {
            collecting = true;
            continue;
        }
        if collecting && !trimmed.is_empty() {
            lines.push(trimmed);
        }
    }
    (!lines.is_empty()).then(|| lines.join("\n"))
}

fn goal_continuation_prompt(goal: &crate::store::SessionGoalRecord) -> String {
    let budget = goal.token_budget.map_or_else(
        || "No token budget was set.".to_string(),
        |budget| {
            format!(
                "Token budget: {budget}; used: {}; remaining: {}.",
                goal.tokens_used,
                budget.saturating_sub(goal.tokens_used)
            )
        },
    );
    format!(
        "<nac_goal_continuation goal_id=\"{}\">\nContinue autonomously pursuing this durable goal:\n{}\n{}\nUse get_goal when you need current accounting. Mark it complete only when the objective is genuinely achieved with no required work remaining. Mark it blocked only at a genuine impasse; otherwise finish this turn with a concise progress update and NAC will continue it.\n</nac_goal_continuation>",
        goal.goal_id, goal.objective, budget
    )
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
            if tool_calls.as_ref().is_none_or(std::vec::Vec::is_empty)
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
#[path = "session_service_tests.rs"]
pub(super) mod tests;
