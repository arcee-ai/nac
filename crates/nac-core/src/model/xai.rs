use super::auth_store::{
    read_auth_bytes_from_path, with_credential_lock, write_auth_string_to_path,
};
use super::*;
use anyhow::Context;
use std::fmt;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const CLIENT_ID: &str = "b1a00492-073a-47ea-816f-4c329264a828";
const DEVICE_CODE_URL: &str = "https://auth.x.ai/oauth2/device/code";
const TOKEN_URL: &str = "https://auth.x.ai/oauth2/token";
const SCOPE: &str = "openid profile email offline_access grok-cli:access api:access";
const AUTH_TYPE: &str = "xai-oauth";
const DEFAULT_EXPIRES_IN_SECS: u64 = 3600;
const DEFAULT_INTERVAL_SECS: u64 = 5;
const DEFAULT_DEVICE_EXPIRES_IN_SECS: u64 = 1800;
const REFRESH_SKEW_MS: u64 = 60_000;
const SLOW_DOWN_BACKOFF_SECS: u64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredXaiAuth {
    #[serde(rename = "type")]
    auth_type: String,
    access: String,
    refresh: String,
    expires_at_ms: u64,
    account: String,
}

#[derive(Debug)]
pub(super) struct StoredXaiAuthConfigurationError {
    message: String,
}

impl fmt::Display for StoredXaiAuthConfigurationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StoredXaiAuthConfigurationError {}

fn stored_auth_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(StoredXaiAuthConfigurationError {
        message: message.into(),
    })
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    interval_secs: u64,
    expires_in_secs: u64,
}

pub(super) struct XaiDeviceLogin {
    client: Client,
    device: DeviceCode,
}

impl XaiDeviceLogin {
    pub(super) fn prompt(&self) -> DeviceLoginPrompt {
        DeviceLoginPrompt {
            verification_uri: self.device.verification_uri.clone(),
            user_code: Some(self.device.user_code.clone()),
            expires_in_secs: self.device.expires_in_secs,
        }
    }

    pub(super) async fn complete(self) -> Result<ManagedAuthSnapshot> {
        let tokens = poll_device_code(&self.client, &self.device).await?;
        store_tokens(tokens, None)
    }
}

pub(super) async fn begin_xai_device_login() -> Result<XaiDeviceLogin> {
    let client = Client::new();
    let device = request_device_code(&client).await?;
    Ok(XaiDeviceLogin { client, device })
}

pub(super) fn validate_base_url(base_url: &str) -> Result<Url> {
    let parsed = Url::parse(base_url)
        .map_err(|error| anyhow!("invalid xAI SuperGrok base URL '{}': {}", base_url, error))?;
    if parsed.scheme() != "https" {
        return Err(anyhow!(
            "invalid xAI SuperGrok base URL '{}': managed SuperGrok requires HTTPS",
            base_url
        ));
    }
    if parsed.host_str() != Some("api.x.ai") {
        return Err(anyhow!(
            "invalid xAI SuperGrok base URL '{}': managed SuperGrok requires the approved xAI origin",
            base_url
        ));
    }
    if parsed.port_or_known_default() != Some(443) {
        return Err(anyhow!(
            "invalid xAI SuperGrok base URL '{}': managed SuperGrok requires effective port 443",
            base_url
        ));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(anyhow!(
            "invalid xAI SuperGrok base URL '{}': userinfo is not allowed",
            base_url
        ));
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err(anyhow!(
            "invalid xAI SuperGrok base URL '{}': query parameters and fragments are not allowed",
            base_url
        ));
    }
    if !matches!(parsed.path(), "/v1" | "/v1/") {
        return Err(anyhow!(
            "invalid xAI SuperGrok base URL '{}': managed SuperGrok requires path '/v1'",
            base_url
        ));
    }
    Ok(parsed)
}

pub(super) fn stored_credential_present() -> bool {
    matches!(read_auth_file_optional_for_status(), Ok(Some(_)))
}

pub(super) fn preflight_stored_auth() -> Result<()> {
    let _lock = acquire_auth_lock()?;
    read_auth_file().map(|_| ())
}

pub(super) fn xai_auth_snapshot() -> Result<ManagedAuthSnapshot> {
    let path = auth_file_path()?;
    Ok(snapshot_from_stored(
        read_auth_file_optional_for_status()?,
        path,
    ))
}

fn snapshot_from_stored(auth: Option<StoredXaiAuth>, path: PathBuf) -> ManagedAuthSnapshot {
    ManagedAuthSnapshot {
        provider: ManagedAuthProvider::Xai,
        signed_in: auth.is_some(),
        account: auth.as_ref().map(|auth| auth.account.clone()),
        organization: None,
        base_url: None,
        expires_at_ms: auth.as_ref().map(|auth| auth.expires_at_ms),
        path: path.display().to_string(),
    }
}

pub(super) fn xai_auth_remove() -> Result<bool> {
    let path = auth_file_path()?;
    with_auth_lock(|| {
        if auth_path_is_symlink(&path)? {
            return remove_auth_path(&path);
        }
        remove_xai_auth_file_for_logout(&path)
    })
}

pub async fn xai_auth_login() -> Result<()> {
    let login = begin_xai_device_login().await?;
    let prompt = login.prompt();

    println!("Open this URL in a browser:");
    println!("{}", prompt.verification_uri);
    if let Some(code) = &prompt.user_code {
        println!();
        println!("Confirm this code:");
        println!("{code}");
    }
    println!();
    if crate::browser::should_open_browser() {
        println!("Opening the authorization page in your browser…");
        crate::browser::open_url(&prompt.verification_uri);
    }
    println!("Waiting for authorization...");

    let snapshot = login.complete().await?;

    println!("xAI SuperGrok auth saved.");
    println!("account: {}", snapshot.account.unwrap_or_default());
    println!("path: {}", snapshot.path);

    Ok(())
}

pub fn xai_auth_logout() -> Result<()> {
    let path = auth_file_path()?;
    let removed = xai_auth_remove()?;

    if removed {
        println!("xAI SuperGrok auth removed.");
    } else {
        println!("No xAI SuperGrok auth found.");
    }
    println!("path: {}", path.display());
    Ok(())
}

pub fn xai_auth_status() -> Result<()> {
    let snapshot = xai_auth_snapshot()?;
    if snapshot.signed_in {
        println!("xAI SuperGrok auth: signed in");
        println!("account: {}", snapshot.account.unwrap_or_default());
        println!(
            "expires: {}",
            expiry_status(snapshot.expires_at_ms.unwrap_or_default())
        );
    } else {
        println!("xAI SuperGrok auth: not signed in");
    }
    println!("path: {}", snapshot.path);
    Ok(())
}

pub(super) async fn stored_auth_for_request(client: &Client) -> Result<String> {
    let auth = fresh_auth(client).await?;
    Ok(auth.access)
}

pub(super) async fn force_refresh_access_token(client: &Client) -> Result<String> {
    let auth = force_refresh_auth(client).await?;
    Ok(auth.access)
}

async fn request_device_code(client: &Client) -> Result<DeviceCode> {
    let response = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[("client_id", CLIENT_ID), ("scope", SCOPE)])
        .send()
        .await
        .context("failed to request xAI SuperGrok device code")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read xAI SuperGrok device-code response")?;
    if !status.is_success() {
        return Err(anyhow!(
            "xAI SuperGrok device-code request failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&redact_credentials(&body, &[]))
        ));
    }

    let value: Value = serde_json::from_str(&body)
        .context("failed to parse xAI SuperGrok device-code response")?;
    let device_code = required_string(&value, "device_code")?;
    let user_code = required_string(&value, "user_code")?;
    let verification_uri = value
        .get("verification_uri_complete")
        .and_then(Value::as_str)
        .or_else(|| value.get("verification_uri").and_then(Value::as_str))
        .ok_or_else(|| {
            anyhow!("xAI SuperGrok device-code response did not include verification_uri")
        })?;
    let verification_uri = https_verification_uri(verification_uri)?;
    let interval_secs = interval_secs(value.get("interval"))
        .unwrap_or(DEFAULT_INTERVAL_SECS)
        .max(1);
    let expires_in_secs = value
        .get("expires_in")
        .and_then(Value::as_u64)
        .unwrap_or(DEFAULT_DEVICE_EXPIRES_IN_SECS)
        .max(1);

    Ok(DeviceCode {
        device_code,
        user_code,
        verification_uri,
        interval_secs,
        expires_in_secs,
    })
}

async fn poll_device_code(client: &Client, device: &DeviceCode) -> Result<TokenResponse> {
    let started = now_ms();
    let mut interval_secs = device.interval_secs;
    loop {
        let response = client
            .post(TOKEN_URL)
            .header("Accept", "application/json")
            .header("Content-Type", "application/x-www-form-urlencoded")
            .form(&[
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", device.device_code.as_str()),
                ("client_id", CLIENT_ID),
            ])
            .send()
            .await
            .context("failed to poll xAI SuperGrok device authorization")?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read xAI SuperGrok device authorization response")?;
        let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
        let error = value.get("error").and_then(Value::as_str).unwrap_or("");

        if status.is_success() {
            return serde_json::from_str(&body)
                .context("failed to parse xAI SuperGrok token response");
        }

        match error {
            "authorization_pending" => {}
            "slow_down" => {
                interval_secs = value
                    .get("interval")
                    .and_then(Value::as_u64)
                    .filter(|secs| *secs > 0)
                    .unwrap_or_else(|| interval_secs.saturating_add(SLOW_DOWN_BACKOFF_SECS));
            }
            "expired_token" | "access_denied" | "authorization_denied" => {
                return Err(anyhow!(
                    "xAI SuperGrok device authorization failed: {}",
                    value
                        .get("error_description")
                        .and_then(Value::as_str)
                        .unwrap_or(error)
                ));
            }
            _ => {
                return Err(anyhow!(
                    "xAI SuperGrok device authorization failed with HTTP {}: {}",
                    status.as_u16(),
                    truncate(&redact_credentials(
                        &body,
                        &[device.device_code.as_str(), device.user_code.as_str()]
                    ))
                ));
            }
        }

        if now_ms().saturating_sub(started) >= device.expires_in_secs.saturating_mul(1000) {
            return Err(anyhow!("xAI SuperGrok device authorization timed out"));
        }

        sleep(Duration::from_secs(interval_secs)).await;
    }
}

async fn refresh_access_token(client: &Client, refresh_token: &str) -> Result<TokenResponse> {
    let response = client
        .post(TOKEN_URL)
        .header("Accept", "application/json")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", CLIENT_ID),
        ])
        .send()
        .await
        .context("failed to refresh xAI SuperGrok access token")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read xAI SuperGrok token refresh response")?;
    if !status.is_success() {
        return Err(anyhow!(
            "xAI SuperGrok token refresh failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&redact_credentials(&body, &[refresh_token]))
        ));
    }
    serde_json::from_str(&body).context("failed to parse xAI SuperGrok token refresh response")
}

fn store_tokens(
    tokens: TokenResponse,
    prior: Option<&StoredXaiAuth>,
) -> Result<ManagedAuthSnapshot> {
    let auth = auth_from_token_response(tokens, prior)?;
    with_auth_lock(|| write_auth_file(&auth))?;
    Ok(snapshot_from_stored(Some(auth), auth_file_path()?))
}

async fn fresh_auth(client: &Client) -> Result<StoredXaiAuth> {
    let _lock = acquire_auth_lock()?;
    let auth = read_auth_file()?;
    if auth.expires_at_ms > now_ms().saturating_add(REFRESH_SKEW_MS) {
        return Ok(auth);
    }
    refresh_and_store_auth(client, auth).await
}

async fn force_refresh_auth(client: &Client) -> Result<StoredXaiAuth> {
    let _lock = acquire_auth_lock()?;
    let auth = read_auth_file()?;
    refresh_and_store_auth(client, auth).await
}

async fn refresh_and_store_auth(client: &Client, current: StoredXaiAuth) -> Result<StoredXaiAuth> {
    let tokens = refresh_access_token(client, &current.refresh).await?;
    let refreshed = auth_from_token_response(tokens, Some(&current))?;
    write_auth_file(&refreshed)?;
    Ok(refreshed)
}

fn auth_from_token_response(
    response: TokenResponse,
    prior: Option<&StoredXaiAuth>,
) -> Result<StoredXaiAuth> {
    let account = account_from_token(&response.access_token)
        .or_else(|| prior.map(|auth| auth.account.clone()))
        .unwrap_or_else(|| "xai".to_string());
    let refresh = response
        .refresh_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| prior.map(|auth| auth.refresh.clone()))
        .ok_or_else(|| anyhow!("xAI SuperGrok token response did not include a refresh token"))?;
    let expires_in = response.expires_in.unwrap_or(DEFAULT_EXPIRES_IN_SECS);
    Ok(StoredXaiAuth {
        auth_type: AUTH_TYPE.to_string(),
        access: response.access_token,
        refresh,
        expires_at_ms: now_ms().saturating_add(expires_in.saturating_mul(1000)),
        account,
    })
}

fn https_verification_uri(url: &str) -> Result<String> {
    let parsed = Url::parse(url).map_err(|error| {
        anyhow!("xAI SuperGrok device-code response had an invalid verification URL: {error}")
    })?;
    if parsed.scheme() != "https" {
        return Err(anyhow!(
            "xAI SuperGrok device-code response returned a non-HTTPS verification URL"
        ));
    }
    Ok(parsed.to_string())
}

fn account_from_token(token: &str) -> Option<String> {
    let payload = decode_jwt_payload(token)?;
    payload
        .get("email")
        .and_then(Value::as_str)
        .or_else(|| payload.get("sub").and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let bytes = base64_url_decode(payload)?;
    serde_json::from_slice(&bytes).ok()
}

fn base64_url_decode(input: &str) -> Option<Vec<u8>> {
    let mut padded = input.replace('-', "+").replace('_', "/");
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    let mut out = Vec::with_capacity(padded.len() / 4 * 3);
    let table = |byte: u8| -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            b'=' => Some(0),
            _ => None,
        }
    };
    for chunk in padded.as_bytes().chunks(4) {
        if chunk.len() != 4 {
            return None;
        }
        let a = table(chunk[0])?;
        let b = table(chunk[1])?;
        let c = table(chunk[2])?;
        let d = table(chunk[3])?;
        out.push((a << 2) | (b >> 4));
        if chunk[2] != b'=' {
            out.push((b << 4) | (c >> 2));
        }
        if chunk[3] != b'=' {
            out.push((c << 6) | d);
        }
    }
    Some(out)
}

fn required_string(value: &Value, field: &str) -> Result<String> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .ok_or_else(|| anyhow!("xAI SuperGrok device-code response did not include {field}"))
}

fn interval_secs(value: Option<&Value>) -> Option<u64> {
    value.and_then(|value| value.as_u64().or_else(|| value.as_f64().map(|n| n as u64)))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn expiry_status(expires_at_ms: u64) -> String {
    if expires_at_ms == 0 {
        return "unknown".to_string();
    }
    let now = now_ms();
    if expires_at_ms <= now {
        "expired".to_string()
    } else {
        format!("in {}s", (expires_at_ms - now) / 1000)
    }
}

fn truncate(value: &str) -> String {
    const MAX: usize = 400;
    match value.char_indices().nth(MAX) {
        Some((index, _)) => format!("{}…", &value[..index]),
        None => value.to_string(),
    }
}

fn auth_file_path() -> Result<PathBuf> {
    crate::paths::nac_home_dir()
        .map(|dir| dir.join("xai_auth.json"))
        .ok_or_else(|| {
            anyhow!("could not determine NAC_HOME or HOME for xAI SuperGrok auth storage")
        })
}

fn auth_lock_path() -> Result<PathBuf> {
    Ok(auth_file_path()?.with_extension("json.lock"))
}

fn acquire_auth_lock() -> Result<auth_store::FileLock> {
    let path = auth_lock_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    auth_store::FileLock::acquire(&path)
}

fn with_auth_lock<T>(operation: impl FnOnce() -> Result<T>) -> Result<T> {
    with_credential_lock(&auth_lock_path()?, operation)
}

fn read_auth_file_optional_for_status() -> Result<Option<StoredXaiAuth>> {
    read_auth_file_optional_from_path_with_policy(&auth_file_path()?, true)
}

fn read_auth_file_optional() -> Result<Option<StoredXaiAuth>> {
    read_auth_file_optional_from_path_with_policy(&auth_file_path()?, false)
}

fn read_auth_file_optional_from_path_with_policy(
    path: &Path,
    foreign_provider_is_missing: bool,
) -> Result<Option<StoredXaiAuth>> {
    let raw = match read_auth_bytes_from_path(path)? {
        Some(raw) => raw,
        None => return Ok(None),
    };
    let raw = String::from_utf8(raw).map_err(|_| {
        stored_auth_configuration_error(format!(
            "xAI SuperGrok credential file {} is not valid UTF-8",
            path.display()
        ))
    })?;
    let value: Value = serde_json::from_str(&raw).map_err(|_| {
        stored_auth_configuration_error(format!(
            "failed to parse xAI SuperGrok credentials in {}",
            path.display()
        ))
    })?;
    let provider = value.get("type").and_then(Value::as_str);
    if provider != Some(AUTH_TYPE) {
        if foreign_provider_is_missing {
            return Ok(None);
        }
        return Err(stored_auth_configuration_error(format!(
            "xAI SuperGrok credentials in {} have an invalid or unsupported provider type",
            path.display()
        )));
    }
    let auth: StoredXaiAuth = serde_json::from_value(value).map_err(|_| {
        stored_auth_configuration_error(format!(
            "xAI SuperGrok credentials in {} do not match the required schema",
            path.display()
        ))
    })?;
    validate_stored_auth(&auth, path)?;
    Ok(Some(auth))
}

fn validate_stored_auth(auth: &StoredXaiAuth, path: &Path) -> Result<()> {
    for (field, value) in [
        ("access", auth.access.as_str()),
        ("refresh", auth.refresh.as_str()),
        ("account", auth.account.as_str()),
    ] {
        if value.trim().is_empty() {
            return Err(stored_auth_configuration_error(format!(
                "xAI SuperGrok credentials in {} require nonblank field '{}'",
                path.display(),
                field
            )));
        }
    }
    Ok(())
}

fn read_auth_file() -> Result<StoredXaiAuth> {
    read_auth_file_optional()?.ok_or_else(|| {
        stored_auth_configuration_error(
            "xAI SuperGrok auth is not configured. Run `nac-web xai-auth login` to sign in with SuperGrok.",
        )
    })
}

fn write_auth_file(auth: &StoredXaiAuth) -> Result<()> {
    let path = auth_file_path()?;
    validate_stored_auth(auth, &path)?;
    let raw =
        serde_json::to_string_pretty(auth).context("failed to serialize xAI SuperGrok auth")?;
    write_auth_string_to_path(&path, &raw)
}

fn auth_path_is_symlink(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_symlink()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("failed to inspect {}", path.display())),
    }
}

fn remove_xai_auth_file_for_logout(path: &Path) -> Result<bool> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn approved_xai_urls_are_the_canonical_v1_origin() {
        for url in ["https://api.x.ai/v1", "https://api.x.ai/v1/"] {
            validate_base_url(url).unwrap_or_else(|error| panic!("{url}: {error}"));
        }
    }

    #[test]
    fn verification_uris_must_be_https() {
        assert!(https_verification_uri("https://accounts.x.ai/oauth2/device").is_ok());
        assert!(https_verification_uri("http://accounts.x.ai/oauth2/device").is_err());
    }

    #[test]
    fn refresh_keeps_the_prior_refresh_token_when_xai_omits_it() {
        let prior = StoredXaiAuth {
            auth_type: AUTH_TYPE.to_string(),
            access: "old-access".to_string(),
            refresh: "keep-me".to_string(),
            expires_at_ms: 1,
            account: "old@example.com".to_string(),
        };
        let auth = auth_from_token_response(
            TokenResponse {
                access_token: "new-access".to_string(),
                refresh_token: None,
                expires_in: Some(60),
            },
            Some(&prior),
        )
        .unwrap();
        assert_eq!(auth.access, "new-access");
        assert_eq!(auth.refresh, "keep-me");
        assert_eq!(auth.account, "old@example.com");
    }

    #[test]
    fn unapproved_xai_urls_are_rejected() {
        for url in [
            "http://api.x.ai/v1",
            "https://api.x.ai",
            "https://api.x.ai/v1/responses",
            "https://cli-chat-proxy.grok.com/v1",
            "https://user@api.x.ai/v1",
            "https://api.x.ai/v1?x=1",
        ] {
            let error = validate_base_url(url).unwrap_err().to_string();
            assert!(
                error.contains("invalid xAI SuperGrok base URL"),
                "{url}: {error}"
            );
        }
    }
}
