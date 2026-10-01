//! Adapters for legacy synchronous application callers. These tasks never run
//! SQLite themselves for an owned store: its closed typed commands still go
//! through the one bounded persistence executor.
use std::cell::Cell;

std::thread_local! {
    static BLOCKING_CALLER: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn is_blocking_caller() -> bool {
    BLOCKING_CALLER.with(Cell::get)
}

/// Move a synchronous application operation off the async runtime before it
/// awaits legacy typed persistence commands. A current-thread runtime's
/// `Handle` is also present on its blocking pool, so runtime flavor alone
/// cannot identify a safe synchronous caller.
///
/// This is a caller adapter, not a persistence command port. The closure has
/// no executor authority and cannot bypass an owned store's typed commands.
pub fn spawn_blocking_store_caller<F, R>(operation: F) -> tokio::task::JoinHandle<R>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    tokio::task::spawn_blocking(move || {
        struct Restore(bool);
        impl Drop for Restore {
            fn drop(&mut self) {
                BLOCKING_CALLER.with(|active| active.set(self.0));
            }
        }
        let restore = Restore(BLOCKING_CALLER.with(|active| active.replace(true)));
        let output = operation();
        drop(restore);
        output
    })
}
