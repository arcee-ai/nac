use axum::{
    extract::{Path as AxumPath, State},
    response::{IntoResponse, Response},
    Json,
};
use nac_core::{
    events::CompactionSkipReason,
    session_service::{
        SessionCompactionAdmissionError, SessionCompactionError, SessionCompactionResult,
        SessionCoordinationError,
    },
    sessions,
};
use serde::Serialize;

use crate::SessionManager;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CompactSessionResponse {
    Compacted {
        compaction_id: String,
    },
    Unchanged {
        compaction_id: String,
        reason: CompactionSkipReason,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompactSessionError {
    NotFound,
    Busy,
    Failed,
}

impl std::fmt::Display for CompactSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self {
            Self::NotFound => "session not found",
            Self::Busy => "session is busy",
            Self::Failed => "compaction failed",
        })
    }
}

impl std::error::Error for CompactSessionError {}

impl IntoResponse for CompactSessionError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Busy => axum::http::StatusCode::CONFLICT,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(serde_json::json!({
                "error": self.to_string(),
            })),
        )
            .into_response()
    }
}

impl SessionManager {
    /// Runs one standalone manual compaction and waits for its durable terminal
    /// result. The lifecycle gate is released before model I/O is awaited.
    pub async fn compact_session(
        &self,
        session_id: &str,
    ) -> Result<CompactSessionResponse, CompactSessionError> {
        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "verify persisted session", &error))?
        {
            return Err(CompactSessionError::NotFound);
        }

        let handle = {
            let gate = self.lifecycle_gate(session_id);
            let _lifecycle = gate.lock().await;
            let operation_lease =
                sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)
                    .map_err(|error| match error {
                        sessions::SessionOperationLeaseError::Busy(_) => CompactSessionError::Busy,
                        sessions::SessionOperationLeaseError::Store(error) => {
                            report_failure(session_id, "acquire operation lease", &error)
                        }
                    })?;

            if !self
                .persisted_operation_session_exists(session_id)
                .map_err(|error| report_failure(session_id, "recheck persisted session", &error))?
            {
                return Err(CompactSessionError::NotFound);
            }

            let service = self
                .attach_current_operation_service_locked(session_id, &operation_lease)
                .await
                .map_err(|error| map_preparation_error(session_id, error))?;
            service
                .connect_client()
                .try_compact_with_lease(operation_lease)
                .map_err(|error| map_admission_error(session_id, error))?
        };

        match handle.wait().await {
            Ok(SessionCompactionResult::Compacted { compaction_id, .. }) => {
                Ok(CompactSessionResponse::Compacted {
                    compaction_id: compaction_id.to_string(),
                })
            }
            Ok(SessionCompactionResult::Unchanged {
                compaction_id,
                reason,
            }) => Ok(CompactSessionResponse::Unchanged {
                compaction_id: compaction_id.to_string(),
                reason,
            }),
            Err(error @ SessionCompactionError::Unavailable)
            | Err(error @ SessionCompactionError::Failed { .. }) => {
                Err(report_failure(session_id, "complete compaction", &error))
            }
        }
    }
}

fn map_preparation_error(session_id: &str, error: anyhow::Error) -> CompactSessionError {
    report_failure(session_id, "attach current session", &error)
}

fn map_admission_error(
    session_id: &str,
    error: SessionCompactionAdmissionError,
) -> CompactSessionError {
    match error {
        SessionCompactionAdmissionError::Busy { .. }
        | SessionCompactionAdmissionError::ExternalBusy { .. }
        | SessionCompactionAdmissionError::Coordination {
            message:
                SessionCoordinationError::StaleConfiguration { .. }
                | SessionCoordinationError::LocalAgentBusy,
        } => CompactSessionError::Busy,
        SessionCompactionAdmissionError::Coordination { .. }
        | SessionCompactionAdmissionError::Unavailable => {
            report_failure(session_id, "admit compaction", &error)
        }
    }
}

fn report_failure(
    session_id: &str,
    operation: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> CompactSessionError {
    eprintln!("nac: manual compaction for session {session_id:?} failed to {operation}: {error}");
    CompactSessionError::Failed
}

pub(crate) async fn handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<CompactSessionResponse>, CompactSessionError> {
    Ok(Json(manager.compact_session(&session_id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stale_configuration_is_busy_but_invalid_lease_is_a_failure() {
        let stale = SessionCompactionAdmissionError::Coordination {
            message: SessionCoordinationError::StaleConfiguration {
                session_id: "session".to_string(),
            },
        };
        let stale_error = map_admission_error("session", stale);
        assert_eq!(stale_error, CompactSessionError::Busy);
        assert_eq!(
            stale_error.into_response().status(),
            axum::http::StatusCode::CONFLICT
        );
        assert_eq!(
            map_admission_error(
                "session",
                SessionCompactionAdmissionError::Coordination {
                    message: SessionCoordinationError::LocalAgentBusy,
                },
            ),
            CompactSessionError::Busy
        );

        let invalid = SessionCompactionAdmissionError::Coordination {
            message: SessionCoordinationError::InvalidLease,
        };
        assert_eq!(
            map_admission_error("session", invalid),
            CompactSessionError::Failed
        );
    }
}
