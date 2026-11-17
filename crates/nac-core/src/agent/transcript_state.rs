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
    crate::store::spawn_blocking_store_caller(move || -> Result<_> {
        let lease = crate::sessions::SessionOperationLease::try_acquire(&store_path, &session_id)
            .map_err(anyhow::Error::new)?;
        let messages = writer.read_snapshot_messages(&session_id)?;
        Ok((lease, messages))
    })
    .await
    .map_err(|error| anyhow!("transcript log operation lease task failed: {error}"))?
}

// Transcript synchronization and cancellation-tail restoration share the
// existing transcript-state owner; the agent loop only coordinates their use.
use super::*;

impl Agent {
    /// Stale-transcript guard for the terminal normalization paths (shared
    /// store, issue #146): `true` when the durable transcript log holds
    /// rows at or beyond `committed_log_len` — rows this process never
    /// committed or adopted, so a peer must have appended them while it
    /// held the operation lease (e.g. the previous run owner crashed and
    /// this survivor's long-lived agent never re-restored). Deleting the
    /// log tail from the stale in-memory length would permanently remove
    /// those committed rows.
    pub(super) async fn durable_log_has_rows_past_own_commits(&self) -> Result<bool> {
        let Some(sink) = &self.transcript_log else {
            return Ok(false);
        };
        let from_idx = self
            .pending_log_end
            .unwrap_or(self.committed_log_len)
            .max(self.committed_log_len);
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        crate::store::spawn_blocking_store_caller(move || {
            writer.has_entries_from(&session_id, from_idx)
        })
        .await
        .map_err(|error| anyhow!("transcript log read task failed: {error}"))?
    }

    /// Adopt the durable transcript (snapshot blob ++ log tail) in memory
    /// without deleting anything: the read-only half of
    /// [`Agent::refresh_transcript_under_lease`] for the terminal
    /// normalization paths, which do not hold the operation lease they
    /// could pass down. A genuine gap is left for the next lease-held
    /// restore or admission refresh to repair.
    pub(super) async fn reload_transcript_from_store(&mut self) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        let (snapshot, tail) = crate::store::spawn_blocking_store_caller(move || {
            let snapshot = writer.read_snapshot_messages(&session_id)?;
            let tail = writer.read_from(&session_id, snapshot.len() as u64)?;
            Ok::<_, anyhow::Error>((snapshot, tail))
        })
        .await
        .map_err(|error| anyhow!("transcript reload task failed: {error}"))??;
        let mut merged = snapshot;
        let mut expected_idx = merged.len() as u64;
        for (idx, message) in tail {
            if idx != expected_idx {
                return Err(anyhow!(
                    "transcript log tail is not contiguous with the snapshot: expected idx {expected_idx}, found {idx}"
                ));
            }
            merged.push(message);
            expected_idx = expected_idx
                .checked_add(1)
                .ok_or_else(|| anyhow!("transcript log index overflowed"))?;
        }
        self.committed_log_len = merged.len() as u64;
        self.restore_messages(merged);
        // Failed reads or validation must leave recovery tokens available
        // for another reload rather than letting cleanup delete unseen rows.
        self.direct_inbox_append_start = None;
        self.steering_append_pending = false;
        Ok(())
    }

    pub(super) async fn append_cancellation_tail(
        &mut self,
        mut messages: Vec<Message>,
    ) -> Result<()> {
        let partial = self.take_partial_stream();
        if !partial.is_empty() {
            messages.push(Message::Assistant {
                content: (!partial.text.is_empty()).then_some(partial.text),
                reasoning_text: (!partial.reasoning.is_empty()).then_some(partial.reasoning),
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: Some(self.client.model_origin()),
                reasoning_field: None,
            });
        }
        messages.push(Message::Assistant {
            content: Some(RUN_CANCELLED_MARKER.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        });
        self.push_terminal_batch_and_log(messages).await
    }
}
