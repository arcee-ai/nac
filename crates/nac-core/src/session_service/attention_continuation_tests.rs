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

// Expected named RED is mechanism evidence, never a Ready repair or attribution
// of the historical CI writer. No shipping/test-support policy is changed.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn original_settlement_caller_cannot_recreate_store_after_typed_drain() {
    assert!(
        std::env::var_os("NAC_HUMAN_CRASH_STORE").is_none(),
        "Characterization refuses an externally selected crash store"
    );
    let root = std::env::temp_dir().join(format!(
        "nac_original_settlement_tail_{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir(&root).expect("fresh owned characterization root");

    // A setup panic must release the response gate and join the original
    // provider worker too. Never delete this root from Drop: an unobserved
    // caller/task closure retains it, rather than fabricating cleanup success.
    struct HeldProvider {
        server: Option<ScriptedServer>,
        release: Option<std::sync::mpsc::Sender<()>>,
    }
    impl HeldProvider {
        fn release(&mut self) -> std::result::Result<(), std::sync::mpsc::SendError<()>> {
            self.release.take().map_or(Ok(()), |sender| sender.send(()))
        }
        fn finish(&mut self) -> std::thread::Result<Vec<crate::model::test_http::CapturedRequest>> {
            let server = self.server.take().expect("original provider worker exists");
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| server.finish()))
        }
    }
    impl Drop for HeldProvider {
        fn drop(&mut self) {
            let _ = self.release();
            if let Some(server) = self.server.take() {
                let joined = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    server.stop_and_finish()
                }));
                if let Err(error) = joined {
                    if std::thread::panicking() {
                        use std::io::Write;
                        let _ = writeln!(
                            std::io::stderr().lock(),
                            "original provider cleanup also failed: {error:?}"
                        );
                    } else {
                        std::panic::resume_unwind(error);
                    }
                }
            }
        }
    }
    let (release_model, wait_model) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json(
            "200 OK",
            serde_json::json!({
                "status":"completed", "output":[{"type":"message",
                "content":[{"type":"output_text","text":"done"}]}]
            })
            .to_string(),
        )],
        move |_, _| {
            wait_model.recv_timeout(Duration::from_secs(5)).unwrap();
        },
    );
    let mut provider = HeldProvider {
        server: Some(server),
        release: Some(release_model),
    };
    let (parts, path) = crate::session_service::tests::test_direct_active_service_at(
        "session",
        ModelClient::new_for_test_server(provider.server.as_ref().unwrap().base_url.clone()),
        root.join("store.db"),
    );
    let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
    parts
        .service
        .install_attention_observer(Arc::new(Observer::default()))
        .unwrap();
    let run = parts
        .service
        .try_submit_prompt("one original real run".into())
        .unwrap();
    let held = parts
        .service
        .hold_attention_continuation_io_for_test(&run.run_id);
    // Transfer the ORIGINAL unique admission task, bound to the exact run.
    // The control owns its join; no replacement wake/cancel can satisfy it.
    let original = {
        let mut operation = parts.service.active_operation.lock().unwrap();
        match operation.as_mut() {
            Some(ActiveSessionOperation::Run(active)) if active.snapshot.run_id == run.run_id => {
                active.task.take()
            }
            _ => None,
        }
    };
    let Some(mut original) = original else {
        held.release();
        let _ = provider.release();
        let _ = provider.finish();
        panic!(
            "original run task unavailable; retain owned root {}",
            root.display()
        );
    };
    let released_model = provider.release();
    let entered = held.entered().await;
    let active_at_hold = parts.service.has_active_operation();
    let stopped =
        tokio::time::timeout(Duration::from_secs(5), parts.service.stop_run_admission()).await;
    let drained = tokio::time::timeout(Duration::from_secs(5), owner.shutdown()).await;
    drop(owner);
    let pending_after_drain = !original.is_finished();
    // Preserve the original DB under this exclusively owned UUID root. Removing
    // only the selected pathname by rename models the old unlink frontier;
    // there is no early root deletion and no fabricated SQLite journal.
    let preserved = root.join("preserved-original.db");
    let original_bytes = std::fs::read(&path);
    let moved = if entered.is_ok()
        && original_bytes.is_ok()
        && matches!(&stopped, Ok(Ok(())))
        && matches!(&drained, Ok(Ok(())))
        && !active_at_hold
        && pending_after_drain
    {
        std::fs::rename(&path, &preserved)
    } else {
        Err(std::io::Error::other(
            "exact caller/drain frontier unavailable; original DB retained",
        ))
    };
    held.release();
    let returned = held.returned().await;
    // Borrow the ORIGINAL handle so timeout cannot silently detach it. A
    // timeout is missing closure evidence, not a cancellation-based substitute.
    let joined = tokio::time::timeout(Duration::from_secs(5), &mut original).await;
    let recreated = path.try_exists();
    let original_preserved = preserved.try_exists();
    let preserved_bytes = std::fs::read(&preserved);
    let provider_requests = provider.finish();
    drop(held);
    drop(parts);
    if returned.is_err()
        || !matches!(&joined, Ok(Ok(())))
        || !matches!(&stopped, Ok(Ok(())))
        || !matches!(&drained, Ok(Ok(())))
        || provider_requests.is_err()
    {
        panic!(
            "original owner closure unavailable; retain owned root {}",
            root.display()
        );
    }
    let bytes_match = match (&original_bytes, &preserved_bytes) {
        (Ok(before), Ok(after)) => !before.is_empty() && before == after,
        _ => false,
    };
    // Root adjudication: retain the evidence on an invalid causal frontier,
    // even after the original owners have closed. Inspect only held results.
    if released_model.is_err()
        || entered.is_err()
        || moved.is_err()
        || active_at_hold
        || !pending_after_drain
        || !matches!(&original_preserved, Ok(true))
        || !bytes_match
        || provider_requests.as_ref().ok().map(Vec::len) != Some(1)
        || recreated.is_err()
    {
        panic!(
            "unexpected original continuation frontier; retain owned root {} \
             (model_released={}, caller_entered={}, moved={}, active={}, pending={}, \
             original_preserved={:?}, bytes_match={}, model_requests={:?}, recreated={:?})",
            root.display(),
            released_model.is_ok(),
            entered.is_ok(),
            moved.is_ok(),
            active_at_hold,
            pending_after_drain,
            original_preserved.as_ref().ok(),
            bytes_match,
            provider_requests.as_ref().ok().map(Vec::len),
            recreated.as_ref().ok(),
        );
    }
    if matches!(&recreated, Ok(false)) {
        panic!(
            "ORIGINAL_CONTINUATION_MECHANISM_NOT_DEMONSTRATED; retain owned root {}",
            root.display()
        );
    }
    // Only the valid expected frontier reaches ONE strict deletion. Preserve
    // the semantic assertions and exact named RED after observed cleanup.
    std::fs::remove_dir_all(&root).unwrap();
    let root_absent = root.try_exists().map(|exists| !exists);
    // Content-free receipts bind the intended RED to the ORIGINAL owners and
    // physical cleanup; an unrelated failure is not the expected mechanism.
    use std::io::Write;
    let _ = writeln!(
        std::io::stderr().lock(),
        "original-continuation-drain-evidence {}",
        serde_json::json!({
            "session":"session", "run":run.run_id.as_str(), "root":root.to_string_lossy(),
            "caller_entered":entered.is_ok(), "caller_returned":returned.is_ok(),
            "caller_operation_succeeded":returned.as_ref().ok(),
            "original_task_joined":matches!(&joined, Ok(Ok(()))),
            "provider_joined":provider_requests.is_ok(),
            "model_requests":provider_requests.as_ref().ok().map(Vec::len),
            "active_at_hold":active_at_hold, "original_pending_after_drain":pending_after_drain,
            "typed_drain_acknowledged":matches!(&drained, Ok(Ok(()))),
            "old_db_bytes_preserved":bytes_match,
            "selected_path_recreated":recreated.as_ref().ok(),
            "owned_root_absent":root_absent.as_ref().ok(),
            "historical_ci_writer":"unknown",
        })
    );
    released_model.unwrap();
    entered.unwrap();
    stopped.unwrap().unwrap();
    drained.unwrap().unwrap();
    moved.unwrap();
    assert!(
        !active_at_hold && pending_after_drain,
        "original caller must outlive the idle slot/drain"
    );
    assert!(original_preserved.unwrap());
    assert!(root_absent.unwrap());
    assert!(
        bytes_match,
        "preserved original DB bytes must remain unchanged"
    );
    assert_eq!(provider_requests.unwrap().len(), 1);
    assert!(
        !recreated.unwrap(),
        "ORIGINAL_CONTINUATION_RECREATED_STORE_AFTER_DRAIN"
    );
}
