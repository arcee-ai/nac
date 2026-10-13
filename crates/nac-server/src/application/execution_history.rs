//! View-only history cannot create a service or reconcile abandoned commands.
use super::session_terminals::SessionTerminalApplication;
use super::terminal_observation::TerminalApplicationError;
use nac_core::session_service::{recent_command_history, ExecutionHistory};

impl SessionTerminalApplication<'_> {
    pub(crate) async fn execution_history(
        &self,
        session_id: &str,
    ) -> Result<ExecutionHistory, TerminalApplicationError> {
        let manager = self.manager;
        let _admission = manager.managed_completion_admission_async().await?;
        manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Direct,
            )
            .await?;
        if let Some(service) = self.cached_user_service(session_id).await? {
            let history = service
                .execution_history()
                .await
                .map_err(|_| TerminalApplicationError::Unavailable)?;
            let current = self
                .cached_user_service(session_id)
                .await?
                .ok_or(TerminalApplicationError::Unavailable)?;
            if !std::sync::Arc::ptr_eq(&service, &current) {
                return Err(TerminalApplicationError::Unavailable);
            }
            return Ok(history);
        }
        let history =
            recent_command_history(manager.inner.store_path.clone(), session_id.to_owned())
                .await
                .map_err(|_| TerminalApplicationError::Unavailable)?;
        manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Direct,
            )
            .await?;
        Ok(history)
    }
}
