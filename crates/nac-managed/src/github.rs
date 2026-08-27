//! Managed GitHub App user authorization and repository discovery.
//!
//! Tokens are held in a dedicated owner-only file. HTTP callers receive only
//! connection metadata; the access token leaves this module solely through
//! the narrow command/Git credential integration.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::{anyhow, bail, Context, Result};
use reqwest::{Method, StatusCode, Url};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::github_credential_store::{
    GitHubCredentialStore, GitHubIdentity, StoredGitHubAuth, AUTH_STORE_VERSION,
};

const ORGANIZATION: &str = "arcee-ai";
const REFRESH_SKEW_MS: u64 = 5 * 60 * 1_000;
const LOCK_RETRY: Duration = Duration::from_millis(25);
const MAX_PAGES: u32 = 100;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GitHubEndpoints {
    pub device_code_url: Url,
    pub token_url: Url,
    pub api_base_url: Url,
}

impl GitHubEndpoints {
    pub fn official() -> Self {
        Self {
            device_code_url: Url::parse("https://github.com/login/device/code")
                .expect("fixed GitHub device URL"),
            token_url: Url::parse("https://github.com/login/oauth/access_token")
                .expect("fixed GitHub token URL"),
            api_base_url: Url::parse("https://api.github.com/").expect("fixed GitHub API URL"),
        }
    }

    pub fn validate_for_managed_host(&self) -> Result<()> {
        for (name, url) in [
            ("device-code", &self.device_code_url),
            ("token", &self.token_url),
            ("API", &self.api_base_url),
        ] {
            if url.scheme() != "https" || url.host_str().is_none() {
                bail!("managed GitHub {name} endpoint must use HTTPS");
            }
        }
        Ok(())
    }
}

impl Default for GitHubEndpoints {
    fn default() -> Self {
        Self::official()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GitHubAuthFailureKind {
    Reconnect,
    SamlRequired,
    AppNotInstalled,
    Provider,
}

#[derive(Debug)]
pub struct GitHubAuthError {
    kind: GitHubAuthFailureKind,
    message: String,
    authorization_url: Option<String>,
}

impl GitHubAuthError {
    fn new(kind: GitHubAuthFailureKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            authorization_url: None,
        }
    }

    fn saml(message: impl Into<String>, authorization_url: Option<String>) -> Self {
        Self {
            kind: GitHubAuthFailureKind::SamlRequired,
            message: message.into(),
            authorization_url,
        }
    }

    pub fn kind(&self) -> GitHubAuthFailureKind {
        self.kind
    }

    pub fn authorization_url(&self) -> Option<&str> {
        self.authorization_url.as_deref()
    }
}

impl std::fmt::Display for GitHubAuthError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for GitHubAuthError {}

#[derive(Clone)]
pub struct ManagedGitHubAuth {
    state_root: PathBuf,
    store: GitHubCredentialStore,
    client_id: String,
    endpoints: GitHubEndpoints,
    http: reqwest::Client,
}

impl std::fmt::Debug for ManagedGitHubAuth {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ManagedGitHubAuth")
            .field("path", &self.store.path())
            .field("client_id", &self.client_id)
            .field("endpoints", &self.endpoints)
            .finish_non_exhaustive()
    }
}

impl ManagedGitHubAuth {
    pub fn new(state_root: impl AsRef<Path>, client_id: impl Into<String>) -> Result<Self> {
        Self::with_endpoints(state_root, client_id, GitHubEndpoints::official())
    }

    pub fn with_endpoints(
        state_root: impl AsRef<Path>,
        client_id: impl Into<String>,
        endpoints: GitHubEndpoints,
    ) -> Result<Self> {
        let client_id = client_id.into();
        if client_id.trim().is_empty() {
            bail!("managed GitHub client ID must not be blank");
        }
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(format!("nac-web/{}", env!("CARGO_PKG_VERSION")))
            .build()
            .context("failed to build managed GitHub HTTP client")?;
        let state_root = state_root.as_ref();
        Ok(Self {
            state_root: state_root.to_path_buf(),
            store: GitHubCredentialStore::new(state_root),
            client_id,
            endpoints,
            http,
        })
    }

    pub fn endpoints(&self) -> &GitHubEndpoints {
        &self.endpoints
    }

    pub fn state_root(&self) -> &Path {
        &self.state_root
    }

    pub fn client_id(&self) -> &str {
        &self.client_id
    }

    pub fn status(&self) -> Result<GitHubConnectionStatus> {
        Ok(match self.store.load(ORGANIZATION)? {
            Some(auth) => GitHubConnectionStatus {
                connected: true,
                git_name: Some(
                    auth.identity
                        .name
                        .clone()
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or_else(|| auth.identity.login.clone()),
                ),
                git_email: Some(format!(
                    "{}+{}@users.noreply.github.com",
                    auth.identity.id, auth.identity.login
                )),
                login: Some(auth.identity.login),
                name: auth.identity.name,
                avatar_url: auth.identity.avatar_url,
                organization: Some(auth.organization),
                expires_at_ms: Some(auth.access_expires_at_ms),
            },
            None => GitHubConnectionStatus::disconnected(),
        })
    }

    pub async fn begin_device_login(&self) -> Result<GitHubDeviceLogin> {
        let response = self
            .http
            .post(self.endpoints.device_code_url.clone())
            .header("Accept", "application/json")
            .form(&[("client_id", self.client_id.as_str())])
            .send()
            .await
            .context("GitHub device authorization request failed")?;
        if !response.status().is_success() {
            bail!(
                "GitHub device authorization request failed with status {}",
                response.status()
            );
        }
        let prompt: DeviceCodeResponse = response
            .json()
            .await
            .context("GitHub device authorization returned an invalid response")?;
        if prompt.device_code.trim().is_empty()
            || prompt.user_code.trim().is_empty()
            || prompt.verification_uri.trim().is_empty()
            || prompt.expires_in == 0
        {
            bail!("GitHub device authorization returned incomplete data");
        }
        Ok(GitHubDeviceLogin {
            auth: self.clone(),
            device_code: prompt.device_code,
            verification_uri: prompt.verification_uri,
            user_code: prompt.user_code,
            expires_in_secs: prompt.expires_in,
            interval_secs: prompt.interval.unwrap_or(5),
        })
    }

    pub fn disconnect(&self) -> Result<bool> {
        let _lock = self.store.acquire()?;
        self.store.remove()
    }

    pub(crate) fn stored_token_for_redaction(&self) -> Result<Option<GitHubAccessToken>> {
        Ok(self
            .store
            .load(ORGANIZATION)?
            .map(|stored| GitHubAccessToken(stored.access_token)))
    }

    pub async fn current_token(&self) -> Result<Option<GitHubAccessToken>> {
        loop {
            let Some(_lock) = self.store.try_acquire()? else {
                tokio::time::sleep(LOCK_RETRY).await;
                continue;
            };
            let Some(mut stored) = self.store.load(ORGANIZATION)? else {
                return Ok(None);
            };
            let now = now_ms()?;
            if stored.access_expires_at_ms > now.saturating_add(REFRESH_SKEW_MS) {
                return Ok(Some(GitHubAccessToken(stored.access_token)));
            }
            if stored.refresh_expires_at_ms <= now {
                self.store.remove()?;
                return Err(GitHubAuthError::new(
                    GitHubAuthFailureKind::Reconnect,
                    "GitHub authorization expired; reconnect GitHub",
                )
                .into());
            }
            let refreshed = match self.refresh(&stored.refresh_token).await {
                Ok(refreshed) => refreshed,
                Err(error)
                    if error
                        .downcast_ref::<GitHubAuthError>()
                        .is_some_and(|error| error.kind() == GitHubAuthFailureKind::Reconnect) =>
                {
                    self.store.remove()?;
                    return Err(error);
                }
                Err(error) => return Err(error),
            };
            stored.access_token = refreshed.access_token;
            stored.refresh_token = refreshed.refresh_token;
            stored.access_expires_at_ms = now.saturating_add(refreshed.expires_in * 1_000);
            stored.refresh_expires_at_ms =
                now.saturating_add(refreshed.refresh_token_expires_in * 1_000);
            self.store.save(&stored)?;
            return Ok(Some(GitHubAccessToken(stored.access_token)));
        }
    }

    pub async fn repositories(&self) -> Result<Vec<GitHubRepository>> {
        let installation_id = self.organization_installation_id().await?;
        let mut repositories: Vec<GitHubRepository> = Vec::new();
        for page in 1..=MAX_PAGES {
            let path = format!(
                "user/installations/{installation_id}/repositories?per_page=100&page={page}"
            );
            let response: InstallationRepositories = self.authorized_json(&path).await?;
            let count = response.repositories.len();
            repositories.extend(response.repositories.into_iter().map(Into::into));
            if count < 100 {
                break;
            }
        }
        repositories.sort_by(|left, right| left.full_name.cmp(&right.full_name));
        Ok(repositories)
    }

    pub async fn branches(&self, owner: &str, repository: &str) -> Result<Vec<String>> {
        validate_repository_component("owner", owner)?;
        validate_repository_component("repository", repository)?;
        if !owner.eq_ignore_ascii_case(ORGANIZATION) {
            bail!("managed repository owner must be {ORGANIZATION}");
        }
        let mut branches = Vec::new();
        for page in 1..=MAX_PAGES {
            let path = format!("repos/{owner}/{repository}/branches?per_page=100&page={page}");
            let response: Vec<BranchResponse> = self.authorized_json(&path).await?;
            let count = response.len();
            branches.extend(response.into_iter().map(|branch| branch.name));
            if count < 100 {
                break;
            }
        }
        Ok(branches)
    }

    async fn organization_installation_id(&self) -> Result<u64> {
        let installations: InstallationsResponse =
            self.authorized_json("user/installations").await?;
        installations
            .installations
            .into_iter()
            .find(|installation| {
                installation
                    .account
                    .login
                    .eq_ignore_ascii_case(ORGANIZATION)
            })
            .map(|installation| installation.id)
            .ok_or_else(|| {
                GitHubAuthError::new(
                    GitHubAuthFailureKind::AppNotInstalled,
                    "the Managed NAC GitHub App is not installed for arcee-ai",
                )
                .into()
            })
    }

    async fn authorized_json<T: DeserializeOwned>(&self, relative: &str) -> Result<T> {
        for attempt in 0..2 {
            let token = self.current_token().await?.ok_or_else(|| {
                GitHubAuthError::new(
                    GitHubAuthFailureKind::Reconnect,
                    "GitHub is not connected; connect GitHub",
                )
            })?;
            let url = self
                .endpoints
                .api_base_url
                .join(relative)
                .context("invalid managed GitHub API path")?;
            let response = self
                .http
                .request(Method::GET, url)
                .bearer_auth(token.secret())
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .send()
                .await
                .context("GitHub API request failed")?;
            if response.status() == StatusCode::UNAUTHORIZED && attempt == 0 {
                self.force_access_expiry()?;
                continue;
            }
            if response.status() == StatusCode::UNAUTHORIZED {
                self.disconnect()?;
                return Err(GitHubAuthError::new(
                    GitHubAuthFailureKind::Reconnect,
                    "GitHub authorization was revoked; reconnect GitHub",
                )
                .into());
            }
            if response.status() == StatusCode::FORBIDDEN {
                let sso = response
                    .headers()
                    .get("X-GitHub-SSO")
                    .and_then(|value| value.to_str().ok())
                    .map(str::to_string);
                if let Some(sso) = sso {
                    return Err(GitHubAuthError::saml(
                        "GitHub requires an arcee-ai SAML session; authorize SSO and retry",
                        parse_sso_url(&sso),
                    )
                    .into());
                }
            }
            if !response.status().is_success() {
                return Err(GitHubAuthError::new(
                    GitHubAuthFailureKind::Provider,
                    format!(
                        "GitHub API request failed with status {}",
                        response.status()
                    ),
                )
                .into());
            }
            return response
                .json()
                .await
                .context("GitHub API returned an invalid response");
        }
        unreachable!("authorized request retry loop has a fixed terminal branch")
    }

    async fn complete_device_login(
        &self,
        device_code: &str,
        expires_in: u64,
        interval: u64,
    ) -> Result<GitHubConnectionStatus> {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(expires_in);
        let mut interval = interval;
        loop {
            if tokio::time::Instant::now() >= deadline {
                return Err(GitHubAuthError::new(
                    GitHubAuthFailureKind::Reconnect,
                    "GitHub device authorization expired; reconnect GitHub",
                )
                .into());
            }
            tokio::time::sleep(Duration::from_secs(interval)).await;
            let response = self
                .http
                .post(self.endpoints.token_url.clone())
                .header("Accept", "application/json")
                .form(&[
                    ("client_id", self.client_id.as_str()),
                    ("device_code", device_code),
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ])
                .send()
                .await
                .context("GitHub device token request failed")?;
            let token: TokenResponse = response
                .json()
                .await
                .context("GitHub device token endpoint returned an invalid response")?;
            if let Some(error) = token.error.as_deref() {
                match error {
                    "authorization_pending" => continue,
                    "slow_down" => {
                        interval = interval.saturating_add(5);
                        continue;
                    }
                    "expired_token" | "access_denied" => {
                        return Err(GitHubAuthError::new(
                            GitHubAuthFailureKind::Reconnect,
                            "GitHub device authorization was denied or expired; reconnect GitHub",
                        )
                        .into())
                    }
                    _ => {
                        return Err(GitHubAuthError::new(
                            GitHubAuthFailureKind::Provider,
                            "GitHub device authorization failed",
                        )
                        .into())
                    }
                }
            }
            let tokens = token.into_tokens()?;
            let identity: IdentityResponse = self
                .authorized_json_with_token("user", &tokens.access_token)
                .await?;
            let installation: InstallationsResponse = self
                .authorized_json_with_token("user/installations", &tokens.access_token)
                .await?;
            if !installation.installations.iter().any(|installation| {
                installation
                    .account
                    .login
                    .eq_ignore_ascii_case(ORGANIZATION)
            }) {
                return Err(GitHubAuthError::new(
                    GitHubAuthFailureKind::AppNotInstalled,
                    "the Managed NAC GitHub App is not installed for arcee-ai",
                )
                .into());
            }
            let now = now_ms()?;
            let stored = StoredGitHubAuth {
                version: AUTH_STORE_VERSION,
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                access_expires_at_ms: now.saturating_add(tokens.expires_in * 1_000),
                refresh_expires_at_ms: now.saturating_add(tokens.refresh_token_expires_in * 1_000),
                identity: GitHubIdentity::from(identity),
                organization: ORGANIZATION.to_string(),
            };
            let _lock = self.store.acquire()?;
            self.store.save(&stored)?;
            return self.status();
        }
    }

    async fn authorized_json_with_token<T: DeserializeOwned>(
        &self,
        relative: &str,
        token: &str,
    ) -> Result<T> {
        let url = self.endpoints.api_base_url.join(relative)?;
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .context("GitHub API request failed")?;
        if !response.status().is_success() {
            return Err(GitHubAuthError::new(
                GitHubAuthFailureKind::Provider,
                format!(
                    "GitHub API request failed with status {}",
                    response.status()
                ),
            )
            .into());
        }
        response
            .json()
            .await
            .context("GitHub API returned an invalid response")
    }

    async fn refresh(&self, refresh_token: &str) -> Result<OAuthTokens> {
        let response = self
            .http
            .post(self.endpoints.token_url.clone())
            .header("Accept", "application/json")
            .form(&[
                ("client_id", self.client_id.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .context("GitHub token refresh request failed")?;
        let token: TokenResponse = response
            .json()
            .await
            .context("GitHub token refresh returned an invalid response")?;
        if token.error.is_some() {
            return Err(GitHubAuthError::new(
                GitHubAuthFailureKind::Reconnect,
                "GitHub authorization could not be refreshed; reconnect GitHub",
            )
            .into());
        }
        token.into_tokens()
    }

    fn force_access_expiry(&self) -> Result<()> {
        let _lock = self.store.acquire()?;
        if let Some(mut auth) = self.store.load(ORGANIZATION)? {
            auth.access_expires_at_ms = 0;
            self.store.save(&auth)?;
        }
        Ok(())
    }

    #[cfg(any(test, feature = "test-support"))]
    pub fn store_test_authorization(
        &self,
        access_token: &str,
        refresh_token: &str,
        access_expires_at_ms: u64,
    ) -> Result<()> {
        self.store.save(&StoredGitHubAuth {
            version: AUTH_STORE_VERSION,
            access_token: access_token.to_string(),
            refresh_token: refresh_token.to_string(),
            access_expires_at_ms,
            refresh_expires_at_ms: now_ms()?.saturating_add(60 * 60 * 1_000),
            identity: GitHubIdentity {
                id: 42,
                login: "test-user".to_string(),
                name: Some("Test User".to_string()),
                avatar_url: None,
            },
            organization: ORGANIZATION.to_string(),
        })
    }
}

#[derive(Clone)]
pub struct GitHubAccessToken(String);

impl GitHubAccessToken {
    /// Expose only to the controlled Git credential and command environment
    /// integrations. Callers must never log or serialize the returned value.
    pub fn secret(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for GitHubAccessToken {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("GitHubAccessToken([REDACTED])")
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitHubConnectionStatus {
    pub connected: bool,
    pub login: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    pub organization: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub git_name: Option<String>,
    pub git_email: Option<String>,
}

impl GitHubConnectionStatus {
    pub fn disconnected() -> Self {
        Self {
            connected: false,
            login: None,
            name: None,
            avatar_url: None,
            organization: None,
            expires_at_ms: None,
            git_name: None,
            git_email: None,
        }
    }
}

pub struct GitHubDeviceLogin {
    auth: ManagedGitHubAuth,
    device_code: String,
    verification_uri: String,
    user_code: String,
    expires_in_secs: u64,
    interval_secs: u64,
}

impl GitHubDeviceLogin {
    pub fn prompt(&self) -> GitHubDevicePrompt {
        GitHubDevicePrompt {
            verification_uri: self.verification_uri.clone(),
            user_code: self.user_code.clone(),
            expires_in_secs: self.expires_in_secs,
        }
    }

    pub async fn complete(self) -> Result<GitHubConnectionStatus> {
        self.auth
            .complete_device_login(&self.device_code, self.expires_in_secs, self.interval_secs)
            .await
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubDevicePrompt {
    pub verification_uri: String,
    pub user_code: String,
    pub expires_in_secs: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct GitHubRepository {
    pub id: u64,
    pub name: String,
    pub full_name: String,
    pub private: bool,
    pub can_read: bool,
    pub can_write: bool,
    pub default_branch: String,
    pub clone_url: String,
    pub html_url: String,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
    refresh_token: Option<String>,
    refresh_token_expires_in: Option<u64>,
    error: Option<String>,
}

impl TokenResponse {
    fn into_tokens(self) -> Result<OAuthTokens> {
        Ok(OAuthTokens {
            access_token: required_token_field(self.access_token, "access token")?,
            expires_in: self
                .expires_in
                .filter(|value| *value > 0)
                .ok_or_else(|| anyhow!("GitHub token response omitted access-token expiry"))?,
            refresh_token: required_token_field(self.refresh_token, "refresh token")?,
            refresh_token_expires_in: self
                .refresh_token_expires_in
                .filter(|value| *value > 0)
                .ok_or_else(|| anyhow!("GitHub token response omitted refresh-token expiry"))?,
        })
    }
}

fn required_token_field(value: Option<String>, field: &str) -> Result<String> {
    value
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("GitHub token response omitted {field}"))
}

struct OAuthTokens {
    access_token: String,
    expires_in: u64,
    refresh_token: String,
    refresh_token_expires_in: u64,
}

impl From<IdentityResponse> for GitHubIdentity {
    fn from(identity: IdentityResponse) -> Self {
        Self {
            id: identity.id,
            login: identity.login,
            name: identity.name,
            avatar_url: identity.avatar_url,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct IdentityResponse {
    id: u64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InstallationsResponse {
    installations: Vec<InstallationResponse>,
}

#[derive(Debug, Deserialize)]
struct InstallationResponse {
    id: u64,
    account: AccountResponse,
}

#[derive(Debug, Deserialize)]
struct AccountResponse {
    login: String,
}

#[derive(Debug, Deserialize)]
struct InstallationRepositories {
    repositories: Vec<RepositoryResponse>,
}

#[derive(Debug, Deserialize)]
struct RepositoryResponse {
    id: u64,
    name: String,
    full_name: String,
    private: bool,
    permissions: Option<RepositoryPermissions>,
    default_branch: String,
    clone_url: String,
    html_url: String,
}

impl From<RepositoryResponse> for GitHubRepository {
    fn from(repository: RepositoryResponse) -> Self {
        let permissions = repository.permissions.unwrap_or_default();
        Self {
            id: repository.id,
            name: repository.name,
            full_name: repository.full_name,
            private: repository.private,
            can_read: permissions.pull,
            can_write: permissions.push || permissions.admin,
            default_branch: repository.default_branch,
            clone_url: repository.clone_url,
            html_url: repository.html_url,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct RepositoryPermissions {
    #[serde(default)]
    pull: bool,
    #[serde(default)]
    push: bool,
    #[serde(default)]
    admin: bool,
}

#[derive(Debug, Deserialize)]
struct BranchResponse {
    name: String,
}

fn validate_repository_component(label: &str, value: &str) -> Result<()> {
    if value.is_empty()
        || value == "."
        || value == ".."
        || value.contains('/')
        || value.contains('\\')
        || value.chars().any(char::is_whitespace)
    {
        bail!("invalid GitHub {label}");
    }
    Ok(())
}

fn parse_sso_url(header: &str) -> Option<String> {
    header.split(';').find_map(|part| {
        part.trim()
            .strip_prefix("url=")
            .map(str::trim)
            .filter(|url| url.starts_with("https://github.com/"))
            .map(str::to_string)
    })
}

fn now_ms() -> Result<u64> {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .context("system clock is before the Unix epoch")?
            .as_millis(),
    )
    .context("system clock value does not fit in u64")
}

#[cfg(test)]
#[path = "github_tests.rs"]
mod tests;
