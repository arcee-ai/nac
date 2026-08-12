use std::collections::BTreeMap;

use serde_json::{json, Value};

use super::sse::{provider_stream_error, StreamFold, StreamFoldError};
use super::stream::{DeltaSink, ModelStreamDelta, ObservableDeltaSink};

/// Rebuilds a chat-completions response out of its stream chunks, so the
/// buffered parsers stay the only place that reads a provider's response shape.
pub(super) struct ChatStreamFold<'sink> {
    deltas: ObservableDeltaSink<'sink>,
    /// The field the buffered parser will read reasoning back out of, so the
    /// rebuilt response matches what the provider would have sent unstreamed.
    reasoning_field: &'sink str,
    content: String,
    reasoning: String,
    finish_reason: Option<String>,
    usage: Option<Value>,
    /// Tool calls arrive spread over many chunks, identified by their position
    /// in the call list: identity comes once and the arguments accumulate.
    tool_calls: BTreeMap<u64, PartialToolCall>,
    saw_choice: bool,
}

#[derive(Default)]
struct PartialToolCall {
    id: String,
    call_type: String,
    name: String,
    arguments: String,
}

impl<'sink> ChatStreamFold<'sink> {
    pub fn new(on_delta: DeltaSink<'sink>, reasoning_field: &'sink str) -> Self {
        Self {
            deltas: ObservableDeltaSink::new(on_delta),
            reasoning_field,
            content: String::new(),
            reasoning: String::new(),
            finish_reason: None,
            usage: None,
            tool_calls: BTreeMap::new(),
            saw_choice: false,
        }
    }

    fn absorb_tool_calls(&mut self, deltas: &[Value]) {
        for (position, delta) in deltas.iter().enumerate() {
            let index = delta
                .get("index")
                .and_then(Value::as_u64)
                .unwrap_or(position as u64);
            let call = self.tool_calls.entry(index).or_default();
            if let Some(id) = delta.get("id").and_then(Value::as_str) {
                call.id = id.to_string();
            }
            if let Some(call_type) = delta.get("type").and_then(Value::as_str) {
                call.call_type = call_type.to_string();
            }
            if let Some(function) = delta.get("function") {
                if let Some(name) = function.get("name").and_then(Value::as_str) {
                    call.name.push_str(name);
                }
                if let Some(arguments) = function.get("arguments").and_then(Value::as_str) {
                    call.arguments.push_str(arguments);
                }
            }
        }
    }
}

impl StreamFold for ChatStreamFold<'_> {
    fn push(&mut self, event: &Value) -> Result<(), StreamFoldError> {
        if let Some(error) = event.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("model stream reported an error");
            let code = error
                .get("code")
                .or_else(|| error.get("type"))
                .and_then(Value::as_str);
            return Err(provider_stream_error(code, message));
        }

        if let Some(usage) = event.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }

        let Some(choice) = event
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        else {
            return Ok(());
        };
        self.saw_choice = true;

        if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
            self.finish_reason = Some(reason.to_string());
        }

        let Some(delta) = choice.get("delta") else {
            return Ok(());
        };
        if let Some(text) = delta.get("content").and_then(Value::as_str) {
            self.content.push_str(text);
            self.deltas.emit(ModelStreamDelta::text(text));
        }
        if let Some(reasoning) = delta
            .get("reasoning_content")
            .or_else(|| delta.get("reasoning"))
            .and_then(Value::as_str)
        {
            self.reasoning.push_str(reasoning);
            self.deltas.emit(ModelStreamDelta::reasoning(reasoning));
        }
        if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
            self.absorb_tool_calls(tool_calls);
        }

        Ok(())
    }
    fn has_observable_delta(&self) -> bool {
        self.deltas.has_observable_delta()
    }

    fn finish(self) -> Result<Value, StreamFoldError> {
        if !self.saw_choice {
            return Err(StreamFoldError::retryable(
                "stream ended without any completion chunk",
            ));
        }

        let mut message = json!({
            "role": "assistant",
            // A tool-only turn has no prose, and the parsers read absent content
            // as "none" rather than as an empty answer.
            "content": if self.content.is_empty() { Value::Null } else { Value::String(self.content) },
        });
        if !self.reasoning.is_empty() {
            message[self.reasoning_field] = Value::String(self.reasoning);
        }
        if !self.tool_calls.is_empty() {
            message["tool_calls"] = Value::Array(
                self.tool_calls
                    .into_values()
                    .map(|call| {
                        json!({
                            "id": call.id,
                            "type": if call.call_type.is_empty() { "function".to_string() } else { call.call_type },
                            "function": {"name": call.name, "arguments": call.arguments},
                        })
                    })
                    .collect(),
            );
        }

        let mut response = json!({
            "choices": [{
                "index": 0,
                "message": message,
                "finish_reason": self.finish_reason,
            }],
        });
        if let Some(usage) = self.usage {
            response["usage"] = usage;
        }
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    #[test]
    fn chat_fold_delivers_only_nonempty_text_and_reasoning_deltas() {
        let (send, receive) = mpsc::channel();
        let sink = move |delta| send.send(delta).expect("delta receiver should remain live");
        let mut fold = ChatStreamFold::new(Some(&sink), "reasoning_content");

        for event in [
            json!({"choices": [{"delta": {"content": ""}}]}),
            json!({"choices": [{"delta": {"content": "answer"}}]}),
            json!({"choices": [{"delta": {"reasoning_content": "thinking"}}]}),
            json!({"choices": [{"delta": {"reasoning": "more"}}]}),
        ] {
            fold.push(&event).unwrap();
        }

        assert!(fold.has_observable_delta());
        assert_eq!(
            receive.try_iter().collect::<Vec<_>>(),
            vec![
                ModelStreamDelta::text("answer"),
                ModelStreamDelta::reasoning("thinking"),
                ModelStreamDelta::reasoning("more"),
            ]
        );

        let mut unobserved = ChatStreamFold::new(None, "reasoning_content");
        unobserved
            .push(&json!({"choices": [{"delta": {"content": "hidden"}}]}))
            .unwrap();
        assert!(!unobserved.has_observable_delta());
    }
}
