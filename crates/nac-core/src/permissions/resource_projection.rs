use super::*;

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

pub(super) fn is_store_path(path: &Path, store_path: &Path) -> bool {
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

pub(super) fn external_directory_pattern(path: &Path) -> String {
    // External authority starts exact. A directory-wide proposal needs a
    // first-class separator-aware representation rather than `/tmp/work*`,
    // which would also match a sibling such as `/tmp/work-secret`.
    path.display().to_string()
}

pub(super) fn path_contains_component(path: &Path, expected: &str) -> bool {
    path.components().any(|component| {
        matches!(component, Component::Normal(value) if value.to_str() == Some(expected))
    })
}

pub(super) fn path_is_within(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

pub(super) fn lexical_normalize(path: &Path) -> PathBuf {
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
