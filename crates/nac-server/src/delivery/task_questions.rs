use crate::application::task_questions::TaskQuestionApplication;
use crate::{ApiError, ApiErrorBody, SessionManager};
use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::StatusCode,
    Json,
};
use nac_core::store::{QuestionAnswer, QuestionAnswerReceipt, QuestionRecord};

#[derive(serde::Deserialize, utoipa::ToSchema)]
#[serde(deny_unknown_fields)]
pub(crate) struct CancelQuestionRequest {
    pub expected_revision: i64,
}

#[utoipa::path(get, path="/sessions/{session_id}/questions", operation_id="get_sessions_session_id_questions", tag="conversation",
params(("session_id"=String,Path)),responses((status=200,body=Vec<QuestionRecord>),(status=400,body=ApiErrorBody),(status=404,body=ApiErrorBody),(status=500,body=ApiErrorBody)))]
pub(crate) async fn list_questions(
    State(manager): State<SessionManager>,
    Path(session): Path<String>,
) -> Result<Json<Vec<QuestionRecord>>, ApiError> {
    Ok(Json(
        TaskQuestionApplication::new(&manager).list(session).await?,
    ))
}

#[utoipa::path(get, path="/sessions/{session_id}/questions/{request_id}", operation_id="get_sessions_session_id_questions_request_id", tag="conversation",
params(("session_id"=String,Path),("request_id"=String,Path)),responses((status=200,body=QuestionRecord),(status=404,body=ApiErrorBody),(status=500,body=ApiErrorBody)))]
pub(crate) async fn read_question(
    State(manager): State<SessionManager>,
    Path((session, request)): Path<(String, String)>,
) -> Result<Json<QuestionRecord>, ApiError> {
    TaskQuestionApplication::new(&manager)
        .read(session, request)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::new(StatusCode::NOT_FOUND, "question was not found".into()))
}

#[utoipa::path(post, path="/sessions/{session_id}/questions/{request_id}/answer", operation_id="post_sessions_session_id_questions_request_id_answer", tag="conversation",
params(("session_id"=String,Path),("request_id"=String,Path)),request_body=QuestionAnswer,
responses((status=200,body=QuestionAnswerReceipt),(status=400,body=ApiErrorBody),(status=403,body=ApiErrorBody),(status=404,body=ApiErrorBody),(status=409,body=ApiErrorBody),(status=500,body=ApiErrorBody)))]
pub(crate) async fn answer_question(
    State(manager): State<SessionManager>,
    Path((session, request)): Path<(String, String)>,
    payload: Result<Json<QuestionAnswer>, JsonRejection>,
) -> Result<Json<QuestionAnswerReceipt>, ApiError> {
    let Json(answer) = payload.map_err(ApiError::from)?;
    if request != answer.request_id {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "question identity does not match the route".into(),
        ));
    }
    Ok(Json(
        TaskQuestionApplication::new(&manager)
            .answer(session, answer)
            .await?,
    ))
}

#[utoipa::path(post, path="/sessions/{session_id}/questions/{request_id}/cancel", operation_id="post_sessions_session_id_questions_request_id_cancel", tag="conversation",
params(("session_id"=String,Path),("request_id"=String,Path)),request_body=CancelQuestionRequest,
responses((status=200,body=QuestionRecord),(status=400,body=ApiErrorBody),(status=403,body=ApiErrorBody),(status=404,body=ApiErrorBody),(status=409,body=ApiErrorBody),(status=500,body=ApiErrorBody)))]
pub(crate) async fn cancel_question(
    State(manager): State<SessionManager>,
    Path((session, request)): Path<(String, String)>,
    payload: Result<Json<CancelQuestionRequest>, JsonRejection>,
) -> Result<Json<QuestionRecord>, ApiError> {
    let Json(cancel) = payload.map_err(ApiError::from)?;
    Ok(Json(
        TaskQuestionApplication::new(&manager)
            .cancel(session, request, cancel.expected_revision)
            .await?,
    ))
}
