use super::fresh_tests::{prepared_shared_snapshot, Fixture};
use super::*;

fn initial_result(f: &Fixture, now: i64) -> FreshTaskLaunchReceipt {
    let pending = materialize_heartbeats(&f.path, now).unwrap().remove(0);
    let prepared =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, now)
            .unwrap()
            .unwrap();
    pin_fresh_heartbeat_workspace_mode(&f.path, &pending.occurrence_id, true).unwrap();
    let snapshot = prepared_shared_snapshot(f, &prepared);
    let mut conn = open_runtime_connection(&f.path).unwrap();
    {
        let tx = conn.transaction().unwrap();
        crate::sessions::insert_new_session_in_transaction(&tx, &f.path, &snapshot).unwrap();
        publish_shared_fresh_launch_with_connection(
            &tx,
            &prepared.receipt().request.request_id,
            &snapshot,
        )
        .unwrap();
        tx.execute(
            "UPDATE sessions SET updated_at='before-initial' WHERE session_id=?1",
            [&snapshot.session_id],
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let published = heartbeat_history(&f.path, "project:project", &pending.schedule_id)
        .unwrap()
        .remove(0);
    let run = uuid::Uuid::new_v4().to_string();
    let active = admit_heartbeat(
        &f.path,
        &snapshot.session_id,
        &pending.occurrence_id,
        published.revision,
        &run,
        &pending.receipt_id,
        "expanded fixture",
        f.root.to_str().unwrap(),
        now + 1,
    )
    .unwrap()
    .unwrap();
    heartbeat_report(
        &f.path,
        &snapshot.session_id,
        &pending.occurrence_id,
        &run,
        &pending.receipt_id,
        active.revision,
        HeartbeatOutcome::Unchanged,
        "Fixture unchanged.",
    )
    .unwrap();
    {
        let tx = conn.transaction().unwrap();
        tx.execute(
            "UPDATE sessions SET updated_at='same-terminal-second' WHERE session_id=?1",
            [&snapshot.session_id],
        )
        .unwrap();
        tx.execute("INSERT INTO session_run_outcomes(session_id,run_id,disposition,finished_at) VALUES(?1,?2,'completed','same-terminal-second')", params![snapshot.session_id,run]).unwrap();
        settle_heartbeat_with_connection(
            &tx,
            &snapshot.session_id,
            &run,
            HeartbeatOutcome::Unknown,
            Some(3),
            10,
            now + 2,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    read_fresh_heartbeat_launch(&f.path, &pending.occurrence_id)
        .unwrap()
        .unwrap()
        .receipt()
        .clone()
}

#[test]
fn fresh_task_acknowledgement_is_independent_monotonic_and_retained_after_pruning() {
    let mut f = Fixture::new();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    let schedule = f.create();
    let a = initial_result(&f, 61_000);
    let b = initial_result(&f, 121_000);
    let a_sequence = a
        .initial_outcome
        .as_ref()
        .unwrap()
        .settlement_sequence
        .unwrap();
    let b_sequence = b
        .initial_outcome
        .as_ref()
        .unwrap()
        .settlement_sequence
        .unwrap();
    assert!(b_sequence > a_sequence);
    let original = read_heartbeat(&f.path, "project:project", &schedule.schedule_id).unwrap();
    acknowledge_heartbeat_attention(&f.path, &a.session_id, a_sequence).unwrap();
    acknowledge_heartbeat_attention(&f.path, &a.session_id, 0).unwrap();
    assert!(acknowledge_heartbeat_attention(&f.path, &a.session_id, b_sequence).is_err());
    let attention = heartbeat_attention_snapshot(&f.path).unwrap();
    assert!(attention.results[&a.session_id][0].seen);
    assert!(
        !attention.results[&b.session_id][0].seen,
        "opening one produced task must not acknowledge its sibling"
    );
    assert_eq!(
        read_heartbeat(&f.path, "project:project", &schedule.schedule_id).unwrap(),
        original,
        "acknowledgement cannot edit/resume a schedule"
    );
    open_runtime_connection(&f.path)
        .unwrap()
        .execute("DELETE FROM heartbeat_occurrences", [])
        .unwrap();
    initialize(&f.path).unwrap();
    let attention = heartbeat_attention_snapshot(&f.path).unwrap();
    assert!(attention.results[&a.session_id][0].seen);
    assert!(!attention.results[&b.session_id][0].seen);
    acknowledge_heartbeat_attention(&f.path, &b.session_id, b_sequence).unwrap();
    assert!(heartbeat_attention_snapshot(&f.path).unwrap().results[&b.session_id][0].seen);
    let conn = open_runtime_connection(&f.path).unwrap();
    assert!(
        next_settlement_sequence(&conn).unwrap() > b_sequence,
        "retained results fence sequence reuse after bounded history removal"
    );
}

#[test]
fn quiet_initial_result_survives_pruning_but_never_hides_later_human_work_in_same_second() {
    let mut f = Fixture::new();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    f.create();
    let receipt = initial_result(&f, 61_000);
    let attention = heartbeat_attention_snapshot(&f.path).unwrap();
    assert_eq!(
        attention
            .quiet_updated_at
            .get(&receipt.session_id)
            .map(String::as_str),
        Some("before-initial")
    );
    let conn = open_runtime_connection(&f.path).unwrap();
    conn.execute("DELETE FROM heartbeat_occurrences", [])
        .unwrap();
    assert!(heartbeat_attention_snapshot(&f.path)
        .unwrap()
        .quiet_updated_at
        .contains_key(&receipt.session_id));
    conn.execute("INSERT INTO session_run_outcomes(session_id,run_id,disposition,finished_at) VALUES(?1,'later-human','completed','same-terminal-second')",[&receipt.session_id]).unwrap();
    let attention = heartbeat_attention_snapshot(&f.path).unwrap();
    assert!(
        !attention.quiet_updated_at.contains_key(&receipt.session_id),
        "a new ordinary run revision remains visible even when updated_at is unchanged"
    );
    assert_eq!(
        read_fresh_heartbeat_launch(&f.path, &receipt.occurrence_id)
            .unwrap()
            .unwrap()
            .receipt()
            .initial_outcome,
        receipt.initial_outcome
    );
}
