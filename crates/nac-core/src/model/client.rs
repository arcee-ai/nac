use super::*;
use anyhow::Context;

fn truncate_utf8(value: &str, max_bytes: usize) -> &str {
    let mut end = value.len().min(max_bytes);
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ArceeCredentialSource {
    StoredLogin,
    ApiKey,
}

fn is_sensitive_arcee_header(name: &str) -> bool {
    ["host", "authorization", "proxy-authorization"]
        .iter()
        .any(|sensitive| name.eq_ignore_ascii_case(sensitive))
}

fn validate_extra_headers(
    extra_headers: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    for (name, value) in extra_headers {
        reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|error| {
            model_configuration_error(format!(
                "invalid model configuration: extra_headers name '{name}' is invalid: {error}"
            ))
        })?;
        reqwest::header::HeaderValue::from_str(value).map_err(|error| {
            model_configuration_error(format!(
                "invalid model configuration: extra_headers value for '{name}' is invalid: {error}"
            ))
        })?;
    }
    Ok(())
}

fn validate_arcee_extra_headers(
    extra_headers: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    if let Some(name) = extra_headers
        .keys()
        .find(|name| is_sensitive_arcee_header(name))
    {
        return Err(model_configuration_error(format!(
            "invalid model configuration: extra_headers cannot override sensitive header '{}' for an Arcee backend",
            name
        )));
    }
    Ok(())
}

fn resolve_arcee_auth_credentials(
    explicit_base_url: Option<&str>,
) -> Result<(String, String, ArceeCredentialSource)> {
    match explicit_base_url {
        None => {
            let record = arcee::read_stored_auth().map_err(classify_stored_arcee_auth_error)?;
            Ok((
                record.base_url,
                record.api_key,
                ArceeCredentialSource::StoredLogin,
            ))
        }
        Some(base_url) => {
            let requested_url = arcee::validate_approved_base_url(base_url)
                .map_err(classify_model_configuration_error)?;
            let record = arcee::read_stored_auth().map_err(classify_stored_arcee_auth_error)?;
            let stored_url = arcee::validate_stored_base_url(&record.base_url)
                .map_err(classify_model_configuration_error)?;
            if requested_url.origin() != stored_url.origin() {
                return Err(model_configuration_error(format!(
                    "Arcee endpoint origin '{}' does not match the stored credential origin '{}'; log in for the selected origin or select 'arcee-api' with separate API-key credentials",
                    requested_url.origin().ascii_serialization(),
                    stored_url.origin().ascii_serialization()
                )));
            }
            Ok((
                base_url.to_string(),
                record.api_key,
                ArceeCredentialSource::StoredLogin,
            ))
        }
    }
}

fn resolve_arcee_api_credentials(
    base_url: &str,
    api_key_env: Option<&str>,
) -> Result<(String, String, ArceeCredentialSource)> {
    arcee::validate_approved_base_url(base_url).map_err(classify_model_configuration_error)?;
    let api_key = api_key_for_backend(BackendKind::ArceeApi, api_key_env)?;
    Ok((base_url.to_string(), api_key, ArceeCredentialSource::ApiKey))
}

/// Validates the effective model configuration without issuing a model request.
pub fn validate_model_configuration(
    backend: BackendKind,
    base_url: Option<&str>,
    reasoning_effort: Option<ReasoningEffort>,
    api_key_env: Option<&str>,
    extra_headers: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    validate_extra_headers(extra_headers)?;
    validate_backend_reasoning_effort(backend, reasoning_effort)?;
    validate_backend_api_key_env(backend, base_url, api_key_env)?;
    match backend {
        BackendKind::ArceeAuth => {
            resolve_arcee_auth_credentials(base_url)?;
            validate_arcee_extra_headers(extra_headers)?;
        }
        BackendKind::ArceeApi => {
            let base_url = base_url.ok_or_else(|| {
                model_configuration_error(
                    "invalid model configuration: backend 'arcee-api' requires base_url",
                )
            })?;
            resolve_arcee_api_credentials(base_url, api_key_env)?;
            validate_arcee_extra_headers(extra_headers)?;
        }
        BackendKind::ChatGptCodexResponses => {
            let base_url = base_url.ok_or_else(|| {
                model_configuration_error(
                    "invalid model configuration: backend 'chatgpt-codex-responses' requires base_url",
                )
            })?;
            chatgpt_codex::validate_base_url(base_url)
                .map_err(classify_model_configuration_error)?;
            chatgpt_codex::preflight_stored_auth().map_err(classify_stored_codex_auth_error)?;
        }
        BackendKind::DeepSeekChat
        | BackendKind::FireworksChat
        | BackendKind::TogetherChat
        | BackendKind::OpenAiResponses
        | BackendKind::AnthropicMessages => {
            api_key_for_backend(backend, api_key_env)?;
        }
    }
    Ok(())
}

fn http_client_for_backend(backend: BackendKind) -> Result<Client> {
    match backend {
        BackendKind::ArceeAuth | BackendKind::ArceeApi => arcee::no_redirect_client(),
        BackendKind::ChatGptCodexResponses => chatgpt_codex::no_redirect_client(),
        _ => Ok(Client::new()),
    }
}

#[derive(Debug, Clone)]
pub struct ModelClient {
    client: Client,
    base_url: String,
    api_key: String,
    pub model: String,
    backend: BackendKind,
    reasoning_effort: Option<ReasoningEffort>,
    api_key_env: Option<String>,
    extra_headers: std::collections::BTreeMap<String, String>,
    arcee_credential_source: Option<ArceeCredentialSource>,
    /// Anthropic prompt-cache TTL. `None` = default 5-minute TTL (workers);
    /// `Some("1h")` = 1-hour TTL with beta header (orchestrator).
    cache_ttl: Option<&'static str>,
}

impl ModelClient {
    pub fn from_effective_settings(settings: EffectiveModelSettings) -> Result<Self> {
        validate_extra_headers(&settings.extra_headers)?;
        let backend = settings.backend;
        let (api_key, arcee_credential_source) = match backend {
            BackendKind::ArceeAuth => {
                validate_backend_api_key_env(
                    backend,
                    Some(&settings.base_url),
                    settings.api_key_env.as_deref(),
                )?;
                let (_, api_key, source) =
                    resolve_arcee_auth_credentials(Some(&settings.base_url))?;
                validate_arcee_extra_headers(&settings.extra_headers)?;
                (api_key, Some(source))
            }
            BackendKind::ArceeApi => {
                let (_, api_key, source) = resolve_arcee_api_credentials(
                    &settings.base_url,
                    settings.api_key_env.as_deref(),
                )?;
                validate_arcee_extra_headers(&settings.extra_headers)?;
                (api_key, Some(source))
            }
            BackendKind::ChatGptCodexResponses => {
                validate_backend_api_key_env(
                    backend,
                    Some(&settings.base_url),
                    settings.api_key_env.as_deref(),
                )?;
                chatgpt_codex::validate_base_url(&settings.base_url)
                    .map_err(classify_model_configuration_error)?;
                chatgpt_codex::preflight_stored_auth().map_err(classify_stored_codex_auth_error)?;
                (String::new(), None)
            }
            _ => {
                validate_backend_api_key_env(
                    backend,
                    Some(&settings.base_url),
                    settings.api_key_env.as_deref(),
                )?;
                (
                    api_key_for_backend(backend, settings.api_key_env.as_deref())?,
                    None,
                )
            }
        };
        let client = http_client_for_backend(backend)?;

        Ok(Self {
            client,
            base_url: settings.base_url,
            api_key,
            model: settings.model,
            backend,
            reasoning_effort: settings.reasoning_effort,
            api_key_env: settings.api_key_env,
            extra_headers: settings.extra_headers,
            arcee_credential_source,
            cache_ttl: None,
        })
    }

    /// Set the Anthropic prompt-cache TTL. `Some("1h")` enables 1-hour cache
    /// TTL (requires beta header); `None` uses the default 5-minute TTL.
    pub fn with_cache_ttl(mut self, ttl: Option<&'static str>) -> Self {
        self.cache_ttl = ttl;
        self
    }

    pub async fn send_turn(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        match self.backend {
            BackendKind::DeepSeekChat => self.send_deepseek_chat(messages, tools).await,
            BackendKind::FireworksChat => self.send_fireworks_chat(messages, tools).await,
            BackendKind::TogetherChat => self.send_together_chat(messages, tools).await,
            BackendKind::ArceeAuth | BackendKind::ArceeApi => {
                self.send_arcee_chat(messages, tools).await
            }
            BackendKind::OpenAiResponses => self.send_openai_responses(messages, tools).await,
            BackendKind::AnthropicMessages => self.send_anthropic_messages(messages, tools).await,
            BackendKind::ChatGptCodexResponses => {
                chatgpt_codex::send_responses(
                    &self.client,
                    &self.base_url,
                    &self.model,
                    self.reasoning_effort,
                    messages,
                    tools,
                )
                .await
            }
        }
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

    pub fn api_key_env(&self) -> Option<&str> {
        self.api_key_env.as_deref()
    }

    pub fn extra_headers(&self) -> &std::collections::BTreeMap<String, String> {
        &self.extra_headers
    }

    async fn send_fireworks_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = fireworks_chat_request(&self.model, self.reasoning_effort, &messages, &tools);

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_chat_completions_response(&value, &url)
    }

    async fn send_together_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = together_chat_request(&self.model, self.reasoning_effort, &messages, &tools);

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_together_chat_response(&value, &url)
    }

    async fn send_arcee_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = arcee::chat_completions_url(&self.base_url)
            .map_err(classify_model_configuration_error)?;
        let mut request = json!({
            "model": self.model,
            "messages": messages
                .iter()
                .map(fireworks_message_to_value)
                .collect::<Vec<_>>(),
            "temperature": 0.0,
        });

        if !tools.is_empty() {
            request["tools"] =
                serde_json::to_value(&tools).unwrap_or_else(|_| Value::Array(Vec::new()));
        }

        let value = self
            .post_arcee_json_with_retry(url.as_str(), &request)
            .await?;
        parse_chat_completions_response(&value, url.as_str())
    }

    async fn send_deepseek_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = deepseek_chat_request(&self.model, self.reasoning_effort, &messages, &tools);

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_chat_completions_response(&value, &url)
    }

    async fn send_openai_responses(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/responses", self.base_url);
        let request =
            openai_responses_request(&self.model, self.reasoning_effort, &messages, &tools);

        let value = self.post_json_with_retry(&url, &request).await?;
        parse_openai_responses_response(&value, &url)
    }

    async fn send_anthropic_messages(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let request = anthropic_messages_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            self.cache_ttl,
        )?;

        let value = self.post_anthropic_json_with_retry(&url, &request).await?;
        parse_anthropic_messages_response(&value, &url)
    }

    async fn post_json_with_retry(&self, url: &str, body: &Value) -> Result<Value> {
        let api_key = self.api_key.as_str();
        self.post_json_with_retry_headers(url, body, |request| {
            request.header("Authorization", format!("Bearer {}", api_key))
        })
        .await
    }

    async fn post_arcee_json_with_retry(&self, url: &str, body: &Value) -> Result<Value> {
        debug_assert!(self.arcee_credential_source.is_some());
        validate_arcee_extra_headers(&self.extra_headers)?;
        let api_key = self.api_key.as_str();
        self.post_json_with_retry_headers(url, body, |request| {
            request
                .header("Authorization", format!("Bearer {}", api_key))
                .header("X-Arcee-Client", "nac-cli")
        })
        .await
    }

    async fn post_anthropic_json_with_retry(&self, url: &str, body: &Value) -> Result<Value> {
        let api_key = self.api_key.as_str();
        let cache_ttl = self.cache_ttl;
        self.post_json_with_retry_headers(url, body, |request| {
            let mut request = request
                .header("x-api-key", api_key)
                .header("anthropic-version", ANTHROPIC_VERSION);
            if cache_ttl == Some("1h") {
                request = request.header("anthropic-beta", "extended-cache-ttl-2025-04-11");
            }
            request
        })
        .await
    }

    async fn post_json_with_retry_headers<F>(
        &self,
        url: &str,
        body: &Value,
        apply_headers: F,
    ) -> Result<Value>
    where
        F: Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder + Copy,
    {
        let mut last_error = anyhow!("No attempts made");

        for attempt in 0..3 {
            if attempt > 0 {
                let delay_secs = 1u64 << (attempt - 1);
                sleep(Duration::from_secs(delay_secs)).await;
            }

            let mut request = self.client.post(url);
            if !self.extra_headers_override_content_type() {
                request = request.header("Content-Type", "application/json");
            }
            let response = self
                .apply_extra_headers(apply_headers(request))?
                .json(body)
                .send()
                .await
                .map_err(|e| anyhow!("HTTP request failed for {}: {}", url, e))?;

            let status = response.status();
            let redirect_location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let body = response
                .text()
                .await
                .map_err(|e| anyhow!("Failed to read response body: {}", e))?;

            if status.is_redirection() && self.backend.is_arcee() {
                let location = redirect_location
                    .as_deref()
                    .map(|value| format!(" Location: {}.", truncate_utf8(value, 500)))
                    .unwrap_or_default();
                return Err(anyhow!(
                    "Arcee request received HTTP {} redirect from {}; automatic redirects are disabled and the request was not replayed.{} Body: {}",
                    status.as_u16(),
                    url,
                    location,
                    truncate_utf8(&body, 500)
                ));
            }

            if status.is_success() {
                return serde_json::from_str::<Value>(&body).map_err(|e| {
                    anyhow!(
                        "Failed to parse response from {}: {}\nBody: {}",
                        url,
                        e,
                        truncate_utf8(&body, 500)
                    )
                });
            }

            if status.as_u16() == 429 || status.is_server_error() {
                last_error = anyhow!(
                    "HTTP {} from {}: {}",
                    status.as_u16(),
                    url,
                    truncate_utf8(&body, 500)
                );
                continue;
            }

            return Err(anyhow!(
                "HTTP {} from {}: {}",
                status.as_u16(),
                url,
                truncate_utf8(&body, 500)
            ));
        }

        Err(last_error)
    }

    fn extra_headers_override_content_type(&self) -> bool {
        self.extra_headers
            .keys()
            .any(|name| name.eq_ignore_ascii_case("content-type"))
    }

    fn apply_extra_headers(
        &self,
        mut request: reqwest::RequestBuilder,
    ) -> Result<reqwest::RequestBuilder> {
        for (name, value) in &self.extra_headers {
            let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .with_context(|| format!("invalid model extra_headers name '{name}'"))?;
            let header_value = reqwest::header::HeaderValue::from_str(value)
                .with_context(|| format!("invalid model extra_headers value for '{name}'"))?;
            request = request.header(header_name, header_value);
        }
        Ok(request)
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
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::new(),
            arcee_credential_source: None,
            cache_ttl: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::test_http::{ScriptedResponse, ScriptedServer};
    use super::*;
    use crate::types::FunctionDef;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    #[tokio::test]
    async fn arcee_inference_sends_expected_contract_and_parses_chat_response() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "choices": [{
                    "message": {
                        "content": "Hello from Arcee",
                        "reasoning_content": "brief reasoning"
                    },
                    "finish_reason": "stop"
                }],
                "usage": {
                    "prompt_tokens": 11,
                    "completion_tokens": 7,
                    "total_tokens": 18,
                    "prompt_tokens_details": {"cached_tokens": 3}
                }
            })
            .to_string(),
        )]);
        let client = ModelClient {
            client: arcee::no_redirect_client().unwrap(),
            base_url: format!("{}/tenant/base", server.base_url),
            api_key: "stored-login-credential".to_string(),
            model: "arcee-test-model".to_string(),
            backend: BackendKind::ArceeAuth,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::from([(
                "X-Arcee-Tenant".to_string(),
                "tenant-test".to_string(),
            )]),
            arcee_credential_source: Some(ArceeCredentialSource::StoredLogin),
            cache_ttl: None,
        };
        let messages = vec![
            Message::System {
                content: "Follow instructions".to_string(),
            },
            Message::User {
                content: "Say hello".to_string(),
            },
        ];
        let tools = vec![ToolDefinition {
            def_type: "function".to_string(),
            function: FunctionDef {
                name: "lookup".to_string(),
                description: "Look up a value".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {"key": {"type": "string"}},
                    "required": ["key"]
                }),
            },
        }];

        let response = client
            .send_turn(messages, tools.clone())
            .await
            .expect("valid Arcee chat response should parse");
        let requests = server.finish();

        assert_eq!(
            response.assistant.content.as_deref(),
            Some("Hello from Arcee")
        );
        assert_eq!(
            response.assistant.reasoning_text.as_deref(),
            Some("brief reasoning")
        );
        assert_eq!(response.finish_reason.as_deref(), Some("stop"));
        let usage = response.usage.expect("usage should parse");
        assert_eq!(usage.input_tokens, 8);
        assert_eq!(usage.cache_read_tokens, 3);
        assert_eq!(usage.output_tokens, 7);
        assert_eq!(usage.orchestrator_context_tokens, 18);

        assert_eq!(requests.len(), 1);
        let request = &requests[0];
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/tenant/base/v1/chat/completions");
        assert_eq!(
            request.headers.get("authorization").map(String::as_str),
            Some("Bearer stored-login-credential")
        );
        assert_eq!(
            request.headers.get("x-arcee-client").map(String::as_str),
            Some("nac-cli")
        );
        assert_eq!(
            request.headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            request.headers.get("x-arcee-tenant").map(String::as_str),
            Some("tenant-test")
        );
        let body: Value = serde_json::from_slice(&request.body).expect("request JSON");
        assert_eq!(body["model"], "arcee-test-model");
        assert_eq!(body["temperature"], 0.0);
        assert_eq!(
            body["messages"],
            json!([
                {"role": "system", "content": "Follow instructions"},
                {"role": "user", "content": "Say hello"}
            ])
        );
        assert_eq!(
            body["tools"],
            serde_json::to_value(&tools).expect("tool definitions serialize")
        );
    }

    #[tokio::test]
    async fn custom_arcee_routes_are_exact_on_wire() {
        let cases = [
            ("/api", "/api/v1/chat/completions"),
            ("/custom/prefix", "/custom/prefix/v1/chat/completions"),
            ("/custom/prefix/v1", "/custom/prefix/v1/chat/completions"),
            (
                "/custom/prefix/v1/chat/completions/",
                "/custom/prefix/v1/chat/completions",
            ),
        ];

        for (configured_path, expected_path) in cases {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(
                "200 OK",
                json!({
                    "choices": [{
                        "message": {"content": "ok"},
                        "finish_reason": "stop"
                    }]
                })
                .to_string(),
            )]);
            let client = ModelClient {
                client: arcee::no_redirect_client().unwrap(),
                base_url: format!("{}{configured_path}", server.base_url),
                api_key: "custom-endpoint-key".to_string(),
                model: "arcee-test-model".to_string(),
                backend: BackendKind::ArceeApi,
                reasoning_effort: None,
                api_key_env: None,
                extra_headers: std::collections::BTreeMap::new(),
                arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
                cache_ttl: None,
            };

            client
                .send_arcee_chat(Vec::new(), Vec::new())
                .await
                .unwrap_or_else(|error| panic!("{configured_path}: {error:#}"));
            let requests = server.finish();

            assert_eq!(requests.len(), 1, "{configured_path}");
            assert_eq!(requests[0].method, "POST", "{configured_path}");
            assert_eq!(requests[0].path, expected_path, "{configured_path}");
        }
    }

    #[tokio::test]
    async fn arcee_cross_origin_redirects_do_not_replay_prompt_credentials_or_headers() {
        for status in ["307 Temporary Redirect", "308 Permanent Redirect"] {
            let destination =
                TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect destination");
            destination
                .set_nonblocking(true)
                .expect("make redirect destination nonblocking");
            let destination_url = format!(
                "http://{}/stolen-inference",
                destination.local_addr().unwrap()
            );
            let source = ScriptedServer::start(vec![ScriptedResponse::redirect(
                status,
                destination_url,
                format!("{}not-in-error", "x".repeat(500)),
            )]);
            let client = ModelClient {
                client: arcee::no_redirect_client().unwrap(),
                base_url: source.base_url.clone(),
                api_key: "sensitive-arcee-credential".to_string(),
                model: "arcee-test-model".to_string(),
                backend: BackendKind::ArceeAuth,
                reasoning_effort: None,
                api_key_env: None,
                extra_headers: std::collections::BTreeMap::from([(
                    "X-Arcee-Tenant".to_string(),
                    "sensitive-tenant-header".to_string(),
                )]),
                arcee_credential_source: Some(ArceeCredentialSource::StoredLogin),
                cache_ttl: None,
            };

            let error = client
                .send_arcee_chat(
                    vec![Message::User {
                        content: "sensitive prompt".to_string(),
                    }],
                    Vec::new(),
                )
                .await
                .expect_err("Arcee inference redirects must not be followed")
                .to_string();
            let requests = source.finish();

            assert!(error.contains("redirect"), "unexpected error: {error}");
            assert!(
                error.contains("automatic redirects are disabled"),
                "unexpected error: {error}"
            );
            assert!(
                !error.contains("not-in-error"),
                "error body was not bounded"
            );
            assert_eq!(requests.len(), 1);
            assert_eq!(
                requests[0].headers.get("authorization").map(String::as_str),
                Some("Bearer sensitive-arcee-credential")
            );
            assert_eq!(
                requests[0]
                    .headers
                    .get("x-arcee-tenant")
                    .map(String::as_str),
                Some("sensitive-tenant-header")
            );
            assert!(
                String::from_utf8_lossy(&requests[0].body).contains("sensitive prompt"),
                "source did not receive the prompt"
            );
            let accept_error = destination
                .accept()
                .expect_err("cross-origin redirect destination must receive no request");
            assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
        }
    }

    #[tokio::test]
    async fn non_arcee_http_clients_preserve_default_redirect_behavior() {
        let server = ScriptedServer::start_same_origin_redirect(
            "307 Temporary Redirect",
            "/redirected-non-arcee",
            "follow this redirect",
        );
        let client = http_client_for_backend(BackendKind::OpenAiResponses).unwrap();

        let _ = client
            .post(format!("{}/initial", server.base_url))
            .body("non-Arcee request body")
            .send()
            .await;
        let requests = server.finish();

        assert_eq!(requests.len(), 2, "non-Arcee redirect behavior changed");
        assert_eq!(requests[0].path, "/initial");
        assert_eq!(requests[1].path, "/redirected-non-arcee");
        assert_eq!(requests[1].body, b"non-Arcee request body");
    }

    #[test]
    fn stored_arcee_header_policy_is_case_insensitive_and_allows_benign_headers() {
        for name in [
            "Host",
            "HOST",
            "hOsT",
            "Authorization",
            "pRoXy-AuThOrIzAtIoN",
        ] {
            let headers =
                std::collections::BTreeMap::from([(name.to_string(), "hostile-value".to_string())]);
            let error = validate_arcee_extra_headers(&headers)
                .expect_err("authority and credential headers must be rejected");
            assert!(
                error.to_string().contains(name),
                "unexpected error: {error:#}"
            );
        }

        let benign = std::collections::BTreeMap::from([
            (
                "Content-Type".to_string(),
                "application/custom+json".to_string(),
            ),
            ("X-Arcee-Tenant".to_string(), "tenant-test".to_string()),
        ]);
        validate_arcee_extra_headers(&benign)
            .expect("benign stored-credential headers should remain supported");
    }

    #[tokio::test]
    async fn stored_arcee_host_override_is_rejected_before_connecting() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind hostile endpoint");
        listener
            .set_nonblocking(true)
            .expect("make hostile endpoint nonblocking");
        let address = listener.local_addr().expect("hostile endpoint address");
        let client = ModelClient {
            client: Client::builder()
                .timeout(Duration::from_millis(250))
                .build()
                .expect("build bounded test client"),
            base_url: format!("http://{address}"),
            api_key: "stored-login-secret-must-not-leak".to_string(),
            model: "test-model".to_string(),
            backend: BackendKind::ArceeAuth,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::from([(
                "hOsT".to_string(),
                format!("{address}"),
            )]),
            arcee_credential_source: Some(ArceeCredentialSource::StoredLogin),
            cache_ttl: None,
        };

        let error = client
            .send_arcee_chat(Vec::new(), Vec::new())
            .await
            .expect_err("Host override must fail before the HTTP client runs");

        assert!(
            error.to_string().contains("hOsT"),
            "unexpected error: {error:#}"
        );
        let accept_error = listener
            .accept()
            .expect_err("hostile endpoint must receive no connection");
        assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
    }

    #[test]
    fn truncate_utf8_backs_up_to_character_boundary() {
        assert_eq!(truncate_utf8("é", 0), "");
        assert_eq!(truncate_utf8("é", 1), "");
        assert_eq!(truncate_utf8("é", 2), "é");

        let body = format!("{}é", "a".repeat(499));
        assert_eq!(truncate_utf8(&body, 500), "a".repeat(499));
    }

    #[test]
    fn truncate_utf8_preserves_exact_boundary_and_short_values() {
        let exact = format!("{}é", "a".repeat(498));
        assert_eq!(exact.len(), 500);
        assert_eq!(truncate_utf8(&exact, 500), exact);
        assert_eq!(truncate_utf8("short", 500), "short");
    }

    #[tokio::test]
    async fn arcee_multibyte_error_body_does_not_panic() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind mock server");
        let address = listener.local_addr().expect("mock server address");
        let response_body = format!("{}é", "a".repeat(499));
        let expected_prefix = "a".repeat(499);
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("set request timeout");
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).expect("read request");
            let response = format!(
                "HTTP/1.1 400 Bad Request\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
        });

        let client = ModelClient {
            client: arcee::no_redirect_client().unwrap(),
            base_url: format!("http://{address}"),
            api_key: "rcai-test".to_string(),
            model: "test-model".to_string(),
            backend: BackendKind::ArceeApi,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::new(),
            arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
            cache_ttl: None,
        };

        let error = client
            .send_arcee_chat(Vec::new(), Vec::new())
            .await
            .expect_err("HTTP 400 should return an error")
            .to_string();
        server.join().expect("mock server thread");

        assert!(error.contains("HTTP 400"), "unexpected error: {error}");
        assert!(
            error.contains(&expected_prefix),
            "unexpected error: {error}"
        );
        assert!(
            !error.contains('é'),
            "body should be capped safely: {error}"
        );
    }
}
