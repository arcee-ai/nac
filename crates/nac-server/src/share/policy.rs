use std::collections::BTreeSet;

use anyhow::{ensure, Context, Result};
use nac_server::is_valid_dns_host;
use serde_json::json;

const EMAIL_IDENTITY: &str = "actions.ngrok.oauth.identity.email";

pub(super) fn build_ngrok_traffic_policy(emails: &[String], domains: &[String]) -> Result<String> {
    let emails: BTreeSet<_> = emails
        .iter()
        .map(|v| normalize_email(v))
        .collect::<Result<_>>()?;
    let domains: BTreeSet<_> = domains
        .iter()
        .map(|v| normalize_domain(v))
        .collect::<Result<_>>()?;
    ensure!(
        !(emails.is_empty() && domains.is_empty()),
        "ngrok auth requires at least one allowed email or domain"
    );
    let emails = emails.iter().map(|e| format!("{EMAIL_IDENTITY} == '{e}'"));
    let domains = domains
        .iter()
        .map(|d| format!("{EMAIL_IDENTITY}.endsWith('@{d}')"));
    let predicates = emails.chain(domains).collect::<Vec<_>>().join(" || ");
    let expression = format!("!({predicates})");
    let policy = json!({"on_http_request": [
        {"actions": [{
            "type": "oauth", "config": {"provider": "google"},
        }]},
        {
            "expressions": [expression],
            "actions": [{"type": "deny", "config": {"status_code": 403}}],
        },
    ]});
    serde_json::to_string(&policy).context("failed to serialize ngrok traffic policy")
}

fn normalize_email(value: &str) -> Result<String> {
    let email = value.trim().to_ascii_lowercase();
    let valid = email.len() <= 254
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && local.len() <= 64
                && !local.starts_with('.')
                && !local.ends_with('.')
                && !local.contains("..")
                && local.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-')
                })
                && is_valid_dns_host(domain)
        });
    ensure!(valid, "invalid allowed email `{email}`");
    Ok(email)
}

fn normalize_domain(value: &str) -> Result<String> {
    let value = value.trim();
    let domain = value.strip_prefix('@').unwrap_or(value);
    let domain = domain.to_ascii_lowercase();
    ensure!(is_valid_dns_host(&domain), "invalid domain: {domain}");
    Ok(domain)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_has_fixed_actions_and_a_normalized_deduplicated_allowlist() {
        let emails = [" User@Example.COM ", "user@example.com"].map(String::from);
        let domains = [" @Example.ORG ", "example.org"].map(String::from);
        let policy: serde_json::Value =
            serde_json::from_str(&build_ngrok_traffic_policy(&emails, &domains).unwrap()).unwrap();
        assert_eq!(
            policy,
            json!({"on_http_request": [
                {"actions": [{"type": "oauth", "config": {"provider": "google"}}]},
                {
                    "expressions": ["!(actions.ngrok.oauth.identity.email == 'user@example.com' || actions.ngrok.oauth.identity.email.endsWith('@example.org'))"],
                    "actions": [{"type": "deny", "config": {"status_code": 403}}],
                },
            ]})
        );
    }

    #[test]
    fn empty_allowlist_is_rejected() {
        assert!(build_ngrok_traffic_policy(&[], &[]).is_err());
    }

    #[test]
    fn malformed_or_injectable_values_are_rejected() {
        let emails = r"x .x@a.co x..y@a.co x'@a.co x\@a.co x@a..co";
        let domains = r"@@a.co bad_name -x.co x-.co x'.co x\.co a.co)||true";
        for email in emails.split_whitespace() {
            assert!(normalize_email(email).is_err());
        }
        for domain in domains.split_whitespace() {
            assert!(normalize_domain(domain).is_err());
        }
    }
}
