use super::*;
fn limits() -> ResourceLimits {
    ResourceLimits {
        live_jobs: NonZeroUsize::new(2).unwrap(),
        wire_records: NonZeroUsize::new(1).unwrap(),
        flow_window: NonZeroUsize::new(16 * 1024).unwrap(),
        owned_input_bytes: 11,
        capture_bytes: 17,
    }
}
#[test]
fn one_validated_plan_declares_exact_checked_native_payload_dimensions() {
    let plan = limits().validate().unwrap();
    let declaration = plan.declaration();
    assert_eq!(declaration.live_jobs().get(), 2);
    assert_eq!(declaration.wire_records().get(), 1);
    assert_eq!(declaration.flow_window().get(), 16 * 1024);
    assert_eq!(declaration.owned_input_bytes(), 11);
    assert_eq!(declaration.capture_bytes(), 17);
    // The conservative payload model includes both directions' wire records,
    // command assemblies, per-job flow/scratch and separately owned vectors.
    assert_eq!(
        declaration.accounted_payload_bytes().get(),
        2 * (3 * 16_384 + 5 * 16_384) + 2 * (2 * 286_736 + 262_144) + 2 * 4096 + 11 + 17
    );
}
#[test]
fn failed_admission_changes_no_other_job_reservations_and_drop_returns_exact_resources() {
    let pool = ResourcePool::unaccounted_for_test(limits()).unwrap();
    let first = pool.reserve(7, 9).unwrap();
    assert!(pool.reserve(5, 0).is_err());
    assert!(pool.reserve(0, 9).is_err());
    let second = pool.reserve(4, 8).unwrap();
    assert!(pool.reserve(0, 0).is_err());
    drop(first);
    let third = pool.reserve(7, 9).unwrap();
    drop(second);
    drop(third);
    let all = pool.reserve(11, 17).unwrap();
    assert!(pool.reserve(1, 0).is_err());
    drop(all);
    assert_eq!(pool.used.lock().unwrap().jobs, 0);
}
#[test]
fn simultaneous_admission_cannot_oversubscribe_shared_capture() {
    let pool = ResourcePool::unaccounted_for_test(limits()).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(3));
    let admitted = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let threads = (0..2)
        .map(|_| {
            let pool = Arc::clone(&pool);
            let barrier = Arc::clone(&barrier);
            let admitted = Arc::clone(&admitted);
            std::thread::spawn(move || {
                barrier.wait();
                let reservation = pool.reserve(0, 17);
                if reservation.is_ok() {
                    admitted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                barrier.wait();
                drop(reservation);
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    barrier.wait();
    for thread in threads {
        thread.join().unwrap();
    }
    assert_eq!(admitted.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(pool.reserve(0, 17).is_ok());
}
#[test]
fn explicit_large_capture_is_not_narrowed_to_a_borrowed_stream_or_retention_default() {
    let mut large = limits();
    large.capture_bytes = 2 * 1024 * 1024 * 1024;
    let pool = ResourcePool::unaccounted_for_test(large).unwrap();
    let _reservation = pool.reserve(0, 2 * 1024 * 1024 * 1024).unwrap();
    let mut overflow = limits();
    overflow.flow_window = NonZeroUsize::new(usize::MAX).unwrap();
    assert!(ResourcePool::unaccounted_for_test(overflow).is_err());
}
