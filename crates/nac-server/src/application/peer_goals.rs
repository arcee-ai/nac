//! Composition of native goal authority with the existing target lifecycle.
use crate::{SessionManager, SessionManagerInner};
use anyhow::{anyhow, Result};
use nac_core::peer_goal_control::PeerGoalError;
use nac_core::peer_goal_control::{
    AuthorizedPeerGoal, PeerGoalController, PeerGoalFuture, PeerGoalOutcome,
};
use nac_core::{sessions, store};
use std::sync::Weak;

pub(crate) struct ServerPeerGoalController {
    pub(crate) manager: Weak<SessionManagerInner>,
}
impl PeerGoalController for ServerPeerGoalController {
    fn control<'a>(&'a self, request: AuthorizedPeerGoal) -> PeerGoalFuture<'a, PeerGoalOutcome> {
        Box::pin(async move {
            let manager = SessionManager {
                inner: self.manager.upgrade().ok_or_else(|| {
                    anyhow!(PeerGoalError::Unavailable("session manager stopped"))
                })?,
            };
            anyhow::ensure!(
                manager.managed_host().is_none(),
                PeerGoalError::Unavailable("peer goals require an unmanaged Local host")
            );
            // Keep the serving lifetime and target configuration/deletion fence
            // throughout attachment, commit and any existing goal wake.
            let admission = manager.inner.task_preparations.admit().await?;
            // Once admitted, caller cancellation can lose the reply but cannot
            // strand a committed active goal before the existing owner wake.
            tokio::spawn(async move {
                let _admission = admission;
                let target = request.target().to_owned();
                let gate = manager.lifecycle_gate(&target);
                let _lifecycle = gate.lock().await;
                if let Some(receipt) = request.replay_start(&manager.inner.store_path).await? {
                    return Ok(PeerGoalOutcome::Replayed { receipt });
                }
                let path = manager.inner.store_path.clone();
                let id = target.clone();
                store::spawn_blocking_store_caller(move || -> Result<()> {
                    let snapshot =
                        sessions::load_session_summary(&path, &id)?.ok_or_else(|| {
                            anyhow!(PeerGoalError::Unavailable("target does not exist"))
                        })?;
                    anyhow::ensure!(
                        snapshot.behavior == sessions::SessionBehavior::Direct
                            && !snapshot.sandboxed
                            && snapshot.ssh.is_none(),
                        PeerGoalError::Unavailable("target requires plain direct Local behavior")
                    );
                    anyhow::ensure!(
                        matches!(
                            store::load_direct_task(&path, &id)?,
                            store::TaskLookup::Found(_)
                        ),
                        PeerGoalError::Unavailable("target is not independent")
                    );
                    Ok(())
                })
                .await??;
                let cached = manager
                    .inner
                    .active_sessions
                    .read()
                    .await
                    .get(&target)
                    .cloned();
                let (service, lease) = if let Some(service) = cached {
                    (service, None)
                } else {
                    let path = manager.inner.store_path.clone();
                    let id = target.clone();
                    let lease = store::spawn_blocking_store_caller(move || {
                        sessions::SessionOperationLease::try_acquire(&path, &id)
                    })
                    .await??;
                    // This attachment path does not wake pending goals/inbox before
                    // the exact mutation has committed. A foreign lease fails above.
                    let service = manager
                        .session_attachment()
                        .attach_session_locked(&target, Some(&lease))
                        .await?;
                    (service, Some(lease))
                };
                service.control_peer_goal(request, lease).await
            })
            .await?
        })
    }
}
