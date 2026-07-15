use super::*;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SessionOverviewRecord {
    pub session_id: String,
    pub summary: String,
    pub model: String,
    pub generated_at: String,
    pub source_updated_at: String,
}

pub fn write_session_overview(
    path: &Path,
    session_id: &str,
    summary: &str,
    model: &str,
    source_updated_at: &str,
) -> Result<SessionOverviewRecord> {
    if session_id.trim().is_empty() {
        return Err(anyhow!("session id is empty"));
    }
    if summary.trim().is_empty() {
        return Err(anyhow!("session overview summary is empty"));
    }

    let conn = open_runtime_connection(path)?;
    let generated_at = now_utc();
    conn.execute(
        "INSERT INTO session_overviews
         (session_id, status, focus_json, completed_json, blockers_json,
          next_steps_json, model, generated_at, source_updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(session_id) DO UPDATE SET
             status = excluded.status,
             focus_json = excluded.focus_json,
             completed_json = excluded.completed_json,
             blockers_json = excluded.blockers_json,
             next_steps_json = excluded.next_steps_json,
             model = excluded.model,
             generated_at = excluded.generated_at,
             source_updated_at = excluded.source_updated_at",
        params![
            session_id,
            summary.trim(),
            "[]",
            "[]",
            "[]",
            "[]",
            model,
            generated_at,
            source_updated_at,
        ],
    )?;

    Ok(SessionOverviewRecord {
        session_id: session_id.to_string(),
        summary: summary.trim().to_string(),
        model: model.to_string(),
        generated_at,
        source_updated_at: source_updated_at.to_string(),
    })
}

pub fn read_session_overview(
    path: &Path,
    session_id: &str,
) -> Result<Option<SessionOverviewRecord>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn
        .query_row(
        "SELECT session_id, status, model, generated_at, source_updated_at
         FROM session_overviews
         WHERE session_id = ?1",
        params![session_id],
        |row| {
            Ok(SessionOverviewRecord {
                session_id: row.get(0)?,
                summary: row.get(1)?,
                model: row.get(2)?,
                generated_at: row.get(3)?,
                source_updated_at: row.get(4)?,
            })
        },
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{model::BackendKind, sessions};
    use std::path::PathBuf;

    fn temp_store_path(label: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_overview_test_{label}_{unique}"))
            .join("store.db")
    }

    fn create_session(path: &Path, session_id: &str) {
        let snapshot = sessions::new_snapshot(
            session_id.to_string(),
            PathBuf::from("/tmp/project"),
            "test-model".to_string(),
            "https://example.invalid".to_string(),
            BackendKind::OpenAiResponses,
            None,
            None,
            None,
            Vec::new(),
            None,
            Default::default(),
        );
        sessions::create_session(path, &snapshot).unwrap();
    }

    #[test]
    fn overview_round_trips_and_replaces_prior_generation() {
        let path = temp_store_path("roundtrip");
        initialize(&path).unwrap();
        create_session(&path, "session-a");

        write_session_overview(
            &path,
            "session-a",
            "Implementation is active.",
            "test-model",
            "2026-07-14 10:00:00",
        )
        .unwrap();
        let first = read_session_overview(&path, "session-a").unwrap().unwrap();
        assert_eq!(first.summary, "Implementation is active.");

        write_session_overview(
            &path,
            "session-a",
            "Verification is complete.",
            "test-model",
            "2026-07-14 11:00:00",
        )
        .unwrap();
        let replaced = read_session_overview(&path, "session-a").unwrap().unwrap();
        assert_eq!(replaced.summary, "Verification is complete.");

        sessions::delete_session(&path, "session-a").unwrap();
        assert!(read_session_overview(&path, "session-a").unwrap().is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
