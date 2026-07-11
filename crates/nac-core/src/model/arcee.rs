use super::auth_store::{
    arcee_auth_file_path, legacy_auth_file_path, read_arcee_auth_string, read_auth_bytes_from_path,
    read_auth_string_from_path, with_arcee_auth_lock, with_arcee_migration_locks,
    write_arcee_auth_string, write_auth_string_to_path,
};
use super::*;
use anyhow::Context;
use std::fs;
use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const CLIENT_ID: &str = "nac-cli";
const AUTH_TYPE: &str = "arcee_api_key";
const DEFAULT_BASE_URL: &str = "https://api.arcee.ai";
const DEFAULT_INTERVAL_SECS: u64 = 5;
const DEFAULT_EXPIRES_IN_SECS: u64 = 900;
const SLOW_DOWN_BACKOFF_SECS: u64 = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ArceeEndpointKind {
    Approved,
    Custom,
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
        return Ok((ArceeEndpointKind::Custom, parsed));
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

pub(super) fn validate_stored_base_url(base_url: &str) -> Result<Url> {
    let (kind, parsed) = validate_arcee_base_url(base_url)?;
    if kind != ArceeEndpointKind::Approved {
        return Err(anyhow!(
            "stored Arcee base URL '{}' is not an approved Arcee origin",
            base_url
        ));
    }
    Ok(parsed)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct StoredArceeAuth {
    #[serde(rename = "type")]
    auth_type: String,
    pub(super) api_key: String,
    pub(super) base_url: String,
    organization_id: String,
    workspace_name: String,
}

#[derive(Debug, Deserialize)]
struct TokenSuccess {
    api_key: String,
    base_url: String,
    organization_id: String,
    workspace_name: String,
}

#[derive(Debug)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    interval_secs: u64,
    expires_in_secs: u64,
}

pub(super) async fn arcee_auth_login() -> Result<()> {
    let client = Client::new();
    let base = arcee_api_base();
    let device = request_device_code(&client, &base).await?;

    println!("Open this URL in a browser to authorize nac:");
    println!("{}", device.verification_uri_complete);
    println!();
    println!("Confirm this code matches what the page shows:");
    println!("{}", device.user_code);
    println!();
    println!("Waiting for authorization...");

    let success = poll_device_code(&client, &base, &device).await?;
    let auth = stored_auth_from_token_success(success)?;
    with_arcee_migration_locks(|| {
        migrate_legacy_auth_unlocked()?;
        write_stored_auth(&auth)
    })?;

    println!("Arcee auth saved.");
    println!("workspace: {}", auth.workspace_name);
    println!("base_url: {}", auth.base_url);
    println!("path: {}", arcee_auth_file_path()?.display());
    Ok(())
}

pub(super) fn arcee_auth_status() -> Result<()> {
    let path = arcee_auth_file_path()?;
    let auth = with_arcee_migration_locks(|| {
        migrate_legacy_auth_unlocked()?;
        read_stored_auth_optional()
    })?;
    match auth {
        Some(auth) => {
            println!("Arcee auth: signed in");
            println!("workspace: {}", auth.workspace_name);
            println!("organization: {}", auth.organization_id);
            println!("base_url: {}", auth.base_url);
            println!("path: {}", path.display());
        }
        None => {
            println!("Arcee auth: not signed in");
            println!("path: {}", path.display());
        }
    }
    Ok(())
}

pub(super) fn arcee_auth_logout() -> Result<()> {
    let path = arcee_auth_file_path()?;
    let legacy_path = legacy_auth_file_path()?;
    let removed =
        with_arcee_migration_locks(|| remove_arcee_auth_files_for_logout(&legacy_path, &path))?;
    if removed {
        println!("Arcee auth removed.");
    } else {
        println!("No Arcee auth found.");
    }
    println!("path: {}", path.display());
    Ok(())
}

fn remove_arcee_auth_files_for_logout(legacy_path: &Path, canonical_path: &Path) -> Result<bool> {
    let remove_canonical = logout_disposition(canonical_path, true)?;
    let remove_legacy = logout_disposition(legacy_path, false)?;

    let canonical_removed = if remove_canonical {
        remove_auth_path(canonical_path)?
    } else {
        false
    };
    let legacy_removed = if remove_legacy {
        remove_auth_path(legacy_path)?
    } else {
        false
    };
    Ok(canonical_removed || legacy_removed)
}

fn logout_disposition(path: &Path, malformed_is_owned: bool) -> Result<bool> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", path.display()))
        }
    };

    if metadata.file_type().is_symlink() {
        // The canonical path belongs to Arcee, so unlink it without following it.
        // A legacy auth.json symlink is shared with Codex and cannot be safely classified.
        if malformed_is_owned {
            return Ok(true);
        }
        return Err(anyhow!(
            "refusing to inspect shared legacy credential symlink {}; remove the symlink manually before retrying logout",
            path.display()
        ));
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
        Err(_) => return Ok(malformed_is_owned),
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
    Ok(StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        api_key: success.api_key,
        base_url: success.base_url,
        organization_id: success.organization_id,
        workspace_name: success.workspace_name,
    })
}

pub(super) fn read_stored_auth() -> Result<StoredArceeAuth> {
    with_arcee_migration_locks(|| {
        migrate_legacy_auth_unlocked()?;
        read_stored_auth_optional()
    })?
    .ok_or_else(|| anyhow!("Arcee auth is not configured. Run `nac arcee-auth login` to sign in."))
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
    let value: Value =
        serde_json::from_str(raw).with_context(|| format!("failed to parse {}", path.display()))?;
    if value.get("type").and_then(Value::as_str) != Some(AUTH_TYPE) {
        return Ok(None);
    }
    let auth: StoredArceeAuth = serde_json::from_value(value)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    validate_stored_base_url(&auth.base_url).with_context(|| {
        format!(
            "stored Arcee auth in {} has an invalid base_url",
            path.display()
        )
    })?;
    Ok(Some(auth))
}

fn write_stored_auth(auth: &StoredArceeAuth) -> Result<()> {
    validate_stored_base_url(&auth.base_url)
        .context("refusing to store Arcee credentials with an invalid base_url")?;
    let raw = serde_json::to_string_pretty(auth).context("failed to serialize Arcee auth")?;
    write_arcee_auth_string(&raw)
}

/// Migrate while the caller holds the Codex/legacy auth.json lock. Acquiring the
/// Arcee lock second preserves the global lock order used by Arcee operations.
pub(super) fn migrate_legacy_auth_with_codex_lock() -> Result<()> {
    with_arcee_auth_lock(migrate_legacy_auth_unlocked)
}

fn migrate_legacy_auth_unlocked() -> Result<()> {
    let legacy_path = legacy_auth_file_path()?;
    let arcee_path = arcee_auth_file_path()?;
    migrate_legacy_auth_files(&legacy_path, &arcee_path)
}

fn migrate_legacy_auth_files(legacy_path: &Path, arcee_path: &Path) -> Result<()> {
    let legacy_raw = match read_auth_string_from_path(legacy_path)? {
        Some(raw) => raw,
        None => return Ok(()),
    };

    // Malformed pre-split auth.json cannot safely be attributed to Arcee. Leave
    // it untouched and let the Codex-owned path retain its existing behavior.
    let legacy_value: Value = match serde_json::from_str(&legacy_raw) {
        Ok(value) => value,
        Err(_) => return Ok(()),
    };
    if legacy_value.get("type").and_then(Value::as_str) != Some(AUTH_TYPE) {
        return Ok(());
    }
    let legacy_auth: StoredArceeAuth = serde_json::from_value(legacy_value).with_context(|| {
        format!(
            "legacy Arcee auth in {} is invalid; refusing to overwrite it",
            legacy_path.display()
        )
    })?;
    validate_stored_base_url(&legacy_auth.base_url).with_context(|| {
        format!(
            "legacy Arcee auth in {} has an invalid base_url; refusing to migrate it",
            legacy_path.display()
        )
    })?;

    match read_auth_string_from_path(arcee_path)? {
        Some(arcee_raw) => {
            let arcee_auth = parse_stored_auth(&arcee_raw, arcee_path)
                .with_context(|| {
                    format!(
                        "cannot migrate legacy Arcee auth because {} is invalid; both files were preserved",
                        arcee_path.display()
                    )
                })?
                .ok_or_else(|| {
                    anyhow!(
                        "cannot migrate legacy Arcee auth because {} already contains non-Arcee credentials; both files were preserved",
                        arcee_path.display()
                    )
                })?;
            if arcee_auth != legacy_auth {
                return Err(anyhow!(
                    "conflicting Arcee credentials exist in {} and {}; both files were preserved",
                    legacy_path.display(),
                    arcee_path.display()
                ));
            }
        }
        None => {
            let raw = serde_json::to_string_pretty(&legacy_auth)
                .context("failed to serialize legacy Arcee auth")?;
            write_auth_string_to_path(arcee_path, &raw)?;
            let migrated_raw = read_auth_string_from_path(arcee_path)?.ok_or_else(|| {
                anyhow!(
                    "failed to verify migrated Arcee auth in {} because it disappeared",
                    arcee_path.display()
                )
            })?;
            let migrated = parse_stored_auth(&migrated_raw, arcee_path)?.ok_or_else(|| {
                anyhow!(
                    "failed to verify migrated Arcee auth in {}",
                    arcee_path.display()
                )
            })?;
            if migrated != legacy_auth {
                return Err(anyhow!(
                    "migrated Arcee auth in {} did not match {}; the legacy file was preserved",
                    arcee_path.display(),
                    legacy_path.display()
                ));
            }
        }
    }

    match fs::remove_file(legacy_path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            Err(error).with_context(|| format!("failed to remove {}", legacy_path.display()))
        }
    }
}

async fn request_device_code(client: &Client, base: &str) -> Result<DeviceCode> {
    let url = format!("{base}/app/v1/device/code");
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", user_agent())
        .json(&json!({ "client_id": CLIENT_ID }))
        .send()
        .await
        .context("failed to request Arcee device code")?;

    let status = response.status();
    let body = response
        .text()
        .await
        .context("failed to read Arcee device-code response")?;
    if !status.is_success() {
        return Err(anyhow!(
            "Arcee device-code request failed with HTTP {}: {}",
            status.as_u16(),
            truncate(&body)
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
        .unwrap_or(DEFAULT_EXPIRES_IN_SECS);

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
    base: &str,
    device: &DeviceCode,
) -> Result<TokenSuccess> {
    poll_device_code_with(client, base, device, now_ms, sleep).await
}

async fn poll_device_code_with<Now, Sleep, SleepFuture>(
    client: &Client,
    base: &str,
    device: &DeviceCode,
    mut now: Now,
    mut sleep_for: Sleep,
) -> Result<TokenSuccess>
where
    Now: FnMut() -> u64,
    Sleep: FnMut(Duration) -> SleepFuture,
    SleepFuture: std::future::Future<Output = ()>,
{
    let url = format!("{base}/app/v1/device/token");
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
        let body = response
            .text()
            .await
            .context("failed to read Arcee device authorization response")?;

        if status.is_success() {
            return serde_json::from_str::<TokenSuccess>(&body)
                .context("failed to parse Arcee device authorization response");
        }

        let error_code = serde_json::from_str::<Value>(&body)
            .ok()
            .and_then(|value| value.get("error").and_then(Value::as_str).map(str::to_string));

        match error_code.as_deref() {
            Some("authorization_pending") => {}
            Some("slow_down") => interval_secs = interval_secs.saturating_add(SLOW_DOWN_BACKOFF_SECS),
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
                    truncate(&body)
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

fn arcee_api_base() -> String {
    std::env::var("ARCEE_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
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

fn user_agent() -> String {
    format!("nac/{}", env!("CARGO_PKG_VERSION"))
}

fn truncate(value: &str) -> String {
    value.chars().take(500).collect()
}

#[cfg(test)]
mod tests {
    use super::super::test_http::{ScriptedResponse, ScriptedServer};
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::future::ready;
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

    fn stored_auth(api_key: &str) -> StoredArceeAuth {
        StoredArceeAuth {
            auth_type: AUTH_TYPE.to_string(),
            api_key: api_key.to_string(),
            base_url: "https://api.arcee.ai".to_string(),
            organization_id: "org-1".to_string(),
            workspace_name: "acme".to_string(),
        }
    }

    fn write_json(path: &Path, auth: &StoredArceeAuth) {
        fs::write(path, serde_json::to_string_pretty(auth).unwrap()).unwrap();
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

        let device = request_device_code(&Client::new(), &server.base_url)
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

        let device = request_device_code(&Client::new(), &server.base_url)
            .await
            .expect("fallback verification URI should parse");
        server.finish();

        assert_eq!(
            device.verification_uri_complete,
            "https://accounts.arcee.ai/device"
        );
        assert_eq!(device.interval_secs, DEFAULT_INTERVAL_SECS);
        assert_eq!(device.expires_in_secs, DEFAULT_EXPIRES_IN_SECS);
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
            let error = request_device_code(&Client::new(), &server.base_url)
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
    async fn token_poll_handles_pending_and_slow_down_then_parses_success_without_waiting() {
        let server = ScriptedServer::start(vec![
            ScriptedResponse::json("400 Bad Request", r#"{"error":"authorization_pending"}"#),
            ScriptedResponse::json("400 Bad Request", r#"{"error":"slow_down"}"#),
            ScriptedResponse::json(
                "200 OK",
                json!({
                    "api_key": "rcai-device-token",
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
            &Client::new(),
            &server.base_url,
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

        assert_eq!(success.api_key, "rcai-device-token");
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
                r#"{"api_key":"missing-other-success-fields"}"#,
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
                &Client::new(),
                &server.base_url,
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
    fn arcee_url_policy_allows_custom_http_and_https_endpoints() {
        for base_url in [
            "http://127.0.0.1:8080/dev/path",
            "http://localhost:3000",
            "https://models.example.com/arcee",
            "https://arcee.ai.attacker.example/v1",
        ] {
            let (kind, _) = validate_arcee_base_url(base_url).unwrap();
            assert_eq!(kind, ArceeEndpointKind::Custom, "{base_url}");
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
            api_key: "rcai-hostile".to_string(),
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
        let auth = stored_auth("rcai-abc");
        let raw = serde_json::to_string(&auth).unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["type"], "arcee_api_key");
        assert_eq!(value["api_key"], "rcai-abc");
        assert_eq!(value["base_url"], "https://api.arcee.ai");
    }

    #[test]
    fn valid_legacy_arcee_auth_migrates_idempotently() {
        let dir = TestDir::new("valid-migration");
        let (legacy, canonical) = dir.paths();
        let auth = stored_auth("rcai-legacy");
        write_json(&legacy, &auth);

        migrate_legacy_auth_files(&legacy, &canonical).unwrap();

        assert!(!legacy.exists());
        let canonical_raw = fs::read_to_string(&canonical).unwrap();
        assert_eq!(
            parse_stored_auth(&canonical_raw, &canonical).unwrap(),
            Some(auth)
        );
        migrate_legacy_auth_files(&legacy, &canonical).unwrap();
    }

    #[test]
    fn invalid_legacy_arcee_url_is_not_migrated() {
        let dir = TestDir::new("invalid-url-migration");
        let (legacy, canonical) = dir.paths();
        let mut auth = stored_auth("rcai-legacy");
        auth.base_url = "https://attacker.example/steal".to_string();
        write_json(&legacy, &auth);
        let legacy_before = fs::read(&legacy).unwrap();

        let error = migrate_legacy_auth_files(&legacy, &canonical).unwrap_err();

        assert!(error.to_string().contains("invalid base_url"));
        assert_eq!(fs::read(&legacy).unwrap(), legacy_before);
        assert!(!canonical.exists());
    }

    #[test]
    fn migration_leaves_codex_auth_untouched() {
        let dir = TestDir::new("codex");
        let (legacy, canonical) = dir.paths();
        let codex = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
        fs::write(&legacy, codex).unwrap();

        migrate_legacy_auth_files(&legacy, &canonical).unwrap();

        assert_eq!(fs::read_to_string(&legacy).unwrap(), codex);
        assert!(!canonical.exists());
    }

    #[cfg(unix)]
    #[test]
    fn migration_rejects_legacy_symlink_without_reading_or_moving_target() {
        let dir = TestDir::new("legacy-symlink-migration");
        let (legacy, canonical) = dir.paths();
        let target = dir.0.join("legacy-target.json");
        let target_raw = serde_json::to_string_pretty(&stored_auth("rcai-target")).unwrap();
        fs::write(&target, &target_raw).unwrap();
        symlink(&target, &legacy).unwrap();

        let error = migrate_legacy_auth_files(&legacy, &canonical).unwrap_err();

        assert!(error.to_string().contains("symlink credential path"));
        assert_eq!(fs::read_to_string(&target).unwrap(), target_raw);
        assert!(fs::symlink_metadata(&legacy)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!canonical.exists());
    }

    #[cfg(unix)]
    #[test]
    fn migration_rejects_canonical_symlink_and_preserves_all_files() {
        let dir = TestDir::new("canonical-symlink-migration");
        let (legacy, canonical) = dir.paths();
        let target = dir.0.join("canonical-target.json");
        let legacy_raw = serde_json::to_string_pretty(&stored_auth("rcai-legacy")).unwrap();
        let target_raw = serde_json::to_string_pretty(&stored_auth("rcai-target")).unwrap();
        fs::write(&legacy, &legacy_raw).unwrap();
        fs::write(&target, &target_raw).unwrap();
        symlink(&target, &canonical).unwrap();

        let error = migrate_legacy_auth_files(&legacy, &canonical).unwrap_err();

        assert!(error.to_string().contains("symlink credential path"));
        assert_eq!(fs::read_to_string(&legacy).unwrap(), legacy_raw);
        assert_eq!(fs::read_to_string(&target).unwrap(), target_raw);
        assert!(fs::symlink_metadata(&canonical)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn identical_legacy_and_canonical_auth_remove_only_legacy_copy() {
        let dir = TestDir::new("identical");
        let (legacy, canonical) = dir.paths();
        let auth = stored_auth("rcai-same");
        write_json(&legacy, &auth);
        write_json(&canonical, &auth);
        let canonical_before = fs::read(&canonical).unwrap();

        migrate_legacy_auth_files(&legacy, &canonical).unwrap();

        assert!(!legacy.exists());
        assert_eq!(fs::read(&canonical).unwrap(), canonical_before);
    }

    #[test]
    fn conflicting_arcee_auth_is_preserved() {
        let dir = TestDir::new("conflict");
        let (legacy, canonical) = dir.paths();
        write_json(&legacy, &stored_auth("rcai-legacy"));
        write_json(&canonical, &stored_auth("rcai-canonical"));
        let legacy_before = fs::read(&legacy).unwrap();
        let canonical_before = fs::read(&canonical).unwrap();

        let error = migrate_legacy_auth_files(&legacy, &canonical).unwrap_err();

        assert!(error.to_string().contains("conflicting Arcee credentials"));
        assert_eq!(fs::read(&legacy).unwrap(), legacy_before);
        assert_eq!(fs::read(&canonical).unwrap(), canonical_before);
    }

    #[test]
    fn malformed_canonical_auth_preserves_both_files() {
        let dir = TestDir::new("malformed-canonical");
        let (legacy, canonical) = dir.paths();
        write_json(&legacy, &stored_auth("rcai-legacy"));
        fs::write(&canonical, "{ malformed").unwrap();
        let legacy_before = fs::read(&legacy).unwrap();
        let canonical_before = fs::read(&canonical).unwrap();

        assert!(migrate_legacy_auth_files(&legacy, &canonical).is_err());
        assert_eq!(fs::read(&legacy).unwrap(), legacy_before);
        assert_eq!(fs::read(&canonical).unwrap(), canonical_before);
    }

    #[test]
    fn arcee_logout_removes_malformed_canonical_and_preserves_codex() {
        let dir = TestDir::new("logout-malformed");
        let (codex_path, arcee_path) = dir.paths();
        let codex = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
        fs::write(&codex_path, codex).unwrap();
        fs::write(&arcee_path, "{ malformed").unwrap();

        assert!(remove_arcee_auth_files_for_logout(&codex_path, &arcee_path).unwrap());

        assert!(!arcee_path.exists());
        assert_eq!(fs::read_to_string(codex_path).unwrap(), codex);
    }

    #[test]
    fn arcee_logout_preserves_coexisting_codex_auth() {
        let dir = TestDir::new("logout-coexistence");
        let (codex_path, arcee_path) = dir.paths();
        let codex = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
        fs::write(&codex_path, codex).unwrap();
        write_json(&arcee_path, &stored_auth("rcai-canonical"));

        assert!(remove_arcee_auth_files_for_logout(&codex_path, &arcee_path).unwrap());

        assert!(!arcee_path.exists());
        assert_eq!(fs::read_to_string(codex_path).unwrap(), codex);
    }

    #[test]
    fn arcee_logout_is_idempotent_when_files_are_missing() {
        let dir = TestDir::new("logout-missing");
        let (legacy, canonical) = dir.paths();

        assert!(!remove_arcee_auth_files_for_logout(&legacy, &canonical).unwrap());
        assert!(!remove_arcee_auth_files_for_logout(&legacy, &canonical).unwrap());
    }

    #[test]
    fn arcee_logout_removes_typed_malformed_legacy_auth() {
        let dir = TestDir::new("logout-typed-legacy");
        let (legacy, canonical) = dir.paths();
        fs::write(&legacy, r#"{"type":"arcee_api_key","api_key":7}"#).unwrap();

        assert!(remove_arcee_auth_files_for_logout(&legacy, &canonical).unwrap());
        assert!(!legacy.exists());
    }

    #[test]
    fn arcee_logout_preserves_valid_unknown_records() {
        let dir = TestDir::new("logout-unknown");
        let (legacy, canonical) = dir.paths();
        let unknown_legacy = r#"{"type":"future-provider","token":"legacy"}"#;
        let unknown_canonical = r#"{"type":"future-provider","token":"canonical"}"#;
        fs::write(&legacy, unknown_legacy).unwrap();
        fs::write(&canonical, unknown_canonical).unwrap();

        assert!(!remove_arcee_auth_files_for_logout(&legacy, &canonical).unwrap());
        assert_eq!(fs::read_to_string(legacy).unwrap(), unknown_legacy);
        assert_eq!(fs::read_to_string(canonical).unwrap(), unknown_canonical);
    }

    #[cfg(unix)]
    #[test]
    fn arcee_logout_rejects_shared_legacy_symlink_without_touching_target() {
        let dir = TestDir::new("logout-legacy-symlink");
        let (legacy, canonical) = dir.paths();
        let target = dir.0.join("legacy-target.json");
        let target_raw = serde_json::to_string_pretty(&stored_auth("rcai-target")).unwrap();
        fs::write(&target, &target_raw).unwrap();
        symlink(&target, &legacy).unwrap();

        let error = remove_arcee_auth_files_for_logout(&legacy, &canonical).unwrap_err();

        assert!(error
            .to_string()
            .contains("shared legacy credential symlink"));
        assert_eq!(fs::read_to_string(&target).unwrap(), target_raw);
        assert!(fs::symlink_metadata(&legacy)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!canonical.exists());
    }

    #[cfg(unix)]
    #[test]
    fn arcee_logout_unlinks_symlink_without_touching_target() {
        let dir = TestDir::new("logout-symlink");
        let (legacy, canonical) = dir.paths();
        let target = dir.0.join("target.json");
        fs::write(&target, "target-credentials").unwrap();
        symlink(&target, &canonical).unwrap();

        assert!(remove_arcee_auth_files_for_logout(&legacy, &canonical).unwrap());

        assert!(fs::symlink_metadata(&canonical).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "target-credentials");
    }
}
