use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use base64::Engine;
use nac_credential_store::{
    read_auth_string_from_path, try_acquire_credential_lock, with_credential_lock,
    write_auth_string_to_path,
};
use rmcp::transport::auth::{
    AuthError, AuthorizationManager, AuthorizationRequest, AuthorizationSession,
    CredentialRefreshGuard, CredentialStore, OAuthClientConfig, StateStore,
    StoredAuthorizationState, StoredCredentials,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::time::sleep;
use url::Url;

pub const MCP_OAUTH_CALLBACK_PATH: &str = "/mcp_library/oauth/callback";
pub const MCP_OAUTH_REDIRECT_URI: &str = "http://localhost:1456/mcp_library/oauth/callback";
const OAUTH_STORE_FILE: &str = "mcp_oauth.json";
const OAUTH_STATE_TTL: Duration = Duration::from_secs(10 * 60);

#[derive(Debug, Clone, Deserialize)]
pub struct McpOAuthConfiguration {
    pub client_id_credential: String,
    pub client_secret_credential: String,
    #[serde(default)]
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthStatus {
    NeedsConfiguration,
    NeedsAuthorization,
    Connected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OAuthBinding {
    endpoint: String,
    client_fingerprint: String,
    owner: String,
    host: String,
    #[serde(default)]
    issuer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OAuthProfile {
    binding: OAuthBinding,
    client_id_credential: String,
    client_secret_credential: String,
    scopes: Vec<String>,
    #[serde(default)]
    credentials: Option<StoredCredentials>,
    #[serde(default)]
    states: BTreeMap<String, StoredAuthorizationState>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct OAuthStoreFile {
    #[serde(default = "store_version")]
    version: u32,
    #[serde(default)]
    profiles: BTreeMap<String, OAuthProfile>,
}

fn store_version() -> u32 {
    1
}

fn oauth_store_path(cwd: &Path) -> Result<PathBuf> {
    crate::paths::PathContext::new(cwd)
        .nac_home_dir()
        .map(|dir| dir.join(OAUTH_STORE_FILE))
        .ok_or_else(|| anyhow!("no home directory is available for protected MCP OAuth storage"))
}

fn lock_path(path: &Path) -> PathBuf {
    path.with_extension("json.lock")
}

fn read_store(path: &Path) -> Result<OAuthStoreFile> {
    let Some(raw) = read_auth_string_from_path(path)? else {
        return Ok(OAuthStoreFile {
            version: store_version(),
            profiles: BTreeMap::new(),
        });
    };
    let store: OAuthStoreFile =
        serde_json::from_str(&raw).context("protected MCP OAuth storage is not valid JSON")?;
    if store.version != store_version() {
        bail!("unsupported protected MCP OAuth storage version");
    }
    Ok(store)
}

fn write_store(path: &Path, store: &OAuthStoreFile) -> Result<()> {
    let raw =
        serde_json::to_string(store).context("failed to encode protected MCP OAuth storage")?;
    write_auth_string_to_path(path, &raw)
}

fn edit_store<T>(path: &Path, edit: impl FnOnce(&mut OAuthStoreFile) -> Result<T>) -> Result<T> {
    with_credential_lock(&lock_path(path), || {
        let mut store = read_store(path)?;
        let result = edit(&mut store)?;
        write_store(path, &store)?;
        Ok(result)
    })
}

fn normalize_endpoint(raw: &str) -> Result<String> {
    let mut url = Url::parse(raw).context("MCP OAuth endpoint must be an absolute URL")?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        bail!("MCP OAuth endpoint must use HTTPS (HTTP is allowed only for loopback testing)");
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        bail!("MCP OAuth endpoint must not contain credentials, a query, or a fragment");
    }
    if url.path().is_empty() {
        url.set_path("/");
    }
    Ok(url.to_string())
}

fn validate_credential_name(name: &str) -> Result<()> {
    if name.is_empty()
        || !name.as_bytes()[0].is_ascii_alphabetic() && name.as_bytes()[0] != b'_'
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        bail!("credential names must match [A-Za-z_][A-Za-z0-9_]*");
    }
    Ok(())
}

fn client_fingerprint(client_id: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(client_id.as_bytes()))
}

#[cfg(unix)]
fn owner_boundary() -> String {
    // SAFETY: geteuid takes no pointers and has no preconditions.
    unsafe { libc::geteuid() }.to_string()
}
#[cfg(not(unix))]
fn owner_boundary() -> String {
    std::env::var("USERNAME").unwrap_or_else(|_| "unknown".into())
}

#[cfg(unix)]
fn host_boundary() -> Result<String> {
    let mut bytes = [0_u8; 256];
    // SAFETY: `bytes` is writable for the supplied length and remains alive
    // for the duration of the libc call.
    if unsafe { libc::gethostname(bytes.as_mut_ptr().cast(), bytes.len()) } != 0 {
        return Err(std::io::Error::last_os_error()).context("failed to identify local host");
    }
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    String::from_utf8(bytes[..end].to_vec()).context("local host name is not UTF-8")
}
#[cfg(not(unix))]
fn host_boundary() -> Result<String> {
    Ok(std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".into()))
}

fn resolve_client(profile: &OAuthProfile) -> Result<(String, String)> {
    let client_id = crate::model::resolve_named_api_key(&profile.client_id_credential)?
        .ok_or_else(|| anyhow!("configured MCP OAuth client ID credential is unavailable"))?;
    let client_secret = crate::model::resolve_named_api_key(&profile.client_secret_credential)?
        .ok_or_else(|| anyhow!("configured MCP OAuth client secret credential is unavailable"))?;
    Ok((client_id, client_secret))
}

fn validate_binding(profile: &OAuthProfile, endpoint: &str, client_id: &str) -> Result<()> {
    if profile.binding.endpoint != normalize_endpoint(endpoint)?
        || profile.binding.client_fingerprint != client_fingerprint(client_id)
        || profile.binding.owner != owner_boundary()
        || profile.binding.host != host_boundary()?
    {
        bail!(
            "protected MCP OAuth credentials do not match this endpoint, client, owner, and host"
        );
    }
    if let Some(credentials) = &profile.credentials {
        if credentials.client_id != client_id {
            bail!("protected MCP OAuth credentials do not match the configured client");
        }
        if profile.binding.issuer.as_deref() != credentials.issuer.as_deref() {
            bail!("protected MCP OAuth issuer binding does not match");
        }
    }
    Ok(())
}

pub fn configure_mcp_oauth(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    config: McpOAuthConfiguration,
) -> Result<McpOAuthStatus> {
    validate_credential_name(&config.client_id_credential)?;
    validate_credential_name(&config.client_secret_credential)?;
    if config.scopes.is_empty() || config.scopes.iter().any(|scope| scope.trim().is_empty()) {
        bail!("at least one nonblank MCP OAuth scope is required");
    }
    let endpoint = normalize_endpoint(endpoint)?;
    let client_id = crate::model::resolve_named_api_key(&config.client_id_credential)?
        .ok_or_else(|| anyhow!("configured MCP OAuth client ID credential is unavailable"))?;
    let _client_secret = crate::model::resolve_named_api_key(&config.client_secret_credential)?
        .ok_or_else(|| anyhow!("configured MCP OAuth client secret credential is unavailable"))?;
    let binding = OAuthBinding {
        endpoint,
        client_fingerprint: client_fingerprint(&client_id),
        owner: owner_boundary(),
        host: host_boundary()?,
        issuer: None,
    };
    let path = oauth_store_path(cwd)?;
    let connected = edit_store(&path, |store| {
        let existing = store.profiles.get(server_name);
        let previous_issuer = existing
            .filter(|profile| {
                profile.binding.endpoint == binding.endpoint
                    && profile.binding.client_fingerprint == binding.client_fingerprint
            })
            .and_then(|profile| profile.binding.issuer.clone());
        let credentials = existing
            .filter(|profile| {
                profile.binding.endpoint == binding.endpoint
                    && profile.binding.client_fingerprint == binding.client_fingerprint
                    && profile.scopes == config.scopes
            })
            .and_then(|profile| profile.credentials.clone());
        let connected = credentials
            .as_ref()
            .is_some_and(|value| value.token_response.is_some());
        store.profiles.insert(
            server_name.to_string(),
            OAuthProfile {
                binding: OAuthBinding {
                    issuer: previous_issuer,
                    ..binding
                },
                client_id_credential: config.client_id_credential,
                client_secret_credential: config.client_secret_credential,
                scopes: config.scopes,
                credentials,
                states: BTreeMap::new(),
            },
        );
        Ok(connected)
    })?;
    Ok(if connected {
        McpOAuthStatus::Connected
    } else {
        McpOAuthStatus::NeedsAuthorization
    })
}

pub fn has_mcp_oauth_profile(cwd: &Path, server_name: &str) -> Result<bool> {
    Ok(read_store(&oauth_store_path(cwd)?)?
        .profiles
        .contains_key(server_name))
}

pub fn mcp_oauth_status(cwd: &Path, server_name: &str, endpoint: &str) -> Result<McpOAuthStatus> {
    let path = oauth_store_path(cwd)?;
    let store = read_store(&path)?;
    let Some(profile) = store.profiles.get(server_name) else {
        return Ok(McpOAuthStatus::NeedsConfiguration);
    };
    let (client_id, _) = resolve_client(profile)?;
    validate_binding(profile, endpoint, &client_id)?;
    Ok(
        if profile
            .credentials
            .as_ref()
            .is_some_and(|value| value.token_response.is_some())
        {
            McpOAuthStatus::Connected
        } else {
            McpOAuthStatus::NeedsAuthorization
        },
    )
}

pub fn clear_mcp_oauth(cwd: &Path, server_name: &str) -> Result<McpOAuthStatus> {
    let path = oauth_store_path(cwd)?;
    let configured = edit_store(&path, |store| {
        let Some(profile) = store.profiles.get_mut(server_name) else {
            return Ok(false);
        };
        profile.credentials = None;
        profile.states.clear();
        Ok(true)
    })?;
    Ok(if configured {
        McpOAuthStatus::NeedsAuthorization
    } else {
        McpOAuthStatus::NeedsConfiguration
    })
}

pub fn delete_mcp_oauth_profile(cwd: &Path, server_name: &str) -> Result<()> {
    let path = oauth_store_path(cwd)?;
    edit_store(&path, |store| {
        store.profiles.remove(server_name);
        Ok(())
    })
}

pub fn rename_mcp_oauth_profile(cwd: &Path, old_name: &str, new_name: &str) -> Result<()> {
    if old_name == new_name {
        return Ok(());
    }
    let path = oauth_store_path(cwd)?;
    edit_store(&path, |store| {
        if store.profiles.contains_key(new_name) {
            bail!("MCP OAuth is already configured for the renamed server");
        }
        if let Some(profile) = store.profiles.remove(old_name) {
            store.profiles.insert(new_name.to_string(), profile);
        }
        Ok(())
    })
}

#[derive(Clone)]
pub(crate) struct OAuthProfileStore {
    path: PathBuf,
    server_name: String,
    endpoint: String,
    client_id: String,
}

impl OAuthProfileStore {
    fn profile(&self) -> Result<OAuthProfile> {
        let store = read_store(&self.path)?;
        let profile = store
            .profiles
            .get(&self.server_name)
            .cloned()
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_binding(&profile, &self.endpoint, &self.client_id)?;
        Ok(profile)
    }

    fn auth_error(error: anyhow::Error) -> AuthError {
        AuthError::CredentialStoreError(error.to_string())
    }
}

#[async_trait]
impl CredentialStore for OAuthProfileStore {
    async fn load(&self) -> std::result::Result<Option<StoredCredentials>, AuthError> {
        self.profile()
            .map(|profile| profile.credentials)
            .map_err(Self::auth_error)
    }

    async fn save(&self, credentials: StoredCredentials) -> std::result::Result<(), AuthError> {
        if credentials.client_id != self.client_id {
            return Err(AuthError::CredentialStoreError(
                "client binding mismatch".into(),
            ));
        }
        let mut store = read_store(&self.path).map_err(Self::auth_error)?;
        let profile = store
            .profiles
            .get_mut(&self.server_name)
            .ok_or_else(|| AuthError::CredentialStoreError("MCP OAuth is not configured".into()))?;
        validate_binding(profile, &self.endpoint, &self.client_id).map_err(Self::auth_error)?;
        profile.binding.issuer = credentials.issuer.clone();
        profile.credentials = Some(credentials);
        write_store(&self.path, &store).map_err(Self::auth_error)
    }

    async fn clear(&self) -> std::result::Result<(), AuthError> {
        edit_store(&self.path, |store| {
            let profile = store
                .profiles
                .get_mut(&self.server_name)
                .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
            validate_binding(profile, &self.endpoint, &self.client_id)?;
            profile.credentials = None;
            profile.states.clear();
            Ok(())
        })
        .map_err(Self::auth_error)
    }

    async fn acquire_refresh_guard(
        &self,
    ) -> std::result::Result<Option<CredentialRefreshGuard>, AuthError> {
        let lock = lock_path(&self.path);
        loop {
            match try_acquire_credential_lock(&lock).map_err(Self::auth_error)? {
                Some(guard) => return Ok(Some(CredentialRefreshGuard::new(guard))),
                None => sleep(Duration::from_millis(25)).await,
            }
        }
    }
}

#[async_trait]
impl StateStore for OAuthProfileStore {
    async fn save(
        &self,
        csrf_token: &str,
        state: StoredAuthorizationState,
    ) -> std::result::Result<(), AuthError> {
        let path = self.path.clone();
        edit_store(&path, |store| {
            let profile = store
                .profiles
                .get_mut(&self.server_name)
                .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
            validate_binding(profile, &self.endpoint, &self.client_id)?;
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            profile.states.retain(|_, value| {
                now.saturating_sub(value.created_at) <= OAUTH_STATE_TTL.as_secs()
            });
            profile.states.insert(csrf_token.to_string(), state);
            Ok(())
        })
        .map_err(Self::auth_error)
    }

    async fn load(
        &self,
        csrf_token: &str,
    ) -> std::result::Result<Option<StoredAuthorizationState>, AuthError> {
        let profile = self.profile().map_err(Self::auth_error)?;
        let Some(state) = profile.states.get(csrf_token).cloned() else {
            return Ok(None);
        };
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        Ok((now.saturating_sub(state.created_at) <= OAUTH_STATE_TTL.as_secs()).then_some(state))
    }

    async fn delete(&self, csrf_token: &str) -> std::result::Result<(), AuthError> {
        edit_store(&self.path, |store| {
            let profile = store
                .profiles
                .get_mut(&self.server_name)
                .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
            validate_binding(profile, &self.endpoint, &self.client_id)?;
            profile.states.remove(csrf_token);
            Ok(())
        })
        .map_err(Self::auth_error)
    }
}

async fn manager_and_profile(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
) -> Result<(AuthorizationManager, OAuthProfile)> {
    let path = oauth_store_path(cwd)?;
    let store = read_store(&path)?;
    let profile = store
        .profiles
        .get(server_name)
        .cloned()
        .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
    let (client_id, _) = resolve_client(&profile)?;
    validate_binding(&profile, endpoint, &client_id)?;
    let adapter = OAuthProfileStore {
        path,
        server_name: server_name.to_string(),
        endpoint: normalize_endpoint(endpoint)?,
        client_id,
    };
    let mut manager = AuthorizationManager::new(endpoint)
        .await
        .context("MCP OAuth metadata client initialization failed")?;
    manager.set_credential_store(adapter.clone());
    manager.set_state_store(adapter);
    let resolution = manager
        .resolve_metadata()
        .await
        .context("MCP OAuth metadata discovery failed")?;
    if !resolution.source.is_discovered() {
        bail!("MCP OAuth metadata discovery is required");
    }
    if let Some(bound_issuer) = profile.binding.issuer.as_deref() {
        if resolution.metadata.issuer.as_deref() != Some(bound_issuer) {
            bail!("protected MCP OAuth credentials do not match the discovered issuer");
        }
    }
    manager.set_metadata(resolution.metadata);
    Ok((manager, profile))
}

pub async fn begin_mcp_oauth_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
) -> Result<McpOAuthAuthorizationSession> {
    let (manager, profile) = manager_and_profile(cwd, server_name, endpoint).await?;
    let (client_id, client_secret) = resolve_client(&profile)?;
    let request = AuthorizationRequest::new(MCP_OAUTH_REDIRECT_URI)
        .with_scopes(profile.scopes)
        .with_preregistered_client(client_id)
        .with_client_secret(client_secret);
    let session = AuthorizationSession::new(manager, request)
        .await
        .map_err(|(_, error)| anyhow!(error).context("MCP OAuth authorization could not start"))?;
    let authorization_url = session.get_authorization_url().to_string();
    Ok(McpOAuthAuthorizationSession {
        authorization_url,
        session,
    })
}

pub struct McpOAuthAuthorizationSession {
    authorization_url: String,
    session: AuthorizationSession,
}

impl McpOAuthAuthorizationSession {
    pub fn authorization_url(&self) -> &str {
        &self.authorization_url
    }

    pub fn matches_callback_state(&self, callback_url: &str) -> bool {
        callback_state_matches(&self.authorization_url, callback_url)
    }

    pub async fn handle_callback_url(&self, callback_url: &str) -> Result<()> {
        self.session
            .handle_callback_url(callback_url)
            .await
            .map(|_| ())
            .context("MCP OAuth callback was rejected")
    }
}

fn callback_state_matches(authorization_url: &str, callback_url: &str) -> bool {
    let Ok(authorization_url) = url::Url::parse(authorization_url) else {
        return false;
    };
    let Ok(callback_url) = url::Url::parse(callback_url) else {
        return false;
    };
    let mut expected_values = authorization_url
        .query_pairs()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| value.into_owned());
    let Some(expected) = expected_values.next() else {
        return false;
    };
    if expected_values.next().is_some() {
        return false;
    }
    let mut actual = callback_url
        .query_pairs()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| value.into_owned());
    matches!(actual.next(), Some(actual) if actual == expected) && actual.next().is_none()
}

pub(crate) async fn authorized_manager(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
) -> Result<AuthorizationManager> {
    let (mut manager, profile) = manager_and_profile(cwd, server_name, endpoint).await?;
    if !manager
        .initialize_from_store()
        .await
        .context("MCP OAuth credentials could not be loaded")?
    {
        bail!("MCP OAuth authorization is required");
    }
    // initialize_from_store intentionally reconstructs a public client. NAC's
    // pre-registered Slack client is confidential, so restore the protected
    // secret before any automatic refresh or authenticated request.
    let (client_id, client_secret) = resolve_client(&profile)?;
    manager
        .configure_client(
            OAuthClientConfig::new(client_id, MCP_OAUTH_REDIRECT_URI)
                .with_client_secret(client_secret)
                .with_scopes(profile.scopes),
        )
        .context("MCP OAuth confidential client could not be initialized")?;
    Ok(manager)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::ffi::OsString;

    struct EnvRestore(Vec<(&'static str, Option<OsString>)>);

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            for (name, value) in self.0.drain(..).rev() {
                unsafe {
                    match value {
                        Some(value) => std::env::set_var(name, value),
                        None => std::env::remove_var(name),
                    }
                }
            }
        }
    }

    fn test_environment(label: &str) -> (PathBuf, EnvRestore) {
        let home =
            std::env::temp_dir().join(format!("nac-mcp-oauth-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        let names = ["NAC_HOME", "TEST_MCP_CLIENT_ID", "TEST_MCP_CLIENT_SECRET"];
        let original = names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        unsafe {
            std::env::set_var("NAC_HOME", &home);
            std::env::set_var("TEST_MCP_CLIENT_ID", "public-test-client");
            std::env::set_var("TEST_MCP_CLIENT_SECRET", "secret-test-canary");
        }
        (home, EnvRestore(original))
    }

    fn configuration() -> McpOAuthConfiguration {
        McpOAuthConfiguration {
            client_id_credential: "TEST_MCP_CLIENT_ID".to_string(),
            client_secret_credential: "TEST_MCP_CLIENT_SECRET".to_string(),
            scopes: vec!["channels:history".to_string(), "chat:write".to_string()],
        }
    }

    #[test]
    fn protected_profile_is_private_and_contains_no_configured_secret() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (home, _restore) = test_environment("private");
        configure_mcp_oauth(
            Path::new("/workspace"),
            "slack",
            "https://mcp.slack.com/mcp",
            configuration(),
        )
        .unwrap();

        let path = home.join(OAUTH_STORE_FILE);
        let raw = std::fs::read_to_string(&path).unwrap();
        assert!(!raw.contains("secret-test-canary"));
        assert!(!raw.contains("public-test-client"));
        assert_eq!(
            mcp_oauth_status(
                Path::new("/workspace"),
                "slack",
                "https://mcp.slack.com/mcp"
            )
            .unwrap(),
            McpOAuthStatus::NeedsAuthorization
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn profile_rejects_endpoint_client_owner_or_host_rebinding() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("binding");
        configure_mcp_oauth(
            Path::new("/workspace"),
            "slack",
            "https://mcp.slack.com/mcp",
            configuration(),
        )
        .unwrap();
        let error = mcp_oauth_status(Path::new("/workspace"), "slack", "https://example.com/mcp")
            .unwrap_err();
        assert!(error.to_string().contains("do not match"));

        unsafe { std::env::set_var("TEST_MCP_CLIENT_ID", "different-client") };
        let error = mcp_oauth_status(
            Path::new("/workspace"),
            "slack",
            "https://mcp.slack.com/mcp",
        )
        .unwrap_err();
        assert!(error.to_string().contains("do not match"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn state_is_ttl_bounded_and_preserves_metadata_issuer_policy() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("state");
        let endpoint = "https://mcp.slack.com/mcp";
        configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration()).unwrap();
        let path = oauth_store_path(Path::new("/workspace")).unwrap();
        let adapter = OAuthProfileStore {
            path: path.clone(),
            server_name: "slack".to_string(),
            endpoint: normalize_endpoint(endpoint).unwrap(),
            client_id: "public-test-client".to_string(),
        };
        for (csrf, requirement) in [
            ("fake-state", None),
            ("optional-state", Some(false)),
            ("required-state", Some(true)),
        ] {
            let mut value = serde_json::json!({
                "pkce_verifier": format!("{csrf}-verifier"),
                "csrf_token": csrf,
                "expected_issuer": "https://auth.example.com",
                "created_at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                "requested_scopes": ["chat:write"]
            });
            if let Some(requirement) = requirement {
                value["require_issuer"] = requirement.into();
            }
            StateStore::save(&adapter, csrf, serde_json::from_value(value).unwrap())
                .await
                .unwrap();
            assert_eq!(
                adapter.profile().unwrap().states[csrf].require_issuer,
                requirement.unwrap_or(false)
            );
        }

        let mut manager = AuthorizationManager::new(endpoint).await.unwrap();
        manager.set_state_store(adapter.clone());
        manager.set_metadata(
            serde_json::from_value(serde_json::json!({
                "authorization_endpoint": "https://auth.example.com/authorize",
                "token_endpoint": "https://auth.example.com/token",
                "issuer": "https://auth.example.com"
            }))
            .unwrap(),
        );
        manager
            .configure_client(OAuthClientConfig::new(
                "public-test-client",
                MCP_OAUTH_REDIRECT_URI,
            ))
            .unwrap();
        let mismatch = manager
            .exchange_code_for_token_with_issuer(
                "fake-code",
                "optional-state",
                Some("https://other.example.com"),
            )
            .await
            .unwrap_err();
        assert!(matches!(
            mismatch,
            AuthError::AuthorizationServerMismatch { .. }
        ));
        let missing = manager
            .exchange_code_for_token_with_issuer("fake-code", "required-state", None)
            .await
            .unwrap_err();
        assert!(matches!(
            missing,
            AuthError::AuthorizationServerMissingIssuer { .. }
        ));

        let credentials: StoredCredentials = serde_json::from_value(serde_json::json!({
            "client_id": "public-test-client",
            "token_response": null,
            "granted_scopes": [],
            "token_received_at": null,
            "issuer": "https://auth.example.com"
        }))
        .unwrap();
        CredentialStore::save(&adapter, credentials).await.unwrap();
        assert_eq!(
            adapter.profile().unwrap().binding.issuer.as_deref(),
            Some("https://auth.example.com")
        );
        StateStore::delete(&adapter, "fake-state").await.unwrap();
        assert!(StateStore::load(&adapter, "fake-state")
            .await
            .unwrap()
            .is_none());

        let expired: StoredAuthorizationState = serde_json::from_value(serde_json::json!({
            "pkce_verifier": "expired-verifier",
            "csrf_token": "expired-state",
            "created_at": 0,
            "requested_scopes": []
        }))
        .unwrap();
        StateStore::save(&adapter, "expired-state", expired)
            .await
            .unwrap();
        assert!(StateStore::load(&adapter, "expired-state")
            .await
            .unwrap()
            .is_none());
    }

    #[test]
    fn callback_state_requires_the_current_single_exact_value() {
        let authorization =
            "https://auth.example.com/authorize?client_id=test&state=current%20state";
        assert!(callback_state_matches(
            authorization,
            "http://localhost:1456/mcp_library/oauth/callback?code=code&state=current%20state"
        ));
        assert!(!callback_state_matches(
            authorization,
            "http://localhost:1456/mcp_library/oauth/callback?code=code&state=stale"
        ));
        assert!(!callback_state_matches(
            authorization,
            "http://localhost:1456/mcp_library/oauth/callback?code=code&state=current%20state&state=current%20state"
        ));
        assert!(!callback_state_matches(
            "https://auth.example.com/authorize?client_id=test",
            "http://localhost:1456/mcp_library/oauth/callback?code=code&state=current%20state"
        ));
    }

    #[test]
    fn logout_clears_authorization_material_but_preserves_configuration() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("logout");
        configure_mcp_oauth(
            Path::new("/workspace"),
            "slack",
            "https://mcp.slack.com/mcp",
            configuration(),
        )
        .unwrap();
        assert_eq!(
            clear_mcp_oauth(Path::new("/workspace"), "slack").unwrap(),
            McpOAuthStatus::NeedsAuthorization
        );
        assert!(has_mcp_oauth_profile(Path::new("/workspace"), "slack").unwrap());
    }
}
