//! Durable history of tool-free questions a person asked about a selected
//! excerpt of a completed assistant reply. These records live beside the
//! conversation, never inside it: nothing here reads or writes the session's
//! transcript log, inbox, goals, run recovery or operation lease.
//!
//! A question's in-flight owner retains a per-session cross-process question
//! lease (distinct from the session operation lease). A `pending` row whose
//! lease is acquirable therefore has no live owner and is settled as
//! `interrupted`; it is never replayed against the provider.
use super::*;
use serde::{Deserialize, Serialize};

/// Bounded history kept per session; admission prunes the oldest settled rows.
pub const SELECTION_QUESTION_HISTORY_LIMIT: usize = 50;

const PRECEDING_PROMPT_SCAN_LIMIT: u64 = 512;
const INTERRUPTED_ERROR: &str =
    "The server stopped before this question was answered. It was not sent again.";
const CANCELED_ERROR: &str = "You canceled this question.";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum SelectionQuestionStatus {
    Pending,
    Answered,
    Failed,
    Canceled,
    Interrupted,
}

impl SelectionQuestionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Answered => "answered",
            Self::Failed => "failed",
            Self::Canceled => "canceled",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "pending" => Self::Pending,
            "answered" => Self::Answered,
            "failed" => Self::Failed,
            "canceled" => Self::Canceled,
            "interrupted" => Self::Interrupted,
            other => return Err(anyhow!("unknown selection question status {other:?}")),
        })
    }
}

/// The frozen, model-visible context. It is captured once at admission and
/// never re-read from the transcript, so later appends cannot retarget it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SelectionQuestionContext {
    /// Canonical transcript index of the originating assistant message.
    pub source_message_index: u64,
    /// SHA-256 (hex) of that message's complete visible text.
    pub source_content_sha256: String,
    /// Unicode scalar offsets of the excerpt within the visible text.
    pub selection_start: u64,
    pub selection_end: u64,
    pub excerpt: String,
    /// The originating visible assistant text, windowed around the excerpt
    /// when it exceeds the documented limit.
    pub source_text: String,
    pub source_text_truncated: bool,
    /// What the person typed before that reply, if the transcript has it.
    pub preceding_prompt: Option<String>,
    pub preceding_prompt_truncated: bool,
    pub question: String,
}

/// The model/configuration the question was pinned to when it was admitted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SelectionQuestionModel {
    pub model: String,
    pub backend: String,
    pub config_version: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionQuestionAdmission {
    pub question_id: String,
    pub session_id: String,
    pub request_key: String,
    pub request_digest: String,
    pub context: SelectionQuestionContext,
    pub model: SelectionQuestionModel,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionQuestionRecord {
    pub question_id: String,
    pub session_id: String,
    pub request_key: String,
    pub status: SelectionQuestionStatus,
    pub context: SelectionQuestionContext,
    pub model: SelectionQuestionModel,
    pub answer: Option<String>,
    pub answer_truncated: bool,
    pub error: Option<String>,
    pub tool_call_attempted: bool,
    /// Usage of this question's own provider call. It is never added to the
    /// session's run accounting, so the source run is not double-counted.
    pub usage: Option<crate::model::TokenUsage>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

/// A provider outcome; only `Answered` and `Failed` are recorded this way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionQuestionSettlement {
    pub status: SelectionQuestionStatus,
    pub answer: Option<String>,
    pub answer_truncated: bool,
    pub error: Option<String>,
    pub tool_call_attempted: bool,
    pub usage: Option<crate::model::TokenUsage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SelectionQuestionAdmitted {
    pub record: SelectionQuestionRecord,
    pub replayed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionQuestionStoreError {
    /// The request key was already used with different arguments.
    IdentityConflict,
}

impl std::fmt::Display for SelectionQuestionStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::IdentityConflict => {
                "this request key was already used for a different question; use a new key"
            }
        })
    }
}

impl std::error::Error for SelectionQuestionStoreError {}

/// What the transcript holds at one canonical index, read in one snapshot.
#[derive(Debug, Clone)]
pub enum SelectionSourceRead {
    Missing,
    Found {
        message: crate::types::Message,
        /// Raw content of the nearest earlier user message, if any.
        preceding_user: Option<String>,
    },
}

/// The cross-process lease name that marks a live in-flight question owner.
pub fn selection_question_lease_name(session_id: &str) -> String {
    format!("selection-question:{session_id}")
}

pub(super) fn create_selection_questions_table(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS selection_questions (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             question_id TEXT NOT NULL UNIQUE CHECK (length(question_id) = 36),
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             request_key TEXT NOT NULL CHECK (length(request_key) = 36),
             request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
             source_message_index INTEGER NOT NULL CHECK (source_message_index >= 0),
             context_json TEXT NOT NULL,
             model_json TEXT NOT NULL,
             status TEXT NOT NULL CHECK (status IN
                 ('pending', 'answered', 'failed', 'canceled', 'interrupted')),
             answer TEXT,
             answer_truncated INTEGER NOT NULL DEFAULT 0 CHECK (answer_truncated IN (0, 1)),
             error TEXT,
             tool_call_attempted INTEGER NOT NULL DEFAULT 0
                 CHECK (tool_call_attempted IN (0, 1)),
             usage_json TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             completed_at TEXT,
             CHECK ((status = 'pending') = (completed_at IS NULL)),
             CHECK (status = 'answered' OR answer IS NULL),
             UNIQUE (session_id, request_key)
         );
         CREATE INDEX IF NOT EXISTS idx_selection_questions_session
             ON selection_questions(session_id, id);
         CREATE UNIQUE INDEX IF NOT EXISTS idx_selection_questions_one_pending
             ON selection_questions(session_id) WHERE status = 'pending';",
    )?;
    Ok(())
}

const COLUMNS: &str = "question_id, session_id, request_key, status, context_json, model_json,
    answer, answer_truncated, error, tool_call_attempted, usage_json, created_at, updated_at,
    completed_at";

fn record_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawRecord> {
    Ok(RawRecord {
        question_id: row.get(0)?,
        session_id: row.get(1)?,
        request_key: row.get(2)?,
        status: row.get(3)?,
        context_json: row.get(4)?,
        model_json: row.get(5)?,
        answer: row.get(6)?,
        answer_truncated: row.get(7)?,
        error: row.get(8)?,
        tool_call_attempted: row.get(9)?,
        usage_json: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        completed_at: row.get(13)?,
    })
}

struct RawRecord {
    question_id: String,
    session_id: String,
    request_key: String,
    status: String,
    context_json: String,
    model_json: String,
    answer: Option<String>,
    answer_truncated: bool,
    error: Option<String>,
    tool_call_attempted: bool,
    usage_json: Option<String>,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
}

impl RawRecord {
    fn decode(self) -> Result<SelectionQuestionRecord> {
        Ok(SelectionQuestionRecord {
            question_id: self.question_id,
            session_id: self.session_id,
            request_key: self.request_key,
            status: SelectionQuestionStatus::parse(&self.status)?,
            context: serde_json::from_str(&self.context_json)
                .context("selection question context is undecodable")?,
            model: serde_json::from_str(&self.model_json)
                .context("selection question model is undecodable")?,
            answer: self.answer,
            answer_truncated: self.answer_truncated,
            error: self.error,
            tool_call_attempted: self.tool_call_attempted,
            usage: self
                .usage_json
                .as_deref()
                .map(serde_json::from_str)
                .transpose()
                .context("selection question usage is undecodable")?,
            created_at: self.created_at,
            updated_at: self.updated_at,
            completed_at: self.completed_at,
        })
    }
}

fn load_by_id(
    conn: &Connection,
    session_id: &str,
    question_id: &str,
) -> Result<Option<SelectionQuestionRecord>> {
    conn.query_row(
        &format!(
            "SELECT {COLUMNS} FROM selection_questions WHERE session_id = ?1 AND question_id = ?2"
        ),
        params![session_id, question_id],
        record_from_row,
    )
    .optional()?
    .map(RawRecord::decode)
    .transpose()
}

fn receipt(
    conn: &Connection,
    session_id: &str,
    request_key: &str,
    request_digest: &str,
) -> Result<Option<SelectionQuestionRecord>> {
    let found: Option<(String, String)> = conn
        .query_row(
            "SELECT question_id, request_digest FROM selection_questions
             WHERE session_id = ?1 AND request_key = ?2",
            params![session_id, request_key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((question_id, digest)) = found else {
        return Ok(None);
    };
    if digest != request_digest {
        return Err(SelectionQuestionStoreError::IdentityConflict.into());
    }
    load_by_id(conn, session_id, &question_id)
}

fn interrupt_pending(conn: &Connection, session_id: &str) -> Result<usize> {
    let now = now_utc();
    Ok(conn.execute(
        "UPDATE selection_questions
         SET status = 'interrupted', error = ?2, updated_at = ?3, completed_at = ?3
         WHERE session_id = ?1 AND status = 'pending'",
        params![session_id, INTERRUPTED_ERROR, now],
    )?)
}

coordinated_command! {
/// Return the existing record for an identical retry. A reused key with
/// different arguments is an identity conflict.
pub fn find_selection_question_receipt(path: &Path, session_id: &str, request_key: &str, request_digest: &str) -> Result<Option<SelectionQuestionRecord>> {
    let connection = open_runtime_connection(path)?;
    receipt(&connection, session_id, request_key, request_digest)
}
command FindSelectionQuestionReceiptCommand {
    session_id: String = session_id.to_owned(),
    request_key: String = request_key.to_owned(),
    request_digest: String = request_digest.to_owned(),
}
call |command| (&command.session_id, &command.request_key, &command.request_digest)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Admit one question. The caller must hold the session's question lease:
/// any row still `pending` therefore has no live owner and is settled as
/// `interrupted` in this same transaction before the new row is inserted.
/// The oldest settled rows beyond the history limit are pruned.
pub fn admit_selection_question(path: &Path, admission: &SelectionQuestionAdmission) -> Result<SelectionQuestionAdmitted> {
    let context_json = serde_json::to_string(&admission.context)?;
    let model_json = serde_json::to_string(&admission.model)?;
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    if let Some(record) = receipt(
        &transaction,
        &admission.session_id,
        &admission.request_key,
        &admission.request_digest,
    )? {
        return Ok(SelectionQuestionAdmitted { record, replayed: true });
    }
    interrupt_pending(&transaction, &admission.session_id)?;
    let now = now_utc();
    transaction.execute(
        "INSERT INTO selection_questions
             (question_id, session_id, request_key, request_digest, source_message_index,
              context_json, model_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?8)",
        params![
            admission.question_id,
            admission.session_id,
            admission.request_key,
            admission.request_digest,
            admission.context.source_message_index as i64,
            context_json,
            model_json,
            now
        ],
    )?;
    transaction.execute(
        "DELETE FROM selection_questions
         WHERE session_id = ?1 AND status != 'pending' AND id NOT IN (
             SELECT id FROM selection_questions WHERE session_id = ?1
             ORDER BY id DESC LIMIT ?2
         )",
        params![admission.session_id, SELECTION_QUESTION_HISTORY_LIMIT as i64],
    )?;
    let record = load_by_id(&transaction, &admission.session_id, &admission.question_id)?
        .ok_or_else(|| anyhow!("admitted selection question was not readable"))?;
    transaction.commit()?;
    Ok(SelectionQuestionAdmitted { record, replayed: false })
}
command AdmitSelectionQuestionCommand { admission: SelectionQuestionAdmission = admission.clone() }
call |command| (&command.admission)
correlation |command| crate::telemetry::Correlation::session(Some(&command.admission.session_id));
port public;
}

coordinated_command! {
/// Record a provider outcome only while the question is still pending. A
/// question that was canceled, interrupted or deleted keeps its state and
/// this returns `None`.
pub fn settle_selection_question(path: &Path, session_id: &str, question_id: &str, settlement: &SelectionQuestionSettlement) -> Result<Option<SelectionQuestionRecord>> {
    anyhow::ensure!(
        matches!(
            settlement.status,
            SelectionQuestionStatus::Answered | SelectionQuestionStatus::Failed
        ),
        "a provider outcome is either answered or failed"
    );
    let usage_json = settlement.usage.as_ref().map(serde_json::to_string).transpose()?;
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_utc();
    let changed = transaction.execute(
        "UPDATE selection_questions
         SET status = ?3, answer = ?4, answer_truncated = ?5, error = ?6,
             tool_call_attempted = ?7, usage_json = ?8, updated_at = ?9, completed_at = ?9
         WHERE session_id = ?1 AND question_id = ?2 AND status = 'pending'",
        params![
            session_id,
            question_id,
            settlement.status.as_str(),
            settlement.answer,
            settlement.answer_truncated,
            settlement.error,
            settlement.tool_call_attempted,
            usage_json,
            now
        ],
    )?;
    let record = if changed == 1 {
        load_by_id(&transaction, session_id, question_id)?
    } else {
        None
    };
    transaction.commit()?;
    Ok(record)
}
command SettleSelectionQuestionCommand {
    session_id: String = session_id.to_owned(),
    question_id: String = question_id.to_owned(),
    settlement: SelectionQuestionSettlement = settlement.clone(),
}
call |command| (&command.session_id, &command.question_id, &command.settlement)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Cancel one pending question. Settled questions are returned unchanged.
pub fn cancel_selection_question(path: &Path, session_id: &str, question_id: &str) -> Result<Option<SelectionQuestionRecord>> {
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let now = now_utc();
    transaction.execute(
        "UPDATE selection_questions
         SET status = 'canceled', error = ?3, updated_at = ?4, completed_at = ?4
         WHERE session_id = ?1 AND question_id = ?2 AND status = 'pending'",
        params![session_id, question_id, CANCELED_ERROR, now],
    )?;
    let record = load_by_id(&transaction, session_id, question_id)?;
    transaction.commit()?;
    Ok(record)
}
command CancelSelectionQuestionCommand {
    session_id: String = session_id.to_owned(),
    question_id: String = question_id.to_owned(),
}
call |command| (&command.session_id, &command.question_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn load_selection_question(path: &Path, session_id: &str, question_id: &str) -> Result<Option<SelectionQuestionRecord>> {
    let connection = open_runtime_connection(path)?;
    load_by_id(&connection, session_id, question_id)
}
command LoadSelectionQuestionCommand {
    session_id: String = session_id.to_owned(),
    question_id: String = question_id.to_owned(),
}
call |command| (&command.session_id, &command.question_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// The session's bounded question history, oldest first.
pub fn list_selection_questions(path: &Path, session_id: &str) -> Result<Vec<SelectionQuestionRecord>> {
    let connection = open_runtime_connection(path)?;
    let mut statement = connection.prepare(&format!(
        "SELECT {COLUMNS} FROM (
             SELECT * FROM selection_questions WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2
         ) ORDER BY id ASC"
    ))?;
    let rows = statement.query_map(
        params![session_id, SELECTION_QUESTION_HISTORY_LIMIT as i64],
        record_from_row,
    )?;
    rows.map(|row| row.map_err(anyhow::Error::from).and_then(RawRecord::decode))
        .collect()
}
command ListSelectionQuestionsCommand { session_id: String = session_id.to_owned() }
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// Settle questions whose in-flight owner disappeared. Only a session whose
/// question lease is free is touched; a live owner keeps its question.
/// This never contacts a provider and never replays a question.
pub fn interrupt_orphaned_selection_questions(path: &Path) -> Result<usize> {
    let connection = open_runtime_connection(path)?;
    let sessions = connection
        .prepare("SELECT DISTINCT session_id FROM selection_questions WHERE status = 'pending'")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut interrupted = 0;
    for session_id in sessions {
        match crate::sessions::SessionOperationLease::try_acquire(
            path,
            &selection_question_lease_name(&session_id),
        ) {
            Ok(_lease) => interrupted += interrupt_pending(&connection, &session_id)?,
            Err(crate::sessions::SessionOperationLeaseError::Busy(_)) => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(interrupted)
}
command InterruptOrphanedSelectionQuestionsCommand {}
call |_command| ()
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Read the message at one canonical transcript index and the nearest earlier
/// user message, in one read snapshot, without attaching the session or
/// taking any lease. Rows are decoded only as far back as the user prompt.
pub fn read_selection_source(path: &Path, session_id: &str, message_index: u64) -> Result<SelectionSourceRead> {
    use crate::types::Message;
    let mut connection = open_runtime_connection(path)?;
    let snapshot = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Deferred)?;
    let messages_json: Option<String> = snapshot
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    let Some(messages_json) = messages_json else {
        return Ok(SelectionSourceRead::Missing);
    };
    let blob: Vec<Message> =
        serde_json::from_str(&messages_json).context("failed to parse stored session messages")?;
    let blob_len = blob.len() as u64;
    let tail_len = super::transcript::tail_len_of(&snapshot, session_id, blob_len)?;
    if message_index >= blob_len + tail_len {
        return Ok(SelectionSourceRead::Missing);
    }
    let decode_tail = |position: u64| -> Result<Message> {
        let (id, event_json): (i64, String) = snapshot.query_row(
            "SELECT id, event_json FROM thread_events
             WHERE session_id = ?1 AND thread_name = ?2
             ORDER BY id ASC LIMIT 1 OFFSET ?3",
            params![session_id, ORCHESTRATOR_STEERING_TARGET, position as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let entry = decode_transcript_log_entry(&event_json)
            .ok_or_else(|| anyhow!("thread_events row {id} is not a transcript log entry"))?;
        anyhow::ensure!(
            entry.idx == blob_len + position,
            "transcript log is not contiguous at idx {}",
            blob_len + position
        );
        serde_json::from_str(&entry.message_json)
            .with_context(|| format!("thread_events row {id} holds an undecodable message"))
    };
    let at = |index: u64| -> Result<Message> {
        if index < blob_len {
            Ok(blob[index as usize].clone())
        } else {
            decode_tail(index - blob_len)
        }
    };
    let message = at(message_index)?;
    let mut preceding_user = None;
    // The prompt normally sits a few rows back; a pathological tool loop
    // cannot turn one question into a whole-transcript decode.
    let floor = message_index.saturating_sub(PRECEDING_PROMPT_SCAN_LIMIT);
    for index in (floor..message_index).rev() {
        if let Message::User { content } = at(index)? {
            preceding_user = Some(content);
            break;
        }
    }
    Ok(SelectionSourceRead::Found { message, preceding_user })
}
command ReadSelectionSourceCommand { session_id: String = session_id.to_owned(), message_index: u64 = message_index }
call |command| (&command.session_id, command.message_index)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(test)]
#[path = "selection_questions_tests.rs"]
mod tests;
