//! Nonsecret observations on the original pinned authority channel.
use anyhow::{bail, Result};
use nac_contracts::ProtectedImportPhase;
use nac_managed::ImportOriginalContext;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialImportChallenge {
    pub protocol_version: u8,
    pub phase: ProtectedImportPhase,
    pub sequence: u8,
    pub attempt_id: Uuid,
    pub grant_id: Option<Uuid>,
    pub authority_channel_lifetime_id: Uuid,
    pub nonce_hex: String,
    pub native_certificate_sha256: String,
    pub d_certificate_sha256: String,
    pub authority_channel_binding_sha256: String,
    pub remaining_deadline_budget_ms: u64,
    pub original_context: ImportOriginalContext,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WitnessRead {
    pub protocol_version: u8,
    pub kind: ReadKind,
    pub phase: ProtectedImportPhase,
    pub sequence: u8,
    pub attempt_id: Uuid,
    pub authority_channel_lifetime_id: Uuid,
    pub nonce_hex: String,
    pub request_nonce_hex: String,
}

#[derive(Deserialize)]
pub(super) enum ReadKind {
    #[serde(rename = "read_outstanding_phase")]
    OutstandingPhase,
}

#[derive(Serialize)]
pub(super) struct WitnessReply<'a> {
    pub protocol_version: u8,
    pub kind: &'static str,
    pub request_nonce_hex: &'a str,
    pub remaining_deadline_budget_ms: u64,
    pub challenge: &'a InitialImportChallenge,
}

impl WitnessRead {
    pub fn matches(&self, challenge: &InitialImportChallenge) -> Result<()> {
        let ReadKind::OutstandingPhase = self.kind;
        if self.protocol_version != 1
            || self.phase != challenge.phase
            || self.sequence != challenge.sequence
            || self.attempt_id != challenge.attempt_id
            || self.authority_channel_lifetime_id != challenge.authority_channel_lifetime_id
            || self.nonce_hex != challenge.nonce_hex
            || self.request_nonce_hex == challenge.nonce_hex
        {
            bail!("outstanding import phase mismatch");
        }
        validate_nonce(&self.request_nonce_hex)
    }
}

pub(super) fn validate_nonce(value: &str) -> Result<()> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || value.bytes().all(|b| b == b'0')
    {
        bail!("invalid import witness nonce");
    }
    Ok(())
}

pub(super) fn hex(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}
