use std::collections::BTreeMap;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::model::{
    managed_backend_base_url, provider_for_model, BackendKind, EffectiveModelSettings, ModelClient,
    ModelConfigurationError, ReasoningEffort,
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

/// Error resolving a session's light model.
///
/// The variant carries the configuration-error semantics, so the shared
/// runtime path matches on the type instead of type-sniffing an
/// `anyhow::Error` chain. The inner error keeps its full cause chain under a
/// plain context; the HTTP boundary renders that chain once with `{:#}`.
#[derive(Debug)]
pub enum LightModelError {
    /// The light-model settings are invalid and the user can repair them.
    InvalidSettings(anyhow::Error),
    /// Resolution failed for a reason other than the settings themselves.
    Other(anyhow::Error),
}

impl LightModelError {
    /// Whether the failure is a caller-fixable settings problem.
    pub fn is_invalid_settings(&self) -> bool {
        matches!(self, Self::InvalidSettings(_))
    }

    /// The inner error, with its cause chain intact.
    pub fn into_inner(self) -> anyhow::Error {
        match self {
            Self::InvalidSettings(error) | Self::Other(error) => error,
        }
    }
}

impl std::fmt::Display for LightModelError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidSettings(error) | Self::Other(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for LightModelError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        // `Display` already renders the inner error's top context, so the
        // source is the rest of the chain.
        match self {
            Self::InvalidSettings(error) | Self::Other(error) => error.chain().nth(1),
        }
    }
}

/// Resolve the light model at launch or resume, so invalid settings fail
/// before the first dispatch. The client carries the session's extra
/// headers, matching how single-mode workers inherit them.
pub(crate) fn resolve_light_client(
    light: &LightModelSettings,
    session_headers: &BTreeMap<String, String>,
) -> std::result::Result<ModelClient, LightModelError> {
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
        // Classify at the source, while the typed configuration error is
        // still visible, and keep the cause chain intact under a plain
        // context. Callers render the chain with `{:#}` at the boundary.
        let invalid_settings = error.downcast_ref::<ModelConfigurationError>().is_some();
        let error = error.context("invalid light model settings");
        if invalid_settings {
            LightModelError::InvalidSettings(error)
        } else {
            LightModelError::Other(error)
        }
    })
}

/// Validate a light-model configuration through the same resolution path
/// used by launch and resume.
pub fn validate(
    light: &LightModelSettings,
    session_headers: &BTreeMap<String, String>,
) -> Result<()> {
    resolve_light_client(light, session_headers)
        .map(|_| ())
        .map_err(anyhow::Error::from)
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

        // The variant carries the configuration semantics; the chain stays
        // intact inside the error and the boundary renders it once with
        // `{:#}`.
        assert!(error.is_invalid_settings());
        let rendered = format!("{:#}", anyhow::Error::from(error));
        assert!(
            rendered.contains("invalid light model settings"),
            "{rendered}"
        );
        assert!(rendered.contains("api_key_env"), "{rendered}");
        assert!(rendered.contains("ARCEE_API_KEY"), "{rendered}");

        restore_env("ARCEE_API_KEY", original_arcee);
    }
}
