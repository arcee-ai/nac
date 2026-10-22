//! Exact initial-import JWS wire schema. Deserializing this is not authority.
use nac_contracts::{ImportProofKind, ProtectedImportPhase};
use serde::{Deserialize, Serialize};

/// Nonsecret signed observations. Only `VerifiedImportProof` denotes successful
/// cryptographic validation; neither type grants import, Ready or execution.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ImportProofClaims {
    pub iss: String,
    pub aud: String,
    pub iat: i64,
    pub nbf: i64,
    pub exp: i64,
    pub jti: String,
    pub v: u32,
    pub phase: ProtectedImportPhase,
    pub proof_type: ImportProofKind,
    pub sequence: u8,
    pub grant_id: String,
    pub attempt_id: String,
    pub purpose: String,
    pub environment: String,
    pub provider_instance_id: String,
    pub operation_id: String,
    pub original_input_sha256: String,
    pub full11_bootstrap_id: String,
    pub full11_managed_host_id: String,
    pub full11_host_incarnation_id: String,
    pub full11_pvc_uid: String,
    pub full11_organization_id: String,
    pub full11_owner_epoch: i64,
    pub full11_key_generation: i64,
    pub full11_local_key_id: String,
    pub full11_provider_key_id: String,
    pub full11_clerk_instance_id: String,
    pub full11_inference_origin: String,
    pub actor_id: String,
    pub beneficiary_id: String,
    pub profile_id: String,
    pub eligible_subject_user_id: String,
    pub eligible_subject_organization_id: String,
    pub eligible_subject_profile_id: String,
    pub eligible_subject_tenant_role: String,
    pub eligible_subject_platform_role: String,
    pub eligible_subject_user_generation: i64,
    pub eligible_subject_organization_generation: i64,
    pub eligible_subject_profile_generation: i64,
    pub policy_generation: i64,
    pub revocation_generation: i64,
    pub host_generation: i64,
    pub product_release_id: String,
    pub product_artifact_sha256: String,
    pub lifecycle_check_sequence: i64,
    pub lifecycle_check_sha256: String,
    pub operation_revision: i64,
    pub source_deliver_check_sha256: String,
    pub source_audit_id: String,
    pub initial_imported_check_sha256: String,
    pub current_imported_check_sha256: String,
    pub authority_config_uid: String,
    pub authority_config_resource_version: String,
    pub managed_resource_uid: String,
    pub managed_resource_resource_version: String,
    pub managed_resource_generation: i64,
    pub controller_pvc_uid: String,
    pub controller_pvc_resource_version: String,
    pub controller_machine_id: String,
    pub d_certificate_sha256: String,
    pub host_incarnation_id: String,
    pub organization_id: String,
    pub profile_generation: i64,
    pub owner_epoch: i64,
    pub product_key_generation: i64,
    pub target_key_generation: i64,
    pub issuer_key_id: String,
    pub issuer_key_generation: i64,
    pub authority_channel_lifetime_id: String,
    pub native_certificate_sha256: String,
    pub authority_channel_binding_sha256: String,
    pub source_expires_at_unix_ms: i64,
    pub nonce_hex: String,
    pub nonce_sha256: String,
    pub remaining_deadline_budget_ms: i64,
    pub issued_proof_sha256: Option<String>,
    pub preceding_proof_sha256: Option<String>,
    pub consumed_audit_id: Option<String>,
}

impl ImportProofClaims {
    pub(super) fn validate(
        &self,
    ) -> Result<(), super::protected_import_assertion::ImportProofError> {
        self.validate_version(1)
    }

    pub(super) fn validate_version(
        &self,
        version: u32,
    ) -> Result<(), super::protected_import_assertion::ImportProofError> {
        use super::protected_import_assertion::ImportProofError;
        let malformed = || ImportProofError::Malformed;
        let value = serde_json::to_value(self).map_err(|_| malformed())?;
        let fields = value.as_object().ok_or_else(malformed)?;
        // The closed DTO establishes field/type/order/nullability; every scalar
        // is additionally bounded and validated before it crosses the adapter.
        for (name, value) in fields {
            if let Some(text) = value.as_str() {
                let maximum = match name.as_str() {
                    "environment" | "issuer_key_id" => 128,
                    "iss" | "aud" | "full11_inference_origin" => 512,
                    _ => 256,
                };
                if text.is_empty()
                    || text.len() > maximum
                    || text.chars().any(|c| c.is_whitespace() || c.is_control())
                {
                    return Err(malformed());
                }
                if name.ends_with("_sha256") && !valid_digest(text) {
                    return Err(malformed());
                }
            }
            if let Some(number) = value.as_i64() {
                if number < 0 {
                    return Err(malformed());
                }
            }
        }
        for id in [
            &self.jti,
            &self.grant_id,
            &self.attempt_id,
            &self.operation_id,
            &self.full11_bootstrap_id,
            &self.full11_managed_host_id,
            &self.full11_organization_id,
            &self.full11_local_key_id,
            &self.actor_id,
            &self.beneficiary_id,
            &self.profile_id,
            &self.eligible_subject_user_id,
            &self.eligible_subject_organization_id,
            &self.eligible_subject_profile_id,
            &self.product_release_id,
            &self.source_audit_id,
            &self.authority_channel_lifetime_id,
            &self.organization_id,
        ] {
            canonical_uuid(id)?;
        }
        if let Some(id) = &self.consumed_audit_id {
            canonical_uuid(id)?;
        }
        if self.v != version
            || self.purpose != "initial_import"
            || self.issuer_key_generation <= 0
            || self.full11_owner_epoch <= 0
            || self.full11_key_generation <= 0
            || self.phase.sequence() != self.sequence
            || self.phase.required_proof_kind() != self.proof_type
            || !(1000..=60_000).contains(&self.remaining_deadline_budget_ms)
            || self.source_expires_at_unix_ms <= 0
            || self.full11_host_incarnation_id != self.host_incarnation_id
            || self.full11_pvc_uid != self.controller_pvc_uid
            || self.full11_organization_id != self.organization_id
            || self.full11_owner_epoch != self.owner_epoch
            || self.eligible_subject_organization_id != self.organization_id
            || self.eligible_subject_profile_id != self.profile_id
            || self.eligible_subject_profile_generation != self.profile_generation
            || self.grant_id == self.attempt_id
            || self.grant_id == self.authority_channel_lifetime_id
            || self.attempt_id == self.authority_channel_lifetime_id
            || !matches!(
                self.eligible_subject_tenant_role.as_str(),
                "owner" | "admin" | "user" | "viewer"
            )
            || !matches!(
                self.eligible_subject_platform_role.as_str(),
                "int_user" | "int_editor" | "int_admin" | "ext_user" | "ext_tester" | "ext_partner"
            )
        {
            return Err(malformed());
        }
        let nonce = decode_hex(&self.nonce_hex).ok_or_else(malformed)?;
        use sha2::{Digest, Sha256};
        let digest: [u8; 32] = Sha256::digest(nonce).into();
        if decode_hex(&self.nonce_sha256) != Some(digest) {
            return Err(malformed());
        }
        match self.sequence {
            0 if self.issued_proof_sha256.is_none()
                && self.preceding_proof_sha256.is_none()
                && self.consumed_audit_id.is_none() => {}
            1 if self.issued_proof_sha256.is_some()
                && self.issued_proof_sha256 == self.preceding_proof_sha256
                && self.consumed_audit_id.is_some() => {}
            2..=7
                if self.issued_proof_sha256.is_some()
                    && self.preceding_proof_sha256.is_some()
                    && self.consumed_audit_id.is_some() => {}
            _ => return Err(malformed()),
        }
        Ok(())
    }
}

pub(super) fn canonical_uuid(
    value: &str,
) -> Result<(), super::protected_import_assertion::ImportProofError> {
    let id = uuid::Uuid::parse_str(value)
        .map_err(|_| super::protected_import_assertion::ImportProofError::Malformed)?;
    if id.is_nil() || id.to_string() != value {
        return Err(super::protected_import_assertion::ImportProofError::Malformed);
    }
    Ok(())
}
pub(super) fn valid_digest(value: &str) -> bool {
    decode_hex(value).is_some_and(|bytes| bytes != [0; 32])
}
fn decode_hex(value: &str) -> Option<[u8; 32]> {
    if value.len() != 64 {
        return None;
    }
    let mut decoded = [0; 32];
    for (output, pair) in decoded.iter_mut().zip(value.as_bytes().as_chunks::<2>().0) {
        fn digit(c: u8) -> Option<u8> {
            match c {
                b'0'..=b'9' => Some(c - b'0'),
                b'a'..=b'f' => Some(c - b'a' + 10),
                _ => None,
            }
        }
        *output = digit(pair[0])? * 16 + digit(pair[1])?;
    }
    Some(decoded)
}
