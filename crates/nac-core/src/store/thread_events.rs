use super::*;
use std::sync::Mutex;

pub struct ThreadEventWriter {
    connection: Mutex<Connection>,
}

impl ThreadEventWriter {
    pub fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            connection: Mutex::new(open_runtime_connection(path)?),
        })
    }

    pub fn append(&self, session_id: &str, thread_name: &str, event_json: &str) -> Result<()> {
        let connection = self
            .connection
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        connection.execute(
            "INSERT INTO thread_events (session_id, thread_name, event_json, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![session_id, thread_name, event_json, now_utc()],
        )?;
        Ok(())
    }
}

#[cfg(any(test, feature = "test-support"))]
pub fn append_thread_event(
    path: &Path,
    session_id: &str,
    thread_name: &str,
    event_json: &str,
) -> Result<()> {
    ThreadEventWriter::new(path)?.append(session_id, thread_name, event_json)
}

pub fn load_all_thread_events(
    path: &Path,
    session_id: &str,
    per_thread_limit: usize,
) -> Result<HashMap<String, Vec<ThreadEventRecord>>> {
    if per_thread_limit == 0 {
        return Ok(HashMap::new());
    }
    let conn = open_runtime_connection(path)?;
    let mut stmt = conn.prepare(
        "WITH ranked AS (
             SELECT id, thread_name, session_id, event_json, created_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY thread_name
                        ORDER BY id DESC
                    ) AS event_rank
             FROM thread_events
             WHERE session_id = ?1
         )
         SELECT id, thread_name, session_id, event_json, created_at
         FROM ranked
         WHERE event_rank <= ?2
         ORDER BY thread_name ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![session_id, per_thread_limit], |row| {
        Ok(ThreadEventRecord {
            id: row.get(0)?,
            thread_name: row.get(1)?,
            session_id: row.get(2)?,
            event_json: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;

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
    let mut stmt = conn.prepare(
        "SELECT id, thread_name, session_id, event_json, created_at
         FROM thread_events
         WHERE session_id = ?1 AND thread_name = ?2
           AND (?3 IS NULL OR id < ?3)
         ORDER BY id DESC
         LIMIT ?4",
    )?;
    let rows = stmt.query_map(
        params![session_id, thread_name, before_id, limit.saturating_add(1)],
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
}
