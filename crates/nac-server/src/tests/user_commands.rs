use super::*;

const SESSION: &str = "direct";
const HELD_COMMAND: &str = "echo run; sleep 30";

struct Fixture {
    root: PathBuf,
    manager: SessionManager,
    app: Router,
    _env: ScopedModelEnv,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let root = temp_root(label);
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let env = ScopedModelEnv::isolated(&nac_home, Some("user-command-model-key"));
        seed_direct_session(&root, SESSION);
        let manager = test_manager(&root);
        let app = router(manager.clone());
        Self {
            root,
            manager,
            app,
            _env: env,
        }
    }

    async fn wait_for_spawn(&self, request_id: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let (_, body) = get_json(self.app.clone(), &command_uri(SESSION, request_id)).await;
                if body["state"] == "executing" {
                    break;
                }
                assert_eq!(body["state"], "admitted", "{body}");
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("held command should start");
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn command_uri(session_id: &str, request_id: &str) -> String {
    format!("/sessions/{session_id}/user-commands/{request_id}")
}

async fn submit(
    app: Router,
    session_id: &str,
    body: serde_json::Value,
) -> (StatusCode, serde_json::Value) {
    let response = post_json(app, &format!("/sessions/{session_id}/user-commands"), body).await;
    let status = response.status();
    (status, response_json(response).await)
}

async fn get_json(app: Router, uri: &str) -> (StatusCode, serde_json::Value) {
    let response = get_response(app, uri, None).await;
    let status = response.status();
    (status, response_json(response).await)
}

async fn cancel(
    app: Router,
    session_id: &str,
    request_id: &str,
) -> (StatusCode, serde_json::Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("{}/cancel", command_uri(session_id, request_id)))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    (status, response_json(response).await)
}

async fn wait_for_terminal(app: Router, session_id: &str, request_id: &str) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let (status, body) = get_json(app.clone(), &command_uri(session_id, request_id)).await;
            assert_eq!(status, StatusCode::OK, "{body}");
            if !matches!(body["state"].as_str(), Some("admitted" | "executing")) {
                return body;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("user command should settle")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_same_request_from_two_clients_shares_one_admission_and_spawn() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_same_request");
    let body = serde_json::json!({"request_id": "req-1", "command": HELD_COMMAND});

    let first = tokio::spawn(submit(fixture.app.clone(), SESSION, body.clone()));
    let second = tokio::spawn(submit(fixture.app.clone(), SESSION, body.clone()));
    let (first, second) = (first.await.unwrap(), second.await.unwrap());
    let mut statuses = [first.0, second.0];
    statuses.sort();
    assert_eq!(
        statuses,
        [StatusCode::OK, StatusCode::ACCEPTED],
        "{first:?} {second:?}"
    );
    for (_, snapshot) in [&first, &second] {
        assert_eq!(snapshot["request_id"], "req-1");
        assert_eq!(snapshot["command"], body["command"]);
        assert_eq!(snapshot["timeout_ms"], 30_000);
    }

    fixture.wait_for_spawn("req-1").await;
    let (status, replayed) = submit(fixture.app.clone(), SESSION, body.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replayed["request_id"], "req-1");

    let (status, _) = cancel(fixture.app.clone(), SESSION, "req-1").await;
    assert_eq!(status, StatusCode::OK);
    let settled = wait_for_terminal(fixture.app.clone(), SESSION, "req-1").await;
    assert_eq!(settled["state"], "cancelled");
    assert_eq!(settled["process_started"], true);
    let (status, repeated) = cancel(fixture.app.clone(), SESSION, "req-1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(repeated, settled);

    let (status, after) = submit(fixture.app.clone(), SESSION, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after, settled);
    assert_eq!(settled["stdout_preview"], "run\n");
    let (_, snapshot) = get_json(fixture.app.clone(), &format!("/sessions/{SESSION}")).await;
    assert_eq!(snapshot["user_commands"].as_array().unwrap().len(), 1);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_different_requests_admit_one_and_identity_conflicts_are_distinct() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_busy_conflict");
    let command = HELD_COMMAND;

    let first = tokio::spawn(submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-a", "command": command}),
    ));
    let second = tokio::spawn(submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-b", "command": command}),
    ));
    let (first, second) = (first.await.unwrap(), second.await.unwrap());
    let (admitted, busy) = if first.0 == StatusCode::ACCEPTED {
        (first, second)
    } else {
        (second, first)
    };
    assert_eq!(admitted.0, StatusCode::ACCEPTED, "{admitted:?}");
    assert_eq!(busy.0, StatusCode::CONFLICT, "{busy:?}");
    let busy_message = busy.1["error"].as_str().unwrap().to_string();
    assert!(busy_message.contains("busy"), "{busy_message}");
    let winner = admitted.1["request_id"].as_str().unwrap().to_string();
    let loser = busy.1.clone();
    let (status, _) = get_json(
        fixture.app.clone(),
        &command_uri(SESSION, if winner == "req-a" { "req-b" } else { "req-a" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{loser}");

    for body in [
        serde_json::json!({"request_id": winner, "command": "printf other"}),
        serde_json::json!({"request_id": winner, "command": command, "timeout_ms": 1000}),
    ] {
        let (status, conflict) = submit(fixture.app.clone(), SESSION, body).await;
        assert_eq!(status, StatusCode::CONFLICT);
        let message = conflict["error"].as_str().unwrap();
        assert!(
            message.contains("different command or timeout"),
            "{message}"
        );
        assert_ne!(message, busy_message);
    }
    let (status, same_default) = submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": winner, "command": command, "timeout_ms": 30_000}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(same_default["request_id"], winner.as_str());

    fixture.wait_for_spawn(&winner).await;
    cancel(fixture.app.clone(), SESSION, &winner).await;
    let settled = wait_for_terminal(fixture.app.clone(), SESSION, &winner).await;
    assert_eq!(settled["stdout_preview"], "run\n");
}

#[tokio::test]
async fn lost_admission_response_is_recovered_by_lookup_replay_and_output() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_lookup");
    let body =
        serde_json::json!({"request_id": "req-1", "command": "printf hello", "timeout_ms": 5000});

    let (status, admitted) = submit(fixture.app.clone(), SESSION, body.clone()).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let (status, looked_up) = get_json(fixture.app.clone(), &command_uri(SESSION, "req-1")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(looked_up["request_id"], admitted["request_id"]);
    assert_eq!(
        looked_up["created_at_epoch_ms"],
        admitted["created_at_epoch_ms"]
    );

    let settled = wait_for_terminal(fixture.app.clone(), SESSION, "req-1").await;
    assert_eq!(settled["state"], "completed");
    assert_eq!(settled["exit_code"], 0);
    assert_eq!(settled["timeout_ms"], 5000);
    assert!(settled["stdout_preview"]
        .as_str()
        .unwrap()
        .contains("hello"));
    let (status, replayed) = submit(fixture.app.clone(), SESSION, body).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(replayed, settled);
    let (status, cancelled) = cancel(fixture.app.clone(), SESSION, "req-1").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cancelled, settled);

    let output_id = settled["output_id"].as_str().expect("retained output");
    let (status, page) = get_json(
        fixture.app.clone(),
        &format!(
            "{}/output?stream=stdout&offset=0&limit=1024",
            command_uri(SESSION, "req-1")
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["output_id"], output_id);
    assert_eq!(page["content"], "hello");
    assert_eq!(page["eof"], true);
    let (status, _) = get_json(
        fixture.app.clone(),
        &format!("{}/output?stream=bogus", command_uri(SESSION, "req-1")),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    for uri in [
        command_uri(SESSION, "missing"),
        format!("{}/output", command_uri(SESSION, "missing")),
        command_uri("missing-session", "req-1"),
    ] {
        let (status, _) = get_json(fixture.app.clone(), &uri).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{uri}");
    }
    let (status, _) = cancel(fixture.app.clone(), SESSION, "missing").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let restarted = router(test_manager(&fixture.root));
    let (status, _) = get_json(
        restarted.clone(),
        &format!("{}/output", command_uri(SESSION, "req-1")),
    )
    .await;
    assert_eq!(status, StatusCode::GONE);
    let (status, after_restart) = get_json(restarted, &command_uri(SESSION, "req-1")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(after_restart["state"], "completed");

    let (_, page) = get_json(
        fixture.app.clone(),
        &format!("/sessions/{SESSION}/messages"),
    )
    .await;
    let attributed = page["user_commands"].as_array().expect("page attribution");
    assert_eq!(attributed.len(), 1);
    assert_eq!(attributed[0]["request_id"], "req-1");
    assert!(attributed[0]["message_index"].is_u64());
    let (_, events) = get_json(fixture.app.clone(), &format!("/sessions/{SESSION}/events")).await;
    let types = events["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|envelope| envelope["event"]["type"].as_str().unwrap().to_string())
        .collect::<Vec<_>>();
    assert!(
        types.iter().any(|kind| kind == "user_command_updated"),
        "{types:?}"
    );
    assert!(!types.iter().any(|kind| kind == "run_started"), "{types:?}");
}

#[tokio::test]
async fn admission_status_codes_follow_session_kind_payload_and_busy_state() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_status_codes");
    let store_path = fixture.root.join("store.db");
    seed_direct_session(&fixture.root, "child");
    seed_editable_session(&fixture.root, "orchestrator");
    nac_core::store::create_traditional_child_relationship(
        &store_path,
        SESSION,
        "child",
        nac_core::store::GENERAL_CHILD_PROFILE,
        "delegated command scope",
    )
    .unwrap();
    let valid = serde_json::json!({"request_id": "req-1", "command": "printf hi"});

    for (session_id, expected) in [
        ("missing-session", StatusCode::NOT_FOUND),
        ("child", StatusCode::NOT_FOUND),
        ("orchestrator", StatusCode::BAD_REQUEST),
    ] {
        let (status, body) = submit(fixture.app.clone(), session_id, valid.clone()).await;
        assert_eq!(status, expected, "{session_id}: {body}");
    }
    for body in [
        serde_json::json!({"request_id": "req-1", "command": "   "}),
        serde_json::json!({"request_id": " ", "command": "printf hi"}),
        serde_json::json!({"request_id": "req-1", "command": "printf hi", "timeout_ms": 0}),
        serde_json::json!({"request_id": "req-1", "command": "printf hi", "timeout_ms": 3_600_001}),
        serde_json::json!({"request_id": "req-1"}),
    ] {
        let (status, error) = submit(fixture.app.clone(), SESSION, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    let (status, _) = get_json(fixture.app.clone(), &command_uri("child", "req-1")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let endpoint = point_session_at_hanging_endpoint(&fixture.root, SESSION).await;
    fixture
        .manager
        .submit_prompt(
            SESSION,
            SubmitPromptRequest {
                prompt: "hold the run open".to_string(),
            },
        )
        .await
        .unwrap();
    let (status, busy) = submit(fixture.app.clone(), SESSION, valid).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(busy["error"].as_str().unwrap().contains("busy"), "{busy}");
    let (status, _) = get_json(fixture.app.clone(), &command_uri(SESSION, "req-1")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    fixture.manager.cancel_active_run(SESSION).await.unwrap();
    endpoint.abort();
}

#[tokio::test]
async fn prompt_during_user_command_reports_the_command_and_snapshot_exposes_it() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_snapshot_busy");
    let (status, _) = submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-1", "command": HELD_COMMAND}),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let error = fixture
        .manager
        .submit_prompt(
            SESSION,
            SubmitPromptRequest {
                prompt: "must wait".to_string(),
            },
        )
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains("busy with a user command"),
        "{error:#}"
    );
    let (status, snapshot) = get_json(fixture.app.clone(), &format!("/sessions/{SESSION}")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(snapshot["active_user_command"]["request_id"], "req-1");

    fixture.wait_for_spawn("req-1").await;
    cancel(fixture.app.clone(), SESSION, "req-1").await;
    wait_for_terminal(fixture.app.clone(), SESSION, "req-1").await;
}

#[tokio::test]
async fn bang_prompt_through_runs_route_stays_an_ordinary_prompt() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("user_command_bang_prompt");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("user-command-model-key"));
    let (base_url, request) = scripted_direct_response();
    seed_direct_session_with_base_url(&root, SESSION, base_url);
    let app = router(test_manager(&root));

    let response = post_json(
        app.clone(),
        &format!("/sessions/{SESSION}/runs"),
        serde_json::json!({"prompt": "!ls"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(response_json(response).await["display_prompt"], "!ls");
    tokio::task::spawn_blocking(move || request.recv_timeout(Duration::from_secs(5)).unwrap())
        .await
        .unwrap();
    let (_, snapshot) = get_json(app, &format!("/sessions/{SESSION}")).await;
    assert!(snapshot.get("active_user_command").is_none());
    assert!(snapshot.get("user_commands").is_none());
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn credential_value_is_absent_from_lookup_and_output_responses() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("user_command_redaction");
    let nac_home = root.join("nac-home");
    std::fs::create_dir_all(&nac_home).unwrap();
    let _env = ScopedModelEnv::isolated(&nac_home, Some("user-command-model-key"));
    seed_direct_session(&root, SESSION);
    let app = router(test_managed_manager(&root));
    let canary = "user-command-canary-value-7f3a";
    let stored = put_json(
        app.clone(),
        "/managed/secrets/DEMO_TOKEN",
        serde_json::json!({ "value": canary }),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);

    let (status, admitted) = submit(
        app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-1", "command": "printf '%s' \"$DEMO_TOKEN\""}),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{admitted}");
    let settled = wait_for_terminal(app.clone(), SESSION, "req-1").await;
    assert_eq!(settled["state"], "completed", "{settled}");
    assert!(!settled["stdout_preview"].as_str().unwrap().is_empty());

    let lookup = get_response(app.clone(), &command_uri(SESSION, "req-1"), None).await;
    assert_eq!(lookup.status(), StatusCode::OK);
    let lookup = String::from_utf8(response_body(lookup).await.to_vec()).unwrap();
    assert!(!lookup.contains(canary), "{lookup}");
    let output = get_response(
        app,
        &format!("{}/output", command_uri(SESSION, "req-1")),
        None,
    )
    .await;
    assert_eq!(output.status(), StatusCode::OK);
    let output = String::from_utf8(response_body(output).await.to_vec()).unwrap();
    assert!(output.contains("\"content\""), "{output}");
    assert!(!output.contains(canary), "{output}");
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn shutdown_cancels_and_terminalizes_an_active_user_command() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_shutdown");
    let (status, _) = submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-1", "command": HELD_COMMAND}),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    fixture.wait_for_spawn("req-1").await;

    tokio::time::timeout(
        Duration::from_secs(10),
        fixture.manager.quiesce_persistence_callers(),
    )
    .await
    .expect("shutdown must not wait for the command deadline");
    let (status, settled) = get_json(fixture.app.clone(), &command_uri(SESSION, "req-1")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(settled["state"], "cancelled");
    assert_eq!(settled["process_started"], true);

    let (status, _) = submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-2", "command": "printf late"}),
    )
    .await;
    assert!(!status.is_success(), "{status}");
    let (status, _) = get_json(fixture.app.clone(), &command_uri(SESSION, "req-2")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn external_lease_holder_makes_submission_busy_without_row_or_process() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new("user_command_external_lease");
    let marker = fixture.root.join("ran");
    let held = nac_core::sessions::SessionOperationLease::try_acquire(
        &fixture.root.join("store.db"),
        SESSION,
    )
    .unwrap();

    let (status, busy) = submit(
        fixture.app.clone(),
        SESSION,
        serde_json::json!({"request_id": "req-1", "command": format!("touch '{}'", marker.display())}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{busy}");
    assert!(
        busy["error"].as_str().unwrap().contains("another process"),
        "{busy}"
    );
    drop(held);
    tokio::time::sleep(Duration::from_millis(100)).await;
    let (status, _) = get_json(fixture.app.clone(), &command_uri(SESSION, "req-1")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(!marker.exists());
}
