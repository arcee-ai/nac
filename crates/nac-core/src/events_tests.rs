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
    let subscription =
        bus.subscribe_for_client_with_replay(SessionClientId::new(), Some(&cursor), events.len());
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

    assert!(
        crate::store::load_all_thread_events(&path, "session-compaction-events", events.len())
            .unwrap()
            .is_empty()
    );
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
    let same_epoch =
        bus.subscribe_for_client_with_replay(SessionClientId::new(), Some(&same_epoch_cursor), 8);
    assert_eq!(same_epoch.replayed_events, vec![second.clone()]);

    let old_epoch_cursor = SessionEventBoundary {
        epoch_id: "previous-process".to_string(),
        sequence_id: u64::MAX,
    };
    let old_epoch =
        bus.subscribe_for_client_with_replay(SessionClientId::new(), Some(&old_epoch_cursor), 8);
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
    let bus =
        SessionEventBus::with_limits(Some("session-replay-large".to_string()), 10, byte_capacity);
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
    let sample_bus = SessionEventBus::with_limits(Some("session-live-large".to_string()), 10, 4096);
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

    let mut subscription = bus.subscribe_for_client_with_replay(SessionClientId::new(), None, 10);
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

    let records = crate::store::load_all_thread_events(&path, "session-safe-events", 20).unwrap();
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
    let bus =
        SessionEventBus::with_thread_event_store(Some("session-order".to_string()), path.clone());
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
