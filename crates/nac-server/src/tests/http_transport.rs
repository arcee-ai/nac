//! Exercise the real HTTP listener, not Router::oneshot: small gzip chunks can
//! otherwise pay one Linux delayed-ACK interval for every sequential frame.
#![cfg(target_os = "linux")]

use super::*;
use crate::delivery::server::serve_router_listener_with_shutdown;
use std::os::fd::AsRawFd;
use tokio::io::{AsyncBufReadExt, BufReader};

fn frame(sequence: usize) -> Vec<u8> {
    let bytes = (0..32768).map(|i| (i % 97) as u8).collect::<Vec<_>>();
    serde_json::to_vec(&serde_json::json!({"sequence": sequence, "bytes": bytes})).unwrap()
}

async fn read_gzip_frame(reader: &mut BufReader<tokio::net::TcpStream>) -> Vec<u8> {
    let mut line = String::new();
    reader.read_line(&mut line).await.unwrap();
    assert!(line.starts_with("HTTP/1.1 200 "), "{line}");
    let mut headers = String::new();
    loop {
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        if line == "\r\n" {
            break;
        }
        headers.push_str(&line.to_ascii_lowercase());
    }
    assert!(headers.contains("content-encoding: gzip\r\n"), "{headers}");
    assert!(
        headers.contains("transfer-encoding: chunked\r\n"),
        "{headers}"
    );
    let mut compressed = Vec::new();
    loop {
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        let length = usize::from_str_radix(line.trim(), 16).unwrap();
        if length == 0 {
            line.clear();
            reader.read_line(&mut line).await.unwrap();
            assert_eq!(line, "\r\n");
            break;
        }
        let start = compressed.len();
        compressed.resize(start + length, 0);
        reader.read_exact(&mut compressed[start..]).await.unwrap();
        let mut ending = [0; 2];
        reader.read_exact(&mut ending).await.unwrap();
        assert_eq!(&ending, b"\r\n");
    }
    let mut decoded = Vec::new();
    GzDecoder::new(compressed.as_slice())
        .read_to_end(&mut decoded)
        .unwrap();
    decoded
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn gzip_backlog_catches_up_without_delayed_ack_per_frame_on_public_and_control() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("http_gzip_delayed_ack");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let manager = test_manager(&root);
    let app = Router::new()
        .route(
            "/frame/{sequence}",
            axum::routing::get(
                |axum::extract::Path(sequence): axum::extract::Path<usize>| async move {
                    let body = frame(sequence);
                    let stream = async_stream::stream! {
                        // Separate the initial gzip/header write from its remainder,
                        // as streaming compression does for finite JSON observations.
                        yield Ok::<_, std::io::Error>(Bytes::copy_from_slice(&body[..1]));
                        tokio::time::sleep(Duration::from_millis(1)).await;
                        yield Ok(Bytes::copy_from_slice(&body[1..]));
                    };
                    (
                        [(header::CONTENT_TYPE, "application/json")],
                        Body::from_stream(stream),
                    )
                },
            ),
        )
        .layer(response_compression_layer());
    let public = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let control = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addresses = [public.local_addr().unwrap(), control.local_addr().unwrap()];
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(serve_router_listener_with_shutdown(
        public,
        Some((control, app.clone())),
        app,
        manager.clone(),
        async move {
            let _ = shutdown_rx.await;
        },
        Duration::from_secs(5),
        || panic!("HTTP fixture shutdown timed out"),
    ));
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        let mut elapsed = Vec::new();
        for address in addresses {
            let socket = tokio::net::TcpStream::connect(address).await.unwrap();
            socket.set_nodelay(true).unwrap();
            let mut reader = BufReader::new(socket);
            let started = std::time::Instant::now();
            // 48 acknowledged 32 KiB payloads represent 1.5 MiB of backlog,
            // below the existing 8 MiB retention limit. Never pipeline or skip.
            for sequence in 0..48 {
                let delayed_ack: libc::c_int = 0;
                // SAFETY: valid live TCP descriptor and correctly sized integer
                // option; this only selects Linux's supported delayed-ACK mode.
                let result = unsafe { libc::setsockopt(
                    reader.get_ref().as_raw_fd(), libc::IPPROTO_TCP, libc::TCP_QUICKACK,
                    (&delayed_ack as *const libc::c_int).cast(),
                    std::mem::size_of_val(&delayed_ack) as libc::socklen_t,
                ) };
                assert_eq!(result, 0, "{}", std::io::Error::last_os_error());
                reader.get_mut().write_all(format!(
                    "GET /frame/{sequence} HTTP/1.1\r\nHost: localhost\r\nAccept-Encoding: gzip\r\n\r\n"
                ).as_bytes()).await.unwrap();
                assert_eq!(read_gzip_frame(&mut reader).await, frame(sequence));
            }
            elapsed.push(started.elapsed());
        }
        elapsed
    }).await;
    // Drain listeners and the manager before reporting timing failures.
    let _ = shutdown_tx.send(());
    server.await.unwrap().unwrap();
    drop(manager);
    std::fs::remove_dir_all(root).unwrap();
    let elapsed = result.expect("sequential gzip backlog stalled");
    eprintln!("public/control 48-frame gzip backlog: {elapsed:?}");
    for duration in elapsed {
        assert!(
            duration < Duration::from_millis(1500),
            "backlog took {duration:?}"
        );
    }
}
