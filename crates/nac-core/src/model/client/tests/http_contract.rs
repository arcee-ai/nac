//! HTTP contract tests: request/response shapes on the wire, redirect
//! and error-body policy, api-axis dispatch, and catalog-driven
//! `max_tokens`.

use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::types::FunctionDef;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

#[test]
fn both_arcee_backends_preserve_summary_system_order_and_omit_empty_tools() {
    let messages = [
        Message::System {
            content: "primary".to_string(),
        },
        Message::System {
            content: "agents".to_string(),
        },
        Message::User {
            content: "historical checkpoint".to_string(),
        },
        Message::User {
            content: "newly aged history".to_string(),
        },
        Message::User {
            content: "compaction prompt".to_string(),
        },
    ];
    let expected_messages = json!([
        {"role": "system", "content": "primary"},
        {"role": "system", "content": "agents"},
        {"role": "user", "content": "historical checkpoint"},
        {"role": "user", "content": "newly aged history"},
        {"role": "user", "content": "compaction prompt"}
    ]);

    for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
        let client = test_model_client(
            backend,
            "https://api.arcee.ai".to_string(),
            std::collections::BTreeMap::new(),
        );
        // Arcee's request shape comes from the shared completions builder
        // driven by the provider's catalog compat (S6).
        let request = completions_chat_request(
            &client.model,
            client.reasoning_effort,
            &messages,
            &[],
            &client.resolved_model.thinking_level_map,
            &client.resolved_model.compat,
        );

        assert_eq!(request["messages"], expected_messages, "{backend}");
        assert_eq!(request["temperature"], json!(0.0), "{backend}");
        assert!(request.get("tools").is_none(), "{backend}");
    }
}

#[test]
fn model_client_carries_resolved_catalog_metadata() {
    let client = test_model_client(
        BackendKind::DeepSeekChat,
        "https://api.deepseek.test".to_string(),
        std::collections::BTreeMap::new(),
    );
    assert_eq!(client.resolved_model.id, "test-model");
    assert_eq!(client.resolved_model.provider, BackendKind::DeepSeekChat);
    assert_eq!(
        client.resolved_model.api,
        catalog::ApiKind::OpenAiCompletions
    );
    assert_eq!(
        client.resolved_model.source,
        catalog::ModelSource::ProviderDefault
    );
}

#[tokio::test]
async fn arcee_inference_sends_expected_contract_and_parses_chat_response() {
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        json!({
            "choices": [{
                "message": {
                    "content": "Hello from Arcee",
                    "reasoning_content": "brief reasoning"
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 11,
                "completion_tokens": 7,
                "total_tokens": 18,
                "prompt_tokens_details": {"cached_tokens": 3}
            }
        })
        .to_string(),
    )]);
    let client = ModelClient {
        client: arcee::no_redirect_client().unwrap(),
        base_url: format!("{}/tenant/base", server.base_url),
        api_key: "stored-login-credential".to_string(),
        model: "arcee-test-model".to_string(),
        backend: BackendKind::ArceeApi,
        reasoning_effort: None,
        api_key_env: None,
        extra_headers: std::collections::BTreeMap::from([(
            "X-Arcee-Tenant".to_string(),
            "tenant-test".to_string(),
        )]),
        arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
        cache_ttl: None,
        resolved_model: catalog::resolve(BackendKind::ArceeApi, "arcee-test-model"),
    };
    let messages = vec![
        Message::System {
            content: "Follow instructions".to_string(),
        },
        Message::User {
            content: "Say hello".to_string(),
        },
    ];
    let tools = vec![ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "lookup".to_string(),
            description: "Look up a value".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {"key": {"type": "string"}},
                "required": ["key"]
            }),
        },
    }];

    let response = client
        .send_turn(messages, tools.clone())
        .await
        .expect("valid Arcee chat response should parse");
    let requests = server.finish();

    assert_eq!(
        response.assistant.content.as_deref(),
        Some("Hello from Arcee")
    );
    assert_eq!(
        response.assistant.reasoning_text.as_deref(),
        Some("brief reasoning")
    );
    assert_eq!(response.finish_reason.as_deref(), Some("stop"));
    let usage = response.usage.expect("usage should parse");
    assert_eq!(usage.input_tokens, 8);
    assert_eq!(usage.cache_read_tokens, 3);
    assert_eq!(usage.output_tokens, 7);
    assert_eq!(usage.orchestrator_context_tokens, 18);

    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/tenant/base/v1/chat/completions");
    assert_eq!(
        request.headers.get("authorization").map(String::as_str),
        Some("Bearer stored-login-credential")
    );
    assert!(
        request.headers.get("x-arcee-client").is_none(),
        "x-arcee-client header must no longer be sent"
    );
    assert_eq!(
        request.headers.get("content-type").map(String::as_str),
        Some("application/json")
    );
    assert_eq!(
        request.headers.get("x-arcee-tenant").map(String::as_str),
        Some("tenant-test")
    );
    let body: Value = serde_json::from_slice(&request.body).expect("request JSON");
    assert_eq!(body["model"], "arcee-test-model");
    assert_eq!(body["temperature"], 0.0);
    assert_eq!(
        body["messages"],
        json!([
            {"role": "system", "content": "Follow instructions"},
            {"role": "user", "content": "Say hello"}
        ])
    );
    assert_eq!(
        body["tools"],
        serde_json::to_value(&tools).expect("tool definitions serialize")
    );
}

#[tokio::test]
async fn custom_arcee_routes_are_exact_on_wire() {
    let cases = [
        ("/api", "/api/v1/chat/completions"),
        ("/custom/prefix", "/custom/prefix/v1/chat/completions"),
        ("/custom/prefix/v1", "/custom/prefix/v1/chat/completions"),
        (
            "/custom/prefix/v1/chat/completions/",
            "/custom/prefix/v1/chat/completions",
        ),
    ];

    for (configured_path, expected_path) in cases {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "choices": [{
                    "message": {"content": "ok"},
                    "finish_reason": "stop"
                }]
            })
            .to_string(),
        )]);
        let client = ModelClient {
            client: arcee::no_redirect_client().unwrap(),
            base_url: format!("{}{configured_path}", server.base_url),
            api_key: "custom-endpoint-key".to_string(),
            model: "arcee-test-model".to_string(),
            backend: BackendKind::ArceeApi,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::new(),
            arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
            cache_ttl: None,
            resolved_model: catalog::resolve(BackendKind::ArceeApi, "arcee-test-model"),
        };

        client
            .send_completions_chat(Vec::new(), Vec::new())
            .await
            .unwrap_or_else(|error| panic!("{configured_path}: {error:#}"));
        let requests = server.finish();

        assert_eq!(requests.len(), 1, "{configured_path}");
        assert_eq!(requests[0].method, "POST", "{configured_path}");
        assert_eq!(requests[0].path, expected_path, "{configured_path}");
    }
}

#[tokio::test]
async fn arcee_cross_origin_redirects_do_not_replay_prompt_credentials_or_headers() {
    for status in ["307 Temporary Redirect", "308 Permanent Redirect"] {
        let destination = TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect destination");
        destination
            .set_nonblocking(true)
            .expect("make redirect destination nonblocking");
        let destination_url = format!(
            "http://{}/stolen-inference",
            destination.local_addr().unwrap()
        );
        let source = ScriptedServer::start(vec![ScriptedResponse::redirect(
            status,
            destination_url,
            format!("{}not-in-error", "x".repeat(500)),
        )]);
        let client = ModelClient {
            client: arcee::no_redirect_client().unwrap(),
            base_url: source.base_url.clone(),
            api_key: "sensitive-arcee-credential".to_string(),
            model: "arcee-test-model".to_string(),
            backend: BackendKind::ArceeApi,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::from([(
                "X-Arcee-Tenant".to_string(),
                "sensitive-tenant-header".to_string(),
            )]),
            arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
            cache_ttl: None,
            resolved_model: catalog::resolve(BackendKind::ArceeApi, "arcee-test-model"),
        };

        let error = client
            .send_completions_chat(
                vec![Message::User {
                    content: "sensitive prompt".to_string(),
                }],
                Vec::new(),
            )
            .await
            .expect_err("Arcee inference redirects must not be followed")
            .to_string();
        let requests = source.finish();

        assert!(error.contains("redirect"), "unexpected error: {error}");
        assert!(
            error.contains("automatic redirects are disabled"),
            "unexpected error: {error}"
        );
        assert!(
            !error.contains("not-in-error"),
            "error body was not bounded"
        );
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].headers.get("authorization").map(String::as_str),
            Some("Bearer sensitive-arcee-credential")
        );
        assert_eq!(
            requests[0]
                .headers
                .get("x-arcee-tenant")
                .map(String::as_str),
            Some("sensitive-tenant-header")
        );
        assert!(
            String::from_utf8_lossy(&requests[0].body).contains("sensitive prompt"),
            "source did not receive the prompt"
        );
        let accept_error = destination
            .accept()
            .expect_err("cross-origin redirect destination must receive no request");
        assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
    }
}

#[tokio::test]
async fn anthropic_and_openai_redirects_never_replay_same_or_cross_origin() {
    let benign_headers = std::collections::BTreeMap::from([(
        "X-Benign-Trace".to_string(),
        "trace-value".to_string(),
    )]);

    for backend in [BackendKind::AnthropicMessages, BackendKind::OpenAiResponses] {
        for status in ["307 Temporary Redirect", "308 Permanent Redirect"] {
            let same_origin = ScriptedServer::start_same_origin_redirect(
                status,
                "/same-origin-capture",
                format!("{}body-must-be-bounded", "x".repeat(500)),
            );
            let client = test_model_client(
                backend,
                same_origin.base_url.clone(),
                benign_headers.clone(),
            );
            let error =
                send_provider_test_request(&client, &format!("{}/initial", same_origin.base_url))
                    .await
                    .expect_err("same-origin redirect must not be followed")
                    .to_string();
            let requests = same_origin.finish();

            assert!(
                error.contains("automatic redirects are disabled"),
                "{error}"
            );
            assert!(error.contains("request was not replayed"), "{error}");
            assert!(error.contains(&status[..3]), "{error}");
            assert!(!error.contains("body-must-be-bounded"), "{error}");
            assert_eq!(requests.len(), 1, "{backend} {status} same-origin replay");
            assert_provider_request_contract(backend, &requests[0]);

            let destination =
                TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect destination");
            destination
                .set_nonblocking(true)
                .expect("make redirect destination nonblocking");
            let destination_url = format!(
                "http://{}/cross-origin-capture",
                destination.local_addr().unwrap()
            );
            let cross_origin = ScriptedServer::start(vec![ScriptedResponse::redirect(
                status,
                destination_url,
                "cross-origin redirect blocked",
            )]);
            let client = test_model_client(
                backend,
                cross_origin.base_url.clone(),
                benign_headers.clone(),
            );
            let error =
                send_provider_test_request(&client, &format!("{}/initial", cross_origin.base_url))
                    .await
                    .expect_err("cross-origin redirect must not be followed")
                    .to_string();
            let requests = cross_origin.finish();

            assert!(
                error.contains("automatic redirects are disabled"),
                "{error}"
            );
            assert!(error.contains("request was not replayed"), "{error}");
            assert_eq!(requests.len(), 1, "{backend} {status} cross-origin replay");
            assert_provider_request_contract(backend, &requests[0]);
            let accept_error = destination
                .accept()
                .expect_err("cross-origin destination must receive no replay");
            assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
        }
    }
}

#[test]
fn truncate_utf8_backs_up_to_character_boundary() {
    assert_eq!(truncate_utf8("é", 0), "");
    assert_eq!(truncate_utf8("é", 1), "");
    assert_eq!(truncate_utf8("é", 2), "é");

    let body = format!("{}é", "a".repeat(499));
    assert_eq!(truncate_utf8(&body, 500), "a".repeat(499));
}

#[test]
fn truncate_utf8_preserves_exact_boundary_and_short_values() {
    let exact = format!("{}é", "a".repeat(498));
    assert_eq!(exact.len(), 500);
    assert_eq!(truncate_utf8(&exact, 500), exact);
    assert_eq!(truncate_utf8("short", 500), "short");
}

#[tokio::test]
async fn arcee_multibyte_error_body_does_not_panic() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind mock server");
    let address = listener.local_addr().expect("mock server address");
    let response_body = format!("{}é", "a".repeat(499));
    let expected_prefix = "a".repeat(499);
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("accept request");
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .expect("set request timeout");
        let mut request = [0; 4096];
        let _ = stream.read(&mut request).expect("read request");
        let response = format!(
            "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        stream
            .write_all(response.as_bytes())
            .expect("write response");
    });

    let client = ModelClient {
        client: arcee::no_redirect_client().unwrap(),
        base_url: format!("http://{address}"),
        api_key: "rcai-test".to_string(),
        model: "test-model".to_string(),
        backend: BackendKind::ArceeApi,
        reasoning_effort: None,
        api_key_env: None,
        extra_headers: std::collections::BTreeMap::new(),
        arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
        cache_ttl: None,
        resolved_model: catalog::resolve(BackendKind::ArceeApi, "test-model"),
    };

    let error = client
        .send_completions_chat(Vec::new(), Vec::new())
        .await
        .expect_err("HTTP 400 should return an error")
        .to_string();
    server.join().expect("mock server thread");

    assert!(error.contains("HTTP 400"), "unexpected error: {error}");
    assert!(
        error.contains(&expected_prefix),
        "unexpected error: {error}"
    );
    assert!(
        !error.contains('é'),
        "body should be capped safely: {error}"
    );
}

// --- S6: api-axis dispatch + catalog-driven max_tokens -------------------

#[tokio::test]
async fn send_turn_dispatches_on_the_resolved_api_not_the_backend() {
    // The dispatch axis is the resolved catalog api: a client whose
    // metadata says OpenAiResponses speaks the responses protocol even
    // though its BackendKind is a completions provider. (Real clients
    // always resolve api == api_kind_for(provider); the hand-mutated
    // metadata isolates the dispatch axis.)
    let server = ScriptedServer::start(vec![s5_openai_response()]);
    let mut client = test_model_client(
        BackendKind::DeepSeekChat,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    client.resolved_model.api = catalog::ApiKind::OpenAiResponses;
    let body = s5_send_and_finish(
        &client,
        server,
        vec![Message::User {
            content: "hi".to_string(),
        }],
    )
    .await;

    assert!(
        body.get("input").is_some(),
        "the responses wire shape proves api-axis dispatch: {body}"
    );
    assert!(body.get("messages").is_none());
}

#[tokio::test]
async fn anthropic_max_tokens_come_from_the_resolved_catalog_metadata() {
    // S6 intentional behavior change: the Anthropic adapter sends the
    // per-model catalog max_tokens (models.dev limit.output) instead of
    // the hardcoded 128_000. Values verified against Anthropic's model
    // docs (platform.claude.com/docs/en/about-claude/models/overview).
    for (model, expected) in [
        ("claude-opus-4-6", 128_000_u64),
        ("claude-sonnet-4-6", 128_000),
        ("claude-opus-4-5", 64_000),
        ("claude-haiku-4-5", 64_000),
        ("claude-sonnet-4-5", 64_000),
        // Deprecated models are no longer catalogued and resolve conservatively.
        ("claude-opus-4-1", 16_384),
        // No catalog entry: the conservative fallback (was 128_000).
        ("claude-unknown-future", 16_384),
    ] {
        let server = ScriptedServer::start(vec![s5_anthropic_response()]);
        let mut client = test_model_client(
            BackendKind::AnthropicMessages,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        client.model = model.to_string();
        client.resolved_model = catalog::resolve(BackendKind::AnthropicMessages, model);
        let body = s5_send_and_finish(
            &client,
            server,
            vec![Message::User {
                content: "hi".to_string(),
            }],
        )
        .await;
        assert_eq!(body["max_tokens"], json!(expected), "{model}");
    }
}
