use std::sync::Arc;

use nac_core::{
    session_service::{
        SessionCoordinationError, SessionService, UserCommandOutputError, UserCommandRequest,
        UserCommandSnapshot, UserCommandSubmitError,
    },
    sessions,
};

use crate::{SessionManager, UserCommandOutputPage};

const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const MAX_TIMEOUT_MS: u64 = 3_600_000;
const DEFAULT_OUTPUT_PAGE_BYTES: usize = 16 * 1024;
const MAX_OUTPUT_PAGE_BYTES: usize = 64 * 1024;

#[derive(Debug)]
pub(crate) enum UserCommandApplicationError {
    NotFound,
    Invalid(String),
    NotDirectPrimary,
    Busy(String),
    Conflict(String),
    NotRetained,
    Internal(anyhow::Error),
}

impl std::fmt::Display for UserCommandApplicationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("user command not found"),
            Self::Invalid(message) | Self::Busy(message) | Self::Conflict(message) => {
                formatter.write_str(message)
            }
            Self::NotDirectPrimary => {
                formatter.write_str(&UserCommandSubmitError::NotDirectPrimary.to_string())
            }
            Self::NotRetained => {
                formatter.write_str(&UserCommandOutputError::NotRetained.to_string())
            }
            Self::Internal(error) => write!(formatter, "{error:#}"),
        }
    }
}

impl From<anyhow::Error> for UserCommandApplicationError {
    fn from(error: anyhow::Error) -> Self {
        Self::Internal(error)
    }
}

type Outcome<T> = Result<T, UserCommandApplicationError>;

pub(crate) struct UserCommandOutputRequest {
    pub(crate) stream: Option<String>,
    pub(crate) offset: Option<u64>,
    pub(crate) limit: Option<usize>,
}

/// User-command admission, lookup, cancellation, and output paging for direct primary sessions.
pub(crate) struct SessionUserCommandApplication<'a> {
    manager: &'a SessionManager,
}

impl<'a> SessionUserCommandApplication<'a> {
    pub(crate) fn new(manager: &'a SessionManager) -> Self {
        Self { manager }
    }

    /// Returns the snapshot and whether it replays an earlier admission of the same request.
    pub(crate) async fn submit(
        &self,
        session_id: &str,
        request: UserCommandRequest,
    ) -> Outcome<(UserCommandSnapshot, bool)> {
        validate_request(&request)?;
        self.validate_session(session_id).await?;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.validate_session(session_id).await?;
        let service = self.manager.attach_session_locked(session_id, None).await?;
        if let Some(existing) = replay(&service, &request).await? {
            return Ok((existing, true));
        }
        let lease = match sessions::SessionOperationLease::try_acquire(
            &self.manager.inner.store_path,
            session_id,
        ) {
            Ok(lease) => lease,
            Err(sessions::SessionOperationLeaseError::Busy(_)) => {
                return match replay(&service, &request).await? {
                    Some(existing) => Ok((existing, true)),
                    None => Err(map_submit_error(match service.active_operation() {
                        Some(active_operation) => UserCommandSubmitError::Busy { active_operation },
                        None => UserCommandSubmitError::ExternalBusy {
                            session_id: session_id.to_owned(),
                        },
                    })),
                };
            }
            Err(sessions::SessionOperationLeaseError::Store(error)) => {
                return Err(UserCommandApplicationError::Internal(error));
            }
        };
        let service = self
            .manager
            .attach_current_operation_service_locked(session_id, &lease)
            .await?;
        let admission = self
            .manager
            .inner
            ._store_ownership
            .call_legacy(move || {
                service
                    .submit_user_command_with_lease(request, lease)
                    .map_err(map_submit_error)
            })
            .await??;
        Ok((admission.command, admission.replayed))
    }

    pub(crate) async fn lookup(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Outcome<UserCommandSnapshot> {
        let service = self.attach(session_id).await?;
        service
            .user_command(request_id)
            .await?
            .ok_or(UserCommandApplicationError::NotFound)
    }

    pub(crate) async fn cancel(
        &self,
        session_id: &str,
        request_id: &str,
    ) -> Outcome<UserCommandSnapshot> {
        let service = self.attach(session_id).await?;
        service
            .cancel_user_command(request_id)
            .await?
            .ok_or(UserCommandApplicationError::NotFound)
    }

    pub(crate) async fn output(
        &self,
        session_id: &str,
        request_id: &str,
        request: UserCommandOutputRequest,
    ) -> Outcome<UserCommandOutputPage> {
        let stream = request.stream.as_deref().unwrap_or("combined");
        if !matches!(stream, "combined" | "stdout" | "stderr") {
            return Err(UserCommandApplicationError::Invalid(format!(
                "invalid stream '{stream}'; expected combined, stdout, or stderr"
            )));
        }
        let limit = request.limit.unwrap_or(DEFAULT_OUTPUT_PAGE_BYTES);
        if !(1..=MAX_OUTPUT_PAGE_BYTES).contains(&limit) {
            return Err(UserCommandApplicationError::Invalid(format!(
                "limit must be between 1 and {MAX_OUTPUT_PAGE_BYTES}"
            )));
        }
        let service = self.attach(session_id).await?;
        // nac-core keeps its terminal types private, so the stream and page cross by serde.
        let page = service
            .read_user_command_output(
                request_id,
                serde_json::from_value(serde_json::Value::from(stream))
                    .map_err(anyhow::Error::new)?,
                request.offset.unwrap_or(0),
                limit,
            )
            .await
            .map_err(|error| match error {
                UserCommandOutputError::NotFound => UserCommandApplicationError::NotFound,
                UserCommandOutputError::NotRetained => UserCommandApplicationError::NotRetained,
                UserCommandOutputError::Store { message } => {
                    UserCommandApplicationError::Internal(anyhow::anyhow!(message))
                }
            })?;
        Ok(serde_json::to_value(page)
            .and_then(serde_json::from_value)
            .map_err(anyhow::Error::new)?)
    }

    async fn attach(&self, session_id: &str) -> Outcome<Arc<SessionService>> {
        self.validate_session(session_id).await?;
        let gate = self.manager.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        self.validate_session(session_id).await?;
        Ok(self.manager.attach_session_locked(session_id, None).await?)
    }

    async fn validate_session(&self, session_id: &str) -> Outcome<()> {
        let manager = self.manager.clone();
        let session = session_id.to_owned();
        let primary = self
            .manager
            .inner
            ._store_ownership
            .call_legacy(move || -> anyhow::Result<bool> {
                Ok(manager.persisted_operation_session_exists(&session)?
                    && manager.session_lineage(&session)?.is_none())
            })
            .await??;
        if primary {
            Ok(())
        } else {
            Err(UserCommandApplicationError::NotFound)
        }
    }
}

fn validate_request(request: &UserCommandRequest) -> Outcome<u64> {
    let invalid = |message: &str| Err(UserCommandApplicationError::Invalid(message.to_owned()));
    if request.request_id.trim().is_empty() {
        return invalid("request_id must not be empty");
    }
    if request.command.trim().is_empty() {
        return invalid("command must not be empty");
    }
    let timeout_ms = request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    if !(1..=MAX_TIMEOUT_MS).contains(&timeout_ms) {
        return invalid("timeout_ms must be between 1 and 3600000");
    }
    Ok(timeout_ms)
}

async fn replay(
    service: &SessionService,
    request: &UserCommandRequest,
) -> Outcome<Option<UserCommandSnapshot>> {
    Ok(service
        .reconcile_user_command_request(request)
        .await
        .map_err(map_submit_error)?
        .map(|admission| admission.command))
}

fn map_submit_error(error: UserCommandSubmitError) -> UserCommandApplicationError {
    match error {
        UserCommandSubmitError::Busy { .. }
        | UserCommandSubmitError::ExternalBusy { .. }
        | UserCommandSubmitError::Coordination {
            message:
                SessionCoordinationError::StaleConfiguration { .. }
                | SessionCoordinationError::LocalAgentBusy,
        } => UserCommandApplicationError::Busy(error.to_string()),
        UserCommandSubmitError::Conflict { .. } => {
            UserCommandApplicationError::Conflict(error.to_string())
        }
        UserCommandSubmitError::Invalid { message } => {
            UserCommandApplicationError::Invalid(message)
        }
        UserCommandSubmitError::NotDirectPrimary => UserCommandApplicationError::NotDirectPrimary,
        UserCommandSubmitError::Coordination { .. } => {
            UserCommandApplicationError::Internal(anyhow::Error::new(error))
        }
    }
}
