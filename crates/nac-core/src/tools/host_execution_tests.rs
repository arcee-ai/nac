use super::*;
use crate::model::host_execution_test_support::Fixture;
use crate::model::ModelClient;
use serde_json::json;

fn runtime(fixture: &Fixture) -> ToolRuntime {
    let mut runtime = test_runtime();
    runtime.workspace_cwd = fixture.root.clone();
    runtime.config_cwd = fixture.root.clone();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, &fixture.root);
    runtime.host_execution_authority = Some(fixture.authority.clone());
    runtime.command_cancellation = ThreadCancellation::for_host(Some(fixture.authority.clone()));
    runtime
}

#[tokio::test]
async fn host_execution_denies_model_and_native_tools_even_with_unrelated_model() {
    let fixture = Fixture::new();
    let runtime = runtime(&fixture);
    let client = ModelClient::new_for_test();
    std::fs::write(fixture.root.join("read.txt"), "private workspace text").unwrap();
    let registry = worker_tool_registry(false).unwrap();
    let snapshot = registry.snapshot(["read"]).unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let context = kernel::ToolCallContext::default();
    let prepared = snapshot
        .prepare("read", json!({"path":"read.txt"}), services)
        .unwrap();
    fixture.remove();
    let native = registry
        .native_handle::<ReadTool>()
        .unwrap()
        .invoke(read::ReadInput::new("read.txt"), services, &context)
        .await;
    assert!(native.is_error);
    assert!(!native.content.contains("private workspace text"));
    assert!(prepared.invoke(services, &context).await.is_error);
    for (name, args) in [
        ("read", json!({"path":"read.txt"})),
        (
            "write",
            json!({"path":"created.txt","content":"side effect","expected_revision":null}),
        ),
        (
            "exec_command",
            json!({"cmd":"touch created-by-process.txt"}),
        ),
    ] {
        assert!(
            execute_tool(name, args, &runtime, &client).await.is_error,
            "{name}"
        );
    }
    assert!(!fixture.root.join("created.txt").exists());
    assert!(!fixture.root.join("created-by-process.txt").exists());
    fixture.restore();
    assert!(
        execute_tool("read", json!({"path":"read.txt"}), &runtime, &client)
            .await
            .is_error
    );
}

#[tokio::test]
async fn host_execution_denies_write_waiting_for_workspace_admission() {
    let fixture = Fixture::new();
    let runtime = runtime(&fixture);
    let client = ModelClient::new_for_test();
    let gate = shared_workspace_gate(&runtime);
    let held = gate.write().await;
    let call = execute_tool(
        "write",
        json!({"path":"queued.txt","content":"blocked","expected_revision":null}),
        &runtime,
        &client,
    );
    tokio::pin!(call);
    tokio::select! {
        result = &mut call => panic!("write did not wait: {}", result.content),
        () = tokio::time::sleep(Duration::from_millis(30)) => {}
    }
    fixture.remove();
    drop(held);
    let result = tokio::time::timeout(Duration::from_secs(3), call)
        .await
        .unwrap();
    assert!(result.is_error, "{}", result.content);
    assert!(!fixture.root.join("queued.txt").exists());
}

#[cfg(unix)]
#[tokio::test]
async fn host_execution_cancels_active_command_after_local_removal() {
    let fixture = Fixture::new();
    let runtime = runtime(&fixture);
    let pid_file = fixture.root.join("pid");
    let call = runtime.terminal_manager.exec_one_shot(
        "echo $$ > pid; exec sleep 30",
        Some(fixture.root.clone()),
        80,
        24,
        30_000,
        1024,
        &runtime.backend,
        Some(&runtime.command_cancellation),
    );
    tokio::pin!(call);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            tokio::select! {
                result = &mut call => panic!("command ended early: {:?}", result.status),
                () = tokio::time::sleep(Duration::from_millis(10)) => {}
            }
            if pid_file.exists() {
                break;
            }
        }
    })
    .await
    .unwrap();
    let pid: i32 = std::fs::read_to_string(&pid_file)
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let removed_at = std::time::Instant::now();
    fixture.remove();
    let result = tokio::time::timeout(Duration::from_secs(5), call)
        .await
        .unwrap();
    assert_eq!(result.status, crate::terminal::CommandStatus::Cancelled);
    runtime.terminal_manager.settle_run().await.unwrap();
    assert!(removed_at.elapsed() < Duration::from_secs(5));
    // SAFETY: kill with signal zero only checks this synthetic child's existence.
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
}
