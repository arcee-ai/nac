use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::sync::{watch, Mutex};
use tokio::task::JoinSet;

use crate::events::{AgentEvent, AssistantStreamDelta, EventSink, SessionRunId};
use crate::mcp::McpRegistry;
use crate::model::{CoalescedDeltas, DeltaSink, ModelClient, ModelStreamDelta, TokenUsage};
use crate::sandbox::{SandboxSession, SshConnection};
use crate::skills::SkillRegistry;
use crate::tools::{self, ToolResult, ToolRuntime};
use crate::types::{Message, ToolCall, ToolDefinition};

mod compaction;
mod dag;
pub(crate) mod preview;
mod tool_exec;

#[cfg(test)]
mod compaction_integration_tests;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod transcript_log_tests;

#[cfg(test)]
pub(crate) use compaction::checkpoint_digests as compaction_checkpoint_digests_for_test;
#[cfg(test)]
pub(crate) const COMPACTION_PROMPT_POLICY_VERSION_FOR_TEST: u32 = compaction::PROMPT_POLICY_VERSION;
pub(crate) use compaction::{
    CompactionCompletion, CompactionError, CompactionLifecycle, CompactionResult,
};
use compaction::{CompactionPolicy, CompactionState, PreparedProviderView};
pub(crate) use preview::key_arg_preview;
use preview::*;
use tool_exec::execute_tools_parallel;

const TOOL_ARGS_DETAIL_LIMIT: usize = 8_192;
const WORKER_SYSTEM_PROMPT: &str = include_str!("prompts/nac_worker.md");
const ORCHESTRATOR_SYSTEM_PROMPT: &str = include_str!("prompts/nac_orchestrator.md");
const DIRECT_SYSTEM_PROMPT: &str = include_str!("prompts/nac_direct.md");
pub(crate) const RUN_CANCELLED_MARKER: &str = "[run cancelled by user]";
pub(crate) const RUN_FAILED_PARTIAL_MARKER: &str =
    "[run failed after this partial assistant response]";

fn render_worker_system_prompt(working_directory: &str) -> String {
    let (prefix, suffix) = WORKER_SYSTEM_PROMPT
        .split_once("{working_directory}")
        .expect("worker system prompt must contain {working_directory}");
    format!("{prefix}{working_directory}{suffix}")
}

fn render_direct_system_prompt(working_directory: &str) -> String {
    let (prefix, suffix) = DIRECT_SYSTEM_PROMPT
        .split_once("{working_directory}")
        .expect("direct system prompt must contain {working_directory}");
    format!("{prefix}{working_directory}{suffix}")
}

fn render_orchestrator_system_prompt(working_directory: &str, thread_timeout_secs: u64) -> String {
    let (prefix, remainder) = ORCHESTRATOR_SYSTEM_PROMPT
        .split_once("{working_directory}")
        .expect("orchestrator system prompt must contain {working_directory}");
    let (middle, suffix) = remainder
        .split_once("{thread_timeout_secs}")
        .expect("orchestrator system prompt must contain {thread_timeout_secs}");
    format!("{prefix}{working_directory}{middle}{thread_timeout_secs}{suffix}")
}

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
/// error stays on the tool result; this only stops the worker after the
/// identical failing round has repeated enough times to be a loop. The stop
/// is reported as `ModelError` so the parent dispatch keeps the reason (plain
/// `Error` is reduced to "operation failed" before it leaves the worker) and
/// the orchestrator sees it on the `thread` tool result.
const REPEATED_TOOL_FAILURE_LIMIT: usize = 3;

fn canonical_tool_arguments(raw: &str) -> String {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .and_then(|value| serde_json::to_string(&value).ok())
        .unwrap_or_else(|| raw.to_string())
}

fn tool_call_arguments<'a>(calls: &'a [ToolCall], call_id: &str) -> &'a str {
    calls
        .iter()
        .find(|call| call.id == call_id)
        .map(|call| call.function.arguments.as_str())
        .unwrap_or("")
}

fn tool_result_error_identity(result: &ToolResult) -> String {
    let Some(text) = result.content.as_text() else {
        return "error".to_string();
    };
    match serde_json::from_str::<serde_json::Value>(text) {
        Ok(value) => match value.get("error") {
            Some(error) => serde_json::to_string(error).unwrap_or_else(|_| error.to_string()),
            None => serde_json::to_string(&value).unwrap_or_else(|_| text.to_string()),
        },
        Err(_) => text.to_string(),
    }
}

struct FailedToolRound {
    signature: String,
    detail: String,
}

fn failed_tool_round(
    calls: &[ToolCall],
    results: &[(String, String, ToolResult)],
) -> Option<FailedToolRound> {
    let mut signature_parts = Vec::new();
    let mut detail_parts = Vec::new();
    for (id, name, result) in results {
        if !result.is_error {
            continue;
        }
        let arguments = tool_call_arguments(calls, id);
        let error = tool_result_error_identity(result);
        signature_parts.push(format!(
            "{name}\t{}\t{error}",
            canonical_tool_arguments(arguments)
        ));
        detail_parts.push(format!(
            "{name} {} {error}",
            preview_tool_args(name, arguments)
        ));
    }
    if signature_parts.is_empty() {
        return None;
    }
    signature_parts.sort();
    detail_parts.sort();
    Some(FailedToolRound {
        signature: signature_parts.join("\n"),
        detail: preview(&detail_parts.join("; "), 400),
    })
}

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentMode {
    Worker,
    Orchestrator,
    /// Persistent top-level coding loop. This shares the lower model/tool
    /// engine with workers but not their bounded dispatch prompt or lifecycle.
    Direct,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunPromptCommitStatus {
    Pending,
    Committed,
    Failed,
}

pub struct AgentConfig {
    pub mode: AgentMode,
    pub store_path: PathBuf,
    pub session_id: Option<String>,
    pub orchestrator_compaction_threshold: Option<u64>,
    pub initial_messages: Vec<Message>,
    pub thread_name: Option<String>,
    pub dispatch_id: Option<String>,
    pub event_sink: EventSink,
    pub workspace_cwd: PathBuf,
    /// Local cwd for nac config/store paths; differs from workspace_cwd for SSH.
    pub config_cwd: PathBuf,
    pub working_directory: String,
    pub worker_executable: Option<PathBuf>,
    pub sandbox: Option<SandboxSession>,
    /// How to reach the host of a remote session; mutually exclusive with sandbox.
    pub ssh: Option<SshConnection>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub extra_tool_defs: Vec<ToolDefinition>,
    pub agents_md_message: Option<String>,
    pub thread_timeout_secs: u64,
    pub command_output_limits: crate::terminal::CommandOutputLimits,
    /// Light worker model client; `None` keeps single-model dispatch.
    pub light_client: Option<Arc<ModelClient>>,
}

/// Light-model addendum to the orchestrator system prompt: names the light
/// model so weight classification has a real signal.
fn light_model_prompt_guidance(light: &ModelClient) -> String {
    format!(
        "\n\nA light worker model is configured. Every thread dispatch requires a \
         weight classification: light routes the dispatch to the light model — {} — \
         and heavy runs your own model. Classify by the genuine difficulty of the \
         bounded action: light for mechanical or well-scoped work (setup, running \
         tests, simple edits), heavy for work needing real reasoning or broad context.",
        tools::thread::describe_light_model(light)
    )
}

pub struct Agent {
    client: ModelClient,
    pub messages: Vec<Message>,
    tool_defs: Vec<ToolDefinition>,
    admission_controlled_tools: bool,
    direct_primary: bool,
    compaction: Option<CompactionState>,
    tool_runtime: ToolRuntime,
    event_sink: EventSink,
    thread_name: Option<String>,
    steering_dispatch_id: Option<String>,
    appended_steering_ids: HashSet<i64>,
    /// Top-level transcript log sink (DB-direct transcript workset, see
    /// store/transcript.rs). Present for persistent primary agents with a
    /// session id — workers (separate `__worker` processes) never log.
    transcript_log: Option<TranscriptLogSink>,
    /// Exclusive upper bound of transcript log rows this process has
    /// committed or adopted (restore/refresh). Durable rows at or beyond
    /// this position were committed by a peer while it held the session
    /// operation lease, so the terminal normalization paths must never
    /// delete them from stale in-memory boundaries (shared-store recovery,
    /// issue #146).
    committed_log_len: u64,
    /// User-facing notice set only when restore repaired a validly encoded
    /// non-contiguous transcript tail.
    transcript_recovery_warning: Option<String>,
    /// Set only when this process atomically transitioned a prior active run to
    /// interrupted during resume. Consumed once when the session bus is built.
    interrupted_run_recovery: Option<String>,
    /// Token usage from the most recent `send()` call, updated after each
    /// model call; `None` if the provider omitted usage.
    pub last_usage: Option<crate::model::TokenUsage>,
    /// Output received from the provider for the model call currently in
    /// flight. Deltas remain live-only during an ordinary run, but keeping a
    /// local copy lets cancellation commit the text the user already saw.
    partial_stream: StdMutex<ModelStreamDelta>,
}

/// Path-backed writer and identity needed to append to the orchestrator
/// transcript log. The writer is shared into `spawn_blocking` closures per
/// operation.
struct TranscriptLogSink {
    writer: Arc<crate::store::TranscriptLogWriter>,
    session_id: String,
    store_path: PathBuf,
}

fn append_to_initial_system_message(messages: &mut [Message], extra: &str) {
    if extra.is_empty() {
        return;
    }
    if let Some(Message::System { content }) = messages.first_mut() {
        content.push_str("\n\n");
        content.push_str(extra);
    }
}

/// Trim a trailing assistant tool-call turn whose tool results never arrived
/// (a crash or cancel between the assistant message and the tool-result
/// batch). Shared by the session cancel path and the transcript-log restore
/// merge, which also removes the matching log tail.
pub(crate) fn truncate_incomplete_tool_turn(messages: &mut Vec<Message>) {
    if let Some(index) = incomplete_tool_turn_index(messages) {
        messages.truncate(index);
    }
}

fn incomplete_tool_turn_index(messages: &[Message]) -> Option<usize> {
    let index = messages.iter().rposition(|message| {
        matches!(
            message,
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } if !tool_calls.is_empty()
        )
    })?;
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return None;
    };
    let expected = tool_calls
        .iter()
        .map(|tool_call| tool_call.id.as_str())
        .collect::<HashSet<_>>();
    let observed = messages[index + 1..]
        .iter()
        .filter_map(|message| match message {
            Message::Tool { tool_call_id, .. } => Some(tool_call_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    (!expected.is_subset(&observed)).then_some(index)
}

fn missing_tool_result_ids(messages: &[Message]) -> Vec<String> {
    let Some(index) = incomplete_tool_turn_index(messages) else {
        return Vec::new();
    };
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return Vec::new();
    };
    let observed = messages[index + 1..]
        .iter()
        .filter_map(|message| match message {
            Message::Tool { tool_call_id, .. } => Some(tool_call_id.as_str()),
            _ => None,
        })
        .collect::<HashSet<_>>();
    tool_calls
        .iter()
        .filter(|tool_call| !observed.contains(tool_call.id.as_str()))
        .map(|tool_call| tool_call.id.clone())
        .collect()
}

fn transcripts_match(left: &[Message], right: &[Message]) -> Result<bool> {
    Ok(serde_json::to_vec(left)? == serde_json::to_vec(right)?)
}

async fn acquire_transcript_operation_lease_and_snapshot(
    store_path: PathBuf,
    writer: Arc<crate::store::TranscriptLogWriter>,
    session_id: String,
) -> Result<(crate::sessions::SessionOperationLease, Vec<Message>)> {
    tokio::task::spawn_blocking(move || -> Result<_> {
        let lease = crate::sessions::SessionOperationLease::try_acquire(&store_path, &session_id)
            .map_err(anyhow::Error::new)?;
        let messages = writer.read_snapshot_messages(&session_id)?;
        Ok((lease, messages))
    })
    .await
    .map_err(|error| anyhow!("transcript log operation lease task failed: {error}"))?
}

impl Agent {
    pub fn with_config(client: ModelClient, config: AgentConfig) -> Result<Self> {
        let client = client.with_prompt_cache_key(config.session_id.clone());
        let cwd = config.working_directory.clone();
        let thread_timeout_secs = config.thread_timeout_secs;
        let mode = config.mode;
        let compaction = if matches!(mode, AgentMode::Orchestrator | AgentMode::Direct) {
            config.session_id.clone().map(|session_id| {
                CompactionState::new(
                    config.store_path.clone(),
                    session_id,
                    config.orchestrator_compaction_threshold,
                    match mode {
                        AgentMode::Direct => CompactionPolicy::Direct,
                        AgentMode::Orchestrator => CompactionPolicy::Orchestrator,
                        AgentMode::Worker => unreachable!("workers do not own compaction state"),
                    },
                )
            })
        } else {
            None
        };
        // Construction-time gate for the transcript log: persistent primary
        // agents only, and only with a session id (mirrors the compaction
        // gate). Workers run in separate `__worker` processes and must never
        // append top-level transcript rows.
        let transcript_log = match (mode, config.session_id.clone()) {
            (AgentMode::Orchestrator | AgentMode::Direct, Some(session_id)) => {
                Some(TranscriptLogSink {
                    writer: Arc::new(crate::store::TranscriptLogWriter::new(&config.store_path)?),
                    session_id,
                    store_path: config.store_path.clone(),
                })
            }
            _ => None,
        };

        let (mut system_prompt, mut tool_defs) = match config.mode {
            AgentMode::Worker => {
                let image_read = client.supports_image_tool_results();
                (
                    render_worker_system_prompt(&cwd),
                    tools::worker_tool_definitions(image_read),
                )
            }
            AgentMode::Orchestrator => (
                render_orchestrator_system_prompt(&cwd, thread_timeout_secs),
                tools::orchestrator_tool_definitions(
                    config.skills.as_deref(),
                    config.light_client.as_deref(),
                ),
            ),
            AgentMode::Direct => (
                render_direct_system_prompt(&cwd),
                tools::worker_tool_definitions(client.supports_image_tool_results()),
            ),
        };
        if config.mode == AgentMode::Orchestrator {
            if let Some(light) = config.light_client.as_deref() {
                system_prompt.push_str(&light_model_prompt_guidance(light));
            }
        }
        if matches!(config.mode, AgentMode::Worker | AgentMode::Direct) {
            tool_defs.extend(config.extra_tool_defs);
        }

        let mut messages = vec![Message::System {
            content: system_prompt,
        }];
        if let Some(agents_md_message) = config.agents_md_message {
            if matches!(config.mode, AgentMode::Worker | AgentMode::Direct) {
                append_to_initial_system_message(&mut messages, &agents_md_message);
            } else {
                messages.push(Message::System {
                    content: agents_md_message,
                });
            }
        }
        if config.mode == AgentMode::Worker {
            for message in config.initial_messages {
                match message {
                    Message::System { content } => {
                        append_to_initial_system_message(&mut messages, &content);
                    }
                    other => messages.push(other),
                }
            }
        } else {
            messages.extend(config.initial_messages);
        }

        let local_paths = crate::paths::PathContext::new(&config.config_cwd);
        let backend = crate::sandbox::select_execution_backend(
            config.ssh,
            config.sandbox,
            &config.workspace_cwd,
            &local_paths,
        )?;
        let terminal_manager = match config.mode {
            AgentMode::Worker => crate::terminal::TerminalManager::for_worker_with_limits(
                config.command_output_limits,
            )?,
            AgentMode::Orchestrator => crate::terminal::TerminalManager::new(),
            AgentMode::Direct => crate::terminal::TerminalManager::for_direct(),
        };
        let allowed_tools = Arc::new(
            tool_defs
                .iter()
                .map(|definition| definition.function.name.clone())
                .collect(),
        );
        // The initial messages are exactly the snapshot blob written at
        // session creation; the log tail starts at this length.
        let committed_log_len = messages.len() as u64;
        Ok(Self {
            client,
            messages,
            tool_defs,
            admission_controlled_tools: mode == AgentMode::Direct,
            direct_primary: mode == AgentMode::Direct,
            compaction,
            tool_runtime: ToolRuntime {
                workspace_cwd: config.workspace_cwd,
                config_cwd: config.config_cwd,
                store_path: config.store_path,
                session_id: config.session_id,
                active_threads: Arc::new(crate::tools::ActiveThreadRegistry::default()),
                event_sink: config.event_sink.clone(),
                worker_executable: config.worker_executable,
                backend,
                mcp: config.mcp,
                skills: config.skills,
                terminal_manager,
                command_cancellation: crate::tools::ThreadCancellation::default(),
                thread_timeout_secs: config.thread_timeout_secs,
                worker_usage: Arc::new(Mutex::new(TokenUsage::default())),
                light_client: config.light_client,
                allowed_tools: Some(allowed_tools),
            },
            event_sink: config.event_sink,
            thread_name: config.thread_name,
            steering_dispatch_id: config.dispatch_id,
            appended_steering_ids: HashSet::new(),
            transcript_log,
            committed_log_len,
            transcript_recovery_warning: None,
            interrupted_run_recovery: None,
            last_usage: None,
            partial_stream: StdMutex::new(ModelStreamDelta::default()),
        })
    }

    #[cfg(test)]
    pub fn default(client: ModelClient) -> Self {
        let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let working_directory = workspace_cwd.display().to_string();

        Self::with_config(
            client,
            AgentConfig {
                command_output_limits: crate::terminal::CommandOutputLimits::default(),
                mode: AgentMode::Worker,
                store_path: crate::store::default_store_path(),
                session_id: None,
                orchestrator_compaction_threshold: None,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: workspace_cwd.clone(),
                config_cwd: workspace_cwd,
                working_directory,
                worker_executable: None,
                sandbox: None,
                ssh: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
                light_client: None,
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

    pub(crate) fn terminal_manager(&self) -> crate::terminal::TerminalManager {
        self.tool_runtime.terminal_manager.clone()
    }

    pub async fn send(&mut self, prompt: &str) -> Result<String> {
        self.send_inner(prompt, None).await
    }

    pub(crate) async fn send_session_run(
        &mut self,
        prompt: &str,
        run_id: &SessionRunId,
        prompt_commit: watch::Sender<RunPromptCommitStatus>,
        inbox_item_id: Option<i64>,
    ) -> Result<String> {
        self.send_inner(prompt, Some((run_id, prompt_commit, inbox_item_id)))
            .await
    }

    async fn send_inner(
        &mut self,
        prompt: &str,
        session_run: Option<(
            &SessionRunId,
            watch::Sender<RunPromptCommitStatus>,
            Option<i64>,
        )>,
    ) -> Result<String> {
        self.emit(AgentEvent::RunStarted {
            thread_name: self.thread_name.clone(),
            prompt_preview: preview(prompt, 160),
        });
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
            Some((run_id, _, inbox_item_id)) => {
                self.push_and_log_run_prompt(prompt_message, run_id, *inbox_item_id)
                    .await
            }
            None => self.push_and_log(prompt_message).await,
        };
        if let Some((_, prompt_commit, _)) = session_run {
            prompt_commit.send_replace(if prompt_result.is_ok() {
                RunPromptCommitStatus::Committed
            } else {
                RunPromptCommitStatus::Failed
            });
        }
        if let Err(error) = prompt_result {
            self.emit(AgentEvent::Error {
                thread_name: self.thread_name.clone(),
                message: error.to_string(),
            });
            self.tool_runtime.terminal_manager.settle_run().await;
            return Err(error);
        }

        if let Err(error) = self.ensure_backend_ready().await {
            self.emit(AgentEvent::Error {
                thread_name: self.thread_name.clone(),
                message: error.to_string(),
            });
            self.tool_runtime.terminal_manager.settle_run().await;
            return Err(error);
        }

        let mut iteration = 0usize;
        let mut empty_turn_nudged = false;
        let mut last_failure_signature: Option<String> = None;
        let mut last_failure_detail = String::new();
        let mut repeated_failures = 0usize;
        let mut accumulated_usage = TokenUsage::default();
        loop {
            self.append_pending_guidance_checked().await?;
            let needs_compaction_view = self
                .compaction
                .as_mut()
                .is_some_and(|compaction| !compaction.is_passthrough(&self.messages));
            let provider_view = if needs_compaction_view {
                self.prepare_provider_view(&mut accumulated_usage).await
            } else {
                PreparedProviderView {
                    messages: self.messages.clone(),
                    context_estimate: 0,
                    checkpoint_id: None,
                }
            };
            iteration = iteration.saturating_add(1);
            self.emit(AgentEvent::ModelCallStarted {
                thread_name: self.thread_name.clone(),
                iteration,
            });

            let call_started = Instant::now();
            self.clear_partial_stream();
            let deltas = CoalescedDeltas::new(|delta: ModelStreamDelta| {
                self.event_sink.emit_assistant_delta(AssistantStreamDelta {
                    thread_name: self.thread_name.clone(),
                    text: (!delta.text.is_empty()).then_some(delta.text),
                    reasoning: (!delta.reasoning.is_empty()).then_some(delta.reasoning),
                });
            });
            let push_delta = |delta: ModelStreamDelta| {
                {
                    let mut partial = self
                        .partial_stream
                        .lock()
                        .expect("partial model stream state");
                    partial.text.push_str(&delta.text);
                    partial.reasoning.push_str(&delta.reasoning);
                }
                deltas.push(delta);
            };
            // Only the orchestrator's output is read as it arrives: a thread is
            // summarized on its card, and nobody watching at all means the
            // cheaper buffered request shape.
            let delta_sink: DeltaSink<'_> = (self.thread_name.is_none()
                && self.event_sink.wants_assistant_deltas())
            .then_some(&push_delta);
            let turn = self
                .client
                .send_turn_streaming(provider_view.messages, self.tool_defs.clone(), delta_sink)
                .await;
            // Whatever arrived in the last partial window still belongs on screen.
            deltas.flush();
            let response = match turn {
                Ok(response) => response,
                Err(error) => {
                    // Preserve accumulated usage (including summary and worker
                    // costs from prior rounds) so it survives the error return.
                    self.last_usage = Some(accumulated_usage.clone());
                    // The provider's own words about the call it refused: the
                    // one error class worth showing rather than reducing to
                    // "operation failed".
                    self.emit(AgentEvent::ModelError {
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    self.tool_runtime.terminal_manager.settle_run().await;
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
                self.emit(AgentEvent::TokenUsageUpdated {
                    thread_name: self.thread_name.clone(),
                    usage,
                });
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
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
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
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
                return Err(error);
            }
            self.clear_partial_stream();
            if let Some(compaction) = &mut self.compaction {
                compaction.record_ordinary_context(
                    &self.messages,
                    ordinary_context_tokens.unwrap_or(0),
                    self.messages.len(),
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
                                thread_name: self.thread_name.clone(),
                                message: error.to_string(),
                            });
                            self.tool_runtime.terminal_manager.settle_run().await;
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
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    self.tool_runtime.terminal_manager.settle_run().await;
                    return Err(error);
                };
                self.emit(AgentEvent::AssistantMessage {
                    thread_name: self.thread_name.clone(),
                    content: content.clone(),
                    usage: Some(accumulated_usage.clone()),
                });
                self.last_usage = Some(accumulated_usage.clone());
                self.emit(AgentEvent::RunFinished {
                    thread_name: self.thread_name.clone(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
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
                self.thread_name.clone(),
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
                finalize_tool_results(&self.messages, results, &self.event_sink, &self.thread_name);

            if self.tool_runtime.command_cancellation.is_cancelled() {
                let error = anyhow!("worker command cancelled");
                self.emit(AgentEvent::Error {
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
                return Err(error);
            }

            // Fold worker token usage (from thread dispatches) into the
            // orchestrator's accumulated usage. Only cost fields are summed;
            // orchestrator context stays ordinary-orchestrator-only.
            {
                let mut wu = self.tool_runtime.worker_usage.lock().await;
                accumulated_usage.add_cost_saturating(&wu);
                *wu = TokenUsage::default();
            }

            self.last_usage = Some(accumulated_usage.clone());

            // Transcript commit point (tool results): the complete parallel
            // batch is logged atomically before any of it enters the
            // transcript, so the loop re-enters provider-view preparation
            // only after the complete batch is both durable and appended.
            if let Err(error) = self.push_batch_and_log(tool_messages).await {
                self.last_usage = Some(accumulated_usage.clone());
                self.emit(AgentEvent::Error {
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
                return Err(error);
            }
            if repeated_identical_failure {
                let error = anyhow!(
                    "Stopped after {REPEATED_TOOL_FAILURE_LIMIT} identical tool failures: {failure_detail}"
                );
                // Same channel as a provider refusal: the message survives
                // sanitization and is captured as `WorkerRun.model_error`,
                // which `worker_failure_details` puts on the orchestrator's
                // thread tool result.
                self.emit(AgentEvent::ModelError {
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
                return Err(error);
            }
        }
    }

    pub(crate) fn command_cancellation(&self) -> crate::tools::ThreadCancellation {
        self.tool_runtime.command_cancellation.clone()
    }

    /// Install a fresh cancellation scope for one top-level run. Persistent
    /// direct sessions reuse the agent across turns, so a cancelled command
    /// token must never poison the next run.
    pub(crate) fn begin_run_cancellation(&mut self) -> crate::tools::ThreadCancellation {
        let cancellation = crate::tools::ThreadCancellation::default();
        self.tool_runtime.command_cancellation = cancellation.clone();
        cancellation
    }

    #[cfg(test)]
    pub(crate) fn provider_messages_for_test(&mut self) -> Vec<Message> {
        match &mut self.compaction {
            Some(compaction) => compaction.prepare(&self.messages, &self.tool_defs).messages,
            None => self.messages.clone(),
        }
    }

    #[cfg(test)]
    pub(crate) fn tool_definitions_for_test(&self) -> &[ToolDefinition] {
        &self.tool_defs
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
        self.tool_runtime.event_sink = sink;
    }

    pub fn active_threads_handle(&self) -> Arc<crate::tools::ActiveThreadRegistry> {
        self.tool_runtime.active_threads.clone()
    }

    pub fn set_steering_dispatch_id(&mut self, dispatch_id: Option<String>) {
        self.steering_dispatch_id = dispatch_id;
        self.appended_steering_ids.clear();
    }

    /// Shared handle to the transcript log writer, present only for
    /// orchestrator agents with a session id. The session service reads the
    /// log through the same writer for store-backed transcript reads (step
    /// 3), so reads and appends stay serialized without retaining a connection.
    pub fn transcript_log_writer(&self) -> Option<Arc<crate::store::TranscriptLogWriter>> {
        self.transcript_log.as_ref().map(|sink| sink.writer.clone())
    }

    pub(crate) fn transcript_recovery_warning(&self) -> Option<&str> {
        self.transcript_recovery_warning.as_deref()
    }

    pub(crate) fn set_interrupted_run_recovery(&mut self, run_id: String) {
        self.interrupted_run_recovery = Some(run_id);
    }

    pub(crate) fn take_interrupted_run_recovery(&mut self) -> Option<String> {
        self.interrupted_run_recovery.take()
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
        self.push_and_log_run_prompt(message, run_id, None).await
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
        self.messages = messages;
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
        let writer = sink.writer.clone();
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
                let writer = writer.clone();
                let session_id = session_id.clone();
                tokio::task::spawn_blocking(move || writer.read_from(&session_id, blob_len))
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
                    writer.clone(),
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
                let repair_writer = writer.clone();
                let repair_session_id = session_id.clone();
                let (repaired_tail, recovery) = tokio::task::spawn_blocking(move || {
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
                    writer.clone(),
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
                    let repair_writer = writer.clone();
                    let repair_session_id = session_id.clone();
                    let repaired_messages = merged.clone();
                    tokio::task::spawn_blocking(move || {
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
        let writer = sink.writer.clone();
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

    /// Stale-transcript guard for the terminal normalization paths (shared
    /// store, issue #146): `true` when the durable transcript log holds
    /// rows at or beyond `committed_log_len` — rows this process never
    /// committed or adopted, so a peer must have appended them while it
    /// held the operation lease (e.g. the previous run owner crashed and
    /// this survivor's long-lived agent never re-restored). Deleting the
    /// log tail from the stale in-memory length would permanently remove
    /// those committed rows.
    async fn durable_log_has_rows_past_own_commits(&self) -> Result<bool> {
        let Some(sink) = &self.transcript_log else {
            return Ok(false);
        };
        let from_idx = self.committed_log_len;
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        let tail = tokio::task::spawn_blocking(move || writer.read_from(&session_id, from_idx))
            .await
            .map_err(|error| anyhow!("transcript log read task failed: {error}"))??;
        Ok(!tail.is_empty())
    }

    /// Adopt the durable transcript (snapshot blob ++ log tail) in memory
    /// without deleting anything: the read-only half of
    /// [`Agent::refresh_transcript_under_lease`] for the terminal
    /// normalization paths, which do not hold the operation lease they
    /// could pass down. A genuine gap is left for the next lease-held
    /// restore or admission refresh to repair.
    async fn reload_transcript_from_store(&mut self) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        let (snapshot, tail) = tokio::task::spawn_blocking(move || {
            let snapshot = writer.read_snapshot_messages(&session_id)?;
            let tail = writer.read_from(&session_id, snapshot.len() as u64)?;
            Ok::<_, anyhow::Error>((snapshot, tail))
        })
        .await
        .map_err(|error| anyhow!("transcript reload task failed: {error}"))??;
        let mut merged = snapshot;
        let mut expected_idx = merged.len() as u64;
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
        self.committed_log_len = merged.len() as u64;
        self.restore_messages(merged);
        Ok(())
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
    /// The straggler stays within this process's own commits because
    /// appends claim their rows in `committed_log_len` at submission time
    /// (before the `spawn_blocking` await), so the delete stays below that
    /// boundary.
    /// Durable rows BEYOND it belong to a peer (shared store, issue #146):
    /// the in-memory transcript is stale, so the durable state is adopted
    /// instead of deleting the peer's committed rows from the stale length.
    /// Both terminal paths treat a normalization error as best-effort: the
    /// next restore re-normalizes the stale tail.
    pub async fn normalize_dangling_tail(&mut self) -> Result<()> {
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
        if self.durable_log_has_rows_past_own_commits().await? {
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
        self.push_and_log(Message::Assistant {
            content,
            reasoning_text: (!partial.reasoning.is_empty()).then_some(partial.reasoning),
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: Some(self.client.model_origin()),
            reasoning_field: None,
        })
        .await
    }

    async fn append_cancellation_tail(&mut self, mut messages: Vec<Message>) -> Result<()> {
        let partial = self.take_partial_stream();
        if !partial.is_empty() {
            messages.push(Message::Assistant {
                content: (!partial.text.is_empty()).then_some(partial.text),
                reasoning_text: (!partial.reasoning.is_empty()).then_some(partial.reasoning),
                reasoning_details: None,
                tool_calls: None,
                duration_ms: None,
                model_origin: Some(self.client.model_origin()),
                reasoning_field: None,
            });
        }
        messages.push(Message::Assistant {
            content: Some(RUN_CANCELLED_MARKER.to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        });
        self.push_batch_and_log(messages).await
    }

    fn clear_partial_stream(&self) {
        *self
            .partial_stream
            .lock()
            .expect("partial model stream state") = ModelStreamDelta::default();
    }

    fn take_partial_stream(&self) -> ModelStreamDelta {
        std::mem::take(
            &mut *self
                .partial_stream
                .lock()
                .expect("partial model stream state"),
        )
    }

    /// Append `messages` to the transcript log at absolute positions
    /// `start_idx..` via `spawn_blocking` (steering-claim precedent). A no-op
    /// for agents without a transcript log (workers, picker sessions).
    async fn log_transcript_batch(&mut self, start_idx: u64, messages: &[Message]) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        if messages.is_empty() {
            return Ok(());
        }
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        let messages = messages.to_vec();
        let batch_len = messages.len() as u64;
        // Claim the rows at submission, before the await: a run task
        // dropped while the blocking append is in flight cannot interrupt
        // it, so the append still completes without this function ever
        // resuming. The up-front claim keeps that straggler row within this
        // process's own commits, so terminal normalization trims it instead
        // of mistaking it for a peer's committed row (issue #146).
        let pre_submission_committed = self.committed_log_len;
        self.committed_log_len = self.committed_log_len.max(start_idx + batch_len);
        let appended = tokio::task::spawn_blocking(move || {
            writer.append_batch(&session_id, start_idx, &messages)
        })
        .await
        .map_err(|error| anyhow!("transcript log append task failed: {error}"))?;
        match appended {
            Ok(()) => {
                // Live trigger (step 3): emitted after the log commit,
                // before the vec push — the store-backed read path sees the
                // rows immediately.
                self.event_sink
                    .emit_transcript_appended(start_idx + batch_len);
                Ok(())
            }
            Err(error) => {
                // The batch commits in one transaction, so a failed append
                // left no rows behind: release the optimistic claim to keep
                // the own-commits bound exact. A dropped task never reaches
                // this rollback — which is exactly the straggler case the
                // claim exists for.
                self.committed_log_len = pre_submission_committed;
                Err(error)
            }
        }
    }

    /// Append one message to the transcript log at absolute position `idx`
    /// via `spawn_blocking`. A no-op for agents without a transcript log.
    async fn log_transcript_message(&mut self, idx: u64, message: &Message) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        let message = message.clone();
        // Claim the row at submission, before the await — see
        // log_transcript_batch for why the straggler from a dropped run
        // task must stay within this process's own commits.
        let pre_submission_committed = self.committed_log_len;
        self.committed_log_len = self.committed_log_len.max(idx + 1);
        let appended =
            tokio::task::spawn_blocking(move || writer.append(&session_id, idx, &message))
                .await
                .map_err(|error| anyhow!("transcript log append task failed: {error}"))?;
        match appended {
            Ok(()) => {
                // Live trigger (step 3): see log_transcript_batch.
                self.event_sink.emit_transcript_appended(idx + 1);
                Ok(())
            }
            Err(error) => {
                // Nothing was committed: release the optimistic claim.
                self.committed_log_len = pre_submission_committed;
                Err(error)
            }
        }
    }

    /// Push one message into the transcript, appending it to the log first
    /// (log-first: the vec never holds an undurable message). `idx` is the
    /// absolute Vec index — `messages.len()` before the push.
    async fn push_and_log(&mut self, message: Message) -> Result<()> {
        let idx = self.messages.len() as u64;
        self.log_transcript_message(idx, &message).await?;
        self.messages.push(message);
        Ok(())
    }
    async fn push_and_log_run_prompt(
        &mut self,
        message: Message,
        run_id: &SessionRunId,
        inbox_item_id: Option<i64>,
    ) -> Result<()> {
        let idx = self.messages.len() as u64;
        if let Some(sink) = &self.transcript_log {
            let writer = sink.writer.clone();
            let session_id = sink.session_id.clone();
            let stored_message = message.clone();
            let run_id = run_id.to_string();
            tokio::task::spawn_blocking(move || match inbox_item_id {
                Some(inbox_item_id) => writer.append_inbox_run_prompt(
                    &session_id,
                    idx,
                    &stored_message,
                    &run_id,
                    inbox_item_id,
                ),
                None => writer.append_run_prompt(&session_id, idx, &stored_message, &run_id),
            })
            .await
            .map_err(|error| anyhow!("run prompt append task failed: {error}"))??;
            self.event_sink.emit_transcript_appended(idx + 1);
        }
        self.messages.push(message);
        Ok(())
    }

    /// Push a batch into the transcript atomically: the whole batch is
    /// logged in one transaction before any of it enters the vec.
    async fn push_batch_and_log(&mut self, messages: Vec<Message>) -> Result<()> {
        let start_idx = self.messages.len() as u64;
        self.log_transcript_batch(start_idx, &messages).await?;
        self.messages.extend(messages);
        Ok(())
    }

    /// Append the already-staged transcript tail `self.messages[from_idx..]`
    /// to the log (steering commit point: stage→ack→append).
    async fn log_transcript_tail(&mut self, from_idx: usize) -> Result<()> {
        let staged = self.messages[from_idx..].to_vec();
        self.log_transcript_batch(from_idx as u64, &staged).await
    }

    /// Delete log rows with `idx >= from_idx` (crash/cancel normalization).
    async fn delete_log_tail(&mut self, from_idx: u64) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        tokio::task::spawn_blocking(move || writer.delete_from(&session_id, from_idx))
            .await
            .map_err(|error| anyhow!("transcript log tail delete task failed: {error}"))??;
        self.committed_log_len = self.committed_log_len.min(from_idx);
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

    async fn append_pending_steering(&mut self) -> Result<usize> {
        let Some(session_id) = self.tool_runtime.session_id.clone() else {
            return Ok(0);
        };
        let dispatch_id = self
            .steering_dispatch_id
            .clone()
            .ok_or_else(|| anyhow!("steering dispatch id is unavailable"))?;
        let thread_name = self.thread_name.clone();
        let store_path = self.tool_runtime.store_path.clone();
        let claim_store_path = store_path.clone();
        let claim_session_id = session_id.clone();
        let claim_dispatch_id = dispatch_id.clone();
        let records = tokio::task::spawn_blocking(move || {
            crate::store::claim_thread_steering(
                &claim_store_path,
                &claim_session_id,
                &claim_dispatch_id,
            )
        })
        .await
        .map_err(|error| anyhow!("steering claim task failed: {error}"))??;

        let message_checkpoint = self.messages.len();
        let mut staged_ids = Vec::new();
        for record in &records {
            if self.appended_steering_ids.insert(record.id) {
                staged_ids.push(record.id);
                if thread_name.is_some() {
                    self.messages.push(Message::User {
                        content: format!(
                            "Steering instruction received for this worker thread. Apply it before continuing:\n\n{}",
                            record.instruction
                        ),
                    });
                } else {
                    self.messages.push(Message::User {
                        content: record.instruction.clone(),
                    });
                }
            }
        }

        let steering_ids = records.iter().map(|record| record.id).collect::<Vec<_>>();
        if let Err(error) = crate::store::acknowledge_thread_steering_batch(
            &store_path,
            &steering_ids,
            &session_id,
            &dispatch_id,
        ) {
            self.messages.truncate(message_checkpoint);
            for id in &staged_ids {
                self.appended_steering_ids.remove(id);
            }
            return Err(error);
        }

        // Transcript commit point (steering): stage→ack→append. The staged
        // messages are appended to the log only after the ack is durable. On
        // log failure they are truncated from the vec — unlike the
        // ack-failure path above, the ids stay staged because the ack is
        // durable: the records keep their delivered status and are never
        // redelivered. Keeping the messages would break the log-first
        // invariant (the vec never holds an undurable message): the next
        // append would use `idx = messages.len()` past the unlogged rows,
        // leaving a permanent gap in the log that fails the restore merge
        // and store-backed reads. The acked steering is thereby lost from
        // the transcript — accepted: a transient echo is not worth a
        // bricked session, and the durable steering records still show the
        // delivery.
        if let Err(error) = self.log_transcript_tail(message_checkpoint).await {
            self.messages.truncate(message_checkpoint);
            return Err(error);
        }

        for record in records {
            if let Some(thread_name) = &thread_name {
                self.emit(AgentEvent::ThreadSteeringDelivered {
                    name: thread_name.clone(),
                    steering_id: record.id,
                    instruction_preview: preview(&record.instruction, 160),
                });
            } else {
                self.emit(AgentEvent::OrchestratorSteeringDelivered {
                    steering_id: record.id,
                    instruction_preview: preview(&record.instruction, 160),
                });
            }
        }
        Ok(staged_ids.len())
    }

    async fn append_pending_steering_checked(&mut self) -> Result<usize> {
        match self.append_pending_steering().await {
            Ok(count) => Ok(count),
            Err(error) => {
                self.emit(AgentEvent::Error {
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                self.tool_runtime.terminal_manager.settle_run().await;
                Err(error)
            }
        }
    }

    async fn append_pending_direct_inbox(&mut self) -> Result<usize> {
        let Some(sink) = &self.transcript_log else {
            return Ok(0);
        };
        let run_id = self
            .steering_dispatch_id
            .clone()
            .ok_or_else(|| anyhow!("direct inbox delivery requires an active run id"))?;
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        let start_idx = self.messages.len() as u64;
        let pre_submission_committed = self.committed_log_len;
        // Claim the possible append before spawn_blocking for the same reason
        // as ordinary transcript appends: cancellation must recognize a row
        // that commits after the async task is aborted as this process's row.
        self.committed_log_len = self.committed_log_len.max(start_idx + 1);
        let records = tokio::task::spawn_blocking(move || {
            writer.append_pending_inbox_steers(&session_id, &run_id, start_idx)
        })
        .await
        .map_err(|error| anyhow!("direct inbox append task failed: {error}"))?;
        let records = match records {
            Ok(records) => records,
            Err(error) => {
                self.committed_log_len = pre_submission_committed;
                return Err(error);
            }
        };
        if records.is_empty() {
            self.committed_log_len = pre_submission_committed;
            return Ok(0);
        }
        self.messages
            .extend(records.iter().map(|record| Message::User {
                content: record.content.clone(),
            }));
        self.committed_log_len = self.messages.len() as u64;
        self.event_sink
            .emit_transcript_appended(self.messages.len() as u64);
        Ok(records.len())
    }

    async fn append_pending_guidance_checked(&mut self) -> Result<usize> {
        if self.direct_primary {
            match self.append_pending_direct_inbox().await {
                Ok(count) => Ok(count),
                Err(error) => {
                    self.emit(AgentEvent::Error {
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    self.tool_runtime.terminal_manager.settle_run().await;
                    Err(error)
                }
            }
        } else {
            self.append_pending_steering_checked().await
        }
    }

    fn emit(&self, event: AgentEvent) {
        self.event_sink.emit(event);
    }
}

fn finalize_tool_results(
    messages: &[Message],
    results: Vec<(String, String, ToolResult)>,
    event_sink: &EventSink,
    thread_name: &Option<String>,
) -> Vec<Message> {
    let mut transcript_image_stats = Ok(crate::tool_content::ImageStats::default());
    for message in messages {
        if let Message::Tool { content, .. } = message {
            transcript_image_stats =
                transcript_image_stats.and_then(|stats| stats.checked_add(content.image_stats()));
        }
    }
    results
        .into_iter()
        .map(|(tool_call_id, tool_name, mut result)| {
            let was_image_result = result.content.contains_images();
            if was_image_result {
                let next_stats = transcript_image_stats
                    .as_ref()
                    .map_err(Clone::clone)
                    .and_then(|stats| stats.checked_add(result.content.image_stats()));
                match next_stats {
                    Ok(stats) => transcript_image_stats = Ok(stats),
                    Err(_) => {
                        result = ToolResult::text(
                            "Error: image_limit_exceeded: image history limit reached",
                            true,
                        );
                    }
                }
                event_sink.emit(AgentEvent::tool_call_finished(
                    thread_name.clone(),
                    tool_call_id.clone(),
                    tool_name,
                    &result,
                ));
            }
            Message::Tool {
                tool_call_id,
                content: result.content,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests;
