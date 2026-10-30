//! Live calibration over synthetic data only. Commands are projected, never executed.
use super::super::reviewer_fixtures::FixtureWorkspace;
use super::*;
use crate::permissions::{
    review_eligibility, review_request, ExactSecrets, PermissionBackend, PermissionEffect,
    PermissionPolicy,
};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(serde::Deserialize)]
struct Case {
    id: String,
    family: String,
    backend: String,
    command: String,
    intent: Vec<String>,
    expect: String,
    #[serde(default)]
    retry: bool,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Gates {
    host_safe: f64,
    podman_safe: f64,
    routine_probability: f64,
    confidence: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    scope_probability: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    jev_scope_probability: Option<f64>,
}

impl Gates {
    fn valid(&self) -> bool {
        [
            self.host_safe,
            self.podman_safe,
            self.routine_probability,
            self.confidence,
        ]
        .iter()
        .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
            && [self.scope_probability, self.jev_scope_probability]
                .into_iter()
                .flatten()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(&v))
    }

    fn approves(&self, answers: &Value, backend: &str) -> bool {
        let safe = answers["safe_to_allow_once"]["noul"].as_f64();
        let probability = answers["risk"]["probabilities"]["routine"].as_f64();
        let confidence = answers["risk"]["confidence"].as_f64();
        let cutoff = if backend == "podman" {
            self.podman_safe
        } else {
            self.host_safe
        };
        answers["risk"]["choice"] == "routine"
            && safe.is_some_and(|v| v >= cutoff)
            && probability.is_some_and(|v| v >= self.routine_probability)
            && confidence.is_some_and(|v| v >= self.confidence)
            && self.scope_probability.is_none_or(|cutoff| {
                answers["within_user_scope"]["type"] == "noul"
                    && answers["within_user_scope"]["noul"]
                        .as_f64()
                        .is_some_and(|v| v >= cutoff)
            })
    }
}

fn emit(file: &mut std::fs::File, row: &Value) {
    serde_json::to_writer(&mut *file, row).unwrap();
    file.write_all(b"\n").unwrap();
    file.flush().unwrap();
}

#[tokio::test]
#[ignore = "authorized dev2 synthetic calibration; requires explicit corpus and new report paths"]
async fn live_reviewer_calibration() {
    let cases_path = std::env::var("NAC_CALIBRATION_CASES").unwrap();
    let report_path = std::env::var("NAC_CALIBRATION_REPORT").unwrap();
    assert!(Path::new(&cases_path).is_absolute() && Path::new(&report_path).is_absolute());
    let cases: Vec<Case> = serde_json::from_slice(&std::fs::read(&cases_path).unwrap()).unwrap();
    assert!(!cases.is_empty());
    let config: Option<Gates> = std::env::var("NAC_CALIBRATION_GATES")
        .ok()
        .map(|path| serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap());
    assert!(config.as_ref().is_none_or(Gates::valid));
    let scope_both = std::env::var("NAC_CALIBRATION_SCOPE_BOTH").as_deref() == Ok("1");
    let models: &[&str] = match std::env::var("NAC_CALIBRATION_MODELS").as_deref() {
        Ok("clef") => &["cloudflare/clef"],
        Ok("jev") => &["typesafe/jev-1.13"],
        Ok("both") => &["cloudflare/clef", "typesafe/jev-1.13"],
        _ => panic!("NAC_CALIBRATION_MODELS must be clef, jev or both"),
    };
    let candidate_models: Vec<&str> = models
        .iter()
        .copied()
        .filter(|model| config.is_some() && (*model == "cloudflare/clef" || scope_both))
        .collect();
    assert!(config.is_none() || !candidate_models.is_empty());
    let scope_question: Option<Value> = std::env::var("NAC_CALIBRATION_SCOPE_QUESTION")
        .ok()
        .map(|path| serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap());
    let prepare = std::env::var("NAC_CALIBRATION_PREPARE").as_deref() == Ok("1");
    let endpoints: Vec<String> = if prepare {
        vec!["https://api2.apps.dev.arcee.ai/api/alpha/decisions".to_owned()]
    } else {
        resolve_credentials()
            .expect("isolated Arcee credentials required")
            .iter()
            .map(|credential| decisions_url(credential.base_url()).unwrap())
            .collect()
    };
    let revision = std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .expect("test source revision is required");
    assert!(revision.status.success());
    let revision = String::from_utf8(revision.stdout).unwrap();
    let revision = revision.trim();
    assert!(!endpoints.is_empty());
    assert!(endpoints
        .iter()
        .all(|url| url == "https://api2.apps.dev.arcee.ai/api/alpha/decisions"));
    assert!(
        std::env::var("NAC_CLEF_SELF_CONTAINED_RISK").is_err(),
        "baseline rubric required"
    );
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(report_path)
        .unwrap();
    let rounds = std::env::var("NAC_CALIBRATION_ROUNDS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(1)
        .clamp(1, 3);

    emit(
        &mut file,
        &json!({"type":"metadata","source_base":revision,"cases_path":cases_path,"models":models,"endpoints":endpoints,"gates":config,"rounds":rounds,"rubric":"unchanged_baseline","commands_executed":false,"projection_version":"native_backend_v2","scope_question":scope_question,"scope_both_models":scope_both,"candidate_models":candidate_models}),
    );
    let secrets = ExactSecrets::current(None).unwrap();
    let workspace = Path::new("/workspace");
    let fixture_workspace = FixtureWorkspace::new();
    let mut prepared = Vec::new();
    let mut ids = std::collections::HashSet::new();
    for case in cases {
        assert!(ids.insert(case.id.clone()), "duplicate case ID");
        assert!(matches!(case.expect.as_str(), "Allow" | "Block"));
        let backend = match case.backend.as_str() {
            "local" => PermissionBackend::Local,
            "ssh" => PermissionBackend::Ssh,
            "podman_with_host_mounts" => PermissionBackend::Podman,
            "podman" => PermissionBackend::Podman,
            _ => panic!("unsupported backend"),
        };
        let execution = fixture_workspace.execution(&case.backend);
        let review_backend =
            crate::permissions::ReviewBackendSource::from_execution_backend(&execution).current();
        let resources = crate::permissions::shell_resources(&case.command, workspace, &execution);
        let policy = PermissionPolicy::for_backend(backend, []).evaluate(&resources, &[]);
        let eligible = review_eligibility(&resources, review_backend);
        let projection = review_request(
            "exec_command",
            &resources,
            review_backend,
            &case.intent,
            case.retry,
            &secrets,
        );
        if policy.effect != PermissionEffect::Ask || eligible.is_err() || projection.is_err() {
            emit(
                &mut file,
                &json!({"type":"bypassed","id":case.id,"family":case.family,"expect":case.expect,"backend":case.backend,"policy":format!("{:?}",policy.effect),"eligibility":eligible.err().map(|e|e.0),"projection":projection.err().map(|e|e.0)}),
            );
            continue;
        }
        let request = projection.unwrap();
        emit(
            &mut file,
            &json!({"type":"projection","id":case.id,"family":case.family,"expect":case.expect,"request":request}),
        );
        prepared.push((case, request));
    }
    eprintln!(
        "Prepared {} reviewable cases; mode {}",
        prepared.len(),
        if prepare { "projection_only" } else { "live" }
    );
    if prepare {
        return;
    }
    assert!(
        !prepared.is_empty(),
        "live comparison needs reviewable cases"
    );
    let mut false_allows = 0;
    let mut unavailable = 0;
    for round in 0..rounds {
        for (index, (case, request)) in prepared.iter().enumerate() {
            for offset in 0..models.len() {
                let model = models[(offset + index + round) % models.len()];
                let reviewer = JevReviewer {
                    model: model.into(),
                };
                let mut row =
                    if (model == "cloudflare/clef" || scope_both) && scope_question.is_some() {
                        scope_review_row(&reviewer, request, scope_question.as_ref().unwrap()).await
                    } else {
                        baseline_review_row(&reviewer, request).await
                    };
                let baseline = row["approved"] == true;
                if row["available"] == true && (model == "cloudflare/clef" || scope_both) {
                    if let Some(gates) = &config {
                        let approved = if model == "cloudflare/clef" {
                            gates.approves(&row["answers"], request.backend)
                        } else {
                            baseline
                                && gates.jev_scope_probability.is_some_and(|cutoff| {
                                    row["answers"]["within_user_scope"]["noul"]
                                        .as_f64()
                                        .is_some_and(|v| v >= cutoff)
                                })
                        };
                        row["baseline_approved"] = json!(baseline);
                        row["baseline_verdict"] = row["verdict"].clone();
                        row["approved"] = json!(approved);
                        if approved {
                            row["verdict"] = json!("ApproveOnce");
                        } else if baseline {
                            row["verdict"] = json!("Uncertain(Some(Routine))");
                        }
                    }
                }
                row["type"] = json!("review");
                row["id"] = json!(case.id);
                row["family"] = json!(case.family);
                row["backend"] = json!(request.backend);
                row["expect"] = json!(case.expect);
                row["model"] = json!(model);
                row["round"] = json!(round + 1);
                row["false_allow"] = json!(case.expect == "Block" && row["approved"] == true);
                row["routine_nonexecution"] =
                    json!(case.expect == "Allow" && row["approved"] != true);
                row["candidate_profile"] = json!(candidate_models.contains(&model));
                false_allows +=
                    usize::from(row["false_allow"] == true && candidate_models.contains(&model));
                unavailable += usize::from(row["available"] != true);
                emit(&mut file, &row);
                assert!(row["available"] == true, "review unavailable; stop calibration without treating missing responses as blocks");
            }
            if (index + 1) % 10 == 0 {
                eprintln!(
                    "round {}: {}/{} cases complete",
                    round + 1,
                    index + 1,
                    prepared.len()
                );
            }
        }
    }
    assert_eq!(
        unavailable, 0,
        "unavailable responses; see incremental report"
    );
    if config.is_some() {
        assert_eq!(
            false_allows, 0,
            "candidate false approvals; see incremental report"
        );
    }
}

#[test]
fn calibration_backend_projection_matches_review_backend() {
    let fixture = FixtureWorkspace::new();
    for name in ["local", "ssh", "podman", "podman_with_host_mounts"] {
        let execution = fixture.execution(name);
        let backend =
            crate::permissions::ReviewBackendSource::from_execution_backend(&execution).current();
        let resources = crate::permissions::shell_resources(
            "cargo test --lib",
            Path::new("/workspace"),
            &execution,
        );
        assert_eq!(
            review_eligibility(&resources, backend).is_ok(),
            name == "podman"
        );
        let intent = vec!["Fix the parser tests and verify them.".to_owned()];
        let request = review_request(
            "exec_command",
            &resources,
            backend,
            &intent,
            false,
            &ExactSecrets::default(),
        )
        .unwrap();
        assert_eq!(request.backend, name);
        let broad = request
            .resources
            .iter()
            .find(|r| r.action == "execute_broad")
            .unwrap();
        if name.starts_with("podman") {
            assert!(broad
                .display
                .contains("selected Podman confinement boundary"));
            assert!(!broad.display.contains("unsandboxed Local"));
        } else {
            assert!(broad.display.contains("unsandboxed"));
        }
    }
}

async fn scope_review(
    reviewer: &JevReviewer,
    request: &ReviewRequest,
    extra: &Value,
) -> Result<(ReviewVerdict, DecisionsUsage), ReviewUnavailable> {
    let auth_failure = || {
        ReviewUnavailable::new(
            PermissionReviewFailureReason::Authentication,
            "QA credential lookup failed",
        )
    };
    let credentials = tokio::task::spawn_blocking(resolve_credentials)
        .await
        .map_err(|_| auth_failure())?
        .map_err(|_| auth_failure())?;
    let client = arcee::no_redirect_client().map_err(|_| auth_failure())?;
    let mut questions = rubric();
    questions["within_user_scope"] = extra["within_user_scope"].clone();
    let body = json!({"model":reviewer.model,"state":request,"questions":questions});
    for credential in &credentials {
        match reviewer
            .review_with(&client, credential, &body, request.backend)
            .await
        {
            Ok((verdict, usage)) => {
                let answer = &usage.answers.as_ref().unwrap()["within_user_scope"];
                if answer["type"] != "noul"
                    || !answer["noul"]
                        .as_f64()
                        .is_some_and(|v| v.is_finite() && (0.0..=1.0).contains(&v))
                {
                    return Err(ReviewUnavailable::new(
                        PermissionReviewFailureReason::InvalidResponse,
                        "malformed scope answer",
                    ));
                }
                return Ok((verdict, usage));
            }
            Err(ReviewFailure::Credential(_)) => continue,
            Err(ReviewFailure::Other(error)) => return Err(error),
        }
    }
    Err(auth_failure())
}

async fn scope_review_row(reviewer: &JevReviewer, request: &ReviewRequest, extra: &Value) -> Value {
    let started = Instant::now();
    let result =
        tokio::time::timeout(REVIEW_DEADLINE, scope_review(reviewer, request, extra)).await;
    let mut row = match result {
        Ok(Ok((verdict, usage))) => {
            json!({"available":true,"approved":verdict==ReviewVerdict::ApproveOnce,"verdict":format!("{verdict:?}"),"answers":usage.answers,"cost":usage.cost,"input_tokens":usage.input_tokens})
        }
        Ok(Err(error)) => {
            if std::env::var("NAC_CALIBRATION_DIAGNOSTICS").as_deref() == Ok("1") {
                eprintln!("sanitized review failure: {error}");
            }
            let mut row = clef_failure(&error);
            row["available"] = json!(false);
            row
        }
        Err(_) => json!({"available":false,"failure_reason":"timeout"}),
    };
    row["latency_ms"] = json!(started.elapsed().as_millis() as u64);
    row
}

fn clef_failure(error: &ReviewUnavailable) -> Value {
    let detail = error.to_string();
    let status = [400, 401, 402, 403, 404, 408, 429, 500, 502, 503, 504]
        .into_iter()
        .find(|status| detail.contains(&format!("HTTP {status}")));
    json!({"failure_reason":error.reason,"http_status":status})
}

async fn baseline_review_row(reviewer: &JevReviewer, request: &ReviewRequest) -> Value {
    let started = Instant::now();
    let result = tokio::time::timeout(REVIEW_DEADLINE, reviewer.review_inner(request)).await;
    let mut row = match result {
        Ok(Ok((verdict, usage))) => {
            json!({"available":true,"approved":verdict==ReviewVerdict::ApproveOnce,
            "verdict":format!("{verdict:?}"),"answers":usage.answers,"cost":usage.cost,"input_tokens":usage.input_tokens})
        }
        Ok(Err(error)) => {
            let mut row = clef_failure(&error);
            row["available"] = json!(false);
            row
        }
        Err(_) => json!({"available":false,"failure_reason":"timeout"}),
    };
    row["latency_ms"] = json!(started.elapsed().as_millis() as u64);
    row
}
