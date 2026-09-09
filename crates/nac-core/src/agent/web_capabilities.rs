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
            Self::Direct => crate::model::resolve_named_api_key(crate::model::EXA_API_KEY_ENV),
            Self::Worker(credential) => Ok(credential.clone()),
        }
    }
}
