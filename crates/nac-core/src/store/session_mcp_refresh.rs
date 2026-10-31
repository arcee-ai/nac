//! Durable intent only: each independently constructed agent acknowledges the
//! requested revision at its own model boundary. No tool invocation is stored or replayed here.
use super::*;

#[derive(Debug)]
pub struct SessionMcpRefreshConflict;

impl std::fmt::Display for SessionMcpRefreshConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MCP refresh revision changed; reload session integrations and retry")
    }
}
impl std::error::Error for SessionMcpRefreshConflict {}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionMcpRefreshRequest {
    pub revision: i64,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub requested_at: Option<String>,
}

pub(super) fn create_table(connection: &Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_mcp_refresh (
             session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
             revision INTEGER NOT NULL CHECK (revision > 0),
             requested_at TEXT NOT NULL
         );",
    )?;
    Ok(())
}

fn load(connection: &Connection, session_id: &str) -> Result<SessionMcpRefreshRequest> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = ?1)",
        [session_id],
        |row| row.get(0),
    )?;
    anyhow::ensure!(exists, "session was not found");
    Ok(connection
        .query_row(
            "SELECT revision, requested_at FROM session_mcp_refresh WHERE session_id = ?1",
            [session_id],
            |row| {
                Ok(SessionMcpRefreshRequest {
                    revision: row.get(0)?,
                    requested_at: Some(row.get(1)?),
                })
            },
        )
        .optional()?
        .unwrap_or(SessionMcpRefreshRequest {
            revision: 0,
            requested_at: None,
        }))
}

coordinated_command! {
pub fn load_session_mcp_refresh(path: &Path, session_id: &str) -> Result<SessionMcpRefreshRequest> {
    let connection = open_runtime_connection(path)?;
    load(&connection, session_id)
}
command LoadSessionMcpRefresh { session_id: String = session_id.to_owned() }
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
pub fn request_session_mcp_refresh(path: &Path, session_id: &str, expected_revision: i64) -> Result<SessionMcpRefreshRequest> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let current = load(&transaction, session_id)?;
    if current.revision != expected_revision { return Err(SessionMcpRefreshConflict.into()); }
    let revision = current.revision.checked_add(1).context("MCP refresh revision exhausted")?;
    let requested_at = now_utc();
    transaction.execute(
        "INSERT INTO session_mcp_refresh(session_id, revision, requested_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET revision = excluded.revision, requested_at = excluded.requested_at",
        params![session_id, revision, requested_at],
    )?;
    transaction.commit()?;
    Ok(SessionMcpRefreshRequest { revision, requested_at: Some(requested_at) })
}
command RequestSessionMcpRefresh {
    session_id: String = session_id.to_owned(),
    expected_revision: i64 = expected_revision,
}
call |command| (&command.session_id, command.expected_revision)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_intent_is_revision_checked_restart_safe_and_session_scoped() {
        let path =
            std::env::temp_dir().join(format!("nac-mcp-refresh-{}.db", uuid::Uuid::new_v4()));
        initialize(&path).unwrap();
        // Repeating the owning DDL after startup is idempotent.
        create_table(&open_runtime_connection(&path).unwrap()).unwrap();
        insert_test_session(&path, "parent");
        insert_test_session(&path, "child");
        assert_eq!(
            load_session_mcp_refresh(&path, "parent").unwrap().revision,
            0
        );
        let first = request_session_mcp_refresh(&path, "parent", 0).unwrap();
        assert_eq!(first.revision, 1);
        assert!(request_session_mcp_refresh(&path, "parent", 0).is_err());
        initialize(&path).unwrap();
        assert_eq!(load_session_mcp_refresh(&path, "parent").unwrap(), first);
        assert_eq!(
            load_session_mcp_refresh(&path, "child").unwrap().revision,
            0
        );
        assert!(request_session_mcp_refresh(&path, "missing", 0).is_err());
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn concurrent_refresh_requests_admit_only_one_expected_revision() {
        let path =
            std::env::temp_dir().join(format!("nac-mcp-refresh-race-{}.db", uuid::Uuid::new_v4()));
        initialize(&path).unwrap();
        create_table(&open_runtime_connection(&path).unwrap()).unwrap();
        insert_test_session(&path, "owner");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
        let handles: Vec<_> = (0..2)
            .map(|_| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    request_session_mcp_refresh(&path, "owner", 0)
                })
            })
            .collect();
        barrier.wait();
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        assert!(results
            .iter()
            .filter_map(|result| result.as_ref().err())
            .all(|error| error.is::<SessionMcpRefreshConflict>()));
        assert_eq!(
            load_session_mcp_refresh(&path, "owner").unwrap().revision,
            1
        );
        open_runtime_connection(&path)
            .unwrap()
            .execute("DELETE FROM sessions WHERE session_id='owner'", [])
            .unwrap();
        assert!(load_session_mcp_refresh(&path, "owner").is_err());
        let _ = std::fs::remove_file(path);
    }
}
