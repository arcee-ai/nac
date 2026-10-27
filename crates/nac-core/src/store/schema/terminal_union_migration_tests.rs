//! The two historical v33 branches add different structures to the same v32
//! base. Reconstruct each footprint with real durable records, not a v33 label
//! on an already complete database. Migration must not perform shell recovery.
use super::*;
use crate::session_service::{ShellCommandRequest, ShellCommandSnapshot, ShellCommandState};
use crate::sessions::SessionOperationLease;
use crate::store::{
    InboxDelivery, SessionInboxRecord, TerminalSelectionDelivery, TerminalSelectionIntent,
    TerminalSelectionSourceKind, TranscriptLogWriter,
};
use crate::types::Message;
use rusqlite::types::Value;

#[derive(Clone, Copy, Debug)]
enum Predecessor {
    Legacy32,
    Selection33,
    Human33,
    Union33,
}
impl Predecessor {
    fn selection(self) -> bool {
        matches!(self, Self::Selection33 | Self::Union33)
    }
    fn human(self) -> bool {
        matches!(self, Self::Human33 | Self::Union33)
    }
    fn version(self) -> i64 {
        if matches!(self, Self::Legacy32) {
            32
        } else {
            33
        }
    }
}

struct Fixture {
    path: PathBuf,
    selections: Vec<(TerminalSelectionIntent, SessionInboxRecord)>,
}

fn seed_human_journal(path: &Path) {
    let lease = Arc::new(SessionOperationLease::try_acquire(path, "session").unwrap());
    for (request_id, phase) in [("accepted", 0), ("started", 1), ("finished", 2)] {
        let request = ShellCommandRequest {
            request_id: request_id.into(),
            command: "printf 'literal [REDACTED] 中🙂'".into(),
            timeout_ms: Some(30_000),
        };
        let mut snapshot = ShellCommandSnapshot {
            request_id: request.request_id.clone(),
            operation_id: uuid::Uuid::new_v4().to_string(),
            command: request.command.clone(),
            timeout_ms: 30_000,
            state: ShellCommandState::Accepted,
            accepted_at_epoch_ms: 10,
            finished_at_epoch_ms: None,
            exit_code: None,
            stdout: String::new(),
            stderr: String::new(),
            diagnostic: None,
            output_id: None,
            transcript_index: None,
        };
        crate::store::shell_commands::accept_shell_command(
            path,
            "session",
            &request.fingerprint(30_000),
            &snapshot,
            &lease,
        )
        .unwrap();
        if phase > 0 {
            snapshot.state = ShellCommandState::Started;
            crate::store::shell_commands::start_shell_command(path, "session", &snapshot, &lease)
                .unwrap();
        }
        if phase == 2 {
            snapshot.state = ShellCommandState::Completed;
            snapshot.finished_at_epoch_ms = Some(20);
            snapshot.exit_code = Some(7);
            snapshot.stdout = " literal [REDACTED] 中🙂\n ".into();
            TranscriptLogWriter::for_run(path, "session", &snapshot.operation_id, &lease)
                .unwrap()
                .finish_shell_command("session", &snapshot)
                .unwrap();
        }
    }
}

fn seed_selection_receipts(path: &Path) -> Vec<(TerminalSelectionIntent, SessionInboxRecord)> {
    let mut saved = Vec::new();
    for status in ["pending", "cancelled", "delivered"] {
        let intent = TerminalSelectionIntent {
            protocol_version: 1,
            source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
            admission_id: uuid::Uuid::new_v4().to_string(),
            capture_id: uuid::Uuid::new_v4().to_string(),
            source_session_id: "session".into(),
            terminal_id: "exited-source".into(),
            owner_instance_id: uuid::Uuid::new_v4().to_string(),
            client_capture_time_ms: Some("12".into()),
            text: " /compact\n$skill\n[REDACTED]\n中🙂 ".into(),
            user_text: Some(" accompanying literal question ".into()),
            initial_delivery: TerminalSelectionDelivery::Queue,
            initial_expected_run_id: None,
        };
        let admitted = crate::store::create_terminal_selection_intent(path, &intent).unwrap();
        if status == "cancelled" {
            crate::store::cancel_pending_session_inbox_item(path, "session", admitted.record.id, 0)
                .unwrap();
        } else if status == "delivered" {
            let writer = TranscriptLogWriter::new(path).unwrap();
            let next = writer.read_from("session", 0).unwrap().len() as u64;
            writer
                .append_inbox_run_prompt(
                    "session",
                    next,
                    &Message::User {
                        content: admitted.record.content.clone(),
                    },
                    "selection-run",
                    admitted.record.id,
                )
                .unwrap();
        }
        let receipt = crate::store::load_terminal_selection_receipt(path, &intent)
            .unwrap()
            .unwrap();
        saved.push((intent, receipt.record));
    }
    saved
}

fn fixture(predecessor: Predecessor) -> Fixture {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-terminal-union-{predecessor:?}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    for id in ["session", "child"] {
        crate::store::insert_test_session(&path, id);
    }
    let connection = Connection::open(&path).unwrap();
    connection
        .execute(
            "UPDATE sessions SET behavior='direct' WHERE session_id='session'",
            [],
        )
        .unwrap();
    connection.execute_batch("INSERT INTO traditional_children(child_session_id,parent_session_id,root_session_id,profile,description,nesting_depth,status,generation,run_id,execution_mode,created_at,updated_at)
        VALUES('child','session','session','general','preserved generation',1,'running',7,'child-run','background','before','before')").unwrap();
    crate::store::create_session_inbox_item(
        &path,
        "session",
        InboxDelivery::Queue,
        "legacy content",
        None,
        None,
    )
    .unwrap();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_idempotent(
            "session",
            "legacy-receipt",
            Some(0),
            &[Message::User {
                content: " exact legacy transcript 中🙂 ".into(),
            }],
        )
        .unwrap();
    if predecessor.human() {
        seed_human_journal(&path);
    }
    let selections = if predecessor.selection() {
        seed_selection_receipts(&path)
    } else {
        Vec::new()
    };
    if !predecessor.human() {
        connection
            .execute_batch("DROP TABLE human_shell_operations")
            .unwrap();
    }
    if !predecessor.selection() {
        connection
            .execute_batch(
                "DROP INDEX idx_session_inbox_admission;
            ALTER TABLE session_inbox DROP COLUMN admission_digest;
            ALTER TABLE session_inbox DROP COLUMN admission_id;",
            )
            .unwrap();
    }
    connection
        .pragma_update(None, "user_version", predecessor.version())
        .unwrap();
    assert_eq!(
        table_exists(&connection, "human_shell_operations").unwrap(),
        predecessor.human()
    );
    assert_eq!(
        column_exists(&connection, "session_inbox", "admission_id").unwrap(),
        predecessor.selection()
    );
    Fixture { path, selections }
}

fn rows(connection: &Connection, sql: &str) -> Vec<Vec<Value>> {
    let mut statement = connection.prepare(sql).unwrap();
    let columns = statement.column_count();
    statement
        .query_map([], |row| (0..columns).map(|i| row.get(i)).collect())
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn retained(connection: &Connection) -> Vec<Vec<Vec<Value>>> {
    let mut facts = [
        "sessions",
        "thread_events",
        "transcript_append_receipts",
        "session_run_recovery",
        "traditional_children",
        "managed_orchestrators",
        "sqlite_sequence",
    ]
    .map(|table| rows(connection, &format!("SELECT * FROM {table} ORDER BY rowid")))
    .to_vec();
    facts.push(rows(connection, "SELECT id,session_id,delivery,status,content,target_run_id,client_id,delivered_run_id,created_at,updated_at,delivered_at,cancelled_at,version FROM session_inbox ORDER BY id"));
    facts.push(if column_exists(connection, "session_inbox", "admission_id").unwrap() {
        rows(connection, "SELECT id,admission_id,admission_digest FROM session_inbox WHERE admission_id IS NOT NULL ORDER BY id")
    } else { Vec::new() });
    facts.push(
        if table_exists(connection, "human_shell_operations").unwrap() {
            rows(
                connection,
                "SELECT * FROM human_shell_operations ORDER BY rowid",
            )
        } else {
            Vec::new()
        },
    );
    facts
}

fn assert_union(connection: &Connection) {
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        STORE_SCHEMA_VERSION
    );
    assert!(table_exists(connection, "human_shell_operations").unwrap());
    assert!(column_exists(connection, "session_inbox", "admission_id").unwrap());
    assert!(column_exists(connection, "session_inbox", "admission_digest").unwrap());
    let unique: i64 = connection.query_row("SELECT \"unique\" FROM pragma_index_list('session_inbox') WHERE name='idx_session_inbox_admission'", [], |row| row.get(0)).unwrap();
    assert_eq!(unique, 1);
    assert!(rows(connection, "PRAGMA foreign_key_check").is_empty());
}

fn assert_receipts(fixture: &Fixture) {
    for (intent, original) in &fixture.selections {
        let replay = crate::store::load_terminal_selection_receipt(&fixture.path, intent)
            .unwrap()
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(&replay.record, original);
        assert_eq!(&replay.intent, intent);
    }
}

#[test]
fn terminal_union_migration_34_preserves_fresh_and_each_predecessor() {
    let fresh = std::env::temp_dir()
        .join(format!("nac-terminal-union-fresh-{}", uuid::Uuid::new_v4()))
        .join("store.db");
    initialize(&fresh).unwrap();
    assert_union(&Connection::open(&fresh).unwrap());
    std::fs::remove_dir_all(fresh.parent().unwrap()).unwrap();
    for predecessor in [
        Predecessor::Legacy32,
        Predecessor::Selection33,
        Predecessor::Human33,
        Predecessor::Union33,
    ] {
        let fixture = fixture(predecessor);
        let connection = Connection::open(&fixture.path).unwrap();
        let before = retained(&connection);
        // Schema migration must not revoke or replace a session operation lease.
        let lease = SessionOperationLease::try_acquire(&fixture.path, "session").unwrap();
        initialize(&fixture.path).unwrap();
        assert_union(&connection);
        assert_eq!(before, retained(&connection), "{predecessor:?}");
        lease.validate(&fixture.path, "session").unwrap();
        assert!(matches!(
            SessionOperationLease::try_acquire(&fixture.path, "session"),
            Err(crate::sessions::SessionOperationLeaseError::Busy(_))
        ));
        assert_receipts(&fixture);
        // All three hooks are unreachable for the now-current read-only fastpath.
        connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        initialize_with_hooks(
            &fixture.path,
            || panic!("current preflight"),
            || panic!("current writer"),
            || panic!("current commit"),
        )
        .unwrap();
        connection.execute_batch("ROLLBACK").unwrap();
        drop(lease);
        drop(connection);
        std::fs::remove_dir_all(fixture.path.parent().unwrap()).unwrap();
    }
}

#[test]
fn terminal_union_migration_34_rolls_back_each_33_shape_then_retries() {
    for predecessor in [
        Predecessor::Selection33,
        Predecessor::Human33,
        Predecessor::Union33,
    ] {
        let fixture = fixture(predecessor);
        let connection = Connection::open(&fixture.path).unwrap();
        let before = retained(&connection);
        let schema = rows(
            &connection,
            "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name",
        );
        assert!(initialize_with_hooks(
            &fixture.path,
            || {},
            || {},
            || Err(anyhow!("injected union migration failure"))
        )
        .is_err());
        assert_eq!(
            connection
                .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
                .unwrap(),
            33
        );
        assert_eq!(
            schema,
            rows(
                &connection,
                "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"
            )
        );
        assert_eq!(before, retained(&connection));
        initialize(&fixture.path).unwrap();
        assert_union(&connection);
        assert_eq!(before, retained(&connection));
        assert_receipts(&fixture);
        drop(connection);
        std::fs::remove_dir_all(fixture.path.parent().unwrap()).unwrap();
    }
}

#[test]
fn terminal_union_migration_34_concurrent_retry_waits_for_rolled_back_owner() {
    for predecessor in [Predecessor::Selection33, Predecessor::Human33] {
        let fixture = fixture(predecessor);
        let before = retained(&Connection::open(&fixture.path).unwrap());
        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let first_path = fixture.path.clone();
        let first = std::thread::spawn(move || {
            initialize_with_hooks(
                &first_path,
                || {},
                || {
                    locked_tx.send(()).unwrap();
                    release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                },
                || Err(anyhow!("first owner rolls back")),
            )
        });
        locked_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (second_locked_tx, second_locked_rx) = std::sync::mpsc::channel();
        let second_path = fixture.path.clone();
        let second = std::thread::spawn(move || {
            initialize_with_hooks(
                &second_path,
                || {
                    started_tx.send(()).unwrap();
                },
                || {
                    second_locked_tx.send(()).unwrap();
                },
                || Ok(()),
            )
        });
        started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(second_locked_rx.try_recv().is_err());
        release_tx.send(()).unwrap();
        assert!(first.join().unwrap().is_err());
        second_locked_rx
            .recv_timeout(Duration::from_secs(5))
            .unwrap();
        second.join().unwrap().unwrap();
        let connection = Connection::open(&fixture.path).unwrap();
        assert_union(&connection);
        assert_eq!(before, retained(&connection));
        assert_receipts(&fixture);
        drop(connection);
        std::fs::remove_dir_all(fixture.path.parent().unwrap()).unwrap();
    }
}

#[test]
fn terminal_union_migration_34_rejects_orphan_human_journal_without_rewriting_it() {
    let fixture = fixture(Predecessor::Human33);
    let connection = Connection::open(&fixture.path).unwrap();
    connection
        .pragma_update(None, "foreign_keys", false)
        .unwrap();
    connection.execute("INSERT INTO human_shell_operations(session_id,request_id,fingerprint,operation_id,phase,snapshot_json) VALUES('missing-session','orphan','retained','orphan-operation','accepted','{}')", []).unwrap();
    let before = retained(&connection);
    let error = initialize(&fixture.path).unwrap_err();
    assert!(error.to_string().contains("human_shell_operations"));
    assert_eq!(
        connection
            .pragma_query_value(None, "user_version", |row| row.get::<_, i64>(0))
            .unwrap(),
        33
    );
    assert!(!column_exists(&connection, "session_inbox", "admission_id").unwrap());
    assert_eq!(before, retained(&connection));
    drop(connection);
    std::fs::remove_dir_all(fixture.path.parent().unwrap()).unwrap();
}
