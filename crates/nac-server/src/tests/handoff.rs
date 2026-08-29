use super::*;

fn seed_agent_with_turn(root: &std::path::Path, session_id: &str) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        vec![
            Message::System {
                content: "direct policy".to_string(),
            },
            Message::User {
                content: "inspect the crate".to_string(),
            },
            Message::Assistant {
                content: Some("I read the files.".to_string()),
                reasoning_text: Some("secret thought".to_string()),
                reasoning_details: None,
                tool_calls: Some(vec![nac_core::types::ToolCall {
                    id: "call-1".to_string(),
                    call_type: "function".to_string(),
                    function: nac_core::types::FunctionCall {
                        name: "read".to_string(),
                        arguments: r#"{"path":"/hidden/src.rs"}"#.to_string(),
                    },
                }]),
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "secret tool output".into(),
            },
        ],
        Some("OPENAI_API_KEY".to_string()),
        std::collections::BTreeMap::new(),
    );
    snapshot.created_at = "2026-01-01 00:00:00.000000000".to_string();
    snapshot.updated_at = snapshot.created_at.clone();
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed agent turn");
}

#[tokio::test]
async fn continue_in_nac_projects_prose_without_tools() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("continue_in_nac");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("continue-in-nac-key"));
    seed_agent_with_turn(&root, "direct");
    let app = router(test_manager(&root));

    let created = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/continue")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"message_idx":2,"target_behavior":"orchestrator"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);
    let body = response_json(created).await;
    let target_id = body["session_id"].as_str().expect("session_id");

    let target = sessions::load_session(&root.join("store.db"), target_id).unwrap();
    assert_eq!(target.behavior, sessions::SessionBehavior::Orchestrator);
    let encoded = serde_json::to_string(&target.messages).unwrap();
    assert!(!encoded.contains("/hidden/src.rs"));
    assert!(!encoded.contains("secret tool output"));
    assert!(!encoded.contains("secret thought"));
    let tail = nac_core::store::TranscriptLogWriter::new(&root.join("store.db"))
        .unwrap()
        .read_tail_from(target_id, 1)
        .unwrap();
    let tail_encoded = serde_json::to_string(&tail).unwrap();
    assert!(tail_encoded.contains("inspect the crate"));
    assert!(tail_encoded.contains("I read the files."));
    assert!(tail_encoded.contains("Wait for the user's next instruction"));
    assert!(!tail_encoded.contains("/hidden/src.rs"));
    assert!(!tail_encoded.contains("secret tool output"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn continue_rejects_same_type_target() {
    let root = temp_root("continue_same_type");
    seed_agent_with_turn(&root, "direct");
    let app = router(test_manager(&root));

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/continue")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"message_idx":2,"target_behavior":"direct"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_json(rejected).await["error"],
        "handoff target must be the other session type"
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn continue_hides_open_assignment_source() {
    let root = temp_root("continue_open_assignment");
    seed_direct_session(&root, "direct");
    let manager = test_manager(&root);
    let child_id = manager
        .create_traditional_child_session("direct", "general", "running source")
        .await
        .unwrap();
    let app = router(manager);

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/sessions/{child_id}/continue"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"message_idx":0,"target_behavior":"orchestrator"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn continue_conflicts_when_source_is_busy() {
    let root = temp_root("continue_busy");
    seed_agent_with_turn(&root, "direct");
    let _lease =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "direct").unwrap();
    let app = router(test_manager(&root));

    let rejected = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/sessions/direct/continue")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"message_idx":2,"target_behavior":"orchestrator"}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(rejected.status(), StatusCode::CONFLICT);
    let _ = std::fs::remove_dir_all(root);
}
