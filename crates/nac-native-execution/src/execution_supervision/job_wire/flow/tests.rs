use super::*;

fn window() -> NonZeroU64 {
    NonZeroU64::new(MAX_DATA as u64).unwrap()
}

#[test]
fn flow_window_recycles_without_becoming_a_capture_or_total_stream_limit() {
    let mut sender = CreditSender::new(window());
    let mut receiver = CreditReceiver::new(window());
    assert_eq!(sender.try_take(MAX_DATA).unwrap(), None);
    sender.grant(receiver.open().unwrap()).unwrap();
    for round in 0..64 {
        let block = sender.try_take(MAX_DATA).unwrap().unwrap();
        assert_eq!(block, (round * MAX_DATA) as u64);
        assert_eq!(sender.available().unwrap(), 0);
        receiver.accept(block, MAX_DATA).unwrap();
        assert_eq!(sender.try_take(1).unwrap(), None);
        assert_eq!(receiver.consumed(0).unwrap(), None);
        let half = (MAX_DATA / 2) as u64;
        sender
            .grant(receiver.consumed(half).unwrap().unwrap())
            .unwrap();
        assert_eq!(sender.available().unwrap(), half);
        assert_eq!(sender.try_take(MAX_DATA).unwrap(), None);
        sender
            .grant(receiver.consumed(half).unwrap().unwrap())
            .unwrap();
        assert_eq!(sender.available().unwrap(), MAX_DATA as u64);
    }
    assert_eq!(receiver.received, 1024 * 1024);
    assert_eq!(receiver.consumed, receiver.received);
}

#[test]
fn duplicate_rewound_excessive_or_incorrect_initial_credit_is_sticky() {
    for invalid in [0, 1, MAX_DATA as u64 + 1, u64::MAX] {
        let mut sender = CreditSender::new(window());
        assert!(sender.grant(invalid).is_err());
        assert!(sender.grant(MAX_DATA as u64).is_err());
        assert!(sender.available().is_err());
        assert!(sender.try_take(1).is_err());
    }
    for invalid in [0, MAX_DATA as u64 - 1, MAX_DATA as u64, MAX_DATA as u64 + 1] {
        let mut sender = CreditSender::new(window());
        sender.grant(MAX_DATA as u64).unwrap();
        assert!(sender.grant(invalid).is_err());
        assert!(sender.try_take(1).is_err());
    }
}

#[test]
fn receiver_requires_open_contiguous_bounded_blocks_and_actual_consumption() {
    let mut receiver = CreditReceiver::new(window());
    assert!(receiver.accept(0, 1).is_err());
    assert!(receiver.open().is_err());
    let mut receiver = CreditReceiver::new(window());
    receiver.open().unwrap();
    assert!(receiver.open().is_err());
    for (block, bytes) in [(1, 1), (0, 0), (0, MAX_DATA + 1), (u64::MAX, 1)] {
        let mut receiver = CreditReceiver::new(window());
        receiver.open().unwrap();
        assert!(receiver.accept(block, bytes).is_err());
        assert!(receiver.accept(0, 1).is_err());
        assert!(receiver.consumed(0).is_err());
    }
    let mut receiver = CreditReceiver::new(window());
    receiver.open().unwrap();
    receiver.accept(0, MAX_DATA).unwrap();
    assert!(receiver.accept(MAX_DATA as u64, 1).is_err());
    let mut receiver = CreditReceiver::new(window());
    receiver.open().unwrap();
    receiver.accept(0, 1).unwrap();
    assert!(receiver.consumed(2).is_err());
    assert!(receiver.consumed(1).is_err());
}

#[test]
fn counter_overflow_and_invalid_reservations_cannot_wrap_or_restore_credit() {
    let mut sender = CreditSender::new(window());
    sender.sent = u64::MAX;
    sender.granted = u64::MAX;
    assert!(sender.try_take(1).is_err());
    assert!(sender.available().is_err());
    let mut sender = CreditSender::new(window());
    sender.sent = u64::MAX;
    assert!(sender.grant(u64::MAX).is_err());
    for bytes in [0, MAX_DATA + 1] {
        let mut sender = CreditSender::new(window());
        sender.grant(MAX_DATA as u64).unwrap();
        assert!(sender.try_take(bytes).is_err());
        assert!(sender.try_take(1).is_err());
    }
    let mut receiver = CreditReceiver::new(window());
    receiver.open().unwrap();
    receiver.received = u64::MAX;
    receiver.advertised = u64::MAX;
    assert!(receiver.accept(u64::MAX, 1).is_err());
    let mut receiver = CreditReceiver::new(window());
    receiver.open().unwrap();
    receiver.received = u64::MAX;
    receiver.consumed = u64::MAX;
    assert!(receiver.consumed(1).is_err());
    let mut receiver = CreditReceiver::new(window());
    receiver.open().unwrap();
    receiver.received = u64::MAX;
    assert!(receiver.consumed(u64::MAX).is_err());
}
