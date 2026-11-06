//! Characterizes admitted caller retirement, not the timing of a TCP reset.
use super::*;
use std::{
    collections::HashMap,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Condvar, LazyLock, Mutex, Weak,
    },
};
use tokio::sync::Notify;

// Only this test's unique canonical store path can consume its one-shot gate.
static GATES: LazyLock<Mutex<HashMap<PathBuf, Weak<StoreCallGate>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

struct StoreCallGate {
    entered: Notify,
    completed: Notify,
    released: Mutex<bool>,
    release: Condvar,
    retired: AtomicBool,
    expired: AtomicBool,
}

pub(in crate::application::heartbeat_scheduler) struct StoreCallCompletion(Arc<StoreCallGate>);
impl Drop for StoreCallCompletion {
    fn drop(&mut self) {
        self.0.retired.store(true, Ordering::Release);
        self.0.completed.notify_one();
    }
}

/// Called only inside the real admitted blocking closure, before its store API.
pub(in crate::application::heartbeat_scheduler) fn hold_store_call(
    path: &Path,
) -> Option<StoreCallCompletion> {
    let gate = GATES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .remove(path)?
        .upgrade()?;
    let completion = StoreCallCompletion(Arc::clone(&gate));
    gate.entered.notify_one();
    let released = gate
        .released
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let (released, _) = gate
        .release
        .wait_timeout_while(released, Duration::from_secs(5), |released| !*released)
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if !*released {
        gate.expired.store(true, Ordering::Release);
    }
    Some(completion)
}

struct GateRegistration {
    path: PathBuf,
    gate: Arc<StoreCallGate>,
}
impl GateRegistration {
    fn install(path: &Path) -> Self {
        let gate = Arc::new(StoreCallGate {
            entered: Notify::new(),
            completed: Notify::new(),
            released: Mutex::new(false),
            release: Condvar::new(),
            retired: AtomicBool::new(false),
            expired: AtomicBool::new(false),
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
        *self
            .gate
            .released
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner) = true;
        self.gate.release.notify_all();
    }

    async fn settled(&self) -> bool {
        if self.gate.retired.load(Ordering::Acquire) {
            return true;
        }
        tokio::time::timeout(Duration::from_secs(3), self.gate.completed.notified())
            .await
            .is_ok()
    }
}
impl Drop for GateRegistration {
    fn drop(&mut self) {
        // Synchronous fallback also releases the actual caller on an early error.
        self.release();
        GATES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.path);
    }
}

#[derive(Clone, Copy, Debug)]
enum Boundary {
    Scheduler,
    Serving,
}

#[derive(Debug)]
struct Observation {
    owned: bool,
    boundary: Boundary,
    entered: bool,
    returned_while_held: bool,
    caller_retired: bool,
    owner_retired: bool,
    root_recreated: bool,
    forced_shutdown: bool,
    gate_expired: bool,
    errors: Vec<String>,
}
impl Observation {
    fn satisfied(&self) -> bool {
        self.entered
            && !self.returned_while_held
            && self.caller_retired
            && self.owner_retired
            && !self.root_recreated
            && !self.forced_shutdown
            && !self.gate_expired
            && self.errors.is_empty()
    }
}

async fn retire_manager(manager: SessionManager, errors: &mut Vec<String>) -> bool {
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        manager.stop_local_run_admission().await;
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await
    })
    .await;
    let retired = match result {
        Ok(Ok(())) => true,
        other => {
            errors.push(format!("manager retirement: {other:?}"));
            false
        }
    };
    drop(manager);
    retired
}

async fn observe(owned: bool, boundary: Boundary) -> anyhow::Result<Observation> {
    let root =
        std::env::temp_dir().join(format!("nac-heartbeat-shutdown-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root)?;
    let root = std::fs::canonicalize(root)?;
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let options = ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(root.join("store.db")),
        worker_executable: None,
        managed_host: None,
    };
    let manager = if owned {
        SessionManager::new_async(options).await?
    } else {
        SessionManager::new_unowned_fixture(options)?
    };
    let gate = GateRegistration::install(&manager.inner.store_path);
    let (shutdown, stopped) = tokio::sync::oneshot::channel();
    let forced = Arc::new(AtomicBool::new(false));
    let forced_callback = Arc::clone(&forced);
    let serving_manager = manager.clone();
    // Bind before spawning so a bind failure cannot strand a scheduler task.
    let public = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let control = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let mut task = tokio::spawn(async move {
        match boundary {
            Boundary::Scheduler => {
                drop(public);
                drop(control);
                let scheduler = HeartbeatScheduler::start(&serving_manager);
                let _ = stopped.await;
                serving_manager.inner.task_preparations.stop();
                scheduler.stop().await;
                Ok(())
            }
            Boundary::Serving => {
                let app = axum::Router::new()
                    .route("/alive", axum::routing::get(|| async { "still serving" }));
                crate::delivery::server::serve_router_listener_with_shutdown(
                    public,
                    Some((control, app.clone())),
                    app,
                    serving_manager,
                    async move {
                        let _ = stopped.await;
                    },
                    Duration::from_secs(5),
                    move || forced_callback.store(true, Ordering::Release),
                )
                .await
            }
        }
    });
    let entered = tokio::time::timeout(Duration::from_secs(2), gate.gate.entered.notified())
        .await
        .is_ok();
    let mut errors = Vec::new();
    if shutdown.send(()).is_err() {
        errors.push("shutdown receiver disappeared".into());
    }
    // The barrier establishes the ordering. This bounded observation is not a
    // sleep used to try to win a filesystem race; no reset/traffic is repeated.
    let early = if entered {
        tokio::time::timeout(Duration::from_secs(1), &mut task)
            .await
            .ok()
    } else {
        None
    };
    let returned_while_held = early.is_some();
    let mut manager = Some(manager);
    let mut owner_retired = false;
    let mut root_removed = false;
    if returned_while_held {
        // Exercise the lifetime the stop boundary has claimed is safe to retire.
        // A late caller is released only after this private owner/root is gone.
        if let Some(manager) = manager.take() {
            owner_retired = retire_manager(manager, &mut errors).await;
        }
        if owner_retired {
            match std::fs::remove_dir_all(&root) {
                Ok(()) => root_removed = true,
                Err(error) => {
                    errors.push(format!("root retirement after reported stop: {error}"));
                }
            }
        }
    }
    gate.release();
    let caller_retired = gate.settled().await;
    let mut task_settled = true;
    let mut shutdown_clean = true;
    let result = match early {
        Some(result) => Some(result),
        None => match tokio::time::timeout(Duration::from_secs(5), &mut task).await {
            Ok(result) => Some(result),
            Err(_) => {
                errors.push("shutdown task did not settle after caller release".into());
                shutdown_clean = false;
                task.abort();
                task_settled = tokio::time::timeout(Duration::from_secs(1), &mut task)
                    .await
                    .is_ok();
                None
            }
        },
    };
    if let Some(result) = result {
        if !matches!(result, Ok(Ok(()))) {
            errors.push(format!("shutdown result: {result:?}"));
            shutdown_clean = false;
        }
    }
    let root_recreated = root_removed && root.exists();
    if let Some(manager) = manager.take() {
        owner_retired = retire_manager(manager, &mut errors).await;
    }
    // Release and observe the real caller/task before any assertion can unwind
    // an environment lock. Keep uncertain fixtures rather than deleting live work.
    if caller_retired && task_settled && shutdown_clean && owner_retired {
        if root.exists() {
            if let Err(error) = std::fs::remove_dir_all(&root) {
                errors.push(format!("settled fixture cleanup: {error}"));
            }
        }
        if root.exists() {
            errors.push("root still exists after settled cleanup".into());
        }
    } else {
        errors.push(format!(
            "cleanup UNRESOLVED; fixture retained at {}",
            root.display()
        ));
    }
    Ok(Observation {
        owned,
        boundary,
        entered,
        returned_while_held,
        caller_retired,
        owner_retired,
        root_recreated,
        forced_shutdown: forced.load(Ordering::Acquire),
        gate_expired: gate.gate.expired.load(Ordering::Acquire),
        errors,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn heartbeat_shutdown_joins_accepted_store_callers_before_retiring_store() {
    let results = {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let mut results = Vec::new();
        // ONE family, two ownership variants; each checks the actual scheduler
        // stop and its integration through the real serving shutdown boundary.
        for owned in [false, true] {
            for boundary in [Boundary::Scheduler, Boundary::Serving] {
                results.push(observe(owned, boundary).await);
            }
        }
        results
    };
    // The global environment guard is gone and all controlled callers have been
    // released/awaited before the expected RED can report a panic.
    for observation in results.iter().filter_map(|result| result.as_ref().ok()) {
        eprintln!(
            "HEARTBEAT_SHUTDOWN owned={} boundary={:?}: {observation:?}",
            observation.owned, observation.boundary
        );
    }
    assert!(
        results
            .iter()
            .all(|result| result.as_ref().is_ok_and(Observation::satisfied)),
        "admitted scheduler caller outlived its stop boundary: {results:#?}"
    );
}

#[derive(Debug)]
struct PhaseObservation {
    settled: bool,
    stop_returned_while_read_held: bool,
    cadence: Option<(i64, i64, i64, usize)>,
    errors: Vec<String>,
}

async fn observe_stopped_phase() -> anyhow::Result<PhaseObservation> {
    let root = std::env::temp_dir().join(format!("nac-heartbeat-phase-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root)?;
    let root = std::fs::canonicalize(root)?;
    let _env = ScopedModelEnv::isolated(&root.join("nac-home"), None);
    let path = root.join("store.db");
    // No usable model credential exists even if a broken guard reaches runtime
    // construction. The intended path stops before materialization/attachment.
    let missing_key = format!("NAC_STOP_PHASE_{}", uuid::Uuid::new_v4().simple());
    anyhow::ensure!(std::env::var_os(&missing_key).is_none());
    let mut snapshot = sessions::new_snapshot(
        "chat".into(),
        root.clone(),
        "fixture-model".into(),
        "http://127.0.0.1:1/v1".into(),
        BackendKind::OpenAiResponses,
        None,
        None,
        None,
        Vec::new(),
        Some(missing_key),
        BTreeMap::new(),
    );
    snapshot.behavior = sessions::SessionBehavior::Direct;
    sessions::create_session(&path, &snapshot)?;
    let mut binding = store::heartbeat_binding(&path, "chat")?;
    binding.execution_cwd = Some(root.to_string_lossy().into_owned());
    let before = store::control_heartbeat(
        &path,
        "chat",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create {
            spec: HeartbeatSpec {
                name: "Due stop fence".into(),
                instructions: "Observe the local fixture.".into(),
                skills: Vec::new(),
                cadence: nac_core::store::HeartbeatCadence::Interval {
                    interval_ms: 60_000,
                },
                end_condition: "Stop after the fixture.".into(),
                goal_id: None,
                execution_timeout_ms: 30_000,
                max_occurrences: 2,
                token_allowance: None,
            },
        },
        "Check the fixture every minute.",
        &binding,
        epoch_ms() - 120_000,
    )?
    .schedule;
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .await?;
    let gate = GateRegistration::install(&manager.inner.store_path);
    let scheduler = HeartbeatScheduler::start(&manager);
    let entered = tokio::time::timeout(Duration::from_secs(2), gate.gate.entered.notified())
        .await
        .is_ok();
    let mut stop = Box::pin(scheduler.stop());
    // Poll the actual stop once before releasing the accepted read. This raises
    // the scheduler's own fence without stopping TaskPreparations for it.
    let immediate = std::future::poll_fn(|cx| {
        std::task::Poll::Ready(matches!(
            std::future::Future::poll(stop.as_mut(), cx),
            std::task::Poll::Ready(())
        ))
    })
    .await;
    gate.release();
    let caller_retired = gate.settled().await;
    let stopped = immediate
        || tokio::time::timeout(Duration::from_secs(5), stop.as_mut())
            .await
            .is_ok();
    drop(stop);
    let mut errors = Vec::new();
    let mut cadence = None;
    if entered && caller_retired && stopped {
        let schedule_id = before.schedule_id.clone();
        let read_path = path.clone();
        let result = store::spawn_blocking_store_caller(move || -> Result<_> {
            Ok((
                store::read_heartbeat(&read_path, "chat", &schedule_id)?,
                store::heartbeat_history(&read_path, "chat", &schedule_id)?,
            ))
        })
        .await;
        match result {
            Ok(Ok((after, history))) => {
                cadence = Some((
                    before.next_due_ms,
                    after.next_due_ms,
                    after.starts,
                    history.len(),
                ));
            }
            other => errors.push(format!("phase observation: {other:?}")),
        }
    } else {
        errors.push("held phase or scheduler cleanup UNRESOLVED".into());
    }
    if gate.gate.expired.load(Ordering::Acquire) {
        errors.push("phase gate expired".into());
    }
    let owner_retired = retire_manager(manager, &mut errors).await;
    if caller_retired && stopped && owner_retired {
        if let Err(error) = std::fs::remove_dir_all(&root) {
            errors.push(format!("settled phase cleanup: {error}"));
        }
    } else {
        errors.push(format!("phase fixture retained at {}", root.display()));
    }
    Ok(PhaseObservation {
        settled: entered && caller_retired && stopped && owner_retired,
        stop_returned_while_read_held: immediate,
        cadence,
        errors,
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn heartbeat_stop_does_not_materialize_or_admit_a_later_phase() {
    let observation = {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        observe_stopped_phase().await
    };
    assert!(
        matches!(
            &observation,
            Ok(PhaseObservation {
                settled: true,
                stop_returned_while_read_held: false,
                cadence: Some((before, after, 0, 0)),
                errors,
            })
                if before == after && errors.is_empty()
        ),
        "stopping scan advanced the next due phase: {observation:#?}"
    );
}
