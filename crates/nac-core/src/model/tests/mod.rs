//! Subject test suites for the `model` module, split by topic; this file
//! carries the shared helpers and the tests of `mod.rs`'s own items.

use super::*;
use std::ffi::OsString;

mod anthropic;
mod auth;
mod completions;
mod cost;
mod parsers;
mod settings_validation;

/// Resolve the catalog metadata a client's `resolved_model` would carry
/// for this backend/model pair.
fn test_resolved(backend: BackendKind, model: &str) -> ModelMetadata {
    catalog::resolve(backend, model)
}

fn set_env(name: &str, value: Option<&str>) {
    match value {
        Some(value) => unsafe { std::env::set_var(name, value) },
        None => unsafe { std::env::remove_var(name) },
    }
}

fn restore_env(name: &str, value: Option<OsString>) {
    match value {
        Some(value) => unsafe { std::env::set_var(name, value) },
        None => unsafe { std::env::remove_var(name) },
    }
}

#[test]
fn backoff_duration_stays_within_jitter_bounds() {
    for attempt in 0..10usize {
        let base_ms = std::cmp::min(200u64.saturating_mul(1 << attempt), 30_000);
        // Multiplier must span [0.9, 1.1): inclusive bounds with one
        // ulp of slack for f64 rounding at the top edge.
        let lower = (base_ms as f64 * 0.9) as u64;
        let upper = (base_ms as f64 * 1.1) as u64;
        for _ in 0..200 {
            let delay = backoff_duration(attempt);
            assert!(
                delay >= Duration::from_millis(lower) && delay <= Duration::from_millis(upper),
                "attempt {attempt} produced {delay:?} outside [{lower}ms, {upper}ms]"
            );
        }
    }
}

#[test]
fn retry_policy_covers_transient_statuses_and_bounds_retry_after() {
    for status in [408, 409, 429, 500, 599] {
        assert!(retryable_http_status(
            reqwest::StatusCode::from_u16(status).unwrap()
        ));
    }
    for status in [400, 401, 403, 404, 422] {
        assert!(!retryable_http_status(
            reqwest::StatusCode::from_u16(status).unwrap()
        ));
    }
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(reqwest::header::RETRY_AFTER, "600".parse().unwrap());
    assert_eq!(retry_after_delay(&headers), Some(Duration::from_secs(60)));
}
