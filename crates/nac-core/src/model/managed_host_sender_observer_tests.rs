use super::*;
use crate::model::sender_observer_test_support::SyntheticSenderObserver;
use std::sync::{atomic::Ordering, mpsc, Arc, Mutex, Weak};

#[test]
fn sender_observer_positive_is_nonsecret_and_shared_for_one_lifetime() {
    let observer = Arc::new(SyntheticSenderObserver::new());
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        observer.binding.clone(),
        observer.clone(),
    )
    .unwrap();
    let captured = authority.clone();
    assert_eq!(authority, captured);
    assert_eq!(authority.binding(), &observer.binding);
    authority.check_available().unwrap();
    captured.check_available().unwrap();
    assert_eq!(observer.calls.load(Ordering::SeqCst), 2);
    assert!(!format!("{authority:?}").contains("private-observer"));
    let independent =
        ManagedHostExecutionAuthority::from_sender_observer(observer.binding.clone(), observer)
            .unwrap();
    assert_ne!(authority, independent);
}

#[test]
fn sender_observer_unconfigured_and_invalid_bindings_cannot_supply_authority() {
    let observer = Arc::new(SyntheticSenderObserver::new());
    let mut invalid = observer.binding.clone();
    invalid.owner_epoch = 0;
    assert!(
        ManagedHostExecutionAuthority::from_sender_observer(invalid, observer.clone()).is_err()
    );
    assert_eq!(observer.calls.load(Ordering::SeqCst), 0);
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        observer.binding.clone(),
        Arc::new(UnconfiguredManagedHostExecutionObserver),
    )
    .unwrap();
    assert!(authority.check_available().is_err());
    assert!(authority.clone().check_available().is_err());
}

#[test]
fn sender_observer_receives_and_checks_every_expected_binding_field() {
    let observer = Arc::new(SyntheticSenderObserver::new());
    let original = serde_json::to_value(&observer.binding).unwrap();
    for field in original.as_object().unwrap().keys() {
        let mut changed = original.clone();
        changed[field] = match field.as_str() {
            "owner_epoch" | "key_generation" => 8.into(),
            "bootstrap_id" | "managed_host_id" | "organization_id" | "local_key_id" => {
                "6e7c5612-48b2-464b-832b-326bc8aaf3de".into()
            }
            "inference_origin" => "https://api.dev.arcee.ai".into(),
            _ => "synthetic-other-binding".into(),
        };
        let binding = serde_json::from_value(changed).unwrap();
        let authority =
            ManagedHostExecutionAuthority::from_sender_observer(binding, observer.clone()).unwrap();
        assert!(authority.check_available().is_err(), "{field}");
    }
    assert_eq!(observer.calls.load(Ordering::SeqCst), 11);
}

#[test]
fn sender_observer_current_loss_is_sanitized_and_sticky_across_clones() {
    let observer = Arc::new(SyntheticSenderObserver::new());
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        observer.binding.clone(),
        observer.clone(),
    )
    .unwrap();
    let captured = authority.clone();
    authority.check_available().unwrap();
    observer.set_current(false);
    let error = captured.check_available().unwrap_err();
    assert!(!error.to_string().contains("canary"));
    // Reconstructing while the producer remains unavailable cannot revive it.
    let reconstructed = ManagedHostExecutionAuthority::from_sender_observer(
        observer.binding.clone(),
        observer.clone(),
    )
    .unwrap();
    assert!(reconstructed.check_available().is_err());
    observer.set_current(true);
    assert!(authority.check_available().is_err());
    assert!(captured.check_available().is_err());
    assert!(reconstructed.check_available().is_err());
}

#[test]
fn sender_observer_revision_change_cannot_be_reversed_for_captured_lifetime() {
    let observer = Arc::new(SyntheticSenderObserver::new());
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        observer.binding.clone(),
        observer.clone(),
    )
    .unwrap();
    authority.check_available().unwrap();
    observer.set_revision([8; 32]);
    assert!(authority.clone().check_available().is_err());
    observer.set_revision([7; 32]);
    assert!(authority.check_available().is_err());
}

#[test]
fn sender_observer_owner_drop_denies_captured_lifetime() {
    struct OwnedObservation(Weak<()>);
    impl ManagedHostExecutionObserver for OwnedObservation {
        fn observe(&self, _: &ManagedHostKeyBinding) -> Result<[u8; 32]> {
            self.0
                .upgrade()
                .ok_or_else(|| anyhow!("synthetic owner closed"))?;
            Ok([1; 32])
        }
    }
    let owner = Arc::new(());
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        SyntheticSenderObserver::new().binding,
        Arc::new(OwnedObservation(Arc::downgrade(&owner))),
    )
    .unwrap();
    authority.check_available().unwrap();
    drop(owner);
    assert!(authority.check_available().is_err());
    assert!(authority.clone().check_available().is_err());
}

#[test]
fn sender_observer_inflight_success_cannot_clear_concurrent_denial() {
    struct ConcurrentObservation {
        entered: mpsc::SyncSender<()>,
        release: Mutex<mpsc::Receiver<()>>,
        calls: std::sync::atomic::AtomicUsize,
    }
    impl ManagedHostExecutionObserver for ConcurrentObservation {
        fn observe(&self, _: &ManagedHostKeyBinding) -> Result<[u8; 32]> {
            match self.calls.fetch_add(1, Ordering::SeqCst) {
                0 => Ok([1; 32]),
                1 => {
                    self.entered.send(()).unwrap();
                    self.release
                        .lock()
                        .unwrap()
                        .recv_timeout(std::time::Duration::from_secs(5))
                        .unwrap();
                    Ok([1; 32])
                }
                _ => bail!("synthetic current authority lost"),
            }
        }
    }
    let (entered, seen) = mpsc::sync_channel(0);
    let (release, resume) = mpsc::sync_channel(0);
    let authority = ManagedHostExecutionAuthority::from_sender_observer(
        SyntheticSenderObserver::new().binding,
        Arc::new(ConcurrentObservation {
            entered,
            release: Mutex::new(resume),
            calls: Default::default(),
        }),
    )
    .unwrap();
    authority.check_available().unwrap();
    let captured = authority.clone();
    let inflight = std::thread::spawn(move || captured.check_available());
    seen.recv_timeout(std::time::Duration::from_secs(5))
        .unwrap();
    assert!(authority.check_available().is_err());
    release.send(()).unwrap();
    assert!(inflight.join().unwrap().is_err());
    assert!(authority.check_available().is_err());
}
