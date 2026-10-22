//! SAME serving-root custody for concrete Core/Native attempts. Registration
//! and resource observations grant no admission; original Core verifies that.
use super::{
    create_transfer::CreateTransferAttempt, managed_create_producer::ManagedCreateProducerOutput,
    managed_create_request::ValidatedManagedCreateRequest,
    managed_create_resources::ManagedCreateResources,
    prepared_location_custody::PreparedLocationCustody,
    session_creation::SessionCreationApplication,
};
use anyhow::{anyhow, ensure, Result};
use nac_core::runtime::PreparationResourceCustody;
use nac_core::runtime::{
    ManagedCreateRegistry, PostImportRuntimeHost, RegisteredManagedCreate, RunOptions,
};
use nac_native_execution::{NativeCreateLaunch, NativeCreateResources};
use std::{
    sync::{Arc, Mutex},
    time::Instant,
};
use tokio::task::JoinHandle;

pub(crate) struct ManagedCreateAttempts {
    core: Arc<ManagedCreateRegistry>,
    originals: Mutex<Vec<Arc<ManagedCreateAttempt>>>,
}
impl Default for ManagedCreateAttempts {
    fn default() -> Self {
        Self {
            core: ManagedCreateRegistry::new(),
            originals: Mutex::new(Vec::new()),
        }
    }
}
pub(crate) struct ManagedCreateAttempt {
    pub(crate) core: RegisteredManagedCreate,
    resources: ManagedCreateResources,
    execution: Arc<NativeCreateResources>,
    native: Arc<tokio::sync::Mutex<NativeCreateLaunch>>,
    launch_worker: tokio::sync::Mutex<Option<JoinHandle<Result<()>>>>,
    producer: Mutex<Vec<Arc<Mutex<ManagedCreateProducerOutput>>>>,
}
impl ManagedCreateAttempts {
    pub(crate) fn retain(
        &self,
        exchange: nac_runtime_auth::CreateExchange,
        host: Arc<PostImportRuntimeHost>,
        options: RunOptions,
        location: PreparedLocationCustody,
        execution: Arc<NativeCreateResources>,
    ) -> Arc<ManagedCreateAttempt> {
        let shared: Arc<dyn PreparationResourceCustody> =
            Arc::<NativeCreateResources>::clone(&execution);
        let resources = ManagedCreateResources::retain(location, shared);
        let core = self
            .core
            .retain(exchange, host, options, resources.preparation());
        let original = Arc::new(ManagedCreateAttempt {
            core,
            resources,
            native: Arc::new(tokio::sync::Mutex::new(NativeCreateLaunch::retain(
                Arc::clone(&execution),
            ))),
            execution,
            launch_worker: tokio::sync::Mutex::new(None),
            producer: Mutex::new(Vec::new()),
        });
        self.originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(Arc::clone(&original));
        original
    }
    pub(crate) fn close(&self) {
        self.core.close();
        // Stop concrete pending/active Native allocations synchronously; a
        // verifier or queued launcher cannot acquire a fresh positive lifetime.
        for original in self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
        {
            original.execution.deny();
        }
    }
    pub(crate) async fn drain(&self, cutoff: Instant) -> Result<()> {
        self.close();
        let originals = self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let mut first = None;
        for original in originals {
            if let Err(error) = original.reap_native(cutoff).await {
                first.get_or_insert(error);
            }
        }
        if let Err(error) = self.core.close_and_reap(cutoff).await {
            first.get_or_insert(error);
        }
        match first {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
struct DenyIncomplete<'a> {
    attempt: &'a ManagedCreateAttempt,
    completed: bool,
}
impl Drop for DenyIncomplete<'_> {
    fn drop(&mut self) {
        if !self.completed {
            self.attempt.core.deny();
            self.attempt.execution.deny();
        }
    }
}
impl ManagedCreateAttempt {
    /// Actual typed producer, stored by this registry BEFORE any source/Native
    /// work. The original blocking launcher is separately retained before await.
    pub(crate) async fn prepare_native(&self) -> Result<()> {
        let mut guard = DenyIncomplete {
            attempt: self,
            completed: false,
        };
        let factory = self.core.verify_factory().await?;
        {
            let mut worker = self.launch_worker.lock().await;
            ensure!(worker.is_none(), "original Native launcher already owned");
            let native = Arc::clone(&self.native);
            *worker = Some(tokio::task::spawn_blocking(move || {
                native.blocking_lock().begin(&factory)
            }));
            let result = worker
                .as_mut()
                .ok_or_else(|| anyhow!("original Native launcher absent"))?
                .await;
            // Only the actual terminal worker is removed; unknown/pending
            // allocations remain inside NativeCreateLaunch on every outcome.
            worker.take();
            result.map_err(|_| anyhow!("original Native launcher worker failed"))??;
        }
        {
            let mut original = self.native.lock().await;
            original.connect().await?;
            let custody = original.try_finish()?;
            self.core.retain_native(custody)?; // No intervening await/resource drop.
        }
        self.core.prepare().await?;
        guard.completed = true;
        Ok(())
    }
    pub(crate) async fn publish(
        &self,
        request: ValidatedManagedCreateRequest,
        application: &SessionCreationApplication<'_>,
    ) -> Result<CreateTransferAttempt> {
        let factory = self.core.original_factory()?;
        let admitted = self.core.issue().await?;
        let (location, execution) = self.resources.publication();
        self.start_producer(
            ManagedCreateProducerOutput::retain(admitted, factory, location, execution, request),
            application,
        )
    }
    fn start_producer(
        &self,
        output: ManagedCreateProducerOutput,
        application: &SessionCreationApplication<'_>,
    ) -> Result<CreateTransferAttempt> {
        let original = Arc::new(Mutex::new(output));
        let mut originals = self
            .producer
            .lock()
            .map_err(|_| anyhow!("CREATE producer registry poisoned"))?;
        originals.push(Arc::clone(&original));
        ensure!(originals.len() == 1, "original CREATE producer repeated");
        drop(originals);
        let result = original
            .lock()
            .map_err(|_| anyhow!("original CREATE producer poisoned"))?
            .start(application);
        result
    }
    async fn reap_native(&self, cutoff: Instant) -> Result<()> {
        self.core.deny();
        self.execution.deny();
        let joined = tokio::time::timeout_at(cutoff.into(), async {
            let mut worker = self.launch_worker.lock().await;
            if let Some(original) = worker.as_mut() {
                let _outcome = original.await; // Native retains every partial owner.
                worker.take();
            }
            self.native.lock().await.close_and_reap(cutoff).await
        })
        .await;
        joined.map_err(|_| anyhow!("original Native launch drain cutoff"))?
    }
}
