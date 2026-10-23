use super::*;

fn fixture(label: &str) -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-child-receipt-{label}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "parent");
    insert_test_session(&path, "child");
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute("UPDATE sessions SET behavior = 'direct'", [])
        .unwrap();
    create_traditional_child_relationship(&path, "parent", "child", GENERAL_CHILD_PROFILE, "work")
        .unwrap();
    path
}

fn terminal(status: TraditionalChildStatus) -> TraditionalChildTerminal {
    TraditionalChildTerminal {
        status,
        report: (status == TraditionalChildStatus::Completed).then(|| "verified result".to_owned()),
        failure: (status != TraditionalChildStatus::Completed).then(|| "exact failure".to_owned()),
        change_summary: Some("1 file changed".to_owned()),
        verification_summary: Some("test results".to_owned()),
    }
}

#[test]
fn terminal_receipt_by_run_is_session_scoped_after_successor_settlement() {
    let path = fixture("run-lookup");
    begin_traditional_child_run(
        &path,
        "child",
        "first",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let first = settle_traditional_child_run(
        &path,
        "child",
        "first",
        terminal(TraditionalChildStatus::Failed),
    )
    .unwrap()
    .child;
    begin_traditional_child_run(
        &path,
        "child",
        "second",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let second = settle_traditional_child_run(
        &path,
        "child",
        "second",
        terminal(TraditionalChildStatus::Completed),
    )
    .unwrap()
    .child;
    insert_test_session(&path, "other");
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct' WHERE session_id = 'other'",
            [],
        )
        .unwrap();
    create_traditional_child_relationship(
        &path,
        "parent",
        "other",
        GENERAL_CHILD_PROFILE,
        "other work",
    )
    .unwrap();
    begin_traditional_child_run(
        &path,
        "other",
        "first",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    let other = settle_traditional_child_run(
        &path,
        "other",
        "first",
        terminal(TraditionalChildStatus::Cancelled),
    )
    .unwrap()
    .child;
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "child", "first").unwrap(),
        Some(first)
    );
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "child", "second").unwrap(),
        Some(second)
    );
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "other", "first").unwrap(),
        Some(other.clone())
    );
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "other", "second").unwrap(),
        None
    );
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "child", "unknown").unwrap(),
        None
    );
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "unknown", "first").unwrap(),
        None
    );
    crate::sessions::delete_session(&path, "child").unwrap();
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "child", "first").unwrap(),
        None
    );
    assert_eq!(
        load_traditional_child_terminal_receipt_for_run(&path, "other", "first").unwrap(),
        Some(other)
    );
}

#[test]
fn terminal_receipts_preserve_each_outcome_after_successor_admission() {
    let path = fixture("generations");
    let mut outcomes = Vec::new();
    for (index, status) in [
        TraditionalChildStatus::Completed,
        TraditionalChildStatus::Failed,
        TraditionalChildStatus::Cancelled,
        TraditionalChildStatus::Interrupted,
    ]
    .into_iter()
    .enumerate()
    {
        let run = format!("run-{index}");
        let running = begin_traditional_child_run(
            &path,
            "child",
            &run,
            TraditionalChildExecutionMode::Background,
        )
        .unwrap();
        assert_eq!(
            load_traditional_child_terminal_receipt(&path, "child", running.generation).unwrap(),
            None
        );
        let settled = settle_traditional_child_run(&path, "child", &run, terminal(status)).unwrap();
        assert!(settled.child.completion_inbox_id.is_some());
        assert_eq!(
            load_traditional_child_terminal_receipt(&path, "child", running.generation).unwrap(),
            Some(settled.child.clone())
        );
        // A conflicting second completion is idempotent, including its receipt.
        let duplicate = settle_traditional_child_run(
            &path,
            "child",
            &run,
            terminal(TraditionalChildStatus::Completed),
        )
        .unwrap();
        assert!(!duplicate.newly_settled);
        assert_eq!(duplicate.child, settled.child);
        outcomes.push(settled.child);
    }
    begin_traditional_child_run(
        &path,
        "child",
        "run-next",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    initialize(&path).unwrap();
    for outcome in outcomes {
        assert_eq!(
            load_traditional_child_terminal_receipt(&path, "child", outcome.generation).unwrap(),
            Some(outcome)
        );
    }
    assert_eq!(list_session_inbox(&path, "parent").unwrap().len(), 4);
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "missing", 1).unwrap(),
        None
    );
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "child", 5).unwrap(),
        None
    );
    assert!(settle_traditional_child_run(
        &path,
        "child",
        "wrong-run",
        terminal(TraditionalChildStatus::Completed)
    )
    .is_err());
}

#[test]
fn terminal_receipt_failure_rolls_back_relationship_and_parent_delivery() {
    let path = fixture("atomicity");
    begin_traditional_child_run(
        &path,
        "child",
        "run",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_receipt BEFORE INSERT ON traditional_child_terminal_receipts BEGIN SELECT RAISE(ABORT, 'receipt storage failed'); END;").unwrap();
    assert!(settle_traditional_child_run(
        &path,
        "child",
        "run",
        terminal(TraditionalChildStatus::Completed)
    )
    .is_err());
    assert_eq!(
        load_traditional_child(&path, "child")
            .unwrap()
            .unwrap()
            .status,
        TraditionalChildStatus::Running
    );
    assert!(list_session_inbox(&path, "parent").unwrap().is_empty());
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "child", 1).unwrap(),
        None
    );
    connection
        .execute_batch("DROP TRIGGER reject_receipt")
        .unwrap();
    let settled = settle_traditional_child_run(
        &path,
        "child",
        "run",
        terminal(TraditionalChildStatus::Completed),
    )
    .unwrap();
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "child", 1).unwrap(),
        Some(settled.child)
    );
}

#[test]
fn terminal_receipts_reject_wrong_run_identity_and_follow_deletion() {
    for deleted in ["parent", "child"] {
        let path = fixture(deleted);
        begin_traditional_child_run(
            &path,
            "child",
            "run",
            TraditionalChildExecutionMode::Foreground,
        )
        .unwrap();
        let settled = settle_traditional_child_run(
            &path,
            "child",
            "run",
            terminal(TraditionalChildStatus::Failed),
        )
        .unwrap();
        let connection = open_runtime_connection(&path).unwrap();
        let mut wrong = settled.child.clone();
        wrong.run_id = Some("another-run".to_owned());
        assert!(insert_terminal_receipt(&connection, &wrong).is_err());
        assert_eq!(
            load_traditional_child_terminal_receipt(&path, "child", 1).unwrap(),
            Some(settled.child)
        );
        crate::sessions::delete_session(&path, deleted).unwrap();
        assert_eq!(
            load_traditional_child_terminal_receipt(&path, "child", 1).unwrap(),
            None
        );
        let retained: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM traditional_child_terminal_receipts",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, 0);
    }
}
