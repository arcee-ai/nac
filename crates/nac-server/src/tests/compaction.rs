use super::*;

use std::io::{Read, Write};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Condvar, Mutex,
};

use axum::{
    body::Body,
    http::{header, Request},
};
use nac_core::{
    events::CompactionSkipReason,
    session_service::{SessionCoordinationError, SessionOperationBusy, SessionSubmitError},
};
use tower::ServiceExt;

async fn post_compact(app: Router, session_id: &str, body: Option<&str>) -> Response {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("/sessions/{session_id}/compact"));
    if body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/json");
    }
    app.oneshot(
        request
            .body(body.map_or_else(Body::empty, |body| Body::from(body.to_string())))
            .unwrap(),
    )
    .await
    .unwrap()
}

fn read_model_request(stream: &mut std::net::TcpStream) -> String {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut request = Vec::new();
    let mut chunk = [0_u8; 1024];
    let header_end = loop {
        let read = stream.read(&mut chunk).expect("read model request");
        assert!(read > 0, "model request ended before headers");
        request.extend_from_slice(&chunk[..read]);
        if let Some(position) = request.windows(4).position(|window| window == b"\r\n\r\n") {
            break position;
        }
    };
    let headers = std::str::from_utf8(&request[..header_end]).unwrap();
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .unwrap_or(0);
    let body_start = header_end + 4;
    while request.len() < body_start + content_length {
        let read = stream.read(&mut chunk).expect("read model request body");
        assert!(read > 0, "model request body ended early");
        request.extend_from_slice(&chunk[..read]);
    }
    String::from_utf8(request).unwrap()
}

fn write_model_response(stream: &mut std::net::TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(response.as_bytes()).unwrap();
}

struct OneShotModelServer {
    base_url: String,
    handle: std::thread::JoinHandle<String>,
}

impl OneShotModelServer {
    fn start(status: &'static str, body: String) -> Self {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept model request");
            let request = read_model_request(&mut stream);
            write_model_response(&mut stream, status, &body);
            request
        });
        Self { base_url, handle }
    }

    fn finish(self) -> String {
        self.handle.join().expect("model server thread")
    }
}

struct BlockedTwoRequestModelServer {
    base_url: String,
    request_count: Arc<AtomicUsize>,
    release_first: Arc<(Mutex<bool>, Condvar)>,
    handle: std::thread::JoinHandle<Vec<String>>,
}

impl BlockedTwoRequestModelServer {
    fn start(first_body: String, second_body: String) -> Self {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let request_count = Arc::new(AtomicUsize::new(0));
        let release_first = Arc::new((Mutex::new(false), Condvar::new()));
        let task_count = Arc::clone(&request_count);
        let task_release = Arc::clone(&release_first);
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::with_capacity(2);
            for (index, body) in [first_body, second_body].into_iter().enumerate() {
                let (mut stream, _) = listener.accept().expect("accept model request");
                requests.push(read_model_request(&mut stream));
                task_count.store(index + 1, Ordering::SeqCst);
                if index == 0 {
                    let (lock, ready) = &*task_release;
                    let mut released = lock.lock().unwrap();
                    while !*released {
                        released = ready.wait(released).unwrap();
                    }
                }
                write_model_response(&mut stream, "200 OK", &body);
            }
            requests
        });
        Self {
            base_url,
            request_count,
            release_first,
            handle,
        }
    }

    async fn wait_for_requests(&self, expected: usize) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while self.request_count.load(Ordering::SeqCst) < expected {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("model request was not observed");
    }

    fn release_first(&self) {
        let (lock, ready) = &*self.release_first;
        *lock.lock().unwrap() = true;
        ready.notify_one();
    }

    fn finish(self) -> Vec<String> {
        self.handle.join().expect("model server thread")
    }
}

fn compaction_model_response(summary: &str) -> String {
    serde_json::json!({
        "status": "completed",
        "output": [{
            "type": "message",
            "content": [{"type": "output_text", "text": summary}]
        }],
        "usage": {
            "input_tokens": 30,
            "input_tokens_details": {"cached_tokens": 4},
            "output_tokens": 5,
            "total_tokens": 35
        }
    })
    .to_string()
}

fn compactable_server_messages() -> Vec<Message> {
    vec![
        Message::System {
            content: "system policy".to_string(),
        },
        Message::User {
            content: "old request".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "recent request".to_string(),
        },
        Message::User {
            content: "current request".to_string(),
        },
    ]
}

fn point_session_at_base_url(root: &std::path::Path, session_id: &str, base_url: &str) {
    let mut snapshot = sessions::load_session(&root.join("store.db"), session_id).unwrap();
    snapshot.base_url = format!("{base_url}/v1");
    sessions::update_session_config(&root.join("store.db"), &snapshot).unwrap();
}

fn point_session_at_model_server(
    root: &std::path::Path,
    session_id: &str,
    server: &OneShotModelServer,
) {
    point_session_at_base_url(root, session_id, &server.base_url);
}

#[tokio::test]
async fn compact_route_returns_success_without_run_or_snapshot_side_effects() {
    use nac_core::events::{AgentEvent, SessionEvent};

    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("compact_route_success");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));
    seed_session_with_messages(
        &root,
        "session",
        "2026-01-01 00:00:00.000000000",
        compactable_server_messages(),
    );
    let model = OneShotModelServer::start(
        "200 OK",
        compaction_model_response("durable compact summary"),
    );
    point_session_at_model_server(&root, "session", &model);
    let manager = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    let before = sessions::load_session(&root.join("store.db"), "session").unwrap();

    let response = post_compact(router(manager.clone()), "session", Some("{}")).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body = response_json(response).await;
    assert_eq!(body["status"], "compacted");
    let compaction_id = body["compaction_id"].as_str().unwrap();
    assert!(!compaction_id.is_empty());

    let request = model.finish();
    assert!(request.starts_with("POST /v1/responses "), "{request}");
    let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(
        serde_json::to_value(&after.messages).unwrap(),
        serde_json::to_value(&before.messages).unwrap()
    );
    assert_eq!(
        after.last_response_duration_ms,
        before.last_response_duration_ms
    );
    assert_eq!(
        after.previous_response_duration_ms,
        before.previous_response_duration_ms
    );
    assert_eq!(after.response_durations_ms, before.response_durations_ms);
    assert_eq!(after.token_usages, before.token_usages);
    assert!(service.active_run().is_none());
    assert!(service.active_compaction().is_none());

    let events = service.recent_events(None, 64);
    assert!(events.iter().all(|envelope| envelope.run_id.is_none()));
    assert!(events.iter().all(|envelope| {
        !matches!(
            envelope.event,
            SessionEvent::RunStarted { .. }
                | SessionEvent::RunCompleted { .. }
                | SessionEvent::RunFailed { .. }
                | SessionEvent::SnapshotSaved { .. }
        )
    }));
    let lifecycle = events
        .iter()
        .filter(|envelope| {
            matches!(
                envelope.event,
                SessionEvent::Agent {
                    event: AgentEvent::OrchestratorCompactionStarted { .. }
                        | AgentEvent::OrchestratorCompactionCompleted { .. }
                        | AgentEvent::OrchestratorCompactionSkipped { .. }
                        | AgentEvent::OrchestratorCompactionFailed { .. }
                }
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(lifecycle.len(), 2);
    assert!(lifecycle[0].client_id.is_some());
    assert_eq!(lifecycle[0].client_id, lifecycle[1].client_id);
    assert!(matches!(
        lifecycle[0].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionStarted { .. }
        }
    ));
    assert!(matches!(
        lifecycle[1].event,
        SessionEvent::Agent {
            event: AgentEvent::OrchestratorCompactionCompleted { .. }
        }
    ));

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn compact_route_accepts_no_body_and_empty_object_with_exact_safe_errors() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("compact_route_contract");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));
    seed_editable_session(&root, "skip");
    seed_session_with_messages(
        &root,
        "failure",
        "2026-01-02 00:00:00.000000000",
        compactable_server_messages(),
    );
    let rejected_model = OneShotModelServer::start("200 OK", compaction_model_response("   "));
    point_session_at_model_server(&root, "failure", &rejected_model);
    let app = router(test_manager(&root));

    for body in [None, Some("{}")] {
        let response = post_compact(app.clone(), "skip", body).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = response_json(response).await;
        assert_eq!(body["status"], "unchanged");
        assert_eq!(body["reason"], "no_eligible_boundary");
        assert!(body["compaction_id"].as_str().is_some());
    }

    let response = post_compact(app.clone(), "missing", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"error": "session not found"})
    );

    let response = post_compact(app, "failure", Some("{}")).await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"error": "compaction failed"})
    );
    rejected_model.finish();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn active_run_conflicts_with_compact_route() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("run_blocks_compact_route");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));
    seed_editable_session(&root, "session");
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    manager
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "hold the run open".to_string(),
            },
        )
        .await
        .unwrap();

    let response = post_compact(router(manager.clone()), "session", None).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"error": "session is busy"})
    );

    manager.cancel_active_run("session").await.unwrap();
    endpoint.abort();
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn active_compaction_blocks_route_patch_delete_and_independent_manager() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("compaction_coordination");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));
    seed_session_with_messages(
        &root,
        "session",
        "2026-01-01 00:00:00.000000000",
        compactable_server_messages(),
    );
    let endpoint = point_session_at_hanging_endpoint(&root, "session").await;
    let manager = test_manager(&root);
    let independent = test_manager(&root);
    let service = manager.attach_session("session").await.unwrap();
    let compact_manager = manager.clone();
    let compact = tokio::spawn(async move { compact_manager.compact_session("session").await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while service.active_compaction().is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("compaction should be admitted synchronously");

    let response = post_compact(router(manager.clone()), "session", None).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"error": "session is busy"})
    );
    assert_eq!(
        independent.compact_session("session").await,
        Err(CompactSessionError::Busy)
    );
    let response = post_compact(router(independent.clone()), "session", None).await;
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response_json(response).await,
        serde_json::json!({"error": "session is busy"})
    );
    for error in [
        independent
            .submit_prompt(
                "session",
                SubmitPromptRequest {
                    prompt: "must not start".to_string(),
                },
            )
            .await
            .unwrap_err(),
        independent
            .update_session_config("session", UpdateConfigRequest::default())
            .await
            .unwrap_err(),
        independent.delete_session("session").await.unwrap_err(),
    ] {
        assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
    }

    let before = sessions::load_session(&root.join("store.db"), "session").unwrap();
    let patch_error = tokio::time::timeout(
        Duration::from_secs(1),
        manager.update_session_config(
            "session",
            UpdateConfigRequest {
                model: RequestField::Value("must-not-commit".to_string()),
                ..UpdateConfigRequest::default()
            },
        ),
    )
    .await
    .expect("PATCH must not wait for model I/O")
    .unwrap_err();
    assert!(patch_error.to_string().contains("active operation"));
    assert_eq!(ApiError::from(patch_error).status, StatusCode::CONFLICT);

    let delete_error =
        tokio::time::timeout(Duration::from_secs(1), manager.delete_session("session"))
            .await
            .expect("delete must not wait for or abort compaction")
            .unwrap_err();
    assert!(delete_error.to_string().contains("manual compaction"));
    assert_eq!(ApiError::from(delete_error).status, StatusCode::CONFLICT);
    let after = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert_eq!(after.model, before.model);
    assert_eq!(after.config_version, before.config_version);
    assert!(service.active_compaction().is_some());

    endpoint.abort();
    // The failed model request is retried up to 10 times with jittered
    // 200ms*2^n backoff capped at 30s, so natural exhaustion can take ~90s.
    let result = tokio::time::timeout(Duration::from_secs(120), compact)
        .await
        .expect("failed model request should resolve compaction")
        .unwrap();
    assert_eq!(result, Err(CompactSessionError::Failed));
    assert!(!service.has_active_operation());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn patch_and_delete_winners_are_observed_before_compaction_admission() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let nac_home_root = temp_root("compact_lifecycle_winners");
    let nac_home = nac_home_root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));

    let patch_root = nac_home_root.join("patch");
    std::fs::create_dir_all(&patch_root).unwrap();
    seed_editable_session(&patch_root, "session");
    let patch_manager = test_manager(&patch_root);
    let stale_service = patch_manager.attach_session("session").await.unwrap();
    let gate = patch_manager.lifecycle_gate("session");
    let blocker = gate.lock().await;
    let updater = patch_manager.clone();
    let patch = tokio::spawn(async move {
        updater
            .update_session_config(
                "session",
                UpdateConfigRequest {
                    model: RequestField::Value("model-after-update".to_string()),
                    ..UpdateConfigRequest::default()
                },
            )
            .await
    });
    tokio::task::yield_now().await;
    let compactor = patch_manager.clone();
    let compact = tokio::spawn(async move { compactor.compact_session("session").await });
    tokio::task::yield_now().await;
    drop(blocker);

    patch.await.unwrap().unwrap();
    assert!(matches!(
        compact.await.unwrap(),
        Ok(CompactSessionResponse::Unchanged {
            reason: CompactionSkipReason::NoEligibleBoundary,
            ..
        })
    ));
    let current_service = patch_manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(!Arc::ptr_eq(&stale_service, &current_service));
    assert_eq!(current_service.metadata().model, "model-after-update");

    let delete_root = nac_home_root.join("delete");
    std::fs::create_dir_all(&delete_root).unwrap();
    seed_editable_session(&delete_root, "session");
    let delete_manager = test_manager(&delete_root);
    delete_manager.attach_session("session").await.unwrap();
    let gate = delete_manager.lifecycle_gate("session");
    let blocker = gate.lock().await;
    let deleter = delete_manager.clone();
    let delete = tokio::spawn(async move { deleter.delete_session("session").await });
    tokio::task::yield_now().await;
    let compactor = delete_manager.clone();
    let compact = tokio::spawn(async move { compactor.compact_session("session").await });
    tokio::task::yield_now().await;
    drop(blocker);

    delete.await.unwrap().unwrap();
    assert_eq!(compact.await.unwrap(), Err(CompactSessionError::NotFound));
    assert!(sessions::load_session(&delete_root.join("store.db"), "session").is_err());
    let _ = std::fs::remove_dir_all(nac_home_root);
}

#[tokio::test]
async fn missing_or_invalid_session_does_not_create_lock_artifacts() {
    let root = temp_root("compact_missing_no_lock");
    seed_editable_session(&root, "existing");
    let manager = test_manager(&root);
    let lock_dir = root.join("store.db.run-locks");
    assert!(!lock_dir.exists());

    let response = post_compact(router(manager.clone()), "missing", None).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        manager.compact_session(&"x".repeat(121)).await,
        Err(CompactSessionError::NotFound)
    );
    assert!(!lock_dir.exists());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn operation_lease_store_failure_is_path_safe_for_compaction_api() {
    const CANARY: &str = "compact_operation_lease_private_path_canary";
    let root = temp_root(CANARY);
    seed_editable_session(&root, "session");
    let lock_dir = poison_operation_lease_directory(&root);

    let response = post_compact(router(test_manager(&root)), "session", None).await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let response = response_json(response).await;
    assert_eq!(response, serde_json::json!({"error": "compaction failed"}));
    assert!(!response.to_string().contains(CANARY));
    assert!(!response.to_string().contains(&root.display().to_string()));
    assert!(sessions::load_session(&root.join("store.db"), "session").is_ok());
    assert!(lock_dir.is_file());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn current_service_attachment_rejects_a_wrong_operation_lease() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("compact_wrong_lease");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));
    seed_editable_session(&root, "session-a");
    seed_editable_session(&root, "session-b");
    let manager = test_manager(&root);
    let service = manager.attach_session("session-a").await.unwrap();
    let lease =
        sessions::SessionOperationLease::try_acquire(&root.join("store.db"), "session-b").unwrap();
    let gate = manager.lifecycle_gate("session-a");
    let _lifecycle = gate.lock().await;

    let error = match manager
        .attach_current_operation_service_locked("session-a", &lease)
        .await
    {
        Ok(_) => panic!("wrong lease must be rejected"),
        Err(error) => error,
    };
    assert!(matches!(
        error.downcast_ref::<sessions::SessionOperationLeaseValidationError>(),
        Some(sessions::SessionOperationLeaseValidationError::IdentityMismatch)
    ));
    assert!(!service.has_active_operation());

    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn manager_attached_during_external_compaction_refreshes_before_next_run() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("cross_manager_checkpoint_refresh");
    let nac_home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&nac_home, Some("server-compact-key"));
    seed_session_with_messages(
        &root,
        "session",
        "2026-01-01 00:00:00.000000000",
        compactable_server_messages(),
    );
    let model = BlockedTwoRequestModelServer::start(
        compaction_model_response("durable cross-manager summary"),
        compaction_model_response("ordinary response"),
    );
    point_session_at_base_url(&root, "session", &model.base_url);
    let manager_a = test_manager(&root);
    let manager_b = test_manager(&root);

    let compactor = manager_a.clone();
    let compaction = tokio::spawn(async move { compactor.compact_session("session").await });
    model.wait_for_requests(1).await;
    let cached_b = manager_b.attach_session("session").await.unwrap();
    assert!(!cached_b.has_active_operation());

    model.release_first();
    assert!(matches!(
        compaction.await.unwrap(),
        Ok(CompactSessionResponse::Compacted { .. })
    ));
    manager_b
        .submit_prompt(
            "session",
            SubmitPromptRequest {
                prompt: "continue after external compaction".to_string(),
            },
        )
        .await
        .unwrap();
    model.wait_for_requests(2).await;
    let requests = model.finish();
    let ordinary_request = &requests[1];
    assert!(ordinary_request.contains("durable cross-manager summary"));
    assert!(ordinary_request.contains("continue after external compaction"));
    assert!(!ordinary_request.contains("old request"));
    assert!(!ordinary_request.contains("old answer"));
    let current_b = manager_b
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .cloned()
        .unwrap();
    assert!(Arc::ptr_eq(&current_b, &cached_b));
    tokio::time::timeout(Duration::from_secs(2), async {
        while current_b.has_active_operation() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("ordinary run should finish");

    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn typed_operation_admission_errors_reserve_500_for_real_failures() {
    let stale = SessionSubmitError::Coordination {
        message: SessionCoordinationError::StaleConfiguration {
            session_id: "session".to_string(),
        },
    };
    let external = SessionSubmitError::ExternalBusy {
        session_id: SessionOperationBusy::External {
            session_id: "session".to_string(),
        },
    };
    let local_agent = SessionSubmitError::Coordination {
        message: SessionCoordinationError::LocalAgentBusy,
    };
    for error in [
        anyhow::Error::new(stale),
        anyhow::Error::new(external),
        anyhow::Error::new(local_agent),
    ] {
        assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
    }
    let store = SessionSubmitError::Coordination {
        message: SessionCoordinationError::Store {
            detail: "internal store canary".to_string(),
        },
    };
    let response = ApiError::from(anyhow::Error::new(store));
    assert_eq!(response.status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(response.message, "session operation coordination failed");
}
