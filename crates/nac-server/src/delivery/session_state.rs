use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, Query, State},
    http::StatusCode,
    Json,
};
use nac_core::{
    session_service::{
        FrontendSnapshotLoadOptions, FrontendSnapshotMessages, MessagePageRequest, ThreadEventPage,
    },
    store::SessionGoalRecord,
};

use crate::{
    ApiError, ApiErrorBody, CancelInboxItemRequest, ClearGoalRequest, CreateGoalRequest,
    CreateInboxItemRequest, InboxItemResponse, MessagesPageResponse, MessagesQuery,
    PermissionStateResponse, ReorderInboxItemsRequest, ReplyPermissionRequest, SessionManager,
    SessionSnapshotQuery, SessionSnapshotResponse, ThreadEventsQuery, UpdateGoalRequest,
    UpdateInboxItemRequest, DEFAULT_MESSAGE_PAGE_LIMIT, DEFAULT_THREAD_EVENT_PAGE_LIMIT,
    MAX_MESSAGE_PAGE_LIMIT, MAX_THREAD_EVENT_PAGE_LIMIT,
};

#[utoipa::path(
    get,
    path = "/sessions/{session_id}",
    operation_id = "get_sessions_session_id",
    tag = "sessions",
    params(SessionSnapshotQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = SessionSnapshotResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn session_snapshot(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<SessionSnapshotQuery>,
) -> std::result::Result<Json<SessionSnapshotResponse>, ApiError> {
    let mut options = FrontendSnapshotLoadOptions::default();
    if let Some(limit) = query.thread_event_limit {
        options.thread_event_limit = limit.clamp(1, MAX_THREAD_EVENT_PAGE_LIMIT);
    }
    options.include_sessions = query.include_sessions.unwrap_or(true);
    if let Some(limit) = query.message_limit {
        options.messages = FrontendSnapshotMessages::Page(MessagePageRequest {
            before: None,
            limit: limit.clamp(1, MAX_MESSAGE_PAGE_LIMIT),
            include_system: query.include_system,
        });
    }

    let loaded = manager.snapshot_with_options(&session_id, options).await?;
    let lineage = manager.session_lineage(&session_id)?;
    Ok(Json(SessionSnapshotResponse {
        snapshot: loaded.snapshot,
        lineage,
        message_page: loaded.message_page.map(Into::into),
        message_cycle: loaded.message_cycle.map(Into::into),
    }))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/messages",
    operation_id = "get_sessions_session_id_messages",
    tag = "conversation",
    params(MessagesQuery, ("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = MessagesPageResponse, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn session_messages(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    Query(query): Query<MessagesQuery>,
) -> std::result::Result<Json<MessagesPageResponse>, ApiError> {
    let page = manager
        .messages_page(
            &session_id,
            MessagePageRequest {
                before: query.before,
                limit: query
                    .limit
                    .unwrap_or(DEFAULT_MESSAGE_PAGE_LIMIT)
                    .clamp(1, MAX_MESSAGE_PAGE_LIMIT),
                include_system: query.include_system,
            },
        )
        .await?;
    Ok(Json(page.into()))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/inbox",
    operation_id = "get_sessions_session_id_inbox",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<InboxItemResponse>, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_direct_inbox(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<InboxItemResponse>>, ApiError> {
    Ok(Json(
        manager
            .list_direct_inbox(&session_id)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/inbox",
    operation_id = "post_sessions_session_id_inbox",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = CreateInboxItemRequest, content_type = "application/json"),
    responses((status = 202, description = "Accepted", body = InboxItemResponse, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_direct_inbox_item(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CreateInboxItemRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<InboxItemResponse>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(
            manager
                .create_direct_inbox_item(&session_id, request)
                .await?
                .into(),
        ),
    ))
}

#[utoipa::path(
    patch,
    path = "/sessions/{session_id}/inbox/{item_id}",
    operation_id = "patch_sessions_session_id_inbox_item_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("item_id" = i64, Path)),
    request_body(content = UpdateInboxItemRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = InboxItemResponse, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_direct_inbox_item(
    State(manager): State<SessionManager>,
    AxumPath((session_id, item_id)): AxumPath<(String, i64)>,
    payload: std::result::Result<Json<UpdateInboxItemRequest>, JsonRejection>,
) -> std::result::Result<Json<InboxItemResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .update_direct_inbox_item(&session_id, item_id, request)
            .await?
            .into(),
    ))
}

#[utoipa::path(
    put,
    path = "/sessions/{session_id}/inbox/order",
    operation_id = "put_sessions_session_id_inbox_order",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = ReorderInboxItemsRequest, content_type = "application/json"),
    responses((status = 200, description = "Success", body = Vec<InboxItemResponse>, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn reorder_direct_inbox_items(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<ReorderInboxItemsRequest>, JsonRejection>,
) -> std::result::Result<Json<Vec<InboxItemResponse>>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .reorder_direct_inbox_items(&session_id, request)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/inbox/{item_id}",
    operation_id = "delete_sessions_session_id_inbox_item_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("item_id" = i64, Path)),
    request_body(content = CancelInboxItemRequest, content_type = "application/json"),
    responses((status = 200, description = "Cancelled", body = InboxItemResponse, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn cancel_direct_inbox_item(
    State(manager): State<SessionManager>,
    AxumPath((session_id, item_id)): AxumPath<(String, i64)>,
    payload: std::result::Result<Json<CancelInboxItemRequest>, JsonRejection>,
) -> std::result::Result<Json<InboxItemResponse>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .cancel_direct_inbox_item(&session_id, item_id, request)
            .await?
            .into(),
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/goal",
    operation_id = "get_sessions_session_id_goal",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Current goal or null", body = Option<SessionGoalRecord>, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn get_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Option<SessionGoalRecord>>, ApiError> {
    Ok(Json(manager.direct_goal(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/goal",
    operation_id = "post_sessions_session_id_goal",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = CreateGoalRequest, content_type = "application/json"),
    responses((status = 201, description = "Goal created", body = SessionGoalRecord, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<CreateGoalRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<SessionGoalRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(manager.create_direct_goal(&session_id, request).await?),
    ))
}

#[utoipa::path(
    patch,
    path = "/sessions/{session_id}/goal/{goal_id}",
    operation_id = "patch_sessions_session_id_goal_goal_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("goal_id" = String, Path)),
    request_body(content = UpdateGoalRequest, content_type = "application/json"),
    responses((status = 200, description = "Goal updated", body = SessionGoalRecord, content_type = "application/json"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath((session_id, goal_id)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<UpdateGoalRequest>, JsonRejection>,
) -> std::result::Result<Json<SessionGoalRecord>, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok(Json(
        manager
            .update_direct_goal(&session_id, &goal_id, request)
            .await?,
    ))
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/goal/{goal_id}",
    operation_id = "delete_sessions_session_id_goal_goal_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("goal_id" = String, Path)),
    request_body(content = ClearGoalRequest, content_type = "application/json"),
    responses((status = 204, description = "Goal cleared"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn clear_direct_goal(
    State(manager): State<SessionManager>,
    AxumPath((session_id, goal_id)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<ClearGoalRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    manager
        .clear_direct_goal(&session_id, &goal_id, request.expected_version)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/permissions",
    operation_id = "get_sessions_session_id_permissions",
    tag = "permissions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = PermissionStateResponse, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn permission_state(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<PermissionStateResponse>, ApiError> {
    Ok(Json(manager.permission_state(&session_id).await?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/permissions/{request_id}",
    operation_id = "post_sessions_session_id_permissions_request_id",
    tag = "permissions",
    params(("session_id" = String, Path), ("request_id" = String, Path)),
    request_body(content = ReplyPermissionRequest, content_type = "application/json"),
    responses((status = 204, description = "Permission request answered"), (status = 400, description = "Bad request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn reply_permission_request(
    State(manager): State<SessionManager>,
    AxumPath((session_id, request_id)): AxumPath<(String, String)>,
    payload: std::result::Result<Json<ReplyPermissionRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    manager
        .reply_permission_request(&session_id, &request_id, request.reply)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}/permissions/grants/{grant_id}",
    operation_id = "delete_sessions_session_id_permissions_grants_grant_id",
    tag = "permissions",
    params(("session_id" = String, Path), ("grant_id" = String, Path)),
    responses((status = 204, description = "Remembered grant removed"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_permission_grant(
    State(manager): State<SessionManager>,
    AxumPath((session_id, grant_id)): AxumPath<(String, String)>,
) -> std::result::Result<StatusCode, ApiError> {
    manager
        .delete_permission_grant(&session_id, &grant_id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/threads/{thread_name}/events",
    operation_id = "get_sessions_session_id_threads_thread_name_events",
    tag = "conversation",
    params(ThreadEventsQuery, ("session_id" = String, Path), ("thread_name" = String, Path)),
    responses((status = 200, description = "Success", body = ThreadEventPage, content_type = "application/json"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn thread_events(
    State(manager): State<SessionManager>,
    AxumPath((session_id, thread_name)): AxumPath<(String, String)>,
    Query(query): Query<ThreadEventsQuery>,
) -> std::result::Result<Json<ThreadEventPage>, ApiError> {
    Ok(Json(
        manager
            .thread_events(
                &session_id,
                &thread_name,
                query.before_id,
                query
                    .limit
                    .unwrap_or(DEFAULT_THREAD_EVENT_PAGE_LIMIT)
                    .clamp(1, MAX_THREAD_EVENT_PAGE_LIMIT),
            )
            .await?,
    ))
}
