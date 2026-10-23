use super::*;

fn fixture(label: &str) -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-managed-receipt-{label}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    insert_test_session(&path, "parent");
    insert_test_session(&path, "orchestrator");
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct-with-orchestrator' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    create_managed_orchestrator_relationship(&path, "parent", "orchestrator", "work").unwrap();
    path
}

fn terminal(status: ManagedOrchestratorStatus) -> ManagedOrchestratorTerminal {
    ManagedOrchestratorTerminal {
        status,
        report: (status == ManagedOrchestratorStatus::Completed)
            .then(|| "verified result".to_owned()),
        failure: (status != ManagedOrchestratorStatus::Completed)
            .then(|| "exact failure".to_owned()),
    }
}

#[test]
fn terminal_receipts_preserve_each_outcome_after_successor_admission() {
    let path = fixture("generations");
    let mut outcomes = Vec::new();
    for (index, status) in [
        ManagedOrchestratorStatus::Completed,
        ManagedOrchestratorStatus::Failed,
        ManagedOrchestratorStatus::Cancelled,
        ManagedOrchestratorStatus::Interrupted,
    ]
    .into_iter()
    .enumerate()
    {
        let run = format!("run-{index}");
        let running = begin_managed_orchestrator_run(
            &path,
            "orchestrator",
            &run,
            ManagedOrchestratorExecutionMode::Background,
        )
        .unwrap();
        assert_eq!(
            load_managed_orchestrator_terminal_receipt(&path, "orchestrator", running.generation)
                .unwrap(),
            None
        );
        let settled =
            settle_managed_orchestrator_run(&path, "orchestrator", &run, terminal(status)).unwrap();
        assert!(settled.orchestrator.completion_inbox_id.is_some());
        assert_eq!(
            load_managed_orchestrator_terminal_receipt(&path, "orchestrator", running.generation)
                .unwrap(),
            Some(settled.orchestrator.clone())
        );
        let duplicate = settle_managed_orchestrator_run(
            &path,
            "orchestrator",
            &run,
            terminal(ManagedOrchestratorStatus::Completed),
        )
        .unwrap();
        assert!(!duplicate.newly_settled);
        assert_eq!(duplicate.orchestrator, settled.orchestrator);
        outcomes.push(settled.orchestrator);
    }
    begin_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run-next",
        ManagedOrchestratorExecutionMode::Foreground,
    )
    .unwrap();
    initialize(&path).unwrap();
    for outcome in outcomes {
        assert_eq!(
            load_managed_orchestrator_terminal_receipt(&path, "orchestrator", outcome.generation)
                .unwrap(),
            Some(outcome)
        );
    }
    assert_eq!(list_session_inbox(&path, "parent").unwrap().len(), 4);
    assert_eq!(
        load_managed_orchestrator_terminal_receipt(&path, "missing", 1).unwrap(),
        None
    );
    assert_eq!(
        load_managed_orchestrator_terminal_receipt(&path, "orchestrator", 5).unwrap(),
        None
    );
    assert!(settle_managed_orchestrator_run(
        &path,
        "orchestrator",
        "wrong-run",
        terminal(ManagedOrchestratorStatus::Completed)
    )
    .is_err());
}

#[test]
fn terminal_receipt_failure_rolls_back_relationship_and_parent_delivery() {
    let path = fixture("atomicity");
    begin_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run",
        ManagedOrchestratorExecutionMode::Background,
    )
    .unwrap();
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER reject_receipt BEFORE INSERT ON managed_orchestrator_terminal_receipts BEGIN SELECT RAISE(ABORT, 'receipt storage failed'); END;").unwrap();
    assert!(settle_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run",
        terminal(ManagedOrchestratorStatus::Completed)
    )
    .is_err());
    assert_eq!(
        load_managed_orchestrator(&path, "orchestrator")
            .unwrap()
            .unwrap()
            .status,
        ManagedOrchestratorStatus::Running
    );
    assert!(list_session_inbox(&path, "parent").unwrap().is_empty());
    assert_eq!(
        load_managed_orchestrator_terminal_receipt(&path, "orchestrator", 1).unwrap(),
        None
    );
    connection
        .execute_batch("DROP TRIGGER reject_receipt")
        .unwrap();
    let settled = settle_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run",
        terminal(ManagedOrchestratorStatus::Completed),
    )
    .unwrap();
    assert_eq!(
        load_managed_orchestrator_terminal_receipt(&path, "orchestrator", 1).unwrap(),
        Some(settled.orchestrator)
    );
}

#[test]
fn terminal_receipts_reject_wrong_run_identity_and_follow_deletion() {
    for deleted in ["parent", "orchestrator"] {
        let path = fixture(deleted);
        begin_managed_orchestrator_run(
            &path,
            "orchestrator",
            "run",
            ManagedOrchestratorExecutionMode::Foreground,
        )
        .unwrap();
        let settled = settle_managed_orchestrator_run(
            &path,
            "orchestrator",
            "run",
            terminal(ManagedOrchestratorStatus::Cancelled),
        )
        .unwrap();
        let connection = open_runtime_connection(&path).unwrap();
        let mut wrong = settled.orchestrator.clone();
        wrong.run_id = Some("another-run".to_owned());
        assert!(insert_terminal_receipt(&connection, &wrong).is_err());
        assert_eq!(
            load_managed_orchestrator_terminal_receipt(&path, "orchestrator", 1).unwrap(),
            Some(settled.orchestrator)
        );
        crate::sessions::delete_session(&path, deleted).unwrap();
        assert_eq!(
            load_managed_orchestrator_terminal_receipt(&path, "orchestrator", 1).unwrap(),
            None
        );
        let retained: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM managed_orchestrator_terminal_receipts",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, 0);
    }
}
