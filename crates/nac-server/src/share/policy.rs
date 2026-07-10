use std::collections::BTreeSet;

use anyhow::{bail, Context, Result};
use nac_server::is_valid_dns_host;
use serde_json::json;

const OAUTH_PROVIDER: &str = "google";

pub(super) fn build_ngrok_traffic_policy(emails: &[String], domains: &[String]) -> Result<String> {
    let allowlist = normalize_policy_allowlist(emails, domains)?;
    if allowlist.is_empty() {
        bail!("ngrok auth requires at least one allowed email or domain");
    }

    let email_predicates = allowlist
        .emails
        .iter()
        .map(|email| format!("actions.ngrok.oauth.identity.email == '{email}'"));
    let domain_predicates = allowlist
        .domains
        .iter()
        .map(|domain| format!("actions.ngrok.oauth.identity.email.endsWith('@{domain}')"));
    let deny_expression = format!(
        "!({})",
        email_predicates
            .chain(domain_predicates)
            .collect::<Vec<_>>()
            .join(" || ")
    );
    let policy = json!({
        "on_http_request": [
            {
                "actions": [
                    {
                        "type": "oauth",
                        "config": {
                            "provider": OAUTH_PROVIDER,
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
    serde_json::to_string(&policy).context("failed to serialize ngrok traffic policy")
}

struct NormalizedAllowlist {
    emails: Vec<String>,
    domains: Vec<String>,
}

impl NormalizedAllowlist {
    fn is_empty(&self) -> bool {
        self.emails.is_empty() && self.domains.is_empty()
    }
}

fn normalize_policy_allowlist(
    emails: &[String],
    domains: &[String],
) -> Result<NormalizedAllowlist> {
    let emails = emails.iter().map(|email| email.trim()).collect::<Vec<_>>();
    let domains = domains
        .iter()
        .map(|domain| domain.trim())
        .collect::<Vec<_>>();
    validate_allowlist_values(&emails, &domains)?;

    let emails = emails
        .into_iter()
        .map(str::to_ascii_lowercase)
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let domains = domains
        .into_iter()
        .map(|domain| {
            domain
                .strip_prefix('@')
                .unwrap_or(domain)
                .to_ascii_lowercase()
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    Ok(NormalizedAllowlist { emails, domains })
}

fn validate_allowlist_values(emails: &[&str], domains: &[&str]) -> Result<()> {
    for email in emails {
        validate_policy_email(email)?;
    }
    for domain in domains {
        let domain = domain.strip_prefix('@').unwrap_or(domain);
        if domain.starts_with('@') {
            bail!("invalid allowed domain `{domain}`");
        }
        validate_policy_domain(domain, "allowed domain")?;
    }
    Ok(())
}

fn validate_policy_email(email: &str) -> Result<()> {
    if email.len() > 254 {
        bail!("invalid allowed email `{email}`");
    }
    let Some((local, domain)) = email.split_once('@') else {
        bail!("invalid allowed email `{email}`");
    };
    if local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
        || !local.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-')
        })
    {
        bail!("invalid allowed email `{email}`");
    }
    validate_policy_domain(domain, "allowed email domain")
}

fn validate_policy_domain(domain: &str, label: &str) -> Result<()> {
    if !is_valid_dns_host(domain) {
        bail!("invalid {label} `{domain}`");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_allowlist() -> (Vec<String>, Vec<String>) {
        (
            vec!["Admin@Example.com".to_string()],
            vec!["@Example.org".to_string()],
        )
    }

    fn policy_expression(emails: &[String], domains: &[String]) -> String {
        let policy = build_ngrok_traffic_policy(emails, domains).unwrap();
        let value: serde_json::Value = serde_json::from_str(&policy).unwrap();
        value["on_http_request"][1]["expressions"][0]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn traffic_policy_uses_fixed_google_oauth_and_denies_non_allowlisted_users() {
        let (emails, domains) = sample_allowlist();
        let policy = build_ngrok_traffic_policy(&emails, &domains).unwrap();
        let value: serde_json::Value = serde_json::from_str(&policy).unwrap();

        assert_eq!(value["on_http_request"][0]["actions"][0]["type"], "oauth");
        assert_eq!(
            value["on_http_request"][0]["actions"][0]["config"]["provider"],
            OAUTH_PROVIDER
        );
        let expression = value["on_http_request"][1]["expressions"][0]
            .as_str()
            .unwrap();
        assert!(expression.contains("actions.ngrok.oauth.identity.email == 'admin@example.com'"));
        assert!(expression.contains("actions.ngrok.oauth.identity.email.endsWith('@example.org')"));
        assert_eq!(value["on_http_request"][1]["actions"][0]["type"], "deny");
    }

    #[test]
    fn traffic_policy_normalizes_and_deduplicates_allowlists() {
        let emails = vec![
            " Admin@Example.com ".to_string(),
            "admin@example.com".to_string(),
        ];
        let domains = vec![" @Example.org ".to_string(), "example.org".to_string()];

        let expression = policy_expression(&emails, &domains);

        assert_eq!(expression.matches(" == 'admin@example.com'").count(), 1);
        assert_eq!(expression.matches("endsWith('@example.org')").count(), 1);
    }

    #[test]
    fn empty_allowlist_is_rejected() {
        let error = build_ngrok_traffic_policy(&[], &[]).unwrap_err();

        assert!(error.to_string().contains("at least one allowed email"));
    }

    #[test]
    fn allowlist_validation_rejects_malformed_or_cel_injectable_values() {
        let (_, domains) = sample_allowlist();
        for email in [
            "bad'user@example.com",
            ".admin@example.com",
            "admin@example..com",
            "admin@example.com)||true",
        ] {
            assert!(
                build_ngrok_traffic_policy(&[email.to_string()], &domains).is_err(),
                "accepted email {email}"
            );
        }

        let (emails, _) = sample_allowlist();
        for domain in [
            "bad'domain.example",
            "bad_domain.example",
            "-bad.example",
            "bad-.example",
            "@@example.com",
            ".example.com",
            "example..com",
            "example.com)||true",
        ] {
            assert!(
                build_ngrok_traffic_policy(&emails, &[domain.to_string()]).is_err(),
                "accepted domain {domain}"
            );
        }
    }
}
