//! A real published input survives producer death; one unavailable runtime must
//! settle its own occurrence rather than starving another due schedule.
use super::*;

const RECOVER_ROOT: &str = "NAC_TEST_FRESH_ATTACHMENT_ROOT";
const RECOVER_ENDPOINT: &str = "NAC_TEST_FRESH_ATTACHMENT_ENDPOINT";
const RECOVER_CHILD: &str =
    "tests::fresh_interval_tasks::recovery::attachment::attachment_recovery_child";

async fn call<T: Send + 'static>(
    operation: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> T {
    store::spawn_blocking_store_caller(operation)
        .await
        .unwrap()
        .unwrap()
}

// Only the child process receives dummy credentials and isolated configuration.
// In particular, the test driver never mutates its process environment.
fn command(root: &Path, test: &str, log: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command.env_clear();
    for name in ["PATH", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    for directory in ["nac-home", "home", "xdg", "tmp"] {
        std::fs::create_dir_all(root.join(directory)).unwrap();
    }
    command
        .args(["--exact", test, "--nocapture", "--test-threads=1"])
        .env("NAC_HOME", root.join("nac-home"))
        .env("HOME", root.join("home"))
        .env("XDG_CONFIG_HOME", root.join("xdg"))
        .env("TMPDIR", root.join("tmp"))
        .env("LANG", "C.UTF-8");
    let log = std::fs::File::create(root.join(log)).unwrap();
    command
        .stdout(Stdio::from(log.try_clone().unwrap()))
        .stderr(Stdio::from(log));
    command
}

async fn wait(child: &mut OwnedChild, seconds: u64) -> std::process::ExitStatus {
    tokio::time::timeout(Duration::from_secs(seconds), async {
        loop {
            if let Some(status) = child.0.try_wait().unwrap() {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("owned attachment fixture child exceeded its bound")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_publication_restart_attachment_failure_does_not_starve_healthy_due_schedule() {
    attachment_restart("configuration").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_attachment_unknown_configuration_error_stays_unsettled() {
    attachment_restart("unknown-config").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_attachment_stored_corruption_error_stays_unsettled() {
    attachment_restart("stored-corruption").await;
}

async fn attachment_restart(mode: &str) {
    let root = std::fs::canonicalize(temp_root("fresh_attachment_recovery")).unwrap();
    let (endpoint_a, requests_a, provider_a) = counted_provider().await;
    let (endpoint_b, requests_b, provider_b) = counted_provider().await;
    let mut publisher = None;
    let mut recovery = None;
    let primary = catch_fixture_panic(async {
        std::fs::create_dir_all(root.join("nac-home")).unwrap();
        std::fs::write(
            root.join("nac-home/config.toml"),
            "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
        )
        .unwrap();
        publisher = Some(OwnedChild(
            command(&root, CHILD, "attachment-publisher.log")
                .env(CHILD_ROOT, &root)
                .env("NAC_TEST_FRESH_PUBLICATION_SEED_ENDPOINT", &endpoint_a)
                .spawn()
                .unwrap(),
        ));
        tokio::time::timeout(Duration::from_secs(15), async {
            while !root.join("published.json").is_file() {
                assert!(publisher.as_mut().unwrap().0.try_wait().unwrap().is_none());
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("producer did not reach the actual post-publication cut");
        let published: FreshTaskLaunchReceipt =
            serde_json::from_slice(&std::fs::read(root.join("published.json")).unwrap()).unwrap();
        assert!(published.first_input_id.is_some() && published.initial_run_id.is_none());
        assert_eq!(requests_a.load(Ordering::SeqCst), 0);
        let mut process = publisher.take().unwrap();
        process.0.kill().unwrap();
        assert!(!process.0.wait().unwrap().success());
        recovery = Some(OwnedChild(
            command(&root, RECOVER_CHILD, "attachment-recovery.log")
                .env(RECOVER_ROOT, &root)
                .env(RECOVER_ENDPOINT, &endpoint_b)
                .env("NAC_TEST_FRESH_ATTACHMENT_MODE", mode)
                .env("SECOND_API_KEY", "attachment-fixture-key-b")
                .spawn()
                .unwrap(),
        ));
        let status = wait(recovery.as_mut().unwrap(), 25).await;
        let child_log = std::fs::read_to_string(root.join("attachment-recovery.log")).unwrap();
        eprintln!("FRESH_ATTACHMENT_CHILD_LOG\n{child_log}");
        if mode != "configuration" {
            assert!(
                child_log.contains("heartbeat scan deferred: heartbeat runtime is unavailable"),
                "the real attachment error must propagate through tick"
            );
        }
        assert!(
            status.success(),
            "attachment recovery child failed: {status}"
        );
        assert_eq!(requests_a.load(Ordering::SeqCst), 0);
        assert_eq!(
            requests_b.load(Ordering::SeqCst),
            if mode == "configuration" { 1 } else { 0 }
        );
    })
    .await;
    drop(publisher);
    drop(recovery);
    provider_a.abort();
    provider_b.abort();
    let joined_a = provider_a.await;
    let joined_b = provider_b.await;
    eprintln!(
        "FRESH_ATTACHMENT_CLEANUP primary_panicked={} A_requests={} B_requests={} A={joined_a:?} B={joined_b:?} fixture={}",
        primary.is_err(),
        requests_a.load(Ordering::SeqCst),
        requests_b.load(Ordering::SeqCst),
        root.display()
    );
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    assert!(joined_a.unwrap_err().is_cancelled());
    assert!(joined_b.unwrap_err().is_cancelled());
}

// Invoked only as an owned isolated child. It performs no environment mutation
// and uses only the dummy B credential supplied by the driver.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn attachment_recovery_child() {
    let Some(root) = std::env::var_os(RECOVER_ROOT) else {
        return;
    };
    let root = PathBuf::from(root);
    assert!(std::env::var_os("OPENAI_API_KEY").is_none());
    let endpoint = std::env::var(RECOVER_ENDPOINT).unwrap();
    let mode = std::env::var("NAC_TEST_FRESH_ATTACHMENT_MODE").unwrap();
    let published: FreshTaskLaunchReceipt =
        serde_json::from_slice(&std::fs::read(root.join("published.json")).unwrap()).unwrap();
    let path = root.join("store.db");
    let before_source = source(&root);
    let mut manager = Some(owned(&root).await);
    let mut scheduler = None;
    let primary = catch_fixture_panic(async {
        let manager = manager.as_ref().unwrap();
        let original = prepared(manager, &published.occurrence_id)
            .await
            .receipt()
            .clone();
        same_identity(&published, &original);
        assert_eq!(original.first_input_id, published.first_input_id);
        assert!(original.initial_run_id.is_none() && original.initial_outcome.is_none());
        let read_path = path.clone();
        let read_original = original.clone();
        let (snapshot, launch) = call(move || {
            Ok((
                sessions::load_session(&read_path, &read_original.session_id)?,
                store::load_task_launch(&read_path, &read_original.request.request_id)?
                    .context("published launch is missing")?,
            ))
        })
        .await;
        assert_eq!(snapshot.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
        assert_eq!(launch.phase, TaskLaunchPhase::Ready);
        let marker = launch
            .workspace_path
            .parent()
            .unwrap()
            .join(format!("{}.materialized", launch.session_id));
        let proof = std::fs::read(&marker).unwrap();
        std::fs::write(
            launch.workspace_path.join("keep"),
            "retained human evidence",
        )
        .unwrap();
        // A's persisted snapshot is frozen. B inherits the next intentional
        // occurrence's updated dummy selector through the normal config API.
        let write_path = path.clone();
        let destination = published.destination.clone();
        let cwd = published.binding.cwd.clone();
        let owner = format!("project:{}", published.destination.project_id);
        let write_owner = owner.clone();
        let schedule_b = call(move || {
            let defaults =
                model_configurations::load_model_configuration(&write_path, "task-config")?;
            model_configurations::update_model_configuration(
                &write_path,
                "task-config",
                model_configurations::NewModelConfiguration {
                    name: defaults.name,
                    backend: defaults.backend,
                    model: defaults.model,
                    base_url: endpoint,
                    allow_insecure_http: false,
                    api_key_env: Some("SECOND_API_KEY".into()),
                    reasoning_effort: defaults.reasoning_effort,
                    extra_headers: defaults.extra_headers,
                    orchestrator_compaction_threshold: None,
                    initial_prompt: None,
                    light_model: None,
                },
            )?;
            let binding = store::fresh_heartbeat_binding(&write_path, &destination, None, &cwd)?;
            // Constructed due-time, not elapsed-cadence evidence. No RunNow for B.
            Ok(store::control_heartbeat(
                &write_path,
                &write_owner,
                &uuid::Uuid::new_v4().to_string(),
                &HeartbeatAction::Create {
                    spec: specification(),
                },
                "Create independently due healthy B.",
                &binding,
                application::heartbeats::epoch_ms() - 60_000,
            )?
            .schedule)
        })
        .await;
        if mode == "unknown-config" {
            // A real non-model TOML parse failure is not a typed model setup
            // error. It must propagate instead of manufacturing settlement.
            std::fs::write(root.join("nac-home/config.toml"), "[invalid TOML").unwrap();
        } else if mode == "stored-corruption" {
            let fault_path = path.clone();
            let session = original.session_id.clone();
            call(move || {
                // Fault injection only, after the REAL publication cut. No
                // invented receipt/run/authority row is used as restart proof.
                let connection = rusqlite::Connection::open(&fault_path)?;
                assert_eq!(
                    connection.execute(
                        "UPDATE sessions SET messages_json='{' WHERE session_id=?1",
                        [&session]
                    )?,
                    1
                );
                assert!(sessions::load_session_config(&fault_path, &session).is_ok());
                let error = sessions::load_session(&fault_path, &session).unwrap_err();
                assert!(!error.is::<nac_core::model::ModelConfigurationError>());
                Ok(())
            })
            .await;
        }
        scheduler = Some(HeartbeatScheduler::start(manager));
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let (after_a, after_b, history_b) = loop {
            let a = prepared(manager, &published.occurrence_id)
                .await
                .receipt()
                .clone();
            let read_path = path.clone();
            let read_owner = owner.clone();
            let schedule_id = schedule_b.schedule_id.clone();
            let (history, b) = call(move || {
                let history = store::heartbeat_history(&read_path, &read_owner, &schedule_id)?;
                let b = history
                    .first()
                    .map(|o| store::read_fresh_heartbeat_launch(&read_path, &o.occurrence_id))
                    .transpose()?
                    .flatten()
                    .map(|v| v.receipt().clone());
                Ok((history, b))
            })
            .await;
            if (a.initial_outcome.is_some()
                && b.as_ref().is_some_and(|v| v.initial_outcome.is_some()))
                || std::time::Instant::now() >= deadline
            {
                break (a, b, history);
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        };
        let observation = serde_json::json!({
            "A_occurrence": after_a.occurrence_id, "A_session": after_a.session_id,
            "A_input": after_a.first_input_id, "A_run": after_a.initial_run_id,
            "A_outcome": after_a.initial_outcome, "B_schedule": schedule_b.schedule_id,
            "B_history": history_b, "B_receipt": after_b,
        });
        std::fs::write(
            root.join("attachment-observed.json"),
            serde_json::to_vec_pretty(&observation).unwrap(),
        )
        .unwrap();
        eprintln!("FRESH_ATTACHMENT_OBSERVATION {observation}");
        if mode != "configuration" {
            assert!(after_a.initial_outcome.is_none() && after_a.initial_run_id.is_none());
            assert!(after_b.is_none() && history_b.is_empty());
            same_identity(&published, &after_a);
            assert_eq!(after_a.first_input_id, published.first_input_id);
            let read_path = path.clone();
            let read_a = after_a.clone();
            let input = call(move || {
                store::load_session_inbox_item(
                    &read_path,
                    &read_a.session_id,
                    read_a.first_input_id.unwrap(),
                )
            })
            .await;
            assert_eq!(input.status, store::InboxStatus::Pending);
            assert_eq!(input.content, published.request.prompt);
            assert_eq!(std::fs::read(&marker).unwrap(), proof);
            assert_eq!(source(&root), before_source);
            return;
        }
        assert_eq!(
            after_a.initial_outcome.as_ref().and_then(|o| o.outcome),
            Some(HeartbeatOutcome::NeedsHumanAction),
            "published A attachment failure must settle before unrelated B admission",
        );
        same_identity(&published, &after_a);
        assert_eq!(after_a.first_input_id, published.first_input_id);
        assert!(after_a.initial_run_id.is_none());
        let read_path = path.clone();
        let read_owner = owner.clone();
        let read_a = after_a.clone();
        let (schedule_a, input, retained_count) = call(move || {
            Ok((
                store::read_heartbeat(&read_path, &read_owner, &read_a.schedule_id)?,
                store::load_session_inbox_item(
                    &read_path,
                    &read_a.session_id,
                    read_a.first_input_id.unwrap(),
                )?,
                store::fresh_heartbeat_retained_allowance(&read_path)?.retained_count,
            ))
        })
        .await;
        assert_eq!(schedule_a.state, store::HeartbeatState::Suspended);
        assert!(schedule_a
            .reason
            .as_deref()
            .unwrap()
            .contains("runtime is unavailable"));
        let after_b = after_b.expect("healthy B must acquire a distinct retained task");
        assert!(after_b.initial_run_id.is_some());
        assert_ne!(after_b.session_id, after_a.session_id);
        assert_eq!(input.content, published.request.prompt);
        assert_eq!(input.status, store::InboxStatus::Cancelled);
        assert_eq!(retained_count, 2);
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let rescanned = prepared(manager, &published.occurrence_id)
            .await
            .receipt()
            .clone();
        assert_eq!(rescanned, after_a);
        let read_path = path.clone();
        let request_id = published.request.request_id.clone();
        let final_launch = call(move || store::load_task_launch(&read_path, &request_id))
            .await
            .unwrap();
        assert_eq!(final_launch.source, launch.source);
        assert_eq!(final_launch.workspace_path, launch.workspace_path);
        assert_eq!(std::fs::read(marker).unwrap(), proof);
        assert_eq!(
            std::fs::read_to_string(launch.workspace_path.join("keep")).unwrap(),
            "retained human evidence"
        );
        assert_eq!(source(&root), before_source);
    })
    .await;
    if let Some(scheduler) = scheduler {
        scheduler.stop().await;
    }
    let cleanup = retire(manager.take().unwrap()).await;
    eprintln!(
        "FRESH_ATTACHMENT_OWNER_CLEANUP primary_panicked={} result={cleanup:?}",
        primary.is_err()
    );
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    cleanup.unwrap();
}
