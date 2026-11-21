//! Conversation forks: a new session cloned from a prefix of another.
//!
//! Neither session id is a foreign key: deleting the fork leaves a tombstone
//! the original chat can still render, and deleting the original still lets
//! the fork name where it came from.

use super::*;

use serde::{Deserialize, Serialize};

use crate::types::Message;

/// Fallback when the origin has no presentation title and no stored name.
const NEW_CHAT_TITLE: &str = "New Session";

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

coordinated_command! {
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
command InsertSessionForkCommand {
    source_session_id: String = source_session_id.to_owned(),
    fork_session_id: String = fork_session_id.to_owned(),
    source_message_idx: usize = source_message_idx,
    source_title: String = source_title.to_owned(),
}
call |command| (&command.source_session_id, &command.fork_session_id, command.source_message_idx, &command.source_title)
correlation |command| crate::telemetry::Correlation::session(Some(&command.source_session_id));
port public;
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

coordinated_command! {
/// Copy workspace revisions and settled human shell history through the forked prefix.
pub fn clone_session_conversation_artifacts(
    path: &Path,
    source_session_id: &str,
    fork_session_id: &str,
    prefix: &[Message],
    source_transcript_len: usize,
) -> Result<()> {
    let prefix_len = i64::try_from(prefix.len()).context("fork prefix length overflowed")?;
    let mut conn = open_connection(path)?;
    let tx = conn.transaction()?;
    clone_workspace_revisions(
        &tx,
        source_session_id,
        fork_session_id,
        prefix_len,
        prefix.len() == source_transcript_len,
    )?;
    // Copy settled human history inside the same prefix transaction. Output
    // handles belong to their original process/session and are never inherited.
    tx.execute("INSERT INTO human_shell_operations (session_id, request_id, fingerprint, operation_id, phase, snapshot_json)
        SELECT ?1, request_id, fingerprint, operation_id, phase, json_set(snapshot_json, '$.output_id', NULL)
        FROM human_shell_operations WHERE session_id=?2 AND phase='finished'
        AND json_extract(snapshot_json, '$.transcript_index') < ?3",
        params![fork_session_id, source_session_id, prefix_len])?;
    tx.commit()?;
    Ok(())
}
command CloneSessionConversationArtifactsCommand {
    source_session_id: String = source_session_id.to_owned(),
    fork_session_id: String = fork_session_id.to_owned(),
    prefix: Vec<Message> = prefix.to_vec(),
    source_transcript_len: usize = source_transcript_len,
}
call |command| (&command.source_session_id, &command.fork_session_id, &command.prefix, command.source_transcript_len)
correlation |command| crate::telemetry::Correlation::session(Some(&command.source_session_id));
port public;
}

fn clone_workspace_revisions(
    tx: &Transaction<'_>,
    source_session_id: &str,
    fork_session_id: &str,
    prefix_len: i64,
    copy_all: bool,
) -> Result<()> {
    if copy_all {
        tx.execute(
            "INSERT INTO workspace_revisions
                 (session_id, run_id, commit_sha, base_sha, branch, label,
                  additions, deletions, changed_files, created_at, transcript_len)
             SELECT ?1, run_id, commit_sha, base_sha, branch, label,
                    additions, deletions, changed_files, created_at, transcript_len
             FROM workspace_revisions
             WHERE session_id = ?2
             ORDER BY id ASC",
            params![fork_session_id, source_session_id],
        )?;
        return Ok(());
    }
    tx.execute(
        "INSERT INTO workspace_revisions
             (session_id, run_id, commit_sha, base_sha, branch, label,
              additions, deletions, changed_files, created_at, transcript_len)
         SELECT ?1, run_id, commit_sha, base_sha, branch, label,
                additions, deletions, changed_files, created_at, transcript_len
         FROM workspace_revisions
         WHERE session_id = ?2
           AND transcript_len IS NOT NULL
           AND transcript_len <= ?3
         ORDER BY id ASC",
        params![fork_session_id, source_session_id, prefix_len],
    )?;
    Ok(())
}

coordinated_command! {
pub fn list_session_forks(path: &Path, source_session_id: &str) -> Result<Vec<SessionForkLink>> {
    let conn = open_runtime_connection(path)?;
    list_session_forks_with_connection(&conn, source_session_id)
}
command ListSessionForksCommand {
    source_session_id: String = source_session_id.to_owned(),
}
call |command| (&command.source_session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.source_session_id));
port public;
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

coordinated_command! {
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
command DismissSessionForkCommand {
    source_session_id: String = source_session_id.to_owned(),
    fork_session_id: String = fork_session_id.to_owned(),
}
call |command| (&command.source_session_id, &command.fork_session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.source_session_id));
port public;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_fork_retains_only_prefix_workspace_and_settled_shell_history() {
        let dir = std::env::temp_dir().join(format!("nac-direct-fork-{}", uuid::Uuid::new_v4()));
        let path = dir.join("store.db");
        initialize(&path).unwrap();
        for session in ["source", "partial", "full"] {
            insert_test_session(&path, session);
        }
        let conn = open_runtime_connection(&path).unwrap();
        for (run, length) in [("first", Some(1)), ("later", Some(3)), ("legacy", None)] {
            conn.execute("INSERT INTO workspace_revisions (session_id, run_id, commit_sha, label, created_at, transcript_len) VALUES ('source', ?1, ?1, 'test', 'now', ?2)", params![run, length]).unwrap();
        }
        for (id, phase, index) in [
            ("included", "finished", 0),
            ("later", "finished", 2),
            ("pending", "started", 0),
        ] {
            let snapshot = serde_json::json!({"transcript_index": index, "output_id": "original"});
            conn.execute("INSERT INTO human_shell_operations (session_id, request_id, fingerprint, operation_id, phase, snapshot_json) VALUES ('source', ?1, 'fingerprint', ?1, ?2, ?3)", params![id, phase, snapshot.to_string()]).unwrap();
        }
        drop(conn);
        let prefix = vec![Message::User {
            content: "one".into(),
        }];
        clone_session_conversation_artifacts(&path, "source", "partial", &prefix, 3).unwrap();
        clone_session_conversation_artifacts(&path, "source", "full", &prefix, 1).unwrap();
        let conn = open_runtime_connection(&path).unwrap();
        let revisions = |session: &str| -> Vec<String> {
            conn.prepare("SELECT run_id FROM workspace_revisions WHERE session_id=?1 ORDER BY id")
                .unwrap()
                .query_map([session], |row| row.get(0))
                .unwrap()
                .collect::<rusqlite::Result<_>>()
                .unwrap()
        };
        assert_eq!(revisions("partial"), ["first"]);
        assert_eq!(revisions("full"), ["first", "later", "legacy"]);
        for session in ["partial", "full"] {
            let rows: Vec<(String, Option<String>)> = conn.prepare("SELECT request_id, json_extract(snapshot_json, '$.output_id') FROM human_shell_operations WHERE session_id=?1").unwrap()
                .query_map([session], |row| Ok((row.get(0)?, row.get(1)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap();
            assert_eq!(rows, [("included".into(), None)]);
        }
        drop(conn);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
