//! Command deadlines and PTY polls through the shared prepared kernel.
use super::*;
use crate::tools::kernel::NativeTool;
use serde_json::json;

struct TempRoot(std::path::PathBuf);
impl TempRoot {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("nac-command-timing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn path(&self) -> &std::path::Path {
        &self.0
    }
}
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Environment;
impl nac_contracts::CommandEnvironmentProvider for Environment {
    fn snapshot(&self) -> nac_contracts::CommandEnvironmentFuture<'_> {
        Box::pin(async { self.redaction_snapshot() })
    }
    fn redaction_snapshot(&self) -> anyhow::Result<nac_contracts::CommandEnvironmentSnapshot> {
        Ok(nac_contracts::CommandEnvironmentSnapshot::from_parts(
            Default::default(),
            vec!["deadline-secret-canary".into()],
        ))
    }
    fn worker_environment(&self) -> nac_contracts::WorkerEnvironment {
        Default::default()
    }
}

fn registry() -> kernel::ToolRegistry {
    kernel::ToolRegistry::builder()
        .register(ExecCommandTool)
        .register(WriteStdinTool)
        .register(ReadCommandOutputTool)
        .finish()
        .unwrap()
}

fn assert_prepares(name: &str, mut input: Value, requested: Option<Duration>) {
    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry.snapshot([name]).unwrap();
    if let Some(requested) = requested {
        input["_nac"] = json!({"timeout_ms":requested.as_millis() as u64});
    }
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    assert!(
        snapshot.prepare(name, input.clone(), services).is_ok(),
        "{input}"
    );
    if requested.is_none() {
        input["_nac"] = Value::Null;
        assert!(snapshot.prepare(name, input, services).is_ok());
    }
}

fn value(result: ToolResult) -> Value {
    assert!(!result.is_error, "{}", result.content);
    serde_json::from_str(result.content.as_text().unwrap()).unwrap()
}

#[test]
fn defaults_and_every_equal_alias_combination_are_delegated() {
    for tty in [false, true] {
        let mut input = json!({"cmd":"printf ok","tty":tty});
        let timeout = ExecCommandTool.timeout(&mut input, None).unwrap();
        assert_eq!(timeout.duration.as_millis(), if tty { 500 } else { 30_000 });
        assert_eq!(
            timeout.disposition,
            kernel::ToolTimeoutDisposition::Delegated
        );
        ExecCommandTool.decode(input).unwrap();
    }
    let mut input = json!({"session_id":"original"});
    assert_eq!(
        WriteStdinTool
            .timeout(&mut input, None)
            .unwrap()
            .duration
            .as_millis(),
        500
    );
    for ms in [0, 1, 1000, 3_600_000] {
        for mask in 1..8 {
            if ms == 0 && mask & 4 != 0 {
                continue;
            }
            let mut input = json!({"cmd":"printf ok"});
            if mask & 1 != 0 {
                input["timeout_ms"] = json!(ms);
            }
            if mask & 2 != 0 {
                input["yield_time_ms"] = json!(ms);
            }
            let requested = (mask & 4 != 0).then(|| Duration::from_millis(ms));
            assert_prepares("exec_command", input.clone(), requested);
            let timeout = ExecCommandTool.timeout(&mut input, requested).unwrap();
            assert_eq!(timeout.duration.as_millis(), u128::from(ms));
            assert_eq!(input["yield_time_ms"], ms);
            ExecCommandTool.decode(input).unwrap();
        }
        for mask in 1..4 {
            if ms == 0 && mask & 2 != 0 {
                continue;
            }
            let requested = (mask & 2 != 0).then(|| Duration::from_millis(ms));
            let mut input = json!({"cmd":"printf ok","tty":true});
            if mask & 1 != 0 {
                input["yield_time_ms"] = json!(ms);
            }
            assert_prepares("exec_command", input.clone(), requested);
            assert_eq!(
                ExecCommandTool
                    .timeout(&mut input, requested)
                    .unwrap()
                    .duration
                    .as_millis(),
                u128::from(ms)
            );
            ExecCommandTool.decode(input).unwrap();
            let mut input = json!({"session_id":"original"});
            if mask & 1 != 0 {
                input["yield_time_ms"] = json!(ms);
            }
            assert_prepares("write_stdin", input.clone(), requested);
            assert_eq!(
                WriteStdinTool
                    .timeout(&mut input, requested)
                    .unwrap()
                    .duration
                    .as_millis(),
                u128::from(ms)
            );
            assert!(WriteStdinTool.decode(input).is_ok());
        }
    }
}

#[test]
fn preparation_rejects_invalid_values_and_conflicts() {
    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry.snapshot(["exec_command", "write_stdin"]).unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    for invalid in [
        Value::Null,
        json!(-1),
        json!(1.5),
        json!("1000"),
        json!(true),
        json!([]),
        json!({}),
        json!(3_600_001u64),
    ] {
        for (tool, field, mut input) in [
            ("exec_command", "timeout_ms", json!({"cmd":"printf never"})),
            (
                "exec_command",
                "yield_time_ms",
                json!({"cmd":"printf never"}),
            ),
            (
                "exec_command",
                "yield_time_ms",
                json!({"cmd":"printf never","tty":true}),
            ),
            (
                "write_stdin",
                "yield_time_ms",
                json!({"session_id":"original"}),
            ),
        ] {
            input[field] = invalid.clone();
            assert!(
                snapshot.prepare(tool, input.clone(), services).is_err(),
                "accepted {input}"
            );
            input["_nac"] = json!({"timeout_ms":1000});
            assert!(
                snapshot.prepare(tool, input.clone(), services).is_err(),
                "masked {input}"
            );
        }
        for (tool, mut input) in [
            ("exec_command", json!({"cmd":"printf never"})),
            ("exec_command", json!({"cmd":"printf never","tty":true})),
            ("write_stdin", json!({"session_id":"original"})),
        ] {
            input["_nac"] = json!({"timeout_ms":invalid});
            assert!(snapshot.prepare(tool, input, services).is_err());
        }
    }
    for input in [
        json!({"cmd":"printf never","timeout_ms":10,"yield_time_ms":20}),
        json!({"cmd":"printf never","timeout_ms":10,"_nac":{"timeout_ms":20}}),
        json!({"cmd":"printf never","yield_time_ms":10,"_nac":{"timeout_ms":20}}),
        json!({"cmd":"printf never","timeout_ms":10,"yield_time_ms":10,"_nac":{"timeout_ms":20}}),
        json!({"cmd":"printf never","tty":true,"yield_time_ms":10,"_nac":{"timeout_ms":20}}),
    ] {
        let error = snapshot
            .prepare("exec_command", input, services)
            .err()
            .unwrap();
        assert!(error.content.contains("conflict"));
    }
    for input in [
        json!({"session_id":"original","yield_time_ms":10,"_nac":{"timeout_ms":20}}),
        json!({"session_id":"original","timeout_ms":10}),
        json!({"session_id":"original","_nac":{"timeout_ms":0}}),
    ] {
        assert!(snapshot.prepare("write_stdin", input, services).is_err());
    }
    for timeout in [Value::Null, json!(0), json!(1000)] {
        let error = snapshot
            .prepare(
                "exec_command",
                json!({"cmd":"printf never","tty":true,"timeout_ms":timeout}),
                services,
            )
            .err()
            .unwrap();
        assert!(error.content.contains("only valid for non-PTY"));
        assert!(error.content.contains("yield_time_ms"));
    }
}

#[test]
fn timing_schemas_are_bounded_integers_not_nullable() {
    let registry = registry();
    for definition in registry
        .snapshot(["exec_command", "write_stdin"])
        .unwrap()
        .definitions()
    {
        let properties = &definition.function.parameters["properties"];
        assert_eq!(properties["yield_time_ms"]["type"], "integer");
        assert_eq!(properties["yield_time_ms"]["minimum"], 0);
        assert_eq!(properties["yield_time_ms"]["maximum"], 3_600_000);
        assert_eq!(properties["_nac"]["properties"]["timeout_ms"]["minimum"], 1);
        if definition.function.name == "exec_command" {
            assert_eq!(properties["timeout_ms"]["type"], "integer");
            assert_eq!(properties["timeout_ms"]["minimum"], 0);
            assert_eq!(properties["timeout_ms"]["maximum"], 3_600_000);
        }
    }
}

#[tokio::test]
async fn conflict_is_rejected_before_marker_spawn() {
    let root = TempRoot::new();
    let mut runtime = crate::tools::test_runtime();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry.snapshot(["exec_command"]).unwrap();
    let result = snapshot
        .invoke(
            "exec_command",
            json!({"cmd":"touch must-not-spawn","timeout_ms":1000,"yield_time_ms":2000}),
            kernel::ToolServices {
                runtime: &runtime,
                client: &client,
            },
            &kernel::ToolCallContext::default(),
        )
        .await;
    assert!(result.is_error);
    assert!(result.content.contains("conflict"));
    assert!(!root.path().join("must-not-spawn").exists());
    assert!(runtime.terminal_manager.live_terminal_names().is_empty());
}

#[tokio::test]
async fn completion_and_zero_deadline_preserve_defaults_and_short_budgets() {
    let runtime = crate::tools::test_runtime();
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry.snapshot(["exec_command"]).unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    for input in [
        json!({"cmd":"printf ordinary"}),
        json!({"cmd":"printf ordinary","timeout_ms":2000,"yield_time_ms":2000,"_nac":{"timeout_ms":2000}}),
    ] {
        let expected = input
            .get("timeout_ms")
            .and_then(Value::as_u64)
            .unwrap_or(30_000);
        let output = value(
            snapshot
                .prepare("exec_command", input, services)
                .unwrap()
                .invoke(services, &kernel::ToolCallContext::default())
                .await,
        );
        assert_eq!(output["status"], "completed");
        assert_eq!(output["timeout_ms"], expected);
        assert_eq!(output["stdout_preview"], "ordinary");
        assert!(output.get("termination_status").is_none());
    }
    for field in ["timeout_ms", "yield_time_ms"] {
        let mut input = json!({"cmd":"sleep 30"});
        input[field] = json!(0);
        let output = value(
            snapshot
                .prepare("exec_command", input, services)
                .unwrap()
                .invoke(services, &kernel::ToolCallContext::default())
                .await,
        );
        assert_eq!(output["status"], "timed_out");
        assert_eq!(output["timeout_ms"], 0);
        assert_eq!(output["termination_status"], "terminated");
    }
}

#[tokio::test]
async fn chain_deadline_preserves_partial_output_and_prevents_later_step() {
    let root = TempRoot::new();
    let mut runtime = crate::tools::test_runtime();
    runtime.command_environment = Some(std::sync::Arc::new(Environment));
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry
        .snapshot(["exec_command", "read_command_output"])
        .unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let output = value(snapshot.prepare("exec_command", json!({"cmd":"printf 'before:deadline-secret-canary'; printf 'partial-error:deadline-secret-canary' >&2; sleep 0.5 && touch delayed-marker; printf later","timeout_ms":100}), services).unwrap().invoke(services, &kernel::ToolCallContext::default()).await);
    assert_eq!(output["status"], "timed_out");
    assert_eq!(output["timeout_ms"], 100);
    assert_eq!(output["termination_status"], "terminated");
    assert_eq!(output["stdout_preview"], "before:[REDACTED]");
    assert_eq!(output["stderr_preview"], "partial-error:[REDACTED]");
    let page = value(
        snapshot
            .prepare(
                "read_command_output",
                json!({"output_id":output["output_id"],"stream":"stdout"}),
                services,
            )
            .unwrap()
            .invoke(services, &kernel::ToolCallContext::default())
            .await,
    );
    assert_eq!(page["content"], "before:[REDACTED]");
    tokio::time::sleep(Duration::from_millis(600)).await;
    assert!(!root.path().join("delayed-marker").exists());
}

#[tokio::test]
async fn pty_poll_allows_original_process_to_finish_and_retention_is_unchanged() {
    let root = TempRoot::new();
    let mut runtime = crate::tools::test_runtime();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry.snapshot(["exec_command", "write_stdin"]).unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let started = value(snapshot.prepare("exec_command", json!({"cmd":"while [ ! -f release ]; do sleep 0.01; done; printf original-finished","tty":true,"yield_time_ms":10,"_nac":{"timeout_ms":10}}), services).unwrap().invoke(services, &kernel::ToolCallContext::default()).await);
    let handle = started["session_name"].as_str().unwrap();
    let retained = value(
        snapshot
            .prepare(
                "write_stdin",
                json!({"session_id":handle,"chars":"","retain":true,"yield_time_ms":0}),
                services,
            )
            .unwrap()
            .invoke(services, &kernel::ToolCallContext::default())
            .await,
    );
    assert_eq!(retained["retained"], true);
    std::fs::write(root.path().join("release"), b"finish original process").unwrap();
    let finished = value(snapshot.prepare("write_stdin", json!({"session_id":handle,"chars":"","yield_time_ms":2000,"_nac":{"timeout_ms":2000}}), services).unwrap().invoke(services, &kernel::ToolCallContext::default()).await);
    assert_eq!(finished["output_id"], started["output_id"]);
    assert_eq!(finished["content_preview"], "original-finished");
    assert!(finished["session_name"].is_null());
    assert_eq!(finished["exit_code"], 0);
    runtime.terminal_manager.remove_all().await.unwrap();
}

#[tokio::test]
async fn default_pty_poll_leaves_original_process_alive() {
    let root = TempRoot::new();
    let mut runtime = crate::tools::test_runtime();
    runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
    let client = crate::model::ModelClient::new_for_test();
    let registry = registry();
    let snapshot = registry.snapshot(["exec_command", "write_stdin"]).unwrap();
    let services = kernel::ToolServices {
        runtime: &runtime,
        client: &client,
    };
    let started = value(
        snapshot
            .prepare(
                "exec_command",
                json!({"cmd":"while [ ! -f release ]; do sleep 0.01; done; printf default-poll-finished","tty":true}),
                services,
            )
            .unwrap()
            .invoke(services, &kernel::ToolCallContext::default())
            .await,
    );
    let handle = started["session_name"]
        .as_str()
        .expect("default poll must not terminate the original process");
    std::fs::write(root.path().join("release"), b"finish original process").unwrap();
    let finished = value(
        snapshot
            .prepare(
                "write_stdin",
                json!({"session_id":handle,"yield_time_ms":3000}),
                services,
            )
            .unwrap()
            .invoke(services, &kernel::ToolCallContext::default())
            .await,
    );
    assert_eq!(finished["output_id"], started["output_id"]);
    assert_eq!(finished["content_preview"], "default-poll-finished");
    assert_eq!(finished["exit_code"], 0);
}

#[cfg(unix)]
#[tokio::test]
async fn deadline_and_cancellation_terminate_descendants() {
    for cancel in [false, true] {
        let root = TempRoot::new();
        let mut runtime = crate::tools::test_runtime();
        runtime.backend = crate::sandbox::execution_backend_from_sandbox(None, root.path());
        let client = crate::model::ModelClient::new_for_test();
        let registry = registry();
        let snapshot = registry.snapshot(["exec_command"]).unwrap();
        let services = kernel::ToolServices {
            runtime: &runtime,
            client: &client,
        };
        let context = kernel::ToolCallContext::default();
        let call = snapshot.prepare("exec_command", json!({"cmd":"sleep 30 & printf '%s' $! > child-pid; printf ready; wait","timeout_ms":if cancel {5000} else {500}}), services).unwrap();
        let cancel_when_ready = async {
            if cancel {
                tokio::time::timeout(Duration::from_secs(3), async {
                    while !root.path().join("child-pid").exists() {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                })
                .await
                .unwrap();
                runtime.command_cancellation.cancel();
            }
        };
        let (result, ()) = tokio::join!(call.invoke(services, &context), cancel_when_ready);
        let output = value(result);
        assert_eq!(
            output["status"],
            if cancel { "cancelled" } else { "timed_out" }
        );
        assert_eq!(output["termination_status"], "terminated");
        let pid: libc::pid_t = std::fs::read_to_string(root.path().join("child-pid"))
            .unwrap()
            .parse()
            .unwrap();
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } != 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert_ne!(
            unsafe { libc::kill(pid, 0) },
            0,
            "descendant survived {output}"
        );
    }
}
