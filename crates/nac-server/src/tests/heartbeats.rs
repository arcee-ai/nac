use super::*;
use nac_core::store::{HeartbeatAction, HeartbeatReceipt, HeartbeatSpec};

fn seed(root: &std::path::Path) {
    let mut snapshot = sessions::new_snapshot(
        "session".into(),
        root.into(),
        "model-a".into(),
        "https://api.openai.com/v1".into(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".into()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&root.join("store.db"), &snapshot).unwrap();
}
fn specification() -> HeartbeatSpec {
    HeartbeatSpec {
        name: "Local job".into(),
        instructions: "Check the authorized job.".into(),
        skills: Vec::new(),
        interval_ms: 60_000,
        end_condition: "Finish when ready.".into(),
        goal_id: None,
        execution_timeout_ms: 300_000,
        max_occurrences: 1000,
        token_allowance: None,
    }
}
async fn control(app: Router, id: &str, operation: HeartbeatAction) -> Response {
    post_json(
        app,
        "/sessions/session/heartbeats/control",
        serde_json::json!({"request_id":id,"operation":operation}),
    )
    .await
}
async fn receipt(response: Response) -> HeartbeatReceipt {
    let status = response.status();
    let body = to_bytes(response.into_body(), 1_000_000).await.unwrap();
    assert_eq!(status, StatusCode::OK, "{}", String::from_utf8_lossy(&body));
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn heartbeat_human_routes_all_controls_lost_ack_and_passive_inventory_without_goal_or_run() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = temp_root("heartbeat_http");
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("server-test-key"));
    seed(&root);
    let manager = owned_test_manager(&root).unwrap();
    let app = router(manager.clone());
    let key = uuid::Uuid::new_v4().to_string();
    let creation = HeartbeatAction::Create {
        spec: specification(),
    };
    // Lost acknowledgement: discard the first response, then reconcile using
    // exactly the same request identity and arguments.
    drop(control(app.clone(), &key, creation.clone()).await);
    let created = receipt(control(app.clone(), &key, creation.clone()).await).await;
    let mut schedule = created.schedule.clone();
    let conflict = control(
        app.clone(),
        &key,
        HeartbeatAction::Pause {
            schedule_id: schedule.schedule_id.clone(),
            expected_version: 1,
        },
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    for action in ["run_now", "pause", "resume", "edit", "stop", "delete"] {
        let id = schedule.schedule_id.clone();
        let expected = schedule.version;
        let operation = match action {
            "run_now" => HeartbeatAction::RunNow {
                schedule_id: id,
                expected_version: expected,
            },
            "pause" => HeartbeatAction::Pause {
                schedule_id: id,
                expected_version: expected,
            },
            "resume" => HeartbeatAction::Resume {
                schedule_id: id,
                expected_version: expected,
            },
            "edit" => {
                let mut spec = specification();
                spec.interval_ms = 120_000;
                HeartbeatAction::Edit {
                    schedule_id: id,
                    expected_version: expected,
                    spec,
                }
            }
            "stop" => HeartbeatAction::Stop {
                schedule_id: id,
                expected_version: expected,
            },
            _ => HeartbeatAction::Delete {
                schedule_id: id,
                expected_version: expected,
            },
        };
        schedule =
            receipt(control(app.clone(), &uuid::Uuid::new_v4().to_string(), operation).await)
                .await
                .schedule;
    }
    assert_eq!(
        receipt(control(app.clone(), &key, creation).await).await,
        created
    );
    let inventory = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/heartbeats")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inventory.status(), StatusCode::OK);
    let inventory: serde_json::Value =
        serde_json::from_slice(&to_bytes(inventory.into_body(), 1_000_000).await.unwrap()).unwrap();
    assert_eq!(inventory, serde_json::json!([]));
    let inspection = app
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/sessions/session/heartbeats/{}",
                    schedule.schedule_id
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(inspection.status(), StatusCode::OK);
    let path = root.join("store.db");
    let (goal, inbox) =
        nac_core::store::spawn_blocking_store_caller(move || -> anyhow::Result<_> {
            Ok((
                nac_core::store::load_session_goal(&path, "session")?,
                nac_core::store::list_session_inbox(&path, "session")?,
            ))
        })
        .await
        .unwrap()
        .unwrap();
    assert!(goal.is_none());
    assert!(inbox.is_empty());
    assert!(manager
        .inner
        .active_sessions
        .read()
        .await
        .get("session")
        .unwrap()
        .active_run()
        .is_none());
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
}
