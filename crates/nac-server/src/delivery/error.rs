use axum::{
    extract::rejection::JsonRejection,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use nac_core::{
    model::ModelConfigurationError,
    model_configurations::ModelConfigurationStoreError,
    projects::ProjectStoreError,
    runtime,
    session_service::{SessionCoordinationError, SessionSubmitError},
    sessions,
    ssh_configurations::SshConfigurationStoreError,
};

use crate::{
    application::{self, request_validation::RequestConfigurationError},
    filesystem, ApiErrorBody,
};

#[derive(Debug)]
pub struct ApiError {
    pub(crate) status: StatusCode,
    pub(crate) message: String,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, message: String) -> Self {
        Self { status, message }
    }

    pub(crate) fn bad_request(message: String) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message)
    }
}

impl From<JsonRejection> for ApiError {
    fn from(error: JsonRejection) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: format!("invalid JSON request body: {error}"),
        }
    }
}

impl From<sessions::SessionPresentationError> for ApiError {
    fn from(error: sessions::SessionPresentationError) -> Self {
        let status = match &error {
            sessions::SessionPresentationError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            sessions::SessionPresentationError::NotFound(_) => StatusCode::NOT_FOUND,
            sessions::SessionPresentationError::Conflict(_)
            | sessions::SessionPresentationError::Busy(_) => StatusCode::CONFLICT,
            sessions::SessionPresentationError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<sessions::SessionConfigUpdateError> for ApiError {
    fn from(error: sessions::SessionConfigUpdateError) -> Self {
        let status = match &error {
            sessions::SessionConfigUpdateError::NotFound(_) => StatusCode::NOT_FOUND,
            sessions::SessionConfigUpdateError::Conflict(_) => StatusCode::CONFLICT,
            sessions::SessionConfigUpdateError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<ModelConfigurationStoreError> for ApiError {
    fn from(error: ModelConfigurationStoreError) -> Self {
        let status = match &error {
            ModelConfigurationStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            ModelConfigurationStoreError::DuplicateName(_)
            | ModelConfigurationStoreError::InUse(_) => StatusCode::CONFLICT,
            ModelConfigurationStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            ModelConfigurationStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<application::model_configurations::ModelConfigurationApplicationError> for ApiError {
    fn from(error: application::model_configurations::ModelConfigurationApplicationError) -> Self {
        match error {
            application::model_configurations::ModelConfigurationApplicationError::InvalidInput(
                message,
            ) => Self::bad_request(message),
            application::model_configurations::ModelConfigurationApplicationError::Provider(
                message,
            ) => Self::new(StatusCode::BAD_GATEWAY, message),
            application::model_configurations::ModelConfigurationApplicationError::Store(error) => {
                error.into()
            }
            application::model_configurations::ModelConfigurationApplicationError::Internal(
                error,
            ) => error.into(),
        }
    }
}

impl From<ProjectStoreError> for ApiError {
    fn from(error: ProjectStoreError) -> Self {
        let status = match &error {
            ProjectStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            ProjectStoreError::DuplicateLocation | ProjectStoreError::Conflict(_) => {
                StatusCode::CONFLICT
            }
            ProjectStoreError::NotFound(_) | ProjectStoreError::ModelConfigurationNotFound(_) => {
                StatusCode::NOT_FOUND
            }
            ProjectStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<application::projects::ProjectApplicationError> for ApiError {
    fn from(error: application::projects::ProjectApplicationError) -> Self {
        match error {
            application::projects::ProjectApplicationError::InvalidInput(message) => {
                Self::bad_request(message)
            }
            application::projects::ProjectApplicationError::Project(error) => error.into(),
            application::projects::ProjectApplicationError::LocalBrowse(error) => error.into(),
            application::projects::ProjectApplicationError::RemoteBrowse(error) => error.into(),
            application::projects::ProjectApplicationError::Session(error) => error.into(),
        }
    }
}

impl From<SshConfigurationStoreError> for ApiError {
    fn from(error: SshConfigurationStoreError) -> Self {
        let status = match &error {
            SshConfigurationStoreError::InvalidInput(_) => StatusCode::BAD_REQUEST,
            SshConfigurationStoreError::DuplicateName(_) => StatusCode::CONFLICT,
            SshConfigurationStoreError::NotFound(_) => StatusCode::NOT_FOUND,
            SshConfigurationStoreError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<filesystem::BrowseError> for ApiError {
    fn from(error: filesystem::BrowseError) -> Self {
        let status = match &error {
            filesystem::BrowseError::NotFound(_) => StatusCode::NOT_FOUND,
            filesystem::BrowseError::NotADirectory(_) => StatusCode::BAD_REQUEST,
            filesystem::BrowseError::Unreadable { .. } => StatusCode::FORBIDDEN,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<runtime::RemoteBrowseError> for ApiError {
    fn from(error: runtime::RemoteBrowseError) -> Self {
        let status = match &error {
            runtime::RemoteBrowseError::Invalid(_)
            | runtime::RemoteBrowseError::NotADirectory(_) => StatusCode::BAD_REQUEST,
            runtime::RemoteBrowseError::NotFound(_) => StatusCode::NOT_FOUND,
            runtime::RemoteBrowseError::Unreadable { .. } => StatusCode::FORBIDDEN,
            // The host, not this server, is what failed, and the caller can
            // retry once it is fixed.
            runtime::RemoteBrowseError::Unreachable { .. }
            | runtime::RemoteBrowseError::Remote(_) => StatusCode::BAD_GATEWAY,
        };
        Self {
            status,
            message: error.to_string(),
        }
    }
}

impl From<RequestConfigurationError> for ApiError {
    fn from(error: RequestConfigurationError) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: error.to_string(),
        }
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(error: anyhow::Error) -> Self {
        let message = error.to_string();
        let status = if let Some(error) = error.downcast_ref::<sessions::SessionConfigUpdateError>()
        {
            match error {
                sessions::SessionConfigUpdateError::NotFound(_) => StatusCode::NOT_FOUND,
                sessions::SessionConfigUpdateError::Conflict(_) => StatusCode::CONFLICT,
                sessions::SessionConfigUpdateError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
            }
        } else if let Some(error) = error.downcast_ref::<SessionSubmitError>() {
            match error {
                SessionSubmitError::Busy { .. } | SessionSubmitError::ExternalBusy { .. } => {
                    StatusCode::CONFLICT
                }
                SessionSubmitError::Coordination {
                    message:
                        SessionCoordinationError::StaleConfiguration { .. }
                        | SessionCoordinationError::LocalAgentBusy,
                } => StatusCode::CONFLICT,
                SessionSubmitError::Coordination { .. } => StatusCode::INTERNAL_SERVER_ERROR,
            }
        } else if let Some(error) = error.downcast_ref::<sessions::SessionOperationLeaseError>() {
            match error {
                sessions::SessionOperationLeaseError::Busy(_) => StatusCode::CONFLICT,
                sessions::SessionOperationLeaseError::Store(_) => StatusCode::INTERNAL_SERVER_ERROR,
            }
        } else if error.downcast_ref::<ModelConfigurationError>().is_some()
            || error.downcast_ref::<RequestConfigurationError>().is_some()
            || message.contains("invalid model configuration")
        {
            StatusCode::BAD_REQUEST
        } else if message.contains("was not found")
            || message.contains("not found")
            || message.contains("has no goal")
            || message.contains("unknown host")
        {
            StatusCode::NOT_FOUND
        } else if nac_core::store::is_sqlite_busy(&error)
            || message.contains("database is locked")
            || message.contains("timed out waiting for SQLite connection capacity")
            || message.contains("busy")
            || message.contains("uncommitted changes")
            || message.contains("no active run")
            || message.contains("not active")
            || message.contains("active run is finishing")
            || message.contains("version conflict")
            || message.contains("no longer pending")
            || message.contains("no longer current")
            || message.contains("unfinished goal")
            || message.contains("goal clear conflict")
            || message.contains("child concurrency limit")
            || message.contains("managed orchestrator concurrency limit")
            || message.contains("delegated sessions accept")
            || message.contains("already has running generation")
            || message.contains("already has a running generation")
            || message.contains("running in another process")
        {
            StatusCode::CONFLICT
        } else if message.contains("not supported")
            || message.contains("cancellation is not supported")
        {
            StatusCode::NOT_IMPLEMENTED
        } else if message.contains("invalid")
            || message.contains("prompt is empty")
            || message.contains("goal objective is empty")
            || message.contains("goal token budget")
            || message.contains("traditional child prompt is empty")
            || message.contains("traditional child profile")
            || message.contains("traditional child nesting limit")
            || message.contains("running assigned sessions cannot launch")
            || message.contains("managed orchestrator prompt is empty")
            || message.contains("managed orchestrators require an agent parent")
            || message.contains("managed orchestrators require direct-with-orchestrator")
            || message.contains("managed orchestrator description")
            || message.contains("managed orchestrator sessions cannot launch")
            || message.contains("host-backed shared workspace")
            || message.contains("frontend command")
            || message.contains("traditional child sessions cannot own autonomous goals")
            || message.contains("running assigned sessions cannot own autonomous goals")
            || message.contains("only for direct behaviors")
        {
            StatusCode::BAD_REQUEST
        } else {
            StatusCode::INTERNAL_SERVER_ERROR
        };
        Self { status, message }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(ApiErrorBody {
                error: self.message,
            }),
        )
            .into_response()
    }
}
