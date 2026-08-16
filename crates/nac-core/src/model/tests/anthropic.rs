//! Anthropic adapter request/response tests: effort mapping, cache
//! breakpoints, summary shapes, and thinking-block round trips.

use super::*;

#[test]
fn anthropic_request_omits_none_and_maps_supported_efforts_exactly() {
    let messages = [Message::User {
        content: "read a file".to_string(),
    }];
    let unknown_levels =
        test_resolved(BackendKind::AnthropicMessages, "claude-always-on-future").thinking_level_map;
    let unknown_max_tokens =
        test_resolved(BackendKind::AnthropicMessages, "claude-always-on-future").max_tokens;
    for effort in [None, Some(ReasoningEffort::None)] {
        let request = anthropic_messages_request(
            "claude-always-on-future",
            effort,
            &messages,
            &[],
            None,
            &unknown_levels,
            unknown_max_tokens,
            false,
            false,
            false,
        )
        .unwrap();
        // S6: max_tokens is the resolved catalog value — the conservative
        // 16_384 fallback for a model with no catalog entry (previously
        // the hardcoded 128_000 for every Anthropic model).
        assert_eq!(request["max_tokens"], 16_384);
        assert!(request.get("thinking").is_none());
        assert!(request.get("output_config").is_none());
        assert!(!request.to_string().contains("disabled"));
    }

    let opus_levels =
        test_resolved(BackendKind::AnthropicMessages, "claude-opus-4-6").thinking_level_map;
    for (effort, wire_effort) in [
        (ReasoningEffort::Low, "low"),
        (ReasoningEffort::Medium, "medium"),
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Xhigh, "max"),
    ] {
        let request = anthropic_messages_request(
            "claude-opus-4-6",
            Some(effort),
            &messages,
            &[],
            None,
            &opus_levels,
            test_resolved(BackendKind::AnthropicMessages, "claude-opus-4-6").max_tokens,
            false,
            false,
            false,
        )
        .unwrap();
        assert_eq!(request["thinking"], json!({"type": "adaptive"}));
        assert_eq!(request["output_config"], json!({"effort": wire_effort}));
    }
}

#[test]
fn anthropic_request_with_1h_ttl_sets_ttl_on_all_breakpoints() {
    let request = anthropic_messages_request(
        "claude-sonnet-4-6",
        None,
        &[
            Message::System {
                content: "system".to_string(),
            },
            Message::User {
                content: "hello".to_string(),
            },
            Message::Assistant {
                content: Some("working".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::User {
                content: "next tool results".to_string(),
            },
            Message::User {
                content: "late steering".to_string(),
            },
        ],
        &[ToolDefinition {
            def_type: "function".to_string(),
            function: crate::types::FunctionDef {
                name: "read".to_string(),
                description: "Read".to_string(),
                parameters: json!({"type": "object"}),
            },
        }],
        Some("1h"),
        &test_resolved(BackendKind::AnthropicMessages, "claude-sonnet-4-6").thinking_level_map,
        test_resolved(BackendKind::AnthropicMessages, "claude-sonnet-4-6").max_tokens,
        false,
        false,
        false,
    )
    .unwrap();

    // System breakpoint has 1h TTL.
    assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(request["system"][0]["cache_control"]["ttl"], "1h");
    // Tool breakpoint has 1h TTL.
    assert_eq!(request["tools"][0]["cache_control"]["type"], "ephemeral");
    assert_eq!(request["tools"][0]["cache_control"]["ttl"], "1h");
    // The stable user boundary before the last assistant and the current tip
    // retain 1h markers. An intervening tool-result/steering-shaped user does
    // not displace the prior provider-request boundary.
    assert_eq!(
        request["messages"][0]["content"][0]["cache_control"]["ttl"],
        "1h"
    );
    assert!(request["messages"][1]["content"][0]
        .get("cache_control")
        .is_none());
    assert!(request["messages"][2]["content"][0]
        .get("cache_control")
        .is_none());
    assert_eq!(
        request["messages"][3]["content"][0]["cache_control"]["ttl"],
        "1h"
    );
}

#[test]
fn anthropic_request_with_no_messages_skips_message_breakpoint() {
    let request = anthropic_messages_request(
        "claude-sonnet-4-6",
        None,
        &[Message::System {
            content: "system only".to_string(),
        }],
        &[],
        None,
        &test_resolved(BackendKind::AnthropicMessages, "claude-sonnet-4-6").thinking_level_map,
        test_resolved(BackendKind::AnthropicMessages, "claude-sonnet-4-6").max_tokens,
        false,
        false,
        false,
    )
    .unwrap();

    // System breakpoint still set.
    assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
    // No tools → no tools key.
    assert!(request.get("tools").is_none());
    // No messages → empty array, no crash.
    assert_eq!(request["messages"].as_array().unwrap().len(), 0);
}

#[test]
fn summary_shaped_requests_preserve_all_systems_and_omit_tools() {
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

    let openai = openai_responses_request(
        "model",
        None,
        &messages,
        &[],
        &test_resolved(BackendKind::OpenAiResponses, "model").thinking_level_map,
        None,
    );
    assert_eq!(openai["input"], serde_json::to_value(&messages).unwrap());
    assert!(openai.get("tools").is_none());

    for request in [
        completions_chat_request(
            "model",
            None,
            &messages,
            &[],
            &test_resolved(BackendKind::FireworksChat, "model").thinking_level_map,
            &test_resolved(BackendKind::FireworksChat, "model").compat,
            CompletionsMessageShape::Standard,
        ),
        completions_chat_request(
            "model",
            None,
            &messages,
            &[],
            &test_resolved(BackendKind::TogetherChat, "model").thinking_level_map,
            &test_resolved(BackendKind::TogetherChat, "model").compat,
            CompletionsMessageShape::Standard,
        ),
        completions_chat_request(
            "deepseek-v4-pro",
            None,
            &messages,
            &[],
            &test_resolved(BackendKind::DeepSeekChat, "deepseek-v4-pro").thinking_level_map,
            &test_resolved(BackendKind::DeepSeekChat, "deepseek-v4-pro").compat,
            CompletionsMessageShape::Standard,
        ),
    ] {
        assert_eq!(
            request["messages"],
            serde_json::to_value(&messages).unwrap()
        );
        assert!(request.get("tools").is_none());
    }

    let anthropic = anthropic_messages_request(
        "claude-sonnet-4-6",
        None,
        &messages,
        &[],
        Some("1h"),
        &test_resolved(BackendKind::AnthropicMessages, "claude-sonnet-4-6").thinking_level_map,
        test_resolved(BackendKind::AnthropicMessages, "claude-sonnet-4-6").max_tokens,
        false,
        false,
        false,
    )
    .unwrap();
    assert_eq!(anthropic["system"][0]["text"], "primary\n\nagents");
    assert_eq!(anthropic["messages"].as_array().unwrap().len(), 3);
    assert_eq!(anthropic["messages"][0]["content"], "historical checkpoint");
    assert_eq!(
        anthropic["messages"][2]["content"][0]["text"],
        "compaction prompt"
    );
    assert!(anthropic.get("tools").is_none());
}

#[test]
fn anthropic_response_tool_thinking_round_trips() {
    let thinking = json!({
        "type": "thinking",
        "thinking": "",
        "signature": "sig_1"
    });
    let redacted = json!({
        "type": "redacted_thinking",
        "data": "opaque"
    });
    let parsed = parse_anthropic_messages_response(
        &json!({
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "content": [
                thinking.clone(),
                redacted.clone(),
                {"type": "text", "text": "Need to inspect the file."},
                {
                    "type": "tool_use",
                    "id": "toolu_1",
                    "name": "read",
                    "input": {"path": "src/main.rs"}
                }
            ],
            "stop_reason": "tool_use",
            "usage": {"input_tokens": 10, "output_tokens": 20}
        }),
        "https://api.anthropic.com/v1/messages",
    )
    .unwrap();

    assert_eq!(
        parsed.assistant.content.as_deref(),
        Some("Need to inspect the file.")
    );
    assert_eq!(
        parsed.assistant.reasoning_details,
        Some(json!([thinking.clone(), redacted.clone()]))
    );
    assert_eq!(parsed.finish_reason.as_deref(), Some("tool_use"));
    let tool_call = &parsed
        .assistant
        .tool_calls
        .as_ref()
        .expect("tool_use should become a tool call")[0];
    assert_eq!(tool_call.id, "toolu_1");
    assert_eq!(tool_call.function.name, "read");
    assert_eq!(
        serde_json::from_str::<Value>(&tool_call.function.arguments).unwrap(),
        json!({"path": "src/main.rs"})
    );
    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 10);
    assert_eq!(usage.output_tokens, 20);
    assert_eq!(usage.cache_read_tokens, 0);
    assert_eq!(usage.cache_write_tokens, 0);
    assert_eq!(usage.orchestrator_context_tokens, 30);

    let request = anthropic_messages_request(
        "claude-opus-4-6",
        None,
        &[
            Message::User {
                content: "please inspect".to_string(),
            },
            Message::Assistant {
                content: parsed.assistant.content.clone(),
                reasoning_text: None,
                reasoning_details: parsed.assistant.reasoning_details.clone(),
                tool_calls: parsed.assistant.tool_calls.clone(),
                model_origin: None,
                reasoning_field: None,
                duration_ms: None,
            },
            Message::Tool {
                tool_call_id: "toolu_1".to_string(),
                content: ("file contents".to_string()).into(),
            },
        ],
        &[],
        None,
        &test_resolved(BackendKind::AnthropicMessages, "claude-opus-4-6").thinking_level_map,
        test_resolved(BackendKind::AnthropicMessages, "claude-opus-4-6").max_tokens,
        false,
        false,
        false,
    )
    .unwrap();

    let assistant_blocks = request["messages"][1]["content"]
        .as_array()
        .expect("assistant content should be blocks");
    assert_eq!(assistant_blocks[0], thinking);
    assert_eq!(assistant_blocks[1], redacted);
    assert_eq!(assistant_blocks[3]["type"], "tool_use");
    assert_eq!(assistant_blocks[3]["input"], json!({"path": "src/main.rs"}));
    assert_eq!(request["messages"][2]["role"], "user");
    assert_eq!(request["messages"][2]["content"][0]["type"], "tool_result");
    assert_eq!(
        request["messages"][2]["content"][0]["tool_use_id"],
        "toolu_1"
    );
}
