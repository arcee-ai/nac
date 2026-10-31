use super::*;
use rusqlite::TransactionBehavior;

fn fixture(label: &str) -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!(
            "nac_inbox_completion_{label}_{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    for session in ["parent", "child-a", "child-b", "orchestrator"] {
        crate::store::insert_test_session(&path, session);
    }
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct'
             WHERE session_id IN ('parent', 'child-a', 'child-b')",
            [],
        )
        .unwrap();
    for child in ["child-a", "child-b"] {
        create_traditional_child_relationship(&path, "parent", child, GENERAL_CHILD_PROFILE, child)
            .unwrap();
    }
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct-with-orchestrator' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    create_managed_orchestrator_relationship(&path, "parent", "orchestrator", "work").unwrap();
    path
}

fn begin_parent_run(path: &Path, run_id: &str) {
    TranscriptLogWriter::new(path)
        .unwrap()
        .append_run_prompt(
            "parent",
            0,
            &crate::types::Message::User {
                content: "parent work".to_owned(),
            },
            run_id,
        )
        .unwrap();
}

fn finish_parent_run(path: &Path, run_id: &str) {
    let mut connection = open_runtime_connection(path).unwrap();
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    clear_active_run(
        &transaction,
        "parent",
        run_id,
        RunTerminalDisposition::Completed,
    )
    .unwrap();
    transaction.commit().unwrap();
}

fn child_terminal() -> TraditionalChildTerminal {
    TraditionalChildTerminal {
        status: TraditionalChildStatus::Completed,
        report: Some("child report".to_owned()),
        failure: None,
        change_summary: None,
        verification_summary: None,
    }
}

fn origin(
    source: InternalCompletionSource,
    session: &str,
    generation: u64,
) -> InternalCompletionOrigin {
    InternalCompletionOrigin {
        source,
        relationship_session_id: session.to_owned(),
        generation,
    }
}

#[test]
fn settlement_pins_completions_to_the_active_parent_run_or_queues_one_successor() {
    let path = fixture("pinning");
    begin_parent_run(&path, "parent-run");
    begin_traditional_child_run(
        &path,
        "child-a",
        "run-a",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let first = settle_traditional_child_run(&path, "child-a", "run-a", child_terminal()).unwrap();
    let repeated =
        settle_traditional_child_run(&path, "child-a", "run-a", child_terminal()).unwrap();
    assert!(first.newly_settled && !repeated.newly_settled);
    let pinned =
        load_session_inbox_item(&path, "parent", first.child.completion_inbox_id.unwrap()).unwrap();
    assert_eq!(pinned.delivery, InboxDelivery::Steer);
    assert_eq!(pinned.target_run_id.as_deref(), Some("parent-run"));
    assert_eq!(
        pinned.internal_completion,
        Some(origin(
            InternalCompletionSource::TraditionalChild,
            "child-a",
            1
        ))
    );
    assert!(pinned.content.contains("child report"));

    // The active run's next boundary consumes it exactly once.
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let delivered = writer
        .append_pending_inbox_steers("parent", "parent-run", 1)
        .unwrap();
    assert_eq!(delivered.len(), 1);
    assert_eq!(delivered[0].id, pinned.id);
    assert_eq!(delivered[0].status, InboxStatus::Delivered);
    assert_eq!(delivered[0].delivered_run_id.as_deref(), Some("parent-run"));
    assert!(writer
        .append_pending_inbox_steers("parent", "parent-run", 2)
        .unwrap()
        .is_empty());
    finish_parent_run(&path, "parent-run");

    // An idle parent receives one queued successor item, never a steer.
    begin_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run-o",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let managed = settle_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run-o",
        ManagedOrchestratorTerminal {
            status: TraditionalChildStatus::Failed,
            report: None,
            failure: Some("orchestrator failed".to_owned()),
        },
    )
    .unwrap();
    let queued = load_session_inbox_item(
        &path,
        "parent",
        managed.orchestrator.completion_inbox_id.unwrap(),
    )
    .unwrap();
    assert_eq!(queued.delivery, InboxDelivery::Queue);
    assert_eq!(queued.target_run_id, None);
    assert_eq!(
        queued.internal_completion,
        Some(origin(
            InternalCompletionSource::ManagedOrchestrator,
            "orchestrator",
            1
        ))
    );
    assert_eq!(
        next_pending_session_inbox_item(&path, "parent")
            .unwrap()
            .map(|item| item.id),
        Some(queued.id)
    );
    assert_eq!(list_session_inbox(&path, "parent").unwrap().len(), 2);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn a_completion_pinned_to_a_finished_parent_run_is_promoted_once_as_a_late_steer() {
    let path = fixture("late_steer");
    // The parent's durable run is still active, e.g. finishing after its last
    // model boundary or abandoned by a crashed process.
    begin_parent_run(&path, "finishing-run");
    let human = create_person_session_inbox_item(
        &path,
        "parent",
        InboxDelivery::Queue,
        "human queued later",
        None,
        Some("client"),
        "human queued later",
    )
    .unwrap();
    begin_traditional_child_run(
        &path,
        "child-a",
        "run-a",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let settled =
        settle_traditional_child_run(&path, "child-a", "run-a", child_terminal()).unwrap();
    let late_id = settled.child.completion_inbox_id.unwrap();
    finish_parent_run(&path, "finishing-run");

    // Successor admission keeps the established FIFO over every pending item.
    let next = next_pending_session_inbox_item(&path, "parent")
        .unwrap()
        .unwrap();
    assert_eq!(next.id, human.id);
    let writer = TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_inbox_run_prompt(
            "parent",
            1,
            &crate::types::Message::User {
                content: next.content.clone(),
            },
            "human-run",
            next.id,
        )
        .unwrap();
    finish_parent_run(&path, "human-run");
    let next = next_pending_session_inbox_item(&path, "parent")
        .unwrap()
        .unwrap();
    assert_eq!(next.id, late_id);
    assert_eq!(next.target_run_id.as_deref(), Some("finishing-run"));
    writer
        .append_inbox_run_prompt(
            "parent",
            2,
            &crate::types::Message::User {
                content: next.content.clone(),
            },
            "successor-run",
            next.id,
        )
        .unwrap();
    let delivered = load_session_inbox_item(&path, "parent", late_id).unwrap();
    assert_eq!(delivered.status, InboxStatus::Delivered);
    assert_eq!(delivered.delivered_run_id.as_deref(), Some("successor-run"));
    assert!(next_pending_session_inbox_item(&path, "parent")
        .unwrap()
        .is_none());
    // The original run can no longer consume it.
    assert!(writer
        .append_pending_inbox_steers("parent", "finishing-run", 3)
        .unwrap()
        .is_empty());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn suppressed_completion_restores_once_with_provenance_and_stays_read_only() {
    let path = fixture("suppression");
    begin_traditional_child_run(
        &path,
        "child-b",
        "run-b",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let suppressed = suppress_traditional_child_completion(&path, "child-b").unwrap();
    let settled =
        settle_traditional_child_run(&path, "child-b", "run-b", child_terminal()).unwrap();
    assert!(settled.child.completion_inbox_id.is_none());
    assert!(list_session_inbox(&path, "parent").unwrap().is_empty());

    begin_parent_run(&path, "parent-run");
    restore_traditional_child_completion(&path, "child-b", suppressed.generation).unwrap();
    restore_traditional_child_completion(&path, "child-b", suppressed.generation).unwrap();
    let inbox = list_session_inbox(&path, "parent").unwrap();
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0].delivery, InboxDelivery::Steer);
    assert_eq!(inbox[0].target_run_id.as_deref(), Some("parent-run"));
    assert_eq!(
        inbox[0].internal_completion,
        Some(origin(
            InternalCompletionSource::TraditionalChild,
            "child-b",
            1
        ))
    );

    for refused in [
        update_pending_session_inbox_item(
            &path,
            "parent",
            inbox[0].id,
            inbox[0].version,
            InboxDelivery::Queue,
            None,
        )
        .unwrap_err(),
        cancel_pending_session_inbox_item(&path, "parent", inbox[0].id, inbox[0].version)
            .unwrap_err(),
    ] {
        assert_eq!(
            refused.downcast_ref::<InternalInboxItemError>(),
            Some(&InternalInboxItemError {
                item_id: inbox[0].id
            })
        );
    }
    // Another session cannot learn more than the ordinary not-found answer.
    let foreign = cancel_pending_session_inbox_item(&path, "child-a", inbox[0].id, 0).unwrap_err();
    assert!(foreign.downcast_ref::<InternalInboxItemError>().is_none());
    assert!(foreign.to_string().contains("was not found"));
    assert_eq!(list_session_inbox(&path, "parent").unwrap(), inbox);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
