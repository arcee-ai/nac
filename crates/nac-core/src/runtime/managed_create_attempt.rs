//! Original serving-root registry and genuine CREATE attempt. Registration is
//! resource retention before checks, never admission from a caller's labels.
use super::*;
use super::{
    create_guidance_source::GuidanceReadOwner,
    protected_create_builder::{ProtectedCreateBuild, ProtectedCreateGuidance},
};
use anyhow::{anyhow, ensure};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock, Weak,
};
use tokio::task::JoinHandle;

pub struct ManagedCreateRegistry {
    closed: AtomicBool,
    originals: Mutex<Vec<Arc<Attempt>>>,
}
struct Attempt {
    participant: Arc<create_participant::CreateParticipant>,
    factory: OnceLock<Arc<CreateFactoryOwner>>,
    native: Mutex<Vec<CreatePublicationCustody>>,
    contexts: Mutex<Vec<Arc<ProtectedExecutionContext>>>,
    reads: OnceLock<Arc<GuidanceReadOwner>>,
    build: OnceLock<Arc<tokio::sync::Mutex<ProtectedCreateBuild>>>,
    worker: tokio::sync::Mutex<Option<JoinHandle<Result<()>>>>,
    drained_worker_result: Mutex<Option<Result<()>>>,
    preparing: AtomicBool,
    joined: AtomicBool,
}
/// Nonclone/nonserializable registration bound to an actual retained registry
/// allocation. No public positive constructor; retain() supplies resources only.
pub struct RegisteredManagedCreate {
    root: Weak<ManagedCreateRegistry>,
    original: Arc<Attempt>,
}
impl ManagedCreateRegistry {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            closed: AtomicBool::new(false),
            originals: Mutex::new(Vec::new()),
        })
    }
    /// Store the original attempt before returning any handle that may prepare.
    /// A close racing registration still RETAINS and denies the new allocation.
    pub fn retain(
        self: &Arc<Self>,
        exchange: nac_runtime_auth::CreateExchange,
        host: Arc<PostImportRuntimeHost>,
        options: RunOptions,
        resources: crate::session_service::ProtectedPreparationInput,
    ) -> RegisteredManagedCreate {
        let original = Arc::new(Attempt {
            participant: create_participant::CreateParticipant::retain(
                exchange, host, options, resources,
            ),
            factory: OnceLock::new(),
            native: Mutex::new(Vec::new()),
            contexts: Mutex::new(Vec::new()),
            reads: OnceLock::new(),
            build: OnceLock::new(),
            worker: tokio::sync::Mutex::new(None),
            drained_worker_result: Mutex::new(None),
            preparing: AtomicBool::new(false),
            joined: AtomicBool::new(false),
        });
        let mut originals = self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        originals.push(Arc::clone(&original));
        if self.closed.load(Ordering::Acquire) {
            original.deny();
        }
        RegisteredManagedCreate {
            root: Arc::downgrade(self),
            original,
        }
    }
    /// Fence BEFORE HTTP drain, cancellation, publication or persistence drain.
    pub fn close(&self) {
        self.closed.store(true, Ordering::Release);
        for original in self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
        {
            original.deny();
        }
    }
    /// Borrow all original workers/contexts. Timeout/cancellation retains the
    /// same registry, handles, source reservations, files and pending build.
    /// This is only Core's half: Native must join its partial-construction owner.
    pub async fn close_and_reap(&self, original_cutoff: std::time::Instant) -> Result<()> {
        self.close();
        let originals = self
            .originals
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        let mut first = None;
        for original in originals {
            if let Err(error) = original.reap(original_cutoff).await {
                if first.is_none() {
                    first = Some(error);
                }
            }
        }
        match first {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}
impl Drop for ManagedCreateRegistry {
    fn drop(&mut self) {
        self.close();
    }
}

impl RegisteredManagedCreate {
    fn check_registration(&self) -> Result<()> {
        let root = self
            .root
            .upgrade()
            .ok_or_else(|| anyhow!("original CREATE serving root ended"))?;
        ensure!(
            !root.closed.load(Ordering::Acquire)
                && root
                    .originals
                    .lock()
                    .map_err(|_| anyhow!("original CREATE registry poisoned"))?
                    .iter()
                    .any(|entry| Arc::ptr_eq(entry, &self.original)),
            "original CREATE registration denied"
        );
        Ok(())
    }
    /// The original JoinHandle is stored before the first await. Dropping the
    /// observer cannot detach source work from its registered cleanup owner.
    pub async fn verify_factory(&self) -> Result<Arc<CreateFactoryOwner>> {
        self.check_registration()?;
        let mut worker = self.original.worker.lock().await;
        ensure!(worker.is_none(), "original CREATE worker still owned");
        let original = Arc::clone(&self.original);
        *worker = Some(tokio::task::spawn_blocking(move || {
            let factory = original.participant.try_factory()?;
            original
                .factory
                .set(factory)
                .map_err(|_| anyhow!("original CREATE factory already stored"))
        }));
        let result = worker
            .as_mut()
            .ok_or_else(|| anyhow!("original CREATE worker absent"))?
            .await;
        worker.take(); // Exact original task is terminal; errors retain its input owners.
        result.map_err(|_| anyhow!("original CREATE verifier worker failed"))??;
        self.check_registration()?;
        self.original
            .factory
            .get()
            .map(Arc::clone)
            .ok_or_else(|| anyhow!("original CREATE factory absent"))
    }
    /// Retain opaque Native output before any check. Even an unexpected second
    /// output is retained/denied, never discarded as an error-string-only result.
    pub fn retain_native(&self, custody: CreatePublicationCustody) -> Result<()> {
        let context = Arc::clone(custody.context());
        self.original
            .contexts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push(context);
        let mut native = self
            .original
            .native
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        native.push(custody);
        let checked = (|| {
            self.check_registration()?;
            let factory = self
                .original
                .factory
                .get()
                .ok_or_else(|| anyhow!("original CREATE factory absent"))?;
            ensure!(
                native.len() == 1 && native[0].belongs_to(factory),
                "original Native CREATE custody differs"
            );
            Ok(())
        })();
        drop(native);
        if checked.is_err() {
            self.original.deny();
        }
        checked
    }
    pub async fn prepare(&self) -> Result<()> {
        self.check_registration()?;
        ensure!(
            !self.original.preparing.swap(true, Ordering::AcqRel),
            "CREATE preparation already attempted"
        );
        let mut worker = self.original.worker.lock().await;
        ensure!(worker.is_none(), "original CREATE worker still owned");
        let original = Arc::clone(&self.original);
        *worker = Some(tokio::task::spawn_blocking(move || {
            let context = {
                let native = original
                    .native
                    .lock()
                    .map_err(|_| anyhow!("original Native custody poisoned"))?;
                ensure!(native.len() == 1, "original Native custody absent");
                original.participant.check_custody(&native[0])?;
                Arc::clone(native[0].context())
            };
            let reads =
                GuidanceReadOwner::retain(Arc::clone(&original.participant), Arc::clone(&context));
            original
                .reads
                .set(Arc::clone(&reads))
                .map_err(|_| anyhow!("original guidance already retained"))?;
            let factory = original
                .factory
                .get()
                .ok_or_else(|| anyhow!("original CREATE factory absent"))?;
            let guidance = ProtectedCreateGuidance::prepare(
                reads,
                context,
                factory.binding().session_id.to_owned(),
            )?;
            let custody = original
                .native
                .lock()
                .map_err(|_| anyhow!("original Native custody poisoned"))?
                .pop()
                .ok_or_else(|| anyhow!("original Native custody absent"))?;
            let build = Arc::new(tokio::sync::Mutex::new(ProtectedCreateBuild::retain(
                Arc::clone(&original.participant),
                custody,
                guidance,
            )));
            original
                .build
                .set(Arc::clone(&build))
                .map_err(|_| anyhow!("original CREATE build already retained"))?;
            tokio::runtime::Handle::current().block_on(async { build.lock().await.try_assemble() })
        }));
        let result = worker
            .as_mut()
            .ok_or_else(|| anyhow!("original CREATE worker absent"))?
            .await;
        worker.take();
        let result = result.map_err(|_| anyhow!("original CREATE preparation worker failed"))?;
        if result.is_err() {
            self.original.deny();
        }
        result?;
        self.check_registration()
    }
    /// Return only this registration's actual verified factory allocation.
    /// The Arc cannot create admission; private participant ownership stays bound.
    pub fn original_factory(&self) -> Result<Arc<CreateFactoryOwner>> {
        self.check_registration()?;
        self.original
            .factory
            .get()
            .map(Arc::clone)
            .ok_or_else(|| anyhow!("original CREATE factory absent"))
    }
    pub async fn issue(&self) -> Result<crate::session_service::AdmittedSessionPublication> {
        self.check_registration()?;
        let build = self
            .original
            .build
            .get()
            .ok_or_else(|| anyhow!("original protected build absent"))?;
        build.lock().await.try_issue().await
    }
    pub fn deny(&self) {
        self.original.deny();
    }
}
impl Attempt {
    fn deny(&self) {
        self.participant.deny_runtime();
        for context in self
            .contexts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .iter()
        {
            if let Ok(cancellation) = context.cancellation() {
                cancellation.cancel();
            }
        }
    }
    async fn reap(&self, cutoff: std::time::Instant) -> Result<()> {
        self.deny();
        let mut first = None;
        // Verification/preparation observers borrow the same task handle. Their
        // lock is itself bounded by the ORIGINAL drain cutoff, never a fresh one.
        match tokio::time::timeout_at(cutoff.into(), self.worker.lock()).await {
            Err(_) => first = Some(anyhow!("original CREATE worker lock drain cutoff")),
            Ok(mut worker) => {
                if let Some(task) = worker.as_mut() {
                    match tokio::time::timeout_at(cutoff.into(), task).await {
                        Err(_) => first = Some(anyhow!("original CREATE worker drain cutoff")),
                        Ok(result) => {
                            worker.take(); // Only the terminal original handle is removed.
                            match result {
                                Ok(preparation) => {
                                    // Preserve the actual preparation outcome. A failed
                                    // body is separate from physical cleanup, and may
                                    // not short-circuit any context's cleanup attempt.
                                    *self
                                        .drained_worker_result
                                        .lock()
                                        .unwrap_or_else(std::sync::PoisonError::into_inner) =
                                        Some(preparation);
                                }
                                Err(_) => first = Some(anyhow!("original CREATE worker panicked")),
                            }
                        }
                    }
                }
            }
        }
        let contexts = self
            .contexts
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clone();
        for context in contexts {
            if let Err(error) = context.close_and_reap(cutoff).await {
                if first.is_none() {
                    first = Some(error);
                }
            }
        }
        if let Some(error) = first {
            return Err(error);
        }
        self.joined.store(true, Ordering::Release);
        // No source slot, durable terminal or upstream primary claim is released.
        Ok(())
    }
}
