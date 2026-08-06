use super::super::*;
use super::{state, user};
use std::path::PathBuf;

use crate::model::TokenUsage;
use crate::types::Message;

#[test]
fn full_summary_prompt_usage_aggregates_uncached_cache_read_and_cache_write_tokens() {
    let usage = TokenUsage {
        input_tokens: 60_000,
        output_tokens: 500,
        cache_read_tokens: 70_000,
        cache_write_tokens: 50_000,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 180_500,
        cost: crate::model::TokenCostMicros::default(),
    };

    assert_eq!(full_summary_prompt_tokens(&usage), Some(180_000));

    let overflow = TokenUsage {
        input_tokens: u64::MAX,
        output_tokens: 0,
        cache_read_tokens: 1,
        cache_write_tokens: 1,
        reasoning_tokens: 0,
        orchestrator_context_tokens: u64::MAX,
        cost: crate::model::TokenCostMicros::default(),
    };
    assert_eq!(full_summary_prompt_tokens(&overflow), None);
}

#[test]
fn large_persistent_system_is_not_counted_as_reclaimed_summary_source() {
    const SYSTEM_MESSAGE_BYTES: u64 = 84_030;
    const FINAL_PROMPT_MESSAGE_BYTES: u64 = 2_880;
    const CONTEXT_FRAMING_BYTES: u64 = 1_024;
    const INSTALLED_WRAPPER_MESSAGE_BYTES: u64 = 86;
    const EXPECTED_PROJECTED_CONTEXT: u64 = 208_520;

    let messages = vec![
        Message::System {
            content: "policy".repeat(14_000),
        },
        user(&"aged source".repeat(10_000)),
        user("retained"),
    ];
    let installed = installed_summary("short");

    assert_eq!(
        u64::try_from(serde_json::to_vec(&messages[0]).unwrap().len()).unwrap(),
        SYSTEM_MESSAGE_BYTES
    );
    assert_eq!(
        u64::try_from(
            serde_json::to_vec(&Message::User {
                content: NAC_COMPACTION_PROMPT.to_string(),
            })
            .unwrap()
            .len()
        )
        .unwrap(),
        FINAL_PROMPT_MESSAGE_BYTES
    );
    assert_eq!(
        u64::try_from(
            serde_json::to_vec(&Message::User {
                content: HISTORICAL_CONTEXT_PREFIX.to_string(),
            })
            .unwrap()
            .len()
        )
        .unwrap(),
        INSTALLED_WRAPPER_MESSAGE_BYTES
    );

    let summary_usage = TokenUsage {
        input_tokens: 60_000,
        output_tokens: 500,
        cache_read_tokens: 70_000,
        cache_write_tokens: 50_000,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 180_500,
        cost: crate::model::TokenCostMicros::default(),
    };
    let prompt_tokens = full_summary_prompt_tokens(&summary_usage);
    assert_eq!(prompt_tokens, Some(180_000));

    let non_source_bytes =
        SYSTEM_MESSAGE_BYTES + FINAL_PROMPT_MESSAGE_BYTES + CONTEXT_FRAMING_BYTES;
    assert_eq!(non_source_bytes, 87_934);
    assert_eq!(
        300_000 - (180_000 - non_source_bytes) + 500 + INSTALLED_WRAPPER_MESSAGE_BYTES,
        EXPECTED_PROJECTED_CONTEXT
    );

    let floor =
        full_provider_byte_estimate(&provider_view_with_summary(&messages, 2, &installed), &[]);
    assert!(EXPECTED_PROJECTED_CONTEXT > floor);

    let projected = state(PathBuf::from("unused"), Some(1)).projected_context_estimate(
        &messages,
        &[],
        2,
        &installed,
        prompt_tokens,
        Some(summary_usage.output_tokens),
        300_000,
    );
    assert_eq!(projected, EXPECTED_PROJECTED_CONTEXT);
    assert!(projected > 300_000 - 180_000 + 500 + INSTALLED_WRAPPER_MESSAGE_BYTES);
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
