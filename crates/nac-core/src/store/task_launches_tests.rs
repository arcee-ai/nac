use super::*;

pub(crate) fn fixture() -> (PathBuf, TaskLaunchRequest, TaskLaunchSource) {
    fixture_with_historical_schema(false)
}

fn fixture_with_historical_schema(
    historical: bool,
) -> (PathBuf, TaskLaunchRequest, TaskLaunchSource) {
    let path = std::env::temp_dir()
        .join(format!("nac-task-launch-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    if historical {
        schema::initialize_synthetic_predecessor(&path).unwrap();
    } else {
        initialize(&path).unwrap();
    }
    insert_project(
        &path,
        NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: "/repo/nested".into(),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
        },
    )
    .unwrap();
    let request = TaskLaunchRequest {
        model_source: None,
        request_id: uuid::Uuid::new_v4().to_string(),
        project_id: "project".into(),
        invoking_session_id: None,
        model_selection: None,
        git_ref: Some("topic".into()),
        default_ref: Some("dev".into()),
        title: "Retained task".into(),
        prompt: "Work on this".into(),
    };
    let source = TaskLaunchSource {
        project_cwd: "/repo/nested".into(),
        source_cwd: "/repo/nested".into(),
        repo_root: "/repo".into(),
        common_git_dir: "/repo/.git".into(),
        repository_identity: "fixture".into(),
        subdirectory: "nested".into(),
        default_ref: "dev".into(),
        selected_ref: "topic".into(),
        commit: "a".repeat(40),
        excluded_source_edits: true,
    };
    (path, request, source)
}

#[test]
fn launch_title_uses_existing_session_presentation_rules() {
    let (path, mut request, _) = fixture();
    for invalid in [
        "x".repeat(121),
        "bad\ttitle".into(),
        " untrimmed ".into(),
        " ".into(),
    ] {
        request.title = invalid;
        assert!(request
            .validate()
            .unwrap_err()
            .to_string()
            .starts_with("invalid request:"));
    }
    request.title = "é".repeat(120);
    request.validate().unwrap();
    request.git_ref = Some("--help".into());
    assert!(request.validate().is_err());
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn retry_after_reopen_returns_original_pin_and_intentional_duplicate_is_distinct() {
    let (path, request, mut source) = fixture();
    let first = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    source.commit = "b".repeat(40);
    source.selected_ref = "deleted-branch".into();
    let retry = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    assert_eq!(first, retry);
    let mut other = request;
    other.request_id = uuid::Uuid::new_v4().to_string();
    let second = reserve_task_launch(&path, other, source).unwrap();
    assert_ne!(first.session_id, second.session_id);
    assert_ne!(first.workspace_path, second.workspace_path);
    assert_eq!(list_task_launches(&path, "project").unwrap().len(), 2);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn incompatible_retry_and_changed_project_repository_are_conflicts() {
    let (path, request, source) = fixture();
    reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    let mut changed = request.clone();
    changed.prompt.push('!');
    assert!(reserve_task_launch(&path, changed, source.clone())
        .unwrap_err()
        .to_string()
        .contains("conflict"));
    let mut changed = request;
    changed.request_id = uuid::Uuid::new_v4().to_string();
    let mut other_repo = source;
    other_repo.common_git_dir = "/other/.git".into();
    assert!(reserve_task_launch(&path, changed, other_repo)
        .unwrap_err()
        .to_string()
        .contains("binding changed"));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn cancellation_is_durable_and_late_preparation_cannot_reopen_it() {
    let (path, request, source) = fixture();
    reserve_task_launch(&path, request.clone(), source).unwrap();
    update_task_launch(&path, &request.request_id, TaskLaunchPhase::Cancelled, None).unwrap();
    let late = update_task_launch(
        &path,
        &request.request_id,
        TaskLaunchPhase::PreparingRuntime,
        None,
    )
    .unwrap();
    assert_eq!(late.phase, TaskLaunchPhase::Cancelled);
    assert!(late.first_input_id.is_none());
    // Inventory survives project deletion; it is ownership evidence, not GC.
    delete_project(&path, "project").unwrap();
    assert_eq!(
        load_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap(),
        late
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn migrates_previous_store_without_touching_existing_session_identity() {
    for previous_version in [34, 37] {
        let (path, _, _) = fixture_with_historical_schema(true);
        insert_test_session(&path, "legacy");
        let waiter = crate::sessions::ChildInputWaitLease::new(&path).unwrap();
        let input = create_traditional_child_inbox_item(
            &path,
            "legacy",
            "preserve delegated input",
            Some("old-run"),
            TraditionalChildExecutionMode::Foreground,
            Some(waiter.id()),
        )
        .unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("DROP TABLE task_launches; DROP TABLE project_git_sources;")
            .unwrap();
        conn.pragma_update(None, "user_version", previous_version)
            .unwrap();
        drop(conn);
        initialize(&path).unwrap();
        assert!(crate::sessions::session_exists(&path, "legacy").unwrap());
        assert_eq!(
            load_session_inbox_item(&path, "legacy", input.id).unwrap(),
            input
        );
        assert!(list_task_launches(&path, "project").unwrap().is_empty());
        initialize(&path).unwrap();
        drop(waiter);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}

#[test]
fn restart_reconciliation_preserves_pin_and_retained_ownership_without_admitting_work() {
    let (path, request, source) = fixture();
    let first = reserve_task_launch(&path, request.clone(), source).unwrap();
    std::fs::create_dir_all(&first.workspace_path).unwrap();
    std::fs::write(first.workspace_path.join("keep"), "uncertain owned effect").unwrap();
    let lease = crate::sessions::SessionOperationLease::try_acquire(
        &path,
        &format!("task-launch:{}", request.request_id),
    )
    .unwrap();
    reconcile_task_launches(&path).unwrap();
    assert_eq!(
        load_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap()
            .phase,
        TaskLaunchPhase::Pinned
    );
    drop(lease);
    reconcile_task_launches(&path).unwrap();
    let recovered = load_task_launch(&path, &request.request_id)
        .unwrap()
        .unwrap();
    assert_eq!(recovered.phase, TaskLaunchPhase::Failed);
    assert_eq!(first.source, recovered.source);
    assert_eq!(first.session_id, recovered.session_id);
    assert!(recovered.first_input_id.is_none());
    assert_eq!(
        std::fs::read_to_string(first.workspace_path.join("keep")).unwrap(),
        "uncertain owned effect"
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

fn retained_migration_rows(conn: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT {} FROM {table} ORDER BY rowid",
            schema::surviving_test_columns(conn, table)
        ))
        .unwrap();
    let columns = statement.column_count();
    statement
        .query_map([], |row| {
            (0..columns).map(|column| row.get(column)).collect()
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

#[test]
fn v38_evidence_and_delegated_input_survive_retained_launch_migration() {
    let (path, request, source) = fixture_with_historical_schema(true);
    for session in ["parent", "child"] {
        insert_test_session(&path, session);
    }
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch(
        "UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent', 'child');",
    )
    .unwrap();
    create_traditional_child_relationship(
        &path,
        "parent",
        "child",
        GENERAL_CHILD_PROFILE,
        "kept child",
    )
    .unwrap();
    for (run, mode) in [
        (
            "first-generation",
            TraditionalChildExecutionMode::Foreground,
        ),
        (
            "second-generation",
            TraditionalChildExecutionMode::Background,
        ),
    ] {
        begin_traditional_child_run(&path, "child", run, mode).unwrap();
        settle_traditional_child_run(
            &path,
            "child",
            run,
            TraditionalChildTerminal {
                status: TraditionalChildStatus::Completed,
                report: Some(format!("kept {run}")),
                failure: None,
                change_summary: Some("one retained change".into()),
                verification_summary: Some("existing checks".into()),
            },
        )
        .unwrap();
    }
    let waiter = crate::sessions::ChildInputWaitLease::new(&path).unwrap();
    let input = create_traditional_child_inbox_item(
        &path,
        "child",
        "keep queued foreground intent",
        Some("second-generation"),
        TraditionalChildExecutionMode::Foreground,
        Some(waiter.id()),
    )
    .unwrap();
    // The landed v38 shape contains run/goal evidence, child receipts and exact queued-input authority, but no retained launch tables.
    conn.execute_batch(
        "INSERT INTO session_run_outcomes
             (id, session_id, run_id, disposition, result_excerpt, result_truncated, finished_at)
         VALUES (41, 'parent', 'kept-run', 'completed', 'kept result ✓', 1, 'run-finished');
         INSERT INTO session_goals
             (session_id, goal_id, objective, status, created_at, updated_at, version, last_run_id)
         VALUES ('parent', 'current-goal', 'keep current objective', 'paused', 'created', 'updated', 7, 'kept-run');
         INSERT INTO session_goal_outcomes
             (id, session_id, goal_id, objective, status, version, tokens_used, time_used_ms,
              created_at, updated_at, retired_at, retirement, last_run_id)
         VALUES (52, 'parent', 'replaced-goal', 'keep retired objective', 'complete', 6, 123, 456,
                 'old-created', 'old-updated', 'retired', 'replaced', 'kept-run');
         DROP TABLE task_launches;
         DROP TABLE project_git_sources;
         PRAGMA user_version = 38;",
    )
    .unwrap();
    let tables = [
        "sessions",
        "session_goals",
        "session_run_outcomes",
        "session_goal_outcomes",
        "traditional_children",
        "traditional_child_terminal_receipts",
        "session_inbox",
        "sqlite_sequence",
    ];
    let before = tables.map(|table| retained_migration_rows(&conn, table));
    drop(conn);

    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let conn = Connection::open(&path).unwrap();
    for (table, expected) in tables.into_iter().zip(before) {
        assert_eq!(retained_migration_rows(&conn, table), expected, "{table}");
    }
    assert_eq!(
        load_session_inbox_item(&path, "child", input.id).unwrap(),
        input
    );
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    // Exercise the missing-table failure at the original collision, rather than
    // treating a version-number assertion alone as migration coverage.
    let launch = reserve_task_launch(&path, request.clone(), source).unwrap();
    assert_eq!(
        load_task_launch(&path, &request.request_id).unwrap(),
        Some(launch)
    );
    assert_eq!(
        conn.pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        schema_version()
    );
    drop(conn);
    drop(waiter);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn task_model_is_frozen_and_rejects_credential_headers_before_reservation() {
    let (path, mut request, source) = fixture();
    request.model_selection = Some(TaskModelSelection {
        service_tier: Some("fast".into()),
        backend: "openai-responses".into(),
        model: "gpt-5.2".into(),
        base_url: "https://api.openai.com/v1".into(),
        allow_insecure_http: false,
        api_key_env: Some("OPENAI_API_KEY".into()),
        reasoning_effort: None,
        extra_headers: None,
        compaction_threshold: None,
    });
    let first = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    assert_eq!(first.request.model_selection, request.model_selection);
    let mut changed = request.clone();
    changed.model_selection.as_mut().unwrap().model = "gpt-5.3".into();
    assert!(reserve_task_launch(&path, changed, source.clone()).is_err());
    let mut secret = request;
    secret.request_id = uuid::Uuid::new_v4().to_string();
    secret.model_selection.as_mut().unwrap().extra_headers = Some(
        [("Authorization".to_string(), "secret-value".to_string())]
            .into_iter()
            .collect(),
    );
    assert!(reserve_task_launch(&path, secret, source).is_err());
    let conn = open_runtime_connection(&path).unwrap();
    let stored: String = conn
        .query_row("SELECT request_json FROM task_launches", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(!stored.contains("secret-value"));
    drop(conn);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn task_model_tier_round_trips_and_old_records_remain_readable() {
    let base = serde_json::json!({
        "backend": "openai-responses",
        "model": "gpt-5.2",
        "base_url": "https://api.openai.com/v1",
        "allow_insecure_http": false,
        "api_key_env": "OPENAI_API_KEY",
        "reasoning_effort": null,
        "extra_headers": null,
        "compaction_threshold": null
    });
    let old: TaskModelSelection = serde_json::from_value(base.clone()).unwrap();
    assert_eq!(old.service_tier, None);
    old.validate().unwrap();
    let mut selected = old;
    selected.service_tier = Some("fast".into());
    selected.validate().unwrap();
    let round_trip: TaskModelSelection =
        serde_json::from_value(serde_json::to_value(&selected).unwrap()).unwrap();
    assert_eq!(round_trip.service_tier.as_deref(), Some("fast"));
    selected.service_tier = Some("unknown".into());
    assert!(selected.validate().is_err());
    let settings = crate::model::EffectiveModelSettings::new_with_http_policy(
        crate::model::BackendKind::OpenAiResponses,
        "gpt-5.2".into(),
        "https://proxy.example.invalid/v1".into(),
        None,
        None,
        Default::default(),
        false,
    )
    .unwrap();
    assert!(settings
        .with_service_tier(Some(crate::model::ServiceTier::Fast))
        .is_err());
}

#[test]
fn referenced_model_headers_are_atomic_private_and_frozen_for_retry() {
    let (path, mut request, source) = fixture();
    insert_test_session(&path, "source");
    let conn = Connection::open(&path).unwrap();
    conn.execute("UPDATE sessions SET cwd='/repo/nested',backend='openai-responses',model='source-model',base_url='https://example.invalid',allow_insecure_http=0,api_key_env='SOURCE_KEY',extra_headers_json=?1,config_version=7 WHERE session_id='source'", [r#"{"x-project-token":"private-canary"}"#]).unwrap();
    conn.execute(
        "INSERT INTO session_projects(session_id,project_id) VALUES('source','project')",
        [],
    )
    .unwrap();
    drop(conn);
    request.model_selection = Some(TaskModelSelection {
        backend: "openai-responses".into(),
        model: "new-model".into(),
        base_url: "https://example.invalid".into(),
        allow_insecure_http: false,
        api_key_env: Some("SOURCE_KEY".into()),
        reasoning_effort: None,
        service_tier: None,
        extra_headers: None,
        compaction_threshold: None,
    });
    request.model_source = Some(crate::sessions::ProjectModelSourceRef {
        project_id: "project".into(),
        session_id: "source".into(),
        config_version: 7,
    });
    let mut stale = request.clone();
    stale.model_source.as_mut().unwrap().config_version = 6;
    assert!(reserve_task_launch(&path, stale, source.clone())
        .unwrap_err()
        .to_string()
        .contains("source changed"));
    assert!(load_project_git_source(&path, "project").unwrap().is_none());
    assert!(list_task_launches(&path, "project").unwrap().is_empty());
    for (mutation, restore) in [
        (
            "UPDATE sessions SET cwd='/other' WHERE session_id='source'",
            "UPDATE sessions SET cwd='/repo/nested' WHERE session_id='source'",
        ),
        (
            "UPDATE sessions SET host_id='other' WHERE session_id='source'",
            "UPDATE sessions SET host_id=NULL WHERE session_id='source'",
        ),
        (
            "UPDATE sessions SET sandbox_json='{}' WHERE session_id='source'",
            "UPDATE sessions SET sandbox_json=NULL WHERE session_id='source'",
        ),
    ] {
        let conn = Connection::open(&path).unwrap();
        conn.execute(mutation, []).unwrap();
        drop(conn);
        assert!(reserve_task_launch(&path, request.clone(), source.clone())
            .unwrap_err()
            .to_string()
            .contains("source is unavailable"));
        assert!(load_project_git_source(&path, "project").unwrap().is_none());
        let conn = Connection::open(&path).unwrap();
        conn.execute(restore, []).unwrap();
    }
    insert_test_session(&path, "parent");
    let conn = Connection::open(&path).unwrap();
    conn.execute("INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,created_at,updated_at) VALUES('source','parent','parent','general','child',1,'now','now')", []).unwrap();
    drop(conn);
    assert!(reserve_task_launch(&path, request.clone(), source.clone())
        .unwrap_err()
        .to_string()
        .contains("source is unavailable"));
    assert!(load_project_git_source(&path, "project").unwrap().is_none());
    let conn = Connection::open(&path).unwrap();
    conn.execute(
        "DELETE FROM traditional_children WHERE child_session_id='source'",
        [],
    )
    .unwrap();
    drop(conn);
    let mut wrong_project = request.clone();
    wrong_project.model_source.as_mut().unwrap().project_id = "other".into();
    assert!(reserve_task_launch(&path, wrong_project, source.clone()).is_err());
    let mut wrong_url = request.clone();
    wrong_url.model_selection.as_mut().unwrap().base_url = "https://other.invalid".into();
    assert!(reserve_task_launch(&path, wrong_url, source.clone()).is_err());
    let mut wrong_route = request.clone();
    wrong_route.model_selection.as_mut().unwrap().api_key_env = Some("OTHER_KEY".into());
    assert!(reserve_task_launch(&path, wrong_route, source.clone()).is_err());
    let mut conflicting_headers = request.clone();
    conflicting_headers
        .model_selection
        .as_mut()
        .unwrap()
        .extra_headers = Some(Default::default());
    assert!(reserve_task_launch(&path, conflicting_headers, source.clone()).is_err());
    let first = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    assert_eq!(
        first
            .frozen_model_headers
            .as_ref()
            .unwrap()
            .0
            .get("x-project-token")
            .unwrap(),
        "private-canary"
    );
    assert!(!serde_json::to_string(&first)
        .unwrap()
        .contains("private-canary"));
    assert!(!format!("{first:?}").contains("private-canary"));
    let conn = Connection::open(&path).unwrap();
    conn.execute("DELETE FROM sessions WHERE session_id='source'", [])
        .unwrap();
    drop(conn);
    let retry = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
    assert_eq!(first, retry);
    assert_eq!(
        load_task_launch(&path, &request.request_id)
            .unwrap()
            .unwrap(),
        first
    );
    assert!(
        !serde_json::to_string(&list_task_launches(&path, "project").unwrap())
            .unwrap()
            .contains("private-canary")
    );
    let conn = Connection::open(&path).unwrap();
    conn.execute("UPDATE task_launches SET source_json=json_remove(source_json,'$._nac_model_headers') WHERE request_id=?1", [&request.request_id]).unwrap();
    drop(conn);
    assert!(load_task_launch(&path, &request.request_id)
        .unwrap_err()
        .to_string()
        .contains("invalid task model source receipt"));
    // Restore the original receipt to test conflict handling independently.
    let conn = Connection::open(&path).unwrap();
    conn.execute("UPDATE task_launches SET source_json=json_set(source_json,'$._nac_model_headers',json(?1)) WHERE request_id=?2", rusqlite::params![r#"{"x-project-token":"private-canary"}"#, request.request_id]).unwrap();
    drop(conn);
    request.model_source.as_mut().unwrap().config_version += 1;
    assert!(reserve_task_launch(&path, request, source)
        .unwrap_err()
        .to_string()
        .contains("identity"));
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}

#[test]
fn v54_retained_task_replay_keeps_original_request_bytes_and_identity() {
    for threshold in [None, Some(8192)] {
        let (path, mut request, source) = fixture();
        request.model_selection = Some(TaskModelSelection {
            backend: "openai-responses".into(),
            model: "fixture-model".into(),
            base_url: "https://example.invalid".into(),
            allow_insecure_http: false,
            api_key_env: None,
            reasoning_effort: None,
            service_tier: threshold.map(|_| "fast".to_owned()),
            extra_headers: None,
            compaction_threshold: threshold,
        });
        request.prompt = "literal orchestrator_compaction_threshold in user text".into();
        let first = reserve_task_launch(&path, request.clone(), source.clone()).unwrap();
        let conn = open_runtime_connection(&path).unwrap();
        let raw: String = conn
            .query_row(
                "SELECT request_json FROM task_launches WHERE request_id=?1",
                [&request.request_id],
                |row| row.get(0),
            )
            .unwrap();
        let legacy = raw.replace(
            "\"compaction_threshold\":",
            "\"orchestrator_compaction_threshold\":",
        );
        conn.execute(
            "UPDATE task_launches SET request_json=?2 WHERE request_id=?1",
            params![request.request_id, legacy],
        )
        .unwrap();
        legacy_task_model::capture_for_test(&conn).unwrap();
        drop(conn);
        initialize(&path).unwrap();
        assert_eq!(
            reserve_task_launch(&path, request.clone(), source.clone()).unwrap(),
            first
        );
        let mut changed = request.clone();
        changed.model_selection.as_mut().unwrap().model = "different".into();
        assert!(reserve_task_launch(&path, changed, source).is_err());
        let conn = open_runtime_connection(&path).unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT request_json FROM task_launches WHERE request_id=?1",
                [&request.request_id],
                |row| row.get(0)
            )
            .unwrap(),
            legacy
        );
        drop(conn);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
