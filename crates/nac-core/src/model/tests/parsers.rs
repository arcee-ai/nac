//! Response parser tests for every adapter family, including usage
//! shapes and the parse-time never-bills contract.

use super::*;

#[test]
fn parses_deepseek_chat_output() {
    let parsed = parse_completions_response(
        &json!({
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": "done",
                        "reasoning_content": "worked through it",
                        "tool_calls": null
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 10,
                "completion_tokens": 20,
                "total_tokens": 30,
                "completion_tokens_details": {
                    "reasoning_tokens": 9
                }
            }
        }),
        "https://api.deepseek.com/chat/completions",
        "reasoning_content",
    )
    .unwrap();

    assert_eq!(parsed.assistant.content.as_deref(), Some("done"));
    assert_eq!(
        parsed.assistant.reasoning_text.as_deref(),
        Some("worked through it")
    );
    assert_eq!(
        parsed.assistant.reasoning_field.as_deref(),
        Some("reasoning_content")
    );
    assert!(parsed.assistant.tool_calls.is_none());
    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 10);
    assert_eq!(usage.output_tokens, 20);
    assert_eq!(usage.cache_read_tokens, 0);
    assert_eq!(usage.cache_write_tokens, 0);
    // S6: the unified parser reads the nested reasoning_tokens shape for
    // every completions provider (previously DeepSeek/Fireworks/Arcee
    // always parsed 0).
    assert_eq!(usage.reasoning_tokens, 9);
    assert_eq!(usage.orchestrator_context_tokens, 30);
}

#[test]
fn parses_openai_responses_output() {
    let output = vec![
        json!({
            "type": "reasoning",
            "id": "rs_1",
            "summary": [{"type": "summary_text", "text": "thought summary"}],
            "encrypted_content": "encrypted"
        }),
        json!({
            "type": "function_call",
            "id": "fc_1",
            "call_id": "call_1",
            "name": "read",
            "arguments": "{\"path\":\"src/main.rs\"}",
            "status": "completed"
        }),
        json!({
            "type": "message",
            "id": "msg_1",
            "status": "completed",
            "content": [
                {"type": "output_text", "text": "hello world"}
            ]
        }),
    ];
    let parsed = parse_openai_responses_response(
        &json!({
            "status": "completed",
            "output": output.clone(),
            "usage": {
                "input_tokens": 10,
                "output_tokens": 20,
                "total_tokens": 30,
                "output_tokens_details": {
                    "reasoning_tokens": 7
                }
            }
        }),
        "https://api.openai.com/v1/responses",
    )
    .unwrap();

    assert_eq!(parsed.assistant.content.as_deref(), Some("hello world"));
    assert_eq!(
        parsed.assistant.reasoning_text.as_deref(),
        Some("thought summary")
    );
    assert_eq!(
        parsed
            .assistant
            .tool_calls
            .as_ref()
            .expect("tool calls should be parsed")
            .len(),
        1
    );
    assert_eq!(
        stored_responses_output(
            parsed
                .assistant
                .reasoning_details
                .as_ref()
                .expect("Responses output state should be retained")
        ),
        Some(output.as_slice())
    );
    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 10);
    assert_eq!(usage.output_tokens, 20);
    assert_eq!(usage.cache_read_tokens, 0);
    assert_eq!(usage.cache_write_tokens, 0);
    assert_eq!(usage.orchestrator_context_tokens, 30);
}

#[test]
fn parses_openai_responses_usage_with_cached_tokens() {
    let parsed = parse_openai_responses_response(
        &json!({
            "status": "completed",
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": "hi"}]}
            ],
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "total_tokens": 150,
                "input_tokens_details": {"cached_tokens": 80},
                "output_tokens_details": {"reasoning_tokens": 10}
            }
        }),
        "https://api.openai.com/v1/responses",
    )
    .unwrap();

    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 20); // 100 - 80 cached
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_read_tokens, 80);
    assert_eq!(usage.cache_write_tokens, 0);
    assert_eq!(usage.orchestrator_context_tokens, 150);

    // Parsers never bill; the client attaches cost from catalog rates.
    assert_eq!(usage.cost, TokenCostMicros::default());
    // gpt-5.2 catalog rates ($/1M): 1.75 / 14 / 0.175 / 0.
    let cost = calculate_cost(
        &catalog::ModelCostRates {
            input: 1.75,
            output: 14.0,
            cache_read: 0.175,
            cache_write: 0.0,
        },
        None,
        &usage,
    );
    assert_eq!(cost.input, 35);
    assert_eq!(cost.output, 700);
    assert_eq!(cost.cache_read, 14);
    assert_eq!(cost.cache_write, 0);
    assert_eq!(cost.total, 749);
}

#[test]
fn parses_anthropic_usage_with_cache_fields() {
    let parsed = parse_anthropic_messages_response(
        &json!({
            "content": [{"type": "text", "text": "done"}],
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 200,
                "cache_creation_input_tokens": 30
            }
        }),
        "https://api.anthropic.com/v1/messages",
    )
    .unwrap();

    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_read_tokens, 200);
    assert_eq!(usage.cache_write_tokens, 30);
    assert_eq!(usage.orchestrator_context_tokens, 380); // 100 + 50 + 200 + 30

    // Parsers never bill; the client attaches cost from catalog rates.
    assert_eq!(usage.cost, TokenCostMicros::default());
    // claude-opus-4-6 catalog rates ($/1M): 5 / 25 / 0.5 / 6.25.
    let cost = calculate_cost(
        &catalog::ModelCostRates {
            input: 5.0,
            output: 25.0,
            cache_read: 0.5,
            cache_write: 6.25,
        },
        None,
        &usage,
    );
    assert_eq!(cost.input, 500);
    assert_eq!(cost.output, 1_250);
    assert_eq!(cost.cache_read, 100);
    assert_eq!(cost.cache_write, 188, "187.5 micros rounds half-up");
    assert_eq!(cost.total, 2_038);
}

#[test]
fn parses_chat_completions_usage_with_cached_tokens() {
    let parsed = parse_completions_response(
        &json!({
            "choices": [{
                "finish_reason": "stop",
                "message": {"content": "done", "tool_calls": null}
            }],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
                "prompt_tokens_details": {"cached_tokens": 60},
                "completion_tokens_details": {"reasoning_tokens": 5}
            }
        }),
        "https://api.deepseek.com/chat/completions",
        "reasoning_content",
    )
    .unwrap();

    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 40); // 100 - 60 cached
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_read_tokens, 60);
    assert_eq!(usage.cache_write_tokens, 0);
    assert_eq!(usage.orchestrator_context_tokens, 150);

    // Parsers never bill; the client attaches cost from catalog rates.
    assert_eq!(usage.cost, TokenCostMicros::default());
    // deepseek-chat catalog rates ($/1M): 0.14 / 0.28 / 0.0028 / 0.
    let cost = calculate_cost(
        &catalog::ModelCostRates {
            input: 0.14,
            output: 0.28,
            cache_read: 0.0028,
            cache_write: 0.0,
        },
        None,
        &usage,
    );
    assert_eq!(cost.input, 6, "5.6 micros rounds to 6");
    assert_eq!(cost.output, 14);
    assert_eq!(cost.cache_read, 0, "0.168 micros rounds to 0");
    assert_eq!(cost.total, 20);
}

#[test]
fn response_without_usage_yields_none() {
    let parsed = parse_openai_responses_response(
        &json!({
            "status": "completed",
            "output": [
                {"type": "message", "content": [{"type": "output_text", "text": "hi"}]}
            ]
        }),
        "https://api.openai.com/v1/responses",
    )
    .unwrap();

    assert!(parsed.usage.is_none());
}

#[test]
fn parses_together_chat_response() {
    let parsed = parse_completions_response(
        &json!({
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": "The answer is 42.",
                        "reasoning": "I need to think about this carefully...",
                        "tool_calls": null
                    }
                }
            ],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "total_tokens": 150,
                "cached_tokens": 60,
                "reasoning_tokens": 25
            }
        }),
        "https://api.together.ai/v1/chat/completions",
        "reasoning",
    )
    .unwrap();

    assert_eq!(
        parsed.assistant.content.as_deref(),
        Some("The answer is 42.")
    );
    assert_eq!(
        parsed.assistant.reasoning_text.as_deref(),
        Some("I need to think about this carefully...")
    );
    assert!(parsed.assistant.tool_calls.is_none());
    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 40); // 100 - 60 cached
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_read_tokens, 60);
    assert_eq!(usage.cache_write_tokens, 0);
    assert_eq!(usage.reasoning_tokens, 25);
    assert_eq!(usage.orchestrator_context_tokens, 150);

    // Parsers never bill; the client attaches cost from catalog rates.
    assert_eq!(usage.cost, TokenCostMicros::default());
    // MiniMax-M2.5 catalog rates ($/1M): 0.3 / 1.2 / 0.06 / 0.
    let cost = calculate_cost(
        &catalog::ModelCostRates {
            input: 0.3,
            output: 1.2,
            cache_read: 0.06,
            cache_write: 0.0,
        },
        None,
        &usage,
    );
    assert_eq!(cost.input, 12);
    assert_eq!(cost.output, 60);
    assert_eq!(cost.cache_read, 4, "3.6 micros rounds to 4");
    assert_eq!(cost.total, 76);
}

#[test]
fn parses_together_chat_response_nested_usage() {
    let parsed = parse_completions_response(
        &json!({
            "choices": [{
                "finish_reason": "stop",
                "message": {
                    "content": "The answer is 4.",
                    "reasoning": "We need to calculate 2+2. That equals 4.",
                    "tool_calls": null
                }
            }],
            "usage": {
                "prompt_tokens": 2618,
                "completion_tokens": 74,
                "total_tokens": 2692,
                "prompt_tokens_details": {"cached_tokens": 2560},
                "completion_tokens_details": {"reasoning_tokens": 71}
            }
        }),
        "https://api.together.ai/v1/chat/completions",
        "reasoning",
    )
    .unwrap();

    assert_eq!(
        parsed.assistant.content.as_deref(),
        Some("The answer is 4.")
    );
    assert_eq!(
        parsed.assistant.reasoning_text.as_deref(),
        Some("We need to calculate 2+2. That equals 4.")
    );
    assert!(parsed.assistant.tool_calls.is_none());
    let usage = parsed.usage.expect("usage should be parsed");
    assert_eq!(usage.input_tokens, 58); // 2618 - 2560 cached
    assert_eq!(usage.output_tokens, 74);
    assert_eq!(usage.cache_read_tokens, 2560);
    assert_eq!(usage.cache_write_tokens, 0);
    assert_eq!(usage.reasoning_tokens, 71);
    assert_eq!(usage.orchestrator_context_tokens, 2692);
}
