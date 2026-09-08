use super::*;

fn test_event(sequence_id: u64, message: &str) -> SessionEventEnvelope {
    SessionEventEnvelope {
        session_id: Some("session-1".to_string()),
        epoch_id: "test-epoch".to_string(),
        sequence_id,
        client_id: None,
        run_id: None,
        event: nac_core::events::SessionEvent::RunFailed {
            message: message.to_string(),
        },
    }
}

#[test]
fn presentation_requests_require_the_complete_contract() {
    let update: UpdateSessionPresentationRequest =
        serde_json::from_str(r#"{"title":"  Build release  ","pinned":true,"expected_version":3}"#)
            .unwrap();
    assert_eq!(update.title, "  Build release  ");
    assert!(update.pinned);
    assert_eq!(update.expected_version, 3);
    assert!(serde_json::from_str::<UpdateSessionPresentationRequest>(
        r#"{"pinned":true,"expected_version":3}"#
    )
    .is_err());

    let reorder: ReorderSessionsRequest = serde_json::from_str(
        r#"{"pinned":false,"session_ids":["b","a"],"expected_versions":{"a":2,"b":4}}"#,
    )
    .unwrap();
    assert_eq!(reorder.session_ids, ["b", "a"]);
    assert_eq!(reorder.expected_versions["a"], 2);
}

#[test]
fn presentation_errors_map_to_exact_statuses() {
    use sessions::SessionPresentationError;

    let cases = [
        (
            SessionPresentationError::InvalidInput("invalid".to_string()),
            StatusCode::BAD_REQUEST,
        ),
        (
            SessionPresentationError::NotFound("missing".to_string()),
            StatusCode::NOT_FOUND,
        ),
        (
            SessionPresentationError::Conflict("stale".to_string()),
            StatusCode::CONFLICT,
        ),
        (
            SessionPresentationError::Busy("locked".to_string()),
            StatusCode::CONFLICT,
        ),
        (
            SessionPresentationError::Store(anyhow::anyhow!("disk failed")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ];

    for (error, expected_status) in cases {
        let error = ApiError::from(error);
        assert_eq!(error.status, expected_status);
    }
}

#[tokio::test]
async fn presentation_handlers_preserve_error_shape_and_status() {
    let root = temp_root("presentation_status");
    seed_session(&root, "known", "2026-01-01 00:00:00.000000000");
    let manager = test_manager(&root);

    let invalid = delivery::sessions::update_presentation_handler(
        State(manager.clone()),
        AxumPath("known".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "bad\ttitle".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(invalid.status, StatusCode::BAD_REQUEST);

    let missing = delivery::sessions::update_presentation_handler(
        State(manager.clone()),
        AxumPath("missing".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "title".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(missing.status, StatusCode::NOT_FOUND);

    let _ = delivery::sessions::update_presentation_handler(
        State(manager.clone()),
        AxumPath("known".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "title".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap();
    let stale = delivery::sessions::update_presentation_handler(
        State(manager.clone()),
        AxumPath("known".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "new title".to_string(),
            pinned: false,
            expected_version: 0,
        })),
    )
    .await
    .unwrap_err();
    let response = stale.into_response();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body.as_object().unwrap().len(), 1);
    assert!(body["error"].as_str().unwrap().contains("version changed"));

    let malformed_reorder = delivery::sessions::reorder_handler(
        State(manager.clone()),
        Ok(Json(ReorderSessionsRequest {
            pinned: false,
            session_ids: vec!["known".to_string()],
            expected_versions: BTreeMap::new(),
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(malformed_reorder.status, StatusCode::BAD_REQUEST);

    let membership_conflict = delivery::sessions::reorder_handler(
        State(manager),
        Ok(Json(ReorderSessionsRequest {
            pinned: false,
            session_ids: Vec::new(),
            expected_versions: BTreeMap::new(),
        })),
    )
    .await
    .unwrap_err();
    assert_eq!(membership_conflict.status, StatusCode::CONFLICT);

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn presentation_routes_serialize_summaries_and_drive_list_order() {
    let root = temp_root("presentation_order");
    seed_session(&root, "a", "2026-01-01 00:00:00.000000000");
    seed_session(&root, "b", "2026-01-02 00:00:00.000000000");
    seed_session(&root, "c", "2026-01-03 00:00:00.000000000");
    let manager = test_manager(&root);

    let Json(a) = delivery::sessions::update_presentation_handler(
        State(manager.clone()),
        AxumPath("a".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: "  Alpha  ".to_string(),
            pinned: true,
            expected_version: 0,
        })),
    )
    .await
    .unwrap();
    assert_eq!(a.title.as_deref(), Some("Alpha"));
    assert!(a.pinned);
    assert_eq!(a.presentation_version, 1);
    let serialized = serde_json::to_value(&a).unwrap();
    assert_eq!(serialized["title"], "Alpha");
    assert_eq!(serialized["pinned"], true);
    assert_eq!(serialized["sort_order"], 0);
    assert_eq!(serialized["presentation_version"], 1);

    let _ = delivery::sessions::update_presentation_handler(
        State(manager.clone()),
        AxumPath("b".to_string()),
        Ok(Json(UpdateSessionPresentationRequest {
            title: String::new(),
            pinned: true,
            expected_version: 0,
        })),
    )
    .await
    .unwrap();

    let Json(reordered) = delivery::sessions::reorder_handler(
        State(manager.clone()),
        Ok(Json(ReorderSessionsRequest {
            pinned: true,
            session_ids: vec!["b".to_string(), "a".to_string()],
            expected_versions: BTreeMap::from([("a".to_string(), 1), ("b".to_string(), 1)]),
        })),
    )
    .await
    .unwrap();
    assert!(reordered.pinned);
    assert_eq!(
        reordered
            .sessions
            .iter()
            .map(|summary| summary.session_id.as_str())
            .collect::<Vec<_>>(),
        ["b", "a"]
    );
    assert_eq!(reordered.sessions[0].sort_order, 0);
    assert_eq!(reordered.sessions[1].sort_order, 1);
    assert!(reordered
        .sessions
        .iter()
        .all(|summary| summary.presentation_version == 2));

    let listed = manager.session_catalog().list(false).await.unwrap();
    assert_eq!(
        listed
            .iter()
            .map(|entry| entry.summary.session_id.as_str())
            .collect::<Vec<_>>(),
        ["b", "a", "c"]
    );
    assert!(listed.iter().all(|entry| !entry.active));

    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn session_snapshot_recovers_non_contiguous_transcript_tail() {
    let _lock = SERVER_MODEL_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let root = temp_root("transcript_gap_recovery");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
    let transcript = vec![
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "first prompt".to_string(),
        },
        Message::Assistant {
            content: Some("first answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "second prompt".to_string(),
        },
        Message::Assistant {
            content: Some("second answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "third prompt".to_string(),
        },
        Message::Assistant {
            content: Some("third answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
    ];
    seed_session_with_messages(
        &root,
        "target",
        "2026-01-02 00:00:00.000000000",
        transcript.clone(),
    );
    let orphan = Message::User {
        content: "must not be exposed".to_string(),
    };
    nac_core::test_support::store::append_thread_event(
        &root.join("store.db"),
        "target",
        nac_core::test_support::store::ORCHESTRATOR_STEERING_TARGET,
        &nac_core::test_support::store::encode_transcript_log_entry(8, &orphan).unwrap(),
    )
    .unwrap();
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("target");
    let lifecycle = gate.lock().await;
    let operation_lease =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "target").unwrap();
    manager
        .attach_current_operation_service_locked("target", &operation_lease)
        .await
        .expect("cold prompt attach must reuse its existing operation lease");
    drop(lifecycle);
    drop(operation_lease);
    let app = router(manager);

    let response = get_response(app, "/sessions/target", None).await;
    let status = response.status();
    let body = response_body(response).await;
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    let snapshot: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 7);
    let warning = snapshot["transcript_recovery_warning"].as_str().unwrap();
    assert!(warning.contains("index 7"), "{warning}");
    assert!(
        warning.contains("1 untrusted transcript log row"),
        "{warning}"
    );
    assert!(!warning.contains("must not be exposed"), "{warning}");
    let summary = snapshot["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|summary| summary["session_id"] == "target")
        .unwrap();
    assert_eq!(summary["visible_message_count"], 6);
    assert_eq!(summary["last_user_prompt"], "third prompt");
    assert!(TranscriptLogWriter::new(&root.join("store.db"))
        .unwrap()
        .read_from("target", 7)
        .unwrap()
        .is_empty());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn snapshot_projection_preserves_defaults_and_all_non_session_fields() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("snapshot_projection");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
    let transcript = test_transcript();
    seed_session_with_messages(
        &root,
        "target",
        "2026-01-02 00:00:00.000000000",
        transcript.clone(),
    );
    seed_session(&root, "other", "2026-01-01 00:00:00.000000000");
    let app = router(test_manager(&root));
    let query = "message_limit=2&thread_event_limit=24";

    let default_response =
        get_response(app.clone(), &format!("/sessions/target?{query}"), None).await;
    let default_status = default_response.status();
    let default_body = response_body(default_response).await;
    assert_eq!(
        default_status,
        StatusCode::OK,
        "{}",
        String::from_utf8_lossy(&default_body)
    );
    let default: serde_json::Value = serde_json::from_slice(&default_body).unwrap();

    let true_response = get_response(
        app.clone(),
        &format!("/sessions/target?{query}&include_sessions=true"),
        None,
    )
    .await;
    assert_eq!(true_response.status(), StatusCode::OK);
    let included: serde_json::Value =
        serde_json::from_slice(&response_body(true_response).await).unwrap();
    assert_eq!(included, default);
    assert_eq!(default["sessions"].as_array().unwrap().len(), 2);

    let false_response = get_response(
        app,
        &format!("/sessions/target?{query}&include_sessions=false"),
        None,
    )
    .await;
    assert_eq!(false_response.status(), StatusCode::OK);
    let projected: serde_json::Value =
        serde_json::from_slice(&response_body(false_response).await).unwrap();
    assert_eq!(projected["sessions"], serde_json::json!([]));
    let mut expected_projected = default.clone();
    expected_projected["sessions"] = serde_json::json!([]);
    assert_eq!(projected, expected_projected);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn paged_routes_preserve_raw_indexes_timestamps_and_projection_caps() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("paged_route_contract");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-route-test-key"));
    let mut transcript = test_transcript();
    transcript.insert(
        6,
        Message::Tool {
            tool_call_id: "call-thread".to_string(),
            content: "thread result".into(),
        },
    );
    seed_session_with_messages(&root, "target", "2026-01-02 00:00:00.000000000", transcript);
    TranscriptLogWriter::new(&root.join("store.db"))
        .unwrap()
        .append(
            "target",
            9,
            &Message::User {
                content: "logged tail".to_string(),
            },
        )
        .unwrap();
    let app = router(test_manager(&root));

    let response = get_response(
        app.clone(),
        "/sessions/target/messages?before=10&limit=4&include_system=true",
        None,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let page: serde_json::Value = serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(
        page["page"],
        serde_json::json!({
            "start": 6,
            "end": 10,
            "total": 10,
            "has_older": true,
        })
    );
    assert_eq!(
        page["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|message| message["role"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["tool", "system", "assistant", "user"]
    );
    let created_at = page["created_at"].as_array().unwrap();
    assert_eq!(created_at.len(), 4);
    assert!(created_at[..3].iter().all(serde_json::Value::is_null));
    assert!(created_at[3].is_string());
    assert_eq!(page["messages"][3]["content"], "logged tail");

    let response = get_response(
            app,
            "/sessions/target?message_limit=3&thread_event_limit=1&include_sessions=false&include_system=true",
            None,
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    let snapshot: serde_json::Value =
        serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(snapshot["messages"].as_array().unwrap().len(), 3);
    assert_eq!(snapshot["message_created_at"].as_array().unwrap().len(), 3);
    assert_eq!(
        snapshot["message_page"],
        serde_json::json!({
            "start": 7,
            "end": 10,
            "total": 10,
            "has_older": true,
        })
    );
    let message_created_at = snapshot["message_created_at"].as_array().unwrap();
    assert!(message_created_at[..2]
        .iter()
        .all(serde_json::Value::is_null));
    assert!(message_created_at[2].is_string());
    assert_eq!(snapshot["sessions"], serde_json::json!([]));
    assert!(snapshot["thread_events"]
        .as_object()
        .unwrap()
        .values()
        .all(|events| events.as_array().unwrap().len() <= 1));

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn paged_message_queries_exclude_system_prompts_by_default() {
    let Query(snapshot_query) = Query::<SessionSnapshotQuery>::try_from_uri(
        &"/sessions/test?message_limit=2".parse().unwrap(),
    )
    .unwrap();
    let Query(messages_query) = Query::<MessagesQuery>::try_from_uri(
        &"/sessions/test/messages?before=3&limit=2".parse().unwrap(),
    )
    .unwrap();
    assert!(!snapshot_query.include_system);
    assert!(!messages_query.include_system);
}

#[test]
fn paged_message_queries_include_system_prompts_when_requested() {
    let Query(snapshot_query) = Query::<SessionSnapshotQuery>::try_from_uri(
        &"/sessions/test?message_limit=3&include_system=true"
            .parse()
            .unwrap(),
    )
    .unwrap();
    let Query(messages_query) = Query::<MessagesQuery>::try_from_uri(
        &"/sessions/test/messages?before=3&limit=3&include_system=true"
            .parse()
            .unwrap(),
    )
    .unwrap();
    assert!(snapshot_query.include_system);
    assert!(messages_query.include_system);
}

#[tokio::test]
async fn sse_route_is_never_compressed_and_preserves_boundary_ordering() {
    async fn finite_sse_route(
    ) -> Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>> {
        let replayed = vec![test_event(4, "replayed-4"), test_event(5, "replayed-5")];
        let live = test_event(6, "live-6");
        let (sender, receiver) = tokio::sync::broadcast::channel(4);
        sender.send(live).unwrap();
        drop(sender);
        let (delta_sender, assistant_deltas) = tokio::sync::broadcast::channel(4);
        drop(delta_sender);

        Sse::new(delivery::session_runs::session_event_stream(
            "test-epoch".to_string(),
            5,
            Some(SessionReplayGap {
                missing_from_sequence_id: 2,
                missing_to_sequence_id: 3,
            }),
            replayed,
            receiver,
            assistant_deltas,
        ))
    }

    let app = Router::new()
        .route("/events", get(finite_sse_route))
        .layer(response_compression_layer());
    let response = get_response(app, "/events", Some("gzip")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers().get(header::CONTENT_TYPE),
        Some(&header::HeaderValue::from_static("text/event-stream"))
    );
    assert!(response.headers().get(header::CONTENT_ENCODING).is_none());
    let body = response_body(response).await;
    let body = String::from_utf8(body.to_vec()).unwrap();

    let boundary = body.find("event: replay_boundary").unwrap();
    let gap = body.find("event: replay_gap").unwrap();
    let replay_4 = body.find("\"sequence_id\":4").unwrap();
    let replay_5 = body.find("\"sequence_id\":5").unwrap();
    let live_6 = body.find("\"sequence_id\":6").unwrap();
    assert!(boundary < gap && gap < replay_4 && replay_4 < replay_5 && replay_5 < live_6);
    assert!(body.contains("\"replay_boundary_sequence_id\":5"));
    assert!(body.contains("\"epoch_id\":\"test-epoch\""));

    let boundary_frame = body.split("\n\n").next().unwrap();
    assert!(!boundary_frame.lines().any(|line| line.starts_with("id:")));
}
