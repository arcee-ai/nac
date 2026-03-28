use anyhow::{anyhow, Result};
use reqwest::Client;
use std::time::Duration;
use tokio::time::sleep;

use crate::types::{ChatRequest, ChatResponse, Message, ToolDefinition};

pub struct OpenAiClient {
    client: Client,
    base_url: String,
    api_key: String,
    pub model: String,
}

impl OpenAiClient {
    pub fn from_env() -> Result<Self> {
        let api_key = std::env::var("OPENAI_API_KEY")
            .map_err(|_| anyhow!("OPENAI_API_KEY environment variable is not set"))?;
        let base_url = std::env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model = std::env::var("OPENAI_MODEL")
            .unwrap_or_else(|_| "gpt-5.4-2026-03-05".to_string());
        Ok(Self {
            client: Client::new(),
            base_url,
            api_key,
            model,
        })
    }

    pub async fn chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ChatResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = ChatRequest {
            model: self.model.clone(),
            messages,
            tools,
            temperature: 0.0,
        };

        let mut last_error = anyhow!("No attempts made");
        for attempt in 0..3 {
            if attempt > 0 {
                let delay_secs = 1u64 << (attempt - 1);
                sleep(Duration::from_secs(delay_secs)).await;
            }

            let response = self
                .client
                .post(&url)
                .header("Authorization", format!("Bearer {}", self.api_key))
                .header("Content-Type", "application/json")
                .json(&request)
                .send()
                .await
                .map_err(|e| anyhow!("HTTP request failed for {}: {}", url, e))?;

            let status = response.status();
            let body = response
                .text()
                .await
                .map_err(|e| anyhow!("Failed to read response body: {}", e))?;

            if status.is_success() {
                return serde_json::from_str::<ChatResponse>(&body)
                    .map_err(|e| anyhow!("Failed to parse response from {}: {}\nBody: {}", url, e, &body[..body.len().min(500)]));
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

    pub async fn summarize(&self, messages: Vec<Message>) -> Result<String> {
        let url = format!("{}/chat/completions", self.base_url);
        let mut all_messages = vec![Message::System {
            content: "Summarize the conversation so far in detail, preserving all technical context, file paths, decisions made, and current task state. Be thorough but concise.".to_string(),
        }];
        all_messages.extend(messages);

        let request = ChatRequest {
            model: self.model.clone(),
            messages: all_messages,
            tools: vec![],
            temperature: 0.0,
        };

        let response = self
            .client
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| anyhow!("HTTP request failed: {}", e))?;

        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(anyhow!("HTTP {} from summarize: {}", status.as_u16(), &body[..body.len().min(500)]));
        }

        let parsed: ChatResponse = serde_json::from_str(&body)
            .map_err(|e| anyhow!("Parse error in summarize: {}", e))?;
        let choice = parsed.choices.into_iter().next()
            .ok_or_else(|| anyhow!("No choices in summarize response"))?;
        let content = match choice.message {
            crate::types::ResponseMessage { content: Some(c), .. } => c,
            _ => return Err(anyhow!("Summarize returned no text content")),
        };
        Ok(content)
    }
}

#[cfg(test)]
impl OpenAiClient {
    pub fn new_for_test() -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "test_dummy_key".to_string(),
            model: "gpt-5.4-2026-03-05".to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn test_missing_api_key_error() {
        let _guard = ENV_LOCK.lock().unwrap();

        let original = std::env::var("OPENAI_API_KEY").ok();
        unsafe { std::env::remove_var("OPENAI_API_KEY"); }

        let result = OpenAiClient::from_env();
        assert!(result.is_err(), "Expected error when API key missing");
        let err_msg = result.err().expect("Expected missing-key error").to_string();
        assert!(
            err_msg.contains("OPENAI_API_KEY"),
            "Error should mention OPENAI_API_KEY, got: {}",
            err_msg
        );

        if let Some(key) = original {
            unsafe { std::env::set_var("OPENAI_API_KEY", key); }
        }
    }
}
