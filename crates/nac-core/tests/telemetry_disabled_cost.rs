//! Disabled telemetry is the default and must cost nothing on hot paths:
//! emitters return before they clone a correlation, format a label, sample
//! process resources or build an observation. This binary owns a counting
//! global allocator, so it lives apart from the library's unit tests.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::time::Duration;

use nac_core::telemetry::{
    self, ChildProcessGuard, Correlation, RuntimeActivity, RuntimeActivityGuard, StoreOperation,
    TelemetryOutcome,
};

thread_local! {
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

fn count_allocation() {
    let _ = ALLOCATIONS.try_with(|count| count.set(count.get() + 1));
}

struct CountingAllocator;

// SAFETY: every method forwards unchanged to the system allocator. Counting
// touches only a const-initialized thread-local `Cell`, which never allocates.
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: the caller upholds `GlobalAlloc::alloc`'s layout contract.
        unsafe { System.alloc(layout) }
    }

    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        count_allocation();
        // SAFETY: the caller upholds `GlobalAlloc::alloc_zeroed`'s contract.
        unsafe { System.alloc_zeroed(layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        count_allocation();
        // SAFETY: `ptr` and `layout` came from this allocator, i.e. `System`.
        unsafe { System.realloc(ptr, layout, new_size) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: `ptr` and `layout` came from this allocator, i.e. `System`.
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Allocations made by the current thread while `action` runs.
fn allocations_during(action: impl FnOnce()) -> usize {
    let before = ALLOCATIONS.with(Cell::get);
    action();
    ALLOCATIONS.with(Cell::get) - before
}

const EMITTER_CORRELATIONS: u64 = 7;

fn correlations() -> Vec<Correlation> {
    (0..EMITTER_CORRELATIONS)
        .map(|index| {
            Correlation::session(Some(&format!("session-{index}")))
                .with_run(Some(&format!("run-{index}")))
                .with_generation(index)
        })
        .collect()
}

/// One pass over every public emitter. Each receives its own fully populated
/// correlation, built by the caller beforehand, so any internal clone, label
/// or observation would allocate.
fn emit_everything(mut correlations: Vec<Correlation>) {
    let mut next = || correlations.pop().expect("one correlation per emitter");
    telemetry::emit_store_duration(
        StoreOperation::QueueWait,
        next(),
        Duration::from_micros(3),
        TelemetryOutcome::Ok,
        None,
    );
    telemetry::emit_http_duration(
        "/sessions/{session_id}",
        next(),
        Duration::from_millis(1),
        TelemetryOutcome::Ok,
    );
    telemetry::emit_connection_counts(1, 2, next());
    telemetry::emit_resource_sample(next(), None);
    telemetry::sqlite_profile("COMMIT", Duration::from_micros(5));
    telemetry::observe_store(StoreOperation::EventPersistence, next(), || {
        Ok::<_, anyhow::Error>(())
    })
    .unwrap();
    drop(RuntimeActivityGuard::start(RuntimeActivity::Worker, next()));
    drop(ChildProcessGuard::start(Some(std::process::id()), next()));
}

#[test]
fn disabled_emission_allocates_nothing() {
    assert!(
        !telemetry::enabled(),
        "telemetry stays disabled unless configured"
    );
    // Settle one-time process state (lazy statics, thread-locals) first.
    emit_everything(correlations());
    let correlations = correlations();

    let allocations = allocations_during(|| emit_everything(correlations));

    assert_eq!(
        allocations, 0,
        "disabled telemetry allocated on the emission path"
    );
}

#[test]
fn correlation_digest_allocates_only_its_label_and_keeps_its_value() {
    let mut correlation = None;
    let allocations = allocations_during(|| {
        correlation = Some(Correlation::session(Some("session-a")));
    });

    assert_eq!(
        correlation.unwrap().session.as_deref(),
        Some("fa57a52dbf081902"),
        "the label is the first 64 bits of SHA-256 in lowercase hex"
    );
    assert_eq!(allocations, 1, "only the 16-character label is allocated");
    assert_eq!(
        Correlation::session(None)
            .with_run(Some("run-a"))
            .run
            .as_deref(),
        Some("66b1eb530fb748a4")
    );
}
