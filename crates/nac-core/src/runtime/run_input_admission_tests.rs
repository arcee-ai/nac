//! Transaction-bound checks for a selected original's configuration and prompt.
use super::run_admission_tests::{build, count, stored};
use super::*;
use crate::sessions::SessionBehavior;
use crate::types::Message;

fn plan(
    snapshot: &crate::sessions::SessionSnapshot,
    guard: &ManagedRuntimeLeaseGuard,
) -> crate::store::RuntimeRunStart {
    crate::store::RuntimeRunStart {
        session_id: snapshot.session_id.clone(),
        run_id: Uuid::new_v4().to_string(),
        behavior: snapshot.behavior,
        config_version: snapshot.config_version,
        managed_execution_mode: None,
        child_execution_mode: None,
        started_at_epoch_ms: 0,
        goal_continuation: false,
        identity: guard.binding().unwrap().identity,
    }
}

#[tokio::test]
async fn runtime_run_changed_configuration_rejects_atomic_start() {
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
    let lease = Arc::new(original.operation_lease.take().unwrap());
    let selected = plan(&snapshot, &guard);
    let identity = selected.identity.clone();
    // Model a peer's committed configuration change after factory selection.
    rusqlite::Connection::open(&fixture.path)
        .unwrap()
        .execute(
            "UPDATE sessions SET config_version = config_version + 1 WHERE session_id = ?1",
            [&snapshot.session_id],
        )
        .unwrap();
    let current = guard.mutation_admission();
    let checking = Arc::clone(&guard);
    let initial: Arc<crate::store::MutationAdmission> =
        Arc::new(move || checking.check_initial_admission_now());
    let path = fixture.path.clone();
    let result = crate::store::spawn_blocking_store_caller(move || {
        crate::store::commit_runtime_run_start(&path, &selected, &lease, &current, &initial)
    })
    .await
    .unwrap();
    assert!(format!("{:#}", result.err().unwrap()).contains("configuration changed"));
    assert_eq!(count(&fixture, &snapshot.session_id), 0);
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
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_run_prompt_final_denial_rolls_back_input_receipt_and_recovery() {
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
    let lease = Arc::new(original.operation_lease.take().unwrap());
    let retained_lease = Arc::clone(&lease);
    let selected = plan(&snapshot, &guard);
    let identity = selected.identity.clone();
    let run_id = selected.run_id.clone();
    let current = guard.mutation_admission();
    let checking = Arc::clone(&guard);
    let initial: Arc<crate::store::MutationAdmission> =
        Arc::new(move || checking.check_initial_admission_now());
    let path = fixture.path.clone();
    let writer = crate::store::spawn_blocking_store_caller(move || {
        crate::store::commit_runtime_run_start(&path, &selected, &lease, &current, &initial)
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    let accepted = fixture
        .store
        .read_managed_runtime_operation(identity.clone())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        accepted.observation,
        Some(crate::store::ManagedRuntimeObservation::Run {
            session_id: snapshot.session_id.parse().unwrap(),
            run_id: run_id.parse().unwrap(),
        })
    );
    let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let checking = Arc::clone(&guard);
    let initial: Arc<crate::store::MutationAdmission> = Arc::new(move || {
        if counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 1 {
            checking.deny_now();
        }
        checking.check_initial_admission_now()
    });
    let writer = writer.with_runtime_run_admission(guard.mutation_admission(), initial);
    let session = snapshot.session_id.clone();
    let result = crate::store::spawn_blocking_store_caller(move || {
        writer.append_run_prompt(
            &session,
            snapshot.messages.len() as u64,
            &Message::User {
                content: "rejected prompt".into(),
            },
            &run_id,
        )
    })
    .await
    .unwrap();
    assert!(result.is_err());
    assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
    assert!(fixture
        .store
        .load_run_recovery(snapshot.session_id.clone())
        .await
        .unwrap()
        .is_none());
    let connection = rusqlite::Connection::open(&fixture.path).unwrap();
    for table in ["thread_events", "transcript_append_receipts"] {
        let rows: i64 = connection
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE session_id = ?1"),
                [&snapshot.session_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 0, "{table}");
    }
    let retained = fixture
        .store
        .load_session(snapshot.session_id.clone())
        .await
        .unwrap()
        .messages;
    assert_eq!(retained.len(), 1);
    assert!(matches!(&retained[0], Message::User { content } if content == "retained input"));
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(
        fixture
            .store
            .read_managed_runtime_operation(identity)
            .await
            .unwrap()
            .unwrap(),
        accepted
    );
    drop(connection);
    drop(retained_lease);
    drop(original);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}
