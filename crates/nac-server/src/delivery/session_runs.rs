use std::{convert::Infallible, time::Duration};

use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use nac_core::events::SessionEventBoundary;

use crate::{
    session_event_stream, validate_steering_instruction, ApiError, ApiErrorBody, EventsQuery,
    OrchestratorSteeringRequest, OrchestratorSteeringResponse, RecentEventsResponse,
    SessionManager, SubmitPromptRequest, SubmitPromptResponse, ThreadSteeringRequest,
    ThreadSteeringResponse, DEFAULT_REPLAY_LIMIT,
};

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/runs",
    operation_id = "post_sessions_session_id_runs",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = SubmitPromptRequest, content_type = "application/json"),
    responses((status = 202, description = "Success", body = SubmitPromptResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 413, description = "Request body too large", body = String, content_type = "text/plain"), (status = 415, description = "Unsupported media type", body = String, content_type = "text/plain"), (status = 422, description = "JSON body validation failed", body = String, content_type = "text/plain"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 501, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn submit_prompt(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Json(request): Json<SubmitPromptRequest>,
) -> std::result::Result<(StatusCode, Json<SubmitPromptResponse>), ApiError> {
    Ok((
        StatusCode::ACCEPTED,
        Json(manager.submit_prompt(&session_id, request).await?),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/steering",
    operation_id = "post_sessions_session_id_steering",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = OrchestratorSteeringRequest, content_type = "application/json"),
    responses((status = 202, description = "Success", body = OrchestratorSteeringResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn queue_orchestrator_steering_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<OrchestratorSteeringRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<OrchestratorSteeringResponse>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    validate_steering_instruction(&request.instruction)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            manager
                .queue_orchestrator_steering(&session_id, request)
                .await?,
        ),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/threads/{thread_name}/steering",
    operation_id = "post_sessions_session_id_threads_thread_name_steering",
    tag = "conversation",
    params(("session_id" = String, Path), ("thread_name" = String, Path)),
    request_body(content = ThreadSteeringRequest, content_type = "application/json"),
    responses((status = 202, description = "Success", body = ThreadSteeringResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn queue_thread_steering_handler(
    State(manager): State<SessionManager>,
    AxumPath((session_id, thread_name)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<ThreadSteeringRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<ThreadSteeringResponse>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    validate_steering_instruction(&request.instruction)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            manager
                .queue_thread_steering(&session_id, &thread_name, request)
                .await?,
        ),
    ))
}

pub(crate) fn event_cursor(
    query: &EventsQuery,
) -> std::result::Result<Option<SessionEventBoundary>, ApiError> {
    match (&query.after_epoch_id, query.after_sequence_id) {
        (None, None) => Ok(None),
        (Some(epoch_id), Some(sequence_id)) => Ok(Some(SessionEventBoundary {
            epoch_id: epoch_id.clone(),
            sequence_id,
        })),
        _ => Err(ApiError {
            status: StatusCode::BAD_REQUEST,
            message: "after_epoch_id and after_sequence_id must be supplied together".to_string(),
        }),
    }
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/events",
    operation_id = "get_sessions_session_id_events",
    tag = "events",
    params(EventsQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = RecentEventsResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn recent_events(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<EventsQuery>,
) -> std::result::Result<Json<RecentEventsResponse>, ApiError> {
    let cursor = event_cursor(&query)?;
    let (boundary, events) = manager
        .recent_events(
            &session_id,
            cursor.as_ref(),
            query.limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
        )
        .await?;
    Ok(Json(RecentEventsResponse { boundary, events }))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/events/stream",
    operation_id = "get_sessions_session_id_events_stream",
    tag = "events",
    params(EventsQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Server-sent events. Event names and JSON data schemas: replay_boundary (ReplayBoundaryEvent), replay_gap (ReplayGapEvent), session_event (SessionEventEnvelope), assistant_delta (AssistantStreamDelta), and lagged (LaggedEvent). Only session_event carries an SSE id. This response is never gzip-compressed.", body = String, content_type = "text/event-stream"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn stream_events(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<EventsQuery>,
) -> std::result::Result<
    Sse<impl futures_core::Stream<Item = std::result::Result<Event, Infallible>>>,
    ApiError,
> {
    let cursor = event_cursor(&query)?;
    let (
        epoch_id,
        replay_boundary_sequence_id,
        replay_gap,
        replayed_events,
        receiver,
        assistant_deltas,
    ) = manager
        .subscribe_events(
            &session_id,
            cursor.as_ref(),
            query.limit.unwrap_or(DEFAULT_REPLAY_LIMIT),
        )
        .await?;
    let event_stream = session_event_stream(
        epoch_id,
        replay_boundary_sequence_id,
        replay_gap,
        replayed_events,
        receiver,
        assistant_deltas,
    );

    Ok(Sse::new(event_stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/cancel-active-run",
    operation_id = "post_sessions_session_id_cancel_active_run",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 202, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 501, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn cancel_active_run(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.cancel_active_run(&session_id).await?;
    Ok(StatusCode::ACCEPTED)
}
