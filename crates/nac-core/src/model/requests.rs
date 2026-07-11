use super::*;

pub(super) fn fireworks_message_to_value(message: &Message) -> Value {
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
            tool_calls,
            ..
        } => {
            let mut value = json!({
                "role": "assistant",
                "content": content,
            });
            if let Some(reasoning_text) = reasoning_text {
                value["reasoning_content"] = Value::String(reasoning_text.clone());
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

pub(super) fn openai_responses_tool_to_value(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "name": tool.function.name,
        "description": tool.function.description,
        "parameters": tool.function.parameters,
    })
}

pub(super) fn fireworks_chat_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> Value {
    let mut request = json!({
        "model": model,
        "messages": messages
            .iter()
            .map(fireworks_message_to_value)
            .collect::<Vec<_>>(),
        "tools": tools,
        "temperature": 0.0,
    });
    match reasoning_effort {
        None => {}
        Some(ReasoningEffort::None) => {
            request["reasoning_effort"] = json!("none");
            request["reasoning_history"] = json!("disabled");
        }
        Some(effort) => {
            request["reasoning_effort"] = json!(effort.as_str());
            request["reasoning_history"] = json!("preserved");
        }
    }
    request
}

pub(super) fn together_chat_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> Value {
    let mut request = json!({
        "model": model,
        "messages": messages
            .iter()
            .map(fireworks_message_to_value)
            .collect::<Vec<_>>(),
        "tools": tools,
        "temperature": 0.0,
    });
    match reasoning_effort {
        None => {}
        Some(ReasoningEffort::None) => {
            request["reasoning"] = json!({"enabled": false});
        }
        Some(effort) => {
            request["reasoning"] = json!({"enabled": true});
            request["reasoning_effort"] = json!(effort.as_str());
            request["chat_template_kwargs"] = json!({"clear_thinking": false});
        }
    }
    request
}

pub(super) fn deepseek_chat_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> Value {
    let mut request = json!({
        "model": model,
        "messages": messages
            .iter()
            .map(fireworks_message_to_value)
            .collect::<Vec<_>>(),
    });
    match reasoning_effort {
        None => {}
        Some(ReasoningEffort::None) => {
            request["thinking"] = json!({"type": "disabled"});
        }
        Some(ReasoningEffort::High) => {
            request["thinking"] = json!({"type": "enabled"});
            request["reasoning_effort"] = json!("high");
        }
        Some(ReasoningEffort::Xhigh) => {
            request["thinking"] = json!({"type": "enabled"});
            // DeepSeek names its top wire-level tier `max`; NAC's portable
            // public enum names the equivalent tier `xhigh`.
            request["reasoning_effort"] = json!("max");
        }
        Some(unsupported) => unreachable!(
            "EffectiveModelSettings rejected unsupported DeepSeek effort {}",
            unsupported.as_str()
        ),
    }

    if !tools.is_empty() {
        request["tools"] = serde_json::to_value(tools).unwrap_or_else(|_| Value::Array(Vec::new()));
    }

    request
}

pub(super) fn openai_responses_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> Value {
    let mut request = json!({
        "model": model,
        "input": responses_input_items(messages),
    });
    if !tools.is_empty() {
        request["tools"] = Value::Array(
            tools
                .iter()
                .map(openai_responses_tool_to_value)
                .collect::<Vec<_>>(),
        );
    }
    if let Some(effort) = reasoning_effort {
        request["reasoning"] = json!({"effort": effort.as_str()});
    }
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
