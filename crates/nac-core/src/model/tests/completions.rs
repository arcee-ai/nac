//! Completions/responses request-builder tests: the single compat-driven
//! completions builder and the responses input-item expansion.

use super::*;

#[test]
fn deepseek_request_reasoning_is_driven_only_by_explicit_effort() {
    let messages = [Message::Assistant {
        content: Some("calling a tool".to_string()),
        reasoning_text: Some("need current context".to_string()),
        reasoning_details: None,
        tool_calls: None,
        model_origin: None,
        reasoning_field: None,
        duration_ms: None,
    }];
    let levels = test_resolved(BackendKind::DeepSeekChat, "deepseek-v4-pro").thinking_level_map;
    let compat = test_resolved(BackendKind::DeepSeekChat, "deepseek-v4-pro").compat;
    let absent = completions_chat_request(
        "deepseek-v4-pro",
        None,
        &messages,
        &[],
        &levels,
        &compat,
        CompletionsMessageShape::Standard,
    );
    assert!(absent.get("thinking").is_none());
    assert!(absent.get("reasoning_effort").is_none());
    // DeepSeek's compat sends temperature 0.0 (V4 models accept it; the
    // old "rejects temperature on reasoning models" note was R1-specific).
    assert_eq!(absent["temperature"], json!(0.0));
    assert_eq!(
        absent["messages"][0]["reasoning_content"],
        "need current context"
    );

    let disabled = completions_chat_request(
        "deepseek-v4-pro",
        Some(ReasoningEffort::None),
        &messages,
        &[],
        &levels,
        &compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(disabled["thinking"], json!({"type": "disabled"}));
    assert!(disabled.get("reasoning_effort").is_none());

    // The wire tier `max` for `xhigh` comes from the catalog map, not
    // from adapter code (requests.rs carries no "max" literal).
    for (effort, wire_effort) in [
        (ReasoningEffort::High, "high"),
        (ReasoningEffort::Xhigh, "max"),
    ] {
        let request = completions_chat_request(
            "deepseek-v4-pro",
            Some(effort),
            &messages,
            &[],
            &levels,
            &compat,
            CompletionsMessageShape::Standard,
        );
        assert_eq!(request["thinking"], json!({"type": "enabled"}));
        assert_eq!(request["reasoning_effort"], wire_effort);
    }
}

#[test]
fn one_completions_builder_reproduces_every_provider_shape_from_compat() {
    // S6 consolidation guard: a single builder, driven only by catalog
    // compat data, reproduces the four distinct completions request
    // shapes (DeepSeek, Fireworks, Together, Arcee) — including the
    // per-provider reasoning replay field for unstamped (legacy)
    // assistant messages.
    let messages = [
        Message::User {
            content: "hi".to_string(),
        },
        Message::Assistant {
            content: Some("prior".to_string()),
            reasoning_text: Some("thought".to_string()),
            reasoning_details: None,
            tool_calls: None,
            model_origin: None,
            reasoning_field: None,
            duration_ms: None,
        },
    ];
    let user = json!({"role": "user", "content": "hi"});

    let deepseek = completions_chat_request(
        "m",
        Some(ReasoningEffort::High),
        &messages,
        &[],
        &test_resolved(BackendKind::DeepSeekChat, "m").thinking_level_map,
        &test_resolved(BackendKind::DeepSeekChat, "m").compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(
        deepseek,
        json!({
            "model": "m",
            "messages": [
                user,
                {"role": "assistant", "content": "prior", "reasoning_content": "thought"}
            ],
            "temperature": 0.0,
            "thinking": {"type": "enabled"},
            "reasoning_effort": "high"
        }),
        "DeepSeek: thinking dialect, temperature 0.0"
    );

    let fireworks = completions_chat_request(
        "m",
        Some(ReasoningEffort::High),
        &messages,
        &[],
        &test_resolved(BackendKind::FireworksChat, "m").thinking_level_map,
        &test_resolved(BackendKind::FireworksChat, "m").compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(
        fireworks,
        json!({
            "model": "m",
            "messages": [
                user,
                {"role": "assistant", "content": "prior", "reasoning_content": "thought"}
            ],
            "temperature": 0.0,
            "reasoning_effort": "high",
            "reasoning_history": "preserved"
        }),
        "Fireworks: reasoning_effort + reasoning_history dialect"
    );

    let together = completions_chat_request(
        "m",
        Some(ReasoningEffort::High),
        &messages,
        &[],
        &test_resolved(BackendKind::TogetherChat, "m").thinking_level_map,
        &test_resolved(BackendKind::TogetherChat, "m").compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(
        together,
        json!({
            "model": "m",
            "messages": [
                user,
                {"role": "assistant", "content": "prior", "reasoning": "thought"}
            ],
            "temperature": 0.0,
            "reasoning": {"enabled": true},
            "reasoning_effort": "high",
            "chat_template_kwargs": {"clear_thinking": false}
        }),
        "Together: reasoning.enabled dialect, reasoning replay field"
    );

    // Arcee's _default has the Arcee thinking format (bare reasoning_effort),
    // but "m" is an unknown model with an empty thinking_level_map, so
    // validation rejects every explicit effort. The effort-free shape is the
    // only reachable one for unknown models.
    let arcee = completions_chat_request(
        "m",
        None,
        &messages,
        &[],
        &test_resolved(BackendKind::ArceeApi, "m").thinking_level_map,
        &test_resolved(BackendKind::ArceeApi, "m").compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(
        arcee,
        json!({
            "model": "m",
            "messages": [
                user,
                {"role": "assistant", "content": "prior", "reasoning_content": "thought"}
            ],
            "temperature": 0.0
        }),
        "Arcee: effort-free shape (bare reasoning_effort dialect)"
    );

    // Arcee passthrough models: the Arcee format sends bare
    // `reasoning_effort` — no `thinking`, `reasoning_history`, or
    // `chat_template_kwargs` wrapper objects. The wire value comes from the
    // catalog map (xhigh → "max" for deepseek/glm passthrough models).
    let arcee_passthrough_levels = ThinkingLevelMap(std::collections::BTreeMap::from([
        (ReasoningEffort::None, Some("none".to_string())),
        (ReasoningEffort::Low, Some("low".to_string())),
        (ReasoningEffort::Medium, Some("medium".to_string())),
        (ReasoningEffort::High, Some("high".to_string())),
        (ReasoningEffort::Xhigh, Some("max".to_string())),
    ]));
    let arcee_compat = Compat {
        completions_thinking_format: Some(CompletionsThinkingFormat::Arcee),
        completions_reasoning_field: Some("reasoning_content".to_string()),
        completions_temperature: Some(0.0),
    };
    let arcee_none = completions_chat_request(
        "deepseek-ai/deepseek-v4-pro",
        Some(ReasoningEffort::None),
        &messages,
        &[],
        &arcee_passthrough_levels,
        &arcee_compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(arcee_none["reasoning_effort"], "none");
    assert!(arcee_none.get("thinking").is_none());
    assert!(arcee_none.get("reasoning_history").is_none());
    assert!(arcee_none.get("chat_template_kwargs").is_none());
    assert!(arcee_none.get("reasoning").is_none());

    let arcee_high = completions_chat_request(
        "deepseek-ai/deepseek-v4-pro",
        Some(ReasoningEffort::High),
        &messages,
        &[],
        &arcee_passthrough_levels,
        &arcee_compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(arcee_high["reasoning_effort"], "high");
    assert!(arcee_high.get("thinking").is_none());
    assert!(arcee_high.get("reasoning_history").is_none());
    assert!(arcee_high.get("chat_template_kwargs").is_none());
    assert!(arcee_high.get("reasoning").is_none());

    let arcee_xhigh = completions_chat_request(
        "deepseek-ai/deepseek-v4-pro",
        Some(ReasoningEffort::Xhigh),
        &messages,
        &[],
        &arcee_passthrough_levels,
        &arcee_compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(arcee_xhigh["reasoning_effort"], "max");
}

#[test]
fn openai_compatible_request_schemas_honor_absent_none_and_supported_efforts() {
    // The absent/None emission dialects per completions format, plus tools
    // handling. The supported-effort wire values are pinned byte-exactly by
    // `one_completions_builder_reproduces_every_provider_shape_from_compat`
    // (and the map data by the catalog guards), so only the cases that
    // test does not cover remain here.
    let messages = [Message::User {
        content: "hi".into(),
    }];

    let fireworks_levels = test_resolved(BackendKind::FireworksChat, "model").thinking_level_map;
    let fireworks_compat = test_resolved(BackendKind::FireworksChat, "model").compat;
    let fireworks_absent = completions_chat_request(
        "model",
        None,
        &messages,
        &[],
        &fireworks_levels,
        &fireworks_compat,
        CompletionsMessageShape::Standard,
    );
    assert!(fireworks_absent.get("reasoning_effort").is_none());
    assert!(fireworks_absent.get("reasoning_history").is_none());
    assert!(fireworks_absent.get("tools").is_none());
    assert_eq!(fireworks_absent["temperature"], json!(0.0));
    let fireworks_none = completions_chat_request(
        "model",
        Some(ReasoningEffort::None),
        &messages,
        &[],
        &fireworks_levels,
        &fireworks_compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(fireworks_none["reasoning_effort"], "none");
    assert_eq!(fireworks_none["reasoning_history"], "disabled");

    let together_levels = test_resolved(BackendKind::TogetherChat, "model").thinking_level_map;
    let together_compat = test_resolved(BackendKind::TogetherChat, "model").compat;
    let together_absent = completions_chat_request(
        "model",
        None,
        &messages,
        &[],
        &together_levels,
        &together_compat,
        CompletionsMessageShape::Standard,
    );
    assert!(together_absent.get("reasoning").is_none());
    assert!(together_absent.get("reasoning_effort").is_none());
    assert!(together_absent.get("chat_template_kwargs").is_none());
    assert!(together_absent.get("tools").is_none());
    let together_none = completions_chat_request(
        "model",
        Some(ReasoningEffort::None),
        &messages,
        &[],
        &together_levels,
        &together_compat,
        CompletionsMessageShape::Standard,
    );
    assert_eq!(together_none["reasoning"], json!({"enabled": false}));
    assert!(together_none.get("reasoning_effort").is_none());

    let openai_levels = test_resolved(BackendKind::OpenAiResponses, "model").thinking_level_map;
    let openai_absent =
        openai_responses_request("model", None, &messages, &[], &openai_levels, None);
    // Readable reasoning is asked for regardless; only the effort is opt-in.
    assert_eq!(openai_absent["reasoning"], json!({"summary": "auto"}));
    assert!(openai_absent.get("tools").is_none());
    // OpenAI's uniform path emits the map's wire value for every effort,
    // including `none`.
    let openai_none = openai_responses_request(
        "model",
        Some(ReasoningEffort::None),
        &messages,
        &[],
        &openai_levels,
        None,
    );
    assert_eq!(openai_none["reasoning"]["effort"], "none");

    let tools = [ToolDefinition {
        def_type: "function".to_string(),
        function: crate::types::FunctionDef {
            name: "read".to_string(),
            description: "Read a file".to_string(),
            parameters: json!({"type": "object"}),
        },
    }];
    assert!(completions_chat_request(
        "model",
        None,
        &messages,
        &tools,
        &fireworks_levels,
        &fireworks_compat,
        CompletionsMessageShape::Standard,
    )
    .get("tools")
    .is_some());
    assert!(completions_chat_request(
        "model",
        None,
        &messages,
        &tools,
        &together_levels,
        &together_compat,
        CompletionsMessageShape::Standard,
    )
    .get("tools")
    .is_some());
    assert!(
        openai_responses_request("model", None, &messages, &tools, &openai_levels, None)
            .get("tools")
            .is_some()
    );
}

#[test]
fn gpt_5_6_responses_cache_only_the_stable_system_prefix() {
    let messages = [
        Message::System {
            content: "stable instructions".to_string(),
        },
        Message::User {
            content: "changing request".to_string(),
        },
    ];
    let levels = test_resolved(BackendKind::OpenAiResponses, "gpt-5.6").thinking_level_map;
    let request =
        openai_responses_request("gpt-5.6", None, &messages, &[], &levels, Some("session-1"));

    assert_eq!(request["prompt_cache_key"], "session-1");
    assert_eq!(request["prompt_cache_options"], json!({"mode": "explicit"}));
    assert_eq!(
        request["input"][0]["content"][0]["prompt_cache_breakpoint"],
        json!({"mode": "explicit"})
    );
    assert_eq!(
        request["input"][0]["content"][0]["text"],
        "stable instructions"
    );
    assert_eq!(request["input"][1]["content"], "changing request");

    let older = openai_responses_request(
        "gpt-5.5",
        None,
        &messages,
        &[],
        &test_resolved(BackendKind::OpenAiResponses, "gpt-5.5").thinking_level_map,
        Some("session-1"),
    );
    assert_eq!(older["prompt_cache_key"], "session-1");
    assert!(older.get("prompt_cache_options").is_none());
    assert_eq!(older["input"][0]["content"], "stable instructions");
}

#[test]
fn responses_input_items_expand_reasoning_and_tool_state() {
    let items = responses_input_items(&[
        Message::System {
            content: "system".to_string(),
        },
        Message::Assistant {
            content: Some("assistant text".to_string()),
            reasoning_text: Some("hidden".to_string()),
            reasoning_details: Some(json!([{
                "type": "reasoning",
                "id": "rs_1",
                "summary": [{"type": "summary_text", "text": "keep this"}]
            }])),
            tool_calls: Some(vec![ToolCall {
                id: "call_1".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "read".to_string(),
                    arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                },
            }]),
            model_origin: None,
            reasoning_field: None,
            duration_ms: None,
        },
        Message::Tool {
            tool_call_id: "call_1".to_string(),
            content: "tool output".to_string(),
        },
    ]);

    assert_eq!(items.len(), 5);
    assert_eq!(items[0]["role"], "system");
    assert_eq!(items[1]["type"], "reasoning");
    assert_eq!(items[2]["type"], "function_call");
    assert_eq!(items[3]["role"], "assistant");
    assert_eq!(items[4]["type"], "function_call_output");
}

#[test]
fn responses_input_items_replay_exact_output_sequence() {
    let output = vec![
        json!({
            "type": "message",
            "id": "msg_commentary",
            "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "Checking that now."}]
        }),
        json!({
            "type": "reasoning",
            "id": "rs_1",
            "encrypted_content": "encrypted",
            "summary": [{"type": "summary_text", "text": "Need the file."}]
        }),
        json!({
            "type": "function_call",
            "id": "fc_1",
            "call_id": "call_1",
            "name": "read",
            "arguments": "{\"path\":\"src/main.rs\"}",
            "status": "completed"
        }),
    ];
    let items = responses_input_items(&[
        Message::Assistant {
            content: Some("Checking that now.".to_string()),
            reasoning_text: Some("Need the file.".to_string()),
            reasoning_details: Some(json!({
                "type": "openai_responses_output",
                "items": output.clone()
            })),
            tool_calls: Some(vec![ToolCall {
                id: "call_1".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "read".to_string(),
                    arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                },
            }]),
            model_origin: None,
            reasoning_field: None,
            duration_ms: None,
        },
        Message::Tool {
            tool_call_id: "call_1".to_string(),
            content: "tool output".to_string(),
        },
    ]);

    assert_eq!(&items[..output.len()], output.as_slice());
    assert_eq!(items.len(), output.len() + 1);
    assert_eq!(items[3]["type"], "function_call_output");
    assert_eq!(items[3]["call_id"], "call_1");
}
