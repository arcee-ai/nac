//! Human ownership, passive inventory and exact scheduler attachment.
use anyhow::{ensure, Context, Result};
use nac_core::{
    session_service::SessionService,
    sessions,
    store::{self, HeartbeatAction, HeartbeatOccurrence, HeartbeatReceipt, HeartbeatSchedule},
};
use std::sync::Arc;

use super::session_attachment::SessionAttachmentApplication;
use crate::SessionManager;

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub(crate) struct HeartbeatInspection {
    pub schedule: HeartbeatSchedule,
    pub history: Vec<HeartbeatOccurrence>,
}

pub(crate) struct HeartbeatApplication<'a> {
    manager: &'a SessionManager,
}
impl<'a> HeartbeatApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    pub(crate) async fn inventory(
        &self,
        session_id: Option<String>,
    ) -> Result<Vec<HeartbeatSchedule>> {
        let path = self.manager.inner.store_path.clone();
        // Authenticated serving-store ownership is the human inventory scope.
        // This read never attaches a service, recovers a run or wakes goals.
        store::spawn_blocking_store_caller(move || {
            store::list_heartbeats(&path, session_id.as_deref())
        })
        .await?
    }
    pub(crate) async fn inspect(
        &self,
        session_id: String,
        schedule_id: String,
    ) -> Result<HeartbeatInspection> {
        let path = self.manager.inner.store_path.clone();
        store::spawn_blocking_store_caller(move || {
            Ok(HeartbeatInspection {
                schedule: store::read_heartbeat(&path, &session_id, &schedule_id)?,
                history: store::heartbeat_history(&path, &session_id, &schedule_id)?,
            })
        })
        .await?
    }
    pub(crate) async fn acknowledge(&self, session_id: &str, through_sequence: i64) -> Result<()> {
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Primary,
            )
            .await?;
        let path = self.manager.inner.store_path.clone();
        let session = session_id.to_owned();
        store::spawn_blocking_store_caller(move || {
            store::acknowledge_heartbeat_attention(&path, &session, through_sequence)
        })
        .await?
    }
    pub(crate) async fn control(
        &self,
        session_id: &str,
        request_id: String,
        operation: HeartbeatAction,
    ) -> Result<HeartbeatReceipt> {
        ensure!(
            self.manager.managed_host().is_none(),
            "managed heartbeat execution is not qualified"
        );
        ensure!(
            !self.manager.inner.task_preparations.is_stopping(),
            "heartbeat control is stopping"
        );
        self.manager
            .validate_operation_session(
                session_id,
                super::persistence::OperationSessionScope::Direct,
            )
            .await?;
        let service = self.human_service(session_id).await?;
        let stopping = matches!(operation, HeartbeatAction::Stop { .. });
        let receipt = service
            .control_human_heartbeat(request_id, operation)
            .await?;
        if stopping {
            if let Some(run) = receipt
                .active_occurrence
                .as_ref()
                .and_then(|active| active.run_id.clone())
            {
                let service = Arc::clone(&service);
                let run: nac_core::events::SessionRunId =
                    serde_json::from_value(serde_json::Value::String(run))?;
                tokio::spawn(async move {
                    if let Err(error) = service.request_cancel(&run).await {
                        eprintln!("nac: heartbeat stop cleanup remains inspectable: {error}");
                    }
                });
            }
        }
        Ok(receipt)
    }

    async fn human_service(&self, id: &str) -> Result<Arc<SessionService>> {
        let gate = self.manager.lifecycle_gate(id);
        let _lifecycle = gate.lock().await;
        let cached = self
            .manager
            .inner
            .active_sessions
            .read()
            .await
            .get(id)
            .cloned();
        if let Some(service) = cached {
            let current = self
                .manager
                .session_state()
                .config_async(id)
                .await?
                .config_version;
            if service.config_version() == Some(current) {
                return Ok(service);
            }
            ensure!(!service.has_active_operation(),"session configuration changed during active execution; heartbeat control needs a current owner");
            self.manager.inner.active_sessions.write().await.remove(id);
        }
        let (service, cacheable, lease) = SessionAttachmentApplication::new(self.manager)
            .resume_session_attachment(id)
            .await?;
        drop(lease);
        let service = Arc::new(service);
        if cacheable {
            self.manager
                .inner
                .active_sessions
                .write()
                .await
                .insert(id.to_owned(), Arc::clone(&service));
        }
        Ok(service)
    }

    /// Caller holds the lifecycle gate and exact operation lease. This
    /// attachment path deliberately omits ordinary inbox/goal wake.
    pub(super) async fn scheduler_service(
        &self,
        id: &str,
        lease: &sessions::SessionOperationLease,
    ) -> Result<Arc<SessionService>> {
        SessionAttachmentApplication::new(self.manager)
            .attach_current_operation_service_locked(id, lease)
            .await
            .context("heartbeat runtime is unavailable")
    }
}

pub(super) fn epoch_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}
