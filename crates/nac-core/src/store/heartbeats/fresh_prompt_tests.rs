//! Skill expansion must not change the durable initial-input delivery identity.
use super::fresh_tests::{prepared_shared_snapshot, Fixture};
use super::*;
use crate::skills::{SkillRecord, SkillRegistry};
use crate::store::transcript_append::AppendFault;
use crate::types::Message;

#[path = "quiet_completion_tests.rs"]
mod quiet_completion_tests;

struct InitialPrompt {
    fixture: Fixture,
    inbox: AdmittedInboxPrompt,
    message: Message,
    run: String,
    occurrence: HeartbeatOccurrence,
}

#[test]
fn join_expanded_fresh_input_terminal_completion_survives_lost_ack_once() {
    let f = initial_prompt();
    let session = f.inbox.session_id.as_str();
    let cutoff = read_completion_page(&f.fixture.path, None).unwrap().cursor;
    let writer = TranscriptLogWriter::new(&f.fixture.path).unwrap();
    *writer.append_fault.lock().unwrap() = Some((AppendFault::AfterCommitBeforeAck, 1));
    assert!(writer
        .append_admitted_inbox_run_prompt(session, 0, &f.message, &f.run, &f.inbox)
        .is_err());
    drop(writer);
    let writer = TranscriptLogWriter::new(&f.fixture.path).unwrap();
    writer
        .append_admitted_inbox_run_prompt(session, 0, &f.message, &f.run, &f.inbox)
        .unwrap();
    assert_eq!(writer.read_from(session, 0).unwrap().len(), 1);
    let conn = open_runtime_connection(&f.fixture.path).unwrap();
    let binding: (String, i64) = conn
        .query_row(
            "SELECT run_id,submitted_message_id FROM session_completion_bindings WHERE session_id=?1",
            [session],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(binding.0, f.run);
    assert!(binding.1 > 0);
    drop(conn);
    let terminal = terminal_update(&f);
    for _ in 0..2 {
        crate::sessions::save_session_run_state(&f.fixture.path, &terminal).unwrap();
        initialize(&f.fixture.path).unwrap();
    }
    let page = read_completion_page(&f.fixture.path, Some(&cutoff)).unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].session_id, session);
    assert_eq!(page.items[0].run_id, f.run);
    assert_eq!(page.items[0].kind, CompletionKind::Request);
    let input = load_session_inbox_item(&f.fixture.path, session, f.inbox.id).unwrap();
    assert_eq!(input.status, InboxStatus::Delivered);
    assert_eq!(input.content, f.inbox.content);
    assert_eq!(input.version, f.inbox.version + 1);
    let history = heartbeat_history(
        &f.fixture.path,
        "project:project",
        &f.occurrence.schedule_id,
    )
    .unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].run_id.as_deref(), Some(f.run.as_str()));
    assert_eq!(history[0].attempt_count, 1);
    assert_eq!(list_heartbeats(&f.fixture.path, None).unwrap()[0].starts, 1);
}

fn terminal_update(f: &InitialPrompt) -> crate::sessions::SessionRunStateUpdate {
    crate::sessions::SessionRunStateUpdate {
        session_id: f.inbox.session_id.clone(),
        ssh: None,
        sandbox_spec: None,
        run_state: crate::sessions::SessionRunState::default(),
        finished_run_id: Some(f.run.clone()),
        finished_run_disposition: Some(RunTerminalDisposition::Completed),
        failed_run_id: None,
        failed_run_failure: None,
        goal_settlement: None,
        heartbeat_settlement: None,
        finished_run_result: Some("retained scheduled result".into()),
        updated_at: now_utc(),
    }
}

#[test]
fn join_classified_unchanged_fresh_run_stays_quiet_in_completion_feed() {
    for outcome in [HeartbeatOutcome::Meaningful, HeartbeatOutcome::Unchanged] {
        let f = initial_prompt();
        let session = f.inbox.session_id.as_str();
        let cutoff = read_completion_page(&f.fixture.path, None).unwrap().cursor;
        TranscriptLogWriter::new(&f.fixture.path)
            .unwrap()
            .append_admitted_inbox_run_prompt(session, 0, &f.message, &f.run, &f.inbox)
            .unwrap();
        heartbeat_report(
            &f.fixture.path,
            session,
            &f.occurrence.occurrence_id,
            &f.run,
            f.occurrence.generation.as_deref().unwrap(),
            f.occurrence.revision,
            outcome,
            "Exact retained initial-run classification.",
        )
        .unwrap();
        let mut terminal = terminal_update(&f);
        terminal.heartbeat_settlement = Some(HeartbeatRunSettlement {
            tokens_used: Some(3),
            duration_ms: 10,
            terminal_at_epoch_ms: 63_000,
            needs_human_action: false,
        });
        crate::sessions::save_session_run_state(&f.fixture.path, &terminal).unwrap();
        let history = heartbeat_history(
            &f.fixture.path,
            "project:project",
            &f.occurrence.schedule_id,
        )
        .unwrap();
        assert_eq!(history[0].outcome, Some(outcome));
        assert_eq!(history[0].run_id.as_deref(), Some(f.run.as_str()));
        let page = read_completion_page(&f.fixture.path, Some(&cutoff)).unwrap();
        assert_eq!(
            page.items.len(),
            usize::from(outcome != HeartbeatOutcome::Unchanged),
            "canonical Unchanged must not become a generic native completion"
        );
    }
}

fn initial_prompt() -> InitialPrompt {
    let mut f = Fixture::new();
    f.binding.fresh_task.as_mut().unwrap().default_ref = None;
    let mut spec = super::tests::spec();
    spec.instructions = "Inspect with $verification and retain the result.".into();
    spec.skills = vec!["verification".into()];
    control_heartbeat(
        &f.path,
        "project:project",
        &uuid::Uuid::new_v4().to_string(),
        &HeartbeatAction::Create { spec },
        "Create the skill-aware fixture.",
        &f.binding,
        1_000,
    )
    .unwrap();
    let pending = materialize_heartbeats(&f.path, 61_000).unwrap().remove(0);
    let prepared =
        reserve_fresh_heartbeat_launch(&f.path, &pending.occurrence_id, pending.revision, 61_000)
            .unwrap()
            .unwrap();
    pin_fresh_heartbeat_workspace_mode(&f.path, &pending.occurrence_id, true).unwrap();
    let snapshot = prepared_shared_snapshot(&f, &prepared);
    {
        let mut conn = open_runtime_connection(&f.path).unwrap();
        let tx = conn.transaction().unwrap();
        crate::sessions::insert_new_session_in_transaction(&tx, &f.path, &snapshot).unwrap();
        publish_shared_fresh_launch_with_connection(
            &tx,
            &prepared.receipt().request.request_id,
            &snapshot,
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let published = heartbeat_history(&f.path, "project:project", &pending.schedule_id)
        .unwrap()
        .remove(0);
    let input = load_session_inbox_item(
        &f.path,
        &snapshot.session_id,
        published.inbox_item_id.unwrap(),
    )
    .unwrap();
    let registry = SkillRegistry::load_for_test(vec![SkillRecord {
        name: "verification".into(),
        description: "Inspect the fixture.".into(),
        compatibility: None,
        skill_root_visible: f.root.join("verification"),
        body: "FRESH_SKILL_TOKEN: inspect and retain evidence.".into(),
        resources: Vec::new(),
    }]);
    let expanded = crate::commands::expand_user_prompt(&input.content, Some(&registry));
    assert_ne!(expanded, input.content);
    assert!(expanded.contains("FRESH_SKILL_TOKEN"));
    let run = uuid::Uuid::new_v4().to_string();
    let occurrence = admit_heartbeat(
        &f.path,
        &snapshot.session_id,
        &pending.occurrence_id,
        published.revision,
        &run,
        &pending.receipt_id,
        &expanded,
        f.root.to_str().unwrap(),
        62_000,
    )
    .unwrap()
    .unwrap();
    InitialPrompt {
        fixture: f,
        inbox: input.into(),
        message: Message::User { content: expanded },
        run,
        occurrence,
    }
}

#[test]
fn expanded_fresh_prompt_keeps_raw_inbox_cas_and_once_only_restart_delivery() {
    for phase in [AppendFault::BeforeCommit, AppendFault::AfterCommitBeforeAck] {
        let f = initial_prompt();
        let writer = TranscriptLogWriter::new(&f.fixture.path).unwrap();
        // The original path reproduces the hosted failure with real expansion.
        assert!(writer
            .append_inbox_run_prompt(&f.inbox.session_id, 0, &f.message, &f.run, f.inbox.id)
            .is_err());
        assert!(writer.read_from(&f.inbox.session_id, 0).unwrap().is_empty());
        *writer.append_fault.lock().unwrap() = Some((phase, 1));
        assert!(writer
            .append_admitted_inbox_run_prompt(&f.inbox.session_id, 0, &f.message, &f.run, &f.inbox)
            .is_err());
        let before_restart =
            load_session_inbox_item(&f.fixture.path, &f.inbox.session_id, f.inbox.id).unwrap();
        if matches!(phase, AppendFault::BeforeCommit) {
            assert_eq!(before_restart.status, InboxStatus::Pending);
            assert_eq!(before_restart.version, f.inbox.version);
            assert!(writer.read_from(&f.inbox.session_id, 0).unwrap().is_empty());
        } else {
            assert_eq!(before_restart.status, InboxStatus::Delivered);
        }
        drop(writer);
        let restarted = TranscriptLogWriter::new(&f.fixture.path).unwrap();
        for _ in 0..2 {
            restarted
                .append_admitted_inbox_run_prompt(
                    &f.inbox.session_id,
                    0,
                    &f.message,
                    &f.run,
                    &f.inbox,
                )
                .unwrap();
        }
        let transcript = restarted.read_from(&f.inbox.session_id, 0).unwrap();
        assert_eq!(transcript.len(), 1);
        assert_eq!(
            serde_json::to_value(&transcript[0].1).unwrap(),
            serde_json::to_value(&f.message).unwrap()
        );
        let delivered = list_session_inbox(&f.fixture.path, &f.inbox.session_id).unwrap();
        assert_eq!(delivered.len(), 1);
        assert_eq!(delivered[0].content, f.inbox.content);
        assert_eq!(delivered[0].version, f.inbox.version + 1);
        assert_eq!(
            delivered[0].delivered_run_id.as_deref(),
            Some(f.run.as_str())
        );
        let history = heartbeat_history(
            &f.fixture.path,
            "project:project",
            &f.occurrence.schedule_id,
        )
        .unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].run_id.as_deref(), Some(f.run.as_str()));
        assert_eq!(history[0].attempt_count, 1);
        assert_eq!(history[0].revision, f.occurrence.revision);
        assert_eq!(list_heartbeats(&f.fixture.path, None).unwrap()[0].starts, 1);
    }
}

#[test]
fn expanded_fresh_prompt_rejects_changed_revision_content_session_and_occurrence() {
    for change in ["content", "revision", "session", "item", "run", "settled"] {
        let mut f = initial_prompt();
        let mut conn = open_runtime_connection(&f.fixture.path).unwrap();
        match change {
            "content" => {
                conn.execute(
                    "UPDATE session_inbox SET content='changed' WHERE id=?1",
                    [f.inbox.id],
                )
                .unwrap();
            }
            // ABA: unchanged content is insufficient after another revision.
            "revision" => {
                conn.execute(
                    "UPDATE session_inbox SET version=version+1 WHERE id=?1",
                    [f.inbox.id],
                )
                .unwrap();
            }
            "session" => f.inbox.session_id = "creator".into(),
            "item" => {
                f.inbox = create_session_inbox_item(
                    &f.fixture.path,
                    &f.inbox.session_id,
                    InboxDelivery::Queue,
                    &f.inbox.content,
                    None,
                    None,
                )
                .unwrap()
                .into()
            }
            "run" => f.run = uuid::Uuid::new_v4().to_string(),
            "settled" => {
                let tx = conn.transaction().unwrap();
                settle_heartbeat_with_connection(
                    &tx,
                    f.occurrence.execution_session_id().unwrap(),
                    &f.run,
                    HeartbeatOutcome::Interrupted,
                    Some(0),
                    0,
                    63_000,
                )
                .unwrap();
                tx.commit().unwrap();
            }
            _ => unreachable!(),
        }
        let session = f.occurrence.execution_session_id().unwrap();
        let writer = TranscriptLogWriter::new(&f.fixture.path).unwrap();
        assert!(
            writer
                .append_admitted_inbox_run_prompt(session, 0, &f.message, &f.run, &f.inbox)
                .is_err(),
            "accepted {change}"
        );
        assert!(writer.read_from(session, 0).unwrap().is_empty());
        assert_eq!(
            load_session_inbox_item(&f.fixture.path, session, f.inbox.id)
                .unwrap()
                .status,
            InboxStatus::Pending
        );
        assert!(load_run_recovery(&f.fixture.path, session)
            .unwrap()
            .is_none());
    }
}
