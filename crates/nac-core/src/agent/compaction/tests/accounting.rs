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
    let messages = vec![
        Message::System {
            content: "policy".repeat(14_000),
        },
        user(&"aged source".repeat(10_000)),
        user("retained"),
    ];

    let summary_usage = TokenUsage {
        input_tokens: 60_000,
        output_tokens: 500,
        cache_read_tokens: 70_000,
        cache_write_tokens: 50_000,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 180_500,
        cost: crate::model::TokenCostMicros::default(),
    };
    let prompt_tokens = full_summary_prompt_tokens(&summary_usage).unwrap();
    assert_eq!(prompt_tokens, 180_000);

    // non_source_tokens = (system_content_chars + compaction_prompt_chars) / 4
    //   system content = "policy" * 14_000 = 84_000 chars
    //   compaction prompt = 2_817 chars
    //   non_source_tokens = (84_000 + 2_817) / 4 = 21_704
    let non_source_tokens: u64 = ((84_000 + NAC_COMPACTION_PROMPT.len()) / 4) as u64;
    assert_eq!(non_source_tokens, 21_704);

    let projected = state(PathBuf::from("unused"), Some(1)).projected_context_estimate(
        &messages,
        prompt_tokens,
        summary_usage.output_tokens,
        300_000,
    );

    // Without non_source_tokens, the projection would be 300_000 - 180_000 + 500 = 120_500.
    // The non_source_tokens prevents the large system message from being fully
    // reclaimed as source content.
    let bare_projection = 300_000_u64.saturating_sub(180_000).saturating_add(500);
    assert!(projected > bare_projection);

    // Exact: 300_000 - (180_000 - 21_704) + 500 = 300_000 - 158_296 + 500 = 142_204
    assert_eq!(projected, 142_204);
}
