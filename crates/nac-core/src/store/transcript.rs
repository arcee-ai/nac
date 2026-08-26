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
//! - `idx` values are contiguous and increase by one per append. The agent
//!   maintains this by construction (`idx` = `messages.len()` at push time,
//!   log-first so the vec never holds an undurable message), and the writer
//!   verifies the requested start index inside the append transaction.
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
                .is_some_and(|entry| entry.is_object())
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

/// Dedicated path-backed writer/reader for the transcript log. Connections
/// are checked out only for the duration of each operation. All methods are
/// synchronous and the writer is Send + Sync, so every method is usable inside
/// `tokio::task::spawn_blocking`.
///
/// Callers must uphold the module-level invariants: one writer per session,
/// `idx` contiguous and increasing per append.
pub struct TranscriptLogWriter {
    store_path: PathBuf,
    operation: Mutex<()>,
}

/// Length of the log tail relative to a snapshot blob of `blob_len`, read from
/// the newest row's `idx`. Callers hold the writer operation lock, so the extent
/// cannot shift under a window read taken with it.
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

fn append_messages_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
    start_idx: u64,
    messages: &[Message],
) -> Result<i64> {
    let visible_delta = i64::try_from(crate::sessions::visible_message_count(messages))
        .context("transcript visible message count overflowed")?;
    let last_user_prompt = crate::sessions::last_user_prompt(messages);
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
    let expected_start_idx = blob_len.max(log_next_idx);
    if start_idx != expected_start_idx {
        return Err(anyhow!(
            "transcript log append is not contiguous: expected start idx {expected_start_idx}, found {start_idx}"
        ));
    }
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
            operation: Mutex::new(()),
        })
    }

    /// Append `message` at absolute transcript position `idx`.
    pub fn append(&self, session_id: &str, idx: u64, message: &Message) -> Result<()> {
        self.append_batch(session_id, idx, std::slice::from_ref(message))
    }

    /// Append `messages` at absolute transcript positions
    /// `start_idx..start_idx + messages.len()`, atomically: the whole batch
    /// commits in one IMMEDIATE transaction, so a crash mid-batch is
    /// all-or-nothing. Used for the parallel tool-result batch, whose
    /// provider-view invariant requires the complete batch to be durable
    /// together.
    pub fn append_batch(
        &self,
        session_id: &str,
        start_idx: u64,
        messages: &[Message],
    ) -> Result<()> {
        if messages.is_empty() {
            return Ok(());
        }
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        append_messages_in_transaction(&transaction, session_id, start_idx, messages)?;
        transaction.commit()?;
        Ok(())
    }

    /// Append a claimed orchestrator/thread steering batch and acknowledge
    /// every steering row in the same transaction. Either both the canonical
    /// User messages and delivered statuses commit, or neither does.
    pub fn append_claimed_thread_steering(
        &self,
        session_id: &str,
        dispatch_id: &str,
        steering_ids: &[i64],
        start_idx: u64,
        messages: &[Message],
    ) -> Result<()> {
        if steering_ids.len() != messages.len() {
            return Err(anyhow!(
                "steering acknowledgement/message count mismatch: {} ids for {} messages",
                steering_ids.len(),
                messages.len()
            ));
        }
        if messages.is_empty() {
            return Ok(());
        }
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        append_messages_in_transaction(&transaction, session_id, start_idx, messages)?;
        super::steering::acknowledge_thread_steering_batch_with_connection(
            &transaction,
            steering_ids,
            session_id,
            dispatch_id,
        )?;
        transaction.commit()?;
        Ok(())
    }

    /// Append the submitted user turn and install its recovery obligation in
    /// the same transaction. No provider request may begin until this returns.
    pub fn append_run_prompt(
        &self,
        session_id: &str,
        idx: u64,
        message: &Message,
        run_id: &str,
    ) -> Result<()> {
        self.append_run_prompt_inner(session_id, idx, message, run_id, None)
    }

    /// Deliver one pending inbox item at the same commit point as the run's
    /// canonical User prompt and recovery obligation.
    pub fn append_inbox_run_prompt(
        &self,
        session_id: &str,
        idx: u64,
        message: &Message,
        run_id: &str,
        inbox_item_id: i64,
    ) -> Result<()> {
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
        if !matches!(message, Message::User { .. }) {
            return Err(anyhow!("a run prompt must be a user transcript message"));
        }
        let Message::User { content } = message else {
            unreachable!()
        };
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let submitted_message_id = append_messages_in_transaction(
            &transaction,
            session_id,
            idx,
            std::slice::from_ref(message),
        )?;
        replace_with_active_run(&transaction, session_id, run_id, submitted_message_id)?;
        if let Some(inbox_item_id) = inbox_item_id {
            mark_inbox_item_delivered(&transaction, session_id, inbox_item_id, run_id, content)?;
        }
        transaction.commit()?;
        Ok(())
    }

    /// Consume every steer targeted at `run_id` that won admission before
    /// this model boundary. Status transition and canonical transcript append
    /// share one IMMEDIATE transaction; a later steer remains pending for the
    /// next boundary or idle successor.
    pub fn append_pending_inbox_steers(
        &self,
        session_id: &str,
        run_id: &str,
        start_idx: u64,
    ) -> Result<Vec<SessionInboxRecord>> {
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let records = {
            let mut statement = transaction.prepare(&format!(
                "SELECT {INBOX_RECORD_COLUMNS} FROM session_inbox
                 WHERE session_id = ?1 AND delivery = 'steer'
                   AND status = 'pending' AND target_run_id = ?2
                 ORDER BY id ASC"
            ))?;
            let records = statement
                .query_map(params![session_id, run_id], row_to_inbox_record)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            records
        };
        if records.is_empty() {
            transaction.commit()?;
            return Ok(Vec::new());
        }
        let messages = records
            .iter()
            .map(|record| Message::User {
                content: record.content.clone(),
            })
            .collect::<Vec<_>>();
        append_messages_in_transaction(&transaction, session_id, start_idx, &messages)?;
        for record in &records {
            mark_inbox_item_delivered(
                &transaction,
                session_id,
                record.id,
                run_id,
                &record.content,
            )?;
        }
        transaction.commit()?;
        records
            .into_iter()
            .map(|record| {
                load_session_inbox_item_with_connection(&connection, session_id, record.id)
            })
            .collect()
    }

    /// Read the full log tail relative to a snapshot blob of `blob_len`
    /// messages: every row with `idx >= blob_len`, in log order. This is the
    /// hot-path equivalent of `read_from` for store-backed transcript reads:
    /// it decodes only tail rows instead of scanning the whole log. See
    /// [`TranscriptLogWriter::read_tail_window`] for the atomicity and
    /// contiguity guarantees.
    pub fn read_tail_from(&self, session_id: &str, blob_len: u64) -> Result<Vec<(u64, Message)>> {
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
    /// The extent probe and the window read run under one writer operation
    /// lock, so a concurrent append cannot interleave and shift the window. Rowid
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
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = open_runtime_connection(&self.store_path)?;
        let tail_len = tail_len_of(&connection, session_id, blob_len)?;
        if tail_start >= tail_len || limit == 0 {
            return Ok((tail_len, Vec::new()));
        }
        let end = tail_start.saturating_add(limit as u64).min(tail_len);
        let count = end - tail_start;
        let skip_from_end = tail_len - end;
        let mut statement = connection.prepare(
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
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = open_runtime_connection(&self.store_path)?;
        let tail_len = tail_len_of(&connection, session_id, blob_len)?;
        if tail_start >= tail_len || limit == 0 {
            return Ok(Vec::new());
        }
        let end = tail_start.saturating_add(limit as u64).min(tail_len);
        let count = end - tail_start;
        let skip_from_end = tail_len - end;
        let mut statement = connection.prepare(
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

    /// Read the snapshot prefix currently stored on the session row.
    pub(crate) fn read_snapshot_messages(&self, session_id: &str) -> Result<Vec<Message>> {
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    #[allow(clippy::type_complexity)]
    pub fn read_tail_repairing_gap(
        &self,
        session_id: &str,
        blob_len: u64,
    ) -> Result<(Vec<(u64, Message)>, Option<TranscriptLogRecovery>)> {
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
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
        transaction.commit()?;
        Ok((trusted_tail, recovery))
    }

    /// Delete committed entries with `idx >= from_idx` (tail truncation for
    /// crash/cancel normalization). Returns the number of deleted rows.
    /// Infrequent path: the idx values live inside the JSON payloads, so this
    /// scans the session's transcript rows and deletes by row id.
    pub fn delete_from(&self, session_id: &str, from_idx: u64) -> Result<usize> {
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
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
        if !row_ids.is_empty() {
            refresh_session_summary(&transaction, session_id)?;
        }
        transaction.commit()?;
        Ok(row_ids.len())
    }

    /// Replace the legacy snapshot prefix and delete every committed log row
    /// at or beyond its new length in one transaction. This is reserved for
    /// recovery when dangling-tool normalization trims into the otherwise
    /// write-once snapshot blob.
    pub fn replace_snapshot_and_delete_from(
        &self,
        session_id: &str,
        messages: &[Message],
    ) -> Result<usize> {
        let messages_json =
            serde_json::to_string(messages).context("failed to serialize repaired transcript")?;
        let from_idx =
            u64::try_from(messages.len()).context("repaired transcript length overflowed")?;
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut connection = open_runtime_connection(&self.store_path)?;
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

    fn set_snapshot_messages(path: &Path, session_id: &str, messages: &[Message]) {
        let connection = open_connection(path).unwrap();
        connection
            .execute(
                "UPDATE sessions
                 SET messages_json = ?1, visible_message_count = ?2, last_user_prompt = ?3
                 WHERE session_id = ?4",
                params![
                    serde_json::to_string(messages).unwrap(),
                    crate::sessions::visible_message_count(messages) as i64,
                    crate::sessions::last_user_prompt(messages),
                    session_id
                ],
            )
            .unwrap();
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
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "tool output".into(),
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
                    duration_ms: None,
                    model_origin: None,
                    reasoning_field: None,
                },
                TranscriptMessageKind::Assistant,
                "assistant",
            ),
            (
                Message::Tool {
                    tool_call_id: "c".to_string(),
                    content: ("t".to_string()).into(),
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
    fn image_tool_content_survives_transcript_log_replay() {
        use crate::tool_content::{ToolContent, ToolContentPart, ToolImage};
        use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
        use std::io::Cursor;

        let source = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, Rgba([1, 2, 3, 255])));
        let mut encoded = Cursor::new(Vec::new());
        source.write_to(&mut encoded, ImageFormat::Png).unwrap();
        let image = ToolImage::validate(encoded.into_inner(), None, None).unwrap();
        let message = Message::Tool {
            tool_call_id: "call-image".to_string(),
            content: ToolContent::from_parts(vec![ToolContentPart::Image(image)]).unwrap(),
        };

        let path = temp_store_path("image_replay");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-image");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch("session-image", 0, std::slice::from_ref(&message))
            .unwrap();
        let replayed = writer.read_from("session-image", 0).unwrap();
        assert_eq!(replayed[0].0, 0);
        assert_eq!(
            serde_json::to_value(&replayed[0].1).unwrap(),
            serde_json::to_value(&message).unwrap()
        );
        let _ = std::fs::remove_file(path);
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
    fn transcript_log_append_batch_assigns_contiguous_indices_and_is_empty_noop() {
        let path = temp_store_path("append_batch");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        set_snapshot_messages(
            &path,
            "session-a",
            &[
                Message::System {
                    content: "covered 0".to_string(),
                },
                Message::System {
                    content: "covered 1".to_string(),
                },
                Message::System {
                    content: "covered 2".to_string(),
                },
                Message::System {
                    content: "covered 3".to_string(),
                },
            ],
        );

        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer.append_batch("session-a", 99, &[]).unwrap();
        assert!(writer.read_from("session-a", 0).unwrap().is_empty());

        let messages = sample_messages();
        writer.append_batch("session-a", 4, &messages).unwrap();
        let all = writer.read_from("session-a", 0).unwrap();
        assert_eq!(all.len(), messages.len());
        for (position, ((idx, read), expected)) in all.iter().zip(messages.iter()).enumerate() {
            assert_eq!(*idx as usize, 4 + position);
            assert_eq!(canonical(read), canonical(expected));
        }

        let summary_before_rejection = crate::sessions::list_sessions(&path).unwrap().remove(0);
        for rejected_start in [3, 9] {
            let error = writer
                .append_batch(
                    "session-a",
                    rejected_start,
                    &[Message::User {
                        content: "must not persist".to_string(),
                    }],
                )
                .unwrap_err();
            assert!(
                error.to_string().contains("expected start idx 8"),
                "{error:#}"
            );
        }
        assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 4);
        let summary_after_rejection = crate::sessions::list_sessions(&path).unwrap().remove(0);
        assert_eq!(
            summary_after_rejection.visible_message_count,
            summary_before_rejection.visible_message_count
        );
        assert_eq!(
            summary_after_rejection.last_user_prompt,
            summary_before_rejection.last_user_prompt
        );

        // A follow-up batch continues from the end of the previous one.
        writer
            .append_batch(
                "session-a",
                8,
                &[Message::User {
                    content: "tail".to_string(),
                }],
            )
            .unwrap();
        let tail = writer.read_from("session-a", 8).unwrap();
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].0, 8);
        let summary = crate::sessions::list_sessions(&path).unwrap().remove(0);
        assert_eq!(summary.visible_message_count, 2);
        assert_eq!(summary.last_user_prompt.as_deref(), Some("tail"));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn steering_acknowledgement_and_transcript_append_are_atomic() {
        let path = temp_store_path("steering_atomic");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        let steer = queue_thread_steering(
            &path,
            "session",
            ORCHESTRATOR_STEERING_TARGET,
            "dispatch",
            "keep going",
        )
        .unwrap();
        assert_eq!(
            claim_thread_steering(&path, "session", "dispatch")
                .unwrap()
                .len(),
            1
        );
        let writer = TranscriptLogWriter::new(&path).unwrap();
        let messages = [Message::User {
            content: "keep going".to_string(),
        }];

        writer
            .append_claimed_thread_steering("session", "dispatch", &[steer.id], 1, &messages)
            .unwrap_err();
        assert!(writer.read_from("session", 0).unwrap().is_empty());
        assert_eq!(
            list_thread_steering(&path, "session").unwrap()[0].status,
            "claimed"
        );

        writer
            .append_claimed_thread_steering("session", "dispatch", &[steer.id], 0, &messages)
            .unwrap();
        assert_eq!(writer.read_from("session", 0).unwrap().len(), 1);
        assert_eq!(
            list_thread_steering(&path, "session").unwrap()[0].status,
            "delivered"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn inbox_delivery_and_transcript_commit_are_atomic_for_steers_and_prompts() {
        let path = temp_store_path("inbox_atomic");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        let steer = create_session_inbox_item(
            &path,
            "session",
            InboxDelivery::Steer,
            "steer now",
            Some("run-a"),
            None,
        )
        .unwrap();
        let queued = create_session_inbox_item(
            &path,
            "session",
            InboxDelivery::Queue,
            "next prompt",
            None,
            None,
        )
        .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();

        let delivered = writer
            .append_pending_inbox_steers("session", "run-a", 0)
            .unwrap();
        assert_eq!(
            delivered.iter().map(|record| record.id).collect::<Vec<_>>(),
            vec![steer.id]
        );
        assert!(writer
            .append_pending_inbox_steers("session", "run-a", 1)
            .unwrap()
            .is_empty());
        assert_eq!(
            load_session_inbox_item(&path, "session", steer.id)
                .unwrap()
                .status,
            InboxStatus::Delivered
        );
        assert_eq!(
            load_session_inbox_item(&path, "session", queued.id)
                .unwrap()
                .status,
            InboxStatus::Pending
        );

        writer
            .append_inbox_run_prompt(
                "session",
                1,
                &Message::User {
                    content: "next prompt".to_string(),
                },
                "run-b",
                queued.id,
            )
            .unwrap();
        let queued = load_session_inbox_item(&path, "session", queued.id).unwrap();
        assert_eq!(queued.status, InboxStatus::Delivered);
        assert_eq!(queued.delivered_run_id.as_deref(), Some("run-b"));
        assert_eq!(
            load_run_recovery(&path, "session").unwrap().unwrap().run_id,
            "run-b"
        );

        let mismatch = create_session_inbox_item(
            &path,
            "session",
            InboxDelivery::Queue,
            "canonical",
            None,
            None,
        )
        .unwrap();
        assert!(writer
            .append_inbox_run_prompt(
                "session",
                2,
                &Message::User {
                    content: "different".to_string(),
                },
                "run-c",
                mismatch.id,
            )
            .is_err());
        assert_eq!(writer.read_from("session", 0).unwrap().len(), 2);
        assert_eq!(
            load_session_inbox_item(&path, "session", mismatch.id)
                .unwrap()
                .status,
            InboxStatus::Pending
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_gap_repair_keeps_the_trusted_prefix_and_refreshes_summary() {
        let path = temp_store_path("gap_repair");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");
        set_snapshot_messages(
            &path,
            "session-a",
            &[
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "blob prompt".to_string(),
                },
            ],
        );
        for (idx, content) in [
            (0, "covered"),
            (2, "trusted tail"),
            (4, "first orphan"),
            (5, "later orphan"),
        ] {
            crate::store::append_thread_event(
                &path,
                "session-a",
                ORCHESTRATOR_STEERING_TARGET,
                &encode_transcript_log_entry(
                    idx,
                    &Message::User {
                        content: content.to_string(),
                    },
                )
                .unwrap(),
            )
            .unwrap();
        }
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append(
                "session-b",
                0,
                &Message::User {
                    content: "other session".to_string(),
                },
            )
            .unwrap();

        let (tail, recovery) = writer.read_tail_repairing_gap("session-a", 2).unwrap();
        assert_eq!(tail.len(), 1);
        assert_eq!(tail[0].0, 2);
        let recovery = recovery.expect("the gap must be repaired");
        assert_eq!(recovery.expected_idx, 3);
        assert_eq!(recovery.found_idx, 4);
        assert_eq!(recovery.discarded_rows, 2);
        let remaining = writer.read_from("session-a", 0).unwrap();
        assert_eq!(
            remaining.iter().map(|(idx, _)| *idx).collect::<Vec<_>>(),
            vec![0, 2]
        );
        assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 1);
        let summary = crate::sessions::list_sessions(&path)
            .unwrap()
            .into_iter()
            .find(|summary| summary.session_id == "session-a")
            .unwrap();
        assert_eq!(summary.visible_message_count, 2);
        assert_eq!(summary.last_user_prompt.as_deref(), Some("trusted tail"));
        let (_, clean_recovery) = writer.read_tail_repairing_gap("session-a", 2).unwrap();
        assert!(clean_recovery.is_none());

        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &encode_transcript_log_entry(
                4,
                &Message::User {
                    content: "new orphan".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            "{\"type\":\"run_started\"}",
        )
        .unwrap();
        assert!(writer.read_tail_repairing_gap("session-a", 2).is_err());
        let connection = open_connection(&path).unwrap();
        let row_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM thread_events
                 WHERE session_id = 'session-a' AND thread_name = ?1",
                params![ORCHESTRATOR_STEERING_TARGET],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(row_count, 4, "decode failure must roll back the repair");

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
        let summary = crate::sessions::list_sessions(&path)
            .unwrap()
            .into_iter()
            .find(|summary| summary.session_id == "session-a")
            .unwrap();
        assert_eq!(summary.visible_message_count, 1);
        assert_eq!(summary.last_user_prompt.as_deref(), Some("prompt"));

        // Beyond-the-end truncation is a no-op; other sessions are untouched.
        assert_eq!(writer.delete_from("session-a", 99).unwrap(), 0);
        assert_eq!(writer.read_from("session-b", 0).unwrap().len(), 4);

        assert_eq!(writer.delete_from("session-a", 0).unwrap(), 2);
        assert!(writer.read_from("session-a", 0).unwrap().is_empty());
        let summary = crate::sessions::list_sessions(&path)
            .unwrap()
            .into_iter()
            .find(|summary| summary.session_id == "session-a")
            .unwrap();
        assert_eq!(summary.visible_message_count, 0);
        assert_eq!(summary.last_user_prompt, None);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_summary_refresh_ignores_blob_covered_rows() {
        let path = temp_store_path("summary_covered_rows");
        initialize(&path).unwrap();
        let snapshot = crate::sessions::new_snapshot(
            "session-a".to_string(),
            PathBuf::from("/tmp/project"),
            "test-model".to_string(),
            "https://example.invalid".to_string(),
            crate::model::BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            None,
            std::collections::BTreeMap::new(),
        );
        crate::sessions::create_session(&path, &snapshot).unwrap();

        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "session-a",
                0,
                &[
                    Message::User {
                        content: "stale covered prompt".to_string(),
                    },
                    Message::Assistant {
                        content: Some("stale covered answer".to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                ],
            )
            .unwrap();

        let mut snapshot = crate::sessions::load_session(&path, "session-a").unwrap();
        snapshot.messages = vec![
            Message::User {
                content: "blob replacement prompt".to_string(),
            },
            Message::Assistant {
                content: Some("blob replacement answer".to_string()),
                reasoning_text: None,
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
            },
        ];
        crate::sessions::save_session(&path, &snapshot).unwrap();

        writer
            .append_batch(
                "session-a",
                2,
                &[
                    Message::User {
                        content: "live prompt".to_string(),
                    },
                    Message::Assistant {
                        content: Some("live answer".to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                ],
            )
            .unwrap();

        assert_eq!(writer.delete_from("session-a", 3).unwrap(), 1);
        let summary = crate::sessions::list_sessions(&path).unwrap().remove(0);
        assert_eq!(summary.visible_message_count, 3);
        assert_eq!(summary.last_user_prompt.as_deref(), Some("live prompt"));

        assert_eq!(writer.delete_from("session-a", 2).unwrap(), 1);
        let summary = crate::sessions::list_sessions(&path).unwrap().remove(0);
        assert_eq!(summary.visible_message_count, 2);
        assert_eq!(
            summary.last_user_prompt.as_deref(),
            Some("blob replacement prompt")
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_read_tail_window_pages_backwards_from_the_extent() {
        let path = temp_store_path("tail_window");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");

        let writer = TranscriptLogWriter::new(&path).unwrap();
        let messages = sample_messages();
        // Simulate a blob-covered prefix (idx 0-1) and a live tail (idx 2-3):
        // the window reads are relative to blob_len = 2.
        for (idx, message) in messages.iter().enumerate() {
            writer.append("session-a", idx as u64, message).unwrap();
        }

        // Extent probe: a zero-limit window still reports the tail length.
        let (tail_len, rows) = writer.read_tail_window("session-a", 2, 0, 0).unwrap();
        assert_eq!(tail_len, 2);
        assert!(rows.is_empty());

        // Full tail == read_from for the same range.
        let full = writer.read_tail_from("session-a", 2).unwrap();
        let reference = writer.read_from("session-a", 2).unwrap();
        assert_eq!(full.len(), reference.len());
        for ((idx, message), (ref_idx, ref_message)) in full.iter().zip(reference.iter()) {
            assert_eq!(idx, ref_idx);
            assert_eq!(canonical(message), canonical(ref_message));
        }
        assert_eq!(full.len(), 2);
        assert_eq!(full[0].0, 2);

        // One-row windows walk the tail backwards without overlap.
        let (_, last) = writer.read_tail_window("session-a", 2, 1, 1).unwrap();
        assert_eq!(last.len(), 1);
        assert_eq!(last[0].0, 3);
        assert_eq!(canonical(&last[0].1), canonical(&messages[3]));
        let (_, first) = writer.read_tail_window("session-a", 2, 0, 1).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].0, 2);
        assert_eq!(canonical(&first[0].1), canonical(&messages[2]));

        // Windows clamp at both ends; a blob that covers the log has no tail.
        let (tail_len, clamped) = writer
            .read_tail_window("session-a", 2, 1, usize::MAX)
            .unwrap();
        assert_eq!(tail_len, 2);
        assert_eq!(clamped.len(), 1);
        assert!(writer
            .read_tail_window("session-a", 2, 2, 4)
            .unwrap()
            .1
            .is_empty());
        assert_eq!(writer.read_tail_window("session-a", 4, 0, 4).unwrap().0, 0);
        assert_eq!(writer.read_tail_window("session-a", 99, 0, 4).unwrap().0, 0);
        assert_eq!(writer.read_tail_window("session-b", 0, 0, 4).unwrap().0, 0);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_read_tail_window_fails_loudly_on_gaps_and_foreign_rows() {
        let path = temp_store_path("tail_window_gaps");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");

        let writer = TranscriptLogWriter::new(&path).unwrap();
        for (idx, message) in sample_messages().iter().take(2).enumerate() {
            writer.append("session-a", idx as u64, message).unwrap();
        }
        // A hand-inserted row that skips idx 2: the tail [1, 3] is not
        // contiguous and must fail the window read loudly.
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            &encode_transcript_log_entry(
                3,
                &Message::User {
                    content: "gap".to_string(),
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(writer
            .read_tail_window("session-a", 1, 0, usize::MAX)
            .is_err());
        // The extent probe decodes only the last row, so a zero-limit window
        // still succeeds; the gap surfaces only when the window covers it.
        assert_eq!(writer.read_tail_window("session-a", 1, 0, 0).unwrap().0, 3);

        // A foreign row under the reserved name fails even the extent probe.
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            "{\"type\":\"run_started\",\"prompt_preview\":\"run started\"}",
        )
        .unwrap();
        assert!(writer.read_tail_window("session-a", 1, 0, 0).is_err());

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

    #[test]
    fn transcript_log_summary_stats_match_the_blob_visibility_predicate() {
        let path = temp_store_path("summary_stats");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");
        set_snapshot_messages(
            &path,
            "session-a",
            &[Message::System {
                content: "covered system".to_string(),
            }],
        );

        let tool_call = crate::types::ToolCall {
            id: "call-1".to_string(),
            call_type: "function".to_string(),
            function: crate::types::FunctionCall {
                name: "read".to_string(),
                arguments: "{\"path\":\"x\"}".to_string(),
            },
        };
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "session-a",
                1,
                &[
                    Message::User {
                        content: "first prompt".to_string(),
                    },
                    Message::Assistant {
                        content: Some("visible answer".to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    // Assistant with tool calls: not visible even with content.
                    Message::Assistant {
                        content: Some("working".to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: Some(vec![tool_call.clone()]),
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    Message::Tool {
                        tool_call_id: "call-1".to_string(),
                        content: ("tool output".to_string()).into(),
                    },
                    // Assistant without content: not visible.
                    Message::Assistant {
                        content: None,
                        reasoning_text: Some("reasoning only".to_string()),
                        reasoning_details: None,
                        tool_calls: None,
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    // Assistant with an empty tool-call list: visible.
                    Message::Assistant {
                        content: Some("another answer".to_string()),
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: Some(Vec::new()),
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    Message::User {
                        content: "latest prompt".to_string(),
                    },
                ],
            )
            .unwrap();
        // A foreign (valid JSON, non-transcript) row under the reserved name
        // extracts a NULL kind and is ignored by both stats.
        crate::store::append_thread_event(
            &path,
            "session-a",
            ORCHESTRATOR_STEERING_TARGET,
            "{\"type\":\"run_started\",\"prompt_preview\":\"run started\"}",
        )
        .unwrap();

        let conn = open_connection(&path).unwrap();
        assert_eq!(
            count_visible_transcript_log_messages(&conn, "session-a", 1).unwrap(),
            4,
            "user rows plus content-bearing, tool-call-free assistant rows"
        );
        assert_eq!(
            last_transcript_log_user_prompt(&conn, "session-a", 1)
                .unwrap()
                .as_deref(),
            Some("latest prompt")
        );

        // A session with no log rows gets the empty stats (the caller falls
        // back to the blob's last user prompt).
        assert_eq!(
            count_visible_transcript_log_messages(&conn, "session-b", 0).unwrap(),
            0
        );
        assert_eq!(
            last_transcript_log_user_prompt(&conn, "session-b", 0).unwrap(),
            None
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
