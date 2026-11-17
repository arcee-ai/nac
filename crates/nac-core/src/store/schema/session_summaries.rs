//! Migration backfill for durable session summary projections.
use super::*;

pub(super) fn backfill_session_summaries(conn: &Connection) -> Result<()> {
    let rows = {
        let mut statement = conn.prepare("SELECT session_id, messages_json FROM sessions")?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (session_id, messages_json) in rows {
        let messages: Vec<crate::types::Message> = serde_json::from_str(&messages_json)
            .with_context(|| {
                format!("failed to parse stored messages for session '{session_id}'")
            })?;
        let blob_visible = crate::sessions::visible_message_count(&messages);
        let log_from_idx =
            u64::try_from(messages.len()).context("session transcript length overflowed")?;
        let log_visible =
            crate::store::count_visible_transcript_log_messages(conn, &session_id, log_from_idx)?;
        let visible_count = i64::try_from(
            blob_visible
                .checked_add(log_visible)
                .context("session visible message count overflowed")?,
        )
        .context("session visible message count overflowed")?;
        let last_user_prompt =
            crate::store::last_transcript_log_user_prompt(conn, &session_id, log_from_idx)?
                .or_else(|| crate::sessions::last_user_prompt(&messages));
        conn.execute(
            "UPDATE sessions
             SET visible_message_count = ?1, last_user_prompt = ?2
             WHERE session_id = ?3",
            params![visible_count, last_user_prompt, session_id],
        )?;
    }
    Ok(())
}
