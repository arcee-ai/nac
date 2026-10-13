use super::*;
use crate::permissions::{PermissionBackend, PermissionBroker, PermissionEffect, PermissionRule};
use crate::terminal::TerminalManager;
use crate::tools::{execute_tool, ThreadCancellation};
use std::sync::Arc;
use std::time::Duration;

fn runtime(rules: Vec<PermissionRule>) -> ToolRuntime {
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = std::env::temp_dir()
        .join(format!("nac-observation-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    crate::store::initialize(&runtime.store_path).unwrap();
    crate::store::insert_test_session(&runtime.store_path, "test-session");
    crate::store::open_runtime_connection(&runtime.store_path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior='direct', backend='arcee-api' WHERE session_id='test-session'",
            [],
        )
        .unwrap();
    runtime.terminal_manager = TerminalManager::for_direct();
    runtime
        .terminal_manager
        .configure_session_resource_authority(runtime.store_path.clone(), "test-session".into());
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "test-session".into(),
        PermissionBackend::Local,
        0,
        rules,
    )));
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::DIRECT_TOOL_NAMES
            .iter()
            .map(|n| (*n).into())
            .collect(),
    ));
    runtime
}

async fn call(runtime: &ToolRuntime, name: &str, input: Value) -> ToolResult {
    execute_tool(
        name,
        input,
        runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await
}

async fn value(runtime: &ToolRuntime, name: &str, input: Value) -> Value {
    let result = call(runtime, name, input).await;
    assert!(!result.is_error, "{}", result.content);
    serde_json::from_str(result.content.as_text().unwrap()).unwrap()
}

async fn launch(runtime: &ToolRuntime, command: &str, secrets: Vec<String>) -> String {
    let manager = &runtime.terminal_manager;
    let id = manager.user_terminal_name(uuid::Uuid::new_v4());
    manager
        .create_user_terminal(
            id.clone(),
            command,
            runtime.workspace_cwd.clone(),
            80,
            24,
            &runtime.backend,
            nac_contracts::CommandEnvironmentSnapshot::from_parts(Default::default(), secrets),
            None,
            &ThreadCancellation::default(),
        )
        .await
        .unwrap();
    id
}

async fn await_bytes(runtime: &ToolRuntime, id: &str, needle: &[u8]) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let page = runtime
                .terminal_manager
                .read_execution_output(id, 0, 65536)
                .await
                .unwrap();
            if page
                .bytes
                .windows(needle.len())
                .any(|window| window == needle)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}

async fn cleanup(runtime: &ToolRuntime) {
    runtime.terminal_manager.remove_all().await.unwrap();
    let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
}

#[tokio::test]
async fn native_inventory_read_search_retrieves_unpredictable_human_failure_without_attachment() {
    let runtime = runtime(vec![]);
    let before = crate::tools::direct_tool_definitions(false);
    let empty = value(&runtime, "list_executions", json!({})).await;
    assert_eq!(empty, json!({"executions":[],"next_after":null}));
    let marker = format!("FAILURE-{}", uuid::Uuid::new_v4());
    let id = launch(
        &runtime,
        &format!("printf '{marker} '; printf 'dependency unavailable\\n' >&2; exit 7"),
        vec![],
    )
    .await;
    await_bytes(&runtime, &id, b"dependency unavailable").await;
    let inventory = value(&runtime, "list_executions", json!({})).await;
    assert_eq!(inventory["executions"].as_array().unwrap().len(), 1);
    let entry = &inventory["executions"][0];
    assert_eq!(entry["id"], id);
    assert_eq!(entry["origin"], "human");
    assert_eq!(entry["representation"], "pty");
    assert_eq!(entry["read"], true);
    assert_eq!(entry["input"], false);
    assert!(!inventory.to_string().contains(&marker));
    assert!(entry.get("output_id").is_none() && entry.get("request_id").is_none());
    let read = value(
        &runtime,
        "read_command_output",
        json!({"execution_id":entry["id"],"offset":"0","limit":512}),
    )
    .await;
    assert!(read["content"].as_str().unwrap().contains(&marker));
    assert!(read["content"]
        .as_str()
        .unwrap()
        .contains("dependency unavailable"));
    let search = value(
        &runtime,
        "read_command_output",
        json!({"execution_id":entry["id"],"query":"dependency unavailable","limit":512}),
    )
    .await;
    assert_eq!(search["matches"].as_array().unwrap().len(), 1);
    assert!(search.get("content").is_none());
    assert_eq!(
        serde_json::to_value(before).unwrap(),
        serde_json::to_value(crate::tools::direct_tool_definitions(false)).unwrap()
    );
    let write = call(
        &runtime,
        "write_stdin",
        json!({"session_id":id,"chars":"echo forbidden<RET>"}),
    )
    .await;
    assert!(write.is_error);
    assert_eq!(
        crate::store::list_session_inbox(&runtime.store_path, "test-session")
            .unwrap()
            .len(),
        0
    );
    println!("ALL299 native receipts: marker={marker}; inventory={inventory}; read={read}; search={search}");
    cleanup(&runtime).await;
}

#[tokio::test]
async fn source_masking_is_immutable_and_model_and_browser_cursors_are_independent() {
    let runtime = runtime(vec![PermissionRule::new(
        "terminal_input",
        "*",
        PermissionEffect::Allow,
    )]);
    let id = launch(
        &runtime,
        "printf sec; sleep .03; printf 'ret-value\\377\\033[31m tail'; sleep 60",
        vec!["secret-value".into(), "REDACTED".into()],
    )
    .await;
    await_bytes(&runtime, &id, b"tail").await;
    let browser_before = runtime
        .terminal_manager
        .read_execution_output(&id, 0, 1024)
        .await
        .unwrap();
    let read = value(
        &runtime,
        "read_command_output",
        json!({"execution_id":id,"limit":1024}),
    )
    .await;
    assert_eq!(read["content"], "[REDACTED]�\\u{001b}[31m tail");
    let search = value(
        &runtime,
        "read_command_output",
        json!({"execution_id":id,"query":"REDACTED","limit":1024}),
    )
    .await;
    assert_eq!(search["matches"].as_array().unwrap().len(), 1);
    let no_secret = value(
        &runtime,
        "read_command_output",
        json!({"execution_id":id,"query":"secret-value","limit":1024}),
    )
    .await;
    assert!(no_secret["matches"].as_array().unwrap().is_empty());
    assert!(
        browser_before
            == runtime
                .terminal_manager
                .read_execution_output(&id, 0, 1024)
                .await
                .unwrap()
    );
    assert_eq!(
        read,
        value(
            &runtime,
            "read_command_output",
            json!({"execution_id":id,"limit":1024})
        )
        .await
    );
    assert!(
        runtime
            .terminal_manager
            .execution_status(&id)
            .await
            .unwrap()
            .alive
    );
    assert!(!read.to_string().contains("secret-value"));
    let input = call(
        &runtime,
        "write_stdin",
        json!({"session_id":id,"chars":"FORBIDDEN<RET>"}),
    )
    .await;
    assert!(input.is_error);
    assert!(
        runtime
            .terminal_manager
            .execution_status(&id)
            .await
            .unwrap()
            .alive
    );
    cleanup(&runtime).await;
}

#[tokio::test]
async fn wrong_session_store_restart_and_raw_ids_are_opaque_and_brokerless_views_fail_closed() {
    let runtime = runtime(vec![]);
    let id = launch(&runtime, "printf PRIVATE; sleep 60", vec![]).await;
    await_bytes(&runtime, &id, b"PRIVATE").await;
    let mut wrong_session = runtime.clone();
    wrong_session.session_id = Some("child-with-parent-provenance".into());
    let mut wrong_store = runtime.clone();
    wrong_store.store_path = runtime.store_path.with_file_name("other.db");
    let mut restart = runtime.clone();
    restart.terminal_manager = TerminalManager::for_direct();
    restart
        .terminal_manager
        .configure_session_resource_authority(runtime.store_path.clone(), "test-session".into());
    let mut brokerless = runtime.clone();
    brokerless.permission_broker = None;
    for denied_runtime in [&wrong_session, &wrong_store, &restart, &brokerless] {
        let result = call(
            denied_runtime,
            "read_command_output",
            json!({"execution_id":id}),
        )
        .await;
        assert!(result.is_error);
        assert_eq!(
            result.content.as_text(),
            Some("Error: execution unavailable")
        );
        assert!(!result.content.as_text().unwrap().contains("PRIVATE"));
    }
    for input in [
        json!({"execution_id":"output-known-raw-id"}),
        json!({"output_id":id}),
    ] {
        assert!(call(&runtime, "read_command_output", input).await.is_error);
    }
    assert!(
        call(&brokerless, "list_executions", json!({}))
            .await
            .is_error
    );
    cleanup(&runtime).await;
}

#[tokio::test]
async fn expired_completed_execution_cannot_read_still_retained_artifact_or_recover_work() {
    let runtime = runtime(vec![]);
    let id = launch(&runtime, "printf OLD; sleep 60", vec![]).await;
    await_bytes(&runtime, &id, b"OLD").await;
    runtime
        .terminal_manager
        .terminate_user_terminal(&id)
        .await
        .unwrap();
    assert!(
        value(&runtime, "read_command_output", json!({"execution_id":id})).await["content"]
            .as_str()
            .unwrap()
            .contains("OLD")
    );
    for _ in 0..16 {
        let replacement = launch(&runtime, "true", vec![]).await;
        runtime
            .terminal_manager
            .terminate_user_terminal(&replacement)
            .await
            .unwrap();
    }
    assert!(runtime
        .terminal_manager
        .execution_status(&id)
        .await
        .is_err());
    let expired = call(
        &runtime,
        "read_command_output",
        json!({"execution_id":id,"query":"OLD"}),
    )
    .await;
    assert_eq!(
        expired.content.as_text(),
        Some("Error: execution unavailable")
    );
    cleanup(&runtime).await;
}

#[tokio::test]
async fn configured_denials_apply_to_inventory_and_reads_and_ask_revalidates_after_expiry() {
    let runtime = runtime(vec![PermissionRule::new(
        "command_output",
        "*",
        PermissionEffect::Deny,
    )]);
    let id = launch(&runtime, "printf NEVER-READ; sleep 60", vec![]).await;
    for (name, input) in [
        ("list_executions", json!({})),
        ("read_command_output", json!({"execution_id":id})),
        (
            "read_command_output",
            json!({"execution_id":id,"query":"NEVER"}),
        ),
    ] {
        let result = call(&runtime, name, input).await;
        assert!(
            result.is_error
                && result
                    .content
                    .as_text()
                    .unwrap()
                    .contains("permission denied")
        );
        assert!(!result.content.as_text().unwrap().contains("NEVER-READ"));
    }
    cleanup(&runtime).await;
    let runtime = runtime_with_ask();
    let id = launch(&runtime, "printf EXPIRES; sleep 60", vec![]).await;
    let broker = runtime.permission_broker.as_ref().unwrap();
    let bus = crate::events::SessionEventBus::new(Some("test-session".into()));
    let _subscriber = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let pending = call(&runtime, "read_command_output", json!({"execution_id":id}));
    let expire = async {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    runtime.terminal_manager.remove_all().await.unwrap();
                    broker
                        .reply(&request.id, crate::permissions::PermissionReply::Once)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    };
    let (denied, ()) = tokio::join!(pending, expire);
    assert_eq!(
        denied.content.as_text(),
        Some("Error: execution unavailable")
    );
    cleanup(&runtime).await;
}

fn runtime_with_ask() -> ToolRuntime {
    runtime(vec![PermissionRule::new(
        "command_output",
        "*",
        PermissionEffect::Ask,
    )])
}

#[tokio::test]
async fn bounded_pipe_stream_search_continues_across_pages_and_inventory_pages() {
    let runtime = runtime(vec![]);
    for _ in 0..3 {
        let result = call(
            &runtime,
            "exec_command",
            json!({"cmd":"printf abcNEEDLExyz; printf diagnostic >&2"}),
        )
        .await;
        assert!(result.is_error); // Local exec Ask remains headless fail-closed.
    }
    for _ in 0..3 {
        let output = runtime
            .terminal_manager
            .exec_one_shot(
                "printf abcNEEDLExyz; printf diagnostic >&2",
                None,
                80,
                24,
                5000,
                100,
                &runtime.backend,
                None,
            )
            .await;
        assert_eq!(output.exit_code, Some(0));
    }
    let first = value(&runtime, "list_executions", json!({"limit":2})).await;
    let second = value(
        &runtime,
        "list_executions",
        json!({"limit":2,"after":first["next_after"]}),
    )
    .await;
    assert_eq!(first["executions"].as_array().unwrap().len(), 2);
    assert_eq!(second["executions"].as_array().unwrap().len(), 1);
    let id = first["executions"][0]["id"].clone();
    let mut cursor = Value::from("0");
    let mut found = Vec::new();
    loop {
        let page = value(
            &runtime,
            "read_command_output",
            json!({"execution_id":id,"stream":"stdout","query":"NEEDLE","offset":cursor,"limit":8}),
        )
        .await;
        found.extend(page["matches"].as_array().unwrap().iter().cloned());
        cursor = page["next_offset"].clone();
        if page["search_complete"] == true {
            break;
        }
    }
    assert_eq!(found.len(), 1);
    assert_eq!(found[0]["offset"], "3");
    let stderr = value(
        &runtime,
        "read_command_output",
        json!({"execution_id":id,"stream":"stderr"}),
    )
    .await;
    assert_eq!(stderr["content"], "diagnostic");
    cleanup(&runtime).await;
}

#[test]
fn search_result_capacity_and_decimal_cursors_preserve_explicit_continuations() {
    let page = OutputBytePage {
        bytes: b"aaaaaaaaaaaaaaaaaaaa".to_vec(),
        offset: 100,
        next_offset: 120,
        retained_start: 0,
        retained_end: 120,
        gap: false,
        caught_up: true,
        segments: vec![],
    };
    let (matches, continuation) = search_page(&page, b"a");
    assert_eq!(matches.len(), 16);
    assert_eq!(continuation, 116);
    assert_eq!(
        offset(&json!({"offset":"18446744073709551615"})).unwrap(),
        u64::MAX
    );
    for bad in ["00", "-1", "18446744073709551616"] {
        assert!(offset(&json!({"offset":bad})).is_err());
    }
    assert!(validate_query(&json!({"query":"x","limit":1})).is_err());
}

#[tokio::test]
async fn stale_config_missing_owner_backend_and_store_readiness_are_rechecked_before_pages() {
    let runtime = runtime(vec![]);
    let id = launch(&runtime, "printf FENCED; sleep 60", vec![]).await;
    await_bytes(&runtime, &id, b"FENCED").await;
    let original = value(&runtime, "read_command_output", json!({"execution_id":id})).await;
    assert!(original["content"].as_str().unwrap().contains("FENCED"));
    let conn = crate::store::open_runtime_connection(&runtime.store_path).unwrap();
    conn.execute(
        "UPDATE sessions SET config_version=1 WHERE session_id='test-session'",
        [],
    )
    .unwrap();
    for name in ["list_executions", "read_command_output"] {
        let denied = call(
            &runtime,
            name,
            if name == "list_executions" {
                json!({})
            } else {
                json!({"execution_id":id})
            },
        )
        .await;
        assert_eq!(
            denied.content.as_text(),
            Some("Error: execution unavailable")
        );
    }
    conn.execute(
        "UPDATE sessions SET config_version=0 WHERE session_id='test-session'",
        [],
    )
    .unwrap();
    let mut wrong_backend = runtime.clone();
    wrong_backend.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "test-session".into(),
        PermissionBackend::Ssh,
        0,
        [],
    )));
    assert_eq!(
        call(
            &wrong_backend,
            "read_command_output",
            json!({"execution_id":id})
        )
        .await
        .content
        .as_text(),
        Some("Error: execution unavailable")
    );
    conn.execute(
        "UPDATE sessions SET behavior='orchestrator' WHERE session_id='test-session'",
        [],
    )
    .unwrap();
    assert_eq!(
        call(&runtime, "read_command_output", json!({"execution_id":id}))
            .await
            .content
            .as_text(),
        Some("Error: execution unavailable")
    );
    conn.execute(
        "UPDATE sessions SET behavior='direct' WHERE session_id='test-session'",
        [],
    )
    .unwrap();
    conn.pragma_update(None, "user_version", crate::store::schema_version() + 1)
        .unwrap();
    let unready = call(&runtime, "read_command_output", json!({"execution_id":id})).await;
    assert!(unready.is_error && !unready.content.as_text().unwrap().contains("FENCED"));
    conn.pragma_update(None, "user_version", crate::store::schema_version())
        .unwrap();
    conn.execute("DELETE FROM sessions WHERE session_id='test-session'", [])
        .unwrap();
    assert!(
        call(&runtime, "read_command_output", json!({"execution_id":id}))
            .await
            .is_error
    );
    drop(conn);
    cleanup(&runtime).await;
}

#[tokio::test(flavor = "current_thread")]
async fn owned_serving_store_observation_uses_supported_async_read_ports() {
    let runtime = runtime(vec![]);
    let id = launch(&runtime, "printf OWNED-STORE; sleep 60", vec![]).await;
    await_bytes(&runtime, &id, b"OWNED-STORE").await;
    let owner = crate::store::StoreCoordinator::acquire(&runtime.store_path).unwrap();
    let inventory = value(&runtime, "list_executions", json!({})).await;
    assert_eq!(inventory["executions"][0]["id"], id);
    let read = value(&runtime, "read_command_output", json!({"execution_id":id})).await;
    assert_eq!(read["content"], "OWNED-STORE");
    runtime.terminal_manager.remove_all().await.unwrap();
    owner.shutdown().await.unwrap();
    drop(owner);
    let _ = std::fs::remove_dir_all(runtime.store_path.parent().unwrap());
}

#[tokio::test]
async fn ask_once_keeps_grants_empty_and_rejects_config_replacement_after_approval() {
    let runtime = runtime_with_ask();
    let id = launch(&runtime, "printf CURRENT; sleep 60", vec![]).await;
    await_bytes(&runtime, &id, b"CURRENT").await;
    let broker = runtime.permission_broker.as_ref().unwrap();
    let headless = call(&runtime, "read_command_output", json!({"execution_id":id})).await;
    assert!(
        headless.is_error
            && headless
                .content
                .as_text()
                .unwrap()
                .contains("permission denied")
    );
    let bus = crate::events::SessionEventBus::new(Some("test-session".into()));
    let _subscriber = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus);
    let read = call(&runtime, "read_command_output", json!({"execution_id":id}));
    let reply = async {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    assert_eq!(request.resources[0].action, "command_output");
                    assert_eq!(request.resources[0].resource, id);
                    broker
                        .reply(&request.id, crate::permissions::PermissionReply::Once)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    };
    let (allowed, ()) = tokio::join!(read, reply);
    assert!(!allowed.is_error && allowed.content.as_text().unwrap().contains("CURRENT"));
    assert!(broker.grants().unwrap().is_empty());
    let read = call(&runtime, "read_command_output", json!({"execution_id":id}));
    let replace = async {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(request) = broker.pending().pop() {
                    crate::store::open_runtime_connection(&runtime.store_path)
                        .unwrap()
                        .execute(
                            "UPDATE sessions SET config_version=1 WHERE session_id='test-session'",
                            [],
                        )
                        .unwrap();
                    broker
                        .reply(&request.id, crate::permissions::PermissionReply::Once)
                        .unwrap();
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    };
    let (denied, ()) = tokio::join!(read, replace);
    assert_eq!(
        denied.content.as_text(),
        Some("Error: execution unavailable")
    );
    assert!(broker.grants().unwrap().is_empty());
    cleanup(&runtime).await;
}

#[tokio::test]
async fn durable_child_and_copied_fork_provenance_never_supply_a_terminal_read_capability() {
    let runtime = runtime(vec![]);
    let id = launch(&runtime, "printf ORIGINAL; sleep 60", vec![]).await;
    await_bytes(&runtime, &id, b"ORIGINAL").await;
    crate::store::insert_test_session(&runtime.store_path, "parent");
    let conn = crate::store::open_runtime_connection(&runtime.store_path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct', backend='arcee-api' WHERE session_id='parent'",
        [],
    )
    .unwrap();
    crate::store::create_traditional_child_relationship(
        &runtime.store_path,
        "parent",
        "test-session",
        "general",
        "child with own native runtime",
    )
    .unwrap();
    let child = call(&runtime, "read_command_output", json!({"execution_id":id})).await;
    assert_eq!(
        child.content.as_text(),
        Some("Error: execution unavailable")
    );
    crate::store::insert_test_session(&runtime.store_path, "fork");
    conn.execute("UPDATE sessions SET behavior='direct', backend='arcee-api', messages_json=?1 WHERE session_id='fork'", [json!([{"role":"user","content":format!("copied terminal evidence from {id}")}]).to_string()]).unwrap();
    let mut fork = runtime.clone();
    fork.session_id = Some("fork".into());
    fork.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "fork".into(),
        PermissionBackend::Local,
        0,
        [],
    )));
    fork.terminal_manager = TerminalManager::for_direct();
    fork.terminal_manager
        .configure_session_resource_authority(runtime.store_path.clone(), "fork".into());
    assert_eq!(
        value(&fork, "list_executions", json!({})).await["executions"],
        json!([])
    );
    let copied = call(&fork, "read_command_output", json!({"execution_id":id})).await;
    assert_eq!(
        copied.content.as_text(),
        Some("Error: execution unavailable")
    );
    assert!(
        runtime
            .terminal_manager
            .execution_status(&id)
            .await
            .unwrap()
            .alive
    );
    drop(conn);
    cleanup(&runtime).await;
}

#[tokio::test]
async fn legacy_worker_read_accepts_schema_valid_decimal_offsets_without_changing_page_shape() {
    let mut runtime = crate::tools::test_runtime();
    runtime.allowed_tools = Some(Arc::new(
        crate::tools::WORKER_TOOL_NAMES
            .iter()
            .map(|name| (*name).into())
            .collect(),
    ));
    let output = value(&runtime, "exec_command", json!({"cmd":"printf abcdefghij"})).await;
    let integer = value(
        &runtime,
        "read_command_output",
        json!({"output_id":output["output_id"],"stream":"stdout","offset":3,"limit":4}),
    )
    .await;
    let decimal = value(
        &runtime,
        "read_command_output",
        json!({"output_id":output["output_id"],"stream":"stdout","offset":"3","limit":4}),
    )
    .await;
    assert_eq!(integer, decimal);
    assert_eq!(decimal["content"], "defg");
    assert_eq!(decimal["offset"], 3);
    assert_eq!(decimal["next_offset"], 7);
    let native = crate::tools::exec_command::execute_read_command_output(
        &json!({"output_id":output["output_id"],"stream":"stdout","offset":"3","limit":4}),
        &runtime,
    );
    assert!(!native.is_error, "{}", native.content);
    assert_eq!(
        serde_json::from_str::<Value>(native.content.as_text().unwrap()).unwrap(),
        integer
    );
    for offset in ["", "01", "-1", "3.5", "18446744073709551616"] {
        let malformed = call(
            &runtime,
            "read_command_output",
            json!({"output_id":output["output_id"],"offset":offset}),
        )
        .await;
        assert!(malformed.is_error && !malformed.content.as_text().unwrap().contains("abcdefghij"));
        let native = crate::tools::exec_command::execute_read_command_output(
            &json!({"output_id":output["output_id"],"offset":offset}),
            &runtime,
        );
        assert!(native.is_error);
    }
    runtime.terminal_manager.remove_all().await.unwrap();
}
