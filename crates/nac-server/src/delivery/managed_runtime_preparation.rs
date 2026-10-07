//! Pure consumer of B's preparation-v1 at b9a0e1fa6cdcae0d. Successful decoding
//! or comparison establishes neither TLS identity, policy nor effect authority.
#![cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "preparation awaits qualified issuer/admission composition"
    )
)]

use super::{
    control::{
        assignment_fields, canonical_bounded, decode_bounded, domain_digest, valid_uuid,
        RuntimeControlDenied,
    },
    intent::{RuntimeActualRequest, RuntimeHttpIntent},
};
use serde_json::Value;
use std::collections::BTreeMap;

type Fields = BTreeMap<String, Value>;
type Result<T> = std::result::Result<T, RuntimeControlDenied>;
const HELLO_MAX_BYTES: usize = 1024;
const PREPARATION_MAX_BYTES: usize = 65536;
const HELLO_DOMAIN: &[u8] = b"arcee.managed.runtime-channel.v1\n";
const PREPARATION_DOMAIN: &[u8] = b"arcee.managed.runtime-preparation.v1\n";

fn require(condition: bool) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(RuntimeControlDenied)
    }
}
fn integer(fields: &Fields, name: &str) -> Result<i64> {
    fields
        .get(name)
        .and_then(Value::as_i64)
        .filter(|n| *n >= 0)
        .ok_or(RuntimeControlDenied)
}
fn text<'a>(fields: &'a Fields, name: &str) -> Result<&'a str> {
    fields
        .get(name)
        .and_then(Value::as_str)
        .ok_or(RuntimeControlDenied)
}

pub(super) struct RuntimeChannelHello(Fields);
impl RuntimeChannelHello {
    /// Native generates the accepted hello only for the retained actual dialog.
    /// This identifies its transport; it grants no product/effect authority.
    pub(super) fn for_live_dialog(dialog: &super::issuer::IssuerControlDialog) -> Result<Self> {
        let peer = dialog.peer();
        peer.check_live().map_err(|_| RuntimeControlDenied)?;
        let fields = Fields::from([
            ("channel_version".into(), Value::from(1)),
            (
                "control_channel_id".into(),
                Value::String(peer.channel_id().to_string()),
            ),
        ]);
        let hello = Self::decode(&canonical_bounded(&fields, HELLO_MAX_BYTES)?)?;
        peer.check_live().map_err(|_| RuntimeControlDenied)?;
        Ok(hello)
    }
    pub(super) fn decode(raw: &[u8]) -> Result<Self> {
        let fields = decode_bounded(raw, HELLO_MAX_BYTES)?;
        require(fields.len() == 2 && integer(&fields, "channel_version")? == 1)?;
        require(fields.get("control_channel_id").is_some_and(valid_uuid))?;
        canonical_bounded(&fields, HELLO_MAX_BYTES)?;
        Ok(Self(fields))
    }
    pub(super) fn canonical(&self) -> Result<Vec<u8>> {
        canonical_bounded(&self.0, HELLO_MAX_BYTES)
    }
    pub(super) fn sha256(&self) -> Result<String> {
        Ok(domain_digest(HELLO_DOMAIN, &self.canonical()?))
    }
}

pub(super) struct RuntimePreparation {
    fields: Fields,
    intent: RuntimeHttpIntent,
    assignment: Fields,
}
impl RuntimePreparation {
    pub(super) fn decode(raw: &[u8]) -> Result<Self> {
        let fields = decode_bounded(raw, PREPARATION_MAX_BYTES)?;
        let assignment = assignment_fields(&fields)?;
        require(fields.len() == 27 && integer(&fields, "preparation_version")? == 1)?;
        require(fields.get("control_channel_id").is_some_and(valid_uuid))?;
        let original = text(&fields, "original_http_intent_utf8")?.as_bytes();
        let intent = RuntimeHttpIntent::decode(original)?;
        require(intent.canonical()? == original)?;
        intent.compare_assignment(&assignment)?;
        let observed = integer(&fields, "observed_at_epoch_ms")?;
        let expires = integer(&fields, "expires_at_epoch_ms")?;
        let deadline = integer(&fields, "native_deadline_epoch_ms")?;
        require(expires > observed && expires - observed <= 10000)?;
        require(
            intent.original_created_ms()? <= observed
                && expires <= deadline
                && deadline <= intent.original_expires_ms()?,
        )?;
        canonical_bounded(&fields, PREPARATION_MAX_BYTES)?;
        Ok(Self {
            fields,
            intent,
            assignment,
        })
    }
    pub(super) fn canonical(&self) -> Result<Vec<u8>> {
        canonical_bounded(&self.fields, PREPARATION_MAX_BYTES)
    }
    pub(super) fn sha256(&self) -> Result<String> {
        Ok(domain_digest(PREPARATION_DOMAIN, &self.canonical()?))
    }
}

/// Independently retained facts; construction does not authenticate provenance.
/// Request headers must already pass singleton parsing. Both monotonic deadlines
/// retain their original anchors, rather than restarting on receipt or compare.
pub(super) struct RuntimePreparationContext<'a> {
    pub assignment: &'a Fields,
    pub control_channel_id: &'a str,
    pub native_deadline_epoch_ms: i64,
    pub native_deadline_monotonic_ms: i64,
    pub preparation_deadline_monotonic_ms: i64,
    pub now_epoch_ms: i64,
    pub now_monotonic_ms: i64,
    pub last_wall_clock_epoch_ms: i64,
    pub current_key_revocation_watermark: i64,
    pub request: RuntimeActualRequest<'a>,
}

/// Remaining milliseconds only. Repeated success is intentionally not a nonce
/// consume, operation reservation, fresh-policy result or execution capability.
pub(super) fn compare_preparation(
    hello: &RuntimeChannelHello,
    preparation: &RuntimePreparation,
    context: &RuntimePreparationContext<'_>,
) -> Result<i64> {
    let assignment = assignment_fields(context.assignment)?;
    require(context.assignment.len() == assignment.len())?;
    require(valid_uuid(&Value::String(
        context.control_channel_id.into(),
    )))?;
    require(
        [
            context.native_deadline_epoch_ms,
            context.native_deadline_monotonic_ms,
            context.preparation_deadline_monotonic_ms,
            context.now_epoch_ms,
            context.now_monotonic_ms,
            context.last_wall_clock_epoch_ms,
            context.current_key_revocation_watermark,
        ]
        .iter()
        .all(|n| *n >= 0),
    )?;
    let fields = &preparation.fields;
    require(
        text(&hello.0, "control_channel_id")? == context.control_channel_id
            && text(fields, "control_channel_id")? == context.control_channel_id
            && preparation.assignment == assignment
            && integer(fields, "native_deadline_epoch_ms")? == context.native_deadline_epoch_ms
            && context.last_wall_clock_epoch_ms <= context.now_epoch_ms
            && context.now_monotonic_ms < context.native_deadline_monotonic_ms
            && context.now_monotonic_ms < context.preparation_deadline_monotonic_ms
            && integer(fields, "observed_at_epoch_ms")? <= context.now_epoch_ms
            && context.now_epoch_ms < integer(fields, "expires_at_epoch_ms")?
            && integer(&assignment, "key_generation")? > context.current_key_revocation_watermark,
    )?;
    preparation
        .intent
        .compare_request_values(&context.request)?;
    [
        integer(fields, "expires_at_epoch_ms")? - context.now_epoch_ms,
        context.native_deadline_monotonic_ms - context.now_monotonic_ms,
        context.preparation_deadline_monotonic_ms - context.now_monotonic_ms,
    ]
    .into_iter()
    .min()
    .ok_or(RuntimeControlDenied)
}

/// Bind the pure comparison to the actual retained, singly owned TLS dialog.
/// Remaining time is still observational, not a reservation or execution grant.
pub(super) fn compare_preparation_on_dialog(
    dialog: &super::issuer::IssuerControlDialog,
    hello: &RuntimeChannelHello,
    preparation: &RuntimePreparation,
    context: &RuntimePreparationContext<'_>,
) -> Result<i64> {
    let peer = dialog.peer();
    peer.check_live().map_err(|_| RuntimeControlDenied)?;
    require(context.control_channel_id == peer.channel_id().to_string())?;
    let remaining = compare_preparation(hello, preparation, context)?;
    peer.check_live().map_err(|_| RuntimeControlDenied)?;
    Ok(remaining)
}

#[cfg(test)]
#[path = "managed_runtime_preparation_tests.rs"]
mod tests;
