use super::*;
use std::sync::{Arc, Barrier};

fn fixture() -> PathBuf {
    let path = std::env::temp_dir()
        .join(format!("nac-followup-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["caller", "caller-two", "target", "other"] {
        insert_test_session(&path, id);
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute("UPDATE sessions SET behavior='direct', sandbox_json=NULL, host_id=NULL WHERE session_id=?1", [id]).unwrap();
    }
    path
}

fn request(action: TaskFollowupAction, run: Option<&str>) -> TaskFollowupRequest {
    TaskFollowupRequest {
        caller_session_id: "caller".into(),
        request_id: "stable-key".into(),
        target_session_id: "target".into(),
        project_id: None,
        action,
        expected_run_id: run.map(str::to_owned),
        prompt: "\t /compact\n$skill\nretain exact peer text 中🙂 ".into(),
    }
}

fn set_run(path: &Path, run: &str) {
    let conn = open_runtime_connection(path).unwrap();
    // The production lifecycle writes the same recovery record with its prompt.
    // This fixture's thread event supplies the canonical foreign-key target.
    conn.execute("INSERT INTO thread_events(thread_name,session_id,event_json,created_at) VALUES('main','target','{}','now')", []).unwrap();
    let id = conn.last_insert_rowid();
    conn.execute("INSERT INTO session_run_recovery(session_id,run_id,submitted_message_id,status) VALUES('target',?1,?2,'active') ON CONFLICT(session_id) DO UPDATE SET run_id=excluded.run_id,status='active'", params![run,id]).unwrap();
}

#[test]
fn request_key_binds_all_arguments_across_targets_and_callers() {
    let path = fixture();
    let original = request(TaskFollowupAction::Queue, None);
    let first = admit_task_followup(&path, &original).unwrap();
    assert!(!first.replayed);
    assert_eq!(first.resolved_delivery, InboxDelivery::Queue);
    assert_eq!(first.admitted_run_id, None);
    let content = load_session_inbox_item(&path, "target", first.inbox_item_id).unwrap();
    assert!(content.content.ends_with(&original.prompt));
    assert!(content.terminal_selection.is_none());
    let conn = open_runtime_connection(&path).unwrap();
    let intent: Option<String> = conn
        .query_row(
            "SELECT review_intent FROM session_inbox WHERE id=?1",
            [first.inbox_item_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(intent.is_none());
    drop(conn);
    for changed in [
        {
            let mut r = original.clone();
            r.target_session_id = "other".into();
            r
        },
        {
            let mut r = original.clone();
            r.action = TaskFollowupAction::Auto;
            r
        },
        {
            let mut r = original.clone();
            r.prompt.push('x');
            r
        },
        {
            let mut r = original.clone();
            r.expected_run_id = Some("run".into());
            r
        },
        {
            let mut r = original.clone();
            r.project_id = Some("other".into());
            r
        },
    ] {
        assert_eq!(
            admit_task_followup(&path, &changed)
                .unwrap_err()
                .downcast_ref(),
            Some(&TaskFollowupError::IdentityConflict)
        );
    }
    let mut other = original.clone();
    other.caller_session_id = "caller-two".into();
    assert_ne!(
        admit_task_followup(&path, &other).unwrap().inbox_item_id,
        first.inbox_item_id
    );
    let replay = admit_task_followup(&path, &original).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.inbox_item_id, first.inbox_item_id);
}

#[test]
fn concurrent_same_caller_key_admits_one_item_and_one_creator() {
    let path = fixture();
    let barrier = Arc::new(Barrier::new(8));
    let threads = (0..8)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                admit_task_followup(&path, &request(TaskFollowupAction::Auto, None)).unwrap()
            })
        })
        .collect::<Vec<_>>();
    let receipts = threads
        .into_iter()
        .map(|t| t.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(receipts.iter().filter(|r| !r.replayed).count(), 1);
    assert!(receipts
        .iter()
        .all(|r| r.inbox_item_id == receipts[0].inbox_item_id));
    assert_eq!(list_session_inbox(&path, "target").unwrap().len(), 1);
}

#[test]
fn auto_resolution_and_run_binding_survive_new_runs_cancellation_and_missing_item() {
    let path = fixture();
    set_run(&path, "run-one");
    let original = request(TaskFollowupAction::Auto, None);
    let first = admit_task_followup(&path, &original).unwrap();
    assert_eq!(first.resolved_delivery, InboxDelivery::Steer);
    assert_eq!(first.admitted_run_id.as_deref(), Some("run-one"));
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "DELETE FROM session_run_recovery WHERE session_id='target'",
        [],
    )
    .unwrap();
    drop(conn);
    let mut stale = request(TaskFollowupAction::Steer, Some("run-one"));
    stale.request_id = "stale".into();
    assert_eq!(
        admit_task_followup(&path, &stale)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::RunConflict)
    );
    set_run(&path, "run-two");
    assert_eq!(
        admit_task_followup(&path, &stale)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::RunConflict)
    );
    let replay = admit_task_followup(&path, &original).unwrap();
    assert_eq!(replay.admitted_run_id, first.admitted_run_id);
    cancel_pending_session_inbox_item(&path, "target", first.inbox_item_id, 0).unwrap();
    assert_eq!(
        admit_task_followup(&path, &original).unwrap().disposition,
        Some(InboxStatus::Cancelled)
    );
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "DELETE FROM session_inbox WHERE id=?1",
        [first.inbox_item_id],
    )
    .unwrap();
    drop(conn);
    assert_eq!(
        admit_task_followup(&path, &original).unwrap().disposition,
        None
    );
    assert!(list_session_inbox(&path, "target").unwrap().is_empty());
}

#[test]
fn lost_commit_ack_reconciles_after_restart_without_new_creator_authority() {
    let path = fixture();
    let original = request(TaskFollowupAction::Auto, None);
    LOSE_ACK.with(|fault| fault.set(true));
    assert_eq!(
        admit_task_followup(&path, &original)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::CommitUncertain)
    );
    initialize(&path).unwrap();
    let receipt = admit_task_followup(&path, &original).unwrap();
    assert!(receipt.replayed);
    assert_eq!(receipt.disposition, Some(InboxStatus::Pending));
    assert_eq!(list_session_inbox(&path, "target").unwrap().len(), 1);
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute("UPDATE session_inbox SET status='delivered',delivered_run_id='successor',delivered_at='now' WHERE id=?1",[receipt.inbox_item_id]).unwrap();
    drop(conn);
    let delivered = inspect_task_followup_receipt(&path, "caller", "stable-key")
        .unwrap()
        .unwrap();
    assert_eq!(delivered.disposition, Some(InboxStatus::Delivered));
    assert_eq!(delivered.delivered_run_id.as_deref(), Some("successor"));
    assert!(
        inspect_task_followup_receipt(&path, "caller-two", "stable-key")
            .unwrap()
            .is_none()
    );
    let replay = admit_task_followup(&path, &original).unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.delivered_run_id, delivered.delivered_run_id);
}

#[test]
fn stale_auto_and_queue_bindings_conflict_and_task_queue_stays_unbound() {
    let path = fixture();
    set_run(&path, "current");
    for action in [TaskFollowupAction::Auto, TaskFollowupAction::Queue] {
        let stale = request(action, Some("stale"));
        assert_eq!(
            admit_task_followup(&path, &stale)
                .unwrap_err()
                .downcast_ref(),
            Some(&TaskFollowupError::RunConflict)
        );
    }
    let queued = request(TaskFollowupAction::Queue, Some("current"));
    let receipt = admit_task_followup(&path, &queued).unwrap();
    assert_eq!(receipt.admitted_run_id.as_deref(), Some("current"));
    assert!(
        load_session_inbox_item(&path, "target", receipt.inbox_item_id)
            .unwrap()
            .target_run_id
            .is_none()
    );
}

#[test]
fn remote_or_non_direct_topologies_fail_before_inbox_insertion() {
    let path = fixture();
    let request = request(TaskFollowupAction::Auto, None);
    for update in [
        "UPDATE sessions SET behavior='orchestrator' WHERE session_id='target'",
        "UPDATE sessions SET behavior='direct-with-orchestrator' WHERE session_id='target'",
        "UPDATE sessions SET behavior='direct',host_id='remote' WHERE session_id='target'",
        "UPDATE sessions SET host_id=NULL,sandbox_json='{}' WHERE session_id='target'",
    ] {
        let conn = open_runtime_connection(&path).unwrap();
        conn.execute_batch(update).unwrap();
        drop(conn);
        assert_eq!(
            admit_task_followup(&path, &request)
                .unwrap_err()
                .downcast_ref(),
            Some(&TaskFollowupError::Unavailable)
        );
        assert!(list_session_inbox(&path, "target").unwrap().is_empty());
    }
}

#[test]
fn followup_scope_is_transactional_and_opaque_before_target_topology() {
    let path = fixture();
    for project_id in ["one", "two"] {
        insert_project(
            &path,
            NewProject {
                project_id: project_id.into(),
                name: None,
                description: None,
                cwd: PathBuf::from(format!("/tmp/project-{project_id}")),
                ssh_host: None,
                ssh_port: None,
                ssh_identity_file: None,
                default_model_config_id: None,
            },
        )
        .unwrap();
    }
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET cwd='/tmp/project-one' WHERE session_id='caller'",
        [],
    )
    .unwrap();
    conn.execute(
        "UPDATE sessions SET cwd='/tmp/project-two' WHERE session_id='target'",
        [],
    )
    .unwrap();
    drop(conn);
    assign_session_to_project(&path, "one", "caller").unwrap();
    assign_session_to_project(&path, "two", "target").unwrap();
    let mut input = request(TaskFollowupAction::Queue, None);
    assert_eq!(
        admit_task_followup(&path, &input)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::OutsideScope)
    );
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='orchestrator' WHERE session_id='target'",
        [],
    )
    .unwrap();
    drop(conn);
    assert_eq!(
        admit_task_followup(&path, &input)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::OutsideScope)
    );
    input.project_id = Some("two".into());
    assert_eq!(
        admit_task_followup(&path, &input)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::Unavailable)
    );
    let conn = open_runtime_connection(&path).unwrap();
    conn.execute(
        "UPDATE sessions SET behavior='direct' WHERE session_id='target'",
        [],
    )
    .unwrap();
    drop(conn);
    assert!(!admit_task_followup(&path, &input).unwrap().replayed);
    let mut changed = input;
    changed.project_id = None;
    assert_eq!(
        admit_task_followup(&path, &changed)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::IdentityConflict)
    );
}

#[test]
fn followup_process_helper() {
    let Some(path) = std::env::var_os("NAC_FOLLOWUP_TEST_STORE") else {
        return;
    };
    let path = PathBuf::from(path);
    let lost = std::env::var_os("NAC_FOLLOWUP_TEST_LOSE_ACK").is_some();
    if lost {
        LOSE_ACK.with(|fault| fault.set(true));
    }
    let result = admit_task_followup(&path, &request(TaskFollowupAction::Queue, None));
    if lost {
        assert_eq!(
            result.unwrap_err().downcast_ref(),
            Some(&TaskFollowupError::CommitUncertain)
        );
    } else {
        assert!(result.unwrap().replayed);
    }
}

#[test]
fn followup_process_restart_replays_a_lost_ack_without_second_admission() {
    let path = fixture();
    for lost in [true, false] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "store::task_followups::tests::followup_process_helper",
                "--nocapture",
            ])
            .env("NAC_FOLLOWUP_TEST_STORE", &path)
            .env_remove("NAC_FOLLOWUP_TEST_LOSE_ACK");
        if lost {
            command.env("NAC_FOLLOWUP_TEST_LOSE_ACK", "1");
        }
        let output = command.output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let items = list_session_inbox(&path, "target").unwrap();
    assert_eq!(items.len(), 1);
    let receipt = inspect_task_followup_receipt(&path, "caller", "stable-key")
        .unwrap()
        .unwrap();
    assert_eq!(receipt.inbox_item_id, items[0].id);
    assert_eq!(receipt.disposition, Some(InboxStatus::Pending));
}

#[test]
fn followup_uncertain_rollback_never_claims_a_later_creators_wake() {
    let path = fixture();
    let original = request(TaskFollowupAction::Queue, None);
    ROLLBACK_UNCERTAIN.with(|fault| fault.set(true));
    assert_eq!(
        admit_task_followup(&path, &original)
            .unwrap_err()
            .downcast_ref(),
        Some(&TaskFollowupError::CommitUncertain)
    );
    assert!(inspect_task_followup_receipt(&path, "caller", "stable-key")
        .unwrap()
        .is_none());
    assert!(list_session_inbox(&path, "target").unwrap().is_empty());
    let peer_path = path.clone();
    let peer_input = original.clone();
    let created = std::thread::spawn(move || admit_task_followup(&peer_path, &peer_input).unwrap())
        .join()
        .unwrap();
    assert!(!created.replayed);
    let retry = admit_task_followup(&path, &original).unwrap();
    assert!(retry.replayed);
    assert_eq!(retry.inbox_item_id, created.inbox_item_id);
}
