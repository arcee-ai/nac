//! Real owned-store controls for the cached terminal owner lookup. No provider
//! or browser journey is needed to prove query count or lifecycle ordering.
use super::*;
use crate::delivery::server::router;
use crate::tests::{seed_direct_session, test_manager, ScopedModelEnv, SERVER_MODEL_ENV_LOCK};
use axum::{
    body::{to_bytes, Body},
    http::{Request, StatusCode},
    response::Response,
};
use nac_core::telemetry::{
    InMemoryExporter, RuntimeMetadata, StoreOperation, TelemetryName, TelemetryRecorder,
};
use std::{future::Future, time::Duration};
use tower::ServiceExt;

async fn fixture<F, Fut>(name: &str, recorder: Option<TelemetryRecorder>, control: F)
where
    F: FnOnce(SessionManager) -> Fut,
    Fut: Future<Output = ()> + Send + 'static,
{
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let _recording = recorder.map(nac_core::telemetry::install_test_recorder);
    let root = std::env::temp_dir().join(format!("nac-{name}-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let home = root.join("home");
    let _env = ScopedModelEnv::with_config_home(Some(&home), None, Some(&home), Some("test-key"));
    drop(test_manager(&root));
    seed_direct_session(&root, "session");
    let options = crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    };
    // Register this constructor's blocking thread so the real executor can
    // retain the existing test-only, payload-free telemetry recorder scope.
    let manager = nac_core::store::spawn_blocking_store_caller(move || {
        let _recording = nac_core::telemetry::register_test_recorder_thread();
        SessionManager::new(options)
    })
    .await
    .unwrap()
    .unwrap();
    let result = tokio::spawn(control(manager.clone())).await;
    // Even a failed assertion must settle real PTYs and the actual store owner.
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
    result.unwrap();
}

async fn exported(recorder: &TelemetryRecorder) {
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let stats = recorder.stats();
            assert_eq!(stats.dropped, 0);
            assert_eq!(stats.failures, 0);
            if stats.exported == stats.accepted {
                break;
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn cached_owner_uses_two_real_store_commands_and_connections_without_attachment() {
    let exporter = Arc::new(InMemoryExporter::default());
    let recorder = TelemetryRecorder::bounded(
        exporter.clone(),
        RuntimeMetadata::sqlite(
            "test",
            "test",
            nac_core::store::schema_version(),
            None,
            None,
        ),
        nac_core::telemetry::MAX_EXPORT_QUEUE_CAPACITY,
    );
    fixture(
        "cached_owner_count",
        Some(recorder.clone()),
        move |manager| async move {
            let owner = manager.inner._store_ownership.coordinator().unwrap();
            exported(&recorder).await;
            let before = exporter.events().len();
            let admitted = owner.stats().admitted;
            let service = manager
                .session_terminals()
                .cached_user_service("session")
                .await
                .unwrap();
            exported(&recorder).await;
            assert!(
                service.is_none(),
                "observation must never construct a service"
            );
            assert!(manager.inner.active_sessions.read().await.is_empty());
            // One pre-gate existence command and one under-gate config command.
            // Count actual executor admissions and actual descriptor-acquire spans,
            // rather than counting calls to a mocked application facade.
            assert_eq!(owner.stats().admitted - admitted, 2);
            let connections = exporter.events()[before..]
                .iter()
                .filter(|event| {
                    event.name == TelemetryName::StoreOperationDuration
                        && event.operation == Some(StoreOperation::ConnectionAcquire)
                })
                .count();
            assert_eq!(connections, 2);
            let gates = manager.inner.lifecycle_gates.lock().unwrap().len();
            let admitted = owner.stats().admitted;
            for invalid in [String::new(), "x".repeat(121)] {
                let error = manager
                    .session_terminals()
                    .cached_user_service(&invalid)
                    .await
                    .err()
                    .unwrap();
                assert_eq!(crate::ApiError::from(error).status, StatusCode::NOT_FOUND);
            }
            assert_eq!(
                owner.stats().admitted,
                admitted,
                "invalid IDs must not query the store"
            );
            assert_eq!(
                manager.inner.lifecycle_gates.lock().unwrap().len(),
                gates,
                "invalid IDs must not allocate lifecycle gates"
            );
        },
    )
    .await;
}

#[tokio::test]
async fn cached_owner_combined_read_preserves_missing_row_database_and_queue_errors() {
    fixture("cached_owner_errors", None, |manager| async move {
        let application = manager.session_terminals();
        let gate = manager.lifecycle_gate("session");
        let _lifecycle = gate.lock().await;
        let owner = manager.inner._store_ownership.coordinator().unwrap();
        owner.delete_session("session".into()).await.unwrap();
        let error = application
            .cached_user_service_locked("session")
            .await
            .err()
            .unwrap();
        let error = crate::ApiError::from(error);
        assert_eq!(error.status, StatusCode::NOT_FOUND);
        assert_eq!(error.message, "session 'session' was not found");

        // A genuine failing SQL read is not rewritten as a missing row or an
        // empty cached owner. This fixture alone owns the disposable database.
        let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
        connection
            .execute_batch("ALTER TABLE sessions RENAME TO unavailable_sessions")
            .unwrap();
        let failed = application.cached_user_service_locked("session").await;
        connection
            .execute_batch("ALTER TABLE unavailable_sessions RENAME TO sessions")
            .unwrap();
        drop(connection);
        let TerminalApplicationError::Internal(error) = failed.err().unwrap() else {
            panic!("database error lost its internal error identity");
        };
        assert!(error.downcast_ref::<rusqlite::Error>().is_some());
        assert_eq!(
            crate::ApiError::from(error).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );

        owner.shutdown().await.unwrap();
        let failed = application.cached_user_service_locked("session").await;
        let TerminalApplicationError::Internal(error) = failed.err().unwrap() else {
            panic!("queue shutdown lost its internal error identity");
        };
        assert_eq!(
            error.downcast_ref::<nac_core::store::PersistenceAdmissionError>(),
            Some(&nac_core::store::PersistenceAdmissionError::ShuttingDown)
        );
        assert_ne!(crate::ApiError::from(error).status, StatusCode::NOT_FOUND);
    })
    .await;
}

#[tokio::test]
async fn cached_owner_waits_for_lifecycle_then_rejects_changed_config_and_deleted_row() {
    fixture("cached_owner_lifecycle", None, |manager| async move {
        let service = manager.attach_session("session").await.unwrap();
        let owner = manager.inner._store_ownership.coordinator().unwrap();
        let application = manager.session_terminals();
        let gate = manager.lifecycle_gate("session");
        for delete in [false, true] {
            let lifecycle = gate.lock().await;
            let admitted = owner.stats().admitted;
            let mut read = Box::pin(application.cached_user_service("session"));
            tokio::time::timeout(Duration::from_secs(2), async {
                loop {
                    tokio::select! {
                        _ = read.as_mut() => panic!("read escaped a held lifecycle gate"),
                        _ = tokio::time::sleep(Duration::from_millis(1)) => {}
                    }
                    if owner.stats().admitted > admitted && owner.stats().executing == 0 {
                        break;
                    }
                }
            })
            .await
            .unwrap();
            assert_eq!(
                owner.stats().admitted - admitted,
                1,
                "only pre-gate existence may run while lifecycle is held"
            );
            if delete {
                owner.delete_session("session".into()).await.unwrap();
            } else {
                let mut changed = owner.load_session("session".into()).await.unwrap();
                changed.model = "changed-config-model".into();
                owner.update_session_config(changed).await.unwrap();
            }
            drop(lifecycle);
            let failed = read.await.err().unwrap();
            if delete {
                let error = crate::ApiError::from(failed);
                assert_eq!(error.status, StatusCode::NOT_FOUND);
                assert_eq!(error.message, "session 'session' was not found");
            } else {
                assert!(matches!(failed, TerminalApplicationError::Unavailable));
            }
            assert!(Arc::ptr_eq(
                manager
                    .inner
                    .active_sessions
                    .read()
                    .await
                    .get("session")
                    .unwrap(),
                &service
            ));
        }
    })
    .await;
}

async fn request(app: &axum::Router, uri: &str, body: serde_json::Value) -> Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("host", "localhost")
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn json(app: &axum::Router, uri: &str, body: serde_json::Value) -> serde_json::Value {
    let response = request(app, uri, body).await;
    assert_eq!(response.status(), StatusCode::OK);
    serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap()).unwrap()
}
fn pull() -> serde_json::Value {
    serde_json::json!({"protocol_version":1,"wait_ms":0,"acknowledge_reset":false})
}

#[tokio::test]
async fn cached_owner_execution_pending_ack_survives_output_and_rejects_stale_owners() {
    fixture("cached_owner_observers", None, |manager| async move {
        let service = manager.attach_session("session").await.unwrap();
        let terminal = service.open_user_terminal(Uuid::new_v4(), 80, 24).await.unwrap();
        let app = router(manager.clone());
        let base = format!("/sessions/session/executions/{}/observers", terminal.id);
        let attached = json(&app, &base, serde_json::json!({"protocol_version":1,"page_limit":32768})).await;
        let uri = format!("{base}/{}/read", attached["observer_id"].as_str().unwrap());
        let first = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let frame = json(&app, &uri, pull()).await;
                if frame["requires_ack"] == true { break frame; }
                tokio::task::yield_now().await;
            }
        }).await.unwrap();
        service.write_user_terminal_input(&terminal.id, b"printf '\\116\\105\\127\\n'\r").await.unwrap();
        let prior_end = first["retained_end"].as_str().unwrap().parse::<u64>().unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let page = service.read_user_terminal_output(&terminal.id, 0, 32768).await.unwrap();
                if page.retained_end > prior_end { break; }
                service.wait_for_user_terminal_output(&terminal.id, page.retained_end, 1000).await.unwrap();
            }
        }).await.unwrap();
        assert!(first == json(&app, &uri, pull()).await, "pending frame changed before ACK");
        let wrong = serde_json::json!({"protocol_version":1,"wait_ms":0,"acknowledge_reset":false,
            "acknowledge_offset":(first["next_offset"].as_str().unwrap().parse::<u64>().unwrap()+1).to_string()});
        assert_eq!(request(&app, &uri, wrong).await.status(), StatusCode::BAD_REQUEST);
        assert!(first == json(&app, &uri, pull()).await, "wrong ACK changed the original frame");
        let owner = manager.inner._store_ownership.coordinator().unwrap();
        let mut changed = owner.load_session("session".into()).await.unwrap();
        changed.model = "changed-config-model".into();
        owner.update_session_config(changed).await.unwrap();
        assert_eq!(request(&app, &uri, pull()).await.status(), StatusCode::CONFLICT);
        owner.delete_session("session".into()).await.unwrap();
        let missing = request(&app, &uri, pull()).await;
        assert_eq!(missing.status(), StatusCode::NOT_FOUND);
        let missing: serde_json::Value = serde_json::from_slice(&to_bytes(missing.into_body(), 1000).await.unwrap()).unwrap();
        assert_eq!(missing, serde_json::json!({"error":"session 'session' was not found"}));
    }).await;
}
