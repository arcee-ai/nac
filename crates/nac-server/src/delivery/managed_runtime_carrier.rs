//! Retained initial exchange ownership; deliberately unavailable in production.
//!
//! No protected serving-source/enrollment, controller submission/Integrity or
//! product proof producer exists here. Missing is the ONLY production source.
//! TLS, canonical comparison and journal delivery cannot replace those producers.
//! Tests enroll synthetic facts explicitly; they qualify this component only.
use super::super::{
    control::{
        assignment_fields, canonical, compare_exchange, RuntimeChallenge, RuntimeComparisonContext,
        RuntimeResponse,
    },
    intent::RuntimeHttpIntent,
    preparation::RuntimeChannelHello,
};
use super::IssuerControlDialog;
use anyhow::{bail, Result};
use axum::http::request::Parts;
use nac_core::store::{
    ActiveRuntimeLease, FreshRuntimeReservation, PendingRuntimeChallenge, RuntimeChallengeSpec,
    RuntimeLeaseBinding, RuntimeLeaseClock, RuntimeLeaseReservationOutcome, RuntimeLeaseResponse,
    RuntimeLeaseSnapshot, StoreCoordinator,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};
use uuid::Uuid;

type Fields = BTreeMap<String, Value>;

struct OriginalRequest {
    parts: Parts,
    body: Vec<u8>,
    intent_bytes: Vec<u8>,
}

enum Source {
    Missing,
    #[cfg(test)]
    Synthetic(tests::SyntheticEnrollment),
}

impl Source {
    fn check(&self, _owner: &RetainedRuntimeCarrier) -> Result<i64> {
        match self {
            Self::Missing => Err(anyhow::anyhow!("protected carrier producers unavailable")),
            #[cfg(test)]
            Self::Synthetic(source) => source.check(_owner),
        }
    }
}

enum Stage {
    Original,
    Fresh(FreshRuntimeReservation),
    Pending(PendingRuntimeChallenge, RuntimeChallenge),
    Active(ActiveRuntimeLease),
    Denied,
}

/// One noncloneable owner, with no transport/request-selected authority factory.
/// The source is permanently Missing outside cfg(test). No dispatch is exposed.
struct RetainedRuntimeCarrier {
    dialog: IssuerControlDialog,
    store: Arc<StoreCoordinator>,
    original: OriginalRequest,
    intent: RuntimeHttpIntent,
    assignment: Fields,
    binding: RuntimeLeaseBinding,
    deadline: Instant,
    anchor: Instant,
    last_wall_ms: i64,
    key_revocation_watermark: i64,
    source: Source,
    stage: Stage,
    submission_spent: bool,
    reservation_attempted: bool,
}

impl RetainedRuntimeCarrier {
    /// Capture the actual selected objects and original bytes. Successful
    /// capture is observation only; every operation still fails Missing.
    fn unconfigured(
        dialog: IssuerControlDialog,
        store: Arc<StoreCoordinator>,
        original: OriginalRequest,
        assignment: Fields,
        serving_lifetime_id: Uuid,
    ) -> Result<Self> {
        dialog.peer().check_live()?;
        let clock = RuntimeLeaseClock::capture()?;
        let intent = RuntimeHttpIntent::decode(&original.intent_bytes)?;
        let assignment = assignment_fields(&assignment).and_then(|checked| {
            if checked == assignment {
                Ok(checked)
            } else {
                Err(super::super::control::RuntimeControlDenied)
            }
        })?;
        intent.compare_actual(&original.parts, &original.body, clock.wall_ms())?;
        intent.compare_assignment(&assignment)?;
        let expires = intent.original_expires_ms()?;
        let binding = RuntimeLeaseBinding {
            identity: nac_core::store::ManagedRuntimeOperationIdentity {
                operation_id: uuid_field(&assignment, "operation_id")?,
                full_input_sha256: digest_field(&assignment, "full_input_sha256")?,
            },
            assignment_sha256: Sha256::digest(canonical(&assignment)?).into(),
            serving_lifetime_id,
            original_expires_ms: expires,
        };
        let anchor = clock.monotonic();
        let deadline = anchor + Duration::from_millis(u64::try_from(expires - clock.wall_ms())?);
        Ok(Self {
            dialog,
            store,
            original,
            intent,
            assignment,
            binding,
            deadline,
            anchor,
            last_wall_ms: clock.wall_ms(),
            key_revocation_watermark: 0,
            source: Source::Missing,
            stage: Stage::Original,
            submission_spent: false,
            reservation_attempted: false,
        })
    }

    fn hello(&self) -> Result<Vec<u8>> {
        // Hello identifies the actual live dialog, never operation eligibility.
        if matches!(self.stage, Stage::Denied) {
            bail!("retained carrier denied");
        }
        Ok(RuntimeChannelHello::for_live_dialog(&self.dialog)?.canonical()?)
    }

    fn check(&mut self) -> Result<RuntimeLeaseClock> {
        self.dialog.peer().check_live()?;
        let clock = RuntimeLeaseClock::capture()?;
        if clock.wall_ms() < self.last_wall_ms || clock.monotonic() >= self.deadline {
            bail!("retained original expired or clock rolled back");
        }
        self.intent
            .compare_actual(&self.original.parts, &self.original.body, clock.wall_ms())?;
        self.key_revocation_watermark = self.source.check(self)?;
        self.last_wall_ms = clock.wall_ms();
        Ok(clock)
    }

    fn begin(&mut self) -> Result<Attempt<'_>> {
        if matches!(self.stage, Stage::Denied) || self.check().is_err() {
            self.deny();
            bail!("retained carrier denied");
        }
        let stage = std::mem::replace(&mut self.stage, Stage::Denied);
        Ok(Attempt {
            owner: self,
            stage: Some(stage),
            finished: false,
        })
    }

    async fn reserve(&mut self) -> Result<()> {
        let attempt = self.begin()?;
        if !matches!(attempt.stage, Some(Stage::Original)) {
            bail!("original already reserved");
        }
        attempt.owner.reservation_attempted = true;
        let clock = attempt.owner.check()?;
        let outcome = tokio::select! {
            biased;
            () = attempt.owner.dialog.peer().wait_for_close() => bail!("issuer closed"),
            result = attempt.owner.store.reserve_managed_runtime_lease(
                attempt.owner.binding.clone(), clock) => result?,
        };
        attempt.owner.check()?;
        let RuntimeLeaseReservationOutcome::Fresh(fresh) = outcome else {
            bail!("retained readback cannot create Fresh");
        };
        attempt.finish(Stage::Fresh(fresh));
        Ok(())
    }

    async fn challenge(&mut self) -> Result<Vec<u8>> {
        let mut attempt = self.begin()?;
        let Some(Stage::Fresh(fresh)) = attempt.stage.take() else {
            bail!("original Fresh unavailable");
        };
        let clock = attempt.owner.check()?;
        let mut fields = attempt.owner.assignment.clone();
        let expires = (clock.wall_ms() + 10_000).min(attempt.owner.binding.original_expires_ms);
        fields.extend([
            ("challenge_version".into(), Value::from(1)),
            ("previous_lease_sequence".into(), Value::from(0)),
            ("issued_at_epoch_ms".into(), Value::from(clock.wall_ms())),
            ("expires_at_epoch_ms".into(), Value::from(expires)),
            (
                "native_deadline_epoch_ms".into(),
                Value::from(attempt.owner.binding.original_expires_ms),
            ),
            (
                "control_channel_id".into(),
                Value::from(attempt.owner.dialog.peer().channel_id().to_string()),
            ),
            (
                "challenge_id".into(),
                Value::from(hex(Sha256::digest(Uuid::new_v4().as_bytes()).into())),
            ),
            ("lease_phase".into(), Value::from("initial")),
            ("previous_lease_id".into(), Value::Null),
            ("native_session_id".into(), Value::Null),
            ("native_run_id".into(), Value::Null),
            ("previous_expires_at_epoch_ms".into(), Value::Null),
        ]);
        let challenge = RuntimeChallenge::from_fields(fields)?;
        let spec = RuntimeChallengeSpec {
            channel_id: attempt.owner.dialog.peer().channel_id(),
            challenge_sha256: digest_text(&challenge.sha256()?)?,
            expires_ms: expires,
        };
        let pending = tokio::select! {
            biased;
            () = attempt.owner.dialog.peer().wait_for_close() => bail!("issuer closed"),
            result = attempt.owner.store.challenge_managed_runtime_initial(fresh, spec, clock) => result?,
        };
        attempt.owner.check()?;
        let bytes = challenge.canonical()?;
        attempt.finish(Stage::Pending(pending, challenge));
        Ok(bytes)
    }

    /// All adapters borrow this owner. Spend BEFORE the external Create attempt;
    /// timeout/unknown delivery cannot unspend it. No callback proves receipt.
    async fn claim_submission(&mut self) -> Result<()> {
        let mut attempt = self.begin()?;
        if attempt.owner.submission_spent {
            bail!("first response submission already spent");
        }
        let Some(Stage::Pending(pending, _)) = &attempt.stage else {
            bail!("original Pending unavailable");
        };
        if !attempt
            .owner
            .dialog
            .initial_pending_available(pending, &attempt.owner.store)
            .await?
        {
            bail!("original Pending unavailable");
        }
        attempt.owner.check()?;
        attempt.owner.submission_spent = true;
        let stage = attempt
            .stage
            .take()
            .ok_or_else(|| anyhow::anyhow!("missing stage"))?;
        attempt.finish(stage);
        Ok(())
    }

    /// Exact accepted response bytes on this owner only. Production cannot enter
    /// this transition: check() denies the missing independent producers.
    async fn consume(&mut self, raw: &[u8]) -> Result<()> {
        let mut attempt = self.begin()?;
        if !attempt.owner.submission_spent {
            bail!("response was not submitted");
        }
        let Some(Stage::Pending(pending, challenge)) = attempt.stage.take() else {
            bail!("original Pending unavailable");
        };
        let response = RuntimeResponse::decode(raw)?;
        let clock = attempt.owner.check()?;
        let context = RuntimeComparisonContext {
            assignment: attempt.owner.assignment.clone(),
            control_channel_id: attempt.owner.dialog.peer().channel_id().to_string(),
            lease_phase: "initial".into(),
            native_deadline_epoch_ms: attempt.owner.binding.original_expires_ms,
            native_deadline_monotonic_ms: millis(
                attempt.owner.deadline.duration_since(attempt.owner.anchor),
            )?,
            now_epoch_ms: clock.wall_ms(),
            now_monotonic_ms: millis(clock.monotonic().duration_since(attempt.owner.anchor))?,
            last_wall_clock_epoch_ms: attempt.owner.last_wall_ms,
            current_key_revocation_watermark: attempt.owner.key_revocation_watermark,
            previous_lease_id: None,
            previous_lease_sequence: 0,
            previous_expires_at_epoch_ms: None,
            native_session_id: None,
            native_run_id: None,
        };
        compare_exchange(&challenge, &response, &context)?;
        let fields = response.fields();
        let delivered = RuntimeLeaseResponse {
            channel_id: attempt.owner.dialog.peer().channel_id(),
            challenge_sha256: digest_text(&challenge.sha256()?)?,
            lease: RuntimeLeaseSnapshot {
                lease_id: uuid_field(fields, "lease_id")?,
                sequence: integer(fields, "lease_sequence")?,
                expires_ms: integer(fields, "expires_at_epoch_ms")?,
            },
            observed_ms: integer(fields, "observed_at_epoch_ms")?,
        };
        let active = tokio::select! {
            biased;
            () = attempt.owner.dialog.peer().wait_for_close() => bail!("issuer closed"),
            result = attempt.owner.store.consume_managed_runtime_challenge(pending, delivered, clock) => result?,
        };
        attempt.owner.check()?;
        attempt.finish(Stage::Active(active));
        Ok(())
    }

    fn deny(&mut self) {
        self.stage = Stage::Denied;
        self.dialog.peer().channel.close();
    }

    /// Explicit uncertainty/close settlement; errors remain denied. Drop cannot
    /// assert a durable receipt, so journal readback always remains observational.
    async fn settle_denial(&mut self) -> Result<()> {
        self.deny();
        if self.reservation_attempted {
            self.store
                .terminate_managed_runtime_lease(self.binding.clone())
                .await?;
        }
        Ok(())
    }
}

impl Drop for RetainedRuntimeCarrier {
    fn drop(&mut self) {
        self.deny();
        if self.reservation_attempted {
            if let Ok(executor) = tokio::runtime::Handle::try_current() {
                let store = Arc::clone(&self.store);
                let binding = self.binding.clone();
                executor.spawn(async move {
                    let _ = store.terminate_managed_runtime_lease(binding).await;
                });
            }
        }
    }
}

/// Cancellation of ANY in-flight stage invalidates the retained carrier, even
/// when an adapter still owns it. No successful future can restore that owner.
struct Attempt<'a> {
    owner: &'a mut RetainedRuntimeCarrier,
    stage: Option<Stage>,
    finished: bool,
}
impl Attempt<'_> {
    fn finish(mut self, stage: Stage) {
        self.owner.stage = stage;
        self.finished = true;
    }
}
impl Drop for Attempt<'_> {
    fn drop(&mut self) {
        if !self.finished {
            self.owner.deny();
        }
    }
}

fn integer(fields: &Fields, name: &str) -> Result<i64> {
    fields
        .get(name)
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("missing integer"))
}
fn uuid_field(fields: &Fields, name: &str) -> Result<Uuid> {
    Ok(Uuid::parse_str(
        fields
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("missing UUID"))?,
    )?)
}
fn digest_field(fields: &Fields, name: &str) -> Result<[u8; 32]> {
    digest_text(
        fields
            .get(name)
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("missing digest"))?,
    )
}
fn digest_text(text: &str) -> Result<[u8; 32]> {
    if text.len() != 64 {
        bail!("invalid digest");
    }
    let mut bytes = [0; 32];
    for (index, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16)?;
    }
    Ok(bytes)
}
fn hex(bytes: [u8; 32]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn millis(duration: Duration) -> Result<i64> {
    Ok(i64::try_from(duration.as_millis())?)
}

#[cfg(test)]
#[path = "managed_runtime_carrier_tests.rs"]
mod tests;
