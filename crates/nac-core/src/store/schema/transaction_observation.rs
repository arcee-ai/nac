//! Per-connection, observation-only timing of explicit SQLite transactions.
use std::cell::RefCell;
use std::ffi::{c_int, c_uint, c_void, CStr};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{Duration, Instant};

use rusqlite::{ffi, Connection};

use crate::telemetry::{self, Correlation, StoreOperation, TelemetryOutcome};

struct Started {
    at: Instant,
    correlation: Correlation,
}

#[derive(Default)]
struct State {
    // A statement begins before SQLite has changed its autocommit flag.
    beginning: Option<Started>,
    transaction: Option<Started>,
}

pub(super) struct TransactionObservation {
    state: RefCell<State>,
}

pub(super) fn install(connection: &Connection) -> Option<Box<TransactionObservation>> {
    if !telemetry::enabled() {
        return None;
    }
    let observation = Box::new(TransactionObservation {
        state: RefCell::new(State::default()),
    });
    let context = std::ptr::from_ref(observation.as_ref()).cast_mut().cast();
    // SAFETY: the owning StoreConnection drops Connection before this stable Box.
    // Connection is not Sync; SQLite invokes this callback synchronously. The
    // callback observes flags/SQL only and never executes SQL or changes results.
    let code = unsafe {
        ffi::sqlite3_trace_v2(
            connection.handle(),
            (ffi::SQLITE_TRACE_STMT | ffi::SQLITE_TRACE_PROFILE | ffi::SQLITE_TRACE_CLOSE)
                as c_uint,
            Some(trace),
            context,
        )
    };
    if code != ffi::SQLITE_OK {
        eprintln!("nac: SQLite transaction observation unavailable (code {code})");
    }
    // Retain the context even on registration failure; telemetry cannot change
    // application results, and a partially installed callback must stay safe.
    Some(observation)
}

unsafe extern "C" fn trace(
    event: c_uint,
    context: *mut c_void,
    object: *mut c_void,
    detail: *mut c_void,
) -> c_int {
    // No Rust panic may cross SQLite's C callback boundary.
    let _ = catch_unwind(AssertUnwindSafe(|| {
        // SAFETY: install gives SQLite a live Box context until Connection closes.
        let observation = unsafe { &*context.cast::<TransactionObservation>() };
        let mut state = observation.state.borrow_mut();
        if event == ffi::SQLITE_TRACE_CLOSE as c_uint {
            finish(&mut state, TelemetryOutcome::Error);
            return;
        }
        // SAFETY: STMT/PROFILE supply a live sqlite3_stmt. SQLite owns its SQL;
        // it is inspected only here, never expanded, retained or exported.
        let (autocommit, sql) = unsafe {
            let statement = object.cast::<ffi::sqlite3_stmt>();
            let database = ffi::sqlite3_db_handle(statement);
            let sql = ffi::sqlite3_sql(statement);
            let sql = if sql.is_null() {
                ""
            } else {
                std::str::from_utf8(CStr::from_ptr(sql).to_bytes()).unwrap_or_default()
            };
            (ffi::sqlite3_get_autocommit(database) != 0, sql)
        };
        let kind = keyword(sql);
        if event == ffi::SQLITE_TRACE_STMT as c_uint {
            if autocommit && matches!(kind, "BEGIN" | "SAVEPOINT") {
                state.beginning = Some(Started {
                    at: Instant::now(),
                    correlation: telemetry::current_store_correlation(),
                });
            }
            return;
        }
        // SAFETY: PROFILE supplies a pointer to the statement's u64 nanoseconds.
        let duration = Duration::from_nanos(unsafe { *detail.cast::<u64>() });
        if let Some(beginning) = state.beginning.take() {
            if !autocommit && state.transaction.is_none() {
                telemetry::emit_store_duration(
                    StoreOperation::TransactionBegin,
                    beginning.correlation.clone(),
                    duration,
                    TelemetryOutcome::Ok,
                    None,
                );
                state.transaction = Some(beginning);
            }
        }
        let was_transaction = state.transaction.is_some();
        if was_transaction && autocommit {
            let outcome = if matches!(kind, "COMMIT" | "END" | "RELEASE") {
                TelemetryOutcome::Ok
            } else {
                TelemetryOutcome::Error
            };
            finish(&mut state, outcome);
        }
        if matches!(kind, "COMMIT" | "END") {
            telemetry::emit_store_duration(
                StoreOperation::Commit,
                telemetry::current_store_correlation(),
                duration,
                if was_transaction && autocommit {
                    TelemetryOutcome::Ok
                } else {
                    TelemetryOutcome::Error
                },
                None,
            );
        } else if kind == "PRAGMA" {
            telemetry::sqlite_profile(sql, duration);
        }
    }));
    0
}

fn finish(state: &mut State, outcome: TelemetryOutcome) {
    if let Some(started) = state.transaction.take() {
        telemetry::emit_store_duration(
            StoreOperation::Transaction,
            started.correlation,
            started.at.elapsed(),
            outcome,
            None,
        );
    }
    state.beginning = None;
}

// Only fixed transaction-control vocabulary survives this function. Leading
// comments are skipped; SQL text and parameters are never telemetry fields.
fn keyword(mut sql: &str) -> &str {
    loop {
        sql = sql.trim_start();
        if let Some(comment) = sql.strip_prefix("--") {
            sql = comment.split_once('\n').map_or("", |(_, tail)| tail);
        } else if let Some(comment) = sql.strip_prefix("/*") {
            sql = comment.split_once("*/").map_or("", |(_, tail)| tail);
        } else {
            break;
        }
    }
    let word = sql
        .split(|c: char| !c.is_ascii_alphabetic())
        .next()
        .unwrap_or_default();
    [
        "BEGIN",
        "SAVEPOINT",
        "COMMIT",
        "END",
        "ROLLBACK",
        "RELEASE",
        "PRAGMA",
    ]
    .into_iter()
    .find(|candidate| word.eq_ignore_ascii_case(candidate))
    .unwrap_or_default()
}
