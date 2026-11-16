use super::*;
use std::sync::{mpsc, Arc, Barrier};

fn fixture() -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!("nac-delegation-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["caller", "other-caller", "target", "other-target"] {
        insert_test_session(&path, id);
        open_runtime_connection(&path)
            .unwrap()
            .execute(
                "UPDATE sessions SET behavior='direct' WHERE session_id=?1",
                [id],
            )
            .unwrap();
    }
    path
}

fn submission(path: &Path, key: &str) -> SubmittedTaskFollowupDelegation {
    SubmittedTaskFollowupDelegation::for_test(
        path,
        "caller",
        TaskFollowupDelegationRequest {
            request_id: key.into(),
            target_session_id: "target".into(),
            action: TaskFollowupAction::Auto,
            project_id: None,
        },
    )
}

fn followup(key: &str) -> TaskFollowupRequest {
    TaskFollowupRequest {
        caller_session_id: "caller".into(),
        target_session_id: "target".into(),
        request_id: key.into(),
        project_id: None,
        action: TaskFollowupAction::Auto,
        expected_run_id: None,
        prompt: "peer guidance".into(),
    }
}

#[test]
fn followup_delegation_binds_caller_target_action_and_incarnation() {
    let path = fixture();
    assert_eq!(
        admit_task_followup(&path, &followup("missing"))
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::AuthorizationRequired)
    );
    let delegation = issue_task_followup_delegation(&path, &submission(&path, "human")).unwrap();
    assert_eq!(delegation.origin, "human_product_request");
    for mut changed in [
        followup("wrong-caller"),
        followup("wrong-target"),
        followup("wrong-action"),
    ] {
        match changed.request_id.as_str() {
            "wrong-caller" => changed.caller_session_id = "other-caller".into(),
            "wrong-target" => changed.target_session_id = "other-target".into(),
            _ => changed.action = TaskFollowupAction::Queue,
        }
        assert_eq!(
            admit_task_followup(&path, &changed)
                .unwrap_err()
                .downcast_ref(),
            Some(&TaskFollowupError::AuthorizationRequired)
        );
    }
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET created_at='replacement-incarnation' WHERE session_id='target'",
        [],
    )
    .unwrap();
    drop(conn);
    assert_eq!(
        admit_task_followup(&path, &followup("replacement"))
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::AuthorizationRequired)
    );
    assert!(list_session_inbox(&path, "target").unwrap().is_empty());
}

#[test]
fn followup_delegation_lost_ack_and_concurrent_human_retry_issue_one_record() {
    let path = fixture();
    LOSE_ACK.with(|fault| fault.set(true));
    assert_eq!(
        issue_task_followup_delegation(&path, &submission(&path, "human"))
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::CommitUncertain)
    );
    let barrier = Arc::new(Barrier::new(8));
    let threads = (0..8)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                issue_task_followup_delegation(&path, &submission(&path, "human")).unwrap()
            })
        })
        .collect::<Vec<_>>();
    let records = threads
        .into_iter()
        .map(|t| t.join().unwrap())
        .collect::<Vec<_>>();
    assert!(records.iter().all(|r| r == &records[0]));
    let conn = open_runtime_connection(&path).unwrap();
    assert_eq!(
        conn.query_row("SELECT COUNT(*) FROM task_followup_delegations", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap(),
        1
    );
    assert!(list_session_inbox(&path, "target").unwrap().is_empty());
    assert!(
        load_task_followup_delegation(&path, "other-caller", &records[0].id)
            .unwrap()
            .is_none()
    );
    let mut changed_request = submission(&path, "human").request().clone();
    changed_request.action = TaskFollowupAction::Queue;
    let changed = SubmittedTaskFollowupDelegation::for_test(&path, "caller", changed_request);
    assert_eq!(
        issue_task_followup_delegation(&path, &changed)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::IdentityConflict)
    );
}

#[test]
fn followup_revocation_keeps_admission_proof_and_never_resurrects_or_redelivers() {
    let path = fixture();
    let delegation = issue_task_followup_delegation(&path, &submission(&path, "human")).unwrap();
    let input = followup("one");
    let accepted = admit_task_followup(&path, &input).unwrap();
    assert_eq!(
        accepted.delegation_id.as_deref(),
        Some(delegation.id.as_str())
    );
    let revoked = revoke_task_followup_delegation(&path, "caller", &delegation.id)
        .unwrap()
        .unwrap();
    assert!(revoked.revoked_at.is_some());
    assert_eq!(
        revoke_task_followup_delegation(&path, "caller", &delegation.id)
            .unwrap()
            .unwrap(),
        revoked
    );
    assert_eq!(
        issue_task_followup_delegation(&path, &submission(&path, "human")).unwrap(),
        revoked
    );
    initialize(&path).unwrap();
    let replay = admit_task_followup(&path, &input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.inbox_item_id, accepted.inbox_item_id);
    assert_eq!(replay.delegation_id, accepted.delegation_id);
    assert_eq!(
        admit_task_followup(&path, &followup("new"))
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::AuthorizationRequired)
    );
    let mut changed = input;
    changed.prompt.push('!');
    assert_eq!(
        admit_task_followup(&path, &changed)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::IdentityConflict)
    );
    let replacement =
        issue_task_followup_delegation(&path, &submission(&path, "human-new")).unwrap();
    assert_ne!(replacement.id, delegation.id);
    assert_eq!(
        admit_task_followup(&path, &followup("new"))
            .unwrap()
            .delegation_id,
        Some(replacement.id)
    );
    assert_eq!(list_session_inbox(&path, "target").unwrap().len(), 2);
}

#[test]
fn followup_revocation_serializes_with_the_final_admission_check() {
    let path = fixture();
    let delegation = issue_task_followup_delegation(&path, &submission(&path, "human")).unwrap();
    let mut conn = open_runtime_connection(&path).unwrap();
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .unwrap();
    tx.execute(
        "UPDATE task_followup_delegations SET revoked_at='revoked-first' WHERE id=?1",
        [&delegation.id],
    )
    .unwrap();
    let (started_tx, started_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let task_path = path.clone();
    let thread = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        done_tx
            .send(admit_task_followup(&task_path, &followup("race")))
            .unwrap();
    });
    started_rx.recv().unwrap();
    assert!(matches!(
        done_rx.recv_timeout(std::time::Duration::from_millis(50)),
        Err(mpsc::RecvTimeoutError::Timeout)
    ));
    tx.commit().unwrap();
    let result = done_rx
        .recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    assert_eq!(
        result.unwrap_err().downcast_ref(),
        Some(&TaskFollowupError::AuthorizationRequired)
    );
    thread.join().unwrap();
    assert!(list_session_inbox(&path, "target").unwrap().is_empty());
}

#[test]
fn followup_issuance_checks_current_configuration_and_rolls_back_replacement() {
    let path = fixture();
    let original = issue_task_followup_delegation(&path, &submission(&path, "human")).unwrap();
    open_runtime_connection(&path)
        .unwrap()
        .execute(
            "UPDATE sessions SET config_version=1 WHERE session_id='caller'",
            [],
        )
        .unwrap();
    assert_eq!(
        issue_task_followup_delegation(&path, &submission(&path, "stale"))
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::Unavailable)
    );
    assert_eq!(
        load_task_followup_delegation(&path, "caller", &original.id)
            .unwrap()
            .unwrap(),
        original
    );
    assert!(admit_task_followup(&path, &followup("still-explicitly-authorized")).is_ok());
}

#[test]
fn followup_historical_receipt_replays_without_fabricating_delegation() {
    let path = fixture();
    let input = followup("historical");
    let item =
        create_session_inbox_item(&path, "target", InboxDelivery::Queue, "legacy", None, None)
            .unwrap();
    open_runtime_connection(&path).unwrap().execute("INSERT INTO task_followups(caller_session_id,request_id,target_session_id,request_json,resolved_delivery,inbox_item_id,created_at) VALUES('caller','historical','target',?1,'queue',?2,'legacy')",params![serde_json::to_string(&input).unwrap(),item.id]).unwrap();
    let replay = admit_task_followup(&path, &input).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.inbox_item_id, item.id);
    assert_eq!(replay.delegation_id, None);
    assert_eq!(
        admit_task_followup(&path, &followup("fresh"))
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::AuthorizationRequired)
    );
    assert_eq!(list_session_inbox(&path, "target").unwrap().len(), 1);
}

#[test]
fn followup_issuance_cannot_move_a_service_capability_to_another_store() {
    let path = fixture();
    let other = fixture();
    let issued = submission(&path, "human");
    assert_eq!(
        issue_task_followup_delegation(&other, &issued)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::Unavailable)
    );
    assert_eq!(
        open_runtime_connection(&other)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM task_followup_delegations", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
        0
    );
}
