use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_rustls::{rustls::pki_types::ServerName, TlsConnector};

fn certificate(name: &str) -> CertificateDer<'static> {
    let bytes: &[u8] = match name {
        "ca" => include_bytes!("fixtures/runtime_tls/ca.der"),
        "host" => include_bytes!("fixtures/runtime_tls/host.der"),
        "nac-api" => include_bytes!("fixtures/runtime_tls/nac-api.der"),
        "wrong-peer" => include_bytes!("fixtures/runtime_tls/wrong-peer.der"),
        "untrusted" => include_bytes!("fixtures/runtime_tls/untrusted.der"),
        _ => panic!("unknown fixture"),
    };
    CertificateDer::from(bytes.to_vec())
}

fn key(name: &str) -> PrivateKeyDer<'static> {
    let bytes: &[u8] = match name {
        "host" => include_bytes!("fixtures/runtime_tls/host-key.der"),
        "nac-api" => include_bytes!("fixtures/runtime_tls/nac-api-key.der"),
        "wrong-peer" => include_bytes!("fixtures/runtime_tls/wrong-peer-key.der"),
        "untrusted" => include_bytes!("fixtures/runtime_tls/untrusted-key.der"),
        _ => panic!("unknown fixture"),
    };
    PrivateKeyDer::try_from(bytes.to_vec()).unwrap()
}

fn identity() -> RuntimeTlsIdentity {
    RuntimeTlsIdentity {
        serving_chain: vec![certificate("host")],
        serving_key: key("host"),
        client_ca: certificate("ca"),
        nac_api_leaf_sha256: Sha256::digest(certificate("nac-api").as_ref()).into(),
    }
}

async fn client(
    addr: SocketAddr,
    peer: Option<&str>,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(certificate("ca")).unwrap();
    let builder = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_root_certificates(roots);
    let config = match peer {
        Some(peer) => builder
            .with_client_auth_cert(vec![certificate(peer)], key(peer))
            .unwrap(),
        None => builder.with_no_client_auth(),
    };
    Ok(TlsConnector::from(Arc::new(config))
        .connect(
            ServerName::try_from("localhost").unwrap(),
            TcpStream::connect(addr).await.unwrap(),
        )
        .await?)
}

async fn request(addr: SocketAddr, path: &str) -> String {
    let mut stream = client(addr, Some("nac-api")).await.unwrap();
    let method = if path.ends_with("/runs") {
        "POST"
    } else {
        "GET"
    };
    let raw = format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    stream.write_all(raw.as_bytes()).await.unwrap();
    let mut reply = Vec::new();
    // TLS close_notify is optional on HTTP Connection: close.
    let _ = stream.read_to_end(&mut reply).await;
    String::from_utf8(reply).unwrap()
}

#[tokio::test]
#[expect(
    clippy::await_holding_lock,
    reason = "native fixture serializes process-global model/config environment across async server use"
)]
async fn valid_peer_still_cannot_use_native_session_run_stream_or_mcp_routes() {
    let _lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::env::temp_dir().join(format!("nac-runtime-tls-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let _env = crate::tests::ScopedModelEnv::isolated(&root, None);
    let manager = crate::SessionManager::new(crate::ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .unwrap();
    let native = crate::router(manager.clone());
    let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(serve_denied_runtime(listener, native, async {
        let _ = shutdown_rx.await;
    }));
    for path in [
        "/sessions",
        "/sessions/fixture/runs",
        "/sessions/fixture/events/stream",
        "/mcp",
    ] {
        let reply = tokio::time::timeout(Duration::from_secs(2), request(addr, path))
            .await
            .unwrap();
        assert!(reply.starts_with("HTTP/1.1 401"), "{path}: {reply}");
    }
    shutdown_tx.send(()).unwrap();
    server.await.unwrap().unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn ca_enrollment_anonymous_and_plaintext_cannot_reach_http() {
    let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let touched = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let handler_touched = Arc::clone(&touched);
    let app = Router::new().route(
        "/",
        axum::routing::get(move || {
            handler_touched.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            async { "native handler" }
        }),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    for peer in [Some("wrong-peer"), Some("untrusted"), None] {
        let Ok(mut stream) = client(addr, peer).await else {
            continue;
        };
        let _ = stream
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await;
        let mut reply = Vec::new();
        let result =
            tokio::time::timeout(Duration::from_secs(2), stream.read_to_end(&mut reply)).await;
        assert!(result.is_ok());
        assert!(reply.is_empty());
    }
    let mut plaintext = TcpStream::connect(addr).await.unwrap();
    plaintext
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    let mut reply = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(2), plaintext.read_to_end(&mut reply))
        .await
        .unwrap();
    // rustls may return a TLS alert to a plaintext socket, never an HTTP reply.
    assert!(!reply.starts_with(b"HTTP/"));
    assert_eq!(touched.load(std::sync::atomic::Ordering::SeqCst), 0);
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn stalled_handshake_does_not_block_correct_peer_and_invalid_config_fails_before_bind() {
    let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(serve_denied_runtime(
        listener,
        Router::new(),
        std::future::pending(),
    ));
    let _stalled = TcpStream::connect(addr).await.unwrap();
    assert!(
        tokio::time::timeout(Duration::from_secs(2), request(addr, "/sessions"))
            .await
            .unwrap()
            .starts_with("HTTP/1.1 401")
    );
    let mut invalid = identity();
    invalid.nac_api_leaf_sha256 = [0; 32];
    assert!(RuntimeTlsListener::bind(addr, invalid)
        .await
        .err()
        .unwrap()
        .to_string()
        .contains("incomplete"));
    server.abort();
    let _ = server.await;
}
