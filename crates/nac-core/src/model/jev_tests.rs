use serde_json::json;

use super::*;

#[test]
fn unavailable_http_responses_have_safe_failure_categories() {
    use PermissionReviewFailureReason::*;
    for (status, want) in [
        (401, Authentication),
        (402, InsufficientCredits),
        (403, AccessDenied),
        (404, ModelUnavailable),
        (408, Timeout),
        (429, RateLimited),
        (500, ServiceUnavailable),
        (504, Timeout),
    ] {
        assert_eq!(
            http_failure_reason(reqwest::StatusCode::from_u16(status).unwrap()),
            want,
            "HTTP {status}"
        );
    }
}

fn response(noul: f64, choice: &str, confidence: f64) -> Value {
    json!({
        "model": "typesafe/jev-1.13",
        "answers": {
            "safe_to_allow_once": {"type": "noul", "noul": noul},
            "risk": {"type": "choice", "choice": choice, "probabilities": {choice: confidence}}
        },
        "usage": {"input_tokens": 10, "output_tokens": 0}
    })
}

#[test]
fn confident_routine_yes_approves_once() {
    assert_eq!(
        decide(&response(0.95, "routine", 0.9), "local"),
        Ok(ReviewVerdict::ApproveOnce)
    );
}

#[test]
fn podman_takes_lower_approval_thresholds() {
    use ReviewCategory::{Destructive, Routine};
    use ReviewVerdict::{ApproveOnce, Reject, Uncertain};
    // Scores observed from Jev on dev2 (jev_corpus_tests.rs), plus the edges.
    let cases = [
        (
            "cargo build",
            0.59,
            "routine",
            0.76,
            ApproveOnce,
            Uncertain(Some(Routine)),
        ),
        (
            "make build",
            0.57,
            "routine",
            0.60,
            ApproveOnce,
            Uncertain(Some(Routine)),
        ),
        (
            "edge",
            0.55,
            "routine",
            0.60,
            ApproveOnce,
            Uncertain(Some(Routine)),
        ),
        (
            "below safe",
            0.54,
            "routine",
            0.90,
            Uncertain(Some(Routine)),
            Uncertain(Some(Routine)),
        ),
        (
            "npm ci",
            0.57,
            "routine",
            0.41,
            Uncertain(Some(Routine)),
            Uncertain(Some(Routine)),
        ),
        (
            "git diff",
            0.49,
            "routine",
            0.75,
            Uncertain(Some(Routine)),
            Uncertain(Some(Routine)),
        ),
        (
            "make release",
            0.46,
            "destructive",
            0.70,
            Reject(Destructive),
            Reject(Destructive),
        ),
        ("clear yes", 0.95, "routine", 0.90, ApproveOnce, ApproveOnce),
    ];
    for (name, safe, category, confidence, podman, elsewhere) in cases {
        let value = response(safe, category, confidence);
        assert_eq!(decide(&value, "podman"), Ok(podman), "{name} on podman");
        for backend in ["local", "ssh", "podman_with_host_mounts"] {
            assert_eq!(
                decide(&value, backend),
                Ok(elsewhere),
                "{name} on {backend}"
            );
        }
    }
}

#[test]
fn weak_routine_or_weak_yes_is_uncertain() {
    assert_eq!(
        decide(&response(0.7, "routine", 0.95), "local"),
        Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
    );
    assert_eq!(
        decide(&response(0.95, "routine", 0.5), "local"),
        Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
    );
}

#[test]
fn confident_risk_category_rejects_even_with_a_high_yes() {
    for category in ["destructive", "exfiltration", "credential", "out_of_scope"] {
        assert_eq!(
            decide(&response(0.99, category, 0.7), "local"),
            Ok(ReviewVerdict::Reject(
                ReviewCategory::parse(category).unwrap()
            )),
            "{category}"
        );
    }
}

#[test]
fn unclear_never_rejects_or_approves() {
    assert_eq!(
        decide(&response(0.05, "unclear", 0.99), "local"),
        Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Unclear)))
    );
}

#[test]
fn malformed_responses_are_unavailable_never_approved() {
    let cases = [
        json!({}),
        json!({"answers": {}}),
        json!({"answers": {"safe_to_allow_once": {"type": "noul", "noul": 1.5}, "risk": {"type": "choice", "choice": "routine", "confidence": 1.0}}}),
        json!({"answers": {"safe_to_allow_once": {"type": "noul", "noul": "yes"}, "risk": {"type": "choice", "choice": "routine", "confidence": 1.0}}}),
        json!({"answers": {"safe_to_allow_once": {"type": "score", "score": 1.0}, "risk": {"type": "choice", "choice": "routine", "confidence": 1.0}}}),
        json!({"answers": {"safe_to_allow_once": {"type": "noul", "noul": 1.0}, "risk": {"type": "choice", "choice": "safe", "confidence": 1.0}}}),
        json!({"answers": {"safe_to_allow_once": {"type": "noul", "noul": 1.0}, "risk": {"type": "choice", "choice": "routine", "confidence": 2.0}}}),
        json!({"answers": {"safe_to_allow_once": {"type": "noul", "noul": 1.0}}}),
    ];
    for case in cases {
        assert!(decide(&case, "local").is_err(), "{case}");
    }
}

#[test]
fn missing_confidence_never_approves() {
    let value = json!({
        "answers": {
            "safe_to_allow_once": {"type": "noul", "noul": 1.0},
            "risk": {"type": "choice", "choice": "routine"}
        }
    });
    assert_eq!(
        decide(&value, "local"),
        Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
    );
}

#[test]
fn decisions_url_uses_the_approved_origin_only() {
    assert_eq!(
        decisions_url("https://api.arcee.ai/api/v1").unwrap(),
        "https://api.arcee.ai/api/alpha/decisions"
    );
    assert_eq!(
        decisions_url("https://api2.apps.dev.arcee.ai/api/v1").unwrap(),
        "https://api2.apps.dev.arcee.ai/api/alpha/decisions"
    );
    assert_eq!(
        decisions_url("https://api.apps.dev.arcee.ai/api/v1").unwrap(),
        "https://api.apps.dev.arcee.ai/api/alpha/decisions"
    );
    assert!(decisions_url("https://example.com/api/v1").is_err());
    assert!(decisions_url("http://api.arcee.ai/api/v1").is_err());
}

#[test]
fn malformed_probability_distributions_are_unavailable() {
    let with = |probabilities: Value| {
        json!({
            "answers": {
                "safe_to_allow_once": {"type": "noul", "noul": 0.99},
                "risk": {"type": "choice", "choice": "routine", "probabilities": probabilities}
            }
        })
    };
    for probabilities in [
        json!({"routine": 0.9, "destructive": 2.0}),
        json!({"routine": 0.9, "destructive": -0.5, "credential": 0.6}),
        json!({"routine": 0.9, "made_up": 0.1}),
        json!({"routine": 0.9, "unclear": 0.2}),
        json!({"routine": 0.45, "destructive": 0.55}),
        json!({"destructive": 1.0}),
        json!({}),
        json!([0.9, 0.1]),
        json!({"routine": "0.9", "unclear": 0.1}),
    ] {
        assert!(
            decide(&with(probabilities.clone()), "local").is_err(),
            "{probabilities}"
        );
    }
    assert_eq!(
        decide(&with(json!({"routine": 0.9, "unclear": 0.1})), "local"),
        Ok(ReviewVerdict::ApproveOnce)
    );
}

#[test]
fn the_lower_of_probability_and_confidence_governs() {
    let value = json!({
        "answers": {
            "safe_to_allow_once": {"type": "noul", "noul": 0.99},
            "risk": {"type": "choice", "choice": "routine", "confidence": 0.5, "probabilities": {"routine": 0.95, "unclear": 0.05}}
        }
    });
    assert_eq!(
        decide(&value, "local"),
        Ok(ReviewVerdict::Uncertain(Some(ReviewCategory::Routine)))
    );
}

/// Live check of the configured environment. Sends one synthetic,
/// non-sensitive request and prints only the endpoint, auth method, verdict
/// and latency. Run with `cargo test -p nac-core live_jev_smoke -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "requires network access and an Arcee credential"]
async fn live_jev_smoke() {
    let credentials = resolve_credentials().unwrap_or_else(|message| panic!("{message}"));
    let method = credentials
        .iter()
        .map(|credential| match credential {
            Credential::StoredLogin { .. } => "stored Arcee login",
            Credential::ApiKey { .. } => "Arcee API key",
        })
        .collect::<Vec<_>>()
        .join(", then ");
    let endpoint = credentials
        .iter()
        .filter_map(|credential| decisions_url(credential.base_url()).ok())
        .collect::<Vec<_>>()
        .join(", then ");
    match smoke_test_jev_reviewer().await {
        Ok((verdict, latency)) => eprintln!(
            "jev smoke: endpoint={endpoint} model={DEFAULT_MODEL} auth={method} verdict={verdict:?} latency_ms={}",
            latency.as_millis()
        ),
        Err(error) => panic!(
            "jev smoke failed: endpoint={endpoint} model={DEFAULT_MODEL} auth={method} error={error}"
        ),
    }
}

/// Exercise the factory-selected production profile/authentication path with a
/// synthetic projected request. This never invokes the described shell command.
#[tokio::test]
#[ignore = "requires isolated dev2 credentials for the default Clef reviewer"]
async fn live_default_clef_scope_profile_smoke() {
    assert!(
        std::env::var_os("NAC_PERMISSION_REVIEW_PROFILE").is_none(),
        "leave NAC_PERMISSION_REVIEW_PROFILE unset to test the production default"
    );
    let credentials = resolve_credentials().expect("isolated Arcee credentials are required");
    assert!(!credentials.is_empty());
    assert!(
        credentials.iter().all(|credential| {
            decisions_url(credential.base_url())
                .is_ok_and(|url| url == "https://api2.apps.dev.arcee.ai/api/alpha/decisions")
        }),
        "smoke credentials must all resolve to the approved dev2 origin"
    );
    let reviewer = crate::model::default_permission_reviewer();
    assert_eq!(
        reviewer.identity(),
        "decisions:cloudflare/clef:clef-scope-v6"
    );
    assert!(
        reviewer.check_available().is_ok(),
        "selected profile is unavailable"
    );
    let backend = crate::sandbox::ExecutionBackend::Local {
        workspace_cwd: "/workspace".into(),
    };
    let resources =
        crate::permissions::shell_resources("ls", std::path::Path::new("/workspace"), &backend);
    let permission_backend = crate::permissions::PermissionBackend::Local;
    assert_eq!(
        crate::permissions::PermissionPolicy::for_backend(permission_backend, [])
            .evaluate(&resources, &[])
            .effect,
        crate::permissions::PermissionEffect::Ask
    );
    assert!(crate::permissions::review_eligibility(&resources, permission_backend).is_ok());
    let secrets =
        crate::permissions::ExactSecrets::current(None).expect("redaction inputs unavailable");
    let request = crate::permissions::review_request(
        "exec_command",
        &resources,
        permission_backend,
        &["List the visible immediate entries in the workspace once.".to_owned()],
        false,
        &secrets,
    )
    .expect("synthetic reviewer projection failed");
    let started = Instant::now();
    // The broker owns this deadline in real invocations. A direct trait smoke
    // supplies the same bound explicitly, including auth and refresh work.
    let result = tokio::time::timeout(REVIEW_DEADLINE, reviewer.review(&request))
        .await
        .expect("synthetic profile smoke exceeded the broker review deadline");
    let verdict = match result {
        Ok(verdict) => verdict,
        Err(error) => panic!("synthetic profile smoke unavailable: {:?}", error.reason),
    };
    eprintln!(
        "production profile smoke: reviewer={} verdict={verdict:?} latency_ms={}",
        reviewer.identity(),
        started.elapsed().as_millis()
    );
    assert_eq!(verdict, ReviewVerdict::ApproveOnce);
}
