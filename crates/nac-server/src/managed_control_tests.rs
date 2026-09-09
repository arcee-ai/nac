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

#[test]
fn managed_target_uses_the_canonical_build_and_schema_identity() {
    let target = crate::managed_running_target().unwrap();
    let identity = crate::build_identity::current();
    assert_eq!(target.release_id, identity.build_id);
    assert_eq!(target.source_sha, identity.source_revision);
    assert_eq!(target.product_version, identity.product_version);
    assert_eq!(target.schema_version, nac_core::store::schema_version());
    assert_eq!(
        target.minimum_schema_version,
        nac_core::store::MINIMUM_MIGRATABLE_SCHEMA_VERSION
    );
}

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
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let repository_root = root.join("repositories");
        let state_root = root.join("state");
        let home_root = root.join("home");
        for path in [&repository_root, &state_root, &home_root] {
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
            std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o600)).unwrap();
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
            managed_upgrade_expectation: None,
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
            previous_operation_id: None,
            previous_target: None,
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
            ManagedControlAction::Supersede => "supersede",
        };
        let mut claims = serde_json::json!({
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
        if let Some(previous_operation_id) = &request.previous_operation_id {
            claims["previous_operation_id"] = serde_json::json!(previous_operation_id);
        }
        if let Some(previous_target) = &request.previous_target {
            claims["previous_target"] = serde_json::json!(previous_target);
        }
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

    fn running_request(&self) -> ManagedControlRequest {
        let mut request = self.request();
        let running = crate::managed_running_target().unwrap();
        request.target.release_id = running.release_id;
        request.target.source_sha = running.source_sha;
        request.target.product_version = running.product_version;
        request.target.schema_version = running.schema_version;
        request.target.minimum_schema_version = running.minimum_schema_version;
        request
    }

    fn prepare_running_replacement(&self, jti: &str) -> SessionManager {
        let request = self.running_request();
        let binding = operation_binding(&self.manager, &request).unwrap();
        assert!(matches!(
            nac_core::store::prepare_managed_upgrade(
                &self.manager.inner.store_path,
                jti,
                &binding,
                nac_core::store::ManagedControlAttemptAction::Prepare,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64
                    + 60,
                Vec::new(),
            )
            .unwrap(),
            nac_core::store::ManagedPrepareOutcome::SafeToStop { .. }
        ));
        SessionManager::new(crate::ServerOptions {
            root_cwd: self.root.clone(),
            store_path: Some(self.manager.inner.store_path.clone()),
            worker_executable: None,
            managed_host: Some(self.manager.managed_host().unwrap().clone()),
        })
        .unwrap()
    }

    #[cfg(unix)]
    fn readiness_policy(
        &self,
        forced_failure: Option<&'static str>,
    ) -> crate::application::managed::ManagedReadinessPolicy {
        use std::os::unix::fs::MetadataExt;

        let metadata = std::fs::metadata(&self.root).unwrap();
        crate::application::managed::ManagedReadinessPolicy::for_test(
            metadata.uid(),
            metadata.gid(),
            &[],
            forced_failure,
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

async fn raw_get(address: std::net::SocketAddr, path: &str) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
    stream
        .write_all(
            format!("GET {path} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n")
                .as_bytes(),
        )
        .await
        .unwrap();
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.unwrap();
    String::from_utf8(response).unwrap()
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
async fn signed_supersede_route_recovers_forward_and_is_private_replay_safe() {
    let fixture = Fixture::new();
    let replacement = fixture.prepare_running_replacement("supersede-serving");
    let serving_identity = replacement.managed_identity().unwrap().clone();
    assert!(nac_core::store::accept_managed_forward_start(
        &fixture.manager.inner.store_path,
        &serving_identity,
    )
    .unwrap());
    let response = crate::router(replacement.clone())
        .oneshot(
            Request::post("/v1/upgrade/supersede")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);

    let mut failed = fixture.running_request();
    failed.operation_id = "operation-failed-a".to_string();
    failed.target.release_id = "release-failed-a".to_string();
    failed.target.source_sha = "b".repeat(40);
    let failed_binding = operation_binding(&replacement, &failed).unwrap();
    assert!(matches!(
        nac_core::store::prepare_managed_upgrade_for_identity(
            &fixture.manager.inner.store_path,
            "jti-route-failed-a",
            &failed_binding,
            nac_core::store::ManagedControlAttemptAction::Prepare,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
                + 60,
            Vec::new(),
            &serving_identity,
        )
        .unwrap(),
        nac_core::store::ManagedPrepareOutcome::SafeToStop { .. }
    ));

    let mut corrected = fixture.running_request();
    corrected.operation_id = "operation-corrected-b".to_string();
    corrected.target.release_id = "release-corrected-b".to_string();
    corrected.target.source_sha = "c".repeat(40);
    corrected.previous_operation_id = Some(failed.operation_id.clone());
    corrected.previous_target = Some(failed.target.clone());
    let assertion = fixture.assertion(
        ManagedControlAction::Supersede,
        &corrected,
        "jti-route-supersede",
    );
    let app = super::router(replacement.clone());
    let first = call(app.clone(), "/v1/upgrade/supersede", &corrected, &assertion).await;
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert!(first.1.contains("superseded"));
    let replay = call(app.clone(), "/v1/upgrade/supersede", &corrected, &assertion).await;
    assert_eq!(replay, first);

    let mut substituted = corrected.clone();
    substituted.previous_operation_id = Some("operation-substituted".to_string());
    let (status, body) = call(app, "/v1/upgrade/supersede", &substituted, &assertion).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(!body.contains("operation-failed-a"));
    assert!(!body.contains(&assertion));

    let snapshot =
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path).unwrap();
    assert_eq!(
        snapshot.operation_id.as_deref(),
        Some("operation-corrected-b")
    );
    assert_eq!(
        snapshot.state,
        nac_core::store::ManagedMaintenanceState::Maintenance
    );
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
    let readiness = raw_get(public_address, "/readyz").await;
    assert!(readiness.starts_with("HTTP/1.1 503"), "{readiness}");
    assert!(
        readiness.contains("\"maintenance_state\":\"maintenance\""),
        "{readiness}"
    );
    let status = raw_get(public_address, "/managed/status").await;
    assert!(status.starts_with("HTTP/1.1 200"), "{status}");
    assert!(
        status.contains("\"maintenance_state\":\"maintenance\""),
        "{status}"
    );
    assert!(status.contains("\"state\":\"maintenance\""), "{status}");
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
async fn managed_v2_future_and_invalid_stores_serve_immutable_recovery_diagnostics() {
    for (case, expected_failure) in [
        ("future", "future-schema"),
        ("invalid", "store-unavailable"),
    ] {
        let fixture = Fixture::new();
        if case == "future" {
            nac_core::test_support::store::set_test_schema_version(
                &fixture.manager.inner.store_path,
                nac_core::store::schema_version() + 1,
            )
            .unwrap();
        } else {
            std::fs::write(&fixture.manager.inner.store_path, b"not a SQLite database").unwrap();
        }
        let before = std::fs::read(&fixture.manager.inner.store_path).unwrap();
        let recovery = SessionManager::new(crate::ServerOptions {
            root_cwd: fixture.root.clone(),
            store_path: Some(fixture.manager.inner.store_path.clone()),
            worker_executable: None,
            managed_host: Some(fixture.manager.managed_host().unwrap().clone()),
        })
        .expect("managed v2 store failure must construct recovery-only state");
        assert!(recovery.is_recovery_only());

        let (listening_tx, listening_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            crate::serve_with_policy(
                "127.0.0.1:0".parse().unwrap(),
                crate::BindPolicy::LoopbackOnly,
                recovery,
                move |address| {
                    let _ = listening_tx.send(address);
                },
            )
            .await
        });
        let address = tokio::time::timeout(std::time::Duration::from_secs(2), listening_rx)
            .await
            .expect("managed v2 recovery server bind timed out")
            .expect("managed v2 recovery server stopped before binding");

        let health = raw_get(address, "/healthz").await;
        assert!(health.starts_with("HTTP/1.1 200"), "{health}");
        let ready = raw_get(address, "/readyz").await;
        assert!(ready.starts_with("HTTP/1.1 503"), "{ready}");
        assert!(ready.contains(expected_failure), "{ready}");
        assert!(
            ready.contains("\"maintenance_state\":\"recovery-only\""),
            "{ready}"
        );
        let status = raw_get(address, "/managed/status").await;
        assert!(status.starts_with("HTTP/1.1 200"), "{status}");
        assert!(status.contains(expected_failure), "{status}");
        assert!(
            status.contains("\"maintenance_state\":\"recovery-only\""),
            "{status}"
        );
        let sessions = raw_get(address, "/sessions").await;
        assert!(sessions.starts_with("HTTP/1.1 404"), "{sessions}");
        assert_eq!(
            std::fs::read(&fixture.manager.inner.store_path).unwrap(),
            before,
            "recovery diagnostics mutated the {case} database"
        );

        server.abort();
        let _ = server.await;
    }
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

#[cfg(unix)]
#[tokio::test]
async fn every_replacement_readiness_failure_keeps_maintenance_and_diagnostics() {
    for failed_check in [
        "store",
        "state-root",
        "repository-root",
        "home-root",
        "model-credential",
        "runtime-tools",
        "local-command",
    ] {
        let fixture = Fixture::new();
        let replacement = fixture.prepare_running_replacement(&format!("readiness-{failed_check}"));
        let error = crate::delivery::server::serve_with_policy_and_readiness(
            "127.0.0.1:0".parse().unwrap(),
            crate::BindPolicy::LoopbackOnly,
            replacement,
            |_| {},
            fixture.readiness_policy(Some(failed_check)),
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains(failed_check), "{error:#}");

        let snapshot =
            nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
                .unwrap();
        assert_eq!(
            snapshot.state,
            nac_core::store::ManagedMaintenanceState::Maintenance
        );
        assert!(snapshot.accepted_identity.is_none());
        assert_eq!(snapshot.operation_id.as_deref(), Some("operation-789"));

        let response = crate::router(fixture.manager.clone())
            .oneshot(Request::get("/managed/status").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let status: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await.unwrap())
                .unwrap();
        assert_eq!(status["maintenance_state"], "maintenance");
        assert_eq!(status["maintenance"]["state"], "maintenance");
        assert_eq!(
            status["maintenance"]["accepted_identity"],
            serde_json::Value::Null
        );
        assert_eq!(status["maintenance"]["operation_id"], "operation-789");
    }
}

#[cfg(unix)]
#[tokio::test]
async fn fully_ready_replacement_accepts_only_after_both_listeners_bind() {
    let fixture = Fixture::new();
    let replacement = fixture.prepare_running_replacement("readiness-success");
    let policy = fixture.readiness_policy(None);
    let (listening_tx, listening_rx) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        crate::delivery::server::serve_with_policy_and_readiness(
            "127.0.0.1:0".parse().unwrap(),
            crate::BindPolicy::LoopbackOnly,
            replacement,
            move |address| {
                let _ = listening_tx.send(address);
            },
            policy,
        )
        .await
    });
    match tokio::time::timeout(std::time::Duration::from_secs(2), listening_rx).await {
        Ok(Ok(_)) => {}
        outcome => panic!(
            "ready replacement did not accept ({outcome:?}): {:?}",
            server.await
        ),
    }
    let snapshot =
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path).unwrap();
    assert_eq!(
        snapshot.state,
        nac_core::store::ManagedMaintenanceState::Serving
    );
    assert_eq!(
        snapshot.accepted_identity.as_ref().unwrap().operation_id,
        fixture.request().operation_id
    );
    server.abort();
    let _ = server.await;
}

#[cfg(unix)]
#[tokio::test]
async fn controller_startup_expectation_recovers_suspended_or_failed_release_and_can_accept_b() {
    for failed_in_maintenance in [false, true] {
        let fixture = Fixture::new();
        let mut prior = fixture.request();
        prior.operation_id = "operation-startup-a".to_string();
        prior.target.release_id = "release-startup-a".to_string();
        prior.target.source_sha = "d".repeat(40);
        prior.target.product_version = "0.0.1".to_string();
        let prior_binding = operation_binding(&fixture.manager, &prior).unwrap();
        nac_core::store::prepare_managed_upgrade(
            &fixture.manager.inner.store_path,
            "jti-startup-a",
            &prior_binding,
            nac_core::store::ManagedControlAttemptAction::Prepare,
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64
                + 60,
            Vec::new(),
        )
        .unwrap();
        let prior_identity = nac_core::store::ManagedAcceptedIdentity {
            managed_host_id: prior.managed_host_id.clone(),
            host_incarnation_id: prior.host_incarnation_id.clone(),
            operation_id: prior.operation_id.clone(),
            target: prior_binding.target.clone(),
        };
        assert!(nac_core::store::accept_managed_forward_start(
            &fixture.manager.inner.store_path,
            &prior_identity,
        )
        .unwrap());

        if !failed_in_maintenance {
            let unexpected = SessionManager::new(crate::ServerOptions {
                root_cwd: fixture.root.clone(),
                store_path: Some(fixture.manager.inner.store_path.clone()),
                worker_executable: None,
                managed_host: Some(fixture.manager.managed_host().unwrap().clone()),
            });
            assert!(unexpected.is_err());
            let snapshot =
                nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
                    .unwrap();
            assert_eq!(
                snapshot.state,
                nac_core::store::ManagedMaintenanceState::Serving
            );
            assert_eq!(snapshot.accepted_identity.as_ref(), Some(&prior_identity));
        }

        let previous = if failed_in_maintenance {
            let mut failed = prior.clone();
            failed.operation_id = "operation-startup-failed".to_string();
            failed.target.release_id = "release-startup-failed".to_string();
            failed.target.source_sha = "e".repeat(40);
            failed.target.product_version = "0.0.2+failed.1".to_string();
            let binding = operation_binding(&fixture.manager, &failed).unwrap();
            nac_core::store::prepare_managed_upgrade_for_identity(
                &fixture.manager.inner.store_path,
                "jti-startup-failed",
                &binding,
                nac_core::store::ManagedControlAttemptAction::Prepare,
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64
                    + 60,
                Vec::new(),
                &prior_identity,
            )
            .unwrap();
            failed
        } else {
            prior
        };

        let running = crate::managed_running_target().unwrap();
        let mut managed = fixture.manager.managed_host().unwrap().clone();
        managed.managed_upgrade_expectation = Some(nac_managed::ManagedUpgradeExpectation {
            adopt_unbound_previous: false,
            previous_operation_id: previous.operation_id.clone(),
            previous_target: previous.target.clone(),
            operation_id: "operation-startup-b".to_string(),
            target: nac_managed::ManagedControlTarget {
                release_id: running.release_id.clone(),
                source_sha: running.source_sha.clone(),
                product_version: running.product_version.clone(),
                schema_version: running.schema_version,
                minimum_schema_version: running.minimum_schema_version,
            },
            actor: previous.actor.clone(),
            beneficiary: previous.beneficiary.clone(),
        });
        let replacement = SessionManager::new(crate::ServerOptions {
            root_cwd: fixture.root.clone(),
            store_path: Some(fixture.manager.inner.store_path.clone()),
            worker_executable: None,
            managed_host: Some(managed.clone()),
        })
        .unwrap();
        let replayed = SessionManager::new(crate::ServerOptions {
            root_cwd: fixture.root.clone(),
            store_path: Some(fixture.manager.inner.store_path.clone()),
            worker_executable: None,
            managed_host: Some(managed),
        })
        .unwrap();
        assert_eq!(replacement.managed_identity(), replayed.managed_identity());
        let snapshot =
            nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
                .unwrap();
        assert_eq!(
            snapshot.state,
            nac_core::store::ManagedMaintenanceState::Maintenance
        );
        assert_eq!(
            snapshot.operation_id.as_deref(),
            Some("operation-startup-b")
        );

        assert!(nac_core::store::accept_managed_forward_start(
            &fixture.manager.inner.store_path,
            replayed.managed_identity().unwrap(),
        )
        .unwrap());
        let snapshot =
            nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path)
                .unwrap();
        assert_eq!(
            snapshot.state,
            nac_core::store::ManagedMaintenanceState::Serving
        );
        assert_eq!(
            snapshot.accepted_identity.as_ref().unwrap().operation_id,
            "operation-startup-b"
        );
        assert!(nac_core::store::try_admit_managed_work_for_identity(
            &fixture.manager.inner.store_path,
            &prior_identity,
        )
        .is_err());
    }
}

#[test]
fn controller_startup_expectation_explicitly_adopts_a_virgin_pre_control_release() {
    let fixture = Fixture::new();
    let running = crate::managed_running_target().unwrap();
    let previous_target = nac_managed::ManagedControlTarget {
        release_id: "release-pre-control-a".to_string(),
        source_sha: "a".repeat(40),
        product_version: "0.0.1+legacy.1".to_string(),
        schema_version: running.schema_version,
        minimum_schema_version: 0,
    };
    let expectation = nac_managed::ManagedUpgradeExpectation {
        adopt_unbound_previous: true,
        previous_operation_id: "operation-pre-control-a".to_string(),
        previous_target,
        operation_id: "operation-first-controlled-b".to_string(),
        target: nac_managed::ManagedControlTarget {
            release_id: running.release_id.clone(),
            source_sha: running.source_sha.clone(),
            product_version: running.product_version.clone(),
            schema_version: running.schema_version,
            minimum_schema_version: running.minimum_schema_version,
        },
        actor: "user:owner".to_string(),
        beneficiary: "tenant:owner".to_string(),
    };

    let mut mismatched = fixture.manager.managed_host().unwrap().clone();
    let mut mismatched_expectation = expectation.clone();
    mismatched_expectation.target.source_sha = "f".repeat(40);
    mismatched.managed_upgrade_expectation = Some(mismatched_expectation);
    assert!(SessionManager::new(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(mismatched),
    })
    .is_err());
    let virgin =
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path).unwrap();
    assert_eq!(
        virgin.state,
        nac_core::store::ManagedMaintenanceState::Serving
    );
    assert!(virgin.accepted_identity.is_none());

    let mut managed = fixture.manager.managed_host().unwrap().clone();
    managed.managed_upgrade_expectation = Some(expectation);
    let replacement = SessionManager::new(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(managed.clone()),
    })
    .unwrap();
    let replayed = SessionManager::new(crate::ServerOptions {
        root_cwd: fixture.root.clone(),
        store_path: Some(fixture.manager.inner.store_path.clone()),
        worker_executable: None,
        managed_host: Some(managed),
    })
    .unwrap();
    assert_eq!(replacement.managed_identity(), replayed.managed_identity());
    assert_eq!(
        replacement.managed_identity().unwrap().operation_id,
        "operation-first-controlled-b"
    );
    let snapshot =
        nac_core::store::managed_maintenance_snapshot(&fixture.manager.inner.store_path).unwrap();
    assert_eq!(
        snapshot.state,
        nac_core::store::ManagedMaintenanceState::Maintenance
    );
    assert_eq!(
        snapshot.operation_id.as_deref(),
        Some("operation-first-controlled-b")
    );
    assert!(nac_core::store::accept_managed_forward_start(
        &fixture.manager.inner.store_path,
        replacement.managed_identity().unwrap(),
    )
    .unwrap());
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
