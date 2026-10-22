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
    cache_session_with_messages(f, manager, Vec::new(), None).await
}

async fn cache_session_with_messages(
    f: &Fixture,
    manager: &SessionManager,
    messages: Vec<nac_core::types::Message>,
    project_id: Option<String>,
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
        messages,
        None,
        Default::default(),
    );
    snapshot.behavior = nac_core::sessions::SessionBehavior::Direct;
    snapshot.project_id = project_id;
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

fn host_input(f: &Fixture, kind: &str) -> Value {
    let mut body = input(f, kind);
    body.as_object_mut().unwrap().remove("session_id");
    body
}

fn command_input(f: &Fixture, request_id: &str) -> Value {
    let mut body = input(f, "shell_command");
    body["observation"]["request_id"] = json!(request_id);
    body
}

fn journal_command(manager: &SessionManager, request_id: &str) -> Value {
    // Committed DATA fixture only: no command admission, process or model work.
    let snapshot = nac_core::session_service::ShellCommandSnapshot {
        request_id: request_id.into(),
        operation_id: "original-operation".into(),
        command: "fixture only".into(),
        timeout_ms: 30_000,
        state: nac_core::session_service::ShellCommandState::Started,
        accepted_at_epoch_ms: 1,
        finished_at_epoch_ms: None,
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        diagnostic: None,
        output_id: None,
        transcript_index: None,
    };
    let value = serde_json::to_value(snapshot).unwrap();
    rusqlite::Connection::open(&manager.inner.store_path).unwrap().execute(
        "INSERT INTO human_shell_operations(session_id,request_id,fingerprint,operation_id,phase,snapshot_json) VALUES ('session',?1,'private-fingerprint','original-operation','started',?2)",
        rusqlite::params![request_id, value.to_string()],
    ).unwrap();
    value
}

#[tokio::test]
async fn exact_command_readback_preserves_committed_identity_without_recovery_or_retry() {
    let f = Fixture::new();
    let manager = manager(&f);
    let service = cache_session(&f, &manager).await;
    let request_id = "request / + ü";
    let expected = journal_command(&manager, request_id);
    let serving = Serving::new(manager.clone()).await;
    for _ in 0..2 {
        let (status, body) = serving.send(&command_input(&f, request_id)).await;
        assert_eq!(status, 200, "{body}");
        assert_eq!(body, expected);
        assert!(body.get("fingerprint").is_none());
    }
    let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let (phase, snapshot): (String, String) = connection.query_row(
        "SELECT phase,snapshot_json FROM human_shell_operations WHERE session_id='session' AND request_id=?1",
        [request_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap();
    assert_eq!(phase, "started");
    assert_eq!(serde_json::from_str::<Value>(&snapshot).unwrap(), expected);
    assert!(!service.has_active_operation());
    let (status, _) = serving
        .send(&command_input(&f, "missing-original-request"))
        .await;
    assert_eq!(status, 404, "absence never authorizes another dispatch");
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM human_shell_operations", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    manager.inner.active_sessions.write().await.clear();
    assert_eq!(serving.send(&command_input(&f, request_id)).await.0, 503);
    assert!(manager.inner.active_sessions.read().await.is_empty());
    serving.close().await;
}

#[tokio::test]
async fn command_readback_refuses_wrong_target_stale_config_and_corrupt_identity() {
    let f = Fixture::new();
    let manager = manager(&f);
    let _service = cache_session(&f, &manager).await;
    journal_command(&manager, "same-request");
    let serving = Serving::new(manager.clone()).await;
    let mut wrong = command_input(&f, "same-request");
    wrong["target"]["host_incarnation_id"] = json!("replaced");
    assert_eq!(serving.send(&wrong).await.0, 409);
    for request_id in [String::new(), "x".repeat(129)] {
        assert_eq!(serving.send(&command_input(&f, &request_id)).await.0, 403);
    }
    let mut no_session = command_input(&f, "same-request");
    no_session.as_object_mut().unwrap().remove("session_id");
    assert_eq!(serving.send(&no_session).await.0, 403);
    let mut effect = command_input(&f, "same-request");
    effect["observation"]["command"] = json!("must never execute");
    assert_eq!(serving.send(&effect).await.0, 403);
    let connection = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    connection.execute("UPDATE human_shell_operations SET snapshot_json=json_set(snapshot_json,'$.request_id','different-request')", []).unwrap();
    assert_eq!(
        serving.send(&command_input(&f, "same-request")).await.0,
        503
    );
    connection.execute("UPDATE human_shell_operations SET snapshot_json=json_set(snapshot_json,'$.request_id','same-request')", []).unwrap();
    assert_eq!(
        serving.send(&command_input(&f, "same-request")).await.0,
        200
    );
    let config =
        nac_core::sessions::load_session_config(&manager.inner.store_path, "session").unwrap();
    nac_core::sessions::update_raw_session_config(&manager.inner.store_path, &config).unwrap();
    assert_eq!(
        serving.send(&command_input(&f, "same-request")).await.0,
        503
    );
    serving.close().await;
}

#[tokio::test]
async fn durable_indexes_preserve_real_cold_rows_without_attaching_or_probing() {
    let f = Fixture::new();
    let manager = manager(&f);
    f.register("index-project", f.config.repository_root.clone(), None);
    let mut snapshot = nac_core::sessions::new_snapshot(
        "cold-session".into(),
        f.root.clone(),
        "model".into(),
        "https://model.invalid/v1".into(),
        nac_core::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        None,
        Default::default(),
    );
    snapshot.project_id = Some("index-project".into());
    nac_core::sessions::create_session(&manager.inner.store_path, &snapshot).unwrap();
    let serving = Serving::new(manager.clone()).await;
    let (status, projects) = serving.send(&host_input(&f, "projects")).await;
    assert_eq!(status, 200, "{projects}");
    assert_eq!(
        projects["projects"],
        serde_json::to_value(manager.projects().list().unwrap()).unwrap()
    );
    assert_eq!(projects["projects"][0]["project_id"], "index-project");
    let mut query = host_input(&f, "sessions");
    query["observation"]["project_id"] = json!("index-project");
    let (status, sessions) = serving.send(&query).await;
    assert_eq!(status, 200, "{sessions}");
    assert_eq!(
        sessions,
        serde_json::to_value(
            manager
                .session_catalog()
                .list_for_project(false, Some("index-project"))
                .await
                .unwrap()
        )
        .unwrap()
    );
    assert_eq!(sessions[0]["summary"]["session_id"], "cold-session");
    assert_eq!(sessions[0]["active"], false);
    assert!(sessions[0].get("workspace_diff").is_none());
    query["observation"]["workspace_stats"] = json!(true);
    assert_eq!(serving.send(&query).await.0, 403);
    query["observation"]["workspace_stats"] = json!(false);
    query["observation"]["project_id"] = json!("other-project");
    assert_eq!(serving.send(&query).await.1, json!([]));
    let mut cold = input(&f, "snapshot");
    cold["session_id"] = json!("cold-session");
    assert_eq!(serving.send(&cold).await.0, 503);
    assert!(manager.inner.active_sessions.read().await.is_empty());
    serving.close().await;
}

#[tokio::test]
async fn cached_message_and_thread_pages_return_real_records_without_waking_work() {
    use nac_core::types::Message;
    let f = Fixture::new();
    let manager = manager(&f);
    let messages = vec![
        Message::System {
            content: "system".into(),
        },
        Message::User {
            content: "ask-one".into(),
        },
        serde_json::from_value(json!({"role":"assistant","content":"answer-one"})).unwrap(),
        Message::User {
            content: "ask-two".into(),
        },
        serde_json::from_value(json!({"role":"assistant","content":"answer-two"})).unwrap(),
    ];
    let service = cache_session_with_messages(&f, &manager, messages, None).await;
    for id in 1..=3 {
        let event = nac_core::events::AgentEvent::ThreadSteeringQueued {
            name: "worker".into(),
            steering_id: id,
            instruction_preview: format!("record-{id}"),
        };
        nac_core::store::ThreadEventWriter::new(&manager.inner.store_path)
            .unwrap()
            .append("session", "worker", &serde_json::to_string(&event).unwrap())
            .unwrap();
    }
    let queued = nac_core::store::create_session_inbox_item(
        &manager.inner.store_path,
        "session",
        nac_core::store::InboxDelivery::Queue,
        "remain queued",
        None,
        None,
    )
    .unwrap();
    let before = service.recent_events(None, 0).0;
    let serving = Serving::new(manager.clone()).await;
    let mut request = input(&f, "messages");
    request["observation"]["limit"] = json!(1);
    let (status, page) = serving.send(&request).await;
    assert_eq!(status, 200, "{page}");
    assert_eq!(page["messages"][0]["content"], "answer-two");
    assert_eq!(page["page"]["has_older"], true);
    assert!(page["created_at"].is_array());
    request["observation"]["before"] = page["page"]["start"].clone();
    let (status, older) = serving.send(&request).await;
    assert_eq!(status, 200, "{older}");
    assert_eq!(older["messages"][0]["content"], "ask-two");
    let mut thread = input(&f, "thread_events");
    thread["observation"]["thread_name"] = json!("worker");
    thread["observation"]["limit"] = json!(1);
    let (status, events) = serving.send(&thread).await;
    assert_eq!(status, 200, "{events}");
    assert_eq!(events["events"].as_array().unwrap().len(), 1);
    assert!(events["next_before_id"].is_i64());
    assert_eq!(events["events"][0]["event"]["steering_id"], 3);
    thread["observation"]["before_id"] = events["next_before_id"].clone();
    let (status, older) = serving.send(&thread).await;
    assert_eq!(status, 200, "{older}");
    assert_eq!(older["events"][0]["event"]["steering_id"], 2);
    assert_eq!(service.recent_events(None, 0).0, before);
    assert!(!service.has_active_operation());
    assert!(
        nac_core::store::list_session_inbox(&manager.inner.store_path, "session")
            .unwrap()
            .iter()
            .any(
                |item| item.id == queued.id && item.status == nac_core::store::InboxStatus::Pending
            )
    );
    manager.inner.active_sessions.write().await.clear();
    assert_eq!(serving.send(&request).await.0, 503);
    assert_eq!(serving.send(&thread).await.0, 503);
    assert!(manager.inner.active_sessions.read().await.is_empty());
    serving.close().await;
}

#[tokio::test]
async fn catalog_and_paging_shapes_refuse_cross_scope_and_background_operations() {
    let f = Fixture::new();
    let manager = manager(&f);
    let serving = Serving::new(manager).await;
    for kind in ["projects", "sessions"] {
        assert_eq!(serving.send(&input(&f, kind)).await.0, 403);
        let mut extra = host_input(&f, kind);
        extra["observation"]["ready"] = json!(true);
        assert_eq!(serving.send(&extra).await.0, 403);
    }
    for kind in [
        "managed_status",
        "workspace_stats",
        "store",
        "mcp_library",
        "ssh_configs",
        "create",
        "attach",
    ] {
        assert_eq!(serving.send(&host_input(&f, kind)).await.0, 403);
    }
    for kind in ["messages", "thread_events"] {
        let mut missing = host_input(&f, kind);
        if kind == "thread_events" {
            missing["observation"]["thread_name"] = json!("worker");
        }
        assert_eq!(serving.send(&missing).await.0, 403);
    }
    serving.close().await;
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
    for kind in ["projects", "sessions"] {
        assert_eq!(serving.send(&host_input(&f, kind)).await.0, 200);
    }
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

#[path = "managed_session_existing_source_tests.rs"]
mod existing_source;
