use super::*;
use axum::{
    body::{to_bytes, Body},
    http::Request,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ring::signature::Ed25519KeyPair;
use std::collections::BTreeMap;
use std::future::IntoFuture;
use tower::ServiceExt;

const SEED: &str = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUBLIC: &str = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

fn hex(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}

struct Fixture {
    root: std::path::PathBuf,
    manager: SessionManager,
    _environment: crate::tests::ScopedModelEnv,
    _environment_lock: std::sync::MutexGuard<'static, ()>,
}

impl Fixture {
    fn new() -> Self {
        let environment_lock = crate::tests::SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!(
            "nac-server-managed-control-{}",
            uuid::Uuid::new_v4()
        ));
        let repository_root = root.join("repositories");
        let state_root = root.join("state");
        let home_root = root.join("home");
        for path in [&root, &repository_root, &state_root, &home_root] {
            std::fs::create_dir_all(path).unwrap();
        }
        let environment = crate::tests::ScopedModelEnv::isolated(&state_root, None);
        let credential = root.join("model-token");
        std::fs::write(&credential, "not-a-real-secret").unwrap();
        let key_mount = root.join("control-keys");
        std::fs::create_dir(&key_mount).unwrap();
        let jwks = key_mount.join("jwks.json");
        std::fs::write(
            &jwks,
            serde_json::to_vec(&serde_json::json!({
                "keys": [{
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "use": "sig",
                    "alg": "EdDSA",
                    "kid": "control-key",
                    "x": URL_SAFE_NO_PAD.encode(hex(PUBLIC))
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&jwks, std::fs::Permissions::from_mode(0o444)).unwrap();
            std::fs::set_permissions(&key_mount, std::fs::Permissions::from_mode(0o555)).unwrap();
        }
        let managed_host = nac_managed::ManagedHostConfig {
            version: nac_managed::MANAGED_CONFIG_VERSION,
            logical_host_id: "host-123".to_string(),
            host_incarnation_id: Some("incarnation-456".to_string()),
            owner: Some("owner@example.test".to_string()),
            public_hostname: "nac.example.test".to_string(),
            repository_root,
            state_root,
            home_root,
            github_client_id: "Iv1.test".to_string(),
            model_backend: "arcee-api".to_string(),
            model_id: "trinity-large-thinking".to_string(),
            model_endpoint: "https://api.arcee.ai/api/v1".to_string(),
            model_credential_file: credential,
            model_credential_source: nac_managed::ManagedModelCredentialSource::MountedApiKey,
            model_credential_environment_names: Vec::new(),
            managed_control_bind: Some("127.0.0.1:3211".to_string()),
            managed_control_issuer: Some("https://nac-api.example.test".to_string()),
            managed_control_jwks_file: Some(jwks),
        };
        managed_host.validate().unwrap();
        let manager = SessionManager::new(crate::ServerOptions {
            root_cwd: root.clone(),
            store_path: Some(root.join("store.db")),
            worker_executable: None,
            managed_host: Some(managed_host),
        })
        .unwrap();
        nac_core::store::initialize(&manager.inner.store_path).unwrap();
        Self {
            root,
            manager,
            _environment: environment,
            _environment_lock: environment_lock,
        }
    }

    fn request(&self) -> ManagedControlRequest {
        ManagedControlRequest {
            managed_host_id: "host-123".to_string(),
            host_incarnation_id: "incarnation-456".to_string(),
            operation_id: "operation-789".to_string(),
            target: nac_managed::ManagedControlTarget {
                release_id: "beta-42".to_string(),
                source_sha: "a".repeat(40),
                product_version: "0.2.0-beta.42".to_string(),
                schema_version: nac_core::store::schema_version(),
                minimum_schema_version: 0,
            },
            actor: "user:owner".to_string(),
            beneficiary: "tenant:owner".to_string(),
        }
    }

    fn assertion(
        &self,
        action: ManagedControlAction,
        request: &ManagedControlRequest,
        jti: &str,
    ) -> String {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let action = match action {
            ManagedControlAction::Status => "status",
            ManagedControlAction::Prepare => "prepare",
            ManagedControlAction::Retry => "retry",
        };
        let claims = serde_json::json!({
            "iss": "https://nac-api.example.test",
            "aud": "urn:nac:managed-control:host-123:incarnation-456",
            "jti": jti,
            "action": action,
            "managed_host_id": request.managed_host_id,
            "host_incarnation_id": request.host_incarnation_id,
            "operation_id": request.operation_id,
            "target": request.target,
            "actor": request.actor,
            "beneficiary": request.beneficiary,
            "iat": now,
            "nbf": now,
            "exp": now + 60
        });
        let header = serde_json::json!({
            "alg": "EdDSA",
            "kid": "control-key",
            "typ": "nac-managed-operation+jwt",
            "v": 1
        });
        let protected = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&header).unwrap());
        let payload = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let signed = format!("{protected}.{payload}");
        let key = Ed25519KeyPair::from_seed_and_public_key(&hex(SEED), &hex(PUBLIC)).unwrap();
        format!(
            "{signed}.{}",
            URL_SAFE_NO_PAD.encode(key.sign(signed.as_bytes()).as_ref())
        )
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Some(parent) = self
            .manager
            .managed_host()
            .and_then(|host| host.managed_control_jwks_file.as_deref())
            .and_then(std::path::Path::parent)
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(parent, std::fs::Permissions::from_mode(0o755));
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn tree_snapshot(root: &std::path::Path) -> BTreeMap<std::path::PathBuf, (u32, Vec<u8>)> {
    fn visit(
        root: &std::path::Path,
        path: &std::path::Path,
        snapshot: &mut BTreeMap<std::path::PathBuf, (u32, Vec<u8>)>,
    ) {
        // SQLite readers may update WAL shared-memory/read-mark bookkeeping.
        // Those sidecars are process coordination, not managed persistent
        // state; the database image and every managed file remain covered.
        if path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.ends_with("-wal") || name.ends_with("-shm"))
        {
            return;
        }
        let metadata = std::fs::symlink_metadata(path).unwrap();
        #[cfg(unix)]
        let mode = {
            use std::os::unix::fs::PermissionsExt;
            metadata.permissions().mode()
        };
        #[cfg(not(unix))]
        let mode = u32::from(metadata.permissions().readonly());
        let content = if metadata.is_file() {
            std::fs::read(path).unwrap()
        } else if metadata.file_type().is_symlink() {
            std::fs::read_link(path)
                .unwrap()
                .as_os_str()
                .as_encoded_bytes()
                .to_vec()
        } else {
            Vec::new()
        };
        snapshot.insert(
            path.strip_prefix(root).unwrap().to_path_buf(),
            (mode, content),
        );
        if metadata.is_dir() {
            let mut children = std::fs::read_dir(path)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect::<Vec<_>>();
            children.sort();
            for child in children {
                visit(root, &child, snapshot);
            }
        }
    }
    let mut snapshot = BTreeMap::new();
    visit(root, root, &mut snapshot);
    snapshot
}

async fn call(
    app: Router,
    path: &str,
    request: &ManagedControlRequest,
    assertion: &str,
) -> (StatusCode, String) {
    let response = app
        .oneshot(
            Request::post(path)
                .header(header::AUTHORIZATION, format!("Bearer {assertion}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_vec(request).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn private_routes_are_absent_from_public_router_and_prepare_closes_admission() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let assertion = fixture.assertion(ManagedControlAction::Prepare, &request, "jti-prepare");
    let public = crate::router(fixture.manager.clone());
    let (status, _) = call(public.clone(), "/v1/upgrade/prepare", &request, &assertion).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let openapi = serde_json::to_value(crate::openapi_document()).unwrap();
    assert!(openapi["paths"].get("/v1/upgrade/prepare").is_none());
    assert!(openapi["paths"].get("/v1/upgrade/status").is_none());

    let (status, body) = call(
        super::router(fixture.manager.clone()),
        "/v1/upgrade/prepare",
        &request,
        &assertion,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("safe_to_stop"));
    assert!(!body.contains(&assertion));

    let response = public
        .oneshot(
            Request::post("/projects")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let response = crate::router(fixture.manager.clone())
        .oneshot(Request::get("/managed/status").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let response = crate::router(fixture.manager.clone())
        .oneshot(
            Request::get("/auth/openai/login/poll-id")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn lost_response_retry_and_binding_failures_are_sanitized() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let assertion = fixture.assertion(ManagedControlAction::Status, &request, "jti-status");
    let app = super::router(fixture.manager.clone());
    let first = call(app.clone(), "/v1/upgrade/status", &request, &assertion).await;
    let replay = call(app.clone(), "/v1/upgrade/status", &request, &assertion).await;
    assert_eq!(first, replay);

    let wrong_action =
        fixture.assertion(ManagedControlAction::Prepare, &request, "jti-wrong-action");
    let (status, body) = call(app.clone(), "/v1/upgrade/status", &request, &wrong_action).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!body.contains(&wrong_action));

    let mut substituted = request.clone();
    substituted.host_incarnation_id = "stale-incarnation".to_string();
    let (status, body) = call(app, "/v1/upgrade/status", &substituted, &assertion).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!body.contains("jti-status"));
    assert!(!body.contains(&assertion));
}

#[tokio::test]
async fn background_device_login_admission_blocks_prepare_for_its_full_lifetime() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let admission = fixture.manager.managed_work_admission().unwrap().unwrap();
    let (release, held) = tokio::sync::oneshot::channel::<()>();
    let background = tokio::spawn(async move {
        let _admission = admission;
        let _ = held.await;
    });
    let prepare = fixture.assertion(
        ManagedControlAction::Prepare,
        &request,
        "jti-blocked-by-admission",
    );
    let (status, body) = call(
        super::router(fixture.manager.clone()),
        "/v1/upgrade/prepare",
        &request,
        &prepare,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("host-admission"));
    assert_eq!(
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
            .unwrap()
            .state,
        nac_core::store::ManagedMaintenanceState::Serving
    );

    release.send(()).unwrap();
    background.await.unwrap();
    let retry = fixture.assertion(ManagedControlAction::Retry, &request, "jti-explicit-retry");
    let (status, body) = call(
        super::router(fixture.manager.clone()),
        "/v1/upgrade/retry",
        &request,
        &retry,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body.contains("safe_to_stop"));
}

#[tokio::test]
async fn prepare_never_queues_behind_an_active_reader_or_blocks_later_requests() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let reader = Arc::clone(&fixture.manager.inner.maintenance_gate)
        .read_owned()
        .await;
    let prepare = fixture.assertion(
        ManagedControlAction::Prepare,
        &request,
        "jti-process-reader",
    );
    let (status, body) = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        call(
            super::router(fixture.manager.clone()),
            "/v1/upgrade/prepare",
            &request,
            &prepare,
        ),
    )
    .await
    .expect("prepare must return a blocker instead of waiting");
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(body.contains("process-admission"));

    let response = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        crate::router(fixture.manager.clone()).oneshot(
            Request::post("/not-a-route")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        ),
    )
    .await
    .expect("a later reader must not deadlock behind prepare")
    .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    drop(reader);
}

#[tokio::test]
async fn blocker_scan_never_queues_behind_active_session_registry_updates() {
    let fixture = Fixture::new();
    let _writer = fixture.manager.inner.active_sessions.write().await;
    let started = std::time::Instant::now();
    let blockers = fixture.manager.managed_upgrade_blockers().unwrap();
    assert!(started.elapsed() < std::time::Duration::from_millis(50));
    assert!(blockers.iter().any(|blocker| {
        blocker.kind == nac_core::store::ManagedBlockerKind::OperationLease
            && blocker.id == "process-active-sessions-snapshot"
    }));
}

#[tokio::test]
async fn durable_operation_and_resource_leases_are_reported_together() {
    let fixture = Fixture::new();
    let session_id = "leased-session";
    let snapshot = nac_core::sessions::new_snapshot(
        session_id.to_string(),
        fixture.root.clone(),
        "model".to_string(),
        "https://api.openai.com/v1".to_string(),
        nac_core::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        std::collections::BTreeMap::new(),
    );
    nac_core::sessions::create_session(&fixture.manager.inner.store_path, &snapshot).unwrap();
    let _operation = nac_core::sessions::SessionOperationLease::try_acquire(
        &fixture.manager.inner.store_path,
        session_id,
    )
    .unwrap();
    let _resource = nac_core::sessions::SessionResourceLease::try_acquire(
        &fixture.manager.inner.store_path,
        session_id,
    )
    .unwrap();
    let blockers = fixture.manager.managed_upgrade_blockers().unwrap();
    assert!(blockers.iter().any(|blocker| {
        blocker.kind == nac_core::store::ManagedBlockerKind::OperationLease
            && blocker.session_id.as_deref() == Some(session_id)
    }));
    assert!(blockers.iter().any(|blocker| {
        blocker.kind == nac_core::store::ManagedBlockerKind::ResourceLease
            && blocker.session_id.as_deref() == Some(session_id)
    }));
}

#[tokio::test]
async fn real_listeners_enforce_private_block_settle_retry_and_public_maintenance() {
    let fixture = Fixture::new();
    let public_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let private_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let public_address = public_listener.local_addr().unwrap();
    let private_address = private_listener.local_addr().unwrap();
    let public = tokio::spawn(
        axum::serve(public_listener, crate::router(fixture.manager.clone())).into_future(),
    );
    let private = tokio::spawn(
        axum::serve(private_listener, super::router(fixture.manager.clone())).into_future(),
    );
    let request = fixture.request();
    let assertion = fixture.assertion(ManagedControlAction::Status, &request, "jti-real-listener");
    async fn raw_call(
        address: std::net::SocketAddr,
        path: &str,
        request: &ManagedControlRequest,
        assertion: &str,
    ) -> String {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let body = serde_json::to_vec(request).unwrap();
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let head = format!(
            "POST {path} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {assertion}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes()).await.unwrap();
        stream.write_all(&body).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        String::from_utf8(response).unwrap()
    }

    let public_response =
        raw_call(public_address, "/v1/upgrade/status", &request, &assertion).await;
    assert!(public_response.starts_with("HTTP/1.1 404"));
    let private_response =
        raw_call(private_address, "/v1/upgrade/status", &request, &assertion).await;
    assert!(private_response.starts_with("HTTP/1.1 200"));
    let body = private_response;
    assert!(!body.contains(&assertion));

    let admission =
        nac_core::sessions::HostAdmissionLease::try_acquire(&fixture.manager.inner.store_path)
            .unwrap();
    let prepare = fixture.assertion(
        ManagedControlAction::Prepare,
        &request,
        "jti-real-listener-blocked",
    );
    let blocked = raw_call(private_address, "/v1/upgrade/prepare", &request, &prepare).await;
    assert!(blocked.starts_with("HTTP/1.1 409"), "{blocked}");
    assert!(blocked.contains("host-admission"));
    drop(admission);

    let retry = fixture.assertion(
        ManagedControlAction::Retry,
        &request,
        "jti-real-listener-retry",
    );
    let safe = raw_call(private_address, "/v1/upgrade/retry", &request, &retry).await;
    assert!(safe.starts_with("HTTP/1.1 200"), "{safe}");
    assert!(safe.contains("safe_to_stop"));
    let mutation = raw_call(public_address, "/projects", &request, &retry).await;
    assert!(mutation.starts_with("HTTP/1.1 503"), "{mutation}");
    public.abort();
    private.abort();
}

#[test]
fn wrong_candidate_is_rejected_before_any_managed_state_mutation() {
    let fixture = Fixture::new();
    let request = fixture.request();
    let binding = operation_binding(&fixture.manager, &request).unwrap();
    nac_core::store::prepare_managed_upgrade(
        &fixture.manager.inner.store_path,
        "zero-mutation-prepare",
        &binding,
        nac_core::store::ManagedControlAttemptAction::Prepare,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 60,
        Vec::new(),
    )
    .unwrap();
    let before = tree_snapshot(&fixture.root);
    let managed_host = fixture.manager.managed_host().unwrap().clone();
    let result = SessionManager::new(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(managed_host),
    });
    assert!(result.is_err());
    let after = tree_snapshot(&fixture.root);
    let changed = before
        .keys()
        .chain(after.keys())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .filter(|path| before.get(*path) != after.get(*path))
        .cloned()
        .collect::<Vec<_>>();
    assert!(changed.is_empty(), "managed state changed at {changed:?}");
}

#[tokio::test]
async fn failed_listener_bind_keeps_accepted_candidate_in_maintenance() {
    let fixture = Fixture::new();
    let mut request = fixture.request();
    let running = crate::managed_running_target().unwrap();
    request.target.release_id = running.release_id;
    request.target.source_sha = running.source_sha;
    request.target.product_version = running.product_version;
    request.target.schema_version = running.schema_version;
    request.target.minimum_schema_version = running.minimum_schema_version;
    let binding = operation_binding(&fixture.manager, &request).unwrap();
    nac_core::store::prepare_managed_upgrade(
        &fixture.manager.inner.store_path,
        "bind-failure-prepare",
        &binding,
        nac_core::store::ManagedControlAttemptAction::Prepare,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 60,
        Vec::new(),
    )
    .unwrap();
    let replacement = SessionManager::new(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(fixture.manager.managed_host().unwrap().clone()),
    })
    .unwrap();
    let occupied = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = occupied.local_addr().unwrap();
    let error = crate::serve_with_policy(
        address,
        crate::BindPolicy::LoopbackOnly,
        replacement,
        |_| {},
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("failed to bind"));
    assert_eq!(
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
            .unwrap()
            .state,
        nac_core::store::ManagedMaintenanceState::Maintenance
    );
}

#[tokio::test]
async fn accepted_replacement_fences_old_public_completion_and_private_control_routes() {
    let fixture = Fixture::new();
    let mut accepted_request = fixture.request();
    let running = crate::managed_running_target().unwrap();
    accepted_request.target.release_id = running.release_id;
    accepted_request.target.source_sha = running.source_sha;
    accepted_request.target.product_version = running.product_version;
    accepted_request.target.schema_version = running.schema_version;
    accepted_request.target.minimum_schema_version = running.minimum_schema_version;
    let binding = operation_binding(&fixture.manager, &accepted_request).unwrap();
    nac_core::store::prepare_managed_upgrade(
        &fixture.manager.inner.store_path,
        "stale-router-prepare",
        &binding,
        nac_core::store::ManagedControlAttemptAction::Prepare,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64
            + 60,
        Vec::new(),
    )
    .unwrap();
    let replacement = SessionManager::new(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(fixture.manager.managed_host().unwrap().clone()),
    })
    .unwrap();
    assert!(nac_core::store::accept_managed_forward_start(
        &fixture.manager.inner.store_path,
        replacement.managed_identity().unwrap(),
    )
    .unwrap());

    let response = crate::router(fixture.manager.clone())
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

    let mut next_request = fixture.request();
    next_request.operation_id = "operation-after-replacement".to_string();
    let status_assertion = fixture.assertion(
        ManagedControlAction::Status,
        &next_request,
        "stale-private-status",
    );
    let (status, _) = call(
        super::router(fixture.manager.clone()),
        "/v1/upgrade/status",
        &next_request,
        &status_assertion,
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);

    let prepare_assertion = fixture.assertion(
        ManagedControlAction::Prepare,
        &next_request,
        "stale-private-prepare",
    );
    let (status, _) = call(
        super::router(fixture.manager.clone()),
        "/v1/upgrade/prepare",
        &next_request,
        &prepare_assertion,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
            .unwrap()
            .state,
        nac_core::store::ManagedMaintenanceState::Serving
    );
}
