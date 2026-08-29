//! Project an other-type continue-in-X brief from a source transcript.
//!
//! The button copies user and assistant prose through the named turn, then
//! lands an idle session of the other type. Tool history and thoughts stay
//! on the source.

use anyhow::{anyhow, Result};

use crate::sessions::SessionBehavior;
use crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS;
use crate::types::Message;

/// Fail closed when projected user/assistant prose exceeds this many UTF-8 bytes.
pub const HANDOFF_BRIEF_BYTE_LIMIT: usize = 32 * 1024;

/// The only legal continue-in-X target for a source session.
pub fn other_behavior(source: SessionBehavior) -> SessionBehavior {
    if source.is_nac() {
        SessionBehavior::Direct
    } else {
        SessionBehavior::Orchestrator
    }
}

pub fn validate_target_behavior(
    source: SessionBehavior,
    target: SessionBehavior,
) -> Result<SessionBehavior> {
    if target == SessionBehavior::DirectWithOrchestrator {
        return Err(anyhow!("handoff target must be direct or orchestrator"));
    }
    let expected = other_behavior(source);
    if target != expected {
        return Err(anyhow!("handoff target must be the other session type"));
    }
    Ok(expected)
}

pub fn handoff_note(source_session_id: &str) -> String {
    format!(
        "This is a handoff brief from session {source_session_id}. \
The conversation above is projected prose only. \
Wait for the user's next instruction before doing any work."
    )
}

pub fn project_handoff_messages(
    source_messages: &[Message],
    message_idx: usize,
    source_session_id: &str,
    target: SessionBehavior,
    working_directory: &str,
) -> Result<Vec<Message>> {
    require_assistant_turn(source_messages, message_idx)?;
    let prefix = &source_messages[..=message_idx];
    let projected = project_prose(prefix)?;
    let prose_bytes = projected
        .iter()
        .map(prose_len)
        .try_fold(0usize, |total, len| total.checked_add(len))
        .ok_or_else(|| anyhow!("handoff brief exceeded {HANDOFF_BRIEF_BYTE_LIMIT} bytes"))?;
    if prose_bytes > HANDOFF_BRIEF_BYTE_LIMIT {
        return Err(anyhow!(
            "handoff brief exceeded {HANDOFF_BRIEF_BYTE_LIMIT} bytes"
        ));
    }

    let source_system = prefix.iter().find_map(|message| match message {
        Message::System { content } => Some(content.as_str()),
        _ => None,
    });
    let mut system = target_system_prompt(target, working_directory);
    system.push_str(&project_instruction_suffix(
        source_system,
        working_directory,
    ));

    let mut messages = vec![Message::System { content: system }];
    messages.extend(projected);
    messages.push(Message::User {
        content: handoff_note(source_session_id),
    });
    Ok(messages)
}

fn require_assistant_turn(messages: &[Message], message_idx: usize) -> Result<()> {
    match messages.get(message_idx) {
        Some(Message::Assistant { .. }) => Ok(()),
        Some(_) => Err(anyhow!("handoff target is not an assistant message")),
        None => Err(anyhow!("handoff target is past the transcript")),
    }
}

fn project_prose(prefix: &[Message]) -> Result<Vec<Message>> {
    let mut projected = Vec::new();
    for message in prefix {
        match message {
            Message::User { content } => projected.push(Message::User {
                content: content.clone(),
            }),
            Message::Assistant { content, .. } => {
                if let Some(content) = content
                    .as_deref()
                    .map(str::trim)
                    .filter(|text| !text.is_empty())
                {
                    projected.push(Message::Assistant {
                        content: Some(content.to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    });
                }
            }
            Message::System { .. } | Message::Tool { .. } => {}
        }
    }
    Ok(projected)
}

fn prose_len(message: &Message) -> usize {
    match message {
        Message::User { content } => content.len(),
        Message::Assistant {
            content: Some(content),
            ..
        } => content.len(),
        _ => 0,
    }
}

fn target_system_prompt(target: SessionBehavior, working_directory: &str) -> String {
    if target.is_nac() {
        crate::agent::render_orchestrator_system_prompt(
            working_directory,
            DEFAULT_THREAD_TIMEOUT_SECS,
        )
    } else {
        crate::agent::render_direct_system_prompt(working_directory)
    }
}

fn project_instruction_suffix(source_system: Option<&str>, working_directory: &str) -> String {
    let Some(system) = source_system else {
        return String::new();
    };
    let agent = crate::agent::render_direct_system_prompt(working_directory);
    let orchestrator = crate::agent::render_orchestrator_system_prompt(
        working_directory,
        DEFAULT_THREAD_TIMEOUT_SECS,
    );
    system
        .strip_prefix(&agent)
        .or_else(|| system.strip_prefix(&orchestrator))
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assistant(content: &str) -> Message {
        Message::Assistant {
            content: Some(content.to_string()),
            reasoning_text: Some("secret thought".to_string()),
            reasoning_details: Some(serde_json::json!({"hidden": true})),
            tool_calls: Some(vec![crate::types::ToolCall {
                id: "call-1".to_string(),
                call_type: "function".to_string(),
                function: crate::types::FunctionCall {
                    name: "read".to_string(),
                    arguments: r#"{"path":"/hidden/src.rs"}"#.to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        }
    }

    #[test]
    fn other_behavior_swaps_agent_and_nac() {
        assert_eq!(
            other_behavior(SessionBehavior::Direct),
            SessionBehavior::Orchestrator
        );
        assert_eq!(
            other_behavior(SessionBehavior::DirectWithOrchestrator),
            SessionBehavior::Orchestrator
        );
        assert_eq!(
            other_behavior(SessionBehavior::Orchestrator),
            SessionBehavior::Direct
        );
    }

    #[test]
    fn same_type_target_is_rejected() {
        assert!(
            validate_target_behavior(SessionBehavior::Direct, SessionBehavior::Direct).is_err()
        );
        assert!(validate_target_behavior(
            SessionBehavior::DirectWithOrchestrator,
            SessionBehavior::Direct
        )
        .is_err());
        assert!(validate_target_behavior(
            SessionBehavior::Orchestrator,
            SessionBehavior::Orchestrator
        )
        .is_err());
    }

    #[test]
    fn projected_brief_drops_tools_and_thoughts() {
        let source = vec![
            Message::System {
                content: format!(
                    "{}\n\nProject instruction: keep the API.",
                    crate::agent::render_direct_system_prompt("/workspace")
                ),
            },
            Message::User {
                content: "inspect the crate".to_string(),
            },
            assistant("I read Cargo.toml."),
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "name = nac".into(),
            },
        ];
        let messages = project_handoff_messages(
            &source,
            2,
            "source",
            SessionBehavior::Orchestrator,
            "/workspace",
        )
        .unwrap();
        assert!(matches!(
            messages.as_slice(),
            [
                Message::System { content: system },
                Message::User { content: user },
                Message::Assistant { content: Some(assistant), tool_calls: None, reasoning_text: None, .. },
                Message::User { content: note }
            ] if system.contains("You must use threads for all coding work")
                && system.contains("Project instruction: keep the API.")
                && user == "inspect the crate"
                && assistant == "I read Cargo.toml."
                && note.contains("source")
                && note.contains("Wait for the user's next instruction")
        ));
        let encoded = serde_json::to_string(&messages).unwrap();
        assert!(!encoded.contains("call-1"));
        assert!(!encoded.contains("/hidden/src.rs"));
        assert!(!encoded.contains("secret thought"));
        assert!(!encoded.contains("\"tool_calls\""));
        assert!(!encoded.contains("\"role\":\"tool\""));
    }

    #[test]
    fn oversized_brief_fails_closed() {
        let huge = "x".repeat(HANDOFF_BRIEF_BYTE_LIMIT + 1);
        let source = vec![Message::User { content: huge }, assistant("ok")];
        let error = project_handoff_messages(
            &source,
            1,
            "source",
            SessionBehavior::Orchestrator,
            "/workspace",
        )
        .unwrap_err();
        assert!(error.to_string().contains("exceeded"));
    }
}
