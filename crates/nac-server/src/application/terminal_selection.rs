//! Finite selection preview only: cached source ownership, never fresh session
//! attachment/resumption or durable input admission.
use super::{persistence::OperationSessionScope, terminal_observation::TerminalApplicationError};
use crate::SessionManager;
use nac_core::session_service::{TerminalSelectionError, UserTerminalSelectionPreview};

pub(crate) struct TerminalSelectionApplication<'a> {
    manager: &'a SessionManager,
}
impl<'a> TerminalSelectionApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn preview(
        &self,
        session_id: &str,
        terminal_id: &str,
        text: &str,
    ) -> Result<UserTerminalSelectionPreview, TerminalApplicationError> {
        // The gate fences deletion/configuration replacement, but this read
        // deliberately does not attach, acquire a run lease or wake an inbox.
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.manager
            .validate_operation_session(session_id, OperationSessionScope::Direct)
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)?;
        let service = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or(TerminalApplicationError::Unavailable)?;
        service
            .preview_user_terminal_selection(terminal_id, text)
            .await
            .map_err(|error| match error {
                TerminalSelectionError::Invalid(message) => {
                    TerminalApplicationError::Invalid(message)
                }
                TerminalSelectionError::Unavailable => TerminalApplicationError::Unavailable,
            })
    }
}
