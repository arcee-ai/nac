//! Human product delegation control, separate from the native follow-up port.
use crate::SessionManager;
use anyhow::Result;
use nac_core::store::{
    self, TaskFollowupDelegation, TaskFollowupDelegationRequest, TaskFollowupError,
};

pub(crate) struct TaskFollowupDelegationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> TaskFollowupDelegationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    async fn validate_caller(&self, caller: &str) -> Result<()> {
        self.manager
            .validate_operation_session(caller, super::persistence::OperationSessionScope::Direct)
            .await
    }

    pub(crate) async fn issue(
        &self,
        caller: String,
        request: TaskFollowupDelegationRequest,
    ) -> Result<TaskFollowupDelegation> {
        self.validate_caller(&caller).await?;
        let _guard = self
            .manager
            .inner
            .task_preparations
            .admit()
            .await
            .map_err(|_| TaskFollowupError::Stopping)?;
        let gate = self.manager.lifecycle_gate(&caller);
        let _lifecycle = gate.lock().await;
        // Never attach/recover/wake a task merely to issue authority. A current
        // caller service supplies the construction-selected policy/backend.
        let service = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(&caller)
            .cloned()
            .ok_or(TaskFollowupError::Unavailable)?;
        service.issue_task_followup_delegation(request).await
    }

    pub(crate) async fn read(
        &self,
        caller: String,
        id: String,
    ) -> Result<Option<TaskFollowupDelegation>> {
        self.validate_caller(&caller).await?;
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            store::load_task_followup_delegation(&path, &caller, &id)
        })
        .await?
    }

    pub(crate) async fn revoke(
        &self,
        caller: String,
        id: String,
    ) -> Result<Option<TaskFollowupDelegation>> {
        self.validate_caller(&caller).await?;
        let _guard = self
            .manager
            .inner
            .task_preparations
            .admit()
            .await
            .map_err(|_| TaskFollowupError::Stopping)?;
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            store::revoke_task_followup_delegation(&path, &caller, &id)
        })
        .await?
    }
}
