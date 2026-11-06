//! The persistence executor reuses one connection to its own store between
//! commands. Reuse must never leak transaction or per-connection state, serve
//! a replaced store file, or outlive the executor's ownership.
use super::*;
use crate::store::coordinator::{PersistenceCommand, StoreCoordinator};
use crate::store::schema::{
    open_connection, open_initialized_read_connection, open_runtime_connection,
    STORE_SCHEMA_VERSION,
};
use crate::telemetry::Correlation;

struct OnExecutor<F>(F);

impl<F, T> PersistenceCommand for OnExecutor<F>
where
    F: FnOnce(&Path) -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    type Output = T;
    fn correlation(&self) -> Correlation {
        Correlation::default()
    }
    fn execute(self, store: &Path) -> Result<T> {
        (self.0)(store)
    }
}

async fn on_executor<T: Send + 'static>(
    owner: &StoreCoordinator,
    command: impl FnOnce(&Path) -> Result<T> + Send + 'static,
) -> Result<T> {
    owner.submit(OnExecutor(command))?.acknowledge().await
}

async fn owned_store(label: &str) -> (PathBuf, Arc<StoreCoordinator>) {
    let path = std::env::temp_dir()
        .join(format!(
            "nac_connection_reuse_{label}_{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let owner = StoreCoordinator::acquire(&path).unwrap();
    owner.initialize().await.unwrap();
    (owner.store_path().to_path_buf(), owner)
}

fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut sidecar = path.as_os_str().to_os_string();
    sidecar.push(suffix);
    PathBuf::from(sidecar)
}

async fn finish(path: &Path, owner: Arc<StoreCoordinator>) {
    owner.shutdown().await.unwrap();
    assert_eq!(active_connection_counts(path).unwrap().1, 0);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test(flavor = "multi_thread")]
async fn executor_commands_share_one_connection_until_shutdown() {
    let (path, owner) = owned_store("shared").await;
    track_connection_opens(&path);
    for value in 0..20 {
        on_executor(&owner, move |store| {
            let conn = open_runtime_connection(store)?;
            conn.execute("CREATE TABLE IF NOT EXISTS reuse_probe (value INTEGER)", [])?;
            conn.execute("INSERT INTO reuse_probe VALUES (?1)", [value])?;
            Ok(())
        })
        .await
        .unwrap();
    }
    let count: i64 = on_executor(&owner, |store| {
        let conn = open_initialized_read_connection(store)?;
        Ok(conn.query_row("SELECT COUNT(*) FROM reuse_probe", [], |row| row.get(0))?)
    })
    .await
    .unwrap();
    assert_eq!(count, 20);
    assert_eq!(tracked_connection_opens(&path), 1);
    assert_eq!(active_connection_counts(&path).unwrap().1, 1);

    owner.shutdown().await.unwrap();
    // Ownership ends with the reused connection closed; as the store's last
    // connection it checkpoints and removes the WAL.
    assert_eq!(active_connection_counts(&path).unwrap().1, 0);
    assert!(!sidecar(&path, "-wal").exists());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_connection_left_in_a_transaction_is_never_reused() {
    let (path, owner) = owned_store("open_transaction").await;
    track_connection_opens(&path);
    on_executor(&owner, |store| {
        let conn = open_runtime_connection(store)?;
        conn.execute_batch(
            "CREATE TABLE probe (value INTEGER); BEGIN; INSERT INTO probe VALUES (1);",
        )?;
        Ok(())
    })
    .await
    .unwrap();
    let (autocommit, rows) = on_executor(&owner, |store| {
        let conn = open_runtime_connection(store)?;
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM probe", [], |row| row.get(0))?;
        Ok((conn.is_autocommit(), rows))
    })
    .await
    .unwrap();
    assert!(autocommit);
    assert_eq!(rows, 0, "the abandoned transaction was rolled back");
    assert_eq!(tracked_connection_opens(&path), 2);
    finish(&path, owner).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn nested_opens_get_an_independent_connection() {
    let (path, owner) = owned_store("nested").await;
    on_executor(&owner, |store| {
        open_runtime_connection(store)?.execute_batch("CREATE TABLE probe (value INTEGER)")?;
        Ok(())
    })
    .await
    .unwrap();
    track_connection_opens(&path);
    let seen_inside = on_executor(&owner, |store| {
        let mut outer = open_runtime_connection(store)?;
        let transaction =
            outer.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        transaction.execute("INSERT INTO probe VALUES (1)", [])?;
        let inner = open_runtime_connection(store)?;
        let seen: i64 = inner.query_row("SELECT COUNT(*) FROM probe", [], |row| row.get(0))?;
        drop(inner);
        transaction.commit()?;
        Ok(seen)
    })
    .await
    .unwrap();
    assert_eq!(
        seen_inside, 0,
        "the inner connection saw an uncommitted write"
    );
    let rows: i64 = on_executor(&owner, |store| {
        Ok(open_runtime_connection(store)?
            .query_row("SELECT COUNT(*) FROM probe", [], |row| row.get(0))?)
    })
    .await
    .unwrap();
    assert_eq!(rows, 1);
    // Only the nested open created a connection; it stayed for later commands.
    assert_eq!(tracked_connection_opens(&path), 1);
    finish(&path, owner).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_replaced_store_file_is_never_served_by_the_old_connection() {
    let (path, owner) = owned_store("replaced").await;
    on_executor(&owner, |store| {
        open_runtime_connection(store)?.execute_batch(
            "CREATE TABLE marker (value TEXT); INSERT INTO marker VALUES ('old');",
        )?;
        Ok(())
    })
    .await
    .unwrap();
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(sidecar(&path, suffix));
    }
    owner.initialize().await.unwrap();
    let markers: i64 = on_executor(&owner, |store| {
        Ok(open_runtime_connection(store)?.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'marker'",
            [],
            |row| row.get(0),
        )?)
    })
    .await
    .unwrap();
    assert_eq!(markers, 0, "a command ran against the removed store file");
    finish(&path, owner).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn read_only_checkouts_reject_writes_and_release_the_guard() {
    let (path, owner) = owned_store("read_only").await;
    track_connection_opens(&path);
    on_executor(&owner, |store| {
        open_runtime_connection(store)?.execute_batch("CREATE TABLE probe (value INTEGER)")?;
        let error = open_initialized_read_connection(store)?
            .execute("INSERT INTO probe VALUES (1)", [])
            .unwrap_err();
        assert_eq!(
            error.sqlite_error_code(),
            Some(rusqlite::ErrorCode::ReadOnly),
            "{error}"
        );
        open_runtime_connection(store)?.execute("INSERT INTO probe VALUES (2)", [])?;
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(tracked_connection_opens(&path), 1);
    finish(&path, owner).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_future_schema_is_rejected_through_the_reused_connection() {
    let (path, owner) = owned_store("future").await;
    on_executor(&owner, |store| open_runtime_connection(store).map(drop))
        .await
        .unwrap();
    let peer = rusqlite::Connection::open(&path).unwrap();
    peer.pragma_update(None, "user_version", STORE_SCHEMA_VERSION + 1)
        .unwrap();
    let error = on_executor(&owner, |store| open_runtime_connection(store).map(drop))
        .await
        .unwrap_err();
    assert!(
        error.to_string().contains(&format!(
            "unsupported store schema version {}",
            STORE_SCHEMA_VERSION + 1
        )),
        "{error:#}"
    );
    peer.pragma_update(None, "user_version", STORE_SCHEMA_VERSION)
        .unwrap();
    drop(peer);
    on_executor(&owner, |store| open_runtime_connection(store).map(drop))
        .await
        .unwrap();
    finish(&path, owner).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_commands_busy_handler_does_not_leak_into_the_next_command() {
    let (path, owner) = owned_store("busy_handler").await;
    on_executor(&owner, |store| {
        open_runtime_connection(store)?.busy_handler(Some(|_| false))?;
        Ok(())
    })
    .await
    .unwrap();
    let peer = rusqlite::Connection::open(&path).unwrap();
    peer.execute_batch("BEGIN IMMEDIATE").unwrap();
    let release = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(200));
        peer.execute_batch("COMMIT").unwrap();
    });
    // The store's own busy policy waits for the peer instead of failing fast.
    on_executor(&owner, |store| {
        open_runtime_connection(store)?.execute_batch("CREATE TABLE busy_probe (value INTEGER)")?;
        Ok(())
    })
    .await
    .unwrap();
    release.join().unwrap();
    finish(&path, owner).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_foreign_calendar_format_is_refused_through_the_reused_connection() {
    let (path, owner) = owned_store("calendar_format").await;
    on_executor(&owner, |store| open_connection(store).map(drop))
        .await
        .unwrap();
    // A peer leaves the current version header on a foreign occurrence
    // layout; every reused checkout must still refuse it.
    let peer = rusqlite::Connection::open(&path).unwrap();
    peer.execute_batch(
        "PRAGMA foreign_keys = OFF;
         DROP TABLE heartbeat_occurrences;
         CREATE TABLE heartbeat_occurrences (id INTEGER PRIMARY KEY);",
    )
    .unwrap();
    drop(peer);
    for action in ["open", "runtime", "read-only"] {
        let error = on_executor(&owner, move |store| match action {
            "open" => open_connection(store).map(drop),
            "runtime" => open_runtime_connection(store).map(drop),
            _ => open_initialized_read_connection(store).map(drop),
        })
        .await
        .unwrap_err();
        assert!(
            error
                .to_string()
                .contains("unsupported calendar store format"),
            "{action}: {error:#}"
        );
    }
    finish(&path, owner).await;
}
