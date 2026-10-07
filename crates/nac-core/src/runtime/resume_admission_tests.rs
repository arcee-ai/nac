//! Guarded existing-session construction and in-transaction mutation fences.
use super::*;
use crate::types::Message;
use std::sync::atomic::{AtomicUsize, Ordering};

async fn stored(fixture: &Fixture) -> crate::sessions::SessionSnapshot {
    let mut snapshot = construction_snapshot();
    snapshot.cwd = fixture.path.parent().unwrap().to_path_buf();
    snapshot.behavior = crate::sessions::SessionBehavior::Direct;
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

fn row(fixture: &Fixture, session: &str) -> Vec<rusqlite::types::Value> {
    let connection = rusqlite::Connection::open(&fixture.path).unwrap();
    let mut query = connection
        .prepare("SELECT * FROM sessions WHERE session_id = ?1")
        .unwrap();
    let columns = query.column_count();
    query
        .query_row([session], |row| (0..columns).map(|c| row.get(c)).collect())
        .unwrap()
}

#[tokio::test]
async fn runtime_resume_actual_positive_keeps_uuid_row_and_separate_pending_run_admission() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let options = construction_options(&fixture);
    let snapshot = stored(&fixture).await;
    let before = row(&fixture, &snapshot.session_id);
    let guard = fixture.guard(20_000).await;
    let (built, admission) = crate::runtime::build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        &snapshot.session_id,
        &crate::runtime::NacConfig::default(),
        snapshot.cwd.clone(),
        None,
        crate::runtime::ResumeModelOptions {
            trusted_api_key_file: options.model.trusted_api_key_file.clone(),
            ..Default::default()
        },
        Some(Arc::clone(&guard)),
    )
    .await
    .unwrap();
    assert!(Arc::ptr_eq(&admission.guard, &guard));
    assert_eq!(admission.session_id, snapshot.session_id);
    assert!(built.agent.requires_runtime_effects());
    assert!(built
        .client
        .send_turn(Vec::new(), Vec::new())
        .await
        .is_err());
    admission
        .check_initial(&fixture.path, &snapshot.session_id)
        .await
        .unwrap();
    assert!(matches!(
        crate::sessions::SessionOperationLease::try_acquire(&fixture.path, &snapshot.session_id),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert_eq!(row(&fixture, &snapshot.session_id), before);
    assert_eq!(fixture.store.list_sessions().await.unwrap().len(), 1);
    assert!(fixture
        .store
        .load_run_recovery(snapshot.session_id.clone())
        .await
        .unwrap()
        .is_none());
    assert!(crate::runtime::build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        &snapshot.session_id,
        &crate::runtime::NacConfig::default(),
        snapshot.cwd.clone(),
        None,
        Default::default(),
        Some(Arc::clone(&guard)),
    )
    .await
    .is_err());
    assert!(
        guard.check_now().is_ok(),
        "duplicate cannot revoke the admitted original"
    );
    let parts = crate::session_service::SessionService::from_orchestrator_run_config(built);
    assert!(parts
        .service
        .try_submit_prompt("unqualified successor".into())
        .is_err());
    assert!(parts.service.active_operation().is_none());
    drop(admission);
    assert!(guard.check_now().is_err());
    assert_eq!(row(&fixture, &snapshot.session_id), before);
    drop(parts);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_resume_missing_closed_wrong_store_denies_before_lookup_or_credentials() {
    let fixture = Fixture::new();
    let guard = fixture.guard(20_000).await;
    for selected in [None, {
        guard.deny_now();
        Some(Arc::clone(&guard))
    }] {
        let error = crate::runtime::build_resume_config_for_runtime_operation(
            fixture.path.clone(),
            "missing-session",
            &crate::runtime::NacConfig::default(),
            PathBuf::from("/invalid"),
            None,
            Default::default(),
            selected,
        )
        .await
        .err()
        .unwrap();
        assert!(error.to_string().contains("runtime"), "{error:#}");
    }
    let other = Fixture::new();
    let live = other.guard(20_000).await;
    assert!(crate::runtime::build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        "missing-session",
        &crate::runtime::NacConfig::default(),
        PathBuf::from("/invalid"),
        None,
        Default::default(),
        Some(Arc::clone(&live)),
    )
    .await
    .is_err());
    assert!(live.check_now().is_ok());
    assert!(fixture.store.list_sessions().await.unwrap().is_empty());
    other.finish().await;
    fixture.finish().await;
}

async fn active_recovery(fixture: &Fixture, session: &str) -> crate::store::RunRecoveryRecord {
    let writer = crate::store::TranscriptLogWriter::new(&fixture.path).unwrap();
    let session_id = session.to_string();
    // The snapshot contains one retained user message, so the new tail is at 1.
    crate::store::spawn_blocking_store_caller(move || {
        writer.append_run_prompt(
            &session_id,
            1,
            &Message::User {
                content: "previous original prompt".into(),
            },
            "previous-run",
        )
    })
    .await
    .unwrap()
    .unwrap();
    fixture
        .store
        .load_run_recovery(session.to_string())
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn runtime_resume_queued_recovery_rechecks_real_guard_after_expiry() {
    let fixture = Fixture::new();
    let snapshot = stored(&fixture).await;
    let before = active_recovery(&fixture, &snapshot.session_id).await;
    let guard = fixture.guard(700).await;
    let admission = guard.mutation_admission();
    let (release, blocked) = block(&fixture.store).await;
    let owner = Arc::clone(&fixture.store);
    let session = snapshot.session_id.clone();
    let changing = tokio::spawn(async move {
        owner
            .reconcile_active_run_admitted(session, admission)
            .await
    });
    queued(&fixture.store, 1).await;
    tokio::time::timeout(Duration::from_secs(3), guard.observe_denial())
        .await
        .unwrap();
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    assert!(changing.await.unwrap().is_err());
    assert_eq!(
        fixture
            .store
            .load_run_recovery(snapshot.session_id)
            .await
            .unwrap()
            .unwrap(),
        before
    );
    fixture.finish().await;
}

fn close_on_check(
    guard: &Arc<ManagedRuntimeLeaseGuard>,
    which: usize,
) -> (Arc<crate::store::MutationAdmission>, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let counted = Arc::clone(&calls);
    let selected = Arc::clone(guard);
    let check = Arc::new(move || {
        if counted.fetch_add(1, Ordering::SeqCst) + 1 == which {
            selected.deny_now();
        }
        selected.check_now()
    });
    (check, calls)
}

#[tokio::test]
async fn runtime_resume_recovery_final_check_rolls_back_actual_transition() {
    let fixture = Fixture::new();
    let snapshot = stored(&fixture).await;
    let before = active_recovery(&fixture, &snapshot.session_id).await;
    let guard = fixture.guard(20_000).await;
    let (admission, calls) = close_on_check(&guard, 3);
    assert!(fixture
        .store
        .reconcile_active_run_admitted(snapshot.session_id.clone(), admission)
        .await
        .is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(
        fixture
            .store
            .load_run_recovery(snapshot.session_id)
            .await
            .unwrap()
            .unwrap(),
        before
    );
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_resume_config_final_check_rolls_back_revision_and_values() {
    let fixture = Fixture::new();
    let mut snapshot = stored(&fixture).await;
    let before = row(&fixture, &snapshot.session_id);
    snapshot.reasoning_effort = Some(crate::model::ReasoningEffort::Low);
    let guard = fixture.guard(20_000).await;
    let (admission, calls) = close_on_check(&guard, 3);
    assert!(fixture
        .store
        .update_session_config_admitted(snapshot.clone(), admission)
        .await
        .is_err());
    assert_eq!(calls.load(Ordering::SeqCst), 3);
    assert_eq!(row(&fixture, &snapshot.session_id), before);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_resume_transcript_repair_final_checks_preserve_rows_blob_and_summary() {
    // Cover each real recovery mutation, including truncation within the blob.
    for operation in 0..3 {
        let fixture = Fixture::new();
        let snapshot = stored(&fixture).await;
        let event = crate::store::encode_transcript_log_entry(
            3,
            &Message::User {
                content: "untrusted gap suffix".into(),
            },
        )
        .unwrap();
        fixture
            .store
            .append_thread_event(
                snapshot.session_id.clone(),
                crate::store::ORCHESTRATOR_STEERING_TARGET.into(),
                event.clone(),
            )
            .await
            .unwrap();
        let before = row(&fixture, &snapshot.session_id);
        let guard = fixture.guard(20_000).await;
        let (admission, calls) = close_on_check(&guard, 2);
        let writer = crate::store::TranscriptLogWriter::new(&fixture.path)
            .unwrap()
            .with_recovery_admission(admission);
        let session = snapshot.session_id.clone();
        let result = crate::store::spawn_blocking_store_caller(move || match operation {
            0 => writer.read_tail_repairing_gap(&session, 1).map(|_| ()),
            1 => writer.delete_from(&session, 1).map(|_| ()),
            _ => writer
                .replace_snapshot_and_delete_from(&session, &[])
                .map(|_| ()),
        })
        .await
        .unwrap();
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 2);
        assert_eq!(row(&fixture, &snapshot.session_id), before);
        let connection = rusqlite::Connection::open(&fixture.path).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT event_json FROM thread_events WHERE session_id = ?1 AND thread_name = ?2",
                    rusqlite::params![snapshot.session_id, crate::store::ORCHESTRATOR_STEERING_TARGET],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            event
        );
        drop(connection);
        fixture.finish().await;
    }
}

#[tokio::test]
async fn runtime_resume_queued_config_rechecks_real_guard_after_expiry() {
    let fixture = Fixture::new();
    let mut snapshot = stored(&fixture).await;
    let before = row(&fixture, &snapshot.session_id);
    snapshot.reasoning_effort = Some(crate::model::ReasoningEffort::Low);
    let guard = fixture.guard(700).await;
    let admission = guard.mutation_admission();
    let (release, blocked) = block(&fixture.store).await;
    let owner = Arc::clone(&fixture.store);
    let selected = snapshot.clone();
    let changing = tokio::spawn(async move {
        owner
            .update_session_config_admitted(selected, admission)
            .await
    });
    queued(&fixture.store, 1).await;
    tokio::time::timeout(Duration::from_secs(3), guard.observe_denial())
        .await
        .unwrap();
    release.send(()).unwrap();
    blocked.acknowledge().await.unwrap();
    assert!(changing.await.unwrap().is_err());
    assert_eq!(row(&fixture, &snapshot.session_id), before);
    fixture.finish().await;
}

#[cfg(unix)]
async fn resume_blocked_mcp(cancel: bool) {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let options = construction_options(&fixture);
    let snapshot = stored(&fixture).await;
    let before = row(&fixture, &snapshot.session_id);
    let marker = blocked_construction_mcp(&fixture);
    // Missing authority must deny before launching the configured subprocess.
    assert!(crate::runtime::build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        &snapshot.session_id,
        &crate::runtime::NacConfig::default(),
        snapshot.cwd.clone(),
        None,
        Default::default(),
        None,
    )
    .await
    .is_err());
    assert!(!marker.exists());
    let guard = fixture.guard(if cancel { 20_000 } else { 1_500 }).await;
    let selected = Arc::clone(&guard);
    let path = fixture.path.clone();
    let session = snapshot.session_id.clone();
    let cwd = snapshot.cwd.clone();
    let started = std::time::Instant::now();
    let building = tokio::spawn(async move {
        crate::runtime::build_resume_config_for_runtime_operation(
            path,
            &session,
            &crate::runtime::NacConfig::default(),
            cwd,
            None,
            crate::runtime::ResumeModelOptions {
                trusted_api_key_file: options.model.trusted_api_key_file,
                ..Default::default()
            },
            Some(selected),
        )
        .await
    });
    let pid = construction_mcp_marker(&marker).await;
    if cancel {
        building.abort();
        assert!(building.await.err().unwrap().is_cancelled());
    } else {
        assert!(tokio::time::timeout(Duration::from_secs(3), building)
            .await
            .unwrap()
            .unwrap()
            .is_err());
        assert!(started.elapsed() < Duration::from_secs(4));
    }
    assert!(guard.check_now().is_err());
    construction_mcp_gone(pid).await;
    assert_eq!(row(&fixture, &snapshot.session_id), before);
    assert_eq!(fixture.store.list_sessions().await.unwrap().len(), 1);
    assert!(crate::sessions::SessionOperationLease::try_acquire(
        &fixture.path,
        &snapshot.session_id,
    )
    .is_ok());
    // A lost original construction cannot be replayed against retained data.
    assert!(crate::runtime::build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        &snapshot.session_id,
        &crate::runtime::NacConfig::default(),
        snapshot.cwd,
        None,
        Default::default(),
        Some(guard),
    )
    .await
    .is_err());
    fixture.finish().await;
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_resume_expiry_reaps_actual_mcp_and_preserves_existing_session() {
    resume_blocked_mcp(false).await;
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_resume_caller_cancel_reaps_actual_mcp_and_preserves_existing_session() {
    resume_blocked_mcp(true).await;
}
