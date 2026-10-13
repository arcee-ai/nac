//! Service-issued human activity remains separate from model turns. The native
//! model registry observes it only after an explicit read/discovery invocation.
use super::*;
use serde_json::{json, Value};

async fn native(runtime: &crate::tools::ToolRuntime, name: &str, input: Value) -> Value {
    let result = crate::tools::execute_tool(
        name,
        input,
        runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await;
    assert!(!result.is_error, "{}", result.content);
    serde_json::from_str(result.content.as_text().unwrap()).unwrap()
}

#[tokio::test]
async fn human_activity_then_native_discovery_does_not_admit_context_or_wake_a_model() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let agent = service.agent.lock().await;
    let runtime = agent.user_terminal_runtime().unwrap();
    let before = serde_json::to_value(&agent.messages).unwrap();
    let stored_before = serde_json::to_value(
        sessions::load_session(&directory.join("store.db"), "direct-terminal")
            .unwrap()
            .messages,
    )
    .unwrap();
    let definitions = crate::tools::direct_tool_definitions(false);
    let mut events = service.event_bus.subscribe();
    assert_eq!(
        native(&runtime, "list_executions", json!({})).await["executions"],
        json!([])
    );
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let marker = format!("SERVICE-FAILURE-{}", Uuid::new_v4());
    service.write_user_terminal_input(&terminal.id, format!("stty -echo -onlcr; PS1=; PROMPT_COMMAND=; printf '{marker} missing-library\\n'; false; printf 'EXIT=%s\\n' \"$?\"\r").as_bytes()).await.unwrap();
    wait_for(service, &terminal.id, b"EXIT=1").await;
    let inventory = native(&runtime, "list_executions", json!({})).await;
    assert_eq!(inventory["executions"][0]["id"], terminal.id);
    let read = native(
        &runtime,
        "read_command_output",
        json!({"execution_id":inventory["executions"][0]["id"], "limit":4096}),
    )
    .await;
    assert!(read["content"].as_str().unwrap().contains(&marker));
    assert!(read["content"].as_str().unwrap().contains("EXIT=1"));
    let search = native(&runtime, "read_command_output", json!({"execution_id":inventory["executions"][0]["id"], "query":"missing-library", "limit":4096})).await;
    assert!(search["matches"]
        .as_array()
        .unwrap()
        .iter()
        .any(|entry| entry["context"].as_str().unwrap().contains(&marker)));
    assert_eq!(serde_json::to_value(&agent.messages).unwrap(), before);
    assert_eq!(
        serde_json::to_value(
            sessions::load_session(&directory.join("store.db"), "direct-terminal")
                .unwrap()
                .messages
        )
        .unwrap(),
        stored_before
    );
    assert!(!service.has_active_operation());
    assert!(service.list_direct_inbox().unwrap().is_empty());
    assert!(service
        .permission_broker
        .as_ref()
        .unwrap()
        .pending()
        .is_empty());
    assert!(service
        .permission_broker
        .as_ref()
        .unwrap()
        .grants()
        .unwrap()
        .is_empty());
    assert_eq!(
        serde_json::to_value(definitions).unwrap(),
        serde_json::to_value(crate::tools::direct_tool_definitions(false)).unwrap()
    );
    while let Ok(envelope) = events.try_recv() {
        assert!(!matches!(
            envelope.event,
            SessionEvent::Agent {
                event: AgentEvent::ModelCallStarted { .. }
            } | SessionEvent::RunStarted { .. }
                | SessionEvent::TranscriptAppended { .. }
                | SessionEvent::PermissionAsked { .. }
        ));
    }
    println!("ALL299 service receipt: marker={marker}; inventory={inventory}; read={read}; search={search}; messages/inbox unchanged, no model call/permission event");
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    drop(agent);
    let _ = std::fs::remove_dir_all(directory);
}

#[tokio::test]
async fn human_give_and_reclaim_change_inventory_without_read_acquiring_control() {
    use crate::terminal::InputController;
    let (parts, directory) = fixture();
    let service = &parts.service;
    let agent = service.agent.lock().await;
    let runtime = agent.user_terminal_runtime().unwrap();
    let before_messages = serde_json::to_value(&agent.messages).unwrap();
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .write_user_terminal_input(&terminal.id, b"printf 'CONTROL-INVENTORY-READY\\n'\r")
        .await
        .unwrap();
    wait_for(service, &terminal.id, b"CONTROL-INVENTORY-READY").await;
    let human = service.terminal_input_control(&terminal.id).await.unwrap();
    assert_eq!(human.controller, InputController::Human);
    assert!(!human.frozen);
    let inventory = native(&runtime, "list_executions", json!({})).await;
    assert_eq!(inventory["executions"][0]["id"], terminal.id);
    assert_eq!(inventory["executions"][0]["input"], false);
    assert_eq!(
        service.terminal_input_control(&terminal.id).await.unwrap(),
        human
    );

    let given = service
        .transfer_terminal_input_control(
            &terminal.id,
            human.revision.parse().unwrap(),
            InputController::Agent,
            false,
        )
        .await
        .unwrap();
    assert_eq!(given.controller, InputController::Agent);
    assert!(!given.frozen);
    let inventory = native(&runtime, "list_executions", json!({})).await;
    assert_eq!(inventory["executions"][0]["id"], terminal.id);
    assert_eq!(inventory["executions"][0]["input"], true);
    assert_eq!(
        service.terminal_input_control(&terminal.id).await.unwrap(),
        given
    );

    let reclaimed = service
        .transfer_terminal_input_control(
            &terminal.id,
            given.revision.parse().unwrap(),
            InputController::Human,
            false,
        )
        .await
        .unwrap();
    let inventory = native(&runtime, "list_executions", json!({})).await;
    assert_eq!(inventory["executions"][0]["id"], terminal.id);
    assert_eq!(inventory["executions"][0]["input"], false);
    assert_eq!(
        service.terminal_input_control(&terminal.id).await.unwrap(),
        reclaimed
    );
    assert!(
        service
            .user_terminal_status(&terminal.id)
            .await
            .unwrap()
            .alive
    );
    assert_eq!(
        serde_json::to_value(&agent.messages).unwrap(),
        before_messages
    );
    assert!(service.list_direct_inbox().unwrap().is_empty());
    assert!(service
        .permission_broker
        .as_ref()
        .unwrap()
        .pending()
        .is_empty());
    assert!(service
        .permission_broker
        .as_ref()
        .unwrap()
        .grants()
        .unwrap()
        .is_empty());
    println!("ALL299 inventory control receipt: id={}; human={human:?}; given={given:?}; reclaimed={reclaimed:?}; input false/true/false; native inventory left control and lifetime unchanged", terminal.id);
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    drop(agent);
    let _ = std::fs::remove_dir_all(directory);
}
