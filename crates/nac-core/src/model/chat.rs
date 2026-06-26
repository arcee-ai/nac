use super::*;

pub(super) fn parse_chat_completions_response(
    value: &Value,
    url: &str,
) -> Result<ModelTurnResponse> {
    let choices = value
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("No choices in response from {}", url))?;
    let choice = choices
        .first()
        .ok_or_else(|| anyhow!("No choices in response from {}", url))?;
    let message = choice
        .get("message")
        .ok_or_else(|| anyhow!("Response from {} did not include a message", url))?;
    let tool_calls = match message.get("tool_calls") {
        Some(Value::Array(_)) => Some(
            serde_json::from_value::<Vec<ToolCall>>(message["tool_calls"].clone())
                .map_err(|e| anyhow!("Failed to parse tool calls from {}: {}", url, e))?,
        ),
        Some(Value::Null) | None => None,
        Some(_) => {
            return Err(anyhow!(
                "Response from {} included tool_calls in an unsupported format",
                url
            ))
        }
    };

    let usage = value.get("usage").map(|u| {
        let prompt_tokens = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let cached = u
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|v| v.as_u64())
            .unwrap_or(0);
        TokenUsage {
            input_tokens: prompt_tokens.saturating_sub(cached),
            output_tokens: u
                .get("completion_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cache_read_tokens: cached,
            cache_write_tokens: 0,
            total_tokens: u.get("total_tokens").and_then(|v| v.as_u64()).unwrap_or(0),
        }
    });

    Ok(ModelTurnResponse {
        assistant: AssistantTurn {
            content: message
                .get("content")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            reasoning_text: message
                .get("reasoning_content")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            reasoning_details: None,
            tool_calls,
        },
        finish_reason: choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        usage,
    })
}
