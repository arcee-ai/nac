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

mod direct_interaction;
mod frontend_projection;
mod manual_compaction;
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
    pub fn from_orchestrator_run_config(
        mut run_config: OrchestratorRunConfig,
    ) -> SessionServiceParts {
        let behavior = run_config.session.behavior();
        let store_path = run_config.session.store_path();
        let session_id = run_config.session.session_id().map(str::to_string);
        let restored_messages = run_config.agent.messages.clone();
        let transcript_recovery_warning = run_config
            .agent
            .transcript_recovery_warning()
            .map(str::to_owned);
        let response_timing =
            ResponseTimingSnapshot::from_session_snapshot(match &run_config.session {
                OrchestratorSession::Active { snapshot, .. } => Some(snapshot),
                OrchestratorSession::Picker { .. } => None,
            });
        let config_version = match &run_config.session {
            OrchestratorSession::Active { snapshot, .. } => Some(snapshot.config_version),
            OrchestratorSession::Picker { .. } => None,
        };
        let project_id = match &run_config.session {
            OrchestratorSession::Active { snapshot, .. } => snapshot.project_id.clone(),
            OrchestratorSession::Picker { .. } => None,
        };

        let event_bus =
            SessionEventBus::with_thread_event_store(session_id.clone(), store_path.clone());
        let events = event_bus.subscribe();
        run_config
            .agent
            .set_event_sink(EventSink::bus(event_bus.clone()));
        let permission_broker = run_config
            .agent
            .configure_permission_broker(config_version.unwrap_or(0));
        if let Some(broker) = &permission_broker {
            broker.attach_event_bus(event_bus.clone());
        }
        if let Some(run_id) = run_config.agent.take_interrupted_run_recovery() {
            event_bus.emit_with_context(
                SessionEvent::RunFailed {
                    message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                },
                Some(SessionRunId::from_stored(run_id)),
                None,
            );
        }

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
            behavior,
            project_id,
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
        let has_sandbox = run_config.agent.sandbox_session().is_some();
        let skills = run_config.agent.skills();
        let terminal_manager = run_config.agent.terminal_manager();
        if let Some(target) = workspace_git.as_ref() {
            terminal_manager.configure_workspace_authority(
                metadata.store_path.clone(),
                target.lease_identity(),
            );
        }
        if let Some(session_id) = metadata.session_id.clone() {
            terminal_manager
                .configure_session_resource_authority(metadata.store_path.clone(), session_id);
        }
        let goal_runtime = run_config.agent.goal_runtime();
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
            goal_runtime,
            metadata: Arc::new(metadata.clone()),
            workspace_git,
            config_version,
            session_snapshot: Arc::new(Mutex::new(session_snapshot)),
            transcript_recovery_warning: Arc::new(StdMutex::new(transcript_recovery_warning)),
            reconciled_recovery_run_id: Arc::new(StdMutex::new(None)),
            transcript_log,
            transcript_scan: Arc::new(StdMutex::new(transcript_scan)),
            event_bus,
            active_operation: Arc::new(StdMutex::new(None)),
            active_threads,
            skills,
            terminal_manager,
            permission_broker,
            sandbox_resource_lease: Arc::new(StdMutex::new(None)),
            has_sandbox,
            inbox_wake: Arc::new(Mutex::new(())),
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

    pub async fn attach_client(&self) -> Result<SessionClientAttachment> {
        self.connect_client().attach().await
    }

    pub fn subscribe_events(&self) -> SessionEventReceiver {
        self.event_bus.subscribe()
    }

    pub fn recent_events(
        &self,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> (SessionEventBoundary, Vec<SessionEventEnvelope>) {
        self.event_bus.recent_events(cursor, limit)
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
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        self.event_bus
            .subscribe_for_client_with_replay(client_id, cursor, limit)
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

    /// True while any client holds a live subscription to this session's event
    /// stream (an open SSE connection). A session with live subscribers must
    /// not be evicted from the server's in-memory cache: dropping the service
    /// would drop the event bus's broadcast senders and close their stream.
    pub fn has_event_subscribers(&self) -> bool {
        self.event_bus.has_subscribers()
    }

    /// True when this session executes inside a sandbox container. Idle
    /// eviction skips attached sandbox services so their shared resource
    /// lease continuously excludes peer deletion and configuration mutation.
    pub fn has_sandbox(&self) -> bool {
        self.has_sandbox
    }

    /// Establishes durable peer-visible ownership for an attached sandbox.
    /// Server construction calls this before publishing the service in its
    /// process-local cache.
    pub fn acquire_sandbox_resource_lease(&self) -> Result<()> {
        if !self.has_sandbox {
            return Ok(());
        }
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(());
        };
        let mut lease = self
            .sandbox_resource_lease
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if lease.is_none() {
            *lease = Some(
                sessions::SessionResourceLease::try_acquire(&self.metadata.store_path, session_id)
                    .map_err(anyhow::Error::new)?,
            );
        }
        Ok(())
    }

    /// Installs a shared lease acquired before resume-side resource
    /// materialization. This closes the peer deletion window without opening
    /// a second lock acquisition gap after the service is constructed.
    pub fn adopt_sandbox_resource_lease(&self, lease: sessions::SessionResourceLease) {
        if !self.has_sandbox {
            return;
        }
        let mut slot = self
            .sandbox_resource_lease
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        debug_assert!(slot.is_none());
        *slot = Some(lease);
    }

    /// Deletion is the only operation allowed to relinquish attached sandbox
    /// ownership before the service is dropped. It immediately takes the
    /// exclusive twin, so a peer attachment wins the race only by making the
    /// deletion fail closed.
    pub fn release_sandbox_resource_lease(&self) {
        self.sandbox_resource_lease
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
    }

    pub fn has_retained_terminals(&self) -> bool {
        self.terminal_manager.has_retained()
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

    /// Explicitly destroy the sandbox container (if any) associated with this
    /// session, including when other `Arc` references keep the service alive.
    /// The durable deletion caller owns worktree cleanup after the session row
    /// commits; removing workspace files here would make a later database
    /// failure retain a session whose uncommitted work had already been lost.
    pub async fn destroy_sandbox(&self) -> Result<()> {
        let sandbox = {
            let agent = self.agent.lock().await;
            agent.sandbox_session()
        };
        if let Some(sandbox) = sandbox {
            sandbox.destroy().await?;
        }
        Ok(())
    }

    /// Terminates every session-owned terminal, including explicitly retained
    /// handles. Deletion calls this before removing durable session state so
    /// external service/client clones cannot keep processes alive.
    pub async fn destroy_terminals(&self) -> Result<()> {
        self.terminal_manager.remove_all().await
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

    pub fn has_unreconciled_durable_run_recovery(&self) -> Result<bool> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(false);
        };
        let record = crate::store::load_run_recovery(&self.metadata.store_path, session_id)?;
        let reconciled = self
            .reconciled_recovery_run_id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        Ok(record.is_some_and(|record| reconciled.as_deref() != Some(record.run_id.as_str())))
    }

    /// Reconcile a durable run left by another process and refresh this cached
    /// service's transcript while the caller holds the session operation lease.
    /// This preserves the existing event bus/subscribers instead of replacing
    /// the service after a cross-process handoff.
    pub async fn reconcile_durable_run_recovery(
        &self,
        operation_lease: &sessions::SessionOperationLease,
    ) -> Result<crate::store::ActiveRunReconciliation> {
        let session_id = self
            .metadata
            .session_id
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("run recovery requires a persisted session"))?;
        if self.has_active_operation() {
            return Err(anyhow::anyhow!(
                "cannot reconcile durable run recovery while a local operation is active"
            ));
        }
        operation_lease
            .validate(&self.metadata.store_path, session_id)
            .map_err(anyhow::Error::new)?;
        let recovery = crate::store::reconcile_active_run(&self.metadata.store_path, session_id)?;
        let mut snapshot =
            sessions::load_session_async(self.metadata.store_path.clone(), session_id.to_string())
                .await?;
        if Some(snapshot.config_version) != self.config_version {
            return Err(anyhow::anyhow!(
                "session '{session_id}' configuration changed before run recovery"
            ));
        }

        let (transcript_scan, transcript_warning, terminal_report) = {
            let mut agent = self.agent.lock().await;
            if let Some(refreshed_blob) = agent
                .restore_messages_merging_log_tail(snapshot.messages.clone(), Some(operation_lease))
                .await?
            {
                snapshot.messages = refreshed_blob;
            }
            (
                TranscriptScanCache::from_transcript(&agent.messages),
                agent.transcript_recovery_warning().map(str::to_owned),
                latest_terminal_assistant_report(&agent.messages),
            )
        };
        *self.session_snapshot.lock().await = Some(snapshot);
        *self.lock_transcript_scan() = transcript_scan;
        *self
            .transcript_recovery_warning
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = transcript_warning;
        let reconciled_run_id =
            crate::store::load_run_recovery(&self.metadata.store_path, session_id)?
                .map(|record| record.run_id);
        *self
            .reconciled_recovery_run_id
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = reconciled_run_id;

        match &recovery {
            crate::store::ActiveRunReconciliation::CanonicalTerminal => {
                if let Some(record) =
                    crate::store::load_run_recovery(&self.metadata.store_path, session_id)?
                {
                    if let Some(disposition) = record.terminal_disposition {
                        let status = match disposition {
                            crate::store::RunTerminalDisposition::Completed => {
                                crate::store::TraditionalChildStatus::Completed
                            }
                            crate::store::RunTerminalDisposition::Cancelled => {
                                crate::store::TraditionalChildStatus::Cancelled
                            }
                        };
                        self.settle_traditional_child_run(
                            &SessionRunId::from_stored(record.run_id),
                            status,
                            (disposition == crate::store::RunTerminalDisposition::Completed)
                                .then(|| terminal_report.clone())
                                .flatten(),
                            None,
                        )
                        .await;
                    }
                }
            }
            crate::store::ActiveRunReconciliation::Failed { run_id } => {
                self.event_bus.emit_with_context(
                    SessionEvent::RunFailed {
                        message: FAILED_RUN_WARNING.to_string(),
                    },
                    Some(SessionRunId::from_stored(run_id.clone())),
                    None,
                );
                self.settle_traditional_child_run(
                    &SessionRunId::from_stored(run_id.clone()),
                    crate::store::TraditionalChildStatus::Failed,
                    None,
                    Some(FAILED_RUN_WARNING.to_string()),
                )
                .await;
            }
            crate::store::ActiveRunReconciliation::Interrupted { run_id } => {
                self.event_bus.emit_with_context(
                    SessionEvent::RunFailed {
                        message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                    },
                    Some(SessionRunId::from_stored(run_id.clone())),
                    None,
                );
                self.settle_traditional_child_run(
                    &SessionRunId::from_stored(run_id.clone()),
                    crate::store::TraditionalChildStatus::Interrupted,
                    None,
                    Some(INTERRUPTED_RUN_WARNING.to_string()),
                )
                .await;
            }
            crate::store::ActiveRunReconciliation::None => {}
        }
        Ok(recovery)
    }

    /// Settle a child generation whose durable run-recovery row was already
    /// reconciled while constructing this service after restart.
    pub async fn reconcile_traditional_child_terminal(
        &self,
    ) -> Result<Option<crate::store::TraditionalChildRecord>> {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return Ok(None);
        };
        let Some(child) =
            crate::store::load_traditional_child(&self.metadata.store_path, session_id)?
        else {
            return Ok(None);
        };
        if child.status != crate::store::TraditionalChildStatus::Running {
            return Ok(Some(child));
        }
        let recovery = crate::store::load_run_recovery(&self.metadata.store_path, session_id)?;
        let recovery = match recovery {
            Some(recovery) => recovery,
            None => {
                if self.active_run().is_some() {
                    return Ok(Some(child));
                }
                let _lease = match sessions::SessionOperationLease::try_acquire(
                    &self.metadata.store_path,
                    session_id,
                ) {
                    Ok(lease) => lease,
                    Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                        return Ok(Some(child));
                    }
                    Err(error) => return Err(anyhow::Error::new(error)),
                };
                if crate::store::load_run_recovery(&self.metadata.store_path, session_id)?.is_some()
                {
                    return Ok(Some(child));
                }
                let Some(run_id) = child.run_id.as_deref() else {
                    return Err(anyhow::anyhow!(
                        "running traditional child has no bound run id"
                    ));
                };
                self.settle_traditional_child_run(
                    &SessionRunId::from_stored(run_id.to_string()),
                    crate::store::TraditionalChildStatus::Interrupted,
                    None,
                    Some(
                        "child run ended before its prompt and recovery obligation committed"
                            .to_string(),
                    ),
                )
                .await;
                return crate::store::load_traditional_child(&self.metadata.store_path, session_id);
            }
        };
        if recovery.run_id != child.run_id.as_deref().unwrap_or_default() {
            return Ok(Some(child));
        }
        let (status, report, failure) = if let Some(disposition) = recovery.terminal_disposition {
            (
                match disposition {
                    crate::store::RunTerminalDisposition::Completed => {
                        crate::store::TraditionalChildStatus::Completed
                    }
                    crate::store::RunTerminalDisposition::Cancelled => {
                        crate::store::TraditionalChildStatus::Cancelled
                    }
                },
                if disposition == crate::store::RunTerminalDisposition::Completed {
                    self.messages_snapshot()
                        .await
                        .ok()
                        .and_then(|messages| latest_terminal_assistant_report(&messages))
                } else {
                    None
                },
                String::new(),
            )
        } else {
            match recovery.status {
                crate::store::RunRecoveryStatus::Active => return Ok(Some(child)),
                crate::store::RunRecoveryStatus::Interrupted => (
                    crate::store::TraditionalChildStatus::Interrupted,
                    None,
                    INTERRUPTED_RUN_WARNING.to_string(),
                ),
                crate::store::RunRecoveryStatus::Failed => (
                    crate::store::TraditionalChildStatus::Failed,
                    None,
                    FAILED_RUN_WARNING.to_string(),
                ),
            }
        };
        self.settle_traditional_child_run(
            &SessionRunId::from_stored(recovery.run_id),
            status,
            report,
            (!failure.is_empty()).then_some(failure),
        )
        .await;
        crate::store::load_traditional_child(&self.metadata.store_path, session_id)
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
        // state, including direct callers.
        //
        // The transcript refresh is load-bearing for shared-store recovery
        // (issue #146): this long-lived service can survive the peer process
        // that owned the previous run. The OS releases the peer's lease on
        // its death, but the cached agent's in-memory transcript still
        // predates the peer's committed rows — a run started from it would
        // append at a stale index (rejected by the log's contiguity guard)
        // and terminal normalization would delete the peer's committed rows
        // from the stale length. Re-restoring under the lease is race-free.
        if let Some(lease) = operation_lease.as_ref() {
            let mut agent = self.agent.try_lock().map_err(|_| {
                OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::local_agent_busy(),
                }
            })?;
            let durable_blob = agent
                .refresh_transcript_under_lease(lease)
                .map_err(|error| OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to refresh the transcript under the operation lease: {error:#}"
                    )),
                })?;
            agent.restore_compaction_checkpoint().map_err(|error| {
                OperationAdmissionPreparationError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to reload compaction checkpoint: {error:#}"
                    )),
                }
            })?;
            drop(agent);
            if let (Some(session_id), Some(durable_blob)) =
                (self.metadata.session_id.as_deref(), durable_blob)
            {
                // Reconcile every run-state field that the next completion
                // persists, not only the transcript blob. A peer may have
                // committed token and timing history before releasing the
                // lease; retaining the stale cached values would make this
                // process overwrite that history at its next run end.
                //
                // Load after transcript repair so `durable_blob` and the
                // persisted run state describe the same lease-held store
                // state. Keep cached identity/configuration fields: cwd is
                // runtime-canonicalized, and the config revision was checked
                // above.
                let (durable_run_state, durable_updated_at) =
                    sessions::load_session_run_state(&self.metadata.store_path, session_id)
                        .map_err(|error| OperationAdmissionPreparationError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to refresh durable session run state: {error:#}"
                            )),
                        })?;
                let mut snapshot = self.session_snapshot.try_lock().map_err(|_| {
                    OperationAdmissionPreparationError::Coordination {
                        message: SessionCoordinationError::local_agent_busy(),
                    }
                })?;
                if let Some(snapshot) = snapshot.as_mut() {
                    snapshot.messages = durable_blob;
                    snapshot.last_response_duration_ms =
                        durable_run_state.last_response_duration_ms;
                    snapshot.previous_response_duration_ms =
                        durable_run_state.previous_response_duration_ms;
                    snapshot.response_durations_ms = durable_run_state.response_durations_ms;
                    snapshot.token_usages = durable_run_state.token_usages;
                    snapshot.unattributed_token_usage = durable_run_state.unattributed_token_usage;
                    snapshot.updated_at = durable_updated_at;
                }
            }
        }

        Ok(operation_lease)
    }

    #[allow(clippy::result_large_err)]
    pub fn try_submit_prompt(
        &self,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(None, expanded_prompt, None, RunAdmissionKind::default())
    }

    #[allow(clippy::result_large_err)]
    pub fn try_submit_prompt_for_client(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(
            Some(client_id),
            expanded_prompt,
            None,
            RunAdmissionKind::default(),
        )
    }

    #[allow(clippy::result_large_err)]
    pub fn try_submit_prompt_for_client_with_lease(
        &self,
        client_id: SessionClientId,
        expanded_prompt: String,
        lease: sessions::SessionOperationLease,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(
            Some(client_id),
            expanded_prompt,
            Some(lease),
            RunAdmissionKind::default(),
        )
    }

    #[allow(clippy::result_large_err)]
    pub fn try_submit_traditional_child_prompt(
        &self,
        expanded_prompt: String,
        execution_mode: crate::store::TraditionalChildExecutionMode,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        self.try_submit_prompt_inner(
            None,
            expanded_prompt,
            None,
            RunAdmissionKind {
                child_execution_mode: Some(execution_mode),
                ..RunAdmissionKind::default()
            },
        )
    }

    pub async fn request_cancel(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        // Cancellation owns terminal cleanup and several durable settlement
        // commits. Run it in an owned task so dropping an HTTP/tool caller can
        // never cancel the settlement future between those commits.
        let service = self.clone();
        let owned_run_id = run_id.clone();
        match tokio::spawn(async move { service.request_cancel_owned(&owned_run_id).await }).await {
            Ok(result) => result,
            Err(error) => Err(SessionCancelError::Cleanup {
                run_id: run_id.clone(),
                message: format!("cancellation settlement task failed: {error}"),
            }),
        }
    }

    async fn request_cancel_owned(
        &self,
        run_id: &SessionRunId,
    ) -> std::result::Result<(), SessionCancelError> {
        let Some(prompt_commit) = self.run_prompt_commit(run_id) else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };
        let mut prompt_commit = prompt_commit.subscribe();
        loop {
            let status = *prompt_commit.borrow();
            match status {
                RunPromptCommitStatus::Pending => {
                    if prompt_commit.changed().await.is_err() {
                        return Err(SessionCancelError::NotActive {
                            run_id: run_id.clone(),
                        });
                    }
                }
                RunPromptCommitStatus::Committed => break,
                RunPromptCommitStatus::Failed => {
                    return Err(SessionCancelError::NotActive {
                        run_id: run_id.clone(),
                    });
                }
            }
        }
        let Some(mut cancelling_run) = self.mark_run_cancelling(run_id) else {
            return Err(SessionCancelError::NotActive {
                run_id: run_id.clone(),
            });
        };

        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            cancelling_run.command_cancellation.cancel();
            // Terminal handles are session-owned and can be idle while the
            // model is between tool calls. Start settlement immediately, then
            // repeat it after the run task has stopped. PTY spawn and input
            // share the cancellation token's final mutation gate, so neither
            // can cross this cancellation boundary after it wins.
            let _ = self.terminal_manager.settle_run().await;
        }

        let steering_store = self
            .metadata
            .session_id
            .as_deref()
            .map(|session_id| (self.metadata.store_path.as_path(), session_id));
        match self.active_threads.cancel_and_drain(steering_store).await {
            Ok(records) => self.emit_steering_expired(records),
            Err(error) => eprintln!("nac: failed to expire cancelled worker steering: {error:#}"),
        }

        if let Some(task) = cancelling_run.task.as_mut() {
            let abort = self.metadata.behavior == sessions::SessionBehavior::Orchestrator
                || tokio::time::timeout(Duration::from_secs(2), &mut *task)
                    .await
                    .is_err();
            if abort {
                task.abort();
                let _ = (&mut *task).await;
            }
        }

        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.terminal_manager.settle_run().await {
                // Cleanup is a terminal-state admission boundary. Keep the run,
                // its operation lease, goal/child bindings, and queued inbox
                // successor unsettled so a later cancellation can retry.
                return Err(SessionCancelError::Cleanup {
                    run_id: cancelling_run.snapshot.run_id.clone(),
                    message: format!("{error:#}"),
                });
            }
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
                cancel_usage.clone(),
                DurableRunTerminal::Cancelled,
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
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            self.settle_direct_goal_run(
                &cancelling_run.snapshot.run_id,
                cancel_usage,
                crate::store::GoalRunDisposition::Cancelled,
            )
            .await;
            self.capture_workspace_revision(&cancelling_run.snapshot)
                .await;
            self.settle_traditional_child_run(
                &cancelling_run.snapshot.run_id,
                crate::store::TraditionalChildStatus::Cancelled,
                None,
                Some("parent or user cancelled the child run".to_string()),
            )
            .await;
        }
        self.event_bus.emit_with_context(
            SessionEvent::RunCancelled,
            Some(cancelling_run.snapshot.run_id.clone()),
            cancelling_run.snapshot.client_id.clone(),
        );
        self.clear_finished_run(&cancelling_run.snapshot.run_id);
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.start_next_direct_inbox_item().await {
                eprintln!("nac: failed to promote direct inbox after cancellation: {error:#}");
            }
        }
        Ok(())
    }

    #[allow(clippy::result_large_err)]
    fn try_submit_prompt_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: String,
        operation_lease: Option<sessions::SessionOperationLease>,
        admission: RunAdmissionKind,
    ) -> std::result::Result<SessionRunHandle, SessionSubmitError> {
        let active_run =
            self.try_begin_run_with_lease(client_id, &expanded_prompt, operation_lease, admission)?;
        let run_id = active_run.run_id.clone();
        let task_run_id = run_id.clone();
        let run_client_id = active_run.client_id.clone();
        let prompt_commit = self
            .run_prompt_commit(&run_id)
            .expect("newly admitted run must own its prompt commit channel");
        let inbox_item_id = self.run_inbox_item_id(&run_id);
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
                    .send_session_run(&expanded_prompt, &task_run_id, prompt_commit, inbox_item_id)
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
                        .finish_run(&task_run_id, RunOutcome::Completed(response, usage))
                        .await;
                }
                Err(message) => {
                    // The published event is deliberately reduced to "run
                    // failed", so the operator's log is the only place the real
                    // reason can be read.
                    eprintln!("nac: run failed: {message}");
                    service
                        .finish_run(&task_run_id, RunOutcome::Failed(message, usage))
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
        let active = self.try_begin_run_inner(
            client_id,
            expanded_prompt,
            None,
            false,
            RunAdmissionKind::default(),
        )?;
        self.run_prompt_commit(&active.run_id)
            .expect("test run admission must own a prompt commit channel")
            .send_replace(RunPromptCommitStatus::Committed);
        Ok(active)
    }

    #[allow(clippy::result_large_err)]
    fn try_begin_run_with_lease(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionOperationLease>,
        admission: RunAdmissionKind,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        self.try_begin_run_inner(client_id, expanded_prompt, supplied_lease, true, admission)
    }

    #[allow(clippy::result_large_err)]
    fn try_begin_run_inner(
        &self,
        client_id: Option<SessionClientId>,
        expanded_prompt: &str,
        supplied_lease: Option<sessions::SessionOperationLease>,
        enforce_coordination: bool,
        admission: RunAdmissionKind,
    ) -> std::result::Result<ActiveRunSnapshot, SessionSubmitError> {
        let RunAdmissionKind {
            inbox_item_id,
            goal_continuation,
            child_execution_mode,
            managed_orchestrator_execution_mode,
        } = admission;
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
        let workspace_activity_lease = if enforce_coordination {
            self.terminal_manager
                .acquire_workspace_activity_lease()
                .map_err(|error| SessionSubmitError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to acquire workspace run authority: {error:#}"
                    )),
                })?
        } else {
            None
        };

        if enforce_coordination {
            if let Some(session_id) = self.metadata.session_id.as_deref() {
                let recovery =
                    crate::store::reconcile_active_run(&self.metadata.store_path, session_id)
                        .map_err(|error| SessionSubmitError::Coordination {
                            message: SessionCoordinationError::store(format!(
                                "failed to reconcile interrupted run state: {error:#}"
                            )),
                        })?;
                if let crate::store::ActiveRunReconciliation::Interrupted { run_id } = recovery {
                    self.event_bus.emit_with_context(
                        SessionEvent::RunFailed {
                            message: INTERRUPTED_RUN_EVENT_MESSAGE.to_string(),
                        },
                        Some(SessionRunId::from_stored(run_id)),
                        None,
                    );
                }
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
        if !self.active_threads.begin_run(run_id.as_str()) {
            return Err(SessionSubmitError::Coordination {
                message: SessionCoordinationError::local_agent_busy(),
            });
        }

        let command_cancellation =
            if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
                // Orchestrator cancellation continues through its established
                // active-thread registry and must not add a new agent-lock
                // admission requirement.
                crate::tools::ThreadCancellation::default()
            } else {
                self.agent
                    .try_lock()
                    .map_err(|_| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::local_agent_busy(),
                    })?
                    .begin_run_cancellation()
            };

        let submitted_at_epoch_ms = now_epoch_ms();
        let submitted_user_message = (!goal_continuation).then(|| SubmittedUserMessageSnapshot {
            run_id: run_id.clone(),
            client_id: client_id.clone(),
            content: expanded_prompt.to_string(),
            submitted_at_epoch_ms,
        });
        let active_run = ActiveRunSnapshot {
            run_id,
            client_id,
            // Preview what the user typed, not the expanded prompt: this
            // text feeds the events feed, history subtitles, and revision
            // labels, where `<invoked_skills>`/skill-body fragments would
            // leak.
            prompt_preview: if goal_continuation {
                "Durable goal continuation".to_string()
            } else {
                prompt_preview(&commands::display_prompt_from_message(expanded_prompt), 160)
            },
            submitted_user_message,
            started_at_epoch_ms: submitted_at_epoch_ms,
        };
        let (prompt_commit, _prompt_commit_receiver) =
            watch::channel(RunPromptCommitStatus::Pending);
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            if let (Some(session_id), Some(execution_mode)) = (
                self.metadata.session_id.as_deref(),
                managed_orchestrator_execution_mode,
            ) {
                crate::store::begin_managed_orchestrator_run(
                    &self.metadata.store_path,
                    session_id,
                    active_run.run_id.as_str(),
                    execution_mode,
                )
                .map_err(|error| SessionSubmitError::Coordination {
                    message: SessionCoordinationError::store(format!(
                        "failed to bind managed orchestrator generation to run: {error:#}"
                    )),
                })?;
            }
        } else {
            if let Some(session_id) = self.metadata.session_id.as_deref() {
                if crate::store::load_traditional_child(&self.metadata.store_path, session_id)
                    .map_err(|error| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to inspect traditional child relationship: {error:#}"
                        )),
                    })?
                    .is_some()
                {
                    crate::store::begin_traditional_child_run(
                        &self.metadata.store_path,
                        session_id,
                        active_run.run_id.as_str(),
                        child_execution_mode
                            .unwrap_or(crate::store::TraditionalChildExecutionMode::Background),
                    )
                    .map_err(|error| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to bind traditional child generation to run: {error:#}"
                        )),
                    })?;
                } else {
                    crate::store::bind_session_goal_run(
                        &self.metadata.store_path,
                        session_id,
                        &crate::store::GoalRunBaseline {
                            run_id: active_run.run_id.to_string(),
                            billable_tokens: 0,
                            started_at_epoch_ms: active_run.started_at_epoch_ms,
                            continuation: goal_continuation,
                        },
                    )
                    .map_err(|error| SessionSubmitError::Coordination {
                        message: SessionCoordinationError::store(format!(
                            "failed to bind goal accounting to run: {error:#}"
                        )),
                    })?;
                }
            }
        }
        *guard = Some(ActiveSessionOperation::Run(ActiveRunState {
            snapshot: active_run.clone(),
            started_at: Instant::now(),
            finishing: false,
            task: None,
            prompt_commit,
            transcript_baseline: None,
            command_cancellation,
            inbox_item_id,
            _operation_lease: operation_lease,
            _workspace_activity_lease: workspace_activity_lease,
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

    async fn finish_run(&self, run_id: &SessionRunId, outcome: RunOutcome) {
        loop {
            if self.finish_run_once(run_id, outcome.clone()).await {
                return;
            }
            let retry_cleanup = {
                let guard = self.lock_active_operation();
                matches!(
                    guard.as_ref(),
                    Some(ActiveSessionOperation::Run(active_run))
                        if &active_run.snapshot.run_id == run_id && !active_run.finishing
                )
            };
            if !retry_cleanup {
                return;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    async fn finish_run_once(&self, run_id: &SessionRunId, outcome: RunOutcome) -> bool {
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.terminal_manager.settle_run().await {
                self.event_bus.emit_agent(AgentEvent::Error {
                    thread_name: None,
                    message: format!(
                        "run {run_id} remains active because terminal cleanup is incomplete: {error:#}"
                    ),
                });
                return false;
            }
        }
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
        let durable_terminal = if matches!(outcome, RunOutcome::Failed(..)) {
            DurableRunTerminal::Failed
        } else {
            DurableRunTerminal::Completed
        };
        let goal_usage = completed_usage.clone();
        let goal_disposition = if matches!(outcome, RunOutcome::Failed(..)) {
            crate::store::GoalRunDisposition::Failed
        } else {
            crate::store::GoalRunDisposition::Completed
        };
        let persistence_error = match self
            .persist_run_snapshot(
                &finishing_run.snapshot,
                finishing_run.transcript_baseline,
                completed_duration_ms,
                completed_usage,
                durable_terminal,
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

        let (child_status, child_report, child_failure) = match &outcome {
            RunOutcome::Completed(response, _) => (
                crate::store::TraditionalChildStatus::Completed,
                Some(response.clone()),
                None,
            ),
            RunOutcome::Failed(message, _) => (
                crate::store::TraditionalChildStatus::Failed,
                None,
                Some(message.clone()),
            ),
        };
        self.settle_traditional_child_run(run_id, child_status, child_report, child_failure)
            .await;

        self.settle_direct_goal_run(run_id, goal_usage, goal_disposition)
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
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            if let Err(error) = self.start_next_direct_inbox_item().await {
                eprintln!("nac: failed to promote direct inbox after run settlement: {error:#}");
            }
        }
        true
    }

    async fn settle_direct_goal_run(
        &self,
        run_id: &SessionRunId,
        usage: Option<crate::model::TokenUsage>,
        disposition: crate::store::GoalRunDisposition,
    ) {
        if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            return;
        }
        if let Some(session_id) = self.metadata.session_id.as_deref() {
            if let Err(error) = crate::store::settle_session_goal_run(
                &self.metadata.store_path,
                session_id,
                run_id.as_str(),
                usage
                    .as_ref()
                    .map_or(0, crate::model::TokenUsage::billable_tokens),
                now_epoch_ms(),
                disposition,
            ) {
                eprintln!("nac: failed to settle durable goal for run {run_id}: {error:#}");
            }
        }
        self.agent.lock().await.end_goal_run(run_id);
    }

    async fn settle_traditional_child_run(
        &self,
        run_id: &SessionRunId,
        status: crate::store::TraditionalChildStatus,
        report: Option<String>,
        failure: Option<String>,
    ) {
        let Some(session_id) = self.metadata.session_id.as_deref() else {
            return;
        };
        let child =
            match crate::store::load_traditional_child(&self.metadata.store_path, session_id) {
                Ok(Some(child)) => child,
                Ok(None) => return,
                Err(error) => {
                    eprintln!("nac: failed to inspect traditional child settlement: {error:#}");
                    return;
                }
            };
        let revision = crate::store::workspace_revision_for_run(
            &self.metadata.store_path,
            session_id,
            run_id.as_str(),
        )
        .unwrap_or_else(|error| {
            eprintln!("nac: failed to read child workspace revision: {error:#}");
            None
        });
        let change_summary = revision.map(|revision| {
            format!(
                "{} files changed, +{} -{}",
                revision.changed_files, revision.additions, revision.deletions
            )
        });
        let verification_summary = report
            .as_deref()
            .and_then(|report| extract_report_section(report, "verification"));
        match crate::store::settle_traditional_child_run(
            &self.metadata.store_path,
            session_id,
            run_id.as_str(),
            crate::store::TraditionalChildTerminal {
                status,
                report,
                failure,
                change_summary,
                verification_summary,
            },
        ) {
            Ok(settlement)
                if settlement.newly_settled && settlement.child.completion_inbox_id.is_some() =>
            {
                if let Ok(controller) =
                    crate::traditional_children::controller_for(&self.metadata.store_path)
                {
                    let parent_session_id = child.parent_session_id.clone();
                    tokio::spawn(async move {
                        if let Err(error) = controller.wake(&parent_session_id).await {
                            eprintln!(
                                "nac: failed to wake parent after child settlement: {error:#}"
                            );
                        }
                    });
                }
                if let Err(error) = crate::store::clear_settled_run_recovery(
                    &self.metadata.store_path,
                    session_id,
                    run_id.as_str(),
                ) {
                    eprintln!(
                        "nac: failed to clear settled child recovery for run {run_id}: {error:#}"
                    );
                }
            }
            Ok(_) => {
                if let Err(error) = crate::store::clear_settled_run_recovery(
                    &self.metadata.store_path,
                    session_id,
                    run_id.as_str(),
                ) {
                    eprintln!(
                        "nac: failed to clear settled child recovery for run {run_id}: {error:#}"
                    );
                }
            }
            Err(error) => {
                eprintln!("nac: failed to settle traditional child run {run_id}: {error:#}");
            }
        }
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
        let result = if self.metadata.behavior == sessions::SessionBehavior::Orchestrator {
            agent.normalize_dangling_tail().await
        } else {
            agent.normalize_failed_tail_preserving_partial().await
        };
        if let Err(error) = result {
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
            service: self.clone(),
            snapshot: active_run.snapshot.clone(),
            task: active_run.task.take(),
            transcript_baseline: active_run.transcript_baseline,
            command_cancellation: active_run.command_cancellation.clone(),
        })
    }

    fn run_prompt_commit(
        &self,
        run_id: &SessionRunId,
    ) -> Option<watch::Sender<RunPromptCommitStatus>> {
        let guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_ref() else {
            return None;
        };
        (&active_run.snapshot.run_id == run_id).then(|| active_run.prompt_commit.clone())
    }

    fn run_inbox_item_id(&self, run_id: &SessionRunId) -> Option<i64> {
        let guard = self.lock_active_operation();
        let Some(ActiveSessionOperation::Run(active_run)) = guard.as_ref() else {
            return None;
        };
        (&active_run.snapshot.run_id == run_id)
            .then_some(active_run.inbox_item_id)
            .flatten()
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
        durable_terminal: DurableRunTerminal,
    ) -> Result<()> {
        let goal_final_billable_tokens = completed_usage
            .as_ref()
            .map_or(0, crate::model::TokenUsage::billable_tokens);
        {
            let snapshot = self.session_snapshot.lock().await;
            if snapshot.is_none() {
                return Ok(());
            }
        }
        self.update_transcript_scan().await?;
        let current_response_count = self.lock_transcript_scan().visible_response_count;
        let mut update = {
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
        match durable_terminal {
            DurableRunTerminal::Completed | DurableRunTerminal::Cancelled => {
                update.finished_run_id = Some(active_run.run_id.to_string());
                update.finished_run_disposition = Some(match durable_terminal {
                    DurableRunTerminal::Completed => {
                        crate::store::RunTerminalDisposition::Completed
                    }
                    DurableRunTerminal::Cancelled => {
                        crate::store::RunTerminalDisposition::Cancelled
                    }
                    DurableRunTerminal::Failed => unreachable!(),
                });
            }
            DurableRunTerminal::Failed => {
                update.failed_run_id = Some(active_run.run_id.to_string());
            }
        }
        if self.metadata.behavior != sessions::SessionBehavior::Orchestrator {
            update.goal_settlement = Some(crate::store::GoalRunSettlement {
                run_id: active_run.run_id.to_string(),
                final_billable_tokens: goal_final_billable_tokens,
                terminal_at_epoch_ms: now_epoch_ms(),
                disposition: match durable_terminal {
                    DurableRunTerminal::Completed => crate::store::GoalRunDisposition::Completed,
                    DurableRunTerminal::Cancelled => crate::store::GoalRunDisposition::Cancelled,
                    DurableRunTerminal::Failed => crate::store::GoalRunDisposition::Failed,
                },
            });
        }
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
#[path = "session_service_tests.rs"]
pub(super) mod tests;
