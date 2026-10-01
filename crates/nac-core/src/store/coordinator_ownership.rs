//! Canonical in-process owner lookup and executor authority. The OS lease
//! remains authoritative across processes; weak registrations never extend it.
use super::PersistenceAdmissionError;
use super::StoreCoordinator;
use anyhow::Result;
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex, Weak};

struct OwnerRegistration {
    owner: Weak<StoreCoordinator>,
    executor: Weak<()>,
}
static OWNERS: LazyLock<Mutex<HashMap<PathBuf, OwnerRegistration>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
std::thread_local! {
    static EXECUTION_STORE: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// Lookup is only a compatibility bridge for existing path-based core APIs.
/// Serving application services can await the explicit typed owner methods.
/// The executor itself calls the unchanged transaction without re-enqueueing.
pub(crate) fn owner_for(path: &Path) -> Result<Option<Arc<StoreCoordinator>>> {
    if OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .is_empty()
    {
        return Ok(None);
    }
    let path = match std::fs::canonicalize(path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let Some(name) = path.file_name() else {
                return Ok(None);
            };
            let parent = path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."));
            match std::fs::canonicalize(parent) {
                Ok(parent) => parent.join(name),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(error.into()),
            }
        }
        Err(error) => return Err(error.into()),
    };
    if EXECUTION_STORE.with(|active| active.borrow().as_ref() == Some(&path)) {
        return Ok(None);
    }
    let owners = OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    match owners.get(&path) {
        Some(registration) => match registration.owner.upgrade() {
            Some(owner) => Ok(Some(owner)),
            None if registration.executor.strong_count() > 0 => {
                Err(PersistenceAdmissionError::ShuttingDown.into())
            }
            None => Ok(None),
        },
        None => Ok(None),
    }
}

pub(crate) fn require_execution_owner(path: &Path) -> Result<()> {
    anyhow::ensure!(
        owner_for(path)?.is_none(),
        "managed store connection bypassed its persistence owner; submit a typed command"
    );
    Ok(())
}

pub(crate) fn is_execution_store(path: &Path) -> bool {
    EXECUTION_STORE.with(|active| active.borrow().as_deref() == Some(path))
}

pub(super) fn register_owner(owner: &Arc<StoreCoordinator>) {
    let mut owners = OWNERS
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    owners.retain(|_, registration| {
        registration.owner.strong_count() > 0 || registration.executor.strong_count() > 0
    });
    owners.insert(
        owner.path.clone(),
        OwnerRegistration {
            owner: Arc::downgrade(owner),
            executor: Weak::clone(&owner.executor_lifetime),
        },
    );
}

pub(super) struct ExecutionStore(Option<PathBuf>);
impl ExecutionStore {
    pub(super) fn enter(path: PathBuf) -> Self {
        Self(EXECUTION_STORE.with(|active| active.replace(Some(path))))
    }
}
impl Drop for ExecutionStore {
    fn drop(&mut self) {
        EXECUTION_STORE.with(|active| {
            active.replace(self.0.take());
        });
    }
}
