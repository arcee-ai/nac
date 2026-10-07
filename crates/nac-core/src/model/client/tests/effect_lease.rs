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
