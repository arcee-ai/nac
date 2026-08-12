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
use nac_core::{commands::PreparedUserInput, session_service::RevertOutcome};
use serde::{Deserialize, Serialize};

use crate::{frontend_command_name, submit_response, SessionManager, SubmitPromptResponse};

#[derive(Debug, Clone, Deserialize)]
pub struct RevertSessionRequest {
    /// Transcript index of the user message to go back to. That message and
    /// everything after it are dropped.
    pub message_idx: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RegenerateSessionRequest {
    /// Transcript index of the user message to answer again. It and everything
    /// after it are dropped before the same prompt is submitted afresh.
    pub message_idx: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
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
pub enum SessionRewriteError<const REGENERATE: bool> {
    NotFound,
    Busy,
    /// The request named a message that cannot be rewritten from: an index
    /// past the transcript, a message that is not the user's, one predating the
    /// transcript log, or (when regenerating) input the composer cannot accept.
    /// The message comes from the layer that knows why the target was rejected.
    Rejected(String),
    Failed,
}

/// Error returned when reverting a session to an earlier user message.
pub type RevertSessionError = SessionRewriteError<false>;
/// Error returned when regenerating a response from an earlier user message.
pub type RegenerateSessionError = SessionRewriteError<true>;

impl<const REGENERATE: bool> std::fmt::Display for SessionRewriteError<REGENERATE> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound => formatter.write_str("session not found"),
            Self::Busy => formatter.write_str("session is busy"),
            Self::Rejected(message) => formatter.write_str(message),
            Self::Failed if REGENERATE => formatter.write_str("regenerate failed"),
            Self::Failed => formatter.write_str("revert failed"),
        }
    }
}

impl<const REGENERATE: bool> std::error::Error for SessionRewriteError<REGENERATE> {}

impl<const REGENERATE: bool> IntoResponse for SessionRewriteError<REGENERATE> {
    fn into_response(self) -> Response {
        let status = match self {
            Self::NotFound => axum::http::StatusCode::NOT_FOUND,
            Self::Busy => axum::http::StatusCode::CONFLICT,
            Self::Rejected(_) => axum::http::StatusCode::BAD_REQUEST,
            Self::Failed => axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(serde_json::json!({ "error": self.to_string() })),
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
        self.with_admitted_operation(
            session_id,
            || RevertSessionError::NotFound,
            || RevertSessionError::Busy,
            |operation, error| report_failure(session_id, operation, error),
            |service, operation_lease| async move {
                let _operation_lease = operation_lease;
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
            },
        )
        .await
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
        self.with_admitted_operation(
            session_id,
            || RegenerateSessionError::NotFound,
            || RegenerateSessionError::Busy,
            |operation, error| report_failure(session_id, operation, error),
            |service, operation_lease| async move {
                let input = service.user_input_at(message_idx).await.map_err(|error| {
                    if is_rejection(&error) {
                        RegenerateSessionError::Rejected(format!("{error}"))
                    } else {
                        report_failure(session_id, "read the prompt to repeat", &error)
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
                            report_failure(session_id, "revert the transcript", &error)
                        }
                    })?;

                let display_prompt = prompt.display_prompt.clone();
                let handle = client
                    .try_submit_prepared_prompt_with_lease(prompt, operation_lease)
                    .map_err(|error| {
                        report_failure(session_id, "start the repeated run", &error)
                    })?;
                Ok(submit_response(handle, display_prompt))
            },
        )
        .await
    }
}

/// The core validates the requested target before it changes anything, so a
/// failure raised with nothing else attached to it is a bad request rather than
/// a broken session.
fn is_rejection(error: &anyhow::Error) -> bool {
    error.chain().count() == 1
}

fn report_failure<const REGENERATE: bool>(
    session_id: &str,
    operation: &str,
    error: &(impl std::fmt::Display + ?Sized),
) -> SessionRewriteError<REGENERATE> {
    let rewrite = if REGENERATE { "regenerate" } else { "revert" };
    eprintln!("nac: {rewrite} for session {session_id:?} failed to {operation}: {error}");
    SessionRewriteError::Failed
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::to_bytes, http::StatusCode};

    async fn assert_response<const REGENERATE: bool>(
        error: SessionRewriteError<REGENERATE>,
        status: StatusCode,
        message: &str,
    ) {
        let response = error.into_response();
        assert_eq!(response.status(), status);
        let body = to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read rewrite error response");
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&body).expect("parse error response"),
            serde_json::json!({ "error": message })
        );
    }

    #[tokio::test]
    async fn revert_errors_have_exact_responses() {
        assert_response(
            RevertSessionError::NotFound,
            StatusCode::NOT_FOUND,
            "session not found",
        )
        .await;
        assert_response(
            RevertSessionError::Busy,
            StatusCode::CONFLICT,
            "session is busy",
        )
        .await;
        assert_response(
            RevertSessionError::Rejected("bad revert target".into()),
            StatusCode::BAD_REQUEST,
            "bad revert target",
        )
        .await;
        assert_response(
            RevertSessionError::Failed,
            StatusCode::INTERNAL_SERVER_ERROR,
            "revert failed",
        )
        .await;
    }

    #[tokio::test]
    async fn regenerate_errors_have_exact_responses() {
        assert_response(
            RegenerateSessionError::NotFound,
            StatusCode::NOT_FOUND,
            "session not found",
        )
        .await;
        assert_response(
            RegenerateSessionError::Busy,
            StatusCode::CONFLICT,
            "session is busy",
        )
        .await;
        assert_response(
            RegenerateSessionError::Rejected("bad repeated prompt".into()),
            StatusCode::BAD_REQUEST,
            "bad repeated prompt",
        )
        .await;
        assert_response(
            RegenerateSessionError::Failed,
            StatusCode::INTERNAL_SERVER_ERROR,
            "regenerate failed",
        )
        .await;
    }
}
