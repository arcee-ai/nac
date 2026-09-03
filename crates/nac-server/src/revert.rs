//! Taking a session back to an earlier point in its conversation.
//!
//! A revert touches the two things a run produces — the transcript and the
//! checkout — so it runs under the same operation lease a run does. Holding it
//! for the whole operation is what makes "no run is writing while we rewrite
//! history" true rather than hoped for.
//!
//! Regenerating a reply is the same rewrite followed by a run, and it holds one
//! lease across both halves for the same reason: between them the session has
//! forgotten the prompt but not yet asked it again, and nothing else may
//! observe or act on that state.

use axum::{
    extract::{Path as AxumPath, State},
    response::{IntoResponse, Response},
    Json,
};
use nac_core::{commands::PreparedUserInput, session_service::RevertOutcome, sessions};
use serde::{Deserialize, Serialize};

use crate::{
    frontend_command_name, submit_response, ApiErrorBody, SessionManager, SubmitPromptResponse,
};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct RevertSessionRequest {
    /// Transcript index of the user message to go back to. That message and
    /// everything after it are dropped.
    pub message_idx: usize,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct RegenerateSessionRequest {
    /// Transcript index of the user message to answer again. It and everything
    /// after it are dropped before the same prompt is submitted afresh.
    pub message_idx: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, utoipa::ToSchema)]
pub struct RevertSessionResponse {
    pub transcript_len: usize,
    pub messages_removed: usize,
    pub workspace_restored: bool,
    pub revisions_removed: usize,
    pub threads_removed: usize,
}

impl From<RevertOutcome> for RevertSessionResponse {
    fn from(outcome: RevertOutcome) -> Self {
        Self {
            transcript_len: outcome.transcript_len,
            messages_removed: outcome.messages_removed,
            workspace_restored: outcome.workspace_restored,
            revisions_removed: outcome.revisions_removed,
            threads_removed: outcome.threads_removed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RevertSessionError {
    NotFound,
    Busy,
    /// The request named something that cannot be reverted to — an index past
    /// the transcript, a message that is not the user's, or one that predates
    /// the transcript log. The message is the core's, which is the only place
    /// that knows which of those it was.
    Rejected(String),
    Failed,
}

impl std::fmt::Display for RevertSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("session not found"),
            Self::Busy => formatter.write_str("session is busy"),
            Self::Rejected(message) => formatter.write_str(message),
            Self::Failed => formatter.write_str("revert failed"),
        }
    }
}

impl std::error::Error for RevertSessionError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegenerateSessionError {
    NotFound,
    Busy,
    /// The request named a message that cannot be answered again — see
    /// [`RevertSessionError::Rejected`], plus the case where the message is no
    /// longer something the composer would accept.
    Rejected(String),
    Failed,
}

impl std::fmt::Display for RegenerateSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("session not found"),
            Self::Busy => formatter.write_str("session is busy"),
            Self::Rejected(message) => formatter.write_str(message),
            Self::Failed => formatter.write_str("regenerate failed"),
        }
    }
}

impl std::error::Error for RegenerateSessionError {}

impl IntoResponse for RegenerateSessionError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Busy => axum::http::StatusCode::CONFLICT,
            Self::Rejected(_) => axum::http::StatusCode::BAD_REQUEST,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ApiErrorBody {
                error: self.to_string(),
            }),
        )
            .into_response()
    }
}

impl IntoResponse for RevertSessionError {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Busy => axum::http::StatusCode::CONFLICT,
            Self::Rejected(_) => axum::http::StatusCode::BAD_REQUEST,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ApiErrorBody {
                error: self.to_string(),
            }),
        )
            .into_response()
    }
}

impl SessionManager {
    pub async fn revert_session(
        &self,
        session_id: &str,
        message_idx: usize,
    ) -> Result<RevertSessionResponse, RevertSessionError> {
        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "verify persisted session", &error))?
        {
            return Err(RevertSessionError::NotFound);
        }
        if self
            .session_lineage(session_id)
            .map_err(|error| report_failure(session_id, "verify session ownership", &error))?
            .is_some()
        {
            return Err(RevertSessionError::NotFound);
        }

        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)
                .map_err(|error| match error {
                    sessions::SessionOperationLeaseError::Busy(_) => RevertSessionError::Busy,
                    sessions::SessionOperationLeaseError::Store(error) => {
                        report_failure(session_id, "acquire operation lease", &error)
                    }
                })?;

        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| report_failure(session_id, "recheck persisted session", &error))?
        {
            return Err(RevertSessionError::NotFound);
        }
        if self
            .session_lineage(session_id)
            .map_err(|error| report_failure(session_id, "recheck session ownership", &error))?
            .is_some()
        {
            return Err(RevertSessionError::NotFound);
        }

        let service = self
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await
            .map_err(|error| report_failure(session_id, "attach current session", &error))?;

        service
            .revert_to_message(message_idx)
            .await
            .map(RevertSessionResponse::from)
            .map_err(|error| {
                // A rejected target is the caller's mistake and worth telling
                // them about; anything else is ours and stays in the log.
                if is_rejection(&error) {
                    RevertSessionError::Rejected(format!("{error}"))
                } else {
                    report_failure(session_id, "revert the transcript", &error)
                }
            })
    }
}

impl SessionManager {
    /// Answer a prompt again rather than asking it twice: the message and
    /// everything it produced leave the transcript, the checkout goes back with
    /// them, and then the same input is submitted afresh.
    ///
    /// The input is read out of the transcript rather than taken from the
    /// caller, so the run repeats what was actually asked. Everything that can
    /// be checked is checked before the revert, because past that point the
    /// prompt exists only in this function.
    pub async fn regenerate_session_run(
        &self,
        session_id: &str,
        message_idx: usize,
    ) -> Result<SubmitPromptResponse, RegenerateSessionError> {
        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| {
                report_regenerate_failure(session_id, "verify persisted session", &error)
            })?
        {
            return Err(RegenerateSessionError::NotFound);
        }
        if self
            .session_lineage(session_id)
            .map_err(|error| {
                report_regenerate_failure(session_id, "verify session ownership", &error)
            })?
            .is_some()
        {
            return Err(RegenerateSessionError::NotFound);
        }

        let gate = self.lifecycle_gate(session_id);
        let _lifecycle = gate.lock().await;
        let operation_lease =
            sessions::SessionOperationLease::try_acquire(&self.inner.store_path, session_id)
                .map_err(|error| match error {
                    sessions::SessionOperationLeaseError::Busy(_) => RegenerateSessionError::Busy,
                    sessions::SessionOperationLeaseError::Store(error) => {
                        report_regenerate_failure(session_id, "acquire operation lease", &error)
                    }
                })?;

        if !self
            .persisted_operation_session_exists(session_id)
            .map_err(|error| {
                report_regenerate_failure(session_id, "recheck persisted session", &error)
            })?
        {
            return Err(RegenerateSessionError::NotFound);
        }
        if self
            .session_lineage(session_id)
            .map_err(|error| {
                report_regenerate_failure(session_id, "recheck session ownership", &error)
            })?
            .is_some()
        {
            return Err(RegenerateSessionError::NotFound);
        }

        let service = self
            .attach_current_operation_service_locked(session_id, &operation_lease)
            .await
            .map_err(|error| {
                report_regenerate_failure(session_id, "attach current session", &error)
            })?;

        let input = service.user_input_at(message_idx).await.map_err(|error| {
            if is_rejection(&error) {
                RegenerateSessionError::Rejected(format!("{error}"))
            } else {
                report_regenerate_failure(session_id, "read the prompt to repeat", &error)
            }
        })?;

        let client = service.connect_client();
        let prompt = match client.prepare_user_input(&input) {
            PreparedUserInput::SubmitPrompt(prompt) => prompt,
            PreparedUserInput::Empty => {
                return Err(RegenerateSessionError::Rejected(
                    "prompt is empty".to_string(),
                ))
            }
            PreparedUserInput::InvalidSlashCommand { message } => {
                return Err(RegenerateSessionError::Rejected(message))
            }
            PreparedUserInput::FrontendCommand(command) => {
                return Err(RegenerateSessionError::Rejected(format!(
                    "frontend command '{}' is not supported by the server API",
                    frontend_command_name(command)
                )))
            }
        };

        service
            .revert_to_message(message_idx)
            .await
            .map_err(|error| {
                if is_rejection(&error) {
                    RegenerateSessionError::Rejected(format!("{error}"))
                } else {
                    report_regenerate_failure(session_id, "revert the transcript", &error)
                }
            })?;

        let display_prompt = prompt.display_prompt.clone();
        let handle = client
            .try_submit_prepared_prompt_with_lease(prompt, operation_lease)
            .map_err(|error| {
                report_regenerate_failure(session_id, "start the repeated run", &error)
            })?;
        Ok(submit_response(handle, display_prompt))
    }
}

/// The core validates the requested target before it changes anything, so a
/// failure raised with nothing else attached to it is a bad request rather than
/// a broken session.
fn is_rejection(error: &anyhow::Error) -> bool {
    error.chain().count() == 1
}

fn report_regenerate_failure(
    session_id: &str,
    operation: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> RegenerateSessionError {
    eprintln!("nac: regenerate for session {session_id:?} failed to {operation}: {error}");
    RegenerateSessionError::Failed
}

fn report_failure(
    session_id: &str,
    operation: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> RevertSessionError {
    eprintln!("nac: revert for session {session_id:?} failed to {operation}: {error}");
    RevertSessionError::Failed
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/revert",
    operation_id = "post_sessions_session_id_revert",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = RevertSessionRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = RevertSessionResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((crate::ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 413, description = "Request body too large", body = String, content_type = "text/plain"), (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"), (status = 422, description = "JSON body validation failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<RevertSessionRequest>,
) -> Result<Json<RevertSessionResponse>, RevertSessionError> {
    Ok(Json(
        manager
            .revert_session(&session_id, request.message_idx)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/regenerate",
    operation_id = "post_sessions_session_id_regenerate",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = RegenerateSessionRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = crate::SubmitPromptResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((crate::ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"), (status = 413, description = "Request body too large", body = String, content_type = "text/plain"), (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"), (status = 422, description = "JSON body validation failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = crate::ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn regenerate_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<RegenerateSessionRequest>,
) -> Result<Json<SubmitPromptResponse>, RegenerateSessionError> {
    Ok(Json(
        manager
            .regenerate_session_run(&session_id, request.message_idx)
            .await?,
    ))
}
