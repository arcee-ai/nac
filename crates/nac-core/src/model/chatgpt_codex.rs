use super::*;
use anyhow::Context;
use reqwest::header;
use reqwest::StatusCode;
use serde::Deserialize;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_USER_CODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const ORIGINATOR: &str = "nac";
const AUTH_TYPE: &str = "chatgpt-codex";
const DEFAULT_EXPIRES_IN_SECS: u64 = 3600;
const REFRESH_SKEW_MS: u64 = 60_000;
const DEVICE_TIMEOUT_SECS: u64 = 15 * 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredCodexAuth {
    #[serde(rename = "type")]
    auth_type: String,
    access: String,
    refresh: String,
    expires_at_ms: u64,
    account_id: String,
}

/// Marks missing or invalid managed Codex credential content. Credential-store
/// access and safety failures intentionally remain untyped operational errors.
#[derive(Debug)]
pub(super) struct StoredCodexAuthConfigurationError {
    message: String,
}

impl fmt::Display for StoredCodexAuthConfigurationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StoredCodexAuthConfigurationError {}

fn stored_auth_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(StoredCodexAuthConfigurationError {
        message: message.into(),
    })
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    access_token: String,
    refresh_token: String,
    expires_in: Option<u64>,
}

#[derive(Debug)]
struct DeviceCode {
    device_auth_id: String,
    user_code: String,
    interval_secs: u64,
}

#[derive(Debug)]
struct AuthorizationCode {
    code: String,
    verifier: String,
}

#[derive(Debug)]
struct CodexRequestError {
    status: Option<StatusCode>,
    message: String,
}

impl fmt::Display for CodexRequestError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for CodexRequestError {}

pub(super) fn no_redirect_client() -> Result<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("failed to build Codex HTTP client")
}

pub(super) fn validate_base_url(base_url: &str) -> Result<Url> {
    let parsed = Url::parse(base_url)
        .map_err(|error| anyhow!("invalid Codex base URL '{}': {}", base_url, error))?;
    if parsed.scheme() != "https" {
        return Err(anyhow!(
            "invalid Codex base URL '{}': managed Codex requires HTTPS",
            base_url
        ));
    }
    if parsed.host_str() != Some("chatgpt.com") {
        return Err(anyhow!(
            "invalid Codex base URL '{}': managed Codex requires the approved ChatGPT origin",
            base_url
        ));
    }
    if parsed.port_or_known_default() != Some(443) {
        return Err(anyhow!(
            "invalid Codex base URL '{}': managed Codex requires effective port 443",
            base_url
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow!(
            "invalid Codex base URL '{}': userinfo is not allowed",
            base_url
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(anyhow!(
            "invalid Codex base URL '{}': query parameters and fragments are not allowed",
            base_url
        ));
    }
    if !matches!(parsed.path(), "/backend-api" | "/backend-api/") {
        return Err(anyhow!(
            "invalid Codex base URL '{}': managed Codex requires path '/backend-api'",
            base_url
        ));
    }
    Ok(parsed)
}

pub(super) fn preflight_stored_auth() -> Result<()> {
    let _lock = acquire_auth_lock()?;
    read_auth_file().map(|_| ())
}

pub async fn codex_auth_login() -> Result<()> {
    let client = Client::new();
    let device = request_device_code(&client).await?;

    println!("Open this URL in a browser:");
    println!("{DEVICE_VERIFICATION_URL}");
    println!();
    println!("Enter this code:");
    println!("{}", device.user_code);
    println!();
    println!("Waiting for authorization...");

    let code = poll_device_code(&client, &device).await?;
    let tokens = exchange_authorization_code(&client, &code).await?;
    let auth = auth_from_token_response(tokens, None)?;
    with_auth_lock(|| write_auth_file(&auth))?;

    println!("Codex auth saved.");
    println!("account: {}", auth.account_id);
    println!("path: {}", auth_file_path()?.display());

    Ok(())
}

pub fn codex_auth_logout() -> Result<()> {
    let path = auth_file_path()?;
    let removed = with_auth_lock(|| {
        if auth_path_is_symlink(&path)? {
            return remove_auth_path(&path);
        }
        remove_codex_auth_file_for_logout(&path)
    })?;

    if removed {
        println!("Codex auth removed.");
    } else {
        println!("No Codex auth found.");
    }
    println!("path: {}", path.display());
    Ok(())
}

fn auth_path_is_symlink(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_symlink()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {}", path.display())),
    }
}

fn remove_codex_auth_file_for_logout(path: &Path) -> Result<bool> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", path.display()))
        }
    };

    if metadata.file_type().is_symlink() {
        return remove_auth_path(path);
    }
    if !metadata.file_type().is_file() {
        return Err(anyhow!(
            "refusing to remove non-regular credential path {}",
            path.display()
        ));
    }

    let raw = read_auth_bytes_from_path(path)?.ok_or_else(|| {
        anyhow!(
            "credential path {} disappeared while preparing logout; retry the operation",
            path.display()
        )
    })?;
    let value: Value = match serde_json::from_slice(&raw) {
        Ok(value) => value,
        Err(_) => return remove_auth_path(path),
    };
    if value.get("type").and_then(Value::as_str) == Some(AUTH_TYPE) {
        remove_auth_path(path)
    } else {
        Ok(false)
    }
}

fn remove_auth_path(path: &Path) -> Result<bool> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

pub fn codex_auth_status() -> Result<()> {
    let path = auth_file_path()?;
    let auth = read_auth_file_optional_for_status()?;
    match auth {
        Some(auth) => {
            println!("Codex auth: signed in");
            println!("account: {}", auth.account_id);
            println!("expires: {}", expiry_status(auth.expires_at_ms));
            println!("path: {}", path.display());
        }
        None => {
            println!("Codex auth: not signed in");
            println!("path: {}", path.display());
        }
    }
    Ok(())
}

pub async fn send_responses(
    client: &Client,
    base_url: &str,
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: Vec<Message>,
    tools: Vec<ToolDefinition>,
) -> Result<ModelTurnResponse> {
    let url = codex_responses_url(base_url)?;
    let request = codex_responses_request(model, reasoning_effort, &messages, &tools);
    let auth = fresh_auth(client).await?;

    match post_codex_json_with_retry(client, &url, &request, &auth).await {
        Ok(value) => parse_openai_responses_response(&value, &url),
        Err(error) if error.status == Some(StatusCode::UNAUTHORIZED) => {
            let refreshed = force_refresh_auth(client).await?;
            let value = post_codex_json_with_retry(client, &url, &request, &refreshed)
                .await
                .map_err(anyhow::Error::new)?;
            parse_openai_responses_response(&value, &url)
        }
        Err(error) => Err(anyhow::Error::new(error)),
    }
}

async fn request_device_code(client: &Client) -> Result<DeviceCode> {
    let response = client
        .post(DEVICE_USER_CODE_URL)
        .header("Content-Type", "application/json")
        .header("User-Agent", codex_user_agent())
        .json(&json!({ "client_id": CLIENT_ID }))
        .send()
        .await
        .context("failed to request Codex device code")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read Codex device-code response")?;
    if !status.is_success() {
        return Err(anyhow!(
            "Codex device-code request failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&body)
        ));
    }

    let value: Value =
        serde_json::from_str(&body).context("failed to parse Codex device-code response")?;
    let device_auth_id = value
        .get("device_auth_id")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Codex device-code response did not include device_auth_id"))?
        .to_string();
    let user_code = value
        .get("user_code")
        .or_else(|| value.get("usercode"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("Codex device-code response did not include user_code"))?
        .to_string();
    let interval_secs = interval_secs(value.get("interval")).unwrap_or(5).max(1);

    Ok(DeviceCode {
        device_auth_id,
        user_code,
        interval_secs,
    })
}

async fn poll_device_code(client: &Client, device: &DeviceCode) -> Result<AuthorizationCode> {
    let started = now_ms();
    loop {
        let response = client
            .post(DEVICE_TOKEN_URL)
            .header("Content-Type", "application/json")
            .header("User-Agent", codex_user_agent())
            .json(&json!({
                "device_auth_id": device.device_auth_id,
                "user_code": device.user_code,
            }))
            .send()
            .await
            .context("failed to poll Codex device authorization")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read Codex device authorization response")?;

        if status.is_success() {
            let value: Value = serde_json::from_str(&body)
                .context("failed to parse Codex device authorization response")?;
            let code = value
                .get("authorization_code")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow!(
                        "Codex device authorization response did not include authorization_code"
                    )
                })?
                .to_string();
            let verifier = value
                .get("code_verifier")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    anyhow!("Codex device authorization response did not include code_verifier")
                })?
                .to_string();
            return Ok(AuthorizationCode { code, verifier });
        }

        if status != StatusCode::FORBIDDEN && status != StatusCode::NOT_FOUND {
            return Err(anyhow!(
                "Codex device authorization failed with HTTP {}: {}",
                status.as_u16(),
                truncate(&body)
            ));
        }

        if now_ms().saturating_sub(started) >= DEVICE_TIMEOUT_SECS * 1000 {
            return Err(anyhow!(
                "Codex device authorization timed out after 15 minutes"
            ));
        }

        sleep(Duration::from_secs(device.interval_secs)).await;
    }
}

async fn exchange_authorization_code(
    client: &Client,
    code: &AuthorizationCode,
) -> Result<TokenResponse> {
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.code.as_str()),
            ("redirect_uri", DEVICE_REDIRECT_URI),
            ("client_id", CLIENT_ID),
            ("code_verifier", code.verifier.as_str()),
        ])
        .send()
        .await
        .context("failed to exchange Codex authorization code")?;

    parse_token_response(response, "Codex token exchange").await
}

async fn refresh_access_token(client: &Client, refresh_token: &str) -> Result<TokenResponse> {
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .context("failed to refresh Codex access token")?;

    parse_token_response(response, "Codex token refresh").await
}

async fn parse_token_response(response: reqwest::Response, label: &str) -> Result<TokenResponse> {
    let status = response.status();
    let body = response
        .text()
        .await
        .with_context(|| format!("failed to read {label} response"))?;
    if !status.is_success() {
        return Err(anyhow!(
            "{label} failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&body)
        ));
    }
    serde_json::from_str(&body).with_context(|| format!("failed to parse {label} response"))
}

async fn fresh_auth(client: &Client) -> Result<StoredCodexAuth> {
    let _lock = acquire_auth_lock()?;
    let auth = read_auth_file()?;
    if auth.expires_at_ms > now_ms().saturating_add(REFRESH_SKEW_MS) {
        return Ok(auth);
    }
    refresh_and_store_auth(client, auth).await
}

async fn force_refresh_auth(client: &Client) -> Result<StoredCodexAuth> {
    let _lock = acquire_auth_lock()?;
    let auth = read_auth_file()?;
    refresh_and_store_auth(client, auth).await
}

async fn refresh_and_store_auth(
    client: &Client,
    current: StoredCodexAuth,
) -> Result<StoredCodexAuth> {
    let tokens = refresh_access_token(client, &current.refresh).await?;
    let refreshed = auth_from_token_response(tokens, Some(&current.account_id))?;
    write_auth_file(&refreshed)?;
    Ok(refreshed)
}

fn auth_from_token_response(
    response: TokenResponse,
    fallback_account_id: Option<&str>,
) -> Result<StoredCodexAuth> {
    let account_id = response
        .id_token
        .as_deref()
        .and_then(extract_account_id)
        .or_else(|| extract_account_id(&response.access_token))
        .or(fallback_account_id.map(str::to_string))
        .ok_or_else(|| anyhow!("Codex token response did not include a ChatGPT account id"))?;
    let expires_in = response.expires_in.unwrap_or(DEFAULT_EXPIRES_IN_SECS);
    Ok(StoredCodexAuth {
        auth_type: AUTH_TYPE.to_string(),
        access: response.access_token,
        refresh: response.refresh_token,
        expires_at_ms: now_ms().saturating_add(expires_in.saturating_mul(1000)),
        account_id,
    })
}

fn codex_responses_request(
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: &[Message],
    tools: &[ToolDefinition],
) -> Value {
    let (instructions, input) = codex_instructions_and_input(messages);
    let mut request = json!({
        "model": model,
        "input": input,
        "store": false,
        "stream": true,
        "text": {
            "verbosity": "low",
        },
        "tool_choice": "auto",
        "parallel_tool_calls": true,
    });

    if let Some(instructions) = instructions {
        request["instructions"] = Value::String(instructions);
    }

    if !tools.is_empty() {
        request["tools"] = Value::Array(
            tools
                .iter()
                .map(openai_responses_tool_to_value)
                .collect::<Vec<_>>(),
        );
    }

    if let Some(effort) = reasoning_effort {
        request["reasoning"] = json!({
            "effort": effort.as_str(),
        });
        request["include"] = json!(["reasoning.encrypted_content"]);
    }

    request
}

fn codex_instructions_and_input(messages: &[Message]) -> (Option<String>, Vec<Value>) {
    let mut instructions = Vec::new();
    let mut input_messages = Vec::new();

    for message in messages {
        match message {
            Message::System { content } => {
                if !content.trim().is_empty() {
                    instructions.push(content.clone());
                }
            }
            _ => input_messages.push(message.clone()),
        }
    }

    let instructions = if instructions.is_empty() {
        None
    } else {
        Some(instructions.join("\n\n"))
    };
    (instructions, responses_input_items(&input_messages))
}

async fn post_codex_json_with_retry(
    client: &Client,
    url: &str,
    body: &Value,
    auth: &StoredCodexAuth,
) -> std::result::Result<Value, CodexRequestError> {
    let mut last_error = CodexRequestError {
        status: None,
        message: "No attempts made".to_string(),
    };

    for attempt in 0..3 {
        if attempt > 0 {
            let delay_secs = 1u64 << (attempt - 1);
            sleep(Duration::from_secs(delay_secs)).await;
        }

        let response = client
            .post(url)
            .header("Authorization", format!("Bearer {}", auth.access))
            .header("ChatGPT-Account-Id", auth.account_id.as_str())
            .header("originator", ORIGINATOR)
            .header("User-Agent", codex_user_agent())
            .header("OpenAI-Beta", "responses=experimental")
            .header(header::ACCEPT, "text/event-stream")
            .header(header::CONTENT_TYPE, "application/json")
            .json(body)
            .send()
            .await
            .map_err(|error| CodexRequestError {
                status: None,
                message: format!("HTTP request failed for {url}: {error}"),
            })?;

        let status = response.status();
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let response_body = response.text().await.map_err(|error| CodexRequestError {
            status: Some(status),
            message: format!("Failed to read response body from {url}: {error}"),
        })?;

        if status.is_success() {
            return parse_codex_success_body(url, status, content_type.as_deref(), &response_body);
        }

        let error = CodexRequestError {
            status: Some(status),
            message: format!(
                "HTTP {} from {url}: {}",
                status.as_u16(),
                truncate(&response_body)
            ),
        };
        if status == StatusCode::UNAUTHORIZED {
            return Err(error);
        }
        if status.as_u16() == 429 || status.is_server_error() {
            last_error = error;
            continue;
        }
        return Err(error);
    }

    Err(last_error)
}

fn parse_codex_success_body(
    url: &str,
    status: StatusCode,
    content_type: Option<&str>,
    response_body: &str,
) -> std::result::Result<Value, CodexRequestError> {
    if content_type
        .map(|value| value.contains("text/event-stream"))
        .unwrap_or(false)
        || response_body.lines().any(|line| line.starts_with("data:"))
    {
        return parse_codex_sse_response(response_body).map_err(|message| CodexRequestError {
            status: Some(status),
            message: format!(
                "Failed to parse SSE response from {url}: {message}\nBody: {}",
                truncate(response_body)
            ),
        });
    }

    serde_json::from_str::<Value>(response_body).map_err(|error| CodexRequestError {
        status: Some(status),
        message: format!(
            "Failed to parse response from {url}: {error}\nBody: {}",
            truncate(response_body)
        ),
    })
}

fn parse_codex_sse_response(response_body: &str) -> std::result::Result<Value, String> {
    let mut final_response = None;
    let mut output_items: Vec<(usize, Value)> = Vec::new();

    for data in sse_data_payloads(response_body) {
        if data == "[DONE]" {
            continue;
        }

        let event: Value = serde_json::from_str(&data)
            .map_err(|error| format!("invalid SSE JSON event: {error}"))?;
        match event.get("type").and_then(Value::as_str) {
            Some("error") | Some("response.failed") => {
                return Err(codex_event_error_message(&event)
                    .unwrap_or_else(|| format!("Codex error event: {event}")));
            }
            Some("response.output_item.done") => {
                if let Some(item) = event.get("item").cloned() {
                    let output_index = event
                        .get("output_index")
                        .and_then(Value::as_u64)
                        .and_then(|index| usize::try_from(index).ok())
                        .unwrap_or(output_items.len());
                    output_items.retain(|(index, _)| *index != output_index);
                    output_items.push((output_index, item));
                }
            }
            Some("response.completed") | Some("response.done") | Some("response.incomplete") => {
                if let Some(response) = event.get("response").and_then(Value::as_object) {
                    if response.get("status").and_then(Value::as_str) == Some("failed") {
                        return Err(codex_event_error_message(&event)
                            .unwrap_or_else(|| format!("Codex response failed: {event}")));
                    }
                    let mut response_value = Value::Object(response.clone());
                    if response_output_is_empty(&response_value) && !output_items.is_empty() {
                        output_items.sort_by_key(|(index, _)| *index);
                        response_value["output"] = Value::Array(
                            output_items
                                .iter()
                                .map(|(_, item)| item.clone())
                                .collect::<Vec<_>>(),
                        );
                    }
                    final_response = Some(response_value);
                }
            }
            _ => {}
        }
    }

    final_response.ok_or_else(|| "SSE stream did not include a final response event".to_string())
}

fn response_output_is_empty(response: &Value) -> bool {
    response
        .get("output")
        .and_then(Value::as_array)
        .map(Vec::is_empty)
        .unwrap_or(true)
}

fn sse_data_payloads(response_body: &str) -> Vec<String> {
    let mut payloads = Vec::new();
    let mut current = String::new();

    for line in response_body.lines() {
        if let Some(data) = line.strip_prefix("data:") {
            if !current.is_empty() {
                current.push('\n');
            }
            current.push_str(data.trim_start());
        } else if line.trim().is_empty() && !current.is_empty() {
            payloads.push(std::mem::take(&mut current));
        }
    }

    if !current.is_empty() {
        payloads.push(current);
    }

    payloads
}

fn codex_event_error_message(event: &Value) -> Option<String> {
    event
        .get("response")
        .and_then(|response| response.get("error"))
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str)
        })
        .or_else(|| event.get("message").and_then(Value::as_str))
        .filter(|message| !message.is_empty())
        .map(str::to_string)
}

fn codex_responses_url(base_url: &str) -> Result<String> {
    validate_base_url(base_url)?;
    Ok(CODEX_RESPONSES_URL.to_string())
}

fn auth_file_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("auth.json"))
        .ok_or_else(|| anyhow!("could not determine NAC_HOME or HOME for Codex auth storage"))
}

fn auth_lock_path() -> Result<PathBuf> {
    Ok(auth_file_path()?.with_extension("auth.json.lock"))
}

fn acquire_auth_lock() -> Result<FileLock> {
    let path = auth_lock_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    FileLock::acquire(&path)
}

fn with_auth_lock<T>(operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let lock = acquire_auth_lock()?;
    let result = operation();
    drop(lock);
    result
}

fn read_auth_file_optional() -> Result<Option<StoredCodexAuth>> {
    read_auth_file_optional_from_path(&auth_file_path()?)
}

fn read_auth_file_optional_for_status() -> Result<Option<StoredCodexAuth>> {
    read_auth_file_optional_from_path_with_policy(&auth_file_path()?, true)
}

fn read_auth_file_optional_from_path(path: &Path) -> Result<Option<StoredCodexAuth>> {
    read_auth_file_optional_from_path_with_policy(path, false)
}

fn read_auth_file_optional_from_path_with_policy(
    path: &Path,
    foreign_provider_is_missing: bool,
) -> Result<Option<StoredCodexAuth>> {
    let raw = match read_auth_bytes_from_path(path)? {
        Some(raw) => raw,
        None => return Ok(None),
    };
    let raw = String::from_utf8(raw).map_err(|_| {
        stored_auth_configuration_error(format!(
            "Codex credential file {} is not valid UTF-8",
            path.display()
        ))
    })?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| {
        stored_auth_configuration_error(format!(
            "failed to parse Codex credentials in {}",
            path.display()
        ))
    })?;
    let provider = value.get("type").and_then(Value::as_str);
    if provider != Some(AUTH_TYPE) {
        if foreign_provider_is_missing {
            return Ok(None);
        }
        return Err(stored_auth_configuration_error(format!(
            "Codex credentials in {} have an invalid or unsupported provider type",
            path.display()
        )));
    }
    let auth: StoredCodexAuth = serde_json::from_value(value).map_err(|_| {
        stored_auth_configuration_error(format!(
            "Codex credentials in {} do not match the required schema",
            path.display()
        ))
    })?;
    validate_stored_auth(&auth, path)?;
    Ok(Some(auth))
}

fn validate_stored_auth(auth: &StoredCodexAuth, path: &Path) -> Result<()> {
    for (field, value) in [
        ("access", auth.access.as_str()),
        ("refresh", auth.refresh.as_str()),
        ("account_id", auth.account_id.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(stored_auth_configuration_error(format!(
                "Codex credentials in {} require nonblank field '{}'",
                path.display(),
                field
            )));
        }
    }
    Ok(())
}

fn read_auth_bytes_from_path(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(anyhow!(
                "refusing to read symlink credential path {}",
                path.display()
            ))
        }
        Ok(metadata) if !metadata.file_type().is_file() => {
            return Err(anyhow!(
                "refusing to read non-regular credential path {}",
                path.display()
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", path.display()))
        }
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK);
    }
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("failed to securely open credential file {}", path.display())
            })
        }
    };
    ensure_open_file_is_regular(&file, path, "credential file")?;

    let mut raw = Vec::new();
    file.read_to_end(&mut raw)
        .with_context(|| format!("failed to read credential file {}", path.display()))?;
    Ok(Some(raw))
}

fn read_auth_file() -> Result<StoredCodexAuth> {
    read_auth_file_optional()?.ok_or_else(|| {
        stored_auth_configuration_error(
            "Codex auth is not configured. Run `nac codex-auth` to sign in with ChatGPT.",
        )
    })
}

fn write_auth_file(auth: &StoredCodexAuth) -> Result<()> {
    let path = auth_file_path()?;
    validate_stored_auth(auth, &path)?;
    write_auth_file_to_path(&path, auth)
}

fn write_auth_file_to_path(path: &Path, auth: &StoredCodexAuth) -> Result<()> {
    let raw = serde_json::to_string_pretty(auth).context("failed to serialize Codex auth")?;
    atomic_replace_auth_file(path, |file| file.write_all(raw.as_bytes()))
}

fn atomic_replace_auth_file(
    path: &Path,
    write_contents: impl FnOnce(&mut File) -> io::Result<()>,
) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| anyhow!("auth path {} has no parent directory", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("failed to create {}", parent.display()))?;
    validate_regular_destination(path)?;

    let file_name = path
        .file_name()
        .ok_or_else(|| anyhow!("auth path {} has no file name", path.display()))?
        .to_string_lossy();
    let temp_path = parent.join(format!(".{file_name}.tmp-{}", Uuid::new_v4().simple()));
    let mut temp = open_private_temp_file(&temp_path)?;
    let mut cleanup = TempFileCleanup::new(temp_path.clone());
    let write_result = (|| -> Result<()> {
        make_file_private(&temp, &temp_path)?;
        ensure_open_file_is_regular(&temp, &temp_path, "temporary auth file")?;
        write_contents(&mut temp).with_context(|| {
            format!(
                "failed to write temporary auth file {}",
                temp_path.display()
            )
        })?;
        temp.flush().with_context(|| {
            format!(
                "failed to flush temporary auth file {}",
                temp_path.display()
            )
        })?;
        temp.sync_all().with_context(|| {
            format!("failed to sync temporary auth file {}", temp_path.display())
        })?;
        Ok(())
    })();
    drop(temp);
    write_result?;

    // Check again immediately before rename. On Unix, rename replaces a final
    // component rather than following it, so a racing symlink cannot modify its target.
    validate_regular_destination(path)?;
    fs::rename(&temp_path, path).with_context(|| {
        format!(
            "failed to atomically replace {} with {}",
            path.display(),
            temp_path.display()
        )
    })?;
    cleanup.disarm();
    sync_parent_directory(parent)
        .with_context(|| format!("failed to sync auth directory {}", parent.display()))?;
    Ok(())
}

fn validate_regular_destination(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(metadata) if metadata.file_type().is_symlink() => Err(anyhow!(
            "refusing to replace symlink credential destination {}",
            path.display()
        )),
        Ok(_) => Err(anyhow!(
            "refusing to replace non-regular credential destination {}",
            path.display()
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {}", path.display())),
    }
}

fn open_private_temp_file(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    options
        .open(path)
        .with_context(|| format!("failed to create temporary auth file {}", path.display()))
}

#[cfg(unix)]
fn make_file_private(file: &File, path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .with_context(|| format!("failed to chmod {}", path.display()))
}

#[cfg(not(unix))]
fn make_file_private(_file: &File, _path: &Path) -> Result<()> {
    Ok(())
}

fn ensure_open_file_is_regular(file: &File, path: &Path, kind: &str) -> Result<()> {
    let metadata = file
        .metadata()
        .with_context(|| format!("failed to inspect open {kind} {}", path.display()))?;
    if metadata.file_type().is_file() {
        Ok(())
    } else {
        Err(anyhow!(
            "refusing to use non-regular {kind} {}",
            path.display()
        ))
    }
}

#[cfg(unix)]
fn sync_parent_directory(parent: &Path) -> io::Result<()> {
    File::open(parent)?.sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_parent: &Path) -> io::Result<()> {
    Ok(())
}

struct TempFileCleanup {
    path: PathBuf,
    armed: bool,
}

impl TempFileCleanup {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for TempFileCleanup {
    fn drop(&mut self) {
        if self.armed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

struct FileLock {
    file: File,
}

impl FileLock {
    fn acquire(path: &Path) -> Result<Self> {
        validate_lock_destination(path)?;
        let mut options = OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        let file = options
            .open(path)
            .with_context(|| format!("failed to open auth lock {}", path.display()))?;
        ensure_open_file_is_regular(&file, path, "auth lock")?;
        make_file_private(&file, path)?;
        lock_file(&file).with_context(|| format!("failed to lock {}", path.display()))?;
        Ok(Self { file })
    }
}

fn validate_lock_destination(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(metadata) if metadata.file_type().is_symlink() => Err(anyhow!(
            "refusing to use symlink auth lock {}",
            path.display()
        )),
        Ok(_) => Err(anyhow!(
            "refusing to use non-regular auth lock {}",
            path.display()
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("failed to inspect auth lock {}", path.display()))
        }
    }
}

impl Drop for FileLock {
    fn drop(&mut self) {
        let _ = unlock_file(&self.file);
    }
}

#[cfg(unix)]
fn lock_file(file: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(unix)]
fn unlock_file(file: &File) -> io::Result<()> {
    use std::os::unix::io::AsRawFd;
    let result = unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_UN) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn lock_file(_file: &File) -> io::Result<()> {
    Ok(())
}

#[cfg(not(unix))]
fn unlock_file(_file: &File) -> io::Result<()> {
    Ok(())
}

fn extract_account_id(token: &str) -> Option<String> {
    let payload = decode_jwt_payload(token)?;
    payload
        .get("https://api.openai.com/auth")
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .or_else(|| payload.get("chatgpt_account_id").and_then(Value::as_str))
        .or_else(|| {
            payload
                .get("organizations")
                .and_then(Value::as_array)
                .and_then(|orgs| orgs.first())
                .and_then(|org| org.get("id"))
                .and_then(Value::as_str)
        })
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload = parts.next()?;
    let _signature = parts.next()?;
    let bytes = base64_url_decode(payload)?;
    serde_json::from_slice(&bytes).ok()
}

fn base64_url_decode(input: &str) -> Option<Vec<u8>> {
    let mut bits = 0u32;
    let mut bit_count = 0u8;
    let mut out = Vec::with_capacity(input.len() * 3 / 4);

    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            _ => return None,
        } as u32;
        bits = (bits << 6) | value;
        bit_count += 6;
        while bit_count >= 8 {
            bit_count -= 8;
            out.push(((bits >> bit_count) & 0xff) as u8);
        }
    }

    Some(out)
}

fn interval_secs(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(number)) => number.as_u64(),
        Some(Value::String(text)) => text.parse().ok(),
        _ => None,
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn expiry_status(expires_at_ms: u64) -> String {
    let now = now_ms();
    if expires_at_ms <= now {
        let seconds = now.saturating_sub(expires_at_ms) / 1000;
        format!("expired {seconds}s ago")
    } else {
        let seconds = expires_at_ms.saturating_sub(now) / 1000;
        format!("in {}s", seconds)
    }
}

fn codex_user_agent() -> String {
    format!("nac/{}", env!("CARGO_PKG_VERSION"))
}

fn truncate(value: &str) -> String {
    value.chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use std::io::{Read, Seek, SeekFrom};
    #[cfg(unix)]
    use std::os::unix::fs::{symlink, PermissionsExt};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "nac-codex-auth-{label}-{}",
                Uuid::new_v4().simple()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }

        fn assert_no_temp_files(&self) {
            let names = fs::read_dir(&self.0)
                .unwrap()
                .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
                .filter(|name| name.contains(".tmp-"))
                .collect::<Vec<_>>();
            assert!(names.is_empty(), "temporary files remain: {names:?}");
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn stored_codex_auth(access: &str) -> StoredCodexAuth {
        StoredCodexAuth {
            auth_type: AUTH_TYPE.to_string(),
            access: access.to_string(),
            refresh: "refresh-token".to_string(),
            expires_at_ms: 123_456,
            account_id: "account-1".to_string(),
        }
    }

    #[test]
    fn codex_secure_read_rejects_invalid_provider_schema_and_blank_fields() {
        let dir = TestDir::new("read-invalid-content");
        let path = dir.path("auth.json");
        for invalid in [
            r#"{"type":"other","access":"a","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
            r#"{"type":"chatgpt-codex","access":7}"#,
            r#"{"type":"chatgpt-codex","access":" ","refresh":"r","expires_at_ms":1,"account_id":"id"}"#,
            r#"{"type":"chatgpt-codex","access":"a","refresh":"\t","expires_at_ms":1,"account_id":"id"}"#,
            r#"{"type":"chatgpt-codex","access":"a","refresh":"r","expires_at_ms":1,"account_id":""}"#,
        ] {
            fs::write(&path, invalid).unwrap();
            let error = read_auth_file_optional_from_path(&path).unwrap_err();
            assert!(
                error
                    .downcast_ref::<StoredCodexAuthConfigurationError>()
                    .is_some(),
                "content error was not typed: {error:#}"
            );
            assert!(!error.to_string().contains("access-test"));
        }
    }

    #[test]
    fn codex_secure_read_accepts_valid_regular_file() {
        let dir = TestDir::new("read-regular");
        let path = dir.path("auth.json");
        write_auth_file_to_path(&path, &stored_codex_auth("regular-access")).unwrap();

        let auth = read_auth_file_optional_from_path(&path).unwrap().unwrap();

        assert_eq!(auth.access, "regular-access");
        assert_eq!(auth.refresh, "refresh-token");
    }

    #[test]
    fn codex_secure_read_rejects_non_regular_path() {
        let dir = TestDir::new("read-directory");
        let path = dir.path("auth.json");
        fs::create_dir(&path).unwrap();

        let error = read_auth_file_optional_from_path(&path).unwrap_err();

        assert!(error.to_string().contains("non-regular credential path"));
    }

    #[cfg(unix)]
    #[test]
    fn codex_secure_read_rejects_symlink_without_reading_target() {
        let dir = TestDir::new("read-symlink");
        let target = dir.path("target.json");
        let path = dir.path("auth.json");
        write_auth_file_to_path(&target, &stored_codex_auth("target-access")).unwrap();
        let target_before = fs::read(&target).unwrap();
        symlink(&target, &path).unwrap();

        let error = read_auth_file_optional_from_path(&path).unwrap_err();

        assert!(error.to_string().contains("symlink credential path"));
        assert_eq!(fs::read(&target).unwrap(), target_before);
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[cfg(unix)]
    #[test]
    fn codex_atomic_write_creates_mode_0600_and_replaces_by_rename() {
        let dir = TestDir::new("replace");
        let path = dir.path("auth.json");
        fs::write(&path, "old-valid-content").unwrap();
        let mut old_file = File::open(&path).unwrap();

        write_auth_file_to_path(&path, &stored_codex_auth("new-access")).unwrap();

        let current: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(current["access"], "new-access");
        let mut old_contents = String::new();
        old_file.seek(SeekFrom::Start(0)).unwrap();
        old_file.read_to_string(&mut old_contents).unwrap();
        assert_eq!(old_contents, "old-valid-content");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        dir.assert_no_temp_files();
    }

    #[cfg(unix)]
    #[test]
    fn codex_pre_rename_failure_preserves_existing_file_and_cleans_temp() {
        let dir = TestDir::new("failure");
        let path = dir.path("auth.json");
        fs::write(&path, "old-valid-content").unwrap();

        let result = atomic_replace_auth_file(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("injected pre-rename failure"))
        });

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "old-valid-content");
        dir.assert_no_temp_files();
    }

    #[cfg(unix)]
    #[test]
    fn codex_write_rejects_symlink_destination_without_touching_target() {
        let dir = TestDir::new("symlink");
        let target = dir.path("target.json");
        let destination = dir.path("auth.json");
        fs::write(&target, "target-valid-content").unwrap();
        symlink(&target, &destination).unwrap();

        let error =
            write_auth_file_to_path(&destination, &stored_codex_auth("replacement")).unwrap_err();

        assert!(error.to_string().contains("symlink credential destination"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "target-valid-content");
        assert!(fs::symlink_metadata(&destination)
            .unwrap()
            .file_type()
            .is_symlink());
        dir.assert_no_temp_files();
    }

    #[cfg(unix)]
    #[test]
    fn codex_lock_is_private_and_rejects_symlink() {
        let dir = TestDir::new("lock");
        let lock_path = dir.path("auth.auth.json.lock");
        let lock = FileLock::acquire(&lock_path).unwrap();
        assert_eq!(
            fs::metadata(&lock_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        drop(lock);

        fs::remove_file(&lock_path).unwrap();
        let target = dir.path("lock-target");
        fs::write(&target, "unchanged").unwrap();
        symlink(&target, &lock_path).unwrap();
        let error = FileLock::acquire(&lock_path)
            .err()
            .expect("symlink lock accepted");
        assert!(error.to_string().contains("symlink auth lock"));
        assert_eq!(fs::read_to_string(target).unwrap(), "unchanged");
    }

    #[test]
    fn codex_logout_removes_malformed_auth_and_preserves_arcee() {
        let dir = TestDir::new("logout-malformed");
        let codex_path = dir.path("auth.json");
        let arcee_path = dir.path("arcee_auth.json");
        let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
        fs::write(&codex_path, "{ malformed").unwrap();
        fs::write(&arcee_path, arcee).unwrap();

        assert!(remove_codex_auth_file_for_logout(&codex_path).unwrap());

        assert!(!codex_path.exists());
        assert_eq!(fs::read_to_string(arcee_path).unwrap(), arcee);
    }

    #[test]
    fn codex_logout_preserves_coexisting_arcee_auth() {
        let dir = TestDir::new("logout-coexistence");
        let codex_path = dir.path("auth.json");
        let arcee_path = dir.path("arcee_auth.json");
        let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
        fs::write(&arcee_path, arcee).unwrap();
        write_auth_file_to_path(&codex_path, &stored_codex_auth("access-token")).unwrap();

        assert!(remove_codex_auth_file_for_logout(&codex_path).unwrap());

        assert!(!codex_path.exists());
        assert_eq!(fs::read_to_string(arcee_path).unwrap(), arcee);
    }

    #[test]
    fn codex_logout_is_idempotent_when_auth_is_missing() {
        let dir = TestDir::new("logout-missing");
        let path = dir.path("auth.json");

        assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
        assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
    }

    #[test]
    fn codex_logout_removes_typed_malformed_codex_auth() {
        let dir = TestDir::new("logout-typed-codex");
        let path = dir.path("auth.json");
        fs::write(&path, r#"{"type":"chatgpt-codex","access":7}"#).unwrap();

        assert!(remove_codex_auth_file_for_logout(&path).unwrap());
        assert!(!path.exists());
    }

    #[test]
    fn codex_logout_preserves_valid_foreign_and_unknown_records() {
        let dir = TestDir::new("logout-foreign");
        let path = dir.path("auth.json");
        let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
        fs::write(&path, arcee).unwrap();
        assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
        assert_eq!(fs::read_to_string(&path).unwrap(), arcee);

        let unknown = r#"{"type":"future-provider","token":"keep-me"}"#;
        fs::write(&path, unknown).unwrap();
        assert!(!remove_codex_auth_file_for_logout(&path).unwrap());
        assert_eq!(fs::read_to_string(path).unwrap(), unknown);
    }

    #[cfg(unix)]
    #[test]
    fn codex_logout_unlinks_symlink_without_touching_target() {
        let dir = TestDir::new("logout-symlink");
        let target = dir.path("target.json");
        let path = dir.path("auth.json");
        fs::write(&target, "target-credentials").unwrap();
        symlink(&target, &path).unwrap();

        assert!(remove_codex_auth_file_for_logout(&path).unwrap());

        assert!(fs::symlink_metadata(&path).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "target-credentials");
    }

    #[test]
    fn codex_endpoint_matrix_accepts_only_canonical_chatgpt_base() {
        for accepted in [
            "https://chatgpt.com/backend-api",
            "https://chatgpt.com/backend-api/",
            "https://chatgpt.com:443/backend-api",
        ] {
            let parsed = validate_base_url(accepted)
                .unwrap_or_else(|error| panic!("rejected {accepted}: {error:#}"));
            assert_eq!(parsed.host_str(), Some("chatgpt.com"));
            assert_eq!(parsed.port_or_known_default(), Some(443));
            assert_eq!(codex_responses_url(accepted).unwrap(), CODEX_RESPONSES_URL);
        }

        for rejected in [
            "http://chatgpt.com/backend-api",
            "https://chatgpt.com:444/backend-api",
            "https://api.chatgpt.com/backend-api",
            "https://chatgpt.com.evil.example/backend-api",
            "https://chatgpt.com/",
            "https://chatgpt.com/backend-api/codex",
            "https://chatgpt.com/backend-api/codex/responses",
            "https://chatgpt.com/backend-api?next=https://evil.example",
            "https://chatgpt.com/backend-api#fragment",
            "https://user@chatgpt.com/backend-api",
            "https://chatgpt.com/%62ackend-api",
        ] {
            assert!(
                validate_base_url(rejected).is_err(),
                "accepted unapproved Codex base {rejected}"
            );
        }
    }

    #[tokio::test]
    async fn codex_model_http_client_does_not_follow_or_replay_redirects() {
        use crate::model::test_http::{ScriptedResponse, ScriptedServer};
        use std::net::TcpListener;

        let destination = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        destination.set_nonblocking(true).unwrap();
        let destination_url = format!("http://{}", destination.local_addr().unwrap());
        let source = ScriptedServer::start(vec![ScriptedResponse::redirect(
            "307 Temporary Redirect",
            format!("{destination_url}/capture"),
            "blocked",
        )]);
        let secret = "codex-secret-must-not-replay";

        let response = no_redirect_client()
            .unwrap()
            .post(format!("{}/backend-api/codex/responses", source.base_url))
            .bearer_auth(secret)
            .body("prompt-must-not-replay")
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::TEMPORARY_REDIRECT);
        let requests = source.finish();
        assert_eq!(requests.len(), 1);
        assert_eq!(
            requests[0].headers.get("authorization").map(String::as_str),
            Some("Bearer codex-secret-must-not-replay")
        );
        assert_eq!(requests[0].body, b"prompt-must-not-replay");
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            destination.accept().is_err(),
            "redirect destination received replay"
        );
    }

    #[test]
    fn extracts_account_id_from_nested_jwt_claim() {
        let token = concat!(
            "e30.",
            "eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOns",
            "iY2hhdGdwdF9hY2NvdW50X2lkIjoid29ya3NwYWNlLTEyMyJ9fQ.",
            "sig"
        );

        assert_eq!(extract_account_id(token).as_deref(), Some("workspace-123"));
    }

    #[test]
    fn codex_request_reasoning_is_driven_only_by_explicit_effort() {
        let messages = [
            Message::System {
                content: "system instructions".to_string(),
            },
            Message::User {
                content: "hello".to_string(),
            },
        ];
        let absent = codex_responses_request("gpt-5.5", None, &messages, &[]);
        assert_eq!(absent["model"], "gpt-5.5");
        assert_eq!(absent["instructions"], "system instructions");
        assert_eq!(absent["store"], false);
        assert_eq!(absent["stream"], true);
        assert_eq!(absent["text"]["verbosity"], "low");
        assert!(absent.get("reasoning").is_none());
        assert!(absent.get("include").is_none());

        for effort in [
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ] {
            let request = codex_responses_request("gpt-5.5", Some(effort), &messages, &[]);
            assert_eq!(request["reasoning"]["effort"], effort.as_str());
            assert_eq!(request["include"][0], "reasoning.encrypted_content");
        }
    }

    #[test]
    fn parses_codex_sse_final_response() {
        let body = concat!(
            "event: response.output_item.done\n",
            "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hello\"}]}}\n\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"total_tokens\":3}}}\n\n",
            "data: [DONE]\n\n"
        );

        let parsed = parse_codex_sse_response(body).unwrap();
        assert_eq!(parsed["status"], "completed");
        assert_eq!(parsed["output"][0]["type"], "message");
        assert_eq!(parsed["output"][0]["content"][0]["text"], "hello");
        assert_eq!(parsed["usage"]["total_tokens"], 3);
    }
}
