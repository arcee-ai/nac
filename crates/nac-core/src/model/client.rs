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

/// A terminal HTTP outcome from a model request, carrying the status code so
/// callers (e.g. the arcee-auth 401 refresh fallback) can branch on it.
struct ModelHttpError {
    status: Option<u16>,
    message: String,
}

fn is_sensitive_model_header(name: &str) -> bool {
    ["host", "authorization", "proxy-authorization", "x-api-key"]
        .iter()
        .any(|sensitive| name.eq_ignore_ascii_case(sensitive))
}

fn validate_extra_headers(
    extra_headers: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    for (name, value) in extra_headers {
        if is_sensitive_model_header(name) {
            return Err(model_configuration_error(format!(
                "invalid model configuration: extra_headers cannot set authority or credential-sensitive header '{name}'; credentials are selected by the configured backend"
            )));
        }
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

fn resolve_arcee_auth_base_url(explicit_base_url: Option<&str>) -> Result<String> {
    match explicit_base_url {
        None => {
            let record = arcee::read_stored_auth().map_err(classify_stored_arcee_auth_error)?;
            Ok(record.base_url)
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
            Ok(base_url.to_string())
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
    model: &str,
    base_url: Option<&str>,
    reasoning_effort: Option<ReasoningEffort>,
    api_key_env: Option<&str>,
    extra_headers: &std::collections::BTreeMap<String, String>,
) -> Result<()> {
    validate_extra_headers(extra_headers)?;
    validate_model_reasoning_effort(backend, model, reasoning_effort)?;
    validate_backend_api_key_env(backend, base_url, api_key_env)?;
    match backend {
        BackendKind::ArceeAuth => {
            resolve_arcee_auth_base_url(base_url)?;
        }
        BackendKind::ArceeApi => {
            let base_url = base_url.ok_or_else(|| {
                model_configuration_error(
                    "invalid model configuration: backend 'arcee-api' requires base_url",
                )
            })?;
            resolve_arcee_api_credentials(base_url, api_key_env)?;
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

pub(super) fn no_redirect_model_client() -> Result<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("failed to build no-redirect model HTTP client")
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
    /// Catalog metadata resolved with the effective settings; drives
    /// per-response cost (S3), effort wire translation (S4) and, in S6,
    /// dispatch.
    resolved_model: ModelMetadata,
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
                resolve_arcee_auth_base_url(Some(&settings.base_url))?;
                (String::new(), Some(ArceeCredentialSource::StoredLogin))
            }
            BackendKind::ArceeApi => {
                let (_, api_key, source) = resolve_arcee_api_credentials(
                    &settings.base_url,
                    settings.api_key_env.as_deref(),
                )?;
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
        let client = no_redirect_model_client()?;

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
            resolved_model: settings.resolved,
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
                let response = chatgpt_codex::send_responses(
                    &self.client,
                    &self.base_url,
                    &self.model,
                    self.reasoning_effort,
                    messages,
                    tools,
                    &self.resolved_model.thinking_level_map,
                )
                .await?;
                Ok(self.with_usage_cost(response))
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

    /// Attach per-response cost computed from the resolved catalog metadata
    /// (S3). Anthropic 1-hour-TTL cache writes (orchestrator clients) bill at
    /// the metadata's 1h rate — 2x input when the catalog has no explicit
    /// value; everything else bills at the standard rates. Unknown pricing
    /// (all-zero rates) yields zero cost, never an error.
    fn with_usage_cost(&self, mut response: ModelTurnResponse) -> ModelTurnResponse {
        if let Some(usage) = response.usage.as_mut() {
            let cache_write_1h_rate = (self.cache_ttl == Some("1h")
                && self.resolved_model.api == catalog::ApiKind::AnthropicMessages)
            .then(|| self.resolved_model.cache_write_1h_rate());
            usage.cost = calculate_cost(&self.resolved_model.cost, cache_write_1h_rate, usage);
        }
        response
    }

    async fn send_fireworks_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = fireworks_chat_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
        );

        let value = self.post_json_with_retry(&url, &request).await?;
        Ok(self.with_usage_cost(parse_chat_completions_response(&value, &url)?))
    }

    async fn send_together_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = together_chat_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
        );

        let value = self.post_json_with_retry(&url, &request).await?;
        Ok(self.with_usage_cost(parse_together_chat_response(&value, &url)?))
    }

    fn arcee_chat_request(&self, messages: &[Message], tools: &[ToolDefinition]) -> Value {
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
                serde_json::to_value(tools).unwrap_or_else(|_| Value::Array(Vec::new()));
        }
        request
    }

    async fn send_arcee_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = arcee::chat_completions_url(&self.base_url)
            .map_err(classify_model_configuration_error)?;
        let request = self.arcee_chat_request(&messages, &tools);

        let value = match self.backend {
            BackendKind::ArceeAuth => {
                self.post_arcee_auth_with_refresh(url.as_str(), &request)
                    .await?
            }
            _ => self.post_json_with_retry(url.as_str(), &request).await?,
        };
        Ok(self.with_usage_cost(parse_chat_completions_response(&value, url.as_str())?))
    }

    async fn send_deepseek_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/chat/completions", self.base_url);
        let request = deepseek_chat_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
        );

        let value = self.post_json_with_retry(&url, &request).await?;
        Ok(self.with_usage_cost(parse_chat_completions_response(&value, &url)?))
    }

    async fn send_openai_responses(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/responses", self.base_url);
        let request = openai_responses_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
        );

        let value = self.post_json_with_retry(&url, &request).await?;
        Ok(self.with_usage_cost(parse_openai_responses_response(&value, &url)?))
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
            &self.resolved_model.thinking_level_map,
        )?;

        let value = self.post_anthropic_json_with_retry(&url, &request).await?;
        Ok(self.with_usage_cost(parse_anthropic_messages_response(&value, &url)?))
    }

    async fn post_json_with_retry(&self, url: &str, body: &Value) -> Result<Value> {
        let api_key = self.api_key.as_str();
        self.post_json_with_retry_headers(url, body, |request| {
            request.header("Authorization", format!("Bearer {}", api_key))
        })
        .await
    }

    /// Sends an `arcee-auth` inference request using a device-flow access token,
    /// refreshing proactively before the request and once more on a 401 fallback.
    async fn post_arcee_auth_with_refresh(&self, url: &str, body: &Value) -> Result<Value> {
        debug_assert!(matches!(
            self.arcee_credential_source,
            Some(ArceeCredentialSource::StoredLogin)
        ));
        let token = arcee::fresh_access_token(&self.client, &self.base_url).await?;
        match self.try_post_arcee_auth(url, body, &token).await {
            Ok(value) => Ok(value),
            Err(error) if error.status == Some(401) => {
                let refreshed =
                    arcee::force_refresh_access_token(&self.client, &self.base_url, &token).await?;
                self.try_post_arcee_auth(url, body, &refreshed)
                    .await
                    .map_err(|error| anyhow!(error.message))
            }
            Err(error) => Err(anyhow!(error.message)),
        }
    }

    async fn try_post_arcee_auth(
        &self,
        url: &str,
        body: &Value,
        token: &str,
    ) -> std::result::Result<Value, ModelHttpError> {
        self.try_post_json_with_retry_headers(url, body, |request| {
            request.header("Authorization", format!("Bearer {token}"))
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
        self.try_post_json_with_retry_headers(url, body, apply_headers)
            .await
            .map_err(|error| anyhow!(error.message))
    }

    async fn try_post_json_with_retry_headers<F>(
        &self,
        url: &str,
        body: &Value,
        apply_headers: F,
    ) -> std::result::Result<Value, ModelHttpError>
    where
        F: Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder + Copy,
    {
        let mut last_error = ModelHttpError {
            status: None,
            message: "No attempts made".to_string(),
        };

        for attempt in 0..10 {
            let mut request = self.client.post(url);
            if !self.extra_headers_override_content_type() {
                request = request.header("Content-Type", "application/json");
            }
            let response = match self
                .apply_extra_headers(apply_headers(request))
                .map_err(|error| ModelHttpError {
                    status: None,
                    message: error.to_string(),
                })?
                .json(body)
                .send()
                .await
            {
                Ok(resp) => resp,
                Err(e) => {
                    last_error = ModelHttpError {
                        status: None,
                        message: format!("HTTP request failed for {}: {}", url, e),
                    };
                    if attempt < 9 {
                        sleep(super::backoff_duration(attempt)).await;
                    }
                    continue;
                }
            };

            let status = response.status();
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok());
            let redirect_location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let body = response.text().await.map_err(|e| ModelHttpError {
                status: Some(status.as_u16()),
                message: format!("Failed to read response body: {}", e),
            })?;

            if status.is_redirection() {
                let location = redirect_location
                    .as_deref()
                    .map(|value| format!(" Location: {}.", truncate_utf8(value, 500)))
                    .unwrap_or_default();
                return Err(ModelHttpError {
                    status: Some(status.as_u16()),
                    message: format!(
                        "Model request for backend '{}' received HTTP {} redirect from {}; automatic redirects are disabled and the request was not replayed.{} Body: {}",
                        self.backend,
                        status.as_u16(),
                        url,
                        location,
                        truncate_utf8(&body, 500)
                    ),
                });
            }

            if status.is_success() {
                return serde_json::from_str::<Value>(&body).map_err(|e| ModelHttpError {
                    status: Some(status.as_u16()),
                    message: format!(
                        "Failed to parse response from {}: {}\nBody: {}",
                        url,
                        e,
                        truncate_utf8(&body, 500)
                    ),
                });
            }

            let error = ModelHttpError {
                status: Some(status.as_u16()),
                message: format!(
                    "HTTP {} from {}: {}",
                    status.as_u16(),
                    url,
                    truncate_utf8(&body, 500)
                ),
            };

            if status.as_u16() == 429 || status.is_server_error() {
                last_error = error;
                if attempt < 9 {
                    let delay = if status.as_u16() == 429 {
                        retry_after
                            .map(Duration::from_secs)
                            .unwrap_or_else(|| super::backoff_duration(attempt))
                    } else {
                        super::backoff_duration(attempt)
                    };
                    sleep(delay).await;
                }
                continue;
            }

            return Err(error);
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
        validate_extra_headers(&self.extra_headers)?;
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
    pub(crate) fn new_for_test_server(base_url: String) -> Self {
        let mut client = Self::new_for_test();
        client.base_url = base_url;
        client.reasoning_effort = None;
        client
    }

    pub fn new_for_test() -> Self {
        Self {
            client: no_redirect_model_client().expect("build no-redirect test model client"),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "test_dummy_key".to_string(),
            model: "gpt-5.5".to_string(),
            backend: BackendKind::OpenAiResponses,
            reasoning_effort: Some(ReasoningEffort::Xhigh),
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::new(),
            arcee_credential_source: None,
            cache_ttl: None,
            resolved_model: catalog::resolve(BackendKind::OpenAiResponses, "gpt-5.5"),
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

    #[test]
    fn both_arcee_backends_preserve_summary_system_order_and_omit_empty_tools() {
        let messages = [
            Message::System {
                content: "primary".to_string(),
            },
            Message::System {
                content: "agents".to_string(),
            },
            Message::User {
                content: "historical checkpoint".to_string(),
            },
            Message::User {
                content: "newly aged history".to_string(),
            },
            Message::User {
                content: "compaction prompt".to_string(),
            },
        ];
        let expected_messages = json!([
            {"role": "system", "content": "primary"},
            {"role": "system", "content": "agents"},
            {"role": "user", "content": "historical checkpoint"},
            {"role": "user", "content": "newly aged history"},
            {"role": "user", "content": "compaction prompt"}
        ]);

        for backend in [BackendKind::ArceeAuth, BackendKind::ArceeApi] {
            let client = test_model_client(
                backend,
                "https://api.arcee.ai".to_string(),
                std::collections::BTreeMap::new(),
            );
            let request = client.arcee_chat_request(&messages, &[]);

            assert_eq!(request["messages"], expected_messages, "{backend}");
            assert!(request.get("tools").is_none(), "{backend}");
        }
    }

    #[test]
    fn model_client_carries_resolved_catalog_metadata() {
        let client = test_model_client(
            BackendKind::DeepSeekChat,
            "https://api.deepseek.test".to_string(),
            std::collections::BTreeMap::new(),
        );
        assert_eq!(client.resolved_model.id, "test-model");
        assert_eq!(client.resolved_model.provider, BackendKind::DeepSeekChat);
        assert_eq!(
            client.resolved_model.api,
            catalog::ApiKind::OpenAiCompletions
        );
        assert_eq!(
            client.resolved_model.source,
            catalog::ModelSource::ProviderDefault
        );
    }

    fn anthropic_cost_test_client(server_url: &str, cache_ttl: Option<&'static str>) -> ModelClient {
        let mut client = test_model_client(
            BackendKind::AnthropicMessages,
            server_url.to_string(),
            std::collections::BTreeMap::new(),
        );
        client.model = "claude-opus-4-6".to_string();
        client.resolved_model = catalog::resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
        client.with_cache_ttl(cache_ttl)
    }

    fn anthropic_usage_server() -> ScriptedServer {
        ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "content": [{"type": "text", "text": "done"}],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_read_input_tokens": 200,
                    "cache_creation_input_tokens": 32
                }
            })
            .to_string(),
        )])
    }

    #[tokio::test]
    async fn send_turn_attaches_catalog_cost_to_the_usage() {
        let server = anthropic_usage_server();
        let client = anthropic_cost_test_client(&server.base_url, None);

        let response = client
            .send_turn(
                vec![Message::User {
                    content: "hi".to_string(),
                }],
                vec![],
            )
            .await
            .expect("anthropic response should parse");
        server.finish();

        // claude-opus-4-6 catalog rates ($/1M): 5 / 25 / 0.5 / 6.25; 5-minute
        // cache writes bill at the standard cache_write rate.
        let usage = response.usage.expect("usage should parse");
        assert_eq!(usage.cost.input, 500);
        assert_eq!(usage.cost.output, 1_250);
        assert_eq!(usage.cost.cache_read, 100);
        assert_eq!(usage.cost.cache_write, 200);
        assert_eq!(usage.cost.total, 2_050);
    }

    #[tokio::test]
    async fn orchestrator_1h_cache_writes_bill_at_the_1h_rate() {
        let server = anthropic_usage_server();
        let client = anthropic_cost_test_client(&server.base_url, Some("1h"));

        let response = client
            .send_turn(
                vec![Message::User {
                    content: "hi".to_string(),
                }],
                vec![],
            )
            .await
            .expect("anthropic response should parse");
        server.finish();

        // The catalog carries no explicit 1h rate, so the 2x-input default
        // applies: 32 tokens x $10/1M = 320 micros (vs 200 at the 5-min rate).
        let usage = response.usage.expect("usage should parse");
        assert_eq!(usage.cost.cache_write, 320);
        assert_eq!(usage.cost.total, 2_170);
    }

    #[tokio::test]
    async fn unknown_pricing_yields_zero_cost_not_an_error() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": "done", "tool_calls": null}
                }],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150
                }
            })
            .to_string(),
        )]);
        // "test-model" resolves through the provider default: zero (unknown)
        // rates.
        let client = test_model_client(
            BackendKind::DeepSeekChat,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        assert_eq!(
            client.resolved_model.cost,
            catalog::ModelCostRates::default()
        );

        let response = client
            .send_turn(
                vec![Message::User {
                    content: "hi".to_string(),
                }],
                vec![],
            )
            .await
            .expect("deepseek response should parse");
        server.finish();

        let usage = response.usage.expect("usage should parse");
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.cost, TokenCostMicros::default());
    }

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
            backend: BackendKind::ArceeApi,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::from([(
                "X-Arcee-Tenant".to_string(),
                "tenant-test".to_string(),
            )]),
            arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
            cache_ttl: None,
            resolved_model: catalog::resolve(BackendKind::ArceeApi, "arcee-test-model"),
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
        assert!(
            request.headers.get("x-arcee-client").is_none(),
            "x-arcee-client header must no longer be sent"
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
                resolved_model: catalog::resolve(BackendKind::ArceeApi, "arcee-test-model"),
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
                backend: BackendKind::ArceeApi,
                reasoning_effort: None,
                api_key_env: None,
                extra_headers: std::collections::BTreeMap::from([(
                    "X-Arcee-Tenant".to_string(),
                    "sensitive-tenant-header".to_string(),
                )]),
                arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
                cache_ttl: None,
                resolved_model: catalog::resolve(BackendKind::ArceeApi, "arcee-test-model"),
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

    fn test_model_client(
        backend: BackendKind,
        base_url: String,
        extra_headers: std::collections::BTreeMap<String, String>,
    ) -> ModelClient {
        ModelClient {
            client: no_redirect_model_client().unwrap(),
            base_url,
            api_key: "selected-provider-credential".to_string(),
            model: "test-model".to_string(),
            backend,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers,
            arcee_credential_source: None,
            cache_ttl: None,
            resolved_model: catalog::resolve(backend, "test-model"),
        }
    }

    async fn send_provider_test_request(client: &ModelClient, url: &str) -> Result<Value> {
        let body = json!({"prompt": "sensitive prompt must not replay"});
        match client.backend {
            BackendKind::OpenAiResponses => client.post_json_with_retry(url, &body).await,
            BackendKind::AnthropicMessages => {
                client.post_anthropic_json_with_retry(url, &body).await
            }
            backend => panic!("unsupported test backend: {backend}"),
        }
    }

    fn assert_provider_request_contract(
        backend: BackendKind,
        request: &super::super::test_http::CapturedRequest,
    ) {
        let (credential_header, expected_value) = match backend {
            BackendKind::OpenAiResponses => {
                ("authorization", "Bearer selected-provider-credential")
            }
            BackendKind::AnthropicMessages => ("x-api-key", "selected-provider-credential"),
            backend => panic!("unsupported test backend: {backend}"),
        };
        assert_eq!(
            request.headers.get(credential_header).map(String::as_str),
            Some(expected_value),
            "{backend} selected credential"
        );
        assert_eq!(
            request.header_counts.get(credential_header),
            Some(&1),
            "{backend} must emit exactly one selected credential header"
        );
        assert_eq!(
            request.headers.get("x-benign-trace").map(String::as_str),
            Some("trace-value"),
            "{backend} benign header"
        );
        assert!(
            String::from_utf8_lossy(&request.body).contains("sensitive prompt must not replay"),
            "{backend} source request body"
        );
    }

    #[tokio::test]
    async fn anthropic_and_openai_redirects_never_replay_same_or_cross_origin() {
        let benign_headers = std::collections::BTreeMap::from([(
            "X-Benign-Trace".to_string(),
            "trace-value".to_string(),
        )]);

        for backend in [BackendKind::AnthropicMessages, BackendKind::OpenAiResponses] {
            for status in ["307 Temporary Redirect", "308 Permanent Redirect"] {
                let same_origin = ScriptedServer::start_same_origin_redirect(
                    status,
                    "/same-origin-capture",
                    format!("{}body-must-be-bounded", "x".repeat(500)),
                );
                let client = test_model_client(
                    backend,
                    same_origin.base_url.clone(),
                    benign_headers.clone(),
                );
                let error = send_provider_test_request(
                    &client,
                    &format!("{}/initial", same_origin.base_url),
                )
                .await
                .expect_err("same-origin redirect must not be followed")
                .to_string();
                let requests = same_origin.finish();

                assert!(
                    error.contains("automatic redirects are disabled"),
                    "{error}"
                );
                assert!(error.contains("request was not replayed"), "{error}");
                assert!(error.contains(&status[..3]), "{error}");
                assert!(!error.contains("body-must-be-bounded"), "{error}");
                assert_eq!(requests.len(), 1, "{backend} {status} same-origin replay");
                assert_provider_request_contract(backend, &requests[0]);

                let destination =
                    TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect destination");
                destination
                    .set_nonblocking(true)
                    .expect("make redirect destination nonblocking");
                let destination_url = format!(
                    "http://{}/cross-origin-capture",
                    destination.local_addr().unwrap()
                );
                let cross_origin = ScriptedServer::start(vec![ScriptedResponse::redirect(
                    status,
                    destination_url,
                    "cross-origin redirect blocked",
                )]);
                let client = test_model_client(
                    backend,
                    cross_origin.base_url.clone(),
                    benign_headers.clone(),
                );
                let error = send_provider_test_request(
                    &client,
                    &format!("{}/initial", cross_origin.base_url),
                )
                .await
                .expect_err("cross-origin redirect must not be followed")
                .to_string();
                let requests = cross_origin.finish();

                assert!(
                    error.contains("automatic redirects are disabled"),
                    "{error}"
                );
                assert!(error.contains("request was not replayed"), "{error}");
                assert_eq!(requests.len(), 1, "{backend} {status} cross-origin replay");
                assert_provider_request_contract(backend, &requests[0]);
                let accept_error = destination
                    .accept()
                    .expect_err("cross-origin destination must receive no replay");
                assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
            }
        }
    }

    #[test]
    fn sensitive_extra_header_policy_is_central_case_insensitive_and_allows_benign_headers() {
        for name in [
            "Host",
            "HOST",
            "hOsT",
            "Authorization",
            "aUtHoRiZaTiOn",
            "Proxy-Authorization",
            "pRoXy-AuThOrIzAtIoN",
            "x-api-key",
            "X-API-KEY",
        ] {
            let headers =
                std::collections::BTreeMap::from([(name.to_string(), "hostile-value".to_string())]);
            let error = validate_extra_headers(&headers)
                .expect_err("authority and credential headers must be rejected");
            assert!(
                error.to_string().contains(name),
                "unexpected error for {name}: {error:#}"
            );
        }

        let benign = std::collections::BTreeMap::from([
            (
                "Content-Type".to_string(),
                "application/custom+json".to_string(),
            ),
            ("X-Benign-Trace".to_string(), "trace-value".to_string()),
        ]);
        validate_extra_headers(&benign).expect("benign model headers should remain supported");
    }

    #[tokio::test]
    async fn sensitive_extra_headers_fail_before_any_provider_connection() {
        for (backend, name) in [
            (BackendKind::OpenAiResponses, "Authorization"),
            (BackendKind::OpenAiResponses, "Host"),
            (BackendKind::AnthropicMessages, "x-api-key"),
            (BackendKind::AnthropicMessages, "Proxy-Authorization"),
        ] {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind hostile endpoint");
            listener
                .set_nonblocking(true)
                .expect("make hostile endpoint nonblocking");
            let address = listener.local_addr().expect("hostile endpoint address");
            let client = test_model_client(
                backend,
                format!("http://{address}"),
                std::collections::BTreeMap::from([(
                    name.to_string(),
                    "must-not-be-appended".to_string(),
                )]),
            );

            let error = send_provider_test_request(&client, &format!("http://{address}/initial"))
                .await
                .expect_err("sensitive extra header must fail before request")
                .to_string();

            assert!(error.contains(name), "unexpected error: {error}");
            let accept_error = listener
                .accept()
                .expect_err("invalid header must not open a provider connection");
            assert_eq!(accept_error.kind(), std::io::ErrorKind::WouldBlock);
        }
    }

    #[tokio::test]
    async fn arcee_sensitive_extra_header_still_fails_before_connection() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind hostile endpoint");
        listener
            .set_nonblocking(true)
            .expect("make hostile endpoint nonblocking");
        let address = listener.local_addr().expect("hostile endpoint address");
        let client = ModelClient {
            client: no_redirect_model_client().unwrap(),
            base_url: format!("http://{address}"),
            api_key: "stored-login-secret-must-not-leak".to_string(),
            model: "test-model".to_string(),
            backend: BackendKind::ArceeApi,
            reasoning_effort: None,
            api_key_env: None,
            extra_headers: std::collections::BTreeMap::from([(
                "hOsT".to_string(),
                address.to_string(),
            )]),
            arcee_credential_source: Some(ArceeCredentialSource::ApiKey),
            cache_ttl: None,
            resolved_model: catalog::resolve(BackendKind::ArceeApi, "test-model"),
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

    #[tokio::test]
    async fn benign_extra_headers_pass_with_exactly_one_selected_provider_credential() {
        for backend in [BackendKind::AnthropicMessages, BackendKind::OpenAiResponses] {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(
                "200 OK",
                json!({"ok": true}).to_string(),
            )]);
            let client = test_model_client(
                backend,
                server.base_url.clone(),
                std::collections::BTreeMap::from([(
                    "X-Benign-Trace".to_string(),
                    "trace-value".to_string(),
                )]),
            );

            let response =
                send_provider_test_request(&client, &format!("{}/initial", server.base_url))
                    .await
                    .expect("benign header request should succeed");
            let requests = server.finish();

            assert_eq!(response, json!({"ok": true}));
            assert_eq!(requests.len(), 1);
            assert_provider_request_contract(backend, &requests[0]);
        }
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
            resolved_model: catalog::resolve(BackendKind::ArceeApi, "test-model"),
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
