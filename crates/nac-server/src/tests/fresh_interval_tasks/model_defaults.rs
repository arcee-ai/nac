//! Model inheritance uses the real scheduled preparation adapter, without
//! starting an initial provider request or an elapsed scheduler workload.
use super::*;
use crate::application::task_launches::TaskLaunchApplication;
use nac_core::store::PreparedFreshTaskLaunch;

fn model_configuration(next: bool) -> model_configurations::NewModelConfiguration {
    model_configurations::NewModelConfiguration {
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
        pinned_commit: None,
        default_ref: git_project.then(|| "refs/heads/dev".into()),
        model: explicit.then(|| "gpt-5.1".into()),
        reasoning_effort: explicit.then(|| "low".into()),
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
                assert!(snapshot.orchestrator_compaction_threshold.is_some_and(|threshold| threshold > 1), "absent frozen compaction default must not inherit the new preset's explicit threshold");
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
