//! Bounded passive metadata reads and the existing lossy goal/question wakeup.
//! No session attachment, operation lease, recovery or transcript projection.
use super::*;
use crate::events::{AttentionDecision, AttentionGoal};
use tokio::sync::broadcast;

pub const ATTENTION_SOURCE_LIMIT: usize = 1024;
pub const ATTENTION_METADATA_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionStoredGoal {
    pub identity: AttentionGoal,
    pub status: GoalStatus,
    pub accounting_run: Option<String>,
    pub continuation_run: Option<String>,
    pub retry_scheduled: bool,
    pub last_run: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionStoredRun {
    pub run_id: String,
    pub disposition: RunOutcomeDisposition,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttentionStoredSession {
    pub id: String,
    pub primary: bool,
    pub direct: bool,
    pub questions_supported: bool,
    pub goal: Option<AttentionStoredGoal>,
    pub question: Option<AttentionDecision>,
    pub inbox_pending: bool,
    pub manual_unsettled: bool,
    pub config_version: i64,
    pub last_outcome: Option<AttentionStoredRun>,
    pub recovery_pending: bool,
}

impl AttentionStoredSession {
    /// A retained completed goal is historical only for a different exact run.
    /// Unfinished, unattributed or continuing goals remain current obligations.
    pub fn goal_is_historical_for(&self, run_id: &str) -> bool {
        self.goal.as_ref().is_some_and(|goal| {
            goal.status == GoalStatus::Complete
                && goal.accounting_run.is_none()
                && goal.continuation_run.is_none()
                && !goal.retry_scheduled
                && goal.last_run.as_deref().is_some_and(|last| last != run_id)
        })
    }

    /// This is necessary durable evidence, never a settlement/idle receipt by itself.
    pub fn verifies_goal_free_idle(&self, run_id: &str, config_version: Option<i64>) -> bool {
        self.primary
            && self.direct
            && self.questions_supported
            && config_version == Some(self.config_version)
            && (self.goal.is_none() || self.goal_is_historical_for(run_id))
            && self.question.is_none()
            && !self.inbox_pending
            && !self.manual_unsettled
            && !self.recovery_pending
            && self.last_outcome.as_ref().is_some_and(|outcome| {
                outcome.run_id == run_id && outcome.disposition == RunOutcomeDisposition::Completed
            })
    }

    pub fn metadata_bytes(&self) -> usize {
        self.id.len()
            + 64
            + self
                .last_outcome
                .as_ref()
                .map_or(0, |run| run.run_id.len() + 16)
            + self.goal.as_ref().map_or(0, |goal| {
                goal.identity.id.len()
                    + 32
                    + [&goal.accounting_run, &goal.continuation_run, &goal.last_run]
                        .into_iter()
                        .flatten()
                        .map(String::len)
                        .sum::<usize>()
            })
            + self.question.as_ref().map_or(0, |question| match question {
                AttentionDecision::Question {
                    request_id,
                    run_id,
                    generation,
                    ..
                } => request_id.len() + run_id.len() + generation.len() + 16,
                _ => 0,
            })
    }
}

/// The receiver is the existing supplier bus, not a second notification source.
pub struct AttentionStoreObservation {
    path: PathBuf,
    receiver: broadcast::Receiver<goal_changes::TaskChange>,
}

impl AttentionStoreObservation {
    pub fn subscribe(path: &Path) -> Self {
        Self {
            path: path.to_owned(),
            receiver: goal_changes::subscribe(path),
        }
    }

    pub fn try_changed(&mut self) -> Result<Option<String>> {
        loop {
            let change = match self.receiver.try_recv() {
                Ok(change) => change,
                Err(broadcast::error::TryRecvError::Empty) => return Ok(None),
                Err(_) => return Err(anyhow!("attention hints require rebaseline")),
            };
            if let Some(session) = self.matching(change) {
                return Ok(Some(session));
            }
        }
    }

    fn matching(&self, change: goal_changes::TaskChange) -> Option<String> {
        let (path, session) = match change {
            goal_changes::TaskChange::Goal(goal) => (goal.store_path, goal.session_id),
            goal_changes::TaskChange::Question {
                store_path,
                session_id,
                ..
            }
            | goal_changes::TaskChange::SessionDirty {
                store_path,
                session_id,
            } => (store_path, session_id),
        };
        (path == self.path).then_some(session)
    }

    pub async fn changed(&mut self) -> Result<String> {
        loop {
            let change = self
                .receiver
                .recv()
                .await
                .map_err(|_| anyhow!("attention hints require rebaseline"))?;
            if let Some(session) = self.matching(change) {
                return Ok(session);
            }
        }
    }
}

fn identifier(value: &str) -> Result<()> {
    anyhow::ensure!(
        !value.trim().is_empty() && value.len() <= 512,
        "attention metadata identity unavailable"
    );
    Ok(())
}

type GoalMetadataRow = (
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<String>,
);

fn goal(connection: &Connection, id: &str) -> Result<Option<AttentionStoredGoal>> {
    let row: Option<GoalMetadataRow> = connection.query_row(
        "SELECT substr(goal_id,1,513),status,version,substr(accounting_run_id,1,513),substr(continuation_run_id,1,513),next_attempt_at_epoch_ms,substr(last_run_id,1,513) FROM session_goals WHERE session_id=?1",
        [id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
    ).optional()?;
    row.map(
        |(id, status, version, accounting_run, continuation_run, retry, last_run)| {
            for id in std::iter::once(&id).chain(
                [&accounting_run, &continuation_run, &last_run]
                    .into_iter()
                    .flatten(),
            ) {
                identifier(id)?;
            }
            Ok(AttentionStoredGoal {
                identity: AttentionGoal {
                    id,
                    version: u64::try_from(version)?,
                },
                status: status.parse()?,
                accounting_run,
                continuation_run,
                retry_scheduled: retry.is_some(),
                last_run,
            })
        },
    )
    .transpose()
}

coordinated_command! {
/// One metadata census, or one identified dirty session. The extra row detects
/// overflow; this never truncates a larger store into a healthy empty baseline.
pub fn read_attention_metadata(path: &Path, session: Option<&str>) -> Result<Vec<AttentionStoredSession>> {
    let mut connection = open_initialized_read_connection(path)?;
    let tx = connection.transaction()?;
    let mut statement = tx.prepare("SELECT substr(s.session_id,1,513),s.behavior,
        NOT EXISTS(SELECT 1 FROM traditional_children c WHERE c.child_session_id=s.session_id)
        AND NOT EXISTS(SELECT 1 FROM managed_orchestrators m WHERE m.orchestrator_session_id=s.session_id),
        s.host_id IS NULL AND s.sandbox_json IS NULL, s.config_version
        FROM sessions s WHERE (?1 IS NULL OR s.session_id=?1) ORDER BY s.session_id LIMIT 1025")?;
    let rows = statement.query_map([session], |row| Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,bool>(2)?,row.get::<_,bool>(3)?,row.get::<_,i64>(4)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    anyhow::ensure!(rows.len() <= ATTENTION_SOURCE_LIMIT, "attention metadata capacity exceeded");
    let mut output = Vec::with_capacity(rows.len());
    let mut bytes = 0usize;
    for (id, behavior, primary, local, config_version) in rows {
        identifier(&id)?;
        anyhow::ensure!(config_version >= 0, "attention configuration revision unavailable");
        let direct = behavior == "direct" || behavior == "direct-with-orchestrator";
        let goal = if primary && direct { goal(&tx,&id)? } else { None };
        let questions_supported = primary && local && behavior == "direct";
        let question = if questions_supported {
            let question = task_questions::pending_attention_with_connection(&tx,&id)?;
            if let Some(AttentionDecision::Question {request_id,run_id,generation,..}) = &question {
                for id in [request_id,run_id,generation] { identifier(id)?; }
            }
            question
        } else { None };
        let inbox_pending = tx.query_row("SELECT EXISTS(SELECT 1 FROM session_inbox WHERE session_id=?1 AND status='pending')",[&id],|row|row.get(0))?;
        let manual_unsettled = tx.query_row("SELECT EXISTS(SELECT 1 FROM human_shell_operations WHERE session_id=?1 AND phase!='finished')",[&id],|row|row.get(0))?;
        let outcome: Option<(String,String)> = tx.query_row(
            "SELECT substr(run_id,1,513),disposition FROM session_run_outcomes WHERE session_id=?1 ORDER BY id DESC LIMIT 1",
            [&id], |row| Ok((row.get(0)?,row.get(1)?)),
        ).optional()?;
        let last_outcome = outcome.map(|(run_id, disposition)| -> Result<_> {
            identifier(&run_id)?;
            Ok(AttentionStoredRun { run_id, disposition: disposition.parse()? })
        }).transpose()?;
        let recovery_pending = tx.query_row("SELECT EXISTS(SELECT 1 FROM session_run_recovery WHERE session_id=?1)",[&id],|row|row.get(0))?;
        let metadata = AttentionStoredSession { id,primary,direct,questions_supported,goal,question,inbox_pending,manual_unsettled,config_version,last_outcome,recovery_pending };
        bytes = bytes.saturating_add(metadata.metadata_bytes());
        anyhow::ensure!(bytes <= ATTENTION_METADATA_BYTES, "attention metadata capacity exceeded");
        output.push(metadata);
    }
    Ok(output)
}
command ReadAttentionMetadata { session:Option<String> = session.map(str::to_owned) }
call |command| (command.session.as_deref())
correlation |command| crate::telemetry::Correlation::session(command.session.as_deref());
port public;
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;
