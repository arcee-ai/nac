//! Version-54 canonical replay encoding for marked immutable command receipts.
use super::*;

#[derive(Serialize)]
struct V54Model<'a> {
    backend: &'a str,
    model: &'a str,
    base_url: &'a str,
    allow_insecure_http: bool,
    api_key_env: &'a Option<String>,
    reasoning_effort: &'a Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_tier: &'a Option<String>,
    extra_headers: &'a Option<std::collections::BTreeMap<String, String>>,
    orchestrator_compaction_threshold: Option<u64>,
}
#[derive(Serialize)]
struct V54Destination<'a> {
    project_id: &'a str,
    pinned_commit: &'a Option<String>,
    default_ref: &'a Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model_selection: Option<V54Model<'a>>,
    model: &'a Option<String>,
    reasoning_effort: &'a Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service_tier: &'a Option<String>,
    retained_limit: i64,
}
pub(super) fn digest(
    action: &HeartbeatAction,
    destination: &FreshTaskDestination,
) -> Result<String> {
    let model_selection = destination
        .model_selection
        .as_ref()
        .map(|selection| V54Model {
            backend: &selection.backend,
            model: &selection.model,
            base_url: &selection.base_url,
            allow_insecure_http: selection.allow_insecure_http,
            api_key_env: &selection.api_key_env,
            reasoning_effort: &selection.reasoning_effort,
            service_tier: &selection.service_tier,
            extra_headers: &selection.extra_headers,
            orchestrator_compaction_threshold: selection.compaction_threshold,
        });
    let destination = V54Destination {
        project_id: &destination.project_id,
        pinned_commit: &destination.pinned_commit,
        default_ref: &destination.default_ref,
        model_selection,
        model: &destination.model,
        reasoning_effort: &destination.reasoning_effort,
        service_tier: &destination.service_tier,
        retained_limit: destination.retained_limit,
    };
    Ok(format!(
        "{:x}",
        Sha256::digest(encode(&(action, destination))?.as_bytes())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn old_digest_matches_real_predecessor_wire_with_null_and_value() {
        for (threshold, tier) in [(None, None), (Some(8192), Some("fast"))] {
            let destination = FreshTaskDestination {
                project_id: "p".into(),
                pinned_commit: None,
                default_ref: None,
                model_selection: Some(crate::store::TaskModelSelection {
                    backend: "openai-responses".into(),
                    model: "model".into(),
                    base_url: "https://example.invalid".into(),
                    allow_insecure_http: false,
                    api_key_env: None,
                    reasoning_effort: None,
                    service_tier: tier.map(str::to_owned),
                    extra_headers: None,
                    compaction_threshold: threshold,
                }),
                model: None,
                reasoning_effort: None,
                service_tier: tier.map(str::to_owned),
                retained_limit: 2,
            };
            let action = HeartbeatAction::Pause {
                schedule_id: "literal orchestrator_compaction_threshold".into(),
                expected_version: 1,
            };
            let current = encode(&(&action, &destination)).unwrap();
            let old = current.replace(
                "\"compaction_threshold\":",
                "\"orchestrator_compaction_threshold\":",
            );
            assert_eq!(
                digest(&action, &destination).unwrap(),
                format!("{:x}", Sha256::digest(old.as_bytes()))
            );
        }
    }
}
