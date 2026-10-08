//! Read-only committed state for managed probes, independent of write admission.
use std::path::Path;

use anyhow::Result;

use super::{open_probe_read_connection, ManagedMaintenanceState};

/// Observe readiness without admitting work, initializing a store, or waiting
/// for its durable command executor. The ordinary connection checkout limits
/// still apply; SQLite WAL readers observe committed state during a write.
pub fn observe_managed_probe_store(path: &Path) -> Result<ManagedMaintenanceState> {
    observe(path, None)
}

/// Observe committed probe state while preserving the accepted replacement's
/// release/incarnation fence. This check grants no work or completion lease.
pub fn observe_managed_probe_store_for_identity(
    path: &Path,
    running: &super::ManagedAcceptedIdentity,
) -> Result<ManagedMaintenanceState> {
    observe(path, Some(running))
}

fn observe(
    path: &Path,
    running: Option<&super::ManagedAcceptedIdentity>,
) -> Result<ManagedMaintenanceState> {
    let mut conn = open_probe_read_connection(path)?;
    let transaction = conn.transaction()?;
    let _: i64 =
        transaction.query_row("SELECT EXISTS(SELECT 1 FROM sessions LIMIT 1)", [], |row| {
            row.get(0)
        })?;
    let snapshot = super::managed_maintenance::snapshot_with_connection(&transaction, Vec::new())?;
    if let Some(running) = running {
        super::managed_maintenance::validate_accepted_identity(&snapshot, running)?;
    }
    transaction.commit()?;
    Ok(snapshot.state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path() -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nac_probe_{nonce}"))
            .join("store.db")
    }

    #[tokio::test(flavor = "current_thread")]
    async fn probe_can_read_owned_store_without_write_or_executor_authority() {
        let path = path();
        crate::store::initialize(&path).unwrap();
        let owner = crate::store::StoreCoordinator::acquire(&path).unwrap();
        assert!(crate::store::open_runtime_connection(&path).is_err());
        let conn = open_probe_read_connection(&path).unwrap();
        assert!(conn
            .execute(
                "UPDATE managed_host_maintenance SET state = 'maintenance'",
                []
            )
            .is_err());
        drop(conn);
        assert_eq!(
            observe_managed_probe_store(&path).unwrap(),
            ManagedMaintenanceState::Serving
        );
        assert_eq!(
            crate::store::observe_probe_migration_status(&path).state,
            crate::store::StoreMigrationState::Current
        );
        assert!(crate::store::open_runtime_connection(&path).is_err());
        owner.shutdown().await.unwrap();
        drop(owner);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn probe_does_not_create_or_migrate_and_rejects_invalid_maintenance() {
        let path = path();
        assert!(observe_managed_probe_store(&path).is_err());
        assert!(!path.parent().unwrap().exists());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE sentinel(value); PRAGMA user_version=1")
            .unwrap();
        drop(conn);
        let bytes = std::fs::read(&path).unwrap();
        assert!(observe_managed_probe_store(&path).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        crate::store::initialize(&path).unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("DROP TABLE managed_host_maintenance")
            .unwrap();
        drop(conn);
        assert!(observe_managed_probe_store(&path).is_err());
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }

    #[test]
    fn probe_preserves_future_schema_without_pager_side_effects() {
        let path = path();
        crate::store::initialize(&path).unwrap();
        let conn = rusqlite::Connection::open(&path).unwrap();
        let future = crate::store::schema_version() + 1;
        conn.pragma_update(None, "user_version", future).unwrap();
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)")
            .unwrap();
        drop(conn);
        let bytes = std::fs::read(&path).unwrap();
        let entries = || {
            std::fs::read_dir(path.parent().unwrap())
                .unwrap()
                .map(|e| e.unwrap().file_name())
                .collect::<std::collections::BTreeSet<_>>()
        };
        let before = entries();
        assert!(observe_managed_probe_store(&path).is_err());
        let status = crate::store::observe_probe_migration_status(&path);
        assert_eq!(status.opened_schema_version, Some(future));
        assert_eq!(
            status.failure,
            Some(crate::store::StoreMigrationFailure::FutureSchema)
        );
        assert_eq!(entries(), before);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
