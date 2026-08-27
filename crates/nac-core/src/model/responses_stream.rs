use serde_json::Value;

use super::sse::{StreamFold, StreamFoldError};
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
    observable_delta: bool,
}

impl<'sink> ResponsesStreamFold<'sink> {
    pub fn new(on_delta: DeltaSink<'sink>) -> Self {
        Self {
            on_delta,
            final_response: None,
            output_items: Vec::new(),
            observable_delta: false,
        }
    }

    fn emit(&mut self, event: &Value, build: impl Fn(&str) -> ModelStreamDelta) {
        let Some(on_delta) = self.on_delta else {
            return;
        };
        if let Some(text) = event.get("delta").and_then(Value::as_str) {
            let delta = build(text);
            if !delta.is_empty() {
                self.observable_delta = true;
                on_delta(delta);
            }
        }
    }
}

impl StreamFold for ResponsesStreamFold<'_> {
    fn push(&mut self, event: &Value) -> Result<(), StreamFoldError> {
        match event.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => {
                self.emit(event, |text| ModelStreamDelta::text(text));
            }
            Some("response.reasoning_summary_text.delta" | "response.reasoning_text.delta") => {
                self.emit(event, |text| ModelStreamDelta::reasoning(text));
            }
            Some("error" | "response.failed") => {
                return Err(responses_event_error(
                    event,
                    "model stream reported an error event",
                ));
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
                        return Err(responses_event_error(event, "model response failed"));
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

    fn has_observable_delta(&self) -> bool {
        self.observable_delta
    }

    fn is_complete(&self) -> bool {
        self.final_response.is_some()
    }

    fn finish(self) -> Result<Value, StreamFoldError> {
        self.final_response.ok_or_else(|| {
            StreamFoldError::retryable("SSE stream did not include a final response event")
        })
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

fn responses_event_error(event: &Value, fallback: &str) -> StreamFoldError {
    let message =
        responses_event_error_message(event).unwrap_or_else(|| format!("{fallback}: {event}"));
    if responses_event_is_retryable(event, &message) {
        StreamFoldError::retryable(message)
    } else {
        StreamFoldError::permanent(message)
    }
}

fn responses_event_is_retryable(event: &Value, message: &str) -> bool {
    const RETRYABLE_CODES: &[&str] = &["server_error", "overloaded_error", "rate_limit_exceeded"];

    let error = event
        .get("response")
        .and_then(|response| response.get("error"))
        .or_else(|| event.get("error"));
    let structured_retry = error
        .into_iter()
        .flat_map(|error| [error.get("code"), error.get("type")])
        .chain([event.get("code")])
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_ascii_lowercase)
        .any(|value| RETRYABLE_CODES.contains(&value.as_str()));
    if structured_retry {
        return true;
    }

    let normalized = message.to_ascii_lowercase();
    normalized.contains("our servers are currently overloaded")
        || normalized.contains("you can retry your request")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::mpsc;

    #[test]
    fn classifies_only_explicit_transient_response_errors() {
        let retryable = [
            json!({"type": "error", "error": {"code": "server_error", "message": "failed"}}),
            json!({"type": "response.failed", "response": {"error": {"type": "overloaded_error", "message": "failed"}}}),
            json!({"type": "response.completed", "response": {"status": "failed", "error": {"code": "rate_limit_exceeded", "message": "failed"}}}),
            json!({"type": "error", "message": "Our servers are currently overloaded. Please try again later."}),
            json!({"type": "error", "message": "An error occurred. You can retry your request."}),
        ];
        for event in retryable {
            let mut fold = ResponsesStreamFold::new(None);
            let error = fold.push(&event).unwrap_err();
            assert!(error.is_retryable(), "event should be retryable: {event}");
        }

        let permanent = [
            json!({"type": "error", "error": {"code": "insufficient_quota", "message": "quota exhausted"}}),
            json!({"type": "response.failed", "response": {"error": {"type": "invalid_request_error", "message": "fix the request and retry"}}}),
            json!({"type": "error", "message": "Retry after correcting the API key."}),
            json!({"type": "error", "error": {"code": "unknown", "message": "unknown failure"}}),
        ];
        for event in permanent {
            let mut fold = ResponsesStreamFold::new(None);
            let error = fold.push(&event).unwrap_err();
            assert!(!error.is_retryable(), "event should be permanent: {event}");
        }
    }

    #[test]
    fn tracks_only_nonempty_deltas_delivered_to_a_live_sink() {
        let (send, receive) = mpsc::channel();
        let sink = move |delta| send.send(delta).expect("delta receiver should remain live");
        let mut observed = ResponsesStreamFold::new(Some(&sink));
        observed
            .push(&json!({"type": "response.output_text.delta", "delta": ""}))
            .unwrap();
        assert!(!observed.has_observable_delta());
        observed
            .push(&json!({"type": "response.reasoning_text.delta", "delta": "thinking"}))
            .unwrap();
        assert!(observed.has_observable_delta());
        assert_eq!(
            receive.try_iter().collect::<Vec<_>>(),
            vec![ModelStreamDelta::reasoning("thinking")]
        );

        let mut unobserved = ResponsesStreamFold::new(None);
        unobserved
            .push(&json!({"type": "response.output_text.delta", "delta": "hidden"}))
            .unwrap();
        assert!(!unobserved.has_observable_delta());
    }
}
