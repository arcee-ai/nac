//! MCP prompt preparation and captured tools through actual sealed run admission.
use super::run_admission_tests::{count, ended, renew_original, response, stored};
use super::*;
use crate::mcp::effect_lease_tests::{
    hold_request_connection, wait_for_owned_child_exit, write_stdio_fixture,
};
use crate::mcp::McpRegistry;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::runtime::{
    build_resume_config_for_runtime_operation, NacConfig, ResumeModelOptions, RuntimeRunAdmission,
};
use crate::sessions::SessionBehavior;

struct NoProviderAttempt {
    base_url: String,
    attempts: Arc<std::sync::atomic::AtomicUsize>,
    stop: std::sync::mpsc::Sender<()>,
    task: Option<std::thread::JoinHandle<()>>,
}
impl NoProviderAttempt {
    fn new() -> Self {
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let observed = attempts.clone();
        let (stop, stopped) = std::sync::mpsc::channel();
        let task = std::thread::spawn(move || {
            use std::io::Write;
            let mut stopping = false;
            loop {
                stopping |= !matches!(
                    stopped.try_recv(),
                    Err(std::sync::mpsc::TryRecvError::Empty)
                );
                match listener.accept() {
                    Ok((mut connection, _)) => {
                        observed.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let _ = connection.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if stopping {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("owned provider fixture: {error}"),
                }
            }
        });
        Self {
            base_url,
            attempts,
            stop,
            task: Some(task),
        }
    }
    fn assert_no_attempt(mut self) {
        self.stop.send(()).unwrap();
        self.task.take().unwrap().join().unwrap();
        assert_eq!(self.attempts.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
impl Drop for NoProviderAttempt {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(task) = self.task.take() {
            task.join().unwrap();
        }
    }
}

async fn build_with_registry(
    fixture: &Fixture,
    snapshot: &crate::sessions::SessionSnapshot,
    guard: &Arc<ManagedRuntimeLeaseGuard>,
) -> (
    crate::session_service::SessionServiceParts,
    RuntimeRunAdmission,
    Arc<McpRegistry>,
) {
    let options = construction_options(fixture);
    let (built, original) = build_resume_config_for_runtime_operation(
        fixture.path.clone(),
        &snapshot.session_id,
        &NacConfig::default(),
        snapshot.cwd.clone(),
        None,
        ResumeModelOptions {
            trusted_api_key_file: options.model.trusted_api_key_file,
            ..Default::default()
        },
        Some(guard.clone()),
    )
    .await
    .unwrap();
    let registry = built.agent.mcp_registry().unwrap();
    (
        crate::session_service::SessionService::from_orchestrator_run_config(built),
        original,
        registry,
    )
}

async fn assert_no_run(
    fixture: &Fixture,
    snapshot: &crate::sessions::SessionSnapshot,
    guard: &ManagedRuntimeLeaseGuard,
) {
    assert_eq!(count(fixture, &snapshot.session_id), 0);
    assert_eq!(
        serde_json::to_value(
            fixture
                .store
                .load_session(snapshot.session_id.clone())
                .await
                .unwrap()
                .messages
        )
        .unwrap(),
        serde_json::to_value(&snapshot.messages).unwrap()
    );
    assert!(fixture
        .store
        .load_run_recovery(snapshot.session_id.clone())
        .await
        .unwrap()
        .is_none());
    assert!(fixture
        .store
        .read_managed_runtime_operation(guard.binding().unwrap().identity)
        .await
        .unwrap()
        .unwrap()
        .observation
        .is_none());
}

#[tokio::test]
async fn runtime_mcp_pending_expiry_has_no_sdk_send_or_run_admission() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    write_stdio_fixture(fixture.path.parent().unwrap());
    let server = NoProviderAttempt::new();
    let snapshot = stored(&fixture, SessionBehavior::Direct, &server.base_url).await;
    let guard = fixture.guard(1_500).await;
    let (parts, original, registry) = build_with_registry(&fixture, &snapshot, &guard).await;
    let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = tokio::sync::oneshot::channel();
    let holding = tokio::spawn(hold_request_connection(
        registry.clone(),
        entered_tx,
        release_rx,
    ));
    entered_rx.await.unwrap();
    let service = parts.service.clone();
    let pending = tokio::spawn(async move {
        service
            .submit_runtime_original(original, "/mcp__docs__review".into())
            .await
    });
    assert!(tokio::time::timeout(Duration::from_secs(4), pending)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert!(!parts.service.has_active_operation());
    assert_no_run(&fixture, &snapshot, &guard).await;
    let requests =
        std::fs::read_to_string(fixture.path.parent().unwrap().join("requests")).unwrap();
    assert!(!requests.lines().any(|line| line == "prompts/get"));
    release_tx.send(()).unwrap();
    holding.await.unwrap();
    wait_for_owned_child_exit(fixture.path.parent().unwrap()).await;
    server.assert_no_attempt();
    drop(registry);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_mcp_pending_caller_abort_closes_original_and_owned_process() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let root = fixture.path.parent().unwrap();
    write_stdio_fixture(root);
    std::fs::write(root.join("block"), "owned").unwrap();
    let server = NoProviderAttempt::new();
    let snapshot = stored(&fixture, SessionBehavior::Direct, &server.base_url).await;
    let guard = fixture.guard(20_000).await;
    let (parts, original, registry) = build_with_registry(&fixture, &snapshot, &guard).await;
    let service = parts.service.clone();
    let pending = tokio::spawn(async move {
        service
            .submit_runtime_original(original, "/mcp__docs__review".into())
            .await
    });
    tokio::time::timeout(Duration::from_secs(3), async {
        while !root.join("entered").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    pending.abort();
    assert!(matches!(pending.await, Err(error) if error.is_cancelled()));
    assert!(guard.check_now().is_err());
    wait_for_owned_child_exit(root).await;
    assert!(!parts.service.has_active_operation());
    assert_no_run(&fixture, &snapshot, &guard).await;
    server.assert_no_attempt();
    drop(registry);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_mcp_original_run_continues_after_initial_http_expiry_with_fresh_lease() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    write_stdio_fixture(fixture.path.parent().unwrap());
    let tool_response = serde_json::json!({"status":"completed", "output":[{
        "type":"function_call", "call_id":"mcp-original", "name":"mcp__docs__echo", "arguments":"{}"
    }], "usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}})
    .to_string();
    let (observed_tx, observed_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![
            ScriptedResponse::json("200 OK", tool_response),
            ScriptedResponse::json("200 OK", response()),
        ],
        move |index, _| {
            if index == 0 {
                observed_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(6)).unwrap();
            }
        },
    );
    let snapshot = stored(&fixture, SessionBehavior::Direct, &server.base_url).await;
    let guard = ManagedRuntimeLeaseGuard::new(
        fixture.store.clone(),
        fixture.active_with_original_lifetime(20_000, 2_000).await,
    )
    .await
    .unwrap();
    let (parts, original, registry) = build_with_registry(&fixture, &snapshot, &guard).await;
    let handle = parts
        .service
        .submit_runtime_original(original, "/mcp__docs__review".into())
        .await
        .unwrap();
    tokio::task::spawn_blocking(move || observed_rx.recv_timeout(Duration::from_secs(3)).unwrap())
        .await
        .unwrap();
    let native = parts
        .service
        .observe_runtime_original_run(&handle.run_id, &guard)
        .unwrap();
    assert_eq!(renew_original(&guard, &native, [71; 32]).await.sequence, 2);
    let remaining =
        guard.binding().unwrap().original_expires_ms - native_clock().unwrap().wall_ms();
    if remaining > 0 {
        tokio::time::sleep(Duration::from_millis(remaining as u64 + 20)).await;
    }
    assert!(guard.check_initial_admission_now().is_err());
    assert!(guard.check_now().is_ok());
    assert_eq!(renew_original(&guard, &native, [72; 32]).await.sequence, 3);
    release_tx.send(()).unwrap();
    ended(&parts.service).await;
    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    assert!(String::from_utf8_lossy(&requests[0].body).contains("remote fixture"));
    assert!(String::from_utf8_lossy(&requests[1].body).contains("tool fixture"));
    let mcp_requests =
        std::fs::read_to_string(fixture.path.parent().unwrap().join("requests")).unwrap();
    assert_eq!(
        mcp_requests
            .lines()
            .filter(|line| *line == "prompts/get")
            .count(),
        1
    );
    assert_eq!(
        mcp_requests
            .lines()
            .filter(|line| *line == "tools/call")
            .count(),
        1
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    wait_for_owned_child_exit(fixture.path.parent().unwrap()).await;
    assert!(guard.check_now().is_err());
    assert!(parts.service.try_submit_prompt("successor".into()).is_err());
    drop(registry);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}
