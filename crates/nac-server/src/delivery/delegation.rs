use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use nac_core::store::{ManagedOrchestratorRecord, TraditionalChildRecord};
use serde::Deserialize;

use crate::{
    application::delegation::{StartManagedOrchestrator, StartTraditionalChild},
    ApiError, ApiErrorBody, SessionManager,
};

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct StartTraditionalChildRequest {
    pub profile: String,
    pub description: String,
    pub prompt: String,
    pub child_session_id: Option<String>,
    #[serde(default)]
    pub background: bool,
}

#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct StartManagedOrchestratorRequest {
    pub description: String,
    pub prompt: String,
    pub orchestrator_session_id: Option<String>,
    #[serde(default)]
    pub background: bool,
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/children",
    operation_id = "get_sessions_session_id_children",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Traditional children", body = Vec<TraditionalChildRecord>, content_type = "application/json"), (status = 400, description = "Direct behavior required", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_traditional_children(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<TraditionalChildRecord>>, ApiError> {
    Ok(Json(
        manager
            .delegation()
            .list_traditional_children(&session_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/children",
    operation_id = "post_sessions_session_id_children",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = StartTraditionalChildRequest, content_type = "application/json"),
    responses((status = 201, description = "Child created, continued, or steered", body = TraditionalChildRecord, content_type = "application/json"), (status = 400, description = "Invalid child request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Child concurrency or run conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn start_traditional_child(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: Result<Json<StartTraditionalChildRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<TraditionalChildRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let command = StartTraditionalChild {
        profile: request.profile,
        description: request.description,
        prompt: request.prompt,
        child_session_id: request.child_session_id,
        background: request.background,
    };
    Ok((
        StatusCode::CREATED,
        Json(
            manager
                .delegation()
                .start_traditional_child(&session_id, command)
                .await?,
        ),
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/children/{child_session_id}",
    operation_id = "get_sessions_session_id_children_child_session_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("child_session_id" = String, Path)),
    responses((status = 200, description = "Traditional child status", body = TraditionalChildRecord, content_type = "application/json"), (status = 404, description = "Child not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn get_traditional_child(
    State(manager): State<SessionManager>,
    AxumPath((session_id, child_session_id)): AxumPath<(String, String)>,
) -> Result<Json<TraditionalChildRecord>, ApiError> {
    Ok(Json(
        manager
            .delegation()
            .traditional_child(&session_id, &child_session_id)?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/children/{child_session_id}/cancel",
    operation_id = "post_sessions_session_id_children_child_session_id_cancel",
    tag = "conversation",
    params(("session_id" = String, Path), ("child_session_id" = String, Path)),
    responses((status = 200, description = "Traditional child cancelled", body = TraditionalChildRecord, content_type = "application/json"), (status = 404, description = "Child not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Child run is remote or unavailable", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn cancel_traditional_child(
    State(manager): State<SessionManager>,
    AxumPath((session_id, child_session_id)): AxumPath<(String, String)>,
) -> Result<Json<TraditionalChildRecord>, ApiError> {
    Ok(Json(
        manager
            .delegation()
            .cancel_traditional_child(&session_id, &child_session_id)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/orchestrators",
    operation_id = "get_sessions_session_id_orchestrators",
    tag = "conversation",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Managed orchestrators", body = Vec<ManagedOrchestratorRecord>, content_type = "application/json"), (status = 400, description = "Direct-with-orchestrator behavior required", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn list_managed_orchestrators(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> Result<Json<Vec<ManagedOrchestratorRecord>>, ApiError> {
    Ok(Json(
        manager
            .delegation()
            .list_managed_orchestrators(&session_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/orchestrators",
    operation_id = "post_sessions_session_id_orchestrators",
    tag = "conversation",
    params(("session_id" = String, Path)),
    request_body(content = StartManagedOrchestratorRequest, content_type = "application/json"),
    responses((status = 201, description = "Orchestrator created, continued, or steered", body = ManagedOrchestratorRecord, content_type = "application/json"), (status = 400, description = "Invalid orchestrator request", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Session not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Orchestrator concurrency or run conflict", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn start_managed_orchestrator(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: Result<Json<StartManagedOrchestratorRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ManagedOrchestratorRecord>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    let command = StartManagedOrchestrator {
        description: request.description,
        prompt: request.prompt,
        orchestrator_session_id: request.orchestrator_session_id,
        background: request.background,
    };
    Ok((
        StatusCode::CREATED,
        Json(
            manager
                .delegation()
                .start_managed_orchestrator(&session_id, command)
                .await?,
        ),
    ))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/orchestrators/{orchestrator_session_id}",
    operation_id = "get_sessions_session_id_orchestrators_orchestrator_session_id",
    tag = "conversation",
    params(("session_id" = String, Path), ("orchestrator_session_id" = String, Path)),
    responses((status = 200, description = "Managed orchestrator status", body = ManagedOrchestratorRecord, content_type = "application/json"), (status = 404, description = "Orchestrator not found", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn get_managed_orchestrator(
    State(manager): State<SessionManager>,
    AxumPath((session_id, orchestrator_session_id)): AxumPath<(String, String)>,
) -> Result<Json<ManagedOrchestratorRecord>, ApiError> {
    Ok(Json(manager.delegation().managed_orchestrator(
        &session_id,
        &orchestrator_session_id,
    )?))
}

#[utoipa::path(
    post,
    path = "/sessions/{session_id}/orchestrators/{orchestrator_session_id}/cancel",
    operation_id = "post_sessions_session_id_orchestrators_orchestrator_session_id_cancel",
    tag = "conversation",
    params(("session_id" = String, Path), ("orchestrator_session_id" = String, Path)),
    responses((status = 200, description = "Managed orchestrator cancelled", body = ManagedOrchestratorRecord, content_type = "application/json"), (status = 404, description = "Orchestrator not found", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Orchestrator run unavailable", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn cancel_managed_orchestrator(
    State(manager): State<SessionManager>,
    AxumPath((session_id, orchestrator_session_id)): AxumPath<(String, String)>,
) -> Result<Json<ManagedOrchestratorRecord>, ApiError> {
    Ok(Json(
        manager
            .delegation()
            .cancel_managed_orchestrator(&session_id, &orchestrator_session_id)
            .await?,
    ))
}
