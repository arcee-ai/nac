use anyhow::{bail, Context, Result};
use serde_json::json;

use super::config::{normalize_allowlist, normalize_share_config, NgrokConfig};

pub fn build_ngrok_traffic_policy(config: &NgrokConfig) -> Result<Option<String>> {
    let config = normalize_share_config(config)?;
    if !config.auth_required {
        return Ok(None);
    }

    let allowlist = normalize_allowlist(&config.allow_emails, &config.allow_domains)?;
    if allowlist.is_empty() {
        bail!("ngrok auth requires at least one allowed email or domain");
    }

    let mut predicates = Vec::new();
    for email in &allowlist.emails {
        predicates.push(format!("actions.ngrok.oauth.identity.email == '{}'", email));
    }
    for domain in &allowlist.domains {
        predicates.push(format!(
            "actions.ngrok.oauth.identity.email.endsWith('@{}')",
            domain
        ));
    }

    let deny_expression = format!("!({})", predicates.join(" || "));
    let policy = json!({
        "on_http_request": [
            {
                "actions": [
                    {
                        "type": "oauth",
                        "config": {
                            "provider": config.oauth_provider,
                        },
                    },
                ],
            },
            {
                "expressions": [deny_expression],
                "actions": [
                    {
                        "type": "deny",
                        "config": {
                            "status_code": 403,
                        },
                    },
                ],
            },
        ],
    });
    serde_json::to_string(&policy)
        .context("failed to serialize ngrok traffic policy")
        .map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_config() -> NgrokConfig {
        NgrokConfig {
            authtoken_env: "NAC_TEST_NGROK_TOKEN".to_string(),
            oauth_provider: "google".to_string(),
            allow_emails: vec!["Admin@Example.com".to_string()],
            allow_domains: vec!["@Example.org".to_string()],
            domain: None,
            auth_required: true,
        }
    }

    #[test]
    fn traffic_policy_requires_google_oauth_and_denies_non_allowlisted_users() {
        let policy = build_ngrok_traffic_policy(&sample_config())
            .unwrap()
            .unwrap();
        let value: serde_json::Value = serde_json::from_str(&policy).unwrap();

        assert_eq!(value["on_http_request"][0]["actions"][0]["type"], "oauth");
        assert_eq!(
            value["on_http_request"][0]["actions"][0]["config"]["provider"],
            "google"
        );
        let expression = value["on_http_request"][1]["expressions"][0]
            .as_str()
            .unwrap();
        assert!(expression.contains("actions.ngrok.oauth.identity.email == 'admin@example.com'"));
        assert!(expression.contains("actions.ngrok.oauth.identity.email.endsWith('@example.org')"));
        assert_eq!(value["on_http_request"][1]["actions"][0]["type"], "deny");
    }

    #[test]
    fn auth_required_rejects_empty_allowlist() {
        let mut config = sample_config();
        config.allow_emails.clear();
        config.allow_domains.clear();

        let error = build_ngrok_traffic_policy(&config).unwrap_err();

        assert!(error.to_string().contains("at least one allowed email"));
    }

    #[test]
    fn allowlist_validation_rejects_policy_injection_characters() {
        let mut config = sample_config();
        config.allow_emails = vec!["bad'user@example.com".to_string()];

        let error = build_ngrok_traffic_policy(&config).unwrap_err();

        assert!(error.to_string().contains("unsupported characters"));
    }
}
