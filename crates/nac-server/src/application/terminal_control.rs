//! Explicit human actions over existing qualified PTYs. No agent attachment,
//! approval, process conversion, or retention is performed by this facade.
use super::session_terminals::SessionTerminalApplication;
use super::terminal_observation::TerminalApplicationError;
use nac_core::session_service::{InputControlStatus, InputController, InputDeliveryReceipt};

impl SessionTerminalApplication<'_> {
    pub(crate) async fn input_control(
        &self,
        session: &str,
        id: &str,
    ) -> Result<InputControlStatus, TerminalApplicationError> {
        let _admission = self.manager.managed_completion_admission_async().await?;
        self.cached_user_service(session)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?
            .terminal_input_control(id)
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)
    }

    pub(crate) async fn transfer_input_control(
        &self,
        session: &str,
        id: &str,
        expected: u64,
        target: InputController,
        acknowledge: bool,
    ) -> Result<InputControlStatus, TerminalApplicationError> {
        let _admission = self.manager.managed_work_admission_async().await?;
        self.cached_user_service(session)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?
            .transfer_terminal_input_control(id, expected, target, acknowledge)
            .await
            .map_err(|error| TerminalApplicationError::Rejected(error.to_string()))
    }

    pub(crate) async fn controlled_input(
        &self,
        session: &str,
        id: &str,
        expected: u64,
        bytes: &[u8],
    ) -> Result<InputDeliveryReceipt, TerminalApplicationError> {
        let _admission = self.manager.managed_work_admission_async().await?;
        if bytes.is_empty() || bytes.len() > 16384 {
            return Err(TerminalApplicationError::Invalid(
                "terminal input must contain 1–16384 bytes",
            ));
        }
        self.cached_user_service(session)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?
            .write_controlled_terminal_input_receipt(id, expected, bytes)
            .await
            .map_err(|error| TerminalApplicationError::Rejected(error.to_string()))
    }
}
