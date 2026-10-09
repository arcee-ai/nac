//! Cached-source preview and identified inbox admission; drafts remain local.
use super::{
    persistence::OperationSessionScope, terminal_observation::TerminalApplicationError as Error,
};
use crate::SessionManager;
use nac_core::session_service::{TerminalSelectionError, UserTerminalSelectionPreview};
use nac_core::store::{
    TerminalSelectionAdmissionError, TerminalSelectionIntent, TerminalSelectionReceipt,
};
use std::sync::{Arc, LazyLock};
use tokio::sync::Semaphore;

// Dropping a request cannot release its accepted operation's guards. Bound
// detached creator jobs so cancellation cannot create an unlimited task queue.
static ADMISSIONS: LazyLock<Arc<Semaphore>> = LazyLock::new(|| Arc::new(Semaphore::new(32)));

#[cfg(test)]
pub(crate) fn active_admission_jobs_for_test() -> usize {
    32 - ADMISSIONS.available_permits()
}

pub(crate) struct TerminalSelectionSubmission {
    pub intent: TerminalSelectionIntent,
    pub original_selected_text: String,
    pub original_user_text: Option<String>,
}
pub(crate) struct TerminalSelectionApplication<'a> {
    manager: &'a SessionManager,
}
impl<'a> TerminalSelectionApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }
    pub(crate) async fn preview(
        &self,
        session: &str,
        terminal: &str,
        text: &str,
        user_text: Option<&str>,
    ) -> Result<UserTerminalSelectionPreview, Error> {
        let gate = self.manager.lifecycle_gate(session);
        let _lifecycle = gate.lock().await;
        self.manager
            .validate_operation_session(session, OperationSessionScope::Direct)
            .await
            .map_err(|_| Error::Unavailable)?;
        let service = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session)
            .cloned()
            .ok_or(Error::Unavailable)?;
        service
            .preview_user_terminal_selection_with_text(terminal, text, user_text)
            .await
            .map_err(|error| match error {
                TerminalSelectionError::Invalid(message) => Error::Invalid(message),
                TerminalSelectionError::Unavailable => Error::Unavailable,
            })
    }
    pub(crate) async fn submit(
        &self,
        submission: TerminalSelectionSubmission,
    ) -> Result<TerminalSelectionReceipt, Error> {
        let permit = ADMISSIONS
            .clone()
            .try_acquire_owned()
            .map_err(|_| Error::Busy)?;
        let manager = self.manager.clone();
        // The owned job retains lifecycle, host and work admission through
        // commit and creator-only wake even if the HTTP caller disconnects.
        tokio::spawn(async move {
            let _permit = permit;
            let intent = submission.intent;
            let gate = manager.lifecycle_gate(&intent.source_session_id);
            let _lifecycle = gate.lock_owned().await;
            let _host_access = manager
                .managed_completion_admission_async()
                .await
                .map_err(Error::Internal)?;
            manager
                .validate_operation_session(
                    &intent.source_session_id,
                    OperationSessionScope::Direct,
                )
                .await
                .map_err(|_| Error::Unavailable)?;
            let known = if let Some(owner) = manager.inner._store_ownership.coordinator() {
                owner.load_terminal_selection_receipt(intent.clone()).await
            } else {
                let path = manager.inner.store_path.clone();
                let lookup = intent.clone();
                nac_core::store::spawn_blocking_store_caller(move || {
                    nac_core::store::load_terminal_selection_receipt(&path, &lookup)
                })
                .await
                .map_err(Error::Internal)?
            }
            .map_err(admission_error)?;
            if let Some(known) = known {
                return Ok(known);
            }
            let _new_work = manager
                .managed_work_admission_async()
                .await
                .map_err(Error::Internal)?;
            let service = manager
                .inner
                .active_sessions
                .read()
                .await
                .get(&intent.source_session_id)
                .cloned()
                .ok_or(Error::Unavailable)?;
            let preview = service
                .preview_user_terminal_selection_with_text(
                    &intent.terminal_id,
                    &submission.original_selected_text,
                    submission.original_user_text.as_deref(),
                )
                .await
                .map_err(|error| match error {
                    TerminalSelectionError::Invalid(message) => Error::Invalid(message),
                    TerminalSelectionError::Unavailable => Error::Unavailable,
                })?;
            if preview.owner_instance_id != intent.owner_instance_id
                || preview.text != intent.text
                || preview.user_text != intent.user_text
            {
                return Err(Error::Rejected(
                    TerminalSelectionAdmissionError::PreviewChanged.to_string(),
                ));
            }
            service
                .admit_terminal_selection_intent(intent)
                .await
                .map_err(admission_error)
        })
        .await
        .map_err(|error| Error::Internal(error.into()))?
    }
}
fn admission_error(error: anyhow::Error) -> Error {
    match error.downcast_ref::<TerminalSelectionAdmissionError>() {
        Some(TerminalSelectionAdmissionError::Unavailable) => Error::Unavailable,
        Some(TerminalSelectionAdmissionError::Invalid) => {
            Error::Invalid("invalid terminal selection intent")
        }
        Some(error) => Error::Rejected(error.to_string()),
        None => Error::Internal(error),
    }
}
