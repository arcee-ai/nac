use super::*;

pub(super) fn parse_openai_responses_response(
    value: &Value,
    url: &str,
) -> Result<ModelTurnResponse> {
    let output = value
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Response from {} did not include output items", url))?;

    let mut message_text_parts = Vec::new();
    let mut tool_calls = Vec::new();
    let mut reasoning_items = Vec::new();

    for item in output {
        match item.get("type").and_then(Value::as_str) {
            Some("message") => {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for part in content {
                        match part.get("type").and_then(Value::as_str) {
                            Some("output_text") => {
                                if let Some(text) = part.get("text").and_then(Value::as_str) {
                                    message_text_parts.push(text.to_string());
                                }
                            }
                            Some("refusal") => {
                                if let Some(text) = part.get("refusal").and_then(Value::as_str) {
                                    message_text_parts.push(text.to_string());
                                }
                            }
                            _ => {}
                        }
                    }
                } else if let Some(text) = item.get("content").and_then(Value::as_str) {
                    message_text_parts.push(text.to_string());
                }
            }
            Some("function_call") => {
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Responses function_call item missing call_id"))?;
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Responses function_call item missing name"))?;
                let arguments = item
                    .get("arguments")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Responses function_call item missing arguments"))?;

                tool_calls.push(ToolCall {
                    id: call_id.to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: name.to_string(),
                        arguments: arguments.to_string(),
                    },
                });
            }
            Some("reasoning") => reasoning_items.push(item.clone()),
            _ => {}
        }
    }

    let content = if !message_text_parts.is_empty() {
        Some(message_text_parts.join("\n\n"))
    } else {
        value
            .get("output_text")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    };
    let reasoning_text = extract_reasoning_text(&reasoning_items);
    let reasoning_details = if reasoning_items.is_empty() {
        None
    } else {
        Some(Value::Array(reasoning_items))
    };
    let finish_reason = if value.get("status").and_then(Value::as_str) == Some("incomplete")
        && value
            .get("incomplete_details")
            .and_then(Value::as_object)
            .and_then(|details| details.get("reason"))
            .and_then(Value::as_str)
            == Some("max_output_tokens")
    {
        Some("length".to_string())
    } else {
        None
    };

    let usage = value.get("usage").map(|u| {
        let input_tokens = u.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let cached = u
            .get("input_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        TokenUsage {
            input_tokens: input_tokens.saturating_sub(cached),
            output_tokens: u.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
            cache_read_tokens: cached,
            cache_write_tokens: 0,
            total_tokens: u.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
        }
    });

    Ok(ModelTurnResponse {
        assistant: AssistantTurn {
            content,
            reasoning_text,
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

pub(super) fn extract_reasoning_text(items: &[Value]) -> Option<String> {
    let mut parts = Vec::new();

    for item in items {
        if let Some(summary) = item.get("summary").and_then(Value::as_array) {
            for entry in summary {
                if let Some(text) = entry.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
        }

        if let Some(content) = item.get("content").and_then(Value::as_array) {
            for entry in content {
                if let Some(text) = entry.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}
