//! Startup-driven, bounded Local heartbeat admission; no client subscription.
use anyhow::Result;
use nac_core::{
    session_service::SessionService,
    sessions,
    store::{self, HeartbeatOccurrence},
};
use std::{
    sync::{Arc, Mutex, MutexGuard, Weak},
    time::Duration,
};
use tokio::{sync::oneshot, task::JoinHandle};

use super::heartbeats::{epoch_ms, HeartbeatApplication};
use crate::SessionManager;

#[derive(Default)]
struct SchedulerLifetime {
    state: Mutex<LifetimeState>,
}
#[derive(Default)]
struct LifetimeState {
    closed: bool,
    submitting: Option<Weak<SessionService>>,
}
impl SchedulerLifetime {
    fn state(&self) -> MutexGuard<'_, LifetimeState> {
        self.state.lock().unwrap_or_else(|error| {
            let mut state = error.into_inner();
            state.closed = true;
            state
        })
    }

    fn close(&self) {
        self.state().closed = true;
    }

    fn is_closed(&self, manager: &SessionManager) -> bool {
        self.state().closed || manager.inner.task_preparations.is_stopping()
    }

    /// Linearize a phase with stop. Synchronous caller admission happens under
    /// this short gate; its accepted operation is always awaited outside it.
    fn begin<T>(&self, manager: &SessionManager, start: impl FnOnce() -> T) -> Option<T> {
        let state = self.state();
        if state.closed || manager.inner.task_preparations.is_stopping() {
            return None;
        }
        Some(start())
    }

    fn begin_submission(&self, manager: &SessionManager, service: &Arc<SessionService>) -> bool {
        let mut state = self.state();
        if state.closed || manager.inner.task_preparations.is_stopping() {
            return false;
        }
        state.submitting = Some(Arc::downgrade(service));
        true
    }

    fn submitting(&self) -> Option<Arc<SessionService>> {
        self.state().submitting.as_ref().and_then(Weak::upgrade)
    }

    fn finish_submission(&self) {
        self.state().submitting = None;
    }
}

pub(crate) struct HeartbeatScheduler {
    stop: Option<oneshot::Sender<()>>,
    lifetime: Arc<SchedulerLifetime>,
    task: JoinHandle<()>,
}
impl HeartbeatScheduler {
    pub(crate) fn start(manager: &SessionManager) -> Self {
        let lifetime = Arc::new(SchedulerLifetime::default());
        let running = Arc::clone(&lifetime);
        let manager = Arc::downgrade(&manager.inner);
        let (stop, mut stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    biased;
                    _=&mut stopped=>return,
                    _=interval.tick()=>{},
                }
                let Some(inner) = manager.upgrade() else {
                    return;
                };
                let manager = SessionManager { inner };
                if running.is_closed(&manager) {
                    return;
                }
                if manager.managed_host().is_some() || manager.is_recovery_only() {
                    continue;
                }
                let scan = tick(&manager, &running);
                tokio::pin!(scan);
                let result = tokio::select! {
                    biased;
                    _=&mut stopped=>{
                        running.close();
                        // A submission that already entered core may settle,
                        // but its public admission fence must close before we
                        // wait. Later phases cannot register a new service.
                        if let Some(service) = running.submitting() {
                            let result = service.stop_run_admission().await;
                            #[cfg(test)]
                            tests::observe_submission_stop(&manager.inner.store_path, &service, &result);
                            if let Err(error) = result {
                                eprintln!("nac: heartbeat admission shutdown failed: {error:#}");
                            }
                        }
                        // Retain this future and its manager/store owner. Dropping
                        // it would detach an already-admitted blocking caller.
                        // Every subsequent phase observes the closed lifetime.
                        scan.as_mut().await
                    },
                    result=&mut scan=>result,
                };
                if let Err(error) = result {
                    eprintln!("nac: heartbeat scan deferred: {error:#}");
                }
                if running.is_closed(&manager) {
                    return;
                }
            }
        });
        Self {
            stop: Some(stop),
            lifetime,
            task,
        }
    }
    pub(crate) async fn stop(mut self) {
        self.lifetime.close();
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Err(error) = (&mut self.task).await {
            eprintln!("nac: heartbeat scheduler shutdown task failed: {error}");
        }
    }
}
impl Drop for HeartbeatScheduler {
    fn drop(&mut self) {
        self.lifetime.close();
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

async fn tick(manager: &SessionManager, lifetime: &SchedulerLifetime) -> Result<()> {
    let path = manager.inner.store_path.clone();
    let Some(active) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || {
            #[cfg(test)]
            let _completion = tests::hold_store_call(&path);
            store::active_heartbeat_occurrences(&path)
        })
    }) else {
        return Ok(());
    };
    let active = active.await??;
    let mut remaining =
        nac_core::store::MAX_HEARTBEAT_CONCURRENCY.saturating_sub(active.len() as i64);
    for active in active {
        if lifetime.is_closed(manager) {
            return Ok(());
        }
        reconcile_or_stop(manager, &active, lifetime).await?;
    }
    let path = manager.inner.store_path.clone();
    let Some(pending) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || store::materialize_heartbeats(&path, epoch_ms()))
    }) else {
        return Ok(());
    };
    let pending = pending.await??;
    for occurrence in pending {
        if remaining == 0 {
            break;
        }
        if lifetime.is_closed(manager) {
            return Ok(());
        }
        let admission = admit(manager, occurrence.clone(), lifetime).await;
        if matches!(admission, Ok(true)) {
            remaining -= 1;
        }
        if let Err(error) = admission {
            if lifetime.is_closed(manager) {
                return Err(error);
            }
            // Ordinary busy/lease contention is deferred before reaching here.
            // Genuine pre-admission failures consume the same bounded receipt.
            let path = manager.inner.store_path.clone();
            let Some(record) = lifetime.begin(manager, || {
                store::spawn_blocking_store_caller(move || {
                    store::heartbeat_admission_unavailable(
                        &path,
                        &occurrence.session_id,
                        &occurrence.occurrence_id,
                        occurrence.revision,
                        false,
                        "Heartbeat runtime admission failed; retry allowance is bounded.",
                        epoch_ms(),
                    )
                })
            }) else {
                return Err(error);
            };
            record.await??;
            eprintln!("nac: heartbeat admission deferred: {error:#}");
        }
    }
    Ok(())
}

async fn lease(
    manager: &SessionManager,
    id: &str,
    lifetime: &SchedulerLifetime,
) -> Result<Option<sessions::SessionOperationLease>> {
    let path = manager.inner.store_path.clone();
    let id = id.to_owned();
    let Some(lease) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || {
            match sessions::SessionOperationLease::try_acquire(&path, &id) {
                Ok(lease) => Ok(Some(lease)),
                Err(sessions::SessionOperationLeaseError::Busy(_)) => Ok(None),
                Err(sessions::SessionOperationLeaseError::Store(error)) => Err(error),
            }
        })
    }) else {
        return Ok(None);
    };
    lease.await?
}
async fn admit(
    manager: &SessionManager,
    occurrence: HeartbeatOccurrence,
    lifetime: &SchedulerLifetime,
) -> Result<bool> {
    if lifetime.is_closed(manager) {
        return Ok(false);
    }
    let gate = manager.lifecycle_gate(&occurrence.session_id);
    let Ok(_lifecycle) = gate.try_lock() else {
        return Ok(false);
    };
    if manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&occurrence.session_id)
        .is_some_and(|service| service.has_active_operation())
    {
        return Ok(false);
    }
    let Some(lease) = lease(manager, &occurrence.session_id, lifetime).await? else {
        return Ok(false);
    };
    let application = HeartbeatApplication::new(manager);
    let Some(attachment) = lifetime.begin(manager, || {
        application.scheduler_service(&occurrence.session_id, &lease)
    }) else {
        return Ok(false);
    };
    let service = attachment.await?;
    if !lifetime.begin_submission(manager, &service) {
        service.stop_run_admission().await?;
        return Ok(false);
    }
    #[cfg(test)]
    tests::hold_submission(&manager.inner.store_path, &service).await;
    let result = service.start_heartbeat_occurrence(occurrence, lease).await;
    lifetime.finish_submission();
    Ok(result?.is_some())
}
async fn reconcile_or_stop(
    manager: &SessionManager,
    occurrence: &HeartbeatOccurrence,
    lifetime: &SchedulerLifetime,
) -> Result<()> {
    let cached = manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&occurrence.session_id)
        .cloned();
    if lifetime.is_closed(manager) {
        return Ok(());
    }
    if let Some(service) = cached {
        if service.has_active_operation() {
            let path = manager.inner.store_path.clone();
            let session = occurrence.session_id.clone();
            let active = occurrence.clone();
            let Some(stopping) = lifetime.begin(manager, || {
                store::spawn_blocking_store_caller(move || {
                    match (active.run_id.as_deref(), active.generation.as_deref()) {
                        (Some(run), Some(generation)) => store::heartbeat_stop_requested(
                            &path,
                            &session,
                            &active.occurrence_id,
                            run,
                            generation,
                        ),
                        _ => Ok(false),
                    }
                })
            }) else {
                return Ok(());
            };
            let stopping = stopping.await??;
            if lifetime.is_closed(manager) {
                return Ok(());
            }
            if stopping {
                if let Some(run) = &occurrence.run_id {
                    // The exact saved run identity makes delayed cancellation
                    // inert when a later human run owns this chat.
                    let run: nac_core::events::SessionRunId =
                        serde_json::from_value(serde_json::Value::String(run.clone()))?;
                    let _ = service.request_cancel(&run).await;
                }
            }
            return Ok(());
        }
    }
    let gate = manager.lifecycle_gate(&occurrence.session_id);
    let Ok(_lifecycle) = gate.try_lock() else {
        return Ok(());
    };
    let Some(_lease) = lease(manager, &occurrence.session_id, lifetime).await? else {
        return Ok(());
    };
    let path = manager.inner.store_path.clone();
    let id = occurrence.session_id.clone();
    let Some(reconcile) = lifetime.begin(manager, || {
        store::spawn_blocking_store_caller(move || {
            store::reconcile_heartbeat_occurrences(&path, &id, epoch_ms())
        })
    }) else {
        return Ok(());
    };
    reconcile.await??;
    Ok(())
}

#[cfg(test)]
mod tests;
