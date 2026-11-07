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

async fn successor_without_receipt(suppress_success: bool) {
    let response = || {
        ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
                "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}
            })
            .to_string(),
        )
    };
    let second = if suppress_success {
        response()
    } else {
        ScriptedResponse::json(
            "400 Bad Request",
            r#"{"error":{"message":"controlled nonretryable failure","type":"invalid_request_error"}}"#,
        )
    };
    let (release, wait) = std::sync::mpsc::channel();
    let provider = ScriptedServer::start_observed_with_timeout(
        vec![response(), second],
        Duration::from_secs(10),
        move |index, _| {
            if index == 1 {
                wait.recv_timeout(Duration::from_secs(10)).unwrap();
            }
        },
    );
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-continuation-idle",
        "session",
        ModelClient::new_for_test_server(provider.base_url.clone()),
    );
    for prompt in ["A", "B"] {
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
    let b = parts.service.active_run().unwrap();
    assert_ne!(a.run_id, b.run_id);
    let running = observer.0.lock().unwrap().last().unwrap().clone();
    assert_eq!(
        running.operation,
        AttentionOperation::Run(b.run_id.to_string())
    );
    assert_eq!(running.settled.as_ref().unwrap().run_id, a.run_id.as_str());
    let publication = parts
        .service
        .hold_attention_publication_for_test(b.run_id.as_str())
        .unwrap();
    release.send(()).unwrap();
    let selected = publication.arrived().await.unwrap();
    assert!(!parts.service.has_active_operation());
    let broker = parts.service.permission_broker.as_ref().unwrap().clone();
    let interactive =
        suppress_success.then(|| parts.service.event_bus.subscribe_assistant_deltas());
    let request = if suppress_success {
        assert!(matches!(&selected,
            crate::session_service::attention_test_support::AttentionPublicationSelection::Idle { goal: None, last_run }
            if last_run.as_deref() == Some(b.run_id.as_str())));
        let request = tokio::spawn({
            let broker = broker.clone();
            async move {
                broker
                    .authorize(
                        "exec_command",
                        &[crate::tools::kernel::PermissionResource::new(
                            "execute",
                            "command:[curl][private.example]",
                        )],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            }
        });
        until(|| !broker.pending().is_empty()).await;
        Some(request)
    } else {
        assert_eq!(selected,
            crate::session_service::attention_test_support::AttentionPublicationSelection::IdleUnverified);
        None
    };
    publication.release();
    publication.publication_attempted().await.unwrap();
    if let Some(request) = request {
        let id = broker.pending()[0].id.clone();
        broker
            .reply(&id, crate::permissions::PermissionReply::Reject)
            .unwrap();
        assert!(matches!(
            request.await.unwrap(),
            crate::permissions::AuthorizationOutcome::Denied(_)
        ));
    }
    drop(interactive);
    let last = observer.0.lock().unwrap().last().unwrap().clone();
    let metadata = owner
        .read_attention_metadata(Some("session".into()))
        .await
        .unwrap()
        .remove(0);
    let outcome = metadata.last_outcome.unwrap();
    let inbox = owner.list_session_inbox("session".into()).await.unwrap();
    let grants = broker.grants().unwrap();
    let observations = observer.0.lock().unwrap().clone();
    parts.service.stop_run_admission().await.unwrap();
    assert!(parts
        .service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_none());
    let calls = provider.finish().len();
    owner.shutdown().await.unwrap();
    drop(parts);
    drop(owner);
    drop(broker);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();

    // Deliberate RED assertions follow physical provider/store cleanup.
    assert_eq!(last.operation, AttentionOperation::Idle);
    assert!(
        last.settled.is_none(),
        "idle successor must retire its predecessor's Continuing receipt"
    );
    assert!(observations.iter().all(|snapshot| {
        snapshot
            .settled
            .as_ref()
            .is_none_or(|work| work.disposition != SettledWorkDisposition::Completed)
    }));
    assert_eq!(outcome.run_id, b.run_id.as_str());
    assert_eq!(
        outcome.disposition,
        if suppress_success {
            crate::store::RunOutcomeDisposition::Completed
        } else {
            crate::store::RunOutcomeDisposition::Failed
        }
    );
    assert_eq!(inbox.len(), 2);
    assert_eq!(
        inbox[0].delivered_run_id.as_deref(),
        Some(a.run_id.as_str())
    );
    assert_eq!(
        inbox[1].delivered_run_id.as_deref(),
        Some(b.run_id.as_str())
    );
    assert_eq!(calls, 2);
    assert!(grants.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_successor_retires_predecessor_continuing_at_idle() {
    successor_without_receipt(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn suppressed_successor_completion_does_not_resurface_continuing_after_real_reject() {
    successor_without_receipt(true).await;
}

#[tokio::test]
async fn owner_selected_goal_retry_receipt_survives_idle_callbacks_and_handoff() {
    let (parts, path) = crate::session_service::tests::test_direct_active_service(
        "attention-goal-retry-idle",
        "session",
        ModelClient::new_for_test(),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    let observer = Arc::new(Observer::default());
    parts
        .service
        .install_attention_observer(observer.clone())
        .unwrap();
    let run = parts
        .service
        .coordinate_local(|service| service.try_begin_run(None, "retry work"))
        .await
        .unwrap()
        .unwrap();
    let goal = parts
        .service
        .create_direct_goal("finish later", None)
        .await
        .unwrap();
    assert!(
        parts
            .service
            .finish_run_once(
                &run.run_id,
                RunOutcome::Failed(
                    crate::run_failure::RunFailure {
                        kind: crate::run_failure::RunFailureKind::Transport,
                        phase: crate::run_failure::RunFailurePhase::Stream,
                        transient: true,
                        partial_output: Default::default(),
                        attempt_count: 1,
                        http_status: None,
                        retry_after_ms: Some(60_000),
                        summary: "controlled retry selection".into(),
                        diagnostic: "typed lifecycle fixture, not provider classifier evidence"
                            .into(),
                        recovery_action: crate::run_failure::RecoveryAction::AutomaticRetry,
                    },
                    None
                )
            )
            .await
    );
    let selection = parts
        .service
        .select_next_direct_inbox_item()
        .await
        .unwrap()
        .disposition;
    assert_eq!(selection, ContinuationDisposition::RetryScheduled);
    let metadata = owner
        .read_attention_metadata(Some("session".into()))
        .await
        .unwrap()
        .remove(0);
    let stored = metadata.goal.unwrap();
    assert_eq!(stored.identity.id, goal.goal_id);
    assert!(stored.retry_scheduled);
    assert_eq!(stored.last_run.as_deref(), Some(run.run_id.as_str()));
    // Factory control: use the owner's actual retry selection and exact durable
    // goal identity with an acknowledged-success input, never a fake SettledWork.
    // This is not an end-to-end successful model settlement or OS-delivery claim.
    parts.service.publish_attention_completion(
        &run.run_id,
        true,
        GoalAttentionSettlement {
            known: true,
            goal: Some(stored.identity.clone()),
        },
        selection,
    );
    let before = observer.0.lock().unwrap().last().unwrap().clone();
    assert_eq!(before.operation, AttentionOperation::Idle);
    assert_eq!(
        before.settled.as_ref().unwrap().disposition,
        SettledWorkDisposition::Continuing
    );
    assert!(operation_changed(&parts.service.attention, Some("session"), None).is_none());
    let replacement = Arc::new(Observer::default());
    let registration = parts
        .service
        .install_attention_observer(replacement.clone())
        .unwrap();
    let after = replacement.0.lock().unwrap().last().unwrap().clone();
    let unchanged = owner
        .load_session_goal("session".into())
        .await
        .unwrap()
        .unwrap();
    parts.service.remove_attention_observer(registration);
    parts.service.stop_run_admission().await.unwrap();
    assert!(parts
        .service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_none());
    owner.shutdown().await.unwrap();
    drop(parts);
    drop(owner);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    assert_eq!(before.settled, after.settled);
    assert_eq!(before.epoch, after.epoch);
    assert_eq!(unchanged.goal_id, stored.identity.id);
    assert_eq!(
        u64::try_from(unchanged.version).unwrap(),
        stored.identity.version
    );
    assert_eq!(unchanged.status, crate::store::GoalStatus::Active);
}
