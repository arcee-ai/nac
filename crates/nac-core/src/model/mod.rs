use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;
use url::Url;

use crate::types::{FunctionCall, Message, ModelOrigin, ToolCall, ToolDefinition};

fn backoff_duration(attempt: usize) -> Duration {
    let base_ms = 200u64;
    let delay_ms = std::cmp::min(base_ms.saturating_mul(1 << attempt), 30_000);
    // rand::random::<f64>() samples [0, 1), so the jitter multiplier spans [0.9, 1.1).
    let jitter = 0.9 + rand::random::<f64>() * 0.2;
    Duration::from_millis((delay_ms as f64 * jitter) as u64)
}

fn retryable_http_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 409 | 429) || status.is_server_error()
}

fn retry_after_delay(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| Duration::from_secs(seconds.min(60)))
}

mod anthropic;
mod anthropic_stream;
mod api_key_store;
mod arcee;
mod auth_store;
mod backend;
mod catalog;
mod chat;
mod chat_stream;
mod chatgpt_codex;
mod client;
mod history;
mod providers;
mod pseudo_tool_calls;
mod redact;
mod requests;
mod responses;
mod responses_stream;
mod sse;
mod stream;
#[cfg(test)]
pub(crate) mod test_http;
mod types;

pub use api_key_store::{list_stored_api_keys, remove_api_key, store_api_key, StoredApiKeySummary};
use arcee::{arcee_auth_login, arcee_auth_logout, arcee_auth_status};
pub use backend::{
    validate_backend_api_key_env, validate_caller_supplied_base_url,
    validate_model_reasoning_effort,
};
pub(crate) use catalog::resolve as resolve_model_metadata;
pub use catalog::{
    api_listing, provider_for_model, spawn_anthropic_model_refresh, spawn_arcee_model_refresh,
    spawn_overlay_refresh, ModelListing,
};
pub(crate) use catalog::{Compat, CompletionsThinkingFormat, ModelMetadata, ThinkingLevelMap};
pub use providers::{
    list_managed_provider_models, list_provider_models, provider_default_base_url,
    provider_uses_api_key, ProviderModel,
};
pub(crate) use redact::{redact_credentials, redact_json_body};

/// Resolve the API key a backend would use at run time.
///
/// Reads the environment first and the credential store second, exactly as a
/// launched session does, so validating a saved configuration exercises the
/// same lookup the session will.
pub fn resolve_backend_api_key(backend: BackendKind, api_key_env: Option<&str>) -> Result<String> {
    backend::api_key_for_backend(backend, api_key_env)
}
use chatgpt_codex::{codex_auth_login, codex_auth_logout, codex_auth_status};
pub use client::validate_model_configuration;
pub(crate) use client::ModelClient;
pub(crate) use stream::{CoalescedDeltas, DeltaSink, ModelStreamDelta};
pub(crate) use types::{
    calculate_cost, AssistantTurn, ModelTurnResponse, TokenCostMicros, TokenUsage,
};
pub use types::{
    managed_backend_base_url, resolve_model_base_url, EffectiveModelSettings,
    ARCEE_AUTH_CANONICAL_BASE_URL, CHATGPT_CODEX_CANONICAL_BASE_URL,
};
pub use types::{BackendKind, DispatchWeight, ReasoningEffort};

/// Identifies model setup failures caused by a caller-controlled configuration.
///
/// The server uses this typed boundary to return HTTP 400 without relying on
/// message matching. The inner message remains the user-facing diagnostic.
#[derive(Debug)]
pub struct ModelConfigurationError {
    message: String,
}

impl ModelConfigurationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ModelConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ModelConfigurationError {}

fn model_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(ModelConfigurationError::new(message))
}

fn classify_model_configuration_error(error: anyhow::Error) -> anyhow::Error {
    if error.downcast_ref::<ModelConfigurationError>().is_some() {
        error
    } else {
        model_configuration_error(error.to_string())
    }
}

fn classify_stored_arcee_auth_error(error: anyhow::Error) -> anyhow::Error {
    if error
        .downcast_ref::<arcee::StoredArceeAuthConfigurationError>()
        .is_some()
        || error
            .downcast_ref::<auth_store::UnsafeCredentialPermissionsError>()
            .is_some()
    {
        model_configuration_error(error.to_string())
    } else {
        error.context("failed to load stored Arcee credentials")
    }
}

fn classify_stored_codex_auth_error(error: anyhow::Error) -> anyhow::Error {
    if error
        .downcast_ref::<chatgpt_codex::StoredCodexAuthConfigurationError>()
        .is_some()
        || error
            .downcast_ref::<auth_store::UnsafeCredentialPermissionsError>()
            .is_some()
    {
        model_configuration_error(error.to_string())
    } else {
        error.context("failed to load stored Codex credentials")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexAuthAction {
    Login,
    Status,
    Logout,
}

pub async fn run_codex_auth_action(action: CodexAuthAction) -> Result<()> {
    match action {
        CodexAuthAction::Login => codex_auth_login().await,
        CodexAuthAction::Status => codex_auth_status(),
        CodexAuthAction::Logout => codex_auth_logout(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArceeAuthAction {
    Login,
    Status,
    Logout,
}

pub async fn run_arcee_auth_action(action: ArceeAuthAction) -> Result<()> {
    match action {
        ArceeAuthAction::Login => arcee_auth_login().await,
        ArceeAuthAction::Status => arcee_auth_status(),
        ArceeAuthAction::Logout => arcee_auth_logout(),
    }
}

/// A provider that authenticates from a browser login rather than an API key.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManagedAuthProvider {
    Arcee,
    Codex,
}

/// Every provider a login can be performed for, in the order they are listed.
pub const MANAGED_AUTH_PROVIDERS: [ManagedAuthProvider; 2] =
    [ManagedAuthProvider::Arcee, ManagedAuthProvider::Codex];

impl ManagedAuthProvider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Arcee => "arcee",
            Self::Codex => "codex",
        }
    }

    /// Accepts the short name and the backend it belongs to, so a caller
    /// holding either spelling does not have to translate first.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "arcee" | "arcee-auth" => Some(Self::Arcee),
            "codex" | "chatgpt-codex-responses" => Some(Self::Codex),
            _ => None,
        }
    }

    pub fn backend(self) -> BackendKind {
        match self {
            Self::Arcee => BackendKind::ArceeAuth,
            Self::Codex => BackendKind::ChatGptCodexResponses,
        }
    }

    /// The login a backend authenticates through, or `None` when it uses a key.
    pub fn for_backend(backend: BackendKind) -> Option<Self> {
        match backend {
            BackendKind::ArceeAuth => Some(Self::Arcee),
            BackendKind::ChatGptCodexResponses => Some(Self::Codex),
            _ => None,
        }
    }
}

impl std::fmt::Display for ManagedAuthProvider {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// What the user has to do in a browser before a login can finish.
#[derive(Debug, Clone)]
pub struct DeviceLoginPrompt {
    /// The page to open.
    pub verification_uri: String,
    /// A code to confirm against what the page shows, when the flow has one.
    /// The loopback flow has nothing to confirm, and Arcee builds its code into
    /// the URL, so only Codex's device flow leaves anything to read out.
    pub user_code: Option<String>,
    /// How long the provider will keep accepting this authorization.
    pub expires_in_secs: u64,
}

/// How the user is sent to the provider and how the answer gets back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginStyle {
    /// The provider redirects the browser to a port this process listens on.
    /// Nothing has to be typed, but the browser has to be able to reach that
    /// port, which is only true when it runs on the same machine.
    Loopback,
    /// The provider hands over a code and waits for it to be approved. Slower
    /// and more to read, but it works no matter where the browser is.
    DeviceCode,
}

/// The state of what a provider has stored for us, whether or not anyone is
/// signed in. The credential path is always reported so a failure has somewhere
/// to point.
#[derive(Debug, Clone)]
pub struct ManagedAuthSnapshot {
    pub provider: ManagedAuthProvider,
    pub signed_in: bool,
    /// Workspace name for Arcee, ChatGPT account id for Codex.
    pub account: Option<String>,
    pub organization: Option<String>,
    pub base_url: Option<String>,
    pub expires_at_ms: Option<u64>,
    pub path: String,
}

/// A login the provider has issued a code for, waiting on the user's browser.
///
/// Splitting the wait from the start is what lets a caller show the code while
/// the authorization is still outstanding; the CLI does the two back to back,
/// and the HTTP API keeps the pending half alive between requests.
pub struct PendingDeviceLogin {
    inner: PendingDeviceLoginKind,
}

enum PendingDeviceLoginKind {
    Arcee(arcee::ArceeDeviceLogin),
    Codex(chatgpt_codex::CodexDeviceLogin),
    CodexLoopback(chatgpt_codex::CodexLoopbackLogin),
}

impl PendingDeviceLogin {
    pub fn provider(&self) -> ManagedAuthProvider {
        match &self.inner {
            PendingDeviceLoginKind::Arcee(_) => ManagedAuthProvider::Arcee,
            PendingDeviceLoginKind::Codex(_) | PendingDeviceLoginKind::CodexLoopback(_) => {
                ManagedAuthProvider::Codex
            }
        }
    }

    pub fn prompt(&self) -> DeviceLoginPrompt {
        match &self.inner {
            PendingDeviceLoginKind::Arcee(login) => login.prompt(),
            PendingDeviceLoginKind::Codex(login) => login.prompt(),
            PendingDeviceLoginKind::CodexLoopback(login) => login.prompt(),
        }
    }

    /// Waits for the user to authorize, then stores the credential. Runs for as
    /// long as the authorization is valid, so callers that cannot wait that
    /// long are expected to drop the future instead.
    pub async fn complete(self) -> Result<ManagedAuthSnapshot> {
        match self.inner {
            PendingDeviceLoginKind::Arcee(login) => login.complete().await,
            PendingDeviceLoginKind::Codex(login) => login.complete().await,
            PendingDeviceLoginKind::CodexLoopback(login) => login.complete().await,
        }
    }
}

/// Starts a login in whichever style the caller can support.
///
/// Nothing is stored until the returned login completes, so abandoning it
/// leaves the existing credential alone.
///
/// `style` is a preference rather than an instruction: Arcee only offers a
/// device flow, and it needs nothing typed anyway because its verification URL
/// carries the code. A loopback attempt that cannot claim its port fails here,
/// before the user has been sent anywhere, which is what lets a caller fall
/// back to the device flow without anyone noticing.
pub async fn begin_login(
    provider: ManagedAuthProvider,
    style: LoginStyle,
) -> Result<PendingDeviceLogin> {
    let inner = match (provider, style) {
        (ManagedAuthProvider::Arcee, _) => {
            PendingDeviceLoginKind::Arcee(arcee::begin_arcee_device_login().await?)
        }
        (ManagedAuthProvider::Codex, LoginStyle::Loopback) => {
            PendingDeviceLoginKind::CodexLoopback(
                chatgpt_codex::begin_codex_loopback_login().await?,
            )
        }
        (ManagedAuthProvider::Codex, LoginStyle::DeviceCode) => {
            PendingDeviceLoginKind::Codex(chatgpt_codex::begin_codex_device_login().await?)
        }
    };
    Ok(PendingDeviceLogin { inner })
}

pub fn managed_auth_snapshot(provider: ManagedAuthProvider) -> Result<ManagedAuthSnapshot> {
    match provider {
        ManagedAuthProvider::Arcee => arcee::arcee_auth_snapshot(),
        ManagedAuthProvider::Codex => chatgpt_codex::codex_auth_snapshot(),
    }
}

/// Removes the stored credential, reporting whether there was one to remove.
pub fn managed_auth_logout(provider: ManagedAuthProvider) -> Result<bool> {
    match provider {
        ManagedAuthProvider::Arcee => arcee::arcee_auth_remove(),
        ManagedAuthProvider::Codex => chatgpt_codex::codex_auth_remove(),
    }
}

use anthropic::*;
use backend::*;
use chat::*;
use history::*;
use requests::*;
use responses::*;

#[cfg(test)]
mod tests;
