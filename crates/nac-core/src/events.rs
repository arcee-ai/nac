use std::{
    collections::VecDeque,
    io::{self, Write},
    sync::{Arc, Mutex as StdMutex},
};

use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc::UnboundedSender};
use uuid::Uuid;

pub const STDERR_EVENT_PREFIX: &str = "__NAC_EVENT__";
pub const SESSION_EVENT_BUS_CAPACITY: usize = 1024;
pub const SESSION_EVENT_BUS_REPLAY_BYTE_CAP: usize = 256 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
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
pub struct SessionRunId(String);

impl SessionRunId {
    pub fn new() -> Self {
        Self(Uuid::new_v4().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    RunStarted {
        thread_name: Option<String>,
        prompt_preview: String,
    },
    ModelCallStarted {
        thread_name: Option<String>,
        iteration: usize,
    },
    ToolCallStarted {
        thread_name: Option<String>,
        call_id: String,
        name: String,
        args_preview: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        args_detail: Option<String>,
    },
    ToolCallFinished {
        thread_name: Option<String>,
        call_id: String,
        name: String,
        content_preview: String,
        is_error: bool,
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
    ThreadFinished {
        name: String,
        exit_code: i32,
        timed_out: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        timeout_reason: Option<String>,
    },
    AssistantMessage {
        thread_name: Option<String>,
        content: String,
    },
    Error {
        thread_name: Option<String>,
        message: String,
    },
    RunFinished {
        thread_name: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionEventEnvelope {
    pub session_id: Option<String>,
    pub sequence_id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<SessionRunId>,
    pub event: SessionEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionReplayGap {
    pub missing_from_sequence_id: u64,
    pub missing_to_sequence_id: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SubmittedUserMessageSnapshot {
    pub run_id: SessionRunId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<SessionClientId>,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub baseline_user_message_count: Option<usize>,
    pub submitted_at_epoch_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SessionEvent {
    /// Agent/model progress. The canonical top-level session busy lifecycle is
    /// represented by RunStarted/RunCompleted/RunFailed. AgentEvent
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
    SnapshotSaved {
        session_id: String,
    },
}

pub type SessionEventReceiver = broadcast::Receiver<SessionEventEnvelope>;

pub struct SessionEventSubscription {
    pub client_id: SessionClientId,
    pub subscription_id: SessionSubscriptionId,
    pub receiver: SessionEventReceiver,
}

pub struct SessionEventReplaySubscription {
    pub client_id: SessionClientId,
    pub subscription_id: SessionSubscriptionId,
    pub requested_after_sequence_id: Option<u64>,
    pub replay_boundary_sequence_id: u64,
    pub oldest_retained_sequence_id: Option<u64>,
    pub newest_retained_sequence_id: Option<u64>,
    pub replay_gap: Option<SessionReplayGap>,
    pub replayed_events: Vec<SessionEventEnvelope>,
    pub receiver: SessionEventReceiver,
}

#[derive(Clone)]
pub struct SessionEventBus {
    session_id: Option<String>,
    sender: broadcast::Sender<SessionEventEnvelope>,
    state: Arc<StdMutex<SessionEventBusState>>,
    recent_capacity: usize,
    recent_byte_capacity: usize,
}

struct SessionEventBusState {
    next_sequence_id: u64,
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

    fn with_limits(session_id: Option<String>, capacity: usize, byte_capacity: usize) -> Self {
        let capacity = capacity.max(1);
        let byte_capacity = byte_capacity.max(1);
        let (sender, _) = broadcast::channel(capacity);
        Self {
            session_id,
            sender,
            state: Arc::new(StdMutex::new(SessionEventBusState {
                next_sequence_id: 0,
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
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> SessionEventReplaySubscription {
        let state = self.lock_state();
        let replay_boundary_sequence_id = state.next_sequence_id;
        let oldest_retained_sequence_id =
            state.recent.front().map(|entry| entry.envelope.sequence_id);
        let newest_retained_sequence_id =
            state.recent.back().map(|entry| entry.envelope.sequence_id);
        let replayed_events = recent_events_from_state(
            &state,
            after_sequence_id,
            Some(replay_boundary_sequence_id),
            limit,
        );
        let replay_gap = replay_gap_for(
            after_sequence_id,
            replay_boundary_sequence_id,
            &replayed_events,
        );
        let receiver = self.sender.subscribe();
        SessionEventReplaySubscription {
            client_id,
            subscription_id: SessionSubscriptionId::new(),
            requested_after_sequence_id: after_sequence_id,
            replay_boundary_sequence_id,
            oldest_retained_sequence_id,
            newest_retained_sequence_id,
            replay_gap,
            replayed_events,
            receiver,
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
        let mut state = self.lock_state();
        state.next_sequence_id = state.next_sequence_id.saturating_add(1);
        let envelope = SessionEventEnvelope {
            session_id: self.session_id.clone(),
            sequence_id: state.next_sequence_id,
            client_id,
            run_id,
            event,
        };
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

    pub fn emit_agent(&self, event: AgentEvent) -> SessionEventEnvelope {
        self.emit_agent_with_context(event, None, None)
    }

    pub fn emit_agent_with_context(
        &self,
        event: AgentEvent,
        run_id: Option<SessionRunId>,
        client_id: Option<SessionClientId>,
    ) -> SessionEventEnvelope {
        self.emit_with_context(SessionEvent::Agent { event }, run_id, client_id)
    }

    pub fn recent_events(
        &self,
        after_sequence_id: Option<u64>,
        limit: usize,
    ) -> Vec<SessionEventEnvelope> {
        let state = self.lock_state();
        recent_events_from_state(&state, after_sequence_id, None, limit)
    }

    pub fn session_id(&self) -> Option<&str> {
        self.session_id.as_deref()
    }

    fn lock_state(&self) -> std::sync::MutexGuard<'_, SessionEventBusState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
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
        if self.stderr_prefixed {
            if let Ok(encoded) = serde_json::to_string(&event) {
                eprintln!("{}{}", STDERR_EVENT_PREFIX, encoded);
            }
        }

        if let Some(bus) = &self.bus {
            bus.emit_agent_with_context(event.clone(), self.run_id.clone(), self.client_id.clone());
        }

        if let Some(channel) = &self.channel {
            let _ = channel.send(event);
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

    #[tokio::test]
    async fn session_event_bus_broadcasts_monotonic_envelopes_to_multiple_subscribers() {
        let bus = SessionEventBus::new(Some("session-1".to_string()));
        let mut first = bus.subscribe();
        let mut second = bus.subscribe();

        bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "started".to_string(),
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
                event: AgentEvent::ThreadLog { .. }
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

        let first = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "one".to_string(),
        });
        let second = bus.emit(SessionEvent::RunCompleted {
            response: "done".to_string(),
            duration_ms: None,
        });

        assert_eq!(
            bus.recent_events(None, 10),
            vec![first.clone(), second.clone()]
        );
        assert_eq!(bus.recent_events(Some(first.sequence_id), 10), vec![second]);
    }

    #[test]
    fn session_event_bus_replay_filters_after_sequence_and_trims_capacity() {
        let bus = SessionEventBus::with_capacity(Some("session-trim".to_string()), 2);

        let first = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "one".to_string(),
        });
        let second = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "two".to_string(),
        });
        let third = bus.emit(SessionEvent::RunFailed {
            message: "boom".to_string(),
        });

        assert_eq!(first.sequence_id, 1);
        assert_eq!(
            bus.recent_events(None, 10),
            vec![second.clone(), third.clone()]
        );
        assert_eq!(
            bus.recent_events(Some(1), 10),
            vec![second.clone(), third.clone()]
        );
        assert_eq!(
            bus.recent_events(Some(second.sequence_id), 10),
            vec![third.clone()]
        );
        assert_eq!(bus.recent_events(None, 1), vec![third.clone()]);
        assert!(bus.recent_events(None, 0).is_empty());

        let subscription =
            bus.subscribe_for_client_with_replay(SessionClientId::new(), Some(0), 10);
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
        let sample = sample_bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "one".to_string(),
        });
        let sample_size = serialized_envelope_len(&sample, usize::MAX).unwrap();

        let bus = SessionEventBus::with_limits(Some("session-byte".to_string()), 10, sample_size);
        let first = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "one".to_string(),
        });
        let second = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "two".to_string(),
        });

        assert_eq!(first.sequence_id, 1);
        assert_eq!(second.sequence_id, 2);
        assert_eq!(bus.recent_events(None, 10), vec![second]);
    }

    #[tokio::test]
    async fn session_event_bus_broadcasts_but_does_not_replay_events_larger_than_byte_capacity() {
        let bus = SessionEventBus::with_limits(Some("session-large".to_string()), 10, 1);
        let mut subscriber = bus.subscribe();

        let emitted = bus.emit(SessionEvent::RunCompleted {
            response: "large".to_string(),
            duration_ms: None,
        });

        assert!(bus.recent_events(None, 10).is_empty());
        assert_eq!(subscriber.recv().await.unwrap(), emitted);
    }

    #[test]
    fn replay_subscription_reports_non_replayable_gap_between_retained_events() {
        let sample_bus =
            SessionEventBus::with_limits(Some("session-replay-large".to_string()), 10, 4096);
        let sample = sample_bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "sample".to_string(),
        });
        let byte_capacity = serialized_envelope_len(&sample, usize::MAX).unwrap() * 4;
        let bus = SessionEventBus::with_limits(
            Some("session-replay-large".to_string()),
            10,
            byte_capacity,
        );
        let before = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "before".to_string(),
        });
        let oversize = bus.emit(SessionEvent::RunCompleted {
            response: "x".repeat(byte_capacity * 8),
            duration_ms: None,
        });
        let after = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "after".to_string(),
        });

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
        let sample = sample_bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "sample".to_string(),
        });
        let byte_capacity = serialized_envelope_len(&sample, usize::MAX).unwrap() * 4;
        let bus =
            SessionEventBus::with_limits(Some("session-live-large".to_string()), 10, byte_capacity);
        let before = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "before".to_string(),
        });

        let mut subscription =
            bus.subscribe_for_client_with_replay(SessionClientId::new(), None, 10);
        let oversize = bus.emit(SessionEvent::RunCompleted {
            response: "x".repeat(byte_capacity * 8),
            duration_ms: None,
        });
        let after = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "after".to_string(),
        });

        assert_eq!(subscription.replay_boundary_sequence_id, before.sequence_id);
        assert_eq!(subscription.replayed_events, vec![before]);
        assert_eq!(subscription.receiver.recv().await.unwrap(), oversize);
        assert_eq!(subscription.receiver.recv().await.unwrap(), after.clone());
        assert_eq!(
            bus.recent_events(Some(subscription.replay_boundary_sequence_id), 10),
            vec![after]
        );
    }

    #[tokio::test]
    async fn replay_subscription_replays_boundary_events_then_live_without_gap() {
        let bus = SessionEventBus::new(Some("session-gap".to_string()));
        let first = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "one".to_string(),
        });
        let second = bus.emit_agent(AgentEvent::ThreadLog {
            name: "impl".to_string(),
            line: "two".to_string(),
        });

        let mut subscription = bus.subscribe_for_client_with_replay(
            SessionClientId::new(),
            Some(first.sequence_id),
            10,
        );
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
        let event = AgentEvent::ModelCallStarted {
            thread_name: None,
            iteration: 1,
        };

        sink.emit(event.clone());

        let envelope = bus_rx.recv().await.unwrap();
        assert_eq!(envelope.run_id.as_ref(), Some(&run_id));
        assert_eq!(envelope.client_id.as_ref(), Some(&client_id));
        assert_eq!(envelope.event, SessionEvent::Agent { event });
    }
}
