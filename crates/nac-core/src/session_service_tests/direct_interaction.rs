use super::*;

#[test]
fn public_submission_rejects_external_process_lease() {
    let (parts, store_path) = test_active_service("external_lease", "leased-session");
    let _lease =
        sessions::SessionOperationLease::try_acquire(&store_path, "leased-session").unwrap();
    assert!(matches!(
        parts.service.try_submit_prompt("must not run".to_string()),
        Err(SessionSubmitError::ExternalBusy { session_id }) if session_id == "leased-session"
    ));
    assert!(parts.service.active_run().is_none());
    drop(_lease);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn goal_creation_fails_closed_during_peer_owned_run() {
    let session_id = "peer-goal-session";
    let (parts, store_path) =
        test_direct_active_service("peer_goal", session_id, ModelClient::new_for_test());
    let _peer_lease =
        sessions::SessionOperationLease::try_acquire(&store_path, session_id).unwrap();

    let error = parts
        .service
        .create_direct_goal("must not be left unbound", None)
        .await
        .unwrap_err()
        .to_string();
    assert!(error.contains("running in another process"), "{error}");
    assert!(crate::store::load_session_goal(&store_path, session_id)
        .unwrap()
        .is_none());

    drop(_peer_lease);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn direct_inbox_promotes_queued_prompts_one_at_a_time() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let server = ScriptedServer::start(vec![
            ScriptedResponse::json(
                "200 OK",
                serde_json::json!({
                    "status": "completed",
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "first done"}]}],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
            ScriptedResponse::json(
                "200 OK",
                serde_json::json!({
                    "status": "completed",
                    "output": [{"type": "message", "content": [{"type": "output_text", "text": "second done"}]}],
                    "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
        ]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "session-direct-inbox";
    let (parts, store_path) = test_direct_active_service("direct_inbox", session_id, client);
    let service = parts.service;
    let first = crate::store::create_session_inbox_item(
        &store_path,
        session_id,
        crate::store::InboxDelivery::Queue,
        "first prompt",
        None,
        None,
    )
    .unwrap();
    let second = crate::store::create_session_inbox_item(
        &store_path,
        session_id,
        crate::store::InboxDelivery::Queue,
        "second prompt",
        None,
        None,
    )
    .unwrap();

    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_some());
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let inbox = service.list_direct_inbox().unwrap();
            if !service.has_active_operation()
                && inbox
                    .iter()
                    .all(|item| item.status == crate::store::InboxStatus::Delivered)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("both queued prompts should complete");

    let inbox = service.list_direct_inbox().unwrap();
    assert_eq!(
        inbox.iter().map(|item| item.id).collect::<Vec<_>>(),
        vec![first.id, second.id]
    );
    assert!(inbox
        .iter()
        .all(|item| item.delivered_run_id.as_deref().is_some()));
    assert_ne!(inbox[0].delivered_run_id, inbox[1].delivered_run_id);
    let page = service
        .messages_page(MessagePageRequest {
            before: None,
            limit: 20,
            include_system: false,
        })
        .await
        .unwrap();
    let visible_text = page
        .messages
        .iter()
        .map(|message| match message {
            Message::User { content } => ("user", content.as_str()),
            Message::Assistant { content, .. } => {
                ("assistant", content.as_deref().unwrap_or_default())
            }
            other => panic!("unexpected visible message: {other:?}"),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        visible_text,
        vec![
            ("user", "first prompt"),
            ("assistant", "first done"),
            ("user", "second prompt"),
            ("assistant", "second done"),
        ]
    );
    assert_eq!(server.finish().len(), 2);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn direct_goal_continues_until_budget_limited_and_accounts_each_run() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let response = |text: &str| {
        ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        )
    };
    let server = ScriptedServer::start(vec![response("progress one"), response("progress two")]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "session-direct-goal-budget";
    let (parts, store_path) = test_direct_active_service("direct_goal_budget", session_id, client);
    let service = parts.service;

    let created = service
        .create_direct_goal("finish the bounded task", Some(30))
        .await
        .unwrap();
    assert_eq!(created.status, crate::store::GoalStatus::Active);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let goal = service.direct_goal().unwrap().unwrap();
            if !service.has_active_operation()
                && goal.status == crate::store::GoalStatus::BudgetLimited
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("goal should stop at its optional budget");

    let goal = service.direct_goal().unwrap().unwrap();
    assert_eq!(goal.goal_id, created.goal_id);
    assert_eq!(goal.tokens_used, 30);
    assert_eq!(goal.remaining_tokens(), Some(0));
    assert_eq!(goal.status, crate::store::GoalStatus::BudgetLimited);
    assert!(goal.accounting_run_id.is_none());
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert!(requests
        .iter()
        .all(|request| String::from_utf8_lossy(&request.body).contains("nac_goal_continuation")));

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn explicit_cancel_pauses_goal_instead_of_restarting_it() {
    let session_id = "session-direct-goal-cancel";
    let (parts, store_path) = test_direct_active_service(
        "direct_goal_cancel",
        session_id,
        ModelClient::new_for_test(),
    );
    let service = parts.service;
    let active = service.try_begin_run(None, "ordinary user work").unwrap();
    let goal = service
        .create_direct_goal("keep working", None)
        .await
        .unwrap();
    assert_eq!(
        goal.accounting_run_id.as_deref(),
        Some(active.run_id.as_str())
    );

    service.request_cancel(&active.run_id).await.unwrap();
    let paused = service.direct_goal().unwrap().unwrap();
    assert_eq!(paused.status, crate::store::GoalStatus::Paused);
    assert!(paused.accounting_run_id.is_none());
    assert!(!service.has_active_operation());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn run_admission_and_workspace_mutation_are_cross_process_exclusive() {
    let session_id = "session-workspace-run-authority";
    let (parts, store_path) = test_direct_active_service(
        "workspace_run_authority",
        session_id,
        ModelClient::new_for_test(),
    );
    let identity = crate::workspace::GitTarget::local("/repo").lease_identity();
    let mutation = sessions::WorkspaceMutationLease::try_acquire(&store_path, &identity)
        .expect("workspace mutation lease");
    let operation = sessions::SessionOperationLease::try_acquire(&store_path, session_id)
        .expect("session operation lease");
    let error = parts
        .service
        .try_begin_run_with_lease(
            None,
            "must wait for branch mutation",
            Some(operation),
            RunAdmissionKind::default(),
        )
        .unwrap_err();
    assert!(matches!(error, SessionSubmitError::Coordination { .. }));
    assert!(!parts.service.has_active_operation());
    drop(mutation);

    let operation = sessions::SessionOperationLease::try_acquire(&store_path, session_id)
        .expect("failed admission must release the session lease");
    let active = parts
        .service
        .try_begin_run_with_lease(
            None,
            "run after branch mutation",
            Some(operation),
            RunAdmissionKind::default(),
        )
        .unwrap();
    assert!(matches!(
        sessions::WorkspaceMutationLease::try_acquire(&store_path, &identity),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert_eq!(parts.service.active_run().unwrap().run_id, active.run_id);
    drop(parts);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[cfg(unix)]
#[tokio::test]
async fn cleanup_failure_blocks_run_terminalization_and_remains_retryable() {
    use std::os::unix::fs::PermissionsExt;

    struct RestorePath(Option<std::ffi::OsString>);
    impl Drop for RestorePath {
        fn drop(&mut self) {
            unsafe {
                match self.0.take() {
                    Some(path) => std::env::set_var("PATH", path),
                    None => std::env::remove_var("PATH"),
                }
            }
        }
    }

    let _environment = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let original_path = std::env::var_os("PATH");
    let _restore = RestorePath(original_path.clone());
    let root = std::env::temp_dir().join(format!(
        "nac-session-cleanup-retry-{}",
        uuid::Uuid::new_v4()
    ));
    let bin = root.join("bin");
    let allow_cleanup = root.join("allow-cleanup");
    std::fs::create_dir_all(&bin).unwrap();
    let podman = bin.join("podman");
    std::fs::write(
        &podman,
        format!(
            "#!/bin/sh\nif [ ! -e '{}' ]; then exit 23; fi\nexit 0\n",
            allow_cleanup.display()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&podman, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut paths = vec![bin];
    if let Some(path) = original_path.as_ref() {
        paths.extend(std::env::split_paths(path));
    }
    unsafe { std::env::set_var("PATH", std::env::join_paths(paths).unwrap()) };

    let remote_backend = crate::sandbox::execution_backend_from_sandbox(
        Some(crate::sandbox::SandboxSession::new_for_test(
            crate::sandbox::SandboxSpec {
                workdir: root.clone(),
                ..Default::default()
            },
        )),
        &root,
    );
    let local_backend = crate::sandbox::execution_backend_from_sandbox(None, &root);

    let (cancel_parts, cancel_store) = test_direct_active_service(
        "cleanup_cancel_retry",
        "session-cleanup-cancel-retry",
        ModelClient::new_for_test(),
    );
    let cancel_run = cancel_parts
        .service
        .try_begin_run(None, "cancel with cleanup")
        .unwrap();
    let cancel_terminal = cancel_parts.service.terminal_manager.next_session_name();
    cancel_parts
        .service
        .terminal_manager
        .create(
            cancel_terminal.clone(),
            "sleep 30",
            None,
            120,
            40,
            &local_backend,
        )
        .await
        .unwrap();
    cancel_parts
        .service
        .terminal_manager
        .set_backend_cleanup_for_test(
            &cancel_terminal,
            remote_backend.clone(),
            "/tmp/nac-cancel.pid".to_string(),
        )
        .await
        .unwrap();

    let error = cancel_parts
        .service
        .request_cancel(&cancel_run.run_id)
        .await
        .unwrap_err();
    assert!(matches!(error, SessionCancelError::Cleanup { .. }));
    assert_eq!(
        cancel_parts.service.active_run().unwrap().run_id,
        cancel_run.run_id
    );
    assert!(cancel_parts
        .service
        .terminal_manager
        .get(&cancel_terminal)
        .await
        .is_some());
    assert!(!cancel_parts
        .service
        .recent_events(None, 32)
        .1
        .iter()
        .any(|event| matches!(event.event, SessionEvent::RunCancelled)));

    std::fs::write(&allow_cleanup, "allow").unwrap();
    cancel_parts
        .service
        .request_cancel(&cancel_run.run_id)
        .await
        .unwrap();
    assert!(cancel_parts.service.active_run().is_none());
    assert!(cancel_parts
        .service
        .terminal_manager
        .get(&cancel_terminal)
        .await
        .is_none());

    std::fs::remove_file(&allow_cleanup).unwrap();
    let (finish_parts, finish_store) = test_direct_active_service(
        "cleanup_finish_retry",
        "session-cleanup-finish-retry",
        ModelClient::new_for_test(),
    );
    let finish_run = finish_parts
        .service
        .try_begin_run(None, "finish with cleanup")
        .unwrap();
    let finish_terminal = finish_parts.service.terminal_manager.next_session_name();
    finish_parts
        .service
        .terminal_manager
        .create(
            finish_terminal.clone(),
            "sleep 30",
            None,
            120,
            40,
            &local_backend,
        )
        .await
        .unwrap();
    finish_parts
        .service
        .terminal_manager
        .set_backend_cleanup_for_test(
            &finish_terminal,
            remote_backend,
            "/tmp/nac-finish.pid".to_string(),
        )
        .await
        .unwrap();

    let finish_service = finish_parts.service.clone();
    let finish_run_id = finish_run.run_id.clone();
    let finish_task = tokio::spawn(async move {
        finish_service
            .finish_run(
                &finish_run_id,
                RunOutcome::Failed("model failed".to_string(), None),
            )
            .await;
    });
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        finish_parts.service.active_run().unwrap().run_id,
        finish_run.run_id
    );
    assert!(!finish_parts
        .service
        .recent_events(None, 32)
        .1
        .iter()
        .any(|event| matches!(event.event, SessionEvent::RunFailed { .. })));

    std::fs::write(&allow_cleanup, "allow").unwrap();
    tokio::time::timeout(Duration::from_secs(2), finish_task)
        .await
        .expect("production run settlement did not retry terminal cleanup")
        .unwrap();
    assert!(finish_parts.service.active_run().is_none());

    let _ = std::fs::remove_dir_all(cancel_store.parent().unwrap());
    let _ = std::fs::remove_dir_all(finish_store.parent().unwrap());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn mid_run_goal_creation_does_not_wait_for_the_agent_loop_mutex() {
    let session_id = "session-direct-goal-mid-run";
    let (parts, store_path) = test_direct_active_service(
        "direct_goal_mid_run",
        session_id,
        ModelClient::new_for_test(),
    );
    let service = parts.service;
    let active = service.try_begin_run(None, "ordinary user work").unwrap();
    let _agent_loop = service.agent.lock().await;

    let goal = tokio::time::timeout(
        Duration::from_millis(100),
        service.create_direct_goal("capture the live run", None),
    )
    .await
    .expect("goal creation must not wait for the model-loop mutex")
    .unwrap();
    assert_eq!(
        goal.accounting_run_id.as_deref(),
        Some(active.run_id.as_str())
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn traditional_child_cannot_create_an_autonomous_goal() {
    let session_id = "session-direct-child-goal";
    let (parts, store_path) =
        test_direct_active_service("direct_child_goal", session_id, ModelClient::new_for_test());
    crate::store::insert_test_session(&store_path, "parent");
    let connection = crate::store::open_runtime_connection(&store_path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &store_path,
        "parent",
        session_id,
        crate::store::GENERAL_CHILD_PROFILE,
        "bounded child",
    )
    .unwrap();

    let error = parts
        .service
        .create_direct_goal("must be rejected", None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("cannot own autonomous goals"));
    assert!(crate::store::load_session_goal(&store_path, session_id)
        .unwrap()
        .is_none());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn settled_child_cannot_create_an_autonomous_goal() {
    let session_id = "session-settled-child-goal";
    let (parts, store_path) = test_direct_active_service(
        "settled_child_goal",
        session_id,
        ModelClient::new_for_test(),
    );
    crate::store::insert_test_session(&store_path, "parent");
    crate::store::open_runtime_connection(&store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &store_path,
        "parent",
        session_id,
        crate::store::GENERAL_CHILD_PROFILE,
        "bounded child",
    )
    .unwrap();
    crate::store::begin_traditional_child_run(
        &store_path,
        session_id,
        "run-1",
        crate::store::TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    crate::store::settle_traditional_child_run(
        &store_path,
        session_id,
        "run-1",
        crate::store::TraditionalChildTerminal {
            status: crate::store::TraditionalChildStatus::Completed,
            report: Some("done".to_string()),
            failure: None,
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap();

    let goal_error = parts
        .service
        .create_direct_goal("continue after the assignment", None)
        .await
        .unwrap_err();
    assert!(goal_error
        .to_string()
        .contains("traditional child sessions cannot own autonomous goals"));
    assert!(crate::store::load_session_goal(&store_path, session_id)
        .unwrap()
        .is_none());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn deletion_resource_teardown_terminates_retained_terminals() {
    let session_id = "session-delete-retained-terminal";
    let (parts, store_path) = test_direct_active_service(
        "delete_retained_terminal",
        session_id,
        ModelClient::new_for_test(),
    );
    let service = parts.service;
    let external_service = service.clone();
    let _external_client = external_service.connect_client();
    let terminal_name = service.terminal_manager.next_session_name();
    let backend =
        crate::sandbox::execution_backend_from_sandbox(None, &std::env::current_dir().unwrap());
    service
        .terminal_manager
        .create(terminal_name.clone(), "sleep 30", None, 120, 40, &backend)
        .await
        .unwrap();
    service
        .terminal_manager
        .retain(&terminal_name)
        .await
        .unwrap();
    assert!(service.has_retained_terminals());

    service.destroy_terminals().await.unwrap();
    assert!(external_service
        .terminal_manager
        .get(&terminal_name)
        .await
        .is_none());
    assert!(!external_service.has_retained_terminals());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn child_terminal_crash_window_recovers_report_and_delivers_once() {
    let session_id = "session-child-terminal-recovery";
    let (parts, store_path) = test_direct_active_service(
        "child_terminal_recovery",
        session_id,
        ModelClient::new_for_test(),
    );
    crate::store::insert_test_session(&store_path, "parent");
    crate::store::open_runtime_connection(&store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &store_path,
        "parent",
        session_id,
        crate::store::GENERAL_CHILD_PROFILE,
        "recover completed child",
    )
    .unwrap();
    crate::store::begin_traditional_child_run(
        &store_path,
        session_id,
        "run-terminal",
        crate::store::TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let start_idx = sessions::load_session(&store_path, session_id)
        .unwrap()
        .messages
        .len() as u64;
    let writer = crate::store::TranscriptLogWriter::new(&store_path).unwrap();
    writer
        .append_run_prompt(
            session_id,
            start_idx,
            &Message::User {
                content: "finish before the crash".to_string(),
            },
            "run-terminal",
        )
        .unwrap();
    writer
        .append(
            session_id,
            start_idx + 1,
            &Message::Assistant {
                content: Some("durable child report".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        )
        .unwrap();
    let mut connection = crate::store::open_runtime_connection(&store_path).unwrap();
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    crate::store::clear_active_run(
        &transaction,
        session_id,
        "run-terminal",
        crate::store::RunTerminalDisposition::Completed,
    )
    .unwrap();
    transaction.commit().unwrap();

    let lease = sessions::SessionOperationLease::try_acquire(&store_path, session_id).unwrap();
    assert_eq!(
        parts
            .service
            .reconcile_durable_run_recovery(&lease)
            .await
            .unwrap(),
        crate::store::ActiveRunReconciliation::CanonicalTerminal
    );
    let child = crate::store::load_traditional_child(&store_path, session_id)
        .unwrap()
        .unwrap();
    assert_eq!(
        child.status,
        crate::store::TraditionalChildStatus::Completed
    );
    assert_eq!(child.report.as_deref(), Some("durable child report"));
    assert!(crate::store::load_run_recovery(&store_path, session_id)
        .unwrap()
        .is_none());
    assert_eq!(
        crate::store::list_session_inbox(&store_path, "parent")
            .unwrap()
            .len(),
        1
    );
    assert!(!parts
        .service
        .has_unreconciled_durable_run_recovery()
        .unwrap());

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn child_pre_prompt_crash_is_interrupted_and_delivered_once_after_restart() {
    let session_id = "session-child-pre-prompt-crash";
    let (parts, store_path) = test_direct_active_service(
        "child_pre_prompt_crash",
        session_id,
        ModelClient::new_for_test(),
    );
    crate::store::insert_test_session(&store_path, "parent");
    crate::store::open_runtime_connection(&store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        &store_path,
        "parent",
        session_id,
        crate::store::GENERAL_CHILD_PROFILE,
        "crash before prompt commit",
    )
    .unwrap();
    crate::store::begin_traditional_child_run(
        &store_path,
        session_id,
        "run-pre-prompt",
        crate::store::TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    assert!(crate::store::load_run_recovery(&store_path, session_id)
        .unwrap()
        .is_none());

    let settled = parts
        .service
        .reconcile_traditional_child_terminal()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        settled.status,
        crate::store::TraditionalChildStatus::Interrupted
    );
    assert!(settled
        .failure
        .as_deref()
        .is_some_and(|failure| failure.contains("before its prompt")));
    assert_eq!(
        crate::store::list_session_inbox(&store_path, "parent")
            .unwrap()
            .len(),
        1
    );
    assert!(parts.service.list_direct_inbox().unwrap().is_empty());

    let repeated = parts
        .service
        .reconcile_traditional_child_terminal()
        .await
        .unwrap()
        .unwrap();
    assert_eq!(repeated.status, settled.status);
    assert_eq!(
        crate::store::list_session_inbox(&store_path, "parent")
            .unwrap()
            .len(),
        1
    );
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn direct_inbox_pending_items_are_versioned_editable_and_cancellable() {
    let session_id = "session-direct-inbox-edit";
    let (parts, store_path) =
        test_direct_active_service("direct_inbox_edit", session_id, ModelClient::new_for_test());
    let service = parts.service;
    let active = service.try_begin_run(None, "active prompt").unwrap();
    let queued = service
        .enqueue_direct_input(crate::store::InboxDelivery::Queue, "later", None)
        .await
        .unwrap();
    assert_eq!(queued.target_run_id, None);

    let steered = service
        .update_direct_inbox_item(
            queued.id,
            queued.version,
            crate::store::InboxDelivery::Steer,
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        steered.target_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    assert_eq!(steered.version, queued.version + 1);
    let cancelled = service
        .cancel_direct_inbox_item(steered.id, steered.version)
        .unwrap();
    assert_eq!(cancelled.status, crate::store::InboxStatus::Cancelled);
    assert!(service
        .cancel_direct_inbox_item(cancelled.id, steered.version)
        .unwrap_err()
        .to_string()
        .contains("no longer pending"));

    service.clear_finished_run(&active.run_id);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn direct_inbox_steer_interrupts_the_active_run_and_starts_a_successor() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};

    let completed = serde_json::json!({
        "status": "completed",
        "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
        "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
    })
    .to_string();
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", completed.clone()),
        ScriptedResponse::json("200 OK", completed),
    ]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "session-direct-steer";
    let (parts, store_path) =
        test_direct_active_service("direct_steer_interrupt", session_id, client);
    let service = parts.service;
    let active = service.try_begin_run(None, "initial prompt").unwrap();
    service.set_run_task(&active.run_id, tokio::spawn(async {}));
    let older = service
        .enqueue_direct_input(crate::store::InboxDelivery::Queue, "older queued", None)
        .await
        .unwrap();
    let chosen = service
        .enqueue_direct_input(
            crate::store::InboxDelivery::Queue,
            "change course at the boundary",
            None,
        )
        .await
        .unwrap();
    let steered = service
        .update_direct_inbox_item(
            chosen.id,
            chosen.version,
            crate::store::InboxDelivery::Steer,
            None,
        )
        .await
        .unwrap();
    assert_eq!(steered.delivery, crate::store::InboxDelivery::Steer);
    assert_ne!(
        steered.delivered_run_id.as_deref(),
        Some(active.run_id.as_str())
    );

    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation()
            || service
                .list_direct_inbox()
                .unwrap()
                .iter()
                .any(|item| item.status != crate::store::InboxStatus::Delivered)
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("successor runs should finish");
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let first_body = String::from_utf8_lossy(&requests[0].body);
    let second_body = String::from_utf8_lossy(&requests[1].body);
    assert!(first_body.contains("change course at the boundary"));
    assert!(!first_body.contains("older queued"));
    assert!(second_body.contains("older queued"));

    let inbox = service.list_direct_inbox().unwrap();
    assert_eq!(inbox.len(), 2);
    assert_eq!(inbox[0].id, chosen.id);
    assert_eq!(inbox[0].status, crate::store::InboxStatus::Delivered);
    assert_eq!(inbox[1].id, older.id);
    assert_eq!(inbox[1].status, crate::store::InboxStatus::Delivered);
    assert_ne!(inbox[0].delivered_run_id, inbox[1].delivered_run_id);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn orchestrator_sessions_reject_the_direct_inbox() {
    let (parts, store_path) =
        test_active_service("orchestrator_inbox_rejected", "orchestrator-inbox");
    let error = parts
        .service
        .enqueue_direct_input(crate::store::InboxDelivery::Queue, "not allowed", None)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("only for direct behaviors"));
    assert!(parts.service.list_direct_inbox().is_err());
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn steering_requires_an_active_run_and_active_target_thread() {
    let (parts, store_path) = test_active_service("steering", "session-steering");
    let service = parts.service;
    let no_run = service
        .queue_thread_steering("impl/ui", "make the layout denser")
        .unwrap_err();
    assert!(no_run.to_string().contains("no active run"));

    let (prompt_commit, _prompt_commit_receiver) = watch::channel(RunPromptCommitStatus::Pending);
    *service
        .active_operation
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) =
        Some(ActiveSessionOperation::Run(ActiveRunState {
            snapshot: ActiveRunSnapshot {
                run_id: SessionRunId::new(),
                client_id: None,
                prompt_preview: "revamp the UI".to_string(),
                submitted_user_message: None,
                started_at_epoch_ms: 0,
            },
            started_at: Instant::now(),
            finishing: false,
            task: None,
            prompt_commit,
            transcript_baseline: None,
            command_cancellation: crate::tools::ThreadCancellation::default(),
            inbox_item_id: None,
            _operation_lease: None,
            _workspace_activity_lease: None,
        }));
    let inactive = service
        .queue_thread_steering("impl/ui", "make the layout denser")
        .unwrap_err();
    assert!(inactive.to_string().contains("not active"));

    service.active_threads.mark("impl/ui", "worker-dispatch");
    let queued = service
        .queue_thread_steering("impl/ui", "make the layout denser")
        .unwrap();
    assert_eq!(queued.status, "queued");
    assert_eq!(queued.dispatch_id, "worker-dispatch");
    assert_eq!(
        crate::store::list_thread_steering(&store_path, "session-steering").unwrap(),
        vec![queued]
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn orchestrator_steering_requires_an_active_run_and_expires_at_run_end() {
    let (parts, store_path) =
        test_active_service("orchestrator_steering", "session-orchestrator-steering");
    let service = parts.service;
    let no_run = service
        .queue_orchestrator_steering("change direction")
        .unwrap_err();
    assert!(no_run.to_string().contains("no active run"));

    let active = service.try_begin_run(None, "initial direction").unwrap();
    let queued = service
        .queue_orchestrator_steering("change direction")
        .unwrap();
    assert_eq!(
        queued.thread_name,
        crate::store::ORCHESTRATOR_STEERING_TARGET
    );
    assert_eq!(queued.status, "queued");
    assert_eq!(queued.dispatch_id, active.run_id.as_str());

    assert!(
        service
            .finish_run_once(
                &active.run_id,
                RunOutcome::Completed("done".to_string(), None)
            )
            .await
    );
    let steering =
        crate::store::list_thread_steering(&store_path, "session-orchestrator-steering").unwrap();
    assert_eq!(steering.len(), 1);
    assert_eq!(steering[0].status, "expired");

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

fn steering_record(
    id: i64,
    thread_name: &str,
    status: &str,
    instruction: &str,
) -> crate::store::ThreadSteeringRecord {
    crate::store::ThreadSteeringRecord {
        id,
        session_id: "session".to_string(),
        thread_name: thread_name.to_string(),
        dispatch_id: "run".to_string(),
        instruction: instruction.to_string(),
        status: status.to_string(),
        created_at: "2026-07-31T10:00:00Z".to_string(),
        claimed_at: None,
        delivered_at: None,
        expired_at: None,
    }
}

#[test]
fn covered_orchestrator_steering_ids_require_delivery_and_a_verbatim_message() {
    let orchestrator = crate::store::ORCHESTRATOR_STEERING_TARGET;
    let user = |content: &str| Message::User {
        content: content.to_string(),
    };
    let records = vec![
        steering_record(1, orchestrator, "delivered", "covered"),
        steering_record(2, orchestrator, "delivered", "lost to a crash"),
        steering_record(3, orchestrator, "queued", "covered"),
        steering_record(4, orchestrator, "expired", "covered"),
        steering_record(5, "worker/a", "delivered", "covered"),
    ];
    let transcript = vec![user("covered")];
    assert_eq!(
        covered_orchestrator_steering_ids(&records, &transcript),
        vec![1],
        "only a delivered orchestrator record with a verbatim transcript message is covered"
    );

    // Duplicate instructions: each surviving transcript copy belongs to the
    // newest delivery, so a crash-lost earlier copy keeps its record visible.
    let duplicates = vec![
        steering_record(6, orchestrator, "delivered", "same"),
        steering_record(7, orchestrator, "delivered", "same"),
    ];
    assert_eq!(
        covered_orchestrator_steering_ids(&duplicates, &[user("same")]),
        vec![7]
    );
    assert_eq!(
        covered_orchestrator_steering_ids(&duplicates, &[user("same"), user("same")]),
        vec![6, 7]
    );
}

#[test]
fn covered_ids_from_scan_matches_the_reference_pairing() {
    let orchestrator = crate::store::ORCHESTRATOR_STEERING_TARGET;
    let user = |content: &str| Message::User {
        content: content.to_string(),
    };
    let assistant = || Message::Assistant {
        content: Some("answer".to_string()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    };
    let cases: Vec<(Vec<crate::store::ThreadSteeringRecord>, Vec<Message>)> = vec![
        (vec![], vec![]),
        (vec![], vec![user("orphan")]),
        (
            vec![
                steering_record(1, orchestrator, "delivered", "covered"),
                steering_record(2, orchestrator, "delivered", "lost to a crash"),
                steering_record(3, orchestrator, "queued", "covered"),
                steering_record(4, orchestrator, "expired", "covered"),
                steering_record(5, "worker/a", "delivered", "covered"),
            ],
            vec![user("covered")],
        ),
        // Duplicate instructions pair with the newest deliveries first.
        (
            vec![
                steering_record(6, orchestrator, "delivered", "same"),
                steering_record(7, orchestrator, "delivered", "same"),
            ],
            vec![user("same")],
        ),
        (
            vec![
                steering_record(6, orchestrator, "delivered", "same"),
                steering_record(7, orchestrator, "delivered", "same"),
            ],
            vec![user("same"), assistant(), user("same")],
        ),
        (
            vec![
                steering_record(8, orchestrator, "delivered", "alpha"),
                steering_record(9, orchestrator, "delivered", "beta"),
                steering_record(10, orchestrator, "delivered", "alpha"),
            ],
            vec![user("beta"), assistant(), user("alpha"), user("alpha")],
        ),
    ];
    for (records, transcript) in cases {
        let scan = TranscriptScanCache::from_transcript(&transcript);
        assert_eq!(
            covered_ids_from_scan(&records, &scan),
            covered_orchestrator_steering_ids(&records, &transcript),
            "incremental coverage must match the reference pairing"
        );
    }
}

#[tokio::test]
async fn frontend_snapshot_reconciles_steering_delivered_during_workspace_load() {
    let (mut parts, store_path) =
        test_active_service("steering_workspace_race", "session-steering-workspace-race");
    let queued = crate::store::queue_thread_steering(
        &store_path,
        "session-steering-workspace-race",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run-1",
        "change direction",
    )
    .unwrap();
    crate::store::claim_thread_steering(&store_path, "session-steering-workspace-race", "run-1")
        .unwrap();

    let gate = Arc::new(FrontendSnapshotAfterWorkspaceGate::default());
    parts.service.frontend_snapshot_after_workspace_gate = Some(Arc::clone(&gate));
    let snapshot_service = parts.service.clone();
    let snapshot_task =
        tokio::spawn(async move { snapshot_service.frontend_snapshot().await.unwrap() });
    let reached = tokio::time::timeout(Duration::from_secs(5), async {
        while !gate.reached.load(std::sync::atomic::Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
    })
    .await;
    if reached.is_err() {
        gate.resume.store(true, std::sync::atomic::Ordering::SeqCst);
        let _ = snapshot_task.await;
        panic!("snapshot did not finish workspace inspection");
    }

    crate::store::acknowledge_thread_steering_batch(
        &store_path,
        &[queued.id],
        "session-steering-workspace-race",
        "run-1",
    )
    .unwrap();
    seed_log_tail(
        &parts,
        vec![Message::User {
            content: "change direction".to_string(),
        }],
    )
    .await;
    gate.resume.store(true, std::sync::atomic::Ordering::SeqCst);

    let snapshot = snapshot_task.await.unwrap();
    assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);
    assert_eq!(
        snapshot
            .thread_steering
            .iter()
            .find(|record| record.id == queued.id)
            .map(|record| record.status.as_str()),
        Some("delivered")
    );
    assert!(
        matches!(
            snapshot.messages.last(),
            Some(Message::User { content }) if content == "change direction"
        ),
        "the canonical message must cover steering delivered during workspace inspection"
    );

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[tokio::test]
async fn frontend_snapshot_coverage_is_immediate_from_the_store_transcript() {
    let (parts, store_path) = test_active_service("steering_coverage", "session-coverage");
    let service = parts.service.clone();
    let queued = crate::store::queue_thread_steering(
        &store_path,
        "session-coverage",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run-1",
        "change direction",
    )
    .unwrap();
    crate::store::claim_thread_steering(&store_path, "session-coverage", "run-1").unwrap();
    crate::store::acknowledge_thread_steering_batch(
        &store_path,
        &[queued.id],
        "session-coverage",
        "run-1",
    )
    .unwrap();

    // Crash case: the record is delivered but the store transcript never
    // gained the message, so the record keeps rendering.
    let snapshot = service.frontend_snapshot().await.unwrap();
    assert!(snapshot.covered_orchestrator_steering_ids.is_empty());

    // Immediate case: the moment the delivery lands in the transcript
    // log (ack + append at the steering commit point), coverage hides
    // the record — no run-end persist, and a held agent lock (a busy
    // run) is irrelevant because coverage reads the store.
    let agent_guard = service.agent.lock().await;
    seed_log_tail(
        &parts,
        vec![Message::User {
            content: "change direction".to_string(),
        }],
    )
    .await;
    let snapshot = service.frontend_snapshot().await.unwrap();
    assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);
    assert!(
        matches!(
            snapshot.messages.last(),
            Some(Message::User { content }) if content == "change direction"
        ),
        "the canonical message is visible in the same snapshot that covers the record"
    );
    drop(agent_guard);

    // Persisted case: a blob-carried verbatim message (a run-end persist
    // covered the log row) keeps the record covered across services.
    let (parts, blob_store_path) =
        test_active_service("steering_coverage_blob", "session-coverage-blob");
    let service = parts.service.clone();
    let queued = crate::store::queue_thread_steering(
        &blob_store_path,
        "session-coverage-blob",
        crate::store::ORCHESTRATOR_STEERING_TARGET,
        "run-1",
        "change direction",
    )
    .unwrap();
    crate::store::claim_thread_steering(&blob_store_path, "session-coverage-blob", "run-1")
        .unwrap();
    crate::store::acknowledge_thread_steering_batch(
        &blob_store_path,
        &[queued.id],
        "session-coverage-blob",
        "run-1",
    )
    .unwrap();
    let mut blob = vec![Message::System {
        content: "system".to_string(),
    }];
    blob.push(Message::User {
        content: "change direction".to_string(),
    });
    seed_store_transcript(&parts, blob).await;
    let snapshot = service.frontend_snapshot().await.unwrap();
    assert_eq!(snapshot.covered_orchestrator_steering_ids, vec![queued.id]);

    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    let _ = std::fs::remove_dir_all(blob_store_path.parent().unwrap());
}

#[test]
fn public_submission_rejects_stale_config_revision() {
    let (parts, store_path) = test_active_service("stale_revision", "stale-session");
    let mut stored = sessions::load_session(&store_path, "stale-session").unwrap();
    stored.model = "externally-updated-model".to_string();
    sessions::update_session_config(&store_path, &stored).unwrap();

    let error = match parts
        .service
        .try_submit_prompt("must not use stale config".to_string())
    {
        Ok(_) => panic!("stale service unexpectedly started a run"),
        Err(error) => error,
    };
    assert!(matches!(
        error,
        SessionSubmitError::Coordination {
            message: SessionCoordinationError::StaleConfiguration { .. },
        }
    ));
    assert!(parts.service.active_run().is_none());
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

#[test]
fn from_orchestrator_run_config_exposes_metadata_and_init_snapshot() {
    let store_path = test_store_path("active_init");
    let client = ModelClient::new_for_test();
    let session_id = "session-1".to_string();
    let agent = test_agent(client.clone(), store_path.clone(), Some(session_id.clone()));
    let mut snapshot = sessions::new_snapshot(
        session_id.clone(),
        PathBuf::from("/repo"),
        client.model.clone(),
        client.base_url().to_string(),
        client.backend(),
        client.reasoning_effort(),
        None,
        None,
        agent.messages.clone(),
        None,
        BTreeMap::new(),
    );
    snapshot.last_response_duration_ms = Some(200);
    snapshot.previous_response_duration_ms = Some(100);
    snapshot.response_durations_ms = Some(vec![Some(100), Some(200)]);

    let parts = SessionService::from_orchestrator_run_config(OrchestratorRunConfig {
        agent,
        client,
        session: OrchestratorSession::Active {
            session_id: session_id.clone(),
            store_path: store_path.clone(),
            snapshot,
        },
        sandbox_status: "off".to_string(),
        agents_md_status: "loaded".to_string(),
        workspace_display: "/repo".to_string(),
        workspace_git: Some(GitTarget::local("/repo")),
        resume_base_cwd: PathBuf::from("/repo"),
    });

    assert_eq!(parts.init.metadata.store_path, store_path);
    assert_eq!(parts.init.metadata.session_id.as_deref(), Some("session-1"));
    assert_eq!(parts.init.metadata.model, "gpt-5.5");
    assert_eq!(parts.init.metadata.backend, "openai-responses");
    assert_eq!(parts.init.restored_messages.len(), 1);
    assert_eq!(
        parts.init.response_timing.last_response_duration_ms,
        Some(200)
    );
    assert_eq!(
        parts.init.response_timing.response_durations_ms,
        Some(vec![Some(100), Some(200)])
    );
}
