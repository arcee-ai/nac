//! Actual sealed runs retain process and OS cleanup ownership after denial.
use super::completion_capture_tests::snapshot;
use super::run_admission_tests::{build, count, ended, response};
use super::*;
use crate::events::{SessionEvent, SessionRunId};
use crate::model::test_http::{ScriptedResponse, ScriptedServer};
use crate::sessions;

async fn pending(
    service: &crate::session_service::SessionService,
    run: &SessionRunId,
    guard: &ManagedRuntimeLeaseGuard,
) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while service.pending_capture_cleanups_for_test(run) == 0 || guard.check_now().is_ok() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("actual failed owned cleanup must be retained");
}

fn terminals(service: &crate::session_service::SessionService) -> usize {
    service
        .recent_events(None, 64)
        .1
        .iter()
        .filter(|event| {
            matches!(
                event.event,
                SessionEvent::RunCompleted { .. }
                    | SessionEvent::RunFailed { .. }
                    | SessionEvent::RunCancelled
            )
        })
        .count()
}

#[tokio::test]
async fn runtime_capture_cleanup_failure_blocks_terminal_and_keeps_os_lease_until_exact_retry() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response())]);
    let snapshot = snapshot(&fixture, &server.base_url).await;
    let guard = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    parts.service.fail_capture_cleanup_attempts_for_test(100);
    let run = parts
        .service
        .submit_runtime_original(original, "capture cleanup".into())
        .await
        .unwrap();
    pending(&parts.service, &run.run_id, &guard).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(parts.service.has_active_operation());
    assert_eq!(terminals(&parts.service), 0);
    assert_eq!(
        parts.service.pending_capture_cleanups_for_test(&run.run_id),
        1
    );
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&fixture.path, &snapshot.session_id),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    assert!(!snapshot.cwd.join(".git/nac-revisions").exists());
    assert!(parts
        .service
        .try_submit_prompt("new original required".into())
        .is_err());
    parts
        .service
        .release_capture_cleanup_failures_for_test(&run.run_id)
        .await;
    ended(&parts.service).await;
    assert_eq!(
        parts.service.pending_capture_cleanups_for_test(&run.run_id),
        0
    );
    assert_eq!(terminals(&parts.service), 1);
    assert!(
        !snapshot.cwd.join(".git/nac-revisions").exists(),
        "retry performs only owned cleanup, never another Git command"
    );
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(server.finish().len(), 1);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}

#[tokio::test]
async fn runtime_capture_cleanup_cancel_failure_retains_owner_then_duplicate_cancel_settles_once() {
    let _environment = crate::TEST_ENV_LOCK.lock().unwrap();
    let fixture = Fixture::new();
    let _home = ConstructionHome::new(&fixture);
    let server = ScriptedServer::start(vec![ScriptedResponse::json("200 OK", response())]);
    let snapshot = snapshot(&fixture, &server.base_url).await;
    let guard = fixture.guard(20_000).await;
    let (parts, original) = build(&fixture, &snapshot, &guard).await;
    parts.service.fail_capture_cleanup_attempts_for_test(100);
    let run = parts
        .service
        .submit_runtime_original(original, "capture cleanup".into())
        .await
        .unwrap();
    pending(&parts.service, &run.run_id, &guard).await;
    assert!(matches!(
        parts.service.request_cancel(&run.run_id).await,
        Err(crate::session_service::SessionCancelError::Cleanup { .. })
    ));
    assert!(parts.service.has_active_operation());
    assert_eq!(terminals(&parts.service), 0);
    assert_eq!(
        parts.service.pending_capture_cleanups_for_test(&run.run_id),
        1
    );
    assert!(matches!(
        sessions::SessionOperationLease::try_acquire(&fixture.path, &snapshot.session_id),
        Err(sessions::SessionOperationLeaseError::Busy(_))
    ));
    parts
        .service
        .release_capture_cleanup_failures_for_test(&run.run_id)
        .await;
    let (first, second) = tokio::join!(
        parts.service.request_cancel(&run.run_id),
        parts.service.request_cancel(&run.run_id)
    );
    assert!(first.is_ok() || second.is_ok());
    ended(&parts.service).await;
    assert_eq!(
        parts.service.pending_capture_cleanups_for_test(&run.run_id),
        0
    );
    assert_eq!(terminals(&parts.service), 1);
    assert!(!snapshot.cwd.join(".git/nac-revisions").exists());
    assert_eq!(count(&fixture, &snapshot.session_id), 1);
    assert_eq!(server.finish().len(), 1);
    drop(parts);
    drop(guard);
    fixture.finish().await;
}
