use super::test_support::{
    read_fake_http_request, restore_env, toml_string, unique_temp_dir, write_fake_http_response,
};
use super::*;
use crate::TEST_ENV_LOCK;
use serde_json::json;
use std::fs;
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Mutex};
use std::thread;

/// Serves one echo tool and one prompt, recording each JSON-RPC method with its Authorization header.
struct RecordingMcpServer {
    url: String,
    requests: Arc<Mutex<Vec<(String, Option<String>)>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl RecordingMcpServer {
    fn start() -> Self {
        Self::start_with(None)
    }

    /// Starts a server whose first tools/call waits, after signalling arrival, for a release.
    fn start_holding_first_call() -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (arrived, arrival) = mpsc::channel();
        let (release_sender, release) = mpsc::channel();
        (
            Self::start_with(Some((arrived, release))),
            arrival,
            release_sender,
        )
    }

    fn start_with(mut held: Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>) -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind recording MCP server");
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (recorded, stopped) = (Arc::clone(&requests), Arc::clone(&stop));
        let handle = thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let mut stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(_) => return,
                };
                let Some(request) = read_fake_http_request(&mut stream) else {
                    continue;
                };
                let Some(body) = request.body.filter(|_| request.method == "POST") else {
                    write_fake_http_response(&mut stream, "405 Method Not Allowed", None, "");
                    continue;
                };
                let method = body["method"].as_str().unwrap_or_default().to_string();
                recorded.lock().unwrap().push((
                    method.clone(),
                    request.headers.get("authorization").cloned(),
                ));
                let result = match method.as_str() {
                    "initialize" => json!({
                        "protocolVersion": "2025-06-18",
                        "capabilities": {"tools": {"listChanged": false}, "prompts": {"listChanged": false}},
                        "serverInfo": {"name": "recording-mcp", "version": "0.1.0"}
                    }),
                    "prompts/list" => json!({"prompts": []}),
                    "tools/list" => json!({"tools": [{
                        "name": "echo",
                        "inputSchema": {"type": "object", "properties": {}}
                    }]}),
                    "tools/call" => {
                        if let Some((arrived, release)) = held.take() {
                            arrived.send(()).unwrap();
                            release.recv_timeout(Duration::from_secs(10)).unwrap();
                        }
                        json!({"content": [{"type": "text", "text": "echoed"}]})
                    }
                    _ => {
                        write_fake_http_response(&mut stream, "202 Accepted", None, "");
                        continue;
                    }
                };
                let response = json!({"jsonrpc": "2.0", "id": body["id"], "result": result});
                write_fake_http_response(
                    &mut stream,
                    "200 OK",
                    Some("application/json"),
                    &response.to_string(),
                );
            }
        });
        Self {
            url,
            requests,
            stop,
            handle: Some(handle),
        }
    }

    /// The Authorization header of every request for `method`, in arrival order.
    fn authorizations(&self, method: &str) -> Vec<Option<String>> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|(recorded, _)| recorded == method)
            .map(|(_, authorization)| authorization.clone())
            .collect()
    }
}

impl Drop for RecordingMcpServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

struct TestHome {
    path: PathBuf,
    restore: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl TestHome {
    fn new(label: &str, server_name: &str, url: &str) -> Self {
        Self::with_server(label, server_name, url, "")
    }

    fn with_server(label: &str, server_name: &str, url: &str, extra: &str) -> Self {
        let path = unique_temp_dir(label);
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("config.toml"),
            format!(
                "[mcp_servers.{server_name}]\ntransport = \"streamable_http\"\nurl = {}\napproval = \"allow\"\n{extra}",
                toml_string(url)
            ),
        )
        .unwrap();
        let restore = ["NAC_HOME", "TEST_MCP_CLIENT_ID"]
            .into_iter()
            .map(|name| (name, env::var_os(name)))
            .collect();
        unsafe {
            env::set_var("NAC_HOME", &path);
            env::set_var("TEST_MCP_CLIENT_ID", "public-test-client");
        }
        Self { path, restore }
    }
}

impl Drop for TestHome {
    fn drop(&mut self) {
        for (name, value) in self.restore.drain(..) {
            restore_env(name, value);
        }
        let _ = fs::remove_dir_all(&self.path);
    }
}

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

    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
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
    oauth::test_support::seed_authorization(
        &cwd,
        "oauth",
        &server.url,
        "TEST_MCP_CLIENT_ID",
        "first-access-canary",
    )
    .unwrap();
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

    oauth::test_support::seed_authorization(
        &cwd,
        "oauth",
        &server.url,
        "TEST_MCP_CLIENT_ID",
        "second-access-canary",
    )
    .unwrap();
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
