use std::{
    collections::VecDeque,
    io::{self, Write},
    path::PathBuf,
    sync::{Arc, Mutex as StdMutex},
};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc::UnboundedSender};
use uuid::Uuid;

use crate::agent::key_arg_preview;
use crate::model::redact_credentials;

pub const STDERR_EVENT_PREFIX: &str = "__NAC_EVENT__";
pub const SESSION_EVENT_BUS_CAPACITY: usize = 1024;
pub const SESSION_EVENT_BUS_REPLAY_BYTE_CAP: usize = 256 * 1024;
/// Deltas are coalesced before they reach the bus, so this holds many seconds
/// of output for a subscriber that is briefly slow to read.
pub const ASSISTANT_DELTA_CHANNEL_CAPACITY: usize = 256;

/// Internal thread-event target for sanitized top-level tool lifecycle rows.
///
/// Primary direct calls have no worker `thread_name`, but their safe event
/// projection must survive reload so the transcript does not fall back to raw
/// durable tool payloads. This target is never exposed as a worker thread; the
/// frontend snapshot projection separates its events into `primary_tool_events`.
pub(crate) const PRIMARY_TOOL_EVENT_TARGET: &str = "__nac_primary_tools__";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionClientId(String);

impl SessionClientId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SessionClientId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionClientId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionSubscriptionId(String);

impl SessionSubscriptionId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SessionSubscriptionId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionSubscriptionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionRunId(String);

impl SessionRunId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub(crate) fn from_stored(value: String) -> Self {
        Self(value)
    }
}

impl Default for SessionRunId {
    fn default() -> Self {
        Self::new()
    }
}

impl std::fmt::Display for SessionRunId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CompactionReason {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CompactionSkipReason {
    NoEligibleBoundary,
    AlreadyCompacted,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum CompactionFailure {
    SummaryRequestFailed,
    SummaryRejected,
    CheckpointPersistenceFailed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ToolCompletionStatus {
    Success,
    Error,
    TimedOut,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum McpNotificationKind {
    CatalogRefreshed,
    CatalogRefreshFailed,
    ResourceUpdated,
    Log,
    Progress,
    SubscriptionEnded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum AgentEvent {
    RunStarted {
        thread_name: Option<String>,
        prompt_preview: String,
    },
    ModelCallStarted {
        thread_name: Option<String>,
        iteration: usize,
    },
    TokenUsageUpdated {
        thread_name: Option<String>,
        usage: crate::model::TokenUsage,
    },
    ToolCallStarted {
        thread_name: Option<String>,
        call_id: String,
        name: String,
        args_preview: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        key_arg_preview: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        args_detail: Option<String>,
    },
    ToolCallFinished {
        thread_name: Option<String>,
        call_id: String,
        name: String,
        content_preview: String,
        is_error: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        command_status: Option<crate::terminal::CommandStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        completion_status: Option<ToolCompletionStatus>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        effective_timeout_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        execution_duration_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cleanup_duration_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        remote_outcome_uncertain: bool,
    },
    ThreadStarted {
        name: String,
        action: String,
        source_threads: Vec<String>,
    },
    ThreadLog {
        name: String,
        line: String,
    },
    ThreadSteeringQueued {
        name: String,
        steering_id: i64,
        instruction_preview: String,
    },
    ThreadSteeringDelivered {
        name: String,
        steering_id: i64,
        instruction_preview: String,
    },
    ThreadSteeringExpired {
        name: String,
        steering_id: i64,
        instruction_preview: String,
    },
    OrchestratorSteeringQueued {
        steering_id: i64,
        instruction_preview: String,
    },
    OrchestratorSteeringDelivered {
        steering_id: i64,
        instruction_preview: String,
    },
    OrchestratorSteeringExpired {
        steering_id: i64,
        instruction_preview: String,
    },
    OrchestratorCompactionStarted {
        compaction_id: Uuid,
        reason: CompactionReason,
    },
    OrchestratorCompactionCompleted {
        compaction_id: Uuid,
        reason: CompactionReason,
    },
    OrchestratorCompactionSkipped {
        compaction_id: Uuid,
        reason: CompactionReason,
        cause: CompactionSkipReason,
    },
    OrchestratorCompactionFailed {
        compaction_id: Uuid,
        reason: CompactionReason,
        failure: CompactionFailure,
    },
    ThreadFinished {
        name: String,
        exit_code: i32,
        timed_out: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_reason: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<crate::model::TokenUsage>,
    },
    AssistantMessage {
        thread_name: Option<String>,
        content: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        usage: Option<crate::model::TokenUsage>,
    },
    Error {
        thread_name: Option<String>,
        message: String,
    },
    /// A configured MCP server that could not be loaded for a worker, reported
    /// with a bounded, credential-redacted reason so the user can see why the
    /// server's tools are missing.
    McpServerSkipped {
        thread_name: Option<String>,
        server_name: String,
        reason: String,
    },
    /// Bounded, credential-redacted MCP server activity. These notifications
    /// are live-only because older durable event readers do not know this
    /// vocabulary and catalog state is reconstructed from the server.
    McpNotification {
        thread_name: Option<String>,
        server_name: String,
        kind: McpNotificationKind,
        message: String,
    },
    /// A model call the provider itself refused, reported with credentials
    /// redacted.
    ///
    /// Ordinary errors are reduced to a constant before they leave the process,
    /// because their text can carry paths and tool output. What a provider says
    /// about its own API — no credits, bad key, rate limit, context too long —
    /// carries none of that and is the one thing the user has to see to act, so
    /// it travels intact apart from credential material, which is masked before
    /// the event leaves the process. Live-only, like the other events whose
    /// absence keeps the persisted stream readable by older builds.
    ModelError {
        thread_name: Option<String>,
        message: String,
    },
    RunFinished {
        thread_name: Option<String>,
    },
}

impl AgentEvent {
    pub(crate) fn tool_call_finished(
        thread_name: Option<String>,
        call_id: String,
        name: String,
        result: &crate::tools::ToolResult,
    ) -> Self {
        let (command_status, exit_code) = if name == "exec_command" {
            result
                .content
                .as_text()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
                .map(|value| {
                    let status = value
                        .get("status")
                        .and_then(serde_json::Value::as_str)
                        .and_then(|status| match status {
                            "completed" => Some(crate::terminal::CommandStatus::Completed),
                            "timed_out" => Some(crate::terminal::CommandStatus::TimedOut),
                            "cancelled" => Some(crate::terminal::CommandStatus::Cancelled),
                            "spawn_error" => Some(crate::terminal::CommandStatus::SpawnError),
                            _ => None,
                        });
                    let exit_code = value
                        .get("exit_code")
                        .and_then(serde_json::Value::as_i64)
                        .and_then(|code| i32::try_from(code).ok());
                    (status, exit_code)
                })
                .unwrap_or((None, None))
        } else {
            (None, None)
        };
        // `_nac` is a reserved result envelope emitted by the execution
        // kernel. Tool output itself is untrusted, so accept only the exact
        // error-only timeout/cancellation shape produced by `timeout_result`.
        // In particular, content can never declare its own success or error.
        let metadata = result
            .is_error
            .then(|| result.content.as_text())
            .flatten()
            .and_then(|content| serde_json::from_str::<serde_json::Value>(content).ok())
            .and_then(|value| trusted_deadline_metadata(&name, &value));
        let completion_status = metadata
            .as_ref()
            .and_then(|metadata| metadata.get("status"))
            .and_then(serde_json::Value::as_str)
            .and_then(|status| match status {
                "timed_out" => Some(ToolCompletionStatus::TimedOut),
                "cancelled" => Some(ToolCompletionStatus::Cancelled),
                _ => None,
            })
            .or_else(|| {
                if !result.is_error {
                    return None;
                }
                let content = result.content.as_text()?;
                if name == "thread" && content.contains(" timed out after ") {
                    Some(ToolCompletionStatus::TimedOut)
                } else if (name == "thread" && content.to_ascii_lowercase().contains("cancelled"))
                    || durable_result_reports_cancelled(&name, content)
                {
                    Some(ToolCompletionStatus::Cancelled)
                } else {
                    None
                }
            })
            .or_else(|| match command_status {
                Some(crate::terminal::CommandStatus::TimedOut) => {
                    Some(ToolCompletionStatus::TimedOut)
                }
                Some(crate::terminal::CommandStatus::Cancelled) => {
                    Some(ToolCompletionStatus::Cancelled)
                }
                Some(crate::terminal::CommandStatus::Completed)
                    if exit_code.is_some_and(|code| code != 0) =>
                {
                    Some(ToolCompletionStatus::Error)
                }
                _ if result.is_error => Some(ToolCompletionStatus::Error),
                _ => Some(ToolCompletionStatus::Success),
            });
        let metric = |name| {
            metadata
                .as_ref()
                .and_then(|metadata| metadata.get(name))
                .and_then(serde_json::Value::as_u64)
        };
        Self::ToolCallFinished {
            thread_name,
            call_id,
            name: name.clone(),
            content_preview: crate::agent::preview::preview_tool_result(&name, result),
            is_error: result.is_error,
            command_status,
            exit_code,
            completion_status,
            effective_timeout_ms: metric("timeout_ms"),
            execution_duration_ms: metric("execution_duration_ms"),
            cleanup_duration_ms: metric("cleanup_duration_ms"),
            remote_outcome_uncertain: metadata
                .as_ref()
                .and_then(|metadata| metadata.get("remote_outcome_uncertain"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
        }
    }
}

fn trusted_deadline_metadata(name: &str, value: &serde_json::Value) -> Option<serde_json::Value> {
    let object = value.as_object()?;
    if object.len() != 2 || !object.contains_key("error") || !object.contains_key("_nac") {
        return None;
    }
    let error = object.get("error")?.as_str()?;
    let metadata = object.get("_nac")?.as_object()?;
    if metadata.len() != 5
        || ![
            "status",
            "timeout_ms",
            "execution_duration_ms",
            "cleanup_duration_ms",
            "remote_outcome_uncertain",
        ]
        .into_iter()
        .all(|key| metadata.contains_key(key))
    {
        return None;
    }
    let status = metadata.get("status")?.as_str()?;
    if !matches!(status, "timed_out" | "cancelled")
        || !error.starts_with(&format!("Tool '{name}' {status} after "))
        || metadata.get("timeout_ms")?.as_u64().is_none()
        || metadata.get("execution_duration_ms")?.as_u64().is_none()
        || metadata.get("cleanup_duration_ms")?.as_u64().is_none()
        || metadata
            .get("remote_outcome_uncertain")?
            .as_bool()
            .is_none()
    {
        return None;
    }
    Some(serde_json::Value::Object(metadata.clone()))
}

fn durable_result_reports_cancelled(name: &str, content: &str) -> bool {
    if !matches!(
        name,
        "subagent" | "subagent_cancel" | "orchestrator_launch" | "orchestrator_cancel"
    ) {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(content)
        .ok()
        .and_then(|value| {
            value
                .get("status")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        })
        .is_some_and(|status| status == "cancelled")
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionEventEnvelope {
    pub session_id: Option<String>,
    pub epoch_id: String,
    pub sequence_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<SessionRunId>,
    pub event: SessionEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionEventBoundary {
    pub epoch_id: String,
    pub sequence_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionReplayGap {
    pub missing_from_sequence_id: u64,
    pub missing_to_sequence_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SubmittedUserMessageSnapshot {
    pub run_id: SessionRunId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    pub content: String,
    pub submitted_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SessionEvent {
    /// Agent/model progress. The canonical top-level session busy lifecycle is
    /// represented by RunStarted/RunCompleted/RunFailed/RunCancelled. AgentEvent
    /// RunStarted/RunFinished remain low-level progress markers.
    Agent {
        event: AgentEvent,
    },
    RunStarted {
        prompt_preview: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        submitted_user_message: Option<SubmittedUserMessageSnapshot>,
        started_at_epoch_ms: u64,
    },
    RunCompleted {
        response: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        duration_ms: Option<u64>,
    },
    RunFailed {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        failure: Option<crate::run_failure::RunFailure>,
    },
    /// The run ended because the user asked it to, which is an outcome rather
    /// than a fault. Carries no message: the user already knows what happened,
    /// and the reason is a constant with nothing to report.
    RunCancelled,
    /// Live approval request for a prepared direct-session tool invocation.
    /// The broker owns the pending state; this event lets web clients render
    /// it without polling.
    PermissionAsked {
        request: crate::permissions::PermissionRequest,
    },
    PermissionReplied {
        request_id: String,
        reply: crate::permissions::PermissionReply,
    },
    /// The waiting call ended without a user reply (for example cancellation
    /// or timeout), so clients must remove the no-longer-actionable prompt.
    PermissionDismissed {
        request_id: String,
        reason: String,
    },
    /// The durable answer policy for this direct session changed. No request
    /// resources or credential-bearing payloads are included.
    PermissionApprovalModeChanged {
        mode: crate::permissions::PermissionApprovalMode,
    },
    SnapshotSaved {
        session_id: String,
    },
    /// Live-only signal that the orchestrator transcript log gained rows
    /// (DB-direct transcript workset, step 3). `transcript_len` is the raw
    /// merged transcript length after the append. Emitted at each transcript
    /// commit point so subscribers refetch the store-backed transcript
    /// mid-run. Never persisted: the bus persists only Agent events.
    TranscriptAppended {
        transcript_len: u64,
    },
    /// Live-only signal that a revert cut the transcript back to
    /// `transcript_len` messages. Subscribers must refetch rather than apply a
    /// delta: unlike an append, everything they hold past this point is gone.
    TranscriptReverted {
        transcript_len: u64,
    },
}

/// A slice of model output as it is being produced. Rides its own channel
/// rather than [`SessionEvent`]: deltas arrive an order of magnitude more
/// often than session events, they are worthless the moment the assistant
/// message lands, and pushing them through the sequenced bus would evict the
/// replay ring a reconnecting client depends on. So no sequence id, no replay,
/// no persistence — a subscriber that falls behind just misses text it is about
/// to receive in full anyway.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct AssistantStreamDelta {
    pub thread_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    /// Clear abandoned live output before displaying a replacement attempt.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reset: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retry_attempt: Option<u32>,
}

impl AssistantStreamDelta {
    pub(crate) fn from_model(
        thread_name: Option<String>,
        delta: crate::model::ModelStreamDelta,
    ) -> Self {
        Self {
            thread_name,
            text: (!delta.text.is_empty()).then_some(delta.text),
            reasoning: (!delta.reasoning.is_empty()).then_some(delta.reasoning),
            reset: delta.reset,
            retry_attempt: delta.retry_attempt,
        }
    }

    pub fn is_empty(&self) -> bool {
        !self.reset && self.text.is_none() && self.reasoning.is_none()
    }
}

pub type SessionEventReceiver = broadcast::Receiver<SessionEventEnvelope>;
pub type AssistantStreamDeltaReceiver = broadcast::Receiver<AssistantStreamDelta>;

pub struct SessionEventSubscription {
    pub client_id: SessionClientId,
    pub subscription_id: SessionSubscriptionId,
    pub receiver: SessionEventReceiver,
}

pub struct SessionEventReplaySubscription {
    pub epoch_id: String,
    pub client_id: SessionClientId,
    pub subscription_id: SessionSubscriptionId,
    pub requested_after_sequence_id: Option<u64>,
    pub replay_boundary_sequence_id: u64,
    pub oldest_retained_sequence_id: Option<u64>,
    pub newest_retained_sequence_id: Option<u64>,
    pub replay_gap: Option<SessionReplayGap>,
    pub replayed_events: Vec<SessionEventEnvelope>,
    pub receiver: SessionEventReceiver,
    /// Live model output for the same session. Unsequenced and never replayed,
    /// so a reconnecting client picks up mid-sentence and is squared up by the
    /// assistant message that follows.
    pub assistant_deltas: AssistantStreamDeltaReceiver,
}

#[derive(Clone)]
pub struct SessionEventBus {
    session_id: Option<String>,
    thread_event_persistence: ThreadEventPersistence,
    epoch_id: String,
    sender: broadcast::Sender<SessionEventEnvelope>,
    delta_sender: broadcast::Sender<AssistantStreamDelta>,
    state: Arc<StdMutex<SessionEventBusState>>,
    publication: Arc<StdMutex<()>>,
    recent_capacity: usize,
    recent_byte_capacity: usize,
}

#[derive(Clone)]
enum ThreadEventPersistence {
    Disabled,
    Available(ThreadEventStore),
}

#[derive(Clone)]
struct ThreadEventStore {
    writer: Arc<crate::store::ThreadEventWriter>,
    session_id: String,
}

struct PreparedThreadEvent<'a> {
    connection: crate::store::ThreadEventConnection,
    session_id: &'a str,
    thread_name: String,
    event_json: String,
}

impl PreparedThreadEvent<'_> {
    fn persist(&self) -> anyhow::Result<()> {
        self.connection
            .append(self.session_id, &self.thread_name, &self.event_json)
    }
}

struct SessionEventBusState {
    next_sequence_id: u64,
    published_sequence_id: u64,
    recent: VecDeque<RecentSessionEvent>,
    recent_bytes: usize,
}

struct RecentSessionEvent {
    envelope: SessionEventEnvelope,
    serialized_bytes: usize,
}

impl SessionEventBus {
    pub fn new(session_id: Option<String>) -> Self {
        Self::with_capacity(session_id, SESSION_EVENT_BUS_CAPACITY)
    }

    pub fn with_capacity(session_id: Option<String>, capacity: usize) -> Self {
        Self::with_limits(session_id, capacity, SESSION_EVENT_BUS_REPLAY_BYTE_CAP)
    }

    pub fn with_thread_event_store(session_id: Option<String>, path: PathBuf) -> Self {
        let mut bus = Self::new(session_id.clone());
        bus.thread_event_persistence = match session_id {
            Some(session_id) => ThreadEventPersistence::Available(ThreadEventStore {
                writer: Arc::new(crate::store::ThreadEventWriter::path_backed(&path)),
                session_id,
            }),
            None => ThreadEventPersistence::Disabled,
        };
        bus
    }

    fn with_limits(session_id: Option<String>, capacity: usize, byte_capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let byte_capacity = byte_capacity.max(1);
        let (sender, _) = broadcast::channel(capacity);
        let (delta_sender, _) = broadcast::channel(ASSISTANT_DELTA_CHANNEL_CAPACITY);
        Self {
            session_id,
            thread_event_persistence: ThreadEventPersistence::Disabled,
            epoch_id: Uuid::new_v4().to_string(),
            sender,
            delta_sender,
            state: Arc::new(StdMutex::new(SessionEventBusState {
                next_sequence_id: 0,
                published_sequence_id: 0,
                recent: VecDeque::with_capacity(capacity),
                recent_bytes: 0,
            })),
            publication: Arc::new(StdMutex::new(())),
            recent_capacity: capacity,
            recent_byte_capacity: byte_capacity,
        }
    }

    pub fn subscribe(&self) -> SessionEventReceiver {
        self.sender.subscribe()
    }

    pub fn subscribe_assistant_deltas(&self) -> AssistantStreamDeltaReceiver {
        self.delta_sender.subscribe()
    }

    /// Publish one slice of live model output. Dropped when nobody is watching,
    /// which is the common case for a run started from the CLI.
    pub fn emit_assistant_delta(&self, delta: AssistantStreamDelta) {
        if delta.is_empty() {
            return;
        }
        let _ = self.delta_sender.send(delta);
    }

    pub fn has_assistant_delta_subscribers(&self) -> bool {
        self.delta_sender.receiver_count() > 0
    }

    /// Web SSE subscriptions include the live-delta receiver, while internal
    /// run/service receivers consume only the sequenced event channel. This is
    /// therefore the fail-closed signal used by interactive approvals.
    pub fn has_interactive_subscribers(&self) -> bool {
        self.delta_sender.receiver_count() > 0
    }

    /// True while any client holds a live subscription to this session's event
    /// stream (an open SSE connection). The server uses this to decide whether
    /// a session is safe to evict from its in-memory cache: dropping the
    /// service would drop the broadcast senders and close every live stream.
    pub fn has_subscribers(&self) -> bool {
        self.sender.receiver_count() > 0 || self.delta_sender.receiver_count() > 0
    }

    pub fn subscribe_for_client(&self, client_id: SessionClientId) -> SessionEventSubscription {
        SessionEventSubscription {
            client_id,
            subscription_id: SessionSubscriptionId::new(),
            receiver: self.subscribe(),
        }
    }

    pub fn subscribe_for_client_with_replay(
        &self,
        client_id: SessionClientId,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        let epoch_matches = cursor.is_none_or(|cursor| cursor.epoch_id == self.epoch_id);
        let after_sequence_id = cursor.map(|cursor| cursor.sequence_id);
        let state = self.lock_state();
        let replay_boundary_sequence_id = state.published_sequence_id;
        let oldest_retained_sequence_id =
            state.recent.front().map(|entry| entry.envelope.sequence_id);
        let newest_retained_sequence_id =
            state.recent.back().map(|entry| entry.envelope.sequence_id);
        let replayed_events = if epoch_matches {
            recent_events_from_state(
                &state,
                after_sequence_id,
                Some(replay_boundary_sequence_id),
                limit,
            )
        } else {
            Vec::new()
        };
        let replay_gap = if epoch_matches {
            replay_gap_for(
                after_sequence_id,
                replay_boundary_sequence_id,
                &replayed_events,
            )
        } else {
            None
        };
        let receiver = self.sender.subscribe();
        let assistant_deltas = self.delta_sender.subscribe();
        SessionEventReplaySubscription {
            epoch_id: self.epoch_id.clone(),
            client_id,
            subscription_id: SessionSubscriptionId::new(),
            requested_after_sequence_id: after_sequence_id,
            replay_boundary_sequence_id,
            oldest_retained_sequence_id,
            newest_retained_sequence_id,
            replay_gap,
            replayed_events,
            receiver,
            assistant_deltas,
        }
    }

    pub fn emit(&self, event: SessionEvent) -> SessionEventEnvelope {
        self.emit_with_context(event, None, None)
    }

    #[expect(
        clippy::expect_used,
        reason = "the public session event bus rejects internal-only agent event variants"
    )]
    pub fn emit_with_context(
        &self,
        event: SessionEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> SessionEventEnvelope {
        let event = sanitize_external_session_event(event)
            .expect("internal-only agent events cannot be emitted on the session event bus");
        self.emit_sanitized(event, run_id, client_id)
    }

    pub async fn emit_with_context_async(
        &self,
        event: SessionEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> anyhow::Result<SessionEventEnvelope> {
        // A broken store path must not suppress live-only terminal events.
        // Unknown ownership takes the bounded caller path; durable checkout
        // still rejects the lookup error instead of bypassing an owner.
        if !self.has_owned_persistence().unwrap_or(true) {
            let event = sanitize_external_session_event(event)
                .ok_or_else(|| anyhow::anyhow!("internal-only session event"))?;
            let (envelope, result) = self.publish_sanitized(event, run_id, client_id);
            return result.map(|()| envelope);
        }
        let bus = self.clone();
        let result = crate::store::spawn_blocking_store_caller(move || {
            let event = sanitize_external_session_event(event)
                .ok_or_else(|| anyhow::anyhow!("internal-only session event"))?;
            let (envelope, result) = bus.publish_sanitized(event, run_id, client_id);
            result.map(|()| envelope)
        })
        .await
        .and_then(|result| result);
        if result.as_ref().is_err_and(|error| {
            matches!(
                error.downcast_ref::<crate::store::PersistenceAdmissionError>(),
                Some(crate::store::PersistenceAdmissionError::CallerOverloaded)
            )
        }) {
            self.record_publication_failure();
        }
        result
    }

    fn has_owned_persistence(&self) -> anyhow::Result<bool> {
        match &self.thread_event_persistence {
            ThreadEventPersistence::Available(store) => store.writer.has_owner(),
            ThreadEventPersistence::Disabled => Ok(false),
        }
    }

    #[expect(
        clippy::expect_used,
        reason = "overflowing the durable event sequence violates event identity"
    )]
    pub(crate) fn record_publication_failure(&self) {
        let mut state = self.lock_state();
        state.next_sequence_id = state
            .next_sequence_id
            .checked_add(1)
            .expect("session event sequence overflow");
    }

    fn emit_sanitized(
        &self,
        event: SessionEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> SessionEventEnvelope {
        let (envelope, result) = self.publish_sanitized(event, run_id, client_id);
        if let Err(error) = result {
            eprintln!("nac: failed to persist thread event: {error:#}");
        }
        envelope
    }

    #[expect(
        clippy::expect_used,
        reason = "overflowing event sequence violates event identity"
    )]
    fn publish_sanitized(
        &self,
        event: SessionEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> (SessionEventEnvelope, anyhow::Result<()>) {
        let prepared = self.prepare_thread_event(&event);
        let _publication = self
            .publication
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut state = self.lock_state();
        state.next_sequence_id = state
            .next_sequence_id
            .checked_add(1)
            .expect("session event sequence overflow");
        let envelope = SessionEventEnvelope {
            session_id: self.session_id.clone(),
            epoch_id: self.epoch_id.clone(),
            sequence_id: state.next_sequence_id,
            client_id,
            run_id,
            event,
        };
        drop(state);
        match prepared {
            Ok(Some(prepared)) => {
                if let Err(error) = prepared.persist() {
                    return (envelope, Err(error));
                }
            }
            Ok(None) => {}
            Err(error) => {
                return (envelope, Err(error));
            }
        }
        let mut state = self.lock_state();
        state.published_sequence_id = envelope.sequence_id;
        if let Some(serialized_bytes) =
            serialized_envelope_len(&envelope, self.recent_byte_capacity)
        {
            while state.recent.len() >= self.recent_capacity {
                pop_recent_front(&mut state);
            }
            while state.recent_bytes.saturating_add(serialized_bytes) > self.recent_byte_capacity {
                if !pop_recent_front(&mut state) {
                    break;
                }
            }
            state.recent_bytes = state.recent_bytes.saturating_add(serialized_bytes);
            state.recent.push_back(RecentSessionEvent {
                envelope: envelope.clone(),
                serialized_bytes,
            });
        }
        let _ = self.sender.send(envelope.clone());
        (envelope, Ok(()))
    }

    pub fn emit_agent(&self, event: AgentEvent) -> Option<SessionEventEnvelope> {
        self.emit_agent_with_context(event, None, None)
    }

    pub fn emit_agent_with_context(
        &self,
        event: AgentEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> Option<SessionEventEnvelope> {
        let event = sanitize_external_agent_event(event)?;
        Some(self.emit_sanitized(SessionEvent::Agent { event }, run_id, client_id))
    }

    pub fn thread_event_boundary<T>(
        &self,
        query: impl FnOnce() -> anyhow::Result<T>,
    ) -> anyhow::Result<(SessionEventBoundary, T)> {
        let _publication = self
            .publication
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let value = query()?;
        let state = self.lock_state();
        Ok((
            SessionEventBoundary {
                epoch_id: self.epoch_id.clone(),
                sequence_id: state.published_sequence_id,
            },
            value,
        ))
    }

    pub fn recent_events(
        &self,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> (SessionEventBoundary, Vec<SessionEventEnvelope>) {
        let state = self.lock_state();
        let boundary = SessionEventBoundary {
            epoch_id: self.epoch_id.clone(),
            sequence_id: state.published_sequence_id,
        };
        let events = if cursor.is_none_or(|cursor| cursor.epoch_id == self.epoch_id) {
            recent_events_from_state(&state, cursor.map(|cursor| cursor.sequence_id), None, limit)
        } else {
            Vec::new()
        };
        (boundary, events)
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    #[cfg(test)]
    pub(crate) fn hold_thread_event_connection_for_test(
        &self,
    ) -> anyhow::Result<crate::store::ThreadEventConnection> {
        match &self.thread_event_persistence {
            ThreadEventPersistence::Available(store) => store.writer.checkout(),
            ThreadEventPersistence::Disabled => {
                Err(anyhow::anyhow!("thread event persistence is disabled"))
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn event_state_is_available_for_test(&self) -> bool {
        self.state.try_lock().is_ok()
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, SessionEventBusState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Prepare persistence before taking the publication lock. Snapshot loading
    /// checks out SQLite before taking the same lock, so this order prevents a
    /// capacity/state inversion while preserving persistence-before-publication.
    fn prepare_thread_event(
        &self,
        event: &SessionEvent,
    ) -> anyhow::Result<Option<PreparedThreadEvent<'_>>> {
        let SessionEvent::Agent { event } = event else {
            return Ok(None);
        };
        let Some(event) = sanitize_external_agent_event(event.clone()) else {
            return Ok(None);
        };
        let Some(thread_name) = persisted_thread_event_name(&event) else {
            return Ok(None);
        };
        let store = match &self.thread_event_persistence {
            ThreadEventPersistence::Disabled => return Ok(None),
            ThreadEventPersistence::Available(store) => store,
        };
        let event_json = serde_json::to_string(&event)?;
        Ok(Some(PreparedThreadEvent {
            connection: store.writer.checkout()?,
            session_id: &store.session_id,
            thread_name: thread_name.to_string(),
            event_json,
        }))
    }
}

fn persisted_thread_event_name(event: &AgentEvent) -> Option<&str> {
    match event {
        AgentEvent::ToolCallStarted {
            thread_name: None,
            name,
            ..
        }
        | AgentEvent::ToolCallFinished {
            thread_name: None,
            name,
            ..
        } if !matches!(
            name.as_str(),
            "thread"
                | "threads"
                | "thread_read"
                | "thread_delete"
                | "workset_define"
                | "workset_read"
                | "workset_list"
        ) =>
        {
            Some(PRIMARY_TOOL_EVENT_TARGET)
        }
        AgentEvent::RunStarted { thread_name, .. }
        | AgentEvent::ToolCallStarted { thread_name, .. }
        | AgentEvent::ToolCallFinished { thread_name, .. }
        | AgentEvent::AssistantMessage { thread_name, .. }
        | AgentEvent::Error { thread_name, .. }
        | AgentEvent::RunFinished { thread_name } => thread_name.as_deref(),
        AgentEvent::ThreadStarted { name, .. }
        | AgentEvent::ThreadSteeringQueued { name, .. }
        | AgentEvent::ThreadSteeringDelivered { name, .. }
        | AgentEvent::ThreadSteeringExpired { name, .. }
        | AgentEvent::ThreadFinished { name, .. } => Some(name),
        // Usage updates are deliberately live-only. Persisting them would
        // consume slots in the user-facing thread-event pages and make a DB
        // written by this version unreadable by older AgentEvent enums.
        AgentEvent::ModelCallStarted { .. }
        | AgentEvent::TokenUsageUpdated { .. }
        | AgentEvent::ThreadLog { .. }
        | AgentEvent::McpServerSkipped { .. }
        | AgentEvent::McpNotification { .. }
        | AgentEvent::ModelError { .. }
        | AgentEvent::OrchestratorSteeringQueued { .. }
        | AgentEvent::OrchestratorSteeringDelivered { .. }
        | AgentEvent::OrchestratorSteeringExpired { .. }
        | AgentEvent::OrchestratorCompactionStarted { .. }
        | AgentEvent::OrchestratorCompactionCompleted { .. }
        | AgentEvent::OrchestratorCompactionSkipped { .. }
        | AgentEvent::OrchestratorCompactionFailed { .. } => None,
    }
}

pub(crate) fn sanitize_external_agent_event(event: AgentEvent) -> Option<AgentEvent> {
    Some(match event {
        AgentEvent::ModelCallStarted { .. } | AgentEvent::ThreadLog { .. } => return None,
        AgentEvent::RunStarted { thread_name, .. } => AgentEvent::RunStarted {
            thread_name,
            prompt_preview: "run started".to_string(),
        },
        AgentEvent::ToolCallStarted {
            thread_name,
            call_id,
            name,
            args_preview,
            key_arg_preview: existing_key,
            args_detail,
        } => {
            // Preserve an existing key_arg_preview from a prior sanitization
            // pass so the human-readable cmd snippet survives double
            // sanitization (emit → bus).  Only compute when absent or when
            // the existing value is clearly not a human-readable preview
            // (empty string or raw JSON from an older code version).
            let key = existing_key
                .filter(|k| !k.is_empty() && !k.starts_with('{') && !k.starts_with('['))
                .unwrap_or_else(|| key_arg_preview(&name, args_detail.as_deref(), &args_preview));
            let key = bounded_tool_preview(&redact_credentials(&key, &[]));
            let safe_args = safe_tool_arguments(&name, args_detail.as_deref(), &args_preview);
            AgentEvent::ToolCallStarted {
                thread_name,
                call_id,
                args_preview: safe_args,
                key_arg_preview: Some(key),
                args_detail: None,
                name: safe_tool_name(&name),
            }
        }
        AgentEvent::ToolCallFinished {
            thread_name,
            call_id,
            name,
            content_preview,
            is_error,
            command_status,
            exit_code,
            completion_status,
            effective_timeout_ms,
            execution_duration_ms,
            cleanup_duration_ms,
            remote_outcome_uncertain,
        } => AgentEvent::ToolCallFinished {
            thread_name,
            call_id,
            name: safe_tool_name(&name),
            content_preview: bounded_tool_preview(&redact_credentials(&content_preview, &[])),
            is_error,
            command_status,
            exit_code,
            completion_status,
            effective_timeout_ms,
            execution_duration_ms,
            cleanup_duration_ms,
            remote_outcome_uncertain,
        },
        AgentEvent::ThreadStarted {
            name,
            source_threads,
            ..
        } => AgentEvent::ThreadStarted {
            name,
            action: "thread dispatched".to_string(),
            source_threads,
        },
        AgentEvent::ThreadSteeringQueued {
            name, steering_id, ..
        } => AgentEvent::ThreadSteeringQueued {
            name,
            steering_id,
            instruction_preview: "steering queued".to_string(),
        },
        AgentEvent::ThreadSteeringDelivered {
            name, steering_id, ..
        } => AgentEvent::ThreadSteeringDelivered {
            name,
            steering_id,
            instruction_preview: "steering delivered".to_string(),
        },
        AgentEvent::ThreadSteeringExpired {
            name, steering_id, ..
        } => AgentEvent::ThreadSteeringExpired {
            name,
            steering_id,
            instruction_preview: "steering expired".to_string(),
        },
        AgentEvent::OrchestratorSteeringQueued { steering_id, .. } => {
            AgentEvent::OrchestratorSteeringQueued {
                steering_id,
                instruction_preview: "steering queued".to_string(),
            }
        }
        AgentEvent::OrchestratorSteeringDelivered { steering_id, .. } => {
            AgentEvent::OrchestratorSteeringDelivered {
                steering_id,
                instruction_preview: "steering delivered".to_string(),
            }
        }
        AgentEvent::OrchestratorSteeringExpired { steering_id, .. } => {
            AgentEvent::OrchestratorSteeringExpired {
                steering_id,
                instruction_preview: "steering expired".to_string(),
            }
        }
        AgentEvent::ThreadFinished {
            name,
            exit_code,
            timed_out,
            usage,
            ..
        } => AgentEvent::ThreadFinished {
            name,
            exit_code,
            timed_out,
            timeout_reason: timed_out.then(|| "thread timed out".to_string()),
            usage,
        },
        AgentEvent::Error { thread_name, .. } => AgentEvent::Error {
            thread_name,
            message: "operation failed".to_string(),
        },
        AgentEvent::McpServerSkipped {
            thread_name,
            server_name,
            reason,
        } => AgentEvent::McpServerSkipped {
            thread_name,
            server_name,
            reason: bounded_provider_message(&redact_credentials(&reason, &[])),
        },
        AgentEvent::McpNotification {
            thread_name,
            server_name,
            kind,
            message,
        } => AgentEvent::McpNotification {
            thread_name,
            server_name: safe_tool_name(&server_name),
            kind,
            message: bounded_provider_message(&redact_credentials(&message, &[])),
        },
        AgentEvent::ModelError {
            thread_name,
            message,
        } => AgentEvent::ModelError {
            thread_name,
            // Provider bodies can be long; the actionable part is at the front.
            // Credential shapes are masked first as defense in depth: the exact
            // secret is not known here, but header-shaped credential lines and
            // bearer tokens are still caught if they reached the event.
            message: bounded_provider_message(&redact_credentials(&message, &[])),
        },
        event @ (AgentEvent::TokenUsageUpdated { .. }
        | AgentEvent::AssistantMessage { .. }
        | AgentEvent::RunFinished { .. }
        | AgentEvent::OrchestratorCompactionStarted { .. }
        | AgentEvent::OrchestratorCompactionCompleted { .. }
        | AgentEvent::OrchestratorCompactionSkipped { .. }
        | AgentEvent::OrchestratorCompactionFailed { .. }) => event,
    })
}

const MAX_PROVIDER_MESSAGE_BYTES: usize = 600;

fn bounded_provider_message(message: &str) -> String {
    let mut end = message.len().min(MAX_PROVIDER_MESSAGE_BYTES);
    while !message.is_char_boundary(end) {
        end -= 1;
    }
    message[..end].to_string()
}

fn safe_tool_name(name: &str) -> String {
    name.chars()
        .filter(|character| !character.is_control())
        .take(160)
        .collect()
}

fn bounded_tool_preview(value: &str) -> String {
    value.chars().take(180).collect()
}

fn sanitize_external_session_event(event: SessionEvent) -> Option<SessionEvent> {
    Some(match event {
        SessionEvent::Agent { event } => SessionEvent::Agent {
            event: sanitize_external_agent_event(event)?,
        },
        SessionEvent::RunFailed { failure, .. } => SessionEvent::RunFailed {
            message: "run failed".to_string(),
            failure: failure.map(crate::run_failure::RunFailure::sanitized),
        },
        event => event,
    })
}

fn safe_tool_arguments(name: &str, detail: Option<&str>, preview: &str) -> String {
    let parsed = detail
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .or_else(|| serde_json::from_str::<serde_json::Value>(preview).ok());
    let mut safe = serde_json::Map::new();
    safe.insert(
        "operation".to_string(),
        serde_json::Value::String(
            match name {
                "read" => "read",
                "write" => "write",
                "edit" => "edit",
                "exec_command" => "execute",
                "write_stdin" => {
                    let object = parsed.as_ref().and_then(serde_json::Value::as_object);
                    let has_input = object
                        .and_then(|object| object.get("chars"))
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|chars| !chars.is_empty());
                    let retains = object
                        .and_then(|object| object.get("retain"))
                        .and_then(serde_json::Value::as_bool)
                        .unwrap_or(false);
                    if has_input || retains {
                        "terminal_input"
                    } else {
                        "terminal_observe"
                    }
                }
                "read_command_output" => "read_command_output",
                "thread" => "dispatch",
                "threads" => "list_threads",
                "thread_read" => "read_thread",
                "thread_delete" => "delete_thread",
                _ => "invoke",
            }
            .to_string(),
        ),
    );
    let object = parsed.as_ref().and_then(serde_json::Value::as_object);
    match name {
        "read" => {
            copy_safe_string(object, &mut safe, "path");
            copy_safe_u64(object, &mut safe, "offset");
            copy_safe_u64(object, &mut safe, "limit");
        }
        "write" => {
            copy_safe_string(object, &mut safe, "path");
            copy_string_length(object, &mut safe, "content", "content_chars");
            copy_safe_u64(object, &mut safe, "content_chars");
        }
        "edit" => {
            copy_safe_string(object, &mut safe, "path");
            copy_edit_lengths(object, &mut safe);
        }
        "exec_command" => {
            copy_safe_string(object, &mut safe, "workdir");
            copy_safe_bool(object, &mut safe, "tty");
            copy_safe_u64(object, &mut safe, "yield_time_ms");
            copy_safe_u64(object, &mut safe, "max_output_chars");
        }
        "write_stdin" => {
            copy_safe_string(object, &mut safe, "session_id");
            copy_string_length(object, &mut safe, "chars", "input_chars");
            copy_safe_u64(object, &mut safe, "input_chars");
            copy_safe_bool(object, &mut safe, "retain");
            copy_safe_u64(object, &mut safe, "yield_time_ms");
            copy_safe_u64(object, &mut safe, "max_output_chars");
        }
        "read_command_output" => {
            copy_safe_string(object, &mut safe, "output_id");
            copy_safe_string(object, &mut safe, "stream");
            copy_safe_u64(object, &mut safe, "offset");
            copy_safe_u64(object, &mut safe, "limit");
        }
        "thread" => {
            copy_safe_string(object, &mut safe, "name");
            copy_array_length(object, &mut safe, "threads", "source_count");
            copy_safe_u64(object, &mut safe, "source_count");
            copy_array_length(object, &mut safe, "skills", "skill_count");
            copy_safe_u64(object, &mut safe, "skill_count");
            copy_safe_u64(object, &mut safe, "timeout");
        }
        "thread_read" | "thread_delete" => copy_safe_string(object, &mut safe, "name"),
        _ => {}
    }
    serde_json::Value::Object(safe).to_string()
}

fn copy_safe_string(
    source: Option<&serde_json::Map<String, serde_json::Value>>,
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) {
    if let Some(value) = source
        .and_then(|source| source.get(key))
        .and_then(serde_json::Value::as_str)
    {
        let value: String = value
            .chars()
            .filter(|character| !character.is_control())
            .take(512)
            .collect();
        target.insert(key.to_string(), serde_json::Value::String(value));
    }
}

fn copy_safe_u64(
    source: Option<&serde_json::Map<String, serde_json::Value>>,
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) {
    if let Some(value) = source
        .and_then(|source| source.get(key))
        .and_then(serde_json::Value::as_u64)
    {
        target.insert(key.to_string(), serde_json::Value::from(value));
    }
}

fn copy_safe_bool(
    source: Option<&serde_json::Map<String, serde_json::Value>>,
    target: &mut serde_json::Map<String, serde_json::Value>,
    key: &str,
) {
    if let Some(value) = source
        .and_then(|source| source.get(key))
        .and_then(serde_json::Value::as_bool)
    {
        target.insert(key.to_string(), serde_json::Value::from(value));
    }
}

fn copy_string_length(
    source: Option<&serde_json::Map<String, serde_json::Value>>,
    target: &mut serde_json::Map<String, serde_json::Value>,
    source_key: &str,
    target_key: &str,
) {
    if let Some(value) = source
        .and_then(|source| source.get(source_key))
        .and_then(serde_json::Value::as_str)
    {
        target.insert(
            target_key.to_string(),
            serde_json::Value::from(value.chars().count() as u64),
        );
    }
}
fn copy_edit_lengths(
    source: Option<&serde_json::Map<String, serde_json::Value>>,
    target: &mut serde_json::Map<String, serde_json::Value>,
) {
    let Some(edits) = source
        .and_then(|source| source.get("edits"))
        .and_then(serde_json::Value::as_array)
    else {
        return;
    };
    let old_chars = edits
        .iter()
        .filter_map(|edit| edit.get("old_text").and_then(serde_json::Value::as_str))
        .map(|text| text.chars().count() as u64)
        .sum::<u64>();
    let new_chars = edits
        .iter()
        .filter_map(|edit| edit.get("new_text").and_then(serde_json::Value::as_str))
        .map(|text| text.chars().count() as u64)
        .sum::<u64>();
    target.insert(
        "edit_count".to_string(),
        serde_json::Value::from(edits.len() as u64),
    );
    target.insert(
        "old_text_chars".to_string(),
        serde_json::Value::from(old_chars),
    );
    target.insert(
        "new_text_chars".to_string(),
        serde_json::Value::from(new_chars),
    );
}

fn copy_array_length(
    source: Option<&serde_json::Map<String, serde_json::Value>>,
    target: &mut serde_json::Map<String, serde_json::Value>,
    source_key: &str,
    target_key: &str,
) {
    if let Some(value) = source
        .and_then(|source| source.get(source_key))
        .and_then(serde_json::Value::as_array)
    {
        target.insert(
            target_key.to_string(),
            serde_json::Value::from(value.len() as u64),
        );
    }
}

fn recent_events_from_state(
    state: &SessionEventBusState,
    after_sequence_id: Option<u64>,
    up_to_sequence_id: Option<u64>,
    limit: usize,
) -> Vec<SessionEventEnvelope> {
    if limit == 0 {
        return Vec::new();
    }

    let mut events: Vec<_> = state
        .recent
        .iter()
        .filter(|entry| {
            after_sequence_id.is_none_or(|sequence_id| entry.envelope.sequence_id > sequence_id)
                && up_to_sequence_id
                    .is_none_or(|sequence_id| entry.envelope.sequence_id <= sequence_id)
        })
        .map(|entry| entry.envelope.clone())
        .collect();
    let start = events.len().saturating_sub(limit);
    if start > 0 {
        events.split_off(start)
    } else {
        events
    }
}

fn replay_gap_for(
    after_sequence_id: Option<u64>,
    replay_boundary_sequence_id: u64,
    replayed_events: &[SessionEventEnvelope],
) -> Option<SessionReplayGap> {
    let mut expected_sequence_id = after_sequence_id.unwrap_or(0).saturating_add(1);
    if expected_sequence_id == 0 || expected_sequence_id > replay_boundary_sequence_id {
        return None;
    }

    for envelope in replayed_events {
        if envelope.sequence_id > expected_sequence_id {
            return Some(SessionReplayGap {
                missing_from_sequence_id: expected_sequence_id,
                missing_to_sequence_id: envelope.sequence_id.saturating_sub(1),
            });
        }
        expected_sequence_id = envelope.sequence_id.saturating_add(1);
        if expected_sequence_id == 0 {
            return None;
        }
    }

    if expected_sequence_id <= replay_boundary_sequence_id {
        Some(SessionReplayGap {
            missing_from_sequence_id: expected_sequence_id,
            missing_to_sequence_id: replay_boundary_sequence_id,
        })
    } else {
        None
    }
}

fn serialized_envelope_len(envelope: &SessionEventEnvelope, max_bytes: usize) -> Option<usize> {
    let mut writer = CountingWriter {
        bytes: 0,
        max_bytes,
    };
    serde_json::to_writer(&mut writer, envelope).ok()?;
    Some(writer.bytes)
}

struct CountingWriter {
    bytes: usize,
    max_bytes: usize,
}

impl Write for CountingWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes = self.bytes.saturating_add(buffer.len());
        if self.bytes > self.max_bytes {
            return Err(io::Error::other("serialized event exceeds replay byte cap"));
        }
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn pop_recent_front(state: &mut SessionEventBusState) -> bool {
    let Some(removed) = state.recent.pop_front() else {
        return false;
    };
    state.recent_bytes = state.recent_bytes.saturating_sub(removed.serialized_bytes);
    true
}

#[derive(Clone, Default)]
pub struct EventSink {
    channel: Option<UnboundedSender<AgentEvent>>,
    bus: Option<SessionEventBus>,
    run_id: Option<SessionRunId>,
    client_id: Option<SessionClientId>,
    stderr_prefixed: bool,
    defer_worker_finish: bool,
}

impl EventSink {
    pub fn none() -> Self {
        Self::default()
    }

    pub fn channel(channel: UnboundedSender<AgentEvent>) -> Self {
        Self {
            channel: Some(channel),
            ..Self::default()
        }
    }

    pub fn bus(bus: SessionEventBus) -> Self {
        Self {
            bus: Some(bus),
            ..Self::default()
        }
    }

    pub fn bus_with_context(
        bus: SessionEventBus,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> Self {
        Self {
            bus: Some(bus),
            run_id,
            client_id,
            ..Self::default()
        }
    }

    pub fn stderr_prefixed() -> Self {
        Self {
            stderr_prefixed: true,
            ..Self::default()
        }
    }

    pub(crate) fn worker_stderr_prefixed() -> Self {
        Self {
            defer_worker_finish: true,
            ..Self::stderr_prefixed()
        }
    }

    pub fn emit(&self, event: AgentEvent) {
        if self.defer_worker_finish && matches!(event, AgentEvent::RunFinished { .. }) {
            return;
        }
        if matches!(event, AgentEvent::ModelCallStarted { .. }) {
            if self.stderr_prefixed {
                if let Ok(encoded) = serde_json::to_string(&event) {
                    eprintln!("{STDERR_EVENT_PREFIX}{encoded}");
                }
            }
            return;
        }
        let Some(event) = sanitize_external_agent_event(event) else {
            return;
        };
        if self.stderr_prefixed {
            if let Ok(encoded) = serde_json::to_string(&event) {
                eprintln!("{STDERR_EVENT_PREFIX}{encoded}");
            }
        }
        if let Some(bus) = &self.bus {
            let _ = bus.emit_agent_with_context(
                event.clone(),
                self.run_id.clone(),
                self.client_id.clone(),
            );
        }
        if let Some(channel) = &self.channel {
            let _ = channel.send(event);
        }
    }

    /// Required host publications expose their durable acknowledgement.
    pub async fn try_emit_async(&self, event: AgentEvent) -> anyhow::Result<()> {
        if self.defer_worker_finish && matches!(event, AgentEvent::RunFinished { .. }) {
            return Ok(());
        }
        if matches!(event, AgentEvent::ModelCallStarted { .. }) {
            self.emit(event);
            return Ok(());
        }
        let Some(event) = sanitize_external_agent_event(event) else {
            return Ok(());
        };
        if let Some(bus) = &self.bus {
            bus.emit_with_context_async(
                SessionEvent::Agent {
                    event: event.clone(),
                },
                self.run_id.clone(),
                self.client_id.clone(),
            )
            .await?;
        }
        if self.stderr_prefixed {
            eprintln!("{STDERR_EVENT_PREFIX}{}", serde_json::to_string(&event)?);
        }
        if let Some(channel) = &self.channel {
            let _ = channel.send(event);
        }
        Ok(())
    }

    pub async fn emit_async(&self, event: AgentEvent) {
        if let Err(error) = self.try_emit_async(event).await {
            eprintln!("nac: durable event publication failed: {error:#}");
        }
    }

    /// One publication obligation per accepted lifecycle; retry only definite
    /// pre-execution caller rejection, never uncertain persistence failures.
    pub(crate) async fn emit_lifecycle_async(&self, event: AgentEvent) {
        loop {
            match self.try_emit_async(event.clone()).await {
                Err(error)
                    if matches!(
                        error.downcast_ref::<crate::store::PersistenceAdmissionError>(),
                        Some(crate::store::PersistenceAdmissionError::CallerOverloaded)
                    ) =>
                {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                }
                Err(error) => {
                    eprintln!("nac: lifecycle publication failed: {error:#}");
                    break;
                }
                Ok(()) => break,
            }
        }
    }

    /// Transfer a selected terminal to an independent publication obligation
    /// before awaiting it. Cancelling the waiter cannot replace this outcome.
    pub(crate) async fn emit_terminal_lifecycle_async(&self, event: AgentEvent) {
        if !self
            .bus
            .as_ref()
            .is_some_and(|bus| bus.has_owned_persistence().unwrap_or(true))
        {
            self.emit_lifecycle_async(event).await;
            return;
        }
        let sink = self.clone();
        let publication = tokio::spawn(async move {
            sink.emit_lifecycle_async(event).await;
        });
        if let Err(error) = publication.await {
            eprintln!("nac: terminal lifecycle publication task failed: {error:#}");
        }
    }

    pub(crate) fn emit_cleanup(&self, event: AgentEvent) {
        if tokio::runtime::Handle::try_current().is_err()
            || !self
                .bus
                .as_ref()
                .is_some_and(|bus| bus.has_owned_persistence().unwrap_or(true))
        {
            self.emit(event);
            return;
        }
        let sink = self.clone();
        tokio::spawn(async move {
            sink.emit_lifecycle_async(event).await;
        });
    }

    /// Live-only transcript growth signal (DB-direct transcript workset,
    /// step 3). Emitted by the agent at each transcript commit point, after
    /// the log append commits, so session subscribers refetch the
    /// store-backed transcript mid-run. A no-op without a bus (workers,
    /// channel sinks, tests).
    /// Live-only model output, for the transcript to render before the
    /// assistant message is committed. Bus-only: the stderr and channel sinks
    /// carry the durable event log, which deltas are deliberately not part of.
    pub fn emit_assistant_delta(&self, delta: AssistantStreamDelta) {
        if let Some(bus) = &self.bus {
            bus.emit_assistant_delta(delta);
        }
    }

    /// Whether anything is listening for deltas. The streaming request shape
    /// costs an extra parse per chunk, so a run nobody is watching keeps using
    /// the plain one.
    pub fn wants_assistant_deltas(&self) -> bool {
        self.bus
            .as_ref()
            .is_some_and(SessionEventBus::has_assistant_delta_subscribers)
    }

    pub fn emit_transcript_appended(&self, transcript_len: u64) {
        if let Some(bus) = &self.bus {
            bus.emit_with_context(
                SessionEvent::TranscriptAppended { transcript_len },
                self.run_id.clone(),
                self.client_id.clone(),
            );
        }
    }

    pub async fn emit_transcript_appended_async(&self, transcript_len: u64) {
        if let Some(bus) = &self.bus {
            if let Err(error) = bus
                .emit_with_context_async(
                    SessionEvent::TranscriptAppended { transcript_len },
                    self.run_id.clone(),
                    self.client_id.clone(),
                )
                .await
            {
                eprintln!("nac: transcript publication task failed: {error}");
            }
        }
    }
}

pub fn decode_stderr_event(line: &str) -> Option<AgentEvent> {
    let encoded = line.strip_prefix(STDERR_EVENT_PREFIX)?;
    serde_json::from_str(encoded).ok()
}

#[cfg(test)]
#[path = "events_tests.rs"]
mod tests;
