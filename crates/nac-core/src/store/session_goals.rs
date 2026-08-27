use super::*;

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum GoalStatus {
    Active,
    Paused,
    Blocked,
    UsageLimited,
    BudgetLimited,
    Complete,
}

impl GoalStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Paused => "paused",
            Self::Blocked => "blocked",
            Self::UsageLimited => "usage_limited",
            Self::BudgetLimited => "budget_limited",
            Self::Complete => "complete",
        }
    }

    pub const fn is_unfinished(self) -> bool {
        !matches!(self, Self::Complete)
    }
}

impl std::str::FromStr for GoalStatus {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "active" => Ok(Self::Active),
            "paused" => Ok(Self::Paused),
            "blocked" => Ok(Self::Blocked),
            "usage_limited" => Ok(Self::UsageLimited),
            "budget_limited" => Ok(Self::BudgetLimited),
            "complete" => Ok(Self::Complete),
            _ => Err(anyhow!("unsupported stored goal status '{value}'")),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct SessionGoalRecord {
    pub session_id: String,
    pub goal_id: String,
    pub objective: String,
    pub status: GoalStatus,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub token_budget: Option<u64>,
    pub tokens_used: u64,
    pub time_used_ms: u64,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub accounting_run_id: Option<String>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub accounting_token_baseline: Option<u64>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub accounting_started_at_epoch_ms: Option<u64>,
    #[cfg_attr(feature = "openapi", schema(required))]
    pub continuation_run_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub version: i64,
}

impl SessionGoalRecord {
    pub fn time_used_seconds(&self) -> u64 {
        self.time_used_ms / 1_000
    }

    pub fn remaining_tokens(&self) -> Option<u64> {
        self.token_budget
            .map(|budget| budget.saturating_sub(self.tokens_used))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalRunBaseline {
    pub run_id: String,
    pub billable_tokens: u64,
    pub started_at_epoch_ms: u64,
    pub continuation: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoalRunDisposition {
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GoalRunSettlement {
    pub run_id: String,
    pub final_billable_tokens: u64,
    pub terminal_at_epoch_ms: u64,
    pub disposition: GoalRunDisposition,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UserGoalUpdate {
    pub objective: Option<String>,
    /// `Some(None)` removes the budget; `None` preserves it.
    pub token_budget: Option<Option<u64>>,
    pub status: Option<GoalStatus>,
}

const COLUMNS: &str =
    "session_id, goal_id, objective, status, token_budget, tokens_used, time_used_ms, \
     accounting_run_id, accounting_token_baseline, accounting_started_at_epoch_ms, \
     continuation_run_id, created_at, updated_at, version";

fn u64_from_i64(index: usize, value: i64) -> rusqlite::Result<u64> {
    u64::try_from(value).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(
            index,
            rusqlite::types::Type::Integer,
            error.into(),
        )
    })
}

fn optional_u64_from_i64(index: usize, value: Option<i64>) -> rusqlite::Result<Option<u64>> {
    value.map(|value| u64_from_i64(index, value)).transpose()
}

fn row_to_goal(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionGoalRecord> {
    let status: String = row.get(3)?;
    Ok(SessionGoalRecord {
        session_id: row.get(0)?,
        goal_id: row.get(1)?,
        objective: row.get(2)?,
        status: status.parse().map_err(|error: anyhow::Error| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, error.into())
        })?,
        token_budget: optional_u64_from_i64(4, row.get(4)?)?,
        tokens_used: u64_from_i64(5, row.get(5)?)?,
        time_used_ms: u64_from_i64(6, row.get(6)?)?,
        accounting_run_id: row.get(7)?,
        accounting_token_baseline: optional_u64_from_i64(8, row.get(8)?)?,
        accounting_started_at_epoch_ms: optional_u64_from_i64(9, row.get(9)?)?,
        continuation_run_id: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        version: row.get(13)?,
    })
}

fn checked_integer(value: u64, label: &str) -> Result<i64> {
    i64::try_from(value).map_err(|_| anyhow!("goal {label} exceeds SQLite's integer range"))
}

fn validate_objective(objective: &str) -> Result<&str> {
    let objective = objective.trim();
    if objective.is_empty() {
        return Err(anyhow!("goal objective is empty"));
    }
    Ok(objective)
}

fn validate_budget(token_budget: Option<u64>) -> Result<Option<i64>> {
    token_budget
        .map(|budget| {
            if budget == 0 {
                Err(anyhow!("goal token budget must be greater than zero"))
            } else {
                checked_integer(budget, "token budget")
            }
        })
        .transpose()
}

fn require_direct_session(connection: &Connection, session_id: &str) -> Result<()> {
    let behavior: Option<String> = connection
        .query_row(
            "SELECT behavior FROM sessions WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .optional()?;
    match behavior.as_deref() {
        Some("direct" | "direct-with-orchestrator") => Ok(()),
        Some("orchestrator") => Err(anyhow!("goals are only available for direct sessions")),
        Some(other) => Err(anyhow!("unsupported stored session behavior '{other}'")),
        None => Err(anyhow!("session '{session_id}' was not found")),
    }
}

fn load_with_connection(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<SessionGoalRecord>> {
    Ok(connection
        .query_row(
            &format!("SELECT {COLUMNS} FROM session_goals WHERE session_id = ?1"),
            params![session_id],
            row_to_goal,
        )
        .optional()?)
}

pub fn load_session_goal(path: &Path, session_id: &str) -> Result<Option<SessionGoalRecord>> {
    let connection = open_runtime_connection(path)?;
    require_direct_session(&connection, session_id)?;
    load_with_connection(&connection, session_id)
}

pub fn create_session_goal(
    path: &Path,
    session_id: &str,
    objective: &str,
    token_budget: Option<u64>,
    active_run: Option<&GoalRunBaseline>,
) -> Result<SessionGoalRecord> {
    let objective = validate_objective(objective)?;
    let token_budget = validate_budget(token_budget)?;
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_direct_session(&transaction, session_id)?;
    if let Some(existing) = load_with_connection(&transaction, session_id)? {
        if existing.status.is_unfinished() {
            return Err(anyhow!(
                "session already has an unfinished goal '{}'",
                existing.goal_id
            ));
        }
        transaction.execute(
            "DELETE FROM session_goals WHERE session_id = ?1",
            params![session_id],
        )?;
    }
    let goal_id = uuid::Uuid::new_v4().to_string();
    let now = now_utc();
    let (run_id, baseline, started_at, continuation) = match active_run {
        Some(run) => (
            Some(run.run_id.as_str()),
            Some(checked_integer(run.billable_tokens, "run token baseline")?),
            Some(checked_integer(run.started_at_epoch_ms, "run start time")?),
            run.continuation.then_some(run.run_id.as_str()),
        ),
        None => (None, None, None, None),
    };
    transaction.execute(
        "INSERT INTO session_goals
         (session_id, goal_id, objective, status, token_budget, accounting_run_id,
          accounting_token_baseline, accounting_started_at_epoch_ms,
          continuation_run_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            session_id,
            goal_id,
            objective,
            token_budget,
            run_id,
            baseline,
            started_at,
            continuation,
            now
        ],
    )?;
    let goal = load_with_connection(&transaction, session_id)?.expect("inserted goal");
    transaction.commit()?;
    Ok(goal)
}

pub fn update_session_goal_by_user(
    path: &Path,
    session_id: &str,
    goal_id: &str,
    expected_version: i64,
    update: UserGoalUpdate,
) -> Result<SessionGoalRecord> {
    if expected_version < 0 {
        return Err(anyhow!("goal version must not be negative"));
    }
    if let Some(status) = update.status {
        if status == GoalStatus::Complete {
            return Err(anyhow!(
                "user controls clear a goal instead of setting it complete"
            ));
        }
    }
    let objective = update
        .objective
        .as_deref()
        .map(validate_objective)
        .transpose()?;
    let budget = update.token_budget.map(validate_budget).transpose()?;
    if objective.is_none() && budget.is_none() && update.status.is_none() {
        return Err(anyhow!("goal update is empty"));
    }
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    require_direct_session(&transaction, session_id)?;
    let current = load_with_connection(&transaction, session_id)?
        .ok_or_else(|| anyhow!("session '{session_id}' has no goal"))?;
    if current.goal_id != goal_id {
        return Err(anyhow!("goal '{goal_id}' is no longer current"));
    }
    if current.version != expected_version {
        return Err(anyhow!(
            "goal version conflict: expected {expected_version}, current {}",
            current.version
        ));
    }
    let next_objective = objective.unwrap_or(&current.objective);
    let next_budget = match budget {
        Some(value) => value,
        None => current
            .token_budget
            .map(|value| checked_integer(value, "token budget"))
            .transpose()?,
    };
    let requested_status = update.status.unwrap_or(current.status);
    let next_status = if requested_status == GoalStatus::Active
        && next_budget.is_some_and(|budget| current.tokens_used >= budget as u64)
    {
        GoalStatus::BudgetLimited
    } else {
        requested_status
    };
    transaction.execute(
        "UPDATE session_goals
         SET objective = ?1, token_budget = ?2, status = ?3,
             updated_at = ?4, version = version + 1
         WHERE session_id = ?5 AND goal_id = ?6 AND version = ?7",
        params![
            next_objective,
            next_budget,
            next_status.as_str(),
            now_utc(),
            session_id,
            goal_id,
            expected_version
        ],
    )?;
    let goal = load_with_connection(&transaction, session_id)?.expect("updated goal");
    transaction.commit()?;
    Ok(goal)
}

pub fn update_session_goal_by_model(
    path: &Path,
    session_id: &str,
    goal_id: &str,
    status: GoalStatus,
) -> Result<SessionGoalRecord> {
    if !matches!(status, GoalStatus::Blocked | GoalStatus::Complete) {
        return Err(anyhow!(
            "the model may only mark a goal blocked or complete"
        ));
    }
    let connection = open_runtime_connection(path)?;
    require_direct_session(&connection, session_id)?;
    let changed = connection.execute(
        "UPDATE session_goals
         SET status = ?1, updated_at = ?2, version = version + 1
         WHERE session_id = ?3 AND goal_id = ?4 AND status != 'complete'",
        params![status.as_str(), now_utc(), session_id, goal_id],
    )?;
    if changed != 1 {
        return Err(anyhow!("goal '{goal_id}' is no longer active"));
    }
    load_with_connection(&connection, session_id)?.ok_or_else(|| anyhow!("goal disappeared"))
}

pub fn clear_session_goal(
    path: &Path,
    session_id: &str,
    goal_id: &str,
    expected_version: i64,
) -> Result<()> {
    let connection = open_runtime_connection(path)?;
    require_direct_session(&connection, session_id)?;
    let changed = connection.execute(
        "DELETE FROM session_goals
         WHERE session_id = ?1 AND goal_id = ?2 AND version = ?3",
        params![session_id, goal_id, expected_version],
    )?;
    if changed != 1 {
        return Err(anyhow!("goal clear conflict or goal is no longer current"));
    }
    Ok(())
}

pub fn bind_session_goal_run(
    path: &Path,
    session_id: &str,
    baseline: &GoalRunBaseline,
) -> Result<Option<SessionGoalRecord>> {
    let connection = open_runtime_connection(path)?;
    require_direct_session(&connection, session_id)?;
    let baseline_tokens = checked_integer(baseline.billable_tokens, "run token baseline")?;
    let started_at = checked_integer(baseline.started_at_epoch_ms, "run start time")?;
    let continuation = baseline.continuation.then_some(baseline.run_id.as_str());
    let changed = connection.execute(
        "UPDATE session_goals
         SET accounting_run_id = ?1, accounting_token_baseline = ?2,
             accounting_started_at_epoch_ms = ?3, continuation_run_id = ?4,
             updated_at = ?5, version = version + 1
         WHERE session_id = ?6 AND status = 'active'
           AND accounting_run_id IS NULL",
        params![
            baseline.run_id,
            baseline_tokens,
            started_at,
            continuation,
            now_utc(),
            session_id
        ],
    )?;
    if changed == 0 {
        return Ok(None);
    }
    load_with_connection(&connection, session_id)
}

pub fn settle_session_goal_run(
    path: &Path,
    session_id: &str,
    run_id: &str,
    final_billable_tokens: u64,
    terminal_at_epoch_ms: u64,
    disposition: GoalRunDisposition,
) -> Result<Option<SessionGoalRecord>> {
    let mut connection = open_runtime_connection(path)?;
    let transaction =
        connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let goal = settle_session_goal_run_with_connection(
        &transaction,
        session_id,
        run_id,
        final_billable_tokens,
        terminal_at_epoch_ms,
        disposition,
    )?;
    transaction.commit()?;
    Ok(goal)
}

pub(crate) fn settle_session_goal_run_with_connection(
    connection: &Connection,
    session_id: &str,
    run_id: &str,
    final_billable_tokens: u64,
    terminal_at_epoch_ms: u64,
    disposition: GoalRunDisposition,
) -> Result<Option<SessionGoalRecord>> {
    require_direct_session(connection, session_id)?;
    let Some(current) = load_with_connection(connection, session_id)? else {
        return Ok(None);
    };
    if current.accounting_run_id.as_deref() != Some(run_id) {
        return Ok(Some(current));
    }
    let baseline = current.accounting_token_baseline.unwrap_or(0);
    let delta_tokens = final_billable_tokens.saturating_sub(baseline);
    let delta_ms = terminal_at_epoch_ms.saturating_sub(
        current
            .accounting_started_at_epoch_ms
            .unwrap_or(terminal_at_epoch_ms),
    );
    let tokens_used = current.tokens_used.saturating_add(delta_tokens);
    let time_used_ms = current.time_used_ms.saturating_add(delta_ms);
    let mut status = match disposition {
        GoalRunDisposition::Failed if current.status.is_unfinished() => GoalStatus::Blocked,
        GoalRunDisposition::Cancelled if current.status.is_unfinished() => GoalStatus::Paused,
        GoalRunDisposition::Completed
        | GoalRunDisposition::Failed
        | GoalRunDisposition::Cancelled => current.status,
    };
    if status != GoalStatus::Complete
        && current
            .token_budget
            .is_some_and(|budget| tokens_used >= budget)
    {
        status = GoalStatus::BudgetLimited;
    }
    connection.execute(
        "UPDATE session_goals
         SET status = ?1, tokens_used = ?2, time_used_ms = ?3,
             accounting_run_id = NULL, accounting_token_baseline = NULL,
             accounting_started_at_epoch_ms = NULL, continuation_run_id = NULL,
             updated_at = ?4, version = version + 1
         WHERE session_id = ?5 AND goal_id = ?6 AND accounting_run_id = ?7",
        params![
            status.as_str(),
            checked_integer(tokens_used, "token usage")?,
            checked_integer(time_used_ms, "time usage")?,
            now_utc(),
            session_id,
            current.goal_id,
            run_id
        ],
    )?;
    load_with_connection(connection, session_id)
}

/// Recover only the terminal disposition when a crash happened after the
/// transcript's canonical terminal marker but before ordinary goal
/// settlement. Usage deltas are intentionally left unchanged because the
/// process-local final usage sample is unavailable after restart.
pub(crate) fn reconcile_session_goal_terminal_with_connection(
    connection: &Connection,
    session_id: &str,
    run_id: &str,
    disposition: GoalRunDisposition,
) -> Result<()> {
    let Some(current) = load_with_connection(connection, session_id)? else {
        return Ok(());
    };
    if current.accounting_run_id.as_deref() != Some(run_id) {
        return Ok(());
    }
    let status = match disposition {
        GoalRunDisposition::Failed if current.status.is_unfinished() => GoalStatus::Blocked,
        GoalRunDisposition::Cancelled if current.status.is_unfinished() => GoalStatus::Paused,
        GoalRunDisposition::Completed
        | GoalRunDisposition::Failed
        | GoalRunDisposition::Cancelled => current.status,
    };
    connection.execute(
        "UPDATE session_goals
         SET status = ?1, accounting_run_id = NULL,
             accounting_token_baseline = NULL,
             accounting_started_at_epoch_ms = NULL,
             continuation_run_id = NULL, updated_at = ?2, version = version + 1
         WHERE session_id = ?3 AND goal_id = ?4 AND accounting_run_id = ?5",
        params![
            status.as_str(),
            now_utc(),
            session_id,
            current.goal_id,
            run_id
        ],
    )?;
    Ok(())
}

/// Clear a stale run claim after the caller has acquired the session operation
/// lease. No token delta can be reconstructed after a process loss; already
/// terminal-checkpointed totals remain authoritative and the active goal is
/// eligible for exactly one replacement continuation.
pub fn reconcile_session_goal_run(
    path: &Path,
    session_id: &str,
) -> Result<Option<SessionGoalRecord>> {
    let connection = open_runtime_connection(path)?;
    require_direct_session(&connection, session_id)?;
    connection.execute(
        "UPDATE session_goals
         SET accounting_run_id = NULL, accounting_token_baseline = NULL,
             accounting_started_at_epoch_ms = NULL, continuation_run_id = NULL,
             updated_at = ?1, version = version + 1
         WHERE session_id = ?2 AND accounting_run_id IS NOT NULL",
        params![now_utc(), session_id],
    )?;
    load_with_connection(&connection, session_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn direct_session(path: &Path, session_id: &str) {
        crate::store::insert_test_session(path, session_id);
        let connection = open_runtime_connection(path).unwrap();
        connection
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id = ?1",
                params![session_id],
            )
            .unwrap();
    }

    fn test_path(label: &str) -> PathBuf {
        std::env::temp_dir()
            .join(format!("nac-session-goal-{label}-{}", uuid::Uuid::new_v4()))
            .join("store.db")
    }

    #[test]
    fn goal_lifecycle_is_direct_only_versioned_and_generation_safe() {
        let path = test_path("lifecycle");
        initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "orchestrator");
        direct_session(&path, "direct");
        assert!(create_session_goal(&path, "orchestrator", "no", None, None).is_err());

        let first = create_session_goal(&path, "direct", " ship it ", None, None).unwrap();
        assert_eq!(first.objective, "ship it");
        assert_eq!(first.status, GoalStatus::Active);
        assert!(first.token_budget.is_none());
        assert!(create_session_goal(&path, "direct", "second", None, None).is_err());

        let paused = update_session_goal_by_user(
            &path,
            "direct",
            &first.goal_id,
            first.version,
            UserGoalUpdate {
                objective: Some("ship safely".into()),
                token_budget: Some(Some(500)),
                status: Some(GoalStatus::Paused),
            },
        )
        .unwrap();
        assert_eq!(paused.objective, "ship safely");
        assert_eq!(paused.token_budget, Some(500));
        assert_eq!(paused.status, GoalStatus::Paused);
        assert!(update_session_goal_by_user(
            &path,
            "direct",
            &paused.goal_id,
            first.version,
            UserGoalUpdate {
                status: Some(GoalStatus::Active),
                ..Default::default()
            }
        )
        .is_err());

        let complete =
            update_session_goal_by_model(&path, "direct", &paused.goal_id, GoalStatus::Complete)
                .unwrap();
        let replacement =
            create_session_goal(&path, "direct", "replacement", Some(100), None).unwrap();
        assert_ne!(replacement.goal_id, complete.goal_id);
        assert_eq!(replacement.tokens_used, 0);
    }

    #[test]
    fn model_status_authority_is_narrow_and_clear_is_optimistic() {
        let path = test_path("authority");
        initialize(&path).unwrap();
        direct_session(&path, "direct");
        let goal = create_session_goal(&path, "direct", "work", None, None).unwrap();
        assert!(
            update_session_goal_by_model(&path, "direct", &goal.goal_id, GoalStatus::Paused)
                .is_err()
        );
        let blocked =
            update_session_goal_by_model(&path, "direct", &goal.goal_id, GoalStatus::Blocked)
                .unwrap();
        assert!(clear_session_goal(&path, "direct", &goal.goal_id, goal.version).is_err());
        clear_session_goal(&path, "direct", &blocked.goal_id, blocked.version).unwrap();
        assert!(load_session_goal(&path, "direct").unwrap().is_none());
    }

    #[test]
    fn run_binding_accounts_only_after_mid_run_baseline_and_enforces_budget() {
        let path = test_path("accounting");
        initialize(&path).unwrap();
        direct_session(&path, "direct");
        let baseline = GoalRunBaseline {
            run_id: "run-1".into(),
            billable_tokens: 80,
            started_at_epoch_ms: 1_000,
            continuation: false,
        };
        let goal =
            create_session_goal(&path, "direct", "bounded", Some(50), Some(&baseline)).unwrap();
        assert_eq!(goal.accounting_token_baseline, Some(80));
        let settled = settle_session_goal_run(
            &path,
            "direct",
            "run-1",
            135,
            3_500,
            GoalRunDisposition::Completed,
        )
        .unwrap()
        .unwrap();
        assert_eq!(settled.tokens_used, 55);
        assert_eq!(settled.time_used_ms, 2_500);
        assert_eq!(settled.status, GoalStatus::BudgetLimited);
        assert!(settled.accounting_run_id.is_none());
    }

    #[test]
    fn continuation_claim_is_single_and_failure_cancel_and_restart_settle_safely() {
        let path = test_path("claims");
        initialize(&path).unwrap();
        direct_session(&path, "direct");
        create_session_goal(&path, "direct", "continue", None, None).unwrap();
        let first = GoalRunBaseline {
            run_id: "continuation-1".into(),
            billable_tokens: 0,
            started_at_epoch_ms: 10,
            continuation: true,
        };
        let claimed = bind_session_goal_run(&path, "direct", &first)
            .unwrap()
            .unwrap();
        assert_eq!(
            claimed.continuation_run_id.as_deref(),
            Some("continuation-1")
        );
        assert!(bind_session_goal_run(
            &path,
            "direct",
            &GoalRunBaseline {
                run_id: "duplicate".into(),
                ..first.clone()
            }
        )
        .unwrap()
        .is_none());
        let recovered = reconcile_session_goal_run(&path, "direct")
            .unwrap()
            .unwrap();
        assert_eq!(recovered.status, GoalStatus::Active);
        assert!(recovered.continuation_run_id.is_none());

        let second = GoalRunBaseline {
            run_id: "continuation-2".into(),
            started_at_epoch_ms: 100,
            ..first
        };
        bind_session_goal_run(&path, "direct", &second)
            .unwrap()
            .unwrap();
        let blocked = settle_session_goal_run(
            &path,
            "direct",
            "continuation-2",
            12,
            1_100,
            GoalRunDisposition::Failed,
        )
        .unwrap()
        .unwrap();
        assert_eq!(blocked.status, GoalStatus::Blocked);

        let resumed = update_session_goal_by_user(
            &path,
            "direct",
            &blocked.goal_id,
            blocked.version,
            UserGoalUpdate {
                status: Some(GoalStatus::Active),
                ..Default::default()
            },
        )
        .unwrap();
        let cancel_run = GoalRunBaseline {
            run_id: "user-run".into(),
            billable_tokens: 0,
            started_at_epoch_ms: 2_000,
            continuation: false,
        };
        bind_session_goal_run(&path, "direct", &cancel_run)
            .unwrap()
            .unwrap();
        let paused = settle_session_goal_run(
            &path,
            "direct",
            "user-run",
            5,
            2_500,
            GoalRunDisposition::Cancelled,
        )
        .unwrap()
        .unwrap();
        assert_eq!(paused.goal_id, resumed.goal_id);
        assert_eq!(paused.status, GoalStatus::Paused);
    }
}
