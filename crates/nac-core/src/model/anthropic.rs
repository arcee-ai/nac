use super::*;

pub(super) const ANTHROPIC_VERSION: &str = "2023-06-01";
const ANTHROPIC_MAX_TOKENS: u32 = 128_000;

pub(super) fn anthropic_messages_request(
    model: &str,
    messages: &[Message],
    tools: &[ToolDefinition],
    cache_ttl: Option<&str>,
) -> Result<Value> {
    let (system, mut messages) = anthropic_messages_from_internal(messages)?;
    let mut request = json!({
        "model": model,
        "max_tokens": ANTHROPIC_MAX_TOKENS,
        "messages": &messages,
        "thinking": {
            "type": "adaptive",
            "display": "omitted",
        },
        "output_config": {
            "effort": "max",
        },
    });

    // Breakpoint 1: system prompt (also caches tools, which render before system).
    if let Some(system) = system {
        let mut system_block = json!({"type": "text", "text": system});
        system_block["cache_control"] = cache_control_value(cache_ttl);
        request["system"] = json!([system_block]);
    }

    // Breakpoint 2: last tool definition.
    if !tools.is_empty() {
        let mut tools_arr: Vec<Value> = tools.iter().map(anthropic_tool_to_value).collect();
        if let Some(last_tool) = tools_arr.last_mut() {
            last_tool["cache_control"] = cache_control_value(cache_ttl);
        }
        request["tools"] = Value::Array(tools_arr);
    }

    // Breakpoint 3: last content block of the last message (conversation history).
    if let Some(last_msg) = messages.last_mut() {
        add_cache_control_to_last_block(last_msg, cache_ttl);
    }
    request["messages"] = Value::Array(messages);

    Ok(request)
}

/// Build the `cache_control` JSON value for the given TTL.
/// `None` or any non-"1h" value → default 5-minute ephemeral cache.
fn cache_control_value(ttl: Option<&str>) -> Value {
    match ttl {
        Some("1h") => json!({"type": "ephemeral", "ttl": "1h"}),
        _ => json!({"type": "ephemeral"}),
    }
}

/// Add `cache_control` to the last content block of an Anthropic message.
/// If the message content is a plain string, convert it to a content-block
/// array first so that `cache_control` can be attached.
fn add_cache_control_to_last_block(message: &mut Value, ttl: Option<&str>) {
    let Some(content) = message.get_mut("content") else {
        return;
    };

    // If content is a string, convert to a single-element text block array.
    if let Some(text) = content.as_str().map(|s| s.to_string()) {
        *content = Value::Array(vec![json!({"type": "text", "text": text})]);
    }

    let Some(arr) = content.as_array_mut() else {
        return;
    };
    if let Some(last_block) = arr.last_mut() {
        last_block["cache_control"] = cache_control_value(ttl);
    }
}

fn anthropic_messages_from_internal(messages: &[Message]) -> Result<(Option<String>, Vec<Value>)> {
    let mut system_parts = Vec::new();
    let mut anthropic_messages = Vec::new();
    let mut index = 0;

    while index < messages.len() {
        match &messages[index] {
            Message::System { content } => system_parts.push(content.clone()),
            Message::User { content } => anthropic_messages.push(json!({
                "role": "user",
                "content": content,
            })),
            Message::Assistant {
                content,
                reasoning_details,
                tool_calls,
                ..
            } => anthropic_messages.push(anthropic_assistant_message(
                content,
                reasoning_details.as_ref(),
                tool_calls.as_ref(),
            )?),
            Message::Tool { .. } => {
                let mut content_blocks = Vec::new();
                while let Some(Message::Tool {
                    tool_call_id,
                    content,
                }) = messages.get(index)
                {
                    content_blocks.push(json!({
                        "type": "tool_result",
                        "tool_use_id": tool_call_id,
                        "content": content,
                    }));
                    index += 1;
                }
                anthropic_messages.push(json!({
                    "role": "user",
                    "content": content_blocks,
                }));
                continue;
            }
        }
        index += 1;
    }

    let system = if system_parts.is_empty() {
        None
    } else {
        Some(system_parts.join("\n\n"))
    };

    Ok((system, anthropic_messages))
}

fn anthropic_assistant_message(
    content: &Option<String>,
    reasoning_details: Option<&Value>,
    tool_calls: Option<&Vec<ToolCall>>,
) -> Result<Value> {
    let mut content_blocks = Vec::new();

    if let Some(reasoning_details) = reasoning_details {
        content_blocks.extend(anthropic_reasoning_blocks(reasoning_details));
    }

    if let Some(content) = content {
        content_blocks.push(json!({
            "type": "text",
            "text": content,
        }));
    }

    if let Some(tool_calls) = tool_calls {
        for tool_call in tool_calls {
            let input =
                serde_json::from_str::<Value>(&tool_call.function.arguments).map_err(|error| {
                    anyhow!(
                        "Anthropic tool call '{}' arguments are not valid JSON: {}",
                        tool_call.id,
                        error
                    )
                })?;
            content_blocks.push(json!({
                "type": "tool_use",
                "id": tool_call.id,
                "name": tool_call.function.name,
                "input": input,
            }));
        }
    }

    if content_blocks.is_empty() {
        content_blocks.push(json!({
            "type": "text",
            "text": "",
        }));
    }

    Ok(json!({
        "role": "assistant",
        "content": content_blocks,
    }))
}

fn anthropic_tool_to_value(tool: &ToolDefinition) -> Value {
    json!({
        "name": tool.function.name,
        "description": tool.function.description,
        "input_schema": tool.function.parameters,
    })
}

fn anthropic_reasoning_blocks(reasoning_details: &Value) -> Vec<Value> {
    match reasoning_details {
        Value::Array(values) => values
            .iter()
            .filter(|value| is_anthropic_reasoning_block(value))
            .cloned()
            .collect(),
        value if is_anthropic_reasoning_block(value) => vec![value.clone()],
        _ => Vec::new(),
    }
}

fn is_anthropic_reasoning_block(value: &Value) -> bool {
    let Some(block_type) = value.get("type").and_then(Value::as_str) else {
        return false;
    };

    match block_type {
        "thinking" => {
            value.get("thinking").and_then(Value::as_str).is_some()
                && value.get("signature").and_then(Value::as_str).is_some()
        }
        "redacted_thinking" => value.get("data").and_then(Value::as_str).is_some(),
        _ => false,
    }
}

pub(super) fn parse_anthropic_messages_response(
    value: &Value,
    url: &str,
) -> Result<ModelTurnResponse> {
    let content = value
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Response from {} did not include content blocks", url))?;

    let mut text_parts = Vec::new();
    let mut tool_calls = Vec::new();
    let mut reasoning_blocks = Vec::new();

    for block in content {
        match block.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block.get("text").and_then(Value::as_str) {
                    text_parts.push(text.to_string());
                }
            }
            Some("tool_use") => {
                let id = block
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Anthropic tool_use block missing id"))?;
                let name = block
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Anthropic tool_use block missing name"))?;
                let input = block
                    .get("input")
                    .ok_or_else(|| anyhow!("Anthropic tool_use block missing input"))?;
                let arguments = serde_json::to_string(input).map_err(|error| {
                    anyhow!(
                        "Failed to serialize Anthropic tool_use input for '{}': {}",
                        id,
                        error
                    )
                })?;

                tool_calls.push(ToolCall {
                    id: id.to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: name.to_string(),
                        arguments,
                    },
                });
            }
            Some("thinking") | Some("redacted_thinking") => {
                if is_anthropic_reasoning_block(block) {
                    reasoning_blocks.push(block.clone());
                }
            }
            _ => {}
        }
    }

    let content = if text_parts.is_empty() {
        None
    } else {
        Some(text_parts.join("\n\n"))
    };
    let reasoning_details = if reasoning_blocks.is_empty() {
        None
    } else {
        Some(Value::Array(reasoning_blocks))
    };
    let finish_reason = value
        .get("stop_reason")
        .and_then(Value::as_str)
        .map(|reason| {
            if reason == "max_tokens" {
                "length".to_string()
            } else {
                reason.to_string()
            }
        });

    let usage = value.get("usage").map(|u| {
        let input_tokens = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let cache_read = u
            .get("cache_read_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let cache_write = u
            .get("cache_creation_input_tokens")
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        let output_tokens = u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        TokenUsage {
            input_tokens,
            output_tokens,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            total_tokens: input_tokens + output_tokens + cache_read + cache_write,
        }
    });

    Ok(ModelTurnResponse {
        assistant: AssistantTurn {
            content,
            reasoning_text: None,
            reasoning_details,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
        },
        finish_reason,
        usage,
    })
}
