//! Human product issuance of exact retained delegation; never an agent bypass.
use super::*;
use crate::store::{TaskFollowupDelegation, TaskFollowupDelegationRequest, TaskFollowupError};

/// Only this lifecycle owner constructs issuance authority. It has no wire or
/// model decoder and cannot be selected with an origin flag.
#[derive(Clone)]
pub(crate) struct SubmittedTaskFollowupDelegation {
    id: String,
    caller: String,
    request: TaskFollowupDelegationRequest,
    config_version: i64,
    store_path: PathBuf,
}

impl SubmittedTaskFollowupDelegation {
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
    pub(crate) fn caller(&self) -> &str {
        &self.caller
    }
    pub(crate) fn request(&self) -> &TaskFollowupDelegationRequest {
        &self.request
    }
    pub(crate) fn config_version(&self) -> i64 {
        self.config_version
    }
    pub(crate) fn store_path(&self) -> &Path {
        &self.store_path
    }

    pub(crate) fn permission_resources(&self) -> Vec<crate::tools::kernel::PermissionResource> {
        vec![crate::tools::kernel::PermissionResource::new(
            self.request.action.permission_action(),
            format!("session:{}", self.request.target_session_id),
        )]
    }

    #[cfg(test)]
    pub(crate) fn for_test(
        path: &Path,
        caller: &str,
        request: TaskFollowupDelegationRequest,
    ) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            caller: caller.into(),
            request,
            config_version: 0,
            store_path: path.to_owned(),
        }
    }
}

impl SessionService {
    /// Human-facing service entry point only. Delivery has admitted the human
    /// product request; native agent tools have no issuance port. Issuance is
    /// invocation-only human authority: later sends still use ordinary policy,
    /// plus the separate retained delegation checked at durable admission.
    pub async fn issue_task_followup_delegation(
        &self,
        request: TaskFollowupDelegationRequest,
    ) -> Result<TaskFollowupDelegation> {
        request.validate()?;
        let caller = self
            .metadata
            .session_id
            .as_deref()
            .ok_or(TaskFollowupError::Unavailable)?;
        let broker = self
            .permission_broker
            .as_ref()
            .ok_or(TaskFollowupError::Unavailable)?;
        let submission = SubmittedTaskFollowupDelegation {
            id: Uuid::new_v4().to_string(),
            caller: caller.into(),
            request,
            config_version: broker.session_config_version(),
            store_path: self.metadata.store_path.clone(),
        };
        broker.authorize_submitted_task_followup_delegation(&submission)?;
        self.coordinate_local(move |service| {
            let _active = service.lock_active_operation();
            if service
                .stopping_admission
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return Err(TaskFollowupError::Stopping.into());
            }
            crate::store::issue_task_followup_delegation(&service.metadata.store_path, &submission)
        })
        .await?
    }
}

#[cfg(test)]
#[path = "task_followup_delegations_tests.rs"]
mod tests;
