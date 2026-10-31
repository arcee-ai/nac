use super::*;
use crate::permissions::{PermissionBackend, PermissionBroker, PermissionRule};
use crate::task_followups::{TaskFollowupController, TaskFollowupFuture};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct Controller {
    path: std::path::PathBuf,
    calls: Arc<AtomicUsize>,
}
impl TaskFollowupController for Controller {
    fn follow_up<'a>(&'a self, request: TaskFollowupRequest) -> TaskFollowupFuture<'a> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            store::admit_task_followup(&self.path, &request)
        })
    }
}

fn runtime(rules: Vec<PermissionRule>) -> (super::super::ToolRuntime, Arc<AtomicUsize>) {
    let mut rt = super::super::test_runtime();
    rt.store_path = std::env::temp_dir()
        .join(format!("nac-followup-tool-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    store::initialize(&rt.store_path).unwrap();
    for id in ["caller", "target"] {
        store::insert_test_session(&rt.store_path, id);
        let conn = store::open_runtime_connection(&rt.store_path).unwrap();
        conn.execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id=?1",
            [id],
        )
        .unwrap();
    }
    rt.session_id = Some("caller".into());
    rt.permission_broker = Some(Arc::new(PermissionBroker::new(
        rt.store_path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        rules,
    )));
    let calls = Arc::new(AtomicUsize::new(0));
    crate::task_followups::register_controller(
        rt.store_path.clone(),
        Arc::new(Controller {
            path: rt.store_path.clone(),
            calls: calls.clone(),
        }),
    );
    (rt, calls)
}
fn input() -> Value {
    json!({"session_id":"target","request_id":"one","action":"auto","prompt":"guidance"})
}

#[test]
fn followup_capability_surface_is_plain_direct_only() {
    let names = |definitions: Vec<ToolDefinition>| {
        definitions
            .into_iter()
            .map(|definition| definition.function.name)
            .collect::<Vec<_>>()
    };
    let direct = names(crate::tools::direct_tool_definitions(false));
    let dwo = names(crate::tools::direct_with_orchestrator_tool_definitions(
        false,
    ));
    let child = names(crate::tools::worker_tool_definitions(false));
    for name in ["send_task_followup", "read_task_followup"] {
        assert!(direct.iter().any(|value| value == name));
        assert!(!dwo.iter().any(|value| value == name));
        assert!(!child.iter().any(|value| value == name));
        assert!(crate::tools::direct_tool_admission(name).is_some());
    }
}

#[test]
fn followup_nullable_bindings_preserve_raw_optional_task_scope() {
    let tool = SendTaskFollowupTool;
    let parameters = tool.definition().function.parameters;
    assert_eq!(
        parameters["required"],
        json!(["session_id", "request_id", "action", "prompt"])
    );
    for field in ["project_id", "run_id"] {
        assert_eq!(
            parameters["properties"][field]["type"],
            json!(["string", "null"])
        );
    }
    for action in ["queue", "auto"] {
        for explicit_null in [false, true] {
            let mut args = input();
            args["action"] = json!(action);
            if explicit_null {
                args["project_id"] = Value::Null;
                args["run_id"] = Value::Null;
            }
            let decoded = tool.decode(args).unwrap();
            let request = request(&decoded, "caller");
            assert!(request.project_id.is_none());
            assert!(request.expected_run_id.is_none());
        }
    }
    // Every declared field belongs to this flat input for every action.
    // Queue/auto may also explicitly bind a selected run; steer requires it.
    for action in ["queue", "auto", "steer"] {
        let mut args = input();
        args["action"] = json!(action);
        args["project_id"] = json!("selected-project");
        args["run_id"] = json!("selected-run");
        let decoded = tool.decode(args.clone()).unwrap();
        let projected = request(&decoded, "caller");
        assert_eq!(projected.project_id.as_deref(), Some("selected-project"));
        assert_eq!(projected.expected_run_id.as_deref(), Some("selected-run"));
        if action == "steer" {
            args["run_id"] = Value::Null;
            assert!(tool.decode(args).is_err());
        }
    }
}

async fn call(rt: &super::super::ToolRuntime, name: &str, args: Value) -> ToolResult {
    super::super::execute_tool(name, args, rt, &crate::model::ModelClient::new_for_test()).await
}

#[tokio::test]
async fn followup_requires_mutation_authority_and_headless_ask_fails_closed() {
    for rules in [
        vec![],
        vec![PermissionRule::new(
            "task_read",
            "*",
            PermissionEffect::Allow,
        )],
        vec![PermissionRule::new(
            "task_followup_auto",
            "session:target",
            PermissionEffect::Deny,
        )],
    ] {
        let (rt, calls) = runtime(rules);
        let result = call(&rt, "send_task_followup", input()).await;
        assert!(result.is_error, "{}", result.content);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(store::list_session_inbox(&rt.store_path, "target")
            .unwrap()
            .is_empty());
    }
}

#[tokio::test]
async fn followup_native_receipt_replay_changed_arguments_and_passive_inspection() {
    let (rt, calls) = runtime(vec![PermissionRule::new(
        "task_followup_auto",
        "session:target",
        PermissionEffect::Allow,
    )]);
    let created = call(&rt, "send_task_followup", input()).await;
    assert!(!created.is_error, "{}", created.content);
    let value: Value = serde_json::from_str(created.content.as_text().unwrap()).unwrap();
    assert_eq!(value["status"], "accepted_pending");
    let replay = call(&rt, "send_task_followup", input()).await;
    assert!(!replay.is_error);
    let replay: Value = serde_json::from_str(replay.content.as_text().unwrap()).unwrap();
    assert_eq!(
        replay["receipt"]["inbox_item_id"],
        value["receipt"]["inbox_item_id"]
    );
    assert_eq!(replay["receipt"]["replayed"], true);
    let mut changed = input();
    changed["prompt"] = json!("changed");
    assert!(call(&rt, "send_task_followup", changed).await.is_error);
    let before = calls.load(Ordering::SeqCst);
    let read = call(
        &rt,
        "read_task_followup",
        json!({"session_id":"target","request_id":"one"}),
    )
    .await;
    assert!(!read.is_error);
    assert_eq!(calls.load(Ordering::SeqCst), before);
    let missing = call(
        &rt,
        "read_task_followup",
        json!({"session_id":"other","request_id":"one"}),
    )
    .await;
    assert!(missing.content.as_text().unwrap().contains("not_found"));
    assert_eq!(
        store::list_session_inbox(&rt.store_path, "target")
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn followup_model_cannot_declare_human_origin_or_forge_caller_identity() {
    let (rt, calls) = runtime(vec![PermissionRule::new(
        "task_followup_auto",
        "session:target",
        PermissionEffect::Allow,
    )]);
    for (field, value) in [
        ("origin", json!("person")),
        ("authorized", json!(true)),
        ("caller_session_id", json!("someone-else")),
    ] {
        let mut args = input();
        args[field] = value;
        assert!(call(&rt, "send_task_followup", args).await.is_error);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert!(store::list_session_inbox(&rt.store_path, "target")
        .unwrap()
        .is_empty());
}
