//! Local scripted-provider qualification of the real prepared launch and run
//! transaction. This is an isolated fixture, not vendor or remote parity proof.
#[path = "fresh_interval_tasks/model_defaults.rs"]
mod model_defaults;
#[path = "fresh_interval_tasks/recovery.rs"]
mod recovery;

use super::*;
use anyhow::Context;
use nac_core::store::{
    self, FreshTaskDestination, FreshTaskPreparationPort, HeartbeatAction, HeartbeatOutcome,
    HeartbeatSpec,
};

fn git(repo: &std::path::Path, args: &[&str]) -> String {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

async fn provider(
    path: PathBuf,
) -> (
    String,
    Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
    tokio::task::JoinHandle<()>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let journal = requests.clone();
    let task = tokio::spawn(async move {
        let handler = move |axum::Json(body): axum::Json<serde_json::Value>| {
            let path = path.clone();
            let journal = journal.clone();
            async move {
                journal.lock().unwrap().push(body.clone());
                let active = store::spawn_blocking_store_caller(move || {
                    store::active_heartbeat_occurrences(&path)
                })
                .await
                .unwrap()
                .unwrap()
                .into_iter()
                .find(|occurrence| {
                    occurrence.run_id.is_some() && occurrence.provisional_outcome.is_none()
                });
                let item = if let Some(active) = active {
                    serde_json::json!({"id":"fc-fixture","type":"function_call","status":"completed","call_id":"fixture-report","name":"report_heartbeat","arguments":serde_json::json!({"occurrence_id":active.occurrence_id,"generation":active.generation.unwrap(),"expected_revision":active.revision,"outcome":"unchanged","evidence":"Isolated fixture completed without changes."}).to_string()})
                } else {
                    serde_json::json!({"id":"msg-fixture","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"Fixture complete.","annotations":[]}]})
                };
                let envelope = serde_json::json!({"id":"resp-fixture","object":"response","status":"completed","model":"gpt-5.2","output":[item.clone()],"usage":{"input_tokens":7,"output_tokens":3,"total_tokens":10}});
                if body["stream"] == true {
                    axum::response::IntoResponse::into_response((
                        [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                        format!(
                            "data: {}\n\ndata: {}\n\n",
                            serde_json::json!({"type":"response.output_item.done","output_index":0,"item":item}),
                            serde_json::json!({"type":"response.completed","response":envelope})
                        ),
                    ))
                } else {
                    axum::response::IntoResponse::into_response(axum::Json(envelope))
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
    (url, requests, task)
}

async fn settled(
    manager: &SessionManager,
    occurrence: &str,
) -> anyhow::Result<store::FreshTaskLaunchReceipt> {
    tokio::time::timeout(Duration::from_secs(45), async {
        loop {
            let path = manager.inner.store_path.clone();
            let id = occurrence.to_owned();
            let prepared = store::spawn_blocking_store_caller(move || {
                store::read_fresh_heartbeat_launch(&path, &id)
            })
            .await
            .context("scheduled receipt store caller failed to join")??;
            // start() spawns the scheduler; a passive read may precede its
            // reservation. Only absence is pending; store/join errors fail.
            if let Some(prepared) = prepared {
                if prepared.receipt().initial_outcome.is_some() {
                    return Ok(prepared.receipt().clone());
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .context("scheduled fixture did not reach an exact initial outcome within 45 seconds")?
}

// Keep the original assertion panic while letting async fixture cleanup run.
// A panicked future is dropped here and is never polled again.
async fn catch_fixture_panic<F: std::future::Future>(future: F) -> std::thread::Result<F::Output> {
    let mut future = std::pin::pin!(future);
    std::future::poll_fn(|cx| {
        match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            std::future::Future::poll(future.as_mut(), cx)
        })) {
            Ok(poll) => poll.map(Ok),
            Err(panic) => std::task::Poll::Ready(Err(panic)),
        }
    })
    .await
}

fn specification() -> HeartbeatSpec {
    HeartbeatSpec {
        name: "Fresh fixture".into(),
        instructions: "Inspect the isolated fixture without changing files.".into(),
        skills: Vec::new(),
        cadence: nac_core::store::HeartbeatCadence::Interval {
            interval_ms: 60_000,
        },
        end_condition: "Complete this occurrence after inspection; retain the schedule.".into(),
        goal_id: None,
        execution_timeout_ms: 30_000,
        max_occurrences: 10,
        token_allowance: None,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_interval_git_preparation_initial_input_and_retained_result_use_existing_owners() {
    let _lock = SERVER_MODEL_ENV_LOCK.lock().unwrap();
    let root = std::fs::canonicalize(temp_root("fresh_interval_git")).unwrap();
    let home = root.join("nac-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
    )
    .unwrap();
    let _env = ScopedModelEnv::isolated(&home, Some("fixture-key"));
    let manager = test_manager(&root);
    let launch = task_launches::fixture(&root, &manager).await;
    let (url, requests, model) = provider(manager.inner.store_path.clone()).await;
    let mut scheduler = None;
    let primary = catch_fixture_panic(async {
        let mut defaults = model_configurations::load_model_configuration(
            &manager.inner.store_path,
            "task-config",
        )
        .unwrap();
        defaults.base_url = url;
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
        let repo = root.join("repo");
        let cwd = repo.join("nested");
        let skill = repo.join(".agents/skills/verification");
        std::fs::create_dir_all(&skill).unwrap();
        std::fs::write(skill.join("SKILL.md"), "---\nname: verification\ndescription: Inspect the fixture.\n---\nFRESH_SKILL_TOKEN: inspect the committed seed and retain evidence.\n").unwrap();
        git(&repo, &["add", ".agents"]);
        git(&repo, &["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "skill fixture"]);
        std::fs::write(cwd.join("file"), "staged source").unwrap();
        git(&repo, &["add", "nested/file"]);
        std::fs::write(cwd.join("file"), "dirty source").unwrap();
        std::fs::write(cwd.join("untracked"), "untracked source").unwrap();
        let source_before = (
            git(&repo, &["rev-parse", "HEAD"]),
            std::fs::read(repo.join(".git/index")).unwrap(),
            git(&repo, &["status", "--porcelain=v1"]),
        );
        let destination = FreshTaskDestination {
            project_id: launch.project_id.clone(),
            pinned_commit: None,
            default_ref: Some("refs/heads/dev".into()),
            model: None,
            reasoning_effort: None,
            retained_limit: 10,
        };
        let binding = store::fresh_heartbeat_binding(
            &manager.inner.store_path,
            &destination,
            None,
            cwd.to_str().unwrap(),
        )
        .unwrap();
        let now = application::heartbeats::epoch_ms();
        let mut spec = specification();
        spec.instructions = "Inspect the fixture with $verification without changing files.".into();
        spec.skills = vec!["verification".into()];
        let schedule = store::control_heartbeat(
            &manager.inner.store_path,
            &format!("project:{}", launch.project_id),
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::Create {
                spec,
            },
            "Create fresh fixture tasks every minute.",
            &binding,
            now,
        )
        .unwrap()
        .schedule;
        store::control_heartbeat(
            &manager.inner.store_path,
            &format!("project:{}", launch.project_id),
            &uuid::Uuid::new_v4().to_string(),
            &HeartbeatAction::RunNow {
                schedule_id: schedule.schedule_id.clone(),
                expected_version: 1,
            },
            "Run this fixture occurrence now.",
            &binding,
            now,
        )
        .unwrap();
        let pending = store::materialize_heartbeats(&manager.inner.store_path, now)
            .unwrap()
            .remove(0);
        scheduler = Some(application::heartbeat_scheduler::HeartbeatScheduler::start(
            &manager,
        ));
        let first = settled(&manager, &pending.occurrence_id).await;
        scheduler.take().unwrap().stop().await;
        let first = first.expect("scheduled fixture did not reach an exact initial outcome");
        assert_eq!(
            first.initial_outcome.as_ref().unwrap().outcome,
            Some(HeartbeatOutcome::Unchanged),
            "{first:?}"
        );
        assert_eq!(first.shared_directory, Some(false));
        {
            let observed = requests.lock().unwrap();
            assert_eq!(observed.len(), 2, "one initial turn: report and final response");
            assert!(observed[0].to_string().contains("FRESH_SKILL_TOKEN"));
        }
        let retained =
            store::load_task_launch(&manager.inner.store_path, &first.request.request_id)
                .unwrap()
                .unwrap();
        assert_eq!(retained.session_id, first.session_id);
        assert_eq!(retained.source.commit, source_before.0);
        assert_eq!(
            std::fs::read_to_string(retained.workspace_path.join("nested/file")).unwrap(),
            "committed"
        );
        assert!(!retained.workspace_path.join("nested/untracked").exists());
        let snapshot =
            sessions::load_session(&manager.inner.store_path, &first.session_id).unwrap();
        assert_eq!(snapshot.behavior, sessions::SessionBehavior::Direct);
        assert!(
            store::load_session_goal(&manager.inner.store_path, &first.session_id)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            store::list_session_inbox(&manager.inner.store_path, &first.session_id)
                .unwrap()
                .len(),
            1
        );
        let input = store::list_session_inbox(&manager.inner.store_path, &first.session_id).unwrap().remove(0);
        assert_eq!(input.status, store::InboxStatus::Delivered);
        assert_eq!(input.content, first.request.prompt);
        assert!(!input.content.contains("FRESH_SKILL_TOKEN"));
        let service = manager.inner.active_sessions.read().await.get(&first.session_id).unwrap().clone();
        tokio::time::timeout(Duration::from_secs(10), async {
            while service.active_run().is_some() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.expect("initial run did not release admission after settlement");
        let later = manager.session_runs().submit(&first.session_id,
            "Later human continuation stays independent.".into(), store::InputOrigin::Person).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            while service.active_run().is_some() {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        }).await.expect("later human run did not settle");
        assert_ne!(Some(later.run_id), first.initial_run_id);
        let summary = sessions::list_sessions(&manager.inner.store_path).unwrap()
            .into_iter().find(|item| item.session_id == first.session_id).unwrap();
        assert_eq!(summary.run_count, 2);
        assert_eq!(store::read_fresh_heartbeat_launch(&manager.inner.store_path, &first.occurrence_id)
            .unwrap().unwrap().receipt().initial_outcome, first.initial_outcome);
        assert_eq!(store::list_session_inbox(&manager.inner.store_path, &first.session_id).unwrap().len(), 1);
        assert_eq!(
            (
                git(&repo, &["rev-parse", "HEAD"]),
                std::fs::read(repo.join(".git/index")).unwrap(),
                git(&repo, &["status", "--porcelain=v1"])
            ),
            source_before
        );
        git(&repo, &["update-ref", "-d", "refs/heads/dev"]);
        let replay = store::reserve_fresh_heartbeat_launch(
            &manager.inner.store_path,
            &first.occurrence_id,
            1,
            now,
        )
        .unwrap()
        .unwrap();
        application::task_launches::TaskLaunchApplication::new(&manager)
            .prepare(replay)
            .await
            .unwrap();
        assert_eq!(
            store::list_task_launches(&manager.inner.store_path, &launch.project_id)
                .unwrap()
                .len(),
            1,
            "deleted ref retry cannot create a new task"
        );
        assert!(sessions::delete_session(&manager.inner.store_path, &first.session_id).unwrap());
        assert!(retained.workspace_path.join("nested/file").exists());
        assert_eq!(
            store::fresh_heartbeat_inventory(&manager.inner.store_path, &launch.project_id, None)
                .unwrap()[0]
                .initial_outcome,
            first.initial_outcome
        );
    })
    .await;

    // An observation/store error or assertion panic must not bypass either
    // owned task. Keep cleanup failures separate from the primary panic.
    let scheduler_cleanup = catch_fixture_panic(async {
        if let Some(scheduler) = scheduler.take() {
            scheduler.stop().await;
        }
    })
    .await;
    model.abort();
    let provider_cleanup = match model.await {
        Ok(()) => Ok("completed"),
        Err(error) if error.is_cancelled() => Ok("cancelled"),
        Err(error) => Err(format!("provider task join failed: {error}")),
    };
    let mut cleanup_errors = Vec::new();
    if let Err(panic) = scheduler_cleanup {
        let message = panic
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| panic.downcast_ref::<&str>().copied())
            .unwrap_or("non-string panic");
        cleanup_errors.push(format!("scheduler cleanup panicked: {message}"));
    }
    if let Err(error) = &provider_cleanup {
        cleanup_errors.push(error.clone());
    }
    eprintln!("FRESH_INTERVAL_FIXTURE_CLEANUP primary_panicked={} scheduler_cleanup_errors={cleanup_errors:?} provider_join={provider_cleanup:?}", primary.is_err());
    if let Err(panic) = primary {
        std::panic::resume_unwind(panic);
    }
    assert!(
        cleanup_errors.is_empty(),
        "fixture cleanup failed: {cleanup_errors:?}"
    );
}
