use super::*;

#[cfg(any(test, feature = "test-support"))]
static OBSERVED_THREAD_EVENT_BUSY_CALLBACKS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(any(test, feature = "test-support"))]
fn observe_session_event_busy(_attempts: i32) -> bool {
    OBSERVED_THREAD_EVENT_BUSY_CALLBACKS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(1));
    true
}

pub struct SessionEventWriter {
    store_path: PathBuf,
}

pub(crate) enum SessionEventConnection {
    Local(Box<StoreConnection>),
    Coordinated(std::sync::Arc<StoreCoordinator>),
}

impl SessionEventConnection {
    pub(crate) fn append(
        &self,
        session_id: &str,
        event_target: &str,
        event_json: &str,
    ) -> Result<()> {
        let connection = match self {
            Self::Coordinated(owner) => {
                owner.check_blocking_context()?;
                return owner
                    .submit(PersistSessionEventCommand {
                        session_id: session_id.to_owned(),
                        event_target: event_target.to_owned(),
                        event_json: event_json.to_owned(),
                    })?
                    .acknowledge_blocking()?;
            }
            Self::Local(connection) => connection,
        };
        crate::telemetry::observe_store(
            crate::telemetry::StoreOperation::EventPersistence,
            crate::telemetry::Correlation::session(Some(session_id)),
            || {
                connection.execute(
                    "INSERT INTO session_events (session_id, event_target, event_json, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![session_id, event_target, event_json, now_utc()],
                )?;
                Ok(())
            },
        )
    }
}
impl SessionEventWriter {
    pub(crate) fn has_owner(&self) -> Result<bool> {
        Ok(super::coordinator::owner_for(&self.store_path)?.is_some())
    }

    pub fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            store_path: path.to_path_buf(),
        })
    }

    pub(crate) fn path_backed(path: &Path) -> Self {
        Self {
            store_path: path.to_path_buf(),
        }
    }

    pub(crate) fn checkout(&self) -> Result<SessionEventConnection> {
        if let Some(owner) = super::coordinator::owner_for(&self.store_path)? {
            return Ok(SessionEventConnection::Coordinated(owner));
        }
        Ok(SessionEventConnection::Local(Box::new(
            open_runtime_connection(&self.store_path)?,
        )))
    }

    pub fn append(&self, session_id: &str, event_target: &str, event_json: &str) -> Result<()> {
        self.checkout()?
            .append(session_id, event_target, event_json)
    }
}

struct PersistSessionEventCommand {
    session_id: String,
    event_target: String,
    event_json: String,
}
impl super::coordinator::PersistenceCommand for PersistSessionEventCommand {
    type Output = Result<()>;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some(&self.session_id))
    }
    fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
        if output.is_ok() {
            crate::telemetry::TelemetryOutcome::Ok
        } else {
            crate::telemetry::TelemetryOutcome::Error
        }
    }
    fn error_identity(output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
        super::coordinator::CommandOutput::error_identity(output)
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        Ok(SessionEventWriter::path_backed(path).append(
            &self.session_id,
            &self.event_target,
            &self.event_json,
        ))
    }
}
impl StoreCoordinator {
    pub async fn persist_session_event(
        &self,
        session_id: String,
        event_target: String,
        event_json: String,
    ) -> Result<()> {
        self.submit(PersistSessionEventCommand {
            session_id,
            event_target,
            event_json,
        })?
        .acknowledge()
        .await?
    }
}

#[cfg(any(test, feature = "test-support"))]
coordinated_command! {
pub fn append_session_event(
    path: &Path,
    session_id: &str,
    event_target: &str,
    event_json: &str,
) -> Result<()> {
    SessionEventWriter::new(path)?.append(session_id, event_target, event_json)
}
command AppendSessionEventCommand {
    session_id: String = session_id.to_owned(),
    event_target: String = event_target.to_owned(),
    event_json: String = event_json.to_owned(),
}
call |command| (&command.session_id, &command.event_target, &command.event_json)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(any(test, feature = "test-support"))]
pub fn reset_session_event_busy_observations() {
    OBSERVED_THREAD_EVENT_BUSY_CALLBACKS.store(0, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(any(test, feature = "test-support"))]
pub fn session_event_busy_observations() -> usize {
    OBSERVED_THREAD_EVENT_BUSY_CALLBACKS.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(any(test, feature = "test-support"))]
coordinated_command! {
pub fn append_session_event_observing_busy(
    path: &Path,
    session_id: &str,
    event_target: &str,
    event_json: &str,
) -> Result<()> {
    let mut connection = SessionEventWriter::new(path)?.checkout()?;
    let SessionEventConnection::Local(local) = &mut connection else {
        anyhow::bail!("busy observation must execute on the persistence owner");
    };
    local.busy_handler(Some(observe_session_event_busy))?;
    connection.append(session_id, event_target, event_json)
}
command AppendSessionEventObservingBusyCommand {
    session_id: String = session_id.to_owned(),
    event_target: String = event_target.to_owned(),
    event_json: String = event_json.to_owned(),
}
call |command| (&command.session_id, &command.event_target, &command.event_json)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(test)]
coordinated_command! {
pub fn load_all_session_events(
    path: &Path,
    session_id: &str,
    per_thread_limit: usize,
) -> Result<HashMap<String, Vec<SessionEventRecord>>> {
    let conn = open_runtime_connection(path)?;
    load_all_session_events_with_connection(&conn, session_id, per_thread_limit)
}
command LoadAllSessionEventsCommand {
    session_id: String = session_id.to_owned(),
    per_thread_limit: usize = per_thread_limit,
}
call |command| (&command.session_id, command.per_thread_limit)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

/// Load the bounded primary-tool event tail in chronological order. The
/// transcript ledger shares this table but has a different reserved target.
pub(crate) fn load_primary_tool_events_with_connection(
    conn: &Connection,
    session_id: &str,
    limit: usize,
) -> Result<Vec<SessionEventRecord>> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare(
        "SELECT id, event_target, session_id, event_json, created_at FROM (
            SELECT id, event_target, session_id, event_json, created_at
            FROM session_events WHERE session_id = ?1 AND event_target = ?2
            ORDER BY id DESC LIMIT ?3
         ) ORDER BY id ASC",
    )?;
    let rows = statement.query_map(
        params![session_id, crate::events::PRIMARY_TOOL_EVENT_TARGET, limit],
        |row| {
            Ok(SessionEventRecord {
                id: row.get(0)?,
                event_target: row.get(1)?,
                session_id: row.get(2)?,
                event_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
pub(crate) fn load_all_session_events_with_connection(
    conn: &Connection,
    session_id: &str,
    per_thread_limit: usize,
) -> Result<HashMap<String, Vec<SessionEventRecord>>> {
    if per_thread_limit == 0 {
        return Ok(HashMap::new());
    }
    // Transcript log rows live under the reserved orchestrator target
    // (store/transcript.rs); they must never enter the event/tile paths.
    let mut stmt = conn.prepare(
        "WITH ranked AS (
             SELECT id, event_target, session_id, event_json, created_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY event_target
                        ORDER BY id DESC
                    ) AS event_rank
             FROM session_events
             WHERE session_id = ?1 AND event_target != ?3
         )
         SELECT id, event_target, session_id, event_json, created_at
         FROM ranked
         WHERE event_rank <= ?2
         ORDER BY event_target ASC, id ASC",
    )?;
    let rows = stmt.query_map(
        params![session_id, per_thread_limit, TRANSCRIPT_EVENT_TARGET],
        |row| {
            Ok(SessionEventRecord {
                id: row.get(0)?,
                event_target: row.get(1)?,
                session_id: row.get(2)?,
                event_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )?;

    let mut grouped: HashMap<String, Vec<SessionEventRecord>> = HashMap::new();
    for row in rows {
        let event = row?;
        grouped
            .entry(event.event_target.clone())
            .or_default()
            .push(event);
    }
    Ok(grouped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_events_are_sql_bounded_newest_first_per_thread_then_returned_chronologically() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_session_events_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");

        for event_target in ["worker-a", "worker-b"] {
            for index in 0..125 {
                append_session_event(
                    &path,
                    "session-a",
                    event_target,
                    &format!("{event_target}-{index:03}"),
                )
                .unwrap();
            }
        }
        for index in 0..125 {
            append_session_event(
                &path,
                "session-b",
                "worker-a",
                &format!("other-session-{index:03}"),
            )
            .unwrap();
        }

        assert!(load_all_session_events(&path, "session-a", 0)
            .unwrap()
            .is_empty());
        for limit in [1, 24, 100] {
            let events = load_all_session_events(&path, "session-a", limit).unwrap();
            assert_eq!(events.len(), 2);
            for event_target in ["worker-a", "worker-b"] {
                let records = &events[event_target];
                assert_eq!(records.len(), limit);
                assert!(records.iter().all(|event| event.session_id == "session-a"));
                assert_eq!(
                    records
                        .iter()
                        .map(|event| event.event_json.clone())
                        .collect::<Vec<_>>(),
                    (125 - limit..125)
                        .map(|index| format!("{event_target}-{index:03}"))
                        .collect::<Vec<_>>()
                );
                assert!(records.windows(2).all(|pair| pair[0].id < pair[1].id));
            }
        }

        let other_session = load_all_session_events(&path, "session-b", 24).unwrap();
        assert_eq!(other_session.len(), 1);
        assert_eq!(other_session["worker-a"].len(), 24);
        assert!(other_session["worker-a"]
            .iter()
            .all(|event| event.session_id == "session-b"
                && event.event_json.starts_with("other-session-")));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_rows_never_enter_event_loads() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_session_events_transcript_exclusion_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");

        // Seed transcript log rows under the reserved orchestrator target.
        let writer = crate::store::TranscriptLogWriter::new(&path).unwrap();
        for (idx, content) in ["zero", "one", "two"].iter().enumerate() {
            writer
                .append(
                    "session-a",
                    idx as u64,
                    &crate::types::Message::User {
                        content: content.to_string(),
                    },
                )
                .unwrap();
        }
        // Primary tool events share this table but remain separate from the
        // canonical transcript rows.
        let primary = crate::events::PRIMARY_TOOL_EVENT_TARGET;
        append_session_event(&path, "session-a", primary, "event-a").unwrap();
        assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 3);
        let events = load_all_session_events(&path, "session-a", 24).unwrap();
        assert_eq!(events.len(), 1);
        assert!(!events.contains_key(TRANSCRIPT_EVENT_TARGET));
        assert_eq!(events[primary][0].event_json, "event-a");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
