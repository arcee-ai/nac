//! Restricted existing public-native-v1 CREATE adapter; never an ordinary proxy.
pub(super) mod contracts;
#[cfg(all(test, unix))]
mod tests;

use crate::{
    application::public_session_creation::{PublicCreateCurrentness, PublicCreationError},
    ApiErrorBody, SessionManager,
};
use axum::{
    extract::{FromRequest, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{PublicNacCreateSession, PublicNacCreatedSession};

fn refused(status: StatusCode) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(ApiErrorBody {
            error: "public session creation unavailable".into(),
        }),
    )
        .into_response()
}
fn one_header<'a>(headers: &'a axum::http::HeaderMap, key: &str) -> Result<Option<&'a str>, ()> {
    let mut values = headers.get_all(key).iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        return Err(());
    }
    value.to_str().map(Some).map_err(|_| ())
}

#[utoipa::path(post, path = "/public/sessions", operation_id = "post_public_sessions", tag = "sessions",
    request_body(content = PublicNacCreateSession, content_type = "application/json"),
    responses((status = 201, description = "Requires genuine admitted creation; currently unavailable", body = PublicNacCreatedSession),
    (status = 400, description = "Invalid restricted request", body = ApiErrorBody),
    (status = 413, description = "Request too large", body = ApiErrorBody),
    (status = 415, description = "JSON required", body = ApiErrorBody),
    (status = 503, description = "Original operation authority unavailable", body = ApiErrorBody)))]
pub(crate) async fn handle(State(manager): State<SessionManager>, request: Request) -> Response {
    if request.uri().query().is_some() {
        return refused(StatusCode::BAD_REQUEST);
    }
    let request_id = match one_header(request.headers(), "x-nac-request-id") {
        Ok(Some(value)) if !value.is_empty() => value.to_owned(),
        _ => return refused(StatusCode::BAD_REQUEST),
    };
    let if_match = match one_header(request.headers(), "if-match") {
        Ok(None) => None,
        Ok(Some(value))
            if value.starts_with('"')
                && value.ends_with('"')
                && value.len() > 2
                && !value[1..value.len() - 1].contains('"') =>
        {
            Some(value.to_owned())
        }
        _ => return refused(StatusCode::BAD_REQUEST),
    };
    if !matches!(one_header(request.headers(), "content-type"), Ok(Some(_))) {
        return refused(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    let dto = match Json::<PublicNacCreateSession>::from_request(request, &()).await {
        Ok(Json(dto)) => dto,
        Err(error) => {
            return refused(match error.status() {
                StatusCode::PAYLOAD_TOO_LARGE => StatusCode::PAYLOAD_TOO_LARGE,
                StatusCode::UNSUPPORTED_MEDIA_TYPE => StatusCode::UNSUPPORTED_MEDIA_TYPE,
                _ => StatusCode::BAD_REQUEST,
            })
        }
    };
    let command = match dto.into_command() {
        Ok(command) => command,
        Err(_) => return refused(StatusCode::BAD_REQUEST),
    };
    match manager.session_creation().create_public_session(
        command,
        PublicCreateCurrentness {
            request_id,
            if_match,
        },
    ) {
        Ok(identity) => (
            StatusCode::CREATED,
            [(header::CACHE_CONTROL, "no-store")],
            Json(PublicNacCreatedSession::from(identity)),
        )
            .into_response(),
        Err(PublicCreationError::InvalidContext) => refused(StatusCode::BAD_REQUEST),
        // No DTO, actor header, ETag or enrolled machine peer can stand in for
        // actual AFM same-operation proof + Core's retained paired owner.
        _ => refused(StatusCode::SERVICE_UNAVAILABLE),
    }
}
