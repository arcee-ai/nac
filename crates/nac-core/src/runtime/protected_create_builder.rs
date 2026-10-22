//! Artifact proposal: assembly from the SAME resolved inputs and original
//! protected custody. No ordinary builder, ambient credential or context stamp.
use super::*;
#[path = "protected_create_guidance.rs"]
mod guidance;

use crate::session_service::{PreparedCreatePublication, SessionService};
use anyhow::ensure;
use std::sync::Arc;

/// Guarded preparation output from the concrete original retained readers.
/// Enabled MCP remains closed until its protected endpoint owner is joined;
/// ordinary loaders or an empty substitute cannot qualify configured behavior.
/// The immutable values below are never accepted from HTTP or a generic callback.
pub(in crate::runtime) struct ProtectedCreateGuidance {
    original_global: Arc<CreateGlobalPreparationSource>,
    _reads: Arc<create_guidance_source::GuidanceReadOwner>,
    original_context: Arc<ProtectedExecutionContext>,
    session_id: String,
    agents_md: AgentsMdBundle,
    skills: Option<Arc<SkillRegistry>>,
    mcp: Option<Arc<McpRegistry>>,
}

/// Original serving supervisor retains this allocation BEFORE try_assemble.
/// Borrowed failures/cancellation keep custody, guidance and resolved values.
pub(in crate::runtime) struct ProtectedCreateBuild {
    participant: Arc<create_participant::CreateParticipant>,
    custody: Option<CreatePublicationCustody>,
    resolved: Option<protected_create_source::ResolvedCreateParts>,
    guidance: ProtectedCreateGuidance,
    attempted: bool,
    issued: bool,
    prepared: Option<PreparedCreatePublication>,
}
impl ProtectedCreateBuild {
    pub(in crate::runtime) fn retain(
        participant: Arc<create_participant::CreateParticipant>,
        custody: CreatePublicationCustody,
        guidance: ProtectedCreateGuidance,
    ) -> Self {
        Self {
            participant,
            custody: Some(custody),
            resolved: None,
            guidance,
            attempted: false,
            issued: false,
            prepared: None,
        }
    }
    pub(in crate::runtime) fn try_assemble(&mut self) -> Result<()> {
        let result = self.assemble();
        if result.is_err() {
            self.participant.deny();
            if let Some(custody) = &self.custody {
                custody.deny_runtime();
            }
        }
        result
    }
    fn assemble(&mut self) -> Result<()> {
        ensure!(
            !std::mem::replace(&mut self.attempted, true),
            "CREATE build already attempted"
        );
        self.participant.check_preparation_current()?;
        self.guidance._reads.check_current()?;
        self.resolved = Some(self.participant.take_resolved()?.into_parts());
        let resolved = self
            .resolved
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("original resolved inputs absent"))?;
        let custody = self
            .custody
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("CREATE custody moved"))?;
        self.participant.check_custody(custody)?;
        custody.check_current()?;
        let source = custody.source()?;
        let original_global = resolved
            .global_source
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("CREATE original global source absent"))?;
        ensure!(
            Arc::ptr_eq(original_global, &self.guidance.original_global)
                && Arc::ptr_eq(custody.context(), &self.guidance.original_context)
                && self.guidance.session_id == source.binding().session_id
                && resolved.store_path == source.bound_store_path()
                && resolved.ssh.is_none()
                && !resolved.sandbox.sandbox
                && resolved.options.model.light_model.is_none()
                && resolved.options.model.trusted_light_credential.is_none(),
            "CREATE preparation/selected protected construction differs"
        );
        // Light-model support needs its own actual protected credential join;
        // never turn a selected light model off or resolve ordinary fallback.
        original_global.check_current()?;
        let (key, completion) = self.participant.model_owners()?;
        let settings = &resolved.model;
        let client = ModelClient::from_protected_host_key(
            settings.clone(),
            key,
            completion,
            Arc::clone(custody.context()),
        )?;
        let workspace_cwd = resolved.options.workspace_cwd.clone();
        let working_directory = workspace_cwd.display().to_string();
        let behavior = resolved.behavior;
        let mode = if behavior == sessions::SessionBehavior::Orchestrator {
            AgentMode::Orchestrator
        } else {
            AgentMode::Direct
        };
        let mcp = self.guidance.mcp.clone();
        let agents_md_message = combine_system_guidance(
            self.guidance.agents_md.system_message(),
            mcp.as_ref()
                .and_then(|registry| registry.instructions_message()),
        );
        let agent = Agent::with_protected_config(
            client.clone(),
            AgentConfig {
                command_output_limits: resolved.command_output_limits,
                mode,
                session_behavior: Some(behavior),
                store_path: resolved.store_path.clone(),
                session_id: Some(source.binding().session_id.clone()),
                orchestrator_compaction_threshold: resolved.compaction_threshold,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: workspace_cwd.clone(),
                config_cwd: resolved.config_cwd.clone(),
                working_directory: working_directory.clone(),
                worker_executable: resolved.options.worker_executable.clone(),
                sandbox: None,
                ssh: None,
                mcp: mcp.clone(),
                skills: self.guidance.skills.clone(),
                extra_tool_defs: mcp
                    .as_ref()
                    .map(|registry| registry.model_tool_definitions())
                    .unwrap_or_default(),
                agents_md_message,
                thread_timeout_secs: resolved.worker_thread_timeout_secs,
                light_client: None,
                permission_rules: resolved.config.permissions.rules.clone(),
            },
            custody,
        )?;
        let session_id = source.binding().session_id.clone();
        let mut snapshot = sessions::new_snapshot(
            session_id.clone(),
            workspace_cwd.clone(),
            settings.model.clone(),
            settings.base_url.clone(),
            settings.backend,
            settings.reasoning_effort,
            None,
            None,
            agent.messages.clone(),
            settings.api_key_env.clone(),
            settings.extra_headers.clone(),
        );
        snapshot.behavior = behavior;
        snapshot.allow_insecure_http = settings.allow_insecure_http;
        snapshot.project_id = source.binding().project_id.clone();
        snapshot.orchestrator_compaction_threshold = resolved.compaction_threshold;
        snapshot.light_model = None; // Selection above explicitly required absence.
                                     // Bind the actual snapshot BEFORE initial service composition. This is
                                     // the canonical source owner command, not a copied hash or stamped service.
        source.bind_prepared_snapshot(&snapshot)?;
        self.participant.check_preparation_current()?;
        custody.check_current()?;
        let prepared = PreparedSessionRunConfig::new(
            OrchestratorRunConfig {
                agent,
                client,
                session: OrchestratorSession::Active {
                    session_id,
                    store_path: resolved.store_path.clone(),
                    snapshot,
                },
                sandbox_status: "off".to_owned(),
                agents_md_status: self.guidance.agents_md.status_text(),
                workspace_display: working_directory,
                workspace_git: Some(GitTarget::local(workspace_cwd.clone())),
                resume_base_cwd: workspace_cwd,
            },
            session_worktree::RollbackGuard::new(None),
        );
        let (run_config, resources) = prepared.into_parts();
        let parts = SessionService::from_protected_run_config(run_config, custody)?;
        // The service already owns its original event bus and projection.
        // As on ordinary creation, no second projection/event owner is needed.
        // No fallible work after custody moves; retain the real prepared
        // allocation before the later borrowed asynchronous issuance.
        self.prepared = Some(PreparedCreatePublication::retain(
            parts.service,
            resources,
            self.custody
                .take()
                .ok_or_else(|| anyhow::anyhow!("original checked custody absent"))?,
        ));
        Ok(())
    }
    pub(in crate::runtime) async fn try_issue(
        &mut self,
    ) -> Result<crate::session_service::AdmittedSessionPublication> {
        self.participant.check_preparation_current()?;
        self.guidance._reads.check_current()?;
        let publication = self
            .prepared
            .as_mut()
            .ok_or_else(|| anyhow::anyhow!("CREATE build incomplete"))?
            .try_issue()
            .await?;
        self.issued = true;
        Ok(publication)
    }
}

// Same existing two-part guidance ordering; no source IO or fallback loading.
fn combine_system_guidance(primary: Option<String>, secondary: Option<String>) -> Option<String> {
    match (primary, secondary) {
        (Some(primary), Some(secondary)) => Some(format!("{primary}\n\n{secondary}")),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

impl Drop for ProtectedCreateBuild {
    fn drop(&mut self) {
        if !self.issued {
            self.participant.deny();
            if let Some(custody) = &self.custody {
                custody.deny_runtime();
            }
        }
        // The original supervisor must still join actual cleanup. Denial is
        // never a physical fate receipt or permission to release claims.
    }
}
