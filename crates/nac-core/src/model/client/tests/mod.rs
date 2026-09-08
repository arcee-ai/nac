//! Subject test suites for `ModelClient`, split by topic; this file
//! carries the shared scripted-server helpers.

use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

mod cost_attach;
mod header_policy;
mod http_contract;
mod s5_wire;

fn test_model_client(
    backend: BackendKind,
    base_url: String,
    extra_headers: std::collections::BTreeMap<String, String>,
) -> ModelClient {
    ModelClient {
        client: no_redirect_model_client().unwrap(),
        base_url,
        api_key: "selected-provider-credential".to_string(),
        model: "test-model".to_string(),
        backend,
        reasoning_effort: None,
        api_key_env: None,
        trusted_api_key_file: None,
        extra_headers,
        arcee_credential_source: None,
        cache_ttl: None,
        prompt_cache_key: None,
        resolved_model: catalog::resolve(backend, "test-model"),
    }
}

async fn send_provider_test_request(client: &ModelClient, url: &str) -> Result<Value> {
    let body = json!({"prompt": "sensitive prompt must not replay"});
    match client.backend {
        BackendKind::OpenAiResponses => client.post_json_with_retry(url, &body).await,
        BackendKind::AnthropicMessages => {
            client
                .post_anthropic_json_with_retry(url, &body, false)
                .await
        }
        backend => panic!("unsupported test backend: {backend}"),
    }
}

fn assert_provider_request_contract(
    backend: BackendKind,
    request: &super::super::test_http::CapturedRequest,
) {
    let (credential_header, expected_value) = match backend {
        BackendKind::OpenAiResponses => ("authorization", "Bearer selected-provider-credential"),
        BackendKind::AnthropicMessages => ("x-api-key", "selected-provider-credential"),
        backend => panic!("unsupported test backend: {backend}"),
    };
    assert_eq!(
        request.headers.get(credential_header).map(String::as_str),
        Some(expected_value),
        "{backend} selected credential"
    );
    assert_eq!(
        request.header_counts.get(credential_header),
        Some(&1),
        "{backend} must emit exactly one selected credential header"
    );
    assert_eq!(
        request.headers.get("x-benign-trace").map(String::as_str),
        Some("trace-value"),
        "{backend} benign header"
    );
    assert!(
        String::from_utf8_lossy(&request.body).contains("sensitive prompt must not replay"),
        "{backend} source request body"
    );
}

fn s5_tool_call(id: &str) -> ToolCall {
    ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: "read".to_string(),
            arguments: "{}".to_string(),
        },
    }
}

/// user → assistant(reasoning + tool call) → tool result → user, with the
/// assistant stamped with the given origin and reasoning field.
fn s5_history(
    origin: Option<ModelOrigin>,
    reasoning_field: Option<&str>,
    reasoning_text: Option<&str>,
    reasoning_details: Option<Value>,
) -> Vec<Message> {
    vec![
        Message::User {
            content: "first".to_string(),
        },
        Message::Assistant {
            content: Some("prior answer".to_string()),
            reasoning_text: reasoning_text.map(str::to_string),
            reasoning_details,
            tool_calls: Some(vec![s5_tool_call("call-1")]),
            model_origin: origin,
            reasoning_field: reasoning_field.map(str::to_string),
            duration_ms: None,
        },
        Message::Tool {
            tool_call_id: "call-1".to_string(),
            content: "tool output".into(),
        },
        Message::User {
            content: "second".to_string(),
        },
    ]
}

fn s5_completions_response() -> ScriptedResponse {
    ScriptedResponse::json(
        "200 OK",
        json!({
            "choices": [{
                "finish_reason": "stop",
                "message": {"content": "done", "tool_calls": null}
            }],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )
}

fn s5_openai_response() -> ScriptedResponse {
    ScriptedResponse::json(
        "200 OK",
        json!({
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )
}

fn s5_anthropic_response() -> ScriptedResponse {
    ScriptedResponse::json(
        "200 OK",
        json!({
            "content": [{"type": "text", "text": "done"}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 10, "output_tokens": 5}
        })
        .to_string(),
    )
}

async fn s5_send_and_finish(
    client: &ModelClient,
    server: ScriptedServer,
    messages: Vec<Message>,
) -> Value {
    let response = client
        .send_turn(messages, vec![])
        .await
        .expect("scripted response should parse");
    assert_eq!(response.assistant.content.as_deref(), Some("done"));
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    serde_json::from_slice::<Value>(&requests[0].body).expect("request body is JSON")
}

fn s5_thinking_blocks() -> Value {
    json!([{"type": "thinking", "thinking": "prior thinking", "signature": "sig-abc"}])
}

fn s5_reasoning_items() -> Value {
    json!([{"type": "reasoning", "id": "rs_1", "summary": [{"type": "summary_text", "text": "prior thinking"}]}])
}

fn image_tool_message() -> Message {
    use crate::tool_content::{ToolContent, ToolContentPart, ToolImage};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use std::io::Cursor;

    let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(1, 1, Rgba([1, 2, 3, 255])));
    let mut encoded = Cursor::new(Vec::new());
    source.write_to(&mut encoded, ImageFormat::Png).unwrap();
    let image = ToolImage::validate(encoded.into_inner(), None, None).unwrap();
    Message::Tool {
        tool_call_id: "call-image".to_string(),
        content: ToolContent::from_parts(vec![ToolContentPart::Image(image)]).unwrap(),
    }
}

#[test]
fn image_tool_results_require_both_model_and_adapter_support() {
    let mut responses = test_model_client(
        BackendKind::OpenAiResponses,
        "http://unused".to_string(),
        Default::default(),
    );
    responses.resolved_model.image_input = true;
    assert!(responses.supports_image_tool_results());
    assert!(responses
        .validate_image_history(&[image_tool_message()])
        .is_ok());

    let mut anthropic = test_model_client(
        BackendKind::AnthropicMessages,
        "http://unused".to_string(),
        Default::default(),
    );
    anthropic.resolved_model.image_input = true;
    assert!(!anthropic.supports_image_tool_results());
    assert!(anthropic
        .validate_image_history(&[image_tool_message()])
        .unwrap_err()
        .to_string()
        .contains("unsupported"));

    responses.resolved_model.image_input = false;
    assert!(!responses.supports_image_tool_results());
}
