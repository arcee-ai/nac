//! Signing in to the providers that authenticate with a browser login.
//!
//! A device login is two waits with a gap in between: the provider issues a
//! code immediately, and the tokens only arrive once the user has approved it
//! in a browser. An HTTP request cannot straddle that gap — it can be minutes,
//! and the caller is a page that may be reloaded — so the wait is parked in a
//! task here and the caller polls for its outcome.
//!
//! Nothing on disk changes until a login completes, so abandoning one leaves
//! whatever was already stored untouched.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex as StdMutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Path as AxumPath, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use nac_core::model::{
    begin_login, managed_auth_logout, managed_auth_snapshot, DeviceLoginPrompt, LoginStyle,
    ManagedAuthProvider, ManagedAuthSnapshot, MANAGED_AUTH_PROVIDERS,
};
use serde::Serialize;

use crate::{ApiError, SessionManager};

/// How long a finished login stays in the registry waiting to be collected.
/// Long enough for a reload to still pick up the result, short enough that an
/// abandoned one does not sit around.
const COMPLETED_RETENTION: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, Serialize)]
pub struct ManagedAuthStatusResponse {
    pub provider: String,
    /// The backend a session selects to use this login.
    pub backend: String,
    pub signed_in: bool,
    pub account: Option<String>,
    pub organization: Option<String>,
    pub base_url: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub path: String,
}

impl From<ManagedAuthSnapshot> for ManagedAuthStatusResponse {
    fn from(snapshot: ManagedAuthSnapshot) -> Self {
        Self {
            provider: snapshot.provider.as_str().to_string(),
            backend: snapshot.provider.backend().to_string(),
            signed_in: snapshot.signed_in,
            account: snapshot.account,
            organization: snapshot.organization,
            base_url: snapshot.base_url,
            expires_at_ms: snapshot.expires_at_ms,
            path: snapshot.path,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ManagedAuthListResponse {
    pub providers: Vec<ManagedAuthStatusResponse>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceLoginStartedResponse {
    /// Handle for polling this login; it names nothing on disk.
    pub login_id: String,
    pub provider: String,
    /// The page to open.
    pub verification_uri: String,
    /// Present only when the flow leaves something to read out: Codex's device
    /// flow expects it typed, Arcee's asks for it to be checked against the
    /// page, and the redirect flow has nothing to show at all.
    pub user_code: Option<String>,
    pub expires_in_secs: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum DeviceLoginStateResponse {
    /// The provider has not seen the user approve it yet.
    Pending,
    Complete {
        auth: ManagedAuthStatusResponse,
    },
    Failed {
        error: String,
    },
}

/// What the waiting task has managed to do so far.
enum LoginOutcome {
    Pending,
    Complete(Box<ManagedAuthSnapshot>),
    Failed(String),
}

struct PendingLogin {
    provider: ManagedAuthProvider,
    outcome: Arc<StdMutex<LoginOutcome>>,
    task: tokio::task::JoinHandle<()>,
    started: Instant,
    /// The provider stops accepting the code after this, so the task cannot
    /// outlive it by much and neither should the registry entry.
    lifetime: Duration,
}

impl PendingLogin {
    /// A login is collectable until it expires, and a finished one for a short
    /// while after, so a page that reloads mid-login still learns the result.
    fn expired(&self, now: Instant, finished: bool) -> bool {
        let budget = if finished {
            COMPLETED_RETENTION
        } else {
            self.lifetime
        };
        now.duration_since(self.started) > budget
    }
}

#[derive(Default)]
pub(crate) struct ManagedLoginRegistry {
    entries: StdMutex<HashMap<String, PendingLogin>>,
}

impl ManagedLoginRegistry {
    fn insert(&self, id: String, login: PendingLogin) {
        let mut entries = self.entries.lock().expect("managed login registry");
        entries.insert(id, login);
        // Abandoned logins are only noticed when another one starts; there is
        // no other moment that is guaranteed to come.
        let now = Instant::now();
        entries.retain(|_, entry| {
            let finished = !matches!(
                *entry.outcome.lock().expect("managed login outcome"),
                LoginOutcome::Pending
            );
            let keep = !entry.expired(now, finished);
            if !keep {
                entry.task.abort();
            }
            keep
        });
    }

    /// Reads the outcome, taking the entry once it has one to give.
    fn take_outcome(
        &self,
        id: &str,
        provider: ManagedAuthProvider,
    ) -> Result<DeviceLoginStateResponse, ApiError> {
        let mut entries = self.entries.lock().expect("managed login registry");
        let entry = entries.get(id).ok_or_else(|| ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("no login in progress with id '{id}'"),
        })?;
        if entry.provider != provider {
            return Err(ApiError {
                status: StatusCode::NOT_FOUND,
                message: format!("login '{id}' does not belong to provider '{provider}'"),
            });
        }

        let state = {
            let outcome = entry.outcome.lock().expect("managed login outcome");
            match &*outcome {
                LoginOutcome::Pending => None,
                LoginOutcome::Complete(snapshot) => Some(DeviceLoginStateResponse::Complete {
                    auth: snapshot.as_ref().clone().into(),
                }),
                LoginOutcome::Failed(error) => Some(DeviceLoginStateResponse::Failed {
                    error: error.clone(),
                }),
            }
        };

        match state {
            Some(state) => {
                entries.remove(id);
                Ok(state)
            }
            None => Ok(DeviceLoginStateResponse::Pending),
        }
    }

    fn cancel(&self, id: &str) -> bool {
        let mut entries = self.entries.lock().expect("managed login registry");
        match entries.remove(id) {
            Some(entry) => {
                entry.task.abort();
                true
            }
            None => false,
        }
    }
}

fn parse_provider(value: &str) -> Result<ManagedAuthProvider, ApiError> {
    ManagedAuthProvider::parse(value).ok_or_else(|| ApiError {
        status: StatusCode::NOT_FOUND,
        message: format!("'{value}' does not authenticate with a login"),
    })
}

impl SessionManager {
    pub fn managed_auth_statuses(&self) -> Result<ManagedAuthListResponse, ApiError> {
        let providers = MANAGED_AUTH_PROVIDERS
            .into_iter()
            .map(|provider| managed_auth_snapshot(provider).map(ManagedAuthStatusResponse::from))
            .collect::<anyhow::Result<Vec<_>>>()?;
        Ok(ManagedAuthListResponse { providers })
    }

    pub async fn start_managed_login(
        &self,
        provider: ManagedAuthProvider,
        style: LoginStyle,
    ) -> Result<DeviceLoginStartedResponse, ApiError> {
        let pending = begin_login(provider, style).await?;
        let DeviceLoginPrompt {
            verification_uri,
            user_code,
            expires_in_secs,
        } = pending.prompt();

        let outcome = Arc::new(StdMutex::new(LoginOutcome::Pending));
        let task = tokio::spawn({
            let outcome = Arc::clone(&outcome);
            async move {
                let result = pending.complete().await;
                let mut slot = outcome.lock().expect("managed login outcome");
                *slot = match result {
                    Ok(snapshot) => LoginOutcome::Complete(Box::new(snapshot)),
                    Err(error) => LoginOutcome::Failed(format!("{error}")),
                };
            }
        });

        let login_id = uuid::Uuid::new_v4().simple().to_string();
        self.inner.managed_logins.insert(
            login_id.clone(),
            PendingLogin {
                provider,
                outcome,
                task,
                started: Instant::now(),
                lifetime: Duration::from_secs(expires_in_secs),
            },
        );

        Ok(DeviceLoginStartedResponse {
            login_id,
            provider: provider.as_str().to_string(),
            verification_uri,
            user_code,
            expires_in_secs,
        })
    }

    pub fn poll_managed_login(
        &self,
        provider: ManagedAuthProvider,
        login_id: &str,
    ) -> Result<DeviceLoginStateResponse, ApiError> {
        self.inner.managed_logins.take_outcome(login_id, provider)
    }

    pub fn cancel_managed_login(&self, login_id: &str) -> bool {
        self.inner.managed_logins.cancel(login_id)
    }
}

pub(crate) async fn list_handler(
    State(manager): State<SessionManager>,
) -> Result<Json<ManagedAuthListResponse>, ApiError> {
    Ok(Json(manager.managed_auth_statuses()?))
}

/// Whether the browser that sent this request could reach a port on the machine
/// running the server.
///
/// The address the browser was pointed at answers this exactly: if it typed
/// `localhost`, then its loopback and ours are the same one. Anything else —
/// a LAN name, a forwarded port, an SSH tunnel — means a redirect to our
/// loopback address would land on a different computer.
fn browser_shares_this_machine(headers: &HeaderMap) -> bool {
    let Some(host) = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let hostname = host
        .rsplit_once(':')
        .map(|(name, _port)| name)
        .unwrap_or(host);
    matches!(
        hostname.trim_matches(|c| c == '[' || c == ']'),
        "localhost" | "127.0.0.1" | "::1"
    )
}

pub(crate) async fn start_login_handler(
    State(manager): State<SessionManager>,
    AxumPath(provider): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Json<DeviceLoginStartedResponse>, ApiError> {
    let provider = parse_provider(&provider)?;
    if !browser_shares_this_machine(&headers) {
        return Ok(Json(
            manager
                .start_managed_login(provider, LoginStyle::DeviceCode)
                .await?,
        ));
    }

    // The redirect flow asks nothing of the user, so it is worth preferring.
    // It can still fail before anyone has been sent anywhere — most likely
    // because another sign-in already holds the port — and the device flow
    // costs only a code to read, so it stands in rather than surfacing that.
    match manager
        .start_managed_login(provider, LoginStyle::Loopback)
        .await
    {
        Ok(started) => Ok(Json(started)),
        Err(_) => Ok(Json(
            manager
                .start_managed_login(provider, LoginStyle::DeviceCode)
                .await?,
        )),
    }
}

pub(crate) async fn poll_login_handler(
    State(manager): State<SessionManager>,
    AxumPath((provider, login_id)): AxumPath<(String, String)>,
) -> Result<Json<DeviceLoginStateResponse>, ApiError> {
    let provider = parse_provider(&provider)?;
    Ok(Json(manager.poll_managed_login(provider, &login_id)?))
}

pub(crate) async fn cancel_login_handler(
    State(manager): State<SessionManager>,
    AxumPath((provider, login_id)): AxumPath<(String, String)>,
) -> Result<StatusCode, ApiError> {
    parse_provider(&provider)?;
    if manager.cancel_managed_login(&login_id) {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError {
            status: StatusCode::NOT_FOUND,
            message: format!("no login in progress with id '{login_id}'"),
        })
    }
}

pub(crate) async fn logout_handler(
    AxumPath(provider): AxumPath<String>,
) -> Result<Json<ManagedAuthStatusResponse>, ApiError> {
    let provider = parse_provider(&provider)?;
    managed_auth_logout(provider)?;
    Ok(Json(managed_auth_snapshot(provider)?.into()))
}
