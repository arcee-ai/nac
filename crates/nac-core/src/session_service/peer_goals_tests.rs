use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;
use crate::store::{self, GoalStatus, NewProject};

fn fixture() -> (SessionService, PathBuf) {
    let (parts, path) = test_direct_active_service(
        &format!("peer-goal-lifecycle-{}", uuid::Uuid::new_v4()),
        "target",
        ModelClient::new_for_test(),
    );
    store::insert_test_session(&path, "caller");
    store::insert_project(
        &path,
        NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: "/repo".into(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    store::assign_session_to_project(&path, "project", "target").unwrap();
    (parts.service, path)
}
fn request(action: PeerGoalAction) -> AuthorizedPeerGoal {
    AuthorizedPeerGoal {
        caller: "caller".into(),
        target: "target".into(),
        project: "project".into(),
        action,
    }
}
fn start() -> AuthorizedPeerGoal {
    request(PeerGoalAction::Start {
        request_id: "r".into(),
        objective: "finite task".into(),
        token_budget: Some(100),
    })
}

#[tokio::test]
async fn peer_goals_pause_running_turn_without_cancel_and_preserve_baseline() {
    let (service, path) = fixture();
    let active = service.try_begin_run(None, "work").unwrap();
    let runtime = service.goal_runtime.as_ref().unwrap();
    runtime.begin_run(active.run_id.as_str());
    runtime.update_usage(&crate::model::TokenUsage {
        input_tokens: 60,
        output_tokens: 20,
        ..Default::default()
    });
    let _agent_loop = service.agent.lock().await;
    let receipt = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        service.control_peer_goal(start(), None),
    )
    .await
    .unwrap()
    .unwrap();
    let PeerGoalOutcome::Started { receipt } = receipt else {
        panic!("goal was not started")
    };
    let goal_id = receipt.admitted_goal.goal_id;
    let goal = store::load_session_goal(&path, "target").unwrap().unwrap();
    assert_eq!(goal.accounting_token_baseline, Some(80));
    service
        .control_peer_goal(
            request(PeerGoalAction::Pause {
                goal_id: goal_id.clone(),
                expected_version: goal.version,
            }),
            None,
        )
        .await
        .unwrap();
    let paused = store::load_session_goal(&path, "target").unwrap().unwrap();
    assert_eq!(paused.status, GoalStatus::Paused);
    assert_eq!(
        paused.accounting_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    assert_eq!(
        service.active_run().unwrap().run_id,
        active.run_id,
        "pause leaves the run active"
    );
    assert!(service
        .control_peer_goal(
            request(PeerGoalAction::Resume {
                goal_id,
                expected_version: paused.version
            }),
            None
        )
        .await
        .is_err());
}

#[tokio::test]
async fn peer_goals_missing_active_baseline_and_foreign_idle_lease_fail_closed() {
    let (service, path) = fixture();
    let lease = sessions::SessionOperationLease::try_acquire(&path, "target").unwrap();
    assert!(service
        .control_peer_goal(start(), None)
        .await
        .unwrap_err()
        .to_string()
        .contains("another process"));
    assert!(store::load_session_goal(&path, "target").unwrap().is_none());
    drop(lease);
    let _active = service.try_begin_run(None, "work").unwrap();
    assert!(service
        .control_peer_goal(start(), None)
        .await
        .unwrap_err()
        .to_string()
        .contains("baseline"));
    assert!(store::load_session_goal(&path, "target").unwrap().is_none());
}

#[tokio::test]
async fn peer_goals_replay_does_not_wake_replacement_or_require_current_accounting() {
    let (service, path) = fixture();
    // Commit receipt as though its acknowledgement was lost before caller resumed.
    let original =
        store::peer_goals::start_peer_goal(&path, &start().start_request().unwrap(), None, 0)
            .unwrap();
    store::update_session_goal_by_model(
        &path,
        "target",
        &original.admitted_goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let replacement =
        store::create_session_goal(&path, "target", "replacement", None, None).unwrap();
    *service.goal_retry_wake.lock().unwrap() = Some(GoalRetryWake {
        goal_id: replacement.goal_id.clone(),
        goal_version: replacement.version,
        task: tokio::spawn(std::future::pending()),
    });
    let replay = service.control_peer_goal(start(), None).await.unwrap();
    let wake = service
        .goal_retry_wake
        .lock()
        .unwrap()
        .take()
        .expect("receipt replay preserves replacement retry wake");
    assert_eq!(wake.goal_id, replacement.goal_id);
    wake.task.abort();
    let PeerGoalOutcome::Replayed { receipt } = replay else {
        panic!("goal was not replayed")
    };
    assert_eq!(
        receipt.admitted_goal.goal_id,
        original.admitted_goal.goal_id
    );
    assert_eq!(
        store::load_session_goal(&path, "target").unwrap().unwrap(),
        replacement
    );
    assert!(service.active_run().is_none());
}

struct NativeController(std::sync::Weak<SessionService>);
impl crate::peer_goal_control::PeerGoalController for NativeController {
    fn control<'a>(
        &'a self,
        request: AuthorizedPeerGoal,
    ) -> futures_util::future::BoxFuture<'a, Result<PeerGoalOutcome>> {
        Box::pin(async move {
            let service = self
                .0
                .upgrade()
                .ok_or_else(|| anyhow::anyhow!("test owner stopped"))?;
            service.control_peer_goal(request, None).await
        })
    }
}

#[tokio::test]
async fn peer_goals_native_authorization_reaches_real_target_owner_and_replays_after_lost_ack() {
    use crate::permissions::{PermissionBackend, PermissionBroker};
    use serde_json::json;
    let (service, path) = fixture();
    let service = Arc::new(service);
    store::open_runtime_connection(&path).unwrap().execute("UPDATE sessions SET behavior='direct', backend='openai-chat-completions' WHERE session_id='caller'", []).unwrap();
    let active = service.try_begin_run(None, "already running task").unwrap();
    service
        .goal_runtime
        .as_ref()
        .unwrap()
        .begin_run(active.run_id.as_str());
    crate::peer_goal_control::register_controller(
        path.clone(),
        Arc::new(NativeController(Arc::downgrade(&service))),
    );
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = path.clone();
    runtime.session_id = Some("caller".into());
    let broker = Arc::new(PermissionBroker::new(
        path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        Vec::new(),
    ));
    runtime.permission_broker = Some(broker.clone());
    let bus = crate::events::SessionEventBus::new(Some("caller".into()));
    let _human = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let start = json!({"action":"start","session_id":"target","project_id":"project","request_id":"native","objective":"finite native task","token_budget":100,"goal_id":null,"expected_version":null,"_nac":null});
    let admitted = native_with_human_reply(&runtime, &broker, &mut events, start.clone()).await;
    assert!(!admitted.is_error, "{}", admitted.content);
    let current = store::load_session_goal(&path, "target").unwrap().unwrap();
    assert_eq!(
        current.accounting_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    let human_objective = format!(
        "Authorization: Bearer peer-credential-canary\n{}",
        "x".repeat(100_000)
    );
    let current = store::update_session_goal_by_user(
        &path,
        "target",
        &current.goal_id,
        current.version,
        store::UserGoalUpdate {
            objective: Some(human_objective.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    let paused = native_with_human_reply(&runtime, &broker, &mut events, json!({"action":"pause","session_id":"target","project_id":"project","goal_id":current.goal_id,"expected_version":current.version,"request_id":null,"objective":null,"token_budget":null,"_nac":null})).await;
    assert!(!paused.is_error, "{}", paused.content);
    assert!(!paused
        .content
        .as_text()
        .unwrap()
        .contains("peer-credential-canary"));
    let paused: serde_json::Value =
        serde_json::from_str(paused.content.as_text().unwrap()).unwrap();
    assert_eq!(paused["goal"]["objective_truncated"], true);
    assert!(
        paused["goal"]["objective"]
            .as_str()
            .unwrap()
            .chars()
            .count()
            <= store::GOAL_OBJECTIVE_CHARS
    );
    assert_eq!(
        store::load_session_goal(&path, "target")
            .unwrap()
            .unwrap()
            .objective,
        human_objective
    );
    assert_eq!(
        store::load_session_goal(&path, "target")
            .unwrap()
            .unwrap()
            .status,
        GoalStatus::Paused
    );
    assert!(
        service.active_run().is_some(),
        "native pause does not cancel the target turn"
    );
    {
        let active = service.lock_active_operation();
        let Some(ActiveSessionOperation::Run(run)) = active.as_ref() else {
            panic!("target turn disappeared")
        };
        assert!(
            !run.command_cancellation.is_cancelled(),
            "pause must leave active tools running"
        );
    }
    // Reconstruct the caller broker without any approver to model restart after
    // a lost acknowledgement. The receipt is already authorized and immutable.
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        Vec::new(),
    )));
    let replay =
        crate::tools::execute_tool("task_goal", start, &runtime, &ModelClient::new_for_test())
            .await;
    assert!(!replay.is_error, "{}", replay.content);
    let replay: serde_json::Value =
        serde_json::from_str(replay.content.as_text().unwrap()).unwrap();
    assert_eq!(replay["status"], "replayed");
    assert_eq!(
        replay["receipt"]["admitted_goal"]["goal_id"],
        current.goal_id
    );
    assert_eq!(
        store::load_session_goal(&path, "target")
            .unwrap()
            .unwrap()
            .status,
        GoalStatus::Paused
    );
}

async fn native_with_human_reply(
    runtime: &crate::tools::ToolRuntime,
    broker: &Arc<crate::permissions::PermissionBroker>,
    events: &mut crate::events::SessionEventReceiver,
    input: serde_json::Value,
) -> crate::tools::ToolResult {
    let running = {
        let runtime = runtime.clone();
        tokio::spawn(async move {
            crate::tools::execute_tool("task_goal", input, &runtime, &ModelClient::new_for_test())
                .await
        })
    };
    let request = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let SessionEvent::PermissionAsked { request } = events.recv().await.unwrap().event {
                return request;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(request.resources[0].resource, "session:target");
    broker
        .reply(&request.id, crate::permissions::PermissionReply::Once)
        .unwrap();
    running.await.unwrap()
}
