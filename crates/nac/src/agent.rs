use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;
use tokio::task::JoinSet;

use crate::api::ModelClient;
use crate::events::{AgentEvent, EventSink};
use crate::mcp::McpRegistry;
use crate::sandbox::SandboxSession;
use crate::skills::SkillRegistry;
use crate::tools::{self, ToolResult, ToolRuntime};
use crate::types::{Message, ToolCall, ToolDefinition};

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
    pub event_sink: EventSink,
    pub working_directory: String,
    pub sandbox: Option<SandboxSession>,
    pub mcp: Option<Arc<McpRegistry>>,
    pub skills: Option<Arc<SkillRegistry>>,
    pub extra_tool_defs: Vec<ToolDefinition>,
    pub agents_md_message: Option<String>,
}

pub struct Agent {
    client: ModelClient,
    pub messages: Vec<Message>,
    tool_defs: Vec<ToolDefinition>,
    tool_runtime: ToolRuntime,
    event_sink: EventSink,
    thread_name: Option<String>,
}

impl Agent {
    pub fn new(client: ModelClient) -> Self {
        Self::default(client)
    }

    pub fn with_config(client: ModelClient, config: AgentConfig) -> Self {
        let cwd = config.working_directory.clone();

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
                     - Use exec_command with tty=false for quick one-shot commands; yield_time_ms is the command timeout for this mode.\n\
                     - Use exec_command with tty=true to create a persistent shell session. You'll get a session_name back.\n\
                     - For tty=true, yield_time_ms only controls how long to wait for output before returning; it does not kill the session.\n\
                     - Use write_stdin to send input to that session and read output.\n\
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
                     thread(name, action, threads?, timeout?), the worker for name receives that thread's own retained \
                     history, and if you provide threads, it also receives the latest retained episode from \
                     each named source thread as input for that dispatch. The worker's final response becomes \
                     the next retained episode for name. The default thread timeout is 3600 seconds, with \
                     a minimum of 1800 seconds; pass timeout only when a dispatch genuinely needs a different limit.\n\
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
                     A workset is a durable coordination artifact for multi-step efforts such as batch, plan, \
                     or review workflows. A workset stores a structured set of items with thread names, scopes, \
                     statuses, and verification guidance. Use worksets when the user explicitly asks for a \
                     structured plan or when multi-turn coordination would otherwise become brittle.\n\
                     Do not create worksets for trivial one-off tasks. When you do create one, make it concise, \
                     specific, and grounded in named threads and clear scope ownership.\n\
                     Avoid creating extra Markdown documents or notes files unless the user explicitly \
                     asks for them.\n\
                     You may dispatch independent threads in parallel when useful.\n\n\
                     Your tools:\n\
                     - thread(name, action, threads?, timeout?)\n\
                     - threads()\n\
                     - thread_read(name)\n\
                     - thread_delete(name)\n\
                     - workset_define(id, kind, instruction, status, summary, verification_recipe?, items[])\n\
                     - workset_read(id)\n\
                     - workset_list(kind?)\n\n\
                     You must use threads for all coding work. You cannot read, write, or edit files directly.",
                    cwd
                ),
                tools::orchestrator_tool_definitions(),
            ),
        };
        let skills_catalog_message = if config.mode == AgentMode::Worker {
            config
                .skills
                .as_ref()
                .and_then(|registry| registry.catalog_message())
        } else {
            None
        };
        if config.mode == AgentMode::Worker {
            if let Some(skills) = &config.skills {
                tool_defs.push(skills.tool_definition());
            }
            tool_defs.extend(config.extra_tool_defs);
        }

        let mut messages = vec![Message::System {
            content: system_prompt,
        }];
        if let Some(agents_md_message) = config.agents_md_message {
            messages.push(Message::System {
                content: agents_md_message,
            });
        }
        if let Some(skills_catalog_message) = skills_catalog_message {
            messages.push(Message::System {
                content: skills_catalog_message,
            });
        }
        messages.extend(config.initial_messages);

        Self {
            client,
            messages,
            tool_defs,
            tool_runtime: ToolRuntime {
                store_path: config.store_path,
                session_id: config.session_id,
                active_threads: Arc::new(Mutex::new(HashSet::new())),
                event_sink: config.event_sink.clone(),
                sandbox: config.sandbox,
                mcp: config.mcp,
                skills: config.skills,
                activated_skills: Arc::new(Mutex::new(HashSet::new())),
                terminal_manager: crate::terminal::TerminalManager::new(),
            },
            event_sink: config.event_sink,
            thread_name: config.thread_name,
        }
    }

    pub fn default(client: ModelClient) -> Self {
        Self::with_config(
            client,
            AgentConfig {
                mode: AgentMode::Worker,
                store_path: crate::store::default_store_path(),
                session_id: None,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                working_directory: std::env::current_dir()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|_| ".".to_string()),
                sandbox: None,
                mcp: None,
                skills: None,
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
            },
        )
    }

    pub async fn send(&mut self, prompt: &str) -> Result<String> {
        self.emit(AgentEvent::RunStarted {
            thread_name: self.thread_name.clone(),
            prompt_preview: preview(prompt, 160),
        });
        self.messages.push(Message::User {
            content: prompt.to_string(),
        });

        let mut iteration = 0usize;
        loop {
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
                    self.emit(AgentEvent::Error {
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    self.tool_runtime.terminal_manager.remove_all().await;
                    return Err(error);
                }
            };
            if response.finish_reason.as_deref() == Some("length") {
                let error = anyhow!(
                    "Context window full (finish_reason=length). nac does not auto-compact thread history right now; retry with a narrower prompt, a fresh thread, or less carried context."
                );
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
                let content = response
                    .assistant
                    .content
                    .unwrap_or_else(|| "[No response]".to_string());
                self.emit(AgentEvent::AssistantMessage {
                    thread_name: self.thread_name.clone(),
                    content: content.clone(),
                });
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
            for (tool_call_id, _tool_name, result) in results {
                self.messages.push(Message::Tool {
                    tool_call_id,
                    content: result.content,
                });
            }
        }
    }

    pub fn set_event_sink(&mut self, sink: EventSink) {
        self.event_sink = sink.clone();
        self.tool_runtime.event_sink = sink;
    }

    pub fn restore_messages(&mut self, messages: Vec<Message>) {
        self.messages = messages;
    }

    fn emit(&self, event: AgentEvent) {
        self.event_sink.emit(event);
    }
}

async fn execute_tools_parallel(
    tool_calls: Vec<ToolCall>,
    runtime: ToolRuntime,
    client: ModelClient,
    event_sink: EventSink,
    thread_name: Option<String>,
) -> Vec<(String, String, ToolResult)> {
    let mut join_set: JoinSet<(usize, String, String, ToolResult)> = JoinSet::new();

    for (index, tool_call) in tool_calls.into_iter().enumerate() {
        let id = tool_call.id;
        let name = tool_call.function.name;
        let args_str = tool_call.function.arguments;
        let runtime = runtime.clone();
        let client = client.clone();
        event_sink.emit(AgentEvent::ToolCallStarted {
            thread_name: thread_name.clone(),
            call_id: id.clone(),
            name: name.clone(),
            args_preview: preview_tool_args(&name, &args_str),
            args_detail: Some(tool_args_detail(&args_str)),
        });

        join_set.spawn(async move {
            let args = match serde_json::from_str::<serde_json::Value>(&args_str) {
                Ok(value) => value,
                Err(error) => {
                    return (
                        index,
                        id,
                        name.clone(),
                        ToolResult {
                            content: format!(
                                "Error: failed to parse tool arguments for '{}': {}",
                                name, error
                            ),
                            is_error: true,
                        },
                    );
                }
            };

            let result = tools::execute_tool(&name, args, &runtime, &client).await;
            (index, id, name, result)
        });
    }

    let mut results = Vec::new();
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok((index, tool_call_id, tool_name, result)) => {
                event_sink.emit(AgentEvent::ToolCallFinished {
                    thread_name: thread_name.clone(),
                    call_id: tool_call_id.clone(),
                    name: tool_name.clone(),
                    content_preview: preview_tool_result(&tool_name, &result),
                    is_error: result.is_error,
                });
                results.push((index, tool_call_id, tool_name, result));
            }
            Err(error) => results.push((
                usize::MAX,
                "unknown".to_string(),
                "unknown".to_string(),
                ToolResult {
                    content: format!("Tool task panicked: {}", error),
                    is_error: true,
                },
            )),
        }
    }

    results.sort_by_key(|(index, ..)| *index);
    results
        .into_iter()
        .map(|(_, tool_call_id, tool_name, result)| (tool_call_id, tool_name, result))
        .collect()
}

fn preview(value: &str, max_len: usize) -> String {
    let sanitized = value.replace('\n', "\\n");
    if sanitized.len() <= max_len {
        sanitized
    } else {
        format!("{}...", &sanitized[..max_len])
    }
}

fn tool_args_detail(args: &str) -> String {
    preview(args, TOOL_ARGS_DETAIL_LIMIT)
}

fn preview_tool_args(name: &str, args_str: &str) -> String {
    let parsed = serde_json::from_str::<serde_json::Value>(args_str).ok();
    match name {
        "read" | "write" | "edit" => {
            if let Some(path) = parsed
                .as_ref()
                .and_then(|value| value.get("path"))
                .and_then(|value| value.as_str())
            {
                return preview(path, 120);
            }
        }
        "bash" => {
            if let Some(command) = parsed
                .as_ref()
                .and_then(|value| value.get("command"))
                .and_then(|value| value.as_str())
            {
                return preview(command, 120);
            }
        }
        "thread" => {
            if let Some(value) = parsed.as_ref() {
                let thread_name = value
                    .get("name")
                    .and_then(|item| item.as_str())
                    .unwrap_or("?");
                let action = value
                    .get("action")
                    .and_then(|item| item.as_str())
                    .unwrap_or("dispatch");
                return preview(&format!("{thread_name}: {action}"), 120);
            }
        }
        "activate_skill" => {
            if let Some(skill) = parsed
                .as_ref()
                .and_then(|value| value.get("name"))
                .and_then(|value| value.as_str())
            {
                return preview(skill, 120);
            }
        }
        _ => {}
    }

    preview(args_str, 120)
}

fn preview_tool_result(name: &str, result: &ToolResult) -> String {
    let trimmed = result.content.trim();
    if trimmed.is_empty() && !result.is_error {
        return "ok".to_string();
    }

    let lines: Vec<&str> = result
        .content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return preview(trimmed, 160);
    }

    if let Some(summary) = select_summary_line(name, &lines) {
        return preview(summary, 160);
    }

    preview(lines[0], 160)
}

fn select_summary_line<'a>(name: &str, lines: &'a [&'a str]) -> Option<&'a str> {
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("Exit code:"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("Command timed out after"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.contains("test result:"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("Finished `"))
    {
        return Some(line);
    }
    if let Some(line) = lines
        .iter()
        .copied()
        .find(|line| line.starts_with("error:"))
    {
        return Some(line);
    }
    if name == "bash" {
        return lines.last().copied();
    }
    None
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
    fn worker_surfaces_skills_but_orchestrator_does_not() {
        let client = ModelClient::new_for_test();
        let registry = Arc::new(crate::skills::SkillRegistry::load_for_test(vec![
            crate::skills::SkillRecord {
                name: "lint".to_string(),
                description: "Run linting workflows.".to_string(),
                compatibility: None,
                skill_md_path: PathBuf::from("/tmp/lint/SKILL.md"),
                skill_root_host: PathBuf::from("/tmp/lint"),
                skill_root_visible: PathBuf::from("/tmp/lint"),
                body: "body".to_string(),
                resources: Vec::new(),
            },
        ]));

        let worker = Agent::with_config(
            client.clone(),
            AgentConfig {
                mode: AgentMode::Worker,
                store_path: crate::store::default_store_path(),
                session_id: None,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                working_directory: ".".to_string(),
                sandbox: None,
                mcp: None,
                skills: Some(registry.clone()),
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
            },
        );
        assert!(worker
            .tool_defs
            .iter()
            .any(|definition| definition.function.name == "activate_skill"));
        assert!(worker.messages.iter().any(|message| match message {
            Message::System { content } => content.contains("<available_skills>"),
            _ => false,
        }));

        let orchestrator = Agent::with_config(
            client,
            AgentConfig {
                mode: AgentMode::Orchestrator,
                store_path: crate::store::default_store_path(),
                session_id: None,
                initial_messages: Vec::new(),
                thread_name: None,
                event_sink: EventSink::none(),
                working_directory: ".".to_string(),
                sandbox: None,
                mcp: None,
                skills: Some(registry),
                extra_tool_defs: Vec::new(),
                agents_md_message: None,
            },
        );
        assert!(!orchestrator
            .tool_defs
            .iter()
            .any(|definition| definition.function.name == "activate_skill"));
        assert!(!orchestrator.messages.iter().any(|message| match message {
            Message::System { content } => content.contains("<available_skills>"),
            _ => false,
        }));
    }

    #[test]
    fn tool_args_detail_is_larger_than_preview_but_bounded() {
        let args = "x".repeat(TOOL_ARGS_DETAIL_LIMIT + 10);
        let detail = tool_args_detail(&args);

        assert!(detail.starts_with(&"x".repeat(TOOL_ARGS_DETAIL_LIMIT)));
        assert!(detail.ends_with("..."));
        assert_eq!(detail.len(), TOOL_ARGS_DETAIL_LIMIT + 3);
    }
}
