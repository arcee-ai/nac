use super::super::tests::{certificate, client, identity, key};
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) fn issuer_identity() -> IssuerControlTlsIdentity {
    IssuerControlTlsIdentity {
        serving_chain: vec![certificate("host")],
        serving_key: key("host"),
        client_ca: certificate("ca"),
        // Distinct synthetic enrollment proves purpose is not CA membership.
        issuer_leaf_sha256: Sha256::digest(certificate("wrong-peer").as_ref()).into(),
    }
}

async fn exchange(addr: SocketAddr, peer: &str) -> Vec<u8> {
    let Ok(mut stream) = client(addr, Some(peer)).await else {
        return Vec::new();
    };
    let _ = stream.write_all(
        b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nX-Control-Channel-ID: 00000000-0000-4000-8000-000000000001\r\n\r\n"
    ).await;
    let mut reply = Vec::new();
    let _ = tokio::time::timeout(Duration::from_secs(2), stream.read_to_end(&mut reply))
        .await
        .unwrap();
    reply
}

#[tokio::test]
async fn issuer_purpose_requires_its_separate_pin_and_creates_a_fresh_channel_per_connection() {
    let listener =
        IssuerControlTlsListener::bind("127.0.0.1:0".parse().unwrap(), issuer_identity())
            .await
            .unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new().route(
        "/",
        axum::routing::get(
            |axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<
                AuthenticatedIssuerControlPeer,
            >| async move {
                assert_eq!(
                    peer.leaf_sha256(),
                    Sha256::digest(certificate("wrong-peer").as_ref()).as_slice(),
                    "marker reflects independently configured issuer certificate"
                );
                peer.channel_id().to_string()
            },
        ),
    );
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<AuthenticatedIssuerControlPeer>(),
        )
        .await
        .unwrap();
    });
    let _stalled = TcpStream::connect(addr).await.unwrap();
    for ordinary in ["nac-api", "untrusted"] {
        assert!(
            exchange(addr, ordinary).await.is_empty(),
            "ordinary or untrusted peer cannot reach issuer purpose"
        );
    }
    let mut ids = Vec::new();
    for _ in 0..2 {
        let reply = String::from_utf8(exchange(addr, "wrong-peer").await).unwrap();
        assert!(
            reply.starts_with("HTTP/1.1 200"),
            "configured issuer reaches only the fixture marker handler"
        );
        ids.push(Uuid::parse_str(reply.split_once("\r\n\r\n").unwrap().1).unwrap());
    }
    assert_ne!(
        ids[0], ids[1],
        "connection replacement must receive a new native channel identity"
    );
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn ordinary_runtime_marker_and_serialized_channel_selector_cannot_upcast_to_issuer_purpose() {
    let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    let app = Router::new().route(
        "/",
        axum::routing::get(|request: axum::extract::Request| async move {
            assert!(
                request
                    .extensions()
                    .get::<axum::extract::ConnectInfo<AuthenticatedRuntimePeer>>()
                    .is_some(),
                "fixture has the actual ordinary runtime marker"
            );
            assert!(
                request
                    .extensions()
                    .get::<axum::extract::ConnectInfo<AuthenticatedIssuerControlPeer>>()
                    .is_none(),
                "ordinary marker cannot confer issuer purpose"
            );
            axum::http::StatusCode::UNAUTHORIZED
        }),
    );
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<AuthenticatedRuntimePeer>(),
        )
        .await
        .unwrap();
    });
    let response = exchange(addr, "nac-api").await;
    assert!(
        response.starts_with(b"HTTP/1.1 401"),
        "request-supplied channel ID cannot establish issuer role"
    );
    assert!(
        exchange(addr, "wrong-peer").await.is_empty(),
        "issuer enrollment does not grant ordinary runtime enrollment"
    );
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn configured_issuer_still_grants_no_effect_and_invalid_identity_fails_before_bind() {
    let listener =
        IssuerControlTlsListener::bind("127.0.0.1:0".parse().unwrap(), issuer_identity())
            .await
            .unwrap();
    let addr = listener.local_addr().unwrap();
    let touched = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let handler_touched = Arc::clone(&touched);
    let app = denied_issuer_router(Router::new().fallback(move || {
        handler_touched.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        async { "forbidden native effect" }
    }));
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<AuthenticatedIssuerControlPeer>(),
        )
        .await
        .unwrap();
    });
    assert!(
        exchange(addr, "wrong-peer")
            .await
            .starts_with(b"HTTP/1.1 401"),
        "enrolled issuer certificate alone supplies no current operation authority"
    );
    assert_eq!(
        touched.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "default denial precedes native effects"
    );
    let mut invalid = issuer_identity();
    invalid.issuer_leaf_sha256 = [0; 32];
    assert!(
        IssuerControlTlsListener::bind(addr, invalid)
            .await
            .err()
            .unwrap()
            .to_string()
            .contains("incomplete"),
        "identity is validated before address binding"
    );
    server.abort();
    let _ = server.await;
}
