//! Native consumer of B's unchanged HTTP237 canonical original intent.
//! Parsing and exact HTTP comparison grant no authentication or dispatch.
#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "original intent consumer awaits default-off receiver composition"
    )
)]

use super::control::{canonical, decode, RuntimeControlDenied};
use axum::http::{request::Parts, HeaderMap};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use uuid::Uuid;

type Fields = BTreeMap<String, Value>;
type Result<T> = std::result::Result<T, RuntimeControlDenied>;

pub(super) struct RuntimeIntentReceiver<'a> {
    pub environment: &'a str,
    pub instance: &'a str,
    pub receiver: &'a str,
    pub scope: &'a str,
}

const STRINGS: &[(&str, usize)] = &[
    ("environment", 512),
    ("provider_instance_id", 512),
    ("receiving_machine_id", 512),
    ("receiving_scope", 512),
    ("pvc_uid", 512),
    ("content_type", 128),
    ("host_incarnation_id", 512),
    ("policy_revision", 512),
    ("runtime_release", 512),
    ("method", 16),
    ("normalized_path", 2048),
    ("normalized_query", 4096),
];
const UUIDS: &[&str] = &[
    "operation_id",
    "actor_user_id",
    "actor_profile_id",
    "beneficiary_user_id",
    "beneficiary_profile_id",
    "organization_id",
    "managed_host_id",
];
const DIGESTS: &[&str] = &["body_sha256", "runtime_release_sha256"];
const INTEGERS: &[&str] = &[
    "intent_version",
    "owner_epoch",
    "key_generation",
    "actor_profile_generation",
    "beneficiary_profile_generation",
    "created_at_epoch_ms",
    "expires_at_epoch_ms",
];

fn require(condition: bool) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(RuntimeControlDenied)
    }
}
fn text<'a>(fields: &'a Fields, name: &str) -> Result<&'a str> {
    fields
        .get(name)
        .and_then(Value::as_str)
        .ok_or(RuntimeControlDenied)
}
fn integer(fields: &Fields, name: &str) -> Result<i64> {
    fields
        .get(name)
        .and_then(Value::as_i64)
        .filter(|value| *value >= 0)
        .ok_or(RuntimeControlDenied)
}
fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn one_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next().ok_or(RuntimeControlDenied)?;
    require(values.next().is_none())?;
    value.to_str().map_err(|_| RuntimeControlDenied)
}

#[derive(Debug)]
pub(super) struct RuntimeHttpIntent(Fields);
impl RuntimeHttpIntent {
    pub(super) fn decode(raw: &[u8]) -> Result<Self> {
        Self::from_fields(decode(raw)?)
    }
    fn from_fields(fields: Fields) -> Result<Self> {
        require(fields.len() == STRINGS.len() + UUIDS.len() + DIGESTS.len() + INTEGERS.len())?;
        for (name, maximum) in STRINGS {
            let value = text(&fields, name)?;
            require(
                value.chars().count() <= *maximum
                    && !value.chars().any(|c| c < '\u{20}')
                    && (!value.is_empty() || matches!(*name, "content_type" | "normalized_query")),
            )?;
        }
        for name in UUIDS {
            let value = text(&fields, name)?;
            require(Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value))?;
        }
        for name in DIGESTS {
            let value = text(&fields, name)?;
            require(
                value.len() == 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
            )?;
        }
        for name in INTEGERS {
            integer(&fields, name)?;
        }
        require(integer(&fields, "intent_version")? == 1 && integer(&fields, "owner_epoch")? > 0)?;
        require(
            fields["actor_user_id"] == fields["beneficiary_user_id"]
                && fields["actor_profile_id"] == fields["beneficiary_profile_id"]
                && fields["actor_profile_generation"] == fields["beneficiary_profile_generation"],
        )?;
        let lifetime =
            integer(&fields, "expires_at_epoch_ms")? - integer(&fields, "created_at_epoch_ms")?;
        require(lifetime > 0 && lifetime <= 300_000)?;
        require(
            text(&fields, "method")?
                .bytes()
                .all(|byte| byte.is_ascii_uppercase()),
        )?;
        let path = text(&fields, "normalized_path")?;
        require(path.starts_with('/') && !path.contains(['?', '#']))?;
        canonical(&fields)?;
        Ok(Self(fields))
    }
    pub(super) fn canonical(&self) -> Result<Vec<u8>> {
        canonical(&self.0)
    }
    pub(super) fn sha256(&self) -> Result<String> {
        Ok(digest(&self.canonical()?))
    }
    pub(super) fn original_expires_ms(&self) -> Result<i64> {
        integer(&self.0, "expires_at_epoch_ms")
    }

    /// Original dispatch window, not a continuation lease renewal check.
    pub(super) fn compare_retained(
        &self,
        receiver: &RuntimeIntentReceiver<'_>,
        full_input_sha256: &str,
        body: &[u8],
        now_ms: i64,
    ) -> Result<()> {
        for (name, expected) in [
            ("environment", receiver.environment),
            ("provider_instance_id", receiver.instance),
            ("receiving_machine_id", receiver.receiver),
            ("receiving_scope", receiver.scope),
        ] {
            require(text(&self.0, name)? == expected)?;
        }
        require(
            self.sha256()? == full_input_sha256 && digest(body) == text(&self.0, "body_sha256")?,
        )?;
        require(
            integer(&self.0, "created_at_epoch_ms")? <= now_ms
                && now_ms < self.original_expires_ms()?,
        )
    }

    /// Compare the actual incoming bytes/parts. No body JSON normalization,
    /// query sorting, path decoding, proxy headers or caller lease envelope.
    /// Authority/current policy and closed route inventory remain separate.
    pub(super) fn compare_actual(&self, parts: &Parts, body: &[u8], now_ms: i64) -> Result<()> {
        let operation = one_header(&parts.headers, "x-arcee-managed-operation-id")?;
        let full_input = one_header(&parts.headers, "x-arcee-managed-intent-sha256")?;
        require(operation == text(&self.0, "operation_id")? && full_input == self.sha256()?)?;
        require(
            parts.uri.scheme().is_none()
                && parts.uri.authority().is_none()
                && parts.uri.query() != Some(""),
        )?;
        let content_type = if parts.headers.contains_key("content-type") {
            let value = one_header(&parts.headers, "content-type")?;
            require(!value.is_empty())?;
            value
        } else {
            ""
        };
        require(
            parts.method.as_str() == text(&self.0, "method")?
                && parts.uri.path() == text(&self.0, "normalized_path")?
                && parts.uri.query().unwrap_or("") == text(&self.0, "normalized_query")?
                && content_type == text(&self.0, "content_type")?,
        )?;
        require(digest(body) == text(&self.0, "body_sha256")?)?;
        require(
            integer(&self.0, "created_at_epoch_ms")? <= now_ms
                && now_ms < self.original_expires_ms()?,
        )
    }

    /// Compare every assignment fact represented by HTTP237 and the exact full
    /// input SHA. Independent current org/user generations and issuing-machine
    /// identity are provided by the separately authenticated preparation policy;
    /// HTTP237 does not contain them and cannot be used to infer them.
    pub(super) fn compare_assignment(&self, assignment: &Fields) -> Result<()> {
        for name in [
            "environment",
            "provider_instance_id",
            "receiving_machine_id",
            "receiving_scope",
            "host_incarnation_id",
            "pvc_uid",
            "runtime_release",
            "policy_revision",
            "operation_id",
            "managed_host_id",
            "organization_id",
            "beneficiary_user_id",
            "beneficiary_profile_id",
            "runtime_release_sha256",
            "beneficiary_profile_generation",
            "owner_epoch",
            "key_generation",
        ] {
            require(assignment.get(name) == self.0.get(name))?;
        }
        require(
            assignment.get("full_input_sha256").and_then(Value::as_str)
                == Some(self.sha256()?.as_str()),
        )
    }
}

#[cfg(test)]
#[path = "managed_runtime_intent_tests.rs"]
mod tests;
