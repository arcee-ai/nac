use super::*;
use std::path::Path;
use std::sync::Mutex;

/// Synchronous writer for the durable per-session event log (`session_events`).
///
/// The bus appends every published envelope here before broadcasting it, so a
/// process restart can rebuild the replay ring and continue the per-session
/// sequence (issue #148). One connection, serialized by a mutex, matching the
/// `ThreadEventWriter` pattern.
pub struct SessionEventWriter {
    connection: Mutex<Connection>,
}

impl SessionEventWriter {
    pub fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            connection: Mutex::new(open_runtime_connection(path)?),
        })
    }

    pub fn append(&self, session_id: &str, seq: u64, envelope_json: &str) -> Result<()> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        connection.execute(
            "INSERT INTO session_events (session_id, seq, envelope_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session_id,
                i64::try_from(seq).context("session event sequence overflowed")?,
                envelope_json,
                now_utc(),
            ],
        )?;
        Ok(())
    }
}

/// Durable sequence state a rebuilt bus seeds itself with on restart.
pub struct SessionEventState {
    /// The last issued sequence id: `MAX(seq)`, or 0 for a session with no
    /// durable events yet. The bus's `next_sequence_id` counter holds the last
    /// issued id and increments before each emit, so seeding both counters
    /// with this value makes the next emit continue at `MAX(seq) + 1`.
    pub last_sequence_id: u64,
    /// The most recent `limit` envelopes as `(seq, envelope_json)`, ordered by
    /// `seq` ascending, for seeding the replay ring.
    pub recent: Vec<(u64, String)>,
}

/// Loads the durable sequence state for a session: the highest persisted
/// sequence id and the most recent `limit` envelopes (ascending). Used by
/// `SessionEventBus::with_thread_event_store` so a restarted process continues
/// the sequence and replays pre-restart history instead of erasing it.
pub fn load_session_event_state(
    path: &Path,
    session_id: &str,
    limit: usize,
) -> Result<SessionEventState> {
    let conn = open_runtime_connection(path)?;
    let max_seq: Option<i64> = conn.query_row(
        "SELECT MAX(seq) FROM session_events WHERE session_id = ?1",
        params![session_id],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    let last_sequence_id = max_seq
        .map(|seq| u64::try_from(seq).context("session event sequence overflowed"))
        .transpose()?
        .unwrap_or(0);
    let mut statement = conn.prepare(
        "SELECT seq, envelope_json
         FROM session_events
         WHERE session_id = ?1
         ORDER BY seq DESC
         LIMIT ?2",
    )?;
    let rows = statement.query_map(
        params![session_id, i64::try_from(limit).unwrap_or(i64::MAX)],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    )?;
    let mut recent = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    recent.reverse();
    let recent = recent
        .into_iter()
        .map(|(seq, envelope_json)| {
            Ok((
                u64::try_from(seq).context("session event sequence overflowed")?,
                envelope_json,
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(SessionEventState {
        last_sequence_id,
        recent,
    })
}

/// Durable marker for an in-flight run (issue #148). Written when a run
/// starts, deleted when it finishes; a marker surviving a process restart is
/// the signal that the run was interrupted and must be finalized on resume.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveRunRecord {
    pub run_id: String,
    pub client_id: Option<String>,
    pub prompt_preview: String,
    pub submitted_user_message: Option<String>,
    pub started_at_epoch_ms: u64,
}

pub fn upsert_active_run(path: &Path, session_id: &str, record: &ActiveRunRecord) -> Result<()> {
    let conn = open_runtime_connection(path)?;
    conn.execute(
        "INSERT INTO active_runs
             (session_id, run_id, client_id, prompt_preview, submitted_user_message,
              started_at_epoch_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(session_id) DO UPDATE SET
             run_id = excluded.run_id,
             client_id = excluded.client_id,
             prompt_preview = excluded.prompt_preview,
             submitted_user_message = excluded.submitted_user_message,
             started_at_epoch_ms = excluded.started_at_epoch_ms",
        params![
            session_id,
            record.run_id,
            record.client_id,
            record.prompt_preview,
            record.submitted_user_message,
            i64::try_from(record.started_at_epoch_ms)
                .context("active run started_at overflowed")?,
        ],
    )?;
    Ok(())
}

pub fn load_active_run(path: &Path, session_id: &str) -> Result<Option<ActiveRunRecord>> {
    let conn = open_runtime_connection(path)?;
    let record = conn
        .query_row(
            "SELECT run_id, client_id, prompt_preview, submitted_user_message, started_at_epoch_ms
             FROM active_runs
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(ActiveRunRecord {
                    run_id: row.get(0)?,
                    client_id: row.get(1)?,
                    prompt_preview: row.get(2)?,
                    submitted_user_message: row.get(3)?,
                    started_at_epoch_ms: u64::try_from(row.get::<_, i64>(4)?)
                        .unwrap_or_default(),
                })
            },
        )
        .optional()?;
    Ok(record)
}

pub fn delete_active_run(path: &Path, session_id: &str) -> Result<()> {
    let conn = open_runtime_connection(path)?;
    conn.execute(
        "DELETE FROM active_runs WHERE session_id = ?1",
        params![session_id],
    )?;
    Ok(())
}

/// Whether a durable terminal event (`RunCompleted`/`RunFailed`/`RunCancelled`)
/// already exists for `run_id`. Recovery uses this to stay idempotent: if the
/// process died after writing the terminal event but before clearing the
/// marker, the next restart must not write a second terminal outcome.
pub fn has_terminal_event_for_run(path: &Path, session_id: &str, run_id: &str) -> Result<bool> {
    let conn = open_runtime_connection(path)?;
    // run_id is a UUID, so a LIKE on the serialized envelope field is exact.
    let pattern = format!("%\"run_id\":\"{run_id}\"%");
    let mut statement = conn.prepare(
        "SELECT envelope_json
         FROM session_events
         WHERE session_id = ?1 AND envelope_json LIKE ?2",
    )?;
    let rows = statement.query_map(params![session_id, pattern], |row| {
        row.get::<_, String>(0)
    })?;
    for row in rows {
        let envelope_json = row?;
        let Ok(envelope) =
            serde_json::from_str::<crate::events::SessionEventEnvelope>(&envelope_json)
        else {
            continue;
        };
        if matches!(
            envelope.event,
            crate::events::SessionEvent::RunCompleted { .. }
                | crate::events::SessionEvent::RunFailed { .. }
                | crate::events::SessionEvent::RunCancelled
        ) {
            return Ok(true);
        }
    }
    Ok(false)
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
            .join(format!("nac_session_events_{label}_{unique}"))
            .join("store.db")
    }

    fn test_envelope(session_id: &str, seq: u64, event: crate::events::SessionEvent) -> String {
        serde_json::to_string(&crate::events::SessionEventEnvelope {
            session_id: Some(session_id.to_string()),
            epoch_id: "epoch".to_string(),
            sequence_id: seq,
            client_id: None,
            run_id: None,
            event,
        })
        .unwrap()
    }

    #[test]
    fn session_event_state_advances_sequence_and_returns_recent_ascending() {
        let path = temp_store_path("state");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        let writer = SessionEventWriter::new(&path).unwrap();

        assert_eq!(
            load_session_event_state(&path, "session-a", 10)
                .unwrap()
                .last_sequence_id,
            0
        );
        for seq in 1..=5_u64 {
            writer
                .append(
                    "session-a",
                    seq,
                    &test_envelope("session-a", seq, crate::events::SessionEvent::RunStarted {
                        prompt_preview: format!("prompt-{seq}"),
                        submitted_user_message: None,
                        started_at_epoch_ms: 0,
                    }),
                )
                .unwrap();
        }

        let state = load_session_event_state(&path, "session-a", 3).unwrap();
        assert_eq!(state.last_sequence_id, 5);
        assert_eq!(
            state
                .recent
                .iter()
                .map(|(seq, _)| *seq)
                .collect::<Vec<_>>(),
            vec![3, 4, 5]
        );
        // Other sessions are isolated.
        crate::store::insert_test_session(&path, "session-b");
        assert_eq!(
            load_session_event_state(&path, "session-b", 10)
                .unwrap()
                .last_sequence_id,
            0
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn active_run_marker_round_trips_and_deletes() {
        let path = temp_store_path("marker");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        let record = ActiveRunRecord {
            run_id: "run-1".to_string(),
            client_id: Some("client-1".to_string()),
            prompt_preview: "prompt preview".to_string(),
            submitted_user_message: Some("full prompt".to_string()),
            started_at_epoch_ms: 42,
        };

        assert!(load_active_run(&path, "session-a").unwrap().is_none());
        upsert_active_run(&path, "session-a", &record).unwrap();
        assert_eq!(load_active_run(&path, "session-a").unwrap(), Some(record.clone()));

        // Upsert replaces the marker for a new run.
        let replacement = ActiveRunRecord {
            run_id: "run-2".to_string(),
            client_id: None,
            prompt_preview: "second".to_string(),
            submitted_user_message: None,
            started_at_epoch_ms: 43,
        };
        upsert_active_run(&path, "session-a", &replacement).unwrap();
        assert_eq!(
            load_active_run(&path, "session-a").unwrap(),
            Some(replacement)
        );

        delete_active_run(&path, "session-a").unwrap();
        assert!(load_active_run(&path, "session-a").unwrap().is_none());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn terminal_event_detection_is_run_scoped_and_idempotent() {
        let path = temp_store_path("terminal");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        let writer = SessionEventWriter::new(&path).unwrap();

        assert!(!has_terminal_event_for_run(&path, "session-a", "run-1").unwrap());
        writer
            .append(
                "session-a",
                1,
                &test_envelope("session-a", 1, crate::events::SessionEvent::RunStarted {
                    prompt_preview: "start".to_string(),
                    submitted_user_message: None,
                    started_at_epoch_ms: 0,
                }),
            )
            .unwrap();
        assert!(!has_terminal_event_for_run(&path, "session-a", "run-1").unwrap());

        let mut envelope: crate::events::SessionEventEnvelope =
            serde_json::from_str(&test_envelope(
                "session-a",
                2,
                crate::events::SessionEvent::RunFailed {
                    message: "interrupted".to_string(),
                },
            ))
            .unwrap();
        envelope.run_id = Some(crate::events::SessionRunId::from_string("run-1".to_string()));
        writer
            .append("session-a", 2, &serde_json::to_string(&envelope).unwrap())
            .unwrap();
        assert!(has_terminal_event_for_run(&path, "session-a", "run-1").unwrap());
        // A different run's terminal event does not count.
        assert!(!has_terminal_event_for_run(&path, "session-a", "run-2").unwrap());

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
