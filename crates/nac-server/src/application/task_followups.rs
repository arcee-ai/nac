//! Server composition of native agent admission; no human-intent bypass.
use crate::{SessionManager, SessionManagerInner};
use anyhow::anyhow;
use nac_core::{
    store,
    task_followups::{TaskFollowupController, TaskFollowupFuture},
};
use std::sync::Weak;
use store::{TaskFollowupError, TaskFollowupRequest};

pub(crate) struct ServerTaskFollowupController {
    pub(crate) manager: Weak<SessionManagerInner>,
    #[cfg(test)]
    pub(crate) after_admission: Option<std::sync::Arc<AdmissionGate>>,
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct AdmissionGate {
    pub(crate) reached: tokio::sync::Notify,
    pub(crate) release: tokio::sync::Notify,
}

impl TaskFollowupController for ServerTaskFollowupController {
    fn follow_up<'a>(&'a self, request: TaskFollowupRequest) -> TaskFollowupFuture<'a> {
        Box::pin(async move {
            let manager = SessionManager {
                inner: self
                    .manager
                    .upgrade()
                    .ok_or_else(|| anyhow!("task follow-up owner is unavailable"))?,
            };
            // Receipt-first replay stays passive, including during shutdown.
            let path = manager.inner.store_path.clone();
            let lookup = request.clone();
            if let Some(receipt) = store::spawn_blocking_store_caller(move || {
                store::load_task_followup_receipt(&path, &lookup)
            })
            .await??
            {
                return Ok(receipt);
            }

            let guard = manager
                .inner
                .task_preparations
                .admit()
                .await
                .map_err(|_| TaskFollowupError::Stopping)?;
            #[cfg(test)]
            let after_admission = self.after_admission.clone();
            // The owned obligation survives caller cancellation through admission
            // and wake. Shutdown settles it using the existing preparation fence.
            tokio::spawn(async move {
                let _guard = guard;
                let gate = manager.lifecycle_gate(&request.target_session_id);
                let lifecycle = gate.lock().await;
                if manager.inner.task_preparations.is_stopping() {
                    return Err(TaskFollowupError::Stopping.into());
                }
                let cached = manager.inner.active_sessions.read().await
                    .get(&request.target_session_id).cloned();
                if let Some(service) = cached {
                    return service.admit_task_followup(request).await;
                }
                // Commit before attachment: invalid/stale/new requests cannot
                // recover, consume input or wake the target as a side effect.
                let path = manager.inner.store_path.clone();
                let admission = request.clone();
                let receipt = store::spawn_blocking_store_caller(move || {
                    store::admit_task_followup(&path, &admission)
                }).await??;
                #[cfg(test)]
                if let Some(gate) = after_admission {
                    gate.reached.notify_one();
                    gate.release.notified().await;
                }
                drop(lifecycle);
                if !receipt.replayed {
                    if let Err(error) = manager.attach_session(&request.target_session_id).await {
                        eprintln!("nac: admitted task follow-up remains pending after attachment: {error:#}");
                    }
                }
                let path = manager.inner.store_path.clone();
                let lookup = request;
                let replayed = receipt.replayed;
                match store::spawn_blocking_store_caller(move || {
                    store::load_task_followup_receipt(&path, &lookup)
                }).await {
                    Ok(Ok(Some(mut current))) => { current.replayed = replayed; Ok(current) }
                    _ => {
                        let mut receipt = receipt;
                        receipt.disposition = None;
                        receipt.delivered_run_id = None;
                        Ok(receipt)
                    },
                }
            }).await.map_err(|error| anyhow!("task follow-up admission outcome unknown: {error}"))?
        })
    }
}
