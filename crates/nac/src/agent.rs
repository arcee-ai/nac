use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{anyhow, Result};
use tokio::sync::Mutex;
use tokio::task::JoinSet;

use crate::api::OpenAiClient;
use crate::events::{AgentEvent, EventSink};
use crate::sandbox::SandboxSession;
use crate::tools::{self, ToolResult, ToolRuntime};
use crate::types::{Message, ToolCall, ToolDefinition, Usage};

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
}

pub struct Agent {
    client: OpenAiClient,
    max_iterations: usize,
    pub messages: Vec<Message>,
    tool_defs: Vec<ToolDefinition>,
    tool_runtime: ToolRuntime,
    last_usage: Option<Usage>,
    event_sink: EventSink,
    thread_name: Option<String>,
}

impl Agent {
    pub fn new(client: OpenAiClient) -> Self {
        Self::default(client)
    }

    pub fn with_config(client: OpenAiClient, config: AgentConfig) -> Self {
        let max_iterations = std::env::var("AGENT_MAX_ITERATIONS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(100);

        let cwd = config.working_directory.clone();

        let (system_prompt, tool_defs) = match config.mode {
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
                     Do not dump raw tool traces. Do not restate borrowed context unless it materially affected \
                     the outcome of this dispatch.",
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
                     You may dispatch independent threads in parallel when useful.\n\n\
                     Your tools:\n\
                     - thread(name, action, threads?)\n\
                     - threads()\n\
                     - thread_read(name)\n\
                     - thread_delete(name)\n\n\
                     You must use threads for all coding work. You cannot read, write, or edit files directly.",
                    cwd
                ),
                tools::orchestrator_tool_definitions(),
            ),
        };

        let mut messages = vec![Message::System {
            content: system_prompt,
        }];
        messages.extend(config.initial_messages);

        Self {
            client,
            max_iterations,
            messages,
            tool_defs,
            tool_runtime: ToolRuntime {
                store_path: config.store_path,
                session_id: config.session_id,
                active_threads: Arc::new(Mutex::new(HashSet::new())),
                event_sink: config.event_sink.clone(),
                sandbox: config.sandbox,
            },
            last_usage: None,
            event_sink: config.event_sink,
            thread_name: config.thread_name,
        }
    }

    pub fn default(client: OpenAiClient) -> Self {
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
            },
        )
    }

    pub async fn send(&mut self, prompt: &str) -> Result<String> {
        self.last_usage = None;
        self.emit(AgentEvent::RunStarted {
            thread_name: self.thread_name.clone(),
            prompt_preview: preview(prompt, 160),
        });
        self.messages.push(Message::User {
            content: prompt.to_string(),
        });

        for iteration in 0..self.max_iterations {
            self.emit(AgentEvent::ModelCallStarted {
                thread_name: self.thread_name.clone(),
                iteration: iteration + 1,
            });

            let response = match self
                .client
                .chat(self.messages.clone(), self.tool_defs.clone())
                .await
            {
                Ok(response) => response,
                Err(error) => {
                    self.emit(AgentEvent::Error {
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    return Err(error);
                }
            };
            self.last_usage = response.usage.clone();

            let choice = match response.choices.into_iter().next() {
                Some(choice) => choice,
                None => {
                    let error = anyhow!("No choices in LLM response");
                    self.emit(AgentEvent::Error {
                        thread_name: self.thread_name.clone(),
                        message: error.to_string(),
                    });
                    return Err(error);
                }
            };

            if choice.finish_reason.as_deref() == Some("length") {
                let error = anyhow!("Context window full (finish_reason=length)");
                self.emit(AgentEvent::Error {
                    thread_name: self.thread_name.clone(),
                    message: error.to_string(),
                });
                return Err(error);
            }

            let has_tool_calls = choice
                .message
                .tool_calls
                .as_ref()
                .map(|tool_calls| !tool_calls.is_empty())
                .unwrap_or(false);

            self.messages.push(Message::Assistant {
                content: choice.message.content.clone(),
                tool_calls: choice.message.tool_calls.clone(),
            });

            if !has_tool_calls {
                let content = choice
                    .message
                    .content
                    .unwrap_or_else(|| "[No response]".to_string());
                self.emit(AgentEvent::AssistantMessage {
                    thread_name: self.thread_name.clone(),
                    content: content.clone(),
                });
                self.emit(AgentEvent::RunFinished {
                    thread_name: self.thread_name.clone(),
                });
                return Ok(content);
            }

            let tool_calls = choice.message.tool_calls.unwrap_or_default();
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

        let error = anyhow!("Max iterations ({}) reached", self.max_iterations);
        self.emit(AgentEvent::Error {
            thread_name: self.thread_name.clone(),
            message: error.to_string(),
        });
        Err(error)
    }

    pub fn last_completion_tokens(&self) -> Option<u32> {
        self.last_usage
            .as_ref()
            .and_then(|usage| usage.completion_tokens)
    }

    pub fn set_event_sink(&mut self, sink: EventSink) {
        self.event_sink = sink.clone();
        self.tool_runtime.event_sink = sink;
    }

    fn emit(&self, event: AgentEvent) {
        self.event_sink.emit(event);
    }
}

async fn execute_tools_parallel(
    tool_calls: Vec<ToolCall>,
    runtime: ToolRuntime,
    client: OpenAiClient,
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
            name: name.clone(),
            args_preview: preview(&args_str, 120),
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
                    name: tool_name.clone(),
                    content_preview: preview(first_line(&result.content), 160),
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

fn first_line(value: &str) -> &str {
    value.lines().next().unwrap_or("")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_creation() {
        let client = OpenAiClient::new_for_test();
        let agent = Agent::default(client);
        assert!(!agent.messages.is_empty());
        assert!(!agent.tool_defs.is_empty());
    }
}
