//! The serving application's bounded, single-threaded durable command executor.
//! Commands are concrete inward application operations, not SQL or plug-ins.
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Instant;

use anyhow::Result;
use tokio::sync::{mpsc, oneshot, watch};

use crate::sessions::StoreProcessLease;
use crate::telemetry::{self, Correlation, StoreOperation, TelemetryOutcome};

#[path = "coordinator_ownership.rs"]
mod ownership;
pub(crate) use ownership::{is_execution_store, owner_for, require_execution_owner};

const DEFAULT_QUEUE_CAPACITY: usize = 128;
const MAX_QUEUE_CAPACITY: usize = 1_024;

/// Internal sealed command contract. Store owners implement it with domain
/// arguments and an existing transaction; no application accepts arbitrary SQL.
pub(crate) trait PersistenceCommand: Send + 'static {
    type Output: Send + 'static;
    fn correlation(&self) -> Correlation;
    fn outcome(_: &Self::Output) -> TelemetryOutcome {
        TelemetryOutcome::Ok
    }
    fn error_identity(_: &Self::Output) -> Option<crate::telemetry::StoreErrorIdentity> {
        None
    }
    fn execute(self, store: &Path) -> Result<Self::Output>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersistenceAdmissionError {
    Overloaded,
    CallerOverloaded,
    ShuttingDown,
    ExecutorStopped,
    AsyncContext,
}

impl fmt::Display for PersistenceAdmissionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Overloaded => "persistence queue is full; retry after outstanding work settles",
            Self::CallerOverloaded => "persistence caller capacity is full; retry after outstanding work settles",
            Self::ShuttingDown => "persistence owner is draining; new work is rejected",
            Self::ExecutorStopped => {
                "persistence executor stopped before acknowledgement; reload durable state"
            }
            Self::AsyncContext => "synchronous persistence requires a blocking caller; await the typed coordinator port on a current-thread runtime",
        })
    }
}
impl std::error::Error for PersistenceAdmissionError {}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PersistenceStats {
    pub capacity: usize,
    pub queued: usize,
    pub executing: usize,
    pub admitted: u64,
    pub rejected: u64,
    pub completed: u64,
    pub cancelled_before_execution: u64,
    pub acknowledgements_lost: u64,
}

#[derive(Default)]
struct Counters {
    queued: AtomicUsize,
    executing: AtomicUsize,
    admitted: AtomicU64,
    rejected: AtomicU64,
    completed: AtomicU64,
    cancelled: AtomicU64,
    lost_ack: AtomicU64,
    capacity: usize,
}

impl Counters {
    fn emit(&self, correlation: Correlation) {
        telemetry::emit_persistence_counts(
            self.queued.load(Ordering::SeqCst),
            self.executing.load(Ordering::SeqCst),
            self.capacity,
            correlation,
        );
    }
}

pub(crate) trait CommandOutput {
    fn error_identity(&self) -> Option<crate::telemetry::StoreErrorIdentity>;
}
impl<T> CommandOutput for Result<T> {
    fn error_identity(&self) -> Option<crate::telemetry::StoreErrorIdentity> {
        self.as_ref()
            .err()
            .and_then(|error| telemetry::store_error_identity(error.as_ref()))
    }
}
macro_rules! store_failure_identity {
    ($([$($module:ident)::+], $error:ident);* $(;)?) => { $(
        impl<T> CommandOutput for std::result::Result<T, $($module)::+::$error> {
            fn error_identity(&self) -> Option<crate::telemetry::StoreErrorIdentity> {
                match self.as_ref().err() {
                    Some($($module)::+::$error::Store(error)) => telemetry::store_error_identity(error.as_ref()),
                    _ => None,
                }
            }
        }
    )* };
}
store_failure_identity!(
    [super], ProjectStoreError;
    [super], ModelConfigurationStoreError;
    [super], SshConfigurationStoreError;
    [super], ManagedMaintenanceError;
    [crate::sessions], SessionConfigUpdateError;
    [crate::sessions], SessionPresentationError;
);

trait QueuedCommand: Send {
    fn correlation(&self) -> Correlation;
    fn fail_unexecuted(self: Box<Self>, counters: &Counters);
    fn run(self: Box<Self>, path: &Path, counters: &Counters);
}

struct Submission<C: PersistenceCommand> {
    command: C,
    reply: oneshot::Sender<Result<C::Output>>,
    admitted: Instant,
}

impl<C: PersistenceCommand> QueuedCommand for Submission<C> {
    fn correlation(&self) -> Correlation {
        self.command.correlation()
    }
    fn fail_unexecuted(self: Box<Self>, counters: &Counters) {
        let correlation = self.command.correlation();
        counters.cancelled.fetch_add(1, Ordering::SeqCst);
        emit(
            StoreOperation::QueueCancellation,
            correlation.clone(),
            self.admitted,
            TelemetryOutcome::Dropped,
        );
        let ack = Instant::now();
        let outcome = if self
            .reply
            .send(Err(PersistenceAdmissionError::ExecutorStopped.into()))
            .is_ok()
        {
            TelemetryOutcome::Error
        } else {
            TelemetryOutcome::Dropped
        };
        emit(StoreOperation::QueueAck, correlation, ack, outcome);
    }

    fn run(self: Box<Self>, path: &Path, counters: &Counters) {
        let Submission {
            command,
            reply,
            admitted,
        } = *self;
        let correlation = command.correlation();
        emit(
            StoreOperation::QueueWait,
            correlation.clone(),
            admitted,
            TelemetryOutcome::Ok,
        );
        if reply.is_closed() {
            counters.cancelled.fetch_add(1, Ordering::SeqCst);
            emit(
                StoreOperation::QueueCancellation,
                correlation.clone(),
                admitted,
                TelemetryOutcome::Dropped,
            );
            counters.emit(correlation);
            return;
        }
        counters.executing.store(1, Ordering::SeqCst);
        counters.emit(correlation.clone());
        let started = Instant::now();
        let result = telemetry::in_store_command(correlation.clone(), || command.execute(path));
        let outcome = result
            .as_ref()
            .map(C::outcome)
            .unwrap_or(TelemetryOutcome::Error);
        let error = match &result {
            Ok(output) => C::error_identity(output),
            Err(error) => telemetry::store_error_identity(error.as_ref()),
        };
        telemetry::emit_store_duration(
            StoreOperation::QueueExecution,
            correlation.clone(),
            started.elapsed(),
            outcome,
            error,
        );
        counters.executing.store(0, Ordering::SeqCst);
        counters.completed.fetch_add(1, Ordering::SeqCst);
        let ack_started = Instant::now();
        let outcome = if reply.send(result).is_ok() {
            TelemetryOutcome::Ok
        } else {
            // The transaction may have committed. Caller cancellation cannot
            // roll it back or turn lost delivery into a known non-commit.
            counters.lost_ack.fetch_add(1, Ordering::SeqCst);
            TelemetryOutcome::Dropped
        };
        emit(StoreOperation::QueueAck, correlation, ack_started, outcome);
        counters.emit(Correlation::default());
    }
}

fn emit(
    operation: StoreOperation,
    correlation: Correlation,
    started: Instant,
    outcome: TelemetryOutcome,
) {
    telemetry::emit_store_duration(operation, correlation, started.elapsed(), outcome, None);
}

/// Admission is FIFO for one store (thus also for each session). SQLite work
/// and its existing bounded busy policy run on one dedicated OS thread.
/// The owner lease stays on that thread until every admitted command drains.
pub struct StoreCoordinator {
    path: PathBuf,
    sender: Mutex<Option<mpsc::Sender<Box<dyn QueuedCommand>>>>,
    drained: watch::Receiver<bool>,
    counters: Arc<Counters>,
    capacity: usize,
    executor_lifetime: Weak<()>,
}

impl StoreCoordinator {
    pub fn acquire(path: &Path) -> Result<Arc<Self>> {
        let lease = StoreProcessLease::try_acquire(path)?;
        let path = lease.store_path().to_path_buf();
        let owner = Arc::new(Self::start(path, Some(lease), DEFAULT_QUEUE_CAPACITY)?);
        ownership::register_owner(&owner);
        Ok(owner)
    }

    fn start(path: PathBuf, lease: Option<StoreProcessLease>, capacity: usize) -> Result<Self> {
        anyhow::ensure!(
            (1..=MAX_QUEUE_CAPACITY).contains(&capacity),
            "invalid persistence queue capacity"
        );
        let (sender, mut receiver) = mpsc::channel::<Box<dyn QueuedCommand>>(capacity);
        let (drained_tx, drained) = watch::channel(false);
        let executor_alive = Arc::new(());
        let executor_lifetime = Arc::downgrade(&executor_alive);
        let counters = Arc::new(Counters {
            capacity,
            ..Counters::default()
        });
        let execution_counters = Arc::clone(&counters);
        let execution_path = path.clone();
        #[cfg(any(test, feature = "test-support"))]
        let test_recorder_member = telemetry::test_recorder_accepts_current_thread();
        std::thread::Builder::new()
            .name("nac-persistence".into())
            .spawn(move || {
                #[cfg(any(test, feature = "test-support"))]
                let _test_recorder =
                    test_recorder_member.then(telemetry::register_test_recorder_thread);
                let _lease = lease;
                let _executor_alive = executor_alive;
                let _execution_owner = ownership::ExecutionStore::enter(execution_path.clone());
                while let Some(command) = receiver.blocking_recv() {
                    // Admission increments before enqueue while holding the same
                    // mutex. The executor can only observe an admitted entry.
                    execution_counters.queued.fetch_sub(1, Ordering::SeqCst);
                    let correlation = command.correlation();
                    let started = Instant::now();
                    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        command.run(&execution_path, &execution_counters);
                    }))
                    .is_err()
                    {
                        // A panic may follow COMMIT. Stop execution, report
                        // uncertainty to that caller, and fail remaining work
                        // without executing it. Never retry a panicked command.
                        execution_counters.executing.store(0, Ordering::SeqCst);
                        execution_counters.completed.fetch_add(1, Ordering::SeqCst);
                        execution_counters.lost_ack.fetch_add(1, Ordering::SeqCst);
                        emit(
                            StoreOperation::QueueExecution,
                            correlation,
                            started,
                            TelemetryOutcome::Error,
                        );
                        receiver.close();
                        while let Some(pending) = receiver.blocking_recv() {
                            execution_counters.queued.fetch_sub(1, Ordering::SeqCst);
                            pending.fail_unexecuted(&execution_counters);
                        }
                        execution_counters.emit(Correlation::default());
                        return; // Closing the drain watch reports ExecutorStopped.
                    }
                }
                drop(_lease);
                let _ = drained_tx.send(true);
            })?;
        Ok(Self {
            path,
            sender: Mutex::new(Some(sender)),
            drained,
            counters,
            capacity,
            executor_lifetime,
        })
    }

    pub(crate) fn submit<C: PersistenceCommand>(
        &self,
        command: C,
    ) -> Result<PendingPersistence<C::Output>> {
        let admitted = Instant::now();
        let correlation = command.correlation();
        let (reply, response) = oneshot::channel();
        let guard = self
            .sender
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let result = if let Some(sender) = guard.as_ref() {
            match sender.try_reserve() {
                Ok(permit) => {
                    self.counters.queued.fetch_add(1, Ordering::SeqCst);
                    self.counters.admitted.fetch_add(1, Ordering::SeqCst);
                    permit.send(Box::new(Submission {
                        command,
                        reply,
                        admitted,
                    }));
                    Ok(PendingPersistence { response })
                }
                Err(error) => Err(match error {
                    mpsc::error::TrySendError::Full(_) => PersistenceAdmissionError::Overloaded,
                    mpsc::error::TrySendError::Closed(_) => {
                        PersistenceAdmissionError::ExecutorStopped
                    }
                }),
            }
        } else {
            Err(PersistenceAdmissionError::ShuttingDown)
        };
        if result.is_err() {
            self.counters.rejected.fetch_add(1, Ordering::SeqCst);
        }
        self.counters.emit(correlation.clone());
        emit(
            StoreOperation::QueueAdmission,
            correlation,
            admitted,
            if result.is_ok() {
                TelemetryOutcome::Ok
            } else {
                TelemetryOutcome::Conflict
            },
        );
        result.map_err(Into::into)
    }

    pub(crate) fn check_blocking_context(&self) -> Result<()> {
        if !super::blocking_caller::is_blocking_caller()
            && tokio::runtime::Handle::try_current().is_ok_and(|handle| {
                handle.runtime_flavor() == tokio::runtime::RuntimeFlavor::CurrentThread
            })
        {
            return Err(PersistenceAdmissionError::AsyncContext.into());
        }
        Ok(())
    }

    pub fn stats(&self) -> PersistenceStats {
        PersistenceStats {
            capacity: self.capacity,
            queued: self.counters.queued.load(Ordering::SeqCst),
            executing: self.counters.executing.load(Ordering::SeqCst),
            admitted: self.counters.admitted.load(Ordering::SeqCst),
            rejected: self.counters.rejected.load(Ordering::SeqCst),
            completed: self.counters.completed.load(Ordering::SeqCst),
            cancelled_before_execution: self.counters.cancelled.load(Ordering::SeqCst),
            acknowledgements_lost: self.counters.lost_ack.load(Ordering::SeqCst),
        }
    }

    pub fn store_path(&self) -> &Path {
        &self.path
    }

    /// Linearize admission closure, then await drain without blocking a runtime.
    /// Dropping this future does not interrupt accepted transactions or release
    /// process ownership early; the executor continues its finite drain.
    pub async fn shutdown(&self) -> Result<()> {
        let started = Instant::now();
        self.sender
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .take();
        let mut drained = self.drained.clone();
        while !*drained.borrow_and_update() {
            drained
                .changed()
                .await
                .map_err(|_| PersistenceAdmissionError::ExecutorStopped)?;
        }
        emit(
            StoreOperation::QueueShutdown,
            Correlation::default(),
            started,
            TelemetryOutcome::Ok,
        );
        Ok(())
    }
}

pub(crate) struct PendingPersistence<T> {
    response: oneshot::Receiver<Result<T>>,
}

impl<T> PendingPersistence<T> {
    pub(crate) fn acknowledge_blocking(self) -> Result<T> {
        let wait = || {
            self.response
                .blocking_recv()
                .map_err(|_| anyhow::Error::from(PersistenceAdmissionError::ExecutorStopped))?
        };
        if !super::blocking_caller::is_blocking_caller()
            && tokio::runtime::Handle::try_current().is_ok()
        {
            tokio::task::block_in_place(wait)
        } else {
            wait()
        }
    }
    pub(crate) async fn acknowledge(self) -> Result<T> {
        self.response
            .await
            .map_err(|_| PersistenceAdmissionError::ExecutorStopped)?
    }
}

#[cfg(test)]
#[path = "coordinator_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "coordinator_contract_tests.rs"]
mod contract_tests;

#[cfg(test)]
#[path = "coordinator_crash_tests.rs"]
mod crash_tests;
