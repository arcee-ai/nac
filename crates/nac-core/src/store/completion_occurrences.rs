//! Content-free historical work completion. Current idleness/decision eligibility
//! remains a separate projection. Only canonical terminal transactions append.
use super::*;
use serde::{Deserialize, Serialize};

pub const COMPLETION_PAGE_ROWS: usize = 128;
pub const COMPLETION_PAGE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionCursor {
    pub store: String,
    pub sequence: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionKind {
    Request,
    Goal,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionOccurrence {
    pub sequence: i64,
    pub session_id: String,
    pub run_id: String,
    pub behavior: String,
    pub kind: CompletionKind,
    pub goal_id: Option<String>,
    pub mark_version: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionPage {
    pub cursor: CompletionCursor,
    pub high_water: i64,
    pub baseline: bool,
    pub more: bool,
    pub items: Vec<CompletionOccurrence>,
}

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_completion_feed (
             singleton INTEGER PRIMARY KEY CHECK(singleton=1), store_id TEXT NOT NULL UNIQUE
         );
         CREATE TABLE IF NOT EXISTS session_completion_bindings (
             session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
             run_id TEXT NOT NULL, submitted_message_id INTEGER NOT NULL REFERENCES thread_events(id) ON DELETE CASCADE,
             behavior TEXT NOT NULL CHECK(behavior IN ('orchestrator','direct','direct-with-orchestrator')),
             eligible INTEGER NOT NULL CHECK(eligible IN (0,1)),
             goal_participated INTEGER NOT NULL DEFAULT 0 CHECK(goal_participated IN (0,1)),
             question_yield INTEGER NOT NULL DEFAULT 0 CHECK(question_yield IN (0,1)),
             PRIMARY KEY(session_id,run_id)
         );
         CREATE TABLE IF NOT EXISTS session_completion_marks (
             session_id TEXT NOT NULL, run_id TEXT NOT NULL, goal_id TEXT NOT NULL,
             mark_version INTEGER NOT NULL CHECK(mark_version>=0),
             PRIMARY KEY(session_id,goal_id,mark_version),
             FOREIGN KEY(session_id,run_id) REFERENCES session_completion_bindings(session_id,run_id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS session_completion_occurrences (
             sequence INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
             run_id TEXT NOT NULL,
             behavior TEXT NOT NULL CHECK(behavior IN ('orchestrator','direct','direct-with-orchestrator')),
             kind TEXT NOT NULL CHECK(kind IN ('request','goal')),
             goal_id TEXT, mark_version INTEGER,
             committed_at TEXT NOT NULL,
             CHECK((kind='request' AND goal_id IS NULL AND mark_version IS NULL) OR
                   (kind='goal' AND goal_id IS NOT NULL AND mark_version IS NOT NULL AND mark_version>=0))
         );
         CREATE UNIQUE INDEX IF NOT EXISTS idx_completion_request
             ON session_completion_occurrences(session_id,run_id) WHERE kind='request';
         CREATE UNIQUE INDEX IF NOT EXISTS idx_completion_goal
             ON session_completion_occurrences(session_id,goal_id,mark_version) WHERE kind='goal';
         CREATE INDEX IF NOT EXISTS idx_completion_session
             ON session_completion_occurrences(session_id,sequence);",
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO session_completion_feed VALUES(1,?1)",
        [uuid::Uuid::new_v4().to_string()],
    )?;
    // Existing active work can finish after upgrade. No historical completion
    // or pre-upgrade goal-complete mark is fabricated by the migration.
    let mut query = conn.prepare(
        "SELECT session_id,run_id,submitted_message_id FROM session_run_recovery WHERE status='active'",
    )?;
    let active = query.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    for row in active {
        let (session, run, submitted) = row?;
        begin(conn, &session, &run, submitted)?;
    }
    Ok(())
}

pub(super) fn begin(conn: &Connection, session: &str, run: &str, submitted: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM session_completion_bindings WHERE session_id=?1 AND run_id<>?2",
        params![session, run],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO session_completion_bindings
         (session_id,run_id,submitted_message_id,behavior,eligible,goal_participated,question_yield)
         SELECT s.session_id,?2,?3,s.behavior,
             NOT EXISTS(SELECT 1 FROM traditional_children WHERE child_session_id=s.session_id AND run_id=?2)
             AND NOT EXISTS(SELECT 1 FROM managed_orchestrators WHERE orchestrator_session_id=s.session_id AND run_id=?2),
             EXISTS(SELECT 1 FROM session_goals g WHERE g.session_id=s.session_id AND g.accounting_run_id=?2),
             EXISTS(SELECT 1 FROM task_questions q WHERE q.session_id=s.session_id AND json_extract(q.request_json,'$.run_id')=?2)
         FROM sessions s WHERE s.session_id=?1",
        params![session, run, submitted],
    )?;
    Ok(())
}

pub(super) fn goal_participated(conn: &Connection, session: &str, run: &str) -> Result<()> {
    conn.execute(
        "UPDATE session_completion_bindings SET goal_participated=1 WHERE session_id=?1 AND run_id=?2",
        params![session, run],
    )?;
    Ok(())
}

pub(super) fn goal_marked(conn: &Connection, goal: &SessionGoalRecord) -> Result<()> {
    let Some(run) = goal.accounting_run_id.as_deref() else {
        return Ok(());
    };
    goal_participated(conn, &goal.session_id, run)?;
    conn.execute(
        "INSERT OR IGNORE INTO session_completion_marks(session_id,run_id,goal_id,mark_version)
         SELECT ?1,?2,?3,?4 WHERE EXISTS(
             SELECT 1 FROM session_completion_bindings b JOIN session_run_recovery r
             ON r.session_id=b.session_id AND r.run_id=b.run_id
             WHERE b.session_id=?1 AND b.run_id=?2 AND r.status='active')",
        params![goal.session_id, run, goal.goal_id, goal.version],
    )?;
    Ok(())
}

pub(super) fn question_yield(conn: &Connection, session: &str, run: &str) -> Result<()> {
    conn.execute(
        "UPDATE session_completion_bindings SET question_yield=1 WHERE session_id=?1 AND run_id=?2",
        params![session, run],
    )?;
    Ok(())
}

pub(super) fn settle(conn: &Connection, session: &str, run: &str, successful: bool) -> Result<()> {
    if successful {
        conn.execute(
            "INSERT OR IGNORE INTO session_completion_occurrences
             (session_id,run_id,behavior,kind,goal_id,mark_version,committed_at)
             SELECT b.session_id,b.run_id,b.behavior,'goal',m.goal_id,m.mark_version,?3
             FROM session_completion_bindings b JOIN session_completion_marks m
             ON m.session_id=b.session_id AND m.run_id=b.run_id
             WHERE b.session_id=?1 AND b.run_id=?2 AND b.eligible=1 AND b.question_yield=0",
            params![session, run, now_utc()],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO session_completion_occurrences
             (session_id,run_id,behavior,kind,committed_at)
             SELECT session_id,run_id,behavior,'request',?3 FROM session_completion_bindings
             WHERE session_id=?1 AND run_id=?2 AND eligible=1 AND goal_participated=0 AND question_yield=0",
            params![session, run, now_utc()],
        )?;
    }
    conn.execute(
        "DELETE FROM session_completion_bindings WHERE session_id=?1 AND run_id=?2",
        params![session, run],
    )?;
    Ok(())
}

coordinated_command! {
pub fn read_completion_page(path: &Path, after: Option<&CompletionCursor>) -> Result<CompletionPage> {
    let conn = open_runtime_connection(path)?;
    let tx = conn.unchecked_transaction()?;
    let store: String = tx.query_row("SELECT store_id FROM session_completion_feed WHERE singleton=1", [], |row| row.get(0))?;
    anyhow::ensure!(uuid::Uuid::parse_str(&store).is_ok() && store.len()==36,"completion store identity is unavailable");
    let high_water: i64 = tx.query_row("SELECT coalesce((SELECT seq FROM sqlite_sequence WHERE name='session_completion_occurrences'),0)", [], |row| row.get(0))?;
    let mut page = CompletionPage { cursor: CompletionCursor { store: store.clone(), sequence: high_water }, high_water,
        baseline: after.is_none(), more: false, items: Vec::new() };
    let Some(after) = after else { return Ok(page); };
    anyhow::ensure!(after.store==store && after.sequence>=0 && after.sequence<=high_water,"completion cursor does not belong to this store frontier");
    let mut query = tx.prepare("SELECT sequence,session_id,run_id,behavior,kind,goal_id,mark_version
        FROM session_completion_occurrences WHERE sequence>?1 AND sequence<=?2 ORDER BY sequence LIMIT 129")?;
    let rows = query.query_map(params![after.sequence,high_water], |row| {
        let kind: String = row.get(4)?;
        Ok(CompletionOccurrence { sequence: row.get(0)?, session_id: row.get(1)?, run_id: row.get(2)?, behavior: row.get(3)?,
            kind: if kind=="goal" { CompletionKind::Goal } else { CompletionKind::Request }, goal_id: row.get(5)?, mark_version: row.get(6)? })
    })?;
    let mut bytes = 512;
    for row in rows {
        let row = row?;
        anyhow::ensure!([Some(row.session_id.as_str()),Some(row.run_id.as_str()),row.goal_id.as_deref()].into_iter().flatten()
            .all(|id| !id.is_empty() && id.len()<=512 && !id.chars().any(char::is_control)),"completion metadata identity is unavailable");
        let size = serde_json::to_vec(&row)?.len()+1;
        if page.items.len()==COMPLETION_PAGE_ROWS || bytes+size>COMPLETION_PAGE_BYTES {
            page.more=true;
            page.cursor.sequence=page.items.last().map_or(after.sequence,|item|item.sequence);
            break;
        }
        bytes+=size;
        page.items.push(row);
    }
    Ok(page)
}
command ReadCompletionPageCommand { after: Option<CompletionCursor> = after.cloned() }
call |command| (command.after.as_ref())
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

#[cfg(test)]
#[path = "completion_occurrences_tests.rs"]
mod tests;
