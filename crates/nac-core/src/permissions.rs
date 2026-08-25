//! Permission policy for persistent direct sessions.
//!
//! Authorization is deliberately separate from execution confinement. An
//! allow decision authorizes the prepared invocation through its already
//! selected [`crate::sandbox::ExecutionBackend`]; it never changes backends.

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::sandbox::ExecutionBackend;
use crate::tools::kernel::PermissionResource;

const APPROVAL_TIMEOUT: Duration = Duration::from_secs(10 * 60);

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

        if reply == PermissionReply::Always {
            let mut by_action = BTreeMap::<String, Vec<String>>::new();
            for resource in &pending.request.resources {
                if let Some(save) = &resource.save_resource {
                    by_action
                        .entry(resource.action.clone())
                        .or_default()
                        .push(save.clone());
                }
            }
            for (action, resources) in by_action {
                crate::store::insert_permission_grants(
                    &self.store_path,
                    &self.session_id,
                    &action,
                    &resources,
                    self.backend,
                    self.session_config_version,
                )?;
            }
        }

        self.emit(crate::events::SessionEvent::PermissionReplied {
            request_id: request_id.to_string(),
            reply,
        });
        pending
            .reply
            .send(reply)
            .map_err(|_| anyhow::anyhow!("permission request '{request_id}' is no longer active"))
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
            PermissionEffect::Allow => return AuthorizationOutcome::Allowed,
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
        if !interactive {
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
        self.emit(crate::events::SessionEvent::PermissionAsked {
            request: request.clone(),
        });

        let result = tokio::select! {
            reply = receiver => match reply {
                Ok(PermissionReply::Once | PermissionReply::Always) => AuthorizationOutcome::Allowed,
                Ok(PermissionReply::Reject) => AuthorizationOutcome::Denied("the user rejected this permission request".to_string()),
                Err(_) => AuthorizationOutcome::Denied("the permission request ended before a reply".to_string()),
            },
            () = cancellation.cancelled() => AuthorizationOutcome::Denied("run was cancelled while awaiting approval".to_string()),
            () = tokio::time::sleep(APPROVAL_TIMEOUT) => AuthorizationOutcome::Denied("permission request timed out without a reply".to_string()),
        };
        let dismissed = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .pending
            .remove(&request.id)
            .is_some();
        if dismissed {
            let reason = match &result {
                AuthorizationOutcome::Denied(reason) => reason.clone(),
                AuthorizationOutcome::Allowed => {
                    "the permission request ended without a reply".to_string()
                }
            };
            self.emit(crate::events::SessionEvent::PermissionDismissed {
                request_id: request.id,
                reason,
            });
        }
        result
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
    let resolved_path = lexical_normalize(&resolved_path);
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

    let workspace = lexical_normalize(&backend.default_terminal_cwd());
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

pub(crate) fn shell_resources(
    command: &str,
    cwd: &Path,
    backend: &ExecutionBackend,
) -> Vec<PermissionResource> {
    let workspace = lexical_normalize(&backend.default_terminal_cwd());
    let cwd = lexical_normalize(cwd);
    let mut resources = Vec::new();
    if !path_is_within(&cwd, &workspace) {
        let display = cwd.display().to_string();
        resources.push(
            PermissionResource::new("external_directory", display.clone())
                .with_display(display)
                .with_save_resource(external_directory_pattern(&cwd)),
        );
    }

    match parse_shell(command) {
        ParsedShell::Supported(segments) => {
            for tokens in segments {
                let canonical = canonical_command(&tokens);
                let display = tokens.join(" ");
                let mut resource = PermissionResource::new("execute", canonical)
                    .with_display(display)
                    .with_save_resource(command_grant_candidate(&tokens));
                if let Some(reason) = hard_shell_denial(&tokens, &cwd, backend) {
                    resource = resource.with_hard_denial(reason);
                }
                resources.push(resource);
            }
        }
        ParsedShell::Opaque => {
            let digest = Sha256::digest(command.as_bytes());
            resources.push(
                PermissionResource::new("execute", format!("opaque:sha256:{digest:x}"))
                    .with_display(command),
            );
        }
    }
    resources
}

fn is_store_path(path: &Path, store_path: &Path) -> bool {
    let store = lexical_normalize(store_path);
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
    let command = tokens
        .first()
        .and_then(|command| command.rsplit('/').next())
        .unwrap_or_default();
    if tokens.is_empty() || BANNED.contains(&command) {
        return canonical_command(tokens);
    }
    let width = tokens.len().min(2);
    format!("{}*", canonical_command(&tokens[..width]))
}

fn hard_shell_denial(tokens: &[String], cwd: &Path, backend: &ExecutionBackend) -> Option<String> {
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
        if destructive || checkout && tokens.iter().any(|token| token == "--") {
            return Some("destructive Git workspace rewrites are blocked".to_string());
        }
    }
    if command == "rm" && removes_protected_root(tokens, cwd, backend) {
        return Some(
            "recursive deletion of the workspace or filesystem root is blocked".to_string(),
        );
    }
    None
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

    #[test]
    fn shell_projection_tokenizes_segments_and_never_generalizes_opaque_or_banned_commands() {
        let backend = local(Path::new("/workspace"));
        let resources = shell_resources(
            "git status --short && cargo test -p nac-core",
            Path::new("/workspace"),
            &backend,
        );
        assert_eq!(resources.len(), 2);
        assert_eq!(resources[0].resource, "command:[git][status][--short]");
        assert_eq!(
            resources[0].save_resource.as_deref(),
            Some("command:[git][status]*")
        );

        let opaque = shell_resources("bash -c '$(dynamic)'", Path::new("/workspace"), &backend);
        assert!(opaque[0].resource.starts_with("opaque:sha256:"));
        assert!(opaque[0].save_resource.is_none());
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
