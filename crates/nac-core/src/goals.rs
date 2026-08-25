use std::path::PathBuf;
use std::sync::Mutex;

use anyhow::{anyhow, Result};

use crate::model::TokenUsage;
use crate::store::{GoalRunBaseline, GoalStatus, SessionGoalRecord};

#[derive(Debug, Clone)]
struct CurrentRun {
    run_id: String,
    billable_tokens: u64,
}

/// Process-local view of the currently executing direct run. Durable goal
/// truth stays in SQLite; this small bridge exists so a model-created goal can
/// capture an exact mid-run accounting baseline without coupling tools to the
/// agent loop.
pub(crate) struct GoalRuntime {
    store_path: PathBuf,
    session_id: String,
    current_run: Mutex<Option<CurrentRun>>,
}

impl GoalRuntime {
    pub(crate) fn new(store_path: PathBuf, session_id: String) -> Self {
        Self {
            store_path,
            session_id,
            current_run: Mutex::new(None),
        }
    }

    pub(crate) fn begin_run(&self, run_id: &str) {
        *self
            .current_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(CurrentRun {
            run_id: run_id.to_string(),
            billable_tokens: 0,
        });
    }

    pub(crate) fn update_usage(&self, usage: &TokenUsage) {
        if let Some(run) = self
            .current_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_mut()
        {
            run.billable_tokens = usage.billable_tokens();
        }
    }

    pub(crate) fn end_run(&self, run_id: &str) {
        let mut current = self
            .current_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if current.as_ref().is_some_and(|run| run.run_id == run_id) {
            *current = None;
        }
    }

    fn current_baseline(&self) -> Option<GoalRunBaseline> {
        self.current_run
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .map(|run| GoalRunBaseline {
                run_id: run.run_id.clone(),
                billable_tokens: run.billable_tokens,
                started_at_epoch_ms: epoch_ms(),
                continuation: false,
            })
    }

    pub(crate) fn create(
        &self,
        objective: &str,
        token_budget: Option<u64>,
    ) -> Result<SessionGoalRecord> {
        crate::store::create_session_goal(
            &self.store_path,
            &self.session_id,
            objective,
            token_budget,
            self.current_baseline().as_ref(),
        )
    }

    pub(crate) fn get(&self) -> Result<Option<SessionGoalRecord>> {
        crate::store::load_session_goal(&self.store_path, &self.session_id)
    }

    pub(crate) fn update_model(
        &self,
        goal_id: &str,
        status: GoalStatus,
    ) -> Result<SessionGoalRecord> {
        if self
            .current_run
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .is_none()
        {
            return Err(anyhow!("goal model updates require an active direct run"));
        }
        crate::store::update_session_goal_by_model(
            &self.store_path,
            &self.session_id,
            goal_id,
            status,
        )
    }
}

fn epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
