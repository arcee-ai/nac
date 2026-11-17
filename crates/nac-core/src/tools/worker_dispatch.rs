use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ActiveThreadDispatchState {
    Pending,
    Running,
}

pub(super) struct ActiveThreadDispatch {
    pub(super) dispatch_id: String,
    pub(super) state: ActiveThreadDispatchState,
}

#[derive(Default)]
pub(super) struct WorkerDispatches {
    pub(super) entries: HashMap<String, ActiveThreadDispatch>,
}

impl RunAdmission {
    pub fn names(&self) -> Vec<String> {
        self.lock().workers.entries.keys().cloned().collect()
    }

    pub fn is_active(&self, thread_name: &str) -> bool {
        self.lock().workers.entries.contains_key(thread_name)
    }

    pub fn mark(&self, thread_name: &str, dispatch_id: &str) -> bool {
        let mut state = self.lock();
        if !state.accepting || state.workers.entries.contains_key(thread_name) {
            return false;
        }
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
        if !state.accepting || state.cancellation.is_cancelled() {
            return None;
        }
        let dispatch = state.workers.entries.get_mut(thread_name)?;
        if dispatch.dispatch_id != dispatch_id
            || dispatch.state != ActiveThreadDispatchState::Pending
        {
            return None;
        }
        dispatch.state = ActiveThreadDispatchState::Running;
        Some(state.cancellation.clone())
    }

    pub fn queue(
        &self,
        store_path: &Path,
        session_id: &str,
        thread_name: &str,
        instruction: &str,
        expected_run_id: Option<&str>,
        origin: crate::store::InputOrigin,
    ) -> anyhow::Result<Option<crate::store::ThreadSteeringRecord>> {
        let state = self.lock();
        if expected_run_id.is_some() && state.run_id.as_deref() != expected_run_id {
            return Ok(None);
        }
        let Some(dispatch) = state.workers.entries.get(thread_name) else {
            return Ok(None);
        };
        match origin {
            crate::store::InputOrigin::Person => crate::store::queue_person_thread_steering(
                store_path,
                session_id,
                thread_name,
                &dispatch.dispatch_id,
                instruction,
            ),
            crate::store::InputOrigin::Automation => crate::store::queue_thread_steering(
                store_path,
                session_id,
                thread_name,
                &dispatch.dispatch_id,
                instruction,
            ),
        }
        .map(Some)
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
        drop(state);
        self.activity.notify_waiters();
        true
    }
}
