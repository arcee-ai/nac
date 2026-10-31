//! Startup-driven, bounded Local heartbeat admission; no client subscription.
use anyhow::Result;
use nac_core::{
    sessions,
    store::{self, HeartbeatOccurrence, HeartbeatState},
};
use std::{sync::Arc, time::Duration};
use tokio::{sync::oneshot, task::JoinHandle};

use super::heartbeats::{epoch_ms, HeartbeatApplication};
use crate::SessionManager;

pub(crate) struct HeartbeatScheduler {
    stop: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
}
impl HeartbeatScheduler {
    pub(crate) fn start(manager: &SessionManager) -> Self {
        let manager = Arc::downgrade(&manager.inner);
        let (stop, mut stopped) = oneshot::channel();
        let task = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _=&mut stopped=>return,
                    _=interval.tick()=>{},
                }
                let Some(inner) = manager.upgrade() else {
                    return;
                };
                let manager = SessionManager { inner };
                if manager.inner.task_preparations.is_stopping() {
                    return;
                }
                if manager.managed_host().is_some() || manager.is_recovery_only() {
                    continue;
                }
                tokio::select! {
                    _=&mut stopped=>return,
                    result=tick(&manager)=>{if let Err(error)=result {eprintln!("nac: heartbeat scan deferred: {error:#}");}},
                }
            }
        });
        Self {
            stop: Some(stop),
            task,
        }
    }
    pub(crate) async fn stop(mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        let _ = (&mut self.task).await;
    }
}
impl Drop for HeartbeatScheduler {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

async fn tick(manager: &SessionManager) -> Result<()> {
    let path = manager.inner.store_path.clone();
    let active =
        store::spawn_blocking_store_caller(move || store::active_heartbeat_occurrences(&path))
            .await??;
    let mut remaining =
        nac_core::store::MAX_HEARTBEAT_CONCURRENCY.saturating_sub(active.len() as i64);
    for active in active {
        reconcile_or_stop(manager, &active).await?;
    }
    let path = manager.inner.store_path.clone();
    let pending = store::spawn_blocking_store_caller(move || {
        store::materialize_heartbeats(&path, epoch_ms())
    })
    .await??;
    for occurrence in pending {
        if remaining == 0 {
            break;
        }
        if manager.inner.task_preparations.is_stopping() {
            return Ok(());
        }
        let admission = admit(manager, occurrence.clone()).await;
        if matches!(admission, Ok(true)) {
            remaining -= 1;
        }
        if let Err(error) = admission {
            // Ordinary busy/lease contention is deferred before reaching here.
            // Genuine pre-admission failures consume the same bounded receipt.
            let path = manager.inner.store_path.clone();
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
            .await??;
            eprintln!("nac: heartbeat admission deferred: {error:#}");
        }
    }
    Ok(())
}

async fn lease(
    manager: &SessionManager,
    id: &str,
) -> Result<Option<sessions::SessionOperationLease>> {
    let path = manager.inner.store_path.clone();
    let id = id.to_owned();
    store::spawn_blocking_store_caller(move || {
        match sessions::SessionOperationLease::try_acquire(&path, &id) {
            Ok(lease) => Ok(Some(lease)),
            Err(sessions::SessionOperationLeaseError::Busy(_)) => Ok(None),
            Err(sessions::SessionOperationLeaseError::Store(error)) => Err(error),
        }
    })
    .await?
}
async fn admit(manager: &SessionManager, occurrence: HeartbeatOccurrence) -> Result<bool> {
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
    let Some(lease) = lease(manager, &occurrence.session_id).await? else {
        return Ok(false);
    };
    let service = HeartbeatApplication::new(manager)
        .scheduler_service(&occurrence.session_id, &lease)
        .await?;
    if manager.inner.task_preparations.is_stopping() {
        service.stop_run_admission().await?;
        return Ok(false);
    }
    Ok(service
        .start_heartbeat_occurrence(occurrence, lease)
        .await?
        .is_some())
}
async fn reconcile_or_stop(
    manager: &SessionManager,
    occurrence: &HeartbeatOccurrence,
) -> Result<()> {
    let cached = manager
        .inner
        .active_sessions
        .read()
        .await
        .get(&occurrence.session_id)
        .cloned();
    if let Some(service) = cached {
        if service.has_active_operation() {
            let path = manager.inner.store_path.clone();
            let session = occurrence.session_id.clone();
            let schedule = occurrence.schedule_id.clone();
            let schedule = store::spawn_blocking_store_caller(move || {
                store::read_heartbeat(&path, &session, &schedule)
            })
            .await??;
            if schedule.state == HeartbeatState::Stopped {
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
    let Some(_lease) = lease(manager, &occurrence.session_id).await? else {
        return Ok(());
    };
    let path = manager.inner.store_path.clone();
    let id = occurrence.session_id.clone();
    store::spawn_blocking_store_caller(move || {
        store::reconcile_heartbeat_occurrences(&path, &id, epoch_ms())
    })
    .await??;
    Ok(())
}

#[cfg(test)]
mod tests;
