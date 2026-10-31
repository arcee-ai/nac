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
    launches: AtomicUsize,
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
        Box::pin(async move { Ok(vec![self.target()]) })
    }
    fn resolve<'a>(
        &'a self,
        _: &'a str,
        _: &'a NativeTaskRequest,
    ) -> BoxFuture<'a, anyhow::Result<SavedTaskProject>> {
        Box::pin(async move { Ok(self.target()) })
    }
    fn launch<'a>(
        &'a self,
        _: &'a str,
        _: NativeTaskRequest,
        _: SavedTaskProject,
        _: task_launch_control::NativeTaskAuthorization,
    ) -> BoxFuture<'a, anyhow::Result<NativeTaskReceipt>> {
        Box::pin(async move {
            self.launches.fetch_add(1, Ordering::SeqCst);
            Err(anyhow::anyhow!("reached launch"))
        })
    }
    fn status<'a>(
        &'a self,
        _: &'a str,
        _: &'a str,
    ) -> BoxFuture<'a, anyhow::Result<NativeTaskReceipt>> {
        Box::pin(async move { Err(anyhow::anyhow!("not found")) })
    }
}
fn fixture(rules: Vec<PermissionRule>) -> (super::super::ToolRuntime, Arc<Controller>) {
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = std::env::temp_dir()
        .join(format!("nac-native-tools-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&runtime.store_path).unwrap();
    crate::store::insert_test_session(&runtime.store_path, "caller");
    runtime.session_id = Some("caller".into());
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        rules,
    )));
    let controller = Arc::new(Controller {
        launches: AtomicUsize::new(0),
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
