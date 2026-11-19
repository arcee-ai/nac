use super::run_admission::{RunAdmission, RunAdmissionState};
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ActiveThreadDispatchState {
    Pending,
    Running,
}

struct ActiveThreadDispatch {
    dispatch_id: String,
    state: ActiveThreadDispatchState,
}

#[derive(Default)]
struct WorkerDispatches {
    entries: HashMap<String, ActiveThreadDispatch>,
}

pub struct WorkerDispatchRegistry {
    admission: Arc<RunAdmission>,
    workers: StdMutex<WorkerDispatches>,
    activity: Notify,
}

impl Default for WorkerDispatchRegistry {
    fn default() -> Self {
        Self::new(Arc::new(RunAdmission::default()))
    }
}

struct WorkerGuard<'a> {
    run: std::sync::MutexGuard<'a, RunAdmissionState>,
    workers: std::sync::MutexGuard<'a, WorkerDispatches>,
}

impl WorkerDispatchRegistry {
    pub(crate) fn new(admission: Arc<RunAdmission>) -> Self {
        Self {
            admission,
            workers: StdMutex::new(WorkerDispatches::default()),
            activity: Notify::new(),
        }
    }
    #[cfg(test)]
    pub(crate) fn admission(&self) -> Arc<RunAdmission> {
        Arc::clone(&self.admission)
    }
    fn lock(&self) -> WorkerGuard<'_> {
        // Every worker operation takes the generation gate first. The count
        // and worker map therefore change together with respect to direct runs.
        let run = self.admission.lock();
        let workers = self
            .workers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        WorkerGuard { run, workers }
    }
    pub(crate) fn run_id(&self) -> Option<String> {
        self.lock().run.run_id.clone()
    }

    #[cfg(test)]
    pub fn begin_run(&self, run_id: &str) -> bool {
        self.admission.begin_run(run_id)
    }

    pub async fn cancel_and_drain(
        &self,
        steering_store: Option<(&Path, &str)>,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let (cancellation, targets) = {
            let mut state = self.lock();
            state.run.accepting = false;
            let cancellation = state.run.cancellation.clone();
            let targets = state
                .workers
                .entries
                .values()
                .map(|dispatch| dispatch.dispatch_id.clone())
                .collect::<Vec<_>>();
            let before = state.workers.entries.len();
            state
                .workers
                .entries
                .retain(|_, dispatch| dispatch.state == ActiveThreadDispatchState::Running);
            state.run.in_flight -= before - state.workers.entries.len();
            (cancellation, targets)
        };
        let owned = steering_store.is_some_and(|(path, _)| {
            crate::store::coordinator::owner_for(path)
                .map(|owner| owner.is_some())
                .unwrap_or(true)
        });
        if owned {
            cancellation.cancel_async().await;
        } else {
            cancellation.cancel();
        }
        self.activity.notify_waiters();

        let mut expired = Vec::new();
        let mut steering_error = None;
        if let Some((store_path, session_id)) = steering_store {
            for dispatch_id in &targets {
                let expiry = match crate::store::coordinator::owner_for(store_path)? {
                    Some(owner) => {
                        owner
                            .expire_thread_steering(session_id.to_owned(), dispatch_id.clone())
                            .await
                    }
                    None => {
                        crate::store::expire_thread_steering(store_path, session_id, dispatch_id)
                    }
                };
                match expiry {
                    Ok(records) => expired.extend(records),
                    Err(error) if steering_error.is_none() => steering_error = Some(error),
                    Err(_) => {}
                }
            }
        }

        loop {
            let notified = self.activity.notified();
            if self.lock().workers.entries.is_empty() {
                break;
            }
            notified.await;
        }
        self.lock().run.run_id = None;

        match steering_error {
            Some(error) => Err(error),
            None => Ok(expired),
        }
    }

    pub fn close_all(
        &self,
        store_path: &Path,
        session_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let mut state = self.lock();
        state.run.accepting = false;
        state.run.cancellation.cancel();
        let targets = state
            .workers
            .entries
            .iter()
            .map(|(name, dispatch)| (name.clone(), dispatch.dispatch_id.clone()))
            .collect::<Vec<_>>();
        let mut expired = Vec::new();
        for (name, dispatch_id) in targets {
            expired.extend(crate::store::expire_thread_steering(
                store_path,
                session_id,
                &dispatch_id,
            )?);
            if state
                .workers
                .entries
                .get(&name)
                .is_some_and(|dispatch| dispatch.dispatch_id == dispatch_id)
            {
                state.workers.entries.remove(&name);
                state.run.in_flight -= 1;
            }
        }
        state.run.run_id = None;
        drop(state);
        self.activity.notify_waiters();
        Ok(expired)
    }

    pub fn names(&self) -> Vec<String> {
        self.lock().workers.entries.keys().cloned().collect()
    }

    pub fn is_active(&self, thread_name: &str) -> bool {
        self.lock().workers.entries.contains_key(thread_name)
    }

    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let mut state = self.lock();
        if !state.run.accepting || state.workers.entries.contains_key(thread_name) {
            return false;
        }
        state.run.in_flight += 1;
        state.workers.entries.insert(
            thread_name.to_string(),
            ActiveThreadDispatch {
                dispatch_id: dispatch_id.to_string(),
                state: ActiveThreadDispatchState::Pending,
            },
        );
        true
    }

    pub(crate) fn start(&self, thread_name: &str, dispatch_id: &str) -> Option<RunCancellation> {
        let mut state = self.lock();
        if !state.run.accepting || state.run.cancellation.is_cancelled() {
            return None;
        }
        let cancellation = state.run.cancellation.clone();
        let dispatch = state.workers.entries.get_mut(thread_name)?;
        if dispatch.dispatch_id != dispatch_id
            || dispatch.state != ActiveThreadDispatchState::Pending
        {
            return None;
        }
        dispatch.state = ActiveThreadDispatchState::Running;
        Some(cancellation)
    }

    #[cfg(test)]
    pub fn close(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        dispatch_id: &str,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        if !self.close_local(thread_name, dispatch_id) {
            return Ok(Vec::new());
        }
        crate::store::expire_thread_steering(store_path, session_id, dispatch_id)
    }

    /// Mandatory process-local completion cannot depend on persistence admission.
    /// Match the exact dispatch before notifying cancellation waiters.
    pub(crate) fn close_local(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let mut state = self.lock();
        if state
            .workers
            .entries
            .get(thread_name)
            .map(|dispatch| dispatch.dispatch_id.as_str())
            != Some(dispatch_id)
        {
            return false;
        }
        state.workers.entries.remove(thread_name);
        state.run.in_flight -= 1;
        drop(state);
        self.activity.notify_waiters();
        true
    }
}

#[cfg(test)]
mod active_thread_registry_tests {
    use super::*;

    #[tokio::test]
    async fn worker_registry_run_binding_retires_before_successor_admission() {
        let admission = WorkerDispatchRegistry::default();
        assert!(admission.begin_run("run-1"));
        assert_eq!(admission.run_id().as_deref(), Some("run-1"));
        admission.cancel_and_drain(None).await.unwrap();
        assert_eq!(admission.run_id(), None);
        assert!(admission.begin_run("run-2"));
        assert_eq!(admission.run_id().as_deref(), Some("run-2"));
    }

    #[test]
    fn worker_registration_holds_run_gate_until_count_is_published() {
        let registry = Arc::new(WorkerDispatchRegistry::default());
        let admission = registry.admission();
        assert!(admission.begin_run("first"));
        // Stall registration after it takes the run gate but before it can
        // publish the worker entry. A successor must wait for that decision.
        let workers = registry.workers.lock().unwrap();
        let registering = {
            let registry = registry.clone();
            std::thread::spawn(move || registry.mark("worker", "dispatch"))
        };
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while admission.try_lock_for_test() {
            assert!(
                std::time::Instant::now() < deadline,
                "registration did not acquire run gate"
            );
            std::thread::yield_now();
        }
        let (tx, rx) = std::sync::mpsc::channel();
        let starting = std::thread::spawn(move || tx.send(admission.begin_run("second")).unwrap());
        assert!(rx.recv_timeout(Duration::from_millis(25)).is_err());
        drop(workers);
        assert!(registering.join().unwrap());
        assert!(!rx.recv_timeout(Duration::from_secs(2)).unwrap());
        starting.join().unwrap();
    }

    #[tokio::test]
    async fn shared_admission_counts_pending_and_running_until_exact_retirement() {
        let registry = Arc::new(WorkerDispatchRegistry::default());
        let admission = registry.admission();
        assert!(admission.begin_run("first"));
        assert!(registry.mark("running", "one"));
        assert!(registry.mark("pending", "two"));
        registry.start("running", "one").unwrap();
        assert!(!admission.begin_run("second"));
        assert!(!registry.close_local("running", "stale"));
        let draining = {
            let registry = registry.clone();
            tokio::spawn(async move { registry.cancel_and_drain(None).await.unwrap() })
        };
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if !registry.is_active("pending") {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(!admission.begin_run("second"));
        assert!(registry.close_local("running", "one"));
        draining.await.unwrap();
        assert!(admission.begin_run("second"));
    }

    #[test]
    fn child_cancellation_is_local_and_parent_cancellation_propagates() {
        let parent = RunCancellation::default();
        let first = parent.child();
        let second = parent.child();
        first.cancel();
        assert!(first.is_cancelled());
        assert!(!parent.is_cancelled());
        assert!(!second.is_cancelled());
        parent.cancel();
        assert!(second.is_cancelled());
    }

    #[test]
    fn parent_and_child_share_the_final_synchronous_admission_gate() {
        let parent = RunCancellation::default();
        let child = parent.child();
        assert_eq!(child.run_if_active(|| 7), Some(7));
        parent.cancel();
        assert_eq!(child.run_if_active(|| 9), None);
    }

    #[tokio::test]
    async fn cancellation_drains_running_dispatches_and_rejects_pending_work() {
        let registry = Arc::new(WorkerDispatchRegistry::default());
        assert!(registry.begin_run("run-1"));
        assert!(registry.mark("a", "dispatch-a"));
        assert!(registry.mark("b", "dispatch-b"));
        assert!(registry.mark("dependent", "dispatch-c"));
        let cancellation_a = registry.start("a", "dispatch-a").unwrap();
        let cancellation_b = registry.start("b", "dispatch-b").unwrap();

        let cancelling_registry = registry.clone();
        let cancelling = tokio::spawn(async move {
            cancelling_registry.cancel_and_drain(None).await.unwrap();
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            cancellation_a.cancelled().await;
            cancellation_b.cancelled().await;
        })
        .await
        .expect("running dispatches did not receive cancellation");

        assert!(registry.start("dependent", "dispatch-c").is_none());
        assert!(!registry.is_active("dependent"));
        assert!(!cancelling.is_finished());

        let missing = Path::new("/store/does/not/exist");
        assert!(registry
            .close(missing, "session", "a", "dispatch-a")
            .is_err());
        assert!(registry
            .close(missing, "session", "b", "dispatch-b")
            .is_err());
        tokio::time::timeout(Duration::from_secs(1), cancelling)
            .await
            .expect("cancellation did not drain")
            .unwrap();

        assert!(registry.names().is_empty());
        registry.cancel_and_drain(None).await.unwrap();
    }

    #[test]
    fn stale_close_cannot_remove_same_name_replacement() {
        let registry = WorkerDispatchRegistry::default();
        assert!(registry.begin_run("run-1"));
        assert!(registry.mark("worker", "dispatch-old"));
        let missing = Path::new("/store/does/not/exist");
        assert!(registry
            .close(missing, "session", "worker", "dispatch-old")
            .is_err());

        assert!(registry.begin_run("run-2"));
        assert!(registry.mark("worker", "dispatch-new"));
        assert!(registry
            .close(missing, "session", "worker", "dispatch-old")
            .unwrap()
            .is_empty());
        assert!(registry.is_active("worker"));
    }

    #[test]
    fn workspace_gate_is_shared_by_sessions_using_the_same_store_and_checkout() {
        let shared_a = shared_workspace_gate_for(
            Path::new("/tmp/nac-shared-store"),
            Path::new("/tmp/nac-shared-workspace"),
        );
        let shared_b = shared_workspace_gate_for(
            Path::new("/tmp/nac-shared-store"),
            Path::new("/tmp/nac-shared-workspace"),
        );
        let other_workspace = shared_workspace_gate_for(
            Path::new("/tmp/nac-shared-store"),
            Path::new("/tmp/nac-other-workspace"),
        );

        assert!(Arc::ptr_eq(&shared_a, &shared_b));
        assert!(!Arc::ptr_eq(&shared_a, &other_workspace));
    }
}
