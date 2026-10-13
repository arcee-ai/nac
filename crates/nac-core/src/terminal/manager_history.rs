//! Recent metadata is a projection of existing execution owners. Observation
//! never refreshes processes, archives terminals, reconciles journals or pins
//! artifacts. Metadata expiry cannot settle a cleanup obligation.
use super::*;

impl TerminalManager {
    pub(crate) async fn recent_execution_catalog(
        &self,
    ) -> Vec<(ExecutionStatus, u64, Option<super::super::CommandStatus>)> {
        let statuses = self.execution_catalog_with_expired(true).await;
        let mut started = HashMap::new();
        {
            let completed = self.completed_sessions.lock().await;
            let sessions = self.sessions.lock().await;
            for (id, terminal) in completed.iter() {
                started.insert(id.clone(), (terminal.created_at, None));
            }
            let mut names = sessions.keys().collect::<Vec<_>>();
            names.sort();
            for id in names {
                started.insert(id.clone(), (sessions[id].created_at, None));
            }
        }
        {
            let pipes = self
                .pipe_executions
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            for pipe in pipes.iter() {
                let status = pipe
                    .status
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                let outcome = *pipe
                    .outcome
                    .lock()
                    .unwrap_or_else(std::sync::PoisonError::into_inner);
                started.insert(status.id.clone(), (pipe.created_at, outcome));
            }
        }
        let now = Instant::now();
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        let mut statuses = statuses;
        statuses.sort_by(|left, right| {
            started
                .get(&right.id)
                .map(|value| value.0)
                .cmp(&started.get(&left.id).map(|value| value.0))
        });
        let entries = statuses
            .into_iter()
            .filter_map(|status| {
                let (created, outcome) = started.get(&status.id)?;
                let age = now.saturating_duration_since(*created).as_millis() as u64;
                Some((status, epoch.saturating_sub(age), *outcome))
            })
            .collect::<Vec<_>>();
        entries
    }
}

#[cfg(test)]
#[path = "manager_history_tests.rs"]
mod tests;
