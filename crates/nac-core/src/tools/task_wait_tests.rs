use super::*;
use crate::store::{GoalStatus, UserGoalUpdate};
use crate::tools::task_discovery::tests::{call, cleanup, runtime, session, value};

fn target(id: &str) -> Value {
    json!({"session_id":id,"mode":"goal"})
}

#[tokio::test]
async fn exact_goal_survives_replacement_and_cursor_suppresses_terminal_replay() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "ship", None, None).unwrap();
    let first = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")]}),
    )
    .await;
    assert_eq!(first["status"], "snapshot");
    assert_eq!(first["targets"][0]["status"], "active");
    assert_eq!(first["targets"][0]["resolved_identity"], goal.goal_id);
    store::update_session_goal_by_model(
        &runtime.store_path,
        "peer-a",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    store::create_session_goal(&runtime.store_path, "peer-a", "later", None, None).unwrap();
    let mut pinned = target("peer-a");
    pinned["after_cursor"] = first["targets"][0]["after_cursor"].clone();
    let completed = value(&runtime, "wait_tasks", json!({"targets":[pinned]})).await;
    assert_eq!(completed["targets"][0]["status"], "goal_complete");
    assert_eq!(completed["targets"][0]["proof"]["retained"], true);
    pinned["after_cursor"] = completed["targets"][0]["after_cursor"].clone();
    let repeated = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[pinned],"timeout_ms":10}),
    )
    .await;
    assert_eq!(repeated["status"], "timeout");
    assert_eq!(repeated["targets"][0]["unchanged"], true);
    assert!(repeated["targets"][0]["proof"].is_null());
    assert!(matches!(
        store::load_direct_task(&runtime.store_path, "peer-a").unwrap(),
        store::TaskLookup::Found(_)
    ));
    cleanup(&runtime);
}

#[tokio::test]
async fn goal_only_pause_wakes_without_a_run_or_delta_subscriber() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "ship", None, None).unwrap();
    let input = json!({"targets":[target("peer-a")],"timeout_ms":5_000});
    let waiting = call(&runtime, "wait_tasks", input);
    let change = async {
        store::update_session_goal_by_user(
            &runtime.store_path,
            "peer-a",
            &goal.goal_id,
            goal.version,
            UserGoalUpdate {
                status: Some(GoalStatus::Paused),
                ..Default::default()
            },
        )
        .unwrap();
    };
    let (result, ()) = tokio::join!(waiting, change);
    assert!(!result.is_error, "{}", result.content);
    let result: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    assert_eq!(result["targets"][0]["status"], "goal_paused");
    cleanup(&runtime);
}

#[tokio::test]
async fn run_results_are_pinned_and_missing_current_never_advances() {
    let runtime = runtime(Vec::new());
    let first = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[{"session_id":"peer-a"}]}),
    )
    .await;
    assert_eq!(first["targets"][0]["status"], "unavailable");
    let conn = store::open_runtime_connection(&runtime.store_path).unwrap();
    for (id, text) in [("r1", "first result"), ("r2", "later result")] {
        store::record_run_outcome_with_connection(
            &conn,
            "peer-a",
            id,
            store::RunOutcomeDisposition::Completed,
            Some(text),
            None,
        )
        .unwrap();
    }
    let result = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[{"session_id":"peer-a","run_id":"r1"}]}),
    )
    .await;
    assert_eq!(result["targets"][0]["status"], "result_available");
    assert_eq!(
        result["targets"][0]["proof"]["result_excerpt"],
        "first result"
    );
    let result = value(&runtime,"wait_tasks",json!({"targets":[{"session_id":"peer-a","after_cursor":first["targets"][0]["after_cursor"]}]})).await;
    assert!(result["targets"][0]["resolved_identity"].is_null());
    assert_eq!(result["targets"][0]["status"], "unavailable");
    cleanup(&runtime);
}

#[tokio::test]
async fn input_interrupts_without_consuming_guidance_or_pausing_targets() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "ship", None, None).unwrap();
    let item = store::create_person_session_inbox_item(
        &runtime.store_path,
        "caller",
        store::InboxDelivery::Steer,
        "new guidance",
        None,
        None,
        "new guidance",
    )
    .unwrap();
    let result = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")],"timeout_ms":5_000}),
    )
    .await;
    assert_eq!(result["status"], "coordinator_input");
    assert_eq!(
        store::next_pending_session_inbox_item(&runtime.store_path, "caller")
            .unwrap()
            .unwrap()
            .id,
        item.id
    );
    assert_eq!(
        store::load_session_goal(&runtime.store_path, "peer-a")
            .unwrap()
            .unwrap(),
        goal
    );
    cleanup(&runtime);
}

#[tokio::test]
async fn limits_scope_denials_and_cursor_binding_are_explicit() {
    use crate::permissions::{PermissionEffect, PermissionRule};
    let runtime = runtime(vec![PermissionRule::new(
        "task_read",
        "session:peer-b",
        PermissionEffect::Deny,
    )]);
    for input in [
        json!({"targets":[]}),
        json!({"targets":vec![target("peer-a");9]}),
        json!({"targets":[target("peer-a")],"timeout_ms":60_001}),
        json!({"targets":[{"session_id":"peer-a","mode":"goal","run_id":"r1"}]}),
    ] {
        assert!(call(&runtime, "wait_tasks", input).await.is_error);
    }
    assert!(
        call(
            &runtime,
            "wait_tasks",
            json!({"targets":[target("peer-b")]})
        )
        .await
        .is_error
    );
    let foreign = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("foreign"),target("gone")]}),
    )
    .await;
    assert_eq!(foreign["targets"][0]["status"], "outside_scope");
    assert_eq!(foreign["targets"][1]["status"], "not_found");
    let one = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")]}),
    )
    .await;
    assert!(call(&runtime,"wait_tasks",json!({"targets":[{"session_id":"peer-b","mode":"goal","after_cursor":one["targets"][0]["after_cursor"]}]})).await.is_error);
    cleanup(&runtime);
}

#[tokio::test]
async fn epoch_changes_revalidate_without_replaying_final_or_switching_goal() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "ship", None, None).unwrap();
    store::update_session_goal_by_model(
        &runtime.store_path,
        "peer-a",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let first = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")]}),
    )
    .await;
    let mut cursor: Value =
        serde_json::from_str(first["targets"][0]["after_cursor"].as_str().unwrap()).unwrap();
    cursor["epoch"] = json!("prior-server");
    store::create_session_goal(&runtime.store_path, "peer-a", "new goal", None, None).unwrap();
    let next = value(&runtime,"wait_tasks",json!({"targets":[{"session_id":"peer-a","mode":"goal","after_cursor":cursor.to_string()}]})).await;
    assert_eq!(next["targets"][0]["resync"], true);
    assert_eq!(next["targets"][0]["unchanged"], true);
    assert_eq!(next["targets"][0]["resolved_identity"], goal.goal_id);
    cleanup(&runtime);
}

#[tokio::test]
async fn representative_snapshots_and_bounded_wait_cost() {
    let runtime = runtime(Vec::new());
    for index in 0..8 {
        let id = format!("measured-{index}");
        session(&runtime.store_path, &id, Some("p1"), "measurement");
        store::create_session_goal(
            &runtime.store_path,
            &id,
            "x".repeat(10_000).as_str(),
            None,
            None,
        )
        .unwrap();
    }
    for count in [1, 2, 4, 8] {
        let targets: Vec<_> = (0..count)
            .map(|i| target(&format!("measured-{i}")))
            .collect();
        let start = std::time::Instant::now();
        let snapshot = call(&runtime, "wait_tasks", json!({"targets":targets})).await;
        assert!(!snapshot.is_error, "{}", snapshot.content);
        let elapsed = start.elapsed();
        let bytes = snapshot.content.as_text().unwrap().len();
        println!(
            "wait_tasks targets={count} snapshot_us={} output_bytes={bytes}",
            elapsed.as_micros()
        );
        assert!(bytes < MAX_OUTPUT_BYTES);
        assert!(elapsed < Duration::from_secs(2));
        let start = std::time::Instant::now();
        let wait = value(
            &runtime,
            "wait_tasks",
            json!({"targets":targets,"timeout_ms":500}),
        )
        .await;
        println!(
            "wait_tasks targets={count} bounded_wait_ms={}",
            start.elapsed().as_millis()
        );
        assert_eq!(wait["status"], "timeout");
    }
    cleanup(&runtime);
}

#[tokio::test]
async fn observes_existing_approval_without_becoming_an_approver_or_answering_it() {
    use crate::permissions::{
        PermissionBackend, PermissionBroker, PermissionEffect, PermissionReply, PermissionRule,
    };
    use std::sync::Arc;
    let runtime = runtime(Vec::new());
    store::create_session_goal(&runtime.store_path, "peer-a", "ship", None, None).unwrap();
    let broker = Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "peer-a".into(),
        PermissionBackend::Local,
        0,
        [PermissionRule::new("read", "*", PermissionEffect::Ask)],
    ));
    let bus = crate::events::SessionEventBus::new(Some("peer-a".into()));
    let interactive = bus.subscribe_assistant_deltas();
    broker.attach_event_bus(bus.clone());
    crate::permissions::task_observation::bind_runs(
        &broker,
        Arc::new(|| Some("observed-run".into())),
    );
    let conn = store::open_runtime_connection(&runtime.store_path).unwrap();
    conn.execute("INSERT INTO thread_events (session_id, thread_name, event_json, created_at) VALUES ('peer-a', '__direct__', '{}', 'now')",[]).unwrap();
    conn.execute("INSERT INTO session_run_recovery (session_id,run_id,submitted_message_id,status) VALUES ('peer-a','observed-run',?1,'active')",[conn.last_insert_rowid()]).unwrap();
    drop(conn);
    let pending = {
        let broker = broker.clone();
        tokio::spawn(async move {
            broker
                .authorize(
                    "read",
                    &[PermissionResource::new("read", "/outside")],
                    &ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        })
    };
    tokio::time::timeout(Duration::from_secs(2), async {
        while broker.pending().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let request = broker.pending().pop().unwrap();
    let result = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")]}),
    )
    .await;
    assert_eq!(result["targets"][0]["status"], "approval_attention");
    assert_eq!(result["targets"][0]["attention"]["request_id"], request.id);
    assert_eq!(broker.pending().len(), 1);
    drop(interactive);
    assert!(
        !bus.has_interactive_subscribers(),
        "passive observer must not count as an approver"
    );
    // The existing owner dismisses a headless pending Ask. Observers cannot keep it alive.
    let outcome = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        outcome,
        crate::permissions::AuthorizationOutcome::Denied(_)
    ));
    assert!(broker.reply(&request.id, PermissionReply::Once).is_err());
    cleanup(&runtime);
}

#[tokio::test]
async fn timeout_and_cancellation_preserve_idle_target_inbox_and_goal() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "ship", None, None).unwrap();
    let inbox = store::create_session_inbox_item(
        &runtime.store_path,
        "peer-a",
        store::InboxDelivery::Queue,
        "pending target work",
        None,
        None,
    )
    .unwrap();
    let result = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")],"timeout_ms":20}),
    )
    .await;
    assert_eq!(result["status"], "timeout");
    runtime.command_cancellation.cancel();
    let _ = call(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")],"timeout_ms":5_000}),
    )
    .await;
    assert_eq!(
        store::load_session_goal(&runtime.store_path, "peer-a")
            .unwrap()
            .unwrap(),
        goal
    );
    assert_eq!(
        store::next_pending_session_inbox_item(&runtime.store_path, "peer-a")
            .unwrap()
            .unwrap()
            .id,
        inbox.id
    );
    cleanup(&runtime);
}

#[tokio::test]
async fn retention_overflow_is_unavailable_and_active_retirement_never_succeeds() {
    let runtime = runtime(Vec::new());
    let first =
        store::create_session_goal(&runtime.store_path, "peer-a", "old", None, None).unwrap();
    store::clear_session_goal(&runtime.store_path, "peer-a", &first.goal_id, first.version)
        .unwrap();
    let cleared = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[{"session_id":"peer-a","mode":"goal","goal_id":first.goal_id}]}),
    )
    .await;
    assert_eq!(cleared["targets"][0]["status"], "cleared");
    for _ in 0..store::RETAINED_GOAL_OUTCOMES {
        let current =
            store::create_session_goal(&runtime.store_path, "peer-a", "later", None, None).unwrap();
        store::clear_session_goal(
            &runtime.store_path,
            "peer-a",
            &current.goal_id,
            current.version,
        )
        .unwrap();
    }
    let expired = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[{"session_id":"peer-a","mode":"goal","goal_id":first.goal_id}]}),
    )
    .await;
    assert_eq!(expired["targets"][0]["status"], "unavailable");
    cleanup(&runtime);
}

#[tokio::test]
async fn idle_cached_broker_is_not_authoritative_for_a_foreign_run() {
    use crate::permissions::{PermissionBackend, PermissionBroker};
    use std::sync::Arc;
    let runtime = runtime(Vec::new());
    let broker = Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "peer-a".into(),
        PermissionBackend::Local,
        0,
        [],
    ));
    let bus = crate::events::SessionEventBus::new(Some("peer-a".into()));
    broker.attach_event_bus(bus.clone());
    crate::permissions::task_observation::bind_runs(&broker, Arc::new(|| None));
    let conn = store::open_runtime_connection(&runtime.store_path).unwrap();
    conn.execute("INSERT INTO thread_events (session_id, thread_name, event_json, created_at) VALUES ('peer-a', '__direct__', '{}', 'now')",[]).unwrap();
    conn.execute("INSERT INTO session_run_recovery (session_id,run_id,submitted_message_id,status) VALUES ('peer-a','foreign-run',?1,'active')",[conn.last_insert_rowid()]).unwrap();
    let input = json!({"targets":[{"session_id":"peer-a","run_id":"foreign-run"}]});
    for _ in 0..2 {
        let observed = value(&runtime, "wait_tasks", input.clone()).await;
        assert_eq!(observed["targets"][0]["approvals"], "unknown");
        assert!(!bus.has_interactive_subscribers());
        crate::permissions::task_observation::bind_runs(
            &broker,
            Arc::new(|| Some("different-run".into())),
        );
    }
    cleanup(&runtime);
}

#[tokio::test]
async fn restart_wait_probe() {
    let Ok(path) = std::env::var("NAC_EXACT_WAIT_PROBE_STORE") else {
        return;
    };
    use crate::permissions::{PermissionBackend, PermissionBroker};
    use std::sync::Arc;
    let mut runtime = crate::tools::test_runtime();
    runtime.store_path = path.into();
    runtime.session_id = Some("caller".into());
    runtime.permission_broker = Some(Arc::new(PermissionBroker::new(
        runtime.store_path.clone(),
        "caller".into(),
        PermissionBackend::Local,
        0,
        [],
    )));
    let receipt = runtime.store_path.with_extension("wait-receipt.json");
    let input = if receipt.exists() {
        let previous: Value = serde_json::from_slice(&std::fs::read(&receipt).unwrap()).unwrap();
        json!({"targets":[{"session_id":"peer-a","mode":"goal","after_cursor":previous["targets"][0]["after_cursor"]}]})
    } else {
        json!({"targets":[target("peer-a")]})
    };
    let result = value(&runtime, "wait_tasks", input).await;
    std::fs::write(receipt, serde_json::to_vec(&result).unwrap()).unwrap();
}

#[test]
fn real_process_restart_keeps_exact_retained_proof_and_suppresses_replay() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "first", None, None).unwrap();
    store::update_session_goal_by_model(
        &runtime.store_path,
        "peer-a",
        &goal.goal_id,
        GoalStatus::Complete,
    )
    .unwrap();
    let probe = || {
        let result = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tools::task_wait::tests::restart_wait_probe",
                "--nocapture",
            ])
            .env("NAC_EXACT_WAIT_PROBE_STORE", &runtime.store_path)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        );
        serde_json::from_slice::<Value>(
            &std::fs::read(runtime.store_path.with_extension("wait-receipt.json")).unwrap(),
        )
        .unwrap()
    };
    let first = probe();
    assert_eq!(first["targets"][0]["status"], "goal_complete");
    store::create_session_goal(&runtime.store_path, "peer-a", "replacement", None, None).unwrap();
    let second = probe();
    assert_eq!(second["targets"][0]["resolved_identity"], goal.goal_id);
    assert_eq!(second["targets"][0]["resync"], true);
    assert_eq!(second["targets"][0]["unchanged"], true);
    assert!(second["targets"][0]["proof"].is_null());
    cleanup(&runtime);
}

#[tokio::test]
#[ignore = "60-second upper-bound measurement; run in the exclusive performance window"]
async fn maximum_timeout_measurement() {
    let runtime = runtime(Vec::new());
    let mut targets = Vec::new();
    for index in 0..8 {
        let id = format!("bounded-{index}");
        session(&runtime.store_path, &id, Some("p1"), "bounded measurement");
        store::create_session_goal(&runtime.store_path, &id, "active", None, None).unwrap();
        targets.push(target(&id));
    }
    let started = std::time::Instant::now();
    let result = crate::tools::execute_tool(
        "wait_tasks",
        json!({"targets":targets,"timeout_ms":MAX_TIMEOUT_MS}),
        &runtime,
        &crate::model::ModelClient::new_for_test(),
    )
    .await;
    let elapsed = started.elapsed();
    assert!(!result.is_error, "{}", result.content);
    let bytes = result.content.as_text().unwrap().len();
    let result: Value = serde_json::from_str(result.content.as_text().unwrap()).unwrap();
    println!(
        "wait_tasks maximum_timeout targets=8 elapsed_ms={} output_bytes={bytes}",
        elapsed.as_millis()
    );
    assert_eq!(result["status"], "timeout");
    assert!(elapsed >= Duration::from_millis(MAX_TIMEOUT_MS));
    assert!(elapsed < Duration::from_millis(MAX_TIMEOUT_MS + 2_000));
    cleanup(&runtime);
}

#[tokio::test]
async fn ring_gap_and_false_delayed_hints_resync_without_manufacturing_completion() {
    let runtime = runtime(Vec::new());
    let goal =
        store::create_session_goal(&runtime.store_path, "peer-a", "still active", None, None)
            .unwrap();
    let wait = value(
        &runtime,
        "wait_tasks",
        json!({"targets":[target("peer-a")],"timeout_ms":100}),
    );
    let delayed = async {
        tokio::time::timeout(Duration::from_secs(2), async {
            while store::goal_changes::subscriber_count(&runtime.store_path) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        // Deliberately delayed/untrustworthy notifications. Durable truth was
        // never changed, and a ring gap must not turn their payload into proof.
        let mut hint = goal.clone();
        hint.status = GoalStatus::Complete;
        for version in (0..300).rev() {
            hint.version = version;
            store::goal_changes::committed(
                &runtime.store_path,
                &hint,
                store::goal_changes::GoalChangeKind::Current,
            );
        }
    };
    let (result, ()) = tokio::join!(wait, delayed);
    assert_eq!(result["status"], "timeout");
    assert_eq!(result["targets"][0]["status"], "active");
    assert_eq!(result["targets"][0]["resync"], true);
    assert_eq!(
        store::load_session_goal(&runtime.store_path, "peer-a")
            .unwrap()
            .unwrap(),
        goal
    );
    cleanup(&runtime);
}
