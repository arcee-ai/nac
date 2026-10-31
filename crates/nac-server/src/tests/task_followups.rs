use super::*;
use crate::application::task_followups::{AdmissionGate, ServerTaskFollowupController};
use nac_core::store::{InboxStatus, TaskFollowupAction as Action, TaskFollowupRequest};
use nac_core::task_followups::TaskFollowupController;

fn followup(key: &str) -> TaskFollowupRequest {
    TaskFollowupRequest {
        caller_session_id: "caller".into(),
        request_id: key.into(),
        target_session_id: "target".into(),
        project_id: None,
        action: Action::Auto,
        expected_run_id: None,
        prompt: "Exact independent guidance".into(),
    }
}

async fn delivered(manager: &SessionManager) -> nac_core::store::TaskFollowupReceipt {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let receipt = nac_core::store::inspect_task_followup_receipt(
                &manager.inner.store_path,
                "caller",
                "one",
            )
            .unwrap()
            .unwrap();
            let service = manager
                .inner
                .active_sessions
                .read()
                .await
                .get("target")
                .cloned();
            if receipt.disposition == Some(InboxStatus::Delivered)
                && service.is_some_and(|s| !s.has_active_operation())
            {
                break receipt;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn task_followup_owner_outlives_cancelled_caller_and_restart_replay_is_passive() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("followup_owner_cancel");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let (base, requests) = scripted_direct_responses(&["target received"]);
    seed_direct_session_with_base_url(&root, "target", base);
    seed_direct_session(&root, "caller");
    let manager = test_manager(&root);
    let gate = Arc::new(AdmissionGate::default());
    let controller = Arc::new(ServerTaskFollowupController {
        manager: Arc::downgrade(&manager.inner),
        after_admission: Some(gate.clone()),
    });
    let sender = tokio::spawn(async move { controller.follow_up(followup("one")).await });
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    assert!(manager.inner.active_sessions.read().await.is_empty());
    let pending =
        nac_core::store::inspect_task_followup_receipt(&manager.inner.store_path, "caller", "one")
            .unwrap()
            .unwrap();
    assert_eq!(pending.disposition, Some(InboxStatus::Pending));
    sender.abort();
    assert!(sender.await.unwrap_err().is_cancelled());
    gate.release.notify_one();
    let result = delivered(&manager).await;
    assert!(result.delivered_run_id.is_some());
    assert_eq!(requests.recv_timeout(Duration::from_secs(5)).unwrap(), 0);
    assert_eq!(
        sessions::reviewable_intent(manager.inner.store_path.clone(), "target".into()).await,
        sessions::ReviewIntent::NeverRecorded
    );
    assert!(
        nac_core::store::list_session_inbox(&manager.inner.store_path, "caller")
            .unwrap()
            .is_empty()
    );
    manager.inner.task_preparations.settle().await;
    drop(manager);
    let restarted = test_manager(&root);
    let controller = ServerTaskFollowupController {
        manager: Arc::downgrade(&restarted.inner),
        after_admission: None,
    };
    let replay = controller.follow_up(followup("one")).await.unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.inbox_item_id, result.inbox_item_id);
    assert_eq!(replay.delivered_run_id, result.delivered_run_id);
    assert!(restarted.inner.active_sessions.read().await.is_empty());
    assert_eq!(
        nac_core::store::list_session_inbox(&restarted.inner.store_path, "target")
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn task_followup_invalid_binding_does_not_attach_and_shutdown_keeps_receipt_inspectable() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("followup_owner_fence");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    seed_direct_session(&root, "caller");
    seed_direct_session(&root, "target");
    let manager = test_manager(&root);
    let controller = ServerTaskFollowupController {
        manager: Arc::downgrade(&manager.inner),
        after_admission: None,
    };
    let mut stale = followup("stale");
    stale.action = Action::Steer;
    stale.expected_run_id = Some("prior-run".into());
    assert_eq!(
        controller
            .follow_up(stale)
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&nac_core::store::TaskFollowupError::RunConflict)
    );
    assert!(manager.inner.active_sessions.read().await.is_empty());
    assert!(
        nac_core::store::list_session_inbox(&manager.inner.store_path, "target")
            .unwrap()
            .is_empty()
    );
    let accepted =
        nac_core::store::admit_task_followup(&manager.inner.store_path, &followup("one")).unwrap();
    manager.inner.task_preparations.stop();
    let replay = controller.follow_up(followup("one")).await.unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.inbox_item_id, accepted.inbox_item_id);
    assert_eq!(
        controller
            .follow_up(followup("new"))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&nac_core::store::TaskFollowupError::Stopping)
    );
    assert!(manager.inner.active_sessions.read().await.is_empty());
}
