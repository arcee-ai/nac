//! Real registered core submission held at its owned-store preflight.
mod fresh;
use super::*;
use nac_core::permissions::PermissionApprovalMode;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        LazyLock, Mutex, Weak,
    },
};
use tokio::sync::Notify;

static GATES: LazyLock<Mutex<HashMap<PathBuf, Weak<SubmissionGate>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
const WAIT: Duration = Duration::from_secs(2);

#[derive(Debug)]
struct StopObservation {
    target_matches: bool,
    error: Option<String>,
}

struct SubmissionGate {
    target: Weak<SessionService>,
    entered: Notify,
    registered_target_matches: AtomicBool,
    released: AtomicBool,
    release: Notify,
    expired: AtomicBool,
    stopped: Notify,
    observation: Mutex<Option<StopObservation>>,
}

fn gate_for(path: &Path) -> Option<Arc<SubmissionGate>> {
    GATES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .get(path)
        .and_then(Weak::upgrade)
}

pub(in crate::application::heartbeat_scheduler) async fn hold_submission(
    path: &Path,
    service: &Arc<SessionService>,
) {
    let Some(gate) = gate_for(path) else { return };
    gate.registered_target_matches.store(
        gate.target
            .upgrade()
            .is_some_and(|target| Arc::ptr_eq(&target, service)),
        Ordering::Release,
    );
    gate.entered.notify_one();
    let released = async {
        loop {
            let notified = gate.release.notified();
            if gate.released.load(Ordering::Acquire) {
                return;
            }
            notified.await;
        }
    };
    if tokio::time::timeout(Duration::from_secs(10), released)
        .await
        .is_err()
    {
        gate.expired.store(true, Ordering::Release);
    }
}

pub(in crate::application::heartbeat_scheduler) fn observe_submission_stop(
    path: &Path,
    service: &Arc<SessionService>,
    result: &Result<()>,
) {
    let Some(gate) = gate_for(path) else { return };
    *gate
        .observation
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(StopObservation {
        target_matches: gate
            .target
            .upgrade()
            .is_some_and(|target| Arc::ptr_eq(&target, service)),
        error: result.as_ref().err().map(|error| format!("{error:#}")),
    });
    gate.stopped.notify_one();
}

struct Registration {
    path: PathBuf,
    gate: Arc<SubmissionGate>,
}
impl Registration {
    fn install(path: &Path, target: &Arc<SessionService>) -> Self {
        let gate = Arc::new(SubmissionGate {
            target: Arc::downgrade(target),
            entered: Notify::new(),
            registered_target_matches: AtomicBool::new(false),
            released: AtomicBool::new(false),
            release: Notify::new(),
            expired: AtomicBool::new(false),
            stopped: Notify::new(),
            observation: Mutex::new(None),
        });
        GATES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(path.to_owned(), Arc::downgrade(&gate));
        Self {
            path: path.to_owned(),
            gate,
        }
    }

    fn release(&self) {
        self.gate.released.store(true, Ordering::Release);
        self.gate.release.notify_one();
    }
}
impl Drop for Registration {
    fn drop(&mut self) {
        self.release();
        GATES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.path);
    }
}

#[derive(Debug, PartialEq)]
struct Projection {
    schedule: store::HeartbeatSchedule,
    history: Vec<HeartbeatOccurrence>,
    inbox: Vec<store::SessionInboxRecord>,
    recovery: Option<store::RunRecoveryRecord>,
    messages: serde_json::Value,
    config_version: i64,
    updated_at: String,
}

async fn projection(path: &Path, id: &str) -> Result<Projection> {
    let path = path.to_owned();
    let id = id.to_owned();
    store::spawn_blocking_store_caller(move || {
        let snapshot = sessions::load_session(&path, "chat")?;
        Ok(Projection {
            schedule: store::read_heartbeat(&path, "chat", &id)?,
            history: store::heartbeat_history(&path, "chat", &id)?,
            inbox: store::list_session_inbox(&path, "chat")?,
            recovery: store::load_run_recovery(&path, "chat")?,
            messages: serde_json::to_value(snapshot.messages)?,
            config_version: snapshot.config_version,
            updated_at: snapshot.updated_at,
        })
    })
    .await?
}

async fn wait_until(predicate: impl Fn() -> bool) -> Result<()> {
    tokio::time::timeout(WAIT, async {
        while !predicate() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .map_err(|_| anyhow::anyhow!("required controlled phase was not observed"))
}

async fn observe() -> Result<()> {
    let root = std::env::temp_dir().join(format!(
        "nac-heartbeat-submit-stop-{}",
        uuid::Uuid::new_v4()
    ));
    std::fs::create_dir_all(&root)?;
    let root = std::fs::canonicalize(root)?;
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), Some("heartbeat-fixture-key"));
    let path = root.join("store.db");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("http://{}/v1", listener.local_addr()?);
    let mut snapshot = sessions::new_snapshot(
        "chat".into(),
        root.clone(),
        "fixture-model".into(),
        url,
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some("OPENAI_API_KEY".into()),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&path, &snapshot)?;
    snapshot.session_id = "blocker".into();
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .await?;
    let service = manager.attach_session("chat").await?;
    service
        .set_permission_approval_mode(PermissionApprovalMode::AutoApprove)
        .await?;
    anyhow::ensure!(
        service.permission_approval_mode().await? == PermissionApprovalMode::AutoApprove
    );
    let application = HeartbeatApplication::new(&manager);
    let created = application
        .control(
            "chat",
            uuid::Uuid::new_v4().to_string(),
            HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: "Submission Stop overlap".into(),
                    instructions: "Observe the local fixture.".into(),
                    skills: Vec::new(),
                    interval_ms: 60_000,
                    end_condition: "Finish after verification.".into(),
                    goal_id: None,
                    execution_timeout_ms: 30_000,
                    max_occurrences: 2,
                    token_allowance: None,
                },
            },
        )
        .await?;
    let id = created.schedule.schedule_id;
    application
        .control(
            "chat",
            uuid::Uuid::new_v4().to_string(),
            HeartbeatAction::RunNow {
                schedule_id: id.clone(),
                expected_version: created.schedule.version,
            },
        )
        .await?;
    let requests = Arc::new(AtomicUsize::new(0));
    let received = Arc::clone(&requests);
    let (model_stop, stopped) = tokio::sync::oneshot::channel();
    let mut model = tokio::spawn(async move {
        axum::serve(listener, axum::Router::new().route("/v1/responses", axum::routing::post(move || {
            received.fetch_add(1, Ordering::SeqCst);
            async { axum::Json(serde_json::json!({"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}})) }
        }))).with_graceful_shutdown(async { let _ = stopped.await; }).await
    });
    let registration = Registration::install(&manager.inner.store_path, &service);
    let mut scheduler = Some(HeartbeatScheduler::start(&manager));
    let mut connection = None;
    let mut writer = None;
    let mut stop = None;
    // Every fallible controlled step returns to the shared release/join cleanup.
    let result: Result<()> = async {
        tokio::time::timeout(WAIT, registration.gate.entered.notified()).await?;
        anyhow::ensure!(
            registration
                .gate
                .registered_target_matches
                .load(Ordering::Acquire),
            "wrong registered target"
        );
        let before = projection(&path, &id).await?;
        anyhow::ensure!(
            before.schedule.starts == 0
                && before.history.len() == 1
                && before.history[0].state == store::HeartbeatOccurrenceState::Pending
                && before.history[0].run_id.is_none()
                && before.history[0].generation.is_none()
                && before.history[0].inbox_item_id.is_none()
                && before.history[0].outcome.is_none()
                && before.history[0].attempt_count == 0
                && before.inbox.is_empty()
                && before.recovery.is_none()
                && !service.has_active_operation(),
            "invalid idle pending fixture: {before:#?}"
        );
        let owner = manager.inner._store_ownership.coordinator().unwrap();
        anyhow::ensure!(
            owner.stats().executing == 0 && owner.stats().queued == 0,
            "unrelated queued work"
        );
        connection = Some(rusqlite::Connection::open(&path)?);
        connection
            .as_ref()
            .unwrap()
            .execute_batch("BEGIN IMMEDIATE")?;
        let writer_manager = manager.clone();
        writer = Some(tokio::spawn(async move {
            writer_manager
                .inner
                ._store_ownership
                .coordinator()
                .unwrap()
                .create_session(snapshot)
                .await
        }));
        wait_until(|| owner.stats().executing == 1 && owner.stats().queued == 0).await?;
        registration.release();
        // Only the real core direct-primary preflight can enqueue now. No
        // projection or other test read is submitted while the writer is held.
        wait_until(|| owner.stats().executing == 1 && owner.stats().queued == 1).await?;
        stop = Some(tokio::spawn(scheduler.take().unwrap().stop()));
        tokio::time::timeout(WAIT, registration.gate.stopped.notified()).await?;
        {
            let observation = registration
                .gate
                .observation
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            anyhow::ensure!(
                observation
                    .as_ref()
                    .is_some_and(|o| o.target_matches && o.error.is_none()),
                "actual target Stop failed: {observation:?}"
            );
        }
        let returned = std::future::poll_fn(|cx| {
            std::task::Poll::Ready(
                match std::future::Future::poll(std::pin::Pin::new(stop.as_mut().unwrap()), cx) {
                    std::task::Poll::Ready(result) => Some(result),
                    std::task::Poll::Pending => None,
                },
            )
        })
        .await;
        if let Some(returned) = returned {
            stop.take(); // A completed JoinHandle must never be polled again.
            anyhow::bail!("Stop returned before accepted core preflight retired: {returned:?}");
        }
        anyhow::ensure!(
            owner.stats().executing == 1 && owner.stats().queued == 1,
            "controlled preflight no longer held"
        );
        connection.take().unwrap().execute_batch("ROLLBACK")?;
        let written = tokio::time::timeout(WAIT, writer.as_mut().unwrap()).await?;
        writer.take();
        written??;
        let stopped = tokio::time::timeout(WAIT, stop.as_mut().unwrap()).await?;
        stop.take();
        stopped?;
        let after = projection(&path, &id).await?;
        anyhow::ensure!(
            before == after,
            "Stop changed durable admission state: before={before:#?}; after={after:#?}"
        );
        anyhow::ensure!(
            !service.has_active_operation(),
            "target run admitted during Stop"
        );
        anyhow::ensure!(
            requests.load(Ordering::SeqCst) == 0,
            "unexpected loopback model request"
        );
        Ok(())
    }
    .await;

    // Release gates and SQLite before awaiting any accepted obligation, even
    // when the controlled observation failed. Connection drop also rolls back.
    registration.release();
    let mut errors = Vec::new();
    if let Some(connection) = connection.take() {
        if let Err(error) = connection.execute_batch("ROLLBACK") {
            errors.push(format!("rollback: {error}"));
        }
    }
    if let Some(mut writer) = writer.take() {
        match tokio::time::timeout(Duration::from_secs(5), &mut writer).await {
            Ok(Ok(Ok(()))) => {}
            Ok(other) => errors.push(format!("writer failed: {other:?}")),
            Err(error) => {
                errors.push(format!("writer UNRESOLVED; aborting test waiter: {error}"));
                writer.abort();
                let _ = writer.await;
            }
        }
    }
    if let Some(scheduler) = scheduler.take() {
        stop = Some(tokio::spawn(scheduler.stop()));
    }
    if let Some(mut stop) = stop.take() {
        match tokio::time::timeout(Duration::from_secs(5), &mut stop).await {
            Ok(Ok(())) => {}
            Ok(other) => errors.push(format!("scheduler Stop failed: {other:?}")),
            Err(error) => {
                errors.push(format!(
                    "scheduler Stop UNRESOLVED; aborting test waiter: {error}"
                ));
                stop.abort();
                let _ = stop.await;
            }
        }
    }
    // This typed FIFO marker also observes retirement if a broken scheduler
    // dropped its await; it is never substituted for the actual Stop oracle.
    match tokio::time::timeout(Duration::from_secs(5), projection(&path, &id)).await {
        Ok(Ok(_)) => {}
        other => errors.push(format!(
            "queued preflight retirement unresolved/failed: {other:?}"
        )),
    }
    if let Some(run) = service.active_run() {
        match tokio::time::timeout(Duration::from_secs(5), service.request_cancel(&run.run_id))
            .await
        {
            Ok(Ok(())) => {}
            other => errors.push(format!("accidentally admitted run cancellation: {other:?}")),
        }
    }
    if let Err(error) = wait_until(|| !service.has_active_operation()).await {
        errors.push(format!("active operation retirement: {error}"));
    }
    drop(service);
    match tokio::time::timeout(Duration::from_secs(5), async {
        manager.stop_local_run_admission().await;
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await
    })
    .await
    {
        Ok(Ok(())) => {}
        other => errors.push(format!("manager retirement: {other:?}")),
    }
    drop(manager);
    let _ = model_stop.send(());
    match tokio::time::timeout(WAIT, &mut model).await {
        Ok(Ok(Ok(()))) => {}
        Ok(other) => errors.push(format!("loopback server retirement: {other:?}")),
        Err(error) => {
            errors.push(format!(
                "loopback server UNRESOLVED; aborting test task: {error}"
            ));
            model.abort();
            let _ = model.await;
        }
    }
    if requests.load(Ordering::SeqCst) != 0 {
        errors.push("loopback model received an unexpected request".into());
    }
    if registration.gate.expired.load(Ordering::Acquire) {
        errors.push("submission gate expired".into());
    }
    drop(registration);
    if errors.is_empty() {
        if let Err(error) = std::fs::remove_dir_all(&root) {
            errors.push(format!("settled fixture removal: {error}"));
        }
    }
    anyhow::ensure!(
        errors.is_empty(),
        "cleanup UNRESOLVED; fixture {} retained: {errors:?}; observation={result:?}",
        root.display()
    );
    result
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn heartbeat_stop_fences_and_joins_registered_core_submission() {
    let observation = {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        observe().await
    };
    assert!(
        observation.is_ok(),
        "registered core submission Stop overlap: {observation:#?}"
    );
}
