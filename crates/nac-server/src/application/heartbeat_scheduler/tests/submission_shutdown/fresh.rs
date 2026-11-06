//! Fresh preparation and initial submission use the real scheduler stop boundary.
use super::*;
use crate::application::{
    session_creation::CreationProjectionGate, task_launches::TaskLaunchApplication,
};
use nac_core::store::{FreshTaskDestination, FreshTaskLaunchReceipt, FreshTaskPreparationPort};

#[derive(Clone, Copy, Debug)]
enum Boundary {
    Preparation,
    Submission,
}

#[derive(Debug, PartialEq)]
struct FreshProjection {
    receipt: FreshTaskLaunchReceipt,
    schedule: store::HeartbeatSchedule,
    history: Vec<HeartbeatOccurrence>,
    inbox: Vec<store::SessionInboxRecord>,
    recovery: Option<store::RunRecoveryRecord>,
    messages: serde_json::Value,
    config_version: i64,
    updated_at: String,
}

async fn fresh_projection(path: &Path, occurrence: &str) -> Result<FreshProjection> {
    let path = path.to_owned();
    let occurrence = occurrence.to_owned();
    store::spawn_blocking_store_caller(move || {
        let prepared = store::read_fresh_heartbeat_launch(&path, &occurrence)?.unwrap();
        let receipt = prepared.receipt().clone();
        let session = &receipt.session_id;
        let snapshot = sessions::load_session(&path, session)?;
        let owner = format!("project:{}", receipt.destination.project_id);
        Ok(FreshProjection {
            schedule: store::read_heartbeat(&path, &owner, &receipt.schedule_id)?,
            history: store::heartbeat_history(&path, &owner, &receipt.schedule_id)?,
            inbox: store::list_session_inbox(&path, session)?,
            recovery: store::load_run_recovery(&path, session)?,
            messages: serde_json::to_value(snapshot.messages)?,
            config_version: snapshot.config_version,
            updated_at: snapshot.updated_at,
            receipt,
        })
    })
    .await?
}

async fn observe_fresh(boundary: Boundary, git: bool) -> Result<()> {
    let root = std::env::temp_dir().join(format!("nac-fresh-stop-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("project"))?;
    let root = std::fs::canonicalize(root)?;
    if git {
        let project = root.join("project");
        std::fs::write(project.join("fixture"), "retained committed source")?;
        for args in [
            vec!["init", "-b", "dev"],
            vec!["add", "fixture"],
            vec![
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-m",
                "seed",
            ],
        ] {
            let output = std::process::Command::new("git")
                .arg("-C")
                .arg(&project)
                .args(args)
                .output()?;
            anyhow::ensure!(
                output.status.success(),
                "fixture Git: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
    }
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home)?;
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )?;
    let _env = ScopedModelEnv::isolated(&home, Some("fresh-stop-fixture-key"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let url = format!("http://{}/v1", listener.local_addr()?);
    let path = root.join("store.db");
    let manager = SessionManager::new_async(ServerOptions {
        root_cwd: root.clone(),
        store_path: Some(path.clone()),
        worker_executable: None,
        managed_host: None,
    })
    .await?;
    let setup_path = path.clone();
    store::spawn_blocking_store_caller(move || {
        store::insert_model_configuration(
            &setup_path,
            "fresh-model",
            store::NewModelConfiguration {
                name: "Fresh Stop fixture".into(),
                backend: "openai-responses".into(),
                model: "gpt-5.2".into(),
                base_url: url,
                allow_insecure_http: false,
                api_key_env: Some("OPENAI_API_KEY".into()),
                reasoning_effort: None,
                extra_headers: BTreeMap::new(),
                orchestrator_compaction_threshold: None,
                initial_prompt: None,
                light_model: None,
            },
        )
        .map_err(anyhow::Error::from)
    })
    .await??;
    let project = manager
        .projects()
        .create(crate::application::projects::CreateProject {
            name: Some("Fresh Stop project".into()),
            description: None,
            cwd: root.join("project"),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: Some("fresh-model".into()),
        })
        .await?;
    let setup_path = path.clone();
    let pending = store::spawn_blocking_store_caller(move || -> Result<_> {
        let destination = FreshTaskDestination {
            project_id: project.project_id.clone(),
            pinned_commit: None,
            default_ref: git.then(|| "refs/heads/dev".into()),
            model: None,
            reasoning_effort: None,
            retained_limit: 2,
        };
        let binding = store::fresh_heartbeat_binding(
            &setup_path,
            &destination,
            None,
            project.cwd.to_str().unwrap(),
        )?;
        let owner = format!("project:{}", project.project_id);
        let created = store::control_heartbeat(
            &setup_path,
            &owner,
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Create {
                spec: HeartbeatSpec {
                    name: "Fresh stop boundary".into(),
                    instructions: "Inspect the local fixture.".into(),
                    skills: Vec::new(),
                    interval_ms: 60_000,
                    end_condition: "Finish this occurrence.".into(),
                    goal_id: None,
                    execution_timeout_ms: 30_000,
                    max_occurrences: 2,
                    token_allowance: None,
                },
            },
            "Create fresh fixture tasks every minute.",
            &binding,
            epoch_ms(),
        )?;
        anyhow::ensure!(created.schedule.session_id.is_none());
        store::control_heartbeat(
            &setup_path,
            &owner,
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::RunNow {
                schedule_id: created.schedule.schedule_id,
                expected_version: created.schedule.version,
            },
            "Run the fixture now.",
            &binding,
            epoch_ms(),
        )?;
        let pending = store::materialize_heartbeats(&setup_path, epoch_ms())?.remove(0);
        anyhow::ensure!(
            pending.session_id.is_none()
                && pending.run_id.is_none()
                && pending.generation.is_none()
        );
        Ok(pending)
    })
    .await??;
    let requests = Arc::new(AtomicUsize::new(0));
    let received = Arc::clone(&requests);
    let (model_stop, stopped) = tokio::sync::oneshot::channel();
    let mut model = tokio::spawn(async move {
        axum::serve(listener, axum::Router::new().route("/v1/responses", axum::routing::post(move || {
            received.fetch_add(1, Ordering::SeqCst);
            async { axum::Json(serde_json::json!({"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":0,"total_tokens":1}})) }
        }))).with_graceful_shutdown(async { let _ = stopped.await; }).await
    });
    let preparation_gate = Arc::new(CreationProjectionGate::default());
    let mut registration = None;
    let mut scheduler = None;
    let mut stop = None;
    let mut connection = None;
    let mut writer = None;
    let mut target = None;
    // Gates, SQLite and every accepted waiter are released below on either result.
    let result: Result<()> = async {
        match boundary {
            Boundary::Preparation => {
                *manager.inner.session_creation_before_projection.lock().unwrap() = Some(preparation_gate.clone());
                scheduler = Some(HeartbeatScheduler::start(&manager));
                tokio::time::timeout(Duration::from_secs(10), preparation_gate.reached.notified()).await?;
                let read_path = path.clone();
                let id = pending.occurrence_id.clone();
                let reserved = store::spawn_blocking_store_caller(move || store::read_fresh_heartbeat_launch(&read_path, &id)).await??.unwrap();
                anyhow::ensure!(reserved.receipt().first_input_id.is_none() && reserved.receipt().initial_run_id.is_none());
                let mut retirement = Box::pin(manager.inner.task_preparations.settle());
                let retired = std::future::poll_fn(|cx| std::task::Poll::Ready(
                    std::future::Future::poll(retirement.as_mut(), cx).is_ready()
                )).await;
                drop(retirement);
                anyhow::ensure!(!retired, "accepted preparation lost its existing lifetime reader");
                let mut stopping = Box::pin(scheduler.take().unwrap().stop());
                // Poll the actual stop to raise its fence before releasing the
                // held publication. No scheduler task scheduling heuristic is used.
                let returned = std::future::poll_fn(|cx| std::task::Poll::Ready(
                    std::future::Future::poll(stopping.as_mut(), cx).is_ready()
                )).await;
                anyhow::ensure!(!returned, "Stop detached accepted preparation");
                stop = Some(tokio::spawn(stopping));
                preparation_gate.resume.notify_one();
                let joined = tokio::time::timeout(Duration::from_secs(10), stop.as_mut().unwrap()).await?;
                stop.take();
                joined?;
                let after = fresh_projection(&path, &pending.occurrence_id).await?;
                anyhow::ensure!(after.receipt.first_input_id.is_some() && after.inbox.len() == 1,
                    "accepted preparation did not finish exact publication: {after:#?}");
                anyhow::ensure!(after.receipt.initial_run_id.is_none() && after.receipt.initial_outcome.is_none()
                    && after.history.len() == 1 && after.history[0].run_id.is_none() && after.history[0].generation.is_none()
                    && after.history[0].inbox_item_id == after.receipt.first_input_id && after.recovery.is_none()
                    && after.schedule.starts == 1 && after.schedule.session_id.is_none()
                    && after.receipt.shared_directory == Some(!git),
                    "Stop advanced initial submission: {after:#?}");
            }
            Boundary::Submission => {
                let read_path = path.clone();
                let id = pending.occurrence_id.clone();
                let reserved = store::spawn_blocking_store_caller(move || store::reserve_fresh_heartbeat_launch(&read_path, &id, pending.revision, epoch_ms())).await??.unwrap();
                let session = reserved.receipt().session_id.clone();
                TaskLaunchApplication::new(&manager).prepare(reserved).await?;
                let service = manager.attach_session(&session).await?;
                target = Some(service.clone());
                registration = Some(Registration::install(&path, &service));
                let gate = &registration.as_ref().unwrap().gate;
                scheduler = Some(HeartbeatScheduler::start(&manager));
                tokio::time::timeout(WAIT, gate.entered.notified()).await?;
                anyhow::ensure!(gate.registered_target_matches.load(Ordering::Acquire), "fresh target was not registered");
                let before = fresh_projection(&path, &pending.occurrence_id).await?;
                anyhow::ensure!(before.receipt.first_input_id.is_some() && before.receipt.initial_run_id.is_none()
                    && before.receipt.initial_outcome.is_none() && before.schedule.starts == 1 && before.schedule.session_id.is_none()
                    && before.history.len() == 1 && before.history[0].session_id.as_deref() == Some(session.as_str())
                    && before.history[0].run_id.is_none() && before.history[0].generation.is_none() && before.inbox.len() == 1
                    && before.recovery.is_none() && !service.has_active_operation(), "invalid fresh submission fixture: {before:#?}");
                let owner = manager.inner._store_ownership.coordinator().unwrap();
                anyhow::ensure!(owner.stats().executing == 0 && owner.stats().queued == 0);
                let snapshot_path = path.clone();
                let mut snapshot = store::spawn_blocking_store_caller(move || sessions::load_session(&snapshot_path, &session)).await??;
                snapshot.session_id = "blocker".into();
                connection = Some(rusqlite::Connection::open(&path)?);
                connection.as_ref().unwrap().execute_batch("BEGIN IMMEDIATE")?;
                let writer_manager = manager.clone();
                writer = Some(tokio::spawn(async move {
                    writer_manager.inner._store_ownership.coordinator().unwrap().create_session(snapshot).await
                }));
                wait_until(|| owner.stats().executing == 1 && owner.stats().queued == 0).await?;
                registration.as_ref().unwrap().release();
                // No test read may compete with this real core admission preflight.
                wait_until(|| owner.stats().executing == 1 && owner.stats().queued == 1).await?;
                stop = Some(tokio::spawn(scheduler.take().unwrap().stop()));
                tokio::time::timeout(WAIT, gate.stopped.notified()).await?;
                {
                    let observation = gate.observation.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
                    anyhow::ensure!(observation.as_ref().is_some_and(|o| o.target_matches && o.error.is_none()),
                        "Stop did not fence actual fresh service: {observation:?}");
                }
                anyhow::ensure!(!stop.as_ref().unwrap().is_finished(), "Stop detached accepted fresh core preflight");
                anyhow::ensure!(owner.stats().executing == 1 && owner.stats().queued == 1);
                connection.take().unwrap().execute_batch("ROLLBACK")?;
                let written = tokio::time::timeout(WAIT, writer.as_mut().unwrap()).await?;
                writer.take(); written??;
                let joined = tokio::time::timeout(WAIT, stop.as_mut().unwrap()).await?;
                stop.take(); joined?;
                let after = fresh_projection(&path, &pending.occurrence_id).await?;
                anyhow::ensure!(before == after, "Stop changed exact fresh admission state: before={before:#?}; after={after:#?}");
                anyhow::ensure!(!service.has_active_operation(), "fresh run admitted after Stop");
            }
        }
        anyhow::ensure!(requests.load(Ordering::SeqCst) == 0, "unexpected loopback model request");
        Ok(())
    }.await;

    preparation_gate.resume.notify_one();
    *manager
        .inner
        .session_creation_before_projection
        .lock()
        .unwrap() = None;
    if let Some(registration) = &registration {
        registration.release();
    }
    let mut errors = Vec::new();
    if let Some(connection) = connection.take() {
        if let Err(error) = connection.execute_batch("ROLLBACK") {
            errors.push(format!("rollback: {error}"));
        }
    }
    if let Some(mut writer) = writer.take() {
        match tokio::time::timeout(Duration::from_secs(5), &mut writer).await {
            Ok(Ok(Ok(()))) => {}
            other => {
                errors.push(format!("writer retirement: {other:?}"));
                writer.abort();
                let _ = writer.await;
            }
        }
    }
    if let Some(scheduler) = scheduler.take() {
        stop = Some(tokio::spawn(scheduler.stop()));
    }
    if let Some(mut stop) = stop.take() {
        match tokio::time::timeout(Duration::from_secs(10), &mut stop).await {
            Ok(Ok(())) => {}
            other => {
                errors.push(format!("scheduler Stop UNRESOLVED: {other:?}"));
                stop.abort();
                let _ = stop.await;
            }
        }
    }
    if let Some(service) = target {
        if let Some(run) = service.active_run() {
            if let Err(error) = service.request_cancel(&run.run_id).await {
                errors.push(format!("unexpected run cancellation: {error:#}"));
            }
        }
    }
    match tokio::time::timeout(Duration::from_secs(10), async {
        manager.stop_local_run_admission().await;
        manager.quiesce_persistence_callers().await;
        manager.drain_persistence().await
    })
    .await
    {
        Ok(Ok(())) => {}
        other => errors.push(format!("manager retirement UNRESOLVED: {other:?}")),
    }
    drop(manager);
    let _ = model_stop.send(());
    match tokio::time::timeout(WAIT, &mut model).await {
        Ok(Ok(Ok(()))) => {}
        other => {
            errors.push(format!("loopback retirement: {other:?}"));
            model.abort();
            let _ = model.await;
        }
    }
    if requests.load(Ordering::SeqCst) != 0 {
        errors.push("unexpected loopback request".into());
    }
    if registration
        .as_ref()
        .is_some_and(|r| r.gate.expired.load(Ordering::Acquire))
    {
        errors.push("submission gate expired".into());
    }
    drop(registration);
    if errors.is_empty() {
        std::fs::remove_dir_all(&root)?;
    }
    anyhow::ensure!(
        errors.is_empty(),
        "cleanup UNRESOLVED; fixture {} retained: {errors:?}; observation={result:?}",
        root.display()
    );
    result
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fresh_scheduler_stop_joins_accepted_preparation_before_initial_submission() {
    let results = {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        let mut results = Vec::new();
        for git in [false, true] {
            results.push((git, observe_fresh(Boundary::Preparation, git).await));
        }
        results
    };
    assert!(
        results.iter().all(|(_, result)| result.is_ok()),
        "fresh accepted preparation outlived Stop: {results:#?}"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fresh_scheduler_stop_fences_and_joins_registered_initial_submission() {
    let result = {
        let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
        observe_fresh(Boundary::Submission, false).await
    };
    assert!(
        result.is_ok(),
        "fresh accepted initial submission outlived Stop: {result:#?}"
    );
}
