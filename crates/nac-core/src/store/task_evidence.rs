//! Insert-once, per-session bounded run and goal outcomes for independent tasks.
use super::*;

/// Terminal runs retained per session for exact passive reads.
pub const RETAINED_RUN_OUTCOMES: usize = 8;
/// Replaced or cleared goals retained per session for exact passive reads.
pub const RETAINED_GOAL_OUTCOMES: usize = 8;
/// Characters of the final response kept as run-result evidence.
pub const RUN_RESULT_EXCERPT_CHARS: usize = 2_000;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcomeDisposition {
    Completed,
    Cancelled,
    Failed,
}

impl RunOutcomeDisposition {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

impl From<RunTerminalDisposition> for RunOutcomeDisposition {
    fn from(disposition: RunTerminalDisposition) -> Self {
        match disposition {
            RunTerminalDisposition::Completed => Self::Completed,
            RunTerminalDisposition::Cancelled => Self::Cancelled,
        }
    }
}

impl std::str::FromStr for RunOutcomeDisposition {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "completed" => Ok(Self::Completed),
            "cancelled" => Ok(Self::Cancelled),
            "failed" => Ok(Self::Failed),
            _ => Err(anyhow!("unsupported stored run outcome '{value}'")),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct RunOutcomeRecord {
    pub run_id: String,
    pub disposition: RunOutcomeDisposition,
    /// Bounded prefix of the final response; absent for cancelled/failed runs.
    pub result_excerpt: Option<String>,
    pub result_truncated: bool,
    pub failure: Option<crate::run_failure::RunFailure>,
    pub finished_at: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GoalRetirement {
    Replaced,
    Cleared,
}

impl GoalRetirement {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Replaced => "replaced",
            Self::Cleared => "cleared",
        }
    }
}

/// The last durable state of a goal that is no longer current.
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct GoalOutcomeRecord {
    pub goal_id: String,
    pub objective: String,
    pub status: GoalStatus,
    pub version: i64,
    pub tokens_used: u64,
    pub time_used_ms: u64,
    pub last_failure: Option<crate::run_failure::RunFailure>,
    pub created_at: String,
    pub updated_at: String,
    pub retired_at: String,
    pub retirement: GoalRetirement,
    /// The last run that settled against this goal, when one did.
    pub last_run_id: Option<String>,
}

pub(super) fn create_task_evidence_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS session_run_outcomes (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             run_id TEXT NOT NULL CHECK (length(trim(run_id)) > 0),
             disposition TEXT NOT NULL
                 CHECK (disposition IN ('completed', 'cancelled', 'failed')),
             result_excerpt TEXT,
             result_truncated INTEGER NOT NULL DEFAULT 0 CHECK (result_truncated IN (0, 1)),
             failure_json TEXT,
             finished_at TEXT NOT NULL,
             UNIQUE (session_id, run_id)
         );
         CREATE INDEX IF NOT EXISTS idx_session_run_outcomes_session
             ON session_run_outcomes(session_id, id DESC);
         CREATE TABLE IF NOT EXISTS session_goal_outcomes (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             session_id TEXT NOT NULL
                 REFERENCES sessions(session_id) ON DELETE CASCADE,
             goal_id TEXT NOT NULL CHECK (length(trim(goal_id)) > 0),
             objective TEXT NOT NULL,
             status TEXT NOT NULL
                 CHECK (status IN ('active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete')),
             version INTEGER NOT NULL CHECK (version >= 0),
             tokens_used INTEGER NOT NULL CHECK (tokens_used >= 0),
             time_used_ms INTEGER NOT NULL CHECK (time_used_ms >= 0),
             last_failure_json TEXT,
             created_at TEXT NOT NULL,
             updated_at TEXT NOT NULL,
             retired_at TEXT NOT NULL,
             retirement TEXT NOT NULL CHECK (retirement IN ('replaced', 'cleared')),
             last_run_id TEXT,
             UNIQUE (session_id, goal_id)
         );
         CREATE INDEX IF NOT EXISTS idx_session_goal_outcomes_session
             ON session_goal_outcomes(session_id, id DESC);",
    )?;
    Ok(())
}

/// The first `limit` characters and whether anything was cut.
pub(super) fn truncate_chars(text: &str, limit: usize) -> (&str, bool) {
    match text.char_indices().nth(limit) {
        Some((end, _)) => (&text[..end], true),
        None => (text, false),
    }
}

fn prune(conn: &Connection, table: &str, session_id: &str, keep: usize) -> Result<()> {
    conn.execute(
        &format!(
            "DELETE FROM {table} WHERE session_id = ?1 AND id NOT IN
             (SELECT id FROM {table} WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2)"
        ),
        params![session_id, keep as i64],
    )?;
    Ok(())
}

/// Records a terminal run in the settlement transaction; a replay keeps the first outcome.
pub(crate) fn record_run_outcome_with_connection(
    conn: &Connection,
    session_id: &str,
    run_id: &str,
    disposition: RunOutcomeDisposition,
    result: Option<&str>,
    failure: Option<&crate::run_failure::RunFailure>,
) -> Result<()> {
    let (excerpt, truncated) = match result {
        Some(result) => {
            let redacted = crate::model::redact_credentials(result, &[]);
            let (excerpt, truncated) = truncate_chars(&redacted, RUN_RESULT_EXCERPT_CHARS);
            (Some(excerpt.to_owned()), truncated)
        }
        None => (None, false),
    };
    let failure_json = failure
        .cloned()
        .map(crate::run_failure::RunFailure::sanitized)
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .context("failed to serialize run outcome failure")?;
    conn.execute(
        "INSERT OR IGNORE INTO session_run_outcomes
         (session_id, run_id, disposition, result_excerpt, result_truncated, failure_json, finished_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            session_id,
            run_id,
            disposition.as_str(),
            excerpt,
            truncated,
            failure_json,
            now_utc()
        ],
    )?;
    prune(
        conn,
        "session_run_outcomes",
        session_id,
        RETAINED_RUN_OUTCOMES,
    )
}

/// Retains the final state of a goal row the caller is about to delete.
pub(super) fn retain_goal_outcome_with_connection(
    conn: &Connection,
    goal: &SessionGoalRecord,
    retirement: GoalRetirement,
) -> Result<()> {
    let failure_json = goal
        .last_failure
        .clone()
        .map(crate::run_failure::RunFailure::sanitized)
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .context("failed to serialize retained goal failure")?;
    conn.execute(
        "INSERT OR IGNORE INTO session_goal_outcomes
         (session_id, goal_id, objective, status, version, tokens_used, time_used_ms,
          last_failure_json, created_at, updated_at, retired_at, retirement, last_run_id)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
                coalesce(accounting_run_id, last_run_id)
         FROM session_goals WHERE session_id = ?1 AND goal_id = ?2",
        params![
            goal.session_id,
            goal.goal_id,
            goal.objective,
            goal.status.as_str(),
            goal.version,
            i64::try_from(goal.tokens_used).unwrap_or(i64::MAX),
            i64::try_from(goal.time_used_ms).unwrap_or(i64::MAX),
            failure_json,
            goal.created_at,
            goal.updated_at,
            now_utc(),
            retirement.as_str()
        ],
    )?;
    prune(
        conn,
        "session_goal_outcomes",
        &goal.session_id,
        RETAINED_GOAL_OUTCOMES,
    )
}

fn conversion_error(index: usize, error: anyhow::Error) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, error.into())
}

fn optional_failure(
    index: usize,
    json: Option<String>,
) -> rusqlite::Result<Option<crate::run_failure::RunFailure>> {
    json.map(|json| {
        serde_json::from_str(&json).map_err(|error| conversion_error(index, error.into()))
    })
    .transpose()
}

/// Newest first.
pub(crate) fn load_run_outcomes_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<RunOutcomeRecord>> {
    let mut statement = conn.prepare(
        "SELECT run_id, disposition, result_excerpt, result_truncated, failure_json, finished_at
         FROM session_run_outcomes WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![session_id, RETAINED_RUN_OUTCOMES as i64], |row| {
        Ok(RunOutcomeRecord {
            run_id: row.get(0)?,
            disposition: row
                .get::<_, String>(1)?
                .parse()
                .map_err(|error| conversion_error(1, error))?,
            result_excerpt: row.get(2)?,
            result_truncated: row.get(3)?,
            failure: optional_failure(4, row.get(4)?)?,
            finished_at: row.get(5)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// Newest first.
pub(crate) fn load_goal_outcomes_with_connection(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<GoalOutcomeRecord>> {
    let mut statement = conn.prepare(
        "SELECT goal_id, objective, status, version, tokens_used, time_used_ms,
                last_failure_json, created_at, updated_at, retired_at, retirement, last_run_id
         FROM session_goal_outcomes WHERE session_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?;
    let rows = statement.query_map(params![session_id, RETAINED_GOAL_OUTCOMES as i64], |row| {
        Ok(GoalOutcomeRecord {
            goal_id: row.get(0)?,
            objective: row.get(1)?,
            status: row
                .get::<_, String>(2)?
                .parse()
                .map_err(|error| conversion_error(2, error))?,
            version: row.get(3)?,
            tokens_used: row.get::<_, i64>(4)?.max(0) as u64,
            time_used_ms: row.get::<_, i64>(5)?.max(0) as u64,
            last_failure: optional_failure(6, row.get(6)?)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            retired_at: row.get(9)?,
            retirement: match row.get::<_, String>(10)?.as_str() {
                "replaced" => GoalRetirement::Replaced,
                "cleared" => GoalRetirement::Cleared,
                other => {
                    return Err(conversion_error(
                        10,
                        anyhow!("unsupported stored goal retirement '{other}'"),
                    ))
                }
            },
            last_run_id: row.get(11)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

#[cfg(test)]
#[path = "task_evidence_tests.rs"]
mod tests;
