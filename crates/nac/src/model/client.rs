use super::*;

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
        let api_key = api_key_for_backend(backend, overrides.api_key_env.as_deref())?;
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

#[cfg(test)]
impl ModelClient {
    pub fn new_for_test() -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "test_dummy_key".to_string(),
            model: "gpt-5.5".to_string(),
            backend: BackendKind::OpenAiResponses,
            reasoning_effort: Some(ReasoningEffort::Xhigh),
        }
    }
}
