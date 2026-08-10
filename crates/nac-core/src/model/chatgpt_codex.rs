use super::auth_store::ensure_open_credential_file_is_safe;
use super::responses_stream::ResponsesStreamFold;
use super::sse::{read_sse_response, StreamFold};
use super::*;
use anyhow::Context;
use fs2::FileExt;
use reqwest::header;
use reqwest::StatusCode;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use url::form_urlencoded;
use uuid::Uuid;

const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_USER_CODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_RESPONSES_URL: &str = "https://chatgpt.com/backend-api/codex/responses";
const ORIGINATOR: &str = "nac";
const AUTH_TYPE: &str = "chatgpt-codex";
const DEFAULT_EXPIRES_IN_SECS: u64 = 3600;
const REFRESH_SKEW_MS: u64 = 60_000;
const DEVICE_TIMEOUT_SECS: u64 = 15 * 60;

/// The only loopback address OpenAI will redirect this client back to, so the
/// port cannot be chosen freely and a second login cannot run alongside a first.
const LOOPBACK_ADDR: &str = "127.0.0.1:1455";
const LOOPBACK_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const LOOPBACK_TIMEOUT_SECS: u64 = 10 * 60;

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
/// access failures intentionally remain untyped operational errors. Unsafe Unix
/// permissions use a shared actionable safety marker in `auth_store`.
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

/// Whether a stored Codex credential exists and parses (the `/models`
/// auth-status check; any read/parse/permission failure reads as absent,
/// as does a foreign-provider credential file — the status read path's
/// existing policy).
pub(super) fn stored_credential_present() -> bool {
    matches!(read_auth_file_optional_for_status(), Ok(Some(_)))
}

pub(super) fn preflight_stored_auth() -> Result<()> {
    let _lock = acquire_auth_lock()?;
    read_auth_file().map(|_| ())
}

/// A Codex device login that has been issued a code and is waiting for the
/// user to approve it.
pub(super) struct CodexDeviceLogin {
    client: Client,
    device: DeviceCode,
}

impl CodexDeviceLogin {
    pub(super) fn prompt(&self) -> DeviceLoginPrompt {
        DeviceLoginPrompt {
            // Codex serves one verification page for everyone and expects the
            // code to be typed into it, so the URL carries no code of its own.
            verification_uri: DEVICE_VERIFICATION_URL.to_string(),
            user_code: Some(self.device.user_code.clone()),
            expires_in_secs: DEVICE_TIMEOUT_SECS,
        }
    }

    pub(super) async fn complete(self) -> Result<ManagedAuthSnapshot> {
        let code = poll_device_code(&self.client, &self.device).await?;
        let tokens = exchange_authorization_code(&self.client, &code, DEVICE_REDIRECT_URI).await?;
        store_tokens(tokens)
    }
}

pub(super) async fn begin_codex_device_login() -> Result<CodexDeviceLogin> {
    let client = Client::new();
    let device = request_device_code(&client).await?;
    Ok(CodexDeviceLogin { client, device })
}

/// A Codex login waiting for the browser to be sent back to this machine.
///
/// Nothing has to be read off the screen or typed: the authorization arrives on
/// the loopback port as a redirect. The cost is that the browser has to be able
/// to reach that port, which only holds when it runs on the same machine.
pub(super) struct CodexLoopbackLogin {
    client: Client,
    listener: TcpListener,
    /// Proves this process started the authorization it is redeeming.
    verifier: String,
    /// Ties the redirect that arrives back to the one that was requested.
    state: String,
}

impl CodexLoopbackLogin {
    pub(super) fn prompt(&self) -> DeviceLoginPrompt {
        let challenge = pkce_challenge(&self.verifier);
        let query = form_urlencoded::Serializer::new(String::new())
            .append_pair("response_type", "code")
            .append_pair("client_id", CLIENT_ID)
            .append_pair("redirect_uri", LOOPBACK_REDIRECT_URI)
            .append_pair("scope", "openid profile email offline_access")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("id_token_add_organizations", "true")
            .append_pair("codex_cli_simplified_flow", "true")
            .append_pair("state", &self.state)
            .finish();

        DeviceLoginPrompt {
            verification_uri: format!("{AUTHORIZE_URL}?{query}"),
            // The whole point of this flow is that there is no code to confirm.
            user_code: None,
            expires_in_secs: LOOPBACK_TIMEOUT_SECS,
        }
    }

    pub(super) async fn complete(self) -> Result<ManagedAuthSnapshot> {
        let (code, mut stream) = wait_for_loopback_redirect(&self.listener, &self.state).await?;
        // The browser is held until the tokens are actually in hand, so the tab
        // never claims success for a sign-in that then failed.
        let exchanged = exchange_authorization_code(
            &self.client,
            &AuthorizationCode {
                code,
                verifier: self.verifier,
            },
            LOOPBACK_REDIRECT_URI,
        )
        .await;
        let page = match &exchanged {
            Ok(_) => LOOPBACK_DONE_PAGE,
            Err(_) => LOOPBACK_FAILED_PAGE,
        };
        write_loopback_response(&mut stream, StatusCode::OK, page).await;
        store_tokens(exchanged?)
    }
}

/// Claims the loopback port before the browser is sent anywhere, so a port that
/// is already taken fails now rather than after the user has approved.
pub(super) async fn begin_codex_loopback_login() -> Result<CodexLoopbackLogin> {
    let listener = TcpListener::bind(LOOPBACK_ADDR).await.map_err(|error| {
        anyhow!("could not listen on {LOOPBACK_ADDR} for the Codex sign-in redirect: {error}")
    })?;
    Ok(CodexLoopbackLogin {
        client: Client::new(),
        listener,
        verifier: random_url_safe_token(),
        state: random_url_safe_token(),
    })
}

fn store_tokens(tokens: TokenResponse) -> Result<ManagedAuthSnapshot> {
    let auth = auth_from_token_response(tokens, None)?;
    with_auth_lock(|| write_auth_file(&auth))?;
    Ok(snapshot_from_stored(Some(auth), auth_file_path()?))
}

pub(super) fn codex_auth_snapshot() -> Result<ManagedAuthSnapshot> {
    let path = auth_file_path()?;
    Ok(snapshot_from_stored(
        read_auth_file_optional_for_status()?,
        path,
    ))
}

fn snapshot_from_stored(auth: Option<StoredCodexAuth>, path: PathBuf) -> ManagedAuthSnapshot {
    ManagedAuthSnapshot {
        provider: ManagedAuthProvider::Codex,
        signed_in: auth.is_some(),
        account: auth.as_ref().map(|auth| auth.account_id.clone()),
        organization: None,
        // Codex only ever talks to its own origin, so there is nothing per-login
        // to report here the way there is for Arcee.
        base_url: None,
        expires_at_ms: auth.as_ref().map(|auth| auth.expires_at_ms),
        path: path.display().to_string(),
    }
}

pub(super) fn codex_auth_remove() -> Result<bool> {
    let path = auth_file_path()?;
    with_auth_lock(|| {
        if auth_path_is_symlink(&path)? {
            return remove_auth_path(&path);
        }
        remove_codex_auth_file_for_logout(&path)
    })
}

/// Signs in from the terminal, which always uses the device flow.
///
/// The redirect flow would need the browser to reach a port on this machine,
/// and a terminal cannot tell whether it has one: over SSH the port binds
/// perfectly well and the redirect still lands on the wrong computer. The
/// served UI has a way to know, and uses it there.
pub async fn codex_auth_login() -> Result<()> {
    let login = begin_codex_device_login().await?;
    let prompt = login.prompt();

    println!("Open this URL in a browser:");
    println!("{}", prompt.verification_uri);
    if let Some(code) = &prompt.user_code {
        println!();
        println!("Enter this code:");
        println!("{code}");
    }
    println!();
    println!("Waiting for authorization...");

    let snapshot = login.complete().await?;

    println!("Codex auth saved.");
    println!("account: {}", snapshot.account.unwrap_or_default());
    println!("path: {}", snapshot.path);

    Ok(())
}

pub fn codex_auth_logout() -> Result<()> {
    let path = auth_file_path()?;
    let removed = codex_auth_remove()?;

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
    let snapshot = codex_auth_snapshot()?;
    if snapshot.signed_in {
        println!("Codex auth: signed in");
        println!("account: {}", snapshot.account.unwrap_or_default());
        println!(
            "expires: {}",
            expiry_status(snapshot.expires_at_ms.unwrap_or_default())
        );
    } else {
        println!("Codex auth: not signed in");
    }
    println!("path: {}", snapshot.path);
    Ok(())
}

pub async fn send_responses(
    client: &Client,
    base_url: &str,
    model: &str,
    reasoning_effort: Option<ReasoningEffort>,
    messages: Vec<Message>,
    tools: Vec<ToolDefinition>,
    thinking_levels: &ThinkingLevelMap,
    on_delta: DeltaSink<'_>,
) -> Result<ModelTurnResponse> {
    let url = codex_responses_url(base_url)?;
    let request =
        codex_responses_request(model, reasoning_effort, &messages, &tools, thinking_levels);
    let auth = fresh_auth(client).await?;

    match post_codex_json_with_retry(client, &url, &request, &auth, on_delta).await {
        Ok(value) => parse_openai_responses_response(&value, &url),
        Err(error) if error.status == Some(StatusCode::UNAUTHORIZED) => {
            let refreshed = force_refresh_auth(client).await?;
            let value = post_codex_json_with_retry(client, &url, &request, &refreshed, on_delta)
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

/// What the browser is left looking at once the sign-in has been settled.
const LOOPBACK_DONE_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Signed in</title></head><body style=\"font-family:system-ui;padding:3rem;text-align:center\"><h1>Signed in to Codex</h1><p>You can close this tab and return to nac.</p></body></html>";
const LOOPBACK_FAILED_PAGE: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign-in failed</title></head><body style=\"font-family:system-ui;padding:3rem;text-align:center\"><h1>Codex sign-in failed</h1><p>Return to nac for the reason.</p></body></html>";

/// Waits for the browser to come back to the loopback port with an
/// authorization, handing back the connection it arrived on so the caller can
/// answer once it knows whether the sign-in actually worked.
///
/// Anything else that connects — a port probe, a favicon request, a stale tab —
/// is turned away and then ignored, because the redirect that matters may still
/// be on its way.
async fn wait_for_loopback_redirect(
    listener: &TcpListener,
    state: &str,
) -> Result<(String, TcpStream)> {
    let wait = async {
        loop {
            let (mut stream, _) = listener
                .accept()
                .await
                .context("failed to accept the Codex sign-in redirect")?;
            let Some(target) = read_request_target(&mut stream).await else {
                continue;
            };
            match authorization_from_target(&target, state) {
                Some(Ok(code)) => return Ok((code, stream)),
                Some(Err(error)) => {
                    write_loopback_response(&mut stream, StatusCode::OK, LOOPBACK_FAILED_PAGE)
                        .await;
                    return Err(error);
                }
                None => {
                    write_loopback_response(&mut stream, StatusCode::NOT_FOUND, "").await;
                }
            }
        }
    };

    tokio::time::timeout(std::time::Duration::from_secs(LOOPBACK_TIMEOUT_SECS), wait)
        .await
        .unwrap_or_else(|_| Err(anyhow!("timed out waiting for the Codex sign-in to finish")))
}

/// The authorization carried by a redirect, or `None` when this request was not
/// the redirect this login is waiting for.
///
/// The `state` is checked before anything else is read out of the query, so a
/// redirect belonging to some other login — a stale tab, a replay, a probe that
/// guessed the path — is reported as unrelated traffic rather than as a failure.
/// Failing on it would let any such request cancel a sign-in that is still on
/// its way, including one that merely carries `error` in its query.
fn authorization_from_target(target: &str, state: &str) -> Option<Result<String>> {
    // The request line carries only a path, which `Url` will not parse alone.
    let url = Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != "/auth/callback" {
        return None;
    }

    let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
    if query.get("state").map(String::as_str) != Some(state) {
        return None;
    }
    if let Some(error) = query.get("error") {
        let description = query
            .get("error_description")
            .map(String::as_str)
            .unwrap_or("no description given");
        return Some(Err(anyhow!(
            "Codex refused the sign-in: {error} ({description})"
        )));
    }
    match query.get("code") {
        Some(code) => Some(Ok(code.clone())),
        None => Some(Err(anyhow!(
            "the Codex sign-in came back without an authorization code"
        ))),
    }
}

/// Reads the target out of the request line, which is all that is needed; the
/// headers and body that follow are left unread and discarded with the socket.
async fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    while line.len() < 8192 {
        match stream.read(&mut byte).await {
            Ok(0) | Err(_) => return None,
            Ok(_) => {}
        }
        if byte[0] == b'\n' {
            break;
        }
        if byte[0] != b'\r' {
            line.push(byte[0]);
        }
    }
    let line = String::from_utf8(line).ok()?;
    line.split(' ').nth(1).map(str::to_string)
}

async fn write_loopback_response(stream: &mut TcpStream, status: StatusCode, body: &str) {
    let reason = status.canonical_reason().unwrap_or("");
    let response = format!(
        "HTTP/1.1 {} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        status.as_u16(),
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
}

/// A PKCE verifier, also used for the `state` value, which has the same job of
/// being unguessable and is subject to the same URL-safety constraint.
fn random_url_safe_token() -> String {
    base64_url_encode(&rand::random::<[u8; 32]>())
}

fn pkce_challenge(verifier: &str) -> String {
    base64_url_encode(&Sha256::digest(verifier.as_bytes()))
}

/// Unpadded base64url, the only encoding PKCE accepts. The decoding half lives
/// further down, next to the id-token reader that needs it.
fn base64_url_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let mut bits = 0u32;
        for (index, byte) in chunk.iter().enumerate() {
            bits |= u32::from(*byte) << (16 - 8 * index);
        }
        // Three bytes make four characters; a short chunk drops the characters
        // that would carry no bits rather than padding them out.
        for index in 0..chunk.len() + 1 {
            out.push(ALPHABET[((bits >> (18 - 6 * index)) & 0x3f) as usize] as char);
        }
    }
    out
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

/// The redirect URI has to match the one the authorization was issued for, and
/// the two flows do not share it: the device flow lands on OpenAI's own
/// callback, the loopback flow on this machine.
async fn exchange_authorization_code(
    client: &Client,
    code: &AuthorizationCode,
    redirect_uri: &str,
) -> Result<TokenResponse> {
    let response = client
        .post(TOKEN_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code.code.as_str()),
            ("redirect_uri", redirect_uri),
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

/// Bearer token and account id for a read-only call to the Codex API, renewed
/// first when the stored one is close to expiring.
pub(super) async fn stored_auth_for_request(client: &Client) -> Result<(String, String)> {
    let auth = fresh_auth(client).await?;
    Ok((auth.access, auth.account_id))
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
    thinking_levels: &ThinkingLevelMap,
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
    });

    if let Some(instructions) = instructions {
        request["instructions"] = Value::String(instructions);
    }

    if !tools.is_empty() {
        request["tool_choice"] = json!("auto");
        request["parallel_tool_calls"] = json!(true);
        request["tools"] = Value::Array(
            tools
                .iter()
                .map(openai_responses_tool_to_value)
                .collect::<Vec<_>>(),
        );
    }

    // As on plain Responses: the summary is the readable reasoning, so it is
    // asked for whether or not an effort is configured.
    let mut reasoning = json!({"summary": "auto"});
    if let Some(effort) = reasoning_effort {
        reasoning["effort"] = json!(validated_wire_effort(thinking_levels, effort));
    }
    request["reasoning"] = reasoning;
    request["include"] = json!(["reasoning.encrypted_content"]);

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
    on_delta: DeltaSink<'_>,
) -> std::result::Result<Value, CodexRequestError> {
    let mut last_error = CodexRequestError {
        status: None,
        message: "No attempts made".to_string(),
    };

    for attempt in 0..10 {
        let response = match client
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
        {
            Ok(resp) => resp,
            Err(e) => {
                last_error = CodexRequestError {
                    status: None,
                    message: format!("HTTP request failed for {url}: {e}"),
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
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);

        if status.is_success() {
            // Codex responses are requested as streams even when nobody is
            // observing live deltas. Stop at the protocol terminal event in
            // both cases; waiting for EOF can otherwise delay the next tool
            // round on a keep-alive SSE body.
            //
            // Codex often omits Content-Type on streamed responses. `Accept`
            // and `stream: true` make a missing header an SSE response here.
            if content_type.is_none() || is_event_stream(content_type.as_deref()) {
                return stream_codex_responses(response, url, status, on_delta).await;
            }
            let response_body = read_codex_body(response, url, status).await?;
            return parse_codex_success_body(url, status, content_type.as_deref(), &response_body);
        }

        let response_body = read_codex_body(response, url, status).await?;

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

async fn read_codex_body(
    response: reqwest::Response,
    url: &str,
    status: StatusCode,
) -> std::result::Result<String, CodexRequestError> {
    response.text().await.map_err(|error| CodexRequestError {
        status: Some(status),
        message: format!("Failed to read response body from {url}: {error}"),
    })
}

fn is_event_stream(content_type: Option<&str>) -> bool {
    content_type
        .map(|value| value.contains("text/event-stream"))
        .unwrap_or(false)
}

/// Consume the Codex event stream as it arrives, forwarding output to the sink
/// and returning the same final response object the buffered path produces.
async fn stream_codex_responses(
    response: reqwest::Response,
    url: &str,
    status: StatusCode,
    on_delta: DeltaSink<'_>,
) -> std::result::Result<Value, CodexRequestError> {
    read_sse_response(url, response, ResponsesStreamFold::new(on_delta))
        .await
        .map_err(|error| CodexRequestError {
            status: Some(status),
            message: format!("{error:#}"),
        })
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
    let mut fold = ResponsesStreamFold::new(None);

    for data in sse_data_payloads(response_body) {
        if data == "[DONE]" {
            continue;
        }

        let event: Value = serde_json::from_str(&data)
            .map_err(|error| format!("invalid SSE JSON event: {error}"))?;
        fold.push(&event)?;
    }

    fold.finish()
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
    ensure_open_credential_file_is_safe(&file, path)?;

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

fn lock_file(file: &File) -> io::Result<()> {
    FileExt::lock_exclusive(file)
}

fn unlock_file(file: &File) -> io::Result<()> {
    FileExt::unlock(file)
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

    fn write_credential(path: &Path, contents: impl AsRef<[u8]>) {
        fs::write(path, contents).unwrap();
        #[cfg(unix)]
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
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
    fn codex_lock_contends_until_release() {
        super::super::auth_store::assert_lock_contention_and_release(
            "codex",
            lock_file,
            unlock_file,
        );
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
            write_credential(&path, invalid);
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
    fn codex_secure_read_accepts_mode_0600_regular_file() {
        let dir = TestDir::new("read-regular");
        let path = dir.path("auth.json");
        write_auth_file_to_path(&path, &stored_codex_auth("regular-access")).unwrap();

        #[cfg(unix)]
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let auth = read_auth_file_optional_from_path(&path).unwrap().unwrap();

        assert_eq!(auth.access, "regular-access");
        assert_eq!(auth.refresh, "refresh-token");
    }

    #[cfg(unix)]
    #[test]
    fn codex_secure_read_rejects_group_or_other_permissions_without_reading() {
        let dir = TestDir::new("read-permissions");
        let path = dir.path("auth.json");
        write_auth_file_to_path(
            &path,
            &stored_codex_auth("secret-must-not-appear-in-errors"),
        )
        .unwrap();

        for mode in [0o644, 0o660] {
            fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();

            let error = read_auth_file_optional_from_path(&path).unwrap_err();

            assert!(
                error
                    .downcast_ref::<super::super::auth_store::UnsafeCredentialPermissionsError>()
                    .is_some(),
                "mode {mode:04o} did not produce the safety error: {error:#}"
            );
            assert!(error.to_string().contains(&format!("{mode:04o}")));
            assert!(error.to_string().contains("mode to 0600"));
            assert!(!error.to_string().contains("secret-must-not-appear"));
        }
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
        write_credential(&codex_path, "{ malformed");
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
        write_credential(&path, r#"{"type":"chatgpt-codex","access":7}"#);

        assert!(remove_codex_auth_file_for_logout(&path).unwrap());
        assert!(!path.exists());
    }

    #[test]
    fn codex_logout_preserves_valid_foreign_and_unknown_records() {
        let dir = TestDir::new("logout-foreign");
        let path = dir.path("auth.json");
        let arcee = r#"{"type":"arcee_api_key","api_key":"rcai-valid"}"#;
        write_credential(&path, arcee);
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

        let response = super::client::no_redirect_model_client()
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
                content: "primary instructions".to_string(),
            },
            Message::System {
                content: "agents instructions".to_string(),
            },
            Message::User {
                content: "hello".to_string(),
            },
        ];
        let levels =
            catalog::resolve(BackendKind::ChatGptCodexResponses, "gpt-5.5").thinking_level_map;
        let absent = codex_responses_request("gpt-5.5", None, &messages, &[], &levels);
        assert_eq!(absent["model"], "gpt-5.5");
        assert_eq!(
            absent["instructions"],
            "primary instructions\n\nagents instructions"
        );
        assert_eq!(absent["input"], json!([{"role":"user","content":"hello"}]));
        assert_eq!(absent["store"], false);
        assert_eq!(absent["stream"], true);
        assert_eq!(absent["text"]["verbosity"], "low");
        // The summary is requested unconditionally; only the effort is opt-in.
        assert_eq!(absent["reasoning"], json!({"summary": "auto"}));
        assert_eq!(absent["include"], json!(["reasoning.encrypted_content"]));
        assert!(absent.get("tools").is_none());
        assert!(absent.get("tool_choice").is_none());
        assert!(absent.get("parallel_tool_calls").is_none());

        let with_tools = codex_responses_request(
            "gpt-5.5",
            None,
            &messages,
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read a file".to_string(),
                    parameters: json!({"type": "object"}),
                },
            }],
            &levels,
        );
        assert!(with_tools.get("tools").is_some());
        assert_eq!(with_tools["tool_choice"], "auto");
        assert_eq!(with_tools["parallel_tool_calls"], true);

        for effort in [
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ] {
            let request = codex_responses_request("gpt-5.5", Some(effort), &messages, &[], &levels);
            assert_eq!(request["reasoning"]["effort"], effort.as_str());
            assert_eq!(request["include"][0], "reasoning.encrypted_content");
        }

        // The wire value comes from the passed catalog map, not adapter code.
        let custom = ThinkingLevelMap(std::collections::BTreeMap::from([(
            ReasoningEffort::Xhigh,
            Some("tier-four".to_string()),
        )]));
        let request = codex_responses_request(
            "gpt-5.5",
            Some(ReasoningEffort::Xhigh),
            &messages,
            &[],
            &custom,
        );
        assert_eq!(request["reasoning"]["effort"], "tier-four");
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

    #[tokio::test]
    async fn codex_without_delta_sink_finishes_before_sse_body_closes() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;
        use tokio::sync::oneshot;
        use tokio::time::timeout;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (release_server, wait_for_release) = oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).await.unwrap();
            let event = concat!(
                "data: {\"type\":\"response.output_item.done\",\"output_index\":0,",
                "\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",",
                "\"call_id\":\"call_1\",\"name\":\"read\",\"arguments\":\"{}\",",
                "\"status\":\"completed\"}}\n\n",
                "data: {\"type\":\"response.completed\",\"response\":",
                "{\"status\":\"completed\",\"output\":[]}}\n\n"
            );
            stream
                .write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\
                      Transfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n",
                )
                .await
                .unwrap();
            stream
                .write_all(format!("{:X}\r\n{event}\r\n", event.len()).as_bytes())
                .await
                .unwrap();
            stream.flush().await.unwrap();

            let _ = wait_for_release.await;
            let _ = stream.write_all(b"0\r\n\r\n").await;
        });

        let result = timeout(
            Duration::from_secs(1),
            post_codex_json_with_retry(
                &Client::new(),
                &format!("http://{address}"),
                &json!({"stream": true}),
                &stored_codex_auth("access-token"),
                None,
            ),
        )
        .await;

        let _ = release_server.send(());
        server.await.unwrap();
        let response = result
            .expect("terminal event should finish an unobserved Codex stream")
            .unwrap();
        assert_eq!(response["output"][0]["type"], "function_call");
        assert_eq!(response["output"][0]["call_id"], "call_1");
    }
}
