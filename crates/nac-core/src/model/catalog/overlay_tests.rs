//! S2 tests: overlay load/refresh, the runtime models.dev mapper (incl.
//! the generator-parity guard), and the zero-network contract of the
//! resolution/validation paths.

use super::data;
use super::overlay::{
    format_unix_utc, is_utc_iso8601, map_models_dev, overlay_dir, read_sidecar,
    refresh_overlay_once, reset_refresh_for_test, spawn_overlay_refresh, unix_now, write_sidecar,
    OverlaySidecar, RefreshOutcome, REFRESH_CADENCE_SECS,
};
use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::model::{validate_model_configuration, EffectiveModelSettings, ReasoningEffort};
use crate::TEST_ENV_LOCK;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const NOVEL_MODEL: &str = "deepseek-v9-overlay-test";

/// Serialize env-mutating refresh tests; restores env, disables the
/// machine-state layers and reloads the baseline-only global catalog on
/// drop, so concurrent tests never observe overlay data.
struct RefreshEnvGuard {
    original: Vec<(&'static str, Option<OsString>)>,
    home: PathBuf,
}

impl RefreshEnvGuard {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let home = std::env::temp_dir().join(format!(
            "nac-catalog-overlay-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&home).unwrap();
        let original = ["NAC_HOME", "MODELS_DEV_URL", "DEEPSEEK_API_KEY"]
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect::<Vec<_>>();
        unsafe { std::env::set_var("NAC_HOME", &home) };
        set_env_layers_for_test(true);
        Self { original, home }
    }

    fn overlay_path(&self) -> PathBuf {
        overlay_dir(&self.home).join("overlay.json")
    }

    fn sidecar_path(&self) -> PathBuf {
        overlay_dir(&self.home).join("overlay.etag")
    }
}

impl Drop for RefreshEnvGuard {
    fn drop(&mut self) {
        for (name, value) in self.original.drain(..) {
            match value {
                Some(value) => unsafe { std::env::set_var(name, value) },
                None => unsafe { std::env::remove_var(name) },
            }
        }
        set_env_layers_for_test(false);
        let _ = std::fs::remove_dir_all(&self.home);
        reset_for_test();
        reset_refresh_for_test();
    }
}

/// Temp home for layered-load tests that never touch the environment or
/// the process-global catalog.
struct TempHome(PathBuf);

impl TempHome {
    fn new(label: &str) -> Self {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time went backwards")
            .as_nanos();
        let home = std::env::temp_dir().join(format!(
            "nac-catalog-local-{label}-{}-{unique}",
            std::process::id()
        ));
        std::fs::create_dir_all(&home).unwrap();
        Self(home)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn novel_model_payload() -> String {
    serde_json::json!({
        "deepseek": {
            "models": {
                NOVEL_MODEL: {
                    "name": "DeepSeek V9 Overlay Test",
                    "reasoning": true,
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

fn write_overlay(home: &Path, generated_at: &str, providers: serde_json::Value) {
    let dir = overlay_dir(home);
    std::fs::create_dir_all(&dir).unwrap();
    let doc = serde_json::json!({ "generated_at": generated_at, "providers": providers });
    std::fs::write(
        dir.join("overlay.json"),
        serde_json::to_string_pretty(&doc).unwrap(),
    )
    .unwrap();
}

fn write_sidecar_file(home: &Path, etag: Option<&str>, fetched_at_unix: u64) {
    let dir = overlay_dir(home);
    std::fs::create_dir_all(&dir).unwrap();
    write_sidecar(
        &dir.join("overlay.etag"),
        &OverlaySidecar {
            etag: etag.map(str::to_string),
            fetched_at_unix,
            url: "https://models.dev/api.json".to_string(),
        },
    );
}

// ---------------------------------------------------------------------------
// Refresh: 200 / 304 / errors / timeout / cadence
// ---------------------------------------------------------------------------

#[tokio::test]
async fn refresh_fetches_maps_writes_overlay_and_reloads_catalog() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-200");
    let started_at = unix_now();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", novel_model_payload())
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
    assert!(warnings.iter().any(|w| w.contains("fireworks-ai")), "{warnings:?}");

    // The request revalidates with the embedded baseline's ETag (no sidecar
    // existed yet).
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    let manifest_etag = data::parse_manifest().unwrap().models_dev_etag.unwrap();
    assert_eq!(
        requests[0].headers.get("if-none-match").map(String::as_str),
        Some(manifest_etag.as_str())
    );

    // The overlay file carries the mapped entry with a fresh timestamp.
    let written: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(env.overlay_path()).unwrap()).unwrap();
    let entry = &written["providers"]["deepseek-chat"]["models"][NOVEL_MODEL];
    assert_eq!(entry["context_window"], 999_000);
    assert_eq!(entry["max_tokens"], 77_000);
    // The thinking map derives from the deepseek seed default (the matrix row).
    assert_eq!(entry["thinking_level_map"]["xhigh"], "max");
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

    // The process-global catalog reloaded with the overlay entry.
    let metadata = resolve(BackendKind::DeepSeekChat, NOVEL_MODEL);
    assert_eq!(metadata.source, ModelSource::Overlay);
    assert_eq!(metadata.context_window, 999_000);
    assert_eq!(metadata.max_tokens, 77_000);
    assert_eq!(metadata.cost.input, 1.5);
    assert_eq!(metadata.display_name.as_deref(), Some("DeepSeek V9 Overlay Test"));
    assert_eq!(metadata.cache_write_1h, None);
    assert_eq!(
        metadata.thinking_level_map.wire_value(ReasoningEffort::Xhigh),
        Some("max")
    );
    assert!(metadata.thinking_level_map.is_supported(ReasoningEffort::High));
    assert!(!metadata.thinking_level_map.is_supported(ReasoningEffort::Low));
    assert_eq!(
        metadata.compat.completions_thinking_format,
        Some(CompletionsThinkingFormat::Deepseek)
    );
    assert_eq!(
        metadata.compat.completions_reasoning_field.as_deref(),
        Some("reasoning_content")
    );

    // Write-tmp + rename leaves no partial files behind.
    let mut files = std::fs::read_dir(overlay_dir(&env.home))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    files.sort();
    assert_eq!(files, ["overlay.etag", "overlay.json"]);
}

#[tokio::test]
async fn refresh_sends_sidecar_etag_for_revalidation() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-sidecar-etag");
    write_sidecar_file(&env.home, Some("\"sidecar-etag\""), 0);
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", novel_model_payload())
        .with_header("ETag", "\"new-etag\"")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert!(matches!(outcome, RefreshOutcome::Updated { .. }), "{outcome:?}");
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
async fn refresh_304_without_overlay_keeps_baseline_and_bumps_sidecar() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-304");
    let started_at = unix_now();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("304 Not Modified", "")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert_eq!(outcome, RefreshOutcome::NotModified);
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    // No overlay is written for an unchanged snapshot; the baseline stays
    // authoritative.
    assert!(!env.overlay_path().exists());
    let metadata = resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(metadata.source, ModelSource::Baseline);
    // The sidecar clock advances (cadence) and keeps the revalidated ETag.
    let sidecar = read_sidecar(&env.sidecar_path()).expect("sidecar written on 304");
    let manifest_etag = data::parse_manifest().unwrap().models_dev_etag.unwrap();
    assert_eq!(sidecar.etag.as_deref(), Some(manifest_etag.as_str()));
    assert!(sidecar.fetched_at_unix >= started_at);
}

#[tokio::test]
async fn refresh_304_preserves_an_existing_overlay() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-304-keep");
    write_overlay(
        &env.home,
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": { "models": { "deepseek-v8-preexisting": overlay_model_doc(555_000, 8_000) } }
        }),
    );
    write_sidecar_file(&env.home, Some("\"old-etag\""), 0);
    let overlay_bytes = std::fs::read_to_string(env.overlay_path()).unwrap();
    reset_for_test();
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v8-preexisting").source,
        ModelSource::Overlay
    );
    let server = ScriptedServer::start(vec![ScriptedResponse::json("304 Not Modified", "")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    assert_eq!(outcome, RefreshOutcome::NotModified);
    assert_eq!(std::fs::read_to_string(env.overlay_path()).unwrap(), overlay_bytes);
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v8-preexisting").source,
        ModelSource::Overlay
    );
    let sidecar = read_sidecar(&env.sidecar_path()).unwrap();
    assert_eq!(sidecar.etag.as_deref(), Some("\"old-etag\""));
    assert!(sidecar.fetched_at_unix > 0);
}

#[tokio::test]
async fn refresh_http_error_preserves_existing_overlay_and_sidecar() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-500");
    write_overlay(
        &env.home,
        "2099-01-01T00:00:00Z",
        serde_json::json!({
            "deepseek-chat": { "models": { "deepseek-v8-preexisting": overlay_model_doc(555_000, 8_000) } }
        }),
    );
    write_sidecar_file(&env.home, Some("\"old-etag\""), 0);
    let overlay_bytes = std::fs::read_to_string(env.overlay_path()).unwrap();
    reset_for_test();
    let server = ScriptedServer::start(vec![ScriptedResponse::json("500 Internal Server Error", "{}")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    let RefreshOutcome::Failed { error } = outcome else {
        panic!("expected Failed, got {outcome:?}");
    };
    assert!(error.contains("HTTP 500"), "{error}");
    // A failed refresh neither clobbers the cached overlay nor advances the
    // sidecar clock (the next process start retries).
    assert_eq!(std::fs::read_to_string(env.overlay_path()).unwrap(), overlay_bytes);
    let sidecar = read_sidecar(&env.sidecar_path()).unwrap();
    assert_eq!(sidecar.fetched_at_unix, 0);
    assert_eq!(
        resolve(BackendKind::DeepSeekChat, "deepseek-v8-preexisting").source,
        ModelSource::Overlay
    );
}

#[tokio::test]
async fn refresh_network_failure_is_contained() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-offline");
    // Nothing listens on 127.0.0.1:1; the connection is refused instantly.
    let outcome = refresh_overlay_once("http://127.0.0.1:1/api.json", Duration::from_secs(2)).await;

    assert!(matches!(outcome, RefreshOutcome::Failed { .. }), "{outcome:?}");
    assert!(!env.overlay_path().exists());
    assert!(!env.sidecar_path().exists());
    // Offline behavior: the embedded baseline keeps resolving.
    let metadata = resolve(BackendKind::DeepSeekChat, "deepseek-chat");
    assert_eq!(metadata.source, ModelSource::Baseline);
    assert_eq!(metadata.context_window, 1_000_000);
}

#[tokio::test]
async fn refresh_timeout_is_contained() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-timeout");
    // A server that accepts and never responds.
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    std::thread::spawn(move || {
        if let Ok((stream, _)) = listener.accept() {
            std::thread::sleep(Duration::from_secs(3));
            drop(stream);
        }
    });

    let outcome = refresh_overlay_once(&url, Duration::from_millis(200)).await;

    assert!(matches!(outcome, RefreshOutcome::Failed { .. }), "{outcome:?}");
    assert!(!env.overlay_path().exists());
}

#[tokio::test]
async fn refresh_unmappable_payload_preserves_state() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-garbage");
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", "this is not json")]);

    let outcome = refresh_overlay_once(&server.base_url, Duration::from_secs(5)).await;

    let RefreshOutcome::Failed { error } = outcome else {
        panic!("expected Failed, got {outcome:?}");
    };
    assert!(error.contains("parsing models.dev payload"), "{error}");
    assert!(!env.overlay_path().exists());
    assert!(!env.sidecar_path().exists());
}

#[tokio::test]
async fn refresh_skips_drifted_models_and_providers() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let _env = RefreshEnvGuard::new("refresh-drift");
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
    assert!(warnings.iter().any(|w| w.contains("deepseek-v9-negative") && w.contains("input rate")), "{warnings:?}");
    assert!(warnings.iter().any(|w| w.contains("deepseek-v9-malformed")), "{warnings:?}");
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
    let env = RefreshEnvGuard::new("refresh-cadence");
    write_sidecar_file(&env.home, Some("\"fresh\""), unix_now());

    // The closed port would fail instantly if a request were attempted;
    // SkippedCadence proves none was made.
    let outcome = refresh_overlay_once("http://127.0.0.1:1/api.json", Duration::from_secs(2)).await;

    assert_eq!(outcome, RefreshOutcome::SkippedCadence);
}

#[tokio::test]
async fn stale_cadence_refetches() {
    let _lock = TEST_ENV_LOCK.lock().unwrap();
    let env = RefreshEnvGuard::new("refresh-cadence-stale");
    let started_at = unix_now();
    write_sidecar_file(&env.home, Some("\"stale\""), unix_now() - REFRESH_CADENCE_SECS - 60);
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
    let _env = RefreshEnvGuard::new("refresh-spawn");
    unsafe { std::env::set_var("MODELS_DEV_URL", "") }; // cleared: must fall back to the default
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", novel_model_payload())
        .with_header("ETag", "\"spawn-etag\"")]);
    unsafe { std::env::set_var("MODELS_DEV_URL", &server.base_url) };

    spawn_overlay_refresh();
    spawn_overlay_refresh(); // once-guard: no-op

    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if resolve(BackendKind::DeepSeekChat, NOVEL_MODEL).source == ModelSource::Overlay {
            break;
        }
        assert!(Instant::now() < deadline, "spawned refresh did not update the catalog");
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
    let _env = RefreshEnvGuard::new("no-network");
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
    ] {
        let metadata = resolve(provider, "any-model");
        assert_eq!(metadata.provider, provider);
    }
    // The settings-construction path (server PATCH + resume) resolves
    // catalog metadata locally.
    EffectiveModelSettings::from_optional(
        Some(BackendKind::DeepSeekChat),
        Some("deepseek-chat".to_string()),
        Some("https://api.deepseek.com".to_string()),
        Some(ReasoningEffort::High),
        None,
        std::collections::BTreeMap::new(),
    )
    .expect("valid settings");
    validate_model_configuration(
        BackendKind::DeepSeekChat,
        "deepseek-chat",
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
        catalog.resolve(BackendKind::DeepSeekChat, "deepseek-v9-stale").source,
        ModelSource::ProviderDefault
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
    let metadata = catalog.resolve(BackendKind::DeepSeekChat, "deepseek-chat");
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
        catalog.resolve(BackendKind::DeepSeekChat, "deepseek-v9-stale").source,
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
    // Untouched baseline entries stay baseline.
    let sonnet = catalog.resolve(BackendKind::AnthropicMessages, "claude-sonnet-4-6");
    assert_eq!(sonnet.source, ModelSource::Baseline);
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
        warnings.iter().all(|w| matches!(w, CatalogWarning::OverlayEntrySkipped { .. })),
        "{warnings:?}"
    );
    assert_eq!(
        catalog.resolve(BackendKind::TogetherChat, "together-v9").source,
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
    let seed = seed::seed_catalog();
    let (providers, warnings, count) =
        map_models_dev(MODELS_DEV_FIXTURE, &seed).expect("fixture maps");
    assert_eq!(count, 117, "fixture model count drifted");
    assert!(warnings.is_empty(), "{warnings:?}");

    let baseline: data::GeneratedCatalog =
        serde_json::from_str(data::GENERATED_CATALOG_JSON).expect("embedded baseline parses");
    assert_eq!(baseline.providers.len(), providers.len());
    for (provider, expected_provider) in &baseline.providers {
        let actual_provider = providers
            .get(provider)
            .unwrap_or_else(|| panic!("{provider} missing from the mapped overlay"));
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
        etag: Some("\"e\"".to_string()),
        fetched_at_unix: 42,
        url: "https://models.dev/api.json".to_string(),
    };
    write_sidecar(&path, &sidecar);
    assert_eq!(read_sidecar(&path), Some(sidecar));

    std::fs::write(&path, "{ corrupt").unwrap();
    assert_eq!(read_sidecar(&path), None);
}

