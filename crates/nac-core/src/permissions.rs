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

impl PermissionBroker {
    pub(crate) fn new(
        store_path: PathBuf,
        session_id: String,
        backend: PermissionBackend,
        session_config_version: i64,
        configured_rules: impl IntoIterator<Item = PermissionRule>,
    ) -> Self {
        Self {
            policy: PermissionPolicy::for_backend(backend, configured_rules),
            store_path,
            session_id,
            backend: match backend {
                PermissionBackend::Local => "local",
                PermissionBackend::Podman => "podman",
                PermissionBackend::Ssh => "ssh",
            },
            session_config_version,
            event_bus: StdMutex::new(None),
            state: StdMutex::new(PermissionBrokerState::default()),
        }
    }

    pub(crate) fn attach_event_bus(&self, bus: crate::events::SessionEventBus) {
        *self
            .event_bus
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(bus);
    }

    pub fn pending(&self) -> Vec<PermissionRequest> {
        let mut requests = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pending
            .values()
            .map(|pending| pending.request.clone())
            .collect::<Vec<_>>();
        requests.sort_by(|left, right| {
            left.created_at_epoch_ms
                .cmp(&right.created_at_epoch_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        requests
    }

    pub fn grants(&self) -> anyhow::Result<Vec<crate::store::PermissionGrantRecord>> {
        crate::store::list_permission_grants(&self.store_path, &self.session_id)
    }

    pub fn delete_grant(&self, grant_id: &str) -> anyhow::Result<()> {
        crate::store::delete_permission_grant(&self.store_path, &self.session_id, grant_id)
    }

    pub fn reply(&self, request_id: &str, reply: PermissionReply) -> anyhow::Result<()> {
        let pending = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pending
            .remove(request_id)
            .ok_or_else(|| anyhow::anyhow!("permission request '{request_id}' was not found"))?;
        pending.reply.send(reply).map_err(|_| {
            anyhow::anyhow!("permission request '{request_id}' is no longer active")
        })?;
        self.emit(crate::events::SessionEvent::PermissionReplied {
            request_id: request_id.to_string(),
            reply,
        });
        Ok(())
    }

    pub(crate) async fn authorize(
        self: &Arc<Self>,
        tool: &str,
        resources: &[PermissionResource],
        context: &crate::tools::kernel::ToolCallContext,
        cancellation: &crate::tools::ThreadCancellation,
    ) -> AuthorizationOutcome {
        if resources.is_empty() {
            return AuthorizationOutcome::Denied(format!(
                "tool '{tool}' did not declare canonical permission resources"
            ));
        }
        let remembered = match crate::store::list_effective_permission_grants(
            &self.store_path,
            &self.session_id,
            self.backend,
            self.session_config_version,
        ) {
            Ok(grants) => grants
                .into_iter()
                .map(|grant| {
                    PermissionRule::new(grant.action, grant.resource, PermissionEffect::Allow)
                })
                .collect::<Vec<_>>(),
            Err(error) => {
                return AuthorizationOutcome::Denied(format!(
                    "permission grants could not be read: {error}"
                ));
            }
        };
        let decision = self.policy.evaluate(resources, &remembered);
        match decision.effect {
            PermissionEffect::Allow => {
                return if cancellation.is_cancelled() {
                    AuthorizationOutcome::Denied(
                        "run was cancelled before authorization completed".to_string(),
                    )
                } else {
                    AuthorizationOutcome::Allowed
                };
            }
            PermissionEffect::Deny => {
                return AuthorizationOutcome::Denied(
                    decision
                        .hard_denial
                        .unwrap_or_else(|| format!("configured permission rules deny {tool}")),
                );
            }
            PermissionEffect::Ask => {}
        }

        if cancellation.is_cancelled() {
            return AuthorizationOutcome::Denied("run was cancelled before approval".to_string());
        }
        let interactive = self
            .event_bus
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(crate::events::SessionEventBus::has_interactive_subscribers);
        let delegated_child =
            match crate::store::load_traditional_child(&self.store_path, &self.session_id) {
                Ok(child) => child.is_some(),
                Err(error) => {
                    return AuthorizationOutcome::Denied(format!(
                        "delegated ownership could not be checked before approval: {error}"
                    ));
                }
            };
        if !interactive && !delegated_child {
            return AuthorizationOutcome::Denied(
                "approval is required, but no interactive session client is connected; the operation was not executed"
                    .to_string(),
            );
        }

        let request = PermissionRequest {
            id: uuid::Uuid::new_v4().to_string(),
            session_id: self.session_id.clone(),
            call_id: context.call_id.clone(),
            tool: tool.to_string(),
            resources: resources
                .iter()
                .map(|resource| PermissionRequestResource {
                    action: resource.action.clone(),
                    resource: resource.resource.clone(),
                    display: resource.display.clone(),
                    save_resource: resource.save_resource.clone(),
                })
                .collect(),
            created_at_epoch_ms: epoch_millis_now(),
        };
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pending
            .insert(
                request.id.clone(),
                PendingPermission {
                    request: request.clone(),
                    reply: sender,
                },
            );
        let _pending_guard = PendingPermissionGuard {
            broker: Arc::downgrade(self),
            request_id: request.id.clone(),
        };
        let waiter_live = Arc::new(StdMutex::new(true));
        let _waiter_liveness = PermissionWaiterLiveness {
            live: Arc::clone(&waiter_live),
        };
        self.emit(crate::events::SessionEvent::PermissionAsked {
            request: request.clone(),
        });

        tokio::pin!(receiver);
        let result = tokio::select! {
            biased;
            reply = &mut receiver => self.reply_outcome(reply, &request, &waiter_live).await,
            () = cancellation.cancelled() => {
                let reason = "run was cancelled while awaiting approval".to_string();
                if self.dismiss_pending(&request.id, reason.clone()) {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live).await
                }
            },
            reason = self.interactive_subscriber_unavailable(interactive) => {
                if self.dismiss_pending(&request.id, reason.clone()) {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live).await
                }
            },
            () = tokio::time::sleep(APPROVAL_TIMEOUT) => {
                let reason = "permission request timed out without a reply".to_string();
                if self.dismiss_pending(&request.id, reason.clone()) {
                    AuthorizationOutcome::Denied(reason)
                } else {
                    self.reply_outcome(receiver.await, &request, &waiter_live).await
                }
            },
        };
        // A reply owns the request by removing it and successfully delivering
        // to this exact waiter. Durable grants are written only after receipt,
        // so a dropped receiver can never leave authority behind.
        result
    }

    async fn reply_outcome(
        &self,
        reply: Result<PermissionReply, tokio::sync::oneshot::error::RecvError>,
        request: &PermissionRequest,
        waiter_live: &Arc<StdMutex<bool>>,
    ) -> AuthorizationOutcome {
        match reply {
            Ok(PermissionReply::Once) => AuthorizationOutcome::Allowed,
            Ok(PermissionReply::Always) => {
                let grants = request
                    .resources
                    .iter()
                    .filter_map(|resource| {
                        resource
                            .save_resource
                            .as_ref()
                            .map(|save| (resource.action.clone(), save.clone()))
                    })
                    .collect::<Vec<_>>();
                if grants.is_empty() {
                    AuthorizationOutcome::Allowed
                } else {
                    let store_path = self.store_path.clone();
                    let session_id = self.session_id.clone();
                    let backend = self.backend;
                    let session_config_version = self.session_config_version;
                    let waiter_live = Arc::clone(waiter_live);
                    match tokio::task::spawn_blocking(move || {
                        crate::store::insert_permission_grant_set_if_waiter_live(
                            &store_path,
                            &session_id,
                            &grants,
                            backend,
                            session_config_version,
                            &waiter_live,
                        )
                    })
                    .await
                    {
                        Ok(Ok(Some(_))) => AuthorizationOutcome::Allowed,
                        Ok(Ok(None)) => AuthorizationOutcome::Denied(
                            "the permission waiter ended before the approved grant could be saved; the operation was not executed"
                                .to_string(),
                        ),
                        Ok(Err(error)) => AuthorizationOutcome::Denied(format!(
                            "the approved permission grant could not be saved; the operation was not executed: {error}"
                        )),
                        Err(error) => AuthorizationOutcome::Denied(format!(
                            "the approved permission grant task failed; the operation was not executed: {error}"
                        )),
                    }
                }
            }
            Ok(PermissionReply::Reject) => AuthorizationOutcome::Denied(
                "the user rejected this permission request".to_string(),
            ),
            Err(_) => AuthorizationOutcome::Denied(
                "the permission request ended before a reply".to_string(),
            ),
        }
    }

    fn dismiss_pending(&self, request_id: &str, reason: String) -> bool {
        let dismissed = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pending
            .remove(request_id)
            .is_some();
        if dismissed {
            self.emit(crate::events::SessionEvent::PermissionDismissed {
                request_id: request_id.to_string(),
                reason,
            });
        }
        dismissed
    }

    async fn interactive_subscriber_lost(&self) {
        loop {
            tokio::time::sleep(APPROVAL_SUBSCRIBER_POLL_INTERVAL).await;
            let interactive = self
                .event_bus
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref()
                .is_some_and(crate::events::SessionEventBus::has_interactive_subscribers);
            if !interactive {
                return;
            }
        }
    }

    async fn interactive_subscriber_unavailable(&self, initially_connected: bool) -> String {
        if !initially_connected {
            let connected = tokio::time::timeout(DELEGATED_APPROVAL_CONNECT_TIMEOUT, async {
                loop {
                    tokio::time::sleep(APPROVAL_SUBSCRIBER_POLL_INTERVAL).await;
                    let interactive = self
                        .event_bus
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .as_ref()
                        .is_some_and(crate::events::SessionEventBus::has_interactive_subscribers);
                    if interactive {
                        return;
                    }
                }
            })
            .await;
            if connected.is_err() {
                return "approval is required, but no interactive parent session client connected; the operation was not executed"
                    .to_string();
            }
        }
        self.interactive_subscriber_lost().await;
        "the interactive session client disconnected while approval was pending".to_string()
    }

    fn emit(&self, event: crate::events::SessionEvent) {
        if let Some(bus) = self
            .event_bus
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
        {
            bus.emit(event);
        }
    }
}

fn epoch_millis_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

impl PermissionPolicy {
    pub fn for_backend(
        backend: PermissionBackend,
        configured_rules: impl IntoIterator<Item = PermissionRule>,
    ) -> Self {
        let mut rules = backend_defaults(backend);
        rules.extend(configured_rules);
        Self { rules }
    }

    pub fn rules(&self) -> &[PermissionRule] {
        &self.rules
    }

    /// OpenCode-shaped last-match evaluation with deny-before-grant
    /// aggregation. Remembered allows may satisfy an `ask`, but never override
    /// a configured denial or a native hard denial.
    pub fn evaluate(
        &self,
        resources: &[PermissionResource],
        remembered_allows: &[PermissionRule],
    ) -> PermissionDecision {
        if let Some(reason) = resources
            .iter()
            .find_map(|resource| resource.hard_denial.clone())
        {
            return PermissionDecision {
                effect: PermissionEffect::Deny,
                hard_denial: Some(reason),
            };
        }

        if resources.iter().any(|resource| {
            evaluate_one(&resource.action, &resource.resource, &self.rules)
                == PermissionEffect::Deny
        }) {
            return PermissionDecision {
                effect: PermissionEffect::Deny,
                hard_denial: None,
            };
        }

        let effect = resources
            .iter()
            .map(|resource| {
                evaluate_one_with_grants(
                    &resource.action,
                    &resource.resource,
                    &self.rules,
                    remembered_allows,
                )
            })
            .fold(PermissionEffect::Allow, strictest);
        PermissionDecision {
            effect,
            hard_denial: None,
        }
    }

    pub fn wholly_denies(&self, action: &str) -> bool {
        self.rules
            .iter()
            .rev()
            .find(|rule| wildcard_match(&rule.action, action))
            .is_some_and(|rule| rule.resource == "*" && rule.effect == PermissionEffect::Deny)
    }
}

fn evaluate_one_with_grants(
    action: &str,
    resource: &str,
    rules: &[PermissionRule],
    remembered_allows: &[PermissionRule],
) -> PermissionEffect {
    rules
        .iter()
        .chain(remembered_allows.iter())
        .rev()
        .find(|rule| {
            wildcard_match(&rule.action, action) && wildcard_match(&rule.resource, resource)
        })
        .map_or(PermissionEffect::Ask, |rule| rule.effect)
}

fn evaluate_one(action: &str, resource: &str, rules: &[PermissionRule]) -> PermissionEffect {
    rules
        .iter()
        .rev()
        .find(|rule| {
            wildcard_match(&rule.action, action) && wildcard_match(&rule.resource, resource)
        })
        .map_or(PermissionEffect::Ask, |rule| rule.effect)
}

fn strictest(left: PermissionEffect, right: PermissionEffect) -> PermissionEffect {
    use PermissionEffect::{Allow, Ask, Deny};
    match (left, right) {
        (Deny, _) | (_, Deny) => Deny,
        (Ask, _) | (_, Ask) => Ask,
        (Allow, Allow) => Allow,
    }
}

fn backend_defaults(backend: PermissionBackend) -> Vec<PermissionRule> {
    use PermissionEffect::{Allow, Ask};
    let mut rules = vec![
        PermissionRule::new("*", "*", Allow),
        PermissionRule::new("external_directory", "*", Ask),
        PermissionRule::new("execute_opaque", "*", Ask),
        PermissionRule::new("execute_broad", "*", Ask),
        PermissionRule::new("read", "*.env", Ask),
        PermissionRule::new("read", "*.env.*", Ask),
        PermissionRule::new("read", "*.env.example", Allow),
    ];
    if matches!(backend, PermissionBackend::Local | PermissionBackend::Ssh) {
        rules.push(PermissionRule::new("execute", "*", Ask));
        for resource in [
            "command:[cargo][build]*",
            "command:[cargo][check]*",
            "command:[cargo][clippy]*",
            "command:[cargo][fmt]*",
            "command:[cargo][test]*",
            "command:[git][diff]*",
            "command:[git][log]*",
            "command:[git][show]*",
            "command:[git][status]*",
            "command:[make][check]*",
            "command:[make][ci]*",
            "command:[make][format-check]*",
            "command:[make][lint]*",
            "command:[make][test]*",
            "command:[rg]*",
        ] {
            rules.push(PermissionRule::new("execute", resource, Allow));
        }
    }
    rules
}

/// Small `*`/`?` matcher. Both wildcards cross path separators, matching the
/// permission algebra rather than filesystem-glob semantics.
pub fn wildcard_match(pattern: &str, value: &str) -> bool {
    let pattern = pattern.chars().collect::<Vec<_>>();
    let value = value.chars().collect::<Vec<_>>();
    let mut previous = vec![false; value.len() + 1];
    previous[0] = true;
    for token in pattern {
        let mut current = vec![false; value.len() + 1];
        if token == '*' {
            current[0] = previous[0];
        }
        for index in 1..=value.len() {
            current[index] = match token {
                '*' => previous[index] || current[index - 1],
                '?' => previous[index - 1],
                literal => previous[index - 1] && literal == value[index - 1],
            };
        }
        previous = current;
    }
    previous[value.len()]
}

/// Project one validated backend path into the action being performed plus an
/// external-directory guard when it lies outside the backend workspace.
pub(crate) fn file_resources(
    action: &str,
    resolved_path: PathBuf,
    backend: &ExecutionBackend,
    store_path: &Path,
    mutating: bool,
) -> Vec<PermissionResource> {
    let resolved_path = match backend {
        ExecutionBackend::Local { .. } => {
            crate::tools::mutation::resolve_target_path(&resolved_path)
                .unwrap_or_else(|_| lexical_normalize(&resolved_path))
        }
        ExecutionBackend::Sandbox(_) | ExecutionBackend::Ssh(_) => {
            lexical_normalize(&resolved_path)
        }
    };
    resolved_file_resources(action, resolved_path, backend, store_path, mutating)
}

/// Project a path that has already been resolved to the exact filesystem
/// object the operation will affect. Deletion operands use this after
/// canonicalizing only their parent so policy and execution both refer to the
/// directory entry being unlinked rather than the final symlink's target.
fn resolved_file_resources(
    action: &str,
    resolved_path: PathBuf,
    backend: &ExecutionBackend,
    store_path: &Path,
    mutating: bool,
) -> Vec<PermissionResource> {
    let display = resolved_path.display().to_string();
    let mut resource = PermissionResource::new(action, display.clone())
        .with_display(display.clone())
        .with_save_resource(display.clone());

    if mutating {
        if path_contains_component(&resolved_path, ".git") {
            resource = resource.with_hard_denial(
                "direct file mutation of Git metadata is blocked; use a non-destructive Git command",
            );
        } else if backend.workspace_cwd_is_local() && is_store_path(&resolved_path, store_path) {
            resource = resource
                .with_hard_denial("direct mutation of the active NAC session store is blocked");
        }
    }

    let workspace = match backend {
        ExecutionBackend::Local { .. } => {
            crate::tools::mutation::resolve_target_path(&backend.default_terminal_cwd())
                .unwrap_or_else(|_| lexical_normalize(&backend.default_terminal_cwd()))
        }
        ExecutionBackend::Sandbox(_) | ExecutionBackend::Ssh(_) => {
            lexical_normalize(&backend.default_terminal_cwd())
        }
    };
    let mut resources = vec![resource];
    if !path_is_within(&resolved_path, &workspace) {
        resources.push(
            PermissionResource::new("external_directory", display.clone())
                .with_display(display.clone())
                .with_save_resource(external_directory_pattern(&resolved_path)),
        );
    }
    resources
}

/// Re-resolve every path-bearing resource immediately before authorization.
/// This closes the lexical projection gap for SSH and sandbox paths while
/// keeping prepared calls fully decoded and side-effect free.
pub(crate) async fn canonicalize_authorization_resources(
    resources: &[PermissionResource],
    backend: &ExecutionBackend,
    store_path: &Path,
) -> anyhow::Result<Vec<PermissionResource>> {
    let path_actions = [
        "read",
        "edit",
        "glob",
        "grep",
        "execute_cwd",
        "execute_path",
    ];
    let projected_paths = resources
        .iter()
        .filter(|resource| path_actions.contains(&resource.action.as_str()))
        .map(|resource| resource.resource.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut canonical = Vec::new();
    for resource in resources {
        if path_actions.contains(&resource.action.as_str()) {
            let (mut projected, binding) = if resource.preserve_final_component {
                let requested = Path::new(resource.shell_binding.as_deref().ok_or_else(|| {
                    anyhow::anyhow!("shell deletion target is missing its requested path")
                })?);
                let parent = requested.parent().ok_or_else(|| {
                    anyhow::anyhow!("shell deletion target has no parent directory")
                })?;
                let name = requested.file_name().ok_or_else(|| {
                    anyhow::anyhow!("shell deletion target has no final component")
                })?;
                let binding = backend
                    .canonicalize_permission_path(parent)
                    .await?
                    .join(name);
                let projected = resolved_file_resources(
                    &resource.action,
                    binding.clone(),
                    backend,
                    store_path,
                    resource.action == "edit",
                );
                (projected, Some(binding))
            } else {
                let path = backend
                    .canonicalize_permission_path(Path::new(&resource.resource))
                    .await?;
                let projected = file_resources(
                    &resource.action,
                    path,
                    backend,
                    store_path,
                    resource.action == "edit",
                );
                let binding = resource
                    .shell_binding
                    .as_ref()
                    .map(|_| PathBuf::from(&projected[0].resource));
                (projected, binding)
            };
            if let Some(binding) = binding {
                projected[0].shell_binding = Some(binding.display().to_string());
                projected[0].preserve_final_component = resource.preserve_final_component;
            }
            canonical.extend(projected);
        } else if resource.action != "external_directory"
            || !projected_paths.contains(resource.resource.as_str())
        {
            canonical.push(resource.clone());
        }
    }
    Ok(canonical)
}

pub(crate) fn shell_resources(
    command: &str,
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Vec<PermissionResource> {
    let cwd = lexical_normalize(cwd);
    let mut resources = Vec::new();

    match parse_shell(command) {
        ParsedShell::Supported(segments) => {
            for tokens in segments {
                let canonical = canonical_command(&tokens);
                let display = tokens.join(" ");
                let mut resource = PermissionResource::new("execute", canonical)
                    .with_display(display.clone())
                    .with_save_resource(command_grant_candidate(&tokens));
                if let Some(reason) = hard_shell_denial(&tokens, &cwd, backend) {
                    resource = resource.with_hard_denial(reason);
                }
                resources.push(resource);
                if is_broad_command(&tokens) {
                    resources.push(
                        PermissionResource::new("execute_broad", canonical_command(&tokens))
                            .with_display(format!("broad interpreter or shell: {display}")),
                    );
                }
                resources.extend(shell_path_resources(&tokens, &cwd, backend));
            }
        }
        ParsedShell::Opaque => {
            let digest = Sha256::digest(command.as_bytes());
            let mut resource =
                PermissionResource::new("execute", format!("opaque:sha256:{digest:x}"))
                    .with_display(command);
            if let Some(reason) = opaque_hard_shell_denial(command, &cwd, backend) {
                resource = resource.with_hard_denial(reason);
            }
            resources.push(resource);
            resources.push(
                PermissionResource::new("execute_opaque", format!("opaque:sha256:{digest:x}"))
                    .with_display("unsupported shell syntax requires explicit approval"),
            );
        }
    }
    resources.extend(file_resources(
        "execute_cwd",
        cwd,
        backend,
        Path::new(""),
        false,
    ));
    resources
}

/// A PTY can receive additional bytes after initial command authorization.
/// Opaque commands and broad interpreters can turn those bytes into a second,
/// unanalyzed program, so direct sessions must not expose them as interactive
/// terminals until follow-up input has an equally strong policy boundary.
pub(crate) fn unbounded_interactive_input(command: &str) -> bool {
    match parse_shell(command) {
        ParsedShell::Supported(segments) => segments.iter().any(|tokens| is_broad_command(tokens)),
        ParsedShell::Opaque => true,
    }
}

fn is_store_path(path: &Path, store_path: &Path) -> bool {
    let store = crate::tools::mutation::resolve_target_path(store_path)
        .unwrap_or_else(|_| lexical_normalize(store_path));
    if path == store {
        return true;
    }
    let Some(name) = store.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    path.parent() == store.parent()
        && path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|candidate| {
                candidate == format!("{name}-wal") || candidate == format!("{name}-shm")
            })
}

fn external_directory_pattern(path: &Path) -> String {
    // External authority starts exact. A directory-wide proposal needs a
    // first-class separator-aware representation rather than `/tmp/work*`,
    // which would also match a sibling such as `/tmp/work-secret`.
    path.display().to_string()
}

fn path_contains_component(path: &Path, expected: &str) -> bool {
    path.components().any(|component| {
        matches!(component, Component::Normal(value) if value.to_str() == Some(expected))
    })
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

enum ParsedShell {
    Supported(Vec<Vec<String>>),
    Opaque,
}

fn parse_shell(command: &str) -> ParsedShell {
    if contains_opaque_shell_syntax(command) {
        return ParsedShell::Opaque;
    }
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut word = String::new();
    let mut word_started = false;
    let mut quote = None;
    let mut escaped = false;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        if escaped {
            if current != '\n' {
                word.push(current);
                word_started = true;
            }
            escaped = false;
            index += 1;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            if quote == Some('"')
                && !chars
                    .get(index + 1)
                    .is_some_and(|next| matches!(next, '$' | '`' | '"' | '\\' | '\n'))
            {
                word.push(current);
                word_started = true;
                index += 1;
                continue;
            }
            escaped = true;
            index += 1;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else {
                word.push(current);
            }
            index += 1;
            continue;
        }
        if current == '\'' || current == '"' {
            quote = Some(current);
            word_started = true;
            index += 1;
            continue;
        }
        if current.is_whitespace() {
            push_word(&mut segment, &mut word, &mut word_started);
            index += 1;
            continue;
        }
        let boundary = match current {
            ';' | '\n' => 1,
            '|' | '&' if chars.get(index + 1) == Some(&current) => 2,
            '|' | '&' => 1,
            _ => 0,
        };
        if boundary > 0 {
            push_word(&mut segment, &mut word, &mut word_started);
            if !segment.is_empty() {
                segments.push(std::mem::take(&mut segment));
            }
            index += boundary;
            continue;
        }
        word.push(current);
        word_started = true;
        index += 1;
    }
    if escaped || quote.is_some() {
        return ParsedShell::Opaque;
    }
    push_word(&mut segment, &mut word, &mut word_started);
    if !segment.is_empty() {
        segments.push(segment);
    }
    if segments.is_empty() {
        ParsedShell::Opaque
    } else {
        ParsedShell::Supported(segments)
    }
}

fn contains_opaque_shell_syntax(command: &str) -> bool {
    let mut quote = None;
    let mut escaped = false;
    for current in command.chars() {
        if escaped {
            escaped = false;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else if matches!(current, '$' | '`') {
                return true;
            }
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            continue;
        }
        if matches!(
            current,
            '$' | '`' | '<' | '>' | '(' | ')' | '{' | '}' | '*' | '?' | '['
        ) {
            return true;
        }
    }
    false
}

fn push_word(segment: &mut Vec<String>, word: &mut String, word_started: &mut bool) {
    if *word_started {
        segment.push(std::mem::take(word));
        *word_started = false;
    }
}

fn canonical_command(tokens: &[String]) -> String {
    let mut canonical = String::from("command:");
    for token in tokens {
        canonical.push('[');
        for byte in token.bytes() {
            if byte.is_ascii_alphanumeric() || b"._/-".contains(&byte) {
                canonical.push(char::from(byte));
            } else {
                canonical.push_str(&format!("%{byte:02X}"));
            }
        }
        canonical.push(']');
    }
    canonical
}

fn command_grant_candidate(tokens: &[String]) -> String {
    const BANNED: &[&str] = &[
        "bash", "bun", "dash", "deno", "env", "fish", "node", "nodejs", "npm", "perl", "php",
        "pnpm", "python", "python3", "rm", "ruby", "sh", "sudo", "yarn", "zsh",
    ];
    let command = effective_command_tokens(tokens)
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let contains_banned_wrapper = tokens.iter().any(|token| {
        token
            .rsplit('/')
            .next()
            .is_some_and(|token| BANNED.contains(&token.to_ascii_lowercase().as_str()))
    });
    if tokens.is_empty()
        || BANNED.contains(&command.as_str())
        || contains_banned_wrapper
        || shell_control_prefix(tokens)
        || is_broad_command(tokens)
    {
        return canonical_command(tokens);
    }
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let width = if command == "git" {
        let Some(subcommand_index) = git_subcommand_index(tokens, command_index) else {
            return canonical_command(tokens);
        };
        subcommand_index + 1
    } else {
        tokens.len().min(2)
    };
    format!("{}*", canonical_command(&tokens[..width]))
}

fn hard_shell_denial(tokens: &[String], cwd: &Path, backend: &ExecutionBackend) -> Option<String> {
    hard_shell_denial_inner(tokens, cwd, backend, 0)
}

fn hard_shell_denial_inner(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
    depth: usize,
) -> Option<String> {
    if shell_control_prefix(tokens) {
        return Some(
            "shell control syntax is blocked because it can hide protected commands".to_string(),
        );
    }
    if literal_env_split_string(tokens).is_some() {
        return Some(
            "env split-string execution is blocked because embedded command paths cannot be independently authorized"
                .to_string(),
        );
    }
    if git_environment_configuration_override(tokens) {
        return Some(
            "Git environment configuration is blocked because it can execute hidden commands"
                .to_string(),
        );
    }
    let tokens = effective_command_tokens(tokens);
    let command = tokens.first()?.rsplit('/').next()?.to_ascii_lowercase();
    if matches!(
        command.as_str(),
        "chrt"
            | "daemon"
            | "daemonize"
            | "flock"
            | "ionice"
            | "numactl"
            | "parallel"
            | "runuser"
            | "script"
            | "setsid"
            | "start-stop-daemon"
            | "stdbuf"
            | "systemd-run"
            | "taskset"
            | "watch"
    ) {
        return Some(format!(
            "execution wrapper '{command}' is blocked because it can conceal a protected command"
        ));
    }
    if command == "eval" {
        return Some(
            "shell eval is blocked because quoted data can become a protected command".to_string(),
        );
    }
    if embedded_command_body(tokens).is_some() {
        return Some(
            "embedded executable command bodies are blocked because their paths cannot be independently authorized"
                .to_string(),
        );
    }
    if command == "xargs" {
        if depth >= 8 {
            return Some("nested executable wrapper depth exceeds the safety limit".to_string());
        }
        match xargs_command_tokens(tokens) {
            Ok(Some(_)) => {
                return Some(
                    "xargs command execution is blocked because streamed input can become unauthorized executable arguments"
                        .to_string(),
                );
            }
            Ok(None) => {}
            Err(reason) => return Some(reason.to_string()),
        }
    }
    if command == "find" {
        if depth >= 8 && find_exec_commands(tokens).next().is_some() {
            return Some("nested executable wrapper depth exceeds the safety limit".to_string());
        }
        if find_exec_commands(tokens).next().is_some() {
            return Some(
                "find executable actions are blocked because nested command paths cannot be independently authorized"
                    .to_string(),
            );
        }
        if tokens.iter().any(|token| token == "-delete") {
            return Some(
                "find -delete is blocked because traversal can remove protected paths".to_string(),
            );
        }
    }
    if matches!(
        command.as_str(),
        "sudo" | "doas" | "su" | "shutdown" | "reboot"
    ) {
        return Some(format!(
            "protected authority-amplifying command '{command}' is blocked"
        ));
    }
    if command.starts_with("mkfs") {
        return Some("filesystem formatting commands are blocked".to_string());
    }
    if command == "git" {
        if git_alias_override(tokens) {
            return Some(
                "Git command-scoped configuration is blocked because it can execute hidden commands"
                    .to_string(),
            );
        }
        let destructive = tokens
            .iter()
            .skip(1)
            .any(|token| matches!(token.as_str(), "clean" | "reset" | "restore"));
        let checkout = tokens.iter().skip(1).any(|token| token == "checkout");
        if destructive || checkout {
            return Some("destructive Git workspace rewrites are blocked".to_string());
        }
    }
    if command == "rm" && removes_protected_root(tokens, cwd, backend) {
        return Some(
            "recursive deletion of the workspace or filesystem root is blocked".to_string(),
        );
    }
    if matches!(command.as_str(), "bash" | "dash" | "fish" | "sh" | "zsh") {
        if depth >= 8 {
            return Some("nested shell command depth exceeds the safety limit".to_string());
        }
        if literal_shell_command_body(tokens).is_some() {
            return Some(
                "nested shell command bodies are blocked because their paths cannot be independently authorized"
                    .to_string(),
            );
        }
    }
    None
}

fn git_alias_override(tokens: &[String]) -> bool {
    let Some(command_index) = tokens.iter().position(|token| {
        token
            .rsplit('/')
            .next()
            .is_some_and(|command| command.eq_ignore_ascii_case("git"))
    }) else {
        return false;
    };
    let subcommand_index = git_subcommand_index(tokens, command_index).unwrap_or(tokens.len());
    let mut index = command_index + 1;
    while index < subcommand_index {
        let token = &tokens[index];
        let configured = if token == "-c" || token == "--config-env" {
            index += 1;
            tokens.get(index).map(String::as_str)
        } else if let Some(configured) = token.strip_prefix("-c") {
            (!configured.is_empty()).then_some(configured)
        } else {
            token.strip_prefix("--config-env=")
        };
        if configured.is_some() {
            return true;
        }
        index += 1;
    }
    false
}

fn git_environment_configuration_override(tokens: &[String]) -> bool {
    let effective = effective_command_tokens(tokens);
    if !effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("git"))
    {
        return false;
    }
    let prefix_len = tokens.len().saturating_sub(effective.len());
    tokens[..prefix_len].iter().any(|token| {
        let Some((name, _)) = token.split_once('=') else {
            return false;
        };
        let name = name.to_ascii_uppercase();
        matches!(
            name.as_str(),
            "GIT_CONFIG_COUNT"
                | "GIT_CONFIG_PARAMETERS"
                | "GIT_CONFIG_GLOBAL"
                | "GIT_CONFIG_SYSTEM"
        ) || name.starts_with("GIT_CONFIG_KEY_")
            || name.starts_with("GIT_CONFIG_VALUE_")
    })
}

fn literal_shell_command_body(tokens: &[String]) -> Option<&str> {
    let option_index = tokens
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(index, token)| {
            (token.starts_with('-') && !token.starts_with("--") && token[1..].contains('c'))
                .then_some(index)
        })?;
    tokens.get(option_index + 1).map(String::as_str)
}

fn embedded_command_body(tokens: &[String]) -> Option<&str> {
    let effective = effective_command_tokens(tokens);
    let command = effective.first()?.rsplit('/').next()?;
    if !command.eq_ignore_ascii_case("rg") {
        return None;
    }
    effective
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(index, token)| {
            if token == "--pre" {
                effective.get(index + 1).map(String::as_str)
            } else {
                token.strip_prefix("--pre=")
            }
        })
}

fn xargs_command_tokens(tokens: &[String]) -> Result<Option<&[String]>, &'static str> {
    const VALUE_OPTIONS: &[&str] = &[
        "-a",
        "--arg-file",
        "-d",
        "--delimiter",
        "-E",
        "--eof",
        "-I",
        "--replace",
        "-L",
        "--max-lines",
        "-n",
        "--max-args",
        "-P",
        "--max-procs",
        "-s",
        "--max-chars",
        "--process-slot-var",
    ];
    const FLAG_OPTIONS: &[&str] = &[
        "-0",
        "--null",
        "--show-limits",
        "-p",
        "--interactive",
        "-r",
        "--no-run-if-empty",
        "-t",
        "--verbose",
        "-x",
        "--exit",
        "--help",
        "--version",
        "-e",
        "-i",
        "-l",
        "-o",
    ];
    const ATTACHED_VALUE_OPTIONS: &[&str] = &[
        "-a", "-d", "-E", "-I", "-J", "-L", "-n", "-P", "-R", "-S", "-s",
    ];
    let effective = effective_command_tokens(tokens);
    let mut index = 1;
    while let Some(token) = effective.get(index) {
        if token == "--" {
            return Ok(effective
                .get(index + 1..)
                .filter(|command| !command.is_empty()));
        }
        if !token.starts_with('-') || token == "-" {
            return Ok(Some(&effective[index..]));
        }
        let option = token
            .split_once('=')
            .map_or(token.as_str(), |(name, _)| name);
        index += 1;
        if VALUE_OPTIONS.contains(&option) && !token.contains('=') && token == option {
            index += 1;
        } else if FLAG_OPTIONS.contains(&option)
            || ATTACHED_VALUE_OPTIONS
                .iter()
                .any(|prefix| token.starts_with(prefix) && token.len() > prefix.len())
        {
        } else {
            return Err("unsupported xargs option syntax is blocked");
        }
    }
    Ok(None)
}

fn find_exec_commands(tokens: &[String]) -> impl Iterator<Item = &[String]> {
    let effective = effective_command_tokens(tokens);
    let mut commands = Vec::new();
    let mut index = 1;
    while index < effective.len() {
        if matches!(
            effective[index].as_str(),
            "-exec" | "-execdir" | "-ok" | "-okdir"
        ) {
            let start = index + 1;
            let end = effective[start..]
                .iter()
                .position(|token| matches!(token.as_str(), ";" | "+"))
                .map_or(effective.len(), |offset| start + offset);
            if start < end {
                commands.push(&effective[start..end]);
            }
            index = end.saturating_add(1);
        } else {
            index += 1;
        }
    }
    commands.into_iter()
}

fn literal_env_split_string(tokens: &[String]) -> Option<(&str, &str, &[String])> {
    let mut index = 0;
    while tokens
        .get(index)
        .is_some_and(|token| is_environment_assignment(token))
    {
        index += 1;
    }
    let env_command = tokens.get(index)?;
    if !env_command.rsplit('/').next()?.eq_ignore_ascii_case("env") {
        return None;
    }
    index += 1;
    while let Some(option) = tokens.get(index) {
        if matches!(option.as_str(), "-S" | "--split-string") {
            return tokens
                .get(index + 1)
                .map(|body| (env_command.as_str(), body.as_str(), &tokens[index + 2..]));
        }
        if let Some(body) = option.strip_prefix("--split-string=") {
            return Some((env_command.as_str(), body, &tokens[index + 1..]));
        }
        if let Some(body) = option.strip_prefix("-S").filter(|body| !body.is_empty()) {
            return Some((env_command.as_str(), body, &tokens[index + 1..]));
        }
        if matches!(option.as_str(), "-u" | "--unset" | "-C" | "--chdir") {
            index += 2;
        } else if option.starts_with('-') || is_environment_assignment(option) {
            index += 1;
        } else {
            break;
        }
    }
    None
}

fn env_split_string_policy_body(body: &str) -> Result<String, &'static str> {
    let mut normalized = String::with_capacity(body.len());
    let mut chars = body.chars();
    while let Some(current) = chars.next() {
        if current == '$' {
            return Err("dynamic env split-string expansion is blocked");
        }
        if current != '\\' {
            normalized.push(current);
            continue;
        }
        let Some(escaped) = chars.next() else {
            return Err("unsupported env split-string escape is blocked");
        };
        match escaped {
            '_' | 'f' | 'n' | 'r' | 't' | 'v' => normalized.push(' '),
            'c' => break,
            _ => return Err("unsupported env split-string escape is blocked"),
        }
    }
    Ok(normalized)
}

fn expanded_env_split_tokens(tokens: &[String]) -> Result<Option<Vec<String>>, &'static str> {
    let Some((env_command, body, trailing)) = literal_env_split_string(tokens) else {
        return Ok(None);
    };
    let body = env_split_string_policy_body(body)?;
    let ParsedShell::Supported(mut segments) = parse_shell(&body) else {
        return Err("unsupported env split-string syntax is blocked");
    };
    if segments.len() != 1 {
        return Err("unsupported env split-string syntax is blocked");
    }
    let mut expanded = segments.pop().unwrap_or_default();
    expanded.extend_from_slice(trailing);
    if expanded
        .first()
        .is_none_or(|token| token.starts_with('-') || is_environment_assignment(token))
    {
        expanded.insert(0, env_command.to_string());
    }
    Ok(Some(expanded))
}

fn effective_command_tokens(tokens: &[String]) -> &[String] {
    let mut index = 0;
    loop {
        while tokens
            .get(index)
            .is_some_and(|token| is_environment_assignment(token))
        {
            index += 1;
        }
        let Some(command) = tokens
            .get(index)
            .and_then(|command| command.rsplit('/').next())
            .map(str::to_ascii_lowercase)
        else {
            return &tokens[index..];
        };
        match command.as_str() {
            "command" | "builtin" | "nohup" => {
                index += 1;
                while tokens
                    .get(index)
                    .is_some_and(|token| token.starts_with('-'))
                {
                    index += 1;
                }
            }
            "exec" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if option == "-a" {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with('-') {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "env" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(
                        option.as_str(),
                        "-u" | "--unset"
                            | "-C"
                            | "--chdir"
                            | "-S"
                            | "--split-string"
                            | "-a"
                            | "--argv0"
                    ) {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--unset=")
                        || option.starts_with("--chdir=")
                        || option.starts_with("--split-string=")
                        || option.starts_with("--argv0=")
                        || option.starts_with('-')
                        || is_environment_assignment(option)
                    {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "nice" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(option.as_str(), "-n" | "--adjustment") {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--adjustment=") || option.starts_with('-') {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "timeout" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(option.as_str(), "-k" | "--kill-after" | "-s" | "--signal") {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--kill-after=")
                        || option.starts_with("--signal=")
                        || option.starts_with('-')
                    {
                        index += 1;
                    } else {
                        break;
                    }
                }
                // GNU timeout requires one duration operand before COMMAND.
                if index < tokens.len() {
                    index += 1;
                }
            }
            "time" => {
                index += 1;
                while let Some(option) = tokens.get(index) {
                    if option == "--" {
                        index += 1;
                        break;
                    }
                    if matches!(option.as_str(), "-f" | "--format" | "-o" | "--output") {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with("--format=")
                        || option.starts_with("--output=")
                        || option.starts_with("-f") && option.len() > 2
                        || option.starts_with("-o") && option.len() > 2
                        || option.starts_with('-')
                    {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "busybox" => index += 1,
            _ => return &tokens[index..],
        }
    }
}

fn is_environment_assignment(token: &str) -> bool {
    let Some((name, _)) = token.split_once('=') else {
        return false;
    };
    !name.is_empty()
        && name.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphanumeric() && (index > 0 || !byte.is_ascii_digit())
        })
}

fn is_broad_command(tokens: &[String]) -> bool {
    is_broad_command_inner(tokens, 0)
}

fn is_broad_command_inner(tokens: &[String], depth: usize) -> bool {
    const BROAD: &[&str] = &[
        "bash", "bun", "dash", "deno", "fish", "node", "nodejs", "npm", "perl", "php", "pnpm",
        "python", "python3", "ruby", "sh", "yarn", "zsh",
    ];
    if depth < 8 {
        if let Ok(Some(expanded)) = expanded_env_split_tokens(tokens) {
            if is_broad_command_inner(&expanded, depth + 1) {
                return true;
            }
        }
    }
    let effective = effective_command_tokens(tokens);
    let command_is_broad = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| {
            let command = command.to_ascii_lowercase();
            BROAD.contains(&command.as_str())
                || command.starts_with("python3.")
                || command.starts_with("node-")
                || command == "xargs"
                || command == "find" && find_exec_commands(effective).next().is_some()
        });
    command_is_broad || cargo_configuration(effective) || embedded_command_body(effective).is_some()
}

fn cargo_configuration(tokens: &[String]) -> bool {
    if !tokens
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("cargo"))
    {
        return false;
    }
    tokens.iter().enumerate().skip(1).any(|(index, token)| {
        token.starts_with("--config=") || index > 0 && tokens[index - 1] == "--config"
    })
}

fn shell_control_prefix(tokens: &[String]) -> bool {
    let effective = effective_command_tokens(tokens);
    let mut command = effective.first();
    if command.is_some_and(|token| token.eq_ignore_ascii_case("time")) {
        command = effective
            .iter()
            .skip(1)
            .find(|token| !token.starts_with('-'));
    }
    command.is_some_and(|token| {
        matches!(
            token.to_ascii_lowercase().as_str(),
            "!" | "{"
                | "}"
                | "coproc"
                | "if"
                | "then"
                | "else"
                | "elif"
                | "fi"
                | "for"
                | "while"
                | "until"
                | "do"
                | "done"
                | "case"
                | "esac"
                | "select"
                | "function"
                | "[["
                | "]]"
        )
    })
}

fn shell_path_resources(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Vec<PermissionResource> {
    let mut paths = Vec::<(PathBuf, bool, bool)>::new();
    for index in 0..tokens.len() {
        if let Some((_, requested)) = shell_path_candidate(tokens, index) {
            let path = shell_path_requested_path(tokens, index, requested, cwd);
            let mutating = shell_path_is_mutating(tokens, index);
            let effective = effective_command_tokens(tokens);
            let command_index = tokens.len().saturating_sub(effective.len());
            let preserve_final_component =
                deletion_operand_path_position(tokens, command_index, index);
            if let Some((_, existing_mutating, existing_preserve_final)) =
                paths.iter_mut().find(|(existing, _, _)| existing == &path)
            {
                *existing_mutating |= mutating;
                *existing_preserve_final |= preserve_final_component;
            } else {
                paths.push((path, mutating, preserve_final_component));
            }
        }
    }
    paths
        .into_iter()
        .flat_map(|(path, mutating, preserve_final_component)| {
            let action = if mutating { "edit" } else { "execute_path" };
            let binding = path.display().to_string();
            let mut resources = file_resources(action, path, backend, Path::new(""), mutating);
            resources[0] = resources[0]
                .clone()
                .with_shell_binding(binding, preserve_final_component);
            resources
        })
        .collect()
}

fn looks_like_shell_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
        || value == ".git"
        || value.starts_with(".git/")
        || value == ".env"
        || value.starts_with(".env.")
}

fn shell_path_candidate(tokens: &[String], index: usize) -> Option<(Option<&str>, &Path)> {
    let token = tokens.get(index)?;
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let git_command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("git"));
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let git_subcommand = git_command
        .then(|| git_subcommand_index(tokens, command_index))
        .flatten();
    if git_command
        && index > command_index
        && git_subcommand.is_some_and(|subcommand| index < subcommand)
    {
        if let Some(candidate) = token
            .strip_prefix("-C")
            .filter(|candidate| !candidate.is_empty())
        {
            return Some((Some("-C"), Path::new(candidate)));
        }
    }
    if command == "dd" {
        if let Some(candidate) = token.strip_prefix("of=") {
            return Some((Some("of"), Path::new(candidate)));
        }
    }
    let (option, candidate) = token
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'))
        .map_or((None, token.as_str()), |(option, value)| {
            (Some(option), value)
        });
    let git_global_c_value = git_command
        && index > 0
        && tokens[index - 1] == "-C"
        && git_subcommand.is_some_and(|subcommand| index < subcommand);
    let cargo_key_value_config = command == "cargo"
        && index > 0
        && tokens[index - 1] == "--config"
        && token.contains('=')
        && !looks_like_shell_path(token);
    let previous_takes_path = index > 0
        && matches!(
            tokens[index - 1].as_str(),
            "--manifest-path" | "--config" | "--output" | "-o" | "-f" | "--file"
        )
        && !cargo_key_value_config
        || git_global_c_value
        || index > 0 && matches!(command.as_str(), "make" | "tar") && tokens[index - 1] == "-C"
        || command == "unzip" && index > 0 && tokens[index - 1] == "-d";
    let git_global_path = git_command
        && (option
            .is_some_and(|option| matches!(option, "--git-dir" | "--work-tree" | "--exec-path"))
            || index > 0 && matches!(tokens[index - 1].as_str(), "--git-dir" | "--work-tree"));
    let explicit_command_path = index == command_index && candidate.contains('/');
    let known_bare_path = bare_relative_path_position(tokens, index);
    let deletion_operand = deletion_operand_path_position(tokens, command_index, index);
    (previous_takes_path
        || git_global_path
        || explicit_command_path
        || looks_like_shell_path(candidate)
        || known_bare_path
        || deletion_operand)
        .then(|| (option, Path::new(candidate)))
}

fn deletion_operand_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    let command = tokens
        .get(command_index)
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default();
    matches!(
        command.to_ascii_lowercase().as_str(),
        "rm" | "rmdir" | "unlink"
    ) && rm_operand_path_position(tokens, command_index, index)
}

fn rm_operand_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    if index <= command_index {
        return false;
    }
    let token = &tokens[index];
    !token.starts_with('-')
        || tokens[command_index + 1..index]
            .iter()
            .any(|candidate| candidate == "--")
}

fn shell_path_requested_path(
    tokens: &[String],
    index: usize,
    requested: &Path,
    cwd: &Path,
) -> PathBuf {
    if requested.is_absolute() {
        return requested.to_path_buf();
    }
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    if effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| command.eq_ignore_ascii_case("git"))
    {
        if git_c_path_position(tokens, command_index, index) {
            return git_effective_cwd_before(tokens, command_index, index, cwd).join(requested);
        }
        if git_global_path_position(tokens, command_index, index)
            || bare_relative_path_position(tokens, index)
        {
            return git_effective_cwd(tokens, command_index, cwd).join(requested);
        }
    }
    cwd.join(requested)
}

fn shell_path_is_mutating(tokens: &[String], index: usize) -> bool {
    let option = tokens[index]
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'))
        .map(|(option, _)| option);
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let writer_operand = index > command_index
        && matches!(
            command.as_str(),
            "chmod"
                | "chown"
                | "chgrp"
                | "cp"
                | "install"
                | "ln"
                | "mkdir"
                | "mv"
                | "rm"
                | "rsync"
                | "rmdir"
                | "tee"
                | "touch"
                | "truncate"
                | "unlink"
        )
        && (!tokens[index].starts_with('-')
            || deletion_operand_path_position(tokens, command_index, index));
    let in_place_editor = index > command_index
        && matches!(command.as_str(), "perl" | "sed")
        && tokens[command_index + 1..index].iter().any(|token| {
            token == "-i" || token.starts_with("-i") || token.starts_with("--in-place")
        });
    let extracts_into_path = command == "tar"
        && tokens[command_index + 1..]
            .iter()
            .any(|token| token == "--extract" || token.starts_with('-') && token.contains('x'));
    let destructive_find = command == "find" && tokens.iter().any(|token| token == "-delete");
    let cargo_output_path = command.eq_ignore_ascii_case("cargo")
        && (matches!(option, Some("--target-dir" | "--lockfile-path"))
            || index > 0
                && matches!(
                    tokens[index - 1].as_str(),
                    "--target-dir" | "--lockfile-path"
                ));
    let archive_output_path = command == "unzip" && index > 0 && tokens[index - 1] == "-d";
    option == Some("--output")
        || index > 0 && matches!(tokens[index - 1].as_str(), "--output" | "-o" | "-O")
        || writer_operand
        || command == "dd" && tokens[index].starts_with("of=")
        || in_place_editor
        || extracts_into_path
        || destructive_find
        || cargo_output_path
        || archive_output_path
}

fn bare_relative_path_position(tokens: &[String], index: usize) -> bool {
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if index <= command_index {
        return false;
    }
    match command.as_str() {
        "cargo" => cargo_bare_relative_path_position(tokens, index),
        "rg" => rg_bare_relative_path_position(tokens, command_index, index),
        "git" => git_bare_relative_path_position(tokens, command_index, index),
        _ => false,
    }
}

fn cargo_bare_relative_path_position(tokens: &[String], index: usize) -> bool {
    let token = &tokens[index];
    let option_and_value = token
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'));
    option_and_value.is_some_and(|(option, value)| {
        matches!(
            option,
            "--manifest-path" | "--target-dir" | "--lockfile-path"
        ) || option == "--config" && !value.contains('=')
    }) || index > 0
        && matches!(
            tokens[index - 1].as_str(),
            "--manifest-path" | "--target-dir" | "--lockfile-path"
        )
}

fn rg_bare_relative_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    const VALUE_OPTIONS: &[&str] = &[
        "-A",
        "--after-context",
        "-B",
        "--before-context",
        "-C",
        "--context",
        "--color",
        "--colors",
        "--context-separator",
        "-E",
        "--encoding",
        "--engine",
        "--field-match-separator",
        "-g",
        "--glob",
        "--iglob",
        "-M",
        "--max-columns",
        "-m",
        "--max-count",
        "--max-depth",
        "--max-filesize",
        "--path-separator",
        "--pre",
        "--pre-glob",
        "-r",
        "--replace",
        "--sort",
        "--sortr",
        "-t",
        "--type",
        "--type-add",
        "--type-clear",
        "--type-not",
        "-j",
        "--threads",
    ];
    const PATTERN_OPTIONS: &[&str] = &["-e", "--regexp"];
    const PATH_OPTIONS: &[&str] = &["-f", "--file", "--ignore-file"];

    let mut options = true;
    let mut skip_value = false;
    let mut explicit_pattern = false;
    let files_mode = tokens[command_index + 1..]
        .iter()
        .any(|token| token == "--files");
    let mut positional = Vec::new();
    for (cursor, token) in tokens.iter().enumerate().skip(command_index + 1) {
        if skip_value {
            skip_value = false;
            continue;
        }
        if options && token == "--" {
            options = false;
            continue;
        }
        if options && token.starts_with('-') {
            let option = token
                .split_once('=')
                .map_or(token.as_str(), |(name, _)| name);
            if PATTERN_OPTIONS.contains(&option) {
                explicit_pattern = true;
                skip_value = !token.contains('=');
            } else if PATH_OPTIONS.contains(&option) || VALUE_OPTIONS.contains(&option) {
                skip_value = !token.contains('=');
            }
            continue;
        }
        positional.push(cursor);
    }
    let Some(position) = positional.iter().position(|candidate| *candidate == index) else {
        return false;
    };
    files_mode || explicit_pattern || position > 0
}

fn git_bare_relative_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    let Some(subcommand_index) = git_subcommand_index(tokens, command_index) else {
        return false;
    };
    let subcommand = tokens[subcommand_index].as_str();
    if !matches!(subcommand, "diff" | "log" | "show" | "status") {
        return false;
    }
    if let Some(separator) = tokens[subcommand_index + 1..]
        .iter()
        .position(|token| token == "--")
        .map(|offset| subcommand_index + 1 + offset)
    {
        return index > separator;
    }
    if subcommand != "diff"
        || !tokens[subcommand_index + 1..]
            .iter()
            .any(|token| token == "--no-index")
    {
        return false;
    }
    let operands = (subcommand_index + 1..tokens.len())
        .filter(|candidate| !tokens[*candidate].starts_with('-'))
        .collect::<Vec<_>>();
    operands
        .iter()
        .rev()
        .take(2)
        .any(|candidate| *candidate == index)
}

fn git_subcommand_index(tokens: &[String], command_index: usize) -> Option<usize> {
    let mut index = command_index + 1;
    while let Some(option) = tokens.get(index) {
        if matches!(
            option.as_str(),
            "-C" | "-c"
                | "--git-dir"
                | "--work-tree"
                | "--namespace"
                | "--super-prefix"
                | "--config-env"
        ) {
            index += 2;
        } else if option.starts_with('-') {
            index += 1;
        } else {
            return Some(index);
        }
    }
    None
}

fn git_c_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    if index <= command_index
        || !git_subcommand_index(tokens, command_index).is_some_and(|subcommand| index < subcommand)
    {
        return false;
    }
    tokens.get(index - 1).is_some_and(|option| option == "-C")
        || tokens[index]
            .strip_prefix("-C")
            .is_some_and(|path| !path.is_empty())
}

fn git_global_path_position(tokens: &[String], command_index: usize, index: usize) -> bool {
    if index <= command_index {
        return false;
    }
    let token = &tokens[index];
    token.starts_with("--git-dir=")
        || token.starts_with("--work-tree=")
        || token.starts_with("--exec-path=")
        || tokens
            .get(index - 1)
            .is_some_and(|option| matches!(option.as_str(), "--git-dir" | "--work-tree"))
}

fn git_effective_cwd_before(
    tokens: &[String],
    command_index: usize,
    before_index: usize,
    cwd: &Path,
) -> PathBuf {
    let mut effective = cwd.to_path_buf();
    let mut index = command_index + 1;
    while index < before_index {
        let Some(option) = tokens.get(index) else {
            break;
        };
        let requested = if option == "-C" {
            if index + 1 >= before_index {
                break;
            }
            tokens.get(index + 1).map(String::as_str)
        } else {
            option
                .strip_prefix("-C")
                .filter(|requested| !requested.is_empty())
        };
        if let Some(requested) = requested {
            effective = if Path::new(requested).is_absolute() {
                PathBuf::from(requested)
            } else {
                effective.join(requested)
            };
            effective = lexical_normalize(&effective);
            index += if option == "-C" { 2 } else { 1 };
        } else if matches!(
            option.as_str(),
            "-c" | "--git-dir" | "--work-tree" | "--namespace" | "--super-prefix" | "--config-env"
        ) {
            index += 2;
        } else if option.starts_with('-') {
            index += 1;
        } else {
            break;
        }
    }
    effective
}

fn git_effective_cwd(tokens: &[String], command_index: usize, cwd: &Path) -> PathBuf {
    git_effective_cwd_before(tokens, command_index, tokens.len(), cwd)
}

pub(crate) fn bind_authorized_shell_command(
    command: &str,
    cwd: &Path,
    resources: &[PermissionResource],
) -> anyhow::Result<String> {
    let ParsedShell::Supported(segments) = parse_shell(command) else {
        return Ok(command.to_string());
    };
    let spans = supported_shell_word_spans(command)
        .ok_or_else(|| anyhow::anyhow!("authorized command could not be tokenized for binding"))?;
    if spans.len() != segments.len()
        || spans.iter().zip(&segments).any(|(spans, tokens)| {
            spans.iter().map(|span| &span.value).collect::<Vec<_>>()
                != tokens.iter().collect::<Vec<_>>()
        })
    {
        return Err(anyhow::anyhow!(
            "authorized command tokenization changed before binding"
        ));
    }

    let mut authorized_paths = resources
        .iter()
        .filter(|resource| matches!(resource.action.as_str(), "execute_path" | "edit"))
        .map(|resource| {
            resource
                .shell_binding
                .as_deref()
                .unwrap_or(resource.resource.as_str())
        });
    let cwd = lexical_normalize(cwd);
    let mut replacements = Vec::<(usize, usize, String)>::new();
    for (tokens, spans) in segments.iter().zip(spans) {
        let mut canonical_by_requested = Vec::<(PathBuf, String)>::new();
        for (index, span) in spans.iter().enumerate() {
            let Some((option, requested)) = shell_path_candidate(tokens, index) else {
                continue;
            };
            let requested = shell_path_requested_path(tokens, index, requested, &cwd);
            let canonical = if let Some((_, canonical)) = canonical_by_requested
                .iter()
                .find(|(seen, _)| seen == &requested)
            {
                canonical.clone()
            } else {
                let canonical = authorized_paths
                    .next()
                    .ok_or_else(|| anyhow::anyhow!("authorized command path is missing"))?
                    .to_string();
                canonical_by_requested.push((requested, canonical.clone()));
                canonical
            };
            let bound = option.map_or(canonical.clone(), |option| {
                if option == "-C" {
                    format!("-C{canonical}")
                } else {
                    format!("{option}={canonical}")
                }
            });
            replacements.push((span.start, span.end, shell_quote(&bound)));
        }
    }
    if authorized_paths.next().is_some() {
        return Err(anyhow::anyhow!(
            "authorized command contains unmatched path resources"
        ));
    }
    let mut rebound = command.to_string();
    for (start, end, replacement) in replacements.into_iter().rev() {
        rebound.replace_range(start..end, &replacement);
    }
    Ok(rebound)
}

#[derive(Debug)]
struct ShellWordSpan {
    start: usize,
    end: usize,
    value: String,
}

fn supported_shell_word_spans(command: &str) -> Option<Vec<Vec<ShellWordSpan>>> {
    if matches!(parse_shell(command), ParsedShell::Opaque) {
        return None;
    }
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut start = None;
    let mut value = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut escape_start = 0;
    let mut chars = command.char_indices().peekable();
    let push = |segment: &mut Vec<ShellWordSpan>,
                start: &mut Option<usize>,
                value: &mut String,
                end: usize| {
        if start.is_some() {
            segment.push(ShellWordSpan {
                start: start.take().expect("started shell word has a start"),
                end,
                value: std::mem::take(value),
            });
        } else {
            *start = None;
        }
    };
    while let Some((index, current)) = chars.next() {
        if escaped {
            if current != '\n' {
                start.get_or_insert(escape_start);
                value.push(current);
            }
            escaped = false;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            if quote == Some('"')
                && !chars
                    .peek()
                    .is_some_and(|(_, next)| matches!(next, '$' | '`' | '"' | '\\' | '\n'))
            {
                start.get_or_insert(index);
                value.push(current);
                continue;
            }
            escape_start = index;
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else {
                value.push(current);
            }
            continue;
        }
        if current == '\'' || current == '"' {
            start.get_or_insert(index);
            quote = Some(current);
            continue;
        }
        if current.is_whitespace() {
            push(&mut segment, &mut start, &mut value, index);
            continue;
        }
        let boundary = matches!(current, ';' | '\n' | '|' | '&');
        if boundary {
            push(&mut segment, &mut start, &mut value, index);
            if !segment.is_empty() {
                segments.push(std::mem::take(&mut segment));
            }
            if matches!(current, '|' | '&')
                && chars.peek().is_some_and(|(_, next)| *next == current)
            {
                chars.next();
            }
            continue;
        }
        start.get_or_insert(index);
        value.push(current);
    }
    push(&mut segment, &mut start, &mut value, command.len());
    if !segment.is_empty() {
        segments.push(segment);
    }
    Some(segments)
}

fn shell_quote(value: &str) -> String {
    if !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_./:=+,-".contains(&byte))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\\''"))
    }
}

fn opaque_hard_shell_denial(
    command: &str,
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Option<String> {
    if raw_shell_control_syntax(command) {
        return Some(
            "shell control syntax is blocked because it can hide protected commands".to_string(),
        );
    }
    let segments = opaque_shell_segments(command);
    if segments.iter().any(|tokens| {
        effective_command_tokens(tokens)
            .first()
            .is_some_and(|token| dynamic_shell_command_name(token))
    }) {
        return Some(
            "dynamic command names are blocked because expansion can become a protected command"
                .to_string(),
        );
    }
    if segments
        .iter()
        .any(|tokens| dynamic_deletion_command(tokens))
    {
        return Some(
            "dynamic deletion operands are blocked because protected targets cannot be resolved before execution"
                .to_string(),
        );
    }
    let tokens = opaque_literal_tokens(command);
    if command.contains('$') && literal_env_split_string(&tokens).is_some() {
        return Some("dynamic env split-string expansion is blocked".to_string());
    }
    if tokens.iter().any(|token| {
        let path = Path::new(token);
        looks_like_shell_path(token)
            && path_contains_component(
                &if path.is_absolute() {
                    path.to_path_buf()
                } else {
                    cwd.join(path)
                },
                ".git",
            )
    }) {
        return Some(
            "opaque shell access to Git metadata is blocked; use a supported non-destructive command"
                .to_string(),
        );
    }
    for segment in &segments {
        if let Some(reason) = hard_shell_denial(segment, cwd, backend) {
            return Some(reason);
        }
    }
    None
}

fn dynamic_shell_command_name(token: &str) -> bool {
    let expandable_character = token
        .chars()
        .any(|character| matches!(character, '$' | '`' | '{' | '}' | '*' | '?'));
    expandable_character && !matches!(token, "{" | "}")
        || token.contains('[') && token != "[" && !token.starts_with("[[")
}

fn dynamic_deletion_command(tokens: &[String]) -> bool {
    let mut effective = effective_command_tokens(tokens);
    if effective
        .first()
        .is_some_and(|token| token.eq_ignore_ascii_case("time"))
    {
        effective = &effective[1..];
        while effective
            .first()
            .is_some_and(|token| token.starts_with('-'))
        {
            effective = &effective[1..];
        }
    }
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(command.as_str(), "rm" | "rmdir" | "unlink")
        && effective.iter().skip(1).any(|token| {
            token
                .chars()
                .any(|character| matches!(character, '$' | '`' | '*' | '?' | '[' | '{' | '}'))
        })
    {
        return true;
    }
    if command == "xargs" {
        return xargs_command_tokens(effective)
            .ok()
            .flatten()
            .is_some_and(dynamic_deletion_command);
    }
    if command == "find" && find_exec_commands(effective).any(dynamic_deletion_command) {
        return true;
    }
    if matches!(command.as_str(), "bash" | "dash" | "fish" | "sh" | "zsh") {
        if let Some(body) = literal_shell_command_body(effective) {
            return opaque_shell_segments(body)
                .iter()
                .any(|tokens| dynamic_deletion_command(tokens));
        }
    }
    false
}

/// Tokenize opaque input just far enough to identify the literal command in
/// each shell segment. Expansions remain marked in their containing word; no
/// value is expanded and quoted data cannot become a command position.
fn opaque_shell_segments(command: &str) -> Vec<Vec<String>> {
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;
    let finish_word = |segment: &mut Vec<String>, word: &mut String| {
        if !word.is_empty() {
            segment.push(std::mem::take(word));
        }
    };
    let finish_segment = |segments: &mut Vec<Vec<String>>, segment: &mut Vec<String>| {
        if !segment.is_empty() {
            segments.push(std::mem::take(segment));
        }
    };
    while index < chars.len() {
        let current = chars[index];
        if escaped {
            if current != '\n' {
                word.push(current);
            }
            escaped = false;
            index += 1;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            escaped = true;
            index += 1;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else {
                word.push(current);
            }
            index += 1;
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            index += 1;
            continue;
        }
        if current == '#' && word.is_empty() {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            finish_segment(&mut segments, &mut segment);
            continue;
        }
        if current.is_whitespace() {
            finish_word(&mut segment, &mut word);
            if current == '\n' {
                finish_segment(&mut segments, &mut segment);
            }
            index += 1;
            continue;
        }
        if matches!(current, ';' | '|' | '&') {
            finish_word(&mut segment, &mut word);
            finish_segment(&mut segments, &mut segment);
            index += 1;
            if index < chars.len() && chars[index] == current {
                index += 1;
            }
            continue;
        }
        word.push(current);
        index += 1;
    }
    finish_word(&mut segment, &mut word);
    finish_segment(&mut segments, &mut segment);
    segments
}

fn raw_shell_control_syntax(command: &str) -> bool {
    fn is_control_keyword(word: &str) -> bool {
        matches!(
            word.to_ascii_lowercase().as_str(),
            "coproc"
                | "if"
                | "then"
                | "else"
                | "elif"
                | "fi"
                | "for"
                | "while"
                | "until"
                | "do"
                | "done"
                | "case"
                | "esac"
                | "select"
                | "function"
                | "[["
                | "]]"
        )
    }

    fn finish_word(word: &mut String, command_position: &mut bool, time_prefix: &mut bool) -> bool {
        if word.is_empty() {
            return false;
        }
        let control = *command_position && is_control_keyword(word);
        // `time` is itself shell grammar and leaves the following word in a
        // command position, including options and a following `!` word.
        if *command_position && word.eq_ignore_ascii_case("time") {
            *time_prefix = true;
        } else if !(*command_position && *time_prefix && word.starts_with('-')) {
            *command_position = false;
            *time_prefix = false;
        }
        word.clear();
        control
    }

    let mut chars = command.chars().peekable();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let mut command_position = true;
    let mut time_prefix = false;
    while let Some(current) = chars.next() {
        if escaped {
            if current != '\n' {
                word.push(current);
            }
            escaped = false;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else if active == '"'
                && (current == '`' || current == '$' && chars.peek() == Some(&'('))
            {
                // Command substitutions remain executable inside double
                // quotes, so opaque parsing must fail closed on them.
                return true;
            }
            continue;
        }
        if current == '\\' {
            escaped = true;
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            word.push('q');
            continue;
        }
        if current == '$' && chars.peek() == Some(&'(') || current == '`' {
            return true;
        }
        if current == '#' && word.is_empty() {
            if finish_word(&mut word, &mut command_position, &mut time_prefix) {
                return true;
            }
            for comment in chars.by_ref() {
                if comment == '\n' {
                    command_position = true;
                    time_prefix = false;
                    break;
                }
            }
            continue;
        }
        if current.is_whitespace() {
            if finish_word(&mut word, &mut command_position, &mut time_prefix) {
                return true;
            }
            if current == '\n' {
                command_position = true;
                time_prefix = false;
            }
            continue;
        }
        if matches!(current, ';' | '|' | '&') {
            if finish_word(&mut word, &mut command_position, &mut time_prefix) {
                return true;
            }
            command_position = true;
            time_prefix = false;
            continue;
        }
        if matches!(current, '(' | ')') {
            // Parentheses outside quotes are shell grouping, function, or
            // substitution syntax. All are opaque executable structure.
            return true;
        }
        if matches!(current, '!' | '{' | '}') && word.is_empty() && command_position {
            let boundary = chars.peek().is_none_or(|next| {
                next.is_whitespace() || matches!(next, ';' | '|' | '&' | '(' | ')')
            });
            if boundary {
                return true;
            }
        }
        word.push(current);
    }
    finish_word(&mut word, &mut command_position, &mut time_prefix)
}

fn opaque_literal_tokens(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    for current in command.chars() {
        if escaped {
            if current != '\n' {
                word.push(current);
            }
            escaped = false;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            escaped = true;
            continue;
        }
        if let Some(active) = quote {
            if current == active {
                quote = None;
            } else {
                word.push(current);
            }
            continue;
        }
        if current == '\'' || current == '"' {
            quote = Some(current);
        } else if current.is_ascii_alphanumeric() || "_./~-".contains(current) {
            word.push(current);
        } else if !word.is_empty() {
            tokens.push(std::mem::take(&mut word));
        }
    }
    if !word.is_empty() {
        tokens.push(word);
    }
    tokens
}

fn removes_protected_root(tokens: &[String], cwd: &Path, backend: &ExecutionBackend) -> bool {
    let recursive = tokens
        .iter()
        .skip(1)
        .filter(|token| token.starts_with('-'))
        .any(|flags| {
            flags == "--recursive"
                || flags
                    .strip_prefix('-')
                    .is_some_and(|flags| flags.contains('r') || flags.contains('R'))
        });
    if !recursive {
        return false;
    }
    let workspace = lexical_normalize(&backend.default_terminal_cwd());
    tokens
        .iter()
        .skip(1)
        .filter(|token| !token.starts_with('-'))
        .map(Path::new)
        .map(|target| {
            if target.is_absolute() {
                lexical_normalize(target)
            } else {
                lexical_normalize(&cwd.join(target))
            }
        })
        .any(|target| {
            target == Path::new("/")
                || target == workspace
                || path_contains_component(&target, ".git")
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sandbox::ExecutionBackend;

    fn local(root: &Path) -> ExecutionBackend {
        ExecutionBackend::Local {
            workspace_cwd: root.to_path_buf(),
        }
    }

    fn broker_fixture() -> (PathBuf, Arc<PermissionBroker>) {
        let path = std::env::temp_dir()
            .join(format!("nac-permission-broker-{}", uuid::Uuid::new_v4()))
            .join("store.db");
        crate::store::initialize(&path).unwrap();
        crate::store::insert_test_session(&path, "session-a");
        let broker = Arc::new(PermissionBroker::new(
            path.clone(),
            "session-a".to_string(),
            PermissionBackend::Local,
            0,
            [],
        ));
        (path, broker)
    }

    #[test]
    fn wildcard_matching_and_last_rule_win() {
        assert!(wildcard_match("*.env.*", "/repo/.env.local"));
        assert!(wildcard_match(
            "command:[git][status]*",
            "command:[git][status][--short]"
        ));
        assert!(!wildcard_match("read", "edit"));

        let policy = PermissionPolicy::for_backend(
            PermissionBackend::Podman,
            [
                PermissionRule::new("read", "*", PermissionEffect::Deny),
                PermissionRule::new("read", "*/public/*", PermissionEffect::Allow),
            ],
        );
        assert_eq!(
            policy
                .evaluate(&[PermissionResource::new("read", "/repo/private/a")], &[])
                .effect,
            PermissionEffect::Deny
        );
        assert_eq!(
            policy
                .evaluate(&[PermissionResource::new("read", "/repo/public/a")], &[])
                .effect,
            PermissionEffect::Allow
        );
    }

    #[test]
    fn remembered_allow_satisfies_ask_but_not_configured_deny_or_hard_rule() {
        let policy = PermissionPolicy::for_backend(
            PermissionBackend::Local,
            [PermissionRule::new(
                "edit",
                "*/locked/*",
                PermissionEffect::Deny,
            )],
        );
        let grant = PermissionRule::new("edit", "*", PermissionEffect::Allow);
        assert_eq!(
            policy
                .evaluate(
                    &[PermissionResource::new("edit", "/repo/locked/a")],
                    std::slice::from_ref(&grant)
                )
                .effect,
            PermissionEffect::Deny
        );
        let hard = PermissionResource::new("edit", "/repo/a").with_hard_denial("protected target");
        let decision = policy.evaluate(&[hard], &[grant]);
        assert_eq!(decision.effect, PermissionEffect::Deny);
        assert_eq!(decision.hard_denial.as_deref(), Some("protected target"));
    }

    #[test]
    fn backend_defaults_are_pragmatic_without_changing_authority() {
        let safe = PermissionResource::new("execute", "command:[git][status][--short]");
        let arbitrary = PermissionResource::new("execute", "command:[curl][example.com]");
        assert_eq!(
            PermissionPolicy::for_backend(PermissionBackend::Local, [])
                .evaluate(std::slice::from_ref(&safe), &[])
                .effect,
            PermissionEffect::Allow
        );
        assert_eq!(
            PermissionPolicy::for_backend(PermissionBackend::Ssh, [])
                .evaluate(std::slice::from_ref(&arbitrary), &[])
                .effect,
            PermissionEffect::Ask
        );
        assert_eq!(
            PermissionPolicy::for_backend(PermissionBackend::Podman, [])
                .evaluate(&[arbitrary], &[])
                .effect,
            PermissionEffect::Allow
        );
        for action in ["execute_opaque", "execute_broad"] {
            assert_eq!(
                PermissionPolicy::for_backend(PermissionBackend::Podman, [])
                    .evaluate(&[PermissionResource::new(action, "command")], &[])
                    .effect,
                PermissionEffect::Ask,
                "Podman confinement must not silently authorize {action}"
            );
        }
    }

    #[test]
    fn file_projection_adds_external_guard_and_hard_protects_metadata_and_store() {
        let root = PathBuf::from("/workspace");
        let backend = local(&root);
        let outside_path = PathBuf::from("/else/file");
        let outside = file_resources(
            "read",
            outside_path.clone(),
            &backend,
            Path::new("/state/store.db"),
            false,
        );
        assert_eq!(outside[1].action, "external_directory");
        assert_eq!(outside[1].save_resource.as_deref(), outside_path.to_str());

        let git = file_resources(
            "edit",
            root.join(".git/config"),
            &backend,
            Path::new("/state/store.db"),
            true,
        );
        assert!(git[0].hard_denial.is_some());
        let store = file_resources(
            "edit",
            PathBuf::from("/state/store.db-wal"),
            &backend,
            Path::new("/state/store.db"),
            true,
        );
        assert!(store[0].hard_denial.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn local_file_projection_resolves_symlinks_and_nonexistent_final_targets() {
        use std::os::unix::fs::symlink;

        let base =
            std::env::temp_dir().join(format!("nac-permission-links-{}", uuid::Uuid::new_v4()));
        let workspace = base.join("workspace");
        let external = base.join("external");
        std::fs::create_dir_all(workspace.join(".git")).unwrap();
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("secret"), "secret").unwrap();
        let store = external.join("store.db");
        std::fs::write(&store, "store").unwrap();
        symlink(&external, workspace.join("outside-link")).unwrap();
        symlink(workspace.join(".git"), workspace.join("git-link")).unwrap();
        symlink(&store, workspace.join("store-link")).unwrap();
        let backend = local(&workspace);
        let canonical_external = external.canonicalize().unwrap();

        let outside = file_resources(
            "read",
            workspace.join("outside-link/secret"),
            &backend,
            &store,
            false,
        );
        assert!(outside.iter().any(|resource| {
            resource.action == "external_directory"
                && resource.resource == canonical_external.join("secret").display().to_string()
        }));

        let nonexistent = file_resources(
            "edit",
            workspace.join("outside-link/new-file"),
            &backend,
            &store,
            true,
        );
        assert!(nonexistent.iter().any(|resource| {
            resource.action == "external_directory"
                && resource.resource == canonical_external.join("new-file").display().to_string()
        }));

        let git = file_resources(
            "edit",
            workspace.join("git-link/config"),
            &backend,
            &store,
            true,
        );
        assert!(git[0].hard_denial.is_some());
        let rm_git_alias = shell_resources("rm -f git-link/config", &workspace, &backend);
        assert!(rm_git_alias
            .iter()
            .any(|resource| { resource.action == "edit" && resource.hard_denial.is_some() }));
        let active_store =
            file_resources("edit", workspace.join("store-link"), &backend, &store, true);
        assert!(active_store[0].hard_denial.is_some());

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn shell_projection_tokenizes_segments_and_never_generalizes_opaque_or_banned_commands() {
        let backend = local(Path::new("/workspace"));
        let resources = shell_resources(
            "git status --short && cargo test -p nac-core",
            Path::new("/workspace"),
            &backend,
        );
        assert_eq!(resources.len(), 3);
        assert_eq!(resources[0].resource, "command:[git][status][--short]");
        assert_eq!(
            resources[0].save_resource.as_deref(),
            Some("command:[git][status]*")
        );
        assert_eq!(resources[2].action, "execute_cwd");

        let opaque = shell_resources("bash -c '$(dynamic)'", Path::new("/workspace"), &backend);
        assert!(opaque[0].resource.starts_with("opaque:sha256:"));
        assert!(opaque[0].save_resource.is_none());
        assert_eq!(opaque[1].action, "execute_opaque");
        let removal = shell_resources("rm -rf target", Path::new("/workspace"), &backend);
        assert_eq!(
            removal[0].save_resource.as_deref(),
            Some("command:[rm][-rf][target]")
        );
        assert_eq!(
            shell_resources("/usr/bin/python -c pass", Path::new("/workspace"), &backend)[0]
                .save_resource
                .as_deref(),
            Some("command:[/usr/bin/python][-c][pass]")
        );
        for command in ["echo $HOME", "cargo test > /tmp/result", "cat < input"] {
            let opaque = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(opaque[0].resource.starts_with("opaque:sha256:"));
            assert!(opaque[0].save_resource.is_none());
        }
    }

    #[test]
    fn hard_shell_policy_blocks_authority_amplification_and_broad_deletion_only() {
        let backend = local(Path::new("/workspace"));
        assert!(
            shell_resources("sudo make install", Path::new("/workspace"), &backend)[0]
                .hard_denial
                .is_some()
        );
        assert!(
            shell_resources("rm -rf .", Path::new("/workspace"), &backend)[0]
                .hard_denial
                .is_some()
        );
        assert!(
            shell_resources("rm -rf target", Path::new("/workspace"), &backend)[0]
                .hard_denial
                .is_none()
        );
        assert!(
            shell_resources("git reset --hard", Path::new("/workspace"), &backend)[0]
                .hard_denial
                .is_some()
        );
        assert!(shell_resources(
            "git -C /workspace reset --hard",
            Path::new("/workspace"),
            &backend
        )[0]
        .hard_denial
        .is_some());
        for command in [
            "command sudo make install",
            "command -- sudo make install",
            "env MODE=test sudo make install",
            "env -u SAFE sudo make install",
            "env -a nac-rm rm -rf .",
            "env --argv0=nac-rm rm -rf .",
            "exec -a installer sudo make install",
            "nice -n 1 sudo make install",
            "nice --adjustment 0 rm -rf .",
            "timeout 30 rm -rf .",
            "timeout --kill-after 1 30 rm -rf .",
            "setsid rm -rf .",
            "stdbuf -oL rm -rf .",
            "busybox rm -rf /workspace",
            "sudo make install > /tmp/result",
            "git checkout .",
            "git -c alias.pwn='!git reset --hard' pwn",
            "git -calias.pwn='!sudo id' pwn",
            "git -c include.path=.nac-alias pwn",
            "git -cincludeIf.onbranch:main.path=.nac-alias pwn",
            "git --config-env=alias.pwn=ALIAS pwn",
            "git --config-env alias.pwn=ALIAS pwn",
            "GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.pwn GIT_CONFIG_VALUE_0='!git reset --hard' git pwn",
            "env GIT_CONFIG_GLOBAL=.nac-alias git pwn",
            "sh -c 'git reset --hard'",
            "bash -lc 'sudo make install'",
            "bash --rcfile /dev/null -c 'sudo make install'",
            "env -S 'sudo make install'",
            "env -S'sudo make install'",
            "env -Sgit reset --hard",
            "env --split-string='sudo make install'",
            "env --split-string='sudo\\_id'",
            "env \"-Sgit\\_reset\\_--hard\"",
            "env --split-string='${PROTECTED_COMMAND} id'",
            "env -S 'unlink .git/config'",
            "env -S 'rmdir .git/empty'",
            "xargs -n1 sudo true",
            "xargs sh -c",
            "xargs --unknown-option value",
            "find . -exec sudo true \\;",
            "rg --pre sudo needle .",
            "rg --pre=sudo needle .",
            "script -q /dev/null rm -rf .",
            "script -q -c 'rm -rf .' /dev/null",
            "flock Cargo.lock unlink .git/config",
            "git re\\\nset --hard",
            "sh -c 'git reset --hard' > /tmp/result",
            "sh -c 'unlink .git/config'",
            "bash -lc 'sudo make install' > /tmp/result",
            "! git status",
            "! git reset --hard",
            "{ git reset --hard; }",
            "if true; then git reset --hard; fi",
            "! rm -rf $PWD",
            "{ rm -rf $PWD; }",
            "true; ! rm -rf $PWD",
            "true\n! rm -rf $PWD",
            "# harmless\n! rm -rf $PWD",
            ": && ! rm -rf $PWD",
            "time ! rm -rf $PWD",
            "time -p ! rm -rf $PWD",
            "/usr/bin/time -o /tmp/nac-time rm -rf \"$PWD\"",
            "time --format=%e --output /tmp/nac-time rm -rf \"$PWD\"",
            "coproc rm -rf /workspace",
            "rm -rf \"$PWD\"",
            "env MODE=test rm -rf \"$PWD\"",
            "sh -c 'rm -rf \"$PWD\"'",
            "\\\n! rm -rf $PWD",
            "true; { rm -rf $PWD; }",
            "( ! rm -rf $PWD )",
            ": > /tmp/nac-map; ! rm -rf $PWD",
            "printf x | { rm -rf $PWD; }",
            "echo $( ! rm -rf $PWD )",
            "find . -delete",
            "xargs rm -rf .git",
            "sh -c 'rm -rf .git'",
            "eval 'rm -rf .'",
            "{rm,-rf} .",
            "[r]m -rf .",
            "rm -rf .g*",
            "unlink .g*/config",
            "rmdir .g*/empty",
            "x=; c=r${x}m; \"$c\" -rf .",
        ] {
            assert!(
                shell_resources(command, Path::new("/workspace"), &backend)[0]
                    .hard_denial
                    .is_some(),
                "wrapper or opaque syntax must not bypass hard denial: {command}"
            );
        }

        let negated_status = shell_resources("! git status", Path::new("/workspace"), &backend);
        assert_eq!(
            negated_status[0].save_resource.as_deref(),
            Some("command:[%21][git][status]")
        );

        for command in [
            "ifx true",
            "functionality --help",
            "printf '! rm -rf $PWD'",
            "echo '{ rm -rf $PWD; }'",
            "printf '%s' '!'",
            "true && printf '!'",
            "[[x --help",
            "casefold --help",
            "!foo rm -rf $PWD",
            "printf '%s' 'rm -rf $PWD'",
            "/usr/bin/time -o /tmp/nac-time printf '%s' 'rm -rf $PWD'",
            "timeout 30 printf '%s' 'rm -rf $PWD'",
            "env -a harmless printf '%s' 'rm -rf $PWD'",
            "nice --adjustment 0 printf '%s' 'rm -rf $PWD'",
            "[ -f file ]",
            "printf '%s\\n' {rm,-rf} .",
            "printf '%s\\n' .g*",
        ] {
            assert!(
                shell_resources(command, Path::new("/workspace"), &backend)[0]
                    .hard_denial
                    .is_none(),
                "data or a keyword prefix must not be mistaken for shell control: {command}"
            );
        }

        for command in [
            "GIT_CONFIG_COUNT=1 Git status",
            "RG --pre=sudo needle .",
            "Cargo build --config=build.rustc-wrapper=wrapper",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(
                resources
                    .iter()
                    .any(|resource| resource.hard_denial.is_some())
                    || resources
                        .iter()
                        .any(|resource| resource.action == "execute_broad"),
                "specialized authority recognition must be case-insensitive: {command}"
            );
        }

        let harmless = shell_resources(
            "env '-Sgit_reset_--hard'",
            Path::new("/workspace"),
            &backend,
        );
        let escaped = shell_resources(
            "env \"-Sgit\\_reset\\_--hard\"",
            Path::new("/workspace"),
            &backend,
        );
        assert_ne!(harmless[0].resource, escaped[0].resource);
        assert!(harmless[0].hard_denial.is_some());
        assert!(escaped[0].hard_denial.is_some());

        assert!(shell_resources(
            "env --split-string='printf\\qok'",
            Path::new("/workspace"),
            &backend,
        )[0]
        .hard_denial
        .is_some());
        let mut nested = "true".to_string();
        for _ in 0..9 {
            nested = format!("env -S {}", shell_quote(&nested));
        }
        assert!(
            shell_resources(&nested, Path::new("/workspace"), &backend)[0]
                .hard_denial
                .is_some()
        );

        let preprocessor = shell_resources(
            "rg --pre sh needle input.txt",
            Path::new("/workspace"),
            &backend,
        );
        assert!(preprocessor
            .iter()
            .any(|resource| resource.action == "execute_broad"));
        assert!(preprocessor
            .iter()
            .any(|resource| resource.hard_denial.is_some()));
        for command in [
            "env -S 'sh -c id'".to_string(),
            format!("env -S {}", shell_quote("env -S 'sh -c id'")),
        ] {
            assert!(
                shell_resources(&command, Path::new("/workspace"), &backend)
                    .iter()
                    .any(|resource| resource.action == "execute_broad"),
                "split-string interpreter must retain broad authority: {command}"
            );
        }
        assert!(shell_resources(
            "printf x | xargs -n1 sudo true",
            Path::new("/workspace"),
            &backend,
        )
        .iter()
        .any(|resource| resource.hard_denial.is_some()));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn command_workdir_is_canonicalized_before_policy() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!(
            "nac-command-workdir-permission-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = base.join("workspace");
        let outside = base.join("outside");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        symlink(&outside, workspace.join("link")).unwrap();
        let backend = local(&workspace);
        let projected = shell_resources("rg needle", &workspace.join("link"), &backend);
        let canonical = canonicalize_authorization_resources(&projected, &backend, Path::new(""))
            .await
            .unwrap();
        assert!(canonical.iter().any(|resource| {
            resource.action == "execute_cwd"
                && resource.resource == outside.canonicalize().unwrap().display().to_string()
        }));
        assert!(canonical.iter().any(|resource| {
            resource.action == "external_directory"
                && resource.resource == outside.canonicalize().unwrap().display().to_string()
        }));
        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rm_binding_preserves_a_final_symlink_instead_of_deleting_its_target() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!("nac-rm-final-link-{}", uuid::Uuid::new_v4()));
        let workspace = base.join("workspace");
        let external = base.join("external");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&external).unwrap();
        symlink(&external, workspace.join("link")).unwrap();
        let backend = local(&workspace);
        let command = "rm -rf link";
        let projected = shell_resources(command, &workspace, &backend);
        let authorized = canonicalize_authorization_resources(
            &projected,
            &backend,
            Path::new("/unrelated/store.db"),
        )
        .await
        .unwrap();
        assert!(authorized.iter().any(|resource| {
            resource.action == "edit"
                && resource.resource
                    == workspace
                        .canonicalize()
                        .unwrap()
                        .join("link")
                        .display()
                        .to_string()
        }));
        let bound =
            bind_authorized_shell_command(command, &workspace.canonicalize().unwrap(), &authorized)
                .unwrap();
        assert_eq!(
            bound,
            format!(
                "rm -rf {}",
                workspace.canonicalize().unwrap().join("link").display()
            )
        );
        assert!(!bound.ends_with(external.canonicalize().unwrap().to_str().unwrap()));

        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn rm_final_symlink_keeps_requested_git_path_hard_denial() {
        use std::os::unix::fs::symlink;

        let base =
            std::env::temp_dir().join(format!("nac-rm-git-final-link-{}", uuid::Uuid::new_v4()));
        let workspace = base.join("workspace");
        let external = base.join("external-file");
        std::fs::create_dir_all(workspace.join(".git")).unwrap();
        std::fs::write(&external, "outside").unwrap();
        symlink(&external, workspace.join(".git/escape")).unwrap();
        let backend = local(&workspace);
        let command = "rm -f .git/escape";
        let projected = shell_resources(command, &workspace, &backend);
        let authorized = canonicalize_authorization_resources(
            &projected,
            &backend,
            Path::new("/unrelated/store.db"),
        )
        .await
        .unwrap();
        let requested = workspace.canonicalize().unwrap().join(".git/escape");
        let deletion = authorized
            .iter()
            .find(|resource| resource.action == "edit")
            .expect("rm deletion resource");
        assert_eq!(deletion.resource, requested.display().to_string());
        assert!(deletion.hard_denial.is_some());
        assert_eq!(
            deletion.shell_binding.as_deref(),
            Some(requested.to_str().unwrap())
        );
        let bound =
            bind_authorized_shell_command(command, &workspace.canonicalize().unwrap(), &authorized)
                .unwrap();
        assert_eq!(bound, format!("rm -f {}", requested.display()));
        assert!(!bound.contains(external.canonicalize().unwrap().to_str().unwrap()));

        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn unlink_and_rmdir_preserve_named_entries_and_git_mutation_policy() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!(
            "nac-delete-entry-permission-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = base.join("workspace");
        let external = base.join("external");
        std::fs::create_dir_all(workspace.join(".git")).unwrap();
        std::fs::create_dir_all(&external).unwrap();
        std::fs::write(external.join("config"), "outside").unwrap();
        symlink(&external, workspace.join(".git/link")).unwrap();
        let backend = local(&workspace);

        for command in ["unlink .git/link", "rmdir .git/link"] {
            let projected = shell_resources(command, &workspace, &backend);
            let authorized = canonicalize_authorization_resources(
                &projected,
                &backend,
                Path::new("/unrelated/store.db"),
            )
            .await
            .unwrap();
            let requested = workspace.canonicalize().unwrap().join(".git/link");
            let deletion = authorized
                .iter()
                .find(|resource| resource.action == "edit")
                .expect("deletion resource");
            assert_eq!(deletion.resource, requested.display().to_string());
            assert!(deletion.hard_denial.is_some());
            assert_eq!(
                deletion.shell_binding.as_deref(),
                Some(requested.to_str().unwrap())
            );
            let bound = bind_authorized_shell_command(
                command,
                &workspace.canonicalize().unwrap(),
                &authorized,
            )
            .unwrap();
            assert_eq!(
                bound,
                format!(
                    "{} {}",
                    command.split_whitespace().next().unwrap(),
                    requested.display()
                )
            );
            assert!(!bound.contains(external.canonicalize().unwrap().to_str().unwrap()));
        }

        let _ = std::fs::remove_dir_all(base);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn bare_relative_command_paths_are_canonicalized_and_bound_into_the_command() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!(
            "nac-command-path-permission-{}",
            uuid::Uuid::new_v4()
        ));
        let workspace = base.join("workspace");
        let outside = base.join("outside");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret"), "needle").unwrap();
        std::fs::write(outside.join("tool"), "#!/bin/sh\n").unwrap();
        std::fs::write(workspace.join("local"), "needle").unwrap();
        symlink(&outside, workspace.join("outside-link")).unwrap();
        let backend = local(&workspace);
        let projected = shell_resources("rg needle outside-link/secret", &workspace, &backend);
        let canonical = canonicalize_authorization_resources(&projected, &backend, Path::new(""))
            .await
            .unwrap();
        let canonical_secret = outside.canonicalize().unwrap().join("secret");
        assert!(canonical.iter().any(|resource| {
            resource.action == "execute_path"
                && resource.resource == canonical_secret.display().to_string()
        }));
        assert!(canonical.iter().any(|resource| {
            resource.action == "external_directory"
                && resource.resource == canonical_secret.display().to_string()
        }));

        let bound = bind_authorized_shell_command(
            "rg needle outside-link/secret",
            &workspace.canonicalize().unwrap(),
            &canonical,
        )
        .unwrap();
        assert_eq!(bound, format!("rg needle {}", canonical_secret.display()));
        assert!(!bound.contains("outside-link"));

        let empty_pattern_projected =
            shell_resources("rg '' outside-link/secret", &workspace, &backend);
        let empty_pattern_canonical =
            canonicalize_authorization_resources(&empty_pattern_projected, &backend, Path::new(""))
                .await
                .unwrap();
        assert!(empty_pattern_canonical.iter().any(|resource| {
            resource.action == "execute_path"
                && resource.resource == canonical_secret.display().to_string()
        }));
        assert_eq!(
            bind_authorized_shell_command(
                "rg '' outside-link/secret",
                &workspace.canonicalize().unwrap(),
                &empty_pattern_canonical,
            )
            .unwrap(),
            format!("rg '' {}", canonical_secret.display())
        );

        let directory_projected =
            shell_resources("rg -L needle outside-link", &workspace, &backend);
        let directory_canonical =
            canonicalize_authorization_resources(&directory_projected, &backend, Path::new(""))
                .await
                .unwrap();
        let canonical_outside = outside.canonicalize().unwrap();
        assert!(directory_canonical.iter().any(|resource| {
            resource.action == "execute_path"
                && resource.resource == canonical_outside.display().to_string()
        }));
        assert_eq!(
            bind_authorized_shell_command(
                "rg -L needle outside-link",
                &workspace.canonicalize().unwrap(),
                &directory_canonical,
            )
            .unwrap(),
            format!("rg -L needle {}", canonical_outside.display())
        );

        let cargo_manifest = outside.join("Cargo.toml");
        std::fs::write(
            &cargo_manifest,
            "[package]\nname='outside'\nversion='0.1.0'\n",
        )
        .unwrap();
        let cargo_command = "cargo build --manifest-path=outside-link/Cargo.toml";
        let cargo_projected = shell_resources(cargo_command, &workspace, &backend);
        let cargo_canonical =
            canonicalize_authorization_resources(&cargo_projected, &backend, Path::new(""))
                .await
                .unwrap();
        assert!(cargo_canonical.iter().any(|resource| {
            resource.action == "external_directory"
                && resource
                    .resource
                    .starts_with(canonical_outside.to_str().unwrap())
        }));
        assert_eq!(
            bind_authorized_shell_command(
                cargo_command,
                &workspace.canonicalize().unwrap(),
                &cargo_canonical,
            )
            .unwrap(),
            format!(
                "cargo build --manifest-path={}",
                cargo_manifest.canonicalize().unwrap().display()
            )
        );

        let git_projected = shell_resources(
            "git diff --no-index local outside-link/secret",
            &workspace,
            &backend,
        );
        let git_canonical =
            canonicalize_authorization_resources(&git_projected, &backend, Path::new(""))
                .await
                .unwrap();
        let canonical_local = workspace.canonicalize().unwrap().join("local");
        assert_eq!(
            bind_authorized_shell_command(
                "git diff --no-index local outside-link/secret",
                &workspace.canonicalize().unwrap(),
                &git_canonical,
            )
            .unwrap(),
            format!(
                "git diff --no-index {} {}",
                canonical_local.display(),
                canonical_secret.display()
            )
        );

        let executable_projected = shell_resources("./outside-link/tool", &workspace, &backend);
        let executable_canonical =
            canonicalize_authorization_resources(&executable_projected, &backend, Path::new(""))
                .await
                .unwrap();
        let canonical_tool = canonical_outside.join("tool");
        assert_eq!(
            bind_authorized_shell_command(
                "./outside-link/tool",
                &workspace.canonicalize().unwrap(),
                &executable_canonical,
            )
            .unwrap(),
            canonical_tool.display().to_string()
        );

        let slash_executable_projected = shell_resources("outside-link/tool", &workspace, &backend);
        let slash_executable_canonical = canonicalize_authorization_resources(
            &slash_executable_projected,
            &backend,
            Path::new(""),
        )
        .await
        .unwrap();
        assert_eq!(
            bind_authorized_shell_command(
                "outside-link/tool",
                &workspace.canonicalize().unwrap(),
                &slash_executable_canonical,
            )
            .unwrap(),
            canonical_tool.display().to_string()
        );

        let repo = workspace.join("repo");
        std::fs::create_dir_all(&repo).unwrap();
        std::fs::write(repo.join("local"), "needle").unwrap();
        symlink(&outside, repo.join("outside-link")).unwrap();
        let git_global_projected = shell_resources(
            "git -C repo diff --no-index local outside-link/secret",
            &workspace,
            &backend,
        );
        let git_global_canonical =
            canonicalize_authorization_resources(&git_global_projected, &backend, Path::new(""))
                .await
                .unwrap();
        let canonical_repo = repo.canonicalize().unwrap();
        assert_eq!(
            bind_authorized_shell_command(
                "git -C repo diff --no-index local outside-link/secret",
                &workspace.canonicalize().unwrap(),
                &git_global_canonical,
            )
            .unwrap(),
            format!(
                "git -C {} diff --no-index {} {}",
                canonical_repo.display(),
                canonical_repo.join("local").display(),
                canonical_secret.display()
            )
        );

        let nested = repo.join("nested");
        std::fs::create_dir_all(&nested).unwrap();
        let repeated_c = shell_resources("git -C repo -C nested status", &workspace, &backend);
        let repeated_c = canonicalize_authorization_resources(&repeated_c, &backend, Path::new(""))
            .await
            .unwrap();
        assert_eq!(
            bind_authorized_shell_command(
                "git -C repo -C nested status",
                &workspace.canonicalize().unwrap(),
                &repeated_c,
            )
            .unwrap(),
            format!(
                "git -C {} -C {} status",
                canonical_repo.display(),
                nested.canonicalize().unwrap().display()
            )
        );

        let attached_c_command = "git -Coutside-link status";
        let attached_c = shell_resources(attached_c_command, &workspace, &backend);
        let attached_c = canonicalize_authorization_resources(&attached_c, &backend, Path::new(""))
            .await
            .unwrap();
        assert!(attached_c.iter().any(|resource| {
            resource.action == "external_directory"
                && resource.resource == canonical_outside.display().to_string()
        }));
        assert_eq!(
            bind_authorized_shell_command(
                attached_c_command,
                &workspace.canonicalize().unwrap(),
                &attached_c,
            )
            .unwrap(),
            format!("git -C{} status", canonical_outside.display())
        );

        let git_dir_command = "git --git-dir=outside-link/repo/.git status";
        let git_dir = shell_resources(git_dir_command, &workspace, &backend);
        let git_dir = canonicalize_authorization_resources(&git_dir, &backend, Path::new(""))
            .await
            .unwrap();
        assert!(git_dir.iter().any(|resource| {
            resource.action == "external_directory"
                && resource
                    .resource
                    .starts_with(canonical_outside.to_str().unwrap())
        }));
        assert_eq!(
            bind_authorized_shell_command(
                git_dir_command,
                &workspace.canonicalize().unwrap(),
                &git_dir,
            )
            .unwrap(),
            format!(
                "git --git-dir={} status",
                canonical_outside.join("repo/.git").display()
            )
        );

        let work_tree_command = "git -C repo --work-tree outside-link status";
        let work_tree = shell_resources(work_tree_command, &workspace, &backend);
        let work_tree = canonicalize_authorization_resources(&work_tree, &backend, Path::new(""))
            .await
            .unwrap();
        assert_eq!(
            bind_authorized_shell_command(
                work_tree_command,
                &workspace.canonicalize().unwrap(),
                &work_tree,
            )
            .unwrap(),
            format!(
                "git -C {} --work-tree {} status",
                canonical_repo.display(),
                canonical_outside.display()
            )
        );

        for command in [
            "git grep -C2 needle",
            "git diff -C50%",
            "git grep -C 2 needle",
        ] {
            let resources = shell_resources(command, &workspace, &backend);
            let bound = bind_authorized_shell_command(command, &workspace, &resources).unwrap();
            assert_eq!(bound, command, "subcommand -C value must remain data");
        }
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn broad_commands_and_shell_path_arguments_project_independent_guards() {
        let backend = local(Path::new("/workspace"));
        let broad = shell_resources(
            "env MODE=test bash -c true",
            Path::new("/workspace"),
            &backend,
        );
        assert!(broad
            .iter()
            .any(|resource| resource.action == "execute_broad"));
        assert_eq!(
            broad[0].save_resource.as_deref(),
            Some(broad[0].resource.as_str())
        );

        for command in [
            "rg needle /outside/.env",
            "cargo test --manifest-path /outside/Cargo.toml",
            "cargo build --config /outside/cargo-config.toml",
            "make -f /outside/Makefile",
            "git diff --no-index /workspace/a /outside/b",
            "git diff --output=/outside/diff.txt",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(resources
                .iter()
                .any(|resource| { matches!(resource.action.as_str(), "execute_path" | "edit") }));
            assert!(
                resources.iter().any(|resource| {
                    resource.action == "external_directory"
                        && resource.resource.starts_with("/outside")
                }),
                "external command path must be independently authorized: {command}"
            );
        }

        let protected_output = shell_resources(
            "git diff --no-index --output=.git/config README.md Cargo.toml",
            Path::new("/workspace"),
            &backend,
        );
        assert!(protected_output
            .iter()
            .any(|resource| resource.action == "edit" && resource.hard_denial.is_some()));

        let cargo_key_value = "cargo build --config net.git-fetch-with-cli=true";
        let cargo_key_value_resources =
            shell_resources(cargo_key_value, Path::new("/workspace"), &backend);
        assert!(!cargo_key_value_resources
            .iter()
            .any(|resource| matches!(resource.action.as_str(), "execute_path" | "edit")));
        assert_eq!(
            bind_authorized_shell_command(
                cargo_key_value,
                Path::new("/workspace"),
                &cargo_key_value_resources,
            )
            .unwrap(),
            cargo_key_value
        );
        assert!(cargo_key_value_resources
            .iter()
            .any(|resource| resource.action == "execute_broad"));

        let attached_cargo_key_value = "cargo build --config=net.git-fetch-with-cli=true";
        let attached_cargo_key_value_resources =
            shell_resources(attached_cargo_key_value, Path::new("/workspace"), &backend);
        assert!(!attached_cargo_key_value_resources
            .iter()
            .any(|resource| matches!(resource.action.as_str(), "execute_path" | "edit")));
        assert!(attached_cargo_key_value_resources
            .iter()
            .any(|resource| resource.action == "execute_broad"));
        assert_eq!(
            bind_authorized_shell_command(
                attached_cargo_key_value,
                Path::new("/workspace"),
                &attached_cargo_key_value_resources,
            )
            .unwrap(),
            attached_cargo_key_value
        );

        let executable_config = shell_resources(
            "cargo build --config 'build.rustc-wrapper=\"/outside/wrapper\"'",
            Path::new("/workspace"),
            &backend,
        );
        assert!(executable_config
            .iter()
            .any(|resource| resource.action == "execute_broad"));

        for command in [
            "cargo build --config .cargo/authority.toml",
            "cargo build --config=.cargo/authority.toml",
            "Cargo build --config=.cargo/authority.toml",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(
                resources
                    .iter()
                    .any(|resource| resource.action == "execute_broad"),
                "Cargo configuration files can carry executable settings: {command}"
            );
        }

        for command in [
            "cargo build --target-dir=.git/nac-target",
            "cargo test --target-dir .git/nac-target",
            "cargo build --lockfile-path=.git/nac-lock",
            "Cargo build --target-dir=.git/nac-target",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(
                resources.iter().any(|resource| {
                    resource.action == "edit" && resource.hard_denial.is_some()
                }),
                "Cargo output paths beneath Git metadata must be blocked: {command}"
            );
        }

        for command in [
            "tee .git/nac-owned",
            "touch .git/nac-owned",
            "dd if=/dev/null of=.git/nac-owned",
            "sed -i s/a/b/ .git/config",
            "rm -f .git/config",
            "unzip archive.zip -d .git/hooks",
            "wget https://example.invalid/config -O .git/config",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(resources
                .iter()
                .any(|resource| { resource.action == "edit" && resource.hard_denial.is_some() }));
        }
        for command in [
            "rm -f Cargo.toml",
            "rm -f src/lib.rs",
            "rm -f -- Cargo.lock",
            "rm README.md Cargo.toml",
            "rm -f .gitconfig",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(
                resources.iter().any(|resource| resource.action == "edit"),
                "every rm operand must project as a mutation: {command}"
            );
        }
        assert!(shell_resources(
            "printf pwned > .git/nac-owned",
            Path::new("/workspace"),
            &backend,
        )[0]
        .hard_denial
        .is_some());

        let git_status = shell_resources("git -C repo status", Path::new("/workspace"), &backend);
        let git_status_save = git_status[0]
            .save_resource
            .as_deref()
            .expect("Git status should have a remembered prefix");
        assert_eq!(git_status_save, "command:[git][-C][repo][status]*");
        assert!(!wildcard_match(
            git_status_save,
            &canonical_command(&[
                "git".to_string(),
                "-C".to_string(),
                "repo".to_string(),
                "config".to_string(),
                "nac.review".to_string(),
                "pwned".to_string(),
            ])
        ));
        let incomplete_git = shell_resources("git -C repo", Path::new("/workspace"), &backend);
        assert_eq!(
            incomplete_git[0].save_resource.as_deref(),
            Some(incomplete_git[0].resource.as_str())
        );

        let formatting = "rg -n --field-match-separator=a/b needle .";
        let formatting_resources = shell_resources(formatting, Path::new("/workspace"), &backend);
        assert!(!formatting_resources.iter().any(|resource| {
            resource.action == "execute_path" && resource.resource.ends_with("/a/b")
        }));
        let formatting_bound = bind_authorized_shell_command(
            formatting,
            Path::new("/workspace"),
            &formatting_resources,
        )
        .unwrap();
        assert!(formatting_bound.contains("--field-match-separator=a/b"));
        assert!(!formatting_bound.contains("--field-match-separator=/workspace/a/b"));

        let separated_formatting = "rg needle --field-match-separator a/b .";
        let separated_resources =
            shell_resources(separated_formatting, Path::new("/workspace"), &backend);
        let separated_bound = bind_authorized_shell_command(
            separated_formatting,
            Path::new("/workspace"),
            &separated_resources,
        )
        .unwrap();
        assert!(separated_bound.contains("--field-match-separator a/b"));
        assert!(!separated_bound.contains("--field-match-separator /workspace/a/b"));

        let env_split = shell_resources("env -S 'printf ok'", Path::new("/workspace"), &backend);
        assert!(!env_split[0]
            .save_resource
            .as_deref()
            .expect("env split-string should have an exact save resource")
            .ends_with('*'));
    }

    #[tokio::test]
    async fn headless_ask_fails_closed_without_creating_a_waiter() {
        let (path, broker) = broker_fixture();
        let outcome = broker
            .authorize(
                "exec_command",
                &[PermissionResource::new(
                    "execute",
                    "command:[curl][example.com]",
                )],
                &crate::tools::kernel::ToolCallContext::default(),
                &crate::tools::ThreadCancellation::default(),
            )
            .await;
        assert!(
            matches!(outcome, AuthorizationOutcome::Denied(reason) if reason.contains("no interactive"))
        );
        assert!(broker.pending().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn delegated_child_allows_its_parent_ui_time_to_connect_and_reply() {
        let (path, broker) = broker_fixture();
        crate::store::insert_test_session(&path, "parent");
        crate::store::open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent', 'session-a')",
                [],
            )
            .unwrap();
        crate::store::create_traditional_child_relationship(
            &path,
            "parent",
            "session-a",
            crate::store::GENERAL_CHILD_PROFILE,
            "approval bridge",
        )
        .unwrap();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        broker.attach_event_bus(bus.clone());
        let authorize = {
            let broker = Arc::clone(&broker);
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[PermissionResource::new(
                            "execute",
                            "command:[curl][example.com]",
                        )],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().pop().expect("deferred child approval");
        let _parent_ui = bus.subscribe_assistant_deltas();
        broker.reply(&request.id, PermissionReply::Once).unwrap();
        assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn interactive_once_releases_exact_waiting_call_without_saving() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let authorize = {
            let broker = Arc::clone(&broker);
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[PermissionResource::new(
                            "execute",
                            "command:[curl][example.com]",
                        )],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().pop().expect("pending approval");
        broker.reply(&request.id, PermissionReply::Once).unwrap();
        assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
        assert!(broker.grants().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn cancellation_dismisses_the_live_prompt_and_waiting_call() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let mut events = bus.subscribe();
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let cancellation = crate::tools::ThreadCancellation::default();
        let authorize = {
            let broker = Arc::clone(&broker);
            let cancellation = cancellation.clone();
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[PermissionResource::new(
                            "execute",
                            "command:[curl][example.com]",
                        )],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &cancellation,
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        cancellation.cancel();
        assert!(matches!(
            authorize.await.unwrap(),
            AuthorizationOutcome::Denied(reason) if reason.contains("cancelled")
        ));
        assert!(broker.pending().is_empty());
        assert!(matches!(
            events.recv().await.unwrap().event,
            crate::events::SessionEvent::PermissionAsked { .. }
        ));
        assert!(matches!(
            events.recv().await.unwrap().event,
            crate::events::SessionEvent::PermissionDismissed { reason, .. }
                if reason.contains("cancelled")
        ));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn aborting_authorization_dismisses_prompt_before_any_stale_grant_reply() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let authorize = {
            let broker = Arc::clone(&broker);
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[
                            PermissionResource::new("execute", "command:[curl][example.com]")
                                .with_save_resource("command:[curl]*"),
                        ],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().pop().expect("pending approval");
        authorize.abort();
        let _ = authorize.await;
        assert!(broker.pending().is_empty());
        assert!(broker.reply(&request.id, PermissionReply::Always).is_err());
        assert!(broker.grants().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn losing_the_sole_interactive_subscriber_dismisses_approval_prompt() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let mut events = bus.subscribe();
        let interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let authorize = {
            let broker = Arc::clone(&broker);
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[PermissionResource::new(
                            "execute",
                            "command:[curl][example.com]",
                        )],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        assert_eq!(broker.pending().len(), 1);
        drop(interactive);
        let outcome = tokio::time::timeout(Duration::from_secs(1), authorize)
            .await
            .expect("disconnect must not leave a ten-minute waiter")
            .unwrap();
        assert!(matches!(
            outcome,
            AuthorizationOutcome::Denied(reason) if reason.contains("disconnected")
        ));
        assert!(broker.pending().is_empty());
        assert!(matches!(
            events.recv().await.unwrap().event,
            crate::events::SessionEvent::PermissionAsked { .. }
        ));
        assert!(matches!(
            events.recv().await.unwrap().event,
            crate::events::SessionEvent::PermissionDismissed { reason, .. }
                if reason.contains("disconnected")
        ));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn claimed_always_reply_wins_over_later_cancellation() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let cancellation = crate::tools::ThreadCancellation::default();
        let resources = vec![
            PermissionResource::new("execute", "command:[curl][example.com]")
                .with_save_resource("command:[curl][example.com]*"),
            PermissionResource::new("read", "/outside/Cargo.toml")
                .with_save_resource("/outside/Cargo.toml"),
        ];
        let authorize = {
            let broker = Arc::clone(&broker);
            let cancellation = cancellation.clone();
            let resources = resources.clone();
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &resources,
                        &crate::tools::kernel::ToolCallContext::default(),
                        &cancellation,
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().pop().expect("pending approval");

        let lock = rusqlite::Connection::open(&path).unwrap();
        lock.busy_timeout(Duration::from_secs(5)).unwrap();
        lock.execute_batch("BEGIN IMMEDIATE").unwrap();
        let reply = {
            let broker = Arc::clone(&broker);
            tokio::task::spawn_blocking(move || broker.reply(&request.id, PermissionReply::Always))
        };
        tokio::time::timeout(Duration::from_secs(1), async {
            while !broker.pending().is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("reply must claim the pending request before persistence");
        cancellation.cancel();
        lock.execute_batch("ROLLBACK").unwrap();
        reply.await.unwrap().unwrap();

        assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
        let grants = broker.grants().unwrap();
        assert_eq!(grants.len(), 2);
        assert!(grants.iter().any(|grant| grant.action == "execute"));
        assert!(grants.iter().any(|grant| grant.action == "read"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn abort_after_reply_claim_rolls_back_blocked_always_grant() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let authorize = {
            let broker = Arc::clone(&broker);
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[
                            PermissionResource::new("execute", "command:[curl][example.com]")
                                .with_save_resource("command:[curl]*"),
                        ],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().pop().expect("pending approval");
        let lock = rusqlite::Connection::open(&path).unwrap();
        lock.busy_timeout(Duration::from_secs(5)).unwrap();
        lock.execute_batch("BEGIN IMMEDIATE").unwrap();

        broker.reply(&request.id, PermissionReply::Always).unwrap();
        tokio::time::sleep(Duration::from_millis(25)).await;
        authorize.abort();
        let _ = authorize.await;
        lock.execute_batch("ROLLBACK").unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(broker.grants().unwrap().is_empty());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    #[tokio::test]
    async fn always_saves_harness_candidate_and_authorizes_headless_retry() {
        let (path, broker) = broker_fixture();
        let bus = crate::events::SessionEventBus::new(Some("session-a".to_string()));
        let interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let resource = PermissionResource::new("execute", "command:[curl][example.com][status]")
            .with_save_resource("command:[curl][example.com]*");
        let authorize = {
            let broker = Arc::clone(&broker);
            let resource = resource.clone();
            tokio::spawn(async move {
                broker
                    .authorize(
                        "exec_command",
                        &[resource],
                        &crate::tools::kernel::ToolCallContext::default(),
                        &crate::tools::ThreadCancellation::default(),
                    )
                    .await
            })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().pop().expect("pending approval");
        broker.reply(&request.id, PermissionReply::Always).unwrap();
        assert_eq!(authorize.await.unwrap(), AuthorizationOutcome::Allowed);
        assert_eq!(broker.grants().unwrap().len(), 1);
        drop(interactive);
        assert_eq!(
            broker
                .authorize(
                    "exec_command",
                    &[resource],
                    &crate::tools::kernel::ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await,
            AuthorizationOutcome::Allowed
        );
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}
