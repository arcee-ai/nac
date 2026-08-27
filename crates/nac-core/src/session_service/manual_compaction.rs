use tokio::sync::oneshot;
use uuid::Uuid;

use super::*;
use crate::agent::{CompactionCompletion, CompactionError, CompactionLifecycle, CompactionResult};

pub type SessionCompactionResult = CompactionResult;
pub type SessionCompactionError = CompactionError;

pub struct SessionCompactionHandle {
    pub compaction_id: Uuid,
    pub client_id: Option<SessionClientId>,
    completion: oneshot::Receiver<CompactionCompletion>,
    #[cfg(test)]
    abort_handle: tokio::task::AbortHandle,
}

impl SessionCompactionHandle {
    pub async fn wait(self) -> CompactionCompletion {
        self.completion.await.unwrap_or_else(|_| {
            Err(CompactionError::Failed {
                compaction_id: self.compaction_id,
                failure: CompactionFailure::Cancelled,
                source: None,
            })
        })
    }

    #[cfg(test)]
    pub(crate) fn abort(&self) {
        self.abort_handle.abort();
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionCoordinationError {
    Store { detail: String },
    StaleConfiguration { session_id: String },
    InvalidLease,
    LocalAgentBusy,
}

impl SessionCoordinationError {
    pub(super) fn store(detail: impl Into<String>) -> Self {
        Self::Store {
            detail: detail.into(),
        }
    }

    pub(super) fn stale_configuration(session_id: &str) -> Self {
        Self::StaleConfiguration {
            session_id: session_id.to_string(),
        }
    }

    pub(super) fn invalid_lease() -> Self {
        Self::InvalidLease
    }

    pub(super) fn local_agent_busy() -> Self {
        Self::LocalAgentBusy
    }
}

impl std::fmt::Display for SessionCoordinationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Store { .. } => formatter.write_str("session operation coordination failed"),
            Self::StaleConfiguration { session_id } => write!(
                formatter,
                "session '{session_id}' configuration changed externally; reload it before continuing"
            ),
            Self::InvalidLease => {
                formatter.write_str("supplied operation lease does not belong to this session")
            }
            Self::LocalAgentBusy => formatter.write_str("session is busy with a local operation"),
        }
    }
}

impl std::error::Error for SessionCoordinationError {}

impl From<&SessionCoordinationError> for String {
    fn from(error: &SessionCoordinationError) -> Self {
        error.to_string()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionOperationBusy {
    Local {
        session_id: String,
        active_operation: ActiveSessionOperationSnapshot,
    },
    External {
        session_id: String,
    },
}

impl SessionOperationBusy {
    fn session_id(&self) -> &str {
        match self {
            Self::Local { session_id, .. } | Self::External { session_id } => session_id,
        }
    }
}

impl std::fmt::Display for SessionOperationBusy {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.session_id())
    }
}

impl PartialEq<&str> for SessionOperationBusy {
    fn eq(&self, other: &&str) -> bool {
        self.session_id() == *other
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionCompactionAdmissionError {
    Busy {
        active_operation: ActiveSessionOperationSnapshot,
    },
    ExternalBusy {
        session_id: String,
    },
    Coordination {
        message: SessionCoordinationError,
    },
    Unavailable,
}

impl std::fmt::Display for SessionCompactionAdmissionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Busy { .. } => formatter.write_str("session is busy with an active operation"),
            Self::ExternalBusy { session_id } => write!(
                formatter,
                "session '{session_id}' is busy with an active operation in another process"
            ),
            Self::Coordination { message } => message.fmt(formatter),
            Self::Unavailable => formatter.write_str("compaction is unavailable for this session"),
        }
    }
}

impl std::error::Error for SessionCompactionAdmissionError {}

pub(super) struct ActiveCompactionState {
    pub(super) snapshot: ActiveCompactionSnapshot,
    pub(super) _operation_lease: Option<sessions::SessionOperationLease>,
}

type SessionCompactionCompletion = CompactionCompletion;

struct ManualCompactionTaskGuard {
    service: SessionService,
    snapshot: ActiveCompactionSnapshot,
    completion: Option<oneshot::Sender<SessionCompactionCompletion>>,
    lifecycle: Option<CompactionLifecycle>,
}

impl ManualCompactionTaskGuard {
    fn complete(mut self, result: SessionCompactionCompletion) {
        self.lifecycle
            .as_mut()
            .expect("manual compaction lifecycle exists")
            .finish(&result);
        drop(self.lifecycle.take());
        self.service
            .clear_manual_compaction(self.snapshot.compaction_id);
        if let Some(completion) = self.completion.take() {
            let _ = completion.send(result);
        }
    }
}

impl Drop for ManualCompactionTaskGuard {
    fn drop(&mut self) {
        if self.lifecycle.is_none() {
            return;
        }
        let result = Err(CompactionError::Failed {
            compaction_id: self.snapshot.compaction_id,
            failure: CompactionFailure::Cancelled,
            source: None,
        });
        drop(self.lifecycle.take());
        self.service
            .clear_manual_compaction(self.snapshot.compaction_id);
        if let Some(completion) = self.completion.take() {
            let _ = completion.send(result);
        }
    }
}

impl SessionClientHandle {
    #[allow(clippy::result_large_err)]
    pub fn try_compact(
        &self,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        self.service.try_compact_for_client(self.client_id.clone())
    }

    #[allow(clippy::result_large_err)]
    pub fn try_compact_with_lease(
        &self,
        lease: sessions::SessionOperationLease,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        self.service
            .try_compact_for_client_with_lease(self.client_id.clone(), lease)
    }
}

impl SessionService {
    #[allow(clippy::result_large_err)]
    pub fn try_compact(
        &self,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        self.try_compact_inner(None, None)
    }

    #[allow(clippy::result_large_err)]
    pub fn try_compact_for_client(
        &self,
        client_id: SessionClientId,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        self.try_compact_inner(Some(client_id), None)
    }

    #[allow(clippy::result_large_err)]
    pub fn try_compact_with_lease(
        &self,
        lease: sessions::SessionOperationLease,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        self.try_compact_inner(None, Some(lease))
    }

    #[allow(clippy::result_large_err)]
    pub fn try_compact_for_client_with_lease(
        &self,
        client_id: SessionClientId,
        lease: sessions::SessionOperationLease,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        self.try_compact_inner(Some(client_id), Some(lease))
    }

    #[allow(clippy::result_large_err)]
    fn try_compact_inner(
        &self,
        client_id: Option<SessionClientId>,
        supplied_lease: Option<sessions::SessionOperationLease>,
    ) -> std::result::Result<SessionCompactionHandle, SessionCompactionAdmissionError> {
        let Some(_session_id) = self.metadata.session_id.as_deref() else {
            return Err(SessionCompactionAdmissionError::Unavailable);
        };
        let mut operation = self.lock_active_operation();
        if let Some(active_operation) = operation.as_ref() {
            return Err(SessionCompactionAdmissionError::Busy {
                active_operation: active_operation.snapshot(),
            });
        }

        let operation_lease = self
            .prepare_operation_admission(supplied_lease)
            .map_err(|error| match error {
                OperationAdmissionPreparationError::ExternalBusy { session_id } => {
                    SessionCompactionAdmissionError::ExternalBusy { session_id }
                }
                OperationAdmissionPreparationError::Coordination { message } => {
                    SessionCompactionAdmissionError::Coordination { message }
                }
            })?
            .expect("persisted compaction sessions acquire an operation lease");

        let snapshot = ActiveCompactionSnapshot {
            compaction_id: Uuid::new_v4(),
            client_id,
            started_at_epoch_ms: now_epoch_ms(),
        };
        *operation = Some(ActiveSessionOperation::ManualCompaction(
            ActiveCompactionState {
                snapshot: snapshot.clone(),
                _operation_lease: Some(operation_lease),
            },
        ));

        let event_sink =
            EventSink::bus_with_context(self.event_bus.clone(), None, snapshot.client_id.clone());
        let lifecycle = CompactionLifecycle::start(
            event_sink.clone(),
            snapshot.compaction_id,
            CompactionReason::Manual,
        );
        let (completion_tx, completion_rx) = oneshot::channel();
        let task_guard = ManualCompactionTaskGuard {
            service: self.clone(),
            snapshot: snapshot.clone(),
            completion: Some(completion_tx),
            lifecycle: Some(lifecycle),
        };
        let agent = Arc::clone(&self.agent);
        let persist_service = self.clone();
        let compaction_id = snapshot.compaction_id;
        let task = tokio::spawn(async move {
            let result = {
                let mut agent = agent.lock().await;
                agent.compact_for_session(compaction_id, event_sink).await
            };
            if let Ok(CompactionResult::Compacted {
                projected_context, ..
            }) = &result
            {
                if let Err(error) = persist_service
                    .persist_compaction_context(*projected_context)
                    .await
                {
                    eprintln!("nac: failed to persist compaction context: {error:#}");
                }
            }
            task_guard.complete(result);
        });
        #[cfg(test)]
        let abort_handle = task.abort_handle();
        drop(task);
        drop(operation);

        Ok(SessionCompactionHandle {
            compaction_id: snapshot.compaction_id,
            client_id: snapshot.client_id,
            completion: completion_rx,
            #[cfg(test)]
            abort_handle,
        })
    }

    fn clear_manual_compaction(&self, compaction_id: Uuid) {
        let mut operation = self.lock_active_operation();
        if operation.as_ref().is_some_and(|operation| {
            matches!(
                operation,
                ActiveSessionOperation::ManualCompaction(active)
                    if active.snapshot.compaction_id == compaction_id
            )
        }) {
            *operation = None;
        }
    }
}

#[cfg(test)]
mod tests;
