use super::super::*;
use super::{assistant, candidate, state, temp_store_path, user};
use std::path::PathBuf;

use crate::store;
use crate::store::orchestrator_compaction::{
    append_orchestrator_compaction_checkpoint, NewOrchestratorCompactionCheckpoint,
};
use crate::types::{FunctionCall, FunctionDef, Message, ToolCall, ToolDefinition};

#[test]
fn boundary_projection_preserves_systems_and_exact_weighted_suffix() {
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
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        user("current user"),
    ];
    let preferred = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &messages,
        &[],
        CompactionReason::Auto,
    ));
    assert_eq!(preferred.boundary, 6);
    assert_eq!(
        serde_json::to_value(&preferred.summary_messages).unwrap(),
        serde_json::json!([
            {"role":"system","content":"system one"},
            {"role":"system","content":"system two"},
            {"role":"user","content":"old user"},
            {"role":"assistant","content":"old assistant"},
            {"role":"user","content":"recent user"},
            {"role":"assistant","content":null,"reasoning_text":"reasoning","reasoning_details":[{"type":"reasoning","id":"r1"}]},
            {"role":"user","content":NAC_COMPACTION_PROMPT}
        ])
    );
    let projected = provider_view_with_summary(&messages, preferred.boundary, "summary");
    assert_eq!(
        serde_json::to_value(&projected).unwrap(),
        serde_json::json!([
            {"role":"system","content":"system one"},
            {"role":"system","content":"system two"},
            {"role":"user","content":"summary"},
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
fn weighted_boundary_uses_exact_half_and_first_safe_ceiling_snap() {
    let equal = vec![user("same"), user("same"), user("same"), user("same")];
    let message_weight = serialized_byte_len(&equal[0]);
    let total_weight = equal.iter().map(serialized_byte_len).sum::<u64>();
    assert_eq!(total_weight, message_weight * 4);
    assert_eq!(weighted_safe_boundary(&equal, 0, None), Ok(Some(2)));

    let odd = vec![user("a"), user("bb")];
    let odd_total = odd.iter().map(serialized_byte_len).sum::<u64>();
    assert_eq!(odd_total % 2, 1);
    assert_eq!(serialized_byte_len(&odd[0]), odd_total / 2);
    assert_eq!(weighted_safe_boundary(&odd, 0, None), Ok(Some(2)));

    let uneven = vec![user("a"), user(&"middle".repeat(200)), user("z")];
    let total_weight = uneven.iter().map(serialized_byte_len).sum::<u64>();
    let target = total_weight / 2 + total_weight % 2;
    let first_weight = serialized_byte_len(&uneven[0]);
    let first_two_weight = first_weight + serialized_byte_len(&uneven[1]);
    assert!(first_weight < target);
    assert!(first_two_weight >= target);
    assert_eq!(weighted_safe_boundary(&uneven, 0, None), Ok(Some(2)));
}
#[test]
fn weighted_boundary_excludes_systems_and_counts_prior_summary_as_user() {
    let messages = vec![
        user("same"),
        Message::System {
            content: "policy".repeat(10_000),
        },
        user("same"),
        user("same"),
        user("same"),
    ];
    assert_eq!(weighted_safe_boundary(&messages, 0, None), Ok(Some(3)));

    let incremental = vec![
        user("already summarized"),
        user("newly aged"),
        user(&"large retained tail".repeat(100)),
    ];
    assert_eq!(weighted_safe_boundary(&incremental, 1, None), Ok(Some(3)));
    assert_eq!(
        weighted_safe_boundary(&incremental, 1, Some(&"prior summary".repeat(300))),
        Ok(Some(2))
    );
}
#[test]
fn separately_supplied_tool_definitions_do_not_affect_boundary_weight() {
    let messages = vec![user("same"), user("same"), user("same"), user("same")];
    let tools = vec![ToolDefinition {
        def_type: "function".to_string(),
        function: FunctionDef {
            name: "large_tool".to_string(),
            description: "description".repeat(10_000),
            parameters: serde_json::json!({"type": "object"}),
        },
    }];
    let without_tools = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &messages,
        &[],
        CompactionReason::Auto,
    ));
    let with_tools = candidate(state(PathBuf::from("unused"), Some(1)).plan(
        &messages,
        &tools,
        CompactionReason::Auto,
    ));
    assert_eq!(without_tools.boundary, 2);
    assert_eq!(with_tools.boundary, without_tools.boundary);
}
#[test]
fn weighted_boundary_counts_complete_tool_groups_atomically() {
    let call = |id: &str| ToolCall {
        id: id.to_string(),
        call_type: "function".to_string(),
        function: FunctionCall {
            name: "read".to_string(),
            arguments: "{}".to_string(),
        },
    };
    let messages = vec![
        user("small prefix"),
        Message::Assistant {
            content: None,
            reasoning_text: Some("opaque reasoning".to_string()),
            reasoning_details: Some(serde_json::json!({"opaque": true})),
            tool_calls: Some(vec![call("a"), call("b")]),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        Message::Tool {
            tool_call_id: "b".to_string(),
            content: "large result".repeat(500).into(),
        },
        Message::Tool {
            tool_call_id: "a".to_string(),
            content: "tool error: timed out".into(),
        },
        user("retained"),
    ];

    let target = messages.iter().map(serialized_byte_len).sum::<u64>() / 2;
    assert!(serialized_byte_len(&messages[0]) < target);
    assert_eq!(weighted_safe_boundary(&messages, 0, None), Ok(Some(4)));
    assert!(summarized_prefix_has_complete_tools(&messages, 4));
    assert!(!summarized_prefix_has_complete_tools(&messages, 3));
}
#[test]
fn weighted_boundary_preserves_exact_reasoning_suffix_and_snaps_huge_message_to_end() {
    let messages = vec![
        Message::System {
            content: "system one".to_string(),
        },
        user(&"huge old message".repeat(500)),
        Message::System {
            content: "system two".to_string(),
        },
        Message::Assistant {
            content: Some("signed content".to_string()),
            reasoning_text: Some("reasoning text".to_string()),
            reasoning_details: Some(serde_json::json!([
                {"type":"reasoning.encrypted","data":"opaque"}
            ])),
            tool_calls: Some(Vec::new()),
            duration_ms: None,
            model_origin: None,
            reasoning_field: None,
        },
        user("current"),
    ];
    let boundary = weighted_safe_boundary(&messages, 0, None).unwrap().unwrap();
    assert_eq!(boundary, 3);
    let projected = provider_view_with_summary(&messages, boundary, "summary");
    assert_eq!(
        serde_json::to_value(&projected[3..]).unwrap(),
        serde_json::to_value(&messages[boundary..]).unwrap()
    );

    let huge = vec![user(&"only message".repeat(10_000))];
    assert_eq!(weighted_safe_boundary(&huge, 0, None), Ok(Some(1)));
}
#[test]
fn safe_boundary_scanner_rejects_duplicate_unknown_orphan_missing_and_interleaved_tools() {
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
        duration_ms: None,
        model_origin: None,
        reasoning_field: None,
    };
    let tool = |id: &str| Message::Tool {
        tool_call_id: id.to_string(),
        content: ("any content, including errors".to_string()).into(),
    };

    let valid = vec![calls(&["a", "b"]), tool("b"), tool("a")];
    assert!(summarized_prefix_has_complete_tools(&valid, 3));
    assert_eq!(weighted_safe_boundary(&valid, 0, None), Ok(Some(3)));
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
            weighted_safe_boundary(&invalid, 0, None).is_err(),
            "{invalid:?}"
        );
    }
}
#[test]
fn active_end_checkpoint_without_new_messages_is_already_compacted() {
    let path = temp_store_path("already_compacted");
    store::initialize(&path).unwrap();
    store::insert_test_session(&path, "session");
    let messages = vec![user("old")];
    let boundary = messages.len();
    let (source, policy) = checkpoint_digests(&messages, boundary);
    append_orchestrator_compaction_checkpoint(
        &path,
        &NewOrchestratorCompactionCheckpoint {
            session_id: "session".to_string(),
            previous_checkpoint_id: None,
            summary: installed_summary("complete"),
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

    assert!(matches!(
        state
            .plan(&messages, &[], CompactionReason::Manual)
            .decision,
        CompactionDecision::Skip(CompactionSkipReason::AlreadyCompacted)
    ));

    let _ = std::fs::remove_dir_all(path.parent().unwrap());
}
