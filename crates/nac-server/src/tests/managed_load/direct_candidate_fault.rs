//! Private child-read fault exercised by a separately built candidate process.
use super::direct_acceptance::{init_workspace, prepare_artifact};
use super::direct_candidate::{candidate_probes, request};
use super::direct_model::DirectModel;
use super::*;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

struct FaultDirectory(PathBuf);
impl Drop for FaultDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn start_candidate(
    binary: &Path,
    root: &Path,
    home: &Path,
    fault: &Path,
) -> (
    tokio::process::Child,
    nac_process::ProcessTreeGuard,
    std::net::SocketAddr,
) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let stderr = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .mode(0o600)
        .open(home.join("private-candidate.stderr"))
        .unwrap();
    let mut command = tokio::process::Command::new(binary);
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", home)
        .env("NAC_HOME", home)
        .env("OPENAI_API_KEY", "all612-direct-fixture-key")
        .env("HTTPS_PROXY", "http://127.0.0.1:1")
        .env("HTTP_PROXY", "http://127.0.0.1:1")
        .env("NO_PROXY", "127.0.0.1,localhost")
        .env("NAC_MANAGED_FAULT_ROOT", fault)
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
        .stderr(std::process::Stdio::from(stderr));
    let (mut process, guard) =
        nac_process::ProcessTreeGuard::spawn_supervised(&mut command).unwrap();
    tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            if tokio::net::TcpStream::connect(address).await.is_ok() {
                break;
            }
            assert!(
                process.try_wait().unwrap().is_none(),
                "private candidate exited before listening"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("private candidate startup deadline");
    (process, guard, address)
}

async fn stop_candidate(
    process: &mut tokio::process::Child,
    guard: &mut nac_process::ProcessTreeGuard,
) {
    guard.terminate(process).await.unwrap();
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "requires a separately built private fault candidate"]
async fn private_candidate_child_read_fault_reconciles_once() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let binary = PathBuf::from(
        std::env::var_os("NAC_PRIVATE_FAULT_BINARY").expect("separately built private candidate"),
    );
    assert!(binary.is_file());
    let artifact = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/direct-load/private-candidate-child-read.json");
    prepare_artifact(&artifact);
    let root = temp_root("direct_private_candidate");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("all612-direct-fixture-key"));
    init_workspace(&root);
    let fault = PathBuf::from(format!("/tmp/all117-fault-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&fault).unwrap();
    std::fs::set_permissions(&fault, std::fs::Permissions::from_mode(0o700)).unwrap();
    let _fault_directory = FaultDirectory(fault.clone());
    let model = DirectModel::start(DEFAULT_SEED, 1, false, None, false);
    let parent = "all612-private-candidate";
    seed_direct_session_with_base_url(&root, parent, model.base_url.clone());
    let (mut process, mut guard, address) = start_candidate(&binary, &root, &home, &fault).await;
    let original_pid = process.id().unwrap();
    let mut probes = candidate_probes(address, "private-candidate-startup").await;
    let body = serde_json::json!({"prompt":format!("ALL612:PRIMARY:{DEFAULT_SEED:08x}:0: launch the scripted child")}).to_string();
    assert_eq!(
        request(address, "POST", &format!("/sessions/{parent}/runs"), &body)
            .await
            .0,
        202
    );
    model.wait_for_primaries().await;
    model.primary_gate.release();
    model.wait_for_children().await;
    probes.extend(candidate_probes(address, "child-before-fault").await);
    let store = root.join("store.db");
    let path = store.clone();
    let child = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_traditional_children(&path, parent)
            .unwrap()
            .pop()
            .unwrap()
    })
    .await
    .unwrap();
    let nonce = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let control = serde_json::json!({"nonce":nonce,"boundary":"child-read","session_id":child.child_session_id,"run_id":child.run_id,"generation":child.generation,"expires_unix_ms":now+20_000});
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(fault.join("child-read.json"))
        .unwrap();
    file.write_all(control.to_string().as_bytes()).unwrap();
    drop(file);
    model.child_gate.release();
    assert_eq!(model.wait_for_concurrent_completions().await, 1);
    model.concurrent_completions.release();
    let receipt_path = fault.join(format!("used-{nonce}.json"));
    let reached: serde_json::Value = tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            if let Ok(bytes) = std::fs::read(&receipt_path) {
                if let Ok(receipt) = serde_json::from_slice(&bytes) {
                    break receipt;
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("private candidate did not reach child-read boundary");
    assert_eq!(reached["nonce"], nonce);
    assert_eq!(reached["boundary"], "child-read");
    assert_eq!(reached["session_id"], child.child_session_id);
    assert_eq!(reached["run_id"], child.run_id.as_deref().unwrap());
    assert_eq!(reached["generation"], child.generation);
    assert_eq!(reached["process_id"], original_pid);
    assert_eq!(reached["after_successful_sqlite_commit"], false);
    let stderr_path = home.join("private-candidate.stderr");
    tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            if std::fs::read_to_string(&stderr_path)
                .unwrap_or_default()
                .contains("nac: private fixture injected traditional child settlement read failure")
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("private candidate did not return the injected child-read failure");
    let path = store.clone();
    let child_id = child.child_session_id.clone();
    let generation = child.generation;
    nac_core::store::spawn_blocking_store_caller(move || {
        let current = nac_core::store::load_traditional_child(&path, &child_id)
            .unwrap()
            .unwrap();
        assert_eq!(current.generation, generation);
        assert_eq!(
            current.status,
            nac_core::store::TraditionalChildStatus::Running
        );
        assert!(nac_core::store::list_session_inbox(&path, parent)
            .unwrap()
            .is_empty());
    })
    .await
    .unwrap();
    stop_candidate(&mut process, &mut guard).await;
    let (mut rebuilt, mut rebuilt_guard, address) =
        start_candidate(&binary, &root, &home, &fault).await;
    probes.extend(candidate_probes(address, "reconstructed").await);
    assert_eq!(
        request(
            address,
            "GET",
            &format!("/sessions/{}", child.child_session_id),
            ""
        )
        .await
        .0,
        200
    );
    assert_eq!(
        request(address, "GET", &format!("/sessions/{parent}"), "")
            .await
            .0,
        200
    );
    tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            probes.extend(candidate_probes(address, "reconciliation").await);
            let path = store.clone();
            let delivered = nac_core::store::spawn_blocking_store_caller(move || {
                let inbox = nac_core::store::list_session_inbox(&path, parent).unwrap();
                inbox.len() == 1
                    && inbox[0].status == nac_core::store::InboxStatus::Delivered
                    && nac_core::store::load_run_recovery(&path, parent)
                        .unwrap()
                        .is_none()
            })
            .await
            .unwrap();
            if delivered {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("private candidate did not deliver recovered child");
    let requests = model.finish();
    stop_candidate(&mut rebuilt, &mut rebuilt_guard).await;
    assert_eq!(std::fs::read_dir(&fault).unwrap().count(), 2);
    let path = store.clone();
    let child_id = child.child_session_id.clone();
    let generation = child.generation;
    let evidence_child_id = child_id.clone();
    let evidence_run_id = child.run_id.clone();
    nac_core::store::spawn_blocking_store_caller(move || {
        let receipt =
            nac_core::store::load_traditional_child_terminal_receipt(&path, &child_id, generation)
                .unwrap()
                .unwrap();
        assert_eq!(receipt.run_id, child.run_id);
        assert_eq!(
            receipt.status,
            nac_core::store::TraditionalChildStatus::Completed
        );
        let current = nac_core::store::load_traditional_child(&path, &child_id)
            .unwrap()
            .unwrap();
        assert_eq!(current.generation, generation);
        assert_eq!(
            current.status,
            nac_core::store::TraditionalChildStatus::Completed
        );
        let inbox = nac_core::store::list_session_inbox(&path, parent).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
        assert!(nac_core::store::load_run_recovery(&path, &child_id)
            .unwrap()
            .is_none());
        let writer = nac_core::store::TranscriptLogWriter::new(&path).unwrap();
        let parent_log = writer.read_from(parent, 0).unwrap();
        let child_log = writer.read_from(&child_id, 0).unwrap();
        for transcript in [&parent_log, &child_log] {
            for pair in transcript.windows(2) {
                assert_eq!(pair[1].0, pair[0].0 + 1);
            }
        }
        let parent_prompt = format!("ALL612:PRIMARY:{DEFAULT_SEED:08x}:0");
        let child_prompt = format!("ALL612:CHILD:{DEFAULT_SEED:08x}:0");
        assert_eq!(parent_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&parent_prompt))).count(), 1);
        assert_eq!(child_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&child_prompt))).count(), 1);
        assert_eq!(child_log.iter().filter(|(_, message)| matches!(message, Message::Tool { content, .. } if content.as_text().is_some_and(|text| text.contains("ALL612_NATIVE_COMMAND_COMPLETE")))).count(), 1);
        assert_eq!(parent_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains("ALL612_CHILD_COMPLETE"))).count(), 1);
    })
    .await
    .unwrap();
    SqliteLoadStore.assert_integrity(&store);
    let identity = build_identity::current();
    let evidence = serde_json::json!({"schema_version":2,"topology":"direct_sessions_with_traditional_children","mode":"private_candidate_child_read","phase":"child-read","seed":DEFAULT_SEED,"outcome":"reconciled","source_revision":identity.source_revision,"build_id":identity.build_id,"nonce":nonce,"child_session_id":evidence_child_id,"run_id":evidence_run_id,"generation":generation,"fault_process_id":original_pid,"fault_observed":true,"pre_restart_child_status":"running","pre_restart_inbox_items":0,"terminal_receipts":1,"parent_inbox_items":1,"recovery_obligations":0,"owned_process_cleanup":"verified","probes":probes,"model_requests":requests});
    std::fs::remove_dir_all(root).unwrap();
    write_secret_safe_artifact(&artifact, &evidence);
}
