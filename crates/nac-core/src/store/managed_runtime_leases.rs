//! Native one-use lease transitions, independent of wire/authentication policy.
//!
//! The application must qualify current assignment, TLS role, actual original
//! request and active native run before calling these ports. Only fresh committed
//! reservations and consumed challenges produce non-cloneable capabilities.
//! Readback, caller-provided UUIDs and fingerprints never manufacture one.
use super::managed_runtime_admission::{digest_hex, read_with_connection};
use super::*;
use rusqlite::TransactionBehavior;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

type LeaseResult<T> = std::result::Result<T, ManagedRuntimeJournalError>;

/// Opaque binding produced from the already-qualified current native assignment.
/// The serving lifetime is generated at native startup, never recovered from a row.
#[derive(Clone, Debug)]
pub struct RuntimeLeaseBinding {
    pub identity: ManagedRuntimeOperationIdentity,
    pub assignment_sha256: [u8; 32],
    pub serving_lifetime_id: Uuid,
    pub original_expires_ms: i64,
}

/// Both clocks are sampled by native code; transport input cannot supply these.
#[derive(Clone, Copy, Debug)]
pub struct RuntimeLeaseClock {
    wall_ms: i64,
    monotonic: Instant,
    live: bool,
}
impl RuntimeLeaseClock {
    pub fn capture() -> LeaseResult<Self> {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| ManagedRuntimeJournalError::LeaseDenied)?
            .as_millis();
        Ok(Self {
            wall_ms: i64::try_from(millis).map_err(|_| ManagedRuntimeJournalError::LeaseDenied)?,
            monotonic: Instant::now(),
            live: true,
        })
    }
    pub fn wall_ms(&self) -> i64 {
        self.wall_ms
    }
    pub fn monotonic(&self) -> Instant {
        self.monotonic
    }
    fn at_execution(self) -> LeaseResult<Self> {
        if !self.live {
            return Ok(self);
        }
        let current = Self::capture()?;
        if current.wall_ms < self.wall_ms || current.monotonic < self.monotonic {
            return denied();
        }
        Ok(current)
    }
    #[cfg(test)]
    pub(crate) fn fixed(wall_ms: i64, monotonic: Instant) -> Self {
        Self {
            wall_ms,
            monotonic,
            live: false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeLeaseSnapshot {
    pub lease_id: Uuid,
    pub sequence: i64,
    pub expires_ms: i64,
}

#[derive(Clone, Debug)]
pub struct RuntimeChallengeSpec {
    pub channel_id: Uuid,
    pub challenge_sha256: [u8; 32],
    pub expires_ms: i64,
}

/// Authenticated and fully compared response data. This struct is not a grant.
#[derive(Clone, Debug)]
pub struct RuntimeLeaseResponse {
    pub channel_id: Uuid,
    pub challenge_sha256: [u8; 32],
    pub lease: RuntimeLeaseSnapshot,
    pub observed_ms: i64,
}

#[derive(Debug)]
pub struct FreshRuntimeReservation {
    binding: RuntimeLeaseBinding,
    reservation_id: Uuid,
    original_deadline: Instant,
}

#[derive(Debug)]
pub enum RuntimeLeaseReservationOutcome {
    Fresh(FreshRuntimeReservation),
    Readback(ManagedRuntimeOperationSnapshot),
}

#[derive(Debug)]
pub struct PendingRuntimeChallenge {
    binding: RuntimeLeaseBinding,
    reservation_id: Uuid,
    challenge: RuntimeChallengeSpec,
    prior: Option<RuntimeLeaseSnapshot>,
    issued_ms: i64,
    monotonic_deadline: Instant,
}

/// Cannot be constructed, deserialized or cloned from observational state.
/// Later execution hooks must check this capability before each effect and
/// cancel retained/background command trees when checking returns false.
#[derive(Debug)]
pub struct ActiveRuntimeLease {
    binding: RuntimeLeaseBinding,
    reservation_id: Uuid,
    snapshot: RuntimeLeaseSnapshot,
    monotonic_deadline: Instant,
}

impl ActiveRuntimeLease {
    pub fn snapshot(&self) -> &RuntimeLeaseSnapshot {
        &self.snapshot
    }
    pub(crate) fn binding(&self) -> &RuntimeLeaseBinding {
        &self.binding
    }
    pub(crate) fn available_at(&self, clock: RuntimeLeaseClock) -> bool {
        clock.wall_ms >= 0
            && clock.wall_ms < self.snapshot.expires_ms
            && clock.monotonic < self.monotonic_deadline
    }
    pub(crate) fn same_operation(&self, other: &Self) -> bool {
        self.binding.identity == other.binding.identity
            && self.binding.assignment_sha256 == other.binding.assignment_sha256
            && self.binding.serving_lifetime_id == other.binding.serving_lifetime_id
            && self.binding.original_expires_ms == other.binding.original_expires_ms
            && self.reservation_id == other.reservation_id
    }
}

#[derive(Debug)]
struct LeaseRow {
    reservation_id: Uuid,
    phase: String,
    last_wall_ms: i64,
    challenge_sha256: Option<String>,
    channel_id: Option<String>,
    challenge_expires_ms: Option<i64>,
    lease: Option<RuntimeLeaseSnapshot>,
}

coordinated_command! {
/// A new operation and its lease reservation commit in the same transaction.
/// An existing journal entry, even uncertain or predating this table, is readback.
pub fn reserve_managed_runtime_lease(path: &Path, binding: &RuntimeLeaseBinding, clock: RuntimeLeaseClock)
    -> LeaseResult<RuntimeLeaseReservationOutcome> {
    let mut connection = open_runtime_connection(path)?;
    reserve_with_connection(&mut connection, binding, clock, || Ok(()))
}
command ReserveManagedRuntimeLeaseCommand {
    binding: RuntimeLeaseBinding = binding.clone(), clock: RuntimeLeaseClock = clock,
}
call |command| (&command.binding, command.clock)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

fn reserve_with_connection(
    connection: &mut Connection,
    binding: &RuntimeLeaseBinding,
    clock: RuntimeLeaseClock,
    after_commit: impl FnOnce() -> Result<()>,
) -> LeaseResult<RuntimeLeaseReservationOutcome> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let outcome = if let Some(existing) = read_with_connection(&transaction, &binding.identity)? {
        RuntimeLeaseReservationOutcome::Readback(existing)
    } else {
        let original_deadline =
            clock.monotonic + remaining_ms(clock.wall_ms, binding.original_expires_ms, 300_000)?;
        let clock = clock.at_execution()?;
        remaining_ms(clock.wall_ms, binding.original_expires_ms, 300_000)?;
        if clock.monotonic >= original_deadline {
            return denied();
        }
        let reservation_id = Uuid::new_v4();
        transaction.execute(
            "INSERT INTO managed_runtime_operations (operation_id, full_input_sha256, recorded_at)
            VALUES (?1, ?2, ?3)",
            params![
                binding.identity.operation_id.to_string(),
                digest_hex(&binding.identity.full_input_sha256),
                now_utc()
            ],
        )?;
        transaction.execute("INSERT INTO managed_runtime_leases
            (operation_id, reservation_id, assignment_sha256, serving_lifetime_id, original_expires_ms, last_wall_ms, phase)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'reserved')", params![binding.identity.operation_id.to_string(),
            reservation_id.to_string(), digest_hex(&binding.assignment_sha256), binding.serving_lifetime_id.to_string(),
            binding.original_expires_ms, clock.wall_ms])?;
        RuntimeLeaseReservationOutcome::Fresh(FreshRuntimeReservation {
            binding: binding.clone(),
            reservation_id,
            original_deadline,
        })
    };
    transaction.commit()?;
    after_commit()?;
    Ok(outcome)
}

coordinated_command! {
/// Consume the fresh reservation capability before publishing one challenge.
pub fn challenge_managed_runtime_initial(path: &Path, fresh: FreshRuntimeReservation,
    challenge: &RuntimeChallengeSpec, clock: RuntimeLeaseClock) -> LeaseResult<PendingRuntimeChallenge> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = read_row(&transaction, &fresh.binding)?;
    if row.reservation_id != fresh.reservation_id || row.phase != "reserved" { return denied(); }
    let issued_ms = clock.wall_ms;
    let deadline = clock.monotonic + validate_challenge(challenge, clock, fresh.binding.original_expires_ms)?;
    let (transaction, clock) = live_clock_or_terminal(transaction, &fresh.binding, clock)?;
    if clock.monotonic >= fresh.original_deadline || clock.wall_ms < row.last_wall_ms ||
        clock.wall_ms >= fresh.binding.original_expires_ms {
        terminal(&transaction, &fresh.binding)?; transaction.commit()?; return denied();
    }
    if clock.wall_ms >= challenge.expires_ms || clock.monotonic >= deadline {
        terminal(&transaction, &fresh.binding)?; transaction.commit()?; return denied();
    }
    validate_challenge(challenge, clock, fresh.binding.original_expires_ms)?;
    set_challenge(&transaction, &fresh.binding, challenge, clock, "challenged")?;
    transaction.commit()?;
    Ok(PendingRuntimeChallenge { binding: fresh.binding, reservation_id: fresh.reservation_id,
        challenge: challenge.clone(), prior: None, issued_ms,
        monotonic_deadline: deadline.min(fresh.original_deadline) })
}
command ChallengeManagedRuntimeInitialCommand {
    fresh: FreshRuntimeReservation = fresh,
    challenge: RuntimeChallengeSpec = challenge.clone(), clock: RuntimeLeaseClock = clock,
}
call |command| (command.fresh, &command.challenge, command.clock)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

coordinated_command! {
/// Renewal requires the live sealed capability plus matching retained native
/// acknowledgment. The caller separately proves the exact native run is active.
/// Initial challenges are never recovered or renewed from journal uncertainty.
pub fn challenge_managed_runtime_renewal(path: &Path, active: &ActiveRuntimeLease,
    native: &ManagedRuntimeObservation, challenge: &RuntimeChallengeSpec, clock: RuntimeLeaseClock)
    -> LeaseResult<PendingRuntimeChallenge> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = read_row(&transaction, &active.binding)?;
    if !matches_active(&row, active) { return denied(); }
    let issued_ms = clock.wall_ms;
    let deadline = clock.monotonic + validate_challenge(challenge, clock, active.snapshot.expires_ms)?;
    let (transaction, clock) = live_clock_or_terminal(transaction, &active.binding, clock)?;
    if expired(&row, active, clock) {
        terminal(&transaction, &active.binding)?; transaction.commit()?; return denied();
    }
    let observed = read_with_connection(&transaction, &active.binding.identity)?
        .ok_or(ManagedRuntimeJournalError::MissingOperation)?;
    if matches!(native, ManagedRuntimeObservation::NotAdmitted) || observed.observation.as_ref() != Some(native) {
        return denied();
    }
    if row.challenge_sha256.is_some() { return denied(); }
    if clock.wall_ms >= challenge.expires_ms || clock.monotonic >= deadline {
        terminal(&transaction, &active.binding)?; transaction.commit()?; return denied();
    }
    validate_challenge(challenge, clock, active.snapshot.expires_ms)?;
    set_challenge(&transaction, &active.binding, challenge, clock, "active")?;
    transaction.commit()?;
    Ok(PendingRuntimeChallenge { binding: active.binding.clone(), reservation_id: active.reservation_id,
        challenge: challenge.clone(), prior: Some(active.snapshot.clone()), issued_ms,
        monotonic_deadline: deadline.min(active.monotonic_deadline) })
}
command ChallengeManagedRuntimeRenewalCommand {
    active: ActiveRuntimeLeaseCheck = ActiveRuntimeLeaseCheck::from(active), native: ManagedRuntimeObservation = native.clone(),
    challenge: RuntimeChallengeSpec = challenge.clone(), clock: RuntimeLeaseClock = clock,
}
call |command| (&command.active.0, &command.native, &command.challenge, command.clock)
correlation |_command| crate::telemetry::Correlation::default();
port internal;
}

coordinated_command! {
/// Atomically consume the pending challenge and advance one stable lease.
/// Dropped/uncertain commit delivery does not recreate this sealed capability.
pub fn consume_managed_runtime_challenge(path: &Path, pending: PendingRuntimeChallenge,
    response: &RuntimeLeaseResponse, clock: RuntimeLeaseClock) -> LeaseResult<ActiveRuntimeLease> {
    let mut connection = open_runtime_connection(path)?;
    consume_with_connection(&mut connection, pending, response, clock, || Ok(()))
}
command ConsumeManagedRuntimeChallengeCommand {
    pending: PendingRuntimeChallenge = pending, response: RuntimeLeaseResponse = response.clone(), clock: RuntimeLeaseClock = clock,
}
call |command| (command.pending, &command.response, command.clock)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

fn consume_with_connection(
    connection: &mut Connection,
    pending: PendingRuntimeChallenge,
    response: &RuntimeLeaseResponse,
    clock: RuntimeLeaseClock,
    after_commit: impl FnOnce() -> Result<()>,
) -> LeaseResult<ActiveRuntimeLease> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = read_row(&transaction, &pending.binding)?;
    if row.reservation_id != pending.reservation_id
        || row.phase == "terminal"
        || row.lease != pending.prior
        || row.challenge_sha256.as_deref()
            != Some(digest_hex(&pending.challenge.challenge_sha256).as_str())
        || row.channel_id.as_deref() != Some(pending.challenge.channel_id.to_string().as_str())
        || row.challenge_expires_ms != Some(pending.challenge.expires_ms)
    {
        return denied();
    }
    let receipt_deadline =
        clock.monotonic + remaining_ms(clock.wall_ms, response.lease.expires_ms, 60_000)?;
    let (transaction, clock) = live_clock_or_terminal(transaction, &pending.binding, clock)?;
    if clock.wall_ms < row.last_wall_ms
        || clock.wall_ms >= pending.challenge.expires_ms
        || clock.monotonic >= pending.monotonic_deadline
        || clock.monotonic >= receipt_deadline
        || pending
            .prior
            .as_ref()
            .is_some_and(|prior| clock.wall_ms >= prior.expires_ms)
    {
        terminal(&transaction, &pending.binding)?;
        transaction.commit()?;
        return denied();
    }
    if response.channel_id != pending.challenge.channel_id
        || response.challenge_sha256 != pending.challenge.challenge_sha256
        || response.observed_ms < pending.issued_ms
        || response.observed_ms > clock.wall_ms
    {
        return denied();
    }
    remaining_ms(response.observed_ms, response.lease.expires_ms, 60_000)?;
    let remaining = remaining_ms(clock.wall_ms, response.lease.expires_ms, 60_000)?;
    match &pending.prior {
        None if response.lease.sequence != 1
            || response.lease.expires_ms > pending.binding.original_expires_ms =>
        {
            return denied()
        }
        Some(prior)
            if response.lease.lease_id != prior.lease_id
                || response.lease.sequence <= prior.sequence =>
        {
            return denied()
        }
        _ => {}
    }
    transaction.execute(
        "UPDATE managed_runtime_leases SET phase = 'active', last_wall_ms = ?2,
        challenge_sha256 = NULL, channel_id = NULL, challenge_expires_ms = NULL,
        lease_id = ?3, lease_sequence = ?4, lease_expires_ms = ?5 WHERE operation_id = ?1",
        params![
            pending.binding.identity.operation_id.to_string(),
            clock.wall_ms,
            response.lease.lease_id.to_string(),
            response.lease.sequence,
            response.lease.expires_ms
        ],
    )?;
    transaction.commit()?;
    after_commit()?;
    Ok(ActiveRuntimeLease {
        binding: pending.binding,
        reservation_id: pending.reservation_id,
        snapshot: response.lease.clone(),
        monotonic_deadline: (clock.monotonic + remaining).min(receipt_deadline),
    })
}

coordinated_command! {
/// Checks retained state plus both clocks. Expiry or rollback commits terminal
/// state. This never reconstructs a capability from readback or revokes a host key.
pub fn check_managed_runtime_lease(path: &Path, active: &ActiveRuntimeLease, clock: RuntimeLeaseClock) -> LeaseResult<bool> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = read_row(&transaction, &active.binding)?;
    let (transaction, clock) = live_clock_or_terminal(transaction, &active.binding, clock)?;
    let valid = matches_active(&row, active) && !expired(&row, active, clock);
    if valid {
        transaction.execute("UPDATE managed_runtime_leases SET last_wall_ms = ?2 WHERE operation_id = ?1",
            params![active.binding.identity.operation_id.to_string(), clock.wall_ms])?;
    } else if matches_active(&row, active) {
        terminal(&transaction, &active.binding)?;
    }
    transaction.commit()?;
    Ok(valid)
}
command CheckManagedRuntimeLeaseCommand {
    active: ActiveRuntimeLeaseCheck = ActiveRuntimeLeaseCheck::from(active), clock: RuntimeLeaseClock = clock,
}
call |command| (&command.active.0, command.clock)
correlation |_command| crate::telemetry::Correlation::default();
port internal;
}

// Private queue copy is not exposed as a cloneable dispatch capability.
pub(crate) struct ActiveRuntimeLeaseCheck(ActiveRuntimeLease);
impl From<&ActiveRuntimeLease> for ActiveRuntimeLeaseCheck {
    fn from(active: &ActiveRuntimeLease) -> Self {
        Self(ActiveRuntimeLease {
            binding: active.binding.clone(),
            reservation_id: active.reservation_id,
            snapshot: active.snapshot.clone(),
            monotonic_deadline: active.monotonic_deadline,
        })
    }
}
impl StoreCoordinator {
    pub(crate) async fn challenge_runtime_lease_view(
        &self,
        active: ActiveRuntimeLeaseCheck,
        native: ManagedRuntimeObservation,
        challenge: RuntimeChallengeSpec,
        clock: RuntimeLeaseClock,
    ) -> LeaseResult<PendingRuntimeChallenge> {
        self.submit(ChallengeManagedRuntimeRenewalCommand {
            active,
            native,
            challenge,
            clock,
        })?
        .acknowledge()
        .await?
    }
    pub(crate) async fn check_runtime_lease_view(
        &self,
        active: ActiveRuntimeLeaseCheck,
        clock: RuntimeLeaseClock,
    ) -> LeaseResult<bool> {
        self.submit(CheckManagedRuntimeLeaseCommand { active, clock })?
            .acknowledge()
            .await?
    }
    pub async fn challenge_managed_runtime_renewal(
        &self,
        active: &ActiveRuntimeLease,
        native: ManagedRuntimeObservation,
        challenge: RuntimeChallengeSpec,
        clock: RuntimeLeaseClock,
    ) -> LeaseResult<PendingRuntimeChallenge> {
        self.submit(ChallengeManagedRuntimeRenewalCommand {
            active: active.into(),
            native,
            challenge,
            clock,
        })?
        .acknowledge()
        .await?
    }
    pub async fn check_managed_runtime_lease(
        &self,
        active: &ActiveRuntimeLease,
        clock: RuntimeLeaseClock,
    ) -> LeaseResult<bool> {
        self.submit(CheckManagedRuntimeLeaseCommand {
            active: active.into(),
            clock,
        })?
        .acknowledge()
        .await?
    }
}

coordinated_command! {
/// Explicit connection loss, assignment removal, stop or serving shutdown is
/// terminal for this exact operation. It cannot affect another host operation.
pub fn terminate_managed_runtime_lease(path: &Path, binding: &RuntimeLeaseBinding) -> LeaseResult<()> {
    let mut connection = open_runtime_connection(path)?;
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let row = read_row(&transaction, binding)?;
    if row.phase != "terminal" { terminal(&transaction, binding)?; }
    transaction.commit()?;
    Ok(())
}
command TerminateManagedRuntimeLeaseCommand { binding: RuntimeLeaseBinding = binding.clone(), }
call |command| (&command.binding)
correlation |_command| crate::telemetry::Correlation::default();
port public;
}

fn denied<T>() -> LeaseResult<T> {
    Err(ManagedRuntimeJournalError::LeaseDenied)
}

fn live_clock_or_terminal<'a>(
    transaction: Transaction<'a>,
    binding: &RuntimeLeaseBinding,
    clock: RuntimeLeaseClock,
) -> LeaseResult<(Transaction<'a>, RuntimeLeaseClock)> {
    match clock.at_execution() {
        Ok(clock) => Ok((transaction, clock)),
        Err(error) => {
            terminal(&transaction, binding)?;
            transaction.commit()?;
            Err(error)
        }
    }
}

fn remaining_ms(now: i64, expires: i64, maximum: i64) -> LeaseResult<Duration> {
    let remaining = expires
        .checked_sub(now)
        .filter(|remaining| now >= 0 && *remaining > 0 && *remaining <= maximum)
        .ok_or(ManagedRuntimeJournalError::LeaseDenied)?;
    Ok(Duration::from_millis(
        u64::try_from(remaining).map_err(|_| ManagedRuntimeJournalError::LeaseDenied)?,
    ))
}

fn validate_challenge(
    challenge: &RuntimeChallengeSpec,
    clock: RuntimeLeaseClock,
    deadline: i64,
) -> LeaseResult<Duration> {
    if challenge.expires_ms > deadline {
        return denied();
    }
    remaining_ms(clock.wall_ms, challenge.expires_ms, 10_000)
}

fn set_challenge(
    transaction: &Transaction<'_>,
    binding: &RuntimeLeaseBinding,
    challenge: &RuntimeChallengeSpec,
    clock: RuntimeLeaseClock,
    phase: &str,
) -> LeaseResult<()> {
    transaction.execute(
        "UPDATE managed_runtime_leases SET phase = ?2, last_wall_ms = ?3,
        challenge_sha256 = ?4, channel_id = ?5, challenge_expires_ms = ?6 WHERE operation_id = ?1",
        params![
            binding.identity.operation_id.to_string(),
            phase,
            clock.wall_ms,
            digest_hex(&challenge.challenge_sha256),
            challenge.channel_id.to_string(),
            challenge.expires_ms
        ],
    )?;
    Ok(())
}

fn matches_active(row: &LeaseRow, active: &ActiveRuntimeLease) -> bool {
    row.reservation_id == active.reservation_id
        && row.phase == "active"
        && row.lease.as_ref() == Some(&active.snapshot)
}

fn expired(row: &LeaseRow, active: &ActiveRuntimeLease, clock: RuntimeLeaseClock) -> bool {
    clock.wall_ms < row.last_wall_ms
        || clock.wall_ms >= active.snapshot.expires_ms
        || clock.monotonic >= active.monotonic_deadline
}

fn terminal(transaction: &Transaction<'_>, binding: &RuntimeLeaseBinding) -> LeaseResult<()> {
    transaction.execute("UPDATE managed_runtime_leases SET phase = 'terminal',
        challenge_sha256 = NULL, channel_id = NULL, challenge_expires_ms = NULL WHERE operation_id = ?1 AND phase != 'terminal'",
        [binding.identity.operation_id.to_string()])?;
    Ok(())
}

fn read_row(connection: &Connection, binding: &RuntimeLeaseBinding) -> LeaseResult<LeaseRow> {
    read_with_connection(connection, &binding.identity)?
        .ok_or(ManagedRuntimeJournalError::MissingOperation)?;
    let row = connection.query_row("SELECT reservation_id, assignment_sha256, serving_lifetime_id, original_expires_ms,
        phase, last_wall_ms, challenge_sha256, channel_id, challenge_expires_ms, lease_id, lease_sequence, lease_expires_ms
        FROM managed_runtime_leases WHERE operation_id = ?1", [binding.identity.operation_id.to_string()], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?,
            row.get::<_, String>(4)?, row.get::<_, i64>(5)?, row.get::<_, Option<String>>(6)?, row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<i64>>(8)?, row.get::<_, Option<String>>(9)?, row.get::<_, Option<i64>>(10)?, row.get::<_, Option<i64>>(11)?))
    }).optional()?.ok_or(ManagedRuntimeJournalError::LeaseDenied)?;
    if row.1 != digest_hex(&binding.assignment_sha256)
        || row.2 != binding.serving_lifetime_id.to_string()
        || row.3 != binding.original_expires_ms
    {
        return Err(ManagedRuntimeJournalError::BindingConflict);
    }
    let lease = match (row.9, row.10, row.11) {
        (None, None, None) => None,
        (Some(id), Some(sequence), Some(expires_ms)) => Some(RuntimeLeaseSnapshot {
            lease_id: Uuid::parse_str(&id)?,
            sequence,
            expires_ms,
        }),
        _ => return denied(),
    };
    Ok(LeaseRow {
        reservation_id: Uuid::parse_str(&row.0)?,
        phase: row.4,
        last_wall_ms: row.5,
        challenge_sha256: row.6,
        channel_id: row.7,
        challenge_expires_ms: row.8,
        lease,
    })
}

#[cfg(test)]
#[path = "managed_runtime_leases_tests.rs"]
mod tests;
