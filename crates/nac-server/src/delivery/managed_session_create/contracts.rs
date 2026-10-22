//! Strict mirror of AFM's owned v1 command DATA envelope. No grant serde exists.
use super::*;
use crate::application::managed_create_request::{
    ManagedCreateBinding, ManagedCreateCurrentness, ValidatedManagedCreateRequest,
};
use crate::application::public_session_creation::{PublicCreateCurrentness, PublicCreationContext};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct EnvelopeV1 {
    schema: String,
    purpose: String,
    request_id: String,
    operation: OperationBinding,
    intent: IntentBinding,
    host: HostBinding,
    request: PublicNacCreateSession,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationBinding {
    id: Uuid,
    claim_sequence: i64,
    session_id: Uuid,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IntentBinding {
    canonical: Value,
    sha256: String,
    configuration_sha256: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct HostBinding {
    logical_host_id: Uuid,
    host_incarnation_id: String,
    authority_epoch: String,
    release_id: String,
    schema_version: i64,
    if_match: String,
}

impl EnvelopeV1 {
    pub(super) fn validate(
        self,
        request_id: &str,
        if_match: &str,
        manager: &SessionManager,
        original_cutoff: std::time::Instant,
        original_expiry_epoch_ms: i64,
    ) -> Result<ValidatedManagedCreateRequest, StatusCode> {
        let bad = StatusCode::BAD_REQUEST;
        if self.schema != PURPOSE
            || self.purpose != PURPOSE
            || self.request_id != request_id
            || self.request_id != self.operation.id.to_string()
            || self.operation.id.is_nil()
            || self.operation.session_id.is_nil()
            || self.operation.claim_sequence <= 0
            || !canonical_etag(&self.host.if_match)
        {
            return Err(bad);
        }
        if self.host.if_match != if_match {
            return Err(StatusCode::PRECONDITION_FAILED);
        }
        let command = self.request.into_command().map_err(|_| bad)?;
        let canonical = self.intent.canonical.as_array().ok_or(bad)?;
        if canonical.len() != 21 || canonical[0] != "native-session-operation-v3" {
            return Err(bad);
        }
        // Validate every member of AFM's canonical array before hashing. There
        // are no objects (and therefore no ignored duplicate/unknown keys).
        for index in [1, 2, 10, 17] {
            if !bounded_reference(&canonical[index]) {
                return Err(bad);
            }
        }
        for index in [3, 5, 7, 9, 13] {
            if uuid(&canonical[index]).is_none() {
                return Err(bad);
            }
        }
        for index in [4, 6, 8, 12, 14] {
            if !canonical[index].as_i64().is_some_and(|v| v >= 0) {
                return Err(bad);
            }
        }
        let epoch = canonical[11].as_i64().filter(|v| *v > 0).ok_or(bad)?;
        if canonical[15] != serde_json::json!(["create"])
            || self.host.authority_epoch != epoch.to_string()
            || uuid(&canonical[9]) != Some(self.host.logical_host_id)
            || canonical[10] != self.host.host_incarnation_id
            || self
                .host
                .host_incarnation_id
                .chars()
                .any(char::is_whitespace)
        {
            return Err(bad);
        }
        let target = canonical[16]
            .as_array()
            .filter(|v| v.len() == 3)
            .ok_or(bad)?;
        if !bounded_reference(&target[1]) || digest(&target[2]).is_none() {
            return Err(bad);
        }
        match &command.context {
            PublicCreationContext::Project(id) if target[0] == "project" && target[1] == *id => {}
            PublicCreationContext::WorkingLocation(id)
                if target[0] == "location" && target[1] == *id => {}
            _ => return Err(bad),
        }
        if command
            .model_config_id
            .as_ref()
            .is_some_and(|id| canonical[17] != *id)
            || digest(&canonical[18]).is_none()
            || digest(&canonical[20]).is_none()
        {
            return Err(bad);
        }
        let configuration = digest(&canonical[19]).ok_or(bad)?;
        let serialized = serde_json::to_vec(&self.intent.canonical).map_err(|_| bad)?;
        if self.intent.sha256 != lower_hex(&Sha256::digest(&serialized))
            || self.intent.configuration_sha256 != lower_hex(&configuration)
        {
            return Err(bad);
        }
        // Only the running Native tuple is compared here. Full source/config/
        // directory provenance and AFM primary continuity remain REQUIRED at
        // the real factory; selected tuple equality cannot grant admission.
        let running = manager
            .managed_location_binding()
            .map_err(|_| StatusCode::PRECONDITION_FAILED)?;
        if running.logical_host_id != self.host.logical_host_id.to_string()
            || running.host_incarnation_id != self.host.host_incarnation_id
            || running.release_id != self.host.release_id
            || running.supported_schema_version != self.host.schema_version
        {
            return Err(StatusCode::PRECONDITION_FAILED);
        }
        let intent_sha256 = Sha256::digest(serialized).into();
        Ok(ValidatedManagedCreateRequest::from_checked_envelope(
            command,
            ManagedCreateBinding {
                operation_id: self.operation.id,
                claim_sequence: self.operation.claim_sequence,
                intended_session_id: self.operation.session_id,
                canonical_intent: self.intent.canonical,
                intent_sha256,
                configuration_sha256: configuration,
            },
            ManagedCreateCurrentness {
                request: PublicCreateCurrentness {
                    request_id: self.request_id,
                    if_match: Some(self.host.if_match),
                },
                native: running,
                original_cutoff,
                original_expiry_epoch_ms,
            },
        ))
    }
}

fn uuid(value: &Value) -> Option<Uuid> {
    let text = value.as_str()?;
    let id = Uuid::parse_str(text).ok()?;
    (!id.is_nil() && id.to_string() == text).then_some(id)
}
fn bounded_reference(value: &Value) -> bool {
    value
        .as_str()
        .is_some_and(|s| !s.is_empty() && s.len() <= 256 && !s.contains('\0'))
}
fn digest(value: &Value) -> Option<[u8; 32]> {
    serde_json::from_value(value.clone()).ok()
}
fn lower_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(out, "{byte:02x}");
    }
    out
}
fn canonical_etag(value: &str) -> bool {
    value.len() == 66
        && value.starts_with('"')
        && value.ends_with('"')
        && value[1..65]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
