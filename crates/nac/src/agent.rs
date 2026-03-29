use anyhow::{anyhow, Result};
use tokio::task::JoinSet;

use crate::api::OpenAiClient;
use crate::tools::{self, ToolResult};
use crate::types::{Message, ToolCall, ToolDefinition};

pub enum AgentMode {
    Worker,
    Orchestrator,
}

pub struct Agent {
    client: OpenAiClient,
    max_iterations: usize,
    max_context_tokens: usize,
    pub messages: Vec<Message>,
    tool_defs: Vec<ToolDefinition>,
    last_token_count: usize,
}

impl Agent {
    pub fn new(client: OpenAiClient) -> Self {
        Self::with_mode(client, AgentMode::Worker)
    }

    pub fn with_mode(client: OpenAiClient, mode: AgentMode) -> Self {
        let max_iterations = std::env::var("AGENT_MAX_ITERATIONS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(100);
        let max_context_tokens = std::env::var("AGENT_MAX_CONTEXT_TOKENS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(120_000);

        let cwd = std::env::current_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| ".".to_string());

        let (system_prompt, tool_defs) = match mode {
            AgentMode::Worker => (
                format!(
                    "You are nac, a coding worker. Working directory: {}. \
                     Complete the given task using your tools. Be thorough in your work \
                     but concise in your final response — your response will be used as \
                     context by the orchestrator that dispatched you.",
                    cwd
                ),
                tools::tool_definitions(),
            ),
            AgentMode::Orchestrator => (
                format!(
                    "You are nac, a coding agent orchestrator. Working directory: {}.\n\n\
                     You plan and coordinate coding tasks by dispatching worker threads. \
                     Each thread gets its own context and can read, write, edit files and \
                     run commands. Threads return a summary (episode) of what they did.\n\n\
                     Strategy:\n\
                     - Analyze before implementing: dispatch threads to read and understand code first\n\
                     - Analysis threads can run in parallel (multiple threads in one turn)\n\
                     - Implementation threads should run one at a time to avoid file conflicts\n\
                     - Use episodes from analysis threads as context for implementation threads\n\
                     - Verify after implementing: dispatch a thread to run tests or check results\n\n\
                     You MUST use threads for all coding work. Do not attempt to read, write, \
                     or edit files yourself — you do not have those tools. Your job is to \
                     think strategically and delegate tactically.",
                    cwd
                ),
                vec![tools::thread_definition()],
            ),
        };

        let messages = vec![Message::System { content: system_prompt }];

        Self {
            client,
            max_iterations,
            max_context_tokens,
            messages,
            tool_defs,
            last_token_count: 0,
        }
    }

    pub async fn send(&mut self, prompt: &str) -> Result<String> {
        self.messages.push(Message::User {
            content: prompt.to_string(),
        });

        for iteration in 0..self.max_iterations {
            let threshold = (self.max_context_tokens as f64 * 0.75) as usize;
            if self.last_token_count > threshold {
                eprintln!("[context] {} tokens ({}% of limit), summarizing...",
                    self.last_token_count, self.last_token_count * 100 / self.max_context_tokens.max(1));
                self.messages = summarize_context(&self.client, &self.messages).await?;
            }

            let response = self
                .client
                .chat(self.messages.clone(), self.tool_defs.clone())
                .await?;

            if let Some(ref usage) = response.usage {
                self.last_token_count = usage.total_tokens.unwrap_or(0) as usize;
            }

            let choice = response
                .choices
                .into_iter()
                .next()
                .ok_or_else(|| anyhow!("No choices in LLM response"))?;

            if choice.finish_reason.as_deref() == Some("length") {
                return Err(anyhow!("Context window full (finish_reason=length)"));
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
                return Ok(choice
                    .message
                    .content
                    .unwrap_or_else(|| "[No response]".to_string()));
            }

            let tool_calls = choice.message.tool_calls.unwrap_or_default();
            eprintln!(
                "[agent] iteration {} — {} tool call(s)",
                iteration + 1,
                tool_calls.len()
            );

            let results = execute_tools_parallel(tool_calls).await;
            for (tool_call_id, tool_name, result) in results {
                eprintln!("[result] {} => {}", tool_name, first_line(&result.content));
                self.messages.push(Message::Tool {
                    tool_call_id,
                    content: result.content,
                });
            }
        }

        Err(anyhow!("Max iterations ({}) reached", self.max_iterations))
    }
}

async fn execute_tools_parallel(tool_calls: Vec<ToolCall>) -> Vec<(String, String, ToolResult)> {
    let mut join_set: JoinSet<(usize, String, String, ToolResult)> = JoinSet::new();

    for (index, tool_call) in tool_calls.into_iter().enumerate() {
        let id = tool_call.id;
        let name = tool_call.function.name;
        let args_str = tool_call.function.arguments;
        eprintln!("[tool] {}({})", name, preview(&args_str, 120));

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

            let result = tools::execute_tool(&name, args).await;
            (index, id, name, result)
        });
    }

    let mut results = Vec::new();
    while let Some(join_result) = join_set.join_next().await {
        match join_result {
            Ok(result) => results.push(result),
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

async fn summarize_context(client: &OpenAiClient, messages: &[Message]) -> Result<Vec<Message>> {
    if messages.len() <= 6 {
        return Ok(messages.to_vec());
    }

    let system = messages.first().cloned();
    let last_four: Vec<Message> = messages
        .iter()
        .rev()
        .take(4)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();
    let to_summarize = messages[1..messages.len().saturating_sub(4)].to_vec();
    let summary = client.summarize(to_summarize).await?;

    let mut new_messages = Vec::new();
    if let Some(s) = system {
        new_messages.push(s);
    }
    new_messages.push(Message::User {
        content: format!("Previous context summary: {}", summary),
    });
    new_messages.extend(last_four);
    Ok(new_messages)
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
        let agent = Agent::new(client);
        assert!(!agent.messages.is_empty());
        assert!(!agent.tool_defs.is_empty());
    }
}
