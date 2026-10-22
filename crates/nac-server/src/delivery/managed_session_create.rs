//! Purpose-specific private CREATE receiver. Wire data and a pinned TLS caller
//! never replace AFM original-primary custody or Core consumed CREATE authority.
use super::{single_header, FactDeadline, ObservationShutdown};
use crate::{
    application::public_session_creation::PublicCreationError,
    delivery::{
        managed_runtime_tls::AuthenticatedRuntimePeer,
        public_session_creation::contracts::PublicNacCreateSession,
    },
    ApiErrorBody, SessionManager,
};
use axum::{
    body::to_bytes,
    extract::{ConnectInfo, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};

#[path = "managed_session_create/ack.rs"]
mod ack;
#[path = "managed_session_create/contracts.rs"]
mod contracts;
pub(super) use ack::{handle as acknowledge, PATH as ACK_PATH};
#[cfg(all(test, unix))]
#[path = "managed_session_create/tests.rs"]
mod tests;

pub(super) const PATH: &str = "/internal/v1/managed-session-create";
const PURPOSE: &str = "managed-session-create.v1";
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;

fn refused(status: StatusCode) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(ApiErrorBody {
            error: "managed session creation unavailable".into(),
        }),
    )
        .into_response()
}

pub(super) async fn handle(State(manager): State<SessionManager>, request: Request) -> Response {
    let Some(ConnectInfo(peer)) = request
        .extensions()
        .get::<ConnectInfo<AuthenticatedRuntimePeer>>()
        .cloned()
    else {
        return refused(StatusCode::FORBIDDEN);
    };
    if request.uri().query().is_some()
        || single_header(request.headers(), "content-type") != Some("application/json")
        || !matches!(
            single_header(request.headers(), "accept"),
            Some("application/json") | Some(crate::application::create_terminal::MEDIA_TYPE)
        )
        || [
            "authorization",
            "cookie",
            "origin",
            "x-forwarded-client-cert",
        ]
        .iter()
        .any(|name| request.headers().contains_key(*name))
    {
        return refused(StatusCode::BAD_REQUEST);
    }
    let Some(request_id) = single_header(request.headers(), "x-nac-request-id")
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .map(str::to_owned)
    else {
        return refused(StatusCode::BAD_REQUEST);
    };
    let if_match = match single_header(request.headers(), "if-match") {
        Some(value) => value.to_owned(),
        None if request.headers().contains_key("if-match") => {
            return refused(StatusCode::BAD_REQUEST);
        }
        None => return refused(StatusCode::PRECONDITION_REQUIRED),
    };
    // Capture exactly once, before body I/O, under the sender's existing expiry.
    // A future Core consumer must retain this original cutoff and original
    // owner through uncertainty rather than cancel a running effect on timeout.
    let Some(deadline) = FactDeadline::from_headers(request.headers()) else {
        return refused(StatusCode::FORBIDDEN);
    };
    let operation = match uuid::Uuid::parse_str(&request_id) {
        Ok(id) if !id.is_nil() && id.to_string() == request_id => id,
        _ => return refused(StatusCode::BAD_REQUEST),
    };
    let exchange = match peer.original().begin_create(operation, deadline.epoch_ms) {
        Ok(exchange) => exchange,
        Err(_) => return refused(StatusCode::FORBIDDEN),
    };
    let shutdown = request.extensions().get::<ObservationShutdown>().cloned();
    if shutdown.as_ref().is_some_and(|state| *state.0.borrow()) {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    }
    let body = match tokio::time::timeout_at(
        exchange.original_cutoff().into(),
        to_bytes(request.into_body(), MAX_BODY_BYTES),
    )
    .await
    {
        Ok(Ok(body)) => body,
        Ok(Err(_)) => return refused(StatusCode::PAYLOAD_TOO_LARGE),
        Err(_) => return refused(StatusCode::SERVICE_UNAVAILABLE),
    };
    let exchange = match exchange.bind_body(body.to_vec().into_boxed_slice()) {
        Ok(exchange) => exchange,
        Err(_) => return refused(StatusCode::SERVICE_UNAVAILABLE),
    };
    let envelope = match serde_json::from_slice::<contracts::EnvelopeV1>(exchange.payload()) {
        Ok(envelope) => envelope,
        Err(_) => return refused(StatusCode::BAD_REQUEST),
    };
    let validated = match envelope.validate(
        &request_id,
        &if_match,
        &manager,
        exchange.original_cutoff(),
        exchange.original_expiry_epoch_ms(),
    ) {
        Ok(validated) => validated,
        Err(status) => return refused(status),
    };
    if exchange.check_current().is_err() || shutdown.as_ref().is_some_and(|state| *state.0.borrow())
    {
        return refused(StatusCode::SERVICE_UNAVAILABLE);
    }
    // The original opaque exchange remains retained through this refusal. A
    // real startup owner must consume it with its same import/Native resources;
    // wire DATA cannot select a producer or bypass the missing source join.
    // The closed managed application entry retains the full owned request and
    // refuses BEFORE private reads,
    // SQLite writes, backend construction or spawn. No local success/terminal
    // receipt can be constructed from the envelope's operation/config fields.
    // Installing a positive branch requires SAME-operation Core/AFM ownership,
    // full local source resolution and the actual paired runtime factory.
    let refusal = manager.session_creation().create_managed_session(validated);
    refused(match refusal.error() {
        PublicCreationError::InvalidContext => StatusCode::BAD_REQUEST,
        PublicCreationError::SourceChanged => StatusCode::PRECONDITION_FAILED,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    })
}

/// The future authenticated participant producer supplies only its actual
/// retained transfer attempt. Raw terminal bytes are never reconstructed here.
/// Admission is still closed in handle; this is the consuming delivery half.
pub(super) async fn finish_bound_create(
    attempt: crate::application::create_transfer::CreateTransferAttempt,
) -> Response {
    let receipt = match attempt.wait().await {
        Ok(receipt) => receipt,
        Err(_) => return refused(StatusCode::SERVICE_UNAVAILABLE),
    };
    let bytes = match receipt.into_terminal_body() {
        Ok(bytes) => bytes,
        Err(_) => return refused(StatusCode::SERVICE_UNAVAILABLE),
    };
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "application/json"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        bytes.to_vec(),
    )
        .into_response()
}
