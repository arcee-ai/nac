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
    AuthError, AuthorizationManager, AuthorizationMetadata, AuthorizationRequest,
    AuthorizationSession, CredentialRefreshGuard, CredentialStore, OAuthClientConfig, StateStore,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpOAuthRegistration {
    PreRegistered {
        client_id_credential: String,
        #[serde(default)]
        client_secret_credential: Option<String>,
    },
    ClientMetadata {
        url: String,
    },
    Dynamic {
        #[serde(default)]
        client_name: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpOAuthAuthorizationMetadata {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub registration_endpoint: Option<String>,
    #[serde(default)]
    pub issuer: Option<String>,
    #[serde(default)]
    pub jwks_uri: Option<String>,
    #[serde(default)]
    pub scopes_supported: Option<Vec<String>>,
    #[serde(default)]
    pub response_types_supported: Option<Vec<String>>,
    #[serde(default)]
    pub code_challenge_methods_supported: Option<Vec<String>>,
    #[serde(flatten)]
    pub additional_fields: std::collections::HashMap<String, serde_json::Value>,
}

fn authorization_metadata(value: McpOAuthAuthorizationMetadata) -> Result<AuthorizationMetadata> {
    serde_json::from_value(
        serde_json::to_value(value).context("failed to encode MCP OAuth metadata override")?,
    )
    .context("failed to decode MCP OAuth metadata override")
}

#[derive(Debug, Clone, Deserialize)]
pub struct McpOAuthConfiguration {
    pub registration: McpOAuthRegistration,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub authorization_metadata: Option<McpOAuthAuthorizationMetadata>,
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
    configuration_fingerprint: String,
    owner: String,
    host: String,
    #[serde(default)]
    issuer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct OAuthProfile {
    binding: OAuthBinding,
    registration: McpOAuthRegistration,
    scopes: Vec<String>,
    #[serde(default)]
    authorization_metadata: Option<McpOAuthAuthorizationMetadata>,
    #[serde(default)]
    redirect_uri: Option<String>,
    #[serde(default)]
    pending_authorization_url: Option<String>,
    #[serde(default)]
    pending_scopes: Vec<String>,
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
    2
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

fn fingerprint(value: &impl Serialize) -> Result<String> {
    let encoded = serde_json::to_vec(value).context("failed to bind MCP OAuth configuration")?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(encoded)))
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

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ResolvedRegistrationBinding<'a> {
    PreRegistered { client_id: &'a str },
    ClientMetadata { url: &'a str },
    Dynamic { client_name: Option<&'a str> },
}

#[derive(Debug, Clone)]
enum ResolvedRegistration {
    PreRegistered {
        client_id: String,
        client_secret: Option<String>,
    },
    ClientMetadata {
        url: String,
    },
    Dynamic {
        client_name: Option<String>,
    },
}

impl ResolvedRegistration {
    fn binding(&self) -> ResolvedRegistrationBinding<'_> {
        match self {
            Self::PreRegistered { client_id, .. } => {
                ResolvedRegistrationBinding::PreRegistered { client_id }
            }
            Self::ClientMetadata { url } => ResolvedRegistrationBinding::ClientMetadata { url },
            Self::Dynamic { client_name } => ResolvedRegistrationBinding::Dynamic {
                client_name: client_name.as_deref(),
            },
        }
    }

    fn expected_client_id(&self) -> Option<&str> {
        match self {
            Self::PreRegistered { client_id, .. } => Some(client_id),
            Self::ClientMetadata { url } => Some(url),
            Self::Dynamic { .. } => None,
        }
    }
}

fn validate_https_url(raw: &str, label: &str, allow_loopback_http: bool) -> Result<String> {
    let url = Url::parse(raw).with_context(|| format!("{label} must be an absolute URL"))?;
    let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"));
    if url.scheme() != "https" && !(allow_loopback_http && url.scheme() == "http" && loopback) {
        bail!("{label} must use HTTPS");
    }
    if !url.username().is_empty() || url.password().is_some() || url.fragment().is_some() {
        bail!("{label} must not contain credentials or a fragment");
    }
    Ok(url.to_string())
}

fn resolve_registration(registration: &McpOAuthRegistration) -> Result<ResolvedRegistration> {
    match registration {
        McpOAuthRegistration::PreRegistered {
            client_id_credential,
            client_secret_credential,
        } => {
            validate_credential_name(client_id_credential)?;
            if let Some(name) = client_secret_credential {
                validate_credential_name(name)?;
            }
            let client_id =
                crate::model::resolve_named_api_key(client_id_credential)?.ok_or_else(|| {
                    anyhow!("configured MCP OAuth client ID credential is unavailable")
                })?;
            let client_secret = client_secret_credential
                .as_deref()
                .map(crate::model::resolve_named_api_key)
                .transpose()?
                .flatten();
            if client_secret_credential.is_some() && client_secret.is_none() {
                bail!("configured MCP OAuth client secret credential is unavailable");
            }
            Ok(ResolvedRegistration::PreRegistered {
                client_id,
                client_secret,
            })
        }
        McpOAuthRegistration::ClientMetadata { url } => {
            let url = validate_https_url(url, "MCP OAuth client metadata URL", false)?;
            if Url::parse(&url)?.path() == "/" {
                bail!("MCP OAuth client metadata URL must have a non-root path");
            }
            Ok(ResolvedRegistration::ClientMetadata { url })
        }
        McpOAuthRegistration::Dynamic { client_name } => {
            let client_name = client_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(ToOwned::to_owned);
            Ok(ResolvedRegistration::Dynamic { client_name })
        }
    }
}

fn validate_metadata(metadata: &McpOAuthAuthorizationMetadata) -> Result<()> {
    validate_https_url(
        &metadata.authorization_endpoint,
        "MCP OAuth authorization endpoint",
        true,
    )?;
    validate_https_url(&metadata.token_endpoint, "MCP OAuth token endpoint", true)?;
    if let Some(url) = metadata.registration_endpoint.as_deref() {
        validate_https_url(url, "MCP OAuth registration endpoint", true)?;
    }
    if let Some(url) = metadata.issuer.as_deref() {
        validate_https_url(url, "MCP OAuth issuer", true)?;
    }
    if let Some(url) = metadata.jwks_uri.as_deref() {
        validate_https_url(url, "MCP OAuth JWKS URL", true)?;
    }
    Ok(())
}

fn configuration_fingerprint(
    registration: &ResolvedRegistration,
    metadata: &Option<McpOAuthAuthorizationMetadata>,
) -> Result<String> {
    fingerprint(&(registration.binding(), metadata))
}

fn validate_binding(
    profile: &OAuthProfile,
    endpoint: &str,
    registration: &ResolvedRegistration,
) -> Result<()> {
    if profile.binding.endpoint != normalize_endpoint(endpoint)?
        || profile.binding.configuration_fingerprint
            != configuration_fingerprint(registration, &profile.authorization_metadata)?
        || profile.binding.owner != owner_boundary()
        || profile.binding.host != host_boundary()?
    {
        bail!(
            "protected MCP OAuth credentials do not match this endpoint, client, owner, and host"
        );
    }
    if let Some(credentials) = &profile.credentials {
        if registration
            .expected_client_id()
            .is_some_and(|client_id| credentials.client_id != client_id)
        {
            bail!("protected MCP OAuth credentials do not match the configured client");
        }
        if profile.binding.issuer.as_deref() != credentials.issuer.as_deref() {
            bail!("protected MCP OAuth issuer binding does not match");
        }
    }
    Ok(())
}

fn validate_profile_binding(
    profile: &OAuthProfile,
    endpoint: &str,
) -> Result<ResolvedRegistration> {
    let registration = resolve_registration(&profile.registration)?;
    validate_binding(profile, endpoint, &registration)?;
    Ok(registration)
}

pub fn configure_mcp_oauth(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    config: McpOAuthConfiguration,
) -> Result<McpOAuthStatus> {
    if config.scopes.iter().any(|scope| scope.trim().is_empty()) {
        bail!("MCP OAuth scopes must not contain blank values");
    }
    let registration = resolve_registration(&config.registration)?;
    if let Some(metadata) = config.authorization_metadata.as_ref() {
        validate_metadata(metadata)?;
    }
    let endpoint = normalize_endpoint(endpoint)?;
    let binding = OAuthBinding {
        endpoint,
        configuration_fingerprint: configuration_fingerprint(
            &registration,
            &config.authorization_metadata,
        )?,
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
                    && profile.binding.configuration_fingerprint
                        == binding.configuration_fingerprint
            })
            .and_then(|profile| profile.binding.issuer.clone());
        let credentials = existing
            .filter(|profile| {
                profile.binding.endpoint == binding.endpoint
                    && profile.binding.configuration_fingerprint
                        == binding.configuration_fingerprint
                    && profile.scopes == config.scopes
            })
            .and_then(|profile| profile.credentials.clone());
        let redirect_uri = existing
            .filter(|profile| {
                profile.binding.endpoint == binding.endpoint
                    && profile.binding.configuration_fingerprint
                        == binding.configuration_fingerprint
                    && profile.scopes == config.scopes
            })
            .and_then(|profile| profile.redirect_uri.clone());
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
                registration: config.registration,
                scopes: config.scopes,
                authorization_metadata: config.authorization_metadata,
                redirect_uri,
                pending_authorization_url: None,
                pending_scopes: Vec::new(),
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
    validate_profile_binding(profile, endpoint)?;
    Ok(if profile.pending_authorization_url.is_some() {
        McpOAuthStatus::NeedsAuthorization
    } else if profile
        .credentials
        .as_ref()
        .is_some_and(|value| value.token_response.is_some())
    {
        McpOAuthStatus::Connected
    } else {
        McpOAuthStatus::NeedsAuthorization
    })
}

pub fn clear_mcp_oauth(cwd: &Path, server_name: &str) -> Result<McpOAuthStatus> {
    let path = oauth_store_path(cwd)?;
    let configured = edit_store(&path, |store| {
        let Some(profile) = store.profiles.get_mut(server_name) else {
            return Ok(false);
        };
        profile.credentials = None;
        profile.states.clear();
        profile.pending_authorization_url = None;
        profile.pending_scopes.clear();
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
    expected_client_id: Option<String>,
}

impl OAuthProfileStore {
    fn profile(&self) -> Result<OAuthProfile> {
        let store = read_store(&self.path)?;
        let profile = store
            .profiles
            .get(&self.server_name)
            .cloned()
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(&profile, &self.endpoint)?;
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
        if self
            .expected_client_id
            .as_deref()
            .is_some_and(|client_id| credentials.client_id != client_id)
        {
            return Err(AuthError::CredentialStoreError(
                "client binding mismatch".into(),
            ));
        }
        let mut store = read_store(&self.path).map_err(Self::auth_error)?;
        let profile = store
            .profiles
            .get_mut(&self.server_name)
            .ok_or_else(|| AuthError::CredentialStoreError("MCP OAuth is not configured".into()))?;
        validate_profile_binding(profile, &self.endpoint).map_err(Self::auth_error)?;
        profile.binding.issuer = credentials.issuer.clone();
        profile.credentials = Some(credentials);
        profile.pending_authorization_url = None;
        profile.pending_scopes.clear();
        write_store(&self.path, &store).map_err(Self::auth_error)
    }

    async fn clear(&self) -> std::result::Result<(), AuthError> {
        edit_store(&self.path, |store| {
            let profile = store
                .profiles
                .get_mut(&self.server_name)
                .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
            validate_profile_binding(profile, &self.endpoint)?;
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
            validate_profile_binding(profile, &self.endpoint)?;
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
            validate_profile_binding(profile, &self.endpoint)?;
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
) -> Result<(AuthorizationManager, OAuthProfile, AuthorizationMetadata)> {
    let path = oauth_store_path(cwd)?;
    let store = read_store(&path)?;
    let profile = store
        .profiles
        .get(server_name)
        .cloned()
        .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
    let registration = validate_profile_binding(&profile, endpoint)?;
    let adapter = OAuthProfileStore {
        path,
        server_name: server_name.to_string(),
        endpoint: normalize_endpoint(endpoint)?,
        expected_client_id: registration.expected_client_id().map(ToOwned::to_owned),
    };
    let mut manager = AuthorizationManager::new(endpoint)
        .await
        .context("MCP OAuth metadata client initialization failed")?;
    manager.set_credential_store(adapter.clone());
    manager.set_state_store(adapter);
    let metadata: AuthorizationMetadata =
        if let Some(metadata) = profile.authorization_metadata.clone() {
            authorization_metadata(metadata)?
        } else {
            let resolution = manager
                .resolve_metadata()
                .await
                .context("MCP OAuth metadata discovery failed")?;
            if !resolution.source.is_discovered() {
                bail!("MCP OAuth metadata discovery is required unless an override is configured");
            }
            resolution.metadata
        };
    if let Some(bound_issuer) = profile.binding.issuer.as_deref() {
        if metadata.issuer.as_deref() != Some(bound_issuer) {
            bail!("protected MCP OAuth credentials do not match the discovered issuer");
        }
    }
    manager.set_metadata(metadata.clone());
    Ok((manager, profile, metadata))
}

pub async fn begin_mcp_oauth_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    redirect_uri: &str,
    additional_scopes: &[String],
) -> Result<McpOAuthAuthorizationSession> {
    let redirect_uri = validate_https_url(redirect_uri, "MCP OAuth redirect URI", true)?;
    let (manager, profile, metadata) = manager_and_profile(cwd, server_name, endpoint).await?;
    let registration = resolve_registration(&profile.registration)?;
    match &registration {
        ResolvedRegistration::ClientMetadata { .. }
            if !metadata
                .additional_fields
                .get("client_id_metadata_document_supported")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false) =>
        {
            bail!("MCP OAuth server does not advertise Client ID Metadata Document support");
        }
        ResolvedRegistration::Dynamic { .. } if metadata.registration_endpoint.is_none() => {
            bail!("MCP OAuth server does not advertise Dynamic Client Registration");
        }
        _ => {}
    }
    let mut scopes = profile.scopes.clone();
    for scope in &profile.pending_scopes {
        if !scopes.contains(scope) {
            scopes.push(scope.clone());
        }
    }
    for scope in additional_scopes {
        let scope = scope.trim();
        if scope.is_empty() {
            bail!("MCP OAuth step-up scopes must not contain blank values");
        }
        if !scopes.iter().any(|value| value == scope) {
            scopes.push(scope.to_string());
        }
    }
    if let Some(credentials) = profile.credentials.as_ref() {
        for scope in &credentials.granted_scopes {
            if !scopes.contains(scope) {
                scopes.push(scope.clone());
            }
        }
    }
    let mut request = AuthorizationRequest::new(&redirect_uri).with_scopes(scopes.clone());
    request = match registration {
        ResolvedRegistration::PreRegistered {
            client_id,
            client_secret,
        } => {
            let request = request.with_preregistered_client(client_id);
            match client_secret {
                Some(secret) => request.with_client_secret(secret),
                None => request,
            }
        }
        ResolvedRegistration::ClientMetadata { url } => request.with_client_metadata_url(url),
        ResolvedRegistration::Dynamic { client_name } => {
            if let Some(credentials) = profile.credentials.as_ref() {
                request.with_preregistered_client(credentials.client_id.clone())
            } else {
                request.with_client_name(client_name.unwrap_or_else(|| "NAC MCP Client".into()))
            }
        }
    };
    if redirect_uri.starts_with("https://") {
        request = request.with_application_type("web");
    } else {
        request = request.with_application_type("native");
    }
    let session = AuthorizationSession::new(manager, request)
        .await
        .map_err(|(_, error)| anyhow!(error).context("MCP OAuth authorization could not start"))?;
    let authorization_url = session.get_authorization_url().to_string();
    let (client_id, _) = session
        .get_credentials()
        .await
        .context("MCP OAuth client registration could not be stored")?;
    let path = oauth_store_path(cwd)?;
    edit_store(&path, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        profile.redirect_uri = Some(redirect_uri.clone());
        profile.pending_authorization_url = Some(authorization_url.clone());
        if profile.credentials.is_none() {
            profile.credentials = Some(StoredCredentials::new(client_id, None, Vec::new(), None));
        }
        Ok(())
    })?;
    Ok(McpOAuthAuthorizationSession {
        authorization_url,
        session,
    })
}

pub fn mcp_oauth_pending_authorization_url(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
) -> Result<Option<String>> {
    let store = read_store(&oauth_store_path(cwd)?)?;
    let Some(profile) = store.profiles.get(server_name) else {
        return Ok(None);
    };
    validate_profile_binding(profile, endpoint)?;
    Ok(profile.pending_authorization_url.clone())
}

pub(crate) fn record_mcp_oauth_pending_authorization_url(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    authorization_url: String,
    required_scope: &str,
) -> Result<()> {
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        profile.pending_authorization_url = Some(authorization_url);
        for scope in required_scope.split_whitespace() {
            if !profile.pending_scopes.iter().any(|value| value == scope) {
                profile.pending_scopes.push(scope.to_string());
            }
        }
        Ok(())
    })
}

pub async fn complete_mcp_oauth_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    callback_url: &str,
) -> Result<()> {
    let callback = rmcp::transport::auth::AuthorizationCallback::from_redirect_url(callback_url)
        .context("MCP OAuth callback was rejected")?;
    let (mut manager, profile, _) = manager_and_profile(cwd, server_name, endpoint).await?;
    let redirect_uri = profile
        .redirect_uri
        .as_deref()
        .ok_or_else(|| anyhow!("MCP OAuth authorization has no pending redirect URI"))?;
    let stored_client_id = profile
        .credentials
        .as_ref()
        .map(|credentials| credentials.client_id.clone())
        .ok_or_else(|| anyhow!("MCP OAuth authorization has no registered client"))?;
    let registration = resolve_registration(&profile.registration)?;
    let mut client =
        OAuthClientConfig::new(stored_client_id, redirect_uri).with_scopes(profile.scopes.clone());
    if let ResolvedRegistration::PreRegistered {
        client_secret: Some(secret),
        ..
    } = registration
    {
        client = client.with_client_secret(secret);
    }
    manager
        .configure_client(client)
        .context("MCP OAuth client could not be restored")?;
    manager
        .exchange_code_for_token_with_issuer(
            &callback.code,
            &callback.csrf_token,
            callback.issuer.as_deref(),
        )
        .await
        .context("MCP OAuth callback was rejected")?;
    Ok(())
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
    let (mut manager, profile, _) = manager_and_profile(cwd, server_name, endpoint).await?;
    if !manager
        .initialize_from_store()
        .await
        .context("MCP OAuth credentials could not be loaded")?
    {
        bail!("MCP OAuth authorization is required");
    }
    let registration = resolve_registration(&profile.registration)?;
    let client_id = profile
        .credentials
        .as_ref()
        .map(|credentials| credentials.client_id.clone())
        .ok_or_else(|| anyhow!("MCP OAuth authorization is required"))?;
    let redirect_uri = profile
        .redirect_uri
        .as_deref()
        .unwrap_or(MCP_OAUTH_REDIRECT_URI);
    let mut client = OAuthClientConfig::new(client_id, redirect_uri).with_scopes(profile.scopes);
    if let ResolvedRegistration::PreRegistered {
        client_secret: Some(secret),
        ..
    } = registration
    {
        client = client.with_client_secret(secret);
    }
    manager
        .configure_client(client)
        .context("MCP OAuth client could not be initialized")?;
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
            registration: McpOAuthRegistration::PreRegistered {
                client_id_credential: "TEST_MCP_CLIENT_ID".to_string(),
                client_secret_credential: Some("TEST_MCP_CLIENT_SECRET".to_string()),
            },
            scopes: vec!["channels:history".to_string(), "chat:write".to_string()],
            authorization_metadata: None,
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
            expected_client_id: Some("public-test-client".to_string()),
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

    #[test]
    fn cimd_and_dynamic_registration_profiles_validate_without_client_secrets() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (home, _restore) = test_environment("registration-modes");
        let metadata = McpOAuthAuthorizationMetadata {
            authorization_endpoint: "https://auth.example.test/authorize".into(),
            token_endpoint: "https://auth.example.test/token".into(),
            registration_endpoint: Some("https://auth.example.test/register".into()),
            issuer: Some("https://auth.example.test/".into()),
            jwks_uri: None,
            scopes_supported: Some(vec!["mcp:read".into()]),
            response_types_supported: Some(vec!["code".into()]),
            code_challenge_methods_supported: Some(vec!["S256".into()]),
            additional_fields: std::collections::HashMap::new(),
        };
        for (name, registration) in [
            (
                "cimd",
                McpOAuthRegistration::ClientMetadata {
                    url: "https://nac.example.test/oauth-client.json".into(),
                },
            ),
            (
                "dynamic",
                McpOAuthRegistration::Dynamic {
                    client_name: Some("NAC Test".into()),
                },
            ),
        ] {
            assert_eq!(
                configure_mcp_oauth(
                    Path::new("/workspace"),
                    name,
                    "https://mcp.example.test/mcp",
                    McpOAuthConfiguration {
                        registration,
                        scopes: vec![],
                        authorization_metadata: Some(metadata.clone()),
                    },
                )
                .unwrap(),
                McpOAuthStatus::NeedsAuthorization
            );
        }
        let protected = std::fs::read_to_string(home.join(OAUTH_STORE_FILE)).unwrap();
        assert!(protected.contains("client_metadata"));
        assert!(protected.contains("dynamic"));
        assert!(!protected.contains("secret-test-canary"));
    }
}
