use super::*;
use crate::application::admitted_session_publication_work::PublicationObservation;
use nac_core::{
    runtime::{self, ModelOptions, NacConfig, RunOptions, StoreOptions},
    session_service::{
        admitted_publication_fixtures::{synthetic_publication, PublicationFixtureControl},
        AdmittedSessionPublication, SessionPublicationKind, SessionService,
    },
};

async fn prepared(
    manager: &SessionManager,
    root: &std::path::Path,
    deadline: std::time::Instant,
) -> (
    AdmittedSessionPublication,
    PublicationFixtureControl,
    String,
) {
    let config = NacConfig::load_from_cwd(root).unwrap();
    let prepared = runtime::prepare_run_config_for_project_with_behavior(
        RunOptions {
            workspace_cwd: root.to_path_buf(),
            config_cwd: Some(root.to_path_buf()),
            store: StoreOptions {
                store_path: Some(manager.inner.store_path.clone()),
            },
            model: ModelOptions {
                backend: Some(BackendKind::OpenAiResponses),
                api_model: Some("gpt-5.2".into()),
                api_key_env: OptionalModelOption::Value("OPENAI_API_KEY".into()),
                ..Default::default()
            },
            ..Default::default()
        },
        &config,
        None,
        sessions::SessionBehavior::Direct,
    )
    .await
    .unwrap();
    let (run_config, resources) = prepared.into_parts();
    let service = SessionService::from_orchestrator_run_config(run_config).service;
    let id = service.metadata().session_id.unwrap();
    // This ordinary Local runtime is ONLY a synthetic consumer fixture. It is
    // never installed as a positive protected boundary or production issuer.
    let (admitted, control) = synthetic_publication(
        service,
        Some(resources),
        SessionPublicationKind::Create,
        deadline,
    )
    .unwrap();
    (admitted, control, id)
}

async fn publish(
    manager: &SessionManager,
    admitted: AdmittedSessionPublication,
) -> Result<Option<nac_core::session_service::SessionFrontendSnapshot>> {
    manager
        .session_creation()
        .publish_admitted_session(admitted)
        .await
}

#[tokio::test]
async fn publication_readback_timeout_keeps_the_original_work_and_result() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_readback_timeout");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    let gate = manager.lifecycle_gate(&id);
    let held = gate.lock().await;
    let attempt = manager
        .session_creation()
        .start_admitted_session_publication(admitted)
        .unwrap();
    let readback = attempt.readback();
    assert_eq!(readback.session_id(), id);
    assert!(matches!(
        readback
            .wait_until(std::time::Instant::now() + Duration::from_millis(20))
            .await,
        PublicationObservation::Pending
    ));
    assert!(
        !control.is_retired(),
        "read timeout cannot cancel original work"
    );
    drop(held);
    let result = attempt.wait().await.unwrap().unwrap();
    assert_eq!(result.metadata.session_id.as_deref(), Some(id.as_str()));
    let PublicationObservation::Finished(first) = readback.observe() else {
        panic!("completed original task lost its result");
    };
    let PublicationObservation::Finished(second) = readback.clone().observe() else {
        panic!("cloned readback lost original result");
    };
    assert!(
        Arc::ptr_eq(&first, &second),
        "readback must retain the same result allocation"
    );
    assert!(first.result().is_ok());
    assert_eq!(manager.inner.active_sessions.read().await.len(), 1);
    drop(readback);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn dropped_publication_owner_retires_without_granting_readback_a_retry() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_owner_drop");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    let gate = manager.lifecycle_gate(&id);
    let held = gate.lock().await;
    let attempt = manager
        .session_creation()
        .start_admitted_session_publication(admitted)
        .unwrap();
    let readback = attempt.readback();
    drop(attempt);
    assert!(control.is_retired());
    let PublicationObservation::Finished(result) = readback
        .wait_until(std::time::Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("retired original wait failed to return");
    };
    assert!(result.result().is_err());
    assert!(!sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(held);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn aborted_publication_caller_can_read_the_same_post_commit_outcome() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_post_commit_readback");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = Some(Arc::clone(&gate));
    let attempt = manager
        .session_creation()
        .start_admitted_session_publication(admitted)
        .unwrap();
    let readback = attempt.readback();
    let caller = tokio::spawn(attempt.wait());
    tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
        .await
        .unwrap();
    assert!(sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    caller.abort();
    assert!(caller.await.unwrap_err().is_cancelled());
    assert!(control.is_retired());
    let PublicationObservation::Finished(result) = readback
        .wait_until(std::time::Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("original work did not return after caller abort");
    };
    assert!(result.result().is_err());
    assert_eq!(readback.session_id(), id);
    assert!(sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn publication_retirement_keeps_the_actual_accepted_sql_acknowledgement() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_sql_custody");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = owned_test_manager(&root).unwrap();
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    let blocker = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let coordinator = manager.inner._store_ownership.coordinator().unwrap();
    let before = coordinator.stats();
    let attempt = manager
        .session_creation()
        .start_admitted_session_publication(admitted)
        .unwrap();
    let readback = attempt.readback();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let stats = coordinator.stats();
            if stats.executing == 1 && stats.admitted > before.admitted {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    drop(attempt);
    assert!(control.is_retired());
    assert!(
        matches!(
            readback
                .wait_until(std::time::Instant::now() + Duration::from_millis(20))
                .await,
            PublicationObservation::Pending
        ),
        "accepted SQL must remain awaited while the actual writer is blocked"
    );
    blocker.execute_batch("ROLLBACK").unwrap();
    let PublicationObservation::Finished(result) = readback
        .wait_until(std::time::Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("original accepted SQL did not return after lock release");
    };
    assert!(result.result().is_err());
    let after = coordinator.stats();
    assert!(after.completed > before.completed);
    assert_eq!(after.completed, after.admitted);
    assert_eq!((after.queued, after.executing), (0, 0));
    assert_eq!(after.acknowledgements_lost, before.acknowledgements_lost);
    assert!(!sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(blocker);
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn publication_retirement_interrupts_an_original_cache_read_wait() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_cache_read_retirement");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    let lifecycle = manager.lifecycle_gate(&id);
    let held = manager.inner.active_sessions.write().await;
    let attempt = manager
        .session_creation()
        .start_admitted_session_publication(admitted)
        .unwrap();
    let readback = attempt.readback();
    tokio::time::timeout(Duration::from_secs(2), async {
        while lifecycle.try_lock().is_ok() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    control.retire();
    let PublicationObservation::Finished(result) = readback
        .wait_until(std::time::Instant::now() + Duration::from_secs(2))
        .await
    else {
        panic!("quiet cache read ignored original retirement");
    };
    assert!(result.result().is_err());
    assert!(!sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    assert!(held.is_empty());
    drop(attempt);
    drop(held);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn admitted_creation_commits_then_publishes_the_actual_service() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_creation_positive");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    assert!(!sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    let snapshot = publish(&manager, admitted).await.unwrap().unwrap();
    assert_eq!(snapshot.metadata.session_id.as_deref(), Some(id.as_str()));
    assert!(sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    let active = manager.inner.active_sessions.read().await;
    assert_eq!(active.len(), 1);
    assert_eq!(
        active[&id].metadata().session_id.as_deref(),
        Some(id.as_str())
    );
    assert!(!active[&id].has_active_operation());
    assert!(
        control.is_retired(),
        "one-use publication must retire after completion"
    );
    drop(active);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn retired_creation_does_not_insert_or_cache_a_session() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_creation_denied");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, control, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    control.retire();
    assert!(publish(&manager, admitted).await.is_err());
    assert!(!sessions::session_exists(&manager.inner.store_path, &id).unwrap());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn original_deadline_or_explicit_retirement_interrupts_a_quiet_lifecycle_wait() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for explicit in [false, true] {
        let root = temp_root(&format!("admitted_creation_wait_{explicit}"));
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
        let manager = test_manager(&root);
        let budget = if explicit {
            Duration::from_secs(10)
        } else {
            Duration::from_millis(250)
        };
        let (admitted, control, id) =
            prepared(&manager, &root, std::time::Instant::now() + budget).await;
        let gate = manager.lifecycle_gate(&id);
        let held = gate.lock().await;
        let owner = manager.clone();
        let task = tokio::spawn(async move { publish(&owner, admitted).await });
        if explicit {
            control.retire();
        }
        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap();
        assert!(result.is_err());
        assert!(control.is_retired());
        assert!(!sessions::session_exists(&manager.inner.store_path, &id).unwrap());
        assert!(manager.inner.active_sessions.read().await.is_empty());
        drop(held);
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn canceled_or_retired_wait_after_commit_preserves_row_without_cache_publication() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for cancel_waiter in [false, true] {
        let root = temp_root(&format!("admitted_creation_after_commit_{cancel_waiter}"));
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
        let manager = test_manager(&root);
        let (admitted, control, id) = prepared(
            &manager,
            &root,
            std::time::Instant::now() + Duration::from_secs(10),
        )
        .await;
        let gate = Arc::new(application::session_creation::CreationProjectionGate::default());
        *manager
            .inner
            .session_creation_before_projection
            .lock()
            .unwrap() = Some(Arc::clone(&gate));
        let owner = manager.clone();
        let task = tokio::spawn(async move { publish(&owner, admitted).await });
        tokio::time::timeout(Duration::from_secs(5), gate.reached.notified())
            .await
            .unwrap();
        assert!(sessions::session_exists(&manager.inner.store_path, &id).unwrap());
        if cancel_waiter {
            task.abort();
            assert!(task.await.unwrap_err().is_cancelled());
        } else {
            control.retire();
            assert!(tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .unwrap()
                .unwrap()
                .is_err());
        }
        assert!(control.is_retired());
        assert!(
            sessions::session_exists(&manager.inner.store_path, &id).unwrap(),
            "retirement must not pretend a committed creation was undone"
        );
        assert!(manager.inner.active_sessions.read().await.is_empty());
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test]
async fn admitted_activation_reuses_stored_identity_without_ordinary_attachment() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_cold_activation");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, _, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    publish(&manager, admitted).await.unwrap();
    let service = manager
        .inner
        .active_sessions
        .write()
        .await
        .remove(&id)
        .unwrap();
    let before = std::fs::read(&manager.inner.store_path).unwrap();
    let (activation, _) = synthetic_publication(
        (*service).clone(),
        None,
        SessionPublicationKind::Activate,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .unwrap();
    assert!(publish(&manager, activation).await.unwrap().is_none());
    assert_eq!(std::fs::read(&manager.inner.store_path).unwrap(), before);
    let active = manager.inner.active_sessions.read().await;
    assert_eq!(active.len(), 1);
    assert!(!active[&id].has_active_operation());
    drop(active);
    drop(service);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn activation_refuses_stale_configuration_and_never_replaces_a_cached_owner() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_activation_fences");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let manager = test_manager(&root);
    let (admitted, _, id) = prepared(
        &manager,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    publish(&manager, admitted).await.unwrap();
    let original = manager.inner.active_sessions.read().await[&id].clone();
    let (activation, control) = synthetic_publication(
        (*original).clone(),
        None,
        SessionPublicationKind::Activate,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .unwrap();
    assert!(publish(&manager, activation).await.is_err());
    assert!(control.is_retired());
    assert!(Arc::ptr_eq(
        &manager.inner.active_sessions.read().await[&id],
        &original
    ));
    manager.inner.active_sessions.write().await.remove(&id);
    let mut stored = sessions::load_session(&manager.inner.store_path, &id).unwrap();
    stored.model = "changed-model".into();
    sessions::update_session_config(&manager.inner.store_path, &stored).unwrap();
    let (stale, _) = synthetic_publication(
        (*original).clone(),
        None,
        SessionPublicationKind::Activate,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .unwrap();
    assert!(publish(&manager, stale).await.is_err());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    drop(original);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn admitted_runtime_cannot_be_redirected_to_another_store() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("admitted_other_store");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("test-only-key"));
    let source = test_manager(&root);
    let other_root = root.join("other");
    std::fs::create_dir(&other_root).unwrap();
    let destination = test_manager(&other_root);
    let (admitted, control, id) = prepared(
        &source,
        &root,
        std::time::Instant::now() + Duration::from_secs(10),
    )
    .await;
    assert!(publish(&destination, admitted).await.is_err());
    assert!(control.is_retired());
    assert!(!sessions::session_exists(&source.inner.store_path, &id).unwrap());
    assert!(!sessions::session_exists(&destination.inner.store_path, &id).unwrap());
    assert!(destination.inner.active_sessions.read().await.is_empty());
    drop(source);
    drop(destination);
    std::fs::remove_dir_all(root).unwrap();
}
