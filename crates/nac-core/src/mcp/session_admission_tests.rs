use super::recording_server::{RecordingMcpServer, TestHome};
use super::*;
use crate::TEST_ENV_LOCK;
use serde_json::json;
use std::fs;
use std::sync::mpsc;

async fn load(cwd: &Path) -> McpLoadOutcome {
    McpRegistry::load_reporting_skips(
        cwd,
        None,
        &PathContext::new(cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .unwrap()
}

fn seed_authorization(cwd: &Path, url: &str, token: &str, expires_in: Option<u64>) {
    oauth::test_support::seed_authorization(
        cwd,
        "oauth",
        url,
        "TEST_MCP_CLIENT_ID",
        token,
        expires_in,
    )
    .unwrap();
}

#[tokio::test]
async fn disconnect_stops_mounted_and_new_sessions_until_connect() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-disconnect-admission", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    // Captured before the disconnect, as an approval that is still pending would be.
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);

    let handler = &registry.servers["recorded"].handler;
    assert!(handler.admitted_server().is_some());
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    // Progress, log and resource-update notifications pass only through this gate.
    assert!(handler.admitted_server().is_none());
    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(refused.content.to_string().contains("disconnected"));
    assert_eq!(server.authorizations("tools/call").len(), 1);
    let prompt_lists = server.authorizations("prompts/list").len();
    let prompts = registry
        .call_capability(
            capabilities::LIST_PROMPTS_TOOL,
            json!({"server": "recorded"}),
        )
        .await;
    assert!(prompts.is_error);
    assert!(prompts.content.to_string().contains("disconnected"));
    assert_eq!(server.authorizations("prompts/list").len(), prompt_lists);

    let initializations = server.authorizations("initialize").len();
    let fresh = load(&cwd).await;
    assert!(fresh.registry.is_none());
    assert!(fresh
        .skipped
        .iter()
        .any(|skipped| skipped.name == "recorded" && skipped.reason.contains("disconnected")));
    assert_eq!(server.authorizations("initialize").len(), initializations);

    let restarted = McpRuntimeManager::new(home.path.clone());
    let status = restarted.statuses().await.unwrap().remove(0);
    assert_eq!(status.state, McpRuntimeState::Disconnected);
    assert!(status.sessions_blocked);

    let connected = restarted.connect("recorded").await.unwrap();
    assert_eq!(connected.state, McpRuntimeState::Connected);
    assert!(!connected.sessions_blocked);
    assert!(!capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 2);
    restarted.disconnect("recorded").await.unwrap();
    restarted.forget("recorded").await;
    drop(registry);
}

#[tokio::test]
async fn logout_stops_a_mounted_session_from_sending_until_reauthorized() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-logout-admission", "oauth", &server.url);
    let cwd = std::env::current_dir().unwrap();
    seed_authorization(&cwd, &server.url, "first-access-canary", None);
    let registry = load(&cwd).await.registry.expect("OAuth server mounts");
    let capture = registry.capture_tool("mcp__oauth__echo").unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);

    clear_mcp_oauth(&cwd, "oauth").unwrap();
    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(!refused.content.to_string().contains("canary"));
    assert_eq!(
        server.authorizations("tools/call"),
        vec![Some("Bearer first-access-canary".to_string())]
    );

    seed_authorization(&cwd, &server.url, "second-access-canary", None);
    assert!(!capture.call(json!({}), false).await.is_error);
    assert_eq!(
        server
            .authorizations("tools/call")
            .last()
            .cloned()
            .flatten(),
        Some("Bearer second-access-canary".to_string())
    );
    drop(registry);
    drop(home);
}

#[tokio::test]
async fn an_expired_token_without_refresh_is_never_sent_or_replaced_by_no_credentials() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let _home = TestHome::new("nac-mcp-expired-token", "oauth", &server.url);
    let cwd = std::env::current_dir().unwrap();
    seed_authorization(&cwd, &server.url, "live-access-canary", None);
    let registry = load(&cwd).await.registry.expect("OAuth server mounts");
    let capture = registry.capture_tool("mcp__oauth__echo").unwrap();

    // Issued at the epoch and valid for a minute: expired, with no refresh token to renew it.
    seed_authorization(&cwd, &server.url, "expired-access-canary", Some(60));
    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(!refused.content.to_string().contains("canary"));
    assert!(server.authorizations("tools/call").is_empty());
    drop(registry);
}

#[tokio::test]
async fn a_token_the_server_revoked_fails_once_without_an_unauthenticated_retry() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start_rejecting("Bearer revoked-access-canary");
    let _home = TestHome::new("nac-mcp-revoked-token", "oauth", &server.url);
    let cwd = std::env::current_dir().unwrap();
    seed_authorization(&cwd, &server.url, "revoked-access-canary", None);
    let registry = load(&cwd).await.registry.expect("OAuth server mounts");
    let capture = registry.capture_tool("mcp__oauth__echo").unwrap();

    let refused = capture.call(json!({}), false).await;
    assert!(refused.is_error);
    assert!(!refused.content.to_string().contains("canary"));
    assert_eq!(
        server.authorizations("tools/call"),
        vec![Some("Bearer revoked-access-canary".to_string())]
    );
    drop(registry);
}

/// Starts the capture's call and waits until the server holds it.
async fn call_held(
    capture: &McpToolCapture,
    arrival: mpsc::Receiver<()>,
) -> tokio::task::JoinHandle<ToolResult> {
    let capture = capture.clone();
    let call = tokio::spawn(async move { capture.call(json!({}), false).await });
    tokio::task::spawn_blocking(move || arrival.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("the call reaches the server");
    call
}

#[tokio::test]
async fn a_call_running_across_disconnect_settles_once() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let (server, arrival, release) = RecordingMcpServer::start_holding_first_call();
    let home = TestHome::new("nac-mcp-disconnect-in-flight", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let call = call_held(&capture, arrival).await;

    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    release.send(()).unwrap();
    let settled = call.await.unwrap();
    assert!(!settled.is_error, "{}", settled.content);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    assert!(capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    drop(registry);
}

#[tokio::test]
async fn a_call_interrupted_across_disconnect_is_not_replayed() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let (server, arrival, release) = RecordingMcpServer::start_holding_first_call();
    let home = TestHome::new("nac-mcp-disconnect-interrupted", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let call = call_held(&capture, arrival).await;

    McpRuntimeManager::new(home.path.clone())
        .disconnect("recorded")
        .await
        .unwrap();
    call.abort();
    assert!(call.await.unwrap_err().is_cancelled());
    release.send(()).unwrap();
    assert!(capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    drop(registry);
}

fn blocked(statuses: &[McpRuntimeStatus], name: &str) -> bool {
    statuses
        .iter()
        .find(|status| status.name == name)
        .unwrap()
        .sessions_blocked
}

#[tokio::test]
async fn an_unreadable_disconnect_record_keeps_every_mounted_session_blocked() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "nac-mcp-unreadable-state",
        "recorded",
        &server.url,
        "[mcp_servers.deleted]\ntransport = \"streamable_http\"\nurl = \"http://127.0.0.1:9/deleted\"\n\
         [mcp_servers.other]\ntransport = \"streamable_http\"\nurl = \"http://127.0.0.1:9/other\"\n",
    );
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let runtime = McpRuntimeManager::new(home.path.clone());
    // A disconnected server that was then deleted is no longer in the configuration.
    let deleted_state =
        admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    let deleted = deleted_state.snapshot().unwrap().mount("deleted");
    runtime.disconnect("deleted").await.unwrap();
    file_config::delete_mcp_server_configuration(&home.path.join("config.toml"), "deleted")
        .unwrap();
    runtime.forget_connection("deleted").unwrap();
    fs::write(home.path.join("mcp_disconnected.json"), "not json").unwrap();
    assert!(capture.call(json!({}), false).await.is_error);

    let statuses = runtime.statuses().await.unwrap();
    assert_eq!(statuses.len(), 2);
    assert!(statuses.iter().all(|status| status.sessions_blocked
        && status
            .error
            .as_deref()
            .is_some_and(|error| error.contains("unreadable"))));

    let _ = runtime.connect("other").await;
    assert!(!deleted_state.is_admitted(&deleted).unwrap());
    let statuses = runtime.statuses().await.unwrap();
    assert!(!blocked(&statuses, "other"));
    assert!(
        blocked(&statuses, "recorded"),
        "repairing one server re-admitted another"
    );

    // Connect admits new sessions; the record no longer vouches for sessions mounted before it was lost.
    runtime.connect("recorded").await.unwrap();
    assert!(capture.call(json!({}), false).await.is_error);
    assert!(server.authorizations("tools/call").is_empty());
    let fresh = load(&cwd).await.registry.expect("server mounts again");
    let fresh_capture = fresh.capture_tool("mcp__recorded__echo").unwrap();
    assert!(!fresh_capture.call(json!({}), false).await.is_error);
    runtime.forget("recorded").await;
    drop((registry, fresh));
}

#[tokio::test]
async fn disconnecting_a_renamed_server_stops_sessions_that_mounted_its_old_name() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-rename-disconnect", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.expect("server mounts");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let config = home.path.join("config.toml");
    let runtime = McpRuntimeManager::new(home.path.clone());
    let rename = |from: &str, to: &str| {
        let (mut record, _) =
            file_config::load_mcp_server_configuration_snapshot(&config, from).unwrap();
        record.name = to.to_string();
        file_config::update_mcp_server_configuration(&config, from, record).unwrap();
        runtime.rename_connection(from, to).unwrap();
    };

    rename("recorded", "renamed");
    assert!(!capture.call(json!({}), false).await.is_error);
    runtime.disconnect("renamed").await.unwrap();
    assert!(capture.call(json!({}), false).await.is_error);

    // Disconnect state follows the server through another rename.
    rename("renamed", "recorded");
    assert!(blocked(&runtime.statuses().await.unwrap(), "recorded"));
    rename("recorded", "renamed");
    runtime.connect("renamed").await.unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 2);

    // A new server under a deleted name starts connected and leaves the old sessions alone.
    runtime.disconnect("renamed").await.unwrap();
    file_config::delete_mcp_server_configuration(&config, "renamed").unwrap();
    runtime.forget_connection("renamed").unwrap();
    fs::write(
        &config,
        format!(
            "[mcp_servers.renamed]\ntransport = \"streamable_http\"\nurl = \"{}\"\napproval = \"allow\"\n",
            server.url
        ),
    )
    .unwrap();
    assert!(!blocked(&runtime.statuses().await.unwrap(), "renamed"));
    assert!(capture.call(json!({}), false).await.is_error);
    runtime.forget("renamed").await;
    drop(registry);
}

fn rename_config(config: &Path, from: &str, to: &str) {
    let (mut record, _) =
        file_config::load_mcp_server_configuration_snapshot(config, from).unwrap();
    record.name = to.to_string();
    file_config::update_mcp_server_configuration(config, from, record).unwrap();
}

#[tokio::test]
async fn a_session_still_loading_across_rename_and_disconnect_stays_on_the_renamed_server() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TestHome::new("nac-mcp-stale-load", "recorded", "http://127.0.0.1:9/mcp");
    let state = admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    let runtime = McpRuntimeManager::new(home.path.clone());
    let config = home.path.join("config.toml");
    // Registries load the record with the configuration, then mount each server after network awaits.
    let loaded_before = state.snapshot().unwrap();
    rename_config(&config, "recorded", "renamed");
    runtime.rename_connection("recorded", "renamed").unwrap();
    runtime.disconnect("renamed").await.unwrap();
    let stale = loaded_before.mount("recorded");
    assert!(!state.is_admitted(&stale).unwrap());

    // Neither a new server under the old name nor deleting it again takes over those sessions.
    runtime.claim_connection("recorded").unwrap();
    let fresh = state.snapshot().unwrap().mount("recorded");
    assert!(state.is_admitted(&fresh).unwrap());
    runtime.forget_connection("recorded").unwrap();
    assert!(!state.is_admitted(&stale).unwrap());
    runtime.connect("renamed").await.unwrap();
    assert!(state.is_admitted(&stale).unwrap());
    runtime.forget("renamed").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_registry_held_mid_load_across_rename_and_disconnect_does_not_mount_the_old_name() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let (early, arrival, release) = RecordingMcpServer::start_holding_first("initialize");
    let server = RecordingMcpServer::start();
    let home = TestHome::with_server(
        "nac-mcp-held-load",
        "recorded",
        &server.url,
        &format!(
            "[mcp_servers.aaa_early]\ntransport = \"streamable_http\"\nurl = \"{}\"\n",
            early.url
        ),
    );
    let cwd = std::env::current_dir().unwrap();
    let loading = tokio::spawn(async move { load(&cwd).await });
    tokio::task::spawn_blocking(move || arrival.recv_timeout(std::time::Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("the earlier server's startup is held");

    rename_config(&home.path.join("config.toml"), "recorded", "renamed");
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.rename_connection("recorded", "renamed").unwrap();
    runtime.disconnect("renamed").await.unwrap();
    release.send(()).unwrap();

    let outcome = loading.await.unwrap();
    assert!(outcome
        .skipped
        .iter()
        .any(|skipped| skipped.name == "recorded" && skipped.reason.contains("disconnected")));
    if let Some(registry) = outcome.registry.as_ref() {
        assert!(registry.capture_tool("mcp__recorded__echo").is_none());
    }
    assert!(server.authorizations("tools/call").is_empty());
}

#[tokio::test]
async fn a_name_renamed_onto_after_mount_is_resolved_by_when_it_was_bound() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TestHome::with_server(
        "nac-mcp-rename-onto",
        "recorded",
        "http://127.0.0.1:9/mcp",
        "[mcp_servers.other]\ntransport = \"streamable_http\"\nurl = \"http://127.0.0.1:9/other\"\n",
    );
    let state = admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    let runtime = McpRuntimeManager::new(home.path.clone());
    let config = home.path.join("config.toml");
    // `other` receives its identity before the session loads `recorded`, which has none yet.
    runtime.claim_connection("other").unwrap();
    let mounted = state.snapshot().unwrap().mount("recorded");

    file_config::delete_mcp_server_configuration(&config, "recorded").unwrap();
    rename_config(&config, "other", "recorded");
    runtime.rename_connection("other", "recorded").unwrap();
    runtime.disconnect("recorded").await.unwrap();
    assert!(!state.is_admitted(&mounted).unwrap());
}

#[tokio::test]
async fn a_server_created_over_a_stale_binding_gets_its_own_identity() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TestHome::new(
        "nac-mcp-stale-binding",
        "recorded",
        "http://127.0.0.1:9/mcp",
    );
    let state = admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    let mounted = state.snapshot().unwrap().mount("recorded");
    // Deleted by hand, so the record still binds the name; then created again in settings.
    let config = home.path.join("config.toml");
    let (record, _) =
        file_config::load_mcp_server_configuration_snapshot(&config, "recorded").unwrap();
    file_config::delete_mcp_server_configuration(&config, "recorded").unwrap();
    file_config::insert_mcp_server_configuration(&config, record).unwrap();

    runtime.claim_connection("recorded").unwrap();
    assert!(!state.is_disconnected("recorded").unwrap());
    runtime.connect("recorded").await.unwrap();
    assert!(!state.is_admitted(&mounted).unwrap());
    runtime.forget("recorded").await;
}

#[tokio::test]
async fn disconnecting_a_name_added_back_by_hand_stops_its_sessions() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TestHome::new("nac-mcp-hand-added", "recorded", "http://127.0.0.1:9/mcp");
    let state = admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    let runtime = McpRuntimeManager::new(home.path.clone());
    let config = home.path.join("config.toml");
    rename_config(&config, "recorded", "renamed");
    runtime.rename_connection("recorded", "renamed").unwrap();
    fs::write(
        &config,
        format!(
            "{}[mcp_servers.recorded]\ntransport = \"streamable_http\"\nurl = \"http://127.0.0.1:9/other\"\n",
            fs::read_to_string(&config).unwrap()
        ),
    )
    .unwrap();
    let added = state.snapshot().unwrap().mount("recorded");
    assert!(state.is_admitted(&added).unwrap());

    runtime.disconnect("recorded").await.unwrap();
    assert!(!state.is_admitted(&added).unwrap());
    let statuses = runtime.statuses().await.unwrap();
    assert!(blocked(&statuses, "recorded"));
    assert!(!blocked(&statuses, "renamed"));
}

#[cfg(unix)]
#[tokio::test]
async fn a_home_that_only_allows_config_reads_still_mounts_and_obeys_disconnect() {
    use std::os::unix::fs::PermissionsExt;
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-unwritable-home", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    // The first load leaves the writable config lock that later reads reuse.
    drop(load(&cwd).await);
    fs::set_permissions(&home.path, fs::Permissions::from_mode(0o555)).unwrap();
    let outcome = load(&cwd).await;
    fs::set_permissions(&home.path, fs::Permissions::from_mode(0o755)).unwrap();
    let registry = outcome.registry.expect("mounting needs no write");
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);

    McpRuntimeManager::new(home.path.clone())
        .disconnect("recorded")
        .await
        .unwrap();
    assert!(capture.call(json!({}), false).await.is_error);
    assert_eq!(server.authorizations("tools/call").len(), 1);
    drop(registry);
}

const PROCESS_DIR: &str = "NAC_TEST_MCP_SESSION_DIR";

/// Run as a separate process by the cross-process test: mounts, waits for `go`, then calls.
#[tokio::test]
async fn mcp_session_process_helper() {
    let Some(dir) = std::env::var_os(PROCESS_DIR).map(PathBuf::from) else {
        return;
    };
    let cwd = std::env::current_dir().unwrap();
    let outcome = load(&cwd).await;
    let Some(registry) = outcome.registry else {
        let reasons = outcome
            .skipped
            .iter()
            .map(|skipped| skipped.reason.clone())
            .collect::<Vec<_>>();
        fs::write(
            dir.join("result"),
            format!("skipped: {}", reasons.join("; ")),
        )
        .unwrap();
        return;
    };
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    fs::write(dir.join("mounted"), "").unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !dir.join("go").exists() && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let result = capture.call(json!({}), false).await;
    fs::write(dir.join("result"), result.content.to_string()).unwrap();
}

#[tokio::test]
async fn disconnect_reaches_sessions_in_other_processes_and_survives_restart() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-cross-process", "recorded", &server.url);
    let spawn = |dir: &Path| {
        fs::create_dir_all(dir).unwrap();
        std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "mcp::session_admission_tests::mcp_session_process_helper",
            ])
            .env(PROCESS_DIR, dir)
            .stdout(std::process::Stdio::null())
            .spawn()
            .unwrap()
    };

    let mounted = home.path.join("mounted-session");
    let mut session = spawn(&mounted);
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while !mounted.join("mounted").exists() && std::time::Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    McpRuntimeManager::new(home.path.clone())
        .disconnect("recorded")
        .await
        .unwrap();
    fs::write(mounted.join("go"), "").unwrap();
    assert!(session.wait().unwrap().success());
    assert!(fs::read_to_string(mounted.join("result"))
        .unwrap()
        .contains("was disconnected"));
    assert!(server.authorizations("tools/call").is_empty());

    let restarted = home.path.join("restarted-session");
    assert!(spawn(&restarted).wait().unwrap().success());
    let result = fs::read_to_string(restarted.join("result")).unwrap();
    assert!(
        result.starts_with("skipped:") && result.contains("disconnected"),
        "{result}"
    );
}

#[tokio::test]
async fn disconnect_holds_the_config_lease_until_admission_is_changed() {
    use fs2::FileExt;
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-disconnect-lease", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.unwrap();
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let config = home.path.join("config.toml");
    let runtime = McpRuntimeManager::new(home.path.clone());
    let (arrived, arrival) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let disconnect = std::thread::spawn(move || {
        lifecycle::CONNECTION_CHANGE_HOOK.with(|slot| {
            *slot.borrow_mut() = Some(Box::new(move || {
                arrived.send(()).unwrap();
                released.recv_timeout(Duration::from_secs(10)).unwrap();
            }));
        });
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(runtime.disconnect("recorded"))
    });
    arrival.recv_timeout(Duration::from_secs(10)).unwrap();
    let writer = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(config.with_extension("toml.lock"))
        .unwrap();
    let writer_blocked = writer.try_lock_exclusive().is_err();
    if !writer_blocked {
        FileExt::unlock(&writer).unwrap();
    }
    release.send(()).unwrap();
    assert!(disconnect.join().unwrap().unwrap().sessions_blocked);
    assert!(
        writer_blocked,
        "rename must not enter between config selection and admission mutation"
    );
    let _lease = acquire_mcp_configuration_write_lease(&config).unwrap();
    rename_config(&config, "recorded", "renamed");
    McpRuntimeManager::new(home.path.clone())
        .rename_connection("recorded", "renamed")
        .unwrap();
    drop(_lease);
    assert!(capture.call(json!({}), false).await.is_error);
    assert!(server.authorizations("tools/call").is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn a_failed_rename_preparation_does_not_publish_the_config() {
    use std::os::unix::fs::PermissionsExt;
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-rename-prepare-failure", "recorded", &server.url);
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    let config = home.path.join("config.toml");
    let _lease = acquire_mcp_configuration_write_lease(&config).unwrap();
    let (mut record, revision) =
        load_mcp_server_configuration_snapshot(&config, "recorded").unwrap();
    record.name = "renamed".into();
    let lock = home.path.join("mcp_disconnected.json.lock");
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o000)).unwrap();
    let failed = runtime.update_configuration_at_revision(&config, "recorded", record, revision);
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o600)).unwrap();
    assert!(failed.is_err());
    drop(_lease);
    assert!(load_mcp_server_configuration(&config, "recorded").is_ok());
    assert!(load_mcp_server_configuration(&config, "renamed").is_err());
    assert!(blocked(&runtime.statuses().await.unwrap(), "recorded"));
}

#[tokio::test]
async fn an_interrupted_config_rename_keeps_both_names_on_the_same_disconnect_state() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let server = RecordingMcpServer::start();
    let home = TestHome::new("nac-mcp-rename-interrupted", "recorded", &server.url);
    let cwd = std::env::current_dir().unwrap();
    let registry = load(&cwd).await.registry.unwrap();
    let capture = registry.capture_tool("mcp__recorded__echo").unwrap();
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    let state = admission::ConnectionState::for_home(&PathContext::new(&home.path)).unwrap();
    let config = home.path.join("config.toml");
    // A crash before config publication leaves the original name protected.
    state.prepare_rename("recorded", "renamed").unwrap();
    assert!(load(&cwd).await.registry.is_none());
    assert!(capture.call(json!({}), false).await.is_error);
    // A crash after publication but before alias cleanup protects the new name too.
    let _lease = acquire_mcp_configuration_write_lease(&config).unwrap();
    rename_config(&config, "recorded", "renamed");
    drop(_lease);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let lock = home.path.join("mcp_disconnected.json.lock");
        fs::set_permissions(&lock, fs::Permissions::from_mode(0o000)).unwrap();
        let cleanup = state.finish_rename("recorded", "renamed");
        fs::set_permissions(&lock, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(cleanup.is_err());
    }
    let restarted = McpRuntimeManager::new(home.path.clone());
    assert!(blocked(&restarted.statuses().await.unwrap(), "renamed"));
    assert!(load(&cwd).await.registry.is_none());
    assert!(capture.call(json!({}), false).await.is_error);
    restarted.connect("renamed").await.unwrap();
    assert!(!capture.call(json!({}), false).await.is_error);
    restarted.disconnect("renamed").await.unwrap();
    // Creating a server under the stale source alias must not re-admit old captures.
    let mut added = load_mcp_server_configuration(&config, "renamed").unwrap();
    added.name = "recorded".into();
    insert_mcp_server_configuration(&config, added).unwrap();
    restarted.claim_connection("recorded").unwrap();
    restarted.connect("recorded").await.unwrap();
    assert!(capture.call(json!({}), false).await.is_error);
    restarted.forget("recorded").await;
    restarted.forget("renamed").await;
}

#[tokio::test]
async fn a_rejected_rename_does_not_prepare_connection_aliases() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let home = TestHome::with_server("nac-mcp-rejected-alias", "recorded", "http://127.0.0.1:9/mcp",
        "[mcp_servers.other]\ntransport = \"streamable_http\"\nurl = \"http://127.0.0.1:9/other\"\n");
    let runtime = McpRuntimeManager::new(home.path.clone());
    runtime.disconnect("recorded").await.unwrap();
    let config = home.path.join("config.toml");
    let state = home.path.join("mcp_disconnected.json");
    let before = fs::read(&state).unwrap();
    let _lease = acquire_mcp_configuration_write_lease(&config).unwrap();
    let (mut record, revision) =
        load_mcp_server_configuration_snapshot(&config, "recorded").unwrap();
    record.name = "other".into();
    assert!(runtime
        .update_configuration_at_revision(&config, "recorded", record, revision)
        .is_err());
    assert_eq!(fs::read(&state).unwrap(), before);
}
