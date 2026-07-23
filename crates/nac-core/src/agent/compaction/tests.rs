use super::*;
use std::path::PathBuf;

use sha2::{Digest, Sha256};

use crate::store;
use crate::store::orchestrator_compaction::{
    append_orchestrator_compaction_checkpoint, NewOrchestratorCompactionCheckpoint,
};
use crate::types::{FunctionCall, Message, ToolCall};

fn user(content: &str) -> Message {
    Message::User {
        content: content.to_string(),
    }
}

fn assistant(content: &str) -> Message {
    Message::Assistant {
        content: Some(content.to_string()),
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: None,
    }
}

fn temp_store_path(label: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir()
        .join(format!("nac_agent_compaction_{label}_{unique}"))
        .join("store.db")
}

fn state(path: PathBuf, threshold: Option<u64>) -> CompactionState {
    CompactionState::new(path, "session".to_string(), threshold)
}

fn candidate(plan: CompactionPlan) -> CompactionCandidate {
    match plan.decision {
        CompactionDecision::Candidate(candidate) => candidate,
        decision => panic!("expected candidate, got {decision:?}"),
    }
}

#[test]
fn codex_prompt_matches_pinned_upstream_bytes() {
    const EXPECTED_SHA256: [u8; 32] = [
        0xab, 0x0c, 0x33, 0x4d, 0x4f, 0xac, 0xa1, 0x7e, 0x3a, 0xfb, 0xb9, 0xb1, 0x69, 0x67, 0xc1,
        0xb2, 0xfd, 0xcc, 0x72, 0x42, 0xa9, 0xa0, 0x88, 0x0a, 0xf5, 0x79, 0x49, 0xfa, 0x23, 0x6d,
        0x6d, 0x07,
    ];
    assert_eq!(CODEX_COMPACTION_PROMPT.len(), 426);
    assert!(CODEX_COMPACTION_PROMPT.ends_with('\n'));
    assert_eq!(
        Sha256::digest(CODEX_COMPACTION_PROMPT.as_bytes())[..],
        EXPECTED_SHA256
    );
}

#[test]
fn boundary_projection_preserves_systems_and_exact_two_user_tail() {
    let messages = vec![
        Message::System {
            content: "system one".to_string(),
        },
        user("old user"),
        assistant("old assistant"),
        Message::System {
            content: "system two".to_string(),
        },
        user("recent user"),
        Message::Assistant {
            content: None,
            reasoning_text: Some("reasoning".to_string()),
            reasoning_details: Some(serde_json::json!([{"type":"reasoning","id":"r1"}])),
            tool_calls: None,
        },
        user("current user"),
    ];
    let candidate = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &messages,
        &[],
        CompactionReason::Auto,
        true,
    ));
    assert_eq!(candidate.boundary, 4);
    let projected = provider_view_with_summary(&messages, candidate.boundary, "summary");
    assert_eq!(
        serde_json::to_value(&projected).unwrap(),
        serde_json::json!([
            {"role":"system","content":"system one"},
            {"role":"system","content":"system two"},
            {"role":"user","content":"summary"},
            {"role":"user","content":"recent user"},
            {"role":"assistant","content":null,"reasoning_text":"reasoning","reasoning_details":[{"type":"reasoning","id":"r1"}]},
            {"role":"user","content":"current user"}
        ])
    );
    assert!(matches!(
        state(PathBuf::from("unused"), Some(1))
            .plan(&[user("only")], &[], CompactionReason::Auto, true,)
            .decision,
        CompactionDecision::Skip(CompactionSkipReason::NoEligibleBoundary)
    ));
}

#[test]
fn exhausted_attempt_plan_reuses_prepared_view_without_a_candidate() {
    let messages = vec![user("old"), assistant("answer"), user("current")];
    let mut state = state(PathBuf::from("unused"), Some(1));

    let plan = state.plan(&messages, &[], CompactionReason::Auto, false);

    assert!(matches!(plan.decision, CompactionDecision::NotTriggered));
    assert_eq!(
        serde_json::to_value(&plan.prepared.messages).unwrap(),
        serde_json::to_value(&messages).unwrap()
    );
    assert!(plan.prepared.context_estimate > 1);
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
    let first = append_orchestrator_compaction_checkpoint(
        &path,
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
    let mut state = state(path.clone(), Some(1));
    state.restore_newest_valid_checkpoint(&messages).unwrap();
    assert_eq!(state.active_checkpoint_for_test().unwrap().id, first.id);

    let candidate = candidate(state.plan(&messages, &[], CompactionReason::Auto, true));
    assert_eq!(candidate.boundary, 5);
    let encoded = serde_json::to_string(&candidate.summary_messages).unwrap();
    assert!(encoded.contains("prior summary"));
    assert!(encoded.contains("aged since checkpoint"));
    assert!(encoded.contains("middle answer"));
    assert!(!encoded.contains("raw oldest"));
    assert!(!encoded.contains("old answer"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn tool_integrity_accepts_complete_parallel_results_and_rejects_missing_results() {
    let call = |id: &str| ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: "read".to_string(),
            arguments: "{}".to_string(),
        },
    };
    let mut messages = vec![
        user("old"),
        Message::Assistant {
            content: None,
            reasoning_text: None,
            reasoning_details: None,
            tool_calls: Some(vec![call("a"), call("b")]),
        },
        Message::Tool {
            tool_call_id: "b".to_string(),
            content: "b result".to_string(),
        },
        Message::Tool {
            tool_call_id: "a".to_string(),
            content: "a result".to_string(),
        },
        user("recent"),
        user("current"),
    ];
    assert!(summarized_prefix_has_complete_tools(&messages, 4));
    messages.remove(3);
    assert!(!summarized_prefix_has_complete_tools(&messages, 3));
}

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
        .plan(&messages, &[], CompactionReason::Auto, false)
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
            .plan(&messages, &[], CompactionReason::Auto, false)
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
        .plan(&changed_projection, &[], CompactionReason::Auto, false)
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
    let prepared = state
        .plan(&messages, &[], CompactionReason::Auto, false)
        .prepared;
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
    let view = state
        .plan(&messages, &[], CompactionReason::Auto, false)
        .prepared;
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
    let candidate = candidate(state.plan(&messages, &[], CompactionReason::Auto, true));
    assert_eq!(candidate.previous_checkpoint_id, None);
    let encoded = serde_json::to_string(&candidate.summary_messages).unwrap();
    assert!(encoded.contains("repaired answer"));
    assert!(!encoded.contains("stale summary"));
    assert!(state.active_checkpoint_for_test().is_none());
    assert!(
        state
            .plan(&messages, &[], CompactionReason::Auto, false)
            .prepared
            .context_estimate
            > 50
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

#[test]
fn projection_is_floored_by_serialized_compacted_view() {
    let messages = vec![user(&"old".repeat(2_000)), user("recent"), user("current")];
    let state = state(PathBuf::from("unused"), Some(1));
    let projected = state.projected_context_estimate(
        &messages,
        &[],
        1,
        &installed_summary("short"),
        Some(u64::MAX),
        Some(1),
        10,
    );
    let floor = full_provider_byte_estimate(
        &provider_view_with_summary(&messages, 1, &installed_summary("short")),
        &[],
    );
    assert_eq!(projected, floor);
}
