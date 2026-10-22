//! Concrete client construction and retained partial-failure cleanup.
#[cfg(test)]
use super::super::resources::ResourceLimits;
use super::super::{
    construction::{BuildControl, ConstructionFailure, NativeCleanup},
    resources::{ResourcePlan, StorageCharge},
    stop::RawRunnerCleanup,
};
use super::*;
use crate::execution_supervision::ExecutionSupervisionChannel;
use nac_core::runtime::CompartmentStorageHold;
use nac_process::peer_channel::PeerLifetime;

impl NativeExecutionTransport {
    /// Concrete issuer-owned direct child route. The supplied client charge
    /// stays in this actor; the runner charge stays in the actual child owner.
    /// This is not lifecycle consumption or a protected Core factory.
    #[cfg(target_os = "linux")]
    pub(in super::super::super) fn from_owned_runner(
        channel: ExecutionSupervisionChannel,
        runner: Arc<super::super::issuer_process::IssuerRunnerCustody>,
        plan: ResourcePlan,
    ) -> std::result::Result<(Self, PeerLifetime), ConstructionFailure> {
        let storage = runner.client_storage();
        if let Err(error) = runner.require_peer(&channel.peer, &plan) {
            let cutoff = runner.original_cutoff();
            return Err(
                NativeCleanup::new(runner, StorageCharge::Accounted(storage), cutoff).failed(error),
            );
        }
        Self::from_negotiated(channel, runner, plan, storage)
    }
    pub(in super::super::super) fn from_negotiated(
        channel: ExecutionSupervisionChannel,
        runner: Arc<dyn RawRunnerCleanup>,
        plan: ResourcePlan,
        storage: CompartmentStorageHold,
    ) -> std::result::Result<(Self, PeerLifetime), ConstructionFailure> {
        Self::construct(
            channel,
            runner,
            plan,
            StorageCharge::Accounted(storage),
            BuildControl::Normal,
        )
    }

    pub(in super::super) fn construct(
        channel: ExecutionSupervisionChannel,
        runner: Arc<dyn RawRunnerCleanup>,
        plan: ResourcePlan,
        storage: StorageCharge,
        control: BuildControl,
    ) -> std::result::Result<(Self, PeerLifetime), ConstructionFailure> {
        let cutoff = plan.policy_cutoff(channel.peer.original_cutoff());
        let mut cleanup = NativeCleanup::new(Arc::clone(&runner), storage, cutoff);
        let result = (|| {
            let pool = ResourcePool::new(plan, cleanup.storage.clone())?;
            let (wire, owner) = NativeWire::from_negotiated(
                channel,
                Direction::ToClient,
                pool.limits().wire_records,
                Arc::clone(&cleanup.tasks),
            )?;
            control.after_wire()?;
            let sender = wire.sender();
            let tasks = wire.tasks();
            let (gate, denial, _) = sender.physical_observer();
            let scope = StopScope::start(gate, denial, Arc::clone(&runner), cutoff)?;
            cleanup.scope = Some(Arc::clone(&scope));
            pool.observe_policy(&scope, &cleanup.tasks, cutoff)?;
            let (requests, incoming) = mpsc::channel(pool.limits().live_jobs.get());
            let task_stop = StopOnDrop::new(Arc::clone(&scope));
            let task_scope = Arc::clone(&scope);
            let task_pool = Arc::clone(&pool);
            let binding = sender.binding();
            let _actor = tasks.spawn(&tokio::runtime::Handle::current(), async move {
                let _stop = task_stop;
                let _result = run(wire, sender, incoming, task_scope, task_pool).await;
            })?;
            let stop = StopOnDrop::new(Arc::clone(&scope));
            Ok((
                Self {
                    scope,
                    pool,
                    binding,
                    requests,
                    tasks,
                    _stop: stop,
                },
                owner,
            ))
        })();
        match result {
            Ok(value) => {
                cleanup.disarm();
                Ok(value)
            }
            Err(error) => Err(cleanup.failed(error)),
        }
    }

    #[cfg(test)]
    pub(in super::super) fn unaccounted_for_test(
        channel: ExecutionSupervisionChannel,
        runner: Arc<dyn RawRunnerCleanup>,
        limits: ResourceLimits,
    ) -> Result<(Self, PeerLifetime)> {
        Ok(Self::construct(
            channel,
            runner,
            limits.validate()?,
            StorageCharge::Unaccounted,
            BuildControl::Normal,
        )?)
    }
}
