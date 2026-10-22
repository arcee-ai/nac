//! Initial-import signature validation, separate from durable effect admission.
use crate::protected_import_claims::ImportProofClaims;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use nac_contracts::ProtectedImportPhase;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

#[path = "protected_import_digest.rs"]
mod digest;
#[path = "protected_import_trust.rs"]
mod trust;

const MAX_PROOF_BYTES: usize = 15_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImportProofError {
    Malformed,
    Signature,
    TrustUnavailable,
    Binding,
    Time,
    Unavailable,
}

impl std::fmt::Display for ImportProofError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Malformed => "initial import proof is malformed",
            Self::Signature => "initial import proof signature is invalid",
            Self::TrustUnavailable => "initial import public trust is unavailable",
            Self::Binding => "initial import proof binding is invalid",
            Self::Time => "initial import proof time bounds are invalid",
            Self::Unavailable => "initial import proof is unavailable",
        })
    }
}
impl std::error::Error for ImportProofError {}
type Result<T> = std::result::Result<T, ImportProofError>;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Header {
    typ: String,
    alg: String,
    kid: String,
    v: u32,
}

/// Expected operator/source context. This is nonsecret input, never authority.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ImportOriginalContext {
    pub version: u32,
    pub environment: String,
    pub provider_instance_id: String,
    pub operation_id: String,
    pub original_input_sha256: String,
    pub lifecycle_check_sequence: i64,
    pub lifecycle_check_sha256: String,
    pub product_release_id: String,
    pub product_artifact_sha256: String,
    pub source_expires_at_unix_ms: i64,
    pub max_exchange_duration_ms: i64,
}

impl ImportOriginalContext {
    /// Validate the operator's expected-context snapshot before waiting for D.
    /// This validates shape only; it does not authenticate the source facts.
    pub fn validate(&self) -> Result<()> {
        use crate::protected_import_claims::{canonical_uuid, valid_digest};
        canonical_uuid(&self.operation_id)?;
        canonical_uuid(&self.product_release_id)?;
        for (value, maximum) in [(&self.environment, 128), (&self.provider_instance_id, 256)] {
            if value.is_empty()
                || value.len() > maximum
                || value.chars().any(|c| c.is_whitespace() || c.is_control())
            {
                return Err(ImportProofError::Malformed);
            }
        }
        if self.version != 1
            || self.lifecycle_check_sequence < 0
            || self.source_expires_at_unix_ms <= 0
            || !(1..=60_000).contains(&self.max_exchange_duration_ms)
            || ![
                &self.original_input_sha256,
                &self.lifecycle_check_sha256,
                &self.product_artifact_sha256,
            ]
            .into_iter()
            .all(|digest| valid_digest(digest))
        {
            return Err(ImportProofError::Malformed);
        }
        Ok(())
    }
}

/// Exact expected private-slot identity, explicitly mapped by composition.
/// `provider_key_id` maps to Core's existing binding `key_id`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImportExpectedBinding {
    pub bootstrap_id: String,
    pub managed_host_id: String,
    pub host_incarnation_id: String,
    pub pvc_uid: String,
    pub organization_id: String,
    pub owner_epoch: i64,
    pub key_generation: i64,
    pub local_key_id: String,
    pub provider_key_id: String,
    pub clerk_instance_id: String,
    pub inference_origin: String,
}

/// Caller retains the actual channel and original clock owner. These values
/// must come from that owner; a copied expectation cannot confer authority.
pub struct ImportProofExpectation<'a> {
    pub context: &'a ImportOriginalContext,
    pub binding: &'a ImportExpectedBinding,
    pub phase: ProtectedImportPhase,
    pub attempt_id: &'a str,
    pub authority_channel_lifetime_id: &'a str,
    pub native_certificate_sha256: &'a str,
    pub d_certificate_sha256: &'a str,
    pub authority_channel_binding_sha256: &'a str,
    pub nonce_hex: &'a str,
    pub grant_id: Option<&'a str>,
    pub issued_proof_sha256: Option<&'a str>,
    pub preceding_proof_sha256: Option<&'a str>,
    /// Unknown before the authenticated consumed proof at sequence 1. Required
    /// and immutable for all current proofs; never a caller-created audit ID.
    pub consumed_audit_id: Option<&'a str>,
    /// Initially unknown to Native: Root authenticates D's original Go check.
    /// Later phases must retain the value from the verified issued proof.
    pub initial_imported_check_sha256: Option<&'a str>,
    pub maximum_expiry_unix_seconds: Option<i64>,
    pub maximum_remaining_deadline_budget_ms: i64,
    pub phase_sent_at: Instant,
    pub original_deadline: Instant,
}

/// Cryptographic validation only. This object is not a consumed import loan,
/// current-source fence, Ready result or runtime grant. Core must additionally
/// enforce phase lineage, immutable source fences and durable one-use consume.
/// It cannot be cloned/deserialized or reconstructed from a receipt row.
pub struct VerifiedImportProof {
    claims: ImportProofClaims,
    proof_sha256: [u8; 32],
    signing_key: [u8; 32],
    deadline: Instant,
    denied: AtomicBool,
}
impl VerifiedImportProof {
    pub fn claims(&self) -> &ImportProofClaims {
        &self.claims
    }
    pub fn proof_sha256(&self) -> &[u8; 32] {
        &self.proof_sha256
    }
    pub fn deadline(&self) -> Instant {
        self.deadline
    }
}

pub struct ImportProofVerifier {
    trust_file: PathBuf,
}
impl ImportProofVerifier {
    pub fn new(public_trust_file: impl AsRef<Path>) -> Self {
        Self {
            trust_file: public_trust_file.as_ref().to_path_buf(),
        }
    }

    /// Validate the exact Root bytes and the outstanding actual-channel phase.
    /// No network, private-key access, durable mutation or effect occurs here.
    pub fn verify(
        &self,
        compact: &str,
        expected: &ImportProofExpectation<'_>,
        now_unix_ms: i64,
    ) -> Result<VerifiedImportProof> {
        if compact.is_empty() || compact.len() > MAX_PROOF_BYTES || !compact.is_ascii() {
            return Err(ImportProofError::Malformed);
        }
        let parts: Vec<_> = compact.split('.').collect();
        let [header_segment, claims_segment, signature_segment] = parts.as_slice() else {
            return Err(ImportProofError::Malformed);
        };
        let header: Header = canonical_json(&decode(header_segment)?)?;
        if header.typ != "nac-managed-import+jwt" || header.alg != "EdDSA" || header.v != 1 {
            return Err(ImportProofError::Malformed);
        }
        let claims: ImportProofClaims = canonical_json(&decode(claims_segment)?)?;
        claims.validate()?;
        let key = trust::load(&self.trust_file)?.key(&header.kid, &claims, now_unix_ms)?;
        let signature = decode(signature_segment)?;
        if signature.len() != 64 {
            return Err(ImportProofError::Signature);
        }
        let signing_input = format!("{header_segment}.{claims_segment}");
        UnparsedPublicKey::new(&ED25519, key.public_key)
            .verify(signing_input.as_bytes(), &signature)
            .map_err(|_| ImportProofError::Signature)?;
        check_binding(&claims, expected)?;
        let now = Instant::now();
        let deadline = check_time(&claims, expected, now_unix_ms, now)?;
        Ok(VerifiedImportProof {
            claims,
            proof_sha256: Sha256::digest(compact.as_bytes()).into(),
            signing_key: key.public_key,
            deadline,
            denied: AtomicBool::new(false),
        })
    }

    /// Reload enrolled public trust at each protected borrow. This checks only
    /// issuer trust/expiry; genuine fresh Root/D source fences remain separate.
    /// Any denial sticks to this proof even if its key is later restored.
    pub fn recheck(&self, proof: &VerifiedImportProof, now_unix_ms: i64) -> Result<()> {
        let result = (|| {
            if proof.denied.load(Ordering::Acquire) {
                return Err(ImportProofError::Unavailable);
            }
            if Instant::now() >= proof.deadline
                || now_unix_ms <= 0
                || now_unix_ms
                    >= proof
                        .claims
                        .exp
                        .checked_mul(1000)
                        .ok_or(ImportProofError::Time)?
                || now_unix_ms
                    < proof
                        .claims
                        .nbf
                        .checked_mul(1000)
                        .ok_or(ImportProofError::Time)?
            {
                return Err(ImportProofError::Time);
            }
            let key = trust::load(&self.trust_file)?.key(
                &proof.claims.issuer_key_id,
                &proof.claims,
                now_unix_ms,
            )?;
            if key.public_key != proof.signing_key {
                return Err(ImportProofError::TrustUnavailable);
            }
            if proof.denied.load(Ordering::Acquire) {
                return Err(ImportProofError::Unavailable);
            }
            Ok(())
        })();
        if result.is_err() {
            proof.denied.store(true, Ordering::Release);
        }
        result
    }
}

fn canonical_json<T: serde::de::DeserializeOwned + Serialize>(raw: &[u8]) -> Result<T> {
    let parsed = serde_json::from_slice::<T>(raw).map_err(|_| ImportProofError::Malformed)?;
    // Also rejects omitted required nullable links, whitespace, reordered keys,
    // alternate escapes and number encodings. Never reserialize Go check bytes.
    if serde_json::to_vec(&parsed).map_err(|_| ImportProofError::Malformed)? != raw {
        return Err(ImportProofError::Malformed);
    }
    Ok(parsed)
}

fn decode(raw: &str) -> Result<Vec<u8>> {
    let bytes = URL_SAFE_NO_PAD
        .decode(raw)
        .map_err(|_| ImportProofError::Malformed)?;
    if raw.is_empty() || URL_SAFE_NO_PAD.encode(&bytes) != raw {
        return Err(ImportProofError::Malformed);
    }
    Ok(bytes)
}

fn check_time(
    c: &ImportProofClaims,
    e: &ImportProofExpectation<'_>,
    utc: i64,
    now: Instant,
) -> Result<Instant> {
    let expiry_ms = c.exp.checked_mul(1000).ok_or(ImportProofError::Time)?;
    let nbf_ms = c.nbf.checked_mul(1000).ok_or(ImportProofError::Time)?;
    let lifetime = c.exp.checked_sub(c.iat).ok_or(ImportProofError::Time)?;
    if utc <= 0
        || utc < nbf_ms
        || utc >= expiry_ms
        || c.iat <= 0
        || c.iat > c.nbf
        || c.nbf >= c.exp
        || lifetime > 60
        || lifetime > c.remaining_deadline_budget_ms / 1000
        || expiry_ms > c.source_expires_at_unix_ms
        || e.maximum_expiry_unix_seconds
            .is_some_and(|maximum| c.exp > maximum)
        || c.remaining_deadline_budget_ms > e.maximum_remaining_deadline_budget_ms
        || c.remaining_deadline_budget_ms > e.context.max_exchange_duration_ms
        || e.phase_sent_at > now
    {
        return Err(ImportProofError::Time);
    }
    let signed_cutoff = e
        .phase_sent_at
        .checked_add(Duration::from_millis(c.remaining_deadline_budget_ms as u64))
        .ok_or(ImportProofError::Time)?;
    let proof_cutoff = now
        .checked_add(Duration::from_millis((expiry_ms - utc) as u64))
        .ok_or(ImportProofError::Time)?;
    let deadline = e.original_deadline.min(signed_cutoff).min(proof_cutoff);
    if now >= deadline {
        return Err(ImportProofError::Time);
    }
    Ok(deadline)
}

fn check_binding(c: &ImportProofClaims, e: &ImportProofExpectation<'_>) -> Result<()> {
    let x = e.context;
    let b = e.binding;
    x.validate()?;
    if (c.sequence != 0 && e.maximum_expiry_unix_seconds.is_none())
        || c.phase != e.phase
        || c.sequence != e.phase.sequence()
        || c.attempt_id != e.attempt_id
        || c.authority_channel_lifetime_id != e.authority_channel_lifetime_id
        || c.native_certificate_sha256 != e.native_certificate_sha256
        || c.d_certificate_sha256 != e.d_certificate_sha256
        || c.authority_channel_binding_sha256 != e.authority_channel_binding_sha256
        || c.nonce_hex != e.nonce_hex
        || c.environment != x.environment
        || c.provider_instance_id != x.provider_instance_id
        || c.operation_id != x.operation_id
        || c.original_input_sha256 != x.original_input_sha256
        || c.lifecycle_check_sequence != x.lifecycle_check_sequence
        || c.lifecycle_check_sha256 != x.lifecycle_check_sha256
        || c.product_release_id != x.product_release_id
        || c.product_artifact_sha256 != x.product_artifact_sha256
        || c.source_expires_at_unix_ms != x.source_expires_at_unix_ms
        || c.full11_bootstrap_id != b.bootstrap_id
        || c.full11_managed_host_id != b.managed_host_id
        || c.full11_host_incarnation_id != b.host_incarnation_id
        || c.full11_pvc_uid != b.pvc_uid
        || c.full11_organization_id != b.organization_id
        || c.full11_owner_epoch != b.owner_epoch
        || c.full11_key_generation != b.key_generation
        || c.full11_local_key_id != b.local_key_id
        || c.full11_provider_key_id != b.provider_key_id
        || c.full11_clerk_instance_id != b.clerk_instance_id
        || c.full11_inference_origin != b.inference_origin
        || e.initial_imported_check_sha256
            .is_some_and(|hash| c.initial_imported_check_sha256 != hash)
        || (c.sequence != 0 && e.initial_imported_check_sha256.is_none())
        || e.grant_id.is_some_and(|id| c.grant_id != id)
        || (c.sequence == 0) != e.grant_id.is_none()
        || c.issued_proof_sha256.as_deref() != e.issued_proof_sha256
        || c.preceding_proof_sha256.as_deref() != e.preceding_proof_sha256
        || match c.sequence {
            0 => e.consumed_audit_id.is_some(),
            1 => e
                .consumed_audit_id
                .is_some_and(|id| c.consumed_audit_id.as_deref() != Some(id)),
            _ => {
                e.consumed_audit_id.is_none()
                    || c.consumed_audit_id.as_deref() != e.consumed_audit_id
            }
        }
    {
        return Err(ImportProofError::Binding);
    }
    Ok(())
}

#[cfg(test)]
#[path = "protected_import_assertion_tests.rs"]
mod tests;
