//! Token-usage accumulation and per-response cost (`calculate_cost`)
//! tests, including the serde compatibility of pre-cost persisted rows.

use super::*;

#[test]
fn token_usage_validation_and_accumulation_are_overflow_safe() {
    let valid = TokenUsage {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 2,
        cache_write_tokens: 3,
        reasoning_tokens: 4,
        orchestrator_context_tokens: 20,
        cost: TokenCostMicros::default(),
    };
    assert_eq!(valid.valid_provider_context(), Some(20));

    let mut inconsistent = valid.clone();
    inconsistent.orchestrator_context_tokens = 19;
    assert_eq!(inconsistent.valid_provider_context(), None);

    let mut maximum_total = valid.clone();
    maximum_total.orchestrator_context_tokens = crate::MAX_SUPPORTED_TOKEN_COUNT;
    assert_eq!(
        maximum_total.valid_provider_context(),
        Some(crate::MAX_SUPPORTED_TOKEN_COUNT)
    );

    let mut oversized_total = valid.clone();
    oversized_total.orchestrator_context_tokens = crate::MAX_SUPPORTED_TOKEN_COUNT + 1;
    assert_eq!(oversized_total.valid_provider_context(), None);

    let hostile = TokenUsage {
        input_tokens: u64::MAX,
        output_tokens: u64::MAX,
        cache_read_tokens: u64::MAX,
        cache_write_tokens: u64::MAX,
        reasoning_tokens: u64::MAX,
        orchestrator_context_tokens: u64::MAX,
        cost: TokenCostMicros {
            input: u64::MAX,
            output: u64::MAX,
            cache_read: u64::MAX,
            cache_write: u64::MAX,
            total: u64::MAX,
        },
    };
    assert_eq!(hostile.valid_provider_context(), None);

    // Fallback: provider omits total_tokens (zero) but reports component
    // usage. The component sum is used as the context total.
    let no_total = TokenUsage {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_tokens: 2,
        cache_write_tokens: 3,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 0,
        cost: TokenCostMicros::default(),
    };
    assert_eq!(no_total.valid_provider_context(), Some(20));

    // Zero across the board is still None (no usage at all).
    let all_zero = TokenUsage::default();
    assert_eq!(all_zero.valid_provider_context(), None);
    let mut accumulated = hostile.clone();
    accumulated.add_cost_saturating(&hostile);
    accumulated += hostile;
    assert_eq!(accumulated.input_tokens, u64::MAX);
    assert_eq!(accumulated.output_tokens, u64::MAX);
    assert_eq!(accumulated.orchestrator_context_tokens, u64::MAX);
    assert_eq!(accumulated.cost.input, u64::MAX);
    assert_eq!(accumulated.cost.cache_write, u64::MAX);
    assert_eq!(accumulated.cost.total, u64::MAX);
}

#[test]
fn calculate_cost_bills_each_bucket_at_its_catalog_rate() {
    // claude-opus-4-6 catalog rates ($/1M): 5 / 25 / 0.5 / 6.25.
    let rates = catalog::ModelCostRates {
        input: 5.0,
        output: 25.0,
        cache_read: 0.5,
        cache_write: 6.25,
    };
    let usage = TokenUsage {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_tokens: 200,
        cache_write_tokens: 32,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 382,
        cost: TokenCostMicros::default(),
    };

    // The identity: cost_micros = tokens x rate_per_mtok, exactly.
    let cost = calculate_cost(&rates, None, &usage);
    assert_eq!(cost.input, 500);
    assert_eq!(cost.output, 1_250);
    assert_eq!(cost.cache_read, 100);
    assert_eq!(cost.cache_write, 200);
    assert_eq!(cost.total, 2_050);
}

#[test]
fn calculate_cost_rounds_half_up_once_at_the_micro_conversion() {
    let rates = catalog::ModelCostRates {
        input: 0.5,
        output: 1.5,
        cache_read: 0.49,
        cache_write: 0.25,
    };
    let usage = TokenUsage {
        input_tokens: 1,
        output_tokens: 3,
        cache_read_tokens: 1,
        cache_write_tokens: 2,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 0,
        cost: TokenCostMicros::default(),
    };

    let cost = calculate_cost(&rates, None, &usage);
    assert_eq!(cost.input, 1, "0.5 micros rounds half-up to 1");
    assert_eq!(cost.output, 5, "4.5 micros rounds half-up to 5");
    assert_eq!(cost.cache_read, 0, "0.49 micros rounds down to 0");
    assert_eq!(cost.cache_write, 1, "0.5 micros rounds half-up to 1");
    assert_eq!(cost.total, 7);
}

#[test]
fn calculate_cost_saturates_and_treats_hostile_rates_as_zero() {
    let usage = TokenUsage {
        input_tokens: u64::MAX,
        output_tokens: 10,
        cache_read_tokens: 10,
        cache_write_tokens: 10,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 0,
        cost: TokenCostMicros::default(),
    };

    // Unknown pricing (all-zero rates) bills zero, never an error.
    assert_eq!(
        calculate_cost(&catalog::ModelCostRates::default(), None, &usage),
        TokenCostMicros::default()
    );

    // Negative, NaN and infinite rates bill zero; only finite positive
    // rates bill.
    let hostile = catalog::ModelCostRates {
        input: -1.0,
        output: f64::NAN,
        cache_read: f64::INFINITY,
        cache_write: 1.0,
    };
    let cost = calculate_cost(&hostile, None, &usage);
    assert_eq!(cost.input, 0);
    assert_eq!(cost.output, 0);
    assert_eq!(cost.cache_read, 0);
    assert_eq!(cost.cache_write, 10);

    // Enormous billable usage saturates at u64::MAX instead of wrapping,
    // and the stored total saturates rather than overflowing.
    let enormous = catalog::ModelCostRates {
        input: 1_000_000_000.0,
        output: 1_000_000_000.0,
        cache_read: 1_000_000_000.0,
        cache_write: 1_000_000_000.0,
    };
    let cost = calculate_cost(&enormous, None, &usage);
    assert_eq!(cost.input, u64::MAX);
    assert_eq!(cost.output, 10_000_000_000);
    assert_eq!(cost.total, u64::MAX);
}

#[test]
fn calculate_cost_bills_1h_cache_writes_at_the_1h_rate() {
    let rates = catalog::ModelCostRates {
        input: 5.0,
        output: 25.0,
        cache_read: 0.5,
        cache_write: 6.25,
    };
    let usage = TokenUsage {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_write_tokens: 100,
        reasoning_tokens: 0,
        orchestrator_context_tokens: 0,
        cost: TokenCostMicros::default(),
    };

    // 5-minute writes bill at the standard cache_write rate.
    assert_eq!(calculate_cost(&rates, None, &usage).cache_write, 625);
    // 1-hour writes bill at the 1h rate (here the 2x-input default).
    assert_eq!(
        calculate_cost(&rates, Some(10.0), &usage).cache_write,
        1_000
    );
    // An explicit zero 1h rate bills zero (not the standard rate).
    assert_eq!(calculate_cost(&rates, Some(0.0), &usage).cache_write, 0);
}

#[test]
fn old_token_usage_rows_deserialize_with_zero_cost() {
    // Legacy persisted rows have no `cost` field.
    let old_usage = json!({
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_read_tokens": 200,
        "cache_write_tokens": 30,
        "reasoning_tokens": 10,
        "total_tokens": 380
    });
    let usage: TokenUsage = serde_json::from_value(old_usage).unwrap();
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.orchestrator_context_tokens, 380);
    assert_eq!(usage.cost, TokenCostMicros::default());

    // A legacy token_usages_json row (Vec<Option<TokenUsage>>) parses with
    // zero cost.
    let old_row = json!([
        {
            "input_tokens": 10,
            "output_tokens": 20,
            "cache_read_tokens": 3,
            "cache_write_tokens": 4,
            "total_tokens": 37
        },
        null
    ]);
    let row: Vec<Option<TokenUsage>> = serde_json::from_value(old_row).unwrap();
    assert_eq!(row.len(), 2);
    assert_eq!(row[0].as_ref().unwrap().cost, TokenCostMicros::default());
    assert!(row[1].is_none());

    // Partial cost records fill missing buckets with zero, and the event
    // JSON shape stays additive (cost rides inside TokenUsage).
    let partial = json!({
        "input_tokens": 1,
        "output_tokens": 2,
        "cache_read_tokens": 0,
        "cache_write_tokens": 0,
        "total_tokens": 3,
        "cost": {"input": 5, "total": 5}
    });
    let usage: TokenUsage = serde_json::from_value(partial).unwrap();
    assert_eq!(usage.cost.input, 5);
    assert_eq!(usage.cost.output, 0);
    assert_eq!(usage.cost.total, 5);
}
