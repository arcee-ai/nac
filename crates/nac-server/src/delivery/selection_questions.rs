//! HTTP delivery for tool-free questions about selected assistant text.
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use nac_core::selection_question::{
    SelectionQuestionRequest, MAX_ANSWER_CHARS, MAX_EXCERPT_CHARS, MAX_PROMPT_CONTEXT_CHARS,
    MAX_QUESTION_CHARS, MAX_SOURCE_CONTEXT_CHARS,
};
use nac_core::store::{
    SelectionQuestionModel, SelectionQuestionRecord, SelectionQuestionStatus,
    SELECTION_QUESTION_HISTORY_LIMIT,
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::application::selection_questions::{
    SelectionQuestionApplication, SelectionQuestionApplicationError as Error,
};
use crate::{ApiError, ApiErrorBody, SessionManager};

impl From<Error> for ApiError {
    fn from(error: Error) -> Self {
        let status = match &error {
            Error::NotFound => StatusCode::NOT_FOUND,
            Error::Invalid(_) | Error::Configuration(_) => StatusCode::BAD_REQUEST,
            Error::Unsupported | Error::Conflict(_) | Error::InFlight => StatusCode::CONFLICT,
            Error::Busy => StatusCode::TOO_MANY_REQUESTS,
            Error::Maintenance => StatusCode::SERVICE_UNAVAILABLE,
            // Busy/locked SQLite or a full persistence queue refused the work
            // before it committed, so nothing changed and the same request can
            // be retried. An uncertain commit is never treated as contention.
            // Its own message keeps it apart from this route's other 409s.
            Error::Internal(cause) if super::error::is_precommit_contention(cause) => {
                return ApiError::new(
                    StatusCode::CONFLICT,
                    "the question store is busy; try again shortly".to_owned(),
                );
            }
            Error::Internal(cause) => {
                eprintln!("nac: selection question failed: {cause:#}");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        ApiError::new(status, error.to_string())
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct AskSelectionQuestionRequest {
    /// Client-chosen UUID. An identical retry returns the original question;
    /// reusing it with different arguments is a 409 conflict.
    pub request_key: String,
    /// Canonical transcript index of the completed assistant message.
    pub source_message_index: u64,
    /// SHA-256 (lowercase hex) of that message's complete visible text.
    pub source_content_sha256: String,
    /// Unicode scalar offsets of `excerpt` inside that visible text.
    pub selection_start: u64,
    pub selection_end: u64,
    pub excerpt: String,
    pub question: String,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct SelectionQuestionSource {
    pub message_index: u64,
    pub content_sha256: String,
    pub selection_start: u64,
    pub selection_end: u64,
    /// The originating text was windowed to the documented context limit.
    pub source_text_truncated: bool,
    pub has_preceding_prompt: bool,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct SelectionQuestionResponse {
    pub question_id: String,
    pub request_key: String,
    pub status: SelectionQuestionStatus,
    pub source: SelectionQuestionSource,
    pub excerpt: String,
    pub question: String,
    /// Model, backend and configuration version pinned at admission.
    pub model: SelectionQuestionModel,
    #[schema(required)]
    pub answer: Option<String>,
    pub answer_truncated: bool,
    #[schema(required)]
    pub error: Option<String>,
    /// The provider returned a tool call. It was never executed.
    pub tool_call_attempted: bool,
    /// This question's own provider usage; never part of the chat's run usage.
    #[schema(required)]
    pub usage: Option<nac_core::model::TokenUsage>,
    pub created_at: String,
    pub updated_at: String,
    #[schema(required)]
    pub completed_at: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct AskSelectionQuestionResponse {
    /// True when this request key was already admitted.
    pub replayed: bool,
    pub question: SelectionQuestionResponse,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct SelectionQuestionLimits {
    pub max_excerpt_chars: usize,
    pub max_question_chars: usize,
    pub max_source_context_chars: usize,
    pub max_prompt_context_chars: usize,
    pub max_answer_chars: usize,
    pub history_limit: usize,
    pub provider_timeout_secs: u64,
}

#[derive(Serialize, ToSchema)]
pub(crate) struct SelectionQuestionListResponse {
    /// Oldest first, bounded to `limits.history_limit`.
    pub items: Vec<SelectionQuestionResponse>,
    pub limits: SelectionQuestionLimits,
}

impl From<SelectionQuestionRecord> for SelectionQuestionResponse {
    fn from(record: SelectionQuestionRecord) -> Self {
        let context = record.context;
        Self {
            question_id: record.question_id,
            request_key: record.request_key,
            status: record.status,
            source: SelectionQuestionSource {
                message_index: context.source_message_index,
                content_sha256: context.source_content_sha256,
                selection_start: context.selection_start,
                selection_end: context.selection_end,
                source_text_truncated: context.source_text_truncated,
                has_preceding_prompt: context.preceding_prompt.is_some(),
            },
            excerpt: context.excerpt,
            question: context.question,
            model: record.model,
            answer: record.answer,
            answer_truncated: record.answer_truncated,
            error: record.error,
            tool_call_attempted: record.tool_call_attempted,
            usage: record.usage,
            created_at: record.created_at,
            updated_at: record.updated_at,
            completed_at: record.completed_at,
        }
    }
}

fn limits() -> SelectionQuestionLimits {
    SelectionQuestionLimits {
        max_excerpt_chars: MAX_EXCERPT_CHARS,
        max_question_chars: MAX_QUESTION_CHARS,
        max_source_context_chars: MAX_SOURCE_CONTEXT_CHARS,
        max_prompt_context_chars: MAX_PROMPT_CONTEXT_CHARS,
        max_answer_chars: MAX_ANSWER_CHARS,
        history_limit: SELECTION_QUESTION_HISTORY_LIMIT,
        provider_timeout_secs: nac_core::selection_question::PROVIDER_TIMEOUT.as_secs(),
    }
}

#[utoipa::path(post, path = "/sessions/{session_id}/selection-questions",
    operation_id = "post_sessions_session_id_selection_questions", tag = "conversation",
    params(("session_id" = String, Path)), request_body = AskSelectionQuestionRequest,
    responses(
        (status = 200, description = "Admitted (or replayed) question; the answer arrives asynchronously", body = AskSelectionQuestionResponse),
        (status = 400, description = "Invalid request, bounds, unmappable selection or model configuration", content((ApiErrorBody = "application/json"), (String = "text/plain"))),
        (status = 404, description = "Session not found", body = ApiErrorBody),
        (status = 409, description = "Unsupported chat, changed or deleted source, conflicting request key, a question already in flight, or a busy store that recorded nothing", body = ApiErrorBody),
        (status = 413, description = "Request body too large", body = String, content_type = "text/plain"),
        (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"),
        (status = 422, description = "JSON body validation failed, including unknown fields", body = String, content_type = "text/plain"),
        (status = 429, description = "Too many questions in flight on this host", body = ApiErrorBody),
        (status = 500, description = "Persistence failure; retry the same request key", body = ApiErrorBody),
        (status = 503, description = "Host maintenance", body = ApiErrorBody)))]
pub(crate) async fn ask(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
    Json(request): Json<AskSelectionQuestionRequest>,
) -> Result<Json<AskSelectionQuestionResponse>, ApiError> {
    let admitted = SelectionQuestionApplication::new(&manager)
        .ask(
            &session_id,
            SelectionQuestionRequest {
                request_key: request.request_key,
                source_message_index: request.source_message_index,
                source_content_sha256: request.source_content_sha256,
                selection_start: request.selection_start,
                selection_end: request.selection_end,
                excerpt: request.excerpt,
                question: request.question,
            },
        )
        .await?;
    Ok(Json(AskSelectionQuestionResponse {
        replayed: admitted.replayed,
        question: admitted.record.into(),
    }))
}

#[utoipa::path(get, path = "/sessions/{session_id}/selection-questions",
    operation_id = "get_sessions_session_id_selection_questions", tag = "conversation",
    params(("session_id" = String, Path)),
    responses(
        (status = 200, description = "Bounded question history, separate from the transcript", body = SelectionQuestionListResponse),
        (status = 404, description = "Session not found", body = ApiErrorBody),
        (status = 409, description = "The store is busy; try again", body = ApiErrorBody),
        (status = 500, description = "Request failed", body = ApiErrorBody)))]
pub(crate) async fn list(
    State(manager): State<SessionManager>,
    Path(session_id): Path<String>,
) -> Result<Json<SelectionQuestionListResponse>, ApiError> {
    let items = SelectionQuestionApplication::new(&manager)
        .list(&session_id)
        .await?;
    Ok(Json(SelectionQuestionListResponse {
        items: items.into_iter().map(Into::into).collect(),
        limits: limits(),
    }))
}

#[utoipa::path(get, path = "/sessions/{session_id}/selection-questions/{question_id}",
    operation_id = "get_sessions_session_id_selection_questions_question_id", tag = "conversation",
    params(("session_id" = String, Path), ("question_id" = String, Path)),
    responses(
        (status = 200, description = "One question", body = SelectionQuestionResponse),
        (status = 404, description = "Session or question not found", body = ApiErrorBody),
        (status = 409, description = "The store is busy; try again", body = ApiErrorBody),
        (status = 500, description = "Request failed", body = ApiErrorBody)))]
pub(crate) async fn get(
    State(manager): State<SessionManager>,
    Path((session_id, question_id)): Path<(String, String)>,
) -> Result<Json<SelectionQuestionResponse>, ApiError> {
    Ok(Json(
        SelectionQuestionApplication::new(&manager)
            .get(&session_id, &question_id)
            .await?
            .into(),
    ))
}

#[utoipa::path(post, path = "/sessions/{session_id}/selection-questions/{question_id}/cancel",
    operation_id = "post_sessions_session_id_selection_questions_question_id_cancel", tag = "conversation",
    params(("session_id" = String, Path), ("question_id" = String, Path)),
    responses(
        (status = 200, description = "The question after cancellation; settled questions are unchanged", body = SelectionQuestionResponse),
        (status = 404, description = "Session or question not found", body = ApiErrorBody),
        (status = 409, description = "The store is busy and nothing was canceled; try again", body = ApiErrorBody),
        (status = 500, description = "Request failed", body = ApiErrorBody)))]
pub(crate) async fn cancel(
    State(manager): State<SessionManager>,
    Path((session_id, question_id)): Path<(String, String)>,
) -> Result<Json<SelectionQuestionResponse>, ApiError> {
    Ok(Json(
        SelectionQuestionApplication::new(&manager)
            .cancel(&session_id, &question_id)
            .await?
            .into(),
    ))
}
