mod authorization_state;
mod client_config;
mod url_validation;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
pub(crate) use authorization_state::discard_mcp_oauth_pending_authorization;
use authorization_state::{
    authorization_state, failed_authorization_start, merge_pending_scopes,
    pending_authorization_is_live, publish_pending_authorization,
};
use base64::Engine;
#[cfg(test)]
use client_config::restored_client_secret;
use client_config::{oauth_application_type, restored_client_config};
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
use url_validation::{normalize_endpoint, validate_https_url};

pub const MCP_OAUTH_CALLBACK_PATH: &str = "/mcp_library/oauth/callback";
pub const MCP_OAUTH_REDIRECT_URI: &str = "http://localhost:1456/mcp_library/oauth/callback";
pub const MCP_OAUTH_STATE_TTL: Duration = Duration::from_secs(10 * 60);
const OAUTH_STORE_FILE: &str = "mcp_oauth.json";

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
    pub additional_fields: BTreeMap<String, serde_json::Value>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    legacy_client_fingerprint: Option<String>,
    owner: String,
    host: String,
    #[serde(default)]
    issuer: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
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
    registered_client_secret: Option<String>,
    #[serde(default)]
    credentials: Option<StoredCredentials>,
    #[serde(default)]
    states: BTreeMap<String, StoredAuthorizationState>,
}

#[derive(Default, Serialize, Deserialize)]
struct OAuthStoreFile {
    #[serde(default = "store_version")]
    version: u32,
    #[serde(default)]
    profiles: BTreeMap<String, OAuthProfile>,
}

#[derive(Debug, Deserialize)]
struct LegacyOAuthBinding {
    endpoint: String,
    client_fingerprint: String,
    owner: String,
    host: String,
    #[serde(default)]
    issuer: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LegacyOAuthProfile {
    binding: LegacyOAuthBinding,
    client_id_credential: String,
    client_secret_credential: String,
    scopes: Vec<String>,
    #[serde(default)]
    credentials: Option<StoredCredentials>,
    #[serde(default)]
    states: BTreeMap<String, StoredAuthorizationState>,
}

#[derive(Debug, Deserialize)]
struct LegacyOAuthStoreFile {
    version: u32,
    #[serde(default)]
    profiles: BTreeMap<String, LegacyOAuthProfile>,
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
    let value: serde_json::Value =
        serde_json::from_str(&raw).context("protected MCP OAuth storage is not valid JSON")?;
    match value.get("version").and_then(serde_json::Value::as_u64) {
        Some(1) => migrate_legacy_store(
            serde_json::from_value(value)
                .context("protected MCP OAuth version 1 storage is invalid")?,
        ),
        Some(version) if version == u64::from(store_version()) => {
            serde_json::from_value(value).context("protected MCP OAuth storage is invalid")
        }
        _ => bail!("unsupported protected MCP OAuth storage version"),
    }
}

fn migrate_legacy_store(legacy: LegacyOAuthStoreFile) -> Result<OAuthStoreFile> {
    if legacy.version != 1 {
        bail!("unsupported protected MCP OAuth storage version");
    }
    let mut profiles = BTreeMap::new();
    for (name, profile) in legacy.profiles {
        let registration = McpOAuthRegistration::PreRegistered {
            client_id_credential: profile.client_id_credential,
            client_secret_credential: Some(profile.client_secret_credential),
        };
        profiles.insert(
            name,
            OAuthProfile {
                binding: OAuthBinding {
                    endpoint: profile.binding.endpoint,
                    configuration_fingerprint: String::new(),
                    legacy_client_fingerprint: Some(profile.binding.client_fingerprint),
                    owner: profile.binding.owner,
                    host: profile.binding.host,
                    issuer: profile.binding.issuer,
                },
                registration,
                scopes: profile.scopes,
                authorization_metadata: None,
                redirect_uri: None,
                pending_authorization_url: None,
                pending_scopes: Vec::new(),
                registered_client_secret: None,
                credentials: profile.credentials,
                states: profile.states,
            },
        );
    }
    Ok(OAuthStoreFile {
        version: store_version(),
        profiles,
    })
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

fn client_id_fingerprint(client_id: &str) -> String {
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

fn profile_configuration_matches(
    profile: &OAuthProfile,
    registration: &ResolvedRegistration,
    metadata: &Option<McpOAuthAuthorizationMetadata>,
) -> Result<bool> {
    match profile.binding.legacy_client_fingerprint.as_deref() {
        Some(expected) => Ok(metadata.is_none()
            && matches!(
                registration,
                ResolvedRegistration::PreRegistered { client_id, .. }
                    if client_id_fingerprint(client_id) == expected
            )),
        None => Ok(profile.binding.configuration_fingerprint
            == configuration_fingerprint(registration, metadata)?),
    }
}

fn validate_binding(
    profile: &OAuthProfile,
    endpoint: &str,
    registration: &ResolvedRegistration,
) -> Result<()> {
    let configuration_matches =
        profile_configuration_matches(profile, registration, &profile.authorization_metadata)?;
    if profile.binding.endpoint != normalize_endpoint(endpoint)?
        || !configuration_matches
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
        legacy_client_fingerprint: None,
        owner: owner_boundary(),
        host: host_boundary()?,
        issuer: None,
    };
    let path = oauth_store_path(cwd)?;
    let connected = edit_store(&path, |store| {
        let existing = store.profiles.get(server_name);
        let same_configuration = match existing {
            Some(profile) => {
                profile.binding.endpoint == binding.endpoint
                    && profile.binding.owner == binding.owner
                    && profile.binding.host == binding.host
                    && profile_configuration_matches(
                        profile,
                        &registration,
                        &config.authorization_metadata,
                    )?
            }
            None => false,
        };
        let matching = existing.filter(|_| same_configuration);
        let previous_issuer = matching.and_then(|profile| profile.binding.issuer.clone());
        let credentials = matching
            .filter(|profile| profile.scopes == config.scopes)
            .and_then(|profile| profile.credentials.clone());
        let redirect_uri = matching
            .filter(|profile| profile.scopes == config.scopes)
            .and_then(|profile| profile.redirect_uri.clone());
        let registered_client_secret = matching
            .filter(|profile| profile.scopes == config.scopes)
            .and_then(|profile| profile.registered_client_secret.clone());
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
                registered_client_secret,
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
    Ok(
        if profile
            .credentials
            .as_ref()
            .is_some_and(|value| value.token_response.is_some())
        {
            if !profile.pending_scopes.is_empty() && !pending_authorization_is_live(profile) {
                McpOAuthStatus::NeedsAuthorization
            } else {
                McpOAuthStatus::Connected
            }
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
        profile.pending_authorization_url = None;
        profile.pending_scopes.clear();
        profile.registered_client_secret = None;
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
pub fn rename_mcp_oauth_profile(
    cwd: &Path,
    old_name: &str,
    new_name: &str,
    redirect_uri: &str,
) -> Result<()> {
    if old_name == new_name {
        return Ok(());
    }
    let redirect_uri = validate_https_url(redirect_uri, "MCP OAuth redirect URI", true)?;
    let path = oauth_store_path(cwd)?;
    edit_store(&path, |store| {
        if store.profiles.contains_key(new_name) {
            bail!("MCP OAuth is already configured for the renamed server");
        }
        if let Some(mut profile) = store.profiles.remove(old_name) {
            profile.redirect_uri = Some(redirect_uri);
            profile.pending_authorization_url = None;
            profile.pending_scopes.clear();
            profile.states.clear();
            if matches!(profile.registration, McpOAuthRegistration::Dynamic { .. }) {
                profile.credentials = None;
                profile.registered_client_secret = None;
            }
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
    save_mode: CredentialSaveMode,
}

#[derive(Clone, Copy)]
enum CredentialSaveMode {
    Independent,
    /// rmcp holds the credential lock across refresh load, exchange, and save.
    RefreshGuarded,
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
        let update = |store: &mut OAuthStoreFile| {
            let profile = store
                .profiles
                .get_mut(&self.server_name)
                .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
            validate_profile_binding(profile, &self.endpoint)?;
            profile.binding.issuer = credentials.issuer.clone();
            if matches!(self.save_mode, CredentialSaveMode::Independent) {
                if credentials.granted_scopes.is_empty() {
                    profile.pending_scopes.clear();
                } else {
                    profile
                        .pending_scopes
                        .retain(|scope| !credentials.granted_scopes.contains(scope));
                }
                if !pending_authorization_is_live(profile) {
                    profile.pending_authorization_url = None;
                }
            }
            profile.credentials = Some(credentials);
            Ok(())
        };
        let result: Result<()> = match self.save_mode {
            CredentialSaveMode::Independent => edit_store(&self.path, update),
            CredentialSaveMode::RefreshGuarded => (|| -> Result<()> {
                let mut store = read_store(&self.path)?;
                update(&mut store)?;
                write_store(&self.path, &store)
            })(),
        };
        result.map_err(Self::auth_error)
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
            profile.pending_authorization_url = None;
            profile.pending_scopes.clear();
            profile.registered_client_secret = None;
            Ok(())
        })
        .map_err(Self::auth_error)
    }

    async fn acquire_refresh_guard(
        &self,
    ) -> std::result::Result<Option<CredentialRefreshGuard>, AuthError> {
        if matches!(self.save_mode, CredentialSaveMode::Independent) {
            return Ok(None);
        }
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
                now.saturating_sub(value.created_at) <= MCP_OAUTH_STATE_TTL.as_secs()
            });
            profile.states.insert(csrf_token.to_string(), state);
            if !pending_authorization_is_live(profile) {
                let mut pending = Url::parse("urn:nac:oauth:pending")
                    .context("internal pending authorization URI is invalid")?;
                pending.query_pairs_mut().append_pair("state", csrf_token);
                profile.pending_authorization_url = Some(pending.into());
            }
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
        Ok(
            (now.saturating_sub(state.created_at) <= MCP_OAUTH_STATE_TTL.as_secs())
                .then_some(state),
        )
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
    save_mode: CredentialSaveMode,
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
        save_mode,
    };
    let mut manager = AuthorizationManager::new(endpoint)
        .await
        .context("MCP OAuth metadata client initialization failed")?;
    manager.set_credential_store(adapter.clone());
    manager.set_state_store(adapter);
    let mut metadata: AuthorizationMetadata =
        if let Some(metadata) = profile.authorization_metadata.clone() {
            let mut metadata = authorization_metadata(metadata)?;
            if matches!(registration, ResolvedRegistration::ClientMetadata { .. }) {
                metadata
                    .additional_fields
                    .entry("client_id_metadata_document_supported".to_string())
                    .or_insert(serde_json::Value::Bool(true));
            }
            metadata
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
        match metadata.issuer.as_deref() {
            Some(metadata_issuer) if metadata_issuer != bound_issuer => {
                bail!("protected MCP OAuth credentials do not match the authorization issuer");
            }
            None => metadata.issuer = Some(bound_issuer.to_string()),
            Some(_) => {}
        }
    }
    manager.set_metadata(metadata.clone());
    Ok((manager, profile, metadata))
}

fn active_scopes(profile: &OAuthProfile) -> Vec<String> {
    let mut scopes = profile.scopes.clone();
    if let Some(credentials) = profile.credentials.as_ref() {
        for scope in &credentials.granted_scopes {
            if !scopes.contains(scope) {
                scopes.push(scope.clone());
            }
        }
    }
    scopes
}
fn authorization_scopes(profile: &OAuthProfile) -> Vec<String> {
    let mut scopes = profile.scopes.clone();
    for scope in &profile.pending_scopes {
        if !scopes.contains(scope) {
            scopes.push(scope.clone());
        }
    }
    if let Some(credentials) = profile.credentials.as_ref() {
        for scope in &credentials.granted_scopes {
            if !scopes.contains(scope) {
                scopes.push(scope.clone());
            }
        }
    }
    scopes
}
fn requires_dynamic_registration(
    profile: &OAuthProfile,
    registration: &ResolvedRegistration,
    redirect_uri: &str,
) -> bool {
    matches!(registration, ResolvedRegistration::Dynamic { .. })
        && (profile.credentials.is_none() || profile.redirect_uri.as_deref() != Some(redirect_uri))
}

pub async fn begin_mcp_oauth_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    redirect_uri: &str,
    additional_scopes: &[String],
) -> Result<McpOAuthAuthorizationSession> {
    let redirect_uri = validate_https_url(redirect_uri, "MCP OAuth redirect URI", true)?;
    let (mut manager, profile, metadata) =
        manager_and_profile(cwd, server_name, endpoint, CredentialSaveMode::Independent).await?;
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
    let mut scopes = authorization_scopes(&profile);
    let mut pending_scopes = if profile
        .credentials
        .as_ref()
        .is_some_and(|credentials| credentials.token_response.is_some())
    {
        profile.pending_scopes.clone()
    } else {
        scopes.clone()
    };
    for scope in additional_scopes {
        let scope = scope.trim();
        if scope.is_empty() {
            bail!("MCP OAuth step-up scopes must not contain blank values");
        }
        if !scopes.iter().any(|value| value == scope) {
            scopes.push(scope.to_string());
        }
        if !pending_scopes.iter().any(|value| value == scope) {
            pending_scopes.push(scope.to_string());
        }
    }
    let application_type = oauth_application_type(&redirect_uri);
    let dynamic_registration =
        if requires_dynamic_registration(&profile, &registration, &redirect_uri) {
            if let ResolvedRegistration::Dynamic { client_name } = &registration {
                manager
                    .configure_client(
                        OAuthClientConfig::new("pending-dynamic-registration", &redirect_uri)
                            .with_application_type(application_type),
                    )
                    .context("MCP OAuth dynamic client registration could not start")?;
                let scope_refs: Vec<&str> = scopes.iter().map(String::as_str).collect();
                Some(
                    manager
                        .register_client(
                            client_name.as_deref().unwrap_or("NAC MCP Client"),
                            &redirect_uri,
                            &scope_refs,
                        )
                        .await
                        .context("MCP OAuth dynamic client registration failed")?,
                )
            } else {
                None
            }
        } else {
            None
        };
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
        ResolvedRegistration::Dynamic { .. } => {
            if let Some(config) = dynamic_registration.as_ref() {
                let request = request.with_preregistered_client(config.client_id.clone());
                match config.client_secret.as_ref() {
                    Some(secret) => request.with_client_secret(secret.clone()),
                    None => request,
                }
            } else if let Some(credentials) = profile.credentials.as_ref() {
                let request = request.with_preregistered_client(credentials.client_id.clone());
                match profile.registered_client_secret.as_ref() {
                    Some(secret) => request.with_client_secret(secret.clone()),
                    None => request,
                }
            } else {
                bail!("MCP OAuth dynamic registration was not prepared");
            }
        }
    };
    request = request.with_application_type(application_type);
    let session = AuthorizationSession::new(manager, request)
        .await
        .map_err(|(_, error)| anyhow!(error).context("MCP OAuth authorization could not start"))?;
    let authorization_url = session.get_authorization_url().to_string();
    let (client_id, _) = match session.get_credentials().await {
        Ok(credentials) => credentials,
        Err(error) => {
            return Err(failed_authorization_start(
                cwd,
                server_name,
                endpoint,
                &authorization_url,
                anyhow!(error).context("MCP OAuth client registration could not be stored"),
            ));
        }
    };
    let path = oauth_store_path(cwd)?;
    let publication = edit_store(&path, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        profile.redirect_uri = Some(redirect_uri.clone());
        publish_pending_authorization(profile, authorization_url.clone())?;
        merge_pending_scopes(&mut profile.pending_scopes, &pending_scopes);
        profile.registered_client_secret = match &profile.registration {
            McpOAuthRegistration::Dynamic { .. } => dynamic_registration.as_ref().map_or_else(
                || profile.registered_client_secret.clone(),
                |config| config.client_secret.clone(),
            ),
            _ => None,
        };
        if dynamic_registration.is_some() || profile.credentials.is_none() {
            profile.credentials = Some(
                StoredCredentials::new(client_id, None, Vec::new(), None)
                    .with_issuer(profile.binding.issuer.clone()),
            );
        }
        Ok(())
    });
    if let Err(error) = publication {
        return Err(failed_authorization_start(
            cwd,
            server_name,
            endpoint,
            &authorization_url,
            error.context("MCP OAuth authorization could not be published"),
        ));
    }
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
    Ok(pending_authorization_is_live(profile)
        .then(|| profile.pending_authorization_url.clone())
        .flatten()
        .filter(|url| Url::parse(url).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))))
}
pub fn mcp_oauth_callback_is_retryable(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    callback_url: &str,
) -> Result<bool> {
    let callback_url = Url::parse(callback_url).context("MCP OAuth callback URL is invalid")?;
    let mut states = callback_url
        .query_pairs()
        .filter(|(name, _)| name == "state")
        .map(|(_, value)| value.into_owned());
    let Some(state) = states.next() else {
        return Ok(false);
    };
    if states.next().is_some() {
        return Ok(false);
    }
    let store = read_store(&oauth_store_path(cwd)?)?;
    let Some(profile) = store.profiles.get(server_name) else {
        return Ok(false);
    };
    validate_profile_binding(profile, endpoint)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(profile
        .states
        .get(&state)
        .is_some_and(|value| now.saturating_sub(value.created_at) <= MCP_OAUTH_STATE_TTL.as_secs()))
}
pub(crate) fn record_mcp_oauth_pending_authorization_url(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    authorization_url: String,
) -> Result<()> {
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        let state = authorization_state(&authorization_url)
            .ok_or_else(|| anyhow!("authorization URL has invalid state"))?;
        if pending_authorization_is_live(profile)
            && profile.pending_authorization_url.as_deref() != Some(&authorization_url)
            && profile
                .pending_authorization_url
                .as_deref()
                .and_then(authorization_state)
                .as_deref()
                != Some(&state)
        {
            profile.states.remove(&state);
            return Ok(());
        }
        publish_pending_authorization(profile, authorization_url)
    })
}
pub fn fail_mcp_oauth_authorization(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    expected_authorization_url: Option<&str>,
) -> Result<bool> {
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        if expected_authorization_url
            .is_some_and(|expected| profile.pending_authorization_url.as_deref() != Some(expected))
        {
            return Ok(false);
        }
        profile.pending_authorization_url = None;
        profile.pending_scopes.clear();
        profile.states.clear();
        Ok(true)
    })
}
pub fn set_mcp_oauth_redirect_uri(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    redirect_uri: &str,
) -> Result<bool> {
    let redirect_uri = validate_https_url(redirect_uri, "MCP OAuth redirect URI", true)?;
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        if profile.redirect_uri.as_deref() == Some(redirect_uri.as_str()) {
            return Ok(false);
        }
        profile.redirect_uri = Some(redirect_uri);
        profile.pending_authorization_url = None;
        profile.pending_scopes.clear();
        profile.states.clear();
        if matches!(profile.registration, McpOAuthRegistration::Dynamic { .. }) {
            profile.credentials = None;
            profile.registered_client_secret = None;
        }
        Ok(true)
    })
}

pub(crate) struct McpOAuthScopeStepUp {
    pub(crate) uses_loopback: bool,
    pub(crate) authorization_in_progress: bool,
    pub(crate) authorization_scopes: Vec<String>,
}
pub(crate) fn prepare_mcp_oauth_scope_step_up(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
    required_scope: &str,
) -> Result<McpOAuthScopeStepUp> {
    edit_store(&oauth_store_path(cwd)?, |store| {
        let profile = store
            .profiles
            .get_mut(server_name)
            .ok_or_else(|| anyhow!("MCP OAuth is not configured"))?;
        validate_profile_binding(profile, endpoint)?;
        for scope in required_scope.split_whitespace() {
            if !profile.pending_scopes.iter().any(|value| value == scope) {
                profile.pending_scopes.push(scope.to_string());
            }
        }
        let authorization_in_progress = pending_authorization_is_live(profile);
        if !authorization_in_progress {
            profile.pending_authorization_url = None;
            profile.states.clear();
        }
        Ok(McpOAuthScopeStepUp {
            uses_loopback: profile
                .redirect_uri
                .as_deref()
                .unwrap_or(MCP_OAUTH_REDIRECT_URI)
                == MCP_OAUTH_REDIRECT_URI,
            authorization_in_progress,
            authorization_scopes: authorization_scopes(profile),
        })
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
    let (mut manager, profile, _) =
        manager_and_profile(cwd, server_name, endpoint, CredentialSaveMode::Independent).await?;
    let redirect_uri = profile
        .redirect_uri
        .as_deref()
        .ok_or_else(|| anyhow!("MCP OAuth authorization has no pending redirect URI"))?;
    let registration = resolve_registration(&profile.registration)?;
    let client = restored_client_config(
        &profile,
        &registration,
        redirect_uri,
        authorization_scopes(&profile),
    )?;
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
    matches!(
        (authorization_state(authorization_url), authorization_state(callback_url)),
        (Some(expected), Some(actual)) if actual == expected
    )
}

pub(crate) async fn authorized_manager(
    cwd: &Path,
    server_name: &str,
    endpoint: &str,
) -> Result<AuthorizationManager> {
    let (mut manager, profile, _) = manager_and_profile(
        cwd,
        server_name,
        endpoint,
        CredentialSaveMode::RefreshGuarded,
    )
    .await?;
    if !profile
        .credentials
        .as_ref()
        .is_some_and(|credentials| credentials.token_response.is_some())
    {
        bail!("MCP OAuth authorization is required");
    }
    if !manager
        .initialize_from_store()
        .await
        .context("MCP OAuth credentials could not be loaded")?
    {
        bail!("MCP OAuth authorization is required");
    }
    let registration = resolve_registration(&profile.registration)?;
    let redirect_uri = profile
        .redirect_uri
        .as_deref()
        .unwrap_or(MCP_OAUTH_REDIRECT_URI);
    let client = restored_client_config(
        &profile,
        &registration,
        redirect_uri,
        active_scopes(&profile),
    )?;
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

    mod live_tests;

    #[test]
    fn ipv6_loopback_http_is_accepted_only_where_loopback_is_allowed() {
        assert_eq!(
            normalize_endpoint("http://[::1]:8080/mcp").unwrap(),
            "http://[::1]:8080/mcp"
        );
        assert_eq!(
            validate_https_url("http://[::1]:1456/callback", "redirect URI", true).unwrap(),
            "http://[::1]:1456/callback"
        );
        assert!(validate_https_url(
            "http://[::1]:1456/client.json",
            "client metadata URL",
            false
        )
        .is_err());
        assert!(normalize_endpoint("http://[2001:db8::1]/mcp").is_err());
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
            save_mode: CredentialSaveMode::Independent,
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
            additional_fields: BTreeMap::new(),
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

    #[test]
    fn version_one_store_migrates_without_losing_the_profile() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (home, _restore) = test_environment("version-one-migration");
        let endpoint = "https://mcp.slack.com/mcp";
        let legacy = serde_json::json!({
            "version": 1,
            "profiles": {
                "slack": {
                    "binding": {
                        "endpoint": endpoint,
                        "client_fingerprint": client_id_fingerprint("public-test-client"),
                        "owner": owner_boundary(),
                        "host": host_boundary().unwrap(),
                        "issuer": null
                    },
                    "client_id_credential": "TEST_MCP_CLIENT_ID",
                    "client_secret_credential": "TEST_MCP_CLIENT_SECRET",
                    "scopes": ["channels:history"],
                    "credentials": null,
                    "states": {}
                }
            }
        });
        write_auth_string_to_path(
            &home.join(OAUTH_STORE_FILE),
            &serde_json::to_string(&legacy).unwrap(),
        )
        .unwrap();
        assert_eq!(
            mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
            McpOAuthStatus::NeedsAuthorization
        );
        unsafe {
            std::env::remove_var("TEST_MCP_CLIENT_ID");
            std::env::remove_var("TEST_MCP_CLIENT_SECRET");
        }
        clear_mcp_oauth(Path::new("/workspace"), "slack").unwrap();
        let migrated = std::fs::read_to_string(home.join(OAUTH_STORE_FILE)).unwrap();
        assert!(migrated.contains("\"version\":2"));
        assert!(migrated.contains("\"registration\""));
        assert!(migrated.contains("\"legacy_client_fingerprint\""));
        assert!(!migrated.contains("public-test-client"));
        assert!(!migrated.contains("secret-test-canary"));
    }

    #[test]
    fn version_one_reconfigure_preserves_matching_authorization() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (home, _restore) = test_environment("version-one-reconfigure");
        let endpoint = "https://mcp.slack.com/mcp";
        let legacy = serde_json::json!({
            "version": 1,
            "profiles": {
                "slack": {
                    "binding": {
                        "endpoint": endpoint,
                        "client_fingerprint": client_id_fingerprint("public-test-client"),
                        "owner": owner_boundary(),
                        "host": host_boundary().unwrap(),
                        "issuer": null
                    },
                    "client_id_credential": "TEST_MCP_CLIENT_ID",
                    "client_secret_credential": "TEST_MCP_CLIENT_SECRET",
                    "scopes": ["channels:history", "chat:write"],
                    "credentials": {
                        "client_id": "public-test-client",
                        "token_response": {
                            "access_token": "legacy-access-token-canary",
                            "token_type": "bearer"
                        },
                        "granted_scopes": ["channels:history", "chat:write"],
                        "token_received_at": 1,
                        "issuer": null
                    },
                    "states": {}
                }
            }
        });
        write_auth_string_to_path(
            &home.join(OAUTH_STORE_FILE),
            &serde_json::to_string(&legacy).unwrap(),
        )
        .unwrap();
        assert_eq!(
            configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, configuration())
                .unwrap(),
            McpOAuthStatus::Connected
        );
        assert_eq!(
            mcp_oauth_status(Path::new("/workspace"), "slack", endpoint).unwrap(),
            McpOAuthStatus::Connected
        );
        let migrated = std::fs::read_to_string(home.join(OAUTH_STORE_FILE)).unwrap();
        assert!(migrated.contains("legacy-access-token-canary"));
        assert!(!migrated.contains("legacy_client_fingerprint"));
    }

    #[test]
    fn metadata_fingerprint_is_stable_and_scope_state_is_restored() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("stable-fingerprint");
        let first: McpOAuthAuthorizationMetadata = serde_json::from_value(serde_json::json!({
            "authorization_endpoint": "https://auth.example.test/authorize",
            "token_endpoint": "https://auth.example.test/token",
            "z_extension": true,
            "a_extension": {"nested": true}
        }))
        .unwrap();
        let second: McpOAuthAuthorizationMetadata = serde_json::from_str(
            r#"{"a_extension":{"nested":true},"token_endpoint":"https://auth.example.test/token","z_extension":true,"authorization_endpoint":"https://auth.example.test/authorize"}"#,
        )
        .unwrap();
        let registration = ResolvedRegistration::Dynamic {
            client_name: Some("NAC Test".into()),
        };
        assert_eq!(
            configuration_fingerprint(&registration, &Some(first)).unwrap(),
            configuration_fingerprint(&registration, &Some(second)).unwrap()
        );
        let mut profile = OAuthProfile {
            binding: OAuthBinding {
                endpoint: "https://mcp.example.test/mcp".into(),
                configuration_fingerprint: "test".into(),
                legacy_client_fingerprint: None,
                owner: "test".into(),
                host: "test".into(),
                issuer: None,
            },
            registration: McpOAuthRegistration::Dynamic {
                client_name: Some("NAC Test".into()),
            },
            scopes: vec!["mcp:read".into()],
            authorization_metadata: None,
            redirect_uri: None,
            pending_authorization_url: Some("https://auth.example.test/authorize".into()),
            pending_scopes: vec!["mcp:write".into()],
            registered_client_secret: Some("registered-secret".into()),
            credentials: Some(StoredCredentials::new(
                "dynamic-client".into(),
                None,
                vec!["mcp:admin".into()],
                None,
            )),
            states: BTreeMap::new(),
        };
        assert_eq!(
            authorization_scopes(&profile),
            vec!["mcp:read", "mcp:write", "mcp:admin"]
        );
        assert_eq!(active_scopes(&profile), vec!["mcp:read", "mcp:admin"]);
        assert_eq!(
            restored_client_secret(&profile, &registration),
            Some("registered-secret")
        );
        profile.pending_scopes.push("mcp:read".into());
        assert_eq!(
            authorization_scopes(&profile),
            vec!["mcp:read", "mcp:write", "mcp:admin"]
        );
        assert_eq!(active_scopes(&profile), vec!["mcp:read", "mcp:admin"]);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn explicit_metadata_override_asserts_cimd_support() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("cimd-override");
        let endpoint = "https://mcp.example.test/mcp";
        configure_mcp_oauth(
            Path::new("/workspace"),
            "cimd",
            endpoint,
            McpOAuthConfiguration {
                registration: McpOAuthRegistration::ClientMetadata {
                    url: "https://nac.example.test/oauth-client.json".into(),
                },
                scopes: vec!["mcp:read".into()],
                authorization_metadata: Some(McpOAuthAuthorizationMetadata {
                    authorization_endpoint: "https://auth.example.test/authorize".into(),
                    token_endpoint: "https://auth.example.test/token".into(),
                    registration_endpoint: None,
                    issuer: None,
                    jwks_uri: None,
                    scopes_supported: None,
                    response_types_supported: None,
                    code_challenge_methods_supported: None,
                    additional_fields: BTreeMap::new(),
                }),
            },
        )
        .unwrap();
        let (_, _, metadata) = manager_and_profile(
            Path::new("/workspace"),
            "cimd",
            endpoint,
            CredentialSaveMode::Independent,
        )
        .await
        .unwrap();
        assert_eq!(
            metadata
                .additional_fields
                .get("client_id_metadata_document_supported"),
            Some(&serde_json::Value::Bool(true))
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn placeholder_credentials_do_not_authorize_an_abandoned_flow() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("placeholder-credentials");
        let endpoint = "https://mcp.example.test/mcp";
        let mut config = configuration();
        config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
            authorization_endpoint: "https://auth.example.test/authorize".into(),
            token_endpoint: "https://auth.example.test/token".into(),
            registration_endpoint: None,
            issuer: Some("https://auth.example.test/".into()),
            jwks_uri: None,
            scopes_supported: None,
            response_types_supported: None,
            code_challenge_methods_supported: None,
            additional_fields: BTreeMap::new(),
        });
        configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, config).unwrap();
        edit_store(
            &oauth_store_path(Path::new("/workspace")).unwrap(),
            |store| {
                store.profiles.get_mut("slack").unwrap().credentials = Some(
                    StoredCredentials::new("public-test-client".into(), None, Vec::new(), None),
                );
                Ok(())
            },
        )
        .unwrap();
        let error = match authorized_manager(Path::new("/workspace"), "slack", endpoint).await {
            Ok(_) => panic!("placeholder credentials unexpectedly authorized the MCP client"),
            Err(error) => error,
        };
        assert!(error.to_string().contains("authorization is required"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn issuer_optional_override_reuses_the_stored_issuer_binding() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let (_home, _restore) = test_environment("optional-override-issuer");
        let endpoint = "https://mcp.example.test/mcp";
        let mut config = configuration();
        config.authorization_metadata = Some(McpOAuthAuthorizationMetadata {
            authorization_endpoint: "https://auth.example.test/authorize".into(),
            token_endpoint: "https://auth.example.test/token".into(),
            registration_endpoint: None,
            issuer: None,
            jwks_uri: None,
            scopes_supported: None,
            response_types_supported: None,
            code_challenge_methods_supported: None,
            additional_fields: BTreeMap::new(),
        });
        configure_mcp_oauth(Path::new("/workspace"), "slack", endpoint, config).unwrap();
        edit_store(
            &oauth_store_path(Path::new("/workspace")).unwrap(),
            |store| {
                let profile = store.profiles.get_mut("slack").unwrap();
                profile.binding.issuer = Some("https://issuer.example.test/".into());
                profile.credentials = Some(
                    serde_json::from_value(serde_json::json!({
                        "client_id": "public-test-client",
                        "token_response": {
                            "access_token": "access-token-canary",
                            "token_type": "bearer"
                        },
                        "granted_scopes": ["chat:write"],
                        "token_received_at": 1,
                        "issuer": "https://issuer.example.test/"
                    }))
                    .unwrap(),
                );
                Ok(())
            },
        )
        .unwrap();
        let (_, _, metadata) = manager_and_profile(
            Path::new("/workspace"),
            "slack",
            endpoint,
            CredentialSaveMode::Independent,
        )
        .await
        .unwrap();
        assert_eq!(
            metadata.issuer.as_deref(),
            Some("https://issuer.example.test/")
        );
        authorized_manager(Path::new("/workspace"), "slack", endpoint)
            .await
            .unwrap();
    }
}
