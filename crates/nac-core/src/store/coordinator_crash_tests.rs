//! Actual process deaths at the coordinator's transaction and delivery seams.
use super::*;
use crate::store::transcript_append::{AppendBarrier, AppendFault};
use crate::store::{TranscriptAppendReceipt, TranscriptLogWriter};
use crate::types::Message;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

const CHILD_TEST: &str = "store::coordinator::crash_tests::coordinator_crash_child";
const STORE_ENV: &str = "NAC_TEST_ALL116_CRASH_STORE";
const PHASE_ENV: &str = "NAC_TEST_ALL116_CRASH_PHASE";

struct CrashAppend {
    barrier: Option<AppendBarrier>,
}
fn messages() -> Vec<Message> {
    ["one", "two"]
        .into_iter()
        .map(|content| Message::User {
            content: content.into(),
        })
        .collect()
}
impl PersistenceCommand for CrashAppend {
    type Output = TranscriptAppendReceipt;
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        let writer = TranscriptLogWriter::new(path)?;
        *writer.append_barrier.lock().unwrap() = self.barrier;
        writer.append_idempotent("session", "crash-request", Some(0), &messages())
    }
}
struct Seed;
impl PersistenceCommand for Seed {
    type Output = ();
    fn correlation(&self) -> Correlation {
        Correlation::default()
    }
    fn execute(self, path: &Path) -> Result<()> {
        crate::store::insert_test_session(path, "session");
        Ok(())
    }
}
struct Proof;
impl PersistenceCommand for Proof {
    type Output = (Vec<(u64, Message)>, i64);
    fn correlation(&self) -> Correlation {
        Correlation::session(Some("session"))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        let connection = crate::store::open_runtime_connection(path)?;
        let receipts = connection.query_row(
            "SELECT COUNT(*) FROM transcript_append_receipts",
            [],
            |row| row.get(0),
        )?;
        Ok((
            TranscriptLogWriter::new(path)?.read_from("session", 0)?,
            receipts,
        ))
    }
}

#[test]
fn coordinator_crash_child() {
    let Some(store) = std::env::var_os(STORE_ENV) else {
        return;
    };
    let store = PathBuf::from(store);
    let phase = std::env::var(PHASE_ENV).unwrap();
    let reached = store.with_extension("reached");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let owner = StoreCoordinator::acquire(&store).unwrap();
        owner.initialize().await.unwrap();
        owner.submit(Seed).unwrap().acknowledge().await.unwrap();
        let barrier = match phase.as_str() {
            "before_commit" => Some(AppendFault::BeforeCommit),
            "after_commit_before_ack" => Some(AppendFault::AfterCommitBeforeAck),
            "after_ack" => None,
            _ => panic!("unsupported crash phase"),
        }
        .map(|phase| AppendBarrier {
            phase,
            reached: reached.clone(),
        });
        let receipt = owner
            .submit(CrashAppend { barrier })
            .unwrap()
            .acknowledge()
            .await
            .unwrap();
        assert_eq!(receipt.end_idx, 2);
        assert_eq!(phase, "after_ack");
        std::fs::write(&reached, b"after_ack:2").unwrap();
        std::future::pending::<()>().await;
    });
}

struct ChildFixture {
    child: Child,
    directory: PathBuf,
}
impl Drop for ChildFixture {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn killed_owner_recovers_before_commit_after_commit_and_after_ack() {
    for (phase, committed) in [
        ("before_commit", false),
        ("after_commit_before_ack", true),
        ("after_ack", true),
    ] {
        let directory =
            std::env::temp_dir().join(format!("nac-coordinator-crash-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let store = directory.join("store.db");
        let log = std::fs::File::create(directory.join("child.log")).unwrap();
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", CHILD_TEST, "--nocapture", "--test-threads=1"])
            .env(STORE_ENV, &store)
            .env(PHASE_ENV, phase)
            .stdout(Stdio::from(log.try_clone().unwrap()))
            .stderr(Stdio::from(log))
            .spawn()
            .unwrap();
        let mut fixture = ChildFixture { child, directory };
        let deadline = Instant::now() + Duration::from_secs(10);
        while !store.with_extension("reached").is_file() {
            assert!(
                fixture.child.try_wait().unwrap().is_none(),
                "crash child exited before {phase}"
            );
            assert!(
                Instant::now() < deadline,
                "crash child did not reach {phase}"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
        fixture.child.kill().unwrap();
        assert!(!fixture.child.wait().unwrap().success());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let owner = StoreCoordinator::acquire(&store).unwrap();
            owner.initialize().await.unwrap();
            let (rows, receipts) = owner.submit(Proof).unwrap().acknowledge().await.unwrap();
            assert_eq!(rows.len(), if committed { 2 } else { 0 }, "{phase}");
            assert_eq!(receipts, i64::from(committed), "{phase}");
            let receipt = owner
                .submit(CrashAppend { barrier: None })
                .unwrap()
                .acknowledge()
                .await
                .unwrap();
            assert_eq!((receipt.start_idx, receipt.end_idx), (0, 2));
            let (rows, receipts) = owner.submit(Proof).unwrap().acknowledge().await.unwrap();
            assert_eq!(
                rows.iter().map(|(index, _)| *index).collect::<Vec<_>>(),
                [0, 1]
            );
            assert_eq!(receipts, 1);
            assert_eq!(
                serde_json::to_value(rows.iter().map(|(_, message)| message).collect::<Vec<_>>())
                    .unwrap(),
                serde_json::to_value(messages()).unwrap()
            );
            owner.shutdown().await.unwrap();
        });
    }
}
