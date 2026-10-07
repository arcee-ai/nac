use super::*;
use crate::runtime::{RuntimeEffectLease, RuntimeEffectLeaseHandle};
use std::{future::Future, pin::Pin};

pub(crate) struct Lease {
    denied: AtomicBool,
    notify: Notify,
}
impl Lease {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            denied: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }
    pub(crate) fn deny(&self) {
        self.denied.store(true, Ordering::Release);
        self.notify.notify_waiters();
    }
    pub(crate) fn handle(self: &Arc<Self>) -> RuntimeEffectLeaseHandle {
        Arc::clone(self) as RuntimeEffectLeaseHandle
    }
}
impl RuntimeEffectLease for Lease {
    fn check_available(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            !self.denied.load(Ordering::Acquire),
            "synthetic lease denied"
        );
        Ok(())
    }
    fn check_current(&self) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send + '_>> {
        Box::pin(async move { self.check_available() })
    }
    fn wait_for_denial(&self) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            loop {
                let notified = self.notify.notified();
                if self.check_available().is_err() {
                    return;
                }
                notified.await;
            }
        })
    }
}
pub(crate) struct TempRoot(PathBuf);
impl TempRoot {
    pub(crate) fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("nac-runtime-effect-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn leased(lease: &Arc<Lease>) -> ToolRuntime {
    let mut runtime = test_runtime();
    runtime.runtime_effect_required = true;
    runtime.runtime_effect_lease = Some(lease.handle());
    runtime.command_cancellation =
        ThreadCancellation::for_execution(None, Some(lease.handle()), true);
    runtime
}

#[tokio::test]
async fn selected_mediated_missing_authority_denies_and_standalone_remains_available() {
    let mut runtime = test_runtime();
    assert!(runtime.check_execution_authority().await.is_ok());
    runtime.runtime_effect_required = true;
    runtime.command_cancellation = ThreadCancellation::for_execution(None, None, true);
    assert!(runtime.check_execution_authority().await.is_err());
    assert!(runtime
        .command_cancellation
        .run_if_active(|| panic!("unleased effect must not execute"))
        .is_none());
    tokio::time::timeout(
        Duration::from_millis(100),
        runtime.command_cancellation.cancelled(),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn lease_denial_after_workspace_wait_denies_prepared_and_native_effects() {
    let root = TempRoot::new();
    let lease = Lease::new();
    let mut runtime = leased(&lease);
    runtime.workspace_cwd = root.path().into();
    runtime.config_cwd = root.path().into();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
    let client = crate::model::ModelClient::new_for_test();
    let gate = shared_workspace_gate(&runtime);
    let held = gate.write().await;
    let call = execute_tool(
        "write",
        serde_json::json!({"path":"queued.txt","content":"blocked","expected_revision":null}),
        &runtime,
        &client,
    );
    tokio::pin!(call);
    tokio::select! {
        result = &mut call => panic!("write did not wait: {}",result.content),
        () = tokio::time::sleep(Duration::from_millis(30)) => {}
    }
    lease.deny();
    drop(held);
    assert!(
        tokio::time::timeout(Duration::from_secs(1), call)
            .await
            .unwrap()
            .is_error
    );
    assert!(!root.path().join("queued.txt").exists());
    std::fs::write(root.path().join("read.txt"), "private leased output").unwrap();
    let registry = worker_tool_registry(false).unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let native = registry
        .native_handle::<ReadTool>()
        .unwrap()
        .invoke(
            read::ReadInput::new("read.txt"),
            services,
            &kernel::ToolCallContext::default(),
        )
        .await;
    assert!(native.is_error);
    assert!(!native.content.contains("private leased output"));
    assert!(runtime
        .command_cancellation
        .child()
        .run_if_active(|| panic!("child cannot evade original lease"))
        .is_none());
}

#[tokio::test]
async fn lease_expiry_observation_does_not_wait_for_prompt_mutation_gate() {
    let lease = Lease::new();
    let cancellation = leased(&lease).command_cancellation;
    let held = cancellation.clone();
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    let blocked = tokio::task::spawn_blocking(move || {
        held.run_if_active(|| {
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        })
    });
    tokio::task::spawn_blocking(move || entered_rx.recv().unwrap())
        .await
        .unwrap();
    lease.deny();
    tokio::time::timeout(Duration::from_millis(100), cancellation.cancelled())
        .await
        .unwrap();
    release_tx.send(()).unwrap();
    blocked.await.unwrap();
    assert!(cancellation
        .run_if_active(|| panic!("final mutation cannot pass observed lease denial"))
        .is_none());
}

#[cfg(unix)]
#[tokio::test]
async fn original_lease_denial_stops_selected_background_process_without_poisoning_other_operation()
{
    let root = TempRoot::new();
    let lease = Lease::new();
    let mut runtime = leased(&lease);
    runtime.workspace_cwd = root.path().into();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
    let result = exec_command::execute_exec_command(
        &serde_json::json!({"cmd":"echo $$ > pid; exec sleep 30","tty":true,"yield_time_ms":100}),
        &runtime,
    )
    .await;
    assert!(!result.is_error, "{}", result.content);
    let result: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    let original_name = result["session_name"].as_str().unwrap();
    let original_output = result["output_id"].as_str().unwrap();
    let retained = exec_command::execute_write_stdin(
        &serde_json::json!({"session_id":original_name,"retain":true,"yield_time_ms":10}),
        &runtime,
    )
    .await;
    assert!(!retained.is_error, "{}", retained.content);
    let mut separate = leased(&Lease::new());
    separate.workspace_cwd = root.path().into();
    separate.backend = Arc::clone(&runtime.backend);
    separate.terminal_manager = runtime.terminal_manager.clone();
    let second = exec_command::execute_exec_command(
        &serde_json::json!({"cmd":"echo $$ > second-pid; exec sleep 30","tty":true,"yield_time_ms":100}), &separate,
    ).await;
    assert!(!second.is_error, "{}", second.content);
    let second_pid: i32 = std::fs::read_to_string(root.path().join("second-pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    let pid: i32 = std::fs::read_to_string(root.path().join("pid"))
        .unwrap()
        .trim()
        .parse()
        .unwrap();
    lease.deny();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            // SAFETY: zero signal only checks this synthetic child's existence.
            if unsafe { libc::kill(pid, 0) } == -1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    // SAFETY: zero signal only observes the separately admitted synthetic child.
    assert_eq!(
        unsafe { libc::kill(second_pid, 0) },
        0,
        "a later operation sharing the manager remains alive"
    );
    assert!(
        runtime
            .terminal_manager
            .read_output(
                original_output,
                crate::terminal::OutputStream::Combined,
                0,
                1024
            )
            .is_ok(),
        "lease cutoff preserves captured output for observation"
    );
    runtime.terminal_manager.remove_all().await.unwrap();
    assert!(separate.check_execution_authority().await.is_ok());
    assert!(separate.command_cancellation.run_if_active(|| 7).is_some());
}

struct LeaseEndingTool(Arc<Lease>);
impl kernel::NativeTool for LeaseEndingTool {
    type Input = ();
    fn definition(&self) -> ToolDefinition {
        ToolDefinition {
            def_type: "function".into(),
            function: crate::types::FunctionDef {
                name: "lease_ending_fixture".into(),
                description: "fixture".into(),
                parameters: serde_json::json!({"type":"object","properties":{}}),
            },
        }
    }
    fn admission(&self) -> kernel::ToolAdmission {
        kernel::ToolAdmission::Parallel
    }
    fn decode(&self, _: Value) -> Result<(), ToolResult> {
        Ok(())
    }
    fn permission_resources(
        &self,
        _: &(),
        _: kernel::ToolServices<'_>,
    ) -> Result<Vec<kernel::PermissionResource>, ToolResult> {
        Ok(Vec::new())
    }
    fn execute<'a>(
        &'a self,
        _: (),
        _: kernel::ToolServices<'a>,
        _: &'a kernel::ToolCallContext,
    ) -> futures_util::future::BoxFuture<'a, ToolResult> {
        Box::pin(async move {
            self.0.deny();
            ToolResult::text("private result after original lease ended", false)
        })
    }
}

#[tokio::test]
async fn native_and_prepared_call_results_are_withheld_when_lease_ends_during_effect() {
    for native in [true, false] {
        let lease = Lease::new();
        let runtime = leased(&lease);
        let client = crate::model::ModelClient::new_for_test();
        let registry = kernel::ToolRegistry::builder()
            .register(LeaseEndingTool(Arc::clone(&lease)))
            .finish()
            .unwrap();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let context = kernel::ToolCallContext::default();
        let result = if native {
            registry
                .native_handle::<LeaseEndingTool>()
                .unwrap()
                .invoke((), services, &context)
                .await
        } else {
            registry
                .snapshot(["lease_ending_fixture"])
                .unwrap()
                .prepare("lease_ending_fixture", serde_json::json!({}), services)
                .unwrap()
                .invoke(services, &context)
                .await
        };
        assert!(result.is_error);
        assert!(!result
            .content
            .contains("private result after original lease ended"));
        assert!(!result.content.contains("synthetic lease denied"));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn stale_original_lease_watcher_does_not_kill_a_reused_native_terminal_name() {
    let root = TempRoot::new();
    let lease = Lease::new();
    let runtime = leased(&lease);
    let name = "native-reused-fixture".to_owned();
    runtime
        .terminal_manager
        .create_with_cancellation(
            name.clone(),
            "sleep 30",
            Some(root.path().into()),
            80,
            24,
            &runtime.backend,
            Some(&runtime.command_cancellation),
        )
        .await
        .unwrap();
    runtime.terminal_manager.terminate(&name).await.unwrap();
    let replacement = ThreadCancellation::default();
    runtime
        .terminal_manager
        .create_with_cancellation(
            name.clone(),
            "sleep 30",
            Some(root.path().into()),
            80,
            24,
            &runtime.backend,
            Some(&replacement),
        )
        .await
        .unwrap();
    lease.deny();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(
        runtime.terminal_manager.get(&name).await.unwrap().alive,
        "stale watcher cannot act on replacement output identity"
    );
    runtime.terminal_manager.remove_all().await.unwrap();
}
