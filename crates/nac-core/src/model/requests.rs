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

/// Serialize a message for the Together.ai chat completions API.
///
/// This is identical to `fireworks_message_to_value` except for a workaround
/// for a bug in the GLM-5.2 chat template.  The template calls
/// `_args.items()` on tool-call arguments (line 85 of `chat_template.jinja`).
/// In Minijinja, when a dict has a key literally named `"items"`,
/// `_args.items` resolves to the *value* of that key instead of the `.items()`
/// method, producing:
///
///   "invalid operation: object is not callable (in chat:85)"
///
/// The `workset_define` tool has a parameter named `items`, so any multi-turn
/// conversation that includes a `workset_define` tool call will trigger this
/// error on the *next* request.  The workaround renames the `"items"` key to
/// `"items_"` in the serialized arguments so the template can iterate safely.
/// The original `Message` in memory is untouched — only the JSON sent to
/// Together.ai is affected.
pub(super) fn together_message_to_value(message: &Message) -> Value {
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
                let safe_calls: Vec<Value> = tool_calls
                    .iter()
                    .map(|tc| {
                        let mut tc_val =
                            serde_json::to_value(tc).unwrap_or_else(|_| Value::Null);
                        // Rename "items" → "items_" in the arguments JSON to
                        // avoid the GLM-5.2 template `.items()` collision.
                        if let Some(args_str) = tc_val
                            .get("function")
                            .and_then(|f| f.get("arguments"))
                            .and_then(|a| a.as_str())
                        {
                            if let Ok(mut args_map) =
                                serde_json::from_str::<serde_json::Map<String, Value>>(args_str)
                            {
                                if args_map.contains_key("items") {
                                    let items_val = args_map.remove("items").unwrap();
                                    args_map.insert("items_".to_string(), items_val);
                                    let renamed =
                                        serde_json::to_string(&args_map).unwrap_or_else(|_| {
                                            args_str.to_string()
                                        });
                                    tc_val["function"]["arguments"] =
                                        Value::String(renamed);
                                }
                            }
                        }
                        tc_val
                    })
                    .collect();
                value["tool_calls"] = Value::Array(safe_calls);
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

pub(super) fn deepseek_chat_request(
    model: &str,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> Value {
    let mut request = json!({
        "model": model,
        "messages": messages
            .iter()
            .map(fireworks_message_to_value)
            .collect::<Vec<_>>(),
        "thinking": {
            "type": "enabled",
        },
        "reasoning_effort": "max",
    });

    if !tools.is_empty() {
        request["tools"] = serde_json::to_value(tools).unwrap_or_else(|_| Value::Array(Vec::new()));
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
