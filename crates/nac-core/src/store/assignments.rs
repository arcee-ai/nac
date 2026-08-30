use super::*;

use rusqlite::OptionalExtension;

/// Shared assignment view for traditional children and managed orchestrators.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignmentRecord {
    pub session_id: String,
    pub parent_session_id: String,
    pub root_session_id: String,
    pub description: String,
    pub status: TraditionalChildStatus,
    pub frozen_message_count: Option<u64>,
}

pub fn load_assignment(path: &Path, session_id: &str) -> Result<Option<AssignmentRecord>> {
    Ok(
        load_session_assignment(path, session_id)?.map(|assignment| AssignmentRecord {
            session_id: assignment.child_session_id,
            parent_session_id: assignment.parent_session_id,
            root_session_id: assignment.root_session_id,
            description: assignment.description,
            status: assignment.status,
            frozen_message_count: assignment.frozen_message_count,
        }),
    )
}

/// Idle or running: the parent still owns the current generation.
pub fn assignment_is_open(path: &Path, session_id: &str) -> Result<bool> {
    Ok(load_assignment(path, session_id)?.is_some_and(|assignment| assignment.status.is_open()))
}

pub(crate) fn assignment_is_open_with_connection(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<bool> {
    if let Some(status) = assignment_status_with_connection(connection, session_id)? {
        return Ok(status.is_open());
    }
    Ok(false)
}

pub fn assignment_is_running(path: &Path, session_id: &str) -> Result<bool> {
    Ok(load_assignment(path, session_id)?
        .is_some_and(|assignment| assignment.status == TraditionalChildStatus::Running))
}

pub fn assignment_frozen_message_count(path: &Path, session_id: &str) -> Result<Option<u64>> {
    Ok(load_assignment(path, session_id)?.and_then(|assignment| assignment.frozen_message_count))
}

fn assignment_status_with_connection(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<Option<TraditionalChildStatus>> {
    let status: Option<String> = connection
        .query_row(
            "SELECT status FROM session_assignments WHERE child_session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    status.map(|status| status.parse()).transpose()
}

pub(crate) fn session_transcript_len(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Result<u64> {
    let blob_len: i64 = connection
        .query_row(
            "SELECT COALESCE(json_array_length(messages_json), 0)
             FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or(0);
    let log_max: Option<i64> = connection
        .query_row(
            "SELECT MAX(CAST(json_extract(event_json, '$.nac_transcript_message.idx') AS INTEGER))
             FROM thread_events
             WHERE session_id = ?1
               AND json_extract(event_json, '$.nac_transcript_message.idx') IS NOT NULL",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let from_log = log_max.unwrap_or(-1).saturating_add(1);
    u64::try_from(blob_len.max(from_log)).map_err(|_| anyhow!("transcript length overflowed"))
}

pub(crate) fn next_frozen_message_count(
    connection: &rusqlite::Connection,
    session_id: &str,
    current: Option<u64>,
) -> Result<u64> {
    let transcript_len = session_transcript_len(connection, session_id)?;
    Ok(current.unwrap_or(0).max(transcript_len))
}
