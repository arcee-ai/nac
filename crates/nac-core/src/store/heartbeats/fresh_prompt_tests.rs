//! Skill expansion must not change the durable initial-input delivery identity.
use super::fresh_tests::{prepared_shared_snapshot, Fixture};
use super::*;
use crate::skills::{SkillRecord, SkillRegistry};
use crate::store::transcript_append::AppendFault;
use crate::types::Message;

struct InitialPrompt {
    fixture: Fixture,
    inbox: AdmittedInboxPrompt,
    message: Message,
    run: String,
    occurrence: HeartbeatOccurrence,
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
