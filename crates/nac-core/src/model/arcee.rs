use super::auth_store::{
    auth_file_path, read_auth_string, remove_auth_file, with_auth_lock, write_auth_string,
};
use super::*;
use anyhow::Context;
use std::time::{SystemTime, UNIX_EPOCH};

const CLIENT_ID: &str = "nac-cli";
const AUTH_TYPE: &str = "arcee_api_key";
const DEFAULT_BASE_URL: &str = "http://api.internal.arcee.ai";
const DEFAULT_INTERVAL_SECS: u64 = 5;
const DEFAULT_EXPIRES_IN_SECS: u64 = 900;
const SLOW_DOWN_BACKOFF_SECS: u64 = 5;

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    with_auth_lock(|| write_stored_auth(&auth))?;

    println!("Arcee auth saved.");
    println!("workspace: {}", auth.workspace_name);
    println!("base_url: {}", auth.base_url);
    println!("path: {}", auth_file_path()?.display());
    Ok(())
}

pub(super) fn arcee_auth_status() -> Result<()> {
    let path = auth_file_path()?;
    let auth = with_auth_lock(read_stored_auth_optional)?;
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
    let path = auth_file_path()?;
    let removed = with_auth_lock(|| match read_stored_auth_optional()? {
        Some(_) => remove_auth_file(),
        None => Ok(false),
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
    read_stored_auth_optional()?
        .ok_or_else(|| anyhow!("Arcee auth is not configured. Run `nac arcee-auth login` to sign in."))
}

pub(super) fn has_stored_auth() -> bool {
    matches!(read_stored_auth_optional(), Ok(Some(_)))
}

fn read_stored_auth_optional() -> Result<Option<StoredArceeAuth>> {
    let path = auth_file_path()?;
    let raw = match read_auth_string()? {
        Some(raw) => raw,
        None => return Ok(None),
    };
    let value: Value =
        serde_json::from_str(&raw).with_context(|| format!("failed to parse {}", path.display()))?;
    if value.get("type").and_then(Value::as_str) != Some(AUTH_TYPE) {
        return Ok(None);
    }
    let auth: StoredArceeAuth = serde_json::from_value(value)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(Some(auth))
}

fn write_stored_auth(auth: &StoredArceeAuth) -> Result<()> {
    let raw = serde_json::to_string_pretty(auth).context("failed to serialize Arcee auth")?;
    write_auth_string(&raw)
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

    #[test]
    fn stored_auth_round_trips() {
        let auth = StoredArceeAuth {
            auth_type: AUTH_TYPE.to_string(),
            api_key: "rcai-abc".to_string(),
            base_url: "https://api.arcee.ai".to_string(),
            organization_id: "org-1".to_string(),
            workspace_name: "acme".to_string(),
        };
        let raw = serde_json::to_string(&auth).unwrap();
        let value: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(value["type"], "arcee_api_key");
        assert_eq!(value["api_key"], "rcai-abc");
        assert_eq!(value["base_url"], "https://api.arcee.ai");
    }
}
