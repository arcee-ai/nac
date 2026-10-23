use anyhow::{anyhow, Result};

use super::terminal_observation::{RenderAcknowledgement, TerminalApplicationError, TerminalFrame};
use crate::SessionManager;
use nac_core::session_service::{SessionService, UserTerminalStatus};
use std::sync::Arc;
use uuid::Uuid;

/// Definite ownership fence, distinct from a failed cleanup attempt.
#[derive(Debug)]
pub(crate) struct TerminalOwnerMismatch;

impl std::fmt::Display for TerminalOwnerMismatch {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("terminal belongs to another or previous service owner")
    }
}

impl std::error::Error for TerminalOwnerMismatch {}

/// Explicit terminal lifecycle operations scoped to one persisted session.
///
/// Termination intentionally does not acquire the session operation or
/// resource mutation leases: a live terminal may itself hold those shared
/// leases, and this operation exists to settle that exact ownership. The
/// lifecycle gate still orders attachment against deletion and configuration
/// replacement.
pub(crate) struct SessionTerminalApplication<'a> {
    pub(super) manager: &'a SessionManager,
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

    /// Completion can only use a live cached owner. It must never reconstruct
    /// an agent/backend during maintenance merely to inspect a terminal.
    pub(super) async fn cached_user_service(
        &self,
        session_id: &str,
    ) -> Result<Option<Arc<SessionService>>, TerminalApplicationError> {
        // An existing cached identity avoids a redundant existence lookup, not
        // authorization. The fresh configuration read below proves durable
        // existence and version under the lifecycle gate on each invocation.
        // Unknown/unbounded IDs retain validation before allocating a gate.
        let cached_identity = SessionManager::operation_session_id_is_bounded(session_id)
            && self
                .manager
                .inner
                .active_sessions
                .read()
                .await
                .contains_key(session_id);
        if !cached_identity {
            self.manager
                .validate_operation_session(
                    session_id,
                    super::persistence::OperationSessionScope::Persisted,
                )
                .await?;
        }
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let config_version = self
            .manager
            .session_state()
            .config_async(session_id)
            .await?
            .config_version;
        let service = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        if service
            .as_ref()
            .is_some_and(|service| service.config_version() != Some(config_version))
        {
            return Err(TerminalApplicationError::Unavailable);
        }
        Ok(service)
    }

    async fn completion_service(
        &self,
        session_id: &str,
    ) -> Result<Arc<SessionService>, TerminalApplicationError> {
        if self.manager.managed_host().is_some() {
            self.cached_user_service(session_id)
                .await?
                .ok_or(TerminalApplicationError::Unavailable)
        } else {
            self.user_service(session_id).await
        }
    }

    pub(crate) async fn open_user(
        &self,
        session_id: &str,
        launch_id: Uuid,
        cols: u16,
        rows: u16,
    ) -> Result<UserTerminalStatus, TerminalApplicationError> {
        let _host_admission = self.manager.managed_work_admission_async().await?;
        if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
            return Err(TerminalApplicationError::Invalid(
                "terminal geometry is out of bounds",
            ));
        }
        // Core retains Deny and canonical binding without an agent approval
        // wait, and revalidates configuration under pre-spawn resource leases.
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
        let _host_admission = self.manager.managed_completion_admission_async().await?;
        if self.manager.managed_host().is_some() {
            let Some(service) = self.cached_user_service(session_id).await? else {
                return Ok(Vec::new());
            };
            return service.list_user_terminals().await.map_err(Into::into);
        }
        self.completion_service(session_id)
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
        let _host_admission = self.manager.managed_completion_admission_async().await?;
        self.completion_service(session_id)
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
        let _host_admission = self.manager.managed_completion_admission_async().await?;
        let service = self.completion_service(session_id).await?;
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
        let _host_admission = self.manager.managed_completion_admission_async().await?;
        let owner = if self.manager.managed_host().is_some() {
            let service = self
                .cached_user_service(session_id)
                .await?
                .ok_or(TerminalApplicationError::Unavailable)?;
            self.manager.inner.terminal_observations.require_owner(
                session_id,
                terminal_id,
                observer_id,
                &service,
            )?;
            Some(service)
        } else {
            None
        };
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        let frame = self
            .manager
            .inner
            .terminal_observations
            .pull(
                session_id,
                terminal_id,
                observer_id,
                acknowledgement,
                wait_ms,
            )
            .await?;
        // Output waits never hold the exclusive lifecycle gate. Revalidate the
        // actual cached owner after waiting before delivering even a pending
        // frame, preserving independent readers and fail-fast Busy responses.
        if let Some(owner) = owner {
            let current = self
                .cached_user_service(session_id)
                .await?
                .ok_or(TerminalApplicationError::Unavailable)?;
            if !Arc::ptr_eq(&owner, &current) {
                return Err(TerminalApplicationError::Unavailable);
            }
        }
        Ok(frame)
    }

    pub(crate) async fn detach_user(
        &self,
        session_id: &str,
        terminal_id: &str,
        observer_id: Uuid,
    ) -> Result<(), TerminalApplicationError> {
        let _host_admission = self.manager.managed_completion_admission_async().await?;
        self.manager
            .inner
            .terminal_observations
            .detach(session_id, terminal_id, observer_id);
        Ok(())
    }

    pub(crate) async fn input_user(
        &self,
        session_id: &str,
        terminal_id: &str,
        bytes: &[u8],
    ) -> Result<(), TerminalApplicationError> {
        let _host_admission = self.manager.managed_work_admission_async().await?;
        if bytes.len() > 16 * 1024 {
            return Err(TerminalApplicationError::Invalid(
                "terminal input exceeds 16384 bytes",
            ));
        }
        self.completion_service(session_id)
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
        let _host_admission = self.manager.managed_completion_admission_async().await?;
        if !(2..=500).contains(&cols) || !(1..=300).contains(&rows) {
            return Err(TerminalApplicationError::Invalid(
                "terminal geometry is out of bounds",
            ));
        }
        self.completion_service(session_id)
            .await?
            .resize_user_terminal(terminal_id, cols, rows)
            .await
            .map_err(|error| TerminalApplicationError::Rejected(error.to_string()))
    }

    pub(crate) async fn terminate(&self, session_id: &str, terminal_id: &str) -> Result<()> {
        let _host_admission = self.manager.managed_completion_admission_async().await?;
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
        if self.manager.managed_host().is_none() {
            return self
                .manager
                .attach_session_locked(session_id, None)
                .await?
                .terminate_terminal(terminal_id)
                .await;
        }
        let cached = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned();
        let service = if let Some(service) = cached {
            let config_version = self
                .manager
                .session_state()
                .config_async(session_id)
                .await?
                .config_version;
            if service.config_version() != Some(config_version) {
                return Err(TerminalOwnerMismatch.into());
            }
            service
        } else {
            if self.manager.managed_host().is_some() && terminal_id.starts_with("user-shell-") {
                return Err(TerminalOwnerMismatch.into());
            }
            // Legacy model/durable cleanup recovery can rebuild only while
            // ordinary work admission is open, never during maintenance.
            let _resume_admission = self.manager.managed_work_admission_async().await?;
            self.manager.attach_session_locked(session_id, None).await?
        };
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
