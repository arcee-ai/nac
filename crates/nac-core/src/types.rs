use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;

use crate::model::BackendKind;

fn serialize_nullable_content<S>(value: &Option<String>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    match value {
        Some(s) => serializer.serialize_str(s),
        None => serializer.serialize_none(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "lowercase")]
pub enum Message {
    System {
        content: String,
    },
    User {
        content: String,
    },
    #[serde(rename = "assistant")]
    Assistant {
        #[serde(serialize_with = "serialize_nullable_content")]
        content: Option<String>,
        #[serde(
            default,
            alias = "reasoning_content",
            skip_serializing_if = "Option::is_none"
        )]
        reasoning_text: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_details: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        tool_calls: Option<Vec<ToolCall>>,
        /// The model that produced this message (S5). Stamped at the
        /// transcript push site; `None` on pre-S5 (legacy) messages, which
        /// the wire normalization treats as same-model. Drives the
        /// same-model reasoning-replay gate in `model::normalize_history`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model_origin: Option<ModelOrigin>,
        /// The wire field that carried `reasoning_text` on completions
        /// endpoints ("reasoning_content" vs "reasoning"); replayed under
        /// the same name. `None` for details-based reasoning (Anthropic,
        /// OpenAI Responses) and legacy messages.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning_field: Option<String>,
    },
    #[serde(rename = "tool")]
    Tool {
        tool_call_id: String,
        content: String,
    },
}

/// Identifies the model that produced an assistant message (S5 reasoning
/// discipline). Reasoning signatures (Anthropic thinking blocks, OpenAI
/// reasoning items, completions reasoning text) are only replayed to the
/// same origin; a different origin makes the wire normalization strip them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelOrigin {
    pub backend: BackendKind,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolDefinition {
    #[serde(rename = "type")]
    pub def_type: String,
    pub function: FunctionDef,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDef {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_assistant_content_null() {
        let msg = Message::Assistant {
            content: None,
            reasoning_text: Some("thinking".to_string()),
            reasoning_details: Some(serde_json::json!([{"type": "reasoning"}])),
            tool_calls: Some(vec![ToolCall {
                id: "call_123".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "read".to_string(),
                    arguments: r#"{"path": "src/main.rs"}"#.to_string(),
                },
            }]),
            model_origin: None,
            reasoning_field: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(
            json.contains("\"content\":null"),
            "Expected \"content\":null in JSON but got: {}",
            json
        );
        assert!(
            json.contains("tool_calls"),
            "Expected tool_calls in JSON: {}",
            json
        );
        assert!(
            json.contains("\"reasoning_text\":\"thinking\""),
            "Expected reasoning_text in JSON: {}",
            json
        );
        assert!(
            json.contains("\"reasoning_details\":[{\"type\":\"reasoning\"}]"),
            "Expected reasoning_details in JSON: {}",
            json
        );
    }

    #[test]
    fn test_assistant_reasoning_content_alias_deserializes() {
        let json = r#"{
            "role":"assistant",
            "content":"hello",
            "reasoning_content":"thinking",
            "tool_calls":[]
        }"#;
        let parsed: Message = serde_json::from_str(json).unwrap();
        match parsed {
            Message::Assistant {
                content,
                reasoning_text,
                reasoning_details,
                tool_calls,
                model_origin: None,
                reasoning_field: None,
            } => {
                assert_eq!(content.as_deref(), Some("hello"));
                assert_eq!(reasoning_text.as_deref(), Some("thinking"));
                assert_eq!(reasoning_details, None);
                assert_eq!(
                    tool_calls.as_ref().map(std::vec::Vec::len),
                    Some(0),
                    "expected empty tool call list"
                );
            }
            other => panic!("expected assistant message, got {:?}", other),
        }
    }

    #[test]
    fn test_message_role_serialization() {
        let system = Message::System {
            content: "hello".to_string(),
        };
        let json = serde_json::to_string(&system).unwrap();
        assert!(json.contains("\"role\":\"system\""), "Got: {}", json);

        let user = Message::User {
            content: "hi".to_string(),
        };
        let json = serde_json::to_string(&user).unwrap();
        assert!(json.contains("\"role\":\"user\""), "Got: {}", json);

        let tool = Message::Tool {
            tool_call_id: "call_abc".to_string(),
            content: "result".to_string(),
        };
        let json = serde_json::to_string(&tool).unwrap();
        assert!(json.contains("\"role\":\"tool\""), "Got: {}", json);
        assert!(json.contains("tool_call_id"), "Got: {}", json);
    }
    #[test]
    fn pre_s5_assistant_rows_deserialize_without_origin_fields() {
        // Old messages_json / transcript-log rows have no origin keys; the
        // serde-additive fields default to None (the legacy safety rail).
        let json = r#"{
            "role":"assistant",
            "content":"hello",
            "reasoning_text":"thinking",
            "reasoning_details":[{"type":"thinking","thinking":"t","signature":"s"}],
            "tool_calls":[{"id":"call-1","type":"function","function":{"name":"read","arguments":"{}"}}]
        }"#;
        let msg: Message = serde_json::from_str(json).expect("old row deserializes");
        let Message::Assistant {
            model_origin,
            reasoning_field,
            ..
        } = &msg
        else {
            panic!("assistant message expected");
        };
        assert_eq!(model_origin, &None);
        assert_eq!(reasoning_field, &None);

        // Re-serialization stays additive: None fields are skipped, so the
        // stored shape is unchanged for unstamped messages.
        let out = serde_json::to_string(&msg).unwrap();
        assert!(!out.contains("model_origin"), "{out}");
        assert!(!out.contains("reasoning_field"), "{out}");
    }

    #[test]
    fn stamped_assistant_origin_round_trips() {
        let msg = Message::Assistant {
            content: Some("a".to_string()),
            reasoning_text: Some("t".to_string()),
            reasoning_details: None,
            tool_calls: None,
            model_origin: Some(ModelOrigin {
                backend: BackendKind::TogetherChat,
                model: "together-model".to_string(),
            }),
            reasoning_field: Some("reasoning".to_string()),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"backend\":\"together-chat\""), "{json}");

        let back: Message = serde_json::from_str(&json).unwrap();
        let Message::Assistant {
            model_origin,
            reasoning_field,
            ..
        } = &back
        else {
            panic!("assistant message expected");
        };
        assert_eq!(
            model_origin.as_ref().map(|origin| (origin.backend, origin.model.as_str())),
            Some((BackendKind::TogetherChat, "together-model"))
        );
        assert_eq!(reasoning_field.as_deref(), Some("reasoning"));
    }

}
