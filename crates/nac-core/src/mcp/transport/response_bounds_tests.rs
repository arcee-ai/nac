use super::*;
use crate::mcp::{oauth, recording_server::TestHome};
use crate::TEST_ENV_LOCK;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

/// A finite peer supplies either a length hint or chunked bytes. The latter
/// forces the transport to count bytes rather than trusting Content-Length.
async fn response_peer(
    status: &str,
    body: Vec<u8>,
    chunked: bool,
) -> (Arc<str>, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/mcp", listener.local_addr().unwrap());
    let status = status.to_owned();
    let peer = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        loop {
            let mut bytes = [0; 4096];
            let read = stream.read(&mut bytes).await.unwrap();
            assert_ne!(read, 0);
            request.extend_from_slice(&bytes[..read]);
            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let framing = if chunked {
            "Transfer-Encoding: chunked".to_string()
        } else {
            format!("Content-Length: {}", body.len())
        };
        let headers = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nConnection: close\r\n{framing}\r\n\r\n");
        if stream.write_all(headers.as_bytes()).await.is_err() {
            return;
        }
        for chunk in body.chunks(32 * 1024) {
            if chunked
                && stream
                    .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                    .await
                    .is_err()
            {
                return;
            }
            // Rejection is allowed to close the socket before the finite peer finishes.
            if stream.write_all(chunk).await.is_err() {
                return;
            }
            if chunked && stream.write_all(b"\r\n").await.is_err() {
                return;
            }
        }
        if chunked {
            let _ = stream.write_all(b"0\r\n\r\n").await;
        }
    });
    (url.into(), peer)
}

async fn check_bounds(client: &impl StreamableHttpClient<Error = reqwest::Error>) {
    for (status, limit) in [("200 OK", 16 * 1024 * 1024), ("400 Bad Request", 64 * 1024)] {
        for chunked in [false, true] {
            let (url, peer) = response_peer(status, vec![b' '; limit + 1], chunked).await;
            let message = serde_json::from_value(serde_json::json!({
                "jsonrpc":"2.0", "id":1, "method":"tools/list"
            }))
            .unwrap();
            let result = tokio::time::timeout(
                Duration::from_secs(5),
                client.post_message(url, message, None, None, HashMap::new()),
            )
            .await
            .unwrap();
            assert!(
                matches!(result, Err(StreamableHttpError::ResponseBodyTooLarge { max_size }) if max_size == limit)
            );
            peer.await.unwrap();
        }
    }
    let (url, peer) = response_peer("200 OK", br#"{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"ok"}],"structuredContent":{"ok":true}}}"#.to_vec(), true).await;
    let message = serde_json::from_value(serde_json::json!({
        "jsonrpc":"2.0", "id":1, "method":"tools/call", "params":{"name":"echo"}
    }))
    .unwrap();
    let StreamableHttpPostResponse::Json(message, _) = client
        .post_message(url, message, None, None, HashMap::new())
        .await
        .unwrap()
    else {
        panic!("valid rich JSON result must remain JSON");
    };
    let result = serde_json::to_value(message).unwrap();
    assert_eq!(result["result"]["content"][0]["text"], "ok");
    assert_eq!(result["result"]["structuredContent"]["ok"], true);
    peer.await.unwrap();
}

#[tokio::test]
async fn plain_http_rejects_oversized_json_and_error_bodies() {
    check_bounds(&reqwest::Client::builder().no_proxy().build().unwrap()).await;
}

#[tokio::test(flavor = "current_thread")]
async fn oauth_adapter_retains_response_limits_and_valid_rich_results() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let endpoint = "https://mcp.example.test/mcp";
    let home = TestHome::new("response-bounds", "oauth", endpoint);
    oauth::test_support::seed_authorization(
        &home.path,
        "oauth",
        endpoint,
        "TEST_MCP_CLIENT_ID",
        "bounds-canary",
        None,
    )
    .unwrap();
    let client = NacOAuthClient {
        inner: AuthClient::new(
            reqwest::Client::builder().no_proxy().build().unwrap(),
            oauth::authorized_manager(&home.path, "oauth", endpoint)
                .await
                .unwrap(),
        ),
        step_up_manager: Arc::new(tokio::sync::Mutex::new(None)),
        cwd: home.path.clone(),
        server_name: "oauth".into(),
        endpoint: endpoint.into(),
    };
    check_bounds(&client).await;
}
