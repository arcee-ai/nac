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
            let path = backend
                .canonicalize_permission_path(Path::new(&resource.resource))
                .await?;
            canonical.extend(file_resources(
                &resource.action,
                path,
                backend,
                store_path,
                resource.action == "edit",
            ));
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
    if command.contains('$')
        || command.contains('`')
        || command.contains("<<")
        || command.contains('<')
        || command.contains('>')
        || command.contains('(')
        || command.contains(')')
    {
        return ParsedShell::Opaque;
    }
    let mut segments = Vec::new();
    let mut segment = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    let chars = command.chars().collect::<Vec<_>>();
    let mut index = 0;
    while index < chars.len() {
        let current = chars[index];
        if escaped {
            word.push(current);
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
        if current == '\'' || current == '"' {
            quote = Some(current);
            index += 1;
            continue;
        }
        if current.is_whitespace() {
            push_word(&mut segment, &mut word);
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
            push_word(&mut segment, &mut word);
            if !segment.is_empty() {
                segments.push(std::mem::take(&mut segment));
            }
            index += boundary;
            continue;
        }
        word.push(current);
        index += 1;
    }
    if escaped || quote.is_some() {
        return ParsedShell::Opaque;
    }
    push_word(&mut segment, &mut word);
    if !segment.is_empty() {
        segments.push(segment);
    }
    if segments.is_empty() {
        ParsedShell::Opaque
    } else {
        ParsedShell::Supported(segments)
    }
}

fn push_word(segment: &mut Vec<String>, word: &mut String) {
    if !word.is_empty() {
        segment.push(std::mem::take(word));
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
        .unwrap_or_default();
    if tokens.is_empty() || BANNED.contains(&command) || is_broad_command(tokens) {
        return canonical_command(tokens);
    }
    let width = tokens.len().min(2);
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
    let tokens = effective_command_tokens(tokens);
    let command = tokens.first()?.rsplit('/').next()?.to_ascii_lowercase();
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
        if let Some(body) = literal_shell_command_body(tokens) {
            let denial = match parse_shell(body) {
                ParsedShell::Supported(segments) => segments
                    .into_iter()
                    .find_map(|segment| hard_shell_denial_inner(&segment, cwd, backend, depth + 1)),
                ParsedShell::Opaque => opaque_hard_shell_denial(body, cwd, backend),
            };
            if denial.is_some() {
                return denial;
            }
        }
    }
    None
}

fn literal_shell_command_body(tokens: &[String]) -> Option<&str> {
    let option_index = tokens
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(index, token)| {
            token
                .strip_prefix('-')
                .is_some_and(|flags| flags.contains('c'))
                .then_some(index)
        })?;
    tokens.get(option_index + 1).map(String::as_str)
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
                        "-u" | "--unset" | "-C" | "--chdir" | "-S" | "--split-string"
                    ) {
                        index = (index + 2).min(tokens.len());
                    } else if option.starts_with('-') || is_environment_assignment(option) {
                        index += 1;
                    } else {
                        break;
                    }
                }
            }
            "nice" => {
                index += 1;
                if tokens.get(index).is_some_and(|token| token == "-n") {
                    index = (index + 2).min(tokens.len());
                } else {
                    while tokens
                        .get(index)
                        .is_some_and(|token| token.starts_with('-'))
                    {
                        index += 1;
                    }
                }
            }
            "time" => {
                index += 1;
                while tokens
                    .get(index)
                    .is_some_and(|token| token.starts_with('-'))
                {
                    index += 1;
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
    const BROAD: &[&str] = &[
        "bash", "bun", "dash", "deno", "fish", "node", "nodejs", "npm", "perl", "php", "pnpm",
        "python", "python3", "ruby", "sh", "yarn", "zsh",
    ];
    effective_command_tokens(tokens)
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| {
            let command = command.to_ascii_lowercase();
            BROAD.contains(&command.as_str())
                || command.starts_with("python3.")
                || command.starts_with("node-")
        })
}

fn shell_path_resources(
    tokens: &[String],
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Vec<PermissionResource> {
    let mut paths = Vec::<PathBuf>::new();
    for index in 1..tokens.len() {
        if let Some((_, requested)) = shell_path_candidate(tokens, index) {
            let path = if requested.is_absolute() {
                requested.to_path_buf()
            } else {
                cwd.join(requested)
            };
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
        .into_iter()
        .flat_map(|path| file_resources("execute_path", path, backend, Path::new(""), false))
        .collect()
}

fn looks_like_shell_path(value: &str) -> bool {
    value.starts_with('/')
        || value.starts_with("./")
        || value.starts_with("../")
        || value == ".env"
        || value.starts_with(".env.")
}

fn shell_path_candidate(tokens: &[String], index: usize) -> Option<(Option<&str>, &Path)> {
    let token = tokens.get(index)?;
    let (option, candidate) = token
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'))
        .map_or((None, token.as_str()), |(option, value)| {
            (Some(option), value)
        });
    let previous_takes_path = index > 0
        && matches!(
            tokens[index - 1].as_str(),
            "--manifest-path" | "--config" | "--output" | "-C" | "-f" | "--file"
        );
    let known_bare_path = candidate.contains('/') && bare_relative_path_position(tokens, index);
    (previous_takes_path || looks_like_shell_path(candidate) || known_bare_path)
        .then(|| (option, Path::new(candidate)))
}

fn bare_relative_path_position(tokens: &[String], index: usize) -> bool {
    let effective = effective_command_tokens(tokens);
    let command_index = tokens.len().saturating_sub(effective.len());
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default();
    if command != "rg" || index <= command_index {
        return false;
    }
    let token = &tokens[index];
    let option = token
        .split_once('=')
        .filter(|(option, _)| option.starts_with('-'))
        .map(|(option, _)| option);
    let previous = index.checked_sub(1).and_then(|index| tokens.get(index));
    const NON_PATH_RG_OPTIONS: &[&str] = &[
        "-e",
        "--regexp",
        "-g",
        "--glob",
        "--iglob",
        "-t",
        "--type",
        "--type-add",
        "--type-clear",
        "-r",
        "--replace",
    ];
    if option.is_some_and(|option| NON_PATH_RG_OPTIONS.contains(&option))
        || previous.is_some_and(|option| NON_PATH_RG_OPTIONS.contains(&option.as_str()))
    {
        return false;
    }
    effective.iter().any(|token| token == "--files") || index > command_index + 1
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
        .filter(|resource| resource.action == "execute_path")
        .map(|resource| resource.resource.as_str());
    let cwd = lexical_normalize(cwd);
    let mut replacements = Vec::<(usize, usize, String)>::new();
    for (tokens, spans) in segments.iter().zip(spans) {
        let mut canonical_by_requested = Vec::<(PathBuf, String)>::new();
        for (index, span) in spans.iter().enumerate().skip(1) {
            let Some((option, requested)) = shell_path_candidate(tokens, index) else {
                continue;
            };
            let requested = if requested.is_absolute() {
                requested.to_path_buf()
            } else {
                cwd.join(requested)
            };
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
            let bound = option.map_or(canonical.clone(), |option| format!("{option}={canonical}"));
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
    let mut chars = command.char_indices().peekable();
    let push = |segment: &mut Vec<ShellWordSpan>,
                start: &mut Option<usize>,
                value: &mut String,
                end: usize| {
        if !value.is_empty() {
            segment.push(ShellWordSpan {
                start: start.take().expect("non-empty shell word has a start"),
                end,
                value: std::mem::take(value),
            });
        } else {
            *start = None;
        }
    };
    while let Some((index, current)) = chars.next() {
        if escaped {
            value.push(current);
            escaped = false;
            continue;
        }
        if current == '\\' && quote != Some('\'') {
            start.get_or_insert(index);
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
    let tokens = opaque_literal_tokens(command);
    for index in 0..tokens.len() {
        if let Some(reason) = hard_shell_denial(&tokens[index..], cwd, backend) {
            return Some(reason);
        }
    }
    None
}

fn opaque_literal_tokens(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut word = String::new();
    let mut quote = None;
    let mut escaped = false;
    for current in command.chars() {
        if escaped {
            word.push(current);
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
        .any(|target| target == Path::new("/") || target == workspace)
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
            "exec -a installer sudo make install",
            "nice -n 1 sudo make install",
            "busybox rm -rf /workspace",
            "sudo make install > /tmp/result",
            "git checkout .",
            "sh -c 'git reset --hard'",
            "bash -lc 'sudo make install'",
            "sh -c 'git reset --hard' > /tmp/result",
            "bash -lc 'sudo make install' > /tmp/result",
        ] {
            assert!(
                shell_resources(command, Path::new("/workspace"), &backend)[0]
                    .hard_denial
                    .is_some(),
                "wrapper or opaque syntax must not bypass hard denial: {command}"
            );
        }
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
            "make -f /outside/Makefile",
            "git diff --no-index /workspace/a /outside/b",
            "git diff --output=/outside/diff.txt",
        ] {
            let resources = shell_resources(command, Path::new("/workspace"), &backend);
            assert!(resources
                .iter()
                .any(|resource| resource.action == "execute_path"));
            assert!(
                resources.iter().any(|resource| {
                    resource.action == "external_directory"
                        && resource.resource.starts_with("/outside")
                }),
                "external command path must be independently authorized: {command}"
            );
        }
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
