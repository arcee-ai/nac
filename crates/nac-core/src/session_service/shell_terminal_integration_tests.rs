use super::*;
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::store::{
    InboxStatus, TerminalSelectionAdmissionError, TerminalSelectionDelivery,
    TerminalSelectionIntent, TerminalSelectionSourceKind,
};

fn selection(delivery: TerminalSelectionDelivery) -> TerminalSelectionIntent {
    TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: Uuid::new_v4().to_string(),
        capture_id: Uuid::new_v4().to_string(),
        source_session_id: "session".into(),
        terminal_id: "source".into(),
        owner_instance_id: Uuid::new_v4().to_string(),
        client_capture_time_ms: None,
        text: "!printf MUST_NOT_EXECUTE\n/compact\n$skill".into(),
        user_text: Some("explicit queued evidence".into()),
        initial_delivery: delivery,
        initial_expected_run_id: None,
    }
}

#[tokio::test]
async fn human_shell_settlement_hands_explicit_queued_selection_to_the_existing_inbox() {
    for cancel in [false, true] {
        let server = ScriptedServer::start(vec![ScriptedResponse::json(
            "200 OK",
            crate::session_service::tests::compaction_response("observed queued evidence"),
        )]);
        let (parts, path) = test_direct_active_service(
            "shell_selection_handoff",
            "session",
            ModelClient::new_for_test_server(server.base_url.clone()),
        );
        let workspace = path.parent().unwrap().join("workspace");
        let started = workspace.join("command-started");
        let release = workspace.join("command-release");
        let script = format!(
            "from pathlib import Path; import time; Path({}).write_text(\"started\")\nwhile not Path({}).exists(): time.sleep(0.01)\nprint(\"shell-done\")",
            serde_json::to_string(&started.display().to_string()).unwrap(),
            serde_json::to_string(&release.display().to_string()).unwrap(),
        );
        let command = format!("python3 -c '{}'", script.replace('\'', "'\\''"));
        parts
            .service
            .submit_shell_command(request("command", &command))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while !started.exists() {
                let snapshot = parts
                    .service
                    .lookup_shell_command("command")
                    .await
                    .unwrap()
                    .unwrap();
                assert!(
                    !snapshot.state.is_terminal(),
                    "command failed before barrier: {snapshot:?}"
                );
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();

        let send = parts
            .service
            .admit_terminal_selection_intent(selection(TerminalSelectionDelivery::Send))
            .await
            .unwrap_err();
        assert_eq!(
            send.downcast_ref(),
            Some(&TerminalSelectionAdmissionError::DeliveryConflict)
        );
        let mut steer = selection(TerminalSelectionDelivery::Steer);
        steer.initial_expected_run_id = Some(Uuid::new_v4().to_string());
        let error = parts
            .service
            .admit_terminal_selection_intent(steer)
            .await
            .unwrap_err();
        assert_eq!(
            error.downcast_ref(),
            Some(&TerminalSelectionAdmissionError::DeliveryConflict)
        );
        let intent = selection(TerminalSelectionDelivery::Queue);
        let envelope = intent.envelope().unwrap();
        let queued = parts
            .service
            .admit_terminal_selection_intent(intent.clone())
            .await
            .unwrap();
        assert_eq!(queued.record.status, InboxStatus::Pending);
        assert!(parts.service.active_run().is_none());
        if cancel {
            parts.service.cancel_shell_command("command").await.unwrap();
        } else {
            std::fs::write(&release, b"release").unwrap();
        }
        // No attach, reload or explicit extra wake: settlement itself hands off
        // the already-authorized queue after releasing command ownership.
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                let delivered =
                    crate::store::load_session_inbox_item(&path, "session", queued.record.id)
                        .unwrap()
                        .status
                        == InboxStatus::Delivered;
                if delivered && !parts.service.has_active_operation() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let result = parts
            .service
            .lookup_shell_command("command")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            result.state,
            if cancel {
                ShellCommandState::Cancelled
            } else {
                ShellCommandState::Completed
            }
        );
        let messages = parts.service.messages_snapshot().await.unwrap();
        let shell_index = messages.iter().position(|message| matches!(message, Message::User { content } if content.contains("<human_shell_result>"))).unwrap();
        let evidence_index = messages
            .iter()
            .position(
                |message| matches!(message, Message::User { content } if content == &envelope),
            )
            .unwrap();
        assert!(shell_index < evidence_index);
        let replay = parts
            .service
            .admit_terminal_selection_intent(intent)
            .await
            .unwrap();
        assert!(replay.replayed);
        assert!(!parts.service.has_active_operation());
        let requests = server.finish();
        assert_eq!(requests.len(), 1);
        let wire: serde_json::Value = serde_json::from_slice(&requests[0].body).unwrap();
        assert!(wire.to_string().contains("<human_shell_result>"));
        assert!(wire
            .to_string()
            .contains(&serde_json::to_string(&envelope).unwrap()));
    }
}

#[tokio::test]
async fn identified_selection_active_projection_precedes_canonical_append_without_model_effect() {
    for genuine in [true, false] {
        let (parts, path) = test_direct_active_service(
            "selection_before_append",
            "session",
            ModelClient::new_for_test(),
        );
        let intent = selection(TerminalSelectionDelivery::Queue);
        let receipt = crate::store::create_terminal_selection_intent(&path, &intent).unwrap();
        let item = if genuine {
            receipt.record
        } else {
            crate::store::create_session_inbox_item(
                &path,
                "session",
                crate::store::InboxDelivery::Queue,
                &receipt.record.content,
                None,
                None,
            )
            .unwrap()
        };
        let before = parts.service.messages_snapshot().await.unwrap();
        let active = parts
            .service
            .try_begin_run_inner(
                None,
                &item.content,
                None,
                true,
                crate::session_service::RunAdmissionKind {
                    inbox_item_id: Some(item.id),
                    terminal_selection: item.terminal_selection.clone(),
                    ..Default::default()
                },
            )
            .unwrap();
        let submitted = active.submitted_user_message.as_ref().unwrap();
        assert_eq!(submitted.content, intent.envelope().unwrap());
        assert_eq!(submitted.terminal_selection.is_some(), genuine);
        if let Some(evidence) = &submitted.terminal_selection {
            assert_eq!(evidence.text, intent.text);
            assert_eq!(evidence.user_text, intent.user_text);
            assert_eq!(evidence.attribution.admission_id, intent.admission_id);
        }
        // Admission emits active state before the agent task commits its User
        // row; this is the real pre-hydration timeline the presentation consumes.
        assert_eq!(
            serde_json::to_value(parts.service.messages_snapshot().await.unwrap()).unwrap(),
            serde_json::to_value(before).unwrap()
        );
        // No task or process was dispatched. Drop this isolated admission
        // fixture rather than synthesize delivery or wake queued input.
        drop(parts);
    }
}
