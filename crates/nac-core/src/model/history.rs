//! S5 reasoning discipline: wire-bound history normalization.
//!
//! `normalize_history` runs once per model call in `ModelClient::send_turn`,
//! before backend dispatch, so every adapter (and the compaction summary
//! call, which goes through `send_turn`) inherits the same rules:
//!
//! 1. **Same-model gate.** Reasoning signatures are provider/model-private:
//!    Anthropic thinking blocks carry signatures the API rejects from other
//!    models, and OpenAI reasoning items are only valid for the model that
//!    produced them. An assistant message whose stamped `model_origin`
//!    differs from the current client loses `reasoning_details` and
//!    `reasoning_text` on the wire. The durable transcript is untouched —
//!    normalization works on the send-time copy, so `reasoning_text` remains
//!    visible in the UI.
//! 2. **Legacy = assume same-model (safety rail).** Pre-S5 messages have no
//!    origin stamp. They are treated as same-model and replayed exactly as
//!    before: Anthropic adaptive thinking *requires* thinking blocks to be
//!    returned alongside their tool_use blocks, so stripping legacy history
//!    on resume would break exactly the sessions this rework must not touch.
//! 3. **Orphaned tool calls.** An assistant `tool_calls` entry with no
//!    matching `Message::Tool` (a crash/cancel between the assistant push
//!    and the tool-result batch that transcript normalization did not
//!    already trim, or a hand-repaired log) gains a synthesized
//!    interruption result, inserted directly after the assistant message so
//!    call→result adjacency holds for every adapter.
//! 4. **Orphaned tool results.** A `Message::Tool` whose id matches no tool
//!    call anywhere in the view is dropped — Anthropic rejects a
//!    `tool_result` without a matching `tool_use`.
//!
//! Errored assistant turns never enter the transcript in the first place
//! (the agent pushes only after a successful, non-`length` response), so
//! there is nothing to skip here; that invariant has a regression test in
//! `agent::transcript_log_tests`.

use super::*;

/// Content of a synthesized tool result for an orphaned tool call.
pub(crate) const INTERRUPTED_TOOL_RESULT: &str =
    "Tool execution was interrupted; no result was recorded.";

/// Normalize conversation history for the wire; see the module docs for the
/// rules. `current` is the sending client's identity. Consumes and returns
/// the send-time copy; the durable transcript is never mutated.
pub(crate) fn normalize_history(messages: Vec<Message>, current: &ModelOrigin) -> Vec<Message> {
    let gated = messages
        .into_iter()
        .map(|message| match message {
            Message::Assistant {
                content,
                reasoning_text,
                reasoning_details,
                tool_calls,
                model_origin,
                reasoning_field,
            } => {
                // `None` origin = legacy message = assumed same-model (the
                // safety rail above); only a stamped, different origin
                // strips.
                let foreign = model_origin
                    .as_ref()
                    .is_some_and(|origin| origin != current);
                Message::Assistant {
                    content,
                    reasoning_text: if foreign { None } else { reasoning_text },
                    reasoning_details: if foreign { None } else { reasoning_details },
                    tool_calls,
                    model_origin,
                    reasoning_field,
                }
            }
            other => other,
        })
        .collect::<Vec<_>>();
    reconcile_tool_turns(gated)
}

fn reconcile_tool_turns(messages: Vec<Message>) -> Vec<Message> {
    let mut call_ids = std::collections::HashSet::new();
    let mut result_ids = std::collections::HashSet::new();
    for message in &messages {
        match message {
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } => call_ids.extend(tool_calls.iter().map(|call| call.id.clone())),
            Message::Tool { tool_call_id, .. } => {
                result_ids.insert(tool_call_id.clone());
            }
            _ => {}
        }
    }

    let mut reconciled = Vec::with_capacity(messages.len());
    for message in messages {
        match &message {
            Message::Tool { tool_call_id, .. } if !call_ids.contains(tool_call_id) => {
                // Orphaned tool result: no matching call in the view.
                continue;
            }
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } => {
                let missing = tool_calls
                    .iter()
                    .filter(|call| !result_ids.contains(&call.id))
                    .map(|call| call.id.to_string())
                    .collect::<Vec<_>>();
                reconciled.push(message);
                for tool_call_id in missing {
                    reconciled.push(Message::Tool {
                        tool_call_id,
                        content: INTERRUPTED_TOOL_RESULT.to_string(),
                    });
                }
            }
            _ => reconciled.push(message),
        }
    }
    reconciled
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origin(backend: BackendKind, model: &str) -> ModelOrigin {
        ModelOrigin {
            backend,
            model: model.to_string(),
        }
    }

    fn current() -> ModelOrigin {
        origin(BackendKind::AnthropicMessages, "claude-opus-4-6")
    }

    fn assistant(
        model_origin: Option<ModelOrigin>,
        reasoning_text: Option<&str>,
        reasoning_details: Option<Value>,
        tool_calls: Option<Vec<ToolCall>>,
    ) -> Message {
        Message::Assistant {
            content: Some("answer".to_string()),
            reasoning_text: reasoning_text.map(str::to_string),
            reasoning_details,
            tool_calls,
            model_origin,
            reasoning_field: None,
        }
    }

    fn tool_call(id: &str) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: "read".to_string(),
                arguments: "{}".to_string(),
            },
        }
    }

    fn thinking_blocks() -> Value {
        json!([{"type": "thinking", "thinking": "hmm", "signature": "sig-1"}])
    }

    #[test]
    fn same_origin_replays_reasoning_verbatim() {
        let messages = vec![assistant(
            Some(current()),
            Some("thinking"),
            Some(thinking_blocks()),
            None,
        )];

        let normalized = normalize_history(messages, &current());

        let Message::Assistant {
            reasoning_text,
            reasoning_details,
            ..
        } = &normalized[0]
        else {
            panic!("assistant message expected");
        };
        assert_eq!(reasoning_text.as_deref(), Some("thinking"));
        assert_eq!(reasoning_details, &Some(thinking_blocks()));
    }

    #[test]
    fn foreign_origin_strips_reasoning_for_the_wire_only() {
        let foreign = origin(BackendKind::OpenAiResponses, "gpt-5.5");
        let messages = vec![
            Message::User {
                content: "prompt".to_string(),
            },
            assistant(
                Some(foreign),
                Some("foreign thinking"),
                Some(json!([{"type": "reasoning", "id": "rs_1"}])),
                Some(vec![tool_call("call-1")]),
            ),
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "result".to_string(),
            },
            // A same-origin message in the same history keeps everything.
            assistant(Some(current()), Some("ours"), Some(thinking_blocks()), None),
        ];

        let normalized = normalize_history(messages, &current());

        let Message::Assistant {
            content,
            reasoning_text,
            reasoning_details,
            tool_calls,
            model_origin,
            ..
        } = &normalized[1]
        else {
            panic!("assistant message expected");
        };
        assert_eq!(reasoning_text, &None, "foreign reasoning text stripped");
        assert_eq!(reasoning_details, &None, "foreign reasoning details stripped");
        assert_eq!(content.as_deref(), Some("answer"), "content preserved");
        assert!(
            matches!(tool_calls, Some(calls) if calls.len() == 1),
            "tool calls preserved"
        );
        assert_eq!(
            model_origin.as_ref().map(|o| o.model.as_str()),
            Some("gpt-5.5"),
            "the stamp itself is preserved on the wire copy"
        );
        let Message::Assistant {
            reasoning_details: same_details,
            ..
        } = &normalized[3]
        else {
            panic!("assistant message expected");
        };
        assert_eq!(same_details, &Some(thinking_blocks()));
    }

    #[test]
    fn legacy_messages_without_origin_are_treated_as_same_model() {
        // The safety rail: pre-S5 history replays exactly as before, because
        // Anthropic requires thinking blocks alongside their tool_use.
        let messages = vec![assistant(
            None,
            Some("legacy thinking"),
            Some(thinking_blocks()),
            Some(vec![tool_call("call-1")]),
        )];

        let normalized = normalize_history(messages, &current());

        let Message::Assistant {
            reasoning_text,
            reasoning_details,
            ..
        } = &normalized[0]
        else {
            panic!("assistant message expected");
        };
        assert_eq!(reasoning_text.as_deref(), Some("legacy thinking"));
        assert_eq!(reasoning_details, &Some(thinking_blocks()));
    }

    #[test]
    fn same_model_means_same_backend_and_same_model_id() {
        // A model switch within one provider is still a different origin.
        let other_model = origin(BackendKind::AnthropicMessages, "claude-sonnet-4-6");
        let messages = vec![assistant(Some(other_model), None, Some(thinking_blocks()), None)];

        let normalized = normalize_history(messages, &current());

        let Message::Assistant {
            reasoning_details, ..
        } = &normalized[0]
        else {
            panic!("assistant message expected");
        };
        assert_eq!(reasoning_details, &None);
    }

    #[test]
    fn orphaned_tool_calls_gain_synthesized_interrupted_results() {
        let messages = vec![
            Message::User {
                content: "prompt".to_string(),
            },
            assistant(
                Some(current()),
                None,
                None,
                Some(vec![tool_call("call-1"), tool_call("call-2")]),
            ),
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "real result".to_string(),
            },
        ];

        let normalized = normalize_history(messages, &current());

        assert_eq!(normalized.len(), 4, "one synthesized result added");
        let Message::Tool {
            tool_call_id,
            content,
        } = &normalized[2]
        else {
            panic!("synthesized tool message expected, got {:?}", normalized[2]);
        };
        assert_eq!(tool_call_id, "call-2");
        assert_eq!(content, INTERRUPTED_TOOL_RESULT);
        assert!(
            matches!(&normalized[3], Message::Tool { tool_call_id, .. } if tool_call_id == "call-1"),
            "the real result stays; synthesized results slot in directly after the call"
        );
    }

    #[test]
    fn trailing_cancelled_tool_turn_is_completed_not_dropped() {
        // The cancel-after-push shape: assistant with calls, no results, end
        // of history. The model API needs a result per call to continue.
        let messages = vec![assistant(
            None,
            None,
            None,
            Some(vec![tool_call("call-9")]),
        )];

        let normalized = normalize_history(messages, &current());

        assert_eq!(normalized.len(), 2);
        assert!(
            matches!(&normalized[1], Message::Tool { tool_call_id, content }
                if tool_call_id == "call-9" && content == INTERRUPTED_TOOL_RESULT)
        );
    }

    #[test]
    fn orphaned_tool_results_without_a_matching_call_are_dropped() {
        let messages = vec![
            Message::User {
                content: "prompt".to_string(),
            },
            Message::Tool {
                tool_call_id: "ghost".to_string(),
                content: "no call for this".to_string(),
            },
            assistant(Some(current()), None, None, Some(vec![tool_call("call-1")])),
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "real result".to_string(),
            },
        ];

        let normalized = normalize_history(messages, &current());

        assert_eq!(normalized.len(), 3, "the ghost result is dropped");
        assert!(
            !normalized.iter().any(
                |message| matches!(message, Message::Tool { tool_call_id, .. } if tool_call_id == "ghost")
            )
        );
    }

    #[test]
    fn empty_and_tool_free_histories_pass_through_unchanged() {
        let messages = vec![
            Message::System {
                content: "sys".to_string(),
            },
            Message::User {
                content: "hi".to_string(),
            },
            assistant(Some(current()), None, None, None),
            Message::User {
                content: "again".to_string(),
            },
        ];

        let normalized = normalize_history(messages.clone(), &current());

        assert_eq!(
            serde_json::to_value(&normalized).unwrap(),
            serde_json::to_value(&messages).unwrap()
        );
    }
}
