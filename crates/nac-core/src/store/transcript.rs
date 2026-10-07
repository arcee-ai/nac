//! Orchestrator transcript log — the DB-direct transcript workset
//! (research/guidance-persistence). Step 1 landed these primitives plus the
//! guards below; step 2 wired the agent loop to them (every orchestrator
//! message is appended here when it enters `Agent.messages`); step 3 made
//! the read paths store-backed; step 4 made the log the ONLY growing
//! transcript store (never-fold — see below).
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
//! - `idx` values are allocated or validated in the append transaction. The
//!   agent supplies its provider-view boundary and adopts messages only after
//!   commit. A durable receipt makes retries of the same identity idempotent.
//! - Admitted run writers retain live session-operation authority through the
//!   transaction and validate the durable run and relationship generation.
//! - Restore repairs a validly encoded non-contiguous tail by keeping its
//!   longest contiguous prefix and atomically deleting the untrusted physical
//!   suffix. Normal store-backed readers remain strict so corruption cannot
//!   silently reach the agent or UI.
//! - The log's first row is not necessarily index 0: initial system prompts
//!   enter the vector before logging and are carried by the snapshot blob.
//!
//! # Load path (step 2)
//!
//! Session restore is blob ++ log: the snapshot blob is authoritative for
//! `[0, blob_len)`, log rows with `idx >= blob_len` are the tail. Under
//! step 2-3's dual-write the tail was only a crashed run's rows (run end
//! folded it into the blob); since step 4 (never-fold) the tail is every
//! message after the write-once blob. An empty tail is exactly the pre-log
//! behavior. After the merge, `truncate_incomplete_tool_turn` trims
//! a dangling tool turn from the restored transcript and `delete_from`
//! removes the matching log tail (crash normalization). The session cancel
//! path performs the same normalization before appending its marker.
//!
//! # Store-backed read paths (step 3)
//!
//! The session service reads the transcript as blob ++ log ALWAYS (frontend
//! snapshots, message pages, steering coverage, message-cycle metadata), so
//! the chat is live mid-run. `read_from` stays the restore reader; the hot
//! paths use [`TranscriptLogWriter::read_tail_window`], which leverages
//! rowid order (= append order = `idx` order) to decode only O(page) rows.
//! Log rows are never `System` messages: the system head enters the vec at
//! construction, before any logging, and no commit point logs one — so every
//! tail row is a visible message, which keeps the visible↔raw index mapping
//! a constant offset (`blob_visible = blob_len - system_head_len`).
//!
//! # Run end and summaries (step 4 — never-fold)
//!
//! Run end performs NO `messages_json` rewrite: the snapshot blob is
//! write-once (the system head ++ the legacy prefix a resumed session
//! carried in) and the transcript lives here, appends-only forever. The
//! run-end token/timing bookkeeping diffs store-backed visible-response
//! counts (run start vs run end) and `sessions::save_session_run_state`
//! UPDATEs only run-state columns. Session summaries (visible message count,
//! last user prompt) are materialized on `sessions`: append updates them in
//! the same transaction as the log rows, while tail truncation rebuilds them
//! from blob ++ remaining log. The polling read path therefore never scans
//! transcript history. DOWNGRADE CAVEAT (accepted by the user): a build older
//! than the transcript-log workset reads only `messages_json`, so it shows
//! this store's history truncated to the head/legacy prefix — invisibility,
//! not corruption; the log rows are untouched and a current build reads the
//! full transcript again.
//!
//! # Guards (landed with step 1)
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
        .is_some_and(|value| {
            value
                .get(TRANSCRIPT_PAYLOAD_KEY)
                .is_some_and(serde_json::Value::is_object)
        })
}

use crate::types::Message;
use std::sync::Mutex;

/// Role tag stored beside the canonical message bytes so future prefix-digest
/// streaming can skip System rows without parsing them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptMessageKind {
    System,
    User,
    Assistant,
    Tool,
}

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
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct TranscriptLogEntry {
    pub idx: u64,
    pub kind: TranscriptMessageKind,
    #[serde(rename = "message")]
    pub message_json: String,
}

/// Sanitized facts about one repaired non-contiguous transcript-log tail.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptLogRecovery {
    pub expected_idx: u64,
    pub found_idx: u64,
    pub discarded_rows: usize,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct TranscriptLogPayload {
    nac_transcript_message: TranscriptLogEntry,
}

/// Encode one transcript log row payload (see the module docs for the exact
/// wire format).
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
pub fn decode_transcript_log_entry(event_json: &str) -> Option<TranscriptLogEntry> {
    serde_json::from_str::<TranscriptLogPayload>(event_json)
        .ok()
        .map(|payload| payload.nac_transcript_message)
}

/// Visible-message count over one session's transcript-log tail beginning at
/// `from_idx`; rows already covered by the snapshot blob are ignored.
/// Session-summary migration and tail truncation use this to rebuild the
/// materialized count; the polling read path never scans the log.
pub fn count_visible_transcript_log_messages(
    conn: &Connection,
    session_id: &str,
    from_idx: u64,
) -> Result<usize> {
    let count = conn.query_row(
        "SELECT COUNT(*)
         FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2
           AND json_extract(event_json, '$.nac_transcript_message.idx') >= ?3
           AND (
               json_extract(event_json, '$.nac_transcript_message.kind') = 'user'
               OR (
                   json_extract(event_json, '$.nac_transcript_message.kind') = 'assistant'
                   AND json_extract(
                       json_extract(event_json, '$.nac_transcript_message.message'),
                       '$.content'
                   ) IS NOT NULL
                   AND COALESCE(
                       json_array_length(json_extract(
                           json_extract(event_json, '$.nac_transcript_message.message'),
                           '$.tool_calls'
                       )),
                       0
                   ) = 0
               )
           )",
        params![session_id, ORCHESTRATOR_STEERING_TARGET, from_idx],
        |row| row.get::<_, i64>(0),
    )?;
    usize::try_from(count).context("transcript log visible message count overflowed")
}

/// Most recent User message content in one session's transcript-log tail
/// beginning at `from_idx`; rows covered by the snapshot blob are ignored.
pub fn last_transcript_log_user_prompt(
    conn: &Connection,
    session_id: &str,
    from_idx: u64,
) -> Result<Option<String>> {
    conn.query_row(
        "SELECT json_extract(
             json_extract(event_json, '$.nac_transcript_message.message'),
             '$.content'
         )
         FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2
           AND json_extract(event_json, '$.nac_transcript_message.kind') = 'user'
           AND json_extract(event_json, '$.nac_transcript_message.idx') >= ?3
         ORDER BY id DESC
         LIMIT 1",
        params![session_id, ORCHESTRATOR_STEERING_TARGET, from_idx],
        |row| row.get::<_, Option<String>>(0),
    )
    .optional()
    .map(Option::flatten)
    .map_err(Into::into)
}

/// Ephemeral caller-owned gate for a run prompt's existing store transaction.
pub(crate) type RunPromptAdmission = dyn Fn(&dyn Fn() -> Result<()>) -> Result<()> + Send + Sync;

/// Dedicated path-backed writer/reader for the transcript log. Connections
/// are checked out only for the duration of each operation. All methods are
/// synchronous and the writer is Send + Sync, so every method is usable inside
/// `tokio::task::spawn_blocking`.
///
/// The transaction owns contiguity and replay. Standalone writes acquire a
/// session operation lease; admitted runs use an explicitly bound writer.
#[derive(Clone)]
pub struct TranscriptLogWriter {
    pub(super) store_path: PathBuf,
    pub(super) operation: std::sync::Arc<Mutex<()>>,
    pub(super) append_scope: String,
    #[cfg(test)]
    pub(super) append_fault:
        std::sync::Arc<Mutex<Option<(super::transcript_append::AppendFault, usize)>>>,
    #[cfg(test)]
    pub(super) append_barrier:
        std::sync::Arc<Mutex<Option<super::transcript_append::AppendBarrier>>>,
    #[cfg(test)]
    after_extent_read: std::sync::Arc<Mutex<Option<Box<dyn FnOnce() + Send>>>>,
    pub(super) append_fence: Option<super::transcript_append::RunAppendFence>,
    recovery_admission: Option<std::sync::Arc<super::MutationAdmission>>,
    pub(super) runtime_run_admission: Option<(
        std::sync::Arc<super::MutationAdmission>,
        std::sync::Arc<super::MutationAdmission>,
    )>,
}

/// Length of the log tail relative to a snapshot blob of `blob_len`, read from
/// the newest row's `idx`. Callers must use the same SQLite read transaction
/// for this probe and the window query; the object lock does not exclude peers.
fn tail_len_of(connection: &Connection, session_id: &str, blob_len: u64) -> Result<u64> {
    let mut statement = connection.prepare(
        "SELECT id, event_json
         FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2
         ORDER BY id DESC
         LIMIT 1",
    )?;
    let last_row = statement
        .query_row(params![session_id, ORCHESTRATOR_STEERING_TARGET], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .optional()?;
    match last_row {
        None => Ok(0),
        Some((id, event_json)) => {
            let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
                anyhow!(
                    "thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
                )
            })?;
            Ok((entry.idx + 1).saturating_sub(blob_len))
        }
    }
}

pub(super) fn next_append_idx(transaction: &Transaction<'_>, session_id: &str) -> Result<u64> {
    let blob_len = transaction.query_row(
        "SELECT json_array_length(messages_json)
         FROM sessions
         WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, i64>(0),
    )?;
    let blob_len =
        u64::try_from(blob_len).context("stored session transcript length was negative")?;
    let last_row = transaction
        .query_row(
            "SELECT id, event_json
             FROM thread_events
             WHERE session_id = ?1 AND thread_name = ?2
             ORDER BY id DESC
             LIMIT 1",
            params![session_id, ORCHESTRATOR_STEERING_TARGET],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let log_next_idx = match last_row {
        None => 0,
        Some((id, event_json)) => {
            let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
                anyhow!(
                    "thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
                )
            })?;
            entry
                .idx
                .checked_add(1)
                .context("transcript log index overflowed")?
        }
    };
    Ok(blob_len.max(log_next_idx))
}

pub(super) fn append_messages_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
    start_idx: u64,
    messages: &[Message],
) -> Result<i64> {
    let expected_start_idx = next_append_idx(transaction, session_id)?;
    if start_idx != expected_start_idx {
        return Err(
            super::transcript_append::TranscriptAppendError::PositionConflict {
                expected: expected_start_idx,
                found: start_idx,
            }
            .into(),
        );
    }
    let visible_delta = i64::try_from(crate::sessions::visible_message_count(messages))
        .context("transcript visible message count overflowed")?;
    let last_user_prompt = crate::sessions::last_user_prompt(messages);
    let mut last_inserted_id = 0;
    for (offset, message) in messages.iter().enumerate() {
        let event_json = encode_transcript_log_entry(start_idx + offset as u64, message)?;
        transaction.execute(
            "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session_id,
                ORCHESTRATOR_STEERING_TARGET,
                event_json,
                now_utc()
            ],
        )?;
        last_inserted_id = transaction.last_insert_rowid();
    }
    let updated = transaction.execute(
        "UPDATE sessions
         SET visible_message_count = visible_message_count + ?1,
             last_user_prompt = COALESCE(?2, last_user_prompt)
         WHERE session_id = ?3",
        params![visible_delta, last_user_prompt, session_id],
    )?;
    if updated != 1 {
        return Err(anyhow!(
            "transcript summary update expected one session row, updated {updated}"
        ));
    }
    Ok(last_inserted_id)
}

fn mark_inbox_item_delivered(
    transaction: &Transaction<'_>,
    session_id: &str,
    item_id: i64,
    run_id: &str,
    expected_content: &str,
) -> Result<()> {
    let now = now_utc();
    let changed = transaction.execute(
        "UPDATE session_inbox
         SET status = 'delivered', delivered_run_id = ?1, delivered_at = ?2,
             updated_at = ?2, version = version + 1
         WHERE session_id = ?3 AND id = ?4 AND status = 'pending'
           AND content = ?5",
        params![run_id, now, session_id, item_id, expected_content],
    )?;
    if changed != 1 {
        return Err(anyhow!(
            "inbox item {item_id} was changed or delivered before its transcript commit"
        ));
    }
    Ok(())
}

impl TranscriptLogWriter {
    pub fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            store_path: path.to_path_buf(),
            operation: std::sync::Arc::new(Mutex::new(())),
            append_scope: uuid::Uuid::new_v4().to_string(),
            append_fence: None,
            recovery_admission: None,
            runtime_run_admission: None,
            #[cfg(test)]
            append_fault: std::sync::Arc::new(Mutex::new(None)),
            #[cfg(test)]
            append_barrier: std::sync::Arc::new(Mutex::new(None)),
            #[cfg(test)]
            after_extent_read: std::sync::Arc::new(Mutex::new(None)),
        })
    }

    /// Only this ephemeral writer clone carries protected restore authority.
    /// Readback and terminal cleanup keep their ordinary, separate obligations.
    pub(crate) fn with_recovery_admission(
        mut self,
        admission: std::sync::Arc<super::MutationAdmission>,
    ) -> Self {
        self.recovery_admission = Some(admission);
        self
    }

    pub(crate) fn with_runtime_run_admission(
        mut self,
        current: std::sync::Arc<super::MutationAdmission>,
        initial_prompt: std::sync::Arc<super::MutationAdmission>,
    ) -> Self {
        self.runtime_run_admission = Some((current, initial_prompt));
        self
    }

    /// Append one message; the range and replay receipt share its transaction.
    pub fn append(&self, session_id: &str, idx: u64, message: &Message) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(),
            idx: u64 = idx,
            message: Message = message.clone(),
        }, call |command| command.writer.append(&command.session_id, command.idx, &command.message),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        self.append_batch(session_id, idx, std::slice::from_ref(message))
    }

    /// Validate a provider-view boundary and commit an atomic batch exactly once.
    pub fn append_batch(
        &self,
        session_id: &str,
        start_idx: u64,
        messages: &[Message],
    ) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(),
            start_idx: u64 = start_idx,
            messages: Vec<Message> = messages.to_vec(),
        }, call |command| command.writer.append_batch(&command.session_id, command.start_idx, &command.messages),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        if messages.is_empty() {
            return Ok(());
        }
        self.commit_append(
            session_id,
            &self.append_identity(start_idx, "batch"),
            Some(start_idx),
            messages,
            AppendPurpose::Messages,
            |_| Ok(()),
        )
        .map(|_| ())
    }

    /// Terminal cleanup may precede prompt commit. It still requires the live
    /// bound lease and current relationship generation; ordinary messages keep
    /// requiring the durable active run record.
    pub(crate) fn append_terminal_batch(
        &self,
        session_id: &str,
        start_idx: u64,
        messages: &[Message],
    ) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(),
            start_idx: u64 = start_idx,
            messages: Vec<Message> = messages.to_vec(),
        }, call |command| command.writer.append_terminal_batch(&command.session_id, command.start_idx, &command.messages),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        if messages.is_empty() {
            return Ok(());
        }
        if messages
            .iter()
            .any(|message| matches!(message, Message::User { .. } | Message::System { .. }))
        {
            anyhow::bail!("terminal cleanup cannot append a user or system message");
        }
        self.commit_append(
            session_id,
            &self.append_identity(start_idx, "terminal"),
            Some(start_idx),
            messages,
            AppendPurpose::Terminal,
            |_| Ok(()),
        )
        .map(|_| ())
    }

    /// Steering acknowledgement is an effect of the same identified commit.
    pub fn append_claimed_thread_steering(
        &self,
        session_id: &str,
        dispatch_id: &str,
        steering_ids: &[i64],
        start_idx: u64,
        messages: &[Message],
    ) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(),
            dispatch_id: String = dispatch_id.to_owned(),
            steering_ids: Vec<i64> = steering_ids.to_vec(),
            start_idx: u64 = start_idx,
            messages: Vec<Message> = messages.to_vec(),
        }, call |command| command.writer.append_claimed_thread_steering(&command.session_id, &command.dispatch_id, &command.steering_ids, command.start_idx, &command.messages),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        if steering_ids.len() != messages.len() {
            anyhow::bail!(
                "steering acknowledgement/message count mismatch: {} ids for {} messages",
                steering_ids.len(),
                messages.len()
            );
        }
        if messages.is_empty() {
            return Ok(());
        }
        let effect = format!("steering:{dispatch_id}:{steering_ids:?}");
        self.commit_append(
            session_id,
            &self.append_identity(start_idx, &effect),
            Some(start_idx),
            messages,
            AppendPurpose::Messages,
            |transaction| {
                super::steering::acknowledge_thread_steering_batch_with_connection(
                    transaction,
                    steering_ids,
                    session_id,
                    dispatch_id,
                )
            },
        )
        .map(|_| ())
    }

    /// Recheck ephemeral admission on the store executor after queue wait.
    /// The caller owns the gate; persistence owns the unchanged prompt transaction.
    pub(crate) fn append_admitted_run_prompt(
        &self,
        session_id: &str,
        idx: u64,
        message: &Message,
        run_id: &str,
        inbox_item_id: Option<i64>,
        admission: &std::sync::Arc<RunPromptAdmission>,
    ) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(), idx: u64 = idx,
            message: Message = message.clone(), run_id: String = run_id.to_owned(),
            inbox_item_id: Option<i64> = inbox_item_id,
            admission: std::sync::Arc<RunPromptAdmission> = std::sync::Arc::clone(admission),
        }, call |command| command.writer.append_admitted_run_prompt(&command.session_id, command.idx,
            &command.message, &command.run_id, command.inbox_item_id, &command.admission),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));
        admission(&|| self.append_run_prompt_inner(session_id, idx, message, run_id, inbox_item_id))
    }

    pub fn append_run_prompt(
        &self,
        session_id: &str,
        idx: u64,
        message: &Message,
        run_id: &str,
    ) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(),
            idx: u64 = idx,
            message: Message = message.clone(),
            run_id: String = run_id.to_owned(),
        }, call |command| command.writer.append_run_prompt(&command.session_id, command.idx, &command.message, &command.run_id),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        self.append_run_prompt_inner(session_id, idx, message, run_id, None)
    }

    pub fn append_inbox_run_prompt(
        &self,
        session_id: &str,
        idx: u64,
        message: &Message,
        run_id: &str,
        inbox_item_id: i64,
    ) -> Result<()> {
        coordinate_writer!(self, Result<()>, {
            session_id: String = session_id.to_owned(),
            idx: u64 = idx,
            message: Message = message.clone(),
            run_id: String = run_id.to_owned(),
            inbox_item_id: i64 = inbox_item_id,
        }, call |command| command.writer.append_inbox_run_prompt(&command.session_id, command.idx, &command.message, &command.run_id, command.inbox_item_id),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        self.append_run_prompt_inner(session_id, idx, message, run_id, Some(inbox_item_id))
    }

    fn append_run_prompt_inner(
        &self,
        session_id: &str,
        idx: u64,
        message: &Message,
        run_id: &str,
        inbox_item_id: Option<i64>,
    ) -> Result<()> {
        let Message::User { content } = message else {
            anyhow::bail!("a run prompt must be a user transcript message");
        };
        let identity = format!("prompt:{run_id}:{idx}:{inbox_item_id:?}");
        self.commit_append(
            session_id,
            &identity,
            Some(idx),
            std::slice::from_ref(message),
            AppendPurpose::RunPrompt(run_id),
            |transaction| {
                let submitted_message_id = transaction.last_insert_rowid();
                replace_with_active_run(transaction, session_id, run_id, submitted_message_id)?;
                if let Some(item_id) = inbox_item_id {
                    mark_inbox_item_delivered(transaction, session_id, item_id, run_id, content)?;
                }
                Ok(())
            },
        )
        .map(|_| ())
    }

    /// Direct steers need the records as the replay result. Read both pending
    /// and already delivered rows from this run at the exact append boundary;
    /// the receipt makes repeated delivery a no-op, including lost responses.
    pub fn append_pending_inbox_steers(
        &self,
        session_id: &str,
        run_id: &str,
        start_idx: u64,
    ) -> Result<Vec<SessionInboxRecord>> {
        coordinate_writer!(self, Result<Vec<SessionInboxRecord>>, {
            session_id: String = session_id.to_owned(),
            run_id: String = run_id.to_owned(),
            start_idx: u64 = start_idx,
        }, call |command| command.writer.append_pending_inbox_steers(&command.session_id, &command.run_id, command.start_idx),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let identity = format!("inbox:{run_id}:{start_idx}");
        self.commit_transaction(session_id, AppendPurpose::RunMessages(run_id), |transaction| {
        let replay: Option<String> = transaction.query_row(
            "SELECT result_json FROM transcript_append_receipts WHERE session_id = ?1 AND operation_id = ?2",
            params![session_id, identity], |r| r.get(0),
        ).optional()?.flatten();
        if let Some(ids_json) = replay {
            let ids: Vec<i64> = serde_json::from_str(&ids_json)?;
            return ids
                .into_iter()
                .map(|id| load_session_inbox_item_with_connection(transaction, session_id, id))
                .collect();
        }
        let records = {
            let mut statement = transaction.prepare(&format!("SELECT {INBOX_RECORD_COLUMNS} FROM session_inbox WHERE session_id = ?1 AND delivery = 'steer' AND status = 'pending' AND target_run_id = ?2 ORDER BY id ASC"))?;
            let records = statement
                .query_map(params![session_id, run_id], row_to_inbox_record)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            records
        };
        if records.is_empty() {
            return Ok(Vec::new());
        }
        let messages = records
            .iter()
            .map(|r| Message::User {
                content: r.content.clone(),
            })
            .collect::<Vec<_>>();
        let last_id =
            append_messages_in_transaction(transaction, session_id, start_idx, &messages)?;
        self.append_fault(super::transcript_append::AppendFault::Statements)?;
        for record in &records {
            mark_inbox_item_delivered(
                transaction,
                session_id,
                record.id,
                run_id,
                &record.content,
            )?;
        }
        let ids = records.iter().map(|r| r.id).collect::<Vec<_>>();
        transaction.execute("INSERT INTO transcript_append_receipts (session_id, operation_id, digest, run_id, generation, start_idx, end_idx, last_message_id, result_json) VALUES (?1, ?2, '', ?3, ?4, ?5, ?6, ?7, ?8)",
            params![session_id, identity, run_id, self.append_generation(), start_idx, start_idx + messages.len() as u64, last_id, serde_json::to_string(&ids)?])?;
        let delivered = ids
            .into_iter()
            .map(|id| load_session_inbox_item_with_connection(transaction, session_id, id))
            .collect::<Result<Vec<_>>>()?;
        Ok(delivered)
        })
    }

    /// Read the full log tail relative to a snapshot blob of `blob_len`
    /// messages: every row with `idx >= blob_len`, in log order. This is the
    /// hot-path equivalent of `read_from` for store-backed transcript reads:
    /// it decodes only tail rows instead of scanning the whole log. See
    /// [`TranscriptLogWriter::read_tail_window`] for the atomicity and
    /// contiguity guarantees.
    pub fn read_tail_from(&self, session_id: &str, blob_len: u64) -> Result<Vec<(u64, Message)>> {
        coordinate_writer!(self, Result<Vec<(u64, Message)>>, {
            session_id: String = session_id.to_owned(),
            blob_len: u64 = blob_len,
        }, call |command| command.writer.read_tail_from(&command.session_id, command.blob_len),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        Ok(self
            .read_tail_window(session_id, blob_len, 0, usize::MAX)?
            .1)
    }

    /// Read a window of the log tail relative to a snapshot blob of
    /// `blob_len` messages: tail position `p` is the row with
    /// `idx == blob_len + p`. Returns `(tail_len, rows)` where `rows` covers
    /// tail positions `[tail_start, tail_start + limit)` clamped to the
    /// tail, in log (append) order.
    ///
    /// The extent probe and the window read share one SQLite read snapshot,
    /// so another writer or process cannot shift the selected window. Rowid
    /// order is append order (= `idx` order) under the module invariants, so
    /// the window is an `ORDER BY id DESC LIMIT .. OFFSET ..` read that
    /// decodes only the returned rows — O(page) instead of O(log). The
    /// returned rows must be contiguous with the blob and with each other;
    /// anything else is corruption and fails loudly.
    pub fn read_tail_window(
        &self,
        session_id: &str,
        blob_len: u64,
        tail_start: u64,
        limit: usize,
    ) -> Result<(u64, Vec<(u64, Message)>)> {
        coordinate_writer!(self, Result<(u64, Vec<(u64, Message)>)>, {
            session_id: String = session_id.to_owned(),
            blob_len: u64 = blob_len,
            tail_start: u64 = tail_start,
            limit: usize = limit,
        }, call |command| command.writer.read_tail_window(&command.session_id, command.blob_len, command.tail_start, command.limit),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut connection = open_runtime_connection(&self.store_path)?;
        let snapshot =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
        let tail_len = tail_len_of(&snapshot, session_id, blob_len)?;
        #[cfg(test)]
        self.after_extent_read_for_test();
        if tail_start >= tail_len || limit == 0 {
            return Ok((tail_len, Vec::new()));
        }
        let end = tail_start.saturating_add(limit as u64).min(tail_len);
        let count = end - tail_start;
        let skip_from_end = tail_len - end;
        let mut statement = snapshot.prepare(
            "SELECT id, event_json
             FROM thread_events
             WHERE session_id = ?1 AND thread_name = ?2
             ORDER BY id DESC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = statement.query_map(
            params![
                session_id,
                ORCHESTRATOR_STEERING_TARGET,
                count as i64,
                skip_from_end as i64
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )?;
        let mut entries = Vec::new();
        for row in rows {
            let (id, event_json) = row?;
            let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
                anyhow!(
                    "thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
                )
            })?;
            let message: Message =
                serde_json::from_str(&entry.message_json).with_context(|| {
                    format!("thread_events row {id} holds an undecodable transcript message")
                })?;
            entries.push((entry.idx, message));
        }
        entries.reverse();
        for (expected_idx, (idx, _)) in (blob_len + tail_start..).zip(entries.iter()) {
            if *idx != expected_idx {
                return Err(anyhow!(
                    "transcript log tail window is not contiguous: expected idx {expected_idx}, found {idx}"
                ));
            }
        }
        Ok((tail_len, entries))
    }

    /// Row creation times for the same window [`TranscriptLogWriter::read_tail_window`]
    /// returns, aligned with it position by position.
    ///
    /// The canonical message bytes carry no timestamp — adding one would change
    /// the digest the compaction planner hashes — so the closest thing to "when
    /// this message entered the transcript" is the log row's own `created_at`.
    /// Messages carried by the snapshot blob predate the log and have none.
    pub fn read_tail_window_times(
        &self,
        session_id: &str,
        blob_len: u64,
        tail_start: u64,
        limit: usize,
    ) -> Result<Vec<String>> {
        coordinate_writer!(self, Result<Vec<String>>, {
            session_id: String = session_id.to_owned(),
            blob_len: u64 = blob_len,
            tail_start: u64 = tail_start,
            limit: usize = limit,
        }, call |command| command.writer.read_tail_window_times(&command.session_id, command.blob_len, command.tail_start, command.limit),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut connection = open_runtime_connection(&self.store_path)?;
        let snapshot =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
        let tail_len = tail_len_of(&snapshot, session_id, blob_len)?;
        #[cfg(test)]
        self.after_extent_read_for_test();
        if tail_start >= tail_len || limit == 0 {
            return Ok(Vec::new());
        }
        let end = tail_start.saturating_add(limit as u64).min(tail_len);
        let count = end - tail_start;
        let skip_from_end = tail_len - end;
        let mut statement = snapshot.prepare(
            "SELECT created_at
             FROM thread_events
             WHERE session_id = ?1 AND thread_name = ?2
             ORDER BY id DESC
             LIMIT ?3 OFFSET ?4",
        )?;
        let rows = statement.query_map(
            params![
                session_id,
                ORCHESTRATOR_STEERING_TARGET,
                count as i64,
                skip_from_end as i64
            ],
            |row| row.get::<_, String>(0),
        )?;
        let mut times = rows.collect::<rusqlite::Result<Vec<_>>>()?;
        times.reverse();
        Ok(times)
    }

    #[cfg(test)]
    fn after_extent_read_for_test(&self) {
        let hook = self.after_extent_read.lock().unwrap().take();
        if let Some(hook) = hook {
            hook();
        }
    }

    /// Read the snapshot prefix currently stored on the session row.
    pub(crate) fn read_snapshot_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        coordinate_writer!(self, Result<Vec<Message>>, {
            session_id: String = session_id.to_owned(),
        }, call |command| command.writer.read_snapshot_messages(&command.session_id),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let connection = open_runtime_connection(&self.store_path)?;
        let messages_json: String = connection.query_row(
            "SELECT messages_json FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )?;
        serde_json::from_str(&messages_json).context("failed to parse stored session messages")
    }

    /// Read committed entries with `idx >= from_idx`, in log (append) order.
    /// A row under the reserved name that does not decode as a transcript
    /// entry is corruption and fails the read loudly.
    pub fn read_from(&self, session_id: &str, from_idx: u64) -> Result<Vec<(u64, Message)>> {
        coordinate_writer!(self, Result<Vec<(u64, Message)>>, {
            session_id: String = session_id.to_owned(),
            from_idx: u64 = from_idx,
        }, call |command| command.writer.read_from(&command.session_id, command.from_idx),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let connection = open_runtime_connection(&self.store_path)?;
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

    /// Read the trusted log tail and atomically repair a validly encoded index
    /// gap. Rows covered by the snapshot remain untouched. At the first tail
    /// index mismatch, that physical row and every later reserved row are
    /// deleted in the same IMMEDIATE transaction that refreshes the session
    /// summary. Malformed or foreign reserved rows fail before any mutation.
    #[expect(
        clippy::type_complexity,
        reason = "the repair result keeps rows, repaired range, and visible-count metadata atomic"
    )]
    pub fn read_tail_repairing_gap(
        &self,
        session_id: &str,
        blob_len: u64,
    ) -> Result<(Vec<(u64, Message)>, Option<TranscriptLogRecovery>)> {
        coordinate_writer!(self, Result<(Vec<(u64, Message)>, Option<TranscriptLogRecovery>)>, {
            session_id: String = session_id.to_owned(),
            blob_len: u64 = blob_len,
        }, call |command| command.writer.read_tail_repairing_gap(&command.session_id, command.blob_len),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(admission) = &self.recovery_admission {
            admission()?;
        }
        let decoded_rows = {
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
            let mut decoded = Vec::new();
            for row in rows {
                let (id, event_json) = row?;
                let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
                    anyhow!(
                        "thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry"
                    )
                })?;
                let message: Message =
                    serde_json::from_str(&entry.message_json).with_context(|| {
                        format!("thread_events row {id} holds an undecodable transcript message")
                    })?;
                decoded.push((id, entry, message));
            }
            decoded
        };

        let mut expected_idx = blob_len;
        let mut boundary = None;
        for (position, (_, entry, _)) in decoded_rows.iter().enumerate() {
            if entry.idx < blob_len {
                continue;
            }
            if entry.idx != expected_idx {
                boundary = Some((position, expected_idx, entry.idx));
                break;
            }
            expected_idx = expected_idx
                .checked_add(1)
                .context("transcript log index overflowed")?;
        }

        let trusted_end = boundary
            .as_ref()
            .map_or(decoded_rows.len(), |(position, _, _)| *position);
        let trusted_tail = decoded_rows[..trusted_end]
            .iter()
            .filter(|(_, entry, _)| entry.idx >= blob_len)
            .map(|(_, entry, message)| (entry.idx, message.clone()))
            .collect();
        let recovery = if let Some((position, expected_idx, found_idx)) = boundary {
            for (id, _, _) in &decoded_rows[position..] {
                transaction.execute("DELETE FROM thread_events WHERE id = ?1", params![id])?;
            }
            refresh_session_summary(&transaction, session_id)?;
            Some(TranscriptLogRecovery {
                expected_idx,
                found_idx,
                discarded_rows: decoded_rows.len() - position,
            })
        } else {
            None
        };
        if let Some(admission) = &self.recovery_admission {
            admission()?;
        }
        transaction.commit()?;
        Ok((trusted_tail, recovery))
    }

    /// Delete committed entries with `idx >= from_idx` (tail truncation for
    /// crash/cancel normalization). Returns the number of deleted rows.
    /// Infrequent path: the idx values live inside the JSON payloads, so this
    /// scans the session's transcript rows and deletes by row id.
    pub fn delete_from(&self, session_id: &str, from_idx: u64) -> Result<usize> {
        coordinate_writer!(self, Result<usize>, {
            session_id: String = session_id.to_owned(),
            from_idx: u64 = from_idx,
        }, call |command| command.writer.delete_from(&command.session_id, command.from_idx),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(admission) = &self.recovery_admission {
            admission()?;
        }
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
        if !row_ids.is_empty() {
            refresh_session_summary(&transaction, session_id)?;
        }
        if let Some(admission) = &self.recovery_admission {
            admission()?;
        }
        transaction.commit()?;
        Ok(row_ids.len())
    }

    /// Replace the snapshot blob and delete every committed log row at or
    /// beyond its new length in one transaction. Run end never rewrites the
    /// blob; this is the truncation path that does, when dangling-tool
    /// recovery or revert/resend walks into the legacy or forked prefix.
    pub fn replace_snapshot_and_delete_from(
        &self,
        session_id: &str,
        messages: &[Message],
    ) -> Result<usize> {
        coordinate_writer!(self, Result<usize>, {
            session_id: String = session_id.to_owned(),
            messages: Vec<Message> = messages.to_vec(),
        }, call |command| command.writer.replace_snapshot_and_delete_from(&command.session_id, &command.messages),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        let messages_json =
            serde_json::to_string(messages).context("failed to serialize repaired transcript")?;
        let from_idx =
            u64::try_from(messages.len()).context("repaired transcript length overflowed")?;
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if let Some(admission) = &self.recovery_admission {
            admission()?;
        }
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
        let updated = transaction.execute(
            "UPDATE sessions SET messages_json = ?1 WHERE session_id = ?2",
            params![messages_json, session_id],
        )?;
        if updated != 1 {
            return Err(anyhow!(
                "transcript snapshot repair expected one session row, updated {updated}"
            ));
        }
        for id in &row_ids {
            transaction.execute("DELETE FROM thread_events WHERE id = ?1", params![id])?;
        }
        refresh_session_summary(&transaction, session_id)?;
        if let Some(admission) = &self.recovery_admission {
            admission()?;
        }
        transaction.commit()?;
        Ok(row_ids.len())
    }
}

fn refresh_session_summary(conn: &Connection, session_id: &str) -> Result<()> {
    let messages_json: String = conn.query_row(
        "SELECT messages_json FROM sessions WHERE session_id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    let messages: Vec<Message> =
        serde_json::from_str(&messages_json).context("failed to parse stored session messages")?;
    let blob_visible = crate::sessions::visible_message_count(&messages);
    let log_from_idx =
        u64::try_from(messages.len()).context("session transcript length overflowed")?;
    let log_visible = count_visible_transcript_log_messages(conn, session_id, log_from_idx)?;
    let visible_count = i64::try_from(
        blob_visible
            .checked_add(log_visible)
            .context("session visible message count overflowed")?,
    )
    .context("session visible message count overflowed")?;
    let last_user_prompt = last_transcript_log_user_prompt(conn, session_id, log_from_idx)?
        .or_else(|| crate::sessions::last_user_prompt(&messages));
    conn.execute(
        "UPDATE sessions
         SET visible_message_count = ?1, last_user_prompt = ?2
         WHERE session_id = ?3",
        params![visible_count, last_user_prompt, session_id],
    )?;
    Ok(())
}

#[cfg(test)]
#[path = "transcript_tests.rs"]
mod tests;
