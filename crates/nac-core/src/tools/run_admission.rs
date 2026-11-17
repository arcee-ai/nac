use super::*;

#[path = "worker_dispatch.rs"]
mod worker_dispatch;
use worker_dispatch::{ActiveThreadDispatchState, WorkerDispatches};

struct RunAdmissionState {
    workers: WorkerDispatches,
    cancellation: RunCancellation,
    accepting: bool,
    run_id: Option<String>,
}

impl Default for RunAdmissionState {
    fn default() -> Self {
        Self {
            workers: WorkerDispatches::default(),
            cancellation: RunCancellation::default(),
            accepting: true,
            run_id: None,
        }
    }
}

pub struct RunAdmission {
    state: StdMutex<RunAdmissionState>,
    activity: Notify,
}

impl Default for RunAdmission {
    fn default() -> Self {
        Self {
            state: StdMutex::new(RunAdmissionState::default()),
            activity: Notify::new(),
        }
    }
}

impl RunAdmission {
    pub(crate) fn run_id(&self) -> Option<String> {
        self.lock().run_id.clone()
    }

    pub fn begin_run(&self, run_id: &str) -> bool {
        let mut state = self.lock();
        if !state.workers.entries.is_empty() {
            return false;
        }
        state.cancellation = RunCancellation::default();
        state.accepting = true;
        state.run_id = Some(run_id.to_string());
        true
    }

    pub async fn cancel_and_drain(
        &self,
        steering_store: Option<(&Path, &str)>,
    ) -> anyhow::Result<Vec<crate::store::ThreadSteeringRecord>> {
        let (cancellation, targets) = {
            let mut state = self.lock();
            state.accepting = false;
            let cancellation = state.cancellation.clone();
            let targets = state
                .workers
                .entries
                .values()
                .map(|dispatch| dispatch.dispatch_id.clone())
                .collect::<Vec<_>>();
            state
                .workers
                .entries
                .retain(|_, dispatch| dispatch.state == ActiveThreadDispatchState::Running);
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
        self.lock().run_id = None;

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
        state.accepting = false;
        state.cancellation.cancel();
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
            }
        }
        state.run_id = None;
        drop(state);
        self.activity.notify_waiters();
        Ok(expired)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RunAdmissionState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod active_thread_registry_tests {
    use super::*;

    #[tokio::test]
    async fn direct_run_binding_retires_before_successor_admission() {
        let admission = RunAdmission::default();
        assert!(admission.begin_run("run-1"));
        assert_eq!(admission.run_id().as_deref(), Some("run-1"));
        admission.cancel_and_drain(None).await.unwrap();
        assert_eq!(admission.run_id(), None);
        assert!(admission.begin_run("run-2"));
        assert_eq!(admission.run_id().as_deref(), Some("run-2"));
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
        let registry = Arc::new(RunAdmission::default());
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
        let registry = RunAdmission::default();
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

    #[tokio::test]
    async fn stale_run_cannot_steer_same_name_replacement() {
        let root =
            std::env::temp_dir().join(format!("nac-thread-generation-{}", uuid::Uuid::new_v4()));
        let store = root.join("store.db");
        crate::store::initialize(&store).unwrap();
        crate::store::insert_test_session(&store, "session");
        let registry = RunAdmission::default();

        assert!(registry.begin_run("run-1"));
        assert!(registry.mark("worker", "dispatch-1"));
        registry
            .close(&store, "session", "worker", "dispatch-1")
            .unwrap();
        registry.cancel_and_drain(None).await.unwrap();
        assert!(registry.begin_run("run-2"));
        assert!(registry.mark("worker", "dispatch-2"));

        assert!(registry
            .queue(
                &store,
                "session",
                "worker",
                "belongs to run one",
                Some("run-1"),
                crate::store::InputOrigin::Automation,
            )
            .unwrap()
            .is_none());
        assert!(crate::store::list_thread_steering(&store, "session")
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(root);
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
