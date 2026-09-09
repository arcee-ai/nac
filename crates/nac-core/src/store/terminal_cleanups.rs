use super::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalRemoteCleanupRecord {
    pub session_id: String,
    pub pidfile: String,
}

pub fn record_terminal_remote_cleanup(path: &Path, session_id: &str, pidfile: &str) -> Result<()> {
    if pidfile.is_empty() || pidfile.len() > 1_024 {
        return Err(anyhow!("remote terminal cleanup identity is invalid"));
    }
    let conn = open_runtime_connection(path)?;
    conn.execute(
        "INSERT OR IGNORE INTO terminal_remote_cleanups
             (session_id, pidfile, created_at) VALUES (?1, ?2, ?3)",
        params![session_id, pidfile, now_utc()],
    )?;
    Ok(())
}

pub fn clear_terminal_remote_cleanup(path: &Path, session_id: &str, pidfile: &str) -> Result<()> {
    let conn = open_runtime_connection(path)?;
    conn.execute(
        "DELETE FROM terminal_remote_cleanups WHERE session_id = ?1 AND pidfile = ?2",
        params![session_id, pidfile],
    )?;
    Ok(())
}

pub fn list_terminal_remote_cleanups(
    path: &Path,
    session_id: &str,
) -> Result<Vec<TerminalRemoteCleanupRecord>> {
    let conn = open_runtime_connection(path)?;
    let mut statement = conn.prepare(
        "SELECT session_id, pidfile FROM terminal_remote_cleanups
         WHERE session_id = ?1 ORDER BY pidfile",
    )?;
    let rows = statement
        .query_map(params![session_id], |row| {
            Ok(TerminalRemoteCleanupRecord {
                session_id: row.get(0)?,
                pidfile: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(anyhow::Error::new)?;
    Ok(rows)
}
