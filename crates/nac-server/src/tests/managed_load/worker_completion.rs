//! Worker commit/ack evidence shared by the real managed-load lane. Keep the
//! backend experiment adapter in the parent fixture unchanged.
use super::*;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};

pub(super) fn assert_receipt(path: &Path, entry: &PlannedOrchestrator, healthy: bool) -> usize {
    let episodes =
        nac_core::store::thread_read(path, &entry.session_id, &entry.worker_thread).unwrap();
    assert!(episodes.len() <= 1);
    let connection = rusqlite::Connection::open(path).unwrap();
    let rows: Vec<(String, Option<i64>)> = connection.prepare(
        "SELECT status, episode_id FROM worker_dispatches WHERE session_id = ?1 AND thread_name = ?2"
    ).unwrap().query_map(rusqlite::params![entry.session_id, entry.worker_thread], |row| Ok((row.get(0)?, row.get(1)?))).unwrap()
        .collect::<rusqlite::Result<_>>().unwrap();
    assert_eq!(rows.len(), 1, "one host admission per real worker");
    assert_ne!(
        rows[0].0, "pending",
        "no abandoned dispatch after settlement"
    );
    if healthy {
        assert_eq!(episodes.len(), 1);
        assert_eq!(rows[0], ("ok".into(), Some(episodes[0].id)));
    }
    episodes.len()
}

pub(super) async fn exercise_worker_ack_boundaries(worker: &Path) {
    for outcome in [
        "large_answer",
        "pipe_closed",
        "wrong_ack",
        "cancel",
        "worker_crash",
        "prefix_answer",
    ] {
        let root = temp_root(&format!("all113_ack_{outcome}"));
        let nac_home = root.join("nac-home");
        std::fs::create_dir_all(&nac_home).unwrap();
        let _env = ScopedModelEnv::isolated(&nac_home, Some("all113-fake-model-key"));
        let answer = match outcome {
            "large_answer" => "worker answer ".repeat(16 * 1024),
            "prefix_answer" => "__NAC_COMPLETION_V1__hello".to_string(),
            _ => "worker answer".to_string(),
        };
        let (base_url, requests) = scripted_direct_responses(&[&answer]);
        seed_load_parent(&root, base_url.clone());
        let path = root.join("store.db");
        let mut child = tokio::process::Command::new(worker)
            .args([
                "__worker",
                "--session-id",
                "all112-parent",
                "--thread-name",
                "worker",
                "--dispatch-id",
                "ack-boundary",
                "--action",
                "answer",
                "--api-model",
                "model-a",
                "--backend",
                "openai-responses",
                "--allow-insecure-http",
                "--extra-headers",
                "{}",
            ])
            .arg("--api-base-url")
            .arg(base_url)
            .arg("--store-path")
            .arg(&path)
            .arg("--workspace-cwd")
            .arg(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        // A worker emits events before its stdout completion. Drain stderr
        // concurrently so a full pipe cannot block that completion frame.
        let mut stderr = child.stderr.take().unwrap();
        let stderr_task = tokio::spawn(async move {
            let mut output = String::new();
            stderr.read_to_string(&mut output).await.unwrap();
            output
        });
        let mut stdout = BufReader::new(child.stdout.take().unwrap());
        let mut line = String::new();
        tokio::time::timeout(PHASE_TIMEOUT, stdout.read_line(&mut line))
            .await
            .unwrap()
            .unwrap();
        let payload = line
            .trim_end()
            .strip_prefix("__NAC_COMPLETION_V1__")
            .expect("structured completion frame");
        let frame: serde_json::Value = serde_json::from_str(payload).unwrap();
        assert_eq!(frame["dispatch_id"], "ack-boundary");
        assert_eq!(frame["content"], answer);
        assert_eq!(requests.recv_timeout(PHASE_TIMEOUT).unwrap(), 0);
        assert!(
            child.try_wait().unwrap().is_none(),
            "no worker exit success before host ack"
        );
        assert!(
            nac_core::store::thread_dispatches(&path, "all112-parent", "worker")
                .unwrap()
                .is_empty(),
            "worker cannot append its completion episode"
        );
        #[cfg(target_os = "linux")]
        for descriptor in std::fs::read_dir(format!("/proc/{}/fd", child.id().unwrap())).unwrap() {
            if let Ok(target) = std::fs::read_link(descriptor.unwrap().path()) {
                assert!(
                    !target.to_string_lossy().contains("store.db"),
                    "worker holds no store descriptor at completion/ack boundary"
                );
            }
        }
        match outcome {
            "prefix_answer" | "large_answer" => child.stdin.as_mut().unwrap().write_all(b"__NAC_COMMIT_ACK_V1__{\"session_id\":\"all112-parent\",\"thread_name\":\"worker\",\"dispatch_id\":\"ack-boundary\",\"episode_id\":1}\n").await.unwrap(),
            "wrong_ack" => child.stdin.as_mut().unwrap().write_all(b"__NAC_COMMIT_ACK_V1__{\"session_id\":\"wrong\",\"thread_name\":\"worker\",\"dispatch_id\":\"ack-boundary\",\"episode_id\":1}\n").await.unwrap(),
            "cancel" => child.stdin.as_mut().unwrap().write_all(b"cancel\n").await.unwrap(),
            "worker_crash" => child.start_kill().unwrap(),
            _ => { child.stdin.take(); },
        }
        let status = tokio::time::timeout(PHASE_TIMEOUT, child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(
            status.success() == matches!(outcome, "prefix_answer" | "large_answer"),
            "{outcome}: unacknowledged worker must fail"
        );
        let stderr = tokio::time::timeout(PHASE_TIMEOUT, stderr_task)
            .await
            .unwrap()
            .unwrap();
        assert!(
            stderr.contains("\"type\":\"run_finished\"")
                == matches!(outcome, "prefix_answer" | "large_answer"),
            "no terminal success event before acknowledgement"
        );
        let mut remaining_stdout = String::new();
        stdout.read_to_string(&mut remaining_stdout).await.unwrap();
        assert!(
            remaining_stdout.is_empty(),
            "answer text cannot be echoed onto the protocol pipe"
        );
        assert!(
            nac_core::store::thread_dispatches(&path, "all112-parent", "worker")
                .unwrap()
                .is_empty()
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
