use super::pseudo_tool_calls::strip_native_tool_format_tags;
use super::*;

/// Wire value for an effort level that passed catalog validation (S4).
/// `EffectiveModelSettings` construction rejects unsupported levels, so a
/// missing map entry here means validation was bypassed — a bug.
pub(super) fn validated_wire_effort(
    thinking_levels: &ThinkingLevelMap,
    effort: ReasoningEffort,
) -> &str {
    thinking_levels.wire_value(effort).unwrap_or_else(|| {
        panic!(
            "reasoning effort '{}' passed validation without a catalog wire value",
            effort.as_str()
        )
    })
}

pub(super) fn completions_message_to_value(
    message: &Message,
    default_reasoning_field: &str,
) -> Value {
    match message {
        Message::System { content } => json!({
            "role": "system",
            "content": content,
        }),
        Message::User { content } => json!({
            "role": "user",
            "content": content,
        }),
        Message::Assistant {
            content,
            reasoning_text,
            reasoning_field,
            tool_calls,
            ..
        } => {
            let mut value = json!({
                "role": "assistant",
                "content": content,
            });
            if let Some(reasoning_text) = reasoning_text {
                // Replay under the field the provider originally used (S5
                // field-name discipline: together sends "reasoning", the
                // other completions providers "reasoning_content"). Unstamped
                // (legacy) messages fall back to the provider's catalog
                // compat field (S6).
                let field = reasoning_field
                    .as_deref()
                    .unwrap_or(default_reasoning_field);
                value[field] = Value::String(reasoning_text.clone());
            }
            if let Some(tool_calls) = tool_calls {
                value["tool_calls"] =
                    serde_json::to_value(tool_calls).unwrap_or_else(|_| Value::Array(Vec::new()));
            }
            value
        }
        Message::Tool {
            tool_call_id,
            content,
        } => json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
        }),
    }
}

/// Which assistant-message shape a completions request writes.
///
/// The wire protocol is otherwise the same for every provider on the
/// completions axis, so the Arcee/Trinity deviation is carried here rather
/// than in the catalog `Compat` data, which describes the protocol.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CompletionsMessageShape {
    Standard,
    Arcee,
}

/// Arcee/Trinity wire shape: strip leaked Hermes tool XML from history and
/// always send `reasoning_content` on tool-call turns (even empty).
///
/// Kept off the generic OpenAI-compatible path so Fireworks / Together /
/// DeepSeek keep a plain client. The empty-field inject is specifically for
/// vLLM's deepseek_r1 template used in front of Trinity — omitting it is what
/// routes the next tool call into reasoning as raw XML.
pub(super) fn arcee_message_to_value(message: &Message) -> Value {
    match message {
        Message::Assistant {
            content,
            reasoning_text,
            tool_calls,
            ..
        } => {
            let content = content
                .as_ref()
                .map(|text| strip_native_tool_format_tags(text));
            let reasoning = reasoning_text
                .as_deref()
                .map(strip_native_tool_format_tags)
                .map(|text| text.trim().to_string())
                .filter(|text| !text.is_empty());
            let has_tool_calls = tool_calls
                .as_ref()
                .is_some_and(|tool_calls| !tool_calls.is_empty());

            let mut value = json!({
                "role": "assistant",
                "content": content,
            });
            if has_tool_calls {
                value["reasoning_content"] = Value::String(reasoning.unwrap_or_default());
            } else if let Some(reasoning) = reasoning {
                value["reasoning_content"] = Value::String(reasoning);
            }
            if let Some(tool_calls) = tool_calls {
                value["tool_calls"] =
                    serde_json::to_value(tool_calls).unwrap_or_else(|_| Value::Array(Vec::new()));
            }
            value
        }
        other => completions_message_to_value(other, "reasoning_content"),
    }
}

pub(super) fn openai_responses_tool_to_value(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "name": tool.function.name,
        "description": tool.function.description,
        "parameters": tool.function.parameters,
    })
}

/// The single OpenAI-completions-family request builder (S6). Every
/// per-provider difference comes from the catalog `Compat` data:
/// `completions_reasoning_field` drives reasoning replay, an explicit
/// `completions_temperature` is sent when the provider accepts one, and
/// `completions_thinking_format` selects the thinking-control dialect.
/// Effort wire values come from the catalog thinking map (S4).
pub(super) fn completions_chat_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
    thinking_levels: &ThinkingLevelMap,
    compat: &Compat,
    message_shape: CompletionsMessageShape,
) -> Value {
    let default_reasoning_field = compat
        .completions_reasoning_field
        .as_deref()
        .unwrap_or("reasoning_content");
    let mut request = json!({
        "model": model,
        "messages": messages
            .iter()
            .map(|message| match message_shape {
                CompletionsMessageShape::Standard =>
                    completions_message_to_value(message, default_reasoning_field),
                CompletionsMessageShape::Arcee => arcee_message_to_value(message),
            })
            .collect::<Vec<_>>(),
    });
    if let Some(temperature) = compat.completions_temperature {
        request["temperature"] = json!(temperature);
    }
    if !tools.is_empty() {
        request["tools"] = serde_json::to_value(tools).unwrap_or_else(|_| Value::Array(Vec::new()));
    }
    match (compat.completions_thinking_format, reasoning_effort) {
        (_, None) => {}
        (None, Some(effort)) => {
            // Providers without a thinking dialect accept no explicit effort
            // levels, so validation rejects every `Some` before this point.
            debug_assert!(
                false,
                "reasoning effort '{}' reached a completions provider without a thinking format",
                effort.as_str()
            );
        }
        (Some(CompletionsThinkingFormat::Deepseek), Some(ReasoningEffort::None)) => {
            request["thinking"] = json!({"type": "disabled"});
        }
        (Some(CompletionsThinkingFormat::Deepseek), Some(effort)) => {
            request["thinking"] = json!({"type": "enabled"});
            // Wire tiers come from the catalog map (DeepSeek's top tier is
            // the wire value `max` for NAC's portable `xhigh`).
            request["reasoning_effort"] = json!(validated_wire_effort(thinking_levels, effort));
        }
        (Some(CompletionsThinkingFormat::Fireworks), Some(ReasoningEffort::None)) => {
            request["reasoning_effort"] = json!("none");
            request["reasoning_history"] = json!("disabled");
        }
        (Some(CompletionsThinkingFormat::Fireworks), Some(effort)) => {
            request["reasoning_effort"] = json!(validated_wire_effort(thinking_levels, effort));
            request["reasoning_history"] = json!("preserved");
        }
        (Some(CompletionsThinkingFormat::Together), Some(ReasoningEffort::None)) => {
            request["reasoning"] = json!({"enabled": false});
        }
        (Some(CompletionsThinkingFormat::Together), Some(effort)) => {
            request["reasoning"] = json!({"enabled": true});
            request["reasoning_effort"] = json!(validated_wire_effort(thinking_levels, effort));
            request["chat_template_kwargs"] = json!({"clear_thinking": false});
        }
    }
    request
}

pub(super) fn openai_responses_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
    thinking_levels: &ThinkingLevelMap,
) -> Value {
    let mut request = json!({
        "model": model,
        "input": responses_input_items(messages),
        "store": false,
    });
    if !tools.is_empty() {
        request["tools"] = Value::Array(
            tools
                .iter()
                .map(openai_responses_tool_to_value)
                .collect::<Vec<_>>(),
        );
        request["tool_choice"] = json!("auto");
        request["parallel_tool_calls"] = json!(true);
    }
    // A summary is the only readable form of reasoning this API returns — the
    // encrypted content exists to hand state back on the next turn, not to be
    // shown — and it is requested even without an effort so the UI has thinking
    // to display while the model works.
    let mut reasoning = json!({"summary": "auto"});
    if let Some(effort) = reasoning_effort {
        reasoning["effort"] = json!(validated_wire_effort(thinking_levels, effort));
    }
    request["reasoning"] = reasoning;
    request["include"] = json!(["reasoning.encrypted_content"]);
    request
}

pub(super) fn responses_input_items(messages: &[Message]) -> Vec<Value> {
    let mut items = Vec::new();

    for message in messages {
        match message {
            Message::System { content } => items.push(json!({
                "role": "system",
                "content": content,
            })),
            Message::User { content } => items.push(json!({
                "role": "user",
                "content": content,
            })),
            Message::Assistant {
                content,
                reasoning_details,
                tool_calls,
                ..
            } => {
                if let Some(reasoning_details) = reasoning_details {
                    match reasoning_details {
                        Value::Array(values) => items.extend(values.clone()),
                        Value::Object(_) => items.push(reasoning_details.clone()),
                        _ => {}
                    }
                }

                if let Some(tool_calls) = tool_calls {
                    for tool_call in tool_calls {
                        items.push(json!({
                            "type": "function_call",
                            "call_id": tool_call.id,
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments,
                        }));
                    }
                }

                if let Some(content) = content {
                    items.push(json!({
                        "role": "assistant",
                        "content": content,
                    }));
                }
            }
            Message::Tool {
                tool_call_id,
                content,
            } => items.push(json!({
                "type": "function_call_output",
                "call_id": tool_call_id,
                "output": content,
            })),
        }
    }

    items
}
