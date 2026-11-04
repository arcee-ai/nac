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
async fn goal_free_settlement_preserves_run_when_preflight_input_is_cancelled() {
    let (release, wait) = std::sync::mpsc::channel();
    let provider = ScriptedServer::start_observed(
        vec![ScriptedResponse::json("200 OK", serde_json::json!({
            "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"done"}]}]
        }).to_string())],
        move |_, _| { wait.recv_timeout(Duration::from_secs(5)).unwrap(); },
    );
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-preflight-cancel",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let run = parts.service.try_submit_prompt("work".into()).unwrap();
    let preflight = parts.service.hold_attention_preflight_for_test(&run.run_id);
    let publication = parts
        .service
        .hold_attention_publication_for_test(run.run_id.as_str())
        .unwrap();
    let pending = crate::store::create_session_inbox_item(
        &path,
        "session",
        crate::store::InboxDelivery::Queue,
        "cancel this",
        None,
        None,
    )
    .unwrap();
    release.send(()).unwrap();
    assert!(
        preflight.arrived().await,
        "the real selector saw durable pending work"
    );
    crate::store::cancel_pending_session_inbox_item(&path, "session", pending.id, pending.version)
        .unwrap();
    preflight.release();
    let selected = publication.arrived().await.unwrap();
    publication.release();
    publication.publication_attempted().await.unwrap();
    assert_eq!(
        selected,
        crate::session_service::attention_test_support::AttentionPublicationSelection::Idle {
            goal: None,
            last_run: Some(run.run_id.to_string()),
        }
    );
    assert!(observer.0.lock().unwrap().iter().any(|snapshot| snapshot
        .settled
        .as_ref()
        .is_some_and(|work| work.run_id == run.run_id.as_str()
            && work.disposition == SettledWorkDisposition::Completed)));
    parts.service.stop_run_admission().await.unwrap();
    assert_eq!(
        provider.finish().len(),
        1,
        "cancelled input must not launch a successor"
    );
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_goal_free_real_owned_models_continue_queue_then_complete_only_final_run() {
    let response = || {
        ScriptedResponse::json("200 OK", serde_json::json!({
        "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"private result"}]}],
        "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}
    }).to_string())
    };
    let (release, wait) = std::sync::mpsc::channel();
    let provider = ScriptedServer::start_observed(vec![response(), response()], move |index, _| {
        if index == 1 {
            wait.recv_timeout(Duration::from_secs(5)).unwrap();
        }
    });
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-free-queue",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    for prompt in ["first", "second"] {
        crate::store::create_session_inbox_item(
            &path,
            "session",
            crate::store::InboxDelivery::Queue,
            prompt,
            None,
            None,
        )
        .unwrap();
    }
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    assert!(!parts.service.event_bus.has_interactive_subscribers());
    let first = parts
        .service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .unwrap();
    until(|| {
        observer.0.lock().unwrap().iter().any(|snapshot| {
            snapshot.settled.as_ref().is_some_and(|work| {
                work.run_id == first.run_id.as_str()
                    && work.disposition == SettledWorkDisposition::Continuing
            })
        })
    })
    .await;
    assert!(observer.0.lock().unwrap().iter().all(|snapshot| snapshot
        .settled
        .as_ref()
        .is_none_or(|work| work.disposition != SettledWorkDisposition::Completed)));
    release.send(()).unwrap();
    until(|| {
        observer.0.lock().unwrap().iter().any(|snapshot| {
            snapshot
                .settled
                .as_ref()
                .is_some_and(|work| work.disposition == SettledWorkDisposition::Completed)
        })
    })
    .await;
    let completed = observer
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|snapshot| snapshot.settled.clone())
        .filter(|work| work.disposition == SettledWorkDisposition::Completed)
        .collect::<Vec<_>>();
    assert_eq!(completed.len(), 1);
    assert_ne!(completed[0].run_id, first.run_id.as_str());
    assert_eq!(completed[0].goal, None);
    let stale = observer
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|snapshot| snapshot.settled.clone())
        .find(|work| {
            work.run_id == first.run_id.as_str()
                && work.disposition == SettledWorkDisposition::Continuing
        })
        .unwrap();
    let before = observer.0.lock().unwrap().len();
    parts.service.publish_settled_attention(stale, None);
    assert_eq!(
        observer.0.lock().unwrap().len(),
        before,
        "a delayed older continuation cannot replace the actual newer completed run"
    );
    let metadata = owner
        .read_attention_metadata(Some("session".into()))
        .await
        .unwrap()
        .remove(0);
    assert!(metadata.verifies_goal_free_idle(&completed[0].run_id, parts.service.config_version));
    assert!(!format!("{metadata:?}").contains("private result"));
    assert!(!parts.service.event_bus.has_interactive_subscribers());
    assert_eq!(
        parts
            .service
            .select_next_direct_inbox_item()
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::IdleUnverified
    );
    assert_eq!(provider.finish().len(), 2);
    parts.service.stop_run_admission().await.unwrap();
    owner.shutdown().await.unwrap();
    drop(parts);
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn attention_goal_free_selector_rejects_unverified_empty_wrong_outcome_and_foreign_lease() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-free-negative",
        "session",
        ModelClient::new_for_test(),
    );
    parts
        .service
        .install_attention_observer(Arc::new(Observer::default()))
        .unwrap();
    let run = SessionRunId::from_stored("unverified".into());
    assert_eq!(
        parts
            .service
            .select_direct_continuation_after_settlement(&run)
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::IdleUnverified
    );
    let lease = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
    assert_eq!(
        parts
            .service
            .select_direct_continuation_after_settlement(&run)
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::ForeignOwner
    );
    drop(lease);
    parts.service.stop_run_admission().await.unwrap();
    assert_eq!(
        parts
            .service
            .select_direct_continuation_after_settlement(&run)
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::Stopping
    );
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn attention_goal_free_actual_older_completion_cannot_replace_newer_idle_run() {
    let response = || {
        ScriptedResponse::json("200 OK", serde_json::json!({
        "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"done"}]}]
    }).to_string())
    };
    let provider = ScriptedServer::start(vec![response(), response()]);
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-free-stale",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let mut receipts = Vec::new();
    for prompt in ["first", "second"] {
        let run = parts.service.try_submit_prompt(prompt.into()).unwrap();
        until(|| {
            observer.0.lock().unwrap().iter().any(|snapshot| {
                snapshot.settled.as_ref().is_some_and(|work| {
                    work.run_id == run.run_id.as_str()
                        && work.disposition == SettledWorkDisposition::Completed
                })
            })
        })
        .await;
        receipts.push(
            observer
                .0
                .lock()
                .unwrap()
                .iter()
                .filter_map(|snapshot| snapshot.settled.clone())
                .find(|work| {
                    work.run_id == run.run_id.as_str()
                        && work.disposition == SettledWorkDisposition::Completed
                })
                .unwrap(),
        );
    }
    let before = observer.0.lock().unwrap().len();
    parts
        .service
        .publish_settled_attention(receipts[0].clone(), None);
    assert_eq!(observer.0.lock().unwrap().len(), before);
    assert_eq!(
        observer.0.lock().unwrap().last().unwrap().settled,
        Some(receipts[1].clone())
    );
    assert_eq!(provider.finish().len(), 2);
    drop(parts);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn attention_f1_three_real_runs_reject_delayed_a_while_c_is_active() {
    let response = || {
        ScriptedResponse::json("200 OK", serde_json::json!({
        "status":"completed", "output":[{"type":"message","content":[{"type":"output_text","text":"done"}]}],
        "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}
    }).to_string())
    };
    let (release_b, wait_b) = std::sync::mpsc::channel();
    let (release_c, wait_c) = std::sync::mpsc::channel();
    let b_reached = Arc::new(tokio::sync::Notify::new());
    let b_arrived = b_reached.clone();
    let c_reached = Arc::new(tokio::sync::Notify::new());
    let reached = c_reached.clone();
    let provider = ScriptedServer::start_observed_with_timeout(
        vec![response(), response(), response()],
        Duration::from_secs(10),
        move |index, _| {
            if index == 1 {
                b_arrived.notify_one();
                wait_b.recv_timeout(Duration::from_secs(10)).unwrap();
            }
            if index == 2 {
                reached.notify_one();
                wait_c.recv_timeout(Duration::from_secs(10)).unwrap();
            }
        },
    );
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-f1-three-runs",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    for prompt in ["A", "B", "C"] {
        crate::store::create_session_inbox_item(
            &path,
            "session",
            crate::store::InboxDelivery::Queue,
            prompt,
            None,
            None,
        )
        .unwrap();
    }
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let a = parts
        .service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .unwrap();
    until(|| {
        observer.0.lock().unwrap().iter().any(|snapshot| {
            snapshot.settled.as_ref().is_some_and(|work| {
                work.run_id == a.run_id.as_str()
                    && work.disposition == SettledWorkDisposition::Continuing
            })
        })
    })
    .await;
    tokio::time::timeout(Duration::from_secs(5), b_reached.notified())
        .await
        .unwrap();
    let b = parts.service.active_run().unwrap();
    let inbox = owner.list_session_inbox("session".into()).await.unwrap();
    assert_eq!(
        inbox[1].delivered_run_id.as_deref(),
        Some(b.run_id.as_str())
    );
    assert_eq!(inbox[2].status, crate::store::InboxStatus::Pending);
    // Capture the exact actually-selected B handle while B is gated. The
    // production factory owns how that handle becomes a publication receipt.
    let delayed_a_selection = ContinuationSelection::started(SessionRunHandle {
        run_id: b.run_id.clone(),
        client_id: b.client_id.clone(),
    })
    .disposition;
    release_b.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), c_reached.notified())
        .await
        .unwrap();
    until(|| {
        observer.0.lock().unwrap().iter().any(|snapshot| {
            snapshot.settled.as_ref().is_some_and(|work| {
                work.run_id == b.run_id.as_str()
                    && work.disposition == SettledWorkDisposition::Continuing
            })
        })
    })
    .await;
    let c = parts.service.active_run().unwrap();
    let before = observer.0.lock().unwrap().last().unwrap().clone();
    assert_eq!(
        before.operation,
        AttentionOperation::Run(c.run_id.to_string())
    );
    assert_eq!(before.settled.as_ref().unwrap().run_id, b.run_id.as_str());
    parts.service.publish_attention_completion(
        &a.run_id,
        true,
        GoalAttentionSettlement {
            known: true,
            goal: None,
        },
        delayed_a_selection,
    );
    let after = observer.0.lock().unwrap().last().unwrap().clone();
    assert_eq!(parts.service.active_run().unwrap().run_id, c.run_id);
    release_c.send(()).unwrap();
    until(|| {
        observer.0.lock().unwrap().iter().any(|snapshot| {
            snapshot.settled.as_ref().is_some_and(|work| {
                work.run_id == c.run_id.as_str()
                    && work.disposition == SettledWorkDisposition::Completed
            })
        })
    })
    .await;
    let completed = observer
        .0
        .lock()
        .unwrap()
        .iter()
        .filter_map(|snapshot| snapshot.settled.clone())
        .filter(|work| work.disposition == SettledWorkDisposition::Completed)
        .collect::<Vec<_>>();
    let calls = provider.finish().len();
    owner.shutdown().await.unwrap();
    drop(parts);
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    // Assert after cleanup so the intentional RED cannot strand C or its store.
    assert_eq!(
        after.settled, before.settled,
        "delayed A must not replace B while actual C runs"
    );
    assert_eq!(
        after.revision, before.revision,
        "a stale publication cannot advance the producer frontier"
    );
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].run_id, c.run_id.as_str());
    assert_eq!(calls, 3);
}

#[test]
fn attention_goal_free_peer_owner_helper() {
    let Some(root) = std::env::var_os("NAC_ATTENTION_PEER_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let path = root.join("store.db");
    let run = Uuid::new_v4().to_string();
    let lease = Arc::new(sessions::SessionOperationLease::try_acquire(&path, "session").unwrap());
    let writer =
        crate::store::TranscriptLogWriter::for_run(&path, "session", &run, &lease).unwrap();
    let index = sessions::load_session(&path, "session")
        .unwrap()
        .messages
        .len() as u64;
    writer
        .append_run_prompt(
            "session",
            index,
            &Message::User {
                content: "peer admitted work".into(),
            },
            &run,
        )
        .unwrap();
    std::fs::write(root.join("peer-ready"), run).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(15);
    while !root.join("peer-release").exists() {
        assert!(
            std::time::Instant::now() < deadline,
            "peer release timed out"
        );
        std::thread::sleep(Duration::from_millis(5));
    }
    // Leave the real admitted recovery marker, as an exited owner would.
}

#[tokio::test]
async fn attention_goal_free_actual_peer_lease_then_abandoned_admission_stays_unverified_without_recovery(
) {
    struct Peer(std::process::Child);
    impl Drop for Peer {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-free-peer",
        "session",
        ModelClient::new_for_test(),
    );
    let root = path.parent().unwrap();
    parts
        .service
        .install_attention_observer(Arc::new(Observer::default()))
        .unwrap();
    let mut peer = Peer(std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "session_service::attention::tests::goal_free::attention_goal_free_peer_owner_helper", "--nocapture"])
        .env("NAC_ATTENTION_PEER_ROOT", root)
        .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped()).spawn().unwrap());
    until(|| root.join("peer-ready").exists()).await;
    let run = std::fs::read_to_string(root.join("peer-ready")).unwrap();
    let run = SessionRunId::from_stored(run);
    assert_eq!(
        parts
            .service
            .select_direct_continuation_after_settlement(&run)
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::ForeignOwner
    );
    std::fs::write(root.join("peer-release"), "release").unwrap();
    until(|| peer.0.try_wait().unwrap().is_some()).await;
    assert!(peer.0.wait().unwrap().success());
    let before = crate::store::load_run_recovery(&path, "session")
        .unwrap()
        .unwrap();
    assert_eq!(before.run_id, run.as_str());
    assert_eq!(before.status, crate::store::RunRecoveryStatus::Active);
    assert_eq!(
        parts
            .service
            .select_direct_continuation_after_settlement(&run)
            .await
            .unwrap()
            .disposition,
        ContinuationDisposition::IdleUnverified
    );
    assert_eq!(
        crate::store::load_run_recovery(&path, "session")
            .unwrap()
            .unwrap(),
        before,
        "finite validation cannot perform observation-triggered recovery"
    );
    assert!(!parts.service.has_active_operation());
    // SessionServiceParts already owns its ordinary fixture event receiver.
    assert!(!parts.service.event_bus.has_interactive_subscribers());
    drop(peer);
    drop(parts);
    std::fs::remove_dir_all(root).unwrap();
}
