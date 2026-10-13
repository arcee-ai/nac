use super::*;
use crate::model::ModelClient;
use crate::session_service::tests::test_direct_active_service;
fn intent(mode: Delivery, run: Option<String>) -> TerminalSelectionIntent {
    TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: crate::store::TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: Uuid::new_v4().to_string(),
        capture_id: Uuid::new_v4().to_string(),
        source_session_id: "session".into(),
        terminal_id: "source".into(),
        owner_instance_id: Uuid::new_v4().to_string(),
        client_capture_time_ms: None,
        text: " /compact\n$skill ".into(),
        user_text: None,
        initial_delivery: mode,
        initial_expected_run_id: run,
    }
}
#[tokio::test]
async fn terminal_selection_delivery_is_explicit_run_bound_and_shutdown_fenced() {
    let (parts, path) =
        test_direct_active_service("selection_modes", "session", ModelClient::new_for_test());
    let service = &parts.service;
    let run = service
        .coordinate_local(|service| service.try_begin_run(None, "hold"))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        service
            .admit_terminal_selection_intent(intent(Delivery::Send, None))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::DeliveryConflict)
    );
    assert_eq!(
        service
            .admit_terminal_selection_intent(intent(
                Delivery::Steer,
                Some(Uuid::new_v4().to_string())
            ))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::DeliveryConflict)
    );
    let accepted = intent(Delivery::Steer, Some(run.run_id.to_string()));
    let created = service
        .admit_terminal_selection_intent(accepted.clone())
        .await
        .unwrap();
    assert!(!created.replayed);
    assert_eq!(
        created.record.target_run_id.as_deref(),
        Some(run.run_id.as_str())
    );
    let queue = service
        .admit_terminal_selection_intent(intent(Delivery::Queue, None))
        .await
        .unwrap();
    assert_eq!(queue.record.status, crate::store::InboxStatus::Pending);
    service.stop_run_admission().await.unwrap();
    let replay = service
        .admit_terminal_selection_intent(accepted)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.record.id, created.record.id);
    assert_eq!(
        service
            .admit_terminal_selection_intent(intent(Delivery::Queue, None))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::Stopping)
    );
    assert_eq!(
        crate::store::list_session_inbox(&path, "session")
            .unwrap()
            .len(),
        2
    );
}
#[tokio::test]
async fn terminal_selection_send_respects_peer_lease_and_queue_fifo() {
    let (parts, path) =
        test_direct_active_service("selection_peer", "session", ModelClient::new_for_test());
    let service = &parts.service;
    let lease = sessions::SessionOperationLease::try_acquire(&path, "session").unwrap();
    assert_eq!(
        service
            .admit_terminal_selection_intent(intent(Delivery::Send, None))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::DeliveryConflict)
    );
    let original = intent(Delivery::Queue, None);
    let created = service
        .admit_terminal_selection_intent(original.clone())
        .await
        .unwrap();
    assert!(!created.replayed);
    assert!(!service.has_active_operation());
    drop(lease);
    assert_eq!(
        service
            .admit_terminal_selection_intent(intent(Delivery::Send, None))
            .await
            .unwrap_err()
            .downcast_ref(),
        Some(&Error::DeliveryConflict)
    );
    assert!(!service.has_active_operation());
    assert!(
        service
            .admit_terminal_selection_intent(original)
            .await
            .unwrap()
            .replayed
    );
    assert!(!service.has_active_operation());
}

#[tokio::test]
async fn terminal_selection_idle_and_finishing_successor_delivery_stay_literal() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use crate::session_service::tests::compaction_response;
    use crate::skills::{SkillRecord, SkillRegistry};
    for late in [false, true] {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            compaction_response("observed evidence"),
        )]);
        let (mut parts, path) = test_direct_active_service(
            "selection_literal",
            "session",
            ModelClient::new_for_test_server(server.base_url.clone()),
        );
        parts.service.skills = Some(Arc::new(SkillRegistry::load_for_test(vec![SkillRecord {
            name: "skill".into(),
            description: "fixture".into(),
            compatibility: None,
            skill_root_visible: PathBuf::from("/fixture"),
            body: "EXPANSION_MUST_NOT_RUN".into(),
            resources: Vec::new(),
        }])));
        let service = &parts.service;
        let old = if late {
            Some(
                service
                    .coordinate_local(|service| service.try_begin_run(None, "old run"))
                    .await
                    .unwrap()
                    .unwrap(),
            )
        } else {
            None
        };
        let mut original = intent(
            if late {
                Delivery::Steer
            } else {
                Delivery::Queue
            },
            old.as_ref().map(|run| run.run_id.to_string()),
        );
        original.text = " /compact\n$skill\n/mcp_prompt missing ".into();
        original.user_text = Some(" $skill\n/goal\n/mcp_prompt missing ".into());
        let envelope = original.envelope().unwrap();
        let commands::PreparedUserInput::SubmitPrompt(control) =
            service.prepare_user_input(&envelope)
        else {
            panic!("normal prompt preparation unavailable")
        };
        assert!(control.agent_prompt.contains("EXPANSION_MUST_NOT_RUN")); // A real expansion would be observable.
        let created = service
            .admit_terminal_selection_intent(original.clone())
            .await
            .unwrap();
        assert!(!created.replayed);
        if let Some(old) = old {
            assert_eq!(created.record.status, crate::store::InboxStatus::Pending);
            service
                .coordinate_local(move |service| {
                    service.mark_run_finishing(&old.run_id).unwrap();
                    service.clear_finished_run(&old.run_id);
                })
                .await
                .unwrap();
            service
                .start_next_direct_inbox_item()
                .await
                .unwrap()
                .unwrap();
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if !service.has_active_operation()
                    && crate::store::load_session_inbox_item(&path, "session", created.record.id)
                        .unwrap()
                        .status
                        == crate::store::InboxStatus::Delivered
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let messages = service.messages_snapshot().await.unwrap();
        assert_eq!(
            messages
                .iter()
                .filter(|message| matches!(message,Message::User{content} if content==&envelope))
                .count(),
            1
        );
        assert!(!serde_json::to_string(&messages)
            .unwrap()
            .contains("EXPANSION_MUST_NOT_RUN"));
        assert!(
            service
                .admit_terminal_selection_intent(original)
                .await
                .unwrap()
                .replayed
        );
        assert!(!service.has_active_operation());
        let requests = server.finish();
        assert_eq!(requests.len(), 1);
        let wire: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert!(wire
            .to_string()
            .contains(&serde_json::to_string(&envelope).unwrap()));
        assert!(!wire.to_string().contains("EXPANSION_MUST_NOT_RUN"));
    }
}

#[tokio::test]
async fn terminal_selection_idle_send_successful_commit_lost_ack_wakes_once() {
    use crate::model::test_http::{ScriptedResponse, ScriptedServer};
    use crate::session_service::tests::compaction_response;
    let server = ScriptedServer::start(vec![ScriptedResponse::json(
        "200 OK",
        compaction_response("evidence received"),
    )]);
    let (parts, path) = test_direct_active_service(
        "selection_commit_ack",
        "session",
        ModelClient::new_for_test_server(server.base_url.clone()),
    );
    let service = &parts.service;
    let original = intent(Delivery::Send, None);
    let envelope = original.envelope().unwrap();
    // Keep the executor owner alive through injection and creator admission.
    let coordinator = crate::store::StoreCoordinator::acquire(&path).unwrap();
    coordinator
        .lose_next_selection_ack_for_test()
        .await
        .unwrap();
    let created = service
        .admit_terminal_selection_intent(original.clone())
        .await
        .unwrap();
    assert!(!created.replayed);
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if !service.has_active_operation()
                && coordinator
                    .load_session_inbox_item("session".into(), created.record.id)
                    .await
                    .unwrap()
                    .status
                    == crate::store::InboxStatus::Delivered
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let replay = service
        .admit_terminal_selection_intent(original)
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.record.id, created.record.id);
    assert_eq!(
        coordinator
            .list_session_inbox("session".into())
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(!service.has_active_operation());
    assert_eq!(
        service
            .messages_snapshot()
            .await
            .unwrap()
            .iter()
            .filter(|message| matches!(message,Message::User{content} if content==&envelope))
            .count(),
        1
    );
    let requests = server.finish();
    assert_eq!(requests.len(), 1);
    assert!(
        serde_json::from_slice::<serde_json::Value>(&requests[0].body)
            .unwrap()
            .to_string()
            .contains(&serde_json::to_string(&envelope).unwrap())
    );
}
