use super::*;

#[tokio::test]
async fn login_refresh_requests_coalesce_and_preserve_force() {
    let trigger = RefreshTrigger::default();
    trigger.request(false);
    trigger.request(true);
    trigger.request(false);
    assert!(trigger.take_force());
    trigger.wake.notified().await;
    assert!(!trigger.take_force());
    assert!(
        tokio::time::timeout(Duration::from_millis(20), trigger.wake.notified())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn long_lived_refresh_serializes_login_and_account_change() {
    use std::sync::atomic::{AtomicU8, Ordering};
    use std::sync::{Arc, Mutex};
    let trigger = Arc::new(RefreshTrigger::default());
    let calls = Arc::new(Mutex::new(Vec::new()));
    let release = Arc::new(tokio::sync::Notify::new());
    let revision = Arc::new(AtomicU8::new(0));
    let task = {
        let trigger = trigger.clone();
        let calls = calls.clone();
        let release = release.clone();
        let revision = revision.clone();
        tokio::spawn(async move {
            refresh_loop(
                &trigger,
                Duration::from_millis(30),
                Duration::from_secs(1),
                move || Some([revision.load(Ordering::SeqCst); 32]),
                move |force| {
                    let calls = calls.clone();
                    let release = release.clone();
                    async move {
                        let first = {
                            let mut calls = calls.lock().unwrap();
                            calls.push(force);
                            calls.len() == 1
                        };
                        if first {
                            release.notified().await;
                        }
                        Ok(())
                    }
                },
            )
            .await;
        })
    };
    tokio::time::timeout(Duration::from_secs(2), async {
        while calls.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    trigger.request(true);
    trigger.request(true);
    trigger.request(false);
    assert_eq!(calls.lock().unwrap().as_slice(), &[false]);
    release.notify_one();
    tokio::time::timeout(Duration::from_secs(2), async {
        while calls.lock().unwrap().len() < 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(&calls.lock().unwrap()[..2], &[false, true]);
    revision.store(1, Ordering::SeqCst);
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if calls.lock().unwrap().iter().skip(2).any(|force| *force) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    task.abort();
}

#[tokio::test]
async fn refresh_failures_back_off_but_login_can_retry() {
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    let trigger = Arc::new(RefreshTrigger::default());
    let calls = Arc::new(AtomicUsize::new(0));
    let task = {
        let trigger = trigger.clone();
        let calls = calls.clone();
        tokio::spawn(async move {
            refresh_loop(
                &trigger,
                Duration::from_millis(15),
                Duration::from_secs(3),
                || None,
                move |_| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    async { Err("synthetic failure".to_string()) }
                },
            )
            .await;
        })
    };
    tokio::time::timeout(Duration::from_secs(2), async {
        while calls.load(Ordering::SeqCst) == 0 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(70)).await;
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    trigger.request(true);
    tokio::time::timeout(Duration::from_secs(2), async {
        while calls.load(Ordering::SeqCst) < 2 {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    task.abort();
}

#[tokio::test]
async fn fetch_is_authenticated_bounded_and_does_not_follow_redirects() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        r#"{"models":[{"slug":"x"}]}"#,
    )]);
    let body = fetch_index(
        &client,
        &server.base_url,
        "synthetic-token",
        "synthetic-account",
    )
    .await
    .unwrap();
    assert_eq!(parse_index(&body).unwrap()[0].id, "x");
    let requests = server.finish();
    assert_eq!(
        requests[0].headers.get("authorization").map(String::as_str),
        Some("Bearer synthetic-token")
    );
    assert_eq!(
        requests[0]
            .headers
            .get("chatgpt-account-id")
            .map(String::as_str),
        Some("synthetic-account")
    );
    for response in [
        ScriptedResponse::json("401 Unauthorized", "synthetic-token"),
        ScriptedResponse::redirect("302 Found", "https://example.invalid/", "synthetic-token"),
    ] {
        let server = ScriptedServer::start(vec![response]);
        let error = fetch_index(
            &client,
            &server.base_url,
            "synthetic-token",
            "synthetic-account",
        )
        .await
        .unwrap_err();
        assert!(!error.contains("synthetic-token"));
        assert!(!error.contains("synthetic-account"));
        assert_eq!(server.finish().len(), 1);
    }
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let stalled = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            if let Ok((_socket, _)) = listener.accept() {
                std::thread::sleep(Duration::from_millis(200));
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
    });
    let short = reqwest::Client::builder()
        .timeout(Duration::from_millis(40))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let error = fetch_index(
        &short,
        &format!("http://{address}"),
        "synthetic-token",
        "synthetic-account",
    )
    .await
    .unwrap_err();
    assert!(!error.contains("synthetic-token"));
    stalled.join().unwrap();
}

#[test]
fn cached_discovery_is_isolated_across_account_changes() {
    let _lock = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let guard = super::super::test_support::EnvGuard::new("codex-account", &["NAC_HOME"], &[])
        .with_env_layers();
    let auth_path = guard.path().join("auth.json");
    let sign_in = |account: &str| {
        let auth = serde_json::json!({"type":"chatgpt-codex", "access":"test-access", "refresh":"test-refresh", "expires_at_ms":u64::MAX, "account_id":account});
        nac_credential_store::write_auth_string_to_path(&auth_path, &auth.to_string()).unwrap();
    };
    let mut index: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/codex-index-2026-11-17.json")).unwrap();
    index["models"].as_array_mut().unwrap().push(serde_json::json!({"slug":"live-only-fixture", "input_modalities":["text", "image"], "context_window":272000}));
    let index = index.to_string();
    sign_in("account-a");
    record_discovery("account-a", &index);
    assert!(
        super::super::resolve(BackendKind::ChatGptCodexResponses, "live-only-fixture").image_input
    );
    let before = super::super::catalog_version();
    record_discovery("account-a", r#"{"models":[{"slug":"live-only-fixture"}]}"#);
    assert!(
        super::super::resolve(BackendKind::ChatGptCodexResponses, "live-only-fixture").image_input
    );
    assert!(super::super::catalog_version() > before);
    let version = super::super::catalog_version();
    record_discovery("account-a", r#"{"models":[{"slug":"live-only-fixture"}]}"#);
    assert_eq!(super::super::catalog_version(), version);
    record_discovery(
        "account-a",
        r#"{"models":[{"slug":"live-only-fixture","input_modalities":["text"]}]}"#,
    );
    assert!(
        !super::super::resolve(BackendKind::ChatGptCodexResponses, "live-only-fixture").image_input
    );
    record_discovery("account-a", &index);
    sign_in("account-b");
    assert!(
        !super::super::resolve(BackendKind::ChatGptCodexResponses, "live-only-fixture").image_input
    );
    record_discovery("account-a", &index);
    assert!(
        !super::super::resolve(BackendKind::ChatGptCodexResponses, "live-only-fixture").image_input
    );
    sign_in("account-a");
    assert!(
        super::super::resolve(BackendKind::ChatGptCodexResponses, "live-only-fixture").image_input
    );
}

#[test]
fn cache_requires_same_account_and_valid_entries() {
    let path = std::env::temp_dir().join(format!("nac-codex-cache-{}.json", uuid::Uuid::new_v4()));
    let cache = CodexCache {
        account_fingerprint: "account-a".into(),
        fetched_at_unix: 1,
        models: parse_index(r#"{"models":[{"slug":"a","input_modalities":["image"]}]}"#).unwrap(),
    };
    let cadence = super::super::overlay::REFRESH_CADENCE_SECS;
    assert!(cache_is_fresh(&cache, cadence, false));
    assert!(!cache_is_fresh(&cache, cadence + 1, false));
    assert!(!cache_is_fresh(&cache, cadence, true));
    assert!(!cache_is_fresh(&cache, 0, false));
    nac_credential_store::write_auth_string_to_path(&path, &serde_json::to_string(&cache).unwrap())
        .unwrap();
    assert!(read_cache(&path, "account-a").is_some());
    assert!(read_cache(&path, "account-b").is_none());
    nac_credential_store::write_auth_string_to_path(&path, "not json").unwrap();
    assert!(read_cache(&path, "account-a").is_none());
    std::fs::remove_file(path).unwrap();
}

#[test]
fn recorded_index_preserves_modalities_and_default_context() {
    let entries = parse_index(include_str!("fixtures/codex-index-2026-11-17.json")).unwrap();
    let model = entries
        .iter()
        .find(|entry| entry.id == "gpt-6.1-sol")
        .unwrap();
    assert_eq!(model.context_window, Some(500_000));
    assert_eq!(model.max_context_window, Some(872_000));
    assert_eq!(model.auto_compact_token_limit, None);
    assert_eq!(model.image_input, Some(true));

    let mut catalog = super::super::baseline_catalog();
    merge_entries(&mut catalog, &entries);
    let resolved = catalog.resolve(BackendKind::ChatGptCodexResponses, "gpt-6.1-sol");
    assert!(resolved.image_input);
    assert_eq!(resolved.context_window, 500_000);
    let limits = resolved.resolved_limits();
    assert_eq!(limits.effective_input_tokens, 475_000);
    assert_eq!(limits.context_origin, super::super::LimitOrigin::Observed);
    assert_eq!(limits.input_origin, super::super::LimitOrigin::Profile);
    assert_eq!(limits.output_origin, super::super::LimitOrigin::Estimated);
    assert_eq!(limits.automatic_compaction_threshold, Some(332_500));
    let limited = parse_index(r#"{"models":[{"slug":"gpt-6.1-sol","context_window":500000,"auto_compact_token_limit":100000}]}"#).unwrap();
    merge_entries(&mut catalog, &limited);
    let limits = catalog
        .resolve(BackendKind::ChatGptCodexResponses, "gpt-6.1-sol")
        .resolved_limits();
    assert_eq!(limits.automatic_compaction_threshold, Some(100000));
    assert_eq!(
        limits.automatic_compaction_origin,
        Some(super::super::LimitOrigin::Observed)
    );
}

#[test]
fn partial_or_invalid_fields_do_not_invent_capabilities() {
    let entries = parse_index(r#"{"models":[{"slug":"a","context_window":0,"input_modalities":["text",42]},{"slug":"b","input_modalities":["text"]}]}"#).unwrap();
    assert_eq!(entries[0].context_window, None);
    assert_eq!(entries[0].image_input, None);
    assert_eq!(entries[1].image_input, Some(false));
    let unknown =
        parse_index(r#"{"models":[{"slug":"x","input_modalities":["future-modality"]}]}"#).unwrap();
    assert_eq!(unknown[0].image_input, None);
    assert!(parse_index(r#"{"models":[]}"#).is_err());
    let visible =
        parse_index(r#"{"models":[{"slug":"visible"},{"slug":"hidden","visibility":"hide"}]}"#)
            .unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].id, "visible");
    let limited = parse_index(r#"{"models":[{"slug":"gpt-6.1-sol","context_window":200000,"max_context_window":100000}]}"#).unwrap();
    assert_eq!(limited[0].context_window, None);
    let mut catalog = super::super::baseline_catalog();
    merge_entries(&mut catalog, &limited);
    let resolved = catalog.resolve(BackendKind::ChatGptCodexResponses, "gpt-6.1-sol");
    assert_eq!(resolved.context_window, 100000);
    assert_eq!(
        resolved.context_origin,
        super::super::LimitOrigin::Estimated
    );
}

#[test]
fn explicit_modalities_override_lower_layers_but_missing_fields_do_not() {
    let mut catalog = super::super::baseline_catalog();
    let before = catalog.resolve(BackendKind::ChatGptCodexResponses, "gpt-5.6-sol");
    let entries = parse_index(
        r#"{"models":[
        {"slug":"gpt-5.6-sol","context_window":0},
        {"slug":"new-text-only","input_modalities":["text"]},
        {"slug":"new-unknown"}
    ]}"#,
    )
    .unwrap();
    merge_entries(&mut catalog, &entries);
    let partial = catalog.resolve(BackendKind::ChatGptCodexResponses, "gpt-5.6-sol");
    assert_eq!(partial.context_window, before.context_window);
    assert_eq!(partial.image_input, before.image_input);
    assert!(
        !catalog
            .resolve(BackendKind::ChatGptCodexResponses, "new-text-only")
            .image_input
    );
    assert!(
        !catalog
            .resolve(BackendKind::ChatGptCodexResponses, "new-unknown")
            .image_input
    );
}

#[test]
fn account_discovery_preserves_speed_metadata_and_distinguishes_empty_from_unknown() {
    let models = parse_index(r#"{"models":[
        {"slug":"new-model","service_tiers":[{"id":"priority","name":"Fast","description":"Priority processing"},{"id":"ultrafast","name":"Ultrafast","description":"Fastest"}],"default_service_tier":"priority"},
        {"slug":"revoked","service_tiers":[],"default_service_tier":null},
        {"slug":"unknown"},
        {"slug":"malformed","service_tiers":[{"id":"priority","name":42}]}
    ]}"#).unwrap();
    let tiers = models[0].service_tiers.as_ref().unwrap();
    assert_eq!(tiers.len(), 2);
    assert_eq!(tiers[0].id, "priority");
    assert_eq!(tiers[0].name, "Fast");
    assert_eq!(tiers[0].description, "Priority processing");
    assert_eq!(models[0].default_service_tier.as_deref(), Some("priority"));
    assert_eq!(models[1].service_tiers, Some(vec![]));
    assert!(models[1].default_service_tier_known);
    assert_eq!(models[1].default_service_tier, None);
    assert!(!models[2].default_service_tier_known);
    assert_eq!(models[2].service_tiers, None);
    assert_eq!(models[3].service_tiers, None);
}

#[cfg(feature = "codex-e2e-fixture")]
#[test]
fn fixture_managed_discovery_is_local_and_expired_auth_fails_before_refresh() {
    let _lock = crate::TEST_ENV_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let guard = super::super::test_support::EnvGuard::new(
        "codex-fixture-discovery",
        &["NAC_HOME", "NAC_CODEX_E2E_FIXTURE_URL"],
        &[],
    );
    unsafe {
        std::env::set_var(
            "NAC_CODEX_E2E_FIXTURE_URL",
            "http://127.0.0.1:1234/responses",
        )
    };
    let auth_path = guard.path().join("auth.json");
    let auth = |expires_at_ms| {
        serde_json::json!({
            "type":"chatgpt-codex", "access":"e2e-only", "refresh":"e2e-only",
            "expires_at_ms":expires_at_ms, "account_id":"codex-e2e-account"
        })
        .to_string()
    };
    nac_credential_store::write_auth_string_to_path(&auth_path, &auth(u64::MAX)).unwrap();
    record_discovery(
        "codex-e2e-account",
        r#"{"models":[{"slug":"fixture-model","display_name":"Fixture"}]}"#,
    );
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let list = || {
        runtime.block_on(async {
            tokio::time::timeout(
                Duration::from_secs(1),
                crate::model::list_managed_provider_models(
                    crate::model::ManagedAuthProvider::Codex,
                ),
            )
            .await
            .expect("fixture discovery must not wait for network")
        })
    };
    let models = list().unwrap();
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].id, "fixture-model");
    let expired = auth(0);
    nac_credential_store::write_auth_string_to_path(&auth_path, &expired).unwrap();
    assert!(list()
        .unwrap_err()
        .to_string()
        .contains("must not be expired"));
    assert_eq!(std::fs::read_to_string(&auth_path).unwrap(), expired);
    let direct_error = runtime
        .block_on(crate::model::chatgpt_codex::stored_auth_for_request(
            &reqwest::Client::new(),
        ))
        .unwrap_err();
    assert!(direct_error
        .to_string()
        .contains("cannot be used for public discovery"));
}
