use super::*;
use crate::model::effect_lease_test_support::ControlledLease;
use crate::run_failure::{RecoveryAction, RunFailure};
use std::sync::Mutex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

fn messages() -> Vec<Message> {
    vec![Message::User {
        content: "hello".into(),
    }]
}
fn client(backend: BackendKind, base_url: String) -> ModelClient {
    test_model_client(backend, base_url, Default::default()).with_required_effect_lease()
}
fn denied(error: anyhow::Error) -> RunFailure {
    assert!(!error
        .to_string()
        .contains("private-operation-capability-canary"));
    assert_eq!(error.to_string(), "managed runtime effect lease denied");
    let failure = error.downcast::<RunFailure>().unwrap();
    assert!(!failure.transient);
    assert_eq!(failure.recovery_action, RecoveryAction::None);
    failure
}

#[tokio::test]
async fn required_legacy_and_missing_calls_cannot_send_or_read_codex_auth() {
    for backend in [
        BackendKind::OpenAiChatCompletions,
        BackendKind::OpenAiResponses,
        BackendKind::AnthropicMessages,
        BackendKind::ChatGptCodexResponses,
    ] {
        let server = ScriptedServer::start_unexpected_request_server(Duration::from_millis(80));
        let client = client(backend, server.base_url.clone());
        for case in 0..3 {
            let error = match case {
                0 => client.send_turn(messages(), vec![]).await,
                1 => client.send_turn_streaming(messages(), vec![], None).await,
                _ => {
                    client
                        .send_turn_streaming_with_effect_lease(messages(), vec![], None, None)
                        .await
                }
            }
            .unwrap_err();
            assert_eq!(error.to_string(), "managed runtime effect lease denied");
        }
        assert!(server.finish().is_empty());
    }
}

#[tokio::test]
async fn denial_before_request_preparation_is_sanitized_and_sends_nothing() {
    let server = ScriptedServer::start_unexpected_request_server(Duration::from_millis(80));
    let client = client(BackendKind::OpenAiChatCompletions, server.base_url.clone());
    denied(
        client
            .send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                None,
                Some(ControlledLease::new(1)),
            )
            .await
            .unwrap_err(),
    );
    assert!(server.finish().is_empty());
}

#[tokio::test]
async fn denial_while_headers_are_prepared_prevents_actual_send() {
    let server = ScriptedServer::start_unexpected_request_server(Duration::from_millis(80));
    let lease = ControlledLease::new(0);
    let mut client = client(BackendKind::OpenAiResponses, server.base_url.clone());
    client.effect_scope = CallEffectScope::new(true, Some(lease.clone())).unwrap();
    let error = client
        .send_with_retry_headers(
            &server.base_url,
            &json!({}),
            |request| {
                lease.deny();
                request
            },
            &[],
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, "managed runtime effect lease denied");
    assert!(server.finish().is_empty());
}

#[tokio::test]
async fn leased_http_stream_and_lost_response_failures_do_not_replay() {
    for response in [
        ScriptedResponse::json("503 Service Unavailable", "busy").with_header("Retry-After", "0"),
        ScriptedResponse::json("200 OK", "").drop_connection(),
        ScriptedResponse::json("200 OK", ": keepalive\n\n")
            .with_header("Content-Type", "text/event-stream"),
    ] {
        let server = ScriptedServer::start(vec![response]);
        let client = client(BackendKind::OpenAiChatCompletions, server.base_url.clone());
        let sink = |_delta| {};
        tokio::time::timeout(
            Duration::from_secs(1),
            client.send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                Some(&sink),
                Some(ControlledLease::new(0)),
            ),
        )
        .await
        .unwrap()
        .unwrap_err();
        assert_eq!(server.finish().len(), 1);
    }
}

#[tokio::test]
async fn accepted_delta_survives_denial_without_later_output_or_replay() {
    let body = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"forbidden\"},\"finish_reason\":\"stop\"}]}\n\n",
        "data: [DONE]\n\n");
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json("200 OK", body).with_header("Content-Type", "text/event-stream")
    ]);
    let client = client(BackendKind::OpenAiChatCompletions, server.base_url.clone());
    let lease = ControlledLease::new(0);
    let output = Mutex::new(Vec::new());
    let sink = |delta| {
        output.lock().unwrap().push(delta);
        lease.deny();
    };
    let failure = denied(
        client
            .send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                Some(&sink),
                Some(lease.clone()),
            )
            .await
            .unwrap_err(),
    );
    assert_eq!(
        *output.lock().unwrap(),
        vec![ModelStreamDelta::text("first")]
    );
    assert!(failure.partial_output.text);
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn denied_buffered_response_is_withheld_and_unrelated_call_still_works() {
    let lease = ControlledLease::new(0);
    let observed = lease.clone();
    let server = ScriptedServer::start_observed(vec![s5_completions_response()], move |_, _| {
        observed.deny()
    });
    let selected = client(BackendKind::OpenAiChatCompletions, server.base_url.clone());
    denied(
        selected
            .send_turn_streaming_with_effect_lease(messages(), vec![], None, Some(lease))
            .await
            .unwrap_err(),
    );
    assert_eq!(server.finish().len(), 1);
    let server = ScriptedServer::start(vec![s5_completions_response()]);
    let fresh = client(BackendKind::OpenAiChatCompletions, server.base_url.clone());
    assert_eq!(
        fresh
            .send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                None,
                Some(ControlledLease::new(0))
            )
            .await
            .unwrap()
            .assistant
            .content
            .as_deref(),
        Some("done")
    );
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn denial_drops_silent_request_and_stream_io() {
    for streaming in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let lease = ControlledLease::new(0);
        let observed = lease.clone();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            assert!(socket.read(&mut bytes).await.unwrap() > 0);
            if streaming {
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
            observed.deny();
            tokio::time::timeout(Duration::from_secs(1), socket.read_to_end(&mut Vec::new()))
                .await
                .unwrap()
                .unwrap();
        });
        let client = client(BackendKind::OpenAiChatCompletions, url);
        let sink = |_delta| panic!("silent fixture cannot emit output");
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            client.send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                streaming.then_some(&sink as _),
                Some(lease),
            ),
        )
        .await
        .unwrap();
        denied(result.unwrap_err());
        server.await.unwrap();
    }
}

#[tokio::test]
async fn ordinary_standalone_none_preserves_success() {
    let server = ScriptedServer::start(vec![s5_completions_response()]);
    let client = test_model_client(
        BackendKind::OpenAiChatCompletions,
        server.base_url.clone(),
        Default::default(),
    );
    assert_eq!(
        client
            .send_turn(messages(), vec![])
            .await
            .unwrap()
            .assistant
            .content
            .as_deref(),
        Some("done")
    );
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn final_current_check_withholds_already_buffered_success() {
    let server = ScriptedServer::start(vec![s5_completions_response()]);
    let client = client(BackendKind::OpenAiChatCompletions, server.base_url.clone());
    // Current checks: call admission, credential boundary, send, publication.
    let failure = denied(
        client
            .send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                None,
                Some(ControlledLease::new(4)),
            )
            .await
            .unwrap_err(),
    );
    assert!(!failure.partial_output.any());
    assert_eq!(server.finish().len(), 1);
}

#[tokio::test]
async fn leased_incomplete_sse_cannot_replay_on_a_still_available_provider() {
    for required in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for attempt in 0..2 {
                let accepted =
                    tokio::time::timeout(Duration::from_millis(800), listener.accept()).await;
                let Ok(Ok((mut socket, _))) = accepted else {
                    break;
                };
                let mut request = Vec::new();
                let mut bytes = [0; 4096];
                let header_end = loop {
                    let read = socket.read(&mut bytes).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&bytes[..read]);
                    if let Some(position) = request.windows(4).position(|v| v == b"\r\n\r\n") {
                        break position + 4;
                    }
                    assert!(request.len() < 64 * 1024);
                };
                let headers = String::from_utf8_lossy(&request[..header_end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                while request.len() < header_end + length {
                    let read = socket.read(&mut bytes).await.unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&bytes[..read]);
                }
                requests.push(request[header_end..header_end + length].to_vec());
                let body = if attempt == 0 {
                    ": keepalive\n\n"
                } else {
                    "data: {\"choices\":[{\"delta\":{\"content\":\"replayed\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
                };
                let wire = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(), body,
                );
                socket.write_all(wire.as_bytes()).await.unwrap();
            }
            requests
        });
        let mut client =
            test_model_client(BackendKind::OpenAiChatCompletions, url, Default::default());
        if required {
            client = client.with_required_effect_lease();
        }
        let sink = |_delta| {};
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            client.send_turn_streaming_with_effect_lease(
                messages(),
                vec![],
                Some(&sink),
                required
                    .then(|| ControlledLease::new(0) as crate::runtime::RuntimeEffectLeaseHandle),
            ),
        )
        .await
        .unwrap();
        let requests = server.await.unwrap();
        if required {
            assert_eq!(
                requests.len(),
                1,
                "a still-current lease cannot replay an uncertain billed stream"
            );
            assert!(result.is_err());
        } else {
            assert_eq!(
                requests.len(),
                2,
                "standalone incomplete-stream retry stays compatible"
            );
            assert_eq!(requests[0], requests[1]);
            assert_eq!(
                result.unwrap().assistant.content.as_deref(),
                Some("replayed")
            );
        }
    }
}

#[tokio::test]
async fn caller_drop_cancels_silent_leased_model_io_without_revoking_the_guard() {
    use crate::runtime::RuntimeEffectLease;
    for streaming in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (entered, request_seen) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            assert!(socket.read(&mut bytes).await.unwrap() > 0);
            if streaming {
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n").await.unwrap();
            }
            entered.send(()).unwrap();
            let closed =
                tokio::time::timeout(Duration::from_secs(2), socket.read_to_end(&mut Vec::new()))
                    .await
                    .expect("caller drop must close silent transport within the fixture deadline");
            if let Err(error) = closed {
                assert!(
                    matches!(
                        error.kind(),
                        std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
                    ),
                    "unexpected transport error: {error}"
                );
            }
        });
        let lease = ControlledLease::new(0);
        let selected = lease.clone();
        let call = tokio::spawn(async move {
            let client = client(BackendKind::OpenAiChatCompletions, url);
            let sink = |_delta| panic!("silent fixture cannot emit output");
            client
                .send_turn_streaming_with_effect_lease(
                    messages(),
                    vec![],
                    streaming.then_some(&sink as _),
                    Some(selected),
                )
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), request_seen)
            .await
            .unwrap()
            .unwrap();
        call.abort();
        assert!(call.await.unwrap_err().is_cancelled());
        server.await.unwrap();
        lease.check_available().unwrap();
        let unrelated = ScriptedServer::start(vec![s5_completions_response()]);
        assert_eq!(
            client(
                BackendKind::OpenAiChatCompletions,
                unrelated.base_url.clone()
            )
            .send_turn_streaming_with_effect_lease(messages(), vec![], None, Some(lease))
            .await
            .unwrap()
            .assistant
            .content
            .as_deref(),
            Some("done")
        );
        assert_eq!(unrelated.finish().len(), 1);
    }
}
