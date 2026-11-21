use axum::{
    extract::{rejection::JsonRejection, Path as AxumPath, State},
    http::StatusCode,
    Json,
};
use nac_core::{session_service::SessionFrontendSnapshot, sessions};

use crate::{ApiError, ApiErrorBody, CreateSessionRequest, SessionManager, UpdateConfigRequest};

#[utoipa::path(
    post,
    path = "/sessions",
    operation_id = "post_sessions",
    tag = "sessions",
    request_body(content = CreateSessionRequest, content_type = "application/json"),
    responses((status = 201, description = "Success", body = SessionFrontendSnapshot, content_type = "application/json"), (status = 400, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn create_session(
    State(manager): State<SessionManager>,
    payload: std::result::Result<Json<CreateSessionRequest>, JsonRejection>,
) -> std::result::Result<(StatusCode, Json<SessionFrontendSnapshot>), ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    Ok((
        StatusCode::CREATED,
        Json(manager.create_session(request).await?),
    ))
}

#[utoipa::path(
    delete,
    path = "/sessions/{session_id}",
    operation_id = "delete_sessions_session_id",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success with no response body"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn delete_session_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<StatusCode, ApiError> {
    manager.delete_session(&session_id).await?;
    Ok(StatusCode::OK)
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/skills",
    operation_id = "get_sessions_session_id_skills",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<nac_core::skill_catalog::SkillCatalogEntry>, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn session_skills_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<nac_core::skill_catalog::SkillCatalogEntry>>, ApiError> {
    Ok(Json(manager.session_skills(&session_id).await?))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/commands",
    operation_id = "get_sessions_session_id_commands",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = Vec<nac_core::commands::SlashCommandDefinition>, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn session_commands_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<Vec<nac_core::commands::SlashCommandDefinition>>, ApiError> {
    Ok(Json(manager.session_state().commands(&session_id).await?))
}

#[utoipa::path(
    get,
    path = "/sessions/{session_id}/config",
    operation_id = "get_sessions_session_id_config",
    tag = "sessions",
    params(("session_id" = String, Path)),
    responses((status = 200, description = "Success", body = sessions::RawSessionConfig, content_type = "application/json"), (status = 400, description = "Path extraction failed", body = String, content_type = "text/plain"), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn session_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
) -> std::result::Result<Json<sessions::RawSessionConfig>, ApiError> {
    Ok(Json(manager.session_config(&session_id)?))
}

#[derive(serde::Serialize, utoipa::ToSchema)]
pub(crate) struct ProjectSessionModelSource {
    session_id: String,
    model: String,
    base_url: String,
    allow_insecure_http: bool,
    backend: Option<String>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    api_key_env: Option<String>,
    config_version: i64,
    diagnostics: Vec<String>,
}

/// Read only a project-owned ordinary session's saved model selection. This
/// endpoint never attaches the session or triggers recovery.
#[utoipa::path(
    get,
    path = "/projects/{project_id}/session-model-sources/{session_id}",
    operation_id = "get_project_session_model_source",
    tag = "sessions",
    params(("project_id" = String, Path), ("session_id" = String, Path)),
    responses((status = 200, description = "Eligible project session model", body = ProjectSessionModelSource), (status = 404, description = "Source is unavailable or not eligible", body = ApiErrorBody), (status = 500, description = "Storage failure", body = ApiErrorBody))
)]
pub(crate) async fn project_session_model_source(
    State(manager): State<SessionManager>,
    AxumPath((project_id, session_id)): AxumPath<(String, String)>,
) -> std::result::Result<Json<ProjectSessionModelSource>, ApiError> {
    let source = sessions::load_project_session_model_source(
        &manager.inner.store_path,
        &project_id,
        &session_id,
    )?;
    source
        .map(|config| {
            Json(ProjectSessionModelSource {
                session_id: config.session_id,
                model: config.model,
                base_url: config.base_url,
                allow_insecure_http: config.allow_insecure_http,
                backend: config.backend,
                reasoning_effort: config.reasoning_effort,
                service_tier: config.service_tier,
                api_key_env: config.api_key_env,
                config_version: config.config_version,
                // Diagnostics may derive from stored header bytes; expose only a closed status.
                diagnostics: if config.diagnostics.is_empty() {
                    vec![]
                } else {
                    vec!["Invalid source model configuration".into()]
                },
            })
        })
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "Session model source is unavailable".into(),
            )
        })
}

#[utoipa::path(
    patch,
    path = "/sessions/{session_id}/config",
    operation_id = "patch_sessions_session_id_config",
    tag = "sessions",
    params(("session_id" = String, Path)),
    request_body(content = UpdateConfigRequest, content_type = "application/json"),
    responses((status = 200, description = "Success with no response body"), (status = 400, description = "Bad request or rejected path/query/body extraction", content((ApiErrorBody = "application/json"), (String = "text/plain"))), (status = 404, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 409, description = "Request failed", body = ApiErrorBody, content_type = "application/json"), (status = 500, description = "Request failed", body = ApiErrorBody, content_type = "application/json"))
)]
pub(crate) async fn update_config_handler(
    State(manager): State<SessionManager>,
    AxumPath(session_id): AxumPath<String>,
    payload: std::result::Result<Json<UpdateConfigRequest>, JsonRejection>,
) -> std::result::Result<StatusCode, ApiError> {
    let Json(request) = payload.map_err(ApiError::from)?;
    manager.update_session_config(&session_id, request).await?;
    Ok(StatusCode::OK)
}
