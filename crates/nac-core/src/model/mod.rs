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
pub(crate) use backend::detect_backend;
pub use backend::validate_backend_api_key_env;
use chatgpt_codex::{codex_auth_login, codex_auth_logout, codex_auth_status};
pub use client::validate_model_configuration;
pub(crate) use client::ModelClient;
pub(crate) use types::{AssistantTurn, ClientOverrides, ModelTurnResponse, TokenUsage};
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
    {
        model_configuration_error(error.to_string())
    } else {
        error.context("failed to load stored Arcee credentials")
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
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::thread;
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
                std::fs::write(home.join("auth.json"), contents).unwrap();
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

    fn set_env(name: &str, value: Option<&str>) {
        match value {
            Some(value) => unsafe { std::env::set_var(name, value) },
            None => unsafe { std::env::remove_var(name) },
        }
    }

    fn stored_arcee_auth(api_key: &str, base_url: &str) -> String {
        json!({
            "type": "arcee_api_key",
            "api_key": api_key,
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

    #[test]
    fn test_missing_api_key_error() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original = std::env::var("OPENAI_API_KEY").ok();
        let original_nac_home = std::env::var_os("NAC_HOME");
        let empty_home = std::env::temp_dir().join("nac-missing-api-key-test-home");
        unsafe {
            std::env::remove_var("OPENAI_API_KEY");
            std::env::set_var("NAC_HOME", &empty_home);
        }

        let result = ModelClient::from_env();
        assert!(result.is_err(), "Expected error when API key missing");
        let err_msg = result
            .err()
            .expect("Expected missing-key error")
            .to_string();
        assert!(
            err_msg.contains("OPENAI_API_KEY"),
            "Error should mention OPENAI_API_KEY, got: {}",
            err_msg
        );

        if let Some(key) = original {
            unsafe {
                std::env::set_var("OPENAI_API_KEY", key);
            }
        } else {
            unsafe {
                std::env::remove_var("OPENAI_API_KEY");
            }
        }
        restore_env("NAC_HOME", original_nac_home);
    }

    #[test]
    fn resolved_arcee_rejects_nonempty_api_key_env_before_credentials() {
        let expected = "invalid model configuration: api_key_env is not supported for backend 'arcee'; approved Arcee endpoints use stored login credentials and custom endpoints use OPENAI_API_KEY";
        let cases = [
            ClientOverrides {
                backend: Some(BackendKind::Arcee),
                api_key_env: Some("ARCEE_API_KEY".to_string()),
                ..ClientOverrides::default()
            },
            ClientOverrides {
                backend: Some(BackendKind::Arcee),
                base_url: Some("http://127.0.0.1:8080".to_string()),
                api_key_env: Some("CUSTOM_KEY".to_string()),
                ..ClientOverrides::default()
            },
            ClientOverrides {
                backend: Some(BackendKind::Auto),
                base_url: Some("https://api.arcee.ai/custom".to_string()),
                api_key_env: Some("AUTO_KEY".to_string()),
                ..ClientOverrides::default()
            },
        ];

        for overrides in cases {
            let error = ModelClient::from_env_with_overrides(overrides)
                .err()
                .expect("resolved Arcee configuration must reject api_key_env");
            assert_eq!(error.to_string(), expected);
        }
    }

    #[test]
    fn resolved_arcee_allows_absent_or_empty_api_key_env() {
        for api_key_env in [None, Some(""), Some("   ")] {
            validate_backend_api_key_env(
                BackendKind::Arcee,
                Some("https://api.arcee.ai"),
                api_key_env,
            )
            .expect("empty api_key_env must be treated as absent");
        }
    }

    #[test]
    fn explicit_deepseek_backend_defaults_to_deepseek_url_and_model() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();

        let original_openai_key = std::env::var_os("OPENAI_API_KEY");
        let original_base_url = std::env::var_os("OPENAI_BASE_URL");
        let original_model = std::env::var_os("OPENAI_MODEL");

        unsafe {
            std::env::set_var("OPENAI_API_KEY", "test_openai_key");
            std::env::remove_var("OPENAI_BASE_URL");
            std::env::remove_var("OPENAI_MODEL");
        }

        let client = ModelClient::from_env_with_overrides(ClientOverrides {
            backend: Some(BackendKind::DeepSeekChat),
            ..ClientOverrides::default()
        })
        .unwrap();

        assert_eq!(client.base_url(), "https://api.deepseek.com");
        assert_eq!(client.backend(), BackendKind::DeepSeekChat);
        assert_eq!(client.model, "deepseek-v4-pro");
        assert_eq!(client.reasoning_effort(), None);

        restore_env("OPENAI_API_KEY", original_openai_key);
        restore_env("OPENAI_BASE_URL", original_base_url);
        restore_env("OPENAI_MODEL", original_model);
    }

    #[test]
    fn automatic_backend_ignores_stored_arcee_auth_state() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let current_auth = stored_arcee_auth("rcai-current", "https://api.arcee.ai");
        // Credential freshness cannot be checked locally. A structurally valid but
        // expired key must be just as irrelevant to automatic provider selection.
        let stale_auth = stored_arcee_auth("rcai-expired", "https://api.arcee.ai");
        let cases = [
            ("current", current_auth.as_str()),
            ("stale", stale_auth.as_str()),
            ("corrupt", "{ not valid json"),
        ];

        for (label, auth_contents) in cases {
            let _env =
                IsolatedModelEnv::new(label, Some(auth_contents), Some("test_openai_key"), None);
            let client = ModelClient::from_env_with_overrides(ClientOverrides::default())
                .unwrap_or_else(|error| panic!("{label} Arcee auth changed Auto: {error:#}"));

            assert_eq!(client.backend(), BackendKind::OpenAiResponses, "{label}");
            assert_eq!(client.base_url(), "https://api.openai.com/v1", "{label}");
        }
    }

    #[test]
    fn automatic_backend_does_not_fall_back_to_stored_arcee_auth() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let stale_auth = stored_arcee_auth("rcai-expired", "https://api.arcee.ai");
        let _env = IsolatedModelEnv::new("no-openai-key", Some(&stale_auth), None, None);

        let error = ModelClient::from_env_with_overrides(ClientOverrides::default())
            .err()
            .expect("Auto must require OpenAI credentials without an explicit Arcee URL");
        assert!(
            error.to_string().contains("OPENAI_API_KEY"),
            "unexpected error: {error:#}"
        );
    }

    #[test]
    fn stored_arcee_auth_config_and_store_failures_remain_distinct() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let overrides = ClientOverrides {
            backend: Some(BackendKind::Arcee),
            ..ClientOverrides::default()
        };

        {
            let _env = IsolatedModelEnv::new("missing-stored-auth", None, None, None);
            let error = ModelClient::from_env_with_overrides(overrides.clone())
                .err()
                .expect("missing stored auth must fail");
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error.to_string().contains("Arcee auth is not configured"));
        }

        {
            let env = IsolatedModelEnv::new("malformed-stored-auth", None, None, None);
            std::fs::write(env.home.join("arcee_auth.json"), "{not-json}").unwrap();
            let error = ModelClient::from_env_with_overrides(overrides.clone())
                .err()
                .expect("malformed stored auth must fail");
            assert!(error.downcast_ref::<ModelConfigurationError>().is_some());
            assert!(error
                .to_string()
                .contains("failed to parse stored Arcee auth"));
        }

        {
            let env = IsolatedModelEnv::new("stored-auth-lock-io", None, None, None);
            std::fs::create_dir(env.home.join("arcee_auth.json.lock")).unwrap();
            let error = ModelClient::from_env_with_overrides(overrides)
                .err()
                .expect("an unusable credential lock must fail");
            assert!(
                error.downcast_ref::<ModelConfigurationError>().is_none(),
                "credential-store safety failures are not caller configuration errors: {error:#}"
            );
            assert_eq!(error.to_string(), "failed to load stored Arcee credentials");
            assert!(
                format!("{error:#}").contains("non-regular auth lock"),
                "operational cause should remain available internally: {error:#}"
            );
        }
    }

    #[test]
    fn explicit_arcee_backend_binds_stored_key_to_its_origin() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let auth = stored_arcee_auth("rcai-test", "https://stored.arcee.ai");
        let _env = IsolatedModelEnv::new("explicit-arcee", Some(&auth), None, None);

        let requested_base = "https://stored.arcee.ai:443/api/v1/";
        let from_base = ModelClient::from_env_with_overrides(ClientOverrides {
            base_url: Some(requested_base.to_string()),
            ..ClientOverrides::default()
        })
        .expect("the stored credential should work on the same approved origin");
        assert_eq!(from_base.backend(), BackendKind::Arcee);
        assert_eq!(from_base.base_url(), requested_base);

        let mismatch = ModelClient::from_env_with_overrides(ClientOverrides {
            base_url: Some("https://api.internal.arcee.ai/api".to_string()),
            ..ClientOverrides::default()
        })
        .err()
        .expect("a different approved origin must not receive the stored key");
        assert!(
            mismatch
                .to_string()
                .contains("does not match the stored credential origin"),
            "unexpected error: {mismatch:#}"
        );
        assert!(mismatch.downcast_ref::<ModelConfigurationError>().is_some());

        let from_backend = ModelClient::from_env_with_overrides(ClientOverrides {
            backend: Some(BackendKind::Arcee),
            ..ClientOverrides::default()
        })
        .expect("an explicit Arcee backend should use its stored base URL");
        assert_eq!(from_backend.backend(), BackendKind::Arcee);
        assert_eq!(from_backend.base_url(), "https://stored.arcee.ai");
    }

    #[test]
    fn stored_arcee_login_rejects_sensitive_extra_headers_during_client_creation() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let auth = stored_arcee_auth("rcai-never-send", "https://api.arcee.ai");
        let _env = IsolatedModelEnv::new("sensitive-headers", Some(&auth), None, None);

        for name in ["Host", "hOsT", "Authorization", "PROXY-AUTHORIZATION"] {
            let error = ModelClient::from_env_with_overrides(ClientOverrides {
                backend: Some(BackendKind::Arcee),
                extra_headers: std::collections::BTreeMap::from([(
                    name.to_string(),
                    "hostile-value".to_string(),
                )]),
                ..ClientOverrides::default()
            })
            .err()
            .expect("stored Arcee credentials must reject sensitive headers early");
            assert!(
                error.to_string().contains(name),
                "unexpected error: {error:#}"
            );
        }
    }

    #[test]
    fn custom_arcee_endpoint_requires_openai_api_key_without_reading_stored_auth() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let tampered = stored_arcee_auth("rcai-never-use", "http://api.arcee.ai/steal");
        let _env = IsolatedModelEnv::new("custom-key", Some(&tampered), None, None);
        let overrides = ClientOverrides {
            backend: Some(BackendKind::Arcee),
            base_url: Some("http://127.0.0.1:12345/dev".to_string()),
            ..ClientOverrides::default()
        };

        let error = ModelClient::from_env_with_overrides(overrides.clone())
            .err()
            .expect("a custom endpoint without OPENAI_API_KEY must fail");
        assert!(
            error.to_string().contains("custom Arcee endpoint"),
            "unexpected error: {error:#}"
        );
        assert!(error.downcast_ref::<ModelConfigurationError>().is_some());

        set_env("OPENAI_API_KEY", Some("custom-separate-key"));
        let client = ModelClient::from_env_with_overrides(overrides)
            .expect("custom endpoint should use OPENAI_API_KEY without loading stored auth");
        assert_eq!(client.base_url(), "http://127.0.0.1:12345/dev");
    }

    #[tokio::test]
    async fn custom_arcee_request_never_leaks_stored_key_to_hostile_endpoint() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let stored_key = "rcai-stored-secret";
        let custom_key = "custom-separate-secret";
        let auth = stored_arcee_auth(stored_key, "https://api.arcee.ai/stored/path");
        let _env = IsolatedModelEnv::new("custom-no-leak", Some(&auth), Some(custom_key), None);
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind hostile endpoint");
        let address = listener.local_addr().expect("hostile endpoint address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept Arcee request");
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .expect("set request timeout");
            let mut request = [0; 8192];
            let read = stream.read(&mut request).expect("read Arcee request");
            let request = String::from_utf8_lossy(&request[..read]).into_owned();
            stream
                .write_all(
                    b"HTTP/1.1 400 Bad Request\r\nContent-Length: 7\r\nConnection: close\r\n\r\ndenied!",
                )
                .expect("write hostile response");
            request
        });

        let client = ModelClient::from_env_with_overrides(ClientOverrides {
            backend: Some(BackendKind::Arcee),
            base_url: Some(format!("http://{address}/hostile/base")),
            extra_headers: std::collections::BTreeMap::from([(
                "Host".to_string(),
                "custom.virtual.test".to_string(),
            )]),
            ..ClientOverrides::default()
        })
        .expect("custom endpoint should use its separate key");
        client
            .send_turn(Vec::new(), Vec::new())
            .await
            .expect_err("hostile endpoint should return HTTP 400");
        let request = server.join().expect("hostile endpoint thread");

        let request_lower = request.to_ascii_lowercase();
        assert!(
            request_lower.contains(&format!("authorization: bearer {custom_key}")),
            "custom key missing from request: {request}"
        );
        assert!(
            !request.contains(stored_key),
            "stored key leaked to custom endpoint: {request}"
        );
        assert!(
            request.starts_with("POST /hostile/base/v1/chat/completions "),
            "selected URL path was not preserved: {request}"
        );
        assert!(
            request_lower.contains("host: custom.virtual.test"),
            "custom endpoint Host override was not preserved: {request}"
        );
    }

    #[test]
    fn tampered_stored_arcee_url_is_rejected_before_client_creation() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let tampered = stored_arcee_auth("rcai-never-use", "https://attacker.example/steal");
        let env = IsolatedModelEnv::new("tampered-stored-url", None, None, None);
        std::fs::write(env.home.join("arcee_auth.json"), tampered).unwrap();

        let error = ModelClient::from_env_with_overrides(ClientOverrides {
            backend: Some(BackendKind::Arcee),
            ..ClientOverrides::default()
        })
        .err()
        .expect("a tampered stored endpoint must fail before requests can be made");
        assert!(
            error.to_string().contains("invalid base_url"),
            "unexpected error: {error:#}"
        );
    }

    #[test]
    fn arcee_and_codex_auth_coexist_and_logout_independently() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let codex = stored_codex_auth();
        let arcee = stored_arcee_auth("rcai-test", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("coexist", Some(&codex), None, None);
        std::fs::write(env.home.join("arcee_auth.json"), &arcee).unwrap();

        let loaded = arcee::read_stored_auth().unwrap();
        assert_eq!(loaded.api_key, "rcai-test");
        codex_auth_status().unwrap();

        arcee_auth_logout().unwrap();
        assert!(!env.home.join("arcee_auth.json").exists());
        assert_eq!(
            std::fs::read_to_string(env.home.join("auth.json")).unwrap(),
            codex
        );

        std::fs::write(env.home.join("arcee_auth.json"), &arcee).unwrap();
        codex_auth_logout().unwrap();
        assert!(!env.home.join("auth.json").exists());
        assert_eq!(
            std::fs::read_to_string(env.home.join("arcee_auth.json")).unwrap(),
            arcee
        );
    }

    #[test]
    fn codex_logout_migrates_legacy_arcee_auth_before_touching_auth_json() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let legacy = stored_arcee_auth("rcai-legacy", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("codex-migrates", Some(&legacy), None, None);

        codex_auth_logout().unwrap();

        assert!(!env.home.join("auth.json").exists());
        let canonical = std::fs::read_to_string(env.home.join("arcee_auth.json")).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&canonical).unwrap(),
            serde_json::from_str::<Value>(&legacy).unwrap()
        );
    }

    #[test]
    fn codex_operation_preserves_conflicting_arcee_files() {
        let _guard = TEST_ENV_LOCK.lock().unwrap();
        let legacy = stored_arcee_auth("rcai-legacy", "https://api.arcee.ai");
        let canonical = stored_arcee_auth("rcai-canonical", "https://api.arcee.ai");
        let env = IsolatedModelEnv::new("codex-conflict", Some(&legacy), None, None);
        std::fs::write(env.home.join("arcee_auth.json"), &canonical).unwrap();

        let error = codex_auth_logout().unwrap_err();

        assert!(error.to_string().contains("conflicting Arcee credentials"));
        assert_eq!(
            std::fs::read_to_string(env.home.join("auth.json")).unwrap(),
            legacy
        );
        assert_eq!(
            std::fs::read_to_string(env.home.join("arcee_auth.json")).unwrap(),
            canonical
        );
    }

    #[test]
    fn detects_backend_from_url() {
        assert_eq!(
            detect_backend("https://api.openai.com/v1").unwrap(),
            BackendKind::OpenAiResponses
        );
        assert_eq!(
            detect_backend("https://api.fireworks.ai/inference/v1").unwrap(),
            BackendKind::FireworksChat
        );
        assert_eq!(
            detect_backend("https://api.deepseek.com").unwrap(),
            BackendKind::DeepSeekChat
        );
        assert_eq!(
            detect_backend("https://api.anthropic.com").unwrap(),
            BackendKind::AnthropicMessages
        );
        assert_eq!(
            detect_backend("https://api.together.ai/v1").unwrap(),
            BackendKind::TogetherChat
        );
        assert_eq!(
            detect_backend("https://api.arcee.ai").unwrap(),
            BackendKind::Arcee
        );
        assert_eq!(
            detect_backend("https://api.internal.arcee.ai").unwrap(),
            BackendKind::Arcee
        );
        assert_eq!(
            detect_backend("https://arcee.ai").unwrap(),
            BackendKind::Arcee
        );
        assert!(detect_backend("https://arcee.ai.evil.com/v1").is_err());
        assert!(detect_backend("https://evil-arcee.ai.attacker.com/v1").is_err());
        assert!(detect_backend("https://notarcee.ai").is_err());
        assert!(detect_backend("https://example.com/v1").is_err());
    }

    #[test]
    fn anthropic_messages_request_includes_adaptive_max_thinking_and_128000() {
        let request = anthropic_messages_request(
            "claude-opus-4-6",
            &[
                Message::System {
                    content: "system instructions".to_string(),
                },
                Message::User {
                    content: "read a file".to_string(),
                },
            ],
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read a file".to_string(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"}
                        },
                        "required": ["path"]
                    }),
                },
            }],
            None,
        )
        .unwrap();

        assert_eq!(request["model"], "claude-opus-4-6");
        assert_eq!(request["max_tokens"], 128000);
        assert_eq!(request["thinking"]["type"], "adaptive");
        assert_eq!(request["thinking"]["display"], "omitted");
        assert_eq!(request["output_config"]["effort"], "max");
        // System prompt is now a content-block array with cache_control.
        assert_eq!(request["system"][0]["type"], "text");
        assert_eq!(request["system"][0]["text"], "system instructions");
        assert_eq!(request["system"][0]["cache_control"]["type"], "ephemeral");
        assert!(request["system"][0]["cache_control"].get("ttl").is_none());
        // Last tool has cache_control.
        assert_eq!(request["tools"][0]["name"], "read");
        assert_eq!(request["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(request["tools"][0]["cache_control"]["type"], "ephemeral");
        // Last message (user) content is converted to array with cache_control.
        assert_eq!(request["messages"][0]["role"], "user");
        assert_eq!(request["messages"][0]["content"][0]["type"], "text");
        assert_eq!(request["messages"][0]["content"][0]["text"], "read a file");
        assert_eq!(
            request["messages"][0]["content"][0]["cache_control"]["type"],
            "ephemeral"
        );
    }

    #[test]
    fn anthropic_request_with_1h_ttl_sets_ttl_on_all_breakpoints() {
        let request = anthropic_messages_request(
            "claude-sonnet-4-6",
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
    fn deepseek_chat_request_enables_max_thinking_and_preserves_reasoning() {
        let request = deepseek_chat_request(
            "deepseek-v4-pro",
            &[Message::Assistant {
                content: Some("calling a tool".to_string()),
                reasoning_text: Some("need current context".to_string()),
                reasoning_details: None,
                tool_calls: Some(vec![ToolCall {
                    id: "call_1".to_string(),
                    call_type: "function".to_string(),
                    function: FunctionCall {
                        name: "read".to_string(),
                        arguments: "{\"path\":\"src/main.rs\"}".to_string(),
                    },
                }]),
            }],
            &[ToolDefinition {
                def_type: "function".to_string(),
                function: crate::types::FunctionDef {
                    name: "read".to_string(),
                    description: "Read a file".to_string(),
                    parameters: json!({
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"}
                        },
                        "required": ["path"]
                    }),
                },
            }],
        );

        assert_eq!(request["model"], "deepseek-v4-pro");
        assert_eq!(request["thinking"]["type"], "enabled");
        assert_eq!(request["reasoning_effort"], "max");
        assert!(request.get("temperature").is_none());
        assert_eq!(
            request["messages"][0]["reasoning_content"],
            "need current context"
        );
        assert_eq!(request["tools"][0]["type"], "function");
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
        assert_eq!(usage.input_tokens, 20);   // 100 - 80 cached
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
        assert_eq!(usage.orchestrator_context_tokens, 380);  // 100 + 50 + 200 + 30
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
        assert_eq!(usage.input_tokens, 40);   // 100 - 60 cached
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

        assert_eq!(parsed.assistant.content.as_deref(), Some("The answer is 42."));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("I need to think about this carefully...")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 40);   // 100 - 60 cached
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

        assert_eq!(parsed.assistant.content.as_deref(), Some("The answer is 4."));
        assert_eq!(
            parsed.assistant.reasoning_text.as_deref(),
            Some("We need to calculate 2+2. That equals 4.")
        );
        assert!(parsed.assistant.tool_calls.is_none());
        let usage = parsed.usage.expect("usage should be parsed");
        assert_eq!(usage.input_tokens, 58);      // 2618 - 2560 cached
        assert_eq!(usage.output_tokens, 74);
        assert_eq!(usage.cache_read_tokens, 2560);
        assert_eq!(usage.cache_write_tokens, 0);
        assert_eq!(usage.reasoning_tokens, 71);
        assert_eq!(usage.orchestrator_context_tokens, 2692);
    }
}
