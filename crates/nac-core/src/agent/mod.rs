use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;
use tokio::task::JoinSet;

use crate::events::{AgentEvent, AssistantStreamDelta, EventSink};
use crate::mcp::McpRegistry;
use crate::model::{CoalescedDeltas, DeltaSink, ModelClient, ModelStreamDelta, TokenUsage};
use crate::sandbox::SandboxSession;
use crate::skills::SkillRegistry;
use crate::tools::{self, ToolResult, ToolRuntime};
use crate::types::{Message, ToolCall, ToolDefinition};

mod compaction;
mod dag;
mod preview;
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
use compaction::{CompactionState, PreparedProviderView};
pub(crate) use preview::key_arg_preview;
use preview::*;
use tool_exec::execute_tools_parallel;

const TOOL_ARGS_DETAIL_LIMIT: usize = 8_192;

fn duration_millis(duration: Duration) -> u64 {
    u64::try_from(duration.as_millis()).unwrap_or(u64::MAX)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AgentMode {
    Worker,
    Orchestrator,
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
    /// OpenSSH target for remote sessions; mutually exclusive with sandbox.
    pub ssh_host: Option<String>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub extra_tool_defs: Vec<ToolDefinition>,
    pub agents_md_message: Option<String>,
    pub thread_timeout_secs: u64,
}

pub struct Agent {
    client: ModelClient,
    pub messages: Vec<Message>,
    tool_defs: Vec<ToolDefinition>,
    compaction: Option<CompactionState>,
    tool_runtime: ToolRuntime,
    event_sink: EventSink,
    thread_name: Option<String>,
    steering_dispatch_id: Option<String>,
    appended_steering_ids: HashSet<i64>,
    /// Orchestrator transcript log sink (DB-direct transcript workset, see
    /// store/transcript.rs). Present only for orchestrator agents with a
    /// session id — workers (separate `__worker` processes) never log.
    transcript_log: Option<TranscriptLogSink>,
    /// Token usage from the most recent `send()` call, updated after each
    /// model call; `None` if the provider omitted usage.
    pub last_usage: Option<crate::model::TokenUsage>,
}

/// Connection and identity needed to append to the orchestrator transcript
/// log. The writer is shared into `spawn_blocking` closures per append.
struct TranscriptLogSink {
    writer: Arc<crate::store::TranscriptLogWriter>,
    session_id: String,
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
    let Some(index) = messages.iter().rposition(|message| {
        matches!(
            message,
            Message::Assistant {
                tool_calls: Some(tool_calls),
                ..
            } if !tool_calls.is_empty()
        )
    }) else {
        return;
    };
    let Message::Assistant {
        tool_calls: Some(tool_calls),
        ..
    } = &messages[index]
    else {
        return;
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
    if !expected.is_subset(&observed) {
        messages.truncate(index);
    }
}

impl Agent {
    pub fn with_config(client: ModelClient, config: AgentConfig) -> Result<Self> {
        let cwd = config.working_directory.clone();
        let thread_timeout_secs = config.thread_timeout_secs;
        let mode = config.mode;
        let compaction = if mode == AgentMode::Orchestrator {
            config.session_id.clone().map(|session_id| {
                CompactionState::new(
                    config.store_path.clone(),
                    session_id,
                    config.orchestrator_compaction_threshold,
                )
            })
        } else {
            None
        };
        // Construction-time gate for the transcript log: orchestrator-only,
        // and only with a session id (mirrors the compaction gate). Worker
        // agents run in separate `__worker` processes and must never write
        // `__orchestrator__` transcript rows.
        let transcript_log = match (mode, config.session_id.clone()) {
            (AgentMode::Orchestrator, Some(session_id)) => Some(TranscriptLogSink {
                writer: Arc::new(crate::store::TranscriptLogWriter::new(&config.store_path)?),
                session_id,
            }),
            _ => None,
        };

        let (system_prompt, mut tool_defs) = match config.mode {
            AgentMode::Worker => (
                format!(
                    "You are nac, a coding worker. Working directory: {}.\n\n\
                     A retained episode is the durable record of this dispatch. Your final response becomes \
                     that stored episode.\n\n\
                     Complete exactly one bounded action using your tools. Your final response should be a \
                     compressed work record for future dispatches, not a conversational reply.\n\
                     Preserve durable information:\n\
                     - end goal\n\
                     - current approach\n\
                     - steps completed so far\n\
                     - current failure or blocker\n\
                     - important results\n\
                     - file paths\n\
                     - decisions made\n\
                     - verification outcomes\n\
                     - current state\n\
                     - unresolved issues or next useful follow-up\n\n\
                     If this dispatch establishes setup, baseline, or verification state, preserve the exact \
                     commands used, important environment caveats, and what is currently known-good versus \
                     known-broken.\n\
                     Write the retained episode as a handoff to future threads. Preserve discoveries that \
                     would otherwise be lost between contexts, especially setup steps, verification results, \
                     current failure modes, and the next useful starting point.\n\
                     Do not claim work is complete without concrete verification evidence.\n\
                     Avoid creating extra Markdown documents or notes files unless the user explicitly \
                     asks for them.\n\
                     Do not dump raw tool traces. Do not restate borrowed context unless it materially affected \
                     the outcome of this dispatch.\n\n\
                     You have access to a persistent terminal via exec_command and write_stdin.\n\
                     - Use exec_command with tty=false for quick commands, like a one-shot bash tool; yield_time_ms is the command timeout for this mode.\n\
                     - Use exec_command with tty=true to create a persistent shell session. You'll get a session_name back.\n\
                     - For tty=true, yield_time_ms only controls how long to wait for output before returning; it does not kill the session.\n\
                     - Use write_stdin to send input to that session and read output.\n\
                     - yield_time_ms on exec_command and write_stdin can be up to 3600000 ms (1 hour). Prefer short polls (write_stdin with empty chars) for interactive flows; use a single long wait for known-long commands like builds and test suites, and keep waits well under your remaining task budget.\n\
                     - Persistent shells keep state (cwd, env vars, venvs, etc.) across calls. Use them for multi-step workflows.\n\
                     - Always prefer write_stdin with empty chars to poll for output from a running command before sending new input.\n\
                     - Close sessions by sending exit<RET> or <C-d>. Sessions auto-cleanup when the worker finishes.",
                    cwd
                ),
                tools::worker_tool_definitions(),
            ),
            AgentMode::Orchestrator => (
                format!(
                    "You are nac, a coding agent orchestrator. Working directory: {}.\n\n\
                     A thread is a named workstream that executes one action at a time and retains its own \
                     history across dispatches. Reusing a thread gives the worker that thread's retained \
                     history, and referencing another thread gives the worker that thread's latest retained \
                     episode as input for the current dispatch.\n\n\
                     A retained episode is the stored result of one completed thread dispatch. It preserves \
                     the important work from that dispatch so it can be read later and used as input to future \
                     thread work.\n\n\
                     Threads and episodes are your synchronization primitive. Externalize work into bounded \
                     thread dispatches instead of doing implementation work yourself.\n\
                     Reuse a thread when work belongs to the same ongoing stream. Create a new thread only \
                     for a genuinely distinct workstream.\n\
                     Each dispatch should be one concrete action. Use source threads only when their latest \
                     retained episodes are relevant input.\n\
                     Prefer bounded, information-dense thread dispatches over long in-context reasoning or \
                     noisy exploration.\n\
                     When the codebase area or failure mode is unclear, dispatch research before \
                     implementation. For complex work, you may do multiple rounds of compacted research \
                     before choosing an implementation action.\n\
                     Prefer to externalize high-leverage artifacts first: understanding of the relevant \
                     code, likely approach, verification strategy, and current blocker. If multiple \
                     independent approaches are plausible, you may explore them in parallel and continue \
                     with the best episode.\n\
                     Early in a session, prefer a first worker dispatch that brings the environment into a \
                     steady usable state for the threads that follow. That can include setup, dependency \
                     installation, startup validation, or establishing a baseline verification path.\n\
                     When setup, environment health, or the verification path is unclear, dispatch a setup or \
                     baseline thread before implementation.\n\
                     Prefer stable thread roles when useful, such as setup, impl/<topic>, and verify/<topic>.\n\
                     Threads do not share full live context with each other. When you dispatch \
                     thread(name, action, threads?, skills?, timeout?), the worker for name receives that thread's own retained \
                     history, and if you provide threads, it also receives the latest retained episode from \
                     each named source thread as input for that dispatch. The worker's final response becomes \
                     the next retained episode for name. The default thread timeout is {} seconds, with \
                     a minimum of 1800 seconds; pass timeout only when a dispatch genuinely needs a different limit.\n\
                     If available worker skills clearly match a dispatch, pass skills with the selected skill names; workers receive those instructions before starting and cannot activate skills themselves later.\n\
                     Use this mechanism deliberately. Dispatch work so that important setup, implementation, \
                     and verification threads end by producing a high-signal retained episode that another \
                     thread can act on directly. Avoid dispatches that leave behind weak episodes and force \
                     later threads to rediscover setup state, verification state, or prior conclusions.\n\
                     Work one bounded unit at a time. Before declaring a task done, dispatch a fresh verification \
                     thread when appropriate instead of relying only on the implementation thread's judgment.\n\
                     Act as the communication bridge between threads. When a thread's retained episode surfaces a \
                     discovery, blocker, or changed assumption relevant to another active thread, re-dispatch that \
                     thread with the discovering thread as a source. You have broader context than any single \
                     worker — filter and synthesize findings rather than passing them through raw. Do not wait for \
                     workers to discover each other's output.\n\
                     A workset is a durable high-level plan, not your current focus and not an execution \
                     queue. A workset stores a goal, summary, status, verification recipe, and ordered \
                     items with scope, role, dependencies, acceptance criteria, and optional notes.\n\
                     Workset schema: `id` is the short stable handle used by `/run <workset>`; `goal` is \
                     the enduring user-facing objective; `status` is the whole-plan state; `summary` is \
                     the compact plan synopsis; `verification_recipe` is the optional end-to-end check. \
                     Each item has `title` for the concise work label, `scope` for owned files/modules \
                     or system boundary, `description` for the concrete work, `role` for the intended \
                     mode such as research/implementation/verification, `depends_on` for prerequisite \
                     item titles or ids, `acceptance` for the concrete completion condition, and optional \
                     `notes` for durable context discovered while planning or running.\n\
                     Avoid creating extra Markdown documents or notes files unless the user explicitly \
                     asks for them.\n\
                     You may dispatch multiple threads in a single response. When you do, the system \
                     builds a dependency DAG from the threads parameters of each dispatched thread. \
                     Threads with no in-batch source dependencies launch immediately and run \
                     concurrently. Threads that reference other threads being dispatched in the same \
                     response automatically wait for those source threads to complete before \
                     starting. Source threads that already exist from prior turns are loaded \
                     normally — only same-batch dependencies are ordered. Do not create circular \
                     dependencies (thread A depends on B while B depends on A); the system will \
                     reject them. This enables patterns like best-of-N: dispatch multiple \
                     independent explorations in one response, then a synthesis thread that takes \
                     all of them as source threads and waits for them to finish.\n\n\
                     Your tools:\n\
                     - thread(name, action, threads?, skills?, timeout?)\n\
                     - threads()\n\
                     - thread_read(name)\n\
                     - thread_delete(name)\n\
                     - workset_define(id, goal, status, summary, verification_recipe?, workset_items[])\n\
                     - workset_read(id)\n\
                     - workset_list()\n\n\
                     You must use threads for all coding work. You cannot read, write, or edit files directly.",
                    cwd, thread_timeout_secs
                ),
                tools::orchestrator_tool_definitions(config.skills.as_deref()),
            ),
        };
        if config.mode == AgentMode::Worker {
            tool_defs.extend(config.extra_tool_defs);
        }

        let mut messages = vec![Message::System {
            content: system_prompt,
        }];
        if let Some(agents_md_message) = config.agents_md_message {
            if config.mode == AgentMode::Worker {
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
            config.ssh_host,
            config.sandbox,
            &config.workspace_cwd,
            &local_paths,
        )?;
        Ok(Self {
            client,
            messages,
            tool_defs,
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
                terminal_manager: crate::terminal::TerminalManager::new(),
                thread_timeout_secs: config.thread_timeout_secs,
                worker_usage: Arc::new(Mutex::new(TokenUsage::default())),
            },
            event_sink: config.event_sink,
            thread_name: config.thread_name,
            steering_dispatch_id: config.dispatch_id,
            appended_steering_ids: HashSet::new(),
            transcript_log,
            last_usage: None,
        })
    }

    #[cfg(test)]
    pub fn default(client: ModelClient) -> Self {
        let workspace_cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let working_directory = workspace_cwd.display().to_string();

        Self::with_config(
            client,
            AgentConfig {
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
                ssh_host: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
                thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
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

    pub async fn send(&mut self, prompt: &str) -> Result<String> {
        self.emit(AgentEvent::RunStarted {
            thread_name: self.thread_name.clone(),
            prompt_preview: preview(prompt, 160),
        });
        // `last_usage` is per-send. Clearing it prevents a cancellation before
        // the first current model response from persisting a previous run's usage.
        self.last_usage = None;
        // Transcript commit point (prompt): the prompt is durable in the log
        // before the first model call. A log failure is fatal to the run.
        if let Err(error) = self
            .push_and_log(Message::User {
                content: prompt.to_string(),
            })
            .await
        {
            self.emit(AgentEvent::Error {
                thread_name: self.thread_name.clone(),
                message: error.to_string(),
            });
            self.tool_runtime.terminal_manager.remove_all().await;
            return Err(error);
        }

        if let Err(error) = self.ensure_backend_ready().await {
            self.emit(AgentEvent::Error {
                thread_name: self.thread_name.clone(),
                message: error.to_string(),
            });
            self.tool_runtime.terminal_manager.remove_all().await;
            return Err(error);
        }

        let mut iteration = 0usize;
        let mut accumulated_usage = TokenUsage::default();
        loop {
            self.append_pending_steering_checked().await?;
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
            let deltas = CoalescedDeltas::new(|delta: ModelStreamDelta| {
                self.event_sink.emit_assistant_delta(AssistantStreamDelta {
                    thread_name: self.thread_name.clone(),
                    text: (!delta.text.is_empty()).then_some(delta.text),
                    reasoning: (!delta.reasoning.is_empty()).then_some(delta.reasoning),
                });
            });
            let push_delta = |delta| deltas.push(delta);
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
                    self.tool_runtime.terminal_manager.remove_all().await;
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
                self.tool_runtime.terminal_manager.remove_all().await;
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
                self.tool_runtime.terminal_manager.remove_all().await;
                return Err(error);
            }
            if let Some(compaction) = &mut self.compaction {
                compaction.record_ordinary_context(
                    &self.messages,
                    ordinary_context_tokens.unwrap_or(0),
                    self.messages.len(),
                    provider_view.checkpoint_id,
                );
            }

            if !has_tool_calls {
                if self.append_pending_steering_checked().await? > 0 {
                    continue;
                }
                let content = response
                    .assistant
                    .content
                    .unwrap_or_else(|| "[No response]".to_string());
                self.emit(AgentEvent::AssistantMessage {
                    thread_name: self.thread_name.clone(),
                    content: content.clone(),
                    usage: Some(accumulated_usage.clone()),
                });
                self.last_usage = Some(accumulated_usage.clone());
                self.emit(AgentEvent::RunFinished {
                    thread_name: self.thread_name.clone(),
                });
                self.tool_runtime.terminal_manager.remove_all().await;
                return Ok(content);
            }

            let tool_calls = response.assistant.tool_calls.unwrap_or_default();
            let results = execute_tools_parallel(
                tool_calls,
                self.tool_runtime.clone(),
                self.client.clone(),
                self.event_sink.clone(),
                self.thread_name.clone(),
            )
            .await;

            // Fold worker token usage (from thread dispatches) into the
            // orchestrator's accumulated usage. Only cost fields are summed;
            // orchestrator context stays ordinary-orchestrator-only.
            {
                let mut wu = self.tool_runtime.worker_usage.lock().await;
                accumulated_usage.add_cost_saturating(&wu);
                *wu = TokenUsage::default();
            }

            self.last_usage = Some(accumulated_usage.clone());

            let tool_messages = results
                .into_iter()
                .map(|(tool_call_id, _tool_name, result)| Message::Tool {
                    tool_call_id,
                    content: result.content,
                })
                .collect::<Vec<_>>();
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
                self.tool_runtime.terminal_manager.remove_all().await;
                return Err(error);
            }
        }
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
    /// 3), so reads and appends serialize on one connection.
    pub fn transcript_log_writer(&self) -> Option<Arc<crate::store::TranscriptLogWriter>> {
        self.transcript_log.as_ref().map(|sink| sink.writer.clone())
    }

    #[cfg(test)]
    pub(crate) async fn push_and_log_for_test(&mut self, message: Message) -> Result<()> {
        self.push_and_log(message).await
    }

    /// Restore a stored transcript while keeping the current system prompt.
    pub fn restore_messages(&mut self, mut messages: Vec<Message>) {
        if let Some(Message::System { content: stored }) = messages.first_mut() {
            if let Some(Message::System { content: fresh }) = self.messages.first() {
                *stored = fresh.clone();
            }
        }
        self.messages = messages;
        if let Some(compaction) = &mut self.compaction {
            compaction.reset_for_transcript_replacement();
        }
    }

    /// Restore from a snapshot blob, then merge any transcript-log tail (rows
    /// with `idx >= blob.len()`) left behind by a crashed run, and normalize
    /// a dangling tool turn in both the restored transcript and the log
    /// (crash-resume normalization). An empty log tail is exactly
    /// [`Agent::restore_messages`] — the pre-log behavior.
    ///
    /// The merge fails loudly when the tail is not contiguous with the blob:
    /// appends are log-first and `idx` is the absolute Vec index, so a gap
    /// means the log and the snapshot disagree about the transcript.
    pub async fn restore_messages_merging_log_tail(
        &mut self,
        messages: Vec<Message>,
    ) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            self.restore_messages(messages);
            return Ok(());
        };
        let blob_len = messages.len();
        let tail = {
            let writer = sink.writer.clone();
            let session_id = sink.session_id.clone();
            tokio::task::spawn_blocking(move || writer.read_from(&session_id, blob_len as u64))
                .await
                .map_err(|error| anyhow!("transcript log read task failed: {error}"))??
        };
        if tail.is_empty() {
            self.restore_messages(messages);
            return Ok(());
        }

        let mut merged = messages;
        let mut expected_idx = blob_len as u64;
        for (idx, message) in tail {
            if idx != expected_idx {
                return Err(anyhow!(
                    "transcript log tail is not contiguous with the snapshot: expected idx {expected_idx}, found {idx}"
                ));
            }
            merged.push(message);
            expected_idx += 1;
        }

        let merged_len = merged.len();
        truncate_incomplete_tool_turn(&mut merged);
        if merged.len() < merged_len {
            self.delete_log_tail(merged.len() as u64).await?;
        }
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
    /// Both terminal paths treat a normalization error as best-effort: the
    /// next restore re-normalizes the stale tail.
    pub async fn normalize_dangling_tail(&mut self) -> Result<()> {
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
    pub async fn append_cancellation_marker(&mut self) -> Result<()> {
        self.normalize_dangling_tail().await?;
        self.push_and_log(Message::Assistant {
            content: Some("[run cancelled by user]".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
        })
        .await
    }

    /// Append `messages` to the transcript log at absolute positions
    /// `start_idx..` via `spawn_blocking` (steering-claim precedent). A no-op
    /// for agents without a transcript log (workers, picker sessions).
    async fn log_transcript_batch(&self, start_idx: u64, messages: &[Message]) -> Result<()> {
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
        tokio::task::spawn_blocking(move || writer.append_batch(&session_id, start_idx, &messages))
            .await
            .map_err(|error| anyhow!("transcript log append task failed: {error}"))??;
        // Live trigger (step 3): emitted after the log commit, before the
        // vec push — the store-backed read path sees the rows immediately.
        self.event_sink
            .emit_transcript_appended(start_idx + batch_len);
        Ok(())
    }

    /// Append one message to the transcript log at absolute position `idx`
    /// via `spawn_blocking`. A no-op for agents without a transcript log.
    async fn log_transcript_message(&self, idx: u64, message: &Message) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        let message = message.clone();
        tokio::task::spawn_blocking(move || writer.append(&session_id, idx, &message))
            .await
            .map_err(|error| anyhow!("transcript log append task failed: {error}"))??;
        // Live trigger (step 3): see log_transcript_batch.
        self.event_sink.emit_transcript_appended(idx + 1);
        Ok(())
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
    async fn log_transcript_tail(&self, from_idx: usize) -> Result<()> {
        let staged = self.messages[from_idx..].to_vec();
        self.log_transcript_batch(from_idx as u64, &staged).await
    }

    /// Delete log rows with `idx >= from_idx` (crash/cancel normalization).
    async fn delete_log_tail(&self, from_idx: u64) -> Result<()> {
        let Some(sink) = &self.transcript_log else {
            return Ok(());
        };
        let writer = sink.writer.clone();
        let session_id = sink.session_id.clone();
        tokio::task::spawn_blocking(move || writer.delete_from(&session_id, from_idx))
            .await
            .map_err(|error| anyhow!("transcript log tail delete task failed: {error}"))??;
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
                self.tool_runtime.terminal_manager.remove_all().await;
                Err(error)
            }
        }
    }

    fn emit(&self, event: AgentEvent) {
        self.event_sink.emit(event);
    }
}

#[cfg(test)]
mod tests;
