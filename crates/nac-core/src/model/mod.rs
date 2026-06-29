use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;
use url::Url;

use crate::types::{FunctionCall, Message, ToolCall, ToolDefinition};

mod anthropic;
mod backend;
mod chat;
mod chatgpt_codex;
mod client;
mod requests;
mod responses;
mod types;

pub(crate) use backend::detect_backend;
use chatgpt_codex::{codex_auth_login, codex_auth_logout, codex_auth_status};
pub(crate) use client::ModelClient;
pub(crate) use types::{AssistantTurn, ClientOverrides, ModelTurnResponse, TokenUsage};
pub use types::{BackendKind, ReasoningEffort};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexAuthAction {
    Login,
    Status,
    Logout,
}

pub async fn run_codex_auth_action(action: CodexAuthAction) -> Result<()> {
    match action {
        CodexAuthAction::Login => codex_auth_login().await,
        CodexAuthAction::Status => codex_auth_status(),
        CodexAuthAction::Logout => codex_auth_logout(),
    }
}

use anthropic::*;
use backend::*;
use chat::*;
use requests::*;
use responses::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::ffi::OsString;

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn test_missing_api_key_error() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original = std::env::var("OPENAI_API_KEY").ok();
        unsafe {
            std::env::remove_var("OPENAI_API_KEY");
        }

        let result = ModelClient::from_env();
        assert!(result.is_err(), "Expected error when API key missing");
        let err_msg = result
            .err()
            .expect("Expected missing-key error")
            .to_string();
        assert!(
            err_msg.contains("OPENAI_API_KEY"),
            "Error should mention OPENAI_API_KEY, got: {}",
            err_msg
        );

        if let Some(key) = original {
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        } else {
            unsafe {
                std::env::remove_var("OPENAI_API_KEY");
            }
        }
    }

    #[test]
    fn explicit_deepseek_backend_defaults_to_deepseek_url_and_model() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_openai_key = std::env::var_os("OPENAI_API_KEY");
        let original_base_url = std::env::var_os("OPENAI_BASE_URL");
        let original_model = std::env::var_os("OPENAI_MODEL");

        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_openai_key");
            std::env::remove_var("OPENAI_BASE_URL");
            std::env::remove_var("OPENAI_MODEL");
        }

        let client = ModelClient::from_env_with_overrides(ClientOverrides {
            backend: Some(BackendKind::DeepSeekChat),
            ..ClientOverrides::default()
        })
        .unwrap();

        assert_eq!(client.base_url(), "https://api.deepseek.com");
        assert_eq!(client.backend(), BackendKind::DeepSeekChat);
        assert_eq!(client.model, "deepseek-v4-pro");
        assert_eq!(client.reasoning_effort(), None);

        restore_env("OPENAI_API_KEY", original_openai_key);
        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
    }

    #[test]
    fn detects_backend_from_url() {
        assert_eq!(
            detect_backend("https://api.openai.com/v1").unwrap(),
            BackendKind::OpenAiResponses
        );
        assert_eq!(
            detect_backend("https://api.fireworks.ai/inference/v1").unwrap(),
            BackendKind::FireworksChat
        );
        assert_eq!(
            detect_backend("https://api.deepseek.com").unwrap(),
            BackendKind::DeepSeekChat
        );
        assert_eq!(
            detect_backend("https://api.anthropic.com").unwrap(),
            BackendKind::AnthropicMessages
        );
        assert!(detect_backend("https://example.com/v1").is_err());
    }

    #[test]
    fn anthropic_messages_request_includes_adaptive_max_thinking_and_128000() {
        let request = anthropic_messages_request(
            "claude-opus-4-6",
            &[
                Message::System {
                    content: "system instructions".to_string(),
                },
                Message::User {
                    content: "read a file".to_string(),
                },
            ],
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read a file".to_string(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"}
                        },
                        "required": ["path"]
                    }),
                },
            }],
            None,
        )
        .unwrap();

        assert_eq!(request["model"], "claude-opus-4-6");
        assert_eq!(request["max_tokens"], 128000);
        assert_eq!(request["thinking"]["type"], "adaptive");
        assert_eq!(request["thinking"]["display"], "omitted");
        assert_eq!(request["output_config"]["effort"], "max");
        // System prompt is now a content-block array with cache_control.
        assert_eq!(request["system"][0]["type"], "text");
        assert_eq!(request["system"][0]["text"], "system instructions");
        assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
        assert!(request["system"][0]["cache_control"].get("ttl").is_none());
        // Last tool has cache_control.
        assert_eq!(request["tools"][0]["name"], "read");
        assert_eq!(request["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(request["tools"][0]["cache_control"]["type"], "ephemeral");
        // Last message (user) content is converted to array with cache_control.
        assert_eq!(request["messages"][0]["role"], "user");
        assert_eq!(request["messages"][0]["content"][0]["type"], "text");
        assert_eq!(request["messages"][0]["content"][0]["text"], "read a file");
        assert_eq!(
            request["messages"][0]["content"][0]["cache_control"]["type"],
            "ephemeral"
        );
    }

    #[test]
    fn anthropic_request_with_1h_ttl_sets_ttl_on_all_breakpoints() {
        let request = anthropic_messages_request(
            "claude-sonnet-4-6",
            &[
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
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
        )
        .unwrap();

        // System breakpoint has 1h TTL.
        assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(request["system"][0]["cache_control"]["ttl"], "1h");
        // Tool breakpoint has 1h TTL.
        assert_eq!(request["tools"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(request["tools"][0]["cache_control"]["ttl"], "1h");
        // Last message breakpoint has 1h TTL.
        assert_eq!(
            request["messages"][0]["content"][0]["cache_control"]["ttl"],
            "1h"
        );
    }

    #[test]
    fn anthropic_request_with_no_messages_skips_message_breakpoint() {
        let request = anthropic_messages_request(
            "claude-sonnet-4-6",
            &[Message::System {
                content: "system only".to_string(),
            }],
            &[],
            None,
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
            &[
                Message::User {
                    content: "please inspect".to_string(),
                },
                Message::Assistant {
                    content: parsed.assistant.content.clone(),
                    reasoning_text: None,
                    reasoning_details: parsed.assistant.reasoning_details.clone(),
                    tool_calls: parsed.assistant.tool_calls.clone(),
                },
                Message::Tool {
                    tool_call_id: "toolu_1".to_string(),
                    content: "file contents".to_string(),
                },
            ],
            &[],
            None,
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

    #[test]
    fn deepseek_chat_request_enables_max_thinking_and_preserves_reasoning() {
        let request = deepseek_chat_request(
            "deepseek-v4-pro",
            &[Message::Assistant {
                content: Some("calling a tool".to_string()),
                reasoning_text: Some("need current context".to_string()),
                reasoning_details: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read".to_string(),
                        arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                    },
                }]),
            }],
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read a file".to_string(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"}
                        },
                        "required": ["path"]
                    }),
                },
            }],
        );

        assert_eq!(request["model"], "deepseek-v4-pro");
        assert_eq!(request["thinking"]["type"], "enabled");
        assert_eq!(request["reasoning_effort"], "max");
        assert!(request.get("temperature").is_none());
        assert_eq!(
            request["messages"][0]["reasoning_content"],
            "need current context"
        );
        assert_eq!(request["tools"][0]["type"], "function");
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
    fn parses_deepseek_chat_output() {
        let parsed = parse_chat_completions_response(
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
        )
        .unwrap();

        assert_eq!(parsed.assistant.content.as_deref(), Some("done"));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("worked through it")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 30);
    }

    #[test]
    fn parses_openai_responses_output() {
        let parsed = parse_openai_responses_response(
            &json!({
                "status": "completed",
                "output": [
                    {
                        "type": "reasoning",
                        "id": "rs_1",
                        "summary": [{"type": "summary_text", "text": "thought summary"}]
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_1",
                        "name": "read",
                        "arguments": "{\"path\":\"src/main.rs\"}"
                    },
                    {
                        "type": "message",
                        "content": [
                            {"type": "output_text", "text": "hello world"}
                        ]
                    }
                ],
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
        assert_eq!(usage.input_tokens, 20);   // 100 - 80 cached
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 80);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 150);
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
        assert_eq!(usage.orchestrator_context_tokens, 380);  // 100 + 50 + 200 + 30
    }

    #[test]
    fn parses_chat_completions_usage_with_cached_tokens() {
        let parsed = parse_chat_completions_response(
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
        )
        .unwrap();

        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 40);   // 100 - 60 cached
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 60);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 150);
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
}
