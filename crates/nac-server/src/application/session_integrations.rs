//! Session-scoped mount intent. Passive status never attaches or wakes an agent.
use crate::SessionManager;
use anyhow::Result;
use nac_core::{
    mcp_configurations::{SessionMcpRefreshState, SessionMcpRefreshStatus},
    sessions, store,
};

pub(crate) struct SessionIntegrationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionIntegrationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn status(&self, session: &str) -> Result<SessionMcpRefreshStatus> {
        self.manager
            .validate_operation_session(
                session,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        let gate = self.manager.lifecycle_gate(session);
        let _lifecycle = gate.lock().await;
        let path = self.manager.inner.store_path.clone();
        let id = session.to_string();
        let (request, behavior, config_version) = self
            .manager
            .inner
            ._store_ownership
            .call_legacy(move || -> Result<_> {
                Ok((
                    store::load_session_mcp_refresh(&path, &id)?,
                    sessions::load_session_behavior(&path, &id)?,
                    sessions::load_session_config(&path, &id)?.config_version,
                ))
            })
            .await??;
        let cached = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session)
            .cloned();
        if let Some(service) =
            cached.filter(|service| service.config_version() == Some(config_version))
        {
            return service.mcp_refresh_status().await;
        }
        Ok(SessionMcpRefreshStatus {
            revision: request.revision,
            requested_at: request.requested_at,
            applied_revision: None,
            incarnation_id: None,
            state: if behavior == sessions::SessionBehavior::Orchestrator {
                SessionMcpRefreshState::ScheduledForWorkers
            } else {
                SessionMcpRefreshState::Pending
            },
            message: None,
        })
    }

    pub(crate) async fn refresh(
        &self,
        session: &str,
        expected_revision: i64,
    ) -> Result<SessionMcpRefreshStatus> {
        let _admission = self.manager.managed_work_admission_async().await?;
        self.manager
            .validate_operation_session(
                session,
                super::persistence::OperationSessionScope::Persisted,
            )
            .await?;
        let path = self.manager.inner.store_path.clone();
        let id = session.to_string();
        self.manager
            .inner
            ._store_ownership
            .call_legacy(move || store::request_session_mcp_refresh(&path, &id, expected_revision))
            .await??;
        self.status(session).await
    }
}
