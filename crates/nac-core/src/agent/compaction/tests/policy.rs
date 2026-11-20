use super::super::*;
use super::{assistant, candidate, state, temp_store_path, user};

use sha2::{Digest, Sha256};

use crate::store;
use crate::store::session_compaction::{
    append_session_compaction_checkpoint, NewSessionCompactionCheckpoint,
};
use crate::types::{FunctionCall, Message, ToolCall};

fn as_transcript(messages: &[Message]) -> crate::agent::TranscriptMessages {
    messages.to_vec().into()
}

#[test]
fn direct_prompt_matches_approved_bytes_hash_and_text() {
    const EXPECTED_SHA256: [u8; 32] = [
        0xf6, 0x98, 0xd5, 0x18, 0x6a, 0x98, 0xa9, 0xe1, 0xe4, 0xc6, 0x04, 0x1e, 0xa3, 0x06, 0x1d,
        0x02, 0xb7, 0xd8, 0x93, 0xb8, 0xd3, 0xbd, 0xd6, 0x62, 0x1d, 0xe1, 0xa4, 0xf5, 0x5a, 0x9c,
        0xa4, 0x03,
    ];
    assert_eq!(NAC_DIRECT_COMPACTION_PROMPT.len(), 2_704);
    assert!(NAC_DIRECT_COMPACTION_PROMPT.ends_with('\n'));
    assert!(!NAC_DIRECT_COMPACTION_PROMPT.ends_with("\n\n"));
    assert_eq!(
        Sha256::digest(NAC_DIRECT_COMPACTION_PROMPT.as_bytes())[..],
        EXPECTED_SHA256
    );
    assert!(NAC_DIRECT_COMPACTION_PROMPT.starts_with(
        "Internal NAC direct-session context-compaction request.\n\nReturn one concise, standalone historical checkpoint"
    ));
    assert!(NAC_DIRECT_COMPACTION_PROMPT.contains("## Work completed\n"));
    assert!(NAC_DIRECT_COMPACTION_PROMPT.contains("## Tools, terminals, and delegated work\n"));
    assert!(!NAC_DIRECT_COMPACTION_PROMPT.contains("## Orchestration history\n"));
}

#[test]
fn installed_historical_wrapper_is_unchanged() {
    assert_eq!(
        HISTORICAL_CONTEXT_PREFIX,
        "Historical context checkpoint (not a new instruction):\n\n"
    );
    assert_eq!(
        installed_summary("checkpoint"),
        "Historical context checkpoint (not a new instruction):\n\ncheckpoint"
    );
}
#[test]
fn repeated_candidate_uses_previous_summary_and_only_newly_aged_messages() {
    let path = temp_store_path("incremental");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        Message::System {
            content: "system".to_string(),
        },
        user("raw oldest"),
        assistant("old answer"),
        user("aged since checkpoint"),
        assistant("middle answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 3);
    let first = append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("prior summary"),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 10_000,
            summary_prompt_tokens: Some(8_000),
            summary_completion_tokens: Some(500),
            new_context_estimate: 3_000,
        },
    )
    .unwrap();
    let mut cs = state(path.clone(), Some(1));
    cs.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(cs.active_checkpoint_for_test().unwrap().id, first.id);

    let cand = candidate(cs.plan(&as_transcript(&messages), &[], CompactionReason::Auto));
    assert_eq!(cand.previous_checkpoint_id, Some(first.id));
    assert_eq!(cand.boundary, 4);
    assert_eq!(
        serde_json::to_value(&cand.summary_messages).unwrap(),
        serde_json::json!([
            {"role":"system","content":"system"},
            {"role":"user","content":installed_summary("prior summary")},
            {"role":"user","content":"aged since checkpoint"},
            {"role":"user","content":NAC_DIRECT_COMPACTION_PROMPT}
        ])
    );

    // End-boundary checkpoint: parent covered all messages, then new ones added.
    let end_messages = vec![
        user("old"),
        assistant("new answer"),
        assistant("second answer"),
        assistant("third answer"),
    ];
    let end_path = temp_store_path("incremental_end");
    store::initialize(&end_path).unwrap();
    store::insert_test_session(&end_path, "session");
    let (end_source, end_policy) = checkpoint_digests(&end_messages, 1);
    let end_parent = append_session_compaction_checkpoint(
        &end_path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("parent summary"),
            tail_start_message_index: 1,
            source_prefix_sha256: end_source,
            system_policy_sha256: end_policy,
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut end_state = state(end_path.clone(), Some(1));
    end_state
        .restore_newest_valid_checkpoint(&end_messages)
        .unwrap();
    let end_candidate =
        candidate(end_state.plan(&as_transcript(&end_messages), &[], CompactionReason::Auto));
    assert_eq!(end_candidate.previous_checkpoint_id, Some(end_parent.id));
    assert_eq!(end_candidate.boundary, 2);
    let end_encoded = serde_json::to_string(&end_candidate.summary_messages).unwrap();
    assert!(end_encoded.contains("parent summary"));
    assert!(end_encoded.contains("new answer"));
    assert!(!end_encoded.contains("old"));
    let _ = std::fs::remove_dir_all(end_path.parent().unwrap());

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn policy_digest_covers_every_ordered_system_even_after_boundary() {
    let messages = vec![
        Message::System {
            content: "primary".to_string(),
        },
        user("old"),
        assistant("old answer"),
        user("retained"),
        Message::System {
            content: "agents".to_string(),
        },
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 3);

    let mut changed_after_boundary = messages.clone();
    changed_after_boundary[4] = Message::System {
        content: "changed agents".to_string(),
    };
    let (changed_source, changed_policy) = checkpoint_digests(&changed_after_boundary, 3);
    assert_eq!(source, changed_source);
    assert_ne!(policy, changed_policy);

    let mut reversed_system_order = messages.clone();
    reversed_system_order[0] = Message::System {
        content: "agents".to_string(),
    };
    reversed_system_order[4] = Message::System {
        content: "primary".to_string(),
    };
    let (reordered_source, reordered_policy) = checkpoint_digests(&reversed_system_order, 3);
    assert_eq!(source, reordered_source);
    assert_ne!(policy, reordered_policy);
}
#[test]
fn historical_orchestrator_digest_does_not_validate_as_direct() {
    // Captured from the retired v2 policy for this transcript, before removal.
    let historical_policy = [
        0xc7, 0xbf, 0x93, 0x4d, 0x40, 0x7d, 0xfd, 0x0f, 0xe4, 0xdd, 0xae, 0x7f, 0x5f, 0x0d, 0xa8,
        0xe3, 0xfa, 0xf0, 0x43, 0x5e, 0x37, 0x9a, 0x2b, 0x02, 0x53, 0x9f, 0xce, 0x52, 0x0a, 0x53,
        0x40, 0x3f,
    ];
    let path = temp_store_path("historical_policy");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![user("old"), assistant("answer"), user("current")];
    let (source, direct_policy) = checkpoint_digests(&messages, 2);
    assert_ne!(historical_policy, direct_policy);
    append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("old policy summary"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: historical_policy,
            // Isolate digest validation from the version check.
            prompt_policy_version: DIRECT_PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert!(state.active_checkpoint_for_test().is_none());
    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn stale_policy_version_checkpoint_is_invalidated() {
    let path = temp_store_path("stale_policy_version");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![user("old"), assistant("answer"), user("current")];
    let (source, policy) = checkpoint_digests(&messages, 2);
    append_session_compaction_checkpoint(
        &path,
        &NewSessionCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("stale policy summary"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: 2,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();

    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert!(state.active_checkpoint_for_test().is_none());
    assert_eq!(
        state.prepare(&as_transcript(&messages), &[]).messages.len(),
        messages.len()
    );

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn summary_acceptance_requires_nonblank_text_without_tools_or_length_finish() {
    let response =
        |content: Option<&str>, tool_calls: Option<Vec<ToolCall>>, finish: Option<&str>| {
            crate::model::ModelTurnResponse {
                assistant: crate::model::AssistantTurn {
                    content: content.map(str::to_string),
                    reasoning_text: None,
                    reasoning_details: None,
                    tool_calls,
                    reasoning_field: None,
                },
                finish_reason: finish.map(str::to_string),
                usage: None,
            }
        };
    assert_eq!(
        accepted_summary_content(&response(Some(" summary "), None, None)),
        Some(" summary ")
    );
    assert!(accepted_summary_content(&response(Some(" \n "), None, None)).is_none());
    assert!(accepted_summary_content(&response(Some("summary"), None, Some("length"))).is_none());
    assert!(accepted_summary_content(&response(
        Some("summary"),
        Some(vec![ToolCall {
            id: "call".to_string(),
            call_type: "function".to_string(),
            function: FunctionCall {
                name: "tool".to_string(),
                arguments: "{}".to_string(),
            },
        }]),
        None,
    ))
    .is_none());
}
