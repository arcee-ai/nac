use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::sync::watch;

use crate::events::{AgentEvent, AssistantStreamDelta, EventSink, SessionRunId};
use crate::mcp::McpRegistry;
use crate::model::{CoalescedDeltas, DeltaSink, ModelClient, ModelStreamDelta, TokenUsage};
use crate::sandbox::{SandboxSession, SshConnection};
use crate::skills::SkillRegistry;
use crate::tools::{self, ToolResult, ToolRuntime};
use crate::types::{Message, ToolCall, ToolDefinition};

mod compaction;
mod failed_tool_round;
mod heartbeat;
mod mcp_refresh;
#[cfg(test)]
mod mcp_refresh_tests;
mod model_refresh;
pub(crate) mod preview;
mod prompt_rendering;
mod questions;
mod tool_exec;
mod transcript_commit;
mod transcript_messages;
mod transcript_state;
mod web_capabilities;

#[cfg(test)]
mod compaction_integration_tests;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod terminal_selection_delivery_tests;
#[cfg(test)]
mod transcript_log_tests;

#[cfg(test)]
pub(crate) const DIRECT_COMPACTION_PROMPT_POLICY_VERSION_FOR_TEST: u32 =
    compaction::DIRECT_PROMPT_POLICY_VERSION;
#[cfg(test)]
pub(crate) fn direct_compaction_checkpoint_digests_for_test(
    messages: &[crate::types::Message],
    boundary: usize,
) -> ([u8; 32], [u8; 32]) {
    compaction::checkpoint_digests(messages, boundary)
}
pub(crate) use compaction::{
    CompactionCompletion, CompactionError, CompactionLifecycle, CompactionResult,
};
use compaction::{CompactionState, PreparedProviderView};
use failed_tool_round::failed_tool_round;
pub(crate) use preview::key_arg_preview;
use preview::*;
pub(crate) use prompt_rendering::{
    render_direct_system_prompt, render_general_child_system_prompt,
};
use tool_exec::{execute_tools_parallel, finalize_tool_results};
pub(crate) use transcript_messages::TranscriptMessages;
pub(crate) use transcript_state::truncate_incomplete_tool_turn;
use transcript_state::{
    acquire_transcript_operation_lease_and_snapshot, append_to_initial_system_message,
    incomplete_tool_turn_index, missing_tool_result_ids, transcripts_match,
};
use web_capabilities::NativeWebCapabilities;

const TOOL_ARGS_DETAIL_LIMIT: usize = 8_192;
pub(crate) const RUN_CANCELLED_MARKER: &str = "[run cancelled by user]";
pub(crate) const RUN_FAILED_PARTIAL_MARKER: &str =
    "[run failed after this partial assistant response]";
type RecoveredRunFailure = (String, crate::run_failure::RunFailure);

/// What a turn that answered with neither prose nor a tool call is asked next.
///
/// Providers that split reasoning out of the response can swallow a whole turn
/// into the reasoning channel, leaving nothing behind (see
/// `model::pseudo_tool_calls`). One nudge is enough to tell that apart from a
/// model that genuinely has nothing left to say: the retry either produces the
/// answer or the turn fails loudly instead of reporting an empty success.
const EMPTY_TURN_NUDGE: &str = "Your last turn arrived empty: no answer and no tool call. \
Reply with your answer as ordinary text, or issue the tool call you meant to make.";

/// Flash-class models can ignore a correct tool error and retry the same call
/// forever (`write` + `expected_revision: null` on an existing file). The
/// error stays on the tool result; this stops the run after the identical
/// failing round has repeated enough times to be a loop.
const REPEATED_TOOL_FAILURE_LIMIT: usize = 3;

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunPromptCommitStatus {
    Pending,
    Committed,
    Failed,
}

pub struct AgentConfig {
    pub store_path: PathBuf,
    pub session_id: Option<String>,
    pub orchestrator_compaction_threshold: Option<u64>,
    pub initial_messages: Vec<Message>,
    pub event_sink: EventSink,
    pub workspace_cwd: PathBuf,
    /// Local cwd for nac config/store paths; differs from workspace_cwd for SSH.
    pub config_cwd: PathBuf,
    pub working_directory: String,
    pub sandbox: Option<SandboxSession>,
    /// How to reach the host of a remote session; mutually exclusive with sandbox.
    pub ssh: Option<SshConnection>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub extra_tool_defs: Vec<ToolDefinition>,
    pub agents_md_message: Option<String>,
    pub permission_rules: Vec<crate::permissions::PermissionRule>,
}

type McpObservation = Arc<dyn Fn(EventSink) + Send + Sync>;

pub struct Agent {
    client: ModelClient,
    pub messages: TranscriptMessages,
    tool_defs: Vec<ToolDefinition>,
    fallback_tool_defs: Vec<ToolDefinition>,
    base_tool_defs: Vec<ToolDefinition>,
    admission_controlled_tools: bool,
    direct_primary: bool,
    product_context_eligible: bool,
    native_web_capabilities: NativeWebCapabilities,
    compaction: Option<CompactionState>,
    tool_runtime: ToolRuntime,
    event_sink: EventSink,
    mcp_observation: Option<McpObservation>,
    mcp_mounts: Arc<crate::mcp::SessionMcpMounts>,
    current_run_id: Option<String>,
    /// Transcript log sink for persistent sessions; see store/transcript.rs.
    transcript_log: Option<TranscriptLogSink>,
    /// Exclusive upper bound of transcript log rows this process has
    /// committed or adopted (restore/refresh). Durable rows at or beyond
    /// this position were committed by a peer while it held the session
    /// operation lease, so the terminal normalization paths must never
    /// delete them from stale in-memory boundaries (shared-store recovery,
    /// issue #146).
    committed_log_len: u64,
    /// Non-authoritative bound for a submitted append. Cancellation resolves
    /// it against durable state after the writer has finished.
    pending_log_end: Option<u64>,
    /// Exact submitted message retained until an uncertain commit is replayed.
    unacknowledged_log_message: Option<(u64, Message)>,
    /// Start index of a direct-inbox append whose blocking transaction has
    /// been submitted but whose canonical User rows have not yet been adopted
    /// into `messages`. Tokio task abort cannot cancel that transaction, so
    /// terminal normalization must reload rather than delete this exact tail.
    direct_inbox_append_start: Option<u64>,
    /// Set before an atomic steering transcript/ack commit is submitted and
    /// cleared only after its result is adopted. If the run task is aborted,
    /// cancellation waits on the transcript writer and reloads whichever
    /// durable outcome actually won.
    prompt_commit_pending: bool,
    /// User-facing notice set only when restore repaired a validly encoded
    /// non-contiguous transcript tail.
    transcript_recovery_warning: Option<String>,
    /// Set only when this process atomically settled a prior active run as a
    /// failure during resume. Consumed once when the session bus is built.
    recovered_run_failure: Option<RecoveredRunFailure>,
    /// Token usage from the most recent `send()` call, updated after each
    /// model call; `None` if the provider omitted usage.
    pub last_usage: Option<crate::model::TokenUsage>,
    /// Output received from the provider for the model call currently in
    /// flight. Deltas remain live-only during an ordinary run, but keeping a
    /// local copy lets cancellation commit the text the user already saw.
    partial_stream: StdMutex<ModelStreamDelta>,
}

/// Path-backed writer and identity needed to append to the session
/// transcript log. The writer is shared into `spawn_blocking` closures per
/// operation.
struct TranscriptLogSink {
    writer: Arc<crate::store::TranscriptLogWriter>,
    session_id: String,
    store_path: PathBuf,
}

/// The durable run a prompt starts, and where the prompt came from.
struct SessionRunPrompt<'a> {
    run_id: &'a SessionRunId,
    prompt_commit: watch::Sender<RunPromptCommitStatus>,
    inbox_prompt: Option<crate::store::RunInboxPrompt>,
    /// What a person typed, for a prompt from a human-facing route.
    review_intent: Option<String>,
}

impl Agent {
    pub fn with_config(client: ModelClient, config: AgentConfig) -> Result<Self> {
        let client = client.with_prompt_cache_key(config.session_id.clone());
        let cwd = config.working_directory.clone();
        let traditional_child = config
            .session_id
            .as_deref()
            .map(|session_id| crate::store::load_traditional_child(&config.store_path, session_id))
            .transpose()?
            .flatten();
        let compaction = config.session_id.clone().map(|session_id| {
            CompactionState::new(
                config.store_path.clone(),
                session_id,
                config.orchestrator_compaction_threshold,
            )
        });
        let transcript_log = config
            .session_id
            .clone()
            .map(|session_id| {
                Ok::<_, anyhow::Error>(TranscriptLogSink {
                    writer: Arc::new(crate::store::TranscriptLogWriter::new(&config.store_path)?),
                    session_id,
                    store_path: config.store_path.clone(),
                })
            })
            .transpose()?;
        let (mut system_prompt, mut tool_defs) = match traditional_child.as_ref() {
            Some(child) => (
                render_general_child_system_prompt(&cwd, &child.description),
                tools::coding_tool_definitions(client.supports_image_tool_results()),
            ),
            None => (
                render_direct_system_prompt(&cwd),
                tools::direct_tool_definitions(client.supports_image_tool_results()),
            ),
        };
        if traditional_child.is_none() {
            system_prompt.push_str(&crate::guide::primary_prompt());
        } else {
            tool_defs.push(tools::guide::definition());
        }
        if config.ssh.is_some() || config.sandbox.is_some() {
            tool_defs.retain(|definition| {
                !tools::TASK_FOLLOWUP_TOOL_NAMES.contains(&definition.function.name.as_str())
            });
        }
        let base_tool_defs = tool_defs.clone();
        if config
            .extra_tool_defs
            .iter()
            .any(|definition| definition.function.name == tools::guide::NAME)
        {
            anyhow::bail!("nac_guide is a reserved first-party capability name");
        }
        tool_defs.extend(config.extra_tool_defs);
        let native_web_capabilities =
            NativeWebCapabilities::new(&config.store_path, config.session_id.as_deref())?;
        if tool_defs
            .iter()
            .any(|definition| tools::WEB_TOOL_NAMES.contains(&definition.function.name.as_str()))
        {
            anyhow::bail!("web_search and web_fetch are reserved first-party capability names");
        }

        let mut messages = vec![Message::System {
            content: system_prompt,
        }];
        if let Some(agents_md_message) = config.agents_md_message {
            append_to_initial_system_message(&mut messages, &agents_md_message);
        }
        messages.extend(config.initial_messages);

        let local_paths = crate::paths::PathContext::new(&config.config_cwd);
        let mcp_observation = config
            .mcp
            .as_ref()
            .map(|mcp| mcp.register_event_sink(config.event_sink.clone()));
        let mcp_mounts = Arc::new(crate::mcp::SessionMcpMounts::new(config.mcp.clone()));
        let workspace_lease_identity =
            crate::workspace::workspace_lease_identity(config.ssh.as_ref(), &config.workspace_cwd);
        let backend = crate::sandbox::select_execution_backend(
            config.ssh,
            config.sandbox,
            &config.workspace_cwd,
            &local_paths,
        )?;
        let terminal_manager = crate::terminal::TerminalManager::for_direct();
        terminal_manager
            .configure_workspace_authority(config.store_path.clone(), workspace_lease_identity);
        if let Some(session_id) = config.session_id.as_ref() {
            terminal_manager.configure_remote_cleanup_authority(
                config.store_path.clone(),
                session_id.clone(),
                Arc::clone(&backend),
            )?;
        }
        let allowed_tools = Arc::new(
            tool_defs
                .iter()
                .map(|definition| definition.function.name.clone())
                .collect(),
        );
        let fallback_tool_defs = tool_defs.clone();
        let goal_runtime = match (config.session_id.as_ref(), traditional_child.as_ref()) {
            (Some(session_id), None) => Some(Arc::new(crate::goals::GoalRuntime::new(
                config.store_path.clone(),
                session_id.clone(),
            ))),
            _ => None,
        };
        // The initial messages are exactly the snapshot blob written at
        // session creation; the log tail starts at this length.
        let committed_log_len = messages.len() as u64;
        let run_admission = Arc::new(crate::tools::RunAdmission::default());
        let agent = Self {
            client,
            messages: messages.into(),
            tool_defs,
            fallback_tool_defs,
            base_tool_defs,
            admission_controlled_tools: true,
            direct_primary: true,
            product_context_eligible: traditional_child.is_none(),
            native_web_capabilities,
            compaction,
            tool_runtime: ToolRuntime {
                product_context: None,
                workspace_cwd: config.workspace_cwd,
                config_cwd: config.config_cwd,
                store_path: config.store_path,
                session_id: config.session_id,
                run_admission,
                event_sink: config.event_sink.clone(),
                backend,
                mcp: config.mcp.clone(),
                mcp_tools: Arc::new(HashMap::new()),
                skills: config.skills,
                terminal_manager,
                command_cancellation: crate::tools::RunCancellation::default(),
                allowed_tools: Some(allowed_tools),
                permission_broker: None,
                permission_reviewer: None,
                permission_rules: Arc::new(config.permission_rules.clone()),
                goal_runtime,
                task_question_answers: None,
                heartbeat_human_request: None,
                heartbeat_execution: false,
                heartbeat_goal_id: None,
                heartbeat_schedule: None,
                heartbeat_needs_human_action: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                command_environment: None,
                web_credential: None,
                command_redactions: Arc::new(StdMutex::new(HashMap::new())),
            },
            event_sink: config.event_sink,
            mcp_observation,
            mcp_mounts,
            current_run_id: None,
            transcript_log,
            committed_log_len,
            pending_log_end: None,
            unacknowledged_log_message: None,
            direct_inbox_append_start: None,
            prompt_commit_pending: false,
            transcript_recovery_warning: None,
            recovered_run_failure: None,
            last_usage: None,
            partial_stream: StdMutex::new(ModelStreamDelta::default()),
        };
        agent.native_web_capabilities.register_parent(
            &agent.tool_runtime.store_path,
            agent.tool_runtime.session_id.as_deref(),
        );
        Ok(agent)
    }

    /// Attach an optional process-environment provider after session
    /// construction. This does not alter the model-visible capability set.
    pub fn set_command_environment_provider(
        &mut self,
        provider: Option<Arc<dyn nac_contracts::CommandEnvironmentProvider>>,
    ) {
        if let Some(broker) = &self.tool_runtime.permission_broker {
            broker.set_command_environment(provider.clone());
        }
        self.tool_runtime.command_environment = provider;
    }

    pub(crate) fn runtime_tool_count(&self) -> Option<usize> {
        self.tool_runtime
            .allowed_tools
            .as_ref()
            .map(|names| names.len())
    }

    /// Host composition binds this port to one serving owner and exact session.
    /// Child capability limits stay unchanged.
    pub fn bind_product_context(
        &mut self,
        port: Arc<dyn crate::product_context::ProductContextPort>,
    ) -> Result<()> {
        if !self.product_context_eligible {
            return Ok(());
        }
        let definitions = crate::tools::product_context_tool_definitions();
        if self.tool_defs.iter().any(|definition| {
            crate::tools::PRODUCT_CONTEXT_TOOL_NAMES.contains(&definition.function.name.as_str())
        }) {
            anyhow::bail!("product-context capability name collision");
        }
        self.base_tool_defs.extend(definitions.clone());
        self.fallback_tool_defs.extend(definitions.clone());
        self.tool_defs.extend(definitions);
        self.tool_runtime.product_context = Some(port);
        self.tool_runtime.allowed_tools = Some(Arc::new(
            self.tool_defs
                .iter()
                .map(|definition| definition.function.name.clone())
                .collect(),
        ));
        Ok(())
    }

    pub(crate) fn admit_native_web_generation(&mut self) -> Result<()> {
        self.native_web_capabilities.admit_generation()
    }

    /// Build one immutable capability view for the next model request and tool round.
    fn refresh_model_request_capabilities(&mut self) -> Result<Vec<ToolDefinition>> {
        let credential = self.native_web_capabilities.resolve_credential()?;
        Ok(self.install_capabilities(credential))
    }

    fn install_capabilities(&mut self, credential: Option<String>) -> Vec<ToolDefinition> {
        let credential = credential
            .map(crate::tools::web::ExaCredential::new)
            .map(Arc::new);
        let mut definitions = self
            .tool_runtime
            .model_tool_definitions(&self.base_tool_defs, &self.fallback_tool_defs);
        if credential.is_some() {
            definitions.extend(crate::tools::web::definitions());
        }
        self.tool_runtime.allowed_tools = Some(Arc::new(
            definitions
                .iter()
                .map(|definition| definition.function.name.clone())
                .collect(),
        ));
        self.tool_runtime.web_credential = credential;
        self.tool_defs.clone_from(&definitions);
        definitions
    }

    fn refresh_compaction_tool_definitions(&mut self) {
        let web_definitions: Vec<_> = self
            .tool_defs
            .iter()
            .filter(|definition| {
                crate::tools::WEB_TOOL_NAMES.contains(&definition.function.name.as_str())
            })
            .cloned()
            .collect();
        self.tool_defs = self
            .tool_runtime
            .model_tool_definitions(&self.base_tool_defs, &self.fallback_tool_defs);
        self.tool_defs.extend(web_definitions);
    }

    #[cfg(test)]
    fn model_request_capabilities_for_test(
        &mut self,
        credential: Option<&str>,
    ) -> Vec<ToolDefinition> {
        self.install_capabilities(credential.map(str::to_string))
    }

    #[cfg(test)]
    pub fn default(client: ModelClient) -> Self {
        let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let working_directory = workspace_cwd.display().to_string();

        Self::with_config(
            client,
            AgentConfig {
                store_path: crate::store::default_store_path(),
                session_id: None,
                orchestrator_compaction_threshold: None,
                initial_messages: Vec::new(),
                event_sink: EventSink::none(),
                workspace_cwd: workspace_cwd.clone(),
                config_cwd: workspace_cwd,
                working_directory,
                sandbox: None,
                ssh: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                permission_rules: Vec::new(),
            },
        )
        .expect("default test agent config must be valid")
    }

    /// Verify the execution backend before model traffic.
    pub async fn ensure_backend_ready(&self) -> Result<()> {
        self.tool_runtime.backend.ensure_ready().await
    }

    /// Returns a clone of the sandbox session if the execution backend is
    /// a sandbox, or `None` for local/SSH backends.  The clone is cheap
    /// (inner data is behind `Arc`).
    pub fn sandbox_session(&self) -> Option<SandboxSession> {
        match self.tool_runtime.backend.as_ref() {
            crate::sandbox::ExecutionBackend::Sandbox(session) => Some(session.clone()),
            _ => None,
        }
    }

    /// The session's skill registry, when any skills were discovered at
    /// launch. The clone is cheap (the registry is behind `Arc`).
    pub fn skills(&self) -> Option<Arc<SkillRegistry>> {
        self.tool_runtime.skills.clone()
    }

    /// The registry used by the current model/tool round. A session refresh
    /// replaces it only at the following model boundary.
    #[allow(
        dead_code,
        reason = "supported runtime accessor retained for external callers"
    )]
    pub fn mcp_registry(&self) -> Option<Arc<McpRegistry>> {
        self.tool_runtime.mcp.clone()
    }

    pub(crate) fn user_terminal_runtime(&self) -> Option<ToolRuntime> {
        self.direct_primary.then(|| {
            let mut runtime = self.tool_runtime.clone();
            // Human shell ownership must not observe the model run's cancel token.
            runtime.command_cancellation = crate::tools::RunCancellation::default();
            // Shell capabilities do not use imported tools. Keeping a registry
            // here would pin replaced MCP connections for the terminal's lifetime.
            runtime.mcp = None;
            runtime.mcp_tools = Arc::new(HashMap::new());
            runtime
        })
    }

    pub(crate) fn shell_execution_context(&self) -> Result<(ToolRuntime, ModelClient)> {
        anyhow::ensure!(
            self.direct_primary,
            "human shell commands require a direct primary"
        );
        let mut runtime = self.tool_runtime.clone();
        runtime.command_cancellation = crate::tools::RunCancellation::default();
        runtime.mcp = None;
        runtime.mcp_tools = Arc::new(HashMap::new());
        Ok((runtime, self.client.clone()))
    }

    pub(crate) fn terminal_manager(&self) -> crate::terminal::TerminalManager {
        self.tool_runtime.terminal_manager.clone()
    }

    pub(crate) fn goal_runtime(&self) -> Option<Arc<crate::goals::GoalRuntime>> {
        self.tool_runtime.goal_runtime.clone()
    }

    #[cfg(test)]
    pub async fn send(&mut self, prompt: &str) -> Result<String> {
        self.admit_native_web_generation()?;
        self.send_inner(prompt, None).await
    }

    pub(crate) async fn send_session_run(
        &mut self,
        prompt: &str,
        run_id: &SessionRunId,
        prompt_commit: watch::Sender<RunPromptCommitStatus>,
        inbox_prompt: Option<crate::store::RunInboxPrompt>,
        review_intent: Option<String>,
    ) -> Result<String> {
        self.capture_heartbeat_request(
            inbox_prompt.as_ref().map(crate::store::RunInboxPrompt::id),
            review_intent.as_deref(),
        )
        .await;
        if let Some(goals) = &self.tool_runtime.goal_runtime {
            goals.begin_run(run_id.as_str());
        }
        self.send_inner(
            prompt,
            Some(SessionRunPrompt {
                run_id,
                prompt_commit,
                inbox_prompt,
                review_intent,
            }),
        )
        .await
    }

    async fn send_inner(
        &mut self,
        prompt: &str,
        session_run: Option<SessionRunPrompt<'_>>,
    ) -> Result<String> {
        self.refresh_model_at_operation_boundary();
        if session_run.is_none() {
            self.tool_runtime.heartbeat_human_request = None;
            self.bind_heartbeat_execution(None);
        }
        let correlation =
            crate::telemetry::Correlation::session(self.tool_runtime.session_id.as_deref())
                .with_run(session_run.as_ref().map(|run| run.run_id.as_str()));
        let _runtime_activity = Some(crate::telemetry::RuntimeActivityGuard::start(
            crate::telemetry::RuntimeActivity::Direct,
            correlation,
        ));
        self.emit(AgentEvent::RunStarted {
            thread_name: None,
            prompt_preview: preview(prompt, 160),
        })
        .await;
        // `last_usage` is per-send. Clearing it prevents a cancellation before
        // the first current model response from persisting a previous run's usage.
        self.last_usage = None;
        self.clear_partial_stream();
        // Transcript commit point (prompt): the prompt and its recovery row
        // are durable before the first model call. A store failure is fatal.
        let prompt_message = Message::User {
            content: prompt.to_string(),
        };
        let prompt_result = match session_run.as_ref() {
            Some(run) => {
                self.push_and_log_run_prompt(
                    prompt_message,
                    run.run_id,
                    run.inbox_prompt.clone(),
                    run.review_intent.clone(),
                )
                .await
            }
            None => self.push_and_log(prompt_message).await,
        };
        if let Some(run) = session_run {
            run.prompt_commit.send_replace(if prompt_result.is_ok() {
                RunPromptCommitStatus::Committed
            } else {
                RunPromptCommitStatus::Failed
            });
        }
        if let Err(error) = prompt_result {
            self.emit(AgentEvent::Error {
                thread_name: None,
                message: error.to_string(),
            })
            .await;
            self.record_terminal_cleanup_error().await;
            return Err(error);
        }

        if let Err(error) = self.ensure_backend_ready().await {
            self.emit(AgentEvent::Error {
                thread_name: None,
                message: error.to_string(),
            })
            .await;
            self.record_terminal_cleanup_error().await;
            return Err(error);
        }

        let mut iteration = 0usize;
        let mut empty_turn_nudged = false;
        let mut last_failure_signature: Option<String> = None;
        let mut last_failure_detail = String::new();
        let mut repeated_failures = 0usize;
        let mut accumulated_usage = TokenUsage::default();
        if let Some(broker) = &self.tool_runtime.permission_broker {
            broker.begin_review_run();
        }
        loop {
            self.append_pending_guidance_checked().await?;
            self.admit_mcp_mount_refresh().await?;
            let mut request_tool_defs = self.refresh_model_request_capabilities()?;
            let mount_revision_before_compaction = self.mcp_mounts.revision();
            let needs_compaction_view = self
                .compaction
                .as_mut()
                .is_some_and(|compaction| !compaction.is_passthrough(&self.messages));
            let mut provider_view = if needs_compaction_view {
                match self
                    .prepare_provider_view(&mut accumulated_usage, &request_tool_defs)
                    .await
                {
                    Ok(view) => view,
                    Err(error) => {
                        self.last_usage = Some(accumulated_usage.clone());
                        self.emit(AgentEvent::Error {
                            thread_name: None,
                            message: error.to_string(),
                        })
                        .await;
                        self.record_terminal_cleanup_error().await;
                        return Err(error);
                    }
                }
            } else {
                PreparedProviderView {
                    messages: self.messages.to_vec(),
                    context_estimate: 0,
                    checkpoint_id: None,
                }
            };
            if needs_compaction_view {
                // A summary is its own model request. A refresh requested
                // while it was in flight belongs to the ordinary request that
                // follows, not to another turn after that request's tool round.
                self.admit_mcp_mount_refresh().await?;
                if self.mcp_mounts.revision() != mount_revision_before_compaction {
                    request_tool_defs = self.refresh_model_request_capabilities()?;
                }
            }
            self.project_mcp_instructions(&mut provider_view.messages);
            iteration = iteration.saturating_add(1);
            self.emit(AgentEvent::ModelCallStarted {
                thread_name: None,
                iteration,
            })
            .await;

            let call_started = Instant::now();
            self.clear_partial_stream();
            let deltas = CoalescedDeltas::new(|delta: ModelStreamDelta| {
                self.event_sink
                    .emit_assistant_delta(AssistantStreamDelta::from_model(None, delta));
            });
            let push_delta = |delta: ModelStreamDelta| {
                {
                    let mut partial = self
                        .partial_stream
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner);
                    partial.clear_if_reset(&delta);
                    partial.text.push_str(&delta.text);
                    partial.reasoning.push_str(&delta.reasoning);
                }
                deltas.push(delta);
            };
            // Use the cheaper buffered request shape when nobody is watching.
            let delta_sink: DeltaSink<'_> = self
                .event_sink
                .wants_assistant_deltas()
                .then_some(&push_delta);
            let model_call = self.client.send_turn_streaming(
                provider_view.messages,
                request_tool_defs,
                delta_sink,
            );
            let turn = model_call.await;
            // Whatever arrived in the last partial window still belongs on screen.
            deltas.flush();
            let response = match turn {
                Ok(response) => response,
                Err(error) => {
                    // Preserve accumulated usage from prior rounds and summaries
                    // so it survives the error return.
                    self.last_usage = Some(accumulated_usage.clone());
                    // The provider's own words about the call it refused: the
                    // one error class worth showing rather than reducing to
                    // "operation failed".
                    self.emit(AgentEvent::ModelError {
                        thread_name: None,
                        message: error.to_string(),
                    })
                    .await;
                    self.record_terminal_cleanup_error().await;
                    return Err(error);
                }
            };
            let ordinary_context_tokens = response
                .usage
                .as_ref()
                .and_then(TokenUsage::valid_provider_context);
            if let Some(mut usage) = response.usage.clone() {
                accumulated_usage.add_cost_saturating(&usage);
                // Missing, inconsistent, or overflowing provider totals are
                // not context samples. Compaction uses its deterministic
                // pre-call estimate instead.
                let context = ordinary_context_tokens.unwrap_or(provider_view.context_estimate);
                usage.replace_context(context);
                accumulated_usage.replace_context(context);
                self.last_usage = Some(accumulated_usage.clone());
                if let Some(goals) = &self.tool_runtime.goal_runtime {
                    goals.update_usage(&accumulated_usage);
                }
                self.emit(AgentEvent::TokenUsageUpdated {
                    thread_name: None,
                    usage,
                })
                .await;
            }
            if response.finish_reason.as_deref() == Some("length") {
                if let Some(compaction) = &mut self.compaction {
                    compaction.record_ordinary_context(
                        &self.messages,
                        ordinary_context_tokens.unwrap_or(0),
                        self.messages.len(),
                        provider_view.checkpoint_id,
                    );
                }
                let error = anyhow!(
                    "Context window full (finish_reason=length). The model call remains terminal; retry with a narrower prompt, a fresh thread, or less carried context."
                );
                self.last_usage = Some(accumulated_usage.clone());
                self.emit(AgentEvent::Error {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                return Err(error);
            }

            let has_tool_calls = response
                .assistant
                .tool_calls
                .as_ref()
                .map(|tool_calls| !tool_calls.is_empty())
                .unwrap_or(false);

            // Transcript commit point (assistant): durable at push.
            if let Err(error) = self
                .push_and_log(Message::Assistant {
                    content: response.assistant.content.clone(),
                    reasoning_text: response.assistant.reasoning_text.clone(),
                    reasoning_details: response.assistant.reasoning_details.clone(),
                    tool_calls: response.assistant.tool_calls.clone(),
                    duration_ms: Some(duration_millis(call_started.elapsed())),
                    model_origin: Some(self.client.model_origin()),
                    reasoning_field: response.assistant.reasoning_field.clone(),
                })
                .await
            {
                // Preserve accumulated usage, mirroring the model-call error
                // path above.
                self.last_usage = Some(accumulated_usage.clone());
                self.emit(AgentEvent::Error {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                return Err(error);
            }
            self.clear_partial_stream();
            if let Some(compaction) = &mut self.compaction {
                compaction.record_committed_assistant_context(
                    &self.messages,
                    ordinary_context_tokens.unwrap_or(0),
                    provider_view.checkpoint_id,
                );
            }

            if !has_tool_calls {
                if self.append_pending_guidance_checked().await? > 0 {
                    continue;
                }
                let answer = response
                    .assistant
                    .content
                    .filter(|content| !content.trim().is_empty());
                let Some(content) = answer else {
                    if !empty_turn_nudged {
                        empty_turn_nudged = true;
                        if let Err(error) = self
                            .push_and_log(Message::User {
                                content: EMPTY_TURN_NUDGE.to_string(),
                            })
                            .await
                        {
                            self.last_usage = Some(accumulated_usage.clone());
                            self.emit(AgentEvent::Error {
                                thread_name: None,
                                message: error.to_string(),
                            })
                            .await;
                            self.record_terminal_cleanup_error().await;
                            return Err(error);
                        }
                        continue;
                    }
                    // Reporting this as an answer is what let an empty run pass
                    // for a finished one, and cost the caller a blind re-dispatch.
                    let error = anyhow!(
                        "The model answered twice with neither text nor a tool call, so this run has nothing to report. Retry with a more concrete action, or split the work across smaller threads."
                    );
                    self.last_usage = Some(accumulated_usage.clone());
                    self.emit(AgentEvent::Error {
                        thread_name: None,
                        message: error.to_string(),
                    })
                    .await;
                    self.record_terminal_cleanup_error().await;
                    return Err(error);
                };
                self.emit(AgentEvent::AssistantMessage {
                    thread_name: None,
                    content: content.clone(),
                    usage: Some(accumulated_usage.clone()),
                })
                .await;
                self.last_usage = Some(accumulated_usage.clone());
                if let Err(error) = self.tool_runtime.terminal_manager.settle_run().await {
                    self.emit(AgentEvent::Error {
                        thread_name: None,
                        message: error.to_string(),
                    })
                    .await;
                    return Err(error);
                }
                self.emit(AgentEvent::RunFinished { thread_name: None })
                    .await;
                return Ok(content);
            }

            // Only consecutive empty turns are a stuck model, so a turn that
            // acted earns the next one a fresh nudge.
            empty_turn_nudged = false;

            let tool_calls = response.assistant.tool_calls.unwrap_or_default();
            let results = execute_tools_parallel(
                tool_calls.clone(),
                self.tool_runtime.clone(),
                self.client.clone(),
                self.event_sink.clone(),
                self.admission_controlled_tools,
            )
            .await;
            let repeated_identical_failure = match failed_tool_round(&tool_calls, &results) {
                Some(round)
                    if last_failure_signature.as_deref() == Some(round.signature.as_str()) =>
                {
                    last_failure_detail = round.detail;
                    repeated_failures = repeated_failures.saturating_add(1);
                    repeated_failures >= REPEATED_TOOL_FAILURE_LIMIT
                }
                Some(round) => {
                    last_failure_signature = Some(round.signature);
                    last_failure_detail = round.detail;
                    repeated_failures = 1;
                    false
                }
                None => {
                    last_failure_signature = None;
                    last_failure_detail.clear();
                    repeated_failures = 0;
                    false
                }
            };
            let failure_detail = last_failure_detail.clone();
            let tool_messages =
                finalize_tool_results(&self.messages, results, &self.event_sink).await;

            if self.tool_runtime.command_cancellation.is_cancelled() {
                let error = anyhow!("command cancelled");
                self.emit(AgentEvent::Error {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                return Err(error);
            }

            self.last_usage = Some(accumulated_usage.clone());
            if let Some(goals) = &self.tool_runtime.goal_runtime {
                goals.update_usage(&accumulated_usage);
            }

            // Transcript commit point (tool results): the complete parallel
            // batch is logged atomically before any of it enters the
            // transcript, so the loop re-enters provider-view preparation
            // only after the complete batch is both durable and appended.
            if let Err(error) = self.push_batch_and_log(tool_messages).await {
                self.last_usage = Some(accumulated_usage.clone());
                self.emit(AgentEvent::Error {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                return Err(error);
            }
            if let Some(content) = self.yield_for_question(&accumulated_usage).await? {
                return Ok(content);
            }
            if let Some(reason) = self
                .tool_runtime
                .permission_broker
                .as_ref()
                .and_then(|broker| broker.take_review_stop())
            {
                // Automatic review limits span variants of a blocked request,
                // which the identical-failure guard below cannot see.
                let error = anyhow!("{reason}");
                self.emit(AgentEvent::ModelError {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                return Err(error);
            }
            if repeated_identical_failure {
                let error = anyhow!(
                    "Stopped after {REPEATED_TOOL_FAILURE_LIMIT} identical tool failures: {failure_detail}"
                );
                // Use the same sanitized error channel as a provider refusal.
                self.emit(AgentEvent::ModelError {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                return Err(error);
            }
        }
    }

    pub(crate) fn end_goal_run(&self, run_id: &SessionRunId) {
        if let Some(goals) = &self.tool_runtime.goal_runtime {
            goals.end_run(run_id.as_str());
        }
    }

    pub(crate) fn command_cancellation(&self) -> crate::tools::RunCancellation {
        self.tool_runtime.command_cancellation.clone()
    }

    /// Install a fresh cancellation scope for one top-level run. Persistent
    /// direct sessions reuse the agent across turns, so a cancelled command
    /// token must never poison the next run.
    pub(crate) fn begin_run_cancellation(&mut self) -> crate::tools::RunCancellation {
        let cancellation = crate::tools::RunCancellation::default();
        self.tool_runtime.command_cancellation = cancellation.clone();
        cancellation
    }

    #[cfg(test)]
    pub(crate) fn provider_messages_for_test(&mut self) -> Vec<Message> {
        match &mut self.compaction {
            Some(compaction) => compaction.prepare(&self.messages, &self.tool_defs).messages,
            None => self.messages.to_vec(),
        }
    }

    #[cfg(test)]
    pub(crate) fn tool_definitions_for_test(&self) -> &[ToolDefinition] {
        &self.tool_defs
    }

    #[cfg(test)]
    pub(crate) fn mcp_for_test(&self) -> Option<&Arc<crate::mcp::McpRegistry>> {
        self.tool_runtime.mcp.as_ref()
    }

    #[cfg(test)]
    pub(crate) fn ssh_control_path_for_test(&self) -> Option<&std::path::Path> {
        match self.tool_runtime.backend.as_ref() {
            crate::sandbox::ExecutionBackend::Ssh(ssh) => Some(ssh.control_path_for_test()),
            _ => None,
        }
    }

    pub fn set_event_sink(&mut self, sink: EventSink) {
        self.event_sink = sink.clone();
        if let Some(observation) = self.mcp_observation.as_ref() {
            observation(sink.clone());
        }
        self.tool_runtime.set_event_sink(sink);
    }

    pub(crate) fn configure_permission_broker(
        &mut self,
        session_config_version: i64,
    ) -> Option<Arc<crate::permissions::PermissionBroker>> {
        if !self.direct_primary {
            return None;
        }
        if let Some(existing) = &self.tool_runtime.permission_broker {
            return Some(Arc::clone(existing));
        }
        let session_id = self.tool_runtime.session_id.clone()?;
        let backend = crate::permissions::PermissionBackend::from_execution_backend(
            self.tool_runtime.backend.as_ref(),
        );
        let broker = Arc::new(crate::permissions::PermissionBroker::new(
            self.tool_runtime.store_path.clone(),
            session_id,
            backend,
            session_config_version,
            self.tool_runtime.permission_rules.as_ref().clone(),
        ));
        broker.set_reviewer(
            self.tool_runtime
                .permission_reviewer
                .clone()
                .unwrap_or_else(crate::model::default_permission_reviewer),
        );
        broker.set_command_environment(self.tool_runtime.command_environment.clone());
        broker.set_review_backend(
            crate::permissions::ReviewBackendSource::from_execution_backend(
                self.tool_runtime.backend.as_ref(),
            ),
        );
        self.tool_runtime.permission_broker = Some(Arc::clone(&broker));
        Some(broker)
    }

    pub(crate) fn run_admission_handle(&self) -> Arc<crate::tools::RunAdmission> {
        Arc::clone(&self.tool_runtime.run_admission)
    }

    pub fn set_current_run_id(&mut self, run_id: Option<String>) {
        self.current_run_id = run_id;
    }

    /// Shared handle to the transcript log writer, present only for
    /// persistent agents with a session id. The session service reads the
    /// log through the same writer for store-backed transcript reads (step
    /// 3), so reads and appends stay serialized without retaining a connection.
    pub fn transcript_log_writer(&self) -> Option<Arc<crate::store::TranscriptLogWriter>> {
        self.transcript_log
            .as_ref()
            .map(|sink| Arc::clone(&sink.writer))
    }

    pub(crate) fn transcript_recovery_warning(&self) -> Option<&str> {
        self.transcript_recovery_warning.as_deref()
    }

    pub(crate) fn set_recovered_run_failure(&mut self, recovered: RecoveredRunFailure) {
        self.recovered_run_failure = Some(recovered);
    }

    pub(crate) fn take_recovered_run_failure(&mut self) -> Option<RecoveredRunFailure> {
        self.recovered_run_failure.take()
    }

    #[cfg(test)]
    pub(crate) async fn push_and_log_for_test(&mut self, message: Message) -> Result<()> {
        self.push_and_log(message).await
    }

    #[cfg(test)]
    pub(crate) async fn push_and_log_run_prompt_for_test(
        &mut self,
        message: Message,
        run_id: &SessionRunId,
    ) -> Result<()> {
        self.push_and_log_run_prompt(message, run_id, None, None)
            .await
    }

    /// Restore a stored transcript while keeping the current system prompt.
    pub fn restore_messages(&mut self, mut messages: Vec<Message>) {
        if let Some(Message::System { content: stored }) = messages.first_mut() {
            if let Some(Message::System { content: fresh }) = self.messages.first() {
                *stored = fresh.clone();
            }
        }
        // The restored transcript claims the durable state through its
        // length: every log row below it was adopted by this process.
        self.committed_log_len = messages.len() as u64;
        self.pending_log_end = None;
        self.unacknowledged_log_message = None;
        self.messages = messages.into();
        if let Some(compaction) = &mut self.compaction {
            compaction.reset_for_transcript_replacement();
        }
    }

    /// Restore from a snapshot blob, then merge any transcript-log tail (rows
    /// with `idx >= blob.len()`) left behind by a crashed run, and normalize
    /// a dangling tool turn in both the restored transcript and the log
    /// (crash-resume normalization). An empty log tail over a clean blob is
    /// exactly [`Agent::restore_messages`] — the pre-log behavior.
    ///
    /// A validly encoded index gap is repaired under the session operation
    /// lease by retaining the longest contiguous prefix and atomically
    /// deleting the untrusted physical suffix. Decode failures remain fatal.
    ///
    /// Returns the current snapshot blob whenever automatic lease acquisition
    /// reloads it or dangling-turn normalization rewrites it, so a caller
    /// holding the pre-lease snapshot can refresh its copy; `None` when the
    /// blob was loaded under the supplied lease and left untouched.
    pub async fn restore_messages_merging_log_tail(
        &mut self,
        messages: Vec<Message>,
        operation_lease: Option<&crate::sessions::SessionOperationLease>,
    ) -> Result<Option<Vec<Message>>> {
        self.transcript_recovery_warning = None;
        let Some(sink) = &self.transcript_log else {
            self.restore_messages(messages);
            return Ok(None);
        };
        let mut blob_len = messages.len() as u64;
        let mut blob_len_usize = messages.len();
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        if let Some(operation_lease) = operation_lease {
            operation_lease
                .validate(&sink.store_path, &session_id)
                .map_err(anyhow::Error::new)?;
        }

        let mut snapshot_messages = messages;
        let mut refreshed_blob = None;
        let mut _acquired_operation_lease = None;
        loop {
            let mut tail = {
                let writer = Arc::clone(&writer);
                let session_id = session_id.clone();
                crate::store::spawn_blocking_store_caller(move || {
                    writer.read_from(&session_id, blob_len)
                })
                .await
                .map_err(|error| anyhow!("transcript log read task failed: {error}"))??
            };

            let mut expected_idx = blob_len;
            let mut gap = None;
            for (idx, _) in &tail {
                if *idx != expected_idx {
                    gap = Some((expected_idx, *idx));
                    break;
                }
                expected_idx = expected_idx
                    .checked_add(1)
                    .ok_or_else(|| anyhow!("transcript log index overflowed"))?;
            }

            if gap.is_some() && operation_lease.is_none() && _acquired_operation_lease.is_none() {
                let (lease, refreshed_messages) = acquire_transcript_operation_lease_and_snapshot(
                    sink.store_path.clone(),
                    Arc::clone(&writer),
                    session_id.clone(),
                )
                .await?;
                if !transcripts_match(&snapshot_messages, &refreshed_messages)? {
                    refreshed_blob = Some(refreshed_messages.clone());
                }
                blob_len_usize = refreshed_messages.len();
                blob_len = blob_len_usize as u64;
                snapshot_messages = refreshed_messages;
                _acquired_operation_lease = Some(lease);
                // Both the snapshot and log may have changed before the lease
                // was acquired. Re-read them under the lease before deciding
                // what physical suffix to drop.
                continue;
            }

            if gap.is_some() {
                let repair_writer = Arc::clone(&writer);
                let repair_session_id = session_id.clone();
                let (repaired_tail, recovery) =
                    crate::store::spawn_blocking_store_caller(move || {
                        repair_writer.read_tail_repairing_gap(&repair_session_id, blob_len)
                    })
                    .await
                    .map_err(|error| anyhow!("transcript log repair task failed: {error}"))??;
                tail = repaired_tail;
                if let Some(recovery) = recovery {
                    let row_label = if recovery.discarded_rows == 1 {
                        "row"
                    } else {
                        "rows"
                    };
                    self.transcript_recovery_warning = Some(format!(
                        "Recovered this session to its last valid message because transcript index {} was missing. Discarded {} untrusted transcript log {row_label} beginning at index {}.",
                        recovery.expected_idx, recovery.discarded_rows, recovery.found_idx
                    ));
                }
            }

            let mut merged = snapshot_messages;
            let mut expected_idx = blob_len;
            for (idx, message) in tail {
                if idx != expected_idx {
                    return Err(anyhow!(
                        "transcript log tail is not contiguous with the snapshot: expected idx {expected_idx}, found {idx}"
                    ));
                }
                merged.push(message);
                expected_idx = expected_idx
                    .checked_add(1)
                    .ok_or_else(|| anyhow!("transcript log index overflowed"))?;
            }

            let incomplete_turn = incomplete_tool_turn_index(&merged);
            if incomplete_turn.is_some()
                && operation_lease.is_none()
                && _acquired_operation_lease.is_none()
            {
                let (lease, refreshed_messages) = acquire_transcript_operation_lease_and_snapshot(
                    sink.store_path.clone(),
                    Arc::clone(&writer),
                    session_id.clone(),
                )
                .await?;
                if !transcripts_match(&merged[..blob_len_usize], &refreshed_messages)? {
                    refreshed_blob = Some(refreshed_messages.clone());
                }
                blob_len_usize = refreshed_messages.len();
                blob_len = blob_len_usize as u64;
                snapshot_messages = refreshed_messages;
                _acquired_operation_lease = Some(lease);
                // A concurrent operation may have changed both the snapshot
                // and tail before releasing the lease. Re-read both instead of
                // deleting its newly committed rows from stale boundaries.
                continue;
            }

            if let Some(incomplete_turn) = incomplete_turn {
                merged.truncate(incomplete_turn);
                // Trimming below the blob length means the dangling turn lives
                // in the write-once snapshot itself, so rewrite the snapshot
                // and tail together while the operation lease is held.
                if merged.len() < blob_len_usize {
                    let repair_writer = Arc::clone(&writer);
                    let repair_session_id = session_id.clone();
                    let repaired_messages = merged.clone();
                    crate::store::spawn_blocking_store_caller(move || {
                        repair_writer.replace_snapshot_and_delete_from(
                            &repair_session_id,
                            &repaired_messages,
                        )
                    })
                    .await
                    .map_err(|error| {
                        anyhow!("transcript snapshot repair task failed: {error}")
                    })??;
                    refreshed_blob = Some(merged.clone());
                } else {
                    self.delete_log_tail(merged.len() as u64).await?;
                }
            }
            // The durable transcript is now exactly `merged`: every row it
            // holds was committed or adopted by this process.
            self.committed_log_len = merged.len() as u64;
            self.restore_messages(merged);
            return Ok(refreshed_blob);
        }
    }

    /// Re-restore the in-memory transcript from the durable store (snapshot
    /// blob ++ transcript log tail) while the caller holds the session
    /// operation lease, normalizing a dangling tool turn exactly like
    /// [`Agent::restore_messages_merging_log_tail`].
    ///
    /// Shared-store recovery (issue #146): a long-lived `SessionService`
    /// can survive the peer process that owned the previous run. The OS
    /// releases the peer's operation lease on its death, but this agent's
    /// in-memory transcript still predates the peer's committed rows, so
    /// the next run would append at a stale index (rejected by the log's
    /// contiguity guard) and terminal normalization would delete the peer's
    /// committed rows from the stale length. Called from
    /// `SessionService::prepare_operation_admission` after the lease is
    /// acquired: the lease excludes concurrent peer appends, so the refresh
    /// is race-free and the run starts from the newest durable state.
    ///
    /// Synchronous counterpart of the async restore: admission is a sync
    /// path that already performs blocking store reads (config revision,
    /// compaction checkpoint). Returns the post-refresh durable snapshot
    /// blob — the rewritten blob when dangling-turn normalization repaired
    /// it, the unchanged blob otherwise — so the caller can reconcile its
    /// cached snapshot copy on every admission: a prior admission may have
    /// repaired the blob and then failed before patching that copy, and the
    /// retry sees nothing left to repair. `None` only when the session has
    /// no transcript log.
    pub fn refresh_transcript_under_lease(
        &mut self,
        operation_lease: &crate::sessions::SessionOperationLease,
    ) -> Result<Option<Vec<Message>>> {
        self.transcript_recovery_warning = None;
        let Some(sink) = &self.transcript_log else {
            return Ok(None);
        };
        operation_lease
            .validate(&sink.store_path, &sink.session_id)
            .map_err(anyhow::Error::new)?;
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();

        let snapshot_messages = writer.read_snapshot_messages(&session_id)?;
        let blob_len = snapshot_messages.len() as u64;
        let blob_len_usize = snapshot_messages.len();
        let mut tail = writer.read_from(&session_id, blob_len)?;

        let mut expected_idx = blob_len;
        let mut gap = false;
        for (idx, _) in &tail {
            if *idx != expected_idx {
                gap = true;
                break;
            }
            expected_idx = expected_idx
                .checked_add(1)
                .ok_or_else(|| anyhow!("transcript log index overflowed"))?;
        }

        if gap {
            // The lease is held, so no peer can be appending: a gap is
            // genuine corruption. Keep the longest contiguous prefix and
            // atomically delete the untrusted physical suffix, exactly like
            // the restore path.
            let (repaired_tail, recovery) =
                writer.read_tail_repairing_gap(&session_id, blob_len)?;
            tail = repaired_tail;
            if let Some(recovery) = recovery {
                let row_label = if recovery.discarded_rows == 1 {
                    "row"
                } else {
                    "rows"
                };
                self.transcript_recovery_warning = Some(format!(
                    "Recovered this session to its last valid message because transcript index {} was missing. Discarded {} untrusted transcript log {row_label} beginning at index {}.",
                    recovery.expected_idx, recovery.discarded_rows, recovery.found_idx
                ));
            }
        }

        let mut merged = snapshot_messages;
        let mut expected_idx = blob_len;
        for (idx, message) in tail {
            if idx != expected_idx {
                return Err(anyhow!(
                    "transcript log tail is not contiguous with the snapshot: expected idx {expected_idx}, found {idx}"
                ));
            }
            merged.push(message);
            expected_idx = expected_idx
                .checked_add(1)
                .ok_or_else(|| anyhow!("transcript log index overflowed"))?;
        }

        if let Some(incomplete_turn) = incomplete_tool_turn_index(&merged) {
            merged.truncate(incomplete_turn);
            // Trimming below the blob length means the dangling turn lives
            // in the write-once snapshot itself, so rewrite the snapshot
            // and tail together while the operation lease is held.
            if merged.len() < blob_len_usize {
                writer.replace_snapshot_and_delete_from(&session_id, &merged)?;
            } else {
                writer.delete_from(&session_id, merged.len() as u64)?;
            }
        }

        // The durable snapshot blob after the refresh: the rewritten blob
        // when normalization repaired it, otherwise the unchanged prefix of
        // the merged transcript.
        let durable_blob = merged[..merged.len().min(blob_len_usize)].to_vec();

        // The durable transcript is now exactly `merged`.
        self.committed_log_len = merged.len() as u64;
        if !transcripts_match(&self.messages, &merged)? {
            self.restore_messages(merged);
        }
        Ok(Some(durable_blob))
    }

    /// Trim a dangling tool turn from the transcript AND the transcript log
    /// tail. Shared by the run-failure path
    /// (`SessionService::finish_run_once`) and the cancel path
    /// (`Agent::append_cancellation_marker`, which additionally logs a
    /// marker). A run that fails at the tool-result commit point leaves the
    /// assistant tool-call message in the vec AND the log with its tool
    /// results in neither; the agent is long-lived, so the next run would
    /// reuse that dirty transcript and providers would reject it (assistant
    /// tool calls with no tool results) until re-attach.
    ///
    /// The log tail is deleted unconditionally (not only when the vec was
    /// trimmed): a run-task abort cannot interrupt a `spawn_blocking` append
    /// once started, so the log can hold a straggler row at `messages.len()`
    /// that the vec never saw — without the delete, the next append would
    /// reuse that idx and leave duplicate-idx rows for the restore merge.
    /// A submitted append has a separate, non-authoritative pending bound.
    /// The writer finishes before the durable read resolves that bound;
    /// `committed_log_len` advances only after commit acknowledgement.
    /// Durable rows BEYOND it belong to a peer (shared store, issue #146):
    /// the in-memory transcript is stale, so the durable state is adopted
    /// instead of deleting the peer's committed rows from the stale length.
    /// Both terminal paths treat a normalization error as best-effort: the
    /// next restore re-normalizes the stale tail.
    pub async fn normalize_dangling_tail(&mut self) -> Result<()> {
        self.reconcile_unacknowledged_message().await?;
        if self.direct_inbox_append_start.is_some() || self.prompt_commit_pending {
            return self.reload_transcript_from_store().await;
        }
        if self.durable_log_has_rows_past_own_commits().await? {
            return self.reload_transcript_from_store().await;
        }
        truncate_incomplete_tool_turn(&mut self.messages);
        self.delete_log_tail(self.messages.len() as u64).await
    }

    /// Cancellation normalization for the session cancel path: trim a
    /// dangling tool turn from the transcript AND the log tail (see
    /// [`Agent::normalize_dangling_tail`]), then append and log the
    /// cancellation marker. On a log error the marker is not appended at
    /// all — deliberately: a snapshot that ends at the trimmed length lets
    /// the next restore re-normalize the stale log tail, while a persisted
    /// marker would cover the stale rows and resurrect orphaned tool results
    /// into the provider view.
    #[cfg(test)]
    pub async fn append_cancellation_marker(&mut self) -> Result<()> {
        self.normalize_dangling_tail().await?;
        self.append_cancellation_tail(Vec::new()).await
    }

    /// Close every unfinished tool call with a synthetic cancellation result
    /// instead of trimming its assistant turn. Session cancellation uses this
    /// path so the chat can retain dispatched thread cards and their persisted
    /// logs while the resulting transcript remains valid provider history.
    pub async fn append_cancellation_marker_preserving_tools(&mut self) -> Result<()> {
        self.reconcile_unacknowledged_message().await?;
        if self.direct_inbox_append_start.is_some() || self.prompt_commit_pending {
            // A direct steer delivery transaction may have committed after
            // the run task was aborted. Its User row and delivered inbox state
            // are one durable fact; adopt the row before adding cancellation.
            self.reload_transcript_from_store().await?;
        } else if self.durable_log_has_rows_past_own_commits().await? {
            // Shared-store recovery (issue #146): a peer committed rows this
            // agent never saw. Adopt the durable state instead of deleting
            // the peer's committed rows from the stale in-memory length (see
            // [`Agent::normalize_dangling_tail`]).
            self.reload_transcript_from_store().await?;
        } else {
            // Remove a log row whose blocking append completed after the run
            // task was aborted but before its in-memory push.
            self.delete_log_tail(self.messages.len() as u64).await?;
        }
        // The missing-result scan deliberately uses the authoritative
        // in-memory transcript (freshly reloaded when it was stale).
        let missing_results = missing_tool_result_ids(&self.messages)
            .into_iter()
            .map(|tool_call_id| Message::Tool {
                tool_call_id,
                content: crate::types::TOOL_CALL_CANCELLED_MARKER.into(),
            })
            .collect::<Vec<_>>();
        self.append_cancellation_tail(missing_results).await
    }

    /// Preserve provider output that was streamed before a direct run failed.
    /// Combining the partial text and terminal marker into one assistant
    /// message keeps usage/timing aligned to one visible failed response.
    pub async fn normalize_failed_tail_preserving_partial(&mut self) -> Result<()> {
        self.normalize_dangling_tail().await?;
        let partial = self.take_partial_stream();
        if partial.is_empty() {
            return Ok(());
        }
        let content = if partial.text.is_empty() {
            Some(RUN_FAILED_PARTIAL_MARKER.to_string())
        } else {
            Some(format!("{}\n\n{}", partial.text, RUN_FAILED_PARTIAL_MARKER))
        };
        self.push_terminal_batch_and_log(vec![Message::Assistant {
            content,
            reasoning_text: (!partial.reasoning.is_empty()).then_some(partial.reasoning),
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: Some(self.client.model_origin()),
            reasoning_field: None,
        }])
        .await
    }

    fn clear_partial_stream(&self) {
        *self
            .partial_stream
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = ModelStreamDelta::default();
    }

    fn take_partial_stream(&self) -> ModelStreamDelta {
        std::mem::take(
            &mut *self
                .partial_stream
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner),
        )
    }

    /// Delete log rows with `idx >= from_idx` (crash/cancel normalization).
    async fn delete_log_tail(&mut self, from_idx: u64) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = Arc::clone(&sink.writer);
        let session_id = sink.session_id.clone();
        crate::store::spawn_blocking_store_caller(move || {
            writer.delete_from(&session_id, from_idx)
        })
        .await
        .map_err(|error| anyhow!("transcript log tail delete task failed: {error}"))??;
        self.committed_log_len = self.committed_log_len.min(from_idx);
        self.pending_log_end = None;
        Ok(())
    }

    /// Restore the newest checkpoint that still validates against the complete
    /// canonical transcript, falling back through older append-only rows.
    pub(crate) fn restore_compaction_checkpoint(&mut self) -> Result<()> {
        if let Some(compaction) = &mut self.compaction {
            compaction.restore_newest_valid_checkpoint(&self.messages)?;
        }
        Ok(())
    }

    pub(crate) fn invalidate_context_sample(&mut self) {
        if let Some(compaction) = &mut self.compaction {
            compaction.invalidate_context_sample();
        }
    }

    async fn append_pending_guidance_checked(&mut self) -> Result<usize> {
        match self.append_pending_direct_inbox().await {
            Ok(count) => {
                if count > 0 {
                    self.refresh_heartbeat_request_from_guidance().await;
                }
                Ok(count)
            }
            Err(error) => {
                self.emit(AgentEvent::Error {
                    thread_name: None,
                    message: error.to_string(),
                })
                .await;
                self.record_terminal_cleanup_error().await;
                Err(error)
            }
        }
    }

    async fn record_terminal_cleanup_error(&self) {
        if let Err(error) = self.tool_runtime.terminal_manager.settle_run().await {
            self.emit(AgentEvent::Error {
                thread_name: None,
                message: format!("terminal cleanup incomplete: {error:#}"),
            })
            .await;
        }
    }

    async fn emit(&self, event: AgentEvent) {
        self.event_sink.emit_async(event).await;
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod guide_tests;

#[cfg(test)]
mod task_followup_tests;
