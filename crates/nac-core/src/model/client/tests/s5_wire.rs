//! Wire-level history normalization invariants. Same-model and unstamped
//! history retain provider reasoning, while cross-model history drops it.

use super::*;
use crate::model::test_http::ScriptedServer;

#[tokio::test]
async fn same_model_history_replays_reasoning_on_completions_backends() {
    for (backend, field) in [
        (BackendKind::DeepSeekChat, "reasoning_content"),
        (BackendKind::FireworksChat, "reasoning_content"),
        (BackendKind::TogetherChat, "reasoning"),
    ] {
        let server = ScriptedServer::start(vec![s5_completions_response()]);
        let client = test_model_client(
            backend,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let origin = Some(client.model_origin());
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(origin, Some(field), Some("prior thinking"), None),
        )
        .await;

        let expected_tool_calls = json!([{
            "id": "call-1",
            "type": "function",
            "function": {"name": "read", "arguments": "{}"}
        }]);
        let mut expected_assistant = json!({
            "role": "assistant",
            "content": "prior answer",
            "tool_calls": expected_tool_calls,
        });
        expected_assistant[field] = json!("prior thinking");
        assert_eq!(
            body["messages"],
            json!([
                {"role": "user", "content": "first"},
                expected_assistant,
                {"role": "tool", "tool_call_id": "call-1", "content": "tool output"},
                {"role": "user", "content": "second"}
            ]),
            "{backend} same-model history retains its complete assistant turn"
        );
    }
}

#[tokio::test]
async fn same_model_history_replays_thinking_blocks_on_anthropic() {
    let server = ScriptedServer::start(vec![s5_anthropic_response()]);
    let client = test_model_client(
        BackendKind::AnthropicMessages,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let origin = Some(client.model_origin());
    let body = s5_send_and_finish(
        &client,
        server,
        s5_history(origin, None, None, Some(s5_thinking_blocks())),
    )
    .await;

    assert_eq!(
        body["messages"],
        json!([
            {"role": "user", "content": [
                {"type": "text", "text": "first", "cache_control": {"type": "ephemeral"}}
            ]},
            {"role": "assistant", "content": [
                {"type": "thinking", "thinking": "prior thinking", "signature": "sig-abc"},
                {"type": "text", "text": "prior answer"},
                {"type": "tool_use", "id": "call-1", "name": "read", "input": {}}
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "call-1", "content": "tool output"}
            ]},
            {"role": "user", "content": [
                {"type": "text", "text": "second", "cache_control": {"type": "ephemeral"}}
            ]}
        ]),
        "signed thinking blocks replay verbatim for the same model"
    );
}

#[tokio::test]
async fn legacy_history_without_origin_replays_exactly_like_same_model() {
    // Unstamped transcripts retain reasoning; Anthropic requires thinking
    // blocks alongside their tool_use.
    let server = ScriptedServer::start(vec![s5_anthropic_response()]);
    let client = test_model_client(
        BackendKind::AnthropicMessages,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let body = s5_send_and_finish(
        &client,
        server,
        s5_history(None, None, None, Some(s5_thinking_blocks())),
    )
    .await;
    assert_eq!(
        body["messages"][1]["content"][0],
        json!({"type": "thinking", "thinking": "prior thinking", "signature": "sig-abc"}),
        "legacy anthropic history keeps its thinking blocks"
    );

    let server = ScriptedServer::start(vec![s5_completions_response()]);
    let client = test_model_client(
        BackendKind::DeepSeekChat,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let body = s5_send_and_finish(
        &client,
        server,
        s5_history(None, None, Some("prior thinking"), None),
    )
    .await;
    assert_eq!(
        body["messages"][1],
        json!({
            "role": "assistant",
            "content": "prior answer",
            "reasoning_content": "prior thinking",
            "tool_calls": [{
                "id": "call-1",
                "type": "function",
                "function": {"name": "read", "arguments": "{}"}
            }]
        }),
        "legacy completions history keeps reasoning under the historical default field"
    );
}

#[tokio::test]
async fn cross_model_history_strips_foreign_reasoning_on_anthropic() {
    // A session that switched from OpenAI to Anthropic: the foreign
    // reasoning items and text never reach the Anthropic wire, but the
    // rest of the turn (content, tool_use, tool_result) stays valid.
    let server = ScriptedServer::start(vec![s5_anthropic_response()]);
    let client = test_model_client(
        BackendKind::AnthropicMessages,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let foreign = Some(ModelOrigin {
        backend: BackendKind::OpenAiResponses,
        model: "gpt-5.5".to_string(),
    });
    let body = s5_send_and_finish(
        &client,
        server,
        s5_history(
            foreign,
            None,
            Some("foreign thinking"),
            Some(s5_reasoning_items()),
        ),
    )
    .await;

    assert_eq!(
        body["messages"],
        json!([
            {"role": "user", "content": [
                {"type": "text", "text": "first", "cache_control": {"type": "ephemeral"}}
            ]},
            {"role": "assistant", "content": [
                {"type": "text", "text": "prior answer"},
                {"type": "tool_use", "id": "call-1", "name": "read", "input": {}}
            ]},
            {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "call-1", "content": "tool output"}
            ]},
            {"role": "user", "content": [
                {"type": "text", "text": "second", "cache_control": {"type": "ephemeral"}}
            ]}
        ]),
        "no foreign reasoning items or thinking blocks on the anthropic wire"
    );
}

#[tokio::test]
async fn cross_model_history_strips_foreign_reasoning_on_openai_responses() {
    // The reverse switch: Anthropic thinking blocks must not reach the
    // OpenAI wire as reasoning items.
    let server = ScriptedServer::start(vec![s5_openai_response()]);
    let client = test_model_client(
        BackendKind::OpenAiResponses,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let foreign = Some(ModelOrigin {
        backend: BackendKind::AnthropicMessages,
        model: "claude-opus-4-6".to_string(),
    });
    let body = s5_send_and_finish(
        &client,
        server,
        s5_history(foreign, None, None, Some(s5_thinking_blocks())),
    )
    .await;

    assert_eq!(
        body["input"],
        json!([
            {"role": "user", "content": "first"},
            {"type": "function_call", "call_id": "call-1", "name": "read", "arguments": "{}"},
            {"role": "assistant", "content": "prior answer"},
            {"type": "function_call_output", "call_id": "call-1", "output": "tool output"},
            {"role": "user", "content": "second"}
        ]),
        "no foreign thinking blocks on the openai wire"
    );
}

#[tokio::test]
async fn cross_model_history_strips_foreign_reasoning_on_completions() {
    let server = ScriptedServer::start(vec![s5_completions_response()]);
    let client = test_model_client(
        BackendKind::FireworksChat,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let foreign = Some(ModelOrigin {
        backend: BackendKind::DeepSeekChat,
        model: "deepseek-chat".to_string(),
    });
    let body = s5_send_and_finish(
        &client,
        server,
        s5_history(
            foreign,
            Some("reasoning_content"),
            Some("foreign thinking"),
            None,
        ),
    )
    .await;

    let assistant = &body["messages"][1];
    assert_eq!(assistant["content"], json!("prior answer"));
    assert!(
        assistant.get("reasoning_content").is_none() && assistant.get("reasoning").is_none(),
        "foreign reasoning text is not replayed: {assistant}"
    );
    assert!(
        assistant.get("tool_calls").is_some(),
        "tool calls preserved"
    );
}

#[tokio::test]
async fn together_reasoning_round_trips_under_the_reasoning_field() {
    let server = ScriptedServer::start(vec![
        ScriptedResponse::json(
            "200 OK",
            json!({
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": "first answer", "reasoning": "together thinking"}
                }],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        ),
        s5_completions_response(),
    ]);
    let client = test_model_client(
        BackendKind::TogetherChat,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );

    let first = client
        .send_turn(
            vec![Message::User {
                content: "start".to_string(),
            }],
            vec![],
        )
        .await
        .expect("first together response should parse");
    assert_eq!(
        first.assistant.reasoning_text.as_deref(),
        Some("together thinking")
    );
    assert_eq!(
        first.assistant.reasoning_field.as_deref(),
        Some("reasoning"),
        "the parser records the field together actually used"
    );

    // Mirror the agent push site: stamp the transcript message with the
    // client origin and the parsed reasoning field.
    let history = vec![
        Message::User {
            content: "start".to_string(),
        },
        Message::Assistant {
            content: first.assistant.content.clone(),
            reasoning_text: first.assistant.reasoning_text.clone(),
            reasoning_details: None,
            tool_calls: None,
            model_origin: Some(client.model_origin()),
            reasoning_field: first.assistant.reasoning_field.clone(),
            duration_ms: None,
        },
        Message::User {
            content: "continue".to_string(),
        },
    ];
    let second = client
        .send_turn(history, vec![])
        .await
        .expect("second together response should parse");
    assert_eq!(second.assistant.content.as_deref(), Some("done"));

    let requests = server.finish();
    assert_eq!(requests.len(), 2);
    let body = serde_json::from_slice::<Value>(&requests[1].body).expect("request body is JSON");
    assert_eq!(body["max_tokens"], client.resolved_model.max_tokens);
    assert_eq!(body["context_length_exceeded_behavior"], "truncate");
    assert_eq!(
        body["messages"][1],
        json!({
            "role": "assistant",
            "content": "first answer",
            "reasoning": "together thinking"
        }),
        "replay uses together's own field name, not the deepseek default"
    );
}

#[tokio::test]
async fn orphaned_tool_call_is_completed_on_the_anthropic_wire() {
    // Cancel-after-push shape, end-to-end: the assistant turn has a tool
    // call whose result never arrived. Anthropic 400s on a tool_use
    // without a matching tool_result, so normalization synthesizes one.
    let server = ScriptedServer::start(vec![s5_anthropic_response()]);
    let client = test_model_client(
        BackendKind::AnthropicMessages,
        server.base_url.clone(),
        std::collections::BTreeMap::new(),
    );
    let origin = Some(client.model_origin());
    let mut history = s5_history(origin, None, None, Some(s5_thinking_blocks()));
    history.remove(2); // drop the tool result, leaving the call orphaned
    let body = s5_send_and_finish(&client, server, history).await;

    assert_eq!(
        body["messages"][2],
        json!({"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": "call-1",
             "content": "Tool execution was interrupted; no result was recorded."}
        ]}),
        "the orphaned call gains a synthesized interruption result"
    );
}
