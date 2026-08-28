//! Conversation forks: a new session cloned from a prefix of another.
//!
//! Neither session id is a foreign key: deleting the fork leaves a tombstone
//! the original chat can still render, and deleting the original still lets
//! the fork name where it came from.

use super::*;
use std::collections::{BTreeMap, BTreeSet};

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

/// Duplicate the conversation artifacts named by `prefix` onto the forked
/// session: threads, episodes, live thread events, steering, worksets, and
/// workspace revisions.
///
/// The fork writes the system head as its snapshot blob and the rest of
/// `prefix` as new transcript-log rows, so source orchestrator log rows are
/// not copied — their `idx` values belong to the source blob length. A
/// prefix that is the whole source transcript copies every current artifact.
/// A shorter prefix keeps only threads and worksets mentioned in those
/// messages. History is cut at the last transcript-log timestamp in the
/// prefix (or, without a log, at as many thread dispatches as that prefix
/// recorded). Steering is copied by that same cutoff, not by tool-call ids
/// — worker dispatch ids are a different UUID.
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
    if prefix.len() == source_transcript_len {
        clone_all_conversation_artifacts(&tx, source_session_id, fork_session_id)?;
    } else {
        clone_prefix_conversation_artifacts(
            &tx,
            source_session_id,
            fork_session_id,
            prefix_len,
            &prefix_conversation_artifacts(prefix),
        )?;
    }
    clone_workspace_revisions(
        &tx,
        source_session_id,
        fork_session_id,
        prefix_len,
        prefix.len() == source_transcript_len,
    )?;
    tx.commit()?;
    Ok(())
}

fn clone_all_conversation_artifacts(
    tx: &Transaction<'_>,
    source_session_id: &str,
    fork_session_id: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO threads (name, session_id, created_at, updated_at)
         SELECT name, ?1, created_at, updated_at
         FROM threads
         WHERE session_id = ?2",
        params![fork_session_id, source_session_id],
    )?;
    tx.execute(
        "INSERT INTO episodes (thread_name, session_id, action, content, status, created_at)
         SELECT thread_name, ?1, action, content, status, created_at
         FROM episodes
         WHERE session_id = ?2
         ORDER BY id ASC",
        params![fork_session_id, source_session_id],
    )?;
    tx.execute(
        "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
         SELECT ?1, thread_name, event_json, created_at
         FROM thread_events
         WHERE session_id = ?2 AND thread_name != ?3
         ORDER BY id ASC",
        params![
            fork_session_id,
            source_session_id,
            ORCHESTRATOR_STEERING_TARGET
        ],
    )?;
    tx.execute(
        "INSERT INTO thread_steering
             (session_id, thread_name, dispatch_id, instruction, status,
              created_at, claimed_at, delivered_at, expired_at)
         SELECT ?1, thread_name, dispatch_id, instruction, status,
                created_at, claimed_at, delivered_at, expired_at
         FROM thread_steering
         WHERE session_id = ?2
         ORDER BY id ASC",
        params![fork_session_id, source_session_id],
    )?;
    tx.execute(
        "INSERT INTO worksets
             (id, session_id, kind, instruction, status, summary,
              verification_recipe, created_at, updated_at)
         SELECT id, ?1, kind, instruction, status, summary,
                verification_recipe, created_at, updated_at
         FROM worksets
         WHERE session_id = ?2",
        params![fork_session_id, source_session_id],
    )?;
    tx.execute(
        "INSERT INTO workset_items
             (workset_id, session_id, position, title, thread_name, scope,
              description, item_kind, status, source_threads_json, last_summary,
              acceptance, updated_at)
         SELECT workset_id, ?1, position, title, thread_name, scope,
                description, item_kind, status, source_threads_json, last_summary,
                acceptance, updated_at
         FROM workset_items
         WHERE session_id = ?2",
        params![fork_session_id, source_session_id],
    )?;
    Ok(())
}

fn clone_prefix_conversation_artifacts(
    tx: &Transaction<'_>,
    source_session_id: &str,
    fork_session_id: &str,
    prefix_len: i64,
    artifacts: &PrefixArtifacts,
) -> Result<()> {
    let cutoff = prefix_created_at_cutoff(tx, source_session_id, prefix_len)?;
    for (thread_name, thread) in &artifacts.threads {
        let inserted = tx.execute(
            "INSERT INTO threads (name, session_id, created_at, updated_at)
             SELECT name, ?1, created_at, updated_at
             FROM threads
             WHERE session_id = ?2 AND name = ?3",
            params![fork_session_id, source_session_id, thread_name],
        )?;
        if inserted == 0 {
            continue;
        }

        if let Some(cutoff) = cutoff.as_deref() {
            clone_thread_rows_through(tx, source_session_id, fork_session_id, thread_name, cutoff)?;
            continue;
        }

        // No transcript-log timestamps: copy only as many dispatches as the
        // prefix itself recorded. A mentioned-only thread has no count, so
        // later source history is left behind rather than leaked.
        let episode_limit =
            i64::try_from(thread.dispatch_count).context("thread dispatch count overflowed")?;
        if episode_limit == 0 {
            continue;
        }
        clone_thread_rows_for_dispatches(
            tx,
            source_session_id,
            fork_session_id,
            thread_name,
            episode_limit,
        )?;
    }

    for workset_id in &artifacts.workset_ids {
        let inserted = tx.execute(
            "INSERT INTO worksets
                 (id, session_id, kind, instruction, status, summary,
                  verification_recipe, created_at, updated_at)
             SELECT id, ?1, kind, instruction, status, summary,
                    verification_recipe, created_at, updated_at
             FROM worksets
             WHERE session_id = ?2 AND id = ?3",
            params![fork_session_id, source_session_id, workset_id],
        )?;
        if inserted == 0 {
            continue;
        }
        tx.execute(
            "INSERT INTO workset_items
                 (workset_id, session_id, position, title, thread_name, scope,
                  description, item_kind, status, source_threads_json, last_summary,
                  acceptance, updated_at)
             SELECT workset_id, ?1, position, title, thread_name, scope,
                    description, item_kind, status, source_threads_json, last_summary,
                    acceptance, updated_at
             FROM workset_items
             WHERE session_id = ?2 AND workset_id = ?3",
            params![fork_session_id, source_session_id, workset_id],
        )?;
    }
    Ok(())
}

fn prefix_created_at_cutoff(
    tx: &Transaction<'_>,
    source_session_id: &str,
    prefix_len: i64,
) -> Result<Option<String>> {
    if prefix_len <= 0 {
        return Ok(None);
    }
    let cutoff: Option<String> = tx.query_row(
        "SELECT MAX(created_at)
         FROM thread_events
         WHERE session_id = ?1
           AND thread_name = ?2
           AND json_extract(event_json, '$.nac_transcript_message.idx') IS NOT NULL
           AND CAST(json_extract(event_json, '$.nac_transcript_message.idx') AS INTEGER) < ?3",
        params![source_session_id, ORCHESTRATOR_STEERING_TARGET, prefix_len],
        |row| row.get(0),
    )?;
    Ok(cutoff.filter(|value| !value.is_empty()))
}

fn clone_thread_rows_through(
    tx: &Transaction<'_>,
    source_session_id: &str,
    fork_session_id: &str,
    thread_name: &str,
    cutoff: &str,
) -> Result<()> {
    tx.execute(
        "INSERT INTO episodes (thread_name, session_id, action, content, status, created_at)
         SELECT thread_name, ?1, action, content, status, created_at
         FROM episodes
         WHERE session_id = ?2 AND thread_name = ?3 AND created_at <= ?4
         ORDER BY id ASC",
        params![fork_session_id, source_session_id, thread_name, cutoff],
    )?;
    tx.execute(
        "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
         SELECT ?1, thread_name, event_json, created_at
         FROM thread_events
         WHERE session_id = ?2
           AND thread_name = ?3
           AND thread_name != ?5
           AND created_at <= ?4
         ORDER BY id ASC",
        params![
            fork_session_id,
            source_session_id,
            thread_name,
            cutoff,
            ORCHESTRATOR_STEERING_TARGET
        ],
    )?;
    tx.execute(
        "INSERT INTO thread_steering
             (session_id, thread_name, dispatch_id, instruction, status,
              created_at, claimed_at, delivered_at, expired_at)
         SELECT ?1, thread_name, dispatch_id, instruction, status,
                created_at, claimed_at, delivered_at, expired_at
         FROM thread_steering
         WHERE session_id = ?2 AND thread_name = ?3 AND created_at <= ?4
         ORDER BY id ASC",
        params![fork_session_id, source_session_id, thread_name, cutoff],
    )?;
    Ok(())
}

fn clone_thread_rows_for_dispatches(
    tx: &Transaction<'_>,
    source_session_id: &str,
    fork_session_id: &str,
    thread_name: &str,
    episode_limit: i64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO episodes (thread_name, session_id, action, content, status, created_at)
         SELECT thread_name, ?1, action, content, status, created_at
         FROM episodes
         WHERE session_id = ?2 AND thread_name = ?3
         ORDER BY id ASC
         LIMIT ?4",
        params![
            fork_session_id,
            source_session_id,
            thread_name,
            episode_limit
        ],
    )?;
    tx.execute(
        "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
         SELECT ?1, src.thread_name, src.event_json, src.created_at
         FROM thread_events src
         WHERE src.session_id = ?2
           AND src.thread_name = ?3
           AND src.thread_name != ?5
           AND (
               SELECT COUNT(*)
               FROM thread_events started
               WHERE started.session_id = src.session_id
                 AND started.thread_name = src.thread_name
                 AND started.id <= src.id
                 AND json_extract(started.event_json, '$.type') = 'thread_started'
           ) <= ?4
         ORDER BY src.id ASC",
        params![
            fork_session_id,
            source_session_id,
            thread_name,
            episode_limit,
            ORCHESTRATOR_STEERING_TARGET
        ],
    )?;
    tx.execute(
        "INSERT INTO thread_steering
             (session_id, thread_name, dispatch_id, instruction, status,
              created_at, claimed_at, delivered_at, expired_at)
         SELECT ?1, thread_name, dispatch_id, instruction, status,
                created_at, claimed_at, delivered_at, expired_at
         FROM thread_steering
         WHERE session_id = ?2 AND thread_name = ?3
           AND created_at <= COALESCE(
               (SELECT MAX(created_at)
                FROM thread_events
                WHERE session_id = ?1 AND thread_name = ?3),
               (SELECT MAX(created_at)
                FROM episodes
                WHERE session_id = ?1 AND thread_name = ?3)
           )
         ORDER BY id ASC",
        params![fork_session_id, source_session_id, thread_name],
    )?;
    Ok(())
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

#[derive(Default)]
struct PrefixArtifacts {
    threads: BTreeMap<String, ThreadPrefix>,
    workset_ids: BTreeSet<String>,
}

#[derive(Default)]
struct ThreadPrefix {
    dispatch_count: usize,
}

fn prefix_conversation_artifacts(prefix: &[Message]) -> PrefixArtifacts {
    let mut artifacts = PrefixArtifacts::default();
    for message in prefix {
        let Message::Assistant {
            tool_calls: Some(tool_calls),
            ..
        } = message
        else {
            continue;
        };
        for call in tool_calls {
            let arguments = serde_json::from_str::<serde_json::Value>(&call.function.arguments)
                .unwrap_or(serde_json::Value::Null);
            match call.function.name.as_str() {
                "thread" => {
                    if let Some(name) = json_nonempty_str(&arguments, "name") {
                        artifacts.threads.entry(name).or_default().dispatch_count += 1;
                    }
                    if let Some(sources) =
                        arguments.get("threads").and_then(|value| value.as_array())
                    {
                        for source in sources {
                            if let Some(name) = source
                                .as_str()
                                .map(str::trim)
                                .filter(|name| !name.is_empty())
                            {
                                remember_thread(&mut artifacts, name);
                            }
                        }
                    }
                }
                "thread_read" => {
                    if let Some(name) = json_nonempty_str(&arguments, "name") {
                        remember_thread(&mut artifacts, &name);
                    }
                }
                "thread_delete" => {
                    if let Some(name) = json_nonempty_str(&arguments, "name") {
                        artifacts.threads.remove(&name);
                    }
                }
                "workset_define" | "workset_read" => {
                    if let Some(id) = json_nonempty_str(&arguments, "id") {
                        artifacts.workset_ids.insert(id);
                    }
                }
                _ => {}
            }
        }
    }
    artifacts.threads.remove(ORCHESTRATOR_STEERING_TARGET);
    artifacts
}

fn remember_thread(artifacts: &mut PrefixArtifacts, name: &str) {
    if name == ORCHESTRATOR_STEERING_TARGET {
        return;
    }
    artifacts.threads.entry(name.to_string()).or_default();
}

fn json_nonempty_str(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
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
