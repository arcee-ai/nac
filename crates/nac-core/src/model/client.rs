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
        // S5 reasoning discipline: same-model gate, orphan reconciliation.
        // Runs once here so every adapter (and the compaction summary call)
        // inherits it; operates on the send-time copy, never the transcript.
        let messages = normalize_history(messages, &self.model_origin());
        // S6: dispatch on the resolved catalog api (the wire protocol), not
        // the provider id. BackendKind remains the auth/base-url/catalog axis
        // (approved decision #1); within the completions adapter it still
        // selects the URL join and credential style.
        match self.resolved_model.api {
            catalog::ApiKind::OpenAiCompletions => {
                self.send_completions_chat(messages, tools).await
            }
            catalog::ApiKind::OpenAiResponses => self.send_openai_responses(messages, tools).await,
            catalog::ApiKind::AnthropicMessages => {
                self.send_anthropic_messages(messages, tools).await
            }
            catalog::ApiKind::ChatGptCodexResponses => {
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

    /// The origin stamp for assistant messages this client produces (S5):
    /// recorded on the transcript at the push site and compared against
    /// history stamps by `normalize_history` on every send.
    pub(crate) fn model_origin(&self) -> ModelOrigin {
        ModelOrigin {
            backend: self.backend,
            model: self.model.clone(),
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

    /// The single OpenAI-completions-family adapter (S6): one request
    /// builder and one parser, both driven by the resolved catalog `compat`
    /// data. The provider axis (BackendKind) still owns the URL join and
    /// credential style: Arcee uses its custom URL join and, for
    /// `arcee-auth`, device-flow tokens with proactive refresh; the API-key
    /// providers post Bearer credentials to `<base_url>/chat/completions`.
    async fn send_completions_chat(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
    ) -> Result<ModelTurnResponse> {
        let compat = &self.resolved_model.compat;
        let request = completions_chat_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
            compat,
        );
        let url = match self.backend {
            BackendKind::ArceeAuth | BackendKind::ArceeApi => arcee::chat_completions_url(
                &self.base_url,
            )
            .map_err(classify_model_configuration_error)?
            .to_string(),
            _ => format!("{}/chat/completions", self.base_url),
        };
        let value = match self.backend {
            BackendKind::ArceeAuth => {
                self.post_arcee_auth_with_refresh(url.as_str(), &request)
                    .await?
            }
            _ => self.post_json_with_retry(url.as_str(), &request).await?,
        };
        let reasoning_field = compat
            .completions_reasoning_field
            .as_deref()
            .unwrap_or("reasoning_content");
        Ok(self.with_usage_cost(parse_completions_response(
            &value,
            url.as_str(),
            reasoning_field,
        )?))
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
            self.resolved_model.max_tokens,
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
            // Arcee's request shape comes from the shared completions builder
            // driven by the provider's catalog compat (S6).
            let request = completions_chat_request(
                &client.model,
                client.reasoning_effort,
                &messages,
                &[],
                &client.resolved_model.thinking_level_map,
                &client.resolved_model.compat,
            );

            assert_eq!(request["messages"], expected_messages, "{backend}");
            assert_eq!(request["temperature"], json!(0.0), "{backend}");
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
                .send_completions_chat(Vec::new(), Vec::new())
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
                .send_completions_chat(
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
            .send_completions_chat(Vec::new(), Vec::new())
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
            .send_completions_chat(Vec::new(), Vec::new())
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

    // ---- S5 reasoning discipline: golden wire tests ----
    //
    // These pin the exact history-replay shape each adapter emits, through
    // `send_turn` (which now normalizes history once before dispatch). The
    // same-model and legacy (no-origin) cases must produce byte-identical
    // requests to pre-S5 behavior; the cross-model case must strip foreign
    // reasoning while keeping the rest of the turn valid.

    fn s5_tool_call(id: &str) -> ToolCall {
        ToolCall {
            id: id.to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: "read".to_string(),
                arguments: "{}".to_string(),
            },
        }
    }

    /// user → assistant(reasoning + tool call) → tool result → user, with the
    /// assistant stamped with the given origin and reasoning field.
    fn s5_history(
        origin: Option<ModelOrigin>,
        reasoning_field: Option<&str>,
        reasoning_text: Option<&str>,
        reasoning_details: Option<Value>,
    ) -> Vec<Message> {
        vec![
            Message::User {
                content: "first".to_string(),
            },
            Message::Assistant {
                content: Some("prior answer".to_string()),
                reasoning_text: reasoning_text.map(str::to_string),
                reasoning_details,
                tool_calls: Some(vec![s5_tool_call("call-1")]),
                model_origin: origin,
                reasoning_field: reasoning_field.map(str::to_string),
            },
            Message::Tool {
                tool_call_id: "call-1".to_string(),
                content: "tool output".to_string(),
            },
            Message::User {
                content: "second".to_string(),
            },
        ]
    }

    fn s5_completions_response() -> ScriptedResponse {
        ScriptedResponse::json(
            "200 OK",
            json!({
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": "done", "tool_calls": null}
                }],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        )
    }

    fn s5_openai_response() -> ScriptedResponse {
        ScriptedResponse::json(
            "200 OK",
            json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "done"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string(),
        )
    }

    fn s5_anthropic_response() -> ScriptedResponse {
        ScriptedResponse::json(
            "200 OK",
            json!({
                "content": [{"type": "text", "text": "done"}],
                "stop_reason": "end_turn",
                "usage": {"input_tokens": 10, "output_tokens": 5}
            })
            .to_string(),
        )
    }

    async fn s5_send_and_finish(
        client: &ModelClient,
        server: ScriptedServer,
        messages: Vec<Message>,
    ) -> Value {
        let response = client
            .send_turn(messages, vec![])
            .await
            .expect("scripted response should parse");
        assert_eq!(response.assistant.content.as_deref(), Some("done"));
        let requests = server.finish();
        assert_eq!(requests.len(), 1);
        serde_json::from_slice::<Value>(&requests[0].body).expect("request body is JSON")
    }

    fn s5_thinking_blocks() -> Value {
        json!([{"type": "thinking", "thinking": "prior thinking", "signature": "sig-abc"}])
    }

    fn s5_reasoning_items() -> Value {
        json!([{"type": "reasoning", "id": "rs_1", "summary": [{"type": "summary_text", "text": "prior thinking"}]}])
    }

    #[tokio::test]
    async fn same_model_history_replays_reasoning_on_completions_backends() {
        for (backend, field) in [
            (BackendKind::DeepSeekChat, "reasoning_content"),
            (BackendKind::FireworksChat, "reasoning_content"),
            (BackendKind::TogetherChat, "reasoning"),
        ] {
            let server = ScriptedServer::start(vec![s5_completions_response()]);
            let client = test_model_client(
                backend,
                server.base_url.clone(),
                std::collections::BTreeMap::new(),
            );
            let origin = Some(client.model_origin());
            let body = s5_send_and_finish(
                &client,
                server,
                s5_history(origin, Some(field), Some("prior thinking"), None),
            )
            .await;

            let expected_tool_calls = json!([{
                "id": "call-1",
                "type": "function",
                "function": {"name": "read", "arguments": "{}"}
            }]);
            let mut expected_assistant = json!({
                "role": "assistant",
                "content": "prior answer",
                "tool_calls": expected_tool_calls,
            });
            expected_assistant[field] = json!("prior thinking");
            assert_eq!(
                body["messages"],
                json!([
                    {"role": "user", "content": "first"},
                    expected_assistant,
                    {"role": "tool", "tool_call_id": "call-1", "content": "tool output"},
                    {"role": "user", "content": "second"}
                ]),
                "{backend} same-model replay must be byte-identical to pre-S5"
            );
        }
    }

    #[tokio::test]
    async fn same_model_history_replays_reasoning_items_on_openai_responses() {
        let server = ScriptedServer::start(vec![s5_openai_response()]);
        let client = test_model_client(
            BackendKind::OpenAiResponses,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let origin = Some(client.model_origin());
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(origin, None, Some("prior thinking"), Some(s5_reasoning_items())),
        )
        .await;

        assert_eq!(
            body["input"],
            json!([
                {"role": "user", "content": "first"},
                s5_reasoning_items()[0],
                {"type": "function_call", "call_id": "call-1", "name": "read", "arguments": "{}"},
                {"role": "assistant", "content": "prior answer"},
                {"type": "function_call_output", "call_id": "call-1", "output": "tool output"},
                {"role": "user", "content": "second"}
            ]),
            "whole reasoning items replay verbatim for the same model"
        );
    }

    #[tokio::test]
    async fn same_model_history_replays_thinking_blocks_on_anthropic() {
        let server = ScriptedServer::start(vec![s5_anthropic_response()]);
        let client = test_model_client(
            BackendKind::AnthropicMessages,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let origin = Some(client.model_origin());
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(origin, None, None, Some(s5_thinking_blocks())),
        )
        .await;

        assert_eq!(
            body["messages"],
            json!([
                {"role": "user", "content": "first"},
                {"role": "assistant", "content": [
                    {"type": "thinking", "thinking": "prior thinking", "signature": "sig-abc"},
                    {"type": "text", "text": "prior answer"},
                    {"type": "tool_use", "id": "call-1", "name": "read", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "call-1", "content": "tool output"}
                ]},
                {"role": "user", "content": [
                    {"type": "text", "text": "second", "cache_control": {"type": "ephemeral"}}
                ]}
            ]),
            "signed thinking blocks replay verbatim for the same model"
        );
    }

    #[tokio::test]
    async fn legacy_history_without_origin_replays_exactly_like_same_model() {
        // The safety rail, pinned end-to-end: pre-S5 transcripts have no
        // origin stamp and must replay reasoning exactly as before —
        // Anthropic requires the thinking blocks alongside their tool_use.
        let server = ScriptedServer::start(vec![s5_anthropic_response()]);
        let client = test_model_client(
            BackendKind::AnthropicMessages,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(None, None, None, Some(s5_thinking_blocks())),
        )
        .await;
        assert_eq!(
            body["messages"][1]["content"][0],
            json!({"type": "thinking", "thinking": "prior thinking", "signature": "sig-abc"}),
            "legacy anthropic history keeps its thinking blocks"
        );

        let server = ScriptedServer::start(vec![s5_completions_response()]);
        let client = test_model_client(
            BackendKind::DeepSeekChat,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(None, None, Some("prior thinking"), None),
        )
        .await;
        assert_eq!(
            body["messages"][1],
            json!({
                "role": "assistant",
                "content": "prior answer",
                "reasoning_content": "prior thinking",
                "tool_calls": [{
                    "id": "call-1",
                    "type": "function",
                    "function": {"name": "read", "arguments": "{}"}
                }]
            }),
            "legacy completions history keeps reasoning under the historical default field"
        );
    }

    #[tokio::test]
    async fn cross_model_history_strips_foreign_reasoning_on_anthropic() {
        // A session that switched from OpenAI to Anthropic: the foreign
        // reasoning items and text never reach the Anthropic wire, but the
        // rest of the turn (content, tool_use, tool_result) stays valid.
        let server = ScriptedServer::start(vec![s5_anthropic_response()]);
        let client = test_model_client(
            BackendKind::AnthropicMessages,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let foreign = Some(ModelOrigin {
            backend: BackendKind::OpenAiResponses,
            model: "gpt-5.5".to_string(),
        });
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(foreign, None, Some("foreign thinking"), Some(s5_reasoning_items())),
        )
        .await;

        assert_eq!(
            body["messages"],
            json!([
                {"role": "user", "content": "first"},
                {"role": "assistant", "content": [
                    {"type": "text", "text": "prior answer"},
                    {"type": "tool_use", "id": "call-1", "name": "read", "input": {}}
                ]},
                {"role": "user", "content": [
                    {"type": "tool_result", "tool_use_id": "call-1", "content": "tool output"}
                ]},
                {"role": "user", "content": [
                    {"type": "text", "text": "second", "cache_control": {"type": "ephemeral"}}
                ]}
            ]),
            "no foreign reasoning items or thinking blocks on the anthropic wire"
        );
    }

    #[tokio::test]
    async fn cross_model_history_strips_foreign_reasoning_on_openai_responses() {
        // The reverse switch: Anthropic thinking blocks must not reach the
        // OpenAI wire as reasoning items.
        let server = ScriptedServer::start(vec![s5_openai_response()]);
        let client = test_model_client(
            BackendKind::OpenAiResponses,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let foreign = Some(ModelOrigin {
            backend: BackendKind::AnthropicMessages,
            model: "claude-opus-4-6".to_string(),
        });
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(foreign, None, None, Some(s5_thinking_blocks())),
        )
        .await;

        assert_eq!(
            body["input"],
            json!([
                {"role": "user", "content": "first"},
                {"type": "function_call", "call_id": "call-1", "name": "read", "arguments": "{}"},
                {"role": "assistant", "content": "prior answer"},
                {"type": "function_call_output", "call_id": "call-1", "output": "tool output"},
                {"role": "user", "content": "second"}
            ]),
            "no foreign thinking blocks on the openai wire"
        );
    }

    #[tokio::test]
    async fn cross_model_history_strips_foreign_reasoning_on_completions() {
        let server = ScriptedServer::start(vec![s5_completions_response()]);
        let client = test_model_client(
            BackendKind::FireworksChat,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let foreign = Some(ModelOrigin {
            backend: BackendKind::DeepSeekChat,
            model: "deepseek-chat".to_string(),
        });
        let body = s5_send_and_finish(
            &client,
            server,
            s5_history(foreign, Some("reasoning_content"), Some("foreign thinking"), None),
        )
        .await;

        let assistant = &body["messages"][1];
        assert_eq!(assistant["content"], json!("prior answer"));
        assert!(
            assistant.get("reasoning_content").is_none() && assistant.get("reasoning").is_none(),
            "foreign reasoning text is not replayed: {assistant}"
        );
        assert!(assistant.get("tool_calls").is_some(), "tool calls preserved");
    }

    #[tokio::test]
    async fn together_reasoning_round_trips_under_the_reasoning_field() {
        let server = ScriptedServer::start(vec![
            ScriptedResponse::json(
                "200 OK",
                json!({
                    "choices": [{
                        "finish_reason": "stop",
                        "message": {"content": "first answer", "reasoning": "together thinking"}
                    }],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
                })
                .to_string(),
            ),
            s5_completions_response(),
        ]);
        let client = test_model_client(
            BackendKind::TogetherChat,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );

        let first = client
            .send_turn(
                vec![Message::User {
                    content: "start".to_string(),
                }],
                vec![],
            )
            .await
            .expect("first together response should parse");
        assert_eq!(
            first.assistant.reasoning_text.as_deref(),
            Some("together thinking")
        );
        assert_eq!(
            first.assistant.reasoning_field.as_deref(),
            Some("reasoning"),
            "the parser records the field together actually used"
        );

        // Mirror the agent push site: stamp the transcript message with the
        // client origin and the parsed reasoning field.
        let history = vec![
            Message::User {
                content: "start".to_string(),
            },
            Message::Assistant {
                content: first.assistant.content.clone(),
                reasoning_text: first.assistant.reasoning_text.clone(),
                reasoning_details: None,
                tool_calls: None,
                model_origin: Some(client.model_origin()),
                reasoning_field: first.assistant.reasoning_field.clone(),
            },
            Message::User {
                content: "continue".to_string(),
            },
        ];
        let second = client
            .send_turn(history, vec![])
            .await
            .expect("second together response should parse");
        assert_eq!(second.assistant.content.as_deref(), Some("done"));

        let requests = server.finish();
        assert_eq!(requests.len(), 2);
        let body = serde_json::from_slice::<Value>(&requests[1].body).expect("request body is JSON");
        assert_eq!(
            body["messages"][1],
            json!({
                "role": "assistant",
                "content": "first answer",
                "reasoning": "together thinking"
            }),
            "replay uses together's own field name, not the deepseek default"
        );
    }

    #[tokio::test]
    async fn orphaned_tool_call_is_completed_on_the_anthropic_wire() {
        // Cancel-after-push shape, end-to-end: the assistant turn has a tool
        // call whose result never arrived. Anthropic 400s on a tool_use
        // without a matching tool_result, so normalization synthesizes one.
        let server = ScriptedServer::start(vec![s5_anthropic_response()]);
        let client = test_model_client(
            BackendKind::AnthropicMessages,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        let origin = Some(client.model_origin());
        let mut history = s5_history(origin, None, None, Some(s5_thinking_blocks()));
        history.remove(2); // drop the tool result, leaving the call orphaned
        let body = s5_send_and_finish(&client, server, history).await;

        assert_eq!(
            body["messages"][2],
            json!({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": "call-1",
                 "content": "Tool execution was interrupted; no result was recorded."}
            ]}),
            "the orphaned call gains a synthesized interruption result"
        );
    }

    // --- S6: api-axis dispatch + catalog-driven max_tokens -------------------

    #[tokio::test]
    async fn send_turn_dispatches_on_the_resolved_api_not_the_backend() {
        // The dispatch axis is the resolved catalog api: a client whose
        // metadata says OpenAiResponses speaks the responses protocol even
        // though its BackendKind is a completions provider. (Real clients
        // always resolve api == api_kind_for(provider); the hand-mutated
        // metadata isolates the dispatch axis.)
        let server = ScriptedServer::start(vec![s5_openai_response()]);
        let mut client = test_model_client(
            BackendKind::DeepSeekChat,
            server.base_url.clone(),
            std::collections::BTreeMap::new(),
        );
        client.resolved_model.api = catalog::ApiKind::OpenAiResponses;
        let body = s5_send_and_finish(
            &client,
            server,
            vec![Message::User {
                content: "hi".to_string(),
            }],
        )
        .await;

        assert!(
            body.get("input").is_some(),
            "the responses wire shape proves api-axis dispatch: {body}"
        );
        assert!(body.get("messages").is_none());
    }

    #[tokio::test]
    async fn anthropic_max_tokens_come_from_the_resolved_catalog_metadata() {
        // S6 intentional behavior change: the Anthropic adapter sends the
        // per-model catalog max_tokens (models.dev limit.output) instead of
        // the hardcoded 128_000. Values verified against Anthropic's model
        // docs (platform.claude.com/docs/en/about-claude/models/overview).
        for (model, expected) in [
            ("claude-opus-4-6", 128_000_u64),
            ("claude-sonnet-4-6", 128_000),
            ("claude-opus-4-5", 64_000),
            ("claude-haiku-4-5", 64_000),
            ("claude-sonnet-4-5", 64_000),
            ("claude-opus-4-1", 32_000),
            // No catalog entry: the conservative fallback (was 128_000).
            ("claude-unknown-future", 16_384),
        ] {
            let server = ScriptedServer::start(vec![s5_anthropic_response()]);
            let mut client = test_model_client(
                BackendKind::AnthropicMessages,
                server.base_url.clone(),
                std::collections::BTreeMap::new(),
            );
            client.model = model.to_string();
            client.resolved_model = catalog::resolve(BackendKind::AnthropicMessages, model);
            let body = s5_send_and_finish(
                &client,
                server,
                vec![Message::User {
                    content: "hi".to_string(),
                }],
            )
            .await;
            assert_eq!(body["max_tokens"], json!(expected), "{model}");
        }
    }

}
