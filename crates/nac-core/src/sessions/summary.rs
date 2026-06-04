use super::*;

pub(super) fn visible_message_count(messages: &[Message]) -> usize {
    messages
        .iter()
        .filter(|message| match message {
            Message::User { .. } => true,
            Message::Assistant {
                content,
                tool_calls,
                ..
            } => content.is_some() && tool_calls.as_ref().map_or(true, |tc| tc.is_empty()),
            _ => false,
        })
        .count()
}

pub(super) fn last_user_prompt(messages: &[Message]) -> Option<String> {
    messages.iter().rev().find_map(|message| match message {
        Message::User { content } => Some(content.clone()),
        _ => None,
    })
}
