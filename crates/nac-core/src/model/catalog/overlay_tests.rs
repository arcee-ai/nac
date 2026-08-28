//! S2 tests: overlay load/refresh, the runtime models.dev mapper (incl.
//! the generator-parity guard), and the zero-network contract of the
//! resolution/validation paths.

use super::data;
use super::overlay::{
    format_unix_utc, is_utc_iso8601, map_models_dev, overlay_dir, read_sidecar,
    refresh_overlay_once, spawn_overlay_refresh, unix_now, write_sidecar, OverlaySidecar,
    RefreshOutcome, DEFAULT_MODELS_DEV_URL, OVERLAY_SCHEMA_VERSION, REFRESH_CADENCE_SECS,
};
use super::test_support::{write_overlay, EnvGuard, TempHome};
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::model::{validate_model_configuration, EffectiveModelSettings, ReasoningEffort};
use crate::TEST_ENV_LOCK;
use std::path::Path;
use std::time::{Duration, Instant};

const NOVEL_MODEL: &str = "deepseek-v9-overlay-test";

fn novel_model_payload() -> String {
    serde_json::json!({
        "deepseek": {
            "env": ["DEEPSEEK_OVERLAY_KEY"],
            "models": {
                NOVEL_MODEL: {
                    "name": "DeepSeek V9 Overlay Test",
                    "reasoning": true,
                    "modalities": { "input": ["text", "image"], "output": ["text"] },
                    "limit": { "context": 999_000, "output": 77_000 },
                    "cost": { "input": 1.5, "output": 6.0, "cache_read": 0.15, "cache_write": 1.875 }
                }
            }
        }
    })
    .to_string()
}

fn overlay_model_doc(context_window: u64, max_tokens: u64) -> serde_json::Value {
    serde_json::json!({
        "display_name": "Overlay Test Model",
        "context_window": context_window,
        "max_tokens": max_tokens,
        "cost": { "input": 1.0, "output": 2.0, "cache_read": 0.1, "cache_write": 0.2 },
        "reasoning": true,
        "thinking_level_map": { "none": "none", "high": "high" }
    })
}

fn write_sidecar_file(home: &Path, etag: Option<&str>, fetched_at_unix: u64, url: &str) {
    let dir = overlay_dir(home);
    std::fs::create_dir_all(&dir).unwrap();
    write_sidecar(
        &dir.join("overlay.etag"),
        &OverlaySidecar {
            schema_version: OVERLAY_SCHEMA_VERSION,
            etag: etag.map(str::to_string),
            fetched_at_unix,
            url: url.to_string(),
        },
    );
}

// ---------------------------------------------------------------------------
// Refresh: 200 / 304 / errors / timeout / cadence
// ---------------------------------------------------------------------------

#[tokio::test]
async fn refresh_fetches_maps_writes_overlay_and_reloads_catalog() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-200",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let started_at = unix_now();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        novel_model_payload(),
    )
    .with_header("ETag", "\"overlay-etag-1\"")]);
    let server_url = server.base_url.clone();

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    // One deepseek model mapped; the four other providers are missing from
    // the payload and reported as warnings.
    let RefreshOutcome::Updated { models, warnings } = outcome else {
        panic!("expected Updated, got {outcome:?}");
    };
    assert_eq!(models, 1);
    assert_eq!(warnings.len(), 4, "{warnings:?}");
    assert!(
        warnings.iter().any(|w| w.contains("fireworks-ai")),
        "{warnings:?}"
    );

    // The request revalidates with the embedded baseline's ETag (no sidecar
    // existed yet).
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].headers.get("if-none-match"), None);

    // The overlay file carries the mapped entry with a fresh timestamp.
    let written: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(env.overlay_path()).unwrap()).unwrap();
    // The provider-level credential hint rides the same envelope.
    assert_eq!(
        written["providers"]["deepseek-chat"]["credential_env_var"],
        "DEEPSEEK_OVERLAY_KEY"
    );
    // The payload carries no `api`, so the provider endpoint default falls
    // back to the baseline's models.dev value.
    assert_eq!(
        written["providers"]["deepseek-chat"]["default_base_url"],
        "https://api.deepseek.com"
    );
    let entry = &written["providers"]["deepseek-chat"]["models"][NOVEL_MODEL];
    assert_eq!(entry["context_window"], 999_000);
    assert_eq!(entry["max_tokens"], 77_000);
    // The thinking map derives from the deepseek seed default (the matrix row).
    assert_eq!(entry["thinking_level_map"]["max"], "max");
    let generated_at = written["generated_at"].as_str().unwrap();
    assert!(is_utc_iso8601(generated_at), "{generated_at}");
    let baseline_generated_at = data::parse_manifest().unwrap().generated_at;
    assert!(generated_at >= baseline_generated_at.as_str());

    // The sidecar records the response ETag and the fetch time.
    let sidecar = read_sidecar(&env.sidecar_path()).expect("sidecar written");
    assert_eq!(sidecar.etag.as_deref(), Some("\"overlay-etag-1\""));
    assert!(sidecar.fetched_at_unix >= started_at);
    assert!(sidecar.fetched_at_unix <= unix_now());
    assert_eq!(sidecar.url, server_url);

    // The process-global catalog reloaded with the overlay entry, and the
    // overlay's credential env var upgraded the provider's hint metadata.
    assert_eq!(
        current().providers[&BackendKind::DeepSeekChat]
            .credential_env_var
            .as_deref(),
        Some("DEEPSEEK_OVERLAY_KEY")
    );
    let metadata = resolve(BackendKind::DeepSeekChat, NOVEL_MODEL);
    assert_eq!(metadata.source, ModelSource::Overlay);
    assert_eq!(metadata.context_window, 999_000);
    assert_eq!(metadata.max_tokens, 77_000);
    assert!(metadata.image_input);
    assert_eq!(metadata.cost.input, 1.5);
    assert_eq!(
        metadata.display_name.as_deref(),
        Some("DeepSeek V9 Overlay Test")
    );
    assert_eq!(metadata.cache_write_1h, None);
    assert_eq!(
        metadata.thinking_level_map.wire_value(ReasoningEffort::Max),
        Some("max")
    );
    assert!(metadata
        .thinking_level_map
        .is_supported(ReasoningEffort::High));
    assert!(metadata
        .thinking_level_map
        .is_supported(ReasoningEffort::Low));
    assert_eq!(
        metadata.compat.completions_thinking_format,
        Some(CompletionsThinkingFormat::Deepseek)
    );
    assert_eq!(
        metadata.compat.completions_reasoning_field.as_deref(),
        Some("reasoning_content")
    );

    // Write-tmp + rename leaves no partial files behind.
    let mut files = std::fs::read_dir(overlay_dir(env.path()))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    files.sort();
    assert_eq!(files, ["overlay.etag", "overlay.json"]);
}

#[tokio::test]
async fn refresh_sends_sidecar_etag_for_revalidation() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-sidecar-etag",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        novel_model_payload(),
    )
    .with_header("ETag", "\"new-etag\"")]);
    write_sidecar_file(env.path(), Some("\"sidecar-etag\""), 0, &server.base_url);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert!(
        matches!(outcome, RefreshOutcome::Updated { .. }),
        "{outcome:?}"
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].headers.get("if-none-match").map(String::as_str),
        Some("\"sidecar-etag\"")
    );
    let sidecar = read_sidecar(&env.sidecar_path()).unwrap();
    assert_eq!(sidecar.etag.as_deref(), Some("\"new-etag\""));
}

#[tokio::test]
async fn legacy_sidecar_forces_an_unconditional_overlay_refresh() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-legacy-sidecar",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        novel_model_payload(),
    )]);
    let dir = overlay_dir(env.path());
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        env.sidecar_path(),
        serde_json::json!({
            "etag": "\"pre-schema\"",
            "fetched_at_unix": unix_now(),
            "url": server.base_url
        })
        .to_string(),
    )
    .unwrap();

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert!(
        matches!(outcome, RefreshOutcome::Updated { .. }),
        "{outcome:?}"
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert_eq!(
        requests[0].headers.get("if-none-match"),
        None,
        "a pre-schema ETag must not produce a 304 that preserves old pricing"
    );
    let written: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(env.overlay_path()).unwrap()).unwrap();
    assert_eq!(written["schema_version"], OVERLAY_SCHEMA_VERSION);
    assert_eq!(
        read_sidecar(&env.sidecar_path()).unwrap().schema_version,
        OVERLAY_SCHEMA_VERSION
    );
}

#[tokio::test]
async fn refresh_304_without_overlay_keeps_baseline_and_bumps_sidecar() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-304",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let started_at = unix_now();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("304 Not Modified", "")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert_eq!(outcome, RefreshOutcome::NotModified);
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    // No overlay is written for an unchanged snapshot; the baseline stays
    // authoritative.
    assert!(!env.overlay_path().exists());
    let metadata = resolve(BackendKind::DeepSeekChat, "deepseek-v4-flash");
    assert_eq!(metadata.source, ModelSource::Baseline);
    // The sidecar clock advances (cadence) and keeps the revalidated ETag.
    let sidecar = read_sidecar(&env.sidecar_path()).expect("sidecar written on 304");
    assert_eq!(sidecar.etag, None);
    assert!(sidecar.fetched_at_unix >= started_at);
}

#[tokio::test]
async fn refresh_304_preserves_an_existing_overlay() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-304-keep",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    write_overlay(
        env.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": { "models": { "deepseek-v8-preexisting": overlay_model_doc(555_000, 8_000) } }
        }),
    );
    write_sidecar_file(env.path(), Some("\"old-etag\""), 0, DEFAULT_MODELS_DEV_URL);
    let overlay_bytes = std::fs::read_to_string(env.overlay_path()).unwrap();
    reset_for_test();
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v8-preexisting").source,
        ModelSource::Overlay
    );
    let server = ScriptedServer::start(vec![ScriptedResponse::json("304 Not Modified", "")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert_eq!(outcome, RefreshOutcome::NotModified);
    assert_eq!(
        std::fs::read_to_string(env.overlay_path()).unwrap(),
        overlay_bytes
    );
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v8-preexisting").source,
        ModelSource::Overlay
    );
    let sidecar = read_sidecar(&env.sidecar_path()).unwrap();
    assert_eq!(sidecar.etag, None);
    assert!(sidecar.fetched_at_unix > 0);
}

#[tokio::test]
async fn refresh_http_error_preserves_existing_overlay_and_sidecar() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-500",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    write_overlay(
        env.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": { "models": { "deepseek-v8-preexisting": overlay_model_doc(555_000, 8_000) } }
        }),
    );
    write_sidecar_file(env.path(), Some("\"old-etag\""), 0, DEFAULT_MODELS_DEV_URL);
    let overlay_bytes = std::fs::read_to_string(env.overlay_path()).unwrap();
    reset_for_test();
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "500 Internal Server Error",
        "{}",
    )]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    let RefreshOutcome::Failed { error } = outcome else {
        panic!("expected Failed, got {outcome:?}");
    };
    assert!(error.contains("HTTP 500"), "{error}");
    // A failed refresh neither clobbers the cached overlay nor advances the
    // sidecar clock (the next process start retries).
    assert_eq!(
        std::fs::read_to_string(env.overlay_path()).unwrap(),
        overlay_bytes
    );
    let sidecar = read_sidecar(&env.sidecar_path()).unwrap();
    assert_eq!(sidecar.fetched_at_unix, 0);
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v8-preexisting").source,
        ModelSource::Overlay
    );
}

#[tokio::test]
async fn refresh_failures_are_contained_without_touching_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-failures",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    // A server that accepts and never responds (the timeout case).
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let hang_url = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            std::thread::sleep(Duration::from_secs(3));
            drop(stream);
        }
    });
    let garbage = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", "this is not json")]);

    let cases: [(&str, String, Duration, &str); 3] = [
        // Nothing listens on 127.0.0.1:1; the connection is refused instantly.
        (
            "connection refused",
            "http://127.0.0.1:1/api.json".to_string(),
            Duration::from_secs(2),
            "",
        ),
        (
            "hanging server times out",
            hang_url,
            Duration::from_millis(200),
            "",
        ),
        (
            "unmappable payload",
            garbage.base_url.clone(),
            Duration::from_secs(5),
            "parsing models.dev payload",
        ),
    ];
    for (label, url, timeout, expected_error) in cases {
        let outcome = refresh_overlay_once(&url, timeout).await;
        let RefreshOutcome::Failed { error } = outcome else {
            panic!("{label}: expected Failed, got {outcome:?}");
        };
        assert!(error.contains(expected_error), "{label}: {error}");
        // A failed refresh writes neither the overlay nor the sidecar.
        assert!(!env.overlay_path().exists(), "{label}");
        assert!(!env.sidecar_path().exists(), "{label}");
    }
    garbage.finish();

    // Offline behavior: the embedded baseline keeps resolving.
    let metadata = resolve(BackendKind::DeepSeekChat, "deepseek-v4-flash");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert_eq!(metadata.context_window, 1_000_000);
}

#[tokio::test]
async fn refresh_skips_drifted_models_and_providers() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = EnvGuard::new(
        "refresh-drift",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let payload = serde_json::json!({
        "deepseek": {
            "models": {
                "deepseek-v9-good": {
                    "name": "Good",
                    "reasoning": true,
                    "limit": { "context": 100_000, "output": 5_000 },
                    "cost": { "input": 1.0 }
                },
                "deepseek-v9-negative": {
                    "limit": { "context": 1_000, "output": 100 },
                    "cost": { "input": -2.0 }
                },
                "deepseek-v9-malformed": "not-an-object"
            }
        },
        // Unknown providers are ignored, like the generator's tolerant
        // top-level parse.
        "totally-new-provider": { "models": {} }
    })
    .to_string();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", payload)]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    let RefreshOutcome::Updated { models, warnings } = outcome else {
        panic!("expected Updated, got {outcome:?}");
    };
    assert_eq!(models, 1);
    // 4 missing providers + the negative rate + the malformed entry.
    assert_eq!(warnings.len(), 6, "{warnings:?}");
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("deepseek-v9-negative") && w.contains("input rate")),
        "{warnings:?}"
    );
    assert!(
        warnings.iter().any(|w| w.contains("deepseek-v9-malformed")),
        "{warnings:?}"
    );
    let metadata = resolve(BackendKind::DeepSeekChat, "deepseek-v9-good");
    assert_eq!(metadata.source, ModelSource::Overlay);
    assert_eq!(metadata.context_window, 100_000);
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v9-negative").source,
        ModelSource::ProviderDefault
    );
}

#[tokio::test]
async fn cadence_skips_refresh_within_four_hours() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-cadence",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    write_sidecar_file(
        env.path(),
        Some("\"fresh\""),
        unix_now(),
        "http://127.0.0.1:1/api.json",
    );

    // The closed port would fail instantly if a request were attempted;
    // SkippedCadence proves none was made.
    let outcome = refresh_overlay_once("http://127.0.0.1:1/api.json", Duration::from_secs(2)).await;

    assert_eq!(outcome, RefreshOutcome::SkippedCadence);
}

#[tokio::test]
async fn stale_cadence_refetches() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new(
        "refresh-cadence-stale",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let started_at = unix_now();
    write_sidecar_file(
        env.path(),
        Some("\"stale\""),
        unix_now() - REFRESH_CADENCE_SECS - 60,
        DEFAULT_MODELS_DEV_URL,
    );
    let server = ScriptedServer::start(vec![ScriptedResponse::json("304 Not Modified", "")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert_eq!(outcome, RefreshOutcome::NotModified);
    assert_eq!(server.finish().len(), 1);
    let sidecar = read_sidecar(&env.sidecar_path()).unwrap();
    assert!(sidecar.fetched_at_unix >= started_at);
}

#[tokio::test]
async fn spawn_overlay_refresh_runs_once_and_updates_the_catalog() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = EnvGuard::new(
        "refresh-spawn",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    unsafe { std::env::set_var("MODELS_DEV_URL", "") }; // cleared: must fall back to the default
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        novel_model_payload(),
    )
    .with_header("ETag", "\"spawn-etag\"")]);
    unsafe { std::env::set_var("MODELS_DEV_URL", &server.base_url) };

    spawn_overlay_refresh();
    spawn_overlay_refresh(); // once-guard: no-op

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if resolve(BackendKind::DeepSeekChat, NOVEL_MODEL).source == ModelSource::Overlay {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "spawned refresh did not update the catalog"
        );
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    // Exactly one request across both spawn calls.
    assert_eq!(server.finish().len(), 1);
}

// ---------------------------------------------------------------------------
// Zero-network contract of the resolution/validation paths
// ---------------------------------------------------------------------------

#[test]
fn resolution_and_validation_paths_never_touch_the_network() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = EnvGuard::new(
        "no-network",
        &["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"],
        &[],
    )
    .with_env_layers();
    let server = ScriptedServer::start_unexpected_request_server(Duration::from_millis(300));
    unsafe { std::env::set_var("MODELS_DEV_URL", &server.base_url) };
    unsafe { std::env::set_var("DEEPSEEK_API_KEY", "no-network-dummy-key") };
    reset_for_test();

    for provider in [
        BackendKind::DeepSeekChat,
        BackendKind::FireworksChat,
        BackendKind::TogetherChat,
        BackendKind::OpenAiResponses,
        BackendKind::ChatGptCodexResponses,
        BackendKind::AnthropicMessages,
        BackendKind::ArceeAuth,
        BackendKind::ArceeApi,
        BackendKind::XaiAuth,
    ] {
        let metadata = resolve(provider, "any-model");
        assert_eq!(metadata.provider, provider);
    }
    // The settings-construction path (server PATCH + resume) resolves
    // catalog metadata locally.
    EffectiveModelSettings::from_optional(
        Some(BackendKind::DeepSeekChat),
        Some("deepseek-v4-flash".to_string()),
        Some("https://api.deepseek.com".to_string()),
        Some(ReasoningEffort::High),
        None,
        std::collections::BTreeMap::new(),
    )
    .expect("valid settings");
    validate_model_configuration(
        BackendKind::DeepSeekChat,
        "deepseek-v4-flash",
        Some("https://api.deepseek.com"),
        Some(ReasoningEffort::High),
        Some("DEEPSEEK_API_KEY"),
        &std::collections::BTreeMap::new(),
    )
    .expect("valid configuration");

    let requests = server.finish();
    assert!(
        requests.is_empty(),
        "resolution/validation touched the network: {requests:?}"
    );
}

// ---------------------------------------------------------------------------
// Overlay load: stale / corrupt / merge precedence over the baseline
// ---------------------------------------------------------------------------

#[test]
fn overlay_older_than_baseline_is_ignored() {
    let home = TempHome::new("stale-overlay");
    write_overlay(
        home.path(),
        "2020-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": { "models": { "deepseek-v9-stale": overlay_model_doc(42_000, 4_000) } }
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(
        matches!(warnings[0], CatalogWarning::OverlayStale { .. }),
        "{warnings:?}"
    );
    assert_eq!(
        catalog
            .resolve(BackendKind::DeepSeekChat, "deepseek-v9-stale")
            .source,
        ModelSource::ProviderDefault
    );
}

#[test]
fn pre_schema_overlay_is_ignored_after_upgrade() {
    let home = TempHome::new("pre-schema-overlay");
    let dir = overlay_dir(home.path());
    std::fs::create_dir_all(&dir).unwrap();
    let doc = serde_json::json!({
        "generated_at": "2099-01-01T00:00:00Z",
        "providers": {
            "openai-responses": {
                "models": { "gpt-5.6": overlay_model_doc(424_242, 11_111) }
            }
        }
    });
    std::fs::write(
        dir.join("overlay.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(
        matches!(
            warnings[0],
            CatalogWarning::OverlayIncompatible {
                found_schema_version: 0,
                expected_schema_version: OVERLAY_SCHEMA_VERSION,
                ..
            }
        ),
        "{warnings:?}"
    );
    let metadata = catalog.resolve(BackendKind::OpenAiResponses, "gpt-5.6");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert!(
        metadata
            .cost
            .tiers
            .as_ref()
            .is_some_and(|tiers| !tiers.is_empty()),
        "the pre-tier cache must not erase the upgraded baseline tiers"
    );
}

#[test]
fn corrupt_overlay_is_ignored_with_a_warning() {
    let home = TempHome::new("corrupt-overlay");
    let dir = overlay_dir(home.path());
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("overlay.json"), "{ definitely not json").unwrap();

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(
        matches!(warnings[0], CatalogWarning::OverlayCorrupt { .. }),
        "{warnings:?}"
    );
    let metadata = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-v4-flash");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert_eq!(metadata.context_window, 1_000_000);
}

#[test]
fn overlay_with_malformed_generated_at_is_ignored() {
    let home = TempHome::new("bad-timestamp");
    write_overlay(
        home.path(),
        "not-a-date",
        serde_json::json!({
            "deepseek-chat": { "models": { "deepseek-v9-stale": overlay_model_doc(42_000, 4_000) } }
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert_eq!(warnings.len(), 1, "{warnings:?}");
    assert!(
        matches!(warnings[0], CatalogWarning::OverlayCorrupt { .. }),
        "{warnings:?}"
    );
    assert_eq!(
        catalog
            .resolve(BackendKind::DeepSeekChat, "deepseek-v9-stale")
            .source,
        ModelSource::ProviderDefault
    );
}

#[test]
fn fresh_overlay_merges_over_the_baseline() {
    let home = TempHome::new("fresh-overlay");
    write_overlay(
        home.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "anthropic-messages": {
                "models": {
                    "claude-opus-4-6": overlay_model_doc(424_242, 11_111),
                    "claude-v9-overlay": overlay_model_doc(100_000, 5_000)
                }
            }
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    // Overlay entries win over baseline entries with the same id.
    let opus = catalog.resolve(BackendKind::AnthropicMessages, "claude-opus-4-6");
    assert_eq!(opus.source, ModelSource::Overlay);
    assert_eq!(opus.context_window, 424_242);
    assert_eq!(opus.max_tokens, 11_111);
    assert_eq!(opus.cost.input, 1.0);
    // New ids appear as overlay entries.
    let novel = catalog.resolve(BackendKind::AnthropicMessages, "claude-v9-overlay");
    assert_eq!(novel.source, ModelSource::Overlay);
    // Omitted baseline entries are retired by the provider snapshot.
    let sonnet = catalog.resolve(BackendKind::AnthropicMessages, "claude-sonnet-4-6");
    assert_eq!(sonnet.source, ModelSource::ProviderDefault);
}

#[test]
fn overlay_load_skips_unknown_and_malformed_providers() {
    let home = TempHome::new("overlay-tolerance");
    write_overlay(
        home.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "made-up-provider": { "models": { "x": overlay_model_doc(1_000, 100) } },
            "deepseek-chat": "garbage",
            "together-chat": { "models": { "together-v9": overlay_model_doc(50_000, 2_000) } }
        }),
    );

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(
        warnings
            .iter()
            .all(|w| matches!(w, CatalogWarning::OverlayEntrySkipped { .. })),
        "{warnings:?}"
    );
    assert_eq!(
        catalog
            .resolve(BackendKind::TogetherChat, "together-v9")
            .source,
        ModelSource::Overlay
    );
}

// ---------------------------------------------------------------------------
// Runtime mapper parity with the generator pipeline
// ---------------------------------------------------------------------------

/// The recorded models.dev snapshot the checked-in baseline was generated
/// from (the generator's golden fixture pins byte-identical regen).
const MODELS_DEV_FIXTURE: &str =
    include_str!("../../../../nac-catalog-gen/fixtures/models-dev-api.json");

/// The runtime mapper (seed-derived thinking maps) and the generator
/// pipeline (models.dev seeds + overrides.toml) must produce identical
/// records for the same snapshot. If `overrides.toml` or the generator's
/// mapping ever changes without a matching seed update, this fails loudly.
#[test]
fn runtime_mapper_matches_the_checked_in_baseline() {
    let baseline_catalog = baseline_catalog();
    let (providers, warnings, count) =
        map_models_dev(MODELS_DEV_FIXTURE, &baseline_catalog).expect("fixture maps");
    assert_eq!(count, 79, "fixture agent-compatible model count drifted");
    assert!(warnings.is_empty(), "{warnings:?}");

    let baseline: data::GeneratedCatalog =
        serde_json::from_str(data::GENERATED_CATALOG_JSON).expect("embedded baseline parses");
    assert_eq!(baseline.providers.len(), providers.len());
    for (provider, expected_provider) in &baseline.providers {
        let actual_provider = providers
            .get(provider)
            .unwrap_or_else(|| panic!("{provider} missing from the mapped overlay"));
        assert_eq!(
            actual_provider.credential_env_var, expected_provider.credential_env_var,
            "{provider}: credential env var mapping drifted"
        );
        assert_eq!(
            actual_provider.default_base_url, expected_provider.default_base_url,
            "{provider}: default base URL mapping drifted"
        );
        assert_eq!(
            actual_provider.models.len(),
            expected_provider.models.len(),
            "{provider}"
        );
        for (id, expected) in &expected_provider.models {
            let actual = actual_provider
                .models
                .get(id)
                .unwrap_or_else(|| panic!("{provider}/{id} missing from the mapped overlay"));
            assert_eq!(
                actual, expected,
                "{provider}/{id}: runtime mapper and generator pipeline drifted"
            );
        }
    }
}

#[test]
fn runtime_mapper_refreshes_known_model_image_capability_in_both_directions() {
    let baseline = baseline_catalog();
    for (inputs, expected) in [
        (serde_json::json!(["text", "image"]), true),
        (serde_json::json!(["text"]), false),
    ] {
        let payload = serde_json::json!({
            "deepseek": {
                "models": {
                    "deepseek-v4-flash": {
                        "modalities": { "input": inputs, "output": ["text"] }
                    }
                }
            }
        })
        .to_string();
        let (providers, _, _) = map_models_dev(&payload, &baseline).unwrap();
        assert_eq!(
            providers[&BackendKind::DeepSeekChat].models["deepseek-v4-flash"].image_input,
            expected
        );
    }
}
#[test]
fn runtime_mapper_preserves_only_malformed_baseline_ids() {
    let seed = seed::seed_catalog();
    let payload = serde_json::json!({
        "deepseek": {
            "models": {
                // Known baseline ID whose refreshed record cannot be decoded.
                "deepseek-v4-flash": "not-an-object",
                // Known baseline ID explicitly declared incompatible.
                "deepseek-v4-pro": {
                    "tool_call": false,
                    "limit": { "context": 1_000, "output": 100 }
                }
                // The other known baseline IDs are genuinely absent.
            }
        }
    })
    .to_string();

    let (mut providers, warnings, count) = map_models_dev(&payload, &seed).unwrap();
    assert_eq!(count, 1);
    assert!(warnings.iter().any(|warning| {
        warning.contains("deepseek-v4-flash") && warning.contains("kept embedded baseline")
    }));
    let mapped = providers.remove(&BackendKind::DeepSeekChat).unwrap();
    let baseline: data::GeneratedCatalog =
        serde_json::from_str(data::GENERATED_CATALOG_JSON).unwrap();
    assert_eq!(
        mapped.models["deepseek-v4-flash"],
        baseline.providers[&BackendKind::DeepSeekChat].models["deepseek-v4-flash"]
    );
    assert!(!mapped.models.contains_key("deepseek-v4-pro"));

    let mut catalog = seed::seed_catalog();
    data::merge_generated_baseline(&mut catalog);
    data::merge_entries(
        &mut catalog,
        BackendKind::DeepSeekChat,
        mapped,
        ModelSource::Overlay,
    );
    let preserved = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-v4-flash");
    let expected = &baseline.providers[&BackendKind::DeepSeekChat].models["deepseek-v4-flash"];
    assert_eq!(preserved.context_window, expected.context_window);
    assert_eq!(preserved.max_tokens, expected.max_tokens);
    assert_eq!(preserved.cost, expected.cost);
    assert_eq!(
        catalog
            .resolve(BackendKind::DeepSeekChat, "deepseek-v4-pro")
            .source,
        ModelSource::ProviderDefault
    );
}

#[test]
fn runtime_mapper_maps_api_to_default_base_url_with_baseline_fallback() {
    let baseline = baseline_catalog();
    let payload = serde_json::json!({
        "deepseek": {
            // A moved endpoint wins and is normalized (trailing slash).
            "api": "https://api.deepseek.example/v2/",
            "models": { "deepseek-v9-mapper-test": {
                "name": "Mapper Test", "reasoning": true,
                "limit": { "context": 999_000, "output": 77_000 },
                "cost": { "input": 1.5, "output": 6.0 }
            } }
        },
        "anthropic": {
            // No `api`: falls back to the baseline's curated SDK-default URL.
            "models": { "claude-mapper-test": {
                "name": "Mapper Test", "reasoning": false,
                "limit": { "context": 200_000, "output": 64_000 },
                "cost": { "input": 3.0, "output": 15.0 }
            } }
        },
        "fireworks-ai": {
            // Drifted `api`: warning + the baseline fallback, never a hard error.
            "api": "not a url",
            "models": {}
        }
    })
    .to_string();

    let (providers, warnings, _) = map_models_dev(&payload, &baseline).expect("payload maps");
    assert_eq!(
        providers[&BackendKind::DeepSeekChat]
            .default_base_url
            .as_deref(),
        Some("https://api.deepseek.example/v2")
    );
    assert_eq!(
        providers[&BackendKind::AnthropicMessages]
            .default_base_url
            .as_deref(),
        Some("https://api.anthropic.com")
    );
    assert_eq!(
        providers[&BackendKind::FireworksChat]
            .default_base_url
            .as_deref(),
        Some("https://api.fireworks.ai/inference/v1"),
        "invalid api degrades to the baseline value"
    );
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("invalid api base URL")),
        "{warnings:?}"
    );
    // The two missing providers are reported, not fatal.
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("togetherai")),
        "{warnings:?}"
    );
}

#[test]
fn runtime_mapper_maps_context_tiers_and_skips_unknown_tier_types() {
    let baseline = baseline_catalog();
    let payload = serde_json::json!({
        "deepseek": {
            "models": { "deepseek-v9-tier-test": {
                "name": "Tier Test", "reasoning": false,
                "limit": { "context": 1_000_000, "output": 64_000 },
                "cost": {
                    "input": 3.0, "output": 15.0, "cache_read": 0.3, "cache_write": 3.75,
                    "tiers": [
                        { "tier": { "type": "context", "size": 200_000 }, "input": 6.0, "output": 22.5 },
                        { "tier": { "type": "time_of_day", "size": 1_000 }, "input": 99.0 }
                    ]
                }
            } }
        }
    })
    .to_string();

    let (mut providers, warnings, _) = map_models_dev(&payload, &baseline).expect("payload maps");
    let mapped = providers.remove(&BackendKind::DeepSeekChat).unwrap();
    let cost = &mapped.models["deepseek-v9-tier-test"].cost;
    let tiers = cost.tiers.as_ref().expect("context tier mapped");
    assert_eq!(
        tiers.len(),
        1,
        "non-context tier type skipped: {warnings:?}"
    );
    assert_eq!(tiers[0].input_tokens_above, 200_000);
    assert_eq!(tiers[0].input, 6.0);
    assert_eq!(tiers[0].output, 22.5);
    assert_eq!(tiers[0].cache_read, 0.3, "omitted bucket fills from base");
    assert_eq!(tiers[0].cache_write, 3.75, "omitted bucket fills from base");
}

#[test]
fn runtime_mapper_skips_models_with_bad_tier_rates() {
    let baseline = baseline_catalog();
    let payload = serde_json::json!({
        "deepseek": {
            "models": { "deepseek-v9-bad-tier": {
                "name": "Bad Tier", "reasoning": false,
                "limit": { "context": 1_000_000, "output": 64_000 },
                "cost": {
                    "input": 3.0, "output": 15.0,
                    "tiers": [
                        { "tier": { "type": "context", "size": 200_000 }, "output": -2.0 }
                    ]
                }
            } }
        }
    })
    .to_string();

    let (mut providers, warnings, _) = map_models_dev(&payload, &baseline).expect("payload maps");
    let mapped = providers.remove(&BackendKind::DeepSeekChat).unwrap();
    assert!(!mapped.models.contains_key("deepseek-v9-bad-tier"));
    assert!(
        warnings
            .iter()
            .any(|warning| warning.contains("deepseek-v9-bad-tier")
                && warning.contains("invalid output rate")
                && warning.contains("skipped")),
        "{warnings:?}"
    );
}

#[test]
fn overlay_default_base_url_upgrades_and_never_erases() {
    let home = TempHome::new("overlay-base-url");

    // A present overlay value upgrades the provider endpoint default.
    write_overlay(
        home.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": {
                "default_base_url": "https://api.deepseek.example/v9",
                "models": {}
            }
        }),
    );
    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(
        catalog
            .default_base_url(BackendKind::DeepSeekChat)
            .as_deref(),
        Some("https://api.deepseek.example/v9")
    );

    // An absent one (a pre-envelope overlay) keeps the baseline's value.
    write_overlay(
        home.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": { "models": {} }
        }),
    );
    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(
        catalog
            .default_base_url(BackendKind::DeepSeekChat)
            .as_deref(),
        Some("https://api.deepseek.com"),
        "an overlay without the field must not erase the baseline default"
    );
}

#[test]
fn runtime_mapper_maps_credential_env_var_tolerantly() {
    let seed = seed::seed_catalog();
    let payload = serde_json::json!({
        "deepseek": {"env": ["DEEPSEEK_TEST_KEY", "SECONDARY_KEY"], "models": {}},
        "fireworks-ai": {"models": {}},
        "togetherai": {"env": [], "models": {}},
        "openai": {"env": "not-a-list", "models": {}},
        "anthropic": {"env": ["not a valid name!!"], "models": {}}
    })
    .to_string();
    let (providers, warnings, _) = map_models_dev(&payload, &seed).expect("payload maps");
    let var = |provider: BackendKind| providers[&provider].credential_env_var.as_deref();
    // The first entry wins; missing and empty lists map to None silently.
    assert_eq!(var(BackendKind::DeepSeekChat), Some("DEEPSEEK_TEST_KEY"));
    assert_eq!(var(BackendKind::FireworksChat), None);
    assert_eq!(var(BackendKind::TogetherChat), None);
    // Malformed lists and invalid names warn and map to None (the merge
    // keeps the baseline's value) instead of failing the provider.
    assert_eq!(var(BackendKind::OpenAiResponses), None);
    assert_eq!(var(BackendKind::AnthropicMessages), None);
    assert_eq!(warnings.len(), 2, "{warnings:?}");
    assert!(
        warnings.iter().any(|w| w.contains("malformed env list")),
        "{warnings:?}"
    );
    assert!(
        warnings
            .iter()
            .any(|w| w.contains("invalid credential env var name")),
        "{warnings:?}"
    );
}

#[test]
fn overlay_credential_env_var_upgrades_and_never_erases() {
    // A present overlay value replaces the baseline's; an absent one keeps
    // it (older overlays predate the field).
    let home = TempHome::new("credential-env-merge");
    let generated_at = data::parse_manifest().unwrap().generated_at;
    write_overlay(
        home.path(),
        &generated_at,
        serde_json::json!({
            "deepseek-chat": {
                "credential_env_var": "DEEPSEEK_UPGRADED_KEY",
                "models": {}
            },
            "fireworks-chat": {
                "models": {}
            }
        }),
    );
    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));
    assert!(warnings.is_empty(), "{warnings:?}");
    assert_eq!(
        catalog.providers[&BackendKind::DeepSeekChat]
            .credential_env_var
            .as_deref(),
        Some("DEEPSEEK_UPGRADED_KEY")
    );
    assert_eq!(
        catalog.providers[&BackendKind::FireworksChat]
            .credential_env_var
            .as_deref(),
        Some("FIREWORKS_API_KEY")
    );
}

// ---------------------------------------------------------------------------
// Small units: time formatting, timestamp shape, sidecar IO
// ---------------------------------------------------------------------------

#[test]
fn format_unix_utc_matches_the_generator() {
    assert_eq!(format_unix_utc(0), "1970-01-01T00:00:00Z");
    assert_eq!(format_unix_utc(86_399), "1970-01-01T23:59:59Z");
    assert_eq!(format_unix_utc(1_735_689_600), "2025-01-01T00:00:00Z");
    assert_eq!(format_unix_utc(1_767_225_600), "2026-01-01T00:00:00Z");
    // Leap day: 2024-02-29T12:00:00Z.
    assert_eq!(format_unix_utc(1_709_208_000), "2024-02-29T12:00:00Z");
}

#[test]
fn is_utc_iso8601_checks_shape() {
    assert!(is_utc_iso8601("2026-08-03T01:02:03Z"));
    assert!(!is_utc_iso8601("2026-08-03T01:02:03+00:00"));
    assert!(!is_utc_iso8601("2026-08-03 01:02:03Z"));
    assert!(!is_utc_iso8601("not-a-date"));
    assert!(!is_utc_iso8601("2026-8-3T1:2:3Z"));
}

#[test]
fn sidecar_round_trips_and_corrupt_sidecar_is_ignored() {
    let home = TempHome::new("sidecar");
    let path = overlay_dir(home.path()).join("overlay.etag");
    assert_eq!(read_sidecar(&path), None);

    let sidecar = OverlaySidecar {
        schema_version: OVERLAY_SCHEMA_VERSION,
        etag: Some("\"e\"".to_string()),
        fetched_at_unix: 42,
        url: "https://models.dev/api.json".to_string(),
    };
    write_sidecar(&path, &sidecar);
    assert_eq!(read_sidecar(&path), Some(sidecar));

    std::fs::write(&path, "{ corrupt").unwrap();
    assert_eq!(read_sidecar(&path), None);
}

#[tokio::test]
async fn source_url_change_bypasses_cadence_and_old_etag() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = EnvGuard::new("refresh-url-change", &["NAC_HOME"], &[]).with_env_layers();
    write_sidecar_file(
        env.path(),
        Some("\"old\""),
        unix_now(),
        "https://old.example/api.json",
    );
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        novel_model_payload(),
    )]);
    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;
    assert!(
        matches!(outcome, RefreshOutcome::Updated { .. }),
        "{outcome:?}"
    );
    let requests = server.finish();
    assert_eq!(requests[0].headers.get("if-none-match"), None);
}

#[test]
fn overlay_provider_snapshot_retires_missing_baseline_models() {
    let home = TempHome::new("overlay-retires-baseline");
    write_overlay(
        home.path(),
        "2099-01-01T00:00:00Z",
        serde_json::json!({"deepseek-chat":{"models":{NOVEL_MODEL:overlay_model_doc(999_000,77_000)}}}),
    );
    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));
    assert!(warnings.is_empty(), "{warnings:?}");
    let provider = &catalog.providers[&BackendKind::DeepSeekChat];
    assert_eq!(provider.models.len(), 1);
    assert!(!provider.models.contains_key("deepseek-chat"));
}

#[test]
fn arcee_overlay_load_caps_healed_max_tokens_at_context_window() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TempHome::new("arcee-heal-cap");
    // A stale cache entry from before the fallback heal existed: sparse
    // context window with the old 16k fallback max_tokens. The heal replaces
    // 16k with the seeded 256k, which must then be capped at the entry's
    // context window (mirroring `map_arcee_model`).
    let dir = overlay_dir(home.path());
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("arcee-overlay.json"),
        serde_json::json!([{
            "id": "deepseek/deepseek-v4-flash-latest",
            "display_name": "DeepSeek-V4-Flash",
            "context_window": 128_000,
            "max_tokens": 16_384,
            "cost": { "input": 0.0, "output": 0.0, "cache_read": 0.0, "cache_write": 0.0 },
            "reasoning": true,
            "thinking_level_map": {},
            "adaptive_thinking": false,
            "enabled_thinking": false,
            "context_management": false,
            "clear_thinking": false
        }])
        .to_string(),
    )
    .unwrap();

    let (catalog, warnings) = ModelCatalog::load_from_home(Some(home.path()));

    assert!(warnings.is_empty(), "{warnings:?}");
    let metadata = catalog.resolve(BackendKind::ArceeAuth, "deepseek/deepseek-v4-flash-latest");
    assert_eq!(metadata.max_tokens, 128_000);
}
