use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::sleep;
use url::Url;

use crate::types::{FunctionCall, Message, ToolCall, ToolDefinition};

mod anthropic;
mod arcee;
mod auth_store;
mod backend;
mod chat;
mod chatgpt_codex;
mod client;
mod requests;
mod responses;
#[cfg(test)]
mod test_http;
mod types;

use arcee::{arcee_auth_login, arcee_auth_logout, arcee_auth_status};
pub use backend::{validate_backend_api_key_env, validate_model_reasoning_effort};
use chatgpt_codex::{codex_auth_login, codex_auth_logout, codex_auth_status};
pub use client::validate_model_configuration;
pub(crate) use client::ModelClient;
pub use types::{
    managed_backend_base_url, resolve_model_base_url, EffectiveModelSettings,
    ARCEE_AUTH_CANONICAL_BASE_URL, CHATGPT_CODEX_CANONICAL_BASE_URL,
};
pub(crate) use types::{AssistantTurn, ModelTurnResponse, TokenUsage};
pub use types::{BackendKind, ReasoningEffort};

/// Identifies model setup failures caused by a caller-controlled configuration.
///
/// The server uses this typed boundary to return HTTP 400 without relying on
/// message matching. The inner message remains the user-facing diagnostic.
#[derive(Debug)]
pub struct ModelConfigurationError {
    message: String,
}

impl ModelConfigurationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl std::fmt::Display for ModelConfigurationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ModelConfigurationError {}

fn model_configuration_error(message: impl Into<String>) -> anyhow::Error {
    anyhow!(ModelConfigurationError::new(message))
}

fn classify_model_configuration_error(error: anyhow::Error) -> anyhow::Error {
    if error.downcast_ref::<ModelConfigurationError>().is_some() {
        error
    } else {
        model_configuration_error(error.to_string())
    }
}

fn classify_stored_arcee_auth_error(error: anyhow::Error) -> anyhow::Error {
    if error
        .downcast_ref::<arcee::StoredArceeAuthConfigurationError>()
        .is_some()
        || error
            .downcast_ref::<auth_store::UnsafeCredentialPermissionsError>()
            .is_some()
    {
        model_configuration_error(error.to_string())
    } else {
        error.context("failed to load stored Arcee credentials")
    }
}

fn classify_stored_codex_auth_error(error: anyhow::Error) -> anyhow::Error {
    if error
        .downcast_ref::<chatgpt_codex::StoredCodexAuthConfigurationError>()
        .is_some()
        || error
            .downcast_ref::<auth_store::UnsafeCredentialPermissionsError>()
            .is_some()
    {
        model_configuration_error(error.to_string())
    } else {
        error.context("failed to load stored Codex credentials")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexAuthAction {
    Login,
    Status,
    Logout,
}

pub async fn run_codex_auth_action(action: CodexAuthAction) -> Result<()> {
    match action {
        CodexAuthAction::Login => codex_auth_login().await,
        CodexAuthAction::Status => codex_auth_status(),
        CodexAuthAction::Logout => codex_auth_logout(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArceeAuthAction {
    Login,
    Status,
    Logout,
}

pub async fn run_arcee_auth_action(action: ArceeAuthAction) -> Result<()> {
    match action {
        ArceeAuthAction::Login => arcee_auth_login().await,
        ArceeAuthAction::Status => arcee_auth_status(),
        ArceeAuthAction::Logout => arcee_auth_logout(),
    }
}

use anthropic::*;
use backend::*;
use chat::*;
use requests::*;
use responses::*;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TEST_ENV_LOCK;
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct IsolatedModelEnv {
        original: Vec<(&'static str, Option<OsString>)>,
        home: PathBuf,
    }

    impl IsolatedModelEnv {
        fn new(
            label: &str,
            auth_contents: Option<&str>,
            openai_key: Option<&str>,
            base_url: Option<&str>,
        ) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("time went backwards")
                .as_nanos();
            let home = std::env::temp_dir()
                .join(format!("nac-model-{label}-{}-{unique}", std::process::id()));
            std::fs::create_dir_all(&home).unwrap();
            if let Some(contents) = auth_contents {
                write_test_credential(&home.join("auth.json"), contents);
            }

            let names = [
                "OPENAI_API_KEY",
                "OPENAI_BASE_URL",
                "OPENAI_MODEL",
                "NAC_HOME",
            ];
            let original = names
                .into_iter()
                .map(|name| (name, std::env::var_os(name)))
                .collect();
            set_env("OPENAI_API_KEY", openai_key);
            set_env("OPENAI_BASE_URL", base_url);
            set_env("OPENAI_MODEL", None);
            unsafe { std::env::set_var("NAC_HOME", &home) };

            Self { original, home }
        }
    }

    impl Drop for IsolatedModelEnv {
        fn drop(&mut self) {
            for (name, value) in self.original.drain(..) {
                restore_env(name, value);
            }
            let _ = std::fs::remove_dir_all(&self.home);
        }
    }

    fn write_test_credential(path: &std::path::Path, contents: impl AsRef<[u8]>) {
        std::fs::write(path, contents).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
    }

    fn set_env(name: &str, value: Option<&str>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    fn stored_arcee_auth(access_token: &str, base_url: &str) -> String {
        json!({
            "type": "arcee_device_token",
            "access_token": access_token,
            "refresh_token": "refresh-test",
            "token_type": "bearer",
            "expires_at_ms": u64::MAX,
            "base_url": base_url,
            "organization_id": "org-test",
            "workspace_name": "workspace-test"
        })
        .to_string()
    }

    fn stored_codex_auth() -> String {
        json!({
            "type": "chatgpt-codex",
            "access": "access-test",
            "refresh": "refresh-test",
            "expires_at_ms": u64::MAX,
            "account_id": "account-test"
        })
        .to_string()
    }

    fn restore_env(name: &str, value: Option<OsString>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    fn directory_names(path: &std::path::Path) -> Vec<String> {
        let mut names = std::fs::read_dir(path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[test]
    fn api_key_backends_require_explicit_valid_selectors_and_ignore_canonical_vars() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let names = [
            "OPENAI_API_KEY",
            "TOGETHER_API_KEY",
            "ANTHROPIC_API_KEY",
            "NAC_EXPLICIT_TEST_KEY",
        ];
        let original = names.map(|name| (name, std::env::var_os(name)));
        set_env("OPENAI_API_KEY", Some("openai-selected"));
        set_env("TOGETHER_API_KEY", Some("together-selected"));
        set_env("ANTHROPIC_API_KEY", Some("anthropic-selected"));
        set_env("NAC_EXPLICIT_TEST_KEY", Some("selected-secret"));

        let backends = [
            BackendKind::OpenAiResponses,
            BackendKind::TogetherChat,
            BackendKind::AnthropicMessages,
            BackendKind::DeepSeekChat,
            BackendKind::FireworksChat,
            BackendKind::ArceeApi,
        ];
        for backend in backends {
            let missing = api_key_for_backend(backend, None)
                .expect_err("canonical variables must not act as implicit selectors");
            assert!(missing.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(missing
                .to_string()
                .contains("requires a nonblank api_key_env"));

            let selected = api_key_for_backend(backend, Some("NAC_EXPLICIT_TEST_KEY"))
                .expect("explicit selector should be authoritative");
            assert_eq!(selected, "selected-secret");
        }

        for (selector, expected) in [
            ("OPENAI_API_KEY", "openai-selected"),
            ("TOGETHER_API_KEY", "together-selected"),
            ("ANTHROPIC_API_KEY", "anthropic-selected"),
        ] {
            let selected = api_key_for_backend(BackendKind::OpenAiResponses, Some(selector))
                .expect("canonical variable names remain valid explicit selectors");
            assert_eq!(selected, expected);
        }

        for (name, value) in original {
            restore_env(name, value);
        }
    }

    #[test]
    fn api_key_selector_validation_and_values_are_typed_configuration_errors() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let names = [
            "NAC_MISSING_TEST_KEY",
            "NAC_EMPTY_TEST_KEY",
            "NAC_SPACE_TEST_KEY",
        ];
        let original = names.map(|name| (name, std::env::var_os(name)));
        set_env("NAC_MISSING_TEST_KEY", None);
        set_env("NAC_EMPTY_TEST_KEY", Some(""));
        set_env("NAC_SPACE_TEST_KEY", Some("  \t "));

        for selector in [None, Some(""), Some("   ")] {
            let error = api_key_for_backend(BackendKind::OpenAiResponses, selector).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("nonblank api_key_env"));
        }
        for selector in ["9INVALID", "HAS-DASH", " HAS_SPACE"] {
            let error =
                api_key_for_backend(BackendKind::OpenAiResponses, Some(selector)).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(selector));
            assert!(error.to_string().contains("[A-Za-z_][A-Za-z0-9_]*"));
        }
        for selector in names {
            let error =
                api_key_for_backend(BackendKind::OpenAiResponses, Some(selector)).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(selector));
            assert!(!error.to_string().contains("ambient-must-not-win"));
        }

        for (name, value) in original {
            restore_env(name, value);
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_unicode_selected_api_key_is_a_typed_configuration_error() {
        use std::os::unix::ffi::OsStringExt;

        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let name = "NAC_NON_UNICODE_TEST_KEY";
        let original = std::env::var_os(name);
        unsafe { std::env::set_var(name, OsString::from_vec(vec![0xff, 0xfe])) };

        let error = api_key_for_backend(BackendKind::OpenAiResponses, Some(name)).unwrap_err();
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains(name));
        assert!(error.to_string().contains("non-Unicode"));

        restore_env(name, original);
    }

    fn effective_settings(
        backend: BackendKind,
        base_url: &str,
        api_key_env: Option<&str>,
    ) -> EffectiveModelSettings {
        EffectiveModelSettings::new(
            backend,
            "test-model".to_string(),
            base_url.to_string(),
            None,
            api_key_env.map(str::to_string),
            std::collections::BTreeMap::new(),
        )
        .unwrap()
    }

    #[test]
    fn arcee_auth_rejects_nonempty_api_key_env_before_credentials() {
        let expected = "invalid model configuration: api_key_env 'ARCEE_API_KEY' is not supported for backend 'arcee-auth'; managed Arcee auth uses arcee_auth.json";
        let error = ModelClient::from_effective_settings(
            EffectiveModelSettings::new(
                BackendKind::ArceeAuth,
                "test-model".to_string(),
                "https://api.arcee.ai".to_string(),
                None,
                Some("ARCEE_API_KEY".to_string()),
                std::collections::BTreeMap::new(),
            )
            .unwrap(),
        )
        .expect_err("managed Arcee configuration must reject api_key_env");
        assert_eq!(error.to_string(), expected);
    }

    #[test]
    fn backend_kind_parses_and_serializes_explicit_arcee_modes() {
        for (raw, expected) in [
            ("arcee-auth", BackendKind::ArceeAuth),
            ("arcee-api", BackendKind::ArceeApi),
        ] {
            let parsed: BackendKind = serde_json::from_str(&format!("\"{raw}\"")).unwrap();
            assert_eq!(parsed, expected);
            assert_eq!(parsed.to_string(), raw);
            assert_eq!(
                serde_json::to_string(&parsed).unwrap(),
                format!("\"{raw}\"")
            );
        }
    }

    #[test]
    fn removed_backend_names_require_settings_repair() {
        for raw in ["arcee", "auto"] {
            let error = serde_json::from_str::<BackendKind>(&format!("\"{raw}\""))
                .unwrap_err()
                .to_string();
            assert!(error.contains("unsupported backend"), "{error}");
            assert!(error.contains("settings repair required"), "{error}");
        }
    }

    #[test]
    fn managed_backends_reject_any_present_api_key_selector() {
        for (backend, source) in [
            (BackendKind::ArceeAuth, "arcee_auth.json"),
            (
                BackendKind::ChatGptCodexResponses,
                "stored OAuth from auth.json",
            ),
        ] {
            for selector in ["MANAGED_KEY", "", "   ", " SURROUNDED_KEY "] {
                let error = validate_backend_api_key_env(
                    backend,
                    Some("https://service.example"),
                    Some(selector),
                )
                .expect_err("managed credentials must reject every present api_key_env");
                assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
                assert!(error.to_string().contains(source));
                assert!(error.to_string().contains("is not supported"));
            }
        }
    }

    #[test]
    fn effective_settings_require_explicit_valid_model_tuple() {
        for (backend, model, base_url, expected) in [
            (
                None,
                Some("model".to_string()),
                Some("https://example.com".to_string()),
                "backend",
            ),
            (
                Some(BackendKind::OpenAiResponses),
                None,
                Some("https://example.com".to_string()),
                "model",
            ),
            (
                Some(BackendKind::OpenAiResponses),
                Some("model".to_string()),
                None,
                "base_url",
            ),
            (
                Some(BackendKind::OpenAiResponses),
                Some("model".to_string()),
                Some("not a url".to_string()),
                "base_url",
            ),
        ] {
            let error = EffectiveModelSettings::from_optional(
                backend,
                model,
                base_url,
                None,
                None,
                std::collections::BTreeMap::new(),
            )
            .unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(expected), "{error:#}");
        }
    }

    #[test]
    fn managed_backends_materialize_only_absent_base_urls() {
        for (backend, expected) in [
            (
                BackendKind::ChatGptCodexResponses,
                CHATGPT_CODEX_CANONICAL_BASE_URL,
            ),
            (BackendKind::ArceeAuth, ARCEE_AUTH_CANONICAL_BASE_URL),
        ] {
            let materialized = EffectiveModelSettings::from_optional(
                Some(backend),
                Some("model".to_string()),
                None,
                None,
                None,
                std::collections::BTreeMap::new(),
            )
            .expect("managed backend should materialize its absent base URL");
            assert_eq!(materialized.base_url, expected);

            let configured = EffectiveModelSettings::from_optional(
                Some(backend),
                Some("model".to_string()),
                Some(expected.to_string()),
                None,
                None,
                std::collections::BTreeMap::new(),
            )
            .expect("matching configured managed base URL should remain accepted");
            assert_eq!(configured.base_url, expected);

            let error = EffectiveModelSettings::from_optional(
                Some(backend),
                Some("model".to_string()),
                Some("   ".to_string()),
                None,
                None,
                std::collections::BTreeMap::new(),
            )
            .expect_err("a present invalid base URL must not be replaced by the default");
            assert!(error.to_string().contains("must not be blank"), "{error:#}");
        }

        let error = EffectiveModelSettings::from_optional(
            Some(BackendKind::OpenAiResponses),
            Some("model".to_string()),
            None,
            None,
            None,
            std::collections::BTreeMap::new(),
        )
        .expect_err("API-key backends must not acquire a base URL default");
        assert!(error.to_string().contains("base_url"), "{error:#}");
    }

    #[test]
    fn effective_settings_reject_unsupported_reasoning_before_client_or_persistence() {
        let all = [
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ];
        let cases: &[(BackendKind, &str, &[ReasoningEffort])] = &[
            (
                BackendKind::DeepSeekChat,
                "model",
                &[
                    ReasoningEffort::None,
                    ReasoningEffort::High,
                    ReasoningEffort::Xhigh,
                ],
            ),
            (
                BackendKind::FireworksChat,
                "model",
                &[
                    ReasoningEffort::None,
                    ReasoningEffort::Low,
                    ReasoningEffort::Medium,
                    ReasoningEffort::High,
                ],
            ),
            (
                BackendKind::TogetherChat,
                "model",
                &[
                    ReasoningEffort::None,
                    ReasoningEffort::Low,
                    ReasoningEffort::Medium,
                    ReasoningEffort::High,
                ],
            ),
            (BackendKind::OpenAiResponses, "model", &all),
            (BackendKind::ChatGptCodexResponses, "model", &all),
            (
                BackendKind::AnthropicMessages,
                "claude-opus-4-6",
                &[
                    ReasoningEffort::None,
                    ReasoningEffort::Low,
                    ReasoningEffort::Medium,
                    ReasoningEffort::High,
                    ReasoningEffort::Xhigh,
                ],
            ),
            (BackendKind::ArceeAuth, "model", &[]),
            (BackendKind::ArceeApi, "model", &[]),
        ];

        for (backend, model, supported) in cases {
            EffectiveModelSettings::new(
                *backend,
                (*model).into(),
                "https://example.com/v1".into(),
                None,
                None,
                std::collections::BTreeMap::new(),
            )
            .expect("absent effort must be valid for every backend");
            for effort in all {
                let result = EffectiveModelSettings::new(
                    *backend,
                    (*model).into(),
                    "https://example.com/v1".into(),
                    Some(effort),
                    None,
                    std::collections::BTreeMap::new(),
                );
                if supported.contains(&effort) {
                    result.unwrap_or_else(|error| {
                        panic!("{backend} rejected {}: {error:#}", effort.as_str())
                    });
                } else {
                    let error = result
                        .expect_err("unsupported effort must fail effective settings validation");
                    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
                    assert!(error.to_string().contains(effort.as_str()), "{error:#}");
                    assert!(error.to_string().contains(backend.as_str()), "{error:#}");
                }
            }
        }
    }

    #[test]
    fn anthropic_reasoning_capability_matrix_is_model_dependent_and_conservative() {
        let all = [
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ];
        let standard = [
            ReasoningEffort::None,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
        ];
        let with_max = [
            ReasoningEffort::None,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ];
        let none_only = [ReasoningEffort::None];
        let cases: &[(&str, &[ReasoningEffort])] = &[
            ("claude-opus-4-6", &with_max),
            ("claude-opus-4-6-20260205", &with_max),
            ("claude-sonnet-4-6", &standard),
            ("claude-sonnet-4-6-20260217", &standard),
            ("claude-opus-4-5", &none_only),
            ("claude-sonnet-4-5", &none_only),
            ("claude-opus-4-6-latest", &none_only),
            ("claude-always-on-future", &none_only),
        ];

        for (model, supported) in cases {
            validate_model_reasoning_effort(BackendKind::AnthropicMessages, model, None)
                .expect("absent effort must never select Anthropic thinking controls");
            for effort in all {
                let result = validate_model_reasoning_effort(
                    BackendKind::AnthropicMessages,
                    model,
                    Some(effort),
                );
                if supported.contains(&effort) {
                    result.unwrap_or_else(|error| {
                        panic!(
                            "Anthropic model {model} rejected {}: {error:#}",
                            effort.as_str()
                        )
                    });
                } else {
                    let error = result.expect_err("unsupported model/effort pair must fail");
                    assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
                    assert!(error.to_string().contains(model), "{error:#}");
                    assert!(error.to_string().contains(effort.as_str()), "{error:#}");
                }
            }
        }
    }

    #[test]
    fn stored_codex_auth_config_and_store_failures_remain_distinct() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let settings = effective_settings(
            BackendKind::ChatGptCodexResponses,
            "https://chatgpt.com/backend-api",
            None,
        );

        for (label, contents, expected) in [
            ("missing-codex-auth", None, "not configured"),
            (
                "malformed-codex-auth",
                Some("{not-json}"),
                "failed to parse",
            ),
            (
                "wrong-provider-codex-auth",
                Some(r#"{"type":"other"}"#),
                "provider type",
            ),
            (
                "blank-codex-auth",
                Some(
                    r#"{"type":"chatgpt-codex","access":"secret-not-for-errors","refresh":" ","expires_at_ms":1,"account_id":"account"}"#,
                ),
                "nonblank field 'refresh'",
            ),
        ] {
            let _env = IsolatedModelEnv::new(label, contents, None, None);
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains(expected), "{error:#}");
            assert!(!error.to_string().contains("secret-not-for-errors"));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let env = IsolatedModelEnv::new(
                "codex-auth-unsafe-permissions",
                Some(&stored_codex_auth()),
                None,
                None,
            );
            std::fs::set_permissions(
                env.home.join("auth.json"),
                std::fs::Permissions::from_mode(0o644),
            )
            .unwrap();
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("unsafe permissions 0644"));
            assert!(error.to_string().contains("mode to 0600"));
            assert!(!format!("{error:#}").contains("access-test"));
        }

        {
            let env = IsolatedModelEnv::new("codex-auth-path-io", None, None, None);
            std::fs::create_dir(env.home.join("auth.json")).unwrap();
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert_eq!(error.to_string(), "failed to load stored Codex credentials");
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let env =
                IsolatedModelEnv::new("codex-lock-symlink", Some(&stored_codex_auth()), None, None);
            let target = env.home.join("lock-target");
            std::fs::write(&target, "unchanged").unwrap();
            symlink(&target, env.home.join("auth.auth.json.lock")).unwrap();
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert_eq!(error.to_string(), "failed to load stored Codex credentials");
            assert!(format!("{error:#}").contains("symlink auth lock"));
            assert_eq!(std::fs::read_to_string(target).unwrap(), "unchanged");
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            let env = IsolatedModelEnv::new("codex-auth-symlink", None, None, None);
            let target = env.home.join("target.json");
            std::fs::write(&target, stored_codex_auth()).unwrap();
            symlink(&target, env.home.join("auth.json")).unwrap();
            let error = ModelClient::from_effective_settings(settings).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert_eq!(error.to_string(), "failed to load stored Codex credentials");
            assert!(format!("{error:#}").contains("symlink credential path"));
        }
    }

    #[test]
    fn invalid_codex_endpoint_fails_before_credentials_or_connection() {
        use std::net::TcpListener;

        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}/backend-api", listener.local_addr().unwrap());
        let _env = IsolatedModelEnv::new("codex-no-connection", None, None, None);

        let error = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ChatGptCodexResponses,
            &endpoint,
            None,
        ))
        .unwrap_err();

        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
        assert!(error.to_string().contains("requires HTTPS"));
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(listener.accept().is_err(), "invalid endpoint was contacted");
    }

    #[test]
    fn stored_arcee_auth_config_and_store_failures_remain_distinct() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let settings = effective_settings(BackendKind::ArceeAuth, "https://api.arcee.ai", None);

        {
            let _env = IsolatedModelEnv::new("missing-stored-auth", None, None, None);
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("Arcee auth is not configured"));
        }
        {
            let env = IsolatedModelEnv::new("malformed-stored-auth", None, None, None);
            write_test_credential(&env.home.join("arcee_auth.json"), "{not-json}");
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error
                .to_string()
                .contains("failed to parse stored Arcee auth"));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let env = IsolatedModelEnv::new("arcee-auth-unsafe-permissions", None, None, None);
            write_test_credential(
                &env.home.join("arcee_auth.json"),
                stored_arcee_auth("secret-not-for-errors", "https://api.arcee.ai"),
            );
            std::fs::set_permissions(
                env.home.join("arcee_auth.json"),
                std::fs::Permissions::from_mode(0o660),
            )
            .unwrap();
            let error = ModelClient::from_effective_settings(settings.clone()).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("unsafe permissions 0660"));
            assert!(error.to_string().contains("mode to 0600"));
            assert!(!format!("{error:#}").contains("secret-not-for-errors"));
        }
        {
            let env = IsolatedModelEnv::new("stored-auth-path-io", None, None, None);
            std::fs::create_dir(env.home.join("arcee_auth.json")).unwrap();
            let error = ModelClient::from_effective_settings(settings).unwrap_err();
            assert!(error.downcast_ref::<ModelConfigurationError>().is_none());
            assert_eq!(error.to_string(), "failed to load stored Arcee credentials");
        }
    }

    #[test]
    fn explicit_arcee_backend_binds_stored_key_to_its_origin() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let auth = stored_arcee_auth("rcai-test", "https://stored.arcee.ai");
        let env = IsolatedModelEnv::new("explicit-arcee", None, None, None);
        write_test_credential(&env.home.join("arcee_auth.json"), &auth);

        let requested_base = "https://stored.arcee.ai:443/api/v1/";
        let client = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ArceeAuth,
            requested_base,
            None,
        ))
        .expect("the stored credential should work on the same approved origin");
        assert_eq!(client.base_url(), requested_base);

        let mismatch = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ArceeAuth,
            "https://api.internal.arcee.ai/api",
            None,
        ))
        .unwrap_err();
        assert!(mismatch
            .to_string()
            .contains("does not match the stored credential origin"));
    }

    #[tokio::test]
    async fn existing_arcee_client_rejects_credentials_rotated_to_another_origin() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let initial_token = "initial-token-must-not-leak";
        let rotated_token = "rotated-token-must-not-leak";
        let env = IsolatedModelEnv::new("rotated-arcee-origin", None, None, None);
        let auth_path = env.home.join("arcee_auth.json");
        write_test_credential(
            &auth_path,
            stored_arcee_auth(initial_token, "https://api.arcee.ai"),
        );
        let client = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ArceeAuth,
            "https://api.arcee.ai/api/v1",
            None,
        ))
        .expect("initial credential origin should match the session");

        write_test_credential(
            &auth_path,
            stored_arcee_auth(rotated_token, "https://tenant.arcee.ai"),
        );

        let fresh_error = client
            .send_turn(Vec::new(), Vec::new())
            .await
            .expect_err("a fresh reload must reject a credential from another origin");
        let forced_error = arcee::force_refresh_access_token(
            &arcee::no_redirect_client().unwrap(),
            client.base_url(),
            initial_token,
        )
        .await
        .expect_err("a forced refresh must reject a credential from another origin");

        for error in [fresh_error, forced_error] {
            let diagnostic = format!("{error:#}");
            assert!(
                diagnostic.contains("does not match the stored credential origin"),
                "unexpected origin mismatch: {diagnostic}"
            );
            assert!(!diagnostic.contains(initial_token));
            assert!(!diagnostic.contains(rotated_token));
        }
    }

    #[test]
    fn both_arcee_modes_validate_endpoints_and_sensitive_headers() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let auth = stored_arcee_auth("stored-arcee-secret", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("canonical-modes", None, None, None);
        write_test_credential(&env.home.join("arcee_auth.json"), &auth);
        let selector = "NAC_ARCEE_CANONICAL_TEST_KEY";
        let original = std::env::var_os(selector);
        set_env(selector, Some("api-arcee-secret"));

        for (backend, api_key_env) in [
            (BackendKind::ArceeAuth, None),
            (BackendKind::ArceeApi, Some(selector)),
        ] {
            let endpoint_error = ModelClient::from_effective_settings(effective_settings(
                backend,
                "https://not-arcee.example/v1",
                api_key_env,
            ))
            .unwrap_err();
            assert!(endpoint_error
                .to_string()
                .contains("not an approved Arcee origin"));

            let mut settings = effective_settings(backend, "https://api.arcee.ai", api_key_env);
            settings
                .extra_headers
                .insert("Authorization".to_string(), "must-not-override".to_string());
            let header_error = ModelClient::from_effective_settings(settings).unwrap_err();
            assert!(header_error.to_string().contains("Authorization"));
        }
        restore_env(selector, original);
    }

    #[test]
    fn arcee_api_uses_only_the_selected_variable() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let selector = "NAC_ARCEE_API_TEST_KEY";
        let original = std::env::var_os(selector);
        set_env(selector, Some("arcee-api-selected-secret"));
        let env = IsolatedModelEnv::new("arcee-api", None, None, None);
        write_test_credential(&env.home.join("arcee_auth.json"), "{not-json}");

        let client = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ArceeApi,
            "https://api.arcee.ai/api/v1",
            Some(selector),
        ))
        .expect("arcee-api should use only the selected variable");
        assert_eq!(client.backend(), BackendKind::ArceeApi);
        restore_env(selector, original);
    }

    #[test]
    fn tampered_stored_arcee_url_is_rejected_before_client_creation() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let tampered = stored_arcee_auth("rcai-never-use", "https://attacker.example/steal");
        let env = IsolatedModelEnv::new("tampered-stored-url", None, None, None);
        write_test_credential(&env.home.join("arcee_auth.json"), tampered);

        let error = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ArceeAuth,
            "https://api.arcee.ai",
            None,
        ))
        .unwrap_err();
        assert!(error.to_string().contains("invalid base_url"));
    }

    #[test]
    fn arcee_and_codex_auth_coexist_and_logout_independently() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let codex = stored_codex_auth();
        let arcee = stored_arcee_auth("rcai-test", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("coexist", Some(&codex), None, None);
        write_test_credential(&env.home.join("arcee_auth.json"), &arcee);

        let loaded = arcee::read_stored_auth().unwrap();
        assert_eq!(loaded.access_token, "rcai-test");
        codex_auth_status().unwrap();

        arcee_auth_logout().unwrap();
        assert!(!env.home.join("arcee_auth.json").exists());
        assert_eq!(
            std::fs::read_to_string(env.home.join("auth.json")).unwrap(),
            codex
        );

        write_test_credential(&env.home.join("arcee_auth.json"), &arcee);
        codex_auth_logout().unwrap();
        assert!(!env.home.join("auth.json").exists());
        assert_eq!(
            std::fs::read_to_string(env.home.join("arcee_auth.json")).unwrap(),
            arcee
        );
    }

    #[test]
    fn legacy_shaped_auth_json_is_ignored_and_unchanged_by_arcee_status_and_client_creation() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let legacy = stored_arcee_auth("rcai-legacy", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("legacy-ignored", Some(&legacy), None, None);
        let auth_path = env.home.join("auth.json");
        let canonical_path = env.home.join("arcee_auth.json");
        let before = std::fs::read(&auth_path).unwrap();

        arcee_auth_status().unwrap();
        assert_eq!(std::fs::read(&auth_path).unwrap(), before);
        assert!(!canonical_path.exists());
        assert_eq!(directory_names(&env.home), ["auth.json"]);

        let error = ModelClient::from_effective_settings(effective_settings(
            BackendKind::ArceeAuth,
            "https://api.arcee.ai",
            None,
        ))
        .expect_err("legacy auth.json must not authenticate arcee-auth");
        assert!(error.to_string().contains("Arcee auth is not configured"));
        assert_eq!(std::fs::read(&auth_path).unwrap(), before);
        assert!(!canonical_path.exists());
        assert_eq!(directory_names(&env.home), ["auth.json"]);
    }

    #[test]
    fn codex_status_and_logout_ignore_legacy_shaped_arcee_auth_json() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let legacy = stored_arcee_auth("rcai-legacy", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("codex-foreign-arcee", Some(&legacy), None, None);
        let auth_path = env.home.join("auth.json");
        let canonical_path = env.home.join("arcee_auth.json");
        let before = std::fs::read(&auth_path).unwrap();

        codex_auth_status().unwrap();
        assert_eq!(directory_names(&env.home), ["auth.json"]);
        codex_auth_logout().unwrap();

        assert_eq!(std::fs::read(&auth_path).unwrap(), before);
        assert!(!canonical_path.exists());
    }

    #[test]
    fn anthropic_request_omits_none_and_maps_supported_efforts_exactly() {
        let messages = [Message::User {
            content: "read a file".to_string(),
        }];
        for effort in [None, Some(ReasoningEffort::None)] {
            let request =
                anthropic_messages_request("claude-always-on-future", effort, &messages, &[], None)
                    .unwrap();
            assert_eq!(request["max_tokens"], 128000);
            assert!(request.get("thinking").is_none());
            assert!(request.get("output_config").is_none());
            assert!(!request.to_string().contains("disabled"));
        }

        for (effort, wire_effort) in [
            (ReasoningEffort::Low, "low"),
            (ReasoningEffort::Medium, "medium"),
            (ReasoningEffort::High, "high"),
            (ReasoningEffort::Xhigh, "max"),
        ] {
            let request =
                anthropic_messages_request("claude-opus-4-6", Some(effort), &messages, &[], None)
                    .unwrap();
            assert_eq!(request["thinking"], json!({"type": "adaptive"}));
            assert_eq!(request["output_config"], json!({"effort": wire_effort}));
        }
    }

    #[test]
    fn anthropic_request_with_1h_ttl_sets_ttl_on_all_breakpoints() {
        let request = anthropic_messages_request(
            "claude-sonnet-4-6",
            None,
            &[
                Message::System {
                    content: "system".to_string(),
                },
                Message::User {
                    content: "hello".to_string(),
                },
            ],
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read".to_string(),
                    parameters: json!({"type": "object"}),
                },
            }],
            Some("1h"),
        )
        .unwrap();

        // System breakpoint has 1h TTL.
        assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(request["system"][0]["cache_control"]["ttl"], "1h");
        // Tool breakpoint has 1h TTL.
        assert_eq!(request["tools"][0]["cache_control"]["type"], "ephemeral");
        assert_eq!(request["tools"][0]["cache_control"]["ttl"], "1h");
        // Last message breakpoint has 1h TTL.
        assert_eq!(
            request["messages"][0]["content"][0]["cache_control"]["ttl"],
            "1h"
        );
    }

    #[test]
    fn anthropic_request_with_no_messages_skips_message_breakpoint() {
        let request = anthropic_messages_request(
            "claude-sonnet-4-6",
            None,
            &[Message::System {
                content: "system only".to_string(),
            }],
            &[],
            None,
        )
        .unwrap();

        // System breakpoint still set.
        assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
        // No tools → no tools key.
        assert!(request.get("tools").is_none());
        // No messages → empty array, no crash.
        assert_eq!(request["messages"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn anthropic_response_tool_thinking_round_trips() {
        let thinking = json!({
            "type": "thinking",
            "thinking": "",
            "signature": "sig_1"
        });
        let redacted = json!({
            "type": "redacted_thinking",
            "data": "opaque"
        });
        let parsed = parse_anthropic_messages_response(
            &json!({
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "content": [
                    thinking.clone(),
                    redacted.clone(),
                    {"type": "text", "text": "Need to inspect the file."},
                    {
                        "type": "tool_use",
                        "id": "toolu_1",
                        "name": "read",
                        "input": {"path": "src/main.rs"}
                    }
                ],
                "stop_reason": "tool_use",
                "usage": {"input_tokens": 10, "output_tokens": 20}
            }),
            "https://api.anthropic.com/v1/messages",
        )
        .unwrap();

        assert_eq!(
            parsed.assistant.content.as_deref(),
            Some("Need to inspect the file.")
        );
        assert_eq!(
            parsed.assistant.reasoning_details,
            Some(json!([thinking.clone(), redacted.clone()]))
        );
        assert_eq!(parsed.finish_reason.as_deref(), Some("tool_use"));
        let tool_call = &parsed
            .assistant
            .tool_calls
            .as_ref()
            .expect("tool_use should become a tool call")[0];
        assert_eq!(tool_call.id, "toolu_1");
        assert_eq!(tool_call.function.name, "read");
        assert_eq!(
            serde_json::from_str::<Value>(&tool_call.function.arguments).unwrap(),
            json!({"path": "src/main.rs"})
        );
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 30);

        let request = anthropic_messages_request(
            "claude-opus-4-6",
            None,
            &[
                Message::User {
                    content: "please inspect".to_string(),
                },
                Message::Assistant {
                    content: parsed.assistant.content.clone(),
                    reasoning_text: None,
                    reasoning_details: parsed.assistant.reasoning_details.clone(),
                    tool_calls: parsed.assistant.tool_calls.clone(),
                },
                Message::Tool {
                    tool_call_id: "toolu_1".to_string(),
                    content: "file contents".to_string(),
                },
            ],
            &[],
            None,
        )
        .unwrap();

        let assistant_blocks = request["messages"][1]["content"]
            .as_array()
            .expect("assistant content should be blocks");
        assert_eq!(assistant_blocks[0], thinking);
        assert_eq!(assistant_blocks[1], redacted);
        assert_eq!(assistant_blocks[3]["type"], "tool_use");
        assert_eq!(assistant_blocks[3]["input"], json!({"path": "src/main.rs"}));
        assert_eq!(request["messages"][2]["role"], "user");
        assert_eq!(request["messages"][2]["content"][0]["type"], "tool_result");
        assert_eq!(
            request["messages"][2]["content"][0]["tool_use_id"],
            "toolu_1"
        );
    }

    #[test]
    fn deepseek_request_reasoning_is_driven_only_by_explicit_effort() {
        let messages = [Message::Assistant {
            content: Some("calling a tool".to_string()),
            reasoning_text: Some("need current context".to_string()),
            reasoning_details: None,
            tool_calls: None,
        }];
        let absent = deepseek_chat_request("deepseek-v4-pro", None, &messages, &[]);
        assert!(absent.get("thinking").is_none());
        assert!(absent.get("reasoning_effort").is_none());
        assert_eq!(
            absent["messages"][0]["reasoning_content"],
            "need current context"
        );

        let disabled = deepseek_chat_request(
            "deepseek-v4-pro",
            Some(ReasoningEffort::None),
            &messages,
            &[],
        );
        assert_eq!(disabled["thinking"], json!({"type": "disabled"}));
        assert!(disabled.get("reasoning_effort").is_none());

        for (effort, wire_effort) in [
            (ReasoningEffort::High, "high"),
            (ReasoningEffort::Xhigh, "max"),
        ] {
            let request = deepseek_chat_request("deepseek-v4-pro", Some(effort), &messages, &[]);
            assert_eq!(request["thinking"], json!({"type": "enabled"}));
            assert_eq!(request["reasoning_effort"], wire_effort);
        }
    }

    #[test]
    fn openai_compatible_request_schemas_honor_absent_none_and_supported_efforts() {
        let messages = [Message::User {
            content: "hi".into(),
        }];

        let fireworks_absent = fireworks_chat_request("model", None, &messages, &[]);
        assert!(fireworks_absent.get("reasoning_effort").is_none());
        assert!(fireworks_absent.get("reasoning_history").is_none());
        let fireworks_none =
            fireworks_chat_request("model", Some(ReasoningEffort::None), &messages, &[]);
        assert_eq!(fireworks_none["reasoning_effort"], "none");
        assert_eq!(fireworks_none["reasoning_history"], "disabled");
        for effort in [
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
        ] {
            let request = fireworks_chat_request("model", Some(effort), &messages, &[]);
            assert_eq!(request["reasoning_effort"], effort.as_str());
            assert_eq!(request["reasoning_history"], "preserved");
        }

        let together_absent = together_chat_request("model", None, &messages, &[]);
        assert!(together_absent.get("reasoning").is_none());
        assert!(together_absent.get("reasoning_effort").is_none());
        assert!(together_absent.get("chat_template_kwargs").is_none());
        let together_none =
            together_chat_request("model", Some(ReasoningEffort::None), &messages, &[]);
        assert_eq!(together_none["reasoning"], json!({"enabled": false}));
        assert!(together_none.get("reasoning_effort").is_none());
        for effort in [
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
        ] {
            let request = together_chat_request("model", Some(effort), &messages, &[]);
            assert_eq!(request["reasoning"], json!({"enabled": true}));
            assert_eq!(request["reasoning_effort"], effort.as_str());
            assert_eq!(
                request["chat_template_kwargs"],
                json!({"clear_thinking": false})
            );
        }

        let openai_absent = openai_responses_request("model", None, &messages, &[]);
        assert!(openai_absent.get("reasoning").is_none());
        for effort in [
            ReasoningEffort::None,
            ReasoningEffort::Minimal,
            ReasoningEffort::Low,
            ReasoningEffort::Medium,
            ReasoningEffort::High,
            ReasoningEffort::Xhigh,
        ] {
            let request = openai_responses_request("model", Some(effort), &messages, &[]);
            assert_eq!(request["reasoning"]["effort"], effort.as_str());
        }
    }

    #[test]
    fn responses_input_items_expand_reasoning_and_tool_state() {
        let items = responses_input_items(&[
            Message::System {
                content: "system".to_string(),
            },
            Message::Assistant {
                content: Some("assistant text".to_string()),
                reasoning_text: Some("hidden".to_string()),
                reasoning_details: Some(json!([{
                    "type": "reasoning",
                    "id": "rs_1",
                    "summary": [{"type": "summary_text", "text": "keep this"}]
                }])),
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read".to_string(),
                        arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                    },
                }]),
            },
            Message::Tool {
                tool_call_id: "call_1".to_string(),
                content: "tool output".to_string(),
            },
        ]);

        assert_eq!(items.len(), 5);
        assert_eq!(items[0]["role"], "system");
        assert_eq!(items[1]["type"], "reasoning");
        assert_eq!(items[2]["type"], "function_call");
        assert_eq!(items[3]["role"], "assistant");
        assert_eq!(items[4]["type"], "function_call_output");
    }

    #[test]
    fn parses_deepseek_chat_output() {
        let parsed = parse_chat_completions_response(
            &json!({
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": "done",
                            "reasoning_content": "worked through it",
                            "tool_calls": null
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 20,
                    "total_tokens": 30,
                    "completion_tokens_details": {
                        "reasoning_tokens": 9
                    }
                }
            }),
            "https://api.deepseek.com/chat/completions",
        )
        .unwrap();

        assert_eq!(parsed.assistant.content.as_deref(), Some("done"));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("worked through it")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 30);
    }

    #[test]
    fn parses_openai_responses_output() {
        let parsed = parse_openai_responses_response(
            &json!({
                "status": "completed",
                "output": [
                    {
                        "type": "reasoning",
                        "id": "rs_1",
                        "summary": [{"type": "summary_text", "text": "thought summary"}]
                    },
                    {
                        "type": "function_call",
                        "call_id": "call_1",
                        "name": "read",
                        "arguments": "{\"path\":\"src/main.rs\"}"
                    },
                    {
                        "type": "message",
                        "content": [
                            {"type": "output_text", "text": "hello world"}
                        ]
                    }
                ],
                "usage": {
                    "input_tokens": 10,
                    "output_tokens": 20,
                    "total_tokens": 30,
                    "output_tokens_details": {
                        "reasoning_tokens": 7
                    }
                }
            }),
            "https://api.openai.com/v1/responses",
        )
        .unwrap();

        assert_eq!(parsed.assistant.content.as_deref(), Some("hello world"));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("thought summary")
        );
        assert_eq!(
            parsed
                .assistant
                .tool_calls
                .as_ref()
                .expect("tool calls should be parsed")
                .len(),
            1
        );
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 20);
        assert_eq!(usage.cache_read_tokens, 0);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 30);
    }

    #[test]
    fn parses_openai_responses_usage_with_cached_tokens() {
        let parsed = parse_openai_responses_response(
            &json!({
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": "hi"}]}
                ],
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "total_tokens": 150,
                    "input_tokens_details": {"cached_tokens": 80},
                    "output_tokens_details": {"reasoning_tokens": 10}
                }
            }),
            "https://api.openai.com/v1/responses",
        )
        .unwrap();

        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 20); // 100 - 80 cached
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 80);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 150);
    }

    #[test]
    fn parses_anthropic_usage_with_cache_fields() {
        let parsed = parse_anthropic_messages_response(
            &json!({
                "content": [{"type": "text", "text": "done"}],
                "stop_reason": "end_turn",
                "usage": {
                    "input_tokens": 100,
                    "output_tokens": 50,
                    "cache_read_input_tokens": 200,
                    "cache_creation_input_tokens": 30
                }
            }),
            "https://api.anthropic.com/v1/messages",
        )
        .unwrap();

        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 100);
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 200);
        assert_eq!(usage.cache_write_tokens, 30);
        assert_eq!(usage.orchestrator_context_tokens, 380); // 100 + 50 + 200 + 30
    }

    #[test]
    fn parses_chat_completions_usage_with_cached_tokens() {
        let parsed = parse_chat_completions_response(
            &json!({
                "choices": [{
                    "finish_reason": "stop",
                    "message": {"content": "done", "tool_calls": null}
                }],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                    "prompt_tokens_details": {"cached_tokens": 60},
                    "completion_tokens_details": {"reasoning_tokens": 5}
                }
            }),
            "https://api.deepseek.com/chat/completions",
        )
        .unwrap();

        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 40); // 100 - 60 cached
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 60);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.orchestrator_context_tokens, 150);
    }

    #[test]
    fn response_without_usage_yields_none() {
        let parsed = parse_openai_responses_response(
            &json!({
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": "hi"}]}
                ]
            }),
            "https://api.openai.com/v1/responses",
        )
        .unwrap();

        assert!(parsed.usage.is_none());
    }

    #[test]
    fn parses_together_chat_response() {
        let parsed = parse_together_chat_response(
            &json!({
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": "The answer is 42.",
                            "reasoning": "I need to think about this carefully...",
                            "tool_calls": null
                        }
                    }
                ],
                "usage": {
                    "prompt_tokens": 100,
                    "completion_tokens": 50,
                    "total_tokens": 150,
                    "cached_tokens": 60,
                    "reasoning_tokens": 25
                }
            }),
            "https://api.together.ai/v1/chat/completions",
        )
        .unwrap();

        assert_eq!(
            parsed.assistant.content.as_deref(),
            Some("The answer is 42.")
        );
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("I need to think about this carefully...")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 40); // 100 - 60 cached
        assert_eq!(usage.output_tokens, 50);
        assert_eq!(usage.cache_read_tokens, 60);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.reasoning_tokens, 25);
        assert_eq!(usage.orchestrator_context_tokens, 150);
    }

    #[test]
    fn parses_together_chat_response_nested_usage() {
        let parsed = parse_together_chat_response(
            &json!({
                "choices": [{
                    "finish_reason": "stop",
                    "message": {
                        "content": "The answer is 4.",
                        "reasoning": "We need to calculate 2+2. That equals 4.",
                        "tool_calls": null
                    }
                }],
                "usage": {
                    "prompt_tokens": 2618,
                    "completion_tokens": 74,
                    "total_tokens": 2692,
                    "prompt_tokens_details": {"cached_tokens": 2560},
                    "completion_tokens_details": {"reasoning_tokens": 71}
                }
            }),
            "https://api.together.ai/v1/chat/completions",
        )
        .unwrap();

        assert_eq!(
            parsed.assistant.content.as_deref(),
            Some("The answer is 4.")
        );
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("We need to calculate 2+2. That equals 4.")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 58); // 2618 - 2560 cached
        assert_eq!(usage.output_tokens, 74);
        assert_eq!(usage.cache_read_tokens, 2560);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.reasoning_tokens, 71);
        assert_eq!(usage.orchestrator_context_tokens, 2692);
    }
}
