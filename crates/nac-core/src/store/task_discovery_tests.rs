use super::*;

fn test_path(label: &str) -> PathBuf {
    std::env::temp_dir()
        .join(format!(
            "nac-task-discovery-{label}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db")
}

fn project(path: &Path, project_id: &str, cwd: &str) {
    insert_project(
        path,
        NewProject {
            project_id: project_id.to_owned(),
            name: Some(project_id.to_owned()),
            description: None,
            cwd: PathBuf::from(cwd),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
}

fn task(path: &Path, project_id: &str, session_id: &str, title: &str, prompt: &str, at: &str) {
    insert_test_session(path, session_id);
    let conn = open_runtime_connection(path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior = 'direct', last_user_prompt = ?2, updated_at = ?3
         WHERE session_id = ?1",
        params![session_id, prompt, at],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO session_presentations (session_id, title) VALUES (?1, ?2)",
        params![session_id, title],
    )
    .unwrap();
    drop(conn);
    assign_session_to_project(path, project_id, session_id).unwrap();
}

fn search(path: &Path, project_id: &str) -> TaskSearch {
    let _ = path;
    TaskSearch {
        project_id: project_id.to_owned(),
        limit: 10,
        ..TaskSearch::default()
    }
}

fn ids(page: &TaskSearchPage) -> Vec<&str> {
    page.candidates
        .iter()
        .map(|candidate| candidate.session_id.as_str())
        .collect()
}

#[test]
fn reference_search_returns_every_attempt_as_whole_token_matches() {
    let path = test_path("reference");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    task(
        &path,
        "p1",
        "a",
        "ALL-469 first try",
        "",
        "2026-01-01T00:00:01Z",
    );
    task(
        &path,
        "p1",
        "b",
        "retry",
        "continue all-469 please",
        "2026-01-01T00:00:02Z",
    );
    task(
        &path,
        "p1",
        "c",
        "ALL-4690 unrelated",
        "",
        "2026-01-01T00:00:03Z",
    );
    task(&path, "p1", "d", "other", "", "2026-01-01T00:00:04Z");

    let page = search_direct_tasks(
        &path,
        &TaskSearch {
            reference: Some("ALL-469".into()),
            ..search(&path, "p1")
        },
    )
    .unwrap()
    .unwrap();

    assert_eq!(ids(&page), ["b", "a"]);
    assert_eq!(page.candidates[0].matched, [TaskMatchField::LastPrompt]);
    assert_eq!(page.candidates[1].matched, [TaskMatchField::Title]);
    assert_eq!(page.next_after, None);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn search_is_project_scoped_excludes_other_topologies_and_reports_missing_projects() {
    let path = test_path("scope");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    project(&path, "p2", "/tmp/other");
    task(&path, "p1", "mine", "x", "", "2026-01-01T00:00:01Z");
    task(&path, "p1", "caller", "x", "", "2026-01-01T00:00:02Z");
    task(&path, "p1", "child", "x", "", "2026-01-01T00:00:03Z");
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "INSERT INTO traditional_children
         (child_session_id, parent_session_id, root_session_id, profile, description,
          nesting_depth, created_at, updated_at)
         VALUES ('child', 'mine', 'mine', 'general', 'helper', 1, 'now', 'now')",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE sessions SET behavior = 'orchestrator' WHERE session_id = 'caller'",
        [],
    )
    .unwrap();
    drop(conn);

    let page = search_direct_tasks(&path, &search(&path, "p1"))
        .unwrap()
        .unwrap();
    assert_eq!(ids(&page), ["mine"]);
    let other = search_direct_tasks(&path, &search(&path, "p2"))
        .unwrap()
        .unwrap();
    assert!(other.candidates.is_empty());
    assert_eq!(
        search_direct_tasks(&path, &search(&path, "missing")).unwrap(),
        None
    );

    assert_eq!(
        load_direct_task(&path, "child").unwrap(),
        TaskLookup::NotIndependentTask(NonTaskSession::TraditionalChild)
    );
    assert_eq!(
        load_direct_task(&path, "caller").unwrap(),
        TaskLookup::NotIndependentTask(NonTaskSession::Orchestrator)
    );
    assert_eq!(
        load_direct_task(&path, "deleted").unwrap(),
        TaskLookup::NotFound
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn pages_are_bounded_and_cursor_resumes_without_duplicates() {
    let path = test_path("pages");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    for index in 0..5 {
        task(
            &path,
            "p1",
            &format!("s{index}"),
            "same title",
            "",
            &format!("2026-01-01T00:00:0{index}Z"),
        );
    }
    let mut request = TaskSearch {
        limit: 2,
        ..search(&path, "p1")
    };
    let mut seen = Vec::new();
    loop {
        let page = search_direct_tasks(&path, &request).unwrap().unwrap();
        assert!(page.candidates.len() <= 2);
        seen.extend(ids(&page).into_iter().map(str::to_owned));
        match page.next_after {
            Some(cursor) => {
                assert!(!cursor.contains('s'), "cursor names a session: {cursor}");
                request.after = Some(cursor);
            }
            None => break,
        }
    }
    assert_eq!(seen, ["s4", "s3", "s2", "s1", "s0"]);
    assert!(search_direct_tasks(
        &path,
        &TaskSearch {
            after: Some("no-separator".into()),
            ..search(&path, "p1")
        }
    )
    .is_err());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn scan_bound_yields_a_resumable_cursor_and_measured_search_and_snapshot_costs_stay_small() {
    let path = test_path("scan");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    let total = TASK_SEARCH_SCAN_LIMIT + 50;
    for index in 0..total {
        task(
            &path,
            "p1",
            &format!("s{index:04}"),
            if index == 0 { "ALL-1 needle" } else { "noise" },
            "",
            &format!("2026-01-01T00:{:02}:{:02}Z", index / 60, index % 60),
        );
    }
    let request = TaskSearch {
        reference: Some("ALL-1".into()),
        ..search(&path, "p1")
    };
    let started = std::time::Instant::now();
    let first = search_direct_tasks(&path, &request).unwrap().unwrap();
    let elapsed = started.elapsed();
    assert!(first.candidates.is_empty());
    assert!(first.scan_limit_reached);
    assert_eq!(first.scanned_rows, TASK_SEARCH_SCAN_LIMIT);
    let second = search_direct_tasks(
        &path,
        &TaskSearch {
            after: first.next_after,
            ..request
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(ids(&second), ["s0000"]);
    assert!(!second.scan_limit_reached);
    eprintln!("task search scanned {TASK_SEARCH_SCAN_LIMIT} rows in {elapsed:?}");
    assert!(elapsed < std::time::Duration::from_secs(2), "{elapsed:?}");

    let full = TaskSearch {
        text: Some("noise".into()),
        limit: MAX_TASK_SEARCH_LIMIT,
        ..search(&path, "p1")
    };
    let started = std::time::Instant::now();
    let page = search_direct_tasks(&path, &full).unwrap().unwrap();
    let elapsed = started.elapsed();
    assert_eq!(page.candidates.len(), MAX_TASK_SEARCH_LIMIT);
    eprintln!("full task search page in {elapsed:?}");
    assert!(elapsed < std::time::Duration::from_secs(2), "{elapsed:?}");

    let conn = open_runtime_connection(&path).unwrap();
    for run in 0..=RETAINED_RUN_OUTCOMES {
        record_run_outcome_with_connection(
            &conn,
            "s0001",
            &format!("run-{run}"),
            RunOutcomeDisposition::Completed,
            Some(&"x".repeat(RUN_RESULT_EXCERPT_CHARS * 2)),
            None,
        )
        .unwrap();
    }
    drop(conn);
    for index in 0..=RETAINED_GOAL_OUTCOMES {
        let goal =
            create_session_goal(&path, "s0001", &format!("goal {index}"), None, None).unwrap();
        clear_session_goal(&path, "s0001", &goal.goal_id, goal.version).unwrap();
    }
    let started = std::time::Instant::now();
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "s0001").unwrap() else {
        panic!("expected a task");
    };
    let elapsed = started.elapsed();
    assert_eq!(snapshot.run_outcomes.len(), RETAINED_RUN_OUTCOMES);
    assert_eq!(snapshot.prior_goals.len(), RETAINED_GOAL_OUTCOMES);
    eprintln!("full task snapshot in {elapsed:?}");
    assert!(elapsed < std::time::Duration::from_secs(2), "{elapsed:?}");
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn replaced_and_cleared_goals_remain_provable_after_reopen() {
    let path = test_path("goals");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    task(&path, "p1", "t", "x", "", "2026-01-01T00:00:01Z");
    let first = create_session_goal(&path, "t", "ship it", None, None).unwrap();
    let completed =
        update_session_goal_by_model(&path, "t", &first.goal_id, GoalStatus::Complete).unwrap();
    let second = create_session_goal(&path, "t", "next", None, None).unwrap();
    clear_session_goal(&path, "t", &second.goal_id, second.version).unwrap();
    assert!(clear_session_goal(&path, "t", &second.goal_id, second.version).is_err());

    // A fresh connection after the writers are gone stands in for restart.
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "t").unwrap() else {
        panic!("task should be found");
    };
    assert_eq!(snapshot.goal, None);
    let retained = snapshot
        .prior_goals
        .iter()
        .map(|goal| (goal.goal_id.as_str(), goal.status, goal.retirement))
        .collect::<Vec<_>>();
    assert_eq!(
        retained,
        [
            (
                second.goal_id.as_str(),
                GoalStatus::Active,
                GoalRetirement::Cleared
            ),
            (
                first.goal_id.as_str(),
                GoalStatus::Complete,
                GoalRetirement::Replaced
            ),
        ]
    );
    assert_eq!(snapshot.prior_goals[1].version, completed.version);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn goal_retention_is_bounded() {
    let path = test_path("goal_bound");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    task(&path, "p1", "t", "x", "", "2026-01-01T00:00:01Z");
    let mut goal_ids = Vec::new();
    for index in 0..RETAINED_GOAL_OUTCOMES + 3 {
        let goal = create_session_goal(&path, "t", &format!("goal {index}"), None, None).unwrap();
        clear_session_goal(&path, "t", &goal.goal_id, goal.version).unwrap();
        goal_ids.push(goal.goal_id);
    }
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "t").unwrap() else {
        panic!("task should be found");
    };
    assert_eq!(snapshot.prior_goals.len(), RETAINED_GOAL_OUTCOMES);
    assert_eq!(
        snapshot.prior_goals[0].goal_id,
        goal_ids[goal_ids.len() - 1]
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn run_outcomes_are_insert_once_bounded_and_never_overwritten() {
    let path = test_path("runs");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    task(&path, "p1", "t", "x", "", "2026-01-01T00:00:01Z");
    let conn = open_runtime_connection(&path).unwrap();
    let long = "é".repeat(RUN_RESULT_EXCERPT_CHARS + 5);
    record_run_outcome_with_connection(
        &conn,
        "t",
        "run-1",
        RunOutcomeDisposition::Completed,
        Some(&long),
        None,
    )
    .unwrap();
    // A replayed settlement or later follow-up keeps the first outcome.
    record_run_outcome_with_connection(
        &conn,
        "t",
        "run-1",
        RunOutcomeDisposition::Cancelled,
        Some("overwrite"),
        None,
    )
    .unwrap();
    for index in 2..=RETAINED_RUN_OUTCOMES + 2 {
        record_run_outcome_with_connection(
            &conn,
            "t",
            &format!("run-{index}"),
            RunOutcomeDisposition::Cancelled,
            None,
            None,
        )
        .unwrap();
    }
    drop(conn);
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "t").unwrap() else {
        panic!("task should be found");
    };
    assert_eq!(snapshot.run_outcomes.len(), RETAINED_RUN_OUTCOMES);
    assert_eq!(
        snapshot.run_outcomes[0].run_id,
        format!("run-{}", RETAINED_RUN_OUTCOMES + 2)
    );
    assert!(snapshot
        .run_outcomes
        .iter()
        .all(|run| run.run_id != "run-1"));

    let path = test_path("run_first");
    initialize(&path).unwrap();
    insert_test_session(&path, "t");
    let conn = open_runtime_connection(&path).unwrap();
    record_run_outcome_with_connection(
        &conn,
        "t",
        "run-1",
        RunOutcomeDisposition::Completed,
        Some(&long),
        None,
    )
    .unwrap();
    record_run_outcome_with_connection(
        &conn,
        "t",
        "run-1",
        RunOutcomeDisposition::Cancelled,
        Some("overwrite"),
        None,
    )
    .unwrap();
    let outcome =
        &super::super::task_evidence::load_run_outcomes_with_connection(&conn, "t").unwrap()[0];
    assert_eq!(outcome.disposition, RunOutcomeDisposition::Completed);
    assert!(outcome.result_truncated);
    assert_eq!(
        outcome.result_excerpt.as_deref().unwrap().chars().count(),
        RUN_RESULT_EXCERPT_CHARS
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn snapshot_reads_are_passive_over_pending_inbox_and_active_goal() {
    let path = test_path("passive");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    task(&path, "p1", "t", "x", "", "2026-01-01T00:00:01Z");
    let goal = create_session_goal(&path, "t", "keep going", None, None).unwrap();
    let item =
        create_session_inbox_item(&path, "t", InboxDelivery::Queue, "later", None, None).unwrap();
    let digest = |path: &Path| {
        let conn = open_runtime_connection(path).unwrap();
        conn.query_row(
            "SELECT s.updated_at, g.version, g.updated_at,
                    (SELECT group_concat(status || ':' || version) FROM session_inbox WHERE session_id = 't'),
                    (SELECT COUNT(*) FROM session_run_recovery WHERE session_id = 't')
             FROM sessions s JOIN session_goals g ON g.session_id = s.session_id
             WHERE s.session_id = 't'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            },
        )
        .unwrap()
    };
    let before = digest(&path);
    for _ in 0..3 {
        let TaskLookup::Found(snapshot) = load_direct_task(&path, "t").unwrap() else {
            panic!("task should be found");
        };
        assert_eq!(snapshot.pending_inbox_items, 1);
        assert_eq!(snapshot.goal.as_ref().unwrap().goal_id, goal.goal_id);
        assert_eq!(snapshot.current_run, None);
        search_direct_tasks(&path, &search(&path, "p1"))
            .unwrap()
            .unwrap();
    }
    assert_eq!(digest(&path), before);
    assert_eq!(
        load_session_inbox_item(&path, "t", item.id).unwrap().status,
        item.status
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn retained_evidence_is_credential_redacted() {
    let path = test_path("redact");
    initialize(&path).unwrap();
    insert_test_session(&path, "t");
    let leaked = "the token Bearer sk-live-abcdef was rejected";
    let failure = crate::run_failure::RunFailure {
        kind: crate::run_failure::RunFailureKind::Transport,
        phase: crate::run_failure::RunFailurePhase::Stream,
        transient: false,
        partial_output: crate::run_failure::PartialModelOutput::default(),
        attempt_count: 1,
        http_status: None,
        retry_after_ms: None,
        summary: leaked.into(),
        diagnostic: leaked.into(),
        recovery_action: crate::run_failure::RecoveryAction::AutomaticRetry,
    };
    let conn = open_runtime_connection(&path).unwrap();
    record_run_outcome_with_connection(
        &conn,
        "t",
        "failed-run",
        RunOutcomeDisposition::Failed,
        None,
        Some(&failure),
    )
    .unwrap();
    record_run_outcome_with_connection(
        &conn,
        "t",
        "completed-run",
        RunOutcomeDisposition::Completed,
        Some(leaked),
        None,
    )
    .unwrap();
    let stored: Vec<String> = conn
        .prepare("SELECT coalesce(failure_json, '') || coalesce(result_excerpt, '') FROM session_run_outcomes")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(stored.len(), 2);
    assert!(
        stored.iter().all(|row| !row.contains("sk-live-abcdef")),
        "{stored:?}"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn invisible_sessions_influence_no_match_or_page() {
    let path = test_path("visibility");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    task(
        &path,
        "p1",
        "hidden",
        "secret needle",
        "",
        "2026-01-01T00:00:02Z",
    );
    task(&path, "p1", "shown", "plain", "", "2026-01-01T00:00:01Z");
    let visible: TaskVisibility = std::sync::Arc::new(|session_id: &str| session_id != "hidden");
    let page = |text: &str| {
        search_direct_tasks(
            &path,
            &TaskSearch {
                text: Some(text.into()),
                visible: Some(std::sync::Arc::clone(&visible)),
                ..search(&path, "p1")
            },
        )
        .unwrap()
        .unwrap()
    };
    // Matching only the hidden session must look like matching nothing.
    assert_eq!(page("needle"), page("absent-everywhere"));
    let unfiltered = search_direct_tasks(
        &path,
        &TaskSearch {
            visible: Some(std::sync::Arc::clone(&visible)),
            ..search(&path, "p1")
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(ids(&unfiltered), ["shown"]);
    assert_eq!(unfiltered.scanned_rows, 1);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn returned_prompt_and_goal_text_is_credential_redacted() {
    let path = test_path("redact_read");
    initialize(&path).unwrap();
    project(&path, "p1", "/tmp/project");
    let leaked = "use Bearer sk-live-abcdef for this";
    task(&path, "p1", "t", "ALL-1", leaked, "2026-01-01T00:00:01Z");
    let prior = create_session_goal(&path, "t", leaked, None, None).unwrap();
    clear_session_goal(&path, "t", &prior.goal_id, prior.version).unwrap();
    create_session_goal(&path, "t", leaked, None, None).unwrap();

    let TaskLookup::Found(snapshot) = load_direct_task(&path, "t").unwrap() else {
        panic!("task should be found");
    };
    let page = search_direct_tasks(&path, &search(&path, "p1"))
        .unwrap()
        .unwrap();
    let returned = format!("{snapshot:?} {page:?}");
    assert!(returned.contains("Bearer"), "{returned}");
    assert!(!returned.contains("sk-live-abcdef"), "{returned}");
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
