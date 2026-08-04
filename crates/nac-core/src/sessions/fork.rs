use std::fmt;
use std::path::Path;

use anyhow::{anyhow, Context};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

use crate::store::{
    decode_transcript_log_entry, now_utc, open_connection, ORCHESTRATOR_STEERING_TARGET,
};
use crate::types::Message;

use super::SessionForkLineage;

struct SourceRow {
    cwd: String,
    model: String,
    base_url: String,
    backend: Option<String>,
    reasoning_effort: Option<String>,
    sandbox_json: Option<String>,
    messages_json: String,
    host_id: Option<String>,
    api_key_env: Option<String>,
    extra_headers_json: Option<String>,
    orchestrator_compaction_threshold: Option<u64>,
}

/// Canonical transcript boundary for a fork. `AfterAssistant(n)` selects the
/// completed assistant message at raw canonical index `n`. The next canonical
/// message must be a user message; the child copies messages `0..=n` only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionForkBoundary {
    AfterAssistant(u64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionForkResult {
    pub session_id: String,
    pub source_session_id: String,
    pub copied_message_count: usize,
    pub source_message_count: usize,
    pub created_at: String,
}

#[derive(Debug)]
pub enum SessionForkError {
    InvalidInput(String),
    NotFound(String),
    Conflict(String),
    Store(anyhow::Error),
}

impl fmt::Display for SessionForkError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(message) | Self::NotFound(message) | Self::Conflict(message) => {
                formatter.write_str(message)
            }
            Self::Store(error) => write!(formatter, "session fork storage failed: {error}"),
        }
    }
}

impl std::error::Error for SessionForkError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for SessionForkError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(error.into())
    }
}

impl From<anyhow::Error> for SessionForkError {
    fn from(error: anyhow::Error) -> Self {
        Self::Store(error)
    }
}

/// Atomically creates `session_id` from a canonical prefix of `source_session_id`.
///
/// The child stores the whole selected prefix in `messages_json`; no transcript
/// rows, worker state, events, checkpoints, worksets, metrics, or other runtime
/// state are copied. Durable execution configuration is copied, while its CAS
/// revision and all run metrics start fresh.
pub fn fork_session(
    path: &Path,
    source_session_id: &str,
    session_id: &str,
    boundary: SessionForkBoundary,
) -> Result<SessionForkResult, SessionForkError> {
    if source_session_id.trim().is_empty() || session_id.trim().is_empty() {
        return Err(SessionForkError::InvalidInput(
            "source and child session IDs must not be empty".to_string(),
        ));
    }
    if source_session_id == session_id {
        return Err(SessionForkError::InvalidInput(
            "a session cannot be forked onto itself".to_string(),
        ));
    }

    let mut connection = open_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;

    let source = transaction
        .query_row(
            "SELECT cwd, model, base_url, backend, reasoning_effort, sandbox_json,
                    messages_json, host_id, api_key_env, extra_headers_json,
                    orchestrator_compaction_threshold
             FROM sessions WHERE session_id = ?1",
            params![source_session_id],
            |row| {
                Ok(SourceRow {
                    cwd: row.get(0)?,
                    model: row.get(1)?,
                    base_url: row.get(2)?,
                    backend: row.get(3)?,
                    reasoning_effort: row.get(4)?,
                    sandbox_json: row.get(5)?,
                    messages_json: row.get(6)?,
                    host_id: row.get(7)?,
                    api_key_env: row.get(8)?,
                    extra_headers_json: row.get(9)?,
                    orchestrator_compaction_threshold: row.get(10)?,
                })
            },
        )
        .optional()?;
    let Some(source) = source else {
        return Err(SessionForkError::NotFound(format!(
            "source session '{source_session_id}' was not found"
        )));
    };

    let child_exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
        params![session_id],
        |row| row.get(0),
    )?;
    if child_exists {
        return Err(SessionForkError::Conflict(format!(
            "session '{session_id}' already exists"
        )));
    }

    let mut messages: Vec<Message> =
        serde_json::from_str(&source.messages_json).with_context(|| {
            format!("source session '{source_session_id}' has invalid messages_json")
        })?;
    let blob_len = u64::try_from(messages.len())
        .map_err(|_| anyhow!("source transcript length overflowed"))?;
    let mut expected_idx = blob_len;
    let mut statement = transaction.prepare(
        "SELECT id, event_json FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2 ORDER BY id ASC",
    )?;
    let rows = statement.query_map(
        params![source_session_id, ORCHESTRATOR_STEERING_TARGET],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    )?;
    for row in rows {
        let (row_id, event_json) = row?;
        let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
            anyhow!(
                "thread_events row {row_id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
            )
        })?;
        if entry.idx < blob_len {
            continue;
        }
        if entry.idx != expected_idx {
            return Err(anyhow!(
                "source transcript log is not contiguous: expected idx {expected_idx}, found {}",
                entry.idx
            )
            .into());
        }
        let message = serde_json::from_str(&entry.message_json).with_context(|| {
            format!("thread_events row {row_id} holds an undecodable transcript message")
        })?;
        messages.push(message);
        expected_idx += 1;
    }
    drop(statement);

    let source_message_count = messages.len();
    let SessionForkBoundary::AfterAssistant(index) = boundary;
    let index = usize::try_from(index).map_err(|_| {
        SessionForkError::InvalidInput("assistant boundary is too large".to_string())
    })?;
    let successor_index = index.checked_add(1).ok_or_else(|| {
        SessionForkError::InvalidInput("assistant boundary overflowed".to_string())
    })?;
    let selected = messages.get(index).ok_or_else(|| {
        SessionForkError::InvalidInput(format!(
            "assistant boundary {index} is outside source transcript of {source_message_count} messages"
        ))
    })?;
    let successor = messages.get(successor_index).ok_or_else(|| {
        SessionForkError::InvalidInput(format!(
            "assistant boundary {index} has no following canonical user message"
        ))
    })?;
    if !matches!(selected, Message::Assistant { .. }) {
        return Err(SessionForkError::InvalidInput(format!(
            "canonical message {index} is not an assistant message"
        )));
    }
    if !matches!(successor, Message::User { .. }) {
        return Err(SessionForkError::InvalidInput(format!(
            "canonical message {index} is not immediately followed by a user message"
        )));
    }

    let copied_message_count = successor_index;
    let prefix = &messages[..copied_message_count];
    validate_protocol_boundary(prefix)?;
    let messages_json =
        serde_json::to_string(prefix).context("failed to serialize forked session messages")?;
    let created_at = now_utc();

    transaction.execute(
        "INSERT INTO sessions (
             session_id, cwd, store_path, model, base_url, backend,
             reasoning_effort, sandbox_json, messages_json,
             last_response_duration_ms, previous_response_duration_ms,
             response_durations_ms_json, created_at, updated_at, host_id,
             api_key_env, extra_headers_json, token_usages_json, config_version,
             orchestrator_compaction_threshold
         ) VALUES (
             ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9,
             NULL, NULL, NULL, ?10, ?10, ?11, ?12, ?13, NULL, 0, ?14
         )",
        params![
            session_id,
            source.cwd,
            path.display().to_string(),
            source.model,
            source.base_url,
            source.backend,
            source.reasoning_effort,
            source.sandbox_json,
            messages_json,
            created_at,
            source.host_id,
            source.api_key_env,
            source.extra_headers_json,
            source.orchestrator_compaction_threshold,
        ],
    )?;
    transaction.execute(
        "INSERT INTO session_presentations
             (session_id, title, pinned, sort_order, version)
         VALUES (?1, NULL, 0, 0, 0)",
        params![session_id],
    )?;
    transaction.execute(
        "INSERT INTO session_forks
             (session_id, source_session_id, copied_message_count,
              source_message_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            session_id,
            source_session_id,
            i64::try_from(copied_message_count)
                .map_err(|_| anyhow!("copied transcript length overflowed"))?,
            i64::try_from(source_message_count)
                .map_err(|_| anyhow!("source transcript length overflowed"))?,
            created_at,
        ],
    )?;
    transaction.commit()?;

    Ok(SessionForkResult {
        session_id: session_id.to_string(),
        source_session_id: source_session_id.to_string(),
        copied_message_count,
        source_message_count,
        created_at,
    })
}

fn validate_protocol_boundary(messages: &[Message]) -> Result<(), SessionForkError> {
    let mut outstanding: Option<Vec<&str>> = None;
    for message in messages {
        match message {
            Message::Assistant {
                tool_calls: Some(calls),
                ..
            } if !calls.is_empty() => {
                if outstanding.is_some() {
                    return Err(SessionForkError::InvalidInput(
                        "fork boundary crosses an incomplete assistant tool-call turn".to_string(),
                    ));
                }
                let mut ids = Vec::with_capacity(calls.len());
                for call in calls {
                    if ids.contains(&call.id.as_str()) {
                        return Err(SessionForkError::InvalidInput(format!(
                            "assistant tool-call turn contains duplicate ID '{}'",
                            call.id
                        )));
                    }
                    ids.push(call.id.as_str());
                }
                outstanding = Some(ids);
            }
            Message::Tool { tool_call_id, .. } => {
                let Some(ids) = outstanding.as_mut() else {
                    return Err(SessionForkError::InvalidInput(format!(
                        "tool result '{tool_call_id}' has no preceding assistant tool call"
                    )));
                };
                let Some(position) = ids.iter().position(|id| *id == tool_call_id) else {
                    return Err(SessionForkError::InvalidInput(format!(
                        "tool result '{tool_call_id}' does not match an outstanding tool call"
                    )));
                };
                ids.remove(position);
                if ids.is_empty() {
                    outstanding = None;
                }
            }
            _ if outstanding.is_some() => {
                return Err(SessionForkError::InvalidInput(
                    "fork boundary crosses an incomplete assistant tool-call turn".to_string(),
                ));
            }
            _ => {}
        }
    }
    if outstanding.is_some() {
        return Err(SessionForkError::InvalidInput(
            "fork boundary ends inside an assistant tool-call turn".to_string(),
        ));
    }
    Ok(())
}

impl From<SessionForkResult> for SessionForkLineage {
    fn from(result: SessionForkResult) -> Self {
        Self {
            session_id: result.session_id,
            source_session_id: result.source_session_id,
            copied_message_count: result.copied_message_count,
            source_message_count: result.source_message_count,
            created_at: result.created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BackendKind;
    use crate::sessions::{create_session, load_session, load_session_fork, new_snapshot};
    use crate::store::TranscriptLogWriter;
    use crate::types::{FunctionCall, ToolCall};
    use std::collections::BTreeMap;
    use std::path::PathBuf;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_fork_{label}_{unique}"))
            .join("store.db")
    }

    fn user(content: &str) -> Message {
        Message::User {
            content: content.to_string(),
        }
    }

    fn assistant(content: &str) -> Message {
        Message::Assistant {
            content: Some(content.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
        }
    }

    fn tool_assistant(ids: &[&str]) -> Message {
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(
                ids.iter()
                    .map(|id| ToolCall {
                        id: (*id).to_string(),
                        call_type: "function".to_string(),
                        function: FunctionCall {
                            name: "read".to_string(),
                            arguments: "{}".to_string(),
                        },
                    })
                    .collect(),
            ),
        }
    }

    fn source(path: &Path, messages: Vec<Message>) {
        let mut snapshot = new_snapshot(
            "source".to_string(),
            PathBuf::from("/repo"),
            "model".to_string(),
            "https://example.invalid".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            Some("host".to_string()),
            messages,
            Some("API_KEY".to_string()),
            BTreeMap::from([("x-safe".to_string(), "yes".to_string())]),
        );
        snapshot.config_version = 7;
        snapshot.orchestrator_compaction_threshold = Some(1234);
        snapshot.last_response_duration_ms = Some(50);
        snapshot.token_usages = vec![None];
        create_session(path, &snapshot).unwrap();
    }

    #[test]
    fn assistant_boundary_merges_blob_and_log_and_copies_only_safe_session_state() {
        let path = temp_store_path("merged_boundary");
        source(
            &path,
            vec![
                Message::System {
                    content: "system".into(),
                },
                user("one"),
            ],
        );
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch("source", 2, &[assistant("answer"), user("next")])
            .unwrap();
        let result = fork_session(
            &path,
            "source",
            "child",
            SessionForkBoundary::AfterAssistant(2),
        )
        .unwrap();
        assert_eq!(
            (result.copied_message_count, result.source_message_count),
            (3, 4)
        );

        let child = load_session(&path, "child").unwrap();
        assert_eq!(child.messages.len(), 3);
        assert_eq!(child.cwd, PathBuf::from("/repo"));
        assert_eq!(child.api_key_env.as_deref(), Some("API_KEY"));
        assert_eq!(child.orchestrator_compaction_threshold, Some(1234));
        assert_eq!(child.config_version, 0);
        assert_eq!(child.last_response_duration_ms, None);
        assert!(child.token_usages.is_empty());
        assert_eq!(
            load_session_fork(&path, "child")
                .unwrap()
                .unwrap()
                .copied_message_count,
            3
        );

        let conn = open_connection(&path).unwrap();
        let presentation: (i64, i64, i64) = conn.query_row(
            "SELECT pinned, sort_order, version FROM session_presentations WHERE session_id='child'",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(presentation, (0, 0, 0));
        for table in [
            "thread_events",
            "threads",
            "worksets",
            "orchestrator_compaction_checkpoints",
        ] {
            let count: i64 = conn
                .query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE session_id='child'"),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "copied auxiliary rows from {table}");
        }
    }

    #[test]
    fn assistant_boundary_serializes_only_through_selected_assistant() {
        let path = temp_store_path("boundary");
        source(
            &path,
            vec![
                Message::System {
                    content: "system".into(),
                },
                user("one"),
            ],
        );
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "source",
                2,
                &[assistant("one"), user("two"), assistant("two")],
            )
            .unwrap();
        let result = fork_session(
            &path,
            "source",
            "child",
            SessionForkBoundary::AfterAssistant(2),
        )
        .unwrap();
        assert_eq!(
            (result.copied_message_count, result.source_message_count),
            (3, 5)
        );
        assert_eq!(load_session(&path, "child").unwrap().messages.len(), 3);
    }

    #[test]
    fn accepts_protocol_complete_prefix_and_rejects_incomplete_tool_call_assistant() {
        let incomplete_path = temp_store_path("incomplete_protocol");
        source(
            &incomplete_path,
            vec![user("go"), tool_assistant(&["a"]), user("next")],
        );
        assert!(matches!(
            fork_session(
                &incomplete_path,
                "source",
                "child",
                SessionForkBoundary::AfterAssistant(1)
            ),
            Err(SessionForkError::InvalidInput(_))
        ));

        let complete_path = temp_store_path("complete_protocol");
        source(
            &complete_path,
            vec![
                user("go"),
                tool_assistant(&["a", "b"]),
                Message::Tool {
                    tool_call_id: "a".into(),
                    content: "A".into(),
                },
                Message::Tool {
                    tool_call_id: "b".into(),
                    content: "B".into(),
                },
                assistant("done"),
                user("next"),
            ],
        );
        fork_session(
            &complete_path,
            "source",
            "child",
            SessionForkBoundary::AfterAssistant(4),
        )
        .unwrap();

        let orphan_path = temp_store_path("orphan");
        source(
            &orphan_path,
            vec![
                Message::Tool {
                    tool_call_id: "x".into(),
                    content: "bad".into(),
                },
                assistant("done"),
                user("next"),
            ],
        );
        assert!(matches!(
            fork_session(
                &orphan_path,
                "source",
                "child",
                SessionForkBoundary::AfterAssistant(1)
            ),
            Err(SessionForkError::InvalidInput(_))
        ));
    }

    #[test]
    fn rejects_non_assistant_trailing_out_of_range_and_wrong_successor_boundaries_atomically() {
        let cases = [
            (
                "wrong_role",
                vec![user("one"), assistant("one"), user("two")],
                0,
            ),
            ("trailing", vec![user("one"), assistant("one")], 1),
            (
                "system_successor",
                vec![
                    user("one"),
                    assistant("one"),
                    Message::System {
                        content: "between".into(),
                    },
                    user("two"),
                ],
                1,
            ),
            (
                "tool_successor",
                vec![
                    user("one"),
                    assistant("one"),
                    Message::Tool {
                        tool_call_id: "x".into(),
                        content: "between".into(),
                    },
                    user("two"),
                ],
                1,
            ),
            (
                "assistant_successor",
                vec![user("one"), assistant("one"), assistant("two"), user("two")],
                1,
            ),
            (
                "out_of_range",
                vec![user("one"), assistant("one"), user("two")],
                9,
            ),
        ];

        for (label, messages, boundary) in cases {
            let path = temp_store_path(label);
            source(&path, messages);
            assert!(matches!(
                fork_session(
                    &path,
                    "source",
                    "child",
                    SessionForkBoundary::AfterAssistant(boundary)
                ),
                Err(SessionForkError::InvalidInput(_))
            ));
            assert!(
                load_session(&path, "child").is_err(),
                "child written for {label}"
            );
            assert!(load_session_fork(&path, "child").unwrap().is_none());
        }
    }

    #[test]
    fn typed_not_found_conflict_and_invalid_boundary_errors_leave_no_child() {
        let path = temp_store_path("typed");
        source(&path, vec![user("one"), assistant("one"), user("two")]);
        assert!(matches!(
            fork_session(
                &path,
                "missing",
                "x",
                SessionForkBoundary::AfterAssistant(1)
            ),
            Err(SessionForkError::NotFound(_))
        ));
        assert!(matches!(
            fork_session(
                &path,
                "source",
                "source",
                SessionForkBoundary::AfterAssistant(1)
            ),
            Err(SessionForkError::InvalidInput(_))
        ));
        assert!(matches!(
            fork_session(&path, "source", "x", SessionForkBoundary::AfterAssistant(9)),
            Err(SessionForkError::InvalidInput(_))
        ));
        fork_session(
            &path,
            "source",
            "child",
            SessionForkBoundary::AfterAssistant(1),
        )
        .unwrap();
        assert!(matches!(
            fork_session(
                &path,
                "source",
                "child",
                SessionForkBoundary::AfterAssistant(1)
            ),
            Err(SessionForkError::Conflict(_))
        ));
    }

    #[test]
    fn rolls_back_child_and_presentation_when_lineage_insert_fails() {
        let path = temp_store_path("rollback");
        source(&path, vec![user("one"), assistant("one"), user("two")]);
        let conn = open_connection(&path).unwrap();
        conn.execute_batch(
            "CREATE TRIGGER reject_fork_lineage BEFORE INSERT ON session_forks
             BEGIN SELECT RAISE(ABORT, 'injected lineage failure'); END;",
        )
        .unwrap();
        drop(conn);

        assert!(matches!(
            fork_session(
                &path,
                "source",
                "child",
                SessionForkBoundary::AfterAssistant(1)
            ),
            Err(SessionForkError::Store(_))
        ));
        let conn = open_connection(&path).unwrap();
        let sessions: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE session_id='child'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let presentations: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_presentations WHERE session_id='child'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!((sessions, presentations), (0, 0));
    }
}
