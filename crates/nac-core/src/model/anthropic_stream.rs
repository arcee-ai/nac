use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::sse::{provider_stream_error, StreamFold, StreamFoldError};
use super::stream::{DeltaSink, ModelStreamDelta, ObservableDeltaSink};

/// Rebuilds an Anthropic Messages response out of its event stream.
///
/// Content blocks arrive as a start event, a run of deltas and a stop event, all
/// keyed by index, so the blocks are reassembled in place and handed to the same
/// parser the buffered path uses. Thinking blocks matter here: their signature
/// arrives in its own delta and the response is unusable for a follow-up turn
/// without it.
pub(super) struct AnthropicStreamFold<'sink> {
    deltas: ObservableDeltaSink<'sink>,
    blocks: BTreeMap<u64, PartialBlock>,
    stop_reason: Option<String>,
    input_usage: Option<Value>,
    output_tokens: Option<u64>,
    saw_message: bool,
}

struct PartialBlock {
    block: Value,
    /// Accumulated `input_json_delta` fragments for a `tool_use` block.
    partial_json: String,
}

impl<'sink> AnthropicStreamFold<'sink> {
    pub fn new(on_delta: DeltaSink<'sink>) -> Self {
        Self {
            deltas: ObservableDeltaSink::new(on_delta),
            blocks: BTreeMap::new(),
            stop_reason: None,
            input_usage: None,
            output_tokens: None,
            saw_message: false,
        }
    }

    fn append(&mut self, index: u64, field: &str, value: &str) {
        let Some(entry) = self.blocks.get_mut(&index) else {
            return;
        };
        match entry.block.get(field).and_then(Value::as_str) {
            Some(existing) => entry.block[field] = Value::String(format!("{existing}{value}")),
            None => entry.block[field] = Value::String(value.to_string()),
        }
    }
}

impl StreamFold for AnthropicStreamFold<'_> {
    fn push(&mut self, event: &Value) -> Result<(), StreamFoldError> {
        let event_type = event.get("type").and_then(Value::as_str);
        match event_type {
            Some("error") => {
                let message = event
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("Anthropic stream reported an error");
                let code = event
                    .get("error")
                    .and_then(|error| error.get("type"))
                    .and_then(Value::as_str);
                return Err(provider_stream_error(code, message));
            }
            Some("message_start") => {
                self.saw_message = true;
                if let Some(usage) = event
                    .get("message")
                    .and_then(|message| message.get("usage"))
                    .filter(|usage| !usage.is_null())
                {
                    self.input_usage = Some(usage.clone());
                }
            }
            Some("content_block_start") => {
                let index = block_index(event);
                if let Some(block) = event.get("content_block").cloned() {
                    self.blocks.insert(
                        index,
                        PartialBlock {
                            block,
                            partial_json: String::new(),
                        },
                    );
                }
            }
            Some("content_block_delta") => {
                let index = block_index(event);
                let Some(delta) = event.get("delta") else {
                    return Ok(());
                };
                match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => {
                        if let Some(text) = delta.get("text").and_then(Value::as_str) {
                            self.append(index, "text", text);
                            self.deltas.emit(ModelStreamDelta::text(text));
                        }
                    }
                    Some("thinking_delta") => {
                        if let Some(thinking) = delta.get("thinking").and_then(Value::as_str) {
                            self.append(index, "thinking", thinking);
                            self.deltas.emit(ModelStreamDelta::reasoning(thinking));
                        }
                    }
                    Some("signature_delta") => {
                        if let Some(signature) = delta.get("signature").and_then(Value::as_str) {
                            self.append(index, "signature", signature);
                        }
                    }
                    Some("input_json_delta") => {
                        if let Some(fragment) = delta.get("partial_json").and_then(Value::as_str) {
                            if let Some(entry) = self.blocks.get_mut(&index) {
                                entry.partial_json.push_str(fragment);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Some("message_delta") => {
                if let Some(reason) = event
                    .get("delta")
                    .and_then(|delta| delta.get("stop_reason"))
                    .and_then(Value::as_str)
                {
                    self.stop_reason = Some(reason.to_string());
                }
                if let Some(output_tokens) = event
                    .get("usage")
                    .and_then(|usage| usage.get("output_tokens"))
                    .and_then(Value::as_u64)
                {
                    self.output_tokens = Some(output_tokens);
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn has_observable_delta(&self) -> bool {
        self.deltas.has_observable_delta()
    }

    fn finish(self) -> Result<Value, StreamFoldError> {
        if !self.saw_message {
            return Err(StreamFoldError::retryable(
                "stream ended without a message_start event",
            ));
        }

        let content = self
            .blocks
            .into_values()
            .map(|entry| {
                let PartialBlock {
                    mut block,
                    partial_json,
                } = entry;
                if block.get("type").and_then(Value::as_str) == Some("tool_use") {
                    block["input"] = parse_tool_input(&partial_json);
                }
                block
            })
            .collect::<Vec<_>>();

        let mut response = json!({
            "role": "assistant",
            "content": content,
            "stop_reason": self.stop_reason,
        });
        if let Some(usage) = self.input_usage {
            let mut usage = usage;
            if let Some(output_tokens) = self.output_tokens {
                usage["output_tokens"] = Value::from(output_tokens);
            }
            response["usage"] = usage;
        }
        Ok(response)
    }
}

fn block_index(event: &Value) -> u64 {
    event.get("index").and_then(Value::as_u64).unwrap_or(0)
}

/// A tool call with no arguments streams no fragments at all, and the parser
/// requires an `input` object either way.
fn parse_tool_input(partial_json: &str) -> Value {
    if partial_json.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str(partial_json).unwrap_or_else(|_| json!({}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn anthropic_fold_delivers_only_nonempty_text_and_thinking_deltas() {
        let (send, receive) = mpsc::channel();
        let sink = move |delta| send.send(delta).expect("delta receiver should remain live");
        let mut fold = AnthropicStreamFold::new(Some(&sink));

        for event in [
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": ""}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "answer"}}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "thinking_delta", "thinking": "thinking"}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "signature_delta", "signature": "signed"}}),
            json!({"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "tool", "name": "run"}}),
            json!({"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{}"}}),
        ] {
            fold.push(&event).unwrap();
        }

        assert!(fold.has_observable_delta());
        assert_eq!(
            receive.try_iter().collect::<Vec<_>>(),
            vec![
                ModelStreamDelta::text("answer"),
                ModelStreamDelta::reasoning("thinking"),
            ]
        );

        let mut unobserved = AnthropicStreamFold::new(None);
        unobserved
            .push(&json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "hidden"}}))
            .unwrap();
        assert!(!unobserved.has_observable_delta());
    }
}
