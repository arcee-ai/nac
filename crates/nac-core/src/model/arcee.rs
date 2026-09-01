use super::auth_store::{
    arcee_auth_file_path, arcee_auth_lock_path, read_auth_bytes_from_path,
    read_auth_string_from_path, with_arcee_auth_lock, write_auth_string_to_path, FileLock,
};
use super::*;
use anyhow::Context;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub(super) const LEGACY_CLIENT_ID: &str = "nac-cli";
pub(super) const MANAGED_CLIENT_ID: &str = "managed-nac";
pub(super) const AUTH_TYPE: &str = "arcee_device_token";
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
        .map_err(|error| anyhow!("invalid Arcee base URL '{base_url}': {error}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(anyhow!(
            "invalid Arcee base URL '{base_url}': scheme must be http or https"
        ));
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow!("invalid Arcee base URL '{base_url}': URL must include a host"))?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow!(
            "invalid Arcee base URL '{base_url}': userinfo is not allowed"
        ));
    }
    if parsed.query().is_some() {
        return Err(anyhow!(
            "invalid Arcee base URL '{base_url}': query parameters are not allowed"
        ));
    }
    if parsed.fragment().is_some() {
        return Err(anyhow!(
            "invalid Arcee base URL '{base_url}': fragments are not allowed"
        ));
    }

    let arcee_owned = host == "arcee.ai" || host.ends_with(".arcee.ai");
    if !arcee_owned {
        return Ok((ArceeEndpointKind::Unapproved, parsed));
    }
    if parsed.scheme() != "https" {
        return Err(anyhow!(
            "invalid Arcee base URL '{base_url}': Arcee-owned endpoints require HTTPS"
        ));
    }
    if parsed.port_or_known_default() != Some(443) {
        return Err(anyhow!(
            "invalid Arcee base URL '{base_url}': Arcee-owned endpoints require effective port 443"
        ));
    }

    Ok((ArceeEndpointKind::Approved, parsed))
}

pub(super) fn validate_approved_base_url(base_url: &str) -> Result<Url> {
    let (kind, parsed) = validate_arcee_base_url(base_url)?;
    if kind != ArceeEndpointKind::Approved {
        return Err(anyhow!(
            "Arcee base URL '{base_url}' is not an approved Arcee origin"
        ));
    }
    chat_completions_url(base_url)?;
    Ok(parsed)
}

pub(super) fn validate_stored_base_url(base_url: &str) -> Result<Url> {
    let (kind, parsed) = validate_arcee_base_url(base_url)?;
    if kind != ArceeEndpointKind::Approved {
        return Err(anyhow!(
            "stored Arcee base URL '{base_url}' is not an approved Arcee origin"
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
                    "invalid Arcee base URL '{base_url}': path contains malformed percent encoding"
                ));
            };
            decoded.push((high << 4) | low);
            index += 3;
        }

        if decoded == b"." || decoded == b".." {
            return Err(anyhow!(
                "invalid Arcee base URL '{base_url}': dot path segments, including percent-encoded forms, are not allowed"
            ));
        }
        if had_percent_encoding
            && [b"api".as_slice(), b"v1", b"chat", b"completions"]
                .iter()
                .any(|control| decoded.eq_ignore_ascii_case(control))
        {
            return Err(anyhow!(
                "invalid Arcee base URL '{base_url}': percent-encoded route-control segments are not allowed; use literal path segments"
            ));
        }
        if had_percent_encoding
            && decoded
                .iter()
                .any(|byte| matches!(byte, b'/' | b'\\' | b'?' | b'#'))
        {
            return Err(anyhow!(
                "invalid Arcee base URL '{base_url}': percent-encoded path delimiters are not allowed"
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
        .ok_or_else(|| anyhow!("invalid Arcee base URL '{base_url}': URL cannot be a base"))?
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
        let mut segments = parsed
            .path_segments_mut()
            .map_err(|_| anyhow!("invalid Arcee base URL '{base_url}': URL cannot be a base"))?;
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
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| anyhow!("invalid Arcee base URL '{base_url}': URL cannot be a base"))?;
        segments.pop();
        segments.pop();
        segments.push("models");
    }
    Ok(url)
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct StoredArceeAuth {
    #[serde(rename = "type")]
    pub(super) auth_type: String,
    pub(super) access_token: String,
    pub(super) refresh_token: String,
    pub(super) token_type: String,
    pub(super) expires_at_ms: u64,
    pub(super) base_url: String,
    pub(super) organization_id: String,
    pub(super) workspace_name: String,
    #[serde(default = "legacy_client_id")]
    pub(super) client_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) managed_bootstrap: Option<ManagedBootstrapProvenance>,
}

impl std::fmt::Debug for StoredArceeAuth {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("StoredArceeAuth")
            .field("auth_type", &self.auth_type)
            .field("token_type", &self.token_type)
            .field("expires_at_ms", &self.expires_at_ms)
            .field("base_url", &self.base_url)
            .field("organization_id", &self.organization_id)
            .field("workspace_name", &self.workspace_name)
            .field("client_id", &self.client_id)
            .field("managed_bootstrap", &self.managed_bootstrap)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct ManagedBootstrapProvenance {
    pub(super) bootstrap_id: Uuid,
    pub(super) managed_host_id: Uuid,
}

fn legacy_client_id() -> String {
    LEGACY_CLIENT_ID.to_string()
}

#[derive(Deserialize)]
struct TokenSuccess {
    access_token: String,
    refresh_token: String,
    token_type: Option<String>,
    expires_in: Option<u64>,
    base_url: String,
    organization_id: String,
    workspace_name: String,
}

impl std::fmt::Debug for TokenSuccess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("TokenSuccess")
            .field("token_type", &self.token_type)
            .field("expires_in", &self.expires_in)
            .field("base_url", &self.base_url)
            .field("organization_id", &self.organization_id)
            .field("workspace_name", &self.workspace_name)
            .finish_non_exhaustive()
    }
}

#[derive(Deserialize)]
pub(super) struct RefreshSuccess {
    pub(super) access_token: String,
    pub(super) refresh_token: Option<String>,
    pub(super) token_type: Option<String>,
    pub(super) expires_in: Option<u64>,
}

impl std::fmt::Debug for RefreshSuccess {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("RefreshSuccess")
            .field("has_rotated_refresh_token", &self.refresh_token.is_some())
            .field("token_type", &self.token_type)
            .field("expires_in", &self.expires_in)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub(super) enum RefreshOutcome {
    Success(RefreshSuccess),
    Revoked,
}

struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    interval_secs: u64,
    expires_in_secs: u64,
}

impl std::fmt::Debug for DeviceCode {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("DeviceCode")
            .field("interval_secs", &self.interval_secs)
            .field("expires_in_secs", &self.expires_in_secs)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone)]
pub(super) struct ArceeAuthService {
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
    pub(super) fn for_test(base_url: &str) -> Self {
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

#[expect(
    clippy::expect_used,
    reason = "the canonical Arcee authentication URL is a compile-time invariant"
)]
fn validate_auth_service_base_url(base_url: &str) -> Result<()> {
    let parsed = validate_approved_base_url(base_url)
        .with_context(|| format!("invalid Arcee auth service URL '{base_url}'"))?;
    let canonical = Url::parse(CANONICAL_AUTH_SERVICE_BASE_URL)
        .expect("canonical Arcee auth service URL must remain valid");
    if parsed.origin() != canonical.origin() || parsed.path() != "/" {
        return Err(anyhow!(
            "Arcee auth service URL '{base_url}' is not the canonical origin {CANONICAL_AUTH_SERVICE_BASE_URL}"
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
        client_id: LEGACY_CLIENT_ID.to_string(),
        managed_bootstrap: None,
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
async fn acquire_refresh_lock(lock_path: &Path) -> Result<FileLock> {
    let started = now_ms();
    loop {
        if let Some(lock) = nac_credential_store::try_acquire_credential_lock(lock_path)? {
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
    let service = ArceeAuthService::canonical()?;
    let auth_path = arcee_auth_file_path()?;
    let lock_path = arcee_auth_lock_path()?;
    refresh_locked_with(
        client,
        expected_base_url,
        should_refresh,
        &service,
        &auth_path,
        &lock_path,
    )
    .await
}

async fn refresh_locked_with(
    client: &Client,
    expected_base_url: &str,
    should_refresh: impl Fn(&StoredArceeAuth) -> bool,
    service: &ArceeAuthService,
    auth_path: &Path,
    lock_path: &Path,
) -> Result<String> {
    let _gate = refresh_gate().lock().await;
    let _lock = acquire_refresh_lock(lock_path).await?;
    let auth = read_stored_auth_for_base_url_at(auth_path, expected_base_url)?;
    if !should_refresh(&auth) {
        return Ok(auth.access_token);
    }
    Ok(refresh_and_store_auth_at(client, service, auth_path, auth)
        .await?
        .access_token)
}

async fn refresh_and_store_auth_at(
    client: &Client,
    service: &ArceeAuthService,
    auth_path: &Path,
    current: StoredArceeAuth,
) -> Result<StoredArceeAuth> {
    match request_token_refresh(client, service, &current.refresh_token, &current.client_id).await?
    {
        RefreshOutcome::Success(refreshed) => {
            let updated = stored_auth_from_refresh(current, refreshed);
            write_stored_auth_at(auth_path, &updated)?;
            Ok(updated)
        }
        RefreshOutcome::Revoked => {
            let _ = remove_auth_path(auth_path);
            Err(stored_auth_configuration_error(
                "Arcee authorization was revoked or expired; run `nac arcee-auth login` again.",
            ))
        }
    }
}

pub(super) fn stored_auth_from_refresh(
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
        client_id: current.client_id,
        managed_bootstrap: current.managed_bootstrap,
    }
}

pub(super) async fn request_token_refresh(
    client: &Client,
    service: &ArceeAuthService,
    refresh_token: &str,
    client_id: &str,
) -> Result<RefreshOutcome> {
    let url = service.device_refresh_url();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", user_agent())
        .json(&json!({ "refresh_token": refresh_token, "client_id": client_id }))
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

pub(super) fn read_stored_auth_for_base_url(expected_base_url: &str) -> Result<StoredArceeAuth> {
    read_stored_auth_for_base_url_at(&arcee_auth_file_path()?, expected_base_url)
}

fn read_stored_auth_for_base_url_at(
    path: &Path,
    expected_base_url: &str,
) -> Result<StoredArceeAuth> {
    let auth = read_stored_auth_optional_at(path)
        .map_err(classify_stored_auth_data_error)?
        .ok_or_else(|| {
            stored_auth_configuration_error(
                "Arcee auth is not configured. Run `nac arcee-auth login` to sign in.",
            )
        })?;
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
    read_stored_auth_optional_at(&path)
}

fn read_stored_auth_optional_at(path: &Path) -> Result<Option<StoredArceeAuth>> {
    let raw = match read_auth_string_from_path(path)? {
        Some(raw) => raw,
        None => return Ok(None),
    };
    parse_stored_auth(&raw, path)
}

pub(super) fn parse_stored_auth(raw: &str, path: &Path) -> Result<Option<StoredArceeAuth>> {
    let value: Value = serde_json::from_str(raw).map_err(|_| {
        stored_auth_configuration_error(format!(
            "failed to parse stored Arcee auth in {}",
            path.display()
        ))
    })?;
    if value.get("type").and_then(Value::as_str) != Some(AUTH_TYPE) {
        return Ok(None);
    }
    let auth: StoredArceeAuth = serde_json::from_value(value).map_err(|_| {
        stored_auth_configuration_error(format!(
            "failed to parse stored Arcee auth schema in {}",
            path.display()
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
    if !matches!(
        auth.client_id.as_str(),
        LEGACY_CLIENT_ID | MANAGED_CLIENT_ID
    ) {
        return Err(stored_auth_configuration_error(format!(
            "stored Arcee auth in {} has an unsupported client_id",
            path.display()
        )));
    }
    validate_stored_base_url(&auth.base_url).map_err(|_| {
        stored_auth_configuration_error(format!(
            "stored Arcee auth in {} has an invalid base_url",
            path.display()
        ))
    })?;
    Ok(Some(auth))
}

fn write_stored_auth(auth: &StoredArceeAuth) -> Result<()> {
    write_stored_auth_at(&arcee_auth_file_path()?, auth)
}

fn write_stored_auth_at(path: &Path, auth: &StoredArceeAuth) -> Result<()> {
    validate_stored_base_url(&auth.base_url)
        .context("refusing to store Arcee credentials with an invalid base_url")?;
    let raw = serde_json::to_string_pretty(auth).context("failed to serialize Arcee auth")?;
    write_auth_string_to_path(path, &raw)
}

async fn request_device_code(client: &Client, service: &ArceeAuthService) -> Result<DeviceCode> {
    let url = service.device_code_url();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", user_agent())
        .json(&json!({ "client_id": LEGACY_CLIENT_ID }))
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
            .json(&json!({ "device_code": device.device_code, "client_id": LEGACY_CLIENT_ID }))
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
                interval_secs = interval_secs.saturating_add(SLOW_DOWN_BACKOFF_SECS);
            }
            Some("access_denied") => return Err(anyhow!("Arcee authorization was denied")),
            Some("expired_token") => {
                return Err(anyhow!(
                    "Arcee device code expired; run `nac arcee-auth login` again"
                ))
            }
            Some(other) => {
                let message = redact_credentials(
                    other,
                    &[device.device_code.as_str(), device.user_code.as_str()],
                );
                return Err(anyhow!("Arcee device authorization failed: {message}"));
            }
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
#[path = "arcee_tests.rs"]
mod tests;
