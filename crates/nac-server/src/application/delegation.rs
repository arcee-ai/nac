use anyhow::{anyhow, Result};
use nac_core::{
    sessions,
    store::{
        ManagedOrchestratorExecutionMode, ManagedOrchestratorRecord,
        SessionAssignmentChildBehavior, SessionAssignmentRecord, TraditionalChildExecutionMode,
        TraditionalChildRecord,
    },
};

use crate::SessionManager;

pub(crate) struct StartTraditionalChild {
    pub(crate) profile: String,
    pub(crate) description: String,
    pub(crate) prompt: String,
    pub(crate) child_session_id: Option<String>,
    pub(crate) background: bool,
}

pub(crate) struct StartManagedOrchestrator {
    pub(crate) description: String,
    pub(crate) prompt: String,
    pub(crate) orchestrator_session_id: Option<String>,
    pub(crate) background: bool,
}

pub(crate) struct StartSessionSpawn {
    pub(crate) behavior: SessionAssignmentChildBehavior,
    pub(crate) description: String,
    pub(crate) prompt: String,
    pub(crate) child_session_id: Option<String>,
    pub(crate) background: bool,
}

/// Durable child-session and managed-orchestrator use cases.
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
        if service.metadata().behavior.is_nac() {
            return Err(anyhow!(sessions::NAC_CANNOT_CREATE_SESSIONS));
        }
        if nac_core::store::load_traditional_child(
            &self.manager.inner.store_path,
            parent_session_id,
        )?
        .is_some()
        {
            return Err(anyhow!(
                "traditional child nesting limit reached (1): child sessions cannot launch children"
            ));
        }
        nac_core::store::list_traditional_children(
            &self.manager.inner.store_path,
            parent_session_id,
        )
    }

    pub(crate) async fn start_traditional_child(
        &self,
        parent_session_id: &str,
        command: StartTraditionalChild,
    ) -> Result<TraditionalChildRecord> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior.is_nac() {
            return Err(anyhow!(sessions::NAC_CANNOT_CREATE_SESSIONS));
        }
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

    pub(crate) async fn cancel_traditional_child(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<TraditionalChildRecord> {
        self.traditional_child(parent_session_id, child_session_id)?;
        nac_core::traditional_children::controller_for(&self.manager.inner.store_path)?
            .cancel(parent_session_id, child_session_id)
            .await
    }

    pub(crate) async fn list_managed_orchestrators(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<ManagedOrchestratorRecord>> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior.is_nac() {
            return Err(anyhow!(sessions::NAC_CANNOT_CREATE_SESSIONS));
        }
        nac_core::store::list_managed_orchestrators(
            &self.manager.inner.store_path,
            parent_session_id,
        )
    }

    pub(crate) async fn start_managed_orchestrator(
        &self,
        parent_session_id: &str,
        command: StartManagedOrchestrator,
    ) -> Result<ManagedOrchestratorRecord> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior.is_nac() {
            return Err(anyhow!(sessions::NAC_CANNOT_CREATE_SESSIONS));
        }
        let controller =
            nac_core::orchestration_control::controller_for(&self.manager.inner.store_path)?;
        let orchestrator = controller
            .start(
                nac_core::orchestration_control::ManagedOrchestratorStartRequest {
                    parent_session_id: parent_session_id.to_string(),
                    orchestrator_session_id: command.orchestrator_session_id,
                    description: command.description,
                    prompt: command.prompt,
                    execution_mode: if command.background {
                        ManagedOrchestratorExecutionMode::Background
                    } else {
                        ManagedOrchestratorExecutionMode::Foreground
                    },
                },
            )
            .await?;
        if command.background {
            Ok(orchestrator)
        } else {
            controller
                .wait(
                    &orchestrator.orchestrator_session_id,
                    orchestrator.generation,
                )
                .await
        }
    }

    pub(crate) fn managed_orchestrator(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        nac_core::store::load_managed_orchestrator_for_parent(
            &self.manager.inner.store_path,
            parent_session_id,
            orchestrator_session_id,
        )?
        .ok_or_else(|| anyhow!("managed orchestrator was not found"))
    }

    pub(crate) async fn cancel_managed_orchestrator(
        &self,
        parent_session_id: &str,
        orchestrator_session_id: &str,
    ) -> Result<ManagedOrchestratorRecord> {
        self.managed_orchestrator(parent_session_id, orchestrator_session_id)?;
        nac_core::orchestration_control::controller_for(&self.manager.inner.store_path)?
            .cancel(parent_session_id, orchestrator_session_id)
            .await
    }

    pub(crate) async fn list_session_assignments(
        &self,
        parent_session_id: &str,
    ) -> Result<Vec<SessionAssignmentRecord>> {
        let service = self.manager.attach_session(parent_session_id).await?;
        if service.metadata().behavior.is_nac() {
            return Err(anyhow!(sessions::NAC_CANNOT_CREATE_SESSIONS));
        }
        if nac_core::store::load_traditional_child(
            &self.manager.inner.store_path,
            parent_session_id,
        )?
        .is_some()
        {
            return Err(anyhow!(
                "traditional child nesting limit reached (1): child sessions cannot launch children"
            ));
        }
        nac_core::store::list_session_assignments(&self.manager.inner.store_path, parent_session_id)
    }

    pub(crate) async fn start_session_spawn(
        &self,
        parent_session_id: &str,
        command: StartSessionSpawn,
    ) -> Result<SessionAssignmentRecord> {
        let child_session_id = match command.behavior {
            SessionAssignmentChildBehavior::Direct => {
                self.start_traditional_child(
                    parent_session_id,
                    StartTraditionalChild {
                        profile: nac_core::store::GENERAL_CHILD_PROFILE.to_string(),
                        description: command.description,
                        prompt: command.prompt,
                        child_session_id: command.child_session_id,
                        background: command.background,
                    },
                )
                .await?
                .child_session_id
            }
            SessionAssignmentChildBehavior::Orchestrator => {
                self.start_managed_orchestrator(
                    parent_session_id,
                    StartManagedOrchestrator {
                        description: command.description,
                        prompt: command.prompt,
                        orchestrator_session_id: command.child_session_id,
                        background: command.background,
                    },
                )
                .await?
                .orchestrator_session_id
            }
        };
        nac_core::store::load_session_assignment_for_parent(
            &self.manager.inner.store_path,
            parent_session_id,
            &child_session_id,
        )?
        .ok_or_else(|| anyhow!("session assignment disappeared after spawn"))
    }

    pub(crate) fn session_assignment(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionAssignmentRecord> {
        nac_core::store::load_session_assignment_for_parent(
            &self.manager.inner.store_path,
            parent_session_id,
            child_session_id,
        )?
        .ok_or_else(|| anyhow!("session assignment was not found"))
    }

    pub(crate) async fn cancel_session_spawn(
        &self,
        parent_session_id: &str,
        child_session_id: &str,
    ) -> Result<SessionAssignmentRecord> {
        let assignment = self.session_assignment(parent_session_id, child_session_id)?;
        match assignment.child_behavior {
            SessionAssignmentChildBehavior::Direct => {
                self.cancel_traditional_child(parent_session_id, child_session_id)
                    .await?;
            }
            SessionAssignmentChildBehavior::Orchestrator => {
                self.cancel_managed_orchestrator(parent_session_id, child_session_id)
                    .await?;
            }
        }
        self.session_assignment(parent_session_id, child_session_id)
    }
}
