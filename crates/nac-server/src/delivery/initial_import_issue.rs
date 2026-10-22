//! Physical outstanding ISSUE owner. No ACK, import, phase advance or Ready.
mod wire;
use super::import_authority_transport::{
    ImportAuthorityConnection, ImportAuthorityListener, ImportAuthorityLiveOwner,
};
use crate::InitialEnrollmentContext;
use anyhow::{bail, Context, Result};
use nac_contracts::ProtectedImportPhase;
use nac_managed::{
    ImportChannelContext, ImportExpectedBinding, ImportProofSequence, ImportProofVerifier,
    VerifiedImportProof,
};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant as StdInstant,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    sync::oneshot,
    task::JoinHandle,
    time::Instant,
};
pub use wire::InitialImportChallenge;
use wire::{WitnessRead, WitnessReply};

const MAX_FRAME: usize = 16_384;
const MAX_PROOF: usize = 15_000;
const MAX_WITNESS_READS: usize = 64;

struct Gate {
    closed: AtomicBool,
    started: AtomicBool,
    deadline: Instant,
    physical: ImportAuthorityLiveOwner,
}
impl Gate {
    fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.physical.close();
    }
    fn check(&self) -> Result<()> {
        if self.closed.load(Ordering::Acquire)
            || !self.started.load(Ordering::Acquire)
            || Instant::now() >= self.deadline
        {
            bail!("original import phase unavailable");
        }
        self.physical.check_live()
    }
}
struct CloseOnDrop(Arc<Gate>);
impl Drop for CloseOnDrop {
    fn drop(&mut self) {
        self.0.close();
    }
}
struct ObservationGuard {
    gate: Arc<Gate>,
    complete: bool,
}
impl Drop for ObservationGuard {
    fn drop(&mut self) {
        if !self.complete {
            self.gate.close();
        }
    }
}

/// One actual pinned stream, active reader and original context allocation.
/// A copied challenge or proof cannot reconstruct this owner.
pub struct InitialImportIssueExchange {
    gate: Arc<Gate>,
    actor: Option<JoinHandle<()>>,
    started: Option<oneshot::Receiver<InitialImportChallenge>>,
    proof: Option<oneshot::Receiver<InitialImportProofInput>>,
    startup: InitialEnrollmentContext,
    _listener: ImportAuthorityListener,
    channel: ImportChannelContext,
    proofs: Option<ImportProofSequence>,
    proof_work: Option<JoinHandle<Result<ImportProofSequence>>>,
    verifier: Option<ImportProofVerifier>,
}

/// Unverified input and original SEND anchor for Core's crypto verifier.
/// Receiving this creates no local consume record, custody, ACK or authority.
pub struct InitialImportProofInput {
    pub compact_jws: String,
    pub nonce_hex: String,
    pub phase_send_instant: StdInstant,
}

/// Borrowed local liveness only; source/current authority remains Core/Root's
/// responsibility. Its actor keeps polling real TLS EOF while the caller waits.
pub struct InitialImportPhaseBorrow<'a> {
    owner: &'a InitialImportIssueExchange,
}
impl InitialImportPhaseBorrow<'_> {
    pub fn check_live(&self) -> Result<()> {
        self.owner.startup.check_current()?;
        self.owner.gate.check()
    }
}

impl InitialImportIssueExchange {
    /// Start only ISSUE/0 from a real accepted pinned TLS stream. There is no
    /// public arbitrary-phase setter or proof/durable-state reconstruction.
    pub fn start(
        mut listener: ImportAuthorityListener,
        connection: ImportAuthorityConnection,
        startup: InitialEnrollmentContext,
    ) -> Result<Self> {
        connection.check_live()?;
        startup.check_current()?;
        if !listener.owns_original(&connection) {
            bail!("import phase original listener mismatch");
        }
        tokio::runtime::Handle::try_current().context("import phase requires an active runtime")?;
        let verifier = listener.take_original_verifier()?;
        let deadline = connection.deadline().min(startup.deadline());
        let mut nonce = [0; 32];
        tokio_rustls::rustls::crypto::aws_lc_rs::default_provider()
            .secure_random
            .fill(&mut nonce)
            .map_err(|_| anyhow::anyhow!("import nonce entropy unavailable"))?;
        wire::validate_nonce(&wire::hex(&nonce))?;
        let context = connection.context();
        let challenge = InitialImportChallenge {
            protocol_version: 1,
            phase: ProtectedImportPhase::Issue,
            sequence: 0,
            attempt_id: startup.attempt_id(),
            grant_id: None,
            authority_channel_lifetime_id: context.authority_channel_lifetime_id(),
            nonce_hex: wire::hex(&nonce),
            native_certificate_sha256: wire::hex(&context.serving_leaf_sha256()),
            d_certificate_sha256: wire::hex(&context.peer_leaf_sha256()),
            authority_channel_binding_sha256: wire::hex(
                &context.authority_channel_binding_sha256(),
            ),
            remaining_deadline_budget_ms: 0,
            original_context: startup.context().clone(),
        };
        let gate = Arc::new(Gate {
            closed: AtomicBool::new(false),
            started: AtomicBool::new(false),
            deadline,
            physical: connection.retain_live_owner()?,
        });
        let channel = ImportChannelContext {
            attempt_id: challenge.attempt_id.to_string(),
            authority_channel_lifetime_id: challenge.authority_channel_lifetime_id.to_string(),
            native_certificate_sha256: challenge.native_certificate_sha256.clone(),
            d_certificate_sha256: challenge.d_certificate_sha256.clone(),
            authority_channel_binding_sha256: challenge.authority_channel_binding_sha256.clone(),
        };
        let (started_tx, started) = oneshot::channel();
        let (proof_tx, proof) = oneshot::channel();
        let actor_gate = Arc::clone(&gate);
        // Capture the drop guard BEFORE spawning, so runtime shutdown or abort
        // before the first poll also closes the owner synchronously on drop.
        let close = CloseOnDrop(Arc::clone(&gate));
        let actor = tokio::spawn(async move {
            let _close = close;
            let _ = tokio::time::timeout_at(
                actor_gate.deadline,
                run(connection, challenge, &actor_gate, started_tx, proof_tx),
            )
            .await;
        });
        Ok(Self {
            gate,
            actor: Some(actor),
            started: Some(started),
            proof: Some(proof),
            startup,
            _listener: listener,
            channel,
            proofs: None,
            proof_work: None,
            verifier: Some(verifier),
        })
    }

    pub async fn challenge(&mut self) -> Result<InitialImportChallenge> {
        let mut observed = ObservationGuard {
            gate: Arc::clone(&self.gate),
            complete: false,
        };
        let receiver = self
            .started
            .take()
            .context("import challenge already observed")?;
        let challenge = receiver
            .await
            .context("original import challenge unavailable")?;
        self.gate.check()?;
        observed.complete = true;
        Ok(challenge)
    }

    pub async fn receive_proof(&mut self) -> Result<InitialImportProofInput> {
        let mut observed = ObservationGuard {
            gate: Arc::clone(&self.gate),
            complete: false,
        };
        let receiver = self.proof.take().context("import proof already observed")?;
        let proof = receiver
            .await
            .context("original import proof unavailable")?;
        self.gate.check()?;
        observed.complete = true;
        Ok(proof)
    }

    pub fn borrow_live(&self) -> Result<InitialImportPhaseBorrow<'_>> {
        self.gate.check()?;
        Ok(InitialImportPhaseBorrow { owner: self })
    }

    /// Verify only the actual outstanding ISSUE reply on this same channel.
    /// The original reader continues polling EOF while crypto runs. This
    /// retains evidence, never a consumed/current primary loan or Core Source.
    /// There is no detached-v2 selector, copied-proof input or callback adapter.
    pub async fn verify_issued_proof(&mut self, binding: ImportExpectedBinding) -> Result<()> {
        let mut observed = ObservationGuard {
            gate: Arc::clone(&self.gate),
            complete: false,
        };
        if self.proofs.is_some() || self.proof_work.is_some() {
            bail!("original ISSUE proof verification already attempted");
        }
        let verifier = self
            .verifier
            .take()
            .context("original ISSUE verifier already consumed")?;
        let input = self.receive_proof().await?;
        self.startup.check_current()?;
        self.gate.check()?;
        let channel = ImportChannelContext {
            attempt_id: self.channel.attempt_id.clone(),
            authority_channel_lifetime_id: self.channel.authority_channel_lifetime_id.clone(),
            native_certificate_sha256: self.channel.native_certificate_sha256.clone(),
            d_certificate_sha256: self.channel.d_certificate_sha256.clone(),
            authority_channel_binding_sha256: self.channel.authority_channel_binding_sha256.clone(),
        };
        let context = self.startup.context().clone();
        let deadline = self.gate.deadline.into_std();
        let (start, utc) = self.startup.original_clock();
        // Retain before awaiting: cancellation closes the original channel,
        // but does not pretend the actual trust-file/crypto work was joined.
        self.proof_work = Some(tokio::task::spawn_blocking(move || {
            let mut proofs =
                ImportProofSequence::new(verifier, context, binding, channel, deadline)?;
            let now = original_utc_ms(start, utc)?;
            proofs.accept(
                &input.compact_jws,
                &input.nonce_hex,
                input.phase_send_instant,
                now,
            )?;
            Ok(proofs)
        }));
        let result = self
            .proof_work
            .as_mut()
            .context("original ISSUE verifier work unavailable")?
            .await;
        self.proof_work.take();
        self.proofs = Some(result.context("original ISSUE verifier work failed")??);
        self.startup.check_current()?;
        self.gate.check()?;
        observed.complete = true;
        Ok(())
    }

    /// Borrow crypto evidence under the original polled TLS and trust owner.
    /// This is still not primary currentness, one-use consume or import custody.
    /// The trusted Source caller must run this trust-file read off its reactor.
    pub fn borrow_verified_issue(&self) -> Result<&VerifiedImportProof> {
        let result = (|| {
            self.startup.check_current()?;
            self.gate.check()?;
            let proof = self
                .proofs
                .as_ref()
                .context("original ISSUE has no verified proof")?
                .check_phase(ProtectedImportPhase::Issue, self.original_utc_ms()?)?;
            self.gate.check()?;
            Ok(proof)
        })();
        if result.is_err() {
            self.gate.close();
            if let Some(proofs) = &self.proofs {
                proofs.terminate();
            }
        }
        result
    }

    fn original_utc_ms(&self) -> Result<i64> {
        let (start, utc) = self.startup.original_clock();
        original_utc_ms(start, utc)
    }

    /// Deny the same channel and join actual reader/crypto work. The owning
    /// supervisor retains this object if its borrowed join is cancelled. This
    /// produces no Root settlement, no-effect receipt or replacement authority.
    pub fn close_and_join(&mut self) -> impl std::future::Future<Output = Result<()>> + '_ {
        self.gate.close();
        if let Some(proofs) = &self.proofs {
            proofs.terminate();
        }
        async move {
            let mut failure = None;
            if let Some(worker) = self.proof_work.as_mut() {
                let result = worker.await;
                self.proof_work.take();
                match result {
                    Ok(Ok(proofs)) => {
                        proofs.terminate();
                        self.proofs = Some(proofs);
                    }
                    Ok(Err(error)) => failure = Some(error),
                    Err(error) => failure = Some(error.into()),
                }
            }
            if let Some(actor) = self.actor.as_mut() {
                let result = actor.await;
                self.actor.take();
                result.context("original ISSUE reader did not join")?;
            }
            match failure {
                Some(error) => Err(error),
                None => Ok(()),
            }
        }
    }
}

fn original_utc_ms(start: Instant, utc: std::time::SystemTime) -> Result<i64> {
    let now = utc
        .checked_add(start.elapsed())
        .context("original ISSUE clock overflow")?;
    now.duration_since(std::time::UNIX_EPOCH)
        .context("original ISSUE clock unavailable")?
        .as_millis()
        .try_into()
        .context("original ISSUE clock overflow")
}
impl Drop for InitialImportIssueExchange {
    fn drop(&mut self) {
        self.gate.close();
        if let Some(actor) = &self.actor {
            actor.abort();
        }
    }
}

fn remaining(deadline: Instant) -> Result<u64> {
    let millis = deadline
        .saturating_duration_since(Instant::now())
        .as_millis()
        .min(60_000) as u64;
    if millis == 0 {
        bail!("original import phase deadline expired");
    }
    Ok(millis)
}

async fn run(
    mut connection: ImportAuthorityConnection,
    mut challenge: InitialImportChallenge,
    gate: &Gate,
    started: oneshot::Sender<InitialImportChallenge>,
    proof: oneshot::Sender<InitialImportProofInput>,
) -> Result<()> {
    let sent = StdInstant::now();
    challenge.remaining_deadline_budget_ms = remaining(gate.deadline)?;
    write(&mut connection, &serde_json::to_vec(&challenge)?).await?;
    gate.started.store(true, Ordering::Release);
    let _ = started.send(challenge.clone());
    let mut proof = Some(proof);
    let mut seen = HashSet::new();
    loop {
        // Once proof bytes arrive, the same reader stays alive to detect EOF.
        // Any byte is unsolicited: never wait for a second frame's full header.
        if proof.is_none() {
            let _ = connection.read(&mut [0; 1]).await?;
            bail!("unsolicited data after import proof");
        }
        let raw = read(&mut connection).await?;
        gate.check()?;
        if raw.first() == Some(&b'{') {
            let request: WitnessRead =
                serde_json::from_slice(&raw).context("invalid import witness request")?;
            request.matches(&challenge)?;
            if seen.len() >= MAX_WITNESS_READS || !seen.insert(request.request_nonce_hex.clone()) {
                bail!("import witness nonce replay or bound exceeded");
            }
            let reply = WitnessReply {
                protocol_version: 1,
                kind: "outstanding_phase_witness",
                request_nonce_hex: &request.request_nonce_hex,
                remaining_deadline_budget_ms: remaining(gate.deadline)?,
                challenge: &challenge,
            };
            write(&mut connection, &serde_json::to_vec(&reply)?).await?;
            gate.check()?;
        } else {
            if raw.len() > MAX_PROOF
                || !raw
                    .iter()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
            {
                bail!("invalid compact import proof bytes");
            }
            let compact_jws = String::from_utf8(raw)?;
            let parts: Vec<_> = compact_jws.split('.').collect();
            if parts.len() != 3 || parts.iter().any(|part| part.is_empty()) {
                bail!("invalid compact import proof shape");
            }
            let sender = proof.take().context("import proof already received")?;
            let _ = sender.send(InitialImportProofInput {
                compact_jws,
                nonce_hex: challenge.nonce_hex.clone(),
                phase_send_instant: sent,
            });
        }
    }
}

async fn read(connection: &mut ImportAuthorityConnection) -> Result<Vec<u8>> {
    let length = connection.read_u32().await? as usize;
    if length == 0 || length > MAX_FRAME {
        bail!("import phase frame exceeds bound");
    }
    let mut raw = vec![0; length];
    connection.read_exact(&mut raw).await?;
    Ok(raw)
}
async fn write(connection: &mut ImportAuthorityConnection, raw: &[u8]) -> Result<()> {
    if raw.is_empty() || raw.len() > MAX_FRAME {
        bail!("import phase frame exceeds bound");
    }
    connection.write_u32(raw.len().try_into()?).await?;
    connection.write_all(raw).await?;
    connection.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests;
