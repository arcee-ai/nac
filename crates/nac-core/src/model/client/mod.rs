use super::anthropic_stream::AnthropicStreamFold;
use super::chat_stream::ChatStreamFold;
use super::pseudo_tool_calls::finalize_chat_tool_recovery;
use super::responses_stream::ResponsesStreamFold;
use super::sse::{read_sse_response, StreamFold};
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

fn validate_backend_model(backend: BackendKind, model: &str) -> Result<()> {
    if backend == BackendKind::ArceeAuth && model != "trinity-large-thinking" {
        return Err(model_configuration_error(format!(
            "invalid model configuration: backend 'arcee-auth' supports only model 'trinity-large-thinking', not '{model}'"
        )));
    }
    Ok(())
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
    // Mirror `EffectiveModelSettings::from_optional`: an absent selector
    // auto-selects the provider's conventional credential variable when
    // set, so validation matches what session resolution will do.
    let auto_selected;
    let api_key_env = match api_key_env {
        Some(selector) => Some(selector),
        None => {
            auto_selected = backend::auto_select_api_key_env(backend);
            auto_selected.as_deref()
        }
    };
    validate_extra_headers(extra_headers)?;
    validate_model_reasoning_effort(backend, model, reasoning_effort)?;
    validate_backend_api_key_env(backend, api_key_env)?;
    if backend == BackendKind::ArceeAuth {
        if let Some(base_url) = base_url {
            arcee::validate_approved_base_url(base_url)
                .map_err(classify_model_configuration_error)?;
        }
    }
    validate_backend_model(backend, model)?;
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

fn anthropic_headers(
    request: reqwest::RequestBuilder,
    api_key: &str,
    cache_ttl: Option<&'static str>,
) -> reqwest::RequestBuilder {
    let request = request
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION);
    if cache_ttl == Some("1h") {
        return request.header("anthropic-beta", "extended-cache-ttl-2025-04-11");
    }
    request
}

async fn read_response_body(
    response: reqwest::Response,
) -> std::result::Result<String, ModelHttpError> {
    let status = response.status();
    response.text().await.map_err(|error| ModelHttpError {
        status: Some(status.as_u16()),
        message: format!("Failed to read response body: {}", error),
    })
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
    /// per-response cost, effort wire translation, and api-axis dispatch.
    resolved_model: ModelMetadata,
}

impl ModelClient {
    pub fn from_effective_settings(settings: EffectiveModelSettings) -> Result<Self> {
        validate_extra_headers(&settings.extra_headers)?;
        let backend = settings.backend;
        // ArceeApi validates through `resolve_arcee_api_credentials` below
        // (its base-url check must fire first); every other backend
        // validates its api_key_env selector here.
        if backend != BackendKind::ArceeApi {
            validate_backend_api_key_env(backend, settings.api_key_env.as_deref())?;
        }
        if backend == BackendKind::ArceeAuth {
            arcee::validate_approved_base_url(&settings.base_url)
                .map_err(classify_model_configuration_error)?;
        }
        validate_backend_model(backend, &settings.model)?;
        let (api_key, arcee_credential_source) = match backend {
            BackendKind::ArceeAuth => {
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
                chatgpt_codex::validate_base_url(&settings.base_url)
                    .map_err(classify_model_configuration_error)?;
                chatgpt_codex::preflight_stored_auth().map_err(classify_stored_codex_auth_error)?;
                (String::new(), None)
            }
            _ => (
                api_key_for_backend(backend, settings.api_key_env.as_deref())?,
                None,
            ),
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
        self.send_turn_streaming(messages, tools, None).await
    }

    /// Run a turn, handing output to `on_delta` as the provider produces it.
    ///
    /// With no sink every backend keeps its plain buffered request: streaming is
    /// only worth its extra per-chunk parsing when somebody is watching.
    pub async fn send_turn_streaming(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
        on_delta: DeltaSink<'_>,
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
                self.send_completions_chat(messages, tools, on_delta).await
            }
            catalog::ApiKind::OpenAiResponses => {
                self.send_openai_responses(messages, tools, on_delta).await
            }
            catalog::ApiKind::AnthropicMessages => {
                self.send_anthropic_messages(messages, tools, on_delta)
                    .await
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
                    on_delta,
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

    /// Catalog cost rates of the resolved model, USD per 1M tokens.
    /// All-zero means the catalog has no pricing for it.
    pub(crate) fn cost_rates(&self) -> catalog::ModelCostRates {
        self.resolved_model.cost
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
        on_delta: DeltaSink<'_>,
    ) -> Result<ModelTurnResponse> {
        let compat = &self.resolved_model.compat;
        // Trinity's vLLM front end needs its own assistant-message shape; the
        // quirk rides the provider axis, like the URL join right below.
        let arcee = matches!(self.backend, BackendKind::ArceeAuth | BackendKind::ArceeApi);
        let request = completions_chat_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
            compat,
            if arcee {
                CompletionsMessageShape::Arcee
            } else {
                CompletionsMessageShape::Standard
            },
        );
        let url = match self.backend {
            BackendKind::ArceeAuth | BackendKind::ArceeApi => {
                arcee::chat_completions_url(&self.base_url)
                    .map_err(classify_model_configuration_error)?
                    .to_string()
            }
            _ => format!("{}/chat/completions", self.base_url),
        };
        let reasoning_field = compat
            .completions_reasoning_field
            .as_deref()
            .unwrap_or("reasoning_content");
        let value = match self.backend {
            // Stored-login still refreshes the token around the request; once we
            // have a Bearer it can take the same streaming path as arcee-api.
            BackendKind::ArceeAuth => {
                self.post_arcee_auth_with_refresh(url.as_str(), request, reasoning_field, on_delta)
                    .await?
            }
            _ => {
                self.post_chat_completions(url.as_str(), request, reasoning_field, on_delta)
                    .await?
            }
        };
        let mut response = parse_completions_response(&value, url.as_str(), reasoning_field)?;
        if arcee {
            finalize_chat_tool_recovery(&mut response, &tools);
        }
        Ok(self.with_usage_cost(response))
    }

    /// Send a chat-completions request, streaming it when somebody is watching.
    /// `include_usage` is what keeps the usage numbers on the streamed path,
    /// which otherwise omits them entirely.
    async fn post_chat_completions(
        &self,
        url: &str,
        mut request: Value,
        reasoning_field: &str,
        on_delta: DeltaSink<'_>,
    ) -> Result<Value> {
        if on_delta.is_none() {
            return self.post_json_with_retry(url, &request).await;
        }
        request["stream"] = Value::Bool(true);
        request["stream_options"] = json!({"include_usage": true});
        let api_key = self.api_key.as_str();
        self.post_sse_with_retry_headers(
            url,
            &request,
            |request| request.header("Authorization", format!("Bearer {}", api_key)),
            ChatStreamFold::new(on_delta, reasoning_field),
        )
        .await
    }

    async fn send_openai_responses(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
        on_delta: DeltaSink<'_>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/responses", self.base_url);
        let mut request = openai_responses_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            &self.resolved_model.thinking_level_map,
        );

        let value = match on_delta {
            Some(_) => {
                request["stream"] = Value::Bool(true);
                let api_key = self.api_key.as_str();
                self.post_sse_with_retry_headers(
                    &url,
                    &request,
                    |request| request.header("Authorization", format!("Bearer {}", api_key)),
                    ResponsesStreamFold::new(on_delta),
                )
                .await?
            }
            None => self.post_json_with_retry(&url, &request).await?,
        };
        Ok(self.with_usage_cost(parse_openai_responses_response(&value, &url)?))
    }

    async fn send_anthropic_messages(
        &self,
        messages: Vec<Message>,
        tools: Vec<ToolDefinition>,
        on_delta: DeltaSink<'_>,
    ) -> Result<ModelTurnResponse> {
        let url = format!("{}/v1/messages", self.base_url.trim_end_matches('/'));
        let mut request = anthropic_messages_request(
            &self.model,
            self.reasoning_effort,
            &messages,
            &tools,
            self.cache_ttl,
            &self.resolved_model.thinking_level_map,
            self.resolved_model.max_tokens,
        )?;

        let value = match on_delta {
            Some(_) => {
                request["stream"] = Value::Bool(true);
                let api_key = self.api_key.as_str();
                let cache_ttl = self.cache_ttl;
                self.post_sse_with_retry_headers(
                    &url,
                    &request,
                    |request| anthropic_headers(request, api_key, cache_ttl),
                    AnthropicStreamFold::new(on_delta),
                )
                .await?
            }
            None => self.post_anthropic_json_with_retry(&url, &request).await?,
        };
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
    async fn post_arcee_auth_with_refresh(
        &self,
        url: &str,
        mut body: Value,
        reasoning_field: &str,
        on_delta: DeltaSink<'_>,
    ) -> Result<Value> {
        debug_assert!(matches!(
            self.arcee_credential_source,
            Some(ArceeCredentialSource::StoredLogin)
        ));
        let stream = on_delta.is_some();
        if stream {
            body["stream"] = Value::Bool(true);
            body["stream_options"] = json!({"include_usage": true});
        }
        let token = arcee::fresh_access_token(&self.client, &self.base_url).await?;
        match self
            .try_post_arcee_auth(url, &body, &token, reasoning_field, on_delta)
            .await
        {
            Ok(value) => Ok(value),
            Err(error) if error.status == Some(401) => {
                let refreshed =
                    arcee::force_refresh_access_token(&self.client, &self.base_url, &token).await?;
                self.try_post_arcee_auth(url, &body, &refreshed, reasoning_field, on_delta)
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
        reasoning_field: &str,
        on_delta: DeltaSink<'_>,
    ) -> std::result::Result<Value, ModelHttpError> {
        if let Some(on_delta) = on_delta {
            // Same forfeit-retry rule as the other SSE adapters: once chunks
            // have been forwarded, a mid-stream failure cannot be retried.
            let response = self
                .send_with_retry_headers(url, body, |request| {
                    request.header("Authorization", format!("Bearer {token}"))
                })
                .await?;
            return read_sse_response(
                url,
                response,
                ChatStreamFold::new(Some(on_delta), reasoning_field),
            )
            .await
            .map_err(|error| ModelHttpError {
                status: None,
                message: error.to_string(),
            });
        }
        self.try_post_json_with_retry_headers(url, body, |request| {
            request.header("Authorization", format!("Bearer {token}"))
        })
        .await
    }

    async fn post_anthropic_json_with_retry(&self, url: &str, body: &Value) -> Result<Value> {
        let api_key = self.api_key.as_str();
        let cache_ttl = self.cache_ttl;
        self.post_json_with_retry_headers(url, body, |request| {
            anthropic_headers(request, api_key, cache_ttl)
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
        let response = self
            .send_with_retry_headers(url, body, apply_headers)
            .await?;
        let status = response.status();
        let body_text = read_response_body(response).await?;
        serde_json::from_str::<Value>(&body_text).map_err(|e| ModelHttpError {
            status: Some(status.as_u16()),
            message: format!(
                "Failed to parse response from {}: {}\nBody: {}",
                url,
                e,
                truncate_utf8(&body_text, 500)
            ),
        })
    }

    /// Issue the request under the retry policy and hand back the response with
    /// its body still unread, so a caller can either buffer it or stream it.
    /// Every non-success outcome is resolved here, including its bounded body.
    async fn send_with_retry_headers<F>(
        &self,
        url: &str,
        body: &Value,
        apply_headers: F,
    ) -> std::result::Result<reqwest::Response, ModelHttpError>
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
            if status.is_success() {
                return Ok(response);
            }

            let body = read_response_body(response).await?;

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

    /// Send a streaming request, folding the event stream back into the response
    /// value the buffered parsers expect.
    async fn post_sse_with_retry_headers<F, Fold>(
        &self,
        url: &str,
        body: &Value,
        apply_headers: F,
        fold: Fold,
    ) -> Result<Value>
    where
        F: Fn(reqwest::RequestBuilder) -> reqwest::RequestBuilder + Copy,
        Fold: StreamFold,
    {
        let response = self
            .send_with_retry_headers(url, body, apply_headers)
            .await
            .map_err(|error| anyhow!(error.message))?;
        read_sse_response(url, response, fold).await
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
mod tests;
