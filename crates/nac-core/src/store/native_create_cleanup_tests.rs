//! New cleanup transaction controls; no authenticated participant/Native proof.
use super::*;
use crate::store::native_create_cleanup::complete;
use std::sync::Arc;

fn prepared(f: &Fixture) -> Arc<NativeSourceReservation> {
    let snapshot = f.snapshot("cleanup-intended");
    let owner = Arc::new(
        NativeSourceReservation::reserve(
            &f.path,
            f.bind(&snapshot),
            Instant::now() + std::time::Duration::from_secs(30),
        )
        .unwrap(),
    );
    owner.begin_preparation().unwrap();
    let mut c = open_runtime_connection(&f.path).unwrap();
    let tx = c
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    owner.insert_creation(&tx, &f.path, &snapshot).unwrap();
    tx.commit().unwrap();
    owner
}
fn counts(f: &Fixture, owner: &NativeSourceReservation) -> (i64, i64) {
    let c = f.raw();
    let op = owner.binding().operation_id.to_string();
    (
        c.query_row(
            "SELECT COUNT(*) FROM native_source_slots WHERE operation_id=?1",
            [&op],
            |r| r.get(0),
        )
        .unwrap(),
        c.query_row(
            "SELECT COUNT(*) FROM native_create_acknowledgements WHERE operation_id=?1",
            [&op],
            |r| r.get(0),
        )
        .unwrap(),
    )
}
#[test]
fn cleanup_is_atomic_idempotent_body_bound_and_retains_history_after_denial() {
    let f = Fixture::new();
    let owner = prepared(&f);
    let version = crate::sessions::load_session(&f.path, &owner.binding().session_id)
        .unwrap()
        .config_version;
    let before = serde_json::to_string(owner.binding()).unwrap();
    owner.deny(); // Publication retirement cannot grant work or erase cleanup.
    assert!(owner.check_current().is_err());
    complete(Arc::clone(&owner), [7; 32], version).unwrap();
    assert_eq!(counts(&f, &owner), (0, 1));
    complete(Arc::clone(&owner), [7; 32], version).unwrap();
    assert!(complete(Arc::clone(&owner), [8; 32], version).is_err());
    assert!(complete(Arc::clone(&owner), [7; 32], version + 1).is_err());
    let c = f.raw();
    let saved: (String, String) = c
        .query_row(
            "SELECT binding_json,state FROM native_source_reservations WHERE operation_id=?1",
            [owner.binding().operation_id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(saved, (before, "prepared".to_owned()));
    assert!(c
        .execute("DELETE FROM native_create_acknowledgements", [])
        .is_err());
    assert!(c
        .execute(
            "UPDATE native_create_acknowledgements SET configuration_version=999",
            []
        )
        .is_err());
    c.execute(
        "UPDATE sessions SET cwd='/allowed-after-original-cleanup' WHERE session_id=?1",
        [&owner.binding().session_id],
    )
    .unwrap();
    assert_eq!(counts(&f, &owner), (0, 1));
}
#[test]
fn failed_slot_cleanup_rolls_back_ack_and_retains_original_fences() {
    let f = Fixture::new();
    let owner = prepared(&f);
    let version = crate::sessions::load_session(&f.path, &owner.binding().session_id)
        .unwrap()
        .config_version;
    f.raw().execute_batch("CREATE TRIGGER inject_ack_failure BEFORE DELETE ON native_source_slots BEGIN SELECT RAISE(ABORT,'injected cleanup failure'); END;").unwrap();
    assert!(complete(Arc::clone(&owner), [7; 32], version).is_err());
    assert_eq!(counts(&f, &owner), (1, 0));
    assert!(f
        .raw()
        .execute(
            "UPDATE sessions SET cwd='/must-remain-fenced' WHERE session_id=?1",
            [&owner.binding().session_id]
        )
        .is_err());
}
#[test]
fn unprepared_and_unknown_reservations_cannot_cleanup_from_receipt_data() {
    let f = Fixture::new();
    let snapshot = f.snapshot("pending");
    let pending = Arc::new(
        NativeSourceReservation::reserve(
            &f.path,
            f.bind(&snapshot),
            Instant::now() + std::time::Duration::from_secs(30),
        )
        .unwrap(),
    );
    assert!(complete(Arc::clone(&pending), [7; 32], 0).is_err());
    assert_eq!(counts(&f, &pending), (1, 0));
    let owner = prepared(&f);
    owner.mark_uncertain().unwrap();
    assert!(complete(Arc::clone(&owner), [7; 32], 0).is_err());
    assert_eq!(counts(&f, &owner), (1, 0));
}
