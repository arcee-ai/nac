use super::*;

#[test]
fn migration_35_seeds_only_available_terminal_generations_and_is_restartable() {
    let path = std::env::temp_dir()
        .join(format!("nac-delegation-migration-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for session in ["parent", "child", "running-child", "orchestrator"] {
        insert_test_session(&path, session);
    }
    let connection = open_runtime_connection(&path).unwrap();
    connection.execute("UPDATE sessions SET behavior = 'direct' WHERE session_id IN ('parent', 'child', 'running-child')", []).unwrap();
    for child in ["child", "running-child"] {
        create_traditional_child_relationship(
            &path,
            "parent",
            child,
            GENERAL_CHILD_PROFILE,
            "work",
        )
        .unwrap();
    }
    connection
        .execute(
            "UPDATE sessions SET behavior = 'direct-with-orchestrator' WHERE session_id = 'parent'",
            [],
        )
        .unwrap();
    create_managed_orchestrator_relationship(&path, "parent", "orchestrator", "work").unwrap();

    let terminal = || TraditionalChildTerminal {
        status: TraditionalChildStatus::Failed,
        report: None,
        failure: Some("original failure".to_owned()),
        change_summary: Some("1 file".to_owned()),
        verification_summary: Some("failed verification".to_owned()),
    };
    begin_traditional_child_run(
        &path,
        "child",
        "child-old",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    settle_traditional_child_run(&path, "child", "child-old", terminal()).unwrap();
    begin_traditional_child_run(
        &path,
        "child",
        "child-current",
        TraditionalChildExecutionMode::Background,
    )
    .unwrap();
    let child = settle_traditional_child_run(&path, "child", "child-current", terminal())
        .unwrap()
        .child;
    begin_traditional_child_run(
        &path,
        "running-child",
        "child-active",
        TraditionalChildExecutionMode::Foreground,
    )
    .unwrap();
    begin_managed_orchestrator_run(
        &path,
        "orchestrator",
        "managed-current",
        ManagedOrchestratorExecutionMode::Foreground,
    )
    .unwrap();
    let orchestrator = settle_managed_orchestrator_run(
        &path,
        "orchestrator",
        "managed-current",
        ManagedOrchestratorTerminal {
            status: ManagedOrchestratorStatus::Cancelled,
            report: None,
            failure: Some("cancelled before migration".to_owned()),
        },
    )
    .unwrap()
    .orchestrator;
    connection.execute_batch("DROP TABLE traditional_child_terminal_receipts; DROP TABLE managed_orchestrator_terminal_receipts; PRAGMA user_version = 34;").unwrap();
    drop(connection);

    assert!(super::super::initialize_with_hooks(
        &path,
        || {},
        || {},
        || Err(anyhow!("injected migration failure"))
    )
    .is_err());
    let connection = Connection::open(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        34
    );
    assert!(
        !super::super::table_exists(&connection, "traditional_child_terminal_receipts").unwrap()
    );
    assert!(
        !super::super::table_exists(&connection, "managed_orchestrator_terminal_receipts").unwrap()
    );
    drop(connection);

    initialize(&path).unwrap();
    initialize(&path).unwrap();
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "child", 2).unwrap(),
        Some(child)
    );
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "child", 1).unwrap(),
        None
    );
    assert_eq!(
        load_traditional_child_terminal_receipt(&path, "running-child", 1).unwrap(),
        None
    );
    assert_eq!(
        load_managed_orchestrator_terminal_receipt(&path, "orchestrator", 1).unwrap(),
        Some(orchestrator)
    );
    let connection = open_runtime_connection(&path).unwrap();
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        crate::store::schema_version()
    );
    assert!(connection
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
    for (table, owner) in [
        (
            "traditional_child_terminal_receipts",
            "traditional_children",
        ),
        (
            "managed_orchestrator_terminal_receipts",
            "managed_orchestrators",
        ),
    ] {
        let on_delete: String = connection
            .query_row(
                &format!(
                    "SELECT on_delete FROM pragma_foreign_key_list('{table}') WHERE \"table\" = ?1"
                ),
                params![owner],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(on_delete, "CASCADE");
        let count: i64 = connection
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
    }
}
