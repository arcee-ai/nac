use super::*;
use crate::mcp::test_support::{shell_single_quote, start_fake_http_mcp_server, toml_string};
use crate::sandbox::SandboxSpec;
use crate::types::Message;
use crate::TEST_ENV_LOCK;
use std::ffi::OsString;

fn test_openai_model_options() -> ModelOptions {
    ModelOptions {
        backend: Some(BackendKind::OpenAiResponses),
        api_base_url: Some(" https://api.openai.com/v1 ".to_string()),
        api_model: Some(" test-model ".to_string()),
        api_key_env: OptionalModelOption::Value("OPENAI_API_KEY".to_string()),
        ..ModelOptions::default()
    }
}

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_main_test_{}_{}", label, unique))
        .join("store.db")
}

fn restore_env(name: &str, value: Option<OsString>) {
    match value {
        Some(value) => unsafe { std::env::set_var(name, value) },
        None => unsafe { std::env::remove_var(name) },
    }
}

/// A config whose `[model]` section resolves through the catalog:
/// gpt-5.2 is unique to openai-responses, so the backend, the catalog
/// endpoint default and the conventional credential variable all come
/// from the catalog rather than config fields.
fn complete_model_config() -> NacConfig {
    let mut config = NacConfig::default();
    config.model.model = Some("gpt-5.2".to_string());
    config
}

#[path = "runtime_tests/construction.rs"]
mod construction;
#[path = "runtime_tests/remote.rs"]
mod remote;
