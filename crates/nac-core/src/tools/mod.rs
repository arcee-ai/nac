use std::collections::{HashMap, HashSet, VecDeque};
#[cfg(unix)]
use std::ffi::CString;
use std::fs::{File, OpenOptions};
use std::io;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use fs2::FileExt;
use serde_json::Value;
use tokio::sync::Notify;
use tokio::task::AbortHandle;

use crate::events::{EventSink, SessionRunId};
use crate::mcp::McpRegistry;
use crate::sandbox::ExecutionBackend;
use crate::skills::SkillRegistry;
use crate::terminal::TerminalManager;
use crate::types::ToolDefinition;

const FILE_LOCK_POLL_INTERVAL: Duration = Duration::from_millis(1);
pub(crate) const REMOTE_FILE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(10);
const REMOTE_FILE_LOCK_BUSY_EXIT_CODE: i32 = 75;
const REMOTE_FILE_LOCK_BUSY_MARKER: &str = "NAC_FILE_LOCK_BUSY";

pub mod edit;
pub mod exec_command;
pub mod read;
pub mod thread;
pub mod workset;
pub mod write;

#[cfg(test)]
mod file_lock_benchmark;

#[derive(Debug)]
pub struct ToolResult {
    pub content: String,
    pub is_error: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ThreadDispatchKey {
    pub run_id: SessionRunId,
    pub thread_name: String,
    pub dispatch_id: String,
    pub tool_call_id: String,
}

impl ThreadDispatchKey {
    pub fn new(
        run_id: SessionRunId,
        thread_name: impl Into<String>,
        dispatch_id: impl Into<String>,
        tool_call_id: impl Into<String>,
    ) -> Self {
        Self {
            run_id,
            thread_name: thread_name.into(),
            dispatch_id: dispatch_id.into(),
            tool_call_id: tool_call_id.into(),
        }
    }

    // Temporary bridge for the foreground DAG. Background dispatch integration
    // replaces this with authoritative run and model tool-call identities.
    fn foreground_compat(thread_name: &str, dispatch_id: &str) -> Self {
        Self::new(
            SessionRunId::from_string("foreground-compat".to_string()),
            thread_name,
            dispatch_id,
            dispatch_id,
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadDispatchState {
    PendingDependency,
    Running,
    Cancelling,
}

#[derive(Clone, Default)]
pub(crate) struct ThreadCancellation {
    cancelled: Arc<AtomicBool>,
    activity: Arc<Notify>,
}

impl ThreadCancellation {
    fn cancel(&self) {
        if !self.cancelled.swap(true, Ordering::AcqRel) {
            self.activity.notify_waiters();
        }
    }

    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) async fn cancelled(&self) {
        loop {
            let notified = self.activity.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ThreadCancelOutcome {
    CancelRequested,
    AlreadyCancelling,
    AlreadyTerminal(crate::events::ThreadDispatchStatus),
    NotFound,
    IdentityMismatch,
}

const TERMINAL_TOMBSTONE_LIMIT: usize = 256;
/// Frontend completion metadata is intentionally bounded independently of the
/// completion payload queue. Payloads remain private and exactly-once.
pub const FRONTEND_BUFFERED_COMPLETION_LIMIT: usize = 256;
const CANCELLATION_TASK_GRACE: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BufferedThreadCompletionSnapshot {
    pub key: ThreadDispatchKey,
    pub status: crate::events::ThreadDispatchStatus,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadActivitySnapshot {
    pub active: Vec<ActiveThreadDispatchSnapshot>,
    pub buffered: Vec<BufferedThreadCompletionSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveThreadDispatchSnapshot {
    pub key: ThreadDispatchKey,
    pub state: ThreadDispatchState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadCompletion {
    pub key: ThreadDispatchKey,
    pub content: String,
    pub is_error: bool,
}

pub struct ThreadFinalization {
    pub completion: ThreadCompletion,
    pub expired: Vec<crate::store::ThreadSteeringRecord>,
    pub status: crate::events::ThreadDispatchStatus,
    pub steering_error: Option<anyhow::Error>,
}

struct ActiveThreadDispatch {
    key: ThreadDispatchKey,
    state: ThreadDispatchState,
    coordinator_abort: Option<AbortHandle>,
    worker_abort: Option<AbortHandle>,
    cancellation: ThreadCancellation,
}

#[derive(Debug, Clone)]
struct ThreadTerminalTombstone {
    key: ThreadDispatchKey,
    status: crate::events::ThreadDispatchStatus,
}

#[derive(Default)]
struct ActiveThreadState {
    active_by_name: HashMap<String, ActiveThreadDispatch>,
    completions: VecDeque<ThreadCompletion>,
    terminals: VecDeque<ThreadTerminalTombstone>,
    owned_tasks_by_run: HashMap<SessionRunId, usize>,
    owned_tasks_by_dispatch: HashMap<ThreadDispatchKey, usize>,
    shutting_down: bool,
}

#[allow(dead_code)] // Exact background APIs are wired by subsequent integration commits.
pub struct ActiveThreadRegistry {
    state: StdMutex<ActiveThreadState>,
    activity: Notify,
    activity_epoch: AtomicU64,
    live_thread_updates: AtomicBool,
    #[cfg(test)]
    before_finalize_hook: StdMutex<Option<Arc<dyn Fn(&ThreadDispatchKey) + Send + Sync>>>,
}

/// Registration held by every spawned coordinator and worker until its future
/// is dropped. Counting before spawn closes the abort-before-first-poll race;
/// lifecycle cleanup can therefore wait until all task futures (and their
/// process-owning locals) have been destroyed.
pub struct ThreadTaskGuard {
    registry: Arc<ActiveThreadRegistry>,
    run_id: SessionRunId,
    dispatch_key: Option<ThreadDispatchKey>,
}

impl Drop for ThreadTaskGuard {
    fn drop(&mut self) {
        let mut state = self.registry.lock();
        if let Some(count) = state.owned_tasks_by_run.get_mut(&self.run_id) {
            *count -= 1;
            if *count == 0 {
                state.owned_tasks_by_run.remove(&self.run_id);
            }
        }
        if let Some(key) = &self.dispatch_key {
            if let Some(count) = state.owned_tasks_by_dispatch.get_mut(key) {
                *count -= 1;
                if *count == 0 {
                    state.owned_tasks_by_dispatch.remove(key);
                }
            }
        }
        drop(state);
        self.registry.notify_activity();
    }
}

impl Default for ActiveThreadRegistry {
    fn default() -> Self {
        Self {
            state: StdMutex::new(ActiveThreadState::default()),
            activity: Notify::new(),
            activity_epoch: AtomicU64::new(0),
            live_thread_updates: AtomicBool::new(false),
            #[cfg(test)]
            before_finalize_hook: StdMutex::new(None),
        }
    }
}

#[allow(dead_code)] // Exact background APIs are wired by subsequent integration commits.
impl ActiveThreadRegistry {
    #[cfg(test)]
    pub(crate) fn set_before_finalize_hook(
        &self,
        hook: Arc<dyn Fn(&ThreadDispatchKey) + Send + Sync>,
    ) {
        *self.before_finalize_hook.lock().unwrap() = Some(hook);
    }

    #[cfg(test)]
    pub(crate) fn run_before_finalize_hook(&self, key: &ThreadDispatchKey) {
        if let Some(hook) = self.before_finalize_hook.lock().unwrap().take() {
            hook(key);
        }
    }

    pub fn names(&self) -> Vec<String> {
        self.lock().active_by_name.keys().cloned().collect()
    }

    pub fn active_dispatches(&self) -> Vec<ActiveThreadDispatchSnapshot> {
        self.lock()
            .active_by_name
            .values()
            .map(|dispatch| ActiveThreadDispatchSnapshot {
                key: dispatch.key.clone(),
                state: dispatch.state,
            })
            .collect()
    }

    pub fn is_active(&self, thread_name: &str) -> bool {
        self.lock().active_by_name.contains_key(thread_name)
    }

    pub fn matches(&self, key: &ThreadDispatchKey) -> bool {
        self.lock()
            .active_by_name
            .get(&key.thread_name)
            .is_some_and(|dispatch| dispatch.key == *key)
    }

    pub fn try_accept(&self, key: ThreadDispatchKey) -> bool {
        self.try_accept_batch(vec![key])
            .into_iter()
            .next()
            .unwrap_or(false)
    }

    /// Atomically reserve every available thread name in one parsed batch.
    /// The returned flags correspond to `keys`; a name already active (or a
    /// duplicate in the supplied batch) is rejected without allowing another
    /// launcher to interleave between reservations.
    pub fn try_accept_batch(&self, keys: Vec<ThreadDispatchKey>) -> Vec<bool> {
        let mut state = self.lock();
        let mut accepted_names = HashSet::new();
        let mut accepted = Vec::with_capacity(keys.len());
        for key in keys {
            let available = !state.shutting_down
                && !state.active_by_name.contains_key(&key.thread_name)
                && accepted_names.insert(key.thread_name.clone());
            if available {
                state.active_by_name.insert(
                    key.thread_name.clone(),
                    ActiveThreadDispatch {
                        key,
                        state: ThreadDispatchState::PendingDependency,
                        coordinator_abort: None,
                        worker_abort: None,
                        cancellation: ThreadCancellation::default(),
                    },
                );
            }
            accepted.push(available);
        }
        drop(state);
        if accepted.iter().any(|accepted| *accepted) {
            self.notify_activity();
        }
        accepted
    }

    pub fn mark_running(&self, key: &ThreadDispatchKey) -> bool {
        let mut state = self.lock();
        let Some(dispatch) = state.active_by_name.get_mut(&key.thread_name) else {
            return false;
        };
        if dispatch.key != *key || dispatch.state != ThreadDispatchState::PendingDependency {
            return false;
        }
        dispatch.state = ThreadDispatchState::Running;
        true
    }

    pub fn attach_coordinator(&self, key: &ThreadDispatchKey, abort: AbortHandle) -> bool {
        self.attach_abort(key, abort, false)
    }

    pub fn attach_worker(&self, key: &ThreadDispatchKey, abort: AbortHandle) -> bool {
        self.attach_abort(key, abort, true)
    }

    fn attach_abort(&self, key: &ThreadDispatchKey, abort: AbortHandle, worker: bool) -> bool {
        let mut state = self.lock();
        let Some(dispatch) = state.active_by_name.get_mut(&key.thread_name) else {
            if worker {
                abort.abort();
            }
            return false;
        };
        if dispatch.key != *key {
            if worker {
                abort.abort();
            }
            return false;
        }
        let slot = if worker {
            &mut dispatch.worker_abort
        } else {
            &mut dispatch.coordinator_abort
        };
        if let Some(previous) = slot.replace(abort) {
            previous.abort();
        }
        true
    }

    pub fn resolve_active(&self, thread_name: &str) -> Option<ThreadDispatchKey> {
        self.lock()
            .active_by_name
            .get(thread_name)
            .map(|dispatch| dispatch.key.clone())
    }

    pub fn queue_exact(
        &self,
        store_path: &Path,
        session_id: &str,
        key: &ThreadDispatchKey,
        instruction: &str,
    ) -> anyhow::Result<Result<crate::store::ThreadSteeringRecord, ThreadCancelOutcome>> {
        let state = self.lock();
        let Some(dispatch) = state.active_by_name.get(&key.thread_name) else {
            return Ok(Err(
                if state
                    .active_by_name
                    .values()
                    .any(|active| active.key.dispatch_id == key.dispatch_id)
                    || state
                        .terminals
                        .iter()
                        .any(|terminal| terminal.key.dispatch_id == key.dispatch_id)
                {
                    ThreadCancelOutcome::IdentityMismatch
                } else {
                    ThreadCancelOutcome::NotFound
                },
            ));
        };
        if dispatch.key != *key {
            return Ok(Err(if dispatch.key.dispatch_id == key.dispatch_id {
                ThreadCancelOutcome::IdentityMismatch
            } else {
                ThreadCancelOutcome::NotFound
            }));
        }
        if dispatch.state == ThreadDispatchState::Cancelling {
            return Ok(Err(ThreadCancelOutcome::AlreadyCancelling));
        }
        Ok(Ok(crate::store::queue_thread_steering(
            store_path,
            session_id,
            &key.thread_name,
            &key.dispatch_id,
            instruction,
        )?))
    }

    pub fn queue(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        instruction: &str,
    ) -> anyhow::Result<Option<crate::store::ThreadSteeringRecord>> {
        let state = self.lock();
        let Some(dispatch) = state.active_by_name.get(thread_name) else {
            return Ok(None);
        };
        crate::store::queue_thread_steering(
            store_path,
            session_id,
            thread_name,
            &dispatch.key.dispatch_id,
            instruction,
        )
        .map(Some)
    }

    pub(crate) fn cancellation(&self, key: &ThreadDispatchKey) -> Option<ThreadCancellation> {
        self.lock()
            .active_by_name
            .get(&key.thread_name)
            .filter(|dispatch| dispatch.key == *key)
            .map(|dispatch| dispatch.cancellation.clone())
    }

    pub fn request_cancel(&self, key: &ThreadDispatchKey) -> anyhow::Result<ThreadCancelOutcome> {
        let mut state = self.lock();
        if let Some(terminal) = state.terminals.iter().find(|terminal| terminal.key == *key) {
            return Ok(ThreadCancelOutcome::AlreadyTerminal(terminal.status));
        }
        if state
            .terminals
            .iter()
            .any(|terminal| terminal.key.dispatch_id == key.dispatch_id)
        {
            return Ok(ThreadCancelOutcome::IdentityMismatch);
        }
        let Some(dispatch) = state.active_by_name.get_mut(&key.thread_name) else {
            return Ok(
                if state
                    .active_by_name
                    .values()
                    .any(|active| active.key.dispatch_id == key.dispatch_id)
                {
                    ThreadCancelOutcome::IdentityMismatch
                } else {
                    ThreadCancelOutcome::NotFound
                },
            );
        };
        if dispatch.key != *key {
            return Ok(if dispatch.key.dispatch_id == key.dispatch_id {
                ThreadCancelOutcome::IdentityMismatch
            } else {
                ThreadCancelOutcome::NotFound
            });
        }
        if dispatch.state == ThreadDispatchState::Cancelling {
            return Ok(ThreadCancelOutcome::AlreadyCancelling);
        }
        dispatch.state = ThreadDispatchState::Cancelling;
        dispatch.cancellation.cancel();
        drop(state);
        self.notify_activity();
        Ok(ThreadCancelOutcome::CancelRequested)
    }

    pub fn close(
        &self,
        store_path: &Path,
        session_id: &str,
        key: &ThreadDispatchKey,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        self.finalize_once(
            store_path,
            session_id,
            ThreadCompletion {
                key: key.clone(),
                content: String::new(),
                is_error: false,
            },
            crate::events::ThreadDispatchStatus::Completed,
            None,
            false,
        )
        .and_then(|outcome| match outcome {
            Some(outcome) => match outcome.steering_error {
                Some(error) => Err(error),
                None => Ok(outcome.expired),
            },
            None => Ok(Vec::new()),
        })
    }

    /// The sole exact terminal transition. Completion consumption is separate
    /// from bounded tombstones, so stale cancellation remains mismatch-safe.
    pub fn finalize_once(
        &self,
        store_path: &Path,
        session_id: &str,
        completion: ThreadCompletion,
        status: crate::events::ThreadDispatchStatus,
        usage: Option<&crate::model::TokenUsage>,
        queue_completion: bool,
    ) -> anyhow::Result<Option<ThreadFinalization>> {
        // The registry transition is authoritative and linearizes before I/O.
        // Once cancellation is accepted, no natural result may overwrite it.
        let (status, completion) = {
            let mut completion = completion;
            let mut state = self.lock();
            let Some(dispatch) = state.active_by_name.get(&completion.key.thread_name) else {
                return Ok(None);
            };
            if dispatch.key != completion.key {
                return Ok(None);
            }
            let status = if dispatch.state == ThreadDispatchState::Cancelling {
                crate::events::ThreadDispatchStatus::Cancelled
            } else {
                status
            };
            if status == crate::events::ThreadDispatchStatus::Cancelled {
                completion.content = format!(
                    "Thread '{}' was cancelled (run_id={}, dispatch_id={}, tool_call_id={}).",
                    completion.key.thread_name,
                    completion.key.run_id,
                    completion.key.dispatch_id,
                    completion.key.tool_call_id,
                );
                completion.is_error = true;
            }
            if completion.key.run_id.as_str() != "foreground-compat" {
                crate::store::finalize_worker_dispatch_usage(
                    store_path,
                    &crate::store::WorkerUsageIdentity {
                        session_id: session_id.to_string(),
                        origin_run_id: completion.key.run_id.to_string(),
                        dispatch_id: completion.key.dispatch_id.clone(),
                        thread_name: completion.key.thread_name.clone(),
                        originating_tool_call_id: completion.key.tool_call_id.clone(),
                    },
                    usage,
                    status,
                )?;
            }
            state.active_by_name.remove(&completion.key.thread_name);
            state.terminals.push_back(ThreadTerminalTombstone {
                key: completion.key.clone(),
                status,
            });
            while state.terminals.len() > TERMINAL_TOMBSTONE_LIMIT {
                state.terminals.pop_front();
            }
            if queue_completion {
                state.completions.push_back(completion.clone());
            }
            (status, completion)
        };
        self.notify_activity();

        // Steering persistence is best-effort after terminal ownership has
        // transferred. A broken store can no longer reserve the name forever.
        let (expired, steering_error) = match crate::store::expire_thread_steering(
            store_path,
            session_id,
            &completion.key.dispatch_id,
        ) {
            Ok(expired) => (expired, None),
            Err(error) => (Vec::new(), Some(error)),
        };
        Ok(Some(ThreadFinalization {
            completion,
            expired,
            status,
            steering_error,
        }))
    }

    pub fn complete(
        &self,
        store_path: &Path,
        session_id: &str,
        completion: ThreadCompletion,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let status = self
            .lock()
            .active_by_name
            .get(&completion.key.thread_name)
            .filter(|dispatch| dispatch.key == completion.key)
            .map(|dispatch| dispatch.state)
            .filter(|state| *state == ThreadDispatchState::Cancelling)
            .map(|_| crate::events::ThreadDispatchStatus::Cancelled)
            .unwrap_or_else(|| {
                if completion.is_error {
                    crate::events::ThreadDispatchStatus::Failed
                } else {
                    crate::events::ThreadDispatchStatus::Completed
                }
            });
        self.finalize_once(store_path, session_id, completion, status, None, true)
            .and_then(|outcome| match outcome {
                Some(outcome) => match outcome.steering_error {
                    Some(error) => Err(error),
                    None => Ok(outcome.expired),
                },
                None => Ok(Vec::new()),
            })
    }

    /// Take eligible buffered completions across the session exactly once.
    /// Names are compatibility selectors; dispatch ids provide exact selection.
    pub fn take_completions(
        &self,
        thread_names: &HashSet<String>,
        dispatch_ids: &HashSet<String>,
    ) -> Vec<ThreadCompletion> {
        let mut state = self.lock();
        let mut matching = Vec::new();
        let mut retained = VecDeque::new();
        while let Some(completion) = state.completions.pop_front() {
            let selected_by_exact_id = dispatch_ids.contains(&completion.key.dispatch_id);
            let selected_by_name = thread_names.contains(&completion.key.thread_name)
                && !state
                    .active_by_name
                    .get(&completion.key.thread_name)
                    .is_some_and(|active| active.key.dispatch_id != completion.key.dispatch_id);
            if (thread_names.is_empty() && dispatch_ids.is_empty())
                || selected_by_name
                || selected_by_exact_id
            {
                matching.push(completion);
            } else {
                retained.push_back(completion);
            }
        }
        state.completions = retained;
        matching
    }

    /// Atomically snapshot active dispatches and bounded, exact identities for
    /// completions currently available for exactly-once delivery. Completion
    /// content is deliberately excluded. Taking a completion removes it from
    /// the next snapshot, which authoritatively reconciles delivery.
    pub fn activity_snapshot(&self, completion_limit: usize) -> ThreadActivitySnapshot {
        let state = self.lock();
        let active = state
            .active_by_name
            .values()
            .map(|dispatch| ActiveThreadDispatchSnapshot {
                key: dispatch.key.clone(),
                state: dispatch.state,
            })
            .collect();
        let skip = state.completions.len().saturating_sub(completion_limit);
        let buffered = state
            .completions
            .iter()
            .skip(skip)
            .filter_map(|completion| {
                state
                    .terminals
                    .iter()
                    .rev()
                    .find(|terminal| terminal.key == completion.key)
                    .map(|terminal| BufferedThreadCompletionSnapshot {
                        key: completion.key.clone(),
                        status: terminal.status,
                    })
            })
            .collect();
        ThreadActivitySnapshot { active, buffered }
    }

    pub(crate) fn restore_completions(&self, completions: Vec<ThreadCompletion>) {
        if completions.is_empty() {
            return;
        }
        let mut state = self.lock();
        for completion in completions.into_iter().rev() {
            state.completions.push_front(completion);
        }
        drop(state);
        self.notify_activity();
    }

    pub fn active_for_run(
        &self,
        run_id: &SessionRunId,
        thread_names: &HashSet<String>,
    ) -> Vec<ActiveThreadDispatchSnapshot> {
        self.lock()
            .active_by_name
            .values()
            .filter(|dispatch| {
                dispatch.key.run_id == *run_id
                    && (thread_names.is_empty() || thread_names.contains(&dispatch.key.thread_name))
            })
            .map(|dispatch| ActiveThreadDispatchSnapshot {
                key: dispatch.key.clone(),
                state: dispatch.state,
            })
            .collect()
    }

    pub fn active_selected(
        &self,
        thread_names: &HashSet<String>,
        dispatch_ids: &HashSet<String>,
    ) -> Vec<ActiveThreadDispatchSnapshot> {
        self.lock()
            .active_by_name
            .values()
            .filter(|dispatch| {
                (thread_names.is_empty() && dispatch_ids.is_empty())
                    || thread_names.contains(&dispatch.key.thread_name)
                    || dispatch_ids.contains(&dispatch.key.dispatch_id)
            })
            .map(|dispatch| ActiveThreadDispatchSnapshot {
                key: dispatch.key.clone(),
                state: dispatch.state,
            })
            .collect()
    }

    /// Snapshot exact dispatch identities that are active or buffered for one
    /// originating run. Automatic delivery must use this instead of names so
    /// a later same-name dispatch or an unrelated completion cannot be stolen.
    pub fn dispatch_ids_for_run(&self, run_id: &SessionRunId) -> Vec<String> {
        let state = self.lock();
        let mut dispatch_ids = state
            .active_by_name
            .values()
            .filter(|dispatch| dispatch.key.run_id == *run_id)
            .map(|dispatch| dispatch.key.dispatch_id.clone())
            .chain(
                state
                    .completions
                    .iter()
                    .filter(|completion| completion.key.run_id == *run_id)
                    .map(|completion| completion.key.dispatch_id.clone()),
            )
            .collect::<Vec<_>>();
        dispatch_ids.sort();
        dispatch_ids.dedup();
        dispatch_ids
    }

    pub fn has_completions_for_run(&self, run_id: &SessionRunId) -> bool {
        self.lock()
            .completions
            .iter()
            .any(|completion| completion.key.run_id == *run_id)
    }

    /// Atomically observes whether a run still owns active work or buffered
    /// terminal results. Used by the agent finish guard and service invariant.
    pub fn has_work_for_run(&self, run_id: &SessionRunId) -> bool {
        let state = self.lock();
        state
            .active_by_name
            .values()
            .any(|dispatch| dispatch.key.run_id == *run_id)
            || state
                .completions
                .iter()
                .any(|completion| completion.key.run_id == *run_id)
            || state.owned_tasks_by_run.contains_key(run_id)
    }

    pub fn live_thread_updates(&self) -> bool {
        self.live_thread_updates.load(Ordering::Acquire)
    }

    pub fn set_live_thread_updates(&self, enabled: bool) {
        self.live_thread_updates.store(enabled, Ordering::Release);
        self.notify_activity();
    }

    #[allow(dead_code)] // Used by guidance wakeup integration in a later commit.
    pub fn signal_activity(&self) {
        self.notify_activity();
    }

    pub fn activity_epoch(&self) -> u64 {
        self.activity_epoch.load(Ordering::Acquire)
    }

    pub async fn wait_for_activity_since(&self, observed: u64) {
        loop {
            let notified = self.activity.notified();
            if self.activity_epoch() != observed {
                return;
            }
            notified.await;
            if self.activity_epoch() != observed {
                return;
            }
        }
    }

    pub async fn wait_for_activity(&self) {
        let observed = self.activity_epoch();
        self.wait_for_activity_since(observed).await;
    }

    fn notify_activity(&self) {
        self.activity_epoch.fetch_add(1, Ordering::AcqRel);
        self.activity.notify_waiters();
    }

    pub fn abort_run(
        &self,
        store_path: &Path,
        session_id: &str,
        run_id: &SessionRunId,
    ) -> anyhow::Result<Vec<ThreadFinalization>> {
        self.abort_matching(store_path, session_id, Some(run_id))
    }

    pub fn register_task(self: &Arc<Self>, run_id: SessionRunId) -> ThreadTaskGuard {
        *self
            .lock()
            .owned_tasks_by_run
            .entry(run_id.clone())
            .or_default() += 1;
        ThreadTaskGuard {
            registry: self.clone(),
            run_id,
            dispatch_key: None,
        }
    }

    pub fn register_dispatch_task(self: &Arc<Self>, key: ThreadDispatchKey) -> ThreadTaskGuard {
        let mut state = self.lock();
        *state
            .owned_tasks_by_run
            .entry(key.run_id.clone())
            .or_default() += 1;
        *state
            .owned_tasks_by_dispatch
            .entry(key.clone())
            .or_default() += 1;
        drop(state);
        ThreadTaskGuard {
            registry: self.clone(),
            run_id: key.run_id.clone(),
            dispatch_key: Some(key),
        }
    }

    pub async fn drain_dispatch(&self, key: &ThreadDispatchKey) {
        loop {
            let observed = self.activity_epoch();
            if !self.lock().owned_tasks_by_dispatch.contains_key(key) {
                return;
            }
            self.wait_for_activity_since(observed).await;
        }
    }

    async fn drain_tasks(&self, run_id: Option<&SessionRunId>) {
        loop {
            let observed = self.activity_epoch();
            let drained = {
                let state = self.lock();
                match run_id {
                    Some(run_id) => !state.owned_tasks_by_run.contains_key(run_id),
                    None => state.owned_tasks_by_run.is_empty(),
                }
            };
            if drained {
                return;
            }
            self.wait_for_activity_since(observed).await;
        }
    }

    #[cfg(test)]
    pub(crate) fn force_abort_worker_for_test(&self, key: &ThreadDispatchKey) -> bool {
        let abort = self
            .lock()
            .active_by_name
            .get(&key.thread_name)
            .filter(|dispatch| dispatch.key == *key)
            .and_then(|dispatch| dispatch.worker_abort.clone());
        if let Some(abort) = abort {
            abort.abort();
            true
        } else {
            false
        }
    }

    pub async fn cancel_and_drain(
        &self,
        store_path: &Path,
        session_id: &str,
        key: &ThreadDispatchKey,
    ) -> anyhow::Result<(ThreadCancelOutcome, Vec<ThreadFinalization>)> {
        let pending_without_worker = self
            .lock()
            .active_by_name
            .get(&key.thread_name)
            .is_some_and(|dispatch| {
                dispatch.key == *key
                    && (dispatch.state == ThreadDispatchState::PendingDependency
                        || dispatch.state == ThreadDispatchState::Cancelling)
                    && dispatch.worker_abort.is_none()
            });
        let outcome = self.request_cancel(key)?;
        if !matches!(
            outcome,
            ThreadCancelOutcome::CancelRequested | ThreadCancelOutcome::AlreadyCancelling
        ) {
            return Ok((outcome, Vec::new()));
        }
        if pending_without_worker {
            let finalizations =
                self.finalize_cancelled_keys(store_path, session_id, HashSet::from([key.clone()]));
            return Ok((outcome, finalizations));
        }

        let drain = async {
            self.drain_dispatch(key).await;
            loop {
                let observed = self.activity_epoch();
                if !self.matches(key) {
                    return;
                }
                self.wait_for_activity_since(observed).await;
            }
        };
        if tokio::time::timeout(CANCELLATION_TASK_GRACE, drain)
            .await
            .is_ok()
        {
            return Ok((outcome, Vec::new()));
        }

        // An exact cancellation may force only its worker. A pending member has
        // no worker to abort; its shared coordinator is notified through the
        // registry activity signal and remains responsible for terminalization.
        let worker_abort = self
            .lock()
            .active_by_name
            .get(&key.thread_name)
            .filter(|dispatch| dispatch.key == *key)
            .and_then(|dispatch| dispatch.worker_abort.clone());
        if let Some(abort) = worker_abort {
            abort.abort();
        }
        let forced_drain = async {
            self.drain_dispatch(key).await;
            loop {
                let observed = self.activity_epoch();
                if !self.matches(key) {
                    return;
                }
                self.wait_for_activity_since(observed).await;
            }
        };
        tokio::time::timeout(CANCELLATION_TASK_GRACE, forced_drain)
            .await
            .map_err(|_| {
                anyhow::anyhow!("timed out draining cancelled thread '{}'", key.thread_name)
            })?;
        Ok((outcome, Vec::new()))
    }

    pub async fn abort_run_and_drain(
        &self,
        store_path: &Path,
        session_id: &str,
        run_id: &SessionRunId,
    ) -> anyhow::Result<Vec<ThreadFinalization>> {
        let mut result = self.abort_run(store_path, session_id, run_id)?;
        if tokio::time::timeout(CANCELLATION_TASK_GRACE, self.drain_tasks(Some(run_id)))
            .await
            .is_err()
        {
            self.force_abort_matching(Some(run_id));
            tokio::time::timeout(CANCELLATION_TASK_GRACE, self.drain_tasks(Some(run_id)))
                .await
                .map_err(|_| anyhow::anyhow!("timed out force-draining background run {run_id}"))?;
        }
        result.extend(self.finalize_cancelled_matching(
            store_path,
            session_id,
            Some(run_id),
            false,
        ));
        Ok(result)
    }

    pub fn shutdown(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<ThreadFinalization>> {
        {
            let mut state = self.lock();
            state.shutting_down = true;
        }
        self.abort_matching(store_path, session_id, None)
    }

    pub async fn shutdown_and_drain(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<ThreadFinalization>> {
        let mut result = self.shutdown(store_path, session_id)?;
        if tokio::time::timeout(CANCELLATION_TASK_GRACE, self.drain_tasks(None))
            .await
            .is_err()
        {
            self.force_abort_matching(None);
            tokio::time::timeout(CANCELLATION_TASK_GRACE, self.drain_tasks(None))
                .await
                .map_err(|_| anyhow::anyhow!("timed out force-draining session background work"))?;
        }
        result.extend(self.finalize_cancelled_matching(store_path, session_id, None, false));
        Ok(result)
    }

    fn force_abort_matching(&self, run_id: Option<&SessionRunId>) {
        let state = self.lock();
        for dispatch in state
            .active_by_name
            .values()
            .filter(|dispatch| run_id.is_none_or(|run_id| dispatch.key.run_id == *run_id))
        {
            if let Some(abort) = &dispatch.worker_abort {
                abort.abort();
            }
            if let Some(abort) = &dispatch.coordinator_abort {
                abort.abort();
            }
        }
    }

    fn abort_matching(
        &self,
        store_path: &Path,
        session_id: &str,
        run_id: Option<&SessionRunId>,
    ) -> anyhow::Result<Vec<ThreadFinalization>> {
        let keys = self
            .lock()
            .active_by_name
            .values()
            .filter(|dispatch| run_id.is_none_or(|run_id| dispatch.key.run_id == *run_id))
            .map(|dispatch| {
                (
                    dispatch.key.clone(),
                    dispatch.state == ThreadDispatchState::PendingDependency
                        && dispatch.worker_abort.is_none(),
                )
            })
            .collect::<Vec<_>>();
        for (key, _) in &keys {
            let _ = self.request_cancel(key)?;
        }
        // Pending entries have no independently-owned process to drain. Remove
        // them now without aborting their shared coordinator; mark_running will
        // later fail for the exact tombstoned member and propagate dependency
        // failure through the DAG.
        let immediate = keys
            .into_iter()
            .filter_map(|(key, immediate)| immediate.then_some(key))
            .collect::<HashSet<_>>();
        Ok(self.finalize_cancelled_keys(store_path, session_id, immediate))
    }

    fn finalize_cancelled_matching(
        &self,
        store_path: &Path,
        session_id: &str,
        run_id: Option<&SessionRunId>,
        ownerless_only: bool,
    ) -> Vec<ThreadFinalization> {
        let keys = self
            .lock()
            .active_by_name
            .values()
            .filter(|dispatch| {
                dispatch.state == ThreadDispatchState::Cancelling
                    && run_id.is_none_or(|run_id| dispatch.key.run_id == *run_id)
                    && (!ownerless_only || dispatch.worker_abort.is_none())
            })
            .map(|dispatch| dispatch.key.clone())
            .collect::<HashSet<_>>();
        self.finalize_cancelled_keys(store_path, session_id, keys)
    }

    fn finalize_cancelled_keys(
        &self,
        store_path: &Path,
        session_id: &str,
        keys: HashSet<ThreadDispatchKey>,
    ) -> Vec<ThreadFinalization> {
        let mut finalizations = Vec::new();
        for key in keys {
            let completion = ThreadCompletion {
                content: format!("Thread '{}' was cancelled.", key.thread_name),
                key,
                is_error: true,
            };
            match self.finalize_once(
                store_path,
                session_id,
                completion,
                crate::events::ThreadDispatchStatus::Cancelled,
                None,
                true,
            ) {
                Ok(Some(outcome)) => finalizations.push(outcome),
                Ok(None) => {}
                Err(error) => eprintln!("nac: failed to terminalize cancelled thread: {error:#}"),
            }
        }
        finalizations
    }

    // Compatibility for the foreground DAG until background execution supplies
    // authoritative run and tool-call identities.
    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let key = ThreadDispatchKey::foreground_compat(thread_name, dispatch_id);
        let accepted = self.try_accept(key.clone());
        if accepted {
            self.mark_running(&key);
        }
        accepted
    }

    pub fn close_compat(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        dispatch_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        self.close(
            store_path,
            session_id,
            &ThreadDispatchKey::foreground_compat(thread_name, dispatch_id),
        )
    }

    pub fn close_all(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        Ok(self
            .abort_matching(store_path, session_id, None)?
            .into_iter()
            .flat_map(|finalization| finalization.expired)
            .collect())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, ActiveThreadState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

impl Drop for ActiveThreadRegistry {
    fn drop(&mut self) {
        let state = self
            .state
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for (_, dispatch) in state.active_by_name.drain() {
            if let Some(abort) = dispatch.worker_abort {
                abort.abort();
            }
            if let Some(abort) = dispatch.coordinator_abort {
                abort.abort();
            }
        }
        state.completions.clear();
    }
}

#[derive(Clone)]
pub struct ToolRuntime {
    pub workspace_cwd: PathBuf,
    pub config_cwd: PathBuf,
    pub store_path: PathBuf,
    pub session_id: Option<String>,
    pub worker_executable: Option<PathBuf>,
    pub active_threads: Arc<ActiveThreadRegistry>,
    pub event_sink: EventSink,
    pub backend: Arc<ExecutionBackend>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub terminal_manager: TerminalManager,
    pub thread_timeout_secs: u64,
}

pub(crate) fn resolve_workspace_path(runtime: &ToolRuntime, path: impl AsRef<Path>) -> PathBuf {
    let path = path.as_ref();
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        runtime.workspace_cwd.join(path)
    }
}

#[derive(Clone, Copy)]
pub(crate) enum FileLockAccess {
    Write,
    ReadWrite,
}

/// Opens and exclusively locks a target file for a complete mutation.
///
/// The advisory lock belongs to the file and is therefore shared by all NAC
/// sessions and worker processes that access the same filesystem object.
/// Acquisition is polled so cancellation drops the file handle instead of
/// leaving a blocking-pool task that can acquire the lock and mutate later.
pub(crate) async fn open_locked_file(
    path: PathBuf,
    create: bool,
    access: FileLockAccess,
) -> io::Result<File> {
    let file = tokio::task::spawn_blocking(move || {
        let mut options = OpenOptions::new();
        options.write(true).create(create);
        if matches!(access, FileLockAccess::ReadWrite) {
            options.read(true);
        }
        options.open(path)
    })
    .await
    .map_err(|error| io::Error::other(format!("file-open task failed: {error}")))??;
    lock_file(file).await
}

/// Opens a mounted host file without following symlinks beneath the mount root.
///
/// `None` asks the caller to preserve guest symlink semantics by using remote
/// execution instead. Directory descriptors keep the traversal confined even
/// if a sandbox process swaps a later path component during the open.
pub(crate) async fn open_locked_file_beneath(
    root: PathBuf,
    relative: PathBuf,
    create_parents: bool,
    create_file: bool,
    access: FileLockAccess,
) -> io::Result<Option<File>> {
    let file = tokio::task::spawn_blocking(move || {
        open_file_beneath(root, relative, create_parents, create_file, access)
    })
    .await
    .map_err(|error| io::Error::other(format!("mounted file-open task failed: {error}")))??;
    match file {
        Some(file) => lock_file(file).await.map(Some),
        None => Ok(None),
    }
}

async fn lock_file(file: File) -> io::Result<File> {
    loop {
        match FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(file),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                tokio::time::sleep(FILE_LOCK_POLL_INTERVAL).await;
            }
            Err(error) => return Err(error),
        }
    }
}

#[cfg(unix)]
fn open_file_beneath(
    root: PathBuf,
    relative: PathBuf,
    create_parents: bool,
    create_file: bool,
    access: FileLockAccess,
) -> io::Result<Option<File>> {
    if relative.as_os_str().is_empty() {
        return open_mount_root(root, access);
    }

    let mut options = OpenOptions::new();
    options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut directory = options.open(root)?;
    let mut components = relative.components().peekable();

    while let Some(component) = components.next() {
        let std::path::Component::Normal(part) = component else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "mounted file path must be relative",
            ));
        };
        let name = CString::new(part.as_bytes()).map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "mounted file path contains a NUL byte",
            )
        })?;

        if components.peek().is_none() {
            return open_file_at(&directory, &name, create_file, access);
        }

        match open_directory_at(&directory, &name) {
            Ok(next) => directory = next,
            Err(error) if is_symlink_or_non_directory(&error) => return Ok(None),
            Err(error) if error.kind() == io::ErrorKind::NotFound && create_parents => {
                let result = unsafe { libc::mkdirat(directory.as_raw_fd(), name.as_ptr(), 0o777) };
                if result == -1 {
                    let error = io::Error::last_os_error();
                    if error.kind() != io::ErrorKind::AlreadyExists {
                        return Err(error);
                    }
                }
                match open_directory_at(&directory, &name) {
                    Ok(next) => directory = next,
                    Err(error) if is_symlink_or_non_directory(&error) => return Ok(None),
                    Err(error) => return Err(error),
                }
            }
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "mounted file path does not name a file",
    ))
}

#[cfg(unix)]
fn open_mount_root(root: PathBuf, access: FileLockAccess) -> io::Result<Option<File>> {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    if matches!(access, FileLockAccess::ReadWrite) {
        options.read(true);
    }
    match options.open(root) {
        Ok(file) => Ok(Some(file)),
        Err(error) if is_symlink_or_non_directory(&error) => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(unix)]
fn open_directory_at(directory: &File, name: &CString) -> io::Result<File> {
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if descriptor == -1 {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn open_file_at(
    directory: &File,
    name: &CString,
    create: bool,
    access: FileLockAccess,
) -> io::Result<Option<File>> {
    let access_flag = match access {
        FileLockAccess::Write => libc::O_WRONLY,
        FileLockAccess::ReadWrite => libc::O_RDWR,
    };
    let create_flag = if create { libc::O_CREAT } else { 0 };
    let descriptor = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            access_flag | create_flag | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o666,
        )
    };
    if descriptor == -1 {
        let error = io::Error::last_os_error();
        return if is_symlink_or_non_directory(&error) {
            Ok(None)
        } else {
            Err(error)
        };
    }
    Ok(Some(unsafe { File::from_raw_fd(descriptor) }))
}

#[cfg(unix)]
fn is_symlink_or_non_directory(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code) if code == libc::ELOOP || code == libc::ENOTDIR
    )
}

#[cfg(not(unix))]
fn open_file_beneath(
    _root: PathBuf,
    _relative: PathBuf,
    _create_parents: bool,
    _create_file: bool,
    _access: FileLockAccess,
) -> io::Result<Option<File>> {
    Ok(None)
}

pub(crate) fn remote_file_lock_busy(output: &std::process::Output) -> bool {
    output.status.code() == Some(REMOTE_FILE_LOCK_BUSY_EXIT_CODE)
        && String::from_utf8_lossy(&output.stdout).trim() == REMOTE_FILE_LOCK_BUSY_MARKER
}

pub fn worker_tool_definitions() -> Vec<ToolDefinition> {
    use serde_json::json;

    let mut tools = vec![
        def(
            "read",
            "Read file contents with line numbers. Supports offset and limit.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "offset": { "type": "integer", "description": "Line number to start from (0-indexed, optional)" },
                    "limit": { "type": "integer", "description": "Max lines to read (optional, default 2000)" }
                },
                "required": ["path"]
            }),
        ),
        def(
            "write",
            "Write content to a file. Creates parent directories automatically.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "content": { "type": "string", "description": "Content to write" }
                },
                "required": ["path", "content"]
            }),
        ),
        def(
            "edit",
            "Replace exact text in a file.",
            json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path to file" },
                    "old_text": { "type": "string", "description": "Text to find and replace" },
                    "new_text": { "type": "string", "description": "Replacement text" }
                },
                "required": ["path", "old_text", "new_text"]
            }),
        ),
    ];

    tools.push(exec_command::exec_command_definition());
    tools.push(exec_command::write_stdin_definition());

    tools
}

pub fn orchestrator_tool_definitions(skills: Option<&SkillRegistry>) -> Vec<ToolDefinition> {
    vec![
        thread::dispatch_definition(skills),
        thread::threads_definition(),
        thread::thread_wait_definition(),
        thread::thread_read_definition(),
        thread::thread_delete_definition(),
        thread::thread_cancel_definition(),
        workset::define_definition(),
        workset::read_definition(),
        workset::list_definition(),
    ]
}

fn def(name: &str, description: &str, parameters: Value) -> ToolDefinition {
    ToolDefinition {
        def_type: "function".to_string(),
        function: crate::types::FunctionDef {
            name: name.to_string(),
            description: description.to_string(),
            parameters,
        },
    }
}

pub fn require_str(args: &Value, key: &str) -> Result<String, ToolResult> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .ok_or_else(|| ToolResult {
            content: format!("Error: '{}' argument required", key),
            is_error: true,
        })
}

pub fn require_string_array(args: &Value, key: &str) -> Result<Vec<String>, ToolResult> {
    let Some(value) = args.get(key) else {
        return Ok(Vec::new());
    };

    let Some(items) = value.as_array() else {
        return Err(ToolResult {
            content: format!("Error: '{}' must be an array of strings", key),
            is_error: true,
        });
    };

    let mut out = Vec::with_capacity(items.len());
    for item in items {
        let Some(value) = item.as_str() else {
            return Err(ToolResult {
                content: format!("Error: '{}' must be an array of strings", key),
                is_error: true,
            });
        };
        out.push(value.to_string());
    }

    Ok(out)
}

pub async fn execute_tool(
    name: &str,
    args: Value,
    runtime: &ToolRuntime,
    client: &crate::model::ModelClient,
) -> ToolResult {
    if name.starts_with("mcp__") {
        let Some(registry) = &runtime.mcp else {
            return ToolResult {
                content: format!("Error: MCP tool '{}' is not available", name),
                is_error: true,
            };
        };
        return registry.call_tool(name, args).await;
    }

    match name {
        "read" => read::execute(args, runtime).await,
        "write" => write::execute(args, runtime).await,
        "edit" => edit::execute(args, runtime).await,
        "exec_command" => match exec_command::execute_exec_command(&args, runtime).await {
            Ok(content) => ToolResult {
                content,
                is_error: false,
            },
            Err(e) => ToolResult {
                content: format!("Error: {:#}", e),
                is_error: true,
            },
        },
        "write_stdin" => match exec_command::execute_write_stdin(&args, runtime).await {
            Ok(content) => ToolResult {
                content,
                is_error: false,
            },
            Err(e) => ToolResult {
                content: format!("Error: {:#}", e),
                is_error: true,
            },
        },
        "thread" => thread::execute_dispatch(args, runtime, client).await,
        "threads" => thread::execute_threads(runtime).await,
        "thread_wait" => thread::execute_thread_wait(args, runtime).await,
        "thread_read" => thread::execute_thread_read(args, runtime).await,
        "thread_delete" => thread::execute_thread_delete(args, runtime).await,
        "thread_cancel" => thread::execute_thread_cancel(args, runtime).await,
        "workset_define" => workset::execute_define(args, runtime).await,
        "workset_read" => workset::execute_read(args, runtime).await,
        "workset_list" => workset::execute_list(args, runtime).await,
        unknown => ToolResult {
            content: format!("Error: unknown tool '{}'", unknown),
            is_error: true,
        },
    }
}

// ------------------------------------------------------------------
// Test helpers (shared across agent::dag, agent::tool_exec, tools::thread)
// ------------------------------------------------------------------

/// Create a `ToolRuntime` suitable for unit tests.  Uses the current
/// directory as the workspace, an empty store path, a dummy session id,
/// and no MCP / skills / worker executable.
#[cfg(test)]
pub(crate) fn test_runtime() -> ToolRuntime {
    let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let backend = crate::sandbox::execution_backend_from_sandbox(None, &workspace_cwd);
    ToolRuntime {
        config_cwd: workspace_cwd.clone(),
        workspace_cwd,
        store_path: PathBuf::new(),
        session_id: Some("test-session".to_string()),
        worker_executable: None,
        active_threads: Arc::new(crate::tools::ActiveThreadRegistry::default()),
        event_sink: EventSink::none(),
        backend,
        mcp: None,
        skills: None,
        terminal_manager: TerminalManager::new(),
        thread_timeout_secs: thread::DEFAULT_THREAD_TIMEOUT_SECS,
    }
}

#[cfg(test)]
mod active_thread_registry_tests {
    use super::*;
    use std::future::pending;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn key(run: &SessionRunId, name: &str, dispatch: &str, call: &str) -> ThreadDispatchKey {
        ThreadDispatchKey::new(run.clone(), name, dispatch, call)
    }

    fn test_store() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_active_registry_{}_{}.db",
            std::process::id(),
            unique
        ));
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session");
        path
    }

    fn completion(key: ThreadDispatchKey, content: &str) -> ThreadCompletion {
        ThreadCompletion {
            key,
            content: content.to_string(),
            is_error: false,
        }
    }

    #[test]
    fn exact_key_and_name_exclusion_preserve_pending_running_state() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::new();
        let accepted = key(&run, "worker", "dispatch-a", "call-a");
        let same_name = key(&SessionRunId::new(), "worker", "dispatch-b", "call-b");

        assert!(registry.try_accept(accepted.clone()));
        assert!(!registry.try_accept(same_name));
        assert!(registry.matches(&accepted));
        assert_eq!(
            registry.active_dispatches(),
            vec![ActiveThreadDispatchSnapshot {
                key: accepted.clone(),
                state: ThreadDispatchState::PendingDependency,
            }]
        );
        assert!(registry.mark_running(&accepted));
        assert_eq!(
            registry.active_dispatches()[0].state,
            ThreadDispatchState::Running
        );

        for stale in [
            key(&SessionRunId::new(), "worker", "dispatch-a", "call-a"),
            key(&run, "worker", "dispatch-other", "call-a"),
            key(&run, "worker", "dispatch-a", "call-other"),
        ] {
            assert!(!registry.matches(&stale));
            assert!(!registry.mark_running(&stale));
        }
    }

    #[test]
    fn stale_close_and_completion_cannot_remove_or_buffer_for_reused_name() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::new();
        let current = key(&run, "worker", "dispatch-new", "call-new");
        let stale = key(&run, "worker", "dispatch-old", "call-old");
        assert!(registry.try_accept(current.clone()));

        let missing = Path::new("/store/must/not/be/opened");
        assert!(registry
            .close(missing, "session", &stale)
            .unwrap()
            .is_empty());
        assert!(registry
            .complete(missing, "session", completion(stale, "stale"))
            .unwrap()
            .is_empty());
        assert!(registry.matches(&current));
        assert!(!registry.has_completions_for_run(&run));
    }

    #[test]
    fn exact_close_releases_name_for_reuse_without_buffering_completion() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let first = key(&run, "worker", "dispatch-first", "call-first");
        let second = key(&run, "worker", "dispatch-second", "call-second");
        assert!(registry.try_accept(first.clone()));

        assert!(registry
            .close(&store, "session", &first)
            .unwrap()
            .is_empty());
        assert!(!registry.matches(&first));
        assert!(!registry.has_completions_for_run(&run));
        assert!(registry.try_accept(second.clone()));
        assert!(registry.matches(&second));
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn completions_are_session_fifo_filtered_and_exactly_once() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run_a = SessionRunId::new();
        let run_b = SessionRunId::new();
        let a1 = key(&run_a, "a1", "dispatch-a1", "call-a1");
        let b1 = key(&run_b, "b1", "dispatch-b1", "call-b1");
        let a2 = key(&run_a, "a2", "dispatch-a2", "call-a2");
        for key in [&a1, &b1, &a2] {
            assert!(registry.try_accept(key.clone()));
        }
        registry
            .complete(&store, "session", completion(a1, "first"))
            .unwrap();
        registry
            .complete(&store, "session", completion(b1, "foreign"))
            .unwrap();
        registry
            .complete(&store, "session", completion(a2, "second"))
            .unwrap();

        let selected = HashSet::from(["a2".to_string()]);
        let taken = registry.take_completions(&selected, &HashSet::new());
        assert_eq!(
            taken
                .iter()
                .map(|item| item.content.as_str())
                .collect::<Vec<_>>(),
            ["second"]
        );
        assert!(registry
            .take_completions(&selected, &HashSet::new())
            .is_empty());
        let remaining = registry.take_completions(&HashSet::new(), &HashSet::new());
        assert_eq!(
            remaining
                .iter()
                .map(|item| item.content.as_str())
                .collect::<Vec<_>>(),
            ["first", "foreign"]
        );
        assert!(registry
            .take_completions(&HashSet::new(), &HashSet::new())
            .is_empty());
        assert!(!registry.has_completions_for_run(&run_a));
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn buffered_completion_snapshot_is_exact_content_free_and_reconciles_consumption() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let completed = key(&run, "worker", "dispatch-ok", "call-ok");
        let failed = key(&run, "worker-2", "dispatch-failed", "call-failed");
        assert!(registry.try_accept(completed.clone()));
        assert!(registry.try_accept(failed.clone()));
        registry
            .complete(
                &store,
                "session",
                completion(completed.clone(), "SECRET_RESULT"),
            )
            .unwrap();
        registry
            .complete(
                &store,
                "session",
                ThreadCompletion {
                    key: failed.clone(),
                    content: "SECRET_ERROR".to_string(),
                    is_error: true,
                },
            )
            .unwrap();

        let snapshot = registry
            .activity_snapshot(FRONTEND_BUFFERED_COMPLETION_LIMIT)
            .buffered;
        assert_eq!(snapshot.len(), 2);
        assert_eq!(snapshot[0].key, completed);
        assert_eq!(
            snapshot[0].status,
            crate::events::ThreadDispatchStatus::Completed
        );
        assert_eq!(snapshot[1].key, failed);
        assert_eq!(
            snapshot[1].status,
            crate::events::ThreadDispatchStatus::Failed
        );

        let selected = HashSet::from(["dispatch-ok".to_string()]);
        assert_eq!(
            registry.take_completions(&HashSet::new(), &selected).len(),
            1
        );
        let after_delivery = registry
            .activity_snapshot(FRONTEND_BUFFERED_COMPLETION_LIMIT)
            .buffered;
        assert_eq!(after_delivery.len(), 1);
        assert_eq!(after_delivery[0].key, failed);
        assert!(registry.activity_snapshot(0).buffered.is_empty());
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn abort_handle_attachment_is_exact_and_replacement_aborts_old_owner() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::new();
        let current = key(&run, "worker", "dispatch", "call");
        let stale = key(&run, "worker", "other", "call");
        assert!(registry.try_accept(current.clone()));

        let stale_task = tokio::spawn(pending::<()>());
        assert!(!registry.attach_worker(&stale, stale_task.abort_handle()));
        assert!(stale_task.await.unwrap_err().is_cancelled());

        let first = tokio::spawn(pending::<()>());
        assert!(registry.attach_worker(&current, first.abort_handle()));
        let replacement = tokio::spawn(pending::<()>());
        assert!(registry.attach_worker(&current, replacement.abort_handle()));
        assert!(first.await.unwrap_err().is_cancelled());
        replacement.abort();
    }

    #[tokio::test]
    async fn abort_run_cleans_only_exact_run_tasks_and_completions() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run_a = SessionRunId::new();
        let run_b = SessionRunId::new();
        let active_a = key(&run_a, "active-a", "dispatch-aa", "call-aa");
        let done_a = key(&run_a, "done-a", "dispatch-da", "call-da");
        let active_b = key(&run_b, "active-b", "dispatch-ab", "call-ab");
        let done_b = key(&run_b, "done-b", "dispatch-db", "call-db");
        for key in [&active_a, &done_a, &active_b, &done_b] {
            assert!(registry.try_accept(key.clone()));
        }
        let coordinator = tokio::spawn(pending::<()>());
        let worker = tokio::spawn(pending::<()>());
        assert!(registry.attach_coordinator(&active_a, coordinator.abort_handle()));
        assert!(registry.attach_worker(&active_a, worker.abort_handle()));
        registry
            .complete(&store, "session", completion(done_a, "done-a"))
            .unwrap();
        registry
            .complete(&store, "session", completion(done_b, "done-b"))
            .unwrap();

        tokio::time::timeout(Duration::from_secs(1), async {
            registry.abort_run(&store, "session", &run_a).unwrap();
        })
        .await
        .expect("cooperative abort request blocked");
        assert!(!coordinator.is_finished());
        assert!(!worker.is_finished());
        assert_eq!(
            registry.active_for_run(&run_a, &HashSet::new())[0].state,
            ThreadDispatchState::Cancelling
        );
        assert!(registry.has_completions_for_run(&run_a));
        assert!(registry.matches(&active_b));
        let mut completion_contents = registry
            .take_completions(&HashSet::new(), &HashSet::new())
            .into_iter()
            .map(|completion| completion.content)
            .collect::<Vec<_>>();
        completion_contents.sort();
        assert_eq!(completion_contents, ["done-a", "done-b"]);
        coordinator.abort();
        worker.abort();
        let _ = coordinator.await;
        let _ = worker.await;
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn shutdown_aborts_all_owners_clears_buffers_and_rejects_new_dispatches() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let active = key(&run, "active", "dispatch-active", "call-active");
        let done = key(&run, "done", "dispatch-done", "call-done");
        assert!(registry.try_accept(active.clone()));
        assert!(registry.try_accept(done.clone()));
        let coordinator = tokio::spawn(pending::<()>());
        assert!(registry.attach_coordinator(&active, coordinator.abort_handle()));
        registry
            .complete(&store, "session", completion(done, "done"))
            .unwrap();

        tokio::time::timeout(Duration::from_secs(1), async {
            registry.shutdown(&store, "session").unwrap();
        })
        .await
        .expect("cooperative shutdown request blocked");
        assert!(!coordinator.is_finished());
        assert!(registry.active_dispatches().is_empty());
        assert_eq!(
            registry.request_cancel(&active).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Cancelled)
        );
        assert!(registry.has_completions_for_run(&run));
        assert!(!registry.try_accept(key(&run, "later", "dispatch", "call")));
        coordinator.abort();
        let _ = coordinator.await;
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn abort_and_drain_waits_for_registered_task_future_drop() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        let store = test_store();
        let run = SessionRunId::new();
        let dispatch = key(&run, "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        let guard = registry.register_task(run.clone());
        let task = tokio::spawn(async move {
            let _guard = guard;
            pending::<()>().await;
        });
        assert!(registry.attach_worker(&dispatch, task.abort_handle()));

        tokio::time::timeout(
            Duration::from_secs(5),
            registry.abort_run_and_drain(&store, "session", &run),
        )
        .await
        .expect("drain deadlocked")
        .unwrap();
        assert!(task.await.unwrap_err().is_cancelled());
        assert!(!registry.matches(&dispatch));
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Cancelled)
        );
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn cancellation_is_exact_idempotent_and_terminal_tombstone_survives_consumption() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let dispatch = key(&run, "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::CancelRequested
        );
        assert_eq!(
            registry.active_dispatches()[0].state,
            ThreadDispatchState::Cancelling
        );
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::AlreadyCancelling
        );
        assert!(registry
            .finalize_once(
                &store,
                "session",
                ThreadCompletion {
                    key: dispatch.clone(),
                    content: "cancelled".into(),
                    is_error: true,
                },
                crate::events::ThreadDispatchStatus::Cancelled,
                None,
                true,
            )
            .unwrap()
            .is_some());
        assert_eq!(
            registry
                .take_completions(&HashSet::new(), &HashSet::new())
                .len(),
            1
        );
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Cancelled)
        );
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn stale_cancellation_and_losing_finalizer_cannot_touch_same_name_replacement() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let old = key(&run, "worker", "old", "old-call");
        let replacement = key(&run, "worker", "new", "new-call");
        assert!(registry.try_accept(old.clone()));
        assert!(registry
            .finalize_once(
                &store,
                "session",
                completion(old.clone(), "done"),
                crate::events::ThreadDispatchStatus::Completed,
                None,
                true,
            )
            .unwrap()
            .is_some());
        assert!(registry.try_accept(replacement.clone()));
        assert_eq!(
            registry.request_cancel(&old).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Completed)
        );
        assert!(registry
            .finalize_once(
                &store,
                "session",
                completion(old, "late"),
                crate::events::ThreadDispatchStatus::Failed,
                None,
                true,
            )
            .unwrap()
            .is_none());
        assert!(registry.matches(&replacement));
        assert_eq!(
            registry
                .take_completions(&HashSet::new(), &HashSet::new())
                .len(),
            1
        );
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn pending_exact_cancel_drains_via_coordinator_notification_without_aborting_sibling() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        let store = test_store();
        let run = SessionRunId::new();
        let cancelled = key(&run, "cancelled", "dispatch-a", "call-a");
        let sibling = key(&run, "sibling", "dispatch-b", "call-b");
        assert!(registry
            .try_accept_batch(vec![cancelled.clone(), sibling.clone()])
            .into_iter()
            .all(|accepted| accepted));
        let coordinator = tokio::spawn(pending::<()>());
        assert!(registry.attach_coordinator(&cancelled, coordinator.abort_handle()));
        assert!(registry.attach_coordinator(&sibling, coordinator.abort_handle()));

        let outcome = tokio::time::timeout(
            Duration::from_secs(1),
            registry.cancel_and_drain(&store, "session", &cancelled),
        )
        .await
        .expect("pending exact cancellation did not drain")
        .unwrap();
        assert_eq!(outcome.0, ThreadCancelOutcome::CancelRequested);
        assert_eq!(outcome.1.len(), 1);
        assert!(!coordinator.is_finished());
        assert!(registry.matches(&sibling));
        assert_eq!(
            registry.request_cancel(&cancelled).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Cancelled)
        );
        coordinator.abort();
        let _ = coordinator.await;
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn exact_cancel_signals_worker_without_aborting_shared_coordinator() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let cancelled = key(&run, "cancelled", "dispatch-a", "call-a");
        let sibling = key(&run, "sibling", "dispatch-b", "call-b");
        assert!(registry
            .try_accept_batch(vec![cancelled.clone(), sibling.clone()])
            .iter()
            .all(|v| *v));
        let coordinator = tokio::spawn(pending::<()>());
        assert!(registry.attach_coordinator(&cancelled, coordinator.abort_handle()));
        assert!(registry.attach_coordinator(&sibling, coordinator.abort_handle()));
        assert_eq!(
            registry.request_cancel(&cancelled).unwrap(),
            ThreadCancelOutcome::CancelRequested
        );
        tokio::task::yield_now().await;
        assert!(!coordinator.is_finished());
        assert!(registry.matches(&sibling));
        coordinator.abort();
        let _ = coordinator.await;
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn cancellation_before_natural_finalizer_resolves_cancelled() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let dispatch = key(&run, "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::CancelRequested
        );
        let finalized = registry
            .finalize_once(
                &store,
                "session",
                completion(dispatch.clone(), "natural result"),
                crate::events::ThreadDispatchStatus::Completed,
                None,
                true,
            )
            .unwrap()
            .unwrap();
        assert_eq!(
            finalized.status,
            crate::events::ThreadDispatchStatus::Cancelled
        );
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Cancelled)
        );
        let completions = registry.take_completions(&HashSet::new(), &HashSet::new());
        assert_eq!(completions.len(), 1);
        assert!(completions[0].is_error);
        assert!(completions[0].content.contains("was cancelled"));
        assert!(completions[0].content.contains(dispatch.run_id.as_str()));
        assert!(completions[0].content.contains(&dispatch.dispatch_id));
        assert!(completions[0].content.contains(&dispatch.tool_call_id));
        assert_eq!(finalized.completion, completions[0]);
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn concurrent_cancel_and_natural_finalize_has_one_linearized_terminal_owner() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        let store = test_store();
        let run = SessionRunId::new();
        let dispatch = key(&run, "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        let barrier = Arc::new(std::sync::Barrier::new(3));

        let cancel_registry = registry.clone();
        let cancel_key = dispatch.clone();
        let cancel_barrier = barrier.clone();
        let cancel = std::thread::spawn(move || {
            cancel_barrier.wait();
            cancel_registry.request_cancel(&cancel_key).unwrap()
        });
        let finalize_registry = registry.clone();
        let finalize_key = dispatch.clone();
        let finalize_store = store.clone();
        let finalize_barrier = barrier.clone();
        let finalize = std::thread::spawn(move || {
            finalize_barrier.wait();
            finalize_registry
                .finalize_once(
                    &finalize_store,
                    "session",
                    completion(finalize_key, "natural result"),
                    crate::events::ThreadDispatchStatus::Completed,
                    None,
                    true,
                )
                .unwrap()
        });
        barrier.wait();
        let cancel_outcome = cancel.join().unwrap();
        let finalization = finalize.join().unwrap().unwrap();
        let expected = match cancel_outcome {
            ThreadCancelOutcome::CancelRequested => crate::events::ThreadDispatchStatus::Cancelled,
            ThreadCancelOutcome::AlreadyTerminal(status) => status,
            outcome => panic!("unexpected cancel race outcome: {outcome:?}"),
        };
        assert_eq!(finalization.status, expected);
        let completions = registry.take_completions(&HashSet::new(), &HashSet::new());
        assert_eq!(completions.len(), 1);
        if expected == crate::events::ThreadDispatchStatus::Cancelled {
            assert!(finalization.completion.is_error);
            assert!(finalization.completion.content.contains("was cancelled"));
            assert!(finalization
                .completion
                .content
                .contains(dispatch.run_id.as_str()));
            assert_eq!(finalization.completion, completions[0]);
        } else {
            assert!(!completions[0].is_error);
            assert_eq!(completions[0].content, "natural result");
        }
        assert!(!registry.matches(&dispatch));
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn steering_store_failure_does_not_strand_terminal_dispatch() {
        let registry = ActiveThreadRegistry::default();
        let run = SessionRunId::from_string("foreground-compat".to_string());
        let dispatch = key(&run, "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        let invalid_store = std::env::temp_dir();
        let outcome = registry
            .finalize_once(
                &invalid_store,
                "session",
                completion(dispatch.clone(), "done"),
                crate::events::ThreadDispatchStatus::Completed,
                None,
                true,
            )
            .unwrap()
            .unwrap();
        assert!(outcome.steering_error.is_some());
        assert!(!registry.matches(&dispatch));
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Completed)
        );
        assert_eq!(
            registry
                .take_completions(&HashSet::new(), &HashSet::new())
                .len(),
            1
        );
    }

    #[test]
    fn cancel_timeout_and_failure_partial_usage_is_finalized_exactly_once() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let usage = crate::model::TokenUsage {
            input_tokens: 5,
            output_tokens: 2,
            ..Default::default()
        };
        let cases = [
            ("cancelled-worker", "cancel-dispatch", true),
            ("timed-out-worker", "timeout-dispatch", false),
            ("failed-worker", "failure-dispatch", false),
        ];
        for (name, dispatch_id, cancel_first) in cases {
            let dispatch = key(&SessionRunId::new(), name, dispatch_id, "call");
            assert!(registry.try_accept(dispatch.clone()));
            if cancel_first {
                assert_eq!(
                    registry.request_cancel(&dispatch).unwrap(),
                    ThreadCancelOutcome::CancelRequested
                );
            }
            let requested_status = if cancel_first {
                crate::events::ThreadDispatchStatus::Completed
            } else {
                crate::events::ThreadDispatchStatus::Failed
            };
            assert!(registry
                .finalize_once(
                    &store,
                    "session",
                    completion(dispatch.clone(), "partial result"),
                    requested_status,
                    Some(&usage),
                    true,
                )
                .unwrap()
                .is_some());
            assert!(registry
                .finalize_once(
                    &store,
                    "session",
                    completion(dispatch, "duplicate"),
                    requested_status,
                    Some(&usage),
                    true,
                )
                .unwrap()
                .is_none());
        }

        let rows = crate::store::load_session_worker_usage(&store, "session").unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows.iter()
                .filter(|row| row.terminal_status == Some(crate::events::ThreadDispatchStatus::Cancelled))
                .count(),
            1
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.terminal_status == Some(crate::events::ThreadDispatchStatus::Failed))
                .count(),
            2
        );
        let total = crate::store::aggregate_session_worker_usage(&store, "session")
            .unwrap()
            .unwrap();
        assert_eq!(total.input_tokens, 15);
        assert_eq!(total.output_tokens, 6);
        assert_eq!(
            registry
                .take_completions(&HashSet::new(), &HashSet::new())
                .len(),
            3
        );
        let _ = std::fs::remove_file(store);
    }

    #[test]
    fn worker_usage_store_failure_prevents_terminal_publication() {
        let registry = ActiveThreadRegistry::default();
        let dispatch = key(&SessionRunId::new(), "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        let result = registry.finalize_once(
            &std::env::temp_dir(),
            "session",
            completion(dispatch.clone(), "done"),
            crate::events::ThreadDispatchStatus::Completed,
            None,
            true,
        );
        assert!(result.is_err());
        assert!(registry.matches(&dispatch));
        assert!(registry
            .take_completions(&HashSet::new(), &HashSet::new())
            .is_empty());
    }

    #[test]
    fn natural_completion_wins_cancel_race_exactly_once() {
        let registry = ActiveThreadRegistry::default();
        let store = test_store();
        let run = SessionRunId::new();
        let dispatch = key(&run, "worker", "dispatch", "call");
        assert!(registry.try_accept(dispatch.clone()));
        assert!(registry
            .finalize_once(
                &store,
                "session",
                completion(dispatch.clone(), "done"),
                crate::events::ThreadDispatchStatus::Completed,
                None,
                true,
            )
            .unwrap()
            .is_some());
        assert_eq!(
            registry.request_cancel(&dispatch).unwrap(),
            ThreadCancelOutcome::AlreadyTerminal(crate::events::ThreadDispatchStatus::Completed)
        );
        assert!(registry
            .finalize_once(
                &store,
                "session",
                completion(dispatch, "duplicate"),
                crate::events::ThreadDispatchStatus::Cancelled,
                None,
                true,
            )
            .unwrap()
            .is_none());
        assert_eq!(
            registry
                .take_completions(&HashSet::new(), &HashSet::new())
                .len(),
            1
        );
        let _ = std::fs::remove_file(store);
    }

    #[tokio::test]
    async fn notify_and_live_mode_default_are_observable() {
        let registry = Arc::new(ActiveThreadRegistry::default());
        assert!(!registry.live_thread_updates());
        let waiter_registry = registry.clone();
        let waiter = tokio::spawn(async move { waiter_registry.wait_for_activity().await });
        tokio::task::yield_now().await;
        registry.set_live_thread_updates(true);
        tokio::time::timeout(Duration::from_secs(1), waiter)
            .await
            .unwrap()
            .unwrap();
        assert!(registry.live_thread_updates());
    }

    #[tokio::test]
    async fn drop_is_a_synchronous_abort_fallback() {
        let run = SessionRunId::new();
        let task = tokio::spawn(pending::<()>());
        {
            let registry = ActiveThreadRegistry::default();
            let key = key(&run, "worker", "dispatch", "call");
            assert!(registry.try_accept(key.clone()));
            assert!(registry.attach_worker(&key, task.abort_handle()));
        }
        assert!(task.await.unwrap_err().is_cancelled());
    }
}

#[cfg(test)]
mod file_lock_tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    #[test]
    fn file_lock_process_helper() {
        let Some(target) = std::env::var_os("NAC_TEST_FILE_LOCK_TARGET") else {
            return;
        };
        let ready = PathBuf::from(std::env::var_os("NAC_TEST_FILE_LOCK_READY").unwrap());
        let locked = OpenOptions::new()
            .write(true)
            .create(true)
            .open(Path::new(&target))
            .unwrap();
        FileExt::lock_exclusive(&locked).unwrap();
        std::fs::write(ready, b"ready").unwrap();
        thread::sleep(Duration::from_secs(30));
    }

    #[tokio::test]
    async fn mutation_locks_are_cross_process_and_per_file() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "nac_file_mutation_lock_{}_{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("target.txt");
        let unrelated = dir.join("unrelated.txt");
        let ready = dir.join("ready");

        let mut child = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::file_lock_tests::file_lock_process_helper",
                "--nocapture",
            ])
            .env("NAC_TEST_FILE_LOCK_TARGET", &target)
            .env("NAC_TEST_FILE_LOCK_READY", &ready)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();

        for _ in 0..200 {
            if ready.exists() {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "file-lock helper exited early"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert!(ready.exists(), "file-lock helper never became ready");

        let same_file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&target)
            .unwrap();
        let contention = FileExt::try_lock_exclusive(&same_file);
        assert!(
            matches!(contention, Err(error) if error.kind() == io::ErrorKind::WouldBlock),
            "same file should be locked by the other process"
        );

        let unrelated_file = open_locked_file(unrelated, true, FileLockAccess::Write)
            .await
            .expect("an unrelated file must remain independently lockable");

        child.kill().unwrap();
        child.wait().unwrap();
        FileExt::try_lock_exclusive(&same_file)
            .expect("the target lock should be released when its process exits");

        drop(same_file);
        drop(unrelated_file);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn cancelling_a_waiter_releases_it_without_delayed_acquisition() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_cancelled_file_lock_{}_{unique}",
            std::process::id()
        ));
        let held = open_locked_file(path.clone(), true, FileLockAccess::Write)
            .await
            .unwrap();

        let waiter_path = path.clone();
        let waiter = tokio::spawn(async move {
            open_locked_file(waiter_path, true, FileLockAccess::Write).await
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        drop(held);

        let reacquired = tokio::time::timeout(
            Duration::from_secs(1),
            open_locked_file(path.clone(), true, FileLockAccess::Write),
        )
        .await
        .expect("a cancelled waiter must not acquire the lock later")
        .unwrap();
        drop(reacquired);
        let _ = std::fs::remove_file(path);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_file_open_never_follows_a_symlinked_parent() {
        use std::os::unix::fs::symlink;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nac_mounted_file_open_{}_{unique}",
            std::process::id()
        ));
        let mount_root = root.join("mount");
        let outside = root.join("outside");
        std::fs::create_dir_all(&mount_root).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, mount_root.join("escape")).unwrap();

        let opened = open_locked_file_beneath(
            mount_root,
            PathBuf::from("escape/file.txt"),
            true,
            true,
            FileLockAccess::Write,
        )
        .await
        .unwrap();

        assert!(opened.is_none());
        assert!(!outside.join("file.txt").exists());
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn mounted_file_open_supports_a_single_file_mount_root() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "nac_single_file_mount_{}_{unique}.txt",
            std::process::id()
        ));
        std::fs::write(&path, "before").unwrap();

        let opened = open_locked_file_beneath(
            path.clone(),
            PathBuf::new(),
            true,
            true,
            FileLockAccess::Write,
        )
        .await;

        let _ = std::fs::remove_file(path);
        assert!(matches!(opened, Ok(Some(_))));
    }
}
