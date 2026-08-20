//! Conversation forks: a new session cloned from a prefix of another.
//!
//! Neither session id is a foreign key: deleting the fork leaves a tombstone
//! the original chat can still render, and deleting the original still lets
//! the fork name where it came from.

use super::*;
use serde::{Deserialize, Serialize};

/// Fallback when the origin has no presentation title and no stored name.
const NEW_CHAT_TITLE: &str = "New Chat";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionForkLink {
    pub session_id: String,
    pub source_message_idx: usize,
    /// True when the forked session row is gone. The original chat still
    /// shows the marker as a deleted item until the user dismisses it.
    pub deleted: bool,
    /// Live fork presentation title. Absent on a deleted fork.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

/// The chat this session was forked from, for tab and list-row marks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionForkOrigin {
    pub session_id: String,
    pub title: String,
    /// True when the original chat row is gone. The stored title still names it.
    #[serde(default)]
    pub deleted: bool,
}

pub fn insert_session_fork(
    path: &Path,
    source_session_id: &str,
    fork_session_id: &str,
    source_message_idx: usize,
    source_title: &str,
) -> Result<()> {
    let conn = open_connection(path)?;
    insert_session_fork_with_connection(
        &conn,
        source_session_id,
        fork_session_id,
        source_message_idx,
        source_title,
    )
}

pub(crate) fn insert_session_fork_with_connection(
    conn: &Connection,
    source_session_id: &str,
    fork_session_id: &str,
    source_message_idx: usize,
    source_title: &str,
) -> Result<()> {
    let idx = i64::try_from(source_message_idx).context("fork message index overflowed")?;
    let stored_title = trimmed_non_empty(source_title);
    conn.execute(
        "INSERT INTO session_forks
             (source_session_id, fork_session_id, source_message_idx, created_at, source_title)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            source_session_id,
            fork_session_id,
            idx,
            now_utc(),
            stored_title
        ],
    )?;
    Ok(())
}

pub fn list_session_forks(path: &Path, source_session_id: &str) -> Result<Vec<SessionForkLink>> {
    let conn = open_runtime_connection(path)?;
    list_session_forks_with_connection(&conn, source_session_id)
}

pub(crate) fn list_session_forks_with_connection(
    conn: &Connection,
    source_session_id: &str,
) -> Result<Vec<SessionForkLink>> {
    let mut stmt = conn.prepare(
        "SELECT f.fork_session_id, f.source_message_idx,
                CASE WHEN s.session_id IS NULL THEN 1 ELSE 0 END,
                p.title
         FROM session_forks f
         LEFT JOIN sessions s ON s.session_id = f.fork_session_id
         LEFT JOIN session_presentations p ON p.session_id = f.fork_session_id
         WHERE f.source_session_id = ?1
         ORDER BY f.created_at ASC, f.fork_session_id ASC",
    )?;
    let rows = stmt.query_map(params![source_session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut forks = Vec::new();
    for row in rows {
        let (session_id, source_message_idx, deleted, title) = row?;
        let source_message_idx =
            usize::try_from(source_message_idx).context("stored fork message index overflowed")?;
        let deleted = deleted != 0;
        forks.push(SessionForkLink {
            session_id,
            source_message_idx,
            deleted,
            title: if deleted {
                None
            } else {
                title.filter(|value| !value.trim().is_empty())
            },
        });
    }
    Ok(forks)
}

pub fn dismiss_session_fork(
    path: &Path,
    source_session_id: &str,
    fork_session_id: &str,
) -> Result<bool> {
    let conn = open_connection(path)?;
    let deleted = conn.execute(
        "DELETE FROM session_forks
         WHERE source_session_id = ?1 AND fork_session_id = ?2",
        params![source_session_id, fork_session_id],
    )?;
    Ok(deleted > 0)
}

pub(crate) fn fork_origin_from_parts(
    source_session_id: Option<String>,
    stored_title: Option<String>,
    live_title: Option<String>,
    live_prompt: Option<String>,
    live_session_id: Option<String>,
) -> Option<SessionForkOrigin> {
    let session_id = source_session_id?;
    let deleted = live_session_id.is_none();
    let title = nonempty_owned(live_title)
        .or_else(|| nonempty_owned(live_prompt))
        .or_else(|| nonempty_owned(stored_title))
        .unwrap_or_else(|| NEW_CHAT_TITLE.to_string());
    Some(SessionForkOrigin {
        session_id,
        title,
        deleted,
    })
}

fn trimmed_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn nonempty_owned(value: Option<String>) -> Option<String> {
    value.and_then(|text| trimmed_non_empty(&text))
}
