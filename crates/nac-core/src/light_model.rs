use std::collections::BTreeMap;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::model::{
    managed_backend_base_url, provider_for_model, BackendKind, EffectiveModelSettings, ModelClient,
    ReasoningEffort,
};

/// The optional light worker model of a session. `Some` on a session enables
/// weight-classified dispatch: light dispatches run this model, heavy
/// dispatches run the orchestrator's own model. The model remains a catalog
/// id; backend and reasoning effort are typed before entering the domain
/// model, and the credential is always a selector name, never a key value.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[cfg_attr(feature = "openapi", derive(utoipa::ToSchema))]
pub struct LightModelSettings {
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

/// Resolve the light model at launch or resume, so invalid settings fail
/// before the first dispatch. The client carries the session's extra
/// headers, matching how single-mode workers inherit them.
pub(crate) fn resolve_light_client(
    light: &LightModelSettings,
    session_headers: &BTreeMap<String, String>,
) -> Result<ModelClient> {
    let backend = light
        .backend
        .or_else(|| provider_for_model(light.model.as_str()));
    let selected_managed_base_url = light
        .backend
        .and_then(managed_backend_base_url)
        .map(str::to_string);
    let base_url = light.base_url.clone().or(selected_managed_base_url);
    EffectiveModelSettings::from_optional(
        backend,
        Some(light.model.clone()),
        base_url,
        light.reasoning_effort,
        light.api_key_env.clone(),
        session_headers.clone(),
    )
    .and_then(ModelClient::from_effective_settings)
    .map_err(|error| {
        let message = format!("invalid light model settings: {error:#}");
        error.context(message)
    })
}

/// Validate a light-model configuration through the same resolution path
/// used by launch and resume.
pub fn validate(
    light: &LightModelSettings,
    session_headers: &BTreeMap<String, String>,
) -> Result<()> {
    resolve_light_client(light, session_headers).map(|_| ())
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
    fn resolves_light_client_and_rejects_unsupported_effort() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_openai = std::env::var_os("OPENAI_API_KEY");
        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test-key");
        }

        let light = LightModelSettings {
            model: "gpt-5-mini".to_string(),
            backend: None,
            base_url: None,
            api_key_env: None,
            reasoning_effort: Some(ReasoningEffort::Low),
        };
        let headers = BTreeMap::from([("X-Proxy-Org".to_string(), "arcee".to_string())]);
        let client = resolve_light_client(&light, &headers).unwrap();
        assert_eq!(client.model, "gpt-5-mini");
        assert_eq!(client.reasoning_effort(), Some(ReasoningEffort::Low));
        assert_eq!(client.extra_headers(), &headers);

        let light = LightModelSettings {
            model: "   ".to_string(),
            backend: None,
            base_url: None,
            api_key_env: None,
            reasoning_effort: None,
        };
        let error = resolve_light_client(&light, &BTreeMap::new())
            .map(|_| ())
            .unwrap_err()
            .to_string();
        assert!(error.contains("invalid light model settings"));

        restore_env("OPENAI_API_KEY", original_openai);
    }

    #[test]
    fn missing_light_model_api_key_names_the_required_credential() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let original_arcee = std::env::var_os("ARCEE_API_KEY");
        unsafe {
            std::env::remove_var("ARCEE_API_KEY");
        }

        let light = LightModelSettings {
            model: "deepseek/deepseek-v4-flash-latest".to_string(),
            backend: Some(BackendKind::ArceeApi),
            base_url: Some("https://api.arcee.ai/api/v1".to_string()),
            api_key_env: None,
            reasoning_effort: None,
        };
        let error = resolve_light_client(&light, &BTreeMap::new())
            .map(|_| ())
            .unwrap_err();
        let message = error.to_string();

        assert!(
            error
                .downcast_ref::<crate::model::ModelConfigurationError>()
                .is_some()
        );
        assert!(message.contains("invalid light model settings"), "{message}");
        assert!(message.contains("api_key_env"), "{message}");
        assert!(message.contains("ARCEE_API_KEY"), "{message}");

        restore_env("ARCEE_API_KEY", original_arcee);
    }
}
