//! The summarized prefix is re-verified only when the transcript generation
//! changes; frame checks still run on every call.
use super::super::*;
use super::{assistant, state, temp_store_path, user};

use crate::agent::TranscriptMessages;
use crate::store;
use crate::store::orchestrator_compaction::{
    append_orchestrator_compaction_checkpoint, NewOrchestratorCompactionCheckpoint,
};
use crate::types::{Message, ToolContent};

fn prefix_digests() -> usize {
    super::super::planning::PREFIX_DIGESTS.with(std::cell::Cell::get)
}

/// A store with one valid checkpoint over `messages[..boundary]`, restored.
fn restored(
    label: &str,
    messages: &[Message],
    boundary: usize,
) -> (std::path::PathBuf, CompactionState) {
    let path = temp_store_path(label);
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let (source, policy) = checkpoint_digests(messages, boundary);
    append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("summary"),
            tail_start_message_index: boundary,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 500,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(messages).unwrap();
    assert!(state.active_checkpoint_for_test().is_some());
    (path, state)
}

#[test]
fn appended_turns_reuse_the_verified_prefix() {
    let messages = vec![user("old"), assistant("answer"), user("recent")];
    let (path, mut state) = restored("reuse", &messages, 2);
    let mut transcript = TranscriptMessages::from(messages);
    assert!(!state.is_passthrough(&transcript));
    let verified = prefix_digests();
    for turn in 0..5 {
        transcript.push(assistant(&format!("reply {turn}")));
        transcript.push(user(&format!("next {turn}")));
        assert!(!state.is_passthrough(&transcript));
        let checkpoint_id = state
            .active_checkpoint_for_test()
            .map(|checkpoint| checkpoint.id);
        let prepared = state
            .plan(&transcript, &[], CompactionReason::Auto)
            .prepared;
        assert_eq!(prepared.checkpoint_id, checkpoint_id);
        state.record_ordinary_context(&transcript, 50, transcript.len(), checkpoint_id);
    }
    assert_eq!(
        prefix_digests(),
        verified,
        "appended turns re-hashed the summarized prefix"
    );
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn an_edit_inside_the_summarized_prefix_is_still_caught() {
    let messages = vec![user("old"), assistant("answer"), user("recent")];
    for edit in ["replace", "truncate and re-append"] {
        let (path, mut state) = restored("edited", &messages, 2);
        let mut transcript = TranscriptMessages::from(messages.clone());
        assert!(!state.is_passthrough(&transcript));
        match edit {
            "replace" => transcript[0] = user("rewritten history"),
            _ => {
                transcript.truncate(1);
                transcript.push(assistant("a different answer"));
                transcript.push(user("recent"));
            }
        }
        assert!(
            state.is_passthrough(&transcript),
            "{edit} kept the checkpoint"
        );
        assert!(state.active_checkpoint_for_test().is_none());
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
}

#[test]
fn frame_checks_still_see_messages_appended_after_the_prefix() {
    // With the boundary at the end, the next message must still start a turn.
    let messages = vec![user("old"), assistant("answer")];
    let (path, mut state) = restored("frame", &messages, 2);
    let mut transcript = TranscriptMessages::from(messages);
    assert!(!state.is_passthrough(&transcript));
    transcript.push(Message::Tool {
        tool_call_id: "orphan".to_string(),
        content: ToolContent::text("result without a call"),
    });
    assert!(state.is_passthrough(&transcript));
    assert!(state.active_checkpoint_for_test().is_none());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
