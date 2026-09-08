use super::*;

use crate::types::Message;
use rusqlite::TransactionBehavior;
use serde_json::value::RawValue;

#[derive(serde::Deserialize)]
struct RecoveryTranscriptPayload<'a> {
    #[serde(borrow)]
    nac_transcript_message: RecoveryTranscriptEntry<'a>,
}

#[derive(serde::Deserialize)]
struct RecoveryTranscriptEntry<'a> {
    kind: TranscriptMessageKind,
    #[serde(borrow, rename = "message")]
    message_json: &'a RawValue,
}

fn decode_recovery_entry(event_json: &str) -> Option<RecoveryTranscriptEntry<'_>> {
    serde_json::from_str::<RecoveryTranscriptPayload<'_>>(event_json)
        .ok()
        .map(|payload| payload.nac_transcript_message)
}

fn decode_recovery_message(entry: &RecoveryTranscriptEntry<'_>) -> Result<Message> {
    let message_json: String = serde_json::from_str(entry.message_json.get())
        .context("failed to decode active run transcript message envelope")?;
    serde_json::from_str(&message_json).context("failed to decode active run transcript message")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunRecoveryStatus {
    Active,
    Interrupted,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RunTerminalDisposition {
    Completed,
    Cancelled,
}

impl RunTerminalDisposition {
    fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            other => Err(anyhow!("unsupported run terminal disposition '{other}'")),
        }
    }
}

impl RunRecoveryStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Interrupted => "interrupted",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "interrupted" => Ok(Self::Interrupted),
            "failed" => Ok(Self::Failed),
            other => Err(anyhow!("unsupported run recovery status '{other}'")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRecoveryRecord {
    pub run_id: String,
    pub submitted_message_id: i64,
    pub status: RunRecoveryStatus,
    pub terminal_disposition: Option<RunTerminalDisposition>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActiveRunReconciliation {
    None,
    CanonicalTerminal,
    Failed { run_id: String },
    Interrupted { run_id: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RecoveredRunTerminal {
    Completed,
    Cancelled,
    Failed,
}

pub(crate) fn replace_with_active_run(
    transaction: &Transaction<'_>,
    session_id: &str,
    run_id: &str,
    submitted_message_id: i64,
) -> Result<()> {
    let changed = transaction.execute(
        "INSERT INTO session_run_recovery
             (session_id, run_id, submitted_message_id, status)
         VALUES (?1, ?2, ?3, 'active')
         ON CONFLICT(session_id) DO UPDATE SET
             run_id = excluded.run_id,
             submitted_message_id = excluded.submitted_message_id,
             status = 'active',
             terminal_disposition = NULL
         WHERE session_run_recovery.status IN ('interrupted', 'failed')",
        params![session_id, run_id, submitted_message_id],
    )?;
    if changed != 1 {
        return Err(anyhow!(
            "session '{session_id}' already has an active durable run"
        ));
    }
    Ok(())
}

pub(crate) fn clear_active_run(
    transaction: &Transaction<'_>,
    session_id: &str,
    run_id: &str,
    disposition: RunTerminalDisposition,
) -> Result<()> {
    let Some(record) = load_run_recovery_with_connection(transaction, session_id)? else {
        return Ok(());
    };
    if record.run_id != run_id || record.status != RunRecoveryStatus::Active {
        return Ok(());
    }
    retain_or_clear_terminal_obligation(transaction, session_id, run_id, disposition)?;
    Ok(())
}

fn has_running_relationship(
    connection: &Connection,
    session_id: &str,
    run_id: &str,
) -> Result<bool> {
    Ok(connection.query_row(
        "SELECT EXISTS(
             SELECT 1 FROM traditional_children
             WHERE child_session_id = ?1 AND run_id = ?2 AND status = 'running'
             UNION ALL
             SELECT 1 FROM managed_orchestrators
             WHERE orchestrator_session_id = ?1 AND run_id = ?2 AND status = 'running'
         )",
        params![session_id, run_id],
        |row| row.get(0),
    )?)
}

fn retain_or_clear_terminal_obligation(
    transaction: &Transaction<'_>,
    session_id: &str,
    run_id: &str,
    disposition: RunTerminalDisposition,
) -> Result<()> {
    if has_running_relationship(transaction, session_id, run_id)? {
        transaction.execute(
            "UPDATE session_run_recovery
             SET terminal_disposition = ?3
             WHERE session_id = ?1 AND run_id = ?2 AND status = 'active'",
            params![session_id, run_id, disposition.as_str()],
        )?;
    } else {
        transaction.execute(
            "DELETE FROM session_run_recovery
             WHERE session_id = ?1 AND run_id = ?2",
            params![session_id, run_id],
        )?;
    }
    Ok(())
}

pub fn clear_settled_run_recovery(path: &Path, session_id: &str, run_id: &str) -> Result<()> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    if !has_running_relationship(&transaction, session_id, run_id)? {
        transaction.execute(
            "DELETE FROM session_run_recovery
             WHERE session_id = ?1 AND run_id = ?2 AND terminal_disposition IS NOT NULL",
            params![session_id, run_id],
        )?;
    }
    transaction.commit()?;
    Ok(())
}

/// Retain a matching committed prompt as a durable failed outcome. No match is
/// expected when the prompt transaction itself failed; it must not roll back
/// the otherwise independent timing and token bookkeeping in the caller's
/// run-state transaction. An older failed/interrupted row is left untouched.
pub(crate) fn mark_active_run_failed(
    transaction: &Transaction<'_>,
    session_id: &str,
    run_id: &str,
) -> Result<()> {
    transaction.execute(
        "UPDATE session_run_recovery
         SET status = 'failed'
         WHERE session_id = ?1 AND run_id = ?2 AND status = 'active'",
        params![session_id, run_id],
    )?;
    Ok(())
}

pub fn load_run_recovery(path: &Path, session_id: &str) -> Result<Option<RunRecoveryRecord>> {
    let connection = open_runtime_connection(path)?;
    load_run_recovery_with_connection(&connection, session_id)
}

pub(crate) fn load_run_recovery_with_connection(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<RunRecoveryRecord>> {
    connection
        .query_row(
            "SELECT run_id, submitted_message_id, status, terminal_disposition
             FROM session_run_recovery
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?
        .map(
            |(run_id, submitted_message_id, status, terminal_disposition)| {
                Ok(RunRecoveryRecord {
                    run_id,
                    submitted_message_id,
                    status: RunRecoveryStatus::parse(&status)?,
                    terminal_disposition: terminal_disposition
                        .map(|value| RunTerminalDisposition::parse(&value))
                        .transpose()?,
                })
            },
        )
        .transpose()
}

pub fn reconcile_active_run(path: &Path, session_id: &str) -> Result<ActiveRunReconciliation> {
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let Some(record) = load_run_recovery_with_connection(&transaction, session_id)? else {
        transaction.commit()?;
        return Ok(ActiveRunReconciliation::None);
    };
    if let Some(disposition) = record.terminal_disposition {
        // Settlement and recovery cleanup are intentionally separate durable
        // commits. If a process dies between them, a terminal relationship no
        // longer owns this obligation; clear it during restart reconciliation
        // so the next generation can replace the row. A still-running
        // relationship retains the marker for its monitor to settle.
        crate::store::reconcile_session_goal_terminal_with_connection(
            &transaction,
            session_id,
            &record.run_id,
            match disposition {
                RunTerminalDisposition::Completed => GoalRunDisposition::Completed,
                RunTerminalDisposition::Cancelled => GoalRunDisposition::Cancelled,
            },
        )?;
        retain_or_clear_terminal_obligation(&transaction, session_id, &record.run_id, disposition)?;
        transaction.commit()?;
        return Ok(ActiveRunReconciliation::CanonicalTerminal);
    }
    if record.status != RunRecoveryStatus::Active {
        transaction.commit()?;
        return Ok(ActiveRunReconciliation::None);
    }

    let (row_session_id, thread_name, event_json) = transaction
        .query_row(
            "SELECT session_id, thread_name, event_json
             FROM thread_events
             WHERE id = ?1",
            params![record.submitted_message_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| anyhow!("active run references a missing transcript row"))?;
    if row_session_id != session_id || thread_name != ORCHESTRATOR_STEERING_TARGET {
        return Err(anyhow!(
            "active run references a transcript row outside session '{session_id}'"
        ));
    }
    let submitted = decode_recovery_entry(&event_json)
        .ok_or_else(|| anyhow!("active run references a malformed transcript row"))?;
    if submitted.kind != TranscriptMessageKind::User
        || !matches!(decode_recovery_message(&submitted)?, Message::User { .. })
    {
        return Err(anyhow!(
            "active run does not reference a canonical user transcript row"
        ));
    }

    if let Some(disposition) = canonical_terminal_disposition(&transaction, session_id, &record)? {
        match disposition {
            RecoveredRunTerminal::Completed | RecoveredRunTerminal::Cancelled => {
                let durable = match disposition {
                    RecoveredRunTerminal::Completed => RunTerminalDisposition::Completed,
                    RecoveredRunTerminal::Cancelled => RunTerminalDisposition::Cancelled,
                    RecoveredRunTerminal::Failed => unreachable!(),
                };
                crate::store::reconcile_session_goal_terminal_with_connection(
                    &transaction,
                    session_id,
                    &record.run_id,
                    match disposition {
                        RecoveredRunTerminal::Completed => GoalRunDisposition::Completed,
                        RecoveredRunTerminal::Cancelled => GoalRunDisposition::Cancelled,
                        RecoveredRunTerminal::Failed => unreachable!(),
                    },
                )?;
                retain_or_clear_terminal_obligation(
                    &transaction,
                    session_id,
                    &record.run_id,
                    durable,
                )?;
                transaction.commit()?;
                return Ok(ActiveRunReconciliation::CanonicalTerminal);
            }
            RecoveredRunTerminal::Failed => {
                crate::store::reconcile_session_goal_terminal_with_connection(
                    &transaction,
                    session_id,
                    &record.run_id,
                    GoalRunDisposition::Failed,
                )?;
                mark_active_run_failed(&transaction, session_id, &record.run_id)?;
                transaction.commit()?;
                return Ok(ActiveRunReconciliation::Failed {
                    run_id: record.run_id,
                });
            }
        }
    }

    let changed = transaction.execute(
        "UPDATE session_run_recovery
         SET status = ?1
         WHERE session_id = ?2 AND run_id = ?3 AND status = 'active'",
        params![
            RunRecoveryStatus::Interrupted.as_str(),
            session_id,
            record.run_id
        ],
    )?;
    if changed != 1 {
        return Err(anyhow!(
            "active run recovery transition expected one row, updated {changed}"
        ));
    }
    transaction.commit()?;
    Ok(ActiveRunReconciliation::Interrupted {
        run_id: record.run_id,
    })
}

fn canonical_terminal_disposition(
    connection: &Connection,
    session_id: &str,
    record: &RunRecoveryRecord,
) -> Result<Option<RecoveredRunTerminal>> {
    let mut statement = connection.prepare(
        "SELECT event_json FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2 AND id > ?3
         ORDER BY id ASC",
    )?;
    let rows = statement.query_map(
        params![
            session_id,
            ORCHESTRATOR_STEERING_TARGET,
            record.submitted_message_id
        ],
        |row| row.get::<_, String>(0),
    )?;
    let mut disposition = None;
    for row in rows {
        let event_json = row?;
        let Some(entry) = decode_recovery_entry(&event_json) else {
            continue;
        };
        if entry.kind == TranscriptMessageKind::User {
            disposition = None;
            continue;
        }
        if entry.kind != TranscriptMessageKind::Assistant {
            continue;
        }
        let message = decode_recovery_message(&entry)?;
        if let Message::Assistant {
            content: Some(content),
            tool_calls,
            ..
        } = message
        {
            if tool_calls.as_ref().is_none_or(Vec::is_empty) {
                disposition = Some(if content == crate::agent::RUN_CANCELLED_MARKER {
                    RecoveredRunTerminal::Cancelled
                } else if content == crate::agent::RUN_FAILED_PARTIAL_MARKER
                    || content
                        .ends_with(&format!("\n\n{}", crate::agent::RUN_FAILED_PARTIAL_MARKER))
                {
                    RecoveredRunTerminal::Failed
                } else if !content.trim().is_empty() {
                    RecoveredRunTerminal::Completed
                } else {
                    continue;
                });
            }
        }
    }
    Ok(disposition)
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
            .join(format!("nac_run_recovery_{label}_{unique}"))
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
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        }
    }

    fn transcript(writer: &TranscriptLogWriter) -> Vec<(u64, serde_json::Value)> {
        writer
            .read_from("session-a", 0)
            .unwrap()
            .into_iter()
            .map(|(idx, message)| (idx, serde_json::to_value(message).unwrap()))
            .collect()
    }

    fn run_state_update(session_id: &str) -> crate::sessions::SessionRunStateUpdate {
        crate::sessions::SessionRunStateUpdate {
            session_id: session_id.to_string(),
            ssh: None,
            sandbox_spec: None,
            run_state: crate::sessions::SessionRunState::default(),
            finished_run_id: None,
            finished_run_disposition: None,
            failed_run_id: None,
            goal_settlement: None,
            updated_at: now_utc(),
        }
    }

    #[test]
    fn recovery_envelope_borrows_tool_payload_without_unescaping_it() {
        let payload = encode_transcript_log_entry(
            0,
            &Message::Tool {
                tool_call_id: "call-image".to_string(),
                content: "x".repeat(1024).into(),
            },
        )
        .unwrap();
        let entry = decode_recovery_entry(&payload).unwrap();
        let payload_range = payload.as_ptr() as usize..payload.as_ptr() as usize + payload.len();
        let message_ptr = entry.message_json.get().as_ptr() as usize;

        assert_eq!(entry.kind, TranscriptMessageKind::Tool);
        assert!(payload_range.contains(&message_ptr));
    }

    #[test]
    fn interrupted_run_process_helper() {
        let Some(store_path) = std::env::var_os("NAC_TEST_RUN_RECOVERY_STORE") else {
            return;
        };
        let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_RUN_RECOVERY_READY").unwrap());
        let _operation_lease = crate::sessions::SessionOperationLease::try_acquire(
            Path::new(&store_path),
            "session-a",
        )
        .unwrap();
        TranscriptLogWriter::new(Path::new(&store_path))
            .unwrap()
            .append_run_prompt(
                "session-a",
                0,
                &user("committed before SIGKILL"),
                "run-killed",
            )
            .unwrap();
        std::fs::write(ready_path, b"ready").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
    }

    #[test]
    fn sigkill_after_prompt_commit_recovers_exactly_once() {
        use std::process::{Command, Stdio};

        let path = temp_store_path("sigkill");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let ready_path = path.parent().unwrap().join("ready");
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "store::run_recovery::tests::interrupted_run_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_RUN_RECOVERY_STORE", &path)
            .env("NAC_TEST_RUN_RECOVERY_READY", &ready_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        for _ in 0..200 {
            if ready_path.exists() {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "run recovery helper exited early"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            ready_path.exists(),
            "run recovery helper never became ready"
        );
        assert_eq!(
            load_run_recovery(&path, "session-a")
                .unwrap()
                .unwrap()
                .status,
            RunRecoveryStatus::Active
        );
        assert!(matches!(
            crate::sessions::SessionOperationLease::try_acquire(&path, "session-a"),
            Err(crate::sessions::SessionOperationLeaseError::Busy(_))
        ));

        child.kill().unwrap();
        child.wait().unwrap();
        let operation_lease =
            crate::sessions::SessionOperationLease::try_acquire(&path, "session-a").unwrap();
        operation_lease.validate(&path, "session-a").unwrap();

        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::Interrupted {
                run_id: "run-killed".to_string()
            }
        );
        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::None
        );
        assert_eq!(
            transcript(&TranscriptLogWriter::new(&path).unwrap()),
            vec![(
                0,
                serde_json::to_value(user("committed before SIGKILL")).unwrap()
            )]
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn version_thirteen_store_adds_only_the_recovery_table() {
        let path = temp_store_path("v13_migration");
        initialize(&path).unwrap();
        {
            let connection = open_connection(&path).unwrap();
            connection
                .execute_batch(
                    "DROP TABLE session_run_recovery;
                     PRAGMA user_version = 13;",
                )
                .unwrap();
        }

        initialize(&path).unwrap();
        let connection = open_connection(&path).unwrap();
        let definition: String = connection
            .query_row(
                "SELECT sql FROM sqlite_master
                 WHERE type = 'table' AND name = 'session_run_recovery'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(definition.contains("session_id TEXT PRIMARY KEY"));
        assert!(definition.contains("submitted_message_id INTEGER NOT NULL"));
        assert!(!definition.contains("prompt"));
        assert!(!definition.contains("response"));
        assert!(!definition.contains("event_json"));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn run_prompt_and_active_marker_commit_atomically() {
        let path = temp_store_path("prompt_atomic");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();

        writer
            .append_run_prompt("session-a", 0, &user("first"), "run-1")
            .unwrap();
        let first = load_run_recovery(&path, "session-a").unwrap().unwrap();
        assert_eq!(first.run_id, "run-1");
        assert_eq!(first.status, RunRecoveryStatus::Active);
        assert_eq!(
            transcript(&writer),
            vec![(0, serde_json::to_value(user("first")).unwrap())]
        );

        let error = writer
            .append_run_prompt("session-a", 1, &user("must roll back"), "run-2")
            .unwrap_err();
        assert!(error
            .to_string()
            .contains("already has an active durable run"));
        assert_eq!(
            transcript(&writer),
            vec![(0, serde_json::to_value(user("first")).unwrap())]
        );
        assert_eq!(
            load_run_recovery(&path, "session-a").unwrap().unwrap(),
            first
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn interrupted_transition_is_idempotent_and_next_prompt_supersedes_it() {
        let path = temp_store_path("interrupted");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("first"), "run-1")
            .unwrap();

        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::Interrupted {
                run_id: "run-1".to_string()
            }
        );
        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::None
        );
        assert_eq!(
            load_run_recovery(&path, "session-a")
                .unwrap()
                .unwrap()
                .status,
            RunRecoveryStatus::Interrupted
        );

        writer
            .append_run_prompt("session-a", 1, &user("replacement"), "run-2")
            .unwrap();
        let replacement = load_run_recovery(&path, "session-a").unwrap().unwrap();
        assert_eq!(replacement.run_id, "run-2");
        assert_eq!(replacement.status, RunRecoveryStatus::Active);
        assert_eq!(
            transcript(&writer),
            vec![
                (0, serde_json::to_value(user("first")).unwrap()),
                (1, serde_json::to_value(user("replacement")).unwrap())
            ]
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
    #[test]
    fn nonterminal_assistants_followed_by_steering_are_interrupted() {
        let path = temp_store_path("steered_after_response");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("prompt"), "run-1")
            .unwrap();
        writer.append("session-a", 1, &assistant("")).unwrap();
        writer
            .append("session-a", 2, &assistant("response before steering"))
            .unwrap();
        writer
            .append("session-a", 3, &user("steer while running"))
            .unwrap();

        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::Interrupted {
                run_id: "run-1".to_string()
            }
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn recovery_removes_marker_when_canonical_terminal_already_committed() {
        let path = temp_store_path("terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("prompt"), "run-1")
            .unwrap();
        writer.append("session-a", 1, &assistant("")).unwrap();
        writer
            .append("session-a", 2, &user("steer while running"))
            .unwrap();
        writer.append("session-a", 3, &assistant("answer")).unwrap();

        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::CanonicalTerminal
        );
        assert!(load_run_recovery(&path, "session-a").unwrap().is_none());
        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::None
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn cancellation_marker_recovery_pauses_the_bound_goal_before_clearing_the_run() {
        let path = temp_store_path("cancelled_goal_terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'session-a'",
                [],
            )
            .unwrap();
        create_session_goal(&path, "session-a", "finish safely", None, None).unwrap();
        bind_session_goal_run(
            &path,
            "session-a",
            &GoalRunBaseline {
                run_id: "run-1".to_string(),
                billable_tokens: 0,
                started_at_epoch_ms: 10,
                continuation: false,
            },
        )
        .unwrap()
        .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("prompt"), "run-1")
            .unwrap();
        writer
            .append(
                "session-a",
                1,
                &assistant(crate::agent::RUN_CANCELLED_MARKER),
            )
            .unwrap();

        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::CanonicalTerminal
        );
        let goal = load_session_goal(&path, "session-a").unwrap().unwrap();
        assert_eq!(goal.status, GoalStatus::Paused);
        assert!(goal.accounting_run_id.is_none());
        assert!(load_run_recovery(&path, "session-a").unwrap().is_none());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn run_state_save_atomically_settles_a_bound_goal() {
        let path = temp_store_path("atomic_goal_terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'session-a'",
                [],
            )
            .unwrap();
        create_session_goal(&path, "session-a", "finish safely", None, None).unwrap();
        bind_session_goal_run(
            &path,
            "session-a",
            &GoalRunBaseline {
                run_id: "run-1".to_string(),
                billable_tokens: 5,
                started_at_epoch_ms: 10,
                continuation: false,
            },
        )
        .unwrap()
        .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("prompt"), "run-1")
            .unwrap();

        let mut update = run_state_update("session-a");
        update.finished_run_id = Some("run-1".to_string());
        update.finished_run_disposition = Some(RunTerminalDisposition::Cancelled);
        update.goal_settlement = Some(GoalRunSettlement {
            run_id: "run-1".to_string(),
            final_billable_tokens: 12,
            terminal_at_epoch_ms: 110,
            disposition: GoalRunDisposition::Cancelled,
        });
        crate::sessions::save_session_run_state(&path, &update).unwrap();

        let goal = load_session_goal(&path, "session-a").unwrap().unwrap();
        assert_eq!(goal.status, GoalStatus::Paused);
        assert_eq!(goal.tokens_used, 7);
        assert!(goal.accounting_run_id.is_none());
        assert!(load_run_recovery(&path, "session-a").unwrap().is_none());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn cancelled_run_state_checkpoint_does_not_depend_on_transcript_marker() {
        let path = temp_store_path("explicit_cancel_terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "parent");
        insert_test_session(&path, "child");
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent', 'child')",
                [],
            )
            .unwrap();
        create_traditional_child_relationship(
            &path,
            "parent",
            "child",
            GENERAL_CHILD_PROFILE,
            "cancel safely",
        )
        .unwrap();
        begin_traditional_child_run(
            &path,
            "child",
            "run-1",
            TraditionalChildExecutionMode::Background,
        )
        .unwrap();
        TranscriptLogWriter::new(&path)
            .unwrap()
            .append_run_prompt("child", 0, &user("prompt"), "run-1")
            .unwrap();

        let mut update = run_state_update("child");
        update.finished_run_id = Some("run-1".to_string());
        update.finished_run_disposition = Some(RunTerminalDisposition::Cancelled);
        crate::sessions::save_session_run_state(&path, &update).unwrap();

        let recovery = load_run_recovery(&path, "child").unwrap().unwrap();
        assert_eq!(
            recovery.terminal_disposition,
            Some(RunTerminalDisposition::Cancelled)
        );
        assert_eq!(
            reconcile_active_run(&path, "child").unwrap(),
            ActiveRunReconciliation::CanonicalTerminal
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_partial_marker_recovery_blocks_bound_goal() {
        let path = temp_store_path("failed_partial_goal_terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'session-a'",
                [],
            )
            .unwrap();
        create_session_goal(&path, "session-a", "finish safely", None, None).unwrap();
        bind_session_goal_run(
            &path,
            "session-a",
            &GoalRunBaseline {
                run_id: "run-1".to_string(),
                billable_tokens: 0,
                started_at_epoch_ms: 10,
                continuation: false,
            },
        )
        .unwrap()
        .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("prompt"), "run-1")
            .unwrap();
        writer
            .append(
                "session-a",
                1,
                &assistant(&format!(
                    "partial response\n\n{}",
                    crate::agent::RUN_FAILED_PARTIAL_MARKER
                )),
            )
            .unwrap();

        assert_eq!(
            reconcile_active_run(&path, "session-a").unwrap(),
            ActiveRunReconciliation::Failed {
                run_id: "run-1".to_string()
            }
        );
        let goal = load_session_goal(&path, "session-a").unwrap().unwrap();
        assert_eq!(goal.status, GoalStatus::Blocked);
        assert!(goal.accounting_run_id.is_none());
        assert_eq!(
            load_run_recovery(&path, "session-a")
                .unwrap()
                .unwrap()
                .status,
            RunRecoveryStatus::Failed
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn recovery_clears_post_settlement_terminal_obligation_before_next_generation() {
        let path = temp_store_path("settled_terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "parent");
        insert_test_session(&path, "orchestrator");
        let connection = open_runtime_connection(&path).unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'direct-with-orchestrator' WHERE session_id = 'parent'",
                [],
            )
            .unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'orchestrator' WHERE session_id = 'orchestrator'",
                [],
            )
            .unwrap();
        create_managed_orchestrator_relationship(&path, "parent", "orchestrator", "review")
            .unwrap();
        begin_managed_orchestrator_run(
            &path,
            "orchestrator",
            "run-1",
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("orchestrator", 0, &user("prompt"), "run-1")
            .unwrap();
        writer
            .append("orchestrator", 1, &assistant("answer"))
            .unwrap();
        let mut update = run_state_update("orchestrator");
        update.finished_run_id = Some("run-1".to_string());
        update.finished_run_disposition = Some(RunTerminalDisposition::Completed);
        crate::sessions::save_session_run_state(&path, &update).unwrap();
        assert!(load_run_recovery(&path, "orchestrator")
            .unwrap()
            .unwrap()
            .terminal_disposition
            .is_some());

        settle_managed_orchestrator_run(
            &path,
            "orchestrator",
            "run-1",
            ManagedOrchestratorTerminal {
                status: ManagedOrchestratorStatus::Completed,
                report: Some("answer".to_string()),
                failure: None,
            },
        )
        .unwrap();
        // Simulate a crash before clear_settled_run_recovery.
        assert_eq!(
            reconcile_active_run(&path, "orchestrator").unwrap(),
            ActiveRunReconciliation::CanonicalTerminal
        );
        assert!(load_run_recovery(&path, "orchestrator").unwrap().is_none());
        writer
            .append_run_prompt("orchestrator", 2, &user("continue"), "run-2")
            .unwrap();
        assert_eq!(
            load_run_recovery(&path, "orchestrator")
                .unwrap()
                .unwrap()
                .run_id,
            "run-2"
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn run_state_save_clears_only_the_matching_active_run() {
        let path = temp_store_path("terminal_save");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("prompt"), "run-1")
            .unwrap();

        let mut update = run_state_update("session-a");
        update.finished_run_id = Some("different-run".to_string());
        update.finished_run_disposition = Some(RunTerminalDisposition::Completed);
        crate::sessions::save_session_run_state(&path, &update).unwrap();
        assert!(load_run_recovery(&path, "session-a").unwrap().is_some());

        update.finished_run_id = Some("run-1".to_string());
        crate::sessions::save_session_run_state(&path, &update).unwrap();
        assert!(load_run_recovery(&path, "session-a").unwrap().is_none());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_run_state_save_without_durable_prompt_still_commits() {
        let path = temp_store_path("failed_without_prompt");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");

        let mut update = run_state_update("session-a");
        update.run_state.previous_response_duration_ms = Some(321);
        update.failed_run_id = Some("undurable-run".to_string());
        crate::sessions::save_session_run_state(&path, &update).unwrap();

        let connection = open_runtime_connection(&path).unwrap();
        let previous_response_duration_ms = connection
            .query_row(
                "SELECT previous_response_duration_ms
                 FROM sessions
                 WHERE session_id = ?1",
                ["session-a"],
                |row| row.get::<_, Option<u64>>(0),
            )
            .unwrap();
        assert_eq!(previous_response_duration_ms, Some(321));
        assert!(load_run_recovery(&path, "session-a").unwrap().is_none());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn failed_terminal_is_durable_and_next_prompt_supersedes_it() {
        let path = temp_store_path("failed_terminal");
        initialize(&path).unwrap();
        insert_test_session(&path, "session-a");
        let writer = TranscriptLogWriter::new(&path).unwrap();
        writer
            .append_run_prompt("session-a", 0, &user("failed prompt"), "run-1")
            .unwrap();

        let mut update = run_state_update("session-a");
        update.failed_run_id = Some("run-1".to_string());
        crate::sessions::save_session_run_state(&path, &update).unwrap();
        assert_eq!(
            load_run_recovery(&path, "session-a")
                .unwrap()
                .unwrap()
                .status,
            RunRecoveryStatus::Failed
        );

        let mut undurable_replacement = run_state_update("session-a");
        undurable_replacement
            .run_state
            .previous_response_duration_ms = Some(654);
        undurable_replacement.failed_run_id = Some("run-2".to_string());
        crate::sessions::save_session_run_state(&path, &undurable_replacement).unwrap();
        let retained = load_run_recovery(&path, "session-a").unwrap().unwrap();
        assert_eq!(retained.run_id, "run-1");
        assert_eq!(retained.status, RunRecoveryStatus::Failed);
        let previous_response_duration_ms = open_runtime_connection(&path)
            .unwrap()
            .query_row(
                "SELECT previous_response_duration_ms
                 FROM sessions
                 WHERE session_id = ?1",
                ["session-a"],
                |row| row.get::<_, Option<u64>>(0),
            )
            .unwrap();
        assert_eq!(previous_response_duration_ms, Some(654));

        writer
            .append_run_prompt("session-a", 1, &user("replacement"), "run-2")
            .unwrap();
        let replacement = load_run_recovery(&path, "session-a").unwrap().unwrap();
        assert_eq!(replacement.run_id, "run-2");
        assert_eq!(replacement.status, RunRecoveryStatus::Active);

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
