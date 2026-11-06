use super::*;
use crate::events::{AttentionBrokerSnapshot, AttentionBrokerState};
use crate::permissions::attention::tests::{observe, Recorder};

fn ids(observer: &Recorder) -> Vec<uuid::Uuid> {
    let snapshots = observer.snapshots.lock().unwrap();
    match &snapshots.last().unwrap().state {
        AttentionBrokerState::Current {
            permissions,
            authorizable_reviews,
        } => {
            assert!(permissions.is_empty());
            authorizable_reviews.clone()
        }
        other => panic!("unexpected state {other:?}"),
    }
}
#[tokio::test]
async fn attention_real_review_membership_tracks_verdict_retry_revoke_and_eviction_not_history() {
    let reviewer = FakeReviewer::answering([
        Ok(ReviewVerdict::Reject(ReviewCategory::Destructive)),
        Ok(ReviewVerdict::Uncertain(None)),
        Ok(ReviewVerdict::ApproveOnce),
        Err(ReviewUnavailable::new(
            PermissionReviewFailureReason::ServiceUnavailable,
            "private detail",
        )),
    ]);
    let (path, broker) = review_broker(PermissionBackend::Local, reviewer).await;
    let (observer, _) = observe(&broker, true);
    let action = [execute("command:[ls]")];
    assert!(matches!(
        authorize(&broker, &action).await,
        AuthorizationOutcome::Denied(_)
    ));
    let first = broker.blocked_reviews()[0].id.clone();
    assert_eq!(ids(&observer), vec![uuid::Uuid::parse_str(&first).unwrap()]);
    assert!(matches!(
        authorize(&broker, &action).await,
        AuthorizationOutcome::Denied(_)
    ));
    assert_eq!(ids(&observer).len(), 2);
    let before = observer.snapshots.lock().unwrap().len();
    assert_eq!(
        authorize(&broker, &action).await,
        AuthorizationOutcome::Allowed
    );
    assert!(matches!(
        authorize(&broker, &action).await,
        AuthorizationOutcome::Denied(_)
    ));
    assert_eq!(
        observer.snapshots.lock().unwrap().len(),
        before,
        "approved/unavailable/history are not actionable membership"
    );
    broker.authorize_review_retry(&first).unwrap();
    assert_eq!(ids(&observer).len(), 1);
    assert!(!ids(&observer).contains(&uuid::Uuid::parse_str(&first).unwrap()));
    assert!(broker.revoke_review_retry(&first));
    assert!(ids(&observer).contains(&uuid::Uuid::parse_str(&first).unwrap()));
    let before = observer.snapshots.lock().unwrap().len();
    assert!(!broker.revoke_review_retry(&first));
    assert_eq!(observer.snapshots.lock().unwrap().len(), before);
    broker.set_reviewer(FakeReviewer::answering(
        (0..11).map(|_| Ok(ReviewVerdict::Reject(ReviewCategory::Destructive))),
    ));
    for _ in 0..11 {
        broker.begin_review_run();
        assert!(matches!(
            authorize(&broker, &action).await,
            AuthorizationOutcome::Denied(_)
        ));
    }
    assert_eq!(ids(&observer).len(), 10);
    assert!(!ids(&observer).contains(&uuid::Uuid::parse_str(&first).unwrap()));
    assert_eq!(ids(&observer).len(), broker.blocked_reviews().len());
    assert!(observer
        .snapshots
        .lock()
        .unwrap()
        .windows(2)
        .all(|pair| pair[0].revision < pair[1].revision));
    drop(broker);
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
#[tokio::test]
async fn attention_in_flight_is_silent_and_restart_has_a_new_owner() {
    let (path, broker, reviewer, release) = gated_broker().await;
    let (observer, installed) = observe(&broker, true);
    let request = spawn_authorize(&broker, vec![execute("command:[ls]")]);
    tokio::time::timeout(Duration::from_secs(2), reviewer.started.notified())
        .await
        .unwrap();
    assert!(observer.snapshots.lock().unwrap().is_empty());
    release
        .send(ReviewVerdict::Reject(ReviewCategory::OutOfScope))
        .unwrap();
    request.await.unwrap();
    assert_eq!(ids(&observer).len(), 1);
    let owner = installed.snapshot.owner;
    drop(broker);
    let restarted = super::broker(
        &path,
        "session-a",
        PermissionBackend::Local,
        [],
        FakeReviewer::answering([]),
    );
    let (_, restarted) = observe(&restarted, true);
    assert_ne!(owner, restarted.snapshot.owner);
    assert!(
        matches!(restarted.snapshot, AttentionBrokerSnapshot { state: AttentionBrokerState::Current { authorizable_reviews, .. }, .. } if authorizable_reviews.is_empty())
    );
    std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
}
