use anyhow::{anyhow, Result};
use nac_core::{
    sessions,
    store::{TraditionalChildExecutionMode, TraditionalChildRecord},
};

use crate::SessionManager;

pub(crate) struct StartTraditionalChild {
    pub(crate) profile: String,
    /// Required for creation; continuation may omit the immutable label.
    pub(crate) description: Option<String>,
    pub(crate) prompt: String,
    pub(crate) origin: nac_core::store::InputOrigin,
    pub(crate) child_session_id: Option<String>,
    pub(crate) background: bool,
}

/// Durable child-session use cases.
///
/// Traditional children and managed orchestrators intentionally remain
/// distinct topologies. This service owns their parent eligibility checks and
/// foreground/background completion behavior without exposing HTTP concerns.
pub(crate) struct DelegationApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> DelegationApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn list_traditional_children(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<TraditionalChildRecord>> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior == sessions::SessionBehavior::Orchestrator {
            return Err(anyhow!(
                "traditional children are available only for direct behaviors"
            ));
        }
        let path = self.manager.inner.store_path.clone();
        let parent = parent_session_id.to_owned();
        self.manager.inner._store_ownership.call_legacy(move || {
            if nac_core::store::load_traditional_child(&path, &parent)?.is_some() {
                return Err(anyhow!("traditional child nesting limit reached (1): child sessions cannot launch children"));
            }
            nac_core::store::list_traditional_children(&path, &parent)
        }).await?
    }

    pub(crate) async fn start_traditional_child(
        &self,
        parent_session_id: &str,
        command: StartTraditionalChild,
    ) -> Result<TraditionalChildRecord> {
        self.manager.attach_session(parent_session_id).await?;
        let controller =
            nac_core::traditional_children::controller_for(&self.manager.inner.store_path)?;
        let child = controller
            .start(
                nac_core::traditional_children::TraditionalChildStartRequest {
                    parent_session_id: parent_session_id.to_string(),
                    child_session_id: command.child_session_id,
                    profile: command.profile,
                    description: command.description,
                    prompt: command.prompt,
                    origin: command.origin,
                    execution_mode: if command.background {
                        TraditionalChildExecutionMode::Background
                    } else {
                        TraditionalChildExecutionMode::Foreground
                    },
                },
            )
            .await?;
        if command.background {
            Ok(child)
        } else {
            controller
                .wait(&child.child_session_id, child.generation)
                .await
        }
    }

    pub(crate) fn traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        nac_core::store::load_traditional_child_for_parent(
            &self.manager.inner.store_path,
            parent_session_id,
            child_session_id,
        )?
        .ok_or_else(|| anyhow!("traditional child was not found"))
    }

    pub(crate) async fn traditional_child_async(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        let manager = self.manager.clone();
        let parent = parent_session_id.to_owned();
        let child = child_session_id.to_owned();
        self.manager
            .inner
            ._store_ownership
            .call_legacy(move || manager.delegation().traditional_child(&parent, &child))
            .await?
    }

    pub(crate) async fn authorize_child_permission_review_retry(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
        review_id: &str,
    ) -> Result<nac_core::permissions::PermissionReview> {
        let _host_admission = self.manager.managed_work_admission_async().await?;
        let gate = self.manager.lifecycle_gate(parent_session_id);
        let _lifecycle = gate.lock().await;
        self.manager
            .validate_operation_session(
                parent_session_id,
                super::persistence::OperationSessionScope::Direct,
            )
            .await?;
        // Check ownership before attaching or waking any child service.
        let manager = self.manager.clone();
        let parent = parent_session_id.to_owned();
        let child = child_session_id.to_owned();
        self.manager
            .inner
            ._store_ownership
            .call_legacy(move || manager.delegation().traditional_child(&parent, &child))
            .await??;
        let service = self.manager.attach_session(child_session_id).await?;
        service.reconcile_traditional_child_terminal().await?;
        service
            .authorize_child_permission_review_retry(parent_session_id, review_id)
            .await
    }

    pub(crate) async fn cancel_traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        let child = self
            .traditional_child_async(parent_session_id, child_session_id)
            .await?;
        nac_core::traditional_children::controller_for(&self.manager.inner.store_path)?
            .cancel(parent_session_id, child_session_id, child.generation)
            .await
    }
}
