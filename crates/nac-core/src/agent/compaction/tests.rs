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
    let preferred = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &messages,
        &[],
        CompactionReason::Auto,
    ));
    assert_eq!(preferred.boundary, 4);
    let projected = provider_view_with_summary(&messages, preferred.boundary, "summary");
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
    let one_user = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &[user("only")],
        &[],
        CompactionReason::Auto,
    ));
    assert_eq!(one_user.boundary, 1);
}

#[test]
fn manual_and_automatic_planning_share_the_threshold_gate() {
    let messages = vec![user("old"), assistant("answer"), user("current")];
    let estimate = state(PathBuf::from("unused"), None)
        .prepare(&messages, &[])
        .context_estimate;

    for threshold in [None, Some(estimate.saturating_add(1))] {
        assert!(matches!(
            state(PathBuf::from("unused"), threshold)
                .plan(&messages, &[], CompactionReason::Auto)
                .decision,
            CompactionDecision::NotTriggered
        ));
        assert!(matches!(
            state(PathBuf::from("unused"), threshold)
                .plan(&messages, &[], CompactionReason::Manual)
                .decision,
            CompactionDecision::Candidate(_)
        ));
    }
    assert!(matches!(
        state(PathBuf::from("unused"), Some(estimate))
            .plan(&messages, &[], CompactionReason::Auto)
            .decision,
        CompactionDecision::Candidate(_)
    ));
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

    let candidate = candidate(state.plan(&messages, &[], CompactionReason::Auto));
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
fn cycle_fallback_retains_zero_one_or_two_newest_complete_cycles() {
    let cases = [
        (vec![user("source")], 1),
        (vec![user("source"), assistant("one")], 1),
        (vec![user("source"), assistant("one"), assistant("two")], 1),
        (
            vec![
                user("source"),
                assistant("one"),
                assistant("two"),
                assistant("three"),
            ],
            2,
        ),
    ];

    for (messages, expected_boundary) in cases {
        let candidate = candidate(state(PathBuf::from("unused"), Some(1)).plan(
            &messages,
            &[],
            CompactionReason::Auto,
        ));
        assert_eq!(candidate.boundary, expected_boundary);
    }
}

#[test]
fn nonadvancing_user_boundary_falls_through_to_advancing_cycle_boundary() {
    let path = temp_store_path("user_fallback");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![
        user("old"),
        assistant("old answer"),
        user("checkpoint tail"),
        assistant("first new cycle"),
        assistant("second new cycle"),
        assistant("newest cycle"),
    ];
    let (source, policy) = checkpoint_digests(&messages, 2);
    let checkpoint = append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("prior"),
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

    let candidate = candidate(state.plan(&messages, &[], CompactionReason::Auto));
    assert_eq!(candidate.previous_checkpoint_id, Some(checkpoint.id));
    assert_eq!(candidate.boundary, 4);
    let encoded = serde_json::to_string(&candidate.summary_messages).unwrap();
    assert!(encoded.contains("prior"));
    assert!(encoded.contains("checkpoint tail"));
    assert!(encoded.contains("first new cycle"));
    assert!(!encoded.contains("second new cycle"));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}

#[test]
fn cycle_scanner_accepts_exact_parallel_cycles_and_preserves_opaque_assistant_data() {
    let call = |id: &str| ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: "read".to_string(),
            arguments: format!(r#"{{"id":"{id}"}}"#),
        },
    };
    let messages = vec![
        user("source"),
        assistant("old cycle"),
        Message::Assistant {
            content: Some("signed content".to_string()),
            reasoning_text: Some("reasoning text".to_string()),
            reasoning_details: Some(serde_json::json!([
                {"type":"reasoning.encrypted","data":"opaque"}
            ])),
            tool_calls: Some(vec![call("a"), call("b")]),
        },
        Message::Tool {
            tool_call_id: "b".to_string(),
            content: "tool error: timed out".to_string(),
        },
        Message::Tool {
            tool_call_id: "a".to_string(),
            content: "ok".to_string(),
        },
        Message::Assistant {
            content: None,
            reasoning_text: Some("cancelled".to_string()),
            reasoning_details: Some(serde_json::json!({"opaque":true})),
            tool_calls: Some(Vec::new()),
        },
    ];

    assert_eq!(
        complete_assistant_cycle_starts(&messages),
        Ok(vec![1, 2, 5])
    );
    let candidate = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &messages,
        &[],
        CompactionReason::Auto,
    ));
    assert_eq!(candidate.boundary, 2);
    let projected = provider_view_with_summary(&messages, candidate.boundary, "summary");
    assert_eq!(
        serde_json::to_value(&projected[1..]).unwrap(),
        serde_json::to_value(&messages[2..]).unwrap()
    );
}

#[test]
fn cycle_scanner_rejects_duplicate_unknown_orphan_missing_and_interleaved_tools() {
    let call = |id: &str| ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: "tool".to_string(),
            arguments: "{}".to_string(),
        },
    };
    let calls = |ids: &[&str]| Message::Assistant {
        content: None,
        reasoning_text: None,
        reasoning_details: None,
        tool_calls: Some(ids.iter().map(|id| call(id)).collect()),
    };
    let tool = |id: &str| Message::Tool {
        tool_call_id: id.to_string(),
        content: "any content, including errors".to_string(),
    };

    let valid = vec![calls(&["a", "b"]), tool("b"), tool("a")];
    assert_eq!(complete_assistant_cycle_starts(&valid), Ok(vec![0]));
    for invalid in [
        vec![calls(&["a", "a"]), tool("a")],
        vec![calls(&["a"]), tool("unknown")],
        vec![tool("orphan")],
        vec![calls(&["a", "b"]), tool("a")],
        vec![calls(&["a"]), tool("a"), tool("a")],
        vec![calls(&["a"]), user("interleaved")],
        vec![calls(&["a"]), assistant("interleaved")],
        vec![
            calls(&["a"]),
            Message::System {
                content: "interleaved".to_string(),
            },
        ],
    ] {
        assert!(
            complete_assistant_cycle_starts(&invalid).is_err(),
            "{invalid:?}"
        );
    }
}

#[test]
fn incremental_candidates_support_assistant_and_end_checkpoint_boundaries() {
    for (label, mut messages, parent_boundary, expected_boundary, newly_aged) in [
        (
            "assistant",
            vec![
                user("old"),
                assistant("retained one"),
                assistant("retained two"),
                assistant("retained three"),
            ],
            1,
            2,
            "retained one",
        ),
        ("end", vec![user("old")], 1, 2, "new cycle"),
    ] {
        if label == "end" {
            messages.push(assistant("new cycle"));
            messages.push(assistant("second cycle"));
            messages.push(assistant("third cycle"));
        }
        let path = temp_store_path(label);
        store::initialize(&path).unwrap();
        store::insert_test_session(&path, "session");
        let (source, policy) = checkpoint_digests(&messages, parent_boundary);
        let parent = append_orchestrator_compaction_checkpoint(
            &path,
            &NewOrchestratorCompactionCheckpoint {
                session_id: "session".to_string(),
                previous_checkpoint_id: None,
                summary: installed_summary("parent summary"),
                tail_start_message_index: parent_boundary,
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
        let candidate = candidate(state.plan(&messages, &[], CompactionReason::Auto));
        assert_eq!(candidate.previous_checkpoint_id, Some(parent.id));
        assert_eq!(candidate.boundary, expected_boundary);
        let encoded = serde_json::to_string(&candidate.summary_messages).unwrap();
        assert!(encoded.contains("parent summary"));
        assert!(encoded.contains(newly_aged));
        assert!(!encoded.contains("old"));
        let _ = std::fs::remove_dir_all(path.parent().unwrap());
    }
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
