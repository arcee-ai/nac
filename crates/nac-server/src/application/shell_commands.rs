//! Human command use cases coordinate attachment with session lifecycle gates.
use crate::SessionManager;
use anyhow::Result;
use nac_core::session_service::{SessionService, ShellCommandRequest, ShellCommandSnapshot};

pub(crate) struct ShellCommandApplication<'a> {
    manager: &'a SessionManager,
}
impl<'a> ShellCommandApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    async fn attach(&self, session_id: &str) -> Result<std::sync::Arc<SessionService>> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        self.manager.attach_session_locked(session_id, None).await
    }

    pub(crate) async fn submit(
        &self,
        session_id: &str,
        request: ShellCommandRequest,
    ) -> Result<(ShellCommandSnapshot, bool)> {
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let service = self.attach(session_id).await?;
        Ok(service.submit_shell_command(request).await?)
    }

    pub(crate) async fn lookup(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<Option<ShellCommandSnapshot>> {
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.attach(session_id)
            .await?
            .lookup_shell_command(request_id)
            .await
    }

    pub(crate) async fn cancel(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Result<Option<ShellCommandSnapshot>> {
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.attach(session_id)
            .await?
            .cancel_shell_command(request_id)
            .await
    }
    pub(crate) async fn output(
        &self,
        session_id: &str,
        request_id: &str,
        stream: &str,
        offset: u64,
        limit: usize,
    ) -> Result<Option<nac_core::session_service::ShellOutputPage>> {
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.attach(session_id)
            .await?
            .shell_command_output(request_id, stream, offset, limit)
            .await
    }
}
