//! Read-only recent activity joins canonical command facts to optional
//! process-local observation. Missing enrichment never rewrites an outcome.
use super::*;

pub const RECENT_EXECUTION_LIMIT: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum ExecutionOutputAvailability {
    Retained,
    TailGap,
    Expired,
    ProcessLocalUnavailable,
    NotRecorded,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ExecutionHistoryOutput {
    pub availability: ExecutionOutputAvailability,
    /// Decimal byte cursors have the same exact wire contract as observation.
    pub retained_start: Option<String>,
    pub retained_end: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ExecutionHistoryEntry {
    /// Canonical session-scoped human command request identity, or the existing local
    /// execution identity. This is a view key, never an execution capability.
    pub id: String,
    pub execution: Option<ExecutionStatus>,
    /// Canonical durable result/preview; private output artifact ids are omitted.
    pub command: Option<ShellCommandSnapshot>,
    pub output: ExecutionHistoryOutput,
    pub started_at_epoch_ms: String,
    /// Pipe process result, independent of collector completion/error. PTY
    /// exit codes remain in the existing execution status; absent is unknown.
    pub outcome: Option<crate::terminal::CommandStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct ExecutionHistory {
    pub entries: Vec<ExecutionHistoryEntry>,
    pub limit: usize,
    pub older_entries_omitted: bool,
}

/// Also usable by delivery when no process-local service is cached. Reads the
/// committed journal directly, without attaching or entering recovery.
pub async fn recent_command_history(path: PathBuf, session_id: String) -> Result<ExecutionHistory> {
    let commands = crate::store::spawn_blocking_store_caller(move || {
        crate::store::recent_shell_commands(&path, &session_id, RECENT_EXECUTION_LIMIT + 1)
    })
    .await??;
    Ok(merge_history(Vec::new(), commands))
}

fn merge_history(
    mut entries: Vec<ExecutionHistoryEntry>,
    commands: Vec<ShellCommandSnapshot>,
) -> ExecutionHistory {
    for mut command in commands {
        let produced_output = command.output_id.take().is_some();
        if let Some(entry) = entries.iter_mut().find(|entry| {
            entry.execution.as_ref().is_some_and(|execution| {
                execution.origin == ExecutionOrigin::HumanCommand
                    && execution.request_id.as_deref() == Some(command.request_id.as_str())
            })
        }) {
            entry.id = format!("command-{}", command.request_id);
            entry.started_at_epoch_ms = command.accepted_at_epoch_ms.to_string();
            entry.command = Some(command);
        } else {
            entries.push(ExecutionHistoryEntry {
                id: format!("command-{}", command.request_id),
                started_at_epoch_ms: command.accepted_at_epoch_ms.to_string(),
                execution: None,
                command: Some(command),
                outcome: None,
                output: ExecutionHistoryOutput {
                    availability: if produced_output {
                        ExecutionOutputAvailability::ProcessLocalUnavailable
                    } else {
                        ExecutionOutputAvailability::NotRecorded
                    },
                    retained_start: None,
                    retained_end: None,
                },
            });
        }
    }
    entries.sort_by(|left, right| {
        let timestamp =
            |entry: &ExecutionHistoryEntry| entry.started_at_epoch_ms.parse::<u64>().unwrap_or(0);
        timestamp(right).cmp(&timestamp(left))
    });
    let older_entries_omitted = entries.len() > RECENT_EXECUTION_LIMIT;
    entries.truncate(RECENT_EXECUTION_LIMIT);
    ExecutionHistory {
        entries,
        limit: RECENT_EXECUTION_LIMIT,
        older_entries_omitted,
    }
}

impl SessionService {
    pub async fn execution_history(&self) -> Result<ExecutionHistory> {
        let _host_admission = self.user_terminal_host_admission(true).await?;
        self.require_direct_primary_behavior_async().await?;
        let path = self.metadata.store_path.clone();
        let session_id = self
            .metadata
            .session_id
            .clone()
            .ok_or_else(|| anyhow::anyhow!("missing session identity"))?;
        let commands = crate::store::spawn_blocking_store_caller(move || {
            crate::store::recent_shell_commands(&path, &session_id, RECENT_EXECUTION_LIMIT + 1)
        })
        .await??;
        let mut entries = Vec::new();
        for (execution, started_at, outcome) in
            self.terminal_manager.recent_execution_catalog().await
        {
            let output = match self
                .terminal_manager
                .read_execution_output(&execution.id, 0, 1)
                .await
            {
                Ok(page) => ExecutionHistoryOutput {
                    availability: if page.retained_start > 0 {
                        ExecutionOutputAvailability::TailGap
                    } else {
                        ExecutionOutputAvailability::Retained
                    },
                    retained_start: Some(page.retained_start.to_string()),
                    retained_end: Some(page.retained_end.to_string()),
                },
                Err(_) => ExecutionHistoryOutput {
                    availability: ExecutionOutputAvailability::Expired,
                    retained_start: None,
                    retained_end: None,
                },
            };
            entries.push(ExecutionHistoryEntry {
                id: execution
                    .request_id
                    .as_ref()
                    .filter(|_| execution.origin == ExecutionOrigin::HumanCommand)
                    .map(|request| format!("command-{request}"))
                    .unwrap_or_else(|| execution.id.clone()),
                execution: Some(execution),
                command: None,
                output,
                started_at_epoch_ms: started_at.to_string(),
                outcome,
            });
        }
        Ok(merge_history(entries, commands))
    }
}
