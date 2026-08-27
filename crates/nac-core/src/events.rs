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
        Self::ToolCallFinished {
            thread_name,
            call_id,
            name: name.clone(),
            content_preview: crate::agent::preview::preview_tool_result(&name, result),
            is_error: result.is_error,
            command_status,
            exit_code,
        }
    }
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
}

impl AssistantStreamDelta {
    pub fn is_empty(&self) -> bool {
        self.text.is_none() && self.reasoning.is_none()
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

    fn emit_sanitized(
        &self,
        event: SessionEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> SessionEventEnvelope {
        let prepared = self.prepare_thread_event(&event);
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
        match prepared {
            Ok(Some(prepared)) => {
                if let Err(error) = prepared.persist() {
                    eprintln!("nac: failed to persist thread event: {error:#}");
                    return envelope;
                }
            }
            Ok(None) => {}
            Err(error) => {
                eprintln!("nac: failed to prepare thread event persistence: {error:#}");
                return envelope;
            }
        }
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
        envelope
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
        let state = self.lock_state();
        let value = query()?;
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

    /// Prepare persistence before taking the event state lock. Snapshot loading
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
            let safe_args = safe_tool_arguments(&name, args_detail.as_deref(), &args_preview);
            AgentEvent::ToolCallStarted {
                thread_name,
                call_id,
                args_preview: safe_args,
                key_arg_preview: Some(key),
                args_detail: None,
                name,
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
        } => AgentEvent::ToolCallFinished {
            thread_name,
            call_id,
            name,
            content_preview,
            is_error,
            command_status,
            exit_code,
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

fn sanitize_external_session_event(event: SessionEvent) -> Option<SessionEvent> {
    Some(match event {
        SessionEvent::Agent { event } => SessionEvent::Agent {
            event: sanitize_external_agent_event(event)?,
        },
        SessionEvent::RunFailed { .. } => SessionEvent::RunFailed {
            message: "run failed".to_string(),
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

    pub fn emit(&self, event: AgentEvent) {
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
}

pub fn decode_stderr_event(line: &str) -> Option<AgentEvent> {
    let encoded = line.strip_prefix(STDERR_EVENT_PREFIX)?;
    serde_json::from_str(encoded).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_prefixed_event_round_trip() {
        let event = AgentEvent::ThreadStarted {
            name: "impl".to_string(),
            action: "inspect auth".to_string(),
            source_threads: vec!["auth".to_string()],
        };
        let encoded = format!(
            "{}{}",
            STDERR_EVENT_PREFIX,
            serde_json::to_string(&event).unwrap()
        );

        let decoded = decode_stderr_event(&encoded).unwrap();
        assert_eq!(decoded, event);
    }

    #[test]
    fn decode_prefixed_event_ignores_plain_lines() {
        assert!(decode_stderr_event("plain stderr line").is_none());
    }

    const TEST_COMPACTION_ID: &str = "018f0f4e-7b31-7d2a-aaf1-27e9d4c87911";

    fn test_compaction_id() -> Uuid {
        Uuid::parse_str(TEST_COMPACTION_ID).unwrap()
    }

    fn test_compaction_events() -> Vec<AgentEvent> {
        let compaction_id = test_compaction_id();
        vec![
            AgentEvent::OrchestratorCompactionStarted {
                compaction_id,
                reason: CompactionReason::Auto,
            },
            AgentEvent::OrchestratorCompactionCompleted {
                compaction_id,
                reason: CompactionReason::Manual,
            },
            AgentEvent::OrchestratorCompactionSkipped {
                compaction_id,
                reason: CompactionReason::Auto,
                cause: CompactionSkipReason::NoEligibleBoundary,
            },
            AgentEvent::OrchestratorCompactionFailed {
                compaction_id,
                reason: CompactionReason::Manual,
                failure: CompactionFailure::CheckpointPersistenceFailed,
            },
        ]
    }

    #[test]
    fn compaction_enum_json_values_are_exact_and_round_trip() {
        for (reason, expected) in [
            (CompactionReason::Auto, r#""auto""#),
            (CompactionReason::Manual, r#""manual""#),
        ] {
            assert_eq!(serde_json::to_string(&reason).unwrap(), expected);
            assert_eq!(
                serde_json::from_str::<CompactionReason>(expected).unwrap(),
                reason
            );
        }
        for (reason, expected) in [
            (
                CompactionSkipReason::NoEligibleBoundary,
                r#""no_eligible_boundary""#,
            ),
            (
                CompactionSkipReason::AlreadyCompacted,
                r#""already_compacted""#,
            ),
        ] {
            assert_eq!(serde_json::to_string(&reason).unwrap(), expected);
            assert_eq!(
                serde_json::from_str::<CompactionSkipReason>(expected).unwrap(),
                reason
            );
        }
        for (failure, expected) in [
            (
                CompactionFailure::SummaryRequestFailed,
                r#""summary_request_failed""#,
            ),
            (CompactionFailure::SummaryRejected, r#""summary_rejected""#),
            (
                CompactionFailure::CheckpointPersistenceFailed,
                r#""checkpoint_persistence_failed""#,
            ),
            (CompactionFailure::Cancelled, r#""cancelled""#),
        ] {
            assert_eq!(serde_json::to_string(&failure).unwrap(), expected);
            assert_eq!(
                serde_json::from_str::<CompactionFailure>(expected).unwrap(),
                failure
            );
        }
    }

    #[test]
    fn compaction_agent_event_json_is_exact_and_nested_under_agent() {
        let expected = [
            format!(
                r#"{{"type":"orchestrator_compaction_started","compaction_id":"{TEST_COMPACTION_ID}","reason":"auto"}}"#
            ),
            format!(
                r#"{{"type":"orchestrator_compaction_completed","compaction_id":"{TEST_COMPACTION_ID}","reason":"manual"}}"#
            ),
            format!(
                r#"{{"type":"orchestrator_compaction_skipped","compaction_id":"{TEST_COMPACTION_ID}","reason":"auto","cause":"no_eligible_boundary"}}"#
            ),
            format!(
                r#"{{"type":"orchestrator_compaction_failed","compaction_id":"{TEST_COMPACTION_ID}","reason":"manual","failure":"checkpoint_persistence_failed"}}"#
            ),
        ];

        for (event, expected) in test_compaction_events().into_iter().zip(expected) {
            assert_eq!(serde_json::to_string(&event).unwrap(), expected);
            assert_eq!(
                serde_json::from_str::<AgentEvent>(&expected).unwrap(),
                event
            );
        }

        let event = AgentEvent::OrchestratorCompactionStarted {
            compaction_id: test_compaction_id(),
            reason: CompactionReason::Manual,
        };
        assert_eq!(
            serde_json::to_string(&SessionEvent::Agent { event }).unwrap(),
            format!(
                r#"{{"type":"agent","event":{{"type":"orchestrator_compaction_started","compaction_id":"{TEST_COMPACTION_ID}","reason":"manual"}}}}"#
            )
        );
    }

    #[test]
    fn compaction_event_sanitization_preserves_only_typed_safe_fields() {
        for event in test_compaction_events() {
            assert_eq!(sanitize_external_agent_event(event.clone()), Some(event));
        }

        let encoded = format!(
            r#"{{
                "type":"orchestrator_compaction_failed",
                "compaction_id":"{TEST_COMPACTION_ID}",
                "reason":"manual",
                "failure":"summary_request_failed",
                "summary":"CANARY_SUMMARY",
                "prompt":"CANARY_PROMPT",
                "transcript":"CANARY_TRANSCRIPT",
                "provider_response":"CANARY_RESPONSE",
                "path":"CANARY_PATH",
                "digest":"CANARY_DIGEST",
                "checkpoint_id":"CANARY_CHECKPOINT",
                "estimates":"CANARY_ESTIMATES",
                "error":"CANARY_ERROR"
            }}"#
        );
        let decoded = serde_json::from_str::<AgentEvent>(&encoded).unwrap();
        let sanitized = sanitize_external_agent_event(decoded).unwrap();
        let serialized = serde_json::to_string(&sanitized).unwrap();

        assert_eq!(
            serialized,
            format!(
                r#"{{"type":"orchestrator_compaction_failed","compaction_id":"{TEST_COMPACTION_ID}","reason":"manual","failure":"summary_request_failed"}}"#
            )
        );
        assert!(!serialized.contains("CANARY"));
    }

    #[tokio::test]
    async fn compaction_event_sink_supports_manual_and_automatic_context() {
        let bus = SessionEventBus::new(Some("session-compaction-context".to_string()));
        let mut receiver = bus.subscribe();
        let manual_client_id = SessionClientId::new();
        let automatic_client_id = SessionClientId::new();
        let automatic_run_id = SessionRunId::new();
        let manual_sink =
            EventSink::bus_with_context(bus.clone(), None, Some(manual_client_id.clone()));
        let automatic_sink = EventSink::bus_with_context(
            bus,
            Some(automatic_run_id.clone()),
            Some(automatic_client_id.clone()),
        );

        manual_sink.emit(AgentEvent::OrchestratorCompactionStarted {
            compaction_id: test_compaction_id(),
            reason: CompactionReason::Manual,
        });
        automatic_sink.emit(AgentEvent::OrchestratorCompactionCompleted {
            compaction_id: test_compaction_id(),
            reason: CompactionReason::Auto,
        });

        let manual = receiver.recv().await.unwrap();
        assert_eq!(manual.run_id, None);
        assert_eq!(manual.client_id, Some(manual_client_id));
        assert!(matches!(
            manual.event,
            SessionEvent::Agent {
                event: AgentEvent::OrchestratorCompactionStarted {
                    reason: CompactionReason::Manual,
                    ..
                }
            }
        ));

        let automatic = receiver.recv().await.unwrap();
        assert_eq!(automatic.run_id, Some(automatic_run_id));
        assert_eq!(automatic.client_id, Some(automatic_client_id));
        assert!(matches!(
            automatic.event,
            SessionEvent::Agent {
                event: AgentEvent::OrchestratorCompactionCompleted {
                    reason: CompactionReason::Auto,
                    ..
                }
            }
        ));
    }

    #[test]
    fn compaction_events_are_bounded_and_participate_in_replay() {
        let bus = SessionEventBus::new(Some("session-compaction-replay".to_string()));
        let events = test_compaction_events();
        let envelopes = events
            .iter()
            .cloned()
            .map(|event| bus.emit_agent(event).unwrap())
            .collect::<Vec<_>>();

        for event in &events {
            assert!(serde_json::to_vec(event).unwrap().len() < 256);
        }
        for envelope in &envelopes {
            assert!(serialized_envelope_len(envelope, SESSION_EVENT_BUS_REPLAY_BYTE_CAP).is_some());
        }
        assert_eq!(bus.recent_events(None, events.len()).1, envelopes);

        let cursor = SessionEventBoundary {
            epoch_id: envelopes[0].epoch_id.clone(),
            sequence_id: 0,
        };
        let subscription = bus.subscribe_for_client_with_replay(
            SessionClientId::new(),
            Some(&cursor),
            events.len(),
        );
        assert_eq!(subscription.replay_gap, None);
        assert_eq!(subscription.replayed_events, envelopes);
    }

    #[test]
    fn compaction_events_are_replayed_but_never_persisted_as_thread_events() {
        let path = std::env::temp_dir()
            .join(format!("nac_compaction_events_{}", Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-compaction-events");
        let bus = SessionEventBus::with_thread_event_store(
            Some("session-compaction-events".to_string()),
            path.clone(),
        );
        let events = test_compaction_events();

        for event in &events {
            assert_eq!(persisted_thread_event_name(event), None);
            bus.emit_agent(event.clone()).unwrap();
        }

        assert!(crate::store::load_all_thread_events(
            &path,
            "session-compaction-events",
            events.len()
        )
        .unwrap()
        .is_empty());
        assert_eq!(
            bus.recent_events(None, events.len())
                .1
                .into_iter()
                .map(|envelope| match envelope.event {
                    SessionEvent::Agent { event } => event,
                    event => panic!("expected agent event, got {event:?}"),
                })
                .collect::<Vec<_>>(),
            events
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn session_event_bus_broadcasts_monotonic_envelopes_to_multiple_subscribers() {
        let bus = SessionEventBus::new(Some("session-1".to_string()));
        let mut first = bus.subscribe();
        let mut second = bus.subscribe();

        bus.emit_agent(AgentEvent::AssistantMessage {
            thread_name: Some("impl".to_string()),
            content: "started".to_string(),
            usage: None,
        });
        bus.emit(SessionEvent::RunCompleted {
            response: "done".to_string(),
            duration_ms: None,
        });

        let first_one = first.recv().await.unwrap();
        let first_two = first.recv().await.unwrap();
        let second_one = second.recv().await.unwrap();
        let second_two = second.recv().await.unwrap();

        assert_eq!(first_one.session_id.as_deref(), Some("session-1"));
        assert_eq!(first_one.sequence_id, 1);
        assert_eq!(first_two.sequence_id, 2);
        assert!(first_one.client_id.is_none());
        assert!(first_one.run_id.is_none());
        assert_eq!(second_one, first_one);
        assert_eq!(second_two, first_two);
        assert!(matches!(
            first_one.event,
            SessionEvent::Agent {
                event: AgentEvent::AssistantMessage { .. }
            }
        ));
        assert_eq!(
            first_two.event,
            SessionEvent::RunCompleted {
                response: "done".to_string(),
                duration_ms: None
            }
        );
    }

    #[test]
    fn session_event_bus_replays_recent_envelopes_in_order() {
        let bus = SessionEventBus::new(Some("session-replay".to_string()));

        let first = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "one".to_string(),
                usage: None,
            })
            .unwrap();
        let second = bus.emit(SessionEvent::RunCompleted {
            response: "done".to_string(),
            duration_ms: None,
        });

        assert_eq!(
            bus.recent_events(None, 10).1,
            vec![first.clone(), second.clone()]
        );
        let cursor = SessionEventBoundary {
            epoch_id: first.epoch_id.clone(),
            sequence_id: first.sequence_id,
        };
        assert_eq!(bus.recent_events(Some(&cursor), 10).1, vec![second]);
    }

    #[test]
    fn replay_cursor_sequence_is_fenced_by_epoch() {
        let bus = SessionEventBus::with_capacity(Some("session-a".to_string()), 8);
        let first = bus.emit(SessionEvent::RunFailed {
            message: "one".to_string(),
        });
        let second = bus.emit(SessionEvent::RunFailed {
            message: "two".to_string(),
        });

        let same_epoch_cursor = SessionEventBoundary {
            epoch_id: first.epoch_id.clone(),
            sequence_id: first.sequence_id,
        };
        let same_epoch = bus.subscribe_for_client_with_replay(
            SessionClientId::new(),
            Some(&same_epoch_cursor),
            8,
        );
        assert_eq!(same_epoch.replayed_events, vec![second.clone()]);

        let old_epoch_cursor = SessionEventBoundary {
            epoch_id: "previous-process".to_string(),
            sequence_id: u64::MAX,
        };
        let old_epoch = bus.subscribe_for_client_with_replay(
            SessionClientId::new(),
            Some(&old_epoch_cursor),
            8,
        );
        assert_eq!(old_epoch.epoch_id, first.epoch_id);
        assert!(old_epoch.replayed_events.is_empty());
        assert_eq!(old_epoch.replay_gap, None);

        let (boundary, recent) = bus.recent_events(Some(&old_epoch_cursor), 8);
        assert_eq!(boundary.epoch_id, first.epoch_id);
        assert_eq!(boundary.sequence_id, second.sequence_id);
        assert!(recent.is_empty());
    }

    #[test]
    fn session_event_bus_replay_filters_after_sequence_and_trims_capacity() {
        let bus = SessionEventBus::with_capacity(Some("session-trim".to_string()), 2);

        let first = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "one".to_string(),
                usage: None,
            })
            .unwrap();
        let second = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "two".to_string(),
                usage: None,
            })
            .unwrap();
        let third = bus.emit(SessionEvent::RunFailed {
            message: "boom".to_string(),
        });

        assert_eq!(first.sequence_id, 1);
        assert_eq!(
            bus.recent_events(None, 10).1,
            vec![second.clone(), third.clone()]
        );
        let first_cursor = SessionEventBoundary {
            epoch_id: first.epoch_id.clone(),
            sequence_id: first.sequence_id,
        };
        assert_eq!(
            bus.recent_events(Some(&first_cursor), 10).1,
            vec![second.clone(), third.clone()]
        );
        let second_cursor = SessionEventBoundary {
            epoch_id: second.epoch_id.clone(),
            sequence_id: second.sequence_id,
        };
        assert_eq!(
            bus.recent_events(Some(&second_cursor), 10).1,
            vec![third.clone()]
        );
        assert_eq!(bus.recent_events(None, 1).1, vec![third.clone()]);
        assert!(bus.recent_events(None, 0).1.is_empty());

        let zero_cursor = SessionEventBoundary {
            epoch_id: first.epoch_id.clone(),
            sequence_id: 0,
        };
        let subscription =
            bus.subscribe_for_client_with_replay(SessionClientId::new(), Some(&zero_cursor), 10);
        assert_eq!(
            subscription.oldest_retained_sequence_id,
            Some(second.sequence_id)
        );
        assert_eq!(
            subscription.newest_retained_sequence_id,
            Some(third.sequence_id)
        );
        assert_eq!(
            subscription.replay_gap,
            Some(SessionReplayGap {
                missing_from_sequence_id: 1,
                missing_to_sequence_id: 1,
            })
        );
        assert_eq!(subscription.replayed_events, vec![second, third]);
    }

    #[test]
    fn session_event_bus_replay_trims_to_byte_capacity() {
        let sample_bus = SessionEventBus::with_limits(Some("session-byte".to_string()), 10, 4096);
        let sample = sample_bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "one".to_string(),
                usage: None,
            })
            .unwrap();
        let sample_size = serialized_envelope_len(&sample, usize::MAX).unwrap();

        let bus = SessionEventBus::with_limits(Some("session-byte".to_string()), 10, sample_size);
        let first = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "one".to_string(),
                usage: None,
            })
            .unwrap();
        let second = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "two".to_string(),
                usage: None,
            })
            .unwrap();

        assert_eq!(first.sequence_id, 1);
        assert_eq!(second.sequence_id, 2);
        assert_eq!(bus.recent_events(None, 10).1, vec![second]);
    }

    #[tokio::test]
    async fn session_event_bus_broadcasts_but_does_not_replay_events_larger_than_byte_capacity() {
        let bus = SessionEventBus::with_limits(Some("session-large".to_string()), 10, 1);
        let mut subscriber = bus.subscribe();

        let emitted = bus.emit(SessionEvent::RunCompleted {
            response: "large".to_string(),
            duration_ms: None,
        });

        assert!(bus.recent_events(None, 10).1.is_empty());
        assert_eq!(subscriber.recv().await.unwrap(), emitted);
    }

    #[test]
    fn replay_subscription_reports_non_replayable_gap_between_retained_events() {
        let sample_bus =
            SessionEventBus::with_limits(Some("session-replay-large".to_string()), 10, 4096);
        let sample = sample_bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "sample".to_string(),
                usage: None,
            })
            .unwrap();
        let byte_capacity = serialized_envelope_len(&sample, usize::MAX).unwrap() * 4;
        let bus = SessionEventBus::with_limits(
            Some("session-replay-large".to_string()),
            10,
            byte_capacity,
        );
        let before = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "before".to_string(),
                usage: None,
            })
            .unwrap();
        let oversize = bus.emit(SessionEvent::RunCompleted {
            response: "x".repeat(byte_capacity * 8),
            duration_ms: None,
        });
        let after = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "after".to_string(),
                usage: None,
            })
            .unwrap();

        let subscription = bus.subscribe_for_client_with_replay(SessionClientId::new(), None, 10);

        assert_eq!(oversize.sequence_id, before.sequence_id + 1);
        assert_eq!(after.sequence_id, oversize.sequence_id + 1);
        assert_eq!(
            subscription.oldest_retained_sequence_id,
            Some(before.sequence_id)
        );
        assert_eq!(
            subscription.newest_retained_sequence_id,
            Some(after.sequence_id)
        );
        assert_eq!(subscription.replayed_events, vec![before, after]);
        assert_eq!(
            subscription.replay_gap,
            Some(SessionReplayGap {
                missing_from_sequence_id: oversize.sequence_id,
                missing_to_sequence_id: oversize.sequence_id,
            })
        );
    }

    #[tokio::test]
    async fn replay_subscription_delivers_non_replayed_oversize_live_after_boundary() {
        let sample_bus =
            SessionEventBus::with_limits(Some("session-live-large".to_string()), 10, 4096);
        let sample = sample_bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "sample".to_string(),
                usage: None,
            })
            .unwrap();
        let byte_capacity = serialized_envelope_len(&sample, usize::MAX).unwrap() * 4;
        let bus =
            SessionEventBus::with_limits(Some("session-live-large".to_string()), 10, byte_capacity);
        let before = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "before".to_string(),
                usage: None,
            })
            .unwrap();

        let mut subscription =
            bus.subscribe_for_client_with_replay(SessionClientId::new(), None, 10);
        let oversize = bus.emit(SessionEvent::RunCompleted {
            response: "x".repeat(byte_capacity * 8),
            duration_ms: None,
        });
        let after = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "after".to_string(),
                usage: None,
            })
            .unwrap();

        assert_eq!(subscription.replay_boundary_sequence_id, before.sequence_id);
        assert_eq!(subscription.replayed_events, vec![before]);
        assert_eq!(subscription.receiver.recv().await.unwrap(), oversize);
        assert_eq!(subscription.receiver.recv().await.unwrap(), after.clone());
        let cursor = SessionEventBoundary {
            epoch_id: after.epoch_id.clone(),
            sequence_id: subscription.replay_boundary_sequence_id,
        };
        assert_eq!(bus.recent_events(Some(&cursor), 10).1, vec![after]);
    }

    #[tokio::test]
    async fn replay_subscription_replays_boundary_events_then_live_without_gap() {
        let bus = SessionEventBus::new(Some("session-gap".to_string()));
        let first = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "one".to_string(),
                usage: None,
            })
            .unwrap();
        let second = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("impl".to_string()),
                content: "two".to_string(),
                usage: None,
            })
            .unwrap();

        let cursor = SessionEventBoundary {
            epoch_id: first.epoch_id.clone(),
            sequence_id: first.sequence_id,
        };
        let mut subscription =
            bus.subscribe_for_client_with_replay(SessionClientId::new(), Some(&cursor), 10);
        let third = bus.emit(SessionEvent::RunFailed {
            message: "three".to_string(),
        });

        assert_eq!(subscription.replay_boundary_sequence_id, second.sequence_id);
        assert_eq!(
            subscription.oldest_retained_sequence_id,
            Some(first.sequence_id)
        );
        assert_eq!(
            subscription.newest_retained_sequence_id,
            Some(second.sequence_id)
        );
        assert_eq!(subscription.replay_gap, None);
        assert_eq!(subscription.replayed_events, vec![second.clone()]);
        assert_eq!(subscription.receiver.recv().await.unwrap(), third.clone());
        assert_eq!(
            vec![second.sequence_id, third.sequence_id],
            vec![first.sequence_id + 1, first.sequence_id + 2]
        );
    }

    #[tokio::test]
    async fn client_subscriptions_have_unique_ids_and_receive_same_events() {
        let bus = SessionEventBus::new(Some("session-client".to_string()));
        let client_id = SessionClientId::new();
        let mut first = bus.subscribe_for_client(client_id.clone());
        let mut second = bus.subscribe_for_client(client_id.clone());

        assert_eq!(first.client_id, client_id);
        assert_eq!(second.client_id, client_id);
        assert_ne!(first.subscription_id, second.subscription_id);

        bus.emit(SessionEvent::SnapshotSaved {
            session_id: "session-client".to_string(),
        });

        let first_event = first.receiver.recv().await.unwrap();
        let second_event = second.receiver.recv().await.unwrap();
        assert_eq!(first_event, second_event);
        assert_eq!(first_event.sequence_id, 1);
    }

    #[tokio::test]
    async fn event_sink_can_emit_agent_events_to_legacy_channel_and_session_bus() {
        let (tx, mut legacy_rx) = tokio::sync::mpsc::unbounded_channel();
        let legacy_sink = EventSink::channel(tx);
        let bus = SessionEventBus::new(Some("session-2".to_string()));
        let mut bus_rx = bus.subscribe();
        let bus_sink = EventSink::bus(bus);
        let event = AgentEvent::RunFinished { thread_name: None };

        legacy_sink.emit(event.clone());
        bus_sink.emit(event.clone());

        assert_eq!(legacy_rx.recv().await, Some(event.clone()));
        let envelope = bus_rx.recv().await.unwrap();
        assert_eq!(envelope.sequence_id, 1);
        assert!(envelope.client_id.is_none());
        assert!(envelope.run_id.is_none());
        assert_eq!(
            envelope.event,
            SessionEvent::Agent {
                event: event.clone()
            }
        );
    }

    #[tokio::test]
    async fn event_sink_preserves_run_and_client_context_on_session_bus() {
        let bus = SessionEventBus::new(Some("session-context".to_string()));
        let mut bus_rx = bus.subscribe();
        let run_id = SessionRunId::new();
        let client_id = SessionClientId::new();
        let sink = EventSink::bus_with_context(bus, Some(run_id.clone()), Some(client_id.clone()));

        sink.emit(AgentEvent::RunFinished { thread_name: None });

        let envelope = bus_rx.recv().await.unwrap();
        assert_eq!(envelope.run_id.as_ref(), Some(&run_id));
        assert_eq!(envelope.client_id.as_ref(), Some(&client_id));
        assert!(!envelope.epoch_id.is_empty());
    }

    #[test]
    fn model_start_and_thread_logs_are_never_forwarded() {
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let channel_sink = EventSink::channel(sender);
        let bus = SessionEventBus::new(Some("session-internal".to_string()));
        let mut bus_receiver = bus.subscribe();
        let bus_sink = EventSink::bus(bus.clone());
        for event in [
            AgentEvent::ModelCallStarted {
                thread_name: Some("worker".to_string()),
                iteration: 1,
            },
            AgentEvent::ThreadLog {
                name: "worker".to_string(),
                line: "CANARY_LOG".to_string(),
            },
        ] {
            channel_sink.emit(event.clone());
            bus_sink.emit(event);
        }

        assert!(receiver.try_recv().is_err());
        assert!(bus_receiver.try_recv().is_err());
        assert!(bus.recent_events(None, 10).1.is_empty());
    }

    #[test]
    fn batched_edit_telemetry_counts_without_leaking_content_or_revision() {
        let detail = serde_json::json!({
            "path": "/safe/file.txt",
            "expected_revision": "CANARY_REVISION",
            "edits": [
                {"old_text": "CANARY_OLD", "new_text": "new"},
                {"old_text": "x", "new_text": "CANARY_NEW"}
            ]
        })
        .to_string();
        let safe = safe_tool_arguments("edit", Some(&detail), "");
        let value: serde_json::Value = serde_json::from_str(&safe).unwrap();
        assert_eq!(value["path"], "/safe/file.txt");
        assert_eq!(value["edit_count"], 2);
        assert_eq!(value["old_text_chars"], 11);
        assert_eq!(value["new_text_chars"], 13);
        assert!(!safe.contains("CANARY"));
        assert!(value.get("expected_revision").is_none());
    }

    #[test]
    fn external_tool_telemetry_is_fail_closed_before_channel_and_database() {
        let path = std::env::temp_dir()
            .join(format!("nac_event_sanitization_{}", Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-safe-events");
        let bus = SessionEventBus::with_thread_event_store(
            Some("session-safe-events".to_string()),
            path.clone(),
        );
        let bus_sink = EventSink::bus(bus.clone());
        let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
        let channel_sink = EventSink::channel(sender);
        let started = AgentEvent::ToolCallStarted {
            thread_name: Some("worker".to_string()),
            call_id: "call-safe".to_string(),
            name: "exec_command".to_string(),
            args_preview: "CANARY_COMMAND".to_string(),
            key_arg_preview: None,
            args_detail: Some(
                serde_json::json!({
                    "cmd": "echo test_safe_cmd",
                    "workdir": "/safe/work",
                    "query": "CANARY_QUERY",
                    "body": "CANARY_BODY",
                    "headers": {"authorization": "CANARY_HEADER"},
                    "chars": "CANARY_STDIN"
                })
                .to_string(),
            ),
        };
        channel_sink.emit(started.clone());
        channel_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: Some("worker".to_string()),
            call_id: "call-write".to_string(),
            name: "write".to_string(),
            args_preview: "CANARY_WRITE".to_string(),
            key_arg_preview: None,
            args_detail: Some(
                serde_json::json!({
                    "path": "/safe/file.txt",
                    "content": "CANARY_WRITE"
                })
                .to_string(),
            ),
        });
        bus_sink.emit(started);
        bus_sink.emit(AgentEvent::ToolCallFinished {
            thread_name: Some("worker".to_string()),
            call_id: "call-safe".to_string(),
            name: "exec_command".to_string(),
            content_preview: "exit 7: test result".to_string(),
            is_error: true,
            command_status: Some(crate::terminal::CommandStatus::Completed),
            exit_code: Some(7),
        });
        bus_sink.emit(AgentEvent::Error {
            thread_name: Some("worker".to_string()),
            message: "CANARY_ERROR".to_string(),
        });
        bus_sink.emit(AgentEvent::ThreadStarted {
            name: "worker".to_string(),
            action: "CANARY_ACTION".to_string(),
            source_threads: vec!["source".to_string()],
        });
        bus_sink.emit(AgentEvent::ThreadFinished {
            name: "worker".to_string(),
            exit_code: -1,
            timed_out: true,
            timeout_reason: Some("CANARY_TIMEOUT".to_string()),
            usage: None,
        });

        let channel_event = receiver.try_recv().unwrap();
        let AgentEvent::ToolCallStarted {
            args_preview,
            args_detail,
            key_arg_preview,
            ..
        } = channel_event
        else {
            panic!("expected sanitized tool start");
        };
        assert!(args_detail.is_none());
        assert!(args_preview.contains("/safe/work"));
        assert!(args_preview.contains("execute"));
        // cmd is stripped from the sanitized JSON args_preview
        assert!(!args_preview.contains("CANARY"));
        assert!(!args_preview.contains("test_safe_cmd"));
        // cmd IS preserved in key_arg_preview (human-readable snippet)
        assert_eq!(key_arg_preview.as_deref(), Some("echo test_safe_cmd"));
        let AgentEvent::ToolCallStarted { args_preview, .. } = receiver.try_recv().unwrap() else {
            panic!("expected sanitized write start");
        };
        assert!(args_preview.contains("/safe/file.txt"));
        assert!(args_preview.contains("\"content_chars\":12"));
        assert!(!args_preview.contains("CANARY"));

        let records =
            crate::store::load_all_thread_events(&path, "session-safe-events", 20).unwrap();
        assert_eq!(records["worker"].len(), 5);
        let serialized = records["worker"]
            .iter()
            .map(|record| record.event_json.as_str())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!serialized.contains("CANARY"));
        assert!(serialized.contains("/safe/work"));
        assert!(serialized.contains("exit 7: test result"));
        assert!(serialized.contains("operation failed"));
        assert!(serialized.contains("thread dispatched"));
        assert!(serialized.contains("thread timed out"));
        let replay = serde_json::to_string(&bus.recent_events(None, 20).1).unwrap();
        assert!(!replay.contains("CANARY"));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn concurrent_emitters_linearize_persistence_replay_and_broadcast() {
        const THREADS: usize = 8;
        const EVENTS_PER_THREAD: usize = 16;
        let path = std::env::temp_dir()
            .join(format!("nac_event_order_{}", Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-order");
        let bus = SessionEventBus::with_thread_event_store(
            Some("session-order".to_string()),
            path.clone(),
        );
        let mut receiver = bus.subscribe();
        let barrier = Arc::new(std::sync::Barrier::new(THREADS));
        let emitted = Arc::new(StdMutex::new(Vec::new()));
        let handles = (0..THREADS)
            .map(|thread| {
                let bus = bus.clone();
                let barrier = barrier.clone();
                let emitted = emitted.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    for index in 0..EVENTS_PER_THREAD {
                        let content = format!("{thread}:{index}");
                        let envelope = bus
                            .emit_agent(AgentEvent::AssistantMessage {
                                thread_name: Some("worker".to_string()),
                                content: content.clone(),
                                usage: None,
                            })
                            .unwrap();
                        emitted
                            .lock()
                            .unwrap()
                            .push((content, envelope.sequence_id));
                    }
                })
            })
            .collect::<Vec<_>>();
        for handle in handles {
            handle.join().unwrap();
        }
        let total = THREADS * EVENTS_PER_THREAD;
        let broadcast_ids = (0..total)
            .map(|_| receiver.try_recv().unwrap().sequence_id)
            .collect::<Vec<_>>();
        assert_eq!(broadcast_ids, (1..=total as u64).collect::<Vec<_>>());
        let replay_ids = bus
            .recent_events(None, total)
            .1
            .into_iter()
            .map(|event| event.sequence_id)
            .collect::<Vec<_>>();
        assert_eq!(replay_ids, broadcast_ids);

        let sequence_by_content = emitted
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect::<std::collections::HashMap<_, _>>();
        let records = crate::store::load_all_thread_events(&path, "session-order", total).unwrap();
        let persisted_ids = records["worker"]
            .iter()
            .map(|record| {
                let event: AgentEvent = serde_json::from_str(&record.event_json).unwrap();
                let AgentEvent::AssistantMessage { content, .. } = event else {
                    panic!("expected assistant event");
                };
                sequence_by_content[&content]
            })
            .collect::<Vec<_>>();
        assert_eq!(persisted_ids, broadcast_ids);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_thread_event_append_does_not_publish_or_advance_boundary() {
        let path = std::env::temp_dir()
            .join(format!("nac_event_writer_failure_{}", Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        let bus = SessionEventBus::with_thread_event_store(
            Some("session-writer-failure".to_string()),
            path.clone(),
        );
        let mut receiver = bus.subscribe();

        let failed = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("worker".to_string()),
                content: "not persisted".to_string(),
                usage: None,
            })
            .unwrap();
        assert_eq!(failed.sequence_id, 1);
        assert!(receiver.try_recv().is_err());
        assert!(bus.recent_events(None, 10).1.is_empty());
        let (boundary, records) = bus
            .thread_event_boundary(|| {
                crate::store::load_all_thread_events(&path, "session-writer-failure", 10)
            })
            .unwrap();
        assert_eq!(boundary.sequence_id, 0);
        assert!(records.is_empty());

        crate::store::insert_test_session(&path, "session-writer-failure");
        let published = bus
            .emit_agent(AgentEvent::AssistantMessage {
                thread_name: Some("worker".to_string()),
                content: "persisted".to_string(),
                usage: None,
            })
            .unwrap();
        assert_eq!(published.sequence_id, 2);
        assert_eq!(receiver.try_recv().unwrap(), published);

        let subscription = bus.subscribe_for_client_with_replay(SessionClientId::new(), None, 10);
        assert_eq!(subscription.replay_boundary_sequence_id, 2);
        assert_eq!(subscription.replayed_events, vec![published]);
        assert_eq!(
            subscription.replay_gap,
            Some(SessionReplayGap {
                missing_from_sequence_id: 1,
                missing_to_sequence_id: 1,
            })
        );
        let (boundary, records) = bus
            .thread_event_boundary(|| {
                crate::store::load_all_thread_events(&path, "session-writer-failure", 10)
            })
            .unwrap();
        assert_eq!(boundary.sequence_id, 2);
        assert_eq!(records["worker"].len(), 1);
        assert!(records["worker"][0].event_json.contains("persisted"));
        assert!(!records["worker"][0].event_json.contains("not persisted"));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn thread_event_boundary_blocks_concurrent_emit() {
        let bus = SessionEventBus::new(Some("session-boundary".to_string()));
        let query_bus = bus.clone();
        let (entered_sender, entered_receiver) = std::sync::mpsc::channel();
        let (release_sender, release_receiver) = std::sync::mpsc::channel();
        let query = std::thread::spawn(move || {
            query_bus
                .thread_event_boundary(|| {
                    entered_sender.send(()).unwrap();
                    release_receiver.recv().unwrap();
                    Ok(())
                })
                .unwrap()
                .0
        });
        entered_receiver.recv().unwrap();
        let emit_bus = bus.clone();
        let (emitted_sender, emitted_receiver) = std::sync::mpsc::channel();
        let emitter = std::thread::spawn(move || {
            let envelope = emit_bus.emit(SessionEvent::SnapshotSaved {
                session_id: "session-boundary".to_string(),
            });
            emitted_sender.send(envelope).unwrap();
        });
        assert!(emitted_receiver
            .recv_timeout(std::time::Duration::from_millis(50))
            .is_err());
        release_sender.send(()).unwrap();
        let boundary = query.join().unwrap();
        let emitted = emitted_receiver.recv().unwrap();
        emitter.join().unwrap();
        assert_eq!(boundary.sequence_id, 0);
        assert_eq!(emitted.sequence_id, 1);
        assert_eq!(boundary.epoch_id, emitted.epoch_id);
    }

    #[test]
    fn model_error_sanitization_redacts_credential_shapes_and_bounds_length() {
        let event = AgentEvent::ModelError {
            thread_name: Some("impl".to_string()),
            message: "HTTP 400 from https://api.test: Authorization: Bearer sk-canary-event-12345; x-api-key: sk-canary-event-12345; no credits".to_string(),
        };
        let sanitized = sanitize_external_agent_event(event).unwrap();
        let AgentEvent::ModelError { message, .. } = sanitized else {
            panic!("expected ModelError");
        };
        assert!(
            !message.contains("sk-canary-event-12345"),
            "credential leaked through sanitization: {message}"
        );
        assert!(message.contains("[REDACTED]"), "{message}");
        assert!(message.contains("no credits"), "{message}");
        assert!(message.contains("HTTP 400"), "{message}");
    }

    #[test]
    fn mcp_server_skipped_sanitization_redacts_credentials_and_bounds_length() {
        let long_tail = "x".repeat(700);
        let event = AgentEvent::McpServerSkipped {
            thread_name: Some("impl".to_string()),
            server_name: "github".to_string(),
            reason: format!(
                "connect failed: Authorization: Bearer sk-canary-event-12345; x-api-key: sk-canary-event-12345; no credits; {long_tail}"
            ),
        };
        let sanitized = sanitize_external_agent_event(event).unwrap();
        let AgentEvent::McpServerSkipped { reason, .. } = sanitized else {
            panic!("expected McpServerSkipped");
        };
        assert!(
            !reason.contains("sk-canary-event-12345"),
            "credential leaked through sanitization: {reason}"
        );
        assert!(reason.contains("[REDACTED]"), "{reason}");
        assert!(reason.contains("no credits"), "{reason}");
        assert!(reason.contains("connect failed"), "{reason}");
        assert!(
            reason.len() <= MAX_PROVIDER_MESSAGE_BYTES,
            "reason not bounded: {} bytes",
            reason.len()
        );
    }

    const MODEL_ERROR_CANARY: &str = "sk-canary-sink-12345";
    const MODEL_ERROR_STDERR_HELPER_ENV: &str = "NAC_MODEL_ERROR_STDERR_HELPER";

    fn credential_bearing_model_error() -> AgentEvent {
        AgentEvent::ModelError {
            thread_name: Some("impl".to_string()),
            message: format!("HTTP 400: Authorization: Bearer {MODEL_ERROR_CANARY}; no credits"),
        }
    }

    #[tokio::test]
    async fn model_error_sink_redacts_session_event_replay() {
        let bus = SessionEventBus::new(Some("session-redaction".to_string()));
        EventSink::bus(bus.clone()).emit(credential_bearing_model_error());

        let events = bus.recent_events(None, 10).1;
        assert_eq!(events.len(), 1);
        let SessionEvent::Agent {
            event: AgentEvent::ModelError { message, .. },
        } = &events[0].event
        else {
            panic!("expected replayed ModelError");
        };
        assert!(!message.contains(MODEL_ERROR_CANARY), "{message}");
        assert!(message.contains("[REDACTED]"), "{message}");
        assert!(message.contains("no credits"), "{message}");
    }

    #[test]
    fn model_error_stderr_process_helper() {
        if std::env::var_os(MODEL_ERROR_STDERR_HELPER_ENV).is_some() {
            EventSink::stderr_prefixed().emit(credential_bearing_model_error());
        }
    }

    #[test]
    fn model_error_sink_redacts_prefixed_stderr() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "events::tests::model_error_stderr_process_helper",
                "--nocapture",
            ])
            .env(MODEL_ERROR_STDERR_HELPER_ENV, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "stderr helper failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(!stderr.contains(MODEL_ERROR_CANARY), "{stderr}");
        let event = stderr
            .lines()
            .find_map(decode_stderr_event)
            .expect("prefixed ModelError on stderr");
        let AgentEvent::ModelError { message, .. } = event else {
            panic!("expected stderr ModelError");
        };
        assert!(message.contains("[REDACTED]"), "{message}");
        assert!(message.contains("no credits"), "{message}");
    }
}
