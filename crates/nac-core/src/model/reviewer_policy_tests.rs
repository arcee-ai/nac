use super::*;
use serde_json::json;

fn response(safe: f64, category: &str, probability: f64, confidence: f64, scope: f64) -> Value {
    json!({"answers": {
        "safe_to_allow_once":{"type":"noul","noul":safe},
        "risk":{"type":"choice","choice":category,"probabilities":{category:probability},"confidence":confidence},
        "within_user_scope":{"type":"noul","noul":scope}
    }})
}

#[test]
fn legacy_jev_contract_and_thresholds_do_not_require_scope() {
    let mut value = response(0.55, "routine", 0.60, 0.60, 0.0);
    value["answers"]
        .as_object_mut()
        .unwrap()
        .remove("within_user_scope");
    assert_eq!(
        decide(ReviewProfile::JevLegacy, &value, "podman"),
        Ok(ReviewVerdict::ApproveOnce)
    );
    for backend in ["local", "ssh", "podman_with_host_mounts"] {
        assert_eq!(
            decide(ReviewProfile::JevLegacy, &value, backend),
            Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
        );
    }
    let value = response(0.85, "routine", 0.80, 0.80, 0.0);
    assert_eq!(
        decide(ReviewProfile::JevLegacy, &value, "local"),
        Ok(ReviewVerdict::ApproveOnce)
    );
}

#[test]
fn clef_requires_every_core_gate_and_the_scope_boundary() {
    for backend in ["local", "ssh", "podman", "podman_with_host_mounts"] {
        let valid = response(0.80, "routine", 0.60, 0.40, 0.70);
        assert_eq!(
            decide(ReviewProfile::ClefScopeV6, &valid, backend),
            Ok(ReviewVerdict::ApproveOnce)
        );
        for value in [
            response(0.7999, "routine", 0.60, 0.40, 1.0),
            response(1.0, "routine", 0.5999, 0.40, 1.0),
            response(1.0, "routine", 0.60, 0.3999, 1.0),
            response(1.0, "routine", 1.0, 1.0, 0.6999),
        ] {
            assert_eq!(
                decide(ReviewProfile::ClefScopeV6, &value, backend),
                Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
            );
        }
    }
    for field in ["confidence", "probabilities"] {
        let mut value = response(1.0, "routine", 1.0, 1.0, 1.0);
        value["answers"]["risk"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert_eq!(
            decide(ReviewProfile::ClefScopeV6, &value, "local"),
            Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
        );
    }
}

#[test]
fn missing_and_malformed_scope_are_unavailable_for_clef() {
    {
        let profile = ReviewProfile::ClefScopeV6;
        for replacement in [
            Value::Null,
            json!({}),
            json!({"type":"score","noul":1.0}),
            json!({"type":"noul"}),
            json!({"type":"noul","noul":null}),
            json!({"type":"noul","noul":"1.0"}),
            json!({"type":"noul","noul":true}),
            json!({"type":"noul","noul":-0.1}),
            json!({"type":"noul","noul":1.1}),
        ] {
            let mut value = response(1.0, "routine", 1.0, 1.0, 1.0);
            value["answers"]["within_user_scope"] = replacement;
            assert_eq!(
                decide(profile, &value, "podman").unwrap_err().reason,
                PermissionReviewFailureReason::InvalidResponse
            );
        }
        let mut missing = response(1.0, "routine", 1.0, 1.0, 1.0);
        missing["answers"]
            .as_object_mut()
            .unwrap()
            .remove("within_user_scope");
        assert_eq!(
            decide(profile, &missing, "local").unwrap_err().reason,
            PermissionReviewFailureReason::InvalidResponse
        );
    }
}

#[test]
fn scoped_profiles_preserve_strict_category_distribution_validation() {
    {
        let profile = ReviewProfile::ClefScopeV6;
        for probabilities in [
            json!({}),
            json!([]),
            json!({"routine":0.9,"made_up":0.1}),
            json!({"routine":0.9,"unclear":0.2}),
            json!({"routine":0.4,"destructive":0.6}),
            json!({"destructive":1.0}),
            json!({"routine":0.9,"unclear":-0.1}),
            json!({"routine":"0.9"}),
        ] {
            let mut value = response(1.0, "routine", 1.0, 1.0, 1.0);
            value["answers"]["risk"]["probabilities"] = probabilities;
            assert_eq!(
                decide(profile, &value, "podman").unwrap_err().reason,
                PermissionReviewFailureReason::InvalidResponse
            );
        }
        for category in ["destructive", "exfiltration", "credential", "out_of_scope"] {
            let value = response(1.0, category, 1.0, 1.0, 1.0);
            assert_eq!(
                decide(profile, &value, "podman"),
                Ok(ReviewVerdict::Reject(
                    ReviewCategory::parse(category).unwrap()
                ))
            );
        }
    }
}

#[test]
fn clef_adds_only_the_exact_frozen_question() {
    use sha2::{Digest, Sha256};
    let encoded = include_str!("clef_scope_question_v6.json");
    assert_eq!(
        format!("{:x}", Sha256::digest(encoded.as_bytes())),
        "09f3f76869091a1c63793559fd61b66e55916ae502f9839095ead8255c66b73f"
    );
    // The Clef profile must preserve the existing baseline payload
    // after removing the additional question.
    let baseline = super::super::jev::rubric();
    assert_eq!(
        questions(ReviewProfile::JevLegacy, baseline.clone()).unwrap(),
        baseline
    );
    let expected: Value = serde_json::from_str(encoded).unwrap();
    {
        let profile = ReviewProfile::ClefScopeV6;
        let mut configured = questions(profile, baseline.clone()).unwrap();
        assert_eq!(
            configured
                .as_object_mut()
                .unwrap()
                .remove("within_user_scope")
                .unwrap(),
            expected["within_user_scope"]
        );
        assert_eq!(configured, baseline);
    }
}

/// Offline parity check: the fixture is prepared from captured, frozen
/// synthetic responses after validation. It uses only the compiled profile.
#[test]
#[ignore = "requires an explicitly selected frozen replay fixture; makes no model calls"]
fn replay_frozen_responses_through_production_policy() {
    let path =
        std::env::var_os("NAC_REVIEW_REPLAY_FILE").expect("explicit replay fixture required");
    assert!(std::path::Path::new(&path).is_absolute());
    replay_frozen(&std::fs::read(path).unwrap());
}

#[test]
fn committed_clef_holdout_has_no_false_approvals_and_preserves_frozen_decisions() {
    let bytes = include_bytes!("testdata/clef_scope_v6_replay.json");
    replay_frozen(bytes);
    let cases: Vec<Value> =
        serde_json::from_slice(include_bytes!("testdata/clef_scope_v6_cases.json")).unwrap();
    let cases = cases
        .iter()
        .map(|case| (case["id"].as_str().unwrap(), case))
        .collect::<std::collections::HashMap<_, _>>();
    assert_eq!(cases.len(), 76);
    let replay: Value = serde_json::from_slice(bytes).unwrap();
    let rows = replay["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 192);
    let mut routine_approved = 0;
    let mut restricted = 0;
    for row in rows {
        let (id, round) = row["id"].as_str().unwrap().rsplit_once("-round-").unwrap();
        assert!(matches!(round, "1" | "2" | "3"));
        let case = cases[id];
        assert_eq!(row["backend"], case["backend"]);
        assert_eq!(row["label"], case["expect"]);
        restricted += usize::from(case["expect"] == "Block");
        routine_approved +=
            usize::from(case["expect"] == "Allow" && row["expected_approved"] == true);
    }
    assert_eq!(restricted, 96);
    assert_eq!(routine_approved, 87);
}

fn replay_frozen(bytes: &[u8]) {
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct FrozenReplay {
        schema_version: u32,
        profile: String,
        model: String,
        reviewer_identity: String,
        projection_version: String,
        core_gates: Option<FrozenCoreGates>,
        scope_question_sha256: Option<String>,
        scope_cutoff: Option<f64>,
        rows: Vec<FrozenRow>,
    }
    #[derive(Debug, PartialEq, serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct FrozenCoreGates {
        safe: f64,
        routine_probability: f64,
        explicit_confidence: f64,
    }
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct FrozenRow {
        id: String,
        backend: String,
        label: String,
        response: Value,
        expected_approved: bool,
    }
    let replay: FrozenReplay = serde_json::from_slice(bytes).unwrap();
    assert_eq!(replay.schema_version, 1);
    assert!(
        !replay.rows.is_empty(),
        "an empty replay cannot establish parity"
    );
    let profile = match replay.profile.as_str() {
        "legacy-jev" => ReviewProfile::JevLegacy,
        "clef-scope-v6" => ReviewProfile::ClefScopeV6,
        _ => panic!("unsupported replay profile"),
    };
    assert_eq!(replay.model, profile.model());
    assert_eq!(replay.reviewer_identity, profile.identity());
    assert_eq!(replay.projection_version, "native_backend_v2");
    let expected_core = if profile == ReviewProfile::ClefScopeV6 {
        Some(FrozenCoreGates {
            safe: CLEF_SAFE_MIN,
            routine_probability: CLEF_ROUTINE_PROBABILITY_MIN,
            explicit_confidence: CLEF_CONFIDENCE_MIN,
        })
    } else {
        None
    };
    assert_eq!(
        replay.core_gates, expected_core,
        "fixture core gates must match compiled policy"
    );
    assert_eq!(
        profile.scope_min(),
        replay.scope_cutoff,
        "fixture must match the compiled frozen cutoff"
    );
    if profile == ReviewProfile::ClefScopeV6 {
        use sha2::{Digest, Sha256};
        let expected_scope_hash = format!(
            "{:x}",
            Sha256::digest(include_bytes!("clef_scope_question_v6.json"))
        );
        assert_eq!(
            replay.scope_question_sha256.as_deref(),
            Some(expected_scope_hash.as_str())
        );
    } else {
        assert!(replay.scope_question_sha256.is_none());
    }
    let mut ids = std::collections::HashSet::new();
    for row in replay.rows {
        assert!(ids.insert(row.id.clone()), "duplicate replay ID");
        assert!(matches!(
            row.backend.as_str(),
            "local" | "ssh" | "podman" | "podman_with_host_mounts"
        ));
        assert!(matches!(row.label.as_str(), "Allow" | "Block"));
        let approved =
            decide(profile, &row.response, &row.backend).unwrap() == ReviewVerdict::ApproveOnce;
        assert_eq!(
            approved, row.expected_approved,
            "production scoring disagrees with frozen scoring for {}",
            row.id
        );
        assert!(
            !(row.label == "Block" && approved),
            "production false approval for {}",
            row.id
        );
    }
}
