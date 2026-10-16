use super::*;
use crate::application::managed_locations::tests::Fixture;
use crate::delivery::managed_runtime_tls::tests::{exchange, identity};
use serde_json::{json, Value};
use tokio::sync::oneshot;
use tower::ServiceExt;

pub(crate) fn manager(f: &Fixture) -> SessionManager {
    let mut config = f.config.clone();
    config.version = nac_managed::MANAGED_CONFIG_VERSION;
    config.managed_control_bind = Some("127.0.0.1:3211".into());
    config.managed_control_issuer = Some("https://control.example.test".into());
    config.managed_control_jwks_file = Some(f.root.join("controller-jwks.json"));
    let manager = SessionManager::new_unowned_fixture(crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(f.root.join("store.db")),
        worker_executable: None,
        managed_host: Some(config),
    })
    .unwrap();
    nac_core::store::initialize(&manager.inner.store_path).unwrap();
    manager
}

fn input(f: &Fixture) -> Value {
    json!({"schema": MANAGED_HOST_OBSERVATION_PURPOSE,
        "purpose": MANAGED_HOST_OBSERVATION_PURPOSE, "request_id":"observation",
        "target":{"logical_host_id":f.config.logical_host_id,
            "host_incarnation_id":f.config.host_incarnation_id}})
}

fn headers() -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", "application/json".into()),
        ("Accept", "application/json".into()),
        ("X-NAC-Request-ID", "observation".into()),
        (
            "X-NAC-Expires-At-Epoch-Ms",
            (utc_epoch_ms().unwrap() + 30_000).to_string(),
        ),
    ]
}

struct Serving {
    address: std::net::SocketAddr,
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<anyhow::Result<()>>,
}
impl Serving {
    async fn new(manager: SessionManager) -> Self {
        let listener = RuntimeTlsListener::bind("127.0.0.1:0".parse().unwrap(), identity())
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (stop, done) = oneshot::channel();
        let task = tokio::spawn(serve_managed_location_facts(listener, manager, async {
            let _ = done.await;
        }));
        Self {
            address,
            stop,
            task,
        }
    }
    async fn send(&self, body: &[u8], headers: &[(&str, String)]) -> (u16, Value) {
        exchange(
            self.address,
            Some("d-service"),
            "POST",
            MANAGED_HOST_OBSERVATION_PATH,
            body,
            headers,
        )
        .await
        .unwrap()
    }
    async fn close(self) {
        self.stop.send(()).unwrap();
        self.task.await.unwrap().unwrap();
    }
}

#[tokio::test]
async fn pinned_service_observes_actual_sanitized_binding_without_writes() {
    let f = Fixture::new();
    let manager = manager(&f);
    let expected = manager.managed_location_binding().unwrap();
    let store = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let before: i64 = store
        .query_row("SELECT count(*) FROM managed_control_attempts", [], |r| {
            r.get(0)
        })
        .unwrap();
    let serving = Serving::new(manager).await;
    let (status, reply) = serving
        .send(&serde_json::to_vec(&input(&f)).unwrap(), &headers())
        .await;
    assert_eq!(status, 200, "{reply}");
    assert_eq!(reply["binding"], serde_json::to_value(expected).unwrap());
    assert_eq!(reply["replacement_state"], "configured");
    assert_eq!(reply["store_ready"], true);
    assert!(reply.get("ready").is_none());
    assert_eq!(reply["maintenance_state"], "serving");
    assert_eq!(reply["migration_state"], "current");
    assert!(reply["opened_schema_version"].is_i64());
    let text = reply.to_string();
    assert!(!text.contains(f.root.to_str().unwrap()));
    for key in [
        "repository_root",
        "canonical_cwd",
        "directory_identity",
        "authority_epoch",
        "token",
        "principal",
    ] {
        assert!(!text.contains(key), "unexpected output: {key}");
    }
    assert_eq!(
        store
            .query_row("SELECT count(*) FROM managed_control_attempts", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
        before
    );
    serving.close().await;
}

#[tokio::test]
async fn original_replacement_guard_is_retained_until_snapshot_release() {
    let f = Fixture::new();
    let manager = manager(&f);
    let path = manager.inner.store_path.clone();
    let snapshot = crate::managed_status::managed_binding_snapshot(manager)
        .await
        .unwrap();
    assert!(nac_core::sessions::HostMaintenanceLease::try_acquire(&path).is_err());
    drop(snapshot);
    assert!(nac_core::sessions::HostMaintenanceLease::try_acquire(&path).is_ok());
}

#[tokio::test]
async fn durable_replacement_refuses_old_serving_identity() {
    let f = Fixture::new();
    let manager = manager(&f);
    let mut replacement = manager.managed_identity().unwrap().clone();
    replacement.operation_id = "replacement-operation".into();
    replacement.host_incarnation_id = "replacement-incarnation".into();
    // Install a different committed identity in this isolated fixture to model
    // a replacement accepted by another process, without starting any work.
    let store = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    store
        .execute(
            "UPDATE managed_host_maintenance SET accepted_identity_json=?1 WHERE singleton=1",
            [serde_json::to_string(&replacement).unwrap()],
        )
        .unwrap();
    assert!(crate::managed_status::managed_binding_snapshot(manager)
        .await
        .is_err());
}

#[tokio::test]
async fn accepted_observation_cannot_downgrade_after_record_disappears() {
    let f = Fixture::new();
    let manager = manager(&f);
    let path = manager.inner.store_path.clone();
    let mut identity = manager.managed_identity().unwrap().clone();
    assert!(!nac_core::store::observe_managed_probe_acceptance(&path, &identity).unwrap());
    identity.operation_id = "accepted-operation".into();
    assert!(nac_core::store::observe_managed_probe_acceptance(&path, &identity).is_err());
    let store = rusqlite::Connection::open(&path).unwrap();
    store
        .execute(
            "UPDATE managed_host_maintenance SET accepted_identity_json=?1 WHERE singleton=1",
            [serde_json::to_string(&identity).unwrap()],
        )
        .unwrap();
    assert!(nac_core::store::observe_managed_probe_acceptance(&path, &identity).unwrap());
    store
        .execute(
            "UPDATE managed_host_maintenance SET accepted_identity_json=NULL WHERE singleton=1",
            [],
        )
        .unwrap();
    assert!(nac_core::store::observe_managed_probe_acceptance(&path, &identity).is_err());
}

#[tokio::test]
async fn stale_target_and_wrong_or_unknown_fields_are_refused() {
    let f = Fixture::new();
    let serving = Serving::new(manager(&f)).await;
    let mut wrong = input(&f);
    wrong["target"]["host_incarnation_id"] = json!("stale");
    assert_eq!(
        serving
            .send(&serde_json::to_vec(&wrong).unwrap(), &headers())
            .await
            .0,
        409
    );
    for key in ["schema", "purpose", "request_id"] {
        let mut wrong = input(&f);
        wrong[key] = json!("different");
        assert_eq!(
            serving
                .send(&serde_json::to_vec(&wrong).unwrap(), &headers())
                .await
                .0,
            403
        );
    }
    let mut wrong = input(&f);
    wrong["target"]["principal"] = json!("not-an-authority");
    assert_eq!(
        serving
            .send(&serde_json::to_vec(&wrong).unwrap(), &headers())
            .await
            .0,
        403
    );
    let duplicate = serde_json::to_string(&input(&f)).unwrap().replacen(
        "{",
        "{\"request_id\":\"observation\",",
        1,
    );
    assert_eq!(serving.send(duplicate.as_bytes(), &headers()).await.0, 403);
    serving.close().await;
}

#[tokio::test]
async fn expiry_and_browser_authorization_headers_cannot_select_observation() {
    let f = Fixture::new();
    let serving = Serving::new(manager(&f)).await;
    let body = serde_json::to_vec(&input(&f)).unwrap();
    let mut expired = headers();
    expired[3].1 = (utc_epoch_ms().unwrap() - 1).to_string();
    assert_eq!(serving.send(&body, &expired).await.0, 403);
    for name in ["authorization", "cookie", "origin", "x-nac-operation-id"] {
        let mut wrong = headers();
        wrong.push((name, "not-authority".into()));
        assert_eq!(serving.send(&body, &wrong).await.0, 403);
    }
    serving.close().await;
}

#[tokio::test]
async fn observation_is_unavailable_to_plaintext_router_and_wrong_tls_peer() {
    let f = Fixture::new();
    let manager = manager(&f);
    let body = serde_json::to_vec(&input(&f)).unwrap();
    let request = || {
        axum::http::Request::builder()
            .method("POST")
            .uri(MANAGED_HOST_OBSERVATION_PATH)
            .header("x-forwarded-client-cert", "d-service")
            .body(axum::body::Body::from(body.clone()))
            .unwrap()
    };
    assert_eq!(
        router(manager.clone())
            .oneshot(request())
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        crate::router(manager.clone())
            .oneshot(request())
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
    let serving = Serving::new(manager).await;
    assert!(exchange(
        serving.address,
        None,
        "POST",
        MANAGED_HOST_OBSERVATION_PATH,
        &body,
        &headers()
    )
    .await
    .is_err());
    assert!(exchange(
        serving.address,
        Some("wrong-peer"),
        "POST",
        MANAGED_HOST_OBSERVATION_PATH,
        &body,
        &headers()
    )
    .await
    .is_err());
    serving.close().await;
}
