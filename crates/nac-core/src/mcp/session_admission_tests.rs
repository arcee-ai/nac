use super::recording_server::{RecordingMcpServer, TestHome};
use super::*;
use crate::TEST_ENV_LOCK;
use serde_json::json;
use std::fs;
use std::sync::mpsc;

async fn load(cwd: &Path) -> McpLoadOutcome {
    McpRegistry::load_reporting_skips(
        cwd,
        None,
        &PathContext::new(cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .unwrap()
}

fn seed_authorization(cwd: &Path, url: &str, token: &str, expires_in: Option<u64>) {
    oauth::test_support::seed_authorization(
        cwd,
        "oauth",
        url,
        "TEST_MCP_CLIENT_ID",
        token,
        expires_in,
    )
    .unwrap();
}

#[tokio::test]
async fn disconnect_stops_mounted_and_new_sessions_until_connect() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-disconnect-admission", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    // Captured before the disconnect, as an approval that is still pending would be.
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);

    let handler = &registry.servers["recorded"].handler;
    assert!(handler.admitted_server().is_some());
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    // Progress, log and resource-update notifications pass only through this gate.
    assert!(handler.admitted_server().is_none());
    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(refused.content.to_string().contains("disconnected"));
    assert_eq!(server.authorizations("tools/call").len(), 1);
    let prompt_lists = server.authorizations("prompts/list").len();
    let prompts = registry
        .call_capability(
            capabilities::LIST_PROMPTS_TOOL,
            json!({"server": "recorded"}),
        )
        .await;
    assert!(prompts.is_error);
    assert!(prompts.content.to_string().contains("disconnected"));
    assert_eq!(server.authorizations("prompts/list").len(), prompt_lists);

    let initializations = server.authorizations("initialize").len();
    let fresh = load(&cwd).await;
    assert!(fresh.registry.is_none());
    assert!(fresh
        .skipped
        .iter()
        .any(|skipped| skipped.name == "recorded" && skipped.reason.contains("disconnected")));
    assert_eq!(server.authorizations("initialize").len(), initializations);

    let restarted = McpRuntimeManager::new(home.path.clone());
    let status = restarted.statuses().await.unwrap().remove(0);
    assert_eq!(status.state, McpRuntimeState::Disconnected);
    assert!(status.sessions_blocked);

    let connected = restarted.connect("recorded").await.unwrap();
    assert_eq!(connected.state, McpRuntimeState::Connected);
    assert!(!connected.sessions_blocked);
    assert!(!capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 2);
    restarted.disconnect("recorded").await.unwrap();
    restarted.forget("recorded").await;
    drop(registry);
}

#[tokio::test]
async fn logout_stops_a_mounted_session_from_sending_until_reauthorized() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-logout-admission", "oauth", &server.url);
    let cwd = std::env::current_dir().unwrap();
    seed_authorization(&cwd, &server.url, "first-access-canary", None);
    let registry = load(&cwd).await.registry.expect("OAuth server mounts");
    let capture = registry.capture_tool("mcp__oauth__echo").unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);

    clear_mcp_oauth(&cwd, "oauth").unwrap();
    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(!refused.content.to_string().contains("canary"));
    assert_eq!(
        server.authorizations("tools/call"),
        vec![Some("Bearer first-access-canary".to_string())]
    );

    seed_authorization(&cwd, &server.url, "second-access-canary", None);
    assert!(!capture.call(json!({}), false).await.is_error);
    assert_eq!(
        server
            .authorizations("tools/call")
            .last()
            .cloned()
            .flatten(),
        Some("Bearer second-access-canary".to_string())
    );
    drop(registry);
    drop(home);
}

#[tokio::test]
async fn an_expired_token_without_refresh_is_never_sent_or_replaced_by_no_credentials() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let _home = TestHome::new("nac-mcp-expired-token", "oauth", &server.url);
    let cwd = std::env::current_dir().unwrap();
    seed_authorization(&cwd, &server.url, "live-access-canary", None);
    let registry = load(&cwd).await.registry.expect("OAuth server mounts");
    let capture = registry.capture_tool("mcp__oauth__echo").unwrap();

    // Issued at the epoch and valid for a minute: expired, with no refresh token to renew it.
    seed_authorization(&cwd, &server.url, "expired-access-canary", Some(60));
    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(!refused.content.to_string().contains("canary"));
    assert!(server.authorizations("tools/call").is_empty());
    drop(registry);
}

#[tokio::test]
async fn a_token_the_server_revoked_fails_once_without_an_unauthenticated_retry() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start_rejecting("Bearer revoked-access-canary");
    let _home = TestHome::new("nac-mcp-revoked-token", "oauth", &server.url);
    let cwd = std::env::current_dir().unwrap();
    seed_authorization(&cwd, &server.url, "revoked-access-canary", None);
    let registry = load(&cwd).await.registry.expect("OAuth server mounts");
    let capture = registry.capture_tool("mcp__oauth__echo").unwrap();

    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(!refused.content.to_string().contains("canary"));
    assert_eq!(
        server.authorizations("tools/call"),
        vec![Some("Bearer revoked-access-canary".to_string())]
    );
    drop(registry);
}

/// Starts the capture's call and waits until the server holds it.
async fn call_held(
    capture: &McpToolCapture,
    arrival: mpsc::Receiver<()>,
) -> tokio::task::JoinHandle<ToolResult> {
    let capture = capture.clone();
    let call = tokio::spawn(async move { capture.call(json!({}), false).await });
    tokio::task::spawn_blocking(move || arrival.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("the call reaches the server");
    call
}

#[tokio::test]
async fn a_call_running_across_disconnect_settles_once() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let (server, arrival, release) = RecordingMcpServer::start_holding_first_call();
    let home = TestHome::new("nac-mcp-disconnect-in-flight", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let call = call_held(&capture, arrival).await;

    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    release.send(()).unwrap();
    let settled = call.await.unwrap();
    assert!(!settled.is_error, "{}", settled.content);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    assert!(capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    drop(registry);
}

#[tokio::test]
async fn a_call_interrupted_across_disconnect_is_not_replayed() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let (server, arrival, release) = RecordingMcpServer::start_holding_first_call();
    let home = TestHome::new("nac-mcp-disconnect-interrupted", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let call = call_held(&capture, arrival).await;

    McpRuntimeManager::new(home.path.clone())
        .disconnect("recorded")
        .await
        .unwrap();
    call.abort();
    assert!(call.await.unwrap_err().is_cancelled());
    release.send(()).unwrap();
    assert!(capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    drop(registry);
}

#[tokio::test]
async fn an_unreadable_disconnect_record_fails_closed_until_connect_repairs_it() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "nac-mcp-unreadable-state",
        "recorded",
        &server.url,
        "[mcp_servers.other]\ntransport = \"streamable_http\"\nurl = \"http://127.0.0.1:9/mcp\"\n",
    );
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    fs::write(home.path.join("mcp_disconnected.json"), "not json").unwrap();
    assert!(capture.call(json!({}), false).await.is_error);
    assert!(server.authorizations("tools/call").is_empty());

    let runtime = McpRuntimeManager::new(home.path.clone());
    let statuses = runtime.statuses().await.unwrap();
    assert_eq!(statuses.len(), 2);
    assert!(statuses.iter().all(|status| status.sessions_blocked
        && status
            .error
            .as_deref()
            .is_some_and(|error| error.contains("unreadable"))));

    runtime.connect("recorded").await.unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);
    let statuses = runtime.statuses().await.unwrap();
    let blocked = |name: &str| {
        statuses
            .iter()
            .find(|status| status.name == name)
            .unwrap()
            .sessions_blocked
    };
    assert!(!blocked("recorded"));
    assert!(blocked("other"), "repairing one server re-admitted another");
    runtime.forget("recorded").await;
    drop(registry);
}

#[tokio::test]
async fn renaming_a_disconnected_server_keeps_both_names_disconnected() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TestHome::new(
        "nac-mcp-rename-disconnected",
        "recorded",
        "http://127.0.0.1:9/mcp",
    );
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();

    runtime
        .keep_disconnected_after_rename("recorded", "renamed")
        .unwrap();
    let state = admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    assert!(state.is_disconnected("renamed").unwrap());
    // Running sessions keep the name they mounted.
    assert!(state.is_disconnected("recorded").unwrap());
}

const PROCESS_DIR: &str = "NAC_TEST_MCP_SESSION_DIR";

/// Run as a separate process by the cross-process test: mounts, waits for `go`, then calls.
#[tokio::test]
async fn mcp_session_process_helper() {
    let Some(dir) = std::env::var_os(PROCESS_DIR).map(PathBuf::from) else {
        return;
    };
    let cwd = std::env::current_dir().unwrap();
    let outcome = load(&cwd).await;
    let Some(registry) = outcome.registry else {
        let reasons = outcome
            .skipped
            .iter()
            .map(|skipped| skipped.reason.clone())
            .collect::<Vec<_>>();
        fs::write(
            dir.join("result"),
            format!("skipped: {}", reasons.join("; ")),
        )
        .unwrap();
        return;
    };
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    fs::write(dir.join("mounted"), "").unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !dir.join("go").exists() && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let result = capture.call(json!({}), false).await;
    fs::write(dir.join("result"), result.content.to_string()).unwrap();
}

#[tokio::test]
async fn disconnect_reaches_sessions_in_other_processes_and_survives_restart() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-cross-process", "recorded", &server.url);
    let spawn = |dir: &Path| {
        fs::create_dir_all(dir).unwrap();
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "mcp::session_admission_tests::mcp_session_process_helper",
            ])
            .env(PROCESS_DIR, dir)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap()
    };

    let mounted = home.path.join("mounted-session");
    let mut session = spawn(&mounted);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !mounted.join("mounted").exists() && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    McpRuntimeManager::new(home.path.clone())
        .disconnect("recorded")
        .await
        .unwrap();
    fs::write(mounted.join("go"), "").unwrap();
    assert!(session.wait().unwrap().success());
    assert!(fs::read_to_string(mounted.join("result"))
        .unwrap()
        .contains("was disconnected"));
    assert!(server.authorizations("tools/call").is_empty());

    let restarted = home.path.join("restarted-session");
    assert!(spawn(&restarted).wait().unwrap().success());
    let result = fs::read_to_string(restarted.join("result")).unwrap();
    assert!(
        result.starts_with("skipped:") && result.contains("disconnected"),
        "{result}"
    );
}
