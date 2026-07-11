use super::auth_store::{
    arcee_auth_file_path, legacy_auth_file_path, read_arcee_auth_string, remove_arcee_auth_file,
    with_arcee_auth_lock, with_arcee_migration_locks, write_arcee_auth_string,
    write_auth_string_to_path,
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
    let auth = StoredArceeAuth {
        auth_type: AUTH_TYPE.to_string(),
        api_key: success.api_key,
        base_url: success.base_url,
        organization_id: success.organization_id,
        workspace_name: success.workspace_name,
    };
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
    let removed = with_arcee_migration_locks(|| {
        migrate_legacy_auth_unlocked()?;
        match read_stored_auth_optional()? {
            Some(_) => remove_arcee_auth_file(),
            None => Ok(false),
        }
    })?;
    if removed {
        println!("Arcee auth removed.");
    } else {
        println!("No Arcee auth found.");
    }
    println!("path: {}", path.display());
    Ok(())
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
    Ok(Some(auth))
}

fn write_stored_auth(auth: &StoredArceeAuth) -> Result<()> {
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
    let legacy_raw = match fs::read_to_string(legacy_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", legacy_path.display()))
        }
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

    match fs::read_to_string(arcee_path) {
        Ok(arcee_raw) => {
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
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let raw = serde_json::to_string_pretty(&legacy_auth)
                .context("failed to serialize legacy Arcee auth")?;
            write_auth_string_to_path(arcee_path, &raw)?;
            let migrated_raw = fs::read_to_string(arcee_path)
                .with_context(|| format!("failed to verify {}", arcee_path.display()))?;
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
        Err(error) => {
            return Err(error).with_context(|| format!("failed to read {}", arcee_path.display()))
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
    let url = format!("{base}/app/v1/device/token");
    let started = now_ms();
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

        if now_ms().saturating_sub(started) >= device.expires_in_secs.saturating_mul(1000) {
            return Err(anyhow!(
                "Arcee device authorization timed out; run `nac arcee-auth login` again"
            ));
        }

        sleep(Duration::from_secs(interval_secs)).await;
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
    use super::*;
    use std::path::PathBuf;

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
    fn migration_leaves_codex_auth_untouched() {
        let dir = TestDir::new("codex");
        let (legacy, canonical) = dir.paths();
        let codex = r#"{"type":"chatgpt-codex","access":"a","refresh":"r"}"#;
        fs::write(&legacy, codex).unwrap();

        migrate_legacy_auth_files(&legacy, &canonical).unwrap();

        assert_eq!(fs::read_to_string(&legacy).unwrap(), codex);
        assert!(!canonical.exists());
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
}
