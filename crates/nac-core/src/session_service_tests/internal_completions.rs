use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};

fn text_response(text: &str) -> ScriptedResponse {
    ScriptedResponse::json(
        "200 OK",
        serde_json::json!({
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}],
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}
        })
        .to_string(),
    )
}

fn add_background_child(store_path: &std::path::Path, parent: &str, child: &str) {
    crate::store::insert_test_session(store_path, child);
    crate::store::open_runtime_connection(store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = ?1",
            [child],
        )
        .unwrap();
    crate::store::create_traditional_child_relationship(
        store_path,
        parent,
        child,
        crate::store::GENERAL_CHILD_PROFILE,
        child,
    )
    .unwrap();
    crate::store::begin_traditional_child_run(
        store_path,
        child,
        &format!("{child}-run"),
        crate::store::TraditionalChildExecutionMode::Background,
    )
    .unwrap();
}

fn settle_child(store_path: &std::path::Path, child: &str, report: &str) -> i64 {
    crate::store::settle_traditional_child_run(
        store_path,
        child,
        &format!("{child}-run"),
        crate::store::TraditionalChildTerminal {
            status: crate::store::TraditionalChildStatus::Completed,
            report: Some(report.to_owned()),
            failure: None,
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap()
    .child
    .completion_inbox_id
    .unwrap()
}

async fn wait_until_settled(service: &SessionService) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if !service.has_active_operation()
                && service
                    .list_direct_inbox()
                    .unwrap()
                    .iter()
                    .all(|item| item.status != crate::store::InboxStatus::Pending)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("parent should drain its inbox");
}

async fn user_messages(service: &SessionService) -> Vec<String> {
    service
        .messages_page(MessagePageRequest {
            before: None,
            limit: 100,
            include_system: false,
        })
        .await
        .unwrap()
        .messages
        .into_iter()
        .filter_map(|message| match message {
            Message::User { content } => Some(content),
            _ => None,
        })
        .collect()
}

/// Mixed human input and background completions: a running parent sees a
/// completion at its next model boundary, an idle parent gets one successor,
/// human queue order and controls are unchanged, and lookalike human text
/// remains ordinary editable input.
#[tokio::test]
async fn parent_receives_each_background_completion_once_without_editable_controls() {
    let (started_tx, started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let server = ScriptedServer::start_observed(
        vec![
            text_response("first answer"),
            text_response("saw child a"),
            text_response("handled human"),
            text_response("handled mimic"),
            text_response("saw child b"),
        ],
        move |index, _request| {
            if index == 0 {
                started_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            }
        },
    );
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "internal-completion-parent";
    let (parts, store_path) =
        test_direct_active_service("internal_completion_mixed", session_id, client);
    let service = parts.service;
    add_background_child(&store_path, session_id, "child-a");
    add_background_child(&store_path, session_id, "child-b");

    service
        .enqueue_direct_input(
            crate::store::InboxDelivery::Queue,
            "initial prompt",
            None,
            Some("initial prompt"),
        )
        .await
        .unwrap();
    tokio::task::spawn_blocking(move || started_rx.recv_timeout(Duration::from_secs(5)).unwrap())
        .await
        .unwrap();
    let run_id = service.active_run().unwrap().run_id.to_string();

    let child_a = settle_child(&store_path, "child-a", "CHILD_A_REPORT");
    let human = service
        .enqueue_direct_input(
            crate::store::InboxDelivery::Queue,
            "human queued later",
            None,
            Some("human queued later"),
        )
        .await
        .unwrap();
    let completion_text = crate::store::load_session_inbox_item(&store_path, session_id, child_a)
        .unwrap()
        .content;
    let mimic = service
        .enqueue_direct_input(
            crate::store::InboxDelivery::Queue,
            &completion_text,
            None,
            Some(&completion_text),
        )
        .await
        .unwrap();

    let pending = service.list_direct_inbox().unwrap();
    let completion = pending.iter().find(|item| item.id == child_a).unwrap();
    assert_eq!(completion.delivery, crate::store::InboxDelivery::Steer);
    assert_eq!(completion.target_run_id.as_deref(), Some(run_id.as_str()));
    assert!(completion.internal_completion.is_some());
    assert!(pending
        .iter()
        .filter(|item| item.id != child_a)
        .all(|item| item.internal_completion.is_none()));

    // Public mutation refuses the delegated result and leaves it untouched.
    let refused = service
        .update_direct_inbox_item(
            child_a,
            completion.version,
            crate::store::InboxDelivery::Queue,
        )
        .await
        .unwrap_err();
    assert!(refused
        .downcast_ref::<crate::store::InternalInboxItemError>()
        .is_some());
    assert!(service
        .cancel_direct_inbox_item(child_a, completion.version)
        .unwrap_err()
        .downcast_ref::<crate::store::InternalInboxItemError>()
        .is_some());
    // Human controls are unchanged, including for text that mimics a result.
    let steered = service
        .update_direct_inbox_item(mimic.id, mimic.version, crate::store::InboxDelivery::Steer)
        .await
        .unwrap();
    assert_eq!(steered.target_run_id.as_deref(), Some(run_id.as_str()));
    let requeued = service
        .update_direct_inbox_item(
            mimic.id,
            steered.version,
            crate::store::InboxDelivery::Queue,
        )
        .await
        .unwrap();
    assert_eq!(requeued.target_run_id, None);
    assert_eq!(
        service
            .list_direct_inbox()
            .unwrap()
            .into_iter()
            .find(|item| item.id == child_a)
            .unwrap(),
        *completion
    );

    release_tx.send(()).unwrap();
    wait_until_settled(&service).await;

    // An idle parent receives the next completion as one queued successor.
    let child_b = settle_child(&store_path, "child-b", "CHILD_B_REPORT");
    let queued = crate::store::load_session_inbox_item(&store_path, session_id, child_b).unwrap();
    assert_eq!(queued.delivery, crate::store::InboxDelivery::Queue);
    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_some());
    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_none());
    wait_until_settled(&service).await;

    let requests = server.finish();
    assert_eq!(requests.len(), 5);
    let bodies = requests
        .iter()
        .map(|request| String::from_utf8_lossy(&request.body).into_owned())
        .collect::<Vec<_>>();
    assert!(!bodies[0].contains("CHILD_A_REPORT"));
    assert!(bodies[1].contains("CHILD_A_REPORT"));
    assert!(!bodies[1].contains("human queued later"));
    assert!(bodies[2].contains("human queued later"));
    assert!(bodies[4].contains("CHILD_B_REPORT"));

    let inbox = service.list_direct_inbox().unwrap();
    let delivered_run = |id: i64| {
        inbox
            .iter()
            .find(|item| item.id == id)
            .unwrap()
            .delivered_run_id
            .clone()
            .unwrap()
    };
    assert_eq!(delivered_run(child_a), run_id);
    assert_ne!(delivered_run(human.id), run_id);
    assert_ne!(delivered_run(mimic.id), delivered_run(human.id));
    assert_ne!(delivered_run(child_b), delivered_run(mimic.id));
    let users = user_messages(&service).await;
    let child_b_text = queued.content;
    assert_eq!(
        users
            .iter()
            .filter(|content| **content == completion_text)
            .count(),
        2,
        "the completion once, plus the person's own copy"
    );
    assert_eq!(
        users
            .iter()
            .filter(|content| **content == child_b_text)
            .count(),
        1
    );
    let order = users
        .iter()
        .map(|content| content.as_str())
        .filter(|content| !content.starts_with("Traditional child completion"))
        .collect::<Vec<_>>();
    assert_eq!(order, vec!["initial prompt", "human queued later"]);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}

/// A completion pinned to a run that a crashed process abandoned is promoted
/// to exactly one successor after recovery, never lost or repeated.
#[tokio::test]
async fn restarted_parent_delivers_a_completion_pinned_to_its_abandoned_run_once() {
    let server = ScriptedServer::start(vec![text_response("recovered child result")]);
    let client = ModelClient::new_for_test_server(server.base_url.clone());
    let session_id = "internal-completion-restart";
    let (parts, store_path) =
        test_direct_active_service("internal_completion_restart", session_id, client);
    let service = parts.service;
    add_background_child(&store_path, session_id, "child-r");
    let start_idx = sessions::load_session(&store_path, session_id)
        .unwrap()
        .messages
        .len() as u64;
    crate::store::TranscriptLogWriter::new(&store_path)
        .unwrap()
        .append_run_prompt(
            session_id,
            start_idx,
            &Message::User {
                content: "work lost in a crash".to_owned(),
            },
            "abandoned-run",
        )
        .unwrap();
    let completion = settle_child(&store_path, "child-r", "CHILD_R_REPORT");
    let pinned =
        crate::store::load_session_inbox_item(&store_path, session_id, completion).unwrap();
    assert_eq!(pinned.target_run_id.as_deref(), Some("abandoned-run"));

    let lease = sessions::SessionOperationLease::try_acquire(&store_path, session_id).unwrap();
    assert!(matches!(
        service
            .reconcile_durable_run_recovery(&lease)
            .await
            .unwrap(),
        crate::store::ActiveRunReconciliation::Interrupted { .. }
    ));
    drop(lease);
    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_some());
    wait_until_settled(&service).await;
    assert!(service
        .start_next_direct_inbox_item()
        .await
        .unwrap()
        .is_none());

    let delivered =
        crate::store::load_session_inbox_item(&store_path, session_id, completion).unwrap();
    assert_eq!(delivered.status, crate::store::InboxStatus::Delivered);
    assert_ne!(delivered.delivered_run_id.as_deref(), Some("abandoned-run"));
    assert_eq!(
        user_messages(&service)
            .await
            .iter()
            .filter(|content| content.contains("CHILD_R_REPORT"))
            .count(),
        1
    );
    assert_eq!(server.finish().len(), 1);
    let _ = std::fs::remove_dir_all(store_path.parent().unwrap());
}
