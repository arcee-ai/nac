use super::*;
use crate::permissions::{PermissionBackend, PermissionBroker, PermissionEffect, PermissionRule};
use crate::store::{GoalStatus, InboxDelivery, NewProject};
use crate::tools::{execute_tool, ToolRuntime};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const CALLER: &str = "caller";

fn session(path: &Path, session_id: &str, project_id: Option<&str>, title: &str) {
    crate::store::insert_test_session(path, session_id);
    let conn = crate::store::open_runtime_connection(path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior = 'direct', cwd = ?2 WHERE session_id = ?1",
        [session_id, &location(project_id.unwrap_or("p1"))],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_presentations (session_id, title) VALUES (?1, ?2)",
        [session_id, title],
    )
    .unwrap();
    drop(conn);
    if let Some(project_id) = project_id {
        crate::store::assign_session_to_project(path, project_id, session_id).unwrap();
    }
}

fn location(project_id: &str) -> String {
    format!("/tmp/{project_id}")
}

fn project(path: &Path, project_id: &str) {
    crate::store::insert_project(
        path,
        NewProject {
            project_id: project_id.to_owned(),
            name: Some(project_id.to_owned()),
            description: None,
            cwd: PathBuf::from(location(project_id)),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
}

/// A direct primary in project `p1` with peers in `p1` and `p2`.
fn runtime(rules: Vec<PermissionRule>) -> ToolRuntime {
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = std::env::temp_dir()
        .join(format!("nac-task-tools-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    let path = runtime.store_path.clone();
    crate::store::initialize(&path).unwrap();
    project(&path, "p1");
    project(&path, "p2");
    session(&path, CALLER, Some("p1"), "coordinator ALL-469");
    session(&path, "peer-a", Some("p1"), "ALL-469 attempt one");
    session(&path, "peer-b", Some("p1"), "ALL-469 attempt two");
    session(&path, "foreign", Some("p2"), "ALL-469 elsewhere");
    runtime.session_id = Some(CALLER.into());
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        path,
        CALLER.into(),
        PermissionBackend::Local,
        0,
        rules,
    )));
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::DIRECT_TOOL_NAMES
            .iter()
            .map(|name| (*name).into())
            .collect(),
    ));
    runtime
}

async fn call(runtime: &ToolRuntime, name: &str, input: Value) -> ToolResult {
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        execute_tool(
            name,
            input,
            runtime,
            &crate::model::ModelClient::new_for_test(),
        ),
    )
    .await
    .expect("task reads never wait for an approver")
}

async fn value(runtime: &ToolRuntime, name: &str, input: Value) -> Value {
    let result = call(runtime, name, input).await;
    assert!(!result.is_error, "{}", result.content);
    serde_json::from_str(result.content.as_text().unwrap()).unwrap()
}

fn cleanup(runtime: &ToolRuntime) {
    let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
}

#[tokio::test]
async fn reference_search_defaults_to_the_callers_project_and_reports_every_attempt() {
    let runtime = runtime(Vec::new());
    let found = value(&runtime, "find_tasks", json!({"reference":"all-469"})).await;
    assert_eq!(found["status"], "ok");
    assert_eq!(found["scope"], json!({"project_id":"p1","explicit":false}));
    assert_eq!(found["ambiguous"], true);
    let ids = found["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|candidate| candidate["session_id"].as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(ids.len(), 2);
    assert!(ids.contains(&"peer-a") && ids.contains(&"peer-b"));
    assert!(!ids.contains(&CALLER) && !ids.contains(&"foreign"));
    assert_eq!(
        found["candidates"][0]["navigation"],
        format!("/session/{}", ids[0])
    );
    assert!(found["as_of"].is_string());

    let crossed = value(
        &runtime,
        "find_tasks",
        json!({"reference":"ALL-469","project_id":"p2"}),
    )
    .await;
    assert_eq!(crossed["scope"], json!({"project_id":"p2","explicit":true}));
    assert_eq!(crossed["candidates"][0]["session_id"], "foreign");
    assert_eq!(crossed["ambiguous"], false);

    let missing = value(&runtime, "find_tasks", json!({"project_id":"nope"})).await;
    assert_eq!(missing["status"], "project_not_found");
    cleanup(&runtime);
}

#[tokio::test]
async fn exact_reads_distinguish_found_missing_deleted_foreign_and_other_topologies() {
    let runtime = runtime(Vec::new());
    let path = runtime.store_path.clone();
    for (session_id, project_id) in [
        ("orchestrator-session", "p1"),
        ("foreign-orchestrator", "p2"),
    ] {
        crate::store::insert_test_session(&path, session_id);
        crate::store::open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET cwd = ?2 WHERE session_id = ?1",
                [session_id, &location(project_id)],
            )
            .unwrap();
        crate::store::assign_session_to_project(&path, project_id, session_id).unwrap();
    }

    let found = value(&runtime, "read_task", json!({"session_id":"peer-a"})).await;
    assert_eq!(found["status"], "found");
    assert_eq!(found["task"]["navigation"], "/session/peer-a");
    assert_eq!(found["task"]["ephemeral"]["approvals"], "unknown");
    assert_eq!(found["task"]["durable"]["goal"], Value::Null);

    let missing = value(&runtime, "read_task", json!({"session_id":"gone"})).await;
    assert_eq!(missing["status"], "not_found");

    let foreign = value(&runtime, "read_task", json!({"session_id":"foreign"})).await;
    assert_eq!(foreign["status"], "outside_scope");
    assert!(foreign.get("task").is_none());
    assert!(!foreign.to_string().contains("p2"));
    let wrong = value(
        &runtime,
        "read_task",
        json!({"session_id":"foreign","project_id":"p1"}),
    )
    .await;
    assert_eq!(wrong["status"], "outside_scope");
    let explicit = value(
        &runtime,
        "read_task",
        json!({"session_id":"foreign","project_id":"p2"}),
    )
    .await;
    assert_eq!(explicit["status"], "found");

    let other = value(
        &runtime,
        "find_tasks",
        json!({"session_id":"orchestrator-session"}),
    )
    .await;
    assert_eq!(other["status"], "not_independent_task");
    assert_eq!(other["kind"], "orchestrator");
    assert!(other.get("task").is_none());
    // Another project's non-task is reported out of scope before its kind is disclosed.
    let hidden = value(
        &runtime,
        "read_task",
        json!({"session_id":"foreign-orchestrator"}),
    )
    .await;
    assert_eq!(hidden["status"], "outside_scope");
    assert!(hidden.get("kind").is_none());

    let conn = crate::store::open_runtime_connection(&path).unwrap();
    crate::store::record_run_outcome_with_connection(
        &conn,
        "peer-b",
        "run-1",
        crate::store::RunOutcomeDisposition::Completed,
        Some("done"),
        None,
    )
    .unwrap();
    drop(conn);
    assert!(crate::sessions::delete_session(&path, "peer-b").unwrap());
    let deleted = value(&runtime, "read_task", json!({"session_id":"peer-b"})).await;
    assert_eq!(deleted["status"], "not_found");
    let retained: i64 = crate::store::open_runtime_connection(&path)
        .unwrap()
        .query_row(
            "SELECT count(*) FROM session_run_outcomes WHERE session_id = 'peer-b'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(retained, 0);
    cleanup(&runtime);
}

#[tokio::test]
async fn configured_deny_and_headless_ask_fail_closed_before_any_read() {
    let denied = runtime(vec![PermissionRule::new(
        "task_read",
        "project:p2",
        PermissionEffect::Deny,
    )]);
    let result = call(
        &denied,
        "find_tasks",
        json!({"reference":"ALL-469","project_id":"p2"}),
    )
    .await;
    assert!(result.is_error, "{}", result.content);
    assert!(!result.content.as_text().unwrap().contains("foreign"));
    // The caller's own project remains readable.
    value(&denied, "find_tasks", json!({})).await;
    cleanup(&denied);

    let asked = runtime(vec![PermissionRule::new(
        "task_read",
        "session:*",
        PermissionEffect::Ask,
    )]);
    let result = call(&asked, "read_task", json!({"session_id":"peer-a"})).await;
    assert!(result.is_error, "{}", result.content);
    assert!(!result.content.as_text().unwrap().contains("attempt one"));
    cleanup(&asked);
}

#[tokio::test]
async fn concrete_project_rules_apply_to_the_default_scope_and_exact_reads() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "project:p1",
        PermissionEffect::Deny,
    )]);
    for (tool, input) in [
        ("find_tasks", json!({})),
        ("find_tasks", json!({"session_id":"peer-a"})),
        ("read_task", json!({"session_id":"peer-a"})),
    ] {
        let result = call(&runtime, tool, input.clone()).await;
        assert!(result.is_error, "{tool} {input}: {}", result.content);
        assert!(!result.content.as_text().unwrap().contains("attempt one"));
    }
    cleanup(&runtime);
}

#[tokio::test]
async fn search_withholds_candidates_whose_session_is_not_plainly_allowed() {
    let runtime = runtime(vec![
        PermissionRule::new("task_read", "session:peer-b", PermissionEffect::Deny),
        PermissionRule::new("task_read", "session:peer-a", PermissionEffect::Ask),
    ]);
    let found = value(&runtime, "find_tasks", json!({"reference":"ALL-469"})).await;
    assert_eq!(found["candidates"], json!([]));
    assert_eq!(found["ambiguous"], false);
    assert!(found.get("withheld").is_none());
    assert!(!found.to_string().contains("attempt"));
    cleanup(&runtime);
}

#[tokio::test]
async fn reads_leave_pending_inbox_and_active_goal_untouched() {
    let runtime = runtime(Vec::new());
    let path = runtime.store_path.clone();
    let goal = crate::store::create_session_goal(&path, "peer-a", "finish", None, None).unwrap();
    let item = crate::store::create_session_inbox_item(
        &path,
        "peer-a",
        InboxDelivery::Queue,
        "next step",
        None,
        None,
    )
    .unwrap();
    let before = crate::store::list_session_inbox(&path, "peer-a").unwrap();

    for _ in 0..3 {
        let read = value(&runtime, "read_task", json!({"session_id":"peer-a"})).await;
        assert_eq!(read["task"]["durable"]["pending_inbox_items"], 1);
        assert_eq!(read["task"]["durable"]["goal"]["goal_id"], goal.goal_id);
        assert_eq!(read["task"]["durable"]["goal"]["status"], "active");
        assert_eq!(read["task"]["durable"]["current_run"], Value::Null);
        value(&runtime, "find_tasks", json!({"session_id":"peer-a"})).await;
    }

    assert_eq!(
        crate::store::list_session_inbox(&path, "peer-a").unwrap(),
        before
    );
    assert_eq!(before[0].id, item.id);
    assert_eq!(
        crate::store::load_session_goal(&path, "peer-a").unwrap(),
        Some(goal)
    );
    assert!(crate::store::load_run_recovery(&path, "peer-a")
        .unwrap()
        .is_none());
    cleanup(&runtime);
}

#[tokio::test]
async fn discovery_is_unavailable_without_a_persisted_direct_primary() {
    let mut runtime = runtime(Vec::new());
    runtime.permission_broker = None;
    let result = call(&runtime, "find_tasks", json!({})).await;
    assert!(result.is_error);
    cleanup(&runtime);
}

#[tokio::test]
async fn arguments_are_bounded_and_selectors_are_exclusive() {
    let runtime = runtime(Vec::new());
    for input in [
        json!({"session_id":"peer-a","reference":"ALL-469"}),
        json!({"reference":"x".repeat(store::MAX_TASK_REFERENCE_BYTES + 1)}),
        json!({"limit":0}),
        json!({"limit":store::MAX_TASK_SEARCH_LIMIT + 1}),
        json!({"after":"not-a-cursor"}),
        json!({"unknown":true}),
    ] {
        assert!(
            call(&runtime, "find_tasks", input.clone()).await.is_error,
            "{input}"
        );
    }
    assert!(call(&runtime, "read_task", json!({})).await.is_error);
    cleanup(&runtime);
}

#[test]
fn navigation_percent_encodes_unexpected_bytes() {
    assert_eq!(navigation("abc-123"), "/session/abc-123");
    assert_eq!(navigation("a/b?c"), "/session/a%2Fb%3Fc");
}

#[tokio::test]
async fn ambiguity_is_unknown_until_the_last_page_when_one_match_is_visible() {
    let runtime = runtime(Vec::new());
    let first = value(
        &runtime,
        "find_tasks",
        json!({"reference":"ALL-469","limit":1}),
    )
    .await;
    assert_eq!(first["candidates"].as_array().unwrap().len(), 1);
    assert_eq!(first["ambiguous"], Value::Null);
    let second = value(
        &runtime,
        "find_tasks",
        json!({"reference":"ALL-469","limit":1,"after":first["next_after"]}),
    )
    .await;
    assert_eq!(second["candidates"].as_array().unwrap().len(), 1);
    assert_ne!(
        first["candidates"][0]["session_id"],
        second["candidates"][0]["session_id"]
    );
    assert_eq!(second["ambiguous"], Value::Null);

    // The cursor is opaque and resumes only this chat's search of this project.
    let token = first["next_after"].as_str().unwrap();
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()), "{token}");
    let crossed = call(
        &runtime,
        "find_tasks",
        json!({"reference":"ALL-469","project_id":"p2","after":token}),
    )
    .await;
    assert!(crossed.is_error, "{}", crossed.content);
    let forged = call(
        &runtime,
        "find_tasks",
        json!({"after":"2026-01-01T00:00:00Z|1"}),
    )
    .await;
    assert!(forged.is_error, "{}", forged.content);
    cleanup(&runtime);
}

#[tokio::test(flavor = "multi_thread")]
async fn results_are_identical_across_store_owner_changes() {
    let runtime = runtime(Vec::new());
    let path = runtime.store_path.clone();
    let goal = crate::store::create_session_goal(&path, "peer-a", "done", None, None).unwrap();
    crate::store::update_session_goal_by_model(
        &path,
        "peer-a",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let observe = |mut value: Value| {
        value.as_object_mut().unwrap().remove("as_of");
        value
    };
    let without_owner = (
        observe(value(&runtime, "read_task", json!({"session_id":"peer-a"})).await),
        observe(value(&runtime, "find_tasks", json!({"reference":"ALL-469"})).await),
    );
    for _ in 0..2 {
        let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
        // Goal replacement through the owner keeps the completed goal provable.
        let replaced =
            crate::store::create_session_goal(&path, "peer-b", "again", None, None).unwrap();
        crate::store::clear_session_goal(&path, "peer-b", &replaced.goal_id, replaced.version)
            .unwrap();
        let through_owner = (
            observe(value(&runtime, "read_task", json!({"session_id":"peer-a"})).await),
            observe(value(&runtime, "find_tasks", json!({"reference":"ALL-469"})).await),
        );
        assert_eq!(through_owner.0, without_owner.0);
        assert_eq!(
            through_owner.1["candidates"].as_array().unwrap().len(),
            without_owner.1["candidates"].as_array().unwrap().len()
        );
        owner.shutdown().await.unwrap();
        drop(owner);
    }
    let after = observe(value(&runtime, "read_task", json!({"session_id":"peer-b"})).await);
    assert_eq!(
        after["task"]["durable"]["prior_goals"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        after["task"]["durable"]["prior_goals"][0]["retirement"],
        "cleared"
    );
    cleanup(&runtime);
}

#[tokio::test]
async fn unreadable_store_fails_closed_without_task_data() {
    let runtime = runtime(Vec::new());
    std::fs::write(&runtime.store_path, b"not a sqlite database").unwrap();
    let result = call(&runtime, "read_task", json!({"session_id":"peer-a"})).await;
    assert!(result.is_error);
    let text = result.content.as_text().unwrap();
    assert!(text.contains("could not be read"), "{text}");
    assert!(!text.contains("attempt one"));
    cleanup(&runtime);
}

#[tokio::test]
async fn observing_reads_never_become_an_interactive_approver() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "session:peer-b",
        PermissionEffect::Ask,
    )]);
    let bus = crate::events::SessionEventBus::new(Some(CALLER.into()));
    runtime
        .permission_broker
        .as_ref()
        .unwrap()
        .attach_event_bus(bus.clone());

    value(&runtime, "find_tasks", json!({"reference":"ALL-469"})).await;
    value(&runtime, "read_task", json!({"session_id":"peer-a"})).await;
    assert!(!bus.has_subscribers());
    let result = call(&runtime, "read_task", json!({"session_id":"peer-b"})).await;
    assert!(result.is_error, "{}", result.content);
    assert!(!bus.has_interactive_subscribers());
    cleanup(&runtime);
}

#[tokio::test]
async fn store_failure_after_admission_is_reported_unavailable() {
    let runtime = runtime(Vec::new());
    let conn = crate::store::open_runtime_connection(&runtime.store_path).unwrap();
    conn.execute_batch(
        "DROP TABLE session_run_outcomes; CREATE VIEW session_run_outcomes AS SELECT 1 AS id;",
    )
    .unwrap();
    drop(conn);

    let result = call(&runtime, "read_task", json!({"session_id":"peer-a"})).await;
    assert!(result.is_error);
    let reported: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(reported["status"], "unavailable");
    assert!(!reported.to_string().contains("attempt one"));
    cleanup(&runtime);
}

#[tokio::test]
async fn a_wildcard_ask_prompts_once_for_the_callers_own_project() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "*",
        PermissionEffect::Ask,
    )]);
    let broker = Arc::clone(runtime.permission_broker.as_ref().unwrap());
    broker.remember_caller_project("p1");
    let bus = crate::events::SessionEventBus::new(Some(CALLER.into()));
    let _approver = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);

    for (name, input) in [
        ("find_tasks", json!({"reference":"ALL-469"})),
        ("read_task", json!({"session_id":"peer-a"})),
    ] {
        let call = {
            let runtime = runtime.clone();
            tokio::spawn(async move { value(&runtime, name, input).await })
        };
        let mut answered = 0;
        while !call.is_finished() {
            for request in broker.pending() {
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Once)
                    .unwrap();
                answered += 1;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        assert_eq!(
            call.await.unwrap()["status"],
            json!(match name {
                "find_tasks" => "ok",
                _ => "found",
            })
        );
        assert_eq!(answered, 1, "{name} asked {answered} times");
    }
    cleanup(&runtime);
}

#[tokio::test]
async fn oversized_goal_objectives_keep_the_snapshot_bounded() {
    let runtime = runtime(Vec::new());
    let path = runtime.store_path.clone();
    let huge = "x".repeat(100_000);
    let mut retired = Vec::new();
    for _ in 0..crate::store::RETAINED_GOAL_OUTCOMES {
        let goal = crate::store::create_session_goal(&path, "peer-a", &huge, None, None).unwrap();
        crate::store::clear_session_goal(&path, "peer-a", &goal.goal_id, goal.version).unwrap();
        retired.push(goal.goal_id);
    }
    let current = crate::store::create_session_goal(&path, "peer-a", &huge, None, None).unwrap();

    let result = call(&runtime, "read_task", json!({"session_id":"peer-a"})).await;
    let text = result.content.as_text().unwrap();
    assert!(!result.is_error, "{text}");
    assert!(
        text.len() < 32 * 1024,
        "read_task returned {} bytes",
        text.len()
    );
    let read: Value = serde_json::from_str(text).unwrap();
    let durable = &read["task"]["durable"];
    assert_eq!(durable["goal"]["goal_id"], current.goal_id);
    assert_eq!(durable["goal"]["version"], current.version);
    assert_eq!(durable["goal_objective_truncated"], true);
    let prior = durable["prior_goals"].as_array().unwrap();
    assert_eq!(prior.len(), crate::store::RETAINED_GOAL_OUTCOMES);
    assert!(prior.iter().all(|goal| goal["objective_truncated"] == true));
    assert_eq!(prior[0]["goal_id"], json!(retired.last().unwrap()));
    cleanup(&runtime);
}

#[tokio::test]
async fn denied_sessions_beyond_the_scan_bound_change_no_page_metadata() {
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "session:*",
        PermissionEffect::Deny,
    )]);
    let path = runtime.store_path.clone();
    let page = || async {
        let mut page = value(&runtime, "find_tasks", json!({"reference":"ALL-469"})).await;
        page.as_object_mut().unwrap().remove("as_of");
        page
    };
    let before = page().await;
    assert_eq!(before["candidates"], json!([]));
    assert_eq!(before["next_after"], Value::Null);
    assert_eq!(before["scan_limit_reached"], false);
    assert_eq!(before["ambiguous"], false);

    for index in 0..=crate::store::TASK_SEARCH_SCAN_LIMIT {
        session(
            &path,
            &format!("denied-{index:04}"),
            Some("p1"),
            "ALL-469 hidden",
        );
    }
    assert_eq!(page().await, before);
    cleanup(&runtime);
}
