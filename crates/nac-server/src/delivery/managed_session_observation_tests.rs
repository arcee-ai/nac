use super::*;
use crate::application::managed_locations::tests::Fixture;
use crate::delivery::managed_location_facts::host_observation::tests::manager;
use crate::delivery::managed_runtime_tls::tests::{client, exchange, identity};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
};
use tower::ServiceExt;

fn input(f: &Fixture, kind: &str) -> Value {
    json!({"schema":MANAGED_SESSION_OBSERVATION_PURPOSE,
        "purpose":MANAGED_SESSION_OBSERVATION_PURPOSE,"request_id":"passive",
        "target":{"logical_host_id":f.config.logical_host_id,"host_incarnation_id":f.config.host_incarnation_id},
        "session_id":"session","observation":{"kind":kind}})
}

fn ui_input(f: &Fixture) -> Value {
    let mut body = input(f, "ui_configuration");
    body.as_object_mut().unwrap().remove("session_id");
    body
}

fn headers(stream: bool, milliseconds: i64) -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", "application/json".into()),
        (
            "Accept",
            if stream {
                "text/event-stream"
            } else {
                "application/json"
            }
            .into(),
        ),
        ("X-NAC-Request-ID", "passive".into()),
        (
            "X-NAC-Expires-At-Epoch-Ms",
            (utc_epoch_ms().unwrap() + milliseconds).to_string(),
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
    async fn send(&self, body: &Value) -> (u16, Value) {
        exchange(
            self.address,
            Some("d-service"),
            "POST",
            MANAGED_SESSION_OBSERVATION_PATH,
            &serde_json::to_vec(body).unwrap(),
            &headers(false, 30_000),
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
async fn ui_bootstrap_returns_actual_captured_policy_without_a_session() {
    let f = Fixture::new();
    let manager = manager(&f);
    let expected = crate::delivery::ui_configuration::UiConfiguration::from_environment();
    let serving = Serving::new(manager.clone()).await;
    let (status, body) = serving.send(&ui_input(&f)).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body, serde_json::to_value(expected).unwrap());
    assert!(body["orchestration_enabled"].is_boolean());
    assert!(body["diagnostic"].is_null() || body["diagnostic"].is_string());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    for kind in ["snapshot", "events"] {
        assert_eq!(serving.send(&input(&f, kind)).await.0, 503);
    }
    assert!(manager.inner.active_sessions.read().await.is_empty());
    serving.close().await;
}

#[tokio::test]
async fn ui_bootstrap_rejects_session_selectors_and_malformed_cross_operation_shapes() {
    let f = Fixture::new();
    let manager = manager(&f);
    let serving = Serving::new(manager).await;
    assert_eq!(serving.send(&input(&f, "ui_configuration")).await.0, 403);
    let mut null_session = ui_input(&f);
    null_session["session_id"] = Value::Null;
    assert_eq!(serving.send(&null_session).await.0, 403);
    for kind in ["snapshot", "events", "stream"] {
        let mut body = input(&f, kind);
        body.as_object_mut().unwrap().remove("session_id");
        assert_eq!(serving.send(&body).await.0, 403);
    }
    let mut extra = ui_input(&f);
    extra["observation"]["orchestration_enabled"] = json!(true);
    assert_eq!(serving.send(&extra).await.0, 403);
    let mut stale = ui_input(&f);
    stale["target"]["host_incarnation_id"] = json!("old");
    assert_eq!(serving.send(&stale).await.0, 409);
    let mut wrong = ui_input(&f);
    wrong["request_id"] = json!("other");
    assert_eq!(serving.send(&wrong).await.0, 403);
    for forbidden in ["Authorization", "Cookie", "Origin"] {
        let mut h = headers(false, 30_000);
        h.push((forbidden, "forbidden".into()));
        assert_eq!(
            exchange(
                serving.address,
                Some("d-service"),
                "POST",
                MANAGED_SESSION_OBSERVATION_PATH,
                &serde_json::to_vec(&ui_input(&f)).unwrap(),
                &h
            )
            .await
            .unwrap()
            .0,
            403
        );
    }
    assert_eq!(
        exchange(
            serving.address,
            Some("d-service"),
            "POST",
            MANAGED_SESSION_OBSERVATION_PATH,
            &serde_json::to_vec(&ui_input(&f)).unwrap(),
            &headers(false, 0)
        )
        .await
        .unwrap()
        .0,
        403
    );
    serving.close().await;
}

async fn cache_session(
    f: &Fixture,
    manager: &SessionManager,
) -> std::sync::Arc<nac_core::session_service::SessionService> {
    let path = manager.inner.store_path.clone();
    let mut snapshot = nac_core::sessions::new_snapshot(
        "session".into(),
        f.root.clone(),
        "gpt-5.5".into(),
        "https://model.invalid/v1".into(),
        nac_core::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        vec![],
        None,
        Default::default(),
    );
    snapshot.behavior = nac_core::sessions::SessionBehavior::Direct;
    let create_path = path.clone();
    manager
        .inner
        ._store_ownership
        .call_legacy(move || nac_core::sessions::create_session(&create_path, &snapshot))
        .await
        .unwrap()
        .unwrap();
    let key = f.root.join("synthetic-model-key");
    std::fs::write(&key, "synthetic-test-key").unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&key, std::fs::Permissions::from_mode(0o600)).unwrap();
    let (config, _, _) = nac_core::runtime::build_resume_config_for_session_attachment(
        path,
        "session",
        &nac_core::runtime::NacConfig::default(),
        f.root.clone(),
        None,
        nac_core::runtime::ResumeModelOptions {
            trusted_api_key_file: Some(key),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let service = std::sync::Arc::new(
        nac_core::session_service::SessionService::from_orchestrator_run_config(config).service,
    );
    manager
        .inner
        .active_sessions
        .write()
        .await
        .insert("session".into(), service.clone());
    service
}

#[tokio::test]
async fn sdk_boundary_snapshot_replay_sequence_never_attaches_or_starts_work() {
    let f = Fixture::new();
    let manager = manager(&f);
    let service = cache_session(&f, &manager).await;
    let before = service.recent_events(None, 0).0;
    let serving = Serving::new(manager.clone()).await;
    let mut baseline = input(&f, "events");
    baseline["observation"]["limit"] = json!(0);
    let (status, body) = serving.send(&baseline).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["boundary"], serde_json::to_value(&before).unwrap());
    assert_eq!(body["events"], json!([]));
    let (status, snapshot) = serving.send(&input(&f, "snapshot")).await;
    assert_eq!(status, 200, "{snapshot}");
    assert_eq!(
        snapshot["workspace"]["error"],
        "workspace inspection unavailable in passive observation"
    );
    for field in [
        "metadata",
        "messages",
        "response_timing",
        "sessions",
        "thread_episodes",
        "thread_event_boundary",
        "threads",
        "worksets",
        "workspace",
    ] {
        assert!(snapshot.get(field).is_some(), "missing{field}");
    }
    let mut replay = input(&f, "events");
    replay["observation"]["cursor"] = body["boundary"].clone();
    let (status, events) = serving.send(&replay).await;
    assert_eq!(status, 200, "{events}");
    assert_eq!(service.recent_events(None, 0).0, before);
    assert!(!service.has_active_operation());
    assert!(std::sync::Arc::ptr_eq(
        manager
            .inner
            .active_sessions
            .read()
            .await
            .get("session")
            .unwrap(),
        &service
    ));
    serving.close().await;
}

#[tokio::test]
async fn unsupported_workspace_operations_and_changed_owner_refuse() {
    let f = Fixture::new();
    let manager = manager(&f);
    let service = cache_session(&f, &manager).await;
    let serving = Serving::new(manager.clone()).await;
    for kind in [
        "workspace",
        "files",
        "diff",
        "revision",
        "git",
        "ssh",
        "attach",
        "resume",
    ] {
        assert_eq!(serving.send(&input(&f, kind)).await.0, 403);
    }
    for path in [
        "/sessions/session",
        "/sessions/session/events/stream",
        "/sessions/session/workspace/files",
    ] {
        assert_eq!(
            exchange(
                serving.address,
                Some("d-service"),
                "GET",
                path,
                b"",
                &headers(false, 30_000)
            )
            .await
            .unwrap()
            .0,
            404
        );
    }
    let config =
        nac_core::sessions::load_session_config(&manager.inner.store_path, "session").unwrap();
    nac_core::sessions::update_raw_session_config(&manager.inner.store_path, &config).unwrap();
    for kind in ["snapshot", "events"] {
        assert_eq!(serving.send(&input(&f, kind)).await.0, 503);
    }
    assert!(!service.has_active_operation());
    serving.close().await;
}

#[tokio::test]
async fn passive_snapshot_uses_the_actual_owned_store_executor() {
    let f = Fixture::new();
    let unowned = manager(&f);
    let options = crate::ServerOptions {
        root_cwd: f.root.clone(),
        store_path: Some(unowned.inner.store_path.clone()),
        worker_executable: None,
        managed_host: unowned.managed_host().cloned(),
    };
    drop(unowned);
    let manager =
        nac_core::store::spawn_blocking_store_caller(move || SessionManager::new(options))
            .await
            .unwrap()
            .unwrap();
    assert!(manager.inner._store_ownership.coordinator().is_some());
    let service = cache_session(&f, &manager).await;
    let serving = Serving::new(manager.clone()).await;
    let (status, body) = serving.send(&input(&f, "snapshot")).await;
    assert_eq!(status, 200, "{body}");
    assert!(!service.has_active_operation());
    serving.close().await;
    manager.inner._store_ownership.drain().await.unwrap();
}

#[tokio::test]
async fn original_snapshot_worker_keeps_guard_after_waiter_is_cancelled() {
    let f = Fixture::new();
    let manager = manager(&f);
    let binding = crate::managed_status::managed_binding_snapshot(manager.clone())
        .await
        .unwrap();
    let (started, begun) = oneshot::channel();
    let (finish, ending) = std::sync::mpsc::channel();
    let (released, done) = oneshot::channel();
    let task = tokio::spawn(crate::managed_status::run_probe(move || {
        let _binding = binding;
        started.send(()).unwrap();
        ending.recv().unwrap();
        drop(_binding);
        released.send(()).unwrap();
    }));
    begun.await.unwrap();
    task.abort();
    let _ = task.await;
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
    finish.send(()).unwrap();
    done.await.unwrap();
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_ok()
    );
}

#[tokio::test]
async fn shutdown_closes_passive_stream_without_waiting_for_deadline() {
    let f = Fixture::new();
    let manager = manager(&f);
    let _service = cache_session(&f, &manager).await;
    let serving = Serving::new(manager.clone()).await;
    let body = serde_json::to_vec(&input(&f, "stream")).unwrap();
    let mut connection = client(serving.address, Some("d-service")).await.unwrap();
    let mut request=format!("POST {MANAGED_SESSION_OBSERVATION_PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n",body.len());
    for (name, value) in headers(true, 30_000) {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    connection.write_all(request.as_bytes()).await.unwrap();
    connection.write_all(&body).await.unwrap();
    let mut head = vec![0; 8192];
    let count = connection.read(&mut head).await.unwrap();
    assert!(String::from_utf8_lossy(&head[..count]).contains("200 OK"));
    let Serving { stop, task, .. } = serving;
    stop.send(()).unwrap();
    let mut rest = Vec::new();
    tokio::time::timeout(Duration::from_secs(2), connection.read_to_end(&mut rest))
        .await
        .unwrap()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_ok()
    );
}

#[tokio::test]
async fn missing_cached_owner_refuses_all_observations_without_attachment() {
    let f = Fixture::new();
    let manager = manager(&f);
    let _service = cache_session(&f, &manager).await;
    manager.inner.active_sessions.write().await.clear();
    let serving = Serving::new(manager.clone()).await;
    for kind in ["snapshot", "events", "stream"] {
        let (status, _) = exchange(
            serving.address,
            Some("d-service"),
            "POST",
            MANAGED_SESSION_OBSERVATION_PATH,
            &serde_json::to_vec(&input(&f, kind)).unwrap(),
            &headers(kind == "stream", 30_000),
        )
        .await
        .unwrap();
        assert_eq!(status, 503);
        assert!(manager.inner.active_sessions.read().await.is_empty());
    }
    serving.close().await;
}

#[tokio::test]
async fn stream_keeps_native_frames_expires_and_releases_original_guard() {
    let f = Fixture::new();
    let manager = manager(&f);
    let service = cache_session(&f, &manager).await;
    let serving = Serving::new(manager.clone()).await;
    let body = serde_json::to_vec(&input(&f, "stream")).unwrap();
    let mut connection = client(serving.address, Some("d-service")).await.unwrap();
    let mut request=format!("POST {MANAGED_SESSION_OBSERVATION_PATH} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: {}\r\n",body.len());
    for (name, value) in headers(true, 800) {
        request.push_str(&format!("{name}: {value}\r\n"));
    }
    request.push_str("\r\n");
    connection.write_all(request.as_bytes()).await.unwrap();
    connection.write_all(&body).await.unwrap();
    let mut first = vec![0; 8192];
    let count = connection.read(&mut first).await.unwrap();
    let head = String::from_utf8_lossy(&first[..count]);
    assert!(head.contains("200 OK"), "{head}");
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_err()
    );
    let mut rest = Vec::new();
    tokio::time::timeout(Duration::from_secs(3), connection.read_to_end(&mut rest))
        .await
        .unwrap()
        .unwrap();
    let all = format!("{}{}", head, String::from_utf8_lossy(&rest));
    assert!(all.contains("event: replay_boundary"), "{all}");
    assert!(all.contains("\"replay_boundary_sequence_id\":0"));
    assert!(
        nac_core::sessions::HostMaintenanceLease::try_acquire(&manager.inner.store_path).is_ok()
    );
    assert!(!service.has_active_operation());
    serving.close().await;
}

#[tokio::test]
async fn closed_envelope_and_peer_checks_refuse_before_observation() {
    let f = Fixture::new();
    let manager = manager(&f);
    let response = super::super::router(manager.clone())
        .oneshot(
            axum::http::Request::post(MANAGED_SESSION_OBSERVATION_PATH)
                .header("content-type", "application/json")
                .body(axum::body::Body::from(input(&f, "snapshot").to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let serving = Serving::new(manager).await;
    let mut malformed = input(&f, "events");
    malformed["observation"]["cursor"] = json!({"epoch_id":"epoch","sequence_id":0,"extra":true});
    assert_eq!(serving.send(&malformed).await.0, 403);
    let mut stale = input(&f, "events");
    stale["target"]["host_incarnation_id"] = json!("stale");
    assert_eq!(serving.send(&stale).await.0, 409);
    let mut wrong = input(&f, "events");
    wrong["purpose"] = json!("wrong");
    assert_eq!(serving.send(&wrong).await.0, 403);
    for peer in [None, Some("wrong-peer")] {
        assert!(exchange(
            serving.address,
            peer,
            "POST",
            MANAGED_SESSION_OBSERVATION_PATH,
            &serde_json::to_vec(&input(&f, "events")).unwrap(),
            &headers(false, 30_000)
        )
        .await
        .is_err());
    }
    serving.close().await;
}
