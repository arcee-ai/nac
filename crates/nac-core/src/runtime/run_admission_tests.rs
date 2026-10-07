//! Actual selected original runs with disposable stores and loopback provider I/O.
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::sessions::SessionBehavior;
use crate::types::Message;

pub(super) async fn stored(
    fixture: &Fixture,
    behavior: SessionBehavior,
    base_url: &str,
) -> crate::sessions::SessionSnapshot {
    let mut snapshot = construction_snapshot();
    snapshot.cwd = fixture.path.parent().unwrap().to_path_buf();
    snapshot.behavior = behavior;
    snapshot.base_url = base_url.to_string();
    snapshot.allow_insecure_http = true;
    snapshot.reasoning_effort = None;
    snapshot.messages = vec![Message::User {
        content: "retained input".into(),
    }];
    fixture
        .store
        .create_session(snapshot.clone())
        .await
        .unwrap();
    snapshot
}

pub(super) async fn build(
    fixture: &Fixture,
    snapshot: &crate::sessions::SessionSnapshot,
    guard: &Arc<ManagedRuntimeLeaseGuard>,
) -> (
    crate::session_service::SessionServiceParts,
    crate::runtime::RuntimeRunAdmission,
) {
    let options = construction_options(fixture);
    let (built, original) = crate::runtime::build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        &snapshot.session_id,
        &crate::runtime::NacConfig::default(),
        snapshot.cwd.clone(),
        None,
        crate::runtime::ResumeModelOptions {
            trusted_api_key_file: options.model.trusted_api_key_file,
            ..Default::default()
        },
        Some(Arc::clone(guard)),
    )
    .await
    .unwrap();
    (
        crate::session_service::SessionService::from_orchestrator_run_config(built),
        original,
    )
}

pub(super) fn count(fixture: &Fixture, session: &str) -> i64 {
    rusqlite::Connection::open(&fixture.path)
        .unwrap()
        .query_row(
            "SELECT COALESCE(run_count, 0) FROM sessions WHERE session_id = ?1",
            [session],
            |row| row.get(0),
        )
        .unwrap()
}

async fn ended(service: &crate::session_service::SessionService) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.has_active_operation() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

fn response() -> String {
    serde_json::json!({"status":"completed", "output":[{"type":"message", "content":[{"type":"output_text", "text":"original result"}]}],
        "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}).to_string()
}

async fn renew_original(
    guard: &Arc<ManagedRuntimeLeaseGuard>,
    native: &crate::store::ManagedRuntimeObservation,
    digest: [u8; 32],
) -> RuntimeLeaseSnapshot {
    let current = guard.snapshot().unwrap();
    let clock = native_clock().unwrap();
    let challenge = RuntimeChallengeSpec {
        channel_id: Uuid::new_v4(),
        challenge_sha256: digest,
        expires_ms: clock.wall_ms() + 1_000,
    };
    let pending = guard
        .challenge_renewal(native.clone(), challenge.clone())
        .await
        .unwrap();
    let receipt = native_clock().unwrap();
    guard
        .consume_renewal(
            pending,
            RuntimeLeaseResponse {
                channel_id: challenge.channel_id,
                challenge_sha256: challenge.challenge_sha256,
                lease: RuntimeLeaseSnapshot {
                    lease_id: current.lease_id,
                    sequence: current.sequence + 1,
                    expires_ms: receipt.wall_ms() + 20_000,
                },
                observed_ms: receipt.wall_ms(),
            },
            receipt,
        )
        .await
        .unwrap()
}

async fn original_positive(behavior: SessionBehavior, cross_initial: bool) {
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let (observed_tx, observed_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json("200 OK", response())],
        move |_, _| {
            observed_tx.send(()).unwrap();
            release_rx.recv_timeout(Duration::from_secs(6)).unwrap();
        },
    );
    let snapshot = stored(&fixture, behavior, &server.base_url).await;
    let guard = if cross_initial {
        ManagedRuntimeLeaseGuard::new(
            Arc::clone(&fixture.store),
            fixture.active_with_original_lifetime(20_000, 2_000).await,
        )
        .await
        .unwrap()
    } else {
        fixture.guard(20_000).await
    };
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let handle = parts
        .service
        .submit_runtime_original(original, "original input".into())
        .await
        .unwrap();
    tokio::task::spawn_blocking(move || observed_rx.recv_timeout(Duration::from_secs(3)).unwrap())
        .await
        .unwrap();
    let native = parts
        .service
        .observe_runtime_original_run(&handle.run_id, &guard)
        .unwrap();
    assert_eq!(
        native,
        crate::store::ManagedRuntimeObservation::Run {
            session_id: snapshot.session_id.parse().unwrap(),
            run_id: handle.run_id.as_str().parse().unwrap(),
        }
    );
    let identity = guard.binding().unwrap().identity;
    assert_eq!(
        fixture
            .store
            .read_managed_runtime_operation(identity.clone())
            .await
            .unwrap()
            .unwrap()
            .observation,
        Some(native.clone())
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert!(parts
        .service
        .try_submit_prompt("unqualified successor".into())
        .is_err());
    let foreign = fixture.guard(20_000).await;
    assert!(parts
        .service
        .observe_runtime_original_run(&handle.run_id, &foreign)
        .is_err());
    foreign.deny_now();
    if cross_initial {
        assert_eq!(renew_original(&guard, &native, [15; 32]).await.sequence, 2);
        let remaining =
            guard.binding().unwrap().original_expires_ms - native_clock().unwrap().wall_ms();
        if remaining > 0 {
            tokio::time::sleep(Duration::from_millis(remaining as u64 + 20)).await;
        }
        assert!(guard.check_initial_admission_now().is_err());
        assert!(
            guard.check_now().is_ok(),
            "initial HTTP expiry is not an active-run cutoff"
        );
        assert_eq!(renew_original(&guard, &native, [16; 32]).await.sequence, 3);
    }
    release_tx.send(()).unwrap();
    ended(&parts.service).await;
    assert_eq!(
        server.finish().len(),
        1,
        "one original reaches one provider attempt"
    );
    assert!(
        guard.check_now().is_err(),
        "settlement closes the original even before expiry"
    );
    assert!(parts
        .service
        .observe_runtime_original_run(&handle.run_id, &guard)
        .is_err());
    assert!(parts
        .service
        .try_submit_prompt("old lease successor".into())
        .is_err());
    assert_eq!(
        fixture
            .store
            .read_managed_runtime_operation(identity)
            .await
            .unwrap()
            .unwrap()
            .observation,
        Some(native)
    );
    let messages = parts.service.messages_snapshot().await.unwrap();
    assert_eq!(
        messages
            .iter()
            .filter(|m| matches!(m, Message::User{content} if content == "original input"))
            .count(),
        1
    );
    assert!(
        matches!(messages.last(), Some(Message::Assistant{content:Some(text),..}) if text == "original result"),
        "{messages:?}"
    );
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_run_actual_positive_keeps_same_original_across_all_behaviors() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    for behavior in [
        SessionBehavior::Orchestrator,
        SessionBehavior::Direct,
        SessionBehavior::DirectWithOrchestrator,
    ] {
        original_positive(behavior, false).await;
    }
}

#[tokio::test]
async fn runtime_run_active_original_renews_and_completes_after_initial_http_expiry() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    original_positive(SessionBehavior::Direct, true).await;
}

#[tokio::test]
async fn runtime_run_expired_pending_admission_preserves_prompt_count_and_original_barrier() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    let guard = fixture.guard(1_500).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let before = fixture
        .store
        .load_session(snapshot.session_id.clone())
        .await
        .unwrap();
    let identity = guard.binding().unwrap().identity;
    let (release, blocked) = block(&fixture.store).await;
    let service = parts.service.clone();
    let submitting = tokio::spawn(async move {
        service
            .submit_runtime_original(original, "must not append".into())
            .await
    });
    queued(&fixture.store, 1).await;
    tokio::time::timeout(Duration::from_secs(3), guard.observe_denial())
        .await
        .unwrap();
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    assert!(submitting.await.unwrap().is_err());
    assert!(!parts.service.has_active_operation());
    assert_eq!(count(&fixture, &snapshot.session_id), 0);
    assert_eq!(
        format!("{before:?}"),
        format!(
            "{:?}",
            fixture
                .store
                .load_session(snapshot.session_id.clone())
                .await
                .unwrap()
        )
    );
    assert!(fixture
        .store
        .read_managed_runtime_operation(identity)
        .await
        .unwrap()
        .unwrap()
        .observation
        .is_none());
    assert!(fixture
        .store
        .load_run_recovery(snapshot.session_id)
        .await
        .unwrap()
        .is_none());
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_run_rejects_same_session_agent_from_unprotected_construction() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    let guard = fixture.guard(20_000).await;
    let (paired, original) = build(&fixture, &snapshot, &guard).await;
    let options = construction_options(&fixture);
    let (legacy, _, lease) = crate::runtime::build_resume_config_for_session_attachment(
        fixture.path.clone(),
        &snapshot.session_id,
        &crate::runtime::NacConfig::default(),
        snapshot.cwd.clone(),
        None,
        crate::runtime::ResumeModelOptions {
            trusted_api_key_file: options.model.trusted_api_key_file,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(lease.is_none());
    let substitute = crate::session_service::SessionService::from_orchestrator_run_config(
        legacy.with_required_runtime_effects(),
    );
    let error = substitute
        .service
        .submit_runtime_original(original, "must not execute".into())
        .await
        .err()
        .unwrap();
    assert!(
        matches!(
            error.downcast_ref::<crate::session_service::SessionSubmitError>(),
            Some(crate::session_service::SessionSubmitError::Coordination {
                message: crate::session_service::SessionCoordinationError::Store { detail },
            }) if detail.contains("construction")
        ),
        "{error:?}"
    );
    assert!(!substitute.service.has_active_operation());
    assert!(!paired.service.has_active_operation());
    assert_eq!(count(&fixture, &snapshot.session_id), 0);
    assert!(guard.check_now().is_err());
    drop(substitute);
    drop(paired);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_run_cannot_upgrade_an_original_session_acknowledgement() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    let guard = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let identity = guard.binding().unwrap().identity;
    let native = crate::store::ManagedRuntimeObservation::Session {
        session_id: snapshot.session_id.parse().unwrap(),
    };
    fixture
        .store
        .acknowledge_managed_runtime_operation(identity.clone(), native.clone())
        .await
        .unwrap();
    assert!(parts
        .service
        .submit_runtime_original(original, "must not execute".into())
        .await
        .is_err());
    assert!(!parts.service.has_active_operation());
    assert_eq!(count(&fixture, &snapshot.session_id), 0);
    assert_eq!(
        fixture
            .store
            .read_managed_runtime_operation(identity)
            .await
            .unwrap()
            .unwrap()
            .observation,
        Some(native)
    );
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_run_atomic_final_check_rolls_back_goal_count_writer_and_ack() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    let goal = fixture
        .store
        .create_session_goal(
            snapshot.session_id.clone(),
            "retained goal".into(),
            None,
            None,
        )
        .await
        .unwrap();
    let guard = fixture.guard(20_000).await;
    let (parts, mut original) = build(&fixture, &snapshot, &guard).await;
    let lease = Arc::new(original.operation_lease.take().unwrap());
    let identity = guard.binding().unwrap().identity;
    let plan = crate::store::RuntimeRunStart {
        session_id: snapshot.session_id.clone(),
        run_id: Uuid::new_v4().to_string(),
        behavior: SessionBehavior::Direct,
        config_version: snapshot.config_version,
        managed_execution_mode: None,
        child_execution_mode: None,
        started_at_epoch_ms: 0,
        goal_continuation: false,
        identity: identity.clone(),
    };
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let selected = Arc::clone(&guard);
    let counted = Arc::clone(&calls);
    let initial: Arc<crate::store::MutationAdmission> = Arc::new(move || {
        if counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1 == 3 {
            selected.deny_now();
        }
        selected.check_initial_admission_now()
    });
    let current = guard.mutation_admission();
    let path = fixture.path.clone();
    let result = crate::store::spawn_blocking_store_caller(move || {
        crate::store::commit_runtime_run_start(&path, &plan, &lease, &current, &initial)
    })
    .await
    .unwrap();
    assert!(result.is_err());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 3);
    assert_eq!(count(&fixture, &snapshot.session_id), 0);
    assert_eq!(
        fixture
            .store
            .load_session_goal(snapshot.session_id.clone())
            .await
            .unwrap(),
        Some(goal)
    );
    assert!(fixture
        .store
        .read_managed_runtime_operation(identity)
        .await
        .unwrap()
        .unwrap()
        .observation
        .is_none());
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_run_cancellation_rejects_cached_renewal_while_public_run_remains_visible() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let (observed_tx, observed_rx) = std::sync::mpsc::channel();
    let (release_model_tx, release_model_rx) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![ScriptedResponse::json("200 OK", response()).drop_connection()],
        move |_, _| {
            observed_tx.send(()).unwrap();
            release_model_rx
                .recv_timeout(Duration::from_secs(6))
                .unwrap();
        },
    );
    let snapshot = stored(&fixture, SessionBehavior::Direct, &server.base_url).await;
    let guard = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    let run = parts
        .service
        .submit_runtime_original(original, "original input".into())
        .await
        .unwrap();
    tokio::task::spawn_blocking(move || observed_rx.recv_timeout(Duration::from_secs(3)).unwrap())
        .await
        .unwrap();
    let native = parts
        .service
        .observe_runtime_original_run(&run.run_id, &guard)
        .unwrap();
    let old = guard.snapshot().unwrap();
    let clock = native_clock().unwrap();
    let challenge = RuntimeChallengeSpec {
        channel_id: Uuid::new_v4(),
        challenge_sha256: [13; 32],
        expires_ms: clock.wall_ms() + 1_000,
    };
    let pending = guard
        .challenge_renewal(native.clone(), challenge.clone())
        .await
        .unwrap();
    let response_clock = native_clock().unwrap();
    let response = RuntimeLeaseResponse {
        channel_id: challenge.channel_id,
        challenge_sha256: challenge.challenge_sha256,
        lease: RuntimeLeaseSnapshot {
            lease_id: old.lease_id,
            sequence: 2,
            expires_ms: response_clock.wall_ms() + 20_000,
        },
        observed_ms: response_clock.wall_ms(),
    };
    let (release_store, blocked) = block(&fixture.store).await;
    let service = parts.service.clone();
    let id = run.run_id.clone();
    let cancelling = tokio::spawn(async move { service.request_cancel(&id).await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while guard.check_now().is_ok() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(
        parts.service.active_run().is_some(),
        "public projection can remain visible during owned settlement"
    );
    assert!(parts
        .service
        .observe_runtime_original_run(&run.run_id, &guard)
        .is_err());
    assert!(guard
        .challenge_renewal(
            native,
            RuntimeChallengeSpec {
                channel_id: Uuid::new_v4(),
                challenge_sha256: [14; 32],
                expires_ms: response_clock.wall_ms() + 1_000
            }
        )
        .await
        .is_err());
    assert!(guard
        .consume_renewal(pending, response, response_clock)
        .await
        .is_err());
    release_store.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    release_model_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), cancelling)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    ended(&parts.service).await;
    assert_eq!(server.finish().len(), 1);
    assert_eq!(
        guard.snapshot().unwrap().sequence,
        1,
        "late response cannot publish renewal after cancellation"
    );
    drop(parts);
    drop(guard);
    fixture.finish().await;
}
