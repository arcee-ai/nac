//! Own fresh runtime resources until the creation transaction commits.
use super::*;

#[must_use = "fresh runtime resources need a creation commit or rollback"]
pub struct PreparedSessionRunConfig {
    run_config: OrchestratorRunConfig,
    resources: PreparedSessionResources,
}

/// Rollback ownership for an unpublished session's container and worktree.
/// Dropping an interrupted preparation retains the existing fallback cleanup;
/// ordinary errors explicitly await container removal before returning.
#[must_use = "fresh session resources need a creation commit or rollback"]
pub struct PreparedSessionResources {
    sandbox: Option<crate::sandbox::SandboxSession>,
    worktree: crate::sandbox::session_worktree::RollbackGuard,
}

impl PreparedSessionRunConfig {
    pub(super) fn new(
        run_config: OrchestratorRunConfig,
        worktree: crate::sandbox::session_worktree::RollbackGuard,
    ) -> Self {
        let sandbox = run_config.agent.sandbox_session();
        Self {
            run_config,
            resources: PreparedSessionResources { sandbox, worktree },
        }
    }

    pub fn run_config_mut(&mut self) -> &mut OrchestratorRunConfig {
        &mut self.run_config
    }

    pub fn into_parts(self) -> (OrchestratorRunConfig, PreparedSessionResources) {
        (self.run_config, self.resources)
    }

    pub async fn rollback(self) -> Result<()> {
        self.resources.rollback().await
    }

    pub(super) async fn persist(self) -> Result<OrchestratorRunConfig> {
        let (run_config, resources) = self.into_parts();
        let result = match &run_config.session {
            OrchestratorSession::Active {
                snapshot,
                store_path,
                ..
            } => sessions::create_session(store_path, snapshot),
            OrchestratorSession::Picker { .. } => {
                unreachable!("fresh construction creates a session")
            }
        };
        if let Err(error) = result {
            if let Err(cleanup) = resources.rollback().await {
                return Err(error.context(format!(
                    "fresh sandbox launch also failed to roll back its container: {cleanup:#}"
                )));
            }
            return Err(error);
        }
        resources.retain();
        Ok(run_config)
    }
}

impl PreparedSessionResources {
    #[cfg(test)]
    pub(crate) fn for_test(worktree: Option<crate::sandbox::SandboxWorktree>) -> Self {
        Self {
            sandbox: None,
            worktree: crate::sandbox::session_worktree::RollbackGuard::new(worktree),
        }
    }

    /// The caller has committed the fresh session's durable cleanup metadata.
    pub(crate) fn retain(mut self) {
        if let Some(sandbox) = &self.sandbox {
            sandbox.retain_for_durable_session();
        }
        self.worktree.disarm();
    }

    pub async fn rollback(self) -> Result<()> {
        if let Some(sandbox) = &self.sandbox {
            sandbox.disable_drop_cleanup();
            sandbox.destroy().await?;
        }
        Ok(())
    }
}
