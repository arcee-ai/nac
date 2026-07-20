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

mod dag;
mod preview;
mod tool_exec;

#[cfg(test)]
mod live_tests;

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
            iteration = iteration.saturating_add(1);
            self.emit(AgentEvent::ModelCallStarted {
                thread_name: self.thread_name.clone(),
                iteration,
            });

            let response = match self
                .client
                .send_turn(self.messages.clone(), self.tool_defs.clone())
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    // Preserve accumulated usage (including worker thread tokens
                    // from prior tool rounds) so it survives the error return
                    // and can be persisted by the session service.
                    self.last_usage = Some(accumulated_usage.clone());
                    self.emit(AgentEvent::Error {
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    self.tool_runtime.terminal_manager.remove_all().await;
                    return Err(error);
                }
            };
            if let Some(usage) = response.usage.clone() {
                accumulated_usage += usage.clone();
                // orchestrator_context_tokens is the current context length, not a sum.
                // Overwrite with the last call's total so it reflects the
                // live context window size after the most recent model call.
                accumulated_usage.orchestrator_context_tokens = usage.orchestrator_context_tokens;
                // Update last_usage mid-loop so partial usage survives if the
                // task is aborted (e.g. user cancels mid-run).  Without this,
                // last_usage retains the previous run's value and all token
                // usage from the current run is lost on cancel.
                self.last_usage = Some(accumulated_usage.clone());
                // Emit the per-call delta rather than accumulated usage. The
                // frontend can add orchestrator and worker calls exactly once,
                // while using only orchestrator calls for current context.
                self.emit(AgentEvent::TokenUsageUpdated {
                    thread_name: self.thread_name.clone(),
                    usage,
                });
            }
            if response.finish_reason.as_deref() == Some("length") {
                let error = anyhow!(
                    "Context window full (finish_reason=length). nac does not auto-compact thread history right now; retry with a narrower prompt, a fresh thread, or less carried context."
                );
                // Preserve accumulated usage (including worker thread tokens
                // from prior tool rounds) so it survives the error return
                // and can be persisted by the session service.
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
            // orchestrator's accumulated usage.  Only cost fields are summed;
            // orchestrator_context_tokens (context length) stays orchestrator-only.
            {
                let mut wu = self.tool_runtime.worker_usage.lock().await;
                accumulated_usage.input_tokens += wu.input_tokens;
                accumulated_usage.output_tokens += wu.output_tokens;
                accumulated_usage.cache_read_tokens += wu.cache_read_tokens;
                accumulated_usage.cache_write_tokens += wu.cache_write_tokens;
                accumulated_usage.reasoning_tokens += wu.reasoning_tokens;
                *wu = TokenUsage::default();
            }

            // Update last_usage after folding in worker tokens so the
            // partial usage reflects all token consumption up to this point.
            self.last_usage = Some(accumulated_usage.clone());

            for (tool_call_id, _tool_name, result) in results {
                self.messages.push(Message::Tool {
                    tool_call_id,
                    content: result.content,
                });
            }
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
mod tests {
    use super::*;

    #[test]
    fn test_agent_creation() {
        let client = ModelClient::new_for_test();
        let agent = Agent::default(client);
        assert!(!agent.messages.is_empty());
        assert!(!agent.tool_defs.is_empty());
    }

    #[test]
    fn restore_messages_refreshes_leading_system_prompt() {
        let client = ModelClient::new_for_test();
        let mut agent = Agent::with_config(
            client,
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path: crate::store::default_store_path(),
                session_id: None,
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: None,
                event_sink: EventSink::none(),
                workspace_cwd: PathBuf::from("/resolved/workspace"),
                config_cwd: PathBuf::from("/resolved/workspace"),
                working_directory: "/resolved/workspace".to_string(),
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
        .expect("agent config must be valid");

        agent.restore_messages(vec![
            Message::System {
                content: "You are nac. Working directory: /old/stale/path.".to_string(),
            },
            Message::User {
                content: "hello".to_string(),
            },
        ]);

        assert_eq!(agent.messages.len(), 2);
        match &agent.messages[0] {
            Message::System { content } => {
                assert!(content.contains("Working directory: /resolved/workspace"));
                assert!(!content.contains("/old/stale/path"));
            }
            other => panic!("expected refreshed system prompt, got {:?}", other),
        }
        match &agent.messages[1] {
            Message::User { content } => assert_eq!(content, "hello"),
            other => panic!("expected restored user message, got {:?}", other),
        }
    }

    #[test]
    fn exec_command_result_preview_uses_output_field() {
        let result = ToolResult {
            content: serde_json::json!({
                "output": "line one\nline two\n",
                "exit_code": 0,
                "session_name": null,
                "wall_time_ms": 1,
                "output_truncated": false,
            })
            .to_string(),
            is_error: false,
        };

        assert_eq!(preview_tool_result("exec_command", &result), "line two");
    }

    #[test]
    fn exec_command_result_preview_includes_nonzero_exit() {
        let result = ToolResult {
            content: serde_json::json!({
                "output": "failure\n",
                "exit_code": 7,
                "session_name": null,
                "wall_time_ms": 1,
                "output_truncated": false,
            })
            .to_string(),
            is_error: false,
        };

        assert_eq!(
            preview_tool_result("exec_command", &result),
            "exit 7: failure"
        );
    }

    #[test]
    fn worker_cannot_self_activate_skills_and_orchestrator_can_schedule_them() {
        let client = ModelClient::new_for_test();
        let registry = Arc::new(crate::skills::SkillRegistry::load_for_test(vec![
            crate::skills::SkillRecord {
                name: "lint".to_string(),
                description: "Run linting workflows.".to_string(),
                compatibility: None,
                skill_root_visible: PathBuf::from("/tmp/lint"),
                body: "lint body".to_string(),
                resources: Vec::new(),
            },
        ]));
        let build_agent = |mode, skills| {
            Agent::with_config(
                client.clone(),
                AgentConfig {
                    mode,
                    store_path: crate::store::default_store_path(),
                    session_id: None,
                    initial_messages: Vec::new(),
                    thread_name: None,
                    dispatch_id: None,
                    event_sink: EventSink::none(),
                    workspace_cwd: PathBuf::from("."),
                    config_cwd: PathBuf::from("."),
                    working_directory: ".".to_string(),
                    worker_executable: None,
                    sandbox: None,
                    ssh_host: None,
                    mcp: None,
                    skills,
                    extra_tool_defs: Vec::new(),
                    agents_md_message: None,
                    thread_timeout_secs: crate::tools::thread::DEFAULT_THREAD_TIMEOUT_SECS,
                },
            )
            .expect("agent config must be valid")
        };

        let worker = build_agent(AgentMode::Worker, Some(registry.clone()));
        assert!(!worker
            .tool_defs
            .iter()
            .any(|definition| definition.function.name == "activate_skill"));
        assert!(!worker.messages.iter().any(|message| match message {
            Message::System { content } => content.contains("<available_skills>"),
            _ => false,
        }));

        let orchestrator = build_agent(AgentMode::Orchestrator, Some(registry));
        assert!(!orchestrator
            .tool_defs
            .iter()
            .any(|definition| definition.function.name == "activate_skill"));
        let thread_tool = orchestrator
            .tool_defs
            .iter()
            .find(|definition| definition.function.name == "thread")
            .unwrap();
        let skills = &thread_tool.function.parameters["properties"]["skills"];
        assert_eq!(skills["items"]["enum"], serde_json::json!(["lint"]));
        assert!(skills["description"]
            .as_str()
            .unwrap()
            .contains("workers cannot activate skills themselves"));
    }

    #[test]
    fn tool_args_detail_is_larger_than_preview_but_bounded() {
        let args = "x".repeat(TOOL_ARGS_DETAIL_LIMIT + 10);
        let detail = tool_args_detail(&args);

        assert!(detail.starts_with(&"x".repeat(TOOL_ARGS_DETAIL_LIMIT)));
        assert!(detail.ends_with("..."));
        assert_eq!(detail.len(), TOOL_ARGS_DETAIL_LIMIT + 3);
    }

    #[test]
    fn preview_truncates_on_utf8_boundary() {
        assert_eq!(preview("a┌b", 2), "a...");
        assert_eq!(preview("a┌b", 4), "a┌...");
    }

    #[test]
    fn preview_handles_box_table_prompt() {
        let prompt = "hey can you see why markdown rendering is bugged in this way?\n\
Here's the quick summary of what was discovered:\n\n\
┌──────────────────┬─────────────────────────────┬─────────────────────────┐\n\
│ Property         │ Mistral (Tekken)            │ Llama 3                 │\n\
├──────────────────┼─────────────────────────────┼─────────────────────────┤\n\
│ Vocab size       │ 131,072                     │ 128,000                 │\n\
│ Tokenizer engine │ Tekken (custom,             │ BPE (tiktoken/GPT-4     │\n\
│                  │ tiktoken-based)             │ style)                  │\n\
└──────────────────┴─────────────────────────────┴─────────────────────────┘\n\
| Special tokens | <unk>, <s>, </s>, <pad> (IDs 0-999) | <|begin_of_text|>, <|end_of_text|> (IDs 128000+) |\n\
| Byte fallback | Yes (first 256 tokens = raw bytes) | No |\n\
| Pre-tokenizer | Unicode multi-script, case-sensitive | GPT-4 style with English contractions |\n\
| Merges | 269,443 | 280,147 |\n";

        let rendered = preview(prompt, 160);

        assert!(rendered.ends_with("..."));
        assert!(rendered.len() <= 163);
    }

    #[tokio::test]
    async fn multi_row_steering_ack_failure_rolls_back_messages_and_retries_once() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store_path = std::env::temp_dir()
            .join(format!("nac_agent_steering_{unique}"))
            .join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session");
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut agent = Agent::with_config(
            ModelClient::new_for_test(),
            AgentConfig {
                mode: AgentMode::Worker,
                store_path: store_path.clone(),
                session_id: Some("session".to_string()),
                initial_messages: Vec::new(),
                thread_name: Some("impl/ui".to_string()),
                dispatch_id: Some("worker-dispatch".to_string()),
                event_sink: EventSink::channel(events_tx),
                workspace_cwd: PathBuf::from("."),
                config_cwd: PathBuf::from("."),
                working_directory: ".".to_string(),
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
        .unwrap();
        let message_checkpoint = agent.messages.len();
        let first = crate::store::queue_thread_steering(
            &store_path,
            "session",
            "impl/ui",
            "worker-dispatch",
            "Keep the picker keyboard accessible.",
        )
        .unwrap();
        let second = crate::store::queue_thread_steering(
            &store_path,
            "session",
            "impl/ui",
            "worker-dispatch",
            "Preserve visible focus states.",
        )
        .unwrap();
        let connection = rusqlite::Connection::open(&store_path).unwrap();
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER fail_second_steering_ack
                 BEFORE UPDATE OF status ON thread_steering
                 WHEN OLD.id = {} AND NEW.status = 'delivered'
                 BEGIN
                     SELECT RAISE(FAIL, 'forced batch acknowledgement failure');
                 END;",
                second.id
            ))
            .unwrap();

        assert!(agent.append_pending_steering().await.is_err());
        assert_eq!(agent.messages.len(), message_checkpoint);
        assert!(agent.appended_steering_ids.is_empty());
        assert!(events_rx.try_recv().is_err());
        let claimed = crate::store::list_thread_steering(&store_path, "session").unwrap();
        assert_eq!(claimed.len(), 2);
        assert!(claimed.iter().all(|record| record.status == "claimed"));

        connection
            .execute_batch("DROP TRIGGER fail_second_steering_ack")
            .unwrap();
        assert_eq!(agent.append_pending_steering().await.unwrap(), 2);
        assert_eq!(agent.append_pending_steering().await.unwrap(), 0);
        let appended = agent.messages[message_checkpoint..]
            .iter()
            .filter_map(|message| match message {
                Message::User { content } => Some(content.as_str()),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(appended.len(), 2);
        assert_eq!(
            appended
                .iter()
                .filter(|content| content.contains("Keep the picker keyboard accessible."))
                .count(),
            1
        );
        assert_eq!(
            appended
                .iter()
                .filter(|content| content.contains("Preserve visible focus states."))
                .count(),
            1
        );
        assert!(crate::store::list_thread_steering(&store_path, "session")
            .unwrap()
            .iter()
            .all(|record| record.status == "delivered"));
        let delivered_ids = [events_rx.try_recv().unwrap(), events_rx.try_recv().unwrap()].map(
            |event| match event {
                AgentEvent::ThreadSteeringDelivered { steering_id, .. } => steering_id,
                event => panic!("expected delivered event, got {event:?}"),
            },
        );
        assert_eq!(delivered_ids, [first.id, second.id]);
        assert!(events_rx.try_recv().is_err());

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }

    #[tokio::test]
    async fn orchestrator_claims_steering_as_an_exact_user_message() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let store_path = std::env::temp_dir()
            .join(format!("nac_orchestrator_steering_{unique}"))
            .join("store.db");
        crate::store::initialize(&store_path).unwrap();
        crate::store::insert_test_session(&store_path, "session");
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        let mut agent = Agent::with_config(
            ModelClient::new_for_test(),
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path: store_path.clone(),
                session_id: Some("session".to_string()),
                initial_messages: Vec::new(),
                thread_name: None,
                dispatch_id: Some("run-dispatch".to_string()),
                event_sink: EventSink::channel(events_tx),
                workspace_cwd: PathBuf::from("."),
                config_cwd: PathBuf::from("."),
                working_directory: ".".to_string(),
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
        .unwrap();
        let instruction = "Drop the fun facts and recommend a niche OSS repository.";
        let queued = crate::store::queue_thread_steering(
            &store_path,
            "session",
            crate::store::ORCHESTRATOR_STEERING_TARGET,
            "run-dispatch",
            instruction,
        )
        .unwrap();

        assert_eq!(agent.append_pending_steering().await.unwrap(), 1);
        assert_eq!(agent.append_pending_steering().await.unwrap(), 0);
        assert!(matches!(
            agent.messages.last(),
            Some(Message::User { content }) if content == instruction
        ));
        assert!(matches!(
            events_rx.try_recv().unwrap(),
            AgentEvent::OrchestratorSteeringDelivered { steering_id, .. }
                if steering_id == queued.id
        ));

        let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
    }
}
