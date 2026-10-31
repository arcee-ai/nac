use super::*;
use crate::permissions::{
    PermissionApprovalMode, PermissionBackend, PermissionBroker, PermissionEffect, PermissionReply,
    PermissionRule,
};
use crate::tools::{execute_tool, ToolRuntime};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn runtime(rules: Vec<PermissionRule>) -> ToolRuntime {
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = std::env::temp_dir()
        .join(format!("nac-peer-tool-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&runtime.store_path).unwrap();
    for id in ["caller", "target"] {
        crate::store::insert_test_session(&runtime.store_path, id);
        crate::store::open_runtime_connection(&runtime.store_path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior='direct', cwd='/repo', backend='openai-chat-completions' WHERE session_id=?1",
                [id],
            )
            .unwrap();
    }
    crate::store::insert_project(
        &runtime.store_path,
        crate::store::NewProject {
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
    crate::store::assign_session_to_project(&runtime.store_path, "project", "target").unwrap();
    runtime.session_id = Some("caller".into());
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        rules,
    )));
    runtime.allowed_tools = None;
    runtime
}
fn read() -> Value {
    json!({"action":"read","session_id":"target","project_id":"project"})
}
fn start() -> Value {
    json!({"action":"start","session_id":"target","project_id":"project","request_id":"r","objective":"finish the finite task"})
}
async fn call(runtime: &ToolRuntime, input: Value) -> ToolResult {
    execute_tool(
        "task_goal",
        input,
        runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await
}
async fn asked(
    events: &mut crate::events::SessionEventReceiver,
) -> crate::permissions::PermissionRequest {
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if let crate::events::SessionEvent::PermissionAsked { request } =
                events.recv().await.unwrap().event
            {
                return request;
            }
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn general_allow_auto_mode_and_headless_read_access_do_not_grant_peer_goal_authority() {
    let runtime = runtime(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    let broker = runtime.permission_broker.as_ref().unwrap();
    broker
        .set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    assert!(call(&runtime, read()).await.is_error);
    assert!(call(&runtime, start()).await.is_error);
    assert!(
        crate::store::load_session_goal(&runtime.store_path, "target")
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn exact_manual_reply_is_required_even_across_auto_mode_transition_and_saves_no_grant() {
    let runtime = runtime(Vec::new());
    let broker = runtime.permission_broker.as_ref().unwrap().clone();
    let bus = crate::events::SessionEventBus::new(Some("caller".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let running = {
        let runtime = runtime.clone();
        tokio::spawn(async move { call(&runtime, read()).await })
    };
    let request = asked(&mut events).await;
    assert_eq!(request.resources[0].action, "task_goal_read");
    assert_eq!(request.resources[0].resource, "session:target");
    broker
        .set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    assert_eq!(
        broker.pending().len(),
        1,
        "auto mode must not claim explicit human requests"
    );
    assert!(!running.is_finished());
    broker.reply(&request.id, PermissionReply::Always).unwrap();
    let result = running.await.unwrap();
    assert!(!result.is_error, "{}", result.content);
    assert!(broker.grants().unwrap().is_empty());
    assert!(
        crate::store::load_session_goal(&runtime.store_path, "target")
            .unwrap()
            .is_none()
    );
}

struct Controller(Arc<AtomicUsize>, std::path::PathBuf);
impl crate::peer_goal_control::PeerGoalController for Controller {
    fn control<'a>(
        &'a self,
        request: AuthorizedPeerGoal,
    ) -> BoxFuture<'a, anyhow::Result<crate::peer_goal_control::PeerGoalOutcome>> {
        Box::pin(async move {
            assert_eq!(request.target(), "target");
            assert_eq!(request.caller(), "caller");
            assert_eq!(request.project(), "project");
            self.0.fetch_add(1, Ordering::SeqCst);
            let receipt = crate::store::peer_goals::start_peer_goal(
                &self.1,
                &request.start_request().unwrap(),
                None,
                0,
            )?;
            Ok(crate::peer_goal_control::PeerGoalOutcome::Started { receipt })
        })
    }
}
#[tokio::test]
async fn native_start_ordinary_deny_wins_and_exact_reply_issues_only_narrow_capability() {
    for denied in [true, false] {
        let runtime = runtime(if denied {
            vec![PermissionRule::new(
                "task_goal_start",
                "session:target",
                PermissionEffect::Deny,
            )]
        } else {
            Vec::new()
        });
        let count = Arc::new(AtomicUsize::new(0));
        crate::peer_goal_control::register_controller(
            runtime.store_path.clone(),
            Arc::new(Controller(count.clone(), runtime.store_path.clone())),
        );
        let broker = runtime.permission_broker.as_ref().unwrap().clone();
        let bus = crate::events::SessionEventBus::new(Some("caller".into()));
        let _interactive = bus.subscribe_assistant_deltas();
        let mut events = bus.subscribe();
        broker.attach_event_bus(bus);
        let running = {
            let runtime = runtime.clone();
            tokio::spawn(async move { call(&runtime, start()).await })
        };
        if !denied {
            let request = asked(&mut events).await;
            assert!(request.resources[0].display.contains("finite task"));
            assert_eq!(count.load(Ordering::SeqCst), 0);
            broker.reply(&request.id, PermissionReply::Once).unwrap();
        }
        assert_eq!(running.await.unwrap().is_error, denied);
        assert_eq!(count.load(Ordering::SeqCst), usize::from(!denied));
    }
}
#[test]
fn unsupported_mutations_and_cross_action_argument_confusion_are_rejected() {
    for input in [
        json!({"action":"complete","session_id":"target","project_id":"project"}),
        json!({"action":"blocked","session_id":"target","project_id":"project"}),
        json!({"action":"clear","session_id":"target","project_id":"project"}),
        json!({"action":"resume","session_id":"target","project_id":"project","goal_id":"g","expected_version":1,"objective":"replacement"}),
        json!({"action":"start","session_id":"target","project_id":"project","objective":"work"}),
    ] {
        assert!(PeerGoalTool.decode(input).is_err());
    }
}

#[tokio::test]
async fn ordinary_ask_and_required_human_goal_authorization_remain_separate() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_goal_read",
        "*",
        PermissionEffect::Ask,
    )]);
    let broker = runtime.permission_broker.as_ref().unwrap().clone();
    let bus = crate::events::SessionEventBus::new(Some("caller".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let running = {
        let runtime = runtime.clone();
        tokio::spawn(async move { call(&runtime, read()).await })
    };
    let ordinary = asked(&mut events).await;
    broker.reply(&ordinary.id, PermissionReply::Once).unwrap();
    let explicit = asked(&mut events).await;
    assert_ne!(ordinary.id, explicit.id);
    assert_eq!(ordinary.resources, explicit.resources);
    broker.reply(&explicit.id, PermissionReply::Once).unwrap();
    assert!(!running.await.unwrap().is_error);
}

#[tokio::test]
async fn changed_target_scope_during_manual_wait_is_unavailable_and_never_retargeted() {
    let runtime = runtime(Vec::new());
    let broker = runtime.permission_broker.as_ref().unwrap().clone();
    let bus = crate::events::SessionEventBus::new(Some("caller".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let running = {
        let runtime = runtime.clone();
        tokio::spawn(async move { call(&runtime, read()).await })
    };
    let request = asked(&mut events).await;
    crate::store::open_runtime_connection(&runtime.store_path)
        .unwrap()
        .execute("DELETE FROM session_projects WHERE session_id='target'", [])
        .unwrap();
    broker.reply(&request.id, PermissionReply::Once).unwrap();
    assert!(running.await.unwrap().is_error);
}

#[test]
fn nullable_strict_schema_preserves_omitted_null_and_explicit_budget_semantics() {
    let schema = PeerGoalTool.definition().function.parameters;
    let properties = schema["properties"].as_object().unwrap();
    let required = schema["required"].as_array().unwrap();
    assert_eq!(properties.len(), required.len());
    assert_eq!(
        properties["token_budget"]["type"],
        json!(["integer", "null"])
    );
    for budget in [None, Some(Value::Null), Some(json!(37))] {
        let mut input = start();
        if let Some(budget) = budget.clone() {
            input["token_budget"] = budget;
        }
        for field in ["goal_id", "expected_version"] {
            input[field] = Value::Null;
        }
        let Input::Start { token_budget, .. } = PeerGoalTool.decode(input).unwrap() else {
            panic!()
        };
        assert_eq!(token_budget, budget.and_then(|value| value.as_u64()));
    }
    let mut read = read();
    for field in [
        "request_id",
        "objective",
        "token_budget",
        "goal_id",
        "expected_version",
    ] {
        read[field] = Value::Null;
    }
    assert!(matches!(
        PeerGoalTool.decode(read.clone()).unwrap(),
        Input::Read { .. }
    ));
    read["unknown"] = Value::Null;
    assert!(PeerGoalTool.decode(read).is_err());
}

#[tokio::test]
async fn goal_actions_cannot_bypass_existing_task_read_deny() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "session:target",
        PermissionEffect::Deny,
    )]);
    assert!(call(&runtime, read()).await.is_error);
    assert!(call(&runtime, start()).await.is_error);
    assert!(runtime
        .permission_broker
        .as_ref()
        .unwrap()
        .pending()
        .is_empty());
}

#[tokio::test]
async fn review_answer_mode_never_substitutes_for_the_exact_human_goal_reply() {
    let runtime = runtime(Vec::new());
    crate::store::open_runtime_connection(&runtime.store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET permission_reviewer='auto_review' WHERE session_id='caller'",
            [],
        )
        .unwrap();
    let broker = runtime.permission_broker.as_ref().unwrap().clone();
    assert_eq!(
        broker.approval_mode().await.unwrap(),
        PermissionApprovalMode::Review
    );
    let bus = crate::events::SessionEventBus::new(Some("caller".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    broker.attach_event_bus(bus);
    let running = {
        let runtime = runtime.clone();
        tokio::spawn(async move { call(&runtime, read()).await })
    };
    let request = asked(&mut events).await;
    assert!(!running.is_finished());
    broker.reply(&request.id, PermissionReply::Once).unwrap();
    assert!(!running.await.unwrap().is_error);
}

#[test]
fn every_peer_action_accepts_full_strict_wire_arguments_with_null_unused_fields() {
    for action in ["read", "start", "pause", "resume"] {
        let mut wire = json!({"action":action,"session_id":"target","project_id":"project","request_id":null,"objective":null,"token_budget":null,"goal_id":null,"expected_version":null});
        match action {
            "start" => {
                wire["request_id"] = json!("r");
                wire["objective"] = json!("finite task");
            }
            "pause" | "resume" => {
                wire["goal_id"] = json!("g");
                wire["expected_version"] = json!(7);
            }
            _ => (),
        }
        let decoded = PeerGoalTool.decode(wire.clone()).unwrap();
        assert_eq!(decoded.scope(), (action, "target", "project"));
        if action == "start" {
            assert!(matches!(
                decoded,
                Input::Start {
                    token_budget: None,
                    ..
                }
            ));
        }
        if matches!(action, "pause" | "resume") {
            wire["expected_version"] = Value::Null;
            assert!(
                PeerGoalTool.decode(wire).is_err(),
                "null cannot invent an expected version"
            );
        }
    }
}

#[tokio::test]
async fn lost_ack_restart_reconciliation_is_headless_and_passive_but_changed_arguments_conflict() {
    let runtime = runtime(Vec::new());
    let request = crate::store::PeerGoalStart {
        caller_session_id: "caller".into(),
        request_id: "r".into(),
        target_session_id: "target".into(),
        project_id: "project".into(),
        objective: "finish the finite task".into(),
        token_budget: None,
    };
    let receipt =
        crate::store::peer_goals::start_peer_goal(&runtime.store_path, &request, None, 0).unwrap();
    crate::store::update_session_goal_by_model(
        &runtime.store_path,
        "target",
        &receipt.admitted_goal.goal_id,
        crate::store::GoalStatus::Complete,
    )
    .unwrap();
    let replacement =
        crate::store::create_session_goal(&runtime.store_path, "target", "replacement", None, None)
            .unwrap();
    // No event bus, approver, lifecycle controller or execution owner is needed
    // to read the exact immutable reply after the original process disappeared.
    let replay = call(&runtime, start()).await;
    assert!(!replay.is_error, "{}", replay.content);
    let replay: Value = serde_json::from_str(replay.content.as_text().unwrap()).unwrap();
    assert_eq!(replay["status"], "replayed");
    assert_eq!(
        replay["receipt"]["admitted_goal"]["goal_id"],
        receipt.admitted_goal.goal_id
    );
    assert_eq!(
        crate::store::load_session_goal(&runtime.store_path, "target")
            .unwrap()
            .unwrap(),
        replacement
    );
    let mut changed = start();
    changed["objective"] = json!("different");
    let conflict = call(&runtime, changed).await;
    assert!(conflict.is_error);
    let conflict: Value = serde_json::from_str(conflict.content.as_text().unwrap()).unwrap();
    assert_eq!(conflict["status"], "conflict");
    assert!(runtime
        .permission_broker
        .as_ref()
        .unwrap()
        .pending()
        .is_empty());
}
