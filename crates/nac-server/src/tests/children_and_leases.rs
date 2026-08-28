use super::*;

#[tokio::test]
async fn traditional_child_http_api_runs_foreground_then_delivers_background_completion() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_http");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-test-key"));
    let (base_url, requests) = scripted_direct_responses(&[
        "foreground child done\n\n## Verification\nfocused test passed",
        "background child done",
        "parent received child completion",
    ]);
    seed_direct_session_with_base_url(&root, "direct", base_url);
    seed_editable_session(&root, "orchestrator");
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let foreground = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":"general","description":"inspect child flow","prompt":"inspect the flow","background":false}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(foreground.status(), StatusCode::CREATED);
    let foreground: TraditionalChildRecord =
        serde_json::from_slice(&response_body(foreground).await).unwrap();
    assert_eq!(
        foreground.status,
        nac_core::store::TraditionalChildStatus::Completed
    );
    assert_eq!(foreground.generation, 1);
    assert_eq!(
        foreground.report.as_deref(),
        Some("foreground child done\n\n## Verification\nfocused test passed")
    );
    assert_eq!(
        foreground.verification_summary.as_deref(),
        Some("focused test passed")
    );
    assert!(
        nac_core::store::list_session_inbox(&root.join("store.db"), "direct")
            .unwrap()
            .is_empty()
    );
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);

    let background = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(format!(
                        r#"{{"profile":"general","description":"inspect child flow","prompt":"continue with the second pass","child_session_id":"{}","background":true}}"#,
                        foreground.child_session_id
                    )))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(background.status(), StatusCode::CREATED);
    let background: TraditionalChildRecord =
        serde_json::from_slice(&response_body(background).await).unwrap();
    assert_eq!(background.child_session_id, foreground.child_session_id);
    assert_eq!(background.generation, 2);
    assert_eq!(
        background.status,
        nac_core::store::TraditionalChildStatus::Running
    );
    assert_eq!(
        background.execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 1);
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 2);
    })
    .await
    .unwrap();

    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let child = manager
                .delegation()
                .traditional_child("direct", &foreground.child_session_id)
                .unwrap();
            if child.status == nac_core::store::TraditionalChildStatus::Completed {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("background child should settle");
    let status = get_response(
        app.clone(),
        &format!("/sessions/direct/children/{}", foreground.child_session_id),
        None,
    )
    .await;
    assert_eq!(status.status(), StatusCode::OK);
    let completed: TraditionalChildRecord =
        serde_json::from_slice(&response_body(status).await).unwrap();
    assert_eq!(completed.generation, 2);
    assert_eq!(completed.report.as_deref(), Some("background child done"));
    assert!(completed.completion_inbox_id.is_some());
    let parent_inbox =
        nac_core::store::list_session_inbox(&root.join("store.db"), "direct").unwrap();
    assert_eq!(parent_inbox.len(), 1);
    assert_eq!(
        parent_inbox[0].status,
        nac_core::store::InboxStatus::Delivered
    );
    assert!(parent_inbox[0]
        .content
        .contains(&foreground.child_session_id));

    let child_snapshot =
        sessions::load_session(&root.join("store.db"), &foreground.child_session_id).unwrap();
    assert_eq!(child_snapshot.behavior, sessions::SessionBehavior::Direct);
    assert!(matches!(
        child_snapshot.messages.first(),
        Some(Message::System { content }) if content.contains("traditional child coding agent")
    ));
    let lineage_response = get_response(
        app.clone(),
        &format!(
            "/sessions/{}?include_sessions=false",
            foreground.child_session_id
        ),
        None,
    )
    .await;
    assert_eq!(lineage_response.status(), StatusCode::OK);
    let lineage_json = response_json(lineage_response).await;
    assert_eq!(lineage_json["lineage"]["kind"], "traditional-child");
    assert_eq!(lineage_json["lineage"]["parent_session_id"], "direct");
    assert_eq!(lineage_json["lineage"]["description"], "inspect child flow");

    let rejected = get_response(app, "/sessions/orchestrator/children", None).await;
    assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn traditional_child_cancel_endpoint_propagates_to_active_generation() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_cancel");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-cancel-key"));
    let (base_url, requests, release) = stalled_then_scripted_direct_response();
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let manager = test_manager(&root);
    let app = router(manager.clone());

    let start = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/sessions/direct/children")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        r#"{"profile":"general","description":"cancel active child","prompt":"wait for cancellation","background":true}"#,
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
    assert_eq!(start.status(), StatusCode::CREATED);
    let running: TraditionalChildRecord =
        serde_json::from_slice(&response_body(start).await).unwrap();
    assert_eq!(
        running.status,
        nac_core::store::TraditionalChildStatus::Running
    );
    let continued = nac_core::traditional_children::controller_for(&root.join("store.db"))
        .unwrap()
        .start(
            nac_core::traditional_children::TraditionalChildStartRequest {
                parent_session_id: "direct".to_string(),
                child_session_id: Some(running.child_session_id.clone()),
                profile: "general".to_string(),
                description: "cancel active child".to_string(),
                prompt: "additional foreground steering".to_string(),
                execution_mode: TraditionalChildExecutionMode::Foreground,
            },
        )
        .await
        .unwrap();
    assert_eq!(
        continued.execution_mode,
        Some(TraditionalChildExecutionMode::Background),
        "continuation must not rewrite the admitted generation mode"
    );
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();

    let cancel = tokio::time::timeout(
        Duration::from_secs(10),
        app.clone().oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/sessions/direct/children/{}/cancel",
                    running.child_session_id
                ))
                .body(Body::empty())
                .unwrap(),
        ),
    )
    .await
    .expect("cancel endpoint should not hang")
    .unwrap();
    assert_eq!(cancel.status(), StatusCode::OK);
    let cancelled: TraditionalChildRecord =
        serde_json::from_slice(&response_body(cancel).await).unwrap();
    assert_eq!(
        cancelled.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(cancelled.generation, 1);
    assert!(cancelled.completion_inbox_id.is_some());
    release.send(()).unwrap();

    let inbox = nac_core::store::list_session_inbox(&root.join("store.db"), "direct").unwrap();
    assert_eq!(inbox.len(), 1);
    assert!(inbox[0].content.contains("cancelled"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_attachment_reconciles_abandoned_background_child_exactly_once() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_restart");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-restart-key"));
    let (base_url, requests) =
        scripted_direct_responses(&["parent acknowledged interrupted child"]);
    seed_direct_session_with_base_url(&root, "direct", base_url);
    let store_path = root.join("store.db");

    let first_manager = test_manager(&root);
    let child_session_id = first_manager
        .create_traditional_child_session("direct", "general", "survive server restart")
        .await
        .unwrap();
    nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "abandoned-child-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &child_session_id,
            1,
            &Message::User {
                content: "work interrupted by restart".to_string(),
            },
            "abandoned-child-run",
        )
        .unwrap();
    drop(first_manager);

    let rebuilt = test_manager(&root);
    rebuilt.snapshot("direct").await.unwrap();
    tokio::task::spawn_blocking(move || {
        assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    })
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let child = nac_core::store::load_traditional_child(&store_path, &child_session_id)
                .unwrap()
                .unwrap();
            let inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
            if child.status == nac_core::store::TraditionalChildStatus::Interrupted
                && inbox
                    .first()
                    .is_some_and(|item| item.status == nac_core::store::InboxStatus::Delivered)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("restart reconciliation should interrupt the child and wake its parent");

    rebuilt.snapshot("direct").await.unwrap();
    let child = nac_core::store::load_traditional_child(&store_path, &child_session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        child.status,
        nac_core::store::TraditionalChildStatus::Interrupted
    );
    assert!(child
        .failure
        .as_deref()
        .is_some_and(|failure| { failure.contains("interrupted when the nac process stopped") }));
    let inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(child.completion_inbox_id, Some(inbox[0].id));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_repair_recovers_suppression_after_deletion_owner_disappears() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("completion_suppression_restart_repair");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("suppression-repair-key"));
    seed_direct_session(&root, "direct");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let store_path = root.join("store.db");
    let manager = test_manager(&root);

    let child_session_id = manager
        .create_traditional_child_session("direct", "general", "repair child delivery")
        .await
        .unwrap();
    nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let child =
        nac_core::store::suppress_traditional_child_completion(&store_path, &child_session_id)
            .unwrap();
    nac_core::store::settle_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run",
        nac_core::store::TraditionalChildTerminal {
            status: nac_core::store::TraditionalChildStatus::Cancelled,
            report: None,
            failure: Some("deletion interrupted".to_string()),
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap();
    assert!(nac_core::store::list_session_inbox(&store_path, "direct")
        .unwrap()
        .is_empty());
    let child_lease =
        sessions::SessionRelationshipLease::try_acquire(&store_path, &child_session_id).unwrap();
    manager
        .repair_orphaned_completion_suppressions("direct")
        .unwrap();
    assert!(nac_core::store::list_session_inbox(&store_path, "direct")
        .unwrap()
        .is_empty());
    let admission_error = nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run-2",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap_err();
    assert!(admission_error
        .to_string()
        .contains("completion delivery is suppressed"));
    drop(child_lease);
    manager
        .repair_orphaned_completion_suppressions("direct")
        .unwrap();
    manager
        .repair_orphaned_completion_suppressions("direct")
        .unwrap();
    let child_inbox = nac_core::store::list_session_inbox(&store_path, "direct").unwrap();
    assert_eq!(child_inbox.len(), 1);
    assert_eq!(
        nac_core::store::load_traditional_child(&store_path, &child_session_id)
            .unwrap()
            .unwrap()
            .completion_inbox_id,
        Some(child_inbox[0].id)
    );
    assert_eq!(child.generation, 1);
    let child_generation_two = nac_core::store::begin_traditional_child_run(
        &store_path,
        &child_session_id,
        "child-run-2",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    assert_eq!(child_generation_two.generation, 2);

    let orchestrator_session_id = manager
        .create_managed_orchestrator_session("delegating", "repair orchestrator delivery")
        .await
        .unwrap();
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::suppress_managed_orchestrator_completion(
        &store_path,
        &orchestrator_session_id,
    )
    .unwrap();
    nac_core::store::settle_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run",
        nac_core::store::ManagedOrchestratorTerminal {
            status: ManagedOrchestratorStatus::Cancelled,
            report: None,
            failure: Some("deletion interrupted".to_string()),
        },
    )
    .unwrap();
    let orchestrator_lease =
        sessions::SessionRelationshipLease::try_acquire(&store_path, &orchestrator_session_id)
            .unwrap();
    manager
        .repair_orphaned_completion_suppressions("delegating")
        .unwrap();
    assert!(
        nac_core::store::list_session_inbox(&store_path, "delegating")
            .unwrap()
            .is_empty()
    );
    let admission_error = nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run-2",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap_err();
    assert!(admission_error
        .to_string()
        .contains("completion delivery is suppressed"));
    drop(orchestrator_lease);
    manager
        .repair_orphaned_completion_suppressions("delegating")
        .unwrap();
    manager
        .repair_orphaned_completion_suppressions("delegating")
        .unwrap();
    assert_eq!(
        nac_core::store::list_session_inbox(&store_path, "delegating")
            .unwrap()
            .len(),
        1
    );
    let orchestrator_generation_two = nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator_session_id,
        "orchestrator-run-2",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    assert_eq!(orchestrator_generation_two.generation, 2);

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn deleting_parent_removes_its_traditional_child_sessions() {
    let _env_lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("traditional_child_delete");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("traditional-child-delete-key"));
    seed_direct_session(&root, "direct");
    let manager = test_manager(&root);
    let child_session_id = manager
        .create_traditional_child_session("direct", "general", "delete with parent")
        .await
        .unwrap();

    manager.delete_session("direct").await.unwrap();

    let store_path = root.join("store.db");
    assert!(sessions::load_session(&store_path, "direct").is_err());
    assert!(sessions::load_session(&store_path, &child_session_id).is_err());
    assert!(
        nac_core::store::load_traditional_child(&store_path, &child_session_id)
            .unwrap()
            .is_none()
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn wrong_parent_relationship_reads_are_opaque_not_found() {
    let root = temp_root("relationship_ownership_opaque");
    seed_direct_session(&root, "parent-a");
    seed_direct_session(&root, "parent-b");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating-a",
        "https://api.openai.com/v1".to_string(),
    );
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating-b",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let store_path = root.join("store.db");
    let child = manager
        .create_traditional_child_session("parent-a", "general", "owned child")
        .await
        .unwrap();
    let orchestrator = manager
        .create_managed_orchestrator_session("delegating-a", "owned orchestrator")
        .await
        .unwrap();

    let summaries = manager.session_catalog().list(false).await.unwrap();
    assert!(summaries
        .iter()
        .find(|entry| entry.summary.session_id == child)
        .and_then(|entry| entry.lineage.as_ref())
        .is_some_and(|lineage| lineage.kind == SessionLineageKind::TraditionalChild));
    assert!(summaries
        .iter()
        .find(|entry| entry.summary.session_id == orchestrator)
        .and_then(|entry| entry.lineage.as_ref())
        .is_some_and(|lineage| lineage.kind == SessionLineageKind::ManagedOrchestrator));

    let inbox_error = manager.list_direct_inbox(&child).await.unwrap_err();
    assert!(inbox_error
        .to_string()
        .contains("accept input only through their parent"));
    let run_error = manager
        .submit_prompt(
            &child,
            SubmitPromptRequest {
                prompt: "bypass parent ownership".to_string(),
            },
        )
        .await
        .unwrap_err();
    assert!(run_error
        .to_string()
        .contains("accept work only through their parent"));
    let managed_run_error = manager
        .submit_prompt(
            &orchestrator,
            SubmitPromptRequest {
                prompt: "bypass parent ownership".to_string(),
            },
        )
        .await
        .unwrap_err();
    assert!(managed_run_error
        .to_string()
        .contains("accept work only through their parent"));

    for delegated in [&child, &orchestrator] {
        let branch_error = manager
            .workspace()
            .switch_workspace_branch(
                delegated,
                application::workspace::SwitchBranch {
                    name: "delegated-mutation".to_string(),
                    create: true,
                },
            )
            .await
            .unwrap_err();
        assert!(branch_error
            .to_string()
            .contains("accept work only through their parent"));
        let commit_error = manager
            .workspace()
            .commit_workspace(
                delegated,
                application::workspace::CommitWorkspace {
                    message: "delegated mutation".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(commit_error
            .to_string()
            .contains("accept work only through their parent"));
        let before = manager.session_config(delegated).unwrap();
        let config_error = manager
            .update_session_config(
                delegated,
                serde_json::from_value(serde_json::json!({"model":"mutated-model"})).unwrap(),
            )
            .await
            .unwrap_err();
        assert!(config_error
            .to_string()
            .contains("accept work only through their parent"));
        assert_eq!(manager.session_config(delegated).unwrap(), before);

        let steering_error = manager
            .queue_orchestrator_steering(
                delegated,
                OrchestratorSteeringRequest {
                    instruction: "bypass parent steering".to_string(),
                },
            )
            .await
            .unwrap_err();
        assert!(steering_error
            .to_string()
            .contains("accept work only through their parent"));
        let cancellation_error = manager.cancel_active_run(delegated).await.unwrap_err();
        assert!(cancellation_error
            .to_string()
            .contains("accept work only through their parent"));
        assert_eq!(
            manager.revert_session(delegated, 0).await.unwrap_err(),
            RevertSessionError::NotFound
        );
        assert_eq!(
            manager
                .regenerate_session_run(delegated, 0)
                .await
                .unwrap_err(),
            RegenerateSessionError::NotFound
        );
        assert_eq!(
            manager.compact_session(delegated).await.unwrap_err(),
            CompactSessionError::NotFound
        );
        let delete_error = manager.delete_session(delegated).await.unwrap_err();
        assert!(delete_error
            .to_string()
            .contains("accept work only through their parent"));
        assert!(sessions::session_exists(&store_path, delegated).unwrap());
    }

    let app = router(manager.clone());
    for delegated in [&child, &orchestrator] {
        for (path, body) in [
            (
                "workspace/branches",
                r#"{"name":"delegated-mutation","create":true}"#,
            ),
            ("workspace/commit", r#"{"message":"delegated mutation"}"#),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/{path}"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::CONFLICT, "{path}");
        }
        let config = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PATCH")
                    .uri(format!("/sessions/{delegated}/config"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"model":"mutated-model"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(config.status(), StatusCode::CONFLICT);
        let steering = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/sessions/{delegated}/steering"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(r#"{"instruction":"bypass"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(steering.status(), StatusCode::CONFLICT);
        let cancel = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/sessions/{delegated}/cancel-active-run"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(cancel.status(), StatusCode::CONFLICT);
        let delete = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/sessions/{delegated}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(delete.status(), StatusCode::CONFLICT);
        assert!(sessions::session_exists(&store_path, delegated).unwrap());
        for action in ["revert", "regenerate"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(format!("/sessions/{delegated}/{action}"))
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(r#"{"message_idx":0}"#))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{action}");
        }
        let compact = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/sessions/{delegated}/compact"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(compact.status(), StatusCode::NOT_FOUND);
    }

    let child_error = ApiError::from(
        manager
            .delegation()
            .traditional_child("parent-b", &child)
            .unwrap_err(),
    );
    assert_eq!(child_error.status, StatusCode::NOT_FOUND);
    assert_eq!(child_error.message, "traditional child was not found");
    assert!(!child_error.message.contains(&child));
    let child_cancel_error = ApiError::from(
        manager
            .delegation()
            .cancel_traditional_child("parent-b", &child)
            .await
            .unwrap_err(),
    );
    assert_eq!(child_cancel_error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        child_cancel_error.message,
        "traditional child was not found"
    );
    assert!(!child_cancel_error.message.contains(&child));
    let continuation_error = nac_core::traditional_children::controller_for(&root.join("store.db"))
        .unwrap()
        .start(
            nac_core::traditional_children::TraditionalChildStartRequest {
                parent_session_id: "parent-b".to_string(),
                child_session_id: Some(child.clone()),
                profile: "general".to_string(),
                description: "owned child".to_string(),
                prompt: "must remain opaque".to_string(),
                execution_mode: TraditionalChildExecutionMode::Foreground,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(
        continuation_error.to_string(),
        "traditional child was not found"
    );

    let orchestrator_error = ApiError::from(
        manager
            .delegation()
            .managed_orchestrator("delegating-b", &orchestrator)
            .unwrap_err(),
    );
    assert_eq!(orchestrator_error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        orchestrator_error.message,
        "managed orchestrator was not found"
    );
    assert!(!orchestrator_error.message.contains(&orchestrator));
    let orchestrator_cancel_error = ApiError::from(
        manager
            .delegation()
            .cancel_managed_orchestrator("delegating-b", &orchestrator)
            .await
            .unwrap_err(),
    );
    assert_eq!(orchestrator_cancel_error.status, StatusCode::NOT_FOUND);
    assert_eq!(
        orchestrator_cancel_error.message,
        "managed orchestrator was not found"
    );
    assert!(!orchestrator_cancel_error.message.contains(&orchestrator));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn managed_monitor_treats_peer_lease_as_live() {
    let root = temp_root("managed_peer_lease_live");
    seed_direct_with_orchestrator_session_with_base_url(
        &root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let manager = test_manager(&root);
    let orchestrator = manager
        .create_managed_orchestrator_session("delegating", "foreign live run")
        .await
        .unwrap();
    let store_path = root.join("store.db");
    let relation = nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator,
        "peer-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &orchestrator,
            0,
            &Message::User {
                content: "peer is working".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    let ready_path = root.join("managed-peer-ready");
    let mut peer = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tests::managed_monitor_peer_lease_process_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_MANAGED_PEER_STORE", &store_path)
        .env("NAC_TEST_MANAGED_PEER_SESSION", &orchestrator)
        .env("NAC_TEST_MANAGED_PEER_READY", &ready_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    for _ in 0..200 {
        if ready_path.exists() {
            break;
        }
        assert!(
            peer.try_wait().unwrap().is_none(),
            "peer helper exited early"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(ready_path.exists(), "peer helper never acquired the lease");

    let steering = manager
        .queue_managed_orchestrator_steering(
            "delegating",
            &orchestrator,
            "steer the peer-owned generation",
        )
        .expect("peer ownership must not block durable steering");
    let claimed =
        nac_core::store::claim_thread_steering(&store_path, &orchestrator, "peer-run").unwrap();
    assert_eq!(claimed.len(), 1);
    assert_eq!(claimed[0].id, steering.steering_id);

    let peer_observed = manager.inner.managed_monitor_peer_observed.notified();
    let monitor_manager = manager.clone();
    let monitor_orchestrator = orchestrator.clone();
    let monitor = tokio::spawn(async move {
        monitor_manager
            .monitor_managed_orchestrator(&monitor_orchestrator, relation.generation)
            .await
    });

    tokio::time::timeout(Duration::from_secs(5), peer_observed)
        .await
        .expect("monitor must observe the peer-owned operation lease");
    assert!(!monitor.is_finished());
    assert_eq!(
        nac_core::store::load_managed_orchestrator(&store_path, &orchestrator)
            .unwrap()
            .unwrap()
            .status,
        ManagedOrchestratorStatus::Running
    );
    monitor.abort();
    let _ = monitor.await;
    peer.kill().unwrap();
    peer.wait().unwrap();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn peer_owned_direct_and_managed_cancellation_fail_fast() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let direct_root = temp_root("direct_peer_cancel_conflict");
    let _env =
        ScopedModelEnv::isolated(&direct_root.join("nac-home"), Some("peer-cancel-test-key"));
    seed_direct_session(&direct_root, "direct");
    let direct_manager = test_manager(&direct_root);
    let direct_lease =
        sessions::SessionOperationLease::try_acquire(&direct_root.join("store.db"), "direct")
            .unwrap();
    let direct_error = tokio::time::timeout(
        Duration::from_secs(1),
        direct_manager.cancel_active_run("direct"),
    )
    .await
    .expect("peer-owned direct cancellation must not hang")
    .unwrap_err();
    assert!(
        direct_error
            .to_string()
            .contains("running in another process"),
        "unexpected direct cancellation error: {direct_error:#}"
    );
    drop(direct_lease);

    let managed_root = temp_root("managed_peer_cancel_conflict");
    seed_direct_with_orchestrator_session_with_base_url(
        &managed_root,
        "delegating",
        "https://api.openai.com/v1".to_string(),
    );
    let managed_manager = test_manager(&managed_root);
    let orchestrator = managed_manager
        .create_managed_orchestrator_session("delegating", "peer work")
        .await
        .unwrap();
    let store_path = managed_root.join("store.db");
    nac_core::store::begin_managed_orchestrator_run(
        &store_path,
        &orchestrator,
        "peer-run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    nac_core::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            &orchestrator,
            0,
            &Message::User {
                content: "peer is working".to_string(),
            },
            "peer-run",
        )
        .unwrap();
    let managed_lease =
        sessions::SessionOperationLease::try_acquire(&store_path, &orchestrator).unwrap();
    let managed_error = tokio::time::timeout(
        Duration::from_secs(1),
        managed_manager
            .delegation()
            .cancel_managed_orchestrator("delegating", &orchestrator),
    )
    .await
    .expect("peer-owned managed cancellation must not hang")
    .unwrap_err();
    assert!(
        managed_error
            .to_string()
            .contains("running in another process"),
        "unexpected managed cancellation error: {managed_error:#}"
    );
    drop(managed_lease);

    let _ = std::fs::remove_dir_all(direct_root);
    let _ = std::fs::remove_dir_all(managed_root);
}

#[tokio::test]
async fn workspace_mutation_admission_holds_every_shared_session_lease() {
    let root = temp_root("workspace_mutation_leases");
    let git = |args: &[&str]| {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    };
    git(&["init"]);
    git(&["config", "user.name", "NAC Test"]);
    git(&["config", "user.email", "nac@example.invalid"]);
    std::fs::write(root.join("tracked.txt"), b"base\n").unwrap();
    git(&["add", "tracked.txt"]);
    git(&["commit", "-m", "base"]);
    seed_direct_session(&root, "session-a");
    seed_direct_session(&root, "session-b");
    let manager = test_manager(&root);

    let admission = manager
        .workspace()
        .idle_workspace_root("session-a")
        .await
        .unwrap();
    assert_eq!(
        admission.target.root().canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
    let workspace_identity = admission.target.lease_identity();
    assert!(matches!(
        sessions::WorkspaceActivityLease::try_acquire(&root.join("store.db"), &workspace_identity),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    for session_id in ["session-a", "session-b"] {
        assert!(matches!(
            sessions::SessionOperationLease::try_acquire(&root.join("store.db"), session_id),
            Err(sessions::SessionOperationLeaseError::Busy(_))
        ));
    }
    drop(admission);
    drop(
        sessions::WorkspaceActivityLease::try_acquire(&root.join("store.db"), &workspace_identity)
            .unwrap(),
    );
    for session_id in ["session-a", "session-b"] {
        drop(
            sessions::SessionOperationLease::try_acquire(&root.join("store.db"), session_id)
                .unwrap(),
        );
    }
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn cancelled_workspace_request_keeps_leases_until_blocking_git_settles() {
    let root = temp_root("cancelled_workspace_mutation_leases");
    let output = std::process::Command::new("git")
        .args(["-C", root.to_str().unwrap(), "init"])
        .output()
        .unwrap();
    assert!(output.status.success());
    seed_direct_session(&root, "session");
    let manager = test_manager(&root);
    let admission = manager
        .workspace()
        .idle_workspace_root("session")
        .await
        .unwrap();
    let workspace_identity = admission.target.lease_identity();
    let store_path = root.join("store.db");
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(0);

    let request = tokio::spawn(async move {
        application::workspace::WorkspaceApplication::execute_workspace_mutation(
            admission,
            "test workspace mutation failed",
            move |_| {
                started_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            },
        )
        .await
    });
    started_rx.await.unwrap();
    request.abort();
    assert!(matches!(
        sessions::WorkspaceActivityLease::try_acquire(&store_path, &workspace_identity),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&store_path, "session"),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));

    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(workspace) =
                sessions::WorkspaceActivityLease::try_acquire(&store_path, &workspace_identity)
            {
                drop(workspace);
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("blocking mutation should eventually release its leases");
    drop(sessions::SessionOperationLease::try_acquire(&store_path, "session").unwrap());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn parent_deletion_excludes_late_child_relationship_commit() {
    let root = temp_root("delete_excludes_child_create");
    seed_direct_session(&root, "parent");
    let manager = test_manager(&root);
    let gate = manager.lifecycle_gate("parent");
    let blocker = gate.lock().await;

    let delete_manager = manager.clone();
    let delete = tokio::spawn(async move { delete_manager.delete_session("parent").await });
    tokio::task::yield_now().await;
    let create_manager = manager.clone();
    let create = tokio::spawn(async move {
        create_manager
            .create_traditional_child_session("parent", "general", "must not be orphaned")
            .await
    });
    tokio::task::yield_now().await;
    assert!(!delete.is_finished());
    assert!(!create.is_finished());

    drop(blocker);
    delete.await.unwrap().unwrap();
    let error = create.await.unwrap().unwrap_err();
    assert!(error.to_string().contains("was not found"), "{error:#}");
    assert!(sessions::list_sessions(&root.join("store.db"))
        .unwrap()
        .into_iter()
        .all(|session| session.session_id != "parent"));
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn operation_lease_store_failures_are_path_safe_for_submit_patch_and_delete_apis() {
    const CANARY: &str = "operation_lease_private_path_canary";
    let root = temp_root(CANARY);
    seed_editable_session(&root, "session");
    let lock_dir = poison_operation_lease_directory(&root);
    let app = router(test_manager(&root));

    for (method, uri, body) in [
        (
            "POST",
            "/sessions/session/runs",
            Some(r#"{"prompt":"must not run"}"#),
        ),
        (
            "PATCH",
            "/sessions/session/config",
            Some(r#"{"model":"must-not-change"}"#),
        ),
        ("DELETE", "/sessions/session", None),
    ] {
        let mut request = Request::builder().method(method).uri(uri);
        if body.is_some() {
            request = request.header(header::CONTENT_TYPE, "application/json");
        }
        let response = app
            .clone()
            .oneshot(
                request
                    .body(body.map_or_else(Body::empty, Body::from))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::INTERNAL_SERVER_ERROR,
            "{uri}"
        );
        let response = response_json(response).await;
        assert_eq!(
            response,
            serde_json::json!({"error": "session operation lease failed"}),
            "{uri}"
        );
        assert!(!response.to_string().contains(CANARY), "{uri}");
        assert!(
            !response.to_string().contains(&root.display().to_string()),
            "{uri}"
        );
    }

    let stored = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(stored.model, "model-a");
    assert!(lock_dir.is_file());
    let _ = std::fs::remove_dir_all(root);
}
