use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;
use tokio::task::JoinSet;

use crate::events::{AgentEvent, EventSink};
use crate::mcp::McpRegistry;
use crate::model::{ModelClient, TokenUsage};
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
pub(crate) use compaction::checkpoint_digests as compaction_checkpoint_digests_for_test;
pub(crate) use compaction::{
    CompactionCompletion, CompactionError, CompactionLifecycle, CompactionResult,
};
use compaction::{CompactionState, PreparedProviderView};
use preview::*;
use tool_exec::execute_tools_parallel;

const TOOL_ARGS_DETAIL_LIMIT: usize = 8_192;

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
    /// Token usage from the most recent `send()` call, updated after each
    /// model call; `None` if the provider omitted usage.
    pub last_usage: Option<crate::model::TokenUsage>,
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
        self.messages.push(Message::User {
            content: prompt.to_string(),
        });
        // `last_usage` is per-send. Clearing it prevents a cancellation before
        // the first current model response from persisting a previous run's usage.
        self.last_usage = None;

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

            let response = match self
                .client
                .send_turn(provider_view.messages, self.tool_defs.clone())
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    // Preserve accumulated usage (including summary and worker
                    // costs from prior rounds) so it survives the error return.
                    self.last_usage = Some(accumulated_usage.clone());
                    self.emit(AgentEvent::Error {
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

            self.messages.push(Message::Assistant {
                content: response.assistant.content.clone(),
                reasoning_text: response.assistant.reasoning_text.clone(),
                reasoning_details: response.assistant.reasoning_details.clone(),
                tool_calls: response.assistant.tool_calls.clone(),
            });
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

            for (tool_call_id, _tool_name, result) in results {
                self.messages.push(Message::Tool {
                    tool_call_id,
                    content: result.content,
                });
            }
            // The loop re-enters provider-view preparation only after the
            // complete parallel tool-result batch has been appended.
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
