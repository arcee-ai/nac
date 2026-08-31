//! Other-type continue-in-X links between sessions.

use super::*;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::sessions::SessionBehavior;

/// Fallback when the source chat has no presentation title and no stored name.
const NEW_CHAT_TITLE: &str = "New Session";

/// The chat this session was converted from, for tab and list-row marks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionConvertedOrigin {
    pub session_id: String,
    pub title: String,
    pub source_behavior: SessionBehavior,
    /// True when the original chat row is gone. The stored title still names it.
    #[serde(default)]
    pub deleted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionHandoffRecord {
    pub handoff_id: String,
    pub source_session_id: String,
    pub target_session_id: String,
    pub source_message_idx: usize,
    pub source_behavior: SessionBehavior,
    pub target_behavior: SessionBehavior,
    pub created_at: String,
}

pub fn insert_session_handoff(
    path: &Path,
    handoff_id: &str,
    source_session_id: &str,
    target_session_id: &str,
    source_message_idx: usize,
    source_behavior: SessionBehavior,
    target_behavior: SessionBehavior,
) -> Result<()> {
    let conn = open_connection(path)?;
    let idx = i64::try_from(source_message_idx).context("handoff message index overflowed")?;
    conn.execute(
        "INSERT INTO session_handoffs
             (handoff_id, source_session_id, target_session_id, source_message_idx,
              source_behavior, target_behavior, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            handoff_id,
            source_session_id,
            target_session_id,
            idx,
            source_behavior.as_str(),
            target_behavior.as_str(),
            now_utc()
        ],
    )?;
    Ok(())
}

pub fn list_session_handoffs(
    path: &Path,
    source_session_id: &str,
) -> Result<Vec<SessionHandoffRecord>> {
    let conn = open_connection(path)?;
    list_session_handoffs_with_connection(&conn, source_session_id)
}

pub(crate) fn list_session_handoffs_with_connection(
    conn: &Connection,
    source_session_id: &str,
) -> Result<Vec<SessionHandoffRecord>> {
    let mut statement = conn.prepare(
        "SELECT handoff_id, source_session_id, target_session_id, source_message_idx,
                source_behavior, target_behavior, created_at
         FROM session_handoffs
         WHERE source_session_id = ?1
         ORDER BY created_at ASC, handoff_id ASC",
    )?;
    let rows = statement.query_map(params![source_session_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, String>(6)?,
        ))
    })?;
    let mut records = Vec::new();
    for row in rows {
        let (handoff_id, source, target, idx, source_behavior, target_behavior, created_at) = row?;
        records.push(SessionHandoffRecord {
            handoff_id,
            source_session_id: source,
            target_session_id: target,
            source_message_idx: usize::try_from(idx).context("handoff message index overflowed")?,
            source_behavior: source_behavior.parse()?,
            target_behavior: target_behavior.parse()?,
            created_at,
        });
    }
    Ok(records)
}

pub(crate) fn converted_origin_from_parts(
    source_session_id: Option<String>,
    source_behavior: Option<String>,
    live_title: Option<String>,
    live_prompt: Option<String>,
    live_session_id: Option<String>,
) -> Option<SessionConvertedOrigin> {
    let session_id = source_session_id?;
    let source_behavior = source_behavior?.parse().ok()?;
    let deleted = live_session_id.is_none();
    let title = nonempty_owned(live_title)
        .or_else(|| nonempty_owned(live_prompt))
        .unwrap_or_else(|| NEW_CHAT_TITLE.to_string());
    Some(SessionConvertedOrigin {
        session_id,
        title,
        source_behavior,
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
