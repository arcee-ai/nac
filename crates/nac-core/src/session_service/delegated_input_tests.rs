use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;

const QUEUED_PROMPT: &str = "foreground input sent before peer exit";

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
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("successor must settle");
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
    let terminal = owner
        .load_traditional_child_terminal_receipt("child".into(), successor.generation)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(terminal.run_id, successor.run_id);
    assert_eq!(
        terminal.status,
        crate::store::TraditionalChildStatus::Completed
    );
    assert_eq!(terminal.report.as_deref(), Some("successor report"));
    // A later wait must still attribute this exact item to its delivered run.
    assert_eq!(
        service
            .wait_for_child_input_delivery(item.id)
            .await
            .unwrap(),
        terminal
    );
    let messages = service.messages_snapshot().await.unwrap();
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
        let successor = service
            .wait_for_child_input_delivery(item.id)
            .await
            .unwrap();
        assert_eq!(successor.run_id.as_deref(), Some(run.run_id.as_str()));
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
