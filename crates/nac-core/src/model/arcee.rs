use super::auth_store::{
    arcee_auth_file_path, read_arcee_auth_string, read_auth_bytes_from_path,
    try_acquire_arcee_auth_lock, with_arcee_auth_lock, write_arcee_auth_string, FileLock,
};
use super::*;
use anyhow::Context;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CLIENT_ID: &str = "nac-cli";
const AUTH_TYPE: &str = "arcee_device_token";
const CANONICAL_AUTH_SERVICE_BASE_URL: &str = "https://api.arcee.ai";
const DEFAULT_INTERVAL_SECS: u64 = 5;
const DEFAULT_DEVICE_EXPIRES_IN_SECS: u64 = 900;
const DEFAULT_TOKEN_EXPIRES_IN_SECS: u64 = 43200;
const REFRESH_SKEW_MS: u64 = 10_800_000;
const REFRESH_LOCK_POLL_INTERVAL_MS: u64 = 50;
const REFRESH_LOCK_TIMEOUT_MS: u64 = 15_000;
const SLOW_DOWN_BACKOFF_SECS: u64 = 5;

pub(super) fn no_redirect_client() -> Result<Client> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .context("failed to build Arcee HTTP client")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ArceeEndpointKind {
    Approved,
    Unapproved,
}

/// Marks stored-auth content and policy failures that a caller can fix.
/// Credential-store access failures deliberately do not use this marker so
/// server callers preserve them as internal errors. Unsafe Unix permissions
/// use a shared actionable safety marker in `auth_store`.
#[derive(Debug)]
pub(super) struct StoredArceeAuthConfigurationError {
    message: String,
}

impl std::fmt::Display for StoredArceeAuthConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StoredArceeAuthConfigurationError {}

fn stored_auth_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(StoredArceeAuthConfigurationError {
        message: message.into(),
    })
}

fn classify_stored_auth_data_error(error: anyhow::Error) -> anyhow::Error {
    if error
        .downcast_ref::<StoredArceeAuthConfigurationError>()
        .is_some()
    {
        error
    } else if error.downcast_ref::<std::string::FromUtf8Error>().is_some() {
        stored_auth_configuration_error(error.to_string())
    } else {
        error
    }
}

pub(super) fn validate_arcee_base_url(base_url: &str) -> Result<(ArceeEndpointKind, Url)> {
    let parsed = Url::parse(base_url)
        .map_err(|error| anyhow!("invalid Arcee base URL '{}': {}", base_url, error))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(anyhow!(
            "invalid Arcee base URL '{}': scheme must be http or https",
            base_url
        ));
    }
    let host = parsed.host_str().ok_or_else(|| {
        anyhow!(
            "invalid Arcee base URL '{}': URL must include a host",
            base_url
        )
    })?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow!(
            "invalid Arcee base URL '{}': userinfo is not allowed",
            base_url
        ));
    }
    if parsed.query().is_some() {
        return Err(anyhow!(
            "invalid Arcee base URL '{}': query parameters are not allowed",
            base_url
        ));
    }
    if parsed.fragment().is_some() {
        return Err(anyhow!(
            "invalid Arcee base URL '{}': fragments are not allowed",
            base_url
        ));
    }

    let arcee_owned = host == "arcee.ai" || host.ends_with(".arcee.ai");
    if !arcee_owned {
        return Ok((ArceeEndpointKind::Unapproved, parsed));
    }
    if parsed.scheme() != "https" {
        return Err(anyhow!(
            "invalid Arcee base URL '{}': Arcee-owned endpoints require HTTPS",
            base_url
        ));
    }
    if parsed.port_or_known_default() != Some(443) {
        return Err(anyhow!(
            "invalid Arcee base URL '{}': Arcee-owned endpoints require effective port 443",
            base_url
        ));
    }

    Ok((ArceeEndpointKind::Approved, parsed))
}

pub(super) fn validate_approved_base_url(base_url: &str) -> Result<Url> {
    let (kind, parsed) = validate_arcee_base_url(base_url)?;
    if kind != ArceeEndpointKind::Approved {
        return Err(anyhow!(
            "Arcee base URL '{}' is not an approved Arcee origin",
            base_url
        ));
    }
    chat_completions_url(base_url)?;
    Ok(parsed)
}

pub(super) fn validate_stored_base_url(base_url: &str) -> Result<Url> {
    let (kind, parsed) = validate_arcee_base_url(base_url)?;
    if kind != ArceeEndpointKind::Approved {
        return Err(anyhow!(
            "stored Arcee base URL '{}' is not an approved Arcee origin",
            base_url
        ));
    }
    chat_completions_url(base_url)?;
    Ok(parsed)
}

fn raw_url_path(base_url: &str) -> &str {
    let Some((_, after_scheme)) = base_url.split_once("://") else {
        return "";
    };
    let Some(path_start) = after_scheme.find('/') else {
        return "";
    };
    after_scheme[path_start..]
        .split(['?', '#'])
        .next()
        .unwrap_or_default()
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn validate_unambiguous_path(base_url: &str) -> Result<()> {
    for segment in raw_url_path(base_url).split('/') {
        let bytes = segment.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut had_percent_encoding = false;
        let mut index = 0;
        while index < bytes.len() {
            if bytes[index] != b'%' {
                decoded.push(bytes[index]);
                index += 1;
                continue;
            }

            had_percent_encoding = true;
            let high = bytes.get(index + 1).and_then(|byte| hex_value(*byte));
            let low = bytes.get(index + 2).and_then(|byte| hex_value(*byte));
            let (Some(high), Some(low)) = (high, low) else {
                return Err(anyhow!(
                    "invalid Arcee base URL '{}': path contains malformed percent encoding",
                    base_url
                ));
            };
            decoded.push((high << 4) | low);
            index += 3;
        }

        if decoded == b"." || decoded == b".." {
            return Err(anyhow!(
                "invalid Arcee base URL '{}': dot path segments, including percent-encoded forms, are not allowed",
                base_url
            ));
        }
        if had_percent_encoding
            && [b"api".as_slice(), b"v1", b"chat", b"completions"]
                .iter()
                .any(|control| decoded.eq_ignore_ascii_case(control))
        {
            return Err(anyhow!(
                "invalid Arcee base URL '{}': percent-encoded route-control segments are not allowed; use literal path segments",
                base_url
            ));
        }
        if had_percent_encoding
            && decoded
                .iter()
                .any(|byte| matches!(byte, b'/' | b'\\' | b'?' | b'#'))
        {
            return Err(anyhow!(
                "invalid Arcee base URL '{}': percent-encoded path delimiters are not allowed",
                base_url
            ));
        }
    }
    Ok(())
}

/// Resolves an Arcee/OpenAI-compatible base URL to its chat-completions route.
///
/// Approved Arcee endpoints accept only the production root, `/api`, `/api/v1`,
/// or the complete production route and canonicalize all four forms to
/// `/api/v1/chat/completions`. Unapproved non-Arcee URLs retain ordinary path
/// prefixes only for low-level URL normalization, but ambiguous path-control
/// encodings are rejected. Both ModelClient Arcee modes reject these URLs
/// before client construction.
pub(super) fn chat_completions_url(base_url: &str) -> Result<Url> {
    validate_unambiguous_path(base_url)?;
    let (kind, mut parsed) = validate_arcee_base_url(base_url)?;
    let mut path_segments = parsed
        .path_segments()
        .ok_or_else(|| {
            anyhow!(
                "invalid Arcee base URL '{}': URL cannot be a base",
                base_url
            )
        })?
        .collect::<Vec<_>>();
    while path_segments.last() == Some(&"") {
        path_segments.pop();
    }

    if kind == ArceeEndpointKind::Approved {
        let accepted = path_segments.is_empty()
            || path_segments == ["api"]
            || path_segments == ["api", "v1"]
            || path_segments == ["api", "v1", "chat", "completions"];
        if !accepted {
            return Err(anyhow!(
                "invalid approved Arcee inference path '{}': expected /, /api, /api/v1, or /api/v1/chat/completions",
                parsed.path()
            ));
        }
        parsed.set_path("/api/v1/chat/completions");
        return Ok(parsed);
    }

    let additions: &[&str] = if path_segments.ends_with(&["chat", "completions"]) {
        &[]
    } else if path_segments.last() == Some(&"v1") {
        &["chat", "completions"]
    } else {
        &["v1", "chat", "completions"]
    };

    parsed.set_path(&format!("/{}", path_segments.join("/")));
    {
        let mut segments = parsed.path_segments_mut().map_err(|_| {
            anyhow!(
                "invalid Arcee base URL '{}': URL cannot be a base",
                base_url
            )
        })?;
        segments.pop_if_empty();
        segments.extend(additions);
    }

    Ok(parsed)
}

/// Resolves an Arcee/OpenAI-compatible base URL to its model-index route.
///
/// The index is the sibling of the chat-completions route rather than a path off
/// the base URL, and the two are reached through the same canonicalization: a
/// stored login records the origin it was issued for, while the REST surface
/// lives under `/api/v1`. Asked at the bare origin, `/models` answers 200 with an
/// empty body, which reads as a provider offering nothing rather than as a URL
/// that was never the index.
pub(super) fn models_url(base_url: &str) -> Result<Url> {
    let mut url = chat_completions_url(base_url)?;
    {
        let mut segments = url.path_segments_mut().map_err(|_| {
            anyhow!(
                "invalid Arcee base URL '{}': URL cannot be a base",
                base_url
            )
        })?;
        segments.pop();
        segments.pop();
        segments.push("models");
    }
    Ok(url)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct StoredArceeAuth {
    #[serde(rename = "type")]
    auth_type: String,
    pub(super) access_token: String,
    refresh_token: String,
    token_type: String,
    expires_at_ms: u64,
    pub(super) base_url: String,
    organization_id: String,
    workspace_name: String,
}

#[derive(Debug, Deserialize)]
struct TokenSuccess {
    access_token: String,
    refresh_token: String,
    token_type: Option<String>,
    expires_in: Option<u64>,
    base_url: String,
    organization_id: String,
    workspace_name: String,
}

#[derive(Debug, Deserialize)]
struct RefreshSuccess {
    access_token: String,
    refresh_token: Option<String>,
    token_type: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug)]
enum RefreshOutcome {
    Success(RefreshSuccess),
    Revoked,
}

#[derive(Debug)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    interval_secs: u64,
    expires_in_secs: u64,
}

#[derive(Debug, Clone)]
struct ArceeAuthService {
    base_url: String,
}

impl ArceeAuthService {
    fn canonical() -> Result<Self> {
        Self::approved(CANONICAL_AUTH_SERVICE_BASE_URL)
    }

    fn approved(base_url: &str) -> Result<Self> {
        validate_auth_service_base_url(base_url)?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    #[cfg(test)]
    fn for_test(base_url: &str) -> Self {
        let parsed = Url::parse(base_url).expect("test auth service URL must be absolute");
        assert!(matches!(parsed.scheme(), "http" | "https"));
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
        }
    }

    fn device_code_url(&self) -> String {
        format!("{}/app/v1/device/code", self.base_url)
    }

    fn device_token_url(&self) -> String {
        format!("{}/app/v1/device/token", self.base_url)
    }

    fn device_refresh_url(&self) -> String {
        format!("{}/app/v1/device/refresh", self.base_url)
    }
}

fn validate_auth_service_base_url(base_url: &str) -> Result<()> {
    let parsed = validate_approved_base_url(base_url)
        .with_context(|| format!("invalid Arcee auth service URL '{base_url}'"))?;
    let canonical = Url::parse(CANONICAL_AUTH_SERVICE_BASE_URL)
        .expect("canonical Arcee auth service URL must remain valid");
    if parsed.origin() != canonical.origin() || parsed.path() != "/" {
        return Err(anyhow!(
            "Arcee auth service URL '{}' is not the canonical origin {}",
            base_url,
            CANONICAL_AUTH_SERVICE_BASE_URL
        ));
    }
    Ok(())
}

/// An Arcee device login that has been issued a code and is waiting for the
/// user to approve it.
pub(super) struct ArceeDeviceLogin {
    client: Client,
    service: ArceeAuthService,
    device: DeviceCode,
}

impl ArceeDeviceLogin {
    pub(super) fn prompt(&self) -> DeviceLoginPrompt {
        DeviceLoginPrompt {
            verification_uri: self.device.verification_uri_complete.clone(),
            // The URL already carries this code, so it is only ever shown for
            // the user to check the page against.
            user_code: Some(self.device.user_code.clone()),
            expires_in_secs: self.device.expires_in_secs,
        }
    }

    pub(super) async fn complete(self) -> Result<ManagedAuthSnapshot> {
        let success = poll_device_code(&self.client, &self.service, &self.device).await?;
        let auth = stored_auth_from_token_success(success)?;
        with_arcee_auth_lock(|| write_stored_auth(&auth))?;
        Ok(snapshot_from_stored(Some(auth), arcee_auth_file_path()?))
    }
}

pub(super) async fn begin_arcee_device_login() -> Result<ArceeDeviceLogin> {
    let service = ArceeAuthService::canonical()?;
    let client = no_redirect_client()?;
    let device = request_device_code(&client, &service).await?;
    Ok(ArceeDeviceLogin {
        client,
        service,
        device,
    })
}

pub(super) fn arcee_auth_snapshot() -> Result<ManagedAuthSnapshot> {
    let path = arcee_auth_file_path()?;
    Ok(snapshot_from_stored(read_stored_auth_optional()?, path))
}

fn snapshot_from_stored(auth: Option<StoredArceeAuth>, path: PathBuf) -> ManagedAuthSnapshot {
    ManagedAuthSnapshot {
        provider: ManagedAuthProvider::Arcee,
        signed_in: auth.is_some(),
        account: auth.as_ref().map(|auth| auth.workspace_name.clone()),
        organization: auth.as_ref().map(|auth| auth.organization_id.clone()),
        base_url: auth.as_ref().map(|auth| auth.base_url.clone()),
        expires_at_ms: auth.as_ref().map(|auth| auth.expires_at_ms),
        path: path.display().to_string(),
    }
}

pub(super) fn arcee_auth_remove() -> Result<bool> {
    let path = arcee_auth_file_path()?;
    with_arcee_auth_lock(|| remove_arcee_auth_file_for_logout(&path))
}

pub(super) async fn arcee_auth_login() -> Result<()> {
    let login = begin_arcee_device_login().await?;
    let prompt = login.prompt();

    println!("Open this URL in a browser to authorize nac:");
    println!("{}", prompt.verification_uri);
    if let Some(code) = &prompt.user_code {
        println!();
        println!("Confirm this code matches what the page shows:");
        println!("{code}");
    }
    println!();
    if crate::browser::should_open_browser() {
        println!("Opening the authorization page in your browser…");
        crate::browser::open_url(&prompt.verification_uri);
    }
    println!("Waiting for authorization...");

    let snapshot = login.complete().await?;

    println!("Arcee auth saved.");
    println!("workspace: {}", snapshot.account.unwrap_or_default());
    println!("base_url: {}", snapshot.base_url.unwrap_or_default());
    println!("path: {}", snapshot.path);
    Ok(())
}

pub(super) fn arcee_auth_status() -> Result<()> {
    let snapshot = arcee_auth_snapshot()?;
    if snapshot.signed_in {
        println!("Arcee auth: signed in");
        println!("workspace: {}", snapshot.account.unwrap_or_default());
        println!(
            "organization: {}",
            snapshot.organization.unwrap_or_default()
        );
        println!("base_url: {}", snapshot.base_url.unwrap_or_default());
        println!(
            "access token: {}",
            expiry_status(snapshot.expires_at_ms.unwrap_or_default())
        );
    } else {
        println!("Arcee auth: not signed in");
    }
    println!("path: {}", snapshot.path);
    Ok(())
}

pub(super) fn arcee_auth_logout() -> Result<()> {
    let path = arcee_auth_file_path()?;
    let removed = arcee_auth_remove()?;
    if removed {
        println!("Arcee auth removed.");
    } else {
        println!("No Arcee auth found.");
    }
    println!("path: {}", path.display());
    Ok(())
}

fn remove_arcee_auth_file_for_logout(path: &Path) -> Result<bool> {
    if logout_disposition(path)? {
        remove_auth_path(path)
    } else {
        Ok(false)
    }
}

fn logout_disposition(path: &Path) -> Result<bool> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", path.display()))
        }
    };

    // The canonical path belongs only to Arcee, so unlink a symlink without
    // following it. Malformed canonical data is likewise recoverable by logout.
    if metadata.file_type().is_symlink() {
        return Ok(true);
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
        Err(_) => return Ok(true),
    };
    Ok(value.get("type").and_then(Value::as_str) == Some(AUTH_TYPE))
}

fn remove_auth_path(path: &Path) -> Result<bool> {
    match fs::remove_file(path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to remove {}", path.display())),
    }
}

fn stored_auth_from_token_success(success: TokenSuccess) -> Result<StoredArceeAuth> {
    validate_stored_base_url(&success.base_url)
        .context("Arcee login returned an invalid credential base URL")?;
    let expires_in = success.expires_in.unwrap_or(DEFAULT_TOKEN_EXPIRES_IN_SECS);
    Ok(StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        access_token: success.access_token,
        refresh_token: success.refresh_token,
        token_type: success.token_type.unwrap_or_else(|| "bearer".to_string()),
        expires_at_ms: now_ms().saturating_add(expires_in.saturating_mul(1000)),
        base_url: success.base_url,
        organization_id: success.organization_id,
        workspace_name: success.workspace_name,
    })
}

fn near_expiry(auth: &StoredArceeAuth) -> bool {
    auth.expires_at_ms <= now_ms().saturating_add(REFRESH_SKEW_MS)
}

/// Process-wide async gate that single-flights refreshes within this process. It
/// yields the executor while waiting (unlike a blocking file lock), so
/// concurrent arcee-auth calls never stall Tokio workers.
fn refresh_gate() -> &'static tokio::sync::Mutex<()> {
    static GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    &GATE
}

/// Acquires the cross-process refresh lock without ever blocking a Tokio worker:
/// it polls the non-blocking file lock and yields between attempts. The server
/// rotates the refresh token on every call, so two nac processes refreshing at
/// once could invalidate each other's tokens; this serializes them.
async fn acquire_refresh_lock() -> Result<FileLock> {
    let started = now_ms();
    loop {
        if let Some(lock) = try_acquire_arcee_auth_lock()? {
            return Ok(lock);
        }
        if now_ms().saturating_sub(started) >= REFRESH_LOCK_TIMEOUT_MS {
            return Err(anyhow!(
                "timed out waiting for the Arcee auth refresh lock; another nac process may be refreshing"
            ));
        }
        sleep(Duration::from_millis(REFRESH_LOCK_POLL_INTERVAL_MS)).await;
    }
}

/// Returns a valid access token bound to `expected_base_url`, refreshing
/// proactively when it is at or near expiry. The pre-check read is lock-free
/// (credential writes are atomic renames, so a reader always sees a complete
/// record); the refresh itself is serialized in- and cross-process.
pub(super) async fn fresh_access_token(client: &Client, expected_base_url: &str) -> Result<String> {
    let auth = read_stored_auth_for_base_url(expected_base_url)?;
    if !near_expiry(&auth) {
        return Ok(auth.access_token);
    }
    refresh_locked(client, expected_base_url, near_expiry).await
}

/// Refreshes after a 401. Passing the access token that failed lets a queued
/// caller detect that another holder already rotated past it and reuse the new
/// token instead of triggering a redundant rotation. Every re-read remains
/// bound to the inference origin selected by the existing model client.
pub(super) async fn force_refresh_access_token(
    client: &Client,
    expected_base_url: &str,
    stale_access_token: &str,
) -> Result<String> {
    refresh_locked(client, expected_base_url, |auth| {
        auth.access_token == stale_access_token
    })
    .await
}

/// Serializes the refresh across this process (async gate) and across processes
/// (polled file lock), re-reads the freshest stored record under both locks, and
/// only performs the network refresh when `should_refresh` still holds.
async fn refresh_locked(
    client: &Client,
    expected_base_url: &str,
    should_refresh: impl Fn(&StoredArceeAuth) -> bool,
) -> Result<String> {
    let _gate = refresh_gate().lock().await;
    let _lock = acquire_refresh_lock().await?;
    let auth = read_stored_auth_for_base_url(expected_base_url)?;
    if !should_refresh(&auth) {
        return Ok(auth.access_token);
    }
    Ok(refresh_and_store_auth(client, auth).await?.access_token)
}

async fn refresh_and_store_auth(
    client: &Client,
    current: StoredArceeAuth,
) -> Result<StoredArceeAuth> {
    let service = ArceeAuthService::canonical()?;
    match request_token_refresh(client, &service, &current.refresh_token).await? {
        RefreshOutcome::Success(refreshed) => {
            let updated = stored_auth_from_refresh(current, refreshed);
            write_stored_auth(&updated)?;
            Ok(updated)
        }
        RefreshOutcome::Revoked => {
            let _ = remove_auth_path(&arcee_auth_file_path()?);
            Err(stored_auth_configuration_error(
                "Arcee authorization was revoked or expired; run `nac arcee-auth login` again.",
            ))
        }
    }
}

fn stored_auth_from_refresh(
    current: StoredArceeAuth,
    refreshed: RefreshSuccess,
) -> StoredArceeAuth {
    let expires_in = refreshed
        .expires_in
        .unwrap_or(DEFAULT_TOKEN_EXPIRES_IN_SECS);
    StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        access_token: refreshed.access_token,
        // The server rotates the refresh token on every refresh; persist the new
        // one. Fall back to the current token only if the response omits it.
        refresh_token: refreshed.refresh_token.unwrap_or(current.refresh_token),
        token_type: refreshed.token_type.unwrap_or(current.token_type),
        expires_at_ms: now_ms().saturating_add(expires_in.saturating_mul(1000)),
        base_url: current.base_url,
        organization_id: current.organization_id,
        workspace_name: current.workspace_name,
    }
}

async fn request_token_refresh(
    client: &Client,
    service: &ArceeAuthService,
    refresh_token: &str,
) -> Result<RefreshOutcome> {
    let url = service.device_refresh_url();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", user_agent())
        .json(&json!({ "refresh_token": refresh_token, "client_id": CLIENT_ID }))
        .send()
        .await
        .context("failed to refresh Arcee access token")?;

    let status = response.status();
    let redirect_location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .context("failed to read Arcee token refresh response")?;

    if status.is_redirection() {
        return Err(arcee_redirect_error(
            "token refresh request",
            &url,
            status,
            redirect_location.as_deref(),
            &body,
            &[refresh_token],
        ));
    }

    if status.is_success() {
        return serde_json::from_str::<RefreshSuccess>(&body)
            .map(RefreshOutcome::Success)
            .context("failed to parse Arcee token refresh response");
    }

    let error_code = serde_json::from_str::<Value>(&body).ok().and_then(|value| {
        value
            .get("error")
            .and_then(Value::as_str)
            .map(str::to_string)
    });

    match error_code.as_deref() {
        Some("invalid_grant") | Some("invalid_client") => Ok(RefreshOutcome::Revoked),
        _ => Err(anyhow!(
            "Arcee token refresh failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&redact_credentials(&body, &[refresh_token]))
        )),
    }
}

/// Whether a stored Arcee credential exists and parses (the `/models`
/// auth-status check; any read/parse/permission failure reads as absent).
pub(super) fn stored_credential_present() -> bool {
    matches!(read_stored_auth_optional(), Ok(Some(_)))
}

pub(super) fn read_stored_auth() -> Result<StoredArceeAuth> {
    read_stored_auth_optional()
        .map_err(classify_stored_auth_data_error)?
        .ok_or_else(|| {
            stored_auth_configuration_error(
                "Arcee auth is not configured. Run `nac arcee-auth login` to sign in.",
            )
        })
}

fn read_stored_auth_for_base_url(expected_base_url: &str) -> Result<StoredArceeAuth> {
    let auth = read_stored_auth()?;
    let expected_url = validate_approved_base_url(expected_base_url)?;
    let stored_url = validate_stored_base_url(&auth.base_url)?;
    if expected_url.origin() != stored_url.origin() {
        return Err(stored_auth_configuration_error(format!(
            "Arcee endpoint origin '{}' does not match the stored credential origin '{}'; log in for the selected origin or select 'arcee-api' with separate API-key credentials",
            expected_url.origin().ascii_serialization(),
            stored_url.origin().ascii_serialization()
        )));
    }
    Ok(auth)
}

fn read_stored_auth_optional() -> Result<Option<StoredArceeAuth>> {
    let path = arcee_auth_file_path()?;
    let raw = match read_arcee_auth_string()? {
        Some(raw) => raw,
        None => return Ok(None),
    };
    parse_stored_auth(&raw, &path)
}

fn parse_stored_auth(raw: &str, path: &Path) -> Result<Option<StoredArceeAuth>> {
    let value: Value = serde_json::from_str(raw).map_err(|error| {
        stored_auth_configuration_error(format!(
            "failed to parse stored Arcee auth in {}: {}",
            path.display(),
            error
        ))
    })?;
    if value.get("type").and_then(Value::as_str) != Some(AUTH_TYPE) {
        return Ok(None);
    }
    let auth: StoredArceeAuth = serde_json::from_value(value).map_err(|error| {
        stored_auth_configuration_error(format!(
            "failed to parse stored Arcee auth schema in {}: {}",
            path.display(),
            error
        ))
    })?;
    for (field, field_value) in [
        ("access_token", auth.access_token.as_str()),
        ("refresh_token", auth.refresh_token.as_str()),
    ] {
        if field_value.trim().is_empty() {
            return Err(stored_auth_configuration_error(format!(
                "stored Arcee auth in {} requires nonblank field '{}'",
                path.display(),
                field
            )));
        }
    }
    validate_stored_base_url(&auth.base_url).map_err(|error| {
        stored_auth_configuration_error(format!(
            "stored Arcee auth in {} has an invalid base_url: {}",
            path.display(),
            error
        ))
    })?;
    Ok(Some(auth))
}

fn write_stored_auth(auth: &StoredArceeAuth) -> Result<()> {
    validate_stored_base_url(&auth.base_url)
        .context("refusing to store Arcee credentials with an invalid base_url")?;
    let raw = serde_json::to_string_pretty(auth).context("failed to serialize Arcee auth")?;
    write_arcee_auth_string(&raw)
}

async fn request_device_code(client: &Client, service: &ArceeAuthService) -> Result<DeviceCode> {
    let url = service.device_code_url();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", user_agent())
        .json(&json!({ "client_id": CLIENT_ID }))
        .send()
        .await
        .context("failed to request Arcee device code")?;

    let status = response.status();
    let redirect_location = response
        .headers()
        .get(reqwest::header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response
        .text()
        .await
        .context("failed to read Arcee device-code response")?;
    if status.is_redirection() {
        return Err(arcee_redirect_error(
            "device-code request",
            &url,
            status,
            redirect_location.as_deref(),
            &body,
            &[],
        ));
    }
    if !status.is_success() {
        return Err(anyhow!(
            "Arcee device-code request failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&redact_credentials(&body, &[]))
        ));
    }

    let value: Value =
        serde_json::from_str(&body).context("failed to parse Arcee device-code response")?;
    let device_code = string_field(&value, "device_code")?;
    let user_code = string_field(&value, "user_code")?;
    let verification_uri_complete = value
        .get("verification_uri_complete")
        .or_else(|| value.get("verification_uri"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Arcee device-code response did not include a verification URI"))?;
    let interval_secs = value
        .get("interval")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .max(1);
    let expires_in_secs = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_DEVICE_EXPIRES_IN_SECS);

    Ok(DeviceCode {
        device_code,
        user_code,
        verification_uri_complete,
        interval_secs,
        expires_in_secs,
    })
}

async fn poll_device_code(
    client: &Client,
    service: &ArceeAuthService,
    device: &DeviceCode,
) -> Result<TokenSuccess> {
    poll_device_code_with(client, service, device, now_ms, sleep).await
}

async fn poll_device_code_with<Now, Sleep, SleepFuture>(
    client: &Client,
    service: &ArceeAuthService,
    device: &DeviceCode,
    mut now: Now,
    mut sleep_for: Sleep,
) -> Result<TokenSuccess>
where
    Now: FnMut() -> u64,
    Sleep: FnMut(Duration) -> SleepFuture,
    SleepFuture: std::future::Future<Output = ()>,
{
    let url = service.device_token_url();
    let started = now();
    let mut interval_secs = device.interval_secs;

    loop {
        let response = client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("User-Agent", user_agent())
            .json(&json!({ "device_code": device.device_code, "client_id": CLIENT_ID }))
            .send()
            .await
            .context("failed to poll Arcee device authorization")?;

        let status = response.status();
        let redirect_location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let body = response
            .text()
            .await
            .context("failed to read Arcee device authorization response")?;

        if status.is_redirection() {
            return Err(arcee_redirect_error(
                "device authorization request",
                &url,
                status,
                redirect_location.as_deref(),
                &body,
                &[device.device_code.as_str()],
            ));
        }

        if status.is_success() {
            return serde_json::from_str::<TokenSuccess>(&body)
                .context("failed to parse Arcee device authorization response");
        }

        let error_code = serde_json::from_str::<Value>(&body).ok().and_then(|value| {
            value
                .get("error")
                .and_then(Value::as_str)
                .map(str::to_string)
        });

        match error_code.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => {
                interval_secs = interval_secs.saturating_add(SLOW_DOWN_BACKOFF_SECS)
            }
            Some("access_denied") => return Err(anyhow!("Arcee authorization was denied")),
            Some("expired_token") => {
                return Err(anyhow!(
                    "Arcee device code expired; run `nac arcee-auth login` again"
                ))
            }
            Some(other) => return Err(anyhow!("Arcee device authorization failed: {other}")),
            None => {
                return Err(anyhow!(
                    "Arcee device authorization failed with HTTP {}: {}",
                    status.as_u16(),
                    truncate(&redact_credentials(&body, &[device.device_code.as_str()]))
                ))
            }
        }

        if now().saturating_sub(started) >= device.expires_in_secs.saturating_mul(1000) {
            return Err(anyhow!(
                "Arcee device authorization timed out; run `nac arcee-auth login` again"
            ));
        }

        sleep_for(Duration::from_secs(interval_secs)).await;
    }
}

fn string_field(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| anyhow!("Arcee device-code response did not include {key}"))
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
        format!("valid for {seconds}s")
    }
}

fn user_agent() -> String {
    format!("nac/{}", env!("CARGO_PKG_VERSION"))
}

fn truncate(value: &str) -> String {
    value.chars().take(500).collect()
}

fn arcee_redirect_error(
    action: &str,
    url: &str,
    status: reqwest::StatusCode,
    location: Option<&str>,
    body: &str,
    secrets: &[&str],
) -> anyhow::Error {
    let location = location
        .map(|value| {
            format!(
                " Location: {}.",
                truncate(&redact_credentials(value, secrets))
            )
        })
        .unwrap_or_default();
    anyhow!(
        "Arcee {action} received HTTP {} redirect from {url}; automatic redirects are disabled and the request was not replayed.{} Body: {}",
        status.as_u16(),
        location,
        truncate(&redact_credentials(body, secrets))
    )
}

#[cfg(test)]
mod tests {
    use super::super::test_http::{ScriptedResponse, ScriptedServer};
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::future::ready;
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::rc::Rc;

    #[cfg(unix)]
    use std::os::unix::fs::symlink;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "nac-arcee-auth-{label}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }

        fn paths(&self) -> (PathBuf, PathBuf) {
            (self.0.join("auth.json"), self.0.join("arcee_auth.json"))
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn stored_auth(access_token: &str) -> StoredArceeAuth {
        StoredArceeAuth {
            auth_type: AUTH_TYPE.to_string(),
            access_token: access_token.to_string(),
            refresh_token: "refresh-1".to_string(),
            token_type: "bearer".to_string(),
            expires_at_ms: u64::MAX,
            base_url: "https://api.arcee.ai".to_string(),
            organization_id: "org-1".to_string(),
            workspace_name: "acme".to_string(),
        }
    }

    fn write_credential(path: &Path, contents: impl AsRef<[u8]>) {
        fs::write(path, contents).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    fn write_json(path: &Path, auth: &StoredArceeAuth) {
        write_credential(path, serde_json::to_string_pretty(auth).unwrap());
    }

    fn assert_device_request(request: &super::super::test_http::CapturedRequest, path: &str) {
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, path);
        assert_eq!(
            request.headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
        assert_eq!(
            request.headers.get("user-agent").map(String::as_str),
            Some(user_agent().as_str())
        );
    }

    #[tokio::test]
    async fn device_code_request_uses_expected_contract_and_parses_complete_uri() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "device_code": "device-123",
                "user_code": "ABCD-EFGH",
                "verification_uri_complete": "https://accounts.arcee.ai/device?code=ABCD-EFGH",
                "interval": 3,
                "expires_in": 120
            })
            .to_string(),
        )]);

        let device = request_device_code(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
        )
        .await
        .expect("device-code response should parse");
        let requests = server.finish();

        assert_eq!(device.device_code, "device-123");
        assert_eq!(device.user_code, "ABCD-EFGH");
        assert_eq!(
            device.verification_uri_complete,
            "https://accounts.arcee.ai/device?code=ABCD-EFGH"
        );
        assert_eq!(device.interval_secs, 3);
        assert_eq!(device.expires_in_secs, 120);
        assert_eq!(requests.len(), 1);
        assert_device_request(&requests[0], "/app/v1/device/code");
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({"client_id": CLIENT_ID})
        );
    }

    #[tokio::test]
    async fn device_code_request_supports_fallback_uri_and_default_timing() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "device_code": "device-fallback",
                "user_code": "FALL-BACK",
                "verification_uri": "https://accounts.arcee.ai/device"
            })
            .to_string(),
        )]);

        let device = request_device_code(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
        )
        .await
        .expect("fallback verification URI should parse");
        server.finish();

        assert_eq!(
            device.verification_uri_complete,
            "https://accounts.arcee.ai/device"
        );
        assert_eq!(device.interval_secs, DEFAULT_INTERVAL_SECS);
        assert_eq!(device.expires_in_secs, DEFAULT_DEVICE_EXPIRES_IN_SECS);
    }

    #[tokio::test]
    async fn device_code_request_reports_malformed_and_non_success_responses() {
        let cases = [
            (
                "200 OK",
                r#"{"device_code":"only-one-field"}"#,
                "did not include user_code",
            ),
            (
                "401 Unauthorized",
                r#"{"error":"invalid_client"}"#,
                "failed with HTTP 401",
            ),
        ];

        for (status, body, expected) in cases {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(status, body)]);
            let error = request_device_code(
                &no_redirect_client().unwrap(),
                &ArceeAuthService::for_test(&server.base_url),
            )
            .await
            .expect_err("invalid device-code response should fail");
            let requests = server.finish();

            assert!(
                error.to_string().contains(expected),
                "expected {expected:?} in {error:#}"
            );
            assert_device_request(&requests[0], "/app/v1/device/code");
        }
    }

    #[tokio::test]
    async fn device_code_same_origin_redirect_is_reported_without_replay() {
        let server = ScriptedServer::start_same_origin_redirect(
            "308 Permanent Redirect",
            "/redirected-device-code",
            format!("{}not-in-error", "x".repeat(500)),
        );

        let error = request_device_code(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
        )
        .await
        .expect_err("Arcee device-code redirects must not be followed")
        .to_string();
        let requests = server.finish();

        assert!(
            error.contains("HTTP 308 redirect"),
            "unexpected error: {error}"
        );
        assert!(
            error.contains("automatic redirects are disabled"),
            "unexpected error: {error}"
        );
        assert!(
            !error.contains("not-in-error"),
            "error body was not bounded"
        );
        assert_eq!(requests.len(), 1, "same-origin redirect was replayed");
        assert_device_request(&requests[0], "/app/v1/device/code");
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({"client_id": CLIENT_ID})
        );
    }

    #[tokio::test]
    async fn device_token_redirect_to_http_destination_does_not_replay_code() {
        let destination = TcpListener::bind(("127.0.0.1", 0)).expect("bind redirect destination");
        destination
            .set_nonblocking(true)
            .expect("make redirect destination nonblocking");
        let destination_url = format!(
            "http://{}/stolen-device-code",
            destination.local_addr().unwrap()
        );
        let source = ScriptedServer::start(vec![ScriptedResponse::redirect(
            "307 Temporary Redirect",
            destination_url,
            "redirect blocked",
        )]);
        let device = DeviceCode {
            device_code: "sensitive-device-code".to_string(),
            user_code: "SENSITIVE".to_string(),
            verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
            interval_secs: 1,
            expires_in_secs: 60,
        };

        let error = poll_device_code_with(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&source.base_url),
            &device,
            || 0,
            |_| ready(()),
        )
        .await
        .expect_err("Arcee token redirects must not be followed")
        .to_string();
        let requests = source.finish();

        assert!(
            error.contains("HTTP 307 redirect"),
            "unexpected error: {error}"
        );
        assert!(
            error.contains("was not replayed"),
            "unexpected error: {error}"
        );
        assert_eq!(requests.len(), 1);
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({"device_code": "sensitive-device-code", "client_id": CLIENT_ID})
        );
        let accept_error = destination
            .accept()
            .expect_err("HTTP redirect destination must receive no request");
        assert_eq!(accept_error.kind(), io::ErrorKind::WouldBlock);
    }

    #[tokio::test]
    async fn token_poll_handles_pending_and_slow_down_then_parses_success_without_waiting() {
        let server = ScriptedServer::start(vec![
            ScriptedResponse::json("400 Bad Request", r#"{"error":"authorization_pending"}"#),
            ScriptedResponse::json("400 Bad Request", r#"{"error":"slow_down"}"#),
            ScriptedResponse::json(
                "200 OK",
                json!({
                    "access_token": "jwt-access-token",
                    "refresh_token": "opaque-refresh-token",
                    "token_type": "bearer",
                    "expires_in": 3600,
                    "base_url": "https://api.arcee.ai",
                    "organization_id": "org-device",
                    "workspace_name": "device-workspace"
                })
                .to_string(),
            ),
        ]);
        let device = DeviceCode {
            device_code: "device-poll".to_string(),
            user_code: "POLL-CODE".to_string(),
            verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
            interval_secs: 2,
            expires_in_secs: 60,
        };
        let clock = Rc::new(Cell::new(0u64));
        let sleeps = Rc::new(RefCell::new(Vec::new()));
        let now_clock = Rc::clone(&clock);
        let sleep_clock = Rc::clone(&clock);
        let recorded_sleeps = Rc::clone(&sleeps);

        let success = poll_device_code_with(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
            &device,
            move || now_clock.get(),
            move |duration| {
                recorded_sleeps.borrow_mut().push(duration);
                sleep_clock.set(
                    sleep_clock
                        .get()
                        .saturating_add(duration.as_millis() as u64),
                );
                ready(())
            },
        )
        .await
        .expect("pending poll should eventually succeed");
        let requests = server.finish();

        assert_eq!(success.access_token, "jwt-access-token");
        assert_eq!(success.refresh_token, "opaque-refresh-token");
        assert_eq!(success.token_type.as_deref(), Some("bearer"));
        assert_eq!(success.expires_in, Some(3600));
        assert_eq!(success.base_url, "https://api.arcee.ai");
        assert_eq!(success.organization_id, "org-device");
        assert_eq!(success.workspace_name, "device-workspace");
        assert_eq!(
            sleeps.borrow().as_slice(),
            [Duration::from_secs(2), Duration::from_secs(7)]
        );
        assert_eq!(requests.len(), 3);
        for request in &requests {
            assert_device_request(request, "/app/v1/device/token");
            assert_eq!(
                serde_json::from_slice::<Value>(&request.body).unwrap(),
                json!({"device_code": "device-poll", "client_id": CLIENT_ID})
            );
        }
    }

    #[tokio::test]
    async fn token_poll_reports_denied_expired_malformed_and_unstructured_errors() {
        let cases = [
            (
                "400 Bad Request",
                r#"{"error":"access_denied"}"#,
                "authorization was denied",
            ),
            (
                "400 Bad Request",
                r#"{"error":"expired_token"}"#,
                "device code expired",
            ),
            (
                "200 OK",
                r#"{"access_token":"missing-other-success-fields"}"#,
                "failed to parse Arcee device authorization response",
            ),
            (
                "503 Service Unavailable",
                "upstream unavailable",
                "failed with HTTP 503",
            ),
        ];

        for (status, body, expected) in cases {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(status, body)]);
            let device = DeviceCode {
                device_code: "device-error".to_string(),
                user_code: "ERROR".to_string(),
                verification_uri_complete: "https://accounts.arcee.ai/device".to_string(),
                interval_secs: 1,
                expires_in_secs: 60,
            };
            let error = poll_device_code_with(
                &no_redirect_client().unwrap(),
                &ArceeAuthService::for_test(&server.base_url),
                &device,
                || 0,
                |_| ready(()),
            )
            .await
            .expect_err("terminal poll response should fail");
            let requests = server.finish();

            assert!(
                error.to_string().contains(expected),
                "expected {expected:?} in {error:#}"
            );
            assert_eq!(requests.len(), 1);
            assert_device_request(&requests[0], "/app/v1/device/token");
        }
    }

    #[test]
    fn canonical_auth_service_uses_the_fixed_approved_origin() {
        let service = ArceeAuthService::canonical().unwrap();
        assert_eq!(service.base_url, CANONICAL_AUTH_SERVICE_BASE_URL);
        assert_eq!(
            service.device_code_url(),
            "https://api.arcee.ai/app/v1/device/code"
        );
        assert_eq!(
            service.device_token_url(),
            "https://api.arcee.ai/app/v1/device/token"
        );
        assert_eq!(
            service.device_refresh_url(),
            "https://api.arcee.ai/app/v1/device/refresh"
        );
    }

    #[test]
    fn noncanonical_auth_service_origins_are_rejected_before_connection() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let local_origin = format!("http://{}", listener.local_addr().unwrap());
        let cases = [
            local_origin.as_str(),
            "https://arcee.ai",
            "https://accounts.arcee.ai",
            "http://api.arcee.ai",
            "https://api.arcee.ai:8443",
            "https://user@api.arcee.ai",
            "https://api.arcee.ai/custom-path",
            "not a URL",
        ];

        for base_url in cases {
            let error = ArceeAuthService::approved(base_url).unwrap_err();
            assert!(
                error.to_string().contains("Arcee auth service")
                    || error.to_string().contains("canonical origin"),
                "unexpected error for {base_url}: {error:#}"
            );
        }

        let accept_error = listener
            .accept()
            .expect_err("rejected auth-service origin must not receive a connection");
        assert_eq!(accept_error.kind(), io::ErrorKind::WouldBlock);
    }

    #[test]
    fn arcee_url_policy_approves_only_secure_arcee_origins() {
        for base_url in [
            "https://arcee.ai",
            "https://api.arcee.ai",
            "https://api.internal.arcee.ai/v1/custom/",
            "https://api.arcee.ai:443/path",
        ] {
            let (kind, parsed) = validate_arcee_base_url(base_url).unwrap();
            assert_eq!(kind, ArceeEndpointKind::Approved, "{base_url}");
            assert_eq!(parsed.port_or_known_default(), Some(443), "{base_url}");
        }
    }

    #[test]
    fn arcee_url_policy_classifies_non_arcee_origins_as_unapproved() {
        for base_url in [
            "http://127.0.0.1:8080/dev/path",
            "http://localhost:3000",
            "https://models.example.com/arcee",
            "https://arcee.ai.attacker.example/v1",
        ] {
            let (kind, _) = validate_arcee_base_url(base_url).unwrap();
            assert_eq!(kind, ArceeEndpointKind::Unapproved, "{base_url}");
        }
    }

    #[test]
    fn approved_arcee_chat_completions_url_matrix_is_canonical() {
        let cases = [
            (
                "https://api.arcee.ai",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai///",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/api",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/api/",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/api/v1",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/api/v1/",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/api/v1/chat/completions",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://api.arcee.ai/api/v1/chat/completions/",
                "https://api.arcee.ai/api/v1/chat/completions",
            ),
            (
                "https://tenant.arcee.ai/api/v1/",
                "https://tenant.arcee.ai/api/v1/chat/completions",
            ),
        ];

        for (base_url, expected) in cases {
            assert_eq!(
                chat_completions_url(base_url).unwrap().as_str(),
                expected,
                "{base_url}"
            );
        }
    }

    #[test]
    fn approved_arcee_chat_completions_url_rejects_noncanonical_paths() {
        for base_url in [
            "https://api.arcee.ai/v1",
            "https://api.arcee.ai/v1/",
            "https://api.arcee.ai/other",
            "https://api.arcee.ai/other/api",
            "https://api.arcee.ai/other/api/v1",
            "https://api.arcee.ai/other/chat/completions",
            "https://api.arcee.ai/v1/chat/completions",
            "https://tenant.arcee.ai/prefix/api/v1",
        ] {
            let error = chat_completions_url(base_url)
                .expect_err("approved noncanonical path must be rejected")
                .to_string();
            assert!(
                error.contains("invalid approved Arcee inference path"),
                "{base_url}: {error}"
            );
        }
    }

    #[test]
    fn unapproved_url_normalization_matrix_preserves_prefixes() {
        let cases = [
            (
                "http://localhost:8080",
                "http://localhost:8080/v1/chat/completions",
            ),
            (
                "http://localhost:8080/",
                "http://localhost:8080/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/prefix",
                "https://gateway.example.com/prefix/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/prefix/v1",
                "https://gateway.example.com/prefix/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/prefix/v1/",
                "https://gateway.example.com/prefix/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/prefix/v1/chat/completions",
                "https://gateway.example.com/prefix/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/prefix/v1/chat/completions/",
                "https://gateway.example.com/prefix/v1/chat/completions",
            ),
            (
                "https://gateway.example.com/tenant%20one",
                "https://gateway.example.com/tenant%20one/v1/chat/completions",
            ),
        ];

        for (base_url, expected) in cases {
            assert_eq!(
                chat_completions_url(base_url).unwrap().as_str(),
                expected,
                "{base_url}"
            );
        }
    }

    #[test]
    fn chat_completions_url_rejects_literal_and_encoded_dot_segments() {
        for base_url in [
            "https://gateway.example.com/prefix/../tenant",
            "https://gateway.example.com/prefix/./tenant",
            "https://gateway.example.com/prefix/%2e%2e/tenant",
            "https://gateway.example.com/prefix/%2E/tenant",
            "https://gateway.example.com/prefix/.%2e/tenant",
            "https://api.arcee.ai/api/%2e%2e/api/v1",
        ] {
            let error = chat_completions_url(base_url)
                .expect_err("ambiguous dot path must be rejected")
                .to_string();
            assert!(error.contains("dot path segments"), "{base_url}: {error}");
        }
    }

    #[test]
    fn chat_completions_url_rejects_encoded_route_controls_and_delimiters() {
        let cases = [
            ("https://gateway.example.com/%76%31", "route-control"),
            (
                "https://gateway.example.com/%63hat/completions",
                "route-control",
            ),
            (
                "https://gateway.example.com/v1/%63ompletions",
                "route-control",
            ),
            ("https://api.arcee.ai/%61pi/v1", "route-control"),
            (
                "https://gateway.example.com/prefix%2Ftenant",
                "path delimiters",
            ),
            (
                "https://gateway.example.com/prefix%5ctenant",
                "path delimiters",
            ),
            (
                "https://gateway.example.com/prefix%",
                "malformed percent encoding",
            ),
        ];

        for (base_url, expected) in cases {
            let error = chat_completions_url(base_url)
                .expect_err("encoded path control must be rejected")
                .to_string();
            assert!(error.contains(expected), "{base_url}: {error}");
        }
    }

    #[test]
    fn chat_completions_url_preserves_origin_policy_rejections() {
        for base_url in [
            "https://api.arcee.ai?tenant=one",
            "https://gateway.example.com/v1#fragment",
        ] {
            assert!(chat_completions_url(base_url).is_err(), "{base_url}");
        }
    }

    #[test]
    fn arcee_url_policy_rejects_malformed_and_unsafe_urls() {
        let cases = [
            ("relative/path", "invalid Arcee base URL"),
            ("ftp://api.arcee.ai/models", "scheme must be http or https"),
            ("https://", "invalid Arcee base URL"),
            ("https://user@api.arcee.ai", "userinfo is not allowed"),
            (
                "https://api.arcee.ai?tenant=evil",
                "query parameters are not allowed",
            ),
            ("https://api.arcee.ai#fragment", "fragments are not allowed"),
            ("http://api.arcee.ai", "require HTTPS"),
            ("https://api.arcee.ai:8443", "effective port 443"),
        ];

        for (base_url, expected) in cases {
            let error = validate_arcee_base_url(base_url).unwrap_err().to_string();
            assert!(
                error.contains(expected),
                "{base_url}: expected {expected:?} in {error:?}"
            );
        }
    }

    #[test]
    fn login_token_base_url_must_be_an_approved_arcee_origin() {
        let success = TokenSuccess {
            access_token: "jwt-hostile".to_string(),
            refresh_token: "opaque-hostile".to_string(),
            token_type: Some("bearer".to_string()),
            expires_in: Some(3600),
            base_url: "https://capture.attacker.example/v1".to_string(),
            organization_id: "org-1".to_string(),
            workspace_name: "acme".to_string(),
        };

        let error = stored_auth_from_token_success(success).unwrap_err();
        assert!(
            error.to_string().contains("invalid credential base URL"),
            "unexpected error: {error:#}"
        );
    }

    #[test]
    fn tampered_stored_base_url_is_rejected() {
        let dir = TestDir::new("tampered-url");
        let (_, canonical) = dir.paths();
        let mut auth = stored_auth("rcai-stored");
        auth.base_url = "http://api.arcee.ai:8080/steal".to_string();
        let raw = serde_json::to_string(&auth).unwrap();

        let error = parse_stored_auth(&raw, &canonical).unwrap_err();
        assert!(
            error.to_string().contains("invalid base_url"),
            "unexpected error: {error:#}"
        );
    }

    #[test]
    fn stored_auth_round_trips() {
        let auth = stored_auth("jwt-abc");
        let raw = serde_json::to_string(&auth).unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["type"], "arcee_device_token");
        assert_eq!(value["access_token"], "jwt-abc");
        assert_eq!(value["refresh_token"], "refresh-1");
        assert_eq!(value["base_url"], "https://api.arcee.ai");
    }

    #[test]
    fn stored_auth_from_token_success_computes_absolute_expiry() {
        let success = TokenSuccess {
            access_token: "jwt-access".to_string(),
            refresh_token: "opaque-refresh".to_string(),
            token_type: None,
            expires_in: Some(3600),
            base_url: "https://api.arcee.ai".to_string(),
            organization_id: "org-1".to_string(),
            workspace_name: "acme".to_string(),
        };

        let auth = stored_auth_from_token_success(success).unwrap();

        assert_eq!(auth.access_token, "jwt-access");
        assert_eq!(auth.refresh_token, "opaque-refresh");
        assert_eq!(auth.token_type, "bearer");
        assert!(
            auth.expires_at_ms > now_ms(),
            "expiry should be in the future"
        );
    }

    #[tokio::test]
    async fn token_refresh_rotates_and_persists_new_refresh_token() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            json!({
                "access_token": "jwt-access-2",
                "refresh_token": "rotated-refresh-token",
                "token_type": "bearer",
                "expires_in": 3600
            })
            .to_string(),
        )]);

        let outcome = request_token_refresh(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
            "opaque-refresh",
        )
        .await
        .expect("refresh should succeed");
        let requests = server.finish();

        let refreshed = match outcome {
            RefreshOutcome::Success(refreshed) => refreshed,
            RefreshOutcome::Revoked => panic!("unexpected revoked outcome"),
        };
        assert_eq!(refreshed.access_token, "jwt-access-2");
        assert_eq!(
            refreshed.refresh_token.as_deref(),
            Some("rotated-refresh-token")
        );
        assert_eq!(refreshed.expires_in, Some(3600));

        // The rotated refresh token replaces the one we sent — persisting the old
        // one would lock the user out on the next refresh.
        let current = stored_auth("jwt-access-1");
        let updated = stored_auth_from_refresh(current, refreshed);
        assert_eq!(updated.access_token, "jwt-access-2");
        assert_eq!(updated.refresh_token, "rotated-refresh-token");

        assert_eq!(requests.len(), 1);
        assert_device_request(&requests[0], "/app/v1/device/refresh");
        assert_eq!(
            serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
            json!({"refresh_token": "opaque-refresh", "client_id": CLIENT_ID})
        );
    }

    #[test]
    fn refresh_without_rotated_token_keeps_current_refresh_token() {
        let refreshed = RefreshSuccess {
            access_token: "jwt-access-2".to_string(),
            refresh_token: None,
            token_type: None,
            expires_in: Some(3600),
        };

        let updated = stored_auth_from_refresh(stored_auth("jwt-access-1"), refreshed);

        assert_eq!(updated.access_token, "jwt-access-2");
        assert_eq!(updated.refresh_token, "refresh-1");
    }

    #[tokio::test]
    async fn token_refresh_reports_revoked_for_invalid_grant_and_invalid_client() {
        for error in ["invalid_grant", "invalid_client"] {
            let server = ScriptedServer::start(vec![ScriptedResponse::json(
                "400 Bad Request",
                json!({ "error": error }).to_string(),
            )]);

            let outcome = request_token_refresh(
                &no_redirect_client().unwrap(),
                &ArceeAuthService::for_test(&server.base_url),
                "opaque-refresh",
            )
            .await
            .expect("revoked refresh should not be an error");
            server.finish();

            assert!(
                matches!(outcome, RefreshOutcome::Revoked),
                "{error} should map to revoked"
            );
        }
    }

    #[tokio::test]
    async fn token_refresh_propagates_other_http_errors() {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "503 Service Unavailable",
            "upstream unavailable",
        )]);

        let error = request_token_refresh(
            &no_redirect_client().unwrap(),
            &ArceeAuthService::for_test(&server.base_url),
            "opaque-refresh",
        )
        .await
        .expect_err("server error should propagate");
        server.finish();

        assert!(
            error.to_string().contains("HTTP 503"),
            "unexpected error: {error:#}"
        );
    }

    #[test]
    fn arcee_logout_removes_malformed_canonical_and_preserves_auth_json() {
        let dir = TestDir::new("logout-malformed");
        let (auth_path, arcee_path) = dir.paths();
        let auth_json = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
        fs::write(&auth_path, auth_json).unwrap();
        write_credential(&arcee_path, "{ malformed");

        assert!(remove_arcee_auth_file_for_logout(&arcee_path).unwrap());

        assert!(!arcee_path.exists());
        assert_eq!(fs::read_to_string(auth_path).unwrap(), auth_json);
    }

    #[test]
    fn arcee_logout_removes_canonical_and_preserves_auth_json() {
        let dir = TestDir::new("logout-coexistence");
        let (auth_path, arcee_path) = dir.paths();
        let auth_json = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
        fs::write(&auth_path, auth_json).unwrap();
        write_json(&arcee_path, &stored_auth("rcai-canonical"));

        assert!(remove_arcee_auth_file_for_logout(&arcee_path).unwrap());

        assert!(!arcee_path.exists());
        assert_eq!(fs::read_to_string(auth_path).unwrap(), auth_json);
    }

    #[test]
    fn arcee_logout_is_idempotent_when_canonical_file_is_missing() {
        let dir = TestDir::new("logout-missing");
        let (_, canonical) = dir.paths();

        assert!(!remove_arcee_auth_file_for_logout(&canonical).unwrap());
        assert!(!remove_arcee_auth_file_for_logout(&canonical).unwrap());
    }

    #[test]
    fn arcee_logout_preserves_valid_unknown_canonical_record() {
        let dir = TestDir::new("logout-unknown");
        let (auth_path, canonical) = dir.paths();
        let legacy_shaped = serde_json::to_string(&stored_auth("rcai-legacy")).unwrap();
        let unknown = r#"{"type":"future-provider","token":"canonical"}"#;
        fs::write(&auth_path, &legacy_shaped).unwrap();
        write_credential(&canonical, unknown);

        assert!(!remove_arcee_auth_file_for_logout(&canonical).unwrap());
        assert_eq!(fs::read_to_string(auth_path).unwrap(), legacy_shaped);
        assert_eq!(fs::read_to_string(canonical).unwrap(), unknown);
    }

    #[cfg(unix)]
    #[test]
    fn arcee_logout_unlinks_canonical_symlink_without_touching_target() {
        let dir = TestDir::new("logout-symlink");
        let (_, canonical) = dir.paths();
        let target = dir.0.join("target.json");
        fs::write(&target, "target-credentials").unwrap();
        symlink(&target, &canonical).unwrap();

        assert!(remove_arcee_auth_file_for_logout(&canonical).unwrap());

        assert!(fs::symlink_metadata(&canonical).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "target-credentials");
    }
}
