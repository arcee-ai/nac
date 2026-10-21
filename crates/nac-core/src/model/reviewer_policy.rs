//! Fixed reviewer profiles and their strict Decisions response policy.
//!
//! Scope profiles only answer eligible Ask invocations. They do not select
//! backends, alter resources, change policy, or create remembered grants.

use crate::permissions::{
    PermissionReviewFailureReason, ReviewCategory, ReviewUnavailable, ReviewVerdict,
};
use serde_json::Value;

/// An approval needs both a confident yes and a confident routine category;
/// a confident non-routine category rejects.
///
/// A Podman sandbox with only the writable workspace and no Git metadata
/// ("podman", not "podman_with_host_mounts") takes lower
/// approval thresholds. They were set from a live corpus run
/// (jev_corpus_tests.rs) in which Jev scored routine Podman builds and tests
/// at safe 0.55-0.78 and every should-block command at safe 0.48 or below
/// with routine 0.36 or below. Re-check them whenever the Jev model changes.
const ALLOW_MIN: f64 = 0.85;
const ROUTINE_MIN: f64 = 0.80;
const PODMAN_ALLOW_MIN: f64 = 0.55;
const PODMAN_ROUTINE_MIN: f64 = 0.60;
const REJECT_CATEGORY_MIN: f64 = 0.60;
const REJECT_NOUL_MAX: f64 = 0.20;

// Fixed from the independently frozen scope-v6 training selection. This
// numeric profile remains operator opt-in and must pass fresh validation.
const CLEF_SAFE_MIN: f64 = 0.80;
const CLEF_ROUTINE_PROBABILITY_MIN: f64 = 0.60;
const CLEF_CONFIDENCE_MIN: f64 = 0.40;
const CLEF_SCOPE_MIN: f64 = 0.70;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum ReviewProfile {
    JevLegacy,
    ClefScopeV6,
}

impl ReviewProfile {
    pub(super) fn model(self) -> &'static str {
        match self {
            Self::JevLegacy => "typesafe/jev-1.13",
            Self::ClefScopeV6 => "cloudflare/clef",
        }
    }

    pub(super) fn identity(self) -> &'static str {
        match self {
            Self::JevLegacy => "jev:typesafe/jev-1.13",
            Self::ClefScopeV6 => "decisions:cloudflare/clef:clef-scope-v6",
        }
    }

    fn scope_min(self) -> Option<f64> {
        match self {
            Self::JevLegacy => None,
            Self::ClefScopeV6 => Some(CLEF_SCOPE_MIN),
        }
    }
}

pub(super) fn questions(
    profile: ReviewProfile,
    mut baseline: Value,
) -> Result<Value, ReviewUnavailable> {
    if profile != ReviewProfile::JevLegacy {
        let scope: Value = serde_json::from_str(include_str!("clef_scope_question_v6.json"))
            .map_err(|_| {
                ReviewUnavailable::new(
                    PermissionReviewFailureReason::ServiceUnavailable,
                    "the built-in reviewer scope question is invalid",
                )
            })?;
        baseline["within_user_scope"] = scope["within_user_scope"].clone();
    }
    Ok(baseline)
}

/// Applies the decision rule to a parsed Decisions response. Anything that
/// does not match the expected shape is malformed and never an approval.
pub(super) fn decide(
    profile: ReviewProfile,
    response: &Value,
    backend: &str,
) -> std::result::Result<ReviewVerdict, ReviewUnavailable> {
    let scope_min = profile.scope_min();
    let malformed = |detail: &str| {
        ReviewUnavailable::new(
            PermissionReviewFailureReason::InvalidResponse,
            format!("malformed Decisions response: {detail}"),
        )
    };
    let answers = response
        .get("answers")
        .and_then(Value::as_object)
        .ok_or_else(|| malformed("missing answers"))?;
    let safe = answers
        .get("safe_to_allow_once")
        .filter(|answer| answer.get("type").and_then(Value::as_str) == Some("noul"))
        .and_then(|answer| answer.get("noul"))
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
        .ok_or_else(|| malformed("safe_to_allow_once"))?;
    let risk = answers
        .get("risk")
        .filter(|answer| answer.get("type").and_then(Value::as_str) == Some("choice"))
        .ok_or_else(|| malformed("risk"))?;
    let category = risk
        .get("choice")
        .and_then(Value::as_str)
        .and_then(ReviewCategory::parse)
        .ok_or_else(|| malformed("risk choice"))?;
    let probability = |value: &Value, field: &str| {
        value
            .as_f64()
            .filter(|value| value.is_finite() && (0.0..=1.0).contains(value))
            .ok_or_else(|| malformed(field))
    };
    let mut confidence = None;
    let mut chosen_probability = None;
    let mut explicit_confidence = None;
    if let Some(probabilities) = risk.get("probabilities").filter(|value| !value.is_null()) {
        // The whole distribution must be well formed, not just the chosen
        // entry: known categories only, each a probability, together at
        // most one, with the chosen category the most likely.
        let probabilities = probabilities
            .as_object()
            .filter(|map| !map.is_empty())
            .ok_or_else(|| malformed("risk probabilities"))?;
        let mut total = 0.0;
        let mut best = (None, -1.0);
        for (key, value) in probabilities {
            let key =
                ReviewCategory::parse(key).ok_or_else(|| malformed("risk probability key"))?;
            let value = probability(value, "risk probability")?;
            total += value;
            if value > best.1 {
                best = (Some(key), value);
            }
        }
        if total > 1.05 {
            return Err(malformed("risk probabilities sum to more than one"));
        }
        let chosen = probabilities
            .get(category.as_str())
            .ok_or_else(|| malformed("risk probabilities omit the choice"))
            .and_then(|value| probability(value, "risk probability"))?;
        if best.0 != Some(category) && best.1 > chosen {
            return Err(malformed("risk choice is not the most likely category"));
        }
        chosen_probability = Some(chosen);
        confidence = Some(chosen);
    }
    if let Some(value) = risk.get("confidence").filter(|value| !value.is_null()) {
        let value = probability(value, "risk confidence")?;
        explicit_confidence = Some(value);
        confidence = Some(confidence.map_or(value, |chosen: f64| chosen.min(value)));
    }
    let confidence = confidence.unwrap_or(0.0);

    let (allow_min, routine_min) = if backend == "podman" {
        (PODMAN_ALLOW_MIN, PODMAN_ROUTINE_MIN)
    } else {
        (ALLOW_MIN, ROUTINE_MIN)
    };
    let scope_passes = if let Some(min) = scope_min {
        let scope = answers
            .get("within_user_scope")
            .filter(|answer| answer.get("type").and_then(Value::as_str) == Some("noul"))
            .and_then(|answer| answer.get("noul"))
            .ok_or_else(|| malformed("within_user_scope"))
            .and_then(|value| probability(value, "within_user_scope"))?;
        scope >= min
    } else {
        true
    };
    let core_passes = match profile {
        ReviewProfile::JevLegacy => safe >= allow_min && confidence >= routine_min,
        ReviewProfile::ClefScopeV6 => {
            safe >= CLEF_SAFE_MIN
                && chosen_probability.is_some_and(|value| value >= CLEF_ROUTINE_PROBABILITY_MIN)
                && explicit_confidence.is_some_and(|value| value >= CLEF_CONFIDENCE_MIN)
        }
    };
    if category == ReviewCategory::Routine && core_passes && scope_passes {
        return Ok(ReviewVerdict::ApproveOnce);
    }
    let rejecting_category = !matches!(category, ReviewCategory::Routine | ReviewCategory::Unclear);
    if rejecting_category && (confidence >= REJECT_CATEGORY_MIN || safe <= REJECT_NOUL_MAX) {
        return Ok(ReviewVerdict::Reject(category));
    }
    Ok(ReviewVerdict::Uncertain(Some(category)))
}

#[cfg(test)]
#[path = "reviewer_policy_tests.rs"]
mod tests;
