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

// A private runtime lets synchronous unwind settle the ORIGINAL client handle.
// Aborting only the HTTP waiter would leave the admitted core compaction alive.
struct CompactionCase {
    runtime: Option<tokio::runtime::Runtime>,
    endpoint: ControlledCompactionEndpoint,
    compact: Option<tokio::task::JoinHandle<Result<CompactSessionResponse, CompactSessionError>>>,
}

impl CompactionCase {
    fn start(root: &std::path::Path) -> (Self, SessionManager) {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let endpoint = ControlledCompactionEndpoint::start(
            "400 Bad Request",
            r#"{"error":{"message":"controlled compaction failure"}}"#.to_string(),
        );
        point_session_at_base_url(root, "session", &endpoint.base_url);
        let manager = {
            let _entered = runtime.enter();
            test_manager(root)
        };
        let compactor = manager.clone();
        let compact = runtime.spawn(async move { compactor.compact_session("session").await });
        (
            Self {
                runtime: Some(runtime),
                endpoint,
                compact: Some(compact),
            },
            manager,
        )
    }

    fn run<F: std::future::Future>(&self, future: F) -> F::Output {
        self.runtime.as_ref().unwrap().block_on(future)
    }

    fn finish_client(&mut self) -> Result<CompactSessionResponse, CompactSessionError> {
        let task = self.compact.as_mut().unwrap();
        let result =
            self.runtime.as_ref().unwrap().block_on(async {
                tokio::time::timeout(Duration::from_secs(120), &mut *task).await
            });
        // Keep the original handle on timeout: Drop aborts AND joins it before
        // shutting down the runtime (including the admitted model task).
        let result = result.expect("failed model request should resolve compaction");
        self.compact.take();
        result.unwrap()
    }
}

impl Drop for CompactionCase {
    fn drop(&mut self) {
        self.endpoint.release();
        let mut cleanup_error = None;
        if let Some(mut task) = self.compact.take() {
            // Keep driving settlement after an assertion unwinds. Dropping the
            // runtime immediately can discard the core task's cleanup future.
            cleanup_error = self.run(async {
                match tokio::time::timeout(Duration::from_secs(5), &mut task).await {
                    Ok(Ok(_)) => None,
                    Ok(Err(error)) => Some(format!("original client failed: {error}")),
                    Err(_) => {
                        task.abort();
                        let joined = task.await;
                        Some(format!(
                            "original client cleanup timed out; abort joined: {joined:?}"
                        ))
                    }
                }
            });
        }
        // Runtime shutdown also cancels/joins any remaining core model tasks.
        // The endpoint is still bound throughout both original async owners.
        drop(self.runtime.take());
        if let Some(error) = cleanup_error {
            if std::thread::panicking() {
                eprintln!("compaction cleanup also failed: {error}");
            } else {
                panic!("compaction cleanup failed: {error}");
            }
        }
    }
}

// One test-owned endpoint: the original listener stays bound after the worker
// responds, until its caller has observed compaction's terminal result.
struct ControlledCompactionEndpoint {
    base_url: String,
    listener: Option<std::net::TcpListener>,
    state: Arc<(Mutex<CompactionEndpointState>, Condvar)>,
    worker: Option<std::thread::JoinHandle<Option<String>>>,
}

#[derive(Default)]
struct CompactionEndpointState {
    request_seen: bool,
    reading: bool,
    release: bool,
    stop: bool,
    socket: Option<std::net::TcpStream>,
}

impl ControlledCompactionEndpoint {
    fn start(status: &'static str, body: String) -> Self {
        Self::from_listener(
            std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap(),
            status,
            body,
        )
    }

    fn from_listener(listener: std::net::TcpListener, status: &'static str, body: String) -> Self {
        listener.set_nonblocking(true).unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let acceptor = listener.try_clone().unwrap();
        let state = Arc::new((
            Mutex::new(CompactionEndpointState::default()),
            Condvar::new(),
        ));
        let worker_state = Arc::clone(&state);
        let worker = std::thread::spawn(move || {
            let (lock, changed) = &*worker_state;
            let mut stream = loop {
                if lock.lock().unwrap().stop {
                    return None;
                }
                match acceptor.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        let guard = lock.lock().unwrap();
                        if guard.stop {
                            return None;
                        }
                        drop(
                            changed
                                .wait_timeout(guard, Duration::from_millis(10))
                                .unwrap(),
                        );
                    }
                    Err(error) => panic!("accept controlled compaction request: {error}"),
                }
            };
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            {
                let mut state = lock.lock().unwrap();
                if state.stop {
                    return None;
                }
                // Shutdown of this clone interrupts a blocked request read/write
                // on assertion unwind; no owner lock is held during socket I/O.
                state.socket = Some(stream.try_clone().unwrap());
            }
            // Hold the first request unread, matching the old hanging helper's
            // socket lifetime in the released-address counterexample.
            assert!(stream.peek(&mut [0_u8; 1]).unwrap() > 0);
            let mut state = lock.lock().unwrap();
            state.request_seen = true;
            changed.notify_all();
            while !state.release && !state.stop {
                state = changed.wait(state).unwrap();
            }
            if state.stop {
                return None;
            }
            state.reading = true;
            changed.notify_all();
            drop(state);
            let request = read_model_request(&mut stream);
            write_model_response(&mut stream, status, &body);
            drop(lock.lock().unwrap().socket.take());
            Some(request)
        });
        Self {
            base_url,
            listener: Some(listener),
            state,
            worker: Some(worker),
        }
    }

    fn address(&self) -> std::net::SocketAddr {
        self.listener.as_ref().unwrap().local_addr().unwrap()
    }

    async fn wait_for_request(&self) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while !self.state.0.lock().unwrap().request_seen {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("controlled compaction request was not observed");
    }

    fn release(&self) {
        self.state.0.lock().unwrap().release = true;
        self.state.1.notify_all();
    }

    fn stop_join(&mut self) -> std::thread::Result<Option<String>> {
        let shutdown_error = {
            let mut state = self
                .state
                .0
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state.stop = true;
            state.socket.take().and_then(|socket| {
                socket
                    .shutdown(std::net::Shutdown::Both)
                    .err()
                    .filter(|error| error.kind() != std::io::ErrorKind::NotConnected)
            })
        };
        self.state.1.notify_all();
        let result = self.worker.take().map_or(Ok(None), |worker| worker.join());
        // The worker has relinquished its cloned listener before this original
        // reservation is dropped, including on the early-stop counterexample.
        drop(self.listener.take());
        if let Some(error) = shutdown_error {
            if std::thread::panicking() {
                eprintln!("controlled compaction cleanup: socket shutdown also failed: {error}");
            } else {
                panic!("controlled compaction cleanup: socket shutdown failed: {error}");
            }
        }
        result
    }
}

impl Drop for ControlledCompactionEndpoint {
    fn drop(&mut self) {
        if let Err(error) = self.stop_join() {
            if std::thread::panicking() {
                eprintln!("controlled compaction cleanup: worker also panicked: {error:?}");
            } else {
                panic!("controlled compaction cleanup: worker panicked: {error:?}");
            }
        }
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

    let events = service.recent_events(None, 64).1;
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
            nac_core::store::InputOrigin::Automation,
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

#[test]
fn active_compaction_blocks_route_patch_delete_and_independent_manager() {
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
    let (mut case, manager) = CompactionCase::start(&root);
    let independent = case.run(async { test_manager(&root) });
    let service = case.run(manager.attach_session("session")).unwrap();
    case.run(async {
        tokio::time::timeout(Duration::from_secs(2), async {
            while service.active_compaction().is_none() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("compaction should be admitted synchronously");
        case.endpoint.wait_for_request().await;

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
                    nac_core::store::InputOrigin::Automation,
                )
                .await
                .unwrap_err(),
            independent.delete_session("session").await.unwrap_err(),
        ] {
            assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
        }
        independent
            .update_session_config("session", UpdateConfigRequest::default())
            .await
            .expect("empty PATCH is a universal no-op even during compaction");

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
    });
    // A terminal model error tests failed settlement without releasing the URL
    // to another nextest process while the production client still retries.
    case.endpoint.release();
    assert_eq!(case.finish_client(), Err(CompactSessionError::Failed));
    assert!(!service.has_active_operation());
    drop(case);
    drop(service);
    drop(independent);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

fn seed_compaction_case(name: &str) -> PathBuf {
    let root = temp_root(name);
    seed_session_with_messages(
        &root,
        "session",
        "2026-01-01 00:00:00.000000000",
        compactable_server_messages(),
    );
    root
}

#[test]
fn released_compaction_endpoint_can_accept_a_foreign_summary() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = seed_compaction_case("compaction_released_endpoint");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let (mut case, manager) = CompactionCase::start(&root);
    case.run(case.endpoint.wait_for_request());
    let address = case.endpoint.address();
    // Deliberately violate ownership, matching the OLD test: release the held,
    // unread request and exact address before the production client returns.
    assert!(case.endpoint.stop_join().unwrap().is_none());
    case.endpoint = ControlledCompactionEndpoint::from_listener(
        std::net::TcpListener::bind(address).expect("rebind exact released address"),
        "200 OK",
        compaction_model_response("foreign fixture summary"),
    );
    case.run(case.endpoint.wait_for_request());
    case.endpoint.release();
    assert!(matches!(
        case.finish_client(),
        Ok(CompactSessionResponse::Compacted { .. })
    ));
    let request = case.endpoint.stop_join().unwrap().unwrap();
    assert!(request.starts_with("POST /v1/responses "));
    assert!(request.contains("old request"));
    eprintln!(
        "old-policy takeover: address={address}, foreign_summary_requests=1, result=Compacted"
    );
    case.run(async {
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await.unwrap();
    });
    drop(case);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn controlled_compaction_endpoint_excludes_takeover_until_failure_returns() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = seed_compaction_case("compaction_owned_endpoint");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    let (mut case, manager) = CompactionCase::start(&root);
    let address = case.endpoint.address();
    case.run(case.endpoint.wait_for_request());
    assert_eq!(
        std::net::TcpListener::bind(address).unwrap_err().kind(),
        std::io::ErrorKind::AddrInUse
    );
    case.endpoint.release();
    assert_eq!(case.finish_client(), Err(CompactSessionError::Failed));
    assert_eq!(
        std::net::TcpListener::bind(address).unwrap_err().kind(),
        std::io::ErrorKind::AddrInUse
    );
    let request = case.endpoint.stop_join().unwrap().unwrap();
    assert!(request.starts_with("POST /v1/responses "));
    eprintln!("owned-policy: address={address}, terminal_error_requests=1, result=Failed, takeover=excluded");
    drop(std::net::TcpListener::bind(address).expect("release after original client returned"));
    case.run(async {
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await.unwrap();
    });
    drop(case);
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn controlled_compaction_unwind_joins_original_client_before_releasing_address() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for held in [false, true] {
        let root = seed_compaction_case("compaction_unwind");
        let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
        let (case, manager) = CompactionCase::start(&root);
        let address = case.endpoint.address();
        let state = Arc::clone(&case.endpoint.state);
        let original_client = case.compact.as_ref().unwrap().abort_handle();
        let service = held.then(|| case.run(manager.attach_session("session")).unwrap());
        let started = std::time::Instant::now();
        let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || {
            if held {
                case.run(case.endpoint.wait_for_request());
            } else {
                assert!(!case.endpoint.state.0.lock().unwrap().request_seen);
            }
            let _owned = case;
            panic!("primary coordination assertion");
        }))
        .unwrap_err();
        assert_eq!(
            panic.downcast_ref::<&str>(),
            Some(&"primary coordination assertion")
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        assert!(
            original_client.is_finished(),
            "original client must be joined"
        );
        assert!(state.0.lock().unwrap().stop);
        if let Some(service) = service {
            assert!(
                !service.has_active_operation(),
                "admitted model task must retire"
            );
        }
        drop(std::net::TcpListener::bind(address).expect("unwind released joined owners"));
        drop(manager);
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn controlled_compaction_stop_interrupts_partial_request_io() {
    for partial in [
        b"POST /v1/responses HTTP/1.1\r\n".as_slice(),
        b"POST /v1/responses HTTP/1.1\r\nContent-Length: 20\r\n\r\n{".as_slice(),
    ] {
        let mut endpoint = ControlledCompactionEndpoint::start("400 Bad Request", "{}".to_string());
        let address = endpoint.address();
        let mut socket = std::net::TcpStream::connect(address).unwrap();
        socket.write_all(partial).unwrap();
        endpoint.release();
        let (lock, changed) = &*endpoint.state;
        let (state, wait) = changed
            .wait_timeout_while(lock.lock().unwrap(), Duration::from_secs(2), |s| !s.reading)
            .unwrap();
        assert!(
            !wait.timed_out(),
            "worker must enter original partial request reader"
        );
        drop(state);
        let started = std::time::Instant::now();
        // Existing request reader reports interrupted EOF as a panic. Observe
        // that original worker result explicitly, rather than discarding it.
        let error = endpoint
            .stop_join()
            .expect_err("partial request must remain an I/O failure");
        let primary = error.downcast_ref::<&str>().copied();
        assert!(
            matches!(
                primary,
                Some("model request ended before headers" | "model request body ended early")
            ),
            "unexpected worker failure: {error:?}"
        );
        assert!(started.elapsed() < Duration::from_secs(2));
        drop(socket);
        drop(std::net::TcpListener::bind(address).expect("partial I/O worker joined"));
    }
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
            nac_core::store::InputOrigin::Automation,
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

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_manual_compaction_acknowledges_checkpoint() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("owned_manual_compaction");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-compact-key"));
    seed_session_with_messages(
        &root,
        "session",
        "2026-01-01 00:00:00.000000000",
        compactable_server_messages(),
    );
    let model =
        OneShotModelServer::start("200 OK", compaction_model_response("owned durable summary"));
    point_session_at_model_server(&root, "session", &model);
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap();
    assert!(matches!(
        manager.compact_session("session").await.unwrap(),
        CompactSessionResponse::Compacted { .. }
    ));
    assert!(!manager
        .attach_session("session")
        .await
        .unwrap()
        .has_active_operation());
    assert!(model.finish().starts_with("POST /v1/responses "));
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let conn = rusqlite::Connection::open(root.join("store.db")).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM orchestrator_compaction_checkpoints WHERE session_id = 'session'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
    let snapshot = sessions::load_session(&root.join("store.db"), "session").unwrap();
    assert!(
        snapshot.unattributed_token_usage.is_some(),
        "compaction context must persist with its checkpoint"
    );
    drop(conn);
    let _ = std::fs::remove_dir_all(root);
}
