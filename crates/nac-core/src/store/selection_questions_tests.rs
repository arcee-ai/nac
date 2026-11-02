use super::*;
use crate::types::Message;

fn temp_store(label: &str) -> std::path::PathBuf {
    let path = std::env::temp_dir()
        .join(format!(
            "nac-selection-questions-{label}-{}",
            uuid::Uuid::new_v4()
        ))
        .join("store.db");
    initialize(&path).unwrap();
    path
}

fn context(index: u64, question: &str) -> SelectionQuestionContext {
    SelectionQuestionContext {
        source_message_index: index,
        source_content_sha256: "a".repeat(64),
        selection_start: 0,
        selection_end: 4,
        excerpt: "text".to_string(),
        source_text: "text and more".to_string(),
        source_text_truncated: false,
        preceding_prompt: Some("prompt".to_string()),
        preceding_prompt_truncated: false,
        question: question.to_string(),
    }
}

fn admission(session: &str, key: &str, digest: char, question: &str) -> SelectionQuestionAdmission {
    SelectionQuestionAdmission {
        question_id: uuid::Uuid::new_v4().to_string(),
        session_id: session.to_string(),
        request_key: key.to_string(),
        request_digest: digest.to_string().repeat(64),
        context: context(2, question),
        model: SelectionQuestionModel {
            model: "model-a".to_string(),
            backend: "openai-responses".to_string(),
            config_version: 3,
        },
    }
}

fn answered(text: &str) -> SelectionQuestionSettlement {
    SelectionQuestionSettlement {
        status: SelectionQuestionStatus::Answered,
        answer: Some(text.to_string()),
        answer_truncated: false,
        error: None,
        tool_call_attempted: false,
        usage: Some(crate::model::TokenUsage {
            input_tokens: 7,
            output_tokens: 3,
            ..Default::default()
        }),
    }
}

fn user_version(connection: &Connection) -> i64 {
    connection
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap()
}

/// Every object in the store, so re-opening can be proven to change nothing.
fn schema_objects(connection: &Connection) -> Vec<(String, String, Option<String>)> {
    connection
        .prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn table_rows(connection: &Connection, table: &str) -> Vec<Vec<rusqlite::types::Value>> {
    let mut statement = connection
        .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
        .unwrap();
    let width = statement.column_count();
    statement
        .query_map([], |row| {
            (0..width)
                .map(|index| row.get::<_, rusqlite::types::Value>(index))
                .collect()
        })
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap()
}

fn assert_question_table(connection: &Connection) {
    let indexes: Vec<String> = connection
        .prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'selection_questions' AND type = 'index' AND name LIKE 'idx_%' ORDER BY name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        indexes,
        [
            "idx_selection_questions_one_pending",
            "idx_selection_questions_session"
        ]
    );
}

fn inbox_has_completion_columns(connection: &Connection) -> bool {
    let columns: Vec<String> = connection
        .prepare("SELECT name FROM pragma_table_info('session_inbox')")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    [
        "completion_source",
        "completion_session_id",
        "completion_generation",
    ]
    .iter()
    .all(|column| columns.iter().any(|name| name == column))
}

/// A direct parent with background children whose settled runs leave pending
/// internal completions (ALL-557, schema 41) in the parent's inbox.
fn seed_child_completions(path: &Path, children: &[&str]) -> Vec<i64> {
    insert_test_session(path, "parent");
    for child in children {
        insert_test_session(path, child);
    }
    open_runtime_connection(path)
        .unwrap()
        .execute("UPDATE sessions SET behavior = 'direct'", [])
        .unwrap();
    children
        .iter()
        .map(|child| {
            create_traditional_child_relationship(
                path,
                "parent",
                child,
                GENERAL_CHILD_PROFILE,
                child,
            )
            .unwrap();
            begin_traditional_child_run(
                path,
                child,
                "run",
                TraditionalChildExecutionMode::Background,
            )
            .unwrap();
            let terminal = TraditionalChildTerminal {
                status: TraditionalChildStatus::Completed,
                report: Some(format!("{child} report")),
                failure: None,
                change_summary: None,
                verification_summary: None,
            };
            settle_traditional_child_run(path, child, "run", terminal)
                .unwrap()
                .child
                .completion_inbox_id
                .unwrap()
        })
        .collect()
}

fn child_origin(child: &str) -> Option<InternalCompletionOrigin> {
    Some(InternalCompletionOrigin {
        source: InternalCompletionSource::TraditionalChild,
        relationship_session_id: child.to_owned(),
        generation: 1,
    })
}

#[test]
fn fresh_store_is_created_at_42_with_completion_origins_and_questions() {
    let path = temp_store("fresh");
    let connection = Connection::open(&path).unwrap();
    assert_eq!(user_version(&connection), 42);
    assert!(inbox_has_completion_columns(&connection));
    assert_question_table(&connection);
    let schema = schema_objects(&connection);
    drop(connection);
    initialize(&path).unwrap();
    assert_eq!(schema_objects(&Connection::open(&path).unwrap()), schema);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

/// Schema 40 is dev before both ALL-557 (41) and ALL-559 (42): no completion
/// provenance columns and no question table. One open walks both steps.
#[test]
fn dev_v40_store_walks_41_then_42_without_touching_existing_rows() {
    let path = temp_store("from-40");
    let [completion] = seed_child_completions(&path, &["child"])[..] else {
        unreachable!()
    };
    let ordinary =
        create_session_inbox_item(&path, "parent", InboxDelivery::Queue, "kept", None, None)
            .unwrap();
    let native = load_session_inbox_item(&path, "parent", completion).unwrap();
    assert_eq!(native.internal_completion, child_origin("child"));
    {
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "UPDATE session_inbox SET completion_source = NULL, completion_session_id = NULL,
                     completion_generation = NULL;
                 ALTER TABLE session_inbox DROP COLUMN completion_generation;
                 ALTER TABLE session_inbox DROP COLUMN completion_session_id;
                 ALTER TABLE session_inbox DROP COLUMN completion_source;
                 DROP TABLE selection_questions;
                 PRAGMA user_version = 40;",
            )
            .unwrap();
        assert!(!inbox_has_completion_columns(&connection));
    }
    let before = table_rows(&Connection::open(&path).unwrap(), "traditional_children");

    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    assert_eq!(user_version(&connection), 42);
    assert!(inbox_has_completion_columns(&connection));
    assert_question_table(&connection);
    assert_eq!(table_rows(&connection, "traditional_children"), before);
    let schema = schema_objects(&connection);
    let inbox = table_rows(&connection, "session_inbox");
    drop(connection);
    // The 41 step classified the pending completion from durable evidence and
    // changed nothing else; ordinary input is untouched.
    assert_eq!(
        load_session_inbox_item(&path, "parent", completion).unwrap(),
        native
    );
    assert_eq!(
        load_session_inbox_item(&path, "parent", ordinary.id).unwrap(),
        ordinary
    );
    assert!(list_selection_questions(&path, "parent")
        .unwrap()
        .is_empty());

    // Re-opening the migrated store is idempotent.
    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    assert_eq!(user_version(&connection), 42);
    assert_eq!(schema_objects(&connection), schema);
    assert_eq!(table_rows(&connection, "session_inbox"), inbox);
    drop(connection);
    let admitted =
        admit_selection_question(&path, &admission("parent", &key(1), 'b', "q")).unwrap();
    assert!(!admitted.replayed);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

/// A store already opened by ALL-557 at schema 41 must still gain the question
/// table: 42 is a distinct step, so the stored-version early return cannot
/// skip it. The 41 data, including its one-time legacy classification, is
/// final and is not revisited.
#[test]
fn schema_41_store_gains_the_question_table_and_keeps_completion_rows() {
    let path = temp_store("from-41");
    let ids = seed_child_completions(&path, &["child-a", "child-b"]);
    {
        let connection = Connection::open(&path).unwrap();
        // child-b's row stands for one the 41 classification left ordinary
        // (for example, conflicting evidence); reaching 42 must not re-run it.
        connection
            .execute(
                "UPDATE session_inbox SET completion_source = NULL,
                     completion_session_id = NULL, completion_generation = NULL
                 WHERE id = ?1",
                params![ids[1]],
            )
            .unwrap();
        connection
            .execute_batch(
                "DROP TABLE selection_questions;
                 PRAGMA user_version = 41;",
            )
            .unwrap();
    }
    let tables = [
        "sessions",
        "session_inbox",
        "traditional_children",
        "traditional_child_terminal_receipts",
        "sqlite_sequence",
    ];
    let legacy = Connection::open(&path).unwrap();
    let before = tables.map(|table| table_rows(&legacy, table));
    drop(legacy);

    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    assert_eq!(user_version(&connection), 42);
    assert_question_table(&connection);
    assert_eq!(tables.map(|table| table_rows(&connection, table)), before);
    let schema = schema_objects(&connection);
    drop(connection);
    let origin = |id| {
        load_session_inbox_item(&path, "parent", id)
            .unwrap()
            .internal_completion
    };
    assert_eq!(origin(ids[0]), child_origin("child-a"));
    assert_eq!(origin(ids[1]), None);

    initialize(&path).unwrap();
    let connection = Connection::open(&path).unwrap();
    assert_eq!(user_version(&connection), 42);
    assert_eq!(schema_objects(&connection), schema);
    assert_eq!(tables.map(|table| table_rows(&connection, table)), before);
    drop(connection);
    let admitted =
        admit_selection_question(&path, &admission("parent", &key(1), 'b', "q")).unwrap();
    assert!(!admitted.replayed);
    assert_eq!(list_selection_questions(&path, "parent").unwrap().len(), 1);
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

fn key(n: u8) -> String {
    format!("00000000-0000-4000-8000-{:012}", n)
}

#[test]
fn identical_retry_returns_the_receipt_and_a_changed_retry_conflicts() {
    let path = temp_store("identity");
    insert_test_session(&path, "session");
    let first = admission("session", &key(1), 'b', "what does this mean?");
    let created = admit_selection_question(&path, &first).unwrap();
    assert!(!created.replayed);
    assert_eq!(created.record.status, SelectionQuestionStatus::Pending);

    let mut retry = first.clone();
    retry.question_id = uuid::Uuid::new_v4().to_string();
    let replayed = admit_selection_question(&path, &retry).unwrap();
    assert!(replayed.replayed);
    assert_eq!(replayed.record, created.record);
    assert_eq!(
        find_selection_question_receipt(&path, "session", &key(1), &"b".repeat(64))
            .unwrap()
            .unwrap(),
        created.record
    );

    let changed = admission("session", &key(1), 'c', "a different question");
    let error = admit_selection_question(&path, &changed).unwrap_err();
    assert_eq!(
        error.downcast_ref::<SelectionQuestionStoreError>(),
        Some(&SelectionQuestionStoreError::IdentityConflict)
    );
    assert!(find_selection_question_receipt(&path, "session", &key(1), &"c".repeat(64)).is_err());
    assert_eq!(list_selection_questions(&path, "session").unwrap().len(), 1);
}

#[test]
fn settlement_cancel_and_late_outcomes_respect_the_pending_state() {
    let path = temp_store("settle");
    insert_test_session(&path, "session");
    let first = admit_selection_question(&path, &admission("session", &key(1), 'b', "q1"))
        .unwrap()
        .record;
    let settled = settle_selection_question(
        &path,
        "session",
        &first.question_id,
        &answered("it means x"),
    )
    .unwrap()
    .unwrap();
    assert_eq!(settled.status, SelectionQuestionStatus::Answered);
    assert_eq!(settled.answer.as_deref(), Some("it means x"));
    assert_eq!(settled.usage.as_ref().unwrap().input_tokens, 7);
    assert!(settled.completed_at.is_some());
    // A second outcome cannot overwrite a settled answer.
    assert!(
        settle_selection_question(&path, "session", &first.question_id, &answered("again"))
            .unwrap()
            .is_none()
    );
    // Cancel leaves a settled question unchanged.
    assert_eq!(
        cancel_selection_question(&path, "session", &first.question_id)
            .unwrap()
            .unwrap(),
        settled
    );

    let second = admit_selection_question(&path, &admission("session", &key(2), 'c', "q2"))
        .unwrap()
        .record;
    let canceled = cancel_selection_question(&path, "session", &second.question_id)
        .unwrap()
        .unwrap();
    assert_eq!(canceled.status, SelectionQuestionStatus::Canceled);
    // A provider response that arrives after cancellation is discarded.
    assert!(
        settle_selection_question(&path, "session", &second.question_id, &answered("late"))
            .unwrap()
            .is_none()
    );
    let reloaded = load_selection_question(&path, "session", &second.question_id)
        .unwrap()
        .unwrap();
    assert_eq!(reloaded.status, SelectionQuestionStatus::Canceled);
    assert!(reloaded.answer.is_none());
    // Wrong-session reads stay opaque.
    insert_test_session(&path, "other");
    assert!(load_selection_question(&path, "other", &second.question_id)
        .unwrap()
        .is_none());
    assert!(
        cancel_selection_question(&path, "other", &second.question_id)
            .unwrap()
            .is_none()
    );
}

#[test]
fn orphaned_pending_questions_become_interrupted_only_without_a_live_owner() {
    let path = temp_store("interrupt");
    insert_test_session(&path, "session");
    let pending = admit_selection_question(&path, &admission("session", &key(1), 'b', "q"))
        .unwrap()
        .record;
    // A live owner retains the question lease: nothing is interrupted.
    let lease = crate::sessions::SessionOperationLease::try_acquire(
        &path,
        &selection_question_lease_name("session"),
    )
    .unwrap();
    assert_eq!(interrupt_orphaned_selection_questions(&path).unwrap(), 0);
    drop(lease);
    // Restart: the owner is gone, so the question is interrupted, not replayed.
    assert_eq!(interrupt_orphaned_selection_questions(&path).unwrap(), 1);
    let interrupted = load_selection_question(&path, "session", &pending.question_id)
        .unwrap()
        .unwrap();
    assert_eq!(interrupted.status, SelectionQuestionStatus::Interrupted);
    assert!(interrupted.answer.is_none() && interrupted.usage.is_none());
    assert!(
        settle_selection_question(&path, "session", &pending.question_id, &answered("late"))
            .unwrap()
            .is_none()
    );
}

#[test]
fn one_pending_question_per_session_and_history_is_pruned_oldest_first() {
    let path = temp_store("bounds");
    insert_test_session(&path, "session");
    let first = admit_selection_question(&path, &admission("session", &key(1), 'b', "q"))
        .unwrap()
        .record;
    // The durable index rejects a second pending row written behind the
    // admission owner's back.
    let connection = open_runtime_connection(&path).unwrap();
    assert!(connection
        .execute(
            "INSERT INTO selection_questions (question_id, session_id, request_key, request_digest,
                 source_message_index, context_json, model_json, status, created_at, updated_at)
             SELECT ?1, session_id, ?2, request_digest, source_message_index, context_json,
                    model_json, 'pending', created_at, updated_at
             FROM selection_questions WHERE question_id = ?3",
            params![uuid::Uuid::new_v4().to_string(), key(99), first.question_id],
        )
        .is_err());
    drop(connection);
    // Admission (which holds the lease) settles an orphaned pending row.
    let second = admit_selection_question(&path, &admission("session", &key(2), 'c', "q"))
        .unwrap()
        .record;
    assert_eq!(
        load_selection_question(&path, "session", &first.question_id)
            .unwrap()
            .unwrap()
            .status,
        SelectionQuestionStatus::Interrupted
    );
    settle_selection_question(&path, "session", &second.question_id, &answered("a")).unwrap();
    for n in 3..(SELECTION_QUESTION_HISTORY_LIMIT as u8 + 5) {
        let record = admit_selection_question(&path, &admission("session", &key(n), 'd', "q"))
            .unwrap()
            .record;
        settle_selection_question(&path, "session", &record.question_id, &answered("a")).unwrap();
    }
    let history = list_selection_questions(&path, "session").unwrap();
    assert_eq!(history.len(), SELECTION_QUESTION_HISTORY_LIMIT);
    assert!(history
        .iter()
        .all(|record| record.question_id != first.question_id));
    assert_eq!(
        history.last().unwrap().request_key,
        key(SELECTION_QUESTION_HISTORY_LIMIT as u8 + 4)
    );
    // Deleting the session removes its question history with it.
    crate::sessions::delete_session(&path, "session").unwrap();
    assert!(list_selection_questions(&path, "session")
        .unwrap()
        .is_empty());
}

#[test]
fn source_reads_span_the_snapshot_blob_and_the_transcript_log() {
    let path = temp_store("source");
    let assistant = |text: &str| Message::Assistant {
        content: Some(text.to_string()),
        reasoning_text: Some("hidden".to_string()),
        reasoning_details: None,
        tool_calls: None,
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    };
    let blob = vec![
        Message::System {
            content: "system".to_string(),
        },
        Message::User {
            content: "first prompt".to_string(),
        },
        assistant("first answer"),
    ];
    let snapshot = crate::sessions::new_snapshot(
        "session".to_string(),
        std::env::temp_dir(),
        "model".to_string(),
        "https://example.invalid/v1".to_string(),
        crate::model::BackendKind::OpenAiResponses,
        None,
        None,
        None,
        blob,
        None,
        Default::default(),
    );
    crate::sessions::create_session(&path, &snapshot).unwrap();
    TranscriptLogWriter::new(&path)
        .unwrap()
        .append_batch(
            "session",
            3,
            &[
                Message::User {
                    content: "second prompt".to_string(),
                },
                assistant("second answer"),
            ],
        )
        .unwrap();

    let SelectionSourceRead::Found {
        message,
        preceding_user,
    } = read_selection_source(&path, "session", 2).unwrap()
    else {
        panic!("blob message missing");
    };
    assert!(
        matches!(message, Message::Assistant { content: Some(text), .. } if text == "first answer")
    );
    assert_eq!(preceding_user.as_deref(), Some("first prompt"));

    let SelectionSourceRead::Found {
        message,
        preceding_user,
    } = read_selection_source(&path, "session", 4).unwrap()
    else {
        panic!("log message missing");
    };
    assert!(
        matches!(message, Message::Assistant { content: Some(text), .. } if text == "second answer")
    );
    assert_eq!(preceding_user.as_deref(), Some("second prompt"));

    assert!(matches!(
        read_selection_source(&path, "session", 5).unwrap(),
        SelectionSourceRead::Missing
    ));
    assert!(matches!(
        read_selection_source(&path, "missing", 0).unwrap(),
        SelectionSourceRead::Missing
    ));
}
