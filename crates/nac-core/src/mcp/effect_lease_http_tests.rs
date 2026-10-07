//! Actual HTTP MCP sockets under the captured original; no provider calls.
use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};

struct HttpFixture {
    url: String,
    calls: Arc<AtomicUsize>,
    entered: mpsc::UnboundedReceiver<()>,
    closed: mpsc::UnboundedReceiver<()>,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    task: Option<JoinHandle<()>>,
}

impl HttpFixture {
    async fn new() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let (entered_tx, entered) = mpsc::unbounded_channel();
        let (closed_tx, closed) = mpsc::unbounded_channel();
        let (stop, mut stopped) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            let mut connections = JoinSet::new();
            loop {
                tokio::select! {
                    biased;
                    _ = &mut stopped => break,
                    result = connections.join_next(), if !connections.is_empty() => {
                        result.unwrap().unwrap();
                    }
                    incoming = listener.accept() => {
                        let (stream, _) = incoming.unwrap();
                        connections.spawn(serve_request(
                            stream, observed.clone(), entered_tx.clone(), closed_tx.clone(),
                        ));
                    }
                }
            }
            // Cleanup owns only this fixture's accepted sockets and task handles.
            connections.shutdown().await;
        });
        Self {
            url,
            calls,
            entered,
            closed,
            stop: Some(stop),
            task: Some(task),
        }
    }

    fn configure(&self, fixture: &Fixture) {
        fs::write(fixture.root.join("config.toml"), format!(
            "[mcp_servers.docs]\nrequired = true\napproval = \"allow\"\ntransport = \"streamable_http\"\nurl = {}\n",
            serde_json::to_string(&self.url).unwrap(),
        )).unwrap();
    }

    async fn finish(mut self) {
        self.stop.take().unwrap().send(()).unwrap();
        timeout(Duration::from_secs(2), self.task.take().unwrap())
            .await
            .unwrap()
            .unwrap();
    }
}

impl Drop for HttpFixture {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

async fn write_response(stream: &mut TcpStream, status: &str, body: Option<Value>) {
    let body = body.map(|body| body.to_string()).unwrap_or_default();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len(),
    );
    stream.write_all(response.as_bytes()).await.unwrap();
}

async fn read_request(stream: &mut TcpStream) -> Option<Value> {
    // Bound the disposable fixture parser; reqwest sends known-length JSON.
    let mut bytes = Vec::new();
    let header_end = loop {
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break end + 4;
        }
        let mut buffer = [0; 1024];
        let count = stream.read(&mut buffer).await.unwrap();
        if count == 0 {
            return None;
        }
        bytes.extend_from_slice(&buffer[..count]);
        assert!(bytes.len() <= 65536);
    };
    let headers = std::str::from_utf8(&bytes[..header_end]).unwrap();
    if !headers.starts_with("POST ") {
        write_response(stream, "405 Method Not Allowed", None).await;
        return None;
    }
    let length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .expect("known-length fixture JSON");
    assert!(length <= 32768);
    while bytes.len() < header_end + length {
        let mut buffer = [0; 1024];
        let count = stream.read(&mut buffer).await.unwrap();
        assert_ne!(count, 0);
        bytes.extend_from_slice(&buffer[..count]);
    }
    Some(serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap())
}

async fn serve_request(
    mut stream: TcpStream,
    calls: Arc<AtomicUsize>,
    entered: mpsc::UnboundedSender<()>,
    closed: mpsc::UnboundedSender<()>,
) {
    let Some(request) = read_request(&mut stream).await else {
        return;
    };
    let method = request["method"].as_str().unwrap();
    if request.get("id").is_none() {
        write_response(&mut stream, "202 Accepted", None).await;
        return;
    }
    let result = match method {
        "initialize" => json!({
            "protocolVersion": request["params"]["protocolVersion"],
            "capabilities": {"tools": {}, "prompts": {}},
            "serverInfo": {"name": "owned-http-fixture", "version": "1"},
        }),
        "tools/list" => json!({"tools": [{
            "name": "echo", "description": "HTTP fixture", "inputSchema": {"type": "object"},
        }]}),
        "prompts/list" => json!({"prompts": [{"name": "review"}]}),
        "prompts/get" => json!({"messages": [{
            "role": "user", "content": {"type": "text", "text": "HTTP prompt fixture"},
        }]}),
        "tools/call" => {
            calls.fetch_add(1, Ordering::SeqCst);
            if request["params"]["arguments"]["block"] == true {
                entered.send(()).unwrap();
                // No reply can release the call. Observe local transport EOF
                // before fixture teardown, without claiming remote work stops.
                let mut byte = [0];
                let count = stream.read(&mut byte).await.unwrap();
                assert_eq!(count, 0, "blocked request connection must close");
                closed.send(()).unwrap();
                return;
            }
            json!({"content": [{"type": "text", "text": "HTTP tool fixture"}]})
        }
        _ => panic!("unexpected fixture method: {method}"),
    };
    write_response(
        &mut stream,
        "200 OK",
        Some(json!({
            "jsonrpc": "2.0", "id": request["id"], "result": result,
        })),
    )
    .await;
}

#[tokio::test]
async fn runtime_mcp_http_expiry_closes_captured_call_after_registry_drop() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let mut http = HttpFixture::new().await;
    let selected = Fixture::new(2_000).await;
    http.configure(&selected);
    let registry = selected.load(true).await;
    let capture = registry.capture_tool("mcp__docs__echo").unwrap();
    let later = capture.clone();
    let server = registry.servers["docs"].clone();
    drop(registry);
    let call = tokio::spawn(async move { capture.call(json!({"block": true}), false).await });
    timeout(Duration::from_secs(1), http.entered.recv())
        .await
        .unwrap()
        .unwrap();
    // Prevent the cleanup watcher from obtaining the connection. Its separately
    // retained SDK cancellation must close the outstanding HTTP socket anyway.
    let connection_lock = server.service.write().await;
    let result = timeout(Duration::from_secs(4), call)
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_error);
    assert!(!result.content.to_string().contains("HTTP tool fixture"));
    timeout(Duration::from_secs(1), http.closed.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(selected.guard.check_now().is_err());
    assert!(later.call(json!({}), false).await.is_error);
    assert_eq!(http.calls.load(Ordering::SeqCst), 1);
    drop(connection_lock);
    drop(server);
    drop(later);

    // Independent legacy construction still performs a real SDK request.
    let legacy_fixture = Fixture::new(20_000).await;
    http.configure(&legacy_fixture);
    let legacy = legacy_fixture.load(false).await;
    let result = legacy.call_tool("mcp__docs__echo", json!({}), false).await;
    assert!(!result.is_error, "{}", result.content);
    assert!(result.content.to_string().contains("HTTP tool fixture"));
    assert_eq!(http.calls.load(Ordering::SeqCst), 2);
    close_shared_mcp_service(legacy.servers["docs"].current_service().await).await;
    drop(legacy);
    legacy_fixture.finish().await;
    selected.finish().await;
    http.finish().await;
}
