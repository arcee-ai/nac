//! Synthetic qualified owners exercise the denial port, not genuine authority.
use super::*;

#[test]
fn denial_handle_is_unavailable_without_a_boundary() {
    let context = ProtectedExecutionContext::unqualified(backend(), identity());
    assert!(context.cancellation().is_err());
}

#[test]
fn denial_handle_targets_only_its_allocation_even_with_equal_public_identity() {
    let selected = backend();
    let scope = identity();
    let (boundary, denied, _) = test_boundary(&selected, scope);
    let context =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    let (other, other_denied, _) = test_boundary(&selected, scope);
    let other = ProtectedExecutionContext::from_boundary(selected, scope, other).unwrap();
    let cancellation = context.cancellation().unwrap();
    let copy = cancellation.clone();
    copy.cancel();
    cancellation.cancel();
    assert!(context
        .check_stage(ProtectedExecutionStage::Effect)
        .is_err());
    assert!(denied.load(Ordering::Acquire));
    other.check_stage(ProtectedExecutionStage::Effect).unwrap();
    assert!(!other_denied.load(Ordering::Acquire));
}

#[test]
fn denial_handle_can_be_obtained_after_positive_predicate_has_failed() {
    let selected = backend();
    let scope = identity();
    let (boundary, denied, _) = test_boundary(&selected, scope);
    let context = ProtectedExecutionContext::from_boundary(selected, scope, boundary).unwrap();
    // The external owner is no longer current before Core asks for denial.
    denied.store(true, Ordering::Release);
    let cancellation = context.cancellation().unwrap();
    cancellation.cancel();
    assert!(context
        .check_stage(ProtectedExecutionStage::Prepare)
        .is_err());
}

#[test]
fn denial_handle_does_not_retain_resources_or_adopt_a_successor() {
    let selected = backend();
    let scope = identity();
    let (boundary, denied, _) = test_boundary(&selected, scope);
    let observed = Arc::downgrade(&boundary.state);
    let context =
        ProtectedExecutionContext::from_boundary(Arc::clone(&selected), scope, boundary).unwrap();
    let cancellation = context.cancellation().unwrap();
    drop(context);
    assert!(observed.upgrade().is_none());
    assert!(denied.load(Ordering::Acquire));
    let (successor, successor_denied, _) = test_boundary(&selected, scope);
    let successor = ProtectedExecutionContext::from_boundary(selected, scope, successor).unwrap();
    cancellation.clone().cancel();
    cancellation.cancel();
    successor
        .check_stage(ProtectedExecutionStage::Effect)
        .unwrap();
    assert!(!successor_denied.load(Ordering::Acquire));
}
