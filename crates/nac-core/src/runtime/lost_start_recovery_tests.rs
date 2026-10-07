//! Real accepted-start loss, ownership and prompt-commit recovery contracts.
use super::run_admission_tests::{build, count, stored};
use super::*;
use crate::sessions::SessionBehavior;
use crate::store::{RuntimeRunStart, TranscriptLogWriter};
use crate::types::Message;

async fn accepted_start(
    fixture: &Fixture,
    snapshot: &crate::sessions::SessionSnapshot,
    guard: &Arc<ManagedRuntimeLeaseGuard>,
    original: &mut crate::runtime::RuntimeRunAdmission,
) -> (
    RuntimeRunStart,
    Arc<crate::sessions::SessionOperationLease>,
    TranscriptLogWriter,
) {
    let lease = Arc::new(original.operation_lease.take().unwrap());
    let selected = RuntimeRunStart {
        session_id: snapshot.session_id.clone(),
        run_id: Uuid::new_v4().to_string(),
        behavior: snapshot.behavior,
        config_version: snapshot.config_version,
        managed_execution_mode: (snapshot.behavior == SessionBehavior::Orchestrator)
            .then_some(crate::store::ManagedOrchestratorExecutionMode::Background),
        child_execution_mode: None,
        started_at_epoch_ms: 10,
        goal_continuation: false,
        identity: guard.binding().unwrap().identity,
    };
    let plan = selected.clone();
    let path = fixture.path.clone();
    let retained = Arc::clone(&lease);
    let current = guard.mutation_admission();
    let checking = Arc::clone(guard);
    let initial: Arc<crate::store::MutationAdmission> =
        Arc::new(move || checking.check_initial_admission_now());
    let writer = crate::store::spawn_blocking_store_caller(move || {
        crate::store::commit_runtime_run_start(&path, &plan, &retained, &current, &initial)
    })
    .await
    .unwrap()
    .unwrap();
    (selected, lease, writer)
}

fn phase(fixture: &Fixture, run_id: &str) -> String {
    rusqlite::Connection::open(&fixture.path)
        .unwrap()
        .query_row(
            "SELECT phase FROM runtime_run_starts WHERE run_id = ?1",
            [run_id],
            |row| row.get(0),
        )
        .unwrap()
}

async fn reconcile(
    fixture: &Fixture,
    lease: &Arc<crate::sessions::SessionOperationLease>,
    admission: Arc<crate::store::MutationAdmission>,
) -> anyhow::Result<Vec<String>> {
    let path = fixture.path.clone();
    let session = lease_session(fixture);
    let lease = Arc::clone(lease);
    crate::store::spawn_blocking_store_caller(move || {
        crate::store::reconcile_runtime_run_starts(&path, &session, &lease, &admission)
    })
    .await
    .unwrap()
}

fn lease_session(fixture: &Fixture) -> String {
    rusqlite::Connection::open(&fixture.path)
        .unwrap()
        .query_row(
            "SELECT session_id FROM runtime_run_starts LIMIT 1",
            [],
            |row| row.get(0),
        )
        .unwrap()
}

#[tokio::test]
async fn runtime_lost_start_process_helper() {
    let Some(path) = std::env::var_os("NAC_TEST_NATIVE_LOST_START_PATH") else {
        return;
    };
    let path = PathBuf::from(path);
    let session = std::env::var("NAC_TEST_NATIVE_LOST_START_SESSION").unwrap();
    let fixture = Fixture {
        store: StoreCoordinator::acquire(&path).unwrap(),
        path,
    };
    let _home = ConstructionHome::new(&fixture);
    let snapshot = fixture.store.load_session(session).await.unwrap();
    let guard = fixture.guard(20_000).await;
    let (_parts, mut original) = build(&fixture, &snapshot, &guard).await;
    let (plan, _lease, _writer) = accepted_start(&fixture, &snapshot, &guard, &mut original).await;
    assert_eq!(phase(&fixture, &plan.run_id), "pending");
    // Actual process exit deliberately loses delivery and skips Rust drops
    // while the OS session lease is held. No prompt/model call was launched.
    std::process::exit(0);
}

#[tokio::test]
async fn runtime_lost_start_process_exit_releases_owner_and_preserves_immutable_ack() {
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
            "retained objective".into(),
            None,
            None,
        )
        .await
        .unwrap();
    fixture.store.shutdown().await.unwrap();
    let mut child = tokio::process::Command::new(std::env::current_exe().unwrap());
    child.args(["--exact", "runtime::managed_runtime_lease::tests::lost_start_recovery_tests::runtime_lost_start_process_helper", "--nocapture"])
        .env("NAC_TEST_NATIVE_LOST_START_PATH", &fixture.path)
        .env("NAC_TEST_NATIVE_LOST_START_SESSION", &snapshot.session_id)
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(10), child.output())
        .await
        .unwrap()
        .unwrap();
    assert!(
        output.status.success(),
        "{}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    let fixture = Fixture {
        path: fixture.path.clone(),
        store: StoreCoordinator::acquire(&fixture.path).unwrap(),
    };
    let (operation_id, run_id): (String, String) = rusqlite::Connection::open(&fixture.path)
        .unwrap()
        .query_row(
            "SELECT operation_id, run_id FROM runtime_run_starts WHERE session_id = ?1",
            [&snapshot.session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    let identity = crate::store::ManagedRuntimeOperationIdentity {
        operation_id: operation_id.parse().unwrap(),
        full_input_sha256: [7; 32],
    };
    let ack = fixture
        .store
        .read_managed_runtime_operation(identity.clone())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        ack.observation,
        Some(crate::store::ManagedRuntimeObservation::Run {
            session_id: snapshot.session_id.parse().unwrap(),
            run_id: run_id.parse().unwrap(),
        })
    );
    assert_eq!(phase(&fixture, &run_id), "pending");
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    let fresh = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &fresh).await;
    assert_eq!(phase(&fixture, &run_id), "abandoned");
    let recovered = fixture
        .store
        .load_session_goal(snapshot.session_id.clone())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovered.status, goal.status);
    assert_eq!(recovered.objective, goal.objective);
    assert_eq!(recovered.tokens_used, goal.tokens_used);
    assert_eq!(recovered.time_used_ms, goal.time_used_ms);
    assert!(recovered.accounting_run_id.is_none());
    assert!(fixture
        .store
        .load_run_recovery(snapshot.session_id.clone())
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        fixture
            .store
            .load_session(snapshot.session_id.clone())
            .await
            .unwrap()
            .messages
            .len(),
        1
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(
        fixture
            .store
            .read_managed_runtime_operation(identity.clone())
            .await
            .unwrap()
            .unwrap(),
        ack
    );
    assert!(
        matches!(fixture.store.record_managed_runtime_operation(identity).await.unwrap(),
        crate::store::ManagedRuntimeRecordOutcome::AlreadyRecorded(retained) if retained == ack)
    );
    assert!(!parts.service.has_active_operation());
    drop(original);
    drop(parts);
    drop(fresh);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_lost_start_prompt_commit_retains_normal_recovery_even_after_lost_reply() {
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
    let (parts, mut original) = build(&fixture, &snapshot, &guard).await;
    let (plan, lease, writer) = accepted_start(&fixture, &snapshot, &guard, &mut original).await;
    writer.lose_next_append_ack_for_test();
    let run = plan.run_id.clone();
    let session = snapshot.session_id.clone();
    let result = crate::store::spawn_blocking_store_caller(move || {
        writer.append_run_prompt(
            &session,
            1,
            &Message::User {
                content: "committed prompt".into(),
            },
            &run,
        )
    })
    .await
    .unwrap();
    assert!(result.is_err());
    assert_eq!(phase(&fixture, &plan.run_id), "prompted");
    let restored = reconcile(&fixture, &lease, Arc::new(|| Ok(())))
        .await
        .unwrap();
    assert!(restored.is_empty());
    let recovery = fixture
        .store
        .load_run_recovery(snapshot.session_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovery.run_id, plan.run_id);
    assert_eq!(recovery.status, crate::store::RunRecoveryStatus::Active);
    drop(lease);
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_lost_start_final_recovery_denial_rolls_back_goal_and_marker() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    fixture
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
    let (plan, lease, writer) = accepted_start(&fixture, &snapshot, &guard, &mut original).await;
    let before = fixture
        .store
        .load_session_goal(snapshot.session_id.clone())
        .await
        .unwrap();
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let checking = Arc::clone(&guard);
    let admission: Arc<crate::store::MutationAdmission> = Arc::new(move || {
        if counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 2 {
            checking.deny_now();
        }
        checking.check_now()
    });
    assert!(reconcile(&fixture, &lease, admission).await.is_err());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 3);
    assert_eq!(
        fixture
            .store
            .load_session_goal(snapshot.session_id.clone())
            .await
            .unwrap(),
        before
    );
    assert_eq!(phase(&fixture, &plan.run_id), "pending");
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    drop(writer);
    drop(lease);
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_lost_start_distinct_relationships_settle_once_without_prompt_or_replay() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    for managed in [false, true] {
        let fixture = Fixture::new();
        let _home = ConstructionHome::new(&fixture);
        let behavior = if managed {
            SessionBehavior::Orchestrator
        } else {
            SessionBehavior::Direct
        };
        let snapshot = stored(&fixture, behavior, "https://api.openai.com/v1").await;
        let mut parent = construction_snapshot();
        parent.session_id = Uuid::new_v4().to_string();
        parent.behavior = if managed {
            SessionBehavior::DirectWithOrchestrator
        } else {
            SessionBehavior::Direct
        };
        fixture.store.create_session(parent.clone()).await.unwrap();
        if managed {
            fixture
                .store
                .create_managed_orchestrator_relationship(
                    parent.session_id.clone(),
                    snapshot.session_id.clone(),
                    "managed result".into(),
                )
                .await
                .unwrap();
        } else {
            fixture
                .store
                .create_traditional_child_relationship(
                    parent.session_id.clone(),
                    snapshot.session_id.clone(),
                    "general".into(),
                    "child result".into(),
                )
                .await
                .unwrap();
        }
        let guard = fixture.guard(20_000).await;
        let (parts, mut original) = build(&fixture, &snapshot, &guard).await;
        let (plan, lease, writer) =
            accepted_start(&fixture, &snapshot, &guard, &mut original).await;
        let ack = fixture
            .store
            .read_managed_runtime_operation(plan.identity.clone())
            .await
            .unwrap();
        assert_eq!(
            reconcile(&fixture, &lease, Arc::new(|| Ok(())))
                .await
                .unwrap(),
            vec![plan.run_id.clone()]
        );
        assert!(reconcile(&fixture, &lease, Arc::new(|| Ok(())))
            .await
            .unwrap()
            .is_empty());
        assert_eq!(phase(&fixture, &plan.run_id), "abandoned");
        let inbox = fixture
            .store
            .list_session_inbox(parent.session_id)
            .await
            .unwrap();
        assert_eq!(inbox.len(), 1);
        assert!(inbox[0].content.contains("interrupted"));
        if managed {
            let result = fixture
                .store
                .load_managed_orchestrator(snapshot.session_id.clone())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                result.status,
                crate::store::ManagedOrchestratorStatus::Interrupted
            );
            assert_eq!(result.generation, 1);
            assert_eq!(result.run_id.as_deref(), Some(plan.run_id.as_str()));
        } else {
            let result = fixture
                .store
                .load_traditional_child(snapshot.session_id.clone())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                result.status,
                crate::store::TraditionalChildStatus::Interrupted
            );
            assert_eq!(result.generation, 1);
            assert_eq!(result.run_id.as_deref(), Some(plan.run_id.as_str()));
        }
        assert!(fixture
            .store
            .load_run_recovery(snapshot.session_id.clone())
            .await
            .unwrap()
            .is_none());
        assert_eq!(count(&fixture, &snapshot.session_id), 1);
        assert_eq!(
            fixture
                .store
                .read_managed_runtime_operation(plan.identity)
                .await
                .unwrap(),
            ack
        );
        drop(writer);
        drop(lease);
        drop(original);
        drop(parts);
        drop(guard);
        fixture.finish().await;
    }
}

#[tokio::test]
async fn runtime_lost_start_same_run_uuid_in_newer_relationship_generation_is_untouched() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    let mut parent = construction_snapshot();
    parent.session_id = Uuid::new_v4().to_string();
    parent.behavior = SessionBehavior::Direct;
    fixture.store.create_session(parent.clone()).await.unwrap();
    fixture
        .store
        .create_traditional_child_relationship(
            parent.session_id.clone(),
            snapshot.session_id.clone(),
            "general".into(),
            "child".into(),
        )
        .await
        .unwrap();
    let guard = fixture.guard(20_000).await;
    let (parts, mut original) = build(&fixture, &snapshot, &guard).await;
    let (plan, lease, writer) = accepted_start(&fixture, &snapshot, &guard, &mut original).await;
    fixture
        .store
        .settle_traditional_child_run(
            snapshot.session_id.clone(),
            plan.run_id.clone(),
            crate::store::TraditionalChildTerminal {
                status: crate::store::TraditionalChildStatus::Interrupted,
                report: None,
                failure: None,
                change_summary: None,
                verification_summary: None,
            },
        )
        .await
        .unwrap();
    let newer = fixture
        .store
        .begin_traditional_child_run(
            snapshot.session_id.clone(),
            plan.run_id.clone(),
            crate::store::TraditionalChildExecutionMode::Background,
        )
        .await
        .unwrap();
    assert_eq!(newer.generation, 2);
    let inbox = fixture
        .store
        .list_session_inbox(parent.session_id.clone())
        .await
        .unwrap();
    assert_eq!(
        reconcile(&fixture, &lease, Arc::new(|| Ok(())))
            .await
            .unwrap(),
        vec![plan.run_id.clone()]
    );
    assert_eq!(
        fixture
            .store
            .load_traditional_child(snapshot.session_id.clone())
            .await
            .unwrap(),
        Some(newer)
    );
    assert_eq!(
        fixture
            .store
            .list_session_inbox(parent.session_id)
            .await
            .unwrap(),
        inbox
    );
    assert_eq!(phase(&fixture, &plan.run_id), "abandoned");
    drop(writer);
    drop(lease);
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_lost_start_changed_goal_revision_preserves_unknown_claim() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    fixture
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
    let (plan, lease, writer) = accepted_start(&fixture, &snapshot, &guard, &mut original).await;
    rusqlite::Connection::open(&fixture.path).unwrap().execute("UPDATE session_goals SET status = 'paused', version = version + 1 WHERE session_id = ?1", [&snapshot.session_id]).unwrap();
    let edited = fixture
        .store
        .load_session_goal(snapshot.session_id.clone())
        .await
        .unwrap();
    let error = reconcile(&fixture, &lease, Arc::new(|| Ok(())))
        .await
        .unwrap_err();
    assert!(format!("{error:#}").contains("ownership uncertain"));
    assert_eq!(
        fixture
            .store
            .load_session_goal(snapshot.session_id.clone())
            .await
            .unwrap(),
        edited
    );
    assert_eq!(phase(&fixture, &plan.run_id), "pending");
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    drop(writer);
    drop(lease);
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_lost_start_queued_recovery_expiry_preserves_original_goal_and_marker() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let snapshot = stored(
        &fixture,
        SessionBehavior::Direct,
        "https://api.openai.com/v1",
    )
    .await;
    fixture
        .store
        .create_session_goal(
            snapshot.session_id.clone(),
            "retained goal".into(),
            None,
            None,
        )
        .await
        .unwrap();
    let guard = fixture.guard(1_500).await;
    let (parts, mut original) = build(&fixture, &snapshot, &guard).await;
    let (plan, lease, writer) = accepted_start(&fixture, &snapshot, &guard, &mut original).await;
    let goal = fixture
        .store
        .load_session_goal(snapshot.session_id.clone())
        .await
        .unwrap();
    let (release, blocked) = block(&fixture.store).await;
    let path = fixture.path.clone();
    let session = snapshot.session_id.clone();
    let held = Arc::clone(&lease);
    let admission = guard.mutation_admission();
    let recovering = crate::store::spawn_blocking_store_caller(move || {
        crate::store::reconcile_runtime_run_starts(&path, &session, &held, &admission)
    });
    tokio::pin!(recovering);
    tokio::select! {
        _ = &mut recovering => panic!("blocked recovery unexpectedly finished"),
        _ = queued(&fixture.store, 1) => {}
    }
    tokio::time::timeout(Duration::from_secs(3), guard.observe_denial())
        .await
        .unwrap();
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    assert!(recovering.await.unwrap().is_err());
    assert_eq!(
        fixture
            .store
            .load_session_goal(snapshot.session_id.clone())
            .await
            .unwrap(),
        goal
    );
    assert_eq!(phase(&fixture, &plan.run_id), "pending");
    drop(writer);
    drop(lease);
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}
