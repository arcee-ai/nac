use super::fresh_tests::Fixture;
use super::*;

fn change(revision: i64, limit: i64) -> FreshTaskRetainedAllowanceChange {
    FreshTaskRetainedAllowanceChange {
        request_id: uuid::Uuid::new_v4().to_string(),
        expected_revision: revision,
        retained_limit: limit,
    }
}

#[test]
fn host_quota_recovery_requires_explicit_resume_and_keeps_partial_resource_identity() {
    let f = Fixture::new();
    change_fresh_heartbeat_retained_allowance(&f.path, &change(1, 1), &f.binding).unwrap();
    f.create();
    f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap();
    assert_eq!(pending.len(), 2);
    let retained = reserve_fresh_heartbeat_launch(
        &f.path,
        &pending[0].occurrence_id,
        pending[0].revision,
        61_000,
    )
    .unwrap()
    .unwrap();
    assert!(reserve_fresh_heartbeat_launch(
        &f.path,
        &pending[1].occurrence_id,
        pending[1].revision,
        61_000
    )
    .unwrap()
    .is_none());
    let suspended = read_heartbeat(&f.path, "project:project", &pending[1].schedule_id).unwrap();
    assert_eq!(suspended.state, HeartbeatState::Suspended);
    change_fresh_heartbeat_retained_allowance(&f.path, &change(2, 2), &f.binding).unwrap();
    assert_eq!(
        read_heartbeat(&f.path, "project:project", &suspended.schedule_id)
            .unwrap()
            .state,
        HeartbeatState::Suspended
    );
    control_heartbeat(
        &f.path,
        "project:project",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Resume {
            schedule_id: suspended.schedule_id.clone(),
            expected_version: suspended.version,
        },
        "Resume this reviewed schedule after explicitly increasing its host allowance.",
        &f.binding,
        62_000,
    )
    .unwrap();
    initialize(&f.path).unwrap();
    let next = materialize_heartbeats(&f.path, 121_000)
        .unwrap()
        .into_iter()
        .find(|item| item.schedule_id == suspended.schedule_id)
        .unwrap();
    let second =
        reserve_fresh_heartbeat_launch(&f.path, &next.occurrence_id, next.revision, 121_000)
            .unwrap()
            .unwrap();
    assert_ne!(second.receipt().session_id, retained.receipt().session_id);
    assert_eq!(
        fresh_heartbeat_retained_allowance(&f.path)
            .unwrap()
            .retained_count,
        2
    );
    assert_eq!(
        read_fresh_heartbeat_launch(&f.path, &retained.receipt().occurrence_id)
            .unwrap()
            .unwrap()
            .receipt(),
        retained.receipt()
    );
}

#[test]
fn host_allowance_change_replays_original_receipt_after_restart_and_resource_growth() {
    let f = Fixture::new();
    let original = change(1, 1);
    let accepted =
        change_fresh_heartbeat_retained_allowance(&f.path, &original, &f.binding).unwrap();
    assert_eq!(
        accepted.allowance,
        FreshTaskRetainedAllowance {
            revision: 2,
            retained_limit: 1,
            retained_count: 0
        }
    );
    let schedule = f.create();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
        .unwrap()
        .unwrap();
    initialize(&f.path).unwrap();
    assert_eq!(
        change_fresh_heartbeat_retained_allowance(&f.path, &original, &f.binding).unwrap(),
        accepted,
        "lost acknowledgement must not adopt a newer count or revision"
    );
    assert_eq!(
        fresh_heartbeat_retained_allowance(&f.path)
            .unwrap()
            .retained_count,
        1,
        "partial preparation already owns capacity"
    );
    let mut conflicting = original.clone();
    conflicting.retained_limit = 2;
    assert!(change_fresh_heartbeat_retained_allowance(&f.path, &conflicting, &f.binding).is_err());
    assert!(change_fresh_heartbeat_retained_allowance(&f.path, &change(1, 2), &f.binding).is_err());
    let before = read_heartbeat(&f.path, "project:project", &schedule.schedule_id).unwrap();
    let raised =
        change_fresh_heartbeat_retained_allowance(&f.path, &change(2, 2), &f.binding).unwrap();
    assert_eq!(raised.allowance.retained_limit, 2);
    assert_eq!(
        read_heartbeat(&f.path, "project:project", &schedule.schedule_id).unwrap(),
        before,
        "a host change cannot implicitly resume a schedule or alter its per-schedule limit"
    );
    assert_eq!(
        fresh_heartbeat_inventory(&f.path, "project", None)
            .unwrap()
            .len(),
        1,
        "limit changes never prune or recreate resources"
    );
    for limit in [0, 10_001] {
        assert!(
            change_fresh_heartbeat_retained_allowance(&f.path, &change(3, limit), &f.binding)
                .is_err()
        );
    }
}

#[test]
fn concurrent_host_allowance_changes_have_one_revision_winner_and_identical_retries_converge() {
    let f = Fixture::new();
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers = [change(1, 2), change(1, 3)].map(|request| {
        let path = f.path.clone();
        let binding = f.binding.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            change_fresh_heartbeat_retained_allowance(&path, &request, &binding)
        })
    });
    let results = workers.map(|worker| worker.join().unwrap());
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        fresh_heartbeat_retained_allowance(&f.path)
            .unwrap()
            .revision,
        2
    );
    let request = change(2, 4);
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let workers = [0, 1].map(|_| {
        let path = f.path.clone();
        let binding = f.binding.clone();
        let barrier = barrier.clone();
        let request = request.clone();
        std::thread::spawn(move || {
            barrier.wait();
            change_fresh_heartbeat_retained_allowance(&path, &request, &binding)
        })
    });
    let [a, b] = workers.map(|worker| worker.join().unwrap().unwrap());
    assert_eq!(a, b);
    assert_eq!(
        fresh_heartbeat_retained_allowance(&f.path)
            .unwrap()
            .revision,
        3
    );
    assert_eq!(
        open_runtime_connection(&f.path)
            .unwrap()
            .query_row::<i64, _, _>(
                "SELECT count(*) FROM heartbeat_retained_commands",
                [],
                |row| row.get(0)
            )
            .unwrap(),
        2
    );
}

#[test]
fn host_allowance_change_revalidates_the_exact_local_project_policy_context() {
    let f = Fixture::new();
    let request = change(1, 2);
    let mut wrong = f.binding.clone();
    wrong.backend = "ssh".into();
    assert!(change_fresh_heartbeat_retained_allowance(&f.path, &request, &wrong).is_err());
    wrong = f.binding.clone();
    wrong.cwd = "changed".into();
    assert!(change_fresh_heartbeat_retained_allowance(&f.path, &request, &wrong).is_err());
    assert_eq!(
        fresh_heartbeat_retained_allowance(&f.path)
            .unwrap()
            .revision,
        1
    );
    let mut json = serde_json::to_value(request).unwrap();
    for field in ["origin", "human", "backend"] {
        json[field] = serde_json::json!("forged");
        assert!(serde_json::from_value::<FreshTaskRetainedAllowanceChange>(json.clone()).is_err());
        json.as_object_mut().unwrap().remove(field);
    }
}
