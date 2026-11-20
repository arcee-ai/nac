//! Model inheritance uses the real scheduled preparation adapter, without
//! starting an initial provider request or an elapsed scheduler workload.
use super::*;
use crate::application::task_launches::TaskLaunchApplication;
use nac_core::store::PreparedFreshTaskLaunch;

fn model_configuration(next: bool) -> model_configurations::NewModelConfiguration {
    model_configurations::NewModelConfiguration {
        service_tier: None,
        name: if next { "Next" } else { "Original" }.into(),
        backend: "openai-responses".into(),
        model: "gpt-5.2".into(),
        base_url: if next {
            "http://127.0.0.1:19/v1"
        } else {
            "http://127.0.0.1:9/v1"
        }
        .into(),
        allow_insecure_http: false,
        api_key_env: Some("OPENAI_API_KEY".into()),
        reasoning_effort: Some(if next { "low" } else { "high" }.into()),
        extra_headers: BTreeMap::from([(
            "X-Fixture-Model".into(),
            if next { "next" } else { "original" }.into(),
        )]),
        orchestrator_compaction_threshold: next.then_some(1),
        initial_prompt: None,
        light_model: None,
    }
}

fn select(manager: &SessionManager, project: &str, next: bool) {
    manager
        .projects()
        .update(
            project,
            application::projects::UpdateProject {
                name: application::Field::Unchanged,
                description: application::Field::Unchanged,
                default_model_config_id: application::Field::Set(
                    if next { "next-config" } else { "task-config" }.into(),
                ),
                pinned: application::Field::Unchanged,
            },
        )
        .unwrap();
}

async fn reservation(
    root: &std::path::Path,
    manager: &SessionManager,
    git_project: bool,
    explicit: bool,
    missing_credential: bool,
) -> PreparedFreshTaskLaunch {
    let project = if git_project {
        task_launches::fixture(root, manager).await.project_id
    } else {
        std::fs::create_dir_all(root.join("plain")).unwrap();
        model_configurations::insert_model_configuration(
            &manager.inner.store_path,
            "task-config",
            model_configuration(false),
        )
        .unwrap();
        manager
            .projects()
            .create(application::projects::CreateProject {
                name: None,
                description: None,
                cwd: root.join("plain"),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: Some("task-config".into()),
            })
            .await
            .unwrap()
            .project_id
    };
    let mut original = model_configuration(false);
    if missing_credential {
        original.api_key_env = Some("NAC_TEST_FRESH_MISSING_CREDENTIAL".into());
        assert!(std::env::var_os("NAC_TEST_FRESH_MISSING_CREDENTIAL").is_none());
    }
    model_configurations::update_model_configuration(
        &manager.inner.store_path,
        "task-config",
        original,
    )
    .unwrap();
    model_configurations::insert_model_configuration(
        &manager.inner.store_path,
        "next-config",
        model_configuration(true),
    )
    .unwrap();
    let cwd = nac_core::projects::load_project_launch_context(&manager.inner.store_path, &project)
        .unwrap()
        .project
        .cwd
        .canonicalize()
        .unwrap();
    let destination = FreshTaskDestination {
        project_id: project.clone(),
        model_selection: Some(store::TaskModelSelection {
            service_tier: None,
            backend: "openai-responses".into(),
            model: if explicit { "gpt-5.1" } else { "gpt-5.2" }.into(),
            base_url: "http://127.0.0.1:9/v1".into(),
            allow_insecure_http: false,
            api_key_env: Some(
                if missing_credential {
                    "NAC_TEST_FRESH_MISSING_CREDENTIAL"
                } else {
                    "OPENAI_API_KEY"
                }
                .into(),
            ),
            reasoning_effort: Some(if explicit { "low" } else { "high" }.into()),
            extra_headers: Some(BTreeMap::from([(
                "X-Fixture-Model".into(),
                "original".into(),
            )])),
            orchestrator_compaction_threshold: None,
        }),
        pinned_commit: None,
        default_ref: git_project.then(|| "refs/heads/dev".into()),
        model: explicit.then(|| "gpt-5.1".into()),
        reasoning_effort: explicit.then(|| "low".into()),
        service_tier: None,
        retained_limit: 2,
    };
    let binding = store::fresh_heartbeat_binding(
        &manager.inner.store_path,
        &destination,
        None,
        cwd.to_str().unwrap(),
    )
    .unwrap();
    let schedule = store::control_heartbeat(
        &manager.inner.store_path,
        &format!("project:{project}"),
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create {
            spec: specification(),
        },
        "Create model-inheritance fixture tasks.",
        &binding,
        1_000,
    )
    .unwrap()
    .schedule;
    let pending = store::materialize_heartbeats(&manager.inner.store_path, 61_000)
        .unwrap()
        .into_iter()
        .find(|pending| pending.schedule_id == schedule.schedule_id)
        .unwrap();
    store::reserve_fresh_heartbeat_launch(
        &manager.inner.store_path,
        &pending.occurrence_id,
        pending.revision,
        61_000,
    )
    .unwrap()
    .unwrap()
}

async fn retire(manager: SessionManager) {
    manager.stop_local_run_admission().await;
    manager.quiesce_persistence_callers().await;
    manager.drain_persistence().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn frozen_model_defaults_and_explicit_choices_survive_project_changes_for_git_and_shared_tasks(
) {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for git_project in [false, true] {
        for explicit in [false, true] {
            let root = temp_root("fresh_frozen_model_defaults")
                .canonicalize()
                .unwrap();
            let home = root.join("nac-home");
            std::fs::create_dir_all(&home).unwrap();
            std::fs::write(
                home.join("config.toml"),
                "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
            )
            .unwrap();
            let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
            let manager = test_manager(&root);
            let primary = catch_fixture_panic(async {
                let prepared = reservation(&root, &manager, git_project, explicit, false).await;
                let original = prepared.receipt().clone();
                select(&manager, &original.destination.project_id, true);
                let source_before = git_project.then(|| (
                    git(&root.join("repo"), &["rev-parse", "HEAD"]),
                    std::fs::read(root.join("repo/.git/index")).unwrap(),
                    git(&root.join("repo"), &["status", "--porcelain=v1"]),
                ));
                TaskLaunchApplication::new(&manager).prepare(prepared.clone()).await.unwrap();
                let snapshot = sessions::load_session(&manager.inner.store_path, &original.session_id).unwrap();
                assert_eq!(snapshot.model, if explicit { "gpt-5.1" } else { "gpt-5.2" });
                assert_eq!(snapshot.reasoning_effort, Some(if explicit { nac_core::model::ReasoningEffort::Low } else { nac_core::model::ReasoningEffort::High }));
                assert_eq!(snapshot.base_url, "http://127.0.0.1:9/v1");
                assert_eq!(snapshot.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
                assert_eq!(snapshot.extra_headers.get("X-Fixture-Model").map(String::as_str), Some("original"));
                assert_ne!(snapshot.orchestrator_compaction_threshold, Some(1), "absent selected threshold must not inherit the new preset's explicit threshold");
                assert_eq!(snapshot.behavior, sessions::SessionBehavior::Direct);
                let published = store::read_fresh_heartbeat_launch(&manager.inner.store_path, &original.occurrence_id).unwrap().unwrap();
                assert_eq!(published.model_defaults(), prepared.model_defaults());
                assert_eq!(published.receipt().session_id, original.session_id);
                assert_eq!(published.receipt().request, original.request);
                assert_eq!(published.receipt().shared_directory, Some(!git_project));
                assert!(published.receipt().first_input_id.is_some());
                assert!(published.receipt().initial_run_id.is_none());
                TaskLaunchApplication::new(&manager).prepare(published).await.unwrap();
                assert_eq!(sessions::list_sessions(&manager.inner.store_path).unwrap().len(), 1);
                assert_eq!(store::list_session_inbox(&manager.inner.store_path, &original.session_id).unwrap().len(), 1);
                if let Some(source_before) = source_before {
                    assert_eq!((git(&root.join("repo"), &["rev-parse", "HEAD"]), std::fs::read(root.join("repo/.git/index")).unwrap(), git(&root.join("repo"), &["status", "--porcelain=v1"])), source_before);
                    let launch = store::load_task_launch(&manager.inner.store_path, &original.request.request_id).unwrap().unwrap();
                    assert_eq!(launch.source.commit, source_before.0);
                    assert_eq!(std::fs::read_to_string(launch.workspace_path.join("nested/file")).unwrap(), "committed");
                }
            }).await;
            retire(manager).await;
            if let Err(panic) = primary {
                std::panic::resume_unwind(panic);
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn changed_project_defaults_do_not_bypass_current_policy_or_frozen_credential_readiness() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for failure in ["deny", "ask", "credential"] {
        let root = temp_root("fresh_model_defaults_denied")
            .canonicalize()
            .unwrap();
        let home = root.join("nac-home");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("config.toml"),
            "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
        )
        .unwrap();
        let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
        let manager = test_manager(&root);
        let primary = catch_fixture_panic(async {
            let prepared = reservation(&root, &manager, false, false, failure == "credential").await;
            let original = prepared.receipt().clone();
            select(&manager, &original.destination.project_id, true);
            if failure != "credential" {
                std::fs::write(home.join("config.toml"), format!("[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n[[permissions.rules]]\naction='heartbeat_run'\nresource='project:{}'\neffect='{failure}'\n", original.destination.project_id)).unwrap();
            }
            let error = TaskLaunchApplication::new(&manager).prepare(prepared.clone()).await.unwrap_err();
            if failure == "credential" {
                assert!(format!("{error:#}").contains("NAC_TEST_FRESH_MISSING_CREDENTIAL"), "{error:#}");
            } else {
                assert!(error.is::<nac_core::permissions::ScheduledProjectAdmissionRequired>(), "{error:#}");
            }
            assert!(sessions::list_sessions(&manager.inner.store_path).unwrap().is_empty());
            let retained = store::read_fresh_heartbeat_launch(&manager.inner.store_path, &original.occurrence_id).unwrap().unwrap();
            let mut expected = original;
            // Policy blocks before workspace selection; credential readiness
            // blocks later, after the existing adapter pins shared mode.
            if failure == "credential" {
                expected.shared_directory = Some(true);
            }
            assert_eq!(retained.receipt(), &expected);
            assert_eq!(retained.model_defaults(), prepared.model_defaults());
        }).await;
        retire(manager).await;
        if let Err(panic) = primary {
            std::panic::resume_unwind(panic);
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn legacy_reserved_task_without_selection_cannot_launch() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for git_project in [false, true] {
        let root = temp_root("legacy_fresh_reservation")
            .canonicalize()
            .unwrap();
        let home = root.join("nac-home");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("config.toml"),
            "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
        )
        .unwrap();
        let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
        let manager = test_manager(&root);
        let primary = catch_fixture_panic(async {
            let prepared = reservation(&root, &manager, git_project, false, false).await;
            let occurrence = prepared.receipt().occurrence_id.clone();
            let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
            conn.execute("UPDATE heartbeat_task_launches SET launch_json=json_remove(launch_json, '$.receipt.destination.model_selection', '$.receipt.request.model_selection') WHERE occurrence_id=?1", [&occurrence]).unwrap();
            drop(conn);
            let legacy = store::read_fresh_heartbeat_launch(&manager.inner.store_path, &occurrence).unwrap().unwrap();
            let before = legacy.receipt().clone();
            let worktrees = git_project.then(|| git(&root.join("repo"), &["worktree", "list", "--porcelain"]));
            let error = TaskLaunchApplication::new(&manager).prepare(legacy).await.unwrap_err();
            assert!(format!("{error:#}").contains("predates explicit model selection"), "{error:#}");
            assert!(sessions::list_sessions(&manager.inner.store_path).unwrap().is_empty());
            let retained = store::read_fresh_heartbeat_launch(&manager.inner.store_path, &occurrence).unwrap().unwrap();
            assert_eq!(retained.receipt(), &before);
            assert!(store::load_task_launch(&manager.inner.store_path, &before.request.request_id).unwrap().is_none());
            if let Some(worktrees) = worktrees {
                assert_eq!(git(&root.join("repo"), &["worktree", "list", "--porcelain"]), worktrees);
            }
        }).await;
        retire(manager).await;
        if let Err(panic) = primary {
            std::panic::resume_unwind(panic);
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn predecessor_schedule_receipts_replay_before_model_requirement() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("legacy_schedule_model_retry")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let db = rusqlite::Connection::open(root.join("store.db")).unwrap();
    // Generated by the landed v53 writer, including a task, Create and two Edits.
    db.execute_batch(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../nac-core/src/store/schema/fixtures/v53-legacy-schedule-replay.sql"
    )))
    .unwrap();
    db.execute(
        "UPDATE projects SET cwd=?1 WHERE project_id='project'",
        [root.to_str().unwrap()],
    )
    .unwrap();
    drop(db);
    let manager = test_manager(&root);
    let scope = "project:project";
    let create_id = "11111111-1111-4111-8111-111111111111";
    let edit_id = "22222222-2222-4222-8222-222222222222";
    let omit_id = "33333333-3333-4333-8333-333333333333";
    let original =
        store::read_heartbeat_command_receipt(&manager.inner.store_path, scope, create_id)
            .unwrap()
            .unwrap();
    let edited = store::read_heartbeat_command_receipt(&manager.inner.store_path, scope, edit_id)
        .unwrap()
        .unwrap();
    let omitted = store::read_heartbeat_command_receipt(&manager.inner.store_path, scope, omit_id)
        .unwrap()
        .unwrap();
    let destination = original.schedule.binding.fresh_task.clone().unwrap();
    let changed = edited.schedule.binding.fresh_task.clone().unwrap();
    assert!(destination.model_selection.is_none());
    assert_ne!(destination, changed);
    let service =
        crate::application::fresh_task_schedules::FreshTaskScheduleApplication::new(&manager);
    let create = HeartbeatAction::Create {
        spec: original.schedule.spec.clone(),
    };
    let create_replay = service
        .control(
            "project".into(),
            create_id.into(),
            create.clone(),
            Some(destination.clone()),
            None,
        )
        .await
        .unwrap();
    assert_eq!(create_replay, original);
    let edit = HeartbeatAction::Edit {
        schedule_id: original.schedule.schedule_id.clone(),
        expected_version: original.schedule.version,
        spec: edited.schedule.spec.clone(),
    };
    let exact = service
        .control(
            "project".into(),
            edit_id.into(),
            edit.clone(),
            Some(changed.clone()),
            None,
        )
        .await
        .unwrap();
    assert_eq!(exact, edited);
    let conflict = service
        .control("project".into(), edit_id.into(), edit, None, None)
        .await
        .unwrap_err();
    assert!(format!("{conflict:#}").contains("conflicts"));
    let no_change = HeartbeatAction::Edit {
        schedule_id: edited.schedule.schedule_id.clone(),
        expected_version: edited.schedule.version,
        spec: omitted.schedule.spec.clone(),
    };
    let replay = service
        .control("project".into(), omit_id.into(), no_change, None, None)
        .await
        .unwrap();
    assert_eq!(replay, omitted);
    let changed_action = HeartbeatAction::Create {
        spec: edited.schedule.spec.clone(),
    };
    let mut other_destination = destination.clone();
    other_destination.retained_limit += 1;
    let mismatch = service
        .control(
            "project".into(),
            create_id.into(),
            changed_action,
            Some(other_destination),
            None,
        )
        .await
        .unwrap_err();
    assert!(format!("{mismatch:#}").contains("conflicts"));
    let fresh = service
        .control(
            "project".into(),
            uuid::Uuid::new_v4().to_string(),
            create,
            Some(destination),
            None,
        )
        .await
        .unwrap_err();
    assert!(format!("{fresh:#}").contains("select a model"));
    let task_id = "44444444-4444-4444-8444-444444444444";
    let task = store::load_task_launch(&manager.inner.store_path, task_id)
        .unwrap()
        .unwrap();
    assert!(task.request.model_selection.is_none());
    let app = router(manager.clone());
    let response = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&task.request).unwrap(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let replayed: store::TaskLaunchRecord =
        serde_json::from_slice(&response_body(response).await).unwrap();
    assert_eq!(replayed.session_id, task.session_id);
    assert_eq!(replayed.phase, task.phase);
    let mut altered = task.request.clone();
    altered.prompt.push('!');
    let conflict = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&altered).unwrap(),
    )
    .await;
    assert_eq!(conflict.status(), StatusCode::CONFLICT);
    altered.request_id = uuid::Uuid::new_v4().to_string();
    let fresh = post_json(
        app.clone(),
        "/task-launches",
        serde_json::to_value(&altered).unwrap(),
    )
    .await;
    assert_eq!(fresh.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        store::list_task_launches(&manager.inner.store_path, "project")
            .unwrap()
            .len(),
        1
    );
    drop(app);
    // Conflicting retained evidence is unknown, rather than an inferred binding.
    let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    conn.execute("INSERT INTO heartbeat_commands(session_id,request_id,canonical_digest,schedule_id,response_json,created_at_ms) SELECT session_id,'55555555-5555-4555-8555-555555555555',canonical_digest,schedule_id,json_set(response_json,'$.schedule.binding.fresh_task.retained_limit',99),created_at_ms FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2", (scope, create_id)).unwrap();
    drop(conn);
    let evidence = store::read_heartbeat_destination_at_version(
        &manager.inner.store_path,
        scope,
        &original.schedule.schedule_id,
        original.schedule.version,
    )
    .unwrap_err();
    assert!(format!("{evidence:#}").contains("conflicting historical fresh destinations"));
    let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    conn.execute("DELETE FROM heartbeat_commands WHERE session_id=?1 AND request_id='55555555-5555-4555-8555-555555555555'", [scope]).unwrap();
    // Missing pre-edit history cannot justify reconstructing an omitted input.
    conn.execute(
        "DELETE FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2",
        (scope, create_id),
    )
    .unwrap();
    drop(conn);
    let edit_without_history = HeartbeatAction::Edit {
        schedule_id: original.schedule.schedule_id.clone(),
        expected_version: original.schedule.version,
        spec: edited.schedule.spec.clone(),
    };
    let missing = service
        .control(
            "project".into(),
            edit_id.into(),
            edit_without_history,
            None,
            None,
        )
        .await
        .unwrap_err();
    assert!(format!("{missing:#}").contains("original schedule destination is unavailable"));
    drop(service);
    retire(manager).await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn predecessor_resume_and_run_now_replay_without_destination_or_new_work() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("legacy_resume_run_retry")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let db = rusqlite::Connection::open(root.join("store.db")).unwrap();
    db.execute_batch(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../nac-core/src/store/schema/fixtures/v53-legacy-resume-run.sql"
    )))
    .unwrap();
    db.execute(
        "UPDATE projects SET cwd=?1 WHERE project_id='project'",
        [root.to_str().unwrap()],
    )
    .unwrap();
    drop(db);
    let manager = test_manager(&root);
    let scope = "project:project";
    let resume_id = "66666666-6666-4666-8666-666666666666";
    let run_id = "77777777-7777-4777-8777-777777777777";
    let resumed =
        store::read_heartbeat_command_receipt(&manager.inner.store_path, scope, resume_id)
            .unwrap()
            .unwrap();
    let ran = store::read_heartbeat_command_receipt(&manager.inner.store_path, scope, run_id)
        .unwrap()
        .unwrap();
    let schedule_id = resumed.schedule.schedule_id.clone();
    let current = store::read_heartbeat(&manager.inner.store_path, scope, &schedule_id).unwrap();
    assert_eq!(current.state, store::HeartbeatState::Stopped);
    let before = store::heartbeat_history(&manager.inner.store_path, scope, &schedule_id).unwrap();
    let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let evidence: (i64, String, String) = conn.query_row("SELECT (SELECT count(*) FROM heartbeat_commands WHERE session_id=?1), (SELECT response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2), (SELECT response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?3)", (scope, resume_id, run_id), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
    drop(conn);
    let service =
        crate::application::fresh_task_schedules::FreshTaskScheduleApplication::new(&manager);
    let resume = HeartbeatAction::Resume {
        schedule_id: schedule_id.clone(),
        expected_version: resumed.schedule.version - 1,
    };
    let run = HeartbeatAction::RunNow {
        schedule_id: schedule_id.clone(),
        expected_version: ran.schedule.version,
    };
    let replay = service
        .control(
            "project".into(),
            resume_id.into(),
            resume.clone(),
            None,
            None,
        )
        .await
        .unwrap();
    assert_eq!(replay, resumed);
    let replay = service
        .control("project".into(), run_id.into(), run.clone(), None, None)
        .await
        .unwrap();
    assert_eq!(replay, ran);
    let conflict = service
        .control("project".into(), run_id.into(), resume, None, None)
        .await
        .unwrap_err();
    assert!(format!("{conflict:#}").contains("conflicts"));
    let fresh = service
        .control(
            "project".into(),
            uuid::Uuid::new_v4().to_string(),
            run,
            None,
            None,
        )
        .await
        .unwrap_err();
    assert!(format!("{fresh:#}").contains("select a model"));
    assert_eq!(
        store::heartbeat_history(&manager.inner.store_path, scope, &schedule_id).unwrap(),
        before
    );
    assert_eq!(
        store::read_heartbeat(&manager.inner.store_path, scope, &schedule_id).unwrap(),
        current
    );
    let conn = rusqlite::Connection::open(&manager.inner.store_path).unwrap();
    let after: (i64, String, String) = conn.query_row("SELECT (SELECT count(*) FROM heartbeat_commands WHERE session_id=?1), (SELECT response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?2), (SELECT response_json FROM heartbeat_commands WHERE session_id=?1 AND request_id=?3)", (scope, resume_id, run_id), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).unwrap();
    assert_eq!(after, evidence);
    drop(conn);
    drop(service);
    retire(manager).await;
    std::fs::remove_dir_all(root).unwrap();
}
