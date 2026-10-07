//! Rust consumer of B's exact runtime-control-v1 contract at e17cb1cdae056e5b.
//! Pure format/digest/comparison only: no authentication, nonce consumption,
//! lease persistence or effect permission is established by successful parsing.

#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "canonical consumer awaits issuer/admission composition"
    )
)]

use serde::{
    de::{self, MapAccess, Visitor},
    Deserialize, Deserializer,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fmt};
use uuid::Uuid;

type Fields = BTreeMap<String, Value>;
const MAX_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy)]
enum Kind {
    Text,
    Uuid,
    Hex,
    Integer,
    NullableUuid,
    NullableInteger,
    Phase,
}

const ASSIGNMENT: &[(&str, Kind)] = &[
    ("environment", Kind::Text),
    ("provider_instance_id", Kind::Text),
    ("issuing_machine_id", Kind::Text),
    ("receiving_machine_id", Kind::Text),
    ("receiving_scope", Kind::Text),
    ("host_incarnation_id", Kind::Text),
    ("pvc_uid", Kind::Text),
    ("runtime_release", Kind::Text),
    ("policy_revision", Kind::Text),
    ("operation_id", Kind::Uuid),
    ("managed_host_id", Kind::Uuid),
    ("organization_id", Kind::Uuid),
    ("beneficiary_user_id", Kind::Uuid),
    ("beneficiary_profile_id", Kind::Uuid),
    ("full_input_sha256", Kind::Hex),
    ("runtime_release_sha256", Kind::Hex),
    ("organization_generation", Kind::Integer),
    ("beneficiary_user_generation", Kind::Integer),
    ("beneficiary_profile_generation", Kind::Integer),
    ("owner_epoch", Kind::Integer),
    ("key_generation", Kind::Integer),
];
const CHALLENGE: &[(&str, Kind)] = &[
    ("challenge_version", Kind::Integer),
    ("previous_lease_sequence", Kind::Integer),
    ("issued_at_epoch_ms", Kind::Integer),
    ("expires_at_epoch_ms", Kind::Integer),
    ("native_deadline_epoch_ms", Kind::Integer),
    ("control_channel_id", Kind::Uuid),
    ("challenge_id", Kind::Hex),
    ("lease_phase", Kind::Phase),
    ("previous_lease_id", Kind::NullableUuid),
    ("native_session_id", Kind::NullableUuid),
    ("native_run_id", Kind::NullableUuid),
    ("previous_expires_at_epoch_ms", Kind::NullableInteger),
];
const RESPONSE: &[(&str, Kind)] = &[
    ("response_version", Kind::Integer),
    ("lease_version", Kind::Integer),
    ("lease_sequence", Kind::Integer),
    ("observed_at_epoch_ms", Kind::Integer),
    ("expires_at_epoch_ms", Kind::Integer),
    ("lease_id", Kind::Uuid),
    ("control_channel_id", Kind::Uuid),
    ("challenge_id", Kind::Hex),
    ("challenge_sha256", Kind::Hex),
    ("lease_phase", Kind::Phase),
    ("native_session_id", Kind::NullableUuid),
    ("native_run_id", Kind::NullableUuid),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RuntimeControlDenied;
impl fmt::Display for RuntimeControlDenied {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("runtime control comparison unavailable")
    }
}
impl std::error::Error for RuntimeControlDenied {}
type Result<T> = std::result::Result<T, RuntimeControlDenied>;

fn require(condition: bool) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(RuntimeControlDenied)
    }
}
fn valid_uuid(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|text| Uuid::parse_str(text).is_ok_and(|id| id.to_string() == text))
}
fn valid_integer(value: &Value) -> bool {
    value.as_i64().is_some_and(|n| n >= 0)
}
fn valid(value: &Value, kind: Kind) -> bool {
    match kind {
        Kind::Text => value.as_str().is_some_and(|text| {
            !text.is_empty() && text.chars().count() <= 512 && !text.chars().any(|c| c < '\u{20}')
        }),
        Kind::Uuid => valid_uuid(value),
        Kind::Hex => value.as_str().is_some_and(|text| {
            text.len() == 64
                && text
                    .bytes()
                    .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        }),
        Kind::Integer => valid_integer(value),
        Kind::NullableUuid => value.is_null() || valid_uuid(value),
        Kind::NullableInteger => value.is_null() || valid_integer(value),
        Kind::Phase => matches!(value.as_str(), Some("initial" | "renewal")),
    }
}
fn shape(fields: &Fields, extra: &[(&str, Kind)]) -> Result<()> {
    require(fields.len() == ASSIGNMENT.len() + extra.len())?;
    for (name, kind) in ASSIGNMENT.iter().chain(extra.iter()) {
        require(fields.get(*name).is_some_and(|value| valid(value, *kind)))?;
    }
    require(integer(fields, "owner_epoch")? > 0)?;
    let initial = fields["lease_phase"] == "initial";
    require(
        ["native_session_id", "native_run_id"]
            .iter()
            .all(|name| fields[*name].is_null() == initial),
    )
}
fn integer(fields: &Fields, name: &str) -> Result<i64> {
    fields
        .get(name)
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0)
        .ok_or(RuntimeControlDenied)
}
pub(super) fn canonical(fields: &Fields) -> Result<Vec<u8>> {
    let text = serde_json::to_string(fields)
        .map_err(|_| RuntimeControlDenied)?
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029");
    require(text.len() <= MAX_BYTES)?;
    Ok(text.into_bytes())
}
fn domain_digest(domain: &[u8], bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(domain);
    hash.update(bytes);
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

struct UniqueFields(Fields);
impl<'de> Deserialize<'de> for UniqueFields {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct UniqueVisitor;
        impl<'de> Visitor<'de> for UniqueVisitor {
            type Value = UniqueFields;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a unique flat runtime control object")
            }
            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut fields = Fields::new();
                while let Some(key) = map.next_key::<String>()? {
                    if fields.contains_key(&key) {
                        return Err(de::Error::custom("duplicate runtime field"));
                    }
                    fields.insert(key, map.next_value::<Value>()?);
                }
                Ok(UniqueFields(fields))
            }
        }
        deserializer.deserialize_map(UniqueVisitor)
    }
}
pub(super) fn decode(raw: &[u8]) -> Result<Fields> {
    require(!raw.is_empty() && raw.len() <= MAX_BYTES)?;
    serde_json::from_slice::<UniqueFields>(raw)
        .map(|fields| fields.0)
        .map_err(|_| RuntimeControlDenied)
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RuntimeChallenge(Fields);
impl RuntimeChallenge {
    pub(crate) fn decode(raw: &[u8]) -> Result<Self> {
        Self::from_fields(decode(raw)?)
    }
    pub(crate) fn from_fields(fields: Fields) -> Result<Self> {
        shape(&fields, CHALLENGE)?;
        require(integer(&fields, "challenge_version")? == 1)?;
        let issue = integer(&fields, "issued_at_epoch_ms")?;
        let expiry = integer(&fields, "expires_at_epoch_ms")?;
        require(
            expiry > issue
                && expiry - issue <= 10_000
                && expiry <= integer(&fields, "native_deadline_epoch_ms")?,
        )?;
        if fields["lease_phase"] == "initial" {
            require(
                fields["previous_lease_id"].is_null()
                    && fields["previous_expires_at_epoch_ms"].is_null()
                    && integer(&fields, "previous_lease_sequence")? == 0,
            )?;
        } else {
            require(
                !fields["previous_lease_id"].is_null()
                    && integer(&fields, "previous_lease_sequence")? > 0
                    && integer(&fields, "previous_expires_at_epoch_ms")?
                        == integer(&fields, "native_deadline_epoch_ms")?,
            )?;
        }
        canonical(&fields)?;
        Ok(Self(fields))
    }
    pub(crate) fn canonical(&self) -> Result<Vec<u8>> {
        canonical(&self.0)
    }
    pub(crate) fn sha256(&self) -> Result<String> {
        Ok(domain_digest(
            b"arcee.managed.runtime-challenge.v1\n",
            &self.canonical()?,
        ))
    }
    pub(crate) fn fields(&self) -> &Fields {
        &self.0
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RuntimeResponse(Fields);
impl RuntimeResponse {
    pub(crate) fn decode(raw: &[u8]) -> Result<Self> {
        Self::from_fields(decode(raw)?)
    }
    pub(crate) fn from_fields(fields: Fields) -> Result<Self> {
        shape(&fields, RESPONSE)?;
        require(
            integer(&fields, "response_version")? == 1
                && integer(&fields, "lease_version")? == 1
                && integer(&fields, "lease_sequence")? > 0,
        )?;
        let observed = integer(&fields, "observed_at_epoch_ms")?;
        let expiry = integer(&fields, "expires_at_epoch_ms")?;
        require(expiry > observed && expiry - observed <= 60_000)?;
        require(fields["lease_phase"] != "initial" || integer(&fields, "lease_sequence")? == 1)?;
        canonical(&fields)?;
        Ok(Self(fields))
    }
    pub(crate) fn canonical(&self) -> Result<Vec<u8>> {
        canonical(&self.0)
    }
    pub(crate) fn sha256(&self) -> Result<String> {
        Ok(domain_digest(
            b"arcee.managed.runtime-response.v1\n",
            &self.canonical()?,
        ))
    }
    pub(crate) fn fields(&self) -> &Fields {
        &self.0
    }
}

/// Pure comparison inputs mapped from independently qualified local facts.
/// This view is never accepted as operation authority from request JSON.
#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
pub(crate) struct RuntimeComparisonContext {
    pub assignment: Fields,
    pub control_channel_id: String,
    pub lease_phase: String,
    pub native_deadline_epoch_ms: i64,
    pub native_deadline_monotonic_ms: i64,
    pub now_epoch_ms: i64,
    pub now_monotonic_ms: i64,
    pub last_wall_clock_epoch_ms: i64,
    pub current_key_revocation_watermark: i64,
    pub previous_lease_id: Option<String>,
    pub previous_lease_sequence: i64,
    pub previous_expires_at_epoch_ms: Option<i64>,
    pub native_session_id: Option<String>,
    pub native_run_id: Option<String>,
}

/// Returns remaining absolute milliseconds, never a grant. The application must
/// separately authenticate the live channel, verify current policy/active run,
/// consume its outstanding challenge and durably advance the exact prior lease.
pub(crate) fn compare_exchange(
    challenge: &RuntimeChallenge,
    response: &RuntimeResponse,
    context: &RuntimeComparisonContext,
) -> Result<i64> {
    require(context.assignment.len() == ASSIGNMENT.len())?;
    for (name, kind) in ASSIGNMENT {
        require(
            context
                .assignment
                .get(*name)
                .is_some_and(|value| valid(value, *kind)),
        )?;
        require(
            challenge.0[*name] == context.assignment[*name]
                && response.0[*name] == context.assignment[*name],
        )?;
    }
    require(integer(&context.assignment, "owner_epoch")? > 0)?;
    for n in [
        context.native_deadline_epoch_ms,
        context.native_deadline_monotonic_ms,
        context.now_epoch_ms,
        context.now_monotonic_ms,
        context.last_wall_clock_epoch_ms,
        context.current_key_revocation_watermark,
        context.previous_lease_sequence,
    ] {
        require(n >= 0)?;
    }
    require(valid(
        &Value::String(context.control_channel_id.clone()),
        Kind::Uuid,
    ))?;
    for value in [
        &context.previous_lease_id,
        &context.native_session_id,
        &context.native_run_id,
    ] {
        require(
            value
                .as_ref()
                .is_none_or(|text| valid_uuid(&Value::String(text.clone()))),
        )?;
    }
    require(context.previous_expires_at_epoch_ms.is_none_or(|n| n >= 0))?;
    let bindings = [
        (
            "control_channel_id",
            Value::String(context.control_channel_id.clone()),
        ),
        ("lease_phase", Value::String(context.lease_phase.clone())),
        (
            "previous_lease_id",
            serde_json::to_value(&context.previous_lease_id).map_err(|_| RuntimeControlDenied)?,
        ),
        (
            "previous_lease_sequence",
            Value::from(context.previous_lease_sequence),
        ),
        (
            "previous_expires_at_epoch_ms",
            serde_json::to_value(context.previous_expires_at_epoch_ms)
                .map_err(|_| RuntimeControlDenied)?,
        ),
        (
            "native_session_id",
            serde_json::to_value(&context.native_session_id).map_err(|_| RuntimeControlDenied)?,
        ),
        (
            "native_run_id",
            serde_json::to_value(&context.native_run_id).map_err(|_| RuntimeControlDenied)?,
        ),
        (
            "native_deadline_epoch_ms",
            Value::from(context.native_deadline_epoch_ms),
        ),
    ];
    for (name, value) in bindings {
        require(challenge.0[name] == value)?;
    }
    for name in [
        "control_channel_id",
        "lease_phase",
        "native_session_id",
        "native_run_id",
        "challenge_id",
    ] {
        require(response.0[name] == challenge.0[name])?;
    }
    require(response.0["challenge_sha256"] == challenge.sha256()?)?;
    require(
        context.last_wall_clock_epoch_ms <= context.now_epoch_ms
            && context.now_monotonic_ms < context.native_deadline_monotonic_ms,
    )?;
    let issue = integer(&challenge.0, "issued_at_epoch_ms")?;
    let observed = integer(&response.0, "observed_at_epoch_ms")?;
    let expiry = integer(&challenge.0, "expires_at_epoch_ms")?;
    require(
        issue <= observed
            && observed <= context.now_epoch_ms
            && context.now_epoch_ms < expiry
            && expiry <= context.native_deadline_epoch_ms,
    )?;
    let lease_expiry = integer(&response.0, "expires_at_epoch_ms")?;
    require(
        context.now_epoch_ms < lease_expiry
            && integer(&context.assignment, "key_generation")?
                > context.current_key_revocation_watermark,
    )?;
    if context.lease_phase == "initial" {
        require(lease_expiry <= context.native_deadline_epoch_ms)?;
    } else {
        require(
            response.0["lease_id"]
                == serde_json::to_value(&context.previous_lease_id)
                    .map_err(|_| RuntimeControlDenied)?
                && integer(&response.0, "lease_sequence")? > context.previous_lease_sequence,
        )?;
    }
    Ok(lease_expiry - context.now_epoch_ms)
}

#[cfg(test)]
#[path = "managed_runtime_control_tests.rs"]
mod tests;
