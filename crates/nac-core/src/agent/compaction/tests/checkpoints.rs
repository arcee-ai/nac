use super::super::*;
use super::{assistant, candidate, state, temp_store_path, user};

use crate::store;
use crate::store::orchestrator_compaction::{
    append_orchestrator_compaction_checkpoint, NewOrchestratorCompactionCheckpoint,
};
use crate::types::{FunctionCall, Message, ToolCall};

#[test]
fn restore_falls_back_from_newest_invalid_checkpoint() {
    let path = temp_store_path("fallback");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let valid = append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("valid"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: Some(valid.id),
            summary: installed_summary("invalid newest"),
            tail_start_message_index: 3,
            source_prefix_sha256: [9; 32],
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();

    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, valid.id);
    let view = state
        .plan(&messages, &[], CompactionReason::Auto)
        .prepared
        .messages;
    assert!(serde_json::to_string(&view).unwrap().contains("valid"));
    assert!(!serde_json::to_string(&view)
        .unwrap()
        .contains("invalid newest"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn checkpoint_refresh_preserves_sample_for_same_projection_and_invalidates_changed_checkpoint() {
    let path = temp_store_path("sample_refresh");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let first = append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("first summary"),
            tail_start_message_index: 2,
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
    let mut state = state(path.clone(), Some(1_000));
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    state.record_ordinary_context(&messages, 50, messages.len(), Some(first.id));

    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(
        state
            .plan(&messages, &[], CompactionReason::Auto)
            .prepared
            .context_estimate,
        52
    );

    let mut changed_projection = messages.clone();
    changed_projection[3] = user("changed current");
    state
        .restore_newest_valid_checkpoint(&changed_projection)
        .unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, first.id);
    let prepared = state
        .plan(&changed_projection, &[], CompactionReason::Auto)
        .prepared;
    assert_eq!(
        prepared.context_estimate,
        full_provider_byte_estimate(&prepared.messages, &[])
    );

    state.restore_newest_valid_checkpoint(&messages).unwrap();
    state.record_ordinary_context(&messages, 50, messages.len(), Some(first.id));
    let (source, policy) = checkpoint_digests(&messages, 3);
    let second = append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: Some(first.id),
            summary: installed_summary("changed summary"),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 500,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 40,
        },
    )
    .unwrap();
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, second.id);
    let prepared = state.plan(&messages, &[], CompactionReason::Auto).prepared;
    assert_eq!(
        prepared.context_estimate,
        full_provider_byte_estimate(&prepared.messages, &[])
    );
    assert_ne!(prepared.context_estimate, 50);

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn wrapper_only_checkpoint_falls_back_to_older_valid_row() {
    let path = temp_store_path("wrapper_only");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let valid = append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("valid"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let (source, policy) = checkpoint_digests(&messages, 3);
    append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: Some(valid.id),
            summary: HISTORICAL_CONTEXT_PREFIX.to_string(),
            tail_start_message_index: 3,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();

    let mut state = state(path.clone(), None);
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, valid.id);
    let view = state.plan(&messages, &[], CompactionReason::Auto).prepared;
    assert!(serde_json::to_string(&view.messages)
        .unwrap()
        .contains("valid"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn repaired_transcript_clears_stale_checkpoint_before_candidate_and_sample_use() {
    let path = temp_store_path("repaired");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let mut messages = vec![
        user("old"),
        assistant("answer"),
        user("recent"),
        user("current"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let checkpoint = append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("stale summary"),
            tail_start_message_index: 2,
            source_prefix_sha256: source,
            system_policy_sha256: policy,
            prompt_policy_version: PROMPT_POLICY_VERSION,
            old_context_estimate: 100,
            summary_prompt_tokens: None,
            summary_completion_tokens: None,
            new_context_estimate: 50,
        },
    )
    .unwrap();
    let mut state = state(path.clone(), Some(1));
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    state.record_ordinary_context(&messages, 50, messages.len(), Some(checkpoint.id));

    messages[1] = assistant("repaired answer");
    let candidate = candidate(state.plan(&messages, &[], CompactionReason::Auto));
    assert_eq!(candidate.previous_checkpoint_id, None);
    let encoded = serde_json::to_string(&candidate.summary_messages).unwrap();
    assert!(encoded.contains("repaired answer"));
    assert!(!encoded.contains("stale summary"));
    assert!(state.active_checkpoint_for_test().is_none());
    assert!(
        state
            .plan(&messages, &[], CompactionReason::Auto)
            .prepared
            .context_estimate
            > 50
    );

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
#[test]
fn restore_accepts_legacy_user_assistant_and_end_boundaries_but_rejects_unsafe_positions() {
    let messages = vec![
        user("old"),
        assistant("first"),
        user("middle"),
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![ToolCall {
                id: "call".to_string(),
                call_type: "function".to_string(),
                function: FunctionCall {
                    name: "tool".to_string(),
                    arguments: "{}".to_string(),
                },
            }]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "call".to_string(),
            content: "result".to_string(),
        },
    ];
    for (label, boundary) in [("user", 2), ("assistant", 3), ("end", messages.len())] {
        let path = temp_store_path(label);
        store::initialize(&path).unwrap();
        store::insert_test_session(&path, "session");
        let (source, policy) = checkpoint_digests(&messages, boundary);
        let checkpoint = append_orchestrator_compaction_checkpoint(
            &path,
            &NewOrchestratorCompactionCheckpoint {
                session_id: "session".to_string(),
                previous_checkpoint_id: None,
                summary: installed_summary(label),
                tail_start_message_index: boundary,
                source_prefix_sha256: source,
                system_policy_sha256: policy,
                prompt_policy_version: PROMPT_POLICY_VERSION,
                old_context_estimate: 100,
                summary_prompt_tokens: None,
                summary_completion_tokens: None,
                new_context_estimate: 50,
            },
        )
        .unwrap();
        let mut state = state(path.clone(), None);
        state.restore_newest_valid_checkpoint(&messages).unwrap();
        assert_eq!(
            state.active_checkpoint_for_test().unwrap().id,
            checkpoint.id
        );

        if boundary == messages.len() {
            let mut appended = messages.clone();
            appended.push(user("later"));
            appended.push(assistant("later answer"));
            state.restore_newest_valid_checkpoint(&appended).unwrap();
            assert_eq!(
                state.active_checkpoint_for_test().unwrap().id,
                checkpoint.id
            );
            state.record_ordinary_context(&appended, 20, appended.len(), Some(checkpoint.id));
            assert_eq!(state.prepare(&appended, &[]).context_estimate, 22);
        }
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }

    assert!(!checkpoint_boundary_is_valid(&messages, 4));
    assert!(!checkpoint_boundary_is_valid(&messages, 1_000));
    let with_system = vec![
        user("old"),
        Message::System {
            content: "policy".to_string(),
        },
    ];
    assert!(!checkpoint_boundary_is_valid(&with_system, 1));
    assert!(!summarized_prefix_has_complete_tools(&messages, 4));
}
