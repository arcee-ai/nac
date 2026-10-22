//! Private consuming join of the actual connected runner and original Core
//! construction. This accepts neither an arbitrary Command nor a RAW factory.
//! Included as bootstrap::create so no transport constructor becomes public.
use super::*;
use crate::execution_supervision::actor::client::NativeExecutionTransport;
use nac_core::runtime::*;

pub struct NativeCreateJoin {
    connected: Option<ConnectedRunner>,
    construction: NativeCreateConstruction,
    plan: Option<ResourcePlan>,
    runner: Arc<IssuerRunnerCustody>,
    transport: Option<Arc<NativeExecutionTransport>>,
    failure: Option<ConstructionFailure>,
    attempted: bool,
    issued: bool,
    reaped: bool,
    cutoff: Instant,
}
impl NativeCreateJoin {
    /// Retain the actual child, charges, connection and Core owner before the
    /// first fallible join. The serving root must retain this SAME allocation.
    pub(super) fn retain(
        connected: ConnectedRunner,
        construction: NativeCreateConstruction,
        plan: ResourcePlan,
    ) -> Self {
        let runner = Arc::clone(&connected.custody);
        let cutoff = runner.original_cutoff();
        Self {
            connected: Some(connected),
            construction,
            plan: Some(plan),
            runner,
            transport: None,
            failure: None,
            attempted: false,
            issued: false,
            reaped: false,
            cutoff,
        }
    }
    pub fn try_finish(&mut self) -> Result<CreatePublicationCustody> {
        let result = self.finish();
        if result.is_err() {
            self.runner.request_stop(self.cutoff);
        }
        result
    }
    fn finish(&mut self) -> Result<CreatePublicationCustody> {
        ensure!(
            !std::mem::replace(&mut self.attempted, true),
            "Native CREATE join already attempted"
        );
        self.construction.check_current()?;
        let expected = self.construction.policy_source()?;
        let plan = self
            .plan
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("original Native plan moved"))?;
        let actual = plan.retained_policy_source()?;
        ensure!(
            Arc::ptr_eq(&expected, &actual)
                && self.cutoff <= self.construction.currentness().runtime_cutoff()?,
            "Native CREATE original policy/cutoff differs"
        );
        let connected = self
            .connected
            .take()
            .ok_or_else(|| anyhow::anyhow!("original runner moved"))?;
        let plan = self
            .plan
            .take()
            .ok_or_else(|| anyhow::anyhow!("original Native plan absent"))?;
        let (transport, peer) = match connected.into_client(plan) {
            Ok(parts) => parts,
            Err(failure) => {
                // Keep the actual cleanup allocation and wire tasks, including
                // partial client construction. No error-string-only release.
                self.failure = Some(failure);
                anyhow::bail!(
                    "Native CREATE client construction failed; original cleanup retained"
                );
            }
        };
        let transport = Arc::new(transport);
        self.transport = Some(Arc::clone(&transport));
        // Core consumes the SAME unique socket/peer lifetime exactly once. The
        // retained Arc keeps the actual RAW cleanup handle if Core rejects it.
        let custody = self
            .construction
            .finish_native(Box::new(RetainedNative(transport)), peer)?;
        self.issued = true;
        Ok(custody)
    }
    /// Borrowed cleanup retains every owner if cancelled or the original bound
    /// expires. Stop/denial alone is not a joined or restoration receipt.
    pub async fn close_and_reap(&mut self) -> Result<()> {
        self.runner.request_stop(self.cutoff);
        if let Some(transport) = &self.transport {
            transport.close_and_reap(self.cutoff).await?;
        }
        if let Some(failure) = &self.failure {
            failure.cleanup.close_and_reap(self.cutoff).await?;
        }
        self.runner.wait_for_reap(self.cutoff).await?;
        self.reaped = true;
        Ok(())
    }
}
impl Drop for NativeCreateJoin {
    fn drop(&mut self) {
        if !self.issued && !self.reaped {
            self.runner.request_stop(self.cutoff);
        }
        // Actual root drain must await cleanup. This Drop proves no join and
        // must never release an upstream restorative/ACK claim as "clean".
    }
}

/// RAW IO proxy over the SAME actual client allocation. It cannot manufacture
/// Core custody, peers or qualification. The extra owner is needed precisely
/// because Core's consuming error path otherwise drops its transport argument.
struct RetainedNative(Arc<NativeExecutionTransport>);
impl ExecutionCompartmentTransport for RetainedNative {
    fn peer_binding(&self) -> Option<nac_process::peer_channel::PeerBinding> {
        self.0.peer_binding()
    }
    fn execute(
        &self,
        command: CompartmentCommand,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.0.execute(command, cutoff)
    }
    fn native_file_io(
        &self,
        command: CompartmentFileIoCommand,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentOutput> {
        self.0.native_file_io(command, cutoff)
    }
    fn spawn_pipe(
        &self,
        command: CompartmentCommand,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentPipe> {
        self.0.spawn_pipe(command, cutoff)
    }
    fn spawn_pty(
        &self,
        command: CompartmentCommand,
        size: CompartmentPtySize,
        cutoff: Instant,
    ) -> CompartmentFuture<'_, CompartmentPty> {
        self.0.spawn_pty(command, size, cutoff)
    }
    fn close_and_reap(&self, cutoff: Instant) -> CompartmentFuture<'_, ()> {
        self.0.close_and_reap(cutoff)
    }
}

/// Opaque actual failed construction custody. No public data constructor.
pub struct NativeCreateFailure {
    original: ConstructionFailure,
}
impl ConstructionFailure {
    pub(in crate::execution_supervision) fn into_create_failure(self) -> NativeCreateFailure {
        NativeCreateFailure { original: self }
    }
}
impl NativeCreateFailure {
    pub async fn close_and_reap(&mut self, original_cutoff: Instant) -> Result<()> {
        self.original.cleanup.close_and_reap(original_cutoff).await
    }
}
