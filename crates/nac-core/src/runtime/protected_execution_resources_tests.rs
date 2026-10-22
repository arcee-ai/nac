//! Accounting/lifetime controls, not actual Native or Root qualification.
use super::*;

fn limits() -> ScopeLimits {
    ScopeLimits {
        endpoints: 1,
        live_jobs: 2,
        native_payload_bytes: 4096,
        captured_results: 1,
        captured_bytes: 32,
    }
}
fn declaration() -> CompartmentResourceDeclaration {
    let one = NonZeroUsize::new(1).unwrap();
    CompartmentResourceDeclaration::from_raw_capacity(
        NonZeroUsize::new(2).unwrap(),
        one,
        one,
        16,
        32,
        NonZeroUsize::new(4096).unwrap(),
    )
}
fn owner() -> (Arc<HostAdmission>, Arc<SessionAdmission>) {
    let host = HostAdmission::new(limits(), NonZeroUsize::new(2).unwrap());
    let session = host.session(limits()).unwrap();
    (host, session)
}
fn output() -> CompartmentOutput {
    CompartmentOutput {
        exit: CompartmentExit {
            code: Some(0),
            signal: None,
        },
        stdout: b"data".to_vec(),
        stderr: Vec::new(),
        stdout_truncated: false,
        stderr_truncated: false,
    }
}
fn retired(admission: BoundaryAdmission, hold: CompartmentStorageHold) {
    admission.joined();
    drop(admission);
    drop(hold);
}

#[test]
fn endpoint_charge_requires_both_join_and_all_storage_retirement() {
    for storage_first in [false, true] {
        let (host, session) = owner();
        let (admission, hold) = session.reserve_endpoint(declaration()).unwrap().begin();
        assert_eq!(hold.declaration(), declaration());
        let port = hold.clone();
        drop(hold);
        if storage_first {
            drop(port);
            assert!(session.reserve_endpoint(declaration()).is_err());
            admission.joined();
            drop(admission);
        } else {
            admission.joined();
            drop(admission);
            assert!(session.reserve_endpoint(declaration()).is_err());
            drop(port);
        }
        assert_eq!(host.state.lock().unwrap().used, Usage::default());
        // No usage snapshot is used for release; this fresh admission observes
        // the mutation made only by final retirement after the actual join.
        drop(session.reserve_endpoint(declaration()).unwrap());
    }
}

#[test]
fn only_unstarted_preparation_can_roll_back_without_join() {
    let (host, session) = owner();
    drop(session.reserve_endpoint(declaration()).unwrap());
    assert_eq!(host.state.lock().unwrap().used, Usage::default());
    let (admission, hold) = session.reserve_endpoint(declaration()).unwrap().begin();
    // Partial construction failure, timeout, cancellation and loss of the
    // completion capability cannot restore capacity from a mere Drop.
    drop(admission);
    drop(hold);
    assert!(session.reserve_endpoint(declaration()).is_err());
    assert_eq!(host.state.lock().unwrap().used.endpoints, 1);
}

#[test]
fn lost_unknown_session_keeps_its_host_session_slot() {
    let host = HostAdmission::new(limits(), NonZeroUsize::new(1).unwrap());
    let session = host.session(limits()).unwrap();
    let (admission, hold) = session.reserve_endpoint(declaration()).unwrap().begin();
    drop(admission);
    drop(hold);
    drop(session);
    assert!(
        host.session(limits()).is_err(),
        "lost unknown cleanup cannot mint another session owner"
    );
    assert_eq!(host.state.lock().unwrap().sessions, 1);
}

#[test]
fn competing_sessions_share_one_atomic_host_allowance() {
    let (host, first) = owner();
    let second = host.session(limits()).unwrap();
    assert!(host.session(limits()).is_err());
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let handles = [first, second].map(|session| {
        let barrier = Arc::clone(&barrier);
        std::thread::spawn(move || {
            barrier.wait();
            session
                .reserve_endpoint(declaration())
                .map(EndpointPreparation::begin)
        })
    });
    barrier.wait();
    let results = handles.map(|handle| handle.join().unwrap());
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    for result in results.into_iter().flatten() {
        retired(result.0, result.1);
    }
    assert_eq!(host.state.lock().unwrap().used, Usage::default());
    assert_eq!(host.state.lock().unwrap().sessions, 0);
}

#[test]
fn rejected_session_reservation_never_partially_charges_host() {
    let (host, session) = owner();
    let denied = host
        .session(ScopeLimits {
            native_payload_bytes: 4095,
            ..limits()
        })
        .unwrap();
    assert!(denied.reserve_endpoint(declaration()).is_err());
    assert_eq!(host.state.lock().unwrap().used, Usage::default());
    let pair = session.reserve_endpoint(declaration()).unwrap().begin();
    retired(pair.0, pair.1);
    drop(denied);
    assert!(host.session(limits()).is_ok());
}

#[test]
fn overflow_never_wraps_or_mutates_either_scope() {
    let maximum = ScopeLimits {
        endpoints: usize::MAX,
        live_jobs: usize::MAX,
        native_payload_bytes: usize::MAX,
        captured_results: usize::MAX,
        captured_bytes: usize::MAX,
    };
    let host = HostAdmission::new(maximum, NonZeroUsize::new(1).unwrap());
    let session = host.session(maximum).unwrap();
    let mut huge = declaration();
    huge.live_jobs = NonZeroUsize::new(usize::MAX).unwrap();
    huge.accounted_payload_bytes = NonZeroUsize::new(usize::MAX).unwrap();
    let (admission, hold) = session.reserve_endpoint(huge).unwrap().begin();
    let before = host.state.lock().unwrap().used;
    assert!(session.reserve_endpoint(declaration()).is_err());
    assert!(admission.capture(usize::MAX, 1).is_err());
    assert_eq!(host.state.lock().unwrap().used, before);
    let capture = admission.capture(usize::MAX, 0).unwrap();
    assert!(admission.capture(1, 0).is_err());
    drop(capture);
    retired(admission, hold);
    assert_eq!(host.state.lock().unwrap().used, Usage::default());
}

#[test]
fn transferred_capture_outlives_endpoint_and_validates_capacity_not_length() {
    let (host, session) = owner();
    let (admission, hold) = session.reserve_endpoint(declaration()).unwrap().begin();
    let capture = admission.capture(8, 8).unwrap();
    let result = capture.finish(output()).unwrap();
    assert_eq!(result.stdout(), b"data");
    assert!(
        admission.capture(0, 0).is_err(),
        "zero-byte results still consume metadata capacity"
    );
    retired(admission, hold);
    assert_eq!(host.state.lock().unwrap().used.endpoints, 0);
    assert_eq!(host.state.lock().unwrap().used.captured_bytes, 16);
    let (next, hold) = session.reserve_endpoint(declaration()).unwrap().begin();
    assert!(next.capture(0, 0).is_err());
    drop(result);
    let capture = next.capture(1, 0).unwrap();
    let mut oversized = output();
    oversized.stdout = Vec::with_capacity(8);
    oversized.stdout.push(b'x');
    assert!(capture.finish(oversized).is_err());
    assert_eq!(host.state.lock().unwrap().used.captured_results, 0);
    retired(next, hold);
    assert_eq!(host.state.lock().unwrap().used, Usage::default());
}

#[tokio::test]
async fn unpolled_future_and_external_port_hold_charge_after_join() {
    let (host, session) = owner();
    let (admission, hold) = session.reserve_endpoint(declaration()).unwrap().begin();
    let future_hold = hold.clone();
    let unpolled = async move { drop(future_hold) };
    let port = hold.clone();
    let worker = tokio::spawn(async move { drop(hold) });
    worker.await.unwrap();
    // Unit stand-in for the Core join latch, not an actual Native stop proof.
    admission.joined();
    drop(admission);
    drop(port);
    assert!(session.reserve_endpoint(declaration()).is_err());
    drop(unpolled);
    assert_eq!(host.state.lock().unwrap().used, Usage::default());
    assert!(session.reserve_endpoint(declaration()).is_ok());
}
