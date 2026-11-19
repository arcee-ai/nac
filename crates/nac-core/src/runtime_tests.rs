use super::*;
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

#[path = "runtime_tests/construction.rs"]
mod construction;
#[path = "runtime_tests/mcp_admission.rs"]
mod mcp_admission;
#[path = "runtime_tests/remote.rs"]
mod remote;
