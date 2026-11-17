//! Exercise the built candidate server over loopback with real traditional children.
use super::direct_acceptance::{init_workspace, prepare_artifact};
use super::direct_model::DirectModel;
use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub(super) async fn request(
    address: std::net::SocketAddr,
    method: &str,
    path: &str,
    body: &str,
) -> (u16, String) {
    tokio::time::timeout(PHASE_TIMEOUT, async {
        let mut stream = tokio::net::TcpStream::connect(address).await.unwrap();
        let request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
        stream.write_all(request.as_bytes()).await.unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.unwrap();
        let response = String::from_utf8(response).unwrap();
        let (head, body) = response.split_once("\r\n\r\n").unwrap();
        let status = head.lines().next().unwrap().split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, body.to_string())
    }).await.expect("candidate HTTP request timed out")
}

pub(super) async fn candidate_probes(
    address: std::net::SocketAddr,
    phase: &'static str,
) -> Vec<serde_json::Value> {
    let mut probes = Vec::new();
    for path in ["/healthz", "/readyz"] {
        let started = Instant::now();
        let (status, body) =
            tokio::time::timeout(PROBE_SETTLEMENT_TIMEOUT, request(address, "GET", path, ""))
                .await
                .unwrap_or_else(|_| {
                    panic!("candidate {path} exceeded the probe budget during {phase}")
                });
        assert_eq!(status, 200, "candidate {path} failed during {phase}");
        if path == "/readyz" {
            let readiness: serde_json::Value = serde_json::from_str(&body).unwrap();
            assert_eq!(
                readiness["source_revision"],
                build_identity::current().source_revision
            );
            assert_eq!(readiness["build_id"], build_identity::current().build_id);
        }
        probes.push(serde_json::json!({"phase":phase, "route":path, "status":status,
            "latency_us":started.elapsed().as_micros(),
            "observed_unix_ms":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()}));
    }
    probes
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded built-candidate direct session workload"]
async fn direct_candidate_load_scenario() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let binary = PathBuf::from(
        std::env::var_os("NAC_MANAGED_LOAD_WORKER").expect("built candidate executable"),
    );
    assert!(binary.is_file());
    for count in VARIANTS {
        let artifact = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/direct-load")
            .join(format!(
                "candidate-seed-{DEFAULT_SEED}-primaries-{count}.json"
            ));
        prepare_artifact(&artifact);
        let root = temp_root(&format!("direct_candidate_{count}"));
        let home = root.join("nac-home");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("config.toml"),
            "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
        )
        .unwrap();
        let _env = ScopedModelEnv::isolated(&home, Some("all612-direct-fixture-key"));
        init_workspace(&root);
        let model = DirectModel::start(DEFAULT_SEED, count, false, None, false);
        let ids: Vec<_> = (0..count)
            .map(|ordinal| format!("all612-candidate-{count}-{ordinal}"))
            .collect();
        for id in &ids {
            seed_direct_session_with_base_url(&root, id, model.base_url.clone());
        }
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let mut command = tokio::process::Command::new(&binary);
        command
            .env_clear()
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
            .env("HOME", &home)
            .env("NAC_HOME", &home)
            .env("OPENAI_API_KEY", "all612-direct-fixture-key")
            .env("HTTPS_PROXY", "http://127.0.0.1:1")
            .env("HTTP_PROXY", "http://127.0.0.1:1")
            .env("NO_PROXY", "127.0.0.1,localhost")
            .args([
                "--bind",
                &address.to_string(),
                "--directory",
                root.to_str().unwrap(),
                "--store-path",
                root.join("store.db").to_str().unwrap(),
                "--no-open",
                "--yes",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let (mut process, mut guard) =
            nac_process::ProcessTreeGuard::spawn_supervised(&mut command).unwrap();
        let candidate_pid = process.id().unwrap();
        tokio::time::timeout(PHASE_TIMEOUT, async {
            loop {
                if let Ok(mut stream) = tokio::net::TcpStream::connect(address).await {
                    let _ = stream.shutdown().await;
                    break;
                }
                assert!(
                    process.try_wait().unwrap().is_none(),
                    "candidate exited before listening"
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("candidate startup deadline");
        let mut probes = candidate_probes(address, "startup").await;
        for (ordinal, id) in ids.iter().enumerate() {
            let body = serde_json::json!({"prompt": format!("ALL612:PRIMARY:{DEFAULT_SEED:08x}:{ordinal}: launch the scripted child")}).to_string();
            assert_eq!(
                request(address, "POST", &format!("/sessions/{id}/runs"), &body)
                    .await
                    .0,
                202
            );
        }
        model.wait_for_primaries().await;
        probes.extend(candidate_probes(address, "primary-blocked").await);
        model.primary_gate.release();
        model.wait_for_children().await;
        assert_eq!(model.observed_overlap(), (count, count));
        probes.extend(candidate_probes(address, "child-blocked").await);
        model.child_gate.release();
        assert_eq!(model.wait_for_concurrent_completions().await, count);
        probes.extend(candidate_probes(address, "completion-blocked").await);
        model.concurrent_completions.release();
        let store = root.join("store.db");
        tokio::time::timeout(PHASE_TIMEOUT, async {
            loop {
                probes.extend(candidate_probes(address, "settlement").await);
                let path = store.clone();
                let parents = ids.clone();
                let complete = nac_core::store::spawn_blocking_store_caller(move || {
                    parents.iter().all(|id| {
                        let children =
                            nac_core::store::list_traditional_children(&path, id).unwrap();
                        let inbox = nac_core::store::list_session_inbox(&path, id).unwrap();
                        children.len() == 1
                            && children[0].status
                                == nac_core::store::TraditionalChildStatus::Completed
                            && inbox.len() == 1
                            && inbox[0].status == nac_core::store::InboxStatus::Delivered
                            && nac_core::store::load_run_recovery(&path, id)
                                .unwrap()
                                .is_none()
                    })
                })
                .await
                .unwrap();
                if complete {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("candidate child settlement deadline");
        let requests = model.finish();
        guard.terminate(&mut process).await.unwrap();
        let _ = process.wait().await;
        guard.mark_leader_reaped();
        guard.finish_checked().await.unwrap();
        SqliteLoadStore.assert_integrity(&store);
        let path = store.clone();
        let parents = ids.clone();
        let receipts = nac_core::store::spawn_blocking_store_caller(move || {
            parents
                .iter()
                .enumerate()
                .map(|(ordinal, id)| {
                    let child = nac_core::store::list_traditional_children(&path, id)
                        .unwrap()
                        .pop()
                        .unwrap();
                    let receipt = nac_core::store::load_traditional_child_terminal_receipt(
                        &path,
                        &child.child_session_id,
                        child.generation,
                    )
                    .unwrap()
                    .unwrap();
                    assert_eq!(child.generation, 1);
                    assert_eq!(receipt.run_id, child.run_id);
                    assert_eq!(receipt.report.as_deref(), Some("ALL612_CHILD_COMPLETE"));
                    let inbox = nac_core::store::list_session_inbox(&path, id).unwrap();
                    assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
                    assert!(
                        nac_core::store::load_run_recovery(&path, &child.child_session_id)
                            .unwrap()
                            .is_none()
                    );
                    let writer = nac_core::store::TranscriptLogWriter::new(&path).unwrap();
                    let parent_log = writer.read_from(id, 0).unwrap();
                    let log = writer.read_from(&child.child_session_id, 0).unwrap();
                    for transcript in [&parent_log, &log] {
                        for pair in transcript.windows(2) {
                            assert_eq!(pair[1].0, pair[0].0 + 1);
                        }
                    }
                    let primary = format!("ALL612:PRIMARY:{DEFAULT_SEED:08x}:{ordinal}");
                    let prompt = format!("ALL612:CHILD:{DEFAULT_SEED:08x}:{ordinal}");
                    assert_eq!(parent_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&primary))).count(), 1);
                    assert_eq!(parent_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains("ALL612_CHILD_COMPLETE"))).count(), 1);
                    assert_eq!(log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&prompt))).count(), 1);
                    assert_eq!(log.iter().filter(|(_, message)| matches!(message, Message::Tool { content, .. } if content.as_text().is_some_and(|text| text.contains("ALL612_NATIVE_COMMAND_COMPLETE")))).count(), 1);
                    1usize
                })
                .sum::<usize>()
        })
        .await
        .unwrap();
        assert_eq!(receipts, count);
        let identity = build_identity::current();
        let evidence = serde_json::json!({"schema_version":2,"topology":"direct_sessions_with_traditional_children","mode":"built_candidate","outcome":"completed","seed":DEFAULT_SEED,"primaries":count,"source_revision":identity.source_revision,"build_id":identity.build_id,"candidate_pid":candidate_pid,"owned_process_cleanup":"verified","observed_primary_overlap":count,"observed_child_overlap":count,"observed_completion_overlap":count,"terminal_receipts":receipts,"parent_inbox_items":receipts,"recovery_obligations":0,"probes":probes,"model_requests":requests});
        std::fs::remove_dir_all(root).unwrap();
        write_secret_safe_artifact(&artifact, &evidence);
    }
}
