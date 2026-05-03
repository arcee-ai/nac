use super::*;

pub(super) fn parse_chat_usage(value: Option<&Value>) -> Usage {
    Usage {
        prompt_tokens: value
            .and_then(|usage| usage.get("prompt_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        completion_tokens: value
            .and_then(|usage| usage.get("completion_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        total_tokens: value
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        reasoning_tokens: value
            .and_then(|usage| usage.get("completion_tokens_details"))
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
    }
}

pub(super) fn parse_responses_usage(value: Option<&Value>) -> Usage {
    Usage {
        prompt_tokens: value
            .and_then(|usage| usage.get("input_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        completion_tokens: value
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        total_tokens: value
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        reasoning_tokens: value
            .and_then(|usage| usage.get("output_tokens_details"))
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
    }
}
