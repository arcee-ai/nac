use std::path::Path;

use anyhow::Result;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// Durable provenance for a session created from a prefix of another session.
///
/// `source_session_id` is intentionally historical metadata rather than a
/// foreign key: the lineage remains available after the source is deleted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionForkLineage {
    pub session_id: String,
    pub source_session_id: String,
    pub copied_message_count: usize,
    pub source_message_count: usize,
    pub created_at: String,
}

pub fn record_session_fork(path: &Path, lineage: &SessionForkLineage) -> Result<()> {
    let conn = crate::store::open_connection(path)?;
    conn.execute(
        "INSERT INTO session_forks
             (session_id, source_session_id, copied_message_count,
              source_message_count, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            lineage.session_id,
            lineage.source_session_id,
            i64::try_from(lineage.copied_message_count)?,
            i64::try_from(lineage.source_message_count)?,
            lineage.created_at,
        ],
    )?;
    Ok(())
}

pub fn load_session_fork(path: &Path, session_id: &str) -> Result<Option<SessionForkLineage>> {
    let conn = crate::store::open_connection(path)?;
    let lineage = conn
        .query_row(
            "SELECT session_id, source_session_id, copied_message_count,
                    source_message_count, created_at
             FROM session_forks
             WHERE session_id = ?1",
            params![session_id],
            |row| {
                let copied_message_count = row.get::<_, i64>(2)?;
                let source_message_count = row.get::<_, i64>(3)?;
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    copied_message_count,
                    source_message_count,
                    row.get(4)?,
                ))
            },
        )
        .optional()?;
    lineage
        .map(
            |(
                session_id,
                source_session_id,
                copied_message_count,
                source_message_count,
                created_at,
            )| {
                Ok(SessionForkLineage {
                    session_id,
                    source_session_id,
                    copied_message_count: usize::try_from(copied_message_count)?,
                    source_message_count: usize::try_from(source_message_count)?,
                    created_at,
                })
            },
        )
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn temp_store_path(label: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_lineage_{label}_{unique}"))
            .join("store.db")
    }

    fn insert_session(conn: &Connection, session_id: &str) {
        conn.execute(
            "INSERT INTO sessions
                 (session_id, cwd, store_path, model, base_url, messages_json,
                  created_at, updated_at)
             VALUES (?1, '/repo', '/store', 'model', 'https://example.invalid',
                     '[]', 'created', 'updated')",
            params![session_id],
        )
        .unwrap();
    }

    #[test]
    fn legacy_sessions_have_no_lineage() {
        let path = temp_store_path("legacy");
        crate::store::initialize(&path).unwrap();
        let conn = crate::store::open_connection(&path).unwrap();
        insert_session(&conn, "legacy");
        drop(conn);

        assert_eq!(load_session_fork(&path, "legacy").unwrap(), None);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn lineage_round_trips_and_survives_source_deletion() {
        let path = temp_store_path("source_deletion");
        crate::store::initialize(&path).unwrap();
        let conn = crate::store::open_connection(&path).unwrap();
        insert_session(&conn, "source");
        insert_session(&conn, "child");
        drop(conn);
        let expected = SessionForkLineage {
            session_id: "child".to_string(),
            source_session_id: "source".to_string(),
            copied_message_count: 7,
            source_message_count: 11,
            created_at: "forked-at".to_string(),
        };

        record_session_fork(&path, &expected).unwrap();
        assert_eq!(
            load_session_fork(&path, "child").unwrap(),
            Some(expected.clone())
        );
        assert!(crate::sessions::delete_session(&path, "source").unwrap());
        assert_eq!(load_session_fork(&path, "child").unwrap(), Some(expected));

        let conn = crate::store::open_connection(&path).unwrap();
        let source_foreign_keys: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_foreign_key_list('session_forks')
                 WHERE \"from\" = 'source_session_id'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(source_foreign_keys, 0);
        drop(conn);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
