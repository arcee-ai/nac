use serde_json::Value;

use super::sse::StreamFold;
use super::stream::{DeltaSink, ModelStreamDelta};

/// Folds a Responses-API event stream into the final `response` object, handing
/// text and reasoning to the sink as they arrive. Shared by the OpenAI and Codex
/// backends, which speak the same event vocabulary.
pub(super) struct ResponsesStreamFold<'sink> {
    on_delta: DeltaSink<'sink>,
    final_response: Option<Value>,
    /// Items collected from `output_item.done`, used when the terminal event
    /// arrives with an empty `output` array.
    output_items: Vec<(usize, Value)>,
}

impl<'sink> ResponsesStreamFold<'sink> {
    pub fn new(on_delta: DeltaSink<'sink>) -> Self {
        Self {
            on_delta,
            final_response: None,
            output_items: Vec::new(),
        }
    }

    fn emit(&self, event: &Value, build: impl Fn(&str) -> ModelStreamDelta) {
        let Some(on_delta) = self.on_delta else {
            return;
        };
        if let Some(text) = event.get("delta").and_then(Value::as_str) {
            on_delta(build(text));
        }
    }
}

impl StreamFold for ResponsesStreamFold<'_> {
    fn push(&mut self, event: &Value) -> Result<(), String> {
        match event.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => {
                self.emit(event, |text| ModelStreamDelta::text(text));
            }
            Some("response.reasoning_summary_text.delta" | "response.reasoning_text.delta") => {
                self.emit(event, |text| ModelStreamDelta::reasoning(text));
            }
            Some("error" | "response.failed") => {
                return Err(responses_event_error_message(event)
                    .unwrap_or_else(|| format!("model stream reported an error event: {event}")));
            }
            Some("response.output_item.done") => {
                if let Some(item) = event.get("item").cloned() {
                    let output_index = event
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .and_then(|index| usize::try_from(index).ok())
                        .unwrap_or(self.output_items.len());
                    self.output_items
                        .retain(|(index, _)| *index != output_index);
                    self.output_items.push((output_index, item));
                }
            }
            Some("response.completed" | "response.done" | "response.incomplete") => {
                if let Some(response) = event.get("response").and_then(Value::as_object) {
                    if response.get("status").and_then(Value::as_str) == Some("failed") {
                        return Err(responses_event_error_message(event)
                            .unwrap_or_else(|| format!("model response failed: {event}")));
                    }
                    let mut response_value = Value::Object(response.clone());
                    if response_output_is_empty(&response_value) && !self.output_items.is_empty() {
                        self.output_items.sort_by_key(|(index, _)| *index);
                        response_value["output"] = Value::Array(
                            self.output_items
                                .iter()
                                .map(|(_, item)| item.clone())
                                .collect::<Vec<_>>(),
                        );
                    }
                    self.final_response = Some(response_value);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn finish(self) -> Result<Value, String> {
        self.final_response
            .ok_or_else(|| "SSE stream did not include a final response event".to_string())
    }
}

fn response_output_is_empty(response: &Value) -> bool {
    response
        .get("output")
        .and_then(Value::as_array)
        .map(Vec::is_empty)
        .unwrap_or(true)
}

pub(super) fn responses_event_error_message(event: &Value) -> Option<String> {
    event
        .get("response")
        .and_then(|response| response.get("error"))
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .or_else(|| event.get("message").and_then(Value::as_str))
        .filter(|message| !message.is_empty())
        .map(str::to_string)
}
