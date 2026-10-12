use super::*;

fn human_store_error(error: anyhow::Error) -> nac_core::session_service::ShellCommandError {
    nac_core::session_service::ShellCommandError::Store(std::sync::Arc::new(error))
}

fn assert_human_contention(error: anyhow::Error) {
    let command = human_store_error(error.context("human command store admission"));
    let wrapped = anyhow::Error::new(command.clone()).context("human command HTTP delivery");
    assert!(nac_core::store::is_sqlite_busy(&wrapped));
    assert_eq!(command, command.clone());
    assert_eq!(ApiError::from(command).status, StatusCode::CONFLICT);
    assert_eq!(ApiError::from(wrapped).status, StatusCode::CONFLICT);
}

#[test]
fn real_human_command_sqlite_busy_retains_source_and_maps_to_conflict() {
    let path = std::env::temp_dir().join(format!(
        "nac-human-contention-{}.sqlite",
        uuid::Uuid::new_v4()
    ));
    let owner = rusqlite::Connection::open(&path).unwrap();
    let contender = rusqlite::Connection::open(&path).unwrap();
    contender.busy_timeout(std::time::Duration::ZERO).unwrap();
    owner
        .execute_batch(
            "CREATE TABLE commands(id INTEGER); BEGIN IMMEDIATE; INSERT INTO commands VALUES(1);",
        )
        .unwrap();
    let error = contender
        .execute("INSERT INTO commands VALUES(2)", [])
        .unwrap_err();
    assert!(
        matches!(&error, rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::DatabaseBusy)
    );
    assert_human_contention(error.into());
    owner.execute_batch("ROLLBACK").unwrap();
    drop(contender);
    drop(owner);
    std::fs::remove_file(path).unwrap();
}

#[test]
fn real_human_command_sqlite_locked_retains_source_and_maps_to_conflict() {
    let connection = rusqlite::Connection::open_in_memory().unwrap();
    connection
        .execute_batch("CREATE TABLE commands(id INTEGER); INSERT INTO commands VALUES(1);")
        .unwrap();
    let mut statement = connection.prepare("SELECT id FROM commands").unwrap();
    let mut rows = statement.query([]).unwrap();
    assert!(rows.next().unwrap().is_some());
    let error = connection.execute_batch("DROP TABLE commands").unwrap_err();
    assert!(
        matches!(&error, rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::DatabaseLocked)
    );
    assert_human_contention(error.into());
}

#[test]
fn human_command_typed_persistence_capacity_maps_through_context_to_conflict() {
    for rejection in [
        nac_core::store::PersistenceAdmissionError::Overloaded,
        nac_core::store::PersistenceAdmissionError::CallerOverloaded,
    ] {
        let command = human_store_error(
            anyhow::Error::new(rejection).context("blocking human command admission"),
        );
        assert_eq!(ApiError::from(command.clone()).status, StatusCode::CONFLICT);
        let wrapped = anyhow::Error::new(command).context("human command HTTP delivery");
        assert_eq!(ApiError::from(wrapped).status, StatusCode::CONFLICT);
    }
}

#[test]
fn human_command_generic_store_failures_and_non_capacity_admission_errors_remain_internal() {
    for error in [
        anyhow::anyhow!("generic journal failure"),
        // Text resembling a lock is deliberately insufficient evidence.
        anyhow::anyhow!("database is locked and persistence caller capacity is full"),
        anyhow::Error::new(nac_core::store::PersistenceAdmissionError::ExecutorStopped),
        anyhow::Error::new(nac_core::store::PersistenceAdmissionError::ShuttingDown),
    ] {
        let command = human_store_error(error.context("human command journal"));
        assert_eq!(
            ApiError::from(command.clone()).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            ApiError::from(anyhow::Error::new(command).context("HTTP delivery")).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
}

#[test]
fn uncertain_human_command_commit_and_ack_wrappers_supersede_retained_sqlite_contention() {
    for wrapper in [
        // SQLite BUSY after commit/ack loss is not a definite rejected admission.
        0, 1,
    ] {
        let sqlite = anyhow::Error::new(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            None,
        ));
        let uncertain = if wrapper == 0 {
            sqlite.context(nac_core::store::TerminalSelectionAdmissionError::CommitUncertain)
        } else {
            sqlite.context(nac_core::store::PersistenceAdmissionError::ExecutorStopped)
        };
        assert!(nac_core::store::is_sqlite_busy(&uncertain));
        let command = human_store_error(uncertain);
        assert_eq!(
            ApiError::from(command.clone()).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert_eq!(
            ApiError::from(anyhow::Error::new(command).context("HTTP delivery")).status,
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }
    // Semantic context may also be outside the typed shell service wrapper.
    let command = human_store_error(anyhow::Error::new(rusqlite::Error::SqliteFailure(
        rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_LOCKED),
        None,
    )));
    let wrapped = anyhow::Error::new(command)
        .context(nac_core::store::TerminalSelectionAdmissionError::CommitUncertain);
    assert_eq!(
        ApiError::from(wrapped).status,
        StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[test]
fn terminal_owner_fence_maps_to_conflict_through_error_context() {
    let owner = application::session_terminals::TerminalOwnerMismatch;
    let error = anyhow::Error::new(owner).context("terminal completion fence");
    assert_eq!(ApiError::from(error).status, StatusCode::CONFLICT);
}

#[test]
fn deliberate_managed_maintenance_rejection_maps_through_error_context() {
    let error = anyhow::Error::new(nac_core::store::ManagedWorkAdmissionError::Maintenance)
        .context("terminal recovery admission");
    assert_eq!(
        ApiError::from(error).status,
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[test]
fn untyped_admission_store_failure_remains_internal() {
    let error = anyhow::anyhow!("managed admission ledger read failed")
        .context("terminal recovery admission");
    assert_eq!(
        ApiError::from(error).status,
        StatusCode::INTERNAL_SERVER_ERROR
    );
}

#[test]
fn genuine_terminal_cleanup_failure_remains_internal() {
    let error = anyhow::anyhow!("terminal descendant inspection failed");
    assert_eq!(
        ApiError::from(error).status,
        StatusCode::INTERNAL_SERVER_ERROR
    );
}
