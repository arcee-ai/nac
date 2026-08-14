//! Credential redaction for provider error text.
//!
//! Provider HTTP error bodies and stream error events are surfaced to the user
//! and persisted into session events and server logs. A provider that echoes
//! request headers or bodies back in an error can therefore leak API keys and
//! bearer tokens. This module strips known secrets and recognizable credential
//! shapes out of that text before it is embedded in an error message.
//!
//! Redaction is deliberately conservative: exact secret values are replaced
//! wherever they appear, and header-shaped credential lines (`Authorization`,
//! `x-api-key`, ...) are masked even when the exact value is not known. Ordinary
//! error prose is left intact so the actionable part of a provider message
//! ("no credits", "bad key", "rate limit") survives.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use regex::Regex;
use serde_json::Value;

/// Marker substituted for any credential material found in provider text.
pub(crate) const REDACTED: &str = "[REDACTED]";

/// JSON object keys whose values are always treated as credentials, matched
/// case-insensitively.
const SENSITIVE_JSON_KEYS: [&str; 13] = [
    "authorization",
    "x-api-key",
    "api_key",
    "apikey",
    "api-key",
    "access_token",
    "refresh_token",
    "token",
    "secret",
    "password",
    "key",
    "cookie",
    "set-cookie",
];

/// `Authorization: Bearer <token>` / `Authorization: Basic <b64>`, with or
/// without the surrounding quotes JSON would add.
fn header_with_scheme_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(authorization|proxy-authorization)\s*"?\s*[:=]\s*"?\s*(?:bearer|basic)\s+[^\s,;"]+"#,
        )
        .expect("valid credential header regex")
    })
}

/// Any other credential header value, bare or quoted.
fn header_value_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r#"(?i)(authorization|proxy-authorization|x-api-key|api-key|apikey)\s*"?\s*[:=]\s*"?\s*[^\s,;"]+"#)
            .expect("valid credential header regex")
    })
}

/// A `Bearer`/`Basic` token standing alone in prose, without a header name.
/// The token is captured separately so the replacement can tell credential
/// material from an ordinary prose word (see `redact_patterns`).
fn bearer_token_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\b(bearer|basic)\s+([A-Za-z0-9._~+/=:-]{4,})")
            .expect("valid bearer token regex")
    })
}

/// `https://user:pass@host` userinfo embedded in a URL.
fn url_userinfo_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)(https?://)[^/\s:@]+:[^/\s@]+@").expect("valid URL userinfo regex")
    })
}

/// Redact credentials from provider-controlled text.
///
/// Exact secret values are replaced first (longest first, so a secret that is a
/// prefix of another cannot leave a tail behind), then recognizable credential
/// shapes — `Authorization`/`x-api-key` header lines, `Bearer`/`Basic` tokens,
/// and URL userinfo — are masked even when the exact value is not known.
pub(crate) fn redact_credentials(text: &str, secrets: &[&str]) -> String {
    CredentialRedactor::new(secrets.iter().copied()).redact(text)
}

/// Redact known credentials plus every configured extra-header value.
///
/// Extra headers may use provider-specific names that pattern matching cannot
/// recognize, so their values must travel with the request's ordinary secrets.
pub(crate) fn redact_credentials_with_extra_headers(
    text: &str,
    secrets: &[&str],
    extra_headers: &BTreeMap<String, String>,
) -> String {
    CredentialRedactor::new(
        secrets
            .iter()
            .copied()
            .chain(extra_headers.values().map(String::as_str)),
    )
    .redact(text)
}

struct CredentialRedactor<'a> {
    known: Vec<&'a str>,
}

impl<'a> CredentialRedactor<'a> {
    fn new(secrets: impl IntoIterator<Item = &'a str>) -> Self {
        let mut known: Vec<&str> = secrets
            .into_iter()
            .filter(|secret| !secret.is_empty())
            .collect();
        known.sort_unstable_by(|left, right| {
            right.len().cmp(&left.len()).then_with(|| left.cmp(right))
        });
        known.dedup();
        Self { known }
    }

    fn redact(&self, text: &str) -> String {
        let mut redacted = text.to_string();
        for secret in &self.known {
            redacted = redacted.replace(secret, REDACTED);
        }
        redact_patterns(redacted)
    }
}

fn redact_patterns(mut redacted: String) -> String {
    let pattern = header_with_scheme_re();
    if pattern.is_match(&redacted) {
        redacted = pattern
            .replace_all(&redacted, "$1: [REDACTED]")
            .into_owned();
    }
    let pattern = header_value_re();
    if pattern.is_match(&redacted) {
        redacted = pattern
            .replace_all(&redacted, "$1: [REDACTED]")
            .into_owned();
    }
    let pattern = bearer_token_re();
    if pattern.is_match(&redacted) {
        redacted = pattern
            .replace_all(&redacted, |captures: &regex::Captures<'_>| {
                // Ordinary prose ("bearer token", "basic authentication") is all
                // lowercase letters; credential material carries at least one
                // digit, uppercase letter, or symbol. Masking a prose word would
                // hide the actionable part of a provider error.
                let token = &captures[2];
                if token.bytes().any(|byte| !byte.is_ascii_lowercase()) {
                    format!("{} [REDACTED]", &captures[1])
                } else {
                    captures[0].to_string()
                }
            })
            .into_owned();
    }
    let pattern = url_userinfo_re();
    if pattern.is_match(&redacted) {
        redacted = pattern.replace_all(&redacted, "$1[REDACTED]@").into_owned();
    }
    redacted
}

/// Redact credentials from a provider response body.
///
/// When the body parses as JSON, sensitive keys are masked and every string
/// value is passed through [`redact_credentials`]; otherwise the whole body is
/// treated as plain text. The result is always a `String`, so callers can
/// truncate it afterwards without ever truncating a secret first.
#[cfg(test)]
pub(crate) fn redact_json_body(body: &str, secrets: &[&str]) -> String {
    redact_json_body_with(body, &CredentialRedactor::new(secrets.iter().copied()))
}

pub(crate) fn redact_json_body_with_extra_headers(
    body: &str,
    secrets: &[&str],
    extra_headers: &BTreeMap<String, String>,
) -> String {
    redact_json_body_with(
        body,
        &CredentialRedactor::new(
            secrets
                .iter()
                .copied()
                .chain(extra_headers.values().map(String::as_str)),
        ),
    )
}

fn redact_json_body_with(body: &str, redactor: &CredentialRedactor<'_>) -> String {
    match serde_json::from_str::<Value>(body) {
        Ok(value) => serde_json::to_string(&redact_json_value(value, redactor))
            .unwrap_or_else(|_| redactor.redact(body)),
        Err(_) => redactor.redact(body),
    }
}

fn redact_json_value(value: Value, redactor: &CredentialRedactor<'_>) -> Value {
    match value {
        Value::Object(map) => {
            let mut redacted = serde_json::Map::with_capacity(map.len());
            for (key, value) in map {
                if SENSITIVE_JSON_KEYS
                    .iter()
                    .any(|sensitive| key.eq_ignore_ascii_case(sensitive))
                {
                    redacted.insert(key, Value::String(REDACTED.to_string()));
                } else {
                    redacted.insert(key, redact_json_value(value, redactor));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .map(|item| redact_json_value(item, redactor))
                .collect(),
        ),
        Value::String(text) => Value::String(redactor.redact(&text)),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CANARY: &str = "sk-canary-0123456789";

    #[test]
    fn replaces_exact_secret_values_anywhere() {
        let redacted = redact_credentials(
            &format!("invalid key {CANARY} in request body {CANARY} again"),
            &[CANARY],
        );
        assert!(!redacted.contains(CANARY));
        assert_eq!(redacted.matches(REDACTED).count(), 2);
        assert!(redacted.contains("invalid key"));
    }

    #[test]
    fn replaces_longest_secret_first() {
        let redacted = redact_credentials(
            "prefix-secret and prefix-secret-suffix",
            &["prefix-secret", "prefix-secret-suffix"],
        );
        assert!(!redacted.contains("prefix-secret"));
        assert_eq!(redacted.matches(REDACTED).count(), 2);
    }

    #[test]
    fn redacts_short_known_secrets_and_ignores_empty_values() {
        let redacted = redact_credentials("invalid key abc", &["abc"]);
        assert_eq!(redacted, "invalid key [REDACTED]");
        assert_eq!(redact_credentials("plain", &[""]), "plain");
    }

    #[test]
    fn redacts_authorization_header_with_scheme() {
        for text in [
            "Authorization: Bearer sk-live-abcdef",
            "authorization: basic dXNlcjpwYXNz",
            r#""authorization": "Bearer sk-live-abcdef""#,
            "Proxy-Authorization: Bearer sk-live-abcdef",
        ] {
            let redacted = redact_credentials(text, &[]);
            assert!(!redacted.contains("sk-live-abcdef"), "{text} -> {redacted}");
            assert!(!redacted.contains("dXNlcjpwYXNz"), "{text} -> {redacted}");
            assert!(redacted.contains(REDACTED), "{text} -> {redacted}");
        }
    }

    #[test]
    fn redacts_bare_credential_headers() {
        for text in [
            "x-api-key: sk-live-abcdef",
            "X-API-KEY: sk-live-abcdef",
            "api-key: sk-live-abcdef",
            "apikey: sk-live-abcdef",
            "Authorization: sk-live-abcdef",
        ] {
            let redacted = redact_credentials(text, &[]);
            assert!(!redacted.contains("sk-live-abcdef"), "{text} -> {redacted}");
            assert!(redacted.contains(REDACTED), "{text} -> {redacted}");
        }
    }

    #[test]
    fn redacts_standalone_bearer_tokens_in_prose() {
        let redacted = redact_credentials("the token Bearer sk-live-abcdef was rejected", &[]);
        assert!(!redacted.contains("sk-live-abcdef"));
        assert!(redacted.contains("Bearer [REDACTED]"));
        assert!(redacted.contains("was rejected"));
    }

    #[test]
    fn bearer_pattern_ignores_ordinary_prose() {
        for text in [
            "use a bearer token for authentication",
            "basic authentication is not supported",
            "the Bearer scheme expects a token",
        ] {
            assert_eq!(redact_credentials(text, &[]), text, "{text}");
        }
    }

    #[test]
    fn bearer_pattern_still_matches_credential_shaped_tokens() {
        for (text, secret) in [
            ("token Bearer dXNlcjpwYXNz rejected", "dXNlcjpwYXNz"),
            ("token Bearer abc123def456 rejected", "abc123def456"),
            ("token Basic QWxhZGRpbjpvcGVu rejected", "QWxhZGRpbjpvcGVu"),
        ] {
            let redacted = redact_credentials(text, &[]);
            assert!(!redacted.contains(secret), "{text} -> {redacted}");
            assert!(redacted.contains(REDACTED), "{text} -> {redacted}");
        }
    }

    #[test]
    fn redacts_url_userinfo() {
        let redacted =
            redact_credentials("endpoint https://user:pass@api.example.com/v1 refused", &[]);
        assert!(!redacted.contains("user:pass"));
        assert!(redacted.contains("https://[REDACTED]@api.example.com"));
        // Ports are not userinfo and must survive.
        assert_eq!(
            redact_credentials("http://host:8080/path", &[]),
            "http://host:8080/path"
        );
    }

    #[test]
    fn preserves_ordinary_error_prose() {
        let text = "no credits remaining; rate limit exceeded; context too long";
        assert_eq!(redact_credentials(text, &[]), text);
    }

    #[test]
    fn redacts_sensitive_json_keys_case_insensitively() {
        let body = r#"{"error":{"message":"bad request","API_KEY":"sk-json-1","Authorization":"Bearer sk-json-2","access_token":"tok-json-3","refresh_token":"tok-json-4","token":"tok-json-5","secret":"s-json-6","password":"p-json-7","key":"k-json-8","cookie":"c-json-9","set-cookie":"sc-json-10","api_key":"ak-json-11","apikey":"ak-json-12","api-key":"ak-json-13","x-api-key":"xk-json-14"}}"#;
        let redacted = redact_json_body(body, &[]);
        assert!(!redacted.contains("sk-json-1"));
        assert!(!redacted.contains("sk-json-2"));
        assert!(!redacted.contains("tok-json-3"));
        assert!(!redacted.contains("tok-json-4"));
        assert!(!redacted.contains("tok-json-5"));
        assert!(!redacted.contains("s-json-6"));
        assert!(!redacted.contains("p-json-7"));
        assert!(!redacted.contains("k-json-8"));
        assert!(!redacted.contains("c-json-9"));
        assert!(!redacted.contains("sc-json-10"));
        assert!(!redacted.contains("ak-json-11"));
        assert!(!redacted.contains("ak-json-12"));
        assert!(!redacted.contains("ak-json-13"));
        assert!(!redacted.contains("xk-json-14"));
        assert!(redacted.contains("\"message\":\"bad request\""));
        assert_eq!(redacted.matches(REDACTED).count(), 14);
    }

    #[test]
    fn redacts_secret_values_inside_json_strings() {
        let body = format!(r#"{{"error":"invalid key {CANARY} supplied"}}"#);
        let redacted = redact_json_body(&body, &[CANARY]);
        assert!(!redacted.contains(CANARY));
        assert!(redacted.contains("invalid key [REDACTED] supplied"));
    }

    #[test]
    fn falls_back_to_text_redaction_for_non_json_bodies() {
        let body = format!("plain text with {CANARY} inside");
        let redacted = redact_json_body(&body, &[CANARY]);
        assert!(!redacted.contains(CANARY));
        assert!(redacted.contains("plain text with [REDACTED] inside"));
    }

    #[test]
    fn redacts_nested_arrays_and_objects() {
        let body = r#"{"errors":[{"key":"sk-nested-1"},{"detail":{"token":"tok-nested-2"}}]}"#;
        let redacted = redact_json_body(body, &[]);
        assert!(!redacted.contains("sk-nested-1"));
        assert!(!redacted.contains("tok-nested-2"));
        assert_eq!(redacted.matches(REDACTED).count(), 2);
    }
}
