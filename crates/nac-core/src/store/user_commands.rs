//! Durable user-submitted commands; the terminal state commits with its transcript record.
use super::transcript_append::TranscriptAppendReceipt;
use super::*;
use crate::terminal::CommandOutput;
use crate::types::Message;
use rusqlite::TransactionBehavior;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum UserCommandState {
    Admitted,
    Executing,
    Completed,
    TimedOut,
    Cancelled,
    SpawnFailed,
    Rejected,
    Interrupted,
    OutcomeUnknown,
}

impl UserCommandState {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Admitted | Self::Executing)
    }

    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Admitted => "admitted",
            Self::Executing => "executing",
            Self::Completed => "completed",
            Self::TimedOut => "timed_out",
            Self::Cancelled => "cancelled",
            Self::SpawnFailed => "spawn_failed",
            Self::Rejected => "rejected",
            Self::Interrupted => "interrupted",
            Self::OutcomeUnknown => "outcome_unknown",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "admitted" => Self::Admitted,
            "executing" => Self::Executing,
            "completed" => Self::Completed,
            "timed_out" => Self::TimedOut,
            "cancelled" => Self::Cancelled,
            "spawn_failed" => Self::SpawnFailed,
            "rejected" => Self::Rejected,
            "interrupted" => Self::Interrupted,
            "outcome_unknown" => Self::OutcomeUnknown,
            other => return Err(anyhow!("unsupported user command state '{other}'")),
        })
    }
}

/// Redacted projection of one durable user command; `message_index` is its raw transcript index.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct UserCommandSnapshot {
    pub request_id: String,
    pub command: String,
    pub timeout_ms: u64,
    pub state: UserCommandState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wall_time_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub stdout_preview: String,
    #[serde(default)]
    pub stderr_preview: String,
    #[serde(default)]
    pub truncated: bool,
    #[serde(default)]
    pub overflowed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub process_started: bool,
    pub created_at_epoch_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at_epoch_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message_index: Option<usize>,
}

impl UserCommandSnapshot {
    fn with_result(mut self, result: Option<&CommandOutput>) -> Self {
        if let Some(result) = result {
            self.exit_code = result.exit_code;
            self.wall_time_ms = Some(result.wall_time_ms);
            self.stdout_preview = result.stdout_preview.clone();
            self.stderr_preview = result.stderr_preview.clone();
            self.truncated = result.truncated;
            self.overflowed = result.overflowed;
            self.output_id = result.output_id.clone();
        }
        self
    }

    pub(crate) fn finished(&self, terminal: &UserCommandTerminal) -> Self {
        Self {
            state: terminal.state,
            reason: terminal.reason.clone(),
            process_started: terminal.process_started,
            finished_at_epoch_ms: Some(terminal.finished_at_epoch_ms),
            message_index: None,
            ..self.clone()
        }
        .with_result(terminal.result.as_ref())
    }
}

/// The deterministic attributed transcript record of one terminal user command.
pub(crate) fn user_command_record(snapshot: &UserCommandSnapshot) -> Message {
    let mut lines = vec![
        "<user_command>".to_string(),
        "The user ran this shell command directly; the assistant did not run it.".to_string(),
        format!("command: {}", snapshot.command),
        format!(
            "cwd: {}",
            snapshot.cwd.as_deref().unwrap_or("session default")
        ),
        format!("state: {}", snapshot.state.as_str()),
        format!("timeout_ms: {}", snapshot.timeout_ms),
    ];
    if let Some(exit_code) = snapshot.exit_code {
        lines.push(format!("exit_code: {exit_code}"));
    }
    if let Some(wall_time_ms) = snapshot.wall_time_ms {
        lines.push(format!("duration_ms: {wall_time_ms}"));
    }
    if let Some(reason) = &snapshot.reason {
        lines.push(format!("reason: {reason}"));
    }
    if snapshot.truncated || snapshot.overflowed {
        lines.push("output: truncated".to_string());
    }
    if let Some(output_id) = &snapshot.output_id {
        lines.push(format!("output_id: {output_id}"));
    }
    for (name, preview) in [
        ("stdout", &snapshot.stdout_preview),
        ("stderr", &snapshot.stderr_preview),
    ] {
        if !preview.is_empty() {
            lines.push(format!("{name}:\n{preview}"));
        }
    }
    lines.push("</user_command>".to_string());
    Message::User {
        content: lines.join("\n"),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct StoredUserCommand {
    pub snapshot: UserCommandSnapshot,
    pub payload_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UserCommandAdmitOutcome {
    Admitted(UserCommandSnapshot),
    Existing(StoredUserCommand),
    Busy(UserCommandSnapshot),
}

/// Terminal facts committed with the record; the write fails unless the row is still `from`.
#[derive(Debug, Clone)]
pub(crate) struct UserCommandTerminal {
    pub from: UserCommandState,
    pub state: UserCommandState,
    pub result: Option<CommandOutput>,
    pub reason: Option<String>,
    pub process_started: bool,
    pub finished_at_epoch_ms: u64,
}

const SELECT_USER_COMMAND: &str = "SELECT c.request_id, c.command, c.timeout_ms, c.state,
        c.result_json, c.reason, c.cwd, c.process_started, c.created_at_epoch_ms,
        c.finished_at_epoch_ms, json_extract(e.event_json, '$.nac_transcript_message.idx'),
        c.payload_digest
     FROM session_user_commands c
     LEFT JOIN thread_events e ON e.id = c.transcript_message_id";

fn row_to_user_command(row: &rusqlite::Row<'_>) -> rusqlite::Result<(StoredUserCommand, String)> {
    let result = row
        .get::<_, Option<String>>(4)?
        .and_then(|json| serde_json::from_str::<CommandOutput>(&json).ok());
    let snapshot = UserCommandSnapshot {
        request_id: row.get(0)?,
        command: row.get(1)?,
        timeout_ms: row.get(2)?,
        state: UserCommandState::Admitted,
        exit_code: None,
        wall_time_ms: None,
        cwd: row.get(6)?,
        stdout_preview: String::new(),
        stderr_preview: String::new(),
        truncated: false,
        overflowed: false,
        output_id: None,
        reason: row.get(5)?,
        process_started: row.get(7)?,
        created_at_epoch_ms: row.get(8)?,
        finished_at_epoch_ms: row.get(9)?,
        message_index: row.get::<_, Option<i64>>(10)?.map(|idx| idx as usize),
    }
    .with_result(result.as_ref());
    Ok((
        StoredUserCommand {
            snapshot,
            payload_digest: row.get(11)?,
        },
        row.get(3)?,
    ))
}

fn decode_user_command(
    (mut stored, state): (StoredUserCommand, String),
) -> Result<StoredUserCommand> {
    stored.snapshot.state = UserCommandState::parse(&state)?;
    Ok(stored)
}

fn find_user_command_with_connection(
    conn: &Connection,
    session_id: &str,
    request_id: &str,
) -> Result<Option<StoredUserCommand>> {
    conn.query_row(
        &format!("{SELECT_USER_COMMAND} WHERE c.session_id = ?1 AND c.request_id = ?2"),
        params![session_id, request_id],
        row_to_user_command,
    )
    .optional()?
    .map(decode_user_command)
    .transpose()
}

pub(crate) fn list_user_commands_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<UserCommandSnapshot>> {
    let mut statement = conn.prepare(&format!(
        "{SELECT_USER_COMMAND} WHERE c.session_id = ?1 ORDER BY c.created_at_epoch_ms, c.rowid"
    ))?;
    let rows = statement
        .query_map(params![session_id], row_to_user_command)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| decode_user_command(row).map(|stored| stored.snapshot))
        .collect()
}

coordinated_command! {
pub(crate) fn find_user_command(
    path: &Path,
    session_id: &str,
    request_id: &str,
) -> Result<Option<StoredUserCommand>> {
    let connection = open_runtime_connection(path)?;
    find_user_command_with_connection(&connection, session_id, request_id)
}
command FindUserCommandCommand {
    session_id: String = session_id.to_owned(),
    request_id: String = request_id.to_owned(),
}
call |command| (&command.session_id, &command.request_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
pub(crate) fn list_user_commands(path: &Path, session_id: &str) -> Result<Vec<UserCommandSnapshot>> {
    let connection = open_runtime_connection(path)?;
    list_user_commands_with_connection(&connection, session_id)
}
command ListUserCommandsCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// The caller holds the session operation lease and has checked idleness.
pub(crate) fn admit_user_command(
    path: &Path,
    session_id: &str,
    request_id: &str,
    payload_digest: &str,
    command: &str,
    timeout_ms: u64,
    cwd: Option<&str>,
) -> Result<UserCommandAdmitOutcome> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if let Some(existing) = find_user_command_with_connection(&transaction, session_id, request_id)? {
        return Ok(UserCommandAdmitOutcome::Existing(existing));
    }
    let active = transaction
        .query_row(
            "SELECT request_id FROM session_user_commands
             WHERE session_id = ?1 AND state IN ('admitted', 'executing')",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    if let Some(active) = active {
        let active = find_user_command_with_connection(&transaction, session_id, &active)?
            .context("active user command disappeared inside its transaction")?;
        return Ok(UserCommandAdmitOutcome::Busy(active.snapshot));
    }
    transaction.execute(
        "INSERT INTO session_user_commands
             (session_id, request_id, payload_digest, command, timeout_ms, state, cwd,
              created_at_epoch_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, 'admitted', ?6, ?7)",
        params![session_id, request_id, payload_digest, command, timeout_ms, cwd, epoch_ms_now()],
    )?;
    let admitted = find_user_command_with_connection(&transaction, session_id, request_id)?
        .context("admitted user command was not readable inside its transaction")?;
    transaction.commit()?;
    Ok(UserCommandAdmitOutcome::Admitted(admitted.snapshot))
}
command AdmitUserCommandCommand {
    session_id: String = session_id.to_owned(),
    request_id: String = request_id.to_owned(),
    payload_digest: String = payload_digest.to_owned(),
    command: String = command.to_owned(),
    timeout_ms: u64 = timeout_ms,
    cwd: Option<String> = cwd.map(str::to_owned),
}
call |command| (
    &command.session_id,
    &command.request_id,
    &command.payload_digest,
    &command.command,
    command.timeout_ms,
    command.cwd.as_deref(),
)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

coordinated_command! {
/// Only the caller that moved the row from Admitted to Executing may spawn.
pub(crate) fn mark_user_command_executing(
    path: &Path,
    session_id: &str,
    request_id: &str,
) -> Result<bool> {
    #[cfg(test)]
    if take_user_command_start_fault(request_id) {
        return Err(anyhow!("injected user command start fault"));
    }
    let connection = open_runtime_connection(path)?;
    let changed = connection.execute(
        "UPDATE session_user_commands SET state = 'executing'
         WHERE session_id = ?1 AND request_id = ?2 AND state = 'admitted'",
        params![session_id, request_id],
    )?;
    Ok(changed == 1)
}
command MarkUserCommandExecutingCommand {
    session_id: String = session_id.to_owned(),
    request_id: String = request_id.to_owned(),
}
call |command| (&command.session_id, &command.request_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port internal;
}

fn unsettled_user_command_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<UserCommandSnapshot>> {
    let request_id = conn
        .query_row(
            "SELECT request_id FROM session_user_commands
             WHERE session_id = ?1 AND state IN ('admitted', 'executing')",
            params![session_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(match request_id {
        Some(request_id) => find_user_command_with_connection(conn, session_id, &request_id)?
            .map(|stored| stored.snapshot),
        None => None,
    })
}

coordinated_command! {
pub(crate) fn load_unsettled_user_command(
    path: &Path,
    session_id: &str,
) -> Result<Option<UserCommandSnapshot>> {
    let connection = open_runtime_connection(path)?;
    unsettled_user_command_with_connection(&connection, session_id)
}
command LoadUnsettledUserCommandCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// The caller holds the session operation lease, so no executor owns a non-terminal row.
pub(crate) fn reconcile_unsettled_user_command(
    path: &Path,
    session_id: &str,
) -> Result<Option<UserCommandSnapshot>> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(unsettled) = unsettled_user_command_with_connection(&transaction, session_id)? else {
        return Ok(None);
    };
    let (state, reason) = if unsettled.state == UserCommandState::Admitted {
        (UserCommandState::Interrupted, "nac stopped before the command started; it was not run")
    } else {
        (
            UserCommandState::OutcomeUnknown,
            "nac stopped while the command was executing; its outcome is unknown and it was not rerun",
        )
    };
    let terminal = UserCommandTerminal {
        from: unsettled.state,
        state,
        result: None,
        reason: Some(reason.to_string()),
        process_started: false,
        finished_at_epoch_ms: epoch_ms_now(),
    };
    let record = user_command_record(&unsettled.finished(&terminal));
    let start_idx = super::transcript::next_append_idx(&transaction, session_id)?;
    super::transcript::append_messages_in_transaction(
        &transaction,
        session_id,
        start_idx,
        std::slice::from_ref(&record),
    )?;
    finish_user_command_in_transaction(&transaction, session_id, &unsettled.request_id, &terminal)?;
    let reconciled = find_user_command_with_connection(&transaction, session_id, &unsettled.request_id)?
        .map(|stored| stored.snapshot);
    transaction.commit()?;
    Ok(reconciled)
}
command ReconcileUnsettledUserCommandCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

/// Precondition: the row is still `terminal.from`; the record was just appended.
fn finish_user_command_in_transaction(
    transaction: &Transaction<'_>,
    session_id: &str,
    request_id: &str,
    terminal: &UserCommandTerminal,
) -> Result<()> {
    let result_json = terminal
        .result
        .as_ref()
        .map(serde_json::to_string)
        .transpose()?;
    let changed = transaction.execute(
        "UPDATE session_user_commands
         SET state = ?3, result_json = ?4, reason = ?5, process_started = ?6,
             finished_at_epoch_ms = ?7, transcript_message_id = ?8
         WHERE session_id = ?1 AND request_id = ?2 AND state = ?9",
        params![
            session_id,
            request_id,
            terminal.state.as_str(),
            result_json,
            terminal.reason,
            terminal.process_started,
            terminal.finished_at_epoch_ms,
            transaction.last_insert_rowid(),
            terminal.from.as_str(),
        ],
    )?;
    if changed != 1 {
        return Err(anyhow!(
            "user command {request_id} is no longer {}",
            terminal.from.as_str()
        ));
    }
    Ok(())
}

impl TranscriptLogWriter {
    /// Replaying the same record returns the prior receipt; a different record conflicts.
    pub(crate) fn commit_user_command(
        &self,
        session_id: &str,
        request_id: &str,
        record: &Message,
        terminal: &UserCommandTerminal,
    ) -> Result<TranscriptAppendReceipt> {
        coordinate_writer!(self, Result<TranscriptAppendReceipt>, {
            session_id: String = session_id.to_owned(),
            request_id: String = request_id.to_owned(),
            record: Message = record.clone(),
            terminal: UserCommandTerminal = terminal.clone(),
        }, call |command| command.writer.commit_user_command(&command.session_id, &command.request_id, &command.record, &command.terminal),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        self.commit_append(
            session_id,
            &super::transcript_append::user_command_scope(request_id),
            None,
            std::slice::from_ref(record),
            AppendPurpose::UserCommand(request_id),
            |transaction| {
                finish_user_command_in_transaction(transaction, session_id, request_id, terminal)
            },
        )
    }
}

#[cfg(test)]
static USER_COMMAND_START_FAULTS: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[cfg(test)]
pub(crate) fn fail_next_user_command_start_for_test(request_id: &str) {
    USER_COMMAND_START_FAULTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .push(request_id.to_owned());
}

#[cfg(test)]
fn take_user_command_start_fault(request_id: &str) -> bool {
    let mut faults = USER_COMMAND_START_FAULTS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let before = faults.len();
    faults.retain(|fault| fault != request_id);
    faults.len() != before
}

fn epoch_ms_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}
