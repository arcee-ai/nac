use super::*;

fn fixture() -> (PathBuf, PeerGoalStart) {
    let path = std::env::temp_dir()
        .join(format!("nac-peer-goal-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["caller", "target"] {
        insert_test_session(&path, id);
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior = 'direct', cwd = '/repo' WHERE session_id = ?1",
                [id],
            )
            .unwrap();
    }
    insert_project(
        &path,
        NewProject {
            project_id: "project".into(),
            name: None,
            description: None,
            cwd: PathBuf::from("/repo"),
            ssh_host: None,
            ssh_port: None,
            ssh_identity_file: None,
            default_model_config_id: None,
        },
    )
    .unwrap();
    assign_session_to_project(&path, "project", "target").unwrap();
    let request = PeerGoalStart {
        caller_session_id: "caller".into(),
        request_id: "request".into(),
        target_session_id: "target".into(),
        project_id: Some("project".into()),
        objective: "finite objective".into(),
        token_budget: Some(100),
    };
    (path, request)
}

#[test]
fn lost_ack_restart_replays_original_after_completion_replacement_and_clear() {
    let (path, request) = fixture();
    let first = start_peer_goal(&path, &request, None, 0).unwrap();
    let goal = &first.admitted_goal;
    update_session_goal_by_model(&path, "target", &goal.goal_id, GoalStatus::Complete).unwrap();
    let replacement = create_session_goal(&path, "target", "next objective", None, None).unwrap();
    clear_session_goal(&path, "target", &replacement.goal_id, replacement.version).unwrap();
    // New connections simulate process state loss; no cache participates.
    initialize(&path).unwrap();
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap().unwrap(),
        first
    );
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), first);
    assert!(load_session_goal(&path, "target").unwrap().is_none());
    let mut changed = request.clone();
    changed.objective.push('!');
    assert!(start_peer_goal(&path, &changed, None, 0)
        .unwrap_err()
        .to_string()
        .contains("conflict"));
    let mut changed = request.clone();
    changed.token_budget = Some(200);
    assert!(lookup_peer_goal_start(&path, &changed).is_err());
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "target").unwrap() else {
        panic!()
    };
    assert!(snapshot
        .prior_goals
        .iter()
        .any(|prior| prior.goal_id == goal.goal_id && prior.status == GoalStatus::Complete));
}

#[test]
fn concurrent_identical_start_has_one_identity_changed_arguments_conflict() {
    let (path, request) = fixture();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(3));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            let path = path.clone();
            let request = request.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                start_peer_goal(&path, &request, None, 0).unwrap()
            })
        })
        .collect();
    barrier.wait();
    let mut results = workers.into_iter().map(|w| w.join().unwrap());
    assert_eq!(results.next().unwrap(), results.next().unwrap());
}

#[test]
fn pause_keeps_active_baseline_and_resume_waits_for_settlement_and_remaining_budget() {
    let (path, request) = fixture();
    let baseline = GoalRunBaseline {
        run_id: "running".into(),
        billable_tokens: 80,
        started_at_epoch_ms: 1000,
        continuation: false,
    };
    let goal = start_peer_goal(&path, &request, Some(&baseline), 0)
        .unwrap()
        .admitted_goal;
    let paused = transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        goal.version,
        false,
        Some("running"),
        "project",
    )
    .unwrap();
    assert_eq!(paused.accounting_token_baseline, Some(80));
    assert!(transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        paused.version,
        true,
        Some("running"),
        "project"
    )
    .is_err());
    let settled = settle_session_goal_run(
        &path,
        "target",
        "running",
        110,
        2000,
        GoalRunDisposition::Completed,
    )
    .unwrap()
    .unwrap();
    assert_eq!(settled.status, GoalStatus::Paused);
    assert_eq!(settled.remaining_tokens(), Some(70));
    assert!(transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        paused.version,
        true,
        None,
        "project"
    )
    .is_err());
    let resumed = transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        settled.version,
        true,
        None,
        "project",
    )
    .unwrap();
    assert_eq!(resumed.remaining_tokens(), Some(70));
    assert_eq!(resumed.goal_id, goal.goal_id);
}

#[test]
fn stale_human_mutation_terminal_budget_and_accounting_are_fenced() {
    let (path, request) = fixture();
    let goal = start_peer_goal(&path, &request, None, 0)
        .unwrap()
        .admitted_goal;
    let human = update_session_goal_by_user(
        &path,
        "target",
        &goal.goal_id,
        goal.version,
        UserGoalUpdate {
            objective: Some("human changed".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        goal.version,
        false,
        None,
        "project"
    )
    .is_err());
    let paused = transition_peer_goal(
        &path,
        "target",
        &human.goal_id,
        human.version,
        false,
        None,
        "project",
    )
    .unwrap();
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE session_goals SET tokens_used = token_budget WHERE session_id = 'target'",
            [],
        )
        .unwrap();
    assert!(transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        paused.version,
        true,
        None,
        "project"
    )
    .is_err());
    let completed =
        update_session_goal_by_model(&path, "target", &goal.goal_id, GoalStatus::Complete).unwrap();
    assert!(transition_peer_goal(
        &path,
        "target",
        &goal.goal_id,
        completed.version,
        false,
        None,
        "project"
    )
    .is_err());
    assert_eq!(
        load_session_goal(&path, "target").unwrap().unwrap().status,
        GoalStatus::Complete
    );
}

#[test]
fn start_rolls_back_receipt_and_goal_when_scope_or_topology_is_unsupported() {
    let (path, mut request) = fixture();
    request.project_id = Some("wrong".into());
    assert!(start_peer_goal(&path, &request, None, 0).is_err());
    request.project_id = Some("project".into());
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET behavior = 'direct-with-orchestrator' WHERE session_id = 'target'",
            [],
        )
        .unwrap();
    assert!(start_peer_goal(&path, &request, None, 0).is_err());
    assert!(lookup_peer_goal_start(&path, &request).unwrap().is_none());
    assert!(load_session_goal(&path, "target").unwrap().is_none());
}

#[test]
fn traditional_child_cannot_be_started_even_when_its_direct_behavior_and_project_match() {
    let (path, request) = fixture();
    create_traditional_child_relationship(
        &path,
        "caller",
        "target",
        GENERAL_CHILD_PROFILE,
        "child",
    )
    .unwrap();
    assert!(start_peer_goal(&path, &request, None, 0).is_err());
    assert!(lookup_peer_goal_start(&path, &request).unwrap().is_none());
}

#[test]
fn active_accounting_from_another_owner_cannot_be_paused_or_resumed() {
    let (path, request) = fixture();
    let baseline = GoalRunBaseline {
        run_id: "foreign".into(),
        billable_tokens: 50,
        started_at_epoch_ms: 1,
        continuation: false,
    };
    let goal = start_peer_goal(&path, &request, Some(&baseline), 0)
        .unwrap()
        .admitted_goal;
    for actual in [None, Some("other")] {
        assert!(transition_peer_goal(
            &path,
            "target",
            &goal.goal_id,
            goal.version,
            false,
            actual,
            "project"
        )
        .is_err());
    }
    assert_eq!(load_session_goal(&path, "target").unwrap().unwrap(), goal);
}

fn transition_peer_goal(
    path: &Path,
    session_id: &str,
    goal_id: &str,
    expected_version: i64,
    resume: bool,
    active_run_id: Option<&str>,
    project_id: &str,
) -> Result<SessionGoalRecord> {
    super::transition_peer_goal(
        path,
        &PeerGoalTransition {
            session_id: session_id.to_owned(),
            goal_id: goal_id.to_owned(),
            expected_version,
            resume,
            active_run_id: active_run_id.map(str::to_owned),
            project_id: Some(project_id.to_owned()),
            config_version: 0,
        },
    )
}

#[test]
fn committed_start_survives_owner_process_exit_without_acknowledgement() {
    let (path, request) = fixture();
    let arguments = path.parent().unwrap().join("request.json");
    std::fs::write(&arguments, serde_json::to_vec(&request).unwrap()).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "store::peer_goals::tests::restart_writer_exits_after_commit",
            "--nocapture",
        ])
        .env("NAC_PEER_GOAL_RESTART_PATH", &path)
        .env("NAC_PEER_GOAL_RESTART_ARGUMENTS", &arguments)
        .status()
        .unwrap();
    assert!(status.success());
    let receipt = lookup_peer_goal_start(&path, &request)
        .unwrap()
        .expect("child committed before exiting");
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), receipt);
    assert_eq!(
        load_session_goal(&path, "target").unwrap().unwrap().goal_id,
        receipt.admitted_goal.goal_id
    );
}

#[test]
fn restart_writer_exits_after_commit() {
    let Some(path) = std::env::var_os("NAC_PEER_GOAL_RESTART_PATH") else {
        return;
    };
    let request: PeerGoalStart = serde_json::from_slice(
        &std::fs::read(std::env::var_os("NAC_PEER_GOAL_RESTART_ARGUMENTS").unwrap()).unwrap(),
    )
    .unwrap();
    start_peer_goal(Path::new(&path), &request, None, 0).unwrap();
    // The parent receives no admission response or in-memory goal identity.
    std::process::exit(0);
}

#[test]
fn configuration_change_between_preflight_and_commit_conflicts_atomically() {
    let (path, request) = fixture();
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET config_version = config_version + 1 WHERE session_id='target'",
            [],
        )
        .unwrap();
    assert!(start_peer_goal(&path, &request, None, 0).is_err());
    assert!(lookup_peer_goal_start(&path, &request).unwrap().is_none());
    assert!(load_session_goal(&path, "target").unwrap().is_none());
}

#[test]
fn authorized_resume_uses_existing_human_owner_for_blocked_and_usage_limited_goals() {
    let (path, request) = fixture();
    let first = start_peer_goal(&path, &request, None, 0)
        .unwrap()
        .admitted_goal;
    let blocked =
        update_session_goal_by_model(&path, "target", &first.goal_id, GoalStatus::Blocked).unwrap();
    let resumed = transition_peer_goal(
        &path,
        "target",
        &first.goal_id,
        blocked.version,
        true,
        None,
        "project",
    )
    .unwrap();
    assert_eq!(resumed.status, GoalStatus::Active);
    let limited = update_session_goal_by_user(
        &path,
        "target",
        &first.goal_id,
        resumed.version,
        UserGoalUpdate {
            status: Some(GoalStatus::UsageLimited),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        transition_peer_goal(
            &path,
            "target",
            &first.goal_id,
            limited.version,
            true,
            None,
            "project"
        )
        .unwrap()
        .status,
        GoalStatus::Active
    );
}

#[test]
fn new_start_and_human_clear_retain_exact_completed_goal_version_and_run() {
    let (path, request) = fixture();
    let baseline = GoalRunBaseline {
        run_id: "original-run".into(),
        billable_tokens: 20,
        started_at_epoch_ms: 1000,
        continuation: false,
    };
    let original = start_peer_goal(&path, &request, Some(&baseline), 0).unwrap();
    update_session_goal_by_model(
        &path,
        "target",
        &original.admitted_goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let terminal = settle_session_goal_run(
        &path,
        "target",
        "original-run",
        50,
        2000,
        GoalRunDisposition::Completed,
    )
    .unwrap()
    .unwrap();
    let mut next = request.clone();
    next.request_id = "next".into();
    next.objective = "next finite objective".into();
    let replacement = start_peer_goal(&path, &next, None, 0)
        .unwrap()
        .admitted_goal;
    clear_session_goal(&path, "target", &replacement.goal_id, replacement.version).unwrap();
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "target").unwrap() else {
        panic!()
    };
    let retained = snapshot
        .prior_goals
        .iter()
        .find(|goal| goal.goal_id == terminal.goal_id)
        .unwrap();
    assert_eq!(retained.status, GoalStatus::Complete);
    assert_eq!(retained.version, terminal.version);
    assert_eq!(retained.tokens_used, 30);
    assert_eq!(retained.last_run_id.as_deref(), Some("original-run"));
    assert_eq!(start_peer_goal(&path, &request, None, 0).unwrap(), original);
}

#[test]
fn retiring_completion_during_later_active_run_keeps_that_run_not_the_previous_result() {
    let (path, request) = fixture();
    let receipt = start_peer_goal(&path, &request, None, 0).unwrap();
    let first = GoalRunBaseline {
        run_id: "previous-run".into(),
        billable_tokens: 0,
        started_at_epoch_ms: 1000,
        continuation: true,
    };
    bind_session_goal_run(&path, "target", &first).unwrap();
    settle_session_goal_run(
        &path,
        "target",
        "previous-run",
        10,
        2000,
        GoalRunDisposition::Completed,
    )
    .unwrap();
    let later = GoalRunBaseline {
        run_id: "completing-run".into(),
        started_at_epoch_ms: 3000,
        ..first
    };
    bind_session_goal_run(&path, "target", &later).unwrap();
    let completed = update_session_goal_by_model(
        &path,
        "target",
        &receipt.admitted_goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    assert_eq!(
        completed.accounting_run_id.as_deref(),
        Some("completing-run")
    );
    let mut replacement = request.clone();
    replacement.request_id = "replacement".into();
    replacement.objective = "next objective".into();
    assert!(start_peer_goal(&path, &replacement, Some(&later), 0).is_err());
    assert_eq!(
        load_session_goal(&path, "target").unwrap().unwrap(),
        completed
    );
    // Human replacement retains its established authority and the shared
    // evidence owner still binds the actual completing run.
    create_session_goal(
        &path,
        "target",
        &replacement.objective,
        replacement.token_budget,
        Some(&later),
    )
    .unwrap();
    let TaskLookup::Found(snapshot) = load_direct_task(&path, "target").unwrap() else {
        panic!()
    };
    let retained = snapshot
        .prior_goals
        .iter()
        .find(|goal| goal.goal_id == completed.goal_id)
        .unwrap();
    assert_eq!(retained.last_run_id.as_deref(), Some("completing-run"));
    assert_eq!(retained.version, completed.version);
    assert_eq!(retained.status, GoalStatus::Complete);
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap().unwrap(),
        receipt
    );
}

#[test]
fn fresh_start_waits_for_terminal_accounting_but_original_receipt_still_replays() {
    let (path, request) = fixture();
    let baseline = GoalRunBaseline {
        run_id: "unsettled".into(),
        billable_tokens: 10,
        started_at_epoch_ms: 1000,
        continuation: false,
    };
    let original = start_peer_goal(&path, &request, Some(&baseline), 0).unwrap();
    update_session_goal_by_model(
        &path,
        "target",
        &original.admitted_goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let mut next = request.clone();
    next.request_id = "next".into();
    assert!(start_peer_goal(&path, &next, None, 0).is_err());
    assert!(start_peer_goal(&path, &next, Some(&baseline), 0).is_err());
    assert!(lookup_peer_goal_start(&path, &next).unwrap().is_none());
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap().unwrap(),
        original
    );
}

#[test]
fn projectless_goal_receipt_and_transitions_bind_null_scope_and_preserve_budget() {
    let (path, mut request) = fixture();
    open_runtime_connection(&path)
        .unwrap()
        .execute("DELETE FROM session_projects WHERE session_id='target'", [])
        .unwrap();
    assert!(start_peer_goal(&path, &request, None, 0).is_err());
    request.project_id = None;
    let receipt = start_peer_goal(&path, &request, None, 0).unwrap();
    let mut transition = PeerGoalTransition {
        session_id: "target".into(),
        goal_id: receipt.admitted_goal.goal_id.clone(),
        expected_version: receipt.admitted_goal.version,
        resume: false,
        active_run_id: None,
        project_id: None,
        config_version: 0,
    };
    let paused = super::transition_peer_goal(&path, &transition).unwrap();
    transition.resume = true;
    transition.expected_version = paused.version;
    let resumed = super::transition_peer_goal(&path, &transition).unwrap();
    assert_eq!(resumed.status, GoalStatus::Active);
    assert_eq!(resumed.remaining_tokens(), Some(100));
    assert_eq!(
        lookup_peer_goal_start(&path, &request).unwrap(),
        Some(receipt)
    );
    let mut changed = request.clone();
    changed.project_id = Some("project".into());
    assert!(lookup_peer_goal_start(&path, &changed).is_err());
    assign_session_to_project(&path, "project", "target").unwrap();
    transition.resume = false;
    transition.expected_version = resumed.version;
    assert!(super::transition_peer_goal(&path, &transition).is_err());
    assert_eq!(
        load_session_goal(&path, "target").unwrap().unwrap(),
        resumed
    );
}
