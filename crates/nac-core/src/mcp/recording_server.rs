//! A loopback MCP server and NAC home for tests that follow sessions across disconnect and logout.

use super::test_support::{
    read_fake_http_request, restore_env, toml_string, unique_temp_dir, write_fake_http_response,
};
use serde_json::json;
use std::env;
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Default)]
struct Behavior {
    /// Holds the first tools/call: signals arrival, then waits for a release.
    held: Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>,
    /// Answers tools/call carrying this Authorization header with 401, as for a revoked token.
    rejected_authorization: Option<String>,
}

/// Serves one echo tool and one prompt, recording each JSON-RPC method with its Authorization header.
pub(crate) struct RecordingMcpServer {
    pub(crate) url: String,
    requests: Arc<Mutex<Vec<(String, Option<String>)>>>,
    stop: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl RecordingMcpServer {
    pub(crate) fn start() -> Self {
        Self::start_with(Behavior::default())
    }

    pub(crate) fn start_holding_first_call() -> (Self, mpsc::Receiver<()>, mpsc::Sender<()>) {
        let (arrived, arrival) = mpsc::channel();
        let (release_sender, release) = mpsc::channel();
        let server = Self::start_with(Behavior {
            held: Some((arrived, release)),
            ..Behavior::default()
        });
        (server, arrival, release_sender)
    }

    pub(crate) fn start_rejecting(authorization: &str) -> Self {
        Self::start_with(Behavior {
            rejected_authorization: Some(authorization.to_string()),
            ..Behavior::default()
        })
    }

    fn start_with(mut behavior: Behavior) -> Self {
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
                let authorization = request.headers.get("authorization").cloned();
                recorded
                    .lock()
                    .unwrap()
                    .push((method.clone(), authorization.clone()));
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
                        if let Some((arrived, release)) = behavior.held.take() {
                            arrived.send(()).unwrap();
                            release.recv_timeout(Duration::from_secs(10)).unwrap();
                        }
                        if authorization.is_some()
                            && authorization == behavior.rejected_authorization
                        {
                            super::test_support::write_fake_http_response_with_headers(
                                &mut stream,
                                "401 Unauthorized",
                                &["WWW-Authenticate: Bearer error=\"invalid_token\""],
                                None,
                                "",
                            );
                            continue;
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
    pub(crate) fn authorizations(&self, method: &str) -> Vec<Option<String>> {
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

/// A NAC home configuring one HTTP server, installed as `NAC_HOME` until dropped.
pub(crate) struct TestHome {
    pub(crate) path: PathBuf,
    restore: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl TestHome {
    pub(crate) fn new(label: &str, server_name: &str, url: &str) -> Self {
        Self::with_server(label, server_name, url, "")
    }

    /// `extra` is appended to the config after the server's table.
    pub(crate) fn with_server(label: &str, server_name: &str, url: &str, extra: &str) -> Self {
        let path = unique_temp_dir(label);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
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
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
