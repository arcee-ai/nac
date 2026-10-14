use super::*;
use crate::application::managed_locations::tests::Fixture;
use crate::delivery::managed_runtime_tls::tests::{exchange, identity};
use serde_json::{json, Value};
use tokio::sync::oneshot;
use tower::ServiceExt;

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
    async fn close(self) {
        self.stop.send(()).unwrap();
        self.task.await.unwrap().unwrap();
    }
    async fn send(&self, body: &Value) -> (u16, Value) {
        self.send_with(body, &headers()).await
    }
    async fn send_with(&self, body: &Value, headers: &[(&str, String)]) -> (u16, Value) {
        exchange(
            self.address,
            Some("d-service"),
            "POST",
            MANAGED_LOCATION_FACT_PATH,
            &serde_json::to_vec(body).unwrap(),
            headers,
        )
        .await
        .unwrap()
    }
}
fn headers() -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", "application/json".into()),
        ("Accept", "application/json".into()),
        ("X-NAC-Request-ID", "request".into()),
        (
            "X-NAC-Expires-At-Epoch-Ms",
            (utc_epoch_ms().unwrap() + 30_000).to_string(),
        ),
    ]
}
fn request(fixture: &Fixture) -> Value {
    json!({"schema":MANAGED_LOCATION_FACT_PURPOSE,"purpose":MANAGED_LOCATION_FACT_PURPOSE,"request_id":"request","action":"observe","target":fixture.manager.managed_location_binding().unwrap(),"selector":{"kind":"repository_root"}})
}

#[tokio::test]
async fn actual_pinned_d_peer_observes_and_resolves_exact_private_fact() {
    let f = Fixture::new();
    let serving = Serving::new(f.manager.clone()).await;
    let mut body = request(&f);
    let (status, reply) = serving.send(&body).await;
    assert_eq!(status, 200);
    assert_eq!(reply["request_id"], "request");
    assert_eq!(reply["action"], "observe");
    assert!(reply["fact"]["project"].is_null());
    let native = f
        .manager
        .managed_location_fact(ManagedLocationSelector::RepositoryRoot)
        .await
        .unwrap();
    assert_eq!(reply["fact"], serde_json::to_value(native).unwrap());
    body["action"] = json!("resolve");
    body["prior_fact"] = reply["fact"].clone();
    let (status, resolved) = serving.send(&body).await;
    assert_eq!(status, 200);
    assert_eq!(resolved["fact"], reply["fact"]);
    std::fs::rename(&f.config.repository_root, f.root.join("old-repositories")).unwrap();
    std::fs::create_dir(&f.config.repository_root).unwrap();
    let (status, changed) = serving.send(&body).await;
    assert_eq!(status, 409);
    assert_eq!(changed["error"], "changed");
    assert!(changed.get("fact").is_none());
    serving.close().await;
}

#[tokio::test]
async fn transport_marker_and_fact_route_are_not_available_on_plain_native_router() {
    let f = Fixture::new();
    let body = request(&f);
    let plain = router(f.manager.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(MANAGED_LOCATION_FACT_PATH)
                .header("x-forwarded-client-cert", "d-service")
                .header("x-nac-request-id", "request")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(plain.status(), StatusCode::FORBIDDEN);
    let ordinary = crate::router(f.manager.clone())
        .oneshot(
            axum::http::Request::builder()
                .method("POST")
                .uri(MANAGED_LOCATION_FACT_PATH)
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(ordinary.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn wrong_purpose_current_target_selector_and_shape_are_refused_before_lookup() {
    let f = Fixture::new();
    let serving = Serving::new(f.manager.clone()).await;
    let base = request(&f);
    let mut bad = base.clone();
    bad["purpose"] = json!("maintenance");
    assert_eq!(serving.send(&bad).await.0, 403);
    for key in [
        "logical_host_id",
        "host_incarnation_id",
        "configured_owner",
        "release_id",
        "product_version",
        "build_id",
        "source_revision",
        "build_track",
    ] {
        let mut bad = base.clone();
        bad["target"][key] = json!("different");
        bad["selector"] = json!({"kind":"registered_project","project_id":"missing"});
        assert_eq!(
            serving.send(&bad).await.0,
            403,
            "target mismatch must fail before missing project lookup: {key}"
        );
    }
    let mut bad = base.clone();
    bad["target"]["supported_schema_version"] = json!(999);
    assert_eq!(serving.send(&bad).await.0, 403);
    for extra in [
        json!({"kind":"repository_root","cwd":"/private"}),
        json!({"kind":"repository_root","project_id":"ignored"}),
    ] {
        let mut bad = base.clone();
        bad["selector"] = extra;
        assert_eq!(serving.send(&bad).await.0, 403);
    }
    let mut bad = base.clone();
    bad["verified"] = json!(true);
    assert_eq!(serving.send(&bad).await.0, 403);
    let mut bad = base.clone();
    bad["prior_fact"] = Value::Null;
    assert_eq!(serving.send(&bad).await.0, 403);
    let mut bad = base.clone();
    bad["action"] = json!("resolve");
    assert_eq!(serving.send(&bad).await.0, 403);
    let mut bad = base.clone();
    bad["request_id"] = json!("different");
    assert_eq!(serving.send(&bad).await.0, 403);
    serving.close().await;
}

#[tokio::test]
async fn required_nullable_project_duplicate_fields_and_exact_stat_integers_are_enforced() {
    let f = Fixture::new();
    let serving = Serving::new(f.manager.clone()).await;
    let mut body = request(&f);
    let (_, reply) = serving.send(&body).await;
    body["action"] = json!("resolve");
    body["prior_fact"] = reply["fact"].clone();
    body["prior_fact"]
        .as_object_mut()
        .unwrap()
        .remove("project");
    assert_eq!(serving.send(&body).await.0, 403);
    body["prior_fact"] = reply["fact"].clone();
    body["prior_fact"]["directory_identity"]["inode"] = json!(u64::MAX);
    assert_eq!(
        serving.send(&body).await.0,
        409,
        "full u64 parsed exactly and mismatched fact rejected"
    );
    body["prior_fact"]["directory_identity"]["inode"] = json!("18446744073709551615");
    assert_eq!(serving.send(&body).await.0, 403);
    let raw = serde_json::to_string(&request(&f)).unwrap().replace(
        "\"request_id\":\"request\"",
        "\"request_id\":\"request\",\"request_id\":\"request\"",
    );
    let (status, _) = exchange(
        serving.address,
        Some("d-service"),
        "POST",
        MANAGED_LOCATION_FACT_PATH,
        raw.as_bytes(),
        &headers(),
    )
    .await
    .unwrap();
    assert_eq!(status, 403);
    serving.close().await;
}

#[tokio::test]
async fn original_d_expiry_single_headers_and_forbidden_forwarded_credentials_are_enforced() {
    let f = Fixture::new();
    let serving = Serving::new(f.manager.clone()).await;
    let body = request(&f);
    for value in [
        "-1".into(),
        "01".into(),
        "1e20".into(),
        "9223372036854775808".into(),
        " 123".into(),
        "123 ".into(),
        (utc_epoch_ms().unwrap() - 1).to_string(),
        (utc_epoch_ms().unwrap() + 120_000).to_string(),
    ] {
        let mut h = headers();
        h[3].1 = value;
        assert_eq!(serving.send_with(&body, &h).await.0, 403);
    }
    for name in ["X-NAC-Expires-At-Epoch-Ms", "X-NAC-Request-ID"] {
        let mut h = headers();
        let value = h.iter().find(|(n, _)| *n == name).unwrap().1.clone();
        h.push((name, value));
        assert_eq!(serving.send_with(&body, &h).await.0, 403);
    }
    for name in [
        "Authorization",
        "Cookie",
        "Origin",
        "X-NAC-Operation-ID",
        "X-NAC-Operation-Expires-At-Epoch-MS",
    ] {
        let mut h = headers();
        h.push((name, "not authority".into()));
        assert_eq!(serving.send_with(&body, &h).await.0, 403);
    }
    let mut h = headers();
    h.pop();
    assert_eq!(serving.send_with(&body, &h).await.0, 403);
    serving.close().await;
}

#[tokio::test]
async fn body_wait_is_capped_by_original_authenticated_d_deadline() {
    use crate::delivery::managed_runtime_tls::tests::client;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let f = Fixture::new();
    let serving = Serving::new(f.manager.clone()).await;
    let mut stream = client(serving.address, Some("d-service")).await.unwrap();
    let expires = utc_epoch_ms().unwrap() + 100;
    let head=format!("POST {MANAGED_LOCATION_FACT_PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 100\r\nContent-Type: application/json\r\nAccept: application/json\r\nX-NAC-Request-ID: request\r\nX-NAC-Expires-At-Epoch-Ms: {expires}\r\n\r\n");
    stream.write_all(head.as_bytes()).await.unwrap();
    let mut reply = vec![0; 4096];
    let n = tokio::time::timeout(Duration::from_secs(2), stream.read(&mut reply))
        .await
        .unwrap()
        .unwrap();
    let text = String::from_utf8_lossy(&reply[..n]);
    assert!(
        text.contains("503") || text.contains("403"),
        "expired body wait must not produce a fact: {text}"
    );
    assert!(!text.contains("canonical_cwd"));
    drop(stream);
    serving.close().await;
}
