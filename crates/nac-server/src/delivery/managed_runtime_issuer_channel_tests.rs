//! Actual purpose TLS connections, including a handler waiting before response.
use super::super::tests::client;
use super::tests::issuer_identity;
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) async fn connected_stream() -> (
    channel::IssuerControlStream,
    tokio_rustls::client::TlsStream<TcpStream>,
) {
    let mut listener =
        IssuerControlTlsListener::bind("127.0.0.1:0".parse().unwrap(), issuer_identity())
            .await
            .unwrap();
    let addr = listener.local_addr().unwrap();
    let accepting =
        tokio::spawn(async move { axum::serve::Listener::accept(&mut listener).await.0 });
    let socket = client(addr, Some("wrong-peer")).await.unwrap();
    (accepting.await.unwrap(), socket)
}

async fn reply(stream: &mut tokio_rustls::client::TlsStream<TcpStream>) {
    let mut header = Vec::new();
    while !header.ends_with(b"\r\n\r\n") {
        assert!(header.len() < 4096);
        header.push(stream.read_u8().await.unwrap());
    }
    let header = String::from_utf8(header).unwrap();
    assert!(header.starts_with("HTTP/1.1 200"), "{header}");
    let length = header
        .lines()
        .find_map(|line| {
            line.to_ascii_lowercase()
                .strip_prefix("content-length: ")
                .map(|value| value.parse::<usize>().unwrap())
        })
        .unwrap();
    let mut body = vec![0; length];
    stream.read_exact(&mut body).await.unwrap();
    assert_eq!(body, b"ok");
}

#[tokio::test]
async fn issuer_channel_keeps_one_identity_per_socket_and_closes_retained_clones() {
    let listener =
        IssuerControlTlsListener::bind("127.0.0.1:0".parse().unwrap(), issuer_identity())
            .await
            .unwrap();
    let addr = listener.local_addr().unwrap();
    let (seen_tx, mut seen_rx) = tokio::sync::mpsc::unbounded_channel();
    let app = Router::new().route(
        "/",
        axum::routing::get(
            move |axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<
                AuthenticatedIssuerControlPeer,
            >| {
                seen_tx.send(peer).unwrap();
                async { "ok" }
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
    let mut socket = client(addr, Some("wrong-peer")).await.unwrap();
    let mut peers = Vec::new();
    for _ in 0..2 {
        socket
            .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();
        reply(&mut socket).await;
        peers.push(seen_rx.recv().await.unwrap());
    }
    assert_eq!(peers[0].channel_id(), peers[1].channel_id());
    assert!(Arc::ptr_eq(&peers[0].channel, &peers[1].channel));
    peers[0].check_live().unwrap();
    let mut waiting = JoinSet::new();
    for _ in 0..8 {
        let peer = peers[0].clone();
        waiting.spawn(async move {
            peer.wait_for_close().await;
            peer.check_live()
        });
    }
    drop(socket);
    tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(result) = waiting.join_next().await {
            assert!(result.unwrap().is_err());
        }
    })
    .await
    .unwrap();
    peers[1].wait_for_close().await;
    assert!(peers[1].check_live().is_err());
    let mut replacement = client(addr, Some("wrong-peer")).await.unwrap();
    replacement
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    reply(&mut replacement).await;
    let next = seen_rx.recv().await.unwrap();
    assert_ne!(next.channel_id(), peers[0].channel_id());
    next.check_live().unwrap();
    assert!(peers[0].check_live().is_err());
    drop(replacement);
    tokio::time::timeout(Duration::from_secs(2), next.wait_for_close())
        .await
        .unwrap();
    server.abort();
    let _ = server.await;
}

#[tokio::test]
async fn issuer_channel_close_is_observed_while_http_handler_waits() {
    let listener =
        IssuerControlTlsListener::bind("127.0.0.1:0".parse().unwrap(), issuer_identity())
            .await
            .unwrap();
    let addr = listener.local_addr().unwrap();
    let (seen_tx, mut seen_rx) = tokio::sync::mpsc::unbounded_channel();
    let release = Arc::new(tokio::sync::Notify::new());
    let released = Arc::clone(&release);
    let app = Router::new().route(
        "/",
        axum::routing::get(
            move |axum::extract::ConnectInfo(peer): axum::extract::ConnectInfo<
                AuthenticatedIssuerControlPeer,
            >| {
                seen_tx.send(peer.clone()).unwrap();
                let released = Arc::clone(&released);
                async move {
                    released.notified().await;
                    assert!(
                        peer.check_live().is_err(),
                        "a closed channel cannot resume admission"
                    );
                    axum::http::StatusCode::UNAUTHORIZED
                }
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
    let mut socket = client(addr, Some("wrong-peer")).await.unwrap();
    socket
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
        .await
        .unwrap();
    let peer = seen_rx.recv().await.unwrap();
    peer.check_live().unwrap();
    drop(socket);
    let observed = tokio::time::timeout(Duration::from_secs(2), peer.wait_for_close()).await;
    release.notify_one();
    tokio::time::sleep(Duration::from_millis(20)).await;
    server.abort();
    let _ = server.await;
    assert!(
        observed.is_ok(),
        "connection loss must not wait for the pending handler to finish"
    );
    assert!(peer.check_live().is_err());
}

#[tokio::test]
async fn issuer_channel_dialog_claim_is_single_use_and_caller_abort_closes_retained_marker() {
    let (stream, socket) = connected_stream().await;
    let peer = stream.peer();
    let dialog = peer.claim_dialog().unwrap();
    assert_eq!(dialog.peer().channel_id(), peer.channel_id());
    assert!(peer.claim_dialog().is_err());
    let (started_tx, started_rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _dialog = dialog;
        started_tx.send(()).unwrap();
        std::future::pending::<()>().await;
    });
    started_rx.await.unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(1), peer.wait_for_close())
        .await
        .unwrap();
    assert!(
        peer.check_live().is_err(),
        "open TCP transport cannot revive aborted dialog authority"
    );
    assert!(peer.claim_dialog().is_err());
    drop(stream);
    drop(socket);
    let (replacement, replacement_socket) = connected_stream().await;
    let next = replacement.peer();
    assert_ne!(next.channel_id(), peer.channel_id());
    let next_dialog = next.claim_dialog().unwrap();
    next.check_live().unwrap();
    assert!(peer.check_live().is_err());
    drop(next_dialog);
    assert!(next.check_live().is_err());
    drop(replacement);
    drop(replacement_socket);
}

#[tokio::test]
async fn issuer_channel_empty_read_does_not_close_and_server_shutdown_is_sticky() {
    let (mut stream, socket) = connected_stream().await;
    let peer = stream.peer();
    let mut empty = [];
    let mut buffer = tokio::io::ReadBuf::new(&mut empty);
    std::future::poll_fn(|cx| {
        tokio::io::AsyncRead::poll_read(std::pin::Pin::new(&mut stream), cx, &mut buffer)
    })
    .await
    .unwrap();
    peer.check_live().unwrap();
    stream.shutdown().await.unwrap();
    assert!(peer.check_live().is_err());
    peer.wait_for_close().await;
    drop(stream);
    assert!(peer.claim_dialog().is_err());
    drop(socket);
}

#[tokio::test]
async fn issuer_channel_canonical_preparation_binds_the_actual_dialog_not_a_copied_uuid() {
    use super::super::intent::RuntimeActualRequest;
    use super::super::preparation::{
        compare_preparation, compare_preparation_on_dialog, RuntimeChannelHello,
        RuntimePreparation, RuntimePreparationContext,
    };
    use serde_json::Value;
    use std::collections::BTreeMap;
    fn unhex(text: &str) -> Vec<u8> {
        text.as_bytes()
            .chunks_exact(2)
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect()
    }
    let (stream, socket) = connected_stream().await;
    let peer = stream.peer();
    let dialog = peer.claim_dialog().unwrap();
    let hello = RuntimeChannelHello::for_live_dialog(&dialog).unwrap();
    let channel_id = peer.channel_id().to_string();
    assert_eq!(
        serde_json::from_slice::<Value>(&hello.canonical().unwrap()).unwrap(),
        serde_json::json!({"channel_version":1,"control_channel_id":channel_id})
    );
    let frozen: Value = serde_json::from_slice(include_bytes!(
        "fixtures/runtime_preparation/vectors.compact.json"
    ))
    .unwrap();
    let case = &frozen["vectors"][0];
    let mut prep_fields: BTreeMap<String, Value> =
        serde_json::from_slice(&unhex(case["preparation_raw_hex"].as_str().unwrap())).unwrap();
    // Only bind the ephemeral test connection; B's original intent stays exact.
    prep_fields.insert(
        "control_channel_id".into(),
        Value::String(channel_id.clone()),
    );
    let preparation = RuntimePreparation::decode(
        &super::super::control::canonical_bounded(&prep_fields, 65_536).unwrap(),
    )
    .unwrap();
    let facts = &case["context"];
    let assignment: BTreeMap<String, Value> =
        serde_json::from_value(facts["assignment"].clone()).unwrap();
    let body = unhex(facts["request_body_hex"].as_str().unwrap());
    let mut context = RuntimePreparationContext {
        assignment: &assignment,
        control_channel_id: &channel_id,
        native_deadline_epoch_ms: facts["native_deadline_epoch_ms"].as_i64().unwrap(),
        native_deadline_monotonic_ms: facts["native_deadline_monotonic_ms"].as_i64().unwrap(),
        preparation_deadline_monotonic_ms: facts["preparation_deadline_monotonic_ms"]
            .as_i64()
            .unwrap(),
        now_epoch_ms: facts["now_epoch_ms"].as_i64().unwrap(),
        now_monotonic_ms: facts["now_monotonic_ms"].as_i64().unwrap(),
        last_wall_clock_epoch_ms: facts["last_wall_clock_epoch_ms"].as_i64().unwrap(),
        current_key_revocation_watermark: facts["current_key_revocation_watermark"]
            .as_i64()
            .unwrap(),
        request: RuntimeActualRequest {
            operation_id: facts["request_operation_id"].as_str().unwrap(),
            full_input_sha256: facts["request_full_input_sha256"].as_str().unwrap(),
            method: facts["request_method"].as_str().unwrap(),
            path: facts["request_normalized_path"].as_str().unwrap(),
            query: facts["request_normalized_query"].as_str().unwrap(),
            content_type: facts["request_content_type"].as_str().unwrap(),
            body: &body,
        },
    };
    assert_eq!(
        compare_preparation_on_dialog(&dialog, &hello, &preparation, &context).unwrap(),
        case["remaining_lifetime_ms"].as_i64().unwrap()
    );
    context.control_channel_id = "00000000-0000-4000-8000-000000000001";
    assert!(compare_preparation_on_dialog(&dialog, &hello, &preparation, &context).is_err());
    context.control_channel_id = &channel_id;
    // Drop the actual stream while retaining dialog, ID, bytes and comparison facts.
    drop(stream);
    assert!(
        compare_preparation(&hello, &preparation, &context).is_ok(),
        "pure byte comparison must remain observational"
    );
    assert!(compare_preparation_on_dialog(&dialog, &hello, &preparation, &context).is_err());
    assert!(RuntimeChannelHello::for_live_dialog(&dialog).is_err());
    let (replacement, replacement_socket) = connected_stream().await;
    let next = replacement.peer().claim_dialog().unwrap();
    assert!(
        compare_preparation_on_dialog(&next, &hello, &preparation, &context).is_err(),
        "a fresh TLS connection cannot consume old channel bytes"
    );
    drop(next);
    drop(replacement);
    drop(replacement_socket);
    drop(dialog);
    drop(socket);
}
