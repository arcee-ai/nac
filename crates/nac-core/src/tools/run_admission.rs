use super::*;

pub(super) struct RunAdmissionState {
    pub(super) cancellation: RunCancellation,
    pub(super) accepting: bool,
    pub(super) run_id: Option<String>,
}

impl Default for RunAdmissionState {
    fn default() -> Self {
        Self {
            cancellation: RunCancellation::default(),
            accepting: true,
            run_id: None,
        }
    }
}

#[derive(Default)]
pub(crate) struct RunAdmission {
    state: StdMutex<RunAdmissionState>,
}

impl RunAdmission {
    pub(crate) fn run_id(&self) -> Option<String> {
        self.lock().run_id.clone()
    }

    pub(super) fn lock(&self) -> std::sync::MutexGuard<'_, RunAdmissionState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub(crate) fn begin_run(&self, run_id: &str) -> bool {
        let mut state = self.lock();
        state.cancellation = RunCancellation::default();
        state.accepting = true;
        state.run_id = Some(run_id.to_owned());
        true
    }

    pub(crate) async fn cancel_and_retire(&self, owned: bool) {
        let cancellation = {
            let mut state = self.lock();
            state.accepting = false;
            state.cancellation.clone()
        };
        if owned {
            cancellation.cancel_async().await;
        } else {
            cancellation.cancel();
        }
        self.lock().run_id = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn direct_run_retires_before_successor() {
        let admission = RunAdmission::default();
        assert!(admission.begin_run("first"));
        assert_eq!(admission.lock().run_id.as_deref(), Some("first"));
        admission.cancel_and_retire(false).await;
        assert!(admission.lock().run_id.is_none());
        assert!(admission.begin_run("second"));
        assert_eq!(admission.lock().run_id.as_deref(), Some("second"));
    }
}
