use crate::permissions::{PermissionEffect, PermissionReply, PermissionRule};
use crate::store;
use crate::tools::task_discovery::tests::{call, cleanup, runtime};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

#[tokio::test]
async fn mixed_project_wait_uses_each_prepared_once_authorization() {
    let rt = runtime(vec![PermissionRule::new(
        "task_read",
        "project:p1",
        PermissionEffect::Ask,
    )]);
    let broker = Arc::clone(rt.permission_broker.as_ref().unwrap());
    // Match a live broker whose caller project was already discovered.
    broker.remember_caller_project("p1");
    let foreign =
        store::create_session_goal(&rt.store_path, "foreign", "foreign goal", None, None).unwrap();
    let local =
        store::create_session_goal(&rt.store_path, "peer-a", "local goal", None, None).unwrap();
    let bus = crate::events::SessionEventBus::new(Some("caller".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let input = json!({"targets":[
        {"session_id":"foreign","project_id":"p2","mode":"goal","goal_id":foreign.goal_id},
        {"session_id":"peer-a","project_id":null,"mode":"goal","goal_id":local.goal_id}
    ],"timeout_ms":0});
    let invocation = {
        let rt = rt.clone();
        tokio::spawn(async move { call(&rt, "wait_tasks", input).await })
    };
    let answered = tokio::time::timeout(Duration::from_secs(5), async {
        let mut answered = 0;
        while !invocation.is_finished() {
            for request in broker.pending() {
                if answered == 0 {
                    for project in ["project:p1", "project:p2"] {
                        assert!(request.resources.iter().any(|r| r.resource == project));
                    }
                }
                assert!(answered < 3, "unexpected unbounded approval requests");
                eprintln!(
                    "MIXED_PROJECT_ONCE_REQUEST {} {:?}",
                    answered + 1,
                    request
                        .resources
                        .iter()
                        .map(|r| &r.resource)
                        .collect::<Vec<_>>()
                );
                broker.reply(&request.id, PermissionReply::Once).unwrap();
                answered += 1;
            }
            tokio::task::yield_now().await;
        }
        answered
    })
    .await
    .unwrap();
    let result = invocation.await.unwrap();
    assert!(!result.is_error, "{}", result.content);
    let payload: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(payload["status"], "snapshot");
    assert_eq!(payload["targets"][0]["status"], "active");
    assert_eq!(payload["targets"][0]["resolved_identity"], foreign.goal_id);
    assert_eq!(payload["targets"][1]["status"], "active");
    assert_eq!(payload["targets"][1]["resolved_identity"], local.goal_id);
    assert_eq!(
        store::load_session_goal(&rt.store_path, "foreign").unwrap(),
        Some(foreign)
    );
    assert_eq!(
        store::load_session_goal(&rt.store_path, "peer-a").unwrap(),
        Some(local)
    );
    assert!(broker.pending().is_empty());
    cleanup(&rt);
    assert_eq!(
        answered, 1,
        "prepared Once authorization must cover each bound target"
    );
}

#[tokio::test]
async fn mixed_project_wait_keeps_denial_and_headless_ask_closed() {
    for (effect, project, warm) in [
        (PermissionEffect::Deny, "project:p1", true),
        (PermissionEffect::Deny, "project:p2", true),
        (PermissionEffect::Ask, "project:p1", true),
        (PermissionEffect::Ask, "project:p1", false),
    ] {
        let rt = runtime(vec![PermissionRule::new("task_read", project, effect)]);
        let broker = Arc::clone(rt.permission_broker.as_ref().unwrap());
        if warm {
            broker.remember_caller_project("p1");
        }
        let foreign =
            store::create_session_goal(&rt.store_path, "foreign", "foreign", None, None).unwrap();
        let local =
            store::create_session_goal(&rt.store_path, "peer-a", "local", None, None).unwrap();
        let bus = crate::events::SessionEventBus::new(Some("caller".into()));
        // Deny must reject even with a real approver present. Ask without one
        // must fail closed both before and during execution.
        let _interactive =
            (effect == PermissionEffect::Deny).then(|| bus.subscribe_assistant_deltas());
        broker.attach_event_bus(bus);
        let result = call(
            &rt,
            "wait_tasks",
            json!({"targets":[
            {"session_id":"foreign","project_id":"p2","mode":"goal","goal_id":foreign.goal_id},
            {"session_id":"peer-a","mode":"goal","goal_id":local.goal_id}
        ],"timeout_ms":0}),
        )
        .await;
        assert!(result.is_error);
        assert!(
            result
                .content
                .as_text()
                .unwrap()
                .contains("permission denied"),
            "{}",
            result.content
        );
        assert!(broker.pending().is_empty());
        assert!(store::list_permission_grants(&rt.store_path, "caller")
            .unwrap()
            .is_empty());
        assert_eq!(
            store::load_session_goal(&rt.store_path, "foreign").unwrap(),
            Some(foreign)
        );
        assert_eq!(
            store::load_session_goal(&rt.store_path, "peer-a").unwrap(),
            Some(local)
        );
        cleanup(&rt);
    }
}

#[tokio::test]
async fn mixed_project_wait_revalidates_reassignment_after_once_approval() {
    for move_caller in [false, true] {
        let rt = runtime(vec![
            PermissionRule::new("task_read", "project:p1", PermissionEffect::Ask),
            PermissionRule::new("task_read", "project:p3", PermissionEffect::Deny),
        ]);
        let broker = Arc::clone(rt.permission_broker.as_ref().unwrap());
        broker.remember_caller_project("p1");
        let foreign =
            store::create_session_goal(&rt.store_path, "foreign", "foreign", None, None).unwrap();
        let local = store::create_session_goal(
            &rt.store_path,
            "peer-a",
            "Private changed projection",
            None,
            None,
        )
        .unwrap();
        let bus = crate::events::SessionEventBus::new(Some("caller".into()));
        let _interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        let input = json!({"targets":[
            {"session_id":"foreign","project_id":"p2","mode":"goal","goal_id":foreign.goal_id},
            {"session_id":"peer-a","mode":"goal","goal_id":local.goal_id}
        ],"timeout_ms":0});
        let invocation = {
            let rt = rt.clone();
            tokio::spawn(async move { call(&rt, "wait_tasks", input).await })
        };
        let request = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    break request;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(request.resources.iter().any(|r| r.resource == "project:p1"));
        // Project deletion releases these sessions. Reassignment uses the
        // supported API and preserves the exact existing location/backend.
        store::delete_project(&rt.store_path, "p1").unwrap();
        store::insert_project(
            &rt.store_path,
            store::NewProject {
                project_id: "p3".into(),
                name: None,
                description: None,
                cwd: std::path::PathBuf::from("/tmp/p1"),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            },
        )
        .unwrap();
        store::assign_session_to_project(&rt.store_path, "p3", "peer-a").unwrap();
        if move_caller {
            store::assign_session_to_project(&rt.store_path, "p3", "caller").unwrap();
        }
        broker.reply(&request.id, PermissionReply::Once).unwrap();
        let result = tokio::time::timeout(Duration::from_secs(5), invocation)
            .await
            .expect("scope change must reject without another approval")
            .unwrap();
        if move_caller {
            assert!(result.is_error);
            assert!(
                result
                    .content
                    .as_text()
                    .unwrap()
                    .contains("permission denied"),
                "{}",
                result.content
            );
        } else {
            assert!(!result.is_error, "{}", result.content);
            let payload: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
            assert_eq!(payload["targets"][0]["resolved_identity"], foreign.goal_id);
            assert_eq!(payload["targets"][1]["status"], "outside_scope");
            assert!(payload["targets"][1]["proof"].is_null());
        }
        assert!(!result
            .content
            .as_text()
            .unwrap()
            .contains("Private changed projection"));
        assert!(broker.pending().is_empty());
        assert!(store::list_permission_grants(&rt.store_path, "caller")
            .unwrap()
            .is_empty());
        cleanup(&rt);
    }
}
