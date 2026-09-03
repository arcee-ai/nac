use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};

use crate::types::Message;

pub(super) fn append_to_initial_system_message(messages: &mut [Message], extra: &str) {
    if extra.is_empty() {
        return;
    }
    if let Some(Message::System { content }) = messages.first_mut() {
        content.push_str("\n\n");
        content.push_str(extra);
    }
}

/// Trim a trailing assistant tool-call turn whose tool results never arrived
/// (a crash or cancel between the assistant message and the tool-result
/// batch). Shared by the session cancel path and the transcript-log restore
/// merge, which also removes the matching log tail.
pub(crate) fn truncate_incomplete_tool_turn(messages: &mut Vec<Message>) {
    if let Some(index) = incomplete_tool_turn_index(messages) {
        messages.truncate(index);
    }
}

pub(super) fn incomplete_tool_turn_index(messages: &[Message]) -> Option<usize> {
    let index = messages.iter().rposition(|message| {
        matches!(
            message,
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } if !tool_calls.is_empty()
        )
    })?;
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return None;
    };
    let expected = tool_calls
        .iter()
        .map(|tool_call| tool_call.id.as_str())
        .collect::<HashSet<_>>();
    let observed = messages[index + 1..]
        .iter()
        .filter_map(|message| match message {
            Message::Tool { tool_call_id, .. } => Some(tool_call_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    (!expected.is_subset(&observed)).then_some(index)
}

pub(super) fn missing_tool_result_ids(messages: &[Message]) -> Vec<String> {
    let Some(index) = incomplete_tool_turn_index(messages) else {
        return Vec::new();
    };
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return Vec::new();
    };
    let observed = messages[index + 1..]
        .iter()
        .filter_map(|message| match message {
            Message::Tool { tool_call_id, .. } => Some(tool_call_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    tool_calls
        .iter()
        .filter(|tool_call| !observed.contains(tool_call.id.as_str()))
        .map(|tool_call| tool_call.id.clone())
        .collect()
}

pub(super) fn transcripts_match(left: &[Message], right: &[Message]) -> Result<bool> {
    Ok(serde_json::to_vec(left)? == serde_json::to_vec(right)?)
}

pub(super) async fn acquire_transcript_operation_lease_and_snapshot(
    store_path: PathBuf,
    writer: Arc<crate::store::TranscriptLogWriter>,
    session_id: String,
) -> Result<(crate::sessions::SessionOperationLease, Vec<Message>)> {
    tokio::task::spawn_blocking(move || -> Result<_> {
        let lease = crate::sessions::SessionOperationLease::try_acquire(&store_path, &session_id)
            .map_err(anyhow::Error::new)?;
        let messages = writer.read_snapshot_messages(&session_id)?;
        Ok((lease, messages))
    })
    .await
    .map_err(|error| anyhow!("transcript log operation lease task failed: {error}"))?
}
