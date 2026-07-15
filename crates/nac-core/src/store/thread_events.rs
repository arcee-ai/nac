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
        "SELECT id, thread_name, session_id, event_json, created_at
         FROM thread_events
         WHERE session_id = ?1
         ORDER BY thread_name ASC, id DESC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
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
        let events = grouped.entry(event.thread_name.clone()).or_default();
        if events.len() < per_thread_limit {
            events.push(event);
        }
    }
    for events in grouped.values_mut() {
        events.reverse();
    }
    Ok(grouped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_events_round_trip_in_order_and_respect_per_thread_limit() {
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

        for value in ["one", "two", "three"] {
            append_thread_event(&path, "session-a", "worker-a", value).unwrap();
        }
        append_thread_event(&path, "session-a", "worker-b", "only").unwrap();

        let events = load_all_thread_events(&path, "session-a", 2).unwrap();
        assert_eq!(
            events["worker-a"]
                .iter()
                .map(|event| event.event_json.as_str())
                .collect::<Vec<_>>(),
            vec!["two", "three"]
        );
        assert_eq!(events["worker-b"][0].event_json, "only");

        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
