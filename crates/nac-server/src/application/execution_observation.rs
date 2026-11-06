//! Read-only existing owner resolution. No attachment/recovery from a view.
use super::session_terminals::SessionTerminalApplication;
use super::terminal_observation::{RenderAcknowledgement, TerminalApplicationError, TerminalFrame};
use nac_core::session_service::ExecutionStatus;
use uuid::Uuid;

impl SessionTerminalApplication<'_> {
    pub(crate) async fn list_executions(
        &self,
        session_id: &str,
    ) -> Result<Vec<ExecutionStatus>, TerminalApplicationError> {
        let manager = self.manager;
        let _admission = manager.managed_completion_admission_async().await?;
        let Some(service) = self.cached_user_service(session_id).await? else {
            return Ok(Vec::new());
        };
        service
            .execution_catalog()
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)
    }

    pub(crate) async fn attach_execution(
        &self,
        session_id: &str,
        id: &str,
        page_limit: usize,
    ) -> Result<(Uuid, ExecutionStatus), TerminalApplicationError> {
        let manager = self.manager;
        let _admission = manager.managed_completion_admission_async().await?;
        let service = self
            .cached_user_service(session_id)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?;
        let execution = service
            .execution_status(id)
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)?;
        let observer = manager
            .inner
            .terminal_observations
            .attach_execution(session_id, id, service, page_limit)?;
        Ok((observer, execution))
    }

    pub(crate) async fn pull_execution(
        &self,
        session_id: &str,
        id: &str,
        observer: Uuid,
        ack: Option<RenderAcknowledgement>,
        wait_ms: u16,
    ) -> Result<TerminalFrame, TerminalApplicationError> {
        // NAC PROFILE BEGIN
        let profile_cursor = ack.map_or(0, |value| value.offset);
        let mut profile_at = std::time::Instant::now();
        // NAC PROFILE END
        let manager = self.manager;
        let _admission = manager.managed_completion_admission_async().await?;
        // NAC PROFILE BEGIN
        super::observer_profile::phase(
            observer,
            profile_cursor,
            "completion_admission",
            profile_at,
        );
        profile_at = std::time::Instant::now();
        // NAC PROFILE END
        let service = self
            .cached_user_service(session_id)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?;
        // NAC PROFILE BEGIN
        super::observer_profile::phase(observer, profile_cursor, "owner_config_before", profile_at);
        // NAC PROFILE END
        manager
            .inner
            .terminal_observations
            .require_owner(session_id, id, observer, &service)?;
        let frame = manager
            .inner
            .terminal_observations
            .pull(session_id, id, observer, ack, wait_ms)
            .await?;
        if frame.execution.is_none() {
            return Err(TerminalApplicationError::Unavailable);
        }
        // NAC PROFILE BEGIN
        profile_at = std::time::Instant::now();
        // NAC PROFILE END
        let current = self
            .cached_user_service(session_id)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?;
        // NAC PROFILE BEGIN
        super::observer_profile::phase(observer, profile_cursor, "owner_config_after", profile_at);
        // NAC PROFILE END
        if !std::sync::Arc::ptr_eq(&current, &service) {
            return Err(TerminalApplicationError::Unavailable);
        }
        Ok(frame)
    }

    pub(crate) async fn stop_execution(
        &self,
        session_id: &str,
        id: &str,
    ) -> Result<(), TerminalApplicationError> {
        let manager = self.manager;
        let _admission = manager.managed_completion_admission_async().await?;
        let service = self
            .cached_user_service(session_id)
            .await?
            .ok_or(TerminalApplicationError::Unavailable)?;
        service
            .stop_execution(id)
            .await
            .map_err(|_| TerminalApplicationError::Unavailable)
    }
}
