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
//! - Append-only except `TranscriptLogWriter::delete_from`, which truncates a
//!   tail range (`idx >= from_idx`) for crash/cancel normalization.
//! - `idx` values are contiguous and increase by one per append. The agent
//!   maintains this by construction (`idx` = `messages.len()` at push time,
//!   log-first so the vec never holds an undurable message); the restore
//!   merge verifies the tail is contiguous with the snapshot blob and fails
//!   loudly otherwise. The log's first row is NOT necessarily idx 0: the
//!   initial system prompt(s) enter the vec at construction, before any
//!   logging, and are carried by the snapshot blob.
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
        .map_or(false, |value| {
            value
                .get(TRANSCRIPT_PAYLOAD_KEY)
                .map_or(false, |entry| entry.is_object())
        })
}

use crate::types::Message;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
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

/// Dedicated writer/reader for the transcript log. Owns its connection, same
/// shape as `ThreadEventWriter`. All methods are synchronous and the writer is
/// Send + Sync, so every method is usable inside `tokio::task::spawn_blocking`.
///
/// Callers must uphold the module-level invariants: one writer per session,
/// `idx` contiguous and increasing per append.
pub struct TranscriptLogWriter {
    connection: Mutex<Connection>,
}

const FORK_BOUNDARY_TOKEN_PREFIX: &str = "fb1.";
const FORK_BOUNDARY_DIGEST_DOMAIN: &[u8] = b"nac:fork-boundary:v1\0";

#[derive(Debug, Clone)]
pub struct ForkBoundaryProjection {
    pub messages: Vec<Message>,
    pub created_at: Vec<Option<String>>,
    /// Opaque tokens aligned position-for-position with `messages`.
    pub fork_boundary_tokens: Vec<Option<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedForkBoundary {
    pub raw_end_exclusive: u64,
    pub prefix_sha256: String,
    pub boundary_event_id: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForkBoundaryValidationError {
    InvalidToken,
    WrongSession,
    Stale,
    Mutable,
}

impl std::fmt::Display for ForkBoundaryValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::InvalidToken => "invalid fork boundary token",
            Self::WrongSession => "fork boundary token belongs to another session",
            Self::Stale => "fork boundary is stale",
            Self::Mutable => "fork boundary is still mutable",
        })
    }
}

impl std::error::Error for ForkBoundaryValidationError {}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct ForkBoundaryTokenV1 {
    format_version: u8,
    source_session_id: String,
    raw_end_exclusive: u64,
    prefix_sha256: String,
    boundary_event_id: Option<i64>,
}

#[derive(Debug)]
struct ForkTranscriptRow {
    message: Message,
    canonical: Vec<u8>,
    created_at: Option<String>,
    event_id: Option<i64>,
}

fn prefix_hasher(rows: &[ForkTranscriptRow], end: usize) -> Sha256 {
    let mut hasher = Sha256::new();
    hasher.update(FORK_BOUNDARY_DIGEST_DOMAIN);
    for row in &rows[..end] {
        hasher.update((row.canonical.len() as u64).to_be_bytes());
        hasher.update(&row.canonical);
    }
    hasher
}

fn finish_prefix_digest(mut hasher: Sha256, end: usize) -> String {
    hasher.update((end as u64).to_be_bytes());
    format!("{:x}", hasher.finalize())
}

fn prefix_digest(rows: &[ForkTranscriptRow], end: usize) -> String {
    finish_prefix_digest(prefix_hasher(rows, end), end)
}

fn encode_fork_boundary_token(payload: &ForkBoundaryTokenV1) -> Result<String> {
    let json = serde_json::to_vec(payload).context("failed to encode fork boundary token")?;
    Ok(format!(
        "{FORK_BOUNDARY_TOKEN_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(json)
    ))
}

fn decode_fork_boundary_token(
    token: &str,
) -> std::result::Result<ForkBoundaryTokenV1, ForkBoundaryValidationError> {
    let encoded = token
        .strip_prefix(FORK_BOUNDARY_TOKEN_PREFIX)
        .ok_or(ForkBoundaryValidationError::InvalidToken)?;
    if encoded.is_empty() || encoded.len() > 16 * 1024 {
        return Err(ForkBoundaryValidationError::InvalidToken);
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .map_err(|_| ForkBoundaryValidationError::InvalidToken)?;
    let payload: ForkBoundaryTokenV1 =
        serde_json::from_slice(&bytes).map_err(|_| ForkBoundaryValidationError::InvalidToken)?;
    if payload.format_version != 1
        || payload.raw_end_exclusive == 0
        || payload.prefix_sha256.len() != 64
        || !payload
            .prefix_sha256
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(ForkBoundaryValidationError::InvalidToken);
    }
    Ok(payload)
}

fn complete_assistant_boundaries(messages: &[Message]) -> Vec<bool> {
    let mut complete = Vec::with_capacity(messages.len());
    let mut pending: Vec<&str> = Vec::new();
    let mut protocol_valid = true;
    for message in messages {
        match message {
            Message::Assistant { tool_calls, .. }
                if tool_calls.as_ref().is_some_and(|calls| !calls.is_empty()) =>
            {
                if !pending.is_empty() {
                    protocol_valid = false;
                }
                let calls = tool_calls.as_ref().expect("checked non-empty");
                if calls
                    .iter()
                    .enumerate()
                    .any(|(idx, call)| calls[..idx].iter().any(|prior| prior.id == call.id))
                {
                    protocol_valid = false;
                }
                pending = calls.iter().map(|call| call.id.as_str()).collect();
            }
            Message::Tool { tool_call_id, .. } => {
                if let Some(position) = pending.iter().position(|id| *id == tool_call_id) {
                    pending.remove(position);
                } else {
                    protocol_valid = false;
                }
            }
            Message::System { .. } | Message::User { .. } | Message::Assistant { .. }
                if !pending.is_empty() =>
            {
                protocol_valid = false;
            }
            _ => {}
        }
        complete.push(
            protocol_valid
                && pending.is_empty()
                && matches!(
                    message,
                    Message::Assistant {
                        content: Some(_),
                        tool_calls,
                        ..
                    } if !tool_calls.as_ref().is_some_and(|calls| !calls.is_empty())
                ),
        );
    }
    complete
}

fn boundary_is_mutable(messages: &[Message], boundary: usize, active_run: bool) -> bool {
    active_run
        && !messages[boundary + 1..]
            .iter()
            .any(|message| matches!(message, Message::User { .. }))
}

/// Length of the log tail relative to a snapshot blob of `blob_len` messages,
/// read from the newest row's `idx`. Callers hold the connection lock, so the
/// extent cannot shift under a window read taken with it.
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

fn load_fork_transcript_rows(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<ForkTranscriptRow>> {
    let messages_json: String = connection
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .with_context(|| format!("failed to load source session '{session_id}'"))?;
    let blob: Vec<Message> =
        serde_json::from_str(&messages_json).context("failed to decode source transcript blob")?;
    let mut rows = Vec::with_capacity(blob.len());
    for message in blob {
        let canonical =
            serde_json::to_vec(&message).context("failed to serialize canonical blob message")?;
        rows.push(ForkTranscriptRow {
            message,
            canonical,
            created_at: None,
            event_id: None,
        });
    }
    let blob_len = rows.len() as u64;
    let mut statement = connection.prepare(
        "SELECT id, event_json, created_at
         FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2
         ORDER BY id ASC",
    )?;
    let stored = statement.query_map(params![session_id, ORCHESTRATOR_STEERING_TARGET], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    for stored_row in stored {
        let (id, event_json, created_at) = stored_row?;
        let entry = decode_transcript_log_entry(&event_json).ok_or_else(|| {
            anyhow!("thread_events row {id} under '{ORCHESTRATOR_STEERING_TARGET}' is not a transcript log entry")
        })?;
        if entry.idx < blob_len {
            continue;
        }
        let expected = rows.len() as u64;
        if entry.idx != expected {
            return Err(anyhow!(
                "transcript log is not contiguous: expected idx {expected}, found {}",
                entry.idx
            ));
        }
        let canonical = entry.message_json.into_bytes();
        let message = serde_json::from_slice(&canonical).with_context(|| {
            format!("thread_events row {id} holds an undecodable transcript message")
        })?;
        rows.push(ForkTranscriptRow {
            message,
            canonical,
            created_at: Some(created_at),
            event_id: Some(id),
        });
    }
    Ok(rows)
}

pub(crate) fn validate_fork_boundary_in_connection(
    connection: &Connection,
    source_session_id: &str,
    token: &str,
    active_run: bool,
) -> std::result::Result<(ValidatedForkBoundary, Vec<Message>), ForkBoundaryValidationError> {
    let payload = decode_fork_boundary_token(token)?;
    if payload.source_session_id != source_session_id {
        return Err(ForkBoundaryValidationError::WrongSession);
    }
    let rows = load_fork_transcript_rows(connection, source_session_id)
        .map_err(|_| ForkBoundaryValidationError::Stale)?;
    let end = usize::try_from(payload.raw_end_exclusive)
        .map_err(|_| ForkBoundaryValidationError::Stale)?;
    if end == 0 || end > rows.len() {
        return Err(ForkBoundaryValidationError::Stale);
    }
    let boundary = end - 1;
    let messages: Vec<Message> = rows.iter().map(|row| row.message.clone()).collect();
    if !complete_assistant_boundaries(&messages)[boundary]
        || rows[boundary].event_id != payload.boundary_event_id
        || prefix_digest(&rows, end) != payload.prefix_sha256
    {
        return Err(ForkBoundaryValidationError::Stale);
    }
    if boundary_is_mutable(&messages, boundary, active_run) {
        return Err(ForkBoundaryValidationError::Mutable);
    }
    Ok((
        ValidatedForkBoundary {
            raw_end_exclusive: payload.raw_end_exclusive,
            prefix_sha256: payload.prefix_sha256,
            boundary_event_id: payload.boundary_event_id,
        },
        messages.into_iter().take(end).collect(),
    ))
}

impl TranscriptLogWriter {
    pub fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            connection: Mutex::new(open_runtime_connection(path)?),
        })
    }

    /// Read the immutable blob and append-only log under one SQLite read
    /// transaction, then issue v1 tokens for complete assistant boundaries.
    /// `active_run` suppresses the current cycle's mutable tail boundaries.
    pub fn fork_boundary_projection(
        &self,
        session_id: &str,
        active_run: bool,
    ) -> Result<ForkBoundaryProjection> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction = connection.transaction()?;
        let rows = load_fork_transcript_rows(&transaction, session_id)?;
        transaction.commit()?;
        let messages: Vec<Message> = rows.iter().map(|row| row.message.clone()).collect();
        let complete_boundaries = complete_assistant_boundaries(&messages);
        let mut tokens = Vec::with_capacity(rows.len());
        let mut hasher = Sha256::new();
        hasher.update(FORK_BOUNDARY_DIGEST_DOMAIN);
        for (boundary, row) in rows.iter().enumerate() {
            hasher.update((row.canonical.len() as u64).to_be_bytes());
            hasher.update(&row.canonical);
            if !complete_boundaries[boundary]
                || boundary_is_mutable(&messages, boundary, active_run)
            {
                tokens.push(None);
                continue;
            }
            let raw_end_exclusive = (boundary + 1) as u64;
            let payload = ForkBoundaryTokenV1 {
                format_version: 1,
                source_session_id: session_id.to_string(),
                raw_end_exclusive,
                prefix_sha256: finish_prefix_digest(hasher.clone(), boundary + 1),
                boundary_event_id: row.event_id,
            };
            tokens.push(Some(encode_fork_boundary_token(&payload)?));
        }
        Ok(ForkBoundaryProjection {
            messages,
            created_at: rows.iter().map(|row| row.created_at.clone()).collect(),
            fork_boundary_tokens: tokens,
        })
    }

    /// Revalidate every untrusted v1 token field against one current store
    /// snapshot. Tail appends do not matter; replacement of the boundary row
    /// does, even when regeneration produces byte-identical content.
    pub fn validate_fork_boundary(
        &self,
        source_session_id: &str,
        token: &str,
        active_run: bool,
    ) -> std::result::Result<ValidatedForkBoundary, ForkBoundaryValidationError> {
        let payload = decode_fork_boundary_token(token)?;
        if payload.source_session_id != source_session_id {
            return Err(ForkBoundaryValidationError::WrongSession);
        }
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction = connection
            .transaction()
            .map_err(|_| ForkBoundaryValidationError::Stale)?;
        let (validated, _) = validate_fork_boundary_in_connection(
            &transaction,
            source_session_id,
            token,
            active_run,
        )?;
        transaction
            .commit()
            .map_err(|_| ForkBoundaryValidationError::Stale)?;
        Ok(validated)
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
        let visible_delta = i64::try_from(crate::sessions::visible_message_count(messages))
            .context("transcript visible message count overflowed")?;
        let last_user_prompt = crate::sessions::last_user_prompt(messages);
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let transaction =
            connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
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
        transaction.commit()?;
        Ok(())
    }

    /// Atomically admits an `admitting` queued run as the next canonical User
    /// message. The transcript append, session summary, receipt transition,
    /// and queue deletion either all commit or all roll back.
    #[allow(dead_code)] // consumed by the queued-run lifecycle layer in the next lane
    pub fn append_admitting_queued_user(
        &self,
        session_id: &str,
        queued_run_id: &str,
        admitted_run_id: &str,
        idx: u64,
    ) -> Result<Message> {
        let mut connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        super::queued_runs::append_admitting_user_and_consume(
            &mut connection,
            session_id,
            queued_run_id,
            admitted_run_id,
            idx,
        )
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
    /// The extent probe and the window read run under one connection lock,
    /// so a concurrent append cannot interleave and shift the window. Rowid
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
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
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
        let mut expected_idx = blob_len + tail_start;
        for (idx, _) in &entries {
            if *idx != expected_idx {
                return Err(anyhow!(
                    "transcript log tail window is not contiguous: expected idx {expected_idx}, found {idx}"
                ));
            }
            expected_idx += 1;
        }
        Ok((tail_len, entries))
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
        if !row_ids.is_empty() {
            refresh_session_summary(&transaction, session_id)?;
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
                duration_ms: None,
                model_origin: None,
                reasoning_field: None,
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
    fn transcript_log_append_batch_assigns_contiguous_indices_and_is_empty_noop() {
        let path = temp_store_path("append_batch");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");

        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer.append_batch("session-a", 0, &[]).unwrap();
        assert!(writer.read_from("session-a", 0).unwrap().is_empty());

        let messages = sample_messages();
        writer.append_batch("session-a", 4, &messages).unwrap();
        let all = writer.read_from("session-a", 0).unwrap();
        assert_eq!(all.len(), messages.len());
        for (position, ((idx, read), expected)) in all.iter().zip(messages.iter()).enumerate() {
            assert_eq!(*idx as usize, 4 + position);
            assert_eq!(canonical(read), canonical(expected));
        }

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
                        content: "tool output".to_string(),
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

    fn final_assistant(content: &str) -> Message {
        Message::Assistant {
            content: Some(content.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        }
    }

    #[test]
    fn fork_boundary_tokens_survive_appends_and_use_event_ids_for_aba_safety() {
        let path = temp_store_path("fork_boundary_aba");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "session-a",
                0,
                &[
                    Message::User {
                        content: "prompt".to_string(),
                    },
                    final_assistant("answer"),
                ],
            )
            .unwrap();
        let token = writer
            .fork_boundary_projection("session-a", false)
            .unwrap()
            .fork_boundary_tokens[1]
            .clone()
            .unwrap();
        let validated = writer
            .validate_fork_boundary("session-a", &token, false)
            .unwrap();
        assert_eq!(validated.raw_end_exclusive, 2);
        assert!(validated.boundary_event_id.is_some());

        writer
            .append(
                "session-a",
                2,
                &Message::User {
                    content: "later".into(),
                },
            )
            .unwrap();
        assert!(writer
            .validate_fork_boundary("session-a", &token, true)
            .is_ok());

        writer.delete_from("session-a", 1).unwrap();
        writer
            .append("session-a", 1, &final_assistant("answer"))
            .unwrap();
        assert_eq!(
            writer.validate_fork_boundary("session-a", &token, false),
            Err(ForkBoundaryValidationError::Stale),
            "byte-identical regeneration must not recreate the row occurrence"
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn fork_boundaries_reject_untrusted_tokens_and_active_mutable_tail() {
        let path = temp_store_path("fork_boundary_validation");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_batch(
                "session-a",
                0,
                &[
                    Message::User {
                        content: "one".into(),
                    },
                    final_assistant("first"),
                    Message::User {
                        content: "two".into(),
                    },
                    final_assistant("second"),
                ],
            )
            .unwrap();
        let inactive = writer.fork_boundary_projection("session-a", false).unwrap();
        let historical = inactive.fork_boundary_tokens[1].clone().unwrap();
        let latest = inactive.fork_boundary_tokens[3].clone().unwrap();
        let active = writer.fork_boundary_projection("session-a", true).unwrap();
        assert!(active.fork_boundary_tokens[1].is_some());
        assert!(active.fork_boundary_tokens[3].is_none());
        assert!(writer
            .validate_fork_boundary("session-a", &historical, true)
            .is_ok());
        assert_eq!(
            writer.validate_fork_boundary("session-a", &latest, true),
            Err(ForkBoundaryValidationError::Mutable)
        );
        assert_eq!(
            writer.validate_fork_boundary("session-b", &historical, false),
            Err(ForkBoundaryValidationError::WrongSession)
        );
        assert_eq!(
            writer.validate_fork_boundary("session-a", "garbage", false),
            Err(ForkBoundaryValidationError::InvalidToken)
        );

        let mut tampered = decode_fork_boundary_token(&historical).unwrap();
        let replacement = if tampered.prefix_sha256.starts_with('0') {
            "1"
        } else {
            "0"
        };
        tampered.prefix_sha256.replace_range(0..1, replacement);
        let tampered = encode_fork_boundary_token(&tampered).unwrap();
        assert_eq!(
            writer.validate_fork_boundary("session-a", &tampered, false),
            Err(ForkBoundaryValidationError::Stale)
        );
        let mut unsupported = decode_fork_boundary_token(&historical).unwrap();
        unsupported.format_version = 2;
        let unsupported = encode_fork_boundary_token(&unsupported).unwrap();
        assert_eq!(
            writer.validate_fork_boundary("session-a", &unsupported, false),
            Err(ForkBoundaryValidationError::InvalidToken)
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn fork_boundary_projection_supports_legacy_blob_and_protocol_completeness() {
        let path = temp_store_path("fork_boundary_blob");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        let blob = vec![
            Message::System {
                content: "system".into(),
            },
            Message::User {
                content: "legacy".into(),
            },
            final_assistant("legacy answer"),
        ];
        open_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET messages_json = ?1 WHERE session_id = 'session-a'",
                params![serde_json::to_string(&blob).unwrap()],
            )
            .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        let projection = writer.fork_boundary_projection("session-a", false).unwrap();
        let token = projection.fork_boundary_tokens[2].clone().unwrap();
        assert_eq!(projection.created_at, vec![None, None, None]);
        assert_eq!(
            writer
                .validate_fork_boundary("session-a", &token, false)
                .unwrap()
                .boundary_event_id,
            None
        );

        writer
            .append_batch(
                "session-a",
                3,
                &[
                    Message::Assistant {
                        content: None,
                        reasoning_text: None,
                        reasoning_details: None,
                        tool_calls: Some(vec![crate::types::ToolCall {
                            id: "call-1".into(),
                            call_type: "function".into(),
                            function: crate::types::FunctionCall {
                                name: "read".into(),
                                arguments: "{}".into(),
                            },
                        }]),
                        duration_ms: None,
                        model_origin: None,
                        reasoning_field: None,
                    },
                    final_assistant("invalid adjacency"),
                ],
            )
            .unwrap();
        let projection = writer.fork_boundary_projection("session-a", false).unwrap();
        assert!(projection.fork_boundary_tokens[4].is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
