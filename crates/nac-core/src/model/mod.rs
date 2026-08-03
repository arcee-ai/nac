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

mod anthropic;
mod arcee;
mod auth_store;
mod backend;
mod catalog;
mod chat;
mod chatgpt_codex;
mod client;
mod history;
mod requests;
mod responses;
#[cfg(test)]
pub(crate) mod test_http;
mod types;

use arcee::{arcee_auth_login, arcee_auth_logout, arcee_auth_status};
pub use backend::{validate_backend_api_key_env, validate_model_reasoning_effort};
pub use catalog::{api_listing, spawn_overlay_refresh, ModelListing};
pub(crate) use catalog::{Compat, CompletionsThinkingFormat, ModelMetadata, ThinkingLevelMap};
use chatgpt_codex::{codex_auth_login, codex_auth_logout, codex_auth_status};
pub use client::validate_model_configuration;
pub(crate) use client::ModelClient;
pub use types::{
    managed_backend_base_url, resolve_model_base_url, EffectiveModelSettings,
    ARCEE_AUTH_CANONICAL_BASE_URL, CHATGPT_CODEX_CANONICAL_BASE_URL,
};
pub(crate) use types::{calculate_cost, AssistantTurn, ModelTurnResponse, TokenCostMicros, TokenUsage};
pub use types::{BackendKind, ReasoningEffort};

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

use anthropic::*;
use backend::*;
use chat::*;
use history::*;
use requests::*;
use responses::*;

#[cfg(test)]
mod tests;
