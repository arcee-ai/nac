//! Intent withdrawal and the durable boundary that starts review scope.
use super::*;
use crate::sessions::ReviewIntent::{Accepted, NeverRecorded, Unavailable};

#[tokio::test]
async fn first_review_enable_discards_manual_overflow_and_reselection_preserves_scope() {
    let path = store_with_session("session-a");
    for _ in 0..21 {
        record_message(&path, "session-a", "manual period: publish everything");
    }
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        Unavailable
    );
    let reviewer = FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]);
    let broker = broker(
        &path,
        "session-a",
        PermissionBackend::Local,
        [],
        Arc::clone(&reviewer),
    );
    broker
        .set_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        NeverRecorded
    );
    record_message(&path, "session-a", "fix tests; do not push");
    let state =
        crate::sessions::load_effective_permission_approval_state(&path, "session-a").unwrap();
    assert_eq!(
        state.1, 0,
        "review never claims automatic-approval generations"
    );
    broker
        .set_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    assert_eq!(
        crate::sessions::load_effective_permission_approval_state(&path, "session-a").unwrap(),
        state,
        "current-mode reselection is a complete no-op"
    );
    assert_eq!(
        authorize(&broker, &[execute("command:[ls]")]).await,
        AuthorizationOutcome::Allowed
    );
    assert_eq!(reviewer.seen()[0].user_intent, ["fix tests; do not push"]);
    drop(broker);
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        Accepted(vec!["fix tests; do not push".into()])
    );
}

#[tokio::test]
async fn review_scope_boundaries_follow_the_childs_root_policy() {
    let path = store_with_session("session-a");
    insert_direct_session(&path, "child");
    crate::store::create_traditional_child_relationship(
        &path,
        "session-a",
        "child",
        crate::store::GENERAL_CHILD_PROFILE,
        "child",
    )
    .unwrap();
    for _ in 0..21 {
        record_message(&path, "child", "manual child history");
    }
    let root = broker(
        &path,
        "session-a",
        PermissionBackend::Local,
        [],
        FakeReviewer::answering([]),
    );
    let child_reviewer = FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]);
    let child = broker(
        &path,
        "child",
        PermissionBackend::Local,
        [],
        Arc::clone(&child_reviewer),
    );
    root.set_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "child").unwrap(),
        NeverRecorded
    );
    record_message(
        &path,
        "child",
        "inspect the child test failure; keep changes local",
    );
    assert_eq!(
        authorize(&child, &[execute("command:[ls]")]).await,
        AuthorizationOutcome::Allowed
    );
    assert_eq!(
        child_reviewer.seen()[0].user_intent,
        ["inspect the child test failure; keep changes local"]
    );
    root.set_approval_mode(PermissionApprovalMode::AutoApprove)
        .await
        .unwrap();
    let state = crate::sessions::load_effective_permission_approval_state(&path, "child").unwrap();
    assert_eq!(state.0, PermissionApprovalMode::AutoApprove);
    assert_eq!(state.1, 1);
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "child").unwrap(),
        NeverRecorded
    );
    record_message(&path, "child", "outside-review text");
    root.set_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "child").unwrap(),
        NeverRecorded
    );
    assert_eq!(
        crate::sessions::load_effective_permission_approval_state(&path, "child")
            .unwrap()
            .1,
        1
    );
}

#[tokio::test]
async fn reverting_user_text_discards_inflight_verdict_and_stays_manual_after_restart() {
    let (path, broker, reviewer, release) = gated_broker().await;
    let writer = crate::store::TranscriptLogWriter::new(&path).unwrap();
    writer
        .append_person_run_prompt(
            "session-a",
            0,
            &crate::types::Message::User {
                content: "publish the release".into(),
            },
            "run-a",
            "publish the release",
        )
        .unwrap();
    let pending = spawn_authorize(&broker, vec![execute("command:[ls]")]);
    tokio::time::timeout(Duration::from_secs(2), reviewer.started.notified())
        .await
        .unwrap();
    writer.delete_from("session-a", 0).unwrap();
    release.send(ReviewVerdict::ApproveOnce).unwrap();
    let outcome = tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap();
    assert!(denied(outcome).contains("no interactive session client"));
    assert!(broker
        .recent_reviews()
        .iter()
        .all(|r| r.outcome != Some(PermissionReviewOutcome::Approved)));
    drop(writer);
    drop(broker);
    let fresh = FakeReviewer::answering([Ok(ReviewVerdict::ApproveOnce)]);
    let restarted = super::broker(
        &path,
        "session-a",
        PermissionBackend::Local,
        [],
        Arc::clone(&fresh),
    );
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        Unavailable
    );
    record_message(&path, "session-a", "continue");
    restarted
        .set_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        Unavailable,
        "resending text or reselecting Review cannot reconstruct missing restrictions"
    );
    assert!(
        denied(authorize(&restarted, &[execute("command:[ls]")]).await)
            .contains("no interactive session client")
    );
    assert!(fresh.seen().is_empty());
    restarted
        .set_approval_mode(PermissionApprovalMode::Manual)
        .await
        .unwrap();
    restarted
        .set_approval_mode(PermissionApprovalMode::Review)
        .await
        .unwrap();
    record_message(&path, "session-a", "inspect files; do not publish");
    assert_eq!(
        authorize(&restarted, &[execute("command:[ls]")]).await,
        AuthorizationOutcome::Allowed
    );
    assert_eq!(
        fresh.seen()[0].user_intent,
        ["inspect files; do not publish"]
    );
}

#[tokio::test]
async fn sibling_person_delivery_discards_a_review_using_older_tree_scope() {
    let (path, root) = review_broker(PermissionBackend::Local, FakeReviewer::answering([])).await;
    for child in ["reviewing-child", "restricting-child"] {
        insert_direct_session(&path, child);
        crate::store::create_traditional_child_relationship(
            &path,
            "session-a",
            child,
            crate::store::GENERAL_CHILD_PROFILE,
            child,
        )
        .unwrap();
    }
    let child = broker(
        &path,
        "reviewing-child",
        PermissionBackend::Local,
        [],
        FakeReviewer::answering([]),
    );
    let (gated, release) = GatedReviewer::new();
    child.set_reviewer(Arc::clone(&gated) as Arc<dyn PermissionReviewer>);
    let bus = crate::events::SessionEventBus::new(Some("reviewing-child".into()));
    let _interactive = bus.subscribe_assistant_deltas();
    let mut events = bus.subscribe();
    child.attach_event_bus(bus);
    let pending = spawn_authorize(&child, vec![execute("command:[git][push]")]);
    tokio::time::timeout(Duration::from_secs(2), gated.started.notified())
        .await
        .unwrap();
    let before =
        crate::sessions::load_effective_permission_approval_state(&path, "reviewing-child")
            .unwrap();
    let restriction = "Do not push or publish; keep all work local.";
    crate::store::TranscriptLogWriter::new(&path)
        .unwrap()
        .append_person_run_prompt(
            "restricting-child",
            0,
            &crate::types::Message::User {
                content: restriction.into(),
            },
            "restriction-run",
            restriction,
        )
        .unwrap();
    let after = crate::sessions::load_effective_permission_approval_state(&path, "reviewing-child")
        .unwrap();
    assert_eq!((after.0, after.1), (before.0, before.1));
    assert!(
        after.2 > before.2,
        "committed sibling intent must invalidate the old review revision"
    );
    release.send(ReviewVerdict::ApproveOnce).unwrap();
    let request = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let crate::events::SessionEvent::PermissionAsked { request } =
                events.recv().await.unwrap().event
            {
                break request;
            }
        }
    })
    .await
    .unwrap();
    child.reply(&request.id, PermissionReply::Reject).unwrap();
    assert!(denied(
        tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap()
    )
    .contains("user rejected"));
    assert!(child
        .recent_reviews()
        .iter()
        .all(|r| r.outcome != Some(PermissionReviewOutcome::Approved)));
    let fresh = FakeReviewer::answering([Ok(ReviewVerdict::Reject(ReviewCategory::OutOfScope))]);
    child.set_reviewer(Arc::clone(&fresh) as Arc<dyn PermissionReviewer>);
    assert!(
        denied(authorize(&child, &[execute("command:[git][push]")]).await)
            .contains("code=review_rejected")
    );
    assert_eq!(fresh.seen()[0].user_intent.last().unwrap(), restriction);
    assert_eq!(
        root.approval_mode().await.unwrap(),
        PermissionApprovalMode::Review
    );
}

#[tokio::test]
async fn only_committed_person_delivery_advances_the_active_scope_revision() {
    use crate::store::{
        cancel_pending_session_inbox_item, create_person_session_inbox_item,
        create_session_inbox_item, InboxDelivery, TranscriptLogWriter,
    };
    let (path, _broker) =
        review_broker(PermissionBackend::Local, FakeReviewer::answering([])).await;
    let state =
        || crate::sessions::load_effective_permission_approval_state(&path, "session-a").unwrap();
    let before = state();
    let writer = TranscriptLogWriter::new(&path).unwrap();
    let user = |text: &str| crate::types::Message::User {
        content: text.into(),
    };
    writer
        .append_run_prompt("session-a", 0, &user("automation continuation"), "run-a")
        .unwrap();
    assert_eq!(
        state(),
        before,
        "automation delivery must not revise human scope"
    );
    let cancelled = create_person_session_inbox_item(
        &path,
        "session-a",
        InboxDelivery::Queue,
        "publish release",
        None,
        None,
        "publish release",
    )
    .unwrap();
    cancel_pending_session_inbox_item(&path, "session-a", cancelled.id, cancelled.version).unwrap();
    let pending = create_person_session_inbox_item(
        &path,
        "session-a",
        InboxDelivery::Queue,
        "do not delete",
        None,
        None,
        "do not delete",
    )
    .unwrap();
    assert_eq!(
        state(),
        before,
        "cancelled and unconsumed human input have no review authority"
    );
    create_session_inbox_item(
        &path,
        "session-a",
        InboxDelivery::Steer,
        "automated steer",
        Some("run-a"),
        None,
    )
    .unwrap();
    writer
        .append_pending_inbox_steers("session-a", "run-a", 1)
        .unwrap();
    assert_eq!(
        state(),
        before,
        "consumed automation is still not human intent"
    );
    create_person_session_inbox_item(
        &path,
        "session-a",
        InboxDelivery::Steer,
        "do not push",
        Some("run-a"),
        None,
        "do not push",
    )
    .unwrap();
    writer
        .append_pending_inbox_steers("session-a", "run-a", 2)
        .unwrap();
    let after = state();
    assert_eq!((after.0, after.1), (before.0, before.1));
    assert_eq!(after.2, before.2 + 1);
    // Delivery replay is idempotent and cannot manufacture another revision.
    writer
        .append_pending_inbox_steers("session-a", "run-a", 2)
        .unwrap();
    assert_eq!(state(), after);
    assert_eq!(
        crate::store::load_session_inbox_item(&path, "session-a", pending.id)
            .unwrap()
            .status,
        crate::store::InboxStatus::Pending
    );
}

#[tokio::test]
async fn scope_revision_preserves_transition_cas_and_auto_approval_generation() {
    let (path, _broker) =
        review_broker(PermissionBackend::Local, FakeReviewer::answering([])).await;
    let before =
        crate::sessions::load_effective_permission_approval_state(&path, "session-a").unwrap();
    let stale =
        crate::sessions::reserve_permission_approval_transition(&path, "session-a").unwrap();
    record_message(&path, "session-a", "do not push");
    assert!(
        !crate::sessions::compare_and_update_permission_approval_state(
            &path,
            "session-a",
            stale,
            PermissionApprovalMode::AutoApprove,
        )
        .unwrap(),
        "an older delayed mode writer must not overwrite newer human scope"
    );
    let current =
        crate::sessions::load_effective_permission_approval_state(&path, "session-a").unwrap();
    assert_eq!((current.0, current.1), (before.0, before.1));
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        Accepted(vec!["work on the project".into(), "do not push".into()])
    );
    let fresh =
        crate::sessions::reserve_permission_approval_transition(&path, "session-a").unwrap();
    assert!(
        crate::sessions::compare_and_update_permission_approval_state(
            &path,
            "session-a",
            fresh,
            PermissionApprovalMode::AutoApprove,
        )
        .unwrap()
    );
    let enabled =
        crate::sessions::load_effective_permission_approval_state(&path, "session-a").unwrap();
    assert_eq!(enabled.0, PermissionApprovalMode::AutoApprove);
    assert_eq!(enabled.1, before.1 + 1);
    assert_eq!(enabled.2, fresh);
    assert_eq!(
        crate::sessions::load_permission_review_intent(&path, "session-a").unwrap(),
        NeverRecorded
    );
}
