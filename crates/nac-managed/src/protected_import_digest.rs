//! Unselected detached-v2 candidate. No production Root wire/signer freeze,
//! protocol selection/fallback, source/current-primary grant, one-use consume,
//! ACK, import or runtime effect.
use super::{
    canonical_json, check_binding, check_time, decode, trust, Header, ImportProofError,
    ImportProofExpectation, ImportProofVerifier, Result, VerifiedImportProof,
};
use crate::ImportProofClaims;
use nac_contracts::ProtectedImportPhase;
use ring::signature::{UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{sync::atomic::AtomicBool, time::Instant};

const MAX_SIGNING_INPUT: usize = 4096;
const MAX_COMPACT: usize = MAX_SIGNING_INPUT + 1 + 86;
const MAX_DETACHED: usize = 9216;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    iss: String,
    aud: String,
    iat: i64,
    nbf: i64,
    exp: i64,
    jti: String,
    v: u32,
    phase: ProtectedImportPhase,
    attempt_id: String,
    issuer_key_generation: i64,
    claims_sha256: String,
}
impl Envelope {
    fn matches(&self, claims: &ImportProofClaims, detached: &[u8]) -> Result<()> {
        let digest: String = Sha256::digest(detached)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        if self.v != 2
            || self.iss != claims.iss
            || self.aud != claims.aud
            || self.iat != claims.iat
            || self.nbf != claims.nbf
            || self.exp != claims.exp
            || self.jti != claims.jti
            || self.phase != claims.phase
            || self.attempt_id != claims.attempt_id
            || self.issuer_key_generation != claims.issuer_key_generation
            || self.claims_sha256 != digest
        {
            return Err(ImportProofError::Malformed);
        }
        Ok(())
    }
}

impl ImportProofVerifier {
    /// Verify a separately selected detached-v2 proof using the EXISTING
    /// enrolled public trust owner and all full-claim/context/time semantics.
    /// The caller preserves the original compact bytes and exact decoded
    /// canonical detached bytes. Neither an outer wrapper nor its parser grants
    /// authority. Default verify() remains embedded-v1 only, with no fallback.
    ///
    /// This cryptographic result still requires genuine fresh Root/D current
    /// source/consume fences, actual original channel ownership and Core's
    /// durable one-use barrier before any ACK or private effect is permitted.
    pub fn verify_detached_v2(
        &self,
        compact: &str,
        detached: &[u8],
        expected: &ImportProofExpectation<'_>,
        now_unix_ms: i64,
    ) -> Result<VerifiedImportProof> {
        if compact.is_empty()
            || compact.len() > MAX_COMPACT
            || !compact.is_ascii()
            || detached.is_empty()
            || detached.len() > MAX_DETACHED
        {
            return Err(ImportProofError::Malformed);
        }
        let mut parts = compact.split('.');
        let header_segment = parts.next().ok_or(ImportProofError::Malformed)?;
        let envelope_segment = parts.next().ok_or(ImportProofError::Malformed)?;
        let signature_segment = parts.next().ok_or(ImportProofError::Malformed)?;
        if parts.next().is_some()
            || header_segment.len() + 1 + envelope_segment.len() > MAX_SIGNING_INPUT
        {
            return Err(ImportProofError::Malformed);
        }
        let header: Header = canonical_json(&decode(header_segment)?)?;
        if header.typ != "nac-managed-import-digest+jwt" || header.alg != "EdDSA" || header.v != 2 {
            return Err(ImportProofError::Malformed);
        }
        let envelope: Envelope = canonical_json(&decode(envelope_segment)?)?;
        let claims: ImportProofClaims = canonical_json(detached)?;
        claims.validate_version(2)?;
        envelope.matches(&claims, detached)?;
        let key = trust::load(&self.trust_file)?.key(&header.kid, &claims, now_unix_ms)?;
        let signature = decode(signature_segment)?;
        if signature.len() != 64 {
            return Err(ImportProofError::Signature);
        }
        let signing_input = format!("{header_segment}.{envelope_segment}");
        UnparsedPublicKey::new(&ED25519, key.public_key)
            .verify(signing_input.as_bytes(), &signature)
            .map_err(|_| ImportProofError::Signature)?;
        check_binding(&claims, expected)?;
        let deadline = check_time(&claims, expected, now_unix_ms, Instant::now())?;
        Ok(VerifiedImportProof {
            claims,
            proof_sha256: Sha256::digest(compact.as_bytes()).into(),
            signing_key: key.public_key,
            deadline,
            denied: AtomicBool::new(false),
        })
    }
}
