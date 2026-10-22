//! Mechanical caller/ownership controls, not authenticated runtime acceptance.
use crate::runtime::PreparationResourceCustody;
use crate::session_service::{ProtectedPreparationInput, ProtectedPreparationRefusal};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc,
};

#[derive(Default)]
struct Observed {
    denied: AtomicBool,
    unavailable: AtomicBool,
    physical_checks: AtomicUsize,
    bounded_checks: AtomicUsize,
    dropped: AtomicUsize,
}
struct Original {
    observed: Arc<Observed>,
    deny_during_check: Option<Arc<Observed>>,
}
impl Drop for Original {
    fn drop(&mut self) {
        self.observed.dropped.fetch_add(1, Ordering::SeqCst);
    }
}
impl PreparationResourceCustody for Original {
    fn check_outside_store(&self) -> anyhow::Result<()> {
        self.observed.physical_checks.fetch_add(1, Ordering::SeqCst);
        if let Some(other) = &self.deny_during_check {
            other.unavailable.store(true, Ordering::SeqCst);
        }
        anyhow::ensure!(
            !self.observed.unavailable.load(Ordering::SeqCst),
            "original resource outcome unavailable"
        );
        Ok(())
    }
    fn check_denial(&self) -> anyhow::Result<()> {
        self.observed.bounded_checks.fetch_add(1, Ordering::SeqCst);
        anyhow::ensure!(
            !self.observed.denied.load(Ordering::SeqCst)
                && !self.observed.unavailable.load(Ordering::SeqCst),
            "original resource denied"
        );
        Ok(())
    }
    fn deny(&self) {
        self.observed.denied.store(true, Ordering::SeqCst);
    }
}
fn boxed(observed: &Arc<Observed>) -> Box<dyn PreparationResourceCustody> {
    Box::new(Original {
        observed: Arc::clone(observed),
        deny_during_check: None,
    })
}
fn held(observed: &Observed) {
    assert_eq!(observed.dropped.load(Ordering::SeqCst), 0);
    assert!(observed.denied.load(Ordering::SeqCst));
}

#[test]
fn production_caller_refuses_missing_participant_before_runtime_and_keeps_originals() {
    let location = Arc::new(Observed::default());
    let execution = Arc::new(Observed::default());
    let mut input = ProtectedPreparationInput::new(boxed(&location), boxed(&execution));
    assert_eq!(
        input.try_prepare_create().err(),
        Some(ProtectedPreparationRefusal::ParticipantProtocolUnavailable)
    );
    held(&location);
    held(&execution);
    for observed in [&location, &execution] {
        assert_eq!(observed.physical_checks.load(Ordering::SeqCst), 1);
        assert_eq!(observed.bounded_checks.load(Ordering::SeqCst), 1);
    }
    // This unit admitted no work; explicit test-owned input retirement follows.
    drop(input);
    assert_eq!(location.dropped.load(Ordering::SeqCst), 1);
    assert_eq!(execution.dropped.load(Ordering::SeqCst), 1);
}

#[test]
fn original_currentness_failure_denies_both_and_cannot_be_retried_after_restore() {
    let location = Arc::new(Observed::default());
    let execution = Arc::new(Observed::default());
    location.unavailable.store(true, Ordering::SeqCst);
    let mut input = ProtectedPreparationInput::new(boxed(&location), boxed(&execution));
    assert_eq!(
        input.try_prepare_create().err(),
        Some(ProtectedPreparationRefusal::ResourceDenied)
    );
    held(&location);
    held(&execution);
    location.unavailable.store(false, Ordering::SeqCst);
    assert_eq!(
        input.try_prepare_create().err(),
        Some(ProtectedPreparationRefusal::ResourceDenied)
    );
    assert_eq!(location.physical_checks.load(Ordering::SeqCst), 1);
    assert_eq!(execution.physical_checks.load(Ordering::SeqCst), 0);
}

#[test]
fn original_owner_denied_during_other_physical_check_is_observed_before_admission() {
    let location = Arc::new(Observed::default());
    let execution = Arc::new(Observed::default());
    let execution_owner = Box::new(Original {
        observed: Arc::clone(&execution),
        deny_during_check: Some(Arc::clone(&location)),
    });
    let mut input = ProtectedPreparationInput::new(boxed(&location), execution_owner);
    assert_eq!(
        input.try_prepare_create().err(),
        Some(ProtectedPreparationRefusal::ResourceDenied)
    );
    assert_eq!(execution.physical_checks.load(Ordering::SeqCst), 1);
    assert_eq!(location.bounded_checks.load(Ordering::SeqCst), 1);
    held(&location);
    held(&execution);
}

#[test]
fn dropping_unknown_observation_refusal_retains_originals_in_terminal_owner() {
    let location = Arc::new(Observed::default());
    let execution = Arc::new(Observed::default());
    execution.unavailable.store(true, Ordering::SeqCst);
    let mut terminal_owned_input =
        ProtectedPreparationInput::new(boxed(&location), boxed(&execution));
    let refusal = terminal_owned_input.try_prepare_create();
    assert!(matches!(
        refusal,
        Err(ProtectedPreparationRefusal::ResourceDenied)
    ));
    drop(refusal);
    // Refusal conveys no terminal/release proof; the original owner still holds
    // both exact allocations while resolving its unknown resource observation.
    held(&location);
    held(&execution);
    assert_eq!(
        terminal_owned_input.try_prepare_create().err(),
        Some(ProtectedPreparationRefusal::ResourceDenied)
    );
    held(&location);
    held(&execution);
}
