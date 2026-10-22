//! Actual retained file owners and existing model validation, never admission.
use super::*;
use crate::runtime::{
    CreateConfigurationSource, CreateModelCatalogSource, ModelOptions, NacConfig, RunOptions,
    StoreOptions,
};
use std::{
    ffi::OsString,
    path::PathBuf,
    sync::MutexGuard,
    time::{Duration, Instant},
};

struct Fixture {
    home: PathBuf,
    original_home: Option<OsString>,
    original_key: Option<OsString>,
    _environment: MutexGuard<'static, ()>,
}
impl Fixture {
    fn new() -> Self {
        let guard = crate::TEST_ENV_LOCK.lock().unwrap();
        let original_home = std::env::var_os("NAC_HOME");
        let original_key = std::env::var_os("DEEPSEEK_API_KEY");
        let home = std::env::temp_dir().join(format!("resolved-catalog-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&home).unwrap();
        let home = home.canonicalize().unwrap();
        // SAFETY: _environment retains the shared process environment lock
        // through restoration. HOME and CODEX_HOME are never changed.
        unsafe {
            std::env::set_var("NAC_HOME", &home);
            std::env::set_var("DEEPSEEK_API_KEY", "source-only-test-canary");
        }
        std::fs::write(
            home.join("config.toml"),
            "[model]\nmodel='retained-model'\n",
        )
        .unwrap();
        NacConfig::load_from_cwd(&home).unwrap();
        std::fs::write(home.join("models.json"), serde_json::json!({"overrides":[{"provider":"deepseek-chat","model":"retained-model","set":{"max_tokens":1234}}]}).to_string()).unwrap();
        let directory = home.join("model-catalog");
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("overlay.json"), serde_json::json!({
            "schema_version":1,"generated_at":"2999-01-01T00:00:00Z",
            "providers":{"deepseek-chat":{"default_base_url":"https://retained.example.test/v1","models":{}}}
        }).to_string()).unwrap();
        Self {
            home,
            original_home,
            original_key,
            _environment: guard,
        }
    }
    fn options(&self) -> RunOptions {
        RunOptions {
            workspace_cwd: self.home.clone(),
            config_cwd: Some(self.home.clone()),
            store: StoreOptions {
                store_path: Some(self.home.join("store.db")),
            },
            model: ModelOptions {
                api_key_env: OptionalModelOption::Clear,
                ..Default::default()
            },
            ..Default::default()
        }
    }
    fn sources(&self) -> (CreateConfigurationSource, CreateModelCatalogSource) {
        let cutoff = Instant::now() + Duration::from_secs(30);
        (
            CreateConfigurationSource::capture(&self.home, cutoff).unwrap(),
            CreateModelCatalogSource::capture(&self.home, cutoff).unwrap(),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // SAFETY: the shared environment test lock remains held until after
        // restoring this command-local test value.
        unsafe {
            match self.original_key.take() {
                Some(key) => std::env::set_var("DEEPSEEK_API_KEY", key),
                None => std::env::remove_var("DEEPSEEK_API_KEY"),
            }
            match self.original_home.take() {
                Some(home) => std::env::set_var("NAC_HOME", home),
                None => std::env::remove_var("NAC_HOME"),
            }
        }
        let _ = std::fs::remove_dir_all(&self.home);
    }
}
#[test]
fn create_resolution_uses_captured_provider_endpoint_and_metadata() {
    let fixture = Fixture::new();
    let (config, catalog) = fixture.sources();
    let mut options = fixture.options();
    options.model.api_key_env = OptionalModelOption::Inherit;
    let resolved =
        resolve_create_inputs_from_sources(options, &config, &catalog, SessionBehavior::Direct)
            .unwrap();
    let model = resolved.configuration().model;
    assert_eq!(model.backend, crate::model::BackendKind::DeepSeekChat);
    assert_eq!(model.base_url, "https://retained.example.test/v1");
    assert_eq!(model.resolved.max_tokens, 1234);
    assert!(model.api_key_env.is_none());
    let parts = resolved.into_parts();
    assert_eq!(parts.model.base_url, "https://retained.example.test/v1");
    assert_eq!(parts.model.resolved.max_tokens, 1234);
}
#[test]
fn create_resolution_refuses_a_different_actual_home_or_original_cutoff() {
    let fixture = Fixture::new();
    let (config, catalog) = fixture.sources();
    let other = fixture.home.join("other");
    std::fs::create_dir(&other).unwrap();
    let wrong_home = CreateModelCatalogSource::capture(&other, config.original_cutoff()).unwrap();
    assert!(resolve_create_inputs_from_sources(
        fixture.options(),
        &config,
        &wrong_home,
        SessionBehavior::Direct
    )
    .is_err());
    let later = CreateModelCatalogSource::capture(
        &fixture.home,
        catalog.original_cutoff() + Duration::from_secs(1),
    )
    .unwrap();
    assert!(resolve_create_inputs_from_sources(
        fixture.options(),
        &config,
        &later,
        SessionBehavior::Direct
    )
    .is_err());
}
#[test]
fn create_resolution_refuses_changed_or_denied_original_catalog() {
    let fixture = Fixture::new();
    let (config, catalog) = fixture.sources();
    std::fs::write(fixture.home.join("models.json"), "PRIVATE_CHANGED_LAYER").unwrap();
    let error = resolve_create_inputs_from_sources(
        fixture.options(),
        &config,
        &catalog,
        SessionBehavior::Direct,
    )
    .err()
    .unwrap();
    assert!(!format!("{error} {error:?}").contains("PRIVATE_CHANGED_LAYER"));
    assert!(catalog.check_current().is_err());
    let catalog =
        CreateModelCatalogSource::capture(&fixture.home, config.original_cutoff()).unwrap();
    catalog.deny();
    assert!(resolve_create_inputs_from_sources(
        fixture.options(),
        &config,
        &catalog,
        SessionBehavior::Direct
    )
    .is_err());
}
