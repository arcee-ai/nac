use std::sync::{Arc, Mutex};

use super::*;
use crate::traditional_children::{ChildFuture, TraditionalChildController};

#[test]
fn child_outcome_projection_is_typed_and_preview_does_not_expose_raw_fields() {
    for (status, expected, preview) in [
        (
            TraditionalChildStatus::Completed,
            crate::events::DelegationOutcome::Completed,
            "Subagent completed",
        ),
        (
            TraditionalChildStatus::Failed,
            crate::events::DelegationOutcome::Failed,
            "Subagent failed",
        ),
        (
            TraditionalChildStatus::Cancelled,
            crate::events::DelegationOutcome::Cancelled,
            "Subagent cancelled",
        ),
        (
            TraditionalChildStatus::Interrupted,
            crate::events::DelegationOutcome::Interrupted,
            "Subagent interrupted",
        ),
    ] {
        let mut record = child(status, TraditionalChildExecutionMode::Foreground);
        record.report = Some("RAW_SECRET_PAYLOAD".to_string());
        let result = outcome_result(record);
        assert_eq!(result.delegation_outcome, Some(expected));
        let event = crate::events::AgentEvent::tool_call_finished(
            "call".into(),
            "subagent".into(),
            &result,
        );
        let encoded = serde_json::to_string(&event).unwrap();
        assert!(!encoded.contains("RAW_SECRET_PAYLOAD"));
        assert!(!encoded.contains("child-1"));
        let decoded: crate::events::AgentEvent = serde_json::from_str(&encoded).unwrap();
        match crate::events::sanitize_external_agent_event(decoded).unwrap() {
            crate::events::AgentEvent::ToolCallFinished {
                delegation_outcome,
                content_preview,
                ..
            } => {
                assert_eq!(delegation_outcome, Some(expected));
                assert_eq!(content_preview, preview);
            }
            _ => panic!("expected tool finish"),
        }
    }
}

#[test]
fn status_and_cancel_previews_hide_raw_child_records() {
    let result = ToolResult::text(r#"{"child_session_id":"secret","status":"running"}"#, false);
    assert_eq!(
        crate::agent::preview::preview_tool_result("subagent_status", &result),
        "Subagent status retrieved"
    );
    assert_eq!(
        crate::agent::preview::preview_tool_result("subagent_cancel", &result),
        "Subagent cancellation request finished"
    );
    for status in [
        TraditionalChildStatus::Completed,
        TraditionalChildStatus::Failed,
        TraditionalChildStatus::Cancelled,
        TraditionalChildStatus::Interrupted,
    ] {
        let result = outcome_result(child(status, TraditionalChildExecutionMode::Foreground));
        assert_eq!(
            crate::agent::preview::preview_tool_result("subagent_status", &result),
            "Subagent status retrieved"
        );
        assert_eq!(
            crate::agent::preview::preview_tool_result("subagent_cancel", &result),
            "Subagent cancellation request finished"
        );
    }
    let request_error = ToolResult::text("raw error", true);
    assert_eq!(
        crate::agent::preview::preview_tool_result("subagent_status", &request_error),
        "Subagent request failed"
    );
}

#[test]
fn successful_control_requests_keep_child_outcome_separate() {
    for (status, outcome) in [
        (
            TraditionalChildStatus::Completed,
            crate::events::DelegationOutcome::Completed,
        ),
        (
            TraditionalChildStatus::Failed,
            crate::events::DelegationOutcome::Failed,
        ),
        (
            TraditionalChildStatus::Cancelled,
            crate::events::DelegationOutcome::Cancelled,
        ),
        (
            TraditionalChildStatus::Interrupted,
            crate::events::DelegationOutcome::Interrupted,
        ),
    ] {
        for (name, preview) in [
            ("subagent_status", "Subagent status retrieved"),
            ("subagent_cancel", "Subagent cancellation request finished"),
        ] {
            let mut record = child(status, TraditionalChildExecutionMode::Foreground);
            record.report = Some("RAW_SECRET".into());
            let result = control_result(record);
            assert!(!result.is_error);
            let event =
                crate::events::AgentEvent::tool_call_finished("call".into(), name.into(), &result);
            let encoded = serde_json::to_string(&event).unwrap();
            assert!(!encoded.contains("RAW_SECRET"));
            assert!(!encoded.contains("child-1"));
            assert!(
                matches!(event, crate::events::AgentEvent::ToolCallFinished {
                is_error: false, completion_status: Some(crate::events::ToolCompletionStatus::Success),
                delegation_outcome: Some(actual), content_preview, ..
            } if actual == outcome && content_preview == preview)
            );
        }
    }
}

struct FakeController {
    starts: Mutex<Vec<TraditionalChildStartRequest>>,
}

fn child(
    status: TraditionalChildStatus,
    mode: TraditionalChildExecutionMode,
) -> TraditionalChildRecord {
    TraditionalChildRecord {
        child_session_id: "child-1".to_string(),
        parent_session_id: "parent-1".to_string(),
        root_session_id: "parent-1".to_string(),
        profile: GENERAL_CHILD_PROFILE.to_string(),
        description: "review store".to_string(),
        nesting_depth: 1,
        status,
        generation: 1,
        run_id: Some("run-1".to_string()),
        execution_mode: Some(mode),
        report: status.is_terminal().then(|| "review complete".to_string()),
        failure: None,
        change_summary: None,
        verification_summary: None,
        completion_inbox_id: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
        updated_at: "2026-01-01T00:00:00Z".to_string(),
        version: 1,
    }
}

impl TraditionalChildController for FakeController {
    fn start<'a>(
        &'a self,
        request: TraditionalChildStartRequest,
    ) -> ChildFuture<'a, TraditionalChildRecord> {
        let mode = request.execution_mode;
        self.starts.lock().unwrap().push(request);
        Box::pin(async move { Ok(child(TraditionalChildStatus::Running, mode)) })
    }

    fn wait<'a>(
        &'a self,
        _child_session_id: &'a str,
        _generation: u64,
    ) -> ChildFuture<'a, TraditionalChildRecord> {
        Box::pin(async {
            Ok(child(
                TraditionalChildStatus::Completed,
                TraditionalChildExecutionMode::Foreground,
            ))
        })
    }

    fn cancel<'a>(
        &'a self,
        _parent_session_id: &'a str,
        _child_session_id: &'a str,
        _expected_generation: u64,
    ) -> ChildFuture<'a, TraditionalChildRecord> {
        Box::pin(async {
            Ok(child(
                TraditionalChildStatus::Cancelled,
                TraditionalChildExecutionMode::Foreground,
            ))
        })
    }

    fn wake<'a>(&'a self, _session_id: &'a str) -> ChildFuture<'a, ()> {
        Box::pin(async { Ok(()) })
    }
}

#[tokio::test]
async fn progress_is_emitted_only_for_validated_authorized_invocations() {
    let store_path =
        std::env::temp_dir().join(format!("nac_subagent_progress_{}.db", uuid::Uuid::new_v4()));
    let controller = Arc::new(FakeController {
        starts: Mutex::new(Vec::new()),
    });
    crate::traditional_children::register_controller(store_path.clone(), controller);
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("parent-1".to_string());
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    runtime.event_sink = crate::events::EventSink::channel(sender);
    let client = crate::model::ModelClient::new_for_test();
    let context = ToolCallContext {
        call_id: Some("call-progress".to_string()),
        presentation_key_arg: Some("Safe task summary".to_string()),
        ..Default::default()
    };
    let arguments = json!({"profile":"general", "description":"RAW_SECRET_DESCRIPTION", "prompt":"RAW_SECRET_PROMPT", "child_session_id":null, "background":true});
    runtime.allowed_tools = Some(Arc::new(std::collections::HashSet::new()));
    assert!(
        crate::tools::execute_tool_with_context(
            "subagent",
            arguments.clone(),
            &runtime,
            &client,
            &context
        )
        .await
        .is_error
    );
    assert!(receiver.try_recv().is_err());
    runtime.allowed_tools = None;
    assert!(
        crate::tools::execute_tool_with_context(
            "subagent",
            json!({"profile":"invalid"}),
            &runtime,
            &client,
            &context
        )
        .await
        .is_error
    );
    assert!(receiver.try_recv().is_err());
    let result =
        crate::tools::execute_tool_with_context("subagent", arguments, &runtime, &client, &context)
            .await;
    assert!(!result.is_error);
    assert_eq!(
        result.delegation_summary.as_deref(),
        Some("Safe task summary")
    );
    let finish = crate::events::AgentEvent::tool_call_finished(
        "call-progress".into(),
        "subagent".into(),
        &result,
    );
    let encoded = serde_json::to_string(&finish).unwrap();
    assert!(!encoded.contains("RAW_SECRET"));
    assert!(encoded.contains("Safe task summary"));
    let initial = receiver.try_recv().unwrap();
    assert!(matches!(
        initial,
        crate::events::AgentEvent::ToolCallStarted {
            delegation_summary_verified: true,
            delegation_intent: None,
            ..
        }
    ));
    let progress = receiver.try_recv().unwrap();
    assert!(!serde_json::to_string(&progress)
        .unwrap()
        .contains("RAW_SECRET"));
    match progress {
        crate::events::AgentEvent::ToolCallStarted {
            call_id,
            delegation_intent,
            key_arg_preview,
            ..
        } => {
            assert_eq!(call_id, "call-progress");
            assert_eq!(
                delegation_intent,
                Some(crate::events::DelegationIntent::BackgroundLaunch)
            );
            assert_eq!(key_arg_preview.as_deref(), Some("Safe task summary"));
        }
        _ => panic!("expected validated progress"),
    }
}

#[tokio::test]
async fn progress_waits_until_permission_is_granted() {
    let directory =
        std::env::temp_dir().join(format!("nac-subagent-approval-{}", uuid::Uuid::new_v4()));
    let store_path = directory.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "parent-1");
    crate::traditional_children::register_controller(
        store_path.clone(),
        Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
        }),
    );
    let broker = Arc::new(crate::permissions::PermissionBroker::new(
        store_path.clone(),
        "parent-1".into(),
        crate::permissions::PermissionBackend::Local,
        0,
        [crate::permissions::PermissionRule::new(
            "subagent",
            "*",
            crate::permissions::PermissionEffect::Ask,
        )],
    ));
    let bus = crate::events::SessionEventBus::new(Some("parent-1".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("parent-1".into());
    runtime.permission_broker = Some(Arc::clone(&broker));
    let (sender, mut receiver) = tokio::sync::mpsc::unbounded_channel();
    runtime.event_sink = crate::events::EventSink::channel(sender);
    let client = crate::model::ModelClient::new_for_test();
    let context = ToolCallContext {
        call_id: Some("call-approval".into()),
        presentation_key_arg: Some("Review store".into()),
        ..Default::default()
    };
    let rejected_call = crate::tools::execute_tool_with_context(
        "subagent",
        json!({"profile":"general", "description":"Review store", "prompt":"work", "child_session_id":null, "background":true}),
        &runtime,
        &client,
        &context,
    );
    let reject = async {
        loop {
            if let Some(request) = broker.pending().pop() {
                assert!(matches!(
                    receiver.try_recv(),
                    Ok(crate::events::AgentEvent::ToolCallStarted {
                        delegation_summary_verified: true,
                        delegation_intent: None,
                        ..
                    })
                ));
                assert!(receiver.try_recv().is_err());
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Reject)
                    .unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    };
    let (rejected, ()) = tokio::join!(rejected_call, reject);
    assert!(rejected.is_error);
    assert_eq!(rejected.delegation_summary.as_deref(), Some("Review store"));
    let finish = crate::events::AgentEvent::tool_call_finished(
        "call-approval".into(),
        "subagent".into(),
        &rejected,
    );
    assert!(serde_json::to_string(&finish)
        .unwrap()
        .contains("Review store"));
    assert!(receiver.try_recv().is_err());
    let invoke = crate::tools::execute_tool_with_context(
        "subagent",
        json!({"profile":"general", "description":"Review store", "prompt":"work", "child_session_id":null, "background":true}),
        &runtime,
        &client,
        &context,
    );
    let approve = async {
        loop {
            if let Some(request) = broker.pending().pop() {
                assert!(matches!(
                    receiver.try_recv(),
                    Ok(crate::events::AgentEvent::ToolCallStarted {
                        delegation_summary_verified: true,
                        delegation_intent: None,
                        ..
                    })
                ));
                assert!(
                    receiver.try_recv().is_err(),
                    "dispatch progress must not precede approval"
                );
                broker
                    .reply(&request.id, crate::permissions::PermissionReply::Once)
                    .unwrap();
                break;
            }
            tokio::task::yield_now().await;
        }
    };
    let (result, ()) = tokio::join!(invoke, approve);
    assert!(!result.is_error, "{}", result.content);
    assert!(matches!(
        receiver.try_recv(),
        Ok(crate::events::AgentEvent::ToolCallStarted {
            delegation_intent: Some(crate::events::DelegationIntent::BackgroundLaunch),
            ..
        })
    ));
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn denied_native_invocations_retain_only_verified_summary() {
    let directory =
        std::env::temp_dir().join(format!("nac-subagent-denial-{}", uuid::Uuid::new_v4()));
    let store_path = directory.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    crate::store::insert_test_session(&store_path, "parent-1");
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path.clone();
    runtime.session_id = Some("parent-1".into());
    let client = crate::model::ModelClient::new_for_test();
    let context = ToolCallContext {
        call_id: Some("denied".into()),
        presentation_key_arg: Some("Safe summary".into()),
        ..Default::default()
    };
    let args = json!({"profile":"general", "description":"RAW_SECRET", "prompt":"RAW_SECRET_PROMPT", "child_session_id":null, "background":true});
    runtime.heartbeat_execution = true;
    let hard = crate::tools::execute_tool_with_context(
        "subagent",
        args.clone(),
        &runtime,
        &client,
        &context,
    )
    .await;
    assert!(hard.is_error);
    assert_eq!(hard.delegation_summary.as_deref(), Some("Safe summary"));
    runtime.heartbeat_execution = false;
    runtime.permission_broker = Some(Arc::new(crate::permissions::PermissionBroker::new(
        store_path,
        "parent-1".into(),
        crate::permissions::PermissionBackend::Local,
        0,
        [crate::permissions::PermissionRule::new(
            "subagent",
            "*",
            crate::permissions::PermissionEffect::Deny,
        )],
    )));
    let denied =
        crate::tools::execute_tool_with_context("subagent", args, &runtime, &client, &context)
            .await;
    assert!(denied.is_error);
    assert_eq!(denied.delegation_summary.as_deref(), Some("Safe summary"));
    for result in [hard, denied] {
        let finish = crate::events::AgentEvent::tool_call_finished(
            "denied".into(),
            "subagent".into(),
            &result,
        );
        let encoded = serde_json::to_string(&finish).unwrap();
        assert!(encoded.contains("Safe summary"));
        assert!(!encoded.contains("RAW_SECRET"));
    }
    let invalid = crate::tools::execute_tool_with_context(
        "subagent",
        json!({"profile":"invalid"}),
        &runtime,
        &client,
        &context,
    )
    .await;
    assert!(invalid.is_error);
    assert!(invalid.delegation_summary.is_none());
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn model_visible_subagent_tool_uses_native_controller_for_foreground_and_background() {
    let store_path =
        std::env::temp_dir().join(format!("nac_subagent_native_{}.db", uuid::Uuid::new_v4()));
    let controller = Arc::new(FakeController {
        starts: Mutex::new(Vec::new()),
    });
    crate::traditional_children::register_controller(store_path.clone(), controller.clone());
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("parent-1".to_string());
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::DIRECT_TOOL_NAMES
            .into_iter()
            .map(str::to_string)
            .collect(),
    ));
    let client = crate::model::ModelClient::new_for_test();

    let foreground = crate::tools::execute_tool(
        "subagent",
        json!({
            "profile": "general",
            "description": "review store",
            "prompt": "inspect persistence",
            "child_session_id": null,
            "background": false
        }),
        &runtime,
        &client,
    )
    .await;
    assert!(!foreground.is_error, "{}", foreground.content);
    assert_eq!(
        foreground.delegation_outcome,
        Some(crate::events::DelegationOutcome::Completed)
    );
    let foreground: TraditionalChildRecord = serde_json::from_str(
        foreground
            .content
            .as_text()
            .expect("text foreground outcome"),
    )
    .unwrap();
    assert_eq!(foreground.status, TraditionalChildStatus::Completed);

    let background = crate::tools::execute_tool(
        "subagent",
        json!({
            "profile": "general",
            "description": "review store",
            "prompt": "inspect in background",
            "background": true
        }),
        &runtime,
        &client,
    )
    .await;
    assert!(!background.is_error, "{}", background.content);
    assert_eq!(
        background.delegation_outcome,
        Some(crate::events::DelegationOutcome::BackgroundStarted)
    );
    let background: serde_json::Value = serde_json::from_str(
        background
            .content
            .as_text()
            .expect("text background handle"),
    )
    .unwrap();
    assert_eq!(background["status"], "running");
    assert!(background["message"]
        .as_str()
        .unwrap()
        .contains("do not poll"));

    let forged = crate::tools::execute_tool(
        "subagent",
        json!({
            "profile": "general", "description": "review store", "prompt": "publish",
            "background": true, "origin": "person"
        }),
        &runtime,
        &client,
    )
    .await;
    assert!(forged.is_error, "model arguments cannot claim human origin");

    let starts = controller.starts.lock().unwrap();
    assert_eq!(starts.len(), 2);
    assert!(starts
        .iter()
        .all(|start| start.origin == crate::store::InputOrigin::Automation));
    assert!(starts[0].child_session_id.is_none());
    assert!(starts[1].child_session_id.is_none());
    assert_eq!(
        starts[0].execution_mode,
        TraditionalChildExecutionMode::Foreground
    );
    assert_eq!(
        starts[1].execution_mode,
        TraditionalChildExecutionMode::Background
    );
}

#[tokio::test]
async fn native_continuation_resolves_label_but_launch_requires_one() {
    let store_path =
        std::env::temp_dir().join(format!("nac_subagent_label_{}.db", uuid::Uuid::new_v4()));
    let controller = Arc::new(FakeController {
        starts: Mutex::new(Vec::new()),
    });
    crate::traditional_children::register_controller(store_path.clone(), controller.clone());
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("parent-1".to_string());
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::DIRECT_TOOL_NAMES
            .into_iter()
            .map(str::to_string)
            .collect(),
    ));
    let client = crate::model::ModelClient::new_for_test();
    let call = |arguments: serde_json::Value| {
        crate::tools::execute_tool("subagent", arguments, &runtime, &client)
    };

    let schema = SubagentTool.definition().function.parameters;
    assert_eq!(
        schema["properties"]["description"]["type"],
        json!(["string", "null"])
    );
    assert!(schema["required"]
        .as_array()
        .unwrap()
        .contains(&json!("description")));

    for launch in [
        json!({"profile": "general", "prompt": "work", "child_session_id": null, "background": true}),
        json!({"profile": "general", "description": null, "prompt": "work", "child_session_id": null, "background": true}),
    ] {
        let rejected = call(launch).await;
        assert!(rejected.is_error);
        assert_eq!(
                rejected.content.as_text(),
                Some("Error: invalid subagent input: traditional child description is required to launch a new child; omit it (or pass null) only when continuing an existing child_session_id")
            );
    }
    assert!(controller.starts.lock().unwrap().is_empty());

    for continuation in [
        json!({"profile": "general", "prompt": "continue", "child_session_id": "child-1", "background": true}),
        json!({"profile": "general", "description": null, "prompt": "continue", "child_session_id": "child-1", "background": true}),
        json!({"profile": "general", "description": "review store", "prompt": "continue", "child_session_id": "child-1", "background": true}),
    ] {
        let continued = call(continuation).await;
        assert!(!continued.is_error, "{}", continued.content);
        assert_eq!(
            continued.delegation_outcome,
            Some(crate::events::DelegationOutcome::BackgroundContinued)
        );
    }
    let starts = controller.starts.lock().unwrap();
    assert_eq!(
        starts
            .iter()
            .map(|start| (
                start.child_session_id.as_deref(),
                start.description.as_deref()
            ))
            .collect::<Vec<_>>(),
        [
            (Some("child-1"), None),
            (Some("child-1"), None),
            (Some("child-1"), Some("review store")),
        ]
    );
}

#[tokio::test]
async fn native_status_and_cancel_hide_foreign_child_ownership() {
    let root = std::env::temp_dir().join(format!("nac_subagent_opaque_{}", uuid::Uuid::new_v4()));
    let store_path = root.join("store.db");
    crate::store::initialize(&store_path).unwrap();
    for session_id in ["parent-a", "parent-b", "child-a"] {
        crate::store::insert_test_session(&store_path, session_id);
    }
    let connection = crate::store::open_runtime_connection(&store_path).unwrap();
    connection
            .execute(
                "UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent-a', 'parent-b', 'child-a')",
                [],
            )
            .unwrap();
    crate::store::create_traditional_child_relationship(
        &store_path,
        "parent-a",
        "child-a",
        GENERAL_CHILD_PROFILE,
        "review ownership",
    )
    .unwrap();
    let controller = Arc::new(FakeController {
        starts: Mutex::new(Vec::new()),
    });
    crate::traditional_children::register_controller(store_path.clone(), controller);
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path.clone();
    runtime.session_id = Some("parent-b".to_string());
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::DIRECT_TOOL_NAMES
            .into_iter()
            .map(str::to_string)
            .collect(),
    ));
    let client = crate::model::ModelClient::new_for_test();

    for tool in ["subagent_status", "subagent_cancel"] {
        let foreign = crate::tools::execute_tool(
            tool,
            json!({"child_session_id": "child-a"}),
            &runtime,
            &client,
        )
        .await;
        let missing = crate::tools::execute_tool(
            tool,
            json!({"child_session_id": "missing"}),
            &runtime,
            &client,
        )
        .await;
        assert!(foreign.is_error && missing.is_error);
        assert_eq!(
            foreign.content.as_text(),
            missing.content.as_text(),
            "{tool}"
        );
        assert_eq!(
            foreign.content.as_text(),
            Some("Error: traditional child was not found")
        );
    }

    runtime.session_id = Some("parent-a".into());
    let cancelled = crate::tools::execute_tool(
        "subagent_cancel",
        json!({"child_session_id":"child-a"}),
        &runtime,
        &client,
    )
    .await;
    assert!(!cancelled.is_error);
    assert_eq!(
        cancelled.delegation_outcome,
        Some(crate::events::DelegationOutcome::Cancelled)
    );
    let event = crate::events::AgentEvent::tool_call_finished(
        "cancel".into(),
        "subagent_cancel".into(),
        &cancelled,
    );
    assert!(
        matches!(event, crate::events::AgentEvent::ToolCallFinished {
        is_error: false, completion_status: Some(crate::events::ToolCompletionStatus::Success),
        content_preview, delegation_outcome: Some(crate::events::DelegationOutcome::Cancelled), ..
    } if content_preview == "Subagent cancellation request finished")
    );
    let _ = std::fs::remove_dir_all(root);
}

#[tokio::test]
async fn native_foreground_deadline_and_cancel_use_request_previews() {
    struct PendingController;
    impl TraditionalChildController for PendingController {
        fn start<'a>(
            &'a self,
            request: TraditionalChildStartRequest,
        ) -> ChildFuture<'a, TraditionalChildRecord> {
            Box::pin(async move {
                Ok(child(
                    TraditionalChildStatus::Running,
                    request.execution_mode,
                ))
            })
        }
        fn wait<'a>(&'a self, _: &'a str, _: u64) -> ChildFuture<'a, TraditionalChildRecord> {
            Box::pin(std::future::pending())
        }
        fn cancel<'a>(
            &'a self,
            _: &'a str,
            _: &'a str,
            _: u64,
        ) -> ChildFuture<'a, TraditionalChildRecord> {
            Box::pin(async { Err(anyhow::anyhow!("RAW_CANCEL_FAILURE")) })
        }
        fn wake<'a>(&'a self, _: &'a str) -> ChildFuture<'a, ()> {
            Box::pin(async { Ok(()) })
        }
    }
    let store_path =
        std::env::temp_dir().join(format!("nac-native-deadline-{}.db", uuid::Uuid::new_v4()));
    crate::traditional_children::register_controller(
        store_path.clone(),
        Arc::new(PendingController),
    );
    let client = crate::model::ModelClient::new_for_test();
    for cancelled in [false, true] {
        let mut runtime = crate::tools::test_runtime();
        runtime.store_path = store_path.clone();
        runtime.session_id = Some("parent-1".into());
        if cancelled {
            let token = runtime.command_cancellation.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                token.cancel();
            });
        }
        let mut args = json!({"profile":"general", "description":"Review store", "prompt":"work", "child_session_id":null, "background":false});
        if !cancelled {
            args["_nac"] = json!({"timeout_ms": 10});
        }
        let result = crate::tools::execute_tool_with_context(
            "subagent",
            args,
            &runtime,
            &client,
            &ToolCallContext::default(),
        )
        .await;
        let event = crate::events::AgentEvent::tool_call_finished(
            "native".into(),
            "subagent".into(),
            &result,
        );
        match event {
            crate::events::AgentEvent::ToolCallFinished {
                completion_status,
                content_preview,
                delegation_outcome,
                ..
            } => {
                assert_eq!(
                    completion_status,
                    Some(if cancelled {
                        crate::events::ToolCompletionStatus::Cancelled
                    } else {
                        crate::events::ToolCompletionStatus::TimedOut
                    })
                );
                assert_eq!(
                    content_preview,
                    if cancelled {
                        "Subagent request cancelled"
                    } else {
                        "Subagent request timed out"
                    }
                );
                assert!(delegation_outcome.is_none());
                assert!(!content_preview.contains("RAW_CANCEL_FAILURE"));
            }
            _ => panic!("expected finish"),
        }
    }
}

#[tokio::test(flavor = "current_thread")]
async fn owned_current_thread_status_and_cancel_preserve_parent_binding() {
    let root = std::env::temp_dir().join(format!("nac_subagent_owned_{}", uuid::Uuid::new_v4()));
    let path = root.join("store.db");
    crate::store::initialize(&path).unwrap();
    for id in ["parent-a", "parent-b", "child-a"] {
        crate::store::insert_test_session(&path, id);
    }
    let connection = crate::store::open_runtime_connection(&path).unwrap();
    connection.execute("UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent-a', 'parent-b', 'child-a')", []).unwrap();
    drop(connection);
    crate::store::create_traditional_child_relationship(
        &path,
        "parent-a",
        "child-a",
        GENERAL_CHILD_PROFILE,
        "owned fixture",
    )
    .unwrap();
    let owned_path = path.clone();
    let owner = crate::store::spawn_blocking_store_caller(move || {
        crate::store::StoreCoordinator::acquire(&owned_path)
    })
    .await
    .unwrap()
    .unwrap();
    let store_path = owner.store_path().to_path_buf();
    crate::traditional_children::register_controller(
        store_path.clone(),
        Arc::new(FakeController {
            starts: Mutex::new(Vec::new()),
        }),
    );
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = store_path;
    runtime.session_id = Some("parent-a".into());
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::DIRECT_TOOL_NAMES
            .into_iter()
            .map(str::to_string)
            .collect(),
    ));
    let client = crate::model::ModelClient::new_for_test();
    for tool in ["subagent_status", "subagent_cancel"] {
        let owned = crate::tools::execute_tool(
            tool,
            json!({"child_session_id":"child-a"}),
            &runtime,
            &client,
        )
        .await;
        if tool == "subagent_status" {
            assert!(!owned.is_error, "{}", owned.content);
        } else {
            assert!(!owned.is_error, "{}", owned.content);
            assert_eq!(
                owned.delegation_outcome,
                Some(crate::events::DelegationOutcome::Cancelled)
            );
        }
        runtime.session_id = Some("parent-b".into());
        let foreign = crate::tools::execute_tool(
            tool,
            json!({"child_session_id":"child-a"}),
            &runtime,
            &client,
        )
        .await;
        let missing = crate::tools::execute_tool(
            tool,
            json!({"child_session_id":"missing"}),
            &runtime,
            &client,
        )
        .await;
        assert!(foreign.is_error && missing.is_error);
        assert_eq!(foreign.content.as_text(), missing.content.as_text());
        runtime.session_id = Some("parent-a".into());
    }
    owner.shutdown().await.unwrap();
    let _ = std::fs::remove_dir_all(root);
}
