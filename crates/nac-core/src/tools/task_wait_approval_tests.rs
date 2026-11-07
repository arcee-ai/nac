use super::*;
use crate::permissions::{
    AuthorizationOutcome, PermissionBackend, PermissionBroker, PermissionEffect, PermissionReply,
    PermissionRequest, PermissionRule,
};
use crate::tools::task_discovery::tests::{cleanup, runtime, value};
use crate::tools::ToolRuntime;
use futures_util::FutureExt;
use std::panic::AssertUnwindSafe;

struct ApprovalFixture {
    runtime: ToolRuntime,
    broker: Arc<PermissionBroker>,
    interactive: crate::events::AssistantStreamDeltaReceiver,
    goal: store::SessionGoalRecord,
    inbox: store::SessionInboxRecord,
    pending: Vec<tokio::task::JoinHandle<AuthorizationOutcome>>,
}

impl ApprovalFixture {
    fn new() -> Self {
        let runtime = runtime(Vec::new());
        store::create_session_goal(&runtime.store_path, "peer-a", "working", None, None).unwrap();
        let goal = store::bind_session_goal_run(
            &runtime.store_path,
            "peer-a",
            &store::GoalRunBaseline {
                run_id: "approval-run".into(),
                billable_tokens: 0,
                started_at_epoch_ms: 0,
                continuation: false,
            },
        )
        .unwrap()
        .unwrap();
        let conn = store::open_runtime_connection(&runtime.store_path).unwrap();
        conn.execute("INSERT INTO thread_events (session_id, thread_name, event_json, created_at) VALUES ('peer-a', '__direct__', '{}', 'now')", []).unwrap();
        conn.execute("INSERT INTO session_run_recovery (session_id, run_id, submitted_message_id, status) VALUES ('peer-a', 'approval-run', ?1, 'active')", [conn.last_insert_rowid()]).unwrap();
        drop(conn);
        let inbox = store::create_session_inbox_item(
            &runtime.store_path,
            "peer-a",
            store::InboxDelivery::Queue,
            "independent target input",
            None,
            None,
        )
        .unwrap();
        let broker = Arc::new(PermissionBroker::new(
            runtime.store_path.clone(),
            "peer-a".into(),
            PermissionBackend::Local,
            0,
            [PermissionRule::new("read", "*", PermissionEffect::Ask)],
        ));
        let bus = crate::events::SessionEventBus::new(Some("peer-a".into()));
        let interactive = bus.subscribe_assistant_deltas();
        broker.attach_event_bus(bus);
        crate::permissions::task_observation::bind_runs(
            &broker,
            Arc::new(|| Some("approval-run".into())),
        );
        Self {
            runtime,
            broker,
            interactive,
            goal,
            inbox,
            pending: Vec::new(),
        }
    }

    async fn ask(&mut self, resource: &'static str) -> PermissionRequest {
        assert!(self.broker.pending().is_empty());
        let broker = Arc::clone(&self.broker);
        self.pending.push(tokio::spawn(async move {
            broker
                .authorize(
                    "read",
                    &[PermissionResource::new("read", resource)],
                    &ToolCallContext::default(),
                    &crate::tools::ThreadCancellation::default(),
                )
                .await
        }));
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if let Some(request) = self.broker.pending().pop() {
                    break request;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned Ask must become pending with the human connection alive")
    }

    async fn close(mut self) {
        // Runs even after a regression assertion panics: dismiss only this
        // fixture's requests and await its owned authorization futures.
        for request in self.broker.pending() {
            self.broker
                .reply(&request.id, PermissionReply::Reject)
                .unwrap();
        }
        let mut denied = true;
        for mut handle in self.pending.drain(..) {
            match tokio::time::timeout(Duration::from_secs(2), &mut handle).await {
                Ok(Ok(AuthorizationOutcome::Denied(_))) => {}
                Err(_) => {
                    denied = false;
                    handle.abort();
                    let _ = handle.await;
                }
                Ok(_) => denied = false,
            }
        }
        let grants = store::list_permission_grants(&self.runtime.store_path, "peer-a").unwrap();
        let pending = self.broker.pending();
        drop(self.interactive);
        cleanup(&self.runtime);
        assert!(denied, "all owned Ask futures must finish denied");
        assert!(pending.is_empty());
        assert!(grants.is_empty(), "observation never grants permission");
    }
}

#[tokio::test]
async fn goal_progress_keeps_existing_approval_quiet() {
    let mut fixture = ApprovalFixture::new();
    let result = AssertUnwindSafe(async {
        let request = fixture.ask("/outside-first").await;
        let before = value(
            &fixture.runtime,
            "read_task",
            json!({"session_id":"peer-a"}),
        )
        .await;
        for mode in ["goal", "run"] {
            let first = value(
                &fixture.runtime,
                "wait_tasks",
                json!({"targets":[{
                    "session_id":"peer-a","mode":mode
                }]}),
            )
            .await;
            assert_eq!(first["targets"][0]["status"], "approval_attention");
            assert_eq!(first["targets"][0]["attention"]["request_id"], request.id);
            let pinned = json!({"session_id":"peer-a","mode":mode,
                "after_cursor":first["targets"][0]["after_cursor"]});
            let same = value(
                &fixture.runtime,
                "wait_tasks",
                json!({"targets":[pinned],"timeout_ms":30}),
            )
            .await;
            assert_eq!(same["status"], "timeout");
            assert_eq!(same["targets"][0]["unchanged"], true);
            let current = store::load_session_goal(&fixture.runtime.store_path, "peer-a")
                .unwrap()
                .unwrap();
            let updated = store::update_session_goal_by_user(
                &fixture.runtime.store_path,
                "peer-a",
                &current.goal_id,
                current.version,
                store::UserGoalUpdate {
                    objective: Some(format!("progress in {mode}")),
                    ..Default::default()
                },
            )
            .unwrap();
            assert!(updated.version > current.version);
            assert_eq!(updated.status, current.status);
            assert_eq!(updated.accounting_run_id, current.accounting_run_id);
            assert_eq!(updated.last_failure, current.last_failure);
            let repeated = value(
                &fixture.runtime,
                "wait_tasks",
                json!({"targets":[pinned],"timeout_ms":30}),
            )
            .await;
            assert_eq!(
                repeated["status"], "timeout",
                "{mode}: progress cannot replay an existing Ask"
            );
            assert_eq!(repeated["targets"][0]["unchanged"], true);
            assert!(repeated["targets"][0]["proof"].is_null());
            assert!(repeated["targets"][0]["attention"].is_null());
            let fresh = value(
                &fixture.runtime,
                "wait_tasks",
                json!({"targets":[{
                    "session_id":"peer-a","mode":mode
                }]}),
            )
            .await;
            assert_eq!(fresh["targets"][0]["attention"]["request_id"], request.id);
            if mode == "goal" {
                assert_eq!(
                    fresh["targets"][0]["proof"]["goal_id"],
                    fixture.goal.goal_id
                );
                assert_eq!(fresh["targets"][0]["proof"]["last_run_id"], "approval-run");
                assert_eq!(fresh["targets"][0]["proof"]["version"], updated.version);
            }
            assert_eq!(fixture.broker.pending().len(), 1);
            assert_eq!(fixture.broker.pending()[0].id, request.id);
        }
        let after = value(
            &fixture.runtime,
            "read_task",
            json!({"session_id":"peer-a"}),
        )
        .await;
        assert_eq!(
            before["task"]["durable"]["current_run"],
            after["task"]["durable"]["current_run"]
        );
        assert_eq!(before["task"]["durable"]["pending_inbox_items"], 1);
        assert_eq!(after["task"]["durable"]["pending_inbox_items"], 1);
        assert_eq!(
            store::next_pending_session_inbox_item(&fixture.runtime.store_path, "peer-a").unwrap(),
            Some(fixture.inbox.clone())
        );
        assert!(
            store::list_permission_grants(&fixture.runtime.store_path, "caller")
                .unwrap()
                .is_empty()
        );
    })
    .catch_unwind()
    .await;
    fixture.close().await;
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

#[tokio::test]
async fn a_new_approval_request_wakes_each_exact_selector() {
    let mut fixture = ApprovalFixture::new();
    let result = AssertUnwindSafe(async {
        let first_request = fixture.ask("/outside-first").await;
        let first = value(&fixture.runtime, "wait_tasks", json!({"targets":[
            {"session_id":"peer-a","mode":"goal"}, {"session_id":"peer-a","mode":"run"}
        ]})).await;
        fixture.broker.reply(&first_request.id, PermissionReply::Reject).unwrap();
        let next_request = fixture.ask("/outside-second").await;
        assert_ne!(first_request.id, next_request.id);
        for (index, mode) in ["goal", "run"].into_iter().enumerate() {
            let changed = value(&fixture.runtime, "wait_tasks", json!({"targets":[{
                "session_id":"peer-a","mode":mode,"after_cursor":first["targets"][index]["after_cursor"]
            }],"timeout_ms":30})).await;
            assert_eq!(changed["status"], "target_changed");
            assert_eq!(changed["targets"][0]["attention"]["request_id"], next_request.id);
            let same = value(&fixture.runtime, "wait_tasks", json!({"targets":[{
                "session_id":"peer-a","mode":mode,"after_cursor":changed["targets"][0]["after_cursor"]
            }],"timeout_ms":30})).await;
            assert_eq!(same["status"], "timeout");
            assert_eq!(same["targets"][0]["unchanged"], true);
        }
    }).catch_unwind().await;
    fixture.close().await;
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}

fn approval_observation() -> Value {
    json!({"status":"approval_attention","approvals":"local_owner",
        "attention":{"request_id":"ask-one","session_id":"peer-a","navigation":"/session/peer-a/insights?permission_request=ask-one"},
        "proof":{"goal_id":"exact-goal","version":1,"goal_status":"active",
            "last_run_id":"exact-run","failure":null,"retained":false,"retirement":null}})
}

fn state_report(after_cursor: Option<Value>, observation: Value) -> (Value, bool) {
    let mut target: Target = serde_json::from_value(json!({
        "session_id":"peer-a","mode":"goal","goal_id":"exact-goal","after_cursor":after_cursor
    }))
    .unwrap();
    target.bind_cursor("caller").unwrap();
    target.resolved = Some("exact-goal".into());
    target.report("caller", observation)
}

#[test]
fn approval_fingerprint_ignores_only_version_and_preserves_meaningful_proof() {
    let original = approval_observation();
    let (first, first_actionable) = state_report(None, original.clone());
    assert!(first_actionable);
    let cursor: Value = serde_json::from_str(first["after_cursor"].as_str().unwrap()).unwrap();
    assert!(cursor["fingerprint"]
        .as_str()
        .unwrap()
        .starts_with("approval_attention_v1:"));
    let mut progress = original.clone();
    progress["proof"]["version"] = json!(2);
    let (same, actionable) = state_report(Some(first["after_cursor"].clone()), progress.clone());
    assert!(!actionable);
    assert_eq!(same["unchanged"], true);
    assert!(same["proof"].is_null());
    assert!(same["attention"].is_null());
    let (fresh, _) = state_report(None, progress);
    assert_eq!(fresh["proof"]["version"], 2);
    for (field, changed) in [
        ("last_run_id", json!("later-run")),
        (
            "failure",
            json!({"kind":"unknown","diagnostic":"new failure"}),
        ),
        ("goal_status", json!("paused")),
        ("retained", json!(true)),
        ("retirement", json!("replaced")),
    ] {
        let mut observation = original.clone();
        observation["proof"][field] = changed;
        let (report, actionable) = state_report(Some(first["after_cursor"].clone()), observation);
        assert!(
            actionable,
            "meaningful proof field {field} must not be excluded"
        );
        assert!(report["proof"].is_object());
        assert!(report["attention"].is_object());
    }
    let mut new_request = original;
    new_request["attention"]["request_id"] = json!("ask-two");
    assert!(state_report(Some(first["after_cursor"].clone()), new_request).1);
}

#[test]
fn legacy_approval_cursors_migrate_conservatively_and_then_stay_quiet() {
    use sha2::{Digest, Sha256};
    let original = approval_observation();
    let (first, _) = state_report(None, original.clone());
    let mut old: Value = serde_json::from_str(first["after_cursor"].as_str().unwrap()).unwrap();
    old["fingerprint"] = json!(format!(
        "{:x}",
        Sha256::digest(original.to_string().as_bytes())
    ));
    let (exact, actionable) = state_report(Some(json!(old.to_string())), original.clone());
    assert!(!actionable);
    assert_eq!(exact["resync"], true);
    assert_eq!(exact["unchanged"], true);
    let mut changed = original;
    changed["proof"]["version"] = json!(2);
    // Opaque old hashes cannot prove this was only progress. One authoritative
    // resync is required, never comparison against invented cursor proof.
    let (migrated, actionable) = state_report(Some(json!(old.to_string())), changed.clone());
    assert!(actionable);
    assert_eq!(migrated["resync"], true);
    assert_eq!(migrated["proof"]["version"], 2);
    let (repeated, actionable) =
        state_report(Some(migrated["after_cursor"].clone()), changed.clone());
    assert!(!actionable);
    assert_eq!(repeated["resync"], false);
    assert_eq!(repeated["unchanged"], true);
    assert!(repeated["proof"].is_null());
    let mut different_request = changed;
    different_request["attention"]["request_id"] = json!("ask-two");
    assert!(state_report(Some(json!(old.to_string())), different_request).1);
}

#[test]
fn approval_cursor_preserves_epoch_scope_and_stopped_goal_transitions() {
    let original = approval_observation();
    let (first, _) = state_report(None, original.clone());
    let mut cursor: Value = serde_json::from_str(first["after_cursor"].as_str().unwrap()).unwrap();
    cursor["epoch"] = json!("previous-server");
    let (restarted, actionable) = state_report(Some(json!(cursor.to_string())), original.clone());
    assert!(!actionable);
    assert_eq!(restarted["resync"], true);
    for (field, wrong) in [
        ("caller", json!("other-caller")),
        ("session", json!("other-session")),
        ("project", json!("other-project")),
        ("mode", json!("run")),
        ("identity", json!("other-goal")),
    ] {
        let mut bad = cursor.clone();
        bad[field] = wrong;
        let mut target: Target = serde_json::from_value(json!({
            "session_id":"peer-a","mode":"goal","goal_id":"exact-goal","after_cursor":bad.to_string()
        })).unwrap();
        assert!(target.bind_cursor("caller").is_err(), "scope field {field}");
    }
    let mut stopped = original;
    stopped["status"] = json!("goal_paused");
    stopped["proof"]["goal_status"] = json!("paused");
    stopped.as_object_mut().unwrap().remove("attention");
    stopped.as_object_mut().unwrap().remove("approvals");
    let (paused, actionable) = state_report(Some(first["after_cursor"].clone()), stopped.clone());
    assert!(actionable);
    assert_eq!(
        paused["resync"], false,
        "a current approval cursor is not a legacy stopped cursor"
    );
    assert_eq!(paused["proof"]["last_run_id"], "exact-run");
    let (same, actionable) = state_report(Some(paused["after_cursor"].clone()), stopped);
    assert!(!actionable);
    assert_eq!(same["unchanged"], true);
}
