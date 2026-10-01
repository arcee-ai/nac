use super::*;

#[cfg(any(test, feature = "test-support"))]
static OBSERVED_THREAD_EVENT_BUSY_CALLBACKS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

#[cfg(any(test, feature = "test-support"))]
fn observe_thread_event_busy(_attempts: i32) -> bool {
    OBSERVED_THREAD_EVENT_BUSY_CALLBACKS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    std::thread::sleep(std::time::Duration::from_millis(1));
    true
}

pub struct ThreadEventWriter {
    store_path: PathBuf,
}

pub(crate) enum ThreadEventConnection {
    Local(StoreConnection),
    Coordinated(std::sync::Arc<StoreCoordinator>),
}

impl ThreadEventConnection {
    pub(crate) fn append(
        &self,
        session_id: &str,
        thread_name: &str,
        event_json: &str,
    ) -> Result<()> {
        let connection = match self {
            Self::Coordinated(owner) => {
                owner.check_blocking_context()?;
                return owner
                    .submit(PersistThreadEventCommand {
                        session_id: session_id.to_owned(),
                        thread_name: thread_name.to_owned(),
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
                    "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![session_id, thread_name, event_json, now_utc()],
                )?;
                Ok(())
            },
        )
    }
}
impl ThreadEventWriter {
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

    pub(crate) fn checkout(&self) -> Result<ThreadEventConnection> {
        if let Some(owner) = super::coordinator::owner_for(&self.store_path)? {
            return Ok(ThreadEventConnection::Coordinated(owner));
        }
        Ok(ThreadEventConnection::Local(open_runtime_connection(
            &self.store_path,
        )?))
    }

    pub fn append(&self, session_id: &str, thread_name: &str, event_json: &str) -> Result<()> {
        self.checkout()?.append(session_id, thread_name, event_json)
    }
}

struct PersistThreadEventCommand {
    session_id: String,
    thread_name: String,
    event_json: String,
}
impl super::coordinator::PersistenceCommand for PersistThreadEventCommand {
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
        Ok(ThreadEventWriter::path_backed(path).append(
            &self.session_id,
            &self.thread_name,
            &self.event_json,
        ))
    }
}
impl StoreCoordinator {
    pub async fn persist_thread_event(
        &self,
        session_id: String,
        thread_name: String,
        event_json: String,
    ) -> Result<()> {
        self.submit(PersistThreadEventCommand {
            session_id,
            thread_name,
            event_json,
        })?
        .acknowledge()
        .await?
    }
}

#[cfg(any(test, feature = "test-support"))]
coordinated_command! {
pub fn append_thread_event(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    event_json: &str,
) -> Result<()> {
    ThreadEventWriter::new(path)?.append(session_id, thread_name, event_json)
}
command AppendThreadEventCommand {
    session_id: String = session_id.to_owned(),
    thread_name: String = thread_name.to_owned(),
    event_json: String = event_json.to_owned(),
}
call |command| (&command.session_id, &command.thread_name, &command.event_json)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(any(test, feature = "test-support"))]
pub fn reset_thread_event_busy_observations() {
    OBSERVED_THREAD_EVENT_BUSY_CALLBACKS.store(0, std::sync::atomic::Ordering::SeqCst);
}

#[cfg(any(test, feature = "test-support"))]
pub fn thread_event_busy_observations() -> usize {
    OBSERVED_THREAD_EVENT_BUSY_CALLBACKS.load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg(any(test, feature = "test-support"))]
coordinated_command! {
pub fn append_thread_event_observing_busy(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    event_json: &str,
) -> Result<()> {
    let connection = ThreadEventWriter::new(path)?.checkout()?;
    let ThreadEventConnection::Local(local) = &connection else {
        anyhow::bail!("busy observation must execute on the persistence owner");
    };
    local.busy_handler(Some(observe_thread_event_busy))?;
    connection.append(session_id, thread_name, event_json)
}
command AppendThreadEventObservingBusyCommand {
    session_id: String = session_id.to_owned(),
    thread_name: String = thread_name.to_owned(),
    event_json: String = event_json.to_owned(),
}
call |command| (&command.session_id, &command.thread_name, &command.event_json)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(test)]
coordinated_command! {
pub fn load_all_thread_events(
    path: &Path,
    session_id: &str,
    per_thread_limit: usize,
) -> Result<HashMap<String, Vec<ThreadEventRecord>>> {
    let conn = open_runtime_connection(path)?;
    load_all_thread_events_with_connection(&conn, session_id, per_thread_limit)
}
command LoadAllThreadEventsCommand {
    session_id: String = session_id.to_owned(),
    per_thread_limit: usize = per_thread_limit,
}
call |command| (&command.session_id, command.per_thread_limit)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

pub(crate) fn load_all_thread_events_with_connection(
    conn: &Connection,
    session_id: &str,
    per_thread_limit: usize,
) -> Result<HashMap<String, Vec<ThreadEventRecord>>> {
    if per_thread_limit == 0 {
        return Ok(HashMap::new());
    }
    // Transcript log rows live under the reserved orchestrator target
    // (store/transcript.rs); they must never enter the event/tile paths.
    let mut stmt = conn.prepare(
        "WITH ranked AS (
             SELECT id, thread_name, session_id, event_json, created_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY thread_name
                        ORDER BY id DESC
                    ) AS event_rank
             FROM thread_events
             WHERE session_id = ?1 AND thread_name != ?3
         )
         SELECT id, thread_name, session_id, event_json, created_at
         FROM ranked
         WHERE event_rank <= ?2
         ORDER BY thread_name ASC, id ASC",
    )?;
    let rows = stmt.query_map(
        params![session_id, per_thread_limit, ORCHESTRATOR_STEERING_TARGET],
        |row| {
            Ok(ThreadEventRecord {
                id: row.get(0)?,
                thread_name: row.get(1)?,
                session_id: row.get(2)?,
                event_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )?;

    let mut grouped: HashMap<String, Vec<ThreadEventRecord>> = HashMap::new();
    for row in rows {
        let event = row?;
        grouped
            .entry(event.thread_name.clone())
            .or_default()
            .push(event);
    }
    Ok(grouped)
}

coordinated_command! {
pub fn load_thread_events_page(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    before_id: Option<i64>,
    limit: usize,
) -> Result<(Vec<ThreadEventRecord>, bool)> {
    if limit == 0 {
        return Ok((Vec::new(), false));
    }
    let conn = open_runtime_connection(path)?;
    load_thread_events_page_with_connection(&conn, session_id, thread_name, before_id, limit)
}
command LoadThreadEventsPageCommand {
    session_id: String = session_id.to_owned(),
    thread_name: String = thread_name.to_owned(),
    before_id: Option<i64> = before_id,
    limit: usize = limit,
}
call |command| (&command.session_id, &command.thread_name, command.before_id, command.limit)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

pub(crate) fn load_thread_events_page_with_connection(
    conn: &Connection,
    session_id: &str,
    thread_name: &str,
    before_id: Option<i64>,
    limit: usize,
) -> Result<(Vec<ThreadEventRecord>, bool)> {
    if limit == 0 {
        return Ok((Vec::new(), false));
    }
    // Transcript log rows live under the reserved orchestrator target
    // (store/transcript.rs); they must never enter the event/tile paths, even
    // when paged directly by name.
    let mut stmt = conn.prepare(
        "SELECT id, thread_name, session_id, event_json, created_at
         FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2
           AND thread_name != ?5
           AND (?3 IS NULL OR id < ?3)
         ORDER BY id DESC
         LIMIT ?4",
    )?;
    let rows = stmt.query_map(
        params![
            session_id,
            thread_name,
            before_id,
            limit.saturating_add(1),
            ORCHESTRATOR_STEERING_TARGET
        ],
        |row| {
            Ok(ThreadEventRecord {
                id: row.get(0)?,
                thread_name: row.get(1)?,
                session_id: row.get(2)?,
                event_json: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )?;
    let mut events = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    let has_older = events.len() > limit;
    if has_older {
        events.truncate(limit);
    }
    Ok((events, has_older))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_events_are_sql_bounded_newest_first_per_thread_then_returned_chronologically() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_thread_events_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        crate::store::insert_test_session(&path, "session-b");

        for thread_name in ["worker-a", "worker-b"] {
            for index in 0..125 {
                append_thread_event(
                    &path,
                    "session-a",
                    thread_name,
                    &format!("{thread_name}-{index:03}"),
                )
                .unwrap();
            }
        }
        for index in 0..125 {
            append_thread_event(
                &path,
                "session-b",
                "worker-a",
                &format!("other-session-{index:03}"),
            )
            .unwrap();
        }

        assert!(load_all_thread_events(&path, "session-a", 0)
            .unwrap()
            .is_empty());
        for limit in [1, 24, 100] {
            let events = load_all_thread_events(&path, "session-a", limit).unwrap();
            assert_eq!(events.len(), 2);
            for thread_name in ["worker-a", "worker-b"] {
                let records = &events[thread_name];
                assert_eq!(records.len(), limit);
                assert!(records.iter().all(|event| event.session_id == "session-a"));
                assert_eq!(
                    records
                        .iter()
                        .map(|event| event.event_json.clone())
                        .collect::<Vec<_>>(),
                    (125 - limit..125)
                        .map(|index| format!("{thread_name}-{index:03}"))
                        .collect::<Vec<_>>()
                );
                assert!(records.windows(2).all(|pair| pair[0].id < pair[1].id));
            }
        }

        let other_session = load_all_thread_events(&path, "session-b", 24).unwrap();
        assert_eq!(other_session.len(), 1);
        assert_eq!(other_session["worker-a"].len(), 24);
        assert!(other_session["worker-a"]
            .iter()
            .all(|event| event.session_id == "session-b"
                && event.event_json.starts_with("other-session-")));

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn thread_event_pages_are_newest_first_and_use_id_cursors() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_thread_event_pages_{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ))
            .join("store.db");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        for value in ["one", "two", "three", "four", "five"] {
            append_thread_event(&path, "session-a", "worker-a", value).unwrap();
        }

        let (latest, has_older) =
            load_thread_events_page(&path, "session-a", "worker-a", None, 2).unwrap();
        assert!(has_older);
        assert_eq!(
            latest
                .iter()
                .map(|event| event.event_json.as_str())
                .collect::<Vec<_>>(),
            ["five", "four"]
        );

        let (older, has_older) = load_thread_events_page(
            &path,
            "session-a",
            "worker-a",
            Some(latest.last().unwrap().id),
            2,
        )
        .unwrap();
        assert!(has_older);
        assert_eq!(
            older
                .iter()
                .map(|event| event.event_json.as_str())
                .collect::<Vec<_>>(),
            ["three", "two"]
        );

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn transcript_log_rows_never_enter_event_loads() {
        let path = std::env::temp_dir()
            .join(format!(
                "nac_thread_events_transcript_exclusion_{}",
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
        // Seed regular event rows.
        append_thread_event(&path, "session-a", "worker-a", "event-a").unwrap();
        append_thread_event(&path, "session-a", "worker-b", "event-b").unwrap();

        // The transcript rows are still stored...
        assert_eq!(writer.read_from("session-a", 0).unwrap().len(), 3);

        // ...but the grouped load never surfaces them.
        let events = load_all_thread_events(&path, "session-a", 24).unwrap();
        assert_eq!(events.len(), 2);
        assert!(!events.contains_key(ORCHESTRATOR_STEERING_TARGET));
        assert_eq!(events["worker-a"].len(), 1);
        assert_eq!(events["worker-b"].len(), 1);

        // Paging the reserved name directly returns nothing.
        let (page, has_older) =
            load_thread_events_page(&path, "session-a", ORCHESTRATOR_STEERING_TARGET, None, 24)
                .unwrap();
        assert!(page.is_empty());
        assert!(!has_older);

        // Regular pages are unaffected.
        let (page, has_older) =
            load_thread_events_page(&path, "session-a", "worker-a", None, 24).unwrap();
        assert!(!has_older);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].event_json, "event-a");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
