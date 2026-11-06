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
        project: Some("project".into()),
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
async fn peer_goal_wake_failure_retains_committed_identity_and_passive_replay() {
    for resume in [false, true] {
        let (service, path) = fixture();
        let action = if resume {
            let goal = store::create_session_goal(&path, "target", "finite task", Some(100), None)
                .unwrap();
            let goal = store::update_session_goal_by_user(
                &path,
                "target",
                &goal.goal_id,
                goal.version,
                store::UserGoalUpdate {
                    status: Some(GoalStatus::Paused),
                    ..Default::default()
                },
            )
            .unwrap();
            request(PeerGoalAction::Resume {
                goal_id: goal.goal_id,
                expected_version: goal.version,
            })
        } else {
            start()
        };
        // Admission must fail on the real cached-agent fence, after the goal
        // transaction has committed. No synthetic store success is substituted.
        let agent = service.agent.lock().await;
        let error = service.control_peer_goal(action, None).await.unwrap_err();
        let committed = error
            .downcast_ref::<crate::peer_goal_control::PeerGoalWakeError>()
            .expect("post-commit failure must retain the mutation result");
        let outcome = serde_json::to_value(&committed.outcome).unwrap();
        assert_eq!(
            outcome["status"],
            if resume { "resumed" } else { "started" }
        );
        let goal = store::load_session_goal(&path, "target").unwrap().unwrap();
        let returned = if resume {
            &outcome["goal"]
        } else {
            &outcome["receipt"]["admitted_goal"]
        };
        assert_eq!(returned["goal_id"], goal.goal_id);
        assert_eq!(returned["version"], goal.version);
        assert_eq!(goal.status, GoalStatus::Active);
        assert!(service.active_run().is_none());
        if !resume {
            assert!(matches!(
                service.control_peer_goal(start(), None).await.unwrap(),
                PeerGoalOutcome::Replayed { .. }
            ));
            assert!(
                service.active_run().is_none(),
                "receipt retry must not wake even its original goal"
            );
        }
        drop(agent);
        store::update_session_goal_by_model(&path, "target", &goal.goal_id, GoalStatus::Complete)
            .unwrap();
        let replacement =
            store::create_session_goal(&path, "target", "replacement", None, None).unwrap();
        if resume {
            assert!(service
                .control_peer_goal(
                    request(PeerGoalAction::Resume {
                        goal_id: goal.goal_id,
                        expected_version: goal.version
                    }),
                    None
                )
                .await
                .is_err());
        } else {
            assert!(matches!(
                service.control_peer_goal(start(), None).await.unwrap(),
                PeerGoalOutcome::Replayed { .. }
            ));
        }
        assert_eq!(
            store::load_session_goal(&path, "target").unwrap().unwrap(),
            replacement
        );
        assert!(service.active_run().is_none());
    }
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

// Test-only fault at the existing native controller reply boundary. The real
// service commits Start; this adapter never returns that first success to tool.
struct LoseFirstNativeStartReply {
    service: std::sync::Weak<SessionService>,
    lose_once: std::sync::atomic::AtomicBool,
    controller_calls: std::sync::atomic::AtomicUsize,
    committed_starts: std::sync::atomic::AtomicUsize,
    lost_replies: std::sync::atomic::AtomicUsize,
    admitted: std::sync::Mutex<Option<store::PeerGoalStartReceipt>>,
}
impl crate::peer_goal_control::PeerGoalController for LoseFirstNativeStartReply {
    fn control<'a>(
        &'a self,
        request: AuthorizedPeerGoal,
    ) -> futures_util::future::BoxFuture<'a, Result<PeerGoalOutcome>> {
        Box::pin(async move {
            use std::sync::atomic::Ordering::SeqCst;
            self.controller_calls.fetch_add(1, SeqCst);
            let service = self
                .service
                .upgrade()
                .ok_or_else(|| anyhow::anyhow!("test owner stopped"))?;
            let outcome = service.control_peer_goal(request, None).await?;
            if let PeerGoalOutcome::Started { receipt } = &outcome {
                self.committed_starts.fetch_add(1, SeqCst);
                *self.admitted.lock().unwrap() = Some(receipt.clone());
                if self.lose_once.swap(false, SeqCst) {
                    self.lost_replies.fetch_add(1, SeqCst);
                    // Fault BEFORE PeerGoalTool receives/serializes Started.
                    // No receipt is included in this error; it is not wake_error.
                    return Err(anyhow::anyhow!(
                        "fixture-first-start-reply-lost-after-commit"
                    ));
                }
            }
            Ok(outcome)
        })
    }
}

#[tokio::test]
async fn peer_goals_native_first_start_reply_loss_replays_one_admission_headlessly() {
    use crate::permissions::{PermissionBackend, PermissionBroker};
    use serde_json::json;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::SeqCst};
    let (service, path) = fixture();
    let service = Arc::new(service);
    store::open_runtime_connection(&path).unwrap().execute("UPDATE sessions SET behavior='direct', backend='openai-chat-completions' WHERE session_id='caller'", []).unwrap();
    // Existing active-target owner fixture: no model/provider turn is started.
    let active = service.try_begin_run(None, "already running task").unwrap();
    service
        .goal_runtime
        .as_ref()
        .unwrap()
        .begin_run(active.run_id.as_str());
    let inbox_before =
        serde_json::to_value(store::list_session_inbox(&path, "target").unwrap()).unwrap();
    let controller = Arc::new(LoseFirstNativeStartReply {
        service: Arc::downgrade(&service),
        lose_once: AtomicBool::new(true), // RED control changes ONLY this to false.
        controller_calls: AtomicUsize::new(0),
        committed_starts: AtomicUsize::new(0),
        lost_replies: AtomicUsize::new(0),
        admitted: std::sync::Mutex::new(None),
    });
    crate::peer_goal_control::register_controller(path.clone(), controller.clone());
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
    let human = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let start = json!({"action":"start","session_id":"target","project_id":"project","request_id":"first-start-reply-loss","objective":"finite native task","token_budget":100,"goal_id":null,"expected_version":null});
    // Reuse the existing real native permission/reply helper. Caller obtains
    // only unavailable, never an already-returned Started ACK that is ignored.
    let first = native_with_human_reply(&runtime, &broker, &mut events, start.clone()).await;
    let first_error = first.is_error;
    let first_wire = first.content.as_text().unwrap().to_owned();
    let first_value: serde_json::Value = serde_json::from_str(&first_wire).unwrap();
    let admitted = controller.admitted.lock().unwrap().clone().unwrap();
    let before = store::load_session_goal(&path, "target").unwrap().unwrap();
    // Ordinary policy still applies; a reconstructed broker has no approver.
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        Vec::new(),
    )));
    let replay = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        crate::tools::execute_tool(
            "task_goal",
            start.clone(),
            &runtime,
            &ModelClient::new_for_test(),
        ),
    )
    .await
    .expect("headless replay bound");
    let replay_error = replay.is_error;
    let replayed: serde_json::Value =
        serde_json::from_str(replay.content.as_text().unwrap()).unwrap();
    let after = store::load_session_goal(&path, "target").unwrap().unwrap();
    let active_after = service.active_run().unwrap().run_id;
    let inbox_after =
        serde_json::to_value(store::list_session_inbox(&path, "target").unwrap()).unwrap();
    let conn = store::open_runtime_connection(&path).unwrap();
    let goals: i64 = conn
        .query_row(
            "SELECT count(*) FROM session_goals WHERE session_id='target'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let receipts: i64 = conn.query_row("SELECT count(*) FROM peer_goal_starts WHERE caller_session_id='caller' AND request_id='first-start-reply-loss'", [], |r| r.get(0)).unwrap();
    drop(conn);
    let mut changed = start;
    changed["objective"] = json!("changed arguments must conflict");
    let conflict = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        crate::tools::execute_tool("task_goal", changed, &runtime, &ModelClient::new_for_test()),
    )
    .await
    .expect("conflict bound");
    let conflict_error = conflict.is_error;
    let conflict_value: serde_json::Value =
        serde_json::from_str(conflict.content.as_text().unwrap()).unwrap();
    let calls = controller.controller_calls.load(SeqCst);
    let starts = controller.committed_starts.load(SeqCst);
    let losses = controller.lost_replies.load(SeqCst);
    // This active-target fixture starts no provider or queued successor.
    // Drop the actual owner before removing its private operation-scoped store.
    drop(runtime);
    drop(events);
    drop(human);
    drop(broker);
    drop(service);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    // Semantic assertions follow cleanup, including the intentional RED check.
    assert!(
        first_error,
        "RED control: first native caller already observed success"
    );
    assert_eq!(first_value["status"], "unavailable");
    assert!(first_wire.contains("fixture-first-start-reply-lost-after-commit"));
    assert!(!first_wire.contains("admitted_goal"));
    assert!(first_value.get("receipt").is_none());
    assert_eq!((calls, starts, losses), (1, 1, 1));
    assert!(!replay_error);
    assert_eq!(replayed["status"], "replayed");
    let mut expected_receipt = serde_json::to_value(&admitted).unwrap();
    expected_receipt["request"]["objective_truncated"] = json!(false);
    expected_receipt["admitted_goal"]["objective_truncated"] = json!(false);
    assert_eq!(replayed["receipt"], expected_receipt);
    assert_eq!(before, after);
    assert_eq!(after.goal_id, admitted.admitted_goal.goal_id);
    assert_eq!(
        after.accounting_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    assert_eq!(active_after, active.run_id);
    assert_eq!((goals, receipts), (1, 1));
    assert_eq!(inbox_before, inbox_after);
    assert!(conflict_error);
    assert_eq!(conflict_value["status"], "conflict");
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
    let start = json!({"action":"start","session_id":"target","project_id":"project","request_id":"native","objective":"finite native task","token_budget":100,"goal_id":"unused-provider-goal","expected_version":999,"_nac":null});
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
    let paused = native_with_human_reply(&runtime, &broker, &mut events, json!({"action":"pause","session_id":"target","project_id":"project","goal_id":current.goal_id,"expected_version":current.version,"request_id":"unused-provider-request","objective":"unused provider objective","token_budget":1,"_nac":null})).await;
    assert!(!paused.is_error, "{}", paused.content);
    assert!(!paused
        .content
        .as_text()
        .unwrap()
        .contains("peer-credential-canary"));
    let paused: serde_json::Value =
        serde_json::from_str(paused.content.as_text().unwrap()).unwrap();
    assert_eq!(paused["goal"]["objective_truncated"], true);
    assert_eq!(
        paused["goal"]["token_budget"], 100,
        "unused pause budget cannot edit the goal"
    );
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

#[tokio::test]
async fn peer_goals_projectless_target_uses_same_active_run_accounting_owner() {
    let (service, path) = fixture();
    store::open_runtime_connection(&path)
        .unwrap()
        .execute("DELETE FROM session_projects WHERE session_id='target'", [])
        .unwrap();
    let active = service
        .try_begin_run(None, "running projectless task")
        .unwrap();
    service
        .goal_runtime
        .as_ref()
        .unwrap()
        .begin_run(active.run_id.as_str());
    let mut start = start();
    start.project = None;
    let PeerGoalOutcome::Started { receipt } =
        service.control_peer_goal(start, None).await.unwrap()
    else {
        panic!()
    };
    assert_eq!(receipt.request.project_id, None);
    let mut pause = request(PeerGoalAction::Pause {
        goal_id: receipt.admitted_goal.goal_id,
        expected_version: receipt.admitted_goal.version,
    });
    pause.project = None;
    let PeerGoalOutcome::Paused { goal } = service.control_peer_goal(pause, None).await.unwrap()
    else {
        panic!()
    };
    assert_eq!(
        goal.accounting_run_id.as_deref(),
        Some(active.run_id.as_str())
    );
    assert_eq!(service.active_run().unwrap().run_id, active.run_id);
}
