use super::*;
use crate::model::{
    test_http::{ScriptedResponse, ScriptedServer},
    ModelClient,
};
use crate::session_service::tests::{compaction_response, test_direct_active_service};
use crate::store::{InboxStatus, TaskFollowupAction as Action};

fn request(action: Action, run: Option<String>, key: &str) -> TaskFollowupRequest {
    TaskFollowupRequest {
        caller_session_id: "caller".into(),
        request_id: key.into(),
        target_session_id: "session".into(),
        project_id: None,
        action,
        expected_run_id: run,
        prompt: "/compact\n$skill\npeer guidance".into(),
    }
}

fn caller(path: &Path) {
    crate::store::insert_test_session(path, "caller");
    let conn = crate::store::open_runtime_connection(path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    drop(conn);
    for action in [Action::Queue, Action::Steer, Action::Auto] {
        crate::store::issue_test_task_followup_delegation(path, "caller", "session", action);
    }
}

async fn settled(service: &SessionService, path: &Path, count: usize) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let delivered = crate::store::list_session_inbox(path, "session")
                .unwrap()
                .iter()
                .filter(|item| item.status == InboxStatus::Delivered)
                .count();
            if delivered == count && !service.has_active_operation() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

// Local-only witness: no store/lease calls or panics while unwinding a failure.
struct FifoPhaseWitness {
    started: std::time::Instant,
    phases: std::sync::Arc<std::sync::Mutex<Vec<(&'static str, u128)>>>,
}

impl FifoPhaseWitness {
    fn mark(&self, label: &'static str) {
        self.phases
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .push((label, self.started.elapsed().as_micros()));
    }
}

impl Drop for FifoPhaseWitness {
    fn drop(&mut self) {
        let phases = self
            .phases
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let value = serde_json::json!({ "phases_us": *phases });
        // Ignore only unavailable diagnostic stderr; never replace the original
        // assertion/timeout with a logging failure. No arbitrary payloads/paths.
        if let Err(_unavailable) = std::io::Write::write_fmt(
            &mut std::io::stderr().lock(),
            format_args!("NAC_FIFO_PHASE_WITNESS {value}\n"),
        ) {}
    }
}

#[tokio::test]
async fn followup_peer_lease_fifo_shutdown_and_replays_do_not_duplicate_turns() {
    let witness = FifoPhaseWitness {
        started: std::time::Instant::now(),
        phases: std::sync::Arc::new(std::sync::Mutex::new(Vec::new())),
    };
    witness.mark("serverStarting");
    let observed_phases = witness.phases.clone();
    let observed_started = witness.started;
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json("200 OK", compaction_response("first received")),
            ScriptedResponse::json("200 OK", compaction_response("second received")),
        ],
        move |index, _| {
            observed_phases
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push((
                    if index == 0 { "request1" } else { "request2" },
                    observed_started.elapsed().as_micros(),
                ));
        },
    );
    let (parts, path) = test_direct_active_service(
        "followup_fifo",
        "session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    witness.mark("fixtureReady");
    let service = &parts.service;
    caller(&path);
    witness.mark("callerReady");
    let lease = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
    witness.mark("leaseHeld");
    let first = request(Action::Auto, None, "one");
    let a = service.admit_task_followup(first.clone()).await.unwrap();
    witness.mark("queue1");
    let b = service
        .admit_task_followup(request(Action::Queue, None, "two"))
        .await
        .unwrap();
    witness.mark("queue2");
    assert_eq!(a.disposition, Some(InboxStatus::Pending));
    assert_eq!(a.resolved_delivery, crate::store::InboxDelivery::Queue);
    assert!(a.inbox_item_id < b.inbox_item_id);
    assert!(!service.has_active_operation());
    assert!(
        service
            .admit_task_followup(first.clone())
            .await
            .unwrap()
            .replayed
    );
    witness.mark("replayChecked");
    drop(lease);
    witness.mark("leaseDropped");
    service.start_next_direct_inbox_item().await.unwrap();
    witness.mark("wakeReturned");
    witness.mark("settleStarting");
    settled(service, &path, 2).await;
    witness.mark("settled2Inactive");
    let replay = service.admit_task_followup(first.clone()).await.unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.disposition, Some(InboxStatus::Delivered));
    let items = crate::store::list_session_inbox(&path, "session").unwrap();
    assert_ne!(items[0].delivered_run_id, items[1].delivered_run_id);
    service.stop_run_admission().await.unwrap();
    assert!(service.admit_task_followup(first).await.unwrap().replayed);
    assert_eq!(
        service
            .admit_task_followup(request(Action::Queue, None, "new"))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::Stopping)
    );
    witness.mark("shutdownChecked");
    let requests = server.finish();
    witness.mark("serverFinished");
    assert_eq!(requests.len(), 2);
    assert_eq!(
        service
            .messages_snapshot()
            .await
            .unwrap()
            .iter()
            .filter(|m| matches!(m,Message::User{content} if content.contains("peer guidance")))
            .count(),
        2
    );
}

#[tokio::test]
async fn followup_wake_failure_after_commit_is_accepted_pending_then_delivers_once() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        compaction_response("received"),
    )]);
    let (parts, path) = test_direct_active_service(
        "followup_wake_failure",
        "session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let service = &parts.service;
    caller(&path);
    let agent = service.agent.lock().await;
    let original = request(Action::Queue, None, "wake-failed");
    let accepted = service.admit_task_followup(original.clone()).await.unwrap();
    assert_eq!(accepted.disposition, Some(InboxStatus::Pending));
    drop(agent);
    assert!(
        service
            .admit_task_followup(original.clone())
            .await
            .unwrap()
            .replayed
    );
    assert!(!service.has_active_operation()); // Retry is passive even after a wake failure.
    service.start_next_direct_inbox_item().await.unwrap();
    settled(service, &path, 1).await;
    assert_eq!(
        service
            .admit_task_followup(original)
            .await
            .unwrap()
            .disposition,
        Some(InboxStatus::Delivered)
    );
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn followup_late_steer_keeps_original_run_binding_and_reaches_successor() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        compaction_response("late received"),
    )]);
    let (parts, path) = test_direct_active_service(
        "followup_late",
        "session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let service = &parts.service;
    caller(&path);
    let old = service
        .coordinate_local(|s| s.try_begin_run(None, "old"))
        .await
        .unwrap()
        .unwrap();
    let run = old.run_id.to_string();
    let conn = crate::store::open_runtime_connection(&path).unwrap();
    conn.execute("INSERT INTO thread_events(session_id,thread_name,event_json,created_at) VALUES('session','main','{}','now')",[]).unwrap();
    let prompt = conn.last_insert_rowid();
    conn.execute("INSERT INTO session_run_recovery(session_id,run_id,submitted_message_id,status) VALUES('session',?1,?2,'active')",rusqlite::params![run,prompt]).unwrap();
    drop(conn);
    let finishing = old.run_id.clone();
    service
        .coordinate_local(move |s| s.mark_run_finishing(&finishing))
        .await
        .unwrap()
        .unwrap();
    let original = request(Action::Steer, Some(run.clone()), "late");
    let admitted = service.admit_task_followup(original.clone()).await.unwrap();
    assert_eq!(admitted.admitted_run_id.as_deref(), Some(run.as_str()));
    assert_eq!(admitted.disposition, Some(InboxStatus::Pending));
    let conn = crate::store::open_runtime_connection(&path).unwrap();
    conn.execute(
        "DELETE FROM session_run_recovery WHERE session_id='session'",
        [],
    )
    .unwrap();
    drop(conn);
    service
        .coordinate_local(move |s| s.clear_finished_run(&old.run_id))
        .await
        .unwrap();
    service.start_next_direct_inbox_item().await.unwrap();
    settled(service, &path, 1).await;
    let delivered = service.admit_task_followup(original).await.unwrap();
    assert_eq!(delivered.admitted_run_id.as_deref(), Some(run.as_str()));
    assert_ne!(delivered.delivered_run_id.as_deref(), Some(run.as_str()));
    assert_eq!(delivered.disposition, Some(InboxStatus::Delivered));
    assert_eq!(
        service
            .admit_task_followup(request(Action::Steer, Some(run), "stale"))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::RunConflict)
    );
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn followup_active_run_consumes_steer_at_safe_boundary_without_successor() {
    let (arrived_tx, arrived_rx) = tokio::sync::oneshot::channel();
    let arrived_tx = StdMutex::new(Some(arrived_tx));
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json("200 OK", compaction_response("first answer")),
            ScriptedResponse::json("200 OK", compaction_response("guidance received")),
        ],
        move |index, _| {
            if index == 0 {
                arrived_tx.lock().unwrap().take().unwrap().send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
        },
    );
    let (parts, path) = test_direct_active_service(
        "followup_active",
        "session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let service = &parts.service;
    caller(&path);
    let active = service
        .try_submit_prompt("Initial target work".into())
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), arrived_rx)
        .await
        .unwrap()
        .unwrap();
    let input = request(Action::Steer, Some(active.run_id.to_string()), "active");
    let accepted = service.admit_task_followup(input.clone()).await.unwrap();
    assert_eq!(accepted.disposition, Some(InboxStatus::Pending));
    release_tx.send(()).unwrap();
    settled(service, &path, 1).await;
    let receipt = service.admit_task_followup(input).await.unwrap();
    assert_eq!(
        receipt.delivered_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    assert_eq!(receipt.admitted_run_id, receipt.delivered_run_id);
    assert_eq!(
        sessions::load_session_summary(&path, "session")
            .unwrap()
            .unwrap()
            .run_count,
        1
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert!(String::from_utf8_lossy(&requests[1].body).contains("peer guidance"));
}
