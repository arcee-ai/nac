//! Orchestrator transcript log primitives — step 1 of the DB-direct
//! transcript workset (research/guidance-persistence). Everything here except
//! [`is_transcript_log_payload`] is dead code until step 2 wires the agent
//! loop to it, so the writer and payload codecs are gated behind
//! `test`/`test-support`, matching the `append_thread_event` precedent.
//!
//! # Storage
//!
//! The orchestrator transcript is an append-only log in the existing
//! `thread_events` table: one row per transcript message, written under the
//! reserved thread name `__orchestrator__` (`ORCHESTRATOR_STEERING_TARGET`).
//! No schema change: the table already has the needed shape (session_id FK,
//! thread_name, event_json, created_at) and index (session_id, thread_name,
//! id).
//!
//! # Payload format (load-bearing)
//!
//! `event_json` for a transcript row is exactly:
//!
//! ```json
//! {"nac_transcript_message":{"idx":7,"kind":"assistant","message":"{\"role\":\"assistant\",\"content\":\"...\"}"}}
//! ```
//!
//! - `idx` — absolute transcript position (the same value as the message's
//!   index in the agent's in-memory `Vec<Message>`). Monotonic with row id
//!   under the single-writer invariant below.
//! - `kind` — `"system" | "user" | "assistant" | "tool"`. Lets future
//!   prefix-digest streaming skip System rows without parsing `message`
//!   (`source_prefix_digest` in agent/compaction/planning.rs filters System).
//! - `message` — the CANONICAL message bytes: exactly
//!   `serde_json::to_vec(&Message)`, stored as a JSON string. Future digest
//!   streaming hashes these stored bytes directly (length-prefixed, matching
//!   `update_bytes` in planning.rs) with no parse/re-serialize. A nested JSON
//!   object would NOT be byte-stable (serde_json map ordering is not
//!   guaranteed to match struct field order), so the string embedding is
//!   deliberate — do not "pretty up" this format.
//!
//! The payload is deliberately NOT an `AgentEvent`: it carries no `type` tag,
//! so `AgentEvent` decoding fails on it (defense-in-depth — the event/tile
//! paths and the AgentEvent sanitize-drop migration must never treat these
//! rows as events).
//!
//! # Invariants
//!
//! - Single writer per session (the session operation lease serializes runs).
//! - Append-only except `TranscriptLogWriter::delete_from`, which truncates a
//!   tail range (`idx >= from_idx`) for crash/cancel normalization.
//! - `idx` values are contiguous from 0 and increase by one per append.
//!   Enforcement lives in the step-2 Transcript abstraction, not in these
//!   primitives.
//!
//! # Guards (landed with this step)
//!
//! 1. `load_all_thread_events` / `load_thread_events_page` exclude
//!    `__orchestrator__` rows in SQL (thread_events.rs), so transcript rows
//!    never enter the event/tile paths.
//! 2. `migrate_thread_events` (schema.rs) carries transcript rows through
//!    table rebuilds verbatim via [`is_transcript_log_payload`]; a schema test
//!    pins survival. Any future rebuild-migration of thread_events MUST do
//!    the same.
//! 3. `store::delete_thread` rejects the reserved name before any DELETE
//!    (threads.rs), so a model-callable `thread_delete("__orchestrator__")`
//!    cannot wipe the transcript tail.

#[cfg(any(test, feature = "test-support"))]
use super::*;

/// Top-level JSON key identifying a transcript log row in `thread_events`.
pub const TRANSCRIPT_PAYLOAD_KEY: &str = "nac_transcript_message";

/// Conservative predicate: true when a `thread_events` payload claims to be a
/// transcript log entry. Used by `migrate_thread_events` (schema.rs) to carry
/// transcript rows through table rebuilds verbatim instead of running them
/// through AgentEvent sanitize-drop. Deliberately loose — preserving a row
/// that merely claims to be a transcript entry is safe, while dropping a real
/// one destroys the orchestrator transcript. Full validation happens in
/// `decode_transcript_log_entry`.
pub fn is_transcript_log_payload(event_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(event_json)
        .ok()
        .map_or(false, |value| {
            value
                .get(TRANSCRIPT_PAYLOAD_KEY)
                .map_or(false, |entry| entry.is_object())
        })
}

#[cfg(any(test, feature = "test-support"))]
use crate::types::Message;
#[cfg(any(test, feature = "test-support"))]
use std::sync::Mutex;

/// Role tag stored beside the canonical message bytes so future prefix-digest
/// streaming can skip System rows without parsing them.
#[cfg(any(test, feature = "test-support"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptMessageKind {
    System,
    User,
    Assistant,
    Tool,
}

#[cfg(any(test, feature = "test-support"))]
impl TranscriptMessageKind {
    fn of(message: &Message) -> Self {
        match message {
            Message::System { .. } => Self::System,
            Message::User { .. } => Self::User,
            Message::Assistant { .. } => Self::Assistant,
            Message::Tool { .. } => Self::Tool,
        }
    }
}

/// Decoded transcript log entry. `message_json` is byte-identical to
/// `serde_json::to_vec(&Message)` — see the module docs for why that is
/// load-bearing. The wire field name is `message`.
#[cfg(any(test, feature = "test-support"))]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TranscriptLogEntry {
    pub idx: u64,
    pub kind: TranscriptMessageKind,
    #[serde(rename = "message")]
    pub message_json: String,
}

#[cfg(any(test, feature = "test-support"))]
#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct TranscriptLogPayload {
    nac_transcript_message: TranscriptLogEntry,
}

/// Encode one transcript log row payload (see the module docs for the exact
/// wire format).
#[cfg(any(test, feature = "test-support"))]
pub fn encode_transcript_log_entry(idx: u64, message: &Message) -> Result<String> {
    let canonical =
        serde_json::to_vec(message).context("failed to serialize transcript message")?;
    let message_json =
        String::from_utf8(canonical).context("transcript message JSON was not UTF-8")?;
    serde_json::to_string(&TranscriptLogPayload {
        nac_transcript_message: TranscriptLogEntry {
            idx,
            kind: TranscriptMessageKind::of(message),
            message_json,
        },
    })
    .context("failed to encode transcript log payload")
}

/// Fully decode a transcript log row payload. Returns `None` when the payload
/// is not a transcript row (e.g. a regular `AgentEvent` row).
#[cfg(any(test, feature = "test-support"))]
pub fn decode_transcript_log_entry(event_json: &str) -> Option<TranscriptLogEntry> {
    serde_json::from_str::<TranscriptLogPayload>(event_json)
        .ok()
        .map(|payload| payload.nac_transcript_message)
}

/// Dedicated writer/reader for the transcript log. Owns its connection, same
/// shape as `ThreadEventWriter`. All methods are synchronous and the writer is
/// Send + Sync, so every method is usable inside `tokio::task::spawn_blocking`.
///
/// Callers must uphold the module-level invariants: one writer per session,
/// `idx` contiguous and increasing per append.
#[cfg(any(test, feature = "test-support"))]
pub struct TranscriptLogWriter {
    connection: Mutex<Connection>,
}

#[cfg(any(test, feature = "test-support"))]
impl TranscriptLogWriter {
    pub fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            connection: Mutex::new(open_runtime_connection(path)?),
        })
    }

    /// Append `message` at absolute transcript position `idx`.
    pub fn append(&self, session_id: &str, idx: u64, message: &Message) -> Result<()> {
        let event_json = encode_transcript_log_entry(idx, message)?;
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        connection.execute(
            "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session_id,
                ORCHESTRATOR_STEERING_TARGET,
                event_json,
                now_utc()
            ],
        )?;
        Ok(())
    }

    /// Read committed entries with `idx >= from_idx`, in log (append) order.
    /// A row under the reserved name that does not decode as a transcript
    /// entry is corruption and fails the read loudly.
    pub fn read_from(&self, session_id: &str, from_idx: u64) -> Result<Vec<(u64, Message)>> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut statement = connection.prepare(
            "SELECT id, event_json
             FROM thread_events
             WHERE session_id = ?1 AND thread_name = ?2
             ORDER BY id ASC",
        )?;
        let rows = statement
            .query_map(params![session_id, ORCHESTRATOR_STEERING_TARGET], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?;
        let mut entries = Vec::new();
        for row in rows {
            let (id, event_json) = row?;
            let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
                anyhow!(
                    "thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
                )
            })?;
            if entry.idx < from_idx {
                continue;
            }
            let message: Message =
                serde_json::from_str(&entry.message_json).with_context(|| {
                    format!("thread_events row {id} holds an undecodable transcript message")
                })?;
            entries.push((entry.idx, message));
        }
        Ok(entries)
    }

    /// Delete committed entries with `idx >= from_idx` (tail truncation for
    /// crash/cancel normalization). Returns the number of deleted rows.
    /// Infrequent path: the idx values live inside the JSON payloads, so this
    /// scans the session's transcript rows and deletes by row id.
    pub fn delete_from(&self, session_id: &str, from_idx: u64) -> Result<usize> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let row_ids = {
            let mut statement = transaction.prepare(
                "SELECT id, event_json
                 FROM thread_events
                 WHERE session_id = ?1 AND thread_name = ?2
                 ORDER BY id ASC",
            )?;
            let rows = statement
                .query_map(params![session_id, ORCHESTRATOR_STEERING_TARGET], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })?;
            let mut row_ids = Vec::new();
            for row in rows {
                let (id, event_json) = row?;
                let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
                    anyhow!(
                        "thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
                    )
                })?;
                if entry.idx >= from_idx {
                    row_ids.push(id);
                }
            }
            row_ids
        };
        for id in &row_ids {
            transaction.execute("DELETE FROM thread_events WHERE id = ?1", params![id])?;
        }
        transaction.commit()?;
        Ok(row_ids.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_transcript_{label}_{unique}"))
            .join("store.db")
    }

    fn canonical(message: &Message) -> Vec<u8> {
        serde_json::to_vec(message).unwrap()
    }

    fn sample_messages() -> Vec<Message> {
        vec![
            Message::System {
                content: "system head".to_string(),
            },
            Message::User {
                content: "prompt".to_string(),
            },
            Message::Assistant {
                content: Some("answer".to_string()),
                reasoning_text: Some("thinking".to_string()),
                reasoning_details: None,
                tool_calls: Some(vec![crate::types::ToolCall {
                    id: "call-1".to_string(),
                    call_type: "function".to_string(),
                    function: crate::types::FunctionCall {
                        name: "read".to_string(),
                        arguments: "{\"path\":\"x\"}".to_string(),
                    },
                }]),
            },
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "tool output".to_string(),
            },
        ]
    }

    #[test]
    fn payload_stores_canonical_message_bytes_and_kind_tag() {
        for (message, kind, wire_kind) in [
            (
                Message::System {
                    content: "s".to_string(),
                },
                TranscriptMessageKind::System,
                "system",
            ),
            (
                Message::User {
                    content: "u".to_string(),
                },
                TranscriptMessageKind::User,
                "user",
            ),
            (
                Message::Assistant {
                    content: Some("a".to_string()),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls: None,
                },
                TranscriptMessageKind::Assistant,
                "assistant",
            ),
            (
                Message::Tool {
                    tool_call_id: "c".to_string(),
                    content: "t".to_string(),
                },
                TranscriptMessageKind::Tool,
                "tool",
            ),
        ] {
            let payload = encode_transcript_log_entry(7, &message).unwrap();
            assert!(payload.contains(&format!("\"{TRANSCRIPT_PAYLOAD_KEY}\":")));
            assert!(payload.contains(&format!("\"kind\":\"{wire_kind}\"")));
            let entry = decode_transcript_log_entry(&payload).unwrap();
            assert_eq!(entry.idx, 7);
            assert_eq!(entry.kind, kind);
            assert_eq!(entry.message_json.as_bytes(), canonical(&message));
        }
    }

    #[test]
    fn transcript_payload_is_not_an_agent_event_and_vice_versa() {
        let payload = encode_transcript_log_entry(
            0,
            &Message::User {
                content: "hi".to_string(),
            },
        )
        .unwrap();
        // Defense-in-depth: the payload must fail AgentEvent decoding so the
        // event/tile paths and sanitize-drop migration never treat it as an
        // event.
        assert!(serde_json::from_str::<crate::events::AgentEvent>(&payload).is_err());
        assert!(is_transcript_log_payload(&payload));

        let event = crate::events::AgentEvent::RunStarted {
            thread_name: None,
            prompt_preview: "run started".to_string(),
        };
        let event_json = serde_json::to_string(&event).unwrap();
        assert!(decode_transcript_log_entry(&event_json).is_none());
        assert!(!is_transcript_log_payload(&event_json));
        assert!(!is_transcript_log_payload("{malformed"));
    }

    #[test]
    fn transcript_log_appends_read_back_in_order_with_tail_ranges() {
        let path = temp_store_path("round_trip");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");

        let writer = TranscriptLogWriter::new(&path).unwrap();
        let messages = sample_messages();
        for (idx, message) in messages.iter().enumerate() {
            writer.append("session-a", idx as u64, message).unwrap();
        }
        writer
            .append(
                "session-b",
                0,
                &Message::User {
                    content: "other session".to_string(),
                },
            )
            .unwrap();

        let all = writer.read_from("session-a", 0).unwrap();
        assert_eq!(all.len(), messages.len());
        for (position, ((idx, read), expected)) in all.iter().zip(messages.iter()).enumerate() {
            assert_eq!(*idx as usize, position);
            assert_eq!(canonical(read), canonical(expected));
        }

        let tail = writer.read_from("session-a", 2).unwrap();
        assert_eq!(tail.len(), 2);
        assert_eq!(tail[0].0, 2);
        assert_eq!(canonical(&tail[0].1), canonical(&messages[2]));
        assert_eq!(tail[1].0, 3);

        assert!(writer.read_from("session-a", 4).unwrap().is_empty());
        assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 1);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_delete_from_truncates_tail_and_isolates_sessions() {
        let path = temp_store_path("delete_from");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");

        let writer = TranscriptLogWriter::new(&path).unwrap();
        for (idx, message) in sample_messages().iter().enumerate() {
            writer.append("session-a", idx as u64, message).unwrap();
            writer.append("session-b", idx as u64, message).unwrap();
        }

        assert_eq!(writer.delete_from("session-a", 2).unwrap(), 2);
        let remaining = writer.read_from("session-a", 0).unwrap();
        assert_eq!(remaining.len(), 2);
        assert_eq!(remaining[0].0, 0);
        assert_eq!(remaining[1].0, 1);

        // Beyond-the-end truncation is a no-op; other sessions are untouched.
        assert_eq!(writer.delete_from("session-a", 99).unwrap(), 0);
        assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 4);

        assert_eq!(writer.delete_from("session-a", 0).unwrap(), 2);
        assert!(writer.read_from("session-a", 0).unwrap().is_empty());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_reads_fail_loudly_on_foreign_rows() {
        let path = temp_store_path("foreign_rows");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");

        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append(
                "session-a",
                0,
                &Message::User {
                    content: "prompt".to_string(),
                },
            )
            .unwrap();
        // A non-transcript row under the reserved name is corruption.
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            "{\"type\":\"run_started\",\"prompt_preview\":\"run started\"}",
        )
        .unwrap();

        assert!(writer.read_from("session-a", 0).is_err());
        assert!(writer.delete_from("session-a", 1).is_err());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_writer_is_send_sync_for_spawn_blocking() {
        fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<TranscriptLogWriter>();
    }
}
