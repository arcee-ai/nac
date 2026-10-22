//! Stateful proof lineage, separate from a channel or a durable effect grant.
use crate::{
    ImportExpectedBinding, ImportOriginalContext, ImportProofClaims, ImportProofError,
    ImportProofExpectation, ImportProofVerifier, VerifiedImportProof,
};
use nac_contracts::ProtectedImportPhase;
use std::{
    collections::HashSet,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

/// Nonsecret observations supplied by the retained physical channel owner.
/// Copying these fields does not establish a live channel or import authority.
pub struct ImportChannelContext {
    pub attempt_id: String,
    pub authority_channel_lifetime_id: String,
    pub native_certificate_sha256: String,
    pub d_certificate_sha256: String,
    pub authority_channel_binding_sha256: String,
}

/// Nonclone sequential cryptographic validation. This cannot import a key,
/// emit an ACK, construct Ready, or replace Core's durable one-use barrier.
/// Native must independently retain/check its genuine physical TLS owner.
pub struct ImportProofSequence {
    verifier: ImportProofVerifier,
    context: ImportOriginalContext,
    binding: ImportExpectedBinding,
    channel: ImportChannelContext,
    deadline: Instant,
    first: Option<ImportProofClaims>,
    last: Option<VerifiedImportProof>,
    issued_digest: Option<String>,
    last_digest: Option<String>,
    consumed_audit: Option<String>,
    next_sequence: usize,
    nonces: HashSet<String>,
    jtis: HashSet<String>,
    denied: AtomicBool,
    encoding: Encoding,
}

enum Encoding {
    EmbeddedV1,
    DetachedV2,
}
enum ProofInput<'a> {
    Embedded(&'a str),
    Detached(&'a str, &'a [u8]),
}

const PHASES: [ProtectedImportPhase; 8] = [
    ProtectedImportPhase::Issue,
    ProtectedImportPhase::Consume,
    ProtectedImportPhase::PreImport,
    ProtectedImportPhase::PostImport,
    ProtectedImportPhase::BeforeInitialImported,
    ProtectedImportPhase::AfterInitialImported,
    ProtectedImportPhase::BeforeFreshImported,
    ProtectedImportPhase::AfterFreshImported,
];
type Result<T> = std::result::Result<T, ImportProofError>;

impl ImportProofSequence {
    /// `original_deadline` is the original startup owner's already-established
    /// cutoff, including certificate bounds. Never supply receiptNow+budget.
    pub fn new(
        verifier: ImportProofVerifier,
        context: ImportOriginalContext,
        binding: ImportExpectedBinding,
        channel: ImportChannelContext,
        original_deadline: Instant,
    ) -> Result<Self> {
        Self::with_encoding(
            verifier,
            context,
            binding,
            channel,
            original_deadline,
            Encoding::EmbeddedV1,
        )
    }

    /// Explicit separate proof mode for a future closed source factory. This
    /// does not change control protocol version or install a wire selector.
    /// Calling the other encoding's accept method permanently denies this
    /// owner; there is no sniff, relabel, fallback or recovery constructor.
    pub fn new_detached_v2(
        verifier: ImportProofVerifier,
        context: ImportOriginalContext,
        binding: ImportExpectedBinding,
        channel: ImportChannelContext,
        original_deadline: Instant,
    ) -> Result<Self> {
        Self::with_encoding(
            verifier,
            context,
            binding,
            channel,
            original_deadline,
            Encoding::DetachedV2,
        )
    }

    fn with_encoding(
        verifier: ImportProofVerifier,
        context: ImportOriginalContext,
        binding: ImportExpectedBinding,
        channel: ImportChannelContext,
        original_deadline: Instant,
        encoding: Encoding,
    ) -> Result<Self> {
        context.validate()?;
        if Instant::now() >= original_deadline {
            return Err(ImportProofError::Time);
        }
        Ok(Self {
            verifier,
            context,
            binding,
            channel,
            deadline: original_deadline,
            first: None,
            last: None,
            issued_digest: None,
            last_digest: None,
            consumed_audit: None,
            next_sequence: 0,
            nonces: HashSet::new(),
            jtis: HashSet::new(),
            denied: AtomicBool::new(false),
            encoding,
        })
    }

    pub fn next_phase(&self) -> Option<ProtectedImportPhase> {
        if self.denied.load(Ordering::Acquire) {
            return None;
        }
        PHASES.get(self.next_sequence).copied()
    }

    /// Process exactly the next reply to the outstanding actual-channel nonce.
    /// A successful call validates evidence only; the application must finish
    /// its actual durable/local step before acknowledging or requesting another.
    pub fn accept(
        &mut self,
        raw: &str,
        challenge_nonce: &str,
        phase_sent_at: Instant,
        now_unix_ms: i64,
    ) -> Result<()> {
        let result = self.try_accept(
            ProofInput::Embedded(raw),
            challenge_nonce,
            phase_sent_at,
            now_unix_ms,
        );
        if result.is_err() {
            self.terminate();
        }
        result
    }

    /// Verify the exact next detached candidate without enabling a production
    /// Source/ACK path. Actual Root signer/wire and one-use/current producers
    /// require separate qualification; this method authenticates crypto only.
    pub fn accept_detached_v2(
        &mut self,
        compact: &str,
        detached: &[u8],
        challenge_nonce: &str,
        phase_sent_at: Instant,
        now_unix_ms: i64,
    ) -> Result<()> {
        let result = self.try_accept(
            ProofInput::Detached(compact, detached),
            challenge_nonce,
            phase_sent_at,
            now_unix_ms,
        );
        if result.is_err() {
            self.terminate();
        }
        result
    }

    fn try_accept(
        &mut self,
        input: ProofInput<'_>,
        nonce: &str,
        sent_at: Instant,
        utc: i64,
    ) -> Result<()> {
        if !matches!(
            (&self.encoding, &input),
            (Encoding::EmbeddedV1, ProofInput::Embedded(_))
                | (Encoding::DetachedV2, ProofInput::Detached(_, _))
        ) {
            return Err(ImportProofError::Malformed);
        }
        let phase = self.next_phase().ok_or(ImportProofError::Unavailable)?;
        if self.nonces.contains(nonce) {
            return Err(ImportProofError::Binding);
        }
        if let Some(last) = &self.last {
            self.verifier.recheck(last, utc)?;
        }
        let expected = ImportProofExpectation {
            context: &self.context,
            binding: &self.binding,
            phase,
            attempt_id: &self.channel.attempt_id,
            authority_channel_lifetime_id: &self.channel.authority_channel_lifetime_id,
            native_certificate_sha256: &self.channel.native_certificate_sha256,
            d_certificate_sha256: &self.channel.d_certificate_sha256,
            authority_channel_binding_sha256: &self.channel.authority_channel_binding_sha256,
            nonce_hex: nonce,
            grant_id: self.first.as_ref().map(|c| c.grant_id.as_str()),
            issued_proof_sha256: self.issued_digest.as_deref(),
            preceding_proof_sha256: self.last_digest.as_deref(),
            // The committed Root audit is learned only from authenticated seq1,
            // then retained for every current proof. It is not a local audit.
            consumed_audit_id: self.consumed_audit.as_deref(),
            initial_imported_check_sha256: self
                .first
                .as_ref()
                .map(|c| c.initial_imported_check_sha256.as_str()),
            maximum_expiry_unix_seconds: self.first.as_ref().map(|c| c.exp),
            maximum_remaining_deadline_budget_ms: self
                .last
                .as_ref()
                .map_or(self.context.max_exchange_duration_ms, |p| {
                    p.claims().remaining_deadline_budget_ms
                }),
            phase_sent_at: sent_at,
            original_deadline: self.deadline,
        };
        let proof = match input {
            ProofInput::Embedded(raw) => self.verifier.verify(raw, &expected, utc)?,
            ProofInput::Detached(compact, claims) => self
                .verifier
                .verify_detached_v2(compact, claims, &expected, utc)?,
        };
        let c = proof.claims();
        if self.jtis.contains(&c.jti) {
            return Err(ImportProofError::Binding);
        }
        if let Some(first) = &self.first {
            if immutable_scope(first)? != immutable_scope(c)? {
                return Err(ImportProofError::Binding);
            }
        }
        if self.next_sequence == 0 {
            self.first = Some(c.clone());
            self.issued_digest = Some(hex(proof.proof_sha256()));
        } else if self.next_sequence == 1 {
            self.consumed_audit = c.consumed_audit_id.clone();
        }
        self.nonces.insert(c.nonce_hex.clone());
        self.jtis.insert(c.jti.clone());
        self.deadline = self.deadline.min(proof.deadline());
        self.last_digest = Some(hex(proof.proof_sha256()));
        self.last = Some(proof);
        self.next_sequence += 1;
        Ok(())
    }

    /// Recheck public trust/expiry for the exact retained phase. This is not a
    /// one-use private-effect loan or a live primary/channel current check.
    pub fn check_phase(
        &self,
        phase: ProtectedImportPhase,
        now_unix_ms: i64,
    ) -> Result<&VerifiedImportProof> {
        let result = (|| {
            if self.denied.load(Ordering::Acquire) || Instant::now() >= self.deadline {
                return Err(ImportProofError::Unavailable);
            }
            let proof = self.last.as_ref().ok_or(ImportProofError::Unavailable)?;
            if proof.claims().phase != phase {
                return Err(ImportProofError::Binding);
            }
            self.verifier.recheck(proof, now_unix_ms)?;
            if self.denied.load(Ordering::Acquire) {
                return Err(ImportProofError::Unavailable);
            }
            Ok(proof)
        })();
        if result.is_err() {
            self.terminate();
        }
        result
    }

    /// Called on cancellation, EOF, unknown local commit or lost ACK. There is
    /// no reset/reconnect/recovery constructor from a row or prior proof.
    pub fn terminate(&self) {
        self.denied.store(true, Ordering::Release);
    }
}

fn immutable_scope(claims: &ImportProofClaims) -> Result<serde_json::Value> {
    let mut value = serde_json::to_value(claims).map_err(|_| ImportProofError::Malformed)?;
    let map = value.as_object_mut().ok_or(ImportProofError::Malformed)?;
    // Only protocol progress and freshly observed check/resource versions may
    // vary. Original principal/policy/source/full11/product/key/channel/UID and
    // resource generation fences cannot silently rebase an admitted attempt.
    for field in [
        "iat",
        "nbf",
        "exp",
        "jti",
        "phase",
        "proof_type",
        "sequence",
        "nonce_hex",
        "nonce_sha256",
        "remaining_deadline_budget_ms",
        "issued_proof_sha256",
        "preceding_proof_sha256",
        "consumed_audit_id",
        "current_imported_check_sha256",
        "authority_config_resource_version",
        "managed_resource_resource_version",
        "controller_pvc_resource_version",
    ] {
        map.remove(field);
    }
    Ok(value)
}
fn hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
