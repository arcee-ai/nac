use super::*;
use std::{collections::BTreeMap, io::Read};

use crate::application::{request_validation::RequestConfigurationError, Field};
use crate::delivery::server::{
    asset_cache_control, bare_host, host_is_allowed, is_non_rebindable_host,
    response_compression_layer, serve_listener_with_shutdown, ALLOWED_HOSTS_ENV, ASSETS,
};

use axum::{
    body::{to_bytes, Body, Bytes},
    http::Request,
};
use flate2::read::GzDecoder;
use nac_core::light_model::LightModelSettings;
use nac_core::model::{BackendKind, ModelConfigurationError, ReasoningEffort};
use nac_core::model_configurations;
use nac_core::projects::ProjectRecord;
use nac_core::runtime::OptionalModelOption;
use nac_core::store::{GoalStatus, InboxDelivery};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tower::ServiceExt;

static SERVER_MODEL_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

async fn point_session_at_hanging_endpoint(
    root: &std::path::Path,
    session_id: &str,
) -> tokio::task::JoinHandle<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let mut snapshot = sessions::load_session(&root.join("store.db"), session_id).unwrap();
    snapshot.base_url = format!("http://{address}/v1");
    sessions::update_session_config(&root.join("store.db"), &snapshot).unwrap();

    tokio::spawn(async move {
        if let Ok((socket, _)) = listener.accept().await {
            let _socket = socket;
            std::future::pending::<()>().await;
        }
    })
}

async fn post_json(app: Router, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}

async fn put_json(app: Router, uri: &str, body: serde_json::Value) -> Response {
    app.oneshot(
        Request::builder()
            .method("PUT")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
}
struct ScopedModelEnv {
    original: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl ScopedModelEnv {
    fn isolated(nac_home: &std::path::Path, openai_api_key: Option<&str>) -> Self {
        Self::with_config_home(Some(nac_home), None, None, openai_api_key)
    }

    fn with_config_home(
        nac_home: Option<&std::path::Path>,
        xdg_config_home: Option<&std::path::Path>,
        home: Option<&std::path::Path>,
        openai_api_key: Option<&str>,
    ) -> Self {
        let names = [
            "NAC_HOME",
            "XDG_CONFIG_HOME",
            "HOME",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "DEEPSEEK_API_KEY",
            "FIREWORKS_API_KEY",
            "TOGETHER_API_KEY",
            "ARCEE_API_KEY",
            "OPENAI_BASE_URL",
            "SECOND_API_KEY",
            ALLOWED_HOSTS_ENV,
        ];
        let original = names
            .into_iter()
            .map(|name| (name, std::env::var_os(name)))
            .collect();
        unsafe {
            for (name, value) in [
                ("NAC_HOME", nac_home),
                ("XDG_CONFIG_HOME", xdg_config_home),
                ("HOME", home),
            ] {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
            match openai_api_key {
                Some(value) => std::env::set_var("OPENAI_API_KEY", value),
                None => std::env::remove_var("OPENAI_API_KEY"),
            }
            std::env::remove_var("ANTHROPIC_API_KEY");
            // The remaining conventional credential vars stay cleared so
            // conventional-var auto-selection never leaks machine state
            // into a test.
            std::env::remove_var("DEEPSEEK_API_KEY");
            std::env::remove_var("FIREWORKS_API_KEY");
            std::env::remove_var("TOGETHER_API_KEY");
            std::env::remove_var("ARCEE_API_KEY");
            std::env::remove_var("OPENAI_BASE_URL");
            std::env::remove_var("SECOND_API_KEY");
            std::env::remove_var(ALLOWED_HOSTS_ENV);
        }
        Self { original }
    }
}

impl Drop for ScopedModelEnv {
    fn drop(&mut self) {
        for (name, value) in self.original.drain(..) {
            unsafe {
                match value {
                    Some(value) => std::env::set_var(name, value),
                    None => std::env::remove_var(name),
                }
            }
        }
    }
}

fn write_managed_credential(path: &std::path::Path, contents: impl AsRef<[u8]>) {
    std::fs::write(path, contents).expect("write managed credential");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .expect("set managed credential permissions");
    }
}

fn write_codex_auth(nac_home: &std::path::Path) {
    std::fs::create_dir_all(nac_home).expect("create NAC home");
    write_managed_credential(
        &nac_home.join("auth.json"),
        serde_json::json!({
            "type": "chatgpt-codex",
            "access": "codex-server-access",
            "refresh": "codex-server-refresh",
            "expires_at_ms": u64::MAX,
            "account_id": "codex-server-account"
        })
        .to_string(),
    );
}

fn write_arcee_auth(nac_home: &std::path::Path, base_url: &str) {
    std::fs::create_dir_all(nac_home).expect("create NAC home");
    write_managed_credential(
        &nac_home.join("arcee_auth.json"),
        serde_json::json!({
            "type": "arcee_device_token",
            "access_token": "arcee-access-server-test",
            "refresh_token": "arcee-refresh-server-test",
            "token_type": "bearer",
            "expires_at_ms": u64::MAX,
            "base_url": base_url,
            "organization_id": "org-server-test",
            "workspace_name": "server-test"
        })
        .to_string(),
    );
}

fn temp_root(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("nac_server_test_{}_{}", label, unique));
    std::fs::create_dir_all(&root).expect("create temp root");
    root
}

#[test]
fn managed_monitor_peer_lease_process_helper() {
    let Some(store_path) = std::env::var_os("NAC_TEST_MANAGED_PEER_STORE") else {
        return;
    };
    let session_id = std::env::var("NAC_TEST_MANAGED_PEER_SESSION").unwrap();
    let ready_path = PathBuf::from(std::env::var_os("NAC_TEST_MANAGED_PEER_READY").unwrap());
    let _lease = sessions::SessionOperationLease::try_acquire(
        std::path::Path::new(&store_path),
        &session_id,
    )
    .unwrap();
    std::fs::write(ready_path, b"ready").unwrap();
    std::thread::sleep(Duration::from_secs(30));
}

fn test_manager(root: &std::path::Path) -> SessionManager {
    SessionManager::new(ServerOptions {
        root_cwd: root.to_path_buf(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .expect("session manager")
}

fn test_managed_manager(root: &std::path::Path) -> SessionManager {
    let state_root = root.join("managed-state");
    let repository_root = root.join("repositories");
    let home_root = root.join("managed-home");
    for path in [&state_root, &repository_root, &home_root] {
        std::fs::create_dir_all(path).unwrap();
    }
    let managed_host = nac_managed::ManagedHostConfig {
        version: nac_managed::MANAGED_CONFIG_VERSION,
        logical_host_id: "test-host".to_string(),
        owner: Some("owner@example.test".to_string()),
        public_hostname: "nac.example.test".to_string(),
        repository_root,
        state_root,
        home_root,
        github_client_id: "Iv1.test".to_string(),
        model_backend: "arcee-api".to_string(),
        model_id: "trinity-large-thinking".to_string(),
        model_endpoint: "https://api.arcee.ai/api/v1".to_string(),
        model_credential_file: root.join("model-token"),
        model_credential_source: nac_managed::ManagedModelCredentialSource::MountedApiKey,
        model_credential_environment_names: vec!["ARCEE_API_KEY".to_string()],
    };
    managed_host.validate().unwrap();
    SessionManager::new(ServerOptions {
        root_cwd: root.to_path_buf(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: Some(managed_host),
    })
    .expect("managed session manager")
}

fn test_managed_bootstrap_manager(root: &std::path::Path) -> SessionManager {
    let state_root = root.join("nac-home");
    let repository_root = root.join("repositories");
    let home_root = root.join("managed-home");
    for path in [&state_root, &repository_root, &home_root] {
        std::fs::create_dir_all(path).unwrap();
    }
    let managed_host = nac_managed::ManagedHostConfig {
        version: nac_managed::MANAGED_CONFIG_VERSION,
        logical_host_id: "21856443-8ed8-40ab-9036-72e837c99f27".to_string(),
        owner: Some("owner@example.test".to_string()),
        public_hostname: "nac.example.test".to_string(),
        repository_root,
        state_root,
        home_root,
        github_client_id: "Iv1.test".to_string(),
        model_backend: "arcee-auth".to_string(),
        model_id: "trinity-large-thinking".to_string(),
        model_endpoint: "https://api.arcee.ai".to_string(),
        model_credential_file: PathBuf::from(nac_core::model::MANAGED_ARCEE_BOOTSTRAP_PATH),
        model_credential_source: nac_managed::ManagedModelCredentialSource::ManagedBootstrap,
        model_credential_environment_names: Vec::new(),
    };
    managed_host.validate().unwrap();
    SessionManager::new(ServerOptions {
        root_cwd: root.to_path_buf(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: Some(managed_host),
    })
    .expect("managed bootstrap session manager")
}

fn poison_operation_lease_directory(root: &std::path::Path) -> PathBuf {
    let lock_dir = root.join("store.db.run-locks");
    std::fs::write(&lock_dir, b"not a directory").expect("poison operation lease directory");
    lock_dir
}

async fn get_response(app: Router, uri: &str, accept_encoding: Option<&str>) -> Response {
    let mut request = Request::builder().uri(uri);
    if let Some(accept_encoding) = accept_encoding {
        request = request.header(header::ACCEPT_ENCODING, accept_encoding);
    }
    app.oneshot(request.body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn response_body(response: Response) -> Bytes {
    to_bytes(response.into_body(), usize::MAX).await.unwrap()
}

#[tokio::test]
async fn health_reports_store_readiness_and_recovers_without_path_leakage() {
    let root = temp_root("health_store_readiness");
    let store_path = root.join("store.db");
    nac_core::store::initialize(&store_path).unwrap();
    let app = router(test_manager(&root));

    let healthy = get_response(app.clone(), "/health", None).await;
    assert_eq!(healthy.status(), StatusCode::OK);
    assert_eq!(
        response_body(healthy).await,
        Bytes::from_static(br#"{"status":"ok"}"#)
    );

    std::fs::remove_file(&store_path).unwrap();
    let unavailable = get_response(app.clone(), "/health", None).await;
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = response_body(unavailable).await;
    assert_eq!(body, Bytes::from_static(br#"{"status":"unavailable"}"#));
    assert!(!String::from_utf8_lossy(&body).contains(&store_path.display().to_string()));
    assert!(
        !store_path.exists(),
        "readiness recreated the missing store"
    );

    nac_core::store::initialize(&store_path).unwrap();
    let recovered = get_response(app, "/health", None).await;
    assert_eq!(recovered.status(), StatusCode::OK);
    let _ = std::fs::remove_dir_all(root);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn open_store_descriptor_count(store_path: &std::path::Path) -> usize {
    let canonical = std::fs::canonicalize(store_path).unwrap();
    let sidecar = |suffix: &str| {
        let mut path = canonical.as_os_str().to_os_string();
        path.push(suffix);
        PathBuf::from(path)
    };
    let targets = [canonical.clone(), sidecar("-wal"), sidecar("-shm")];
    #[cfg(target_os = "linux")]
    {
        return std::fs::read_dir("/proc/self/fd")
            .unwrap()
            .filter_map(|entry| std::fs::read_link(entry.ok()?.path()).ok())
            .filter(|path| targets.contains(path))
            .count();
    }
    #[cfg(target_os = "macos")]
    {
        let mut count = 0;
        let mut limit = std::mem::MaybeUninit::<libc::rlimit>::uninit();
        let result = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, limit.as_mut_ptr()) };
        assert_eq!(result, 0);
        let limit = unsafe { limit.assume_init() };
        for descriptor in 0..limit.rlim_cur as libc::c_int {
            let mut path = [0_i8; libc::PATH_MAX as usize];
            let result = unsafe { libc::fcntl(descriptor, libc::F_GETPATH, path.as_mut_ptr()) };
            if result == -1 {
                continue;
            }
            use std::os::unix::ffi::OsStrExt;
            let path = unsafe { std::ffi::CStr::from_ptr(path.as_ptr()) };
            let path = PathBuf::from(std::ffi::OsStr::from_bytes(path.to_bytes()));
            if targets.contains(&path) {
                count += 1;
            }
        }
        count
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn lower_nofile_limit(limit: libc::rlim_t) {
    let mut current = std::mem::MaybeUninit::<libc::rlimit>::uninit();
    let result = unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, current.as_mut_ptr()) };
    assert_eq!(result, 0);
    let mut current = unsafe { current.assume_init() };
    assert!(current.rlim_max >= limit);
    current.rlim_cur = limit;
    let result = unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &current) };
    assert_eq!(result, 0);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[tokio::test]
async fn sqlite_connection_bound_low_nofile_helper() {
    let Some(root) = std::env::var_os("NAC_TEST_LOW_NOFILE_ROOT") else {
        return;
    };
    lower_nofile_limit(256);
    unsafe { std::env::set_var("OPENAI_API_KEY", "low-nofile-test-key") };
    let root = PathBuf::from(root);
    for index in 0..80 {
        seed_editable_session(&root, &format!("session-{index:03}"));
    }

    let manager = test_manager(&root);
    let mut subscriptions = Vec::new();
    for index in 0..56 {
        subscriptions.push(
            manager
                .subscribe_events(&format!("session-{index:03}"), None, 1)
                .await
                .unwrap(),
        );
        assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
    }

    let mut attachments = Vec::new();
    for index in 56..72 {
        let manager = manager.clone();
        attachments.push(tokio::spawn(async move {
            manager
                .subscribe_events(&format!("session-{index:03}"), None, 1)
                .await
        }));
    }
    for attachment in attachments {
        subscriptions.push(attachment.await.unwrap().unwrap());
    }

    subscriptions.push(
        manager
            .subscribe_events("session-079", None, 1)
            .await
            .unwrap(),
    );
    let request = CreateSessionRequest {
        cwd: Some(root.clone()),
        model: RequestField::Value("gpt-5.2".to_string()),
        backend: RequestField::Value("openai-responses".to_string()),
        api_key_env: RequestField::Value("OPENAI_API_KEY".to_string()),
        ..CreateSessionRequest::default()
    };
    let mut creations = Vec::new();
    for _ in 0..8 {
        let manager = manager.clone();
        let request = request.clone();
        creations.push(tokio::spawn(async move {
            manager.create_session(request).await
        }));
    }
    for creation in creations {
        creation.await.unwrap().unwrap();
    }
    manager.create_session(request).await.unwrap();
    assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
    nac_core::store::check_readiness(&root.join("store.db")).unwrap();
    assert_eq!(open_store_descriptor_count(&root.join("store.db")), 0);
    assert_eq!(subscriptions.len(), 73);
    println!("low-nofile connection regression completed");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn retained_subscriptions_do_not_exhaust_low_nofile_store_descriptors() {
    let root = temp_root("low_nofile_connections");
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "tests::sqlite_connection_bound_low_nofile_helper",
            "--nocapture",
        ])
        .env("NAC_TEST_LOW_NOFILE_ROOT", &root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "low-NOFILE child failed\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout)
            .contains("low-nofile connection regression completed"),
        "low-NOFILE helper did not execute\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let _ = std::fs::remove_dir_all(root);
}

async fn response_json(response: Response) -> serde_json::Value {
    serde_json::from_slice(&response_body(response).await).unwrap()
}

fn gunzip(body: &[u8]) -> Vec<u8> {
    let mut decoded = Vec::new();
    GzDecoder::new(body).read_to_end(&mut decoded).unwrap();
    decoded
}

fn seed_session(root: &std::path::Path, session_id: &str, created_at: &str) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        BTreeMap::new(),
    );
    snapshot.created_at = created_at.to_string();
    snapshot.updated_at = created_at.to_string();
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed session");
}

fn test_transcript() -> Vec<Message> {
    vec![
        Message::System {
            content: "hidden system preface".to_string(),
        },
        Message::User {
            content: "old cycle".to_string(),
        },
        Message::Assistant {
            content: Some("old answer".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::User {
            content: "current cycle".to_string(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: Some("thinking".to_string()),
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![nac_core::types::ToolCall {
                id: "call-thread".to_string(),
                call_type: "function".to_string(),
                function: nac_core::types::FunctionCall {
                    name: "thread".to_string(),
                    arguments: r#"{"name":"current/research"}"#.to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::System {
            content: "hidden tail".to_string(),
        },
        Message::Assistant {
            content: Some("done".to_string()),
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: None,
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
    ]
}

fn seed_session_with_messages(
    root: &std::path::Path,
    session_id: &str,
    created_at: &str,
    messages: Vec<Message>,
) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        messages,
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.created_at = created_at.to_string();
    snapshot.updated_at = created_at.to_string();
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed session messages");
}

fn seed_editable_session(root: &std::path::Path, session_id: &str) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        "https://api.openai.com/v1".to_string(),
        BackendKind::OpenAiResponses,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::from([("X-Original".to_string(), "yes".to_string())]),
    );
    snapshot.created_at = "2026-01-01 00:00:00.000000000".to_string();
    snapshot.updated_at = snapshot.created_at.clone();
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed editable session");
}

fn seed_direct_session(root: &std::path::Path, session_id: &str) {
    seed_direct_session_with_base_url(root, session_id, "https://api.openai.com/v1".to_string());
}

fn seed_direct_session_with_base_url(root: &std::path::Path, session_id: &str, base_url: String) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        base_url,
        BackendKind::OpenAiResponses,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&root.join("store.db"), &snapshot).expect("seed direct session");
}

fn seed_direct_with_orchestrator_session_with_base_url(
    root: &std::path::Path,
    session_id: &str,
    base_url: String,
) {
    let mut snapshot = sessions::new_snapshot(
        session_id.to_string(),
        root.to_path_buf(),
        "model-a".to_string(),
        base_url,
        BackendKind::OpenAiResponses,
        Some(ReasoningEffort::Medium),
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".to_string()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::DirectWithOrchestrator;
    sessions::create_session(&root.join("store.db"), &snapshot)
        .expect("seed direct-with-orchestrator session");
}

fn scripted_direct_response() -> (String, std::sync::mpsc::Receiver<()>) {
    use std::io::{Read, Write};

    let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind direct model");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept direct model request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "resumed"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        socket.write_all(response.as_bytes()).unwrap();
        socket.flush().unwrap();
        sender.send(()).unwrap();
    });
    (base_url, receiver)
}

fn scripted_direct_responses(responses: &[&str]) -> (String, std::sync::mpsc::Receiver<usize>) {
    use std::io::{Read, Write};

    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind scripted direct model");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let responses = responses
        .iter()
        .map(|response| response.to_string())
        .collect::<Vec<_>>();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for (index, text) in responses.into_iter().enumerate() {
            let (mut socket, _) = listener.accept().expect("accept direct model request");
            let mut request = Vec::new();
            let mut buffer = [0_u8; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                match socket.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(read) => request.extend_from_slice(&buffer[..read]),
                }
            }
            let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
            let response = format!(
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
            socket.write_all(response.as_bytes()).unwrap();
            socket.flush().unwrap();
            sender.send(index).unwrap();
        }
    });
    (base_url, receiver)
}

fn stalled_then_scripted_direct_response() -> (
    String,
    std::sync::mpsc::Receiver<usize>,
    std::sync::mpsc::Sender<()>,
) {
    use std::io::{Read, Write};

    let listener =
        std::net::TcpListener::bind(("127.0.0.1", 0)).expect("bind stalled direct model");
    let base_url = format!("http://{}", listener.local_addr().unwrap());
    let (request_sender, request_receiver) = std::sync::mpsc::channel();
    let (release_sender, release_receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().expect("accept direct model request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            match socket.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(read) => request.extend_from_slice(&buffer[..read]),
            }
        }
        request_sender.send(0).unwrap();
        release_receiver.recv().unwrap();
        let body = serde_json::json!({
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "cancelled child response"}]}],
                "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
            })
            .to_string();
        let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
        let _ = socket.write_all(response.as_bytes());
        let _ = socket.flush();
    });
    (base_url, request_receiver, release_sender)
}

#[path = "tests/catalog.rs"]
mod catalog;
#[path = "tests/children_and_leases.rs"]
mod children_and_leases;
#[path = "tests/compaction.rs"]
mod compaction;
#[path = "tests/configuration.rs"]
mod configuration;
#[path = "tests/contract.rs"]
mod contract;
#[path = "tests/handoff.rs"]
mod handoff;
#[path = "tests/lifecycle.rs"]
mod lifecycle;
#[path = "tests/managed_delivery.rs"]
mod managed_delivery;
#[path = "tests/managed_topology.rs"]
mod managed_topology;
#[path = "tests/presentation.rs"]
mod presentation;
#[path = "tests/projects.rs"]
mod project_routes;
#[path = "tests/recovery.rs"]
mod recovery;
#[path = "tests/spawns.rs"]
mod spawns;
