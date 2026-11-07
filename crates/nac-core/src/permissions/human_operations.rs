use super::*;

/// Authorize one authenticated, human-initiated product operation that creates
/// a directory at an exact target whose parent is already canonically bound.
///
/// Hard and configured Deny refuse it. Ask needs no answer: the invocation is
/// the person's intent, issued by the service, so no approval request is
/// created, no answer mode is read and no grant is consulted or remembered.
/// The backend is the one the caller already selected; this never changes it.
pub fn authorize_human_directory_creation(
    backend: PermissionBackend,
    target: &Path,
    configured_rules: Vec<PermissionRule>,
    store_path: &Path,
) -> Result<(), String> {
    let resources = human_directory_resources(target, backend, store_path);
    let decision =
        PermissionPolicy::for_backend(backend, configured_rules).evaluate(&resources, &[]);
    if decision.effect == PermissionEffect::Deny {
        return Err(decision.hard_denial.unwrap_or_else(|| {
            "configured permission rules deny creating this folder".to_string()
        }));
    }
    Ok(())
}
