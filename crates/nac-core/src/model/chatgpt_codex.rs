use super::*;
use anyhow::Context;
use reqwest::header;
use reqwest::StatusCode;
use serde::Deserialize;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_USER_CODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const DEFAULT_CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api";
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
    let removed = with_auth_lock(|| match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    })?;

    if removed {
        println!("Codex auth removed.");
    } else {
        println!("No Codex auth found.");
    }
    println!("path: {}", path.display());
    Ok(())
}

pub fn codex_auth_status() -> Result<()> {
    let path = auth_file_path()?;
    let auth = with_auth_lock(read_auth_file_optional)?;
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
    let url = codex_responses_url(base_url);
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

fn codex_responses_url(base_url: &str) -> String {
    let raw = if base_url.trim().is_empty() {
        DEFAULT_CODEX_BASE_URL
    } else {
        base_url.trim()
    };
    let normalized = raw.trim_end_matches('/');
    if normalized.ends_with("/codex/responses") {
        normalized.to_string()
    } else if normalized.ends_with("/codex") {
        format!("{normalized}/responses")
    } else {
        format!("{normalized}/codex/responses")
    }
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
    let path = auth_file_path()?;
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", path.display()))
        }
    };
    let auth: StoredCodexAuth = serde_json::from_str(&raw)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    if auth.auth_type != AUTH_TYPE {
        return Err(anyhow!(
            "{} contains unsupported auth type '{}'",
            path.display(),
            auth.auth_type
        ));
    }
    Ok(Some(auth))
}

fn read_auth_file() -> Result<StoredCodexAuth> {
    read_auth_file_optional()?.ok_or_else(|| {
        anyhow!("Codex auth is not configured. Run `nac codex-auth` to sign in with ChatGPT.")
    })
}

fn write_auth_file(auth: &StoredCodexAuth) -> Result<()> {
    let path = auth_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(auth).context("failed to serialize Codex auth")?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .with_context(|| format!("failed to open {}", path.display()))?;
    use std::io::Write;
    file.write_all(raw.as_bytes())
        .with_context(|| format!("failed to write {}", path.display()))?;
    file.flush()
        .with_context(|| format!("failed to flush {}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to chmod {}", path.display()))?;
    }
    Ok(())
}

struct FileLock {
    file: File,
}

impl FileLock {
    fn acquire(path: &Path) -> Result<Self> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .with_context(|| format!("failed to open auth lock {}", path.display()))?;
        lock_file(&file).with_context(|| format!("failed to lock {}", path.display()))?;
        Ok(Self { file })
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

    #[test]
    fn resolves_codex_responses_urls() {
        assert_eq!(
            codex_responses_url("https://chatgpt.com/backend-api"),
            "https://chatgpt.com/backend-api/codex/responses"
        );
        assert_eq!(
            codex_responses_url("https://chatgpt.com/backend-api/codex"),
            "https://chatgpt.com/backend-api/codex/responses"
        );
        assert_eq!(
            codex_responses_url("https://chatgpt.com/backend-api/codex/responses"),
            "https://chatgpt.com/backend-api/codex/responses"
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
    fn builds_codex_responses_stream_request() {
        let request = codex_responses_request(
            "gpt-5.5",
            Some(ReasoningEffort::High),
            &[
                Message::System {
                    content: "system instructions".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
                },
            ],
            &[],
        );

        assert_eq!(request["model"], "gpt-5.5");
        assert_eq!(request["instructions"], "system instructions");
        assert_eq!(request["store"], false);
        assert_eq!(request["stream"], true);
        assert_eq!(request["text"]["verbosity"], "low");
        assert_eq!(request["tool_choice"], "auto");
        assert_eq!(request["parallel_tool_calls"], true);
        assert_eq!(request["reasoning"]["effort"], "high");
        assert_eq!(request["include"][0], "reasoning.encrypted_content");
        assert_eq!(request["input"].as_array().unwrap().len(), 1);
        assert_eq!(request["input"][0]["role"], "user");
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
