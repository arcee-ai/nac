//! Native-process cancellation and reconstruction for direct child sessions.
use super::direct_acceptance::{init_workspace, observe_blocked, prepare_artifact};
use super::direct_model::DirectModel;
use super::*;

#[derive(Serialize)]
struct CancellationEvidence {
    schema_version: u32,
    topology: &'static str,
    phase: &'static str,
    outcome: &'static str,
    seed: u64,
    build_id: &'static str,
    source_revision: &'static str,
    child_generation: u64,
    descendant_pid: u32,
    descendant_reaped: bool,
    recovery_obligations: usize,
    terminal_receipts: usize,
    parent_inbox_items: usize,
    child_prompt_occurrences: usize,
    child_tool_results: usize,
    probes: Vec<ProbeSample>,
    model_requests: Vec<ModelRequest>,
    telemetry: TelemetryEvidence,
}

#[cfg(unix)]
fn process_running(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    if std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| {
            stat.rsplit_once(") ")
                .map(|(_, fields)| fields.starts_with('Z'))
        })
        .unwrap_or(false)
    {
        return false;
    }
    // SAFETY: signal zero checks existence and never sends a signal.
    if unsafe { libc::kill(pid as libc::pid_t, 0) } == 0 {
        true
    } else {
        match std::io::Error::last_os_error().raw_os_error() {
            Some(libc::ESRCH) => false,
            Some(libc::EPERM) => true,
            other => panic!("cannot inspect fixture descendant: {other:?}"),
        }
    }
}

#[cfg(unix)]
fn sleep_descendant(root_pid: u32) -> Option<u32> {
    let output = std::process::Command::new("ps")
        .args(["-axo", "pid=,ppid=,comm="])
        .output()
        .expect("inspect fixture process ancestry");
    assert!(
        output.status.success(),
        "process ancestry inspection failed"
    );
    let listing = String::from_utf8(output.stdout).unwrap();
    let mut parents = BTreeMap::new();
    let mut candidates = Vec::new();
    for line in listing.lines() {
        let mut fields = line.split_whitespace();
        let (Some(pid), Some(parent), Some(command)) =
            (fields.next(), fields.next(), fields.next())
        else {
            continue;
        };
        let (Ok(pid), Ok(parent)) = (pid.parse::<u32>(), parent.parse::<u32>()) else {
            continue;
        };
        parents.insert(pid, parent);
        if Path::new(command)
            .file_name()
            .is_some_and(|name| name == "sleep")
        {
            candidates.push(pid);
        }
    }
    candidates.into_iter().find(|pid| {
        let mut current = *pid;
        for _ in 0..64 {
            let Some(parent) = parents.get(&current).copied() else {
                return false;
            };
            if parent == root_pid {
                return true;
            }
            if parent == current || parent == 0 {
                return false;
            }
            current = parent;
        }
        false
    })
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded direct native-process cancellation scenario"]
async fn direct_native_cancellation_and_reconstruction() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let artifact = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/direct-load/native-cancellation.json");
    prepare_artifact(&artifact);
    let root = temp_root("direct_native_cancellation");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("all612-direct-fixture-key"));
    init_workspace(&root);
    let identity = build_identity::current();
    let exporter = Arc::new(nac_core::telemetry::InMemoryExporter::default());
    let recorder = nac_core::telemetry::TelemetryRecorder::bounded(
        exporter.clone(),
        nac_core::telemetry::RuntimeMetadata::sqlite(
            identity.build_id,
            identity.source_revision,
            nac_core::store::schema_version(),
            Some("all612-host"),
            Some("all612-native-cancellation"),
        ),
        nac_core::telemetry::MAX_EXPORT_QUEUE_CAPACITY,
    );
    let _telemetry = nac_core::telemetry::install_test_recorder(recorder.clone());
    let command = "sleep 30 & wait".to_owned();
    let seed = DEFAULT_SEED;
    let model = DirectModel::start(seed, 1, true, Some(command), false);
    seed_direct_session_with_base_url(&root, "direct-fault-parent", model.base_url.clone());
    let manager = new_owned_manager(&root).await;
    let parent = manager.attach_session("direct-fault-parent").await.unwrap();
    let app = crate::delivery::server::build_router(manager.clone());
    manager
        .submit_prompt(
            "direct-fault-parent",
            SubmitPromptRequest {
                prompt: format!("ALL612:PRIMARY:{seed:08x}:0: launch the scripted child"),
            },
            nac_core::store::InputOrigin::Automation,
        )
        .await
        .unwrap();
    model.wait_for_primaries().await;
    let mut probes = probe_pair(&app, "primary-blocked").await;
    model.primary_gate.release();
    model.wait_for_children().await;
    probes.extend(probe_pair(&app, "child-model-blocked").await);
    model.child_gate.release();
    let descendant_pid = tokio::time::timeout(PHASE_TIMEOUT, async {
        'found: loop {
            probes.extend(probe_pair(&app, "native-process-blocked").await);
            for event in exporter.events() {
                if event.name == nac_core::telemetry::TelemetryName::ChildProcess
                    && event.outcome == Some(nac_core::telemetry::TelemetryOutcome::Started)
                {
                    if let Some(root_pid) = event.pid {
                        let descendant =
                            tokio::task::spawn_blocking(move || sleep_descendant(root_pid))
                                .await
                                .unwrap();
                        if let Some(pid) = descendant {
                            break 'found pid;
                        }
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("native descendant was not observed under the owned process");
    assert!(
        process_running(descendant_pid),
        "native descendant was not live before cancellation"
    );
    probes.extend(observe_blocked(&app, "native-process-blocked").await);
    let path = manager.inner.store_path.clone();
    let child = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_traditional_children(&path, "direct-fault-parent")
    })
    .await
    .unwrap()
    .unwrap()
    .pop()
    .unwrap();
    let controller =
        nac_core::traditional_children::controller_for(&manager.inner.store_path).unwrap();
    let cancelled = tokio::time::timeout(
        PHASE_TIMEOUT,
        controller.cancel(
            "direct-fault-parent",
            &child.child_session_id,
            child.generation,
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        cancelled.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(cancelled.generation, child.generation);
    tokio::time::timeout(PHASE_TIMEOUT, async {
        while process_running(descendant_pid) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned native descendant survived cancellation");
    let store = manager.inner.store_path.clone();
    tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            probes.extend(probe_pair(&app, "cancel-settlement").await);
            let path = store.clone();
            let delivered = nac_core::store::spawn_blocking_store_caller(move || {
                let inbox =
                    nac_core::store::list_session_inbox(&path, "direct-fault-parent").unwrap();
                inbox.len() == 1 && inbox[0].status == nac_core::store::InboxStatus::Delivered
            })
            .await
            .unwrap();
            if delivered && !parent.has_active_operation() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cancelled child completion was not delivered");
    let model_requests = model.finish();
    assert_eq!(
        model_requests
            .iter()
            .filter(|request| request.phase == "child")
            .count(),
        1
    );
    drop(controller);
    drop(parent);
    drop(app);
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let rebuilt = new_owned_manager(&root).await;
    let path = rebuilt.inner.store_path.clone();
    let child_id = child.child_session_id.clone();
    let generation = child.generation;
    let (receipt, current, inbox, child_recovery, parent_recovery, child_log) =
        nac_core::store::spawn_blocking_store_caller(move || {
            (
                nac_core::store::load_traditional_child_terminal_receipt(
                    &path, &child_id, generation,
                )
                .unwrap(),
                nac_core::store::load_traditional_child(&path, &child_id).unwrap(),
                nac_core::store::list_session_inbox(&path, "direct-fault-parent").unwrap(),
                nac_core::store::load_run_recovery(&path, &child_id).unwrap(),
                nac_core::store::load_run_recovery(&path, "direct-fault-parent").unwrap(),
                nac_core::store::TranscriptLogWriter::new(&path)
                    .unwrap()
                    .read_from(&child_id, 0)
                    .unwrap(),
            )
        })
        .await
        .unwrap();
    let receipt = receipt.expect("terminal receipt must survive reconstruction");
    let current = current.expect("child relationship must survive reconstruction");
    assert_eq!(current.generation, generation);
    assert_eq!(
        current.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(
        receipt.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(receipt.run_id, child.run_id);
    assert_eq!(inbox.len(), 1);
    assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
    assert!(child_recovery.is_none() && parent_recovery.is_none());
    for pair in child_log.windows(2) {
        assert_eq!(pair[1].0, pair[0].0 + 1);
    }
    let marker = format!("ALL612:CHILD:{seed:08x}:0");
    let child_prompt_occurrences = child_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&marker))).count();
    let child_tool_results = child_log
        .iter()
        .filter(|(_, message)| matches!(message, Message::Tool { .. }))
        .count();
    assert_eq!(child_prompt_occurrences, 1);
    assert!(
        child_tool_results <= 1,
        "cancellation duplicated native tool results"
    );
    SqliteLoadStore.assert_integrity(&rebuilt.inner.store_path);
    rebuilt.drain_persistence().await.unwrap();
    drop(rebuilt);
    let telemetry = drain_telemetry(&recorder, &exporter).await;
    assert_eq!(telemetry.dropped, 0);
    assert_eq!(telemetry.failures, 0);
    assert!(telemetry.max_direct_active >= 1);
    assert!(telemetry.max_terminal_settlement_overlap >= 1);
    assert!(!telemetry.child_process_started.is_empty());
    assert_eq!(
        telemetry.child_process_started,
        telemetry.child_process_stopped
    );
    let evidence = CancellationEvidence {
        schema_version: 2,
        topology: "direct_sessions_with_traditional_children",
        phase: "native-process-blocked",
        outcome: "cancelled_and_reconstructed",
        seed,
        build_id: identity.build_id,
        source_revision: identity.source_revision,
        child_generation: generation,
        descendant_pid,
        descendant_reaped: !process_running(descendant_pid),
        recovery_obligations: usize::from(child_recovery.is_some())
            + usize::from(parent_recovery.is_some()),
        terminal_receipts: 1,
        parent_inbox_items: inbox.len(),
        child_prompt_occurrences,
        child_tool_results,
        probes,
        model_requests,
        telemetry,
    };
    std::fs::remove_dir_all(root).unwrap();
    write_secret_safe_artifact(&artifact, &evidence);
}

#[cfg(unix)]
async fn new_owned_manager(root: &Path) -> SessionManager {
    let options = ServerOptions {
        root_cwd: root.to_path_buf(),
        store_path: Some(root.join("store.db")),
        managed_host: None,
    };
    nac_core::store::spawn_blocking_store_caller(move || {
        let _member = nac_core::telemetry::register_test_recorder_thread();
        SessionManager::new(options)
    })
    .await
    .unwrap()
    .unwrap()
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded direct model-I/O cancellation scenario"]
async fn direct_model_cancellation_and_reconstruction() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let artifact = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/direct-load/model-cancellation.json");
    prepare_artifact(&artifact);
    let root = temp_root("direct_model_cancellation");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("all612-direct-fixture-key"));
    init_workspace(&root);
    let identity = build_identity::current();
    let exporter = Arc::new(nac_core::telemetry::InMemoryExporter::default());
    let recorder = nac_core::telemetry::TelemetryRecorder::bounded(
        exporter.clone(),
        nac_core::telemetry::RuntimeMetadata::sqlite(
            identity.build_id,
            identity.source_revision,
            nac_core::store::schema_version(),
            Some("all612-host"),
            Some("all612-model-cancellation"),
        ),
        nac_core::telemetry::MAX_EXPORT_QUEUE_CAPACITY,
    );
    let _telemetry = nac_core::telemetry::install_test_recorder(recorder.clone());
    let seed = DEFAULT_SEED;
    let model = DirectModel::start(seed, 1, true, None, true);
    seed_direct_session_with_base_url(&root, "direct-fault-parent", model.base_url.clone());
    let manager = new_owned_manager(&root).await;
    let parent = manager.attach_session("direct-fault-parent").await.unwrap();
    let app = crate::delivery::server::build_router(manager.clone());
    manager
        .submit_prompt(
            "direct-fault-parent",
            SubmitPromptRequest {
                prompt: format!("ALL612:PRIMARY:{seed:08x}:0: launch the scripted child"),
            },
            nac_core::store::InputOrigin::Automation,
        )
        .await
        .unwrap();
    model.wait_for_primaries().await;
    model.primary_gate.release();
    model.wait_for_children().await;
    let mut probes = observe_blocked(&app, "child-model-blocked").await;
    let path = manager.inner.store_path.clone();
    let child = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_traditional_children(&path, "direct-fault-parent")
    })
    .await
    .unwrap()
    .unwrap()
    .pop()
    .unwrap();
    let controller =
        nac_core::traditional_children::controller_for(&manager.inner.store_path).unwrap();
    let cancelled = tokio::time::timeout(
        PHASE_TIMEOUT,
        controller.cancel(
            "direct-fault-parent",
            &child.child_session_id,
            child.generation,
        ),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        cancelled.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(cancelled.generation, child.generation);
    model.child_gate.release();
    let store = manager.inner.store_path.clone();
    tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            probes.extend(probe_pair(&app, "model-cancel-settlement").await);
            let path = store.clone();
            let delivered = nac_core::store::spawn_blocking_store_caller(move || {
                let inbox =
                    nac_core::store::list_session_inbox(&path, "direct-fault-parent").unwrap();
                inbox.len() == 1 && inbox[0].status == nac_core::store::InboxStatus::Delivered
            })
            .await
            .unwrap();
            if delivered && !parent.has_active_operation() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("model-cancelled child completion was not delivered");
    let model_requests = model.finish();
    assert_eq!(
        model_requests
            .iter()
            .filter(|request| request.phase == "child")
            .count(),
        1
    );
    drop(controller);
    drop(parent);
    drop(app);
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let rebuilt = new_owned_manager(&root).await;
    let path = rebuilt.inner.store_path.clone();
    let child_id = child.child_session_id.clone();
    let generation = child.generation;
    let (receipt, current, inbox, child_recovery, parent_recovery, child_log) =
        nac_core::store::spawn_blocking_store_caller(move || {
            (
                nac_core::store::load_traditional_child_terminal_receipt(
                    &path, &child_id, generation,
                )
                .unwrap(),
                nac_core::store::load_traditional_child(&path, &child_id).unwrap(),
                nac_core::store::list_session_inbox(&path, "direct-fault-parent").unwrap(),
                nac_core::store::load_run_recovery(&path, &child_id).unwrap(),
                nac_core::store::load_run_recovery(&path, "direct-fault-parent").unwrap(),
                nac_core::store::TranscriptLogWriter::new(&path)
                    .unwrap()
                    .read_from(&child_id, 0)
                    .unwrap(),
            )
        })
        .await
        .unwrap();
    let receipt = receipt.unwrap();
    let current = current.unwrap();
    assert_eq!(current.generation, generation);
    assert_eq!(
        current.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(
        receipt.status,
        nac_core::store::TraditionalChildStatus::Cancelled
    );
    assert_eq!(receipt.run_id, child.run_id);
    assert_eq!(inbox.len(), 1);
    assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
    assert!(child_recovery.is_none() && parent_recovery.is_none());
    for pair in child_log.windows(2) {
        assert_eq!(pair[1].0, pair[0].0 + 1);
    }
    let marker = format!("ALL612:CHILD:{seed:08x}:0");
    let prompt_count = child_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&marker))).count();
    assert_eq!(prompt_count, 1);
    assert!(
        !child_log
            .iter()
            .any(|(_, message)| matches!(message, Message::Tool { .. })),
        "blocked model must not run a native tool"
    );
    SqliteLoadStore.assert_integrity(&rebuilt.inner.store_path);
    rebuilt.drain_persistence().await.unwrap();
    drop(rebuilt);
    let telemetry = drain_telemetry(&recorder, &exporter).await;
    assert_eq!(telemetry.dropped, 0);
    assert_eq!(telemetry.failures, 0);
    assert!(telemetry.max_direct_active >= 1);
    assert!(telemetry.max_terminal_settlement_overlap >= 1);
    assert_eq!(
        telemetry.child_process_started,
        telemetry.child_process_stopped
    );
    let evidence = serde_json::json!({
        "schema_version":2, "topology":"direct_sessions_with_traditional_children", "seed":seed,
        "build_id":identity.build_id, "source_revision":identity.source_revision,
        "phase":"child-model-blocked", "outcome":"cancelled_and_reconstructed", "child_generation":generation,
        "child_prompt_occurrences":prompt_count, "terminal_receipts":1, "parent_inbox_items":inbox.len(),
        "recovery_obligations":usize::from(child_recovery.is_some())+usize::from(parent_recovery.is_some()),
        "probes":probes, "model_requests":model_requests, "telemetry":telemetry,
    });
    std::fs::remove_dir_all(root).unwrap();
    write_secret_safe_artifact(&artifact, &evidence);
}

#[cfg(unix)]
#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded direct child transcript append failure scenario"]
async fn direct_child_append_failure_and_reconstruction() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let artifact = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/direct-load/append-failure.json");
    prepare_artifact(&artifact);
    let root = temp_root("direct_append_failure");
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("all612-direct-fixture-key"));
    init_workspace(&root);
    let seed = DEFAULT_SEED;
    let model = DirectModel::start(seed, 1, true, None, false);
    seed_direct_session_with_base_url(&root, "direct-fault-parent", model.base_url.clone());
    let manager = new_owned_manager(&root).await;
    let parent = manager.attach_session("direct-fault-parent").await.unwrap();
    let app = crate::delivery::server::build_router(manager.clone());
    manager
        .submit_prompt(
            "direct-fault-parent",
            SubmitPromptRequest {
                prompt: format!("ALL612:PRIMARY:{seed:08x}:0: launch the scripted child"),
            },
            nac_core::store::InputOrigin::Automation,
        )
        .await
        .unwrap();
    model.wait_for_primaries().await;
    model.primary_gate.release();
    model.wait_for_children().await;
    let mut probes = observe_blocked(&app, "child-model-before-append-failure").await;
    let path = manager.inner.store_path.clone();
    let child = nac_core::store::spawn_blocking_store_caller(move || {
        nac_core::store::list_traditional_children(&path, "direct-fault-parent")
            .unwrap()
            .pop()
            .unwrap()
    })
    .await
    .unwrap();
    let path = manager.inner.store_path.clone();
    let child_id = child.child_session_id.clone();
    nac_core::store::spawn_blocking_store_caller(move || {
        // Bind the synthetic child identity rather than interpolating it into SQL.
        let connection = rusqlite::Connection::open(path).unwrap();
        connection.execute_batch("CREATE TABLE all612_append_fault_target (session_id TEXT NOT NULL);").unwrap();
        connection.execute("INSERT INTO all612_append_fault_target VALUES (?1)", [&child_id]).unwrap();
        connection.execute_batch("CREATE TRIGGER all612_fail_child_append BEFORE INSERT ON thread_events WHEN NEW.session_id IN (SELECT session_id FROM all612_append_fault_target) BEGIN SELECT RAISE(ABORT, 'injected direct append failure'); END;").unwrap();
    }).await.unwrap();
    model.child_gate.release();
    let store = manager.inner.store_path.clone();
    tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            probes.extend(probe_pair(&app, "append-failure-settlement").await);
            let path = store.clone();
            let delivered = nac_core::store::spawn_blocking_store_caller(move || {
                let inbox =
                    nac_core::store::list_session_inbox(&path, "direct-fault-parent").unwrap();
                inbox.len() == 1 && inbox[0].status == nac_core::store::InboxStatus::Delivered
            })
            .await
            .unwrap();
            if delivered && !parent.has_active_operation() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("failed child completion was not delivered");
    let model_requests = model.finish();
    drop(parent);
    drop(app);
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let rebuilt = new_owned_manager(&root).await;
    let path = rebuilt.inner.store_path.clone();
    let child_id = child.child_session_id.clone();
    let generation = child.generation;
    let (receipt, current, inbox, recovery) =
        nac_core::store::spawn_blocking_store_caller(move || {
            (
                nac_core::store::load_traditional_child_terminal_receipt(
                    &path, &child_id, generation,
                )
                .unwrap(),
                nac_core::store::load_traditional_child(&path, &child_id).unwrap(),
                nac_core::store::list_session_inbox(&path, "direct-fault-parent").unwrap(),
                nac_core::store::load_run_recovery(&path, &child_id).unwrap(),
            )
        })
        .await
        .unwrap();
    let receipt = receipt.unwrap();
    let current = current.unwrap();
    assert_eq!(current.generation, generation);
    assert_eq!(
        current.status,
        nac_core::store::TraditionalChildStatus::Failed
    );
    assert_eq!(
        receipt.status,
        nac_core::store::TraditionalChildStatus::Failed
    );
    assert_eq!(receipt.run_id, child.run_id);
    assert_eq!(
        receipt.failure.as_deref(),
        Some("injected direct append failure")
    );
    assert_eq!(inbox.len(), 1);
    assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
    assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
    let recovery = recovery.expect("failed run retains its durable failure marker");
    assert_eq!(recovery.status, nac_core::store::RunRecoveryStatus::Failed);
    assert_eq!(Some(&recovery.run_id), child.run_id.as_ref());
    SqliteLoadStore.assert_integrity(&rebuilt.inner.store_path);
    rebuilt.drain_persistence().await.unwrap();
    drop(rebuilt);
    let identity = build_identity::current();
    let evidence = serde_json::json!({"schema_version":2, "topology":"direct_sessions_with_traditional_children", "seed":seed,
        "build_id":identity.build_id, "source_revision":identity.source_revision, "phase":"child-transcript-append",
        "outcome":"failed_and_reconstructed", "child_generation":generation, "terminal_receipts":1,
        "parent_inbox_items":inbox.len(), "recovery_obligations":0, "retained_failed_recovery_markers":1,
        "probes":probes, "model_requests":model_requests});
    std::fs::remove_dir_all(root).unwrap();
    write_secret_safe_artifact(&artifact, &evidence);
}
