use super::*;
use crate::tools::test_runtime;
use crate::worker_protocol::{Completion, COMPLETION_PREFIX};
use std::io::{BufRead, Write};
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

#[test]
fn completion_process_helper() {
    let Ok(mode) = std::env::var("NAC_COMPLETION_TEST_MODE") else {
        return;
    };
    println!(); // Keep protocol frames separate from serial libtest progress.
    if mode == "exit_before_send" {
        return;
    }
    if mode == "premature_finish" {
        crate::events::EventSink::stderr_prefixed().emit(AgentEvent::RunFinished {
            thread_name: Some("worker".into()),
        });
        wait_at_boundary("timeout_before_send");
        return;
    }
    if matches!(mode.as_str(), "timeout_before_send" | "cancel_before_send") {
        wait_at_boundary(&mode);
        return;
    }
    let mut frame = Completion {
        session_id: "test-session".into(),
        thread_name: "worker".into(),
        dispatch_id: "dispatch".into(),
        content: "durable answer".into(),
    };
    if mode == "wrong_session" {
        frame.session_id = "wrong".into();
    }
    if mode == "wrong_dispatch" {
        frame.dispatch_id = "wrong".into();
    }
    if mode == "partial_send" {
        print!("{COMPLETION_PREFIX}{{\"session_id\":");
        std::io::stdout().flush().unwrap();
        std::process::exit(7);
    }
    if mode == "malformed" {
        println!("{COMPLETION_PREFIX}{{\"database_operation\":\"delete\"}}");
    } else if mode == "oversized" {
        println!(
            "{COMPLETION_PREFIX}{}",
            "x".repeat(crate::worker_protocol::MAX_COMPLETION_BYTES)
        );
    } else {
        print!("{}", frame.encode().unwrap());
    }
    std::io::stdout().flush().unwrap();
    if mode == "exit_before_ack" {
        std::process::exit(7);
    }
    let mut stdin = std::io::stdin().lock();
    let mut ack = String::new();
    stdin.read_line(&mut ack).unwrap();
    assert!(
        frame.validates_ack(ack.trim_end()),
        "worker received no valid host ack"
    );
    if matches!(mode.as_str(), "timeout_after_ack" | "cancel_after_ack") {
        wait_at_boundary(&mode);
        return;
    }
    if mode == "exit_after_ack" {
        std::process::exit(7);
    }
    if mode == "duplicate" {
        print!("{}", frame.encode().unwrap());
        std::io::stdout().flush().unwrap();
        let mut replay = String::new();
        stdin.read_line(&mut replay).unwrap();
        assert_eq!(ack, replay, "replay acknowledges the original episode");
    }
    println!("{}", frame.content);
}

fn wait_at_boundary(mode: &str) {
    if mode.starts_with("cancel") {
        crate::events::EventSink::stderr_prefixed().emit(AgentEvent::ModelError {
            thread_name: Some("worker".into()),
            message: "COMPLETION_CANCEL_BARRIER".into(),
        });
    }
    let mut control = String::new();
    std::io::stdin().read_line(&mut control).unwrap();
    assert_eq!(control.trim(), "cancel");
    eprintln!("{}", crate::worker::MANAGED_WORKER_CANCEL_ACK);
    std::process::exit(7);
}

#[cfg(unix)]
fn fixture(mode: &str) -> (crate::tools::ToolRuntime, PathBuf) {
    let root = std::env::temp_dir().join(format!("nac-completion-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let executable = root.join("worker.sh");
    let shell_quote =
        |path: &std::path::Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
    std::fs::write(&executable, format!("#!/bin/sh\nNAC_COMPLETION_TEST_MODE='{mode}' exec {} --exact tools::thread::completion_tests::completion_process_helper --nocapture\n", shell_quote(&std::env::current_exe().unwrap()))).unwrap();
    std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut runtime = test_runtime();
    runtime.workspace_cwd = root.clone();
    runtime.config_cwd = root.clone();
    runtime.worker_executable = Some(executable);
    runtime.store_path = root.join("store.db");
    store::initialize(&runtime.store_path).unwrap();
    store::insert_test_session(&runtime.store_path, "test-session");
    assert!(mark_thread_active(&runtime, "worker", "dispatch"));
    (runtime, root)
}

#[cfg(unix)]
#[tokio::test]
async fn host_completion_protocol_replay_faults_and_no_premature_success() {
    for mode in [
        "valid",
        "duplicate",
        "exit_before_send",
        "partial_send",
        "premature_finish",
        "timeout_before_send",
        "timeout_after_ack",
        "cancel_before_send",
        "cancel_after_ack",
        "exit_before_ack",
        "exit_after_ack",
        "wrong_session",
        "wrong_dispatch",
        "malformed",
        "oversized",
        "commit_failure",
    ] {
        let (mut runtime, root) = fixture(mode);
        let (events_tx, mut events_rx) = tokio::sync::mpsc::unbounded_channel();
        runtime.event_sink = crate::events::EventSink::channel(events_tx);
        if mode == "commit_failure" {
            store::open_runtime_connection(&runtime.store_path).unwrap().execute_batch(
                "CREATE TRIGGER fail_completion BEFORE INSERT ON episodes WHEN NEW.status = 'ok' BEGIN SELECT RAISE(ABORT, 'injected completion failure'); END;"
            ).unwrap();
        }
        let client = ModelClient::new_for_test();
        let dispatch = execute_parsed_dispatch(
            ParsedDispatchParams {
                thread_name: "worker".into(),
                dispatch_id: "dispatch".into(),
                action: "action".into(),
                source_threads: vec![],
                scheduled_skills: vec![],
                session_id: "test-session".into(),
                // Allow process startup under workspace-test contention. This
                // fixture tests completion boundaries, not startup latency.
                timeout_secs: 5,
                weight: None,
            },
            &runtime,
            &client,
        );
        let cancel_at_barrier = async {
            if !mode.starts_with("cancel") {
                return;
            }
            while let Some(event) = events_rx.recv().await {
                if matches!(event, AgentEvent::ModelError { message, .. } if message == "COMPLETION_CANCEL_BARRIER")
                {
                    runtime
                        .active_threads
                        .cancel_and_drain(Some((&runtime.store_path, "test-session")))
                        .await
                        .unwrap();
                    return;
                }
            }
            panic!("worker did not reach cancellation barrier");
        };
        let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(20), async {
            tokio::join!(dispatch, cancel_at_barrier)
        })
        .await
        .unwrap_or_else(|_| {
            panic!("{mode}: completion fault must terminate within dispatch deadline")
        });
        assert_eq!(
            result.is_error,
            !matches!(mode, "valid" | "duplicate"),
            "{mode}: {}",
            result.content
        );
        let episodes =
            store::thread_dispatches(&runtime.store_path, "test-session", "worker").unwrap();
        assert_eq!(episodes.len(), 1, "{mode}: one terminal durable outcome");
        if matches!(
            mode,
            "valid"
                | "duplicate"
                | "exit_before_ack"
                | "exit_after_ack"
                | "timeout_after_ack"
                | "cancel_after_ack"
        ) {
            assert_eq!(episodes[0].content, "durable answer");
            assert_eq!(episodes[0].status, "ok");
        } else {
            let expected = if mode.starts_with("timeout") || mode == "premature_finish" {
                "timed_out"
            } else if mode.starts_with("cancel") {
                "cancelled"
            } else {
                "error"
            };
            assert_eq!(episodes[0].status, expected, "{mode}");
        }
        if mode == "premature_finish" {
            while let Ok(event) = events_rx.try_recv() {
                assert!(
                    !matches!(event, AgentEvent::RunFinished { .. }),
                    "host cannot forward worker success without a commit ack"
                );
            }
        }
        assert!(!runtime.active_threads.is_active("worker"));
        let _ = std::fs::remove_dir_all(root);
    }
}
