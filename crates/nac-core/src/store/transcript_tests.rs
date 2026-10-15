use super::*;

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_transcript_{label}_{unique}"))
        .join("store.db")
}

fn set_snapshot_messages(path: &Path, session_id: &str, messages: &[Message]) {
    let connection = open_connection(path).unwrap();
    connection
        .execute(
            "UPDATE sessions
                 SET messages_json = ?1, visible_message_count = ?2, last_user_prompt = ?3
                 WHERE session_id = ?4",
            params![
                serde_json::to_string(messages).unwrap(),
                crate::sessions::visible_message_count(messages) as i64,
                crate::sessions::last_user_prompt(messages),
                session_id
            ],
        )
        .unwrap();
}

fn canonical(message: &Message) -> Vec<u8> {
    serde_json::to_vec(message).unwrap()
}

fn sample_messages() -> Vec<Message> {
    vec![
        Message::System {
            content: "system head".to_string(),
        },
        Message::User {
            content: "prompt".to_string(),
        },
        Message::Assistant {
            content: Some("answer".to_string()),
            reasoning_text: Some("thinking".to_string()),
            reasoning_details: None,
            tool_calls: Some(vec![crate::types::ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: crate::types::FunctionCall {
                    name: "read".to_string(),
                    arguments: "{\"path\":\"x\"}".to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "call-1".to_string(),
            content: "tool output".into(),
        },
    ]
}

#[test]
fn payload_stores_canonical_message_bytes_and_kind_tag() {
    for (message, kind, wire_kind) in [
        (
            Message::System {
                content: "s".to_string(),
            },
            TranscriptMessageKind::System,
            "system",
        ),
        (
            Message::User {
                content: "u".to_string(),
            },
            TranscriptMessageKind::User,
            "user",
        ),
        (
            Message::Assistant {
                content: Some("a".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            TranscriptMessageKind::Assistant,
            "assistant",
        ),
        (
            Message::Tool {
                tool_call_id: "c".to_string(),
                content: ("t".to_string()).into(),
            },
            TranscriptMessageKind::Tool,
            "tool",
        ),
    ] {
        let payload = encode_transcript_log_entry(7, &message).unwrap();
        assert!(payload.contains(&format!("\"{TRANSCRIPT_PAYLOAD_KEY}\":")));
        assert!(payload.contains(&format!("\"kind\":\"{wire_kind}\"")));
        let entry = decode_transcript_log_entry(&payload).unwrap();
        assert_eq!(entry.idx, 7);
        assert_eq!(entry.kind, kind);
        assert_eq!(entry.message_json.as_bytes(), canonical(&message));
    }
}

#[test]
fn image_tool_content_survives_transcript_log_replay() {
    use crate::tool_content::{ToolContent, ToolContentPart, ToolImage};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
    let mut encoded = Cursor::new(Vec::new());
    source.write_to(&mut encoded, ImageFormat::Png).unwrap();
    let image = ToolImage::validate(encoded.into_inner(), None, None).unwrap();
    let message = Message::Tool {
        tool_call_id: "call-image".to_string(),
        content: ToolContent::from_parts(vec![ToolContentPart::Image(image)]).unwrap(),
    };

    let path = temp_store_path("image_replay");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-image");
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_batch("session-image", 0, std::slice::from_ref(&message))
        .unwrap();
    let replayed = writer.read_from("session-image", 0).unwrap();
    assert_eq!(replayed[0].0, 0);
    assert_eq!(
        serde_json::to_value(&replayed[0].1).unwrap(),
        serde_json::to_value(&message).unwrap()
    );
    let _ = std::fs::remove_file(path);
}

#[test]
fn transcript_payload_is_not_an_agent_event_and_vice_versa() {
    let payload = encode_transcript_log_entry(
        0,
        &Message::User {
            content: "hi".to_string(),
        },
    )
    .unwrap();
    // Defense-in-depth: the payload must fail AgentEvent decoding so the
    // event/tile paths and sanitize-drop migration never treat it as an
    // event.
    assert!(serde_json::from_str::<crate::events::AgentEvent>(&payload).is_err());
    assert!(is_transcript_log_payload(&payload));

    let event = crate::events::AgentEvent::RunStarted {
        thread_name: None,
        prompt_preview: "run started".to_string(),
    };
    let event_json = serde_json::to_string(&event).unwrap();
    assert!(decode_transcript_log_entry(&event_json).is_none());
    assert!(!is_transcript_log_payload(&event_json));
    assert!(!is_transcript_log_payload("{malformed"));
}

#[test]
fn transcript_log_appends_read_back_in_order_with_tail_ranges() {
    let path = temp_store_path("round_trip");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    crate::store::insert_test_session(&path, "session-b");

    let writer = TranscriptLogWriter::new(&path).unwrap();
    let messages = sample_messages();
    for (idx, message) in messages.iter().enumerate() {
        writer.append("session-a", idx as u64, message).unwrap();
    }
    writer
        .append(
            "session-b",
            0,
            &Message::User {
                content: "other session".to_string(),
            },
        )
        .unwrap();

    let all = writer.read_from("session-a", 0).unwrap();
    assert_eq!(all.len(), messages.len());
    for (position, ((idx, read), expected)) in all.iter().zip(messages.iter()).enumerate() {
        assert_eq!(*idx as usize, position);
        assert_eq!(canonical(read), canonical(expected));
    }

    let tail = writer.read_from("session-a", 2).unwrap();
    assert_eq!(tail.len(), 2);
    assert_eq!(tail[0].0, 2);
    assert_eq!(canonical(&tail[0].1), canonical(&messages[2]));
    assert_eq!(tail[1].0, 3);

    assert!(writer.read_from("session-a", 4).unwrap().is_empty());
    assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 1);

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_append_batch_assigns_contiguous_indices_and_is_empty_noop() {
    let path = temp_store_path("append_batch");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    set_snapshot_messages(
        &path,
        "session-a",
        &[
            Message::System {
                content: "covered 0".to_string(),
            },
            Message::System {
                content: "covered 1".to_string(),
            },
            Message::System {
                content: "covered 2".to_string(),
            },
            Message::System {
                content: "covered 3".to_string(),
            },
        ],
    );

    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer.append_batch("session-a", 99, &[]).unwrap();
    assert!(writer.read_from("session-a", 0).unwrap().is_empty());

    let messages = sample_messages();
    writer.append_batch("session-a", 4, &messages).unwrap();
    let all = writer.read_from("session-a", 0).unwrap();
    assert_eq!(all.len(), messages.len());
    for (position, ((idx, read), expected)) in all.iter().zip(messages.iter()).enumerate() {
        assert_eq!(*idx as usize, 4 + position);
        assert_eq!(canonical(read), canonical(expected));
    }

    let summary_before_rejection = crate::sessions::list_sessions(&path).unwrap().remove(0);
    for rejected_start in [3, 9] {
        let error = writer
            .append_batch(
                "session-a",
                rejected_start,
                &[Message::User {
                    content: "must not persist".to_string(),
                }],
            )
            .unwrap_err();
        assert!(
            error.to_string().contains("expected start idx 8"),
            "{error:#}"
        );
    }
    assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 4);
    let summary_after_rejection = crate::sessions::list_sessions(&path).unwrap().remove(0);
    assert_eq!(
        summary_after_rejection.visible_message_count,
        summary_before_rejection.visible_message_count
    );
    assert_eq!(
        summary_after_rejection.last_user_prompt,
        summary_before_rejection.last_user_prompt
    );

    // A follow-up batch continues from the end of the previous one.
    writer
        .append_batch(
            "session-a",
            8,
            &[Message::User {
                content: "tail".to_string(),
            }],
        )
        .unwrap();
    let tail = writer.read_from("session-a", 8).unwrap();
    assert_eq!(tail.len(), 1);
    assert_eq!(tail[0].0, 8);
    let summary = crate::sessions::list_sessions(&path).unwrap().remove(0);
    assert_eq!(summary.visible_message_count, 2);
    assert_eq!(summary.last_user_prompt.as_deref(), Some("tail"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn steering_acknowledgement_and_transcript_append_are_atomic() {
    let path = temp_store_path("steering_atomic");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    let steer = queue_thread_steering(
        &path,
        "session",
        ORCHESTRATOR_STEERING_TARGET,
        "dispatch",
        "keep going",
    )
    .unwrap();
    assert_eq!(
        claim_thread_steering(&path, "session", "dispatch")
            .unwrap()
            .len(),
        1
    );
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let messages = [Message::User {
        content: "keep going".to_string(),
    }];

    writer
        .append_claimed_thread_steering("session", "dispatch", &[steer.id], 1, &messages)
        .unwrap_err();
    assert!(writer.read_from("session", 0).unwrap().is_empty());
    assert_eq!(
        list_thread_steering(&path, "session").unwrap()[0].status,
        "claimed"
    );

    writer
        .append_claimed_thread_steering("session", "dispatch", &[steer.id], 0, &messages)
        .unwrap();
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 1);
    assert_eq!(
        list_thread_steering(&path, "session").unwrap()[0].status,
        "delivered"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn inbox_delivery_and_transcript_commit_are_atomic_for_steers_and_prompts() {
    let path = temp_store_path("inbox_atomic");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    let steer = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Steer,
        "steer now",
        Some("run-a"),
        None,
    )
    .unwrap();
    let queued = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "next prompt",
        None,
        None,
    )
    .unwrap();
    let writer = TranscriptLogWriter::new(&path).unwrap();

    let delivered = writer
        .append_pending_inbox_steers("session", "run-a", 0)
        .unwrap();
    assert_eq!(
        delivered.iter().map(|record| record.id).collect::<Vec<_>>(),
        vec![steer.id]
    );
    assert!(writer
        .append_pending_inbox_steers("session", "run-a", 1)
        .unwrap()
        .is_empty());
    assert_eq!(
        load_session_inbox_item(&path, "session", steer.id)
            .unwrap()
            .status,
        InboxStatus::Delivered
    );
    assert_eq!(
        load_session_inbox_item(&path, "session", queued.id)
            .unwrap()
            .status,
        InboxStatus::Pending
    );

    writer
        .append_inbox_run_prompt(
            "session",
            1,
            &Message::User {
                content: "next prompt".to_string(),
            },
            "run-b",
            queued.id,
        )
        .unwrap();
    let queued = load_session_inbox_item(&path, "session", queued.id).unwrap();
    assert_eq!(queued.status, InboxStatus::Delivered);
    assert_eq!(queued.delivered_run_id.as_deref(), Some("run-b"));
    assert_eq!(
        load_run_recovery(&path, "session").unwrap().unwrap().run_id,
        "run-b"
    );

    let mismatch = create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "canonical",
        None,
        None,
    )
    .unwrap();
    assert!(writer
        .append_inbox_run_prompt(
            "session",
            2,
            &Message::User {
                content: "different".to_string(),
            },
            "run-c",
            mismatch.id,
        )
        .is_err());
    assert_eq!(writer.read_from("session", 0).unwrap().len(), 2);
    assert_eq!(
        load_session_inbox_item(&path, "session", mismatch.id)
            .unwrap()
            .status,
        InboxStatus::Pending
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn person_input_becomes_review_intent_only_as_it_reaches_the_model() {
    use crate::sessions::ReviewIntent::{Accepted, NeverRecorded};
    let path = temp_store_path("person_intent");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session");
    let intent = || crate::sessions::load_permission_review_intent(&path, "session").unwrap();
    let user = |content: &str| Message::User {
        content: content.to_string(),
    };
    let messages =
        |texts: &[&str]| Accepted(texts.iter().map(|text| (*text).to_string()).collect());
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let settle_runs = || {
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "DELETE FROM session_run_recovery WHERE session_id = 'session'",
                [],
            )
            .unwrap();
    };

    // Automation never becomes intent.
    writer
        .append_run_prompt("session", 0, &user("goal continuation"), "run-0")
        .unwrap();
    assert_eq!(intent(), NeverRecorded);
    settle_runs();

    // A person's prompt counts as typed, before expansion.
    writer
        .append_person_run_prompt("session", 1, &user("expanded /fix"), "run-a", "/fix tests")
        .unwrap();
    assert_eq!(intent(), messages(&["/fix tests"]));

    // A person's steer counts when it is delivered, not before.
    let steer = create_person_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Steer,
        "do not push",
        Some("run-a"),
        None,
        "do not push",
    )
    .unwrap();
    create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Steer,
        "retry the blocked action",
        Some("run-a"),
        None,
    )
    .unwrap();
    assert_eq!(intent(), messages(&["/fix tests"]));
    let delivered = writer
        .append_pending_inbox_steers("session", "run-a", 2)
        .unwrap();
    assert_eq!(delivered.len(), 2);
    assert_eq!(delivered[0].id, steer.id);
    assert_eq!(intent(), messages(&["/fix tests", "do not push"]));

    // So does a person's steering through the orchestrator queue.
    let steering = queue_person_thread_steering(
        &path,
        "session",
        ORCHESTRATOR_STEERING_TARGET,
        "run-a",
        "keep it short",
    )
    .unwrap();
    queue_thread_steering(
        &path,
        "session",
        ORCHESTRATOR_STEERING_TARGET,
        "run-a",
        "child report",
    )
    .unwrap();
    let claimed = claim_thread_steering(&path, "session", "run-a").unwrap();
    assert_eq!(claimed.len(), 2);
    assert_eq!(claimed[0].id, steering.id);
    writer
        .append_claimed_thread_steering(
            "session",
            "run-a",
            &claimed.iter().map(|record| record.id).collect::<Vec<_>>(),
            4,
            &[user("keep it short"), user("child report")],
        )
        .unwrap();
    assert_eq!(
        intent(),
        messages(&["/fix tests", "do not push", "keep it short"])
    );

    // A queued item counts once it starts a run; until then, and if it is
    // cancelled, it changes nothing. A new run does not lift what came
    // before.
    let cancelled = create_person_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "publish the release",
        None,
        None,
        "publish the release",
    )
    .unwrap();
    cancel_pending_session_inbox_item(&path, "session", cancelled.id, cancelled.version).unwrap();
    let queued = create_person_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "now update the docs",
        None,
        None,
        "now update the docs",
    )
    .unwrap();
    assert_eq!(
        intent(),
        messages(&["/fix tests", "do not push", "keep it short"])
    );
    settle_runs();
    writer
        .append_inbox_run_prompt(
            "session",
            6,
            &user("now update the docs"),
            "run-b",
            queued.id,
        )
        .unwrap();
    assert_eq!(
        intent(),
        messages(&[
            "/fix tests",
            "do not push",
            "keep it short",
            "now update the docs"
        ])
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_gap_repair_keeps_the_trusted_prefix_and_refreshes_summary() {
    let path = temp_store_path("gap_repair");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    crate::store::insert_test_session(&path, "session-b");
    set_snapshot_messages(
        &path,
        "session-a",
        &[
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "blob prompt".to_string(),
            },
        ],
    );
    for (idx, content) in [
        (0, "covered"),
        (2, "trusted tail"),
        (4, "first orphan"),
        (5, "later orphan"),
    ] {
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &encode_transcript_log_entry(
                idx,
                &Message::User {
                    content: content.to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
    }
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append(
            "session-b",
            0,
            &Message::User {
                content: "other session".to_string(),
            },
        )
        .unwrap();

    let (tail, recovery) = writer.read_tail_repairing_gap("session-a", 2).unwrap();
    assert_eq!(tail.len(), 1);
    assert_eq!(tail[0].0, 2);
    let recovery = recovery.expect("the gap must be repaired");
    assert_eq!(recovery.expected_idx, 3);
    assert_eq!(recovery.found_idx, 4);
    assert_eq!(recovery.discarded_rows, 2);
    let remaining = writer.read_from("session-a", 0).unwrap();
    assert_eq!(
        remaining.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(),
        vec![0, 2]
    );
    assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 1);
    let summary = crate::sessions::list_sessions(&path)
        .unwrap()
        .into_iter()
        .find(|summary| summary.session_id == "session-a")
        .unwrap();
    assert_eq!(summary.visible_message_count, 2);
    assert_eq!(summary.last_user_prompt.as_deref(), Some("trusted tail"));
    let (_, clean_recovery) = writer.read_tail_repairing_gap("session-a", 2).unwrap();
    assert!(clean_recovery.is_none());

    crate::store::append_thread_event(
        &path,
        "session-a",
        ORCHESTRATOR_STEERING_TARGET,
        &encode_transcript_log_entry(
            4,
            &Message::User {
                content: "new orphan".to_string(),
            },
        )
        .unwrap(),
    )
    .unwrap();
    crate::store::append_thread_event(
        &path,
        "session-a",
        ORCHESTRATOR_STEERING_TARGET,
        "{\"type\":\"run_started\"}",
    )
    .unwrap();
    assert!(writer.read_tail_repairing_gap("session-a", 2).is_err());
    let connection = open_connection(&path).unwrap();
    let row_count: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM thread_events
                 WHERE session_id = 'session-a' AND thread_name = ?1",
            params![ORCHESTRATOR_STEERING_TARGET],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(row_count, 4, "decode failure must roll back the repair");

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_delete_from_truncates_tail_and_isolates_sessions() {
    let path = temp_store_path("delete_from");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    crate::store::insert_test_session(&path, "session-b");

    let writer = TranscriptLogWriter::new(&path).unwrap();
    for (idx, message) in sample_messages().iter().enumerate() {
        writer.append("session-a", idx as u64, message).unwrap();
        writer.append("session-b", idx as u64, message).unwrap();
    }

    assert_eq!(writer.delete_from("session-a", 2).unwrap(), 2);
    let remaining = writer.read_from("session-a", 0).unwrap();
    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining[0].0, 0);
    assert_eq!(remaining[1].0, 1);
    let summary = crate::sessions::list_sessions(&path)
        .unwrap()
        .into_iter()
        .find(|summary| summary.session_id == "session-a")
        .unwrap();
    assert_eq!(summary.visible_message_count, 1);
    assert_eq!(summary.last_user_prompt.as_deref(), Some("prompt"));

    // Beyond-the-end truncation is a no-op; other sessions are untouched.
    assert_eq!(writer.delete_from("session-a", 99).unwrap(), 0);
    assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 4);

    assert_eq!(writer.delete_from("session-a", 0).unwrap(), 2);
    assert!(writer.read_from("session-a", 0).unwrap().is_empty());
    let summary = crate::sessions::list_sessions(&path)
        .unwrap()
        .into_iter()
        .find(|summary| summary.session_id == "session-a")
        .unwrap();
    assert_eq!(summary.visible_message_count, 0);
    assert_eq!(summary.last_user_prompt, None);

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_summary_refresh_ignores_blob_covered_rows() {
    let path = temp_store_path("summary_covered_rows");
    initialize(&path).unwrap();
    let snapshot = crate::sessions::new_snapshot(
        "session-a".to_string(),
        PathBuf::from("/tmp/project"),
        "test-model".to_string(),
        "https://example.invalid".to_string(),
        crate::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        std::collections::BTreeMap::new(),
    );
    crate::sessions::create_session(&path, &snapshot).unwrap();

    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_batch(
            "session-a",
            0,
            &[
                Message::User {
                    content: "stale covered prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("stale covered answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            ],
        )
        .unwrap();

    let mut snapshot = crate::sessions::load_session(&path, "session-a").unwrap();
    snapshot.messages = vec![
        Message::User {
            content: "blob replacement prompt".to_string(),
        },
        Message::Assistant {
            content: Some("blob replacement answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
    ];
    crate::sessions::save_session(&path, &snapshot).unwrap();

    writer
        .append_batch(
            "session-a",
            2,
            &[
                Message::User {
                    content: "live prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("live answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
            ],
        )
        .unwrap();

    assert_eq!(writer.delete_from("session-a", 3).unwrap(), 1);
    let summary = crate::sessions::list_sessions(&path).unwrap().remove(0);
    assert_eq!(summary.visible_message_count, 3);
    assert_eq!(summary.last_user_prompt.as_deref(), Some("live prompt"));

    assert_eq!(writer.delete_from("session-a", 2).unwrap(), 1);
    let summary = crate::sessions::list_sessions(&path).unwrap().remove(0);
    assert_eq!(summary.visible_message_count, 2);
    assert_eq!(
        summary.last_user_prompt.as_deref(),
        Some("blob replacement prompt")
    );

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_read_tail_window_pages_backwards_from_the_extent() {
    let path = temp_store_path("tail_window");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");

    let writer = TranscriptLogWriter::new(&path).unwrap();
    let messages = sample_messages();
    // Simulate a blob-covered prefix (idx 0-1) and a live tail (idx 2-3):
    // the window reads are relative to blob_len = 2.
    for (idx, message) in messages.iter().enumerate() {
        writer.append("session-a", idx as u64, message).unwrap();
    }

    // Extent probe: a zero-limit window still reports the tail length.
    let (tail_len, rows) = writer.read_tail_window("session-a", 2, 0, 0).unwrap();
    assert_eq!(tail_len, 2);
    assert!(rows.is_empty());

    // Full tail == read_from for the same range.
    let full = writer.read_tail_from("session-a", 2).unwrap();
    let reference = writer.read_from("session-a", 2).unwrap();
    assert_eq!(full.len(), reference.len());
    for ((idx, message), (ref_idx, ref_message)) in full.iter().zip(reference.iter()) {
        assert_eq!(idx, ref_idx);
        assert_eq!(canonical(message), canonical(ref_message));
    }
    assert_eq!(full.len(), 2);
    assert_eq!(full[0].0, 2);

    // One-row windows walk the tail backwards without overlap.
    let (_, last) = writer.read_tail_window("session-a", 2, 1, 1).unwrap();
    assert_eq!(last.len(), 1);
    assert_eq!(last[0].0, 3);
    assert_eq!(canonical(&last[0].1), canonical(&messages[3]));
    let (_, first) = writer.read_tail_window("session-a", 2, 0, 1).unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].0, 2);
    assert_eq!(canonical(&first[0].1), canonical(&messages[2]));

    // Windows clamp at both ends; a blob that covers the log has no tail.
    let (tail_len, clamped) = writer
        .read_tail_window("session-a", 2, 1, usize::MAX)
        .unwrap();
    assert_eq!(tail_len, 2);
    assert_eq!(clamped.len(), 1);
    assert!(writer
        .read_tail_window("session-a", 2, 2, 4)
        .unwrap()
        .1
        .is_empty());
    assert_eq!(writer.read_tail_window("session-a", 4, 0, 4).unwrap().0, 0);
    assert_eq!(writer.read_tail_window("session-a", 99, 0, 4).unwrap().0, 0);
    assert_eq!(writer.read_tail_window("session-b", 0, 0, 4).unwrap().0, 0);

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_read_tail_window_fails_loudly_on_gaps_and_foreign_rows() {
    let path = temp_store_path("tail_window_gaps");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");

    let writer = TranscriptLogWriter::new(&path).unwrap();
    for (idx, message) in sample_messages().iter().take(2).enumerate() {
        writer.append("session-a", idx as u64, message).unwrap();
    }
    // A hand-inserted row that skips idx 2: the tail [1, 3] is not
    // contiguous and must fail the window read loudly.
    crate::store::append_thread_event(
        &path,
        "session-a",
        ORCHESTRATOR_STEERING_TARGET,
        &encode_transcript_log_entry(
            3,
            &Message::User {
                content: "gap".to_string(),
            },
        )
        .unwrap(),
    )
    .unwrap();
    assert!(writer
        .read_tail_window("session-a", 1, 0, usize::MAX)
        .is_err());
    // The extent probe decodes only the last row, so a zero-limit window
    // still succeeds; the gap surfaces only when the window covers it.
    assert_eq!(writer.read_tail_window("session-a", 1, 0, 0).unwrap().0, 3);

    // A foreign row under the reserved name fails even the extent probe.
    crate::store::append_thread_event(
        &path,
        "session-a",
        ORCHESTRATOR_STEERING_TARGET,
        "{\"type\":\"run_started\",\"prompt_preview\":\"run started\"}",
    )
    .unwrap();
    assert!(writer.read_tail_window("session-a", 1, 0, 0).is_err());

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

fn window_reader_with_peer_append(path: &Path) -> TranscriptLogWriter {
    initialize(path).unwrap();
    crate::store::insert_test_session(path, "session-a");
    let writer = TranscriptLogWriter::new(path).unwrap();
    writer
        .append_batch("session-a", 0, &sample_messages()[..2])
        .unwrap();
    open_runtime_connection(path).unwrap().execute(
        "UPDATE thread_events SET created_at = CAST(json_extract(event_json, '$.nac_transcript_message.idx') AS TEXT)", [],
    ).unwrap();
    let peer_path = path.to_path_buf();
    *writer.after_extent_read.lock().unwrap() = Some(Box::new(move || {
        // A separate writer commits after the extent SELECT completes and
        // before the DESC/OFFSET page SELECT starts. No scheduling sleeps.
        TranscriptLogWriter::new(&peer_path)
            .unwrap()
            .append(
                "session-a",
                2,
                &Message::User {
                    content: "peer append".into(),
                },
            )
            .unwrap();
    }));
    writer
}

#[test]
fn transcript_log_window_uses_one_snapshot_during_peer_append() {
    let path = temp_store_path("window_snapshot");
    let writer = window_reader_with_peer_append(&path);
    let (extent, rows) = writer.read_tail_window("session-a", 0, 0, 2).unwrap();
    assert_eq!(extent, 2);
    assert_eq!(
        rows.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(),
        vec![0, 1]
    );
    assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 3);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_window_times_use_one_snapshot_during_peer_append() {
    let path = temp_store_path("window_times_snapshot");
    let writer = window_reader_with_peer_append(&path);
    let times = writer.read_tail_window_times("session-a", 0, 0, 2).unwrap();
    assert_eq!(times, vec!["0", "1"]);
    assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 3);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_reads_fail_loudly_on_foreign_rows() {
    let path = temp_store_path("foreign_rows");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");

    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append(
            "session-a",
            0,
            &Message::User {
                content: "prompt".to_string(),
            },
        )
        .unwrap();
    // A non-transcript row under the reserved name is corruption.
    crate::store::append_thread_event(
        &path,
        "session-a",
        ORCHESTRATOR_STEERING_TARGET,
        "{\"type\":\"run_started\",\"prompt_preview\":\"run started\"}",
    )
    .unwrap();

    assert!(writer.read_from("session-a", 0).is_err());
    assert!(writer.delete_from("session-a", 1).is_err());

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn transcript_log_writer_is_send_sync_for_spawn_blocking() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<TranscriptLogWriter>();
}

#[test]
fn transcript_log_summary_stats_match_the_blob_visibility_predicate() {
    let path = temp_store_path("summary_stats");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    crate::store::insert_test_session(&path, "session-b");
    set_snapshot_messages(
        &path,
        "session-a",
        &[Message::System {
            content: "covered system".to_string(),
        }],
    );

    let tool_call = crate::types::ToolCall {
        id: "call-1".to_string(),
        call_type: "function".to_string(),
        function: crate::types::FunctionCall {
            name: "read".to_string(),
            arguments: "{\"path\":\"x\"}".to_string(),
        },
    };
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_batch(
            "session-a",
            1,
            &[
                Message::User {
                    content: "first prompt".to_string(),
                },
                Message::Assistant {
                    content: Some("visible answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
                // Assistant with tool calls: not visible even with content.
                Message::Assistant {
                    content: Some("working".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: Some(vec![tool_call.clone()]),
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
                Message::Tool {
                    tool_call_id: "call-1".to_string(),
                    content: ("tool output".to_string()).into(),
                },
                // Assistant without content: not visible.
                Message::Assistant {
                    content: None,
                    reasoning_text: Some("reasoning only".to_string()),
                    reasoning_details: None,
                    tool_calls: None,
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
                // Assistant with an empty tool-call list: visible.
                Message::Assistant {
                    content: Some("another answer".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: Some(Vec::new()),
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
                Message::User {
                    content: "latest prompt".to_string(),
                },
            ],
        )
        .unwrap();
    // A foreign (valid JSON, non-transcript) row under the reserved name
    // extracts a NULL kind and is ignored by both stats.
    crate::store::append_thread_event(
        &path,
        "session-a",
        ORCHESTRATOR_STEERING_TARGET,
        "{\"type\":\"run_started\",\"prompt_preview\":\"run started\"}",
    )
    .unwrap();

    let conn = open_connection(&path).unwrap();
    assert_eq!(
        count_visible_transcript_log_messages(&conn, "session-a", 1).unwrap(),
        4,
        "user rows plus content-bearing, tool-call-free assistant rows"
    );
    assert_eq!(
        last_transcript_log_user_prompt(&conn, "session-a", 1)
            .unwrap()
            .as_deref(),
        Some("latest prompt")
    );

    // A session with no log rows gets the empty stats (the caller falls
    // back to the blob's last user prompt).
    assert_eq!(
        count_visible_transcript_log_messages(&conn, "session-b", 0).unwrap(),
        0
    );
    assert_eq!(
        last_transcript_log_user_prompt(&conn, "session-b", 0).unwrap(),
        None
    );

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn all_106_expected_three_found_four_is_rejected_atomically() {
    let path = temp_store_path("all_106_gap");
    initialize(&path).unwrap();
    crate::store::insert_test_session(&path, "session-a");
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let seed = vec![
        Message::User {
            content: "seed".into()
        };
        3
    ];
    writer.append_batch("session-a", 0, &seed).unwrap();
    let error = writer
        .append(
            "session-a",
            4,
            &Message::User {
                content: "gap".into(),
            },
        )
        .unwrap_err();
    assert!(
        error.to_string().contains("expected start idx 3, found 4"),
        "{error:#}"
    );
    assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 3);
}
