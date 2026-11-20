//! Model selection uses the real scheduled preparation adapter, without
//! starting an initial provider request or an elapsed scheduler workload.
use super::*;
use crate::application::task_launches::TaskLaunchApplication;
use nac_core::store::PreparedFreshTaskLaunch;

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
        manager
            .projects()
            .create(application::projects::CreateProject {
                name: None,
                description: None,
                cwd: root.join("plain"),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
            })
            .await
            .unwrap()
            .project_id
    };
    let cwd = nac_core::projects::load_project_launch_context(&manager.inner.store_path, &project)
        .unwrap()
        .project
        .cwd
        .canonicalize()
        .unwrap();
    let destination = FreshTaskDestination {
        project_id: project.clone(),
        model_selection: Some(store::TaskModelSelection {
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
            compaction_threshold: None,
        }),
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
        "Create model-selection fixture tasks.",
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
async fn frozen_model_choices_survive_replay_for_git_and_shared_tasks() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for git_project in [false, true] {
        for explicit in [false, true] {
            let root = temp_root("fresh_frozen_model_selection")
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
                let source_before = git_project.then(|| {
                    (
                        git(&root.join("repo"), &["rev-parse", "HEAD"]),
                        std::fs::read(root.join("repo/.git/index")).unwrap(),
                        git(&root.join("repo"), &["status", "--porcelain=v1"]),
                    )
                });
                TaskLaunchApplication::new(&manager)
                    .prepare(prepared.clone())
                    .await
                    .unwrap();
                let snapshot =
                    sessions::load_session(&manager.inner.store_path, &original.session_id)
                        .unwrap();
                assert_eq!(snapshot.model, if explicit { "gpt-5.1" } else { "gpt-5.2" });
                assert_eq!(
                    snapshot.reasoning_effort,
                    Some(if explicit {
                        nac_core::model::ReasoningEffort::Low
                    } else {
                        nac_core::model::ReasoningEffort::High
                    })
                );
                assert_eq!(snapshot.base_url, "http://127.0.0.1:9/v1");
                assert_eq!(snapshot.api_key_env.as_deref(), Some("OPENAI_API_KEY"));
                assert_eq!(
                    snapshot
                        .extra_headers
                        .get("X-Fixture-Model")
                        .map(String::as_str),
                    Some("original")
                );
                assert_eq!(snapshot.behavior, sessions::SessionBehavior::Direct);
                let published = store::read_fresh_heartbeat_launch(
                    &manager.inner.store_path,
                    &original.occurrence_id,
                )
                .unwrap()
                .unwrap();
                assert_eq!(published.receipt().session_id, original.session_id);
                assert_eq!(published.receipt().request, original.request);
                assert_eq!(published.receipt().shared_directory, Some(!git_project));
                assert!(published.receipt().first_input_id.is_some());
                assert!(published.receipt().initial_run_id.is_none());
                TaskLaunchApplication::new(&manager)
                    .prepare(published)
                    .await
                    .unwrap();
                assert_eq!(
                    sessions::list_sessions(&manager.inner.store_path)
                        .unwrap()
                        .len(),
                    1
                );
                assert_eq!(
                    store::list_session_inbox(&manager.inner.store_path, &original.session_id)
                        .unwrap()
                        .len(),
                    1
                );
                if let Some(source_before) = source_before {
                    assert_eq!(
                        (
                            git(&root.join("repo"), &["rev-parse", "HEAD"]),
                            std::fs::read(root.join("repo/.git/index")).unwrap(),
                            git(&root.join("repo"), &["status", "--porcelain=v1"])
                        ),
                        source_before
                    );
                    let launch = store::load_task_launch(
                        &manager.inner.store_path,
                        &original.request.request_id,
                    )
                    .unwrap()
                    .unwrap();
                    assert_eq!(launch.source.commit, source_before.0);
                    assert_eq!(
                        std::fs::read_to_string(launch.workspace_path.join("nested/file")).unwrap(),
                        "committed"
                    );
                }
            })
            .await;
            retire(manager).await;
            if let Err(panic) = primary {
                std::panic::resume_unwind(panic);
            }
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn frozen_model_choices_do_not_bypass_current_policy_or_credential_readiness() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    for failure in ["deny", "ask", "credential"] {
        let root = temp_root("fresh_model_selection_denied")
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
