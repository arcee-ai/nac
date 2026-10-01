use super::test_support::{
    restore_env, shell_single_quote, start_auth_retry_http_mcp_server,
    start_capability_http_mcp_server, start_deadline_http_mcp_server, start_fake_http_mcp_server,
    start_protocol_http_mcp_server, toml_string, unique_temp_dir,
};
use super::*;
use crate::TEST_ENV_LOCK;
use serde_json::json;
use std::{collections::HashSet, fs};

const MANAGED_EXA_CANARY: &str = "managed-server-mcp-isolation-canary";

#[tokio::test]
async fn managed_native_credential_mcp_isolation_helper() {
    let Some(root) = env::var_os("NAC_MANAGED_MCP_ISOLATION_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    fs::create_dir_all(&root).unwrap();
    crate::worker_credentials::capture_managed_native_credentials_from_environment().unwrap();
    assert!(env::var_os(crate::model::EXA_API_KEY_ENV).is_none());
    assert_eq!(
        crate::worker_credentials::managed_exa_api_key().as_deref(),
        Some(MANAGED_EXA_CANARY)
    );

    let http_url = "http://127.0.0.1:9/arbitrary-mcp-endpoint";
    let argv_marker = root.join("stdio-argv-spawned");
    let env_marker = root.join("stdio-env-spawned");
    let argv_shell = format!("printf spawned > {}", shell_single_quote(&argv_marker));
    let env_shell = format!("printf spawned > {}", shell_single_quote(&env_marker));
    fs::write(
        root.join("config.toml"),
        format!(
            r#"
[mcp_servers.stdio_argv]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}, "${{EXA_API_KEY}}"]

[mcp_servers.stdio_env]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
env = {{ MCP_SECRET = "${{EXA_API_KEY}}" }}

[mcp_servers.http_header]
transport = "streamable_http"
url = {}
headers = {{ Authorization = "Bearer ${{EXA_API_KEY}}" }}
"#,
            toml_string(&argv_shell),
            toml_string(&env_shell),
            toml_string(&http_url),
        ),
    )
    .unwrap();
    unsafe { env::set_var("NAC_HOME", &root) };

    let outcome = McpRegistry::load_reporting_skips(
        &root,
        None,
        &PathContext::new(&root),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .unwrap();
    assert!(outcome.registry.is_none());
    assert_eq!(outcome.skipped.len(), 3);
    assert!(!argv_marker.exists());
    assert!(!env_marker.exists());
    assert!(outcome.skipped.iter().all(|skipped| skipped
        .reason
        .contains("environment variable 'EXA_API_KEY' is not set")));
    let rendered = outcome
        .skipped
        .iter()
        .map(|skipped| format!("{}: {}", skipped.name, skipped.reason))
        .collect::<Vec<_>>()
        .join("\n");
    assert!(!rendered.contains(MANAGED_EXA_CANARY));
    fs::write(root.join("load-observation"), rendered).unwrap();
}

#[test]
fn managed_server_snapshot_is_hidden_from_stdio_and_http_mcp() {
    let root = unique_temp_dir("nac-managed-mcp-isolation");
    let output = std::process::Command::new(env::current_exe().unwrap())
        .args([
            "--exact",
            "mcp::tests::managed_native_credential_mcp_isolation_helper",
            "--nocapture",
        ])
        .env("NAC_MANAGED_MCP_ISOLATION_ROOT", &root)
        .env(crate::model::EXA_API_KEY_ENV, MANAGED_EXA_CANARY)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "managed MCP isolation helper failed: stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains(MANAGED_EXA_CANARY));
    assert!(!String::from_utf8_lossy(&output.stderr).contains(MANAGED_EXA_CANARY));
    for entry in fs::read_dir(&root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_file() {
            assert!(!fs::read_to_string(path)
                .unwrap()
                .contains(MANAGED_EXA_CANARY));
        }
    }
    let _ = fs::remove_dir_all(root);
}

async fn load_registry(
    cwd: &Path,
    sandbox: Option<&SandboxSession>,
    paths: &PathContext,
    transport_policy: McpTransportPolicy,
    root_policy: McpRootPolicy,
) -> Option<Arc<McpRegistry>> {
    McpRegistry::load_reporting_skips(cwd, sandbox, paths, transport_policy, root_policy)
        .await
        .unwrap()
        .registry
}

#[test]
fn sanitize_identifier_collapses_symbols() {
    assert_eq!(sanitize_identifier("GitHub.com"), "github_com");
    assert_eq!(sanitize_identifier("search/issues"), "search_issues");
}

#[test]
fn env_expansion_replaces_placeholders() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original = env::var("NAC_MCP_TEST").ok();
    unsafe {
        env::set_var("NAC_MCP_TEST", "expanded");
    }

    let expanded = expand_env("Bearer ${NAC_MCP_TEST}").unwrap();
    assert_eq!(expanded, "Bearer expanded");

    if let Some(value) = original {
        unsafe {
            env::set_var("NAC_MCP_TEST", value);
        }
    } else {
        unsafe {
            env::remove_var("NAC_MCP_TEST");
        }
    }
}

#[test]
fn authorization_challenges_are_classified_without_rendering_credentials() {
    let error = rmcp::transport::streamable_http_client::AuthRequiredError::new(
        "Bearer realm=\"mcp\"".to_string(),
    );
    assert!(authorization_required(&error));
    let wrapped = anyhow!(error).context("MCP connection failed");
    assert!(mcp_error_requires_authorization(&wrapped));
}

#[test]
fn allocate_tool_name_suffixes_collisions() {
    let mut seen = HashMap::new();
    assert_eq!(
        allocate_tool_name("github", "search/issues", &mut seen),
        "mcp__github__search_issues"
    );
    assert_eq!(
        allocate_tool_name("github", "search-issues", &mut seen),
        "mcp__github__search_issues__2"
    );
}

#[test]
fn tool_definition_uses_namespaced_name() {
    let tool = Tool::new(
        "search_issues",
        "Search issues",
        serde_json::Map::<String, Value>::new(),
    );
    let definition = tool_definition("mcp__github__search_issues", "github", &tool);
    assert_eq!(definition.function.name, "mcp__github__search_issues");
    assert_eq!(definition.function.description, "Search issues");
}

#[tokio::test]
async fn invalid_global_config_disables_mcp_instead_of_failing() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-test");
    fs::create_dir_all(&nac_home).unwrap();
    fs::write(nac_home.join("config.toml"), "=\n").unwrap();

    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let outcome = McpRegistry::load_reporting_skips(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::Workspace,
    )
    .await
    .unwrap();
    assert!(outcome.registry.is_none());
    assert_eq!(outcome.skipped.len(), 1);
    assert_eq!(
        outcome.skipped[0].name,
        nac_home.join("config.toml").display().to_string()
    );
    assert!(
        outcome.skipped[0].reason.starts_with("invalid config:"),
        "unexpected reason: {}",
        outcome.skipped[0].reason
    );

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn http_only_policy_skips_stdio_without_spawning() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-stdio-skip");
    fs::create_dir_all(&nac_home).unwrap();
    let marker = nac_home.join("stdio-spawned");
    let shell = format!("printf spawned > {}", shell_single_quote(&marker));
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
            toml_string(&shell)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let registry = load_registry(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::StreamableHttpOnly,
        McpRootPolicy::None,
    )
    .await;
    assert!(registry.is_none());
    assert!(
        !marker.exists(),
        "stdio MCP server was spawned despite HTTP-only policy"
    );

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn load_reports_connect_failed_server() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-connect-fail");
    fs::create_dir_all(&nac_home).unwrap();
    fs::write(
        nac_home.join("config.toml"),
        r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", "true"]
"#,
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let outcome = McpRegistry::load_reporting_skips(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .unwrap();
    assert!(outcome.registry.is_none());
    assert_eq!(outcome.skipped.len(), 1);
    assert_eq!(outcome.skipped[0].name, "local");
    assert!(
        outcome.skipped[0]
            .reason
            .contains("failed to connect stdio MCP server 'local'"),
        "unexpected reason: {}",
        outcome.skipped[0].reason
    );

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn required_server_failure_rejects_registry_admission() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-required-fail");
    fs::create_dir_all(&nac_home).unwrap();
    fs::write(
        nac_home.join("config.toml"),
        r#"
[mcp_servers.required_local]
required = true
startup_timeout_ms = 500
transport = "stdio"
command = "/bin/sh"
args = ["-c", "true"]
"#,
    )
    .unwrap();
    unsafe { env::set_var("NAC_HOME", &nac_home) };

    let cwd = std::env::current_dir().unwrap();
    let error = McpRegistry::load_reporting_skips(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .err()
    .expect("required server failure must reject admission");
    assert!(format!("{error:#}").contains("required MCP server 'required_local'"));

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[cfg(unix)]
#[tokio::test]
async fn required_server_failure_closes_already_mounted_servers() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-required-fail-cleanup");
    fs::create_dir_all(&nac_home).unwrap();
    let script = nac_home.join("mounted-mcp.sh");
    let pid_file = nac_home.join("mounted.pid");
    fs::write(
        &script,
        r#"#!/bin/sh
printf '%s' "$$" > "$MCP_PID_FILE"
while IFS= read -r line; do
  id=$(printf '%s\n' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"cleanup-test","version":"0.1.0"}}}\n' "$id"
      ;;
    *'"method":"tools/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"test","inputSchema":{"type":"object","properties":{}}}]}}\n' "$id"
      ;;
  esac
done
"#,
    )
    .unwrap();
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.a_connected]
transport = "stdio"
command = "/bin/sh"
args = [{}]
env = {{ MCP_PID_FILE = {} }}

[mcp_servers.z_required]
required = true
startup_timeout_ms = 500
transport = "stdio"
command = "/bin/sh"
args = ["-c", "true"]
"#,
            toml_string(&script.display().to_string()),
            toml_string(&pid_file.display().to_string()),
        ),
    )
    .unwrap();
    unsafe { env::set_var("NAC_HOME", &nac_home) };

    let error = McpRegistry::load_reporting_skips(
        &nac_home,
        None,
        &PathContext::new(&nac_home),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .err()
    .expect("required server failure must reject admission");
    assert!(format!("{error:#}").contains("required MCP server 'z_required'"));

    let pid = fs::read_to_string(&pid_file)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline && unsafe { libc::kill(pid, 0) } == 0 {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "required failure left an already mounted MCP child running"
    );

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn header_helper_forwards_env_and_parses_bounded_json() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original = env::var_os("NAC_MCP_HELPER_TOKEN");
    unsafe { env::set_var("NAC_MCP_HELPER_TOKEN", "helper-secret") };
    let helper = McpHeaderHelperConfig {
        command: "/bin/sh".to_string(),
        args: vec![
            "-c".to_string(),
            "printf '{\"Authorization\":\"Bearer %s\"}' \"$NAC_MCP_HELPER_TOKEN\"".to_string(),
        ],
        env_vars: vec!["NAC_MCP_HELPER_TOKEN".to_string()],
        timeout_ms: Some(1_000),
        ..McpHeaderHelperConfig::default()
    };
    let headers = run_header_helper(&helper, Path::new("/tmp")).await.unwrap();
    assert_eq!(
        headers.get("Authorization").map(String::as_str),
        Some("Bearer helper-secret")
    );
    restore_env("NAC_MCP_HELPER_TOKEN", original);
}

fn protocol_http_config(url: String, protocol: McpProtocolSelection) -> McpServerConfig {
    McpServerConfig {
        enabled: true,
        library_id: None,
        required: false,
        startup_timeout_ms: None,
        catalog_timeout_ms: None,
        execution_timeout_ms: None,
        protocol,
        allowed_tools: None,
        denied_tools: Vec::new(),
        approval: McpToolApproval::Ask,
        tool_approvals: BTreeMap::new(),
        transport: McpTransportConfig::StreamableHttp {
            url,
            headers: BTreeMap::new(),
            env_headers: BTreeMap::new(),
            bearer_token_env_var: None,
            header_helper: None,
        },
    }
}

#[tokio::test]
async fn current_protocol_discovers_without_initialize_and_sends_request_metadata() {
    let (url, server, observed) = start_protocol_http_mcp_server(true);
    let config = protocol_http_config(url, McpProtocolSelection::Current);
    let handler = NacMcpClientHandler::unbound(Vec::new());
    let mut service = connect_server(
        "current",
        &config,
        &handler,
        Path::new("/tmp"),
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    service.list_all_tools().await.unwrap();
    close_mcp_service(&mut service).await;
    server.join().unwrap();

    let observed = observed.lock().unwrap();
    let methods = observed
        .iter()
        .map(|request| request["method"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(methods, ["server/discover", "tools/list"]);
    for request in observed.iter() {
        assert_eq!(
            request["headers"]["mcp-protocol-version"],
            ProtocolVersion::V_2026_07_28.as_str()
        );
        assert_eq!(request["headers"]["mcp-method"], request["method"]);
        assert_eq!(
            request["params"]["_meta"]["io.modelcontextprotocol/protocolVersion"],
            ProtocolVersion::V_2026_07_28.as_str()
        );
        assert!(request["params"]["_meta"]
            .get("io.modelcontextprotocol/clientCapabilities")
            .is_some());
    }
}

#[tokio::test]
async fn auto_protocol_falls_back_to_the_pinned_legacy_lifecycle() {
    let (url, server, observed) = start_protocol_http_mcp_server(false);
    let config = protocol_http_config(url, McpProtocolSelection::Auto);
    let handler = NacMcpClientHandler::unbound(Vec::new());
    let mut service = connect_server(
        "auto",
        &config,
        &handler,
        Path::new("/tmp"),
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    service.list_all_tools().await.unwrap();
    close_mcp_service(&mut service).await;
    server.join().unwrap();

    let methods = observed
        .lock()
        .unwrap()
        .iter()
        .map(|request| request["method"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert_eq!(
        methods,
        [
            "server/discover",
            "initialize",
            "notifications/initialized",
            "tools/list"
        ]
    );
}

#[tokio::test]
async fn current_protocol_honors_server_cache_hints() {
    let (url, server, observed) = start_protocol_http_mcp_server(true);
    let config = protocol_http_config(url, McpProtocolSelection::Current);
    let handler = NacMcpClientHandler::unbound(Vec::new());
    let mut service = connect_server(
        "current-cache",
        &config,
        &handler,
        Path::new("/tmp"),
        Duration::from_secs(2),
    )
    .await
    .unwrap();
    service.list_all_tools().await.unwrap();
    service.list_all_tools().await.unwrap();
    close_mcp_service(&mut service).await;
    server.join().unwrap();

    let tools_list_requests = observed
        .lock()
        .unwrap()
        .iter()
        .filter(|request| request["method"] == "tools/list")
        .count();
    assert_eq!(tools_list_requests, 1);
}

#[tokio::test]
async fn refreshed_auth_handshake_gets_a_fresh_startup_budget() {
    let (url, server) = start_auth_retry_http_mcp_server();
    let helper = McpHeaderHelperConfig {
        command: "/bin/sh".to_string(),
        args: vec![
            "-c".to_string(),
            "sleep 0.15; printf '{\"Authorization\":\"Bearer refreshed\"}'".to_string(),
        ],
        timeout_ms: Some(1_000),
        ..McpHeaderHelperConfig::default()
    };
    let config = McpServerConfig {
        enabled: true,
        library_id: None,
        required: false,
        startup_timeout_ms: Some(500),
        catalog_timeout_ms: None,
        execution_timeout_ms: None,
        protocol: McpProtocolSelection::Legacy,
        allowed_tools: None,
        denied_tools: Vec::new(),
        approval: McpToolApproval::Ask,
        tool_approvals: BTreeMap::new(),
        transport: McpTransportConfig::StreamableHttp {
            url,
            headers: BTreeMap::new(),
            env_headers: BTreeMap::new(),
            bearer_token_env_var: None,
            header_helper: Some(helper),
        },
    };
    let handler = NacMcpClientHandler::unbound(Vec::new());
    let started = std::time::Instant::now();

    let mut service = connect_server(
        "auth-retry",
        &config,
        &handler,
        Path::new("/tmp"),
        Duration::from_millis(500),
    )
    .await
    .unwrap();

    assert!(
        started.elapsed() > Duration::from_millis(500),
        "the test must exceed one startup budget to cover the old outer timeout"
    );
    close_mcp_service(&mut service).await;
    server.join().unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn stdio_startup_timeout_reaps_uninitialized_child() {
    let root = unique_temp_dir("nac-mcp-stdio-startup-timeout");
    fs::create_dir_all(&root).unwrap();
    let script = root.join("hung-mcp.sh");
    let pid_file = root.join("server.pid");
    fs::write(
        &script,
        r#"#!/bin/sh
printf '%s' "$$" > "$MCP_PID_FILE"
while :; do
  sleep 1
done
"#,
    )
    .unwrap();
    let config = McpServerConfig {
        enabled: true,
        library_id: None,
        required: false,
        startup_timeout_ms: Some(300),
        catalog_timeout_ms: None,
        execution_timeout_ms: None,
        protocol: McpProtocolSelection::Legacy,
        allowed_tools: None,
        denied_tools: Vec::new(),
        approval: McpToolApproval::Ask,
        tool_approvals: BTreeMap::new(),
        transport: McpTransportConfig::Stdio {
            command: "/bin/sh".to_string(),
            args: vec![script.display().to_string()],
            env: BTreeMap::from([("MCP_PID_FILE".to_string(), pid_file.display().to_string())]),
            env_vars: Vec::new(),
            cwd: None,
        },
    };
    let handler = NacMcpClientHandler::unbound(Vec::new());

    let error = match connect_server(
        "hung-stdio",
        &config,
        &handler,
        &root,
        Duration::from_millis(300),
    )
    .await
    {
        Ok(mut service) => {
            close_mcp_service(&mut service).await;
            panic!("hung stdio server unexpectedly initialized");
        }
        Err(error) => error,
    };
    assert!(error.to_string().contains("timed out connecting stdio"));

    let pid = fs::read_to_string(&pid_file)
        .unwrap()
        .parse::<libc::pid_t>()
        .unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline && unsafe { libc::kill(pid, 0) } == 0 {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_ne!(
        unsafe { libc::kill(pid, 0) },
        0,
        "startup timeout left the uninitialized stdio MCP child running"
    );

    let _ = fs::remove_dir_all(root);
}

#[tokio::test]
async fn stdio_server_runs_on_host_when_sandboxed() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-sandbox-stdio");
    fs::create_dir_all(&nac_home).unwrap();
    let marker = nac_home.join("stdio-spawned");
    let shell = format!("printf spawned > {}", shell_single_quote(&marker));
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]
"#,
            toml_string(&shell)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let sandbox = crate::sandbox::SandboxSession::new_for_test(crate::sandbox::SandboxSpec {
        backend: crate::sandbox::SandboxBackendType::Podman,
        image: crate::sandbox::DEFAULT_SANDBOX_IMAGE.to_string(),
        mounts: vec![crate::sandbox::MountSpec {
            host: nac_home.clone(),
            guest: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
            read_only: false,
        }],
        workdir: std::path::PathBuf::from(crate::sandbox::DEFAULT_SANDBOX_WORKDIR),
        worktree: None,
        gpu_devices: Vec::new(),
        shm_size: Some("0".to_string()),
        cpus: 2,
        memory_mib: 2048,
    });

    let registry = load_registry(
        &nac_home,
        Some(&sandbox),
        &PathContext::new(&nac_home),
        McpTransportPolicy::All,
        McpRootPolicy::Workspace,
    )
    .await;
    // The fake stdio server is not a real MCP server, so it is skipped once
    // the connection fails. The assertion that matters is that it was
    // launched on the host (marker written at an absolute host path) rather
    // than via `podman exec` inside the sandbox.
    assert!(registry.is_none());
    assert!(
        marker.exists(),
        "stdio MCP server was not launched on the host in sandbox mode"
    );

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn per_call_deadline_strips_envelope_and_leaves_http_mcp_usable() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-call-deadline");
    fs::create_dir_all(&nac_home).unwrap();
    let (http_url, http_server, observed) = start_deadline_http_mcp_server();
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.hung]
transport = "streamable_http"
url = {}
approval = "allow"
"#,
            toml_string(&http_url)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let outcome = McpRegistry::load_reporting_skips(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .expect("deadline MCP server should load");
    assert_eq!(outcome.skipped.len(), 3);
    assert!(outcome.skipped.iter().any(|skipped| {
        skipped.name == "mcp__hung__reserved_collision"
            && skipped.reason.contains("reserved property '_nac'")
    }));
    assert!(outcome.skipped.iter().any(|skipped| {
        skipped.name == "mcp__hung__reserved_exact_collision"
            && skipped.reason.contains("reserved property '_nac'")
    }));
    assert!(outcome.skipped.iter().any(|skipped| {
        skipped.name == "mcp__hung__non_object" && skipped.reason.contains("type 'object'")
    }));
    let registry = outcome
        .registry
        .expect("valid MCP capability should remain mounted");
    let mut runtime = crate::tools::test_runtime();
    runtime.mcp = Some(Arc::clone(&registry));
    let advertised = runtime.model_tool_definitions(&[], &[]);
    runtime.allowed_tools = Some(Arc::new(
        advertised
            .iter()
            .map(|definition| definition.function.name.clone())
            .collect::<HashSet<_>>(),
    ));
    let server = Arc::clone(registry.servers.get("hung").expect("mounted server"));
    registry.sync.replace_tools(&server, Vec::new());
    assert!(registry.capture_tool("mcp__hung__echo").is_none());
    assert!(runtime.mcp_tools.contains_key("mcp__hung__echo"));
    let client = crate::model::ModelClient::new_for_test();
    let timed_out = crate::tools::execute_tool(
        "mcp__hung__echo",
        json!({"message":"first","_nac":{"timeout_ms":20}}),
        &runtime,
        &client,
    )
    .await;
    assert!(timed_out.is_error);
    let timed_out_text = timed_out.content.as_text().unwrap();
    let timed_out: Value = serde_json::from_str(timed_out_text)
        .unwrap_or_else(|error| panic!("invalid timeout payload {timed_out_text:?}: {error}"));
    assert_eq!(timed_out["_nac"]["status"], "timed_out");
    assert_eq!(timed_out["_nac"]["remote_outcome_uncertain"], true);

    tokio::time::sleep(Duration::from_millis(300)).await;
    let recovered = crate::tools::execute_tool(
        "mcp__hung__echo",
        json!({"message":"second","_nac":{"timeout_ms":1000}}),
        &runtime,
        &client,
    )
    .await;
    assert!(!recovered.is_error, "{}", recovered.content);
    assert!(recovered.content.contains("echoed"));
    let observed = observed.lock().unwrap();
    assert_eq!(
        observed.as_slice(),
        &[json!({"message":"first"}), json!({"message":"second"})]
    );

    http_server.join().unwrap();
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn capability_only_server_mounts_resources_prompts_and_completion() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-capabilities");
    fs::create_dir_all(&nac_home).unwrap();
    let (http_url, _http_server) = start_capability_http_mcp_server();
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.docs]
transport = "streamable_http"
url = {}
headers = {{ Authorization = "Bearer registry-secret" }}
"#,
            toml_string(&http_url)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let outcome = McpRegistry::load_reporting_skips(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .expect("capability-only MCP server should load");
    assert!(outcome.skipped.is_empty());
    let registry = outcome.registry.expect("capability server remains mounted");
    assert!(registry.tool_definitions().is_empty());
    assert_eq!(registry.model_tool_definitions().len(), 6);
    let instructions = registry.instructions_message().unwrap();
    assert!(instructions.contains("server=\"docs\""));
    assert!(instructions.contains("Use [REDACTED] only"));
    assert!(!instructions.contains("registry-secret"));
    assert_eq!(
        registry.prompt_commands()[0].command_name,
        "mcp__docs__review"
    );

    let resources = registry
        .call_capability(capabilities::LIST_RESOURCES_TOOL, json!({"server": "docs"}))
        .await;
    let resources = resources.content.to_string();
    assert!(!resources.contains("sessionId"));
    assert!(resources.contains("resource-page-2"));
    assert!(resources.contains("doc://guide"));

    let templates = registry
        .call_capability(
            capabilities::LIST_RESOURCE_TEMPLATES_TOOL,
            json!({"server": "docs"}),
        )
        .await;
    assert!(templates.content.to_string().contains("template-page-2"));

    let resource = registry
        .call_capability(
            capabilities::READ_RESOURCE_TOOL,
            json!({"server": "docs", "uri": "doc://guide"}),
        )
        .await;
    assert!(!resource.is_error);
    assert!(resource.content.to_string().contains("remote text"));
    assert!(!resource.content.to_string().contains("sessionId"));

    let prompt = registry
        .resolve_prompt_invocation(McpPromptInvocation {
            raw_prompt: "/mcp__docs__review {\"tone\":\"strict\"}".to_string(),
            command_name: "mcp__docs__review".to_string(),
            arguments: serde_json::from_value(json!({"tone": "strict"})).unwrap(),
        })
        .await
        .expect("prompt resolves");
    assert!(prompt.agent_prompt.contains("untrusted_remote_prompt_data"));
    assert!(!prompt.agent_prompt.contains("sessionId"));

    let completion = registry
        .call_capability(
            capabilities::COMPLETE_PROMPT_ARGUMENT_TOOL,
            json!({
                "server": "docs",
                "name": "review",
                "argument": "tone",
                "value": "str"
            }),
        )
        .await;
    assert!(!completion.is_error);
    assert!(completion.content.to_string().contains("strict"));

    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn http_only_policy_loads_streamable_http_tools_and_skips_stdio() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-http-only");
    fs::create_dir_all(&nac_home).unwrap();
    let marker = nac_home.join("stdio-spawned");
    let shell = format!("printf spawned > {}", shell_single_quote(&marker));
    let (http_url, http_server) = start_fake_http_mcp_server();
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.local]
transport = "stdio"
command = "/bin/sh"
args = ["-c", {}]

[mcp_servers.http]
transport = "streamable_http"
url = {}
"#,
            toml_string(&shell),
            toml_string(&http_url)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let registry = load_registry(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::StreamableHttpOnly,
        McpRootPolicy::None,
    )
    .await
    .expect("HTTP MCP server should load");
    let definitions = registry.tool_definitions();
    assert_eq!(definitions.len(), 1);
    assert_eq!(definitions[0].function.name, "mcp__http__echo");
    assert_eq!(
        definitions[0].function.description,
        "Echo from fake HTTP MCP"
    );
    assert_eq!(
        definitions[0].function.parameters["properties"]["_nac"]["properties"]["timeout_ms"]
            ["maximum"],
        3_600_000
    );
    assert!(
        !marker.exists(),
        "stdio MCP server was spawned despite HTTP-only policy"
    );

    drop(registry);
    http_server.join().unwrap();
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn http_only_policy_ignores_malformed_non_http_entries_before_deserialize() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-http-only-malformed-skip");
    fs::create_dir_all(&nac_home).unwrap();
    let (http_url, http_server) = start_fake_http_mcp_server();
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.bad_stdio]
transport = "stdio"
args = ["missing-command-field"]

[mcp_servers.unsupported]
transport = "sse"
url = "https://example.test/sse"

[mcp_servers.http]
transport = "streamable_http"
url = {}
"#,
            toml_string(&http_url)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let strict_registry = load_registry(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await;
    assert!(
        strict_registry.is_none(),
        "All policy should preserve whole-file typed deserialization behavior"
    );

    let registry = load_registry(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::StreamableHttpOnly,
        McpRootPolicy::None,
    )
    .await
    .expect("HTTP-only policy should load valid HTTP server despite malformed non-HTTP entries");
    let definitions = registry.tool_definitions();
    assert_eq!(definitions.len(), 1);
    assert_eq!(definitions[0].function.name, "mcp__http__echo");

    drop(registry);
    http_server.join().unwrap();
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn dashboard_saved_server_loads_from_the_file() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-dashboard-save");
    fs::create_dir_all(&nac_home).unwrap();
    let (http_url, http_server) = start_fake_http_mcp_server();
    insert_mcp_server_configuration(
        &nac_home.join("config.toml"),
        McpServerConfigurationRecord {
            name: "saved".to_string(),
            enabled: true,
            transport: MCP_TRANSPORT_STREAMABLE_HTTP.to_string(),
            command: None,
            args: Vec::new(),
            env: std::collections::BTreeMap::new(),
            url: Some(http_url),
            headers: std::collections::BTreeMap::new(),
            library_id: Some("saved".to_string()),
            ..McpServerConfigurationRecord::default()
        },
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let registry = load_registry(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .expect("saved HTTP server should load");
    let definitions = registry.tool_definitions();
    assert_eq!(definitions.len(), 1);
    assert_eq!(definitions[0].function.name, "mcp__saved__echo");
    let unsupported = registry
        .call_capability(
            capabilities::LIST_RESOURCES_TOOL,
            json!({"server": "saved"}),
        )
        .await;
    assert!(unsupported.is_error);
    assert!(unsupported
        .content
        .to_string()
        .contains("does not advertise resources support"));
    let catalog = registry.tool_catalog();
    assert_eq!(catalog[0].1.title.as_deref(), Some("Echo"));
    assert_eq!(
        catalog[0].1.output_schema.as_ref().unwrap()["type"],
        "object"
    );
    assert_eq!(
        catalog[0].1.annotations.as_ref().unwrap()["readOnlyHint"],
        true
    );
    assert_eq!(
        catalog[0].1.icons.as_ref().unwrap()[0]["mimeType"],
        "image/png"
    );
    assert_eq!(catalog[0].1.meta.as_ref().unwrap()["vendor"], "fake");

    drop(registry);
    http_server.join().unwrap();
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}

#[tokio::test]
async fn servers_sharing_an_endpoint_connect_once() {
    let _guard = TEST_ENV_LOCK.lock().unwrap();
    let original_nac_home = env::var_os("NAC_HOME");
    let original_xdg = env::var_os("XDG_CONFIG_HOME");
    let nac_home = unique_temp_dir("nac-mcp-endpoint-dedup");
    fs::create_dir_all(&nac_home).unwrap();
    let (http_url, http_server) = start_fake_http_mcp_server();
    fs::write(
        nac_home.join("config.toml"),
        format!(
            r#"
[mcp_servers.exa]
transport = "streamable_http"
url = {url}

[mcp_servers.exa_web_search]
transport = "streamable_http"
url = {url}
"#,
            url = toml_string(&http_url)
        ),
    )
    .unwrap();
    unsafe {
        env::set_var("NAC_HOME", &nac_home);
    }

    let cwd = std::env::current_dir().unwrap();
    let registry = load_registry(
        &cwd,
        None,
        &PathContext::new(&cwd),
        McpTransportPolicy::All,
        McpRootPolicy::None,
    )
    .await
    .expect("the endpoint's tools should load once");
    let definitions = registry.tool_definitions();
    assert_eq!(definitions.len(), 1);
    assert_eq!(definitions[0].function.name, "mcp__exa__echo");

    drop(registry);
    http_server.join().unwrap();
    restore_env("NAC_HOME", original_nac_home);
    restore_env("XDG_CONFIG_HOME", original_xdg);
    let _ = fs::remove_dir_all(&nac_home);
}
