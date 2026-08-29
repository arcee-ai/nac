//! Other-type continue-in-X links between sessions.

use super::*;

use rusqlite::params;

use crate::sessions::SessionBehavior;

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
