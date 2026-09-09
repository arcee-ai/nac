use anyhow::Result;

use super::AgentMode;

/// Credential source for the request-scoped first-party web capability.
/// Workers are populated only from the post-MCP delegated snapshot; eligible
/// direct agents retain the established environment/store refresh behavior.
pub(super) enum NativeWebCapabilities {
    Disabled,
    Direct,
    Worker(Option<String>),
}

impl NativeWebCapabilities {
    pub(super) fn new(mode: AgentMode, traditional_child: bool) -> Self {
        match mode {
            AgentMode::Worker => Self::Worker(None),
            AgentMode::Direct if !traditional_child => Self::Direct,
            AgentMode::Direct | AgentMode::Orchestrator => Self::Disabled,
        }
    }

    pub(super) fn is_eligible(&self) -> bool {
        !matches!(self, Self::Disabled)
    }

    pub(super) fn set_worker_credential(&mut self, credential: Option<String>) {
        if let Self::Worker(worker_credential) = self {
            *worker_credential = credential.filter(|value| !value.trim().is_empty());
        }
    }

    pub(super) fn resolve_credential(&self) -> Result<Option<String>> {
        match self {
            Self::Disabled => Ok(None),
            Self::Direct => Ok(crate::worker_credentials::managed_exa_api_key().or(
                crate::model::resolve_named_api_key(crate::model::EXA_API_KEY_ENV)?,
            )),
            Self::Worker(credential) => Ok(credential.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANARY: &str = "managed-direct-native-web-canary";

    #[test]
    fn managed_snapshot_direct_web_helper() {
        if std::env::var_os("NAC_MANAGED_DIRECT_WEB_HELPER").is_none() {
            return;
        }
        crate::worker_credentials::capture_managed_native_credentials_from_environment().unwrap();
        assert!(std::env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
        let capability = NativeWebCapabilities::new(AgentMode::Direct, false);
        assert_eq!(
            capability.resolve_credential().unwrap().as_deref(),
            Some(CANARY)
        );
        assert_eq!(
            crate::worker_credentials::ManagedWorkerNativeCredentials::from_process_environment()
                .unwrap()
                .into_exa_api_key()
                .as_deref(),
            Some(CANARY)
        );
    }

    #[test]
    fn managed_snapshot_remains_available_to_direct_native_web_only() {
        let output = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "agent::web_capabilities::tests::managed_snapshot_direct_web_helper",
                "--nocapture",
            ])
            .env("NAC_MANAGED_DIRECT_WEB_HELPER", "1")
            .env(crate::model::EXA_API_KEY_ENV, CANARY)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "managed direct-web helper failed: stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains(CANARY));
        assert!(!String::from_utf8_lossy(&output.stderr).contains(CANARY));
    }
}
