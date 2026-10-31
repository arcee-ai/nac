use super::*;

fn raw_inbox_row(connection: &Connection, id: i64) -> String {
    connection
        .query_row(
            "SELECT json_array(id, session_id, delivery, status, content, target_run_id,
                    client_id, delivered_run_id, created_at, updated_at, delivered_at,
                    cancelled_at, version, admission_id, admission_digest,
                    child_execution_mode, child_wait_id, review_intent)
             FROM session_inbox WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .unwrap()
}

fn settle_background_child(path: &Path, child: &str, run_id: &str) -> TraditionalChildRecord {
    begin_traditional_child_run(
        path,
        child,
        run_id,
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    settle_traditional_child_run(
        path,
        child,
        run_id,
        TraditionalChildTerminal {
            status: TraditionalChildStatus::Completed,
            report: Some(format!("{child} report")),
            failure: None,
            change_summary: None,
            verification_summary: None,
        },
    )
    .unwrap()
    .child
}

/// Seeds the rows a dev (schema 40) store could hold, then removes the new
/// provenance so the upgrade must rely only on durable relationship/receipt
/// evidence.
#[test]
fn migration_41_classifies_only_pending_completions_with_durable_evidence() {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-internal-completion-migration-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    for session in ["parent", "child-a", "child-b", "child-c", "orchestrator"] {
        insert_test_session(&path, session);
    }
    let connection = open_runtime_connection(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct'
             WHERE session_id IN ('parent', 'child-a', 'child-b', 'child-c')",
            [],
        )
        .unwrap();
    for child in ["child-a", "child-b", "child-c"] {
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

    // Current relationship evidence.
    let a = settle_background_child(&path, "child-a", "run-a");
    // Receipt-only evidence: the next generation cleared the relationship's id.
    let b = settle_background_child(&path, "child-b", "run-b1");
    begin_traditional_child_run(
        &path,
        "child-b",
        "run-b2",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    assert!(load_traditional_child(&path, "child-b")
        .unwrap()
        .unwrap()
        .completion_inbox_id
        .is_none());
    // A historical completion that was already delivered before the upgrade.
    let c = settle_background_child(&path, "child-c", "run-c");
    connection
        .execute(
            "UPDATE session_inbox SET status = 'delivered', delivered_run_id = 'parent-run',
                 delivered_at = updated_at, version = version + 1
             WHERE id = ?1",
            params![c.completion_inbox_id.unwrap()],
        )
        .unwrap();
    begin_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run-o",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let orchestrator = settle_managed_orchestrator_run(
        &path,
        "orchestrator",
        "run-o",
        ManagedOrchestratorTerminal {
            status: TraditionalChildStatus::Completed,
            report: Some("orchestrated".to_owned()),
            failure: None,
        },
    )
    .unwrap()
    .orchestrator;

    let a_id = a.completion_inbox_id.unwrap();
    let b_id = b.completion_inbox_id.unwrap();
    let c_id = c.completion_inbox_id.unwrap();
    let o_id = orchestrator.completion_inbox_id.unwrap();
    let completion_text = load_session_inbox_item(&path, "parent", a_id)
        .unwrap()
        .content;
    // Lookalike text never grants internal origin, whoever submitted it.
    let mimic = create_session_inbox_item(
        &path,
        "parent",
        InboxDelivery::Queue,
        &completion_text,
        None,
        None,
    )
    .unwrap();
    let person_mimic = create_person_session_inbox_item(
        &path,
        "parent",
        InboxDelivery::Queue,
        &completion_text,
        None,
        Some("client"),
        &completion_text,
    )
    .unwrap();

    connection
        .execute_batch(
            "UPDATE session_inbox SET completion_source = NULL, completion_session_id = NULL,
                 completion_generation = NULL;
             ALTER TABLE session_inbox DROP COLUMN completion_generation;
             ALTER TABLE session_inbox DROP COLUMN completion_session_id;
             ALTER TABLE session_inbox DROP COLUMN completion_source;
             PRAGMA user_version = 40;",
        )
        .unwrap();
    drop(connection);
    let legacy = Connection::open(&path).unwrap();
    let before =
        [a_id, b_id, c_id, o_id, mimic.id, person_mimic.id].map(|id| raw_inbox_row(&legacy, id));
    drop(legacy);

    // A failed upgrade leaves the dev shape and its rows untouched.
    assert!(initialize_with_hooks(&path, || {}, || {}, || Err(anyhow!("before commit"))).is_err());
    let legacy = Connection::open(&path).unwrap();
    assert!(!column_exists(&legacy, "session_inbox", "completion_source").unwrap());
    assert_eq!(
        legacy
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        40
    );
    drop(legacy);

    initialize(&path).unwrap();
    initialize(&path).unwrap();
    let origin = |id| {
        load_session_inbox_item(&path, "parent", id)
            .unwrap()
            .internal_completion
    };
    assert_eq!(
        origin(a_id),
        Some(InternalCompletionOrigin {
            source: InternalCompletionSource::TraditionalChild,
            relationship_session_id: "child-a".to_owned(),
            generation: 1,
        })
    );
    assert_eq!(
        origin(b_id),
        Some(InternalCompletionOrigin {
            source: InternalCompletionSource::TraditionalChild,
            relationship_session_id: "child-b".to_owned(),
            generation: 1,
        })
    );
    assert_eq!(
        origin(o_id),
        Some(InternalCompletionOrigin {
            source: InternalCompletionSource::ManagedOrchestrator,
            relationship_session_id: "orchestrator".to_owned(),
            generation: 1,
        })
    );
    assert_eq!(origin(c_id), None, "delivered history is not rewritten");
    assert_eq!(origin(mimic.id), None);
    assert_eq!(origin(person_mimic.id), None);

    // Classification adds provenance only: every committed fact is unchanged.
    let upgraded = open_runtime_connection(&path).unwrap();
    let after =
        [a_id, b_id, c_id, o_id, mimic.id, person_mimic.id].map(|id| raw_inbox_row(&upgraded, id));
    assert_eq!(before, after);
    assert!(upgraded
        .execute(
            "UPDATE session_inbox SET completion_source = 'person' WHERE id = ?1",
            params![mimic.id],
        )
        .is_err());
    assert!(upgraded
        .execute(
            "UPDATE session_inbox SET completion_source = 'traditional_child' WHERE id = ?1",
            params![mimic.id],
        )
        .is_err());
    drop(upgraded);

    let refused = update_pending_session_inbox_item(
        &path,
        "parent",
        a_id,
        0,
        InboxDelivery::Steer,
        Some("run"),
    )
    .unwrap_err();
    assert!(refused.downcast_ref::<InternalInboxItemError>().is_some());
    assert!(cancel_pending_session_inbox_item(&path, "parent", o_id, 0)
        .unwrap_err()
        .downcast_ref::<InternalInboxItemError>()
        .is_some());
    let edited = update_pending_session_inbox_item(
        &path,
        "parent",
        mimic.id,
        0,
        InboxDelivery::Steer,
        Some("run"),
    )
    .unwrap();
    assert_eq!(edited.delivery, InboxDelivery::Steer);
    assert_eq!(
        cancel_pending_session_inbox_item(&path, "parent", person_mimic.id, 0)
            .unwrap()
            .status,
        InboxStatus::Cancelled
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
