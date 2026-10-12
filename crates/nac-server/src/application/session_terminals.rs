use anyhow::{anyhow, Result};

use super::terminal_observation::{RenderAcknowledgement, TerminalApplicationError, TerminalFrame};
use crate::SessionManager;
use nac_core::session_service::{SessionService, UserTerminalStatus};
use std::sync::Arc;
use uuid::Uuid;

/// Explicit terminal lifecycle operations scoped to one persisted session.
///
/// Termination intentionally does not acquire the session operation or
/// resource mutation leases: a live terminal may itself hold those shared
/// leases, and this operation exists to settle that exact ownership. The
/// lifecycle gate still orders attachment against deletion and configuration
/// replacement.
pub(crate) struct SessionTerminalApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionTerminalApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    async fn user_service(
        &self,
        session_id: &str,
    ) -> Result<Arc<SessionService>, TerminalApplicationError> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        Ok(self.manager.attach_session_locked(session_id, None).await?)
    }

    pub(crate) async fn open_user(
        &self,
        session_id: &str,
        launch_id: Uuid,
        cols: u16,
        rows: u16,
    ) -> Result<UserTerminalStatus, TerminalApplicationError> {
        if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
            return Err(TerminalApplicationError::Invalid(
                "terminal geometry is out of bounds",
            ));
        }
        // Release the attachment gate before a potentially interactive approval
        // wait. Core revalidates configuration under pre-spawn resource leases.
        self.user_service(session_id)
            .await?
            .open_user_terminal(launch_id, cols, rows)
            .await
            .map_err(|error| TerminalApplicationError::Rejected(error.to_string()))
    }

    pub(crate) async fn list_users(
        &self,
        session_id: &str,
    ) -> Result<Vec<UserTerminalStatus>, TerminalApplicationError> {
        self.user_service(session_id)
            .await?
            .list_user_terminals()
            .await
            .map_err(Into::into)
    }

    pub(crate) async fn user_status(
        &self,
        session_id: &str,
        terminal_id: &str,
    ) -> Result<UserTerminalStatus, TerminalApplicationError> {
        self.user_service(session_id)
            .await?
            .user_terminal_status(terminal_id)
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)
    }

    pub(crate) async fn attach_user(
        &self,
        session_id: &str,
        terminal_id: &str,
        page_limit: usize,
    ) -> Result<(Uuid, UserTerminalStatus), TerminalApplicationError> {
        let service = self.user_service(session_id).await?;
        let status = service
            .user_terminal_status(terminal_id)
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)?;
        let observer_id = self.manager.inner.terminal_observations.attach(
            session_id,
            terminal_id,
            service,
            page_limit,
        )?;
        Ok((observer_id, status))
    }

    pub(crate) async fn pull_user(
        &self,
        session_id: &str,
        terminal_id: &str,
        observer_id: Uuid,
        acknowledgement: Option<RenderAcknowledgement>,
        wait_ms: u16,
    ) -> Result<TerminalFrame, TerminalApplicationError> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        self.manager
            .inner
            .terminal_observations
            .pull(
                session_id,
                terminal_id,
                observer_id,
                acknowledgement,
                wait_ms,
            )
            .await
    }

    pub(crate) fn detach_user(&self, session_id: &str, terminal_id: &str, observer_id: Uuid) {
        self.manager
            .inner
            .terminal_observations
            .detach(session_id, terminal_id, observer_id);
    }

    pub(crate) async fn input_user(
        &self,
        session_id: &str,
        terminal_id: &str,
        bytes: &[u8],
    ) -> Result<(), TerminalApplicationError> {
        if bytes.len() > 16 * 1024 {
            return Err(TerminalApplicationError::Invalid(
                "terminal input exceeds 16384 bytes",
            ));
        }
        self.user_service(session_id)
            .await?
            .write_user_terminal_input(terminal_id, bytes)
            .await
            .map_err(|error| TerminalApplicationError::Rejected(error.to_string()))
    }

    pub(crate) async fn resize_user(
        &self,
        session_id: &str,
        terminal_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), TerminalApplicationError> {
        if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
            return Err(TerminalApplicationError::Invalid(
                "terminal geometry is out of bounds",
            ));
        }
        self.user_service(session_id)
            .await?
            .resize_user_terminal(terminal_id, cols, rows)
            .await
            .map_err(|error| TerminalApplicationError::Rejected(error.to_string()))
    }

    pub(crate) async fn terminate(&self, session_id: &str, terminal_id: &str) -> Result<()> {
        const MAX_TERMINAL_ID_BYTES: usize = 1024;
        if terminal_id.is_empty() || terminal_id.len() > MAX_TERMINAL_ID_BYTES {
            return Err(anyhow!("terminal_id is invalid"));
        }
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        let service = self.manager.attach_session_locked(session_id, None).await?;
        service.terminate_terminal(terminal_id).await
    }
}

impl SessionManager {
    pub async fn terminate_terminal(&self, session_id: &str, terminal_id: &str) -> Result<()> {
        self.session_terminals()
            .terminate(session_id, terminal_id)
            .await
    }
}
