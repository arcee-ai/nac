//! Actual private-import task ownership, separate from Root settlement policy.
use super::*;

/// Observations only; a binding cannot construct a task or terminal evidence.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InitialImportWorkBinding {
    pub enrollment: EnrollmentAttempt,
    pub consumed_proof: InitialImportProofRecord,
    pub original_deadline: Instant,
}

/// Actual process-local admission knowledge, never inferred from missing rows.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialImportStartObservation {
    NotAttempted,
    Claimed,
    Unknown,
}

/// Local method outcome after joining the actual task. This is not an
/// authenticated Root retirement receipt or a qualified custody handoff.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InitialImportIoOutcome {
    SettledNoStart,
    SettledAfterStart { succeeded: bool },
    Unknown,
}

/// Private-constructor, nonclone/nonserializable local evidence. Unknown start
/// acknowledgment or task failure never becomes a no-effect observation.
/// Upstream retirement also needs genuine authentication, denial of the old
/// owner and its other work, plus the separately decided policy and protocol.
///
/// ```compile_fail
/// use nac_core::runtime::InitialImportIoTerminal;
/// fn requires_clone<T: Clone>() {}
/// requires_clone::<InitialImportIoTerminal>();
/// ```
/// ```compile_fail
/// use nac_core::runtime::InitialImportIoTerminal;
/// let _: InitialImportIoTerminal = serde_json::from_str("{}").unwrap();
/// ```
pub struct InitialImportIoTerminal {
    binding: InitialImportWorkBinding,
    start: InitialImportStartObservation,
    succeeded: bool,
}
impl InitialImportIoTerminal {
    pub fn binding(&self) -> &InitialImportWorkBinding {
        &self.binding
    }
    pub fn start_observation(&self) -> InitialImportStartObservation {
        self.start
    }
    pub fn outcome(&self) -> InitialImportIoOutcome {
        match (self.start, self.succeeded) {
            (InitialImportStartObservation::NotAttempted, false) => {
                InitialImportIoOutcome::SettledNoStart
            }
            (InitialImportStartObservation::Claimed, succeeded) => {
                InitialImportIoOutcome::SettledAfterStart { succeeded }
            }
            _ => InitialImportIoOutcome::Unknown,
        }
    }
}

struct WorkerOutput {
    attempt: InitialImportAttempt,
    operation: Result<()>,
}

pub struct InitialImportWorkResult {
    attempt: Option<InitialImportAttempt>,
    terminal: InitialImportIoTerminal,
    operation: Result<()>,
}
impl InitialImportWorkResult {
    pub fn terminal(&self) -> &InitialImportIoTerminal {
        &self.terminal
    }
    pub fn operation_result(&self) -> &Result<()> {
        &self.operation
    }
    pub fn into_parts(
        self,
    ) -> (
        Option<InitialImportAttempt>,
        InitialImportIoTerminal,
        Result<()>,
    ) {
        (self.attempt, self.terminal, self.operation)
    }
}

/// Retain this owner in the Native supervisor while a caller borrows wait().
/// Cancelling that wait denies positive authority; joining has no renewed
/// positive budget and must still observe the original task's actual return.
/// Dropping this owner denies but detaches unfinished work; it NEVER emits a
/// terminal object or retires Root slots. Such loss remains unknown/recovery.
pub struct InitialImportWork {
    task: Option<store::BlockingStoreCaller<WorkerOutput>>,
    cancellation: InitialImportCancellation,
    binding: InitialImportWorkBinding,
    joined: bool,
}
impl InitialImportAttempt {
    /// Queue only this admitted attempt's fixed private importer; no arbitrary
    /// closure, command, data receipt or recovered row can supply this work.
    pub fn into_import_work(mut self) -> Result<InitialImportWork> {
        ensure!(
            self.next_sequence == 2 && !self.denied.load(Ordering::Acquire),
            "initial import work unavailable"
        );
        ensure!(
            tokio::runtime::Handle::try_current().is_ok(),
            "initial import work needs its owning runtime"
        );
        let cancellation = self.cancellation()?;
        let binding = InitialImportWorkBinding {
            enrollment: self.original.enrollment.clone(),
            consumed_proof: self
                .consumed_proof
                .clone()
                .ok_or_else(|| anyhow::anyhow!("initial import consumed resource unavailable"))?,
            original_deadline: self.deadline.snapshot()?,
        };
        let task = store::spawn_blocking_store_caller(move || {
            let operation = self.import_once();
            WorkerOutput {
                attempt: self,
                operation,
            }
        });
        Ok(InitialImportWork {
            task: Some(task),
            cancellation,
            binding,
            joined: false,
        })
    }
}
impl InitialImportWork {
    pub fn binding(&self) -> &InitialImportWorkBinding {
        &self.binding
    }
    pub fn cancel(&self) {
        self.cancellation.cancel();
    }
    /// Scheduling observation only, never settlement or authority.
    pub fn is_finished(&self) -> bool {
        self.joined
            || self
                .task
                .as_ref()
                .is_some_and(store::BlockingStoreCaller::is_finished)
    }

    pub async fn wait(&mut self) -> Result<InitialImportWorkResult> {
        let guard = InitialImportCancelGuard {
            cancellation: self.cancellation.clone(),
            armed: true,
        };
        let task = self
            .task
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("initial import work already joined"))?;
        let result = task.await;
        self.task.take();
        self.joined = true;
        let output = match result {
            Ok(output) => {
                let terminal = InitialImportIoTerminal {
                    binding: self.binding.clone(),
                    start: output.attempt.start_observation,
                    succeeded: output.operation.is_ok(),
                };
                InitialImportWorkResult {
                    attempt: Some(output.attempt),
                    terminal,
                    operation: output.operation,
                }
            }
            Err(error)
                if error.downcast_ref::<store::PersistenceAdmissionError>()
                    == Some(&store::PersistenceAdmissionError::CallerOverloaded) =>
            {
                self.cancel();
                InitialImportWorkResult {
                    attempt: None,
                    terminal: InitialImportIoTerminal {
                        binding: self.binding.clone(),
                        start: InitialImportStartObservation::NotAttempted,
                        succeeded: false,
                    },
                    operation: Err(error),
                }
            }
            Err(error) => {
                self.cancel();
                return Err(error);
            }
        };
        guard.disarm();
        Ok(output)
    }
}
impl Drop for InitialImportWork {
    fn drop(&mut self) {
        if !self.joined {
            self.cancel();
        }
    }
}
