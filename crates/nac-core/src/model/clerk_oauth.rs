//! Public-client device OAuth transport. Construction requires an explicitly
//! configured issuer, discovery document, client and trust origins; there are
//! no built-in deployment URLs or client registrations. Provider qualification
//! and resource authorization belong to the composing application. Tokens are
//! opaque here: only `access_token` is returned for resource use, never ID tokens.
//! Durable storage and refresh serialization remain the credential-store owner's
//! responsibility. Refresh is sent once; an uncertain rotation is never replayed.

use std::collections::BTreeSet;
use std::future::Future;
use std::time::{Duration, Instant};

use reqwest::{Client, Response, StatusCode};
use serde::Deserialize;
use url::Url;

const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
const MAX_RESPONSE_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Values must come from the accepted deployment/public-client contract, never
/// an inference URL, token claim, model input or untrusted discovery redirect.
pub(crate) struct ClerkOAuthConfig {
    pub(crate) issuer: String,
    pub(crate) discovery_url: String,
    pub(crate) client_id: String,
    pub(crate) scopes: Vec<String>,
    pub(crate) endpoint_origins: Vec<String>,
    pub(crate) verification_origins: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OAuthError {
    Configuration,
    Discovery,
    InvalidResponse,
    Unavailable,
    Denied,
    Expired,
    ReauthorizationRequired,
    Rejected,
}

impl std::fmt::Display for OAuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Configuration => "Clerk OAuth configuration is invalid; check the registered public client and trusted discovery settings",
            Self::Discovery => "Clerk discovery does not advertise the required trusted device and refresh capabilities",
            Self::InvalidResponse => "Clerk OAuth returned an invalid response",
            Self::Unavailable => "Clerk OAuth is unavailable; no credential exchange was replayed",
            Self::Denied => "Device authorization was denied; run login again to authorize",
            Self::Expired => "Device authorization expired; run login again",
            Self::ReauthorizationRequired => "Clerk authorization is no longer valid; run login again",
            Self::Rejected => "Clerk rejected the OAuth request; check client and scope configuration",
        })
    }
}

impl std::error::Error for OAuthError {}
type Result<T> = std::result::Result<T, OAuthError>;

/// Secret-bearing response, deliberately without Debug/Serialize. Resource
/// verification must establish org/client/scopes/policy independently.
pub(crate) struct OAuthTokens {
    pub(crate) access_token: String,
    pub(crate) refresh_token: Option<String>,
    pub(crate) expires_in_secs: u64,
    pub(crate) scopes: Vec<String>,
}

/// Only this prompt should reach presentation. Display both the manual URI and
/// user code even when a convenient prefilled URI is available.
pub(crate) struct DevicePrompt {
    pub(crate) verification_uri: String,
    pub(crate) verification_uri_complete: Option<String>,
    pub(crate) user_code: String,
    pub(crate) expires_in_secs: u64,
}

pub(crate) struct ClerkOAuthClient {
    client: Client,
    config: ClerkOAuthConfig,
    device_endpoint: Url,
    token_endpoint: Url,
}

/// A single-use, private device transaction. Dropping it cancels local polling.
pub(crate) struct DeviceLogin<'a> {
    client: &'a ClerkOAuthClient,
    device_code: String,
    prompt: DevicePrompt,
    interval: Duration,
    expires_at: Instant,
}

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    device_authorization_endpoint: String,
    token_endpoint: String,
    grant_types_supported: Vec<String>,
    token_endpoint_auth_methods_supported: Vec<String>,
}

#[derive(Deserialize)]
struct DeviceResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    expires_in: u64,
    scope: Option<String>,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: String,
}

impl ClerkOAuthClient {
    pub(crate) async fn discover(config: ClerkOAuthConfig) -> Result<Self> {
        validate_config(&config)?;
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(REQUEST_TIMEOUT)
            .build()
            .map_err(|_| OAuthError::Unavailable)?;
        let response = client
            .get(&config.discovery_url)
            .send()
            .await
            .map_err(|_| OAuthError::Unavailable)?;
        let (status, bytes) = read_response(response).await?;
        if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
            return Err(OAuthError::Unavailable);
        }
        if status != StatusCode::OK {
            return Err(OAuthError::Discovery);
        }
        let metadata: Discovery = decode(&bytes)?;
        if metadata.issuer != config.issuer
            || !metadata
                .grant_types_supported
                .iter()
                .any(|s| s == DEVICE_GRANT)
            || !metadata
                .grant_types_supported
                .iter()
                .any(|s| s == "refresh_token")
            || !metadata
                .token_endpoint_auth_methods_supported
                .iter()
                .any(|s| s == "none")
        {
            return Err(OAuthError::Discovery);
        }
        let device_endpoint = trusted_url(
            &metadata.device_authorization_endpoint,
            &config.endpoint_origins,
            false,
        )?;
        let token_endpoint =
            trusted_url(&metadata.token_endpoint, &config.endpoint_origins, false)?;
        Ok(Self {
            client,
            config,
            device_endpoint,
            token_endpoint,
        })
    }

    pub(crate) async fn begin(&self) -> Result<DeviceLogin<'_>> {
        let started = Instant::now();
        let scope = self.config.scopes.join(" ");
        let (status, bytes) = self
            .post(
                &self.device_endpoint,
                &[
                    ("client_id", self.config.client_id.as_str()),
                    ("scope", scope.as_str()),
                ],
                REQUEST_TIMEOUT,
            )
            .await?;
        if status != StatusCode::OK {
            return Err(terminal_error(status, &bytes));
        }
        let device: DeviceResponse = decode(&bytes)?;
        if !valid_secret(&device.device_code)
            || !valid_secret(&device.user_code)
            || device.expires_in == 0
            || device.interval == Some(0)
        {
            return Err(OAuthError::InvalidResponse);
        }
        trusted_url(
            &device.verification_uri,
            &self.config.verification_origins,
            false,
        )?;
        if let Some(uri) = &device.verification_uri_complete {
            trusted_url(uri, &self.config.verification_origins, true)?;
        }
        // A malicious response must not turn the private device code into a
        // user-facing link or user code (including percent-encoded URLs).
        for visible in [
            &device.verification_uri,
            device.verification_uri_complete.as_deref().unwrap_or(""),
            &device.user_code,
        ] {
            if visible.contains(&device.device_code)
                || url::form_urlencoded::parse(visible.as_bytes()).any(|(k, v)| {
                    k.contains(&device.device_code) || v.contains(&device.device_code)
                })
            {
                return Err(OAuthError::InvalidResponse);
            }
        }
        let expires_at = started
            .checked_add(Duration::from_secs(device.expires_in))
            .ok_or(OAuthError::InvalidResponse)?;
        if expires_at <= Instant::now() {
            return Err(OAuthError::Expired);
        }
        Ok(DeviceLogin {
            client: self,
            device_code: device.device_code,
            prompt: DevicePrompt {
                verification_uri: device.verification_uri,
                verification_uri_complete: device.verification_uri_complete,
                user_code: device.user_code,
                expires_in_secs: device.expires_in,
            },
            interval: Duration::from_secs(device.interval.unwrap_or(5)),
            expires_at,
        })
    }

    /// Caller holds the existing refresh lock and persists a rotated refresh
    /// token atomically before publishing the access token. No retry is made.
    pub(crate) async fn refresh(&self, refresh_token: &str) -> Result<OAuthTokens> {
        if !valid_secret(refresh_token) {
            return Err(OAuthError::ReauthorizationRequired);
        }
        let (status, bytes) = self
            .post(
                &self.token_endpoint,
                &[
                    ("client_id", self.config.client_id.as_str()),
                    ("grant_type", "refresh_token"),
                    ("refresh_token", refresh_token),
                ],
                REQUEST_TIMEOUT,
            )
            .await?;
        if status != StatusCode::OK {
            return Err(terminal_error(status, &bytes));
        }
        self.tokens(&bytes, false)
    }

    fn tokens(&self, bytes: &[u8], initial: bool) -> Result<OAuthTokens> {
        let token: TokenResponse = decode(bytes)?;
        if !valid_secret(&token.access_token)
            || !token.token_type.eq_ignore_ascii_case("Bearer")
            || token.expires_in == 0
            || token
                .refresh_token
                .as_deref()
                .is_some_and(|s| !valid_secret(s))
            || (initial && token.refresh_token.is_none())
        {
            return Err(OAuthError::InvalidResponse);
        }
        let scopes = match token.scope {
            Some(scope) => scope.split(' ').map(str::to_owned).collect(),
            None => self.config.scopes.clone(),
        };
        if scope_set(&scopes).map_err(|_| OAuthError::InvalidResponse)?
            != scope_set(&self.config.scopes)?
        {
            return Err(OAuthError::Rejected);
        }
        Ok(OAuthTokens {
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_in_secs: token.expires_in,
            scopes,
        })
    }

    async fn post(
        &self,
        url: &Url,
        form: &[(&str, &str)],
        timeout: Duration,
    ) -> Result<(StatusCode, Vec<u8>)> {
        let response = self
            .client
            .post(url.clone())
            .timeout(timeout)
            .form(form)
            .send()
            .await
            .map_err(|_| OAuthError::Unavailable)?;
        read_response(response).await
    }
}

impl DeviceLogin<'_> {
    pub(crate) fn prompt(&self) -> &DevicePrompt {
        &self.prompt
    }

    pub(crate) async fn finish(self) -> Result<OAuthTokens> {
        let started = Instant::now();
        self.poll_with(|| started.elapsed(), tokio::time::sleep)
            .await
    }

    async fn poll_with<Now, Wait, WaitFuture>(self, now: Now, wait: Wait) -> Result<OAuthTokens>
    where
        Now: Fn() -> Duration,
        Wait: Fn(Duration) -> WaitFuture,
        WaitFuture: Future<Output = ()>,
    {
        let lifetime = self.expires_at.saturating_duration_since(Instant::now());
        let mut interval = self.interval;
        loop {
            let remaining = lifetime.saturating_sub(now());
            if interval >= remaining {
                return Err(OAuthError::Expired);
            }
            wait(interval).await;
            let remaining = lifetime.saturating_sub(now());
            if remaining.is_zero() {
                return Err(OAuthError::Expired);
            }
            let (status, bytes) = self
                .client
                .post(
                    &self.client.token_endpoint,
                    &[
                        ("client_id", self.client.config.client_id.as_str()),
                        ("grant_type", DEVICE_GRANT),
                        ("device_code", self.device_code.as_str()),
                    ],
                    remaining.min(REQUEST_TIMEOUT),
                )
                .await?;
            if now() >= lifetime {
                return Err(OAuthError::Expired);
            }
            if status == StatusCode::OK {
                return self.client.tokens(&bytes, true);
            }
            if status == StatusCode::BAD_REQUEST {
                let error: ErrorResponse = decode(&bytes)?;
                match error.error.as_str() {
                    "authorization_pending" => continue,
                    "slow_down" => {
                        interval = interval
                            .checked_add(Duration::from_secs(5))
                            .ok_or(OAuthError::Expired)?;
                        continue;
                    }
                    _ => {}
                }
            }
            return Err(terminal_error(status, &bytes));
        }
    }
}

fn validate_config(config: &ClerkOAuthConfig) -> Result<()> {
    let issuer = secure_url(&config.issuer, false)?;
    let discovery = secure_url(&config.discovery_url, false)?;
    if issuer.origin() != discovery.origin() || !valid_secret(&config.client_id) {
        return Err(OAuthError::Configuration);
    }
    scope_set(&config.scopes)?;
    for origins in [&config.endpoint_origins, &config.verification_origins] {
        if origins.is_empty() {
            return Err(OAuthError::Configuration);
        }
        for origin in origins {
            let url = secure_url(origin, false)?;
            if url.path() != "/" {
                return Err(OAuthError::Configuration);
            }
        }
    }
    Ok(())
}

fn scope_set(scopes: &[String]) -> Result<BTreeSet<&str>> {
    if scopes.is_empty()
        || scopes.iter().any(|s| {
            s.is_empty()
                || !s
                    .bytes()
                    .all(|b| b == 0x21 || (0x23..=0x5b).contains(&b) || (0x5d..=0x7e).contains(&b))
        })
    {
        return Err(OAuthError::Configuration);
    }
    let set: BTreeSet<_> = scopes.iter().map(String::as_str).collect();
    if set.len() != scopes.len() {
        return Err(OAuthError::Configuration);
    }
    Ok(set)
}

fn secure_url(value: &str, allow_query: bool) -> Result<Url> {
    let url = Url::parse(value).map_err(|_| OAuthError::Configuration)?;
    let secure = url.scheme() == "https";
    // HTTP is available only to isolated loopback tests, never runtime config.
    #[cfg(test)]
    let secure = secure || (url.scheme() == "http" && url.host_str() == Some("127.0.0.1"));
    if !secure
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || (!allow_query && url.query().is_some())
    {
        return Err(OAuthError::Configuration);
    }
    Ok(url)
}

fn trusted_url(value: &str, origins: &[String], allow_query: bool) -> Result<Url> {
    let url = secure_url(value, allow_query)?;
    if !origins
        .iter()
        .any(|origin| Url::parse(origin).is_ok_and(|trusted| trusted.origin() == url.origin()))
    {
        return Err(OAuthError::Discovery);
    }
    Ok(url)
}

fn valid_secret(value: &str) -> bool {
    !value.is_empty()
        && !value.chars().any(char::is_whitespace)
        && !value.chars().any(char::is_control)
}
fn decode<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T> {
    serde_json::from_slice(bytes).map_err(|_| OAuthError::InvalidResponse)
}

async fn read_response(mut response: Response) -> Result<(StatusCode, Vec<u8>)> {
    let status = response.status();
    if response
        .content_length()
        .is_some_and(|n| n > MAX_RESPONSE_BYTES as u64)
    {
        return Err(OAuthError::InvalidResponse);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| OAuthError::Unavailable)?
    {
        if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
            return Err(OAuthError::InvalidResponse);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok((status, bytes))
}

fn terminal_error(status: StatusCode, bytes: &[u8]) -> OAuthError {
    if status.is_server_error() || status == StatusCode::TOO_MANY_REQUESTS {
        return OAuthError::Unavailable;
    }
    let Ok(error) = decode::<ErrorResponse>(bytes) else {
        return OAuthError::Rejected;
    };
    match error.error.as_str() {
        "access_denied" => OAuthError::Denied,
        "expired_token" => OAuthError::Expired,
        "invalid_grant" => OAuthError::ReauthorizationRequired,
        _ => OAuthError::Rejected,
    }
}

#[cfg(test)]
#[path = "clerk_oauth_tests.rs"]
mod tests;

#[cfg(all(test, unix))]
#[path = "clerk_oauth_probe_tests.rs"]
mod provider_probes;
