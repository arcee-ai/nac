use super::*;

/// The single OpenAI-completions-family response parser (S6). The response
/// field carrying reasoning text comes from the catalog compat data
/// (`reasoning_content` for DeepSeek/Fireworks/Arcee, `reasoning` for
/// Together) and is stamped onto the turn for replay (S5). Usage parsing
/// accepts both the top-level (`cached_tokens`/`reasoning_tokens`, Together)
/// and nested (`prompt_tokens_details`/`completion_tokens_details`) shapes
/// for every completions provider.
pub(super) fn parse_completions_response(
    value: &Value,
    url: &str,
    reasoning_field: &str,
) -> Result<ModelTurnResponse> {
    let choices = value
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("No choices in response from {url}"))?;
    let choice = choices
        .first()
        .ok_or_else(|| anyhow!("No choices in response from {url}"))?;
    let message = choice
        .get("message")
        .ok_or_else(|| anyhow!("Response from {url} did not include a message"))?;
    let tool_calls = match message.get("tool_calls") {
        Some(Value::Array(_)) => Some(
            serde_json::from_value::<Vec<ToolCall>>(message["tool_calls"].clone())
                .map_err(|e| anyhow!("Failed to parse tool calls from {url}: {e}"))?,
        ),
        Some(Value::Null) | None => None,
        Some(_) => {
            return Err(anyhow!(
                "Response from {url} included tool_calls in an unsupported format"
            ))
        }
    };

    let usage = value.get("usage").map(|u| {
        let prompt_tokens = u.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(0);
        let prompt_details = u.get("prompt_tokens_details");
        let cache_read = u
            .get("cached_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| u.get("prompt_cache_hit_tokens").and_then(|v| v.as_u64()))
            .or_else(|| {
                prompt_details
                    .and_then(|details| details.get("cached_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0);
        let cache_write = u
            .get("cache_write_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                prompt_details
                    .and_then(|details| details.get("cache_write_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0);
        let reasoning_tokens = u
            .get("reasoning_tokens")
            .and_then(|v| v.as_u64())
            .or_else(|| {
                u.get("completion_tokens_details")
                    .and_then(|d| d.get("reasoning_tokens"))
                    .and_then(|v| v.as_u64())
            })
            .unwrap_or(0);
        TokenUsage {
            input_tokens: prompt_tokens
                .saturating_sub(cache_read)
                .saturating_sub(cache_write),
            output_tokens: u
                .get("completion_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            reasoning_tokens,
            orchestrator_context_tokens: u
                .get("total_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cost: TokenCostMicros::default(),
        }
    });

    let reasoning_text = message
        .get(reasoning_field)
        .and_then(Value::as_str)
        .map(ToString::to_string);
    Ok(ModelTurnResponse {
        assistant: AssistantTurn {
            content: message
                .get("content")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            reasoning_field: reasoning_text.as_ref().map(|_| reasoning_field.to_string()),
            reasoning_text,
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
