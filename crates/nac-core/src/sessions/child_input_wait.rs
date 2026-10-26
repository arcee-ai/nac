use std::fs::{self, File};
use std::io;
use std::path::Path;

use fs2::FileExt;

use super::operation_lease::{secure_lock_path_with_suffix, secure_open_lock_file};
use super::SessionOperationLeaseError;

/// Exact queued-input waiting authority, released on caller drop or process death.
/// Its nonce is committed with the inbox item only after acquisition succeeds.
#[derive(Debug)]
pub(crate) struct ChildInputWaitLease {
    file: File,
    id: String,
}

impl ChildInputWaitLease {
    pub(crate) fn new(store_path: &Path) -> Result<Self, SessionOperationLeaseError> {
        Self::try_acquire(store_path, &uuid::Uuid::new_v4().to_string())
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn try_acquire(
        store_path: &Path,
        id: &str,
    ) -> Result<Self, SessionOperationLeaseError> {
        let acquire = || -> anyhow::Result<File> {
            uuid::Uuid::parse_str(id)?;
            let canonical_store = fs::canonicalize(store_path)?;
            let path = secure_lock_path_with_suffix(&canonical_store, id, ".child-wait")?;
            secure_open_lock_file(&path)
        };
        let file = acquire().map_err(SessionOperationLeaseError::Store)?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Self {
                file,
                id: id.to_owned(),
            }),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Err(
                SessionOperationLeaseError::Busy("child input waiter".to_owned()),
            ),
            Err(error) => Err(SessionOperationLeaseError::Store(error.into())),
        }
    }
}

impl Drop for ChildInputWaitLease {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
        // Do not unlink: a concurrent opener must keep observing the same inode.
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waiter_authority_is_nonce_and_canonical_store_bound() {
        let root = std::env::temp_dir().join(format!("nac-child-wait-{}", uuid::Uuid::new_v4()));
        let path = root.join("store.db");
        let other = root.join("other.db");
        crate::store::initialize(&path).unwrap();
        crate::store::initialize(&other).unwrap();
        let waiter = ChildInputWaitLease::new(&path).unwrap();
        let id = waiter.id().to_owned();
        assert!(matches!(
            ChildInputWaitLease::try_acquire(&path, &id),
            Err(SessionOperationLeaseError::Busy(_))
        ));
        assert!(ChildInputWaitLease::try_acquire(&other, &id).is_ok());
        assert!(ChildInputWaitLease::new(&path).is_ok());
        assert!(ChildInputWaitLease::try_acquire(&path, "not-a-uuid").is_err());
        #[cfg(unix)]
        {
            let alias = root.join("alias.db");
            std::os::unix::fs::symlink(&path, &alias).unwrap();
            assert!(matches!(
                ChildInputWaitLease::try_acquire(&alias, &id),
                Err(SessionOperationLeaseError::Busy(_))
            ));
        }
        drop(waiter);
        assert!(ChildInputWaitLease::try_acquire(&path, &id).is_ok());
        let _ = fs::remove_dir_all(root);
    }
}
