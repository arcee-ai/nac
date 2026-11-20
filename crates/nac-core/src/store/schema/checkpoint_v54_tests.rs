use super::*;

fn fixture() -> (Connection, Vec<Message>) {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE sessions(session_id TEXT PRIMARY KEY,messages_json TEXT NOT NULL);
        CREATE TABLE thread_events(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL,thread_name TEXT NOT NULL,event_json TEXT NOT NULL);
        CREATE TABLE orchestrator_compaction_checkpoints(id INTEGER PRIMARY KEY,session_id TEXT NOT NULL,previous_checkpoint_id INTEGER,summary TEXT NOT NULL,tail_start_message_index INTEGER NOT NULL,source_prefix_sha256 BLOB NOT NULL,system_policy_sha256 BLOB NOT NULL,prompt_policy_version INTEGER NOT NULL,old_context_estimate INTEGER NOT NULL DEFAULT 1,summary_prompt_tokens INTEGER,summary_completion_tokens INTEGER,new_context_estimate INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT 'now');").unwrap();
    let messages = vec![
        Message::System {
            content: "system".into(),
        },
        Message::User {
            content: "orchestrator is user text".into(),
        },
        Message::User {
            content: "next".into(),
        },
    ];
    conn.execute(
        "INSERT INTO sessions VALUES('s',?1)",
        [serde_json::to_string(&messages).unwrap()],
    )
    .unwrap();
    (conn, messages)
}
fn insert(conn: &Connection, id: i64, parent: Option<i64>, messages: &[Message], boundary: usize) {
    let source = source_digest(messages, boundary, OLD_SOURCE).unwrap();
    let system = system_digest(messages, OLD_PROMPT, 1).unwrap();
    conn.execute(
        "INSERT INTO orchestrator_compaction_checkpoints(id,session_id,previous_checkpoint_id,summary,tail_start_message_index,source_prefix_sha256,system_policy_sha256,prompt_policy_version) VALUES(?1,'s',?2,?3,?4,?5,?6,1)",
        params![
            id,
            parent,
            format!("{HISTORY_PREFIX}summary"),
            boundary,
            source.as_slice(),
            system.as_slice()
        ],
    )
    .unwrap();
}
fn evidence(conn: &Connection, id: i64) -> (Vec<u8>, Vec<u8>, i64, String) {
    conn.query_row("SELECT source_prefix_sha256,system_policy_sha256,prompt_policy_version,summary FROM orchestrator_compaction_checkpoints WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap()
}

#[test]
fn rehash_only_verified_old_evidence_and_preserve_newest_invalid_fallback() {
    let (conn, messages) = fixture();
    insert(&conn, 1, None, &messages, 2);
    insert(&conn, 2, Some(1), &messages, 3);
    conn.execute("UPDATE orchestrator_compaction_checkpoints SET source_prefix_sha256=zeroblob(32) WHERE id=2",[]).unwrap();
    let invalid = evidence(&conn, 2);
    rehash_v54_checkpoints(&conn, "new policy", 2).unwrap();
    assert_eq!(evidence(&conn, 2), invalid);
    let valid = evidence(&conn, 1);
    assert_eq!(valid.0, source_digest(&messages, 2, NEW_SOURCE).unwrap());
    assert_eq!(valid.1, system_digest(&messages, "new policy", 2).unwrap());
    assert_eq!(valid.2, 2);
    assert_eq!(valid.3, format!("{HISTORY_PREFIX}summary"));
    let original: String = conn
        .query_row(
            "SELECT messages_json FROM sessions WHERE session_id='s'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(original.contains("orchestrator is user text"));
}

#[test]
fn stale_policy_and_repaired_or_untrusted_transcripts_stay_unchanged() {
    for mutation in [
        "UPDATE orchestrator_compaction_checkpoints SET prompt_policy_version=7",
        "UPDATE orchestrator_compaction_checkpoints SET system_policy_sha256=zeroblob(32)",
        "UPDATE orchestrator_compaction_checkpoints SET summary='bad summary'",
        "UPDATE sessions SET messages_json='[{\"role\":\"system\",\"content\":\"system\"}]'",
    ] {
        let (conn, messages) = fixture();
        insert(&conn, 1, None, &messages, 2);
        conn.execute_batch(mutation).unwrap();
        let original = evidence(&conn, 1);
        rehash_v54_checkpoints(&conn, "new policy", 2).unwrap();
        assert_eq!(evidence(&conn, 1), original, "{mutation}");
    }
    let (conn, messages) = fixture();
    insert(&conn, 1, None, &messages, 2);
    let entry = super::super::super::transcript::encode_transcript_log_entry(
        5,
        &Message::User {
            content: "gap".into(),
        },
    )
    .unwrap();
    conn.execute(
        "INSERT INTO thread_events VALUES(1,'s','__orchestrator__',?1)",
        [entry],
    )
    .unwrap();
    rehash_v54_checkpoints(&conn, "new policy", 2).unwrap();
    assert_eq!(
        evidence(&conn, 1).2,
        2,
        "verified prefix remains usable before a gap"
    );
}

#[test]
fn contradictory_chain_and_invalid_structural_rows_fail() {
    let (conn, messages) = fixture();
    insert(&conn, 1, Some(99), &messages, 2);
    assert!(rehash_v54_checkpoints(&conn, "new policy", 2).is_err());
    conn.execute("UPDATE orchestrator_compaction_checkpoints SET previous_checkpoint_id=NULL,source_prefix_sha256=x'01'",[]).unwrap();
    assert!(rehash_v54_checkpoints(&conn, "new policy", 2).is_err());
    conn.execute("UPDATE orchestrator_compaction_checkpoints SET source_prefix_sha256=zeroblob(32),old_context_estimate=?1", [(crate::MAX_SUPPORTED_TOKEN_COUNT + 1) as i64]).unwrap();
    assert!(rehash_v54_checkpoints(&conn, "new policy", 2).is_err());
}

#[test]
fn selection_manifest_validation_rejects_tampering() {
    let reference = TerminalSelectionReference {
        message_index: 1,
        attribution: super::super::super::TerminalSelectionAttribution {
            protocol_version: 1,
            intent_sha256: "a".repeat(64),
            source_kind:
                super::super::super::TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
            admission_id: "a".into(),
            capture_id: "b".into(),
            source_session_id: "s".into(),
            terminal_id: "t".into(),
            owner_instance_id: "o".into(),
            client_capture_time_ms: None,
        },
    };
    let source = TerminalSelectionProvenance {
        count: 1,
        digest: "b".repeat(64),
        recent: vec![reference.clone()],
    };
    let json = serde_json::to_string(&Manifest {
        version: 1,
        boundary: 2,
        total: 1,
        digest: source.digest.clone(),
        omitted: 0,
        recent: vec![reference],
    })
    .unwrap();
    let summary = format!("{HISTORY_PREFIX}{SELECTION_PREFIX}{json}\n\nsummary");
    assert!(selection_summary_valid(&summary, &source, 2));
    assert!(!selection_summary_valid(&summary, &source, 3));
    assert!(!selection_summary_valid(
        &summary.replace(&source.digest, &"c".repeat(64)),
        &source,
        2
    ));
}

#[test]
fn digest_contract_matches_current_runtime() {
    let (_, messages) = fixture();
    let (source, system) =
        crate::agent::direct_compaction_checkpoint_digests_for_test(&messages, 2);
    let version = crate::agent::DIRECT_COMPACTION_PROMPT_POLICY_VERSION_FOR_TEST;
    let domain = if version == 1 { OLD_SOURCE } else { NEW_SOURCE };
    assert_eq!(source, source_digest(&messages, 2, domain).unwrap());
    assert_eq!(
        system,
        system_digest(
            &messages,
            include_str!("../../agent/prompts/nac_direct_compaction.md"),
            version
        )
        .unwrap()
    );
}

#[test]
fn transaction_rollback_restores_previously_translated_evidence() {
    let (conn, messages) = fixture();
    insert(&conn, 1, None, &messages, 2);
    insert(&conn, 2, Some(1), &messages, 3);
    let first = evidence(&conn, 1);
    let second = evidence(&conn, 2);
    conn.execute_batch("CREATE TRIGGER reject_second BEFORE UPDATE ON orchestrator_compaction_checkpoints WHEN NEW.id=2 BEGIN SELECT RAISE(ABORT,'injected'); END; BEGIN IMMEDIATE;").unwrap();
    assert!(rehash_v54_checkpoints(&conn, "new policy", 2).is_err());
    conn.execute_batch("ROLLBACK").unwrap();
    assert_eq!(evidence(&conn, 1), first);
    assert_eq!(evidence(&conn, 2), second);
}

#[test]
fn incomplete_tool_boundary_remains_ineligible() {
    let (conn, _) = fixture();
    let messages: Vec<Message>=serde_json::from_str(r#"[{"role":"system","content":"system"},{"role":"assistant","content":null,"tool_calls":[{"id":"call","type":"function","function":{"name":"read","arguments":"{}"}}]},{"role":"user","content":"invalid boundary"}]"#).unwrap();
    conn.execute(
        "UPDATE sessions SET messages_json=?1",
        [serde_json::to_string(&messages).unwrap()],
    )
    .unwrap();
    insert(&conn, 1, None, &messages, 2);
    let original = evidence(&conn, 1);
    rehash_v54_checkpoints(&conn, "new policy", 2).unwrap();
    assert_eq!(evidence(&conn, 1), original);
}

#[test]
fn verified_selection_evidence_is_rehashed_and_tampering_is_inert() {
    use super::super::super::{
        TerminalSelectionAttribution, TerminalSelectionDelivery, TerminalSelectionIntent,
        TerminalSelectionSourceKind,
    };
    let (conn, _) = fixture();
    conn.execute(
        "UPDATE sessions SET messages_json='[]' WHERE session_id='s'",
        [],
    )
    .unwrap();
    let intent = TerminalSelectionIntent {
        protocol_version: 1,
        source_kind: TerminalSelectionSourceKind::UserSuppliedRenderedSelection,
        admission_id: uuid::Uuid::new_v4().to_string(),
        capture_id: uuid::Uuid::new_v4().to_string(),
        source_session_id: "s".into(),
        terminal_id: "terminal".into(),
        owner_instance_id: uuid::Uuid::new_v4().to_string(),
        client_capture_time_ms: None,
        text: "literal orchestrator evidence".into(),
        user_text: None,
        initial_delivery: TerminalSelectionDelivery::Queue,
        initial_expected_run_id: None,
    };
    let message = Message::User {
        content: intent.envelope().unwrap(),
    };
    let attribution = TerminalSelectionAttribution {
        protocol_version: 1,
        intent_sha256: intent.digest().unwrap(),
        source_kind: intent.source_kind.clone(),
        admission_id: intent.admission_id.clone(),
        capture_id: intent.capture_id.clone(),
        source_session_id: intent.source_session_id.clone(),
        terminal_id: intent.terminal_id.clone(),
        owner_instance_id: intent.owner_instance_id.clone(),
        client_capture_time_ms: None,
    };
    let encoded =
        super::super::super::transcript::encode_transcript_log_entry(0, &message).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    value["nac_transcript_message"]["terminal_selection_attribution"] =
        serde_json::to_value(attribution).unwrap();
    conn.execute(
        "INSERT INTO thread_events VALUES(1,'s','__orchestrator__',?1)",
        [serde_json::to_string(&value).unwrap()],
    )
    .unwrap();
    let messages = vec![message];
    let source = super::super::super::transcript_selection::v54_provenance(
        &conn,
        "s",
        1,
        V54_SELECTION_QUERY,
    )
    .unwrap();
    assert_eq!(source.count, 1);
    let summary = format!(
        "{HISTORY_PREFIX}{SELECTION_PREFIX}{}\n\nsummary",
        serde_json::to_string(&Manifest {
            version: 1,
            boundary: 1,
            total: 1,
            digest: source.digest.clone(),
            omitted: 0,
            recent: source.recent.clone()
        })
        .unwrap()
    );
    let old = with_selection(source_digest(&messages, 1, OLD_SOURCE).unwrap(), &source);
    let system = system_digest(&messages, OLD_PROMPT, 1).unwrap();
    conn.execute(
        "INSERT INTO orchestrator_compaction_checkpoints(id,session_id,previous_checkpoint_id,summary,tail_start_message_index,source_prefix_sha256,system_policy_sha256,prompt_policy_version) VALUES(1,'s',NULL,?1,1,?2,?3,1)",
        params![summary, old.as_slice(), system.as_slice()],
    )
    .unwrap();
    conn.execute_batch("SAVEPOINT selection_test").unwrap();
    value["nac_transcript_message"]["terminal_selection_attribution"]["intent_sha256"] =
        serde_json::Value::String("0".repeat(64));
    conn.execute(
        "UPDATE thread_events SET event_json=?1 WHERE id=1",
        [serde_json::to_string(&value).unwrap()],
    )
    .unwrap();
    let original = evidence(&conn, 1);
    rehash_v54_checkpoints(&conn, "new policy", 2).unwrap();
    assert_eq!(evidence(&conn, 1), original);
    conn.execute_batch("ROLLBACK TO selection_test; RELEASE selection_test")
        .unwrap();
    rehash_v54_checkpoints(&conn, "new policy", 2).unwrap();
    assert_eq!(
        evidence(&conn, 1).0,
        with_selection(source_digest(&messages, 1, NEW_SOURCE).unwrap(), &source)
    );
}
