//! Passive reads of independent tasks: visible direct sessions, never children or managed orchestrators.
use super::*;

/// Candidates returned by one search page.
pub const MAX_TASK_SEARCH_LIMIT: usize = 20;
/// Session rows examined by one search page before it yields a cursor.
pub const TASK_SEARCH_SCAN_LIMIT: usize = 500;
pub const MAX_TASK_REFERENCE_BYTES: usize = 64;
pub const MAX_TASK_TEXT_BYTES: usize = 120;
const PROMPT_EXCERPT_CHARS: usize = 240;

const INDEPENDENT_TASK: &str = "s.behavior IN ('direct', 'direct-with-orchestrator')
     AND NOT EXISTS (SELECT 1 FROM traditional_children c WHERE c.child_session_id = s.session_id)
     AND NOT EXISTS (SELECT 1 FROM managed_orchestrators m WHERE m.orchestrator_session_id = s.session_id)";

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskMatchField {
    Title,
    LastPrompt,
}

/// Caller visibility; rejected rows are skipped before matching and affect no output.
pub type TaskVisibility = std::sync::Arc<dyn Fn(&str) -> bool + Send + Sync>;

#[derive(Clone, Default)]
pub struct TaskSearch {
    pub project_id: String,
    /// Work-unit reference matched as a whole case-insensitive token.
    pub reference: Option<String>,
    /// Case-insensitive substring; discovery evidence only.
    pub text: Option<String>,
    pub exclude_session_id: Option<String>,
    pub after: Option<String>,
    pub limit: usize,
    pub visible: Option<TaskVisibility>,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct TaskRunState {
    pub run_id: String,
    /// `active`, `interrupted` or `failed` as durably recorded.
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct TaskGoalSummary {
    pub goal_id: String,
    pub status: GoalStatus,
    pub version: i64,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct TaskCandidate {
    pub session_id: String,
    pub project_id: String,
    pub behavior: String,
    pub title: Option<String>,
    pub last_prompt_excerpt: Option<String>,
    pub matched: Vec<TaskMatchField>,
    pub run_count: u64,
    pub current_run: Option<TaskRunState>,
    pub goal: Option<TaskGoalSummary>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct TaskSearchPage {
    pub candidates: Vec<TaskCandidate>,
    /// Exclusive cursor for the next page; present when more rows remain.
    pub next_after: Option<String>,
    /// Visible rows examined; rows hidden by `visible` are never counted.
    pub scanned_rows: usize,
    /// The page stopped at the scan bound rather than at `limit` matches.
    pub scan_limit_reached: bool,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct DirectTaskSnapshot {
    pub session_id: String,
    pub project_id: Option<String>,
    pub behavior: String,
    pub title: Option<String>,
    pub last_prompt_excerpt: Option<String>,
    pub run_count: u64,
    pub visible_message_count: u64,
    pub current_run: Option<TaskRunState>,
    pub pending_inbox_items: u64,
    pub goal: Option<SessionGoalRecord>,
    /// Newest first, bounded by `RETAINED_GOAL_OUTCOMES`.
    pub prior_goals: Vec<GoalOutcomeRecord>,
    /// Newest first, bounded by `RETAINED_RUN_OUTCOMES`.
    pub run_outcomes: Vec<RunOutcomeRecord>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Copy, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NonTaskSession {
    TraditionalChild,
    ManagedOrchestrator,
    Orchestrator,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaskLookup {
    Found(Box<DirectTaskSnapshot>),
    /// Never existed in this store, or was deleted; the store keeps no tombstone.
    NotFound,
    NotIndependentTask(NonTaskSession),
}

fn redact(text: &str) -> String {
    crate::model::redact_credentials(text, &[])
}

fn excerpt(text: Option<String>) -> Option<String> {
    text.map(|text| {
        let text = redact(&text);
        match super::task_evidence::truncate_chars(&text, PROMPT_EXCERPT_CHARS) {
            (kept, true) => format!("{kept}…"),
            (_, false) => text,
        }
    })
}

fn contains_token(haystack: &str, token: &str) -> bool {
    let haystack = haystack.to_ascii_lowercase();
    let token = token.to_ascii_lowercase();
    let is_word = |c: char| c.is_ascii_alphanumeric() || c == '_';
    haystack.match_indices(&token).any(|(start, _)| {
        let end = start + token.len();
        !haystack[..start].chars().next_back().is_some_and(is_word)
            && !haystack[end..].chars().next().is_some_and(is_word)
    })
}

fn contains_text(haystack: &str, text: &str) -> bool {
    haystack.to_lowercase().contains(&text.to_lowercase())
}

fn matched_fields(
    title: Option<&str>,
    prompt: Option<&str>,
    matches: impl Fn(&str) -> bool,
) -> Vec<TaskMatchField> {
    [
        (TaskMatchField::Title, title),
        (TaskMatchField::LastPrompt, prompt),
    ]
    .into_iter()
    .filter(|(_, value)| value.is_some_and(&matches))
    .map(|(field, _)| field)
    .collect()
}

/// Positions by row ID rather than session ID so a cursor never names a session.
fn encode_cursor(updated_at: &str, row_id: i64) -> String {
    format!("{updated_at}|{row_id}")
}

pub fn decode_task_cursor(cursor: &str) -> Option<(&str, i64)> {
    let (updated_at, row_id) = cursor.split_once('|')?;
    let row_id = row_id.parse().ok().filter(|row_id: &i64| *row_id >= 0)?;
    (!updated_at.is_empty()).then_some((updated_at, row_id))
}

fn current_run(conn: &Connection, session_id: &str) -> Result<Option<TaskRunState>> {
    Ok(conn
        .query_row(
            "SELECT run_id, status FROM session_run_recovery WHERE session_id = ?1",
            params![session_id],
            |row| {
                Ok(TaskRunState {
                    run_id: row.get(0)?,
                    status: row.get(1)?,
                })
            },
        )
        .optional()?)
}

fn goal_summary(conn: &Connection, session_id: &str) -> Result<Option<TaskGoalSummary>> {
    Ok(
        super::session_goals::load_with_connection(conn, session_id)?.map(|goal| TaskGoalSummary {
            goal_id: goal.goal_id,
            status: goal.status,
            version: goal.version,
        }),
    )
}

coordinated_command! {
/// One bounded page of a project's tasks, newest first; `None` when the project is missing.
pub fn search_direct_tasks(path: &Path, search: &TaskSearch) -> Result<Option<TaskSearchPage>> {
    let limit = search.limit.clamp(1, MAX_TASK_SEARCH_LIMIT);
    let after = match search.after.as_deref() {
        Some(cursor) => Some(
            decode_task_cursor(cursor).ok_or_else(|| anyhow!("invalid task search cursor"))?,
        ),
        None => None,
    };
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction()?;
    let project_exists = tx
        .query_row(
            "SELECT 1 FROM projects WHERE project_id = ?1",
            params![search.project_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !project_exists {
        return Ok(None);
    }
    let mut statement = tx.prepare(&format!(
        "SELECT s.session_id, s.behavior, p.title, s.last_user_prompt, s.run_count,
                s.created_at, s.updated_at, s.rowid
         FROM session_projects sp
         JOIN sessions s ON s.session_id = sp.session_id
         LEFT JOIN session_presentations p ON p.session_id = s.session_id
         WHERE sp.project_id = ?1 AND {INDEPENDENT_TASK}
           AND (?2 IS NULL OR s.session_id <> ?2)
           AND (?3 IS NULL OR s.updated_at < ?3 OR (s.updated_at = ?3 AND s.rowid < ?4))
         ORDER BY s.updated_at DESC, s.rowid DESC
         LIMIT ?5"
    ))?;
    let rows = statement
        .query_map(
            params![
                search.project_id,
                search.exclude_session_id,
                after.map(|(updated_at, _)| updated_at),
                after.map(|(_, row_id)| row_id),
                TASK_SEARCH_SCAN_LIMIT as i64 + 1
            ],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let unscanned_rows_remain = rows.len() > TASK_SEARCH_SCAN_LIMIT;
    let rows = rows.into_iter().take(TASK_SEARCH_SCAN_LIMIT);
    let mut candidates = Vec::new();
    let mut scanned_rows = 0;
    let mut last_scanned = None;
    let mut more = false;
    for (session_id, behavior, title, prompt, run_count, created_at, updated_at, row_id) in rows {
        if search
            .visible
            .as_ref()
            .is_some_and(|visible| !visible(&session_id))
        {
            last_scanned = Some(encode_cursor(&updated_at, row_id));
            continue;
        }
        let matched = match (&search.reference, &search.text) {
            (Some(reference), _) => {
                matched_fields(title.as_deref(), prompt.as_deref(), |value| {
                    contains_token(value, reference)
                })
            }
            (None, Some(text)) => matched_fields(title.as_deref(), prompt.as_deref(), |value| {
                contains_text(value, text)
            }),
            (None, None) => Vec::new(),
        };
        if (search.reference.is_some() || search.text.is_some()) && matched.is_empty() {
            scanned_rows += 1;
            last_scanned = Some(encode_cursor(&updated_at, row_id));
            continue;
        }
        if candidates.len() == limit {
            more = true;
            break;
        }
        scanned_rows += 1;
        last_scanned = Some(encode_cursor(&updated_at, row_id));
        candidates.push(TaskCandidate {
            current_run: current_run(&tx, &session_id)?,
            goal: goal_summary(&tx, &session_id)?,
            session_id,
            project_id: search.project_id.clone(),
            behavior,
            title,
            last_prompt_excerpt: excerpt(prompt),
            matched,
            run_count: run_count.max(0) as u64,
            created_at,
            updated_at,
        });
    }
    let scan_limit_reached = !more && unscanned_rows_remain;
    Ok(Some(TaskSearchPage {
        candidates,
        next_after: (more || scan_limit_reached).then_some(last_scanned).flatten(),
        scanned_rows,
        scan_limit_reached,
    }))
}
command SearchDirectTasksCommand {
    search: TaskSearch = search.clone(),
}
call |command| (&command.search)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Exact snapshot; a non-task session discloses only its topology kind.
pub fn load_direct_task(path: &Path, session_id: &str) -> Result<TaskLookup> {
    let mut conn = open_runtime_connection(path)?;
    let tx = conn.transaction()?;
    let Some((behavior, title, prompt, run_count, visible, created_at, updated_at, project_id)) = tx
        .query_row(
            "SELECT s.behavior, p.title, s.last_user_prompt, s.run_count,
                    s.visible_message_count, s.created_at, s.updated_at, sp.project_id
             FROM sessions s
             LEFT JOIN session_presentations p ON p.session_id = s.session_id
             LEFT JOIN session_projects sp ON sp.session_id = s.session_id
             WHERE s.session_id = ?1",
            params![session_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()?
    else {
        return Ok(TaskLookup::NotFound);
    };
    let relationship: Option<String> = tx
        .query_row(
            "SELECT 'child' FROM traditional_children WHERE child_session_id = ?1
             UNION ALL
             SELECT 'managed' FROM managed_orchestrators WHERE orchestrator_session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    match (relationship.as_deref(), behavior.as_str()) {
        (Some("child"), _) => {
            return Ok(TaskLookup::NotIndependentTask(NonTaskSession::TraditionalChild))
        }
        (Some(_), _) => {
            return Ok(TaskLookup::NotIndependentTask(
                NonTaskSession::ManagedOrchestrator,
            ))
        }
        (None, "direct" | "direct-with-orchestrator") => {}
        (None, _) => return Ok(TaskLookup::NotIndependentTask(NonTaskSession::Orchestrator)),
    }
    let pending_inbox_items: i64 = tx.query_row(
        "SELECT COUNT(*) FROM session_inbox WHERE session_id = ?1 AND status = 'pending'",
        params![session_id],
        |row| row.get(0),
    )?;
    Ok(TaskLookup::Found(Box::new(DirectTaskSnapshot {
        session_id: session_id.to_owned(),
        project_id,
        behavior,
        title,
        last_prompt_excerpt: excerpt(prompt),
        run_count: run_count.max(0) as u64,
        visible_message_count: visible.max(0) as u64,
        current_run: current_run(&tx, session_id)?,
        pending_inbox_items: pending_inbox_items.max(0) as u64,
        goal: super::session_goals::load_with_connection(&tx, session_id)?.map(|mut goal| {
            goal.objective = redact(&goal.objective);
            goal
        }),
        prior_goals: super::task_evidence::load_goal_outcomes_with_connection(&tx, session_id)?
            .into_iter()
            .map(|mut goal| {
                goal.objective = redact(&goal.objective);
                goal
            })
            .collect(),
        run_outcomes: super::task_evidence::load_run_outcomes_with_connection(&tx, session_id)?,
        created_at,
        updated_at,
    })))
}
command LoadDirectTaskCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

coordinated_command! {
/// The saved project a session belongs to, if any.
pub fn load_session_project_id(path: &Path, session_id: &str) -> Result<Option<String>> {
    let conn = open_runtime_connection(path)?;
    Ok(conn
        .query_row(
            "SELECT project_id FROM session_projects WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?)
}
command LoadSessionProjectIdCommand {
    session_id: String = session_id.to_owned(),
}
call |command| (&command.session_id)
correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id));
port public;
}

#[cfg(test)]
#[path = "task_discovery_tests.rs"]
mod tests;
