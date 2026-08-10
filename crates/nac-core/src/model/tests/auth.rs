//! Managed-credential (Arcee/Codex) auth tests: stored-auth loading,
//! origin binding, endpoint validation, and logout isolation.

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
        let home =
            std::env::temp_dir().join(format!("nac-model-{label}-{}-{unique}", std::process::id()));
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

fn directory_names(path: &std::path::Path) -> Vec<String> {
    let mut names = std::fs::read_dir(path)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    names.sort();
    names
}

fn effective_settings(
    backend: BackendKind,
    base_url: &str,
    api_key_env: Option<&str>,
) -> EffectiveModelSettings {
    EffectiveModelSettings::new(
        backend,
        if backend == BackendKind::ArceeAuth {
            "trinity-large-thinking"
        } else {
            "test-model"
        }
        .to_string(),
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
            "trinity-large-thinking".to_string(),
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
