use super::*;
use uuid::Uuid;

struct Fixture {
    path: PathBuf,
    identity: ManagedRuntimeOperationIdentity,
    session: String,
    run: String,
}

impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir()
            .join(format!("nac-runtime-start-schema-{}", Uuid::new_v4()))
            .join("store.db");
        initialize(&path).unwrap();
        let session = Uuid::new_v4().to_string();
        let run = Uuid::new_v4().to_string();
        crate::store::insert_test_session(&path, &session);
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET backend = ?1 WHERE session_id = ?2",
                params![crate::model::BackendKind::OpenAiResponses.as_str(), session],
            )
            .unwrap();
        let identity = ManagedRuntimeOperationIdentity {
            operation_id: Uuid::new_v4(),
            full_input_sha256: [9; 32],
        };
        record_managed_runtime_operation(&path, &identity).unwrap();
        acknowledge_managed_runtime_operation(
            &path,
            &identity,
            &ManagedRuntimeObservation::Run {
                session_id: session.parse().unwrap(),
                run_id: run.parse().unwrap(),
            },
        )
        .unwrap();
        Self {
            path,
            identity,
            session,
            run,
        }
    }
    fn insert(&self, connection: &Connection, run: &str) -> rusqlite::Result<usize> {
        connection.execute("INSERT INTO runtime_run_starts (operation_id, session_id, run_id, behavior, config_version, phase)
            VALUES (?1, ?2, ?3, 'orchestrator', 0, 'pending')", params![self.identity.operation_id.to_string(), self.session, run])
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(self.path.parent().unwrap()).unwrap();
    }
}

#[test]
fn runtime_lost_start_migration_from_34_preserves_ack_and_session() {
    let fixture = Fixture::new();
    let ack = read_managed_runtime_operation(&fixture.path, &fixture.identity).unwrap();
    {
        let connection = open_runtime_connection(&fixture.path).unwrap();
        connection
            .execute_batch("DROP TABLE runtime_run_starts; PRAGMA user_version = 34;")
            .unwrap();
    }
    initialize(&fixture.path).unwrap();
    initialize(&fixture.path).unwrap();
    assert_eq!(schema_version(), 35);
    assert_eq!(
        read_managed_runtime_operation(&fixture.path, &fixture.identity).unwrap(),
        ack
    );
    assert_eq!(
        crate::sessions::load_session(&fixture.path, &fixture.session)
            .unwrap()
            .session_id,
        fixture.session
    );
    let connection = open_runtime_connection(&fixture.path).unwrap();
    fixture.insert(&connection, &fixture.run).unwrap();
    let violation: Option<String> = connection
        .query_row("PRAGMA foreign_key_check", [], |row| row.get(0))
        .optional()
        .unwrap();
    assert!(violation.is_none());
}

#[test]
fn runtime_lost_start_history_binds_ack_cannot_rewind_and_survives_session_deletion() {
    let fixture = Fixture::new();
    let connection = open_runtime_connection(&fixture.path).unwrap();
    assert!(fixture
        .insert(&connection, &Uuid::new_v4().to_string())
        .is_err());
    fixture.insert(&connection, &fixture.run).unwrap();
    assert!(connection
        .execute(
            "UPDATE runtime_run_starts SET run_id = ?1",
            [Uuid::new_v4().to_string()]
        )
        .is_err());
    connection
        .execute("UPDATE runtime_run_starts SET phase = 'prompted'", [])
        .unwrap();
    assert!(connection
        .execute("UPDATE runtime_run_starts SET phase = 'pending'", [])
        .is_err());
    assert!(connection
        .execute("DELETE FROM runtime_run_starts", [])
        .is_err());
    connection
        .execute(
            "DELETE FROM sessions WHERE session_id = ?1",
            [&fixture.session],
        )
        .unwrap();
    assert_eq!(
        connection
            .query_row::<String, _, _>("SELECT phase FROM runtime_run_starts", [], |row| row.get(0))
            .unwrap(),
        "prompted"
    );
    assert!(matches!(
        read_managed_runtime_operation(&fixture.path, &fixture.identity)
            .unwrap()
            .unwrap()
            .observation,
        Some(ManagedRuntimeObservation::Run { .. })
    ));
}
