//! Schema49 physical ledger and migration-only active-run binding.
//! Runtime completion production remains the lifecycle supplier's owner.
use super::*;

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

fn begin(conn: &Connection, session: &str, run: &str, submitted: i64) -> Result<()> {
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
