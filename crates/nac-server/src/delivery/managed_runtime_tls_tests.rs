//! Dedicated synthetic test certificates/keys only. No runtime constructor loads
//! these fixtures; actual serving credentials and exact D peer pin are explicit.
use super::*;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};
use tokio_rustls::{rustls::pki_types::ServerName, TlsConnector};

fn certificate(name: &str) -> CertificateDer<'static> {
    let bytes: &[u8] = match name {
        "ca" => include_bytes!("fixtures/managed_fact_tls/ca.der"),
        "host" => include_bytes!("fixtures/managed_fact_tls/host.der"),
        "d-service" => include_bytes!("fixtures/managed_fact_tls/d-service.der"),
        "wrong-peer" => include_bytes!("fixtures/managed_fact_tls/wrong-peer.der"),
        "untrusted" => include_bytes!("fixtures/managed_fact_tls/untrusted.der"),
        _ => panic!("unknown synthetic certificate"),
    };
    CertificateDer::from(bytes.to_vec())
}

fn key(name: &str) -> PrivateKeyDer<'static> {
    let bytes: &[u8] = match name {
        "host" => include_bytes!("fixtures/managed_fact_tls/host-key.der"),
        "d-service" => include_bytes!("fixtures/managed_fact_tls/d-service-key.der"),
        "wrong-peer" => include_bytes!("fixtures/managed_fact_tls/wrong-peer-key.der"),
        "untrusted" => include_bytes!("fixtures/managed_fact_tls/untrusted-key.der"),
        _ => panic!("unknown synthetic key"),
    };
    PrivateKeyDer::try_from(bytes.to_vec()).unwrap()
}

pub(crate) fn identity() -> RuntimeTlsIdentity {
    RuntimeTlsIdentity {
        serving_chain: vec![certificate("host")],
        serving_key: key("host"),
        client_ca: certificate("ca"),
        d_service_leaf_sha256: Sha256::digest(certificate("d-service").as_ref()).into(),
    }
}

pub(crate) async fn client(
    addr: SocketAddr,
    peer: Option<&str>,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>> {
    let mut roots = rustls::RootCertStore::empty();
    roots.add(certificate("ca"))?;
    let builder = rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()?
    .with_root_certificates(roots);
    let config = match peer {
        Some(peer) => builder.with_client_auth_cert(vec![certificate(peer)], key(peer))?,
        None => builder.with_no_client_auth(),
    };
    Ok(TlsConnector::from(Arc::new(config))
        .connect(
            ServerName::try_from("localhost")?,
            TcpStream::connect(addr).await?,
        )
        .await?)
}

pub(crate) async fn exchange(
    addr: SocketAddr,
    peer: Option<&str>,
    method: &str,
    path: &str,
    body: &[u8],
    headers: &[(&str, String)],
) -> Result<(u16, serde_json::Value)> {
    let mut stream = client(addr, peer).await?;
    let extra = headers
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect::<String>();
    let head = format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n{extra}\r\n", body.len());
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body).await?;
    let mut reply = Vec::new();
    let _ = stream.read_to_end(&mut reply).await;
    let text = String::from_utf8(reply)?;
    let (head, body) = text
        .split_once("\r\n\r\n")
        .ok_or_else(|| anyhow::anyhow!("no HTTP response"))?;
    let status = head
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("no status"))?
        .parse()?;
    let body = if body.is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::from_str(body)?
    };
    Ok((status, body))
}

#[tokio::test]
async fn only_exact_enrolled_d_peer_reaches_http_and_stalled_handshake_does_not_block_it() {
    let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop, done) = oneshot::channel();
    let task = tokio::spawn(serve_authenticated_runtime(
        listener,
        Router::new().route("/probe", axum::routing::get(|| async { "" })),
        async {
            let _ = done.await;
        },
    ));
    let stalled = TcpStream::connect(addr).await.unwrap();
    for peer in [None, Some("wrong-peer"), Some("untrusted")] {
        let response = tokio::time::timeout(
            Duration::from_secs(2),
            exchange(addr, peer, "GET", "/probe", b"", &[]),
        )
        .await
        .unwrap();
        assert!(
            response.is_err(),
            "untrusted/mismatched peer must not reach HTTP"
        );
    }
    let (status, _) = tokio::time::timeout(
        Duration::from_secs(2),
        exchange(addr, Some("d-service"), "GET", "/probe", b"", &[]),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(status, 200);
    drop(stalled);
    stop.send(()).unwrap();
    task.await.unwrap().unwrap();
}

#[tokio::test]
async fn incomplete_identity_is_rejected_before_listener_bind() {
    let mut invalid = identity();
    invalid.d_service_leaf_sha256 = [0; 32];
    assert!(
        RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), invalid)
            .await
            .is_err(),
        "zero D peer pin must fail closed"
    );
}

#[tokio::test]
async fn mediated_plaintext_fence_preserves_standalone_and_blocks_new_runtime_routes() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tower::ServiceExt;
    let effect = Arc::new(AtomicBool::new(false));
    let call = Arc::clone(&effect);
    let native = Router::new()
        .route(
            "/future",
            axum::routing::post(move || {
                let call = Arc::clone(&call);
                async move {
                    call.store(true, Ordering::SeqCst);
                    ""
                }
            }),
        )
        .route("/readyz", axum::routing::get(|| async { "" }));
    let standalone = native
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/future")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(standalone.status(), 200);
    effect.store(false, Ordering::SeqCst);
    let fenced = mediated_only_plaintext_router(native);
    let response = fenced
        .clone()
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri("/future")
                .header("x-forwarded-client-cert", "d-service")
                .header("x-nac-verified", "true")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    assert!(
        !effect.load(Ordering::SeqCst),
        "fenced runtime request must have no effect"
    );
    let probe = fenced
        .oneshot(
            axum::http::Request::builder()
                .uri("/readyz")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(probe.status(), 200);
}
