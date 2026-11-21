//! Bounded direct-session and traditional-child load workloads.
use super::direct_model::DirectModel;
use super::*;

#[derive(Serialize)]
pub(in crate::tests) struct DirectEvidence {
    schema_version: u32,
    topology: &'static str,
    mode: &'static str,
    outcome: &'static str,
    seed: u64,
    primaries: usize,
    store: &'static str,
    build_id: &'static str,
    source_revision: &'static str,
    elapsed_ms: u128,
    primary_overlap: usize,
    child_overlap: usize,
    attachment_overlap: usize,
    completion_overlap: usize,
    transcript_counts: Vec<(usize, usize)>,
    primary_event_counts: Vec<usize>,
    terminal_receipts: usize,
    delivered_inbox_items: usize,
    recovery_obligations: usize,
    busy_callbacks: Option<usize>,
    owned_process_cleanup: &'static str,
    model_requests: Vec<ModelRequest>,
    probes: Vec<ProbeSample>,
    store_configuration: StoreConfiguration,
    checkpoint: CheckpointEvidence,
    telemetry: TelemetryEvidence,
}

#[test]
fn new_attempt_replaces_stale_success_with_incomplete_receipt() {
    let root = temp_root("direct_evidence_attempt");
    let path = root.join("evidence.json");
    std::fs::write(&path, r#"{"outcome":"passed"}"#).unwrap();
    prepare_artifact(&path);
    let receipt: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(receipt["schema_version"], 2);
    assert_eq!(receipt["outcome"], "incomplete");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_barrier_cleanup_does_not_panic_during_unwinding() {
    let phase = PhaseGate::new(1);
    let _ = std::panic::catch_unwind(|| {
        let _guard = phase.state.lock().unwrap();
        panic!("fixture failure");
    });
    phase.release();
    assert!(phase.state.lock().err().unwrap().into_inner().released);

    let completion = CompletionGate::new(true);
    let _ = std::panic::catch_unwind(|| {
        let _guard = completion.next_ordinal.lock().unwrap();
        panic!("fixture failure");
    });
    completion.release_all();
    assert!(completion
        .released
        .load(std::sync::atomic::Ordering::SeqCst));
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded direct-session load workload"]
async fn direct_load_replacement_scenario() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for count in VARIANTS {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/direct-load")
            .join(format!("seed-{DEFAULT_SEED}-primaries-{count}.json"));
        prepare_artifact(&path);
        let evidence = run_variant(&SqliteLoadStore, DEFAULT_SEED, count).await;
        write_secret_safe_artifact(&path, &evidence);
    }
}

#[tokio::test(flavor = "current_thread")]
#[ignore = "bounded direct SQLite contention scenario"]
async fn direct_load_busy_conflict() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/direct-load/busy.json");
    prepare_artifact(&path);
    let evidence = run_mode(&SqliteLoadStore, DEFAULT_SEED, 1, false, true).await;
    write_secret_safe_artifact(&path, &evidence);
}

#[test]
#[ignore = "bounded direct-session concurrent workload"]
fn direct_load_concurrent_probe() {
    std::thread_local! {
        static RECORDER_MEMBER: std::cell::RefCell<Option<nac_core::telemetry::TestRecorderThreadGuard>> = const { std::cell::RefCell::new(None) };
    }
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .on_thread_unpark(|| {
            RECORDER_MEMBER.with(|member| {
                member.borrow_mut().take();
                *member.borrow_mut() = Some(nac_core::telemetry::register_test_recorder_thread());
            })
        })
        .on_thread_park(|| {
            RECORDER_MEMBER.with(|member| {
                member.borrow_mut().take();
            })
        })
        .build()
        .unwrap();
    runtime.block_on(async {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target/direct-load/concurrent.json");
        prepare_artifact(&path);
        let mut evidence = run_mode(&SqliteLoadStore, DEFAULT_SEED, 4, true, false).await;
        if evidence.attachment_overlap <= 1
            || evidence.completion_overlap != 4
            || evidence.telemetry.max_terminal_settlement_overlap <= 1
        {
            evidence.outcome = "insufficient_observed_overlap";
        }
        write_secret_safe_artifact(&path, &evidence);
        assert!(
            evidence.attachment_overlap > 1,
            "attachment calls did not overlap"
        );
        assert_eq!(evidence.completion_overlap, 4);
        assert!(
            evidence.telemetry.max_terminal_settlement_overlap > 1,
            "terminal settlement operations did not overlap"
        );
    });
}

pub(in crate::tests) async fn run_variant(
    adapter: &dyn LoadStoreAdapter,
    seed: u64,
    count: usize,
) -> DirectEvidence {
    run_mode(adapter, seed, count, false, false).await
}

async fn run_mode(
    adapter: &dyn LoadStoreAdapter,
    seed: u64,
    count: usize,
    concurrent: bool,
    busy_conflict: bool,
) -> DirectEvidence {
    let root = temp_root(&format!("direct_load_{seed}_{count}"));
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
            Some("all612-direct-load"),
        ),
        nac_core::telemetry::MAX_EXPORT_QUEUE_CAPACITY,
    );
    let _telemetry = nac_core::telemetry::install_test_recorder(recorder.clone());
    let model = DirectModel::start(seed, count, !concurrent, None, false);
    let ids: Vec<_> = (0..count)
        .map(|ordinal| format!("all612-{seed:08x}-{count}-{ordinal}"))
        .collect();
    for id in &ids {
        seed_direct_session_with_base_url(&root, id, model.base_url.clone());
    }
    let manager = adapter.create_direct_manager_async(&root).await;
    let mut services = Vec::new();
    if !concurrent {
        for id in &ids {
            services.push(manager.attach_session(id).await.unwrap());
        }
    }
    let app = crate::delivery::server::build_router(manager.clone());
    let start = Instant::now();
    let mut launches = tokio::task::JoinSet::new();
    let attach_barrier = Arc::new(tokio::sync::Barrier::new(count));
    let attaching = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let max_attaching = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    for (ordinal, id) in ids.iter().enumerate() {
        let manager = manager.clone();
        let id = id.clone();
        let attached = services.get(ordinal).cloned();
        let barrier = Arc::clone(&attach_barrier);
        let active = Arc::clone(&attaching);
        let maximum = Arc::clone(&max_attaching);
        launches.spawn(async move {
            let service = if let Some(service) = attached {
                service
            } else {
                barrier.wait().await;
                let current = active.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                maximum.fetch_max(current, std::sync::atomic::Ordering::SeqCst);
                let service = manager.attach_session(&id).await.unwrap();
                active.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                service
            };
            let events = service.subscribe_events();
            manager
                .submit_prompt(
                    &id,
                    SubmitPromptRequest {
                        prompt: format!(
                            "ALL612:PRIMARY:{seed:08x}:{ordinal}: launch the scripted child"
                        ),
                    },
                    nac_core::store::InputOrigin::Automation,
                )
                .await
                .unwrap();
            (ordinal, service, events)
        });
    }
    model.wait_for_primaries().await;
    let mut probes = observe_blocked(&app, "primary-blocked").await;
    model.primary_gate.release();
    model.wait_for_children().await;
    let (primary_overlap, child_overlap) = model.observed_overlap();
    assert_eq!((primary_overlap, child_overlap), (count, count));
    probes.extend(observe_blocked(&app, "child-blocked").await);
    let busy_callbacks = if busy_conflict {
        let (samples, callbacks) =
            observe_busy_conflict(&root.join("store.db"), &ids[0], &app).await;
        probes.extend(samples);
        Some(callbacks)
    } else {
        None
    };
    model.child_gate.release();
    let mut attached_services = Vec::new();
    while let Some(result) = launches.join_next().await {
        attached_services.push(result.unwrap());
    }
    attached_services.sort_by_key(|(ordinal, _, _)| *ordinal);
    let mut event_receivers = Vec::new();
    services = attached_services
        .into_iter()
        .map(|(_, service, events)| {
            event_receivers.push(events);
            service
        })
        .collect();
    let attachment_overlap = if concurrent {
        max_attaching.load(std::sync::atomic::Ordering::SeqCst)
    } else {
        1
    };
    let completion_overlap = if concurrent {
        let observed = model.wait_for_concurrent_completions().await;
        probes.extend(observe_blocked(&app, "completion-blocked").await);
        model.concurrent_completions.release();
        observed
    } else {
        1
    };
    let store = root.join("store.db");
    if !concurrent {
        for (ordinal, id) in ids.iter().enumerate() {
            tokio::time::timeout(PHASE_TIMEOUT, async {
                loop {
                    probes.extend(probe_pair(&app, "ordered-settlement").await);
                    let path = store.clone();
                    let id = id.clone();
                    let settled = nac_core::store::spawn_blocking_store_caller(move || {
                        let children =
                            nac_core::store::list_traditional_children(&path, &id).unwrap();
                        let inbox = nac_core::store::list_session_inbox(&path, &id).unwrap();
                        children.len() == 1
                            && children[0].status
                                == nac_core::store::TraditionalChildStatus::Completed
                            && inbox.len() == 1
                            && inbox[0].status == nac_core::store::InboxStatus::Delivered
                    })
                    .await
                    .unwrap();
                    if settled && !services[ordinal].has_active_operation() {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("ordered child completion should settle before releasing the next");
            model.completion_gate.advance();
        }
    }
    let completed = tokio::time::timeout(PHASE_TIMEOUT, async {
        loop {
            probes.extend(probe_pair(&app, "settlement").await);
            let path = store.clone();
            let parents = ids.clone();
            let settled = nac_core::store::spawn_blocking_store_caller(move || {
                parents.iter().all(|id| {
                    let children = nac_core::store::list_traditional_children(&path, id).unwrap();
                    let inbox = nac_core::store::list_session_inbox(&path, id).unwrap();
                    children.len() == 1
                        && children[0].status == nac_core::store::TraditionalChildStatus::Completed
                        && inbox.len() == 1
                        && inbox[0].status == nac_core::store::InboxStatus::Delivered
                })
            })
            .await
            .unwrap();
            if settled
                && services
                    .iter()
                    .all(|service| !service.has_active_operation())
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await;
    completed.expect("direct children and inbox deliveries must settle");
    let mut primary_event_counts = Vec::new();
    for mut events in event_receivers {
        let mut starts = BTreeSet::new();
        let mut terminals = BTreeSet::new();
        let mut last_sequence = None;
        let mut count_events = 0;
        loop {
            let envelope = match events.try_recv() {
                Ok(envelope) => envelope,
                Err(
                    tokio::sync::broadcast::error::TryRecvError::Empty
                    | tokio::sync::broadcast::error::TryRecvError::Closed,
                ) => break,
                Err(tokio::sync::broadcast::error::TryRecvError::Lagged(skipped)) => {
                    panic!("lost {skipped} direct session events")
                }
            };
            if let Some(last) = last_sequence {
                assert!(envelope.sequence_id > last);
            }
            last_sequence = Some(envelope.sequence_id);
            count_events += 1;
            match envelope.event {
                nac_core::events::SessionEvent::RunStarted { .. } => {
                    assert!(starts.insert(envelope.run_id.unwrap().to_string()));
                }
                nac_core::events::SessionEvent::RunCompleted { .. } => {
                    assert!(terminals.insert(envelope.run_id.unwrap().to_string()));
                }
                nac_core::events::SessionEvent::RunFailed { .. }
                | nac_core::events::SessionEvent::RunCancelled => {
                    panic!("direct primary run did not complete")
                }
                _ => {}
            }
        }
        assert_eq!(starts.len(), 2);
        assert_eq!(starts, terminals);
        primary_event_counts.push(count_events);
    }
    let path = store.clone();
    let parents = ids.clone();
    let (transcript_counts, terminal_receipts, delivered_inbox_items, recovery_obligations) =
        nac_core::store::spawn_blocking_store_caller(move || {
            let writer = nac_core::store::TranscriptLogWriter::new(&path).unwrap();
            let mut counts = Vec::new();
            let mut receipts = 0;
            let mut deliveries = 0;
            let mut obligations = 0;
        for (ordinal, id) in parents.iter().enumerate() {
                let children = nac_core::store::list_traditional_children(&path, id).unwrap();
                assert_eq!(children.len(), 1);
                let child = &children[0];
                assert_eq!(child.generation, 1);
                let receipt = nac_core::store::load_traditional_child_terminal_receipt(
                    &path,
                    &child.child_session_id,
                    child.generation,
                )
                .unwrap()
                .unwrap();
                assert_eq!(receipt.run_id, child.run_id);
                assert_eq!(receipt.report.as_deref(), Some("ALL612_CHILD_COMPLETE"));
                let inbox = nac_core::store::list_session_inbox(&path, id).unwrap();
                assert_eq!(inbox.len(), 1);
                assert_eq!(receipt.completion_inbox_id, Some(inbox[0].id));
                assert_eq!(inbox[0].status, nac_core::store::InboxStatus::Delivered);
                receipts += 1;
                deliveries += 1;
                let parent_log = writer.read_from(id, 0).unwrap();
                let child_log = writer.read_from(&child.child_session_id, 0).unwrap();
                for log in [&parent_log, &child_log] {
                    for pair in log.windows(2) {
                        assert_eq!(pair[1].0, pair[0].0 + 1);
                    }
                }
            let primary_marker = format!("ALL612:PRIMARY:{seed:08x}:{ordinal}");
            let child_marker = format!("ALL612:CHILD:{seed:08x}:{ordinal}");
            assert_eq!(parent_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&primary_marker))).count(), 1);
            assert_eq!(parent_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains("ALL612_CHILD_COMPLETE"))).count(), 1);
            assert_eq!(child_log.iter().filter(|(_, message)| matches!(message, Message::User { content } if content.contains(&child_marker))).count(), 1);
            assert_eq!(child_log.iter().filter(|(_, message)| matches!(message, Message::Tool { content, .. } if content.as_text().is_some_and(|text| text.contains("ALL612_NATIVE_COMMAND_COMPLETE")))).count(), 1);
            assert_eq!(child_log.iter().filter(|(_, message)| matches!(message, Message::Assistant { content: Some(content), .. } if content == "ALL612_CHILD_COMPLETE")).count(), 1);
                obligations += usize::from(nac_core::store::load_run_recovery(&path, id).unwrap().is_some());
                obligations += usize::from(nac_core::store::load_run_recovery(&path, &child.child_session_id).unwrap().is_some());
                counts.push((parent_log.len(), child_log.len()));
            }
            (counts, receipts, deliveries, obligations)
        })
        .await
        .unwrap();
    assert_eq!(recovery_obligations, 0);
    adapter.assert_integrity(&store);
    let store_configuration = adapter.configuration(&store);
    let checkpoint = adapter.checkpoint(&store);
    let model_requests = model.finish();
    for phase in ["primary", "child", "child-continuation"] {
        assert_eq!(
            model_requests
                .iter()
                .filter(|request| request.phase == phase)
                .count(),
            count
        );
    }
    assert!(
        model_requests
            .iter()
            .filter(|request| request.phase == "primary-continuation")
            .count()
            >= count * 2
    );
    drop(services);
    drop(app);
    manager.stop_local_run_admission().await;
    manager.cancel_local_active_runs_for_shutdown().await;
    manager.drain_persistence().await.unwrap();
    drop(manager);
    let telemetry = drain_telemetry(&recorder, &exporter).await;
    assert_eq!(telemetry.dropped, 0);
    assert_eq!(telemetry.failures, 0);
    assert!(telemetry.max_direct_active >= count as u64);
    assert!(telemetry
        .store_latency_us
        .get("terminal_settlement")
        .is_some_and(|latency| latency.count >= count));
    assert!(telemetry.max_terminal_settlement_overlap >= 1);
    assert!(telemetry.child_process_started.len() >= count);
    assert_eq!(
        telemetry.child_process_started,
        telemetry.child_process_stopped
    );
    let evidence = DirectEvidence {
        schema_version: 2,
        topology: "direct_sessions_with_traditional_children",
        mode: if concurrent { "concurrent" } else { "ordered" },
        outcome: "completed",
        seed,
        primaries: count,
        store: adapter.identity(),
        build_id: identity.build_id,
        source_revision: identity.source_revision,
        elapsed_ms: start.elapsed().as_millis(),
        primary_overlap,
        child_overlap,
        attachment_overlap,
        completion_overlap,
        transcript_counts,
        primary_event_counts,
        terminal_receipts,
        delivered_inbox_items,
        recovery_obligations,
        busy_callbacks,
        owned_process_cleanup: "all observed subprocesses stopped",
        model_requests,
        probes,
        store_configuration,
        checkpoint,
        telemetry,
    };
    std::fs::remove_dir_all(root).unwrap();
    evidence
}

pub(super) async fn observe_blocked(app: &Router, phase: &'static str) -> Vec<ProbeSample> {
    let until = Instant::now() + Duration::from_millis(100);
    let mut samples = Vec::new();
    loop {
        samples.extend(probe_pair(app, phase).await);
        if Instant::now() >= until {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    samples
}

pub(super) fn init_workspace(root: &Path) {
    std::fs::write(root.join(".gitignore"), "store.db*\nnac-home/\n").unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["add", ".gitignore"],
        vec![
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "-qm",
            "direct load fixture",
        ],
    ] {
        assert!(std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .status()
            .unwrap()
            .success());
    }
}

pub(in crate::tests) fn prepare_artifact(path: &Path) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    // Replace stale success before starting. An interrupted or failed attempt
    // retains an explicit incomplete receipt without capturing panic contents.
    let identity = build_identity::current();
    let numeric_environment = |name| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
    };
    write_secret_safe_artifact(
        path,
        &serde_json::json!({
            "schema_version": 2,
            "topology": "direct_sessions_with_traditional_children",
            "outcome": "incomplete",
            "artifact": path.file_name().unwrap().to_string_lossy(),
            "build_id": identity.build_id,
            "source_revision": identity.source_revision,
            "run_id": numeric_environment("GITHUB_RUN_ID"),
            "run_attempt": numeric_environment("GITHUB_RUN_ATTEMPT"),
        }),
    );
}

async fn observe_busy_conflict(
    store: &Path,
    parent_id: &str,
    app: &Router,
) -> (Vec<ProbeSample>, usize) {
    let path = store.to_owned();
    let parent_id = parent_id.to_owned();
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let task = tokio::task::spawn_blocking(move || {
        let children = nac_core::store::list_traditional_children(&path, &parent_id).unwrap();
        assert_eq!(children.len(), 1);
        let child_id = children[0].child_session_id.clone();
        let blocker = rusqlite::Connection::open(&path).unwrap();
        blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        nac_core::store::reset_session_event_busy_observations();
        let contender_path = path.clone();
        let (result_tx, result_rx) = std::sync::mpsc::channel();
        let contender = thread::spawn(move || {
            let result = nac_core::store::append_session_event_observing_busy(
                &contender_path,
                &child_id,
                "all612-busy",
                r#"{"type":"all612_busy_conflict"}"#,
            );
            result_tx.send(result).unwrap();
        });
        let deadline = Instant::now() + PHASE_TIMEOUT;
        while nac_core::store::session_event_busy_observations() == 0 {
            assert!(
                Instant::now() < deadline,
                "direct append did not encounter SQLite busy"
            );
            thread::sleep(Duration::from_millis(1));
        }
        assert!(
            result_rx.try_recv().is_err(),
            "append completed while lock held"
        );
        ready_tx.send(()).unwrap();
        release_rx.recv_timeout(PHASE_TIMEOUT).unwrap();
        blocker.execute_batch("COMMIT").unwrap();
        result_rx.recv_timeout(PHASE_TIMEOUT).unwrap().unwrap();
        contender.join().unwrap();
        nac_core::store::session_event_busy_observations()
    });
    tokio::time::timeout(PHASE_TIMEOUT, ready_rx)
        .await
        .expect("busy callback deadline")
        .expect("busy fixture exited before callback");
    let samples = observe_blocked(app, "sqlite-busy").await;
    release_tx.send(()).unwrap();
    let callbacks = tokio::time::timeout(PHASE_TIMEOUT, task)
        .await
        .expect("busy append recovery deadline")
        .unwrap();
    assert!(callbacks > 0);
    (samples, callbacks)
}
