//! Saved human scheduling intent never becomes human invocation authority at
//! an automatic launch. Both workspace preparation and run admission use this
//! ordinary Local project policy, with no interactive approver or grants.
use super::*;

#[derive(Debug)]
pub struct ScheduledProjectAdmissionRequired;
impl std::fmt::Display for ScheduledProjectAdmissionRequired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("scheduled task admission requires human action under ordinary Local policy; Deny and unattended Ask do not authorize execution")
    }
}
impl std::error::Error for ScheduledProjectAdmissionRequired {}

pub(crate) fn scheduled_project_resources(project_id: &str) -> [PermissionResource; 2] {
    [
        PermissionResource::new("heartbeat_manage", format!("project:{project_id}")),
        PermissionResource::new("heartbeat_run", format!("project:{project_id}")),
    ]
}

pub fn authorize_local_scheduled_project(
    project_id: &str,
    rules: &[PermissionRule],
) -> anyhow::Result<()> {
    let decision = PermissionPolicy::for_backend(PermissionBackend::Local, rules.iter().cloned())
        .evaluate(&scheduled_project_resources(project_id), &[]);
    if decision.effect != PermissionEffect::Allow {
        return Err(ScheduledProjectAdmissionRequired.into());
    }
    Ok(())
}

/// Only the lifecycle's private human operation calls this. No model origin or
/// approval-mode switch selects this path; configured/hard Deny still wins.
pub(crate) fn authorize_human_retained_allowance(
    project_id: &str,
    rules: &[PermissionRule],
) -> anyhow::Result<()> {
    let resources = [
        PermissionResource::new("heartbeat_manage", format!("project:{project_id}")),
        PermissionResource::new("heartbeat_retained_manage", "host:local"),
    ];
    let decision = PermissionPolicy::for_backend(PermissionBackend::Local, rules.iter().cloned())
        .evaluate(&resources, &[]);
    anyhow::ensure!(
        decision.effect != PermissionEffect::Deny,
        "configured or hard policy denies human retained allowance management"
    );
    Ok(())
}

impl PermissionBroker {
    pub(crate) fn fresh_heartbeat_admission_allowed(&self, project_id: &str) -> bool {
        self.heartbeat_admission_allowed()
            && self
                .policy
                .evaluate(&scheduled_project_resources(project_id), &[])
                .effect
                == PermissionEffect::Allow
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn human_allowance_change_preserves_project_and_host_denials() {
        for (action, resource) in [
            ("heartbeat_manage", "project:target"),
            ("heartbeat_retained_manage", "host:local"),
        ] {
            let rules = [
                PermissionRule::new("*", "*", PermissionEffect::Ask),
                PermissionRule::new(action, resource, PermissionEffect::Deny),
            ];
            assert!(authorize_human_retained_allowance("target", &rules).is_err());
        }
        assert!(authorize_human_retained_allowance(
            "target",
            &[PermissionRule::new("*", "*", PermissionEffect::Ask)]
        )
        .is_ok());
    }
    #[test]
    fn automatic_project_policy_is_exact_and_never_inherits_human_ask_bypass() {
        for effect in [PermissionEffect::Ask, PermissionEffect::Deny] {
            let rules = [
                PermissionRule::new("*", "*", PermissionEffect::Allow),
                PermissionRule::new("heartbeat_run", "project:target", effect),
            ];
            assert!(authorize_local_scheduled_project("target", &rules).is_err());
            assert!(authorize_local_scheduled_project("other", &rules).is_ok());
        }
    }
}
