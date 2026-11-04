//! Fresh joins to ALL-415 partial-checkout and post-publication recovery.
//! The partial checkout is a constructed crash image, not a mid-checkout kill.
use super::*;
#[path = "recovery/attachment.rs"]
mod attachment;
use crate::application::{
    heartbeat_scheduler::HeartbeatScheduler, session_creation::CreationProjectionGate,
    task_launches::TaskLaunchApplication,
};
use nac_core::store::{FreshTaskLaunchReceipt, PreparedFreshTaskLaunch, TaskLaunchPhase};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
};

const CHILD: &str = "tests::fresh_interval_tasks::recovery::publication_child";
const CHILD_ROOT: &str = "NAC_TEST_FRESH_PUBLICATION_ROOT";

async fn owned(root: &Path) -> SessionManager {
    SessionManager::new_async(ServerOptions {
        root_cwd: root.to_owned(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    })
    .await
    .unwrap()
}

async fn retire(manager: SessionManager) -> anyhow::Result<()> {
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await?;
    Ok(())
}

async fn prepared(manager: &SessionManager, id: &str) -> PreparedFreshTaskLaunch {
    let path = manager.inner.store_path.clone();
    let id = id.to_owned();
    store::spawn_blocking_store_caller(move || store::read_fresh_heartbeat_launch(&path, &id))
        .await
        .unwrap()
        .unwrap()
        .unwrap()
}

// The response completes one real initial model request. No quiet-result claim:
// a missing report_heartbeat is classified by the existing settlement owner.
async fn counted_provider() -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
    let count = Arc::new(AtomicUsize::new(0));
    let received = count.clone();
    let task = tokio::spawn(async move {
        let handler = move |axum::Json(body): axum::Json<serde_json::Value>| {
            received.fetch_add(1, Ordering::SeqCst);
            async move {
                let item = serde_json::json!({"id":"msg-recovery","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Recovery fixture complete.","annotations":[]}]});
                let response = serde_json::json!({"id":"fresh-recovery","object":"response","status":"completed","model":"gpt-5.2","output":[item.clone()],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}});
                if body["stream"] == true {
                    axum::response::IntoResponse::into_response((
                        [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                        format!(
                            "data: {}\n\ndata: {}\n\n",
                            serde_json::json!({"type":"response.output_item.done","output_index":0,"item":item}),
                            serde_json::json!({"type":"response.completed","response":response})
                        ),
                    ))
                } else {
                    axum::response::IntoResponse::into_response(axum::Json(response))
                }
            }
        };
        axum::serve(
            listener,
            axum::Router::new().route("/v1/responses", axum::routing::post(handler)),
        )
        .await
        .unwrap();
    });
    (endpoint, count, task)
}

async fn seed_occurrence(
    root: &Path,
    endpoint: &str,
) -> (SessionManager, store::HeartbeatOccurrence, i64) {
    let manager = test_manager(root);
    let request = task_launches::fixture(root, &manager).await;
    let mut defaults =
        model_configurations::load_model_configuration(&manager.inner.store_path, "task-config")
            .unwrap();
    defaults.base_url = endpoint.to_owned();
    model_configurations::update_model_configuration(
        &manager.inner.store_path,
        "task-config",
        model_configurations::NewModelConfiguration {
            name: defaults.name,
            backend: defaults.backend,
            model: defaults.model,
            base_url: defaults.base_url,
            allow_insecure_http: false,
            api_key_env: defaults.api_key_env,
            reasoning_effort: defaults.reasoning_effort,
            extra_headers: defaults.extra_headers,
            orchestrator_compaction_threshold: None,
            initial_prompt: None,
            light_model: None,
        },
    )
    .unwrap();
    let path = manager.inner.store_path.clone();
    let cwd = root.join("repo/nested");
    std::fs::write(cwd.join("file"), "staged source").unwrap();
    git(&root.join("repo"), &["add", "nested/file"]);
    std::fs::write(cwd.join("file"), "dirty source").unwrap();
    std::fs::write(cwd.join("untracked"), "untracked source").unwrap();
    let destination = FreshTaskDestination {
        project_id: request.project_id.clone(),
        pinned_commit: None,
        default_ref: Some("refs/heads/dev".into()),
        model: None,
        reasoning_effort: None,
        retained_limit: 2,
    };
    let binding =
        store::fresh_heartbeat_binding(&path, &destination, None, cwd.to_str().unwrap()).unwrap();
    let owner = format!("project:{}", request.project_id);
    let now = application::heartbeats::epoch_ms();
    let schedule = store::control_heartbeat(
        &path,
        &owner,
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create {
            spec: specification(),
        },
        "Create fresh recovery fixture tasks.",
        &binding,
        now,
    )
    .unwrap()
    .schedule;
    store::control_heartbeat(
        &path,
        &owner,
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::RunNow {
            schedule_id: schedule.schedule_id,
            expected_version: schedule.version,
        },
        "Run the recovery fixture once.",
        &binding,
        now,
    )
    .unwrap();
    let occurrence = store::materialize_heartbeats(&path, now).unwrap().remove(0);
    (manager, occurrence, now)
}

async fn seed(root: &Path, endpoint: &str) -> FreshTaskLaunchReceipt {
    let (manager, occurrence, now) = seed_occurrence(root, endpoint).await;
    let path = manager.inner.store_path.clone();
    let receipt = store::reserve_fresh_heartbeat_launch(
        &path,
        &occurrence.occurrence_id,
        occurrence.revision,
        now,
    )
    .unwrap()
    .unwrap()
    .receipt()
    .clone();
    assert!(receipt.first_input_id.is_none() && receipt.initial_run_id.is_none());
    retire(manager).await.unwrap();
    std::fs::write(
        root.join("reservation.json"),
        serde_json::to_vec(&receipt).unwrap(),
    )
    .unwrap();
    receipt
}

fn source(root: &Path) -> (String, Vec<u8>, String, Vec<u8>, Vec<u8>) {
    let repo = root.join("repo");
    (
        git(&repo, &["rev-parse", "HEAD"]),
        std::fs::read(repo.join(".git/index")).unwrap(),
        git(&repo, &["status", "--porcelain=v1"]),
        std::fs::read(repo.join("nested/file")).unwrap(),
        std::fs::read(repo.join("nested/untracked")).unwrap(),
    )
}

fn same_identity(before: &FreshTaskLaunchReceipt, after: &FreshTaskLaunchReceipt) {
    assert_eq!(after.occurrence_id, before.occurrence_id);
    assert_eq!(after.schedule_id, before.schedule_id);
    assert_eq!(after.request, before.request);
    assert_eq!(after.destination, before.destination);
    assert_eq!(after.session_id, before.session_id);
}

async fn retained(manager: &SessionManager, receipt: &FreshTaskLaunchReceipt) {
    let path = manager.inner.store_path.clone();
    let project = receipt.destination.project_id.clone();
    let inventory = store::spawn_blocking_store_caller(move || {
        store::fresh_heartbeat_inventory(&path, &project, None)
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(inventory.len(), 1);
    same_identity(receipt, &inventory[0]);
    let path = manager.inner.store_path.clone();
    assert_eq!(
        store::spawn_blocking_store_caller(move || store::fresh_heartbeat_retained_allowance(
            &path
        ))
        .await
        .unwrap()
        .unwrap()
        .retained_count,
        1
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_partial_checkout_restart_retains_exact_occurrence_without_publication() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("fresh_partial_recovery")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let (endpoint, count, model) = counted_provider().await;
    let mut manager = None;
    let mut scheduler = None;
    let primary = catch_fixture_panic(async {
        let receipt = seed(&root, &endpoint).await;
        let path = root.join("store.db");
        let project =
            nac_core::projects::load_project_launch_context(&path, &receipt.destination.project_id)
                .unwrap()
                .project;
        let source_binding = nac_core::workspace::task_worktree::TaskGit::default()
            .resolve_source(&project, &receipt.request, None, None)
            .await
            .unwrap();
        let record =
            store::reserve_task_launch(&path, receipt.request.clone(), source_binding).unwrap();
        assert_eq!(record.session_id, receipt.session_id);
        store::pin_fresh_heartbeat_workspace_mode(&path, &receipt.occurrence_id, false).unwrap();
        store::update_task_launch(
            &path,
            &receipt.request.request_id,
            TaskLaunchPhase::PreparingWorkspace,
            None,
        )
        .unwrap();
        let parent = record.workspace_path.parent().unwrap();
        std::fs::create_dir_all(parent).unwrap();
        let marker = parent.join(format!("{}.owner", record.session_id));
        let completed = parent.join(format!("{}.materialized", record.session_id));
        std::fs::write(&marker, &receipt.request.request_id).unwrap();
        // ALL-415's truthful constructed partial state: valid HEAD, no checkout proof.
        git(
            &root.join("repo"),
            &[
                "worktree",
                "add",
                "--no-checkout",
                "--detach",
                record.workspace_path.to_str().unwrap(),
                &record.source.commit,
            ],
        );
        std::fs::write(record.workspace_path.join("keep"), "partial work").unwrap();
        let before = source(&root);
        manager = Some(owned(&root).await);
        scheduler = Some(HeartbeatScheduler::start(manager.as_ref().unwrap()));
        let after = settled(manager.as_ref().unwrap(), &receipt.occurrence_id)
            .await
            .unwrap();
        same_identity(&receipt, &after);
        assert!(after.first_input_id.is_none() && after.initial_run_id.is_none());
        assert!(matches!(
            after.initial_outcome.unwrap().outcome,
            Some(HeartbeatOutcome::Failed | HeartbeatOutcome::NeedsHumanAction)
        ));
        let path = path.clone();
        let request = receipt.request.request_id.clone();
        let recovered =
            store::spawn_blocking_store_caller(move || store::load_task_launch(&path, &request))
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        assert_eq!(recovered.source, record.source);
        assert_eq!(recovered.workspace_path, record.workspace_path);
        assert_eq!(recovered.phase, TaskLaunchPhase::Failed);
        assert!(!recovered.session_present && recovered.first_input_id.is_none());
        let path = root.join("store.db");
        assert!(
            store::spawn_blocking_store_caller(move || sessions::list_sessions(&path))
                .await
                .unwrap()
                .unwrap()
                .is_empty()
        );
        let inbox_path = root.join("store.db");
        let session = receipt.session_id.clone();
        assert!(
            store::spawn_blocking_store_caller(move || store::list_session_inbox(
                &inbox_path,
                &session
            ))
            .await
            .unwrap()
            .unwrap()
            .is_empty()
        );
        assert!(!completed.exists());
        assert_eq!(
            std::fs::read_to_string(marker).unwrap(),
            receipt.request.request_id
        );
        assert_eq!(
            std::fs::read_to_string(record.workspace_path.join("keep")).unwrap(),
            "partial work"
        );
        assert!(!record.workspace_path.join("nested/file").exists());
        assert_eq!(source(&root), before);
        retained(manager.as_ref().unwrap(), &receipt).await;
        assert_eq!(count.load(Ordering::SeqCst), 0);
    })
    .await;
    if let Some(scheduler) = scheduler {
        scheduler.stop().await;
    }
    let cleanup = if let Some(manager) = manager {
        retire(manager).await
    } else {
        Ok(())
    };
    model.abort();
    let joined = model.await;
    eprintln!(
        "FRESH_PARTIAL_RECOVERY primary_panicked={} provider_join={joined:?} owner_cleanup={cleanup:?} fixture={}",
        primary.is_err(),
        root.display()
    );
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    cleanup.unwrap();
    assert!(joined.unwrap_err().is_cancelled());
}

// Private child helper: no-op outside its exact parent invocation, not acceptance evidence.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn publication_child() {
    let Some(root) = std::env::var_os(CHILD_ROOT) else {
        return;
    };
    let root = PathBuf::from(root);
    let home = root.join("nac-home");
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    if let Ok(endpoint) = std::env::var("NAC_TEST_FRESH_PUBLICATION_SEED_ENDPOINT") {
        seed(&root, &endpoint).await;
    }
    let manager = owned(&root).await;
    let receipt: FreshTaskLaunchReceipt =
        serde_json::from_slice(&std::fs::read(root.join("reservation.json")).unwrap()).unwrap();
    let gate = Arc::new(CreationProjectionGate::default());
    *manager
        .inner
        .session_creation_after_persistence
        .lock()
        .unwrap() = Some(gate.clone());
    let work = prepared(&manager, &receipt.occurrence_id).await;
    let caller = manager.clone();
    let preparation =
        tokio::spawn(async move { TaskLaunchApplication::new(&caller).prepare(work).await });
    tokio::time::timeout(Duration::from_secs(10), gate.reached.notified())
        .await
        .unwrap();
    let published = prepared(&manager, &receipt.occurrence_id)
        .await
        .receipt()
        .clone();
    assert!(published.first_input_id.is_some() && published.initial_run_id.is_none());
    assert!(manager.inner.active_sessions.read().await.is_empty());
    assert!(!preparation.is_finished());
    // This is after core COMMIT and core ACK, before cache/outer preparation return.
    std::fs::write(
        root.join("published.tmp"),
        serde_json::to_vec(&published).unwrap(),
    )
    .unwrap();
    std::fs::rename(root.join("published.tmp"), root.join("published.json")).unwrap();
    std::future::pending::<()>().await;
}

struct OwnedChild(Child);
impl Drop for OwnedChild {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn publication_restart(delete: bool) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("fresh_publication_recovery")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let (endpoint, count, model) = counted_provider().await;
    let mut child = None;
    let mut manager = None;
    let mut scheduler = None;
    let primary = catch_fixture_panic(async {
        let reservation = seed(&root, &endpoint).await;
        let before_source = source(&root);
        let log = std::fs::File::create(root.join("child.log")).unwrap();
        child = Some(OwnedChild(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", CHILD, "--nocapture", "--test-threads=1"])
                .env(CHILD_ROOT, &root)
                .stdout(Stdio::from(log.try_clone().unwrap()))
                .stderr(Stdio::from(log))
                .spawn()
                .unwrap(),
        ));
        tokio::time::timeout(Duration::from_secs(15), async {
            while !root.join("published.json").is_file() {
                assert!(
                    child.as_mut().unwrap().0.try_wait().unwrap().is_none(),
                    "child exited before publication gate"
                );
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let published: FreshTaskLaunchReceipt =
            serde_json::from_slice(&std::fs::read(root.join("published.json")).unwrap()).unwrap();
        same_identity(&reservation, &published);
        assert_eq!(count.load(Ordering::SeqCst), 0);
        let mut process = child.take().unwrap();
        process.0.kill().unwrap();
        assert!(!process.0.wait().unwrap().success());
        manager = Some(owned(&root).await);
        let receipt = prepared(manager.as_ref().unwrap(), &published.occurrence_id)
            .await
            .receipt()
            .clone();
        same_identity(&published, &receipt);
        assert_eq!(receipt.first_input_id, published.first_input_id);
        assert!(receipt.initial_run_id.is_none());
        let path = root.join("store.db");
        let request = receipt.request.request_id.clone();
        let launch =
            store::spawn_blocking_store_caller(move || store::load_task_launch(&path, &request))
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        assert_eq!(launch.phase, TaskLaunchPhase::Ready);
        assert_eq!(launch.first_input_id, published.first_input_id);
        let completed = launch
            .workspace_path
            .parent()
            .unwrap()
            .join(format!("{}.materialized", launch.session_id));
        let checkpoint = std::fs::read(&completed).unwrap();
        std::fs::write(
            launch.workspace_path.join("keep"),
            "retained human evidence",
        )
        .unwrap();
        if delete {
            // Real owning deletion while no scheduler exists; no fabricated DB state.
            manager
                .as_ref()
                .unwrap()
                .delete_session(&published.session_id)
                .await
                .unwrap();
            retire(manager.take().unwrap()).await.unwrap();
            manager = Some(owned(&root).await);
        }
        scheduler = Some(HeartbeatScheduler::start(manager.as_ref().unwrap()));
        let after = settled(manager.as_ref().unwrap(), &published.occurrence_id)
            .await
            .unwrap();
        same_identity(&published, &after);
        assert_eq!(after.first_input_id, published.first_input_id);
        if delete {
            assert!(after.initial_run_id.is_none());
            assert_eq!(
                after.initial_outcome.as_ref().unwrap().outcome,
                Some(HeartbeatOutcome::NeedsHumanAction)
            );
            assert!(after
                .initial_outcome
                .as_ref()
                .unwrap()
                .evidence
                .as_deref()
                .unwrap()
                .contains("deleted or is unavailable"));
            let path = root.join("store.db");
            assert!(
                store::spawn_blocking_store_caller(move || sessions::list_sessions(&path))
                    .await
                    .unwrap()
                    .unwrap()
                    .is_empty()
            );
            // Historical first_input_id survives; deletion may remove the inbox row.
            assert_eq!(count.load(Ordering::SeqCst), 0);
        } else {
            assert!(after.initial_run_id.is_some());
            assert_eq!(count.load(Ordering::SeqCst), 1);
            let path = root.join("store.db");
            let session = after.session_id.clone();
            let (inputs, runs): (i64, i64) =
                store::spawn_blocking_store_caller(move || -> anyhow::Result<_> {
                    let connection = rusqlite::Connection::open(&path)?;
                    Ok((
                        connection.query_row(
                            "SELECT count(*) FROM session_inbox WHERE session_id=?1",
                            [&session],
                            |row| row.get(0),
                        )?,
                        connection.query_row(
                            "SELECT run_count FROM sessions WHERE session_id=?1",
                            [&session],
                            |row| row.get(0),
                        )?,
                    ))
                })
                .await
                .unwrap()
                .unwrap();
            assert_eq!((inputs, runs), (1, 1));
        }
        retained(manager.as_ref().unwrap(), &published).await;
        assert_eq!(std::fs::read(completed).unwrap(), checkpoint);
        assert_eq!(
            std::fs::read_to_string(launch.workspace_path.join("keep")).unwrap(),
            "retained human evidence"
        );
        assert_eq!(source(&root), before_source);
        let path = root.join("store.db");
        let request = published.request.request_id.clone();
        let final_launch =
            store::spawn_blocking_store_caller(move || store::load_task_launch(&path, &request))
                .await
                .unwrap()
                .unwrap()
                .unwrap();
        assert_eq!(final_launch.session_id, launch.session_id);
        assert_eq!(final_launch.workspace_path, launch.workspace_path);
        assert_eq!(final_launch.source, launch.source);
    })
    .await;
    drop(child);
    if let Some(scheduler) = scheduler {
        scheduler.stop().await;
    }
    let cleanup = if let Some(manager) = manager {
        retire(manager).await
    } else {
        Ok(())
    };
    model.abort();
    let joined = model.await;
    eprintln!(
        "FRESH_PUBLICATION_RECOVERY delete={delete} primary_panicked={} provider_join={joined:?} owner_cleanup={cleanup:?} fixture={}",
        primary.is_err(),
        root.display()
    );
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    cleanup.unwrap();
    assert!(joined.unwrap_err().is_cancelled());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_publication_restart_reuses_one_initial_admission() {
    publication_restart(false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_publication_restart_does_not_recreate_deleted_task() {
    publication_restart(true).await;
}

const BOUNDARY_CHILD: &str = "tests::fresh_interval_tasks::recovery::restart_boundary_child";
const BOUNDARY_MODE: &str = "NAC_TEST_FRESH_RESTART_BOUNDARY";

fn digest(value: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(value))
}

fn boundary_snapshot(root: &Path, id: &str) -> serde_json::Value {
    let path = root.join("store.db");
    let work = store::read_fresh_heartbeat_launch(&path, id)
        .unwrap()
        .unwrap();
    let receipt = work.receipt();
    let history = store::heartbeat_history(
        &path,
        &format!("project:{}", receipt.destination.project_id),
        &receipt.schedule_id,
    )
    .unwrap();
    assert_eq!(history.len(), 1);
    let inputs = store::list_session_inbox(&path, &receipt.session_id).unwrap();
    let launch = store::load_task_launch(&path, &receipt.request.request_id).unwrap();
    let resource = launch.map(|launch| {
        let proof = launch
            .workspace_path
            .parent()
            .unwrap()
            .join(format!("{}.materialized", launch.session_id));
        serde_json::json!({"source":launch.source,"path":launch.workspace_path,
            "proof_sha256":digest(&std::fs::read(proof).unwrap())})
    });
    let connection = rusqlite::Connection::open(&path).unwrap();
    let sessions: i64 = connection
        .query_row("SELECT count(*) FROM sessions", [], |row| row.get(0))
        .unwrap();
    let runs: i64 = connection
        .query_row(
            "SELECT coalesce(sum(run_count),0) FROM sessions",
            [],
            |row| row.get(0),
        )
        .unwrap();
    // IDs/selectors/hashes only; no provider headers, prompt or configuration body.
    serde_json::json!({"at_ms":application::heartbeats::epoch_ms(),"pid":std::process::id(),
        "occurrence":receipt.occurrence_id,"schedule":receipt.schedule_id,
        "request":receipt.request.request_id,"session":receipt.session_id,
        "selector":receipt.request.default_ref,"pin_selector":receipt.request.git_ref,
        "request_sha256":digest(&serde_json::to_vec(&receipt.request).unwrap()),
        "defaults_sha256":digest(&serde_json::to_vec(&work.model_defaults()).unwrap()),
        "input":receipt.first_input_id,"run":receipt.initial_run_id,
        "generation":history[0].generation,"started_at_ms":history[0].started_at_ms,
        "execution_timeout_ms":history[0].spec.execution_timeout_ms,
        "resource":resource,"sessions":sessions,"runs":runs,
        "inputs":inputs.iter().map(|input|serde_json::json!({"id":input.id,"status":input.status,
            "run":input.delivered_run_id})).collect::<Vec<_>>(),
        "retained":store::fresh_heartbeat_retained_allowance(&path).unwrap().retained_count})
}

fn publish_boundary(root: &Path, snapshot: &serde_json::Value) {
    std::fs::write(
        root.join("boundary.tmp"),
        serde_json::to_vec(snapshot).unwrap(),
    )
    .unwrap();
    std::fs::rename(root.join("boundary.tmp"), root.join("boundary.json")).unwrap();
}

// Private helper, never counted as a behavior case. Its parent owns kill/wait.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn restart_boundary_child() {
    let Some(root) = std::env::var_os(CHILD_ROOT) else {
        return;
    };
    let mode = std::env::var(BOUNDARY_MODE).unwrap();
    let root = PathBuf::from(root);
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("fixture-key"));
    tokio::time::timeout(Duration::from_secs(25), async {
        let manager = owned(&root).await;
        if mode == "reservation" {
            let pending: store::HeartbeatOccurrence = serde_json::from_slice(
                &std::fs::read(root.join("pending-occurrence.json")).unwrap(),
            )
            .unwrap();
            let launch = store::reserve_fresh_heartbeat_launch(
                &root.join("store.db"),
                &pending.occurrence_id,
                pending.revision,
                application::heartbeats::epoch_ms(),
            )
            .unwrap()
            .unwrap();
            assert!(launch.receipt().first_input_id.is_none());
            assert!(launch.receipt().initial_run_id.is_none());
            // Deliberately no preparation/scheduler/Git call after reservation.
            let snapshot = boundary_snapshot(&root, &pending.occurrence_id);
            assert!(snapshot["resource"].is_null());
            assert_eq!(snapshot["sessions"], 0);
            assert_eq!(snapshot["retained"], 1);
            assert!(!root.join("repo/.git/worktrees").exists());
            let session = &launch.receipt().session_id;
            let storage = root.join("task-worktrees");
            assert!(!storage.join(session).exists());
            assert!(!storage.join(format!("{session}.materialized")).exists());
            assert!(!storage.join(format!("{session}.owner")).exists());
            publish_boundary(&root, &snapshot);
        } else {
            assert_eq!(mode, "provider");
            let receipt: FreshTaskLaunchReceipt =
                serde_json::from_slice(&std::fs::read(root.join("reservation.json")).unwrap())
                    .unwrap();
            let _scheduler = HeartbeatScheduler::start(&manager);
            while !root.join("capture-request-received").is_file() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            let snapshot = boundary_snapshot(&root, &receipt.occurrence_id);
            assert!(snapshot["run"].is_string() && snapshot["generation"].is_string());
            assert_eq!(snapshot["inputs"][0]["status"], "delivered");
            assert_eq!(snapshot["inputs"][0]["id"], snapshot["input"]);
            assert_eq!(snapshot["inputs"][0]["run"], snapshot["run"]);
            assert_eq!(snapshot["runs"], 1);
            assert!(
                snapshot["at_ms"].as_i64().unwrap()
                    < snapshot["started_at_ms"].as_i64().unwrap()
                        + snapshot["execution_timeout_ms"].as_i64().unwrap()
            );
            publish_boundary(&root, &snapshot);
            std::future::pending::<()>().await;
        }
        std::future::pending::<()>().await;
    })
    .await
    .expect("parent did not retire its owned boundary child within25seconds");
}

fn boundary_child(root: &Path, mode: &str) -> OwnedChild {
    let log = std::fs::File::create(root.join("boundary-child.log")).unwrap();
    OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", BOUNDARY_CHILD, "--nocapture", "--test-threads=1"])
            .env(CHILD_ROOT, root)
            .env(BOUNDARY_MODE, mode)
            .stdout(Stdio::from(log.try_clone().unwrap()))
            .stderr(Stdio::from(log))
            .spawn()
            .unwrap(),
    )
}

async fn reached_boundary(root: &Path, child: &mut OwnedChild) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(15), async {
        while !root.join("boundary.json").is_file() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "owned boundary child exited early"
            );
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        serde_json::from_slice(&std::fs::read(root.join("boundary.json")).unwrap()).unwrap()
    })
    .await
    .unwrap()
}

fn kill_boundary(child: &mut Option<OwnedChild>, reached: &serde_json::Value) {
    let process = child.as_mut().unwrap();
    assert_eq!(u64::from(process.0.id()), reached["pid"].as_u64().unwrap());
    assert!(
        application::heartbeats::epoch_ms()
            < reached["started_at_ms"].as_i64().unwrap()
                + reached["execution_timeout_ms"].as_i64().unwrap()
    );
    process.0.kill().unwrap();
    let exit = process.0.wait().unwrap();
    assert!(!exit.success());
    eprintln!(
        "FRESH_BOUNDARY_DEATH pid={} reached_ms={} waited_ms={} exit={exit:?}",
        process.0.id(),
        reached["at_ms"],
        application::heartbeats::epoch_ms()
    );
    drop(child.take());
}

fn cleanup_boundary_child(child: Option<OwnedChild>) -> anyhow::Result<()> {
    if let Some(mut process) = child {
        if process.0.try_wait()?.is_none() {
            process.0.kill()?;
        }
        let status = process.0.wait()?;
        eprintln!(
            "FRESH_BOUNDARY_FALLBACK_WAIT pid={} status={status:?}",
            process.0.id()
        );
    }
    Ok(())
}

async fn cleanup_boundary_owner(
    scheduler: Option<HeartbeatScheduler>,
    manager: Option<SessionManager>,
) -> (anyhow::Result<()>, anyhow::Result<()>) {
    let scheduler = if let Some(scheduler) = scheduler {
        tokio::time::timeout(Duration::from_secs(10), scheduler.stop())
            .await
            .context("boundary scheduler did not stop within10seconds")
    } else {
        Ok(())
    };
    let manager = if let Some(manager) = manager {
        tokio::time::timeout(Duration::from_secs(10), retire(manager))
            .await
            .context("boundary owner did not retire within10seconds")
            .and_then(|result| result)
    } else {
        Ok(())
    };
    (scheduler, manager)
}

fn same_boundary(before: &serde_json::Value, after: &serde_json::Value) {
    for field in [
        "occurrence",
        "schedule",
        "request",
        "session",
        "selector",
        "pin_selector",
        "request_sha256",
        "defaults_sha256",
        "retained",
    ] {
        assert_eq!(
            before[field], after[field],
            "changed boundary field {field}"
        );
    }
}

fn same_admitted_boundary(before: &serde_json::Value, after: &serde_json::Value) {
    same_boundary(before, after);
    for field in [
        "input",
        "run",
        "generation",
        "resource",
        "sessions",
        "runs",
        "inputs",
    ] {
        assert_eq!(
            before[field], after[field],
            "restart changed admitted {field}"
        );
    }
}

// The parent owns this counted real HTTP endpoint and every accepted socket.
// No response/output is sent. Retirement closes held sockets, then keeps the
// listener alive to detect an erroneous post-restart initial request.
struct HeldProvider {
    endpoint: String,
    count: Arc<AtomicUsize>,
    retire: Arc<std::sync::atomic::AtomicBool>,
    retired: Arc<std::sync::atomic::AtomicBool>,
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<std::thread::JoinHandle<anyhow::Result<()>>>,
}

impl HeldProvider {
    fn start() -> Self {
        use std::io::Read;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let endpoint = format!("http://{}/v1", listener.local_addr().unwrap());
        let count = Arc::new(AtomicUsize::new(0));
        let retire = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let retired = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (received, retire_now, retired_now, stopped) =
            (count.clone(), retire.clone(), retired.clone(), stop.clone());
        let thread = std::thread::spawn(move || -> anyhow::Result<()> {
            let mut held: Vec<std::net::TcpStream> = Vec::new();
            loop {
                if retire_now.swap(false, Ordering::SeqCst) || stopped.load(Ordering::SeqCst) {
                    for stream in held.drain(..) {
                        if let Err(error) = stream.shutdown(std::net::Shutdown::Both) {
                            anyhow::ensure!(
                                error.kind() == std::io::ErrorKind::NotConnected,
                                "owned provider socket retirement failed: {error}"
                            );
                        }
                    }
                    retired_now.store(true, Ordering::SeqCst);
                }
                if stopped.load(Ordering::SeqCst) {
                    break;
                }
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        stream.set_read_timeout(Some(Duration::from_millis(100)))?;
                        let deadline = std::time::Instant::now() + Duration::from_secs(2);
                        let mut bytes = Vec::new();
                        loop {
                            anyhow::ensure!(
                                std::time::Instant::now() < deadline,
                                "bounded provider request read expired"
                            );
                            let mut buffer = [0u8; 8192];
                            match stream.read(&mut buffer) {
                                Ok(0) => anyhow::bail!(
                                    "initial provider connection closed before complete request"
                                ),
                                Ok(n) => bytes.extend_from_slice(&buffer[..n]),
                                Err(error)
                                    if matches!(
                                        error.kind(),
                                        std::io::ErrorKind::WouldBlock
                                            | std::io::ErrorKind::TimedOut
                                    ) =>
                                {
                                    continue;
                                }
                                Err(error) => return Err(error.into()),
                            }
                            anyhow::ensure!(
                                bytes.len() <= 1024 * 1024,
                                "fixture model request exceeds bound"
                            );
                            if let Some(end) =
                                bytes.windows(4).position(|value| value == b"\r\n\r\n")
                            {
                                let header = std::str::from_utf8(&bytes[..end])?;
                                anyhow::ensure!(
                                    header.starts_with("POST /v1/responses "),
                                    "unexpected fixture provider route"
                                );
                                let length: usize = header
                                    .lines()
                                    .find_map(|line| {
                                        line.split_once(':')
                                            .filter(|(name, _)| {
                                                name.eq_ignore_ascii_case("content-length")
                                            })
                                            .map(|(_, value)| value.trim().parse())
                                    })
                                    .context("fixture request has no content length")??;
                                if bytes.len() >= end + 4 + length {
                                    let _: serde_json::Value =
                                        serde_json::from_slice(&bytes[end + 4..end + 4 + length])?;
                                    break;
                                }
                            }
                        }
                        let count = received.fetch_add(1, Ordering::SeqCst) + 1;
                        eprintln!(
                            "FRESH_HELD_PROVIDER_REQUEST fully_received_ms={} count={count}",
                            application::heartbeats::epoch_ms()
                        );
                        held.push(stream);
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(5))
                    }
                    Err(error) => return Err(error.into()),
                }
            }
            Ok(())
        });
        Self {
            endpoint,
            count,
            retire,
            retired,
            stop,
            thread: Some(thread),
        }
    }

    async fn retire_connection(&self) {
        self.retire.store(true, Ordering::SeqCst);
        tokio::time::timeout(Duration::from_secs(3), async {
            while !self.retired.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        eprintln!(
            "FRESH_HELD_CONNECTION_RETIRED at_ms={} count={}",
            application::heartbeats::epoch_ms(),
            self.count.load(Ordering::SeqCst)
        );
    }

    fn finish(&mut self) -> anyhow::Result<()> {
        let started = std::time::Instant::now();
        self.stop.store(true, Ordering::SeqCst);
        let result = self
            .thread
            .take()
            .unwrap()
            .join()
            .map_err(|_| anyhow::anyhow!("owned provider thread panicked"))?;
        eprintln!(
            "FRESH_HELD_THREAD_JOINED at_ms={} elapsed_ms={} result={result:?}",
            application::heartbeats::epoch_ms(),
            started.elapsed().as_millis()
        );
        anyhow::ensure!(
            started.elapsed() < Duration::from_secs(3),
            "owned provider cleanup exceeded its bounded read/accept retirement"
        );
        result
    }
}

impl Drop for HeldProvider {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_reservation_owner_restart_before_source_resolution_reuses_one_launch() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("fresh_r1_boundary")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let (endpoint, count, provider) = counted_provider().await;
    let (mut child, mut manager, mut scheduler) = (None, None, None);
    let primary = catch_fixture_panic(async {
        let (owner, occurrence, _) = seed_occurrence(&root, &endpoint).await;
        retire(owner).await.unwrap();
        let before_source = source(&root);
        std::fs::write(
            root.join("pending-occurrence.json"),
            serde_json::to_vec(&occurrence).unwrap(),
        )
        .unwrap();
        child = Some(boundary_child(&root, "reservation"));
        let reached = reached_boundary(&root, child.as_mut().unwrap()).await;
        assert_eq!(reached["occurrence"], occurrence.occurrence_id);
        assert!(
            reached["resource"].is_null() && reached["input"].is_null() && reached["run"].is_null()
        );
        assert_eq!(reached["sessions"], 0);
        assert_eq!(reached["runs"], 0);
        assert_eq!(reached["inputs"], serde_json::json!([]));
        assert_eq!(count.load(Ordering::SeqCst), 0);
        kill_boundary(&mut child, &reached);
        manager = Some(owned(&root).await);
        scheduler = Some(HeartbeatScheduler::start(manager.as_ref().unwrap()));
        let receipt = settled(manager.as_ref().unwrap(), &occurrence.occurrence_id)
            .await
            .unwrap();
        let after = boundary_snapshot(&root, &occurrence.occurrence_id);
        same_boundary(&reached, &after);
        assert_eq!(after["sessions"], 1);
        assert_eq!(after["runs"], 1);
        assert_eq!(after["inputs"].as_array().unwrap().len(), 1);
        assert_eq!(after["inputs"][0]["status"], "delivered");
        assert_eq!(after["inputs"][0]["id"], after["input"]);
        assert_eq!(after["inputs"][0]["run"], after["run"]);
        assert!(receipt.first_input_id.is_some() && receipt.initial_run_id.is_some());
        assert_eq!(count.load(Ordering::SeqCst), 1);
        let record = store::load_task_launch(&root.join("store.db"), &receipt.request.request_id)
            .unwrap()
            .unwrap();
        // First resolution is after restart; there was no original product pin at the cut.
        assert_eq!(record.source.commit, before_source.0);
        let mut conflict = receipt.request.clone();
        conflict.prompt.push_str(" changed");
        assert!(TaskLaunchApplication::new(manager.as_ref().unwrap())
            .start(conflict)
            .await
            .unwrap_err()
            .to_string()
            .contains("conflict"));
        tokio::time::sleep(Duration::from_millis(1200)).await;
        let rescanned = boundary_snapshot(&root, &occurrence.occurrence_id);
        same_admitted_boundary(&after, &rescanned);
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert_eq!(source(&root), before_source);
        retained(manager.as_ref().unwrap(), &receipt).await;
        eprintln!("FRESH_R1 reached={reached} reopened={after}");
    })
    .await;
    let child_cleanup = cleanup_boundary_child(child);
    let (scheduler_cleanup, cleanup) = cleanup_boundary_owner(scheduler, manager).await;
    provider.abort();
    let joined = provider.await;
    eprintln!(
        "FRESH_R1_CLEANUP primary_panicked={} child={child_cleanup:?} scheduler={scheduler_cleanup:?} provider={joined:?} owner={cleanup:?} fixture={}",
        primary.is_err(),
        root.display()
    );
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    child_cleanup.unwrap();
    scheduler_cleanup.unwrap();
    cleanup.unwrap();
    assert!(joined.unwrap_err().is_cancelled());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_initial_provider_request_owner_restart_retains_exact_uncertain_run_without_replay() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("fresh_r4_boundary")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let mut provider = HeldProvider::start();
    let (mut child, mut manager, mut scheduler) = (None, None, None);
    let primary = catch_fixture_panic(async {
        let reservation = seed(&root, &provider.endpoint).await;
        let before_source = source(&root);
        child = Some(boundary_child(&root, "provider"));
        tokio::time::timeout(Duration::from_secs(15), async {
            while provider.count.load(Ordering::SeqCst) == 0 {
                assert!(child.as_mut().unwrap().0.try_wait().unwrap().is_none());
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(provider.count.load(Ordering::SeqCst), 1);
        std::fs::write(
            root.join("capture-request-received"),
            "capture after complete HTTP request",
        )
        .unwrap();
        let reached = reached_boundary(&root, child.as_mut().unwrap()).await;
        assert_eq!(reached["request"], reservation.request.request_id);
        kill_boundary(&mut child, &reached);
        provider.retire_connection().await;
        manager = Some(owned(&root).await);
        // Passive inventory first; only the ordinary scheduler reconciles this run.
        retained(manager.as_ref().unwrap(), &reservation).await;
        scheduler = Some(HeartbeatScheduler::start(manager.as_ref().unwrap()));
        let receipt = settled(manager.as_ref().unwrap(), &reservation.occurrence_id)
            .await
            .unwrap();
        let after = boundary_snapshot(&root, &reservation.occurrence_id);
        same_admitted_boundary(&reached, &after);
        assert_eq!(
            receipt.initial_outcome.as_ref().unwrap().outcome,
            Some(HeartbeatOutcome::Interrupted)
        );
        let schedule = store::read_heartbeat(
            &root.join("store.db"),
            &format!("project:{}", reservation.destination.project_id),
            &reservation.schedule_id,
        )
        .unwrap();
        assert_eq!(schedule.state, store::HeartbeatState::Suspended);
        assert!(schedule.usage_unknown);
        tokio::time::sleep(Duration::from_millis(1200)).await;
        assert_eq!(provider.count.load(Ordering::SeqCst), 1);
        let final_state = boundary_snapshot(&root, &reservation.occurrence_id);
        same_admitted_boundary(&reached, &final_state);
        assert_eq!(source(&root), before_source);
        eprintln!("FRESH_R4 reached={reached} reopened={after}");
    })
    .await;
    let child_cleanup = cleanup_boundary_child(child);
    let (scheduler_cleanup, cleanup) = cleanup_boundary_owner(scheduler, manager).await;
    let provider_cleanup = provider.finish();
    eprintln!(
        "FRESH_R4_CLEANUP primary_panicked={} child={child_cleanup:?} scheduler={scheduler_cleanup:?} owner={cleanup:?} provider={provider_cleanup:?} fixture={}",
        primary.is_err(),
        root.display()
    );
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    child_cleanup.unwrap();
    scheduler_cleanup.unwrap();
    cleanup.unwrap();
    provider_cleanup.unwrap();
}
