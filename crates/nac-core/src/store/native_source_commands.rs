//! Typed persistence dispatch retaining the original reservation allocation.
use super::*;
use crate::store::coordinator::PersistenceCommand;

struct Reserve {
    binding: NativeSourceBinding,
    cutoff: Instant,
}
impl PersistenceCommand for Reserve {
    type Output = Result<NativeSourceReservation>;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some(&self.binding.session_id))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        Ok(NativeSourceReservation::reserve_local(
            path,
            self.binding,
            self.cutoff,
        ))
    }
}
pub(super) fn reserve(
    path: &Path,
    binding: NativeSourceBinding,
    cutoff: Instant,
) -> Result<NativeSourceReservation> {
    let command = Reserve { binding, cutoff };
    if let Some(owner) = super::super::coordinator::owner_for(path)? {
        owner.check_blocking_context()?;
        owner.submit(command)?.acknowledge_blocking()?
    } else {
        command.execute(path)?
    }
}

pub(super) enum Action {
    Observe,
    Begin,
    NoStart,
    Uncertain,
}
struct Transition {
    state: Arc<SourceState>,
    action: Action,
}
impl PersistenceCommand for Transition {
    type Output = Result<()>;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::session(Some(&self.state.binding.session_id))
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        anyhow::ensure!(
            std::fs::canonicalize(path)? == self.state.path,
            "native source executor store mismatch"
        );
        Ok(match self.action {
            Action::Observe => self.state.check_current_local(),
            Action::Begin => self.state.begin_preparation_local(),
            Action::NoStart => self.state.release_known_no_start_local(),
            Action::Uncertain => self.state.mark_uncertain_local(),
        })
    }
}
pub(super) fn run(source: &NativeSourceReservation, action: Action) -> Result<()> {
    let command = Transition {
        state: Arc::clone(&source.state),
        action,
    };
    if let Some(owner) = super::super::coordinator::owner_for(&source.path)? {
        owner.check_blocking_context()?;
        owner.submit(command)?.acknowledge_blocking()?
    } else {
        command.execute(&source.path)?
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReservationStatus {
    Pending,
    Preparing,
    Prepared,
    Uncertain,
    NoStart,
}
/// Durable observation only. It never reconstructs an original reservation.
pub(crate) struct ReservationObservation {
    pub binding: NativeSourceBinding,
    pub status: ReservationStatus,
}
struct Observe {
    operation: Uuid,
}
impl PersistenceCommand for Observe {
    type Output = Result<Option<ReservationObservation>>;
    fn correlation(&self) -> crate::telemetry::Correlation {
        crate::telemetry::Correlation::default()
    }
    fn execute(self, path: &Path) -> Result<Self::Output> {
        let read = (|| {
            let c = open_runtime_connection(path)?;
            let row: Option<(String, String)> = c
                .query_row(
                    "SELECT binding_json,state FROM native_source_reservations WHERE operation_id=?1",
                    [self.operation.to_string()],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            row.map(|(json, state)| {
                let binding: NativeSourceBinding = serde_json::from_str(&json)?;
                binding.validate()?;
                let status = match state.as_str() {
                    "pending" => ReservationStatus::Pending,
                    "preparing" => ReservationStatus::Preparing,
                    "prepared" => ReservationStatus::Prepared,
                    "uncertain" => ReservationStatus::Uncertain,
                    "no_start" => ReservationStatus::NoStart,
                    _ => anyhow::bail!("invalid native source state"),
                };
                Ok(ReservationObservation { binding, status })
            })
            .transpose()
        })();
        Ok(read)
    }
}
pub(crate) fn observe_reservation(
    path: &Path,
    operation: Uuid,
) -> Result<Option<ReservationObservation>> {
    let command = Observe { operation };
    if let Some(owner) = super::super::coordinator::owner_for(path)? {
        owner.check_blocking_context()?;
        owner.submit(command)?.acknowledge_blocking()?
    } else {
        command.execute(path)?
    }
}
