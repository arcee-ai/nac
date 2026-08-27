//! Permission policy for persistent direct sessions.
//!
//! Authorization is deliberately separate from execution confinement. An
//! allow decision authorizes the prepared invocation through its already
//! selected [`crate::sandbox::ExecutionBackend`]; it never changes backends.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex, Weak};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::sandbox::ExecutionBackend;
use crate::tools::kernel::PermissionResource;

mod broker;
mod command_classification;
mod evaluation;
mod hard_policy;
mod opaque_policy;
mod resource_binding;
mod resource_projection;
mod shell_parser;

use command_classification::*;
pub use evaluation::wildcard_match;
use hard_policy::*;
use opaque_policy::*;
pub(crate) use resource_binding::bind_authorized_shell_command;
use resource_binding::*;
pub(crate) use resource_projection::{
    canonicalize_authorization_resources, file_resources, shell_resources,
    unbounded_interactive_input,
};
use resource_projection::{lexical_normalize, path_contains_component};
use shell_parser::{canonical_command, command_grant_candidate, parse_shell, ParsedShell};

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const APPROVAL_SUBSCRIBER_POLL_INTERVAL: Duration = Duration::from_millis(25);
const DELEGATED_APPROVAL_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PermissionEffect {
    Allow,
    Ask,
    Deny,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PermissionRule {
    pub action: String,
    pub resource: String,
    pub effect: PermissionEffect,
}

impl PermissionRule {
    pub fn new(
        action: impl Into<String>,
        resource: impl Into<String>,
        effect: PermissionEffect,
    ) -> Self {
        Self {
            action: action.into(),
            resource: resource.into(),
            effect,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PermissionBackend {
    Local,
    Podman,
    Ssh,
}

impl PermissionBackend {
    pub(crate) fn from_execution_backend(backend: &ExecutionBackend) -> Self {
        match backend {
            ExecutionBackend::Local { .. } => Self::Local,
            ExecutionBackend::Sandbox(_) => Self::Podman,
            ExecutionBackend::Ssh(_) => Self::Ssh,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionDecision {
    pub effect: PermissionEffect,
    pub hard_denial: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PermissionPolicy {
    rules: Vec<PermissionRule>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PermissionRequestResource {
    pub action: String,
    pub resource: String,
    pub display: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_resource: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct PermissionRequest {
    pub id: String,
    pub session_id: String,
    pub call_id: Option<String>,
    pub tool: String,
    pub resources: Vec<PermissionRequestResource>,
    pub created_at_epoch_ms: u64,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub enum PermissionReply {
    Once,
    Always,
    Reject,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AuthorizationOutcome {
    Allowed,
    Denied(String),
}

struct PendingPermission {
    request: PermissionRequest,
    reply: tokio::sync::oneshot::Sender<PermissionReply>,
}

#[derive(Default)]
struct PermissionBrokerState {
    pending: HashMap<String, PendingPermission>,
}

struct PendingPermissionGuard {
    broker: Weak<PermissionBroker>,
    request_id: String,
}

struct PermissionWaiterLiveness {
    live: Arc<StdMutex<bool>>,
}

impl Drop for PermissionWaiterLiveness {
    fn drop(&mut self) {
        *self
            .live
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
    }
}

impl Drop for PendingPermissionGuard {
    fn drop(&mut self) {
        if let Some(broker) = self.broker.upgrade() {
            broker.dismiss_pending(
                &self.request_id,
                "the operation awaiting approval ended before a reply".to_string(),
            );
        }
    }
}

/// Per-direct-session approval coordinator. Pending prompts are intentionally
/// process-local; remembered grants are durable and revision-bound. A restart
/// drops the waiting call, after which ordinary interrupted-run recovery takes
/// over without pretending an approval survived.
pub struct PermissionBroker {
    policy: PermissionPolicy,
    store_path: PathBuf,
    session_id: String,
    backend: &'static str,
    session_config_version: i64,
    event_bus: StdMutex<Option<crate::events::SessionEventBus>>,
    state: StdMutex<PermissionBrokerState>,
}

/// Project one validated backend path into the action being performed plus an
/// external-directory guard when it lies outside the backend workspace.

#[cfg(test)]
#[path = "permissions_tests.rs"]
mod tests;
