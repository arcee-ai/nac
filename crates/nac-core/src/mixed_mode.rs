use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::model::{
    managed_backend_base_url, provider_for_model, BackendKind, EffectiveModelSettings, ModelClient,
    ReasoningEffort,
};
use crate::tools::thread::MixedDispatchClients;

/// One tier's worker-model identity in mixed mode. The model remains a
/// catalog id; backend and reasoning effort are typed before entering the
/// domain model.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MixedTierSettings {
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<BackendKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_env: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<ReasoningEffort>,
}

/// Mixed-mode dispatch routing. `Some` on a session means mixed mode is on;
/// `None` keeps single-model behavior.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MixedModeConfig {
    pub easy: MixedTierSettings,
    pub medium: MixedTierSettings,
    pub hard: MixedTierSettings,
}

fn resolve_tier_client(tier: &MixedTierSettings, label: &str) -> Result<ModelClient> {
    let backend = tier
        .backend
        .or_else(|| provider_for_model(tier.model.as_str()));
    let selected_managed_base_url = tier
        .backend
        .and_then(managed_backend_base_url)
        .map(str::to_string);
    let base_url = tier.base_url.clone().or(selected_managed_base_url);
    EffectiveModelSettings::from_optional(
        backend,
        Some(tier.model.clone()),
        base_url,
        tier.reasoning_effort,
        tier.api_key_env.clone(),
        BTreeMap::new(),
    )
    .and_then(ModelClient::from_effective_settings)
    .with_context(|| format!("invalid {label} tier model settings"))
}

/// Resolve all mixed tiers at launch or resume, so invalid settings fail
/// before the first dispatch.
pub(crate) fn resolve_dispatch_clients(mixed: &MixedModeConfig) -> Result<MixedDispatchClients> {
    Ok(MixedDispatchClients {
        easy: resolve_tier_client(&mixed.easy, "easy")?,
        medium: resolve_tier_client(&mixed.medium, "medium")?,
        hard: resolve_tier_client(&mixed.hard, "hard")?,
    })
}

/// Validate a mixed configuration through the same resolution path used by
/// launch and resume.
pub fn validate(mixed: &MixedModeConfig) -> Result<()> {
    resolve_dispatch_clients(mixed).map(|_| ())
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::*;
    use crate::TEST_ENV_LOCK;

    fn restore_env(name: &str, value: Option<OsString>) {
        unsafe {
            match value {
                Some(value) => std::env::set_var(name, value),
                None => std::env::remove_var(name),
            }
        }
    }

    #[test]
    fn resolves_tiers_and_rejects_unsupported_tier_effort() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_openai = std::env::var_os("OPENAI_API_KEY");
        let original_anthropic = std::env::var_os("ANTHROPIC_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test-key");
            std::env::set_var("ANTHROPIC_API_KEY", "test-key");
        }

        let tier = |model: &str, reasoning_effort| MixedTierSettings {
            model: model.to_string(),
            backend: None,
            base_url: None,
            api_key_env: None,
            reasoning_effort,
        };
        let mixed = MixedModeConfig {
            easy: tier("gpt-5-mini", Some(ReasoningEffort::Low)),
            medium: tier("gpt-5", None),
            hard: tier("claude-fable-5", None),
        };
        let clients = resolve_dispatch_clients(&mixed).unwrap();
        assert_eq!(clients.easy.model, "gpt-5-mini");
        assert_eq!(clients.easy.reasoning_effort(), Some(ReasoningEffort::Low));
        assert_eq!(clients.medium.model, "gpt-5");
        assert_eq!(clients.hard.model, "claude-fable-5");
        assert_eq!(clients.hard.backend(), BackendKind::AnthropicMessages);

        let mixed = MixedModeConfig {
            easy: tier("gpt-5-mini", None),
            medium: tier("gpt-5", None),
            hard: tier("claude-fable-5", Some(ReasoningEffort::High)),
        };
        let error = resolve_dispatch_clients(&mixed)
            .map(|_| ())
            .unwrap_err()
            .to_string();
        assert!(error.contains("invalid hard tier model settings"));

        restore_env("OPENAI_API_KEY", original_openai);
        restore_env("ANTHROPIC_API_KEY", original_anthropic);
    }
}
