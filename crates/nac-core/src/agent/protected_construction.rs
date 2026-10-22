//! The existing Agent constructor with original protected owners supplied up
//! front. No ordinary construction followed by a protected-context stamp.
use super::*;
use crate::runtime::{CreatePublicationCustody, ProtectedExecutionStage};

impl Agent {
    pub(crate) fn belongs_to_protected_context(
        &self,
        context: &Arc<crate::runtime::ProtectedExecutionContext>,
    ) -> bool {
        self.tool_runtime
            .protected_context
            .as_ref()
            .is_some_and(|original| Arc::ptr_eq(original, context))
            && Arc::ptr_eq(&self.tool_runtime.backend, context.selected_backend())
            && self.client.belongs_to_protected_context(context)
    }
    /// Genuine Core builder only. This constructs the existing prompts, model
    /// loop, transcript and tool registry with the SAME preselected backend and
    /// original qualified context. Private fields have no post-build setter.
    /// The separate protected tool adapters are still required: ordinary host
    /// dispatch and model readiness remain refused until that join is installed.
    pub(crate) fn with_protected_config(
        client: ModelClient,
        config: AgentConfig,
        custody: &CreatePublicationCustody,
    ) -> Result<Self> {
        custody.check_current()?;
        let context = custody.context();
        let source = custody.source()?;
        anyhow::ensure!(
            client.belongs_to_protected_context(context)
                && config.store_path == source.bound_store_path()
                && config.session_id.as_deref() == Some(source.binding().session_id.as_str())
                && config.ssh.is_none()
                && config.sandbox.is_none(),
            "protected Agent original construction differs"
        );
        // The first supported Native construction retains a Local backend
        // identity. It still executes through the independently qualified
        // compartment; this is not permission to use concrete Local adapters.
        anyhow::ensure!(
            matches!(context.selected_backend().as_ref(),
            crate::sandbox::ExecutionBackend::Local { workspace_cwd } if workspace_cwd == &config.workspace_cwd),
            "protected Agent selected backend differs"
        );
        context.check_stage(ProtectedExecutionStage::Prepare)?;
        let agent = Self::construct(
            client,
            config,
            AgentConstruction::Protected(Arc::clone(context)),
        )?;
        custody.check_current()?;
        Ok(agent)
    }
}

#[cfg(test)]
#[path = "protected_construction_tests.rs"]
mod tests;
