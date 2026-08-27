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
mod evaluation;

pub use evaluation::wildcard_match;

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
    if canonical
        .iter()
        .any(|resource| matches!(resource.action.as_str(), "execute_broad" | "execute_opaque"))
    {
        for resource in &mut canonical {
            resource.save_resource = None;
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
                    let authority = match backend {
                        ExecutionBackend::Local { .. } => "trusted arbitrary code execution on the unsandboxed Local backend for this invocation; parser protected-path rules cannot constrain code inside it",
                        ExecutionBackend::Ssh(_) => "trusted arbitrary code execution on the unsandboxed SSH backend for this invocation; parser protected-path rules cannot constrain code inside it",
                        ExecutionBackend::Sandbox(_) => "arbitrary code execution for this invocation within the selected Podman confinement boundary",
                    };
                    resources.push(
                        PermissionResource::new("execute_broad", canonical_command(&tokens))
                            .with_display(format!(
                                "broad executable authority: {display}; {authority}"
                            )),
                    );
                }
                let mut path_resources = shell_path_resources(&tokens, &cwd, backend);
                if !is_broad_command(&tokens) {
                    for resource in &mut path_resources {
                        if resource.shell_binding.is_some() {
                            resource.hard_denial = Some(
                                "direct shell path arguments are blocked because pathname text cannot remain bound across concurrent ancestor replacement; use NAC's native file/search tools, a path-free command with workdir, or explicitly approve a broad interpreter as trusted arbitrary code"
                                    .to_string(),
                            );
                            resource.save_resource = None;
                        }
                    }
                }
                resources.extend(path_resources);
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
                    .with_display(match backend {
                        ExecutionBackend::Local { .. } => "unsupported shell syntax requires explicit approval as trusted arbitrary code execution on the unsandboxed Local backend for this invocation; parser protected-path rules cannot constrain code inside it",
                        ExecutionBackend::Ssh(_) => "unsupported shell syntax requires explicit approval as trusted arbitrary code execution on the unsandboxed SSH backend for this invocation; parser protected-path rules cannot constrain code inside it",
                        ExecutionBackend::Sandbox(_) => "unsupported shell syntax requires explicit approval as arbitrary code execution for this invocation within the selected Podman confinement boundary",
                    }),
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
    if resources
        .iter()
        .any(|resource| matches!(resource.action.as_str(), "execute_broad" | "execute_opaque"))
    {
        // A broad approval authorizes this invocation as one inseparable unit.
        // Persisting any exact command, cwd, or path fragment from it would
        // misrepresent that authority as a reusable narrow grant.
        for resource in &mut resources {
            resource.save_resource = None;
        }
    }
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
    if let Some(name) = executable_environment_hook(tokens) {
        return Some(if name == "indirect stateful shell assignment" {
            "indirect stateful shell assignments are blocked because they can mutate dynamic-loader hooks without disclosing the target variable"
                .to_string()
        } else if matches!(name, "RSYNC_RSH" | "RSYNC_CONNECT_PROG") {
            "rsync executable environment hooks are blocked because they can conceal commands"
                .to_string()
        } else {
            format!(
                "dynamic-loader environment hook '{name}' is blocked because it can execute hidden code"
            )
        });
    }
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
        "chroot"
            | "chrt"
            | "daemon"
            | "daemonize"
            | "flock"
            | "ionice"
            | "numactl"
            | "nsenter"
            | "parallel"
            | "prlimit"
            | "runuser"
            | "script"
            | "setpriv"
            | "setsid"
            | "start-stop-daemon"
            | "stdbuf"
            | "systemd-run"
            | "taskset"
            | "unshare"
            | "watch"
    ) {
        return Some(format!(
            "execution wrapper '{command}' is blocked because it can conceal a protected command"
        ));
    }
    if command == "rsync"
        && tokens.iter().skip(1).any(|token| {
            token == "--daemon"
                || token.starts_with('-') && !token.starts_with("--") && token[1..].contains('e')
                || token == "--rsh"
                || token.starts_with("--rsh=")
                || token == "--rsync-path"
                || token.starts_with("--rsync-path=")
                || token == "--config"
                || token.starts_with("--config=")
        })
    {
        return Some(
            "rsync executable and daemon configuration is blocked because it can conceal commands"
                .to_string(),
        );
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
            .is_some_and(|token| is_shell_environment_assignment(token))
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
    environment_assignment_name(token).is_some()
}

fn is_shell_environment_assignment(token: &str) -> bool {
    shell_environment_assignment_name(token).is_some()
}

fn environment_assignment_name(token: &str) -> Option<&str> {
    let (name, _) = token.split_once('=')?;
    valid_environment_name(name).then_some(name)
}

fn shell_environment_assignment_name(token: &str) -> Option<&str> {
    let (left, _) = token.split_once('=')?;
    let name = left.strip_suffix('+').unwrap_or(left);
    valid_environment_name(name).then_some(name)
}

fn valid_environment_name(name: &str) -> bool {
    !name.is_empty()
        && name.bytes().enumerate().all(|(index, byte)| {
            byte == b'_' || byte.is_ascii_alphanumeric() && (index > 0 || !byte.is_ascii_digit())
        })
}

/// Returns an execution-bearing assignment only while it is in a position
/// Bash or `env` treats as command environment. Tokens after the effective
/// command are data and must not be rejected merely because they contain an
/// assignment-looking string.
fn executable_environment_hook(tokens: &[String]) -> Option<&str> {
    const INDIRECT_ASSIGNMENT: &str = "indirect stateful shell assignment";
    const STATEFUL_EXPORT: &str = "stateful shell environment export";
    const HOOKS: &[&str] = &[
        "RSYNC_RSH",
        "RSYNC_CONNECT_PROG",
        "LD_PRELOAD",
        "LD_AUDIT",
        "LD_LIBRARY_PATH",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "DYLD_FRAMEWORK_PATH",
    ];

    let mut leading = 0;
    while let Some(name) = tokens
        .get(leading)
        .and_then(|token| shell_environment_assignment_name(token))
    {
        if HOOKS.contains(&name) {
            return Some(name);
        }
        leading += 1;
    }

    let command_index = tokens
        .len()
        .saturating_sub(effective_command_tokens(tokens).len());
    if let Some(name) = tokens[leading..command_index]
        .iter()
        .filter_map(|token| environment_assignment_name(token))
        .find(|name| HOOKS.contains(name))
    {
        return Some(name);
    }

    // Bash executes a semicolon-delimited command line in one stateful shell,
    // even though authorization inspects each simple command independently.
    // Assignment builtins can therefore seed a loader hook in one segment and
    // have a later, otherwise-safe executable inherit it. Restrict scanning to
    // builtin operands so assignment-looking data after ordinary commands
    // remains harmless.
    let effective = effective_command_tokens(tokens);
    let command = effective
        .first()
        .and_then(|command| command.rsplit('/').next())?;
    let command = command.to_ascii_lowercase();

    // `printf -v NAME` mutates the current Bash process without using
    // assignment syntax. If NAME is exported, a later simple command inherits
    // the value, so it must receive the same non-bypassable hook denial as a
    // direct assignment.
    if command == "printf" {
        let mut operands = effective[1..].iter();
        while let Some(option) = operands.next() {
            let target = if option == "-v" {
                operands.next().map(String::as_str)
            } else {
                option
                    .strip_prefix("-v")
                    .filter(|target| !target.is_empty())
            };
            if let Some(target) = target {
                return HOOKS.contains(&target).then_some(target);
            }
            if option == "--" || !option.starts_with('-') {
                break;
            }
        }
        return None;
    }

    // `set -a` / `set -o allexport` changes the meaning of later simple
    // commands in the same `bash -c`: assignment-capable builtins such as
    // `let` and `read` can then create an exported loader hook without any
    // assignment syntax in the `set` segment. Authorization intentionally
    // tokenizes shell segments, so reject the state transition itself instead
    // of pretending later segments can be judged without prior shell state.
    if command == "set" {
        let operands = &effective[1..];
        if operands.iter().any(|operand| {
            operand
                .strip_prefix('-')
                .filter(|flags| !flags.is_empty() && *flags != "-")
                .is_some_and(|flags| flags.contains('a'))
        }) || operands
            .windows(2)
            .any(|pair| pair[0] == "-o" && pair[1].eq_ignore_ascii_case("allexport"))
        {
            return Some(STATEFUL_EXPORT);
        }
        return None;
    }

    // These Bash builtins assign in the current shell without needing a
    // leading NAME=value token. Block direct writes to protected hook names
    // even when an earlier export attribute is not visible in this segment.
    if command == "let" {
        return effective[1..]
            .iter()
            .filter_map(|operand| shell_environment_assignment_name(operand))
            .find(|name| HOOKS.contains(name));
    }
    if command == "read" {
        let mut index = 1;
        while let Some(operand) = effective.get(index) {
            if operand == "--" {
                index += 1;
                break;
            }
            if matches!(
                operand.as_str(),
                "-a" | "-d" | "-i" | "-n" | "-N" | "-p" | "-t" | "-u"
            ) {
                index = (index + 2).min(effective.len());
            } else if operand.starts_with('-') {
                index += 1;
            } else {
                break;
            }
        }
        return effective[index..]
            .iter()
            .find(|name| HOOKS.contains(&name.as_str()))
            .map(String::as_str);
    }

    if !matches!(
        command.as_str(),
        "declare" | "export" | "readonly" | "typeset"
    ) {
        return None;
    }

    // Bash namerefs make the eventual assignment target depend on shell state
    // from an earlier segment. Reject creation of that indirection rather than
    // pretending the visible alias can be authorized as a narrow variable.
    if matches!(command.as_str(), "declare" | "typeset")
        && effective[1..]
            .iter()
            .take_while(|token| *token != "--")
            .any(|token| {
                token
                    .strip_prefix(['-', '+'])
                    .is_some_and(|flags| flags.contains('n'))
            })
    {
        return Some(INDIRECT_ASSIGNMENT);
    }
    effective[1..]
        .iter()
        .filter(|token| !token.starts_with('-') && !token.starts_with('+'))
        .filter_map(|token| {
            shell_environment_assignment_name(token)
                .or_else(|| valid_environment_name(token).then_some(token.as_str()))
        })
        .find(|name| HOOKS.contains(name))
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
    command_is_broad
        || project_code_command(effective)
        || cargo_configuration(effective)
        || embedded_command_body(effective).is_some()
}

fn project_code_command(tokens: &[String]) -> bool {
    tokens
        .first()
        .and_then(|command| command.rsplit('/').next())
        .is_some_and(|command| {
            matches!(
                command.to_ascii_lowercase().as_str(),
                "cargo" | "git" | "gmake" | "make"
            )
        })
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
        "chmod" | "chown" | "chgrp" => simple_bare_path_operand(tokens, command_index, index, 1),
        "cat" | "cp" | "du" | "file" | "head" | "install" | "ln" | "ls" | "mkdir" | "mv"
        | "readlink" | "realpath" | "rsync" | "rmdir" | "stat" | "tail" | "tee" | "touch"
        | "truncate" | "unlink" | "wc" => simple_bare_path_operand(tokens, command_index, index, 0),
        _ => false,
    }
}

fn simple_bare_path_operand(
    tokens: &[String],
    command_index: usize,
    index: usize,
    leading_data_operands: usize,
) -> bool {
    const VALUE_OPTIONS: &[&str] = &[
        "-m",
        "--mode",
        "-o",
        "--owner",
        "-g",
        "--group",
        "-t",
        "--target-directory",
        "-S",
        "--suffix",
        "--reference",
        "-s",
        "--size",
        "-n",
        "--lines",
        "-c",
        "--bytes",
        "--block-size",
        "--format",
        "--printf",
    ];
    let mut options = true;
    let mut skip_value = false;
    let mut positional = 0usize;
    for (cursor, token) in tokens.iter().enumerate().skip(command_index + 1) {
        if skip_value {
            skip_value = false;
            continue;
        }
        if options && token == "--" {
            options = false;
            continue;
        }
        if options && token.starts_with('-') && token != "-" {
            let option = token
                .split_once('=')
                .map_or(token.as_str(), |(name, _)| name);
            if VALUE_OPTIONS.contains(&option) && !token.contains('=') {
                skip_value = true;
            }
            continue;
        }
        if cursor == index {
            return positional >= leading_data_operands;
        }
        positional += 1;
    }
    false
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
    if contains_unquoted_shell_redirection(command) {
        return Some(
            "opaque shell redirection is blocked because its path targets cannot be independently authorized"
                .to_string(),
        );
    }
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

fn contains_unquoted_shell_redirection(command: &str) -> bool {
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
            }
            continue;
        }
        if matches!(current, '\'' | '"') {
            quote = Some(current);
            continue;
        }
        if matches!(current, '<' | '>') {
            return true;
        }
    }
    false
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
#[path = "permissions_tests.rs"]
mod tests;
