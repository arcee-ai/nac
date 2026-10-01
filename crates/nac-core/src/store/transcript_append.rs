//! Transactional transcript append identities, authority, and commit receipts.
//! The log payload stays byte compatible; receipts are an independent replay
//! ledger, invalidated by the canonical tail row's foreign key on rewind.
use super::*;
use crate::sessions::SessionOperationLease;
use crate::types::Message;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Weak};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TranscriptAppendError {
    StaleOwner,
    StaleRun,
    IdentityConflict,
    PositionConflict { expected: u64, found: u64 },
    CommitUncertain,
}
impl std::fmt::Display for TranscriptAppendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StaleOwner => f.write_str("transcript append owner is no longer active"),
            Self::StaleRun => f.write_str("transcript append run or generation is no longer active"),
            Self::IdentityConflict => f.write_str("transcript append identity was reused with different input"),
            Self::PositionConflict { expected, found } => write!(f, "transcript log append is not contiguous: expected start idx {expected}, found {found}"),
            Self::CommitUncertain => f.write_str("transcript append commit outcome is uncertain; retry the same identity"),
        }
    }
}
impl std::error::Error for TranscriptAppendError {}

impl TranscriptAppendError {
    pub(crate) fn run_failure(&self) -> crate::run_failure::RunFailure {
        use crate::run_failure::{RunFailure, RunFailureKind};
        let mut failure = RunFailure::unknown(self.to_string());
        failure.kind = match self {
            Self::StaleOwner | Self::StaleRun => RunFailureKind::Interrupted,
            Self::CommitUncertain => RunFailureKind::Transport,
            Self::IdentityConflict | Self::PositionConflict { .. } => RunFailureKind::Protocol,
        };
        failure.transient = matches!(self, Self::CommitUncertain);
        failure
    }
}

/// A committed range. A replay returns this same result without repeating any
/// summary, inbox, steering, or recovery effects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TranscriptAppendReceipt {
    pub start_idx: u64,
    pub end_idx: u64,
    pub last_message_id: i64,
}

#[derive(Clone, Copy)]
pub(super) enum AppendPurpose<'a> {
    Messages,
    RunPrompt(&'a str),
    RunMessages(&'a str),
    Terminal,
}

impl<'a> AppendPurpose<'a> {
    fn requested_run(self) -> Option<&'a str> {
        match self {
            Self::RunPrompt(run_id) | Self::RunMessages(run_id) => Some(run_id),
            Self::Messages | Self::Terminal => None,
        }
    }
}

#[derive(Clone)]
pub(super) struct RunAppendFence {
    pub session_id: String,
    pub run_id: String,
    lease: Weak<SessionOperationLease>,
    generation: Option<(String, u64)>,
}

struct RelationshipGeneration {
    kind: String,
    generation: u64,
    run_id: Option<String>,
    status: String,
}

fn relationship_generation(
    conn: &Connection,
    session_id: &str,
) -> Result<Option<RelationshipGeneration>> {
    conn.query_row(
        "SELECT 'managed', generation, run_id, status FROM managed_orchestrators WHERE orchestrator_session_id = ?1
         UNION ALL SELECT 'child', generation, run_id, status FROM traditional_children WHERE child_session_id = ?1",
        params![session_id],
        |r| Ok(RelationshipGeneration { kind: r.get(0)?, generation: r.get(1)?, run_id: r.get(2)?, status: r.get(3)? }),
    ).optional().map_err(Into::into)
}

impl TranscriptLogWriter {
    #[cfg(test)]
    pub(crate) fn lose_next_append_ack_for_test(&self) {
        self.lose_append_acks_for_test(1);
    }
    #[cfg(test)]
    pub(crate) fn lose_append_acks_for_test(&self, count: usize) {
        assert!(count > 0);
        *self.append_fault.lock().unwrap() = Some((AppendFault::AfterCommitBeforeAck, count));
    }
    /// Bind a writer to the exact admitted run. Weak ownership prevents the
    /// cached agent from keeping a settled run's OS lease alive. A transaction
    /// upgrades it and retains authority through commit, including async abort.
    pub(crate) fn for_run(
        path: &Path,
        session_id: &str,
        run_id: &str,
        lease: &Arc<SessionOperationLease>,
    ) -> Result<Self> {
        if let Some(owner) = super::coordinator::owner_for(path)? {
            owner.check_blocking_context()?;
            return owner
                .submit(BindRunWriter {
                    session_id: session_id.to_owned(),
                    run_id: run_id.to_owned(),
                    lease: Arc::clone(lease),
                })?
                .acknowledge_blocking()?;
        }
        lease.validate(path, session_id)?;
        let connection = open_runtime_connection(path)?;
        let relationship = relationship_generation(&connection, session_id)?;
        if relationship.as_ref().is_some_and(|relationship| {
            relationship.run_id.as_deref() != Some(run_id) || relationship.status != "running"
        }) {
            return Err(TranscriptAppendError::StaleRun.into());
        }
        let mut writer = Self::new(path)?;
        writer.append_scope = run_id.to_string();
        writer.append_fence = Some(RunAppendFence {
            session_id: session_id.into(),
            run_id: run_id.into(),
            lease: Arc::downgrade(lease),
            generation: relationship
                .map(|relationship| (relationship.kind, relationship.generation)),
        });
        Ok(writer)
    }

    pub(super) fn append_lease(&self, session_id: &str) -> Result<Arc<SessionOperationLease>> {
        match &self.append_fence {
            Some(fence) => {
                if fence.session_id != session_id {
                    return Err(TranscriptAppendError::StaleOwner.into());
                }
                let lease = fence
                    .lease
                    .upgrade()
                    .ok_or(TranscriptAppendError::StaleOwner)?;
                lease.validate(&self.store_path, session_id)?;
                Ok(lease)
            }
            None => Ok(Arc::new(SessionOperationLease::try_acquire(
                &self.store_path,
                session_id,
            )?)),
        }
    }

    pub(super) fn validate_append_run(
        &self,
        transaction: &Transaction<'_>,
        session_id: &str,
        purpose: AppendPurpose<'_>,
    ) -> Result<()> {
        let requested_run = purpose.requested_run();
        let Some(fence) = &self.append_fence else {
            return Ok(());
        };
        if requested_run.is_some_and(|run| run != fence.run_id) {
            return Err(TranscriptAppendError::StaleRun.into());
        }
        let current = relationship_generation(transaction, session_id)?;
        let matches = match (&fence.generation, &current) {
            (None, None) => true,
            (Some((kind, generation)), Some(current)) => {
                kind == &current.kind
                    && generation == &current.generation
                    && current.run_id.as_deref() == Some(fence.run_id.as_str())
                    && current.status == "running"
            }
            _ => false,
        };
        if !matches {
            return Err(TranscriptAppendError::StaleRun.into());
        }
        if let Some(recovery) = load_run_recovery_with_connection(transaction, session_id)? {
            let installing_successor = matches!(purpose, AppendPurpose::RunPrompt(_))
                && recovery.status != RunRecoveryStatus::Active;
            if !installing_successor
                && (recovery.run_id != fence.run_id
                    || recovery.status != RunRecoveryStatus::Active
                    || recovery.terminal_disposition.is_some())
            {
                return Err(TranscriptAppendError::StaleRun.into());
            }
        } else if !matches!(
            purpose,
            AppendPurpose::RunPrompt(_) | AppendPurpose::Terminal
        ) {
            return Err(TranscriptAppendError::StaleRun.into());
        }
        Ok(())
    }

    /// Explicit identity supports retry after a lost commit acknowledgement.
    /// `None` allocates the range; `Some` validates a provider-view boundary.
    pub fn append_idempotent(
        &self,
        session_id: &str,
        operation_id: &str,
        expected_start: Option<u64>,
        messages: &[Message],
    ) -> Result<TranscriptAppendReceipt> {
        coordinate_writer!(self, Result<TranscriptAppendReceipt>, {
            session_id: String = session_id.to_owned(),
            operation_id: String = operation_id.to_owned(),
            expected_start: Option<u64> = expected_start,
            messages: Vec<Message> = messages.to_vec(),
        }, call |command| command.writer.append_idempotent(&command.session_id, &command.operation_id, command.expected_start, &command.messages),
        correlation |command| crate::telemetry::Correlation::session(Some(&command.session_id)));

        self.commit_append(
            session_id,
            &format!("explicit:{operation_id}"),
            expected_start,
            messages,
            AppendPurpose::Messages,
            |_| Ok(()),
        )
    }

    pub(super) fn commit_append(
        &self,
        session_id: &str,
        operation_id: &str,
        expected_start: Option<u64>,
        messages: &[Message],
        purpose: AppendPurpose<'_>,
        effects: impl Fn(&Transaction<'_>) -> Result<()>,
    ) -> Result<TranscriptAppendReceipt> {
        if messages.is_empty() || operation_id.is_empty() {
            anyhow::bail!("an identified transcript append requires an identity and messages");
        }
        let payload = serde_json::to_vec(&(expected_start, messages))?;
        let digest = format!("{:x}", Sha256::digest(payload));
        self.commit_transaction(session_id, purpose, |transaction| {
                let prior = transaction.query_row(
                    "SELECT digest, start_idx, end_idx, last_message_id FROM transcript_append_receipts WHERE session_id = ?1 AND operation_id = ?2",
                    params![session_id, operation_id], |r| Ok((r.get::<_, String>(0)?, TranscriptAppendReceipt { start_idx: r.get(1)?, end_idx: r.get(2)?, last_message_id: r.get(3)? })),
                ).optional()?;
                if let Some((stored, receipt)) = prior {
                    if stored != digest {
                        return Err(TranscriptAppendError::IdentityConflict.into());
                    }
                    return Ok(receipt);
                }
                let start_idx = super::transcript::next_append_idx(transaction, session_id)?;
                if let Some(found) = expected_start {
                    if found != start_idx {
                        return Err(TranscriptAppendError::PositionConflict {
                            expected: start_idx,
                            found,
                        }
                        .into());
                    }
                }
                let last_message_id = super::transcript::append_messages_in_transaction(
                    transaction,
                    session_id,
                    start_idx,
                    messages,
                )?;
                self.append_fault(AppendFault::Statements)?;
                effects(transaction)?;
                let end_idx = start_idx
                    .checked_add(messages.len() as u64)
                    .context("transcript log index overflowed")?;
                transaction.execute(
                    "INSERT INTO transcript_append_receipts (session_id, operation_id, digest, run_id, generation, start_idx, end_idx, last_message_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![session_id, operation_id, digest, self.append_fence.as_ref().map(|f| &f.run_id), self.append_fence.as_ref().and_then(|f| f.generation.as_ref().map(|(_, g)| *g)), start_idx, end_idx, last_message_id],
                )?;
                let receipt = TranscriptAppendReceipt {
                    start_idx,
                    end_idx,
                    last_message_id,
                };
                Ok(receipt)
        })
    }

    pub(super) fn commit_transaction<T>(
        &self,
        session_id: &str,
        purpose: AppendPurpose<'_>,
        prepare: impl Fn(&Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        crate::telemetry::observe_store(
            crate::telemetry::StoreOperation::TranscriptAppend,
            crate::telemetry::Correlation::session(Some(session_id)).with_run(
                purpose
                    .requested_run()
                    .or(self.append_fence.as_ref().map(|f| f.run_id.as_str())),
            ),
            || self.commit_transaction_inner(session_id, purpose, prepare),
        )
    }

    fn commit_transaction_inner<T>(
        &self,
        session_id: &str,
        purpose: AppendPurpose<'_>,
        prepare: impl Fn(&Transaction<'_>) -> Result<T>,
    ) -> Result<T> {
        let _operation = self
            .operation
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let _lease = self.append_lease(session_id)?;
        self.append_fault(AppendFault::BeforeTransaction)?;
        let mut uncertain = None;
        for _ in 0..2 {
            let result = (|| -> Result<_> {
                let mut connection = open_runtime_connection(&self.store_path)?;
                let transaction = connection
                    .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
                self.validate_append_run(&transaction, session_id, purpose)?;
                let result = prepare(&transaction)?;
                self.append_fault(AppendFault::BeforeCommit)?;
                let commit_error = transaction.commit().err().map(anyhow::Error::new);
                if commit_error.is_none() {
                    self.append_fault(AppendFault::AfterCommitBeforeAck)?;
                }
                let commit_error =
                    commit_error.or_else(|| self.append_fault(AppendFault::UncertainCommit).err());
                Ok((result, commit_error))
            })();
            match result {
                Ok((result, None)) => return Ok(result),
                Ok((_, Some(error))) => uncertain = Some(error),
                Err(error) if uncertain.is_none() => return Err(error),
                Err(error) => return Err(error.context(TranscriptAppendError::CommitUncertain)),
            }
        }
        Err(uncertain
            .unwrap_or_else(|| anyhow!("transcript commit reconciliation exhausted"))
            .context(TranscriptAppendError::CommitUncertain))
    }

    pub(super) fn append_fault(&self, phase: AppendFault) -> Result<()> {
        #[cfg(test)]
        {
            let mut fault = self.append_fault.lock().unwrap();
            if let Some((requested, remaining)) = *fault {
                if requested != phase {
                    return Ok(());
                }
                *fault = (remaining > 1).then_some((phase, remaining - 1));
                return Err(
                    if matches!(
                        phase,
                        AppendFault::UncertainCommit | AppendFault::AfterCommitBeforeAck
                    ) {
                        TranscriptAppendError::CommitUncertain.into()
                    } else {
                        anyhow!("injected transcript append fault at {phase:?}")
                    },
                );
            }
        }
        let _ = phase;
        Ok(())
    }

    pub(super) fn append_identity(&self, start_idx: u64, effect: &str) -> String {
        format!("{}:{start_idx}:{effect}", self.append_scope)
    }

    pub(super) fn append_generation(&self) -> Option<u64> {
        self.append_fence
            .as_ref()
            .and_then(|fence| fence.generation.as_ref().map(|(_, generation)| *generation))
    }
}

struct BindRunWriter {
    session_id: String,
    run_id: String,
    lease: Arc<SessionOperationLease>,
}
impl super::coordinator::PersistenceCommand for BindRunWriter {
    type Output = Result<TranscriptLogWriter>;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some(&self.session_id)).with_run(Some(&self.run_id))
    }
    fn outcome(output: &Self::Output) -> crate::telemetry::TelemetryOutcome {
        if output.is_ok() {
            crate::telemetry::TelemetryOutcome::Ok
        } else {
            crate::telemetry::TelemetryOutcome::Error
        }
    }
    fn error_identity(output: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
        super::coordinator::CommandOutput::error_identity(output)
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        Ok(TranscriptLogWriter::for_run(
            path,
            &self.session_id,
            &self.run_id,
            &self.lease,
        ))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum AppendFault {
    BeforeTransaction,
    Statements,
    BeforeCommit,
    UncertainCommit,
    AfterCommitBeforeAck,
}

#[cfg(test)]
#[path = "transcript_append_tests.rs"]
mod tests;
