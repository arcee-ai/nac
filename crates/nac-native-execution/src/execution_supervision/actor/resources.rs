//! Native-owned storage/admission resources, separate from Core output retention.
//! Construction is explicit; no product policy or numeric default lives here.
use super::super::{job_wire, protocol::MAX_DATA, MAX_FRAME};
use anyhow::{ensure, Context, Result};
use nac_capacity_policy::PolicySource;
use nac_core::runtime::{CompartmentResourceDeclaration, CompartmentStorageHold};
use std::{
    num::NonZeroUsize,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub(in super::super) struct ResourceLimits {
    pub live_jobs: NonZeroUsize,
    pub wire_records: NonZeroUsize,
    pub flow_window: NonZeroUsize,
    pub owned_input_bytes: usize,
    pub capture_bytes: usize,
}

pub(super) struct ResourcePool {
    plan: ResourcePlan,
    used: Mutex<Used>,
    _storage: StorageCharge,
}

/// One concrete immutable plan: declaration and construction share this value.
#[derive(Clone)]
pub(in super::super) struct ResourcePlan {
    limits: ResourceLimits,
    declaration: CompartmentResourceDeclaration,
    policy_source: Option<Arc<PolicySource>>,
    issuer_storage: Option<Arc<IssuerRetainedStorage>>,
}

/// The issuer owns both Core holds. A child retains its actual original-parent
/// channel custody; only that private path may use the charged child allocation.
#[derive(Clone)]
pub(in super::super) enum StorageCharge {
    Accounted(CompartmentStorageHold),
    #[cfg(target_os = "linux")]
    IssuerRetained(Arc<IssuerRetainedStorage>),
    #[cfg(test)]
    Unaccounted,
}
impl StorageCharge {
    fn check(&self, declaration: CompartmentResourceDeclaration) -> Result<()> {
        match self {
            Self::Accounted(hold) => ensure!(
                hold.declaration() == declaration,
                "Native concrete plan differs from admitted Core storage"
            ),
            #[cfg(target_os = "linux")]
            Self::IssuerRetained(original) => {
                original.gate.check_current()?;
                ensure!(
                    original.declaration == declaration,
                    "original issuer storage plan differs"
                );
            }
            #[cfg(test)]
            Self::Unaccounted => {}
        }
        Ok(())
    }
}
pub(in super::super) struct IssuerRetainedStorage {
    gate: nac_process::peer_channel::PeerIoGate,
    declaration: CompartmentResourceDeclaration,
}
#[derive(Default)]
struct Used {
    jobs: usize,
    input: usize,
    capture: usize,
}

pub(super) struct JobReservation {
    pool: Arc<ResourcePool>,
    input: usize,
}
pub(super) struct CaptureReservation {
    pool: Arc<ResourcePool>,
    bytes: usize,
}

impl ResourceLimits {
    pub(in super::super) fn validate(self) -> Result<ResourcePlan> {
        let limits = self;
        ensure!(
            limits.wire_records.get() <= tokio::sync::Semaphore::MAX_PERMITS
                && limits.live_jobs.get() <= tokio::sync::Semaphore::MAX_PERMITS,
            "Native wire queue capacity overflow"
        );
        // Overflow checks for the explicit payload dimensions, not a complete
        // allocator/RSS budget. At most three byte queues and two incoming
        // assemblies coexist with three 16-KiB scheduler/capture scratch blocks
        // per client job. Fixed metadata, allocator rounding, task/kernel state
        // and decoded command containers also exist; these limits are per
        // transport. Core separately admits their aggregate host/session charge.
        let flow = limits
            .flow_window
            .get()
            .checked_mul(3)
            .and_then(|bytes| bytes.checked_add(5 * MAX_DATA))
            .and_then(|bytes| bytes.checked_mul(limits.live_jobs.get()))
            .context("Native flow storage overflow")?;
        let commands = job_wire::MAX_ENCODED_COMMAND
            .checked_mul(2)
            .and_then(|bytes| bytes.checked_add(super::super::protocol::MAX_COMMAND_BYTES))
            .and_then(|bytes| bytes.checked_mul(limits.live_jobs.get()))
            .context("Native command storage overflow")?;
        let wire = limits
            .wire_records
            .get()
            .checked_mul(MAX_FRAME)
            .and_then(|bytes| bytes.checked_mul(2))
            .context("Native wire storage overflow")?;
        let payload = flow
            .checked_add(commands)
            .and_then(|bytes| bytes.checked_add(wire))
            .and_then(|bytes| bytes.checked_add(limits.owned_input_bytes))
            .and_then(|bytes| bytes.checked_add(limits.capture_bytes))
            .context("Native variable storage overflow")?;
        let declaration = CompartmentResourceDeclaration::from_raw_capacity(
            limits.live_jobs,
            limits.wire_records,
            limits.flow_window,
            limits.owned_input_bytes,
            limits.capture_bytes,
            NonZeroUsize::new(payload).context("Native payload capacity is zero")?,
        );
        Ok(ResourcePlan {
            limits,
            declaration,
            policy_source: None,
            issuer_storage: None,
        })
    }
}
impl ResourcePlan {
    pub(in super::super) fn dimensions(&self) -> [usize; 5] {
        [
            self.limits.live_jobs.get(),
            self.limits.wire_records.get(),
            self.limits.flow_window.get(),
            self.limits.owned_input_bytes,
            self.limits.capture_bytes,
        ]
    }
    /// Only the fixed child entry can call this after actual original-parent
    /// capture. These are resource custody, never a reconstructed Core hold.
    #[cfg(target_os = "linux")]
    pub(in super::super) fn bind_issuer_storage(
        mut self,
        channel: &super::super::ExecutionSupervisionChannel,
    ) -> Result<(Self, StorageCharge)> {
        channel.check_current()?;
        channel.peer.require_original_parent()?;
        let original = Arc::new(IssuerRetainedStorage {
            gate: channel.stream.io_gate(),
            declaration: self.declaration,
        });
        self.issuer_storage = Some(Arc::clone(&original));
        Ok((self, StorageCharge::IssuerRetained(original)))
    }
    pub(in super::super) fn retained_policy_source(&self) -> Result<Arc<PolicySource>> {
        let source = self
            .policy_source
            .as_ref()
            .context("Native capacity policy unavailable")?;
        source.check_current()?;
        Ok(Arc::clone(source))
    }
    pub(in super::super) fn declaration(&self) -> CompartmentResourceDeclaration {
        self.declaration
    }
}
impl ResourcePool {
    pub(super) fn new(plan: ResourcePlan, storage: StorageCharge) -> Result<Arc<Self>> {
        #[cfg(not(test))]
        ensure!(
            plan.policy_source.is_some() || plan.issuer_storage.is_some(),
            "Native capacity policy unavailable"
        );
        plan.check_policy()?;
        if let Some(original) = &plan.issuer_storage {
            #[cfg(target_os = "linux")]
            ensure!(
                matches!(&storage, StorageCharge::IssuerRetained(held) if Arc::ptr_eq(original, held)),
                "Native original issuer storage allocation differs"
            );
            #[cfg(not(target_os = "linux"))]
            {
                let _ = original;
                anyhow::bail!("original issuer storage requires Linux");
            }
        }
        storage.check(plan.declaration())?;
        Ok(Arc::new(Self {
            plan,
            used: Mutex::new(Used::default()),
            _storage: storage,
        }))
    }

    #[cfg(test)]
    pub(super) fn unaccounted_for_test(limits: ResourceLimits) -> Result<Arc<Self>> {
        Self::new(limits.validate()?, StorageCharge::Unaccounted)
    }

    pub(super) fn limits(&self) -> &ResourceLimits {
        &self.plan.limits
    }

    /// Input is charged by the actual transferred Vec capacity, including spare
    /// capacity. Whole-result capture reserves both independent prepared ceilings.
    /// Streaming jobs pass zero capture; Core owns their retained-output policy.
    pub(super) fn reserve(
        self: &Arc<Self>,
        input: usize,
        capture: usize,
    ) -> Result<(JobReservation, CaptureReservation)> {
        self.plan.check_policy()?;
        let mut used = self
            .used
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let jobs = used
            .jobs
            .checked_add(1)
            .context("Native job count overflow")?;
        let next_input = used
            .input
            .checked_add(input)
            .context("Native input storage overflow")?;
        let next_capture = used
            .capture
            .checked_add(capture)
            .context("Native capture storage overflow")?;
        ensure!(
            jobs <= self.limits().live_jobs.get()
                && next_input <= self.limits().owned_input_bytes
                && next_capture <= self.limits().capture_bytes,
            "Native construction resources exhausted"
        );
        *used = Used {
            jobs,
            input: next_input,
            capture: next_capture,
        };
        let reserved = (
            JobReservation {
                pool: Arc::clone(self),
                input,
            },
            CaptureReservation {
                pool: Arc::clone(self),
                bytes: capture,
            },
        );
        drop(used);
        // A source retired during accounting cannot publish a new job. The
        // original local reservations undo only these just-added quantities.
        self.plan.check_policy()?;
        Ok(reserved)
    }
}
impl Drop for JobReservation {
    fn drop(&mut self) {
        let mut used = self
            .pool
            .used
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        used.jobs -= 1;
        used.input -= self.input;
    }
}

impl Drop for CaptureReservation {
    fn drop(&mut self) {
        self.pool
            .used
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .capture -= self.bytes;
    }
}

mod policy;
#[cfg(test)]
mod tests;
