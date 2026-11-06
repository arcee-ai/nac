use super::*;
use crate::{
    permissions::{PermissionBackend, PermissionBroker, PermissionEffect, PermissionRule},
    task_launch_control::{
        NativeTaskReceipt, NativeTaskRequest, SavedTaskProject, TaskLaunchController,
    },
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

struct Controller {
    resolves: AtomicUsize,
    launches: AtomicUsize,
    reservations: AtomicUsize,
    project_reads: AtomicUsize,
    status_reads: AtomicUsize,
    store_path: std::path::PathBuf,
    cwd: std::path::PathBuf,
}
impl Controller {
    fn target(&self) -> SavedTaskProject {
        SavedTaskProject {
            project_id: "p".into(),
            name: "Project".into(),
            cwd: self.cwd.clone(),
            ssh_host: None,
            default_model_config_id: None,
            default_model: None,
            default_reasoning_effort: None,
            default_ref: None,
            eligible: true,
            eligibility_detail: "Local".into(),
        }
    }
}
impl TaskLaunchController for Controller {
    fn projects<'a>(&'a self, _: &'a str) -> BoxFuture<'a, anyhow::Result<Vec<SavedTaskProject>>> {
        Box::pin(async move {
            self.project_reads.fetch_add(1, Ordering::SeqCst);
            Ok(vec![self.target()])
        })
    }
    fn resolve<'a>(
        &'a self,
        _: &'a str,
        _: &'a NativeTaskRequest,
    ) -> BoxFuture<'a, anyhow::Result<SavedTaskProject>> {
        Box::pin(async move {
            self.resolves.fetch_add(1, Ordering::SeqCst);
            Ok(self.target())
        })
    }
    fn launch<'a>(
        &'a self,
        caller: &'a str,
        request: NativeTaskRequest,
        target: SavedTaskProject,
        _: task_launch_control::NativeTaskAuthorization,
    ) -> BoxFuture<'a, anyhow::Result<NativeTaskReceipt>> {
        Box::pin(async move {
            self.launches.fetch_add(1, Ordering::SeqCst);
            crate::store::reserve_native_task_launch(
                &self.store_path,
                caller,
                &target.project_id,
                &target.cwd,
                false,
                request,
            )?;
            self.reservations.fetch_add(1, Ordering::SeqCst);
            Err(anyhow::anyhow!("reached launch"))
        })
    }
    fn status<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
    ) -> BoxFuture<'a, anyhow::Result<NativeTaskReceipt>> {
        Box::pin(async move {
            self.status_reads.fetch_add(1, Ordering::SeqCst);
            Err(anyhow::anyhow!("not found"))
        })
    }
}
fn fixture(rules: Vec<PermissionRule>) -> (super::super::ToolRuntime, Arc<Controller>) {
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = std::env::temp_dir()
        .join(format!("nac-native-tools-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&runtime.store_path).unwrap();
    crate::store::insert_test_session(&runtime.store_path, "caller");
    let conn = crate::store::open_runtime_connection(&runtime.store_path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct',cwd=?1,store_path=?2 WHERE session_id='caller'",
        rusqlite::params![
            runtime.workspace_cwd.to_string_lossy(),
            runtime.store_path.to_string_lossy()
        ],
    )
    .unwrap();
    drop(conn);
    crate::store::insert_project(
        &runtime.store_path,
        crate::store::NewProject {
            project_id: "p".into(),
            name: None,
            description: None,
            cwd: runtime.workspace_cwd.clone(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    crate::store::assign_session_to_project(&runtime.store_path, "p", "caller").unwrap();
    runtime.session_id = Some("caller".into());
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        rules,
    )));
    let controller = Arc::new(Controller {
        resolves: AtomicUsize::new(0),
        launches: AtomicUsize::new(0),
        reservations: AtomicUsize::new(0),
        project_reads: AtomicUsize::new(0),
        status_reads: AtomicUsize::new(0),
        store_path: runtime.store_path.clone(),
        cwd: runtime.workspace_cwd.clone(),
    });
    task_launch_control::register_controller(runtime.store_path.clone(), controller.clone());
    (runtime, controller)
}
fn request() -> Value {
    json!({"request_id":uuid::Uuid::new_v4().to_string(),"title":"Separate work","prompt":"Use the fresh brief","skill":"qa"})
}
async fn call(runtime: &super::super::ToolRuntime, name: &str, args: Value) -> ToolResult {
    crate::tools::execute_tool(
        name,
        args,
        runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await
}

async fn automatic_launch_is_denied(goal_id: Option<String>) {
    let (mut runtime, controller) =
        fixture(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    runtime.heartbeat_execution = true;
    runtime.heartbeat_goal_id = goal_id;
    for project in [None, Some("p")] {
        let mut input = request();
        input["project_id"] = json!(project);
        let request_id = input["request_id"].as_str().unwrap().to_owned();
        let result = call(&runtime, "launch_task", input).await;
        let reserved = crate::store::load_native_task_launch(&runtime.store_path, &request_id)
            .unwrap()
            .is_some();
        eprintln!(
            "automatic launch: goal={:?} project={project:?} resolves={} launches={} reservations={} durable_intent={reserved} result={}",
            runtime.heartbeat_goal_id,
            controller.resolves.load(Ordering::SeqCst),
            controller.launches.load(Ordering::SeqCst),
            controller.reservations.load(Ordering::SeqCst),
            result.content
        );
        assert!(result.is_error);
        assert!(result
            .content
            .to_string()
            .contains("heartbeat cannot create a new conversation"));
        assert_eq!(controller.resolves.load(Ordering::SeqCst), 0);
        assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
        assert_eq!(controller.reservations.load(Ordering::SeqCst), 0);
        assert!(!reserved);
        assert!(runtime.heartbeat_needs_human_action.load(Ordering::Acquire));
        assert!(runtime
            .permission_broker
            .as_ref()
            .unwrap()
            .pending()
            .is_empty());
    }
    let conn = crate::store::open_runtime_connection(&runtime.store_path).unwrap();
    let sessions: i64 = conn
        .query_row("SELECT count(*) FROM sessions", [], |r| r.get(0))
        .unwrap();
    assert_eq!(sessions, 1);
    drop(conn);
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn automatic_native_launch_with_bound_goal_is_hard_denied_under_allow() {
    automatic_launch_is_denied(Some("bound-goal".into())).await;
}

#[tokio::test]
async fn automatic_native_launch_without_goal_is_hard_denied_under_allow() {
    automatic_launch_is_denied(None).await;
}

#[tokio::test]
async fn automatic_native_handle_launch_is_denied_before_resolution() {
    let (mut runtime, controller) =
        fixture(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    runtime.heartbeat_execution = true;
    let registry = super::super::kernel::ToolRegistry::builder()
        .register(LaunchTaskTool)
        .finish()
        .unwrap();
    let handle = registry.native_handle::<LaunchTaskTool>().unwrap();
    let client = crate::model::ModelClient::new_for_test();
    let result = handle
        .invoke(
            LaunchTaskTool.decode(request()).unwrap(),
            ToolServices {
                runtime: &runtime,
                client: &client,
            },
            &ToolCallContext::default(),
        )
        .await;
    assert!(result.is_error);
    assert!(result
        .content
        .to_string()
        .contains("heartbeat cannot create a new conversation"));
    assert_eq!(controller.resolves.load(Ordering::SeqCst), 0);
    assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
    assert_eq!(controller.reservations.load(Ordering::SeqCst), 0);
    assert!(runtime.heartbeat_needs_human_action.load(Ordering::Acquire));
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn intentional_native_launch_under_allow_reaches_durable_reservation() {
    let (runtime, controller) =
        fixture(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    let input = request();
    let request_id = input["request_id"].as_str().unwrap().to_owned();
    let result = call(&runtime, "launch_task", input).await;
    assert!(
        result.content.to_string().contains("reached launch"),
        "{}",
        result.content
    );
    assert_eq!(controller.resolves.load(Ordering::SeqCst), 1);
    assert_eq!(controller.launches.load(Ordering::SeqCst), 1);
    assert_eq!(controller.reservations.load(Ordering::SeqCst), 1);
    assert!(
        crate::store::load_native_task_launch(&runtime.store_path, &request_id)
            .unwrap()
            .is_some()
    );
    assert!(!runtime.heartbeat_needs_human_action.load(Ordering::Acquire));
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn native_launch_allow_cannot_substitute_a_local_backend() {
    let (mut runtime, controller) =
        fixture(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    runtime.backend = Arc::new(crate::sandbox::ExecutionBackend::Ssh(
        crate::sandbox::SshBackend::new("unused.invalid".into(), "/remote".into()),
    ));
    let result = call(&runtime, "launch_task", request()).await;
    assert!(result.is_error);
    assert!(result
        .content
        .to_string()
        .contains("backend substitution is unavailable"));
    assert_eq!(controller.resolves.load(Ordering::SeqCst), 0);
    assert_eq!(controller.reservations.load(Ordering::SeqCst), 0);
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn native_launch_allow_cannot_admit_after_cancellation() {
    let (runtime, controller) =
        fixture(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    runtime.command_cancellation.cancel();
    let result = call(&runtime, "launch_task", request()).await;
    assert!(result.is_error);
    assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
    assert_eq!(controller.reservations.load(Ordering::SeqCst), 0);
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn automatic_native_project_and_status_reads_remain_passive() {
    let (mut runtime, controller) =
        fixture(vec![PermissionRule::new("*", "*", PermissionEffect::Allow)]);
    runtime.heartbeat_execution = true;
    for goal_id in [None, Some("bound-goal".into())] {
        runtime.heartbeat_goal_id = goal_id;
        assert!(!call(&runtime, "list_projects", json!({})).await.is_error);
        let status = call(
            &runtime,
            "task_launch_status",
            json!({"request_id":uuid::Uuid::new_v4().to_string()}),
        )
        .await;
        assert!(
            status.content.to_string().contains("not found"),
            "{}",
            status.content
        );
    }
    assert_eq!(controller.project_reads.load(Ordering::SeqCst), 2);
    assert_eq!(controller.status_reads.load(Ordering::SeqCst), 2);
    assert_eq!(controller.resolves.load(Ordering::SeqCst), 0);
    assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
    assert_eq!(controller.reservations.load(Ordering::SeqCst), 0);
    assert!(!runtime.heartbeat_needs_human_action.load(Ordering::Acquire));
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn native_concrete_project_denial_precedes_launch_even_when_project_is_omitted() {
    let (runtime, controller) = fixture(vec![PermissionRule::new(
        "task_launch",
        "project:p",
        PermissionEffect::Deny,
    )]);
    let result = call(&runtime, "launch_task", request()).await;
    assert!(result.is_error);
    assert!(result.content.to_string().contains("permission denied"));
    assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn native_launch_requires_attached_agent_authority_and_has_no_human_json_bypass() {
    let (mut runtime, controller) = fixture(vec![]);
    let mut input = request();
    input["human"] = json!(true);
    assert!(call(&runtime, "launch_task", input).await.is_error);
    runtime.permission_broker = None;
    assert!(call(&runtime, "launch_task", request()).await.is_error);
    assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[tokio::test]
async fn native_launch_ask_is_headless_fail_closed_and_project_reads_are_passive() {
    let (runtime, controller) = fixture(vec![PermissionRule::new(
        "task_launch",
        "*",
        PermissionEffect::Ask,
    )]);
    assert!(call(&runtime, "launch_task", request()).await.is_error);
    let projects = call(&runtime, "list_projects", json!({"query":"Project"})).await;
    assert!(!projects.is_error, "{}", projects.content);
    let unfiltered = call(&runtime, "list_projects", json!({"query":null})).await;
    assert!(!unfiltered.is_error, "{}", unfiltered.content);
    let discovered: Value = serde_json::from_str(unfiltered.content.as_text().unwrap()).unwrap();
    assert_eq!(discovered["candidates"].as_array().unwrap().len(), 1);
    assert_eq!(discovered["candidates"][0]["project_id"], "p");
    assert_eq!(controller.launches.load(Ordering::SeqCst), 0);
    std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
}

#[test]
fn launch_tools_are_direct_only_and_named_skill_is_fresh_brief_content() {
    let worker = crate::tools::worker_tool_definitions(false);
    let direct = crate::tools::direct_tool_definitions(false);
    for name in ["list_projects", "launch_task", "task_launch_status"] {
        assert!(!worker.iter().any(|d| d.function.name == name));
        assert!(direct.iter().any(|d| d.function.name == name));
    }
    let input = LaunchTaskTool.decode(request()).unwrap();
    assert!(input
        .initial_prompt()
        .starts_with("Use the requested skill $qa."));
    assert!(!input.initial_prompt().contains("goal"));
}

#[tokio::test]
async fn pinned_git_preparation_uses_agent_ask_deny_and_exact_targets() {
    for rules in [
        vec![
            PermissionRule::new("*", "*", PermissionEffect::Allow),
            PermissionRule::new("execute", "*", PermissionEffect::Ask),
            PermissionRule::new("execute", "command:[git]*", PermissionEffect::Allow),
        ],
        vec![PermissionRule::new(
            "execute",
            "command:[git]*",
            PermissionEffect::Deny,
        )],
        vec![PermissionRule::new("execute", "*", PermissionEffect::Deny)],
        vec![],
        vec![PermissionRule::new("*", "*", PermissionEffect::Allow)],
    ] {
        let allowed = rules
            .last()
            .is_some_and(|rule| rule.effect == PermissionEffect::Allow);
        let (runtime, _) = fixture(rules);
        let id = uuid::Uuid::new_v4().to_string();
        let source = runtime.workspace_cwd.clone();
        let launch = crate::store::TaskLaunchRecord {
            request: crate::store::TaskLaunchRequest {
                request_id: id.clone(),
                project_id: "p".into(),
                invoking_session_id: runtime.session_id.clone(),
                git_ref: None,
                default_ref: Some("main".into()),
                title: "Separate task".into(),
                prompt: "Brief".into(),
            },
            source: crate::store::TaskLaunchSource {
                project_cwd: source.clone(),
                source_cwd: source.clone(),
                repo_root: source.clone(),
                common_git_dir: source.join(".git"),
                repository_identity: "fixture".into(),
                subdirectory: Default::default(),
                default_ref: "main".into(),
                selected_ref: "HEAD".into(),
                commit: "a".repeat(40),
                excluded_source_edits: true,
            },
            session_id: id.clone(),
            workspace_path: runtime
                .store_path
                .parent()
                .unwrap()
                .join("task-worktrees")
                .join(id),
            phase: crate::store::TaskLaunchPhase::Pinned,
            error: None,
            first_input_id: None,
            session_present: false,
            created_at: "now".into(),
            updated_at: "now".into(),
        };
        let authorization = task_launch_control::NativeTaskAuthorization::new(
            &runtime,
            &ToolCallContext::default(),
        );
        let outcome = authorization.authorize_preparation(&launch).await;
        assert_eq!(outcome.is_ok(), allowed, "{outcome:?}");
        if !allowed {
            assert!(outcome
                .unwrap_err()
                .to_string()
                .contains("permission denied"));
        }
        assert!(
            !launch.workspace_path.exists(),
            "authorization creates no workspace"
        );
        std::fs::remove_dir_all(runtime.store_path.parent().unwrap()).unwrap();
    }
}

#[test]
fn native_launch_wire_inputs_match_nullable_fields_and_each_workspace_choice() {
    let schema = LaunchTaskTool.definition().function.parameters;
    let nullable = [
        "project_id",
        "skill",
        "model",
        "reasoning_effort",
        "git_ref",
        "default_ref",
    ];
    for name in nullable {
        assert_eq!(
            schema["properties"][name]["type"],
            json!(["string", "null"])
        );
    }
    for workspace in ["auto", "clean_ref", "existing_checkout"] {
        let mut input = request();
        for name in nullable {
            input[name] = Value::Null;
        }
        input["workspace"] = json!(workspace);
        let decoded = LaunchTaskTool.decode(input).unwrap();
        assert_eq!(
            serde_json::to_value(decoded.workspace).unwrap(),
            json!(workspace)
        );
        assert!(decoded.project_id.is_none());
        assert!(decoded.model.is_none());
        assert!(decoded.reasoning_effort.is_none());
    }
    let mut minimal = request();
    minimal.as_object_mut().unwrap().remove("skill");
    assert_eq!(
        LaunchTaskTool.decode(minimal.clone()).unwrap().workspace,
        crate::task_launch_control::TaskWorkspace::Auto
    );
    // Null is not advertised for workspace; the decoder rejects that shape.
    assert_eq!(schema["properties"]["workspace"]["type"], "string");
    minimal["workspace"] = Value::Null;
    assert!(LaunchTaskTool.decode(minimal).is_err());
    assert!(ListProjectsTool
        .decode(json!({"query":null}))
        .unwrap()
        .query
        .is_none());
    assert!(ListProjectsTool.decode(json!({})).unwrap().query.is_none());
    assert!(TaskLaunchStatusTool
        .decode(json!({"request_id":uuid::Uuid::new_v4().to_string()}))
        .is_ok());
    assert!(TaskLaunchStatusTool
        .decode(json!({"request_id":null}))
        .is_err());
}

#[test]
fn native_advertised_prompt_boundary_leaves_room_for_the_longest_skill_handoff() {
    let max = LaunchTaskTool.definition().function.parameters["properties"]["prompt"]["maxLength"]
        .as_u64()
        .unwrap() as usize;
    let mut input = request();
    input["prompt"] = json!("a".repeat(max));
    input["skill"] = json!("s".repeat(256));
    assert!(LaunchTaskTool.decode(input.clone()).is_ok());
    input["prompt"] = json!("a".repeat(max + 1));
    assert!(LaunchTaskTool.decode(input).is_err());
}
