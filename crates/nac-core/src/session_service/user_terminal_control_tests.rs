use super::*;
use crate::terminal::InputController;

async fn pending(service: &SessionService) -> crate::permissions::PermissionRequest {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Some(request) = service.list_permission_requests().unwrap().pop() {
                return request;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn native_input_requires_policy_and_reclaim_during_ask_invalidates_prepared_controller() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    let context = service.require_user_terminal_context().unwrap();
    let _interactive = service.event_bus.subscribe_assistant_deltas();
    service
        .transfer_terminal_input_control(&terminal.id, 1, InputController::Agent, false)
        .await
        .unwrap();
    assert!(service.list_permission_requests().unwrap().is_empty());
    let input = serde_json::json!({"session_id": terminal.id, "chars": "printf 'NATIVE-HUMAN-PTY\\n'<RET>", "yield_time_ms": 1});
    let invocation =
        crate::tools::execute_tool("write_stdin", input, &context.runtime, &context.client);
    let approve = async {
        let request = pending(service).await;
        assert_eq!(request.tool, "write_stdin");
        assert!(request.resources.iter().all(|r| r.save_resource.is_none()));
        service
            .reply_permission_request(&request.id, PermissionReply::Once)
            .unwrap();
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(invocation, approve)
    })
    .await
    .unwrap();
    assert!(!result.is_error, "{}", result.content);
    let receipt: serde_json::Value =
        serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(receipt["session_name"], terminal.id);
    wait_for(service, &terminal.id, b"NATIVE-HUMAN-PTY\r\n").await;

    let invocation = crate::tools::execute_tool(
        "write_stdin",
        serde_json::json!({"session_id": terminal.id, "chars": "printf 'STALE-ASK-MUST-NOT-WRITE\\n'<RET>"}),
        &context.runtime,
        &context.client,
    );
    let reclaim = async {
        let request = pending(service).await;
        service
            .transfer_terminal_input_control(&terminal.id, 2, InputController::Human, false)
            .await
            .unwrap();
        service
            .reply_permission_request(&request.id, PermissionReply::Once)
            .unwrap();
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(invocation, reclaim)
    })
    .await
    .unwrap();
    assert!(result.is_error);
    assert!(result.content.as_text().unwrap().contains("controller"));
    service
        .write_controlled_terminal_input(&terminal.id, 3, b"printf 'AFTER-RECLAIM\\n'\n")
        .await
        .unwrap();
    let bytes = wait_for(service, &terminal.id, b"AFTER-RECLAIM\r\n").await;
    assert!(!String::from_utf8_lossy(&bytes).contains("STALE-ASK-MUST-NOT-WRITE"));
    assert!(service.list_permission_grants().unwrap().is_empty());
    assert_eq!(
        service.permission_approval_mode().await.unwrap(),
        PermissionApprovalMode::Manual
    );
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn explicit_handoff_preserves_configured_input_deny() {
    let (parts, directory) = fixture_with_policy(
        None,
        vec![PermissionRule::new(
            "terminal_input",
            "shell-*",
            PermissionEffect::Deny,
        )],
    );
    let service = &parts.service;
    let context = service.require_user_terminal_context().unwrap();
    let name = context.runtime.terminal_manager.next_session_name();
    context
        .runtime
        .terminal_manager
        .create(
            name.clone(),
            "/bin/sh",
            None,
            80,
            24,
            &context.runtime.backend,
        )
        .await
        .unwrap();
    context
        .runtime
        .terminal_manager
        .retain_with_cancellation(&name, None)
        .await
        .unwrap();
    assert!(service
        .transfer_terminal_input_control(&name, 1, InputController::Human, false)
        .await
        .unwrap_err()
        .to_string()
        .contains("deny human terminal input control"));
    assert_eq!(
        service
            .terminal_input_control(&name)
            .await
            .unwrap()
            .revision,
        "1"
    );
    assert!(service
        .write_controlled_terminal_input(&name, 1, b"human-bypass")
        .await
        .is_err());
    let result = crate::tools::execute_tool(
        "write_stdin",
        serde_json::json!({"session_id": name, "chars": "printf DENIED<RET>"}),
        &context.runtime,
        &context.client,
    )
    .await;
    assert!(result.is_error);
    assert!(result
        .content
        .as_text()
        .unwrap()
        .contains("permission denied"));
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert!(service.list_permission_grants().unwrap().is_empty());
    service.terminate_terminal(&name).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn configuration_replacement_during_ask_fences_native_input_and_human_control() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    service
        .transfer_terminal_input_control(&terminal.id, 1, InputController::Agent, false)
        .await
        .unwrap();
    let context = service.require_user_terminal_context().unwrap();
    let _interactive = service.event_bus.subscribe_assistant_deltas();
    let invoke = crate::tools::execute_tool(
        "write_stdin",
        serde_json::json!({"session_id": terminal.id, "chars": "printf CONFIG-STALE<RET>"}),
        &context.runtime,
        &context.client,
    );
    let replace = async {
        let request = pending(service).await;
        let path = directory.join("store.db");
        let snapshot = sessions::load_session(&path, "direct-terminal").unwrap();
        sessions::update_session_config(&path, &snapshot).unwrap();
        service
            .reply_permission_request(&request.id, PermissionReply::Once)
            .unwrap();
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(invoke, replace)
    })
    .await
    .unwrap();
    assert!(result.is_error);
    assert!(result
        .content
        .as_text()
        .unwrap()
        .contains("configuration changed"));
    assert!(service
        .transfer_terminal_input_control(&terminal.id, 2, InputController::Human, false)
        .await
        .is_err());
    assert!(service
        .write_controlled_terminal_input(&terminal.id, 2, b"wrong\n")
        .await
        .is_err());
    assert!(service.terminal_input_control(&terminal.id).await.is_err());
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn retained_agent_human_takeover_and_native_handback_keep_same_pid() {
    let (parts, directory) = fixture();
    let service = &parts.service;
    let context = service.require_user_terminal_context().unwrap();
    let manager = &context.runtime.terminal_manager;
    let name = manager.next_session_name();
    let initial = manager
        .create(
            name.clone(),
            "/bin/sh",
            None,
            80,
            24,
            &context.runtime.backend,
        )
        .await
        .unwrap();
    manager.retain_with_cancellation(&name, None).await.unwrap();
    service
        .transfer_terminal_input_control(&name, 1, InputController::Human, false)
        .await
        .unwrap();
    service
        .write_controlled_terminal_input(&name, 2, b"printf 'HUMAN-RETAINED\\n'\n")
        .await
        .unwrap();
    service
        .transfer_terminal_input_control(&name, 2, InputController::Agent, false)
        .await
        .unwrap();
    let _interactive = service.event_bus.subscribe_assistant_deltas();
    let invoke = crate::tools::execute_tool(
        "write_stdin",
        serde_json::json!({"session_id": name, "chars": "printf 'NATIVE-HANDBACK\\n'<RET>", "yield_time_ms": 50}),
        &context.runtime,
        &context.client,
    );
    let approve = async {
        let request = pending(service).await;
        service
            .reply_permission_request(&request.id, PermissionReply::Once)
            .unwrap();
    };
    let (result, ()) = tokio::time::timeout(Duration::from_secs(4), async {
        tokio::join!(invoke, approve)
    })
    .await
    .unwrap();
    assert!(!result.is_error, "{}", result.content);
    let current = manager.get(&name).await.unwrap();
    assert_eq!(current.pid, initial.pid);
    assert!(current.retained);
    assert!(service.list_permission_grants().unwrap().is_empty());
    service.terminate_terminal(&name).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
async fn configured_control_deny_preserves_initial_human_ownership_without_ask_or_grants() {
    let (parts, directory) = fixture_with_policy(
        None,
        vec![PermissionRule::new(
            "terminal_control",
            "*",
            PermissionEffect::Deny,
        )],
    );
    let service = &parts.service;
    let terminal = service
        .open_user_terminal(Uuid::new_v4(), 80, 24)
        .await
        .unwrap();
    assert!(service
        .transfer_terminal_input_control(&terminal.id, 1, InputController::Agent, false)
        .await
        .is_err());
    let state = service.terminal_input_control(&terminal.id).await.unwrap();
    assert_eq!(state.controller, InputController::Human);
    assert_eq!(state.revision, "1");
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert!(service.list_permission_grants().unwrap().is_empty());
    service.terminate_user_terminal(&terminal.id).await.unwrap();
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
#[cfg(unix)]
async fn control_observation_and_denied_take_do_not_clean_exited_root_descendants() {
    let (parts, directory) = fixture_with_policy(
        None,
        vec![PermissionRule::new(
            "terminal_control",
            "*",
            PermissionEffect::Deny,
        )],
    );
    let service = &parts.service;
    let context = service.require_user_terminal_context().unwrap();
    let manager = &service.terminal_manager;
    let store = directory.join("store.db");
    let identity = crate::workspace::GitTarget::local(directory.clone()).lease_identity();
    manager.configure_workspace_authority(store.clone(), identity.clone());
    manager.configure_session_resource_authority(store.clone(), "direct-terminal".into());
    let executable = std::env::current_exe()
        .unwrap()
        .display()
        .to_string()
        .replace("'", "'\"'\"'");
    let release = directory.join("release-control-root");
    let command = format!("NAC_EXITED_PTY_DESCENDANT_HELPER=1 '{executable}' --exact terminal::session::tests::exited_pty_descendant_helper --nocapture & while [ ! -f '{}' ]; do sleep .01; done", release.display());
    let id = manager.next_session_name();
    manager
        .create(
            id.clone(),
            &command,
            Some(directory.clone()),
            80,
            24,
            &context.runtime.backend,
        )
        .await
        .unwrap();
    manager.retain_with_cancellation(&id, None).await.unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = service.read_execution_output(&id, 0, 32768).await.unwrap();
            if String::from_utf8_lossy(&page.bytes).contains("NAC_CHILD:") {
                break page;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let text = String::from_utf8_lossy(&frame.bytes);
    let child: u32 = text
        .split("NAC_CHILD:")
        .nth(1)
        .unwrap()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse()
        .unwrap();
    manager.write_stdin(&id, "", 10, 32768, None).await.unwrap();
    let before = manager.control_snapshot_for_test(&id).await;
    assert!(
        before.1 > 0,
        "fixture must preserve a nonzero model preview cursor"
    );
    let denied = service
        .transfer_terminal_input_control(&id, 1, InputController::Human, false)
        .await
        .unwrap_err();
    assert!(denied
        .to_string()
        .contains("deny human terminal input control"));
    std::fs::write(&release, "exit").unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.terminal_input_control(&id).await.is_ok() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    for _ in 0..3 {
        assert!(service.terminal_input_control(&id).await.is_err());
        assert!(service
            .transfer_terminal_input_control(&id, 1, InputController::Human, false)
            .await
            .is_err());
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let state = std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &child.to_string()])
        .output()
        .unwrap();
    let state = String::from_utf8_lossy(&state.stdout);
    assert!(
        !state.trim().is_empty() && !state.trim().starts_with('Z'),
        "control read or denied preparation killed descendant {child}: {state:?}"
    );
    assert_eq!(manager.control_snapshot_for_test(&id).await, before);
    assert!(matches!(
        crate::sessions::WorkspaceMutationLease::try_acquire(&store, &identity),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(matches!(
        crate::sessions::SessionResourceMutationLease::try_acquire(&store, "direct-terminal"),
        Err(crate::sessions::SessionOperationLeaseError::Busy(_))
    ));
    let replay = service.read_execution_output(&id, 0, 32768).await.unwrap();
    assert_eq!(replay.bytes, frame.bytes);
    assert_eq!(replay.offset, frame.offset);
    assert_eq!(replay.next_offset, frame.next_offset);
    assert!(service.list_permission_requests().unwrap().is_empty());
    assert!(service.list_permission_grants().unwrap().is_empty());
    manager.remove_all().await.unwrap();
    drop(parts);
    std::fs::remove_dir_all(directory).unwrap();
}

#[tokio::test]
#[cfg(unix)]
async fn denied_or_human_owned_model_input_preparation_preserves_exited_root_descendant() {
    for deny_input in [true, false] {
        let rules = if deny_input {
            vec![PermissionRule::new(
                "terminal_input",
                "*",
                PermissionEffect::Deny,
            )]
        } else {
            Vec::new()
        };
        let (parts, directory) = fixture_with_policy(None, rules);
        let service = &parts.service;
        let context = service.require_user_terminal_context().unwrap();
        let manager = &service.terminal_manager;
        let store = directory.join("store.db");
        let identity = crate::workspace::GitTarget::local(directory.clone()).lease_identity();
        manager.configure_workspace_authority(store.clone(), identity.clone());
        manager.configure_session_resource_authority(store.clone(), "direct-terminal".into());
        let executable = std::env::current_exe()
            .unwrap()
            .display()
            .to_string()
            .replace("'", "'\"'\"'");
        let release = directory.join("release-model-preauth-root");
        let command = format!("NAC_EXITED_PTY_DESCENDANT_HELPER=1 '{executable}' --exact terminal::session::tests::exited_pty_descendant_helper --nocapture & while [ ! -f '{}' ]; do sleep .01; done", release.display());
        let id = manager.next_session_name();
        manager
            .create(
                id.clone(),
                &command,
                Some(directory.clone()),
                80,
                24,
                &context.runtime.backend,
            )
            .await
            .unwrap();
        manager.retain_with_cancellation(&id, None).await.unwrap();
        let frame = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let page = service.read_execution_output(&id, 0, 32768).await.unwrap();
                if String::from_utf8_lossy(&page.bytes).contains("NAC_CHILD:") {
                    break page;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let text = String::from_utf8_lossy(&frame.bytes);
        let child: u32 = text
            .split("NAC_CHILD:")
            .nth(1)
            .unwrap()
            .chars()
            .take_while(char::is_ascii_digit)
            .collect::<String>()
            .parse()
            .unwrap();
        manager.write_stdin(&id, "", 10, 32768, None).await.unwrap();
        let before = manager.control_snapshot_for_test(&id).await;
        assert!(
            before.1 > 0,
            "fixture must preserve a nonzero model preview cursor"
        );
        if !deny_input {
            service
                .transfer_terminal_input_control(&id, 1, InputController::Human, false)
                .await
                .unwrap();
        }
        let before = manager.control_snapshot_for_test(&id).await;
        let invocation = || {
            crate::tools::execute_tool(
                "write_stdin",
                serde_json::json!({"session_id":id, "chars":"MUST-NOT-ARRIVE<RET>", "yield_time_ms":1}),
                &context.runtime,
                &context.client,
            )
        };
        assert!(
            tokio::time::timeout(Duration::from_secs(3), invocation())
                .await
                .unwrap()
                .is_error
        );
        std::fs::write(&release, "exit").unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            while service.terminal_input_control(&id).await.is_ok() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        for _ in 0..3 {
            assert!(
                tokio::time::timeout(Duration::from_secs(3), invocation())
                    .await
                    .unwrap()
                    .is_error
            );
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        let state = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &child.to_string()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&state.stdout);
        assert!(
        !state.trim().is_empty() && !state.trim().starts_with('Z'),
        "pre-authorization write_stdin killed descendant {child} (deny={deny_input}): {state:?}"
    );
        assert_eq!(manager.control_snapshot_for_test(&id).await, before);
        assert!(matches!(
            crate::sessions::WorkspaceMutationLease::try_acquire(&store, &identity),
            Err(crate::sessions::SessionOperationLeaseError::Busy(_))
        ));
        assert!(matches!(
            crate::sessions::SessionResourceMutationLease::try_acquire(&store, "direct-terminal"),
            Err(crate::sessions::SessionOperationLeaseError::Busy(_))
        ));
        let replay = service.read_execution_output(&id, 0, 32768).await.unwrap();
        assert_eq!(replay.bytes, frame.bytes);
        assert_eq!(replay.offset, frame.offset);
        assert_eq!(replay.next_offset, frame.next_offset);
        assert!(service.list_permission_requests().unwrap().is_empty());
        assert!(service.list_permission_grants().unwrap().is_empty());
        manager.remove_all().await.unwrap();
        drop(parts);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
