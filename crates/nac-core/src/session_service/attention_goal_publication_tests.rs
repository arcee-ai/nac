//! Goal-backed receipts must retain the same exact accepted-run publication fence.
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

async fn until(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn goal_backed_delayed_completion_cannot_replace_newer_idle_run() {
    let response = || {
        ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{
                    "type": "output_text", "text": "done"
                }]}],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            })
            .to_string(),
        )
    };
    let (release_a, wait_a) = std::sync::mpsc::channel();
    let reached_a = Arc::new(tokio::sync::Notify::new());
    let reached = reached_a.clone();
    let provider = ScriptedServer::start_observed(vec![response(), response()], move |index, _| {
        if index == 0 {
            reached.notify_one();
            wait_a.recv_timeout(Duration::from_secs(5)).unwrap();
        }
    });
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-backed-delayed",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let a = parts.service.try_submit_prompt("goal A".into()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), reached_a.notified())
        .await
        .unwrap();
    let goal = parts
        .service
        .create_direct_goal("complete A", None)
        .await
        .unwrap();
    crate::store::update_session_goal_by_model(
        &path,
        "session",
        &goal.goal_id,
        crate::store::GoalStatus::Complete,
    )
    .unwrap();
    let publication = parts
        .service
        .hold_attention_publication_for_test(a.run_id.as_str())
        .unwrap();
    release_a.send(()).unwrap();
    let selected = publication.arrived().await.unwrap();
    let settled_goal = crate::store::load_session_goal(&path, "session")
        .unwrap()
        .unwrap();
    assert_eq!(
        selected,
        crate::session_service::attention_test_support::AttentionPublicationSelection::Idle {
            goal: Some(AttentionGoal {
                id: goal.goal_id.clone(),
                version: u64::try_from(settled_goal.version).unwrap(),
            }),
            last_run: Some(a.run_id.to_string()),
        }
    );
    assert!(settled_goal.accounting_run_id.is_none());
    let b = parts
        .service
        .try_submit_prompt("ordinary B".into())
        .unwrap();
    until(|| {
        observer.0.lock().unwrap().last().is_some_and(|snapshot| {
            snapshot.settled.as_ref().is_some_and(|work| {
                work.run_id == b.run_id.as_str()
                    && work.goal.is_none()
                    && work.disposition == SettledWorkDisposition::Completed
            })
        })
    })
    .await;
    let before = observer.0.lock().unwrap().last().unwrap().clone();
    publication.release();
    publication.publication_attempted().await.unwrap();
    let after = observer.0.lock().unwrap().last().unwrap().clone();
    let retained_goal = crate::store::load_session_goal(&path, "session").unwrap();
    parts.service.stop_run_admission().await.unwrap();
    let calls = provider.finish().len();
    drop(publication);
    drop(parts);
    owner.shutdown().await.unwrap();
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    // Assert after physical cleanup so the expected RED cannot retain a run/store.
    assert_eq!(calls, 2);
    assert_eq!(before.operation, AttentionOperation::Idle);
    assert_eq!(
        after.settled, before.settled,
        "delayed goal A replaced newer B"
    );
    assert_eq!(
        after.revision, before.revision,
        "stale receipt advanced revision"
    );
    assert_eq!(after.epoch, before.epoch);
    assert_eq!(retained_goal, Some(settled_goal));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn goal_backed_current_receipt_is_idempotent_and_stale_terminal_receipts_are_fenced() {
    let (release, wait) = std::sync::mpsc::channel();
    let reached = Arc::new(tokio::sync::Notify::new());
    let arrival = reached.clone();
    let provider = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{
                    "type": "output_text", "text": "B completed"
                }]}]
            })
            .to_string(),
        )],
        move |_, _| {
            arrival.notify_one();
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
        },
    );
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-backed-terminal-fence",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let a = parts.service.try_begin_run(None, "goal A").unwrap();
    let goal = parts
        .service
        .create_direct_goal("finish A", None)
        .await
        .unwrap();
    crate::store::update_session_goal_by_model(
        &path,
        "session",
        &goal.goal_id,
        crate::store::GoalStatus::Complete,
    )
    .unwrap();
    {
        let mut agent = parts.service.agent.lock().await;
        agent
            .push_and_log_for_test(Message::User {
                content: "A".into(),
            })
            .await
            .unwrap();
        agent
            .push_and_log_for_test(Message::Assistant {
                content: Some("A completed".into()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            })
            .await
            .unwrap();
    }
    assert!(
        parts
            .service
            .finish_run_once(&a.run_id, RunOutcome::Completed("A completed".into(), None))
            .await
    );
    let current = observer.0.lock().unwrap().last().unwrap().clone();
    let actual_a = current.settled.clone().unwrap();
    assert_eq!(actual_a.disposition, SettledWorkDisposition::Completed);
    assert_eq!(actual_a.goal.as_ref().unwrap().id, goal.goal_id);
    parts
        .service
        .publish_settled_attention(actual_a.clone(), None);
    let duplicate_a = observer.0.lock().unwrap().last().unwrap().clone();
    let b = parts
        .service
        .try_submit_prompt("ordinary B".into())
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), reached.notified())
        .await
        .unwrap();
    let active = observer.0.lock().unwrap().last().unwrap().clone();
    for disposition in [
        SettledWorkDisposition::Completed,
        SettledWorkDisposition::WaitingForDecision,
    ] {
        // An old terminal receipt must not become current, regardless of kind.
        parts.service.publish_settled_attention(
            SettledWork {
                disposition,
                ..actual_a.clone()
            },
            None,
        );
    }
    let after_active = observer.0.lock().unwrap().last().unwrap().clone();
    assert_eq!(parts.service.active_run().unwrap().run_id, b.run_id);
    release.send(()).unwrap();
    until(|| {
        observer.0.lock().unwrap().last().is_some_and(|snapshot| {
            snapshot.settled.as_ref().is_some_and(|work| {
                work.run_id == b.run_id.as_str()
                    && work.disposition == SettledWorkDisposition::Completed
            })
        })
    })
    .await;
    let idle = observer.0.lock().unwrap().last().unwrap().clone();
    for disposition in [
        SettledWorkDisposition::Completed,
        SettledWorkDisposition::WaitingForDecision,
    ] {
        parts.service.publish_settled_attention(
            SettledWork {
                disposition,
                ..actual_a.clone()
            },
            None,
        );
    }
    let after_idle = observer.0.lock().unwrap().last().unwrap().clone();
    parts.service.stop_run_admission().await.unwrap();
    let calls = provider.finish().len();
    drop(parts);
    owner.shutdown().await.unwrap();
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    assert_eq!(calls, 1);
    assert_eq!(
        duplicate_a, current,
        "current goal receipt replay must be idempotent"
    );
    assert_eq!(
        active.operation,
        AttentionOperation::Run(b.run_id.to_string())
    );
    assert_eq!(
        after_active, active,
        "stale terminal receipt changed active B"
    );
    assert_eq!(after_idle, idle, "stale terminal receipt replaced idle B");
}
