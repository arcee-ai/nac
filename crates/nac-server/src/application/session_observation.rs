//! Passive access to an existing cached service. Observation never constructs a
//! backend, attaches/resumes a session, wakes an inbox or reconciles recovery.
use std::sync::Arc;

use anyhow::{ensure, Context, Result};
use nac_core::{
    events::{SessionEventBoundary, SessionEventEnvelope},
    session_service::{FrontendSnapshotLoadOptions, SessionFrontendSnapshotLoad, SessionService},
};

use crate::SessionManager;

pub(crate) struct SessionObservation {
    manager: SessionManager,
    session_id: String,
    service: Arc<SessionService>,
}

impl SessionObservation {
    pub(crate) async fn resolve(manager: SessionManager, session_id: &str) -> Result<Self> {
        let service = manager
            .inner
            .active_sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .context("passive session owner unavailable")?;
        let observation = Self {
            manager,
            session_id: session_id.to_owned(),
            service,
        };
        observation.require_current().await?;
        Ok(observation)
    }

    pub(crate) async fn require_current(&self) -> Result<()> {
        let config = self
            .manager
            .session_state()
            .config_async(&self.session_id)
            .await?;
        ensure!(self.service.config_version() == Some(config.config_version));
        let active = self.manager.inner.active_sessions.read().await;
        ensure!(active
            .get(&self.session_id)
            .is_some_and(|current| Arc::ptr_eq(current, &self.service)));
        Ok(())
    }

    pub(crate) async fn snapshot(
        &self,
        options: FrontendSnapshotLoadOptions,
    ) -> Result<SessionFrontendSnapshotLoad> {
        self.require_current().await?;
        let snapshot = self
            .service
            .observe_frontend_snapshot_with_options(options)
            .await?;
        self.require_current().await?;
        Ok(snapshot)
    }

    pub(crate) async fn events(
        &self,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<(SessionEventBoundary, Vec<SessionEventEnvelope>)> {
        self.require_current().await?;
        Ok(self.service.recent_events(cursor, limit))
    }

    pub(crate) async fn subscribe(
        &self,
        cursor: Option<&SessionEventBoundary>,
        limit: usize,
    ) -> Result<super::session_runs::EventSubscription> {
        self.require_current().await?;
        // This handle only registers passive event receivers, never attach().
        let subscription = self
            .service
            .connect_client()
            .subscribe_events_with_replay(cursor, limit);
        Ok((
            subscription.epoch_id,
            subscription.replay_boundary_sequence_id,
            subscription.replay_gap,
            subscription.replayed_events,
            subscription.receiver,
            subscription.assistant_deltas,
        ))
    }
}
