use super::super::*;
use super::{assistant, candidate, state, user, StoreFixture};

use sha2::{Digest, Sha256};

use crate::store::orchestrator_compaction::{
    append_orchestrator_compaction_checkpoint, NewOrchestratorCompactionCheckpoint,
};
use crate::types::{FunctionCall, Message, ToolCall};

#[test]
fn nac_prompt_matches_approved_bytes_hash_and_text() {
    const EXPECTED_SHA256: [u8; 32] = [
        0xdf, 0x7d, 0xa7, 0xf9, 0xa9, 0xff, 0xa5, 0x8a, 0x6d, 0x3d, 0xb5, 0xf9, 0xac, 0xc7, 0xa1,
        0x22, 0x25, 0xc6, 0x6f, 0x51, 0xce, 0xe9, 0x86, 0x17, 0xbf, 0xab, 0x62, 0x32, 0x38, 0x4c,
        0x37, 0x25,
    ];
    assert_eq!(NAC_COMPACTION_PROMPT.len(), 2_817);
    assert!(NAC_COMPACTION_PROMPT.ends_with('\n'));
    assert!(!NAC_COMPACTION_PROMPT.ends_with("\n\n"));
    assert_eq!(
        Sha256::digest(NAC_COMPACTION_PROMPT.as_bytes())[..],
        EXPECTED_SHA256
    );
    assert!(NAC_COMPACTION_PROMPT.starts_with(
        "Internal NAC context-compaction request.\n\nReturn one concise, standalone historical checkpoint"
    ));
    assert!(NAC_COMPACTION_PROMPT.contains("## Orchestration history\n"));
    assert!(NAC_COMPACTION_PROMPT.contains("## State at the end of the supplied history\n"));
    assert!(NAC_COMPACTION_PROMPT.ends_with(
        "Omit empty sections, routine operations, raw logs, hidden reasoning, low-value IDs, repeated chronology, and unsupported claims.\n"
    ));
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
    let store = StoreFixture::new("incremental");
    let path = &store.path;
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
    let first = append_orchestrator_compaction_checkpoint(
        path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("prior summary"),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 10_000,
            summary_prompt_tokens: Some(8_000),
            summary_completion_tokens: Some(500),
            new_context_estimate: 3_000,
        },
    )
    .unwrap();
    let mut cs = state(path.to_path_buf(), Some(1));
    cs.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(cs.active_checkpoint_for_test().unwrap().id, first.id);

    let cand = candidate(cs.plan(&messages, &[], CompactionReason::Auto));
    assert_eq!(cand.previous_checkpoint_id, Some(first.id));
    assert_eq!(cand.boundary, 4);
    assert_eq!(
        serde_json::to_value(&cand.summary_messages).unwrap(),
        serde_json::json!([
            {"role":"system","content":"system"},
            {"role":"user","content":installed_summary("prior summary")},
            {"role":"user","content":"aged since checkpoint"},
            {"role":"user","content":NAC_COMPACTION_PROMPT}
        ])
    );

    // End-boundary checkpoint: parent covered all messages, then new ones added.
    let end_messages = vec![
        user("old"),
        assistant("new answer"),
        assistant("second answer"),
        assistant("third answer"),
    ];
    let end_store = StoreFixture::new("incremental_end");
    let end_path = &end_store.path;
    let (end_source, end_policy) = checkpoint_digests(&end_messages, 1);
    let end_parent = append_orchestrator_compaction_checkpoint(
        end_path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("parent summary"),
            tail_start_message_index: 1,
            source_prefix_sha256: end_source,
            system_policy_sha256: end_policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut end_state = state(end_path.to_path_buf(), Some(1));
    end_state
        .restore_newest_valid_checkpoint(&end_messages)
        .unwrap();
    let end_candidate = candidate(end_state.plan(&end_messages, &[], CompactionReason::Auto));
    assert_eq!(end_candidate.previous_checkpoint_id, Some(end_parent.id));
    assert_eq!(end_candidate.boundary, 2);
    let end_encoded = serde_json::to_string(&end_candidate.summary_messages).unwrap();
    assert!(end_encoded.contains("parent summary"));
    assert!(end_encoded.contains("new answer"));
    assert!(!end_encoded.contains("old"));
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
fn version_one_checkpoint_is_invalidated() {
    let store = StoreFixture::new("version_one");
    let path = &store.path;
    let messages = vec![user("old"), assistant("answer"), user("current")];
    let (source, policy) = checkpoint_digests(&messages, 2);
    append_orchestrator_compaction_checkpoint(
        path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("v1 summary"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: 1,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();

    let mut state = state(path.to_path_buf(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert!(state.active_checkpoint_for_test().is_none());
    assert_eq!(state.prepare(&messages, &[]).messages.len(), messages.len());
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
