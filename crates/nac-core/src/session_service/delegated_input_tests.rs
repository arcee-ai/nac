use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;

const QUEUED_PROMPT: &str = "foreground input sent before peer exit";

#[cfg(feature = "managed-fault-fixture")]
#[tokio::test]
async fn private_child_read_fault_retains_generation_for_exactly_once_settlement() {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let _lock = crate::TEST_ENV_LOCK.lock().unwrap();
    struct Environment(Option<std::ffi::OsString>);
    impl Drop for Environment {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("NAC_MANAGED_FAULT_ROOT", value),
                None => std::env::remove_var("NAC_MANAGED_FAULT_ROOT"),
            }
        }
    }
    let (parts, path) =
        test_direct_active_service("private_child_fault", "child", ModelClient::new_for_test());
    let mut parent = sessions::load_session(&path, "child").unwrap();
    parent.session_id = "parent".into();
    sessions::create_session(&path, &parent).unwrap();
    crate::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "fault fixture",
    )
    .unwrap();
    let child = crate::store::begin_traditional_child_run(
        &path,
        "child",
        "all612-private-fixture-run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let start = sessions::load_session(&path, "child")
        .unwrap()
        .messages
        .len() as u64;
    let writer = crate::store::TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_run_prompt(
            "child",
            start,
            &Message::User {
                content: "durable prompt".into(),
            },
            "all612-private-fixture-run",
        )
        .unwrap();
    writer
        .append(
            "child",
            start + 1,
            &Message::Assistant {
                content: Some("report".into()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        )
        .unwrap();
    let mut connection = crate::store::open_runtime_connection(&path).unwrap();
    let transaction = connection
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    crate::store::clear_active_run(
        &transaction,
        "child",
        "all612-private-fixture-run",
        crate::store::RunTerminalDisposition::Completed,
        None,
    )
    .unwrap();
    transaction.commit().unwrap();
    drop(connection);
    let control_root =
        std::path::PathBuf::from(format!("/tmp/all117-fault-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&control_root).unwrap();
    std::fs::set_permissions(&control_root, std::fs::Permissions::from_mode(0o700)).unwrap();
    let _environment = Environment(std::env::var_os("NAC_MANAGED_FAULT_ROOT"));
    std::env::set_var("NAC_MANAGED_FAULT_ROOT", &control_root);
    let nonce = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let control = serde_json::json!({"nonce": nonce, "boundary": "child-read", "session_id": "child", "run_id": "all612-private-fixture-run", "generation": child.generation, "expires_unix_ms": now + 10_000});
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(control_root.join("child-read.json"))
        .unwrap();
    file.write_all(serde_json::to_string(&control).unwrap().as_bytes())
        .unwrap();
    drop(file);
    let run = SessionRunId::from_stored("all612-private-fixture-run".into());
    parts
        .service
        .settle_traditional_child_run(
            &run,
            crate::store::TraditionalChildStatus::Completed,
            Some("report".into()),
            None,
        )
        .await;
    assert_eq!(
        crate::store::load_traditional_child(&path, "child")
            .unwrap()
            .unwrap()
            .status,
        crate::store::TraditionalChildStatus::Running
    );
    assert!(crate::store::list_session_inbox(&path, "parent")
        .unwrap()
        .is_empty());
    let reached: serde_json::Value = serde_json::from_slice(
        &std::fs::read(control_root.join(format!("used-{nonce}.json"))).unwrap(),
    )
    .unwrap();
    assert_eq!(reached["session_id"], "child");
    assert_eq!(reached["run_id"], "all612-private-fixture-run");
    assert_eq!(reached["generation"], child.generation);
    assert_eq!(reached["after_successful_sqlite_commit"], false);
    drop(parts);
    let (rebuilt, _) = crate::session_service::tests::test_direct_active_service_at(
        "child",
        ModelClient::new_for_test(),
        path.clone(),
    );
    let lease = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    rebuilt
        .service
        .reconcile_durable_run_recovery(&lease)
        .await
        .unwrap();
    rebuilt
        .service
        .reconcile_durable_run_recovery(&lease)
        .await
        .unwrap();
    let receipt =
        crate::store::load_traditional_child_terminal_receipt(&path, "child", child.generation)
            .unwrap()
            .unwrap();
    assert_eq!(
        receipt.run_id.as_deref(),
        Some("all612-private-fixture-run")
    );
    assert_eq!(
        receipt.status,
        crate::store::TraditionalChildStatus::Completed
    );
    assert_eq!(receipt.report.as_deref(), Some("report"));
    assert!(crate::store::load_run_recovery(&path, "child")
        .unwrap()
        .is_none());
    let inbox = crate::store::list_session_inbox(&path, "parent").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
    std::fs::remove_dir_all(control_root).unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

fn successor_server() -> ScriptedServer {
    ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "successor report"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )])
}

async fn queued_input(owner: &crate::store::StoreCoordinator) -> crate::store::SessionInboxRecord {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let inbox = owner.list_session_inbox("child".to_owned()).await.unwrap();
            if let Some(item) = inbox.into_iter().next() {
                return item;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("input must be queued while the peer owns its lease")
}

fn submit_foreground(
    service: &SessionService,
) -> tokio::task::JoinHandle<Result<TraditionalChildRecord>> {
    let service = service.clone();
    tokio::spawn(async move {
        service
            .submit_or_steer_traditional_child(
                "parent",
                QUEUED_PROMPT.to_owned(),
                TraditionalChildExecutionMode::Foreground,
            )
            .await
    })
}

async fn assert_successor_delivery(
    service: &SessionService,
    owner: &crate::store::StoreCoordinator,
    original: &TraditionalChildRecord,
    item: &crate::store::SessionInboxRecord,
    successor: TraditionalChildRecord,
    old_status: crate::store::TraditionalChildStatus,
    server: ScriptedServer,
) {
    assert_eq!(successor.child_session_id, original.child_session_id);
    assert_eq!(successor.generation, original.generation + 1);
    assert_ne!(successor.run_id, original.run_id);

    let terminal = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let Some(terminal) = owner
                .load_traditional_child_terminal_receipt("child".into(), successor.generation)
                .await
                .unwrap()
            {
                if !service.has_active_operation() {
                    return terminal;
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("successor must durably settle, including peer-owned runs");
    let inbox = owner.list_session_inbox("child".to_owned()).await.unwrap();
    assert_eq!(inbox.len(), 1, "recovery must never requeue submitted text");
    assert_eq!(inbox[0].id, item.id);
    assert_eq!(inbox[0].content, QUEUED_PROMPT);
    assert_eq!(inbox[0].target_run_id, original.run_id);
    assert_eq!(inbox[0].delivered_run_id, successor.run_id);
    assert_eq!(inbox[0].status, crate::store::InboxStatus::Delivered);
    let old = owner
        .load_traditional_child_terminal_receipt("child".into(), original.generation)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(old.run_id, original.run_id);
    assert_eq!(old.status, old_status);
    assert_eq!(terminal.run_id, successor.run_id);
    assert_eq!(terminal.execution_mode, successor.execution_mode);
    assert_eq!(
        terminal.status,
        crate::store::TraditionalChildStatus::Completed
    );
    assert_eq!(terminal.report.as_deref(), Some("successor report"));
    let completions = owner.list_session_inbox("parent".into()).await.unwrap();
    if successor.execution_mode == Some(TraditionalChildExecutionMode::Foreground) {
        assert!(
            completions.is_empty(),
            "foreground result must not also be delivered as a background completion"
        );
        assert!(terminal.completion_inbox_id.is_none());
    } else {
        assert_eq!(
            completions.len(),
            1,
            "background completion must be delivered exactly once"
        );
        assert_eq!(terminal.completion_inbox_id, Some(completions[0].id));
    }
    // A later wait must still attribute this exact item to its delivered run.
    assert_eq!(
        service
            .wait_for_child_input_delivery(item.id)
            .await
            .unwrap(),
        terminal
    );
    let path = service.metadata.store_path.clone();
    let messages = crate::store::spawn_blocking_store_caller(move || {
        let mut messages = sessions::load_session(&path, "child").unwrap().messages;
        let tail = crate::store::TranscriptLogWriter::new(&path)
            .unwrap()
            .read_tail_from("child", messages.len() as u64)
            .unwrap();
        messages.extend(tail.into_iter().map(|(_, message)| message));
        messages
    })
    .await
    .unwrap();
    assert_eq!(
        messages
            .iter()
            .filter(|message| matches!(message,
        Message::User { content } if content == QUEUED_PROMPT))
            .count(),
        1
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let body = String::from_utf8(requests[0].body.clone()).unwrap();
    assert_eq!(body.matches(QUEUED_PROMPT).count(), 1);
}

fn abandoned_child(
    label: &str,
    recovery_run: Option<&str>,
) -> (SessionService, PathBuf, TraditionalChildRecord) {
    abandoned_child_with_client(label, recovery_run, ModelClient::new_for_test())
}

fn abandoned_child_with_client(
    label: &str,
    recovery_run: Option<&str>,
    client: ModelClient,
) -> (SessionService, PathBuf, TraditionalChildRecord) {
    let (parts, path) = test_direct_active_service(label, "child", client);
    let mut parent = sessions::load_session(&path, "child").unwrap();
    parent.session_id = "parent".to_owned();
    sessions::create_session(&path, &parent).unwrap();
    crate::store::create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        "general",
        "abandoned child",
    )
    .unwrap();
    let child = crate::store::begin_traditional_child_run(
        &path,
        "child",
        "relationship-run",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    if let Some(run_id) = recovery_run {
        let start = sessions::load_session(&path, "child")
            .unwrap()
            .messages
            .len() as u64;
        crate::store::TranscriptLogWriter::new(&path)
            .unwrap()
            .append_run_prompt(
                "child",
                start,
                &Message::User {
                    content: "durable prompt".to_owned(),
                },
                run_id,
            )
            .unwrap();
    }
    (parts.service, path, child)
}

#[tokio::test]
async fn foreground_child_input_recovers_peer_exit_before_successor_admission() {
    let server = successor_server();
    let (service, path, original) = abandoned_child_with_client(
        "foreground_child_peer_exit",
        Some("relationship-run"),
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let waiting = submit_foreground(&service);
    let item = queued_input(&owner).await;
    assert_eq!(item.status, crate::store::InboxStatus::Pending);
    assert_eq!(item.target_run_id, original.run_id);
    assert_eq!(
        item.child_execution_mode,
        Some(TraditionalChildExecutionMode::Foreground)
    );
    assert!(!waiting.is_finished());
    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        owner.load_traditional_child("child".into()).await.unwrap(),
        Some(original.clone())
    );
    assert_eq!(
        owner
            .load_run_recovery("child".into())
            .await
            .unwrap()
            .unwrap()
            .status,
        crate::store::RunRecoveryStatus::Active
    );
    assert!(service.active_run().is_none());
    drop(peer);
    let successor = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("peer exit must unblock foreground input")
        .unwrap()
        .unwrap();
    assert_eq!(
        successor.execution_mode,
        Some(TraditionalChildExecutionMode::Foreground)
    );
    assert_successor_delivery(
        &service,
        &owner,
        &original,
        &item,
        successor,
        crate::store::TraditionalChildStatus::Interrupted,
        server,
    )
    .await;
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn person_child_input_records_intent_only_on_delivery_with_live_or_lost_foreground_waiter() {
    for abandon_waiter in [false, true] {
        let server = successor_server();
        let (service, path, original) = abandoned_child_with_client(
            if abandon_waiter {
                "person_child_lost_waiter"
            } else {
                "person_child_live_waiter"
            },
            Some("relationship-run"),
            ModelClient::new_for_test_server(server.base_url.clone()),
        );
        sessions::update_permission_approval_mode(
            &path,
            "parent",
            crate::permissions::PermissionApprovalMode::Review,
        )
        .unwrap();
        let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
        let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
        let submitting = service.clone();
        let waiting = tokio::spawn(async move {
            submitting
                .submit_or_steer_traditional_child_with_origin(
                    "parent",
                    QUEUED_PROMPT.into(),
                    TraditionalChildExecutionMode::Foreground,
                    crate::store::InputOrigin::Person,
                )
                .await
        });
        let item = queued_input(&owner).await;
        assert_eq!(
            item.child_execution_mode,
            Some(TraditionalChildExecutionMode::Foreground)
        );
        assert!(item.child_wait_id.is_some());
        assert_eq!(
            sessions::reviewable_intent(path.clone(), "parent".into()).await,
            sessions::ReviewIntent::NeverRecorded
        );
        let successor = if abandon_waiter {
            waiting.abort();
            assert!(waiting.await.unwrap_err().is_cancelled());
            drop(peer);
            service
                .start_next_direct_inbox_item()
                .await
                .unwrap()
                .unwrap();
            service
                .wait_for_child_input_delivery(item.id)
                .await
                .unwrap()
        } else {
            drop(peer);
            tokio::time::timeout(Duration::from_secs(5), waiting)
                .await
                .unwrap()
                .unwrap()
                .unwrap()
        };
        assert_eq!(
            successor.execution_mode,
            Some(if abandon_waiter {
                TraditionalChildExecutionMode::Background
            } else {
                TraditionalChildExecutionMode::Foreground
            })
        );
        assert_successor_delivery(
            &service,
            &owner,
            &original,
            &item,
            successor,
            crate::store::TraditionalChildStatus::Interrupted,
            server,
        )
        .await;
        let expected = sessions::ReviewIntent::Accepted(vec![QUEUED_PROMPT.into()]);
        assert_eq!(
            sessions::reviewable_intent(path.clone(), "parent".into()).await,
            expected
        );
        assert_eq!(
            sessions::reviewable_intent(path.clone(), "child".into()).await,
            expected
        );
        owner.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[tokio::test]
async fn queued_child_input_survives_waiter_exit_and_recovery_crash_windows() {
    // No prompt committed; prompt recovery committed before relationship
    // settlement; cancellation committed before relationship settlement.
    for phase in ["pre-prompt", "interrupted", "cancelled"] {
        let server = successor_server();
        let (service, path, original) = abandoned_child_with_client(
            phase,
            (phase != "pre-prompt").then_some("relationship-run"),
            ModelClient::new_for_test_server(server.base_url.clone()),
        );
        if phase == "cancelled" {
            let mut connection = crate::store::open_runtime_connection(&path).unwrap();
            let transaction = connection.transaction().unwrap();
            crate::store::clear_active_run(
                &transaction,
                "child",
                "relationship-run",
                crate::store::RunTerminalDisposition::Cancelled,
                None,
            )
            .unwrap();
            transaction.commit().unwrap();
        }
        let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
        let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
        let waiting = submit_foreground(&service);
        let item = queued_input(&owner).await;
        waiting.abort();
        assert!(waiting.await.unwrap_err().is_cancelled());
        if phase == "interrupted" {
            owner.reconcile_active_run("child".into()).await.unwrap();
        }
        drop(peer);
        // The durable inbox wake must work without the original HTTP waiter
        // or an attachment-time recovery owner.
        let run = service
            .start_next_direct_inbox_item()
            .await
            .unwrap()
            .unwrap();
        let successor = owner
            .load_traditional_child("child".into())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(successor.run_id.as_deref(), Some(run.run_id.as_str()));
        assert_eq!(
            successor.execution_mode,
            Some(TraditionalChildExecutionMode::Background)
        );
        assert_successor_delivery(
            &service,
            &owner,
            &original,
            &item,
            successor,
            if phase == "cancelled" {
                crate::store::TraditionalChildStatus::Cancelled
            } else {
                crate::store::TraditionalChildStatus::Interrupted
            },
            server,
        )
        .await;
        owner.shutdown().await.unwrap();
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[tokio::test]
async fn recovered_background_child_input_retains_exactly_one_parent_completion() {
    let server = successor_server();
    let (service, path, original) = abandoned_child_with_client(
        "background_child_peer_exit",
        Some("relationship-run"),
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let accepted = service
        .submit_or_steer_traditional_child(
            "parent",
            QUEUED_PROMPT.into(),
            TraditionalChildExecutionMode::Background,
        )
        .await
        .unwrap();
    assert_eq!(accepted.generation, original.generation);
    let item = queued_input(&owner).await;
    assert_eq!(
        item.child_execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    drop(peer);
    service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .unwrap();
    let successor = service
        .wait_for_child_input_delivery(item.id)
        .await
        .unwrap();
    assert_eq!(
        successor.execution_mode,
        Some(TraditionalChildExecutionMode::Background)
    );
    assert_successor_delivery(
        &service,
        &owner,
        &original,
        &item,
        successor,
        crate::store::TraditionalChildStatus::Interrupted,
        server,
    )
    .await;
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn queued_child_mismatched_recovery_fails_closed_after_peer_exit() {
    let (service, path, original) = abandoned_child(
        "queued_child_mismatched_recovery",
        Some("different-recovery-run"),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let waiting = submit_foreground(&service);
    let item = queued_input(&owner).await;
    drop(peer);
    let error = tokio::time::timeout(Duration::from_secs(2), waiting)
        .await
        .expect("mismatched recovery must not loop")
        .unwrap()
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("remains running after recovery; input was not admitted"),
        "{error:#}"
    );
    assert_eq!(
        owner.load_traditional_child("child".into()).await.unwrap(),
        Some(original)
    );
    assert_eq!(
        owner.list_session_inbox("child".into()).await.unwrap(),
        vec![item]
    );
    assert!(service.active_run().is_none());
    assert!(sessions::SessionOperationLease::try_acquire(&path, "child").is_ok());
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn cancelled_queued_child_input_is_not_promoted_after_peer_exit() {
    let (service, path, original) =
        abandoned_child("cancelled_queued_child", Some("relationship-run"));
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let peer = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    let waiting = submit_foreground(&service);
    let item = queued_input(&owner).await;
    let cancelled = owner
        .cancel_pending_session_inbox_item("child".into(), item.id, item.version)
        .await
        .unwrap();
    let error = tokio::time::timeout(Duration::from_secs(2), waiting)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(
        error.to_string().contains("cancelled before delivery"),
        "{error:#}"
    );
    drop(peer);
    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        owner.list_session_inbox("child".into()).await.unwrap(),
        vec![cancelled]
    );
    assert_eq!(
        owner.load_traditional_child("child".into()).await.unwrap(),
        Some(original)
    );
    assert!(service.active_run().is_none());
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test(flavor = "current_thread")]
async fn mismatched_child_recovery_rejects_input_without_looping_or_changing_projection() {
    let (service, path, original) = abandoned_child(
        "child_input_mismatched_recovery",
        Some("different-recovery-run"),
    );
    // The owned executor provides real async admission boundaries, so the
    // timeout also bounds this regression if a future change restores the loop.
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let error = tokio::time::timeout(
        Duration::from_secs(2),
        service.submit_or_steer_traditional_child(
            "parent",
            "must not be queued to an unowned run".to_owned(),
            TraditionalChildExecutionMode::Foreground,
        ),
    )
    .await
    .expect("mismatched child recovery must terminate rather than retry without progress")
    .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("remains running after recovery; input was not admitted"),
        "{error:#}"
    );
    assert_eq!(
        owner
            .load_traditional_child("child".to_owned())
            .await
            .unwrap(),
        Some(original)
    );
    assert!(owner
        .list_session_inbox("child".to_owned())
        .await
        .unwrap()
        .is_empty());
    assert!(service.active_run().is_none());
    // Error return releases the operation lease; recovery never invents owner authority.
    let lease = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    drop(lease);
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test]
async fn child_input_recovery_accepts_a_terminal_pre_prompt_projection() {
    let (service, path, original) = abandoned_child("child_input_pre_prompt_recovery", None);
    let lease = sessions::SessionOperationLease::try_acquire(&path, "child").unwrap();
    service
        .recover_child_input_for_admission(&lease)
        .await
        .unwrap();
    let recovered = crate::store::load_traditional_child(&path, "child")
        .unwrap()
        .unwrap();
    assert_eq!(recovered.generation, original.generation);
    assert_eq!(recovered.run_id, original.run_id);
    assert_eq!(
        recovered.status,
        crate::store::TraditionalChildStatus::Interrupted
    );
    assert_eq!(
        crate::store::load_traditional_child_terminal_receipt(&path, "child", recovered.generation)
            .unwrap(),
        Some(recovered)
    );
    assert!(crate::store::list_session_inbox(&path, "child")
        .unwrap()
        .is_empty());
    drop(lease);
    assert!(sessions::SessionOperationLease::try_acquire(&path, "child").is_ok());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[path = "delegated_input_wait_tests.rs"]
mod waiter_tests;
