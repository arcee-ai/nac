use anyhow::{anyhow, Result};
use clap::ValueEnum;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;
use url::Url;

use crate::types::{FunctionCall, Message, ToolCall, ToolDefinition, Usage};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "kebab-case")]
#[value(rename_all = "kebab-case")]
pub enum BackendKind {
    Auto,
    #[serde(rename = "deepseek-chat")]
    #[value(name = "deepseek-chat")]
    DeepSeekChat,
    FireworksChat,
    #[serde(rename = "openai-responses")]
    #[value(name = "openai-responses")]
    OpenAiResponses,
}

impl BackendKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::DeepSeekChat => "deepseek-chat",
            Self::FireworksChat => "fireworks-chat",
            Self::OpenAiResponses => "openai-responses",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
#[serde(rename_all = "lowercase")]
#[value(rename_all = "lowercase")]
pub enum ReasoningEffort {
    None,
    Minimal,
    Low,
    Medium,
    High,
    Xhigh,
}

impl ReasoningEffort {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ClientOverrides {
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub backend: Option<BackendKind>,
    pub reasoning_effort: Option<ReasoningEffort>,
}

pub struct TextCompletion {
    pub content: String,
    pub usage: Usage,
}

#[derive(Debug, Clone)]
pub struct AssistantTurn {
    pub content: Option<String>,
    pub reasoning_text: Option<String>,
    pub reasoning_details: Option<Value>,
    pub tool_calls: Option<Vec<ToolCall>>,
}

#[derive(Debug, Clone)]
pub struct ModelTurnResponse {
    pub assistant: AssistantTurn,
    pub finish_reason: Option<String>,
    pub usage: Usage,
}

#[derive(Clone)]
pub struct ModelClient {
    client: Client,
    base_url: String,
    api_key: String,
    pub model: String,
    backend: BackendKind,
    reasoning_effort: Option<ReasoningEffort>,
}

impl ModelClient {
    pub fn from_env() -> Result<Self> {
        Self::from_env_with_overrides(ClientOverrides::default())
    }

    pub fn from_env_with_overrides(overrides: ClientOverrides) -> Result<Self> {
        let requested_backend = overrides.backend.unwrap_or(BackendKind::Auto);
        let base_url = overrides.base_url.unwrap_or_else(|| {
            std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| {
                default_base_url_for_backend_hint(requested_backend).to_string()
            })
        });
        let backend = match requested_backend {
            BackendKind::Auto => detect_backend(&base_url)?,
            explicit => explicit,
        };
        let api_key = api_key_for_backend(backend)?;
        let model = overrides.model.unwrap_or_else(|| {
            std::env::var("OPENAI_MODEL").unwrap_or_else(|_| default_model_for_backend(backend))
        });
        let reasoning_effort = match backend {
            BackendKind::DeepSeekChat => None,
            _ => overrides
                .reasoning_effort
                .or_else(|| default_reasoning_effort(backend)),
        };

        Ok(Self {
            client: Client::new(),
            base_url,
            api_key,
            model,
            backend,
            reasoning_effort,
        })
    }

    pub async fn send_turn(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        match self.backend {
            BackendKind::Auto => unreachable!("backend auto should be resolved at client creation"),
            BackendKind::DeepSeekChat => self.send_deepseek_chat(messages, tools).await,
            BackendKind::FireworksChat => self.send_fireworks_chat(messages, tools).await,
            BackendKind::OpenAiResponses => self.send_openai_responses(messages, tools).await,
        }
    }

    pub async fn complete_text(
        &self,
        system_prompt: &str,
        user_prompt: &str,
    ) -> Result<TextCompletion> {
        let messages = vec![
            Message::System {
                content: system_prompt.to_string(),
            },
            Message::User {
                content: user_prompt.to_string(),
            },
        ];

        let response = self.send_turn(messages, Vec::new()).await?;
        let content = response
            .assistant
            .content
            .ok_or_else(|| anyhow!("Text completion returned no text content"))?;

        Ok(TextCompletion {
            content,
            usage: response.usage,
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn backend(&self) -> BackendKind {
        self.backend
    }

    pub fn reasoning_effort(&self) -> Option<ReasoningEffort> {
        self.reasoning_effort
    }

    async fn send_fireworks_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let mut request = json!({
            "model": self.model,
            "messages": messages
                .iter()
                .map(fireworks_message_to_value)
                .collect::<Vec<_>>(),
            "tools": tools,
            "temperature": 0.0
        });

        if let Some(effort) = self.reasoning_effort {
            match effort {
                ReasoningEffort::Low | ReasoningEffort::Medium | ReasoningEffort::High => {
                    request["reasoning_effort"] = Value::String(effort.as_str().to_string());
                }
                unsupported => {
                    return Err(anyhow!(
                        "reasoning effort '{}' is not supported by fireworks-chat; use low, medium, or high",
                        unsupported.as_str()
                    ));
                }
            }
        }

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_chat_completions_response(&value, &url)
    }

    async fn send_deepseek_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = deepseek_chat_request(&self.model, &messages, &tools);

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_chat_completions_response(&value, &url)
    }

    async fn send_openai_responses(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/responses", self.base_url);
        let mut request = json!({
            "model": self.model,
            "input": responses_input_items(&messages),
        });

        if !tools.is_empty() {
            request["tools"] = Value::Array(
                tools
                    .iter()
                    .map(openai_responses_tool_to_value)
                    .collect::<Vec<_>>(),
            );
        }

        if let Some(effort) = self.reasoning_effort {
            request["reasoning"] = json!({
                "effort": effort.as_str(),
            });
        }

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_openai_responses_response(&value, &url)
    }

    async fn post_json_with_retry(&self, url: &str, body: &Value) -> Result<Value> {
        let mut last_error = anyhow!("No attempts made");

        for attempt in 0..3 {
            if attempt > 0 {
                let delay_secs = 1u64 << (attempt - 1);
                sleep(Duration::from_secs(delay_secs)).await;
            }

            let response = self
                .client
                .post(url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .json(body)
                .send()
                .await
                .map_err(|e| anyhow!("HTTP request failed for {}: {}", url, e))?;

            let status = response.status();
            let body = response
                .text()
                .await
                .map_err(|e| anyhow!("Failed to read response body: {}", e))?;

            if status.is_success() {
                return serde_json::from_str::<Value>(&body).map_err(|e| {
                    anyhow!(
                        "Failed to parse response from {}: {}\nBody: {}",
                        url,
                        e,
                        &body[..body.len().min(500)]
                    )
                });
            }

            if status.as_u16() == 429 || status.is_server_error() {
                last_error = anyhow!(
                    "HTTP {} from {}: {}",
                    status.as_u16(),
                    url,
                    &body[..body.len().min(500)]
                );
                continue;
            }

            return Err(anyhow!(
                "HTTP {} from {}: {}",
                status.as_u16(),
                url,
                &body[..body.len().min(500)]
            ));
        }

        Err(last_error)
    }
}

fn default_model_for_backend(backend: BackendKind) -> String {
    match backend {
        BackendKind::DeepSeekChat => "deepseek-v4-pro".to_string(),
        BackendKind::OpenAiResponses => "gpt-5.4".to_string(),
        BackendKind::FireworksChat => "gpt-5.4".to_string(),
        BackendKind::Auto => unreachable!("auto backend does not have a default model"),
    }
}

fn default_reasoning_effort(backend: BackendKind) -> Option<ReasoningEffort> {
    match backend {
        BackendKind::OpenAiResponses => Some(ReasoningEffort::Xhigh),
        BackendKind::DeepSeekChat => None,
        BackendKind::FireworksChat => None,
        BackendKind::Auto => None,
    }
}

fn default_base_url_for_backend_hint(backend: BackendKind) -> &'static str {
    match backend {
        BackendKind::DeepSeekChat => "https://api.deepseek.com",
        BackendKind::Auto | BackendKind::FireworksChat | BackendKind::OpenAiResponses => {
            "https://api.openai.com/v1"
        }
    }
}

fn api_key_for_backend(backend: BackendKind) -> Result<String> {
    match backend {
        BackendKind::Auto
        | BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::OpenAiResponses => std::env::var("OPENAI_API_KEY")
            .map_err(|_| anyhow!("OPENAI_API_KEY environment variable is not set")),
    }
}

pub fn detect_backend(base_url: &str) -> Result<BackendKind> {
    let parsed = Url::parse(base_url)
        .map_err(|error| anyhow!("failed to parse OPENAI_BASE_URL '{}': {}", base_url, error))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("OPENAI_BASE_URL '{}' does not include a host", base_url))?;

    if host.contains("fireworks.ai") {
        return Ok(BackendKind::FireworksChat);
    }
    if host == "api.deepseek.com" {
        return Ok(BackendKind::DeepSeekChat);
    }
    if host == "api.openai.com" {
        return Ok(BackendKind::OpenAiResponses);
    }

    Err(anyhow!(
        "could not infer backend from '{}'; pass --backend deepseek-chat, --backend fireworks-chat, or --backend openai-responses",
        base_url
    ))
}

fn fireworks_message_to_value(message: &Message) -> Value {
    match message {
        Message::System { content } => json!({
            "role": "system",
            "content": content,
        }),
        Message::User { content } => json!({
            "role": "user",
            "content": content,
        }),
        Message::Assistant {
            content,
            reasoning_text,
            tool_calls,
            ..
        } => {
            let mut value = json!({
                "role": "assistant",
                "content": content,
            });
            if let Some(reasoning_text) = reasoning_text {
                value["reasoning_content"] = Value::String(reasoning_text.clone());
            }
            if let Some(tool_calls) = tool_calls {
                value["tool_calls"] =
                    serde_json::to_value(tool_calls).unwrap_or_else(|_| Value::Array(Vec::new()));
            }
            value
        }
        Message::Tool {
            tool_call_id,
            content,
        } => json!({
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": content,
        }),
    }
}

fn openai_responses_tool_to_value(tool: &ToolDefinition) -> Value {
    json!({
        "type": "function",
        "name": tool.function.name,
        "description": tool.function.description,
        "parameters": tool.function.parameters,
    })
}

fn deepseek_chat_request(model: &str, messages: &[Message], tools: &[ToolDefinition]) -> Value {
    let mut request = json!({
        "model": model,
        "messages": messages
            .iter()
            .map(fireworks_message_to_value)
            .collect::<Vec<_>>(),
        "thinking": {
            "type": "enabled",
        },
        "reasoning_effort": "max",
    });

    if !tools.is_empty() {
        request["tools"] = serde_json::to_value(tools).unwrap_or_else(|_| Value::Array(Vec::new()));
    }

    request
}

fn responses_input_items(messages: &[Message]) -> Vec<Value> {
    let mut items = Vec::new();

    for message in messages {
        match message {
            Message::System { content } => items.push(json!({
                "role": "system",
                "content": content,
            })),
            Message::User { content } => items.push(json!({
                "role": "user",
                "content": content,
            })),
            Message::Assistant {
                content,
                reasoning_details,
                tool_calls,
                ..
            } => {
                if let Some(reasoning_details) = reasoning_details {
                    match reasoning_details {
                        Value::Array(values) => items.extend(values.clone()),
                        Value::Object(_) => items.push(reasoning_details.clone()),
                        _ => {}
                    }
                }

                if let Some(tool_calls) = tool_calls {
                    for tool_call in tool_calls {
                        items.push(json!({
                            "type": "function_call",
                            "call_id": tool_call.id,
                            "name": tool_call.function.name,
                            "arguments": tool_call.function.arguments,
                        }));
                    }
                }

                if let Some(content) = content {
                    items.push(json!({
                        "role": "assistant",
                        "content": content,
                    }));
                }
            }
            Message::Tool {
                tool_call_id,
                content,
            } => items.push(json!({
                "type": "function_call_output",
                "call_id": tool_call_id,
                "output": content,
            })),
        }
    }

    items
}

fn parse_chat_completions_response(value: &Value, url: &str) -> Result<ModelTurnResponse> {
    let choices = value
        .get("choices")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("No choices in response from {}", url))?;
    let choice = choices
        .first()
        .ok_or_else(|| anyhow!("No choices in response from {}", url))?;
    let message = choice
        .get("message")
        .ok_or_else(|| anyhow!("Response from {} did not include a message", url))?;
    let tool_calls = match message.get("tool_calls") {
        Some(Value::Array(_)) => Some(
            serde_json::from_value::<Vec<ToolCall>>(message["tool_calls"].clone())
                .map_err(|e| anyhow!("Failed to parse tool calls from {}: {}", url, e))?,
        ),
        Some(Value::Null) | None => None,
        Some(_) => {
            return Err(anyhow!(
                "Response from {} included tool_calls in an unsupported format",
                url
            ))
        }
    };

    Ok(ModelTurnResponse {
        assistant: AssistantTurn {
            content: message
                .get("content")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            reasoning_text: message
                .get("reasoning_content")
                .and_then(Value::as_str)
                .map(ToString::to_string),
            reasoning_details: None,
            tool_calls,
        },
        finish_reason: choice
            .get("finish_reason")
            .and_then(Value::as_str)
            .map(ToString::to_string),
        usage: parse_chat_usage(value.get("usage")),
    })
}

fn parse_openai_responses_response(value: &Value, url: &str) -> Result<ModelTurnResponse> {
    let output = value
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow!("Response from {} did not include output items", url))?;

    let mut message_text_parts = Vec::new();
    let mut tool_calls = Vec::new();
    let mut reasoning_items = Vec::new();

    for item in output {
        match item.get("type").and_then(Value::as_str) {
            Some("message") => {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for part in content {
                        match part.get("type").and_then(Value::as_str) {
                            Some("output_text") => {
                                if let Some(text) = part.get("text").and_then(Value::as_str) {
                                    message_text_parts.push(text.to_string());
                                }
                            }
                            Some("refusal") => {
                                if let Some(text) = part.get("refusal").and_then(Value::as_str) {
                                    message_text_parts.push(text.to_string());
                                }
                            }
                            _ => {}
                        }
                    }
                } else if let Some(text) = item.get("content").and_then(Value::as_str) {
                    message_text_parts.push(text.to_string());
                }
            }
            Some("function_call") => {
                let call_id = item
                    .get("call_id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Responses function_call item missing call_id"))?;
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Responses function_call item missing name"))?;
                let arguments = item
                    .get("arguments")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("Responses function_call item missing arguments"))?;

                tool_calls.push(ToolCall {
                    id: call_id.to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: name.to_string(),
                        arguments: arguments.to_string(),
                    },
                });
            }
            Some("reasoning") => reasoning_items.push(item.clone()),
            _ => {}
        }
    }

    let content = if !message_text_parts.is_empty() {
        Some(message_text_parts.join("\n\n"))
    } else {
        value
            .get("output_text")
            .and_then(Value::as_str)
            .map(ToString::to_string)
    };
    let reasoning_text = extract_reasoning_text(&reasoning_items);
    let reasoning_details = if reasoning_items.is_empty() {
        None
    } else {
        Some(Value::Array(reasoning_items))
    };
    let finish_reason = if value.get("status").and_then(Value::as_str) == Some("incomplete")
        && value
            .get("incomplete_details")
            .and_then(Value::as_object)
            .and_then(|details| details.get("reason"))
            .and_then(Value::as_str)
            == Some("max_output_tokens")
    {
        Some("length".to_string())
    } else {
        None
    };

    Ok(ModelTurnResponse {
        assistant: AssistantTurn {
            content,
            reasoning_text,
            reasoning_details,
            tool_calls: if tool_calls.is_empty() {
                None
            } else {
                Some(tool_calls)
            },
        },
        finish_reason,
        usage: parse_responses_usage(value.get("usage")),
    })
}

fn extract_reasoning_text(items: &[Value]) -> Option<String> {
    let mut parts = Vec::new();

    for item in items {
        if let Some(summary) = item.get("summary").and_then(Value::as_array) {
            for entry in summary {
                if let Some(text) = entry.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
        }

        if let Some(content) = item.get("content").and_then(Value::as_array) {
            for entry in content {
                if let Some(text) = entry.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

fn parse_chat_usage(value: Option<&Value>) -> Usage {
    Usage {
        prompt_tokens: value
            .and_then(|usage| usage.get("prompt_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        completion_tokens: value
            .and_then(|usage| usage.get("completion_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        total_tokens: value
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        reasoning_tokens: value
            .and_then(|usage| usage.get("completion_tokens_details"))
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
    }
}

fn parse_responses_usage(value: Option<&Value>) -> Usage {
    Usage {
        prompt_tokens: value
            .and_then(|usage| usage.get("input_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        completion_tokens: value
            .and_then(|usage| usage.get("output_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        total_tokens: value
            .and_then(|usage| usage.get("total_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        reasoning_tokens: value
            .and_then(|usage| usage.get("output_tokens_details"))
            .and_then(|details| details.get("reasoning_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
    }
}

#[cfg(test)]
impl ModelClient {
    pub fn new_for_test() -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "test_dummy_key".to_string(),
            model: "gpt-5.4".to_string(),
            backend: BackendKind::OpenAiResponses,
            reasoning_effort: Some(ReasoningEffort::Xhigh),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::ffi::OsString;

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    #[test]
    fn test_missing_api_key_error() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original = std::env::var("OPENAI_API_KEY").ok();
        unsafe {
            std::env::remove_var("OPENAI_API_KEY");
        }

        let result = ModelClient::from_env();
        assert!(result.is_err(), "Expected error when API key missing");
        let err_msg = result
            .err()
            .expect("Expected missing-key error")
            .to_string();
        assert!(
            err_msg.contains("OPENAI_API_KEY"),
            "Error should mention OPENAI_API_KEY, got: {}",
            err_msg
        );

        if let Some(key) = original {
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        } else {
            unsafe {
                std::env::remove_var("OPENAI_API_KEY");
            }
        }
    }

    #[test]
    fn explicit_deepseek_backend_defaults_to_deepseek_url_and_model() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_openai_key = std::env::var_os("OPENAI_API_KEY");
        let original_base_url = std::env::var_os("OPENAI_BASE_URL");
        let original_model = std::env::var_os("OPENAI_MODEL");

        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_openai_key");
            std::env::remove_var("OPENAI_BASE_URL");
            std::env::remove_var("OPENAI_MODEL");
        }

        let client = ModelClient::from_env_with_overrides(ClientOverrides {
            backend: Some(BackendKind::DeepSeekChat),
            ..ClientOverrides::default()
        })
        .unwrap();

        assert_eq!(client.base_url(), "https://api.deepseek.com");
        assert_eq!(client.backend(), BackendKind::DeepSeekChat);
        assert_eq!(client.model, "deepseek-v4-pro");
        assert_eq!(client.reasoning_effort(), None);

        restore_env("OPENAI_API_KEY", original_openai_key);
        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
    }

    #[test]
    fn detects_backend_from_url() {
        assert_eq!(
            detect_backend("https://api.openai.com/v1").unwrap(),
            BackendKind::OpenAiResponses
        );
        assert_eq!(
            detect_backend("https://api.fireworks.ai/inference/v1").unwrap(),
            BackendKind::FireworksChat
        );
        assert_eq!(
            detect_backend("https://api.deepseek.com").unwrap(),
            BackendKind::DeepSeekChat
        );
        assert!(detect_backend("https://example.com/v1").is_err());
    }

    #[test]
    fn deepseek_chat_request_enables_max_thinking_and_preserves_reasoning() {
        let request = deepseek_chat_request(
            "deepseek-v4-pro",
            &[Message::Assistant {
                content: Some("calling a tool".to_string()),
                reasoning_text: Some("need current context".to_string()),
                reasoning_details: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read".to_string(),
                        arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                    },
                }]),
            }],
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read a file".to_string(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"}
                        },
                        "required": ["path"]
                    }),
                },
            }],
        );

        assert_eq!(request["model"], "deepseek-v4-pro");
        assert_eq!(request["thinking"]["type"], "enabled");
        assert_eq!(request["reasoning_effort"], "max");
        assert!(request.get("temperature").is_none());
        assert_eq!(
            request["messages"][0]["reasoning_content"],
            "need current context"
        );
        assert_eq!(request["tools"][0]["type"], "function");
    }

    #[test]
    fn responses_input_items_expand_reasoning_and_tool_state() {
        let items = responses_input_items(&[
            Message::System {
                content: "system".to_string(),
            },
            Message::Assistant {
                content: Some("assistant text".to_string()),
                reasoning_text: Some("hidden".to_string()),
                reasoning_details: Some(json!([{
                    "type": "reasoning",
                    "id": "rs_1",
                    "summary": [{"type": "summary_text", "text": "keep this"}]
                }])),
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read".to_string(),
                        arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                    },
                }]),
            },
            Message::Tool {
                tool_call_id: "call_1".to_string(),
                content: "tool output".to_string(),
            },
        ]);

        assert_eq!(items.len(), 5);
        assert_eq!(items[0]["role"], "system");
        assert_eq!(items[1]["type"], "reasoning");
        assert_eq!(items[2]["type"], "function_call");
        assert_eq!(items[3]["role"], "assistant");
        assert_eq!(items[4]["type"], "function_call_output");
    }

    #[test]
    fn parses_deepseek_chat_output() {
        let parsed = parse_chat_completions_response(
            &json!({
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": "done",
                            "reasoning_content": "worked through it",
                            "tool_calls": null
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                    "completion_tokens_details": {
                        "reasoning_tokens": 9
                    }
                }
            }),
            "https://api.deepseek.com/chat/completions",
        )
        .unwrap();

        assert_eq!(parsed.assistant.content.as_deref(), Some("done"));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("worked through it")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        assert_eq!(parsed.usage.reasoning_tokens, Some(9));
    }

    #[test]
    fn parses_openai_responses_output() {
        let parsed = parse_openai_responses_response(
            &json!({
                "status": "completed",
                "output": [
                    {
                        "type": "reasoning",
                        "id": "rs_1",
                        "summary": [{"type": "summary_text", "text": "thought summary"}]
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_1",
                        "name": "read",
                        "arguments": "{\"path\":\"src/main.rs\"}"
                    },
                    {
                        "type": "message",
                        "content": [
                            {"type": "output_text", "text": "hello world"}
                        ]
                    }
                ],
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 20,
                    "total_tokens": 30,
                    "output_tokens_details": {
                        "reasoning_tokens": 7
                    }
                }
            }),
            "https://api.openai.com/v1/responses",
        )
        .unwrap();

        assert_eq!(parsed.assistant.content.as_deref(), Some("hello world"));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("thought summary")
        );
        assert_eq!(
            parsed
                .assistant
                .tool_calls
                .as_ref()
                .expect("tool calls should be parsed")
                .len(),
            1
        );
        assert_eq!(parsed.usage.reasoning_tokens, Some(7));
    }
}
