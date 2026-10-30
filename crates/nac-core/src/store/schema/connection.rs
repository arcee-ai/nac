//! SQLite connection checkout: per-process and per-store descriptor limits,
//! the executor authority check, and the owned connection handle.
use std::collections::HashMap;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use rusqlite::Connection;

use super::{resolved_store_path, transaction_observation};

#[cfg(test)]
#[path = "connection_capacity_tests.rs"]
mod connection_capacity_tests;

/// Hard SQLite checkout limits for one NAC process.
///
/// Connections are operation-scoped, but concurrent opens still need a
/// descriptor bound: at most 32 connections may be opening or checked out in
/// one process, and at most four of those may target the same canonical store.
/// Cached sessions and writers do not own capacity while idle.
const PROCESS_CONNECTION_LIMIT: usize = 32;
const STORE_CONNECTION_LIMIT: usize = 4;
const CONNECTION_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Default)]
struct ConnectionCapacityState {
    total: usize,
    by_store: HashMap<PathBuf, usize>,
}

struct ConnectionCapacity {
    process_limit: usize,
    store_limit: usize,
    state: Mutex<ConnectionCapacityState>,
    available: Condvar,
}

impl ConnectionCapacity {
    fn new(process_limit: usize, store_limit: usize) -> Arc<Self> {
        assert!(
            process_limit > 0,
            "SQLite process connection limit must be positive"
        );
        assert!(
            store_limit > 0,
            "SQLite store connection limit must be positive"
        );
        Arc::new(Self {
            process_limit,
            store_limit,
            state: Mutex::new(ConnectionCapacityState::default()),
            available: Condvar::new(),
        })
    }

    fn acquire(self: &Arc<Self>, store_path: &Path, timeout: Duration) -> Result<ConnectionPermit> {
        let deadline = Instant::now() + timeout;
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        loop {
            let store_count = state.by_store.get(store_path).copied().unwrap_or(0);
            if state.total < self.process_limit && store_count < self.store_limit {
                state.total += 1;
                *state.by_store.entry(store_path.to_path_buf()).or_default() += 1;
                return Ok(ConnectionPermit {
                    capacity: Arc::clone(self),
                    store_path: store_path.to_path_buf(),
                });
            }

            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(anyhow!("timed out waiting for SQLite connection capacity"));
            }
            let (next, wait) = self
                .available
                .wait_timeout(state, remaining)
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            state = next;
            if wait.timed_out() {
                let store_count = state.by_store.get(store_path).copied().unwrap_or(0);
                if state.total >= self.process_limit || store_count >= self.store_limit {
                    return Err(anyhow!("timed out waiting for SQLite connection capacity"));
                }
            }
        }
    }

    fn counts(&self, store_path: &Path) -> (usize, usize) {
        let state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        (
            state.total,
            state.by_store.get(store_path).copied().unwrap_or(0),
        )
    }
}

struct ConnectionPermit {
    capacity: Arc<ConnectionCapacity>,
    store_path: PathBuf,
}

impl Drop for ConnectionPermit {
    #[expect(
        clippy::expect_used,
        reason = "permit construction and drop maintain exact per-store and total connection counts"
    )]
    fn drop(&mut self) {
        let mut state = self
            .capacity
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        state.total = state
            .total
            .checked_sub(1)
            .expect("SQLite process connection count underflow");
        let remove_store = {
            let store_count = state
                .by_store
                .get_mut(&self.store_path)
                .expect("SQLite store connection count missing");
            *store_count = store_count
                .checked_sub(1)
                .expect("SQLite store connection count underflow");
            *store_count == 0
        };
        if remove_store {
            state.by_store.remove(&self.store_path);
        }
        let process_count = state.total;
        let store_count = state.by_store.get(&self.store_path).copied().unwrap_or(0);
        drop(state);
        crate::telemetry::emit_connection_counts(
            process_count,
            store_count,
            crate::telemetry::Correlation::default(),
        );
        self.capacity.available.notify_all();
    }
}

static CONNECTION_CAPACITY: std::sync::LazyLock<Arc<ConnectionCapacity>> =
    std::sync::LazyLock::new(|| {
        ConnectionCapacity::new(PROCESS_CONNECTION_LIMIT, STORE_CONNECTION_LIMIT)
    });

pub(crate) struct StoreConnection {
    connection: Option<Connection>,
    _permit: ConnectionPermit,
    _transaction_observation: Option<Box<transaction_observation::TransactionObservation>>,
}

impl Drop for StoreConnection {
    fn drop(&mut self) {
        if let Some(connection) = self.connection.take() {
            if let Some(observation) = &self._transaction_observation {
                observation.detach(&connection);
            }
            drop(connection);
            if let Some(observation) = &mut self._transaction_observation {
                observation.finish_abandoned();
            }
        }
    }
}

impl Deref for StoreConnection {
    type Target = Connection;

    #[expect(
        clippy::expect_used,
        reason = "construction installs a connection; only exclusive Drop takes it"
    )]
    fn deref(&self) -> &Self::Target {
        self.connection
            .as_ref()
            .expect("store connection is live until drop")
    }
}

impl StoreConnection {
    // Keep the native connection's identity fixed: mutable Deref would permit
    // replacing it while its raw callbacks still reference this owner's Box.
    #[expect(
        clippy::expect_used,
        reason = "construction installs a connection; only exclusive Drop takes it"
    )]
    fn connection_mut(&mut self) -> &mut Connection {
        self.connection
            .as_mut()
            .expect("store connection is live until drop")
    }

    pub(crate) fn transaction(&mut self) -> rusqlite::Result<rusqlite::Transaction<'_>> {
        self.connection_mut().transaction()
    }

    pub(crate) fn transaction_with_behavior(
        &mut self,
        behavior: rusqlite::TransactionBehavior,
    ) -> rusqlite::Result<rusqlite::Transaction<'_>> {
        self.connection_mut().transaction_with_behavior(behavior)
    }
}

#[cfg(test)]
static TRACKED_CONNECTION_OPENS: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<PathBuf, usize>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

fn connect_with_capacity_using(
    path: &Path,
    capacity: &Arc<ConnectionCapacity>,
    timeout: Duration,
    open: impl FnOnce(&Path) -> rusqlite::Result<Connection>,
) -> Result<StoreConnection> {
    let path = resolved_store_path(path)?;
    crate::store::coordinator::require_execution_owner(&path)?;
    connect_after_authority_check(&path, capacity, timeout, open)
}

fn connect_after_authority_check(
    path: &Path,
    capacity: &Arc<ConnectionCapacity>,
    timeout: Duration,
    open: impl FnOnce(&Path) -> rusqlite::Result<Connection>,
) -> Result<StoreConnection> {
    crate::telemetry::observe_store(
        crate::telemetry::StoreOperation::ConnectionAcquire,
        crate::telemetry::Correlation::default(),
        || {
            let path = path.to_path_buf();
            let permit = capacity.acquire(&path, timeout)?;
            let connection = open(&path)
                .with_context(|| format!("failed to open SQLite store {}", path.display()))?;
            let transaction_observation = transaction_observation::install(&connection);
            let conn = StoreConnection {
                connection: Some(connection),
                _permit: permit,
                _transaction_observation: transaction_observation,
            };
            #[cfg(test)]
            {
                let mut tracked = TRACKED_CONNECTION_OPENS
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                if let Some(count) = tracked.get_mut(&path) {
                    *count += 1;
                }
            }
            conn.busy_timeout(Duration::from_secs(5))?;
            let (process_count, store_count) = capacity.counts(&path);
            crate::telemetry::emit_connection_counts(
                process_count,
                store_count,
                crate::telemetry::Correlation::default(),
            );
            Ok(conn)
        },
    )
}

fn connect_with_capacity(
    path: &Path,
    capacity: &Arc<ConnectionCapacity>,
    timeout: Duration,
) -> Result<StoreConnection> {
    connect_with_capacity_using(path, capacity, timeout, |path| Connection::open(path))
}

pub(super) fn connect(path: &Path) -> Result<StoreConnection> {
    connect_with_capacity(path, &CONNECTION_CAPACITY, CONNECTION_WAIT_TIMEOUT)
}

pub(super) fn connect_existing(path: &Path) -> Result<StoreConnection> {
    connect_with_capacity_using(
        path,
        &CONNECTION_CAPACITY,
        CONNECTION_WAIT_TIMEOUT,
        |path| {
            Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
        },
    )
}

pub(super) fn connect_read_only(path: &Path) -> Result<StoreConnection> {
    let path = std::fs::canonicalize(path).with_context(|| {
        format!(
            "failed to resolve initialized SQLite store {}",
            path.display()
        )
    })?;
    connect_with_capacity_using(
        &path,
        &CONNECTION_CAPACITY,
        CONNECTION_WAIT_TIMEOUT,
        |path| {
            Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
        },
    )
}

// This narrow observer cannot obtain executor authority or a writable
// connection. Ordinary opens above continue to require the execution owner.
pub(super) fn connect_probe_read_only(path: &Path) -> Result<StoreConnection> {
    let path = std::fs::canonicalize(path)?;
    connect_after_authority_check(
        &path,
        &CONNECTION_CAPACITY,
        CONNECTION_WAIT_TIMEOUT,
        |path| {
            Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY
                    | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
        },
    )
}

#[cfg(test)]
pub(crate) fn track_connection_opens(path: &Path) {
    let path = resolved_store_path(path).unwrap();
    TRACKED_CONNECTION_OPENS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(path, 0);
}

#[cfg(test)]
pub(crate) fn tracked_connection_opens(path: &Path) -> usize {
    let path = resolved_store_path(path).unwrap();
    TRACKED_CONNECTION_OPENS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&path)
        .unwrap_or(0)
}

#[cfg(test)]
pub(crate) fn active_connection_counts(path: &Path) -> Result<(usize, usize)> {
    let path = resolved_store_path(path)?;
    Ok(CONNECTION_CAPACITY.counts(&path))
}
